/**
 * One resolver for every kind of audio media.
 *
 * Procedural demo loops, recorded takes and imported files all reach the
 * scheduler and the waveform renderer through this module, so nothing else
 * needs to know where the bytes came from.
 *
 * Decoded AudioBuffers and peak envelopes are cached in memory; decoding is
 * asynchronous and never happens on the audio scheduling path (the scheduler
 * only ever asks for an already-resolved buffer).
 */
import { isProceduralMediaId, type PeakData } from '../model/media';
import { diagLog } from '../state/diagnostics';
import {
  getMediaBuffer as getProceduralBuffer,
  getMediaDurationSec,
  getMediaPeaks as getProceduralPeaks,
} from './demoAudio';
import { peaksFromAudioBuffer } from './peaks';
import { invalidateStretch } from './stretchCache';
import { getMediaBlob, getPeaks, putPeaks } from '../persistence/mediaStore';

const buffers = new Map<string, AudioBuffer>();
const peaks = new Map<string, PeakData>();
const inflight = new Map<string, Promise<AudioBuffer | null>>();
/** ids that failed to resolve — surfaced as "missing media" in the UI */
const missing = new Set<string>();

/**
 * Register a freshly created buffer (recording/import) without a round-trip.
 *
 * This is the one place an id's audio can change under it, so it is also where
 * the renders built from that audio are dropped: a warped or tempo-followed
 * clip whose media was re-recorded or edited would otherwise keep playing the
 * render made from the previous bytes.
 */
export function cacheBuffer(id: string, buffer: AudioBuffer, peakData?: PeakData): void {
  if (buffers.get(id) !== buffer) invalidateStretch(id);
  buffers.set(id, buffer);
  missing.delete(id);
  if (peakData) peaks.set(id, peakData);
}

/** Synchronous lookup used by the audio scheduler. Never decodes. */
/**
 * Source length in seconds for any media id, procedural or recorded.
 *
 * The procedural demo table only knows about generated loops and drum hits;
 * asking it about a recorded take returns 0, which is why mid-clip playback
 * entry used to fall silent on every real recording. A decoded buffer is the
 * truth when one is cached, the project's own MediaRef is the truth when it is
 * not, and the procedural table is the last resort.
 */
export function mediaDurationSec(id: string, refDuration?: number): number {
  const buf = buffers.get(id);
  if (buf) return buf.duration;
  if (typeof refDuration === 'number' && refDuration > 0) return refDuration;
  return getMediaDurationSec(id);
}

export function getBufferSync(id: string): AudioBuffer | null {
  if (isProceduralMediaId(id)) return getProceduralBuffer(id);
  return buffers.get(id) ?? null;
}

export function isMissing(id: string): boolean {
  return missing.has(id);
}

/**
 * Does this media exist at all? Answers without an AudioContext and without
 * decoding, so a clip can show its missing state before the user has started
 * audio — otherwise absent media is indistinguishable from silence.
 */
export async function mediaExists(id: string): Promise<boolean> {
  if (isProceduralMediaId(id)) return true;
  if (buffers.has(id) || peaks.has(id)) return true;
  if (missing.has(id)) return false;
  try {
    const stored = await getMediaBlob(id);
    const found = !!stored?.blob;
    if (!found) missing.add(id);
    return found;
  } catch {
    return false;
  }
}

export function knownMediaIds(): string[] {
  return [...buffers.keys()];
}

/**
 * Resolve a media id to a decoded buffer, loading from IndexedDB and decoding
 * on first use. Concurrent callers share one in-flight promise.
 */
