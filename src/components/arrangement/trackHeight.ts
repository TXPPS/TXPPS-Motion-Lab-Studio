/**
 * How tall a track lane is, and who decides.
 *
 * Three inputs, and until now only one of them was live. `Track.height` has
 * been in the schema since v6, clamped on load in `projectRepo.ts`, and read by
 * nothing — a field the persistence layer maintained for a feature that did not
 * exist. `laneScale` was the whole story, it lived in `uiStore`, and it was
 * reachable only by dragging with the zoom tool: a view control with no button,
 * no key and no readout, that a reload threw away.
 *
 * So the three combine as follows, and the order matters:
 *
 *   1. `collapsed` wins outright. A collapsed track is a track the user asked
 *      to stop looking at, and it is not a smaller version of an open one —
 *      the header drops its whole control strip at that size. Scaling a
 *      collapsed lane would make "collapsed" mean six different heights.
 *   2. Otherwise the base is `track.height ?? LANE_H`. Per-track, because
 *      that is what a resize grip on one header can mean; the default when
 *      unset, so a project that has never been resized is unchanged.
 *   3. `laneScale` multiplies that base. It is the *view* zoom — one number for
 *      the whole arrangement — and multiplying rather than replacing is what
 *      keeps a deliberately tall vocal track taller than its neighbours at
 *      every zoom. Replacing would make the global control silently discard
 *      every per-track decision the user had made.
 *   4. The floor is applied last, on READ, and it depends on the hand.
 *
 * The floor on read is the piano roll's pattern (`../pianoroll/geometry.ts`)
 * and it is here for the same reason. A lane is the target for every clip on
 * it and for the header's own controls, so a 30 px collapsed lane on a phone is
 * a row a finger cannot land on — and the hand can change after the value was
 * stored. Clamping on write would put a desktop's 24 px on a tablet the moment
 * its keyboard came off.
 */
import { useEffect, useState } from 'react';
import { clamp } from '../../model/music';
import { MAX_LANE_SCALE, MIN_LANE_SCALE } from '../../model/arrangeTools';
import type { Track } from '../../model/types';

/** The lane height a track has when it has never been resized. */
export const LANE_H = 64;

/**
 * A collapsed lane, on a mouse.
 *
 * 30 px is the name row and nothing else, which is the whole point: a collapsed
 * track says which track it is and gets out of the way. On a finger it is
 * raised to `TOUCH_LANE_MIN` by the floor below, because the collapsed header
 * still carries the track menu — the only route to that track's own commands
 * when the control strip is not drawn.
 */
export const LANE_H_COLLAPSED = 30;

/**
 * The touch minimum, WCAG 2.5.8's number and the one the rest of this product
 * measures against. No lane the arrangement draws may be under it on a coarse
 * pointer, collapsed lanes included.
 */
export const TOUCH_LANE_MIN = 44;

/**
 * The smallest lane a mouse may have.
 *
 * Deliberately below `LANE_H_COLLAPSED`: a fine pointer is allowed to collapse
 * a track to 30 px, and 24 is WCAG 2.5.8's pointer-target minimum, which is
 * what a lane still has to satisfy as a drag target for the clips on it.
 */
export const FINE_LANE_MIN = 24;

/** The tallest a single track may be dragged to. Matches `projectRepo`'s clamp. */
export const LANE_MAX = 400;

/**
 * Does this browser say the primary pointer is a finger?
 *
 * Read at call time rather than cached, for the reason `geometry.ts` gives: a
 * tablet with a keyboard attached can change its answer, and a value decided at
 * import time would go on asking a finger to hit a 30 px row for the rest of
 * the session.
 */
export function coarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** The smallest lane the hand currently in use may be given. */
export function laneFloor(coarse = coarsePointer()): number {
  return coarse ? TOUCH_LANE_MIN : FINE_LANE_MIN;
}

/**
 * The hand in use, as state, so a change of hand redraws the lanes.
 *
 * The piano roll reads `coarsePointer()` straight and gets away with it because
 * its floor is applied on every render and its own controls force those
 * renders. The arrangement resolves its band heights in a `useMemo` keyed on
 * the project and the zoom — neither of which moves when a tablet's keyboard is
 * detached — so without a subscription the floor would be applied at whatever
 * the pointer was when the arrangement last had a reason to re-render. That is
 * exactly the staleness clamping on read exists to prevent, so the query is
 * subscribed to rather than sampled.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(coarsePointer);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(pointer: coarse)');
    const onChange = () => setCoarse(query.matches);
    // Re-read on mount as well as on change: the first render's `useState`
    // initialiser ran before this effect, and in a server or test environment
    // that had no `matchMedia` it answered false permanently.
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return coarse;
}

/**
 * The height one track's clip lane is drawn at, in whole pixels.
 *
 * Rounded once, here. A fractional height that each caller rounds separately
 * drifts a pixel per track between the header column and the lane column, and
 * lands a cross-track clip drag on the wrong lane — which is why `laneHeightAt`
 * rounded in one place before this module existed, and why this still does.
 */
