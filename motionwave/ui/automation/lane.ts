/**
 * Motion Wave — an automation lane: points in, a ramp out.
 *
 * ADR-0004: "A lane holds `{ time, value, curve }` points in normalised value
 * and PPQ ticks. Evaluation produces the same `ParamBlock` a user's finger
 * produces." That sentence is the whole design. Because evaluation ends in the
 * same shape, a processor cannot tell automation from a gesture, and latch,
 * touch, write and trim end up as recording modes over one structure rather
 * than as four code paths that each drift.
 *
 * Values are normalised, and ticks are PPQ, so a lane survives both a spec
 * whose range changes and a project whose tempo does.
 */

import { type Ramp, rampOf, steady } from '../param/ramp';
import type { ParamId } from '../param/spec';

/** Pulses per quarter note. Matches the transport in `core/graph/tempo_map.h`. */
export const PPQ = 480;

/**
 * How the value travels from this point to the next.
 *
 * `hold` exists because a switch is a parameter too: interpolating a filter
 * mode between "low-pass" and "notch" produces a third of a mode, and the
 * lane has no way to know that is nonsense unless the point says so.
 */
export type CurveKind = 'linear' | 'hold' | 'smooth';

export interface AutomationPoint {
  /** PPQ ticks from the start of the timeline. */
  readonly tick: number;
  /** Normalised 0..1. */
  readonly value: number;
  readonly curve: CurveKind;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Smoothstep. Zero slope at both ends, so joined segments do not corner. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export class AutomationLane {
  readonly paramId: ParamId;
  private readonly items: AutomationPoint[] = [];

  constructor(paramId: ParamId, points: readonly AutomationPoint[] = []) {
    this.paramId = paramId;
    for (const point of points) this.add(point);
  }

  get points(): readonly AutomationPoint[] {
    return this.items;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * Adds a point, keeping the list sorted by tick.
   *
   * A point at a tick that already carries one replaces it. Two points at the
   * same tick would make the value at that instant depend on insertion order,
   * which is how a lane replays differently on the second pass than it did on
   * the first — a bug that only shows up after the take is recorded.
   */
  add(point: AutomationPoint): void {
    const value = clamp01(point.value);
    const tick = Math.max(0, Math.round(point.tick));
    const existing = this.items.findIndex((p) => p.tick === tick);
    if (existing >= 0) {
      this.items[existing] = { tick, value, curve: point.curve };
      return;
    }
    let index = this.items.length;
    while (index > 0 && this.items[index - 1].tick > tick) index -= 1;
    this.items.splice(index, 0, { tick, value, curve: point.curve });
  }

  removeAt(tick: number): boolean {
    const index = this.items.findIndex((p) => p.tick === tick);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }

  /** Removes every point in `[fromTick, toTick)`. What a write pass does first. */
  clearRange(fromTick: number, toTick: number): number {
    const before = this.items.length;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const tick = this.items[i].tick;
      if (tick >= fromTick && tick < toTick) this.items.splice(i, 1);
    }
    return before - this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }

  /**
   * The value at a tick.
   *
   * Before the first point and after the last the lane holds flat rather than
   * extrapolating. Extrapolation would let a lane whose last two points slope
   * upward drive a parameter past its range at bar 300, and clamping that would
   * hide the real problem, which is that the lane was never asked about bar 300.
   */
  valueAt(tick: number): number {
    if (this.items.length === 0) return Number.NaN;
    if (tick <= this.items[0].tick) return this.items[0].value;
    const last = this.items[this.items.length - 1];
    if (tick >= last.tick) return last.value;

    let index = 0;
    while (index + 1 < this.items.length && this.items[index + 1].tick <= tick) index += 1;
    const from = this.items[index];
    const to = this.items[index + 1];
    if (from.curve === 'hold') return from.value;
    const span = to.tick - from.tick;
    if (span <= 0) return to.value;
    const t = (tick - from.tick) / span;
    const shaped = from.curve === 'smooth' ? smoothstep(t) : t;
    return from.value + (to.value - from.value) * shaped;
  }

  /**
   * The lane across one buffer, as the ramp a finger would have produced.
   *
   * `moving` is decided by comparing the ends rather than by asking whether a
   * point falls inside the span, because a lane can carry a hundred points
   * across a block and still be flat — and a processor told it is moving takes
   * its interpolating path for a value that never changes, which costs the
   * budget the phone tier does not have (ADR-0006).
   */
  evaluate(fromTick: number, toTick: number): Ramp {
    if (this.items.length === 0) return steady(Number.NaN);
    const start = this.valueAt(fromTick);
    const end = this.valueAt(toTick);
    return rampOf(start, end);
  }

  /** A deep copy, for an undo step or a preset that carries its automation. */
  clone(): AutomationLane {
    return new AutomationLane(this.paramId, this.items);
  }
}
