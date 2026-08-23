/**
 * Motion Wave — the wet/dry mixer, which cannot be built uncompensated.
 *
 * This class exists because of a specific, shipped, measured defect. In
 * MotionLab Studio the Saturator and the Distortion each blended a wet leg that
 * had been through an oversampled waveshaper — 192 samples of latency, measured
 * at every sample rate — against a dry leg that had been through nothing. At
 * any Mix below 100% the two legs summed 192 samples apart, which is a comb
 * filter with a notch every 250 Hz at 48 kHz. It was not correctable by
 * channel-level delay compensation, because both legs live inside the one
 * insert and the channel can only move the insert as a whole. The wet/dry
 * mixer had always supported holding the dry leg back; neither device asked.
 *
 * The lesson is not "remember to ask". Anything a unit has to remember, some
 * unit will forget, and the fourteen units this framework is being built for
 * are being written by people who will not have read this paragraph. So the
 * mixer takes the wet path's declared latency as a required constructor
 * argument and aligns the dry leg itself. There is no constructor that omits
 * it, no default that means "unknown", and no way to pass a bare number: the
 * argument's type can only be produced by `declareLatency`, which refuses a
 * fractional or negative figure and makes the author say how they got it.
 *
 * `wet_dry.test.ts` proves the runtime half, and `wet_dry_types.test.ts` proves
 * the compile-time half with `@ts-expect-error` — if a future edit adds a
 * convenience constructor that skips the declaration, that file stops
 * type-checking and `npm run typecheck` fails.
 */

import { DelayLine } from './delay_line';
import type { DeclaredLatency } from './latency';
import type { Ramp } from '../param/ramp';

/**
 * How the two legs are weighted.
 *
 * Linear is the default because a wet/dry blend is nearly always between two
 * strongly correlated signals — the same audio, one of them shaped — and for
 * correlated signals linear gains sum to unity. Equal power is right for the
 * uncorrelated case, a reverb tail against a source, where linear gains dip
 * about 3 dB in the middle of the control's travel.
 */
export type MixLaw = 'linear' | 'equalPower';

export interface WetDryOptions {
  readonly law?: MixLaw;
  /** Starting position, 0 = dry only, 1 = wet only. */
  readonly mix?: number;
}

/** Anything that has declared what it costs. A unit, a chain, a shared library. */
export interface LatencyDeclaring {
  readonly declaredLatency: DeclaredLatency;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export class WetDryMixer {
  /** The wet path's latency, as declared. Never inferred and never defaulted. */
  readonly latency: DeclaredLatency;
  readonly law: MixLaw;
  private readonly dryDelay: DelayLine;
  private mixValue: number;

  /**
   * Private so that `forWetPath` is the only entry point. A public constructor
   * could be called with an object literal that satisfies the shape, and the
   * brand on `DeclaredLatency` would be the only thing standing in the way —
   * one `as` away from the defect this class exists to prevent.
   */
  private constructor(latency: DeclaredLatency, law: MixLaw, mix: number) {
    this.latency = latency;
    this.law = law;
    this.mixValue = clamp01(mix);
    this.dryDelay = new DelayLine(latency.frames);
  }

  /**
   * The only way to build one. `latency` is what the wet path costs; the dry
   * leg is held back by exactly that much, here, so a caller cannot forget to.
   */
  static forWetPath(latency: DeclaredLatency, options: WetDryOptions = {}): WetDryMixer {
    return new WetDryMixer(latency, options.law ?? 'linear', options.mix ?? 1);
  }

  /** The same thing, reading the declaration off the processor in the wet leg. */
  static forProcessor(processor: LatencyDeclaring, options: WetDryOptions = {}): WetDryMixer {
    return WetDryMixer.forWetPath(processor.declaredLatency, options);
  }

  get mix(): number {
    return this.mixValue;
  }

  setMix(value: number): void {
    if (!Number.isFinite(value)) return;
    this.mixValue = clamp01(value);
  }

  /** How far the dry leg is held back. Equal to the wet path's latency, always. */
  get compensationFrames(): number {
    return this.latency.frames;
  }

  /**
   * What the insert containing this mixer reports to plugin delay compensation.
   *
   * It is the wet path's latency and not zero, and that is the point: aligning
   * inside the insert makes the whole insert late by that much, which the
   * channel *can* compensate. Reporting zero here would move the defect from
   * inside the insert, where nothing could fix it, to the channel, where the
   * fix already exists — but only if the number is reported.
   */
  get reportedLatencyFrames(): number {
    return this.latency.frames;
  }

  reset(): void {
    this.dryDelay.reset();
  }

  /** The two gains at a mix position, for a face that draws the blend. */
  gainsAt(mix: number): { dry: number; wet: number } {
    const position = clamp01(mix);
    if (this.law === 'equalPower') {
      const angle = (position * Math.PI) / 2;
      return { dry: Math.cos(angle), wet: Math.sin(angle) };
    }
    return { dry: 1 - position, wet: position };
  }

  /**
   * Blends one buffer at the current mix position.
   *
   * `out` may be the same array as `dry` or as `wet`: both inputs for a sample
   * are read before that sample's output is written, so aliasing is safe by
   * construction rather than by convention.
   */
  process(dry: Float32Array, wet: Float32Array, out: Float32Array, frames: number): void {
    const { dry: dryGain, wet: wetGain } = this.gainsAt(this.mixValue);
    for (let i = 0; i < frames; i++) {
      const dryDelayed = this.dryDelay.tick(dry[i]);
      const wetSample = wet[i];
      out[i] = dryDelayed * dryGain + wetSample * wetGain;
    }
  }

  /**
   * Blends across a moving mix position.
   *
   * Automating Mix through a per-block step produces a discontinuity at every
   * block boundary — the zipper the harness's D10 cell looks for. Taking the
   * ramp the parameter framework already produces, rather than a scalar, is
   * what makes a swept blend continuous without any unit writing smoothing of
   * its own.
   */
  processRamped(
    dry: Float32Array,
    wet: Float32Array,
    out: Float32Array,
    frames: number,
    mixRamp: Ramp,
  ): void {
    if (!mixRamp.moving || frames <= 1) {
      this.setMix(mixRamp.end);
      this.process(dry, wet, out, frames);
      return;
    }
    const step = (mixRamp.end - mixRamp.start) / (frames - 1);
    for (let i = 0; i < frames; i++) {
      const { dry: dryGain, wet: wetGain } = this.gainsAt(mixRamp.start + step * i);
      const dryDelayed = this.dryDelay.tick(dry[i]);
      const wetSample = wet[i];
      out[i] = dryDelayed * dryGain + wetSample * wetGain;
    }
    this.mixValue = clamp01(mixRamp.end);
  }
}
