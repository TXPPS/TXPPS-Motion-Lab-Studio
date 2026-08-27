import { test, expect, type Browser, type Page } from '@playwright/test';
import { reach, reachableBox, RULER_SLACK, TOUCH_MIN } from './pointer';

/**
 * The tier ladder, swept rather than sampled.
 *
 * `landscape.spec.ts` asks whether the console fits on the six form factors the
 * product is used on. That is the claim that matters, and it is also six points
 * on a curve — the four tiers it replaced passed a check of exactly that shape
 * for two directives while a tablet in landscape drew 34 px of device rack
 * through its fader, because no form factor happened to land in the band where
 * the arithmetic broke.
 *
 * So this drives the container itself, ten pixels at a time, from below the
 * shortest console the product draws to above the tallest, and asks the same
 * questions at every height. A ladder is a piecewise function; a form factor is
 * one sample of it; and the interesting heights are the ones nothing samples.
 *
 * The mixer declares `container-type: size`, which means its own height comes
 * from its parent and never from its contents — so forcing that height is not a
 * fiction about the layout, it is the one input the ladder reads.
 */

const STEP = 10;
const LOW = 90;
const HIGH = 700;

/** `reachableBox`'s allowance, and for the same reason: it is on the ruler. */
const SLACK = 1;

interface Shape {
  container: number;
  strip: number;
  rows: { cls: string; h: number; top: number; bottom: number }[];
  /** How far past the strip's inside edge the last row reaches. */
  spill: number;
  overlaps: string[];
  fader: number;
  hasRack: boolean;
  hasChain: boolean;
}

async function openMixer(browser: Browser, width: number, height: number, touch: boolean) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    hasTouch: touch,
    isMobile: touch,
    deviceScaleFactor: touch ? 2 : 1,
  });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 20000 });
  await page.waitForTimeout(900);
  const nav = page.locator('[data-testid="nav-mix"]');
  // Navigation, not the claim: every assertion below is a measurement of
  // geometry and no press decides one. `e2e/pointer.ts` is what a reachability
  // claim goes through, and there is not one in this file.
  if (await nav.isVisible().catch(() => false)) {
    await nav.tap().catch(() => nav.click());
    await page.waitForTimeout(700);
  }
  await page.waitForSelector('[data-strip="channel"]', { timeout: 10000 });

  /*
   * The worst strip on the desk, built rather than hoped for.
   *
   * A tier's floor is the sum of the rows it keeps at their FULL heights, and
   * the demo project's first channel carries at most one send — so the sends
   * row, which the ladder budgets 69 px for, would never once have been at its
   * full height in this sweep. `SendRows` draws three and then a "+n more", so
   * four rows is its maximum; four buses and four sends is what makes it draw
   * them. A fixture, through the store: which controls create a bus is another
   * spec's subject and building it by pointer would make every case here fail
   * for whatever the picker did.
   */
  await page.evaluate(() => {
    const w = window as unknown as {
      __ml?: {
        projectStore?: {
          getState: () => {
            project: { tracks: { id: string; type: string }[] };
            addTrack: (type: string) => string;
            setTrack: (id: string, patch: Record<string, unknown>) => void;
          };
        };
      };
    };
    const st = w.__ml?.projectStore?.getState();
    if (!st) return;
    const target = st.project.tracks.find(
      (t) => t.type === 'audio' || t.type === 'instrument' || t.type === 'drum',
    );
    if (!target) return;
    const buses: string[] = [];
    while (buses.length < 4) buses.push(st.addTrack('bus'));
    st.setTrack(target.id, {
      sends: buses.map((busId) => ({ busId, amount: 0.5, enabled: true, preFader: false })),
    });
  });
  await page.waitForTimeout(400);
  return { page, close: () => ctx.close() };
}

