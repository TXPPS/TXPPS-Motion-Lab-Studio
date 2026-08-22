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
 * SHOT_W, SHOT_H, SHOT_CLIP (CSS selector to capture instead of the page).
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
  } catch {}
}, theme);
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
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
