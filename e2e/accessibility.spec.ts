import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { Result } from 'axe-core';

/**
 * Automated accessibility pass.
 *
 * `axe-core` has been a devDependency for a while with nothing running it, so
 * every regression in a name, a role or a label was found by hand or not at
 * all. This runs it over the real app — the demo project, not a fixture — at
 * every viewport the layout suite already covers, and once per theme, because
 * the themes swap markup as well as colour (the contrast theme adds affordances
 * the dark theme draws with shading).
 *
 * It also scans with the overlays open. Menus, dialogs and toasts are the parts
 * a static scan of the boot screen never sees, and they are exactly what the
 * accessibility audit this suite came from was about.
 */

/**
 * The same list `e2e/layout.spec.ts` sweeps, so the two suites agree on what
 * "every viewport" means.
 */
const VIEWPORTS = [
  { name: 'desktop-1440x900', w: 1440, h: 900 },
  { name: 'desktop-1280x800', w: 1280, h: 800 },
  { name: 'tablet-1024x768', w: 1024, h: 768 },
  { name: 'tablet-768x1024', w: 768, h: 1024 },
  { name: 'phone-390x844', w: 390, h: 844 },
  { name: 'phone-844x390', w: 844, h: 390 },
] as const;

const THEMES = ['dark', 'light', 'contrast'] as const;

/** Where `prefsStore` reads the theme from before the first paint. */
const PREFS_KEY = 'motionlab.prefs.v1';

/**
 * Contrast is deliberately not asserted here.
 *
 * The colour tokens in `src/styles/` are being reworked right now and belong to
 * the engineer doing that pass, not to this suite. Turning the contrast rules
 * on before that lands would make this spec fail for reasons nobody working on
 * names and roles can fix, and a suite that is red for someone else's work
 * stops being read. Re-enable both rules when the token pass is merged.
 */
const CONTRAST_RULES = ['color-contrast', 'color-contrast-enhanced'];

/**
 * The rule families the audit behind this suite covered: names, labels, and
 * the ARIA that carries them. Everything else axe reports — landmarks, page
 * structure, focusable scroll containers — is real but is not this suite's
 * subject yet, so it is printed and not asserted.
 *
 * `role-*` matches nothing in axe-core 4.13 (its role rules are all named
 * `aria-*`); it is here so a future rule in that family is picked up without
 * anyone having to remember this list exists.
 */
function isCovered(v: Result): boolean {
  return (
    v.id.startsWith('aria-') ||
    v.id.startsWith('role-') ||
    v.id === 'label' ||
    v.id === 'button-name' ||
    v.id === 'link-name'
  );
}

/** A violation the way a person has to read it: rule, why, and where. */
function report(violations: Result[]): string {
  return violations
    .map((v) => {
      const where = v.nodes
        .slice(0, 4)
        .map((n) => `      ${n.target.join(' ')}`)
        .join('\n');
      const more = v.nodes.length > 4 ? `\n      …and ${v.nodes.length - 4} more` : '';
      return `  ${v.id} [${v.impact ?? 'unknown'}] ${v.help}\n${where}${more}`;
    })
    .join('\n');
}

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForSelector('[data-testid="transport"]', { timeout: 20000 });
  // The arrangement virtualises on resize; let it settle before measuring.
  await page.waitForTimeout(400);
}

/** Seed the theme before load so the app applies `data-theme` itself. */
async function bootWithTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, JSON.stringify({ theme: value })),
    [PREFS_KEY, theme] as const,
  );
  await boot(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function violations(page: Page): Promise<Result[]> {
  const results = await new AxeBuilder({ page }).disableRules(CONTRAST_RULES).analyze();
  const covered = results.violations.filter(isCovered);
  const rest = results.violations.filter((v) => !isCovered(v));
  if (rest.length > 0) {
    // Not a failure — see isCovered. Printed so the backlog stays visible.
    console.log(`out-of-scope axe findings:\n${report(rest)}`);
  }
  return covered;
}

async function expectClean(page: Page, what: string) {
  const found = await violations(page);
  expect(found, `${what}\n${report(found)}`).toEqual([]);
}

test.describe('accessibility: names, labels and ARIA', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: the workstation has no name or ARIA violations`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await boot(page);
      await expectClean(page, `${vp.name} violations`);
    });
  }

  for (const theme of THEMES) {
    test(`${theme} theme: the workstation has no name or ARIA violations`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await bootWithTheme(page, theme);
      await expectClean(page, `${theme} theme violations`);
    });
  }
});

test.describe('accessibility: overlays', () => {
  test('the context menu is a menu, with menu items', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page);

    const clip = page.locator('[data-testid^="clip-"]').first();
    await clip.click({ button: 'right' });
    const menu = page.locator('.ctx-menu');
    await expect(menu).toBeVisible();
    // The audit's fix, asserted where a scan cannot see it: opening a menu puts
    // the keyboard on its first item.
    await expect(menu.getByRole('menuitem').first()).toBeFocused();

    await expectClean(page, 'context menu violations');
  });

  test('the shortcuts sheet is a labelled modal dialog', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page);

    await page.keyboard.press('Shift+?');
    const sheet = page.locator('[data-testid="shortcuts-sheet"]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('aria-modal', 'true');

    await expectClean(page, 'shortcuts sheet violations');
  });

  test('a dialog and a toast carry their own names', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page);

    // Any split with nothing under the playhead raises a notice, which is the
    // only feedback channel the app has and so the one that must be announced.
    await page.keyboard.press('Control+e');
    await expect(page.locator('.toast')).toHaveCount(1);
    await expect(
      page.locator('[role="status"]').or(page.locator('[role="alert"]')),
    ).not.toHaveCount(0);

    await expectClean(page, 'toast violations');
  });
});
