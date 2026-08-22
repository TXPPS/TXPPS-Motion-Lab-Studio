import { test, expect, type Page } from '@playwright/test';

/**
 * Geometry-based layout regression tests.
 *
 * These assert measured rectangles, scroll ranges and overlap — not element
 * presence — because the previous suite passed while the UI was visibly broken.
 * Everything runs against the QA stress fixture (#/qa: 26 tracks, 72 bars,
 * 27 mixer strips) so the scrolling machinery is actually under load.
 */

const VIEWPORTS = [
  { name: 'desktop-1440x900', w: 1440, h: 900, layout: 'desktop' },
  { name: 'desktop-1280x800', w: 1280, h: 800, layout: 'desktop' },
  { name: 'tablet-1024x768', w: 1024, h: 768, layout: 'tablet' },
  { name: 'tablet-768x1024', w: 768, h: 1024, layout: 'tablet' },
  { name: 'phone-390x844', w: 390, h: 844, layout: 'phone' },
  { name: 'phone-844x390', w: 844, h: 390, layout: 'phone' },
] as const;

const MIN_STRIP_W = 84;

async function bootQa(page: Page) {
  await page.goto('/#/qa');
  await page.waitForSelector('[data-testid="transport"]', { timeout: 20000 });
  // stress fixture renders a lot of DOM; let layout settle
  await page.waitForTimeout(500);
}

async function rect(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom };
  }, selector);
}

async function scrollInfo(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return null;
    return {
      hRange: el.scrollWidth - el.clientWidth,
      vRange: el.scrollHeight - el.clientHeight,
      left: el.scrollLeft,
      top: el.scrollTop,
    };
  }, selector);
}

test.describe('document never scrolls', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: no page-level scrolling and correct breakpoint`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await bootQa(page);

      await expect(page.locator('[data-testid="app-root"]')).toHaveAttribute(
        'data-layout',
        vp.layout,
      );

      const doc = await page.evaluate(() => {
        const de = document.documentElement;
        return {
          scrollW: de.scrollWidth,
          clientW: de.clientWidth,
          scrollH: de.scrollHeight,
          clientH: de.clientHeight,
        };
      });
      expect(doc.scrollW, `${vp.name} horizontal page overflow`).toBeLessThanOrEqual(
        doc.clientW + 1,
      );
      // the workstation must never become the document scroller
      expect(doc.scrollH, `${vp.name} vertical page overflow`).toBeLessThanOrEqual(doc.clientH + 1);

      // app root fits the viewport exactly
      const root = await rect(page, '[data-testid="app-root"]');
      expect(root!.h).toBeLessThanOrEqual(vp.h + 1);
    });

    test(`${vp.name}: no element escapes the viewport horizontally`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await bootQa(page);
      // reuses the app's own overflow detector (skips legitimate scroll content)
      const offenders = await page.evaluate(() => {
        const w = window as unknown as { __mlLayout?: { findOverflowing: () => unknown[] } };
        return w.__mlLayout ? w.__mlLayout.findOverflowing() : [];
      });
      expect(offenders, `${vp.name} overflowing elements`).toEqual([]);
    });
  }
});

test.describe('fixed chrome stays fixed while content scrolls', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: bars do not move when the arrangement scrolls`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await bootQa(page);
      if (vp.layout === 'phone') await page.click('[data-testid="nav-arrange"]');

      const topBefore = await rect(page, '.topbar');
      const transportBefore = await rect(page, '[data-testid="transport"]');
      const bottomSel =
        vp.layout === 'phone' ? '[data-testid="bottomnav"]' : '[data-testid="statusbar"]';
      const bottomBefore = await rect(page, bottomSel);

      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="arr-scroll"]') as HTMLElement;
        el.scrollLeft = Math.floor((el.scrollWidth - el.clientWidth) / 2);
        el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2);
      });
      await page.waitForTimeout(250);

      expect(await rect(page, '.topbar')).toEqual(topBefore);
      expect(await rect(page, '[data-testid="transport"]')).toEqual(transportBefore);
      expect(await rect(page, bottomSel)).toEqual(bottomBefore);
    });
  }
});

