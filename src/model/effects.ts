/**
 * Insert effect definitions.
 *
 * One declarative spec per effect kind drives everything: default parameters,
 * UI controls, value clamping and display formatting. Adding an effect means
 * adding a spec here and a builder in `audio/effectChain.ts` — no UI changes.
 *
 * Choice parameters are still numbers, because every stored parameter is a
 * number and automation lanes only carry numbers. A `choices` list turns the
 * index into a name at display time, so a musician never reads a bare ordinal.
 */
import {
  CABINETS,
  clipCurve,
  compressorGain,
  describeDivision,
  expanderGain,
  quantiserCurve,
  saturationCurve,
  SATURATION_MODELS,
  syncModifierByIndex,
  transferCurve,
} from '../audio/dsp/curves';
import type { BiquadType, EqBandSpec, SaturationModel } from '../audio/dsp/curves';
import type { Effect, EffectKind } from './types';

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** How the value reads to a musician. */
  unit?: 'dB' | 'Hz' | 'ms' | '%' | 'x' | ':1' | 's' | 'Q' | 'bit' | 'stages' | 'div' | '°' | 'st';
  /** Skew the slider so useful ranges are not crammed at one end. */
  curve?: 'linear' | 'log';
  /** Discrete settings: the value is an index into this list. */
  choices?: readonly string[];
}

/** Picker categories, in the order the picker should show them. */
export type EffectGroup = 'dynamics' | 'tone' | 'modulation' | 'time' | 'stereo' | 'utility';

export const EFFECT_GROUPS: readonly EffectGroup[] = [
  'dynamics',
  'tone',
  'modulation',
  'time',
  'stereo',
  'utility',
];

export const EFFECT_GROUP_LABELS: Record<EffectGroup, string> = {
  dynamics: 'Dynamics',
  tone: 'Tone',
  modulation: 'Modulation',
  time: 'Time',
  stereo: 'Stereo',
  utility: 'Utility',
};

export interface EffectSpec {
  kind: EffectKind;
  label: string;
  /** One line explaining what it does, shown in the insert picker. */
  blurb: string;
  group: EffectGroup;
  /** True when the builder publishes a gain-reduction figure the UI can meter. */
  gainReduction?: boolean;
  params: ParamSpec[];
}

const ON_OFF = ['Off', 'On'] as const;
const SYNC_CHOICES = ['Straight', 'Dotted', 'Triplet'] as const;
const LFO_SHAPES = ['Sine', 'Triangle', 'Square'] as const;

/** Bit-reduction factors the crusher's hold network can build exactly. */
export const CRUSH_FACTORS = [1, 2, 4, 8, 16, 32, 64] as const;
const CRUSH_CHOICES = CRUSH_FACTORS.map((f) => `${f}x`);

/** Analyser window sizes, as powers of two the FFT accepts. */
export const ANALYSER_SIZES = [512, 1024, 2048, 4096, 8192] as const;
const ANALYSER_CHOICES = ANALYSER_SIZES.map((n) => `${n}`);

const CAB_CHOICES = CABINETS.map((c) => c.name);

const freq = (
  key: string,
  label: string,
  min: number,
  max: number,
  def: number,
  step = 1,
): ParamSpec => ({ key, label, min, max, step, default: def, unit: 'Hz', curve: 'log' });

const decibels = (key: string, label: string, span: number, def = 0, step = 0.5): ParamSpec => ({
  key,
  label,
  min: -span,
  max: span,
  step,
  default: def,
  unit: 'dB',
});

const percent = (key: string, label: string, def: number, max = 1): ParamSpec => ({
  key,
  label,
  min: 0,
  max,
  step: 0.01,
  default: def,
  unit: '%',
});

const choice = (key: string, label: string, choices: readonly string[], def = 0): ParamSpec => ({
  key,
  label,
  min: 0,
  max: choices.length - 1,
  step: 1,
  default: def,
  choices,
});

/** One EQ band: enable, frequency, gain and Q, in the order the strip shows. */
function eqBand(
  prefix: string,
  label: string,
  minHz: number,
  maxHz: number,
  defHz: number,
  defOn: number,
  withGain: boolean,
  defQ: number,
  maxQ: number,
): ParamSpec[] {
  const out: ParamSpec[] = [
    choice(`${prefix}On`, `${label} on`, ON_OFF, defOn),
    freq(`${prefix}Freq`, `${label} freq`, minHz, maxHz, defHz),
  ];
  if (withGain) out.push(decibels(`${prefix}Gain`, `${label} gain`, 18));
  out.push({
    key: `${prefix}Q`,
    label: `${label} Q`,
    min: 0.2,
    max: maxQ,
    step: 0.05,
    default: defQ,
    unit: 'Q',
  });
  return out;
}

function multibandBand(prefix: string, label: string, defThreshold: number): ParamSpec[] {
  return [
    {
      key: `${prefix}Threshold`,
      label: `${label} thresh`,
      min: -60,
      max: 0,
      step: 1,
      default: defThreshold,
      unit: 'dB',
    },
    {
      key: `${prefix}Ratio`,
      label: `${label} ratio`,
      min: 1,
      max: 20,
      step: 0.5,
      default: 3,
      unit: ':1',
    },
    {
      key: `${prefix}Makeup`,
      label: `${label} makeup`,
      min: 0,
      max: 18,
      step: 0.5,
      default: 0,
      unit: 'dB',
    },
  ];
}

