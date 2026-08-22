/**
 * The Score editor: the open MIDI clip engraved as notation.
 *
 * This pass is **read-only notation with live selection**. Clicking a note
 * selects it in the shared note selection, so the piano roll and the score
 * always agree on what is selected, and any edit made in the piano roll
 * re-engraves here at once; the score itself does not yet write notes back —
 * dragging pitch and duration on the staff comes next.
 *
 * Every musical decision — bar splitting, note values, spelling, voices, beams,
 * rests — belongs to `model/notation.ts`. This file is layout and paint only:
 * it turns a `Score` into coordinates measured in staff spaces and hands them
 * to the glyphs in `Glyphs.tsx`, so one `staffSpace` number sizes everything.
 *
 * Performance follows the piano roll's rule. The engraved model is memoised on
 * the clip and the tempo map, never on scroll or selection, and only the
 * measures inside the scrolled window are mounted — so a three-hundred-bar part
 * scrolls exactly as cheaply as a four-bar one.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { engine } from '../../audio/engine';
import { tempoMapOf } from '../../model/music';
import {
  buildScore,
  chooseClef,
  keyFromTonic,
  keySignatureGlyphs,
  type Clef,
  type NoteValue,
  type Score,
  type ScoreElement,
  type ScoreMeasure,
} from '../../model/notation';
import type { MidiClip } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';
import {
  Accidental,
  Beam,
  BEAM_GAP,
  BEAM_H,
  ClefGlyph,
  Dots,
  Flags,
  HEAD_W,
  headKindFor,
  Ledgers,
  LINE_W,
  NoteHead,
  Rest,
  STEM_LEN,
  STEM_W,
  Stem,
  Tie,
  TimeSigGlyph,
  timeSigWidth,
} from './Glyphs';
import '../../styles/score.css';

/** Staff sizes offered, in px per staff space. */
const SIZES = [5, 6, 7, 8.5, 10, 12];
/** Vertical padding above the top staff, in staff spaces. */
const PAD_Y = 7;
/** Distance between the two staves of a grand staff, top line to top line. */
const GRAND_GAP = 13;
/** Room kept clear inside a bar before the first and after the last element. */
const GUTTER_L = 1.6;
const GUTTER_R = 1.2;
/** Minimum horizontal room one element needs. */
const ELEMENT_W = 3.4;

const GRIDS: { label: string; beats: number }[] = [
  { label: '1/4', beats: 1 },
  { label: '1/8', beats: 0.5 },
  { label: '1/16', beats: 0.25 },
  { label: '1/32', beats: 0.125 },
];

const TONICS = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'];

const VALUE_NAMES: Record<NoteValue, string> = {
  1: 'whole',
  2: 'half',
  4: 'quarter',
  8: 'eighth',
  16: 'sixteenth',
  32: 'thirty-second',
};

const ACC_NAMES: Record<string, string> = {
  '-2': 'double flat',
  '-1': 'flat',
  '0': 'natural',
  '1': 'sharp',
  '2': 'double sharp',
};

interface MeasureBox {
  /** Index into each staff's measure list — the staves share a bar layout. */
  i: number;
  /** The bar as the first staff sees it: number, meter, position. */
  m: ScoreMeasure;
  /** Left edge, including any leading time signature. */
  x: number;
  /** Where notes start, and the width they are spread across. */
  contentX: number;
  contentW: number;
  /** Right edge — where the barline is drawn. */
  end: number;
  sigX: number | null;
}

interface StaffGeom {
  /** y of the top staff line. */
  top: number;
  clef: Clef;
  score: Score;
}

/** Beats from the barline to an x inside a laid-out measure. */
const xAt = (box: MeasureBox, beatInBar: number) =>
  box.contentX + (beatInBar / box.m.beats) * box.contentW;

/** y of a staff position: 0 is the bottom line, 8 the top. */
const lineYOf = (staff: StaffGeom, space: number, pos: number) =>
  staff.top + 4 * space - pos * (space / 2);

/** This staff's version of a bar. Both staves of a grand staff share the layout. */
const measureFor = (staff: StaffGeom, box: MeasureBox) => staff.score.measures[box.i] ?? box.m;

