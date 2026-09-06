/**
 * Granular Delay — the face.
 *
 * **A hundred and thirty-nine controls, and the panel is honest about it.**
 * Eight taps with thirteen or fourteen controls each is what `fx-03` §7
 * specifies, and a face that drew them all at once would be a wall nobody
 * could find a tap in. So the face declares *groups*: the eight defining
 * controls — mix, feedback, smear, the medium, the tap count, sync, the
 * time-change mode and bypass — are always on the fascia, and everything else
 * sits behind a tab strip: the loop, the medium's own controls, the output,
 * the tap-time mode, and one tab per tap. The renderer draws the strip; the
 * face only says which control belongs where, so `render/facePanel.ts` still
 * knows nothing about delays.
 *
 * **What moves is the transport.** The pitch-ratio readout is `v(t) / v(t − D)`
 * on the first tap, the same number the read position is integrated from, so
 * a Tape-mode time change shows as a bend and wear shows as a wobble — and
 * neither is a control read back. The eight tap-time readouts are the
 * *delivered* times after the transport: during a Digital fade they still say
 * the old time, and in Tape mode they slide. The clock readout is `N / (2D)`,
 * a number the sheet says no control states and the reason a long BBD delay
 * goes dark. `granular_delay_visual_tests.cpp` holds the discriminators.
 *
 * **U19 is an IP cell.** The era language is the multi-head tape echo of the
 * 1970s, as a class: a dark wrinkle-finish box, chicken-head knobs, legends on
 * a plate, a bezel around a readout. That vocabulary is shared across a decade
 * of machines from many makers and is nobody's property. Nothing here is
 * traced, photographed, matched to a product or named after one — no reference
 * name appears in this file or in any identifier it declares, and every asset
 * is drawn in code from design tokens.
 */
import type { FaceElement, FaceGroup, PanelSkin, UnitFace } from '../../harness/types';
import { granularDelayControls, granularDelaySpecs } from './params.gen';
import { controlElements } from '../../render/faceControls';

export { GranularDelayParam } from './params.gen';

/** Meter channels the unit publishes, matching `GranularDelayFrame`. */
export const GranularDelayMeter = {
  InputPeak: 'input-peak',
  OutputPeak: 'output-peak',
  /** The signal that recirculates, which a wet meter would hide under the first arrival. */
  LoopPeak: 'loop-peak',
  /** `v(t) / v(t − D)` on the first tap, averaged over the block. */
  PitchRatio: 'pitch-ratio',
  Tap1Seconds: 'tap-1-seconds',
  Tap2Seconds: 'tap-2-seconds',
  Tap3Seconds: 'tap-3-seconds',
  Tap4Seconds: 'tap-4-seconds',
  Tap5Seconds: 'tap-5-seconds',
  Tap6Seconds: 'tap-6-seconds',
  Tap7Seconds: 'tap-7-seconds',
  Tap8Seconds: 'tap-8-seconds',
  /** Grains sounding at once per tap, from §4's one control. */
  Overlap: 'overlap',
  /** `N / (2D)` on a bucket-brigade; zero on the other media. */
  ClockHz: 'clock-hz',
  /** What the input is doing to the wet bus now. One is nothing. */
  DuckGain: 'duck-gain',
  /** How far behind the write head the live grains are reading. */
  CloudDepth: 'cloud-depth',
  LiveGrains: 'live-grains',
  ActiveTaps: 'active-taps',
} as const;

function meter(id: string, channel: string, name: string, reduction = false): FaceElement {
  return {
    id,
    role: 'meter',
    paramId: null,
    meterChannel: channel,
    accessibleName: name,
    keyboardFocusable: false,
    meterScale: reduction ? 'reduction' : 'level',
    colours: [{ foreground: '--mw-meter-mid', background: '--mw-bg-sunken' }],
  };
}

function display(id: string, channel: string, name: string): FaceElement {
  return {
    id,
    role: 'display',
    paramId: null,
    meterChannel: channel,
    accessibleName: name,
    keyboardFocusable: false,
    colours: [{ foreground: '--mw-accent', background: '--mw-bg-sunken' }],
  };
}

/**
 * The tabs. Ids name the generated controls, which are the manifest's, so a
 * control renamed in the manifest fails `granular_delay_cells.test.ts` here
 * rather than quietly falling out of its tab onto the fascia.
 */
function tapGroup(n: number): FaceGroup {
  const ids = [
    'time',
    'division',
    'modifier',
    ...(n === 1 ? [] : ['ratio']),
    'level',
    'pan',
    'pitch',
    'fine',
    'filter',
    'cutoff',
    'q',
    'reverse',
    'mute',
    'solo',
  ].map((suffix) => `tap${n}-${suffix}`);
  return { id: `tap-${n}`, label: `Tap ${n}`, elementIds: ids };
}

