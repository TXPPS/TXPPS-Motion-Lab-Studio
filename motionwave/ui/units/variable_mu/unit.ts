/**
 * Variable-Mu Limiter, declared for the harness.
 *
 * The parameter table is generated from the manifest the C++ dispatch also
 * comes from, so this file declares only what is genuinely the UI's.
 */
import type { MeterChannel } from '../../metering/bus';
import type { UnitUnderTest } from '../../harness/types';
import { declareLatency } from '../../mix/latency';
import { VariableMuMeter, variableMuFace } from './face';
import { variableMuSpecs } from './params.gen';

export { variableMuSpecs } from './params.gen';

/**
 * The channels the DSP publishes.
 *
 * Gain reduction is `raw` and there are two of them. Two because the channels
 * are independent and in lateral/vertical mode they are not even the same
 * signal; `raw` because it is already a decibel figure and running it through a
 * level conversion would convert a gain into a level.
 *
 * The storage channels are `raw` for the same reason twice over: they are
 * normalised charge, not amplitude.
 */
export const variableMuMeters: readonly MeterChannel[] = [
  { name: VariableMuMeter.InputPeak, kind: 'peak' },
  { name: VariableMuMeter.OutputPeak, kind: 'peak' },
  { name: VariableMuMeter.GainReductionA, kind: 'raw' },
  { name: VariableMuMeter.GainReductionB, kind: 'raw' },
  { name: VariableMuMeter.StorageA, kind: 'raw' },
  { name: VariableMuMeter.StorageB, kind: 'raw' },
];

export const variableMuUnit: UnitUnderTest = {
  id: 'dyn-04',
  name: 'Variable-Mu Limiter',
  kind: 'effect',
  specs: variableMuSpecs,
  /**
   * The oversampling wrapper's, and nothing else's — 4× here, so 46 samples.
   *
   * Four rather than the FET Limiter's eight, and the reason is in §4: this
   * unit's fastest attack is 0.2 ms, two orders of magnitude slower, so the
   * detector is nowhere near the sample period and nothing about the control
   * range depends on the factor. What the wrapper is for here is the gain
   * element's own distortion, which §6.2 makes the dominant nonlinearity.
   */
  declaredLatency: declareLatency(
    46,
    'measured',
    'halfband cascade at 4x; impulse peak at 44.1/48/96/192 kHz, NL-10',
  ),
  presetMeta: { unit: 'dyn-04', unitVersion: 1, name: 'Init' },
  meters: variableMuMeters,
  face: variableMuFace,
};
