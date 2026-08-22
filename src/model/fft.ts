/**
 * Fourier analysis for the spectrum display, the scope and anything else that
 * needs to see a signal by frequency.
 *
 * Pure numbers in, numbers out: no DOM, no Web Audio. The browser's own
 * `AnalyserNode.getFloatFrequencyData` is deliberately not used. Its smoothing,
 * its window and its normalisation are all fixed by the implementation, it
 * returns nothing at all inside an `OfflineAudioContext`, and it cannot be
 * unit-tested. Owning the transform means the analyser, an offline mastering
 * report and the tests all read the same numbers.
 *
 * Amplitude convention throughout: a full-scale sine sitting exactly on a bin
 * centre reads 1.0 linear, which is 0 dBFS. That holds for every window here
 * because `applyWindow` divides out the window's coherent gain.
 */

const TWO_PI = Math.PI * 2;

/** Reported instead of -Infinity so a spectrum can be drawn without guards. */
export const SPECTRUM_FLOOR_DB = -120;

export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

interface Twiddles {
  cos: Float64Array;
  sin: Float64Array;
}

/**
 * Twiddle factors cost more to compute than the butterflies that use them, and
 * a meter re-transforms the same size every animation frame, so each size is
 * built once and kept. The table is a function of the size alone, so the cache
 * cannot change what the transform returns.
 */
const twiddleCache = new Map<number, Twiddles>();

function twiddles(size: number): Twiddles {
  const cached = twiddleCache.get(size);
  if (cached) return cached;
  const half = size / 2;
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    const angle = (-TWO_PI * i) / size;
    cos[i] = Math.cos(angle);
    sin[i] = Math.sin(angle);
  }
  const table: Twiddles = { cos, sin };
  twiddleCache.set(size, table);
  return table;
}

function reverseBits(value: number, bits: number): number {
  let out = 0;
  for (let i = 0; i < bits; i++) {
    out = (out << 1) | ((value >> i) & 1);
  }
  return out;
}

/**
 * In-place iterative radix-2 decimation-in-time FFT. `re` and `im` must be the
 * same power-of-two length; on return they hold the spectrum in the usual
 * order, bin k covering frequency k · sampleRate / size.
 */
