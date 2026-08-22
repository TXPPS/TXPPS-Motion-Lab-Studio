/**
 * Editing a warp map with a pointer.
 *
 * The gestures a warp lane needs, kept away from the DOM so the rules can be
 * stated once and tested: a marker may be dragged only within the room its
 * neighbours leave it, adding one must not move the audio that is already
 * playing correctly, and removing one must leave a map that still maps.
 *
 * Positions here are source seconds — the recording's own timeline, which is
 * what the waveform under the markers is drawn on.
 *
 * Pure: no DOM, no Web Audio, no React.
 */
import { createWarpMap, sourceToBeat, type WarpMap } from './warp';

/**
 * Closest two markers may sit, in source seconds. Below a few milliseconds the
 * segment between them needs a runaway rate and the pair stops being separable
 * by a pointer at any sane zoom.
 */
export const MIN_MARKER_GAP_SEC = 0.02;

/** Index of the marker within `toleranceSec` of a point, nearest first, or -1. */
export function warpMarkerNear(map: WarpMap, sourceSec: number, toleranceSec: number): number {
  let best = -1;
  let bestDistance = toleranceSec;
  map.markers.forEach((m, i) => {
    const d = Math.abs(m.sourceSec - sourceSec);
    if (d <= bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return best;
}

/** The detected onset within `toleranceSec` of a point, or null. */
export function nearestTransient(
  transients: readonly number[] | undefined,
  sourceSec: number,
  toleranceSec: number,
): number | null {
  let best: number | null = null;
  let bestDistance = toleranceSec;
  for (const t of transients ?? []) {
    if (!Number.isFinite(t)) continue;
    const d = Math.abs(t - sourceSec);
    if (d <= bestDistance) {
      bestDistance = d;
      best = t;
    }
  }
  return best;
}

/**
 * Drag one marker to a new point in the source, keeping the beat it is pinned
 * to. That is the warp gesture: the beat stays where the song puts it and the
 * audio that lands on it changes, so sliding a marker onto a late snare pulls
 * the snare back onto the beat.
 *
 * The move is clamped inside its neighbours rather than reordering them. A
 * marker that jumped its neighbour would be dropped by the map's own
 * normalisation, and a musician who drags too far means "as far as it goes",
 * not "delete the marker I was aiming past".
 */
export function moveWarpMarker(
  map: WarpMap,
  index: number,
  sourceSec: number,
  maxSourceSec?: number,
): WarpMap {
  const markers = map.markers;
  if (index < 0 || index >= markers.length || !Number.isFinite(sourceSec)) return map;

  const low = index > 0 ? markers[index - 1].sourceSec + MIN_MARKER_GAP_SEC : 0;
  const high = Math.min(
    index < markers.length - 1 ? markers[index + 1].sourceSec - MIN_MARKER_GAP_SEC : Infinity,
    maxSourceSec ?? Infinity,
  );
  // Neighbours already closer together than the gap leave nowhere to land.
  if (!(high > low)) return map;

  const at = Math.min(high, Math.max(low, sourceSec));
  const next = markers.map((m, i) => (i === index ? { sourceSec: at, beat: m.beat } : m));
  return createWarpMap(next, map.sourceBpm);
}

/**
 * Add a marker at a point in the source, pinned to the beat that point already
 * plays on — so adding one is silent, and only the drag that follows moves
 * anything. Returns the map unchanged when a marker is already there.
 */
export function addWarpMarker(map: WarpMap, sourceSec: number): WarpMap {
  if (!Number.isFinite(sourceSec) || sourceSec < 0) return map;
  if (warpMarkerNear(map, sourceSec, MIN_MARKER_GAP_SEC) >= 0) return map;
  return createWarpMap(
    [...map.markers, { sourceSec, beat: sourceToBeat(map, sourceSec) }],
    map.sourceBpm,
  );
}

export function removeWarpMarker(map: WarpMap, index: number): WarpMap {
  if (index < 0 || index >= map.markers.length) return map;
  return createWarpMap(
    map.markers.filter((_, i) => i !== index),
    map.sourceBpm,
  );
}
