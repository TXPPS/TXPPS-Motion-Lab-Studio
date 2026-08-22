/**
 * Warp maps: the correspondence between a recording's own timeline and the
 * song's musical timeline.
 *
 * A warp marker pins one point in the source to one musical position. Between
 * two markers the mapping is linear, so a segment plays at a constant rate and
 * a musician can see and edit exactly what the stretch is doing. Outside the
 * markers the map continues at the source's own recorded tempo rather than at
 * the rate of the nearest segment: a marker placed at the first downbeat of a
 * loop must not retime the count-in in front of it.
 *
 * The map is deliberately tempo-free. It says which beat a source second lands
 * on, not what time that beat happens at — the project's tempo map owns that.
 * The playback rate an engine needs is therefore
 *
 *     rate = (songBpm / sourceBpm) * stretchRatioAt(map, beat)
 *
 * where the first factor is the song asking the clip to keep up and the second
 * is the warp map's own local correction. With no markers the second factor is
 * exactly 1 and tempo-follow reduces to plain resampling.
 *
 * Pure: no DOM, no Web Audio, no React.
 */
import { clampBpm } from './tempo';
import type { Transient } from './transients';

export interface WarpMarker {
  /** Position in the source recording, in seconds. */
  sourceSec: number;
  /** Musical position that source point is pinned to, in quarter-note beats. */
  beat: number;
}

export interface WarpMap {
  /** Sorted by `sourceSec`, strictly increasing in both fields. */
  markers: WarpMarker[];
  /** Tempo the source was recorded at; sets the rate outside the markers. */
  sourceBpm: number;
}

export interface WarpFromTransientsOptions {
  /** Onsets weaker than this are ignored; weak onsets snap to the wrong slot. */
  minStrength?: number;
  /** Furthest an onset may be from its grid slot, in beats. Defaults to half a slot. */
  maxSnapBeats?: number;
}

/** Beats per source second at the recording's own tempo. */
function nativeRate(sourceBpm: number): number {
  return clampBpm(sourceBpm) / 60;
}

/**
 * Drop everything the piecewise-linear mapping cannot represent, then sort.
 *
 * Two markers at the same source second would need an infinite rate to get
 * between them; a later marker at an earlier beat would need a negative one,
 * which is a source played backwards. Both come from ordinary editing — dragging
 * one marker past its neighbour — so they are removed rather than rejected, the
 * earlier marker winning because it is the one the musician placed first.
 */
export function normalizeWarpMap(map: Partial<WarpMap> | undefined, fallbackBpm = 120): WarpMap {
  const sourceBpm = clampBpm(map?.sourceBpm ?? fallbackBpm);
  const sorted = (map?.markers ?? [])
    .filter(
      (m): m is WarpMarker =>
        !!m && Number.isFinite(m.sourceSec) && Number.isFinite(m.beat) && m.sourceSec >= 0,
    )
    .map((m) => ({ sourceSec: m.sourceSec, beat: m.beat }))
    .sort((a, b) => a.sourceSec - b.sourceSec || a.beat - b.beat);

  const markers: WarpMarker[] = [];
  for (const m of sorted) {
    const last = markers[markers.length - 1];
    if (last && (m.sourceSec <= last.sourceSec || m.beat <= last.beat)) continue;
    markers.push(m);
  }
  return { markers, sourceBpm };
}

export function createWarpMap(markers: readonly WarpMarker[], sourceBpm: number): WarpMap {
  return normalizeWarpMap({ markers: [...markers], sourceBpm });
}

/** An unwarped clip: the source plays at its own tempo, forever. */
export function resetWarp(map: WarpMap): WarpMap {
  return { markers: [], sourceBpm: clampBpm(map.sourceBpm) };
}

