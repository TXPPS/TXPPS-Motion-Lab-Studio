/**
 * Engraving model: MIDI notes in, a readable score out. No DOM, no React.
 *
 * A piano roll shows *when* a note sounds; notation shows *how it is counted*.
 * The whole difficulty of this module is that one duration is spelled
 * differently depending on where it starts, because a reader parses a bar by
 * seeing its metric divisions. Three eighths from the downbeat of 4/4 is a
 * dotted quarter; the same three eighths from the "and of 1" is an eighth tied
 * to a quarter, because a dot there would hide beat 2.
 *
 * Those rules are encoded once, in `fitDuration`, on top of a metric tree
 * built from the time signature:
 *
 *  - Every bar divides recursively — in halves, or in thirds where the meter
 *    is compound — down to the quantise grid. Each division point carries a
 *    *level*: 0 is the barline, and each division deeper is one weaker.
 *  - A span may be written as one note value when every division point it
 *    crosses is weaker than the one it starts on. That single rule yields the
 *    dotted quarter on the downbeat and refuses it on the off-beat.
 *  - One exception, because music is full of it: an undotted value that
 *    straddles a single stronger point *symmetrically* is syncopation and is
 *    written as one note — the quarter on the "and of 2" in 4/4. Anything else
 *    splits at the strongest point it crosses, and the pieces are tied.
 *
 * Everything else — spelling, voices, beams, rests — hangs off that. The model
 * is pure and deterministic: the same clip and options always produce the same
 * `Score` with the same element ids, so a renderer can key on them.
 */

import { barBeats, barToBeat, beatToBar, sigAtBar, type TempoMap } from './tempo';
import { suggestScales } from './scales';
import type { MidiClip, Note } from './types';

/** Beat comparisons tolerate the float drift of dividing by three. */
const EPS = 1e-6;

// ------------------------------------------------------------------- pitch

export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export type Clef = 'treble' | 'bass';

/** A note value as its denominator: 1 = whole, 4 = quarter, 32 = 32nd. */
export type NoteValue = 1 | 2 | 4 | 8 | 16 | 32;

const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_PC = [0, 2, 4, 5, 7, 9, 11];
const SHARP_ORDER: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/**
 * Staff positions of the key-signature accidentals in printing order, treble
 * clef (0 = bottom line). The zigzag is not decorative: each accidental sits
 * in the octave that keeps it inside the staff, and the bass clef repeats the
 * identical shape one step lower.
 */
const TREBLE_SHARP_POS = [8, 5, 2, 6, 3, 7, 4];
const TREBLE_FLAT_POS = [4, 7, 3, 6, 2, 5, 1];

/** Fifths of the major key on each pitch class — F♯ over G♭, D♭ over C♯. */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

// Indexed by fifths + 7.
// prettier-ignore
const MAJOR_NAMES = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
// prettier-ignore
const MINOR_NAMES = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];

export interface KeySignature {
  /** Position on the circle of fifths: −7 (C♭ major) … +7 (C♯ major). */
  fifths: number;
  /** Tonic pitch class, 0–11. */
  tonic: number;
  mode: 'major' | 'minor';
  /** Display name, e.g. "E♭ major". */
  name: string;
}

export interface SpelledPitch {
  step: Step;
  octave: number;
  /** −2 … +2 semitones from the natural step. */
  alter: number;
  midi: number;
  /** Absolute diatonic step number, C4 = 28. All staff geometry derives from it. */
  diatonic: number;
}

export function keyFromTonic(tonic: number, mode: 'major' | 'minor'): KeySignature {
  const pc = ((Math.round(tonic) % 12) + 12) % 12;
  // A minor key prints its relative major's signature, three semitones up.
  const fifths = MAJOR_FIFTHS[mode === 'minor' ? (pc + 3) % 12 : pc];
  const names = mode === 'minor' ? MINOR_NAMES : MAJOR_NAMES;
  return { fifths, tonic: pc, mode, name: `${names[fifths + 7]} ${mode}` };
}

