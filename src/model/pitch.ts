/**
 * Monophonic pitch detection for the tuner and for Vocal Tune's note analysis.
 *
 * Pure maths: samples in, a frequency and a confidence out. Nothing here knows
 * about Web Audio, so the same detector runs on a live analyser window, on a
 * clip being prepared for pitch editing, and in the tests.
 *
 * The method is YIN (de Cheveigné & Kawahara 2002): a squared-difference
 * function, normalised by its own cumulative mean so that a period shows up as
 * a dip towards zero regardless of how loud the signal is. It is chosen over a
 * plain FFT peak because a tuner must resolve a cent — 0.06 % — and because the
 * loudest partial of a real instrument is very often not its fundamental.
 *
 * Plain YIN with parabolic interpolation is only accurate to a few tenths of a
 * percent, which is tens of cents at the top of the range where a period is
 * barely 30 samples long. The refinement stage below fixes that: once a rough
 * period is known, the difference function is evaluated again near the *k*-th
 * multiple of it, and dividing that lag by k divides the interpolation error by
 * k as well.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Below this the window is noise or silence and no pitch is reported. */
const SILENCE_RMS = 1e-5;

/** YIN's absolute threshold: the first dip under it wins, which avoids octave errors. */
const DEFAULT_THRESHOLD = 0.15;

/** Readings below this are not shown as a note; the tuner needle goes idle. */
export const DEFAULT_MIN_CONFIDENCE = 0.5;

export interface PitchOptions {
  /** Lowest fundamental to look for, in Hz. A1 is 55 Hz. */
  minHz?: number;
  /** Highest fundamental to look for, in Hz. A6 is 1760 Hz. */
  maxHz?: number;
  /** YIN absolute threshold, 0..1. Lower is stricter. */
  threshold?: number;
  /** Confidence under which `hz` is reported as 0 rather than guessed. */
  minConfidence?: number;
}

export interface PitchReading {
  /** Detected fundamental in Hz, or 0 when nothing periodic was found. */
  hz: number;
  /** 0..1, where 1 means the window repeats itself exactly at that period. */
  confidence: number;
}

/**
 * Reusable detector. A tuner analyses a window several times a second, so the
 * working buffers are kept between calls and only regrown when the window size
 * or the frequency range changes.
 */
export class PitchDetector {
  readonly sampleRate: number;
  private difference = new Float32Array(0);
  private normalised = new Float32Array(0);
  /** Five lags either side of the refinement centre; fixed size, never regrown. */
  private readonly refinement = new Float32Array(5);

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  detect(samples: Float32Array, options: PitchOptions = {}): PitchReading {
    const minHz = options.minHz ?? 50;
    const maxHz = options.maxHz ?? 2000;
    const threshold = options.threshold ?? DEFAULT_THRESHOLD;
    const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    const n = samples.length;
    const silent: PitchReading = { hz: 0, confidence: 0 };

    // Half the window is compared against the other half, so the longest period
    // measurable is half the window — that is the hard floor on `minHz`.
    const compare = n >> 1;
    if (compare < 4) return silent;

    let energy = 0;
    for (let i = 0; i < n; i++) energy += samples[i] * samples[i];
    if (Math.sqrt(energy / n) < SILENCE_RMS) return silent;

    const maxLag = Math.min(Math.floor(this.sampleRate / minHz), compare - 1);
    const minLag = Math.max(2, Math.ceil(this.sampleRate / maxHz));
    if (maxLag <= minLag) return silent;

    if (this.difference.length < maxLag + 1) {
      this.difference = new Float32Array(maxLag + 1);
      this.normalised = new Float32Array(maxLag + 1);
    }
    const d = this.difference;
    const dn = this.normalised;

    // A constant offset cancels inside the difference, so no DC removal is needed.
    for (let lag = 0; lag <= maxLag; lag++) d[lag] = differenceAt(samples, compare, lag);

    dn[0] = 1;
    let running = 0;
    for (let lag = 1; lag <= maxLag; lag++) {
      running += d[lag];
      dn[lag] = running > 0 ? (d[lag] * lag) / running : 1;
    }

    let best = -1;
    for (let lag = minLag; lag < maxLag; lag++) {
      if (dn[lag] < threshold && dn[lag] <= dn[lag + 1]) {
        best = lag;
        break;
      }
    }
    if (best < 0) {
      let lowest = Infinity;
      for (let lag = minLag; lag <= maxLag; lag++) {
        if (dn[lag] < lowest) {
          lowest = dn[lag];
          best = lag;
        }
      }
    }
    if (best <= 0) return silent;

    const confidence = clamp01(1 - dn[best]);
    if (confidence < minConfidence) return { hz: 0, confidence };

    const coarse = best + parabolicOffset(dn, best, maxLag);
    const period = this.refine(samples, compare, coarse);
    if (!(period > 0)) return { hz: 0, confidence };
    return { hz: this.sampleRate / period, confidence };
  }

