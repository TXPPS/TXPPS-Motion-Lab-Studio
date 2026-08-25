/**
 * Which functions can a user actually reach, on each thing they hold?
 *
 * Directive 11 §5. The report is that whole areas of the product are
 * unreachable on a phone — MIDI effects, the arpeggiator, and more — and that
 * "a function that exists on desktop and cannot be reached on a phone is a
 * missing function on the phone". This measures it.
 *
 *   npm run preview &
 *   npm run reachability            # human-readable table
 *   node scripts/reachability.mjs --json
 *
 * **Presence is not reachability, and this is the first of two passes.** A cell
 * here says the surface can be found and is interactable at that size, which is
 * necessary and not sufficient; §5 asks that a test actually invoke the
 * function and assert the state change, and that pass is `soak`'s functional
 * sweep. What this catches is the reported defect: an area with no route to it
 * at all on a given form factor.
 *
 * Every target names the route it takes. A target that is reachable only
 * because the sweep drove the store directly would be measuring the store, not
 * the product, so navigation goes through the app's own controls wherever one
 * exists — the bottom nav on a phone, the tab strip on a desktop.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { mutated, unless } from './probe-mutant.mjs';

const BASE = process.env.REACH_BASE ?? 'http://localhost:4173';
const JSON_ONLY = process.argv.includes('--json');
const preinstalled = '/opt/pw-browsers/chromium';

/** The form factors the product claims to serve. */
const ALL_FORMS = [
  { id: 'phone-portrait', width: 390, height: 844, kind: 'phone' },
  { id: 'phone-landscape', width: 844, height: 390, kind: 'phone' },
  { id: 'tablet-portrait', width: 768, height: 1024, kind: 'tablet' },
  { id: 'tablet-landscape', width: 1024, height: 768, kind: 'tablet' },
  { id: 'desktop', width: 1440, height: 900, kind: 'desktop' },
];

/**
 * A reduced sweep, for the probe mutation driver.
 *
 * One form factor and a handful of targets runs in well under a minute, which
 * is what makes it affordable to run this sweep once per recorded probe
 * correction. The scope is applied identically to the baseline and the mutant,
 * so it can flatter neither — and the full sweep is what still writes the
 * matrix, so nothing about the report is narrowed by this existing.
 */
const only = (name) => (process.env[name] ?? '').split(',').filter(Boolean);
const FORM_SCOPE = only('REACH_FORMS');
const TARGET_SCOPE = only('REACH_TARGETS');
const FORMS =
  FORM_SCOPE.length > 0 ? ALL_FORMS.filter((f) => FORM_SCOPE.includes(f.id)) : ALL_FORMS;

/**
 * The surfaces Directive 11 §5 names, plus the ones around them.
 *
 * `selector` is what the surface renders as. `reach` is a list of things to try
 * to get there, each a phone-nav id, an editor tab, or a store call named after
 * the user action it stands for.
 */
