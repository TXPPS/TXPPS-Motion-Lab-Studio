/**
 * Loudness and peak measurement to ITU-R BS.1770-4 / EBU R 128.
 *
 * Pure maths: no DOM, no Web Audio, no store. The live meters, the offline
 * mastering report and the tests all run this same code, so a number shown
 * while playing and the number printed after a bounce cannot disagree.
 *
 * Why not lean on the platform: a browser gives peak and RMS via an
 * `AnalyserNode` and nothing else. LUFS needs a specified filter, specified
 * block lengths and a two-stage gate; true peak needs oversampling. None of
 * that exists in Web Audio, and an `AnalyserNode` reads silence inside an
 * `OfflineAudioContext`, so an export report could never be built from one.
 *
 * Units are in every name. `Dbfs` is a level relative to a full-scale sine,
 * `Dbtp` the same scale measured after oversampling, `Lufs` an absolute
 * loudness and `Lu` a loudness *difference*.
 */

/** Level reported for digital silence. Finite so layout maths never sees -Infinity. */
export const MIN_DBFS = -120;

/**
 * Loudness reported for silence. -70 LUFS is the BS.1770 absolute gate: below
 * it, a block is by definition not part of the programme, so there is nothing
 * useful to report further down.
 */
export const MIN_LUFS = -70;

/** BS.1770-4 §2: the offset that puts the K-weighted mean square on the LUFS scale. */
const LUFS_OFFSET = -0.691;

/** BS.1770-4 §2.4: blocks quieter than this take no part in the integrated measure. */
const ABSOLUTE_GATE_LUFS = MIN_LUFS;

/** BS.1770-4 §2.4: the second, programme-relative gate. */
const RELATIVE_GATE_LU = -10;

/** EBU Tech 3342: loudness range uses a wider relative gate than the integrated value. */
const LRA_RELATIVE_GATE_LU = -20;

/** BS.1770-4 §2.3: 400 ms measurement blocks stepped by 100 ms (75 % overlap). */
const SUB_BLOCK_SECONDS = 0.1;
const MOMENTARY_SUB_BLOCKS = 4;
const SHORT_TERM_SUB_BLOCKS = 30;

export function dbfsFromAmplitude(amplitude: number): number {
  const a = Math.abs(amplitude);
  if (!(a > 0)) return MIN_DBFS;
  const db = 20 * Math.log10(a);
  return db < MIN_DBFS ? MIN_DBFS : db;
}

export function amplitudeFromDbfs(db: number): number {
  return Math.pow(10, db / 20);
}

/** Level of a mean square (a power, not an amplitude) — hence 10·log10. */
export function dbfsFromMeanSquare(meanSquare: number): number {
  if (!(meanSquare > 0)) return MIN_DBFS;
  const db = 10 * Math.log10(meanSquare);
  return db < MIN_DBFS ? MIN_DBFS : db;
}

/** BS.1770-4 §2: loudness of a weighted channel-sum of mean squares. */
export function lufsFromWeightedSum(weightedSum: number): number {
  if (!(weightedSum > 0)) return MIN_LUFS;
  const lufs = LUFS_OFFSET + 10 * Math.log10(weightedSum);
  return lufs < MIN_LUFS ? MIN_LUFS : lufs;
}

export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * K-weighting, stage 1: the "pre-filter", a high shelf standing in for the
 * acoustic effect of a head in a sound field.
 *
 * BS.1770-4 tabulates coefficients for 48 kHz only. These constants are the
 * analogue prototype those numbers came from, so the bilinear transform below
 * reproduces the table exactly at 48 kHz (asserted in tests/loudness.test.ts)
 * and gives the same filter at every other rate a browser might hand us.
 */
const SHELF_HZ = 1681.9744509555319;
const SHELF_Q = 0.7071752369554196;
const SHELF_GAIN_DB = 3.999843853973347;
/** Exponent relating the shelf's mid-band gain to its high-frequency gain. */
const SHELF_BANDWIDTH_EXP = 0.4996667741545416;

/** K-weighting, stage 2: the RLB high-pass that discounts low-frequency energy. */
const HIGHPASS_HZ = 38.13547087602444;
const HIGHPASS_Q = 0.5003270373238773;

