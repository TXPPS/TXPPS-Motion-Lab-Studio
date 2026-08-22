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
  syncSeconds,
  transferCurve,
  syncHz,
  dbToGain,
} from '../audio/dsp/curves';
import type { BiquadType, EqBandSpec, SaturationModel } from '../audio/dsp/curves';
import { KEY_NAMES, SCALES } from './scales';
import type { Effect, EffectKind } from './types';
import type { TuneOptions } from './vocalTune';

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
  /**
   * Show this one on the closed device in the console.
   *
   * A device slot that is only a label makes you open a window to move a
   * threshold. Three or four parameters on the closed slot is what a
   * professional console gives you, and it is the difference between a rack
   * you read and a rack you use. Unflagged, the first three are taken.
   */
  micro?: boolean;
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

/**
 * Phase relationships a two-channel modulator can hold exactly, in degrees.
 *
 * A quadrature pair gives 0° and 90°, and inverting one of them gives 180°;
 * anything else would need a control-rate delay whose length depends on the
 * rate, and would stop being exact the moment the waveform is not a sine. The
 * tremolo builds its right channel by crossfading between those three, so this
 * is the whole of what its stereo phase control can ask for.
 */
export const STEREO_PHASES = [0, 90, 180] as const;
const STEREO_PHASE_CHOICES = STEREO_PHASES.map((deg) => `${deg}°`);

/**
 * The bottom of Stereo Width's mono-bass range, where the filter is off rather
 * than merely low.
 *
 * A highpass at 20 Hz is not nothing — it still turns the phase across the
 * bottom octave and takes a little out of the very lowest of it — so a control
 * whose minimum reads as "off" has to actually switch the filter out of
 * circuit. Named because the parameter's minimum, the builder's off test and
 * the face's off test are the same number and have to move together.
 */
export const BASS_MONO_OFF_HZ = 20;

/**
 * Whether Stereo Width's mono-bass filter is in circuit at a given setting.
 *
 * One function so the builder that switches the filter and the face that draws
 * the line cannot answer differently — which is how the picture came to say
 * "off" for a filter the side channel was still passing through.
 */
export function bassMonoActive(hz: number): boolean {
  return hz > BASS_MONO_OFF_HZ;
}

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

/** The scales Vocal Tune snaps to — the product's own list, in its own order. */
export const TUNE_SCALE_IDS: readonly string[] = SCALES.map((s) => s.id);
const TUNE_SCALE_LABELS: readonly string[] = SCALES.map((s) => s.label);

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

/**
 * One EQ band: enable, frequency, gain and Q, in the order the strip shows.
 *
 * The Q is optional because two of the eight bands genuinely have none. A
 * `BiquadFilterNode` set to `lowshelf` or `highshelf` ignores its `Q` — Web
 * Audio fixes the shelf slope at S = 1 — and `biquadCoefficients` builds those
 * two from `aS` for exactly that reason, so the response drawn ignores it too.
 * The shelves used to declare one anyway: a knob labelled "Low shelf Q",
 * formatted `Q 0.71`, automatable like every other parameter, whose value was
 * written to a node field the platform discards. Omitting the argument is what
 * makes "this band has no quality factor" a fact of the declaration rather than
 * a comment nobody reads.
 */
