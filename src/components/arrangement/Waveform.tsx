import { useEffect, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import { getBufferSync, getPeaksSync, isMissing, loadPeaks, mediaExists } from '../../audio/mediaLibrary';
import { sampleWindow } from '../../audio/peaks';
import { fadeGain } from '../../audio/clipSchedule';
import type { PeakData } from '../../model/media';
import type { FadeShape } from '../../model/types';

/** Above this zoom the cached envelope is coarser than the pixels; draw
 *  min/max from the decoded samples instead (bounded by visible columns). */
const RAW_SAMPLE_PX_PER_SEC = 600;
/** Visual silence detection: below this peak for at least this long. */
const SILENCE_LEVEL = 0.006;
const SILENCE_MIN_SEC = 0.12;

interface WaveformProps {
  mediaId: string;
  /** seconds into the source where the visible window starts */
  offsetSec: number;
  /** seconds of source shown */
  durationSec: number;
  color: string;
  /** clip gain, scales the drawn envelope */
  gain: number;
  /** fade lengths in seconds, drawn as overlays */
  fadeIn: number;
  fadeOut: number;
  fadeInShape?: FadeShape;
  fadeOutShape?: FadeShape;
  /** Layout size in px; changing them re-renders (replaces a ResizeObserver). */
  widthPx?: number;
  heightPx?: number;
}

/**
 * Clip waveform.
 *
 * Draws from the cached min/max envelope — never decodes, never walks raw
 * samples, and never creates per-sample DOM. One canvas per clip, redrawn only
 * when its own inputs or size change, which keeps hundreds of clips cheap.
 */
export function Waveform({
  mediaId,
  offsetSec,
  durationSec,
  color,
  gain,
  fadeIn,
  fadeOut,
  fadeInShape,
  fadeOutShape,
  widthPx,
  heightPx,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<PeakData | null>(() => getPeaksSync(mediaId));
  const [missing, setMissing] = useState(() => isMissing(mediaId));

  // Resolve peaks lazily; recorded/imported media loads from IndexedDB.
  useEffect(() => {
    let cancelled = false;
    const have = getPeaksSync(mediaId);
    if (have) {
      setPeaks(have);
      setMissing(false);
      return;
    }
    const ctx = engine.context;
    if (!ctx) {
      // Audio has not started, so nothing can be decoded yet — but absence is
      // still knowable, and an absent clip must not look like a silent one.
      void mediaExists(mediaId).then((exists) => {
        if (!cancelled) setMissing(!exists);
      });
      return () => {
        cancelled = true;
      };
    }
    void loadPeaks(mediaId, ctx).then((p) => {
      if (cancelled) return;
      setPeaks(p);
      setMissing(!p);
    });
    return () => {
      cancelled = true;
    };
  }, [mediaId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const w = Math.max(1, Math.floor(canvas.offsetWidth));
      const h = Math.max(1, Math.floor(canvas.offsetHeight));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) return;
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2d.clearRect(0, 0, w, h);
      if (!peaks || durationSec <= 0) return;

      // One column per device pixel column is plenty; cap the work for wide clips.
      const cols = Math.min(w, 2000);
      const pxPerSec = w / durationSec;
      const mid = h / 2;
      const scale = mid * 0.94 * Math.min(4, Math.max(0, gain));
      const colW = w / cols;

      // Sample-aware zoom: once a column spans fewer samples than the peak
      // cache resolves, draw min/max from the decoded buffer itself.
      let min: Float32Array;
      let max: Float32Array;
      const buf = pxPerSec > RAW_SAMPLE_PX_PER_SEC ? getBufferSync(mediaId) : null;
      if (buf) {
        min = new Float32Array(cols);
        max = new Float32Array(cols);
        const data = buf.getChannelData(0);
        const rate = buf.sampleRate;
        for (let i = 0; i < cols; i++) {
          const from = Math.floor((offsetSec + (i / cols) * durationSec) * rate);
          const to = Math.max(from + 1, Math.floor((offsetSec + ((i + 1) / cols) * durationSec) * rate));
          let lo = 0;
          let hi = 0;
          for (let s = Math.max(0, from); s < Math.min(data.length, to); s++) {
            const v = data[s];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
          min[i] = lo;
          max[i] = hi;
        }
      } else {
        ({ min, max } = sampleWindow(peaks, offsetSec, offsetSec + durationSec, cols));
      }

      ctx2d.fillStyle = color;
      ctx2d.globalAlpha = 0.9;
      for (let i = 0; i < cols; i++) {
        const hi = Math.min(mid, max[i] * scale);
        const lo = Math.max(-mid, min[i] * scale);
        const top = mid - hi;
        const height = Math.max(1, hi - lo);
        ctx2d.fillRect(i * colW, top, Math.max(1, colW), height);
      }

      // Visual silence detection: dim runs where the material is effectively
      // flat for long enough to matter when trimming or comping.
      const minRunCols = Math.max(4, Math.ceil(SILENCE_MIN_SEC * pxPerSec * (cols / w)));
      ctx2d.fillStyle = 'rgba(255,255,255,0.05)';
      let run = 0;
      for (let i = 0; i <= cols; i++) {
        const quiet = i < cols && Math.max(Math.abs(max[i]), Math.abs(min[i])) < SILENCE_LEVEL;
        if (quiet) run++;
        else {
          if (run >= minRunCols) {
            ctx2d.fillRect((i - run) * colW, 2, run * colW, h - 4);
          }
          run = 0;
        }
      }

      // Fade overlays: shaded region + a line tracing the actual curve shape.
      ctx2d.globalAlpha = 1;
      const traceFade = (fw: number, shape: FadeShape | undefined, isIn: boolean) => {
        const steps = 14;
        ctx2d.fillStyle = 'rgba(4, 8, 12, 0.55)';
        ctx2d.beginPath();
        ctx2d.moveTo(isIn ? 0 : w, h);
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const g = fadeGain(t, shape);
          const x = isIn ? t * fw : w - t * fw;
          ctx2d.lineTo(x, h - g * h);
        }
        ctx2d.lineTo(isIn ? fw : w - fw, 0);
        ctx2d.lineTo(isIn ? 0 : w, 0);
        ctx2d.closePath();
        ctx2d.fill();
        ctx2d.strokeStyle = 'rgba(232, 228, 218, 0.65)';
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const g = fadeGain(t, shape);
          const x = isIn ? t * fw : w - t * fw;
          if (k === 0) ctx2d.moveTo(x, h - g * h);
          else ctx2d.lineTo(x, h - g * h);
        }
        ctx2d.stroke();
      };
      if (fadeIn > 0) traceFade(Math.min(w, fadeIn * pxPerSec), fadeInShape, true);
      if (fadeOut > 0) traceFade(Math.min(w, fadeOut * pxPerSec), fadeOutShape, false);
    };

    draw();
    // No per-clip ResizeObserver: with two thousand mounted waveforms the
    // observer registrations alone dominated scroll-mount cost. Clip size only
    // changes when zoom or lane height changes — both arrive as prop/effect
    // re-runs — so one deferred retry (for the first-layout zero-width case)
    // covers everything an observer did.
    let frame = requestAnimationFrame(() => {
      frame = 0;
      if (canvas.offsetWidth !== canvas.width / (Math.min(2, window.devicePixelRatio || 1))) {
        draw();
      }
    });
    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
  }, [peaks, offsetSec, durationSec, color, gain, fadeIn, fadeOut, fadeInShape, fadeOutShape, mediaId, widthPx, heightPx]);

  if (missing) {
    return (
      <div className="clip-missing" data-testid="clip-missing" title="Audio media not found">
        media missing
      </div>
    );
  }
  return <canvas ref={canvasRef} className="clip-wave" />;
}
