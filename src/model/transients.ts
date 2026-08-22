/**
 * Transient detection, onset envelopes and tempo estimation.
 *
 * Pure numbers in, numbers out — no DOM, no Web Audio, no React — so the same
 * code runs on a decoded clip in the UI thread, inside a worker, and in the
 * tests.
 *
 * Two detectors, because one detection function does not fit both jobs.
 * Spectral flux hears a note change even when the level does not move, which is
 * what a sustained instrument or a vocal needs, and it costs an FFT per frame.
 * A jump in short-window RMS is far cheaper and is all a drum loop needs, where
 * every onset is also a step in level. `analyseTransients` chooses between them
 * from the signal's spectral flatness rather than asking the musician to know
 * which is which.
 *
 * Frame positions are only accurate to one hop, which is far too coarse for a
 * slice point or a warp marker — a hop is several milliseconds and a flammed
 * snare is audible at two. Every accepted onset is therefore re-measured at
 * sample resolution against the sharpest energy rise near it.
 *
 * This module supersedes the envelope-only `detectTransients` in `sampler.ts`,
 * which stays where it is because the pad slicer is happy with it and changing
 * it would move existing pad boundaries in saved projects.
 */
import { applyWindow, fftInPlace, magnitudeInto, makeWindow, nextPowerOfTwo } from './fft';

/** One detected onset. */
export interface Transient {
  /** Position in the analysed signal, in seconds. */
  timeSec: number;
  /** Salience, 0..1, where 1 is the most prominent onset in this signal. */
  strength: number;
}

export type OnsetMethod = 'spectral' | 'energy';

export interface TransientOptions {
  /**
   * The one knob a musician moves, 0..1. At 0 only unmistakable hits survive;
   * at 1 nearly every ripple in the detection function is marked.
   */
  sensitivity?: number;
  /** Shortest gap between two onsets, in seconds. Doubles as the slice guard. */
  minIntervalSec?: number;
  /** Force a detector; 'auto' picks one from spectral flatness. */
  method?: OnsetMethod | 'auto';
  /** Transform length for the spectral detector, rounded up to a power of two. */
  fftSize?: number;
}

export interface TempoOptions {
  minBpm?: number;
  maxBpm?: number;
}

export interface TempoEstimate {
  /** Estimated tempo, or 0 when nothing periodic was found. */
  bpm: number;
  /** 0..1: the normalised height of the autocorrelation peak that won. */
  confidence: number;
  /** Time of the first beat, in seconds, within one beat of the start. */
  beatOffsetSec: number;
}

/** A detection function sampled at a fixed frame rate. */
export interface OnsetEnvelope {
  /** One non-negative value per frame. */
  values: Float32Array;
  /** Seconds between frames. */
  hopSec: number;
  /** Time of frame 0. */
  startSec: number;
  method: OnsetMethod;
}

export interface TransientAnalysis {
  transients: Transient[];
  tempo: TempoEstimate;
  envelope: OnsetEnvelope;
  /** Spectral flatness 0..1 that chose the detector. */
  flatness: number;
  method: OnsetMethod;
}

const DEFAULT_FFT_SIZE = 1024;
/** Frames overlap 4:1; anything less and a hop is too long to place an onset. */
const OVERLAP = 4;
/**
 * Log compression of the magnitude before differencing. Without it the flux is
 * dominated by whatever is loudest and a quiet hi-hat over a sustained pad never
 * registers; `log1p(1000 x)` is the usual compromise for spectra normalised so
 * that a full-scale sine reads 1.0.
 */
const LOG_COMPRESSION = 1000;
/** Keeps the log of a silent RMS finite, and pins silence to a flux of exactly 0. */
const RMS_FLOOR = 1e-4;
/** Width of the running median that adapts the threshold to the local level. */
const MEDIAN_SPAN_SEC = 0.12;
const DEFAULT_MIN_INTERVAL_SEC = 0.03;
/**
 * Above this average flatness the material is noise-like — drums, percussion,
 * clicks — and the cheap RMS detector is as good as the expensive one.
 */
const PERCUSSIVE_FLATNESS = 0.15;
/** Half-width of the attack/decay comparison used to re-measure an onset. */
const REFINE_WINDOW_SEC = 0.0015;

