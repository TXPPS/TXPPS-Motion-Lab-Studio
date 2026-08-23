/**
 * Motion Wave — a reference instrument, built only to exercise the harness.
 *
 * A fixture, like `reference_effect.ts`, and in no ledger. Its job is to let
 * the six instrument cells run against something that really allocates voices,
 * really steals them, and really answers a counter — because I14's whole point
 * is that a counter which never rises passes a stuck-note test by answering the
 * wrong question, and that is only demonstrable against an implementation.
 *
 * The oscillator is a sine and the envelope is two straight lines. Anything
 * more would be modelling, and this file is not allowed to model anything.
 */

import { declareLatency } from '../mix/latency';
import { type Ramp, rampAt, steady } from '../param/ramp';
import { type ParamId, defineParam } from '../param/spec';
import { Unit } from '../param/units';
import { PRESET_FORMAT, PRESET_SCHEMA_VERSION, type PresetDocument } from '../preset/format';
import type { MeterChannel } from '../metering/bus';
import type { NoteEvent, RenderContext, UnitRenderer, UnitUnderTest, VoiceControl } from './types';

export const LEVEL: ParamId = 1;
export const DETUNE: ParamId = 2;
export const WAVE: ParamId = 3;
export const TONE: ParamId = 4;

export const MAX_VOICES = 8;

export const INSTRUMENT_SPECS = [
  defineParam({ id: LEVEL, name: 'Level', unit: Unit.Decibels, min: -24, max: 0, def: -6 }),
  defineParam({ id: DETUNE, name: 'Detune', unit: Unit.Cents, min: -50, max: 50, def: 0 }),
  defineParam({ id: WAVE, name: 'Wave', unit: Unit.Choice, choices: ['Sine', 'Full', 'Half'] }),
  defineParam({ id: TONE, name: 'Tone', unit: Unit.Percent, min: 0, max: 1, def: 1 }),
];

export const INSTRUMENT_METERS: readonly MeterChannel[] = [{ name: 'out', kind: 'peak' }];

interface Voice {
  noteId: number;
  key: number;
  phase: number;
  amplitude: number;
  /** Rises to 1 while held, falls to 0 once released; the voice retires at 0. */
  envelope: number;
  sustaining: boolean;
  active: boolean;
  bendSemitones: number;
  /** Monotonic, so stealing can take the voice that has been sounding longest. */
  age: number;
}

export class ReferenceInstrument implements VoiceControl, UnitRenderer {
  readonly declaredLatency = declareLatency(
    0,
    'none',
    'the first sample of a note is produced on the note',
  );
  readonly maxVoices = MAX_VOICES;
  private readonly voices: Voice[] = [];
  private readonly tuning = new Array<number>(12).fill(0);
  private sampleRate = 48000;
  private nextAge = 0;
  private onePole = 0;

  constructor() {
    for (let i = 0; i < MAX_VOICES; i++) {
      this.voices.push({
        noteId: -1,
        key: 0,
        phase: 0,
        amplitude: 0,
        envelope: 0,
        sustaining: false,
        active: false,
        bendSemitones: 0,
        age: 0,
      });
    }
  }

  // ------------------------------------------------------------ voice control

  get activeVoices(): number {
    return this.voices.filter((voice) => voice.active).length;
  }

  /**
   * Voices with no scheduled end. This is the measure a stuck note is found
   * with: a voice that was released correctly stays `active` until its tail
   * retires, so counting active voices answers "is it busy", which is a
   * different question and always eventually zero.
   */
  get sustainingVoices(): number {
    return this.voices.filter((voice) => voice.active && voice.sustaining).length;
  }

  noteOn(event: NoteEvent): void {
    const existing = this.voices.find((voice) => voice.active && voice.noteId === event.noteId);
    const free = this.voices.find((voice) => !voice.active);
    const target = existing ?? free ?? this.oldest();
    target.noteId = event.noteId;
    target.key = event.key;
    target.amplitude = Math.max(0.05, event.velocity);
    target.envelope = 1;
    target.sustaining = true;
    target.active = true;
    target.bendSemitones = 0;
    target.age = this.nextAge++;
    if (existing === undefined) target.phase = 0;
  }

  noteOff(noteId: number): void {
    for (const voice of this.voices) {
      if (voice.active && voice.noteId === noteId) voice.sustaining = false;
    }
  }

  panic(): void {
    for (const voice of this.voices) {
      voice.active = false;
      voice.sustaining = false;
      voice.envelope = 0;
      voice.noteId = -1;
    }
  }

  setNotePitchBend(noteId: number, semitones: number): void {
    for (const voice of this.voices) {
      if (voice.active && voice.noteId === noteId) voice.bendSemitones = semitones;
    }
  }

  setTuningTable(centsPerPitchClass: readonly number[]): void {
    for (let i = 0; i < 12; i++) this.tuning[i] = centsPerPitchClass[i] ?? 0;
  }

  // ---------------------------------------------------------------- rendering

  prepare(context: RenderContext): void {
    this.sampleRate = context.sampleRate;
  }

  reset(): void {
    this.onePole = 0;
    for (const voice of this.voices) voice.phase = 0;
  }

