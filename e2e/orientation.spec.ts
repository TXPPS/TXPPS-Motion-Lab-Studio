/**
 * Directive 02 §4 — the orientation, modal and plugin-editor guards.
 *
 * `scripts/overflow-audit.mjs` walks the whole matrix and reports what it
 * measures; this file is the narrow half of the same work — the handful of
 * claims that must not regress once they are fixed, written as assertions a
 * browser can settle. It follows `e2e/trackheader.spec.ts`: geometry belongs in
 * a real engine, because jsdom lays nothing out and would pass whatever the CSS
 * said.
 *
 * Six of these describe defects that are open at the time of writing, so they
 * carry `test.fail()` and name the ticket in `docs/audit/RESPONSIVE_AUDIT.md`.
 * That annotation is not a way of ignoring them: Playwright fails a `test.fail()`
 * test that *passes*, so the day a fix lands the suite says so by name and the
 * annotation comes off. Deleting the `test.fail()` line is the last step of each
 * fix, not an optional tidy-up.
 */
import { expect, test, type Page } from '@playwright/test';

/** The touch minimum the directive sets, in CSS pixels. */
const MIN_TOUCH = 44;

const PHONES = [
  { name: 'small', portrait: { width: 360, height: 740 } },
  { name: 'standard', portrait: { width: 390, height: 844 } },
  { name: 'large', portrait: { width: 430, height: 932 } },
] as const;

const rotate = (v: { width: number; height: number }) => ({ width: v.height, height: v.width });

async function boot(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('motionlab.prefs.v1', JSON.stringify({ theme: 'dark', uiScale: 1 }));
      localStorage.setItem('txpps-motionlab-welcome-v1', '1');
    } catch {
      /* storage disabled — the defaults are close enough for geometry */
    }
  });
  await page.goto('/#/song');
  await page.waitForSelector('[data-testid="app-root"]');
  await page.waitForTimeout(600);
}

/**
 * How much of the arrangement a user lands on.
 *
 * The ruler and marker rows live *inside* the lane scroller, so they are part
 * of what the first screenful is spent on. Measuring from the lanes' offset in
 * the scroll content rather than from their current rect keeps the answer
 * independent of whatever an earlier gesture scrolled to — the number that
 * matters is the one at scrollTop 0, which is where the workspace opens.
 */
async function wholeTrackRowsVisible(page: Page): Promise<number> {
  return page.evaluate(() => {
    const scroll = document.querySelector('[data-testid="arr-scroll"]');
    const lanes = document.querySelector('.arr-lanes');
    const header = document.querySelector('[data-testid^="track-header-"]');
    if (!scroll || !lanes || !header) return -1;
    const offset =
      lanes.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
    const rowH = header.getBoundingClientRect().height;
    if (rowH < 1) return -1;
    return Math.floor(Math.max(0, scroll.clientHeight - offset) / rowH);
  });
}

test.describe('landscape is an arrangement, not a squashed portrait', () => {
  for (const phone of PHONES) {
    test(`a ${phone.name} phone in landscape opens on at least one whole track`, async ({
      browser,
    }) => {
      // RA-001. Nothing in the layout answers orientation — there is no
      // `@media (orientation: …)` rule in the product and `useViewport` keys
      // off size alone — so a rotated phone is the portrait arrangement with
      // 380px less height, and the chrome eats all of it. The largest phone
      // scrapes one row and so clears this floor; the comparison test below is
      // what catches it.
      if (phone.name !== 'large') test.fail();
      const context = await browser.newContext({
        viewport: rotate(phone.portrait),
        hasTouch: true,
      });
      const page = await context.newPage();
      await boot(page);
      const rows = await wholeTrackRowsVisible(page);
      expect(
        rows,
        'no track row is fully on screen when the workspace opens',
      ).toBeGreaterThanOrEqual(1);
      await context.close();
    });

    test(`a ${phone.name} phone loses no more than half its tracks to rotation`, async ({
      browser,
    }) => {
      // RA-001, the comparison that answers the directive's question. A real
      // landscape arrangement rearranges to keep the work visible; a squashed
      // one just shows a fraction of the same rows.
      test.fail();
      const portrait = await browser.newContext({ viewport: phone.portrait, hasTouch: true });
      const pPage = await portrait.newPage();
      await boot(pPage);
      const upright = await wholeTrackRowsVisible(pPage);
      await portrait.close();

      const landscape = await browser.newContext({
        viewport: rotate(phone.portrait),
        hasTouch: true,
      });
      const lPage = await landscape.newPage();
      await boot(lPage);
      const rotated = await wholeTrackRowsVisible(lPage);
      await landscape.close();

      expect(
        upright,
        'portrait shows no tracks either — the comparison is meaningless',
      ).toBeGreaterThan(1);
      expect(
        rotated,
        `portrait shows ${upright} whole rows, landscape ${rotated}`,
      ).toBeGreaterThanOrEqual(Math.floor(upright / 2));
    });
  }
});

