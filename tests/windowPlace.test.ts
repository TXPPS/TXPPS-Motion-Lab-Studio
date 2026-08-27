/**
 * RA-003 — a device window has to open where it can be used.
 *
 * The arithmetic, without a browser. The e2e spec proves the real thing opens
 * inside a real viewport; this pins the placement rules themselves, including
 * the two cases that only appear on hardware nobody develops on: a window wider
 * than the screen, and a viewport that changes size while the window is open.
 */
import { describe, expect, it } from 'vitest';
import {
  EDGE_MARGIN,
  clampToViewport,
  placeClearOf,
  placeWindow,
} from '../src/components/mixer/windowPlace';

const PREFERRED = { x: 220, y: 120 };
/** The window's CSS floor, which is what a phone actually gets. */
const NARROW = { width: 320, height: 420 };
const PHONE = { width: 390, height: 844 };
const PHONE_LANDSCAPE = { width: 844, height: 390 };
const LAPTOP = { width: 1440, height: 900 };

describe('where a device window opens', () => {
  it('uses the preferred offset when there is room for it', () => {
    expect(placeWindow(PREFERRED, { width: 520, height: 400 }, LAPTOP)).toEqual(PREFERRED);
  });

  it('centres rather than hugging the margin when the offset would overflow', () => {
    // 220 + 320 + 8 = 548 against 390: the old constant put 158px off screen,
    // taking the close button with it.
    const pos = placeWindow(PREFERRED, NARROW, PHONE);
    expect(pos.x).toBe(Math.round((390 - 320) / 2));
    expect(pos.x + NARROW.width).toBeLessThanOrEqual(PHONE.width);
  });

  it('keeps the header on screen when the window is taller than the viewport', () => {
    // A landscape phone is 390 tall and the window wants 420. Something has to
    // be off screen; it must be the bottom, because the top is where close,
    // bypass and the drag handle are.
    const pos = placeWindow(PREFERRED, NARROW, PHONE_LANDSCAPE);
    expect(pos.y).toBe(EDGE_MARGIN);
    expect(pos.x + NARROW.width).toBeLessThanOrEqual(PHONE_LANDSCAPE.width);
  });

  it('never places a window outside the margin on any cell of the matrix', () => {
    const cells = [
      { width: 360, height: 740 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
      { width: 740, height: 360 },
      { width: 844, height: 390 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 512, height: 768 },
      { width: 341, height: 768 },
      { width: 1440, height: 900 },
      { width: 2560, height: 1440 },
    ];
    for (const viewport of cells) {
      const pos = placeWindow(PREFERRED, NARROW, viewport);
      expect(pos.x, `${viewport.width}x${viewport.height} x`).toBeGreaterThanOrEqual(EDGE_MARGIN);
      expect(pos.y, `${viewport.width}x${viewport.height} y`).toBeGreaterThanOrEqual(EDGE_MARGIN);
      // The right edge is allowed past only when the window itself is wider
      // than the viewport, which is the CSS minimum against a 341px window.
      if (NARROW.width + 2 * EDGE_MARGIN <= viewport.width) {
        expect(pos.x + NARROW.width, `${viewport.width} right`).toBeLessThanOrEqual(viewport.width);
      }
    }
  });
});

describe('keeping a window inside a viewport that moved', () => {
  it('pulls a window back when the viewport shrinks under it', () => {
    // This is rotation: placed correctly at 844 wide, then the device turns.
    const placed = placeWindow(PREFERRED, NARROW, PHONE_LANDSCAPE);
    expect(placed.x).toBe(220);
    const after = clampToViewport(placed, NARROW, PHONE);
    expect(after.x + NARROW.width).toBeLessThanOrEqual(PHONE.width);
  });

  it('leaves a window alone when it already fits', () => {
    const pos = { x: 300, y: 200 };
    expect(clampToViewport(pos, { width: 520, height: 400 }, LAPTOP)).toEqual(pos);
  });

  it('clamps a drag at the edge instead of letting the window escape', () => {
    const size = { width: 520, height: 400 };
    expect(clampToViewport({ x: 9999, y: 9999 }, size, LAPTOP)).toEqual({
      x: LAPTOP.width - size.width - EDGE_MARGIN,
      y: LAPTOP.height - size.height - EDGE_MARGIN,
    });
    expect(clampToViewport({ x: -9999, y: -9999 }, size, LAPTOP)).toEqual({
      x: EDGE_MARGIN,
      y: EDGE_MARGIN,
    });
  });
});

/**
 * A window must not cover the control that opened it.
 *
 * Item 13's contract is that one tap opens a device and the next closes it, and
 * on a phone the second tap had nothing to land on: the window opened over the
 * rail card, and `elementFromPoint` at the card's centre returned the EQ curve
 * inside the window. Not too small, not off screen — behind something.
 */
describe('a window opened from a control', () => {
  const CARD = { x: 20, y: 180, width: 152, height: 44 };
  const PREFERRED_ON_PHONE = { x: 35, y: 120 };

  it('opens below the control that opened it', () => {
    const pos = placeClearOf(PREFERRED_ON_PHONE, NARROW, PHONE, CARD);
    expect(pos.y).toBeGreaterThanOrEqual(CARD.y + CARD.height);
  });

  it('opens above when there is no room below', () => {
    // A card near the bottom of a short viewport: below it the window would be
    // clamped straight back up onto the card, which is the case a naive
    // "just add the height" would get wrong and report as solved.
    const low = { x: 20, y: 300, width: 152, height: 44 };
    const pos = placeClearOf({ x: 35, y: 120 }, { width: 320, height: 200 }, PHONE_LANDSCAPE, low);
    expect(pos.y + 200).toBeLessThanOrEqual(low.y);
  });

  it('clears the opener wherever clearing it is geometrically possible', () => {
    /*
     * Swept rather than sampled, and the sweep is what corrected the claim.
     *
     * The first version of this asserted the window *never* covers the opener.
     * That is false and the sweep said so at y=374: a 420px window in an 844px
     * phone needs 428 of clear space on one side of a 44px card, and a card in
     * the middle band leaves 410 on both. Neither side fits and no placement
     * rule can invent the room.
     *
     * So the property is the true one — if a clear position exists, one is
     * chosen; if none does, the fallback is the clamped preference and not some
     * squeezed compromise. Asserting the strong version and quietly widening
     * the tolerance until it passed would have hidden exactly the band a real
     * phone can put a card in.
     */
    let cleared = 0;
    let impossible = 0;
    for (let y = 0; y <= PHONE.height - 44; y += 1) {
      const opener = { x: 20, y, width: 152, height: 44 };
      const pos = placeClearOf(PREFERRED_ON_PHONE, NARROW, PHONE, opener);
      const clashes =
        pos.x < opener.x + opener.width &&
        pos.x + NARROW.width > opener.x &&
        pos.y < opener.y + opener.height &&
        pos.y + NARROW.height > opener.y;
      /*
       * "Is there any legal y that clears it", stated as the weakest true
       * condition rather than as the implementation's own arithmetic.
       *
       * The first attempt added EDGE_MARGIN between the window and the opener
       * as well as at the viewport edge, and called y=365 impossible — where
       * the clamp in fact lands the window at 416, seven pixels below a card
       * ending at 409. Clear is clear; the margin is an edge rule, not a
       * clearance rule. A predicate stricter than the truth turns a working
       * case into a failure and invites widening the thing under test.
       */
      const roomBelow = opener.y + opener.height <= PHONE.height - NARROW.height - EDGE_MARGIN;
      const roomAbove = opener.y >= NARROW.height + EDGE_MARGIN;
      if (roomBelow || roomAbove) {
        expect(clashes, `a window opened from a card at y=${y} covers it, and there was room`).toBe(
          false,
        );
        cleared++;
      } else {
        expect(pos, `no room at y=${y}, so it must fall back rather than improvise`).toEqual(
          clampToViewport(PREFERRED_ON_PHONE, NARROW, PHONE),
        );
        impossible++;
      }
    }
    // Both branches were entered. A sweep that only ever took one of them would
    // be asserting half of what it claims to.
    expect(cleared, 'the clearing branch was never exercised').toBeGreaterThan(0);
    expect(impossible, 'the no-room branch was never exercised').toBeGreaterThan(0);
  });

  it('falls back to the clamped preference when neither side fits', () => {
    // An opener taller than the viewport can leave nowhere to go. The window
    // still has to open somewhere legible, with its header on screen — a
    // window squeezed into a strip of pixels to avoid an overlap is worse than
    // the overlap.
    const huge = { x: 0, y: 0, width: 844, height: 390 };
    const pos = placeClearOf({ x: 35, y: 120 }, NARROW, PHONE_LANDSCAPE, huge);
    expect(pos).toEqual(clampToViewport({ x: 35, y: 120 }, NARROW, PHONE_LANDSCAPE));
    expect(pos.y).toBeGreaterThanOrEqual(EDGE_MARGIN);
  });
});
