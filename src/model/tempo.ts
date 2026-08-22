/**
 * Tempo and time-signature map.
 *
 * A professional session is not one number. A song slows into a bridge, drops
 * a 2/4 bar before the chorus, and ritards on the last four bars. Everything
 * that converts between musical time (beats) and wall time (seconds) goes
 * through this module, so playback, the ruler, waveform layout, automation and
 * offline export all agree on where bar 57 actually is.
 *
 * Model
 * -----
 * - `tempos` are keyed by BEAT and sorted. Each event holds the bpm that takes
 *   effect at that beat. `curve: 'ramp'` interpolates linearly in *bpm* from
 *   this event to the next; `'jump'` (the default) holds until the next event.
 * - `sigs` are keyed by BAR and sorted. A signature holds until the next one.
 *   Bars are therefore derived from the signature list, never from a constant.
 *
 * Everything here is pure and total: a malformed map is normalised rather than
 * rejected, and every query works on an empty map by falling back to the
 * project defaults.
 */

export type TempoCurve = 'jump' | 'ramp';

export interface TempoEvent {
  id: string;
  /** Absolute quarter-note beat where this tempo takes effect. */
  beat: number;
  bpm: number;
  /** 'ramp' interpolates linearly to the next event's bpm. */
  curve?: TempoCurve;
}

export interface SigEvent {
  id: string;
  /** Absolute bar index (0-based) where this signature takes effect. */
  bar: number;
  num: number;
  den: number;
}

export interface TempoMap {
  tempos: TempoEvent[];
  sigs: SigEvent[];
}

export const MIN_BPM = 20;
export const MAX_BPM = 999;

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
}

/** Quarter-note beats per bar for a signature (4/4 → 4, 6/8 → 3, 3/4 → 3). */
export function barBeats(num: number, den: number): number {
  const n = Number.isFinite(num) && num > 0 ? Math.min(32, Math.round(num)) : 4;
  const d = Number.isFinite(den) && den > 0 ? Math.min(64, Math.round(den)) : 4;
  return n * (4 / d);
}

/**
 * Build a valid map from anything. Events are clamped, de-duplicated by
 * position (last wins) and sorted; the first tempo is pinned to beat 0 and the
 * first signature to bar 0 so every query has a floor.
 */
export function normalizeTempoMap(
  raw: Partial<TempoMap> | undefined,
  fallbackBpm: number,
  fallbackSig: { num: number; den: number },
): TempoMap {
  const tempos: TempoEvent[] = [];
  const seenT = new Map<number, TempoEvent>();
  for (const e of raw?.tempos ?? []) {
    if (!e || typeof e !== 'object') continue;
    const beat = Number.isFinite(e.beat) ? Math.max(0, e.beat) : 0;
    const key = Math.round(beat * 1e6) / 1e6;
    seenT.set(key, {
      id: typeof e.id === 'string' && e.id ? e.id : `tmp-${key}`,
      beat: key,
      bpm: clampBpm(e.bpm),
      curve: e.curve === 'ramp' ? 'ramp' : 'jump',
    });
  }
  tempos.push(...[...seenT.values()].sort((a, b) => a.beat - b.beat));
  if (tempos.length === 0 || tempos[0].beat > 0) {
    tempos.unshift({ id: 'tempo-0', beat: 0, bpm: clampBpm(fallbackBpm), curve: 'jump' });
  } else {
    tempos[0] = { ...tempos[0], beat: 0 };
  }

  const sigs: SigEvent[] = [];
  const seenS = new Map<number, SigEvent>();
  for (const s of raw?.sigs ?? []) {
    if (!s || typeof s !== 'object') continue;
    const bar = Number.isFinite(s.bar) ? Math.max(0, Math.round(s.bar)) : 0;
    seenS.set(bar, {
      id: typeof s.id === 'string' && s.id ? s.id : `sig-${bar}`,
      bar,
      num: Number.isFinite(s.num) && s.num > 0 ? Math.min(32, Math.round(s.num)) : 4,
      den: [1, 2, 4, 8, 16, 32].includes(Math.round(s.den)) ? Math.round(s.den) : 4,
    });
  }
  sigs.push(...[...seenS.values()].sort((a, b) => a.bar - b.bar));
  if (sigs.length === 0 || sigs[0].bar > 0) {
    sigs.unshift({
      id: 'sig-0',
      bar: 0,
      num: fallbackSig?.num > 0 ? fallbackSig.num : 4,
      den: fallbackSig?.den > 0 ? fallbackSig.den : 4,
    });
  } else {
    sigs[0] = { ...sigs[0], bar: 0 };
  }

  return { tempos, sigs };
}

export const DEFAULT_TEMPO_MAP: TempoMap = normalizeTempoMap(undefined, 120, { num: 4, den: 4 });