export const EFFECT_SPECS: EffectSpec[] = [
  // ------------------------------------------------------------- dynamics
  {
    kind: 'compressor',
    label: 'Compressor',
    blurb: 'Evens out level. Useful on vocals and bass.',
    group: 'dynamics',
    gainReduction: true,
    params: [
      { key: 'threshold', label: 'Threshold', min: -60, max: 0, step: 1, default: -22, unit: 'dB' },
      { key: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.5, default: 4, unit: ':1' },
      { key: 'attack', label: 'Attack', min: 0, max: 200, step: 1, default: 5, unit: 'ms' },
      { key: 'release', label: 'Release', min: 10, max: 1000, step: 5, default: 180, unit: 'ms' },
      { key: 'knee', label: 'Knee', min: 0, max: 40, step: 1, default: 12, unit: 'dB' },
      { key: 'makeupDb', label: 'Makeup', min: 0, max: 24, step: 0.5, default: 0, unit: 'dB' },
    ],
  },
  {
    kind: 'gate',
    label: 'Gate',
    blurb: 'Expander that shuts the channel between phrases. Tightens drums.',
    group: 'dynamics',
    gainReduction: true,
    params: [
      { key: 'threshold', label: 'Threshold', min: -80, max: 0, step: 1, default: -45, unit: 'dB' },
      { key: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.5, default: 8, unit: ':1' },
      {
        key: 'attack',
        label: 'Attack',
        min: 0.1,
        max: 100,
        step: 0.1,
        default: 2,
        unit: 'ms',
        curve: 'log',
      },
      { key: 'hold', label: 'Hold', min: 0, max: 500, step: 1, default: 40, unit: 'ms' },
      { key: 'release', label: 'Release', min: 5, max: 1000, step: 5, default: 150, unit: 'ms' },
      { key: 'range', label: 'Range', min: 0, max: 80, step: 1, default: 45, unit: 'dB' },
    ],
  },
  {
    kind: 'limiter',
    label: 'Limiter',
    blurb: 'Brickwall ceiling with lookahead. Last insert on a bus or the master.',
    group: 'dynamics',
    gainReduction: true,
    params: [
      { key: 'drive', label: 'Drive', min: 0, max: 24, step: 0.5, default: 0, unit: 'dB' },
      { key: 'ceiling', label: 'Ceiling', min: -12, max: 0, step: 0.1, default: -0.3, unit: 'dB' },
      { key: 'release', label: 'Release', min: 5, max: 500, step: 5, default: 80, unit: 'ms' },
      {
        key: 'lookahead',
        label: 'Lookahead',
        min: 0.5,
        max: 10,
        step: 0.5,
        default: 3,
        unit: 'ms',
      },
    ],
  },
  {
    kind: 'multiband',
    label: 'Multiband',
    blurb: 'Three-band compressor on a phase-matched crossover. Bus glue.',
    group: 'dynamics',
    gainReduction: true,
    params: [
      freq('lowSplit', 'Low split', 50, 800, 220),
      freq('highSplit', 'High split', 800, 12000, 3200, 10),
      { key: 'attack', label: 'Attack', min: 0.5, max: 100, step: 0.5, default: 12, unit: 'ms' },
      { key: 'release', label: 'Release', min: 20, max: 800, step: 5, default: 180, unit: 'ms' },
      ...multibandBand('low', 'Low', -26),
      ...multibandBand('mid', 'Mid', -22),
      ...multibandBand('high', 'High', -20),
    ],
  },
  {
    kind: 'deesser',
    label: 'De-esser',
    blurb: 'Compresses only the sibilance band. Tames harsh S sounds.',
    group: 'dynamics',
    gainReduction: true,
    params: [
      freq('freq', 'Frequency', 2000, 14000, 6500, 10),
      { key: 'q', label: 'Width', min: 0.5, max: 12, step: 0.1, default: 3.5, unit: 'Q' },
      { key: 'threshold', label: 'Threshold', min: -60, max: 0, step: 1, default: -28, unit: 'dB' },
      { key: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.5, default: 6, unit: ':1' },
      { key: 'release', label: 'Release', min: 10, max: 400, step: 5, default: 90, unit: 'ms' },
    ],
  },

  // ----------------------------------------------------------------- tone
  {
    kind: 'eq3',
    label: 'EQ',
    blurb: 'Three-band shelving and peaking EQ.',
    group: 'tone',
    params: [
      { key: 'lowDb', label: 'Low', min: -18, max: 18, step: 0.5, default: 0, unit: 'dB' },
      freq('lowFreq', 'Low freq', 40, 500, 160),
      { key: 'midDb', label: 'Mid', min: -18, max: 18, step: 0.5, default: 0, unit: 'dB' },
      freq('midFreq', 'Mid freq', 200, 6000, 1000, 10),
      { key: 'midQ', label: 'Mid Q', min: 0.3, max: 8, step: 0.1, default: 1, unit: 'x' },
      { key: 'highDb', label: 'High', min: -18, max: 18, step: 0.5, default: 0, unit: 'dB' },
      freq('highFreq', 'High freq', 1500, 16000, 6000, 50),
    ],
  },
  {
    kind: 'eq8',
    label: 'EQ8',
    blurb: 'Eight bands: filters, shelves and four parametrics, each switchable.',
    group: 'tone',
    params: [
      ...eqBand('hp', 'HP', 20, 1000, 80, 0, false, 0.71, 4),
      ...eqBand('ls', 'Low shelf', 30, 500, 120, 1, true, 0.71, 4),
      ...eqBand('b1', 'Band 1', 40, 2000, 250, 1, true, 1, 12),
      ...eqBand('b2', 'Band 2', 100, 6000, 900, 1, true, 1, 12),
      ...eqBand('b3', 'Band 3', 300, 12000, 2800, 1, true, 1, 12),
      ...eqBand('b4', 'Band 4', 800, 18000, 7000, 1, true, 1, 12),
      ...eqBand('hs', 'High shelf', 1500, 18000, 8000, 1, true, 0.71, 4),
      ...eqBand('lp', 'LP', 1000, 20000, 18000, 0, false, 0.71, 4),
    ],
  },
  {
    kind: 'filter',
    label: 'Filter',
    blurb: 'Resonant low, band or high pass with input drive.',
    group: 'tone',
    params: [
      choice('mode', 'Mode', ['Low pass', 'Band pass', 'High pass']),
      freq('cutoff', 'Cutoff', 20, 20000, 1200, 10),
      {
        key: 'resonance',
        label: 'Resonance',
        min: 0.5,
        max: 20,
        step: 0.1,
        default: 1.2,
        unit: 'Q',
      },
      { key: 'drive', label: 'Drive', min: 0, max: 24, step: 0.5, default: 0, unit: 'dB' },
    ],
  },
  {
    kind: 'saturator',
    label: 'Saturator',
    blurb: 'Tube, tape or transistor colour. Adds harmonics without obvious distortion.',
    group: 'tone',
    params: [
      choice('model', 'Model', ['Tube', 'Tape', 'Transistor']),
      { key: 'drive', label: 'Drive', min: 0, max: 36, step: 0.5, default: 8, unit: 'dB' },
      { key: 'output', label: 'Output', min: -24, max: 12, step: 0.5, default: 0, unit: 'dB' },
      percent('mix', 'Mix', 1),
    ],
  },
  {
    kind: 'distortion',
    label: 'Distortion',
    blurb: 'Hard clipping with a two-band tone stack.',
    group: 'tone',
    params: [
      { key: 'drive', label: 'Drive', min: 0, max: 48, step: 0.5, default: 18, unit: 'dB' },
      { key: 'hardness', label: 'Hardness', min: 1, max: 12, step: 0.5, default: 8, unit: 'x' },
      decibels('bass', 'Bass', 18),
      decibels('treble', 'Treble', 18),
      { key: 'output', label: 'Output', min: -24, max: 12, step: 0.5, default: -6, unit: 'dB' },
      percent('mix', 'Mix', 1),
    ],
  },
  {
    kind: 'ampsim',
    label: 'Amp Sim',
    blurb: 'Preamp, tone stack and a synthesised speaker cabinet.',
    group: 'tone',
    params: [
      choice('model', 'Amp', ['Clean', 'Crunch', 'Lead', 'Bass'], 1),
      { key: 'gain', label: 'Gain', min: 0, max: 40, step: 0.5, default: 16, unit: 'dB' },
      decibels('bass', 'Bass', 12),
      decibels('mid', 'Mid', 12),
      decibels('treble', 'Treble', 12),
      decibels('presence', 'Presence', 12, 2),
      choice('cab', 'Cabinet', CAB_CHOICES),
      { key: 'output', label: 'Output', min: -24, max: 12, step: 0.5, default: -6, unit: 'dB' },
    ],
  },
  {
    kind: 'bitcrusher',
    label: 'Bitcrusher',
    blurb: 'Bit-depth and sample-rate reduction. Lo-fi grit.',
    group: 'tone',
    params: [
      { key: 'bits', label: 'Bit depth', min: 1, max: 12, step: 1, default: 8, unit: 'bit' },
      choice('downsample', 'Rate divide', CRUSH_CHOICES, 2),
      percent('mix', 'Mix', 1),
    ],
  },

  // ----------------------------------------------------------- modulation
  {
    kind: 'chorus',
    label: 'Chorus',
    blurb: 'Two detuned voices spread across the stereo field. Thickens anything.',
    group: 'modulation',
    params: [
      {
        key: 'rate',
        label: 'Rate',
        min: 0.05,
        max: 8,
        step: 0.01,
        default: 0.6,
        unit: 'Hz',
        curve: 'log',
      },
      { key: 'depth', label: 'Depth', min: 0, max: 12, step: 0.1, default: 4, unit: 'ms' },
      { key: 'delay', label: 'Delay', min: 2, max: 30, step: 0.5, default: 12, unit: 'ms' },
      percent('spread', 'Spread', 0.7),
      percent('mix', 'Mix', 0.4),
    ],
  },
  {
    kind: 'flanger',
    label: 'Flanger',
    blurb: 'Swept short delay with feedback. Through-zero adds the jet-plane null.',
    group: 'modulation',
    params: [
      {
        key: 'rate',
        label: 'Rate',
        min: 0.02,
        max: 6,
        step: 0.01,
        default: 0.25,
        unit: 'Hz',
        curve: 'log',
      },
      { key: 'depth', label: 'Depth', min: 0, max: 8, step: 0.1, default: 3, unit: 'ms' },
      { key: 'delay', label: 'Delay', min: 0.2, max: 12, step: 0.1, default: 2, unit: 'ms' },
      {
        key: 'feedback',
        label: 'Feedback',
        min: -0.9,
        max: 0.9,
        step: 0.01,
        default: 0.5,
        unit: '%',
      },
      choice('throughZero', 'Through zero', ON_OFF),
      percent('mix', 'Mix', 0.45),
    ],
  },
  {
    kind: 'phaser',
    label: 'Phaser',
    blurb: 'Four to twelve swept allpass stages. Notches that move.',
    group: 'modulation',
    params: [
      {
        key: 'rate',
        label: 'Rate',
        min: 0.02,
        max: 8,
        step: 0.01,
        default: 0.4,
        unit: 'Hz',
        curve: 'log',
      },
      percent('depth', 'Depth', 0.7),
      { key: 'stages', label: 'Stages', min: 4, max: 12, step: 2, default: 6, unit: 'stages' },
      freq('centre', 'Centre', 100, 4000, 700, 10),
      percent('feedback', 'Feedback', 0.4, 0.9),
      percent('mix', 'Mix', 0.5),
    ],
  },
  {
    kind: 'tremolo',
    label: 'Tremolo',
    blurb: 'Level modulation, free-running or locked to the project tempo.',
    group: 'modulation',
    params: [
      choice('sync', 'Tempo sync', ON_OFF),
      {
        key: 'rate',
        label: 'Rate',
        min: 0.1,
        max: 20,
        step: 0.1,
        default: 5,
        unit: 'Hz',
        curve: 'log',
      },
      { key: 'division', label: 'Division', min: 1, max: 16, step: 1, default: 4, unit: 'div' },
      choice('modifier', 'Feel', SYNC_CHOICES),
      percent('depth', 'Depth', 0.6),
      choice('shape', 'Shape', LFO_SHAPES),
      {
        key: 'stereoPhase',
        label: 'Stereo phase',
        min: 0,
        max: 180,
        step: 1,
        default: 0,
        unit: '°',
      },
    ],
  },
  {
    kind: 'rotary',
    label: 'Rotary',
    blurb: 'Two-speed rotor and horn with a crossover, doppler and mic spread.',
    group: 'modulation',
    params: [
      choice('speed', 'Speed', ['Slow', 'Fast']),
      {
        key: 'slowRate',
        label: 'Slow rate',
        min: 0.2,
        max: 2,
        step: 0.05,
        default: 0.8,
        unit: 'Hz',
      },
      { key: 'fastRate', label: 'Fast rate', min: 2, max: 10, step: 0.1, default: 6.5, unit: 'Hz' },
      freq('crossover', 'Crossover', 400, 2000, 800, 10),
      percent('hornDepth', 'Horn depth', 0.8),
      percent('drumDepth', 'Drum depth', 0.6),
      percent('spread', 'Mic spread', 0.7),
      percent('mix', 'Mix', 1),
    ],
  },

  // ----------------------------------------------------------------- time
  {
    kind: 'delay',
    label: 'Delay',
    blurb: 'Tempo-synced echo with feedback.',
    group: 'time',
    params: [
      // Expressed in sixteenths so it follows the project tempo.
      { key: 'timeSixteenths', label: 'Time', min: 1, max: 16, step: 1, default: 6, unit: 'x' },
      {
        key: 'feedback',
        label: 'Feedback',
        min: 0,
        max: 0.9,
        step: 0.01,
        default: 0.32,
        unit: '%',
      },
      freq('tone', 'Tone', 500, 16000, 4200, 100),
      percent('mix', 'Mix', 0.25),
    ],
  },
  {
    kind: 'pingpong',
    label: 'Ping-Pong',
    blurb: 'Tempo-synced echo that alternates left and right, filtered in the loop.',
    group: 'time',
    params: [
      { key: 'timeSixteenths', label: 'Time', min: 1, max: 16, step: 1, default: 3, unit: 'div' },
      choice('modifier', 'Feel', SYNC_CHOICES),
      {
        key: 'feedback',
        label: 'Feedback',
        min: 0,
        max: 0.9,
        step: 0.01,
        default: 0.35,
        unit: '%',
      },
      freq('lowCut', 'Low cut', 20, 2000, 180),
      freq('highCut', 'High cut', 500, 18000, 6000, 50),
      percent('width', 'Width', 1),
      percent('mix', 'Mix', 0.3),
    ],
  },
  {
    kind: 'reverb',
    label: 'Reverb',
    blurb: 'Synthesised room. Best used on a bus via a send.',
    group: 'time',
    params: [
      { key: 'size', label: 'Size', min: 0.2, max: 6, step: 0.1, default: 1.8, unit: 's' },
      freq('damping', 'Damping', 800, 16000, 5200, 100),
      { key: 'predelay', label: 'Pre-delay', min: 0, max: 120, step: 1, default: 18, unit: 'ms' },
      percent('mix', 'Mix', 0.3),
    ],
  },

  // --------------------------------------------------------------- stereo
  {
    kind: 'width',
    label: 'Stereo Width',
    blurb: 'Mid/side width with the bass kept mono below a chosen frequency.',
    group: 'stereo',
    params: [
      { key: 'width', label: 'Width', min: 0, max: 2, step: 0.01, default: 1, unit: 'x' },
      freq('bassMono', 'Bass mono', 20, 500, 20),
      decibels('output', 'Output', 12),
    ],
  },
  {
    kind: 'autopan',
    label: 'Auto Pan',
    blurb: 'Sweeps the image left to right, free-running or tempo-locked.',
    group: 'stereo',
    params: [
      choice('sync', 'Tempo sync', ON_OFF),
      {
        key: 'rate',
        label: 'Rate',
        min: 0.05,
        max: 10,
        step: 0.01,
        default: 0.8,
        unit: 'Hz',
        curve: 'log',
      },
      { key: 'division', label: 'Division', min: 1, max: 16, step: 1, default: 8, unit: 'div' },
      choice('modifier', 'Feel', SYNC_CHOICES),
      percent('depth', 'Depth', 0.8),
      choice('shape', 'Shape', LFO_SHAPES),
    ],
  },

  // -------------------------------------------------------------- utility
  {
    kind: 'trim',
    label: 'Gain',
    blurb: 'Level trim before the rest of the chain.',
    group: 'utility',
    params: [
      { key: 'gainDb', label: 'Gain', min: -24, max: 24, step: 0.5, default: 0, unit: 'dB' },
    ],
  },
  {
    kind: 'gainMatch',
    label: 'Gain Match',
    blurb: 'Measured trim so an A/B compares tone, not loudness.',
    group: 'utility',
    params: [
      { key: 'trim', label: 'Trim', min: -24, max: 24, step: 0.1, default: 0, unit: 'dB' },
      { key: 'target', label: 'Target', min: -36, max: -6, step: 0.5, default: -18, unit: 'dB' },
    ],
  },
  {
    kind: 'analyser',
    label: 'Analyser',
    blurb: 'Spectrum and scope tap. Passes audio through untouched.',
    group: 'utility',
    params: [
      choice('resolution', 'Resolution', ANALYSER_CHOICES, 2),
      {
        key: 'smoothing',
        label: 'Smoothing',
        min: 0,
        max: 0.95,
        step: 0.01,
        default: 0.8,
        unit: '%',
      },
    ],
  },
  {
    kind: 'tuner',
    label: 'Tuner',
    blurb: 'Pitch readout. Passes audio through untouched.',
    group: 'utility',
    params: [
      {
        key: 'reference',
        label: 'Reference',
        min: 415,
        max: 465,
        step: 0.5,
        default: 440,
        unit: 'Hz',
      },
    ],
  },
  {
    kind: 'vocaltune',
    label: 'Vocal Tune',
    blurb: 'Settings for offline pitch correction. As an insert it only passes audio.',
    group: 'utility',
    params: [
      percent('strength', 'Strength', 0.8),
      { key: 'speed', label: 'Speed', min: 1, max: 200, step: 1, default: 25, unit: 'ms' },
      { key: 'formant', label: 'Formant', min: -12, max: 12, step: 0.5, default: 0, unit: 'st' },
      choice('scale', 'Scale', ['Chromatic', 'Major', 'Minor']),
    ],
  },
];

