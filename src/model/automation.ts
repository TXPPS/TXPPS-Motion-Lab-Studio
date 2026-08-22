/**
 * Automation model — one representation for every automatable parameter.
 *
 * A lane holds points whose values are NORMALIZED to 0..1; the parameter
 * descriptor (`paramRegistry.ts`) maps that to real units (linear or log).
 * Storing normalized values keeps curve math domain-free, makes every lane
 * render identically, and gives cross-parameter copy/paste a defined meaning.
 *
 * Points are kept sorted by beat — every mutation path funnels through
 * `normalizeLanePoints`, so readers may binary-search without checking.
 */
import { newId } from './ids';

export type CurveShape = 'linear' | 'exp' | 'log' | 's' | 'step';

export const CURVE_SHAPES: { id: CurveShape; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'exp', label: 'Exponential' },
  { id: 'log', label: 'Logarithmic' },
  { id: 's', label: 'S-curve' },
  { id: 'step', label: 'Stepped' },
];

export interface AutomationPoint {
  id: string;
  /** absolute timeline position in beats */
  beat: number;
  /** normalized 0..1 within the parameter's range */
  value: number;
  /** shape of the segment leaving this point toward the next one */
  curve: CurveShape;
}

export interface AutomationLane {
  id: string;
  /** parameter id resolved via the binding registry (e.g. "volume", "send:t3") */
  paramId: string;
  points: AutomationPoint[];
  /** disabled lanes keep their data but are not applied to playback */
  enabled: boolean;
  /** lane row height in px (UI); clamped by the arrangement */
  height?: number;
}

/**
 * How a track records control moves.
 *
 * - `read`   plays lanes back and records nothing.
 * - `touch`  records while a control is held, then hands the lane back.
 * - `latch`  records from the first touch until the transport stops.
 * - `write`  records continuously from the moment playback starts, whether or
 *            not anything is touched — it overwrites as it passes, which is
 *            what makes it the mode you turn off again straight away.
 * - `trim`   records a RELATIVE offset: moving the control shifts the existing
 *            ride rather than replacing it, so a pass can be lifted 2 dB
 *            without losing its shape.
 * - `off`    ignores lanes entirely; the static value plays.
 */
export type AutomationMode = 'read' | 'touch' | 'latch' | 'write' | 'trim' | 'off';

/** Shape a 0..1 segment progress through the curve. Endpoints always map 0→0, 1→1. */
export function shapeProgress(t: number, curve: CurveShape): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  switch (curve) {
    case 'exp':
      // slow start, fast finish
      return x * x * x;
    case 'log':
      // fast start, slow finish
      return 1 - (1 - x) * (1 - x) * (1 - x);
    case 's': {
      // smoothstep
      return x * x * (3 - 2 * x);
    }
    case 'step':
      // hold the left value until the next point
      return x >= 1 ? 1 : 0;
    case 'linear':
    default:
      return x;
  }
}

/**
 * Normalized lane value at an absolute beat, or null when the lane is empty.
 * Before the first point the first value holds; after the last, the last.
 */
export function laneValueAt(points: AutomationPoint[], beat: number): number | null {
  const n = points.length;
  if (n === 0) return null;
  if (beat <= points[0].beat) return points[0].value;
  if (beat >= points[n - 1].beat) return points[n - 1].value;
  // binary search for the segment: points[lo].beat <= beat < points[lo+1].beat
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].beat <= beat) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[lo + 1];
  const span = b.beat - a.beat;
  if (span <= 1e-9) return b.value;
  const t = (beat - a.beat) / span;
  return a.value + (b.value - a.value) * shapeProgress(t, a.curve);
}

/** First index whose beat is >= the given beat (lower bound over sorted points). */
export function lowerBound(points: AutomationPoint[], beat: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].beat < beat) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Sample a segment's curve as (beat, value) pairs for rendering or offline
 * ramp scheduling. Linear needs no interior samples; curved shapes get `steps`
 * subdivisions; `step` returns the hold-then-jump pair.
 */
