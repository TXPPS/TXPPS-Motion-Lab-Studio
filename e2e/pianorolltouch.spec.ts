import { test, expect, type Browser, type Page } from '@playwright/test';
import { landing, reach, reachableBox } from './pointer';

/**
 * Directive 12 §6 — the piano roll under a thumb.
 *
 * Capability parity, affordance divergence. Every edit the roll offers has to
 * be reachable on a phone; how it is reached may differ, and on a desktop the
 * hover, the thin edges and the modifier keys stay exactly as they are. What
 * may not differ is whether the edit is possible at all, and five of them were
 * not:
 *
 *  - **One zoom axis.** `ROW_H` was a module constant of 16, so the roll had a
 *    time zoom and a lane height, and a musician editing a two-octave line got
 *    the same view as one checking the shape of a verse.
 *  - **16px lanes on a phone.** A lane is the target for every note on it, and
 *    16 is under a third of the touch minimum.
 *  - **An invisible resize handle**, 14px wide on touch — wider than a
 *    sixteenth note at the default zoom, so it covered the note and every
 *    attempt to *move* a short note resized it instead.
 *  - **Nothing to read while dragging.** A finger covers the note it is
 *    holding, and touch has no hover, no tooltip and no cursor beside the
 *    thing it is moving.
 *  - **Nudge only on the arrow keys**, which a phone does not have.
 */

/** The touch minimum. `geometry.ts` holds the lane floor to the same number. */
const MIN_TOUCH = 44;
const LANE_MIN = 56;

/** A newline, kept out of the template literals that report lists. */
const BREAK = String.fromCharCode(10);

async function phone(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 20000 });
  await page.waitForTimeout(500);
  return { page, close: () => ctx.close() };
}

/**
 * Open a MIDI clip in the roll, by asking the app rather than by driving to it.
 *
 * A fixture step, not a claim: which route reaches the piano roll is
 * `e2e/panematrix.spec.ts`'s subject, and repeating it here would make every
 * case in this file fail for that reason instead of its own.
 */
async function openRoll(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __ml?: {
        projectStore?: {
          getState: () => {
            project: { clips: { id: string; notes?: unknown[] }[] };
          };
        };
        uiStore?: { getState: () => { openEditorFor: (id: string, phone?: boolean) => void } };
      };
    };
    const clips = w.__ml?.projectStore?.getState().project.clips ?? [];
    // A clip with notes in it. The demo's first clip is a drum groove and the
    // roll opens on it happily, but a spec about editing notes needs notes.
    const clip = clips.find((c) => (c.notes?.length ?? 0) > 2);
    if (clip) w.__ml?.uiStore?.getState().openEditorFor(clip.id, true);
  });
  await page.waitForSelector('[data-testid="piano-roll"]', { timeout: 10000 });
  await page.waitForSelector('[data-testid="pr-note"]', { timeout: 10000 });
  await page.waitForTimeout(400);
}

/**
 * Put a note in the middle of the roll before pressing it.
 *
 * `scrollIntoViewIfNeeded` scrolls the least it can, which lands an off-screen
 * note on the bottom edge — and the velocity lane is `position: sticky` there,
 * deliberately, so the note arrives behind it. That is the roll working as
 * designed and a test measuring the wrong pixel: a user in that position
 * scrolls a little further. Centring is what a user does, so it is what this
 * does.
 */
async function centre(page: Page, selector: string) {
  await page
    .locator(selector)
    .first()
    .evaluate((el) => {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    });
  await page.waitForTimeout(200);
}