test.describe('arrangement dual-axis scrolling', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: both axes have real scroll range under stress`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await bootQa(page);
      if (vp.layout === 'phone') await page.click('[data-testid="nav-arrange"]');

      const s = await scrollInfo(page, '[data-testid="arr-scroll"]');
      expect(s, `${vp.name} arrangement scroller missing`).not.toBeNull();
      expect(s!.hRange, `${vp.name} horizontal scroll range`).toBeGreaterThan(0);
      expect(s!.vRange, `${vp.name} vertical scroll range`).toBeGreaterThan(0);
    });

    test(`${vp.name}: ruler and track headers stay pinned while scrolling`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await bootQa(page);
      if (vp.layout === 'phone') await page.click('[data-testid="nav-arrange"]');

      const headerBefore = await rect(page, '.arr-header-col');
      const rulerBefore = await rect(page, '[data-testid="ruler"]');
      const laneBefore = await rect(page, '[data-testid="arr-lanes"]');

      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="arr-scroll"]') as HTMLElement;
        el.scrollLeft = Math.floor((el.scrollWidth - el.clientWidth) / 2);
        el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2);
      });
      await page.waitForTimeout(250);

      const headerAfter = await rect(page, '.arr-header-col');
      const rulerAfter = await rect(page, '[data-testid="ruler"]');
      const laneAfter = await rect(page, '[data-testid="arr-lanes"]');

      // headers pinned horizontally, ruler pinned vertically
      expect(Math.abs(headerAfter!.x - headerBefore!.x), 'header column drifted').toBeLessThan(2);
      expect(Math.abs(rulerAfter!.y - rulerBefore!.y), 'ruler drifted').toBeLessThan(2);
      // ...while the timeline content genuinely moved on both axes
      expect(Math.abs(laneAfter!.x - laneBefore!.x)).toBeGreaterThan(50);
      expect(Math.abs(laneAfter!.y - laneBefore!.y)).toBeGreaterThan(20);
    });

    test(`${vp.name}: clips never paint over the track headers`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await bootQa(page);
      if (vp.layout === 'phone') await page.click('[data-testid="nav-arrange"]');
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="arr-scroll"]') as HTMLElement;
        el.scrollLeft = Math.floor((el.scrollWidth - el.clientWidth) / 3);
      });
      await page.waitForTimeout(250);

      // the header column must paint above the lanes (higher stacking context)
      const covered = await page.evaluate(() => {
        const header = document.querySelector('.arr-header-col')!.getBoundingClientRect();
        // sample a point inside the header column, below the ruler
        const x = header.left + header.width / 2;
        const y = header.top + Math.min(header.height - 5, 80);
        const top = document.elementFromPoint(x, y);
        return !!top?.closest('.arr-header-col');
      });
      expect(covered, 'a clip is painting over the track header column').toBe(true);
    });
  }
});

test.describe('mixer geometry', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: strips meet minimum width, fit their box, and scroll`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await bootQa(page);
      if (vp.layout === 'phone') await page.click('[data-testid="nav-mix"]');
      else if (vp.layout === 'tablet') await page.click('[data-testid="combo-mixer"]');
      else await page.click('[data-testid="editor-tab-mixer"]');
      await page.waitForTimeout(350);

      const info = await page.evaluate(() => {
        const mixer = document.querySelector('[data-testid="mixer"]') as HTMLElement;
        const strips = [...document.querySelectorAll<HTMLElement>('.strip')];
        const mixBox = mixer.getBoundingClientRect();
        const escaping: string[] = [];
        let minW = Infinity;
        for (const s of strips) {
          const sb = s.getBoundingClientRect();
          minW = Math.min(minW, sb.width);
          // no descendant may paint outside its own strip
          for (const c of s.querySelectorAll<HTMLElement>('*')) {
            const cb = c.getBoundingClientRect();
            if (cb.width === 0 || cb.height === 0) continue;
            if (
              cb.right > sb.right + 0.5 ||
              cb.left < sb.left - 0.5 ||
              cb.bottom > sb.bottom + 0.5 ||
              cb.top < sb.top - 0.5
            ) {
              escaping.push(`${s.dataset.testid}:${c.className}`);
            }
          }
          // strips must fit inside the mixer row vertically
          if (sb.bottom > mixBox.bottom + 1 || sb.top < mixBox.top - 1) {
            escaping.push(`${s.dataset.testid}:outside-mixer-row`);
          }
        }
        // Strips clip their own overflow, so a row added to the grid would hide
        // content rather than escape. Measure the flexible row and the last row
        // directly: if either is squeezed out, the strip is over-subscribed.
        const first = strips[0];
        const rowOf = (sel: string) => {
          const el = first?.querySelector<HTMLElement>(sel);
          return el ? el.getBoundingClientRect().height : -1;
        };
        const lastRow = first?.querySelector<HTMLElement>('.strip-route');
        const firstBox = first?.getBoundingClientRect();

        return {
          count: strips.length,
          minW,
          escaping: escaping.slice(0, 5),
          hRange: mixer.scrollWidth - mixer.clientWidth,
          contentFits: mixer.scrollHeight <= mixer.clientHeight + 1,
          faderRowH: rowOf('.strip-mid'),
          fxRowH: rowOf('.strip-fx'),
          lastRowVisible:
            !!lastRow &&
            !!firstBox &&
            lastRow.getBoundingClientRect().bottom <= firstBox.bottom + 1,
        };
      });

      expect(info.count, `${vp.name} strip count`).toBeGreaterThan(20);
      expect(info.minW, `${vp.name} minimum strip width`).toBeGreaterThanOrEqual(MIN_STRIP_W);
      expect(info.escaping, `${vp.name} controls escaping their strip`).toEqual([]);
      expect(info.hRange, `${vp.name} mixer horizontal scroll range`).toBeGreaterThan(0);
      expect(info.contentFits, `${vp.name} mixer forced vertical overflow`).toBe(true);
      // The fader must keep its declared minimum even with the insert row present.
      expect(info.faderRowH, `${vp.name} fader row squeezed`).toBeGreaterThanOrEqual(44);
      // The insert row is dropped on short mixers by design; when it is shown it
      // must be at full height rather than squeezed to an unreadable sliver.
      if (info.fxRowH > 0) {
        expect(info.fxRowH, `${vp.name} insert row squeezed`).toBeGreaterThanOrEqual(15);
      }
      expect(info.lastRowVisible, `${vp.name} routing row clipped off the strip`).toBe(true);
    });

    test(`${vp.name}: mixer scrolling does not move the page`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await bootQa(page);
      if (vp.layout === 'phone') await page.click('[data-testid="nav-mix"]');
      else if (vp.layout === 'tablet') await page.click('[data-testid="combo-mixer"]');
      else await page.click('[data-testid="editor-tab-mixer"]');
      await page.waitForTimeout(300);

      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="mixer"]') as HTMLElement;
        el.scrollLeft = Math.floor((el.scrollWidth - el.clientWidth) / 2);
      });
      await page.waitForTimeout(250);

      const after = await page.evaluate(() => ({
        docScrollLeft: document.documentElement.scrollLeft,
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        mixerLeft: (document.querySelector('[data-testid="mixer"]') as HTMLElement).scrollLeft,
      }));
      expect(after.mixerLeft, 'mixer did not scroll').toBeGreaterThan(0);
      expect(after.docScrollLeft, 'page scrolled sideways').toBe(0);
      expect(after.docOverflow, 'mixer scrolling introduced page overflow').toBeLessThanOrEqual(1);
    });
  }
});