test.describe('the track header row fits the controls it was given', () => {
  for (const phone of PHONES) {
    for (const orientation of ['portrait', 'landscape'] as const) {
      test(`${phone.name} phone, ${orientation}: no header control is cut off`, async ({
        browser,
      }) => {
        // RA-002, fixed. `@media (pointer: coarse)` grew the mute/solo/arm
        // strip to 44px so a finger could hit it, but the lane row it lives in
        // is a constant 64px (`LANE_H` in Arrangement.tsx) and `.th` clips, so
        // 25 of the strip's 44px were off screen. Two stacked 44px rows need
        // 88, so row 1 gave up its buttons: 2 padding + 18 name + 44 strip is
        // 64 exactly. This guards the arithmetic, which is the part that will
        // break again the moment anything is added back to row 1.
        const context = await browser.newContext({
          viewport: orientation === 'portrait' ? phone.portrait : rotate(phone.portrait),
          hasTouch: true,
        });
        const page = await context.newPage();
        await boot(page);
        const cut = await page.evaluate(() => {
          const out: string[] = [];
          for (const th of document.querySelectorAll('[data-testid^="track-header-"]')) {
            if (th.scrollHeight > th.clientHeight + 1) {
              out.push(
                `${th.getAttribute('data-testid')}: needs ${th.scrollHeight}px, has ${th.clientHeight}px`,
              );
            }
          }
          // One line per distinct shortfall: eight identical headers are one bug.
          return [...new Set(out.map((s) => s.replace(/^[^:]+/, 'header')))];
        });
        expect(cut, cut.join('\n')).toEqual([]);
        await context.close();
      });
    }
  }
});