const TARGETS = [
  { id: 'notefx-rack', label: 'MIDI/note FX rack', selector: '[data-testid^="notefx-rack-"]' },
  {
    id: 'notefx-add',
    label: 'add a note FX (arpeggiator)',
    selector: '[data-testid^="notefx-add-"]',
  },
  /*
   * The lane, not the button that shows it.
   *
   * `auto-toggle-*` was a target and it is a desktop widget: the header's mini
   * buttons are `display: none` below the desktop breakpoint, so it read as a
   * phone and tablet defect forever. The function is not missing there — the
   * track's long-press menu carries "Show automation lanes" and "Add automation
   * lane…" on every form factor. Targeting the button measured which widget a
   * layout uses; targeting the lane measures whether a user can get automation
   * on screen, which is the thing §5 says must not differ.
   */
  { id: 'automation-lane', label: 'automation lane', selector: '[data-testid^="auto-lane-"]' },
  {
    id: 'sends',
    label: 'sends rack',
    selector: '[data-testid^="send-rack-"], [data-testid^="send-"]',
  },
  {
    id: 'cue-mix',
    label: 'cue mixes',
    selector: '[data-testid="cue-main"], [data-testid="cue-add"]',
  },
  { id: 'zone-editor', label: 'sampler zone editor', selector: '[data-testid="zone-map"]' },
  { id: 'score-view', label: 'score view', selector: '[data-testid="score-view"]' },
  {
    id: 'freeze',
    label: 'freeze a track',
    selector: '[data-testid="freeze-state"], [data-testid^="frozen-"]',
  },
  {
    id: 'insert-rack',
    label: 'insert rack',
    selector: '[data-testid^="fx-rack-"], [data-testid^="device-add-"]',
  },
  { id: 'device-window', label: 'a device editor', selector: '[data-testid="plugin-window"]' },
  { id: 'drum-editor', label: 'drum editor', selector: '[data-testid="drum-editor"]' },
  {
    id: 'sampler',
    label: 'sampler',
    selector: '[data-testid="smp-rack"], [data-testid="pad-grid"]',
  },
  { id: 'piano-roll', label: 'piano roll', selector: '[data-testid="piano-roll"]' },
  { id: 'mixer', label: 'mixer', selector: '[data-testid="mixer"]' },
  { id: 'arrangement', label: 'arrangement', selector: '[data-testid="arrangement"]' },
  { id: 'browser', label: 'browser', selector: '[data-testid="browser-panel"]' },
  { id: 'inspector', label: 'inspector', selector: '[data-testid="inspector"]' },
  {
    id: 'settings',
    label: 'settings',
    selector: '[data-testid="settings-sheet"], [data-testid="open-settings"]',
  },
  {
    id: 'diagnostics',
    label: 'diagnostics',
    selector: '[data-testid="diagnostics-panel"], [data-testid="open-diagnostics"]',
  },
  {
    id: 'export',
    label: 'export / bounce',
    selector: '[data-testid="export-sheet"], [data-testid="export-run"]',
  },
  { id: 'groove', label: 'groove panel', selector: '[data-testid="groove-panel"]' },
  { id: 'chords', label: 'chord assistant', selector: '[data-testid="chord-assistant"]' },
  { id: 'audio-editor', label: 'audio editor', selector: '[data-testid="audio-editor"]' },
  { id: 'take-review', label: 'take review', selector: '[data-testid="take-review"]' },
  {
    id: 'shortcuts',
    label: 'keyboard shortcuts',
    selector: '[data-testid="shortcuts-sheet"], [data-testid="key-commands"]',
  },
];

if (TARGET_SCOPE.length > 0) {
  for (let i = TARGETS.length - 1; i >= 0; i -= 1) {
    if (!TARGET_SCOPE.includes(TARGETS[i].id)) TARGETS.splice(i, 1);
  }
}

const browser = await chromium.launch({
  ...(existsSync(preinstalled) ? { executablePath: preinstalled } : {}),
  args: ['--autoplay-policy=no-user-gesture-required'],
});

const rows = [];

/**
 * Whether each branch of this sweep was actually entered.
 *
 * A correction that this run never gave a chance to matter is not a correction
 * that has stopped mattering, and the two are indistinguishable from the
 * outside: both leave the number unchanged. `scripts/probe-mutations.mjs` reads
 * these to tell BLOCKED from DECAYED, which is the difference between "nobody
 * tried it" and "it does nothing", and only one of those is a problem.
 */
const exercised = { scrolls: 0, reasserts: 0, tapFailures: 0, clipOpened: 0 };

