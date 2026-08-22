/**
 * Making a warp map audible.
 *
 * A warp map says which musical beat every point in a recording lands on. To
 * hear that, the recording is re-rendered onto its own musical grid: the map's
 * segments are stretched so that a beat always takes the same amount of time,
 * the time the source's own tempo says it should. The result is a buffer that
 * is already in time, so everything downstream — tempo follow, `stretch`,
 * `transpose` — keeps working exactly as it did on an unwarped clip, and an
 * unwarped clip renders to a copy of itself.
 *
 * Rendering rather than riding a `playbackRate` is what keeps the pitch still
 * while the timing moves; the segments go through the same WSOLA stretcher the
 * tempo-follow path uses. Segments are stretched independently and then
 * cross-faded back together, because two separately-stretched blocks butted
 * end to end disagree about phase at the splice and click.
 *
 * Everything above `renderWarpedBuffer` is pure: Float32Array in, Float32Array
 * out, no Web Audio and no store. Only the render and its cache know what an
 * `AudioBuffer` is.
 */
import { getBufferSync } from './mediaLibrary';
import { stretchChannel } from './timestretch';
import type { ClipTiming } from './clipSchedule';
import { clampBpm } from '../model/tempo';
import { normalizeWarpMap, sourceToBeat, type WarpMap } from '../model/warp';
import type { AudioClip } from '../model/types';
import { diagLog } from '../state/diagnostics';

/**
 * Cross-fade across a join, in seconds. Long enough to hide the phase step
 * between two independently stretched segments, short enough that it does not
 * smear the transient the marker was placed on in the first place.
 */
const JOIN_FADE_SEC = 0.006;

export interface WarpSegment {
  /** Source seconds this segment reads. */
  fromSec: number;
  toSec: number;
  /** Warped seconds it is written to. */
  outFromSec: number;
  outToSec: number;
}

/** A map only bends time once it pins two points; one marker is just an anchor. */
export function isWarped(map: WarpMap | undefined): map is WarpMap {
  return !!map && Array.isArray(map.markers) && map.markers.length >= 2;
}

/** The clip's map, normalised, or null when it cannot bend anything. */
export function clipWarpMap(clip: AudioClip): WarpMap | null {
  if (!isWarped(clip.warp)) return null;
  const map = normalizeWarpMap(clip.warp, clip.sourceBpm ?? clip.warp.sourceBpm);
  return isWarped(map) ? map : null;
}

/**
 * Where a point in the source ends up on the warped timeline, in seconds.
 *
 * Anchored at source zero so the head of the file never moves: the map runs at
 * the recording's own tempo in front of the first marker, and a musician who
 * warps the first downbeat of a take does not expect the count-in to slide.
 */
export function warpedTimeSec(map: WarpMap, sourceSec: number): number {
  const beatsPerSec = clampBpm(map.sourceBpm) / 60;
  return (sourceToBeat(map, sourceSec) - sourceToBeat(map, 0)) / beatsPerSec;
}

/** The clip's trim expressed in warped seconds, for `computeClipSchedule`. */
export function warpedClipTiming(timing: ClipTiming, map: WarpMap): ClipTiming {
  const offset = warpedTimeSec(map, timing.offset);
  const source = timing.sourceDuration;
  return {
    ...timing,
    offset,
    ...(source !== undefined
      ? { sourceDuration: warpedTimeSec(map, timing.offset + source) - offset }
      : {}),
  };
}

/**
 * Cut the source at every marker inside it. The mapping is linear between two
 * markers and runs at the recorded tempo outside them, so each piece is a
 * constant-rate stretch and nothing else is needed to describe the whole map.
 */
export function warpSegments(map: WarpMap, durationSec: number): WarpSegment[] {
  if (!(durationSec > 0)) return [];
  const cuts = [0];
  for (const m of map.markers) {
    if (m.sourceSec > cuts[cuts.length - 1] + 1e-9 && m.sourceSec < durationSec - 1e-9) {
      cuts.push(m.sourceSec);
    }
  }
  cuts.push(durationSec);

  const segments: WarpSegment[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    segments.push({
      fromSec: cuts[i],
      toSec: cuts[i + 1],
      outFromSec: warpedTimeSec(map, cuts[i]),
      outToSec: warpedTimeSec(map, cuts[i + 1]),
    });
  }
  return segments;
}

