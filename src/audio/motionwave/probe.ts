/**
 * Measuring a Motion Wave unit through the host, in a real browser.
 *
 * Ledger cell 25 asks whether a unit works *in the application*, and that is
 * the one question none of the other twenty-four can answer: jsdom has no
 * `AudioWorklet` and no `OfflineAudioContext`, and the dev harness is not the
 * app. So this renders through the host's own `InsertChain` — the same class
 * the live engine and the bounce both build through — and reports what came
 * out.
 *
 * Read-only, like the WAM parity probe it sits beside: it builds its own
 * context and its own chain, and can neither mutate the project nor touch the
 * running graph.
 */
import { InsertChain } from '../effectChain';
import { defaultParams } from '../../model/effects';
import type { Effect, EffectKind } from '../../model/types';
import { ensureMotionWaveRuntime, motionWaveNodesReady } from './runtime';
import { MOTIONWAVE_UNITS, motionWaveUnitFor } from './registry';

export interface RenderReport {
  /** False when the core did not load, which makes every other number moot. */
  coreLoaded: boolean;
  /** RMS of the rendered output. */
  rms: number;
  peak: number;
  /** Samples the chain declared, which the host uses for compensation. */
  latencySamples: number;
  /** True when any sample was not finite — a unit that broke rather than processed. */
  nonFinite: boolean;
}

/**
 * Render a burst of noise through one unit and report what came back.
 *
 * Noise rather than a tone because the question is whether the unit is *in
 * circuit and doing something*, and several of these units do very little to a
 * steady sine — a limiter below threshold is a wire, and reading that as
 * "silent" would be wrong in the most misleading direction.
 */
export async function renderThroughUnit(
  kind: EffectKind,
  params: Record<string, number> = {},
  seconds = 1.0,
  shapes?: number[][][],
): Promise<RenderReport> {
  const sampleRate = 48000;
  const frames = Math.round(sampleRate * seconds);
  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  const coreLoaded = await ensureMotionWaveRuntime(ctx);

  const effect: Effect = {
    id: 'probe',
    kind,
    bypass: false,
    params: { ...defaultParams(kind), ...params },
    ...(shapes ? { shapes } : {}),
  };

  const chain = new InsertChain(ctx);
  chain.sync([effect], 120);

  // Pink-ish noise: white through a one-pole, so there is energy across the
  // band without the top octave dominating every measurement.
  const noise = ctx.createBufferSource();
  const buffer = ctx.createBuffer(2, frames, sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let state = 0;
    let seed = 0x2468ace + c;
    for (let i = 0; i < frames; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const white = (seed >>> 8) / 8388608 - 1;
      state += (white - state) * 0.3;
      data[i] = state * 0.4;
    }
  }
  noise.buffer = buffer;
  noise.connect(chain.entry);
  chain.exit.connect(ctx.destination);
  noise.start();

  // See `motionWaveNodesReady`: an offline render outruns the processor's
  // asynchronous instantiation, and without this the probe measures silence and
  // reports it as the unit's output.
  await motionWaveNodesReady(ctx);

  const rendered = await ctx.startRendering();
  let sum = 0;
  let peak = 0;
  let nonFinite = false;
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    const data = rendered.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (!Number.isFinite(v)) nonFinite = true;
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
  }
  return {
    coreLoaded,
    rms: Math.sqrt(sum / (rendered.length * rendered.numberOfChannels)),
    peak,
    latencySamples: chain.latencySamples(),
    nonFinite,
  };
}

/** Which units the host knows about, for a test that should not hard-code them. */
export function registeredUnits(): { kind: string; label: string; unitId: string }[] {
  return MOTIONWAVE_UNITS.map((entry) => ({
    kind: entry.kind,
    label: entry.label,
    unitId: entry.unitId,
  }));
}

/** A unit's parameter ids and defaults, for a test that wants to move one. */
export function unitParams(kind: string): { id: number; name: string; min: number; max: number; def: number }[] {
  const entry = motionWaveUnitFor(kind);
  if (!entry) return [];
  return entry.unit.specs.map((spec) => ({
    id: spec.id,
    name: spec.name,
    min: spec.min,
    max: spec.max,
    def: spec.def,
  }));
}
