import { test, expect, type Page } from '@playwright/test';

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900, layout: 'desktop' },
  { name: 'desktop-1280', width: 1280, height: 800, layout: 'desktop' },
  { name: 'tablet-1024', width: 1024, height: 768, layout: 'tablet' },
  { name: 'tablet-768-portrait', width: 768, height: 1024, layout: 'tablet' },
  { name: 'phone-390-portrait', width: 390, height: 844, layout: 'phone' },
  { name: 'phone-844-landscape', width: 844, height: 390, layout: 'phone' },
] as const;

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
}

test.describe('responsive layouts', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name} (${vp.width}x${vp.height}) has no horizontal overflow and correct layout`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await boot(page);

      // correct layout selected
      await expect(page.locator('[data-testid="app-root"]')).toHaveAttribute(
        'data-layout',
        vp.layout,
      );

      // no page-level horizontal overflow
      const overflow = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        bodyScrollW: document.body.scrollWidth,
      }));
      expect(overflow.scrollW, `${vp.name} document overflow`).toBeLessThanOrEqual(
        overflow.clientW + 1,
      );
      expect(overflow.bodyScrollW).toBeLessThanOrEqual(vp.width + 1);

      // transport is present and fully within the viewport
      const transport = page.locator('[data-testid="transport"]');
      await expect(transport).toBeVisible();
      const tb = await transport.boundingBox();
      expect(tb, `${vp.name} transport box`).not.toBeNull();
      if (tb) {
        expect(tb.x).toBeGreaterThanOrEqual(-1);
        expect(tb.x + tb.width).toBeLessThanOrEqual(vp.width + 1);
      }

      // core play control is reachable and reasonably sized (touch target on phone)
      const play = page.locator('[data-testid="btn-play"]');
      await expect(play).toBeVisible();
      const pb = await play.boundingBox();
      if (pb && vp.layout === 'phone') {
        expect(pb.height, `${vp.name} play button height`).toBeGreaterThanOrEqual(28);
      }
    });
  }

  test('phone shows dedicated bottom navigation and switches modes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await expect(page.locator('[data-testid="bottomnav"]')).toBeVisible();

    for (const mode of ['perform', 'edit', 'mix', 'browse', 'arrange'] as const) {
      await page.click(`[data-testid="nav-${mode}"]`);
      await expect(page.locator(`[data-testid="phone-mode-${mode}"]`)).toBeVisible();
      // no horizontal overflow after switching
      const of = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(of, `overflow in ${mode}`).toBeLessThanOrEqual(1);
    }
  });

  test('phone mixer is reachable and its faders are usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await page.click('[data-testid="nav-mix"]');
    await expect(page.locator('[data-testid="mixer"]')).toBeVisible();
    expect(await page.locator('.strip').count()).toBeGreaterThan(3);
    const fader = page.locator('.fader').first();
    const fb = await fader.boundingBox();
    expect(fb).not.toBeNull();
    if (fb) expect(fb.height).toBeGreaterThan(80);
  });

  test('tablet offers two-panel combinations', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await boot(page);
    await expect(page.locator('[data-testid="combo-arr-mixer"]')).toBeVisible();
    await page.click('[data-testid="combo-arr-piano"]');
    await expect(page.locator('[data-testid="piano-roll"]')).toBeVisible();
    await expect(page.locator('[data-testid="arrangement"]')).toBeVisible();
  });

  test('forced phone route (#/phone) renders phone UI on a wide screen', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/phone');
    await page.waitForSelector('[data-testid="app-root"]');
    await expect(page.locator('[data-testid="app-root"]')).toHaveAttribute('data-layout', 'phone');
    await expect(page.locator('[data-testid="bottomnav"]')).toBeVisible();
  });
});
