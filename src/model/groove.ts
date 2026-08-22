/**
 * Groove: the timing and accent pattern that separates a played bar from a
 * typed one, captured as data so it can be lifted off one performance and put
 * onto another.
 *
 * A groove is a deviation, not a position. Slot i of the bar says "play this
 * much late" and "play this much harder", both relative to the plain grid, so
 * the same groove applies to notes, to warp markers and to audio slices, and so
 * `strength` can dial it in continuously.
 *
 * `resolution` is grid slots per quarter-note beat — 2 for eighths, 4 for
 * sixteenths — which means `offsets.length / resolution` is the length of the
 * groove's bar in beats and no separate time signature has to be carried
 * alongside it.
 *
 * Pure: no DOM, no Web Audio, no React.
 */
import type { Transient } from './transients';

export interface Groove {
  name: string;
  /** Grid slots per quarter-note beat: 2 = eighths, 4 = sixteenths. */
  resolution: number;
  /** Timing deviation per slot, in beats. Positive is late. */
  offsets: number[];
  /** Velocity multiplier per slot. 1 leaves the note as played. */
  velocities: number[];
}

/** The minimum an event needs for a groove to be applied to it. */
export interface GrooveEvent {
  beat: number;
  velocity: number;
}

export interface ApplyGrooveOptions {
  /** Velocity floor and ceiling; the project's MIDI convention is 1..127. */
  minVelocity?: number;
  maxVelocity?: number;
}

export interface ExtractGrooveOptions {
  name?: string;
  /** Quarter-note beats in one bar of the material. */
  beatsPerBar?: number;
}

const DEFAULT_BEATS_PER_BAR = 4;

/** Length of a groove's bar, in quarter-note beats. */
export function grooveBeatsPerBar(groove: Groove): number {
  return groove.offsets.length / groove.resolution;
}

function slotOf(groove: Groove, beat: number): number {
  const slots = groove.offsets.length;
  if (slots < 1) return 0;
  const raw = Math.round(beat * groove.resolution);
  return ((raw % slots) + slots) % slots;
}

/**
 * Add a groove's deviations to a list of events.
 *
 * This does not quantize: it moves each event by the groove's offset for the
 * slot it is nearest to, so a part that was played with its own feel keeps that
 * feel underneath the borrowed one. Quantize first if you want the groove alone.
 */
export function applyGroove<T extends GrooveEvent>(
  events: readonly T[],
  groove: Groove,
  strength: number,
  options: ApplyGrooveOptions = {},
): T[] {
  const amount = strength < 0 ? 0 : strength > 1 ? 1 : strength;
  const minVelocity = options.minVelocity ?? 1;
  const maxVelocity = options.maxVelocity ?? 127;
  if (groove.offsets.length === 0) return events.map((e) => ({ ...e }));

  return events.map((e) => {
    const slot = slotOf(groove, e.beat);
    const beat = e.beat + amount * (groove.offsets[slot] ?? 0);
    const target = e.velocity * (groove.velocities[slot] ?? 1);
    const velocity = e.velocity + amount * (target - e.velocity);
    return {
      ...e,
      beat: beat < 0 ? 0 : beat,
      velocity: Math.min(maxVelocity, Math.max(minVelocity, velocity)),
    };
  });
}

/**
 * Read a groove off detected onsets.
 *
 * Every onset is folded onto the bar and averaged into its nearest slot, so a
 * four-bar loop contributes four measurements per slot and a player's habit
 * survives while their mistakes average out. A slot nothing landed in keeps the
 * grid: an absent hit is not evidence of a rushed one.
 */
export function extractGroove(
  transients: readonly Transient[],
  bpm: number,
  resolution: number,
  options: ExtractGrooveOptions = {},
): Groove {
  const res = Math.max(1, Math.round(resolution));
  const beatsPerBar = Math.max(1, options.beatsPerBar ?? DEFAULT_BEATS_PER_BAR);
  const slots = Math.round(res * beatsPerBar);
  const offsets = new Array<number>(slots).fill(0);
  const velocities = new Array<number>(slots).fill(1);
  const name = options.name ?? 'Extracted';
  const groove: Groove = { name, resolution: res, offsets, velocities };
  if (!(bpm > 0) || transients.length === 0) return groove;

  const beatsPerSec = bpm / 60;
  const offsetSum = new Float64Array(slots);
  const strengthSum = new Float64Array(slots);
  const counts = new Int32Array(slots);
  let totalStrength = 0;
  let totalCount = 0;

  for (const t of transients) {
    if (!Number.isFinite(t.timeSec) || t.timeSec < 0) continue;
    const beat = t.timeSec * beatsPerSec;
    const nearest = Math.round(beat * res) / res;
    const slot = slotOf(groove, beat);
    offsetSum[slot] += beat - nearest;
    strengthSum[slot] += t.strength;
    counts[slot]++;
    totalStrength += t.strength;
    totalCount++;
  }
  if (totalCount === 0) return groove;

  const meanStrength = totalStrength / totalCount;
  for (let i = 0; i < slots; i++) {
    if (counts[i] === 0) continue;
    offsets[i] = offsetSum[i] / counts[i];
    if (meanStrength > 0) velocities[i] = strengthSum[i] / counts[i] / meanStrength;
  }
  return groove;
}

