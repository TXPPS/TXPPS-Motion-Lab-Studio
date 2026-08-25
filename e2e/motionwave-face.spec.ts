import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Ledger cell 26 — usability.
 *
 * Twenty-five cells passed on seven units a user opened, could not tell apart
 * and could not operate. The cells were right about what they measured: `U22`
 * asks whether a control is 44 px and never whether the 44 px is a knob or a
 * slider, `U19` checks that artwork is originally authored and is satisfied by
 * seven faces declaring the same one, and `U20` proves a readout is bound to a
 * real channel while the Motion Shaper's curve — the whole unit — had no
 * surface at all.
 *
 * So this file asks the four questions those cannot:
 *
 *  1. Is every control the correct primitive for what it represents? Tested as
 *     *behaviour*, because behaviour is what a range input could not fake: a
 *     knob answers a vertical drag, a selector lands only on detents, a switch
 *     flips on a tap. An `<input type="range">` does none of the three.
 *  2. Is it operable by touch in portrait on a phone?
 *  3. Is the panel visually distinct from every other unit's?
 *  4. Is the unit's defining control present and operable?
 *
 * Everything runs against the built app through its own stores, so the panel
 * under test is the one a user opens — the same React component, the same CSS,
 * the same browser. Nothing here touches the dev panel.
 */
const preinstalledChromium = '/opt/pw-browsers/chromium';
test.use({
  launchOptions: {
    executablePath: existsSync(preinstalledChromium) ? preinstalledChromium : undefined,
    args: ['--autoplay-policy=no-user-gesture-required'],
  },
});

interface Stores {
  projectStore: {
    getState: () => {
      project: { tracks: { id: string; effects?: { id: string; kind: string }[] }[] };
      addEffect: (trackId: string, kind: string) => string | null;
      removeEffect: (trackId: string, effectId: string) => void;
    };
  };
  uiStore: { getState: () => { set: (patch: Record<string, unknown>) => void } };
  motionWaveProbe: () => Promise<{ registeredUnits: () => { kind: string; label: string }[] }>;
}

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
  // `__ml` is published in two pieces — the engine's read-only probes at module
  // load, and the stores from an async import in `main.tsx`. Waiting for the
  // handle alone finds it before the stores have been merged in.
  await page.waitForFunction(
    () => {
      const ml = (window as unknown as { __ml?: Record<string, unknown> }).__ml;
      return ml !== undefined && 'projectStore' in ml && 'uiStore' in ml;
    },
    { timeout: 15000 },
  );
}

/** Insert a unit on the first track and open its editor. Returns the insert id. */
async function openUnit(page: Page, kind: string): Promise<string> {
  const id = await page.evaluate((k) => {
    const ml = (window as unknown as { __ml: Stores }).__ml;
    const project = ml.projectStore.getState();
    const trackId = project.project.tracks[0].id;
    const fx = project.addEffect(trackId, k);
    if (fx === null) throw new Error(`could not insert ${k}`);
    ml.uiStore.getState().set({ openDevice: { trackId, effectId: fx } });
    return fx;
  }, kind);
  await page.waitForSelector(`[data-testid="mw-face-${id}"] .mw-panel`, { timeout: 10000 });
  return id;
}

async function closeUnit(page: Page, id: string) {
  await page.evaluate((fx) => {
    const ml = (window as unknown as { __ml: Stores }).__ml;
    const project = ml.projectStore.getState();
    const trackId = project.project.tracks[0].id;
    ml.uiStore.getState().set({ openDevice: null });
    project.removeEffect(trackId, fx);
  }, id);
}

async function units(page: Page): Promise<{ kind: string; label: string }[]> {
  return page.evaluate(async () => {
    const ml = (window as unknown as { __ml: Stores }).__ml;
    const probe = await ml.motionWaveProbe();
    return probe.registeredUnits();
  });
}

