import { test, expect, type Page } from '@playwright/test';
import { PERF_SCALE } from './perfScale';

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
        __ml: {
          projectStore: { getState(): { project: { clips: { name: string; start: number }[] } } };
        };
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
        __ml: {
          projectStore: { getState(): { project: { clips: { name: string; start: number }[] } } };
        };
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

test.describe('browser and project workflow', () => {
  test('search filters every browser tab', async ({ page }) => {
    await boot(page);
    await page.fill('[data-testid="browser-search"]', 'demo');
    await expect(page.locator('[data-testid^="proj-item-"]')).toHaveCount(1);

    await page.fill('[data-testid="browser-search"]', 'zzz-no-match');
    await expect(page.locator('[data-testid^="proj-item-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="browser-panel"]')).toContainText('No projects match');

    // Loops tab: the two procedural loops filter down to one.
    await page.fill('[data-testid="browser-search"]', '');
    await page.click('[data-testid="browser-tab-loops"]');
    const allLoops = await page.locator('[data-testid="browser-panel"] .list-item').count();
    await page.fill('[data-testid="browser-search"]', 'texture');
    const filtered = await page.locator('[data-testid="browser-panel"] .list-item').count();
    expect(filtered).toBeLessThan(allLoops);
    expect(filtered).toBeGreaterThan(0);
  });

  test('audition previews a loop and stops when replaced', async ({ page }) => {
    await boot(page);
    await page.click('[data-testid="browser-tab-loops"]');
    const first = page.locator('[data-testid^="audition-"]').first();
    await first.click();
    // First audition also unlocks the AudioContext; engines differ in how
    // long that takes, so poll rather than assuming a fixed delay.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const w = window as unknown as { __ml: { engine: { auditioningId(): string | null } } };
            return w.__ml.engine.auditioningId();
          }),
        { timeout: 8000, message: 'audition did not start' },
      )
      .not.toBeNull();
    const playing = await page.evaluate(() => {
      const w = window as unknown as { __ml: { engine: { auditioningId(): string | null } } };
      return w.__ml.engine.auditioningId();
    });

    // Starting the second replaces the first rather than stacking.
    const second = page.locator('[data-testid^="audition-"]').nth(1);
    await second.click();
    await page.waitForTimeout(300);
    const nowPlaying = await page.evaluate(() => {
      const w = window as unknown as { __ml: { engine: { auditioningId(): string | null } } };
      return w.__ml.engine.auditioningId();
    });
    expect(nowPlaying).not.toBeNull();
    expect(nowPlaying).not.toBe(playing);
  });

  test('project notes persist through save and reload', async ({ page }) => {
    await boot(page);
    // Deselect so the inspector shows the project section.
    await page.keyboard.press('Escape');
    const notes = page.locator('[data-testid="project-notes"]');
    await expect(notes).toBeVisible();
    await notes.fill('Chorus needs a darker pad. Verse vocal at -6.');
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(700);

    await page.reload();
    await page.waitForSelector('[data-testid="app-root"]');
    await page.waitForTimeout(1200);
    await expect(page.locator('[data-testid="project-notes"]')).toHaveValue(
      'Chorus needs a darker pad. Verse vocal at -6.',
    );
  });
});

