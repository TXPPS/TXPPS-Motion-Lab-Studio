import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import { dragHasFiles, importDrop } from '../../app/importActions';
import { zoomToSelection } from '../../app/audioEditActions';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { beatsPerBar, clamp, snapBeat, snapBeatFloor, tempoMapOf } from '../../model/music';
import { beatToSec, beatsPerBarAt, formatClock, sigAtBar } from '../../model/tempo';
import type { ProjectData, Track } from '../../model/types';
import { projectEndBeat, useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { findAutoParam, type AutoParam } from '../../model/paramRegistry';
import type { AutomationLane } from '../../model/automation';
import { Icon } from '../common/Icon';
import { ClipView } from './ClipView';
import { TrackHeader } from './TrackHeader';
import { AUTO_LANE_H, AutoLaneHeader, AutoLaneRow } from './AutomationLanes';
import { TAKE_LANE_H, TakeLaneHeader, TakeLaneRow } from './TakeLanes';
import { visibleTracks, folderDepth } from '../../model/mixerGraph';
import { MaximizeButton } from '../shell/MaximizeButton';
import { GlobalTrackHeaders, GlobalTrackLanes, globalTrackMenuItems } from './GlobalTracks';
import { ArrangementOverview } from './Overview';
import { useWorkspaceStore } from '../../state/workspaceStore';
import type { AudioClip, Clip } from '../../model/types';

/** The offered tools. Range/draw/zoom/hand are deferred until fully usable. */
const TOOLS = [
  { id: 'pointer', label: 'Pointer', icon: 'cursor' },
  { id: 'split', label: 'Split', icon: 'scissors' },
  { id: 'erase', label: 'Erase', icon: 'eraser' },
  { id: 'mute', label: 'Mute', icon: 'speaker-off' },
  { id: 'slip', label: 'Slip (drag audio inside a fixed clip)', icon: 'wave' },
] as const;

const RULER_H = 42;
const LANE_H = 64;
const LANE_H_COLLAPSED = 30;
const EDGE_ZONE = 48;
const EDGE_MAX = 22;

const clampLaneH = (h: number | undefined) => clamp(h ?? AUTO_LANE_H, 26, 120);

/**
 * A track's vertical band: the clip lane plus its expanded automation lanes.
 * Everything that maps Y to a track (marquee rows, cross-track clip drags)
 * uses these totals so the two columns can never disagree.
 */
function bandHeights(tracks: Track[], clips: Clip[]): { clip: number; total: number }[] {
  return tracks.map((t) => {
    const clip = t.collapsed ? LANE_H_COLLAPSED : LANE_H;
    const lanes =
      t.automationOpen && t.automation
        ? t.automation.reduce((a, l) => a + clampLaneH(l.height), 0)
        : 0;
    let takes = 0;
    for (const c of clips) {
      if (c.trackId === t.id && c.type === 'audio' && c.takesOpen && c.takes?.length) {
        takes += c.takes.length * TAKE_LANE_H;
      }
    }
    return { clip, total: clip + lanes + takes };
  });
}

interface LaneEntry {
  lane: AutomationLane;
  param: AutoParam;
  h: number;
}

/** Resolved automation lanes for one track (unresolvable params are hidden). */
function trackLanes(t: Track, project: ProjectData): LaneEntry[] {
  if (!t.automationOpen || !t.automation) return [];
  const out: LaneEntry[] = [];
  for (const lane of t.automation) {
    const param = findAutoParam(t, project, lane.paramId);
    if (param) out.push({ lane, param, h: clampLaneH(lane.height) });
  }
  return out;
}

/**
 * The arrangement owns exactly ONE scroll container (`.arr-viewport`). Inside it
 * a CSS grid places the corner, ruler, track headers and lanes. The ruler is
 * sticky-top and the headers are sticky-left, so both follow the single
 * scrollLeft/scrollTop with no JavaScript synchronisation and no possible drift.
 */
export function Arrangement() {
  const project = useProjectStore((s) => s.project);
  const allTracks = useProjectStore((s) => s.project.tracks);
  /**
   * A folded folder hides its whole subtree. Everything downstream — band
   * heights, lane rows, marquee hit-testing — works off this list, so a folded
   * folder cannot leave a gap where its children used to be.
   */
  const tracks = useMemo(() => visibleTracks(allTracks), [allTracks]);
  const clips = useProjectStore((s) => s.project.clips);
  const loop = useProjectStore((s) => s.project.loop);
  const timeSig = useProjectStore((s) => s.project.timeSig);
  const endBeat = useProjectStore((s) => projectEndBeat(s.project));
  const pxPerBeat = useUiStore((s) => s.pxPerBeat);
  const snap = useUiStore((s) => s.snap);
  const selectedTrackId = useUiStore((s) => s.selectedTrackId);
  const tool = useUiStore((s) => s.tool);

  /** Lane currently under a file drag, for the drop affordance. */
  const [dropLane, setDropLane] = useState<string | null>(null);
  /**
   * Visible window of the lanes area in content px, with one viewport of
   * overscan on each side. Clips outside it are not mounted at all — at a
   * thousand clips, painting every canvas made a scroll frame cost ~200ms.
   * Quantised to 200px steps so scrolling only re-renders when the window
   * actually moves a meaningful amount.
   */
  const [viewWin, setViewWin] = useState({ left: 0, right: 4000, top: 0, bottom: 3000 });
  /** Scroll metrics the overview needs to draw its viewport window. */
  const [scrollX, setScrollX] = useState({ left: 0, width: 0 });
  const winFrame = useRef(0);

  const updateViewWin = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const headerW = (vp.querySelector('.arr-header-col') as HTMLElement | null)?.clientWidth ?? 0;
    const vw = vp.clientWidth - headerW;
    const vh = vp.clientHeight;
    const q = (n: number) => Math.floor(n / 200) * 200;
    const next = {
      left: q(Math.max(0, vp.scrollLeft - vw)),
      right: q(vp.scrollLeft + vw * 2) + 200,
      top: q(Math.max(0, vp.scrollTop - vh)),
      bottom: q(vp.scrollTop + vh * 2) + 200,
    };
    setScrollX((cur) =>
      Math.abs(cur.left - vp.scrollLeft) < 1 && cur.width === vw
        ? cur
        : { left: vp.scrollLeft, width: vw },
    );
    setViewWin((cur) =>
      cur.left === next.left &&
      cur.right === next.right &&
      cur.top === next.top &&
      cur.bottom === next.bottom
        ? cur
        : next,
    );
  }, []);

  useEffect(() => {
    updateViewWin();
    const vp = viewportRef.current;
    if (!vp) return;
    const ro = new ResizeObserver(() => {
      if (winFrame.current) return;
      winFrame.current = requestAnimationFrame(() => {
        winFrame.current = 0;
        updateViewWin();
      });
    });
    ro.observe(vp);
    return () => {
      if (winFrame.current) cancelAnimationFrame(winFrame.current);
      ro.disconnect();
    };
  }, [updateViewWin]);
  /** Marquee rectangle in lanes-local px, while a rubber-band drag is live. */
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );

  const viewportRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const rulerHeadRef = useRef<HTMLDivElement>(null);
  const rulerCanvasRef = useRef<HTMLCanvasElement>(null);

  const bpb = beatsPerBar(timeSig);
  // Always span at least 72 bars so there is real horizontal range to scroll.
  const contentBeats = Math.max(endBeat + bpb * 4, loop.end + bpb, bpb * 72);
  const timelineW = Math.ceil(contentBeats * pxPerBeat);
  const bands = useMemo(() => bandHeights(tracks, clips), [tracks, clips]);
  const heights = useMemo(() => bands.map((b) => b.total), [bands]);
  /** Resolved automation lanes per track (only for expanded tracks). */
  const lanesByTrack = useMemo(() => tracks.map((t) => trackLanes(t, project)), [tracks, project]);
  /** Open take clips per track, in ONE pass — never filter per track. */
  const takeClipsByTrack = useMemo(() => {
    const m = new Map<string, AudioClip[]>();
    for (const c of clips) {
      if (c.type === 'audio' && c.takesOpen && c.takes?.length) {
        const list = m.get(c.trackId) ?? [];
        list.push(c);
        m.set(c.trackId, list);
      }
    }
    for (const list of m.values()) list.sort((a, b) => a.start - b.start);
    return m;
  }, [clips]);
  /** Cumulative band tops, for the vertical half of the render window. */
  const laneTops = useMemo(() => {
    const tops: number[] = [];
    let y = 0;
    for (const h of heights) {
      tops.push(y);
      y += h;
    }
    return tops;
  }, [heights]);
  const selectedClipIds = useUiStore((s) => s.selectedClipIds);

  /**
   * Visible clips grouped by track, computed in ONE pass over the clip list.
   * Filtering inside each lane's render was O(tracks × clips) — 100k predicate
   * calls per render at the huge fixture — and this map is what made the
   * difference between ~95ms and ~15ms window updates there.
   *
   * Selected clips always mount: a drag that edge-scrolls must never unmount
   * the element holding the pointer capture.
   */
  const visibleByTrack = useMemo(() => {
    const sel = new Set(selectedClipIds);
    const trackIndex = new Map(tracks.map((t, i) => [t.id, i]));
    const byTrack = new Map<string, typeof clips>();
    for (const c of clips) {
      const ti = trackIndex.get(c.trackId);
      if (ti === undefined) continue;
      if (!sel.has(c.id)) {
        const laneTop = laneTops[ti];
        if (laneTop > viewWin.bottom || laneTop + heights[ti] < viewWin.top) continue;
        const x0 = c.start * pxPerBeat;
        const x1 = (c.start + c.length) * pxPerBeat;
        if (x0 >= viewWin.right || x1 <= viewWin.left) continue;
      }
      const list = byTrack.get(c.trackId);
      if (list) list.push(c);
      else byTrack.set(c.trackId, [c]);
    }
    return byTrack;
  }, [clips, tracks, laneTops, heights, viewWin, pxPerBeat, selectedClipIds]);

  // One rAF subscription drives the lane playhead, the ruler marker, and follow.
  useEffect(() => {
    return engine.onFrame(() => {
      const vp = viewportRef.current;
      if (!vp) return;
      const x = engine.getPositionBeats() * pxPerBeat;
      if (playheadRef.current) playheadRef.current.style.transform = `translateX(${x}px)`;
      if (rulerHeadRef.current) rulerHeadRef.current.style.transform = `translateX(${x}px)`;
      if (engine.isPlaying()) {
        const headerW =
          (vp.querySelector('.arr-header-col') as HTMLElement | null)?.clientWidth ?? 0;
        const viewLeft = vp.scrollLeft;
        const viewRight = viewLeft + vp.clientWidth - headerW;
        if (x < viewLeft || x > viewRight - 40) vp.scrollLeft = Math.max(0, x - 80);
      }
    });
  }, [pxPerBeat]);

  /**
   * Ruler: a wall-clock row above a bars-and-beats row.
   *
   * Bar positions come from the signature map, not from one constant, so a
   * 2/4 bar before the chorus shifts every bar number after it — exactly as it
   * shifts every clip. Label density adapts to zoom so numbers never collide.
   */
  useEffect(() => {
    const canvas = rulerCanvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = timelineW * dpr;
    canvas.height = RULER_H * dpr;
    canvas.style.width = `${timelineW}px`;
    canvas.style.height = `${RULER_H}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, timelineW, RULER_H);
    const css = getComputedStyle(canvas);
    const font = css.fontFamily || 'system-ui, sans-serif';
    const dim = css.getPropertyValue('--text-faint').trim() || 'rgba(232,228,218,0.55)';
    const bright = css.getPropertyValue('--text-dim').trim() || 'rgba(232,228,218,0.8)';
    const tick = css.getPropertyValue('--grid-bar').trim() || 'rgba(255,255,255,0.3)';
    const subtick = css.getPropertyValue('--grid-beat').trim() || 'rgba(255,255,255,0.12)';

    const TIME_H = 15;
    ctx.strokeStyle = subtick;
    ctx.beginPath();
    ctx.moveTo(0, TIME_H + 0.5);
    ctx.lineTo(timelineW, TIME_H + 0.5);
    ctx.stroke();

    // --- wall-clock row: a label every 1, 5, 15, 30 or 60 seconds, whichever
    // keeps them at least 54px apart at this zoom.
    const map = tempoMapOf(project);
    const totalSec = beatToSec(map, contentBeats);
    if (totalSec > 0) {
      const pxPerSec = timelineW / totalSec;
      const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300];
      const step = steps.find((sv) => sv * pxPerSec >= 54) ?? 600;
      ctx.font = `10px ${font}`;
      ctx.fillStyle = dim;
      ctx.strokeStyle = subtick;
      for (let sec = 0; sec <= totalSec; sec += step) {
        const x = Math.round(sec * pxPerSec) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 4);
        ctx.lineTo(x, TIME_H);
        ctx.stroke();
        ctx.fillText(formatClock(sec, false), x + 3, 11);
      }
    }

    // --- bars and beats row, walked bar by bar through the signature map.
    ctx.font = `600 10px ${font}`;
    let beat = 0;
    let bar = 0;
    let lastLabelX = -Infinity;
    let guard = 0;
    while (beat <= contentBeats && guard++ < 20000) {
      const x = beat * pxPerBeat + 0.5;
      const sig = sigAtBar(map, bar);
      const barBeatCount = beatsPerBarAt(map, beat);
      ctx.strokeStyle = tick;
      ctx.beginPath();
      ctx.moveTo(x, TIME_H + 4);
      ctx.lineTo(x, RULER_H);
      ctx.stroke();
      // Only label a bar if the previous label has cleared out of its way.
      if (x - lastLabelX >= 26) {
        ctx.fillStyle = bright;
        ctx.fillText(String(bar + 1), x + 3, RULER_H - 12);
        lastLabelX = x;
      }
      // A signature change is announced on the bar it takes effect.
      if (sig.bar === bar && bar > 0) {
        ctx.fillStyle = css.getPropertyValue('--warm').trim() || '#d9a13c';
        ctx.fillText(`${sig.num}/${sig.den}`, x + 3, RULER_H - 2);
      }
      if (pxPerBeat >= 14) {
        const unit = 4 / sig.den;
        for (let b = unit; b < barBeatCount - 1e-9; b += unit) {
          const bx = (beat + b) * pxPerBeat + 0.5;
          ctx.strokeStyle = subtick;
          ctx.beginPath();
          ctx.moveTo(bx, RULER_H - 7);
          ctx.lineTo(bx, RULER_H);
          ctx.stroke();
        }
      }
      beat += barBeatCount;
      bar++;
    }
  }, [timelineW, contentBeats, pxPerBeat, project]);

  // Lane grid: repeating CSS gradients instead of one full-content canvas.
  // A canvas spanning the whole timeline is a width×height bitmap — at the
  // 100-track fixture that is a ~5300×5900px surface whose repaints alone made
  // scrolling cost >170ms a frame. A repeating gradient is resolution-free and
  // composites on the GPU at any content size.
  const gridStyle = useMemo(() => {
    const barPx = bpb * pxPerBeat;
    const layers = [
      `repeating-linear-gradient(90deg, rgba(255,255,255,0.075) 0 1px, transparent 1px ${barPx}px)`,
    ];
    if (pxPerBeat >= 14) {
      layers.push(
        `repeating-linear-gradient(90deg, rgba(255,255,255,0.03) 0 1px, transparent 1px ${pxPerBeat}px)`,
      );
    }
    return { backgroundImage: layers.join(', ') } as const;
  }, [bpb, pxPerBeat]);

  const headerWidth = () =>
    (viewportRef.current?.querySelector('.arr-header-col') as HTMLElement | null)?.clientWidth ?? 0;

  /** Zoom, keeping the beat under the anchor (pointer or viewport centre) fixed. */
  const zoomBy = useCallback((factor: number, anchorClientX?: number) => {
    const vp = viewportRef.current;
    const ui = useUiStore.getState();
    const prev = ui.pxPerBeat;
    const next = clamp(Math.round(prev * factor * 10) / 10, 6, 120);
    if (!vp || next === prev) {
      ui.set({ pxPerBeat: next });
      return;
    }
    const headerW = (vp.querySelector('.arr-header-col') as HTMLElement | null)?.clientWidth ?? 0;
    const rect = vp.getBoundingClientRect();
    const offsetInView =
      anchorClientX !== undefined
        ? anchorClientX - rect.left - headerW
        : (vp.clientWidth - headerW) / 2;
    const anchorBeat = (vp.scrollLeft + offsetInView) / prev;
    ui.set({ pxPerBeat: next });
    requestAnimationFrame(() => {
      vp.scrollLeft = Math.max(0, anchorBeat * next - offsetInView);
    });
  }, []);

  // Wheel: vertical by default, horizontal with shift, zoom with ctrl/cmd.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomBy(e.deltaY > 0 ? 0.88 : 1.14, e.clientX);
        return;
      }
      if (e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
        e.preventDefault();
        vp.scrollLeft += e.deltaY;
      }
      // plain wheel + trackpad two-axis deltas fall through to native scrolling
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  /** Which track lane sits under a client Y coordinate (for cross-track drags). */
  /**
   * Marquee (rubber-band) selection on empty lane space. Mouse-only: on touch,
   * a drag on empty space must stay a scroll, and the two cannot coexist on
   * one gesture. Clip drags stop propagation, so anything reaching the lanes
   * container started on empty space.
   */
  const dragMarquee = usePointerDrag<{
    x: number;
    y: number;
    /** selection to add to when Shift is held, else empty */
    base: string[];
  }>({
    onStart: (e) => {
      const lanes = viewportRef.current?.querySelector('.arr-lanes');
      const rect = lanes?.getBoundingClientRect();
      const additive = e.shiftKey;
      const base = additive ? [...useUiStore.getState().selectedClipIds] : [];
      if (!additive) useUiStore.getState().selectClips([]);
      const x = rect ? e.clientX - rect.left : 0;
      const y = rect ? e.clientY - rect.top : 0;
      return { x, y, base };
    },
    onMove: (_dx, _dy, e, d) => {
      const lanes = viewportRef.current?.querySelector('.arr-lanes');
      const rect = lanes?.getBoundingClientRect();
      if (!rect) return;
      // Content-local coordinates survive scrolling because the lanes box
      // itself moves with the scroll; recompute against a fresh rect each move.
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const x0 = Math.min(d.x, cx);
      const x1 = Math.max(d.x, cx);
      const y0 = Math.min(d.y, cy);
      const y1 = Math.max(d.y, cy);
      setMarquee({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });

      const beat0 = x0 / pxPerBeat;
      const beat1 = x1 / pxPerBeat;
      // Track rows the rectangle vertically covers.
      const rows = new Set<string>();
      let top = 0;
      for (let i = 0; i < tracks.length; i++) {
        const bottom = top + heights[i];
        if (bottom > y0 && top < y1) rows.add(tracks[i].id);
        top = bottom;
      }
      const hits = clips
        .filter((c) => rows.has(c.trackId) && c.start < beat1 && c.start + c.length > beat0)
        .map((c) => c.id);
      useUiStore.getState().selectClips([...new Set([...d.base, ...hits])]);
      edgeScroll(e.clientX, e.clientY);
    },
    onEnd: () => setMarquee(null),
  });

  const laneAt = useCallback((clientY: number): Track | null => {
    const lanes = viewportRef.current?.querySelector('.arr-lanes');
    if (!lanes) return null;
    const rect = lanes.getBoundingClientRect();
    const y = clientY - rect.top;
    const proj = useProjectStore.getState().project;
    const ts = proj.tracks;
    const hs = bandHeights(ts, proj.clips);
    let acc = 0;
    for (let i = 0; i < ts.length; i++) {
      if (y >= acc && y < acc + hs[i].total) return ts[i];
      acc += hs[i].total;
    }
    return null;
  }, []);

  /** Auto-scroll while a clip drag approaches a viewport edge. */
  const edgeScroll = useCallback((clientX: number, clientY: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    const hw = headerWidth();
    let dx = 0;
    let dy = 0;
    if (clientX > r.right - EDGE_ZONE)
      dx = ((clientX - (r.right - EDGE_ZONE)) / EDGE_ZONE) * EDGE_MAX;
    else if (clientX < r.left + hw + EDGE_ZONE)
      dx = -((r.left + hw + EDGE_ZONE - clientX) / EDGE_ZONE) * EDGE_MAX;
    if (clientY > r.bottom - EDGE_ZONE)
      dy = ((clientY - (r.bottom - EDGE_ZONE)) / EDGE_ZONE) * EDGE_MAX;
    else if (clientY < r.top + RULER_H + EDGE_ZONE)
      dy = -((r.top + RULER_H + EDGE_ZONE - clientY) / EDGE_ZONE) * EDGE_MAX;
    if (dx) vp.scrollLeft += clamp(dx, -EDGE_MAX, EDGE_MAX);
    if (dy) vp.scrollTop += clamp(dy, -EDGE_MAX, EDGE_MAX);
  }, []);

  /** Ruler: lower half seeks/scrubs, upper half drags the loop region. */
  const rulerPointer = useCallback(
    (e: React.PointerEvent) => {
      const el = e.currentTarget as HTMLElement;
      const rect = el.getBoundingClientRect();
      const isLoopZone = e.clientY - rect.top < RULER_H / 2;
      const beatAt = (cx: number) => Math.max(0, (cx - rect.left) / pxPerBeat);
      const pid = e.pointerId;
      try {
        el.setPointerCapture(pid);
      } catch {
        /* capture unavailable */
      }
      const startBeat = snapBeatFloor(beatAt(e.clientX), isLoopZone ? 1 : snap);
      if (isLoopZone) {
        useProjectStore.getState().setLoop({ start: startBeat, end: startBeat + 1, enabled: true });
      } else {
        engine.seek(snapBeat(beatAt(e.clientX), snap));
      }
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        if (isLoopZone) {
          const b = Math.max(startBeat + 1, Math.ceil(beatAt(ev.clientX)));
          useProjectStore.getState().setLoop({ start: startBeat, end: snapBeat(b, 1) });
        } else {
          engine.seek(snapBeat(beatAt(ev.clientX), snap));
        }
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    },
    [pxPerBeat, snap],
  );

  const addTrackMenu = (x: number, y: number) => {
    const store = useProjectStore.getState();
    const ui = useUiStore.getState();
    const addInstrument = (kind?: 'quick' | 'drum' | 'multi') => {
      const id = store.addTrack('instrument');
      if (kind) store.setInstrument(id, kind);
      ui.selectTrack(id);
      if (kind) ui.set({ editorTab: 'synth' });
    };
    ui.showMenu({
      x,
      y,
      items: [
        { label: 'Audio Track', action: () => ui.selectTrack(store.addTrack('audio')) },
        { label: 'Instrument Track', action: () => addInstrument() },
        { label: 'Quick Sampler Track', action: () => addInstrument('quick') },
        { label: 'Drum Rack Track', action: () => addInstrument('drum') },
        { label: 'Multisample Track', action: () => addInstrument('multi') },
        { label: 'Drum Track (classic kit)', action: () => ui.selectTrack(store.addTrack('drum')) },
        { label: 'Bus', action: () => ui.selectTrack(store.addTrack('bus')) },
        { label: 'FX Channel (send target)', action: () => ui.selectTrack(store.addTrack('fx')) },
        { label: 'VCA Fader', action: () => ui.selectTrack(store.addVca()) },
        {
          label: 'Folder from selection',
          disabled: selectedTrackId === null,
          action: () => {
            const id = store.groupTracks(selectedTrackId ? [selectedTrackId] : []);
            if (id) ui.selectTrack(id);
          },
        },
      ],
    });
  };

  const showOverview = useWorkspaceStore((w) => w.showOverview);
  /**
   * The overview maps the SONG, not the scrollable canvas. The timeline keeps a
   * 72-bar minimum so there is always somewhere to scroll to; drawing that
   * minimum here would squeeze an eight-bar sketch into a ninth of the strip.
   */
  const overviewBeats = Math.max(endBeat, loop.end, bpb * 8) * 1.04;
  const setSnap = (v: number) => useUiStore.getState().set({ snap: v });
  const loopStyle = {
    left: loop.start * pxPerBeat,
    width: Math.max(2, (loop.end - loop.start) * pxPerBeat),
  };

  return (
    <div className="arr" data-testid="arrangement" data-tool={tool}>
      <div className="arr-toolbar">
        <button
          className="btn"
          onClick={(e) => addTrackMenu(e.clientX, e.clientY)}
          data-testid="add-track"
        >
          <Icon name="plus" size={13} /> Track
        </button>
        <div className="seg" role="group" aria-label="Editing tool">
          {TOOLS.map((t, i) => (
            <button
              key={t.id}
              className={tool === t.id ? 'on' : ''}
              aria-pressed={tool === t.id}
              title={`${t.label} (${i + 1})`}
              aria-label={`${t.label} tool`}
              data-testid={`tool-${t.id}`}
              onClick={() => useUiStore.getState().set({ tool: t.id })}
            >
              <Icon name={t.icon} size={13} />
            </button>
          ))}
        </div>
        <span className="hint">Snap</span>
        <div className="seg" role="group" aria-label="Snap">
          {[
            { v: bpb, l: 'Bar' },
            { v: 1, l: '1/4' },
            { v: 0.5, l: '1/8' },
            { v: 0.25, l: '1/16' },
            { v: 0, l: 'Off' },
          ].map((o) => (
            <button
              key={o.l}
              className={Math.abs(snap - o.v) < 1e-9 ? 'on' : ''}
              aria-pressed={Math.abs(snap - o.v) < 1e-9}
              onClick={() => setSnap(o.v)}
            >
              {o.l}
            </button>
          ))}
        </div>
        <span className="spacer" style={{ flex: '1 1 auto' }} />
        <button
          className="icon-btn"
          onClick={(e) =>
            useUiStore.getState().showMenu({
              x: e.clientX,
              y: e.clientY,
              items: globalTrackMenuItems(),
            })
          }
          title="Show or hide the marker, arranger, chord and tempo tracks"
          aria-label="Global tracks"
          data-testid="global-tracks-menu"
        >
          <Icon name="section" size={14} />
        </button>
        <button
          className={`icon-btn${showOverview ? ' on' : ''}`}
          onClick={() => useWorkspaceStore.getState().toggle('showOverview')}
          title="Arrangement overview"
          aria-label="Arrangement overview"
          aria-pressed={showOverview}
          data-testid="toggle-overview"
        >
          <Icon name="layers" size={14} />
        </button>
        <button
          className="icon-btn"
          onClick={() => zoomToSelection()}
          title="Zoom to the selected clips"
          aria-label="Zoom to selection"
          data-testid="zoom-selection"
        >
          <Icon name="maximize" size={14} />
        </button>
        <button
          className="icon-btn"
          onClick={() => zoomBy(0.8)}
          title="Zoom out (Ctrl + wheel)"
          aria-label="Zoom out"
        >
          <Icon name="zoom-out" size={14} />
        </button>
        <button
          className="icon-btn"
          onClick={() => zoomBy(1.25)}
          title="Zoom in (Ctrl + wheel)"
          aria-label="Zoom in"
        >
          <Icon name="zoom-in" size={14} />
        </button>
        <MaximizeButton pane="arrange" label="arrangement" />
      </div>

      {showOverview && (
        <ArrangementOverview
          project={project}
          contentBeats={overviewBeats}
          scrollLeft={scrollX.left}
          viewportW={scrollX.width}
          pxPerBeat={pxPerBeat}
          onScrollTo={(beat) => {
            const vp = viewportRef.current;
            if (vp) vp.scrollLeft = Math.max(0, beat * pxPerBeat);
          }}
        />
      )}

      <div
        className="arr-viewport"
        ref={viewportRef}
        data-testid="arr-scroll"
        onScroll={() => {
          // rAF-coalesced: one window recalculation per frame at most.
          if (winFrame.current) return;
          winFrame.current = requestAnimationFrame(() => {
            winFrame.current = 0;
            updateViewWin();
          });
        }}
      >
        <div className="arr-content">
          <div className="arr-header-col" data-testid="track-headers">
            {/* Corner and the global-track headers stick together so they stay
                aligned with the ruler stack opposite them. */}
            <div className="arr-corner-stack">
              <div className="arr-corner">Tracks</div>
              <GlobalTrackHeaders />
            </div>
            {tracks.map((t, i) => (
              <Fragment key={t.id}>
                <TrackHeader track={t} height={bands[i].clip} depth={folderDepth(allTracks, t)} />
                {lanesByTrack[i].map((le) => (
                  <AutoLaneHeader
                    key={le.lane.id}
                    track={t}
                    lane={le.lane}
                    param={le.param}
                    height={le.h}
                  />
                ))}
                {(takeClipsByTrack.get(t.id) ?? []).map((tc) =>
                  tc.takes!.map((take, ti) => (
                    <TakeLaneHeader key={take.id} clip={tc} take={take} index={ti} track={t} />
                  )),
                )}
              </Fragment>
            ))}
            <div className="add-track">
              <button className="btn" onClick={(e) => addTrackMenu(e.clientX, e.clientY)}>
                <Icon name="plus" size={13} /> Add Track
              </button>
            </div>
          </div>

          <div className="arr-timeline-col" style={{ width: timelineW }}>
            <div className="arr-top">
              <div
                className="arr-ruler"
                onPointerDown={rulerPointer}
                data-testid="ruler"
                title="Click to set position · drag the upper edge to set the loop"
              >
                <canvas ref={rulerCanvasRef} />
                <div
                  className={`arr-loop${loop.enabled ? '' : ' off'}`}
                  style={loopStyle}
                  data-testid="loop-region"
                />
                <div ref={rulerHeadRef} className="ruler-playhead" />
              </div>
              <GlobalTrackLanes
                pxPerBeat={pxPerBeat}
                snap={snap}
                timelineW={timelineW}
                project={project}
              />
            </div>

            <div
              className="arr-lanes"
              data-testid="arr-lanes"
              onPointerDown={(e) => {
                // Mouse only — see dragMarquee. Not invoking the hook for touch
                // keeps native scroll untouched.
                if (e.pointerType === 'mouse' && e.button === 0) dragMarquee(e);
              }}
            >
              <div className="arr-grid-canvas" style={gridStyle} />
              {tracks.map((t, i) => (
                <Fragment key={t.id}>
                  <div
                    className={`arr-lane${selectedTrackId === t.id ? ' selected' : ''}${
                      dropLane === t.id ? ' drop-target' : ''
                    }`}
                    style={{ height: bands[i].clip }}
                    data-testid={`lane-${t.name}`}
                    onPointerDown={() => useUiStore.getState().selectTrack(t.id)}
                    onDragOver={(e) => {
                      // Only audio tracks can hold a file; anything else keeps the
                      // default "no drop" cursor rather than accepting and failing.
                      if (t.type !== 'audio' || !dragHasFiles(e.dataTransfer)) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                      setDropLane(t.id);
                    }}
                    onDragLeave={() => setDropLane((cur) => (cur === t.id ? null : cur))}
                    onDrop={(e) => {
                      if (t.type !== 'audio' || !dragHasFiles(e.dataTransfer)) return;
                      e.preventDefault();
                      setDropLane(null);
                      const lanes = viewportRef.current?.querySelector('.arr-lanes');
                      if (!lanes) return;
                      const rect = lanes.getBoundingClientRect();
                      const beat = snapBeatFloor(
                        (e.clientX - rect.left) / pxPerBeat,
                        Math.max(snap, 1),
                      );
                      useUiStore.getState().selectTrack(t.id);
                      importDrop(e.dataTransfer, { trackId: t.id, startBeat: beat });
                    }}
                    onDoubleClick={(e) => {
                      if (t.type !== 'instrument' && t.type !== 'drum') return;
                      const lanes = viewportRef.current?.querySelector('.arr-lanes');
                      if (!lanes) return;
                      const rect = lanes.getBoundingClientRect();
                      const beat = snapBeatFloor(
                        (e.clientX - rect.left) / pxPerBeat,
                        Math.max(snap, 1),
                      );
                      const id = useProjectStore.getState().addMidiClip(t.id, beat, bpb);
                      useUiStore.getState().selectClip(id, t.id);
                    }}
                  >
                    {(visibleByTrack.get(t.id) ?? []).map((c) => (
                      <ClipView
                        key={c.id}
                        clip={c}
                        track={t}
                        laneHeight={bands[i].clip}
                        pxPerBeat={pxPerBeat}
                        laneAt={laneAt}
                        onEdgeScroll={edgeScroll}
                      />
                    ))}
                  </div>
                  {(takeClipsByTrack.get(t.id) ?? []).map((tc) =>
                    tc.takes!.map((take, ti) => (
                      <TakeLaneRow
                        key={take.id}
                        clip={tc}
                        take={take}
                        index={ti}
                        pxPerBeat={pxPerBeat}
                        snap={snap}
                      />
                    )),
                  )}
                  {lanesByTrack[i].length > 0 &&
                    (laneTops[i] > viewWin.bottom || laneTops[i] + heights[i] < viewWin.top ? (
                      // Off-window: hold the band's height without mounting rows.
                      <div style={{ height: heights[i] - bands[i].clip }} />
                    ) : (
                      lanesByTrack[i].map((le) => (
                        <AutoLaneRow
                          key={le.lane.id}
                          track={t}
                          lane={le.lane}
                          param={le.param}
                          height={le.h}
                          pxPerBeat={pxPerBeat}
                          winLeft={viewWin.left}
                          winRight={viewWin.right}
                          timelineW={timelineW}
                          snap={snap}
                        />
                      ))
                    ))}
                </Fragment>
              ))}
              {marquee && (
                <div
                  className="arr-marquee"
                  data-testid="marquee"
                  style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
                />
              )}
              <div ref={playheadRef} className="arr-playhead" data-testid="playhead" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
