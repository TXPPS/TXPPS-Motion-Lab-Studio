/**
 * Finding the routes, and walking them.
 *
 * Six of the fourteen recorded probe corrections live in this file, which is
 * most of why it is its own file: a reader asking "how does this sweep decide
 * something is reachable" should not have to walk past the target table and the
 * report writer to find out.
 *
 * `createWalker` takes the per-form context and returns the closures over it.
 * They were closures before the split and they stay closures, because what they
 * share is not just `page` — `headerRoute` and `found` are mutable state that
 * every one of them reads and writes, and threading that through arguments
 * would be a rewrite rather than a move.
 */
import { mutated, unless } from '../probe-mutant.mjs';

/**
 * @param ctx `{ page, form, TARGETS, exercised }` — the page for this form
 * factor, the targets still being looked for, and the counters that say which
 * branches this run actually entered.
 */
export async function createWalker(ctx) {
  const { page, TARGETS, exercised } = ctx;
  const ROUTE_PREFIXES = unless(
    'reach/route-discovery',
    [
      'nav-',
      'editor-tab-',
      'browser-tab-',
      'drawer-',
      'combo-',
      'tablet-',
      'phone-mode-',
      'maximize-',
      'page-',
    ],
    // What the first version knew: a phone's bottom nav and a desktop's tabs.
    ['nav-', 'editor-tab-'],
  );
  const routes = [];
  for (const prefix of ROUTE_PREFIXES) {
    for (const id of await page.$$eval(`[data-testid^="${prefix}"]`, (ns) =>
      ns.map((n) => n.getAttribute('data-testid')),
    )) {
      if (!routes.some((r) => r.id === id)) routes.push({ kind: prefix, id });
    }
  }
  // The named openers, which are routes even though they are not navigation:
  // a sheet is how a small screen reaches what a desktop puts in a pane.
  const OPENERS = mutated('reach/openers')
    ? []
    : ['open-settings', 'open-diagnostics', 'topbar-overflow', 'transport-more'];
  for (const id of OPENERS) {
    if (
      await page
        .locator(`[data-testid="${id}"]`)
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      routes.push({ kind: 'opener', id });
    }
  }
  if (routes.length === 0) routes.push({ kind: 'none', id: 'as-loaded' });

  const found = new Map(TARGETS.map((t) => [t.id, null]));

  /**
   * Every outstanding target checked in one call into the page.
   *
   * One `page.evaluate` rather than a Playwright locator per target. The first
   * version did twenty-six round-trips per route per track, which is about
   * twenty thousand for a full sweep and took long enough that the sweep could
   * not be part of anything run constantly. The visibility test is the same one
   * — laid out, on screen, and big enough to hit.
   */
  const sweep = async (via) => {
    const outstanding = TARGETS.filter((t) => !found.get(t.id));
    if (outstanding.length === 0) return;
    const hits = await page.evaluate(
      (list) => {
        const seen = [];
        for (const { id, selector } of list) {
          for (const node of document.querySelectorAll(selector)) {
            const box = node.getBoundingClientRect();
            if (box.width < 2 || box.height < 2) continue;
            const style = getComputedStyle(node);
            if (style.visibility === 'hidden' || style.display === 'none') continue;
            seen.push(id);
            break;
          }
        }
        return seen;
      },
      outstanding.map((t) => ({ id: t.id, selector: t.selector })),
    );
    for (const id of hits) found.set(id, via);
  };

  /**
   * Selection is part of the route, and leaving it out was wrong.
   *
   * Nine surfaces read as unreachable on *every* form factor including desktop,
   * which is not a mobile defect — it is a sweep that never selected anything.
   * A note FX rack appears for an instrument track, a zone editor for a sampler,
   * a drum editor for a drum track: they are conditional on what is selected,
   * not on where you navigated. So each route is walked once per track kind.
   */
  const tracks = await page.evaluate(() =>
    window.__ml.projectStore
      .getState()
      .project.tracks.map((t) => ({ id: t.id, type: t.type, name: t.name })),
  );

  /**
   * Selection first, then navigation — which is the order a user does it in.
   *
   * The previous shape clicked a route and *then* tried to select, and on the
   * route where the Inspector lives there are no track headers to tap, so four
   * surfaces were reachable only through a `selectTrack` call. That is not a
   * route a thumb has, and reporting it as reachable would have made this sweep
   * agree with the product instead of measuring it.
   *
   * So a track is selected by tapping its header wherever one is on screen,
   * across every route until one is; the selection persists in the store the way
   * it does for a user, and the routes are then walked with it held. A track
   * that cannot be selected by tapping anywhere is recorded as such rather than
   * forced.
   */
  // The route that showed track headers last time, tried first.
  //
  // Without it every track re-walked every route hunting for a header, and the
  // sweep took eight minutes. It is the same route every time in practice, so
  // remembering it turns a search into a lookup.
  let headerRoute = null;

  // Keyed on the track's *name*, which is what `TrackHeader` puts in its test
  // id. Looking it up by id found nothing, so every selection-dependent surface
  // read as unreachable on every form factor — the sweep failing quietly, which
  // is the failure mode this whole file exists to remove.
  const selectByTapping = async (track) => {
    // Nothing is ever selected under this mutation, not merely the per-track
    // walk skipped.
    //
    // The mutation has to restore the world as it was before the correction,
    // and in that world nothing selected a track anywhere. Skipping only the
    // per-track walk left the menu walkers still selecting one on their way in
    // — my own later correction subsuming an earlier one — and the measurement
    // came back unchanged, which reads as a correction that stopped mattering.
    if (mutated('reach/select-track')) return null;
    const trackId = track.id;
    // Anything modal is dismissed first.
    //
    // The route walk ends by opening the sheets — settings, diagnostics, the
    // overflow menu — and a sheet left open intercepts every click after it, so
    // each `click()` threw, each throw was swallowed, and every selection came
    // back null while the manual sequence worked perfectly. Escape twice, then
    // start.
    for (let i = 0; i < (mutated('reach/dismiss-modals') ? 0 : 2); i += 1) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(120);
    }
    // And back to the page the arrangement lives on.
    //
    // `page-*` are routes too — Start, Song, Mastering, Show — so the route walk
    // ends on whichever came last, and on any page but Song there is no track
    // list and no bottom nav to get back with. Every header lookup returned a
    // count of zero, which reads identically to "this product has no track
    // headers" and is why the sweep has to say what it looked for.
    const song = page.locator('[data-testid="page-song"]').first();
    if (!mutated('reach/back-to-song') && (await song.isVisible().catch(() => false))) {
      await song.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
    if (mutated('reach/tap-to-select')) {
      // The first version's route: drive the store. It always succeeds, which
      // is exactly why it reported four surfaces as reachable on a phone.
      await page.evaluate(
        (id) => window.__ml.uiStore.getState().set({ selectedTrackId: id }),
        trackId,
      );
      return 'selectTrack()';
    }
    const order = headerRoute
      ? [routes.find((r) => r.id === headerRoute), ...routes.filter((r) => r.id !== headerRoute)]
      : routes;
    for (const route of order.filter(Boolean)) {
      const key = unless('reach/header-by-name', track.name, trackId);
      const header = page.locator(`[data-testid="track-header-${key}"]`).first();
      // Scrolled to first. A track list is longer than any screen, and a header
      // below the fold is not unreachable — it is one flick away. Skipping it as
      // "not visible" made every surface that needs an instrument track selected
      // read as unreachable, because the instrument track happened to be
      // off-screen in the fixture.
      if (!mutated('reach/scroll-into-view') && (await header.count()) > 0) {
        // Counted only when scrolling was actually needed. A header already on
        // screen makes this call a no-op, and a run where every header was on
        // screen cannot say anything about the correction either way.
        if (!(await header.isVisible().catch(() => false))) exercised.scrolls += 1;
        await header.scrollIntoViewIfNeeded().catch(() => {});
      }
      if (await header.isVisible().catch(() => false)) {
        // The top-left corner, not the centre.
        //
        // A header is 208x64 and most of that is `div.th-controls` — mute, solo,
        // arm — which sits over the middle and swallows a click aimed there. The
        // sweep read every selection-dependent surface as unreachable on every
        // form factor because of it, and the fix is a coordinate rather than
        // anything in the product. It is worth knowing that only the name strip
        // selects, but that is a §6 note and not a reachability defect.
        const where = unless('reach/header-corner', { position: { x: 8, y: 8 } }, {});
        await header.click({ ...where, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(160);
        const got = await page.evaluate(() => window.__ml.uiStore.getState().selectedTrackId);
        if (got === trackId) {
          headerRoute = route.id;
          return route.id;
        }
      }
      if (route.kind === 'none') continue;
      const control = page.locator(`[data-testid="${route.id}"]`).first();
      if (await control.isVisible().catch(() => false)) {
        await control.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(260);
      }
    }
    return null;
  };

  /**
   * Walk every route, optionally holding a track selected throughout.
   *
   * The selection has to be re-asserted before each route rather than made once
   * at the start, because a route can legitimately change it: entering Record
   * mode selects a record-capable track, which is sensible on its own terms and
   * meant the walk arrived at the Inspector holding whatever Record had chosen.
   * Every surface that needs an instrument track selected then read as
   * unreachable, on all five form factors, while the same sequence performed by
   * hand worked.
   *
   * Re-asserting is a tap, not a store call, so a surface still only counts if a
   * thumb could have got there.
   */
  const walkRoutes = async (label, track) => {
    for (const route of routes) {
      if (track && !mutated('reach/reassert-selection')) {
        const held = await page.evaluate(() => window.__ml.uiStore.getState().selectedTrackId);
        if (held !== track.id) {
          exercised.reasserts += 1;
          await selectByTapping(track);
        }
      }
      if (route.kind !== 'none') {
        const control = page.locator(`[data-testid="${route.id}"]`).first();
        if (await control.isVisible().catch(() => false)) {
          await control.click({ timeout: 2500 }).catch(() => {});
          await page.waitForTimeout(180);
        }
      }
      await sweep(`${route.id}${label}`);

      /*
       * Routes this route revealed.
       *
       * Discovery ran once at start-up, before the phone had ever been in Edit
       * mode — so the editor tab strip did not exist yet and four editors read
       * as unreachable while sitting one tap inside a route the sweep had
       * already taken. A route can carry navigation of its own, and the only
       * time to find that out is after arriving.
       */
      const nested = [];
      for (const prefix of mutated('reach/nested-routes') ? [] : ROUTE_PREFIXES) {
        for (const id of await page.$$eval(`[data-testid^="${prefix}"]`, (ns) =>
          ns.map((n) => n.getAttribute('data-testid')),
        )) {
          if (!routes.some((r) => r.id === id) && !nested.includes(id)) nested.push(id);
        }
      }
      for (const id of nested) {
        if ([...found.values()].every(Boolean)) return;
        const sub = page.locator(`[data-testid="${id}"]`).first();
        if (!(await sub.isVisible().catch(() => false))) continue;
        await sub.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(240);
        await sweep(`${route.id} > ${id}${label}`);
      }

      // A menu this route opened is itself a set of routes.
      //
      // Preferences, Diagnostics and the shortcut sheet live in the overflow
      // menu on every layout, so clicking the overflow and looking was clicking
      // a door and not walking through it — all three read as phone defects
      // when they are one tap further than the sweep went.
      const items = mutated('reach/menu-items')
        ? []
        : await page.$$eval('[role="menuitem"]', (ns) =>
            ns.map((n) => n.textContent?.trim() ?? ''),
          );
      for (const item of items) {
        if ([...found.values()].every(Boolean)) return;
        const entry = page.locator('[role="menuitem"]', { hasText: item }).first();
        if (!(await entry.isVisible().catch(() => false))) continue;
        await entry.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300);
        await sweep(`${route.id} > "${item}"${label}`);
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(140);
        const control = page.locator(`[data-testid="${route.id}"]`).first();
        if (await control.isVisible().catch(() => false)) {
          await control.click({ timeout: 1500 }).catch(() => {});
          await page.waitForTimeout(200);
        }
      }
      if ([...found.values()].every(Boolean)) return;
    }
  };

  /**
   * Open a MIDI clip, by double-clicking one as a user would.
   *
   * Four editors — piano roll, drums, score, audio — declare
   * `appliesTo: isMidiClipOpen` and say "Open a MIDI clip" when nothing is. With
   * no clip open they are correctly unavailable, and a sweep that never opened
   * one would report that as unreachable and send someone looking for a bug in
   * the navigation.
   *
   * Double-clicked rather than assigned: `ClipView` calls `openEditorFor` from
   * its own handler, and going through the store would once again be measuring
   * the store.
   */
  const openAMidiClip = async () => {
    const midi = await page.evaluate(() =>
      window.__ml.projectStore
        .getState()
        .project.clips.filter((c) => c.type === 'midi')
        .map((c) => c.name),
    );
    for (const route of routes) {
      for (const name of midi) {
        const clip = page.locator(`[data-testid="clip-${name}"]`).first();
        if ((await clip.count()) === 0) continue;
        await clip.scrollIntoViewIfNeeded().catch(() => {});
        if (!(await clip.isVisible().catch(() => false))) continue;
        await clip.dblclick({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(260);
        const open = await page.evaluate(() => window.__ml.uiStore.getState().editClipId);
        if (open) return open;
      }
      if (route.kind === 'none') continue;
      const control = page.locator(`[data-testid="${route.id}"]`).first();
      if (await control.isVisible().catch(() => false)) {
        await control.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(240);
      }
    }
    return null;
  };

  return { routes, found, tracks, sweep, selectByTapping, walkRoutes, openAMidiClip };
}