export function trackLaneHeight(
  track: Pick<Track, 'height' | 'collapsed'>,
  laneScale: number,
  coarse = coarsePointer(),
): number {
  const scale = clamp(laneScale, MIN_LANE_SCALE, MAX_LANE_SCALE);
  const base = track.collapsed ? LANE_H_COLLAPSED : (track.height ?? LANE_H) * scale;
  return Math.round(clamp(base, laneFloor(coarse), LANE_MAX));
}

/**
 * Whether the header should draw its collapsed form: name row only, no strip.
 *
 * It was `height <= 32` in `TrackHeader.tsx` — a second constant that agreed
 * with `LANE_H_COLLAPSED = 30` by coincidence — and the first attempt at
 * deriving it kept the same shape, comparing the height against the collapsed
 * height. **That is not derivable from the height, and the touch floor is why.**
 * On a coarse pointer the floor raises a collapsed lane to 44 and it also
 * raises the shortest *open* lane to 44, so the two states arrive at the same
 * number: a threshold answering from the height alone reported every open track
 * on a phone at minimum zoom as collapsed, and would have taken the control
 * strip off all of them. The unit test wrote that case down before the product
 * ever drew it.
 *
 * So it asks the flag, which is the thing that actually decides, and takes the
 * height only for what the flag cannot tell it: whether a lane the user has
 * left open has been dragged down to where the strip no longer fits. `LANE_H_
 * COLLAPSED + 2` is that point on a mouse — 2 px of slack for the rounding, not
 * a threshold — and on a finger nothing is ever below the floor, so the second
 * clause simply never fires there. That asymmetry is the correct one: a finger
 * cannot produce a lane too short for its own strip, because the floor exists.
 */
export function isCollapsedHeight(
  height: number,
  collapsed?: boolean,
  coarse = coarsePointer(),
): boolean {
  if (collapsed) return true;
  return !coarse && height <= LANE_H_COLLAPSED + 2;
}

/**
 * A height a grip drag is asking for, held to what the hand can use.
 *
 * Clamped on write as well as on read, and both are load-bearing: this stops a
 * drag storing a number the user cannot undo by dragging back, and the read
 * clamp in `trackLaneHeight` stops a stored desktop value reaching a finger.
 *
 * **Not rounded**, unlike the drawn height. The stored value is a *base* that
 * the global scale multiplies, so rounding it here is an error the scale then
 * amplifies: a base rounded by half a pixel draws 1.25 px off at the maximum
 * zoom, and the touch menu's "one press is 16 drawn pixels" became 15 at a
 * scale of 1.75. Rounding belongs where the pixels are, which is
 * `trackLaneHeight`, and it happens there exactly once.
 */
export function clampTrackHeight(px: number, coarse = coarsePointer()): number {
  return clamp(px, laneFloor(coarse), LANE_MAX);
}

/**
 * One press of the menu's Taller / Shorter, in pixels of drawn lane.
 *
 * A fixed step rather than a ratio, unlike the global zoom. The menu is the
 * touch route to a gesture that is a *drag* on a mouse, and a drag moves the
 * edge by pixels; a ratio would move a 44 px lane by 11 and a 300 px one by 75,
 * so the same command would feel like two different controls depending on where
 * you started. 16 px is four presses across the default lane, which is roughly
 * what the grip gives for a comfortable drag.
 */
export const TRACK_HEIGHT_STEP = 16;

/**
 * The height one press of Taller or Shorter asks for.
 *
 * Measured from what the track is *drawn* at rather than from `track.height`,
 * because that field is usually unset — the first press on a default track has
 * to start from the height on screen, or it would jump to 16 px and be clamped
 * to the floor. Dividing the drawn height back out by the scale is what keeps
 * the step a step in *drawn* pixels while the stored value stays a pre-scale
 * base: pressing Taller once must make the lane 16 px taller whatever the
 * global zoom is set to.
 */
export function stepTrackHeight(
  track: Pick<Track, 'height' | 'collapsed'>,
  laneScale: number,
  direction: 1 | -1,
  coarse = coarsePointer(),
): number {
  const scale = clamp(laneScale, MIN_LANE_SCALE, MAX_LANE_SCALE) || 1;
  const drawn = trackLaneHeight(track, laneScale, coarse);
  return clampTrackHeight((drawn + direction * TRACK_HEIGHT_STEP) / scale, coarse);
}

/** One step of the taller/shorter controls, as a ratio. Matches the zoom buttons. */
export const LANE_SCALE_STEP = 1.25;

/** Step the global lane scale by a ratio, held inside its range. */
export function stepLaneScale(current: number, factor: number): number {
  // Quantised to a hundredth so repeated steps cannot accumulate a value whose
  // readout says 110% twice in a row while the lanes move a pixel each time.
  return clamp(Math.round(current * factor * 100) / 100, MIN_LANE_SCALE, MAX_LANE_SCALE);
}
