/**
 * Factory presets — pure data, no behaviour.
 *
 * A preset carries only the parameters it means to set. Everything else comes
 * from the effect's own defaults via `normaliseParams`, so a preset written
 * before a parameter existed still loads, and a value that later moves out of
 * range is clamped rather than rejected. Reading a preset therefore always
 * yields a complete, valid parameter map.
 *
 * Chain presets are the same idea one level up: an ordered list of effects with
 * their settings, which is how a channel strip is actually recalled.
 */
import { defaultParams, effectSpec, normaliseParams } from './effects';
import type { EffectKind } from './types';

export interface EffectPreset {
  id: string;
  name: string;
  kind: EffectKind;
  /** One line on where it belongs, shown next to the name in the browser. */
  blurb: string;
  params: Record<string, number>;
}

export interface ChainStep {
  kind: EffectKind;
  params: Record<string, number>;
  /** Steps a musician is expected to switch on per song ship bypassed. */
  bypass?: boolean;
}

export interface ChainPreset {
  id: string;
  name: string;
  blurb: string;
  steps: ChainStep[];
}

export const EFFECT_PRESETS: readonly EffectPreset[] = [
  // ------------------------------------------------------------- compressor
  {
    id: 'comp-vocal-level',
    name: 'Vocal Level',
    kind: 'compressor',
    blurb: 'Holds a lead vocal steady without pumping.',
    params: { threshold: -20, ratio: 3, attack: 8, release: 160, knee: 12, makeupDb: 3 },
  },
  {
    id: 'comp-drum-glue',
    name: 'Drum Bus Glue',
    kind: 'compressor',
    blurb: 'Slow attack so the transients stay, fast release for the tail.',
    params: { threshold: -14, ratio: 2, attack: 25, release: 120, knee: 6, makeupDb: 2 },
  },
  {
    id: 'comp-bass-control',
    name: 'Bass Control',
    kind: 'compressor',
    blurb: 'Evens out a DI bass across the neck.',
    params: { threshold: -24, ratio: 4, attack: 12, release: 220, knee: 8, makeupDb: 4.5 },
  },
  {
    id: 'comp-squash',
    name: 'Squash',
    kind: 'compressor',
    blurb: 'Heavy limiting for room mics and parallel blends.',
    params: { threshold: -32, ratio: 12, attack: 1, release: 90, knee: 2, makeupDb: 8 },
  },
  {
    id: 'comp-gentle-bus',
    name: 'Gentle Bus',
    kind: 'compressor',
    blurb: 'A couple of dB on the mix bus, barely audible.',
    params: { threshold: -18, ratio: 1.5, attack: 30, release: 300, knee: 18, makeupDb: 1 },
  },

  // --------------------------------------------------------------------- eq8
  {
    id: 'eq8-vocal-air',
    name: 'Vocal Air',
    kind: 'eq8',
    blurb: 'Rumble out, boxiness down, air up.',
    params: {
      hpOn: 1,
      hpFreq: 90,
      lsOn: 0,
      b1On: 1,
      b1Freq: 300,
      b1Gain: -3,
      b1Q: 1.2,
      b2On: 1,
      b2Freq: 2600,
      b2Gain: 2,
      b2Q: 1,
      b3On: 0,
      b4On: 0,
      hsOn: 1,
      hsFreq: 11000,
      hsGain: 3.5,
    },
  },
  {
    id: 'eq8-kick-punch',
    name: 'Kick Punch',
    kind: 'eq8',
    blurb: 'Weight at 60, mud out at 350, beater back in at 3.5k.',
    params: {
      hpOn: 1,
      hpFreq: 30,
      lsOn: 1,
      lsFreq: 70,
      lsGain: 4,
      b1On: 1,
      b1Freq: 350,
      b1Gain: -5,
      b1Q: 1.8,
      b2On: 0,
      b3On: 1,
      b3Freq: 3500,
      b3Gain: 3.5,
      b3Q: 1.4,
      b4On: 0,
      hsOn: 0,
      lpOn: 1,
      lpFreq: 12000,
    },
  },
  {
    id: 'eq8-guitar-cleanup',
    name: 'Guitar Clean-up',
    kind: 'eq8',
    blurb: 'Takes the low end away from the bass and the fizz off the top.',
    params: {
      hpOn: 1,
      hpFreq: 120,
      lsOn: 0,
      b1On: 1,
      b1Freq: 450,
      b1Gain: -2.5,
      b1Q: 1.6,
      b2On: 1,
      b2Freq: 1800,
      b2Gain: 2,
      b2Q: 0.9,
      b3On: 0,
      b4On: 0,
      hsOn: 0,
      lpOn: 1,
      lpFreq: 9000,
    },
  },
  {
    id: 'eq8-master-tilt',
    name: 'Master Tilt',
    kind: 'eq8',
    blurb: 'A gentle smile curve for a mix that sits flat.',
    params: {
      hpOn: 1,
      hpFreq: 24,
      lsOn: 1,
      lsFreq: 100,
      lsGain: 1.5,
      b1On: 1,
      b1Freq: 420,
      b1Gain: -1.5,
      b1Q: 0.8,
      b2On: 0,
      b3On: 0,
      b4On: 0,
      hsOn: 1,
      hsFreq: 9000,
      hsGain: 1.5,
      lpOn: 0,
    },
  },
  {
    id: 'eq8-podcast-voice',
    name: 'Podcast Voice',
    kind: 'eq8',
    blurb: 'Narrow band-limited voice: nothing below 100, nothing above 12k.',
    params: {
      hpOn: 1,
      hpFreq: 100,
      lsOn: 0,
      b1On: 1,
      b1Freq: 240,
      b1Gain: -4,
      b1Q: 1.4,
      b2On: 1,
      b2Freq: 1200,
      b2Gain: 1.5,
      b2Q: 0.8,
      b3On: 1,
      b3Freq: 5000,
      b3Gain: 2,
      b3Q: 1.2,
      b4On: 0,
      hsOn: 0,
      lpOn: 1,
      lpFreq: 12000,
    },
  },

  // ------------------------------------------------------------------ reverb
  {
    id: 'verb-vocal-plate',
    name: 'Vocal Plate',
    kind: 'reverb',
    blurb: 'Bright medium tail with enough pre-delay to keep words clear.',
    params: { size: 2.2, damping: 7000, predelay: 26, mix: 0.28 },
  },
  {
    id: 'verb-small-room',
    name: 'Small Room',
    kind: 'reverb',
    blurb: 'Short and dark. Puts a close-miked source in a space.',
    params: { size: 0.7, damping: 4200, predelay: 8, mix: 0.2 },
  },
  {
    id: 'verb-drum-chamber',
    name: 'Drum Chamber',
    kind: 'reverb',
    blurb: 'Damped chamber for snare and room mics.',
    params: { size: 1.4, damping: 3600, predelay: 14, mix: 0.22 },
  },
  {
    id: 'verb-long-hall',
    name: 'Long Hall',
    kind: 'reverb',
    blurb: 'Big slow tail. Use it on a send, not an insert.',
    params: { size: 4.5, damping: 3200, predelay: 45, mix: 0.35 },
  },
  {
    id: 'verb-ambience',
    name: 'Ambience',
    kind: 'reverb',
    blurb: 'Barely there: depth without an obvious tail.',
    params: { size: 0.9, damping: 10000, predelay: 5, mix: 0.14 },
  },

  // ------------------------------------------------------------------- delay
  {
    id: 'delay-eighth-slap',
    name: 'Eighth Slap',
    kind: 'delay',
    blurb: 'One clear repeat on the eighth. Rockabilly vocals.',
    params: { timeSixteenths: 2, feedback: 0.15, tone: 6000, mix: 0.18 },
  },
  {
    id: 'delay-dotted-eighth',
    name: 'Dotted Eighth',
    kind: 'delay',
    blurb: 'The stadium guitar delay: three sixteenths against the beat.',
    params: { timeSixteenths: 3, feedback: 0.38, tone: 4200, mix: 0.26 },
  },
  {
    id: 'delay-quarter-echo',
    name: 'Quarter Echo',
    kind: 'delay',
    blurb: 'On the beat, several repeats, mid-forward.',
    params: { timeSixteenths: 4, feedback: 0.45, tone: 3200, mix: 0.3 },
  },
  {
    id: 'delay-long-tape',
    name: 'Long Tape',
    kind: 'delay',
    blurb: 'Half-note repeats that darken quickly, like a tape unit.',
    params: { timeSixteenths: 8, feedback: 0.55, tone: 2400, mix: 0.32 },
  },
  {
    id: 'delay-doubler',
    name: 'Sixteenth Doubler',
    kind: 'delay',
    blurb: 'One short bright repeat that reads as thickness, not echo.',
    params: { timeSixteenths: 1, feedback: 0.05, tone: 9000, mix: 0.16 },
  },

  // --------------------------------------------------------------- saturator
  {
    id: 'sat-tube-warmth',
    name: 'Tube Warmth',
    kind: 'saturator',
    blurb: 'Even harmonics and a softened peak. Vocals and keys.',
    params: { model: 0, drive: 6, output: -1, mix: 1 },
  },
  {
    id: 'sat-tape-glue',
    name: 'Tape Glue',
    kind: 'saturator',
    blurb: 'Symmetric compression of the peaks. Good on a drum bus.',
    params: { model: 1, drive: 10, output: -2, mix: 1 },
  },
  {
    id: 'sat-transistor-bite',
    name: 'Transistor Bite',
    kind: 'saturator',
    blurb: 'Harder edge with more odd harmonics. Bass and snare.',
    params: { model: 2, drive: 16, output: -4, mix: 0.8 },
  },
  {
    id: 'sat-parallel-colour',
    name: 'Parallel Colour',
    kind: 'saturator',
    blurb: 'Heavy drive blended under the dry signal.',
    params: { model: 0, drive: 26, output: -6, mix: 0.35 },
  },

  // ------------------------------------------------------------------ ampsim
  {
    id: 'amp-clean-combo',
    name: 'Clean Combo',
    kind: 'ampsim',
    blurb: 'Edge-of-breakup 1x12. Chords stay defined.',
    params: { model: 0, gain: 8, bass: 1, mid: 0, treble: 2, presence: 2, cab: 0, output: -4 },
  },
  {
    id: 'amp-crunch-rhythm',
    name: 'Crunch Rhythm',
    kind: 'ampsim',
    blurb: 'Open-back 2x12 with the mids left in.',
    params: { model: 1, gain: 18, bass: 0, mid: 2, treble: 1, presence: 3, cab: 1, output: -6 },
  },
  {
    id: 'amp-lead-stack',
    name: 'Lead Stack',
    kind: 'ampsim',
    blurb: '4x12 with a mid push so the line cuts through.',
    params: { model: 2, gain: 30, bass: -2, mid: 4, treble: 2, presence: 4, cab: 2, output: -8 },
  },
  {
    id: 'amp-bass-di',
    name: 'Bass DI Grit',
    kind: 'ampsim',
    blurb: '8x10 with mild drive: weight plus something to grab onto.',
    params: { model: 3, gain: 12, bass: 3, mid: -1, treble: 1, presence: 0, cab: 3, output: -5 },
  },
  {
    id: 'amp-direct-edge',
    name: 'Direct Edge',
    kind: 'ampsim',
    blurb: 'Preamp and tone stack with no cabinet, for re-amping later.',
    params: { model: 1, gain: 14, bass: 0, mid: 0, treble: 0, presence: 0, cab: 4, output: -6 },
  },

  // ------------------------------------------------------------ other kinds
  {
    id: 'gate-drum-tight',
    name: 'Tight Drum',
    kind: 'gate',
    blurb: 'Fast open, short hold. Removes bleed between hits.',
    params: { threshold: -38, ratio: 10, attack: 0.5, hold: 30, release: 100, range: 50 },
  },
  {
    id: 'gate-vocal-breath',
    name: 'Breath Control',
    kind: 'gate',
    blurb: 'Shallow range so breaths drop back without disappearing.',
    params: { threshold: -48, ratio: 3, attack: 5, hold: 120, release: 300, range: 12 },
  },
  {
    id: 'limit-master-safety',
    name: 'Master Safety',
    kind: 'limiter',
    blurb: 'Catches stray peaks and nothing else.',
    params: { drive: 0, ceiling: -1, release: 120, lookahead: 5 },
  },
  {
    id: 'limit-loud-master',
    name: 'Loud Master',
    kind: 'limiter',
    blurb: 'Drives into the ceiling for a competitive level.',
    params: { drive: 6, ceiling: -0.3, release: 60, lookahead: 3 },
  },
  {
    id: 'mb-master-glue',
    name: 'Master Glue',
    kind: 'multiband',
    blurb: 'Two dB a band, slow enough to be felt rather than heard.',
    params: {
      lowSplit: 180,
      highSplit: 3000,
      attack: 20,
      release: 220,
      lowThreshold: -24,
      lowRatio: 2.5,
      lowMakeup: 1.5,
      midThreshold: -22,
      midRatio: 2,
      midMakeup: 1,
      highThreshold: -20,
      highRatio: 2.5,
      highMakeup: 1.5,
    },
  },
  {
    id: 'mb-bass-tighten',
    name: 'Bass Tighten',
    kind: 'multiband',
    blurb: 'Holds the low band down and leaves the rest alone.',
    params: {
      lowSplit: 120,
      highSplit: 2000,
      attack: 5,
      release: 140,
      lowThreshold: -28,
      lowRatio: 5,
      lowMakeup: 3,
      midThreshold: 0,
      midRatio: 1,
      highThreshold: 0,
      highRatio: 1,
    },
  },
  {
    id: 'dess-bright-vocal',
    name: 'Bright Vocal',
    kind: 'deesser',
    blurb: 'Sits on the 7k sibilance of a close-miked vocal.',
    params: { freq: 7000, q: 3.5, threshold: -30, ratio: 6, release: 80 },
  },
  {
    id: 'dess-cymbal-tame',
    name: 'Cymbal Tame',
    kind: 'deesser',
    blurb: 'Wider and higher: takes the glare off overheads.',
    params: { freq: 10000, q: 1.5, threshold: -26, ratio: 4, release: 140 },
  },
  {
    id: 'filter-sweep-lowpass',
    name: 'Sweep Low Pass',
    kind: 'filter',
    blurb: 'Resonant low pass parked ready to automate.',
    params: { mode: 0, cutoff: 900, resonance: 4, drive: 6 },
  },
  {
    id: 'filter-telephone',
    name: 'Telephone',
    kind: 'filter',
    blurb: 'Narrow band pass for a lo-fi voice.',
    params: { mode: 1, cutoff: 1400, resonance: 2.5, drive: 10 },
  },
  {
    id: 'dist-fuzz',
    name: 'Fuzz',
    kind: 'distortion',
    blurb: 'Everything clipped flat, top rolled off.',
    params: { drive: 36, hardness: 11, bass: 2, treble: -6, output: -10, mix: 1 },
  },
  {
    id: 'dist-edge',
    name: 'Edge',
    kind: 'distortion',
    blurb: 'Moderate clipping blended in behind the dry signal.',
    params: { drive: 16, hardness: 5, bass: -2, treble: 3, output: -4, mix: 0.6 },
  },
  {
    id: 'crush-lofi-8bit',
    name: 'Lo-fi 8 Bit',
    kind: 'bitcrusher',
    blurb: 'Eight bits and a quarter of the rate.',
    params: { bits: 8, downsample: 2, mix: 1 },
  },
  {
    id: 'crush-destroy',
    name: 'Destroy',
    kind: 'bitcrusher',
    blurb: 'Four bits, heavy hold. Sound design, not mixing.',
    params: { bits: 4, downsample: 5, mix: 1 },
  },
  {
    id: 'chorus-lush',
    name: 'Lush',
    kind: 'chorus',
    blurb: 'Slow, wide and deep. Pads and clean guitar.',
    params: { rate: 0.35, depth: 6, delay: 16, spread: 1, mix: 0.5 },
  },
  {
    id: 'chorus-subtle-double',
    name: 'Subtle Double',
    kind: 'chorus',
    blurb: 'Just enough movement to read as two takes.',
    params: { rate: 1.1, depth: 1.5, delay: 22, spread: 0.6, mix: 0.25 },
  },
  {
    id: 'flanger-jet',
    name: 'Jet',
    kind: 'flanger',
    blurb: 'Through-zero with high feedback. The classic sweep.',
    params: { rate: 0.18, depth: 5, delay: 5, feedback: 0.8, throughZero: 1, mix: 0.5 },
  },
  {
    id: 'flanger-metallic',
    name: 'Metallic',
    kind: 'flanger',
    blurb: 'Negative feedback, short delay, hollow.',
    params: { rate: 0.6, depth: 1.5, delay: 1, feedback: -0.7, throughZero: 0, mix: 0.45 },
  },
  {
    id: 'phaser-classic',
    name: 'Classic Six',
    kind: 'phaser',
    blurb: 'Six stages, gentle. Electric piano and clean guitar.',
    params: { rate: 0.35, depth: 0.7, stages: 6, centre: 700, feedback: 0.3, mix: 0.5 },
  },
  {
    id: 'phaser-deep-twelve',
    name: 'Deep Twelve',
    kind: 'phaser',
    blurb: 'Twelve stages with feedback. Very obvious, on purpose.',
    params: { rate: 0.15, depth: 0.95, stages: 12, centre: 500, feedback: 0.7, mix: 0.6 },
  },
  {
    id: 'trem-eighth',
    name: 'Eighth Chop',
    kind: 'tremolo',
    blurb: 'Square wave locked to eighths. Rhythmic gating.',
    params: { sync: 1, division: 2, modifier: 0, depth: 0.9, shape: 2, stereoPhase: 0 },
  },
  {
    id: 'trem-vintage',
    name: 'Vintage Amp',
    kind: 'tremolo',
    blurb: 'Slow sine, moderate depth, mono.',
    params: { sync: 0, rate: 4.5, depth: 0.45, shape: 0, stereoPhase: 0 },
  },
  {
    id: 'rotary-slow-swell',
    name: 'Slow Swell',
    kind: 'rotary',
    blurb: 'Chorale speed. Organ pads.',
    params: {
      speed: 0,
      slowRate: 0.7,
      fastRate: 6.5,
      crossover: 800,
      hornDepth: 0.8,
      drumDepth: 0.6,
      spread: 0.8,
      mix: 1,
    },
  },
  {
    id: 'rotary-fast-spin',
    name: 'Fast Spin',
    kind: 'rotary',
    blurb: 'Tremolo speed with a wide mic spread.',
    params: {
      speed: 1,
      slowRate: 0.8,
      fastRate: 7.5,
      crossover: 900,
      hornDepth: 0.95,
      drumDepth: 0.7,
      spread: 1,
      mix: 1,
    },
  },
  {
    id: 'pp-quarter-wide',
    name: 'Quarter Wide',
    kind: 'pingpong',
    blurb: 'Full-width quarter bounces with the low end filtered out.',
    params: {
      timeSixteenths: 4,
      modifier: 0,
      feedback: 0.4,
      lowCut: 250,
      highCut: 6000,
      width: 1,
      mix: 0.3,
    },
  },
  {
    id: 'pp-triplet-dub',
    name: 'Triplet Dub',
    kind: 'pingpong',
    blurb: 'Triplet feel, heavy feedback, dark repeats.',
    params: {
      timeSixteenths: 4,
      modifier: 2,
      feedback: 0.6,
      lowCut: 300,
      highCut: 3000,
      width: 0.85,
      mix: 0.35,
    },
  },
  {
    id: 'width-wide-mono-bass',
    name: 'Wide, Mono Bass',
    kind: 'width',
    blurb: 'Opens the sides and keeps everything under 120 Hz centred.',
    params: { width: 1.4, bassMono: 120, output: 0 },
  },
  {
    id: 'width-narrow',
    name: 'Narrow',
    kind: 'width',
    blurb: 'Pulls a too-wide source back towards the centre.',
    params: { width: 0.6, bassMono: 20, output: 0 },
  },
  {
    id: 'pan-bar-sweep',
    name: 'Bar Sweep',
    kind: 'autopan',
    blurb: 'One full sweep per bar.',
    params: { sync: 1, division: 16, modifier: 0, depth: 0.9, shape: 0 },
  },
  {
    id: 'pan-slow-drift',
    name: 'Slow Drift',
    kind: 'autopan',
    blurb: 'Free-running and shallow. Movement without seasickness.',
    params: { sync: 0, rate: 0.15, depth: 0.35, shape: 0 },
  },
];

