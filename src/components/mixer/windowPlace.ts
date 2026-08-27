/**
 * Keeping a floating device window inside the viewport.
 *
 * A plugin window opened at a fixed offset is fine on the desktop the offset
 * was chosen on and wrong everywhere else. `{ x: 220 }` against a window that is
 * at least 320 px wide needs a 564 px viewport before its right edge is even on
 * screen, so on every phone and on the narrow half of a split-screen tablet the
 * device opened 96 to 199 px past the edge — with its close button among the
 * part that was off. Rotating the device did the same thing to a window that
 * had been placed correctly a moment earlier.
 *
 * So placement is computed against the viewport rather than assumed, and it is
 * recomputed when the viewport changes. Pure functions, because the failure is
 * arithmetic and arithmetic is worth testing without a browser.
 */

/** Gap kept between a window and the viewport edge. */
export const EDGE_MARGIN = 8;

export interface Rect {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Move a window as little as necessary to bring it inside the viewport.
 *
 * When the window is larger than the viewport it is pinned to the top-left
 * margin rather than centred: the header — which carries close, bypass and the
 * drag handle — is at the top, so if something has to be off-screen it must be
 * the bottom. A centred oversized window hides the only controls that can
 * dismiss it.
 */
export function clampToViewport(pos: Point, size: Rect, viewport: Rect): Point {
  const maxX = viewport.width - size.width - EDGE_MARGIN;
  const maxY = viewport.height - size.height - EDGE_MARGIN;
  return {
    x: Math.max(EDGE_MARGIN, Math.min(maxX, pos.x)),
    y: Math.max(EDGE_MARGIN, Math.min(maxY, pos.y)),
  };
}

/**
 * Where a window opens when it has no remembered place.
 *
 * The preferred offset sits it clear of the console on a desktop, which is
 * where it belongs when there is room. When there is not, the window centres
 * horizontally instead of hugging the left margin — a device that is nearly as
 * wide as the screen looks misplaced pushed to one side, and centring costs
 * nothing when it fits.
 */
export function placeWindow(preferred: Point, size: Rect, viewport: Rect): Point {
  const fitsAtPreferred = preferred.x + size.width + EDGE_MARGIN <= viewport.width;
  const x = fitsAtPreferred ? preferred.x : Math.round((viewport.width - size.width) / 2);
  return clampToViewport({ x, y: preferred.y }, size, viewport);
}

/** A rectangle in viewport coordinates — the control a window was opened from. */
export interface Box extends Point, Rect {}

/** Whether two boxes share any area at all. */
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * A place that does not cover the control the window was opened from.
 *
 * The channel rail's contract is that one tap opens a device and the next
 * closes it (directive item 13). On a phone that was unreachable in the most
 * ordinary way possible: the window opened *on top of the card*, so the second
 * tap landed on the EQ curve inside the window and the card could not be
 * pressed again by any gesture at all. Measured — `elementFromPoint` at the
 * card's centre returned `svg.fx-curve`. Nothing was too small and nothing was
 * off screen; the control was simply behind something.
 *
 * Below the opener first, then above it, then wherever it fits. Below is the
 * preference because a device window is read downward from its header, and
 * because the rail sits above the fader on every form factor — a window placed
 * above the rail would be covering the console instead.
 *
 * Returns the clamped fallback when neither side has room, and there is a band
 * where neither does: a 420px window in an 844px phone needs 428 clear pixels on
 * one side of a 44px control, and a control in the middle leaves 410 on both.
 * No placement rule can invent the room, so the honest answer is to fall back
 * rather than improvise — a window squeezed into a strip of pixels to avoid an
 * overlap is worse than the overlap, and `clampToViewport` keeps the close
 * control on screen either way.
 */
export function placeClearOf(fallback: Point, size: Rect, viewport: Rect, opener: Box): Point {
  const at = (y: number) => clampToViewport({ x: fallback.x, y }, size, viewport);
  for (const pos of [
    at(opener.y + opener.height + EDGE_MARGIN),
    at(opener.y - size.height - EDGE_MARGIN),
  ]) {
    if (!overlaps({ ...pos, ...size }, opener)) return pos;
  }
  return clampToViewport(fallback, size, viewport);
}
