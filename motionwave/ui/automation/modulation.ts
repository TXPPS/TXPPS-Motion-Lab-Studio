/**
 * Motion Wave — modulation, which sits between automation and the parameter.
 *
 * ADR-0004: a modulation source contributes an offset in normalised space,
 * summed and clamped after automation. One rule, and two things follow from it.
 * A modulated parameter cannot leave its range, because the clamp is applied
 * once at the end rather than per source. And a face can draw the band a depth
 * actually reaches, which is the only honest way to show what a modulation
 * amount does — a ring drawn at ±depth around a value that is already near the
 * top of its range promises travel the parameter does not have.
 */

import type { ParamId } from '../param/spec';

/** A source's current output. Bipolar: an LFO swings −1..1, an envelope 0..1. */
export type SourceValue = number;

/** Reads a named source. Returns 0 for a source that is not running. */
export type SourceReader = (sourceId: string) => SourceValue;

export interface ModulationRoute {
  readonly sourceId: string;
  readonly paramId: ParamId;
  /** Normalised units of travel at full source output. May be negative. */
  readonly depth: number;
}

/** The span a parameter can reach under its current routings. */
export interface ReachableBand {
  readonly low: number;
  readonly high: number;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export class ModulationMatrix {
  private readonly routes: ModulationRoute[] = [];

  /**
   * Adds or replaces a routing. One source may reach a parameter once; asking
   * for it twice is a user dragging the same connection again, and treating
   * that as two routes doubles the depth silently.
   */
  connect(route: ModulationRoute): void {
    const index = this.routes.findIndex(
      (r) => r.sourceId === route.sourceId && r.paramId === route.paramId,
    );
    const clamped = { ...route, depth: Math.max(-1, Math.min(1, route.depth)) };
    if (index >= 0) this.routes[index] = clamped;
    else this.routes.push(clamped);
  }

  disconnect(sourceId: string, paramId: ParamId): boolean {
    const index = this.routes.findIndex((r) => r.sourceId === sourceId && r.paramId === paramId);
    if (index < 0) return false;
    this.routes.splice(index, 1);
    return true;
  }

  routesFor(paramId: ParamId): readonly ModulationRoute[] {
    return this.routes.filter((r) => r.paramId === paramId);
  }

  get size(): number {
    return this.routes.length;
  }

  /** The summed offset for a parameter, before clamping. */
  offsetFor(paramId: ParamId, read: SourceReader): number {
    let sum = 0;
    for (const route of this.routes) {
      if (route.paramId !== paramId) continue;
      const value = read(route.sourceId);
      if (!Number.isFinite(value)) continue;
      sum += route.depth * value;
    }
    return sum;
  }

  /**
   * The base value plus modulation, clamped once.
   *
   * Clamping once at the end rather than per source is what stops two sources
   * that each reach the ceiling from cancelling each other's overshoot: clamped
   * per source, +0.6 and −0.6 around 0.9 would give 1.0 then 0.4; clamped once,
   * they give 0.9, which is what the user asked for.
   */
  applyTo(base: number, offset: number): number {
    return clamp01(base + offset);
  }

  /**
   * The band a face draws around the current value: everything the routings can
   * reach at full source deflection, clamped to the parameter's own range.
   */
  reachableBand(paramId: ParamId, base: number): ReachableBand {
    let span = 0;
    for (const route of this.routes) {
      if (route.paramId === paramId) span += Math.abs(route.depth);
    }
    return { low: clamp01(base - span), high: clamp01(base + span) };
  }
}
