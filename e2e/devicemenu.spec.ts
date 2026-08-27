import { test, expect, type Page, type BrowserContext, type Browser } from '@playwright/test';
import { reach, landing, reachableBox, type Hand } from './pointer';

/**
 * A plugin on an insert has options on every form factor — proven with a hand.
 *
 * Reported from real use: *"I have no three-dot, remove or move controls for a
 * plugin on an insert on mobile."* Three separate reasons, all of them true at
 * once, and none of them visible to a test that opens the menu with
 * `el.click()`:
 *
 *  1. `.dev-menu` is `opacity: 0` and the only rule that revealed it was
 *     `.dev-slot:hover`. Nothing on a touch device hovers, so on a phone the
 *     button was permanently invisible.
 *  2. The `@media (pointer: coarse)` block gave it `min-height: 44px` inside a
 *     16px row. It overflowed into the two rows below it, and three of them at
 *     a 16px pitch meant the topmost took every press: measured, a finger at
 *     the centre of the first device's options button landed on the third
 *     device's icon.
 *  3. `.dev-slot` is `flex-wrap: wrap` for the Micro View, and once the button
 *     was 44px wide the name's `flex-basis: auto` pushed it onto a second line
 *     — 47px below its own slot, on top of the Insert button. A finger aimed
 *     at the options menu inserted a device.
 *
 * The old test passed through all three because `el.click()` invokes a handler
 * without asking whether anything is on top, whether the control can be seen,
 * or whether the gesture would reach it. So every assertion here goes through
 * `e2e/pointer.ts`, which lands on coordinates with the right `pointerType`.
 *
 * WCAG 2.5.8's equivalent-alternative exception is what lets the 5px power
 * lamp and the 12px name exist on a desktop at all: they are exempt while the
 * same functions are reachable through a control that meets the minimum. This
 * menu is that control, which makes two things load-bearing rather than nice —
 * that it carries *every* command the inline controls offer, and that its own
 * entries are big enough. Both are asserted below.
 */

/** The touch minimum, the same number the responsive audit uses. */
const MIN_TOUCH = 44;

interface Form {
  id: string;
  width: number;
  height: number;
  hand: Hand;
  nav: string;
}

/**
 * The three form factors the product claims, each pressed by its own hand.
 *
 * A phone case that sends mouse events is not a phone case. `hasTouch` is what
 * makes `(pointer: coarse)` match and what `locator.tap()` needs, so the two
 * travel together.
 */
const FORMS: Form[] = [
  { id: 'phone', width: 390, height: 844, hand: 'touch', nav: '[data-testid="nav-mix"]' },
  { id: 'tablet', width: 768, height: 1024, hand: 'touch', nav: '[data-testid="combo-mixer"]' },
  {
    id: 'desktop',
    width: 1440,
    height: 900,
    hand: 'mouse',
    nav: '[data-testid="editor-tab-mixer"]',
  },
];

async function open(browser: Browser, form: Form): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    viewport: { width: form.width, height: form.height },
    hasTouch: form.hand === 'touch',
    isMobile: form.hand === 'touch',
    deviceScaleFactor: form.hand === 'touch' ? 2 : 1,
  });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 20000 });
  await page.waitForTimeout(500);
  await page.locator(form.nav).first().click();
  await page.waitForTimeout(500);

  /*
   * Every claim in this file is about the CONSOLE rack, so the console has to
   * be showing one.
   *
   * At a tablet's default split the mixer gets 280.8 px and the rack's coarse
   * floor is 290, so the tier ladder draws the chain summary in its place and
   * a tablet's chain lives in the Channel view. Full screen is the product's
   * own one-tap answer to "I want more console" — it gives the mixer 801 px
   * and the rack comes back — so this is a fixture step and not a workaround.
   *
   * It is also what caught the failure late and confusingly the first time: a
   * hidden row is still in the DOM, so `addDevice`'s `el.click()` on the
   * Insert button went on working and the assertions failed three steps later
   * against controls nobody could see. Asking for a *visible* one is the check.
   */
  const insert = page.locator('[data-testid^="device-add-"]:visible');
  if ((await insert.count()) === 0) {
    const maxi = page.locator('[data-testid="maximize-editor"]');
    if (await maxi.isVisible().catch(() => false)) {
      await maxi.click();
      await page.waitForTimeout(600);
    }
  }
  await expect(
    insert.first(),
    `${form.id}: no console rack on screen even at full screen, so this file has no subject`,
  ).toBeVisible({ timeout: 10000 });
  return { ctx, page };
}