for (const form of FORMS) {
  const page = await browser.newPage({
    viewport: { width: form.width, height: form.height },
    hasTouch: form.kind !== 'desktop',
    isMobile: form.kind === 'phone',
  });
  await page.goto(BASE);
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 25000 });
  await page.waitForFunction(() => Boolean(window.__ml?.projectStore), null, { timeout: 25000 });

  // A project with something of everything, so a surface is not missing merely
  // because nothing in the session would show it. Built through the store: this
  // is the *fixture*, not the navigation, and the navigation is what is under
  // test.
  await page.evaluate(() => {
    const st = () => window.__ml.projectStore.getState();
    const inst = st().addTrack('instrument');
    st().setInstrument(inst, 'quick');
    st().addEffect(inst, 'compressor');
    const drum = st().addTrack('drum');
    st().setInstrument(drum, 'drum');
    st().addTrack('bus');
    st().addTrack('audio');
    window.__reachTracks = { inst, drum };
  });
  await page.waitForTimeout(500);

  /**
   * Every route the app itself offers at this size, discovered rather than
   * listed.
   *
   * Listed was wrong once already: the first version knew about the phone's
   * `nav-*` and the desktop's `editor-tab-*` and nothing else, so the tablet
   * reported one route and eight surfaces as unreachable that are simply behind
   * a control this sweep had never heard of. The tablet navigates with
   * `combo-*` and two drawer buttons of its own.
   *
   * So the prefixes are a list of *conventions* the shell uses for navigation,
   * and every control matching one is a route. A layout that invents a new
   * convention will under-report until its prefix is added here, which is why
   * the route count is printed beside every form factor: one route is a probe
   * that has not found the navigation, not a product with no navigation.
   */
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

  await walkRoutes('');
  await longPressTrackHeaders();
  await rightClickTrackHeaders();
  const clipOpen = mutated('reach/open-midi-clip') ? null : await openAMidiClip();
  if (clipOpen) exercised.clipOpened += 1;
  if (clipOpen) await walkRoutes(' · with a MIDI clip open');
  // One representative per track *type*, not per track.
  //
  // What a surface is conditional on is the kind of track selected — a note FX
  // rack wants an instrument, a zone editor wants a sampler. Walking every route
  // for each of eleven tracks measured the same five answers twice over and was
  // most of an eight-minute sweep.
  const byType = new Map();
  if (!mutated('reach/select-track')) {
    for (const track of tracks) if (!byType.has(track.type)) byType.set(track.type, track);
  }
  for (const track of byType.values()) {
    if ([...found.values()].every(Boolean)) break;
    const via = await selectByTapping(track);
    if (via === null) {
      exercised.tapFailures += 1;
      continue;
    }
    await walkRoutes(` · ${track.type} track selected by tapping its header`, track);
  }

  for (const target of TARGETS) {
    rows.push({
      form: form.id,
      kind: form.kind,
      target: target.id,
      label: target.label,
      via: found.get(target.id),
      state: found.get(target.id) ? 'REACHABLE' : 'NOT REACHED',
    });
  }
  await page.close();
  if (!JSON_ONLY) {
    const reached = rows.filter((r) => r.form === form.id && r.state === 'REACHABLE').length;
    console.log(
      `${form.id.padEnd(17)} ${String(reached).padStart(2)}/${TARGETS.length} reachable ` +
        `· ${routes.length} route(s)`,
    );
  }
}

await browser.close();
writeFileSync('reachability-out.json', JSON.stringify(rows, null, 2));
writeFileSync('reachability-probe.json', JSON.stringify(exercised, null, 2));

const forms = FORMS.map((f) => f.id);
// A scoped run has no row for a form it did not sweep, and reading `.state`
// off that undefined threw in the report rather than in the sweep — which
// looked like the probe crashing when it had simply been asked for less.
const cell = (form, target) =>
  rows.find((r) => r.form === form && r.target === target)?.state === 'REACHABLE';
const onDesktop = new Set(TARGETS.filter((t) => cell('desktop', t.id)).map((t) => t.id));
const defects = rows.filter(
  (r) => r.kind !== 'desktop' && r.state !== 'REACHABLE' && onDesktop.has(r.target),
);
const nowhere = TARGETS.filter((t) => !forms.some((f) => cell(f, t.id)));

const grouped = defects.reduce((acc, d) => {
  const at = acc.find((a) => a.target === d.target);
  if (at) at.forms.push(d.form);
  else acc.push({ target: d.target, label: d.label, forms: [d.form] });
  return acc;
}, []);

