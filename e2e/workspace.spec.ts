import { test, expect, type Page } from '@playwright/test';

/**
 * RC2.1 — full-screen workspace system, layout persistence, touch-selection
 * discipline and overlap-free responsive chrome. Selection/undo/scroll
 * survival is asserted against the real stores and DOM, not assumed.
 */

async function boot(page: Page, size = { width: 1440, height: 900 }) {
  await page.setViewportSize(size);
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
  await page.waitForTimeout(900);
}

test.describe('full-screen workspace (desktop)', () => {
  test('editor expands over everything and restores the exact layout', async ({ page }) => {
    await boot(page);

    // Select a clip and scroll the arrangement first — both must survive.
    await page.click('[data-testid="clip-Drums A"]');
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="arr-scroll"]')!;
      el.scrollLeft = 420;
    });
    await page.click('[data-testid="editor-tab-piano"]');
    await page.waitForTimeout(200);

    await page.click('[data-testid="maximize-editor"]');
    await page.waitForTimeout(300);
    // Full screen: the editor is alone; arrangement and side panels are gone.
    await expect(page.locator('[data-testid="maxi-editor"]')).toBeVisible();
    await expect(page.locator('[data-testid="arr-scroll"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="browser-side"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="inspector-side"]')).toHaveCount(0);
    // No duplicate rendering: exactly one editor body.
    await expect(page.locator('[data-testid="bottom-editor"]')).toHaveCount(1);
    // The active tab is preserved.
    await expect(page.locator('[data-testid="editor-tab-piano"]')).toHaveClass(/on/);

    await page.click('[data-testid="maximize-editor"]');
    await page.waitForTimeout(400);
    // Restored: panels back, arrangement scroll and selection intact.
    await expect(page.locator('[data-testid="browser-side"]')).toBeVisible();
    await expect(page.locator('[data-testid="inspector-side"]')).toBeVisible();
    const state = await page.evaluate(() => ({
      scroll: document.querySelector('[data-testid="arr-scroll"]')!.scrollLeft,
      selected: document.querySelectorAll('.clip.selected').length,
    }));
    expect(state.scroll).toBe(420);
    expect(state.selected).toBe(1);
  });

  test('undo history survives a maximize/restore round trip', async ({ page }) => {
    await boot(page);
    const clips = () =>
      page.evaluate(
        () =>
          (window as unknown as { __ml: { projectStore: { getState(): { project: { clips: unknown[] } } } } })
            .__ml.projectStore.getState().project.clips.length,
      );
    const before = await clips();
    await page.click('[data-testid="clip-Drums A"]');
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(200);
    expect(await clips()).toBe(before + 1);

    await page.click('[data-testid="maximize-arrange"]');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="maxi-arrange"]')).toBeVisible();
    // Undo works while maximized and refers to the pre-maximize edit.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    expect(await clips()).toBe(before);

    await page.click('[data-testid="maximize-arrange"]');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="browser-side"]')).toBeVisible();
  });

  test('browser and inspector maximize as centered columns', async ({ page }) => {
    await boot(page);
    await page.click('[data-testid="maximize-browser"]');
    await expect(page.locator('[data-testid="maxi-browser"]')).toBeVisible();
    await expect(page.locator('[data-testid="browser-panel"]')).toBeVisible();
    // The restore control lives in the maximized panel itself.
    await page.click('[data-testid="maximize-browser"]');
    await expect(page.locator('[data-testid="browser-side"]')).toBeVisible();

    await page.click('[data-testid="maximize-inspector"]');
    await expect(page.locator('[data-testid="maxi-inspector"]')).toBeVisible();
    await page.click('[data-testid="maximize-inspector"]');
    await expect(page.locator('[data-testid="inspector-side"]')).toBeVisible();
  });

  test('maximized state persists across a reload and restores cleanly', async ({ page }) => {
    await boot(page);
    await page.click('[data-testid="maximize-editor"]');
    await expect(page.locator('[data-testid="maxi-editor"]')).toBeVisible();
    await page.waitForTimeout(600); // persistence debounce

    await page.reload();
    await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
    await page.waitForTimeout(600);
    await expect(page.locator('[data-testid="maxi-editor"]')).toBeVisible();

    await page.click('[data-testid="maximize-editor"]');
    await expect(page.locator('[data-testid="browser-side"]')).toBeVisible();
    await page.waitForTimeout(600);
  });
});

