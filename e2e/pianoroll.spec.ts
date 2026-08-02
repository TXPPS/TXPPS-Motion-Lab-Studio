import { test, expect, type Page } from '@playwright/test';

/**
 * Piano roll workflow, driven through real pointer and keyboard events.
 * The dense-fixture test proves windowed rendering keeps a 6000-note clip
 * editable; budgets are calibrated to this CI's software rasteriser.
 *
 * Store reads target the clip by NAME: the demo project's first MIDI clip in
 * the clips array is the drum groove, not the clip the editor has open.
 */

interface NoteShape {
  id: string;
  start: number;
  length: number;
  pitch: number;
  velocity: number;
  muted?: boolean;
}

async function bootDemo(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
  await page.waitForTimeout(900);
  // Open the demo's Keys clip in the piano roll via its context menu.
  const clip = await page.locator('[data-testid="clip-Keys — Am F C G"]').boundingBox();
  expect(clip).not.toBeNull();
  await page.mouse.click(clip!.x + 60, clip!.y + 20, { button: 'right' });
  await page.click('.ctx-menu button:has-text("Open in Piano Roll")');
  await page.waitForSelector('[data-testid="pr-grid"]');
  await page.waitForTimeout(400);
}

/** Notes of the clip the piano roll has open (looked up by name). */
const keysNotes = (page: Page): Promise<NoteShape[]> =>
  page.evaluate(() => {
    const w = window as unknown as {
      __ml: {
        projectStore: {
          getState(): { project: { clips: { name: string; notes?: unknown[] }[] } };
        };
      };
    };
    const clip = w.__ml.projectStore
      .getState()
      .project.clips.find((c) => c.name === 'Keys — Am F C G');
    return (clip?.notes ?? []) as never[];
  });

/**
 * Viewport point for (beat, pitch): scrolls the roll so the target sits inside
 * the visible grid band first (the velocity lane owns the bottom 56px), then
 * maps content coordinates through the live scroll offsets.
 */
async function gridPoint(page: Page, beat: number, pitch: number) {
  const pt = page.evaluate(
    ([b, p]) => {
      const sc = document.querySelector('.pr-scroll') as HTMLElement;
      const gridBand = sc.clientHeight - 56;
      sc.scrollTop = Math.max(0, (108 - p) * 16 + 8 - gridBand / 2);
      sc.scrollLeft = Math.max(0, 52 + b * 32 - sc.clientWidth / 2);
      const box = sc.getBoundingClientRect();
      return {
        x: box.left + 52 + b * 32 - sc.scrollLeft,
        y: box.top + (108 - p) * 16 + 8 - sc.scrollTop,
      };
    },
    [beat, pitch] as const,
  );
  await page.waitForTimeout(150);
  return pt;
}

const noteCount = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as {
      __ml: {
        projectStore: {
          getState(): {
            project: { clips: { id: string; type: string; notes?: unknown[] }[] };
          };
        };
      };
    };
    const clips = w.__ml.projectStore.getState().project.clips;
    const midi = clips.filter((c) => c.type === 'midi');
    return midi.reduce((a, c) => a + (c.notes?.length ?? 0), 0);
  });