/**
 * Put one device on the first channel rack, and leave the console showing.
 *
 * This one *is* `el.click()`, deliberately: it is arranging the fixture, not
 * asserting that anything is reachable. The distinction is the whole rule —
 * a setup step may use whatever gets there, and an assertion may not.
 */
async function addDevice(
  page: Page,
  kind = 'Compressor',
  opts: { keepWindow?: boolean } = {},
): Promise<string> {
  const names = await page
    .locator('[data-testid^="device-add-"]:visible')
    .evaluateAll((els) =>
      els.map((e) => (e.getAttribute('data-testid') ?? '').replace('device-add-', '')),
    );
  const rack = names.find((n) => n && n !== 'Master');
  if (!rack) throw new Error(`no channel rack on screen; saw ${JSON.stringify(names)}`);
  const add = page.locator(`[data-testid="device-add-${rack}"]`);
  await add.scrollIntoViewIfNeeded();
  await add.evaluate((el: HTMLElement) => el.click());
  await page.waitForTimeout(250);
  await page
    .locator('.ctx-menu [role="menuitem"]')
    .filter({ hasText: new RegExp(`^${kind}$`) })
    .first()
    .click();
  await page.waitForTimeout(500);
  // Adding opens the device window over the console. The rack is usually the
  // subject, so it goes — except where the window being open is the point.
  if (!opts.keepWindow) {
    await page
      .locator('.pw-close')
      .first()
      .click({ timeout: 2000 })
      .catch(() => {});
  }
  await page.waitForTimeout(400);
  return rack;
}

