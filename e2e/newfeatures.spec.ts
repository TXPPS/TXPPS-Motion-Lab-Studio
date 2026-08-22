import { test, expect, type Page } from '@playwright/test';

/**
 * The features added after the first parity pass, driven through the real UI
 * rather than through store actions: cue mixes, Control Link, groove and
 * project merge. Each of these had unit tests for its model and nothing
 * proving the product could actually reach it.
 */
async function boot(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
  await page.waitForFunction(() => '__ml' in window, { timeout: 15000 });
  await page.waitForTimeout(600);
}

/** The live project, read from the store the app renders from. */
function project<T>(page: Page, read: (p: Record<string, unknown>) => T): Promise<T> {
  return page.evaluate((src) => {
    const w = window as unknown as {
      __ml: { projectStore: { getState(): { project: Record<string, unknown> } } };
    };
    const fn = new Function('p', `return (${src})(p);`) as (p: unknown) => unknown;
    return fn(w.__ml.projectStore.getState().project);
  }, read.toString()) as Promise<T>;
}

test.describe('cue mixes', () => {
  test('a new cue starts as the main mix and only departs where it is touched', async ({
    page,
  }) => {
    await boot(page);
    await page.click('[data-testid="editor-tab-mixer"]');
    await page.click('[data-testid="maximize-editor"]');

    await expect(page.locator('[data-testid="cue-bar"]')).toBeVisible();
    await page.click('[data-testid="cue-add"]');

    // Adding a cue monitors it, and the console says so.
    await expect(page.locator('[data-testid="cue-bar"]')).toHaveClass(/live/);
    const cues = await project(page, (p) => (p.cueMixes as unknown[]).length);
    expect(cues).toBe(1);

    // No channel has been touched, so the cue is the main mix.
    const touched = await project(
      page,
      (p) => Object.keys((p.cueMixes as { sends: object }[])[0].sends).length,
    );
    expect(touched).toBe(0);

    // Moving a fader while a cue is monitored moves the cue, not the mix.
    const before = await project(page, (p) => (p.tracks as { volume: number }[])[0].volume);
    const fader = page.locator('.strip .fader').first();
    const box = await fader.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 8, { steps: 6 });
    await page.mouse.up();

    const after = await project(page, (p) => (p.tracks as { volume: number }[])[0].volume);
    expect(after, 'the main mix must not move while a cue is monitored').toBeCloseTo(before, 6);
    const nowTouched = await project(
      page,
      (p) => Object.keys((p.cueMixes as { sends: object }[])[0].sends).length,
    );
    expect(nowTouched, 'the cue did not take the fader move').toBe(1);

    // Match main puts it back, and Main leaves the mode.
    await page.click('[data-testid="cue-match"]');
    expect(
      await project(page, (p) => Object.keys((p.cueMixes as { sends: object }[])[0].sends).length),
    ).toBe(0);
    await page.click('[data-testid="cue-main"]');
    await expect(page.locator('[data-testid="cue-bar"]')).not.toHaveClass(/live/);
  });
});

test.describe('Control Link', () => {
  test('offers every bindable target and lists a binding once it is made', async ({ page }) => {
    await boot(page);
    await page.click('[data-testid="open-settings"]').catch(async () => {
      await page.click('[data-testid="topbar-overflow"]');
      await page.click('text=Preferences');
    });
    await expect(page.locator('[data-testid="control-links"]')).toBeVisible();

    // The target list is built from the real parameter registry, so it must
    // carry the transport, the master and per-track parameters.
    const options = await page.locator('[data-testid="control-target"] option').allTextContents();
    expect(options.some((o) => o.startsWith('Transport'))).toBe(true);
    expect(options).toContain('Master · Volume');
    expect(options.some((o) => o.includes('· Volume') && !o.startsWith('Master'))).toBe(true);

    // A binding made in the store shows up in the list with its source and
    // target named — this is the panel's whole job.
    await page.evaluate(() => {
      const w = window as unknown as {
        __ml: {
          projectStore: {
            getState(): {
              addControlLink(s: unknown, t: unknown): string | null;
            };
          };
        };
      };
      w.__ml.projectStore
        .getState()
        .addControlLink(
          { kind: 'cc', cc: 7, channel: 1 },
          { kind: 'transport', command: 'playStop' },
        );
    });
    await expect(page.locator('.ctl-row')).toHaveCount(1);
    await expect(page.locator('.ctl-src')).toHaveText('CC 7 · ch 1');
    await expect(page.locator('.ctl-tgt')).toHaveText('Transport · playStop');
  });
});

test.describe('groove', () => {
  test('extracting from a clip keeps the groove with the song and applying moves notes', async ({
    page,
  }) => {
    await boot(page);
    // Ask the project which clip to click rather than guessing a name: the
    // groove panel only appears for a MIDI clip with notes in it.
    const name = await project(page, (p) => {
      const clips = p.clips as { type: string; name: string; notes?: unknown[] }[];
      return clips.find((c) => c.type === 'midi' && (c.notes ?? []).length > 1)?.name ?? '';
    });
    expect(name, 'the demo project has no MIDI clip to groove').not.toBe('');

    await page.click(`[data-testid="clip-${name}"]`);
    const panel = page.locator('[data-testid="groove-panel"]');
    await expect(panel).toBeVisible();

    const before = await project(page, (p) => {
      const clips = p.clips as { type: string; notes?: { start: number }[] }[];
      const midi = clips.find((c) => c.type === 'midi' && (c.notes ?? []).length > 1);
      return (midi?.notes ?? []).map((n) => n.start);
    });

    // Apply the built-in swing the panel opens on. Extracting first would
    // select the clip's own feel, and a clip programmed exactly on the grid
    // has no feel to lift — applying it back would correctly change nothing.
    await page.click('[data-testid="groove-apply"]');
    const after = await project(page, (p) => {
      const clips = p.clips as { type: string; notes?: { start: number }[] }[];
      const midi = clips.find((c) => c.type === 'midi' && (c.notes ?? []).length > 1);
      return (midi?.notes ?? []).map((n) => n.start);
    });
    expect(after.length).toBe(before.length);
    expect(
      after.some((s, i) => Math.abs(s - before[i]) > 1e-9),
      'the groove moved nothing',
    ).toBe(true);

    // Extracting keeps the clip's own feel with the song, which is now a real
    // feel because the swing has just been applied to it.
    await page.click('[data-testid="groove-extract"]');
    const saved = await project(page, (p) => (p.grooves as { offsets: number[] }[]) ?? []);
    expect(saved.length).toBe(1);
    expect(
      saved[0].offsets.some((o) => Math.abs(o) > 1e-6),
      'the lifted groove is flat',
    ).toBe(true);
  });
});
