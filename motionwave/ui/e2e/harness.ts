/**
 * What every browser-measured cell needs before it can measure anything.
 *
 * Extracted when `panel.spec.ts` crossed four hundred lines holding three
 * different cells — U21, U22 and V27. The seam was already there: one file per
 * claim. What is shared is the booting and the geometry reading, and sharing it
 * is the point rather than a convenience: `layoutSignature` existed twice
 * before this, and both copies carried the same wrong assumption.
 */
import { expect, type Page } from '@playwright/test';

/** The touch minimum, in CSS pixels. A diameter, not a radius. */
export const TOUCH_MIN = 44;

export async function boot(page: Page, unit = 'fx-01') {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`/?unit=${unit}`);
  // Cross-origin isolation, without which SharedArrayBuffer does not exist and
  // the worklet has no way to publish that does not allocate per block. Checked
  // first because every failure downstream of it is confusing.
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
  await page.evaluate(() => window.__mwPanel.start());
  expect(errors, errors.join('\n')).toEqual([]);
  return errors;
}

/**
 * Everything a breakpoint in this stylesheet is allowed to move, as one string.
 *
 * One helper rather than a copy per test. There were two copies and they held
 * the same wrong assumption twice: both counted grid columns and required the
 * count to *rise* across a breakpoint. The stylesheet does neither reliably —
 * the first breakpoint raises `--mw-ctl-min` without necessarily changing how
 * many controls fit, and the second turns the body from a column into a row, so
 * the controls grid takes half the width and the count falls (7 to 2 on the
 * Motion Shaper). Both are the layout changing exactly as declared, and both
 * failed a check that only knew one shape of change.
 */
export async function layoutSignature(page: Page): Promise<string> {
  return page.evaluate(() => {
    const grid = document.querySelector('.mw-panel-controls') as HTMLElement;
    const body = document.querySelector('.mw-panel-body') as HTMLElement;
    const style = getComputedStyle(grid);
    return [
      style.gridTemplateColumns.split(' ').length,
      style.getPropertyValue('--mw-ctl-min').trim(),
      getComputedStyle(body).flexDirection,
    ].join('|');
  });
}

/** The four widths that straddle a face's declared breakpoints. */
export function straddling(breakpoints: readonly number[], rootFontPx: number): number[] {
  const widths: number[] = [];
  for (const em of breakpoints) {
    widths.push(Math.round(em * rootFontPx) - 8, Math.round(em * rootFontPx) + 8);
  }
  return widths;
}
