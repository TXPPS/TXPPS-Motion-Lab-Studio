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
import type { UnitUnderTest } from '../../harness/types';
import { declareLatency } from '../../mix/latency';
import { MotionShaperMeter, motionShaperFace } from './face';
import { motionShaperSpecs as specs } from './params.gen';

/**
 * The parameter table, generated from `motionwave/manifests/fx-01-motion-shaper.json`.
 *
 * Re-exported rather than re-declared. This used to be sixteen hand-written
 * `defineParam` calls sitting beside sixteen hand-written C++ setters, and the
 * two agreeing was a property somebody had to keep true. Now they are the same
 * list read twice, so the first half of D1 — that the controls the UI exposes
 * and the setters the DSP has are the same set — is not a test that could pass
 * while drifting, it is a thing that cannot be written down wrongly.
 */
export { motionShaperSpecs } from './params.gen';

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
  specs,
  // Nothing in the wet path has latency: the crossover is minimum-phase, the
  // gain is memoryless, and the oversampled modulator is a control signal that
  // never touches the audio path's timing.
  declaredLatency: declareLatency(0, 'none', 'minimum-phase crossover, memoryless gain'),
  presetMeta: { unit: 'fx-01', unitVersion: 1, name: 'Init' },
  meters: motionShaperMeters,
  face: motionShaperFace,
};
