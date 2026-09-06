import { test, expect, type Browser, type Page } from '@playwright/test';
import { RULER_SLACK, TOUCH_MIN, landing, reach, reachableBox } from './pointer';

/**
 * Track height: the grip, the global pair, and the floor under a finger.
 *
 * Three defects, and the third is the one a screenshot would not show:
 *
 *  - **`Track.height` was read by nothing.** In the schema since v6, clamped on
 *    load, and drawn at 64 px whatever it said — a field the persistence layer
 *    maintained for a feature that did not exist.
 *  - **The only route to lane height was a gesture.** A vertical drag with the
 *    zoom tool: no button, no key, no readout, and nothing that survived a
 *    reload. On a phone a vertical drag on the lanes is how you scroll, so the
 *    one route was one a touch user could not take.
 *  - **No touch floor.** 38 px at the minimum zoom and 30 px collapsed, on a
 *    surface whose lanes are the drag target for every clip on them.
 *
 * The arithmetic is `tests/trackHeight.test.ts`. What this adds is that the
 * numbers reach the screen, that the controls answer a real pointer of the
 * right kind, and — the case a unit test cannot make — that the grip does not
 * take the neighbouring header's presses.
 */

/** Newline, kept out of the template literals that report lists. */
const BREAK = String.fromCharCode(10);

const PHONE = { width: 390, height: 844 };
const TABLET = { width: 1024, height: 768 };
const DESKTOP = { width: 1440, height: 900 };

async function open(
  browser: Browser,
  viewport: { width: number; height: number },
  touch: boolean,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({
    viewport,
    hasTouch: touch,
    isMobile: touch && viewport.width < 700,
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem('motionlab.prefs.v1', JSON.stringify({ theme: 'dark', uiScale: 1 }));
      localStorage.setItem('txpps-motionlab-welcome-v1', '1');
    } catch {
      /* storage disabled — the defaults are close enough */
    }
  });
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 20000 });
  return { page, close: () => ctx.close() };
}

/**
 * Reach the arrangement the way the Reachability Matrix says to.
 *
 * `npm run route -- arrangement` records `nav-arrange` on both phone form
 * factors, `combo-mixer` on both tablet ones and `editor-tab-mixer` on the
 * desktop — where the arrangement is already the workspace and needs no
 * navigation at all. Asked rather than guessed, and the wait is what makes a
 * missing control a failure instead of a skipped case: a sweep written as
 * `if (!(await goTo(...))) return;` reports a pass on every form factor whose
 * shell has no such button.
 */
async function toArrangement(page: Page, form: 'phone' | 'tablet' | 'desktop') {
  if (form === 'phone') await page.locator('[data-testid="nav-arrange"]').tap();
  await expect(
    page.locator('[data-testid="arrangement"]'),
    `the arrangement never appeared on the ${form}`,
  ).toBeVisible();
  await page.waitForSelector('[data-testid^="track-header-"]', { timeout: 15000 });
  await page.waitForTimeout(400);
}

/** The name of the first track, which every locator below is keyed by. */
async function firstTrackName(page: Page): Promise<string> {
  const id = await page
    .locator('[data-testid^="track-header-"]')
    .first()
    .getAttribute('data-testid');
  return (id ?? '').replace('track-header-', '');
}

/** What the store says one track's height is, and what the global multiplier is. */
async function heightState(page: Page, name: string) {
  return page.evaluate((trackName) => {
    const w = window as unknown as {
      __ml?: {
        projectStore?: {
          getState: () => {
            project: {
              tracks: { name: string; height?: number }[];
              workspace: { laneScale: number };
            };
          };
        };
      };
    };
    const p = w.__ml?.projectStore?.getState().project;
    return {
      height: p?.tracks.find((t) => t.name === trackName)?.height ?? null,
      laneScale: p?.workspace.laneScale ?? null,
    };
  }, name);
}

/** The drawn height of a track's header, which is what a user actually sees. */
async function drawnHeight(page: Page, name: string): Promise<number> {
  const box = await page.locator(`[data-testid="track-header-${name}"]`).boundingBox();
  return box?.height ?? 0;
}

