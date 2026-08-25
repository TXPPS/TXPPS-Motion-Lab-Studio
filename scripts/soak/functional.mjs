/**
 * Layer 1 — invoke every function it can, and assert the state changed.
 *
 * Directive 11 §3. The Function Ledger enumerates 396 functions and every row's
 * `tested` column reads FAIL, which is the honest denominator. This is what
 * fills it, and it fills it on one condition: **a row goes green only when a
 * named part of the state is observed to change.** A row whose test proves the
 * click did not throw is worse than FAIL, because FAIL is honest and "PASS,
 * nothing threw" is a claim nobody can check.
 *
 * So coverage here is deliberately partial and deliberately deep. Four kinds
 * can be driven generically, because the product declares enough about them to
 * build the invocation from the declaration:
 *
 *  - **shortcuts** — dispatch the combination and diff the state.
 *  - **effects** — insert the unit and render the same bars twice, offline.
 *  - **instruments** — set it, play a note, listen for a voice.
 *  - **surfaces** — navigate and require the surface on screen.
 *
 * Store contracts and exported actions cannot: `setTrack(id, patch)` has no
 * generic patch, and inventing one would be inventing the test. Those come from
 * `cases.mjs`, one row at a time, and the ones not written yet stay FAIL.
 *
 * Every row is attempted on all three form factors. A function that works on a
 * desktop and does nothing on a phone is §5's defect arriving through a
 * different door, and a sweep that only ran on the widest screen would not see
 * it.
 */
import { snapshot, changedParts, seedFixture, markBaseline, reset } from './session.mjs';
import { CASES } from './cases.mjs';

/** How long to let the app settle after an invocation before looking. */
const SETTLE_MS = 140;

/**
 * A key combination as the app's own registry writes it, dispatched as a real
 * keyboard event.
 *
 * Playwright's `keyboard.press` wants its own spelling ('Control+Shift+KeyX'),
 * and translating between the two is where a sweep quietly stops pressing
 * anything. The combos are normalised in `shortcuts.ts` as sorted modifiers
 * plus a key, with `mod` meaning Ctrl or Cmd, so the translation is mechanical
 * — and a combo that fails to translate is reported rather than skipped.
 */
function toPlaywrightKey(combo) {
  const parts = combo.split('+');
  const key = parts.pop();
  const mods = parts.map((m) => {
    if (m === 'mod' || m === 'ctrl') return 'Control';
    if (m === 'shift') return 'Shift';
    if (m === 'alt') return 'Alt';
    if (m === 'meta') return 'Meta';
    return null;
  });
  if (mods.some((m) => m === null)) return null;
  const named = {
    space: 'Space',
    enter: 'Enter',
    escape: 'Escape',
    tab: 'Tab',
    home: 'Home',
    end: 'End',
    delete: 'Delete',
    backspace: 'Backspace',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
    arrowup: 'ArrowUp',
    arrowdown: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    up: 'ArrowUp',
    down: 'ArrowDown',
    comma: 'Comma',
    period: 'Period',
    slash: 'Slash',
    '/': 'Slash',
    ',': 'Comma',
    '.': 'Period',
  };
  const main = named[key] ?? (key.length === 1 ? key.toUpperCase() : null);
  if (main === null) return null;
  return [...mods, main].join('+');
}

async function sweepShortcuts(page, results) {
  // Read from the app's own registry rather than from a copy here. A sweep with
  // its own list is a sweep that covers what somebody remembered, which is the
  // failure `docs/FUNCTION_LEDGER.md` exists to remove one layer up.
  const shortcuts = await page.evaluate(() => window.__ml.shortcuts ?? []);
  if (shortcuts.length === 0) {
    results.push({
      id: 'shortcut:*',
      state: 'FAIL',
      why: 'the page publishes no shortcut registry',
    });
    return;
  }
  for (const shortcut of shortcuts) {
    const key = toPlaywrightKey(shortcut.combo);
    const id = `shortcut:${shortcut.id}`;
    if (key === null) {
      results.push({
        id,
        state: 'FAIL',
        why: `combo "${shortcut.combo}" has no keyboard spelling`,
      });
      continue;
    }
    await reset(page);
    // One undoable edit first, so undo and redo have something to move.
    //
    // `reset` restores the project wholesale, which leaves the undo stack where
    // the restore put it — and Ctrl+Z on an empty stack correctly does nothing.
    // Every history shortcut read as dead because of it.
    await page.evaluate(() => {
      const st = window.__ml.projectStore.getState();
      const t = st.project.tracks[0];
      if (t) st.setTrack(t.id, { name: `soak-${t.name}` });
    });
    // Focus the app body, not whatever the last case left focused. A shortcut
    // pressed into a text field is a shortcut that correctly does nothing.
    await page
      .locator('[data-testid="app-root"]')
      .first()
      .click({ position: { x: 4, y: 4 } });
    const before = await snapshot(page);
    await page.keyboard.press(key).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
    const after = await snapshot(page);
    const parts = changedParts(before, after);
    results.push(
      parts.length > 0
        ? { id, state: 'PASS', why: `${parts.join(', ')} changed` }
        : {
            id,
            state: 'FAIL',
            why: `${key} changed nothing${shortcut.when ? ` (${shortcut.when})` : ''}`,
          },
    );
  }
}