const NL = '\n';
const lines = [
  '# Reachability Matrix',
  '',
  '**Generated by `npm run reachability`. Do not edit by hand.**',
  '',
  'Directive 11 §5. Every surface, on every form factor, reached the way a user',
  "reaches it: navigate with the shell's own controls, select a track by tapping",
  'its header, and look. Nothing here is reached by calling a store.',
  '',
  '**`NOT REACHED` is not the same as unreachable.** It means this sweep did not',
  'get there, and the sweep performs navigation and selection only — it does not',
  'open a device by clicking an insert slot, or a take review by recording one. A',
  'row that is not reached on every form factor including desktop is almost',
  'certainly behind an interaction this sweep does not perform, and is listed',
  'separately below rather than counted as a mobile defect.',
  '',
  '**A defect is a surface reachable on desktop and not on something smaller.**',
  'That is the rule the directive sets: layout may differ, capability may not.',
  '',
  `| surface | ${forms.join(' | ')} |`,
  `| --- | ${forms.map(() => '---').join(' | ')} |`,
  ...TARGETS.map(
    (t) => `| ${t.label} | ${forms.map((f) => (cell(f, t.id) ? 'yes' : '—')).join(' | ')} |`,
  ),
  '',
  '## What the sweep managed, before any of it is read as a defect',
  '',
  'Every one of these is a way this sweep can under-report, so the numbers come',
  'first. A defect list standing on a walk that could not select a track is a',
  'list of the walk, not of the product.',
  '',
  '| | |',
  '| --- | --- |',
  `| tracks it could not select by tapping | ${exercised.tapFailures} |`,
  `| headers it had to scroll to | ${exercised.scrolls} |`,
  `| selections it had to re-assert | ${exercised.reasserts} |`,
  `| MIDI clips it opened | ${exercised.clipOpened} |`,
  '',
  '## Defects: reachable on desktop, not on a smaller screen',
  '',
  grouped.length === 0
    ? 'None.'
    : grouped.map((d) => `- **${d.label}** — ${d.forms.join(', ')}`).join(NL),
  '',
  '## Not reached anywhere, including desktop',
  '',
  'These need an interaction this sweep does not perform — opening a device from',
  'an insert slot, reviewing a take after recording one. They are work for the',
  'functional sweep rather than evidence of a missing feature.',
  '',
  nowhere.length === 0 ? 'None.' : nowhere.map((t) => `- ${t.label} (\`${t.selector}\`)`).join(NL),
  '',
  '## How each was reached',
  '',
  '| surface | form | via |',
  '| --- | --- | --- |',
  ...rows
    .filter((r) => r.state === 'REACHABLE')
    .map((r) => `| ${r.label} | ${r.form} | ${r.via} |`),
  '',
];

// A scoped run must not overwrite the matrix.
//
// It sweeps one form factor and a handful of targets, so what it would write is
// a document that reads like a product with one screen size and five features.
// The JSON above is still written, because that is what the mutation driver
// compares; the committed audit is the whole sweep or it is nothing.
if (FORM_SCOPE.length === 0 && TARGET_SCOPE.length === 0) {
  writeFileSync('docs/audit/REACHABILITY.md', lines.join(NL));
} else if (!JSON_ONLY) {
  console.log(`${NL}Scoped run: docs/audit/REACHABILITY.md left alone.`);
}

if (JSON_ONLY) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.log(`${NL}${'surface'.padEnd(30)}${forms.map((f) => f.slice(0, 9).padEnd(11)).join('')}`);
  console.log('-'.repeat(30 + forms.length * 11));
  for (const target of TARGETS) {
    const cells = forms.map((f) => (cell(f, target.id) ? 'yes' : 'NO').padEnd(11)).join('');
    console.log(`${target.label.padEnd(30)}${cells}`);
  }
  console.log(`${NL}${grouped.length} defect(s) — reachable on desktop, not on a smaller screen:`);
  for (const d of grouped) console.log(`  ${d.label.padEnd(30)} ${d.forms.join(', ')}`);
  console.log(
    `${NL}${nowhere.length} surface(s) not reached anywhere; this sweep does not open them.`,
  );
  if (FORM_SCOPE.length === 0 && TARGET_SCOPE.length === 0) {
    console.log(`${NL}docs/audit/REACHABILITY.md written.`);
  }
}
