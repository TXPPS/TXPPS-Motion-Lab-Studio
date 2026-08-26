/**
 * How tall a piano-roll lane is, and who decides.
 *
 * It was `const ROW_H = 16`, which is two things at once: a pitch lane is 16px
 * on every device, and the roll has **one** zoom axis. Both are wrong for the
 * same reason. A note is a target, and 16px is under half the touch minimum, so
 * on a phone the roll asked a finger to hit a lane a third of its width; and a
 * musician editing a two-octave line wants tall lanes and a wide bar, while one
 * checking the shape of a whole verse wants the opposite. A single zoom cannot
 * give both, and a fixed lane height cannot give either.
 *
 * So the height is state, it has its own control, and it has a floor that
 * depends on the hand. The floor is not a preference: a lane below it is a
 * target a finger cannot land on, and a roll that lets you zoom into an
 * unusable state has a control that produces a defect.
 */
import { useUiStore } from '../../state/uiStore';

/**
 * The touch minimum, and the same number the responsive audit uses everywhere
 * else. A lane is the target for every note on it, so it is the one dimension
 * in the roll that cannot be traded for density.
 */
export const TOUCH_ROW_MIN = 56;

/**
 * On a fine pointer a lane may be small, because a mouse can hit 10px and
 * because the whole point of a desktop roll is seeing an octave at once. 10 is
 * where the pitch labels stop fitting, not an arbitrary floor.
 */
export const FINE_ROW_MIN = 10;

/** Above this a lane is taller than the note label needs and the roll is a list. */
export const ROW_MAX = 96;

/**
 * Does this browser say the primary pointer is a finger?
 *
 * Read at call time rather than cached: a tablet with a keyboard attached can
 * change its answer, and a roll that decided at import time would keep asking
 * a finger to hit a 16px lane for the rest of the session.
 */
export function coarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** The smallest a lane may be on the hand currently in use. */
export function rowFloor(): number {
  return coarsePointer() ? TOUCH_ROW_MIN : FINE_ROW_MIN;
}

/** A stored lane height, held to what the current hand can use. */
export function clampRow(px: number): number {
  return Math.max(rowFloor(), Math.min(ROW_MAX, Math.round(px)));
}

/**
 * The lane height in force, clamped.
 *
 * The clamp lives here rather than in the setter because the hand can change
 * after the value is stored — plug a mouse into a tablet and a 56px lane is
 * merely tall, but unplug it and a 16px one is unusable. Clamping on read is
 * what makes the floor a property of the *device* rather than of the last
 * button anybody pressed.
 */
export function useRowHeight(): number {
  return clampRow(useUiStore((s) => s.prRowH));
}

/** Step the lane height by a ratio, and keep it inside the floor and ceiling. */
export function zoomRows(current: number, factor: number): number {
  return clampRow(current * factor);
}

/**
 * Whether a note is wide enough to carry a resize handle as well as a body.
 *
 * The handle is 14px on touch, and a sixteenth note at the default zoom is
 * 8px wide — so the handle covered the whole note and every attempt to *move*
 * a short note resized it instead. There is no width at which both gestures
 * fit, so the shorter one gives up the handle: a note narrower than this is
 * moved by dragging and resized from the toolbar or the keyboard, and it says
 * so by not drawing a grip it cannot honour.
 *
 * `MIN_BODY` is what is left for the move gesture, and it is deliberately the
 * same 24px WCAG 2.5.8 asks of a pointer target: below that the note is not a
 * drag target either, and the honest answer is to zoom in.
 */
export const MIN_BODY = 24;

export function handleWidth(noteWidthPx: number, coarse = coarsePointer()): number {
  const want = coarse ? 14 : 7;
  const spare = noteWidthPx - MIN_BODY;
  if (spare < 4) return 0;
  return Math.min(want, Math.round(spare));
}