/**
 * Lay the measures out left to right.
 *
 * Spacing is proportional to musical time — a half note gets twice the room of
 * a quarter — with a floor per measure so a dense bar never collapses onto
 * itself. Both staves of a grand staff use this one layout, which is what keeps
 * the hands vertically aligned.
 */
function layoutMeasures(
  measures: ScoreMeasure[],
  counts: number[],
  space: number,
  pxPerBeat: number,
  x0: number,
): MeasureBox[] {
  const boxes: MeasureBox[] = [];
  let x = x0;
  for (let i = 0; i < measures.length; i++) {
    const m = measures[i];
    const lead = m.showSig ? timeSigWidth(m.sig.num, m.sig.den, space) + space : 0;
    const gutters = (GUTTER_L + GUTTER_R) * space;
    const room = Math.max(m.beats * pxPerBeat, counts[i] * ELEMENT_W * space + gutters);
    boxes.push({
      i,
      m,
      x,
      contentX: x + lead + GUTTER_L * space,
      contentW: room - gutters,
      end: x + lead + room,
      sigX: m.showSig ? x + lead / 2 : null,
    });
    x += lead + room;
  }
  return boxes;
}

/** Heads a second apart cannot share a column, so the upper one steps aside. */
function headShifts(positions: number[], stem: 'up' | 'down' | 'none'): number[] {
  const shifts = new Array<number>(positions.length).fill(0);
  for (let i = 1; i < positions.length; i++) {
    if (Math.abs(positions[i] - positions[i - 1]) === 1 && shifts[i - 1] === 0) {
      shifts[i] = stem === 'down' ? -1 : 1;
    }
  }
  return shifts;
}

/** Accidentals in a chord stack leftwards so they never collide. */
function accidentalRank(el: ScoreElement, index: number): number {
  let rank = 0;
  for (let i = 0; i < index; i++) {
    const other = el.notes[i];
    if (other.accidental !== null && Math.abs(other.staffPos - el.notes[index].staffPos) < 6)
      rank++;
  }
  return rank;
}

function describe(el: ScoreElement, barNumber: number): string {
  const pitches = el.notes
    .map((n) =>
      n.pitch.alter === 0
        ? `${n.pitch.step}${n.pitch.octave}`
        : `${n.pitch.step} ${ACC_NAMES[String(n.pitch.alter)]} ${n.pitch.octave}`,
    )
    .join(', ');
  const dots = el.dots === 1 ? 'dotted ' : el.dots === 2 ? 'double dotted ' : '';
  const tie = el.notes.some((n) => n.tieTo) ? ', tied' : '';
  return `${dots}${VALUE_NAMES[el.value]} ${pitches}, bar ${barNumber}${tie}`;
}

interface ElementViewProps {
  el: ScoreElement;
  x: number;
  space: number;
  staff: StaffGeom;
  barNumber: number;
  selected: boolean;
  /** Stem tip dictated by a beam, when this element is beamed. */
  beamTipY: number | null;
  onSelect: (el: ScoreElement, additive: boolean) => void;
}