export const C_MAJOR: KeySignature = keyFromTonic(0, 'major');

/** How the key signature already alters a step: +1 sharp, −1 flat, 0 natural. */
export function keyAlterOf(key: KeySignature, step: Step): number {
  if (key.fifths > 0) return SHARP_ORDER.slice(0, key.fifths).includes(step) ? 1 : 0;
  if (key.fifths < 0) return FLAT_ORDER.slice(0, -key.fifths).includes(step) ? -1 : 0;
  return 0;
}

/** The key signature's accidentals in printing order, placed for a clef. */
export function keySignatureGlyphs(
  key: KeySignature,
  clef: Clef,
): { step: Step; alter: number; staffPos: number }[] {
  const count = Math.min(7, Math.abs(key.fifths));
  const sharp = key.fifths >= 0;
  const order = sharp ? SHARP_ORDER : FLAT_ORDER;
  const positions = sharp ? TREBLE_SHARP_POS : TREBLE_FLAT_POS;
  const drop = clef === 'bass' ? 2 : 0;
  const out: { step: Step; alter: number; staffPos: number }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ step: order[i], alter: sharp ? 1 : -1, staffPos: positions[i] - drop });
  }
  return out;
}

/**
 * Spell a MIDI pitch in a key.
 *
 * Every letter that can reach the pitch class within a double accidental is
 * scored: agreeing with the key signature dominates (so F♯ in G major needs no
 * sign at all), then the smallest alteration, then the direction the key leans
 * — sharps in sharp keys, flats in flat keys.
 */
export function spellPitch(midi: number, key: KeySignature): SpelledPitch {
  const p = Math.round(midi);
  const pc = ((p % 12) + 12) % 12;
  let bestStep: Step = 'C';
  let bestAlter = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 7; i++) {
    const step = STEPS[i];
    let alter = pc - STEP_PC[i];
    if (alter > 6) alter -= 12;
    else if (alter < -6) alter += 12;
    if (Math.abs(alter) > 2) continue;
    const lean = alter === 0 || key.fifths >= 0 === alter > 0 ? 0 : 2;
    const cost = (alter === keyAlterOf(key, step) ? 0 : 1000) + Math.abs(alter) * 10 + lean;
    if (cost < bestCost) {
      bestCost = cost;
      bestStep = step;
      bestAlter = alter;
    }
  }
  const idx = STEPS.indexOf(bestStep);
  const octave = Math.round((p - bestAlter - STEP_PC[idx]) / 12) - 1;
  return { step: bestStep, octave, alter: bestAlter, midi: p, diatonic: octave * 7 + idx };
}

/** Diatonic step of the bottom staff line: E4 for treble, G2 for bass. */
const CLEF_BOTTOM: Record<Clef, number> = { treble: 4 * 7 + 2, bass: 2 * 7 + 4 };

/** Staff position: 0 = bottom line, 1 = the space above it, 8 = top line. */
export function staffPositionOf(diatonic: number, clef: Clef): number {
  return diatonic - CLEF_BOTTOM[clef];
}

/**
 * Clef for a pitch range. A part that reaches well below middle C *and* well
 * above it wants a grand staff; the caller then engraves one score per hand.
 */
export function chooseClef(min: number, max: number): Clef | 'grand' {
  if (min < 55 && max > 67) return 'grand';
  return (min + max) / 2 < 59 ? 'bass' : 'treble';
}

/**
 * Key detection from pitch content.
 *
 * Scale fit alone cannot separate a key from its relative minor — they hold
 * the same seven notes — so among the best-fitting candidates the tonic that
 * the music actually leans on wins: how often it is played, with its dominant
 * counted at half weight. A flat tie goes to the major.
 */
