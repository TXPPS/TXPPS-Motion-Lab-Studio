/**
 * Arrangement tool maths — paint, zoom-drag and lane scaling.
 *
 * The gestures these serve live in the arrangement component, but the numbers
 * do not belong there: what a paint drag is worth in beats, and where the
 * timeline has to be scrolled so a zoom leaves the beat under the pointer
 * still under the pointer, are decisions a test can hold still. The component
 * keeps the pointer plumbing; everything here is pure.
 */

/** Zoom range the arrangement offers, in pixels per beat. */
export const MIN_PX_PER_BEAT = 6;
export const MAX_PX_PER_BEAT = 120;

/** Lane-height range as a multiple of the default track height. */
export const MIN_LANE_SCALE = 0.6;
export const MAX_LANE_SCALE = 2.5;

/** One step of the zoom buttons and of a zoom-tool click. */
export const ZOOM_STEP = 1.25;

/** Horizontal drag distance, in pixels, that doubles or halves the zoom. */
const ZOOM_DRAG_PX = 220;
/** Vertical drag distance, in pixels, that doubles or halves the lane height. */
const LANE_DRAG_PX = 260;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export interface PaintSpanOptions {
  /** Length for a gesture that never moved — a click, not a drag. */
  clickLength: number;
  /** Shortest clip a drag may produce, so a twitch cannot make a zero-length one. */
  minLength: number;
  /** Whether the gesture passed the drag threshold. */
  moved: boolean;
}

/**
 * The clip a paint gesture asks for, in beats.
 *
 * Both ends go through the caller's snap function rather than being rounded
 * here, because "snap" in this product is a mode with five settings — a paint
 * drag has to land exactly where a clip drag would land, or the tool is
 * lying about the grid.
 */
export function paintSpan(
  originBeat: number,
  pointerBeat: number,
  snapFn: (beat: number) => number,
  o: PaintSpanOptions,
): { start: number; length: number } {
  const a = Math.max(0, snapFn(Math.max(0, originBeat)));
  if (!o.moved) return { start: a, length: Math.max(o.minLength, o.clickLength) };
  const b = Math.max(0, snapFn(Math.max(0, pointerBeat)));
  return { start: Math.min(a, b), length: Math.max(o.minLength, Math.abs(b - a)) };
}

/**
 * The zoom a horizontal drag asks for, as a multiplier.
 *
 * Exponential in the distance dragged, so the gesture feels the same whether
 * the timeline is showing four bars or four hundred: every ZOOM_DRAG_PX to the
 * right doubles, every ZOOM_DRAG_PX to the left halves.
 */
export function zoomFactorFromDrag(dx: number): number {
  return Math.pow(2, dx / ZOOM_DRAG_PX);
}

/** The lane scale a vertical drag asks for. Down is taller. */
export function laneScaleFromDrag(startScale: number, dy: number): number {
  return clamp(startScale * Math.pow(2, dy / LANE_DRAG_PX), MIN_LANE_SCALE, MAX_LANE_SCALE);
}

/**
 * Apply a zoom factor to a zoom level. Quantised to a tenth of a pixel per
 * beat so repeated small steps cannot accumulate a value that renders at a
 * fractional pixel and shimmers.
 */
export function nextPxPerBeat(prev: number, factor: number): number {
  return clamp(Math.round(prev * factor * 10) / 10, MIN_PX_PER_BEAT, MAX_PX_PER_BEAT);
}

/**
 * Where the timeline must be scrolled after a zoom for the beat under the
 * anchor to stay under it. `offsetInView` is the anchor's distance from the
 * left edge of the lane area, past the sticky track headers.
 */
export function zoomAnchorScroll(
  scrollLeft: number,
  offsetInView: number,
  prevPxPerBeat: number,
  nextPx: number,
): number {
  if (!(prevPxPerBeat > 0)) return Math.max(0, scrollLeft);
  const anchorBeat = (scrollLeft + offsetInView) / prevPxPerBeat;
  return Math.max(0, anchorBeat * nextPx - offsetInView);
}