/**
 * Band layout of the eight-band EQ, in signal order. The audio builder and the
 * response plot both read it, so a band cannot exist in one and not the other.
 */
export const EQ8_BANDS: readonly {
  prefix: string;
  /** Short name for the band's handle on the curve display. */
  label: string;
  type: BiquadType;
  hasGain: boolean;
}[] = [
  { prefix: 'hp', label: 'HP', type: 'highpass', hasGain: false },
  { prefix: 'ls', label: 'Low', type: 'lowshelf', hasGain: true },
  { prefix: 'b1', label: 'B1', type: 'peaking', hasGain: true },
  { prefix: 'b2', label: 'B2', type: 'peaking', hasGain: true },
  { prefix: 'b3', label: 'B3', type: 'peaking', hasGain: true },
  { prefix: 'b4', label: 'B4', type: 'peaking', hasGain: true },
  { prefix: 'hs', label: 'High', type: 'highshelf', hasGain: true },
  { prefix: 'lp', label: 'LP', type: 'lowpass', hasGain: false },
];

/**
 * The eight-band EQ's current settings in the form `eqMagnitudeResponse` wants,
 * so the UI can draw the curve the audio graph is actually producing.
 */
export function eq8Bands(effect: Effect): EqBandSpec[] {
  return EQ8_BANDS.map((b) => ({
    type: b.type,
    freqHz: paramOf(effect, `${b.prefix}Freq`),
    q: paramOf(effect, `${b.prefix}Q`),
    gainDb: b.hasGain ? paramOf(effect, `${b.prefix}Gain`) : 0,
    enabled: choiceOf(effect, `${b.prefix}On`) === 1,
  }));
}