/** Index of the last marker at or before `value`, or -1. Binary search. */
function findSegment(markers: readonly WarpMarker[], value: number, byBeat: boolean): number {
  let lo = 0;
  let hi = markers.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const at = byBeat ? markers[mid].beat : markers[mid].sourceSec;
    if (at <= value) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Musical position of a point in the source. */
export function sourceToBeat(map: WarpMap, sourceSec: number): number {
  const { markers } = map;
  const rate = nativeRate(map.sourceBpm);
  if (markers.length === 0) return sourceSec * rate;

  const i = findSegment(markers, sourceSec, false);
  if (i < 0) {
    const first = markers[0];
    return first.beat + (sourceSec - first.sourceSec) * rate;
  }
  if (i >= markers.length - 1) {
    const last = markers[markers.length - 1];
    return last.beat + (sourceSec - last.sourceSec) * rate;
  }
  const a = markers[i];
  const b = markers[i + 1];
  const t = (sourceSec - a.sourceSec) / (b.sourceSec - a.sourceSec);
  return a.beat + t * (b.beat - a.beat);
}

/** Point in the source that plays at a musical position. */
export function beatToSource(map: WarpMap, beat: number): number {
  const { markers } = map;
  const rate = nativeRate(map.sourceBpm);
  if (markers.length === 0) return beat / rate;

  const i = findSegment(markers, beat, true);
  if (i < 0) {
    const first = markers[0];
    return first.sourceSec + (beat - first.beat) / rate;
  }
  if (i >= markers.length - 1) {
    const last = markers[markers.length - 1];
    return last.sourceSec + (beat - last.beat) / rate;
  }
  const a = markers[i];
  const b = markers[i + 1];
  const t = (beat - a.beat) / (b.beat - a.beat);
  return a.sourceSec + t * (b.sourceSec - a.sourceSec);
}

/**
 * Local playback-rate multiple at a musical position: 1 is the source's own
 * speed, 0.5 is half speed, 2 is double. This is the per-grain number a stretch
 * engine needs, and it is what `AudioClip.stretch` means for an unwarped clip.
 */
export function stretchRatioAt(map: WarpMap, beat: number): number {
  const { markers } = map;
  if (markers.length < 2) return 1;
  const i = findSegment(markers, beat, true);
  if (i < 0 || i >= markers.length - 1) return 1;
  const a = markers[i];
  const b = markers[i + 1];
  const beats = b.beat - a.beat;
  if (!(beats > 0)) return 1;
  const secondsPerBeat = (b.sourceSec - a.sourceSec) / beats;
  return secondsPerBeat * nativeRate(map.sourceBpm);
}

/** Total musical length of a source of `durationSec`, for laying the clip out. */
export function warpedBeatLength(map: WarpMap, durationSec: number): number {
  return sourceToBeat(map, durationSec) - sourceToBeat(map, 0);
}

/**
 * Build a map from detected onsets by snapping each one to the nearest slot of a
 * grid, on the assumption that a player aiming at the beat lands near it.
 *
 * Weak onsets are discarded before snapping rather than after: an onset the
 * detector is unsure about is exactly the one likely to snap to the wrong slot
 * and drag a whole bar of audio with it. When two onsets claim the same slot the
 * stronger one keeps it — the other is a ghost note or a flam.
 */
export function warpFromTransients(
  transients: readonly Transient[],
  sourceBpm: number,
  gridBeats: number,
  options: WarpFromTransientsOptions = {},
): WarpMap {
  const bpm = clampBpm(sourceBpm);
  const grid = Number.isFinite(gridBeats) && gridBeats > 0 ? gridBeats : 1;
  const minStrength = options.minStrength ?? 0.25;
  const maxSnap = options.maxSnapBeats ?? grid / 2;
  const rate = nativeRate(bpm);

  const ranked = transients
    .filter((t) => Number.isFinite(t.timeSec) && t.timeSec >= 0 && t.strength >= minStrength)
    .slice()
    .sort((a, b) => b.strength - a.strength || a.timeSec - b.timeSec);

  const claimed = new Map<number, WarpMarker>();
  for (const t of ranked) {
    const nominal = t.timeSec * rate;
    const slot = Math.round(nominal / grid);
    if (Math.abs(slot * grid - nominal) > maxSnap) continue;
    if (claimed.has(slot)) continue;
    claimed.set(slot, { sourceSec: t.timeSec, beat: slot * grid });
  }
  return createWarpMap([...claimed.values()], bpm);
}

/**
 * Pull every marker part of the way onto a grid. `strength` 0 changes nothing
 * and 1 puts every marker exactly on its slot; anything between tightens the
 * timing while leaving the feel of the performance.
 */
export function quantizeWarp(map: WarpMap, strength: number, grid: number): WarpMap {
  const amount = strength < 0 ? 0 : strength > 1 ? 1 : strength;
  const slot = Number.isFinite(grid) && grid > 0 ? grid : 1;
  if (amount === 0) return normalizeWarpMap(map);
  const markers = map.markers.map((m) => ({
    sourceSec: m.sourceSec,
    beat: m.beat + amount * (Math.round(m.beat / slot) * slot - m.beat),
  }));
  return createWarpMap(markers, map.sourceBpm);
}
