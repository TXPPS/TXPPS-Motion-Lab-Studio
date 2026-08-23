/**
 * Motion Wave — a parameter across one buffer.
 *
 * The mirror of `core/param/param_block.h`. The audio thread does not read
 * "the value of parameter 7"; it reads where that parameter started, where it
 * ends, and whether it moved at all. Automation, modulation and a finger on a
 * knob all arrive as this one shape, which is what lets a processor stay
 * ignorant of which of them moved it (ADR-0004).
 *
 * The UI side keeps two flavours of it. A `Ramp` in normalised space is what
 * automation and modulation compose in, because that is the only space where
 * summing two contributions and clamping the result is meaningful. A `Ramp` in
 * real units is what a processor and a face both read, and it is produced from
 * the normalised one through the spec — once, here.
 */

import { type ParamSpec, toReal } from './spec';

export interface Ramp {
  readonly start: number;
  readonly end: number;
  /**
   * False when the value is constant across the buffer, which is the common
   * case and lets a processor take its cheap path without comparing floats.
   */
  readonly moving: boolean;
}

/** A ramp that does not move. The shape a settled parameter always reports. */
export function steady(value: number): Ramp {
  return { start: value, end: value, moving: false };
}

export function rampOf(start: number, end: number): Ramp {
  return { start, end, moving: start !== end };
}

/**
 * The value at a sample offset within a buffer of `frames`.
 *
 * Linear across the block. The smoother's own curve is exponential, but over a
 * buffer the difference is inaudible and a line is one multiply — the same
 * trade the C++ records, kept identical here so a face drawing the ramp draws
 * what the processor played rather than a better-looking approximation of it.
 */
export function rampAt(ramp: Ramp, frame: number, frames: number): number {
  if (!ramp.moving || frames <= 1) return ramp.end;
  const t = frame / (frames - 1);
  return ramp.start + (ramp.end - ramp.start) * t;
}

/** The per-sample increment, for a processor that would rather add than lerp. */
export function rampIncrement(ramp: Ramp, frames: number): number {
  if (!ramp.moving || frames <= 1) return 0;
  return (ramp.end - ramp.start) / (frames - 1);
}

/**
 * Converts a normalised ramp into the parameter's own unit.
 *
 * Both ends go through the spec's law, so a logarithmic parameter's ramp is a
 * straight line in normalised space and a curve in hertz — which is what makes
 * an automated filter sweep sound even. Converting only the end value and
 * scaling the start would produce the opposite, and it is the mistake that is
 * invisible on a display and obvious in the room.
 */
export function toRealRamp(spec: ParamSpec, ramp: Ramp): Ramp {
  const start = toReal(spec, ramp.start);
  const end = toReal(spec, ramp.end);
  return { start, end, moving: ramp.moving && start !== end };
}
