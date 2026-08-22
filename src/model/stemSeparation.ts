/**
 * Stem separation: split a mix into vocals / drums / bass / other.
 *
 * Pure maths — samples in, samples out. No DOM, no Web Audio, no React, so the
 * whole pass can be handed to a worker.
 *
 * ## What this is, stated plainly
 *
 * The reference product does this with a trained neural network. There is no
 * network here, and pretending otherwise would be dishonest, so this is the
 * strongest classical approach instead: masking in the short-time Fourier
 * domain, built from three cues that need no training data.
 *
 * 1. **Harmonic / percussive separation.** A sustained note is a horizontal line
 *    in the spectrogram — steady in frequency, long in time. A drum hit is a
 *    vertical line — broad in frequency, short in time. Taking a median along
 *    time suppresses the vertical lines and leaves the harmonic estimate; taking
 *    a median along frequency does the opposite. The two estimates become soft
 *    Wiener-style masks that always sum to one. (Fitzgerald 2010; Driedger and
 *    Müller's later refinement is the same idea.)
 * 2. **A bass crossover in the mask domain.** The harmonic mask is split by
 *    frequency with a smooth crossover, so sustained low-frequency energy is the
 *    bass stem. It is a crossover, not a bass detector.
 * 3. **Centre extraction.** A lead vocal is almost always panned centre. Per bin,
 *    the inter-channel coherence 2·Re(L·conj(R)) / (|L|² + |R|²) is 1 for a
 *    perfectly centred source and 0 for a hard-panned or uncorrelated one, so it
 *    pulls the centred part of the harmonic residue into the vocal stem.
 *
 * ## What it therefore cannot do
 *
 * - It does not know what a voice is. Anything centred, harmonic and inside the
 *   vocal band goes to the vocal stem: a centred piano, a centred lead synth, a
 *   doubled guitar. A network trained on voices knows the difference; coherence
 *   does not.
 * - A mono mix has no panning information at all, so the vocal / other split
 *   collapses to a band-limited filter. The function still returns four stems
 *   because the caller asked for four, but on mono input the vocal stem is worth
 *   very little and this is not hidden from you.
 * - A hard-panned or heavily-widened vocal lands in "other".
 * - A tonal drum — a ringing tom, a melodic percussion line — reads as harmonic
 *   and leaks into bass or other. A sustained noise-like sound (a cymbal swell,
 *   a distorted pad) reads as percussive and leaks into drums.
 * - Masking cannot invent what a mask removes. Where two sources share a bin,
 *   each stem keeps its share of *one* value, so a soloed stem carries the
 *   characteristic hollow, watery artefacts of spectral masking. There is no
 *   setting that removes them.
 *
 * ## The one guarantee
 *
 * The four stems sum back to the input. The masks are constructed to sum to one
 * at every bin of every frame, and the inverse transform is linear, so the sum
 * differs from the input only by the arithmetic error of the transform itself —
 * measured below `RECONSTRUCTION_TOLERANCE_DB` relative to the input's peak, and
 * asserted in the tests. That is what makes the result safe to reassemble, to
 * bounce, and to use for "remove the vocal by muting one stem".
 *
 * Memory: the magnitude spectrogram of every channel is held at once, which is
 * about `duration × sampleRate / hop × (fftSize / 2 + 1)` floats per channel.
 * At the defaults that is roughly 8 MB per channel per minute of audio.
 */
import { fftInPlace, ifftInPlace, magnitudeInto, makeWindow, nextPowerOfTwo } from './fft';

export const STEM_NAMES = ['vocals', 'drums', 'bass', 'other'] as const;
export type StemName = (typeof STEM_NAMES)[number];

/** One stem per name, each holding one Float32Array per input channel. */
export type Stems = Record<StemName, Float32Array[]>;

