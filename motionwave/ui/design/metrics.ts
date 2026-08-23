/**
 * Motion Wave — converting the rem scale for things CSS cannot lay out.
 *
 * A plugin face is half CSS and half drawing surface: the labels are elements,
 * the knob ring and the meter ladder are painted. The painted half is where a
 * `rem` scale quietly stops working, because a canvas takes numbers, not units.
 * If those numbers are constants the drawn half ignores the user's text-size
 * setting while the labels around it grow — which is RA-007 reappearing one
 * layer down, and it looks worse than ignoring the setting everywhere.
 *
 * So every painted dimension is declared in rem and converted here, at draw
 * time, against the live root font size.
 */

/** The CSS initial value, and the fallback when no root size can be read. */
export const DEFAULT_ROOT_FONT_PX = 16;

/** What this module needs of a window; passing it in keeps the module testable. */
export interface RootSizeSource {
  getComputedStyle(element: Element): { fontSize: string };
  document: { documentElement: Element };
}

/**
 * The root font size in CSS pixels, which is what an OS text-size setting
 * moves. Falls back to 16 rather than throwing: a face that cannot read the
 * root size should draw at the default size, not fail to draw.
 */
export function readRootFontPx(source: RootSizeSource): number {
  const raw = source.getComputedStyle(source.document.documentElement).fontSize;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ROOT_FONT_PX;
}

/** CSS pixels for a rem measurement at a given root size. */
export function remToPx(rem: number, rootFontPx: number = DEFAULT_ROOT_FONT_PX): number {
  return rem * rootFontPx;
}

/** The inverse, for reading a measured pixel geometry back into the scale. */
export function pxToRem(px: number, rootFontPx: number = DEFAULT_ROOT_FONT_PX): number {
  return px / rootFontPx;
}

/**
 * Device pixels for a rem measurement, rounded to whole pixels.
 *
 * Rounding at the end rather than per term is what keeps a stack of eight
 * 0.375rem gaps from accumulating a pixel of error and pushing the last row of
 * a strip out of the panel — the class of defect that reads as "the layout is
 * one pixel off on some zoom levels" and is nearly impossible to chase later.
 */
export function remToDevicePx(
  rem: number,
  rootFontPx: number = DEFAULT_ROOT_FONT_PX,
  devicePixelRatio = 1,
): number {
  return Math.round(rem * rootFontPx * devicePixelRatio);
}