// ------------------------------------------------------------ dynamics laws

/**
 * The part of a dynamics processor's law that is its design rather than its
 * controls. A limiter is 20:1 at its ceiling and a de-esser has a 6 dB knee
 * whatever the musician does, so those numbers are not parameters — but they
 * are still the sound, and both the audio builder and the plugin face have to
 * read the same ones. Written once here, they cannot be re-typed differently
 * in two files.
 */
export const LIMITER_RATIO = 20;
export const LIMITER_KNEE_DB = 2;
export const DEESSER_KNEE_DB = 6;

/**
 * The static gain law one dynamics processor imposes: envelope in, gain out.
 *
 * Its whole reason for existing is that a face used to work the other way
 * round — it read `threshold`, `ratio` and `knee` off whatever effect it was
 * given and drew a compressor from them. The limiter declares none of those
 * three, so all three read back as zero and the face drew a straight 1:1 line
 * for a processor that is 20:1 at its ceiling; the de-esser drew a knee of 0
 * for audio with a knee of 6. Now an effect is asked what its law is, the
 * builder fills its shaper from that answer and the face plots the same
 * answer, so a picture that does not match the processor is not expressible.
 */
export type DynamicsLaw =
  | { law: 'compress'; thresholdDb: number; ratio: number; kneeDb: number }
  | { law: 'expand'; thresholdDb: number; ratio: number; rangeDb: number };

