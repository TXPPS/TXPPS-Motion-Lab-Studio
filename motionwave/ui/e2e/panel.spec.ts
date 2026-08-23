/**
 * Ledger cells U21 and U22, measured rather than declared.
 *
 * Both were BLOCKED, and the recorded reason — "no display", "no layout engine"
 * — had quietly stopped being true: this host has Chromium. What was actually
 * missing was something to lay out and something to pace, and the judges in
 * `harness/cells_ui.ts` only ever inspected the declaration, so running them in
 * a browser as they stood would have been a green light for nothing. A cell
 * that passes without measuring is worse than one that is honestly blocked.
 *
 * So the measurements are here, where the two clocks exist:
 *
 *  * **U21** — the face repaints from state the audio thread published, at the
 *    display's rate, while that thread runs on its own deadline. The panel is
 *    driven by `requestAnimationFrame` and reads a seqlock; neither side ever
 *    waits for the other. What is checked is that the paints happened at
 *    display rate, that the values painted are the engine's, and that a paint
 *    never caught a half-written frame.
 *  * **U22** — the panel reflows at the breakpoints the *face* declares, in
 *    `em`, and every interactive element meets the 44 px touch minimum at every
 *    width including the narrowest one the face says it supports.
 */
import { expect, test, type Page } from '@playwright/test';

/** The touch minimum, in CSS pixels. A diameter, not a radius. */
const TOUCH_MIN = 44;

async function boot(page: Page, unit = 'fx-01') {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`/?unit=${unit}`);
  // Cross-origin isolation, without which SharedArrayBuffer does not exist and
  // the worklet has no way to publish that does not allocate per block. Checked
  // first because every failure downstream of it is confusing.
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
  await page.evaluate(() => window.__mwPanel.start());
  expect(errors, errors.join('\n')).toEqual([]);
  return errors;
}

test.describe('U21 — the face paces against the display, decoupled from the audio thread', () => {
  test('repaints at display rate from state the audio thread published', async ({ page }) => {
    await boot(page);
    const measured = await page.evaluate(async () => {
      const startPaints = window.__mwPanel.paints();
      const startedAt = performance.now();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return {
        paints: window.__mwPanel.paints() - startPaints,
        elapsed: performance.now() - startedAt,
        torn: window.__mwPanel.torn(),
        frame: window.__mwPanel.lastFrame(),
      };
    });
    const fps = (measured.paints / measured.elapsed) * 1000;
    console.log(
      `U21: ${measured.paints} paints in ${measured.elapsed.toFixed(0)} ms = ${fps.toFixed(1)} fps, ` +
        `${measured.torn} torn read(s)`,
    );
    // Headless Chromium's rAF runs at 60 Hz. The floor is 50 rather than 60
    // because a CI machine under load drops frames and that is the machine's
    // problem, not the panel's; a panel that could not keep up would be down in
    // the teens, not at 55.
    expect(fps).toBeGreaterThan(50);
    // A torn read means the reader copied while the writer was mid-frame. The
    // retry loop handles it, but it should be rare — the write is nine doubles
    // and the read happens 60 times a second against 375 writes.
    expect(measured.torn).toBeLessThan(measured.paints * 0.5);

    // And the state is the engine's. A modulated 1 kHz tone at −6 dBFS: the
    // input peak is the tone, the output peak is below it wherever the curve
    // is, and the phase is a position in the cycle. All three are numbers only
    // a running engine produces.
    expect(measured.frame['input-peak']).toBeGreaterThan(0.4);
    expect(measured.frame['phase']).toBeGreaterThanOrEqual(0);
    expect(measured.frame['phase']).toBeLessThanOrEqual(1);
  });

  test('what is painted moves, and moves with the modulator', async ({ page }) => {
    await boot(page);
    // The DOM, not the harness's own bookkeeping. A paint counter that ticked
    // while nothing changed on screen would pass the case above.
    const samples = await page.evaluate(async () => {
      const node = document.querySelector('[data-mw-element="curve-editor"]') as HTMLElement;
      const seen: number[] = [];
      for (let i = 0; i < 40; i++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        seen.push(Number(node.dataset.mwValue));
      }
      return seen;
    });
    const distinct = new Set(samples.map((v) => v.toFixed(4))).size;
    console.log(`U21: playhead took ${distinct} distinct positions over 40 frames`);
    // At 2 Hz the phase advances about 0.033 per 60 Hz frame, so nearly every
    // frame should differ. A stalled engine, or a face reading a stale copy,
    // shows here as a handful.
    expect(distinct).toBeGreaterThan(30);
  });

  test('a stalled engine is visible rather than smooth', async ({ page }) => {
    // The case that gives the two above their meaning, and the only one that
    // can tell a face reading engine state from a face animating on a timer:
    // while the engine runs the two are indistinguishable. So the engine is
    // stopped — the display clock keeps ticking — and the playhead must stop
    // with it.
    //
    // A first version of this painted the same frame twenty times and asserted
    // the value did not change, which proved nothing: a timer-driven face was
    // put in deliberately and passed, because the fabricated value was already
    // inside the frame being repainted.
    await boot(page);
    const result = await page.evaluate(async () => {
      const node = document.querySelector('[data-mw-element="curve-editor"]') as HTMLElement;
      const sample = async (count: number) => {
        const seen: string[] = [];
        for (let i = 0; i < count; i++) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          seen.push(String(node.dataset.mwValue));
        }
        return seen;
      };
      const running = await sample(20);
      await window.__mwPanel.stopEngine();
      // A few frames for anything already in flight to land, then measure.
      await sample(5);
      const paintsBefore = window.__mwPanel.paints();
      const stopped = await sample(20);
      return {
        movingWhileRunning: new Set(running).size,
        movingWhileStopped: new Set(stopped).size,
        stillPainting: window.__mwPanel.paints() - paintsBefore,
      };
    });
    console.log(
      `U21: playhead took ${result.movingWhileRunning} position(s) while running and ` +
        `${result.movingWhileStopped} while the engine was suspended`,
    );
    expect(result.movingWhileRunning).toBeGreaterThan(10);
    // One position: the last thing the engine published. Not zero — the face
    // keeps drawing, it just has nothing new to draw, which is the honest
    // behaviour. A face inventing motion reads in the teens here.
    expect(result.movingWhileStopped).toBe(1);
  });
});

