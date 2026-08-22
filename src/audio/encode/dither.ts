/**
 * Requantisation with TPDF dither and optional noise shaping.
 *
 * Converting a floating-point mix to a fixed-point export rounds every sample,
 * and plain rounding leaves an error that is a deterministic function of the
 * signal. On quiet material that error is not heard as noise but as harmonic
 * distortion, because it is correlated with the programme. Adding triangular
 * probability-density noise before the rounder decorrelates the error from the
 * signal: the price is a small constant hiss, the gain is that fades and quiet
 * passages resolve below the last bit instead of turning granular.
 *
 * Noise shaping then trades total error power for placement: an error-feedback
 * loop moves the error energy up the spectrum, away from where the ear is most
 * sensitive. It costs more total noise but less audible noise.
 *
 * The generator is seeded so that two exports of the same mix are byte
 * identical. A dithered export that changed every time could not be verified,
 * diffed, or cached.
 *
 * No DOM, no audio API: this module is arithmetic only and runs in a worker.
 */

export type DitherKind = 'none' | 'tpdf';

export type NoiseShapingKind = 'none' | 'second-order';

export interface DitherOptions {
  /** 'none' rounds directly; 'tpdf' adds +-1 LSB triangular noise first. */
  kind?: DitherKind;
  noiseShaping?: NoiseShapingKind;
  /** Any 32-bit integer. The same seed always yields the same noise. */
  seed?: number;
}

/** Arbitrary but fixed, so an export with default options is reproducible. */
export const DEFAULT_DITHER_SEED = 0x5eed1a3f;

/**
 * Second-order error feedback coefficients giving a noise transfer function of
 * (1 - z^-1)^2: a zero of order two at DC, so the error spectrum rises at
 * 12 dB/octave and is at its quietest where hearing is most acute. Total error
 * power grows by the sum of the squared NTF taps (1 + 4 + 1 = 6).
 */
const SHAPE_A1 = 2;
const SHAPE_A2 = -1;

/**
 * The feedback path is only meaningful while the quantiser is in range. A hard
 * clip injects an error of arbitrary size, and without this bound that single
 * error would ring through the loop for many samples. Four LSB is well above
 * anything the loop produces in normal operation.
 */
const MAX_FEEDBACK_ERROR = 4;

/** Distance between adjacent codes, expressed in the normalised -1..1 domain. */
export function lsbSize(bitDepth: number): number {
  return 1 / Math.pow(2, bitDepth - 1);
}

/**
 * mulberry32: a small, fast, well-distributed 32-bit PRNG. Chosen over
 * Math.random because export reproducibility requires a seed, and over a
 * cryptographic generator because dither needs speed and flatness, not
 * unpredictability.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Converts normalised floats to integer codes of a given bit depth.
 *
 * One instance carries the dither generator and the noise-shaping history, so
 * it is stateful and must not be shared between channels: two channels sharing
 * a generator would receive correlated noise, which images as a phantom centre
 * hiss instead of a diffuse one.
 */
export class Requantizer {
  /** Full-scale code count for one polarity, i.e. 2^(bits-1). */
  private readonly scale: number;
  private readonly minCode: number;
  private readonly maxCode: number;
  private readonly rand: () => number;
  private readonly tpdf: boolean;
  private readonly shaped: boolean;
  private e1 = 0;
  private e2 = 0;

  constructor(
    readonly bitDepth: number,
    opts: DitherOptions = {},
  ) {
    if (!Number.isInteger(bitDepth) || bitDepth < 2 || bitDepth > 32) {
      throw new RangeError(`Unsupported bit depth: ${bitDepth}`);
    }
    this.scale = Math.pow(2, bitDepth - 1);
    this.minCode = -this.scale;
    this.maxCode = this.scale - 1;
    this.tpdf = (opts.kind ?? 'none') === 'tpdf';
    this.shaped = (opts.noiseShaping ?? 'none') === 'second-order';
    this.rand = mulberry32(opts.seed ?? DEFAULT_DITHER_SEED);
  }

  /** Quantise one normalised sample to an integer code. */
  next(x: number): number {
    // A non-finite sample anywhere in the graph must not become a full-scale
    // click in the exported file.
    const clamped = Number.isFinite(x) ? (x > 1 ? 1 : x < -1 ? -1 : x) : 0;
    const target = clamped * this.scale;

    // Error feedback happens before dither is added, so the loop corrects the
    // error the previous samples actually made, dither included.
    const wanted = this.shaped ? target - (SHAPE_A1 * this.e1 + SHAPE_A2 * this.e2) : target;

    // Two independent uniform draws sum to a triangular density spanning
    // +-1 LSB, which is the amount that fully decorrelates the rounder.
    const noise = this.tpdf ? this.rand() + this.rand() - 1 : 0;

    let code = Math.round(wanted + noise);
    if (code > this.maxCode) code = this.maxCode;
    else if (code < this.minCode) code = this.minCode;

    if (this.shaped) {
      let err = code - wanted;
      if (err > MAX_FEEDBACK_ERROR) err = MAX_FEEDBACK_ERROR;
      else if (err < -MAX_FEEDBACK_ERROR) err = -MAX_FEEDBACK_ERROR;
      this.e2 = this.e1;
      this.e1 = err;
    }
    return code;
  }

  /** Clear the shaping history; the dither sequence continues undisturbed. */
  reset(): void {
    this.e1 = 0;
    this.e2 = 0;
  }
}

/**
 * One requantiser per channel, each with its own decorrelated noise stream.
 * The per-channel seed offset is an odd 32-bit constant (the golden-ratio
 * multiplier) so neighbouring channel indices do not start in nearby states.
 */
export function createRequantizers(
  channelCount: number,
  bitDepth: number,
  opts: DitherOptions = {},
): Requantizer[] {
  const base = opts.seed ?? DEFAULT_DITHER_SEED;
  const out: Requantizer[] = [];
  for (let c = 0; c < channelCount; c++) {
    out.push(new Requantizer(bitDepth, { ...opts, seed: (base + Math.imul(c, 0x9e3779b1)) | 0 }));
  }
  return out;
}

/** Quantise a whole channel. Convenience for callers that hold arrays. */
export function quantizeChannel(
  input: Float32Array,
  bitDepth: number,
  opts: DitherOptions = {},
): Int32Array {
  const q = new Requantizer(bitDepth, opts);
  const out = new Int32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = q.next(input[i]);
  return out;
}
