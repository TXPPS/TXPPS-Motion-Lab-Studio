/**
 * The track menu, opened the two ways the product offers.
 *
 * Its own file because of what it cost to get right rather than because of its
 * size. Both walkers used to open the menu once and then iterate its entries —
 * and the first entry closes the menu, so exactly one command in a seventeen
 * item menu was ever invoked. Every surface behind entries two onward read as
 * NOT REACHED on every form factor, the automation lane among them, and the
 * matrix said zero defects while saying it.
 *
 * `createMenus` takes the walker's own closures rather than rebuilding them:
 * getting back to a screen with track headers on it is exactly what
 * `selectByTapping` already does, and a second implementation of that here is
 * how the two would drift.
 */
import { unless } from '../probe-mutant.mjs';

/**
 * @param ctx `{ page, form }`
 * @param walker the result of `createWalker` — `sweep`, `selectByTapping`,
 *   `found` and `tracks` are all used here.
 */
export function createMenus(ctx, walker) {
  const { page, form } = ctx;
  const { sweep, selectByTapping, found, tracks } = walker;
  /**
   * The long-press menu, which on a touch device is a route like any other.
   *
   * `longPress` returns immediately unless `e.pointerType === 'touch'`, so a
   * mouse press — which is what Playwright's `mouse.down()` sends even on a
   * device with `hasTouch` — opens nothing. The automation lanes read as a
   * phone-and-tablet defect because of it, when in fact the track menu carries
   * "Show automation lanes" and "Add automation lane…" on every form factor and
   * a thumb reaches them by holding.
   *
   * Dispatched as real pointer events rather than through the mouse API,
   * because the pointer type is the whole point.
   */
  const pressAndHold = async (id) => {
    await page.evaluate(
      async ({ selector, type }) => {
        const el = document.querySelector(`[data-testid="${selector}"]`);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const opts = {
          pointerType: type,
          pointerId: 1,
          isPrimary: true,
          bubbles: true,
          cancelable: true,
          clientX: r.x + 8,
          clientY: r.y + 8,
        };
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        await new Promise((done) => setTimeout(done, 700));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
      },
      { selector: id, type: unless('reach/long-press-touch', 'touch', 'mouse') },
    );
    await page.waitForTimeout(350);
    return page.$$eval('[role="menuitem"]', (ns) => ns.map((n) => n.textContent?.trim() ?? ''));
  };

  /**
   * The same track menu, opened the way a desktop opens it.
   *
   * `longPress` returns immediately on a desktop, so the long-press walk skips
   * it — and the commands in that menu were therefore never invoked on the one
   * form factor a defect is measured against. A surface reachable on a phone and
   * not on a desktop is not a §5 defect, but it makes the desktop column a worse
   * baseline than the phone one, which is backwards.
   */
  const rightClickTrackHeaders = async () => {
    if (form.kind !== 'desktop') return;
    // Back to a screen that has track headers on it first.
    //
    // The route walk ends wherever the last route led, and on a phone that is
    // usually a mode with no track list at all — so this read zero headers, did
    // nothing, and reported no failure. `selectByTapping` already knows how to
    // dismiss whatever is open and get back to the arrangement, and using it
    // here is the difference between a menu walk and an empty loop.
    if (tracks.length > 0) await selectByTapping(tracks[0]);
    const ids = await page.$$eval('[data-testid^="track-header-"]', (ns) =>
      ns.map((n) => n.getAttribute('data-testid')),
    );
    for (const id of ids.slice(0, 2)) {
      const header = page.locator(`[data-testid="${id}"]`).first();
      if (!(await header.isVisible().catch(() => false))) continue;
      await header
        .click({ button: 'right', position: { x: 8, y: 8 }, timeout: 2000 })
        .catch(() => {});
      await page.waitForTimeout(320);
      const items = await page.$$eval('[role="menuitem"]', (ns) =>
        ns.map((n) => n.textContent?.trim() ?? ''),
      );
      await sweep(`right-click on ${id}`);
      for (const item of items) {
        if ([...found.values()].every(Boolean)) return;
        if (DESTROYS_THE_SUBJECT.test(item)) continue;
        await header
          .click({ button: 'right', position: { x: 8, y: 8 }, timeout: 2000 })
          .catch(() => {});
        await page.waitForTimeout(260);
        const entry = page.locator('[role="menuitem"]', { hasText: item }).first();
        if (!(await entry.isVisible().catch(() => false))) continue;
        await entry.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(320);
        await sweep(`right-click on ${id} > "${item}"`);
        const nested = await page.$$eval('[role="menuitem"]', (ns) =>
          ns.map((n) => n.textContent?.trim() ?? ''),
        );
        for (const sub of nested.slice(0, 4)) {
          const subEntry = page.locator('[role="menuitem"]', { hasText: sub }).first();
          if (!(await subEntry.isVisible().catch(() => false))) continue;
          await subEntry.click({ timeout: 1500 }).catch(() => {});
          await page.waitForTimeout(360);
          await sweep(`right-click on ${id} > "${item}" > "${sub}"`);
          break;
        }
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(120);
      }
    }
  };

  /**
   * Menu entries this sweep will not click.
   *
   * It walks a track menu to find the surfaces its commands reveal, and two of
   * the seventeen entries remove the track instead. Until the walk re-opened
   * the menu for each entry only the first was ever reached, so this never came
   * up; once it did, the sweep deleted its own fixture halfway through and
   * reported the note FX rack and the sends rack as tablet defects. They are
   * not — a phone reaches both.
   *
   * Skipped by what they do rather than by name matching a list of labels, as
   * far as a label allows: a command that removes the subject cannot reveal a
   * surface that needs the subject.
   */
  const DESTROYS_THE_SUBJECT = /^(delete|remove)( |$)|group into/i;

  const longPressTrackHeaders = async () => {
    if (form.kind === 'desktop') return;
    // Back to a screen that has track headers on it first.
    //
    // The route walk ends wherever the last route led, and on a phone that is
    // usually a mode with no track list at all — so this read zero headers, did
    // nothing, and reported no failure. `selectByTapping` already knows how to
    // dismiss whatever is open and get back to the arrangement, and using it
    // here is the difference between a menu walk and an empty loop.
    if (tracks.length > 0) await selectByTapping(tracks[0]);
    const ids = await page.$$eval('[data-testid^="track-header-"]', (ns) =>
      ns.map((n) => n.getAttribute('data-testid')),
    );
    for (const id of ids.slice(0, 2)) {
      const items = await pressAndHold(id);
      await sweep(`long-press on ${id}`);
      for (const item of items) {
        if ([...found.values()].every(Boolean)) return;
        if (DESTROYS_THE_SUBJECT.test(item)) continue;
        // Re-opened before every entry, because the first entry closes the menu.
        //
        // The walk used to press once and then iterate: entry two onwards were
        // never visible, so exactly one command in a seventeen-item track menu
        // was ever invoked. That is why the automation lane read as NOT REACHED
        // on every form factor including desktop, and it read that way while
        // the correction that moved this target off the desktop-only toggle was
        // being described as the one that settled the question. It settled the
        // false defect. It left the real one unmeasured.
        await pressAndHold(id);
        const entry = page.locator('[role="menuitem"]', { hasText: item }).first();
        if (!(await entry.isVisible().catch(() => false))) continue;
        await entry.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(320);
        await sweep(`long-press on ${id} > "${item}"`);
        // A submenu is another set of commands, not a decoration.
        //
        // "Add automation lane…" opens a list of parameters, and the lane only
        // exists once one is chosen. Every entry is tried rather than only the
        // first: the first is Volume here and would have been enough, and
        // relying on that is relying on a menu order nobody promised.
        const nested = await page.$$eval('[role="menuitem"]', (ns) =>
          ns.map((n) => n.textContent?.trim() ?? ''),
        );
        for (const sub of nested.slice(0, 4)) {
          if ([...found.values()].every(Boolean)) return;
          const subEntry = page.locator('[role="menuitem"]', { hasText: sub }).first();
          if (!(await subEntry.isVisible().catch(() => false))) continue;
          await subEntry.click({ timeout: 1500 }).catch(() => {});
          await page.waitForTimeout(360);
          await sweep(`long-press on ${id} > "${item}" > "${sub}"`);
          break;
        }
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(120);
      }
    }
  };

  return { pressAndHold, longPressTrackHeaders, rightClickTrackHeaders };
}
