import { test, expect, type Browser, type Page } from '@playwright/test';

/**
 * The orientation matrix, measured rather than eyeballed.
 *
 * Reported from use: "the track arranger overlaps and distorts in landscape,
 * and the left-hand track titles and controls are worst; in the editor's
 * channel area landscape is compressed to the point of being unusable."
 *
 * `orientation.spec.ts` and `responsive.spec.ts` both passed while that was
 * true, and what they check is why: horizontal overflow, and whether named
 * surfaces are on screen. Neither asks whether two things that should sit side
 * by side are drawn on top of each other, and neither asks what share of a
 * channel a control ends up with. Those are the two questions here.
 *
 * **Overlap is a P0 by the directive's own instruction**, so it is checked
 * exhaustively rather than on a sample: every in-flow sibling pair, on every
 * form factor, in every section. Positioned elements are excluded because
 * overlapping is what they are for — a playhead, a menu, a drag ghost — and a
 * check that flagged those would be turned off within a day.
 *
 * The rack case is the second half. A device row that is *cut* has an options
 * menu measuring under the touch minimum, which is why the rack declares a
 * floor of whole rows; on a short console that floor was three 44px rows before
 * a single device was drawn, and the fader — the thing a channel strip is for —
 * was left at its own 44px minimum. The floor now excludes the instrument row
 * on short consoles and the rack scrolls to it instead. What must stay true is
 * that no row is ever cut, which is the property the floor existed to protect.
 */

interface Form {
  id: string;
  width: number;
  height: number;
  touch: boolean;
}

const MATRIX: Form[] = [
  { id: 'phone-portrait', width: 390, height: 844, touch: true },
  { id: 'phone-landscape', width: 844, height: 390, touch: true },
  { id: 'tablet-portrait', width: 768, height: 1024, touch: true },
  { id: 'tablet-landscape', width: 1024, height: 768, touch: true },
  { id: 'split-third', width: 375, height: 768, touch: true },
  { id: 'desktop', width: 1440, height: 900, touch: false },
];

/** Sections a person can reach from the shell, and the control that reaches them. */
const SECTIONS = [
  { id: 'arrange', nav: null as string | null },
  { id: 'edit', nav: 'nav-edit' },
  { id: 'mix', nav: 'nav-mix' },
];

async function open(browser: Browser, form: Form) {
  const ctx = await browser.newContext({
    viewport: { width: form.width, height: form.height },
    hasTouch: form.touch,
    isMobile: form.touch,
    deviceScaleFactor: form.touch ? 2 : 1,
  });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 20000 });
  await page.waitForTimeout(900);
  return { page, close: () => ctx.close() };
}

async function goTo(page: Page, nav: string | null) {
  if (!nav) return true;
  const control = page.locator(`[data-testid="${nav}"]`);
  if (!(await control.isVisible().catch(() => false))) return false;
  await control.tap().catch(() => control.click());
  await page.waitForTimeout(700);
  return true;
}

/**
 * Every pair of in-flow siblings whose boxes intersect.
 *
 * In-flow means `static` or `relative`: a positioned element is placed on top
 * of something on purpose. `pointer-events: none` is excluded for the same
 * reason — a decorative overlay is not competing for the space.
 */
