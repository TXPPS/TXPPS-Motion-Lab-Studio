import { describe, expect, it } from 'vitest';
import {
  MAX_TIME_RATIO,
  pitchShiftChannel,
  preserveFormants,
  resampleChannel,
  stretchChannel,
  wsolaGrid,
} from '../src/audio/timestretch';
import { magnitudeSpectrum, realFft } from '../src/model/fft';
import { centsBetween, detectPitch } from '../src/model/pitch';

const SR = 44100;

function sine(hz: number, seconds: number, amplitude = 0.5): Float32Array {
  const data = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < data.length; i++) data[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / SR);
  return data;
}

function rms(data: Float32Array, from = 0, to = data.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

function dbBetween(a: number, b: number): number {
  return 20 * Math.log10(a / b);
}

/** Amplitude-weighted mean frequency: where the body of the sound sits. */
function spectralCentroid(data: Float32Array, from: number, size = 8192): number {
  const slice = data.subarray(from, from + size);
  const spectrum = realFft(slice, size);
  const magnitude = magnitudeSpectrum(spectrum);
  let weighted = 0;
  let total = 0;
  for (let k = 1; k < magnitude.length; k++) {
    const hz = (k * SR) / size;
    if (hz > 7000) break;
    weighted += hz * magnitude[k];
    total += magnitude[k];
  }
  return total > 0 ? weighted / total : 0;
}

/**
 * Harmonics of `f0` under a fixed resonance at 1500 Hz — a crude vowel. The
 * resonance is a property of the body making the sound, so a pitch shift should
 * move the harmonics and leave the resonance where it is.
 */
function vowel(f0: number, seconds: number, formantHz = 1500): Float32Array {
  const data = new Float32Array(Math.round(seconds * SR));
  const width = 350;
  for (let h = 1; h * f0 < 7000; h++) {
    const hz = h * f0;
    const bell = Math.exp(-0.5 * Math.pow((hz - formantHz) / width, 2)) + 0.02;
    for (let i = 0; i < data.length; i++) {
      data[i] += 0.25 * bell * Math.sin((2 * Math.PI * hz * i) / SR);
    }
  }
  return data;
}

describe('stretchChannel', () => {
  it('makes a 440 Hz sine 1.5x as long without moving its pitch or its level', () => {
    const source = sine(440, 1.5);
    const stretched = stretchChannel(source, SR, 1.5);

    expect(stretched.length).toBe(Math.round(source.length * 1.5));

    // Measured a third of the way in, clear of both edge frames.
    const reading = detectPitch(stretched.subarray(20000, 20000 + 8192), SR);
    expect(reading.confidence).toBeGreaterThan(0.9);
    expect(Math.abs(centsBetween(reading.hz, 440))).toBeLessThan(5);

    expect(Math.abs(dbBetween(rms(stretched), rms(source)))).toBeLessThan(1);
  });

  it('holds pitch and level across the whole supported ratio range', () => {
    const source = sine(220, 1.5);
    for (const ratio of [0.5, 0.75, 1.25, 2, MAX_TIME_RATIO]) {
      const stretched = stretchChannel(source, SR, ratio);
      expect(stretched.length, `${ratio}`).toBe(Math.round(source.length * ratio));
      const reading = detectPitch(stretched.subarray(15000, 15000 + 8192), SR);
      expect(Math.abs(centsBetween(reading.hz, 220)), `${ratio}`).toBeLessThan(5);
      expect(Math.abs(dbBetween(rms(stretched), rms(source))), `${ratio}`).toBeLessThan(1);
    }
  });

  it('is sample-identical at a ratio of exactly 1', () => {
    const source = sine(317, 0.5);
    const stretched = stretchChannel(source, SR, 1);
    expect(stretched.length).toBe(source.length);
    expect(Array.from(stretched)).toEqual(Array.from(source));
  });

  it('doubles the spacing of a click train, to within one synthesis hop', () => {
    const spacingSec = 0.25;
    const clicks = 7;
    const data = new Float32Array(Math.round(2 * SR));
    const decay = Math.round(0.003 * SR);
    for (let c = 0; c < clicks; c++) {
      const at = Math.round((0.1 + c * spacingSec) * SR);
      for (let i = 0; i < decay; i++) {
        data[at + i] = Math.exp(-i / (decay / 5)) * Math.sin((2 * Math.PI * 2500 * i) / SR);
      }
    }

    const stretched = stretchChannel(data, SR, 2);
    const hopSec = wsolaGrid(SR, 2).synthesisHop / SR;
    const found = peakTimes(stretched, 0.3, 0.1);

    expect(found).toHaveLength(clicks);
    for (let i = 1; i < found.length; i++) {
      expect(found[i] - found[i - 1]).toBeCloseTo(spacingSec * 2, 1);
      expect(Math.abs(found[i] - found[i - 1] - spacingSec * 2)).toBeLessThan(hopSec);
    }
    // The train as a whole also has to land where the time scale says it does.
    expect(Math.abs(found[0] - 0.2)).toBeLessThan(hopSec);
  });

  it('returns an empty buffer for an empty channel and refuses to divide by zero', () => {
    expect(stretchChannel(new Float32Array(0), SR, 2)).toHaveLength(0);
    expect(stretchChannel(sine(440, 0.2), SR, 0)).toHaveLength(Math.round(0.2 * SR));
  });
});

/** Times of samples over `threshold` that are the loudest within `gapSec`. */
function peakTimes(data: Float32Array, threshold: number, gapSec: number): number[] {
  const gap = Math.round(gapSec * SR);
  const out: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) < threshold) continue;
    let best = i;
    for (let j = i; j < Math.min(data.length, i + gap); j++) {
      if (Math.abs(data[j]) > Math.abs(data[best])) best = j;
    }
    out.push(best / SR);
    i = best + gap;
  }
  return out;
}

