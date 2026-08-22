/**
 * The take, while it is still being played.
 *
 * Directive 02 §2: when the user hits record, what they play draws onto the
 * track as it happens. A take that only appears when the transport stops is a
 * take the musician cannot see themselves making, and watching the part arrive
 * is most of what makes overdubbing feel like playing rather than like filing.
 *
 * Everything here is written straight into a canvas on the engine's frame loop.
 * None of it goes through React state: a component re-rendering sixty times a
 * second would re-render every clip in the arrangement with it, which is the
 * cost that makes live drawing look like a bad idea when it is really a bad
 * implementation.
 *
 * Drawing is incremental. Closed notes are painted once and never repainted;
 * only the notes still being held are redrawn each frame, because only they
 * change. A full repaint happens when the view itself moves — a zoom or a
 * scroll invalidates every coordinate — and at no other time.
 */
import { useEffect, useRef } from 'react';
import { engine } from '../../audio/engine';
import { midiRecorder } from '../../audio/midiRecorder';
import { BASE_SAMPLES_PER_BUCKET } from '../../audio/livePeaks';
import { livePeakTap } from '../../audio/peakTap';
import { useInputStore } from '../../state/inputStore';
import { useProjectStore } from '../../state/projectStore';

/** Pitch range drawn, matching the piano roll's default view. */
const PITCH_LO = 21;
const PITCH_HI = 108;