for (const form of FORMS) {
  test.describe(`${form.id} — a device's options are reachable by ${form.hand}`, () => {
    test(`a real ${form.hand} press opens the options menu`, async ({ browser }) => {
      const { ctx, page } = await open(browser, form);
      const rack = await addDevice(page);
      const menu = page.locator(`[data-testid="device-menu-${rack}-1"]`);

      await expect(menu, 'the device has no options button at all').toHaveCount(1);

      // Seen before it is pressed. A button at `opacity: 0` is operable and
      // undiscoverable, which on a phone — where nothing hovers — is the same
      // as absent. On a desktop the rack reveals it on hover, so it is asked
      // for that way; the reveal is the assertion either way.
      if (form.hand === 'touch') {
        const opacity = await menu.evaluate((el) => getComputedStyle(el).opacity);
        expect(
          Number(opacity),
          'the options button is transparent, and nothing on a touch device hovers',
        ).toBeGreaterThan(0.9);
      } else {
        await page.locator('.dev-slot').first().hover();
        await page.waitForTimeout(120);
        const opacity = await menu.evaluate((el) => getComputedStyle(el).opacity);
        expect(Number(opacity), 'hovering the row does not reveal its options').toBeGreaterThan(
          0.9,
        );
      }

      await reach(menu, form.hand, `${form.id}: the device options button`);
      await page.waitForTimeout(300);

      const items = await page
        .locator('.ctx-menu [role="menuitem"]')
        .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
      for (const required of ['Open', 'Bypass', 'Move up', 'Move down', 'Remove']) {
        expect(items, `"${required}" is not in the menu on ${form.id}`).toContain(required);
      }
      await ctx.close();
    });

    test('every entry in the menu is big enough to be the alternative', async ({ browser }) => {
      const { ctx, page } = await open(browser, form);
      const rack = await addDevice(page);
      await reach(
        page.locator(`[data-testid="device-menu-${rack}-1"]`),
        form.hand,
        `${form.id}: the device options button`,
      );
      await page.waitForTimeout(300);

      /*
       * 44 on a finger, 24 on a pointer.
       *
       * These are the two numbers WCAG 2.5 actually states — 2.5.5 for touch
       * and 2.5.8 for anything else — and the exception that exempts the 5px
       * power lamp is only granted while this menu clears them. Asserting 44
       * on a desktop would be asserting a phone menu on a desk; asserting 24
       * on a phone would be asserting nothing.
       */
      const floor = form.hand === 'touch' ? MIN_TOUCH : 24;
      const small = await page.locator('.ctx-menu [role="menuitem"]').evaluateAll(
        (els, min) =>
          els
            .map((e) => ({ t: (e.textContent ?? '').trim(), r: e.getBoundingClientRect() }))
            .filter(({ r }) => r.height < min || r.width < min)
            .map(({ t, r }) => `"${t}" is ${Math.round(r.width)}x${Math.round(r.height)}`),
        floor,
      );
      expect(small, `under ${floor}px on ${form.id}:\n${small.join('\n')}`).toEqual([]);
      await ctx.close();
    });

    test('nothing in the rack takes a press meant for its neighbour', async ({ browser }) => {
      const { ctx, page } = await open(browser, form);
      const rack = await addDevice(page);

      /*
       * The failure mode the 44px rule created rather than fixed.
       *
       * A target grown past the row that holds it does not become easier to
       * hit — it becomes a target for somebody else's press, silently, and the
       * user's report reads as "the button does nothing". So every control in
       * the rack is asked what a press at its own centre finds, and the answer
       * has to be itself.
       */
      const covered: string[] = [];
      const controls = [
        `[data-testid="device-menu-${rack}-1"]`,
        `[data-testid="device-${rack}-1"] .dev-name`,
        `[data-testid="device-add-${rack}"]`,
      ];
      for (const sel of controls) {
        const el = page.locator(sel).first();
        if ((await el.count()) === 0) continue;
        // A control hidden on this form factor is not covered — it is gone,
        // and its commands live in the menu. `.dev-power` is exactly that.
        if (!(await el.isVisible())) continue;
        const l = await landing(el);
        if (!l.onTarget) covered.push(`${sel} -> ${l.found}`);
      }
      expect(covered, `these presses go to the wrong control:\n${covered.join('\n')}`).toEqual([]);
      await ctx.close();
    });

    test('the options button is as big as it says it is', async ({ browser }) => {
      const { ctx, page } = await open(browser, form);
      const rack = await addDevice(page);
      await addDevice(page, 'Limiter');
      const menu = page.locator(`[data-testid="device-menu-${rack}-1"]`);
      await menu.scrollIntoViewIfNeeded();

      /*
       * Declared and delivered, side by side.
       *
       * A console rack cannot give a device row a 44px target on a desktop —
       * four devices in 88px is what a rack *is* — so the honest floor here is
       * the row it lives in: 20 wide by the row's own 16 tall. What is not
       * negotiable is that the number be true. `.dev-power` declared 44 x 44
       * through an `::after` and delivered 16 x 16, then 1 x 1 once a second
       * device was on the channel, and the declaration is exactly what stopped
       * anybody measuring.
       */
      const box = (await menu.boundingBox())!;
      const real = await reachableBox(menu);
      const floor = form.hand === 'touch' ? MIN_TOUCH : 16;
      expect(
        Math.min(real.width, real.height),
        `${form.id}: the options button reaches ${real.width}x${real.height}, under ${floor}`,
      ).toBeGreaterThanOrEqual(floor);
      // Within a pixel of its own box: bigger means it is taking a neighbour's
      // presses, smaller means something is clipping or covering it.
      expect(
        Math.abs(real.width - box.width) + Math.abs(real.height - box.height),
        `${form.id}: it is drawn ${Math.round(box.width)}x${Math.round(box.height)} and reaches ` +
          `${real.width}x${real.height} — the number in the report would be the wrong one`,
      ).toBeLessThanOrEqual(2);
      await ctx.close();
    });

    test('a press on one device does not act on another', async ({ browser }) => {
      const { ctx, page } = await open(browser, form);
      const rack = await addDevice(page, 'Compressor');
      await addDevice(page, 'Limiter');
      await addDevice(page, 'Gate');

      /*
       * The strongest form of the question, and the one that found it.
       *
       * Geometry says a control is the right size; a hit test says the press
       * lands on it. Neither says the press did what it was aimed at. This
       * asks the project: bypass device *n*, and device *n* had better be the
       * one that went off.
       *
       * Measured before the fix, on a desktop with three inserts: aiming at
       * the first device's power lamp bypassed the **second**. `.dev-power`
       * had `::after { inset: -19.5px }`, derived as 5 + 39 = 44 against the
       * touch minimum and never measured against a 17px row pitch — so every
       * lamp's hit area covered its neighbour's whole row and the later
       * sibling took the press. A channel with more than one insert had a
       * bypass button that was off by one, in a shipping console.
       */
      const wrong: string[] = [];
      for (let n = 1; n <= 3; n++) {
        const control =
          form.hand === 'touch'
            ? page.locator(`[data-testid="device-menu-${rack}-${n}"]`)
            : page.locator(`[data-testid="device-${rack}-${n}"] .dev-power`);
        if ((await control.count()) === 0 || !(await control.isVisible())) continue;
        await control.scrollIntoViewIfNeeded();

        const before = await bypasses(page, rack);
        if (form.hand === 'touch') {
          // On a finger the lamp is gone by design and the menu is the route,
          // so the press under test is the one that opens it.
          await reach(control, form.hand, `${form.id}: device ${n}'s options`);
          await page.waitForTimeout(250);
          await page
            .locator('.ctx-menu [role="menuitem"]')
            .filter({ hasText: /^(Bypass|Enable)$/ })
            .first()
            .tap();
        } else {
          await reach(control, form.hand, `${form.id}: device ${n}'s power lamp`);
        }
        await page.waitForTimeout(300);

        const after = await bypasses(page, rack);
        const moved = after.map((b, i) => (b === before[i] ? null : i + 1)).filter(Boolean);
        if (moved.length !== 1 || moved[0] !== n) {
          wrong.push(
            `aimed at device ${n}; ${
              moved.length === 0 ? 'nothing changed' : `device ${moved.join(' and ')} changed`
            } (before ${before.join(',')} after ${after.join(',')})`,
          );
        }
      }
      expect(wrong, `the press acted on the wrong device:\n${wrong.join('\n')}`).toEqual([]);
      await ctx.close();
    });
  });
}

