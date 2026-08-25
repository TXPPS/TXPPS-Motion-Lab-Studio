/**
 * Every editor is reachable on every form factor.
 *
 * Directive 11 §5: layout may differ, capability may not. Eight editors are
 * declared in `app/editors.ts` and the desktop reached all eight through the
 * bottom editor's tab strip, while a phone and a tablet each mounted the piano
 * roll and nothing else. The drum editor, the score, the audio editor, the
 * chord assistant and diagnostics were on a desktop and on nothing smaller.
 *
 * The full reachability sweep (`npm run reachability`) covers this and much
 * more, and takes four minutes against a preview build — which makes it a
 * section-boundary job rather than something every commit can afford. This is
 * the fast guard for the specific regression: it reads the editor list from the
 * app itself and asserts each one has a tab on each layout, so a ninth editor
 * cannot be added desktop-only without failing here.
 */
import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

const preinstalledChromium = '/opt/pw-browsers/chromium';
test.use({
  ...(existsSync(preinstalledChromium)
    ? { launchOptions: { executablePath: preinstalledChromium } }
    : {}),
});

/**
 * The editors a layout offers, and the ones it reaches another way.
 *
 * A phone carries Mix and Perform in its bottom navigation and a tablet carries
 * Mixer and Instrument in its combo bar, so both exclude those two from the
 * editor strip — offering them twice would be two routes to one place and would
 * push the note editors off the end of a 390 px row. Excluded is not missing,
 * and the second assertion below is what keeps that honest.
 */
const FORMS = [
  { id: 'phone', width: 390, height: 844, enter: 'nav-edit', elsewhere: ['mixer', 'synth'] },
  { id: 'tablet', width: 768, height: 1024, enter: 'combo-piano', elsewhere: ['mixer', 'synth'] },
  { id: 'desktop', width: 1440, height: 900, enter: null, elsewhere: [] },
];

async function boot(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 25000 });
  await page.waitForFunction(
    () => Boolean((window as unknown as { __ml?: { projectStore?: unknown } }).__ml?.projectStore),
    null,
    { timeout: 25000 },
  );
}

/** The editor ids the app declares, read from the app rather than restated. */
async function declaredEditors(page: Page): Promise<string[]> {
  const ids = await page.$$eval('[data-testid^="editor-tab-"]', (ns) =>
    ns.map((n) => n.getAttribute('data-testid')!.replace('editor-tab-', '')),
  );
  return [...new Set(ids)];
}

test.describe('every editor is reachable on every form factor', () => {
  test('the desktop declares more than one editor, so the cases below mean something', async ({
    page,
  }) => {
    await boot(page, 1440, 900);
    const editors = await declaredEditors(page);
    console.log(`§5 · desktop declares ${editors.length} editor(s): ${editors.join(', ')}`);
    // The guard against the whole file passing on an empty list.
    expect(editors.length).toBeGreaterThan(4);
  });

  for (const form of FORMS) {
    test(`${form.id} offers every editor it does not reach another way`, async ({ page }) => {
      await boot(page, 1440, 900);
      const all = await declaredEditors(page);

      await boot(page, form.width, form.height);
      if (form.enter) {
        await page.locator(`[data-testid="${form.enter}"]`).first().click();
        await page.waitForTimeout(400);
      }
      const here = await declaredEditors(page);
      const expected = all.filter((id) => !form.elsewhere.includes(id));
      console.log(`§5 · ${form.id.padEnd(8)} offers ${here.length}: ${here.join(', ')}`);
      expect([...here].sort(), `${form.id} is missing an editor`).toEqual([...expected].sort());

      // And each tab is a real target, not a 12 px sliver squeezed to fit.
      for (const id of here) {
        const box = await page.locator(`[data-testid="editor-tab-${id}"]`).first().boundingBox();
        expect(box, `${form.id}: ${id} has no box`).not.toBeNull();
        expect(box!.width, `${form.id}: ${id} is ${box!.width}px wide`).toBeGreaterThan(28);
      }
    });
  }

  test('what a phone excludes, it reaches by its bottom navigation', async ({ page }) => {
    // The other half of `elsewhere`. Without this, excluding an editor would be
    // indistinguishable from losing it, and the case above would bless either.
    await boot(page, 390, 844);
    for (const mode of ['mix', 'perform']) {
      const nav = page.locator(`[data-testid="nav-${mode}"]`).first();
      await expect(nav, `a phone has no ${mode} mode`).toBeVisible();
      await nav.click();
      await page.waitForTimeout(300);
      await expect(page.locator(`[data-testid="phone-mode-${mode}"]`)).toBeVisible();
    }
  });
});
