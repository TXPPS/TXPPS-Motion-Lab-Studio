/**
 * Layout audit harness: loads the app at each QA viewport, measures REAL
 * rendered geometry, and reports structural defects. Read-only — no fixes.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:4173';
const OUT = 'audit-out';
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop-1440x900', w: 1440, h: 900 },
  { name: 'desktop-1280x800', w: 1280, h: 800 },
  { name: 'tablet-1024x768', w: 1024, h: 768 },
  { name: 'tablet-768x1024', w: 768, h: 1024 },
  { name: 'phone-390x844', w: 390, h: 844 },
  { name: 'phone-844x390', w: 844, h: 390 },
];

const probe = () => {
  const de = document.documentElement;
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return {
      x: Math.round(b.x),
      y: Math.round(b.y),
      w: Math.round(b.width),
      h: Math.round(b.height),
      right: Math.round(b.right),
      bottom: Math.round(b.bottom),
    };
  };
  const q = (sel) => document.querySelector(sel);
  const scroller = (el) =>
    el
      ? {
          scrollW: el.scrollWidth,
          clientW: el.clientWidth,
          scrollH: el.scrollHeight,
          clientH: el.clientHeight,
          hRange: el.scrollWidth - el.clientWidth,
          vRange: el.scrollHeight - el.clientHeight,
          overflowX: getComputedStyle(el).overflowX,
          overflowY: getComputedStyle(el).overflowY,
        }
      : null;

  // find every element that overflows the viewport horizontally
  const overflowing = [];
  for (const el of document.querySelectorAll('*')) {
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    if (b.right > de.clientWidth + 1 || b.left < -1) {
      overflowing.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className?.baseVal ?? el.className ?? '').toString().slice(0, 60),
        testid: el.getAttribute('data-testid') || '',
        left: Math.round(b.left),
        right: Math.round(b.right),
        w: Math.round(b.width),
      });
    }
    if (overflowing.length > 40) break;
  }

  // mixer strip geometry
  const strips = [...document.querySelectorAll('.strip')].map((el) => {
    const b = el.getBoundingClientRect();
    const kids = [...el.children].map((c) => {
      const cb = c.getBoundingClientRect();
      return {
        cls: (c.className || '').toString().slice(0, 30),
        overflowsX: cb.right > b.right + 0.5 || cb.left < b.left - 0.5,
        overflowsY: cb.bottom > b.bottom + 0.5,
        h: Math.round(cb.height),
      };
    });
    return {
      name: el.getAttribute('data-testid'),
      w: Math.round(b.width),
      h: Math.round(b.height),
      contentH: el.scrollHeight,
      overflowsOwnHeight: el.scrollHeight > Math.ceil(b.height) + 1,
      childrenOverflowing: kids.filter((k) => k.overflowsX || k.overflowsY),
    };
  });

  const mixer = q('[data-testid="mixer"]');
  const arrScroll = q('[data-testid="arr-scroll"]');
  const headersCol = q('.arr-headers');
  const lanes = q('.arr-lanes');

  // does the page itself scroll?
  const bodyStyle = getComputedStyle(document.body);

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    visual: window.visualViewport
      ? { w: Math.round(window.visualViewport.width), h: Math.round(window.visualViewport.height) }
      : null,
    doc: {
      scrollW: de.scrollWidth,
      clientW: de.clientWidth,
      scrollH: de.scrollHeight,
      clientH: de.clientHeight,
      hOverflow: de.scrollWidth - de.clientWidth,
      vOverflow: de.scrollHeight - de.clientHeight,
      bodyOverflow: `${bodyStyle.overflowX}/${bodyStyle.overflowY}`,
    },
    layout: document.querySelector('[data-testid="app-root"]')?.getAttribute('data-layout'),
    rects: {
      appRoot: r(q('[data-testid="app-root"]')),
      topbar: r(q('.topbar')),
      transport: r(q('[data-testid="transport"]')),
      arrangement: r(q('[data-testid="arrangement"]')),
      arrScroll: r(arrScroll),
      headers: r(headersCol),
      lanes: r(lanes),
      editor: r(q('[data-testid="bottom-editor"]')),
      mixer: r(mixer),
      statusbar: r(q('[data-testid="statusbar"]')),
      bottomnav: r(q('[data-testid="bottomnav"]')),
      browserSide: r(q('[data-testid="browser-side"]')),
      inspectorSide: r(q('[data-testid="inspector-side"]')),
    },
    scrollers: {
      arrangement: scroller(arrScroll),
      mixer: scroller(mixer),
      headersColumn: scroller(headersCol),
    },
    strips: strips.slice(0, 6),
    stripCount: strips.length,
    minStripWidth: strips.length ? Math.min(...strips.map((s) => s.w)) : null,
    overflowing: overflowing.slice(0, 20),
    overflowCount: overflowing.length,
  };
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--autoplay-policy=no-user-gesture-required'],
});

const report = {};
for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="transport"]', { timeout: 15000 });
  await page.waitForTimeout(600);
  const data = await page.evaluate(probe);
  report[vp.name] = data;
  await page.screenshot({ path: `${OUT}/audit-${vp.name}.png`, fullPage: false });

  // phone: also capture the mix mode where strips live
  if (vp.w < 700 || vp.h < 500) {
    await page.click('[data-testid="nav-mix"]').catch(() => {});
    await page.waitForTimeout(400);
    report[`${vp.name}-mix`] = await page.evaluate(probe);
    await page.screenshot({ path: `${OUT}/audit-${vp.name}-mix.png` });
  }
  await page.close();
}

writeFileSync(`${OUT}/audit.json`, JSON.stringify(report, null, 2));

// concise console summary
for (const [name, d] of Object.entries(report)) {
  console.log(`\n=== ${name} (${d.layout}) ===`);
  console.log(
    `  doc: scrollW=${d.doc.scrollW} clientW=${d.doc.clientW} hOverflow=${d.doc.hOverflow} | scrollH=${d.doc.scrollH} clientH=${d.doc.clientH} vOverflow=${d.doc.vOverflow}`,
  );
  const a = d.scrollers.arrangement;
  console.log(
    `  arrScroll: ${a ? `hRange=${a.hRange} vRange=${a.vRange} ovf=${a.overflowX}/${a.overflowY}` : 'ABSENT'}`,
  );
  const m = d.scrollers.mixer;
  console.log(
    `  mixer: ${m ? `hRange=${m.hRange} vRange=${m.vRange} ovf=${m.overflowX}/${m.overflowY}` : 'ABSENT'}`,
  );
  console.log(`  strips: count=${d.stripCount} minWidth=${d.minStripWidth}`);
  const badStrips = d.strips.filter((s) => s.overflowsOwnHeight || s.childrenOverflowing.length);
  if (badStrips.length) console.log(`  BROKEN STRIPS: ${JSON.stringify(badStrips.slice(0, 3))}`);
  console.log(`  overflowing els: ${d.overflowCount}`);
  if (d.overflowCount)
    console.log(
      `    ${d.overflowing
        .slice(0, 5)
        .map((o) => `${o.testid || o.cls}(right=${o.right})`)
        .join(', ')}`,
    );
  const R = d.rects;
  if (R.arrangement && R.editor && R.arrangement.bottom > R.editor.y + 1)
    console.log(`  OVERLAP: arrangement.bottom=${R.arrangement.bottom} > editor.top=${R.editor.y}`);
  if (R.appRoot && R.appRoot.h > d.viewport.h + 1)
    console.log(`  APP ROOT TALLER THAN VIEWPORT: ${R.appRoot.h} > ${d.viewport.h}`);
}

await browser.close();
console.log(`\nWrote ${OUT}/audit.json and screenshots.`);