test.describe('full-screen workspace (tablet)', () => {
  test('editor full screen is a true single-editor workflow', async ({ page }) => {
    await boot(page, { width: 1024, height: 768 });
    await page.click('[data-testid="combo-piano"]');
    await page.click('[data-testid="maximize-editor"]');
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid="maxi-editor"]')).toBeVisible();
    await expect(page.locator('[data-testid="arr-scroll"]')).toHaveCount(0);
    // The combo bar keeps working while full screen — switch to the mixer.
    await page.click('[data-testid="combo-mixer"]');
    await expect(page.locator('[data-testid="mixer"]')).toBeVisible();

    await page.click('[data-testid="maximize-editor"]');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="arr-scroll"]')).toBeVisible();
    await expect(page.locator('[data-testid="mixer"]')).toBeVisible();
  });
});

test.describe('touch-selection discipline', () => {
  test('chrome is unselectable; intentional text stays selectable', async ({ page }) => {
    await boot(page);
    // user-select's computed value differs per engine ('auto' in Gecko where
    // Chromium reports the cascaded 'none') — resolve the USED value by
    // walking to the nearest non-auto ancestor, which is what selection
    // actually obeys.
    const sel = (selector: string) =>
      page.evaluate((s) => {
        let el: Element | null = document.querySelector(s)!;
        while (el) {
          const v = getComputedStyle(el).userSelect;
          if (v !== 'auto') return v;
          el = el.parentElement;
        }
        return 'auto';
      }, selector);
    // Controls: never selectable.
    expect(await sel('.transport')).toBe('none');
    expect(await sel('[data-testid="btn-play"]')).toBe('none');
    expect(await sel('.browser-tabs')).toBe('none');
    expect(await sel('[data-testid="statusbar"]')).toBe('none');
    // Text editing: selectable.
    expect(await sel('[data-testid="browser-search"]')).toBe('text');
    await page.keyboard.press('Escape');
    expect(await sel('[data-testid="project-notes"]')).toBe('text');
    // Faders own their touches.
    expect(
      await page.evaluate(
        () => getComputedStyle(document.querySelector('input[type="range"]')!).touchAction,
      ),
    ).toBe('none');
  });
});

test.describe('responsive chrome integrity', () => {
  for (const [w, h] of [
    [390, 844],
    [844, 390],
    [768, 1024],
    [1024, 768],
    [1440, 900],
    [2560, 1080],
  ] as const) {
    test(`no clipped or overlapping chrome controls at ${w}x${h}`, async ({ page }) => {
      await boot(page, { width: w, height: h });
      const problems = await page.evaluate(() => {
        const out: string[] = [];
        const vw = window.innerWidth;
        const regions = document.querySelectorAll(
          '.topbar, .transport, .arr-toolbar, .editor-tabs, .statusbar, .bottomnav, .browser-tabs',
        );
        const name = (el: Element) =>
          el.getAttribute('data-testid') || el.getAttribute('aria-label') ||
          (el.textContent || '').trim().slice(0, 16);
        for (const region of regions) {
          const els = [...region.querySelectorAll('button, input, select')].filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          for (const el of els) {
            const r = el.getBoundingClientRect();
            if (r.right > vw + 1) out.push(`${name(el)} clipped right at ${Math.round(r.right)}`);
            if (r.left < -1) out.push(`${name(el)} clipped left`);
          }
          for (let i = 0; i < els.length; i++) {
            for (let j = i + 1; j < els.length; j++) {
              if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
              const a = els[i].getBoundingClientRect();
              const b = els[j].getBoundingClientRect();
              const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (ox > 4 && oy > 4) out.push(`overlap ${name(els[i])} × ${name(els[j])}`);
            }
          }
        }
        return out;
      });
      expect(problems, problems.join(' | ')).toEqual([]);
    });
  }
});