export interface StemOptions {
  /** Transform length, rounded up to a power of two. */
  fftSize?: number;
  /**
   * Length of the median along time that estimates the harmonic part. Long
   * enough to outlast a drum hit, short enough not to smear a melody.
   */
  harmonicSpanSec?: number;
  /** Width of the median along frequency that estimates the percussive part. */
  percussiveSpanHz?: number;
  /**
   * Exponent of the soft mask. 1 is a plain ratio; 2 is the Wiener mask and is
   * the default; higher approaches a hard binary decision, which separates more
   * and sounds worse.
   */
  maskExponent?: number;
  /** Centre of the bass crossover. */
  bassCrossoverHz?: number;
  /** Width of that crossover, in octaves. */
  bassCrossoverOctaves?: number;
  /** Band the centre extractor is allowed to take the vocal from. */
  vocalLowHz?: number;
  vocalHighHz?: number;
  /**
   * How sharply off-centre material is rejected. 1 keeps anything even slightly
   * centred; higher demands a source be closer to dead centre.
   */
  centreExponent?: number;
}

/**
 * Peak error of `vocals + drums + bass + other − input`, in dB relative to the
 * input's peak. This is the arithmetic error of a float32 forward and inverse
 * transform, not a separation quality figure.
 */
export const RECONSTRUCTION_TOLERANCE_DB = -80;

const DEFAULT_FFT_SIZE = 2048;
/** Four-fold overlap: the smallest that reconstructs a Hann window smoothly. */
const OVERLAP = 4;
const DEFAULT_HARMONIC_SPAN_SEC = 0.2;
const DEFAULT_PERCUSSIVE_SPAN_HZ = 500;
const DEFAULT_MASK_EXPONENT = 2;
const DEFAULT_BASS_CROSSOVER_HZ = 120;
const DEFAULT_BASS_CROSSOVER_OCTAVES = 1;
const DEFAULT_VOCAL_LOW_HZ = 150;
const DEFAULT_VOCAL_HIGH_HZ = 8000;
const DEFAULT_CENTRE_EXPONENT = 2;
/** Width of the band-edge roll-offs, in octaves. Abrupt edges ring. */
const EDGE_OCTAVES = 0.5;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Raised-cosine roll-off from 1 to 0 across `octaves`, centred on `cornerHz`.
 * Log-spaced because a crossover a musician would draw is an interval wide, not
 * a number of hertz wide.
 */
function fallingEdge(hz: number, cornerHz: number, octaves: number): number {
  if (!(hz > 0)) return 1;
  const t = clamp(Math.log2(hz / cornerHz) / octaves + 0.5, 0, 1);
  return 0.5 + 0.5 * Math.cos(Math.PI * t);
}

function risingEdge(hz: number, cornerHz: number, octaves: number): number {
  return 1 - fallingEdge(hz, cornerHz, octaves);
}

/**
 * Median of a fixed-size window that slides one step at a time.
 *
 * A fresh sort at every bin is the obvious way to write the percussive median
 * and it makes the whole separation several times slower than it needs to be:
 * the window changes by one value per step, so keeping it sorted and splicing
 * that one value in and out is linear in the window instead of n log n.
 */
class SlidingMedian {
  private readonly sorted: Float64Array;
  private readonly size: number;

  constructor(size: number) {
    this.size = size;
    this.sorted = new Float64Array(size);
  }

  /** Fill from `values` at the given clamped indices and sort once. */
  reset(read: (i: number) => number, from: number): void {
    for (let i = 0; i < this.size; i++) this.sorted[i] = read(from + i);
    this.sorted.sort();
  }

  value(): number {
    const mid = this.size >> 1;
    return this.size % 2 === 1 ? this.sorted[mid] : (this.sorted[mid - 1] + this.sorted[mid]) / 2;
  }

  /** Drop `outgoing` and take in `incoming`, keeping the window sorted. */
  slide(outgoing: number, incoming: number): void {
    const n = this.size;
    const sorted = this.sorted;
    let at = lowerBound(sorted, n, outgoing);
    // lowerBound lands on the first value not less than the one being removed;
    // with duplicates any of them will do, and equality is exact here because
    // the value being removed is the same float that was inserted.
    if (at >= n || sorted[at] !== outgoing) at = Math.min(at, n - 1);
    if (incoming >= outgoing) {
      let i = at;
      while (i + 1 < n && sorted[i + 1] < incoming) {
        sorted[i] = sorted[i + 1];
        i++;
      }
      sorted[i] = incoming;
    } else {
      let i = at;
      while (i - 1 >= 0 && sorted[i - 1] > incoming) {
        sorted[i] = sorted[i - 1];
        i--;
      }
      sorted[i] = incoming;
    }
  }
}