export const MIN_DETECT_BPM = 60;
export const MAX_DETECT_BPM = 200;

/**
 * Centre of the tempo preference curve, in bpm, and its width in octaves.
 * Autocorrelation cannot tell a tempo from half or double of it — both are
 * genuine periods of the same envelope — so the tie is broken the way listeners
 * break it, by preferring a tapping rate near two per second.
 */
const PREFERRED_BPM = 120;
const PREFERENCE_OCTAVES = 1.0;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function frameCount(length: number, size: number, hop: number): number {
  if (length < size) return 0;
  return Math.floor((length - size) / hop) + 1;
}

function resolveFftSize(requested: number | undefined): number {
  return nextPowerOfTwo(Math.max(64, Math.min(16384, Math.round(requested ?? DEFAULT_FFT_SIZE))));
}

/**
 * Geometric mean over arithmetic mean of the magnitude spectrum, averaged over
 * frames. 0 is a pure tone, 1 is white noise. Frames below the noise floor are
 * skipped so that silence between hits does not read as tonal.
 */
export function spectralFlatness(
  samples: Float32Array,
  sampleRate: number,
  fftSize = DEFAULT_FFT_SIZE,
): number {
  const size = resolveFftSize(fftSize);
  const hop = size / OVERLAP;
  const frames = frameCount(samples.length, size, hop);
  if (frames < 1 || sampleRate <= 0) return 0;

  const window = makeWindow('hann', size);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const frame = new Float32Array(size);
  const bins = size / 2 + 1;
  const mag = new Float32Array(bins);

  let total = 0;
  let counted = 0;
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    for (let i = 0; i < size; i++) frame[i] = samples[start + i];
    applyWindow(frame, window, re, im);
    fftInPlace(re, im);
    magnitudeInto(re, im, mag);

    let logSum = 0;
    let sum = 0;
    // DC and Nyquist carry no timbre and would drag the geometric mean to zero.
    for (let k = 1; k < bins - 1; k++) {
      const m = mag[k];
      logSum += Math.log(m + 1e-12);
      sum += m;
    }
    const n = bins - 2;
    if (n <= 0) continue;
    const arithmetic = sum / n;
    if (arithmetic < 1e-7) continue;
    total += Math.exp(logSum / n) / arithmetic;
    counted++;
  }
  return counted > 0 ? clamp01(total / counted) : 0;
}

/**
 * Half-wave-rectified difference of successive log-magnitude spectra: how much
 * energy appeared since the previous frame, ignoring energy that went away.
 */
export function spectralFluxEnvelope(
  samples: Float32Array,
  sampleRate: number,
  fftSize = DEFAULT_FFT_SIZE,
): OnsetEnvelope {
  const size = resolveFftSize(fftSize);
  const hop = size / OVERLAP;
  const frames = frameCount(samples.length, size, hop);
  const envelope: OnsetEnvelope = {
    values: new Float32Array(Math.max(0, frames)),
    hopSec: hop / sampleRate,
    startSec: size / 2 / sampleRate,
    method: 'spectral',
  };
  if (frames < 2) return envelope;

  const window = makeWindow('hann', size);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const frame = new Float32Array(size);
  const bins = size / 2 + 1;
  const mag = new Float32Array(bins);
  let previous = new Float32Array(bins);
  let current = new Float32Array(bins);

  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    for (let i = 0; i < size; i++) frame[i] = samples[start + i];
    applyWindow(frame, window, re, im);
    fftInPlace(re, im);
    magnitudeInto(re, im, mag);

    let flux = 0;
    for (let k = 0; k < bins; k++) {
      const v = Math.log1p(LOG_COMPRESSION * mag[k]);
      current[k] = v;
      const rise = v - previous[k];
      if (rise > 0) flux += rise;
    }
    // Frame 0 has nothing to difference against; leaving it at 0 also stops the
    // start of the buffer from being reported as an onset it is not.
    envelope.values[f] = f === 0 ? 0 : flux;
    const swap = previous;
    previous = current;
    current = swap;
  }
  return envelope;
}

/**
 * Rise in short-window RMS, measured in nepers so that the same relative jump
 * counts the same whether the passage is loud or quiet. Silence differences to
 * exactly zero, which is what makes "silence yields no onsets" true by
 * construction rather than by threshold.
 */