/** Force the console to a height, and read what the ladder did with it. */
async function shapeAt(page: Page, height: number | null, force?: string): Promise<Shape> {
  return page.evaluate(
    ({ h, force }) => {
      const id = 'tier-probe';
      document.getElementById(id)?.remove();
      if (h !== null || force) {
        const style = document.createElement('style');
        style.id = id;
        style.textContent =
          (h === null ? '' : `.mixer { flex: none !important; height: ${h}px !important; }`) +
          (force ?? '');
        document.head.appendChild(style);
      }
      const mixer = document.querySelector<HTMLElement>('.mixer')!;
      const strip = document.querySelector<HTMLElement>('[data-strip="channel"]')!;
      const box = strip.getBoundingClientRect();
      const cs = getComputedStyle(strip);
      const inside = box.bottom - parseFloat(cs.paddingBottom);
      const drawn = (sel: string) => {
        const el = strip.querySelector(sel);
        return !!el && getComputedStyle(el).display !== 'none';
      };
      const rows = [...strip.children]
        .filter((el) => getComputedStyle(el).display !== 'none')
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            cls: (el.className || '').split(' ')[0],
            h: Math.round(r.height * 10) / 10,
            top: Math.round(r.top * 10) / 10,
            bottom: Math.round(r.bottom * 10) / 10,
          };
        });
      const overlaps: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const o = Math.min(rows[i].bottom, rows[j].bottom) - Math.max(rows[i].top, rows[j].top);
          if (o > 1) overlaps.push(`${rows[i].cls} over ${rows[j].cls} by ${Math.round(o)}`);
        }
      }
      const mid = rows.find((r) => r.cls === 'strip-mid');
      const mcs = getComputedStyle(mixer);
      return {
        container:
          Math.round(
            (mixer.getBoundingClientRect().height -
              parseFloat(mcs.paddingTop) -
              parseFloat(mcs.paddingBottom)) *
              10,
          ) / 10,
        strip: Math.round(box.height * 10) / 10,
        rows,
        spill:
          rows.length === 0
            ? 0
            : Math.round((Math.max(...rows.map((r) => r.bottom)) - inside) * 10) / 10,
        overlaps,
        fader: mid ? mid.h : 0,
        hasRack: drawn('.dev-rack'),
        hasChain: drawn('.strip-chain'),
      };
    },
    { h: height, force },
  );
}

const key = (s: Shape) => s.rows.map((r) => r.cls).join('|');

