import { describe, expect, it } from 'vitest';

import {
  accessibleValue,
  formatValue,
  parseDisplay,
  suffixFor,
  unitSuffix,
} from '../param/format';
import {
  ParamSpecError,
  defaultNormalised,
  defineParam,
  indexSpecs,
  isSmoothed,
  quantise,
  toChoice,
  toNormalised,
  toReal,
} from '../param/spec';
import { Taper, Unit, clampNormalised, denormalise, normalise } from '../param/units';

/** One spec per law, covering the ranges real units actually use. */
const LINEAR = defineParam({ id: 1, name: 'Gain', unit: Unit.Decibels, min: -60, max: 24, def: 0 });
const LOG = defineParam({
  id: 2,
  name: 'Frequency',
  unit: Unit.Hertz,
  min: 20,
  max: 20000,
  def: 1000,
  taper: Taper.Logarithmic,
});
const EXPONENTIAL = defineParam({
  id: 3,
  name: 'Attack',
  unit: Unit.Milliseconds,
  min: 0.1,
  max: 2000,
  def: 10,
  taper: Taper.Exponential,
  exponent: 3,
});
const STEPPED = defineParam({
  id: 4,
  name: 'Poles',
  unit: Unit.Linear,
  min: 1,
  max: 4,
  def: 2,
  taper: Taper.Stepped,
  steps: 4,
});
const CHOICE = defineParam({
  id: 5,
  name: 'Mode',
  unit: Unit.Choice,
  choices: ['Low', 'Band', 'High', 'Notch'],
});

describe('normalise and denormalise are exact inverses across all four laws', () => {
  const positions = Array.from({ length: 101 }, (_, index) => index / 100);

  for (const spec of [LINEAR, LOG, EXPONENTIAL]) {
    it(`${spec.name}: real → normalised → real to 1e-9`, () => {
      for (const position of positions) {
        const real = toReal(spec, position);
        const back = toReal(spec, toNormalised(spec, real));
        expect(Math.abs(back - real)).toBeLessThan(1e-9 * Math.max(1, Math.abs(real)));
      }
    });

    it(`${spec.name}: normalised → real → normalised to 1e-9`, () => {
      for (const position of positions) {
        const back = toNormalised(spec, toReal(spec, position));
        expect(Math.abs(back - position)).toBeLessThan(1e-9);
      }
    });
  }

  it('Stepped: every position lands on a detent and returns to it exactly', () => {
    for (const position of positions) {
      const real = toReal(STEPPED, position);
      const settled = quantise(STEPPED, position);
      expect(Math.abs(toNormalised(STEPPED, real) - settled)).toBeLessThan(1e-9);
      expect(Math.abs(toReal(STEPPED, settled) - real)).toBeLessThan(1e-9);
    }
  });

  it('Choice: every index round-trips to itself', () => {
    for (let index = 0; index < 4; index++) {
      expect(toChoice(CHOICE, toNormalised(CHOICE, index))).toBe(index);
    }
  });

  it('reaches both ends of the range exactly', () => {
    for (const spec of [LINEAR, LOG, EXPONENTIAL, STEPPED]) {
      expect(toReal(spec, 0)).toBeCloseTo(spec.min, 12);
      expect(toReal(spec, 1)).toBeCloseTo(spec.max, 12);
    }
  });
});

describe('the clamp is the same clamp the core applies', () => {
  it('clamps a controller that overshoots either end', () => {
    expect(clampNormalised(-0.5)).toBe(0);
    expect(clampNormalised(1.0000001)).toBe(1);
    expect(denormalise(2, 0, 10, Taper.Linear, 1, 0)).toBe(10);
    expect(normalise(-5, 0, 10, Taper.Linear, 1, 0)).toBe(0);
  });

  it('answers with the linear reading rather than a NaN for an impossible log taper', () => {
    // The C++ guards this rather than asserting, because a NaN reaching a
    // filter coefficient silences a channel and a slightly wrong curve does not.
    const value = denormalise(0.5, 0, 100, Taper.Logarithmic, 1, 0);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBe(50);
  });
});

