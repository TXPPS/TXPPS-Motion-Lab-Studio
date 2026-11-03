/**
 * Two viewport snapshots of the actual shared Motion Wave panel renderer.
 * These are review evidence, NOT a visual approval oracle. They intentionally
 * keep all seven original user-visible faces so GUI redesign does not become
 * "the new knobs are pretty" while everything else is unreadable.
 */
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const names = ['fx-02', 'fx-03', 'dyn-01', 'dyn-02', 'dyn-03', 'dyn-04', 'dyn-05'];
const output = 'audit-out/motionwave-ui-screens';

for (const device of [
  { label: 'phone-390', viewport: { width: 390, height: 844 }, touch: true },
  { label: 'desktop-1440', viewport: { width: 1440, height: 900 }, touch: false },
]) {
  test.describe(device.label, () => {
    test.use({
      viewport: device.viewport,
      hasTouch: device.touch,
      isMobile: device.touch,
    });

    test('records original plugin-face pixels with no horizontal overflow', async ({ page }) => {
      mkdirSync(output, { recursive: true });
      for (const unit of names) {
        await page.goto(`/?unit=${unit}`);
        const panel = page.locator('.mw-panel');
        await expect(panel).toBeVisible();
        const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth);
        expect(overflow, `${unit} on ${device.label} must not overflow`).toBeLessThanOrEqual(1);
        await panel.screenshot({
          path: `${output}/${device.label}-${unit}.png`,
          animations: 'disabled',
        });
      }
    });
  });
}