  /**
   * Re-measure the period at successively higher multiples of itself.
   *
   * The lag of the k-th repeat is k times the period, so dividing it by k
   * divides the interpolation error by k too. The multiple doubles each round
   * rather than jumping straight to the largest one the window allows: the
   * search window around the expected lag is only a couple of samples wide, and
   * a single jump to k = 150 would multiply the coarse estimate's half-sample
   * uncertainty far past it and miss the dip entirely.
   */
  private refine(samples: Float32Array, compare: number, coarsePeriod: number): number {
    const maxLag = samples.length - compare - 1;
    let period = coarsePeriod;
    for (let k = 2; k * period <= maxLag; k *= 2) {
      period = this.refineAtMultiple(samples, compare, period, k, maxLag, coarsePeriod);
    }
    const last = Math.floor(maxLag / period);
    if (last >= 2) {
      period = this.refineAtMultiple(samples, compare, period, last, maxLag, coarsePeriod);
    }
    return period;
  }

  private refineAtMultiple(
    samples: Float32Array,
    compare: number,
    period: number,
    k: number,
    maxLag: number,
    coarsePeriod: number,
  ): number {
    const center = Math.round(k * period);
    const from = Math.max(1, center - 2);
    const to = Math.min(maxLag, center + 2);
    if (to - from < 2) return period;

    let bestLag = from;
    let bestValue = Infinity;
    const values = this.refinement;
    for (let lag = from; lag <= to; lag++) {
      const v = differenceAt(samples, compare, lag);
      values[lag - from] = v;
      if (v < bestValue) {
        bestValue = v;
        bestLag = lag;
      }
    }
    if (bestLag === from || bestLag === to) return period;

    const i = bestLag - from;
    const refined = (bestLag + parabolicOffsetAt(values[i - 1], values[i], values[i + 1])) / k;
    // A refinement that drifts this far has locked onto a neighbouring multiple
    // rather than this one; keep the estimate that is certainly the right period.
    return Math.abs(refined - coarsePeriod) > coarsePeriod * 0.02 ? period : refined;
  }
}

function differenceAt(samples: Float32Array, compare: number, lag: number): number {
  let sum = 0;
  for (let j = 0; j < compare; j++) {
    const delta = samples[j] - samples[j + lag];
    sum += delta * delta;
  }
  return sum;
}

function parabolicOffset(curve: Float32Array, index: number, maxIndex: number): number {
  if (index <= 0 || index >= maxIndex) return 0;
  return parabolicOffsetAt(curve[index - 1], curve[index], curve[index + 1]);
}

/** Vertex of the parabola through three consecutive samples, relative to the middle one. */
function parabolicOffsetAt(before: number, at: number, after: number): number {
  const denom = 2 * (2 * at - before - after);
  if (denom === 0) return 0;
  const offset = (after - before) / denom;
  return offset > 1 || offset < -1 ? 0 : offset;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** One-shot detection. Prefer `PitchDetector` when analysing repeatedly. */
export function detectPitch(
  samples: Float32Array,
  sampleRate: number,
  options: PitchOptions = {},
): PitchReading {
  return new PitchDetector(sampleRate).detect(samples, options);
}

export interface NoteReading {
  /** Nearest MIDI note number, middle C = 60. */
  midi: number;
  /** Note name without the octave, e.g. "A#". */
  name: string;
  /** Scientific pitch notation octave, so A4 = 440 Hz at standard reference. */
  octave: number;
  /** Distance from that note in cents, -50 … +50. */
  cents: number;
  /** Exact frequency of the named note, in Hz. */
  targetHz: number;
}

/**
 * Name a frequency. `referenceHz` is the tuning of A4 — orchestras at 442 Hz and
 * period instruments at 415 Hz both need the readout to move with them.
 */
export function noteFromHz(hz: number, referenceHz = 440): NoteReading {
  if (!(hz > 0)) return { midi: 0, name: NOTE_NAMES[0], octave: -1, cents: 0, targetHz: 0 };
  const exact = 69 + 12 * Math.log2(hz / referenceHz);
  const midi = Math.round(exact);
  return {
    midi,
    name: NOTE_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    cents: (exact - midi) * 100,
    targetHz: referenceHz * Math.pow(2, (midi - 69) / 12),
  };
}

/** Interval between two frequencies in cents; positive means `hz` is sharp. */
export function centsBetween(hz: number, targetHz: number): number {
  if (!(hz > 0) || !(targetHz > 0)) return 0;
  return 1200 * Math.log2(hz / targetHz);
}
