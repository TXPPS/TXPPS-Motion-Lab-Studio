import { test, expect, type Browser, type Page } from '@playwright/test';

/**
 * A double-tap must never zoom the page.
 *
 * Reported from use, and it is the kind of defect that costs more than it looks
 * like: a DAW whose arrangement jumps to 2× because a finger landed twice is a
 * web page, not an instrument, and nothing else in the interface recovers that
 * impression once it has been made.
 *
 * **Two assertions, and only one of them can fail here.** The visual-viewport
 * scale is the user-facing claim and it is the one worth stating — but
 * double-tap-to-zoom is browser chrome, and Chromium under Playwright does not
 * synthesise it whatever the page says. A test that only checked the scale
 * would be green on a page that had never heard of `touch-action`, which is
 * `wasm:check` comparing a file against itself.
 *
 * So each case also asserts the *mechanism*: the effective `touch-action` at the
 * point the finger lands excludes the double-tap gesture. That is computed from
 * the hit element up through its ancestors exactly as the browser does it, it is
 * what actually suppresses the zoom, and it fails the moment the rule goes —
 * which is what makes the pair worth running.
 */

/** `touch-action` values that leave the double-tap zoom gesture enabled. */
const ZOOMABLE = new Set(['auto', 'pan-x pan-y', 'manipulation pan-x pan-y']);

async function phone(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 20000 });
  await page.waitForTimeout(500);
  return { page, close: () => ctx.close() };
}

/**
 * The browser's own answer: the element under (x, y), and the `touch-action`
 * that applies to a touch landing on it.
 *
 * Computed by walking to the document exactly as the specification says the
 * effective value is derived — reading `getComputedStyle` on the hit element
 * alone would report `auto` for every child of a surface that had declared
 * `none`, and call a covered surface a defect.
 */
async function effectiveTouchAction(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ px, py }) => {
      let el = document.elementFromPoint(px, py) as Element | null;
      const chain: string[] = [];
      const hit = el ? `${el.tagName.toLowerCase()}.${(el as HTMLElement).className}` : 'nothing';
      while (el) {
        chain.push(getComputedStyle(el).touchAction);
        el = el.parentElement;
      }
      return { hit, chain };
    },
    { px: x, py: y },
  );
}

/** Does anything in the chain take the double-tap gesture away? */
function suppressed(chain: string[]): boolean {
  return chain.some((value) => !ZOOMABLE.has(value));
}

async function doubleTap(page: Page, x: number, y: number): Promise<number> {
  const before = await page.evaluate(() => window.visualViewport?.scale ?? 1);
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(60);
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.visualViewport?.scale ?? 1);
  return after - before;
}

