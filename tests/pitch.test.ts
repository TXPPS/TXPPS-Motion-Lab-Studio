/**
 * Pitch detection accuracy.
 *
 * The bar is what a tuner needs, not what a function signature promises: a
 * steady sine has to land inside one cent across the whole musical range, a
 * harmonic-rich sawtooth inside five, the octave must never be guessed wrong,
 * and noise must be refused rather than named.
 */
import { describe, expect, it } from 'vitest';
import {
  PitchDetector,
  centsBetween,
  detectPitch,
  noteFromHz,
} from '../src/model/pitch';

const SR = 48000;
const WINDOW = 8192;

function sine(hz: number, length = WINDOW, sampleRate = SR, amplitude = 0.8): Float32Array {
  const out = new Float32Array(length);
  // An arbitrary starting phase stops the detector from being flattered by a
  // window that happens to begin exactly on a zero crossing.
  const phase = 0.37;
  for (let i = 0; i < length; i++) {
    out[i] = amplitude * Math.sin(2 * Math.PI * hz * (i / sampleRate) + phase);
  }
  return out;
}

/** Band-limited sawtooth: every harmonic below Nyquist at 1/h amplitude. */
function sawtooth(hz: number, length = WINDOW, sampleRate = SR, amplitude = 0.8): Float32Array {
  const out = new Float32Array(length);
  const harmonics = Math.floor(sampleRate / 2 / hz);
  for (let h = 1; h <= harmonics; h++) {
    const gain = amplitude / h;
    for (let i = 0; i < length; i++) {
      out[i] += gain * Math.sin(2 * Math.PI * h * hz * (i / sampleRate) + 0.37);
    }
  }
  return out;
}

function noise(length = WINDOW, seed = 12345): Float32Array {
  const out = new Float32Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    // xorshift32: deterministic, so a failure here is reproducible.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    out[i] = (state / 0x7fffffff) * 0.5;
  }
  return out;
}

const MUSICAL_RANGE = [55, 82.41, 110, 164.81, 220, 261.626, 440, 587.33, 880, 1318.51, 1760];

describe('sine detection', () => {
  it('lands within one cent from A1 to A6', () => {
    const detector = new PitchDetector(SR);
    for (const hz of MUSICAL_RANGE) {
      const reading = detector.detect(sine(hz), { minHz: 50, maxHz: 2000 });
      expect(Math.abs(centsBetween(reading.hz, hz))).toBeLessThan(1);
    }
  });

  it('is confident about a steady tone', () => {
    const reading = detectPitch(sine(440), SR);
    expect(reading.confidence).toBeGreaterThan(0.95);
  });

  it('reports the fundamental, not an octave of it', () => {
    for (const hz of MUSICAL_RANGE) {
      const reading = detectPitch(sine(hz), SR, { minHz: 50, maxHz: 2000 });
      expect(reading.hz / hz).toBeGreaterThan(0.9);
      expect(reading.hz / hz).toBeLessThan(1.1);
    }
  });

  it('works at 44.1 kHz as well as 48 kHz', () => {
    const reading = detectPitch(sine(440, WINDOW, 44100), 44100);
    expect(Math.abs(centsBetween(reading.hz, 440))).toBeLessThan(1);
  });

  it('is unaffected by a DC offset', () => {
    const clean = sine(220);
    const offset = Float32Array.from(clean, (v) => v + 0.25);
    const a = detectPitch(clean, SR);
    const b = detectPitch(offset, SR);
    expect(Math.abs(centsBetween(b.hz, a.hz))).toBeLessThan(0.01);
  });
});

describe('harmonic-rich signals', () => {
  it('tracks a sawtooth within five cents', () => {
    const detector = new PitchDetector(SR);
    for (const hz of MUSICAL_RANGE) {
      const reading = detector.detect(sawtooth(hz), { minHz: 50, maxHz: 2000 });
      expect(reading.confidence).toBeGreaterThan(0.7);
      expect(Math.abs(centsBetween(reading.hz, hz))).toBeLessThan(5);
    }
  });

  it('finds the missing fundamental of a signal made only of upper harmonics', () => {
    const out = new Float32Array(WINDOW);
    for (const h of [2, 3, 4, 5]) {
      for (let i = 0; i < WINDOW; i++) {
        out[i] += (0.2 / h) * Math.sin((2 * Math.PI * h * 220 * i) / SR);
      }
    }
    const reading = detectPitch(out, SR, { minHz: 50, maxHz: 2000 });
    expect(Math.abs(centsBetween(reading.hz, 220))).toBeLessThan(5);
  });
});

describe('refusal cases', () => {
  it('reports low confidence and no pitch on white noise', () => {
    const reading = detectPitch(noise(), SR, { minHz: 50, maxHz: 2000 });
    expect(reading.confidence).toBeLessThan(0.5);
    expect(reading.hz).toBe(0);
  });

  it('reports nothing on silence', () => {
    const reading = detectPitch(new Float32Array(WINDOW), SR);
    expect(reading.hz).toBe(0);
    expect(reading.confidence).toBe(0);
  });

  it('reports nothing on a window too short to hold a period', () => {
    const reading = detectPitch(sine(55, 64), SR, { minHz: 50 });
    expect(reading.hz).toBe(0);
  });
});

describe('note naming', () => {
  it('names concert A and its neighbours', () => {
    expect(noteFromHz(440)).toMatchObject({ midi: 69, name: 'A', octave: 4 });
    expect(noteFromHz(440).cents).toBeCloseTo(0, 6);
    expect(noteFromHz(261.6256)).toMatchObject({ midi: 60, name: 'C', octave: 4 });
    expect(noteFromHz(27.5)).toMatchObject({ midi: 21, name: 'A', octave: 0 });
  });

  it('reports how far sharp or flat, within half a semitone', () => {
    const sharp = noteFromHz(444);
    expect(sharp.midi).toBe(69);
    expect(sharp.cents).toBeCloseTo(1200 * Math.log2(444 / 440), 6);
    expect(sharp.cents).toBeGreaterThan(0);

    const flat = noteFromHz(436);
    expect(flat.midi).toBe(69);
    expect(flat.cents).toBeLessThan(0);
    expect(Math.abs(flat.cents)).toBeLessThan(50);
  });

  it('follows a moved reference pitch', () => {
    const at442 = noteFromHz(442, 442);
    expect(at442.midi).toBe(69);
    expect(at442.cents).toBeCloseTo(0, 6);
    expect(noteFromHz(442, 442).targetHz).toBeCloseTo(442, 6);
    // Baroque pitch: the same 415 Hz tone is A4 there and G#4 at modern pitch.
    expect(noteFromHz(415, 415).name).toBe('A');
    expect(noteFromHz(415, 440).name).toBe('G#');
  });

  it('measures a cent as a cent', () => {
    expect(centsBetween(440 * Math.pow(2, 1 / 1200), 440)).toBeCloseTo(1, 6);
    expect(centsBetween(220, 440)).toBeCloseTo(-1200, 6);
  });
});

describe('end to end', () => {
  it('names a detected sawtooth correctly across octaves', () => {
    for (const [hz, name, octave] of [
      [110, 'A', 2],
      [220, 'A', 3],
      [440, 'A', 4],
      [880, 'A', 5],
    ] as const) {
      const reading = detectPitch(sawtooth(hz), SR, { minHz: 50, maxHz: 2000 });
      const note = noteFromHz(reading.hz);
      expect(note.name).toBe(name);
      expect(note.octave).toBe(octave);
      expect(Math.abs(note.cents)).toBeLessThan(5);
    }
  });
});
