/**
 * What every soak layer needs: a browser, a booted app, a fixture, and a way
 * to say whether anything changed.
 *
 * Directive 11 §3. The four layers ask different questions of the same running
 * product, and each one answering them with its own launch code would give four
 * slightly different products to be measured. They share this instead.
 *
 * **`snapshot` is the whole reason a sweep can be state-asserting.** A test that
 * clicks a control and checks nothing threw is worse than no test, because it
 * reports coverage it does not have; the only cheap general way to know that an
 * action *did* something is to fingerprint the state before and after. It is a
 * structural digest rather than a deep equality: what matters is that a
 * fingerprint changes when the product changes and not when it repaints.
 */
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

export const BASE = process.env.SOAK_BASE ?? 'http://localhost:4173';

/** The three things a user holds. Every layer that has a form factor uses these. */
export const FORMS = [
  { id: 'phone', width: 390, height: 844, touch: true, mobile: true },
  { id: 'tablet', width: 768, height: 1024, touch: true, mobile: false },
  { id: 'desktop', width: 1440, height: 900, touch: false, mobile: false },
];

export async function launch() {
  const preinstalled = '/opt/pw-browsers/chromium';
  return chromium.launch({
    ...(existsSync(preinstalled) ? { executablePath: preinstalled } : {}),
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--enable-precise-memory-info',
      '--js-flags=--expose-gc',
    ],
  });
}

/**
 * A booted page with the app's own handles available.
 *
 * `errors` collects uncaught page errors for the whole life of the page. A soak
 * layer that reports PASS while the console filled with exceptions is reporting
 * that its assertions are too weak, and that is worth failing on separately
 * from whatever the layer was measuring.
 */
export async function openApp(browser, form) {
  const page = await browser.newPage({
    viewport: { width: form.width, height: form.height },
    hasTouch: form.touch,
    isMobile: form.mobile,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE);
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.__ml?.projectStore), null, { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.__ml?.exportMix), null, { timeout: 30000 });
  return { page, errors, form };
}

/**
 * A project with one of everything, built through the store.
 *
 * Built rather than loaded, so a layer is never measuring whatever the demo
 * project happens to contain this month. It is the *fixture*, not the thing
 * under test — the actions being swept are what a layer measures, and a fixture
 * assembled by calling the store is fine for the same reason a test may
 * construct its inputs directly.
 */
export async function seedFixture(page) {
  return page.evaluate(() => {
    const st = () => window.__ml.projectStore.getState();
    const ui = () => window.__ml.uiStore.getState();
    const inst = st().addTrack('instrument');
    st().setInstrument(inst, 'synth');
    st().addEffect(inst, 'compressor');
    const drum = st().addTrack('drum');
    st().setInstrument(drum, 'drum');
    const sampler = st().addTrack('instrument');
    st().setInstrument(sampler, 'multi');
    const audio = st().addTrack('audio');
    const bus = st().addTrack('bus');
    const clip = st().addMidiClip(inst, 0, 4);
    st().addNotes?.(clip, [
      { pitch: 60, start: 0, length: 1, velocity: 100 },
      { pitch: 64, start: 1, length: 1, velocity: 90 },
      { pitch: 67, start: 2, length: 2, velocity: 80 },
    ]);
    ui().set({ selectedTrackId: inst, editClipId: clip });
    return { inst, drum, sampler, audio, bus, clip };
  });
}

/**
 * A structural digest of everything a user could have changed.
 *
 * Three parts, kept separate so a failure says *which* changed: the project
 * (what is saved), the ui (what is on screen), and the transport (what is
 * moving). An action that touches none of the three did nothing, whatever it
 * returned.
 *
 * The project is hashed rather than carried whole — a hundred-track fixture
 * serialises to megabytes and the fuzzer takes ten thousand of these. The hash
 * is FNV-1a over the JSON, which is not cryptographic and does not need to be:
 * it is comparing a value against the same value taken moments earlier.
 */
