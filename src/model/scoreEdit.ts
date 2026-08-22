/**
 * Score editing: the arithmetic between a gesture on the staff and a MIDI note.
 * No DOM, no React — the component measures pixels, this decides music.
 *
 * Two rules run through everything here.
 *
 * The first is that a staff line is a *letter*, not a pitch. Clicking the top
 * line of a treble staff in E♭ major enters E♭, and nudging that note up one
 * step enters F, not E♮ — because the reader carries the key signature. So
 * every pitch this module produces goes out through the same key-aware spelling
 * the engraver uses to put it back on the page.
 *
 * The second is that the editor may only enter durations the engraver can
 * write. `model/notation.ts` decides where a value has to be split and tied —
 * a dotted quarter is legal on beat 1 of 4/4 and illegal on beat 2 — and if
 * insertion ignored that, a user asking for a dotted quarter would get two tied
 * heads they never asked for. `writableLength` therefore asks the engraver
 * first and hands back the longest value it will write whole, which is why the
 * palette and the page always agree.
 */

import { barBeats, barToBeat, beatToBar, sigAtBar, type TempoMap } from './tempo';
import {
  diatonicAtStaffPosition,
  fitDuration,
  keyAlterOf,
  noteValueBeats,
  spellDiatonic,
  spellPitch,
  type Clef,
  type KeySignature,
  type NoteValue,
  type SpelledPitch,
  type TimeSig,
} from './notation';

/** Matches the engraver's tolerance: thirds of a beat never land exactly. */
const EPS = 1e-6;

// ------------------------------------------------------------------ palette

/** The palette, longest first — the order of the buttons and of the 1–6 keys. */
export const SCORE_VALUES: NoteValue[] = [1, 2, 4, 8, 16, 32];

export interface DurationChoice {
  value: NoteValue;
  /** One dot is the readable maximum, and all the palette offers. */
  dots: 0 | 1;
}

export function durationBeats(d: DurationChoice): number {
  return noteValueBeats(d.value, d.dots);
}

/** The value and dot count a span is written with, or null when it is neither. */
export function valueOfBeats(beats: number): DurationChoice | null {
  for (const dots of [0, 1] as const) {
    for (const value of SCORE_VALUES) {
      if (Math.abs(noteValueBeats(value, dots) - beats) < EPS) return { value, dots };
    }
  }
  return null;
}

/** Every palette duration, longest first — the search order of `writableLength`. */
const CANDIDATES: { choice: DurationChoice; beats: number }[] = SCORE_VALUES.flatMap((value) =>
  ([0, 1] as const).map((dots) => ({
    choice: { value, dots },
    beats: noteValueBeats(value, dots),
  })),
).sort((a, b) => b.beats - a.beats);

// --------------------------------------------------------------- bar lookup

export interface BarContext {
  /** Absolute bar index in the song. */
  bar: number;
  sig: TimeSig;
  /** Clip-relative beat of the barline. */
  from: number;
  beats: number;
}

/** The bar a clip-relative beat falls in, as the signature map counts it. */
export function barContextAt(map: TempoMap, clipStart: number, clipBeat: number): BarContext {
  const bar = Math.floor(beatToBar(map, clipStart + Math.max(0, clipBeat)) + EPS);
  const sig = sigAtBar(map, bar);
  return {
    bar,
    sig: { num: sig.num, den: sig.den },
    from: barToBeat(map, bar) - clipStart,
    beats: barBeats(sig.num, sig.den),
  };
}

// ----------------------------------------------------------------- duration

export interface FitContext {
  map: TempoMap;
  /** Where the clip sits on the timeline, in beats. */
  clipStart: number;
  clipLength: number;
  /** The score's quantise grid — the same one `buildScore` engraves with. */
  grid: number;
  maxDots?: number;
}

/**
 * The longest duration from `start` that the engraver writes as one note head.
 *
 * Never longer than `requested`, never shorter than the grid the score is
 * notated on (below it the engraver's own quantiser would round the note back
 * up), and never past the barline or the clip end — a note that reached either
 * would come back split and tied, which is exactly what this prevents.
 *
 * Returns 0 when there is no room at all, which is the caller's cue to refuse
 * the edit rather than write a zero-length note.
 */