test.describe('phone workspaces', () => {
  const PHONE = { width: 390, height: 844 };

  test('exactly one primary workspace is mounted at a time', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await bootQa(page);

    const modes = ['arrange', 'record', 'perform', 'edit', 'mix', 'browse'] as const;
    for (const mode of modes) {
      await page.click(`[data-testid="nav-${mode}"]`);
      await page.waitForTimeout(250);

      const present = await page.evaluate(() => ({
        arrangement: !!document.querySelector('[data-testid="arrangement"]'),
        mixer: !!document.querySelector('[data-testid="mixer"]'),
        pianoRoll: !!document.querySelector('[data-testid="piano-roll"]'),
        synth: !!document.querySelector('[data-testid="synth-panel"]'),
        record: !!document.querySelector('[data-testid="record-workspace"]'),
        browser: !!document.querySelector('[data-testid="browser-panel"]'),
        // desktop side panels must never appear on phone
        desktopSides:
          !!document.querySelector('[data-testid="browser-side"]') ||
          !!document.querySelector('[data-testid="inspector-side"]'),
      }));

      expect(present.desktopSides, `desktop side panels visible in ${mode}`).toBe(false);
      const primaries = [
        present.arrangement,
        present.mixer,
        present.pianoRoll,
        present.synth,
        present.record,
      ].filter(Boolean).length;
      // browse mode intentionally stacks browser + inspector inside one workspace
      if (mode !== 'browse') {
        expect(primaries, `${mode} should mount exactly one primary workspace`).toBe(1);
      }
    }
  });

  test('bottom navigation stays reachable and inside the viewport', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await bootQa(page);
    const nav = await rect(page, '[data-testid="bottomnav"]');
    expect(nav).not.toBeNull();
    expect(nav!.bottom).toBeLessThanOrEqual(PHONE.height + 1);
    expect(nav!.y).toBeGreaterThan(0);
    // every nav item must be clickable within the viewport
    const items = await page.locator('[data-testid="bottomnav"] button').count();
    // arrange, record, perform, edit, mix, browse
    expect(items).toBe(6);
    for (let i = 0; i < items; i++) {
      const b = await page.locator('[data-testid="bottomnav"] button').nth(i).boundingBox();
      expect(b!.x).toBeGreaterThanOrEqual(-1);
      expect(b!.x + b!.width).toBeLessThanOrEqual(PHONE.width + 1);
      expect(b!.height).toBeGreaterThanOrEqual(40);
      // adding modes must never squeeze a tab below a usable tap target
      expect(b!.width, `nav item ${i} too narrow to tap`).toBeGreaterThanOrEqual(44);
    }
  });

  test('phone landscape keeps transport and navigation visible', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await bootQa(page);
    const transport = await rect(page, '[data-testid="transport"]');
    const nav = await rect(page, '[data-testid="bottomnav"]');
    expect(transport!.bottom).toBeLessThan(390);
    expect(nav!.bottom).toBeLessThanOrEqual(391);
    // the workspace between them must still have usable height
    const arr = await rect(page, '[data-testid="arrangement"]');
    expect(arr!.h, 'arrangement squeezed out in landscape').toBeGreaterThan(80);
  });
});

