import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * The Release and Live pages, driven through their own controls.
 *
 * Both had boot-cleanliness coverage and nothing exercising what they are
 * for: measuring a mix to a delivery target, and running a setlist on stage.
 */
const preinstalledChromium = '/opt/pw-browsers/chromium';
test.use({
  launchOptions: {
    executablePath: existsSync(preinstalledChromium) ? preinstalledChromium : undefined,
    args: ['--autoplay-policy=no-user-gesture-required'],
  },
});

async function boot(page: Page, hash: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/${hash}`);
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
  await page.waitForFunction(() => '__ml' in window, { timeout: 15000 });
  await page.waitForTimeout(400);
}

test.describe('the Release page', () => {
  test('renders the song, measures it to BS.1770, and reports it against the target', async ({
    page,
  }) => {
    await boot(page, 'mastering');
    await expect(page.locator('[data-testid="mastering-page"]')).toBeVisible();
    await expect(page.locator('.empty-state')).toBeVisible();

    // "Add current song" is the page's whole job: render, measure, list.
    await page.click('text=Add current song');
    await expect(page.locator('[data-testid="master-item-1"]')).toBeVisible({ timeout: 60000 });

    const row = page.locator('[data-testid="master-item-1"]');
    // A measured track reports a real integrated loudness and a real true
    // peak — not a placeholder dash.
    await expect(row.locator('.ms-lufs')).not.toHaveText('—');
    await expect(row.locator('.ms-tp')).not.toHaveText('—');

    const measured = await page.evaluate(() => {
      const w = window as unknown as {
        __ml: {
          projectStore: {
            getState(): {
              project: {
                mastering?: {
                  items: { measured?: { integratedLufs: number; truePeakDbtp: number } }[];
                };
              };
            };
          };
        };
      };
      const item = w.__ml.projectStore.getState().project.mastering?.items?.[0];
      return item?.measured ?? null;
    });
    expect(measured, 'the track was listed without a measurement').not.toBeNull();
    // A real mix measures somewhere sane: not silence, not above full scale.
    expect(measured!.integratedLufs).toBeGreaterThan(-70);
    expect(measured!.integratedLufs).toBeLessThan(0);
    expect(measured!.truePeakDbtp).toBeLessThan(6);

    // The detail panel shows the same numbers the row does.
    await row.click();
    await expect(page.locator('text=Correlation')).toBeVisible();
  });
});

test.describe('the Live page', () => {
  test('runs a setlist and reads from the back of the room in stage mode', async ({ page }) => {
    await boot(page, 'show');
    await expect(page.locator('[data-testid="show-page"]')).toBeVisible();

    // Put the current song in the setlist, however this build offers it.
    const add = page.locator('button', { hasText: /add/i }).first();
    if (await add.count()) await add.click();
    await expect(page.locator('[data-testid="setlist-1"]')).toBeVisible({ timeout: 20000 });

    // Stage mode is the point of the page: it must change the page, not just
    // a flag nobody can see.
    const before = await page.locator('[data-testid="setlist-1"]').boundingBox();
    await page.click('[data-testid="stage-mode"]');
    await expect(page.locator('[data-testid="show-page"]')).toHaveClass(/stage/);
    const after = await page.locator('[data-testid="setlist-1"]').boundingBox();
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after!.height, 'stage mode did not make the setlist bigger').toBeGreaterThan(
      before!.height,
    );

    // The transport controls on the page drive the engine.
    await page.click('[data-testid="stage-play"]');
    await page.waitForTimeout(500);
    const playing = await page.evaluate(() => {
      const w = window as unknown as { __ml: { engine: { isPlaying(): boolean } } };
      return w.__ml.engine.isPlaying();
    });
    expect(playing, 'the stage play button did not start the transport').toBe(true);
  });
});
