/**
 * How far an insert shifts the signal in time.
 *
 * PA-010, raised to P0 by Directive 03: seven inserts delay their channel and
 * none of them said so, which time-misaligns every mix that uses one. Declaring
 * the delay is the fix, and declaring it needs a number — but only some of
 * those numbers are ours to derive. The limiter's lookahead and the bitcrusher's
 * hold cascade are exact arithmetic. The rest come from a `WaveShaperNode` with
 * `oversample` set, and no specification says what the browser's internal
 * up- and down-sampling filters cost; it is an implementation detail that has
 * differed between engines and between versions of one engine.
 *
 * So this measures rather than assumes. An impulse is rendered through the
 * insert and through a wire, and the distance between the two peaks is the
 * insert's latency in samples on *this* engine at *this* rate. That is the only
 * honest source for a number nobody publishes, and it is what the alignment
 * test asserts against so the declaration cannot drift from the truth.
 *
 * Needs a real `OfflineAudioContext`, so it runs in a browser and not in jsdom.
 */
import { buildEffectNode } from './effectChain';
import { defaultParams } from '../model/effects';
import type { Effect, EffectKind } from '../model/types';

/**
 * Where the impulse is placed, and how long the render runs — both in *seconds*
 * rather than samples.
 *
 * This started as fixed sample counts and that was wrong in a way worth
 * recording. Parameters here are ramped, never jumped: `setParam` uses
 * `setTargetAtTime`, so a delay line asked for 10 ms of lookahead approaches it
 * over a time constant. With the impulse at a fixed 2048 samples, it arrived
 * 46 ms into the render at 44.1 kHz but only 10.7 ms in at 192 kHz — before the
 * ramp had settled. The measured delay came out short by 5 % at 44.1 kHz and
 * 40 % at 192 kHz, which reads exactly like a rate-dependent bug in the device
 * and was a rate-dependent bug in the measurement. A quarter of a second is
 * many time constants at every rate.
 */
const IMPULSE_SEC = 0.25;
const RENDER_SEC = 0.75;

export interface LatencyMeasurement {
  kind: EffectKind;
  /** Peak offset against a dry wire, in samples. */
  measuredSamples: number;
  /** What the node declares, or null if it declares nothing. */
  declaredSamples: number | null;
  /** Peak amplitude, so a silent render is visible rather than reported as 0. */
  peak: number;
}

/**
 * `amplitude` matters more than it looks. A full-scale impulse through a
 * limiter makes the limiter *limit*, and the peak of a gain-ridden impulse is
 * not where the impulse arrived — measured against a 0 dBFS impulse the limiter
 * reported a delay 20 % short of the one its own lookahead node was applying.
 * A quiet impulse leaves a dynamics processor in its linear region, where a
 * peak position means what it is being asked to mean.
 */
function impulseBuffer(ctx: OfflineAudioContext, amplitude: number): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.length, ctx.sampleRate);
  buf.getChannelData(0)[Math.round(IMPULSE_SEC * ctx.sampleRate)] = amplitude;
  return buf;
}

/** Index of the largest absolute sample, and that value. */
function peakAt(data: Float32Array): { index: number; value: number } {
  let index = 0;
  let value = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i]);
    if (v > value) {
      value = v;
      index = i;
    }
  }
  return { index, value };
}

/**
 * Render one impulse through one insert and return where its peak landed.
 *
 * `params` overrides let a device be measured in the configuration that
 * actually delays — a limiter at 0.5 ms lookahead and one at 10 ms are two
 * different latencies, and the declaration has to follow the control.
 */
export async function measureInsertLatency(
  kind: EffectKind,
  params: Record<string, number> = {},
  sampleRate = 48000,
  amplitude = 1,
): Promise<LatencyMeasurement> {
  const ctx = new OfflineAudioContext(1, Math.round(RENDER_SEC * sampleRate), sampleRate);
  const effect: Effect = {
    id: `probe-${kind}`,
    kind,
    bypass: false,
    params: { ...defaultParams(kind), ...params },
  };
  const node = buildEffectNode(ctx, effect);
  node.update(effect, 120, false);

  const src = ctx.createBufferSource();
  src.buffer = impulseBuffer(ctx, amplitude);
  src.connect(node.input);
  node.output.connect(ctx.destination);
  src.start(0);

  const rendered = await ctx.startRendering();
  const { index, value } = peakAt(rendered.getChannelData(0));
  const declared = node.latencySamples?.() ?? null;
  node.dispose();
  return {
    kind,
    measuredSamples: index - Math.round(IMPULSE_SEC * sampleRate),
    declaredSamples: declared,
    peak: value,
  };
}

/**
 * Measure every kind given, in one pass.
 *
 * Sequential rather than concurrent: a dozen `OfflineAudioContext`s rendering at
 * once is a good way to find out what a browser's context limit is, and the
 * probe is not on any path a user waits for.
 */
export async function measureAll(
  kinds: EffectKind[],
  sampleRate = 48000,
): Promise<LatencyMeasurement[]> {
  const out: LatencyMeasurement[] = [];
  for (const kind of kinds) out.push(await measureInsertLatency(kind, {}, sampleRate));
  return out;
}
