import { test, expect, type Browser, type Page } from '@playwright/test';
import { reach, reachableBox } from './pointer';

/**
 * MIDI effects have a home, and it is visible rather than discoverable.
 *
 * The arpeggiator, the chorder, the repeater and the note filter all existed and
 * had nowhere a person could get to. An earlier audit recorded them as reachable
 * in four steps with no signpost and deferred the fix — and "four steps with no
 * signpost" is the same thing as absent for anybody who does not already know
 * they are there. This is the assertion that stops it being deferred again.
 *
 * Three claims, on every form factor:
 *
 *  1. The rack is **on screen** on an instrument channel, reached from the
 *     console with no more than one signposted press. Named even when empty,
 *     because a rack that only appears once something is in it cannot tell you
 *     the thing exists.
 *  2. Its controls are reachable — pressed with the pointer the form factor
 *     actually has, and measured with `reachableBox` rather than a declared
 *     inset.
 *  3. Adding one changes the project, and the slot that appears carries the
 *     effect's name and its own bypass.
 *
 * And one claim that is not about MIDI FX at all: the rack must **not** appear
 * on a channel that receives no notes. A bus showing an empty "MIDI FX" header
 * teaches a signal path the product does not have.
 *
 * Claim 1 said "without opening anything" and now says "one signposted press",
 * and the difference is a form factor rather than a softening. The MIDI slots
 * live inside the console's device rack, and phase B's tier ladder takes that
 * rack off a strip once its 143 px floor stops fitting: a tablet at its default
 * split gives the console 280.8 px and the tier that keeps the rack needs 290.
 * What stands in its place is a chain summary that says what is on the channel
 * and opens it end to end — which is the difference between this and the
 * "four steps and no signpost" the first paragraph is about. Where the console
 * still draws a rack, nothing is pressed at all, and this asserts that too
 * rather than pressing everywhere for uniformity.
 */

interface Form {
  id: string;
  width: number;
  height: number;
  touch: boolean;
}

const FORMS: Form[] = [
  { id: 'phone-portrait', width: 390, height: 844, touch: true },
  { id: 'tablet-portrait', width: 768, height: 1024, touch: true },
  { id: 'desktop', width: 1440, height: 900, touch: false },
];

/** The touch minimum, and the height the rack rows take on a coarse pointer. */
const MIN_TOUCH = 44;

async function openMixer(browser: Browser, form: Form) {
  const ctx = await browser.newContext({
    viewport: { width: form.width, height: form.height },
    hasTouch: form.touch,
    isMobile: form.touch,
    deviceScaleFactor: form.touch ? 2 : 1,
  });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 20000 });
  await page.waitForTimeout(400);
  // Through the shell's own control where the shell has one. A spec that
  // navigated by calling a store would be asserting about a surface a person
  // may not be able to reach.
  const nav = page.locator('[data-testid="nav-mix"]');
  if (await nav.isVisible().catch(() => false)) {
    await reach(nav, form.touch ? 'touch' : 'mouse', `${form.id}: the mixer tab`);
  }
  await page.waitForSelector('[data-testid="mixer"]', { timeout: 10000 });
  await page.waitForTimeout(300);
  return { page, close: () => ctx.close() };
}

/**
 * Where this form factor's MIDI FX rack is, having gone there.
 *
 * Returns the container the rack is in and whether a press was needed. Deciding
 * by looking rather than by form-factor name: the tier ladder reads the
 * console's height, and a name is a proxy for that which would go stale the
 * first time a pane's default split moved.
 */
async function noteFxHome(page: Page, hand: 'touch' | 'mouse') {
  // Asked of the RACK, not of the strip that holds it. A strip whose device
  // rack the ladder has hidden is still perfectly visible, so gating on the
  // strip took the console branch on exactly the form factor this helper exists
  // for and then failed three lines later on an element nobody can see.
  const onConsole = page.locator('.strip [data-testid="notefx-slots"]').first();
  if (await onConsole.isVisible().catch(() => false)) {
    return {
      host: page.locator('.strip:has([data-testid="notefx-slots"])').first(),
      pressed: false,
    };
  }

  // No rack on this console, so the summary that replaced it is the signpost.
  // It has to be on screen and pressable: a home reached by knowing where it is
  // is the thing this file exists to prevent.
  const summary = page.locator('[data-strip="channel"] .strip-chain').first();
  await expect(
    summary,
    'this console draws neither a MIDI FX rack nor the chain summary that replaces it, ' +
      'so a MIDI effect has no home on this form factor at all',
  ).toBeVisible({ timeout: 10000 });
  await reach(summary, hand, 'the chain summary');
  await page.waitForTimeout(500);

  const inView = page.locator('[data-testid="channel-view"]');
  await expect(inView).toBeVisible({ timeout: 10000 });
  await expect(
    inView.locator('[data-testid="notefx-slots"]'),
    'the channel opened and has no MIDI FX rack in it',
  ).toBeVisible({ timeout: 10000 });
  return { host: inView, pressed: true };
}

