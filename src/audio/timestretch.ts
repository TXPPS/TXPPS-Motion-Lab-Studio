/**
 * Time stretching and pitch shifting.
 *
 * Everything above `stretchBuffer` is pure: Float32Array in, Float32Array out,
 * no DOM, no Web Audio, no React. Only the last function in the file knows what
 * an `AudioBuffer` is, so the expensive part can move to a worker unchanged and
 * the tests drive the real algorithm rather than a stand-in.
 *
 * Method: WSOLA (waveform-similarity overlap-add). Plain OLA advances the read
 * pointer more slowly than the write pointer and cross-fades the seams, which
 * works until the two spliced waveforms disagree about phase — then a sustained
 * note thins out where the splices cancel and a drum flams. WSOLA keeps the
 * uniform output hops and instead slides each analysis frame within a search
 * window to the position whose waveform best continues the frame already
 * written. On periodic material that lands the splice a whole number of periods
 * away and the seam disappears.
 *
 * Time and pitch are independent because they are done in two stages: a pitch
 * shift of `s` semitones is a stretch by 2^(s/12) followed by a resample by the
 * same factor, which puts the length back where it started and takes the pitch
 * with it. `formantPreserve` then corrects the side effect of that resample —
 * see `preserveFormants`.
 *
 * The stretcher is deterministic (no randomness, no time-dependent state) and
 * allocates only before its loops, never inside them.
 */
import { fftInPlace, ifftInPlace, makeWindow, nextPowerOfTwo } from '../model/fft';

/** Beyond this range WSOLA's search window can no longer hide the splices. */
export const MIN_TIME_RATIO = 0.25;
export const MAX_TIME_RATIO = 4;

/**
 * The coarse similarity search runs on a boxcar-decimated copy of the signal.
 * Averaging before decimating is what keeps it an anti-aliased search rather
 * than a lottery on cymbals.
 */
const SEARCH_DECIMATION = 4;
/** Full-rate refinement either side of the coarse winner, in samples. */
const SEARCH_REFINE = 6;

export interface WsolaGrid {
  /** Analysis and synthesis frame length, in samples. */
  frameSize: number;
  /** Distance between output frames, in samples. Half the frame. */
  synthesisHop: number;
  /** Furthest an analysis frame may slide from its nominal position. */
  searchRadius: number;
}

/**
 * Frame geometry for a sample rate. About 46 ms at 44.1 kHz: long enough to
 * hold a couple of periods of a bass note, short enough that a splice does not
 * smear the attack of a snare.
 */
export function wsolaGrid(sampleRate: number, timeRatio = 1): WsolaGrid {
  const frameSize = nextPowerOfTwo(Math.max(256, Math.round(sampleRate * 0.035)));
  const synthesisHop = frameSize / 2;
  const analysisHop = synthesisHop / clampRatio(timeRatio);
  // The correction a frame needs is the difference between the two hops; a
  // radius smaller than that cannot reach the right splice at all.
  const needed = Math.abs(synthesisHop - analysisHop);
  const searchRadius = Math.min(frameSize / 2, Math.max(frameSize / 4, Math.round(needed)));
  return { frameSize, synthesisHop, searchRadius };
}

function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return Math.min(MAX_TIME_RATIO, Math.max(MIN_TIME_RATIO, ratio));
}

function previousPowerOfTwo(n: number): number {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

/**
 * Hann pair that sums to exactly 1 across a half-frame overlap.
 *
 * Written as `1 - rising` rather than evaluated from the cosine twice so the
 * two halves cancel to the last bit: the overlap-add then needs no window-sum
 * normalisation, and a frame that happens not to move leaves the signal alone.
 */
function overlapWindow(frameSize: number): Float32Array {
  const half = frameSize / 2;
  const w = new Float32Array(frameSize);
  for (let i = 0; i < half; i++) {
    const rising = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frameSize);
    w[i] = rising;
    w[i + half] = 1 - rising;
  }
  return w;
}

function sampleAt(data: Float32Array, index: number): number {
  return index >= 0 && index < data.length ? data[index] : 0;
}

/**
 * Cubic Hermite resampling. `factor` is input samples consumed per output
 * sample: 2 halves the length and raises the pitch an octave.
 *
 * Cubic rather than linear because linear interpolation is a lowpass whose
 * corner moves with the fractional phase, which on a shifted vocal sounds like
 * a flutter on the top end.
 */
