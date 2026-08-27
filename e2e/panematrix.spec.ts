import { test, expect, type Page } from '@playwright/test';

/**
 * Directive 09 §3 — the pane matrix, automated the way the responsive matrix is.
 *
 * The report was panes that would not expand or collapse and tabs that would
 * not open. This enumerates every pane, drawer and sheet the app has and asks
 * each one the same four questions: does it open, does it close, does it close
 * the way a keyboard user expects, and does it remember what it was told.
 *
 * A table rather than a file of hand-written cases, because the failure this is
 * looking for is the *odd one out* — the fifth sheet that was written after the
 * other four and quietly left out a focus trap, the one layout whose divider is
 * forgotten on reload. A hand-written suite tests the panes somebody thought
 * of.
 */

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
  await page.waitForTimeout(400);
}

async function reload(page: Page) {
  await page.reload();
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
  await page.waitForTimeout(400);
}

/**
 * Move a pane divider with the keyboard.
 *
 * The dividers are `role="separator"` with a tab stop and arrow keys, so this
 * is a real affordance rather than a test convenience — and unlike a synthetic
 * drag it does not depend on a movement threshold the panel library may or may
 * not apply.
 */
async function resizeByKey(
  page: Page,
  orientation: 'vertical' | 'horizontal',
  key: string,
  presses: number,
) {
  const handle = page.locator(`.resize-handle[aria-orientation="${orientation}"]`).last();
  await expect(handle).toHaveAttribute('tabindex', '0');
  await handle.focus();
  for (let i = 0; i < presses; i += 1) await page.keyboard.press(key);
}

// ---------------------------------------------------------------- desktop

/** The three desktop workspace panes, each with a button and a key. */
const DESKTOP_PANES = [
  { name: 'browser', label: 'Toggle browser panel', body: 'browser-side', key: 'F5' },
  { name: 'editor', label: 'Toggle bottom editor', body: 'bottom-editor', key: 'F2' },
  { name: 'inspector', label: 'Toggle inspector panel', body: 'inspector-side', key: 'F4' },
] as const;

test.describe('desktop workspace panes', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  for (const pane of DESKTOP_PANES) {
    test(`${pane.name}: the button closes it and opens it again`, async ({ page }) => {
      await boot(page);
      const body = page.locator(`[data-testid="${pane.body}"]`);
      const button = page.getByLabel(pane.label);
      await expect(body).toBeVisible();
      await button.click();
      await expect(body).toHaveCount(0);
      await button.click();
      await expect(body).toBeVisible();
    });

    test(`${pane.name}: ${pane.key} does the same as the button`, async ({ page }) => {
      await boot(page);
      const body = page.locator(`[data-testid="${pane.body}"]`);
      await expect(body).toBeVisible();
      await page.keyboard.press(pane.key);
      // Every pane could only be opened by finding its button until this
      // directive; `workspaceStore` had the API and nothing called it.
      await expect(body).toHaveCount(0);
      await page.keyboard.press(pane.key);
      await expect(body).toBeVisible();
    });

    test(`${pane.name}: stays closed across a reload`, async ({ page }) => {
      await boot(page);
      await page.getByLabel(pane.label).click();
      await expect(page.locator(`[data-testid="${pane.body}"]`)).toHaveCount(0);
      await reload(page);
      await expect(page.locator(`[data-testid="${pane.body}"]`)).toHaveCount(0);
      // Put it back, so the next test in this file starts from a known layout.
      await page.getByLabel(pane.label).click();
    });
  }

  test('the browser tabs open, and the pane opens with them', async ({ page }) => {
    await boot(page);
    await page.getByLabel('Toggle browser panel').click();
    await expect(page.locator('[data-testid="browser-side"]')).toHaveCount(0);
    for (const [key, tab] of [
      ['F6', 'instruments'],
      ['F7', 'effects'],
      ['F8', 'loops'],
      ['F9', 'samples'],
      ['F10', 'pool'],
    ] as const) {
      await page.keyboard.press(key);
      // Switching the tab of a hidden pane is a command that does nothing.
      await expect(page.locator('[data-testid="browser-side"]')).toBeVisible();
      await expect(page.locator(`[data-testid="browser-tab-${tab}"]`)).toHaveAttribute(
        'aria-selected',
        'true',
      );
    }
  });

  test('the arrangement full-screens on Shift+F and comes back', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('Shift+F');
    await expect(page.locator('[data-testid="maxi-arrange"]')).toBeVisible();
    await page.keyboard.press('Shift+F');
    await expect(page.locator('[data-testid="maxi-arrange"]')).toHaveCount(0);
  });

  test('a resized pane is remembered, and the divider answers the keyboard', async ({ page }) => {
    await boot(page);
    const inspector = page.locator('[data-testid="inspector-side"]');
    const before = (await inspector.boundingBox())?.width ?? 0;
    expect(before).toBeGreaterThan(0);

    // Driven from the keyboard rather than by dragging. The divider is a
    // `role="separator"` with a tab stop and arrow keys, so this asserts that a
    // pane can be resized without a pointer at all — and it is not at the mercy
    // of a synthetic drag's threshold.
    await resizeByKey(page, 'vertical', 'ArrowLeft', 10);
    await page.waitForTimeout(700); // the store debounces its write
    const after = (await inspector.boundingBox())?.width ?? 0;
    expect(Math.abs(after - before), 'the divider did not move').toBeGreaterThan(40);

    await reload(page);
    const restored =
      (await page.locator('[data-testid="inspector-side"]').boundingBox())?.width ?? 0;
    expect(Math.abs(restored - after), 'the layout forgot the divider').toBeLessThan(24);
  });
});