export function kWeightingShelf(sampleRate: number): BiquadCoefficients {
  const k = Math.tan((Math.PI * SHELF_HZ) / sampleRate);
  const vh = Math.pow(10, SHELF_GAIN_DB / 20);
  const vb = Math.pow(vh, SHELF_BANDWIDTH_EXP);
  const a0 = 1 + k / SHELF_Q + k * k;
  return {
    b0: (vh + (vb * k) / SHELF_Q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / SHELF_Q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / SHELF_Q + k * k) / a0,
  };
}

export function kWeightingHighpass(sampleRate: number): BiquadCoefficients {
  const k = Math.tan((Math.PI * HIGHPASS_HZ) / sampleRate);
  const a0 = 1 + k / HIGHPASS_Q + k * k;
  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / HIGHPASS_Q + k * k) / a0,
  };
}

/** The two stages in the order BS.1770 applies them. */
export function kWeightingStages(sampleRate: number): [BiquadCoefficients, BiquadCoefficients] {
  return [kWeightingShelf(sampleRate), kWeightingHighpass(sampleRate)];
}

/** Magnitude response of a cascade at one frequency, as a plain gain. */
export function cascadeGain(
  stages: readonly BiquadCoefficients[],
  freqHz: number,
  sampleRate: number,
): number {
  const w = (2 * Math.PI * freqHz) / sampleRate;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  let gain = 1;
  for (const c of stages) {
    const numRe = c.b0 + c.b1 * c1 + c.b2 * c2;
    const numIm = -(c.b1 * s1 + c.b2 * s2);
    const denRe = 1 + c.a1 * c1 + c.a2 * c2;
    const denIm = -(c.a1 * s1 + c.a2 * s2);
    gain *= Math.hypot(numRe, numIm) / Math.hypot(denRe, denIm);
  }
  return gain;
}

/** Gain the K-weighting curve applies at one frequency, in dB. */
export function kWeightingGainDb(freqHz: number, sampleRate: number): number {
  return 20 * Math.log10(cascadeGain(kWeightingStages(sampleRate), freqHz, sampleRate));
}

/**
 * One channel's K-weighting cascade with persistent state, plus the running
 * sum of squares the loudness blocks are built from. Streaming: successive
 * blocks continue where the last one stopped, so block boundaries are inaudible
 * to the measurement.
 */
export class KWeightedAccumulator {
  private readonly shelf: BiquadCoefficients;
  private readonly highpass: BiquadCoefficients;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private u1 = 0;
  private u2 = 0;
  private v1 = 0;
  private v2 = 0;

  constructor(sampleRate: number) {
    this.shelf = kWeightingShelf(sampleRate);
    this.highpass = kWeightingHighpass(sampleRate);
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.u1 = this.u2 = this.v1 = this.v2 = 0;
  }

  /**
   * Filter `count` samples starting at `offset` and return the sum of their
   * squares. Nothing is written anywhere, so no scratch buffer is needed and a
   * meter can run per frame without allocating.
   */
  accumulate(samples: Float32Array, offset: number, count: number): number {
    const s = this.shelf;
    const h = this.highpass;
    let x1 = this.x1;
    let x2 = this.x2;
    let y1 = this.y1;
    let y2 = this.y2;
    let u1 = this.u1;
    let u2 = this.u2;
    let v1 = this.v1;
    let v2 = this.v2;
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const x0 = samples[offset + i];
      const y0 = s.b0 * x0 + s.b1 * x1 + s.b2 * x2 - s.a1 * y1 - s.a2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
      const v0 = h.b0 * y0 + h.b1 * u1 + h.b2 * u2 - h.a1 * v1 - h.a2 * v2;
      u2 = u1;
      u1 = y0;
      v2 = v1;
      v1 = v0;
      sum += v0 * v0;
    }
    this.x1 = x1;
    this.x2 = x2;
    this.y1 = y1;
    this.y2 = y2;
    this.u1 = u1;
    this.u2 = u2;
    this.v1 = v1;
    this.v2 = v2;
    return sum;
  }

  /** K-weighted mean square of a whole block, from a clean filter state. */
  static meanSquare(samples: Float32Array, sampleRate: number): number {
    if (samples.length === 0) return 0;
    return (
      new KWeightedAccumulator(sampleRate).accumulate(samples, 0, samples.length) / samples.length
    );
  }
}

