import { test, expect, type Page } from '@playwright/test';

/**
 * Directive 10 §2 — the three device-window defects, all from real use.
 *
 * Each of them shipped because a matrix omitted a case rather than because a
 * check was wrong: the master channel was in no device-rack test, and no test
 * anywhere had ever dragged the window. So the axes here are **enumerated from
 * the app** — every channel the console draws, every effect kind the add menu
 * offers — rather than listed from memory.
 */

/** The touch minimum, the same number the responsive audit uses. */
const MIN_TOUCH = 44;

/**
 * The project, straight from the store the app is running on.
 *
 * Assertions read the project rather than the lamp that claims to show it: a
 * control that lights without moving the state behind it is the defect this
 * repository names most often, and a test that watches the lamp cannot see it.
 */
type MasterEffects = { bypass?: boolean }[] | undefined;
function masterEffects(page: Page): Promise<MasterEffects> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __ml?: { projectStore?: { getState: () => { project: { master?: { effects?: unknown } } } } };
    };
    return w.__ml?.projectStore?.getState().project.master?.effects as MasterEffects;
  });
}

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 });
  await page.waitForTimeout(400);
}

async function toMixer(page: Page) {
  const layout = await page.getAttribute('[data-testid="app-root"]', 'data-layout');
  const sel =
    layout === 'phone'
      ? '[data-testid="nav-mix"]'
      : layout === 'tablet'
        ? '[data-testid="combo-mixer"]'
        : '[data-testid="editor-tab-mixer"]';
  await page.locator(sel).first().click();
  await page.waitForTimeout(400);
}

/**
 * Every channel rack the console draws, whatever they are called.
 *
 * Not hard-coded track names. The demo project's tracks are Drums, Bass, Keys
 * and so on, and a spec that assumed "Audio 1" failed on every case in this
 * file before reaching a single assertion — which is the same mistake, one
 * layer down, as the matrix that omitted the master channel.
 */
async function trackRacks(page: Page): Promise<string[]> {
  const names = await page
    .locator('[data-testid^="device-add-"]')
    .evaluateAll((els) =>
      els.map((e) => (e.getAttribute('data-testid') ?? '').replace('device-add-', '')),
    );
  const found = names.filter((n) => n && n !== 'Master');
  if (found.length === 0) throw new Error(`no channel rack found; saw ${JSON.stringify(names)}`);
  return found;
}

async function firstTrackRack(page: Page): Promise<string> {
  return (await trackRacks(page))[0];
}

/** Insert one device into a named channel's rack, and return its label. */
async function addDevice(page: Page, rackName: string, label: string) {
  const add = page.locator(`[data-testid="device-add-${rackName}"]`);
  // The console scrolls sideways, so a channel past the first screenful is
  // present in the DOM and not on screen. Brought into view rather than clicked
  // where it is not.
  await add.scrollIntoViewIfNeeded();
  await add.evaluate((el: HTMLElement) => el.click());
  await page.waitForTimeout(200);
  await page.locator('.ctx-menu [role="menuitem"]').filter({ hasText: label }).first().click();
  await page.waitForTimeout(400);
}

