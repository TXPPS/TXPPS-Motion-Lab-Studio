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
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { mutated } from './probe-mutant.mjs';
import { BASE, JSON_ONLY, PREINSTALLED_CHROMIUM, FORMS, TARGETS } from './reach/targets.mjs';
import { createWalker } from './reach/walk.mjs';
import { createMenus } from './reach/menus.mjs';
import { writeMatrix } from './reach/report.mjs';

const browser = await chromium.launch({
  ...(existsSync(PREINSTALLED_CHROMIUM) ? { executablePath: PREINSTALLED_CHROMIUM } : {}),
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

  // The closures the sweep is made of, over this form factor's page.
  //
  // Returned rather than defined here, so the file that drives the sweep is not
  // also the file that implements it: `walk.mjs` decides what counts as
  // reachable, `menus.mjs` decides how a track menu is opened, and this decides
  // the order they run in — which is the only part a reader of this file needs.
  const walker = await createWalker({ page, form, TARGETS, exercised });
  const { routes, found, tracks, walkRoutes, selectByTapping, openAMidiClip } = walker;
  const { longPressTrackHeaders, rightClickTrackHeaders } = createMenus({ page, form }, walker);

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
writeMatrix(rows, exercised, { FORMS, TARGETS, JSON_ONLY });