/**
 * The law of one effect, or null for a processor that has no single static one
 * — which today is only the multiband, whose three bands each have their own
 * and are native compressor nodes rather than a curve we fill.
 */
export function dynamicsLawOf(effect: Effect): DynamicsLaw | null {
  switch (effect.kind) {
    case 'compressor':
      return {
        law: 'compress',
        thresholdDb: paramOf(effect, 'threshold'),
        ratio: paramOf(effect, 'ratio'),
        kneeDb: paramOf(effect, 'knee'),
      };
    case 'gate':
      return {
        law: 'expand',
        thresholdDb: paramOf(effect, 'threshold'),
        ratio: paramOf(effect, 'ratio'),
        rangeDb: paramOf(effect, 'range'),
      };
    case 'limiter':
      // The ceiling is this processor's threshold; the ratio and knee that
      // hold the level there are fixed by its design.
      return {
        law: 'compress',
        thresholdDb: paramOf(effect, 'ceiling'),
        ratio: LIMITER_RATIO,
        kneeDb: LIMITER_KNEE_DB,
      };
    case 'deesser':
      return {
        law: 'compress',
        thresholdDb: paramOf(effect, 'threshold'),
        ratio: paramOf(effect, 'ratio'),
        kneeDb: DEESSER_KNEE_DB,
      };
    default:
      return null;
  }
}