test.describe('a plugin editor opens where it can be used', () => {
  const CELLS = [
    { name: 'phone portrait', viewport: { width: 360, height: 740 }, touch: true },
    { name: 'phone landscape', viewport: { width: 740, height: 360 }, touch: true },
    { name: 'tablet portrait', viewport: { width: 768, height: 1024 }, touch: true },
    { name: 'laptop', viewport: { width: 1280, height: 800 }, touch: false },
  ] as const;

  for (const cell of CELLS) {
    test(`${cell.name}: the device window opens inside the viewport`, async ({ browser }) => {
      // RA-003. `DEFAULT_POS` in PluginWindow.tsx is a constant {x: 220, y: 120}
      // and the window has `min-width: 320px`, so on anything narrower than
      // 540px the editor opens mostly off the right edge. `max-width` cannot
      // save it: the window is placed, not laid out.
      // A landscape phone is wide enough for the window and 240px too short
      // for it, so the cell is keyed by form factor rather than by width.
      // Fixed: `windowPlace.ts` measures the window against the viewport
      // instead of opening it at a constant, and re-places it on resize and
      // orientationchange so a rotation cannot strand it either.
      const context = await browser.newContext({
        viewport: cell.viewport,
        hasTouch: cell.touch,
      });
      const page = await context.newPage();
      await boot(page);
      await openFirstDevice(page);

      const win = page.locator('[data-testid="plugin-window"]');
      await expect(win).toBeVisible();
      const box = (await win.boundingBox())!;
      expect(box).not.toBeNull();
      const over = {
        right: Math.round(box.x + box.width - cell.viewport.width),
        bottom: Math.round(box.y + box.height - cell.viewport.height),
        left: Math.round(-box.x),
        top: Math.round(-box.y),
      };
      expect(
        Math.max(over.right, over.bottom, over.left, over.top),
        `window ${Math.round(box.width)}x${Math.round(box.height)} at ` +
          `${Math.round(box.x)},${Math.round(box.y)} overhangs ${JSON.stringify(over)}`,
      ).toBeLessThanOrEqual(0);
      await context.close();
    });
  }

  test('the device window header meets the touch minimum on a phone', async ({ browser }) => {
    // RA-005. The close button is 17x17 and the bypass lamp 10x10; on a touch
    // screen the only way to shut a plugin editor is a keyboard Escape, which
    // a phone does not have while the window is open.
    test.fail();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const page = await context.newPage();
    await boot(page);
    await openFirstDevice(page);

    const small = await page.evaluate((min) => {
      const win = document.querySelector('[data-testid="plugin-window"]');
      if (!win) return ['no plugin window'];
      const out: string[] = [];
      for (const el of win.querySelectorAll('header button, header select')) {
        const r = el.getBoundingClientRect();
        if (r.width < min || r.height < min) {
          out.push(`${el.className || el.tagName}: ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return out;
    }, MIN_TOUCH);
    expect(small, small.join('\n')).toEqual([]);
    await context.close();
  });
});

test.describe('sheets stay inside the screen and can be got rid of', () => {
  const SHEETS = [
    { menu: 'Preferences', sel: '[data-testid="settings-sheet"]' },
    { menu: 'Export…', sel: '[data-testid="export-sheet"]' },
    { menu: 'Keyboard shortcuts', sel: '[data-testid="shortcuts-sheet"]' },
    { menu: 'Diagnostics', sel: '[data-testid="diagnostics-sheet"]' },
  ] as const;

  for (const size of [
    { name: 'phone landscape', width: 740, height: 360 },
    { name: 'split-screen third', width: 341, height: 768 },
  ]) {
    test(`${size.name}: every sheet fits and closes`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        hasTouch: true,
      });
      const page = await context.newPage();
      await boot(page);

      for (const sheet of SHEETS) {
        await openFromOverflow(page, sheet.menu);
        const box = await page.locator(sheet.sel).boundingBox();
        expect(box, `${sheet.menu} never opened`).not.toBeNull();
        expect(box!.x, `${sheet.menu} starts off the left edge`).toBeGreaterThanOrEqual(-1);
        expect(box!.y, `${sheet.menu} starts above the top edge`).toBeGreaterThanOrEqual(-1);
        expect(box!.x + box!.width, `${sheet.menu} runs past the right edge`).toBeLessThanOrEqual(
          size.width + 1,
        );
        expect(box!.y + box!.height, `${sheet.menu} runs past the bottom edge`).toBeLessThanOrEqual(
          size.height + 1,
        );
        // The control the sheet offers, not the keyboard: a phone has no
        // Escape key, so the close button is the dismissal that has to work.
        await page.locator(`${sheet.sel} [aria-label^="Close"]`).first().click();
        await expect(page.locator(sheet.sel), `${sheet.menu} would not close`).toHaveCount(0);
      }
      await context.close();
    });
  }

  test('every sheet closes on Escape', async ({ browser }) => {
    // RA-016. Preferences, Export and Keyboard shortcuts each install their own
    // Escape handler; the Diagnostics sheet installs none, and the global
    // Escape ladder in useKeyboard.ts only knows about `dialog` and
    // `contextMenu`, so `diagnosticsOpen` is not in the list of overlays a
    // press closes.
    test.fail();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await boot(page);
    const survived: string[] = [];
    for (const sheet of SHEETS) {
      await openFromOverflow(page, sheet.menu);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      if (await page.locator(sheet.sel).count()) {
        survived.push(sheet.menu);
        await page.locator(`${sheet.sel} [aria-label^="Close"]`).first().click();
      }
    }
    expect(survived, `these sheets ignored Escape: ${survived.join(', ')}`).toEqual([]);
    await context.close();
  });

  test('the keyboard shortcuts sheet can be read to its end', async ({ browser }) => {
    // RA-004. `.sc-sheet` is declared twice — the shortcuts sheet in
    // panels.css and the score's staff paper in score.css — and score.css is
    // imported later, so its `display: block` wins. The sheet stops being a
    // column flex container, `.sc-body` is never given a bounded height, and
    // the sheet's own `overflow: hidden` cuts roughly 1100px of shortcuts off
    // with nothing to scroll. This one is not viewport-specific: it is wrong
    // on a 2560px desktop too.
    //
    // Fixed by giving the shortcuts sheet its own prefix — `ks-`, since the
    // score owns `sc-` with fifty classes to this one's seven. The selectors
    // below moved with it: querying `.sc-sheet` here now finds the score's
    // staff paper, which is a different component that happens to satisfy
    // nothing this test is asking about.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await boot(page);
    await openFromOverflow(page, 'Keyboard shortcuts');

    const reach = await page.evaluate(() => {
      const sheet = document.querySelector('.ks-sheet');
      const body = document.querySelector('.ks-body');
      if (!sheet || !body) return null;
      return {
        sheetH: sheet.clientHeight,
        bodyH: body.clientHeight,
        bodyScrollH: body.scrollHeight,
        sheetScrollH: sheet.scrollHeight,
      };
    });
    expect(reach, 'the shortcuts sheet did not open').not.toBeNull();
    // The body is what scrolls, so it must be no taller than the sheet holding it.
    expect(
      reach!.bodyH,
      `the shortcuts list is ${reach!.bodyH}px tall inside a ${reach!.sheetH}px sheet, ` +
        `and the sheet clips ${reach!.sheetScrollH - reach!.sheetH}px away`,
    ).toBeLessThanOrEqual(reach!.sheetH);
    await context.close();
  });
});

/** Open the overflow menu and choose one of its items. */
async function openFromOverflow(page: Page, item: string) {
  await page.locator('[data-testid="topbar-overflow"]').first().click();
  await page.locator('.ctx-menu [role="menuitem"]').filter({ hasText: item }).first().click();
  await page.waitForTimeout(350);
}

/**
 * Put a device on a channel and open its editor.
 *
 * The picker is opened with a scripted `click()` rather than a pointer press
 * on purpose: pressing a strip selects the channel, selecting a channel mounts
 * the Channel Overview beside the strips, and the reflow moves the rack's
 * 12px-tall `Insert` button out from under the pointer before the press is
 * released. That is RA-006, and it is measured there; here it would only make
 * this test flaky about a different bug.
 */
async function openFirstDevice(page: Page) {
  const layout = await page.getAttribute('[data-testid="app-root"]', 'data-layout');
  const toMixer =
    layout === 'phone'
      ? '[data-testid="nav-mix"]'
      : layout === 'tablet'
        ? '[data-testid="combo-mixer"]'
        : '[data-testid="editor-tab-mixer"]';
  await page.locator(toMixer).first().click();
  await page.waitForTimeout(400);
  const add = page.locator('[data-testid^="device-add-"]').first();
  await add.evaluate((el: HTMLElement) => el.click());
  await page.waitForTimeout(250);
  await page
    .locator('.ctx-menu [role="menuitem"]')
    .filter({ hasText: 'Compressor' })
    .first()
    .click();
  await page.waitForTimeout(500);
}
