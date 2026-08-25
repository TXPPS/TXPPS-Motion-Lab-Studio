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

const BASE = process.env.REACH_BASE ?? 'http://localhost:4173';
const JSON_ONLY = process.argv.includes('--json');
const preinstalled = '/opt/pw-browsers/chromium';

/** The form factors the product claims to serve. */
const FORMS = [
  { id: 'phone-portrait', width: 390, height: 844, kind: 'phone' },
  { id: 'phone-landscape', width: 844, height: 390, kind: 'phone' },
  { id: 'tablet-portrait', width: 768, height: 1024, kind: 'tablet' },
  { id: 'tablet-landscape', width: 1024, height: 768, kind: 'tablet' },
  { id: 'desktop', width: 1440, height: 900, kind: 'desktop' },
];

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

const browser = await chromium.launch({
  ...(existsSync(preinstalled) ? { executablePath: preinstalled } : {}),
  args: ['--autoplay-policy=no-user-gesture-required'],
});

const rows = [];

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
  const ROUTE_PREFIXES = [
    'nav-',
    'editor-tab-',
    'browser-tab-',
    'drawer-',
    'combo-',
    'tablet-',
    'phone-mode-',
    'maximize-',
    'page-',
  ];
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
  for (const id of ['open-settings', 'open-diagnostics', 'topbar-overflow', 'transport-more']) {
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
    const trackId = track.id;
    // Anything modal is dismissed first.
    //
    // The route walk ends by opening the sheets — settings, diagnostics, the
    // overflow menu — and a sheet left open intercepts every click after it, so
    // each `click()` threw, each throw was swallowed, and every selection came
    // back null while the manual sequence worked perfectly. Escape twice, then
    // start.
    for (let i = 0; i < 2; i += 1) {
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
    if (await song.isVisible().catch(() => false)) {
      await song.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
    const order = headerRoute
      ? [routes.find((r) => r.id === headerRoute), ...routes.filter((r) => r.id !== headerRoute)]
      : routes;
    for (const route of order.filter(Boolean)) {
      const header = page.locator(`[data-testid="track-header-${track.name}"]`).first();
      // Scrolled to first. A track list is longer than any screen, and a header
      // below the fold is not unreachable — it is one flick away. Skipping it as
      // "not visible" made every surface that needs an instrument track selected
      // read as unreachable, because the instrument track happened to be
      // off-screen in the fixture.
      if ((await header.count()) > 0) await header.scrollIntoViewIfNeeded().catch(() => {});
      if (await header.isVisible().catch(() => false)) {
        // The top-left corner, not the centre.
        //
        // A header is 208x64 and most of that is `div.th-controls` — mute, solo,
        // arm — which sits over the middle and swallows a click aimed there. The
        // sweep read every selection-dependent surface as unreachable on every
        // form factor because of it, and the fix is a coordinate rather than
        // anything in the product. It is worth knowing that only the name strip
        // selects, but that is a §6 note and not a reachability defect.
        await header.click({ position: { x: 8, y: 8 }, timeout: 2000 }).catch(() => {});
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
      if (track) {
        const held = await page.evaluate(() => window.__ml.uiStore.getState().selectedTrackId);
        if (held !== track.id) await selectByTapping(track);
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
      for (const prefix of ROUTE_PREFIXES) {
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
      const items = await page.$$eval('[role="menuitem"]', (ns) =>
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
  const longPressTrackHeaders = async () => {
    if (form.kind === 'desktop') return;
    const ids = await page.$$eval('[data-testid^="track-header-"]', (ns) =>
      ns.map((n) => n.getAttribute('data-testid')),
    );
    for (const id of ids.slice(0, 2)) {
      await page.evaluate(async (selector) => {
        const el = document.querySelector(`[data-testid="${selector}"]`);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const opts = {
          pointerType: 'touch',
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
      }, id);
      await page.waitForTimeout(350);
      await sweep(`long-press on ${id}`);
      const items = await page.$$eval('[role="menuitem"]', (ns) =>
        ns.map((n) => n.textContent?.trim() ?? ''),
      );
      for (const item of items) {
        if ([...found.values()].every(Boolean)) return;
        const entry = page.locator('[role="menuitem"]', { hasText: item }).first();
        if (!(await entry.isVisible().catch(() => false))) continue;
        await entry.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(320);
        await sweep(`long-press on ${id} > "${item}"`);
        const nested = await page.$$eval('[role="menuitem"]', (ns) => ns.length);
        if (nested > 0) {
          await page
            .locator('[role="menuitem"]')
            .first()
            .click({ timeout: 1500 })
            .catch(() => {});
          await page.waitForTimeout(400);
          await sweep(`long-press on ${id} > "${item}" > first entry`);
        }
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(120);
      }
    }
  };

  await walkRoutes('');
  await longPressTrackHeaders();
  const clipOpen = await openAMidiClip();
  if (clipOpen) await walkRoutes(' · with a MIDI clip open');
  // One representative per track *type*, not per track.
  //
  // What a surface is conditional on is the kind of track selected — a note FX
  // rack wants an instrument, a zone editor wants a sampler. Walking every route
  // for each of eleven tracks measured the same five answers twice over and was
  // most of an eight-minute sweep.
  const byType = new Map();
  for (const track of tracks) if (!byType.has(track.type)) byType.set(track.type, track);
  for (const track of byType.values()) {
    if ([...found.values()].every(Boolean)) break;
    const via = await selectByTapping(track);
    if (via === null) continue;
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

const forms = FORMS.map((f) => f.id);
const cell = (form, target) =>
  rows.find((r) => r.form === form && r.target === target).state === 'REACHABLE';
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

writeFileSync('docs/audit/REACHABILITY.md', lines.join(NL));

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
  console.log(`${NL}docs/audit/REACHABILITY.md written.`);
}
