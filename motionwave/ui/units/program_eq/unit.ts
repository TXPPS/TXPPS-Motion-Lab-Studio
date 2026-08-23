/**
 * Program EQ, declared for the harness.
 *
 * The parameter table is generated from
 * `motionwave/manifests/dyn-01-program-eq.json` — the same file the C++
 * dispatch comes from — so this file declares only what is genuinely the UI's:
 * which channels the face may draw, what the unit's latency claim is, and what
 * a preset of it is called.
 */
import type { MeterChannel } from '../../metering/bus';
import type { UnitUnderTest } from '../../harness/types';
import { declareLatency } from '../../mix/latency';
import { ProgramEqMeter, programEqFace } from './face';
import { programEqSpecs } from './params.gen';

export { programEqSpecs } from './params.gen';

/**
 * The channels the DSP publishes, matching `ProgramEqFrame` field for field.
 *
 * The two harmonic coefficients are `raw` because they are already normalised
 * quantities — a curvature is a ratio, and running one through a decibel
 * conversion would be converting a shape into a level, which it is not.
 */
export const programEqMeters: readonly MeterChannel[] = [
  { name: ProgramEqMeter.InputPeak, kind: 'peak' },
  { name: ProgramEqMeter.OutputPeak, kind: 'peak' },
  { name: ProgramEqMeter.HarmonicSecond, kind: 'raw' },
  { name: ProgramEqMeter.HarmonicThird, kind: 'raw' },
  { name: ProgramEqMeter.InputCoreDrive, kind: 'raw' },
  { name: ProgramEqMeter.OutputCoreDrive, kind: 'raw' },
];

export const programEqUnit: UnitUnderTest = {
  id: 'dyn-01',
  name: 'Program EQ',
  kind: 'effect',
  specs: programEqSpecs,
  /**
   * The oversampling wrapper's, and nothing else's.
   *
   * The passive network is minimum-phase and the transformers' magnetising
   * poles are compensated by their own inverse, so neither carries a latency to
   * declare — group delay is part of how a filter sounds and is deliberately
   * uncompensated. What does carry one is the halfband cascade around the valve
   * stages, and `lib-nonlinear.md` §4.6 makes that an exact integer at every
   * factor: 0, 37, 46 or 49 samples. 46 is the default 4× tier.
   */
  declaredLatency: declareLatency(
    46,
    'measured',
    'halfband cascade around the valve stages; impulse peak at 44.1/48/96/192 kHz, NL-10',
  ),
  presetMeta: { unit: 'dyn-01', unitVersion: 1, name: 'Init' },
  meters: programEqMeters,
  face: programEqFace,
};