/** Which of the channel's inserts are bypassed, read off the project itself. */
function bypasses(page: Page, rackName: string): Promise<boolean[]> {
  return page.evaluate((name) => {
    const w = window as unknown as {
      __ml?: {
        projectStore?: {
          getState: () => {
            project: { tracks: { name: string; effects?: { bypass?: boolean }[] }[] };
          };
        };
      };
    };
    const track = w.__ml?.projectStore?.getState().project.tracks.find((t) => t.name === name);
    return (track?.effects ?? []).map((e) => !!e.bypass);
  }, rackName);
}

test.describe('Escape unwinds one layer at a time', () => {
  /*
   * A menu on top of a window, and one key between them.
   *
   * `PluginWindow` listens for Escape on `window` in the **capture** phase and
   * calls `stopPropagation`, which is what makes an open device window beat the
   * app behind it. It also made the window beat the menus *above* it: a device's
   * options menu is at `--z-menu` (800) over the window's `--z-plugin` (300),
   * and pressing Escape on that menu closed the window underneath while leaving
   * the menu standing.
   *
   * The consequence was not cosmetic. The abandoned menu covers the button that
   * opened it — the menu is 377px tall and clamps upward to fit the viewport —
   * so the next press on that device's options went to a stale menu item.
   * `devicewindow.spec.ts` had been timing out on exactly that, and it had been
   * recorded as a target-size failure, which is what a symptom looks like when
   * the cause was never measured.
   */
  test('a menu over a device window closes before the window does', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForSelector('[data-testid="app-root"]', { timeout: 20000 });
    await page.waitForTimeout(500);
    await page.locator('[data-testid="editor-tab-mixer"]').first().click();
    await page.waitForTimeout(400);

    const rack = await addDevice(page, 'Compressor', { keepWindow: true });
    await expect(page.locator('[data-testid="plugin-window"]')).toHaveCount(1);

    await reach(
      page.locator(`[data-testid="device-menu-${rack}-1"]`),
      'mouse',
      'the device options button',
    );
    await page.waitForTimeout(300);
    await expect(page.locator('.ctx-menu')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(page.locator('.ctx-menu'), 'the menu outlived the key aimed at it').toHaveCount(0);
    await expect(
      page.locator('[data-testid="plugin-window"]'),
      'the window under the menu took the key instead',
    ).toHaveCount(1);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="plugin-window"]')).toHaveCount(0);
  });
});