export function detectKey(pitches: number[]): KeySignature {
  const candidates = suggestScales(pitches, 24);
  if (candidates.length === 0) return C_MAJOR;
  const weight = new Array<number>(12).fill(0);
  for (const p of pitches) weight[((p % 12) + 12) % 12] += 1;
  const top = candidates[0].matches;
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const c of candidates) {
    if (c.matches < top) continue;
    const score =
      weight[c.tonic] + weight[(c.tonic + 7) % 12] * 0.5 + (c.scaleId === 'major' ? 0.1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return keyFromTonic(best.tonic, best.scaleId === 'minor' ? 'minor' : 'major');
}

// -------------------------------------------------------------- metric tree

export interface TimeSig {
  num: number;
  den: number;
}

/** Beats a note value with `dots` dots occupies (a quarter = 1). */
export function noteValueBeats(value: NoteValue, dots: number): number {
  return (4 / value) * (2 - Math.pow(2, -dots));
}

const VALUES: NoteValue[] = [1, 2, 4, 8, 16, 32];

function valueFor(duration: number, maxDots: number): { value: NoteValue; dots: number } | null {
  // Fewer dots first: 3 beats is a dotted half, never a "double-dotted" oddity.
  for (let dots = 0; dots <= maxDots; dots++) {
    for (const value of VALUES) {
      if (Math.abs(noteValueBeats(value, dots) - duration) < EPS) return { value, dots };
    }
  }
  return null;
}

function largestValueAtMost(duration: number): { value: NoteValue; dots: number } {
  for (const value of VALUES) {
    if (noteValueBeats(value, 0) <= duration + EPS) return { value, dots: 0 };
  }
  return { value: 32, dots: 0 };
}

/**
 * Top-level division of a bar.
 *
 * Meters whose numerator is a power of two (or 3, 6, 12) subdivide cleanly by
 * halving, so they go to the recursion whole. Compound and additive meters are
 * grouped first, because 9/8 is three dotted beats and 7/8 is 2+2+3 — halving
 * either would invent divisions no reader counts.
 */
function metricGroups(sig: TimeSig): number[] {
  const unit = 4 / sig.den;
  const total = sig.num * unit;
  const n = sig.num;
  if ([1, 2, 3, 4, 6, 8, 12, 16, 24, 32].includes(n)) return [total];
  if (n % 3 === 0 && sig.den >= 8) return new Array(n / 3).fill(3 * unit);
  const additive: Record<number, number[]> = {
    5: [3, 2],
    7: [2, 2, 3],
    9: [3, 3, 3],
    10: [3, 3, 2, 2],
    11: [3, 3, 3, 2],
    13: [3, 3, 3, 2, 2],
  };
  const parts = additive[n];
  return parts ? parts.map((k) => k * unit) : new Array(n).fill(unit);
}

/** The division points of one bar, each with its level (0 = barline). */
export interface MetricTree {
  beats: number;
  positions: number[];
  levels: number[];
}

const posKey = (pos: number) => Math.round(pos * 1024);

function divide(
  start: number,
  len: number,
  level: number,
  unit: number,
  grid: number,
  out: Map<number, number>,
): void {
  if (len <= grid + EPS) return;
  // Three units is a compound beat and divides in three; everything halves.
  const parts = Math.abs(len / unit - 3) < EPS ? [unit, unit, unit] : [len / 2, len / 2];
  let p = start;
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      const k = posKey(p);
      const cur = out.get(k);
      if (cur === undefined || level < cur) out.set(k, level);
    }
    divide(p, parts[i], level + 1, unit, grid, out);
    p += parts[i];
  }
}

const treeCache = new Map<string, MetricTree>();

export function metricTree(sig: TimeSig, grid: number): MetricTree {
  const cacheKey = `${sig.num}/${sig.den}@${grid}`;
  const hit = treeCache.get(cacheKey);
  if (hit) return hit;
  const unit = 4 / sig.den;
  const beats = sig.num * unit;
  const out = new Map<number, number>();
  const groups = metricGroups(sig);
  const floor = Math.max(grid, 1 / 64);
  let p = 0;
  for (let i = 0; i < groups.length; i++) {
    if (i > 0) out.set(posKey(p), 1);
    divide(p, groups[i], 2, unit, floor, out);
    p += groups[i];
  }
  const positions = [...out.keys()].sort((a, b) => a - b).map((k) => k / 1024);
  const tree: MetricTree = {
    beats,
    positions,
    levels: positions.map((x) => out.get(posKey(x)) ?? 1),
  };
  treeCache.set(cacheKey, tree);
  return tree;
}