export function resampleChannel(samples: Float32Array, factor: number): Float32Array {
  const n = samples.length;
  if (n === 0) return new Float32Array(0);
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return samples.slice();
  const outLength = Math.max(1, Math.round(n / factor));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * factor;
    const k = Math.floor(pos);
    const t = pos - k;
    const p0 = sampleAt(samples, k - 1);
    const p1 = sampleAt(samples, k);
    const p2 = sampleAt(samples, k + 1);
    const p3 = sampleAt(samples, k + 2);
    const a = 0.5 * (p2 - p0);
    const b = 0.5 * (p3 - p1);
    const d = p1 - p2;
    out[i] = (2 * d + a + b) * t * t * t + (-3 * d - 2 * a - b) * t * t + a * t + p1;
  }
  return out;
}

/**
 * Stretch one channel to `ratio` times its length while keeping its pitch.
 * 1.5 makes it half again as long and half again as slow.
 */
export function stretchChannel(
  samples: Float32Array,
  sampleRate: number,
  ratio: number,
): Float32Array {
  const n = samples.length;
  if (n === 0) return new Float32Array(0);
  const r = clampRatio(ratio);
  // Exactly 1 short-circuits: the overlap-add would otherwise return the input
  // rounded through two multiplies, which is within an ulp but not identical,
  // and "stretch by 1" is a real case the arrangement hits whenever a clip is
  // not warped.
  if (Math.abs(r - 1) < 1e-9) return samples.slice();

  const grid = wsolaGrid(sampleRate, r);
  // A frame must fit twice in the input or there is nothing to splice between.
  const frameSize = Math.min(grid.frameSize, previousPowerOfTwo(n >> 1));
  if (frameSize < 64) {
    // Under a few milliseconds there is no periodicity to preserve and no room
    // to search; resampling is the honest answer and its pitch shift is
    // inaudible on a fragment this short.
    return resampleChannel(samples, 1 / r);
  }
  const synthesisHop = frameSize / 2;
  const overlap = synthesisHop;
  const searchRadius = Math.min(frameSize / 2, Math.max(frameSize / 4, grid.searchRadius));
  const analysisHop = synthesisHop / r;

  const outLength = Math.max(1, Math.round(n * r));
  const out = new Float32Array(outLength);
  const frames = Math.max(1, Math.ceil((outLength - frameSize) / synthesisHop) + 1);

  const fade = overlapWindow(frameSize);
  // Flat halves at the two ends, so the first and last frames are not faded in
  // and out against nothing and the whole output sits at unity gain.
  const firstWindow = new Float32Array(frameSize);
  const lastWindow = new Float32Array(frameSize);
  const flatWindow = new Float32Array(frameSize).fill(1);
  for (let i = 0; i < frameSize; i++) {
    firstWindow[i] = i < synthesisHop ? 1 : fade[i];
    lastWindow[i] = i < synthesisHop ? fade[i] : 1;
  }

  const decimated = decimate(samples, SEARCH_DECIMATION);
  /**
   * A frame's content is spread over its whole length, so it is the frame's
   * centre — not its first sample — that has to land where the time scale says.
   * Without this shift every event comes out early by half a frame's worth of
   * stretch, which on a drum loop is a hop of flam before the beat.
   */
  const centreShift = (frameSize / 2) * (1 / r - 1);

  let previous = 0;
  for (let f = 0; f < frames; f++) {
    let start = 0;
    if (f > 0) {
      const nominal = Math.max(0, Math.round(f * analysisHop + centreShift));
      start = bestSplice(
        samples,
        decimated,
        previous + synthesisHop,
        nominal,
        overlap,
        searchRadius,
      );
    }

    const window =
      frames === 1 ? flatWindow : f === 0 ? firstWindow : f === frames - 1 ? lastWindow : fade;
    const outStart = f * synthesisHop;
    const count = Math.min(frameSize, outLength - outStart);
    for (let i = 0; i < count; i++) {
      const s = start + i;
      out[outStart + i] += (s >= 0 && s < n ? samples[s] : 0) * window[i];
    }
    previous = start;
  }
  return out;
}

/** Boxcar-average by `step`, which band-limits before it throws samples away. */
function decimate(samples: Float32Array, step: number): Float32Array {
  const out = new Float32Array(Math.floor(samples.length / step));
  const scale = 1 / step;
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    const base = i * step;
    for (let j = 0; j < step; j++) sum += samples[base + j];
    out[i] = sum * scale;
  }
  return out;
}

