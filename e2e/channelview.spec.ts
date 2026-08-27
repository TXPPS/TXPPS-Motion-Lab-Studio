import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { reach, reachableBox, RULER_SLACK, TOUCH_MIN } from './pointer';

/**
 * The Channel view — directive items 12, 13 and 14, driven by a real pointer.
 *
 * `docs/design/channel-strip.md` is the argument; this is what makes it a claim
 * rather than a drawing. Four things are asserted and each is one of the
 * directive's:
 *
 *  12. The channel is a sub-view of the editor, reachable on every form factor,
 *      and it fits — nothing drawn outside it, on the shortest surface the
 *      product has. That surface is where the console strip overflows its own
 *      fader by 44px, so "it fits there" is the whole point of the redesign.
 *  13. One tap opens a device's window, a second closes it, and a double tap
 *      shows the quick controls and puts back the window its own first tap
 *      opened.
 *  14. A send is an amount and an output is a destination: turning a send knob
 *      changes `sends[].amount`, and the output menu does not offer FX returns,
 *      which is the confusion the console has been teaching.
 *
 * The double tap is driven as two real taps rather than as `dblclick`. That is
 * not pedantry: the gesture reads `click` events, `fireEvent.doubleClick`
 * dispatches a lone `dblclick` and no clicks at all, and a browser sends click,
 * click, dblclick. A case built on the synthetic event would pass against an
 * event sequence no person can produce.
 */

interface Form {
  id: string;
  width: number;
  height: number;
  touch: boolean;
}

const FORMS: Form[] = [
  { id: 'phone-portrait', width: 390, height: 844, touch: true },
  { id: 'phone-landscape', width: 844, height: 390, touch: true },
  { id: 'tablet-portrait', width: 768, height: 1024, touch: true },
  { id: 'tablet-landscape', width: 1024, height: 768, touch: true },
  { id: 'desktop', width: 1440, height: 900, touch: false },
];

/** The interval `src/hooks/useTapOrDouble.ts` treats as a double tap. */
const DOUBLE_TAP_MS = 250;

interface Ml {
  projectStore?: {
    getState: () => {
      project: {
        tracks: {
          id: string;
          name: string;
          type: string;
          output: string;
          effects?: { id: string }[];
          sends?: { busId: string; amount: number; enabled: boolean }[];
        }[];
      };
      addTrack: (type: string) => string;
      addEffect: (trackId: string, kind: string) => string | null;
      setTrack: (id: string, patch: Record<string, unknown>) => void;
    };
  };
  uiStore?: {
    getState: () => {
      selectTrack: (id: string) => void;
      set: (patch: Record<string, unknown>) => void;
      openDevice: { trackId: string; effectId: string } | null;
    };
  };
}

async function openChannel(browser: Browser, form: Form) {
  const ctx = await browser.newContext({
    viewport: { width: form.width, height: form.height },
    hasTouch: form.touch,
    isMobile: form.touch,
    deviceScaleFactor: form.touch ? 2 : 1,
  });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 20000 });
  await page.waitForTimeout(700);

  /*
   * A fixture, not a claim: a channel with a device on it, an FX return to send
   * to, and a bus to route to. Building this by pointer would make every case
   * below fail for whatever the browser or the arrangement did rather than for
   * its own reason, and which controls build a track is another spec's subject.
   */
  await page.evaluate(() => {
    const w = window as unknown as { __ml?: Ml };
    const st = w.__ml?.projectStore?.getState();
    const ui = w.__ml?.uiStore?.getState();
    if (!st || !ui) return;
    const track =
      st.project.tracks.find((t) => t.type === 'instrument' || t.type === 'drum') ??
      st.project.tracks[0];
    if (!track) return;
    if (!(track.effects ?? []).length) st.addEffect(track.id, 'compressor');
    if (!st.project.tracks.some((t) => t.type === 'fx')) st.addTrack('fx');
    if (!st.project.tracks.some((t) => t.type === 'bus')) st.addTrack('bus');
    ui.selectTrack(track.id);
  });
  await page.waitForTimeout(300);

  // Through the shell's own controls. `nav-edit` on a phone, `combo-piano` on a
  // tablet, and the desktop's strip is already there — the routes the
  // Reachability Matrix records, read rather than guessed at.
  for (const id of ['nav-edit', 'combo-piano']) {
    const control = page.locator(`[data-testid="${id}"]`);
    if (await control.isVisible().catch(() => false)) {
      await reach(control, form.touch ? 'touch' : 'mouse', `${form.id}: ${id}`);
      await page.waitForTimeout(400);
      break;
    }
  }
  const tab = page.locator('[data-testid="editor-tab-channel"]');
  await expect(
    tab,
    `${form.id}: the editor offers no Channel tab, so the surface is on this form factor ` +
      'in name only',
  ).toBeVisible({ timeout: 10000 });
  await reach(tab, form.touch ? 'touch' : 'mouse', `${form.id}: the Channel tab`);
  await page.waitForSelector('[data-testid="channel-view"]', { timeout: 10000 });
  await page.waitForTimeout(400);
  return { page, close: () => ctx.close() };
}