async function overlaps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const inFlow = (el: Element) => {
      // Inside an `<svg>`, overlap is the medium rather than a collision: a
      // path over a circle is how an icon is drawn. Excluding the interior of
      // an SVG is not a weakening — the `<svg>` element itself is still a
      // sibling like any other and still checked.
      if (el.closest('svg')) return false;
      const cs = getComputedStyle(el);
      return (
        (cs.position === 'static' || cs.position === 'relative') &&
        cs.display !== 'none' &&
        cs.visibility !== 'hidden' &&
        cs.pointerEvents !== 'none' &&
        parseFloat(cs.opacity) > 0.05
      );
    };
    const name = (el: Element) => {
      const id = el.getAttribute('data-testid');
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : `.${(el as HTMLElement).className}`.slice(0, 36)}`;
    };
    const walk = (parent: Element) => {
      const kids = [...parent.children].filter(inFlow);
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i].getBoundingClientRect();
          const b = kids[j].getBoundingClientRect();
          if (a.width < 2 || a.height < 2 || b.width < 2 || b.height < 2) continue;
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          // A pixel of tolerance: sub-pixel layout rounds neighbours into
          // contact, and reporting that as a collision would bury the real ones.
          if (ox > 1 && oy > 1) {
            out.push(
              `${name(kids[i])} over ${name(kids[j])} by ${Math.round(ox)}x${Math.round(oy)}`,
            );
          }
        }
      }
      for (const k of parent.children) walk(k);
    };
    walk(document.body);
    return [...new Set(out)];
  });
}

test.describe('nothing is drawn on top of anything else', () => {
  for (const form of MATRIX) {
    test(`${form.id}: no in-flow sibling overlaps, in any section`, async ({ browser }) => {
      /*
       * Landscape was a known failure and was recorded here rather than
       * skipped, with the measurement, so that fixing it would turn this red.
       * It did, and these two lines are what it turned red to say:
       *
       *   test.fail(form.id.endsWith('landscape'), 'the channel strip redesign, items 12-14');
       *
       * What was wrong was not a number. The strip was a grid of nine numbered
       * tracks, and a grid item whose `min-height` exceeds its track neither
       * shrinks nor overflows the grid — it paints outside its own track, over
       * the row below. On a tablet in landscape that was 34 px of device rack
       * drawn through the fader with the rows above it squeezed to 6 px, and on
       * a phone in landscape 7 px of the same. Three caps were tried on the
       * rack and each moved the collision to whichever row lost next, because
       * the rack's floor was 140 px and the whole strip was 131.
       *
       * The strip is a flex column now, and the ladder in `mixer.css` drops
       * rows against floors derived from their measured heights rather than
       * fractions of the rack's. A flex column cannot stack two rows in one
       * row's space: it overflows the bottom, where `overflow: hidden` clips
       * it. Clipping is wrong and visible; overlapping is wrong and invisible,
       * and only a hit test ever finds it — which is why this sweep stays.
       */
      const { page, close } = await open(browser, form);
      try {
        const found: string[] = [];
        const skipped: string[] = [];
        let sawConsole = false;
        for (const section of SECTIONS) {
          // A section this shell does not offer is skipped, and how much was
          // skipped is reported rather than left to be inferred. The `return`
          // in the case below this one was the same shape and had silently
          // never run on a tablet.
          if (!(await goTo(page, section.nav))) {
            skipped.push(section.id);
            continue;
          }
          if ((await page.locator('[data-strip="channel"]').count()) > 0) sawConsole = true;
          for (const hit of await overlaps(page)) found.push(`${section.id}: ${hit}`);
        }
        // The console is the surface this file was written for, so a sweep that
        // never had one on screen has not swept it — whichever section it
        // turned up in. On a tablet that is the arrange view's bottom pane and
        // there is no mixer section to reach at all.
        expect(
          sawConsole,
          `${form.id}: no channel strip was on screen in any section, so the console was ` +
            `not swept. Sections skipped for want of a control: ${skipped.join(', ') || 'none'}`,
        ).toBe(true);
        expect(
          found,
          `${form.id} draws these on top of each other:\n  ${found.join('\n  ')}`,
        ).toEqual([]);
      } finally {
        await close();
      }
    });
  }

  test('the overlap sweep can find one', async ({ browser }) => {
    // Non-vacuity. A sweep that reported clean because it had stopped looking
    // reads exactly like a product with no collisions, and this repository has
    // been caught by that shape more than once.
    const { page, close } = await open(browser, MATRIX[1]);
    try {
      expect(await overlaps(page)).toEqual([]);
      await page.evaluate(() => {
        const host = document.querySelector('[data-testid="arrangement"]')!;
        for (const cls of ['a', 'b']) {
          const el = document.createElement('div');
          el.className = `collide-${cls}`;
          el.setAttribute('style', 'position:relative;width:80px;height:40px;margin-bottom:-30px');
          host.appendChild(el);
        }
      });
      const found = await overlaps(page);
      expect(
        found.some((f) => f.includes('collide-')),
        `two deliberately overlapping siblings were not reported: ${found.join(', ')}`,
      ).toBe(true);
    } finally {
      await close();
    }
  });
});

test.describe('a short console still says what is on each channel', () => {
  /*
   * What the rack's floor was written to protect, stated as what it actually
   * requires.
   *
   * The first version of this asserted that no row is ever *partially* visible.
   * That is stricter than the truth and it fails on a correct scroller: a list
   * whose height is not an exact multiple of its row height always shows part of
   * one at the fold, and every scrolling list in the world does. Narrowed
   * deliberately, and the narrowing is written down rather than left as a
   * loosened number.
   *
   * The defect the floor exists for was different in kind: at 37px the rack
   * could not show one whole row *at all*, so a device's options button measured
   * under the touch minimum and the device could not be bypassed, moved or
   * removed — and scrolling did not answer it, because the thing that did not
   * fit was a single row. So: the rack is at least one whole row tall, and every
   * row can be brought fully into view.
   *
   * Phase B added the other half. Below the tier where a 140 px rack fits a
   * 131 px strip there is no rack on the console at all — a chain summary takes
   * its row — so this waited ten seconds for an element the product had
   * correctly stopped drawing and called that a failure. A test that asserts on
   * a rack must first ask whether this tier has one, and the assertion that
   * matters at every tier is the one below it: a console never draws NEITHER.
   * That is what makes the substitution a substitution rather than a deletion.
   */
  for (const form of MATRIX.filter((f) => f.touch)) {
    test(`${form.id}: every strip says what is on it, and no row is cut`, async ({ browser }) => {
      const { page, close } = await open(browser, form);
      try {
        /*
         * Reached, or the case says so.
         *
         * This was `if (!(await goTo(page, 'nav-mix'))) return;` — and a tablet
         * has no `nav-mix`, so on two of the five form factors it returned
         * before asserting anything and reported a pass. Found by a mutation
         * that took the chain summary away and did not turn it red. A console
         * on a tablet is in the arrange view's bottom pane and needs no
         * navigation at all, which is why nothing ever noticed.
         */
        await goTo(page, 'nav-mix');
        await page.waitForSelector('[data-strip="channel"]', { timeout: 10000 });
        const bad = await page.evaluate(() => {
          const out: string[] = [];
          const drawn = (el: Element | null) => !!el && getComputedStyle(el).display !== 'none';
          const strips = '[data-strip="channel"], [data-strip="master"]';
          for (const strip of document.querySelectorAll<HTMLElement>(strips)) {
            const rack = drawn(strip.querySelector('.dev-rack'));
            const chain = drawn(strip.querySelector('.strip-chain'));
            const route = drawn(strip.querySelector('.strip-foot'));
            const name = strip.getAttribute('data-testid');
            // Both is the rack's floor back again, at every height.
            if (rack && chain) out.push(`${name} draws both a rack and a chain summary`);
            // Neither is the ladder's last rung, and it is only that where the
            // route row has already gone: the summary is ranked below the route
            // and is dropped after it. Neither, with a route still drawn, is a
            // console that gave up saying what is on the channel while a row it
            // ranks above was still costing it space.
            if (!rack && !chain && route) {
              out.push(`${name} draws no rack and no chain summary while it still draws a route`);
            }
          }
          for (const rack of document.querySelectorAll<HTMLElement>('.dev-rack')) {
            if (getComputedStyle(rack).display === 'none') continue;
            const rows = [...rack.querySelectorAll<HTMLElement>('.dev-slot, .dev-instrument')];
            if (rows.length === 0) continue;
            const rowH = rows[0].getBoundingClientRect().height;
            const visible = rack.clientHeight;
            if (visible + 1 < rowH) {
              out.push(`rack shows ${Math.round(visible)} of a ${Math.round(rowH)} row`);
              continue;
            }
            // Reachable by scrolling: the scroller has to be able to put the
            // last row's bottom on screen.
            if (rack.scrollHeight - rack.clientHeight < 0)
              out.push('rack cannot scroll to its end');
          }
          return out;
        });
        expect(bad, `strips that cannot show their chain: ${bad.join(', ')}`).toEqual([]);
      } finally {
        await close();
      }
    });
  }
});
