/**
 * Automation lanes beneath a track: the timeline row (curve + points) and the
 * header-column row (name, value, enable, remove, resize).
 *
 * Rendering is windowed exactly like clips and piano-roll notes: the SVG spans
 * only the visible window, curves are sampled per segment, and only points
 * inside the window mount — selected points always mount (pointer-capture
 * rule). Values are normalized 0..1; the parameter descriptor formats the
 * readouts.
 */
import { memo, useMemo, useRef, useState } from 'react';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { clamp, snapBeat } from '../../model/music';
import {
  CURVE_SHAPES,
  laneValueAt,
  lowerBound,
  type AutomationLane,
  type AutomationPoint,
} from '../../model/automation';
import { denormParam, normParam, type AutoParam } from '../../model/paramRegistry';
import type { Track } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { hasAutomationClipboard, pasteAutomation } from '../../app/automationActions';
import { engine } from '../../audio/engine';

export const AUTO_LANE_H = 44;
const PAD = 5;

interface RowProps {
  track: Track;
  lane: AutomationLane;
  param: AutoParam;
  height: number;
  pxPerBeat: number;
  winLeft: number;
  winRight: number;
  timelineW: number;
  snap: number;
}

export const AutoLaneRow = memo(function AutoLaneRow({
  track,
  lane,
  param,
  height,
  pxPerBeat,
  winLeft,
  winRight,
  timelineW,
  snap,
}: RowProps) {
  const autoSel = useUiStore((s) => s.autoSel);
  const selIds = useMemo(
    () => (autoSel?.laneId === lane.id ? autoSel.pointIds : []),
    [autoSel, lane.id],
  );
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const rowRef = useRef<HTMLDivElement>(null);

  const winL = Math.max(0, winLeft);
  const winR = Math.min(timelineW, Math.max(winL + 1, winRight));
  const winW = winR - winL;
  const beatL = winL / pxPerBeat;
  const beatR = winR / pxPerBeat;
  const innerH = height - PAD * 2;
  const yOf = (v: number) => PAD + (1 - v) * innerH;
  const valOf = (y: number) => clamp(1 - (y - PAD) / innerH, 0, 1);

  /** Points to mount: window slice plus everything selected. */
  const visible = useMemo(() => {
    const pts = lane.points;
    const i0 = Math.max(0, lowerBound(pts, beatL) - 1);
    const i1 = Math.min(pts.length, lowerBound(pts, beatR) + 1);
    const out = pts.slice(i0, i1);
    if (selIds.length) {
      const have = new Set(out.map((p) => p.id));
      for (const p of pts) if (selIds.includes(p.id) && !have.has(p.id)) out.push(p);
    }
    return out;
  }, [lane.points, beatL, beatR, selIds]);

  /** Curve path across the visible window, sampled per segment. */
  const path = useMemo(() => {
    const pts = lane.points;
    if (pts.length === 0) return '';
    const x = (beat: number) => beat * pxPerBeat - winL;
    const start = laneValueAt(pts, beatL) ?? pts[0].value;
    const els: string[] = [`M 0 ${yOf(start).toFixed(1)}`];
    const i0 = Math.max(0, lowerBound(pts, beatL) - 1);
    const i1 = Math.min(pts.length - 1, lowerBound(pts, beatR) + 1);
    for (let i = i0; i <= i1; i++) {
      const a = pts[i];
      if (a.beat >= beatL && a.beat <= beatR) {
        els.push(`L ${x(a.beat).toFixed(1)} ${yOf(a.value).toFixed(1)}`);
      }
      const b = pts[i + 1];
      if (!b || b.beat < beatL || a.beat > beatR) continue;
      if (a.curve === 'step') {
        els.push(`L ${x(b.beat).toFixed(1)} ${yOf(a.value).toFixed(1)}`);
        els.push(`L ${x(b.beat).toFixed(1)} ${yOf(b.value).toFixed(1)}`);
      } else if (a.curve === 'linear') {
        els.push(`L ${x(b.beat).toFixed(1)} ${yOf(b.value).toFixed(1)}`);
      } else {
        const segPx = (b.beat - a.beat) * pxPerBeat;
        const steps = clamp(Math.ceil(segPx / 7), 3, 24);
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const shaped =
            a.value +
            (b.value - a.value) *
              (a.curve === 'exp'
                ? t * t * t
                : a.curve === 'log'
                  ? 1 - (1 - t) * (1 - t) * (1 - t)
                  : t * t * (3 - 2 * t));
          els.push(
            `L ${x(a.beat + (b.beat - a.beat) * t).toFixed(1)} ${yOf(shaped).toFixed(1)}`,
          );
        }
      }
    }
    const end = laneValueAt(pts, beatR) ?? pts[pts.length - 1].value;
    els.push(`L ${winW.toFixed(1)} ${yOf(end).toFixed(1)}`);
    return els.join(' ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lane.points, beatL, beatR, pxPerBeat, winL, winW, innerH]);

  const store = useProjectStore;
  const ui = useUiStore;

  const select = (ids: string[]) =>
    ui.getState().set({ autoSel: { trackId: track.id, laneId: lane.id, pointIds: ids } });

  const dragPoint = usePointerDrag<{
    ids: string[];
    orig: Map<string, AutomationPoint>;
  }>({
    onStart: (e) => {
      const pid = (e.currentTarget as HTMLElement).dataset.pid!;
      const additive = e.shiftKey;
      const cur = selIds.includes(pid) ? selIds : additive ? [...selIds, pid] : [pid];
      select(cur);
      store.getState().beginGesture();
      const orig = new Map<string, AutomationPoint>();
      for (const p of lane.points) if (cur.includes(p.id)) orig.set(p.id, { ...p });
      return { ids: cur, orig };
    },
    onMove: (dx, dy, e, d) => {
      const dBeat = dx / pxPerBeat;
      const dVal = -dy / innerH;
      const fine = e.shiftKey ? 0.25 : 1;
      store.getState().updateAutomationPoints(track.id, lane.id, d.ids, (p) => {
        const o = d.orig.get(p.id);
        if (!o) return {};
        const rawBeat = Math.max(0, o.beat + dBeat);
        return {
          beat: e.altKey || snap <= 0 ? rawBeat : snapBeat(rawBeat, snap),
          value: clamp(o.value + dVal * fine, 0, 1),
        };
      });
    },
    onEnd: () => store.getState().endGesture(),
  });

  const pointMenu = (e: React.MouseEvent, p: AutomationPoint) => {
    e.preventDefault();
    e.stopPropagation();
    const ids = selIds.includes(p.id) ? selIds : [p.id];
    select(ids);
    ui.getState().showMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...CURVE_SHAPES.map((c) => ({
          label: `${p.curve === c.id ? '● ' : ''}Curve: ${c.label}`,
          action: () => store.getState().setAutomationCurve(track.id, lane.id, ids, c.id),
        })),
        {
          label: ids.length > 1 ? `Delete ${ids.length} points` : 'Delete point',
          danger: true,
          shortcut: 'Del',
          action: () => {
            store.getState().deleteAutomationPoints(track.id, lane.id, ids);
            select([]);
          },
        },
      ],
    });
  };

  const laneMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = rowRef.current!.getBoundingClientRect();
    const beat = (e.clientX - rect.left) / pxPerBeat;
    ui.getState().showMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Add point',
          shortcut: 'Dbl-click',
          action: () => {
            const v = laneValueAt(lane.points, beat) ?? normParam(param, param.get(track));
            const id = store
              .getState()
              .addAutomationPoint(track.id, lane.id, snap > 0 ? snapBeat(beat, snap) : beat, v);
            if (id) select([id]);
          },
        },
        {
          label: 'Paste at playhead',
          disabled: !hasAutomationClipboard(),
          shortcut: 'Ctrl+V',
          action: () => pasteAutomation(track.id, lane.id),
        },
        {
          label: 'Select all in lane',
          shortcut: 'Ctrl+A',
          action: () => select(lane.points.map((p) => p.id)),
        },
        {
          label: lane.enabled ? 'Disable lane' : 'Enable lane',
          action: () => store.getState().setAutomationLane(track.id, lane.id, { enabled: !lane.enabled }),
        },
        {
          label: 'Clear lane',
          danger: true,
          action: () =>
            store.getState().deleteAutomationPoints(
              track.id,
              lane.id,
              lane.points.map((p) => p.id),
            ),
        },
        {
          label: 'Remove lane',
          danger: true,
          action: () => store.getState().removeAutomationLane(track.id, lane.id),
        },
      ],
    });
  };

  const dragMarquee = usePointerDrag<{ x0: number; y0: number; base: string[] }>({
    onStart: (e) => {
      const rect = rowRef.current!.getBoundingClientRect();
      const base = e.shiftKey ? selIds : [];
      if (!e.shiftKey) select([]);
      return { x0: e.clientX - rect.left, y0: e.clientY - rect.top, base };
    },
    onMove: (_dx, _dy, e, d) => {
      const rect = rowRef.current!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const x0 = Math.min(d.x0, cx);
      const x1 = Math.max(d.x0, cx);
      const y0 = Math.min(d.y0, cy);
      const y1 = Math.max(d.y0, cy);
      setMarquee({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      const b0 = x0 / pxPerBeat;
      const b1 = x1 / pxPerBeat;
      const vHi = valOf(y0);
      const vLo = valOf(y1);
      const hits = lane.points
        .filter((p) => p.beat >= b0 && p.beat <= b1 && p.value >= vLo && p.value <= vHi)
        .map((p) => p.id);
      select([...new Set([...d.base, ...hits])]);
    },
    onEnd: () => setMarquee(null),
  });

  const addPointAt = (e: React.MouseEvent) => {
    const rect = rowRef.current!.getBoundingClientRect();
    const rawBeat = (e.clientX - rect.left) / pxPerBeat;
    const beat = e.altKey || snap <= 0 ? rawBeat : snapBeat(rawBeat, snap);
    const value = valOf(e.clientY - rect.top);
    const id = store.getState().addAutomationPoint(track.id, lane.id, beat, value);
    if (id) select([id]);
  };

  const color = param.color;
  return (
    <div
      ref={rowRef}
      className={`auto-lane${lane.enabled ? '' : ' disabled'}`}
      style={{ height, ['--al-color' as string]: color }}
      data-testid={`auto-lane-${track.name}-${param.name}`}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('.auto-pt')) return;
        // Mouse selects with a marquee; touch keeps native scrolling.
        if (e.pointerType === 'mouse' && e.button === 0) {
          e.stopPropagation();
          dragMarquee(e);
        }
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('.auto-pt')) return;
        e.stopPropagation();
        addPointAt(e);
      }}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('.auto-pt')) return;
        laneMenu(e);
      }}
    >
      <svg
        className="auto-svg"
        style={{ left: winL, width: winW }}
        height={height}
        aria-hidden="true"
      >
        {lane.points.length === 0 ? (
          <line
            x1={0}
            x2={winW}
            y1={yOf(normParam(param, param.get(track)))}
            y2={yOf(normParam(param, param.get(track)))}
            className="auto-static"
          />
        ) : (
          <>
            <path d={`${path} L ${winW} ${height - PAD} L 0 ${height - PAD} Z`} className="auto-fill" />
            <path d={path} className="auto-line" />
          </>
        )}
      </svg>
      {visible.map((p) => {
        const left = p.beat * pxPerBeat - 4.5;
        if (left < winL - 20 || left > winR + 20) {
          if (!selIds.includes(p.id)) return null;
        }
        return (
          <div
            key={p.id}
            className={`auto-pt${selIds.includes(p.id) ? ' selected' : ''}`}
            style={{ left, top: yOf(p.value) - 4.5 }}
            data-pid={p.id}
            data-testid="auto-pt"
            title={`${param.format(denormParam(param, p.value))} · beat ${p.beat.toFixed(2)} · ${p.curve}`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              dragPoint(e);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              store.getState().deleteAutomationPoints(track.id, lane.id, [p.id]);
            }}
            onContextMenu={(e) => pointMenu(e, p)}
          />
        );
      })}
      {marquee && (
        <div
          className="auto-marquee"
          data-testid="auto-marquee"
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
        />
      )}
    </div>
  );
});

