/**
 * Which primitive a parameter is allowed to wear.
 *
 * Cell 26's first requirement reads like taste and is not. A parameter's own
 * `ParamSpec` says whether it is continuous, stepped or two-state, so "the
 * correct primitive" is decidable — and the failure it prevents is the one
 * every face in the product had: the manifest writes `"control": "switch"` for
 * a seven-position wafer and for an on/off lever alike, and every face turned
 * both into the same element.
 */
import { describe, expect, it } from 'vitest';
import { defineParam } from '../param/spec';
import { Taper, Unit } from '../param/units';
import {
  defaultPrimitiveFor,
  primitiveClassOf,
  primitiveSuits,
  stepCount,
} from '../render/primitive';
import { PrimitiveMismatchError, controlElements } from '../render/faceControls';
import { programEqControls, programEqSpecs } from '../units/program_eq/params.gen';

const continuous = defineParam({ id: 1, name: 'Drive', min: 0, max: 1, def: 0.5 });
const wafer = defineParam({
  id: 2,
  name: 'Low Frequency',
  unit: Unit.Choice,
  min: 0,
  max: 3,
  def: 2,
  taper: Taper.Stepped,
  steps: 4,
  choices: ['20 Hz', '30 Hz', '60 Hz', '100 Hz'],
});
const lever = defineParam({
  id: 3,
  name: 'EQ In',
  unit: Unit.Choice,
  min: 0,
  max: 1,
  def: 1,
  taper: Taper.Stepped,
  steps: 2,
  choices: ['Out', 'In'],
});

describe('a parameter decides which primitives it can wear', () => {
  it('separates a wafer switch from an on/off lever', () => {
    // Both are `"control": "switch"` in the manifest, and both became the same
    // element in every face until cell 26.
    expect(primitiveClassOf(wafer)).toBe('stepped');
    expect(primitiveClassOf(lever)).toBe('binary');
    expect(primitiveClassOf(continuous)).toBe('continuous');
  });

  it('refuses a toggle for a four-position selector, and the reverse', () => {
    expect(primitiveSuits('toggle', wafer)).toBe(false);
    expect(primitiveSuits('selector', wafer)).toBe(true);
    expect(primitiveSuits('selector', lever)).toBe(false);
    expect(primitiveSuits('rocker', lever)).toBe(true);
    expect(primitiveSuits('selector', continuous)).toBe(false);
    expect(primitiveSuits('fader', continuous)).toBe(true);
  });

  it('counts detents from the parameter rather than from its labels', () => {
    // A stepped parameter with no choice strings is exactly the one whose
    // detents matter most: there is no legend to read the position off.
    const unlabelled = defineParam({ id: 4, name: 'Poles', min: 0, max: 4, def: 0, taper: Taper.Stepped, steps: 5 });
    expect(stepCount(unlabelled)).toBe(5);
    expect(stepCount(wafer)).toBe(4);
    expect(stepCount(lever)).toBe(2);
    expect(stepCount(continuous)).toBe(0);
  });

  it('defaults to a knob, a selector and a toggle', () => {
    expect(defaultPrimitiveFor(continuous)).toBe('knob');
    expect(defaultPrimitiveFor(wafer)).toBe('selector');
    expect(defaultPrimitiveFor(lever)).toBe('toggle');
  });
});

describe('a face cannot declare a primitive its parameter cannot wear', () => {
  it('throws where the face is declared, not where the user reaches for it', () => {
    expect(() =>
      controlElements(programEqControls, programEqSpecs, {
        choose: (spec) => (spec.steps === 4 ? 'toggle' : undefined),
      }),
    ).toThrow(PrimitiveMismatchError);
  });

  it('builds the Program EQ without complaint', () => {
    const elements = controlElements(programEqControls, programEqSpecs);
    expect(elements).toHaveLength(programEqControls.length);
    // Not one range input's worth of ambiguity left: every element names a
    // primitive, and every primitive is one a gesture is written for.
    for (const element of elements) {
      expect(['knob', 'fader', 'selector', 'toggle', 'rocker', 'button']).toContain(element.role);
    }
    const roles = new Set(elements.map((e) => e.role));
    expect(roles.has('selector'), 'the wafer switches lost their detents').toBe(true);
    expect(roles.has('knob'), 'the continuous legs lost their dials').toBe(true);
  });

  it('names the parameter it could not dress', () => {
    try {
      controlElements(programEqControls, programEqSpecs, {
        choose: (spec) => (spec.steps === 7 ? 'rocker' : undefined),
      });
      expect.unreachable('a seven-position selector wore a rocker');
    } catch (error) {
      expect(String(error)).toContain('7 position(s)');
    }
  });
});
