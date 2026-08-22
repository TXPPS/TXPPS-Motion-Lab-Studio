import type { SynthParams } from './types';

export const SYNTH_PRESETS: SynthParams[] = [
  {
    presetName: 'Warm Keys',
    waveform: 'triangle',
    cutoff: 3800,
    resonance: 0.8,
    attack: 0.012,
    decay: 0.35,
    sustain: 0.45,
    release: 0.5,
    volume: 0.55,
  },
  {
    presetName: 'Deep Saw Bass',
    waveform: 'sawtooth',
    cutoff: 700,
    resonance: 2.5,
    attack: 0.005,
    decay: 0.18,
    sustain: 0.6,
    release: 0.12,
    volume: 0.6,
  },
  {
    presetName: 'Sine Lead',
    waveform: 'sine',
    cutoff: 6000,
    resonance: 1,
    attack: 0.01,
    decay: 0.2,
    sustain: 0.7,
    release: 0.3,
    volume: 0.5,
  },
  {
    presetName: 'Bright Pluck',
    waveform: 'square',
    cutoff: 2500,
    resonance: 4,
    attack: 0.003,
    decay: 0.16,
    sustain: 0.05,
    release: 0.2,
    volume: 0.5,
  },
  {
    presetName: 'Soft Pad',
    waveform: 'triangle',
    cutoff: 1800,
    resonance: 0.7,
    attack: 0.6,
    decay: 0.5,
    sustain: 0.8,
    release: 1.2,
    volume: 0.5,
  },
  {
    presetName: 'Acid Squelch',
    waveform: 'sawtooth',
    cutoff: 900,
    resonance: 9,
    attack: 0.004,
    decay: 0.22,
    sustain: 0.25,
    release: 0.15,
    volume: 0.5,
  },
  // The two patches below exist to make the oscillator morph, the sub and the
  // LFO findable. A control nobody can hear an example of is a control nobody
  // turns, and the six presets above were all written before the voice had
  // any of them — none of which is changed here, because a preset that starts
  // sounding different is a preset the user has lost.
  {
    // The pulse-width sound: one oscillator, a slow modulator on its width,
    // and enough attack to hear the beating build.
    presetName: 'PWM Strings',
    waveform: 'sawtooth',
    shape: 1,
    pulseWidth: 0.5,
    cutoff: 4200,
    resonance: 1.2,
    attack: 0.25,
    decay: 0.6,
    sustain: 0.75,
    release: 0.9,
    volume: 0.5,
    lfoRate: 0.6,
    lfoToWidth: 0.9,
  },
  {
    // A lead line that slides: a notched saw over a sine an octave down, with
    // a glide short enough to read as articulation rather than as an effect.
    presetName: 'Glide Bass',
    waveform: 'sawtooth',
    shape: 0.35,
    pulseWidth: 0.35,
    subLevel: 0.7,
    glide: 0.09,
    cutoff: 620,
    resonance: 3,
    attack: 0.004,
    decay: 0.2,
    sustain: 0.55,
    release: 0.14,
    volume: 0.55,
  },
];

export const DRUM_KIT_PARAMS: SynthParams = {
  presetName: 'TX Drum Kit',
  waveform: 'sine',
  cutoff: 12000,
  resonance: 0.7,
  attack: 0.001,
  decay: 0.2,
  sustain: 0,
  release: 0.05,
  volume: 0.8,
};

export function getPreset(name: string): SynthParams {
  const p = SYNTH_PRESETS.find((s) => s.presetName === name);
  return { ...(p ?? SYNTH_PRESETS[0]) };
}

/**
 * The classic kit's map: which key plays which hit, and which media the hit is.
 *
 * The media id is here rather than only inside the audio engine because the
 * pads draw the hit's waveform and the rack conversion loads the same sounds —
 * three places that must agree about what "Kick" is, and now do because there
 * is one table saying so.
 */
export const DRUM_PITCHES: { pitch: number; name: string; mediaId: string }[] = [
  { pitch: 36, name: 'Kick', mediaId: 'hit-kick' },
  { pitch: 38, name: 'Snare', mediaId: 'hit-snare' },
  { pitch: 39, name: 'Clap', mediaId: 'hit-clap' },
  { pitch: 42, name: 'Hat', mediaId: 'hit-hat' },
  { pitch: 46, name: 'Open Hat', mediaId: 'hit-openhat' },
];
