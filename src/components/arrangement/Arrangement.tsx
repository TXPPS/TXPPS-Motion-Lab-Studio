import { useCallback, useEffect, useMemo, useRef } from 'react';
import { engine } from '../../audio/engine';
import { beatsPerBar, clamp, snapBeat, snapBeatFloor } from '../../model/music';
import type { Track } from '../../model/types';
import { projectEndBeat, useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';
import { ClipView } from './ClipView';
import { TrackHeader } from './TrackHeader';

const RULER_H = 30;
const LANE_H = 64;
const LANE_H_COLLAPSED = 30;
const EDGE_ZONE = 48;
const EDGE_MAX = 22;

function laneHeights(tracks: Track[]): { heights: number[]; total: number } {
  const heights = tracks.map((t) => (t.collapsed ? LANE_H_COLLAPSED : LANE_H));
  return { heights, total: heights.reduce((a, b) => a + b, 0) };
}

/**
 * The arrangement owns exactly ONE scroll container (`.arr-viewport`). Inside it
 * a CSS grid places the corner, ruler, track headers and lanes. The ruler is
 * sticky-top and the headers are sticky-left, so both follow the single
 * scrollLeft/scrollTop with no JavaScript synchronisation and no possible drift.
 */
export function Arrangement() {
  const tracks = useProjectStore((s) => s.project.tracks);
  const clips = useProjectStore((s) => s.project.clips);
  const loop = useProjectStore((s) => s.project.loop);
  const timeSig = useProjectStore((s) => s.project.timeSig);
  const endBeat = useProjectStore((s) => projectEndBeat(s.project));
  const pxPerBeat = useUiStore((s) => s.pxPerBeat);
  const snap = useUiStore((s) => s.snap);
  const selectedTrackId = useUiStore((s) => s.selectedTrackId);

  const viewportRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const rulerHeadRef = useRef<HTMLDivElement>(null);
  const rulerCanvasRef = useRef<HTMLCanvasElement>(null);
  const gridCanvasRef = useRef<HTMLCanvasElement>(null);

  const bpb = beatsPerBar(timeSig);
  // Always span at least 72 bars so there is real horizontal range to scroll.
  const contentBeats = Math.max(endBeat + bpb * 4, loop.end + bpb, bpb * 72);
  const timelineW = Math.ceil(contentBeats * pxPerBeat);
  const { heights, total } = useMemo(() => laneHeights(tracks), [tracks]);

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

  // Ruler bars/beats
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
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, timelineW, RULER_H);
    ctx.font = '9.5px system-ui, sans-serif';
    const bars = Math.ceil(contentBeats / bpb);
    const barPx = bpb * pxPerBeat;
    // Label density adapts to zoom so bar numbers never collide.
    const labelEvery = barPx >= 46 ? 1 : barPx >= 24 ? 2 : barPx >= 12 ? 4 : 8;
    for (let bar = 0; bar <= bars; bar++) {
      const x = bar * barPx + 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.moveTo(x, RULER_H - 12);
      ctx.lineTo(x, RULER_H);
      ctx.stroke();
      if (bar % labelEvery === 0) {
        ctx.fillStyle = 'rgba(232,228,218,0.66)';
        ctx.fillText(String(bar + 1), x + 3, RULER_H - 15);
      }
      if (pxPerBeat >= 14) {
        for (let b = 1; b < bpb; b++) {
          const bx = bar * barPx + b * pxPerBeat + 0.5;
          ctx.strokeStyle = 'rgba(255,255,255,0.12)';
          ctx.beginPath();
          ctx.moveTo(bx, RULER_H - 7);
          ctx.lineTo(bx, RULER_H);
          ctx.stroke();
        }
      }
    }
  }, [timelineW, contentBeats, pxPerBeat, bpb]);

  // Lane grid
  useEffect(() => {
    const canvas = gridCanvasRef.current;
    if (!canvas) return;
    const h = Math.max(total, 1);
    canvas.width = timelineW;
    canvas.height = h;
    canvas.style.width = `${timelineW}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, timelineW, h);
    const bars = Math.ceil(contentBeats / bpb);
    const barPx = bpb * pxPerBeat;
    for (let bar = 0; bar <= bars; bar++) {
      const x = Math.round(bar * barPx) + 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.075)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      if (pxPerBeat >= 14) {
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        for (let b = 1; b < bpb; b++) {
          const bx = Math.round(bar * barPx + b * pxPerBeat) + 0.5;
          ctx.beginPath();
          ctx.moveTo(bx, 0);
          ctx.lineTo(bx, h);
          ctx.stroke();
        }
      }
    }
  }, [timelineW, contentBeats, pxPerBeat, bpb, total]);

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
  const laneAt = useCallback((clientY: number): Track | null => {
    const lanes = viewportRef.current?.querySelector('.arr-lanes');
    if (!lanes) return null;
    const rect = lanes.getBoundingClientRect();
    const y = clientY - rect.top;
    const ts = useProjectStore.getState().project.tracks;
    const hs = laneHeights(ts).heights;
    let acc = 0;
    for (let i = 0; i < ts.length; i++) {
      if (y >= acc && y < acc + hs[i]) return ts[i];
      acc += hs[i];
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
    ui.showMenu({
      x,
      y,
      items: [
        { label: 'Audio Track', action: () => ui.selectTrack(store.addTrack('audio')) },
        { label: 'Instrument Track', action: () => ui.selectTrack(store.addTrack('instrument')) },
        { label: 'Drum Track', action: () => ui.selectTrack(store.addTrack('drum')) },
        { label: 'Bus', action: () => ui.selectTrack(store.addTrack('bus')) },
      ],
    });
  };

  const setSnap = (v: number) => useUiStore.getState().set({ snap: v });
  const loopStyle = {
    left: loop.start * pxPerBeat,
    width: Math.max(2, (loop.end - loop.start) * pxPerBeat),
  };

  return (
    <div className="arr" data-testid="arrangement">
      <div className="arr-toolbar">
        <button
          className="btn"
          onClick={(e) => addTrackMenu(e.clientX, e.clientY)}
          data-testid="add-track"
        >
          <Icon name="plus" size={13} /> Track
        </button>
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
          onClick={() => zoomBy(0.8)}
          title="Zoom out (Ctrl + wheel)"
          aria-label="Zoom out"
        >
          &minus;
        </button>
        <button
          className="icon-btn"
          onClick={() => zoomBy(1.25)}
          title="Zoom in (Ctrl + wheel)"
          aria-label="Zoom in"
        >
          +
        </button>
      </div>

      <div className="arr-viewport" ref={viewportRef} data-testid="arr-scroll">
        <div className="arr-content">
          <div className="arr-header-col" data-testid="track-headers">
            <div className="arr-corner">Tracks</div>
            {tracks.map((t, i) => (
              <TrackHeader key={t.id} track={t} height={heights[i]} />
            ))}
            <div className="add-track">
              <button className="btn" onClick={(e) => addTrackMenu(e.clientX, e.clientY)}>
                <Icon name="plus" size={13} /> Add Track
              </button>
            </div>
          </div>

          <div className="arr-timeline-col" style={{ width: timelineW }}>
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

            <div className="arr-lanes" data-testid="arr-lanes">
              <canvas ref={gridCanvasRef} className="arr-grid-canvas" />
              {tracks.map((t, i) => (
                <div
                  key={t.id}
                  className={`arr-lane${selectedTrackId === t.id ? ' selected' : ''}`}
                  style={{ height: heights[i] }}
                  data-testid={`lane-${t.name}`}
                  onPointerDown={() => useUiStore.getState().selectTrack(t.id)}
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
                  {clips
                    .filter((c) => c.trackId === t.id)
                    .map((c) => (
                      <ClipView
                        key={c.id}
                        clip={c}
                        track={t}
                        laneHeight={heights[i]}
                        pxPerBeat={pxPerBeat}
                        laneAt={laneAt}
                        onEdgeScroll={edgeScroll}
                      />
                    ))}
                </div>
              ))}
              <div ref={playheadRef} className="arr-playhead" data-testid="playhead" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