/** Level of a division point; the barline is 0 and anything unlisted is weakest. */
function levelAt(tree: MetricTree, pos: number): number {
  if (pos <= EPS || pos >= tree.beats - EPS) return 0;
  for (let i = 0; i < tree.positions.length; i++) {
    if (Math.abs(tree.positions[i] - pos) < EPS) return tree.levels[i];
  }
  return Number.MAX_SAFE_INTEGER;
}

// ---------------------------------------------------------- duration fitting

export interface DurationUnit {
  /** Beats from the barline. */
  start: number;
  duration: number;
  value: NoteValue;
  dots: number;
}

export interface FitOptions {
  /** Quantise grid in beats; also the finest division of the metric tree. */
  grid?: number;
  /** Dots allowed on one value. One is the readable default. */
  maxDots?: number;
}

/**
 * Split a span inside one bar into written note values.
 *
 * `start` and `end` are beats from the barline. The result covers the span
 * exactly and in order; more than one element means the renderer ties them.
 */
export function fitDuration(
  start: number,
  end: number,
  sig: TimeSig,
  opts: FitOptions & { rest?: boolean } = {},
): DurationUnit[] {
  const tree = metricTree(sig, opts.grid ?? 0.25);
  const out: DurationUnit[] = [];
  fitSpan(start, end, tree, opts.maxDots ?? 1, out, 0, opts.rest ?? false);
  return out;
}

function fitSpan(
  s: number,
  e: number,
  tree: MetricTree,
  maxDots: number,
  out: DurationUnit[],
  depth: number,
  forRest = false,
): void {
  const duration = e - s;
  if (duration <= EPS) return;
  const v = depth > 12 ? null : valueFor(duration, maxDots);
  if (v && isWritable(s, e, tree, v.dots, forRest)) {
    out.push({ start: s, duration, ...v });
    return;
  }
  const split = depth > 12 ? null : strongestInside(s, e, tree);
  if (split === null) {
    // Nothing to split on (or the tree has run out of depth): take the largest
    // value that fits and tie the remainder. Terminates because it always
    // consumes at least a 32nd.
    const fallback = largestValueAtMost(duration);
    const len = noteValueBeats(fallback.value, fallback.dots);
    out.push({ start: s, duration: len, ...fallback });
    fitSpan(s + len, e, tree, maxDots, out, depth + 1, forRest);
    return;
  }
  fitSpan(s, split, tree, maxDots, out, depth + 1, forRest);
  fitSpan(split, e, tree, maxDots, out, depth + 1, forRest);
}

/** Division points strictly inside a span. */
function insideLevels(s: number, e: number, tree: MetricTree): { pos: number; level: number }[] {
  const out: { pos: number; level: number }[] = [];
  for (let i = 0; i < tree.positions.length; i++) {
    const p = tree.positions[i];
    if (p > s + EPS && p < e - EPS) out.push({ pos: p, level: tree.levels[i] });
  }
  return out;
}

function strongestInside(s: number, e: number, tree: MetricTree): number | null {
  let best: { pos: number; level: number } | null = null;
  for (const b of insideLevels(s, e, tree)) if (!best || b.level < best.level) best = b;
  return best ? best.pos : null;
}

/** Does the span cover exactly one node of the metric tree? */
function isNode(s: number, e: number, tree: MetricTree): boolean {
  const bound = Math.max(levelAt(tree, s), levelAt(tree, e));
  return insideLevels(s, e, tree).every((b) => b.level > bound);
}

/**
 * May this span be written as a single value?
 *
 * It may when it hides nothing stronger than its own starting point. The one
 * concession is symmetric syncopation: an undotted value centred on a single
 * stronger point is how a reader expects syncopation to look, so the quarter
 * on the "and of 2" in 4/4 stays one note rather than two tied eighths.
 *
 * Rests are held to a stricter standard, because silence has no rhythm to
 * carry across a beat: they never syncopate, and a dotted rest has to fill a
 * whole metric node — which is why a beat of rest in 6/8 is one dotted quarter
 * rest while three beats of rest in 4/4 is a half rest plus a quarter rest.
 */