  processBlock(
    input: Float32Array,
    output: Float32Array,
    frames: number,
    params: ReadonlyMap<ParamId, Ramp>,
  ): void {
    void input;
    const level = params.get(LEVEL) ?? steady(-6);
    const detune = params.get(DETUNE) ?? steady(0);
    const wave = Math.round((params.get(WAVE) ?? steady(0)).end);
    const tone = params.get(TONE) ?? steady(1);

    for (let i = 0; i < frames; i++) {
      const cents = rampAt(detune, i, frames);
      let sum = 0;
      for (const voice of this.voices) {
        if (!voice.active) continue;
        sum += this.advanceVoice(voice, cents, wave);
      }
      const gain = Math.pow(10, rampAt(level, i, frames) / 20);
      // A one-pole so the Tone control has something to do; its coefficient is
      // derived from the sample rate, so the same setting is the same filter at
      // 44.1 and at 192 kHz — which is what D6 is looking for.
      const cutoff = 200 + rampAt(tone, i, frames) * 15000;
      const coefficient =
        1 - Math.exp((-2 * Math.PI * Math.min(cutoff, this.sampleRate * 0.45)) / this.sampleRate);
      this.onePole += (sum * gain - this.onePole) * coefficient;
      output[i] = this.onePole;
    }
  }

  private advanceVoice(voice: Voice, cents: number, wave: number): number {
    const semitones = voice.bendSemitones + (this.tuning[voice.key % 12] + cents) / 100;
    const hertz = 440 * Math.pow(2, (voice.key - 69 + semitones) / 12);
    voice.phase += hertz / this.sampleRate;
    if (voice.phase >= 1) voice.phase -= 1;

    const sine = Math.sin(2 * Math.PI * voice.phase);
    const shaped =
      wave === 1 ? Math.abs(sine) * 2 - 1 : wave === 2 ? Math.max(0, sine) * 2 - 1 : sine;

    if (!voice.sustaining) {
      // A fixed 20 ms fall. Long enough that the release is audible and short
      // enough that a stolen voice does not linger into the next measurement.
      voice.envelope -= 1 / (0.02 * this.sampleRate);
      if (voice.envelope <= 0) {
        voice.envelope = 0;
        voice.active = false;
        voice.noteId = -1;
        return 0;
      }
    }
    return shaped * voice.amplitude * voice.envelope * 0.2;
  }

  private oldest(): Voice {
    let target = this.voices[0];
    for (const voice of this.voices) {
      if (voice.age < target.age) target = voice;
    }
    return target;
  }
}

function factoryPreset(name: string, values: Record<string, number>): PresetDocument {
  return {
    format: PRESET_FORMAT,
    schema: PRESET_SCHEMA_VERSION,
    unit: 'ref-01',
    unitVersion: 1,
    name,
    values,
  };
}

export function makeReferenceInstrument(): UnitUnderTest {
  const instrument = new ReferenceInstrument();
  return {
    id: 'ref-01',
    name: 'Reference Voice',
    kind: 'instrument',
    specs: INSTRUMENT_SPECS,
    declaredLatency: instrument.declaredLatency,
    presetMeta: { unit: 'ref-01', unitVersion: 1, name: 'Init' },
    meters: INSTRUMENT_METERS,
    renderer: instrument,
    voices: instrument,
    factoryPresets: [
      factoryPreset('Plain', { '1': 0.75, '2': 0.5, '3': 0, '4': 1 }),
      factoryPreset('Detuned', { '1': 0.75, '2': 0.9, '3': 0.5, '4': 0.6 }),
    ],
    sheetTargets: [
      {
        what: 'a note at key 69 sounds at 440 Hz',
        params: new Map(),
        probeHz: 440,
        expectedDb: -26,
        toleranceDb: 8,
      },
    ],
    face: {
      elements: [
        {
          id: 'level',
          role: 'fader',
          paramId: LEVEL,
          accessibleName: 'Level',
          keyboardFocusable: true,
          colours: [{ foreground: '--mw-fg', background: '--mw-bg-panel' }],
        },
        {
          id: 'detune',
          role: 'knob',
          paramId: DETUNE,
          accessibleName: 'Detune',
          keyboardFocusable: true,
          colours: [{ foreground: '--mw-fg', background: '--mw-bg-panel' }],
        },
        {
          id: 'wave',
          role: 'switch',
          paramId: WAVE,
          accessibleName: 'Wave',
          keyboardFocusable: true,
          colours: [{ foreground: '--mw-fg-muted', background: '--mw-bg-raised' }],
        },
        {
          id: 'tone',
          role: 'knob',
          paramId: TONE,
          accessibleName: 'Tone',
          keyboardFocusable: true,
          colours: [{ foreground: '--mw-fg', background: '--mw-bg-panel' }],
        },
        {
          id: 'meter-out',
          role: 'meter',
          paramId: null,
          meterChannel: 'out',
          accessibleName: 'Output level',
          keyboardFocusable: false,
          colours: [{ foreground: '--mw-meter-low', background: '--mw-meter-bg' }],
        },
      ],
      artwork: [{ id: 'panel', origin: 'original', attribution: 'drawn for Motion Wave' }],
      breakpointsEm: [20, 30],
      minWidthRem: 18,
    },
  };
}