function eqBand(
  prefix: string,
  label: string,
  minHz: number,
  maxHz: number,
  defHz: number,
  defOn: number,
  withGain: boolean,
  q?: { default: number; max: number },
): ParamSpec[] {
  const out: ParamSpec[] = [
    choice(`${prefix}On`, `${label} on`, ON_OFF, defOn),
    freq(`${prefix}Freq`, `${label} freq`, minHz, maxHz, defHz),
  ];
  if (withGain) out.push(decibels(`${prefix}Gain`, `${label} gain`, 18));
  if (q) {
    out.push({
      key: `${prefix}Q`,
      label: `${label} Q`,
      min: 0.2,
      max: q.max,
      step: 0.05,
      default: q.default,
      unit: 'Q',
    });
  }
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
      { key: 'midQ', label: 'Mid Q', min: 0.3, max: 8, step: 0.1, default: 1, unit: 'Q' },
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
      ...eqBand('hp', 'HP', 20, 1000, 80, 0, false, { default: 0.71, max: 4 }),
      ...eqBand('ls', 'Low shelf', 30, 500, 120, 1, true),
      ...eqBand('b1', 'Band 1', 40, 2000, 250, 1, true, { default: 1, max: 12 }),
      ...eqBand('b2', 'Band 2', 100, 6000, 900, 1, true, { default: 1, max: 12 }),
      ...eqBand('b3', 'Band 3', 300, 12000, 2800, 1, true, { default: 1, max: 12 }),
      ...eqBand('b4', 'Band 4', 800, 18000, 7000, 1, true, { default: 1, max: 12 }),
      ...eqBand('hs', 'High shelf', 1500, 18000, 8000, 1, true),
      ...eqBand('lp', 'LP', 1000, 20000, 18000, 0, false, { default: 0.71, max: 4 }),
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
      // Not a pure blend at intermediate settings, and this is the honest place
      // to say so. The shaper runs `oversample: '4x'`, whose up- and
      // down-sampling filters delay the wet path by an amount the specification
      // does not state and every browser is free to choose, while the dry leg
      // is a wire — so the two comb slightly wherever both are audible. The
      // bitcrusher's lag is arithmetic and is compensated exactly
      // (`crusherGroupDelaySamples`); this one could only be guessed at, and a
      // wrong compensation would move the null instead of removing it. The
      // extremes are exact: at 0 % and 100 % only one leg is live.
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
      // Combs a little between the extremes, for the reason set out on the
      // saturator's Mix: this clipper is a `'4x'` shaper too, and its dry leg
      // carries no matching delay because the browser does not say what to
      // match. The tone stack behind it turns the wet phase as well, but that
      // is a shelf being a shelf — it is the sound the Bass and Treble controls
      // are for, not a latency anything should try to cancel.
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
      // A switch, because that is what the audio is. This was declared 0-180°
      // in 1° steps — 181 settings — in front of a builder that snapped every
      // one of them to the nearest of 0, 90 and 180, so everything between 46°
      // and 134° was the same sound and the knob was a picture of a control
      // that did not exist. The key changed with it: an index of 1 means 90°
      // here and meant 1° under `stereoPhase`, and `normaliseParams` cannot
      // tell a stored degree from a stored index without one of them being new.
      choice('phaseOffset', 'Stereo phase', STEREO_PHASE_CHOICES),
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
      { key: 'timeSixteenths', label: 'Time', min: 1, max: 16, step: 1, default: 6, unit: 'div' },
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
      freq('bassMono', 'Bass mono', BASS_MONO_OFF_HZ, 500, BASS_MONO_OFF_HZ),
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
      // The blurb promised both and the face only ever drew the spectrum.
      choice('view', 'View', ['Spectrum', 'Scope']),
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
    // The device is where a track's pitch correction is *set*; the audio editor
    // is where it is applied, to a take, offline. Nothing here colours the live
    // signal — a real-time retune is not something this build does, and a
    // device that quietly did nothing to the audio while looking like it did
    // would be worse than one that says so.
    label: 'Vocal Tune',
    blurb: 'Pitch-correction settings for this track. Retunes a take in the audio editor.',
    group: 'utility',
    params: [
      percent('strength', 'Strength', 0.8),
      // 0 ms is the hard, obviously-processed snap; the old floor of 1 ms put
      // that sound out of reach for no reason.
      { key: 'speed', label: 'Speed', min: 0, max: 200, step: 1, default: 25, unit: 'ms' },
      percent('humanise', 'Humanise', 0.6),
      choice('scale', 'Scale', TUNE_SCALE_LABELS, TUNE_SCALE_IDS.indexOf('major')),
      choice('key', 'Key', KEY_NAMES),
      // Was a ±12 semitone formant shift that nothing implemented. The
      // stretcher does have formant *preservation*, so this is now the control
      // for the thing that exists rather than a knob for the thing that does not.
      choice('formant', 'Formant', ['Shift with pitch', 'Preserve'], 1),
    ],
  },
];