describe('resampleChannel', () => {
  it('halves the length and raises the pitch an octave at a factor of 2', () => {
    const source = sine(300, 1);
    const out = resampleChannel(source, 2);
    expect(out.length).toBe(source.length / 2);
    const reading = detectPitch(out.subarray(8000, 8000 + 8192), SR);
    expect(Math.abs(centsBetween(reading.hz, 600))).toBeLessThan(2);
  });
});

describe('pitchShiftChannel', () => {
  it('shifts pitch by the semitones asked for and keeps the length', () => {
    const source = sine(220, 1.2);
    for (const semitones of [-5, 7, 12]) {
      const shifted = pitchShiftChannel(source, SR, semitones);
      expect(shifted.length, `${semitones}`).toBe(source.length);
      const target = 220 * Math.pow(2, semitones / 12);
      const reading = detectPitch(shifted.subarray(15000, 15000 + 8192), SR);
      expect(Math.abs(centsBetween(reading.hz, target)), `${semitones}`).toBeLessThan(5);
    }
  });

  it('leaves the sound alone at zero semitones', () => {
    const source = sine(440, 0.3);
    expect(Array.from(pitchShiftChannel(source, SR, 0))).toEqual(Array.from(source));
  });
});

describe('preserveFormants', () => {
  it('keeps the resonance in place while the harmonics move', () => {
    const source = vowel(110, 1.5);
    const semitones = 7;
    const rate = Math.pow(2, semitones / 12);
    const plain = pitchShiftChannel(source, SR, semitones, false);
    const corrected = pitchShiftChannel(source, SR, semitones, true);

    const before = spectralCentroid(source, 20000);
    const shifted = spectralCentroid(plain, 20000);
    const kept = spectralCentroid(corrected, 20000);

    // Without correction the whole spectrum, resonance included, rides up with
    // the shift: that is the chipmunk. The centroid moves by less than the full
    // factor only because the measurement stops at 7 kHz and the harmonics that
    // cross it stop being counted.
    expect(rate).toBeGreaterThan(1.4);
    expect(shifted / before).toBeGreaterThan(1.3);
    // With correction the resonance stays where the body of the sound put it,
    // to within half a percent, which is two orders of magnitude better than
    // leaving it alone.
    expect(kept / before).toBeCloseTo(1, 2);
    expect(Math.abs(kept - before)).toBeLessThan(Math.abs(shifted - before) / 10);
  });

  it('passes a signal through untouched at a rate of 1 or when too short to frame', () => {
    const source = vowel(150, 0.05);
    expect(Array.from(preserveFormants(source, SR, 1))).toEqual(Array.from(source));
    expect(Array.from(preserveFormants(source, SR, 1.5))).toEqual(Array.from(source));
  });
});
