/**
 * The Score editor: the open MIDI clip engraved as notation, and editable on
 * the staff.
 *
 * Selection is the shared note selection, so the piano roll and the score always
 * agree on what is selected and an edit made in either re-engraves in the other.
 * Everything the staff writes back goes through the project store's note actions
 * — `addNote`, `transformNotes`, `deleteNotes`, and `updateNotes` inside a
 * gesture for drags — so every edit lands on the same undo stack as the rest of
 * the app.
 *
 * Every musical decision — bar splitting, note values, spelling, voices, beams,
 * rests — belongs to `model/notation.ts`, and every editing decision — which
 * pitch a staff line means, how long an entered note may be — to
 * `model/scoreEdit.ts`. This file is layout, paint and pointers only: it turns a
 * `Score` into coordinates measured in staff spaces and hands them to the glyphs
 * in `Glyphs.tsx`, so one `staffSpace` number sizes everything.
 *
 * Performance follows the piano roll's rule. The engraved model is memoised on
 * the clip and the tempo map, never on scroll or selection, and only the
 * measures inside the scrolled window are mounted — so a three-hundred-bar part
 * scrolls exactly as cheaply as a four-bar one.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { engine } from '../../audio/engine';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { clamp, snapBeat, tempoMapOf } from '../../model/music';
import {
  buildScore,
  chooseClef,
  keyFromTonic,
  keySignatureGlyphs,
  type Clef,
  type KeySignature,
  type NoteValue,
  type Score,
  type ScoreElement,
  type ScoreMeasure,
} from '../../model/notation';
import {
  durationBeats,
  forceAccidental,
  lastGridStart,
  pitchAtStaffPosition,
  planInsert,
  SCORE_VALUES,
  stepPitchBy,
  valueOfBeats,
  writableLength,
  type DurationChoice,
  type FitContext,
} from '../../model/scoreEdit';
import type { MidiClip, Note } from '../../model/types';
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

/**
 * The accidental buttons change the *pitch*, not the spelling.
 *
 * A `Note` stores a MIDI number, so the letter is re-derived from the key on
 * every re-engrave and a forced spelling has nowhere to live. What the buttons
 * can do honestly is set the note to the sharp, flat or natural of the staff
 * line it is written on — so a printed F♯ asked for a natural sounds F — and
 * that is what their labels say.
 */
const ACCIDENTALS: { alter: -1 | 0 | 1; name: string; id: string }[] = [
  { alter: -1, name: 'flat', id: 'flat' },
  { alter: 0, name: 'natural', id: 'natural' },
  { alter: 1, name: 'sharp', id: 'sharp' },
];

/**
 * What to say when the metre would not write the palette's value whole.
 *
 * It is not an error and not a refusal — the note is entered, at the longest
 * value the beat it landed on can carry — but a musician who asked for a dotted
 * quarter and got a quarter deserves to be told why rather than left to notice.
 */
function shortfall(length: number): string {
  const fitted = valueOfBeats(length);
  return fitted
    ? `Written as a ${fitted.dots ? 'dotted ' : ''}${VALUE_NAMES[fitted.value]} — the longest value this beat can carry.`
    : 'Shortened to what this beat can carry.';
}

/** Staff positions a click may address — a couple of ledger lines either way. */
const POS_MIN = -12;
const POS_MAX = 20;

/** Vertical reach of one staff's click zone, in staff positions above and below. */
const STAFF_REACH = 14;

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
  /** Pixels per beat inside this element's bar — the drag's horizontal scale. */
  ppb: number;
  onSelect: (el: ScoreElement, additive: boolean) => void;
  onNoteDown: (el: ScoreElement, ppb: number, e: ReactPointerEvent) => void;
}