test.describe('transport integrity', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: transport controls stay inside the transport bar`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await bootQa(page);

      const bad = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid="transport"]')!.getBoundingClientRect();
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>(
          '[data-testid="transport"] button, [data-testid="transport"] input, [data-testid="transport"] select, [data-testid="transport"] .t-display',
        )) {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          if (b.right > bar.right + 1 || b.left < bar.left - 1 || b.bottom > bar.bottom + 1) {
            out.push(el.getAttribute('data-testid') ?? el.className);
          }
        }
        return out;
      });
      expect(bad, `${vp.name} transport controls clipped or outside the bar`).toEqual([]);
    });

    test(`${vp.name}: transport controls do not overlap each other`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await bootQa(page);

      const overlaps = await page.evaluate(() => {
        const items = [
          ...document.querySelectorAll<HTMLElement>(
            '[data-testid="transport"] > *, [data-testid="transport"] .t-btns > button',
          ),
        ].filter((el) => {
          const b = el.getBoundingClientRect();
          return b.width > 0 && b.height > 0 && !el.classList.contains('spacer');
        });
        const out: string[] = [];
        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) {
            if (items[i].contains(items[j]) || items[j].contains(items[i])) continue;
            const a = items[i].getBoundingClientRect();
            const b = items[j].getBoundingClientRect();
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox > 1 && oy > 1) {
              out.push(
                `${items[i].className || items[i].tagName}|${items[j].className || items[j].tagName}`,
              );
            }
          }
        }
        return out;
      });
      expect(overlaps, `${vp.name} overlapping transport controls`).toEqual([]);
    });
  }
});

test.describe('major regions do not overlap', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: workspace regions are disjoint`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await bootQa(page);

      const overlaps = await page.evaluate(() => {
        const sels = [
          '.topbar',
          '[data-testid="transport"]',
          '[data-testid="arrangement"]',
          '[data-testid="bottom-editor"]',
          '[data-testid="browser-side"]',
          '[data-testid="inspector-side"]',
          '[data-testid="statusbar"]',
          '[data-testid="bottomnav"]',
        ];
        const boxes = sels
          .map((s) => ({ s, el: document.querySelector(s) }))
          .filter((x) => x.el)
          .map((x) => ({ s: x.s, b: x.el!.getBoundingClientRect() }))
          .filter((x) => x.b.width > 0 && x.b.height > 0);
        const out: string[] = [];
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i].b;
            const b = boxes[j].b;
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox > 2 && oy > 2) out.push(`${boxes[i].s} ∩ ${boxes[j].s}`);
          }
        }
        return out;
      });
      expect(overlaps, `${vp.name} overlapping regions`).toEqual([]);
    });
  }
});

test.describe('safe areas', () => {
  test('bottom inset is applied exactly once', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await bootQa(page);
    // the app root owns top/left/right; the bottom-most bar owns bottom
    const info = await page.evaluate(() => {
      const cs = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el) : null;
      };
      const app = cs('[data-testid="app-root"]')!;
      const nav = cs('[data-testid="bottomnav"]')!;
      return {
        appPaddingBottom: app.paddingBottom,
        navPaddingBottom: nav.paddingBottom,
      };
    });
    // with no simulated inset both resolve to 0 — the assertion is that the app
    // root does not also carry a bottom inset on top of the nav's
    expect(info.appPaddingBottom).toBe('0px');
    expect(info.navPaddingBottom).toBeTruthy();
  });
});
