/**
 * Reaching a control the way a hand reaches it.
 *
 * `el.click()` dispatches one `click` event straight at a node. It does not
 * ask whether anything is on top of that node, whether the node is on screen,
 * or whether the gesture a user would make gets that far — so a control that
 * is covered, clipped, invisible, or that moves out from under the press is
 * clicked exactly as happily as one that works. Three defects reached users
 * behind that: the drum rack's Insert button, which re-laid out 107 px between
 * `pointerdown` and `pointerup`; the device options button on touch, which was
 * `opacity: 0` with hover the only rule that revealed it; and the same button
 * wrapping onto a second line and landing on top of the Insert button. All
 * three were under a passing test that used `el.click()`.
 *
 * So the rule, and the reason it needs a helper rather than a review note:
 *
 *   **A test that asserts a control is reachable must drive a real pointer
 *   sequence — pointerdown, pointermove, pointerup — with the pointerType of
 *   the form factor it claims, and must land on the coordinates rather than on
 *   the node.**
 *
 * `reach()` below is that. Playwright's `tap()` and `click()` deliver trusted
 * input through the browser's own hit test, which is the part that cannot be
 * faked from script; what this adds is the diagnosis. When the press lands
 * somewhere else the failure names what it landed on, because "the click did
 * nothing" and "the click went to the Insert button" are the same symptom and
 * take completely different fixes.
 *
 * `scripts/checks/reachability-gestures.mjs` fails the build when a spec
 * asserts reachability without coming through here.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** Which hand is being claimed. A phone spec that sends mouse events proves nothing. */
export type Hand = 'touch' | 'mouse';

/** What a press at a given point actually finds. */
export interface Landing {
  /** True when the topmost element at the point is the target or inside it. */
  onTarget: boolean;
  /** What is topmost there, described well enough to fix it. */
  found: string;
  /** The target's own box, for the size assertions that go beside this one. */
  box: { x: number; y: number; width: number; height: number };
}

/**
 * What a press at the centre of `locator` would land on.
 *
 * The question `el.click()` never asks. Reported rather than thrown so a
 * caller can assert on it, or measure a whole rack of controls and name every
 * one that is covered in a single failure.
 */
export async function landing(locator: Locator): Promise<Landing> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const describe = (n: Element | null): string => {
      if (!n) return 'nothing (off screen, or under no element)';
      const id = n.getAttribute('data-testid');
      const cls = (n.getAttribute('class') ?? '').split(' ').filter(Boolean)[0];
      return `<${n.tagName.toLowerCase()}${id ? ` data-testid="${id}"` : ''}${cls ? `.${cls}` : ''}>`;
    };
    return {
      onTarget: at !== null && (at === el || el.contains(at)),
      found: describe(at),
      box: { x: r.x, y: r.y, width: r.width, height: r.height },
    };
  });
}

/**
 * How big the target actually is, found by pressing rather than by reading CSS.
 *
 * The codebase's answer for a control that must stay small is an `::after` at
 * a negative inset, and `orientation.spec.ts` measures it by adding the
 * declared inset to the border box. That is the *intended* rectangle. It is
 * not the reachable one, and inside a scroller the two are nowhere near each
 * other: `.dev-list` is `overflow-y: auto`, so a pseudo-element reaching past
 * its row is clipped by it — measured, `.dev-power`'s declared 44 x 44 had a
 * reachable area of 16 x 16, and at one point 1 x 1, because the neighbouring
 * row's hit area covered it and painted later.
 *
 * So this walks outward from the centre and asks the browser, one pixel at a
 * time, where the control stops answering. It costs a few hundred hit tests
 * and it cannot be wrong about clipping, stacking or a neighbour on top.
 */
/** WCAG 2.5.8's minimum, in CSS pixels. */
export const TOUCH_MIN = 44;

