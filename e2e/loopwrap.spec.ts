import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * A clip longer than the loop must not stack up on itself.
 *
 * The scheduler re-enters whatever is sounding at the loop start on every
 * wrap, which is right — the material under the loop point has to be heard.
 * What was missing is the other half: nothing stopped the pass that was still
 * playing, so a clip that spans the loop end had one voice per lap.
 */
const preinstalledChromium = '/opt/pw-browsers/chromium';
test.use({
  launchOptions: {
    executablePath: existsSync(preinstalledChromium) ? preinstalledChromium : undefined,
    args: ['--autoplay-policy=no-user-gesture-required'],
  },
});

async function boot(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
  await page.waitForFunction(() => '__ml' in window, { timeout: 15000 });
}

/** A project with one long note over a short loop, so every lap re-enters it. */
async function loopOverLongMaterial(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __ml: {
        demoProject: typeof import('../src/model/demoProject');
        projectStore: { getState(): { setProject(p: unknown, o?: unknown): void } };
      };
    };
    const p = w.__ml.demoProject.createEmptyProject('Loop wrap');
    const track = p.tracks[0];
    track.type = 'instrument';
    p.loop = { enabled: true, start: 0, end: 2 };
    p.clips = [
      {
        id: 'c1',
        trackId: track.id,
        type: 'midi',
        name: 'held',
        start: 0,
        length: 32,
        muted: false,
        // One very long note: on each lap the scheduler must re-enter it, and
        // the previous lap's voice must go.
        notes: [{ id: 'n1', pitch: 57, start: 0, length: 32, velocity: 100 }],
      },
    ];
    w.__ml.projectStore.getState().setProject(p, { markClean: true });
  });
}

const sources = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __ml?: { activeSources?: () => number } };
    return w.__ml?.activeSources?.() ?? -1;
  });

test('a clip longer than the loop does not stack a voice per lap', async ({ page }) => {
  await boot(page);
  await page.click('[data-testid="app-root"]');
  await loopOverLongMaterial(page);
  await page.waitForTimeout(300);

  await page.click('[data-testid="btn-play"]');
  // A 2-beat loop at 120 bpm is one second a lap. Six seconds is six laps.
  await page.waitForTimeout(1200);
  const early = await sources(page);
  await page.waitForTimeout(4800);
  const late = await sources(page);
  await page.click('[data-testid="btn-stop"]');

  expect(early, 'no probe or nothing playing').toBeGreaterThan(0);
  // Without the wrap cleanup this climbs by one voice per lap; the exact
  // count depends on the lookahead, so the assertion is on growth, not on a
  // magic number.
  expect(late, `voices grew from ${early} to ${late} over five laps`).toBeLessThanOrEqual(
    early + 1,
  );
});
