import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStretchCache, stretchCacheStats, stretchedBuffer } from '../src/audio/stretchCache';
import { cacheBuffer, resetMediaCaches } from '../src/audio/mediaLibrary';
import { newProject } from '../src/app/projectActions';

/**
 * The stretch and warp renders are full-length AudioBuffers keyed by media id.
 * Nothing used to drop them: `retainOnly` evicts decoded sources and leaves
 * these behind, so a project switch kept up to 64 buffers alive for the life of
 * the tab — while the docs promised decode caches were evicted.
 */
const SR = 8000;

function fakeCtx(): BaseAudioContext {
  return {
    createBuffer: (channels: number, length: number, sampleRate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: (i: number) => data[i],
        copyToChannel: (from: Float32Array, i: number) => data[i].set(from),
      } as unknown as AudioBuffer;
    },
  } as unknown as BaseAudioContext;
}

function media(id: string): AudioBuffer {
  const tone = Float32Array.from({ length: SR }, (_, i) => Math.sin((2 * Math.PI * 200 * i) / SR));
  return {
    numberOfChannels: 1,
    length: tone.length,
    sampleRate: SR,
    duration: 1,
    getChannelData: () => tone,
    __id: id,
  } as unknown as AudioBuffer;
}

/** Put one render for `id` into the stretch cache and let it finish. */
function seedStretch(ctx: BaseAudioContext, id: string): void {
  cacheBuffer(id, media(id));
  stretchedBuffer(ctx, id, 1.5, 0);
  vi.runAllTimers();
}

describe('render caches', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMediaCaches();
    clearStretchCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearStretchCache();
    resetMediaCaches();
  });

  it('drops a media id’s renders when its bytes are replaced', () => {
    const ctx = fakeCtx();
    seedStretch(ctx, 'm1');
    seedStretch(ctx, 'm2');
    expect(stretchCacheStats().entries).toBe(2);

    // A re-recorded or re-edited take: same id, different audio. The render
    // built from the old bytes must not survive it.
    cacheBuffer('m1', media('m1-edited'));
    expect(stretchCacheStats().entries).toBe(1);
  });

  it('leaves the cache alone when the same buffer is registered again', () => {
    const ctx = fakeCtx();
    const buf = media('m1');
    cacheBuffer('m1', buf);
    stretchedBuffer(ctx, 'm1', 1.5, 0);
    vi.runAllTimers();
    cacheBuffer('m1', buf);
    expect(stretchCacheStats().entries).toBe(1);
  });

  it('releases every render when the project changes', async () => {
    const ctx = fakeCtx();
    seedStretch(ctx, 'm1');
    seedStretch(ctx, 'm2');
    expect(stretchCacheStats().entries).toBe(2);

    vi.useRealTimers();
    await newProject('Switched');
    expect(stretchCacheStats().entries).toBe(0);
  });
});
