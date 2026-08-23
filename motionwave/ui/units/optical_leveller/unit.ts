/**
 * Optical Leveller, declared for the harness.
 *
 * The parameter table is generated from the manifest the C++ dispatch also
 * comes from, so this file declares only what is genuinely the UI's.
 */
import type { MeterChannel } from '../../metering/bus';
import type { UnitUnderTest } from '../../harness/types';
import { declareLatency } from '../../mix/latency';
import { OpticalLevellerMeter, opticalLevellerFace } from './face';
import { opticalLevellerSpecs } from './params.gen';

export { opticalLevellerSpecs } from './params.gen';

/**
 * The channels the DSP publishes.
 *
 * Exposure and release time are `raw`: one is a normalised state and the other
 * is a duration, and running either through a decibel conversion would be
 * converting a history into a level.
 */
export const opticalLevellerMeters: readonly MeterChannel[] = [
  { name: OpticalLevellerMeter.InputPeak, kind: 'peak' },
  { name: OpticalLevellerMeter.OutputPeak, kind: 'peak' },
  { name: OpticalLevellerMeter.GainReduction, kind: 'raw' },
  { name: OpticalLevellerMeter.Exposure, kind: 'raw' },
  { name: OpticalLevellerMeter.ReleaseSeconds, kind: 'raw' },
];

export const opticalLevellerUnit: UnitUnderTest = {
  id: 'dyn-02',
  name: 'Optical Leveller',
  kind: 'effect',
  specs: opticalLevellerSpecs,
  /**
   * The oversampling wrapper's, and nothing else's.
   *
   * The cell is a gain and the loop runs at control rate, so neither adds a
   * sample of delay. What does is the halfband cascade around the valve stages,
   * and `lib-nonlinear.md` §4.6 makes that an exact integer at every factor.
   * 46 is the default 4x tier.
   */
  declaredLatency: declareLatency(
    46,
    'measured',
    'halfband cascade around the valve stages; impulse peak at 44.1/48/96/192 kHz, NL-10',
  ),
  presetMeta: { unit: 'dyn-02', unitVersion: 1, name: 'Init' },
  meters: opticalLevellerMeters,
  face: opticalLevellerFace,
};