/** Two taps at one place, close enough together to be one gesture. */
async function doubleTap(page: Page, locator: Locator, what: string) {
  await locator.scrollIntoViewIfNeeded();
  const box = (await locator.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(() => {
    const w = window as unknown as { __taps?: number[] };
    w.__taps = [];
    document.addEventListener(
      'click',
      (e) => (window as unknown as { __taps: number[] }).__taps.push(e.timeStamp),
      true,
    );
  });
  await page.touchscreen.tap(x, y);
  await page.touchscreen.tap(x, y);
  const gap = await page.evaluate(() => {
    const t = (window as unknown as { __taps: number[] }).__taps;
    return t.length >= 2 ? t[t.length - 1] - t[t.length - 2] : Number.POSITIVE_INFINITY;
  });
  // An allowance on the instrument, never on the requirement: if the harness
  // could not get two taps out inside the interval, this case has not tested the
  // double tap and must say so rather than reporting the product failed.
  expect(
    gap,
    `${what}: the harness put ${Math.round(gap)}ms between the two taps, past the ` +
      `${DOUBLE_TAP_MS}ms a double tap is. That is the instrument, not the product.`,
  ).toBeLessThan(DOUBLE_TAP_MS);
}

const openDevice = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __ml?: Ml };
    return w.__ml?.uiStore?.getState().openDevice ?? null;
  });

test.describe('item 12 — the channel is an editor, and it fits', () => {
  for (const form of FORMS) {
    test(`${form.id}: reachable, and nothing is drawn outside it`, async ({ browser }) => {
      const { page, close } = await openChannel(browser, form);
      try {
        const view = page.locator('[data-testid="channel-view"]');
        await expect(view).toBeVisible();

        // Every section of the signal path, in order, on every form factor.
        // "Layout may differ, capability may not" is the directive's rule and
        // this is it stated as a measurement.
        for (const id of ['channel-input', 'device-rail', 'channel-sends-section']) {
          await expect(
            page.locator(`[data-testid="${id}"]`),
            `${form.id}: ${id} is missing from the channel`,
          ).toBeVisible();
        }

        /*
         * The claim the whole redesign rests on. A console strip on
         * tablet-landscape has 131 px and the device rack's touch floor is 140,
         * so the rack is drawn through the fader; here the same chain is on the
         * other axis, and nothing may leave the view's own box.
         */
        const spill = await view.evaluate((v) => {
          const r = v.getBoundingClientRect();
          const out: string[] = [];
          for (const el of v.querySelectorAll('*')) {
            if (el.closest('svg')) continue;
            const b = el.getBoundingClientRect();
            if (b.width < 2 || b.height < 2) continue;
            if (b.bottom > r.bottom + 1 || b.top < r.top - 1) {
              out.push(
                `${el.tagName.toLowerCase()}.${`${(el as HTMLElement).className}`.slice(0, 24)} ` +
                  `by ${Math.round(Math.max(b.bottom - r.bottom, r.top - b.top))}px`,
              );
            }
          }
          return [...new Set(out)];
        });
        expect(
          spill,
          `${form.id}: the channel draws these outside its own box:\n  ${spill.join('\n  ')}`,
        ).toEqual([]);

        // And it never scrolls in the axis it has none of. The chain grows
        // sideways; that is the entire argument.
        const overflowY = await page
          .locator('[data-testid="channel-rail"]')
          .evaluate((el) => el.scrollHeight - el.clientHeight);
        expect(
          overflowY,
          `${form.id}: the rail overflows vertically by ${overflowY}px, which is the console's ` +
            'own failure in a new orientation',
        ).toBeLessThanOrEqual(1);
      } finally {
        await close();
      }
    });
  }

  test('the spill sweep can find something drawn outside', async ({ browser }) => {
    // Non-vacuity, proved by *addition* — a sweep that reported clean because it
    // had stopped looking reads exactly like a surface that fits.
    const { page, close } = await openChannel(browser, FORMS[3]);
    try {
      const view = page.locator('[data-testid="channel-view"]');
      const found = await view.evaluate((v) => {
        const probe = document.createElement('div');
        probe.className = 'spill-probe';
        probe.setAttribute('style', 'position:relative;width:40px;height:40px;margin-top:400px');
        v.appendChild(probe);
        const r = v.getBoundingClientRect();
        const b = probe.getBoundingClientRect();
        const outside = b.bottom > r.bottom + 1;
        probe.remove();
        return outside;
      });
      expect(found, 'a box placed 400px below the view was not seen as outside it').toBe(true);
    } finally {
      await close();
    }
  });
});