/** Warp one channel onto the musical grid. An unbent map returns a copy. */
export function warpChannel(samples: Float32Array, sampleRate: number, map: WarpMap): Float32Array {
  const n = samples.length;
  if (n === 0 || !(sampleRate > 0)) return samples.slice();
  const segments = warpSegments(map, n / sampleRate);
  if (segments.length < 2) return samples.slice();

  const outLength = Math.max(1, Math.round(warpedTimeSec(map, n / sampleRate) * sampleRate));
  const out = new Float32Array(outLength);

  // Sample geometry for the whole map before any stretching, because a join's
  // cross-fade has to be the same length on both sides of it: two linear ramps
  // over one shared window sum back to unity, two different ones do not.
  const plan = segments.map((s, i) => {
    const last = i === segments.length - 1;
    const inStart = Math.round(s.fromSec * sampleRate);
    const inEnd = last ? n : Math.round(s.toSec * sampleRate);
    const outStart = Math.round(s.outFromSec * sampleRate);
    const outEnd = last ? outLength : Math.round(s.outToSec * sampleRate);
    return {
      inStart,
      inEnd,
      outStart,
      outEnd,
      ratio: (outEnd - outStart) / Math.max(1, inEnd - inStart),
    };
  });

  const maxFade = Math.max(1, Math.round(JOIN_FADE_SEC * sampleRate));
  // fade[i] is the half-width of the cross-fade at the START of segment i.
  const fade = new Array<number>(plan.length).fill(0);
  for (let i = 1; i < plan.length; i++) {
    const before = plan[i - 1];
    const after = plan[i];
    fade[i] = Math.max(
      0,
      Math.min(
        maxFade,
        // Never past a segment's own midpoint, or the head and tail ramps of a
        // short segment would overlap and the sum would dip.
        Math.floor((before.outEnd - before.outStart) / 2),
        Math.floor((after.outEnd - after.outStart) / 2),
        // Nor past the material either side can actually supply.
        Math.floor((n - before.inEnd) * before.ratio),
        Math.floor(after.inStart * after.ratio),
      ),
    );
  }

  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    const bodyLen = p.outEnd - p.outStart;
    if (bodyLen <= 0 || p.inEnd <= p.inStart) continue;
    const left = fade[i];
    const right = i + 1 < plan.length ? fade[i + 1] : 0;
    // Extra source either side so the ramps have real material to fade, rather
    // than fading the segment into silence at each join.
    const padHead = left > 0 ? Math.min(p.inStart, Math.ceil(left / p.ratio)) : 0;
    const padTail = right > 0 ? Math.min(n - p.inEnd, Math.ceil(right / p.ratio)) : 0;
    // A ratio outside the stretcher's usable range is clamped by it, so an
    // absurd segment comes out short (silence at its tail) or long (truncated)
    // rather than aliased into noise.
    const stretched = stretchChannel(
      samples.subarray(p.inStart - padHead, p.inEnd + padTail),
      sampleRate,
      p.ratio,
    );
    const bodyAt = Math.round(padHead * p.ratio);

    for (let k = -left; k < bodyLen + right; k++) {
      const from = bodyAt + k;
      const to = p.outStart + k;
      if (from < 0 || from >= stretched.length || to < 0 || to >= outLength) continue;
      let gain = 1;
      if (left > 0 && k < left) gain = (k + left) / (2 * left);
      else if (right > 0 && k >= bodyLen - right) gain = (bodyLen + right - k) / (2 * right);
      out[to] += stretched[from] * gain;
    }
  }
  return out;
}

/** Render a whole buffer through its map. Synchronous and heavy. */
export function renderWarpedBuffer(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  map: WarpMap,
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const length = Math.max(1, Math.round(warpedTimeSec(map, buffer.duration) * sampleRate));
  const out = ctx.createBuffer(buffer.numberOfChannels, length, sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const warped = warpChannel(buffer.getChannelData(c), sampleRate, map);
    out.copyToChannel(warped.length === length ? warped : fitLength(warped, length), c);
  }
  return out;
}

function fitLength(samples: Float32Array, length: number): Float32Array {
  const out = new Float32Array(length);
  out.set(samples.subarray(0, Math.min(samples.length, length)));
  return out;
}

/**
 * Identity of a map, for caching. Rounded to a millisecond and a thousandth of
 * a beat: finer than a marker drag can express, so a redraw cannot spawn a
 * render the ear could not tell from the one already in the cache.
 */
export function warpKey(map: WarpMap): string {
  let key = clampBpm(map.sourceBpm).toFixed(2);
  for (const m of map.markers) key += `|${m.sourceSec.toFixed(3)},${m.beat.toFixed(3)}`;
  return key;
}

interface Entry {
  buffer: AudioBuffer | null;
  /** true while the render is running, so it is not started twice */
  pending: boolean;
}

const cache = new Map<string, Entry>();
const MAX_ENTRIES = 16;

/**
 * The warped buffer for a clip's map, or null while it is being made.
 *
 * Null rather than a wait: playback falls back to the unwarped source, exactly
 * as the stretch cache does, because a clip that is briefly not yet warped is
 * better than a clip that is silent for a bar after every marker drag.
 */
export function warpedBuffer(
  ctx: BaseAudioContext,
  mediaId: string,
  map: WarpMap,
): AudioBuffer | null {
  const key = `${mediaId}|${warpKey(map)}`;
  const hit = cache.get(key);
  if (hit) {
    // Re-insert so the eviction below drops the least recently *used* entry.
    // A Map evicts in insertion order otherwise, and looping a section holding
    // more warped clips than the cache does would then throw away the clip
    // about to play again, on every pass.
    cache.delete(key);
    cache.set(key, hit);
    return hit.buffer;
  }

  const source = getBufferSync(mediaId);
  if (!source) return null;
  const entry: Entry = { buffer: null, pending: true };
  cache.set(key, entry);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest && oldest !== key) cache.delete(oldest);
  }

  // Off the frame that asked for it: a warp render walks the whole file.
  setTimeout(() => {
    try {
      entry.buffer = renderWarpedBuffer(ctx, source, map);
    } catch (e) {
      diagLog('warn', `Warp render failed for ${mediaId}: ${String(e)}`);
      entry.buffer = source;
    } finally {
      entry.pending = false;
    }
  }, 0);
  return null;
}

/** Drop every render for one media id (its bytes changed, or it was removed). */
export function invalidateWarp(mediaId: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${mediaId}|`)) cache.delete(key);
  }
}

export function clearWarpCache(): void {
  cache.clear();
}