/** Linear envelope in, linear gain out. The one evaluation of any law. */
export function dynamicsGain(law: DynamicsLaw, envelope: number): number {
  return law.law === 'expand'
    ? expanderGain(envelope, law.thresholdDb, law.ratio, law.rangeDb)
    : compressorGain(envelope, law.thresholdDb, law.ratio, law.kneeDb);
}

/** The same law as a WaveShaper curve, sampled through the same evaluation. */
export function dynamicsCurve(law: DynamicsLaw): Float32Array {
  return transferCurve((envelope) => dynamicsGain(law, envelope));
}

/**
 * The values a curve is built from, as a string. A WaveShaper curve is swapped
 * in one block rather than ramped, so it is rebuilt only when the law moves —
 * and never for the ballistics a musician sweeps while listening.
 */
export function dynamicsCurveKey(law: DynamicsLaw): string {
  return law.law === 'expand'
    ? `expand/${law.thresholdDb}/${law.ratio}/${law.rangeDb}`
    : `compress/${law.thresholdDb}/${law.ratio}/${law.kneeDb}`;
}

/**
 * Preamp voicings: how hard an amp model drives its front end before the tone
 * stack. The audio fills its shaper from this and the face draws from it too,
 * so a model that sounds harder looks harder.
 */
export const AMP_MODELS: readonly { model: SaturationModel; driveDb: number }[] = [
  { model: 'tube', driveDb: 2 },
  { model: 'transistor', driveDb: 8 },
  { model: 'transistor', driveDb: 16 },
  { model: 'tape', driveDb: 4 },
];

/**
 * The transfer curve of a waveshaping effect — the array its own shaper is
 * filled with, so a face drawing this is drawing the processor.
 *
 * Every one of these faces used to read `model` and `drive` whatever the
 * effect was: the bitcrusher drew a tube curve for a quantiser, the amp sim
 * drew drive 0 for a parameter it calls `gain`, and the distortion drew a
 * saturation curve for audio that is a clipper. Returns null for a kind whose
 * shape is not a static curve.
 */
