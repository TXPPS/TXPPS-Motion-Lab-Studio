/**
 * Vocal Tune: what the correction curve actually does to a known performance.
 *
 * Every case here is a synthesised voice whose true pitch is known to the cent,
 * so the assertions are in cents against that truth rather than against the
 * module's own output.
 */
import { describe, expect, it } from 'vitest';
import { analyzeVocal, correctedTrack, targetPitch, tuningCurve } from '../src/model/vocalTune';
import { centsBetween, noteFromHz } from '../src/model/pitch';

const SR = 44100;
const A4 = 440;
const CS4 = 277.1826;

/** A steady tone with soft edges, long enough for the tracker to settle. */
function tone(hz: number, durSec: number, amplitude = 0.7): Float32Array {
  const length = Math.round(durSec * SR);
  const out = new Float32Array(length);
  const fade = Math.round(0.01 * SR);
  for (let i = 0; i < length; i++) {
    const gain = Math.min(1, i / fade, (length - i) / fade);
    out[i] = amplitude * Math.sin(2 * Math.PI * hz * (i / SR) + 0.21) * gain;
  }
  return out;
}

/** A tone with sinusoidal vibrato of a given depth in cents and rate in Hz. */
function vibratoTone(hz: number, durSec: number, depthCents: number, rateHz: number): Float32Array {
  const length = Math.round(durSec * SR);
  const out = new Float32Array(length);
  const fade = Math.round(0.01 * SR);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const cents = depthCents * Math.sin(2 * Math.PI * rateHz * (i / SR));
    phase += (2 * Math.PI * hz * Math.pow(2, cents / 1200)) / SR;
    const gain = Math.min(1, i / fade, (length - i) / fade);
    out[i] = 0.7 * Math.sin(phase) * gain;
  }
  return out;
}

function centsOf(semitones: number): number {
  return semitones * 100;
}