function ElementView({
  el,
  x,
  space,
  staff,
  barNumber,
  selected,
  beamTipY,
  ppb,
  onSelect,
  onNoteDown,
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
      onPointerDown={(e) => onNoteDown(el, ppb, e)}
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
  onNoteDown: (el: ScoreElement, ppb: number, e: ReactPointerEvent) => void;
}

function StaffLayer({
  staff,
  boxes,
  space,
  width,
  lastIndex,
  selected,
  onSelect,
  onNoteDown,
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
                  ppb={box.contentW / box.m.beats}
                  onSelect={onSelect}
                  onNoteDown={onNoteDown}
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

/**
 * The palette's own note, drawn with the same glyphs the staff uses.
 *
 * A duration palette that spelled its values in words would be the only place
 * in the editor where a musician had to read instead of look, so the buttons
 * carry real note heads, stems and flags at a small staff space.
 */
function DurationGlyph({ value, dots }: DurationChoice) {
  const space = 5;
  const x = 6.5;
  const y = 17;
  const tip = y - STEM_LEN * space;
  const stemX = x + (HEAD_W / 2 - STEM_W / 2) * space;
  return (
    <svg className="sc-dur-glyph" width={19} height={24} viewBox="0 0 19 24" aria-hidden="true">
      <NoteHead x={x} y={y} space={space} kind={headKindFor(value)} />
      {value !== 1 && <Stem x={stemX} y1={y} y2={tip} space={space} />}
      {value >= 8 && <Flags x={stemX} y={tip} space={space} dir="up" value={value} />}
      {dots > 0 && (
        <Dots x={x + (HEAD_W / 2 + 0.15) * space} y={y - space / 2} space={space} count={1} />
      )}
    </svg>
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
  /** The palette: what note entry writes and what a duration key applies. */
  const [duration, setDuration] = useState<DurationChoice>({ value: 4, dots: 0 });
  /** Note input mode. Off, the staff selects; on, an empty spot takes a note. */
  const [inputMode, setInputMode] = useState(false);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<SVGSVGElement>(null);
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

  const selected = useMemo(() => new Set(selectedNoteIds), [selectedNoteIds]);
  const visible = useMemo(
    () => (sheet ? sheet.boxes.filter((b) => b.end >= win.left && b.x <= win.right) : []),
    [sheet, win],
  );

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

  // ------------------------------------------------------------- edit model

  /**
   * What the editor needs to know to place a note: where the clip sits, how
   * long it is, and the grid it is engraved on. Fitting an entered duration
   * uses this, so the palette and the page can never disagree.
   */
  const fitCtx = useMemo(
    (): FitContext | null =>
      clip ? { map, clipStart: clip.start, clipLength: Math.max(grid, clip.length), grid } : null,
    [clip, map, grid],
  );

  const spellingKey: KeySignature | null = sheet?.key ?? null;

  const preview = useCallback(
    (pitch: number) => {
      if (!clip) return;
      engine.liveNoteOn(clip.trackId, clamp(Math.round(pitch), 0, 127), 84);
      setTimeout(() => engine.liveNoteOff(clip.trackId, clamp(Math.round(pitch), 0, 127)), 170);
    },
    [clip],
  );

  const selectedNotes = useCallback(
    (): Note[] => (clip ? clip.notes.filter((n) => selected.has(n.id)) : []),
    [clip, selected],
  );

  /**
   * Write a duration onto the selection.
   *
   * Each note is refitted where it actually sits, so the same press can give a
   * dotted quarter on beat 1 and a plain quarter on beat 2 of the same bar —
   * the value asked for is the value the metre will print, not a length forced
   * on the engraver.
   */
  const applyDuration = useCallback(
    (choice: DurationChoice) => {
      if (!clip || !fitCtx) return;
      const notes = selectedNotes();
      if (notes.length === 0) return;
      const want = durationBeats(choice);
      let shortened: number | null = null;
      const next = notes.map((n) => {
        const length = writableLength(fitCtx, n.start, want);
        if (length <= 0) return n;
        if (length < want - 1e-6 && shortened === null) shortened = length;
        return { ...n, length };
      });
      useProjectStore.getState().transformNotes(clip.id, next);
      if (shortened !== null) useUiStore.getState().toast('info', shortfall(shortened));
    },
    [clip, fitCtx, selectedNotes],
  );

  const chooseDuration = useCallback(
    (choice: DurationChoice) => {
      setDuration(choice);
      applyDuration(choice);
    },
    [applyDuration],
  );

  /**
   * Force an accidental on the selection. This moves the pitch to the sharp,
   * flat or natural of the staff line each note is written on — see
   * `ACCIDENTALS` for why spelling alone cannot be forced.
   */
  const applyAccidental = useCallback(
    (alter: -1 | 0 | 1) => {
      if (!clip || !spellingKey) return;
      const notes = selectedNotes();
      if (notes.length === 0) return;
      const next = notes.map((n) => ({
        ...n,
        pitch: clamp(forceAccidental(n.pitch, spellingKey, alter), 0, 127),
      }));
      useProjectStore.getState().transformNotes(clip.id, next);
      if (next[0]) preview(next[0].pitch);
    },
    [clip, spellingKey, selectedNotes, preview],
  );

  const deleteSelection = useCallback(() => {
    if (!clip || selectedNoteIds.length === 0) return;
    useProjectStore.getState().deleteNotes(clip.id, selectedNoteIds);
    useUiStore.getState().set({ selectedNoteIds: [] });
  }, [clip, selectedNoteIds]);

  /**
   * Move the selection by staff steps and by grid positions, in one undo step.
   *
   * A note stops at the clip's walls rather than stretching it: the clip's
   * length is an arrangement decision, and a nudge on the staff is not.
   */
  const nudgeSelection = useCallback(
    (steps: number, gridSteps: number) => {
      if (!clip || !spellingKey) return;
      const notes = selectedNotes();
      if (notes.length === 0) return;
      const limit = Math.max(grid, clip.length);
      const next = notes.map((n) => ({
        ...n,
        pitch: steps ? clamp(stepPitchBy(n.pitch, spellingKey, steps), 0, 127) : n.pitch,
        start: gridSteps
          ? clamp(
              snapBeat(n.start + gridSteps * grid, grid),
              0,
              Math.max(0, Math.min(limit - n.length, lastGridStart(limit, grid))),
            )
          : n.start,
      }));
      useProjectStore.getState().transformNotes(clip.id, next);
      if (steps && next[0]) preview(next[0].pitch);
    },
    [clip, spellingKey, selectedNotes, grid, preview],
  );

  // ------------------------------------------------------------- geometry

  /** Sheet-local coordinates of a pointer event. */
  const sheetPoint = useCallback((clientX: number, clientY: number) => {
    const rect = sheetRef.current?.getBoundingClientRect();
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : null;
  }, []);

  /** The staff a y lands on, and the staff position it names there. */
  const staffAt = useCallback(
    (y: number) => {
      if (!sheet) return null;
      let best: { staff: StaffGeom; pos: number } | null = null;
      for (const staff of sheet.staves) {
        const pos = Math.round((staff.top + 4 * space - y) / (space / 2));
        if (Math.abs(pos - 4) > STAFF_REACH) continue;
        if (!best || Math.abs(pos - 4) < Math.abs(best.pos - 4)) best = { staff, pos };
      }
      return best;
    },
    [sheet, space],
  );

  /** The clip-relative beat an x lands on, walked through the laid-out bars. */
  const beatAt = useCallback(
    (x: number) => {
      if (!sheet || !clip) return null;
      const box = sheet.boxes.find((b) => x >= b.x && x < b.end) ?? sheet.boxes[0];
      if (!box) return null;
      const inBar = clamp(((x - box.contentX) / box.contentW) * box.m.beats, 0, box.m.beats);
      return box.m.startBeat - clip.start + inBar;
    },
    [sheet, clip],
  );

  /** Note ids whose heads fall inside a sheet-local rectangle. */
  const headsInRect = useCallback(
    (x0: number, y0: number, x1: number, y1: number): string[] => {
      if (!sheet) return [];
      const hits: string[] = [];
      for (const staff of sheet.staves) {
        for (const box of visible) {
          for (const voice of measureFor(staff, box).voices) {
            for (const el of voice.elements) {
              if (el.kind !== 'note') continue;
              const x = xAt(box, el.start);
              if (x < x0 || x > x1) continue;
              for (const head of el.notes) {
                const y = lineYOf(staff, space, head.staffPos);
                if (y >= y0 && y <= y1) hits.push(...head.noteIds);
              }
            }
          }
        }
      }
      return hits;
    },
    [sheet, visible, space],
  );

  // ---------------------------------------------------------------- input

  /** Insert one note where the pointer is, at the palette's duration. */
  const insertAt = useCallback(
    (clientX: number, clientY: number) => {
      if (!clip || !fitCtx || !spellingKey) return;
      const point = sheetPoint(clientX, clientY);
      const hit = point && staffAt(point.y);
      const beat = point && beatAt(point.x);
      if (!point || !hit || beat === null) return;
      const plan = planInsert(fitCtx, beat, durationBeats(duration));
      if (!plan) return;
      const pos = clamp(hit.pos, POS_MIN, POS_MAX);
      const pitch = clamp(pitchAtStaffPosition(pos, hit.staff.clef, spellingKey).midi, 0, 127);
      const id = useProjectStore.getState().addNote(clip.id, {
        start: plan.start,
        length: plan.length,
        pitch,
        velocity: 100,
      });
      useUiStore.getState().set({ selectedNoteIds: [id] });
      preview(pitch);
      if (plan.shortenedFrom !== null) useUiStore.getState().toast('info', shortfall(plan.length));
    },
    [clip, fitCtx, spellingKey, sheetPoint, staffAt, beatAt, duration, preview],
  );

  /**
   * Dragging a head.
   *
   * Vertical movement is measured in staff steps, not semitones, and every
   * landing pitch is respelled by the key — dragging up one step off E in C
   * major gives F, off F gives G. Horizontal movement is measured in the bar
   * the drag started in and snapped to the score's own grid. The whole drag is
   * one gesture, so it is one entry on the undo stack.
   */
  const dragStart = useRef<{ el: ScoreElement; ppb: number } | null>(null);
  const dragNotes = usePointerDrag<{
    ids: string[];
    orig: Map<string, Note>;
    ppb: number;
    lastPitch: number;
  }>({
    onStart: () => {
      const pending = dragStart.current;
      const empty = { ids: [], orig: new Map<string, Note>(), ppb: 1, lastPitch: 0 };
      if (!pending || !clip) return empty;
      const ui = useUiStore.getState();
      const ids = ui.selectedNoteIds.includes(pending.el.noteIds[0])
        ? ui.selectedNoteIds
        : pending.el.noteIds;
      useProjectStore.getState().beginGesture();
      const orig = new Map<string, Note>();
      for (const n of clip.notes) if (ids.includes(n.id)) orig.set(n.id, { ...n });
      return { ids, orig, ppb: pending.ppb, lastPitch: orig.get(ids[0])?.pitch ?? 0 };
    },
    onMove: (dx, dy, _e, d) => {
      if (!clip || !spellingKey || d.ids.length === 0) return;
      const dBeats = dx / d.ppb;
      const steps = -Math.round(dy / (space / 2));
      const limit = Math.max(grid, clip.length);
      useProjectStore.getState().updateNotes(clip.id, d.ids, (n) => {
        const o = d.orig.get(n.id);
        if (!o) return {};
        return {
          start: clamp(snapBeat(o.start + dBeats, grid), 0, Math.max(0, limit - o.length)),
          pitch: steps ? clamp(stepPitchBy(o.pitch, spellingKey, steps), 0, 127) : o.pitch,
        };
      });
      const head = d.orig.get(d.ids[0]);
      const now = head && steps ? stepPitchBy(head.pitch, spellingKey, steps) : (head?.pitch ?? 0);
      if (now !== d.lastPitch) {
        d.lastPitch = now;
        preview(now);
      }
    },
    onEnd: () => {
      dragStart.current = null;
      useProjectStore.getState().endGesture();
    },
  });

  const onNoteDown = useCallback(
    (el: ScoreElement, ppb: number, e: ReactPointerEvent) => {
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      const already = el.noteIds.every((id) => selected.has(id));
      // A grab on an already-selected head keeps the rest of the selection, so
      // a chord or a phrase can be dragged as one; anything else selects first.
      if (additive || !already) selectElement(el, additive);
      dragStart.current = { el, ppb };
      dragNotes(e);
    },
    [selected, selectElement, dragNotes],
  );

  /**
   * The empty staff: a marquee in selection mode, a new note in input mode.
   *
   * The press clears the selection and the sweep rebuilds it, so a click that
   * never moved is a marquee of zero size and selects nothing. Input mode
   * writes its note on the *release* instead, and only if the pointer stayed
   * put — otherwise a touch scroll across the staff would leave a trail of
   * notes behind it.
   */
  const dragSheet = usePointerDrag<{
    x: number;
    y: number;
    base: string[];
    inserting: boolean;
    clientX: number;
    clientY: number;
  }>({
    onStart: (e) => {
      const point = sheetPoint(e.clientX, e.clientY);
      const at = { clientX: e.clientX, clientY: e.clientY };
      if (inputMode) return { x: 0, y: 0, base: [], inserting: true, ...at };
      const base = e.shiftKey ? [...useUiStore.getState().selectedNoteIds] : [];
      if (!e.shiftKey) useUiStore.getState().set({ selectedNoteIds: [] });
      return { x: point?.x ?? 0, y: point?.y ?? 0, base, inserting: false, ...at };
    },
    onMove: (_dx, _dy, e, d) => {
      if (d.inserting) return;
      const point = sheetPoint(e.clientX, e.clientY);
      if (!point) return;
      const x0 = Math.min(d.x, point.x);
      const x1 = Math.max(d.x, point.x);
      const y0 = Math.min(d.y, point.y);
      const y1 = Math.max(d.y, point.y);
      setMarquee({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      const hits = headsInRect(x0, y0, x1, y1);
      useUiStore.getState().set({ selectedNoteIds: [...new Set([...d.base, ...hits])] });
    },
    onEnd: (moved, d) => {
      setMarquee(null);
      if (d.inserting && !moved) insertAt(d.clientX, d.clientY);
    },
  });

  /**
   * Keys, scoped to the editor.
   *
   * The handler sits on the panel rather than on the staff, because clicking a
   * palette button moves focus onto it and the digits have to keep working
   * afterwards — pressing 3 straight after picking a duration must not fall
   * through to the arrangement's tool row. Every branch stops the event for the
   * same reason: the digits, Delete and the arrows all mean something else
   * globally, and the editor the user is looking at should win. A field keeps
   * its own keys, so the selects still open with the arrows.
   *
   * Arrows walk the engraved notes only when nothing is selected, so the staff
   * stays readable by keyboard alone; Alt+arrow walks it regardless.
   */
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el?.isContentEditable) {
        return;
      }
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const take = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      if (mod && k === 'a' && clip) {
        take();
        useUiStore.getState().set({ selectedNoteIds: clip.notes.map((n) => n.id) });
        return;
      }
      // Undo, save and the rest of the global set stay global.
      if (mod || e.altKey) {
        if (e.altKey && (k === 'arrowleft' || k === 'arrowright')) {
          const all = [...e.currentTarget.querySelectorAll<SVGGElement>('[data-el]')];
          const at = all.indexOf(document.activeElement as unknown as SVGGElement);
          const next = all[at + (k === 'arrowright' ? 1 : -1)];
          if (at >= 0 && next) {
            take();
            next.focus();
          }
        }
        return;
      }

      if (k === 'escape') {
        take();
        useUiStore.getState().set({ selectedNoteIds: [] });
        return;
      }
      if (k === 'delete' || k === 'backspace') {
        if (selectedNoteIds.length === 0) return;
        take();
        deleteSelection();
        return;
      }
      if (k === 'i') {
        take();
        setInputMode((on) => !on);
        return;
      }
      if (k === '.') {
        take();
        chooseDuration({ ...duration, dots: duration.dots === 1 ? 0 : 1 });
        return;
      }
      if (k >= '1' && k <= '6') {
        take();
        chooseDuration({ value: SCORE_VALUES[Number(k) - 1], dots: duration.dots });
        return;
      }
      if (k === 'arrowup' || k === 'arrowdown') {
        if (selectedNoteIds.length === 0) return;
        take();
        // Shift is the octave, which on a staff is seven steps, not twelve.
        nudgeSelection((k === 'arrowup' ? 1 : -1) * (e.shiftKey ? 7 : 1), 0);
        return;
      }
      if (k === 'arrowleft' || k === 'arrowright') {
        const dir = k === 'arrowright' ? 1 : -1;
        if (selectedNoteIds.length > 0) {
          take();
          nudgeSelection(0, dir);
          return;
        }
        const all = [...e.currentTarget.querySelectorAll<SVGGElement>('[data-el]')];
        const at = all.indexOf(document.activeElement as unknown as SVGGElement);
        const next = all[at + dir];
        if (at < 0 || !next) return;
        take();
        next.focus();
      }
    },
    [clip, duration, selectedNoteIds, chooseDuration, deleteSelection, nudgeSelection],
  );

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

  const hasSelection = selectedNoteIds.length > 0;

  return (
    <div className="sc" data-testid="score-view" onKeyDown={onKeyDown}>
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

      <div className="sc-toolbar sc-editbar" role="group" aria-label="Score editing">
        <button
          className={`sc-tool${inputMode ? ' on' : ''}`}
          data-testid="sc-input-mode"
          aria-pressed={inputMode}
          aria-label="Note input mode: click the staff to enter a note"
          title="Note input (I) — click a staff position to enter a note"
          onClick={() => setInputMode((on) => !on)}
        >
          <Icon name="pencil" size={12} />
          Input
        </button>

        <div className="sc-palette" role="group" aria-label="Note duration">
          {SCORE_VALUES.map((value, i) => {
            const beats = durationBeats({ value, dots: duration.dots });
            const tooShort = beats < grid;
            return (
              <button
                key={value}
                className={`sc-dur${duration.value === value ? ' on' : ''}`}
                data-testid={`sc-dur-${value}`}
                aria-pressed={duration.value === value}
                aria-label={`${duration.dots ? 'Dotted ' : ''}${VALUE_NAMES[value]} note${
                  hasSelection ? ', and apply it to the selection' : ''
                }`}
                title={`${VALUE_NAMES[value]} (${i + 1})${
                  tooShort ? ' — shorter than the notation grid' : ''
                }`}
                disabled={tooShort}
                onClick={() => chooseDuration({ value, dots: duration.dots })}
              >
                <DurationGlyph value={value} dots={duration.dots} />
              </button>
            );
          })}
          <button
            className={`sc-dur sc-dot${duration.dots ? ' on' : ''}`}
            data-testid="sc-dot"
            aria-pressed={duration.dots === 1}
            aria-label="Dotted note"
            title="Dot (.)"
            onClick={() => chooseDuration({ ...duration, dots: duration.dots === 1 ? 0 : 1 })}
          >
            <span aria-hidden="true">•</span>
          </button>
        </div>

        <div className="sc-palette" role="group" aria-label="Accidental">
          {ACCIDENTALS.map((a) => (
            <button
              key={a.id}
              className="sc-dur"
              data-testid={`sc-acc-${a.id}`}
              disabled={!hasSelection}
              aria-label={`Make the selected note ${a.name} — moves the pitch to the ${a.name} of its own staff line`}
              title={`${a.name[0].toUpperCase()}${a.name.slice(1)} — changes the pitch to the ${a.name} of the note's staff line`}
              onClick={() => applyAccidental(a.alter)}
            >
              <svg
                className="sc-dur-glyph"
                width={14}
                height={24}
                viewBox="0 0 14 24"
                aria-hidden="true"
              >
                <Accidental x={7} y={12} space={5} alter={a.alter} />
              </svg>
            </button>
          ))}
        </div>

        <button
          className="sc-tool"
          data-testid="sc-delete"
          disabled={!hasSelection}
          aria-label="Delete the selected notes"
          title="Delete (Del)"
          onClick={deleteSelection}
        >
          <Icon name="trash" size={12} />
        </button>

        <span className="sc-readout" data-testid="sc-selection">
          {hasSelection ? `${selectedNoteIds.length} selected` : 'None selected'}
        </span>
      </div>

      <div
        className="sc-scroll"
        ref={scrollRef}
        tabIndex={0}
        role="group"
        aria-label="Score staff — click a note to select, drag to move it, arrows to nudge it"
        onScroll={updateWin}
      >
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
            className={`sc-sheet${inputMode ? ' inputting' : ''}`}
            ref={sheetRef}
            width={sheet.width}
            height={sheet.height}
            data-testid="sc-sheet"
            onPointerDown={dragSheet}
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
                onNoteDown={onNoteDown}
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
            {marquee && (
              <rect
                className="sc-marquee"
                data-testid="sc-marquee"
                x={marquee.x}
                y={marquee.y}
                width={marquee.w}
                height={marquee.h}
              />
            )}
          </svg>

          <div className="sc-playhead" ref={playheadRef} style={{ height: sheet.height }} />
        </div>
      </div>
    </div>
  );
}
