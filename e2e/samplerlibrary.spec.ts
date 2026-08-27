import { test, expect, type Browser, type Page } from '@playwright/test';
import { reach, reachableBox, RULER_SLACK, TOUCH_MIN } from './pointer';

/**
 * The sampler's library, driven by a finger.
 *
 * Loading one sample was solved. Managing a *set* was not: there was no rename,
 * no reorder, and on a quick sampler no list at all — so the only way to find
 * out what was loaded was to play it. Six operations, and every one of them has
 * to work by pointer on a phone, which is what this drives.
 *
 * Order is asserted rather than assumed decorative. `matchZones` returns every
 * zone whose key and velocity ranges contain the note and sums the overlaps in
 * list order, so which one is first is which one a key crossfade tapers from.
 */

async function samplerOnPhone(
  browser: Browser,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  // The sampler QA project, which is what `e2e/sampler.spec.ts` drives: it has
  // instruments already built, so this fixture is about the library rather than
  // about constructing a sampler from nothing.
  await page.goto('/#/qa-sampler');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 20000 });
  await page.waitForTimeout(800);

  // Two named zones on the first sampler track. A fixture step, not a claim:
  // which route reaches the sampler is `e2e/panematrix.spec.ts`'s subject, and
  // repeating it here would make every case below fail for that reason instead
  // of its own.
  await page.evaluate(() => {
    const w = window as unknown as {
      __ml?: {
        projectStore?: {
          getState: () => {
            project: { tracks: { id: string; name: string; sampler?: unknown }[] };
            setInstrument: (id: string, kind: string) => void;
            removeSamplerZones: (id: string, ids: string[]) => void;
            addSamplerZones: (id: string, zones: unknown[]) => string[];
          };
        };
        uiStore?: {
          getState: () => { selectTrack: (id: string) => void; set: (p: unknown) => void };
        };
      };
    };
    const st = w.__ml?.projectStore?.getState();
    const track = st?.project.tracks.find((t) => t.sampler);
    if (!st || !track) return;
    st.setInstrument(track.id, 'multi');
    const existing = w
      .__ml!.projectStore!.getState()
      .project.tracks.find((t) => t.id === track.id) as
      { sampler?: { zones: { id: string }[] } } | undefined;
    const ids = (existing?.sampler?.zones ?? []).map((z) => z.id);
    if (ids.length) st.removeSamplerZones(track.id, ids);
    const zone = (name: string, keyLo: number, keyHi: number) => ({
      id: `z-${name}`,
      name,
      mediaId: 'proc:perc-loop',
      keyLo,
      keyHi,
      velLo: 1,
      velHi: 127,
      rootNote: 60,
      keyTrack: true,
      startSec: 0,
      loop: false,
      reverse: false,
      oneShot: false,
      gain: 1,
      pan: 0,
      tuneCents: 0,
    });
    st.addSamplerZones(track.id, [zone('Alpha', 0, 63), zone('Beta', 64, 127)]);
    w.__ml?.uiStore?.getState().selectTrack(track.id);
  });

  // Navigated with a finger through the shell's own controls, because a spec
  // that reached the panel by calling a store would be asserting about a
  // surface a person may not be able to get to at all.
  // `nav-perform`, not the editor: on a phone the editor's tabs are piano,
  // drums, score, audio, chords and diagnostics — there is no synth tab, and
  // `docs/audit/REACHABILITY.md` records Perform as the phone's route to an
  // instrument. Guessing at the editor cost three runs before the matrix was
  // read, which is what the matrix is for.
  for (const testId of ['nav-perform', 'editor-tab-synth']) {
    const control = page.locator(`[data-testid="${testId}"]`);
    if (await control.isVisible().catch(() => false)) {
      await control.tap();
      await page.waitForTimeout(300);
    }
  }
  await page.waitForSelector('[data-testid="sampler-panel"]', { timeout: 15000 });
  await page.waitForSelector('[data-testid="sample-library"]', { timeout: 15000 });
  await page.waitForTimeout(300);
  return { page, close: () => ctx.close() };
}

/** The library's rows, in the order the instrument sums them. */
async function names(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLInputElement>('.smp-lib-name')].map((el) => el.value),
  );
}

