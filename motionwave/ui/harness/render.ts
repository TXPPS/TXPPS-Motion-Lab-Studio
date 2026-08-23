/**
 * Motion Wave — offline rendering, which is how every DSP claim is verified.
 *
 * ADR-0005: with no audio device on this host, a processor is driven by a fixed
 * input buffer and its output measured. This is the driver every cell shares,
 * and it does the parameter work itself — spec table, smoothers, automation
 * lanes, modulation — so that a unit under test receives ramps and nothing
 * else. A unit cannot pass D10 by smoothing its own parameters differently from
 * the engine, because it never sees the values that would let it.
 */

import { AutomationLane } from '../automation/lane';
import { AutomationPlayer } from '../automation/player';
import { ParamSet } from '../param/set';
import { Smoother } from '../param/smoothing';
import type { Ramp } from '../param/ramp';
import type { ParamId } from '../param/spec';
import type { UnitUnderTest } from './types';

/** Ticks per quarter note, matching the transport. */
const PPQ = 480;

export interface OfflineRenderOptions {
  readonly sampleRate?: number;
  readonly blockFrames?: number;
  readonly input: Float32Array;
  /** Static normalised positions, applied before the first block. */
  readonly params?: ReadonlyMap<ParamId, number>;
  /** Lanes driven through the framework's own automation path. */
  readonly lanes?: readonly AutomationLane[];
  readonly bypass?: boolean;
  readonly tempoBpm?: number;
  /** Called before each block, for a caller that needs to send notes. */
  readonly beforeBlock?: (blockIndex: number, startFrame: number) => void;
}

export interface OfflineRenderResult {
  readonly output: Float32Array;
  readonly sampleRate: number;
  readonly blockFrames: number;
  readonly blocks: number;
}

export const DEFAULT_SAMPLE_RATE = 48000;
export const DEFAULT_BLOCK_FRAMES = 256;

/**
 * Renders a unit offline and returns what came out.
 *
 * The renderer is prepared and reset on every call. A cell that compared two
 * renders without resetting would be comparing the second one against a tail
 * left over from the first, which is the kind of difference that looks like a
 * real defect and is not.
 */
export function renderOffline(
  unit: UnitUnderTest,
  options: OfflineRenderOptions,
): OfflineRenderResult {
  const renderer = unit.renderer;
  if (renderer === undefined) {
    throw new Error(`unit ${unit.id} has no renderer on this host`);
  }
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const blockFrames = options.blockFrames ?? DEFAULT_BLOCK_FRAMES;
  const frames = options.input.length;

  const set = new ParamSet(unit.specs);
  if (options.params !== undefined) set.apply(options.params, 'preset');
  const player = new AutomationPlayer(set);
  for (const lane of options.lanes ?? []) {
    const target = player.lane(lane.paramId);
    for (const point of lane.points) target.add(point);
  }

  const smoothers = prepareSmoothers(set, sampleRate, blockFrames);
  renderer.prepare({ sampleRate, blockFrames });
  renderer.reset();
  renderer.setBypass?.(options.bypass ?? false);

  const output = new Float32Array(frames);
  const inputBlock = new Float32Array(blockFrames);
  const outputBlock = new Float32Array(blockFrames);
  const ticksPerBlock = ((options.tempoBpm ?? 120) / 60) * PPQ * (blockFrames / sampleRate);

  let blockIndex = 0;
  for (let start = 0; start < frames; start += blockFrames) {
    const count = Math.min(blockFrames, frames - start);
    options.beforeBlock?.(blockIndex, start);

    const fromTick = blockIndex * ticksPerBlock;
    player.advance(fromTick, fromTick + ticksPerBlock);
    const ramps = advanceSmoothers(set, smoothers);

    inputBlock.fill(0);
    inputBlock.set(options.input.subarray(start, start + count));
    outputBlock.fill(0);
    renderer.processBlock(inputBlock, outputBlock, count, ramps);
    output.set(outputBlock.subarray(0, count), start);
    blockIndex += 1;
  }

  return { output, sampleRate, blockFrames, blocks: blockIndex };
}

/** One smoother per parameter, configured and settled at its current value. */
function prepareSmoothers(
  set: ParamSet,
  sampleRate: number,
  blockFrames: number,
): Map<ParamId, Smoother> {
  const smoothers = new Map<ParamId, Smoother>();
  for (const spec of set.specs) {
    const smoother = new Smoother();
    smoother.configure(sampleRate, blockFrames, spec.smoothingMs);
    smoother.reset(set.real(spec.id));
    smoothers.set(spec.id, smoother);
  }
  return smoothers;
}

/**
 * Advances every smoother and hands back the block's ramps in real units.
 *
 * Real units, not normalised, because that is what a processor reads — and
 * converting both ends of the ramp through the spec is what makes a swept
 * logarithmic parameter a straight line in the space the user is dragging in
 * and a curve in hertz, which is the only way an automated filter sweep sounds
 * even.
 */
function advanceSmoothers(
  set: ParamSet,
  smoothers: ReadonlyMap<ParamId, Smoother>,
): Map<ParamId, Ramp> {
  const ramps = new Map<ParamId, Ramp>();
  for (const spec of set.specs) {
    const smoother = smoothers.get(spec.id);
    if (smoother === undefined) continue;
    if (spec.smoothingMs > 0) smoother.setTarget(set.real(spec.id));
    else smoother.reset(set.real(spec.id));
    ramps.set(spec.id, smoother.advance());
  }
  return ramps;
}
