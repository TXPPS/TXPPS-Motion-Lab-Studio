/**
 * Motion Wave — parameter units and taper laws, TypeScript side.
 *
 * This is a mirror of `motionwave/core/param/units.h`, not a second design.
 * ADR-0004 puts the normalised↔real conversion in exactly one place because a
 * display that computes a real value one way and a processor that computes it
 * another produces two answers to one question — the bug where a control is
 * labelled "Q" and read as decibels. The core owns that conversion for the
 * audio thread; this file owns it for the UI, and the two must agree bit for
 * bit on the same inputs, which `param.test.ts` asserts against the same cases
 * `core/test/param_tests.cpp` uses.
 *
 * Where the C++ clamps, this clamps identically, including in the cases that
 * look like oversights: a logarithmic taper with a non-positive minimum
 * answers with the linear reading rather than a NaN, because a NaN reaching a
 * filter coefficient silences a channel and a slightly wrong curve does not.
 */

/**
 * What a parameter's real value means. Drives formatting, and for `Choice`
 * the shape of the taper. The numbering matches the C++ enum's declaration
 * order so a value can cross the WASM boundary as an integer unchanged.
 */
export enum Unit {
  Linear = 0,
  Decibels = 1,
  Hertz = 2,
  Seconds = 3,
  Milliseconds = 4,
  /** Real value 0..1, displayed multiplied by 100. */
  Percent = 5,
  /** n:1. */
  Ratio = 6,
  Semitones = 7,
  Cents = 8,
  /** Real value is an index into the spec's `choices`. */
  Choice = 9,
}

/** How a normalised position maps onto the real range. */
export enum Taper {
  /** Even. Correct wherever the parameter is already perceptually even. */
  Linear = 0,
  /** Constant ratio per unit of travel — what frequency wants. Needs min > 0. */
  Logarithmic = 1,
  /** `min + (max - min) * n^k`, for ranges bunched at one end. */
  Exponential = 2,
  /** Quantised to `steps` evenly spaced positions, both ends included. */
  Stepped = 3,
}

/**
 * Clamps a normalised position into 0..1.
 *
 * A controller that sends 1.0000001 must not produce a value outside the
 * parameter's range, and clamping at this one seam means nothing downstream
 * has to. NaN is left alone here so that this function stays the exact mirror
 * of the C++; the places that must not pass a NaN on — the preset codec and
 * the parameter set — reject it explicitly and say so.
 */
export function clampNormalised(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Real value from a normalised 0..1 position. */
export function denormalise(
  n: number,
  min: number,
  max: number,
  taper: Taper,
  exponent: number,
  steps: number,
): number {
  const q = clampNormalised(n);
  switch (taper) {
    case Taper.Logarithmic:
      if (min <= 0 || max <= 0) return min + q * (max - min);
      return min * Math.pow(max / min, q);
    case Taper.Exponential:
      return min + (max - min) * Math.pow(q, exponent);
    case Taper.Stepped: {
      if (steps < 2) return min;
      const step = Math.round(q * (steps - 1));
      return min + (max - min) * (step / (steps - 1));
    }
    case Taper.Linear:
    default:
      return min + q * (max - min);
  }
}

/**
 * Normalised 0..1 position from a real value. The exact inverse of
 * `denormalise` for every law, asserted by round-trip to 1e-9.
 */
export function normalise(
  v: number,
  min: number,
  max: number,
  taper: Taper,
  exponent: number,
  steps: number,
): number {
  const lo = min < max ? min : max;
  const hi = min < max ? max : min;
  const value = v < lo ? lo : v > hi ? hi : v;
  switch (taper) {
    case Taper.Logarithmic:
      if (min <= 0 || max <= 0 || max === min) {
        return max === min ? 0 : (value - min) / (max - min);
      }
      return Math.log(value / min) / Math.log(max / min);
    case Taper.Exponential: {
      if (max === min || exponent <= 0) return 0;
      const t = (value - min) / (max - min);
      return Math.pow(t < 0 ? 0 : t, 1 / exponent);
    }
    case Taper.Stepped: {
      if (steps < 2 || max === min) return 0;
      const t = (value - min) / (max - min);
      return Math.round(t * (steps - 1)) / (steps - 1);
    }
    case Taper.Linear:
    default:
      return max === min ? 0 : (value - min) / (max - min);
  }
}

/**
 * The nearest normalised position a stepped or choice law can actually reach.
 *
 * A knob dragged to 0.31 on a five-position switch is at position 1, and the
 * *display* has to say so: a face that draws the pointer where the finger is
 * while the processor sits on the detent is the two-answers bug in its most
 * visible form.
 */
export function quantiseNormalised(n: number, taper: Taper, steps: number): number {
  if (taper !== Taper.Stepped || steps < 2) return clampNormalised(n);
  return Math.round(clampNormalised(n) * (steps - 1)) / (steps - 1);
}