export function shaperCurveKey(effect: Effect): string {
  switch (effect.kind) {
    case 'saturator':
      return `sat/${choiceOf(effect, 'model')}/${paramOf(effect, 'drive')}`;
    case 'distortion':
      return `clip/${paramOf(effect, 'drive')}/${paramOf(effect, 'hardness')}`;
    case 'ampsim':
      return `amp/${choiceOf(effect, 'model')}`;
    case 'bitcrusher':
      return `bits/${paramOf(effect, 'bits')}`;
    default:
      return '';
  }
}

export function shaperCurveOf(effect: Effect): Float32Array | null {
  switch (effect.kind) {
    case 'saturator':
      return saturationCurve(
        SATURATION_MODELS[choiceOf(effect, 'model')] ?? 'tube',
        paramOf(effect, 'drive'),
      );
    case 'distortion':
      return clipCurve(paramOf(effect, 'drive'), paramOf(effect, 'hardness'));
    case 'ampsim': {
      const voice = AMP_MODELS[choiceOf(effect, 'model')] ?? AMP_MODELS[0];
      return saturationCurve(voice.model, voice.driveDb);
    }
    case 'bitcrusher':
      return quantiserCurve(paramOf(effect, 'bits'));
    default:
      return null;
  }
}

/**
 * The de-esser's sibilance band, in the form a response plot wants. The audio
 * sets its bandpass from this and the face draws the same band, so the picture
 * cannot claim a processor is working somewhere it is not.
 */
export function deesserBand(effect: Effect): EqBandSpec {
  return {
    type: 'bandpass',
    freqHz: paramOf(effect, 'freq'),
    q: paramOf(effect, 'q'),
    gainDb: 0,
    enabled: true,
  };
}

/**
 * The multiband's two crossover points, with the guard the audio applies: a
 * high split dragged below the low one would turn the mid band inside out, so
 * it is held 20 % above it. The face reads this rather than the raw parameter,
 * because a split drawn where the audio did not put it is the same lie as a
 * curve drawn from a law the audio does not use.
 */
export function multibandSplits(effect: Effect): { lowHz: number; highHz: number } {
  const lowHz = paramOf(effect, 'lowSplit');
  return { lowHz, highHz: Math.max(paramOf(effect, 'highSplit'), lowHz * 1.2) };
}

const BY_KIND = new Map(EFFECT_SPECS.map((s) => [s.kind, s]));

export function effectSpec(kind: EffectKind): EffectSpec | undefined {
  return BY_KIND.get(kind);
}

export function isKnownEffect(kind: string): kind is EffectKind {
  return BY_KIND.has(kind as EffectKind);
}

/** Specs in one picker category, in declaration order. */
export function effectsInGroup(group: EffectGroup): EffectSpec[] {
  return EFFECT_SPECS.filter((s) => s.group === group);
}

export function defaultParams(kind: EffectKind): Record<string, number> {
  const spec = BY_KIND.get(kind);
  if (!spec) return {};
  return Object.fromEntries(spec.params.map((p) => [p.key, p.default]));
}

/** Clamp to spec range and fill in anything missing. Never throws on bad data. */
export function normaliseParams(
  kind: EffectKind,
  params: Record<string, unknown> | undefined,
): Record<string, number> {
  const spec = BY_KIND.get(kind);
  if (!spec) return {};
  const out: Record<string, number> = {};
  for (const p of spec.params) {
    const raw = params?.[p.key];
    const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : p.default;
    const clamped = Math.min(p.max, Math.max(p.min, n));
    // A choice is an index: a fractional value would name no setting at all.
    out[p.key] = p.choices ? Math.round(clamped) : clamped;
  }
  return out;
}

