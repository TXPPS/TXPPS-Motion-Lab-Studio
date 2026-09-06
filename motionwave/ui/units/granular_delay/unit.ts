/**
 * Granular Delay, declared for the harness.
 *
 * The parameter table is generated from the manifest the C++ dispatch also
 * comes from, so this file declares only what is genuinely the UI's.
 */
import type { MeterChannel } from '../../metering/bus';
import type { UnitUnderTest } from '../../harness/types';
import { declareLatency } from '../../mix/latency';
import { GranularDelayMeter, granularDelayFace } from './face';
import { granularDelaySpecs } from './params.gen';

export { granularDelaySpecs } from './params.gen';

/**
 * The channels the DSP publishes, in the order `wasm/bridge.cpp` packs them.
 *
 * Three levels, then fifteen numbers no control states. The pitch ratio is the
 * transport's `v(t) / v(t − D)`; the eight tap times are the *delivered* times
 * after the transport, not the settings; the clock is `N / (2D)` and exists
 * only on a bucket-brigade; the duck gain is what the input is doing to the
 * wet bus now. Every one of those is `raw` because running a ratio or a time
 * through a decibel conversion would turn it into a loudness it is not.
 */
export const granularDelayMeters: readonly MeterChannel[] = [
  { name: GranularDelayMeter.InputPeak, kind: 'peak' },
  { name: GranularDelayMeter.OutputPeak, kind: 'peak' },
  { name: GranularDelayMeter.LoopPeak, kind: 'peak' },
  { name: GranularDelayMeter.PitchRatio, kind: 'raw' },
  { name: GranularDelayMeter.Tap1Seconds, kind: 'raw' },
  { name: GranularDelayMeter.Tap2Seconds, kind: 'raw' },
  { name: GranularDelayMeter.Tap3Seconds, kind: 'raw' },
  { name: GranularDelayMeter.Tap4Seconds, kind: 'raw' },
  { name: GranularDelayMeter.Tap5Seconds, kind: 'raw' },
  { name: GranularDelayMeter.Tap6Seconds, kind: 'raw' },
  { name: GranularDelayMeter.Tap7Seconds, kind: 'raw' },
  { name: GranularDelayMeter.Tap8Seconds, kind: 'raw' },
  { name: GranularDelayMeter.Overlap, kind: 'raw' },
  { name: GranularDelayMeter.ClockHz, kind: 'raw' },
  { name: GranularDelayMeter.DuckGain, kind: 'raw' },
  { name: GranularDelayMeter.CloudDepth, kind: 'raw' },
  { name: GranularDelayMeter.LiveGrains, kind: 'raw' },
  { name: GranularDelayMeter.ActiveTaps, kind: 'raw' },
];

export const granularDelayUnit: UnitUnderTest = {
  id: 'fx-03',
  name: 'Granular Delay',
  kind: 'effect',
  specs: granularDelaySpecs,
  /**
   * Zero, and the taps are not part of it.
   *
   * No rate change anywhere on the wet path: the BBD's oversampled compander
   * runs its halfband pair inside one sample, and the grains and heads read
   * behind the write head. A delay's delays are the effect, not a processing
   * offset for a host to pull the track forward by — declaring a tap time as
   * latency would cancel exactly the repeat the user asked to hear.
   * `granular_delay_cell_tests.cpp` D8 measures the dry path at sample zero.
   */
  declaredLatency: declareLatency(
    0,
    'none',
    'no rate change and no lookahead; every head reads behind the write head, fx-03 §2',
  ),
  presetMeta: { unit: 'fx-03', unitVersion: 1, name: 'Init' },
  meters: granularDelayMeters,
  face: granularDelayFace,
};