// ---------------------------------------------------------------- tablet

test.describe('tablet drawers', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await boot(page);
    await expect(page.locator('[data-testid="app-root"]')).toHaveAttribute('data-layout', 'tablet');
  });

  for (const [button, side] of [
    ['tablet-browser', 'browser'],
    ['tablet-inspector', 'inspector'],
  ] as const) {
    test(`${side}: opens, and its close button closes it`, async ({ page }) => {
      await page.click(`[data-testid="${button}"]`);
      const drawer = page.locator(`[data-testid="drawer-${side}"]`);
      await expect(drawer).toBeVisible();
      await page.getByLabel('Close panel').click();
      await expect(drawer).toHaveCount(0);
    });

    test(`${side}: Escape closes it`, async ({ page }) => {
      await page.click(`[data-testid="${button}"]`);
      await expect(page.locator(`[data-testid="drawer-${side}"]`)).toBeVisible();
      await page.keyboard.press('Escape');
      // It covers the workspace and takes the pointer, so it is a modal to the
      // person using it. It had no Escape at all — on a tablet that is a pane
      // that will not go away.
      await expect(page.locator(`[data-testid="drawer-${side}"]`)).toHaveCount(0);
    });

    test(`${side}: is announced as a modal dialog`, async ({ page }) => {
      await page.click(`[data-testid="${button}"]`);
      const drawer = page.locator(`[data-testid="drawer-${side}"]`);
      await expect(drawer).toHaveAttribute('role', 'dialog');
      await expect(drawer).toHaveAttribute('aria-modal', 'true');
    });

    test(`${side}: keeps focus inside itself`, async ({ page }) => {
      await page.click(`[data-testid="${button}"]`);
      await expect(page.locator(`[data-testid="drawer-${side}"]`)).toBeVisible();
      for (let i = 0; i < 25; i += 1) await page.keyboard.press('Tab');
      const inside = await page.evaluate((s) => {
        const el = document.querySelector(`[data-testid="drawer-${s}"]`);
        return !!el && !!document.activeElement && el.contains(document.activeElement);
      }, side);
      // Tabbed out, the next keystroke edits an arrangement the user cannot
      // see.
      expect(inside, 'focus escaped the drawer').toBe(true);
    });
  }

  test('the tablet bottom panel remembers a resized divider', async ({ page }) => {
    const panel = page.locator('[data-testid="bottom-editor"]');
    const before = (await panel.boundingBox())?.height ?? 0;
    expect(before).toBeGreaterThan(0);

    await resizeByKey(page, 'horizontal', 'ArrowUp', 10);
    await page.waitForTimeout(700);
    const after = (await panel.boundingBox())?.height ?? 0;
    expect(Math.abs(after - before), 'the divider did not move').toBeGreaterThan(20);

    await reload(page);
    const restored =
      (await page.locator('[data-testid="bottom-editor"]').boundingBox())?.height ?? 0;
    // The tablet was the one layout that forgot this, while the desktop panes
    // beside it all remembered.
    expect(Math.abs(restored - after), 'the tablet forgot its divider').toBeLessThan(28);
  });
});

