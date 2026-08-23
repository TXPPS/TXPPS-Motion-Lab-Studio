/**
 * Motion Wave — the parameter descriptor, TypeScript side.
 *
 * A mirror of `motionwave/core/param/param_spec.h`. The spec is the authority
 * on what a control is: its range, its law, its unit, how fast it may move and
 * what it is called. Automation, presets, modulation, host exposure, MIDI learn
 * and the generic face are all derived from the declaration rather than written
 * per unit (ADR-0004), which is why this file is small and why nothing else is
 * allowed to grow a second opinion about any of it.
 */

import { Taper, Unit, clampNormalised, denormalise, normalise, quantiseNormalised } from './units';

/**
 * Stable within a unit and never renumbered. An id is the key an automation
 * lane and a saved preset name a parameter by, so renumbering one silently
 * re-points every project that automated it. Renaming the display name is free.
 */
export type ParamId = number;

/** A fully-resolved descriptor. Every field is present; nothing infers later. */
export interface ParamSpec {
  readonly id: ParamId;
  /** Display name. Never a trademarked reference name — see LEGAL_NOTES.md. */
  readonly name: string;
  readonly unit: Unit;
  readonly min: number;
  readonly max: number;
  readonly def: number;
  readonly taper: Taper;
  /** Read only when `taper === Exponential`. */
  readonly exponent: number;
  /** Read when `taper === Stepped`, or as the choice count for `Unit.Choice`. */
  readonly steps: number;
  /**
   * Travel time in milliseconds. Zero means the parameter is a switch and is
   * never smoothed: crossfading between two filter modes is the processor's
   * decision, and pretending a switch is continuous is worse than a click.
   */
  readonly smoothingMs: number;
  /** Present only for `Unit.Choice`, with `steps` entries. */
  readonly choices: readonly string[] | null;
}

/** What a declaration site writes. Everything with a sane default is optional. */
export interface ParamSpecInit {
  readonly id: ParamId;
  readonly name: string;
  readonly unit?: Unit;
  readonly min?: number;
  readonly max?: number;
  readonly def?: number;
  readonly taper?: Taper;
  readonly exponent?: number;
  readonly steps?: number;
  readonly smoothingMs?: number;
  readonly choices?: readonly string[];
}

/** Thrown when a spec cannot describe a usable control. */
export class ParamSpecError extends Error {
  constructor(id: ParamId, name: string, problem: string) {
    super(`ParamSpec ${id} ("${name}"): ${problem}`);
    this.name = 'ParamSpecError';
  }
}

/**
 * Resolves and validates a declaration.
 *
 * Every check here fails at module load, when the spec table is first
 * evaluated, rather than at the moment a user turns the knob. A logarithmic
 * taper whose minimum is zero cannot be expressed at all — the C++ falls back
 * to a linear reading so the audio thread never sees a NaN, but a fallback that
 * silently changes a control's law is not something to ship, so the UI side
 * refuses the declaration instead of quietly disagreeing with the processor.
 */
export function defineParam(init: ParamSpecInit): ParamSpec {
  const unit = init.unit ?? Unit.Linear;
  const isChoiceUnit = unit === Unit.Choice;
  const choices = init.choices ?? null;
  const steps = init.steps ?? (choices !== null ? choices.length : 0);
  const min = init.min ?? 0;
  const max = isChoiceUnit ? Math.max(steps - 1, 0) : (init.max ?? 1);
  const taper = init.taper ?? Taper.Linear;
  const exponent = init.exponent ?? 1;
  const smoothingMs = init.smoothingMs ?? (isChoiceUnit || taper === Taper.Stepped ? 0 : 20);
  const def = init.def ?? min;
  const fail = (problem: string): never => {
    throw new ParamSpecError(init.id, init.name, problem);
  };

  if (!Number.isInteger(init.id) || init.id < 0) fail('id must be a non-negative integer');
  if (init.name.length === 0) fail('name must not be empty');
  if (!Number.isFinite(min) || !Number.isFinite(max)) fail('min and max must be finite');
  if (isChoiceUnit) {
    if (choices === null || choices.length < 2) fail('a choice needs at least two options');
    if (choices !== null && choices.length !== steps) fail('steps must equal the choice count');
  } else {
    if (min >= max) fail('min must be below max');
    if (choices !== null) fail('choices are only meaningful on Unit.Choice');
  }
  if (taper === Taper.Logarithmic && min <= 0) fail('a logarithmic taper needs min > 0');
  if (taper === Taper.Exponential && !(exponent > 0)) fail('an exponential taper needs k > 0');
  if (taper === Taper.Stepped && steps < 2) fail('a stepped taper needs at least two steps');
  if (!(smoothingMs >= 0)) fail('smoothingMs must not be negative');
  if (!Number.isFinite(def) || def < min || def > max) fail('def must lie within min..max');

  return {
    id: init.id,
    name: init.name,
    unit,
    min,
    max,
    def,
    taper,
    exponent,
    steps,
    smoothingMs,
    choices,
  };
}

export function isChoice(spec: ParamSpec): boolean {
  return spec.unit === Unit.Choice;
}

/** Whether the audio thread ramps this parameter or jumps it. */
export function isSmoothed(spec: ParamSpec): boolean {
  return spec.smoothingMs > 0 && !isChoice(spec);
}

/** Real value from a normalised position, through this spec's law. */
export function toReal(spec: ParamSpec, normalised: number): number {
  if (isChoice(spec)) {
    const count = spec.steps > 1 ? spec.steps : 1;
    return Math.round(clampNormalised(normalised) * (count - 1));
  }
  return denormalise(normalised, spec.min, spec.max, spec.taper, spec.exponent, spec.steps);
}

/** Normalised position from a real value. The inverse of `toReal`. */
export function toNormalised(spec: ParamSpec, real: number): number {
  if (isChoice(spec)) {
    const count = spec.steps > 1 ? spec.steps : 1;
    if (count < 2) return 0;
    const top = count - 1;
    const index = real < 0 ? 0 : real > top ? top : real;
    return index / top;
  }
  return normalise(real, spec.min, spec.max, spec.taper, spec.exponent, spec.steps);
}

/** The choice index a normalised position selects, clamped to the list. */
export function toChoice(spec: ParamSpec, normalised: number): number {
  const count = spec.steps > 1 ? spec.steps : 1;
  const index = Math.round(toReal(spec, normalised));
  return index < 0 ? 0 : index >= count ? count - 1 : index;
}

/** The nearest position the law can actually reach — what a face must draw. */
export function quantise(spec: ParamSpec, normalised: number): number {
  if (isChoice(spec)) return toNormalised(spec, toChoice(spec, normalised));
  return quantiseNormalised(normalised, spec.taper, spec.steps);
}

export function defaultNormalised(spec: ParamSpec): number {
  return toNormalised(spec, spec.def);
}

/** A spec table indexed by id, for the lookups automation and presets do. */
export function indexSpecs(specs: readonly ParamSpec[]): ReadonlyMap<ParamId, ParamSpec> {
  const byId = new Map<ParamId, ParamSpec>();
  for (const spec of specs) {
    if (byId.has(spec.id)) {
      throw new ParamSpecError(spec.id, spec.name, 'duplicate id in the same spec table');
    }
    byId.set(spec.id, spec);
  }
  return byId;
}
