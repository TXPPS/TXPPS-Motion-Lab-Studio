/**
 * Scroll positions that survive a layout change.
 *
 * Maximising, recalling a workspace and resetting the layout all remount the
 * panes — they are conditionally rendered, and a recall keys the panel group so
 * the library re-reads each pane's size as its default — and a remount resets
 * DOM scroll. Somebody who has scrolled forty bars into an arrangement, gone
 * full screen to look at something and come back expects to be where they were,
 * not at bar one.
 *
 * Its own module because it is a distinct concern with its own reasoning, and
 * because `workspaceStore.ts` was past this repository's length rule with it
 * inside. Nothing here knows about panes or workspaces: it captures, and it
 * puts back.
 */

export interface ScrollPos {
  left: number;
  top: number;
}

/**
 * The scrollers worth keeping. Named rather than swept, because "every element
 * with overflow" would include the ones whose position is meaningless across a
 * remount — a menu, a tab strip — and putting those back is churn at best.
 */
const SCROLL_KEEPERS = [
  '[data-testid="arr-scroll"]',
  '.pr-scroll',
  '[data-testid="mixer"]',
  '.syn-scroll',
];

/**
 * Module-persistent: a pane hidden by one toggle only re-appears on a LATER
 * toggle, so its position must outlive the single transition. Every layout
 * change refreshes the entries for currently visible scrollers (hidden ones
 * keep their last-seen position — the only truth available for them).
 */
const scrollMemory = new Map<string, ScrollPos>();

/** Read every keeper that is on screen, and hand back the whole memory. */
export function captureScroll(): Map<string, ScrollPos> {
  if (typeof document === 'undefined') return scrollMemory;
  for (const sel of SCROLL_KEEPERS) {
    const el = document.querySelector(sel);
    if (el) scrollMemory.set(sel, { left: el.scrollLeft, top: el.scrollTop });
  }
  return scrollMemory;
}

/** Put them back, once the new layout has painted enough to accept them. */
export function restoreScroll(mem: Map<string, ScrollPos>): void {
  if (typeof requestAnimationFrame === 'undefined' || mem.size === 0) return;
  // The remounted scrollers reach full size only after React commits AND the
  // panel group settles — until then assignments clamp to 0. Retry across a
  // few frames until each position sticks (or the budget runs out).
  let tries = 0;
  const apply = () => {
    let pending = false;
    for (const [sel, pos] of mem) {
      const el = document.querySelector(sel);
      if (!el) {
        pending = true;
        continue;
      }
      if (Math.abs(el.scrollLeft - pos.left) > 1) {
        el.scrollLeft = pos.left;
        if (Math.abs(el.scrollLeft - pos.left) > 1) pending = true;
      }
      if (Math.abs(el.scrollTop - pos.top) > 1) {
        el.scrollTop = pos.top;
        if (Math.abs(el.scrollTop - pos.top) > 1) pending = true;
      }
    }
    if (pending && ++tries < 15) requestAnimationFrame(apply);
  };
  requestAnimationFrame(apply);
}
