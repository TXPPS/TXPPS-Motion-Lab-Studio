/**
 * Ledger cell V27 — live visual feedback, measured on the Program EQ.
 *
 * Its own file because it is its own claim. `panel.spec.ts` holds U21 (two
 * clocks) and U22 (geometry); this holds V27, and the three together had put
 * that file past the four-hundred-line rule.
 */
import { expect, test, type Page } from '@playwright/test';
import { boot } from './harness';

test.describe('V27 — the Program EQ panel moves with the music, and stops with it', () => {
  /**
   * V27 is not U20, and the difference is the whole of this block.
   *
   * `U20` asks whether a readout carries real engine state; the Program EQ has
   * satisfied that since it was written. `V27` asks whether there is something
   * *moving* that a user can watch the mechanism in — and it failed, for a
   * reason worth keeping: its most mechanism-revealing readout is the harmonic
   * display, and that reads `TriodeStage::curvature`, which is a function of
   * the bias. Real state, honestly published, and it does not change until a
   * knob does.
   *
   * What moves with the music is the iron. `program_eq_visual_tests.cpp` holds
   * the engine end of this — that the published figure is the core's own flux
   * and not the input peak it used to be assigned. This holds the other end:
   * that the panel draws it, at display rate, and stops when the engine does.
   */
  const CORE_METER = '[data-mw-element="input-core"]';

  const sampleValues = (page: Page, frames: number) =>
    page.evaluate(
      async ([selector, count]) => {
        const node = document.querySelector(selector as string) as HTMLElement;
        const seen: string[] = [];
        for (let i = 0; i < (count as number); i++) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          seen.push(String(node.dataset.mwValue));
        }
        return seen;
      },
      [CORE_METER, frames] as const,
    );

  test('the transformer readout is driven, and is the core rather than the level', async ({
    page,
  }) => {
    await boot(page, 'dyn-01');
    // A few frames first: `start` resolves once the worklet is ready, and
    // `lastFrame` is whatever the paint loop last read — which is `{}` until it
    // has run once. Reading it immediately measures the harness starting up.
    await sampleValues(page, 5);
    const frame = await page.evaluate(() => window.__mwPanel.lastFrame());
    console.log(`V27: dyn-01 frame ${JSON.stringify(frame)}`);
    // A 40 Hz probe: the panel harness plays a low tone at this unit
    // deliberately, because a transformer follows flux and a kilohertz probe
    // would leave the iron — and therefore this panel — still.
    expect(frame['input-peak']).toBeGreaterThan(0.1);
    expect(frame['input-core-drive']).toBeGreaterThan(0.01);
  });

  test('something on the panel is in motion', async ({ page }) => {
    await boot(page, 'dyn-01');
    const samples = await sampleValues(page, 40);
    const distinct = new Set(samples).size;
    console.log(`V27: the core meter took ${distinct} distinct values over 40 frames`);
    // The DOM, not the harness's own bookkeeping: a paint counter that ticked
    // while nothing changed on screen would pass a weaker version of this.
    // A 40 Hz cycle is 25 ms against a 2.7 ms block, so each block's peak flux
    // lands somewhere different on the cycle and the meter breathes at the
    // signal's own rate. A still panel reads 1 here.
    expect(distinct).toBeGreaterThan(10);
  });

  test('a stalled engine stops the panel rather than smoothing it', async ({ page }) => {
    // The discriminator, and the only case that can tell a face reading engine
    // state from a face animating on a timer — while the engine runs the two
    // are indistinguishable. `U21` was mutation-tested by fabricating its value
    // from `performance.now()`, which passed every other check and failed this.
    await boot(page, 'dyn-01');
    const running = new Set(await sampleValues(page, 20)).size;
    await page.evaluate(() => window.__mwPanel.stopEngine());
    // A few frames for anything already in flight to land, then measure.
    await sampleValues(page, 5);
    const paintsBefore = await page.evaluate(() => window.__mwPanel.paints());
    const stopped = new Set(await sampleValues(page, 20)).size;
    const stillPainting = (await page.evaluate(() => window.__mwPanel.paints())) - paintsBefore;
    console.log(
      `V27: ${running} value(s) while running, ${stopped} while suspended, ` +
        `${stillPainting} paint(s) during the suspended window`,
    );
    expect(running).toBeGreaterThan(10);
    // One value: the last thing the engine published. Not zero — the face keeps
    // drawing, it just has nothing new to draw, which is the honest behaviour.
    // A face inventing motion reads in the teens here.
    expect(stopped).toBe(1);
  });
});
