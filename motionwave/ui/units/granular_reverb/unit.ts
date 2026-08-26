/**
 * Granular Reverb, declared for the harness.
 *
 * The parameter table is generated from the manifest the C++ dispatch also
 * comes from, so this file declares only what is genuinely the UI's.
 */
import type { MeterChannel } from '../../metering/bus';
import type { UnitUnderTest } from '../../harness/types';
import { declareLatency } from '../../mix/latency';
import { GranularReverbMeter, granularReverbFace } from './face';
import { granularReverbSpecs } from './params.gen';

export { granularReverbSpecs } from './params.gen';

/**
 * The channels the DSP publishes.
 *
 * Only the two peaks are levels. Overlap is a count of grains, the clamped
 * density is grains per second, the 8 kHz RT60 is seconds, the feedback is a
 * per-pass gain and the live grain count is an integer — every one of them is
 * `raw`, because running any of them through a decibel conversion would turn
 * the quantity into a loudness it is not. The Console EQ's bandwidths are
 * `raw` for the same reason, and this unit has five of them.
 */
export const granularReverbMeters: readonly MeterChannel[] = [
  { name: GranularReverbMeter.InputPeak, kind: 'peak' },
  { name: GranularReverbMeter.OutputPeak, kind: 'peak' },
  { name: GranularReverbMeter.Overlap, kind: 'raw' },
  { name: GranularReverbMeter.ClampedDensity, kind: 'raw' },
  { name: GranularReverbMeter.Rt60At8k, kind: 'raw' },
  { name: GranularReverbMeter.Feedback, kind: 'raw' },
  { name: GranularReverbMeter.LiveGrains, kind: 'raw' },
  { name: GranularReverbMeter.CloudDepth, kind: 'raw' },
  { name: GranularReverbMeter.CloudSpread, kind: 'raw' },
];

export const granularReverbUnit: UnitUnderTest = {
  id: 'fx-02',
  name: 'Granular Reverb',
  kind: 'effect',
  specs: granularReverbSpecs,
  /**
   * Zero, and the pre-delay is not part of it.
   *
   * There is no oversampling wrapper here — §3.1's point is that a granular
   * shifter needs no phase vocoder and therefore adds no latency, and the
   * anti-imaging is in the interpolation kernel rather than in a rate change.
   * The grains read *behind* the write head, so the loop's own delays are the
   * effect and not a processing offset a host should compensate for.
   *
   * Pre-delay is deliberately excluded. §6 lists it as adding to the latency
   * budget only if greater than zero, and declaring a user-set delay as latency
   * would have the host pull the whole track earlier to cancel exactly the
   * offset the user asked to hear.
   */
  declaredLatency: declareLatency(
    0,
    'none',
    'no rate change and no lookahead; grains read behind the write head, fx-02 §3.1',
  ),
  presetMeta: { unit: 'fx-02', unitVersion: 1, name: 'Init' },
  meters: granularReverbMeters,
  face: granularReverbFace,
};