/** Every effect the add menu offers — the axis, read off the app itself. */
async function offeredKinds(page: Page, rackName: string): Promise<string[]> {
  const add = page.locator(`[data-testid="device-add-${rackName}"]`);
  await add.evaluate((el: HTMLElement) => el.click());
  await page.waitForTimeout(250);
  const labels = await page.locator('.ctx-menu [role="menuitem"]').evaluateAll((els) =>
    els
      // Section headings are menu items too — "— Dynamics —" and its siblings —
      // and they are not effects. Excluded by what they are (disabled) as well
      // as by what they look like, so a heading that stops being dashed does
      // not quietly rejoin the axis.
      .filter((e) => !(e as HTMLButtonElement).disabled)
      .filter((e) => e.getAttribute('aria-disabled') !== 'true')
      .map((e) => (e.textContent ?? '').trim())
      .filter((t) => t && !/^—.*—$/.test(t)),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  return labels;
}

// ------------------------------------------------------------------ §2.2 drag

test.describe('the device window can be moved', () => {
  let rack = '';

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page);
    await toMixer(page);
    rack = await firstTrackRack(page);
    await addDevice(page, rack, 'Compressor');
    await page.locator(`[data-testid="device-${rack}-1"] .dev-name`).dblclick();
    await expect(page.locator('[data-testid="plugin-window"]')).toBeVisible();
  });

  /** Drag the header by `dx, dy` with the given pointer type. */
  async function dragHeader(page: Page, dx: number, dy: number, touch = false) {
    const head = page.locator('[data-testid="plugin-window"] .pw-head');
    const box = (await head.boundingBox())!;
    // Grab a point on the header itself, clear of the controls at either end:
    // every one of those stops propagation, which is correct and is also why a
    // drag has to start where the handle actually is.
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (touch) {
      await page.evaluate(
        ({ x0, y0, dx0, dy0 }) => {
          const el = document.querySelector('.pw-head')!;
          const opts = { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true };
          el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: x0, clientY: y0 }));
          for (let i = 1; i <= 6; i += 1) {
            window.dispatchEvent(
              new PointerEvent('pointermove', {
                ...opts,
                clientX: x0 + (dx0 * i) / 6,
                clientY: y0 + (dy0 * i) / 6,
              }),
            );
          }
          window.dispatchEvent(
            new PointerEvent('pointerup', { ...opts, clientX: x0 + dx0, clientY: y0 + dy0 }),
          );
        },
        { x0: x, y0: y, dx0: dx, dy0: dy },
      );
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i += 1) {
        await page.mouse.move(x + (dx * i) / 6, y + (dy * i) / 6);
      }
      await page.mouse.up();
    }
    await page.waitForTimeout(200);
  }

  test('drags by its header with a mouse', async ({ page }) => {
    const win = page.locator('[data-testid="plugin-window"]');
    const before = (await win.boundingBox())!;
    await dragHeader(page, -160, 90);
    const after = (await win.boundingBox())!;
    // Against the regression this is 0 on both axes: the move handler had a
    // bare `return` above its body, so automatic semicolon insertion made the
    // `setPos` call unreachable and the window could not be moved at all.
    expect(Math.abs(after.x - before.x), 'the window did not move horizontally').toBeGreaterThan(
      60,
    );
    expect(Math.abs(after.y - before.y), 'the window did not move vertically').toBeGreaterThan(40);
  });

  test('drags by its header with a touch', async ({ page }) => {
    const win = page.locator('[data-testid="plugin-window"]');
    const before = (await win.boundingBox())!;
    // Upward and sideways: a downward throw is the dismiss gesture, and this is
    // asserting the move, not the dismiss.
    await dragHeader(page, -140, -60, true);
    const after = (await win.boundingBox())!;
    expect(Math.abs(after.x - before.x), 'the window did not move on touch').toBeGreaterThan(60);
    await expect(win).toBeVisible();
  });

  test('cannot be dragged off the screen', async ({ page }) => {
    const win = page.locator('[data-testid="plugin-window"]');
    await dragHeader(page, -4000, -4000);
    const box = (await win.boundingBox())!;
    expect(box.x, 'dragged off the left edge').toBeGreaterThanOrEqual(-1);
    expect(box.y, 'dragged off the top edge').toBeGreaterThanOrEqual(-1);
    await dragHeader(page, 8000, 8000);
    const box2 = (await win.boundingBox())!;
    // A window dragged past the edge is a window that has to be found again
    // with the keyboard, and its drag handle went with it.
    expect(box2.x, 'dragged off the right edge').toBeLessThan(1440);
    expect(box2.y, 'dragged off the bottom edge').toBeLessThan(900);
  });

  test('reopens where the user left it, rather than back at the default', async ({ page }) => {
    const win = page.locator('[data-testid="plugin-window"]');
    await dragHeader(page, -200, 120);
    const moved = (await win.boundingBox())!;

    // Closed and reopened through the store rather than the rack.
    //
    // The gesture that opens a device is covered by every other case in this
    // file; this one is about *where* the window lands, and driving it from the
    // store keeps it independent of whether the console happens to have
    // scrolled the slot under a channel meter — which, after a drag across the
    // console, it does.
    const openDevice = await page.evaluate(() => {
      const w = window as unknown as {
        __ml?: { uiStore?: { getState: () => { openDevice: unknown; set: (p: unknown) => void } } };
      };
      const ui = w.__ml?.uiStore?.getState();
      const current = ui?.openDevice;
      ui?.set({ openDevice: null });
      return current;
    });
    await expect(win).toHaveCount(0);
    await page.evaluate((d) => {
      const w = window as unknown as {
        __ml?: { uiStore?: { getState: () => { set: (p: unknown) => void } } };
      };
      w.__ml?.uiStore?.getState().set({ openDevice: d });
    }, openDevice);
    await expect(win).toBeVisible();

    // Closing clears `openDevice`, which resets the "has been placed" flag — so
    // reopening runs exactly the path a *different* device runs, and this
    // asserts it without depending on a second channel's rack being empty and
    // on screen, which the demo project does not guarantee.
    const reopened = (await win.boundingBox())!;
    // It used to re-place every window at the default, so a musician working
    // through a chain moved it again for every insert.
    expect(Math.abs(reopened.x - moved.x), 'forgot where the window was put').toBeLessThan(24);
    expect(Math.abs(reopened.y - moved.y), 'forgot where the window was put').toBeLessThan(24);
  });
});