export async function loadBuffer(id: string, ctx: BaseAudioContext): Promise<AudioBuffer | null> {
  if (isProceduralMediaId(id)) return getProceduralBuffer(id);
  const cached = buffers.get(id);
  if (cached) return cached;
  const running = inflight.get(id);
  if (running) return running;

  const task = (async (): Promise<AudioBuffer | null> => {
    try {
      const stored = await getMediaBlob(id);
      if (!stored?.blob) {
        missing.add(id);
        diagLog('warn', `Media "${id}" not found in storage — clip will show as missing`);
        return null;
      }
      const bytes = await stored.blob.arrayBuffer();
      const buf = await ctx.decodeAudioData(bytes);
      buffers.set(id, buf);
      missing.delete(id);
      if (!peaks.has(id)) {
        const cachedPeaks = await getPeaks(id);
        if (cachedPeaks) peaks.set(id, cachedPeaks);
        else {
          const p = peaksFromAudioBuffer(buf);
          peaks.set(id, p);
          void putPeaks(id, p);
        }
      }
      return buf;
    } catch (e) {
      missing.add(id);
      diagLog('error', `Failed to decode media "${id}": ${e instanceof Error ? e.message : e}`);
      return null;
    } finally {
      inflight.delete(id);
    }
  })();

  inflight.set(id, task);
  return task;
}

/** Peaks for waveform drawing. Synchronous; returns null until loaded. */
export function getPeaksSync(id: string): PeakData | null {
  if (isProceduralMediaId(id)) {
    const p = getProceduralPeaks(id);
    if (!p) return null;
    // adapt the demo generator's mono envelope to the shared PeakData shape
    const existing = peaks.get(id);
    if (existing) return existing;
    const adapted: PeakData = {
      version: 1,
      buckets: p.max.length,
      channels: 1,
      duration: getProceduralBuffer(id)?.duration ?? 0,
      min: p.min,
      max: p.max,
    };
    peaks.set(id, adapted);
    return adapted;
  }
  return peaks.get(id) ?? null;
}

/** Load peaks without decoding the whole file when a cached envelope exists. */
export async function loadPeaks(id: string, ctx: BaseAudioContext): Promise<PeakData | null> {
  const have = getPeaksSync(id);
  if (have) return have;
  const cached = await getPeaks(id);
  if (cached) {
    peaks.set(id, cached);
    return cached;
  }
  const buf = await loadBuffer(id, ctx);
  return buf ? (getPeaksSync(id) ?? peaksFromAudioBuffer(buf)) : null;
}

/**
 * Warm the caches for every media id a project references, so the first play
 * does not stall while a take decodes, and report what could not be found.
 *
 * Called after a project is loaded, and only once the audio context exists —
 * before that there is nothing about to play, and decoding would be work done
 * for a session that may never start.
 */
export async function preloadProjectMedia(
  usedIds: readonly string[],
  ctx: BaseAudioContext,
): Promise<{ loaded: number; missing: string[] }> {
  const ids = [...new Set(usedIds)].filter((id) => !isProceduralMediaId(id));
  let loaded = 0;
  for (const id of ids) {
    const buf = await loadBuffer(id, ctx);
    if (buf) loaded++;
  }
  return { loaded, missing: ids.filter((id) => missing.has(id)) };
}

/** Drop cached decode results (used when media is deleted). */
export function evict(id: string): void {
  buffers.delete(id);
  peaks.delete(id);
  missing.delete(id);
}

/**
 * Evict every cached decode the given project does not reference. Decoded
 * PCM is large (~10 MB/min stereo), so leaving old projects' buffers cached
 * would grow memory for the whole session. Procedural ids are cheap and
 * regenerable; they are evicted too when unreferenced.
 */
export function retainOnly(keep: ReadonlySet<string>): void {
  let dropped = 0;
  for (const id of [...buffers.keys()]) {
    if (!keep.has(id)) {
      evict(id);
      dropped++;
    }
  }
  for (const id of [...peaks.keys()]) {
    if (!keep.has(id)) {
      peaks.delete(id);
    }
  }
  missing.clear();
  if (dropped > 0) diagLog('info', `Media cache: evicted ${dropped} unused decoded buffer(s)`);
}

export function cacheStats(): { buffers: number; peaks: number; missing: number } {
  return { buffers: buffers.size, peaks: peaks.size, missing: missing.size };
}

/** Test seam. */
export function resetMediaCaches(): void {
  buffers.clear();
  peaks.clear();
  inflight.clear();
  missing.clear();
}