export function sampleSegment(
  a: AutomationPoint,
  b: AutomationPoint,
  steps = 12,
): { beat: number; value: number }[] {
  if (a.curve === 'step') {
    return [
      { beat: b.beat, value: a.value },
      { beat: b.beat, value: b.value },
    ];
  }
  if (a.curve === 'linear' || Math.abs(b.value - a.value) < 1e-9) {
    return [{ beat: b.beat, value: b.value }];
  }
  const out: { beat: number; value: number }[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    out.push({
      beat: a.beat + (b.beat - a.beat) * t,
      value: a.value + (b.value - a.value) * shapeProgress(t, a.curve),
    });
  }
  return out;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Restore the lane invariants in place: finite clamped values, beats >= 0,
 * sorted by beat. Call after any mutation that may have broken order.
 */
export function normalizeLanePoints(points: AutomationPoint[]): void {
  for (const p of points) {
    p.beat = Number.isFinite(p.beat) ? Math.max(0, p.beat) : 0;
    p.value = Number.isFinite(p.value) ? clamp01(p.value) : 0;
  }
  points.sort((x, y) => x.beat - y.beat);
}

export function makePoint(
  beat: number,
  value: number,
  curve: CurveShape = 'linear',
): AutomationPoint {
  return { id: newId('ap'), beat: Math.max(0, beat), value: clamp01(value), curve };
}

const CURVE_IDS = new Set<string>(CURVE_SHAPES.map((c) => c.id));

/**
 * Validate raw lane data from storage. Malformed points are dropped, values
 * clamped, order restored; a lane without a usable shape returns null.
 * Parameter existence is the caller's concern (it needs the track context).
 */
export function validateLane(raw: unknown): AutomationLane | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.paramId !== 'string') return null;
  if (!Array.isArray(r.points)) return null;
  const points: AutomationPoint[] = [];
  for (const p of r.points) {
    if (typeof p !== 'object' || p === null) continue;
    const q = p as Record<string, unknown>;
    if (typeof q.beat !== 'number' || typeof q.value !== 'number') continue;
    if (!Number.isFinite(q.beat) || !Number.isFinite(q.value)) continue;
    points.push({
      id: typeof q.id === 'string' ? q.id : newId('ap'),
      beat: Math.max(0, q.beat),
      value: clamp01(q.value),
      curve:
        typeof q.curve === 'string' && CURVE_IDS.has(q.curve) ? (q.curve as CurveShape) : 'linear',
    });
  }
  normalizeLanePoints(points);
  const height = typeof r.height === 'number' && Number.isFinite(r.height) ? r.height : undefined;
  return {
    id: r.id,
    paramId: r.paramId,
    points,
    enabled: r.enabled !== false,
    ...(height !== undefined ? { height } : {}),
  };
}

export const AUTOMATION_MODES: AutomationMode[] = [
  'read',
  'touch',
  'latch',
  'write',
  'trim',
  'off',
];

/** One line per mode, for the mode picker's tooltip. */
export const AUTOMATION_MODE_BLURBS: Record<AutomationMode, string> = {
  read: 'Play the lanes back. Nothing is recorded.',
  touch: 'Record while the control is held, then give the lane back.',
  latch: 'Record from the first touch until the transport stops.',
  write: 'Record continuously from the moment playback starts. Overwrites as it passes.',
  trim: 'Shift the existing ride instead of replacing it.',
  off: 'Ignore the lanes; the static value plays.',
};

/** Modes that record. Read and off never write a point. */
export function modeRecords(mode: AutomationMode | undefined): boolean {
  return mode === 'touch' || mode === 'latch' || mode === 'write' || mode === 'trim';
}

export function isAutomationMode(v: unknown): v is AutomationMode {
  return typeof v === 'string' && (AUTOMATION_MODES as string[]).includes(v);
}