/**
 * Analysis position whose first `overlap` samples best continue the frame
 * already written, searched around `nominal`.
 *
 * The similarity measure is a cross-correlation normalised by the candidate's
 * own energy: without that division the search would simply walk towards the
 * loudest place within reach. The template's energy is the same for every
 * candidate, so it is left out.
 *
 * Coarse pass on the decimated copy, then a few samples of refinement at full
 * rate. Searching every sample at full rate over a half-frame radius costs
 * around thirty times more for a splice that is, in practice, the same one.
 */
function bestSplice(
  samples: Float32Array,
  decimated: Float32Array,
  templateStart: number,
  nominal: number,
  overlap: number,
  searchRadius: number,
): number {
  // The nominal position goes first so that a tie — silence, or a signal with no
  // structure to lock onto — leaves the frame where uniform time-scaling put it.
  let best = nominal;
  let bestScore = similarity(samples, templateStart, nominal, overlap);

  const step = SEARCH_DECIMATION;
  const coarseOverlap = Math.max(4, Math.floor(overlap / step));
  const coarseTemplate = Math.round(templateStart / step);
  const coarseBase = Math.round(nominal / step);
  const coarseRadius = Math.max(1, Math.round(searchRadius / step));

  let coarseBest = coarseBase;
  let coarseScore = -Infinity;
  for (let k = -coarseRadius; k <= coarseRadius; k++) {
    const at = coarseBase + k;
    if (at < 0) continue;
    const score = similarity(decimated, coarseTemplate, at, coarseOverlap);
    if (score > coarseScore) {
      coarseScore = score;
      coarseBest = at;
    }
  }

  const centre = coarseBest * step;
  for (let k = -SEARCH_REFINE; k <= SEARCH_REFINE; k++) {
    const at = centre + k;
    if (at < 0 || at === nominal) continue;
    const score = similarity(samples, templateStart, at, overlap);
    if (score > bestScore) {
      bestScore = score;
      best = at;
    }
  }
  return best;
}

function similarity(
  data: Float32Array,
  templateStart: number,
  candidate: number,
  length: number,
): number {
  const n = data.length;
  let dot = 0;
  let energy = 0;
  for (let j = 0; j < length; j++) {
    const t = templateStart + j;
    const c = candidate + j;
    const tv = t >= 0 && t < n ? data[t] : 0;
    const cv = c >= 0 && c < n ? data[c] : 0;
    dot += tv * cv;
    energy += cv * cv;
  }
  return dot / Math.sqrt(energy + 1e-12);
}

const FORMANT_FFT_SIZE = 2048;
const FORMANT_OVERLAP = 4;
/**
 * Finest spectral detail the envelope is allowed to follow, in Hz. It sets the
 * cepstral cutoff: coarse enough to stay well under the pitch peak of anything
 * down to about 80 Hz, fine enough to resolve formants a few hundred hertz
 * apart.
 */
const FORMANT_ENVELOPE_HZ = 550;
/** Correction limit. Past this the filter is inventing a resonance, not moving one. */
const FORMANT_LIMIT_NEPERS = 24 / 8.685889638065035;

/**
 * Undo the formant shift a resampling pitch change causes.
 *
 * Resampling by `rate` scales the whole spectrum, envelope included, so a voice
 * shifted up an octave has the body of a voice half the size — the chipmunk.
 * The harmonics belong where the resample put them; the envelope does not. If
 * the shifted signal's envelope is Es, the envelope the original had at
 * frequency f is Es(f · rate), so the corrective gain is Es(f · rate) / Es(f)
 * and no reference to the original signal is needed.
 *
 * The envelope is the low-quefrency part of the cepstrum: the log spectrum's
 * own spectrum separates the slowly-varying resonances from the fast harmonic
 * comb, and truncating it keeps the first and drops the second.
 */