export function energyEnvelope(
  samples: Float32Array,
  sampleRate: number,
  fftSize = DEFAULT_FFT_SIZE,
): OnsetEnvelope {
  const size = resolveFftSize(fftSize);
  const hop = size / OVERLAP;
  const win = hop * 2;
  const frames = frameCount(samples.length, win, hop);
  const envelope: OnsetEnvelope = {
    values: new Float32Array(Math.max(0, frames)),
    hopSec: hop / sampleRate,
    startSec: win / 2 / sampleRate,
    method: 'energy',
  };
  if (frames < 2) return envelope;

  let previous = 0;
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    let sum = 0;
    for (let i = 0; i < win; i++) {
      const s = samples[start + i];
      sum += s * s;
    }
    const rms = Math.sqrt(sum / win);
    const level = Math.log(rms + RMS_FLOOR);
    if (f > 0) {
      const rise = level - previous;
      envelope.values[f] = rise > 0 ? rise : 0;
    }
    previous = level;
  }
  return envelope;
}

/**
 * Running median of the detection function, with the window clamped rather than
 * shortened at the edges so the buffer can be sorted in place without a new
 * allocation per frame.
 */
function runningMedian(values: Float32Array, span: number, out: Float32Array): void {
  const n = values.length;
  const width = Math.max(3, span | 1);
  const half = (width - 1) / 2;
  const scratch = new Float32Array(width);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < width; j++) {
      const k = i - half + j;
      scratch[j] = values[k < 0 ? 0 : k >= n ? n - 1 : k];
    }
    scratch.sort();
    out[i] = scratch[half];
  }
}

interface Peak {
  frame: number;
  value: number;
  strength: number;
}

/**
 * Peak picking: a local maximum that stands clear of both the running median and
 * an absolute fraction of the loudest peak in the signal. The median alone lets
 * noise through in quiet passages, where three times almost nothing is still
 * almost nothing; the absolute floor alone misses a real hit in a quiet verse.
 */
function pickPeaks(envelope: OnsetEnvelope, sensitivity: number, minIntervalSec: number): Peak[] {
  const values = envelope.values;
  const n = values.length;
  if (n < 3) return [];

  let globalMax = 0;
  for (let i = 0; i < n; i++) if (values[i] > globalMax) globalMax = values[i];
  if (!(globalMax > 0)) return [];

  const s = clamp01(sensitivity);
  // Picky at 0 (three times the local median, a third of the loudest onset),
  // permissive at 1 (barely over the median, a fiftieth of the loudest).
  const medianMultiple = 3 - 1.95 * s;
  const floor = globalMax * (0.32 - 0.3 * s);

  const median = new Float32Array(n);
  runningMedian(values, Math.round(MEDIAN_SPAN_SEC / Math.max(envelope.hopSec, 1e-6)), median);

  const candidates: Peak[] = [];
  for (let i = 1; i < n - 1; i++) {
    const v = values[i];
    if (v < values[i - 1] || v < values[i + 1]) continue;
    const threshold = median[i] * medianMultiple + floor;
    if (v <= threshold) continue;
    const head = globalMax - median[i];
    candidates.push({
      frame: i,
      value: v,
      strength: clamp01(head > 0 ? (v - median[i]) / head : 1),
    });
  }
  if (candidates.length === 0) return [];

  // Strongest first, so that when two peaks fall inside the minimum interval the
  // one that survives is the hit and not whichever happened to come first.
  candidates.sort((a, b) => (b.value === a.value ? a.frame - b.frame : b.value - a.value));
  const minFrames = Math.max(1, Math.round(minIntervalSec / Math.max(envelope.hopSec, 1e-6)));
  const kept: Peak[] = [];
  for (const c of candidates) {
    let clash = false;
    for (const k of kept) {
      if (Math.abs(k.frame - c.frame) < minFrames) {
        clash = true;
        break;
      }
    }
    if (!clash) kept.push(c);
  }
  kept.sort((a, b) => a.frame - b.frame);
  return kept;
}

/**
 * Re-measure an onset at sample resolution.
 *
 * The score is the energy just after a sample over the energy just before it, so
 * the winner is the sharpest attack in the search range — for a click that is
 * the click's own first sample. Ties resolve to the latest position, which keeps
 * the marker on the attack rather than in the silence in front of it.
 */
