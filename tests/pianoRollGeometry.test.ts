/**
 * The two rules that decide whether a note can be edited by hand.
 *
 * A lane is the target for every note on it, and the roll drew lanes 16px tall
 * on every device — under a third of the touch minimum. And a resize handle
 * that is wider than the note it sits on does not make resizing easier; it
 * makes *moving* impossible, silently, because both gestures are a drag and the
 * handle is on top.
 *
 * Both are arithmetic, so both are tested here rather than in a browser. What a
 * browser is for is proving the numbers reach the screen, which
 * `e2e/pianoroll.spec.ts` does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FINE_ROW_MIN,
  MIN_BODY,
  ROW_MAX,
  TOUCH_ROW_MIN,
  clampRow,
  coarsePointer,
  handleWidth,
  rowFloor,
  zoomRows,
} from '../src/components/pianoroll/geometry';

/** Pretend to be a finger, or a mouse, for one test. */
function withPointer(kind: 'coarse' | 'fine', run: () => void) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: kind === 'coarse' && q.includes('coarse'),
    media: q,
  }));
  try {
    run();
  } finally {
    vi.unstubAllGlobals();
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('a lane is as tall as the hand needs', () => {
  it('will not go below the touch minimum on a finger', () => {
    withPointer('coarse', () => {
      expect(rowFloor()).toBe(TOUCH_ROW_MIN);
      // The desktop default, on a phone, is the number that made the roll
      // unusable by thumb. The floor is on *read*, so the stored 16 never
      // reaches the screen.
      expect(clampRow(16)).toBe(TOUCH_ROW_MIN);
      expect(clampRow(4)).toBe(TOUCH_ROW_MIN);
    });
  });

  it('lets a mouse have small lanes, because seeing an octave is the point', () => {
    withPointer('fine', () => {
      expect(rowFloor()).toBe(FINE_ROW_MIN);
      expect(clampRow(16)).toBe(16);
      expect(clampRow(2)).toBe(FINE_ROW_MIN);
    });
  });

  it('stops at a ceiling, so the roll cannot become a list', () => {
    withPointer('fine', () => expect(clampRow(400)).toBe(ROW_MAX));
  });

  it('zooms by a ratio and stays inside both ends', () => {
    withPointer('fine', () => {
      expect(zoomRows(16, 1.25)).toBe(20);
      expect(zoomRows(20, 0.8)).toBe(16);
      // Zooming out repeatedly lands on the floor rather than below it.
      let h = 16;
      for (let i = 0; i < 20; i++) h = zoomRows(h, 0.8);
      expect(h).toBe(FINE_ROW_MIN);
    });
  });

  it('treats a browser with no matchMedia as a pointer', () => {
    vi.stubGlobal('matchMedia', undefined);
    // Not a hypothetical: this module is imported by a unit test environment
    // that has no media queries at all, and a `matchMedia` call there throws
    // rather than returning false.
    expect(coarsePointer()).toBe(false);
    expect(rowFloor()).toBe(FINE_ROW_MIN);
  });
});

describe('the short-note rule', () => {
  it('gives a wide note the full handle', () => {
    expect(handleWidth(200, false)).toBe(7);
    expect(handleWidth(200, true)).toBe(14);
  });

  it('takes the handle away before it can eat the note', () => {
    /*
     * The defect this exists for. A sixteenth at the default zoom is 8px wide
     * and the touch handle is 14, so the handle covered the note *and its
     * neighbours' side of it* — every attempt to drag a short note somewhere
     * else changed its length instead.
     */
    expect(handleWidth(8, true)).toBe(0);
    expect(handleWidth(8, false)).toBe(0);
    // Exactly at the body minimum there is still nothing to spare.
    expect(handleWidth(MIN_BODY, true)).toBe(0);
  });

  it('never leaves less than the body minimum to drag', () => {
    for (let w = 5; w <= 120; w++) {
      for (const coarse of [true, false]) {
        const edge = handleWidth(w, coarse);
        if (edge === 0) continue;
        expect(w - edge, `a ${w}px note with a ${edge}px handle`).toBeGreaterThanOrEqual(MIN_BODY);
      }
    }
  });

  it('grows the handle back as the note gets wider', () => {
    // Monotonic: zooming in never makes the grip smaller, which would read as
    // the control flickering rather than as a rule.
    let last = 0;
    for (let w = 5; w <= 120; w++) {
      const edge = handleWidth(w, true);
      expect(edge).toBeGreaterThanOrEqual(last);
      last = edge;
    }
    expect(last).toBe(14);
  });
});