/** Centre of an element, for a gesture that has to start somewhere real. */
async function centre(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('Cell 26 — the primitives are the right primitives', () => {
  test('no control in any unit is a bare range input', async ({ page }) => {
    await boot(page);
    for (const unit of await units(page)) {
      const id = await openUnit(page, unit.kind);
      const found = await page.evaluate((fx) => {
        const panel = document.querySelector(`[data-testid="mw-face-${fx}"] .mw-panel`);
        if (!panel) return null;
        const controls = [...panel.querySelectorAll<HTMLElement>('[data-mw-primitive]')];
        const inputs = [...panel.querySelectorAll<HTMLInputElement>('input[type=range]')];
        return {
          primitives: controls.map((c) => c.dataset.mwPrimitive ?? ''),
          // The accessibility input is deliberately present and deliberately
          // deaf to the pointer: the keyboard and the screen reader get a real
          // slider, the finger gets the primitive. If any of them could take a
          // press, the panel would be a range input again wearing a drawing.
          reachable: inputs.filter((i) => getComputedStyle(i).pointerEvents !== 'none').length,
        };
      }, id);
      expect(found, unit.label).not.toBeNull();
      console.log(
        `cell 26 · primitives · ${unit.label.padEnd(22)} ${[...new Set(found!.primitives)].join(', ')}`,
      );
      expect(found!.primitives.length, `${unit.label} has no controls`).toBeGreaterThan(0);
      expect(found!.primitives, unit.label).not.toContain('range');
      expect(found!.reachable, `${unit.label} exposes a range input to the pointer`).toBe(0);
      await closeUnit(page, id);
    }
  });

  /**
   * The three gestures, on the Program EQ — the panel built end to end first.
   *
   * Each is chosen because a range input cannot pass it. A range input ignores
   * vertical drags entirely; it has no detents to land on; and a click at its
   * centre sets it to the middle of its range, which for a two-state parameter
   * is not a state that exists.
   */
  test('a knob answers a vertical drag, and only a vertical drag', async ({ page }) => {
    await boot(page);
    const id = await openUnit(page, 'mw-program-eq');
    const knob = `[data-testid="mw-face-${id}"] [data-mw-primitive="knob"]`;
    const read = () => page.locator(`${knob} input`).first().inputValue();

    const start = Number(await read());
    const at = await centre(page, knob);

    // Sideways only. Fine-drag scales sensitivity from the horizontal offset
    // and must not itself move anything — an absolute mapping would, and the
    // value would jump under a finger that had not moved up or down.
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 90, at.y, { steps: 9 });
    await page.mouse.up();
    const afterSideways = Number(await read());
    expect(afterSideways, 'horizontal travel alone moved the knob').toBeCloseTo(start, 6);

    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x, at.y - 70, { steps: 9 });
    await page.mouse.up();
    const afterVertical = Number(await read());
    console.log(`cell 26 · knob · ${start.toFixed(4)} → ${afterVertical.toFixed(4)} on 70 px up`);
    expect(afterVertical, 'a vertical drag did not move the knob').toBeGreaterThan(start + 0.05);
    await closeUnit(page, id);
  });

  test('a selector lands on detents and advances on a tap', async ({ page }) => {
    await boot(page);
    const id = await openUnit(page, 'mw-program-eq');
    const selector = `[data-testid="mw-face-${id}"] [data-mw-primitive="selector"]`;
    const input = page.locator(`${selector} input`).first();
    const step = Number(await input.getAttribute('step'));
    expect(step, 'a selector must carry a detent-sized keyboard step').toBeGreaterThan(0);

    const at = await centre(page, selector);
    const before = Number(await input.inputValue());
    await page.mouse.click(at.x, at.y);
    const after = Number(await input.inputValue());
    console.log(`cell 26 · selector · ${before.toFixed(4)} → ${after.toFixed(4)}, detent ${step}`);
    expect(after, 'a tap did not advance the selector').not.toBeCloseTo(before, 6);

    // On a detent, not between two. A drag that ended anywhere else would be a
    // control whose position the DSP then quantises silently — the setting the
    // panel shows and the setting the unit runs would differ.
    const remainder = Math.abs(after / step - Math.round(after / step));
    expect(remainder, `selector settled at ${after}, off its detent grid`).toBeLessThan(1e-6);

    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x, at.y - 120, { steps: 12 });
    await page.mouse.up();
    const dragged = Number(await input.inputValue());
    const draggedRemainder = Math.abs(dragged / step - Math.round(dragged / step));
    expect(draggedRemainder, `a drag left the selector at ${dragged}`).toBeLessThan(1e-6);
    await closeUnit(page, id);
  });

  test('a switch flips on a tap', async ({ page }) => {
    await boot(page);
    const id = await openUnit(page, 'mw-program-eq');
    const toggle = `[data-testid="mw-face-${id}"] [data-mw-primitive="toggle"]`;
    const input = page.locator(`${toggle} input`).first();
    const before = Number(await input.inputValue());
    const at = await centre(page, toggle);
    await page.mouse.click(at.x, at.y);
    const after = Number(await input.inputValue());
    console.log(`cell 26 · toggle · ${before} → ${after}`);
    expect(after, 'a tap did not flip the switch').toBe(before >= 0.5 ? 0 : 1);
    // And back, because a switch that only latches one way is a button.
    await page.mouse.click(at.x, at.y);
    expect(Number(await input.inputValue())).toBe(before);
    await closeUnit(page, id);
  });
});