function refineOnsetSample(
  samples: Float32Array,
  sampleRate: number,
  coarseSample: number,
  radius: number,
): number {
  const w = Math.max(4, Math.round(REFINE_WINDOW_SEC * sampleRate));
  const from = Math.max(w, coarseSample - radius);
  const to = Math.min(samples.length - w - 1, coarseSample + radius);
  if (to <= from) return coarseSample;

  let back = 0;
  let forward = 0;
  for (let i = from - w; i < from; i++) back += samples[i] * samples[i];
  for (let i = from; i < from + w; i++) forward += samples[i] * samples[i];

  let best = from;
  let bestScore = -1;
  for (let i = from; i <= to; i++) {
    const score = forward / (back + 1e-12);
    if (score >= bestScore) {
      bestScore = score;
      best = i;
    }
    const leaving = samples[i - w];
    const pivot = samples[i];
    const arriving = samples[i + w];
    back += pivot * pivot - leaving * leaving;
    forward += arriving * arriving - pivot * pivot;
  }
  return best;
}

function envelopeFrameSample(envelope: OnsetEnvelope, frame: number, sampleRate: number): number {
  return Math.round((envelope.startSec + frame * envelope.hopSec) * sampleRate);
}

/**
 * Autocorrelate a detection function to find its beat period.
 *
 * The envelope's mean is removed first: what matters is whether the *peaks*
 * line up, not that the function is positive everywhere. Normalising by the
 * zero-lag term then makes the peak height a confidence — 1 for a metronome,
 * near 0 for noise — independent of how loud or how long the signal is.
 */
export function estimateTempoFromEnvelope(
  envelope: OnsetEnvelope,
  options: TempoOptions = {},
): TempoEstimate {
  const none: TempoEstimate = { bpm: 0, confidence: 0, beatOffsetSec: 0 };
  const values = envelope.values;
  const n = values.length;
  const hopSec = envelope.hopSec;
  if (n < 8 || !(hopSec > 0)) return none;

  const minBpm = Math.max(1, options.minBpm ?? MIN_DETECT_BPM);
  const maxBpm = Math.max(minBpm + 1, options.maxBpm ?? MAX_DETECT_BPM);
  const minLag = Math.max(1, Math.floor(60 / maxBpm / hopSec));
  const maxLag = Math.min(n - 2, Math.ceil(60 / minBpm / hopSec));
  if (maxLag <= minLag) return none;

  let mean = 0;
  for (let i = 0; i < n; i++) mean += values[i];
  mean /= n;

  let power = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - mean;
    power += d * d;
  }
  if (!(power > 0)) return none;
  const zeroLag = power / n;

  let bestLag = -1;
  let bestScore = -Infinity;
  let bestNorm = 0;
  const correlation = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < n; i++) sum += (values[i] - mean) * (values[i - lag] - mean);
    const norm = sum / (n - lag) / zeroLag;
    correlation[lag] = norm;
    const bpm = 60 / (lag * hopSec);
    const octaves = Math.log2(bpm / PREFERRED_BPM) / PREFERENCE_OCTAVES;
    const score = norm * Math.exp(-0.5 * octaves * octaves);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
      bestNorm = norm;
    }
  }
  if (bestLag < 0 || !(bestNorm > 0)) return none;

  // Sub-frame period from the parabola through the winning lag: at a 6 ms hop a
  // whole-frame period is already 1 bpm out at the top of the range.
  let period = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const a = correlation[bestLag - 1];
    const b = correlation[bestLag];
    const c = correlation[bestLag + 1];
    const denom = 2 * (2 * b - a - c);
    if (denom !== 0) {
      const shift = (c - a) / denom;
      if (shift > -1 && shift < 1) period = bestLag + shift;
    }
  }

  const beatOffsetSec = envelope.startSec + beatPhaseFrames(values, period) * hopSec;
  return {
    bpm: 60 / (period * hopSec),
    confidence: clamp01(bestNorm),
    beatOffsetSec,
  };
}

