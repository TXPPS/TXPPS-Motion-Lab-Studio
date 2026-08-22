import { describe, expect, it } from 'vitest';
import {
  analyseTransients,
  detectTransients,
  estimateTempo,
  spectralFlatness,
} from '../src/model/transients';

const SR = 44100;

/**
 * A click is four milliseconds of decaying 2 kHz tone: broadband enough to be a
 * real onset, short enough that its exact position is not in doubt.
 */
function clickTrain(
  intervalSec: number,
  count: number,
  startSec = 0.1,
): {
  data: Float32Array;
  times: number[];
} {
  const length = Math.round((startSec + intervalSec * count + 0.4) * SR);
  const data = new Float32Array(length);
  const times: number[] = [];
  const decay = Math.round(0.004 * SR);
  for (let c = 0; c < count; c++) {
    const at = Math.round((startSec + c * intervalSec) * SR);
    times.push(at / SR);
    for (let i = 0; i < decay && at + i < length; i++) {
      data[at + i] = Math.exp(-i / (decay / 4)) * Math.sin((2 * Math.PI * 2000 * i) / SR);
    }
  }
  return { data, times };
}

/** Deterministic white noise; a seeded LCG so a failure is always reproducible. */
function noise(seconds: number, amplitude = 0.5): Float32Array {
  let seed = 987654321;
  const data = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296 - 0.5) * 2 * amplitude;
  }
  return data;
}

function maxErrorMs(found: readonly { timeSec: number }[], expected: readonly number[]): number {
  let worst = 0;
  for (let i = 0; i < expected.length; i++) {
    worst = Math.max(worst, Math.abs(found[i].timeSec - expected[i]) * 1000);
  }
  return worst;
}

describe('detectTransients', () => {
  it('places onsets on a click train within 5 ms', () => {
    const { data, times } = clickTrain(0.25, 12);
    const found = detectTransients(data, SR);
    expect(found).toHaveLength(times.length);
    expect(maxErrorMs(found, times)).toBeLessThan(5);
  });

  it('places onsets within 5 ms with either detector, at an uneven spacing', () => {
    const length = Math.round(3 * SR);
    const data = new Float32Array(length);
    const decay = Math.round(0.004 * SR);
    const times = [0.2, 0.53, 0.71, 1.24, 1.55, 1.9, 2.4];
    for (const t of times) {
      const at = Math.round(t * SR);
      for (let i = 0; i < decay; i++) {
        data[at + i] = Math.exp(-i / (decay / 4)) * Math.sin((2 * Math.PI * 1800 * i) / SR);
      }
    }
    for (const method of ['spectral', 'energy'] as const) {
      const found = detectTransients(data, SR, { method });
      expect(found, method).toHaveLength(times.length);
      expect(
        maxErrorMs(
          found,
          times.map((t) => Math.round(t * SR) / SR),
        ),
        method,
      ).toBeLessThan(5);
    }
  });

  it('reports nothing at all for digital silence', () => {
    expect(detectTransients(new Float32Array(SR * 2), SR)).toHaveLength(0);
    expect(detectTransients(new Float32Array(0), SR)).toHaveLength(0);
  });

  it('grades onsets by salience', () => {
    const length = Math.round(2 * SR);
    const data = new Float32Array(length);
    const decay = Math.round(0.004 * SR);
    // A loud hit and a ghost note a quarter of the level.
    for (const [t, gain] of [
      [0.3, 1],
      [0.9, 0.25],
      [1.5, 1],
    ] as const) {
      const at = Math.round(t * SR);
      for (let i = 0; i < decay; i++) {
        data[at + i] = gain * Math.exp(-i / (decay / 4)) * Math.sin((2 * Math.PI * 2000 * i) / SR);
      }
    }
    const found = detectTransients(data, SR, { sensitivity: 0.9 });
    expect(found.length).toBeGreaterThanOrEqual(3);
    const ghost = found.find((t) => Math.abs(t.timeSec - 0.9) < 0.005);
    const hit = found.find((t) => Math.abs(t.timeSec - 0.3) < 0.005);
    expect(ghost).toBeDefined();
    expect(hit).toBeDefined();
    expect(ghost!.strength).toBeLessThan(hit!.strength);
  });

  it('finds more onsets as sensitivity rises', () => {
    const data = noise(3, 0.4);
    const picky = detectTransients(data, SR, { sensitivity: 0 }).length;
    const eager = detectTransients(data, SR, { sensitivity: 1 }).length;
    expect(picky).toBeLessThan(eager);
  });

  it('keeps onsets at least the minimum interval apart', () => {
    const { data } = clickTrain(0.06, 20);
    const found = detectTransients(data, SR, { minIntervalSec: 0.15, sensitivity: 1 });
    for (let i = 1; i < found.length; i++) {
      expect(found[i].timeSec - found[i - 1].timeSec).toBeGreaterThanOrEqual(0.14);
    }
  });
});

describe('spectralFlatness', () => {
  it('separates a tone from noise and picks the detector accordingly', () => {
    const tone = new Float32Array(SR);
    for (let i = 0; i < tone.length; i++) tone[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR);
    expect(spectralFlatness(tone, SR)).toBeLessThan(0.01);
    expect(spectralFlatness(noise(1), SR)).toBeGreaterThan(0.5);
    expect(analyseTransients(tone, SR).method).toBe('spectral');
    expect(analyseTransients(noise(1), SR).method).toBe('energy');
  });
});

describe('estimateTempo', () => {
  it('reads 120 bpm off a 120 bpm click train, at the unison and not an octave', () => {
    const { data } = clickTrain(0.5, 16);
    const estimate = estimateTempo(data, SR);

    // Autocorrelation cannot distinguish a tempo from half or double of it, so
    // state which of those this is: the preference curve centred on 120 bpm
    // resolves the tie to the unison, i.e. 120 itself rather than 60 or 240.
    const octave = Math.round(Math.log2(estimate.bpm / 120));
    expect([-1, 0, 1]).toContain(octave);
    expect(octave).toBe(0);

    expect(estimate.bpm).toBeCloseTo(120, 0);
    expect(estimate.confidence).toBeGreaterThan(0.7);
    // The train starts 100 ms in, which is where the downbeat is.
    expect(estimate.beatOffsetSec).toBeCloseTo(0.1, 2);
  });

  it('reads 150 bpm off a 150 bpm click train', () => {
    const { data } = clickTrain(0.4, 20);
    const estimate = estimateTempo(data, SR);
    expect(estimate.bpm).toBeCloseTo(150, 0);
    expect(estimate.confidence).toBeGreaterThan(0.7);
  });

  it('is unconfident about noise and silent about silence', () => {
    const noisy = estimateTempo(noise(4), SR);
    expect(noisy.confidence).toBeLessThan(0.4);

    const silent = estimateTempo(new Float32Array(SR * 4), SR);
    expect(silent.bpm).toBe(0);
    expect(silent.confidence).toBe(0);
  });

  it('stays inside the 60-200 bpm search range', () => {
    // Clicks every 200 ms are 300 bpm; the estimate must be a sub-multiple in range.
    const { data } = clickTrain(0.2, 30);
    const estimate = estimateTempo(data, SR);
    expect(estimate.bpm).toBeGreaterThanOrEqual(60);
    expect(estimate.bpm).toBeLessThanOrEqual(200);
    expect(estimate.bpm).toBeCloseTo(150, 0);
  });
});
