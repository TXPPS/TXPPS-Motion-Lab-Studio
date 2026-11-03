/**
 * A real screenshot exposed all eight granular-delay tap pages stacking into
 * a 6,449px phone panel. The renderer set hidden=true correctly, but the
 * author's display:grid rule won over the UA [hidden] rule.
 */
import { expect, test } from '@playwright/test';

for (const layout of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  test(`granular delay hides inactive tap editors on ${layout.name}`, async ({ page }) => {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.goto('/?unit=fx-03');

    const panel = page.locator('.mw-panel');
    // The shared formatter must not turn a real 30-percent Mix into 3000%.
    await expect(panel.locator('[data-mw-element="mix"] .mw-ctl-value')).toHaveText('30 %');
    await expect(panel.locator('[data-mw-element="feedback"] .mw-ctl-value')).toHaveText('35 %');
    const grids = panel.locator('.mw-panel-controls[role="tabpanel"]');
    await expect(grids).toHaveCount(12);
    await expect(panel.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);

    const initial = await grids.evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: (node as HTMLElement).dataset.mwGroup,
        hidden: (node as HTMLElement).hidden,
        display: getComputedStyle(node).display,
        clientHeight: (node as HTMLElement).clientHeight,
      })),
    );
    expect(initial.filter((x) => x.display !== 'none').map((x) => x.id)).toEqual(['loop']);
    for (const entry of initial.slice(1)) {
      expect(entry.hidden).toBe(true);
      expect(entry.display).toBe('none');
      expect(entry.clientHeight).toBe(0);
    }

    const bbox = await panel.boundingBox();
    expect(bbox).not.toBeNull();
    expect(bbox!.height, 'hidden grids must not produce a 6,449px tall panel').toBeLessThan(2200);

    const layoutMode = await panel
      .locator('.mw-panel-body')
      .evaluate((node) => getComputedStyle(node).flexDirection);
    expect(layoutMode, 'grouped face sections must retain full width').toBe('column');
    await panel.locator('[role="tab"][data-mw-group="tap-8"]').click();
    await expect(panel.locator('[role="tab"][data-mw-group="tap-8"]')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(panel.locator('[role="tabpanel"][data-mw-group="tap-8"]')).toBeVisible();
    await expect(panel.locator('[role="tabpanel"][data-mw-group="loop"]')).toBeHidden();
    await expect(panel.locator('[role="tabpanel"][data-mw-group="tap-1"]')).toBeHidden();
    const after = await grids.evaluateAll(
      (nodes) => nodes.filter((node) => getComputedStyle(node).display !== 'none').length,
    );
    expect(after).toBe(1);
  });
}