test.describe('the inspector offers the same route as the console', () => {
  /*
   * The rack a phone actually lands in.
   *
   * `.fx-head .dev-menu` is the same button under different markup, and the
   * reveal rule was written as `.dev-slot:hover .dev-menu` — a selector with
   * no `.dev-slot` anywhere above it here. So the inspector's options button
   * has been invisible on *every* form factor for as long as it has existed,
   * revealed only by tabbing to it. It is the console's copy that a mouse user
   * ever sees, which is why this went unreported on a desktop and arrived as a
   * phone bug.
   */
  test('the inspector rack reveals its options button on hover', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForSelector('[data-testid="app-root"]', { timeout: 20000 });
    await page.waitForTimeout(500);
    await page.locator('[data-testid="editor-tab-mixer"]').first().click();
    await page.waitForTimeout(400);
    const rack = await addDevice(page);

    // Selected through the store: the inspector shows the selected *track's*
    // chain, and it shows a clip's event chain instead while a clip is
    // selected — which a demo project opens with. Which surface performs the
    // selection is not what this case is about.
    await page.evaluate((name) => {
      const w = window as unknown as {
        __ml?: {
          projectStore?: {
            getState: () => { project: { tracks: { id: string; name: string }[] } };
          };
          uiStore?: {
            getState: () => { selectTrack: (id: string) => void; set: (p: unknown) => void };
          };
        };
      };
      const track = w.__ml?.projectStore?.getState().project.tracks.find((t) => t.name === name);
      if (!track) return;
      const ui = w.__ml?.uiStore?.getState();
      ui?.set({ selectedClipId: null, selectedClipIds: [] });
      ui?.selectTrack(track.id);
    }, rack);
    await page.waitForTimeout(500);

    const head = page.locator('.fx-head').first();
    await expect(head, 'the inspector is not showing an insert rack').toHaveCount(1);
    const menu = head.locator('.dev-menu');
    expect(
      Number(await menu.evaluate((el) => getComputedStyle(el).opacity)),
      'the inspector button starts visible, so this test proves nothing',
    ).toBeLessThan(0.1);

    await head.hover();
    await page.waitForTimeout(150);
    expect(
      Number(await menu.evaluate((el) => getComputedStyle(el).opacity)),
      'hovering the inspector row does not reveal its options button',
    ).toBeGreaterThan(0.9);

    await reach(menu, 'mouse', 'the inspector device options button');
    await page.waitForTimeout(300);
    const items = await page
      .locator('.ctx-menu [role="menuitem"]')
      .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
    for (const required of ['Open', 'Bypass', 'Move up', 'Move down', 'Remove']) {
      expect(items, `the inspector's menu has no "${required}"`).toContain(required);
    }
  });
});
