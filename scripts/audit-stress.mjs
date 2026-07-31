/** Stress-fixture audit: 24 tracks / 72 bars / 26 strips at every QA viewport. */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

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
  const sc = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return {
      hRange: el.scrollWidth - el.clientWidth,
      vRange: el.scrollHeight - el.clientHeight,
      left: Math.round(el.scrollLeft),
      top: Math.round(el.scrollTop),
    };
  };
  const strips = [...document.querySelectorAll('.strip')];
  const stripBad = strips
    .map((s) => {
      const sb = s.getBoundingClientRect();
      const bad = [...s.querySelectorAll('*')].filter((c) => {
        const cb = c.getBoundingClientRect();
        if (cb.width === 0 || cb.height === 0) return false;
        return cb.right > sb.right + 0.5 || cb.left < sb.left - 0.5 || cb.bottom > sb.bottom + 0.5;
      });
      return { name: s.dataset.testid, w: Math.round(sb.width), escapes: bad.length };
    })
    .filter((s) => s.escapes > 0);

  // do sticky headers cover the lanes correctly after scrolling?
  const headers = document.querySelector('.arr-header-col');
  const lanes = document.querySelector('.arr-lanes');
  const ruler = document.querySelector('[data-testid="ruler"]');
  const hb = headers?.getBoundingClientRect();
  const lb = lanes?.getBoundingClientRect();
  const rb = ruler?.getBoundingClientRect();

  return {
    layout: document.querySelector('[data-testid="app-root"]')?.getAttribute('data-layout'),
    docOverflowX: de.scrollWidth - de.clientWidth,
    docOverflowY: de.scrollHeight - de.clientHeight,
    arr: sc('[data-testid="arr-scroll"]'),
    mixer: sc('[data-testid="mixer"]'),
    stripCount: strips.length,
    minStripW: strips.length
      ? Math.min(...strips.map((s) => Math.round(s.getBoundingClientRect().width)))
      : null,
    stripsWithEscapingChildren: stripBad,
    headerLeft: hb ? Math.round(hb.left) : null,
    lanesLeft: lb ? Math.round(lb.left) : null,
    rulerTop: rb ? Math.round(rb.top) : null,
    trackCount: document.querySelectorAll('.th').length,
  };
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--autoplay-policy=no-user-gesture-required'],
});

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
  await page.goto(`${BASE}/#/qa`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="transport"]', { timeout: 15000 });
  await page.waitForTimeout(700);

  const isPhone = vp.w < 700 || vp.h < 500;
  const before = await page.evaluate(probe);
  console.log(`\n=== ${vp.name} (${before.layout}) STRESS ===`);
  console.log(
    `  tracks=${before.trackCount} docOverflow x=${before.docOverflowX} y=${before.docOverflowY}`,
  );
  console.log(
    `  arr: ${before.arr ? `hRange=${before.arr.hRange} vRange=${before.arr.vRange}` : 'absent'}`,
  );
  console.log(
    `  mixer: ${before.mixer ? `hRange=${before.mixer.hRange}` : 'absent'} strips=${before.stripCount} minW=${before.minStripW}`,
  );
  if (before.stripsWithEscapingChildren.length)
    console.log(
      `  !! STRIP OVERFLOW: ${JSON.stringify(before.stripsWithEscapingChildren.slice(0, 3))}`,
    );
  await page.screenshot({ path: `${OUT}/stress-${vp.name}.png` });

  // Scroll the arrangement halfway on both axes and re-check sticky sync
  if (before.arr && before.arr.hRange > 0) {
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="arr-scroll"]');
      el.scrollLeft = Math.floor((el.scrollWidth - el.clientWidth) / 2);
      el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2);
    });
    await page.waitForTimeout(350);
    const after = await page.evaluate(probe);
    const headerStuck =
      after.headerLeft !== null && Math.abs(after.headerLeft - before.headerLeft) < 2;
    const rulerStuck = after.rulerTop !== null && Math.abs(after.rulerTop - before.rulerTop) < 2;
    console.log(
      `  after scroll(${after.arr.left},${after.arr.top}): headers stuck=${headerStuck} ruler stuck=${rulerStuck} docOverflowX=${after.docOverflowX}`,
    );
    await page.screenshot({ path: `${OUT}/stress-${vp.name}-scrolled.png` });
  }

  // Mixer halfway
  if (isPhone) await page.click('[data-testid="nav-mix"]').catch(() => {});
  await page.waitForTimeout(300);
  const mixNow = await page.evaluate(probe);
  if (mixNow.mixer && mixNow.mixer.hRange > 0) {
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="mixer"]');
      el.scrollLeft = Math.floor((el.scrollWidth - el.clientWidth) / 2);
    });
    await page.waitForTimeout(300);
    const m = await page.evaluate(probe);
    console.log(
      `  mixer scrolled to ${m.mixer.left}/${m.mixer.hRange}, strips=${m.stripCount} minW=${m.minStripW}`,
    );
    if (m.stripsWithEscapingChildren.length)
      console.log(
        `  !! STRIP OVERFLOW AFTER SCROLL: ${JSON.stringify(m.stripsWithEscapingChildren.slice(0, 2))}`,
      );
    await page.screenshot({ path: `${OUT}/stress-${vp.name}-mixer.png` });
  } else if (mixNow.mixer) {
    console.log(
      `  mixer hRange=${mixNow.mixer.hRange} (no scroll needed) strips=${mixNow.stripCount}`,
    );
  }

  await page.close();
}

await browser.close();
console.log('\nStress screenshots written to audit-out/.');