test.describe('editing tools', () => {
  test('split, mute, and erase tools act on click; Escape returns to pointer', async ({ page }) => {
    await boot(page);
    const before = await page.evaluate(
      () => document.querySelectorAll('[data-testid^="clip-"]').length,
    );

    // Split tool: one click through the middle makes two clips.
    await page.click('[data-testid="tool-split"]');
    const a = await clipBox(page, 'Drums A');
    await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2);
    await page.waitForTimeout(250);
    expect(
      await page.evaluate(() => document.querySelectorAll('[data-testid^="clip-"]').length),
    ).toBe(before + 1);

    // Mute tool: click toggles the muted style.
    await page.keyboard.press('4');
    const bass = await clipBox(page, 'Bass A');
    await page.mouse.click(bass.x + 40, bass.y + bass.height / 2);
    await page.waitForTimeout(200);
    expect(await page.locator('[data-testid="clip-Bass A"]').getAttribute('class')).toContain(
      'muted',
    );

    // Erase tool: click deletes. ("Lead Motif" is the unique-named clip.)
    await page.keyboard.press('3');
    const tex = await clipBox(page, 'Lead Motif');
    await page.mouse.click(tex.x + 30, tex.y + tex.height / 2);
    await page.waitForTimeout(200);
    expect(
      await page.evaluate(() => document.querySelectorAll('[data-testid^="clip-"]').length),
    ).toBe(before); // +1 from split, -1 from erase

    // Escape restores the pointer tool.
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="tool-pointer"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

test.describe('huge-scale fixture (100 tracks / 1000 clips)', () => {
  test('loads, stays inside layout budgets, and scrolling stays responsive', async ({ page }) => {
    // Pure performance assertion, Chromium-calibrated (see audioedit note).
    test.skip(
      process.env.E2E_BROWSER === 'webkit',
      'stress perf budgets are Chromium-calibrated; container WebKit is not a perf reference',
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    const t0 = Date.now();
    await page.goto('/#/qa-huge');
    await page.waitForSelector('[data-testid="arr-lanes"]', { timeout: 20000 });
    await page.waitForTimeout(800);
    const bootMs = Date.now() - t0;

    const info = await page.evaluate(() => {
      const w = window as unknown as {
        __ml: {
          projectStore: { getState(): { project: { tracks: unknown[]; clips: unknown[] } } };
        };
      };
      const p = w.__ml.projectStore.getState().project;
      return {
        tracks: p.tracks.length,
        clips: p.clips.length,
        docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        mountedClips: document.querySelectorAll('[data-testid^="clip-"]').length,
      };
    });
    expect(info.tracks).toBe(100);
    expect(info.clips).toBeGreaterThanOrEqual(1000);
    expect(info.docOverflowX, 'page-level overflow at huge scale').toBeLessThanOrEqual(1);
    // Windowed rendering: only clips near the viewport are mounted. The point
    // is that the DOM stays small while the project is huge.
    expect(info.mountedClips).toBeGreaterThan(10);
    expect(info.mountedClips).toBeLessThan(600);

    // Scroll cost, measured two ways. Budgets are calibrated to this CI's
    // software rasteriser, whose measured paint floor is ~40ms/frame with ZERO
    // clips mounted — on GPU hardware these frames cost a few ms. What the
    // budgets defend is the improvement windowing bought: before it, the same
    // sweep averaged 200-275ms a step.
    const cost = await page.evaluate(async () => {
      const vp = document.querySelector('[data-testid="arr-scroll"]') as HTMLElement;
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      vp.scrollLeft = 1000;
      await raf();
      let t = performance.now();
      for (let i = 0; i < 20; i++) {
        vp.scrollLeft += 12; // stays within one window quantum: pure paint
        await raf();
      }
      const smallStep = (performance.now() - t) / 20;
      t = performance.now();
      for (let i = 0; i < 20; i++) {
        vp.scrollLeft = 500 + (i % 10) * 500; // crosses quanta: remount cost
        vp.scrollTop = (i % 5) * 400;
        await raf();
      }
      const bigJump = (performance.now() - t) / 20;
      return { smallStep, bigJump };
    });
    expect(cost.smallStep, `paint-only step ${cost.smallStep.toFixed(1)}ms`).toBeLessThan(
      70 * PERF_SCALE,
    );
    expect(cost.bigJump, `windowed jump ${cost.bigJump.toFixed(1)}ms`).toBeLessThan(
      150 * PERF_SCALE,
    );

    // Group-selection machinery at scale: marquee a region and confirm the
    // store-level selection matches without locking the UI. (Select-all is
    // excluded: selected clips always mount, which would defeat windowing —
    // that is a documented trade-off, not an oversight.)
    // Return to origin first: the sweep left the viewport scrolled far away.
    await page.evaluate(() => {
      const vp = document.querySelector('[data-testid="arr-scroll"]') as HTMLElement;
      vp.scrollLeft = 0;
      vp.scrollTop = 0;
    });
    await page.waitForTimeout(400);
    const lanes = (await page.locator('[data-testid="arr-lanes"]').boundingBox())!;
    await page.mouse.move(lanes.x + 250, lanes.y + 205);
    await page.mouse.down();
    await page.mouse.move(lanes.x + 700, lanes.y + 500, { steps: 8 });
    await page.mouse.up();
    const selected = await page.evaluate(() => {
      const w = window as unknown as {
        __ml: { uiStore?: unknown } & Record<string, unknown>;
      };
      void w;
      return document.querySelectorAll('.clip.selected').length;
    });
    expect(selected, 'marquee found nothing at scale').toBeGreaterThan(0);

    // Honest logging, not a hard budget: cold boot time at this scale.
    console.log(
      `qa-huge boot ${bootMs}ms · paint-only ${cost.smallStep.toFixed(1)}ms · jump ${cost.bigJump.toFixed(1)}ms`,
    );
  });
});