test.describe('piano roll editing', () => {
  test('marquee selects notes; arrows transpose and nudge; M mutes', async ({ page }) => {
    await bootDemo(page);
    // Position the view over the pitch band the demo Keys clip occupies and
    // compute both sweep endpoints from that one scroll state. The lower
    // endpoint may fall below the visible band; pointer capture keeps the
    // marquee tracking regardless.
    const countBefore = (await keysNotes(page)).length;
    const pts = await page.evaluate(() => {
      const sc = document.querySelector('.pr-scroll') as HTMLElement;
      sc.scrollLeft = 0;
      sc.scrollTop = (108 - 76) * 16; // pitch 76 at the top edge
      const box = sc.getBoundingClientRect();
      const pt = (beat: number, pitch: number) => ({
        x: box.left + 52 + beat * 32,
        // Clamp inside the window: Firefox's synthetic input drops moves
        // outside the viewport (a real OS pointer keeps streaming via
        // capture, so users are unaffected — only the harness needs this).
        y: Math.min(window.innerHeight - 24, box.top + (108 - pitch) * 16 + 8 - sc.scrollTop),
      });
      return { a: pt(0.3, 74), b: pt(14, 52) };
    });
    await page.waitForTimeout(200);
    await page.mouse.move(pts.a.x, pts.a.y);
    await page.mouse.down();
    await page.mouse.move(pts.b.x, pts.b.y, { steps: 10 });
    await expect(page.locator('[data-testid="pr-marquee"]')).toBeVisible();
    await page.mouse.up();

    const before = await keysNotes(page);
    const selected = await page.evaluate(
      () => document.querySelectorAll('.pr-note.selected').length,
    );
    expect(selected, 'marquee selected no notes').toBeGreaterThan(3);
    // Releasing the marquee must not add a note under the pointer.
    expect(before.length, 'marquee release added a stray note').toBe(countBefore);

    // Arrow up transposes the selection by +1 semitone.
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(200);
    const after = await keysNotes(page);
    const changed = after.filter((n, i) => n.pitch !== before[i].pitch).length;
    expect(changed, 'ArrowUp transposed nothing').toBeGreaterThan(3);

    // M mutes the selection; muted notes render dashed.
    await page.keyboard.press('m');
    await page.waitForTimeout(200);
    expect(
      await page.evaluate(() => document.querySelectorAll('.pr-note.muted').length),
    ).toBeGreaterThan(3);
    // Second press unmutes.
    await page.keyboard.press('m');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.querySelectorAll('.pr-note.muted').length)).toBe(0);
  });

  test('Ctrl+A selects notes (not clips) and Ctrl+D duplicates them', async ({ page }) => {
    await bootDemo(page);
    const before = await noteCount(page);
    // Opening the editor legitimately selects the source clip; Ctrl+A in the
    // piano roll must not grow that clip selection to every clip.
    const clipSelBefore = await page.evaluate(
      () => document.querySelectorAll('.clip.selected').length,
    );

    await page.keyboard.press('Control+a');
    const selNotes = await page.evaluate(
      () => document.querySelectorAll('.pr-note.selected').length,
    );
    expect(selNotes, 'Ctrl+A did not select notes').toBeGreaterThan(5);
    expect(
      await page.evaluate(() => document.querySelectorAll('.clip.selected').length),
      'Ctrl+A leaked to the arrangement clip selection',
    ).toBe(clipSelBefore);

    await page.keyboard.press('Control+d');
    await page.waitForTimeout(300);
    const after = await noteCount(page);
    expect(after, 'Ctrl+D did not duplicate the notes').toBeGreaterThan(before);

    // One undo restores the original count: the duplicate was one step.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect(await noteCount(page)).toBe(before);
  });

  test('quantize hard-snaps and undoes as one step', async ({ page }) => {
    await bootDemo(page);
    // Deliberately shift notes off-grid first (fine nudge), then quantize back.
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(200);

    const offGridCount = (notes: NoteShape[]) =>
      notes.filter((n) => Math.abs(n.start / 0.25 - Math.round(n.start / 0.25)) > 1e-6).length;

    const offGrid = offGridCount(await keysNotes(page));
    expect(offGrid, 'setup: nudge should move notes off the 1/16 grid').toBeGreaterThan(5);

    await page.click('[data-testid="quantize-apply"]');
    await page.waitForTimeout(300);
    expect(offGridCount(await keysNotes(page)), 'quantize left notes off-grid').toBe(0);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    expect(
      offGridCount(await keysNotes(page)),
      'undo did not restore the un-quantized state',
    ).toBe(offGrid);
  });

  test('chordify builds a major chord from a selected root', async ({ page }) => {
    await bootDemo(page);
    const before = await noteCount(page);
    // Select one note.
    const first = page.locator('.pr-note').first();
    await first.click();
    await page.click('[data-testid="pr-chords"]');
    await page.click('.ctx-menu button:has-text("Chordify: Major")');
    await page.waitForTimeout(300);
    // A triad adds two tones above the root.
    expect(await noteCount(page)).toBe(before + 2);
  });

  test('velocity lane bars exist and drag changes velocity', async ({ page }) => {
    await bootDemo(page);
    const lane = page.locator('[data-testid="pr-vel-lane"]');
    await expect(lane).toBeVisible();
    const bars = await lane.locator('.pr-vel-bar').count();
    expect(bars, 'no velocity bars rendered').toBeGreaterThan(5);

    const velBefore = (await keysNotes(page)).map((n) => n.velocity);
    const bar = lane.locator('.pr-vel-bar').first();
    const box = (await bar.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 40, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const velAfter = (await keysNotes(page)).map((n) => n.velocity);
    expect(
      velAfter.some((v, i) => v < velBefore[i]),
      'dragging the bar did not lower any velocity',
    ).toBe(true);
  });

  test('scale highlight shades out-of-scale rows and lock snaps added notes', async ({ page }) => {
    await bootDemo(page);
    await page.selectOption('[data-testid="scale-select"]', 'major');
    await page.waitForTimeout(200);
    // Key rows outside C major dim.
    expect(await page.evaluate(() => document.querySelectorAll('.pr-key.oos').length)).toBeGreaterThan(
      10,
    );

    // With lock on, clicking a C♯ row lands on an in-scale pitch.
    await page.click('button[title*="scale"]');
    const before = await noteCount(page);
    const pt = await gridPoint(page, 9, 73); // C♯5, empty area of the clip
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(250);
    expect(await noteCount(page)).toBe(before + 1);
    const notes = await keysNotes(page);
    // 73 is C♯; the lock must land on an in-scale neighbour instead.
    expect([72, 74]).toContain(notes[notes.length - 1].pitch);
  });
});

