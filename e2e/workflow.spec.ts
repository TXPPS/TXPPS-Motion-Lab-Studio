import { test, expect, type Page } from '@playwright/test';

/**
 * Arrangement editing workflow: marquee, multi-select, group move, clipboard,
 * shortcuts. These drive the real pointer and keyboard paths — the same events
 * a musician produces — rather than calling store actions directly.
 */

async function boot(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
  await page.waitForTimeout(900);
}

const selectionCount = (page: Page) =>
  page.evaluate(() => document.querySelectorAll('.clip.selected').length);

async function clipBox(page: Page, name: string) {
  const b = await page.locator(`[data-testid="clip-${name}"]`).boundingBox();
  expect(b, `clip ${name} not found`).not.toBeNull();
  return b!;
}

test.describe('marquee and multi-selection', () => {
  test('marquee selects everything it touches and empty click clears', async ({ page }) => {
    await boot(page);
    const lanes = await page.locator('[data-testid="arr-lanes"]').boundingBox();
    expect(lanes).not.toBeNull();

    // Start on empty, *visible* lane space — the Lead lane (5th) is empty
    // before beat 16. A clip under the pointer would begin a clip drag, and a
    // point past the visible viewport would land on another panel entirely.
    const emptyX = lanes!.x + 40;
    const emptyY = lanes!.y + 4 * 64 + 40;
    await page.mouse.move(emptyX, emptyY);
    await page.mouse.down();
    await page.mouse.move(lanes!.x + 620, lanes!.y + 10, { steps: 12 });
    await expect(page.locator('[data-testid="marquee"]')).toBeVisible();
    await page.mouse.up();

    const picked = await selectionCount(page);
    expect(picked, 'marquee should select several clips').toBeGreaterThan(2);

    // A plain click on empty lane space clears the selection.
    await page.mouse.click(emptyX, emptyY);
    expect(await selectionCount(page)).toBe(0);
  });

  test('shift-click builds a selection and group drag preserves spacing', async ({ page }) => {
    await boot(page);
    const a = await clipBox(page, 'Drums A');
    const b = await clipBox(page, 'Bass A');

    await page.mouse.click(a.x + 40, a.y + a.height / 2);
    await page.keyboard.down('Shift');
    await page.mouse.click(b.x + 40, b.y + b.height / 2);
    await page.keyboard.up('Shift');
    expect(await selectionCount(page)).toBe(2);

    const before = await page.evaluate(() => {
      const w = window as unknown as {
        __ml: { projectStore: { getState(): { project: { clips: { name: string; start: number }[] } } } };
      };
      const clips = w.__ml.projectStore.getState().project.clips;
      return {
        drums: clips.find((c) => c.name === 'Drums A')!.start,
        bass: clips.find((c) => c.name === 'Bass A')!.start,
      };
    });

    // Drag one member of the selection to the right.
    await page.mouse.move(a.x + 60, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 60 + 26 * 4, a.y + a.height / 2, { steps: 10 });
    await page.mouse.up();

    const after = await page.evaluate(() => {
      const w = window as unknown as {
        __ml: { projectStore: { getState(): { project: { clips: { name: string; start: number }[] } } } };
      };
      const clips = w.__ml.projectStore.getState().project.clips;
      return {
        drums: clips.find((c) => c.name === 'Drums A')!.start,
        bass: clips.find((c) => c.name === 'Bass A')!.start,
      };
    });

    expect(after.drums, 'grabbed clip did not move').toBeGreaterThan(before.drums);
    // Both moved by the same delta: spacing preserved.
    expect(after.bass - before.bass).toBeCloseTo(after.drums - before.drums, 5);
  });
});

test.describe('clipboard workflow', () => {
  test('copy, paste at playhead, and delete via keyboard', async ({ page }) => {
    await boot(page);
    const clipsBefore = await page.evaluate(
      () => document.querySelectorAll('[data-testid^="clip-"]').length,
    );

    const a = await clipBox(page, 'Drums A');
    await page.mouse.click(a.x + 40, a.y + a.height / 2);
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(250);
    expect(
      await page.evaluate(() => document.querySelectorAll('[data-testid^="clip-"]').length),
    ).toBe(clipsBefore + 1);

    // The paste is selected; Delete removes it again.
    await page.keyboard.press('Delete');
    await page.waitForTimeout(250);
    expect(
      await page.evaluate(() => document.querySelectorAll('[data-testid^="clip-"]').length),
    ).toBe(clipsBefore);
  });

  test('select all, duplicate, and undo restores the count', async ({ page }) => {
    await boot(page);
    const before = await page.evaluate(
      () => document.querySelectorAll('[data-testid^="clip-"]').length,
    );

    await page.keyboard.press('Control+a');
    expect(await selectionCount(page)).toBe(before);

    await page.keyboard.press('Control+d');
    await page.waitForTimeout(300);
    const doubled = await page.evaluate(
      () => document.querySelectorAll('[data-testid^="clip-"]').length,
    );
    expect(doubled).toBe(before * 2);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect(
      await page.evaluate(() => document.querySelectorAll('[data-testid^="clip-"]').length),
    ).toBe(before);
  });
});

test.describe('escape and shortcuts sheet', () => {
  test('Escape clears the selection before anything drastic', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('Control+a');
    expect(await selectionCount(page)).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    expect(await selectionCount(page)).toBe(0);
  });

  test('the shortcut sheet opens with ? and lists the registry', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('Shift+?');
    await expect(page.locator('[data-testid="shortcuts-sheet"]')).toBeVisible();
    // Spot-check entries from three categories.
    for (const text of ['Play / stop', 'Duplicate selection', 'Select all clips']) {
      await expect(page.locator('[data-testid="shortcuts-sheet"]')).toContainText(text);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="shortcuts-sheet"]')).not.toBeVisible();
  });

  test('context menu shows keyboard hints', async ({ page }) => {
    await boot(page);
    const a = await clipBox(page, 'Drums A');
    await page.mouse.click(a.x + 40, a.y + a.height / 2, { button: 'right' });
    const menu = page.locator('.ctx-menu');
    await expect(menu).toBeVisible();
    expect(await menu.locator('.mi-key').count()).toBeGreaterThan(2);
  });
});