function lowerBound(sorted: Float64Array, count: number, value: number): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Median of a small gathered window. Insertion sort beats anything else here. */
function medianOf(buffer: Float64Array, count: number): number {
  for (let i = 1; i < count; i++) {
    const v = buffer[i];
    let j = i - 1;
    while (j >= 0 && buffer[j] > v) {
      buffer[j + 1] = buffer[j];
      j--;
    }
    buffer[j + 1] = v;
  }
  const mid = count >> 1;
  return count % 2 === 1 ? buffer[mid] : (buffer[mid - 1] + buffer[mid]) / 2;
}

function emptyStems(channels: number): Stems {
  const make = (): Float32Array[] => Array.from({ length: channels }, () => new Float32Array(0));
  return { vocals: make(), drums: make(), bass: make(), other: make() };
}

/**
 * Separate `channels` into four stems, each with the same channel count and
 * length as the input.
 *
 * Mono input is accepted and produces four stems, but see the header: without
 * two channels there is no centre cue and the vocal stem is a band-limited slice
 * of the harmonic part rather than a voice.
 */
export function separateStems(
  channels: readonly Float32Array[],
  sampleRate: number,
  options: StemOptions = {},
): Stems {
  const channelCount = channels.length;
  if (channelCount === 0 || !(sampleRate > 0)) return emptyStems(channelCount);
  let length = 0;
  for (const c of channels) length = Math.max(length, c.length);
  if (length === 0) return emptyStems(channelCount);

  const fftSize = nextPowerOfTwo(
    clamp(Math.round(options.fftSize ?? DEFAULT_FFT_SIZE), 256, 16384),
  );
  const hop = fftSize / OVERLAP;
  const bins = fftSize / 2 + 1;
  const binHz = sampleRate / fftSize;
  // A whole window of silence at each end so every real sample is covered by the
  // full overlap and the reconstruction is exact right to the first sample.
  const pad = fftSize;
  const frameCount = Math.ceil((length + pad) / hop) + 1;
  const paddedLength = (frameCount - 1) * hop + fftSize;

  const window = makeWindow('hann', fftSize);
  const padded: Float32Array[] = channels.map((c) => {
    const buffer = new Float32Array(paddedLength);
    buffer.set(c.subarray(0, Math.min(c.length, length)), pad);
    return buffer;
  });

  // Pass one: magnitudes only. The medians need to see along the time axis, so
  // the whole spectrogram has to exist before any mask can be built.
  const spectrogram: Float32Array[] = [];
  {
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    const mag = new Float32Array(bins);
    for (let c = 0; c < channelCount; c++) {
      const store = new Float32Array(frameCount * bins);
      for (let f = 0; f < frameCount; f++) {
        const start = f * hop;
        for (let i = 0; i < fftSize; i++) re[i] = padded[c][start + i] * window[i];
        im.fill(0);
        fftInPlace(re, im);
        magnitudeInto(re, im, mag);
        store.set(mag, f * bins);
      }
      spectrogram.push(store);
    }
  }

  const harmonicSpanSec = Math.max(0.02, options.harmonicSpanSec ?? DEFAULT_HARMONIC_SPAN_SEC);
  const percussiveSpanHz = Math.max(binHz, options.percussiveSpanHz ?? DEFAULT_PERCUSSIVE_SPAN_HZ);
  const exponent = Math.max(0.5, options.maskExponent ?? DEFAULT_MASK_EXPONENT);
  const centreExponent = Math.max(0, options.centreExponent ?? DEFAULT_CENTRE_EXPONENT);
  // Both spans are forced odd so the median is a value from the window, never
  // an average of two, which would blur an edge the split depends on.
  const timeSpan = oddSpan(harmonicSpanSec / (hop / sampleRate));
  const freqSpan = Math.min(oddSpan(percussiveSpanHz / binHz), bins % 2 === 1 ? bins : bins - 1);
  const halfTime = (timeSpan - 1) / 2;
  const halfFreq = (freqSpan - 1) / 2;

  const bassWeight = new Float32Array(bins);
  const vocalWeight = new Float32Array(bins);
  {
    const crossoverHz = Math.max(20, options.bassCrossoverHz ?? DEFAULT_BASS_CROSSOVER_HZ);
    const crossoverOctaves = Math.max(
      0.1,
      options.bassCrossoverOctaves ?? DEFAULT_BASS_CROSSOVER_OCTAVES,
    );
    const lowHz = Math.max(20, options.vocalLowHz ?? DEFAULT_VOCAL_LOW_HZ);
    const highHz = Math.max(lowHz * 2, options.vocalHighHz ?? DEFAULT_VOCAL_HIGH_HZ);
    for (let k = 0; k < bins; k++) {
      const hz = k * binHz;
      bassWeight[k] = fallingEdge(hz, crossoverHz, crossoverOctaves);
      vocalWeight[k] = risingEdge(hz, lowHz, EDGE_OCTAVES) * fallingEdge(hz, highHz, EDGE_OCTAVES);
    }
  }

  const accumulators: Record<StemName, Float64Array[]> = {
    vocals: [],
    drums: [],
    bass: [],
    other: [],
  };
  for (const name of STEM_NAMES) {
    for (let c = 0; c < channelCount; c++) {
      accumulators[name].push(new Float64Array(paddedLength));
    }
  }
  const windowSum = new Float64Array(paddedLength);

  const re: Float32Array[] = [];
  const im: Float32Array[] = [];
  const harmonic: Float64Array[] = [];
  const percussive: Float64Array[] = [];
  for (let c = 0; c < channelCount; c++) {
    re.push(new Float32Array(fftSize));
    im.push(new Float32Array(fftSize));
    harmonic.push(new Float64Array(bins));
    percussive.push(new Float64Array(bins));
  }
  const masks: Record<StemName, Float64Array[]> = {
    vocals: [],
    drums: [],
    bass: [],
    other: [],
  };
  for (const name of STEM_NAMES) {
    for (let c = 0; c < channelCount; c++) masks[name].push(new Float64Array(bins));
  }
  const stemRe = new Float32Array(fftSize);
  const stemIm = new Float32Array(fftSize);
  const timeWindow = new Float64Array(timeSpan);
  const sliding = new SlidingMedian(freqSpan);

  for (let f = 0; f < frameCount; f++) {
    const start = f * hop;
    for (let c = 0; c < channelCount; c++) {
      for (let i = 0; i < fftSize; i++) re[c][i] = padded[c][start + i] * window[i];
      im[c].fill(0);
      fftInPlace(re[c], im[c]);
      medianAlongTime(spectrogram[c], f, frameCount, bins, halfTime, timeWindow, harmonic[c]);
      medianAlongFrequency(spectrogram[c], f, bins, halfFreq, sliding, percussive[c]);
    }

    for (let k = 0; k < bins; k++) {
      // Coherence is a property of the stereo field, not of one channel, so the
      // same centre weight applies to both — that is what keeps the extracted
      // vocal in the middle instead of collapsing it to mono twice over.
      let centre = 1;
      if (channelCount >= 2) {
        const lr = re[0][k] * re[1][k] + im[0][k] * im[1][k];
        const power =
          re[0][k] * re[0][k] + im[0][k] * im[0][k] + re[1][k] * re[1][k] + im[1][k] * im[1][k];
        const coherence = power > 0 ? clamp((2 * lr) / power, 0, 1) : 0;
        centre = Math.pow(coherence, centreExponent);
      }
      const vocalShare = vocalWeight[k] * centre;
      for (let c = 0; c < channelCount; c++) {
        const h = Math.pow(harmonic[c][k], exponent);
        const p = Math.pow(percussive[c][k], exponent);
        const total = h + p;
        const drums = total > 0 ? p / total : 0;
        const rest = 1 - drums;
        const bass = rest * bassWeight[k];
        const vocals = (rest - bass) * vocalShare;
        masks.drums[c][k] = drums;
        masks.bass[c][k] = bass;
        masks.vocals[c][k] = vocals;
        // By subtraction rather than by formula, so the four masks sum to one to
        // the last bit and the stems sum back to the input.
        masks.other[c][k] = rest - bass - vocals;
      }
    }

    for (let i = 0; i < fftSize; i++) windowSum[start + i] += window[i] * window[i];

    for (const name of STEM_NAMES) {
      for (let c = 0; c < channelCount; c++) {
        const mask = masks[name][c];
        for (let i = 0; i < fftSize; i++) {
          // The mask is real, so applying it symmetrically about Nyquist keeps
          // the spectrum conjugate-symmetric and the inverse transform real.
          const m = mask[i <= fftSize / 2 ? i : fftSize - i];
          stemRe[i] = re[c][i] * m;
          stemIm[i] = im[c][i] * m;
        }
        ifftInPlace(stemRe, stemIm);
        const target = accumulators[name][c];
        for (let i = 0; i < fftSize; i++) target[start + i] += stemRe[i] * window[i];
      }
    }
  }

  const stems = emptyStems(channelCount);
  for (const name of STEM_NAMES) {
    for (let c = 0; c < channelCount; c++) {
      const out = new Float32Array(length);
      const acc = accumulators[name][c];
      for (let i = 0; i < length; i++) {
        const w = windowSum[pad + i];
        out[i] = w > 1e-12 ? acc[pad + i] / w : 0;
      }
      stems[name][c] = out;
    }
  }
  return stems;
}