test.describe('item 13 — the rack, by finger', () => {
  test('every control in a card is big enough for a thumb', async ({ browser }) => {
    const { page, close } = await openChannel(browser, FORMS[0]);
    try {
      const card = page.locator('[data-testid="rail-list"] .rail-card').first();
      await expect(card).toBeVisible();
      // Scrolled to first, because that is where a person measures it from. On a
      // phone the rail is 276px wide and the chain is three sections in, so an
      // unscrolled `reachableBox` correctly reports 0x0 — the control is not
      // covered or too small, it is simply not on screen yet.
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      const small: string[] = [];
      for (const cls of ['.rail-power', '.rail-name', '.rail-menu']) {
        const control = card.locator(cls);
        // Measured, never read off the stylesheet: a declared inset is the
        // intended rectangle and not the reachable one.
        const box = await reachableBox(control);
        if (Math.min(box.width, box.height) < TOUCH_MIN - RULER_SLACK) {
          small.push(`${cls} is ${Math.round(box.width)}x${Math.round(box.height)}`);
        }
      }
      expect(small, `rail controls under ${TOUCH_MIN}pt: ${small.join(', ')}`).toEqual([]);
    } finally {
      await close();
    }
  });

  test('one tap opens the device window and the next closes it', async ({ browser }) => {
    const { page, close } = await openChannel(browser, FORMS[0]);
    try {
      const name = page.locator('[data-testid="rail-list"] .rail-name').first();
      expect(await openDevice(page)).toBeNull();

      await reach(name, 'touch', 'the first device in the rail');
      await page.waitForTimeout(200);
      expect(await openDevice(page), 'one tap did not open the device').not.toBeNull();
      await expect(page.locator('[data-testid="plugin-window"]')).toBeVisible();

      // Past the interval, so this is a second single tap rather than the back
      // half of a double.
      await page.waitForTimeout(DOUBLE_TAP_MS + 120);
      await reach(name, 'touch', 'the same device again');
      await page.waitForTimeout(200);
      expect(await openDevice(page), 'a second tap did not close the device').toBeNull();
    } finally {
      await close();
    }
  });

  test('a double tap shows the quick controls and puts the window back', async ({ browser }) => {
    const { page, close } = await openChannel(browser, FORMS[0]);
    try {
      const name = page.locator('[data-testid="rail-list"] .rail-name').first();
      const card = page.locator('[data-testid="rail-list"] .rail-card').first();
      await expect(card.locator('.rail-quick')).toHaveCount(0);

      await doubleTap(page, name, 'the first device in the rail');
      await page.waitForTimeout(250);

      await expect(
        card.locator('.rail-quick'),
        'a double tap did not reveal the quick controls',
      ).toHaveCount(1);
      expect(
        await openDevice(page),
        'the second tap must revert the window its own first tap opened',
      ).toBeNull();
    } finally {
      await close();
    }
  });

  test('the caret collapses the rack and gives it back', async ({ browser }) => {
    const { page, close } = await openChannel(browser, FORMS[2]);
    try {
      const rail = page.locator('[data-testid="device-rail"]');
      const caret = page.locator('[data-testid="rail-collapse"]');
      await expect(rail).not.toHaveClass(/collapsed/);

      await reach(caret, 'touch', 'the rack collapse caret');
      await page.waitForTimeout(250);
      await expect(rail, 'the caret did not collapse the rack').toHaveClass(/collapsed/);
      // Collapsed is names-only, and the names have to survive it: a rack that
      // collapsed to nothing would stop saying what is on the channel, which is
      // the one thing a collapsed rack is for.
      await expect(page.locator('[data-testid="rail-list"] .rail-name').first()).toBeVisible();

      await reach(caret, 'touch', 'the rack expand caret');
      await page.waitForTimeout(250);
      await expect(rail).not.toHaveClass(/collapsed/);
    } finally {
      await close();
    }
  });
});