// ---------------------------------------------------------------- §2.3 master

test.describe('a device on the master channel', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page);
    await toMixer(page);
    await page.locator('[data-testid="strip-master"]').scrollIntoViewIfNeeded();
    await addDevice(page, 'Master', 'Compressor');
  });

  test('opens its editor, exactly as one on a track does', async ({ page }) => {
    await page.locator('[data-testid="device-Master-1"] .dev-name').dblclick();
    // The window resolved its channel by searching `project.tracks`, and the
    // master is not a member of it — so this found nothing and rendered
    // nothing, silently, for every device ever put on the master.
    const win = page.locator('[data-testid="plugin-window"]');
    await expect(win, 'the master device has no reachable editor').toBeVisible();
    await expect(win).toContainText('Master');
  });

  test('can be bypassed and re-enabled from its editor', async ({ page }) => {
    await page.locator('[data-testid="device-Master-1"] .dev-name').dblclick();
    const power = page.locator('[data-testid="plugin-window"] .pw-power');
    await expect(power).toHaveAttribute('aria-pressed', 'true');
    await power.click();
    await expect(power).toHaveAttribute('aria-pressed', 'false');
    const bypassed = (await masterEffects(page))?.[0]?.bypass;
    // Read from the project rather than the lamp: a lamp that lights without
    // the state moving is the defect this repository names most often.
    expect(bypassed).toBe(true);
  });

  test('can be removed from its rack menu', async ({ page }) => {
    await page.locator('[data-testid="device-Master-1"] .dev-menu').click();
    await page.locator('.ctx-menu [role="menuitem"]').filter({ hasText: 'Remove' }).first().click();
    await page.waitForTimeout(300);
    const count = (await masterEffects(page))?.length ?? -1;
    expect(count).toBe(0);
  });
});

// ------------------------------------------------------------------ §2.1 menu