function oddSpan(span: number): number {
  const n = Math.max(1, Math.round(span));
  return n % 2 === 1 ? n : n + 1;
}

/**
 * Median along time at every bin of one frame: the harmonic estimate. Frames
 * outside the signal repeat the edge frame, so the first and last moments of a
 * take are filtered the same way as the middle.
 */
function medianAlongTime(
  spectrogram: Float32Array,
  frame: number,
  frameCount: number,
  bins: number,
  half: number,
  scratch: Float64Array,
  out: Float64Array,
): void {
  const span = half * 2 + 1;
  for (let k = 0; k < bins; k++) {
    for (let j = 0; j < span; j++) {
      const f = clamp(frame - half + j, 0, frameCount - 1);
      scratch[j] = spectrogram[f * bins + k];
    }
    out[k] = medianOf(scratch, span);
  }
}

/**
 * Median along frequency within one frame: the percussive estimate. Bins beyond
 * either end repeat the edge bin, which keeps the sliding window a constant size
 * and stops the very bottom of the spectrum from being filtered differently from
 * everything above it.
 */
function medianAlongFrequency(
  spectrogram: Float32Array,
  frame: number,
  bins: number,
  half: number,
  sliding: SlidingMedian,
  out: Float64Array,
): void {
  const base = frame * bins;
  const read = (i: number): number => spectrogram[base + clamp(i, 0, bins - 1)];
  sliding.reset(read, -half);
  out[0] = sliding.value();
  for (let k = 1; k < bins; k++) {
    sliding.slide(read(k - half - 1), read(k + half));
    out[k] = sliding.value();
  }
}

/**
 * Sum the four stems back together, one array per channel. Handy for a caller
 * that wants to check the guarantee itself, and it is what the tests measure.
 */
export function sumStems(stems: Stems): Float32Array[] {
  const channels = stems.vocals.length;
  const out: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const length = stems.vocals[c].length;
    const sum = new Float32Array(length);
    for (const name of STEM_NAMES) {
      const source = stems[name][c];
      for (let i = 0; i < length; i++) sum[i] += source[i];
    }
    out.push(sum);
  }
  return out;
}
