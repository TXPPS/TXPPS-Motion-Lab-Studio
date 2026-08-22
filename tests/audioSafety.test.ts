import { describe, expect, it, vi } from 'vitest';
import { MeasurementTap } from '../src/audio/analysis';
import { safeSet } from '../src/audio/engine';

/**
 * Two guards that protect the graph from the code that measures and drives it.
 * Both fail silently when they are missing — a dead channel with no error
 * anywhere — which is why they are pinned here rather than left to a listen.
 */
describe('MeasurementTap disposal', () => {
  interface Stub {
    node: AudioNode;
    /** every disconnect() call, with the argument it was given (or undefined) */
    disconnects: (AudioNode | undefined)[];
  }

  function stubNode(ctx: BaseAudioContext, extra: Record<string, unknown> = {}): Stub {
    const disconnects: (AudioNode | undefined)[] = [];
    const node = {
      ...extra,
      context: ctx,
      connect: (destination: unknown) => destination,
      disconnect: (target?: AudioNode) => disconnects.push(target),
    } as unknown as AudioNode;
    return { node, disconnects };
  }

  function tapContext(): { ctx: BaseAudioContext; source: Stub } {
    const ctx = {
      sampleRate: 48000,
      currentTime: 0,
    } as unknown as { sampleRate: number; currentTime: number } & BaseAudioContext;
    const make = (extra: Record<string, unknown> = {}) => stubNode(ctx, extra).node;
    Object.assign(ctx, {
      createGain: () => make({ gain: { value: 1 }, channelCount: 2, channelCountMode: 'max' }),
      createChannelSplitter: () => make({}),
      createAnalyser: () =>
        make({
          fftSize: 2048,
          smoothingTimeConstant: 0,
          getFloatTimeDomainData: (b: Float32Array) => b.fill(0),
        }),
    });
    return { ctx, source: stubNode(ctx) };
  }

  /**
   * `dispose()` used to include the caller's own node in a blanket
   * `node.disconnect()` loop, which severs *every* output it has — the channel
   * it feeds included. The class promises it never touches the signal path.
   */
  it('unhooks only its own edge from the node it was measuring', () => {
    const { source } = tapContext();
    const tap = new MeasurementTap(source.node);
    tap.dispose();

    expect(source.disconnects).toHaveLength(1);
    expect(source.disconnects[0], 'severed every output of the measured node').toBeDefined();
  });

  it('is idempotent', () => {
    const { source } = tapContext();
    const tap = new MeasurementTap(source.node);
    tap.dispose();
    tap.dispose();
    expect(source.disconnects).toHaveLength(1);
  });
});

describe('AudioParam writes', () => {
  function recordingParam(): { param: AudioParam; writes: number[] } {
    const writes: number[] = [];
    const param = {
      setTargetAtTime: (value: number) => writes.push(value),
    } as unknown as AudioParam;
    return { param, writes };
  }

  /**
   * A NaN reaching an AudioParam is unrecoverable: the node emits NaN forever
   * and the channel is dead for the session. `projectStore.setTrack` is a raw
   * Object.assign, so a UI path or a Control Link mapping that divides can put
   * one straight through.
   */
  it('refuses anything that is not a finite number', () => {
    const { param, writes } = recordingParam();
    for (const bad of [NaN, Infinity, -Infinity]) safeSet(param, bad, 0, 0.015);
    expect(writes).toEqual([]);
  });

  it('writes ordinary values through unchanged', () => {
    const { param, writes } = recordingParam();
    safeSet(param, 0.5, 0, 0.015);
    safeSet(param, 0, 0, 0.015);
    safeSet(param, -1, 0, 0.015);
    expect(writes).toEqual([0.5, 0, -1]);
  });

  it('passes the time and time constant it was given', () => {
    const setTargetAtTime = vi.fn();
    safeSet({ setTargetAtTime } as unknown as AudioParam, 0.25, 12, 0.008);
    expect(setTargetAtTime).toHaveBeenCalledWith(0.25, 12, 0.008);
  });
});