function ElementView({
  el,
  x,
  space,
  staff,
  barNumber,
  selected,
  beamTipY,
  onSelect,
}: ElementViewProps) {
  const lineY = (pos: number) => lineYOf(staff, space, pos);

  if (el.kind === 'rest') {
    // A whole rest hangs from the fourth line, a half rest sits on the third;
    // that difference is the only thing telling them apart at a glance.
    const anchor = el.value === 1 ? 6 : 4;
    return (
      <g className="sc-el sc-el-rest" role="img" aria-label={`${VALUE_NAMES[el.value]} rest`}>
        <Rest x={x} y={lineY(anchor)} space={space} value={el.value} />
        {el.dots > 0 && <Dots x={x + 0.7 * space} y={lineY(5)} space={space} count={el.dots} />}
      </g>
    );
  }

  const positions = el.notes.map((n) => n.staffPos);
  const shifts = headShifts(positions, el.stem);
  const up = el.stem === 'up';
  let highest = positions[0];
  let lowest = positions[0];
  for (const p of positions) {
    if (p > highest) highest = p;
    if (p < lowest) lowest = p;
  }
  const headKind = headKindFor(el.value);
  const stemX = x + (up ? 1 : -1) * ((HEAD_W / 2 - STEM_W / 2) * space);
  const stemFrom = lineY(up ? lowest : highest);
  const stemTo = beamTipY ?? lineY(up ? highest : lowest) + (up ? -1 : 1) * STEM_LEN * space;
  const hitTop = Math.min(stemTo, lineY(highest)) - 0.7 * space;
  const hitBottom = Math.max(stemTo, lineY(lowest)) + 0.7 * space;

  return (
    <g
      className={`sc-el sc-el-note${selected ? ' selected' : ''}`}
      data-el="1"
      data-testid="sc-note"
      role="button"
      tabIndex={0}
      aria-label={describe(el, barNumber)}
      aria-pressed={selected}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect(el, e.shiftKey || e.metaKey || e.ctrlKey);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onSelect(el, e.shiftKey);
      }}
    >
      {/* One generous hit target for the whole element: a head alone is far too
          small to hit on a phone, and a stem is not a handle. */}
      <rect
        className="sc-hit"
        x={x - 1.4 * space}
        y={hitTop}
        width={2.8 * space}
        height={hitBottom - hitTop}
      />
      {el.notes.map((n, i) => {
        const hx = x + shifts[i] * HEAD_W * space;
        const hy = lineY(n.staffPos);
        return (
          <g key={n.id}>
            <Ledgers x={hx} space={space} staffPos={n.staffPos} lineY={lineY} />
            {n.accidental !== null && (
              <Accidental
                x={hx - (1.15 + accidentalRank(el, i) * 0.95) * space}
                y={hy}
                space={space}
                alter={n.accidental}
              />
            )}
            <NoteHead x={hx} y={hy} space={space} kind={headKind} />
            {el.dots > 0 && (
              <Dots
                x={hx + (HEAD_W / 2 + 0.15) * space + (shifts[i] > 0 ? HEAD_W * space : 0)}
                // A dot never sits on a line: on one, it lifts into the space above.
                y={hy - (Math.abs(n.staffPos) % 2 === 0 ? space / 2 : 0)}
                space={space}
                count={el.dots}
              />
            )}
          </g>
        );
      })}
      {el.value !== 1 && <Stem x={stemX} y1={stemFrom} y2={stemTo} space={space} />}
      {el.value >= 8 && !el.beam && (
        <Flags x={stemX} y={stemTo} space={space} dir={up ? 'up' : 'down'} value={el.value} />
      )}
    </g>
  );
}

interface BeamBar {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dir: 'up' | 'down';
}

interface BeamPlan {
  tips: Map<string, number>;
  bars: BeamBar[];
}

/**
 * Beams, and the stem tips they dictate.
 *
 * The primary beam is a straight line through the two outer stems, its slope
 * capped so it stays near horizontal, then pushed outward until no stem in the
 * group is shorter than the standard length. Secondary beams cover only the
 * runs that carry them, and a 16th alone among eighths gets the half-length
 * stub, pointing back at the note it belongs with.
 */
function planBeams(boxes: MeasureBox[], staff: StaffGeom, space: number): BeamPlan {
  const plan: BeamPlan = { tips: new Map(), bars: [] };
  const lineY = (pos: number) => lineYOf(staff, space, pos);
  for (const box of boxes) {
    const measure = measureFor(staff, box);
    for (const group of measure.beams) {
      const voice = measure.voices[group.voice];
      if (!voice) continue;
      const members = group.elementIds
        .map((id) => voice.elements.find((e) => e.id === id))
        .filter((e): e is ScoreElement => !!e);
      if (members.length < 2) continue;
      const up = members[0].stem === 'up';
      const side = (up ? 1 : -1) * ((HEAD_W / 2 - STEM_W / 2) * space);
      const xs = members.map((e) => xAt(box, e.start) + side);
      const ideal = members.map((e) => {
        const ps = e.notes.map((n) => n.staffPos);
        return lineY(up ? Math.max(...ps) : Math.min(...ps)) + (up ? -1 : 1) * STEM_LEN * space;
      });
      const span = xs[xs.length - 1] - xs[0];
      const raw = span > 0 ? (ideal[ideal.length - 1] - ideal[0]) / span : 0;
      // A beam leans, it never climbs: at most a space and a half across the
      // whole group, and never steeper than a quarter of its run.
      const cap = span > 0 ? Math.min(0.25, (1.5 * space) / span) : 0;
      const slope = Math.max(-cap, Math.min(cap, raw));
      const line = (x: number) => ideal[0] + slope * (x - xs[0]);
      const deltas = xs.map((x, i) => ideal[i] - line(x));
      const offset = up ? Math.min(0, ...deltas) : Math.max(0, ...deltas);
      const beamY = (x: number) => line(x) + offset;
      members.forEach((e, i) => plan.tips.set(e.id, beamY(xs[i])));

      const step = (BEAM_H + BEAM_GAP) * space * (up ? 1 : -1);
      const maxLevel = Math.max(...group.levels);
      for (let level = 1; level <= maxLevel; level++) {
        const dy = (level - 1) * step;
        let runStart = -1;
        for (let i = 0; i <= members.length; i++) {
          const on = i < members.length && group.levels[i] >= level;
          if (on && runStart < 0) runStart = i;
          if (on || runStart < 0) continue;
          const end = i - 1;
          const x1 = xs[runStart];
          const x2 = end > runStart ? xs[end] : x1 + 1.1 * space * (runStart > 0 ? -1 : 1);
          plan.bars.push({
            x1,
            y1: beamY(x1) + dy,
            x2,
            y2: beamY(x2) + dy,
            dir: up ? 'up' : 'down',
          });
          runStart = -1;
        }
      }
    }
  }
  return plan;
}