test.describe('dense MIDI fixture (11k notes)', () => {
  test('opens a 6k-note clip with windowed rendering and stays responsive', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/qa-midi');
    await page.waitForSelector('[data-testid="app-root"]');
    await page.waitForTimeout(1200);

    const total = await noteCount(page);
    expect(total, 'fixture must hold 11k+ notes').toBeGreaterThanOrEqual(11000);

    // Open the 6k-note clip.
    const clip = await page.locator('[data-testid="clip-Stack 6k"]').boundingBox();
    expect(clip).not.toBeNull();
    await page.mouse.click(clip!.x + 60, clip!.y + 20, { button: 'right' });
    await page.click('.ctx-menu button:has-text("Open in Piano Roll")');
    await page.waitForSelector('[data-testid="pr-grid"]');
    await page.waitForTimeout(800);

    const mounted = await page.evaluate(() => document.querySelectorAll('.pr-note').length);
    expect(mounted, 'windowing must bound the mounted notes').toBeLessThan(2500);
    expect(mounted).toBeGreaterThan(50);

    // Scroll the roll horizontally; budgets calibrated to CI software raster.
    const cost = await page.evaluate(async () => {
      const sc = document.querySelector('.pr-scroll') as HTMLElement;
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      const start = performance.now();
      for (let i = 0; i < 20; i++) {
        sc.scrollLeft = (i % 10) * 300;
        await raf();
      }
      return (performance.now() - start) / 20;
    });
    expect(cost, `scroll step ${cost.toFixed(1)}ms`).toBeLessThan(120);

    // Editing at scale: marquee a region and transpose it. Reset the scroll the
    // cost loop left behind, wait for the window to remount, then scan down for
    // a start cell that is genuinely empty — the stack is dense enough that a
    // fixed point often lands on a note and drags it instead.
    await page.evaluate(() => {
      (document.querySelector('.pr-scroll') as HTMLElement).scrollLeft = 0;
    });
    await page.waitForTimeout(300);
    const sweep = await page.evaluate(() => {
      const sc = document.querySelector('.pr-scroll') as HTMLElement;
      const box = sc.getBoundingClientRect();
      let y0 = box.top + 20;
      for (; y0 < box.top + 150; y0 += 8) {
        const el = document.elementFromPoint(box.left + 70, y0) as HTMLElement | null;
        if (el?.classList.contains('pr-grid-area')) break;
      }
      // Sweep stays above the velocity lane (bottom 56px of the scroller).
      return { x0: box.left + 70, y0, x1: box.left + 500, y1: box.top + sc.clientHeight - 60 };
    });
    await page.mouse.move(sweep.x0, sweep.y0);
    await page.mouse.down();
    await page.mouse.move(sweep.x1, sweep.y1, { steps: 8 });
    await page.mouse.up();
    const sel = await page.evaluate(() => document.querySelectorAll('.pr-note.selected').length);
    expect(sel).toBeGreaterThan(10);
    const t0 = Date.now();
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    expect(Date.now() - t0, 'transpose at scale locked the UI').toBeLessThan(2500);
  });
});
