/**
 * Directive 02 §1 — BUG-001, the track header control strip.
 *
 * The report was "controls overlap, crowd the name, and collapse below usable
 * touch size". Measured at three phone widths, the overlap did not reproduce:
 * the controls did not intersect. What did reproduce was the other two halves,
 * and both were the same cause — the header column is a fixed 176px that does
 * not answer the viewport, and inside it the buttons are a fixed width with
 * `flex: none`, so the strip could neither grow to a usable size nor collapse
 * by priority. Every control measured 32x30 against the 44pt minimum, and a
 * five-letter track name had 37px for 42px of text.
 *
 * These assertions are geometry, so they live in a browser rather than in
 * jsdom, which lays nothing out and would pass whatever the CSS said.
 */
import { expect, test } from '@playwright/test';

const PHONES = [
  { name: 'small', width: 360, height: 740 },
  { name: 'standard', width: 390, height: 844 },
  { name: 'large', width: 430, height: 932 },
];

/** The touch minimum the directive sets, in CSS pixels. */
const MIN_TOUCH = 44;
/** The minimum gap between adjacent controls. */
const MIN_GAP = 4;

for (const phone of PHONES) {
  test(`track header control strip is usable on a ${phone.name} phone`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: phone.width, height: phone.height },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.addInitScript(() =>
      localStorage.setItem('motionlab.prefs.v1', JSON.stringify({ theme: 'dark', uiScale: 1 })),
    );
    await page.goto('/');
    await page.waitForSelector('[data-testid^="track-header-"]');

    // Passed in rather than closed over: the body runs in the browser, where
    // the module's constants do not exist.
    const report = await page.evaluate(
      ({ minTouch, minGap }) => {
        const headers = [...document.querySelectorAll('[data-testid^="track-header-"]')];
        const rect = (el: Element) => el.getBoundingClientRect();
        const problems: string[] = [];
        let checked = 0;

        for (const header of headers) {
          const strip = header.querySelector('.th-controls');
          if (!strip) continue;
          // A hidden control has a zero-size rect; it is not on screen, so it is
          // neither too small nor overlapping anything.
          const controls = [...strip.children]
            .map((el) => ({ el, box: rect(el) }))
            .filter((c) => c.box.width > 0 && c.box.height > 0);
          const id = header.getAttribute('data-testid') ?? 'header';

          for (const c of controls) {
            checked++;
            if (c.box.width < minTouch || c.box.height < minTouch) {
              problems.push(
                `${id}: ${c.el.className} is ${Math.round(c.box.width)}x${Math.round(c.box.height)}`,
              );
            }
          }
          for (let i = 0; i + 1 < controls.length; i++) {
            const gap = controls[i + 1].box.left - controls[i].box.right;
            if (gap < -0.5) problems.push(`${id}: controls overlap by ${Math.round(-gap)}px`);
            else if (gap < minGap - 0.5) problems.push(`${id}: gap is ${Math.round(gap)}px`);
          }
          // The strip must not spill out of the header it lives in.
          const headerBox = rect(header);
          const stripBox = rect(strip);
          if (stripBox.right > headerBox.right + 0.5) {
            problems.push(
              `${id}: strip overflows the header by ${Math.round(stripBox.right - headerBox.right)}px`,
            );
          }
        }
        return { problems, checked };
      },
      { minTouch: MIN_TOUCH, minGap: MIN_GAP },
    );

    expect(report.checked, 'no controls were measured — the selector is wrong').toBeGreaterThan(0);
    expect(report.problems, report.problems.join('\n')).toEqual([]);
  });

  test(`track name is readable on a ${phone.name} phone`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: phone.width, height: phone.height },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.addInitScript(() =>
      localStorage.setItem('motionlab.prefs.v1', JSON.stringify({ theme: 'dark', uiScale: 1 })),
    );
    await page.goto('/');
    await page.waitForSelector('[data-testid^="track-header-"]');

    // The demo project's longest track name is nine characters. A header that
    // cannot show that is a header that shows nobody's track name.
    const clipped = await page.evaluate(() => {
      const out: string[] = [];
      for (const header of document.querySelectorAll('[data-testid^="track-header-"]')) {
        const name = header.querySelector('.th-name');
        if (!name) continue;
        if (name.scrollWidth > name.clientWidth + 1) {
          out.push(`${name.textContent} needs ${name.scrollWidth}px, has ${name.clientWidth}px`);
        }
      }
      return out;
    });
    expect(clipped, clipped.join('\n')).toEqual([]);
  });
}

test('an audio track offers monitoring, and it is not the mute button', async ({ browser }) => {
  // BUG-002. The report said `M` was doing monitoring; it was not, it was mute.
  // What was true is that mute lit blue, which is monitoring's colour — so the
  // two were indistinguishable by the only cue that carried the difference.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.waitForSelector('[data-testid^="track-header-"]');

  const monitor = page.locator('[data-testid^="monitor-"]').first();
  await expect(monitor).toBeVisible();
  await expect(monitor).toHaveAttribute('aria-pressed', 'false');
  // A loudspeaker, not a letter.
  await expect(monitor.locator('svg')).toHaveCount(1);

  const lamps = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return {
      mute: css.getPropertyValue('--mute-lamp').trim(),
      monitor: css.getPropertyValue('--monitor-lamp').trim(),
    };
  });
  expect(lamps.monitor).not.toBe('');
  expect(lamps.mute).not.toBe(lamps.monitor);
});