interface TieLine {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dir: 'up' | 'down';
}

/** Ties, matched head to head along each voice — across barlines included. */
function planTies(boxes: MeasureBox[], staff: StaffGeom, space: number): TieLine[] {
  const chains = new Map<number, { el: ScoreElement; box: MeasureBox }[]>();
  for (const box of boxes) {
    for (const voice of measureFor(staff, box).voices) {
      const list = chains.get(voice.index) ?? [];
      for (const el of voice.elements) if (el.kind === 'note') list.push({ el, box });
      chains.set(voice.index, list);
    }
  }
  const out: TieLine[] = [];
  for (const chain of chains.values()) {
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      for (const head of a.el.notes) {
        if (!head.tieTo) continue;
        const mate = b.el.notes.find((n) => n.tieFrom && n.pitch.midi === head.pitch.midi);
        if (!mate) continue;
        // A tie curves away from the stem, so the two never collide.
        const dir = a.el.stem === 'up' ? 'down' : 'up';
        const lift = (pos: number) =>
          lineYOf(staff, space, pos) + (dir === 'up' ? -0.5 : 0.5) * space;
        out.push({
          key: `${a.el.id}-${head.id}`,
          x1: xAt(a.box, a.el.start) + 0.75 * space,
          y1: lift(head.staffPos),
          x2: xAt(b.box, b.el.start) - 0.75 * space,
          y2: lift(mate.staffPos),
          dir,
        });
      }
    }
  }
  return out;
}

interface StaffLayerProps {
  staff: StaffGeom;
  boxes: MeasureBox[];
  space: number;
  /** x of the final barline: the staff is ruled to there and stops. */
  width: number;
  /** Index of the last bar in the part, which takes the closing barline. */
  lastIndex: number;
  selected: Set<string>;
  onSelect: (el: ScoreElement, additive: boolean) => void;
}

