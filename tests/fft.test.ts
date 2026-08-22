/**
 * The transform is checked against results that can be written down in advance:
 * an impulse is flat, a bin-centred sine is one bin at its own amplitude,
 * Parseval's theorem holds, and the inverse undoes the forward exactly. Those
 * four together leave no room for a scaling slip or a twiddle sign error.
 */
import { describe, expect, it } from 'vitest';
import {
  SPECTRUM_FLOOR_DB,
  aggregateBandsDb,
  amplitudeToDb,
  applyWindow,
  binFrequencyHz,
  coherentGain,
  fftInPlace,
  ifftInPlace,
  isPowerOfTwo,
  logBands,
  magnitudeInto,
  magnitudeSpectrum,
  magnitudeToDb,
  makeWindow,
  nextPowerOfTwo,
  realFft,
} from '../src/model/fft';

const SIZE = 1024;
const SR = 48000;

function sineAtBin(bin: number, size = SIZE, amplitude = 1): Float32Array {
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) out[i] = amplitude * Math.sin((2 * Math.PI * bin * i) / size);
  return out;
}

describe('sizes', () => {
  it('recognises powers of two', () => {
    expect(isPowerOfTwo(1024)).toBe(true);
    expect(isPowerOfTwo(1000)).toBe(false);
    expect(isPowerOfTwo(0)).toBe(false);
    expect(nextPowerOfTwo(1000)).toBe(1024);
    expect(nextPowerOfTwo(1024)).toBe(1024);
  });

  it('refuses a size it cannot transform', () => {
    expect(() => fftInPlace(new Float32Array(1000), new Float32Array(1000))).toThrow(
      /power of two/,
    );
    expect(() => fftInPlace(new Float32Array(8), new Float32Array(4))).toThrow(/length/);
  });
});

describe('known transforms', () => {
  it('turns an impulse into a flat spectrum', () => {
    const re = new Float32Array(SIZE);
    const im = new Float32Array(SIZE);
    re[0] = 1;
    fftInPlace(re, im);
    for (let k = 0; k < SIZE; k++) {
      expect(Math.hypot(re[k], im[k])).toBeCloseTo(1, 5);
    }
  });

  it('turns a delayed impulse into a flat spectrum with a linear phase ramp', () => {
    const re = new Float32Array(SIZE);
    const im = new Float32Array(SIZE);
    re[3] = 1;
    fftInPlace(re, im);
    for (let k = 0; k < SIZE; k++) {
      expect(Math.hypot(re[k], im[k])).toBeCloseTo(1, 5);
      const expected = (-2 * Math.PI * 3 * k) / SIZE;
      // Phase is only defined modulo a turn, so compare the wrapped difference.
      const delta = Math.atan2(im[k], re[k]) - expected;
      expect(Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)))).toBeLessThan(1e-4);
    }
  });

  it('puts a bin-centred sine in exactly one bin at its own amplitude', () => {
    const mag = magnitudeSpectrum(realFft(sineAtBin(64, SIZE, 0.5)));
    expect(mag[64]).toBeCloseTo(0.5, 5);
    for (let k = 0; k < mag.length; k++) {
      if (k !== 64) expect(mag[k]).toBeLessThan(1e-5);
    }
  });

  it('reads DC and Nyquist without the doubling the other bins get', () => {
    const dc = new Float32Array(SIZE).fill(0.75);
    expect(magnitudeSpectrum(realFft(dc))[0]).toBeCloseTo(0.75, 5);

    const nyquist = new Float32Array(SIZE);
    for (let i = 0; i < SIZE; i++) nyquist[i] = i % 2 === 0 ? 0.5 : -0.5;
    expect(magnitudeSpectrum(realFft(nyquist))[SIZE / 2]).toBeCloseTo(0.5, 5);
  });

  it('satisfies Parseval', () => {
    const re = new Float32Array(SIZE);
    const im = new Float32Array(SIZE);
    let state = 7;
    let timeEnergy = 0;
    for (let i = 0; i < SIZE; i++) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      re[i] = state / 0x3fffffff - 1;
      timeEnergy += re[i] * re[i];
    }
    fftInPlace(re, im);
    let specEnergy = 0;
    for (let k = 0; k < SIZE; k++) specEnergy += re[k] * re[k] + im[k] * im[k];
    expect(specEnergy / SIZE).toBeCloseTo(timeEnergy, 3);
  });

  it('inverts itself', () => {
    const original = sineAtBin(37, SIZE, 0.6);
    const re = Float32Array.from(original);
    const im = new Float32Array(SIZE);
    fftInPlace(re, im);
    ifftInPlace(re, im);
    for (let i = 0; i < SIZE; i++) {
      expect(re[i]).toBeCloseTo(original[i], 5);
      expect(im[i]).toBeCloseTo(0, 5);
    }
  });

  it('zero-pads a short input up to the transform size', () => {
    const spectrum = realFft(new Float32Array([1, 0, 0, 0]), 8);
    expect(spectrum.size).toBe(8);
    expect(spectrum.re.length).toBe(5);
    for (let k = 0; k < 5; k++)
      expect(Math.hypot(spectrum.re[k], spectrum.im[k])).toBeCloseTo(1, 5);
  });
});

