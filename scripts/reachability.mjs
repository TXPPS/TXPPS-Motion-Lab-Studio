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
  { id: 'automation-lane', label: 'automation lane', selector: '[data-testid^="auto-lane-"]' },
  { id: 'automation-toggle', label: 'show automation', selector: '[data-testid^="auto-toggle-"]' },
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

  const sweep = async (via) => {
    for (const target of TARGETS) {
      if (found.get(target.id)) continue;
      const node = page.locator(target.selector).first();
      if (!(await node.isVisible().catch(() => false))) continue;
      const box = await node.boundingBox().catch(() => null);
      if (!box || box.width < 2 || box.height < 2) continue;
      found.set(target.id, via);
    }
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
    window.__ml.projectStore.getState().project.tracks.map((t) => ({ id: t.id, type: t.type })),
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
  const selectByTapping = async (trackId) => {
    for (const route of routes) {
      const header = page.locator(`[data-testid="track-header-${trackId}"]`).first();
      if (await header.isVisible().catch(() => false)) {
        await header.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(160);
        const got = await page.evaluate(() => window.__ml.uiStore.getState().selectedTrackId);
        if (got === trackId) return route.id;
      }
      if (route.kind === 'none') continue;
      const control = page.locator(`[data-testid="${route.id}"]`).first();
      if (await control.isVisible().catch(() => false)) {
        await control.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(220);
      }
    }
    return null;
  };

  const walkRoutes = async (label) => {
    for (const route of routes) {
      if (route.kind !== 'none') {
        const control = page.locator(`[data-testid="${route.id}"]`).first();
        if (await control.isVisible().catch(() => false)) {
          await control.click({ timeout: 2500 }).catch(() => {});
          await page.waitForTimeout(300);
        }
      }
      await sweep(`${route.id}${label}`);
      if ([...found.values()].every(Boolean)) return;
    }
  };

  await walkRoutes('');
  for (const track of tracks) {
    if ([...found.values()].every(Boolean)) break;
    const via = await selectByTapping(track.id);
    if (via === null) continue;
    await walkRoutes(` · ${track.type} selected by tapping its header in ${via}`);
  }

  for (const target of TARGETS) {
    rows.push({
      form: form.id,
      kind: form.kind,
      target: target.id,
      label: target.label,
      via: found.get(target.id),
      state: found.get(target.id) ? 'REACHABLE' : 'UNREACHABLE',
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

if (JSON_ONLY) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const forms = FORMS.map((f) => f.id);
  console.log(`\n${'function'.padEnd(30)}${forms.map((f) => f.slice(0, 9).padEnd(11)).join('')}`);
  console.log('-'.repeat(30 + forms.length * 11));
  for (const target of TARGETS) {
    const cells = forms.map((f) => {
      const row = rows.find((r) => r.form === f && r.target === target.id);
      return (row.state === 'REACHABLE' ? 'yes' : 'NO').padEnd(11);
    });
    console.log(`${target.label.padEnd(30)}${cells.join('')}`);
  }
  const gaps = rows.filter((r) => r.state === 'UNREACHABLE' && r.kind !== 'desktop');
  const onDesktop = new Set(
    rows.filter((r) => r.kind === 'desktop' && r.state === 'REACHABLE').map((r) => r.target),
  );
  const defects = gaps.filter((r) => onDesktop.has(r.target));
  console.log(
    `\n${defects.length} defect(s): reachable on desktop and not on a smaller screen.` +
      (defects.length ? '' : ' None.'),
  );
  for (const d of defects) console.log(`  ${d.form.padEnd(17)} ${d.label}`);
}
