/**
 * Motion Wave — a radix-2 FFT, for the cells that have to look at a spectrum.
 *
 * Written here rather than taken from a package because `motionwave/` has no
 * dependencies (ADR-0003) and because the two cells that need it — alias
 * rejection in dBc, and the flatness proof behind the wet/dry mixer — need
 * exactly this and nothing more. A hundred lines of Cooley–Tukey is cheaper
 * than a dependency whose licence has to be checked on every build.
 */

/** In-place complex FFT. `re` and `im` must be the same power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0) {
    throw new RangeError(`fft needs equal power-of-two arrays, got ${n} and ${im.length}`);
  }

  // Bit-reversal permutation, done first so the butterflies below can run over
  // contiguous pairs instead of chasing indices.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const stepRe = Math.cos(angle);
    const stepIm = Math.sin(angle);
    for (let start = 0; start < n; start += length) {
      let wRe = 1;
      let wIm = 0;
      for (let k = 0; k < length / 2; k++) {
        const evenIndex = start + k;
        const oddIndex = evenIndex + length / 2;
        const oddRe = re[oddIndex] * wRe - im[oddIndex] * wIm;
        const oddIm = re[oddIndex] * wIm + im[oddIndex] * wRe;
        re[oddIndex] = re[evenIndex] - oddRe;
        im[oddIndex] = im[evenIndex] - oddIm;
        re[evenIndex] += oddRe;
        im[evenIndex] += oddIm;
        const nextRe = wRe * stepRe - wIm * stepIm;
        wIm = wRe * stepIm + wIm * stepRe;
        wRe = nextRe;
      }
    }
  }
}

/**
 * A Hann window.
 *
 * Rectangular windowing smears a sine across every bin at about −13 dB, which
 * is far above the alias floor the D5 cell is trying to measure — the leakage
 * would be reported as aliasing and every oversampled unit would fail.
 */
export function hann(frames: number): Float64Array {
  const window = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frames - 1));
  }
  return window;
}

/** Magnitude of the first half of the spectrum, windowed and normalised. */
export function magnitudeSpectrum(buffer: Float32Array, windowed = true): Float64Array {
  const n = 1 << Math.floor(Math.log2(buffer.length));
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const window = windowed ? hann(n) : null;
  let gain = 0;
  for (let i = 0; i < n; i++) {
    const weight = window === null ? 1 : window[i];
    re[i] = buffer[i] * weight;
    gain += weight;
  }
  fft(re, im);
  const half = n >> 1;
  const magnitude = new Float64Array(half);
  const scale = 2 / (gain > 0 ? gain : n);
  for (let i = 0; i < half; i++) {
    magnitude[i] = Math.hypot(re[i], im[i]) * scale;
  }
  return magnitude;
}

export function binHz(bin: number, bins: number, sampleRate: number): number {
  return (bin * sampleRate) / (bins * 2);
}

export function nearestBin(hz: number, bins: number, sampleRate: number): number {
  return Math.round((hz * bins * 2) / sampleRate);
}

/**
 * The loudest bin outside the bins named in `exclude`.
 *
 * The fundamental and its immediate neighbours are excluded rather than a
 * single bin, because a sine that does not land exactly on a bin centre spreads
 * across three of them and the second-loudest bin would be the same tone.
 */
export function loudestBinExcluding(
  magnitude: Float64Array,
  exclude: (bin: number) => boolean,
): { bin: number; magnitude: number } {
  let bestBin = 0;
  let best = 0;
  for (let bin = 1; bin < magnitude.length; bin++) {
    if (exclude(bin)) continue;
    if (magnitude[bin] > best) {
      best = magnitude[bin];
      bestBin = bin;
    }
  }
  return { bin: bestBin, magnitude: best };
}

/** Flatness of a magnitude response over a band, as max−min in dB. */
export function flatnessDb(magnitude: Float64Array, fromBin: number, toBin: number): number {
  let lowest = Number.POSITIVE_INFINITY;
  let highest = 0;
  for (let bin = fromBin; bin <= toBin && bin < magnitude.length; bin++) {
    const value = magnitude[bin];
    if (value > highest) highest = value;
    if (value < lowest) lowest = value;
  }
  if (!(highest > 0) || !(lowest > 0)) return Number.POSITIVE_INFINITY;
  return 20 * Math.log10(highest / lowest);
}