export function LiveTakeLane({
  trackId,
  kind,
  pxPerBeat,
  height,
  color,
}: {
  trackId: string;
  /** Audio draws a growing waveform; MIDI draws notes as they are held. */
  kind: 'audio' | 'midi';
  pxPerBeat: number;
  height: number;
  /** The track's colour, so the take reads as belonging to it before it exists. */
  color: string;
}) {
  const phase = useInputStore((s) => s.phase);
  const armed = useProjectStore((s) => s.project.tracks.find((t) => t.id === trackId)?.armed);
  const bpm = useProjectStore((s) => s.project.bpm);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const recording =
    phase === 'recording' &&
    (kind === 'midi' ? midiRecorder.recordingTrackId === trackId : armed === true);

  useEffect(() => {
    if (!recording) return;
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // How many closed notes have been painted. Everything before this index is
    // already on the canvas and is never touched again.
    let painted = 0;
    let lastWidth = 0;
    let ctx: CanvasRenderingContext2D | null = null;

    const sizeTo = (widthPx: number) => {
      const w = Math.max(1, Math.ceil(widthPx));
      if (w === lastWidth) return false;
      // Growing a canvas clears it, so everything already drawn has to be
      // carried over rather than repainted from the note list — that repaint
      // is exactly the O(take length) cost this is avoiding.
      const keep =
        lastWidth > 0 && ctx !== null
          ? ctx.getImageData(0, 0, canvas.width, canvas.height)
          : null;
      canvas.width = Math.ceil(w * dpr);
      canvas.height = Math.ceil(height * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${height}px`;
      ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (keep) ctx.putImageData(keep, 0, 0);
      }
      lastWidth = w;
      return true;
    };

    /** Where the take begins, in lane pixels. */
    const startPx = () => midiRecorder.snapshot(engine.getPositionBeats()).startBeat * pxPerBeat;

    const yOf = (pitch: number) => {
      const span = PITCH_HI - PITCH_LO;
      const t = 1 - (Math.min(PITCH_HI, Math.max(PITCH_LO, pitch)) - PITCH_LO) / span;
      return t * (height - 3);
    };

    const drawNote = (
      c: CanvasRenderingContext2D,
      start: number,
      length: number,
      pitch: number,
      velocity: number,
      open: boolean,
    ) => {
      const x = start * pxPerBeat;
      const w = Math.max(2, length * pxPerBeat);
      // Velocity is the fill's strength, live — a quiet note looks quiet as it
      // is played rather than after it is committed.
      const strength = 0.35 + 0.65 * (velocity / 127);
      c.globalAlpha = open ? strength * 0.85 : strength;
      c.fillStyle = color;
      c.fillRect(x, yOf(pitch), w, 3);
      c.globalAlpha = 1;
    };

    // ---------------------------------------------------------------- audio
    //
    // The envelope arrives as min/max buckets of a fixed number of samples, so
    // a bucket is a fixed slice of *time*. Its width in pixels comes from the
    // tempo, which means a tempo change mid-take would put the take's internal
    // spacing slightly out — the right edge stays correct because it is the
    // playhead. That is a live drawing of a take in progress; the committed
    // clip is drawn from the file, under the tempo map, and is exact.
    if (kind === 'audio') {
      let drawn = 0;
      const secondsPerBucket = BASE_SAMPLES_PER_BUCKET / (engine.context?.sampleRate ?? 48000);
      const pxPerBucket = secondsPerBucket * pxPerBeat * (bpm / 60);
      const scratchMin = new Float32Array(4096);
      const scratchMax = new Float32Array(4096);
      const mid = height / 2;

      return engine.onFrame(() => {
        const peaks = livePeakTap.peaks;
        const total = peaks.count(0);
        const widthPx = total * pxPerBucket;
        root.style.transform = `translateX(${startPx()}px)`;
        sizeTo(widthPx);
        if (!ctx || total <= drawn) return;

        // Only what has arrived since the last frame — the whole point of the
        // mip chain is that this cost is set by the frame rate and not by how
        // long the take has been running.
        let from = drawn;
        ctx.fillStyle = color;
        while (from < total) {
          const to = Math.min(total, from + scratchMin.length);
          const n = peaks.read(0, from, to, scratchMin, scratchMax);
          for (let i = 0; i < n; i++) {
            const x = (from + i) * pxPerBucket;
            const top = mid - scratchMax[i] * mid;
            const bottom = mid - scratchMin[i] * mid;
            ctx.fillRect(x, top, Math.max(1, pxPerBucket), Math.max(1, bottom - top));
          }
          from = to;
        }
        drawn = total;
      });
    }

    // ----------------------------------------------------------------- midi
    return engine.onFrame(() => {
      const nowBeat = engine.getPositionBeats();
      const take = midiRecorder.snapshot(nowBeat);
      const beats = Math.max(0, nowBeat - take.startBeat);
      const widthPx = beats * pxPerBeat;

      root.style.transform = `translateX(${take.startBeat * pxPerBeat}px)`;
      const resized = sizeTo(widthPx);
      if (!ctx) return;

      // A resize carried the pixels over but the open notes were drawn at their
      // old length, so they are stale; repaint them from the current snapshot.
      if (resized) {
        // Only the strip the open notes occupy needs clearing, not the canvas.
        for (const note of take.open) {
          ctx.clearRect(note.start * pxPerBeat, yOf(note.pitch) - 1, widthPx, 5);
        }
      }
      for (let i = painted; i < take.closed.length; i++) {
        const n = take.closed[i];
        drawNote(ctx, n.start, n.length, n.pitch, n.velocity, false);
      }
      painted = take.closed.length;
      for (const n of take.open) {
        drawNote(ctx, n.start, n.length, n.pitch, n.velocity, true);
      }
    });
  }, [recording, trackId, kind, pxPerBeat, height, color, bpm]);

  if (!recording) return null;
  return (
    <div className="live-take" ref={rootRef} data-testid={`live-take-${trackId}`}>
      <canvas ref={canvasRef} className="live-take-canvas" />
    </div>
  );
}

/** True while a take is being recorded onto this track. */
export function useIsRecordingOnto(trackId: string): boolean {
  const phase = useInputStore((s) => s.phase);
  const armed = useProjectStore((s) => s.project.tracks.find((t) => t.id === trackId)?.armed);
  return phase === 'recording' && armed === true;
}