function StaffLayer({
  staff,
  boxes,
  space,
  width,
  lastIndex,
  selected,
  onSelect,
}: StaffLayerProps) {
  const lineY = (pos: number) => lineYOf(staff, space, pos);
  const beams = useMemo(() => planBeams(boxes, staff, space), [boxes, staff, space]);
  const ties = useMemo(() => planTies(boxes, staff, space), [boxes, staff, space]);

  return (
    <g>
      {[0, 2, 4, 6, 8].map((pos) => (
        <line
          key={pos}
          className="sc-staff-line"
          x1={0}
          y1={lineY(pos)}
          x2={width}
          y2={lineY(pos)}
          strokeWidth={LINE_W * space}
        />
      ))}
      {boxes.map((box) => {
        const measure = measureFor(staff, box);
        return (
          <g key={box.m.index}>
            {box.sigX !== null && (
              <TimeSigGlyph
                x={box.sigX}
                space={space}
                num={box.m.sig.num}
                den={box.m.sig.den}
                topY={lineY(6)}
                bottomY={lineY(2)}
              />
            )}
            {/* The part ends on the thin-then-thick pair a reader expects. */}
            <line
              className="sc-barline"
              x1={box.i === lastIndex ? box.end - 0.7 * space : box.end}
              y1={lineY(8)}
              x2={box.i === lastIndex ? box.end - 0.7 * space : box.end}
              y2={lineY(0)}
              strokeWidth={LINE_W * space * 1.5}
            />
            {box.i === lastIndex && (
              <line
                className="sc-barline"
                x1={box.end - 0.2 * space}
                y1={lineY(8)}
                x2={box.end - 0.2 * space}
                y2={lineY(0)}
                strokeWidth={LINE_W * space * 4}
              />
            )}
            <text className="sc-barnum" x={box.x + 2} y={lineY(8) - 1.5 * space}>
              {box.m.number}
            </text>
            {measure.voices.map((voice) =>
              voice.elements.map((el) => (
                <ElementView
                  key={el.id}
                  el={el}
                  x={xAt(box, el.start)}
                  space={space}
                  staff={staff}
                  barNumber={box.m.number}
                  selected={el.noteIds.some((id) => selected.has(id))}
                  beamTipY={beams.tips.get(el.id) ?? null}
                  onSelect={onSelect}
                />
              )),
            )}
          </g>
        );
      })}
      {beams.bars.map((b, i) => (
        <Beam key={i} x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} space={space} dir={b.dir} />
      ))}
      {ties.map((t) => (
        <Tie key={t.key} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} space={space} dir={t.dir} />
      ))}
    </g>
  );
}

