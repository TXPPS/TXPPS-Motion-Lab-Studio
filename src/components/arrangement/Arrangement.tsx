import { useCallback, useEffect, useMemo, useRef } from 'react';
import { engine } from '../../audio/engine';
import { beatsPerBar, snapBeat, snapBeatFloor } from '../../model/music';
import type { Track } from '../../model/types';
import { projectEndBeat, useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';
import { ClipView } from './ClipView';
import { TrackHeader } from './TrackHeader';

const RULER_H = 30;

function laneHeights(tracks: Track[]): { heights: number[]; tops: number[]; total: number } {
  const heights = tracks.map((t) => (t.collapsed ? 30 : 64));
  const tops: number[] = [];
  let acc = 0;
  for (const h of heights) {
    tops.push(acc);
    acc += h;
  }
  return { heights, tops, total: acc };
}

export function Arrangement() {
  const tracks = useProjectStore((s) => s.project.tracks);
  const clips = useProjectStore((s) => s.project.clips);
  const loop = useProjectStore((s) => s.project.loop);
  const timeSig = useProjectStore((s) => s.project.timeSig);
  const endBeat = useProjectStore((s) => projectEndBeat(s.project));
  const pxPerBeat = useUiStore((s) => s.pxPerBeat);
  const snap = useUiStore((s) => s.snap);
  const selectedTrackId = useUiStore((s) => s.selectedTrackId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const headersRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const rulerCanvasRef = useRef<HTMLCanvasElement>(null);
  const gridCanvasRef = useRef<HTMLCanvasElement>(null);

  const bpb = beatsPerBar(timeSig);
  const contentBeats = Math.max(endBeat + 8, loop.end + 4, 64);
  const contentW = Math.ceil(contentBeats * pxPerBeat);
  const { heights, total } = useMemo(() => laneHeights(tracks), [tracks]);

  // vertical scroll sync: headers column follows the lane scroll
  const onScroll = useCallback(() => {
    const sc = scrollRef.current;
    const hd = headersRef.current;
    if (sc && hd) hd.style.transform = `translateY(${-sc.scrollTop}px)`;
  }, []);

  // playhead + auto-follow, driven by the engine frame loop
  useEffect(() => {
    return engine.onFrame(() => {
      const ph = playheadRef.current;
      const sc = scrollRef.current;
      if (!ph || !sc) return;
      const beats = engine.getPositionBeats();
      const x = beats * pxPerBeat;
      ph.style.transform = `translateX(${x}px)`;
      if (engine.isPlaying()) {
        const view = sc.clientWidth;
        if (x < sc.scrollLeft || x > sc.scrollLeft + view - 40) {
          sc.scrollLeft = Math.max(0, x - 60);
        }
      }
    });
  }, [pxPerBeat]);

  // ruler drawing
  useEffect(() => {
    const canvas = rulerCanvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = contentW * dpr;
    canvas.height = RULER_H * dpr;
    canvas.style.width = `${contentW}px`;
    canvas.style.height = `${RULER_H}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, contentW, RULER_H);
    ctx.font = '9.5px system-ui, sans-serif';
    const bars = Math.ceil(contentBeats / bpb);
    for (let bar = 0; bar <= bars; bar++) {
      const x = bar * bpb * pxPerBeat + 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.beginPath();
      ctx.moveTo(x, RULER_H - 12);
      ctx.lineTo(x, RULER_H);
      ctx.stroke();
      ctx.fillStyle = 'rgba(232,228,218,0.62)';
      ctx.fillText(String(bar + 1), x + 3, RULER_H - 14);
      if (pxPerBeat >= 14) {
        for (let b = 1; b < bpb; b++) {
          const bx = (bar * bpb + b) * pxPerBeat + 0.5;
          ctx.strokeStyle = 'rgba(255,255,255,0.12)';
          ctx.beginPath();
          ctx.moveTo(bx, RULER_H - 7);
          ctx.lineTo(bx, RULER_H);
          ctx.stroke();
        }
      }
    }
  }, [contentW, contentBeats, pxPerBeat, bpb]);

  // grid drawing
  useEffect(() => {
    const canvas = gridCanvasRef.current;
    if (!canvas) return;
    const h = Math.max(total, 1);
    const dpr = 1;
    canvas.width = contentW * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${contentW}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, contentW, h);
    const bars = Math.ceil(contentBeats / bpb);
    for (let bar = 0; bar <= bars; bar++) {
      const x = Math.round(bar * bpb * pxPerBeat) + 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.075)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      if (pxPerBeat >= 14) {
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        for (let b = 1; b < bpb; b++) {
          const bx = Math.round((bar * bpb + b) * pxPerBeat) + 0.5;
          ctx.beginPath();
          ctx.moveTo(bx, 0);
          ctx.lineTo(bx, h);
          ctx.stroke();
        }
      }
    }
  }, [contentW, contentBeats, pxPerBeat, bpb, total]);

  // ctrl/cmd + wheel zoom
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const ui = useUiStore.getState();
      const next = Math.min(100, Math.max(8, ui.pxPerBeat * (e.deltaY > 0 ? 0.88 : 1.14)));
      ui.set({ pxPerBeat: Math.round(next * 10) / 10 });
    };
    sc.addEventListener('wheel', onWheel, { passive: false });
    return () => sc.removeEventListener('wheel', onWheel);
  }, []);

  const laneAt = useCallback((clientY: number): Track | null => {
    const sc = scrollRef.current;
    if (!sc) return null;
    const rect = sc.getBoundingClientRect();
    const y = clientY - rect.top + sc.scrollTop - RULER_H;
    const ts = useProjectStore.getState().project.tracks;
    const { tops: tps, heights: hts } = laneHeights(ts);
    for (let i = 0; i < ts.length; i++) {
      if (y >= tps[i] && y < tps[i] + hts[i]) return ts[i];
    }
    return null;
  }, []);

  // ruler interactions: bottom = seek/scrub, top = set loop region
  const rulerPointer = useCallback(
    (e: React.PointerEvent) => {
      const el = e.currentTarget as HTMLElement;
      const rect = el.getBoundingClientRect();
      const isLoopZone = e.clientY - rect.top < RULER_H / 2;
      const beatAt = (clientX: number) => Math.max(0, (clientX - rect.left) / pxPerBeat);
      const pid = e.pointerId;
      try {
        el.setPointerCapture(pid);
      } catch {}
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
  const zoom = (f: number) =>
    useUiStore
      .getState()
      .set({ pxPerBeat: Math.min(100, Math.max(8, Math.round(pxPerBeat * f * 10) / 10)) });

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
              onClick={() => setSnap(o.v)}
            >
              {o.l}
            </button>
          ))}
        </div>
        <span className="spacer" style={{ flex: 1 }} />
        <button
          className="icon-btn"
          onClick={() => zoom(0.8)}
          title="Zoom out"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          className="icon-btn"
          onClick={() => zoom(1.25)}
          title="Zoom in"
          aria-label="Zoom in"
        >
          +
        </button>
      </div>
      <div className="arr-body">
        <div className="arr-headers">
          <div className="arr-ruler-corner">Tracks</div>
          <div
            style={{
              position: 'absolute',
              top: RULER_H,
              left: 0,
              right: 0,
              bottom: 0,
              overflow: 'hidden',
            }}
          >
            <div ref={headersRef} className="arr-headers-inner">
              {tracks.map((t, i) => (
                <TrackHeader key={t.id} track={t} height={heights[i]} />
              ))}
              <div className="add-track">
                <button className="btn" onClick={(e) => addTrackMenu(e.clientX, e.clientY)}>
                  <Icon name="plus" size={13} /> Add Track
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="arr-scroll" ref={scrollRef} onScroll={onScroll} data-testid="arr-scroll">
          <div
            className="arr-canvas-wrap"
            style={{ width: contentW, height: RULER_H + total + 120 }}
          >
            <div
              className="arr-ruler"
              style={{ width: contentW }}
              onPointerDown={rulerPointer}
              data-testid="ruler"
              title="Click to set position · drag the top edge to set the loop"
            >
              <canvas ref={rulerCanvasRef} />
              <div
                className={`arr-loop${loop.enabled ? '' : ' off'}`}
                style={{ left: loop.start * pxPerBeat, width: (loop.end - loop.start) * pxPerBeat }}
                data-testid="loop-region"
              />
            </div>
            <canvas ref={gridCanvasRef} className="arr-grid" />
            <div className="arr-lanes">
              {tracks.map((t, i) => (
                <div
                  key={t.id}
                  className={`arr-lane${selectedTrackId === t.id ? ' selected' : ''}`}
                  style={{ height: heights[i] }}
                  data-testid={`lane-${t.name}`}
                  onPointerDown={() => useUiStore.getState().selectTrack(t.id)}
                  onDoubleClick={(e) => {
                    if (t.type === 'instrument' || t.type === 'drum') {
                      const sc = scrollRef.current;
                      if (!sc) return;
                      const rect = sc.getBoundingClientRect();
                      const beat = snapBeatFloor(
                        (e.clientX - rect.left + sc.scrollLeft) / pxPerBeat,
                        Math.max(snap, 1),
                      );
                      const id = useProjectStore.getState().addMidiClip(t.id, beat, 4);
                      useUiStore.getState().selectClip(id, t.id);
                    }
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
                      />
                    ))}
                </div>
              ))}
            </div>
            <div ref={playheadRef} className="arr-playhead" data-testid="playhead" />
          </div>
        </div>
      </div>
    </div>
  );
}