export const granularDelayGroups: readonly FaceGroup[] = [
  {
    id: 'loop',
    label: 'Loop',
    elementIds: [
      'topology',
      'cross',
      'feedback-source',
      'feedback-time',
      'feedback-division',
      'feedback-modifier',
      'loop-lowpass',
      'loop-highpass',
      'drive',
    ],
  },
  {
    id: 'medium',
    label: 'Medium',
    elementIds: ['quality', 'wear', 'bias', 'age', 'stages', 'clock-whine'],
  },
  { id: 'time', label: 'Tap times', elementIds: ['time-mode', 'spacing'] },
  { id: 'output', label: 'Output', elementIds: ['ducking', 'width', 'output-trim'] },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(tapGroup),
];

/**
 * A 1970s multi-head tape echo, as a class and not as any machine: a dark
 * wrinkle-finish box with chicken-head knobs, legends on a plate and a bezel
 * round the transport readouts. Warm and dark where the Granular Reverb is
 * cool and moulded, so the two granular units read as two objects across a
 * rack — hue, surface, knob and furniture all differ.
 */
const skin: PanelSkin = {
  era: 'a 1970s multi-head tape echo as a class — dark wrinkle finish, chicken-head knobs, legend plates and a bezel round the transport readouts; no maker’s machine',
  surface: 'wrinkle-enamel',
  hueDeg: 28,
  chroma: 'muted',
  value: 'dark',
  knob: 'chicken-head',
  arrangement: 'strip',
  lettering: 'legend-plate',
  furniture: 'bezel',
  lampToken: '--mw-accent',
};

export const granularDelayFace: UnitFace = {
  skin,
  elements: [
    // The transport, which is what this unit is: the pitch the heads are
    // applying now, and where each head is reading.
    display('pitch-ratio', GranularDelayMeter.PitchRatio, 'Transport pitch ratio on tap 1, now'),
    display('tap-1-time', GranularDelayMeter.Tap1Seconds, 'Tap 1 delivered time, seconds'),
    display('tap-2-time', GranularDelayMeter.Tap2Seconds, 'Tap 2 delivered time, seconds'),
    display('tap-3-time', GranularDelayMeter.Tap3Seconds, 'Tap 3 delivered time, seconds'),
    display('tap-4-time', GranularDelayMeter.Tap4Seconds, 'Tap 4 delivered time, seconds'),
    display('tap-5-time', GranularDelayMeter.Tap5Seconds, 'Tap 5 delivered time, seconds'),
    display('tap-6-time', GranularDelayMeter.Tap6Seconds, 'Tap 6 delivered time, seconds'),
    display('tap-7-time', GranularDelayMeter.Tap7Seconds, 'Tap 7 delivered time, seconds'),
    display('tap-8-time', GranularDelayMeter.Tap8Seconds, 'Tap 8 delivered time, seconds'),
    display('clock', GranularDelayMeter.ClockHz, 'Bucket-brigade clock, hertz'),
    display('cloud-depth', GranularDelayMeter.CloudDepth, 'How far back the smear is reading'),
    display('live-grains', GranularDelayMeter.LiveGrains, 'Grains sounding now'),
    meter('loop-level', GranularDelayMeter.LoopPeak, 'Loop level, the signal recirculating'),
    meter('duck', GranularDelayMeter.DuckGain, 'Ducking, gain taken from the wet bus', true),
    meter('input-level', GranularDelayMeter.InputPeak, 'Input level'),
    meter('output-level', GranularDelayMeter.OutputPeak, 'Output level'),

    // Every control, from the generated table — the set is the manifest's and
    // cannot be written here.
    ...controlElements(granularDelayControls, granularDelaySpecs, {
      colours: [{ foreground: '--mw-panel-ink', background: '--mw-fascia' }],
    }),
  ],
  groups: granularDelayGroups,

  artwork: [
    {
      id: 'panel-surface',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
    {
      id: 'legend-plates',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
    {
      id: 'transport-readout',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
    {
      id: 'tap-strip',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
  ],

  /**
   * `em`, never `px` — RA-007 one layer up. Sixteen readouts and a strip of
   * tabs above eight always-present controls: the first breakpoint is where
   * the readouts sit beside the controls rather than above them, and the
   * second is where a full tap's fourteen controls fit in one row.
   */
  breakpointsEm: [40, 64],
  minWidthRem: 24,
};