test.describe('the MIDI FX rack is on the channel', () => {
  for (const form of FORMS) {
    test(`${form.id}: it is on screen, or one signposted press away`, async ({ browser }) => {
      const { page, close } = await openMixer(browser, form);
      try {
        const { host } = await noteFxHome(page, form.touch ? 'touch' : 'mouse');
        const rack = host.locator('[data-testid="notefx-slots"]').first();
        await expect(rack).toBeVisible();
        await expect(
          rack.locator('.dev-notefx-head'),
          'the rack must be named even when empty: a rack that appears only once ' +
            'something is in it cannot tell you the thing exists',
        ).toHaveText('MIDI FX');

        const add = host.locator('[data-testid="notefx-add"]').first();
        await expect(add).toBeVisible();
        if (form.touch) {
          const box = await reachableBox(add);
          expect(
            Math.min(box.width, box.height),
            `${form.id}: the add control measures ${Math.round(box.width)}x${Math.round(box.height)} ` +
              `where a finger needs ${MIN_TOUCH}`,
          ).toBeGreaterThanOrEqual(MIN_TOUCH - 0.5);
        }
      } finally {
        await close();
      }
    });

    test(`${form.id}: a MIDI effect can be added and appears in the rack`, async ({ browser }) => {
      const { page, close } = await openMixer(browser, form);
      try {
        const { host } = await noteFxHome(page, form.touch ? 'touch' : 'mouse');
        const before = await page.evaluate(() => {
          const w = window as unknown as {
            __ml?: {
              projectStore?: {
                getState: () => { project: { tracks: { noteFx?: unknown[] }[] } };
              };
            };
          };
          return (w.__ml?.projectStore?.getState().project.tracks ?? []).reduce(
            (n, t) => n + (t.noteFx?.length ?? 0),
            0,
          );
        });

        await reach(
          host.locator('[data-testid="notefx-add"]').first(),
          form.touch ? 'touch' : 'mouse',
          `${form.id}: the MIDI FX add control`,
        );
        const item = page.getByRole('menuitem', { name: 'Arpeggiator' }).first();
        const fallback = page.locator('text=Arpeggiator').first();
        const target = (await item.isVisible().catch(() => false)) ? item : fallback;
        await reach(target, form.touch ? 'touch' : 'mouse', `${form.id}: the Arpeggiator entry`);
        await page.waitForTimeout(400);

        const after = await page.evaluate(() => {
          const w = window as unknown as {
            __ml?: {
              projectStore?: {
                getState: () => { project: { tracks: { noteFx?: unknown[] }[] } };
              };
            };
          };
          return (w.__ml?.projectStore?.getState().project.tracks ?? []).reduce(
            (n, t) => n + (t.noteFx?.length ?? 0),
            0,
          );
        });
        expect(
          after,
          `${form.id}: adding an Arpeggiator changed no note chain in the project`,
        ).toBe(before + 1);
      } finally {
        await close();
      }
    });
  }

  test('a channel that receives no notes has no MIDI rack', async ({ browser }) => {
    const { page, close } = await openMixer(browser, FORMS[2]);
    try {
      const wrong = await page.evaluate(() => {
        const out: string[] = [];
        for (const strip of document.querySelectorAll('.strip')) {
          if (!strip.querySelector('[data-testid="notefx-slots"]')) continue;
          // A strip that plays notes shows an instrument slot above its
          // inserts; one that does not is a bus, an FX return or the master.
          if (!strip.querySelector('.dev-instrument')) {
            out.push(strip.querySelector('.strip-name')?.textContent?.trim() ?? '?');
          }
        }
        return out;
      });
      expect(
        wrong,
        `these channels receive no notes and are showing a MIDI FX rack, which teaches a ` +
          `signal path the product does not have: ${wrong.join(', ')}`,
      ).toEqual([]);
    } finally {
      await close();
    }
  });
});