/** Oversampling factor BS.1770-4 Annex 2 requires for material up to 48 kHz. */
export const TRUE_PEAK_OVERSAMPLE = 4;

/** Taps each polyphase branch uses; 16 puts the interpolator's ripple below 0.01 dB. */
const TRUE_PEAK_TAPS = 16;

/**
 * Polyphase interpolation coefficients for `TRUE_PEAK_OVERSAMPLE`× upsampling.
 *
 * Built rather than tabulated: a windowed sinc is the interpolator BS.1770's
 * own table approximates, and deriving it here means it can be regenerated at
 * any factor or length without trusting a copied block of digits. Phase 0
 * lands exactly on the sinc's peak, so it reduces to a pure delay and the
 * original samples are measured untouched — a true-peak reading can therefore
 * never come out below the sample peak.
 */
function polyphaseCoefficients(): Float32Array[] {
  const length = TRUE_PEAK_OVERSAMPLE * TRUE_PEAK_TAPS;
  const center = length / 2;
  const phases: Float32Array[] = [];
  for (let p = 0; p < TRUE_PEAK_OVERSAMPLE; p++) phases.push(new Float32Array(TRUE_PEAK_TAPS));
  for (let n = 0; n < length; n++) {
    const x = (n - center) / TRUE_PEAK_OVERSAMPLE;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const t = (n - center) / (length / 2);
    const w =
      0.35875 +
      0.48829 * Math.cos(Math.PI * t) +
      0.14128 * Math.cos(2 * Math.PI * t) +
      0.01168 * Math.cos(3 * Math.PI * t);
    phases[n % TRUE_PEAK_OVERSAMPLE][Math.floor(n / TRUE_PEAK_OVERSAMPLE)] = sinc * w;
  }
  // Each branch must pass DC at unity or a steady level would read wrong.
  for (const phase of phases) {
    let sum = 0;
    for (let i = 0; i < phase.length; i++) sum += phase[i];
    if (sum !== 0) for (let i = 0; i < phase.length; i++) phase[i] /= sum;
  }
  return phases;
}

const TRUE_PEAK_PHASES = polyphaseCoefficients();

/**
 * Streaming true-peak detector for one channel. Holds the last `TRUE_PEAK_TAPS`
 * input samples, so a peak straddling a block boundary is still found.
 */
export class TruePeakDetector {
  private readonly history = new Float32Array(TRUE_PEAK_TAPS);
  private cursor = 0;
  private max = 0;

  reset(): void {
    this.history.fill(0);
    this.cursor = 0;
    this.max = 0;
  }

  /** Highest interpolated absolute sample seen so far, as a linear amplitude. */
  get peak(): number {
    return this.max;
  }

  process(samples: Float32Array, offset = 0, count = samples.length - offset): number {
    const taps = TRUE_PEAK_TAPS;
    const history = this.history;
    let cursor = this.cursor;
    let max = this.max;
    for (let i = 0; i < count; i++) {
      history[cursor] = samples[offset + i];
      cursor = (cursor + 1) % taps;
      for (let p = 0; p < TRUE_PEAK_OVERSAMPLE; p++) {
        const phase = TRUE_PEAK_PHASES[p];
        let acc = 0;
        // `cursor` now points at the oldest sample, which pairs with tap 0.
        for (let t = 0; t < taps; t++) acc += phase[t] * history[(cursor + t) % taps];
        const a = acc < 0 ? -acc : acc;
        if (a > max) max = a;
      }
    }
    this.cursor = cursor;
    this.max = max;
    return max;
  }
}

/**
 * True peak of one block as a linear amplitude.
 *
 * The block is measured as an isolated signal — silence before it, silence
 * after it — which is what a rendered file actually is. A block that starts or
 * ends part-way up a waveform therefore reports the overshoot a converter
 * really would produce at that step; material that fades in and out, which is
 * to say all finished material, sees none of it.
 */
export function truePeak(samples: Float32Array): number {
  const detector = new TruePeakDetector();
  detector.process(samples);
  // Flush the delay line so a peak in the final samples is still interpolated.
  detector.process(new Float32Array(TRUE_PEAK_TAPS));
  return detector.peak;
}

/** True peak of one block in dBTP — the scale a limiter's ceiling is set on. */
export function truePeakDbtp(samples: Float32Array): number {
  return dbfsFromAmplitude(truePeak(samples));
}