function isWritable(
  s: number,
  e: number,
  tree: MetricTree,
  dots: number,
  forRest: boolean,
): boolean {
  const ls = levelAt(tree, s);
  const stronger = insideLevels(s, e, tree).filter((b) => b.level < ls);
  if (forRest) return dots > 0 ? isNode(s, e, tree) : stronger.length === 0;
  if (stronger.length === 0) return true;
  if (dots > 0 || stronger.length > 1) return false;
  const p = stronger[0].pos;
  return Math.abs(p - s - (e - p)) < EPS;
}

/**
 * Beam groups of a bar, as start beats.
 *
 * Eighths and shorter beam within a beat; compound time beams by the dotted
 * beat, and a bar no longer than a dotted quarter (3/8, 2/8) beams whole.
 */
export function beamGroupStarts(sig: TimeSig): number[] {
  const unit = 4 / sig.den;
  const total = sig.num * unit;
  if (sig.den >= 8 && total <= 1.5 + EPS) return [0];
  const compound = sig.num % 3 === 0 && sig.num > 3 && sig.den >= 8;
  const step = compound ? 3 * unit : unit;
  const out: number[] = [];
  for (let i = 0; i * step < total - EPS; i++) out.push(i * step);
  return out;
}

/** Beams a value carries: an eighth has one, a 16th two, a 32nd three. */
export function beamCount(value: NoteValue): number {
  return value >= 8 ? Math.round(Math.log2(value)) - 2 : 0;
}

// --------------------------------------------------------------- score model

export interface ScoreNote {
  id: string;
  pitch: SpelledPitch;
  staffPos: number;
  /** Accidental to print: null for none, 0 for a natural, ±1, ±2. */
  accidental: number | null;
  /** This head continues a tie from the previous element. */
  tieFrom: boolean;
  /** This head is tied into the next element. */
  tieTo: boolean;
  /** The source clip note behind this head — what selection acts on. */
  noteIds: string[];
  velocity: number;
}

export interface BeamRef {
  groupId: string;
  index: number;
  size: number;
  /** Beams on this element: 1 for an eighth, 2 for a 16th, 3 for a 32nd. */
  level: number;
}

export interface ScoreElement {
  id: string;
  kind: 'note' | 'rest';
  /** Beats from the barline. */
  start: number;
  duration: number;
  value: NoteValue;
  dots: number;
  /** A bar's worth of silence: a centred whole rest, whatever the meter. */
  wholeMeasure: boolean;
  notes: ScoreNote[];
  stem: 'up' | 'down' | 'none';
  beam: BeamRef | null;
  /** Every source note under this element, for click-to-select. */
  noteIds: string[];
}

export interface BeamGroup {
  id: string;
  voice: number;
  elementIds: string[];
  levels: number[];
}

export interface ScoreVoice {
  index: number;
  stem: 'up' | 'down';
  elements: ScoreElement[];
}

export interface ScoreMeasure {
  /** Absolute bar index in the song, 0-based. */
  index: number;
  /** Bar number as a reader counts it, 1-based. */
  number: number;
  /** Absolute song beat of the barline. */
  startBeat: number;
  beats: number;
  sig: TimeSig;
  /** The meter changed here (or this is the first bar), so print it. */
  showSig: boolean;
  voices: ScoreVoice[];
  beams: BeamGroup[];
}

export interface Score {
  key: KeySignature;
  clef: Clef;
  measures: ScoreMeasure[];
  /** The MIDI range actually engraved, or null when the part is empty. */
  range: { min: number; max: number } | null;
  grid: number;
}

export interface ScoreOptions extends FitOptions {
  /** Key for spelling; detected from the pitch content when absent. */
  key?: KeySignature;
  /** Clef to engrave in; chosen from the range when absent. */
  clef?: Clef;
  /** Engrave only this slice of the range — how a grand staff is built. */
  pitchMin?: number;
  pitchMax?: number;
}