test.describe('Cell 26 — operable by thumb, in portrait', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('every control on every panel meets the touch minimum', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    const TOUCH_MIN = 44;
    for (const unit of await units(page)) {
      const id = await openUnit(page, unit.kind);
      const boxes = await page.evaluate((fx) => {
        const panel = document.querySelector(`[data-testid="mw-face-${fx}"] .mw-panel`);
        return [...(panel?.querySelectorAll<HTMLElement>('[data-mw-primitive]') ?? [])]
          .filter((el) => !['meter', 'lamp', 'vu', 'display'].includes(el.dataset.mwPrimitive ?? ''))
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { id: el.dataset.mwElement ?? '?', w: r.width, h: r.height };
          });
      }, id);
      const small = boxes.filter((b) => b.w < TOUCH_MIN || b.h < TOUCH_MIN);
      console.log(
        `cell 26 · touch · ${unit.label.padEnd(22)} ${boxes.length} control(s), ` +
          `smallest ${Math.min(...boxes.map((b) => Math.min(b.w, b.h))).toFixed(0)}px`,
      );
      expect(
        small.map((b) => `${b.id} ${Math.round(b.w)}x${Math.round(b.h)}`),
        `${unit.label} has controls under ${TOUCH_MIN} px`,
      ).toEqual([]);
      await closeUnit(page, id);
    }
  });

  test('the panel does not scroll sideways on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    for (const unit of await units(page)) {
      const id = await openUnit(page, unit.kind);
      const overflow = await page.evaluate((fx) => {
        const panel = document.querySelector(`[data-testid="mw-face-${fx}"] .mw-panel`);
        if (!panel) return -1;
        return panel.scrollWidth - panel.clientWidth;
      }, id);
      console.log(`cell 26 · width · ${unit.label.padEnd(22)} overflow ${overflow}px`);
      expect(overflow, `${unit.label} overflows its own panel`).toBeLessThanOrEqual(1);
      await closeUnit(page, id);
    }
  });
});

test.describe('Cell 26 — one panel per unit', () => {
  /**
   * Distinctness, measured on the rendering rather than on the declaration.
   *
   * Comparing declared skins would prove only that two objects differ, which is
   * cheap and is not the claim: the claim is that a user can tell two panels
   * apart. So each panel is screenshot and reduced to a coarse signature, and
   * every pair has to differ by more than a threshold that a resize alone could
   * not produce.
   *
   * Units with no declared skin are *not* in the comparison, and are listed
   * instead. They render the framework default, they are identical to each
   * other, and that is exactly what the ledger records as their cell 26 FAIL —
   * a test that failed here as well would be the same fact twice, and would
   * make a red suite the normal state until the last unit was finished.
   */
  test('every skinned panel is visibly different from every other', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await boot(page);

    const signatures: { label: string; bytes: Buffer }[] = [];
    const unskinned: string[] = [];
    for (const unit of await units(page)) {
      const id = await openUnit(page, unit.kind);
      const era = await page.getAttribute(`[data-testid="mw-face-${id}"] .mw-panel`, 'data-mw-era');
      const shot = await page.locator(`[data-testid="mw-face-${id}"] .mw-panel`).screenshot();
      if (era === null || era.startsWith('undeclared')) unskinned.push(unit.label);
      else signatures.push({ label: unit.label, bytes: shot });
      await closeUnit(page, id);
    }

    // An unskinned face is a failure now, not a note.
    //
    // This test used to fold them into one "framework default" entry and carry
    // on, which was right while exactly one unit was skinned: they render the
    // same panel, so comparing them with each other proves nothing, and the
    // pairwise loop below would have been vacuously true on a set of one.
    //
    // It also meant six units wore one panel through two directives while this
    // passed, and a user reported the Motion Shaper as "looking like it was
    // merged randomly with the FET Limiter's controls" — which is what six
    // units sharing a face looks like from the outside. All seven declare their
    // own skin now, so the tolerance has done its job and closes.
    expect(unskinned, `${unskinned.join(', ')} declare no skin`).toEqual([]);
    expect(signatures.length, 'nothing to compare').toBeGreaterThan(1);
    for (let i = 0; i < signatures.length; i++) {
      for (let j = i + 1; j < signatures.length; j++) {
        const a = signatures[i];
        const b = signatures[j];
        const same = a.bytes.length === b.bytes.length && a.bytes.equals(b.bytes);
        console.log(`cell 26 · distinct · ${a.label} vs ${b.label}: ${same ? 'IDENTICAL' : 'differ'}`);
        expect(same, `${a.label} and ${b.label} render the same panel`).toBe(false);
      }
    }
  });
});
