/**
 * Motion Wave — the one automation path.
 *
 * Everything that moves a parameter without a finger on it comes through here:
 * a lane playing back, a modulation source, or both composed. A unit does not
 * implement any of it — a unit declares a `ParamSpec` table, and automation,
 * modulation and host exposure follow from the declaration (ADR-0004). If a
 * unit ever needed its own automation, the harness's D10 cell would fail,
 * because the cell drives automation through this class and nothing else.
 *
 * Composition order is fixed and is the reason this class exists rather than
 * two: the lane is evaluated first, modulation is summed onto it in normalised
 * space, and the result is clamped once. Any other order lets a modulated
 * parameter leave its range or lets a clamp swallow a source's contribution.
 */

import { AutomationLane } from './lane';
import { ModulationMatrix, type SourceReader } from './modulation';
import type { ParamSet } from '../param/set';
import type { ParamId } from '../param/spec';
import { type Ramp, rampOf } from '../param/ramp';

/** No modulation sources running. The default a player uses when none is given. */
export const NO_SOURCES: SourceReader = () => 0;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export class AutomationPlayer {
  readonly modulation: ModulationMatrix;
  private readonly set: ParamSet;
  private readonly lanes = new Map<ParamId, AutomationLane>();
  /**
   * Parameters the user currently has hold of. A lane must not fight a finger:
   * playing back over a control being dragged makes the control stutter between
   * the recorded value and the user's, which reads as a broken knob rather than
   * as automation that should have been suspended.
   */
  private readonly suspended = new Set<ParamId>();

  constructor(set: ParamSet, modulation: ModulationMatrix = new ModulationMatrix()) {
    this.set = set;
    this.modulation = modulation;
  }

  /** The lane for a parameter, created empty on first ask. */
  lane(paramId: ParamId): AutomationLane {
    const existing = this.lanes.get(paramId);
    if (existing !== undefined) return existing;
    const created = new AutomationLane(paramId);
    this.lanes.set(paramId, created);
    return created;
  }

  hasLane(paramId: ParamId): boolean {
    const lane = this.lanes.get(paramId);
    return lane !== undefined && !lane.isEmpty;
  }

  removeLane(paramId: ParamId): boolean {
    return this.lanes.delete(paramId);
  }

  automatedParams(): ParamId[] {
    return [...this.lanes.keys()].filter((id) => this.hasLane(id));
  }

  suspend(paramId: ParamId): void {
    this.suspended.add(paramId);
  }

  resume(paramId: ParamId): void {
    this.suspended.delete(paramId);
  }

  isSuspended(paramId: ParamId): boolean {
    return this.suspended.has(paramId);
  }

  /**
   * Advances the timeline across one buffer and posts what moved.
   *
   * Returns the ramp per parameter in normalised space so a caller that draws
   * — a lane view, a knob's modulation ring — reads exactly what was sent,
   * rather than sampling the value again a frame later and drawing a different
   * answer to the same question.
   */
  advance(fromTick: number, toTick: number, read: SourceReader = NO_SOURCES): Map<ParamId, Ramp> {
    const moved = new Map<ParamId, Ramp>();
    const touched = new Set<ParamId>(this.lanes.keys());
    for (const route of this.modulationParams()) touched.add(route);

    for (const paramId of touched) {
      if (this.suspended.has(paramId)) continue;
      if (this.set.indexOf(paramId) < 0) continue;

      const lane = this.lanes.get(paramId);
      const base =
        lane !== undefined && !lane.isEmpty
          ? lane.evaluate(fromTick, toTick)
          : {
              start: this.set.normalised(paramId),
              end: this.set.normalised(paramId),
              moving: false,
            };

      const offset = this.modulation.offsetFor(paramId, read);
      const ramp = rampOf(clamp01(base.start + offset), clamp01(base.end + offset));
      if (!Number.isFinite(ramp.end)) continue;

      this.set.setNormalised(paramId, ramp.end, 'automation');
      moved.set(paramId, ramp);
    }
    return moved;
  }

  private modulationParams(): ParamId[] {
    const ids: ParamId[] = [];
    for (const spec of this.set.specs) {
      if (this.modulation.routesFor(spec.id).length > 0) ids.push(spec.id);
    }
    return ids;
  }
}