describe('windows', () => {
  it('has the coherent gain each window is supposed to have', () => {
    expect(coherentGain(makeWindow('rectangular', SIZE))).toBeCloseTo(1, 6);
    expect(coherentGain(makeWindow('hann', SIZE))).toBeCloseTo(0.5, 6);
    expect(coherentGain(makeWindow('blackmanHarris', SIZE))).toBeCloseTo(0.35875, 6);
  });

  it('is periodic, not symmetric — the first point is the only zero', () => {
    const hann = makeWindow('hann', 8);
    expect(hann[0]).toBeCloseTo(0, 6);
    expect(hann[4]).toBeCloseTo(1, 6);
    expect(hann[7]).toBeGreaterThan(0);
  });

  it('keeps a full-scale tone reading 0 dBFS whichever window is used', () => {
    const re = new Float32Array(SIZE);
    const im = new Float32Array(SIZE);
    const mag = new Float32Array(SIZE / 2 + 1);
    for (const kind of ['rectangular', 'hann', 'blackmanHarris'] as const) {
      applyWindow(sineAtBin(64), makeWindow(kind, SIZE), re, im);
      fftInPlace(re, im);
      magnitudeInto(re, im, mag);
      expect(amplitudeToDb(mag[64])).toBeCloseTo(0, 2);
    }
  });

  it('trades main-lobe width for side-lobe rejection', () => {
    const re = new Float32Array(SIZE);
    const im = new Float32Array(SIZE);
    const mag = new Float32Array(SIZE / 2 + 1);
    // Half a bin off centre is the worst case for leakage.
    const offCentre = new Float32Array(SIZE);
    for (let i = 0; i < SIZE; i++) offCentre[i] = Math.sin((2 * Math.PI * 64.5 * i) / SIZE);

    const farLeakage = (kind: 'hann' | 'blackmanHarris') => {
      applyWindow(offCentre, makeWindow(kind, SIZE), re, im);
      fftInPlace(re, im);
      magnitudeInto(re, im, mag);
      let worst = 0;
      for (let k = 0; k < mag.length; k++) {
        if (Math.abs(k - 64) > 6 && mag[k] > worst) worst = mag[k];
      }
      return amplitudeToDb(worst);
    };

    expect(farLeakage('blackmanHarris')).toBeLessThan(farLeakage('hann') - 20);
    expect(farLeakage('blackmanHarris')).toBeLessThan(-80);
  });
});

describe('decibels', () => {
  it('floors silence instead of returning -Infinity', () => {
    expect(amplitudeToDb(0)).toBe(SPECTRUM_FLOOR_DB);
    expect(amplitudeToDb(1)).toBeCloseTo(0, 9);
    expect(amplitudeToDb(0.5)).toBeCloseTo(-6.0206, 4);
    const out = magnitudeToDb(new Float32Array([1, 0.5, 0]));
    expect(Array.from(out)).toEqual([0, out[1], SPECTRUM_FLOOR_DB]);
  });
});

describe('log band aggregation', () => {
  it('spans the requested range with constant width per octave', () => {
    const bands = logBands(30, 20, 20000);
    expect(bands).toHaveLength(30);
    expect(bands[0].lowHz).toBeCloseTo(20, 6);
    expect(bands[29].highHz).toBeCloseTo(20000, 3);
    const ratio = bands[0].highHz / bands[0].lowHz;
    for (const band of bands) {
      expect(band.highHz / band.lowHz).toBeCloseTo(ratio, 6);
      expect(band.centerHz).toBeGreaterThan(band.lowHz);
      expect(band.centerHz).toBeLessThan(band.highHz);
    }
    expect(logBands(0)).toHaveLength(0);
  });

  it('reports a tone at its own level in the band that contains it', () => {
    const size = 4096;
    const toneHz = binFrequencyHz(Math.round((1000 * size) / SR), SR, size);
    const samples = new Float32Array(size);
    for (let i = 0; i < size; i++) samples[i] = Math.sin((2 * Math.PI * toneHz * i) / SR);

    const re = new Float32Array(size);
    const im = new Float32Array(size);
    applyWindow(samples, makeWindow('hann', size), re, im);
    fftInPlace(re, im);
    const mag = magnitudeInto(re, im, new Float32Array(size / 2 + 1));

    const bands = logBands(31, 20, 20000);
    const db = aggregateBandsDb(mag, SR, size, bands);
    const hit = bands.findIndex((b) => toneHz >= b.lowHz && toneHz < b.highHz);
    expect(hit).toBeGreaterThanOrEqual(0);
    expect(db[hit]).toBeCloseTo(0, 1);
    for (let i = 0; i < bands.length; i++) {
      if (Math.abs(i - hit) > 1) expect(db[i]).toBeLessThan(-40);
    }
  });

  it('interpolates bands narrower than one bin instead of leaving a hole', () => {
    const size = 1024;
    // Every bin is 46.9 Hz wide here, so the bottom bands hold no bin at all.
    const mag = new Float32Array(size / 2 + 1).fill(0.25);
    const bands = logBands(48, 20, 20000);
    const db = aggregateBandsDb(mag, SR, size, bands);
    for (let i = 0; i < bands.length; i++) {
      expect(db[i]).toBeCloseTo(amplitudeToDb(0.25), 6);
    }
  });

  it('writes into a caller-owned buffer without allocating', () => {
    const bands = logBands(16, 20, 20000);
    const out = new Float32Array(16);
    const mag = new Float32Array(513).fill(0.1);
    expect(aggregateBandsDb(mag, SR, 1024, bands, out)).toBe(out);
  });
});