// ---------------------------------------------------------------- phone

const PHONE_MODES = ['arrange', 'record', 'perform', 'edit', 'mix', 'browse'] as const;

test.describe('phone workspace modes', () => {
  test('every mode opens and reports itself as the selected one', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    for (const mode of PHONE_MODES) {
      await page.click(`[data-testid="nav-${mode}"]`);
      await page.waitForTimeout(150);
      await expect(page.locator(`[data-testid="nav-${mode}"]`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.locator(`[data-testid="phone-mode-${mode}"]`)).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------- sheets

/**
 * Every full-screen sheet. All five are modal to the person using them, so all
 * five owe the same three things: a dialog role, focus that stays inside, and
 * Escape.
 */
const SHEETS = [
  {
    name: 'settings',
    body: 'settings-sheet',
    open: (p: Page) => p.click('[data-testid="open-settings"]'),
  },
  {
    name: 'diagnostics',
    body: 'diagnostics-sheet',
    open: (p: Page) => p.click('[data-testid="open-diagnostics"]'),
  },
  { name: 'shortcuts', body: 'shortcuts-sheet', open: (p: Page) => p.keyboard.press('?') },
] as const;

test.describe('sheets', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page);
  });

  for (const sheet of SHEETS) {
    test(`${sheet.name}: opens and Escape closes it`, async ({ page }) => {
      await sheet.open(page);
      const body = page.locator(`[data-testid="${sheet.body}"]`);
      await expect(body).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(body).toHaveCount(0);
    });

    test(`${sheet.name}: is announced as a modal dialog`, async ({ page }) => {
      await sheet.open(page);
      const body = page.locator(`[data-testid="${sheet.body}"]`);
      await expect(body).toHaveAttribute('role', 'dialog');
      // The diagnostics sheet was `role="complementary"` with a scrim in front
      // of the whole app — the odd one out among five siblings, and the odd one
      // out is always the one that was written last.
      await expect(body).toHaveAttribute('aria-modal', 'true');
    });

    test(`${sheet.name}: keeps focus inside itself`, async ({ page }) => {
      await sheet.open(page);
      await expect(page.locator(`[data-testid="${sheet.body}"]`)).toBeVisible();
      for (let i = 0; i < 30; i += 1) await page.keyboard.press('Tab');
      const inside = await page.evaluate((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return !!el && !!document.activeElement && el.contains(document.activeElement);
      }, sheet.body);
      expect(inside, `focus escaped the ${sheet.name} sheet`).toBe(true);
    });
  }
});

// ---------------------------------------------------------------- console

test.describe('the console and the channel', () => {
  /*
   * This used to assert that the overview strip could be hidden and brought
   * back. The strip is gone from the console — directive item 12: it was a
   * permanent tenant of the mixer's track area, taking 116px out of the pane
   * and taking it off the strips — and it is an editor of its own now.
   *
   * So the toggle became a route, and the case follows it. A control that once
   * hid a surface and now navigates to it is not the same claim, and rewriting
   * the old assertion to pass would have been the thing this repository calls
   * re-fitting: the check would have stopped being a check on anything.
   */
  test('the console offers a way to the selected channel, laid out end to end', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page);
    await page.locator('[data-testid^="track-header-"]').first().locator('.th-name').click();
    await page.keyboard.press('F3');

    const link = page.locator('[data-testid="open-channel-view"]');
    await expect(link, 'the console has no route to the channel view').toBeVisible();
    await link.click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid="channel-view"]')).toBeVisible();
    // And the band is not back in the console: the whole point is that the
    // chain stops competing with the strips for the pane's height.
    await expect(page.locator('[data-testid="mixer"] [data-testid="channel-view"]')).toHaveCount(0);
  });
});