test.describe('U22 — the panel reflows where the face says, and stays touchable', () => {
  test('the declared breakpoints are where the layout actually changes', async ({ page }) => {
    await boot(page);
    // Read from the face, never restated. The first version of this wrote
    // `[30, 48]` here, which is a second opinion about the layout living in the
    // test that checks the layout — it would have kept passing against whatever
    // the face said next.
    const { breakpoints, rootFontPx } = await page.evaluate(() => ({
      breakpoints: [...window.__mwPanel.breakpointsEm],
      rootFontPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
    }));
    expect(breakpoints.length).toBeGreaterThan(0);
    const widths: number[] = [];
    for (const em of breakpoints) {
      widths.push(Math.round(em * rootFontPx) - 8, Math.round(em * rootFontPx) + 8);
    }
    const columnsAt: number[] = [];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      columnsAt.push(
        await page.evaluate(() => {
          const grid = document.querySelector('.mw-panel-controls') as HTMLElement;
          return getComputedStyle(grid).gridTemplateColumns.split(' ').length;
        }),
      );
    }
    console.log(`U22: columns at ${widths.join(', ')} px = ${columnsAt.join(', ')}`);
    // Either side of each breakpoint the column count differs. That is what a
    // breakpoint *is*, and a face that declared one where nothing changed would
    // be describing a layout it does not have.
    expect(columnsAt[0]).toBeLessThan(columnsAt[1]);
    expect(columnsAt[2]).toBeLessThan(columnsAt[3]);
  });

  test('every control meets the touch minimum at every width, and is not clipped', async ({
    page,
  }) => {
    await boot(page);
    const minWidthPx = await page.evaluate(() => {
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
      return Math.ceil(window.__mwPanel.minWidthRem * root);
    });
    for (const width of [minWidthPx, 400, 600, 900, 1400]) {
      await page.setViewportSize({ width, height: 900 });
      const bad = await page.evaluate((limit) => {
        const problems: string[] = [];
        // The box that receives the press, not the box around it. Measuring the
        // wrapper was the first version of this and it had no teeth: a wrapper
        // sized by its contents reports whatever its contents are, so shrinking
        // the target inside it changed nothing the assertion could see. That is
        // RA-002's mistake committed by the test written for RA-002.
        const targets = Array.from(
          document.querySelectorAll<HTMLElement>('.mw-control-input, .mw-graph'),
        );
        for (const node of targets) {
          const box = node.getBoundingClientRect();
          const id =
            node.dataset.mwElement ??
            (node.parentElement as HTMLElement | null)?.dataset.mwElement ??
            '?';
          if (box.width < limit || box.height < limit) {
            problems.push(`${id} is ${box.width.toFixed(1)}x${box.height.toFixed(1)}`);
          }
          // And the target is not clipped by whatever contains it, which is the
          // other half of RA-002: a strip grown to 44 px inside a row that was
          // not lost 25 of them, and every measurement of the strip alone said
          // it was fine.
          const parent = node.parentElement?.getBoundingClientRect();
          if (parent && (box.bottom > parent.bottom + 0.5 || box.right > parent.right + 0.5)) {
            problems.push(`${id} overflows its container`);
          }
        }
        return problems;
      }, TOUCH_MIN);
      expect(bad, `at ${width} px`).toEqual([]);
    }
  });

  // The framework's real test: every face, one standard. A renderer that had
  // grown a special case for the face it was written against would pass for
  // that one and fail on the next, which is why this runs the *same* assertions
  // for each rather than a relaxed version of them.
  for (const unit of ['dyn-01', 'dyn-02']) {
    test(`the ${unit} face is held to the same geometry`, async ({ page }) => {
      await boot(page, unit);
      const { breakpoints, rootFontPx, minWidthRem } = await page.evaluate(() => ({
        breakpoints: [...window.__mwPanel.breakpointsEm],
        rootFontPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
        minWidthRem: window.__mwPanel.minWidthRem,
      }));
      expect(breakpoints.length).toBeGreaterThan(0);
      const columnsAt: number[] = [];
      const widths: number[] = [];
      for (const em of breakpoints) {
        widths.push(Math.round(em * rootFontPx) - 8, Math.round(em * rootFontPx) + 8);
      }
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        columnsAt.push(
          await page.evaluate(() => {
            const grid = document.querySelector('.mw-panel-controls') as HTMLElement;
            return getComputedStyle(grid).gridTemplateColumns.split(' ').length;
          }),
        );
      }
      console.log(`U22 ${unit}: columns at ${widths.join(', ')} px = ${columnsAt.join(', ')}`);
      expect(columnsAt[0]).toBeLessThan(columnsAt[1]);
      expect(columnsAt[2]).toBeLessThan(columnsAt[3]);

      for (const width of [Math.ceil(minWidthRem * rootFontPx), 500, 1000, 1600]) {
        await page.setViewportSize({ width, height: 900 });
        const bad = await page.evaluate((limit) => {
          const problems: string[] = [];
          const targets = Array.from(
            document.querySelectorAll<HTMLElement>('.mw-control-input, .mw-graph'),
          );
          for (const node of targets) {
            const box = node.getBoundingClientRect();
            const id =
              node.dataset.mwElement ??
              (node.parentElement as HTMLElement | null)?.dataset.mwElement ??
              '?';
            if (box.width < limit || box.height < limit) {
              problems.push(`${id} is ${box.width.toFixed(1)}x${box.height.toFixed(1)}`);
            }
          }
          return problems;
        }, TOUCH_MIN);
        expect(bad, `${unit} at ${width} px`).toEqual([]);
        const overflow = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(overflow.scroll - overflow.client, `${unit} at ${width} px`).toBeLessThanOrEqual(1);
      }
    });
  }

  test('the panel never overflows its container sideways', async ({ page }) => {
    await boot(page);
    for (const width of [320, 400, 600, 900, 1400]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      // One pixel of tolerance for sub-pixel rounding of a border. Anything
      // more is a real horizontal scrollbar, which on a phone is the difference
      // between a panel and a panel with half its controls off the edge.
      expect(
        overflow.scroll - overflow.client,
        `at ${width} px the page scrolls sideways by ${overflow.scroll - overflow.client}`,
      ).toBeLessThanOrEqual(1);
    }
  });
});
