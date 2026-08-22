import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type React from 'react';
import { longPress, usePointerDrag } from '../../hooks/usePointerDrag';
import { firstIndexFrom, type DrumLane } from '../../model/drumMap';
import { clamp, midiToName } from '../../model/music';
import type { Note } from '../../model/types';
import { Icon } from '../common/Icon';

/** One instrument row. Tall enough for a velocity column to read at a glance. */
export const LANE_H = 24;
/** Lane rail width. Matches the arrangement's track headers so the two align. */
export const RAIL_W = 168;
export const RULER_H = 22;

/** Vertical drag distance that sweeps the whole velocity range. */
const VEL_DRAG_PX = 96;
/** Beat comparisons tolerate float drift from triplet grids. */
const EPS = 1e-6;

/** Whole steps a clip of `beats` covers at this resolution. */
export function stepCountFor(beats: number, step: number): number {
  return Math.max(1, Math.ceil(beats / step - EPS));
}

/** Grid width in px. Shared so the scroller and the grid cannot disagree. */
export function drumGridWidth(beats: number, step: number, ppb: number): number {
  return stepCountFor(beats, step) * step * ppb;
}

/** Px window for windowed drawing, in the grid's own coordinates. */
export interface GridWindow {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Everything the grid is allowed to do to the project. The grid owns pointer
 * and keyboard interpretation; the editor owns the store, so a gesture is
 * begun and ended in exactly one place.
 */
export interface DrumGridEdit {
  begin: () => void;
  end: () => void;
  add: (pitch: number, startBeat: number, velocity: number) => string | null;
  remove: (ids: string[]) => void;
  setVelocity: (ids: string[], velocity: number) => void;
  select: (ids: string[]) => void;
  contextMenu: (note: Note, x: number, y: number) => void;
  audition: (pitch: number, velocity: number) => void;
}

interface DrumGridProps {
  lanes: DrumLane[];
  /** One bucket per pitch, each sorted by start — built once per clip change. */
  notesByPitch: Map<number, Note[]>;
  selected: Set<string>;
  /** Grid step in beats. */
  step: number;
  ppb: number;
  /** Grid length in beats (the clip's own length). */
  beats: number;
  /** Beats per bar at the clip's position, for the bar emphasis lines. */
  barBeats: number;
  paintVelocity: number;
  win: GridWindow;
  edit: DrumGridEdit;
  /** Renders a beat inside the clip as bar.beat.step for labels and speech. */
  positionLabel: (beat: number) => string;
}

type DragMode = 'undecided' | 'paint' | 'erase' | 'copy' | 'velocity';

interface DragState {
  mode: DragMode;
  noteId: string;
  startVel: number;
  copyVel: number;
  /** Cells already handled by this sweep, so a wobble cannot double-edit one. */
  touched: Set<string>;
}

interface Cell {
  row: number;
  stepIndex: number;
}

const cellKey = (c: Cell) => `${c.row}:${c.stepIndex}`;

/**
 * The step grid.
 *
 * Cells are not components and not elements: the empty grid is four repeating
 * CSS gradients on one div, so a 64-bar part at 1/16 costs the same DOM as an
 * empty one. Only hits become elements, and only the hits inside the scroll
 * window — each row reads its own pre-bucketed, start-sorted array and binary
 * searches into the visible span, so drawing never walks the whole part.
 */
export function DrumGrid({
  lanes,
  notesByPitch,
  selected,
  step,
  ppb,
  beats,
  barBeats,
  paintVelocity,
  win,
  edit,
  positionLabel,
}: DrumGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const cursorElRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<Cell>({ row: 0, stepIndex: 0 });
  /**
   * The cursor's live position. Key repeat delivers several keydowns inside one
   * React batch, where the rendered `cursor` is still the value from before the
   * batch — reading state there would collapse three arrow presses into one.
   */
  const cursorPos = useRef<Cell>(cursor);

  const cellW = step * ppb;
  const stepCount = stepCountFor(beats, step);
  const gridW = stepCount * cellW;
  const gridH = lanes.length * LANE_H;
  const maxRow = Math.max(0, lanes.length - 1);

  const row = Math.min(cursor.row, maxRow);
  const stepIndex = Math.min(cursor.stepIndex, stepCount - 1);

  const applyCell = useCallback(
    (next: Cell) => {
      const cell: Cell = {
        row: clamp(next.row, 0, maxRow),
        stepIndex: clamp(next.stepIndex, 0, stepCount - 1),
      };
      cursorPos.current = cell;
      setCursor(cell);
    },
    [maxRow, stepCount],
  );

  // A shorter map or a coarser step can strand the cursor past the last row or
  // column; pull it back rather than pointing at a cell that no longer exists.
  useEffect(() => {
    const cur = cursorPos.current;
    if (cur.row <= maxRow && cur.stepIndex < stepCount) return;
    applyCell(cur);
  }, [applyCell, maxRow, stepCount]);

  const cellAt = useCallback(
    (clientX: number, clientY: number): Cell | null => {
      const el = gridRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const r = Math.floor((clientY - rect.top) / LANE_H);
      const s = Math.floor((clientX - rect.left) / cellW);
      if (r < 0 || r >= lanes.length || s < 0 || s >= stepCount) return null;
      return { row: r, stepIndex: s };
    },
    [cellW, lanes.length, stepCount],
  );

  /** The hit occupying a cell, if any. One lane's bucket, never the whole part. */
  const hitAt = useCallback(
    (r: number, s: number): Note | undefined => {
      const lane = lanes[r];
      if (!lane) return undefined;
      const bucket = notesByPitch.get(lane.pitch);
      if (!bucket) return undefined;
      const from = s * step;
      const hit = bucket[firstIndexFrom(bucket, from - EPS)];
      return hit && hit.start < from + step - EPS ? hit : undefined;
    },
    [lanes, notesByPitch, step],
  );

  const drag = usePointerDrag<DragState | null>({
    onStart: (e) => {
      const cell = cellAt(e.clientX, e.clientY);
      if (!cell) return null;
      applyCell(cell);
      const lane = lanes[cell.row];
      const hit = hitAt(cell.row, cell.stepIndex);
      const touched = new Set([cellKey(cell)]);
      edit.begin();
      if (!hit) {
        const id = edit.add(lane.pitch, cell.stepIndex * step, paintVelocity);
        if (id) edit.select([id]);
        edit.audition(lane.pitch, paintVelocity);
        return {
          mode: 'paint',
          noteId: '',
          startVel: paintVelocity,
          copyVel: paintVelocity,
          touched,
        };
      }
      edit.select([hit.id]);
      edit.audition(lane.pitch, hit.velocity);
      return {
        // Alt stamps copies of this hit; otherwise the axis of the first move
        // decides, and a release with no move at all toggles the hit off.
        mode: e.altKey ? 'copy' : 'undecided',
        noteId: hit.id,
        startVel: hit.velocity,
        copyVel: hit.velocity,
        touched,
      };
    },
    onMove: (dx, dy, e, d) => {
      if (!d) return;
      if (d.mode === 'undecided') {
        d.mode = Math.abs(dy) >= Math.abs(dx) ? 'velocity' : 'erase';
        if (d.mode === 'erase') edit.remove([d.noteId]);
      }
      if (d.mode === 'velocity') {
        edit.setVelocity(
          [d.noteId],
          clamp(Math.round(d.startVel - (dy / VEL_DRAG_PX) * 127), 1, 127),
        );
        return;
      }
      const cell = cellAt(e.clientX, e.clientY);
      if (!cell) return;
      const key = cellKey(cell);
      if (d.touched.has(key)) return;
      d.touched.add(key);
      const hit = hitAt(cell.row, cell.stepIndex);
      if (d.mode === 'erase') {
        if (hit) edit.remove([hit.id]);
        return;
      }
      // Painting never overwrites: a run stops short of an existing hit rather
      // than replacing its velocity with the brush value.
      if (hit) return;
      const velocity = d.mode === 'copy' ? d.copyVel : paintVelocity;
      const lane = lanes[cell.row];
      edit.add(lane.pitch, cell.stepIndex * step, velocity);
      edit.audition(lane.pitch, velocity);
    },
    onEnd: (moved, d) => {
      if (!d) return;
      if (!moved && d.mode === 'undecided') edit.remove([d.noteId]);
      edit.end();
    },
  });

  const openMenuAt = useCallback(
    (clientX: number, clientY: number): boolean => {
      const cell = cellAt(clientX, clientY);
      if (!cell) return false;
      const hit = hitAt(cell.row, cell.stepIndex);
      if (!hit) return false;
      edit.select([hit.id]);
      edit.contextMenu(hit, clientX, clientY);
      return true;
    },
    [cellAt, hitAt, edit],
  );

  const toggleAt = useCallback(
    (r: number, s: number) => {
      const lane = lanes[r];
      if (!lane) return;
      const hit = hitAt(r, s);
      edit.begin();
      if (hit) {
        edit.remove([hit.id]);
      } else {
        const id = edit.add(lane.pitch, s * step, paintVelocity);
        if (id) edit.select([id]);
        edit.audition(lane.pitch, paintVelocity);
      }
      edit.end();
    },
    [lanes, hitAt, edit, step, paintVelocity],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    const at = cursorPos.current;
    const move = (dRow: number, dStep: number) => {
      e.preventDefault();
      applyCell({ row: at.row + dRow, stepIndex: at.stepIndex + dStep });
    };
    const nudgeVelocity = (delta: number) => {
      e.preventDefault();
      const hit = hitAt(at.row, at.stepIndex);
      if (!hit) return;
      edit.begin();
      edit.setVelocity([hit.id], clamp(hit.velocity + delta, 1, 127));
      edit.end();
    };
    switch (e.key) {
      case 'ArrowLeft':
        return move(0, -1);
      case 'ArrowRight':
        return move(0, 1);
      case 'ArrowUp':
        return e.shiftKey ? nudgeVelocity(8) : move(-1, 0);
      case 'ArrowDown':
        return e.shiftKey ? nudgeVelocity(-8) : move(1, 0);
      case 'Home':
        return move(0, -stepCount);
      case 'End':
        return move(0, stepCount);
      case 'Enter':
      case ' ':
        e.preventDefault();
        return toggleAt(at.row, at.stepIndex);
      case 'Delete':
      case 'Backspace': {
        const hit = hitAt(at.row, at.stepIndex);
        if (!hit) return;
        e.preventDefault();
        edit.begin();
        edit.remove([hit.id]);
        edit.end();
        return;
      }
      default:
        return;
    }
  };

  // Keep the keyboard cursor on screen, but only while the grid is the thing
  // being driven — an unfocused grid must never yank the view.
  useEffect(() => {
    const el = cursorElRef.current;
    if (!el || document.activeElement !== gridRef.current) return;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [row, stepIndex]);

  const liveId = useId();
  const cursorLane = lanes[row];
  const cursorHit = cursorLane ? hitAt(row, stepIndex) : undefined;
  const cursorText = cursorLane
    ? `${cursorLane.name}, ${positionLabel(stepIndex * step)}, ${
        cursorHit ? `hit, velocity ${cursorHit.velocity}` : 'empty'
      }`
    : 'No lanes';

  // Family bands: lanes are ordered by kit family, so each family is one run
  // and one element, not one element per row.
  const bands: { group: string; top: number; height: number }[] = [];
  for (let i = 0; i < lanes.length; i++) {
    const last = bands[bands.length - 1];
    if (last && lanes[i].group === last.group) last.height += LANE_H;
    else bands.push({ group: lanes[i].group, top: i * LANE_H, height: LANE_H });
  }

  const fromBeat = win.left / ppb;
  const toBeat = win.right / ppb;
  const hits: React.ReactNode[] = [];
  for (let r = 0; r < lanes.length; r++) {
    const top = r * LANE_H;
    if (top > win.bottom || top + LANE_H < win.top) continue;
    const lane = lanes[r];
    const bucket = notesByPitch.get(lane.pitch);
    if (!bucket) continue;
    for (let i = firstIndexFrom(bucket, fromBeat - step); i < bucket.length; i++) {
      const n = bucket[i];
      if (n.start > toBeat) break;
      const t = n.velocity / 127;
      const fill = Math.round(4 + (LANE_H - 9) * t);
      hits.push(
        <div
          key={n.id}
          className={`de-hit${selected.has(n.id) ? ' selected' : ''}${n.muted ? ' muted' : ''}`}
          style={{
            left: Math.round(n.start * ppb) + 1,
            top: top + LANE_H - 3 - fill,
            width: Math.max(4, cellW - 2),
            height: fill,
            opacity: n.muted ? 0.3 : 0.45 + t * 0.55,
            ['--de-hit-color' as string]: lane.color,
          }}
          role="img"
          aria-label={`${lane.name} at ${positionLabel(n.start)}, velocity ${n.velocity}${
            n.muted ? ', muted' : ''
          }`}
          title={`${lane.name} · ${positionLabel(n.start)} · vel ${n.velocity}`}
          data-testid="de-hit"
        />,
      );
    }
  }

  return (
    <div
      ref={gridRef}
      className="de-grid"
      role="group"
      tabIndex={0}
      aria-label="Drum step grid"
      aria-describedby={liveId}
      data-testid="de-grid"
      style={{
        width: gridW,
        height: gridH,
        ['--de-bar-px' as string]: `${barBeats * ppb}px`,
        ['--de-beat-px' as string]: `${ppb}px`,
        ['--de-step-px' as string]: `${cellW}px`,
        ['--de-lane-px' as string]: `${LANE_H}px`,
      }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        if (openMenuAt(e.clientX, e.clientY)) e.preventDefault();
      }}
      onPointerDown={(e) => {
        longPress((x, y) => openMenuAt(x, y))(e);
        drag(e);
      }}
    >
      {bands.map((b) => (
        <div
          key={`${b.group}-${b.top}`}
          className="de-band"
          data-group={b.group}
          style={{ top: b.top, height: b.height }}
        />
      ))}
      {hits}
      <div
        ref={cursorElRef}
        className="de-cell-cursor"
        style={{
          left: stepIndex * cellW,
          top: row * LANE_H,
          width: cellW,
          height: LANE_H,
        }}
      />
      <div id={liveId} className="de-live" role="status" aria-live="polite">
        {cursorText}
      </div>
    </div>
  );
}

interface DrumRailProps {
  lanes: DrumLane[];
  /** Pitches whose hits are all muted. */
  mutedPitches: Set<number>;
  soloPitch: number | null;
  onMute: (pitch: number) => void;
  onSolo: (pitch: number) => void;
  onAudition: (pitch: number) => void;
}

/**
 * The lane rail: one row per kit slot, with the controls that belong to the
 * slot rather than to a hit. Every row is ≤ 60 elements even on the full GM
 * map, so it is drawn whole rather than windowed.
 */
export function DrumRail({
  lanes,
  mutedPitches,
  soloPitch,
  onMute,
  onSolo,
  onAudition,
}: DrumRailProps) {
  return (
    <div className="de-rail" style={{ width: RAIL_W }} role="list" aria-label="Drum lanes">
      {lanes.map((lane) => {
        const muted = mutedPitches.has(lane.pitch);
        const solo = soloPitch === lane.pitch;
        return (
          <div
            key={lane.pitch}
            className="de-lane"
            role="listitem"
            data-group={lane.group}
            style={{ height: LANE_H, ['--de-lane-color' as string]: lane.color }}
          >
            <span className="de-swatch" aria-hidden="true" />
            <span className="de-lane-name" title={`${lane.name} · ${midiToName(lane.pitch)}`}>
              {lane.name}
            </span>
            <button
              className="icon-btn de-audition"
              onClick={() => onAudition(lane.pitch)}
              aria-label={`Audition ${lane.name}`}
              title={`Audition ${lane.name}`}
            >
              <Icon name="play" size={10} />
            </button>
            <button
              className={`th-mini${muted ? ' m-on' : ''}`}
              aria-pressed={muted}
              aria-label={`Mute ${lane.name}`}
              title={`Mute ${lane.name}`}
              onClick={() => onMute(lane.pitch)}
            >
              M
            </button>
            <button
              className={`th-mini${solo ? ' s-on' : ''}`}
              aria-pressed={solo}
              aria-label={`Solo ${lane.name}`}
              title={`Solo ${lane.name}`}
              onClick={() => onSolo(lane.pitch)}
            >
              S
            </button>
          </div>
        );
      })}
    </div>
  );
}

interface DrumRulerProps {
  /** Bar starts inside the clip, in clip-relative beats. */
  bars: { bar: number; beat: number }[];
  ppb: number;
  width: number;
  win: GridWindow;
}

/**
 * Bars and beats above the grid. Beat and step ticks are gradients (their
 * spacing is constant whatever the signature); bar ticks and numbers are real
 * elements taken from the tempo map, so a signature change moves them.
 */
export function DrumRuler({ bars, ppb, width, win }: DrumRulerProps) {
  return (
    <div
      className="de-ruler"
      style={{ width, height: RULER_H, ['--de-beat-px' as string]: `${ppb}px` }}
      data-testid="de-ruler"
    >
      {bars.map((b) => {
        const x = b.beat * ppb;
        if (x < win.left - 40 || x > win.right) return null;
        return (
          <div key={b.bar} className="de-bar-tick" style={{ left: x }}>
            {b.bar}
          </div>
        );
      })}
    </div>
  );
}
