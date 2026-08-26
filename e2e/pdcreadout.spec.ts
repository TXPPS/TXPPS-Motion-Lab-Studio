/**
 * The session says how late it is running.
 *
 * `fsp8-parity-fundamentals.md` marks "total PDC displayed in the transport
 * under the sample rate" `MISSING` and calls it "the single cheapest parity win
 * in this chapter", for a reason the chapter states plainly: the reference puts
 * the number where the sample rate is because a session running seven
 * milliseconds behind itself is a fact the engineer has to be told, and the
 * engine is the only thing that knows it.
 *
 * MotionLab's engine had known it since Directive 03 and had never said so —
 * `AudioEngine.pdcSamples()` existed, was documented as a test probe, and had
 * no caller anywhere in the repository. That is the shape `check-checks.mjs`
 * was written to find, arriving in a different place.
 *
 * Measured through the live engine rather than by poking the store: the claim
 * is that adding an insert that delays a channel *changes what the transport
 * says*, and a store write asserted directly would pass with the engine
 * disconnected from the chip.
 */
import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

const preinstalledChromium = '/opt/pw-browsers/chromium';
test.use({
  launchOptions: {
    executablePath: existsSync(preinstalledChromium) ? preinstalledChromium : undefined,
    args: ['--autoplay-policy=no-user-gesture-required'],
  },
});

async function boot(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
  await page.waitForFunction(() => '__ml' in window, { timeout: 15000 });
}

/** Whatever the chip is currently reporting, in samples. */
const reported = (page: Page) =>
  page.locator('[data-testid="audio-chip"]').getAttribute('data-pdc-samples');

test.describe('the transport reports delay compensation', () => {
  test('a limiter on one track puts a figure in the chip, and removing it takes it away', async ({
    page,
  }) => {
    await boot(page);
    // The engine has to be running: compensation is applied to real delay
    // nodes, and a suspended context has no channels to apply it to.
    await page.click('[data-testid="audio-chip"]');
    await page.waitForFunction(
      () =>
        (document.querySelector('[data-testid="audio-chip"]') as HTMLElement | null)?.dataset
          .audioState === 'running',
      { timeout: 15000 },
    );

    expect(await reported(page), 'a session with no inserts is not late').toBe('0');

    const added = await page.evaluate(() => {
      const w = window as unknown as {
        __ml: {
          projectStore: {
            getState: () => {
              project: { tracks: { id: string; type: string }[] };
              addEffect: (trackId: string, kind: string) => string | null;
            };
          };
        };
      };
      const st = w.__ml.projectStore.getState();
      const track = st.project.tracks.find((t) => t.type === 'instrument' || t.type === 'audio');
      if (!track) return null;
      // A limiter, because its declaration is arithmetic we own — the
      // lookahead knob plus the oversampled brickwall — rather than a browser
      // constant, so the figure below is one this repository can predict.
      const id = st.addEffect(track.id, 'limiter');
      return { trackId: track.id, effectId: id };
    });
    expect(added, 'the fixture has no track to put an insert on').not.toBeNull();

    // The chain is rebuilt on the store's own subscription, so wait for the
    // engine rather than for a timeout.
    await page.waitForFunction(
      () =>
        Number(
          (document.querySelector('[data-testid="audio-chip"]') as HTMLElement | null)?.dataset
            .pdcSamples ?? 0,
        ) > 0,
      { timeout: 10000 },
    );
    const withLimiter = Number(await reported(page));
    console.log(`§4 · the transport reports ${withLimiter} sample(s) of compensation`);
    // 192 for the oversampled brickwall plus the default lookahead. Asserted as
    // a range rather than a constant because the lookahead default is a
    // parameter and this case is about the readout, not about the number —
    // `e2e/latency.spec.ts` owns the number.
    expect(withLimiter).toBeGreaterThan(100);
    expect(withLimiter).toBeLessThan(2000);

    // And the chip says it in milliseconds, where a musician can judge it.
    const label = await page.locator('[data-testid="audio-chip"]').getAttribute('title');
    expect(label, `the chip does not mention the delay: ${label}`).toContain('ms');

    await page.evaluate((info) => {
      const w = window as unknown as {
        __ml: {
          projectStore: {
            getState: () => { removeEffect: (trackId: string, effectId: string) => void };
          };
        };
      };
      w.__ml.projectStore.getState().removeEffect(info!.trackId, info!.effectId!);
    }, added);
    // Back to zero: a readout that only ever climbs would report a session as
    // late for the rest of its life after one insert was tried and removed.
    await page.waitForFunction(
      () =>
        (document.querySelector('[data-testid="audio-chip"]') as HTMLElement | null)?.dataset
          .pdcSamples === '0',
      { timeout: 10000 },
    );
    const label2 = await page.locator('[data-testid="audio-chip"]').getAttribute('title');
    expect(label2, 'the chip still claims a delay that is gone').not.toContain('ms');
  });
});
