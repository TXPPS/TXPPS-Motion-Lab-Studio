/**
 * Motion Shaper, declared for the harness.
 *
 * Every range, default and taper here comes from `fx-01` §3, and the sheet is
 * the authority: a control that looks right and sweeps a different range than
 * its sheet is a unit that fails its own acceptance test on a number nobody
 * checked by ear.
 *
 * Under Directive 05 §2 the C++ suite owns cells D1–I18 and this declaration is
 * what the *UI* cells are checked against — U19's provenance, U20's binding of
 * every control to a real parameter and every readout to a real channel, and
 * U23's themes and names. It is not a second implementation of the DSP's
 * parameter table; it is the same table, and `unit_declaration.test.ts` asserts
 * the two agree rather than trusting that they do.
 */
import type { MeterChannel } from '../../metering/bus';
import { defineParam } from '../../param/spec';
import type { ParamSpec } from '../../param/spec';
import { Taper, Unit } from '../../param/units';
import type { UnitUnderTest } from '../../harness/types';
import { declareLatency } from '../../mix/latency';
import { MotionShaperMeter, MotionShaperParam, motionShaperFace } from './face';

/**
 * The taper on a crossover is logarithmic because frequency is heard that way:
 * a linear sweep would spend most of its travel above 10 kHz, where a
 * crossover is almost never placed, and cross the whole useful range in the
 * first centimetre.
 */
const CROSSOVER_TAPER = Taper.Logarithmic;

export const motionShaperSpecs: readonly ParamSpec[] = [
  defineParam({
    id: MotionShaperParam.BandCount,
    name: 'Bands',
    unit: Unit.Choice,
    min: 0,
    max: 2,
    def: 2,
    taper: Taper.Stepped,
    steps: 3,
    choices: ['One', 'Two', 'Three'],
    // Zero, because this is a switch. Smoothing it would mean interpolating
    // between two topologies, which is meaningless — the crossfade in the DSP
    // is what makes the change inaudible, and that is a different mechanism.
    smoothingMs: 0,
  }),
  defineParam({
    id: MotionShaperParam.CrossoverLowMid,
    name: 'Low / Mid',
    unit: Unit.Hertz,
    min: 30,
    max: 2000,
    def: 220,
    taper: CROSSOVER_TAPER,
    smoothingMs: 20,
  }),
  defineParam({
    id: MotionShaperParam.CrossoverMidHigh,
    name: 'Mid / High',
    unit: Unit.Hertz,
    min: 500,
    max: 16000,
    def: 3200,
    taper: CROSSOVER_TAPER,
    smoothingMs: 20,
  }),
  defineParam({
    id: MotionShaperParam.Slope,
    name: 'Slope',
    unit: Unit.Choice,
    min: 0,
    max: 2,
    def: 2,
    taper: Taper.Stepped,
    steps: 3,
    choices: ['6 dB/oct', '12 dB/oct', '24 dB/oct'],
    smoothingMs: 0,
  }),
  defineParam({
    id: MotionShaperParam.Smooth,
    name: 'Smooth',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 0,
    // Linear on the control, logarithmic in seconds — the mapping onto
    // 0.05…200 ms lives in the DSP, so that the anti-click floor is applied in
    // one place rather than depending on a taper the UI chose.
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  defineParam({
    id: MotionShaperParam.Mix,
    name: 'Mix',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 1,
    taper: Taper.Linear,
    smoothingMs: 30,
  }),
  ...(
    [
      [MotionShaperParam.DepthLow, 'Low Depth'],
      [MotionShaperParam.DepthMid, 'Mid Depth'],
      [MotionShaperParam.DepthHigh, 'High Depth'],
    ] as const
  ).map(([id, name]) =>
    defineParam({
      id,
      name,
      unit: Unit.Percent,
      min: 0,
      max: 1,
      def: 1,
      taper: Taper.Linear,
      smoothingMs: 30,
    }),
  ),
  ...(
    [
      [MotionShaperParam.RangeLow, 'Low Range'],
      [MotionShaperParam.RangeMid, 'Mid Range'],
      [MotionShaperParam.RangeHigh, 'High Range'],
    ] as const
  ).map(([id, name]) =>
    defineParam({
      id,
      name,
      unit: Unit.Decibels,
      min: -90,
      max: 0,
      def: -60,
      taper: Taper.Linear,
      smoothingMs: 30,
    }),
  ),
  defineParam({
    id: MotionShaperParam.Rate,
    name: 'Rate',
    unit: Unit.Hertz,
    min: 0.05,
    max: 200,
    def: 2,
    // Logarithmic across four decades. The device explicitly supports
    // audio-rate modulation, so the top of this range is a real setting rather
    // than a limit nobody reaches.
    taper: Taper.Logarithmic,
    smoothingMs: 20,
  }),
  defineParam({
    id: MotionShaperParam.Swing,
    name: 'Swing',
    unit: Unit.Percent,
    min: 0,
    max: 1,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 20,
  }),
  defineParam({
    id: MotionShaperParam.PhaseOffset,
    name: 'Offset',
    unit: Unit.Linear,
    min: 0,
    max: 360,
    def: 0,
    taper: Taper.Linear,
    smoothingMs: 20,
  }),
  defineParam({
    id: MotionShaperParam.SyncMode,
    name: 'Sync',
    unit: Unit.Choice,
    min: 0,
    max: 2,
    def: 0,
    taper: Taper.Stepped,
    steps: 3,
    choices: ['Host', 'Free', 'Trigger'],
    smoothingMs: 0,
  }),
];

/**
 * The channels the DSP publishes, matching `VisualFrame` field for field.
 *
 * `raw` for phase and gain because both are already normalised quantities the
 * face draws directly — running a 0…1 phase through a dB conversion would be
 * converting a position into a level, which it is not.
 */
export const motionShaperMeters: readonly MeterChannel[] = [
  { name: MotionShaperMeter.Phase, kind: 'raw' },
  { name: MotionShaperMeter.BandGainLow, kind: 'raw' },
  { name: MotionShaperMeter.BandGainMid, kind: 'raw' },
  { name: MotionShaperMeter.BandGainHigh, kind: 'raw' },
  { name: MotionShaperMeter.BandLevelLow, kind: 'peak' },
  { name: MotionShaperMeter.BandLevelMid, kind: 'peak' },
  { name: MotionShaperMeter.BandLevelHigh, kind: 'peak' },
  { name: MotionShaperMeter.InputPeak, kind: 'peak' },
  { name: MotionShaperMeter.OutputPeak, kind: 'peak' },
];

/**
 * The unit as the harness sees it.
 *
 * `renderer` is absent and `rendererBlockedBy` is not set, because under the
 * Directive 05 §2 split this declaration is only ever asked the UI cells. The
 * DSP cells are proven natively in `motionwave/core/test/`, and re-running them
 * through TypeScript would be a second implementation of the same check rather
 * than a second proof.
 */
export const motionShaperUnit: UnitUnderTest = {
  id: 'fx-01',
  name: 'Motion Shaper',
  kind: 'effect',
  specs: motionShaperSpecs,
  // Nothing in the wet path has latency: the crossover is minimum-phase, the
  // gain is memoryless, and the oversampled modulator is a control signal that
  // never touches the audio path's timing.
  declaredLatency: declareLatency(0, 'none', 'minimum-phase crossover, memoryless gain'),
  presetMeta: { unit: 'fx-01', unitVersion: 1, name: 'Init' },
  meters: motionShaperMeters,
  face: motionShaperFace,
};
