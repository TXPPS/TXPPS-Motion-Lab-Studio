/**
 * Motion Wave — turning a parameter into text, and text back into a parameter.
 *
 * Formatting is derived from `spec.unit` and from nothing else. A unit that
 * writes its own readout is a unit that can label a control in one unit while
 * the processor reads another, which ADR-0004 names as the specific failure
 * this framework exists to make unrepresentable. The generic face, a custom
 * face, the automation lane's tooltip and a host's parameter list all call the
 * functions here, so there is one answer to "what does this control say".
 */

import { Unit } from './units';
import { type ParamSpec, isChoice, toChoice, toReal, toNormalised } from './spec';

/** The suffix a unit prints. Empty for the units that carry theirs inline. */
export function unitSuffix(unit: Unit): string {
  switch (unit) {
    case Unit.Decibels:
      return ' dB';
    case Unit.Hertz:
      return ' Hz';
    case Unit.Seconds:
      return ' s';
    case Unit.Milliseconds:
      return ' ms';
    case Unit.Percent:
      return ' %';
    case Unit.Semitones:
      return ' st';
    case Unit.Cents:
      return ' ct';
    case Unit.Ratio:
    case Unit.Choice:
    case Unit.Linear:
    default:
      return '';
  }
}

/**
 * Significant figures per unit, chosen so the readout resolves what the ear
 * does and no further. Three decimal places on a frequency reads as precision
 * the model does not have, and it makes the number change width while a knob
 * moves, which is what makes a strip look unstable.
 */
function decimalsFor(unit: Unit, magnitude: number): number {
  switch (unit) {
    case Unit.Decibels:
      return Math.abs(magnitude) >= 100 ? 0 : 1;
    case Unit.Hertz:
      if (magnitude >= 10000) return 1;
      if (magnitude >= 1000) return 2;
      return magnitude >= 100 ? 0 : 1;
    case Unit.Seconds:
      return 2;
    case Unit.Milliseconds:
      return magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : 2;
    case Unit.Percent:
      return magnitude >= 10 ? 0 : 1;
    case Unit.Ratio:
      return magnitude >= 10 ? 0 : 1;
    case Unit.Semitones:
      return 2;
    case Unit.Cents:
      return 0;
    case Unit.Linear:
    default:
      return 2;
  }
}

/**
 * Whether a frequency prints in kilohertz.
 *
 * The threshold is 999.5 rather than 1000 because below a kilohertz the readout
 * carries no decimals: a value of 999.7 Hz would round to the string "1000 Hz"
 * while 1000.1 Hz prints "1.00 kHz", and the same frequency would appear in two
 * forms depending on which side of an invisible line the float landed. One
 * question, one answer — including at the boundary.
 */
function usesKilohertz(real: number): boolean {
  return Math.abs(real) >= 999.5;
}

/**
 * The number as displayed, without its suffix.
 *
 * Hertz above a kilohertz is printed in kHz because a four-digit frequency and
 * a three-digit one in the same column make the column jump; the suffix moves
 * with it, which is why the two are formatted together rather than separately.
 */
export function formatReal(spec: ParamSpec, real: number): string {
  if (isChoice(spec)) {
    const index = Math.max(0, Math.min(spec.steps - 1, Math.round(real)));
    return spec.choices?.[index] ?? String(index);
  }
  if (spec.unit === Unit.Percent) {
    const percent = real * 100;
    return percent.toFixed(decimalsFor(Unit.Percent, Math.abs(percent)));
  }
  if (spec.unit === Unit.Hertz && usesKilohertz(real)) {
    return (real / 1000).toFixed(2);
  }
  return real.toFixed(decimalsFor(spec.unit, Math.abs(real)));
}

/** The suffix for a specific value, which frequency changes as it crosses 1 kHz. */
export function suffixFor(spec: ParamSpec, real: number): string {
  if (spec.unit === Unit.Hertz && usesKilohertz(real)) return ' kHz';
  if (spec.unit === Unit.Ratio) return ':1';
  return unitSuffix(spec.unit);
}

/**
 * The full readout for a normalised position: what the control says out loud.
 *
 * Decibels carry an explicit `+` above zero. A gain that reads "3.0 dB" beside
 * one that reads "-3.0 dB" is ambiguous at a glance in a column of numbers, and
 * a boost mistaken for a cut is the kind of error a mix survives but a master
 * does not.
 */
export function formatValue(spec: ParamSpec, normalised: number): string {
  const real = toReal(spec, normalised);
  if (isChoice(spec)) return formatReal(spec, toChoice(spec, normalised));
  const body = formatReal(spec, real);
  const signed = spec.unit === Unit.Decibels && real > 0 && !body.startsWith('+') ? `+${body}` : body;
  return `${signed}${suffixFor(spec, real)}`;
}

/** Label and value together, as a screen reader announces the control. */
export function accessibleValue(spec: ParamSpec, normalised: number): string {
  return `${spec.name}, ${formatValue(spec, normalised)}`;
}

/**
 * Reads typed text back to a normalised position, or null if it is not a value.
 *
 * Accepts the suffix the field prints so a user can select the readout, retype
 * it and press return without deleting the unit first — the interaction every
 * DAW has, and the one that feels broken the instant it rejects its own output.
 * Returns null rather than clamping garbage to zero: a typo that silently sets
 * a threshold to its minimum is worse than a field that refuses the entry.
 */
export function parseDisplay(spec: ParamSpec, text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  if (isChoice(spec) && spec.choices !== null) {
    const lower = trimmed.toLowerCase();
    const index = spec.choices.findIndex((choice) => choice.toLowerCase() === lower);
    if (index >= 0) return toNormalised(spec, index);
    return null;
  }

  const match = /^([+-]?\d*\.?\d+)\s*([a-zA-Z%:]*[a-zA-Z%]|)/.exec(trimmed);
  if (match === null) return null;
  const magnitude = Number.parseFloat(match[1]);
  if (!Number.isFinite(magnitude)) return null;

  const suffix = match[2].toLowerCase();
  // A frequency typed as "1.2k" or "1.2 kHz" means 1200 Hz. Without this the
  // field accepts the text it printed itself and reads it as 1.2 Hz.
  const scaled =
    spec.unit === Unit.Hertz && (suffix === 'k' || suffix === 'khz') ? magnitude * 1000 : magnitude;
  const real = spec.unit === Unit.Percent ? scaled / 100 : scaled;
  return toNormalised(spec, real);
}
