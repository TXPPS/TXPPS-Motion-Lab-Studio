/**
 * Browser-level phone regression: actual Chromium touch events against the
 * visible dial. Unlike clicking a hidden range, this routes through the same
 * pointer-capture and touch-action code a phone runs.
 */
import { expect, test } from '@playwright/test';

test.describe('native touch gestures across vintage and granular faces', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  for (const unit of ['fx-02', 'fx-03', 'dyn-01', 'dyn-02', 'dyn-03', 'dyn-04', 'dyn-05']) {
    test(`${unit}: up raises knob value, down lowers it, with no visual-size collapse`, async ({
      page,
    }) => {
      await page.goto(`/?unit=${unit}`);
      const knob = page.locator('.mw-ctl-knob').first();
      await expect(knob).toBeVisible();
      await knob.scrollIntoViewIfNeeded();
      const input = knob.locator('input[type="range"]');
      await input.evaluate((element: HTMLInputElement) => {
        // Test fixture: begin away from both end stops so each direction can
        // be measured. Actual claims below use CDP touch hit testing.
        element.value = '0.5';
        element.dispatchEvent(new Event('input', { bubbles: true }));
      });

      const art = knob.locator('.mw-ctl-art');
      const bounds = await art.boundingBox();
      expect(bounds, 'knob SVG must have a visible box').not.toBeNull();
      expect(bounds!.width, 'phone has a cyclic/invalid knob size variable').toBeGreaterThanOrEqual(
        59.5,
      );
      const x = bounds!.x + bounds!.width / 2;
      const y = bounds!.y + bounds!.height / 2;
      const client = await page.context().newCDPSession(page);

      const drag = async (deltaY: number) => {
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x, y }],
        });
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x, y: y + deltaY }],
        });
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };

      await drag(-75);
      const raised = Number(await input.inputValue());
      expect(raised, 'dragging upward must increase the normalised value').toBeGreaterThan(0.5);

      await drag(75);
      const lowered = Number(await input.inputValue());
      expect(lowered, 'dragging downward must decrease the normalised value').toBeLessThan(raised);
      expect(Number.isFinite(lowered)).toBe(true);

      const overflow = await page
        .locator('.mw-panel')
        .evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow, 'touch knob sizing must not overflow the panel').toBeLessThanOrEqual(1);
      await client.detach();
    });
  }
});