test.describe('the piano roll is editable by thumb', () => {
  test('a lane is at least the touch minimum, whatever the stored zoom says', async ({
    browser,
  }) => {
    const { page, close } = await phone(browser);
    await openRoll(page);

    // Zoomed all the way out, which is where the floor has to hold.
    for (let i = 0; i < 12; i++) {
      await page.locator('[data-testid="pr-zoom-pitch-out"]').click();
    }
    await page.waitForTimeout(200);

    const lane = await page.locator('[data-testid="pr-key"]').first().boundingBox();
    expect(
      lane?.height ?? 0,
      `a pitch lane is ${Math.round(lane?.height ?? 0)}px on a phone`,
    ).toBeGreaterThanOrEqual(LANE_MIN);
    await close();
  });

  test('time and pitch zoom independently', async ({ browser }) => {
    const { page, close } = await phone(browser);
    await openRoll(page);

    const read = () =>
      page.evaluate(() => {
        const w = window as unknown as {
          __ml?: { uiStore?: { getState: () => { prPxPerBeat: number; prRowH: number } } };
        };
        const s = w.__ml?.uiStore?.getState();
        return { ppb: s?.prPxPerBeat ?? 0, rowH: s?.prRowH ?? 0 };
      });

    const before = await read();
    await page.locator('[data-testid="pr-zoom-time-in"]').click();
    await page.waitForTimeout(120);
    const afterTime = await read();
    expect(afterTime.ppb, 'zooming time did nothing').toBeGreaterThan(before.ppb);
    expect(afterTime.rowH, 'zooming time moved the pitch axis too').toBe(before.rowH);

    await page.locator('[data-testid="pr-zoom-pitch-in"]').click();
    await page.waitForTimeout(120);
    const afterPitch = await read();
    expect(afterPitch.rowH, 'zooming pitch did nothing').toBeGreaterThan(afterTime.rowH);
    expect(afterPitch.ppb, 'zooming pitch moved the time axis too').toBe(afterTime.ppb);
    await close();
  });

  test('every zoom and nudge control is a target a finger can hit', async ({ browser }) => {
    const { page, close } = await phone(browser);
    await openRoll(page);
    // A note has to be selected or the nudge pad is disabled, and a disabled
    // control is not a target this rule applies to.
    await page.locator('[data-testid="pr-note"]').first().tap();
    await page.waitForTimeout(200);

    const small: string[] = [];
    for (const id of [
      'pr-zoom-time-out',
      'pr-zoom-time-in',
      'pr-zoom-pitch-out',
      'pr-zoom-pitch-in',
      'pr-nudge-earlier',
      'pr-nudge-later',
      'pr-nudge-up',
      'pr-nudge-down',
    ]) {
      const el = page.locator(`[data-testid="${id}"]`);
      await expect(el, `${id} is not on the toolbar`).toHaveCount(1);
      await el.scrollIntoViewIfNeeded();
      const box = await reachableBox(el);
      if (box.width < MIN_TOUCH || box.height < MIN_TOUCH) {
        small.push(`${id} reaches ${box.width}x${box.height}`);
      }
      const where = await landing(el);
      if (!where.onTarget) small.push(`${id} is covered by ${where.found}`);
    }
    expect(small, small.join('\n')).toEqual([]);
    await close();
  });

  test('the touch-only controls are on screen without scrolling the bar', async ({ browser }) => {
    const { page, close } = await phone(browser);
    await openRoll(page);

    /*
     * `.pr-toolbar` is `overflow-x: auto` and holds about twenty controls in
     * 390px. Measured before the fix: every control from the quantize strength
     * rightward was off screen — including the nudge pad and both zoom axes,
     * which exist precisely because a phone has no arrow keys and no modifier.
     * They were reachable, one horizontal flick past fifteen other controls,
     * which is a capability present and an affordance absent.
     *
     * Asked as "is it in the bar's own visible box", not "does Playwright
     * consider it visible": Playwright will happily scroll to it and call it
     * visible, which is exactly the question this is not asking.
     *
     * The **nudge pad** is what has to be there without a flick, and only it.
     * Four 44px targets plus the toolbar's padding is 184 of a 390px phone;
     * the zoom pair is another 200 and does not fit beside it on a 360px one,
     * so it starts second and scrolls on the narrowest screens. That is the
     * right trade: nudge is an *edit* a phone cannot otherwise make, and zoom
     * is a view control that survives being one flick away. Its size and
     * reachability are asserted above, which is the part that was failing.
     */
    const offScreen = await page.evaluate(() => {
      const bar = document.querySelector('.pr-toolbar')!.getBoundingClientRect();
      const out: string[] = [];
      for (const id of ['pr-nudge-earlier', 'pr-nudge-down', 'pr-nudge-up', 'pr-nudge-later']) {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (!el) {
          out.push(`${id} is not in the toolbar at all`);
          continue;
        }
        const r = el.getBoundingClientRect();
        if (r.left < bar.left - 1 || r.right > bar.right + 1) {
          out.push(
            `${id} sits at ${Math.round(r.left)}..${Math.round(r.right)} in a bar that ends at ${Math.round(bar.right)}`,
          );
        }
      }
      return out;
    });
    expect(offScreen, offScreen.join(BREAK)).toEqual([]);
    await close();
  });

  test('every control on the bar is a touch target, scale lock and Chords included', async ({
    browser,
  }) => {
    const { page, close } = await phone(browser);
    await openRoll(page);

    /*
     * Scale lock and chord stamping are two of the things §6 asks for by name,
     * and both were on the bar and unusable: LOCK measured 36 x 30 on a phone
     * and the Chords button 62 x 34, against a 44 px minimum. A feature that is
     * present and cannot be hit is harder to notice than one that is missing,
     * because the screenshot looks right.
     *
     * Height rather than reach, and deliberately: the bar scrolls sideways, so
     * a control's *reachability* depends on where the bar happens to be
     * scrolled, while its size does not. Reach is asserted for the pads above,
     * which are the ones that must not need a flick.
     */
    const small = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll(
        '.pr-toolbar button, .pr-toolbar select, .pr-toolbar input',
      )) {
        if ((el as HTMLButtonElement).disabled) continue;
        const r = el.getBoundingClientRect();
        const what =
          el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent ?? '?';
        if (r.height < 44)
          out.push(`${what.trim().slice(0, 30)} is ${Math.round(r.height)}px tall`);
      }
      return out;
    });
    expect(small, small.join(BREAK)).toEqual([]);

    // And the two named ones are actually there to be hit.
    await expect(page.locator('[data-testid="pr-chords"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="scale-lock"]')).toHaveCount(1);
    await close();
  });

  test('the nudge pad moves the selection, in both axes', async ({ browser }) => {
    const { page, close } = await phone(browser);
    await openRoll(page);

    await centre(page, '[data-testid="pr-note"]');
    const note = page.locator('[data-testid="pr-note"]').first();
    await reach(note, 'touch', 'a note');
    await page.waitForTimeout(250);

    const selected = () =>
      page.evaluate(() => {
        const w = window as unknown as {
          __ml?: {
            uiStore?: { getState: () => { selectedNoteIds: string[] } };
            projectStore?: {
              getState: () => {
                project: {
                  clips: { id: string; notes?: { id: string; pitch: number; start: number }[] }[];
                };
              };
            };
          };
        };
        const id = w.__ml?.uiStore?.getState().selectedNoteIds[0];
        if (!id) return null;
        // Clips live on the project, not on the track — the same read that
        // opens the roll above. A lookup through `track.clips` finds nothing
        // and reports "the tap did not select", which is a true sentence about
        // the wrong subject.
        for (const c of w.__ml?.projectStore?.getState().project.clips ?? []) {
          const nt = c.notes?.find((x) => x.id === id);
          if (nt) return { pitch: nt.pitch, start: nt.start };
        }
        return null;
      });

    const before = await selected();
    expect(before, 'tapping a note did not select it').not.toBeNull();

    await reach(page.locator('[data-testid="pr-nudge-up"]'), 'touch', 'nudge up');
    await page.waitForTimeout(200);
    expect((await selected())!.pitch, 'transpose up did nothing').toBe(before!.pitch + 1);

    await reach(page.locator('[data-testid="pr-nudge-later"]'), 'touch', 'nudge later');
    await page.waitForTimeout(200);
    expect((await selected())!.start, 'nudge later did nothing').toBeGreaterThan(before!.start);
    await close();
  });

  test('a dragged note reads out somewhere the finger is not', async ({ browser }) => {
    const { page, close } = await phone(browser);
    await openRoll(page);

    await centre(page, '[data-testid="pr-note"]');
    const note = page.locator('[data-testid="pr-note"]').first();
    const box = (await note.boundingBox())!;
    const from = { x: box.x + box.width / 3, y: box.y + box.height / 2 };

    /*
     * A real drag, held open across the assertion.
     *
     * `touchscreen.tap()` cannot do this — the readout exists only while a
     * pointer is down, and a tap is down and up in one call. So this drives
     * the sequence and asserts in the middle of it, which is the only moment
     * the thing under test exists.
     */
    await page.touchscreen.tap(from.x, from.y);
    await page.waitForTimeout(150);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y - 4, { steps: 6 });
    await page.waitForTimeout(150);

    const readout = page.locator('[data-testid="pr-readout"]');
    await expect(readout, 'nothing said what the finger was covering').toHaveCount(1);
    const text = (await readout.textContent())?.trim() ?? '';
    expect(text, `the readout said "${text}"`).toMatch(/[A-G]#?-?\d/);

    const rBox = (await readout.boundingBox())!;
    const covered =
      from.x + 40 >= rBox.x &&
      from.x + 40 <= rBox.x + rBox.width &&
      from.y - 4 >= rBox.y &&
      from.y - 4 <= rBox.y + rBox.height;
    expect(covered, 'the readout is under the hand it exists to see past').toBe(false);

    await page.mouse.up();
    await page.waitForTimeout(200);
    await expect(readout, 'the readout outlived the gesture').toHaveCount(0);
    await close();
  });

  test('a short note keeps a body to drag', async ({ browser }) => {
    const { page, close } = await phone(browser);
    await openRoll(page);

    /*
     * The short-note rule, measured on the screen rather than in arithmetic.
     *
     * Zoomed out far enough that notes are narrow, no note may be entirely
     * covered by its own resize handle — because both gestures are a drag, and
     * the handle is on top, so a note in that state can be lengthened and never
     * moved. `tests/pianoRollGeometry.test.ts` proves the rule; this proves it
     * reaches the DOM.
     */
    for (let i = 0; i < 6; i++) await page.locator('[data-testid="pr-zoom-time-out"]').click();
    await page.waitForTimeout(250);

    const swallowed = await page.evaluate(() => {
      const out: string[] = [];
      for (const note of document.querySelectorAll('[data-testid="pr-note"]')) {
        const edge = note.querySelector('[data-testid="pr-note-edge"]');
        if (!edge) continue;
        const n = note.getBoundingClientRect();
        const e = edge.getBoundingClientRect();
        if (n.width - e.width < 24) {
          out.push(`a ${Math.round(n.width)}px note carries a ${Math.round(e.width)}px handle`);
        }
      }
      return out;
    });
    expect(swallowed, swallowed.join('\n')).toEqual([]);
    await close();
  });
});