export function samplePeak(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i] < 0 ? -samples[i] : samples[i];
    if (a > peak) peak = a;
  }
  return peak;
}

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Mean sample value: anything but zero is a DC offset eating headroom. */
export function dcOffset(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i];
  return sum / samples.length;
}

/**
 * Phase correlation of a stereo block, +1 (identical) to -1 (one channel is the
 * other inverted). 0 means the two channels are unrelated, which is where a
 * wide synth pad sits and where a mono fold-down starts losing material.
 *
 * Silence has no correlation to report, so it reads 0 rather than the +1 that
 * "two identical channels" would otherwise imply.
 */
export function phaseCorrelation(left: Float32Array, right: Float32Array): number {
  const n = Math.min(left.length, right.length);
  let ll = 0;
  let rr = 0;
  let lr = 0;
  for (let i = 0; i < n; i++) {
    ll += left[i] * left[i];
    rr += right[i] * right[i];
    lr += left[i] * right[i];
  }
  return correlationFromSums(ll, rr, lr);
}

function correlationFromSums(ll: number, rr: number, lr: number): number {
  const denom = Math.sqrt(ll * rr);
  if (!(denom > 0)) return 0;
  const c = lr / denom;
  return c < -1 ? -1 : c > 1 ? 1 : c;
}

/**
 * Stereo width from the mid/side energy split: 0 is mono, 1 is equal mid and
 * side energy, 2 is pure side (a signal that vanishes when summed to mono).
 */
export function stereoWidth(left: Float32Array, right: Float32Array): number {
  const n = Math.min(left.length, right.length);
  let ll = 0;
  let rr = 0;
  let lr = 0;
  for (let i = 0; i < n; i++) {
    ll += left[i] * left[i];
    rr += right[i] * right[i];
    lr += left[i] * right[i];
  }
  return widthFromSums(ll, rr, lr);
}

function widthFromSums(ll: number, rr: number, lr: number): number {
  // M = (L+R)/2 and S = (L-R)/2, so their energies follow from the same sums.
  const mid = Math.sqrt(Math.max(ll + 2 * lr + rr, 0) / 4);
  const side = Math.sqrt(Math.max(ll - 2 * lr + rr, 0) / 4);
  const total = mid + side;
  if (!(total > 0)) return 0;
  return (2 * side) / total;
}

/**
 * Distribution of block loudness values, kept as a histogram rather than a list.
 *
 * Gating and percentiles both need the whole history, and a meter asks for them
 * every animation frame. A histogram answers in constant time however long the
 * song runs; the energy sums are kept per bin so the gated loudness itself is
 * still computed from the real mean square, not from quantised levels.
 */
const HISTOGRAM_STEP_LU = 0.05;
const HISTOGRAM_MIN_LUFS = MIN_LUFS;
const HISTOGRAM_MAX_LUFS = 30;
const HISTOGRAM_BINS = Math.round((HISTOGRAM_MAX_LUFS - HISTOGRAM_MIN_LUFS) / HISTOGRAM_STEP_LU);

class LoudnessHistogram {
  private readonly counts = new Float64Array(HISTOGRAM_BINS);
  private readonly power = new Float64Array(HISTOGRAM_BINS);
  private total = 0;

  reset(): void {
    this.counts.fill(0);
    this.power.fill(0);
    this.total = 0;
  }

  get blockCount(): number {
    return this.total;
  }

  /** Blocks at or below the absolute gate are dropped here, never stored. */
  add(loudnessLufs: number, weightedSum: number): void {
    if (!(loudnessLufs > ABSOLUTE_GATE_LUFS)) return;
    const raw = Math.floor((loudnessLufs - HISTOGRAM_MIN_LUFS) / HISTOGRAM_STEP_LU);
    const bin = raw < 0 ? 0 : raw >= HISTOGRAM_BINS ? HISTOGRAM_BINS - 1 : raw;
    this.counts[bin] += 1;
    this.power[bin] += weightedSum;
    this.total += 1;
  }

  private binLoudness(bin: number): number {
    return HISTOGRAM_MIN_LUFS + (bin + 0.5) * HISTOGRAM_STEP_LU;
  }

