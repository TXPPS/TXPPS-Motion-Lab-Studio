/**
 * Pitch-preserving stretch cache.
 *
 * Resampling a clip to a new tempo is free but takes the pitch with it, which
 * is right for a one-shot and wrong for a vocal. Preserving pitch means running
 * the material through the WSOLA stretcher, which is far too expensive to do on
 * the scheduling path — so it is done once per (media, ratio, semitones) and
 * kept, and playback falls back to plain resampling until the render lands.
 *
 * Falling back rather than waiting is deliberate: a clip that is silent for the
 * first bar of a take is worse than a clip that is briefly the wrong pitch.
 */
import { stretchBuffer } from './timestretch';
import { getBufferSync } from './mediaLibrary';
import { clearWarpCache, invalidateWarp, warpedBuffer, warpKey } from './warpRender';
import type { WarpMap } from '../model/warp';
import { diagLog } from '../state/diagnostics';

interface Entry {
  buffer: AudioBuffer | null;
  /** true while the render is running, so it is not started twice */
  pending: boolean;
}

const cache = new Map<string, Entry>();
/** Renders are rounded to this resolution so a fader-like tempo ride does not
 *  spawn a render per frame. */
const RATIO_STEP = 0.005;
const MAX_ENTRIES = 48;

function keyOf(mediaId: string, ratio: number, semitones: number, warp: string): string {
  // The media id stays first: `invalidateStretch` drops a whole media by prefix.
  return `${mediaId}|${ratio.toFixed(3)}|${semitones.toFixed(2)}|${warp}`;
}

export function quantizeRatio(ratio: number): number {
  return Math.round(ratio / RATIO_STEP) * RATIO_STEP;
}

/**
 * The stretched buffer for these settings, or null while it is being made.
 * Starting the render is a side effect of asking for it, which keeps the
 * scheduling path free of any decision about when to render.
 *
 * A warped clip stretches its warped render rather than the raw media, so the
 * two renders compose instead of fighting: the map puts the take in time, the
 * stretch then takes it to the song's tempo.
 */
export function stretchedBuffer(
  ctx: BaseAudioContext,
  mediaId: string,
  timeRatio: number,
  semitones: number,
  warp?: WarpMap | null,
): AudioBuffer | null {
  const source = warp ? warpedBuffer(ctx, mediaId, warp) : getBufferSync(mediaId);
  if (!source) return null;
  const ratio = quantizeRatio(timeRatio);
  if (Math.abs(ratio - 1) < 1e-3 && Math.abs(semitones) < 1e-3) return source;
  const key = keyOf(mediaId, ratio, semitones, warp ? warpKey(warp) : '');
  const hit = cache.get(key);
  if (hit) return hit.buffer;

  const entry: Entry = { buffer: null, pending: true };
  cache.set(key, entry);
  if (cache.size > MAX_ENTRIES) {
    // Oldest-first eviction: a session works forward through its clips, so the
    // least recently added entry is the least likely to be needed again.
    const oldest = cache.keys().next().value;
    if (oldest && oldest !== key) cache.delete(oldest);
  }

  // Rendering is synchronous but heavy; a task boundary keeps it off the frame
  // that asked for it.
  setTimeout(() => {
    try {
      entry.buffer = stretchBuffer(ctx, source, { timeRatio: ratio, semitones });
    } catch (e) {
      diagLog('warn', `Stretch render failed for ${mediaId}: ${String(e)}`);
      entry.buffer = source;
    } finally {
      entry.pending = false;
    }
  }, 0);
  return null;
}

/**
 * Drop everything for one media id (its bytes changed, or it was removed).
 * The warp renders go with it: a stretch entry is built on one of them.
 */
export function invalidateStretch(mediaId: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${mediaId}|`)) cache.delete(key);
  }
  invalidateWarp(mediaId);
}

/**
 * Drop every render, both caches.
 *
 * Called beside `retainOnly` on a project switch: these entries are keyed by
 * media id and hold full-length buffers, so without this up to 48 stretch and
 * 16 warp renders of a project that is no longer open stay resident for the
 * life of the tab — while the decoded sources they were built from are gone.
 */
export function clearStretchCache(): void {
  cache.clear();
  clearWarpCache();
}

export function stretchCacheStats(): { entries: number; rendering: number } {
  let rendering = 0;
  for (const e of cache.values()) if (e.pending) rendering++;
  return { entries: cache.size, rendering };
}