/** Read a parameter with the spec default as the fallback. */
export function paramOf(effect: Effect, key: string): number {
  const v = effect.params[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const spec = BY_KIND.get(effect.kind);
  return spec?.params.find((p) => p.key === key)?.default ?? 0;
}

/** Read a choice parameter as its index, clamped to the list. */
export function choiceOf(effect: Effect, key: string): number {
  const spec = BY_KIND.get(effect.kind);
  const p = spec?.params.find((x) => x.key === key);
  const raw = Math.round(paramOf(effect, key));
  if (!p?.choices) return raw;
  return Math.min(p.choices.length - 1, Math.max(0, raw));
}

/** Name of the current setting of a choice parameter, for summaries. */
export function choiceName(effect: Effect, key: string): string {
  const spec = BY_KIND.get(effect.kind);
  const p = spec?.params.find((x) => x.key === key);
  return p?.choices?.[choiceOf(effect, key)] ?? '';
}

/** A frequency the way this product writes it: 440 Hz, 6.5 kHz, 12 kHz. */
export function formatHz(value: number): string {
  return value >= 1000
    ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} kHz`
    : `${Math.round(value)} Hz`;
}

export function formatParam(spec: ParamSpec, value: number): string {
  if (spec.choices) {
    const i = Math.min(spec.choices.length - 1, Math.max(0, Math.round(value)));
    return spec.choices[i];
  }
  switch (spec.unit) {
    case 'dB':
      return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
    case 'Hz':
      return formatHz(value);
    case 'ms':
      return value < 10 ? `${value.toFixed(1)} ms` : `${Math.round(value)} ms`;
    case 's':
      return `${value.toFixed(1)} s`;
    case '%':
      return `${Math.round(value * 100)}%`;
    case ':1':
      return `${value.toFixed(1)}:1`;
    case 'Q':
      return `Q ${value.toFixed(2)}`;
    case 'bit':
      return `${Math.round(value)} bit`;
    case 'stages':
      return `${Math.round(value)} stages`;
    case 'div':
      return describeDivision(value, 'straight');
    case '°':
      return `${Math.round(value)}°`;
    case 'st':
      return `${value > 0 ? '+' : ''}${value.toFixed(1)} st`;
    case 'x':
      return value.toFixed(1);
    default:
      return value.toFixed(2);
  }
}

function signed(value: number, digits = 0): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function mixText(effect: Effect): string {
  return `${Math.round(paramOf(effect, 'mix') * 100)}%`;
}

function divisionText(effect: Effect, key: string): string {
  return describeDivision(paramOf(effect, key), syncModifierByIndex(choiceOf(effect, 'modifier')));
}

/** Short one-line summary shown on a collapsed insert slot. */
export function describeEffect(effect: Effect): string {
  switch (effect.kind) {
    case 'trim':
      return `${signed(paramOf(effect, 'gainDb'), 1)} dB`;
    case 'compressor':
      return `${paramOf(effect, 'threshold').toFixed(0)} dB, ${paramOf(effect, 'ratio').toFixed(1)}:1`;
    case 'gate':
      return `${paramOf(effect, 'threshold').toFixed(0)} dB · −${paramOf(effect, 'range').toFixed(0)} dB`;
    case 'limiter':
      return `ceiling ${paramOf(effect, 'ceiling').toFixed(1)} dB`;
    case 'multiband': {
      const { lowHz, highHz } = multibandSplits(effect);
      return `${Math.round(lowHz)} / ${Math.round(highHz)} Hz`;
    }
    case 'deesser':
      return `${(paramOf(effect, 'freq') / 1000).toFixed(1)} kHz · ${paramOf(effect, 'ratio').toFixed(1)}:1`;
    case 'eq3':
      return ['lowDb', 'midDb', 'highDb'].map((k) => signed(paramOf(effect, k))).join(' / ');
    case 'eq8': {
      const on = ['hp', 'ls', 'b1', 'b2', 'b3', 'b4', 'hs', 'lp'].filter(
        (p) => choiceOf(effect, `${p}On`) === 1,
      ).length;
      return `${on} of 8 bands`;
    }
    case 'filter':
      return `${choiceName(effect, 'mode')} · ${formatParam(
        { key: 'cutoff', label: '', min: 20, max: 20000, step: 1, default: 0, unit: 'Hz' },
        paramOf(effect, 'cutoff'),
      )}`;
    case 'saturator':
      return `${choiceName(effect, 'model')} · ${paramOf(effect, 'drive').toFixed(0)} dB`;
    case 'distortion':
      return `${paramOf(effect, 'drive').toFixed(0)} dB · ${mixText(effect)}`;
    case 'ampsim':
      return `${choiceName(effect, 'model')} · ${choiceName(effect, 'cab')}`;
    case 'bitcrusher':
      return `${Math.round(paramOf(effect, 'bits'))} bit · ${choiceName(effect, 'downsample')}`;
    case 'chorus':
    case 'flanger':
    case 'phaser':
      return `${paramOf(effect, 'rate').toFixed(2)} Hz · ${mixText(effect)}`;
    case 'tremolo':
    case 'autopan': {
      const rate =
        choiceOf(effect, 'sync') === 1
          ? divisionText(effect, 'division')
          : `${paramOf(effect, 'rate').toFixed(2)} Hz`;
      return `${rate} · ${Math.round(paramOf(effect, 'depth') * 100)}%`;
    }
    case 'rotary':
      return `${choiceName(effect, 'speed')} · ${mixText(effect)}`;
    case 'delay':
      return `1/${Math.max(1, Math.round(16 / paramOf(effect, 'timeSixteenths')))} · ${mixText(effect)}`;
    case 'pingpong':
      return `${divisionText(effect, 'timeSixteenths')} · ${mixText(effect)}`;
    case 'reverb':
      return `${paramOf(effect, 'size').toFixed(1)}s · ${mixText(effect)}`;
    case 'width':
      return `${Math.round(paramOf(effect, 'width') * 100)}% · mono < ${Math.round(paramOf(effect, 'bassMono'))} Hz`;
    case 'gainMatch':
      return `${signed(paramOf(effect, 'trim'), 1)} dB`;
    case 'analyser':
      return `${choiceName(effect, 'resolution')} pt`;
    case 'tuner':
      return `A = ${paramOf(effect, 'reference').toFixed(1)} Hz`;
    case 'vocaltune':
      return `${Math.round(paramOf(effect, 'strength') * 100)}% · offline`;
  }
}

/**
 * Insert slots per channel. Twelve is enough for a full channel strip —
 * gate, EQ, compressor, de-esser, colour, modulation, delay, limiter — with
 * room left to experiment before a bus is the better answer.
 */
export const MAX_INSERTS = 12;
