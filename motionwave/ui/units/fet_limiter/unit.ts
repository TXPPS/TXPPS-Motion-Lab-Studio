/**
 * FET Limiter, declared for the harness.
 *
 * The parameter table is generated from the manifest the C++ dispatch also
 * comes from, so this file declares only what is genuinely the UI's.
 */
import type { MeterChannel } from '../../metering/bus';
import type { UnitUnderTest } from '../../harness/types';
import { declareLatency } from '../../mix/latency';
import { FetLimiterMeter, fetLimiterFace } from './face';
import { fetLimiterSpecs } from './params.gen';

export { fetLimiterSpecs } from './params.gen';

/**
 * The channels the DSP publishes.
 *
 * Exposure and release time are `raw`: one is a normalised state and the other
 * is a duration, and running either through a decibel conversion would be
 * converting a history into a level.
 */
export const fetLimiterMeters: readonly MeterChannel[] = [
  { name: FetLimiterMeter.InputPeak, kind: 'peak' },
  { name: FetLimiterMeter.OutputPeak, kind: 'peak' },
  { name: FetLimiterMeter.GainReduction, kind: 'raw' },
  { name: FetLimiterMeter.Detector, kind: 'raw' },
];

export const fetLimiterUnit: UnitUnderTest = {
  id: 'dyn-03',
  name: 'FET Limiter',
  kind: 'effect',
  specs: fetLimiterSpecs,
  /**
   * The oversampling wrapper's, and nothing else's — but this unit's default is
   * 8× rather than 4×, so it is 49 samples rather than 46.
   *
   * That default is not a quality preference. The fastest attack is 20 µs,
   * which is 0.88 of a sample at 44.1 kHz, so the detector runs inside the
   * wrapper and at any lower factor the top of the ATTACK control stops being a
   * control.
   */
  declaredLatency: declareLatency(
    49,
    'measured',
    'halfband cascade at 8x, which the 20 us attack requires; impulse peak at 44.1/48/96/192 kHz, NL-10',
  ),
  presetMeta: { unit: 'dyn-03', unitVersion: 1, name: 'Init' },
  meters: fetLimiterMeters,
  face: fetLimiterFace,
};