  /** Mean loudness of every stored block — the input to the relative gate. */
  private ungatedLoudness(): number {
    if (this.total === 0) return MIN_LUFS;
    let sum = 0;
    for (let i = 0; i < HISTOGRAM_BINS; i++) sum += this.power[i];
    return lufsFromWeightedSum(sum / this.total);
  }

  /** BS.1770-4 §2.4 relative gate applied at `gateLu` below the ungated mean. */
  gatedLoudness(gateLu: number): number {
    if (this.total === 0) return MIN_LUFS;
    const threshold = this.ungatedLoudness() + gateLu;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < HISTOGRAM_BINS; i++) {
      if (this.counts[i] === 0 || this.binLoudness(i) <= threshold) continue;
      sum += this.power[i];
      count += this.counts[i];
    }
    if (count === 0) return MIN_LUFS;
    return lufsFromWeightedSum(sum / count);
  }

  /** Percentile (0..1) of the distribution left after the relative gate. */
  gatedPercentile(fraction: number, gateLu: number): number {
    if (this.total === 0) return MIN_LUFS;
    const threshold = this.ungatedLoudness() + gateLu;
    let kept = 0;
    for (let i = 0; i < HISTOGRAM_BINS; i++) {
      if (this.binLoudness(i) > threshold) kept += this.counts[i];
    }
    if (kept === 0) return MIN_LUFS;
    const target = fraction * kept;
    let seen = 0;
    for (let i = 0; i < HISTOGRAM_BINS; i++) {
      if (this.counts[i] === 0 || this.binLoudness(i) <= threshold) continue;
      seen += this.counts[i];
      if (seen >= target) return this.binLoudness(i);
    }
    return MIN_LUFS;
  }
}

export interface LoudnessReading {
  /** 400 ms window (BS.1770 "M"). */
  momentaryLufs: number;
  /** 3 s window (BS.1770 "S"). */
  shortTermLufs: number;
  /** Gated programme loudness over everything pushed so far (BS.1770 "I"). */
  integratedLufs: number;
  /** Highest momentary and short-term values seen, for a peak-hold readout. */
  momentaryMaxLufs: number;
  shortTermMaxLufs: number;
  /** EBU Tech 3342 loudness range, in LU (a difference, so never negative). */
  loudnessRangeLu: number;
  /** Highest interpolated peak since the last reset. */
  truePeakDbtp: number;
  /** Highest raw sample since the last reset. */
  samplePeakDbfs: number;
  /** Unweighted RMS over the meter's recent window. */
  rmsDbfs: number;
  /**
   * -1 … +1. 0 for silence, and 0 when the meter is fed a mono source whose
   * right channel is genuinely empty — which is what `MeasurementTap`'s
   * explicit two-channel stage exists to prevent.
   */
  correlation: number;
  /** 0 (mono) … 1 (equal mid/side) … 2 (side only). */
  stereoWidth: number;
}

export interface LoudnessMeterOptions {
  channelCount?: number;
  /**
   * Window the correlation, width and RMS readings look back over, in seconds.
   * Loudness has its own standardised windows and ignores this.
   */
  windowSeconds?: number;
}

/**
 * Streaming loudness meter. Feed it successive blocks of any length; every
 * reading it offers costs O(block) to maintain and O(1) to read.
 *
 * Channel weights follow BS.1770-4 Table 4: unity for left, right and centre,
 * +1.5 dB for surround channels. LFE is excluded by the standard; a channel
 * layout that includes one should not be handed to this meter.
 */
export class LoudnessMeter {
  readonly sampleRate: number;
  readonly channelCount: number;

  private readonly subBlockSize: number;
  private readonly filters: KWeightedAccumulator[] = [];
  private readonly truePeaks: TruePeakDetector[] = [];
  private readonly weights: number[] = [];
  /** Per channel, the last `SHORT_TERM_SUB_BLOCKS` 100 ms mean squares. */
  private readonly history: Float64Array[] = [];
  private readonly pending: Float64Array;
  private pendingSamples = 0;
  private writeIndex = 0;
  private subBlockCount = 0;

  private readonly integratedHistogram = new LoudnessHistogram();
  private readonly rangeHistogram = new LoudnessHistogram();

  private momentary = MIN_LUFS;
  private shortTerm = MIN_LUFS;
  private momentaryMax = MIN_LUFS;
  private shortTermMax = MIN_LUFS;
  private samplePeakLinear = 0;