test.describe('the strip fits itself at every height, not only at six of them', () => {
  for (const hand of ['touch', 'mouse'] as const) {
    test(`${hand}: no row is ever drawn outside the strip or over another one`, async ({
      browser,
    }) => {
      const touch = hand === 'touch';
      const { page, close } = await openMixer(browser, touch ? 390 : 1440, 900, touch);
      try {
        const seen = new Set<string>();
        const spilling: string[] = [];
        const overlapping: string[] = [];
        const shortFader: string[] = [];
        const nameless: string[] = [];
        let floor = Infinity;

        for (let h = LOW; h <= HIGH; h += STEP) {
          const s = await shapeAt(page, h);
          seen.add(key(s));
          if (s.overlaps.length) overlapping.push(`${s.strip}px: ${s.overlaps.join(', ')}`);
          if (s.spill > SLACK) spilling.push(`${s.strip}px: ${s.spill} past the strip`);
          else floor = Math.min(floor, s.strip);
          // Whatever else goes, the two rows a console cannot be without stay:
          // its name, and a fader at least as tall as the token that says how
          // tall a fader has to be.
          if (s.rows.some((r) => r.cls === 'strip-name') === false) nameless.push(`${s.strip}px`);
          if (s.spill <= SLACK && s.fader + SLACK < 44) shortFader.push(`${s.strip}px: ${s.fader}`);
        }

        // Overlap is the P0 and it is checked at every height, including the
        // ones below the floor: a strip too short for its own minimum must
        // CLIP, which is wrong and visible, rather than stack two rows in one
        // row's space, which is wrong and only a hit test finds it.
        expect(
          overlapping,
          `rows drawn on top of each other:\n  ${overlapping.join('\n  ')}`,
        ).toEqual([]);
        expect(
          nameless,
          `heights where the strip lost its own name: ${nameless.join(', ')}`,
        ).toEqual([]);
        expect(
          shortFader,
          `heights where the fader fell under its floor: ${shortFader.join(', ')}`,
        ).toEqual([]);

        // The floor is measured rather than asserted: the smallest strip that
        // holds its rows. What it is then compared against is a fact about the
        // product — the shortest console it draws — so neither side of the
        // comparison is a constant copied from the stylesheet it is checking.
        const shortest = await (async () => {
          if (!touch) return null;
          const other = await openMixer(browser, 1024, 768, true);
          try {
            return (await shapeAt(other.page, null)).strip;
          } finally {
            await other.close();
          }
        })();
        if (shortest !== null) {
          expect(
            floor,
            `the ladder's floor is ${floor}px and the shortest console the product draws is ${shortest}px`,
          ).toBeLessThanOrEqual(shortest);
        }

        // Non-vacuity, and the reason the sweep is a sweep: a ladder that had
        // stopped changing would pass everything above unremarkably.
        expect(
          seen.size,
          `the sweep saw ${seen.size} row set(s) between ${LOW} and ${HIGH}px`,
        ).toBeGreaterThanOrEqual(4);

        // And the instrument itself. A probe that cannot see a row past the
        // edge reads exactly like a strip that fits, which is the shape this
        // repository has shipped more than once.
        const broken = await shapeAt(page, LOW, '.strip-input, .strip-sends { display: flex; }');
        expect(
          broken.spill,
          'the probe cannot see a row forced past the bottom of the strip',
        ).toBeGreaterThan(SLACK);
      } finally {
        await close();
      }
    });
  }

  test('a row only leaves when putting it back would not fit', async ({ browser }) => {
    /*
     * The two substitutions the ladder makes are the two that cost something,
     * so each is asked to justify itself where it happens rather than by the
     * arithmetic in the comment beside it: put the row back and the strip has
     * to overflow. Nothing here reads a threshold — if a rung were tuned to a
     * number that merely looked safe, this is what would notice.
     *
     * Only these two. Every other dropped row hands its height to the fader,
     * which is `flex: 1 1 auto` and the reason the surface exists, so "it would
     * have fitted" is not an argument against dropping it.
     */
    const { page, close } = await openMixer(browser, 390, 900, true);
    try {
      const rackBack: string[] = [];
      const chainBack: string[] = [];
      for (let h = LOW; h <= HIGH; h += STEP) {
        const s = await shapeAt(page, h);
        if (s.spill > SLACK) continue;
        if (!s.hasRack && s.hasChain) {
          const forced = await shapeAt(page, h, '.dev-rack { display: flex !important; }');
          if (forced.spill <= SLACK) rackBack.push(`${s.strip}px: the rack would have fitted`);
        }
        if (!s.hasRack && !s.hasChain) {
          const forced = await shapeAt(page, h, '.strip-chain { display: flex !important; }');
          if (forced.spill <= SLACK) chainBack.push(`${s.strip}px: the chain would have fitted`);
        }
      }
      expect(rackBack, rackBack.join('\n  ')).toEqual([]);
      expect(chainBack, chainBack.join('\n  ')).toEqual([]);
    } finally {
      await close();
    }
  });
});

