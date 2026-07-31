/** Focused probes for the two worst defects: mixer strip internals + header scroll sync. */
import { chromium } from '@playwright/test';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:4173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="transport"]');
await page.waitForTimeout(500);

console.log('=== MIXER STRIP INTERNAL GEOMETRY (desktop, default panel height) ===');
console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const strip = document.querySelector('.strip');
      if (!strip) return 'no strip';
      const sb = strip.getBoundingClientRect();
      const cs = getComputedStyle(strip);
      const rows = [...strip.children].map((c) => {
        const b = c.getBoundingClientRect();
        return {
          cls: (c.className || '').toString().slice(0, 24),
          top: Math.round(b.top - sb.top),
          bottom: Math.round(b.bottom - sb.top),
          h: Math.round(b.height),
          spillsBelow: b.bottom > sb.bottom + 0.5,
        };
      });
      // natural (unconstrained) content height
      const natural = [...strip.children].reduce((a, c) => a + c.getBoundingClientRect().height, 0);
      return {
        stripBox: { w: Math.round(sb.width), h: Math.round(sb.height) },
        stripScrollH: strip.scrollHeight,
        padding: cs.padding,
        gap: cs.gap,
        sumOfChildren: Math.round(natural),
        rows,
        verdict:
          strip.scrollHeight > Math.ceil(sb.height) + 1
            ? 'CONTENT EXCEEDS STRIP BOX — children overlap/clip'
            : 'fits',
      };
    }),
    null,
    2,
  ),
);

console.log('\n=== DO M/S BUTTONS OVERLAP THE FADER/METER? ===');
console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const strip = document.querySelector('.strip');
      const mid = strip.querySelector('.strip-mid');
      const btns = strip.querySelector('.strip-btns');
      if (!mid || !btns) return 'missing';
      const m = mid.getBoundingClientRect();
      const b = btns.getBoundingClientRect();
      return {
        midBottom: Math.round(m.bottom),
        btnsTop: Math.round(b.top),
        overlapPx: Math.round(m.bottom - b.top),
        overlapping: m.bottom > b.top + 0.5,
      };
    }),
    null,
    2,
  ),
);

console.log('\n=== TRACK HEADER COLUMN: can it scroll independently? ===');
console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const headers = document.querySelector('.arr-headers');
      const inner = document.querySelector('.arr-headers-inner');
      const scroll = document.querySelector('[data-testid="arr-scroll"]');
      return {
        headersOverflowY: getComputedStyle(headers).overflowY,
        headersScrollRange: headers.scrollHeight - headers.clientHeight,
        headersIsScroller: headers.scrollHeight > headers.clientHeight,
        innerPosition: getComputedStyle(inner).position,
        innerTransform: getComputedStyle(inner).transform,
        arrScrollTop: scroll.scrollTop,
        note: 'headers are JS-translated from arr-scroll onScroll; wheel over headers does nothing',
      };
    }),
    null,
    2,
  ),
);

// Does wheeling over the track headers scroll the tracks?
console.log('\n=== WHEEL OVER TRACK HEADERS ===');
const before = await page.evaluate(
  () => document.querySelector('[data-testid="arr-scroll"]').scrollTop,
);
await page.mouse.move(100, 400); // over the header column
await page.mouse.wheel(0, 300);
await page.waitForTimeout(300);
const after = await page.evaluate(
  () => document.querySelector('[data-testid="arr-scroll"]').scrollTop,
);
console.log(
  JSON.stringify({ scrollTopBefore: before, scrollTopAfter: after, scrolled: after !== before }),
);

// Does shift+wheel scroll the timeline horizontally?
console.log('\n=== SHIFT+WHEEL OVER TIMELINE (horizontal scroll) ===');
const hBefore = await page.evaluate(
  () => document.querySelector('[data-testid="arr-scroll"]').scrollLeft,
);
await page.mouse.move(800, 400);
await page.keyboard.down('Shift');
await page.mouse.wheel(0, 300);
await page.keyboard.up('Shift');
await page.waitForTimeout(300);
const hAfter = await page.evaluate(
  () => document.querySelector('[data-testid="arr-scroll"]').scrollLeft,
);
console.log(
  JSON.stringify({
    scrollLeftBefore: hBefore,
    scrollLeftAfter: hAfter,
    scrolled: hAfter !== hBefore,
  }),
);

// Ruler sync check after horizontal scroll
console.log('\n=== RULER / CLIP HORIZONTAL SYNC ===');
await page.evaluate(() => {
  document.querySelector('[data-testid="arr-scroll"]').scrollLeft = 400;
});
await page.waitForTimeout(200);
console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const ruler = document.querySelector('[data-testid="ruler"]').getBoundingClientRect();
      const clip = document.querySelector('.clip')?.getBoundingClientRect();
      const headers = document.querySelector('.arr-headers').getBoundingClientRect();
      return {
        rulerLeft: Math.round(ruler.left),
        firstClipLeft: clip ? Math.round(clip.left) : null,
        headersRight: Math.round(headers.right),
        clipDrawsOverHeaders: clip ? clip.left < headers.right - 0.5 : false,
      };
    }),
    null,
    2,
  ),
);

await browser.close();