  private readonly windowSamples: number;
  private sumLL = 0;
  private sumRR = 0;
  private sumLR = 0;
  private sumWeight = 0;

  constructor(sampleRate: number, options: LoudnessMeterOptions = {}) {
    this.sampleRate = sampleRate;
    this.channelCount = Math.max(1, options.channelCount ?? 2);
    this.subBlockSize = Math.max(1, Math.round(sampleRate * SUB_BLOCK_SECONDS));
    this.windowSamples = Math.max(1, Math.round(sampleRate * (options.windowSeconds ?? 0.4)));
    for (let c = 0; c < this.channelCount; c++) {
      this.filters.push(new KWeightedAccumulator(sampleRate));
      this.truePeaks.push(new TruePeakDetector());
      this.history.push(new Float64Array(SHORT_TERM_SUB_BLOCKS));
      this.weights.push(c < 3 ? 1 : 1.41);
    }
    this.pending = new Float64Array(this.channelCount);
  }

  reset(): void {
    for (const f of this.filters) f.reset();
    for (const t of this.truePeaks) t.reset();
    for (const h of this.history) h.fill(0);
    this.pending.fill(0);
    this.pendingSamples = 0;
    this.writeIndex = 0;
    this.subBlockCount = 0;
    this.integratedHistogram.reset();
    this.rangeHistogram.reset();
    this.momentary = MIN_LUFS;
    this.shortTerm = MIN_LUFS;
    this.momentaryMax = MIN_LUFS;
    this.shortTermMax = MIN_LUFS;
    this.samplePeakLinear = 0;
    this.sumLL = 0;
    this.sumRR = 0;
    this.sumLR = 0;
    this.sumWeight = 0;
  }

  /**
   * Push one block. `length` and `start` let a caller hand over a fixed scratch
   * buffer with only part of it filled — how the live tap feeds the meter only
   * the samples that are new since the last animation frame without allocating
   * a subarray to do it.
   */
  push(channels: readonly Float32Array[], length = channels[0]?.length ?? 0, start = 0): void {
    if (length <= 0 || start < 0) return;
    const used = Math.min(this.channelCount, channels.length);

    for (let c = 0; c < used; c++) {
      const data = channels[c];
      this.truePeaks[c].process(data, start, length);
      for (let i = 0; i < length; i++) {
        const v = data[start + i];
        const a = v < 0 ? -v : v;
        if (a > this.samplePeakLinear) this.samplePeakLinear = a;
      }
    }

    this.accumulateStereo(channels, used, length, start);

    let offset = 0;
    while (offset < length) {
      const take = Math.min(this.subBlockSize - this.pendingSamples, length - offset);
      for (let c = 0; c < used; c++) {
        this.pending[c] += this.filters[c].accumulate(channels[c], start + offset, take);
      }
      this.pendingSamples += take;
      offset += take;
      if (this.pendingSamples >= this.subBlockSize) this.closeSubBlock();
    }
  }

  /**
   * Correlation, width and RMS follow the signal rather than the whole song, so
   * their sums decay exponentially over `windowSeconds` instead of being reset
   * on a block boundary — a needle that jumps every buffer is unreadable.
   */
  private accumulateStereo(
    channels: readonly Float32Array[],
    used: number,
    length: number,
    start: number,
  ): void {
    const left = channels[0];
    const right = used > 1 ? channels[1] : left;
    let ll = 0;
    let rr = 0;
    let lr = 0;
    for (let i = 0; i < length; i++) {
      const l = left[start + i];
      const r = right[start + i];
      ll += l * l;
      rr += r * r;
      lr += l * r;
    }
    const decay = Math.exp(-length / this.windowSamples);
    this.sumLL = this.sumLL * decay + ll;
    this.sumRR = this.sumRR * decay + rr;
    this.sumLR = this.sumLR * decay + lr;
    this.sumWeight = this.sumWeight * decay + length;
  }

