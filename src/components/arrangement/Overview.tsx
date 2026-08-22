/**
 * Arrangement Overview — the bird's-eye navigator above the timeline.
 *
 * At working zoom a real session is many screens wide, and scrolling to find
 * the second chorus means losing your place. The overview draws the whole song
 * in one strip: every clip as a coloured tick on its track's row, the arranger
 * sections as a name band, markers as flags, and the visible timeline as a
 * draggable window.
 *
 * It is a canvas rather than DOM because it redraws whenever anything moves and
 * a 50,000-clip project would otherwise mount 50,000 nodes for a 40px-tall
 * strip. The whole draw is one pass over the clip list with no per-track
 * filtering.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { clamp } from '../../model/music';
import { visibleTracks } from '../../model/mixerGraph';
import type { ProjectData } from '../../model/types';

export const OVERVIEW_H = 46;

interface OverviewProps {
  project: ProjectData;
  /** Total song length in beats, matching the timeline's own content width. */
  contentBeats: number;
  /** Scroll position and width of the timeline viewport, in pixels. */
  scrollLeft: number;
  viewportW: number;
  pxPerBeat: number;
  /** Scroll the timeline so `beat` is at the left edge of the view. */
  onScrollTo: (beat: number) => void;
}

export const ArrangementOverview = memo(function ArrangementOverview({
  project,
  contentBeats,
  scrollLeft,
  viewportW,
  pxPerBeat,
  onScrollTo,
}: OverviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  const tracks = useMemo(() => visibleTracks(project.tracks), [project.tracks]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const scale = width > 0 && contentBeats > 0 ? width / contentBeats : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.floor(OVERVIEW_H * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${OVERVIEW_H}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, OVERVIEW_H);

    const styles = getComputedStyle(canvas);
    const sectionBandH = 11;
    const clipTop = sectionBandH + 1;
    const clipArea = OVERVIEW_H - clipTop;
    const rowH = tracks.length > 0 ? clipArea / tracks.length : clipArea;
    const rowIndex = new Map(tracks.map((t, i) => [t.id, i]));
    const colorOf = new Map(tracks.map((t) => [t.id, t.color]));

    // Section band first: it is the map legend the eye reads before the clips.
    for (const sec of project.sections ?? []) {
      const x = sec.start * scale;
      const w = Math.max(1, sec.length * scale);
      ctx.fillStyle = sec.color;
      ctx.globalAlpha = 0.42;
      ctx.fillRect(x, 0, w, sectionBandH);
      ctx.globalAlpha = 1;
      if (w > 26) {
        ctx.fillStyle = styles.getPropertyValue('--ov-text') || '#e9e6dd';
        ctx.font = `600 8px ${styles.fontFamily || 'system-ui'}`;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 2, 0, w - 4, sectionBandH);
        ctx.clip();
        ctx.fillText(sec.name, x + 3, sectionBandH - 3);
        ctx.restore();
      }
    }

    // One pass over every clip. A tick is at least a pixel wide so a short clip
    // in a long song is still visible — the overview is a map, not a render.
    const h = Math.max(1, rowH - 0.5);
    for (const clip of project.clips) {
      const row = rowIndex.get(clip.trackId);
      if (row === undefined) continue;
      ctx.fillStyle = clip.color ?? colorOf.get(clip.trackId) ?? '#37b89a';
      ctx.globalAlpha = clip.muted ? 0.25 : 0.85;
      ctx.fillRect(clip.start * scale, clipTop + row * rowH, Math.max(1, clip.length * scale), h);
    }
    ctx.globalAlpha = 1;

    for (const m of project.markers ?? []) {
      const x = Math.round(m.beat * scale) + 0.5;
      ctx.strokeStyle = m.color ?? '#d9a13c';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, OVERVIEW_H);
      ctx.stroke();
    }
  }, [project, tracks, width, scale, contentBeats]);

  // The playhead is redrawn on the audio frame, not on React state, so a
  // playing session does not re-render this component 60 times a second.
  useEffect(() => {
    if (scale <= 0) return;
    return engine.onFrame(() => {
      const el = headRef.current;
      if (el) el.style.transform = `translateX(${engine.getPositionBeats() * scale}px)`;
    });
  }, [scale]);

  const viewLeft = pxPerBeat > 0 ? (scrollLeft / pxPerBeat) * scale : 0;
  const viewW = pxPerBeat > 0 ? Math.max(6, (viewportW / pxPerBeat) * scale) : 0;

  const jump = useCallback(
    (clientX: number) => {
      const el = wrapRef.current;
      if (!el || scale <= 0) return;
      const rect = el.getBoundingClientRect();
      const beat = (clientX - rect.left) / scale;
      onScrollTo(Math.max(0, beat - viewportW / pxPerBeat / 2));
    },
    [scale, onScrollTo, viewportW, pxPerBeat],
  );

  const dragWindow = usePointerDrag<{ startBeat: number }>({
    onStart: () => ({ startBeat: scrollLeft / pxPerBeat }),
    onMove: (dx, _dy, _e, s) => {
      if (scale <= 0) return;
      onScrollTo(clamp(s.startBeat + dx / scale, 0, Math.max(0, contentBeats)));
    },
  });

  return (
    <div
      ref={wrapRef}
      className="arr-overview"
      style={{ height: OVERVIEW_H }}
      data-testid="arrangement-overview"
      onPointerDown={(e) => {
        // A click anywhere but the window itself recentres the view there.
        if ((e.target as HTMLElement).classList.contains('ov-window')) return;
        jump(e.clientX);
      }}
      title="Arrangement overview — click to jump, drag the window to scroll"
    >
      <canvas ref={canvasRef} aria-hidden />
      <div ref={headRef} className="ov-playhead" aria-hidden />
      <div
        className="ov-window"
        style={{ left: viewLeft, width: viewW }}
        onPointerDown={dragWindow}
        data-testid="overview-window"
      />
    </div>
  );
});