test.describe('a track can be given its own height', () => {
  test('desktop: dragging the grip resizes that track and nothing else', async ({ browser }) => {
    const { page, close } = await open(browser, DESKTOP, false);
    try {
      await toArrangement(page, 'desktop');
      const name = await firstTrackName(page);
      const names = await page
        .locator('[data-testid^="track-header-"]')
        .evaluateAll((els) =>
          els.map((e) => (e.getAttribute('data-testid') ?? '').replace('track-header-', '')),
        );
      const neighbour = names[1];

      const before = await drawnHeight(page, name);
      const neighbourBefore = await drawnHeight(page, neighbour);
      expect(await heightState(page, name), 'the track starts with a stored height').toMatchObject({
        height: null,
      });

      // A real drag: down, move, up, at coordinates. `usePointerDrag` listens on
      // `window` and needs the 3 px threshold passed, so the move is in steps.
      const grip = page.locator(`[data-testid="track-resize-${name}"]`);
      const gb = (await grip.boundingBox())!;
      await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
      await page.mouse.down();
      await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2 + 60, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(250);

      const after = await drawnHeight(page, name);
      expect(after, `the header was ${before}px and is ${after}px`).toBeGreaterThan(before + 40);
      expect(
        await drawnHeight(page, neighbour),
        'resizing one track moved the one below it',
      ).toBeCloseTo(neighbourBefore, 0);
      // And it reached the document, which is what makes it survivable.
      expect((await heightState(page, name)).height).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  test('desktop: a height survives a save and a reload', async ({ browser }) => {
    // The claim `Track.height` had never been able to make. It was clamped on
    // load for two directives while nothing wrote it, so the load path had
    // never once carried a value the product produced.
    const { page, close } = await open(browser, DESKTOP, false);
    try {
      await toArrangement(page, 'desktop');
      const name = await firstTrackName(page);

      const grip = page.locator(`[data-testid="track-resize-${name}"]`);
      const gb = (await grip.boundingBox())!;
      await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
      await page.mouse.down();
      await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2 + 70, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(200);

      const stored = (await heightState(page, name)).height!;
      expect(stored).toBeGreaterThan(0);

      await page.keyboard.press('Control+s');
      await page.waitForTimeout(900);
      await page.reload();
      await page.waitForSelector('[data-testid="app-root"]', { timeout: 20000 });
      await page.waitForTimeout(1400);

      expect(
        (await heightState(page, name)).height,
        'the height was written and the reload did not bring it back',
      ).toBeCloseTo(stored, 0);
      expect(await drawnHeight(page, name), 'it came back stored but is not drawn').toBeGreaterThan(
        90,
      );
    } finally {
      await close();
    }
  });

  test('desktop: two presses on the grip put the height back to the default', async ({
    browser,
  }) => {
    const { page, close } = await open(browser, DESKTOP, false);
    try {
      await toArrangement(page, 'desktop');
      const name = await firstTrackName(page);
      const grip = page.locator(`[data-testid="track-resize-${name}"]`);
      const gb = (await grip.boundingBox())!;
      const cx = gb.x + gb.width / 2;
      const cy = gb.y + gb.height / 2;

      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy + 60, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const grown = await drawnHeight(page, name);
      expect((await heightState(page, name)).height).toBeGreaterThan(0);

      // Two presses inside the double interval, at the grip's CURRENT position —
      // it has moved down with the edge it dragged.
      const gb2 = (await grip.boundingBox())!;
      const x2 = gb2.x + gb2.width / 2;
      const y2 = gb2.y + gb2.height / 2;
      await page.mouse.click(x2, y2);
      await page.waitForTimeout(60);
      await page.mouse.click(x2, y2);
      await page.waitForTimeout(300);

      expect(
        (await heightState(page, name)).height,
        'the second press did not clear the stored height',
      ).toBeNull();
      expect(await drawnHeight(page, name), `it was ${grown}px and did not return`).toBeLessThan(
        grown - 30,
      );
    } finally {
      await close();
    }
  });
});

test.describe('the global height control is a control, not only a gesture', () => {
  for (const form of ['desktop', 'tablet', 'phone'] as const) {
    const viewport = form === 'phone' ? PHONE : form === 'tablet' ? TABLET : DESKTOP;
    const touch = form !== 'desktop';

    test(`${form}: taller and shorter move every lane, and the readout says so`, async ({
      browser,
    }) => {
      const { page, close } = await open(browser, viewport, touch);
      try {
        await toArrangement(page, form);
        const name = await firstTrackName(page);
        const hand = touch ? 'touch' : 'mouse';

        const before = await drawnHeight(page, name);
        const scaleBefore = (await heightState(page, name)).laneScale!;
        await expect(page.locator('[data-testid="lane-height-readout"]')).toHaveText(
          `${Math.round(scaleBefore * 100)}%`,
        );

        await reach(page.locator('[data-testid="lane-taller"]'), hand, 'taller tracks');
        await page.waitForTimeout(250);
        const taller = await drawnHeight(page, name);
        expect(taller, `the lane was ${before}px and is ${taller}px`).toBeGreaterThan(before);
        const scaleAfter = (await heightState(page, name)).laneScale!;
        expect(scaleAfter).toBeGreaterThan(scaleBefore);
        await expect(
          page.locator('[data-testid="lane-height-readout"]'),
          'the readout did not follow the lanes',
        ).toHaveText(`${Math.round(scaleAfter * 100)}%`);

        await reach(page.locator('[data-testid="lane-shorter"]'), hand, 'shorter tracks');
        await page.waitForTimeout(250);
        expect(await drawnHeight(page, name), 'shorter did not undo taller').toBeLessThanOrEqual(
          taller,
        );
      } finally {
        await close();
      }
    });
  }

  test('the global scale is saved with the project, not with the session', async ({ browser }) => {
    // It was `uiStore` state, so every reload put every lane back to 64 px and
    // threw away a decision the user had made about their song.
    const { page, close } = await open(browser, DESKTOP, false);
    try {
      await toArrangement(page, 'desktop');
      const name = await firstTrackName(page);
      for (let i = 0; i < 2; i++) {
        await reach(page.locator('[data-testid="lane-taller"]'), 'mouse', 'taller tracks');
        await page.waitForTimeout(150);
      }
      const scale = (await heightState(page, name)).laneScale!;
      expect(scale).toBeGreaterThan(1);

      await page.keyboard.press('Control+s');
      await page.waitForTimeout(900);
      await page.reload();
      await page.waitForSelector('[data-testid="app-root"]', { timeout: 20000 });
      await page.waitForTimeout(1400);

      expect(
        (await heightState(page, name)).laneScale,
        'the vertical zoom did not survive the reload',
      ).toBeCloseTo(scale, 2);
    } finally {
      await close();
    }
  });
});

test.describe('a finger meets nothing under the minimum', () => {
  for (const form of ['phone', 'tablet'] as const) {
    const viewport = form === 'phone' ? PHONE : TABLET;

    test(`${form}: no lane is under the touch minimum, collapsed ones included`, async ({
      browser,
    }) => {
      const { page, close } = await open(browser, viewport, true);
      try {
        await toArrangement(page, form);

        // Collapse a track and take the global zoom to its floor — the two
        // states that produced 30 px and 38 px before the floor existed.
        const name = await firstTrackName(page);
        await page.evaluate((trackName) => {
          const w = window as unknown as {
            __ml?: {
              projectStore?: {
                getState: () => {
                  project: { tracks: { id: string; name: string }[] };
                  setTrack: (id: string, patch: { collapsed: boolean }) => void;
                };
              };
            };
          };
          const s = w.__ml?.projectStore?.getState();
          const t = s?.project.tracks.find((x) => x.name === trackName);
          if (t) s?.setTrack(t.id, { collapsed: true });
        }, name);
        /*
         * Press Shorter until it stops being offered.
         *
         * Bounded by the control's own disabled state rather than by a count.
         * A fixed ten taps hangs: the button disables itself at the minimum
         * scale — correctly — and `tap()` then waits for actionability until
         * the test's own timeout, reporting a timeout on the line *after* the
         * one that hung. Reading the state first and stopping is both the fix
         * and a claim worth making: the pair says when it has run out.
         */
        const shorter = page.locator('[data-testid="lane-shorter"]');
        let presses = 0;
        while (presses < 15 && !(await shorter.isDisabled())) {
          await shorter.tap();
          await page.waitForTimeout(120);
          presses++;
        }
        expect(presses, 'Shorter was disabled before it was ever pressed').toBeGreaterThan(0);
        await expect(
          shorter,
          'the scale has a minimum and the control never reached it',
        ).toBeDisabled();
        await page.waitForTimeout(400);

        const short = await page.evaluate((min) => {
          const out: string[] = [];
          for (const th of document.querySelectorAll('[data-testid^="track-header-"]')) {
            const r = th.getBoundingClientRect();
            // A header scrolled out of the sticky column has no height to
            // measure; the ones on screen are the claim.
            if (r.height < 1) continue;
            if (r.height < min - 0.5) {
              out.push(`${th.getAttribute('data-testid')} is ${Math.round(r.height)}px`);
            }
          }
          return out;
        }, TOUCH_MIN);
        expect(short, short.join(BREAK)).toEqual([]);
      } finally {
        await close();
      }
    });

    test(`${form}: every height control is a target a finger can hit`, async ({ browser }) => {
      const { page, close } = await open(browser, viewport, true);
      try {
        await toArrangement(page, form);
        const small: string[] = [];
        for (const id of ['lane-shorter', 'lane-taller']) {
          const el = page.locator(`[data-testid="${id}"]`);
          await expect(el, `${id} is not on the toolbar`).toHaveCount(1);
          await el.scrollIntoViewIfNeeded();
          const box = await reachableBox(el);
          if (box.width < TOUCH_MIN - RULER_SLACK || box.height < TOUCH_MIN - RULER_SLACK) {
            small.push(`${id} reaches ${box.width}x${box.height}`);
          }
          const where = await landing(el);
          if (!where.onTarget) small.push(`${id} is covered by ${where.found}`);
        }
        expect(small, small.join(BREAK)).toEqual([]);
      } finally {
        await close();
      }
    });

    test(`${form}: the track menu carries every command the grip cannot`, async ({ browser }) => {
      /*
       * WCAG 2.5.8's equivalent alternative, checked rather than asserted in a
       * comment.
       *
       * The grip is `display: none` on a coarse pointer, and it has to be: the
       * touch header is 64 px — 2 padding, an 18 px name row, a 44 px control
       * strip — so a grip with a 44 px press band along the bottom edge would
       * sit on top of mute, arm and monitor and take every one of their
       * presses. The provision obliges the alternative to carry *every* command
       * the absent control offers, and the grip offers two: drag to resize, and
       * press twice to reset.
       */
      const { page, close } = await open(browser, viewport, true);
      try {
        await toArrangement(page, form);
        const name = await firstTrackName(page);

        await expect(
          page.locator(`[data-testid="track-resize-${name}"]`),
          'the grip is drawn on a finger, where it would take the strip’s presses',
        ).toBeHidden();

        /*
         * A long press, which is the route the Reachability Matrix records for
         * this menu on a finger: "long-press on track-header-Drums".
         *
         * Not the menu BUTTON. `.th-row .th-mini` is `display: none` on a
         * coarse pointer — the touch header is one text row over one strip and
         * row 1 keeps nothing pressable — so tapping that locator waits for an
         * element that will never be actionable and the test times out on the
         * line after the one that hung. The button is the desktop's route and
         * the long press is touch's, which is the whole reason the matrix
         * records them separately.
         *
         * Dispatched as held pointer events rather than through
         * `touchscreen.tap()`, because `longPress` needs the press to stay down
         * for 500 ms and a tap is down and up in one call. `pointerType` is
         * 'touch' explicitly: the handler returns immediately without it, which
         * is how this same gesture came to be dead in the reachability sweep.
         */
        const header = page.locator(`[data-testid="track-header-${name}"]`);
        const hb = (await header.boundingBox())!;
        await header.dispatchEvent('pointerdown', {
          pointerType: 'touch',
          pointerId: 1,
          isPrimary: true,
          button: 0,
          clientX: hb.x + hb.width / 2,
          clientY: hb.y + 6,
        });
        await page.waitForTimeout(700);
        await header.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1, button: 0 });
        await page.waitForTimeout(300);

        const labels = await page
          .getByRole('menuitem')
          .evaluateAll((els) => els.map((e) => e.textContent ?? ''));
        for (const wanted of ['Taller track', 'Shorter track', 'Reset track height']) {
          expect(
            labels.some((l) => l.includes(wanted)),
            `the menu does not carry "${wanted}": ${labels.join(' / ')}`,
          ).toBe(true);
        }

        const before = await drawnHeight(page, name);
        await reach(page.locator(`[data-testid="menu-taller-${name}"]`), 'touch', 'taller track');
        await page.waitForTimeout(300);
        expect(
          await drawnHeight(page, name),
          'the menu offers the command and it does nothing',
        ).toBeGreaterThan(before);
      } finally {
        await close();
      }
    });
  }
});

test('the grip does not take the neighbouring header’s presses', async ({ browser }) => {
  /*
   * The fifth instance of this shape, asked before it becomes the fifth defect.
   *
   * `.alh-resize` reaches 2 px past its own row and `.resize-handle::after`
   * reached 3, which took the mixer's cue bar from 44 to 41. A hit area that
   * overhangs its row takes its neighbour's presses, and the row below a track
   * header is the next track's header — whose name row starts at its very first
   * pixel. So the grab zone is spent entirely upward, and this is the hit test
   * that says so: at one pixel below the boundary, the browser must already be
   * finding the next header rather than the grip above it.
   */
  const { page, close } = await open(browser, DESKTOP, false);
  try {
    await toArrangement(page, 'desktop');
    const names = await page
      .locator('[data-testid^="track-header-"]')
      .evaluateAll((els) =>
        els.map((e) => (e.getAttribute('data-testid') ?? '').replace('track-header-', '')),
      );
    const [first, second] = names;

    const report = await page.evaluate(
      ({ a, b }) => {
        const grip = document.querySelector(`[data-testid="track-resize-${a}"]`)!;
        const next = document.querySelector(`[data-testid="track-header-${b}"]`)!;
        const g = grip.getBoundingClientRect();
        const n = next.getBoundingClientRect();
        const x = g.x + g.width / 2;
        const describe = (el: Element | null) =>
          el
            ? `<${el.tagName.toLowerCase()}${
                el.getAttribute('data-testid')
                  ? ` data-testid="${el.getAttribute('data-testid')}"`
                  : ''
              }>`
            : 'nothing';
        return {
          // The grip must not reach past its own bottom edge at all.
          gripBottom: g.bottom,
          neighbourTop: n.top,
          // One pixel into the next header: whatever is there, it is not the
          // grip of the track above.
          intoNeighbour: describe(document.elementFromPoint(x, n.top + 1)),
          // And two pixels further in, where the neighbour's own name row is.
          deeper: describe(document.elementFromPoint(x, n.top + 3)),
          // The grip is still reachable on its own side of the line.
          onGrip: describe(document.elementFromPoint(x, g.y + g.height / 2)),
        };
      },
      { a: first, b: second },
    );

    expect(
      report.gripBottom,
      `the grip ends at ${report.gripBottom} and the next header starts at ${report.neighbourTop} — it overhangs`,
    ).toBeLessThanOrEqual(report.neighbourTop + 0.5);
    expect(
      report.intoNeighbour,
      `one pixel into the next header the press lands on ${report.intoNeighbour}`,
    ).not.toContain(`track-resize-${first}`);
    expect(
      report.deeper,
      `three pixels into the next header the press lands on ${report.deeper}`,
    ).not.toContain(`track-resize-${first}`);
    // Non-vacuity: the grip is findable where it is supposed to be, so the two
    // assertions above are not passing because nothing is there at all.
    expect(report.onGrip, 'the grip is not reachable at its own centre').toContain(
      `track-resize-${first}`,
    );
  } finally {
    await close();
  }
});