test.describe('the sampler library, by finger', () => {
  test('says what is loaded', async ({ browser }) => {
    const { page, close } = await samplerOnPhone(browser);
    try {
      expect(await names(page)).toEqual(['Alpha', 'Beta']);
      await expect(page.locator('[data-testid="library-add"]')).toBeVisible();
    } finally {
      await close();
    }
  });

  test('every control in a row is big enough for a thumb', async ({ browser }) => {
    const { page, close } = await samplerOnPhone(browser);
    try {
      const row = page.locator('[data-testid="library-row"]').first();
      const small: string[] = [];
      for (const testId of [
        'library-up-z-Alpha',
        'library-down-z-Alpha',
        'library-preview-z-Alpha',
        'library-replace-z-Alpha',
        'library-remove-z-Alpha',
      ]) {
        const control = row.locator(`[data-testid="${testId}"]`);
        if (!(await control.isVisible().catch(() => false))) {
          small.push(`${testId} is not on screen`);
          continue;
        }
        // Measured, never read off the stylesheet: a declared inset is the
        // intended rectangle and not the reachable one, and inside a scroller
        // they are nowhere near each other.
        const box = await reachableBox(control);
        if (Math.min(box.width, box.height) < TOUCH_MIN - RULER_SLACK) {
          small.push(`${testId} is ${Math.round(box.width)}x${Math.round(box.height)}`);
        }
      }
      expect(small, `library controls under ${TOUCH_MIN}pt: ${small.join(', ')}`).toEqual([]);
    } finally {
      await close();
    }
  });

  test('reorder moves a sample, and the project agrees', async ({ browser }) => {
    const { page, close } = await samplerOnPhone(browser);
    try {
      await reach(
        page.locator('[data-testid="library-down-z-Alpha"]'),
        'touch',
        'the library move-later control',
      );
      await page.waitForTimeout(250);
      expect(await names(page)).toEqual(['Beta', 'Alpha']);

      // The rendered order is the model's order, not a view of its own: this is
      // the sum order the crossfade taper reads.
      const inModel = await page.evaluate(() => {
        const w = window as unknown as {
          __ml?: {
            projectStore?: {
              getState: () => {
                project: { tracks: { sampler?: { zones: { name: string }[] } }[] };
              };
            };
          };
        };
        const t = (w.__ml?.projectStore?.getState().project.tracks ?? []).find((x) => x.sampler);
        return (t?.sampler?.zones ?? []).map((z) => z.name);
      });
      expect(inModel).toEqual(['Beta', 'Alpha']);
    } finally {
      await close();
    }
  });

  test('rename sticks, and undo gives the old name back', async ({ browser }) => {
    const { page, close } = await samplerOnPhone(browser);
    try {
      const field = page.locator('[data-testid="library-name-z-Alpha"]');
      await field.tap();
      await field.fill('Kick In');
      await field.blur();
      await page.waitForTimeout(250);
      expect(await names(page)).toContain('Kick In');

      // A name is one decision somebody typed, which is why it is an undoable
      // action of its own rather than a call through the continuous path.
      await page.evaluate(() => {
        const w = window as unknown as {
          __ml?: { projectStore?: { getState: () => { undo: () => void } } };
        };
        w.__ml?.projectStore?.getState().undo();
      });
      await page.waitForTimeout(250);
      expect(await names(page)).toContain('Alpha');
    } finally {
      await close();
    }
  });

  test('remove takes it out of the set', async ({ browser }) => {
    const { page, close } = await samplerOnPhone(browser);
    try {
      await reach(
        page.locator('[data-testid="library-remove-z-Alpha"]'),
        'touch',
        'the library remove control',
      );
      await page.waitForTimeout(250);
      expect(await names(page)).toEqual(['Beta']);
    } finally {
      await close();
    }
  });

  test('an empty library says so rather than rendering nothing', async ({ browser }) => {
    const { page, close } = await samplerOnPhone(browser);
    try {
      for (const id of ['z-Alpha', 'z-Beta']) {
        await reach(
          page.locator(`[data-testid="library-remove-${id}"]`),
          'touch',
          `the library remove control for ${id}`,
        );
        await page.waitForTimeout(200);
      }
      // An empty library that renders nothing is indistinguishable from one
      // that has not loaded yet, and this instrument makes no sound until
      // something is in it.
      await expect(page.locator('[data-testid="library-empty"]')).toBeVisible();
      await expect(page.locator('[data-testid="library-add"]')).toBeVisible();
    } finally {
      await close();
    }
  });
});