export async function snapshot(page) {
  return page.evaluate(() => {
    const hash = (s) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h.toString(16);
    };
    const ps = window.__ml.projectStore.getState();
    const us = window.__ml.uiStore.getState();
    const project = JSON.stringify(ps.project);
    // Only the fields that are a user-visible position, not the whole ui store:
    // a store carrying transient render bookkeeping would make every snapshot
    // differ and every assertion pass.
    const ui = JSON.stringify({
      selectedTrackId: us.selectedTrackId,
      editClipId: us.editClipId,
      editorTab: us.editorTab,
      page: us.page,
      selectedClipIds: us.selectedClipIds,
      selectedNoteIds: us.selectedNoteIds,
      showMixer: us.showMixer,
      showBrowser: us.showBrowser,
      showInspector: us.showInspector,
      phoneMode: us.phoneMode,
      tool: us.tool,
      snap: us.snap,
      loopEnabled: us.loopEnabled,
    });
    // What is on screen, as a digest.
    //
    // Half the shortcut registry opens something — preferences, the export
    // sheet, the shortcut list — and none of that touches the project or the
    // selection, so a sweep watching only the stores reported every one of them
    // as a function that does nothing. A panel appearing *is* a state change;
    // it is just not one either store holds.
    //
    // Matched on structural test ids rather than every id in the document: a
    // meter or a clock changing its own id between two samples would make every
    // assertion pass, which is the opposite failure and a much quieter one.
    const surfaces = [...document.querySelectorAll('[data-testid]')]
      .filter((n) => /sheet|panel|dialog|menu|-view$|-editor$|-window$/.test(n.dataset.testid))
      .filter((n) => {
        const box = n.getBoundingClientRect();
        return box.width > 2 && box.height > 2 && getComputedStyle(n).visibility !== 'hidden';
      })
      .map((n) => n.dataset.testid)
      .sort()
      .join('|');
    return {
      project: hash(project),
      surfaces: hash(surfaces),
      surfacesRaw: surfaces.slice(0, 400),
      projectBytes: project.length,
      ui: hash(ui),
      uiRaw: ui,
      undo: ps.undoStack?.length ?? 0,
      redo: ps.redoStack?.length ?? 0,
      playing: Boolean(window.__ml.engine?.isPlaying?.()),
      position: Number(window.__ml.position?.() ?? 0).toFixed(3),
      tracks: ps.project.tracks.length,
      clips: ps.project.clips.length,
    };
  });
}

/** Which parts of a snapshot pair differ, named. */
export function changedParts(before, after) {
  const parts = [];
  if (before.project !== after.project) parts.push('project');
  if (before.ui !== after.ui) parts.push('ui');
  if (before.surfaces !== after.surfaces) parts.push('surfaces');
  if (before.undo !== after.undo) parts.push('undo');
  // Redo, because undo moves work from one stack to the other and leaves the
  // first the length it started at. Without this, pressing undo after an edit
  // read as nothing having happened.
  if (before.redo !== after.redo) parts.push('redo');
  if (before.playing !== after.playing) parts.push('transport');
  else if (before.position !== after.position) parts.push('position');
  return parts;
}

/**
 * Restore a known-good starting point without reloading the page.
 *
 * The **ui** is restored as well as the project, and that matters more than it
 * sounds: a sweep of seventy shortcuts presses each one into whatever the
 * previous sixty-nine left behind, so a piano-roll shortcut arrives with no
 * clip open and correctly does nothing. Reporting that as an untested function
 * would be reporting the sweep's own drift.
 *
 * Escape twice first, for the reason `scripts/reachability.mjs` records: a
 * sheet left open swallows every click after it, each throw is caught, and
 * every subsequent assertion quietly reads "nothing changed".
 */
export async function reset(page) {
  for (let i = 0; i < 2; i += 1) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(60);
  }
  await page.evaluate(() => {
    if (!window.__soakBaseline) return;
    window.__ml.projectStore.getState().setProject(structuredClone(window.__soakBaseline));
    if (window.__soakUiBaseline) window.__ml.uiStore.getState().set(window.__soakUiBaseline);
  });
}

/** Remember the fixture so `reset` has something to go back to. */
export async function markBaseline(page) {
  await page.evaluate(() => {
    const ui = window.__ml.uiStore.getState();
    window.__soakBaseline = structuredClone(window.__ml.projectStore.getState().project);
    window.__soakUiBaseline = {
      selectedTrackId: ui.selectedTrackId,
      editClipId: ui.editClipId,
      editorTab: ui.editorTab,
      selectedClipIds: ui.selectedClipIds ?? [],
      selectedNoteIds: ui.selectedNoteIds ?? [],
    };
  });
}