/**
 * The input level at which a law reduces by a given amount.
 *
 * A gain-reduction meter says how much is being taken off; it does not say
 * *where*, and where is the question a transfer plot exists to answer. Every
 * law here is monotonic in the input, so the level can be recovered from the
 * reduction by bisection — but not always in the same direction: a compressor
 * reduces more as the input rises and a gate reduces more as it falls, so the
 * search takes its direction from the window's own ends rather than assuming
 * the compressor's.
 *
 * Returns null when the answer is not knowable: no reduction at all (below a
 * compressor's threshold every input gives the same answer), or a reduction
 * larger than anything inside the window, where a dot would be claiming to
 * know a level that is off the plot.
 */
export function inputDbForReduction(
  law: DynamicsLaw,
  reductionDb: number,
  floorDb: number,
  ceilingDb: number,
): number | null {
  const wanted = -Math.abs(reductionDb);
  if (wanted > -0.05) return null;
  const reductionAt = (db: number): number => {
    const gain = dynamicsGain(law, dbToGain(db));
    return 20 * Math.log10(Math.max(gain, 1e-6));
  };
  const atFloor = reductionAt(floorDb);
  const atCeiling = reductionAt(ceilingDb);
  // Which end reduces harder decides which way the bisection walks.
  const risingReduces = atCeiling < atFloor;
  if (wanted < Math.min(atFloor, atCeiling)) return null;
  if (wanted > Math.max(atFloor, atCeiling)) return null;
  let lo = floorDb;
  let hi = ceilingDb;
  // Twenty-four halvings of a 72 dB window resolve to well under a hundredth
  // of a decibel, which is finer than the plot can draw.
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const here = reductionAt(mid);
    if (risingReduces ? here > wanted : here < wanted) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** What a modulation device's LFO is actually doing. */
export interface ModulationField {
  /** Index into the three shapes `ShapedLfo` can build. */
  shape: number;
  /**
   * How much of the sweep available to this processor the setting uses, 0..1.
   *
   * Not the parameter: chorus and flanger declare depth in *milliseconds* and
   * the audio clamps it to the base delay, so a device set to 6 ms of sweep on
   * a 6 ms delay is at full depth while one set to 6 ms on a 20 ms delay is at
   * a third. Handing the raw millisecond value to a face that clamps 0..1 made
   * every setting above 1 ms draw the same full-scale sweep.
   */
  depth: number;
  /** The rate the modulator runs at, in Hz, tempo-locked settings resolved. */
  rateHz: number;
  /** What the modulation moves, so the picture can be labelled truthfully. */
  target: 'delay' | 'filter' | 'level' | 'pan' | 'rotor';
}

/**
 * The modulator behind a modulation device, as the audio builds it.
 *
 * Six devices shared one drawing that read `depth` off whatever effect it was
 * given and fell back to 0.6 when there was none — so a device set to no
 * modulation at all drew a waveform moving at 60 %, and the rotary speaker
 * (which has neither `depth` nor `shape`) drew a fixed sine that answered to
 * none of its six controls. Returns null for a kind that has no modulator.
 */
export function modulationOf(effect: Effect, bpm: number): ModulationField | null {
  const unit = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
  const sweepShare = (): number => {
    // The audio's own clamp: `Math.min(depth / 1000, base)` over `base`.
    const base = paramOf(effect, 'delay');
    return base > 0 ? Math.min(paramOf(effect, 'depth'), base) / base : 0;
  };
  const lockedRate = (): number =>
    choiceOf(effect, 'sync') === 1
      ? syncHz(paramOf(effect, 'division'), bpm, syncModifierByIndex(choiceOf(effect, 'modifier')))
      : paramOf(effect, 'rate');

  switch (effect.kind) {
    case 'chorus':
    case 'flanger':
      // Both run a plain quadrature sine; neither offers a shape control.
      return { shape: 0, depth: sweepShare(), rateHz: paramOf(effect, 'rate'), target: 'delay' };
    case 'phaser':
      return {
        shape: 0,
        depth: unit(paramOf(effect, 'depth')),
        rateHz: paramOf(effect, 'rate'),
        target: 'filter',
      };
    case 'tremolo':
      return {
        shape: choiceOf(effect, 'shape'),
        depth: unit(paramOf(effect, 'depth')),
        rateHz: lockedRate(),
        target: 'level',
      };
    case 'autopan':
      return {
        shape: choiceOf(effect, 'shape'),
        depth: unit(paramOf(effect, 'depth')),
        rateHz: lockedRate(),
        target: 'pan',
      };
    case 'rotary': {
      // The horn is what a listener hears turning, so it is the rotor drawn.
      // Its rate is the selected speed; the drum runs at 0.78 of it.
      const fast = choiceOf(effect, 'speed') === 1;
      return {
        shape: 0,
        depth: unit(paramOf(effect, 'hornDepth')),
        rateHz: paramOf(effect, fast ? 'fastRate' : 'slowRate'),
        target: 'rotor',
      };
    }
    default:
      return null;
  }
}

/**
 * The trim that would put a measured level on Gain Match's target.
 *
 * The device's analyser sits *after* its gain, so what is measured already
 * includes the trim it is set to — the correction is therefore relative to
 * where the trim is now, not an absolute value. Getting that backwards would
 * make the button apply the same offset twice.
 *
 * Clamped to the parameter's own range: a source 40 dB below the target cannot
 * be matched by a control that stops at 24, and pretending otherwise would put
 * a number on the knob it does not have.
 */
export function matchTrimFor(effect: Effect, measuredDb: number): number | null {
  if (effect.kind !== 'gainMatch' || !Number.isFinite(measuredDb)) return null;
  const spec = BY_KIND.get(effect.kind)?.params.find((p) => p.key === 'trim');
  const wanted = paramOf(effect, 'trim') + (paramOf(effect, 'target') - measuredDb);
  const lo = spec?.min ?? -24;
  const hi = spec?.max ?? 24;
  return Math.round(Math.min(hi, Math.max(lo, wanted)) * 10) / 10;
}

/**
 * What Vocal Tune is set to, in the terms `model/vocalTune.ts` takes.
 *
 * The audio editor drives the correction from this rather than from state of
 * its own, so the settings shown on the device are the settings a take is
 * retuned with. Returns null for any other kind.
 */
export function tuneSettingsOf(
  effect: Effect,
): (TuneOptions & { formantPreserve: boolean }) | null {
  if (effect.kind !== 'vocaltune') return null;
  return {
    strength: paramOf(effect, 'strength'),
    retuneMs: paramOf(effect, 'speed'),
    humanise: paramOf(effect, 'humanise'),
    scaleId: TUNE_SCALE_IDS[choiceOf(effect, 'scale')] ?? 'chromatic',
    tonic: choiceOf(effect, 'key'),
    formantPreserve: choiceOf(effect, 'formant') === 1,
  };
}

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
  /**
   * Whether this band's shape answers to a quality factor at all. False for
   * the two shelves, which Web Audio builds at a fixed slope of S = 1 whatever
   * their node's `Q` is set to — so a shelf has no Q parameter to declare, the
   * builder writes none, and `SHELF_Q` stands in for the response maths.
   */
  hasQ: boolean;
}[] = [
  { prefix: 'hp', label: 'HP', type: 'highpass', hasGain: false, hasQ: true },
  { prefix: 'ls', label: 'Low', type: 'lowshelf', hasGain: true, hasQ: false },
  { prefix: 'b1', label: 'B1', type: 'peaking', hasGain: true, hasQ: true },
  { prefix: 'b2', label: 'B2', type: 'peaking', hasGain: true, hasQ: true },
  { prefix: 'b3', label: 'B3', type: 'peaking', hasGain: true, hasQ: true },
  { prefix: 'b4', label: 'B4', type: 'peaking', hasGain: true, hasQ: true },
  { prefix: 'hs', label: 'High', type: 'highshelf', hasGain: true, hasQ: false },
  { prefix: 'lp', label: 'LP', type: 'lowpass', hasGain: false, hasQ: true },
];