/** Index of the last tempo event at or before `beat`. */
function tempoIndexAt(map: TempoMap, beat: number): number {
  const t = map.tempos;
  let lo = 0;
  let hi = t.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid].beat <= beat + 1e-9) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Instantaneous tempo at a beat, honouring ramps. */
export function bpmAt(map: TempoMap, beat: number): number {
  const t = map.tempos;
  const i = tempoIndexAt(map, Math.max(0, beat));
  const cur = t[i];
  const next = t[i + 1];
  if (cur.curve !== 'ramp' || !next || next.beat <= cur.beat) return cur.bpm;
  const f = (Math.max(0, beat) - cur.beat) / (next.beat - cur.beat);
  return cur.bpm + (next.bpm - cur.bpm) * Math.min(1, Math.max(0, f));
}

/**
 * Seconds elapsed across one tempo segment.
 *
 * A jump segment is beats × 60/bpm. A ramp is the integral of 60/bpm(b) with
 * bpm linear in b, which has the closed form
 *   60·Δb·ln(bpm₁/bpm₀)/(bpm₁−bpm₀)
 * — used rather than numeric integration so long ramps stay sample-exact.
 */
function segmentSeconds(fromBeat: number, toBeat: number, ev: TempoEvent, next?: TempoEvent): number {
  const db = toBeat - fromBeat;
  if (db <= 0) return 0;
  if (ev.curve !== 'ramp' || !next || next.beat <= ev.beat || next.bpm === ev.bpm) {
    return (db * 60) / ev.bpm;
  }
  const span = next.beat - ev.beat;
  const slope = (next.bpm - ev.bpm) / span;
  const b0 = ev.bpm + slope * (fromBeat - ev.beat);
  const b1 = ev.bpm + slope * (toBeat - ev.beat);
  if (Math.abs(b1 - b0) < 1e-9) return (db * 60) / b0;
  return (60 * Math.log(b1 / b0)) / slope;
}

/**
 * Cumulative seconds at each tempo event, cached per map object.
 *
 * Without this, every beat→second conversion walks the whole tempo list, and
 * the scheduler performs one per scheduled note. The cache is a WeakMap keyed
 * by the (immutable) map, so a new map from an edit simply builds a new entry
 * and the old one is collected.
 */
const cumCache = new WeakMap<TempoMap, number[]>();

function cumulative(map: TempoMap): number[] {
  let cum = cumCache.get(map);
  if (cum) return cum;
  const t = map.tempos;
  cum = new Array<number>(t.length);
  let sec = 0;
  for (let i = 0; i < t.length; i++) {
    cum[i] = sec;
    const next = t[i + 1];
    if (next) sec += segmentSeconds(t[i].beat, next.beat, t[i], next);
  }
  cumCache.set(map, cum);
  return cum;
}

/** Wall-clock seconds from beat 0 to `beat`. */
export function beatToSec(map: TempoMap, beat: number): number {
  const target = Math.max(0, beat);
  const t = map.tempos;
  const cum = cumulative(map);
  const i = tempoIndexAt(map, target);
  return cum[i] + segmentSeconds(t[i].beat, target, t[i], t[i + 1]);
}

/** Inverse of `beatToSec`. */
export function secToBeat(map: TempoMap, sec: number): number {
  const target = Math.max(0, sec);
  const t = map.tempos;
  const cum = cumulative(map);
  // last event whose cumulative time is at or before the target
  let lo = 0;
  let hi = t.length - 1;
  let i = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target + 1e-12) {
      i = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const ev = t[i];
  const next = t[i + 1];
  const rem = target - cum[i];
  if (ev.curve !== 'ramp' || !next || next.bpm === ev.bpm) {
    return ev.beat + (rem * ev.bpm) / 60;
  }
  const slope = (next.bpm - ev.bpm) / (next.beat - ev.beat);
  // invert 60·ln(b1/b0)/slope = rem  →  b1 = b0·e^(slope·rem/60)
  const b1 = ev.bpm * Math.exp((slope * rem) / 60);
  return Math.min(next.beat, ev.beat + (b1 - ev.bpm) / slope);
}

/** Duration in seconds of the beat range [from, to). Never negative. */
export function beatRangeSec(map: TempoMap, fromBeat: number, toBeat: number): number {
  return Math.max(0, beatToSec(map, toBeat) - beatToSec(map, fromBeat));
}

/**
 * Average seconds-per-beat across a range. Used where a single rate must stand
 * in for a span (clip stretch ratios, delay-time sync) — exact for a constant
 * tempo and honest for a ramp.
 */
export function avgSecPerBeat(map: TempoMap, fromBeat: number, lengthBeats: number): number {
  if (lengthBeats <= 0) return 60 / bpmAt(map, fromBeat);
  return beatRangeSec(map, fromBeat, fromBeat + lengthBeats) / lengthBeats;
}

