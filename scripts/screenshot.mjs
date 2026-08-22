/**
 * Dev screenshot tool.
 *
 * Renders the running preview build to a PNG so a change can be looked at, not
 * just reasoned about. Playwright's bundled Chromium is used directly (the
 * remote environment pre-installs it) so this never downloads a browser.
 *
 *   npm run preview &
 *   SHOT_DIR=/tmp/shots SHOT_NAME=song SHOT_THEME=dark npm run shot
 *
 * Env: SHOT_DIR (required), SHOT_NAME, SHOT_URL, SHOT_THEME (dark|light|contrast),
 * SHOT_W, SHOT_H, SHOT_CLIP (CSS selector to capture instead of the page),
 * SHOT_CLICK (comma-separated selectors to click first), SHOT_CLICKS (click
 * count, 2 for a double-click), SHOT_SETTLE (ms to wait after each click).
 */
import { chromium } from '@playwright/test';
const OUT = process.env.SHOT_DIR;
const url = process.env.SHOT_URL || 'http://localhost:4173/';
const theme = process.env.SHOT_THEME || 'dark';
const clipSel = process.env.SHOT_CLIP || '';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const w = Number(process.env.SHOT_W || 1680);
const h = Number(process.env.SHOT_H || 1000);
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text());
});
await page.addInitScript((t) => {
  try {
    localStorage.setItem('motionlab.prefs.v1', JSON.stringify({ theme: t, uiScale: 1 }));
  } catch {
    /* storage disabled in this context — the default theme is fine */
  }
}, theme);
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);

/*
 * Reach a surface that needs a click first.
 *
 * SHOT_CLICK is a comma-separated list of selectors, clicked in order with a
 * settle between each — enough to open an editor tab, a device window or a
 * panel. Without it the only thing that could ever be looked at was whatever
 * the app boots into, which is how a device rack invisible in the default
 * layout survived a full styling pass.
 *
 * A selector that matches nothing is reported and skipped rather than
 * failing: the point is to get a picture, and a partial one still shows
 * something.
 */
for (const sel of (process.env.SHOT_CLICK || '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean)) {
  const el = await page.$(sel);
  if (!el) {
    console.log('no element to click for', sel);
    continue;
  }
  await el.click({ clickCount: Number(process.env.SHOT_CLICKS || 1) }).catch((e) => {
    console.log('could not click', sel, e.message);
  });
  await page.waitForTimeout(Number(process.env.SHOT_SETTLE || 500));
}
const name = process.env.SHOT_NAME || 'shot';
if (clipSel) {
  const el = await page.$(clipSel);
  if (!el) {
    console.log('no element for', clipSel);
  } else {
    await el.screenshot({ path: `${OUT}/${name}.png` });
  }
} else {
  await page.screenshot({ path: `${OUT}/${name}.png` });
}
console.log('shot ->', `${OUT}/${name}.png`);
await browser.close();