export function ScoreView() {
  const project = useProjectStore((s) => s.project);
  const editClipId = useUiStore((s) => s.editClipId);
  const selectedClipId = useUiStore((s) => s.selectedClipId);
  const selectedNoteIds = useUiStore((s) => s.selectedNoteIds);
  const [sizeIndex, setSizeIndex] = useState(2);
  const [grid, setGrid] = useState(0.25);
  const [clefChoice, setClefChoice] = useState<'auto' | 'treble' | 'bass' | 'grand'>('auto');
  const [keyChoice, setKeyChoice] = useState('auto');
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [win, setWin] = useState({ left: 0, right: 3000 });

  const space = SIZES[sizeIndex];
  const pxPerBeat = space * 7.5;

  const clip = useMemo((): MidiClip | null => {
    const byId = (id: string | null) => {
      const c = id ? project.clips.find((x) => x.id === id) : undefined;
      return c?.type === 'midi' ? c : null;
    };
    return byId(editClipId) ?? byId(selectedClipId) ?? null;
  }, [project.clips, editClipId, selectedClipId]);

  const map = tempoMapOf(project);

  const key = useMemo(() => {
    if (keyChoice === 'auto') return undefined;
    const [tonic, mode] = keyChoice.split(':');
    return keyFromTonic(Number(tonic), mode === 'minor' ? 'minor' : 'major');
  }, [keyChoice]);

  /**
   * The engraved model. It depends on the clip, the tempo map and the options
   * alone — never on scroll or selection — so neither scrolling nor clicking a
   * note ever re-engraves a bar.
   */
  const engraved = useMemo(() => {
    if (!clip) return null;
    let min = 127;
    let max = 0;
    for (const n of clip.notes) {
      if (n.pitch < min) min = n.pitch;
      if (n.pitch > max) max = n.pitch;
    }
    const auto = clip.notes.length ? chooseClef(min, max) : 'treble';
    const mode = clefChoice === 'auto' ? auto : clefChoice;
    const opts = { grid, key };
    if (mode === 'grand') {
      return {
        grand: true,
        staves: [
          buildScore(clip, map, { ...opts, clef: 'treble', pitchMin: 60 }),
          buildScore(clip, map, { ...opts, clef: 'bass', pitchMax: 59 }),
        ],
      };
    }
    return { grand: false, staves: [buildScore(clip, map, { ...opts, clef: mode })] };
  }, [clip, map, grid, key, clefChoice]);

  const sheet = useMemo(() => {
    if (!engraved) return null;
    const [first] = engraved.staves;
    const counts = first.measures.map((_, i) => {
      let most = 1;
      for (const s of engraved.staves) {
        const m = s.measures[i];
        if (!m) continue;
        most = Math.max(
          most,
          m.voices.reduce((a, v) => a + v.elements.length, 0),
        );
      }
      return most;
    });
    const boxes = layoutMeasures(first.measures, counts, space, pxPerBeat, space);
    const staves: StaffGeom[] = engraved.staves.map((score, i) => ({
      score,
      clef: score.clef,
      top: (PAD_Y + i * GRAND_GAP) * space,
    }));
    const ruled = boxes[boxes.length - 1]?.end ?? 0;
    return {
      boxes,
      staves,
      ruled,
      width: ruled + space * 2,
      height: (PAD_Y * 2 + 4 + (staves.length - 1) * GRAND_GAP) * space,
      gutter: (5.6 + Math.min(7, Math.abs(first.key.fifths)) * 1.05) * space,
      key: first.key,
    };
  }, [engraved, space, pxPerBeat]);

  const updateWin = useCallback(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const q = (n: number) => Math.floor(n / 400) * 400;
    const next = {
      left: q(Math.max(0, sc.scrollLeft - sc.clientWidth)),
      right: q(sc.scrollLeft + sc.clientWidth * 2) + 400,
    };
    setWin((cur) => (cur.left === next.left && cur.right === next.right ? cur : next));
  }, []);
  useEffect(() => {
    updateWin();
  }, [updateWin, clip?.id, space, grid]);

  // The playhead is written straight to the DOM on the engine's frame callback,
  // as in the piano roll: a React state update per frame would re-render the
  // whole sheet sixty times a second.
  useEffect(() => {
    if (!sheet) return;
    const { boxes, gutter } = sheet;
    return engine.onFrame(() => {
      const el = playheadRef.current;
      if (!el) return;
      const beat = engine.getPositionBeats();
      const box = boxes.find((b) => beat >= b.m.startBeat && beat < b.m.startBeat + b.m.beats);
      if (!box || !engine.isPlaying()) {
        el.style.opacity = '0';
        return;
      }
      el.style.opacity = '1';
      el.style.transform = `translateX(${gutter + xAt(box, beat - box.m.startBeat)}px)`;
    });
  }, [sheet]);

  const selectElement = useCallback((el: ScoreElement, additive: boolean) => {
    const ui = useUiStore.getState();
    if (!additive) {
      ui.set({ selectedNoteIds: [...el.noteIds] });
      return;
    }
    const next = new Set(ui.selectedNoteIds);
    const had = el.noteIds.every((id) => next.has(id));
    for (const id of el.noteIds) {
      if (had) next.delete(id);
      else next.add(id);
    }
    ui.set({ selectedNoteIds: [...next] });
  }, []);

  /** Left and right walk the engraved notes, so the staff is playable by keyboard. */
  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // Clicking empty staff clears the selection; Escape is its keyboard twin.
      useUiStore.getState().set({ selectedNoteIds: [] });
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const all = [...e.currentTarget.querySelectorAll<SVGGElement>('[data-el]')];
    const at = all.indexOf(document.activeElement as unknown as SVGGElement);
    if (at < 0) return;
    const next = all[at + (e.key === 'ArrowRight' ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
  }, []);

  const selected = useMemo(() => new Set(selectedNoteIds), [selectedNoteIds]);

  if (!clip || !engraved || !sheet) {
    return (
      <div className="sc" data-testid="score-view">
        <div className="sc-empty">
          <Icon name="score" size={28} />
          <div>Select a MIDI clip to see it engraved.</div>
        </div>
      </div>
    );
  }

  const visible = sheet.boxes.filter((b) => b.end >= win.left && b.x <= win.right);

  return (
    <div className="sc" data-testid="score-view">
      <div className="sc-toolbar">
        <span className="sc-title" title={clip.name}>
          {clip.name}
        </span>
        <span className="sc-readout" data-testid="sc-key" title="Key used for spelling">
          {sheet.key.name}
        </span>
        <label>
          Key
          <select
            value={keyChoice}
            onChange={(e) => setKeyChoice(e.target.value)}
            aria-label="Key signature"
          >
            <option value="auto">Auto</option>
            {TONICS.map((name, pc) => (
              <option key={`${pc}:major`} value={`${pc}:major`}>{`${name} major`}</option>
            ))}
            {TONICS.map((name, pc) => (
              <option key={`${pc}:minor`} value={`${pc}:minor`}>{`${name} minor`}</option>
            ))}
          </select>
        </label>
        <label>
          Staff
          <select
            value={clefChoice}
            onChange={(e) => setClefChoice(e.target.value as typeof clefChoice)}
            aria-label="Clef"
          >
            <option value="auto">Auto</option>
            <option value="treble">Treble</option>
            <option value="bass">Bass</option>
            <option value="grand">Grand</option>
          </select>
        </label>
        <label>
          Notate as
          <select
            value={grid}
            onChange={(e) => setGrid(Number(e.target.value))}
            aria-label="Notation quantise grid"
          >
            {GRIDS.map((g) => (
              <option key={g.label} value={g.beats}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <div className="sc-zoom">
          <button
            className="icon-btn"
            onClick={() => setSizeIndex((i) => Math.max(0, i - 1))}
            disabled={sizeIndex === 0}
            aria-label="Smaller staff"
            title="Smaller staff"
          >
            <Icon name="minus" size={13} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setSizeIndex((i) => Math.min(SIZES.length - 1, i + 1))}
            disabled={sizeIndex === SIZES.length - 1}
            aria-label="Larger staff"
            title="Larger staff"
          >
            <Icon name="plus" size={13} />
          </button>
        </div>
      </div>

      <div className="sc-scroll" ref={scrollRef} onScroll={updateWin} onKeyDown={onKeyDown}>
        <div className="sc-inner" style={{ height: sheet.height }}>
          {/* Clef and key stay pinned: scrolled away, a staff cannot be read. */}
          <svg
            className="sc-gutter"
            width={sheet.gutter}
            height={sheet.height}
            role="img"
            aria-label={`${sheet.staves.map((s) => s.clef).join(' and ')} clef, ${sheet.key.name}`}
            focusable="false"
          >
            {sheet.staves.map((staff, i) => (
              <g key={i}>
                {[0, 2, 4, 6, 8].map((pos) => (
                  <line
                    key={pos}
                    className="sc-staff-line"
                    x1={0}
                    y1={lineYOf(staff, space, pos)}
                    x2={sheet.gutter}
                    y2={lineYOf(staff, space, pos)}
                    strokeWidth={LINE_W * space}
                  />
                ))}
                <ClefGlyph
                  /* The clef's own path reaches left of its anchor, so it is
                     inset far enough that the gutter never clips it. */
                  x={2.9 * space}
                  y={lineYOf(staff, space, staff.clef === 'treble' ? 2 : 6)}
                  space={space}
                  clef={staff.clef}
                />
                {keySignatureGlyphs(sheet.key, staff.clef).map((g, j) => (
                  <Accidental
                    key={`${g.step}${j}`}
                    x={(4.8 + j * 1.05) * space}
                    y={lineYOf(staff, space, g.staffPos)}
                    space={space}
                    alter={g.alter}
                  />
                ))}
              </g>
            ))}
            {sheet.staves.length > 1 && (
              <path
                className="sc-brace"
                d={`M ${0.55 * space} ${lineYOf(sheet.staves[0], space, 8)} C ${-0.5 * space} ${lineYOf(
                  sheet.staves[0],
                  space,
                  0,
                )} ${1.5 * space} ${lineYOf(sheet.staves[1], space, 8)} ${0.55 * space} ${lineYOf(
                  sheet.staves[1],
                  space,
                  0,
                )}`}
              />
            )}
          </svg>

          <svg
            className="sc-sheet"
            width={sheet.width}
            height={sheet.height}
            onPointerDown={() => useUiStore.getState().set({ selectedNoteIds: [] })}
            aria-label={`${sheet.boxes.length} bars, ${sheet.key.name}`}
          >
            {sheet.staves.map((staff, i) => (
              <StaffLayer
                key={i}
                staff={staff}
                boxes={visible}
                space={space}
                width={sheet.ruled}
                lastIndex={sheet.boxes.length - 1}
                selected={selected}
                onSelect={selectElement}
              />
            ))}
            {sheet.staves.length > 1 &&
              visible.map((box) => (
                <line
                  key={box.m.index}
                  className="sc-barline"
                  x1={box.end}
                  y1={lineYOf(sheet.staves[0], space, 0)}
                  x2={box.end}
                  y2={lineYOf(sheet.staves[1], space, 8)}
                  strokeWidth={LINE_W * space * 1.5}
                />
              ))}
          </svg>

          <div className="sc-playhead" ref={playheadRef} style={{ height: sheet.height }} />
        </div>
      </div>
    </div>
  );
}
