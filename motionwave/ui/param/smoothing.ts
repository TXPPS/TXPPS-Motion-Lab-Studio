/**
 * Motion Wave — the block-rate smoother, mirrored from the core.
 *
 * The exact arithmetic of `Smoother` in `core/param/param_block.h`. It is
 * duplicated here for one reason: the verification harness renders offline
 * without the C++ core (ADR-0005 — Emscripten is not on this host), and a
 * harness that smoothed differently from the engine would report a unit as free
 * of zipper noise that zips in the product, or the reverse. The two are
 * asserted equal by the same cases the C++ tests use.
 *
 * Smoothing runs once per buffer, not once per sample. The ramp inside a `Ramp`
 * covers the buffer, and evaluating a one-pole per sample would cost an
 * exponential per sample to describe a line the processor interpolates anyway.
 */

import { type Ramp, rampOf } from './ramp';

/** Below this, a parameter has arrived and is snapped so it stops reporting movement. */
const EPSILON = 1e-6;

export class Smoother {
  private currentValue = 0;
  private targetValue = 0;
  private coefficient = 1;

  /** `timeMs` of zero makes this a pass-through, which is what a switch wants. */
  configure(sampleRate: number, blockFrames: number, timeMs: number): void {
    if (timeMs <= 0 || sampleRate <= 0 || blockFrames <= 0) {
      this.coefficient = 1;
      return;
    }
    // The fraction of the remaining distance one buffer covers. Expressed in
    // buffers rather than samples because that is the rate it is advanced at;
    // deriving it per block would put an exp() in the audio callback for a
    // number that only changes when the device does.
    const tau = timeMs * 0.001 * sampleRate;
    const value = 1 - Math.exp(-blockFrames / (tau > 1 ? tau : 1));
    this.coefficient = value > 1 ? 1 : value;
  }

  /**
   * Jumps without travelling. Used when a unit is reconfigured or a preset
   * loads, where gliding up from silence would be an audible artefact of the
   * load rather than anything the preset asked for.
   */
  reset(value: number): void {
    this.currentValue = value;
    this.targetValue = value;
  }

  setTarget(value: number): void {
    this.targetValue = value;
  }

  get current(): number {
    return this.currentValue;
  }

  get target(): number {
    return this.targetValue;
  }

  /** Advances one buffer and describes the journey. */
  advance(): Ramp {
    const from = this.currentValue;
    this.currentValue += (this.targetValue - this.currentValue) * this.coefficient;
    // Snapped once the remaining distance stops mattering, so a parameter that
    // has arrived reports `moving === false` and every processor downstream
    // takes its constant path instead of interpolating a line of zero length
    // for the rest of the session.
    if (Math.abs(this.targetValue - this.currentValue) < EPSILON * (1 + Math.abs(this.targetValue))) {
      this.currentValue = this.targetValue;
    }
    return rampOf(from, this.currentValue);
  }
}