describe('a spec that cannot describe a usable control is refused at declaration', () => {
  it('refuses a logarithmic taper with a zero minimum', () => {
    expect(() =>
      defineParam({ id: 9, name: 'Bad', min: 0, max: 100, taper: Taper.Logarithmic }),
    ).toThrow(ParamSpecError);
  });

  it('refuses an inverted range, a default outside it, and a one-way choice', () => {
    expect(() => defineParam({ id: 9, name: 'Bad', min: 10, max: 1 })).toThrow(ParamSpecError);
    expect(() => defineParam({ id: 9, name: 'Bad', min: 0, max: 1, def: 2 })).toThrow(ParamSpecError);
    expect(() => defineParam({ id: 9, name: 'Bad', unit: Unit.Choice, choices: ['One'] })).toThrow(
      ParamSpecError,
    );
  });

  it('refuses a duplicate id in one table, which would silently shadow a control', () => {
    expect(() => indexSpecs([LINEAR, { ...LINEAR, name: 'Other' }])).toThrow(ParamSpecError);
  });

  it('never smooths a switch', () => {
    expect(isSmoothed(CHOICE)).toBe(false);
    expect(isSmoothed(STEPPED)).toBe(false);
    expect(isSmoothed(LINEAR)).toBe(true);
  });

  it('places the default where the declaration asked', () => {
    expect(toReal(LOG, defaultNormalised(LOG))).toBeCloseTo(1000, 9);
  });
});

describe('a control says the same thing to every reader', () => {
  it('prints each unit with the precision that unit resolves', () => {
    expect(formatValue(LINEAR, toNormalised(LINEAR, -6))).toBe('-6.0 dB');
    expect(formatValue(LINEAR, toNormalised(LINEAR, 3))).toBe('+3.0 dB');
    expect(formatValue(LOG, toNormalised(LOG, 440))).toBe('440 Hz');
    expect(formatValue(LOG, toNormalised(LOG, 5000))).toBe('5.00 kHz');
    expect(formatValue(CHOICE, toNormalised(CHOICE, 2))).toBe('High');
  });

  it('never prints a frequency as "1000 Hz", which would be the same value twice', () => {
    // A logarithmic default of 1000 Hz lands a hair below it in floating point,
    // and a naive threshold prints "1000 Hz" there and "1.00 kHz" a step later.
    for (const hz of [999.4, 999.6, 999.9999, 1000, 1000.4]) {
      const printed = formatValue(LOG, toNormalised(LOG, hz));
      expect(printed, `${hz} printed as ${printed}`).not.toMatch(/^\d{4} Hz$/);
    }
    expect(formatValue(LOG, toNormalised(LOG, 999.4))).toBe('999 Hz');
    expect(formatValue(LOG, toNormalised(LOG, 1000))).toBe('1.00 kHz');
  });

  it('signs a boost so it cannot be read as a cut in a column of numbers', () => {
    expect(formatValue(LINEAR, toNormalised(LINEAR, 12)).startsWith('+')).toBe(true);
    expect(formatValue(LINEAR, toNormalised(LINEAR, -12)).startsWith('-')).toBe(true);
  });

  it('reads back the text it printed, suffix and all', () => {
    const printed = formatValue(LOG, toNormalised(LOG, 5000));
    const parsed = parseDisplay(LOG, printed);
    expect(parsed).not.toBeNull();
    expect(toReal(LOG, parsed ?? 0)).toBeCloseTo(5000, 3);
    expect(toReal(LOG, parseDisplay(LOG, '1.2k') ?? 0)).toBeCloseTo(1200, 6);
  });

  it('refuses text that is not a value rather than clamping it to the minimum', () => {
    expect(parseDisplay(LINEAR, 'loud')).toBeNull();
    expect(parseDisplay(CHOICE, 'Sideways')).toBeNull();
    expect(parseDisplay(CHOICE, 'notch')).toBeCloseTo(1, 9);
  });

  it('announces the control by name and value together', () => {
    expect(accessibleValue(LOG, toNormalised(LOG, 440))).toBe('Frequency, 440 Hz');
  });

  it('moves the suffix with the value where the unit does', () => {
    expect(unitSuffix(Unit.Hertz)).toBe(' Hz');
    expect(suffixFor(LOG, 440)).toBe(' Hz');
    expect(suffixFor(LOG, 4400)).toBe(' kHz');
  });
});