/**
 * How much shorter than the truth `reachableBox` can read.
 *
 * It establishes a size by hit-testing outward on the pixel grid, which is the
 * right question — it is what a finger actually meets — and it therefore cannot
 * resolve better than about a pixel. A control built to exactly `TOUCH_MIN`
 * measures 43.
 *
 * This is an allowance on the *instrument*, not on the requirement, and it is
 * worth the distinction: the sampler library's rows read 41 for a while, two
 * attempts went into making the control bigger, and what was actually wrong was
 * that the on-screen keyboard clipped the last row. The ruler had been right
 * both times. Widen this only with a measurement of what is on top.
 */
export const RULER_SLACK = 1;

export async function reachableBox(locator: Locator): Promise<{ width: number; height: number }> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const mine = (x: number, y: number) => {
      const at = document.elementFromPoint(x, y);
      return at !== null && (at === el || el.contains(at));
    };
    if (!mine(cx, cy)) return { width: 0, height: 0 };
    const walk = (dx: number, dy: number) => {
      let d = 0;
      // 60 is past any target this product draws; a control that reaches
      // further than that is a bug of the opposite kind.
      while (d < 60 && mine(cx + dx * (d + 1), cy + dy * (d + 1))) d++;
      // The boundary sits somewhere between `d` and `d + 1`, and the centre a
      // walk starts from is rarely on a whole pixel. Stopping at the last whole
      // step therefore under-reports by up to a pixel each way, and a control
      // built to exactly the 44pt minimum measured 42 — the product was right
      // and the ruler was short. Half a pixel of resolution is all it takes to
      // tell 44 from 43, and it can only ever make a measurement larger, so no
      // target this has already passed can start failing.
      if (d < 60 && mine(cx + dx * (d + 0.5), cy + dy * (d + 0.5))) return d + 0.5;
      return d;
    };
    return {
      width: walk(-1, 0) + walk(1, 0) + 1,
      height: walk(0, -1) + walk(0, 1) + 1,
    };
  });
}

/**
 * Press a control the way `hand` presses things, and fail saying what got in
 * the way.
 *
 * The hit test runs first and on its own. Playwright's own actionability check
 * would catch most of these, but it reports "element intercepts pointer
 * events" and names the *ancestor* — which is true and unhelpful. Asking
 * `elementFromPoint` directly names the thing on top.
 */
export async function reach(locator: Locator, hand: Hand, what: string): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const found = await landing(locator);
  expect(
    found.onTarget,
    `${what}: a ${hand === 'touch' ? 'finger' : 'pointer'} at the centre of this control ` +
      `lands on ${found.found}. It is ${Math.round(found.box.width)}x${Math.round(found.box.height)} ` +
      `at ${Math.round(found.box.x)},${Math.round(found.box.y)}.`,
  ).toBe(true);
  // A real sequence, not a synthesised click. `tap()` needs `hasTouch` on the
  // context; a spec that claims touch and has not set it is claiming a form
  // factor it is not running, so the failure is deliberately left to surface.
  if (hand === 'touch') await locator.tap();
  else await locator.click();
}

/**
 * The press that the drum rack's Insert button failed: down, move, up, with
 * the target measured at each step.
 *
 * A layout that changes between `pointerdown` and `pointerup` delivers the
 * release to whatever has moved into the gap, and no `click` handler ever
 * fires. Playwright's `click()` would report success here — it presses and
 * releases at coordinates it chose before the press — so this is the one case
 * that needs the steps taken apart.
 */
export async function pressAndRelease(
  page: Page,
  locator: Locator,
  hand: Hand,
  what: string,
): Promise<{ movedBy: number }> {
  await locator.scrollIntoViewIfNeeded();
  const before = (await locator.boundingBox())!;
  const x = before.x + before.width / 2;
  const y = before.y + before.height / 2;

  if (hand === 'touch') {
    await page.touchscreen.tap(x, y);
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y);
    await page.mouse.up();
  }

  const after = await locator.boundingBox();
  const movedBy = after ? Math.abs(after.y - before.y) + Math.abs(after.x - before.x) : 0;
  expect(
    movedBy,
    `${what}: the control moved ${Math.round(movedBy)}px during the press, so the release ` +
      'landed somewhere else and no click was ever delivered.',
  ).toBeLessThan(4);
  return { movedBy };
}