/** Phase of the beat grid: the offset whose comb of beat positions collects the most energy. */
function beatPhaseFrames(values: Float32Array, period: number): number {
  const n = values.length;
  const span = Math.max(1, Math.round(period));
  let best = 0;
  let bestSum = -1;
  for (let phase = 0; phase < span; phase++) {
    let sum = 0;
    for (let t = phase; t < n; t += period) sum += values[Math.round(t)];
    if (sum > bestSum) {
      bestSum = sum;
      best = phase;
    }
  }
  return best;
}

/**
 * Full pass: envelope, onsets and tempo in one traversal of the signal, because
 * the tempo estimate wants the same detection function the onsets came from.
 */
export function analyseTransients(
  samples: Float32Array,
  sampleRate: number,
  options: TransientOptions & TempoOptions = {},
): TransientAnalysis {
  const fftSize = resolveFftSize(options.fftSize);
  const minIntervalSec = Math.max(0.001, options.minIntervalSec ?? DEFAULT_MIN_INTERVAL_SEC);
  const requested = options.method ?? 'auto';
  const flatness = requested === 'auto' ? spectralFlatness(samples, sampleRate, fftSize) : 0;
  const method: OnsetMethod =
    requested === 'auto' ? (flatness >= PERCUSSIVE_FLATNESS ? 'energy' : 'spectral') : requested;

  const envelope =
    method === 'energy'
      ? energyEnvelope(samples, sampleRate, fftSize)
      : spectralFluxEnvelope(samples, sampleRate, fftSize);

  const peaks = pickPeaks(envelope, options.sensitivity ?? 0.5, minIntervalSec);
  // Wide enough to cover the lag between an onset and the frame whose flux
  // reports it, but never wide enough to reach the neighbouring onset.
  const radius = Math.min(
    Math.round(0.75 * fftSize),
    Math.max(1, Math.round((minIntervalSec * sampleRate) / 2)),
  );
  const transients: Transient[] = peaks.map((p) => ({
    timeSec:
      refineOnsetSample(
        samples,
        sampleRate,
        envelopeFrameSample(envelope, p.frame, sampleRate),
        radius,
      ) / sampleRate,
    strength: p.strength,
  }));

  const tempo = estimateTempoFromEnvelope(envelope, options);
  return { transients, tempo, envelope, flatness, method };
}

/**
 * Detected onsets, earliest first. `sensitivity` is the only control a musician
 * needs; everything else has a default that works on a mixed programme.
 */
export function detectTransients(
  samples: Float32Array,
  sampleRate: number,
  options: TransientOptions = {},
): Transient[] {
  return analyseTransients(samples, sampleRate, options).transients;
}

/**
 * Tempo and downbeat phase over a 60-200 bpm search. `bpm` is 0 when the signal
 * has no periodic structure at all; a low `confidence` means the number is a
 * guess and the caller should keep the project tempo.
 */
export function estimateTempo(
  samples: Float32Array,
  sampleRate: number,
  options: TransientOptions & TempoOptions = {},
): TempoEstimate {
  const analysis = analyseTransients(samples, sampleRate, options);
  return snapTempoPhase(analysis.tempo, analysis.transients);
}

/**
 * Move the beat phase onto the nearest detected onset when there is one close
 * by. The envelope only resolves the phase to a hop, and a warp marker that is
 * six milliseconds late is a warp marker in the wrong place.
 */
export function snapTempoPhase(
  tempo: TempoEstimate,
  transients: readonly Transient[],
): TempoEstimate {
  if (!(tempo.bpm > 0) || transients.length === 0) return tempo;
  const beatSec = 60 / tempo.bpm;
  const tolerance = beatSec * 0.25;
  let best = tempo.beatOffsetSec;
  let bestDistance = tolerance;
  for (const t of transients) {
    const phase = t.timeSec - tempo.beatOffsetSec;
    const distance = Math.abs(phase - Math.round(phase / beatSec) * beatSec);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = t.timeSec;
    }
  }
  // Report the first beat at or after zero so the value is a position, not a lag.
  const wrapped = best - Math.floor(best / beatSec) * beatSec;
  return { ...tempo, beatOffsetSec: wrapped };
}

/** Onset times alone, for `AudioClip.transients`. */
export function transientTimes(transients: readonly Transient[]): number[] {
  return transients.map((t) => t.timeSec);
}
