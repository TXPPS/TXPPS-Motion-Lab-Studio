/**
 * MIDI transforms: pure functions from notes to notes.
 *
 * Everything here is deterministic and side-effect-free — humanise takes an
 * explicit seed — so every musical operation the piano roll offers is unit
 * tested against exact expected output, and "preview" is simply running the
 * function without committing. The store applies results through one undoable
 * update, so any transform is a single Ctrl+Z away from undone.
 *
 * Conventions: `start`/`length` in beats relative to the clip, pitch in MIDI
 * numbers, velocity 1..127. Transforms clamp to those ranges; they never
 * produce a note the schema would reject.
 */
import type { Note } from './types';

export const PITCH_MIN = 0;
export const PITCH_MAX = 127;

function clampPitch(p: number): number {
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, Math.round(p)));
}

function clampVel(v: number): number {
  return Math.min(127, Math.max(1, Math.round(v)));
}

/** Quantize grids offered by the UI, in beats (4/4: 1 beat = a quarter). */
export const QUANT_GRIDS = [
  { label: '1/1', beats: 4 },
  { label: '1/2', beats: 2 },
  { label: '1/4', beats: 1 },
  { label: '1/8', beats: 0.5 },
  { label: '1/16', beats: 0.25 },
  { label: '1/32', beats: 0.125 },
  { label: '1/4T', beats: 2 / 3 },
  { label: '1/8T', beats: 1 / 3 },
  { label: '1/16T', beats: 1 / 6 },
] as const;

export interface QuantizeOptions {
  /** grid size in beats */
  grid: number;
  /** 0..1: how far each note moves toward the grid. 1 = hard snap. */
  strength: number;
  /**
   * 0..1: every second grid slot is delayed by swing × half the grid.
   * 0.5 ≈ classic triplet-feel swing. Applies to the target positions, so
   * strength interpolates toward the *swung* grid.
   */
  swing: number;
  /** also snap note ends to the grid (length quantize) */
  lengths?: boolean;
}

/**
 * The swung grid position nearest to `beat`. Odd slots (the off-beats) are
 * displaced late by swing × grid/2.
 */
export function nearestSwungSlot(beat: number, grid: number, swing: number): number {
  if (grid <= 0) return beat;
  const slot = Math.round(beat / grid);
  // Candidate slots around the naive nearest, with swing displacement applied.
  let best = beat;
  let bestDist = Infinity;
  for (let s = slot - 1; s <= slot + 1; s++) {
    if (s < 0) continue;
    const pos = s * grid + (s % 2 !== 0 ? swing * grid * 0.5 : 0);
    const d = Math.abs(pos - beat);
    if (d < bestDist) {
      bestDist = d;
      best = pos;
    }
  }
  return best;
}

export function quantizeNotes(notes: Note[], opts: QuantizeOptions): Note[] {
  const { grid, strength, swing, lengths } = opts;
  if (grid <= 0 || strength <= 0) return notes.map((n) => ({ ...n }));
  const k = Math.min(1, strength);
  return notes.map((n) => {
    const target = nearestSwungSlot(n.start, grid, Math.min(1, Math.max(0, swing)));
    const start = Math.max(0, n.start + (target - n.start) * k);
    let length = n.length;
    if (lengths) {
      const endTarget = nearestSwungSlot(n.start + n.length, grid, swing);
      const end = n.start + n.length + (endTarget - (n.start + n.length)) * k;
      length = Math.max(grid / 2, end - start);
    }
    return { ...n, start, length };
  });
}

/**
 * Deterministic PRNG (mulberry32). Humanise must be reproducible: the same
 * seed gives the same performance, so a preview equals the committed result
 * and a test can assert exact output.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface HumanizeOptions {
  seed: number;
  /** max timing displacement in beats (± uniform) */
  timing: number;
  /** max velocity displacement (± uniform, in velocity units) */
  velocity: number;
  /** max length change as a fraction of each note's length (± uniform) */
  length: number;
  /** 0..1: chance each note KEEPS sounding; below the roll, the note is muted */
  probability: number;
  /** max pitch displacement in semitones (± uniform integer); 0 disables */
  pitch?: number;
}

export function humanizeNotes(notes: Note[], opts: HumanizeOptions): Note[] {
  const rnd = seededRandom(opts.seed);
  const bi = () => rnd() * 2 - 1; // -1..1
  return notes.map((n) => {
    const keep = opts.probability >= 1 ? true : rnd() < opts.probability;
    const dPitch = opts.pitch ? Math.round(bi() * opts.pitch) : 0;
    return {
      ...n,
      start: Math.max(0, n.start + bi() * opts.timing),
      velocity: clampVel(n.velocity + bi() * opts.velocity),
      length: Math.max(0.05, n.length * (1 + bi() * opts.length)),
      pitch: clampPitch(n.pitch + dPitch),
      ...(keep ? {} : { muted: true }),
    };
  });
}