export const AutoLaneHeader = memo(function AutoLaneHeader({
  track,
  lane,
  param,
  height,
}: {
  track: Track;
  lane: AutomationLane;
  param: AutoParam;
  height: number;
}) {
  const store = useProjectStore;
  // Readout: the lane value at the playhead when it has points, else the
  // static value the parameter currently holds. Recomputed on project edits;
  // it deliberately does not chase the playhead per frame — with hundreds of
  // lanes open that would be hundreds of rAF subscribers.
  const norm = laneValueAt(lane.points, engine.getPositionBeats());
  const display =
    lane.points.length > 0 && norm !== null
      ? param.format(denormParam(param, norm))
      : param.format(param.get(track));

  const dragResize = usePointerDrag<{ h0: number }>({
    onStart: () => ({ h0: height }),
    onMove: (_dx, dy, _e, d) =>
      store.getState().setAutomationLane(track.id, lane.id, { height: d.h0 + dy }),
  });

  return (
    <div
      className={`alh${lane.enabled ? '' : ' disabled'}`}
      style={{ height, ['--al-color' as string]: param.color }}
      data-testid={`auto-head-${track.name}-${param.name}`}
    >
      <span className="alh-dot" />
      <span className="alh-name" title={`${param.name} (${param.unit || 'value'})`}>
        {param.name}
      </span>
      <span className="alh-val">{display}</span>
      <button
        className={`th-mini alh-power${lane.enabled ? ' on' : ''}`}
        title={lane.enabled ? 'Disable lane (keeps points)' : 'Enable lane'}
        aria-pressed={lane.enabled}
        onClick={() => store.getState().setAutomationLane(track.id, lane.id, { enabled: !lane.enabled })}
      >
        ●
      </button>
      <button
        className="th-mini"
        title="Remove lane"
        aria-label={`Remove ${param.name} automation`}
        onClick={() => store.getState().removeAutomationLane(track.id, lane.id)}
      >
        ×
      </button>
      <div className="alh-resize" onPointerDown={dragResize} title="Drag to resize lane" />
    </div>
  );
});