/** A groove that changes nothing: the reference every other one is a deviation from. */
export function straightGroove(
  resolution = 2,
  beatsPerBar = DEFAULT_BEATS_PER_BAR,
  name = 'Straight',
): Groove {
  const slots = Math.max(1, Math.round(resolution * beatsPerBar));
  return {
    name,
    resolution,
    offsets: new Array<number>(slots).fill(0),
    velocities: new Array<number>(slots).fill(1),
  };
}

/**
 * Swing: the second note of each pair lands `percent` of the way through the
 * pair instead of half way. 50 % is straight, 66.7 % is a triplet shuffle, and
 * the numbers players actually use sit between them.
 */
export function swingGroove(
  percent: number,
  resolution = 2,
  beatsPerBar = DEFAULT_BEATS_PER_BAR,
  name = `Swing ${percent}%`,
): Groove {
  const groove = straightGroove(resolution, beatsPerBar, name);
  const pairBeats = 2 / resolution;
  const shift = (percent / 100 - 0.5) * pairBeats;
  for (let i = 1; i < groove.offsets.length; i += 2) groove.offsets[i] = shift;
  return groove;
}

/** Everything but the downbeat sits `beats` late (positive) or early (negative). */
function feelGroove(beats: number, accent: number, name: string, resolution = 4): Groove {
  const groove = straightGroove(resolution, DEFAULT_BEATS_PER_BAR, name);
  for (let i = 0; i < groove.offsets.length; i++) {
    const onBeat = i % resolution === 0;
    if (!onBeat) {
      groove.offsets[i] = beats;
      groove.velocities[i] = 1 / accent;
    } else {
      groove.velocities[i] = accent;
    }
  }
  return groove;
}

/**
 * The presets the groove menu opens with. They are starting points: a musician
 * picks the nearest one and edits it, or extracts their own from a take.
 */
export const BUILTIN_GROOVES: readonly Groove[] = [
  straightGroove(),
  swingGroove(54),
  swingGroove(58),
  swingGroove(62),
  swingGroove(62, 4, DEFAULT_BEATS_PER_BAR, 'Swing 1/16 62%'),
  feelGroove(0.03, 0.96, 'Laid Back'),
  feelGroove(-0.03, 1.04, 'Pushed'),
];

export function grooveByName(name: string): Groove | undefined {
  return BUILTIN_GROOVES.find((g) => g.name === name);
}

/** The most a project keeps: a groove list is a palette, not an archive. */
export const MAX_SAVED_GROOVES = 24;

/**
 * Read a stored groove back, or reject it. A groove with mismatched offset and
 * velocity lengths would silently apply half a pattern, which is worse than
 * not loading at all.
 */
export function normalizeGroove(raw: unknown): Groove | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string') return null;
  if (!Array.isArray(r.offsets) || !Array.isArray(r.velocities)) return null;
  const resolution =
    typeof r.resolution === 'number' && r.resolution >= 1 ? Math.round(r.resolution) : 4;
  const slots = Math.min(r.offsets.length, r.velocities.length, 256);
  if (slots < 1) return null;
  const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  return {
    name: r.name.slice(0, 40),
    resolution,
    offsets: (r.offsets as unknown[]).slice(0, slots).map((v) => num(v, -1, 1, 0)),
    velocities: (r.velocities as unknown[]).slice(0, slots).map((v) => num(v, 0, 4, 1)),
  };
}

export function normalizeGrooves(raw: unknown): Groove[] {
  if (!Array.isArray(raw)) return [];
  const out: Groove[] = [];
  for (const item of raw as unknown[]) {
    const groove = normalizeGroove(item);
    if (groove) out.push(groove);
    if (out.length >= MAX_SAVED_GROOVES) break;
  }
  return out;
}

/**
 * A groove read off played notes.
 *
 * Onset detection gives audio a strength per hit; a MIDI note already carries
 * one as its velocity, so the two paths meet at the same extractor rather than
 * each growing their own.
 */
export function grooveFromNotes(
  notes: readonly { start: number; velocity: number }[],
  resolution: number,
  options: ExtractGrooveOptions = {},
): Groove {
  // The bpm cancels out — beats in, beats out — so any positive tempo works.
  const bpm = 60;
  const transients = notes.map((n) => ({
    timeSec: Math.max(0, n.start),
    strength: Math.min(1, Math.max(0, n.velocity / 127)),
  }));
  return extractGroove(transients, bpm, resolution, options);
}
