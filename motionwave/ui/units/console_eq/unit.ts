/**
 * Console EQ, declared for the harness.
 *
 * The parameter table is generated from the manifest the C++ dispatch also
 * comes from, so this file declares only what is genuinely the UI's.
 */
import type { MeterChannel } from '../../metering/bus';
import type { UnitUnderTest } from '../../harness/types';
import { declareLatency } from '../../mix/latency';
import { ConsoleEqMeter, consoleEqFace } from './face';
import { consoleEqSpecs } from './params.gen';

export { consoleEqSpecs } from './params.gen';

/**
 * The channels the DSP publishes.
 *
 * The Q and the three bandwidths are `raw`: they are shapes, not levels, and
 * running a bandwidth through a decibel conversion would turn a width into a
 * loudness.
 */
export const consoleEqMeters: readonly MeterChannel[] = [
  { name: ConsoleEqMeter.InputPeak, kind: 'peak' },
  { name: ConsoleEqMeter.OutputPeak, kind: 'peak' },
  { name: ConsoleEqMeter.American, kind: 'raw' },
  { name: ConsoleEqMeter.MidQ, kind: 'raw' },
  { name: ConsoleEqMeter.BandOneWidth, kind: 'raw' },
  { name: ConsoleEqMeter.BandTwoWidth, kind: 'raw' },
  { name: ConsoleEqMeter.BandThreeWidth, kind: 'raw' },
  { name: ConsoleEqMeter.EqCoreDrive, kind: 'raw' },
  { name: ConsoleEqMeter.OutputCoreDrive, kind: 'raw' },
];

export const consoleEqUnit: UnitUnderTest = {
  id: 'dyn-05',
  name: 'Console EQ',
  kind: 'effect',
  specs: consoleEqSpecs,
  /**
   * The oversampling wrapper's, and nothing else's — 4×, so 46 samples.
   *
   * Neither lineage has a detector, so nothing here needs the FET Limiter's
   * eight; what the wrapper is for is the amplifiers and the transformers, and
   * on the inductor lineage the EQ cores as well.
   */
  declaredLatency: declareLatency(
    46,
    'measured',
    'halfband cascade at 4x; impulse peak at 44.1/48/96/192 kHz, NL-10',
  ),
  presetMeta: { unit: 'dyn-05', unitVersion: 1, name: 'Init' },
  meters: consoleEqMeters,
  face: consoleEqFace,
};