// ---------- simple transforms ----------

export function transposeNotes(notes: Note[], semitones: number): Note[] {
  return notes.map((n) => ({ ...n, pitch: clampPitch(n.pitch + semitones) }));
}

/** Reverse in time within the selection's own span: last note first. */
export function reverseNotes(notes: Note[]): Note[] {
  if (notes.length === 0) return [];
  const lo = Math.min(...notes.map((n) => n.start));
  const hi = Math.max(...notes.map((n) => n.start + n.length));
  return notes.map((n) => ({ ...n, start: lo + (hi - (n.start + n.length)) }));
}

/** Mirror pitches around the selection's own pitch centre. */
export function mirrorNotes(notes: Note[]): Note[] {
  if (notes.length === 0) return [];
  const lo = Math.min(...notes.map((n) => n.pitch));
  const hi = Math.max(...notes.map((n) => n.pitch));
  const centre = (lo + hi) / 2;
  return notes.map((n) => ({ ...n, pitch: clampPitch(2 * centre - n.pitch) }));
}

/** Scale times by `factor` around the selection start (2 = double length). */
export function stretchNotes(notes: Note[], factor: number): Note[] {
  if (notes.length === 0 || factor <= 0) return notes.map((n) => ({ ...n }));
  const lo = Math.min(...notes.map((n) => n.start));
  return notes.map((n) => ({
    ...n,
    start: lo + (n.start - lo) * factor,
    length: Math.max(0.05, n.length * factor),
  }));
}

/**
 * Legato: each note (per pitch-agnostic time order) extends to the next note's
 * start. The final note keeps its own length — there is nothing to reach.
 */
export function legatoNotes(notes: Note[]): Note[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const out = sorted.map((n) => ({ ...n }));
  for (let i = 0; i < out.length; i++) {
    // The next strictly-later start; simultaneous chord tones share it.
    const next = out.find((m) => m.start > out[i].start + 1e-9);
    if (next) out[i].length = Math.max(0.05, next.start - out[i].start);
  }
  return out;
}

/**
 * Remove same-pitch overlaps by shortening the earlier note, never deleting.
 * Chords (different pitches) are untouched.
 */
export function deleteOverlaps(notes: Note[]): Note[] {
  const out = notes.map((n) => ({ ...n }));
  const byPitch = new Map<number, typeof out>();
  for (const n of out) {
    const list = byPitch.get(n.pitch);
    if (list) list.push(n);
    else byPitch.set(n.pitch, [n]);
  }
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 0; i < list.length - 1; i++) {
      const end = list[i].start + list[i].length;
      if (end > list[i + 1].start + 1e-9) {
        list[i].length = Math.max(0.05, list[i + 1].start - list[i].start);
      }
    }
  }
  return out;
}

/**
 * Thin: keep every Nth note in time order. Ties (chords) count as one event,
 * so thinning a chord progression drops whole chords, not chord tones.
 */
export function thinNotes(notes: Note[], keepEvery: number): Note[] {
  if (keepEvery <= 1) return notes.map((n) => ({ ...n }));
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const kept: Note[] = [];
  let eventIndex = -1;
  // Sentinel must compare unequal to any real start; NaN comparisons are
  // always false, which would silently drop every note.
  let lastStart = -Infinity;
  for (const n of sorted) {
    if (Math.abs(n.start - lastStart) > 1e-9) {
      eventIndex++;
      lastStart = n.start;
    }
    if (eventIndex % keepEvery === 0) kept.push({ ...n });
  }
  return kept;
}

/** Repeat the selection `times` extra times, back to back. Returns ONLY the copies. */
export function repeatNotes(notes: Note[], times: number): Note[] {
  if (notes.length === 0 || times < 1) return [];
  const lo = Math.min(...notes.map((n) => n.start));
  const hi = Math.max(...notes.map((n) => n.start + n.length));
  const span = Math.max(hi - lo, 1e-6);
  const out: Note[] = [];
  for (let r = 1; r <= times; r++) {
    for (const n of notes) out.push({ ...n, start: n.start + span * r });
  }
  return out;
}

/** Set every velocity, or scale them; both clamped to 1..127. */
export function scaleVelocities(notes: Note[], factor: number): Note[] {
  return notes.map((n) => ({ ...n, velocity: clampVel(n.velocity * factor) }));
}