export const CHAIN_PRESETS: readonly ChainPreset[] = [
  {
    id: 'chain-vocal-bus',
    name: 'Vocal Bus',
    blurb: 'Gate, shape, control, de-ess, colour and a dotted eighth.',
    steps: [
      {
        kind: 'gate',
        params: { threshold: -48, ratio: 3, attack: 5, hold: 120, release: 300, range: 12 },
      },
      {
        kind: 'eq8',
        params: {
          hpOn: 1,
          hpFreq: 90,
          b1On: 1,
          b1Freq: 300,
          b1Gain: -3,
          b1Q: 1.2,
          b2On: 1,
          b2Freq: 2600,
          b2Gain: 2,
          b2Q: 1,
          hsOn: 1,
          hsFreq: 11000,
          hsGain: 3.5,
        },
      },
      {
        kind: 'compressor',
        params: { threshold: -20, ratio: 3, attack: 8, release: 160, knee: 12, makeupDb: 3 },
      },
      { kind: 'deesser', params: { freq: 7000, q: 3.5, threshold: -30, ratio: 6, release: 80 } },
      { kind: 'saturator', params: { model: 0, drive: 5, output: -1, mix: 0.6 } },
      {
        kind: 'delay',
        params: { timeSixteenths: 3, feedback: 0.3, tone: 4200, mix: 0.16 },
        bypass: true,
      },
    ],
  },
  {
    id: 'chain-drum-glue',
    name: 'Drum Glue',
    blurb: 'Transient-safe compression, tape colour and a multiband hold.',
    steps: [
      {
        kind: 'eq8',
        params: {
          hpOn: 1,
          hpFreq: 30,
          lsOn: 1,
          lsFreq: 70,
          lsGain: 2,
          b1On: 1,
          b1Freq: 400,
          b1Gain: -2.5,
          b1Q: 1.4,
          hsOn: 1,
          hsFreq: 9000,
          hsGain: 2,
        },
      },
      {
        kind: 'compressor',
        params: { threshold: -14, ratio: 2, attack: 25, release: 120, knee: 6, makeupDb: 2 },
      },
      { kind: 'saturator', params: { model: 1, drive: 9, output: -2, mix: 1 } },
      {
        kind: 'multiband',
        params: {
          lowSplit: 180,
          highSplit: 3000,
          attack: 20,
          release: 220,
          lowThreshold: -24,
          lowRatio: 2.5,
          lowMakeup: 1.5,
          midThreshold: -22,
          midRatio: 2,
          midMakeup: 1,
          highThreshold: -20,
          highRatio: 2.5,
          highMakeup: 1.5,
        },
      },
    ],
  },
  {
    id: 'chain-bass-di',
    name: 'Bass DI',
    blurb: 'Clean up, control the level, add grit, keep the bottom mono.',
    steps: [
      {
        kind: 'eq8',
        params: {
          hpOn: 1,
          hpFreq: 35,
          lsOn: 1,
          lsFreq: 90,
          lsGain: 2,
          b1On: 1,
          b1Freq: 300,
          b1Gain: -3,
          b1Q: 1.6,
          b3On: 1,
          b3Freq: 1600,
          b3Gain: 2.5,
          b3Q: 1,
          lpOn: 1,
          lpFreq: 9000,
        },
      },
      {
        kind: 'compressor',
        params: { threshold: -24, ratio: 4, attack: 12, release: 220, knee: 8, makeupDb: 4.5 },
      },
      {
        kind: 'ampsim',
        params: {
          model: 3,
          gain: 10,
          bass: 2,
          mid: -1,
          treble: 1,
          presence: 0,
          cab: 3,
          output: -5,
        },
      },
      { kind: 'width', params: { width: 0.9, bassMono: 160, output: 0 } },
    ],
  },
  {
    id: 'chain-acoustic-sparkle',
    name: 'Acoustic Sparkle',
    blurb: 'Boom out, air in, gentle level, a small room behind it.',
    steps: [
      {
        kind: 'eq8',
        params: {
          hpOn: 1,
          hpFreq: 75,
          b1On: 1,
          b1Freq: 220,
          b1Gain: -3.5,
          b1Q: 1.8,
          b3On: 1,
          b3Freq: 4500,
          b3Gain: 2,
          b3Q: 0.9,
          hsOn: 1,
          hsFreq: 12000,
          hsGain: 3,
        },
      },
      {
        kind: 'compressor',
        params: { threshold: -22, ratio: 2.5, attack: 15, release: 200, knee: 14, makeupDb: 2.5 },
      },
      { kind: 'chorus', params: { rate: 0.4, depth: 2, delay: 20, spread: 0.8, mix: 0.18 } },
      { kind: 'reverb', params: { size: 1.2, damping: 8000, predelay: 12, mix: 0.18 } },
    ],
  },
  {
    id: 'chain-master-polish',
    name: 'Master Polish',
    blurb: 'Tilt, multiband glue, tape colour, width and a safety ceiling.',
    steps: [
      {
        kind: 'eq8',
        params: {
          hpOn: 1,
          hpFreq: 24,
          lsOn: 1,
          lsFreq: 100,
          lsGain: 1.5,
          b1On: 1,
          b1Freq: 420,
          b1Gain: -1.5,
          b1Q: 0.8,
          hsOn: 1,
          hsFreq: 9000,
          hsGain: 1.5,
        },
      },
      {
        kind: 'multiband',
        params: {
          lowSplit: 180,
          highSplit: 3000,
          attack: 20,
          release: 220,
          lowThreshold: -24,
          lowRatio: 2,
          lowMakeup: 1,
          midThreshold: -22,
          midRatio: 1.8,
          midMakeup: 1,
          highThreshold: -20,
          highRatio: 2,
          highMakeup: 1,
        },
      },
      { kind: 'saturator', params: { model: 1, drive: 6, output: -1, mix: 0.5 } },
      { kind: 'width', params: { width: 1.15, bassMono: 110, output: 0 } },
      { kind: 'limiter', params: { drive: 2, ceiling: -0.8, release: 100, lookahead: 5 } },
    ],
  },
];

/** Every preset for one effect kind, in declaration order. */
export function presetsFor(kind: EffectKind): EffectPreset[] {
  return EFFECT_PRESETS.filter((p) => p.kind === kind);
}

export function findPreset(id: string): EffectPreset | undefined {
  return EFFECT_PRESETS.find((p) => p.id === id);
}

export function findChainPreset(id: string): ChainPreset | undefined {
  return CHAIN_PRESETS.find((p) => p.id === id);
}

/**
 * A preset's parameters as a complete, in-range map: unset keys take the
 * effect's default, out-of-range values are clamped, unknown keys are dropped.
 */
export function presetParams(preset: EffectPreset | ChainStep): Record<string, number> {
  return normaliseParams(preset.kind, preset.params);
}

/** Chain preset expanded into effects ready to be added to a track. */
export function chainSteps(preset: ChainPreset): {
  kind: EffectKind;
  params: Record<string, number>;
  bypass: boolean;
}[] {
  return preset.steps
    .filter((s) => effectSpec(s.kind))
    .map((s) => ({
      kind: s.kind,
      params: { ...defaultParams(s.kind), ...presetParams(s) },
      bypass: s.bypass ?? false,
    }));
}