export function sigAtBar(map: TempoMap, bar: number): SigEvent {
  const s = map.sigs;
  let found = s[0];
  for (const e of s) {
    if (e.bar <= bar) found = e;
    else break;
  }
  return found;
}

/** Absolute beat where a bar index starts. */
export function barToBeat(map: TempoMap, bar: number): number {
  const target = Math.max(0, Math.floor(bar));
  const s = map.sigs;
  let beat = 0;
  for (let i = 0; i < s.length; i++) {
    const from = s[i].bar;
    if (from >= target) break;
    const to = s[i + 1] ? Math.min(s[i + 1].bar, target) : target;
    beat += (to - from) * barBeats(s[i].num, s[i].den);
  }
  return beat;
}

/** Bar index (0-based, fractional) containing an absolute beat. */
export function beatToBar(map: TempoMap, beat: number): number {
  const target = Math.max(0, beat);
  const s = map.sigs;
  let acc = 0;
  for (let i = 0; i < s.length; i++) {
    const bpb = barBeats(s[i].num, s[i].den);
    const next = s[i + 1];
    const spanBars = next ? next.bar - s[i].bar : Infinity;
    const spanBeats = spanBars === Infinity ? Infinity : spanBars * bpb;
    if (!next || acc + spanBeats > target) return s[i].bar + (target - acc) / bpb;
    acc += spanBeats;
  }
  return 0;
}

export function sigAtBeat(map: TempoMap, beat: number): SigEvent {
  return sigAtBar(map, Math.floor(beatToBar(map, beat)));
}

/** Quarter-note beats in the bar containing `beat`. */
export function beatsPerBarAt(map: TempoMap, beat: number): number {
  const s = sigAtBeat(map, beat);
  return barBeats(s.num, s.den);
}

export interface BBT {
  bar: number;
  beat: number;
  tick: number;
}

export const TICKS_PER_BEAT = 960;

/** Bars·beats·ticks, all 1-based for display (ticks 0-based, PPQ 960). */
export function beatToBBT(map: TempoMap, beat: number): BBT {
  const barF = beatToBar(map, Math.max(0, beat));
  const bar = Math.floor(barF + 1e-9);
  const sig = sigAtBar(map, bar);
  const den = sig.den;
  // A "beat" in the display sense is one denominator unit, not a quarter note:
  // in 6/8 the display counts six eighths, which is what a musician reads.
  const intoBar = (barF - bar) * barBeats(sig.num, sig.den);
  const unit = 4 / den;
  const beatIdx = Math.floor(intoBar / unit + 1e-9);
  const tick = Math.round(((intoBar - beatIdx * unit) / unit) * TICKS_PER_BEAT);
  return { bar: bar + 1, beat: beatIdx + 1, tick: tick % TICKS_PER_BEAT };
}

export function formatBBT(map: TempoMap, beat: number, withTicks = true): string {
  const p = beatToBBT(map, beat);
  return withTicks
    ? `${p.bar}.${p.beat}.${String(p.tick).padStart(3, '0')}`
    : `${p.bar}.${p.beat}`;
}

/** Parse "bar.beat.tick" (1-based) back to an absolute beat. Returns null on junk. */
export function parseBBT(map: TempoMap, text: string): number | null {
  const m = /^\s*(\d+)(?:[.:](\d+))?(?:[.:](\d+))?\s*$/.exec(text);
  if (!m) return null;
  const bar = Math.max(1, parseInt(m[1], 10)) - 1;
  const sig = sigAtBar(map, bar);
  const unit = 4 / sig.den;
  const beatIdx = Math.max(1, m[2] ? parseInt(m[2], 10) : 1) - 1;
  const tick = m[3] ? parseInt(m[3], 10) : 0;
  return barToBeat(map, bar) + beatIdx * unit + (tick / TICKS_PER_BEAT) * unit;
}

/** Format seconds as h:mm:ss.mmm (hours dropped under an hour). */
export function formatClock(seconds: number, ms = true): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s - h * 3600) / 60);
  const sec = s - h * 3600 - m * 60;
  const whole = Math.floor(sec);
  const milli = Math.round((sec - whole) * 1000);
  const core = `${h > 0 ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(whole).padStart(2, '0')}`;
  return ms ? `${core}.${String(milli).padStart(3, '0')}` : core;
}

/**
 * How many beats `seconds` of wall time covers, starting at `fromBeat`.
 *
 * This is what a recorded or imported file needs: it arrives with a duration in
 * seconds and has to become a musical length, which under a tempo map depends
 * on where on the timeline it lands.
 */
export function beatsForSecondsFrom(map: TempoMap, fromBeat: number, seconds: number): number {
  return Math.max(0, secToBeat(map, beatToSec(map, fromBeat) + Math.max(0, seconds)) - fromBeat);
}

/** True when the map is a single constant tempo and signature (the fast path). */
export function isSimpleMap(map: TempoMap): boolean {
  return map.tempos.length === 1 && map.sigs.length === 1;
}