/** Frames inside the steady part of a one-note take, away from both edges. */
function steady<T extends { timeSec: number }>(frames: T[], fromSec = 0.3, toSec = 0.8): T[] {
  return frames.filter((f) => f.timeSec >= fromSec && f.timeSec <= toSec);
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function peakToPeak(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

describe('analyzeVocal', () => {
  it('reports the sung pitch and how far off it is', () => {
    const analysis = analyzeVocal(tone(A4 * Math.pow(2, 40 / 1200), 1), SR);
    expect(analysis.notes).toHaveLength(1);
    expect(analysis.notes[0].pitch).toBe(69);
    expect(analysis.notes[0].centsMean).toBeGreaterThan(35);
    expect(analysis.notes[0].centsMean).toBeLessThan(45);
    expect(analysis.frames.length).toBeGreaterThan(50);
  });

  it('leaves silence unvoiced and noteless', () => {
    const analysis = analyzeVocal(new Float32Array(SR), SR);
    expect(analysis.notes).toEqual([]);
    expect(analysis.frames.every((f) => f.hz === 0)).toBe(true);
    expect([...tuningCurve(analysis, { strength: 1 })].every((v) => v === 0)).toBe(true);
  });
});

describe('tuningCurve', () => {
  it('pulls a note 40 cents sharp back to pitch, to within 3 cents', () => {
    const analysis = analyzeVocal(tone(A4 * Math.pow(2, 40 / 1200), 1), SR);
    const curve = tuningCurve(analysis, { strength: 1, retuneMs: 0, humanise: 0 });
    const shifts = analysis.frames
      .map((f, i) => ({ timeSec: f.timeSec, cents: centsOf(curve[i]) }))
      .filter((s) => s.timeSec >= 0.3 && s.timeSec <= 0.8)
      .map((s) => s.cents);
    expect(Math.abs(mean(shifts) - -40)).toBeLessThan(3);
  });

  it('corrects nothing at strength 0', () => {
    const analysis = analyzeVocal(tone(A4 * Math.pow(2, 40 / 1200), 1), SR);
    const curve = tuningCurve(analysis, { strength: 0, retuneMs: 0, humanise: 0 });
    expect([...curve].every((v) => v === 0)).toBe(true);
  });

  it('scales linearly with strength', () => {
    const analysis = analyzeVocal(tone(A4 * Math.pow(2, 40 / 1200), 1), SR);
    const half = tuningCurve(analysis, { strength: 0.5, retuneMs: 0, humanise: 0 });
    const shifts = analysis.frames
      .map((f, i) => ({ timeSec: f.timeSec, cents: centsOf(half[i]) }))
      .filter((s) => s.timeSec >= 0.3 && s.timeSec <= 0.8)
      .map((s) => s.cents);
    expect(Math.abs(mean(shifts) - -20)).toBeLessThan(3);
  });

  it('eases the correction in over the retune time rather than snapping', () => {
    const analysis = analyzeVocal(tone(A4 * Math.pow(2, 40 / 1200), 1), SR);
    const slow = tuningCurve(analysis, { strength: 1, retuneMs: 200, humanise: 0 });
    const at = (sec: number): number => {
      const i = analysis.frames.findIndex((f) => f.timeSec >= sec);
      return Math.abs(centsOf(slow[i]));
    };
    // 25 ms into a 200 ms retune, barely any of the correction has arrived; by
    // 600 ms the one-pole has settled on it.
    expect(at(analysis.frames[0].timeSec + 0.025)).toBeLessThan(10);
    expect(at(0.6)).toBeGreaterThan(35);
  });
});

describe('scale locking', () => {
  it('moves C#4 in C major down to C4, the tie between C and D resolving downward', () => {
    // C sharp is exactly one semitone from both C and D. `scales.ts` breaks that
    // tie downward everywhere in the program, so the target is C4, not D4.
    expect(targetPitch(61, { scaleId: 'major', tonic: 0 })).toBe(60);

    const analysis = analyzeVocal(tone(CS4, 1), SR);
    expect(analysis.notes[0].pitch).toBe(61);
    const track = steady(correctedTrack(analysis, { scaleId: 'major', tonic: 0, strength: 1 }));
    const outputs = track.map((f) => f.outputHz);
    for (const hz of outputs) {
      const named = noteFromHz(hz);
      expect(named.midi).toBe(60);
      expect(Math.abs(named.cents)).toBeLessThan(5);
    }
    expect(Math.abs(centsBetween(mean(outputs), 261.6256))).toBeLessThan(3);
  });

  it('takes a custom pitch-class set over the named scale', () => {
    // D and A only: C sharp has to go to D, which a major scale would not do.
    expect(targetPitch(61, { pitchClasses: [2, 9] })).toBe(62);
    const analysis = analyzeVocal(tone(CS4, 1), SR);
    const track = steady(correctedTrack(analysis, { pitchClasses: [2, 9], strength: 1 }));
    for (const frame of track) expect(noteFromHz(frame.outputHz).midi).toBe(62);
  });
});

describe('humanise', () => {
  const depthCents = 50;
  const rateHz = 5;

  function depths(humanise: number): { input: number; output: number } {
    const analysis = analyzeVocal(vibratoTone(A4, 1.2, depthCents, rateHz), SR);
    const track = steady(
      correctedTrack(analysis, { strength: 1, retuneMs: 0, humanise }),
      0.35,
      1.0,
    );
    const inputCents = track.map((f) => centsBetween(f.inputHz, A4));
    const outputCents = track.map((f) => centsBetween(f.outputHz, A4));
    return { input: peakToPeak(inputCents), output: peakToPeak(outputCents) };
  }

  it('keeps a 5 Hz vibrato when humanise is 1', () => {
    const { input, output } = depths(1);
    // The tracker sees the vibrato it was given, to within its own window smear.
    expect(input).toBeGreaterThan(1.6 * depthCents);
    expect(output).toBeGreaterThan(0.7 * input);
  });

  it('flattens the same vibrato onto the target when humanise is 0', () => {
    const { input, output } = depths(0);
    expect(output).toBeLessThan(0.25 * input);
  });
});
