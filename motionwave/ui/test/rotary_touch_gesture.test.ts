/**
 * Regression for iPhone/iPad plug-in knobs: a finger dragged straight down
 * must always decrease the displayed normalised value, even after leaving
 * the knob's radius. The old automatic angular-mode switch made it jump.
 *
 * No mocked ParamSpec or DSP is involved; all vintage and granular rotaries
 * share attachDrag and therefore share these exact pointer semantics.
 */
import { describe, expect, it, vi } from 'vitest';
import { attachDrag } from '../render/controls/gesture';

const rect = (width: number, height: number) =>
  ({
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
  }) as DOMRect;

function control() {
  const target = new EventTarget() as unknown as HTMLElement;
  const art = { getBoundingClientRect: () => rect(100, 100) };
  Object.assign(target, {
    style: {} as CSSStyleDeclaration,
    dataset: {} as DOMStringMap,
    querySelector: (selector: string) => (selector === '.mw-ctl-art' ? art : null),
    getBoundingClientRect: () => rect(100, 165),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  });
  const writes: { value: number; settled: boolean }[] = [];
  const detach = attachDrag(target, {
    read: () => 0.5,
    write: (value, settled) => writes.push({ value, settled }),
    travelPx: 220,
    circular: true,
    sweepDeg: 270,
  });
  const pointer = (
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    pointerType: string,
    x: number,
    y: number,
    pointerId = 1,
  ) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      button: { value: 0 },
      pointerId: { value: pointerId },
      pointerType: { value: pointerType },
      clientX: { value: x },
      clientY: { value: y },
    });
    target.dispatchEvent(event);
  };
  return { target, pointer, writes, detach };
}

describe('shared rotary control direction on touch and pen', () => {
  for (const pointerType of ['touch', 'pen']) {
    it(`${pointerType}: down decreases and up increases beyond the rotary radius`, () => {
      const a = control();
      a.pointer('pointerdown', pointerType, 50, 50);
      // Well past the old auto-switch threshold (1.4× radius).
      a.pointer('pointermove', pointerType, 50, 130);
      const afterDown = a.writes.at(-1)!.value;
      expect(afterDown).toBeLessThan(0.5);
      expect(afterDown).toBeCloseTo(0.5 - 80 / 220, 6);
      a.pointer('pointermove', pointerType, 50, 10);
      const afterUp = a.writes.at(-1)!.value;
      expect(afterUp).toBeGreaterThan(0.5);
      expect(afterUp).toBeCloseTo(0.5 + 40 / 220, 6);
      a.pointer('pointerup', pointerType, 50, 10);
      expect(a.writes.at(-1)).toEqual({ value: afterUp, settled: true });
      expect(a.target.dataset.mwDragging).toBeUndefined();
      a.detach();
    });
  }

  it('ignores a second finger rather than switching the active pointer', () => {
    const a = control();
    a.pointer('pointerdown', 'touch', 50, 50, 7);
    a.pointer('pointermove', 'touch', 50, 5, 8);
    expect(a.writes).toHaveLength(0);
    a.pointer('pointermove', 'touch', 50, 20, 7);
    expect(a.writes).toHaveLength(1);
    expect(a.writes[0].value).toBeGreaterThan(0.5);
    a.pointer('pointerup', 'touch', 50, 20, 7);
    a.detach();
  });

  it('preserves desktop mouse circular tracking outside the dial', () => {
    const a = control();
    a.pointer('pointerdown', 'mouse', 50, 50);
    a.pointer('pointermove', 'mouse', 140, 50);
    expect(a.writes.at(-1)!.value).toBeCloseTo(0.5, 6);
    // Clockwise from the right to the bottom adds 90/270 of a turn.
    a.pointer('pointermove', 'mouse', 50, 140);
    expect(a.writes.at(-1)!.value).toBeCloseTo(0.5 + 90 / 270, 6);
    a.pointer('pointerup', 'mouse', 50, 140);
    a.detach();
  });
});
