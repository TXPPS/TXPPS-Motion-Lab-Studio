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

/** Drum map used by the drum synth and the drum piano roll. */
export const DRUM_PITCHES: { pitch: number; name: string }[] = [
  { pitch: 36, name: 'Kick' },
  { pitch: 38, name: 'Snare' },
  { pitch: 39, name: 'Clap' },
  { pitch: 42, name: 'Hat' },
  { pitch: 46, name: 'Open Hat' },
];