  private closeSubBlock(): void {
    const size = this.subBlockSize;
    for (let c = 0; c < this.channelCount; c++) {
      this.history[c][this.writeIndex] = this.pending[c] / size;
      this.pending[c] = 0;
    }
    this.pendingSamples = 0;
    this.writeIndex = (this.writeIndex + 1) % SHORT_TERM_SUB_BLOCKS;
    this.subBlockCount += 1;

    // Momentary is reported from whatever exists so the meter moves at once,
    // but only a full 400 ms block is admissible as a gating block.
    const momentarySpan = Math.min(this.subBlockCount, MOMENTARY_SUB_BLOCKS);
    const momentarySum = this.weightedSum(momentarySpan);
    this.momentary = lufsFromWeightedSum(momentarySum);
    if (this.momentary > this.momentaryMax) this.momentaryMax = this.momentary;
    if (this.subBlockCount >= MOMENTARY_SUB_BLOCKS) {
      this.integratedHistogram.add(this.momentary, momentarySum);
    }

    if (this.subBlockCount >= SHORT_TERM_SUB_BLOCKS) {
      const shortSum = this.weightedSum(SHORT_TERM_SUB_BLOCKS);
      this.shortTerm = lufsFromWeightedSum(shortSum);
      if (this.shortTerm > this.shortTermMax) this.shortTermMax = this.shortTerm;
      this.rangeHistogram.add(this.shortTerm, shortSum);
    } else {
      this.shortTerm = lufsFromWeightedSum(this.weightedSum(this.subBlockCount));
    }
  }

  /** Weighted channel sum of the mean square over the last `span` sub-blocks. */
  private weightedSum(span: number): number {
    if (span <= 0) return 0;
    let total = 0;
    for (let c = 0; c < this.channelCount; c++) {
      const ring = this.history[c];
      let sum = 0;
      for (let i = 1; i <= span; i++) {
        sum += ring[(this.writeIndex - i + SHORT_TERM_SUB_BLOCKS) % SHORT_TERM_SUB_BLOCKS];
      }
      total += this.weights[c] * (sum / span);
    }
    return total;
  }

  get integratedLufs(): number {
    return this.integratedHistogram.gatedLoudness(RELATIVE_GATE_LU);
  }

  /**
   * EBU Tech 3342: the spread between the 10th and 95th percentiles of the
   * short-term distribution, after gating. Needs at least one full 3 s window,
   * so it reads 0 LU on anything shorter.
   */
  get loudnessRangeLu(): number {
    if (this.rangeHistogram.blockCount === 0) return 0;
    const low = this.rangeHistogram.gatedPercentile(0.1, LRA_RELATIVE_GATE_LU);
    const high = this.rangeHistogram.gatedPercentile(0.95, LRA_RELATIVE_GATE_LU);
    return Math.max(0, high - low);
  }

  get truePeakDbtp(): number {
    let peak = 0;
    for (const t of this.truePeaks) if (t.peak > peak) peak = t.peak;
    return dbfsFromAmplitude(peak);
  }

  /** True peak of one channel in dBTP, for a per-channel report. */
  channelTruePeakDbtp(channel: number): number {
    const detector = this.truePeaks[channel];
    return detector ? dbfsFromAmplitude(detector.peak) : MIN_DBFS;
  }

  get samplePeakDbfs(): number {
    return dbfsFromAmplitude(this.samplePeakLinear);
  }

  get correlation(): number {
    return correlationFromSums(this.sumLL, this.sumRR, this.sumLR);
  }

  get stereoWidth(): number {
    return widthFromSums(this.sumLL, this.sumRR, this.sumLR);
  }

  get rmsDbfs(): number {
    if (!(this.sumWeight > 0)) return MIN_DBFS;
    const channels = this.channelCount > 1 ? 2 : 1;
    return dbfsFromMeanSquare((this.sumLL + this.sumRR) / (channels * this.sumWeight));
  }

  /**
   * Flush the true-peak delay lines with silence so a peak in the very last
   * samples is interpolated as well. Call it once the material has ended — a
   * live meter never should, because for it the material has not ended.
   */
  finish(): void {
    const tail = new Float32Array(TRUE_PEAK_TAPS);
    for (const detector of this.truePeaks) detector.process(tail);
  }

