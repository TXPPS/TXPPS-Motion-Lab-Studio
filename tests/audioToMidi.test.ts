/**
 * Audio → Note accuracy.
 *
 * The bar is a note list a musician could play back without editing it: the
 * right number of notes, the right pitches, and boundaries close enough that
 * the MIDI lines up with the audio it came from. Every assertion below is
 * measured against a synthesised signal whose true note list is known exactly.
 */
import { describe, expect, it } from 'vitest';
import { audioToNotes, detectedNotesToNotes } from '../src/model/audioToMidi';
import { DEFAULT_TEMPO_MAP } from '../src/model/tempo';

const SR = 44100;
const TOLERANCE_SEC = 0.02;

interface Step {
  hz: number;
  durSec: number;
}

const C4 = 261.6256;
const E4 = 329.6276;
const G4 = 391.9954;

/**
 * A melody with short attack and release ramps on every note. Real notes have
 * edges; a signal that switches frequency mid-cycle would be a click train the
 * detector could not honestly be graded on.
 */
function melody(
  steps: Step[],
  partials: number,
  amplitude = 0.7,
  attackSec = 0.004,
  releaseSec = 0.008,
): Float32Array {
  const total = steps.reduce((sum, s) => sum + s.durSec, 0);
  const out = new Float32Array(Math.round(total * SR));
  let offset = 0;
  for (const step of steps) {
    const length = Math.round(step.durSec * SR);
    const attack = Math.round(attackSec * SR);
    const release = Math.round(releaseSec * SR);
    const harmonics = Math.max(1, Math.min(partials, Math.floor(SR / 2 / step.hz)));
    for (let i = 0; i < length && offset + i < out.length; i++) {
      const t = i / SR;
      let value = 0;
      for (let h = 1; h <= harmonics; h++) {
        value += (amplitude / h) * Math.sin(2 * Math.PI * h * step.hz * t + 0.31);
      }
      let gain = 1;
      if (i < attack) gain = i / attack;
      else if (i > length - release) gain = (length - i) / release;
      out[offset + i] = value * gain;
    }
    offset += length;
  }
  return out;
}

function chord(hzs: number[], durSec: number, amplitude = 0.3): Float32Array {
  const out = new Float32Array(Math.round(durSec * SR));
  const attack = Math.round(0.005 * SR);
  const release = Math.round(0.02 * SR);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    let value = 0;
    for (let n = 0; n < hzs.length; n++) {
      value += amplitude * Math.sin(2 * Math.PI * hzs[n] * t + 0.17 * n);
    }
    let gain = 1;
    if (i < attack) gain = i / attack;
    else if (i > out.length - release) gain = (out.length - i) / release;
    out[i] = value * gain;
  }
  return out;
}

