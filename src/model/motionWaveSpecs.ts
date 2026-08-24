/**
 * The host's view of a Motion Wave unit, derived from its manifest.
 *
 * Every unit's parameters, ranges, tapers and choices already exist, generated
 * from the same manifest the C++ dispatch comes from. This translates that into
 * the shape `EFFECT_SPECS` uses, so the insert picker, the automation registry,
 * the macro system and the collapsed device slot all work on a Motion Wave unit
 * without any of them knowing one exists.
 *
 * **Written as a translation and not as a table.** A hand-written copy of
 * fourteen units' parameters here would be the second opinion the manifest
 * exists to prevent — `npm run params:check` guards the two generated sides
 * against drift, and a third hand-maintained side would be outside that guard.
 * The only thing this file decides is how a Motion Wave unit *presents* in
 * MotionLab's vocabulary, which is genuinely the host's business.
 */
import { MOTIONWAVE_UNITS } from '../audio/motionwave/registry';
import { Taper, Unit } from '../../motionwave/ui/param/units';
import type { ParamSpec as MotionWaveParamSpec } from '../../motionwave/ui/param/spec';
import type { EffectSpec, ParamSpec } from './effects';

/**
 * How a Motion Wave unit maps onto the host's display units.
 *
 * Every Motion Wave unit maps onto something, including `Linear`, which maps to
 * the host's `dial` — a number printed bare. That is not the same as omitting
 * the unit: the catalogue guard requires every parameter to declare one, so
 * that a control cannot reach a panel as an unexplained number by nobody having
 * thought about it. "Bare, deliberately" is checkable; silence is not.
 */
function hostUnitFor(unit: Unit): ParamSpec['unit'] | undefined {
  switch (unit) {
    case Unit.Decibels:
      return 'dB';
    case Unit.Hertz:
      return 'Hz';
    case Unit.Seconds:
      return 's';
    case Unit.Milliseconds:
      return 'ms';
    case Unit.Percent:
      return '%';
    case Unit.Ratio:
      return ':1';
    case Unit.Semitones:
      return 'st';
    case Unit.Cents:
      return 'cents';
    case Unit.Linear:
      return 'dial';
    case Unit.Choice:
      // A choice carries its own named list, which is what the guard accepts in
      // place of a unit — and a symbol beside "Off / On" would be nonsense.
      return undefined;
  }
}

/**
 * A step the host's sliders can use.
 *
 * Motion Wave parameters are continuous with a taper; the host's `ParamSpec`
 * wants a step. A stepped parameter gets exactly its own detents — anything
 * else would let a user land between two choices — and a continuous one gets a
 * thousandth of its range, which is finer than a pixel on any panel this ships
 * on and coarse enough that a stored value round-trips through a text field.
 */
function stepFor(spec: MotionWaveParamSpec): number {
  if (spec.taper === Taper.Stepped || spec.unit === Unit.Choice) {
    const detents = Math.max(2, spec.steps);
    return (spec.max - spec.min) / (detents - 1);
  }
  return (spec.max - spec.min) / 1000;
}

function toHostParam(spec: MotionWaveParamSpec, index: number): ParamSpec {
  const unit = hostUnitFor(spec.unit);
  return {
    // The id, as a string, because that is what the C++ dispatch switches on
    // and what `fx:<effectId>:<key>` therefore has to carry for automation to
    // reach the right parameter.
    key: String(spec.id),
    label: spec.name,
    min: spec.min,
    max: spec.max,
    step: stepFor(spec),
    default: spec.def,
    ...(unit ? { unit } : {}),
    // Logarithmic is the only taper the host's slider can express; the others
    // are close enough to linear travel that claiming otherwise would be worse.
    curve: spec.taper === Taper.Logarithmic ? ('log' as const) : ('linear' as const),
    ...(spec.choices ? { choices: spec.choices } : {}),
    // The first four on the closed slot, which is what the host does for its
    // own devices when nothing is flagged. Manifests order their parameters as
    // a panel reads, so the first four are the ones a user reaches for.
    ...(index < 4 ? { micro: true } : {}),
  };
}

export const MOTIONWAVE_EFFECT_SPECS: EffectSpec[] = MOTIONWAVE_UNITS.map((entry) => ({
  kind: entry.kind,
  label: entry.label,
  blurb: entry.blurb,
  group: 'motionwave' as const,
  params: entry.unit.specs.map(toHostParam),
}));