  /** Fill `into` rather than allocate, so a 60 Hz meter stays garbage-free. */
  read(into?: LoudnessReading): LoudnessReading {
    const out =
      into ??
      ({
        momentaryLufs: 0,
        shortTermLufs: 0,
        integratedLufs: 0,
        momentaryMaxLufs: 0,
        shortTermMaxLufs: 0,
        loudnessRangeLu: 0,
        truePeakDbtp: 0,
        samplePeakDbfs: 0,
        rmsDbfs: 0,
        correlation: 0,
        stereoWidth: 0,
      } satisfies LoudnessReading);
    out.momentaryLufs = this.momentary;
    out.shortTermLufs = this.shortTerm;
    out.integratedLufs = this.integratedLufs;
    out.momentaryMaxLufs = this.momentaryMax;
    out.shortTermMaxLufs = this.shortTermMax;
    out.loudnessRangeLu = this.loudnessRangeLu;
    out.truePeakDbtp = this.truePeakDbtp;
    out.samplePeakDbfs = this.samplePeakDbfs;
    out.rmsDbfs = this.rmsDbfs;
    out.correlation = this.correlation;
    out.stereoWidth = this.stereoWidth;
    return out;
  }
}

export interface ChannelMeasurement {
  samplePeakDbfs: number;
  truePeakDbtp: number;
  rmsDbfs: number;
  /** Mean sample value, -1 … +1. Anything past ±0.001 is worth telling the user. */
  dcOffset: number;
}

export interface LoudnessMeasurement {
  sampleRate: number;
  channelCount: number;
  durationSeconds: number;
  integratedLufs: number;
  loudnessRangeLu: number;
  momentaryMaxLufs: number;
  shortTermMaxLufs: number;
  truePeakDbtp: number;
  samplePeakDbfs: number;
  rmsDbfs: number;
  dcOffset: number;
  /**
   * -1 … +1, and +1 for a single-channel measurement: a mono signal is
   * perfectly correlated with itself, and reporting 0 there would tell a
   * mastering page a mono master was decorrelated. `stereoWidth` is the figure
   * that reads 0 for mono.
   */
  correlation: number;
  stereoWidth: number;
  channels: ChannelMeasurement[];
}

/**
 * Measure whole channels in one pass — the numbers a mastering page and an
 * export report print. Runs the streaming meter over the material in chunks so
 * peak memory does not grow with the length of the song.
 */
export function measureChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
  chunkSize = 8192,
): LoudnessMeasurement {
  const channelCount = Math.max(1, channels.length);
  const frames = channels[0]?.length ?? 0;
  const meter = new LoudnessMeter(sampleRate, { channelCount });
  const views: Float32Array[] = new Array(channelCount);
  for (let offset = 0; offset < frames; offset += chunkSize) {
    const take = Math.min(chunkSize, frames - offset);
    for (let c = 0; c < channelCount; c++) views[c] = channels[c].subarray(offset, offset + take);
    meter.push(views, take);
  }
  meter.finish();
  const summary = meter.read();

  // The meter has already interpolated every channel, so the per-channel true
  // peaks are read back from it rather than measured a second time.
  let meanSquareSum = 0;
  let dcSum = 0;
  const perChannel: ChannelMeasurement[] = channels.map((data, index) => {
    const channelRms = rms(data);
    meanSquareSum += channelRms * channelRms;
    const offset = dcOffset(data);
    dcSum += offset;
    return {
      samplePeakDbfs: dbfsFromAmplitude(samplePeak(data)),
      truePeakDbtp: meter.channelTruePeakDbtp(index),
      rmsDbfs: dbfsFromAmplitude(channelRms),
      dcOffset: offset,
    };
  });

  const left = channels[0] ?? new Float32Array(0);
  const right = channels[1] ?? left;

  return {
    sampleRate,
    channelCount,
    durationSeconds: frames / sampleRate,
    integratedLufs: summary.integratedLufs,
    loudnessRangeLu: summary.loudnessRangeLu,
    momentaryMaxLufs: summary.momentaryMaxLufs,
    shortTermMaxLufs: summary.shortTermMaxLufs,
    truePeakDbtp: summary.truePeakDbtp,
    samplePeakDbfs: summary.samplePeakDbfs,
    rmsDbfs: dbfsFromMeanSquare(meanSquareSum / channelCount),
    dcOffset: dcSum / channelCount,
    correlation: channels.length > 1 ? phaseCorrelation(left, right) : 1,
    stereoWidth: channels.length > 1 ? stereoWidth(left, right) : 0,
    channels: perChannel,
  };
}