test.describe('item 14 — a send is not a bus', () => {
  test('a send knob changes the amount in the project', async ({ browser }) => {
    const { page, close } = await openChannel(browser, FORMS[3]);
    try {
      const knob = page.locator('[data-testid="channel-sends"] .knob').first();
      await expect(knob).toBeVisible();
      const box = (await knob.boundingBox())!;

      // A real drag, upward: the knob's own gesture, not a value written in.
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 40, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(250);

      const amount = await page.evaluate(() => {
        const w = window as unknown as { __ml?: Ml };
        const st = w.__ml?.projectStore?.getState();
        const ui = w.__ml?.uiStore?.getState();
        void ui;
        const withSend = (st?.project.tracks ?? []).find((t) => (t.sends ?? []).length > 0);
        return (withSend?.sends ?? [])[0]?.amount ?? 0;
      });
      expect(amount, 'dragging the send knob left the project unchanged').toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  test('the output menu offers buses and not FX returns', async ({ browser }) => {
    const { page, close } = await openChannel(browser, FORMS[4]);
    try {
      const select = page.locator('[data-testid="channel-route-select"]');
      await expect(select).toBeVisible();
      const offered = await select.evaluate((el) =>
        [...(el as HTMLSelectElement).options].map((o) => o.text),
      );
      const fxNames = await page.evaluate(() => {
        const w = window as unknown as { __ml?: Ml };
        return (w.__ml?.projectStore?.getState().project.tracks ?? [])
          .filter((t) => t.type === 'fx')
          .map((t) => t.name);
      });
      expect(
        fxNames.length,
        'the fixture built no FX return, so this asserts nothing',
      ).toBeGreaterThan(0);
      const wrong = fxNames.filter((n) => offered.includes(n));
      expect(
        wrong,
        `the output menu offers these FX returns as destinations: ${wrong.join(', ')}. ` +
          'An FX return is fed by sends; offering it as an output erases the distinction ' +
          'the type exists to make.',
      ).toEqual([]);
      expect(offered).toContain('Master');
    } finally {
      await close();
    }
  });

  test('a channel already routed to an FX return keeps that option', async ({ browser }) => {
    // Never silently re-route. A select that cannot represent its own value
    // rewrites somebody's mix on first render — the rule `paramIdExists`
    // follows, and the reason it is deliberately wide.
    const { page, close } = await openChannel(browser, FORMS[4]);
    try {
      const fxId = await page.evaluate(() => {
        const w = window as unknown as { __ml?: Ml };
        const st = w.__ml?.projectStore?.getState();
        const ui = w.__ml?.uiStore?.getState();
        const fx = (st?.project.tracks ?? []).find((t) => t.type === 'fx');
        const track = (st?.project.tracks ?? []).find(
          (t) => t.type === 'instrument' || t.type === 'drum' || t.type === 'audio',
        );
        if (!st || !ui || !fx || !track) return null;
        st.setTrack(track.id, { output: fx.id });
        ui.selectTrack(track.id);
        return fx.id;
      });
      expect(fxId).not.toBeNull();
      await page.waitForTimeout(400);
      const select = page.locator('[data-testid="channel-route-select"]');
      expect(await select.inputValue()).toBe(fxId);
    } finally {
      await close();
    }
  });
});