export function writableLength(ctx: FitContext, start: number, requested: number): number {
  // A pointer over an element the browser has not laid out yet reports no
  // coordinate, and the arithmetic downstream carries the NaN all the way into
  // a note's length. Refuse it here, where it is still one edit being declined.
  if (!Number.isFinite(start) || !Number.isFinite(requested)) return 0;
  const bar = barContextAt(ctx.map, ctx.clipStart, start);
  const inBar = start - bar.from;
  const room = Math.min(bar.beats, ctx.clipLength - bar.from) - inBar;
  if (room <= EPS) return 0;
  const maxDots = ctx.maxDots ?? 1;
  const want = Math.min(Math.max(requested, ctx.grid), room);
  const opts = { grid: ctx.grid, maxDots };
  for (const c of CANDIDATES) {
    if (c.choice.dots > maxDots) continue;
    if (c.beats > want + EPS || c.beats < ctx.grid - EPS) continue;
    if (fitDuration(inBar, inBar + c.beats, bar.sig, opts).length === 1) return c.beats;
  }
  // Nothing in the palette fits — a bar shorter than the grid, or a clip that
  // ends mid-grid. Take whatever the engraver writes first and stop there.
  return fitDuration(inBar, inBar + want, bar.sig, opts)[0]?.duration ?? 0;
}

/** The last grid position a note can still start on inside the clip. */
export function lastGridStart(clipLength: number, grid: number): number {
  return Math.max(0, (Math.ceil(clipLength / grid - EPS) - 1) * grid);
}

export interface InsertPlan {
  /** Clip-relative start, on the grid. */
  start: number;
  length: number;
  /** What was asked for, when the metre could not write it whole here. */
  shortenedFrom: number | null;
}

/**
 * Where a click lands and how long the note there may be.
 *
 * The start snaps to the nearest grid position and is clamped inside the clip:
 * the score never lengthens the clip to make room, because the clip's length is
 * an arrangement decision and a note entry is not.
 */
export function planInsert(
  ctx: FitContext,
  clipBeat: number,
  requested: number,
): InsertPlan | null {
  if (!Number.isFinite(clipBeat)) return null;
  const snapped = Math.round(clipBeat / ctx.grid) * ctx.grid;
  const start = Math.min(Math.max(0, snapped), lastGridStart(ctx.clipLength, ctx.grid));
  const length = writableLength(ctx, start, requested);
  if (!(length > EPS)) return null;
  return { start, length, shortenedFrom: length < requested - EPS ? requested : null };
}

// -------------------------------------------------------------------- pitch

/** A diatonic step spelled the way the key signature spells it. */
export function spellInKey(diatonic: number, key: KeySignature): SpelledPitch {
  return spellDiatonic(diatonic, keyAlterOf(key, spellDiatonic(diatonic, 0).step));
}

/**
 * The pitch a staff position sounds in a key: the letter comes from the line,
 * the accidental from the key signature. Clicking the F line in G major enters
 * F♯ and prints no accidental, which is what the reader would have played.
 */
export function pitchAtStaffPosition(
  staffPos: number,
  clef: Clef,
  key: KeySignature,
): SpelledPitch {
  return spellInKey(diatonicAtStaffPosition(staffPos, clef), key);
}

/**
 * Move a pitch by staff steps, respelled where it lands.
 *
 * Dragging up a step is a move on the page, not a transposition in semitones,
 * so the interval it produces depends on the key: E to F in C major is a
 * semitone and F to G is a tone, and the reader sees one step either way.
 */
export function stepPitchBy(pitch: number, key: KeySignature, steps: number): number {
  return spellInKey(spellPitch(pitch, key).diatonic + Math.round(steps), key).midi;
}

/**
 * Force an accidental on a note.
 *
 * This CHANGES THE PITCH. The note keeps the staff line it is written on and
 * takes the sharp, flat or natural of that letter, so a printed F♯ asked for a
 * natural sounds F. Spelling alone cannot be forced: a `Note` carries a MIDI
 * number and nothing else, so the letter is re-derived from the key on every
 * re-engrave and there is nowhere to record "the same sound, spelled G♭".
 */
export function forceAccidental(pitch: number, key: KeySignature, alter: number): number {
  return spellDiatonic(spellPitch(pitch, key).diatonic, alter).midi;
}