test.describe('every device offers the same options', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page);
    await toMixer(page);
  });

  test('every effect the add menu offers gets an options menu on a track', async ({ page }) => {
    const rack = await firstTrackRack(page);
    const kinds = await offeredKinds(page, rack);
    // The axis is read from the app. A hand-written list is how the master
    // channel came to be in no device test at all.
    expect(kinds.length, 'the add menu offered nothing').toBeGreaterThan(4);

    const missing: string[] = [];
    console.log(`§2.1 · walking ${kinds.length} offered kind(s): ${kinds.join(', ')}`);
    for (const kind of kinds) {
      console.log(`§2.1 · ${kind}`);
      await addDevice(page, rack, kind);
      const slot = page.locator(`[data-testid^="device-${rack}-"]`).last();
      const menu = slot.locator('.dev-menu');
      if ((await menu.count()) === 0) {
        missing.push(kind);
        continue;
      }
      // Scrolled to first. A rack is taller than its own viewport once it holds
      // a few devices, and the slot just added is the one below the fold — so
      // every click below reported an *ancestor* intercepting pointer events,
      // which is what Playwright says when an element is clipped rather than
      // covered. It stuck on the first kind of forty-two.
      //
      // This is not a widening. A control one flick away is not an inoperable
      // control, and whether it is big enough for a finger is measured on the
      // next line rather than inferred from whether a click landed. The
      // reachability sweep learned the same thing about track headers.
      await menu.scrollIntoViewIfNeeded();
      const box = await menu.boundingBox();
      if (!box || box.width < MIN_TOUCH || box.height < MIN_TOUCH) {
        // Measured, not assumed: a menu that exists at 20x36 is a menu a finger
        // cannot open, which is the same defect wearing a different hat.
        const w = box ? Math.round(box.width) : 0;
        const h = box ? Math.round(box.height) : 0;
        missing.push(`${kind} (${w}x${h}, under ${MIN_TOUCH})`);
      }
      await menu.click();
      const items = await page
        .locator('.ctx-menu [role="menuitem"]')
        .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
      await page.keyboard.press('Escape');
      for (const required of ['Remove', 'Move up', 'Move down']) {
        if (!items.some((i) => i.includes(required))) missing.push(`${kind} has no "${required}"`);
      }
      // Keep the rack short so the next device is still on screen.
      await slot.locator('.dev-menu').scrollIntoViewIfNeeded();
      await slot.locator('.dev-menu').click();
      await page
        .locator('.ctx-menu [role="menuitem"]')
        .filter({ hasText: 'Remove' })
        .first()
        .click();
      await page.waitForTimeout(200);
    }
    expect(missing, `these devices offered no options:\n${missing.join('\n')}`).toEqual([]);
  });

  test('the inspector offers the same menu as the console', async ({ page }) => {
    const rack = await firstTrackRack(page);
    await addDevice(page, rack, 'Compressor');

    // Selected through the store: the inspector shows the selected track's
    // chain, and the arrangement that carries the track headers is behind the
    // mixer at this point. Which surface performs the selection is not what
    // this case is about.
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
      // The clip selection has to go as well: the inspector shows a *clip's*
      // event chain when one is selected, and a demo project opens with one.
      ui?.set({ selectedClipId: null, selectedClipIds: [] });
      ui?.selectTrack(track.id);
    }, rack);
    // Not toggled: the inspector is open at this width, and clicking its toggle
    // closed the pane this case is looking into.
    await expect(page.locator('[data-testid="inspector-side"]')).toBeVisible();
    await page.waitForTimeout(400);

    // The console's rack and the inspector's rack are two components for one
    // job, and they had drifted: one had a caret menu, the other had move and
    // remove as inline buttons behind a disclosure. Whether a device "had
    // options" depended on which surface it was opened from.
    const menu = page.locator('[data-testid^="fx-menu-"]').first();
    await expect(menu, 'the inspector rack offers no options menu').toBeVisible();
    await menu.click();
    const items = await page
      .locator('.ctx-menu [role="menuitem"]')
      .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
    for (const required of ['Remove', 'Move up', 'Move down', 'Bypass']) {
      expect(
        items.some((i) => i.includes(required)),
        `no "${required}" in the inspector's device menu — it offers ${items.join(', ')}`,
      ).toBe(true);
    }
  });
});