/**
 * The number `EqBandSpec.q` carries for a shelf.
 *
 * `biquadCoefficients` reaches its shelf cases through `aS`, which is built
 * from the fixed slope, so this value never reaches the response — but the
 * field is not optional and a shelf still has to put something in it. The
 * Butterworth factor is the honest choice: it is what an unremarkable filter
 * section is aligned to here, so if the shelf maths ever did start reading `q`
 * the picture would move to a sensible place rather than to a wild one.
 */
const SHELF_Q = Math.SQRT1_2;

/**
 * The eight-band EQ's current settings in the form `eqMagnitudeResponse` wants,
 * so the UI can draw the curve the audio graph is actually producing.
 */
export function eq8Bands(effect: Effect): EqBandSpec[] {
  return EQ8_BANDS.map((b) => ({
    type: b.type,
    freqHz: paramOf(effect, `${b.prefix}Freq`),
    q: b.hasQ ? paramOf(effect, `${b.prefix}Q`) : SHELF_Q,
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

/** How many parameters a closed device shows when none are flagged. */
export const MICRO_PARAM_COUNT = 3;

/**
 * The parameters worth having on a closed device slot.
 *
 * Explicitly flagged ones win; otherwise the first few, which is the order a
 * spec is written in and therefore the order the author thought mattered.
 * A discrete choice is skipped — a menu does not belong on a slot that is
 * sixteen pixels tall.
 */
export function microParams(kind: EffectKind): ParamSpec[] {
  const params = effectSpec(kind)?.params ?? [];
  const flagged = params.filter((p) => p.micro);
  if (flagged.length > 0) return flagged;
  return params.filter((p) => !p.choices).slice(0, MICRO_PARAM_COUNT);
}

/**
 * What a delay does, in the terms its own audio uses.
 *
 * The face draws the echoes this describes and the builder sets the same
 * delay time and feedback from it, so a picture of four decaying taps is a
 * promise the audio keeps. `syncSeconds` is the same conversion the builder
 * calls, so a tempo change moves both together.
 */
export interface DelayLayout {
  /** Seconds between echoes at the project tempo. */
  timeSec: number;
  /** How much of each echo returns, 0..0.9 — the builder clamps at 0.9. */
  feedback: number;
  /**
   * Damping corner the repeats pass through, in Hz.
   *
   * The plain delay has one `tone` control; a ping-pong has a low cut and a
   * high cut, and it is the high cut that darkens the repeats — so that is
   * what this reports for it, rather than the 0 Hz a missing parameter used
   * to produce.
   */
  toneHz: number;
  /** Wet level, 0..1. */
  mix: number;
  /** True when the repeats alternate channels. */
  pingPong: boolean;
  /**
   * How far apart the two sides are thrown, 0..1. At 0 a ping-pong's panners
   * both sit at centre and there is no alternation to draw — the picture used
   * to show one anyway.
   */
  width: number;
  /** Amplitude of each echo, until it falls below audibility. */
  taps: number[];
}

export function delayLayoutOf(effect: Effect, bpm: number): DelayLayout | null {
  if (effect.kind !== 'delay' && effect.kind !== 'pingpong') return null;
  const feedback = Math.min(0.9, Math.max(0, paramOf(effect, 'feedback')));
  const taps: number[] = [];
  // Stop where a repeat passes under -60 dB: past that it is not an echo the
  // musician is placing, it is the noise floor.
  for (let level = 1, i = 0; level > 0.001 && i < 32; i++, level *= feedback) {
    taps.push(level);
    if (feedback <= 0) break;
  }
  const pingPong = effect.kind === 'pingpong';
  return {
    // The ping-pong has a Feel control and applies it; this hard-coded
    // 'straight', so on Dotted the audio spaced its repeats half again as wide
    // as the picture promised. The plain delay has no Feel and is unaffected.
    timeSec: syncSeconds(
      paramOf(effect, 'timeSixteenths'),
      bpm,
      pingPong ? syncModifierByIndex(choiceOf(effect, 'modifier')) : 'straight',
    ),
    feedback,
    toneHz: pingPong ? paramOf(effect, 'highCut') : paramOf(effect, 'tone'),
    mix: paramOf(effect, 'mix'),
    pingPong,
    width: pingPong ? Math.min(1, Math.max(0, paramOf(effect, 'width'))) : 0,
    taps,
  };
}

/**
 * A reverb tail, sampled from the same decay the impulse generator uses.
 *
 * `renderImpulse` shapes noise by `(1 - i/len) ** 2.2` after a one-pole
 * lowpass at the damping frequency; this is that envelope, so the curve on
 * screen is the tail in the convolver rather than a generic exponential.
 */
export interface ReverbTail {
  preDelaySec: number;
  decaySec: number;
  dampingHz: number;
  mix: number;
  /** Normalised envelope over the tail, 0..1 in and out. */
  envelope: number[];
}

/** The exponent renderImpulse shapes its noise with. */
export const REVERB_DECAY_EXPONENT = 2.2;

export function reverbTailOf(effect: Effect, points = 96): ReverbTail | null {
  if (effect.kind !== 'reverb') return null;
  const envelope: number[] = [];
  for (let i = 0; i < points; i++) {
    envelope.push(Math.pow(1 - i / points, REVERB_DECAY_EXPONENT));
  }
  return {
    preDelaySec: paramOf(effect, 'predelay') / 1000,
    decaySec: paramOf(effect, 'size'),
    dampingHz: paramOf(effect, 'damping'),
    mix: paramOf(effect, 'mix'),
    envelope,
  };
}

/**
 * The stereo field a width processor produces.
 *
 * Width is a mid/side gain: 0 is mono, 1 is unchanged, 2 is the sides at
 * double. Below `bassMonoHz` the sides are removed entirely, which is the
 * part a number cannot show and a picture can.
 */
export interface WidthField {
  width: number;
  bassMonoHz: number;
  /**
   * Whether the mono-bass filter is in circuit at all.
   *
   * The face already declined to draw the line at the bottom of the range, so
   * the picture said "off" while the side channel went on through a Butterworth
   * highpass at every setting. The builder crossfades the filter out here, and
   * the face reads the same answer rather than testing the frequency itself —
   * two independent thresholds are how the two came to disagree.
   */
  bassMonoOn: boolean;
  outputDb: number;
}

export function widthFieldOf(effect: Effect): WidthField | null {
  if (effect.kind !== 'width') return null;
  const bassMonoHz = paramOf(effect, 'bassMono');
  return {
    width: paramOf(effect, 'width'),
    bassMonoHz,
    bassMonoOn: bassMonoActive(bassMonoHz),
    outputDb: paramOf(effect, 'output'),
  };
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

/**
 * The stand-in spec for a third-party plugin.
 *
 * A plugin has no declared parameters — they are discovered by asking the
 * plugin at load time — so there is nothing to put in `params` here. The spec
 * exists so that `effectSpec`, `describeEffect` and every UI that reads them
 * work on a plugin slot without a special case, and so `isKnownEffect('wam')`
 * is true, which is what stops the load path from filtering plugins out.
 *
 * It is deliberately *not* in `EFFECT_SPECS`: a bare "Plugin" is not something
 * the insert picker can add, because a plugin is chosen from the shelf by name.
 */
export const WAM_SPEC: EffectSpec = {
  kind: 'wam',
  label: 'Plugin',
  blurb: 'A third-party Web Audio Modules plugin.',
  group: 'utility',
  params: [],
};

const BY_KIND = new Map<EffectKind, EffectSpec>([
  ...EFFECT_SPECS.map((s): [EffectKind, EffectSpec] => [s.kind, s]),
  ['wam', WAM_SPEC],
]);

/** How many parameters we will keep for one plugin. Well past any real plugin;
 *  a ceiling only so a corrupt file cannot make the load path unbounded. */
const MAX_PLUGIN_PARAMS = 512;

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

/**
 * Values a stored project holds under a key the spec has replaced, expressed in
 * the terms of the key that replaced it.
 *
 * Only the tremolo's stereo phase needs this, and it needs it because the old
 * declaration and the new one overlap in numbers while meaning different
 * things: 90 was ninety degrees and is now off the end of a three-item list,
 * and 1 was one degree and is now ninety. Rebuilding the map from the spec — as
 * `normaliseParams` does for everything — would leave a project that was set to
 * 180° playing at 0° with nothing said, so the degrees come forward through the
 * same nearest-of-three snap the audio always applied to them. A session saved
 * at 87° therefore reopens at 90°, which is where it had been playing all
 * along, and one saved at 180° stays inverted.
 *
 * Nothing carries the *automation lane* forward: `paramIdExists` drops a lane
 * whose key the spec no longer declares, and it says so in the log rather than
 * silently.
 */
function carriedForward(
  kind: EffectKind,
  params: Record<string, unknown> | undefined,
): Record<string, number> {
  if (kind !== 'tremolo' || !params || typeof params.phaseOffset === 'number') return {};
  const degrees = params.stereoPhase;
  if (typeof degrees !== 'number' || !Number.isFinite(degrees)) return {};
  let nearest = 0;
  for (let i = 1; i < STEREO_PHASES.length; i++) {
    if (Math.abs(STEREO_PHASES[i] - degrees) < Math.abs(STEREO_PHASES[nearest] - degrees)) {
      nearest = i;
    }
  }
  return { phaseOffset: nearest };
}

/** Clamp to spec range and fill in anything missing. Never throws on bad data. */
export function normaliseParams(
  kind: EffectKind,
  params: Record<string, unknown> | undefined,
): Record<string, number> {
  const spec = BY_KIND.get(kind);
  if (!spec) return {};
  // A plugin's parameters come from the plugin, not from a spec here. Rebuilding
  // them from `spec.params` — which is empty, and has to be — would delete every
  // value the user had set. Keep every finite number under its own key instead;
  // the plugin is the only thing that knows what its ranges are, and it clamps
  // them itself when the value is handed back to it.
  if (kind === 'wam') {
    const out: Record<string, number> = {};
    if (!params) return out;
    for (const [k, v] of Object.entries(params)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      out[k] = v;
      if (Object.keys(out).length >= MAX_PLUGIN_PARAMS) break;
    }
    return out;
  }
  const out: Record<string, number> = {};
  const carried = carriedForward(kind, params);
  for (const p of spec.params) {
    // A carried-forward value stands in only where the file has no usable
    // number of its own — including where it has an unusable one, so a corrupt
    // entry under the new key cannot beat a good one under the old.
    const stored = params?.[p.key];
    const raw = typeof stored === 'number' && Number.isFinite(stored) ? stored : carried[p.key];
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
      // Was 1/round(16/n), which is only right for the five settings that
      // divide 16: the default of 6 printed "1/3", a division this delay
      // cannot produce. The ping-pong beside it already did this correctly.
      return `${divisionText(effect, 'timeSixteenths')} · ${mixText(effect)}`;
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
    case 'wam':
      // Whether it actually loaded is runtime state, not project data, so the
      // rack decides how to say so; this is only what the project knows.
      return effect.plugin ? `${effect.plugin.vendor} · ${effect.plugin.version}` : 'no plugin';
  }
}

/**
 * Insert slots per channel. Twelve is enough for a full channel strip —
 * gate, EQ, compressor, de-esser, colour, modulation, delay, limiter — with
 * room left to experiment before a bus is the better answer.
 */
export const MAX_INSERTS = 12;