/**
 * Every effect kind, rendered twice offline and required to differ.
 *
 * This is `e2e/insertaudible.spec.ts` generalised to the whole rack. It is the
 * only assertion that means "the unit is in the signal path": a device that
 * appears in the rack, opens its editor and changes nothing about the audio is
 * exactly the defect §1.2 was, and no amount of UI checking sees it.
 *
 * The bar is a difference in the rendered samples, not a difference in the
 * project, because adding the effect always changes the project.
 */
async function sweepEffects(page, results) {
  const kinds = await page.evaluate(() =>
    (window.__ml.effectKinds ?? []).length > 0
      ? window.__ml.effectKinds
      : [...document.querySelectorAll('[data-testid^="fx-choice-"]')].map((n) =>
          n.getAttribute('data-testid').replace('fx-choice-', ''),
        ),
  );
  if (kinds.length === 0) {
    results.push({
      id: 'effect:*',
      state: 'FAIL',
      why: 'no effect kinds discoverable in the page',
    });
    return;
  }
  const dry = await renderWith(page, null);
  for (const kind of kinds) {
    const id = `effect:${kind}`;
    const wet = await renderWith(page, kind);
    if (wet === null) {
      results.push({ id, state: 'FAIL', why: 'render produced nothing' });
      continue;
    }
    const diff = rms(dry, wet);
    results.push(
      diff > 1e-6
        ? { id, state: 'PASS', why: `rendered audio differs by ${diff.toExponential(2)} RMS` }
        : { id, state: 'FAIL', why: 'rendered audio is identical to the dry render' },
    );
  }
}

function rms(a, b) {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += (a[i] - b[i]) ** 2;
  return n > 0 ? Math.sqrt(sum / n) : 0;
}

async function renderWith(page, kind) {
  const out = await page.evaluate(async (unit) => {
    const w = window;
    const { renderProject, preloadForRender } = w.__ml.exportMix;
    const st = () => w.__ml.projectStore.getState();
    st().setProject(structuredClone(w.__soakBaseline));
    const track = st().project.tracks.find((t) => t.type === 'instrument');
    if (unit !== null) {
      if (!st().addEffect(track.id, unit)) return null;
      // Moved off its defaults before it is asked whether it is heard.
      //
      // A flat EQ, a unity trim and an analyser are all *correctly* transparent
      // as inserted, and eight of the forty-one units read as dead because of
      // it. What the sweep wants to know is whether the unit is in the signal
      // path at all, and the way to ask is to turn something.
      const fx = st()
        .project.tracks.find((x) => x.id === track.id)
        .effects.at(-1);
      for (const [key, value] of Object.entries(fx.params ?? {})) {
        if (typeof value !== 'number') continue;
        // Away from where it is, and away from zero: a parameter nudged from
        // 0.5 to 0.5 is not a nudge, and one driven to its own default is the
        // same no-op with extra steps.
        st().setEffectParam(track.id, fx.id, key, value === 0 ? 0.62 : value * 0.37 + 0.11);
      }
    }
    const project = st().project;
    await preloadForRender(project);
    const res = await renderProject(project, {
      range: { startSec: 0, endSec: 3 },
      sampleRate: 44100,
      tailSeconds: 0,
    });
    // Decimated: three seconds at 44.1 kHz is 132,300 floats per render and the
    // rack has thirty-three units. Every 32nd sample is 4,134 points, which is
    // ample to tell "identical" from "different" and not ample enough to make
    // the sweep a memory experiment.
    const data = res.buffer.getChannelData(0);
    const out = [];
    for (let i = 0; i < data.length; i += 32) out.push(data[i]);
    return out;
  }, kind);
  return out;
}