test.describe('the summary can be pressed, and goes where it says', () => {
  /*
   * The geometry above says the ladder fits. It says nothing about whether the
   * row that replaced the rack can be operated, and that is the half WCAG
   * 2.5.8 is actually about: an equivalent alternative has to carry every
   * command the small control offered, which means a finger has to be able to
   * reach it and it has to arrive at the rack.
   *
   * Phone in landscape, because that is a form factor where the ladder has
   * taken the rack off the console — checked here rather than assumed, since a
   * case that measured a control the tier had not drawn would pass by finding
   * nothing.
   */
  for (const who of ['channel', 'master'] as const) {
    test(`phone-landscape: the ${who} summary is a touch target that opens its channel`, async ({
      browser,
    }) => {
      const { page, close } = await openMixer(browser, 844, 390, true);
      try {
        const strip = page
          .locator(who === 'master' ? '[data-strip="master"]' : '[data-strip="channel"]')
          .first();
        const chain = strip.locator('.strip-chain');
        await expect(
          chain,
          'this tier still draws the rack, so there is no summary to measure and this case ' +
            'is testing nothing',
        ).toBeVisible({ timeout: 10000 });

        // Measured where a person would measure it: the console is a horizontal
        // scroller and the master sits past the right edge of a phone in
        // landscape, so an unscrolled `reachableBox` reads 0x0 — which means
        // "not on screen", not "too small". That distinction is the one the
        // sampler library cost two rounds to learn.
        await chain.scrollIntoViewIfNeeded();
        const box = await reachableBox(chain);
        expect(
          Math.min(box.width, box.height),
          `the ${who} chain summary measures ${box.width}x${box.height}. A 0 in either ` +
            'axis means it is off screen or behind something, not that it is small.',
        ).toBeGreaterThanOrEqual(TOUCH_MIN - RULER_SLACK);

        // Read before the press, because the press is what takes it away. On a
        // phone the editor replaces the console, so a locator into the strip
        // stops resolving the moment the gesture lands — and a locator that
        // never resolves does not fail, it waits until the test's own timeout
        // and reports the line after the one that hung.
        const named = await chain.getAttribute('aria-label');

        await reach(chain, 'touch', `phone-landscape: the ${who} chain summary`);
        await page.waitForTimeout(500);
        const view = page.locator('[data-testid="channel-view"]');
        await expect(view).toBeVisible({ timeout: 10000 });
        // And on the channel it names. A summary that opened somebody else's
        // channel would be worse than one that opened nothing.
        const label = await view.getAttribute('aria-label');
        expect(
          named?.startsWith(String(label).replace(/ channel$/, '')),
          `the ${who} summary says "${named}" and opened "${label}"`,
        ).toBe(true);
        // The rack itself, on the other axis, rather than a picture of it.
        await expect(page.locator('[data-testid="channel-rail"]')).toBeVisible();
      } finally {
        await close();
      }
    });
  }
});

test('the last rung leaves a route, and it is a target a finger can hit', async ({ browser }) => {
  /*
   * Tablet in landscape: 130.7 px of console, which is under the 171 the chain
   * summary needs, so the strip says a name, a level and a state and nothing
   * about what is on the channel. That is recorded in
   * `docs/KNOWN-LIMITATIONS.md` as the cost of the ladder — and a recorded cost
   * has to be measured, because the sentence that describes it names a route.
   *
   * The route is the cue bar's link. It measured 36 x 36 on a coarse pointer
   * inside a row that is 44, so the alternative WCAG 2.5.8 obliges was itself
   * under the touch minimum; it is grown to the row now. This is the case that
   * would notice if it shrank back, or if the summary quietly returned and the
   * limitation stopped being true.
   */
  const { page, close } = await openMixer(browser, 1024, 768, true);
  try {
    const summary = page.locator('[data-strip="channel"] .strip-chain').first();
    await expect(
      summary,
      'this console draws a chain summary after all, so the limitation this case ' +
        'measures the fallback for is no longer the product',
    ).toBeHidden();

    const link = page.locator('[data-testid="open-channel-view"]');
    await expect(link, 'the console offers no route to the channel at all').toBeVisible();
    const box = await reachableBox(link);
    expect(
      Math.min(box.width, box.height),
      `the only route off this console measures ${box.width}x${box.height}`,
    ).toBeGreaterThanOrEqual(TOUCH_MIN - RULER_SLACK);

    // A channel first: the link opens whichever is selected, and with none it
    // correctly draws the prompt instead.
    await reach(page.locator('[data-strip="channel"]').first(), 'touch', 'a strip');
    await reach(link, 'touch', 'the cue bar link to the channel');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="channel-view"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="channel-rail"]')).toBeVisible();
  } finally {
    await close();
  }
});
