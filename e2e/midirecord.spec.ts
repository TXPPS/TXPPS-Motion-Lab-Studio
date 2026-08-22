import { test, expect, type Page } from '@playwright/test';

/**
 * MIDI recording, end to end and through the real UI: arm an instrument
 * track, press record, play the computer keyboard, stop, and find a clip
 * with the notes in it.
 *
 * No microphone and no MediaRecorder are involved — that is the point of the
 * path, and the reason this file needs none of the fake-capture setup the
 * audio recording suite does.
 */
async function boot(page: Page) {
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
  // The audio graph needs a gesture before it will start.
  await page.click('[data-testid="app-root"]');
  await page.waitForTimeout(500);
}

/** MIDI clips on a track, read from the store the app actually renders from. */
async function midiClipCount(page: Page, trackName: string) {
  return page.evaluate((name) => {
    const w = window as unknown as {
      __ml?: { projectStore?: { getState: () => { project: unknown } } };
    };
    const project = w.__ml?.projectStore?.getState().project as
      | { tracks: { id: string; name: string }[]; clips: { trackId: string; type: string }[] }
      | undefined;
    if (!project) return -1;
    const track = project.tracks.find((t) => t.name === name);
    if (!track) return -1;
    return project.clips.filter((c) => c.trackId === track.id && c.type === 'midi').length;
  }, trackName);
}

test.describe('MIDI recording', () => {
  test('records what is played onto an armed instrument track', async ({ page }) => {
    await boot(page);

    const before = await midiClipCount(page, 'Keys');
    test.skip(before < 0, 'no store bridge or no Keys track in this build');

    await page.click('[data-testid="arm-Keys"]');
    await expect(page.locator('[data-testid="arm-Keys"]')).toHaveAttribute('aria-pressed', 'true');

    await page.click('[data-testid="btn-record"]');
    // One bar of count-in at the project tempo, then capture starts.
    await expect(page.locator('[data-testid="btn-record"]')).toHaveAttribute(
      'data-phase',
      'recording',
      { timeout: 15000 },
    );

    for (const key of ['a', 's', 'd']) {
      await page.keyboard.down(key);
      await page.waitForTimeout(220);
      await page.keyboard.up(key);
      await page.waitForTimeout(80);
    }

    await page.click('[data-testid="btn-record"]');
    await expect(page.locator('[data-testid="btn-record"]')).toHaveAttribute('data-phase', 'idle', {
      timeout: 10000,
    });

    expect(await midiClipCount(page, 'Keys'), 'a take should become a clip').toBe(before + 1);

    const notes = await page.evaluate(() => {
      const w = window as unknown as {
        __ml?: { projectStore?: { getState: () => { project: unknown } } };
      };
      const project = w.__ml?.projectStore?.getState().project as {
        clips: { type: string; notes?: { pitch: number; length: number }[] }[];
      };
      const midi = project.clips.filter((c) => c.type === 'midi');
      return midi[midi.length - 1]?.notes ?? [];
    });
    expect(notes.length, 'three keys were played').toBe(3);
    expect(new Set(notes.map((n) => n.pitch)).size, 'three different pitches').toBe(3);
    expect(Math.min(...notes.map((n) => n.length)), 'a held key has real length').toBeGreaterThan(
      0,
    );
  });

  test('a take with nothing played leaves no clip behind', async ({ page }) => {
    await boot(page);
    const before = await midiClipCount(page, 'Keys');
    test.skip(before < 0, 'no store bridge or no Keys track in this build');

    await page.click('[data-testid="arm-Keys"]');
    await page.click('[data-testid="btn-record"]');
    await expect(page.locator('[data-testid="btn-record"]')).toHaveAttribute(
      'data-phase',
      'recording',
      { timeout: 15000 },
    );
    await page.waitForTimeout(400);
    await page.click('[data-testid="btn-record"]');
    await expect(page.locator('[data-testid="btn-record"]')).toHaveAttribute('data-phase', 'idle', {
      timeout: 10000,
    });

    expect(await midiClipCount(page, 'Keys')).toBe(before);
  });
});