export function fftInPlace(re: Float32Array, im: Float32Array): void {
  const size = re.length;
  if (im.length !== size) throw new Error('fft: real and imaginary parts differ in length');
  if (!isPowerOfTwo(size)) throw new Error(`fft: size ${size} is not a power of two`);
  if (size === 1) return;

  const bits = Math.log2(size);
  for (let i = 0; i < size; i++) {
    const j = reverseBits(i, bits);
    if (j > i) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  const { cos, sin } = twiddles(size);
  for (let span = 1; span < size; span *= 2) {
    // Stride into the full-size twiddle table so one table serves every stage.
    const step = size / (span * 2);
    for (let start = 0; start < size; start += span * 2) {
      for (let k = 0; k < span; k++) {
        const t = k * step;
        const wr = cos[t];
        const wi = sin[t];
        const a = start + k;
        const b = a + span;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

/** Inverse of `fftInPlace`, scaled so ifft(fft(x)) === x. */
export function ifftInPlace(re: Float32Array, im: Float32Array): void {
  const size = re.length;
  for (let i = 0; i < size; i++) im[i] = -im[i];
  fftInPlace(re, im);
  const scale = 1 / size;
  for (let i = 0; i < size; i++) {
    re[i] *= scale;
    im[i] = -im[i] * scale;
  }
}

export interface RealSpectrum {
  /** Real parts, bins 0 … size/2 inclusive. */
  re: Float32Array;
  /** Imaginary parts, same length. */
  im: Float32Array;
  /** Transform length the bins came from. */
  size: number;
}

/**
 * Transform a real signal and keep only the non-redundant half of the result.
 * `samples` is copied, so the caller's buffer is untouched; a shorter input is
 * zero-padded to the transform size.
 */
export function realFft(samples: Float32Array, size = samples.length): RealSpectrum {
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  re.set(samples.subarray(0, Math.min(samples.length, size)));
  fftInPlace(re, im);
  const half = size / 2 + 1;
  return { re: re.slice(0, half), im: im.slice(0, half), size };
}

export type WindowKind = 'rectangular' | 'hann' | 'blackmanHarris';

/**
 * Analysis windows.
 *
 * Hann is the everyday choice: a narrow main lobe with side lobes falling at
 * 18 dB/octave, which is what a spectrum display wants. Blackman-Harris trades
 * a wider main lobe for −92 dB side lobes, which is what you need to see a
 * quiet partial sitting next to a loud one.
 *
 * Periodic (not symmetric) definition — the analysis window of a DFT tiles the
 * signal, so the last point must not repeat the first.
 */
export function makeWindow(kind: WindowKind, size: number): Float32Array {
  const w = new Float32Array(size);
  switch (kind) {
    case 'rectangular':
      w.fill(1);
      return w;
    case 'hann':
      for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((TWO_PI * i) / size);
      return w;
    case 'blackmanHarris':
      for (let i = 0; i < size; i++) {
        const x = (TWO_PI * i) / size;
        w[i] =
          0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x);
      }
      return w;
  }
}

/**
 * Mean of the window: the factor by which it shrinks a steady sine. Dividing by
 * it is what keeps a full-scale tone reading 0 dBFS whichever window is chosen.
 */
export function coherentGain(window: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < window.length; i++) sum += window[i];
  return sum / window.length;
}

/**
 * Window `samples` into the transform buffers, compensating coherent gain and
 * zeroing the imaginary part. `re` and `im` are reused, never reallocated.
 */
export function applyWindow(
  samples: Float32Array,
  window: Float32Array,
  re: Float32Array,
  im: Float32Array,
): void {
  const size = re.length;
  const gain = coherentGain(window);
  const scale = gain > 0 ? 1 / gain : 1;
  const n = Math.min(samples.length, window.length, size);
  for (let i = 0; i < n; i++) re[i] = samples[i] * window[i] * scale;
  for (let i = n; i < size; i++) re[i] = 0;
  im.fill(0);
}

/**
 * Linear amplitude per bin from a half spectrum. Bins between DC and Nyquist
 * are doubled because the negative-frequency half of the transform carries the
 * other half of a real signal's energy.
 */
export function magnitudeSpectrum(spectrum: RealSpectrum, out?: Float32Array): Float32Array {
  const bins = spectrum.re.length;
  const dest = out ?? new Float32Array(bins);
  const nyquist = spectrum.size / 2;
  for (let k = 0; k < bins; k++) {
    const mag = Math.hypot(spectrum.re[k], spectrum.im[k]) / spectrum.size;
    dest[k] = k === 0 || k === nyquist ? mag : mag * 2;
  }
  return dest;
}

/**
 * Same as `magnitudeSpectrum` but reading full-length transform buffers in
 * place, which is what a per-frame analyser has after `fftInPlace`.
 */
export function magnitudeInto(re: Float32Array, im: Float32Array, out: Float32Array): Float32Array {
  const size = re.length;
  const nyquist = size / 2;
  const bins = Math.min(out.length, nyquist + 1);
  for (let k = 0; k < bins; k++) {
    const mag = Math.hypot(re[k], im[k]) / size;
    out[k] = k === 0 || k === nyquist ? mag : mag * 2;
  }
  return out;
}

export function amplitudeToDb(amplitude: number, floorDb = SPECTRUM_FLOOR_DB): number {
  if (!(amplitude > 0)) return floorDb;
  const db = 20 * Math.log10(amplitude);
  return db < floorDb ? floorDb : db;
}

export function magnitudeToDb(
  magnitude: Float32Array,
  out?: Float32Array,
  floorDb = SPECTRUM_FLOOR_DB,
): Float32Array {
  const dest = out ?? new Float32Array(magnitude.length);
  for (let k = 0; k < magnitude.length; k++) dest[k] = amplitudeToDb(magnitude[k], floorDb);
  return dest;
}

export function binFrequencyHz(bin: number, sampleRate: number, size: number): number {
  return (bin * sampleRate) / size;
}

export interface SpectrumBand {
  lowHz: number;
  centerHz: number;
  highHz: number;
}

/**
 * Geometrically spaced bands spanning `minHz`…`maxHz`. A display needs constant
 * width per octave, not per hertz: linear bins put nine tenths of the pixels
 * above 2 kHz, where almost nothing a mix engineer adjusts actually lives.
 */
export function logBands(count: number, minHz = 20, maxHz = 20000): SpectrumBand[] {
  const bands: SpectrumBand[] = [];
  if (count < 1) return bands;
  const ratio = Math.pow(maxHz / minHz, 1 / count);
  let low = minHz;
  for (let i = 0; i < count; i++) {
    const high = low * ratio;
    bands.push({ lowHz: low, centerHz: Math.sqrt(low * high), highHz: high });
    low = high;
  }
  return bands;
}

/**
 * Collapse a linear-bin magnitude spectrum onto log-spaced bands.
 *
 * The band takes the loudest bin inside it rather than their sum or mean: a
 * pure tone must read its own level whatever band width it lands in, and a
 * summed band would inflate with width while a mean would bury the tone in its
 * neighbours' noise floor. Bands narrower than one bin — everything below a few
 * hundred hertz at typical window sizes — interpolate between the two bins
 * either side of the band centre instead, so the low end stays smooth.
 */
export function aggregateBandsDb(
  magnitude: Float32Array,
  sampleRate: number,
  size: number,
  bands: readonly SpectrumBand[],
  out?: Float32Array,
  floorDb = SPECTRUM_FLOOR_DB,
): Float32Array {
  const dest = out ?? new Float32Array(bands.length);
  const binHz = sampleRate / size;
  const lastBin = magnitude.length - 1;
  for (let b = 0; b < bands.length; b++) {
    const band = bands[b];
    const first = Math.ceil(band.lowHz / binHz);
    const last = Math.floor(band.highHz / binHz);
    let peak = 0;
    if (last >= first && first <= lastBin) {
      for (let k = Math.max(first, 0); k <= Math.min(last, lastBin); k++) {
        if (magnitude[k] > peak) peak = magnitude[k];
      }
    } else {
      const pos = band.centerHz / binHz;
      const i = Math.min(Math.floor(pos), lastBin - 1);
      if (i >= 0) {
        const t = pos - i;
        peak = magnitude[i] * (1 - t) + magnitude[i + 1] * t;
      }
    }
    dest[b] = amplitudeToDb(peak, floorDb);
  }
  return dest;
}