export function preserveFormants(
  samples: Float32Array,
  sampleRate: number,
  rate: number,
): Float32Array {
  const n = samples.length;
  const size = FORMANT_FFT_SIZE;
  if (n < size * 2 || !Number.isFinite(rate) || rate <= 0 || rate === 1) return samples.slice();

  const hop = size / FORMANT_OVERLAP;
  const frames = Math.floor((n - size) / hop) + 1;
  const window = makeWindow('hann', size);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const cepstrumRe = new Float32Array(size);
  const cepstrumIm = new Float32Array(size);
  const gain = new Float32Array(size / 2 + 1);
  const lifter = Math.min(size / 4, Math.max(8, Math.round(sampleRate / FORMANT_ENVELOPE_HZ)));
  const out = new Float32Array(n);
  const weight = new Float32Array(n);
  const half = size / 2;

  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    for (let i = 0; i < size; i++) {
      re[i] = samples[start + i] * window[i];
      im[i] = 0;
    }
    fftInPlace(re, im);

    // Log magnitude, mirrored, so its transform is the real cepstrum.
    for (let k = 0; k <= half; k++) {
      const m = Math.log(Math.hypot(re[k], im[k]) + 1e-9);
      cepstrumRe[k] = m;
      if (k > 0 && k < half) cepstrumRe[size - k] = m;
      cepstrumIm[k] = 0;
      if (k > 0 && k < half) cepstrumIm[size - k] = 0;
    }
    ifftInPlace(cepstrumRe, cepstrumIm);
    for (let q = lifter; q < size - lifter; q++) {
      cepstrumRe[q] = 0;
      cepstrumIm[q] = 0;
    }
    fftInPlace(cepstrumRe, cepstrumIm);

    for (let k = 0; k <= half; k++) {
      const source = Math.min(half, Math.round(k * rate));
      let delta = cepstrumRe[source] - cepstrumRe[k];
      if (delta > FORMANT_LIMIT_NEPERS) delta = FORMANT_LIMIT_NEPERS;
      else if (delta < -FORMANT_LIMIT_NEPERS) delta = -FORMANT_LIMIT_NEPERS;
      gain[k] = Math.exp(delta);
    }
    for (let k = 0; k <= half; k++) {
      const g = gain[k];
      re[k] *= g;
      im[k] *= g;
      if (k > 0 && k < half) {
        re[size - k] *= g;
        im[size - k] *= g;
      }
    }

    ifftInPlace(re, im);
    for (let i = 0; i < size; i++) {
      const w = window[i];
      out[start + i] += re[i] * w;
      weight[start + i] += w * w;
    }
  }

  for (let i = 0; i < n; i++) {
    // Below the first and after the last frame the window sum is small or zero;
    // leaving those samples as they came in beats dividing by almost nothing.
    if (weight[i] > 0.1) out[i] /= weight[i];
    else out[i] = samples[i];
  }
  return out;
}

/**
 * Shift pitch by `semitones` without changing length: stretch by the shift
 * factor, then resample by it.
 */
export function pitchShiftChannel(
  samples: Float32Array,
  sampleRate: number,
  semitones: number,
  formantPreserve = false,
): Float32Array {
  if (!Number.isFinite(semitones) || semitones === 0) return samples.slice();
  const rate = Math.pow(2, semitones / 12);
  const stretched = stretchChannel(samples, sampleRate, rate);
  const shifted = resampleChannel(stretched, rate);
  return formantPreserve ? preserveFormants(shifted, sampleRate, rate) : shifted;
}

export interface StretchOptions {
  /** Output length as a multiple of the input's. 1 leaves the timing alone. */
  timeRatio?: number;
  /** Pitch shift in semitones, independent of `timeRatio`. */
  semitones?: number;
  /** Keep the body of the sound where it was when shifting pitch. */
  formantPreserve?: boolean;
}

function fitLength(samples: Float32Array, length: number): Float32Array {
  if (samples.length === length) return samples;
  const out = new Float32Array(length);
  out.set(samples.subarray(0, Math.min(samples.length, length)));
  return out;
}

/**
 * Stretch and shift an `AudioBuffer`, returning a new one. The only function in
 * this file that touches the Web Audio API, and it does no DSP of its own.
 */
export function stretchBuffer(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  options: StretchOptions = {},
): AudioBuffer {
  const timeRatio = clampRatio(options.timeRatio ?? 1);
  const semitones = Number.isFinite(options.semitones) ? (options.semitones as number) : 0;
  const rate = Math.pow(2, semitones / 12);
  const sampleRate = buffer.sampleRate;
  const length = Math.max(1, Math.round(buffer.length * timeRatio));
  const out = ctx.createBuffer(buffer.numberOfChannels, length, sampleRate);

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const source = buffer.getChannelData(c);
    // One stretch does both jobs: the extra factor of `rate` is what the
    // resample below takes back out again.
    const stretched = stretchChannel(source, sampleRate, timeRatio * rate);
    const shifted = semitones === 0 ? stretched : resampleChannel(stretched, rate);
    const corrected =
      options.formantPreserve && semitones !== 0
        ? preserveFormants(shifted, sampleRate, rate)
        : shifted;
    out.copyToChannel(fitLength(corrected, length), c);
  }
  return out;
}