describe('audioToNotes, monophonic', () => {
  const steps: Step[] = [
    { hz: C4, durSec: 0.3 },
    { hz: E4, durSec: 0.3 },
    { hz: G4, durSec: 0.3 },
  ];
  const expectedPitches = [60, 64, 67];
  const expectedStarts = [0, 0.3, 0.6];
  const expectedEnds = [0.3, 0.6, 0.9];

  it('finds three sine notes at the right pitches and boundaries', () => {
    const notes = audioToNotes(melody(steps, 1), SR, { mode: 'mono' });
    expect(notes.map((n) => n.pitch)).toEqual(expectedPitches);
    notes.forEach((note, i) => {
      expect(Math.abs(note.startSec - expectedStarts[i])).toBeLessThan(TOLERANCE_SEC);
      expect(Math.abs(note.startSec + note.durSec - expectedEnds[i])).toBeLessThan(TOLERANCE_SEC);
    });
  });

  it('finds the same melody through a sawtooth, where the loudest partial is not the fundamental at every instant', () => {
    const notes = audioToNotes(melody(steps, 24), SR, { mode: 'mono' });
    expect(notes.map((n) => n.pitch)).toEqual(expectedPitches);
    notes.forEach((note, i) => {
      expect(Math.abs(note.startSec - expectedStarts[i])).toBeLessThan(TOLERANCE_SEC);
      expect(Math.abs(note.startSec + note.durSec - expectedEnds[i])).toBeLessThan(TOLERANCE_SEC);
    });
  });

  it('reports velocity from the attack level, so a quiet phrase is quieter', () => {
    const loud = audioToNotes(melody(steps, 1, 0.7), SR, { mode: 'mono' });
    const quiet = audioToNotes(melody(steps, 1, 0.07), SR, { mode: 'mono' });
    expect(loud[0].velocity).toBeGreaterThan(quiet[0].velocity + 20);
    expect(quiet[0].velocity).toBeGreaterThanOrEqual(1);
  });

  it('keeps a vibrato inside one note instead of splitting it', () => {
    const length = Math.round(0.8 * SR);
    const data = new Float32Array(length);
    let phase = 0;
    for (let i = 0; i < length; i++) {
      // ±70 cents at 5.5 Hz: deeper and faster than a singer, and still one note.
      const cents = 70 * Math.sin(2 * Math.PI * 5.5 * (i / SR));
      phase += (2 * Math.PI * (C4 * Math.pow(2, cents / 1200))) / SR;
      const envelope = Math.min(1, i / (0.005 * SR), (length - i) / (0.02 * SR));
      data[i] = 0.7 * Math.sin(phase) * envelope;
    }
    const notes = audioToNotes(data, SR, { mode: 'mono' });
    expect(notes).toHaveLength(1);
    expect(notes[0].pitch).toBe(60);
    expect(notes[0].durSec).toBeGreaterThan(0.7);
  });

  it('splits a legato pitch change that brings no onset with it', () => {
    // One continuous tone at a constant level that steps a whole tone at 0.4 s.
    // Nothing in the amplitude marks the change, so only the pitch track can
    // find it, and only to within the analysis window it is found in.
    const length = Math.round(0.8 * SR);
    const data = new Float32Array(length);
    const changeAt = Math.round(0.4 * SR);
    let phase = 0;
    for (let i = 0; i < length; i++) {
      phase += (2 * Math.PI * (i < changeAt ? C4 : C4 * Math.pow(2, 2 / 12))) / SR;
      const envelope = Math.min(1, i / (0.005 * SR), (length - i) / (0.02 * SR));
      data[i] = 0.7 * Math.sin(phase) * envelope;
    }
    const notes = audioToNotes(data, SR, { mode: 'mono' });
    expect(notes.map((n) => n.pitch)).toEqual([60, 62]);
    expect(Math.abs(notes[1].startSec - 0.4)).toBeLessThan(0.04);
    expect(Math.abs(notes[0].startSec + notes[0].durSec - 0.4)).toBeLessThan(0.04);
  });

  it('returns nothing for silence', () => {
    expect(audioToNotes(new Float32Array(SR), SR, { mode: 'mono' })).toEqual([]);
  });

  it('returns nothing for silence in the polyphonic path either', () => {
    expect(audioToNotes(new Float32Array(SR), SR, { mode: 'poly' })).toEqual([]);
  });
});

describe('audioToNotes, polyphonic', () => {
  it('resolves a three-note chord', () => {
    const notes = audioToNotes(chord([C4, E4, G4], 1), SR, { mode: 'poly', minNoteMs: 120 });
    const pitches = [...new Set(notes.map((n) => n.pitch))].sort((a, b) => a - b);
    expect(pitches).toEqual([60, 64, 67]);
    for (const note of notes) {
      expect(note.durSec).toBeGreaterThan(0.7);
      expect(note.startSec).toBeLessThan(0.1);
    }
  });

  it('resolves a two-note interval without inventing the octave below it', () => {
    const notes = audioToNotes(chord([C4, G4], 1), SR, { mode: 'poly', minNoteMs: 120 });
    const pitches = [...new Set(notes.map((n) => n.pitch))].sort((a, b) => a - b);
    expect(pitches).toEqual([60, 67]);
  });
});

describe('detectedNotesToNotes', () => {
  it('maps seconds onto beats relative to the clip start', () => {
    // 120 bpm: one beat is half a second, so a note at 0.5 s into a clip that
    // begins at 1 s sits on beat 1 of the clip.
    const notes = detectedNotesToNotes(
      [{ startSec: 0.5, durSec: 0.5, pitch: 60, velocity: 100, confidence: 1 }],
      { tempoMap: DEFAULT_TEMPO_MAP, clipStartSec: 1 },
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].start).toBeCloseTo(1, 6);
    expect(notes[0].length).toBeCloseTo(1, 6);
    expect(notes[0].pitch).toBe(60);
  });

  it('quantizes to the grid when one is given', () => {
    const notes = detectedNotesToNotes(
      [{ startSec: 0.27, durSec: 0.5, pitch: 60, velocity: 100, confidence: 1 }],
      { tempoMap: DEFAULT_TEMPO_MAP, clipStartSec: 0, quantizeGrid: 0.5 },
    );
    expect(notes[0].start).toBeCloseTo(0.5, 6);
  });

  it('produces the same ids for the same input', () => {
    const detected = [{ startSec: 0, durSec: 0.5, pitch: 60, velocity: 100, confidence: 1 }];
    const options = { tempoMap: DEFAULT_TEMPO_MAP, clipStartSec: 0 };
    expect(detectedNotesToNotes(detected, options)[0].id).toBe(
      detectedNotesToNotes(detected, options)[0].id,
    );
  });
});
