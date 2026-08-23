/**
 * Motion Wave — a unit's parameters on the UI side of the seam.
 *
 * The mirror of `core/param/param_set.h`, with the halves swapped: the C++ set
 * owns the consumer (drain the ring, advance the smoothers, hand the processor
 * a ramp), and this one owns the producer (hold what the user sees, post
 * changes, tell faces to redraw). They share the spec table and the normalised
 * representation, and nothing else crosses.
 *
 * Values are held normalised, not real, for the reason ADR-0004 gives for
 * presets: normalised survives a spec whose range changes, and real does not.
 */

import { ParamQueue, DEFAULT_QUEUE_DEPTH } from './queue';
import {
  type ParamId,
  type ParamSpec,
  defaultNormalised,
  indexSpecs,
  quantise,
  toNormalised,
  toReal,
} from './spec';
import { formatValue } from './format';

/** Why a value changed. Automation must not re-record what it just played. */
export type ChangeOrigin = 'user' | 'automation' | 'modulation' | 'preset' | 'host';

export interface ParamChangeEvent {
  readonly id: ParamId;
  readonly normalised: number;
  readonly origin: ChangeOrigin;
}

export type ParamListener = (event: ParamChangeEvent) => void;

export class ParamSet {
  readonly specs: readonly ParamSpec[];
  readonly queue: ParamQueue;
  private readonly byId: ReadonlyMap<ParamId, ParamSpec>;
  private readonly indices: ReadonlyMap<ParamId, number>;
  private readonly values: Float64Array;
  private readonly listeners = new Set<ParamListener>();

  constructor(specs: readonly ParamSpec[], queueDepth: number = DEFAULT_QUEUE_DEPTH) {
    this.specs = specs;
    this.byId = indexSpecs(specs);
    const indices = new Map<ParamId, number>();
    specs.forEach((spec, index) => indices.set(spec.id, index));
    this.indices = indices;
    this.values = new Float64Array(specs.length);
    this.queue = new ParamQueue(queueDepth);
    this.resetAll('preset');
  }

  get size(): number {
    return this.specs.length;
  }

  spec(id: ParamId): ParamSpec | null {
    return this.byId.get(id) ?? null;
  }

  indexOf(id: ParamId): number {
    return this.indices.get(id) ?? -1;
  }

  /** The normalised value, or NaN for an id this set does not have. */
  normalised(id: ParamId): number {
    const index = this.indexOf(id);
    return index < 0 ? Number.NaN : this.values[index];
  }

  /** The value in the parameter's own unit, which is what a face labels. */
  real(id: ParamId): number {
    const spec = this.spec(id);
    return spec === null ? Number.NaN : toReal(spec, this.normalised(id));
  }

  /** The readout, formatted from the spec. Never assembled by a caller. */
  text(id: ParamId): string {
    const spec = this.spec(id);
    return spec === null ? '' : formatValue(spec, this.normalised(id));
  }

  /**
   * Sets a normalised value and posts it across the seam.
   *
   * The value is quantised through the spec before it is stored, so the number
   * a face draws and the number the processor lands on are the same number. A
   * five-position switch drawn where the finger is while the processor sits on
   * the detent is the "two answers to one question" defect in its most visible
   * form, and storing the unquantised value is how it happens.
   *
   * Returns false when the id is unknown or the value is not a number — the
   * caller finding out is what turns a mis-wired face into a failing test
   * rather than a control that silently does nothing.
   */
  setNormalised(id: ParamId, value: number, origin: ChangeOrigin = 'user'): boolean {
    const index = this.indexOf(id);
    if (index < 0 || !Number.isFinite(value)) return false;
    const spec = this.specs[index];
    const quantised = quantise(spec, value);
    // Negative zero is canonicalised here, at the one place values enter the
    // set. JSON cannot express it — `JSON.stringify(-0)` is `"0"` — so a set
    // holding −0 cannot round-trip through a preset file, and the bit-identity
    // guarantee would fail on a difference no user can see or cause on purpose.
    const settled = Object.is(quantised, -0) ? 0 : quantised;
    this.values[index] = settled;
    this.queue.post(id, settled);
    this.emit({ id, normalised: settled, origin });
    return true;
  }

  /** Sets a value in the parameter's own unit, for callers that think in dB. */
  setReal(id: ParamId, real: number, origin: ChangeOrigin = 'user'): boolean {
    const spec = this.spec(id);
    if (spec === null) return false;
    return this.setNormalised(id, toNormalised(spec, real), origin);
  }

  resetAll(origin: ChangeOrigin = 'preset'): void {
    for (const spec of this.specs) {
      this.setNormalised(spec.id, defaultNormalised(spec), origin);
    }
  }

  /**
   * Every value, keyed by id. This is the shape a preset is captured from and
   * applied to, so it is defined once here rather than in the codec.
   */
  capture(): Map<ParamId, number> {
    const out = new Map<ParamId, number>();
    this.specs.forEach((spec, index) => out.set(spec.id, this.values[index]));
    return out;
  }

  /**
   * Applies a captured set. Ids this set does not have are ignored here and
   * preserved by the preset codec, which is the only place that can preserve
   * them — a set has no room for a parameter it does not declare.
   */
  apply(values: ReadonlyMap<ParamId, number>, origin: ChangeOrigin = 'preset'): void {
    for (const [id, value] of values) {
      this.setNormalised(id, value, origin);
    }
  }

  /**
   * A dense snapshot for a face that redraws every parameter at once.
   *
   * Copied into a caller-supplied array when one is given, so a face redrawing
   * at 60 fps does not allocate a new array sixty times a second and hand the
   * garbage collector a reason to run during playback.
   */
  snapshot(into?: Float64Array): Float64Array {
    const out = into !== undefined && into.length >= this.values.length ? into : new Float64Array(this.values.length);
    out.set(this.values);
    return out;
  }

  subscribe(listener: ParamListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: ParamChangeEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