// ------------------------------------------------------------------ assembly

/** One sounding block: notes sharing a start and an end are one chord. */
interface Frag {
  start: number;
  end: number;
  midis: number[];
  velocities: number[];
  noteIds: string[];
  tieIn: boolean;
  tieOut: boolean;
}

function quantize(notes: Note[], grid: number, limit: number): Frag[] {
  const byKey = new Map<string, Frag>();
  for (const n of notes) {
    const start = Math.round(n.start / grid) * grid;
    if (start >= limit - EPS) continue;
    const rawEnd = Math.round((n.start + n.length) / grid) * grid;
    // A note shorter than the grid still sounded: give it one grid unit rather
    // than dropping it, and never let it run past the clip that plays it.
    const end = Math.min(limit, Math.max(start + grid, rawEnd));
    const key = `${posKey(start)}:${posKey(end)}`;
    const cur = byKey.get(key);
    if (cur) {
      cur.midis.push(n.pitch);
      cur.velocities.push(n.velocity);
      cur.noteIds.push(n.id);
    } else {
      byKey.set(key, {
        start,
        end,
        midis: [n.pitch],
        velocities: [n.velocity],
        noteIds: [n.id],
        tieIn: false,
        tieOut: false,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Two voices at most.
 *
 * Material that starts together is a chord; material that overlaps but starts
 * elsewhere cannot share a stem, so it moves to a second voice. The upper part
 * becomes voice 0 and takes the stems up, which is what a reader expects of a
 * two-part texture on one staff. Denser polyphony than two parts is folded
 * back into those two rather than growing the staff without limit.
 */
function assignVoices(frags: Frag[]): Frag[][] {
  const voices: Frag[][] = [[], []];
  const ends = [-Infinity, -Infinity];
  for (const f of frags) {
    let v = ends[0] <= f.start + EPS ? 0 : ends[1] <= f.start + EPS ? 1 : -1;
    if (v === -1) v = ends[0] <= ends[1] ? 0 : 1;
    voices[v].push(f);
    ends[v] = Math.max(ends[v], f.end);
  }
  if (voices[1].length === 0) return [voices[0]];
  const mean = (fs: Frag[]) =>
    fs.reduce((a, f) => a + f.midis.reduce((x, m) => x + m, 0) / f.midis.length, 0) /
    Math.max(1, fs.length);
  return mean(voices[1]) > mean(voices[0]) ? [voices[1], voices[0]] : voices;
}

function stemOf(staffPositions: number[]): 'up' | 'down' {
  // The head furthest from the middle line decides; on the line itself, down.
  let furthest = staffPositions[0] ?? 4;
  for (const p of staffPositions) if (Math.abs(p - 4) > Math.abs(furthest - 4)) furthest = p;
  return furthest >= 4 ? 'down' : 'up';
}

/** Build one voice: fitted notes with every gap filled by rests. */
function buildVoice(
  bar: number,
  beats: number,
  frags: Frag[],
  voiceIndex: number,
  tree: MetricTree,
  key: KeySignature,
  clef: Clef,
  maxDots: number,
  twoVoices: boolean,
): ScoreVoice {
  const elements: ScoreElement[] = [];
  const idBase = `m${bar}-v${voiceIndex}`;
  let cursor = 0;
  let seq = 0;

  const pushRests = (from: number, to: number) => {
    if (to - from <= EPS) return;
    const whole = from <= EPS && to >= beats - EPS;
    // A bar of silence is one whole rest in every meter, 3/4 and 7/8 included.
    const units: DurationUnit[] = whole ? [{ start: 0, duration: beats, value: 1, dots: 0 }] : [];
    if (!whole) fitSpan(from, to, tree, maxDots, units, 0, true);
    for (const u of units) {
      elements.push({
        id: `${idBase}-e${seq++}`,
        kind: 'rest',
        start: u.start,
        duration: u.duration,
        value: u.value,
        dots: u.dots,
        wholeMeasure: whole,
        notes: [],
        stem: 'none',
        beam: null,
        noteIds: [],
      });
    }
  };

  for (const f of frags) {
    pushRests(cursor, f.start);
    const units: DurationUnit[] = [];
    fitSpan(f.start, f.end, tree, maxDots, units, 0);
    const heads = f.midis
      .map((midi, i) => ({ midi, velocity: f.velocities[i], noteId: f.noteIds[i] }))
      .sort((a, b) => a.midi - b.midi)
      .map((h) => ({ ...h, pitch: spellPitch(h.midi, key) }));
    const positions = heads.map((h) => staffPositionOf(h.pitch.diatonic, clef));

    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const id = `${idBase}-e${seq++}`;
      const tieFrom = i > 0 || f.tieIn;
      const tieTo = i < units.length - 1 || f.tieOut;
      elements.push({
        id,
        kind: 'note',
        start: u.start,
        duration: u.duration,
        value: u.value,
        dots: u.dots,
        wholeMeasure: false,
        notes: heads.map((h, j) => ({
          id: `${id}-n${j}`,
          pitch: h.pitch,
          staffPos: positions[j],
          accidental: null,
          tieFrom,
          tieTo,
          noteIds: [h.noteId],
          velocity: h.velocity,
        })),
        stem: twoVoices ? (voiceIndex === 0 ? 'up' : 'down') : stemOf(positions),
        beam: null,
        noteIds: f.noteIds,
      });
    }
    cursor = Math.max(cursor, f.end);
  }
  pushRests(cursor, beats);

  return { index: voiceIndex, stem: voiceIndex === 0 ? 'up' : 'down', elements };
}

/**
 * Decide which accidentals print, for a whole bar at once.
 *
 * An accidental holds until the barline, for its own octave only, and is what
 * a later note in the same bar is measured against — so a second C♯ prints
 * nothing and a following C♮ prints a natural. Both voices share one state,
 * because they share one staff, and the pass runs in time order across them so
 * a lower voice is never judged against a note it precedes.
 */
function applyAccidentals(voices: ScoreVoice[], key: KeySignature): void {
  const sounding = new Map<string, number>();
  const all = voices
    .flatMap((v) => v.elements.map((e) => ({ e, v: v.index })))
    .filter((x) => x.e.kind === 'note')
    .sort((a, b) => a.e.start - b.e.start || a.v - b.v);
  for (const { e } of all) {
    for (const n of e.notes) {
      const slot = `${n.pitch.step}${n.pitch.octave}`;
      const prev = sounding.get(slot);
      const current = prev === undefined ? keyAlterOf(key, n.pitch.step) : prev;
      // A tied head repeats neither the accidental nor its cancellation.
      n.accidental = n.tieFrom || n.pitch.alter === current ? null : n.pitch.alter;
      if (!n.tieFrom) sounding.set(slot, n.pitch.alter);
    }
  }
}

function buildBeams(
  voice: ScoreVoice,
  sig: TimeSig,
  barIndex: number,
  fixedStem: 'up' | 'down' | null,
): BeamGroup[] {
  const starts = beamGroupStarts(sig);
  const groupOf = (beat: number) => {
    let g = 0;
    for (let i = 0; i < starts.length; i++) if (beat >= starts[i] - EPS) g = i;
    return g;
  };
  const groups: BeamGroup[] = [];
  let run: ScoreElement[] = [];
  let runGroup = -1;

  const flush = () => {
    if (run.length >= 2) {
      const id = `b${barIndex}-${voice.index}-${groups.length}`;
      const levels = run.map((e) => beamCount(e.value));
      const members = run;
      // One beam, one stem direction: the group is stemmed as a whole, by the
      // head that sits furthest from the middle line anywhere in it.
      const dir = fixedStem ?? stemOf(members.flatMap((e) => e.notes.map((n) => n.staffPos)));
      members.forEach((e, i) => {
        e.stem = dir;
        e.beam = { groupId: id, index: i, size: members.length, level: levels[i] };
      });
      groups.push({ id, voice: voice.index, elementIds: members.map((e) => e.id), levels });
    }
    run = [];
  };

  for (const el of voice.elements) {
    if (el.kind !== 'note' || beamCount(el.value) === 0) {
      // A rest or a longer value ends the beam: beams never span silence.
      flush();
      runGroup = -1;
      continue;
    }
    const g = groupOf(el.start);
    if (g !== runGroup) {
      flush();
      runGroup = g;
    }
    run.push(el);
  }
  flush();
  return groups;
}

function rangeOf(pitches: number[]): { min: number; max: number } | null {
  if (pitches.length === 0) return null;
  let min = pitches[0];
  let max = pitches[0];
  // A loop, not `Math.min(...pitches)`: a dense clip is tens of thousands of
  // notes and spreading that many arguments overflows the stack.
  for (const p of pitches) {
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return { min, max };
}

/**
 * Engrave one MIDI clip.
 *
 * Bars come from the tempo map's signature list, so a meter change inside the
 * clip splits the music the way the song is actually counted. Notes are
 * quantised onto `grid` first — an unquantised performance has no notation.
 */
export function buildScore(clip: MidiClip, map: TempoMap, opts: ScoreOptions = {}): Score {
  const grid = opts.grid ?? 0.25;
  const maxDots = opts.maxDots ?? 1;
  const lo = opts.pitchMin ?? -Infinity;
  const hi = opts.pitchMax ?? Infinity;
  const source = clip.notes.filter((n) => n.pitch >= lo && n.pitch <= hi && !n.muted);

  const range = rangeOf(source.map((n) => n.pitch));
  const key = opts.key ?? detectKey(clip.notes.map((n) => n.pitch));
  const chosen = opts.clef ?? chooseClef(range?.min ?? 60, range?.max ?? 60);
  const clef: Clef = chosen === 'grand' ? 'treble' : chosen;

  const length = Math.max(grid, clip.length);
  const frags = quantize(source, grid, length);
  const firstBar = Math.floor(beatToBar(map, clip.start) + EPS);
  const lastBar = Math.max(firstBar, Math.ceil(beatToBar(map, clip.start + length) - EPS) - 1);

  const measures: ScoreMeasure[] = [];
  let prevSig: TimeSig | null = null;
  for (let bar = firstBar; bar <= lastBar; bar++) {
    const sigEvent = sigAtBar(map, bar);
    const sig: TimeSig = { num: sigEvent.num, den: sigEvent.den };
    const startBeat = barToBeat(map, bar);
    const beats = barBeats(sig.num, sig.den);
    const tree = metricTree(sig, grid);
    // The bar's window in clip-relative beats.
    const from = startBeat - clip.start;
    const to = from + beats;

    const inBar: Frag[] = [];
    for (const f of frags) {
      if (f.end <= from + EPS || f.start >= to - EPS) continue;
      inBar.push({
        start: Math.max(f.start, from) - from,
        end: Math.min(f.end, to) - from,
        midis: f.midis,
        velocities: f.velocities,
        noteIds: f.noteIds,
        // A note that reaches a barline is tied across it, never restruck.
        tieIn: f.start < from - EPS,
        tieOut: f.end > to + EPS,
      });
    }
    inBar.sort((a, b) => a.start - b.start || a.end - b.end);

    const parts = assignVoices(inBar);
    const voices = parts.map((fs, i) =>
      buildVoice(bar, beats, fs, i, tree, key, clef, maxDots, parts.length > 1),
    );
    applyAccidentals(voices, key);
    const beams = voices.flatMap((v) =>
      buildBeams(v, sig, bar, parts.length > 1 ? (v.index === 0 ? 'up' : 'down') : null),
    );

    measures.push({
      index: bar,
      number: bar + 1,
      startBeat,
      beats,
      sig,
      showSig: !prevSig || prevSig.num !== sig.num || prevSig.den !== sig.den,
      voices,
      beams,
    });
    prevSig = sig;
  }

  return { key, clef, measures, range, grid };
}