async function assertNoZoom(page: Page, selector: string, what: string) {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${what}: the surface is not on screen to tap`).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;

  const { hit, chain } = await effectiveTouchAction(page, x, y);
  expect(
    suppressed(chain),
    `${what}: a finger at the centre lands on ${hit}, and every element from there to the ` +
      `document allows the double-tap gesture (${chain.join(' / ')}). The page will zoom.`,
  ).toBe(true);

  expect(
    Math.abs(await doubleTap(page, x, y)),
    `${what}: a double-tap changed the visual viewport scale.`,
  ).toBeLessThan(0.01);
}

test.describe('a double-tap does not zoom the page', () => {
  test('on the arrangement', async ({ browser }) => {
    const { page, close } = await phone(browser);
    try {
      await assertNoZoom(page, '[data-testid="arrangement"]', 'the arrangement');
    } finally {
      await close();
    }
  });

  test('on the mixer', async ({ browser }) => {
    const { page, close } = await phone(browser);
    try {
      // Reached by tapping the shell's own control, with a finger. A spec that
      // navigated by calling a store would be asserting about a surface a user
      // may not be able to get to.
      await page.locator('[data-testid="nav-mix"]').tap();
      await page.waitForSelector('[data-testid="mixer"]', { timeout: 10000 });
      await page.waitForTimeout(300);
      await assertNoZoom(page, '[data-testid="mixer"]', 'the mixer');
    } finally {
      await close();
    }
  });

  test('on the piano roll', async ({ browser }) => {
    const { page, close } = await phone(browser);
    try {
      await page.evaluate(() => {
        const w = window as unknown as {
          __ml?: {
            projectStore?: {
              getState: () => { project: { clips: { id: string; notes?: unknown[] }[] } };
            };
            uiStore?: { getState: () => { openEditorFor: (id: string, phone?: boolean) => void } };
          };
        };
        const clips = w.__ml?.projectStore?.getState().project.clips ?? [];
        const clip = clips.find((c) => (c.notes?.length ?? 0) > 2);
        if (clip) w.__ml?.uiStore?.getState().openEditorFor(clip.id, true);
      });
      await page.waitForSelector('[data-testid="piano-roll"]', { timeout: 10000 });
      await page.waitForTimeout(300);
      await assertNoZoom(page, '[data-testid="piano-roll"]', 'the piano roll');
    } finally {
      await close();
    }
  });

  test('no text field is small enough to make iOS zoom on focus', async ({ browser }) => {
    // The second way the browser zooms a page nobody asked it to, and the one
    // that is not a double-tap at all: iOS Safari zooms whenever a focused text
    // field computes under 16px, and it does not zoom back out. Every field in
    // this app inherits `--fs-md`, which is 12.5px.
    //
    // Asserted rather than reasoned about, because the rule that fixes it is a
    // media query and a media query is exactly the kind of thing that stops
    // matching when a selector moves.
    const { page, close } = await phone(browser);
    try {
      const small = await page.evaluate(() => {
        const out: { where: string; size: number }[] = [];
        const fields = document.querySelectorAll<HTMLElement>(
          'input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=color]),' +
            'textarea, select, [contenteditable=true]',
        );
        for (const el of fields) {
          const size = parseFloat(getComputedStyle(el).fontSize);
          if (size < 16) {
            out.push({
              where: `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : `.${el.className}`}`,
              size,
            });
          }
        }
        return out;
      });
      expect(
        small,
        `text fields under 16px on a phone; focusing any of them zooms iOS Safari and it ` +
          `does not zoom back: ${small.map((f) => `${f.where} at ${f.size}px`).join(', ')}`,
      ).toEqual([]);
    } finally {
      await close();
    }
  });

  test('the mechanism check can fail', async ({ browser }) => {
    // Non-vacuity, and the first draft of it was wrong in a way worth keeping.
    //
    // It attached a `touch-action: auto` probe to `documentElement` and expected
    // the chain to come back unsuppressed. The chain read `auto / manipulation`:
    // `html` itself carries the rule, so there is nowhere in the document a
    // touch can land that is not already covered, and the probe could not
    // out-scope the fix. The product was right and the check was untestable by
    // addition — which is the useful finding, because a check that can only be
    // made to pass is the shape this repository keeps paying for.
    //
    // It is testable by *removal*. Strip the declaration from the three elements
    // that carry it and a plain surface must report as zoomable again. This
    // fails if `base.css` stops declaring it, which is the thing worth knowing.
    const { page, close } = await phone(browser);
    try {
      const box = (await page.locator('[data-testid="arrangement"]').first().boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      expect(suppressed((await effectiveTouchAction(page, x, y)).chain)).toBe(true);

      await page.evaluate(() => {
        for (const el of [
          document.documentElement,
          document.body,
          document.getElementById('root'),
        ]) {
          if (el) (el as HTMLElement).style.setProperty('touch-action', 'auto', 'important');
        }
        // And every surface that declares its own, so what is left is a page
        // with no touch-action anywhere — which is what deleting the rule from
        // `base.css` would leave behind.
        for (const el of document.querySelectorAll<HTMLElement>('*')) {
          el.style.setProperty('touch-action', 'auto', 'important');
        }
      });

      const { chain } = await effectiveTouchAction(page, x, y);
      expect(
        suppressed(chain),
        `with every touch-action stripped the chain still read as suppressed ` +
          `(${chain.join(' / ')}), so the three cases above are not checking anything.`,
      ).toBe(false);
    } finally {
      await close();
    }
  });
});