/** Every instrument kind: set it, play a key, require a voice. */
async function sweepInstruments(page, results) {
  const kinds = await page.evaluate(() => window.__ml.instrumentKinds ?? []);
  const list = kinds.length > 0 ? kinds : ['synth', 'drum', 'quick', 'multi', 'rack'];
  for (const kind of list) {
    const id = `instrument:${kind}`;
    const heard = await page.evaluate(async (k) => {
      const st = () => window.__ml.projectStore.getState();
      st().setProject(structuredClone(window.__soakBaseline));
      const track = st().project.tracks.find((t) => t.type === 'instrument');
      st().setInstrument(track.id, k);
      // A sampler fetches its kit. Half a second was not enough and three of
      // the four instrument kinds read as silent because of it.
      await new Promise((r) => setTimeout(r, 2500));
      const engine = window.__ml.engine;
      // A key one of its zones actually covers.
      //
      // Middle C for everything was wrong: a drum kit maps its eight zones low
      // on the keyboard, so note 60 landed on nothing and the kit read as an
      // instrument that makes no sound. A sampler's zones say which keys it
      // answers to, so the probe reads them instead of assuming.
      const now = st().project.tracks.find((x) => x.id === track.id);
      const zones = now?.sampler?.zones ?? [];
      const zone = zones[0];
      // `keyLo`/`keyHi`, which is what `SampleZone` calls them. Guessing at
      // `lowKey`/`rootKey` fell through to middle C and the drum kit read as
      // silent a second time — the same defect wearing a different name.
      const key = zone ? Math.round((zone.keyLo + zone.keyHi) / 2) : 60;
      engine.liveNoteOn(track.id, key, 110);
      await new Promise((r) => setTimeout(r, 350));
      const sounding = window.__ml.activeSources();
      const held = (window.__ml.sustainingVoices?.() ?? {})[track.id] ?? 0;
      engine.liveNoteOff(track.id, key);
      return { sounding, held, key, zones: zones.length };
    }, kind);
    results.push(
      heard.sounding > 0 || heard.held > 0
        ? {
            id,
            state: 'PASS',
            why: `key ${heard.key} gave ${heard.sounding} source(s), ${heard.held} voice(s) held`,
          }
        : {
            id,
            state: 'FAIL',
            // A sampler with nothing loaded is silent and correct. Saying which
            // it is matters: "untested, nothing loaded" and "played and heard
            // nothing" are different claims and the ledger has to carry the
            // right one.
            why:
              heard.zones === 0
                ? 'no zones are loaded, so there is nothing for a note to play — untested here'
                : `key ${heard.key} of ${heard.zones} zone(s) produced no source and no held voice`,
          },
    );
  }
}

/** The hand-written half: store contracts and exported actions. */
async function sweepCases(page, results) {
  for (const testCase of CASES) {
    await reset(page);
    let outcome;
    try {
      const before = await snapshot(page);
      const detail = await page.evaluate(testCase.body, testCase.arg ?? null);
      await page.waitForTimeout(SETTLE_MS);
      const after = await snapshot(page);
      const parts = changedParts(before, after);
      const wanted = testCase.changes ?? ['project'];
      const missing = wanted.filter((w) => !parts.includes(w));
      outcome =
        missing.length === 0
          ? { state: 'PASS', why: `${parts.join(', ')} changed${detail ? ` — ${detail}` : ''}` }
          : {
              state: 'FAIL',
              why: `expected ${wanted.join(' + ')} to change; got ${parts.join(', ') || 'nothing'}`,
            };
    } catch (e) {
      outcome = { state: 'FAIL', why: `threw: ${String(e).slice(0, 120)}` };
    }
    results.push({ id: testCase.id, ...outcome });
  }
}

/**
 * One form factor, swept.
 *
 * Effects and instruments are audio and cannot differ by screen size, so they
 * run on the widest form only — three identical offline renders of the whole
 * rack is nine minutes spent proving arithmetic is the same arithmetic.
 * Shortcuts and store cases run everywhere, because those genuinely can differ:
 * a phone that never mounts a piano roll cannot honour a piano-roll shortcut.
 */
export async function runFunctional({ page, form }) {
  await seedFixture(page);
  await markBaseline(page);
  const results = [];
  await sweepShortcuts(page, results);
  await sweepCases(page, results);
  if (form.id === 'desktop') {
    await sweepEffects(page, results);
    await sweepInstruments(page, results);
  }
  return results.map((r) => ({ ...r, form: form.id }));
}
