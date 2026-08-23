/**
 * RA-003 — a device window has to open where it can be used.
 *
 * The arithmetic, without a browser. The e2e spec proves the real thing opens
 * inside a real viewport; this pins the placement rules themselves, including
 * the two cases that only appear on hardware nobody develops on: a window wider
 * than the screen, and a viewport that changes size while the window is open.
 */
import { describe, expect, it } from 'vitest';
import { EDGE_MARGIN, clampToViewport, placeWindow } from '../src/components/mixer/windowPlace';

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
