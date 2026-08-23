import { describe, expect, it } from 'vitest';

import { ParamQueue } from '../param/queue';
import { ParamSet } from '../param/set';
import { Smoother } from '../param/smoothing';
import { rampAt, rampIncrement, steady, toRealRamp } from '../param/ramp';
import { defineParam, toNormalised, toReal } from '../param/spec';
import { Taper, Unit } from '../param/units';

const SPECS = [
  defineParam({ id: 1, name: 'Gain', unit: Unit.Decibels, min: -60, max: 12, def: 0 }),
  defineParam({
    id: 2,
    name: 'Frequency',
    unit: Unit.Hertz,
    min: 20,
    max: 20000,
    def: 1000,
    taper: Taper.Logarithmic,
  }),
  defineParam({ id: 3, name: 'Mode', unit: Unit.Choice, choices: ['A', 'B', 'C'] }),
];

describe('the producer queue coalesces rather than overflowing', () => {
  it('keeps only the newest value for a parameter written repeatedly', () => {
    const queue = new ParamQueue(8);
    for (let i = 0; i < 200; i++) queue.post(1, i / 200);
    expect(queue.size).toBe(1);
    const drained: number[] = [];
    queue.drain((_id, value) => drained.push(value));
    expect(drained).toEqual([199 / 200]);
  });

  it('refuses a post rather than growing, and says how many it refused', () => {
    const queue = new ParamQueue(4);
    for (let id = 1; id <= 4; id++) expect(queue.post(id, 0.5)).toBe(true);
    expect(queue.post(5, 0.5)).toBe(false);
    expect(queue.refusedCount).toBe(1);
    expect(queue.size).toBe(4);
  });

  it('refuses a NaN at the boundary rather than passing it to a coefficient', () => {
    const queue = new ParamQueue(4);
    expect(queue.post(1, Number.NaN)).toBe(false);
    expect(queue.post(1, Number.POSITIVE_INFINITY)).toBe(false);
    expect(queue.size).toBe(0);
  });

  it('clamps what it accepts, so nothing downstream has to', () => {
    const queue = new ParamQueue(4);
    queue.post(1, 5);
    queue.post(2, -5);
    expect(queue.peek().map((change) => change.normalised)).toEqual([1, 0]);
  });
});

describe('a parameter set is the one place a value enters', () => {
  it('starts every parameter at its declared default', () => {
    const set = new ParamSet(SPECS);
    expect(set.real(1)).toBeCloseTo(0, 9);
    expect(set.real(2)).toBeCloseTo(1000, 6);
    expect(set.text(2)).toBe('1.00 kHz');
  });

  it('quantises a switch so the face and the processor land on the same detent', () => {
    const set = new ParamSet(SPECS);
    set.setNormalised(3, 0.31);
    // 0.31 of three positions is position 1, and the stored value is the
    // position, not the finger: a face drawing 0.31 while the processor sits on
    // 0.5 is the two-answers-to-one-question defect made visible.
    expect(set.normalised(3)).toBeCloseTo(0.5, 12);
    expect(set.text(3)).toBe('B');
  });

  it('reports failure for an id it does not have, rather than doing nothing quietly', () => {
    const set = new ParamSet(SPECS);
    expect(set.setNormalised(99, 0.5)).toBe(false);
    expect(set.setNormalised(1, Number.NaN)).toBe(false);
    expect(Number.isNaN(set.normalised(99))).toBe(true);
  });

  it('canonicalises negative zero, which JSON cannot carry', () => {
    const set = new ParamSet(SPECS);
    set.setNormalised(1, -0);
    expect(Object.is(set.normalised(1), 0)).toBe(true);
  });

  it('posts every change across the seam exactly once per parameter', () => {
    const set = new ParamSet(SPECS);
    set.queue.clear();
    set.setNormalised(1, 0.25);
    set.setNormalised(1, 0.75);
    set.setNormalised(2, 0.5);
    const seen: number[] = [];
    set.queue.drain((id) => seen.push(id));
    expect(seen.sort()).toEqual([1, 2]);
  });

  it('tells subscribers what moved and why', () => {
    const set = new ParamSet(SPECS);
    const origins: string[] = [];
    const stop = set.subscribe((event) => origins.push(event.origin));
    set.setNormalised(1, 0.5, 'user');
    set.setNormalised(1, 0.6, 'automation');
    stop();
    set.setNormalised(1, 0.7, 'host');
    expect(origins).toEqual(['user', 'automation']);
  });

  it('reuses the array a caller supplies, so a 60 fps face does not allocate per frame', () => {
    const set = new ParamSet(SPECS);
    const into = new Float64Array(SPECS.length);
    expect(set.snapshot(into)).toBe(into);
    expect(into[0]).toBeCloseTo(set.normalised(1), 12);
  });
});

describe('a ramp describes a parameter across a buffer', () => {
  it('reads the end value when nothing moved, without interpolating', () => {
    const flat = steady(0.5);
    expect(rampAt(flat, 0, 128)).toBe(0.5);
    expect(rampIncrement(flat, 128)).toBe(0);
  });

  it('converts both ends through the law, so a log sweep is even to the ear', () => {
    const spec = SPECS[1];
    const real = toRealRamp(spec, { start: 0, end: 1, moving: true });
    expect(real.start).toBeCloseTo(20, 9);
    expect(real.end).toBeCloseTo(20000, 6);
    // The midpoint of the normalised ramp is the geometric mean in hertz, not
    // the arithmetic one — which is the whole reason the conversion happens at
    // both ends rather than being scaled from the end value.
    const middle = toReal(spec, 0.5);
    expect(middle).toBeCloseTo(Math.sqrt(20 * 20000), 3);
    expect(toNormalised(spec, middle)).toBeCloseTo(0.5, 9);
  });
});

describe('the smoother is the core smoother', () => {
  it('travels toward its target and stops reporting movement once it arrives', () => {
    const smoother = new Smoother();
    smoother.configure(48000, 256, 20);
    smoother.reset(0);
    smoother.setTarget(1);
    let ramp = smoother.advance();
    expect(ramp.moving).toBe(true);
    expect(ramp.start).toBe(0);
    expect(ramp.end).toBeGreaterThan(0);
    for (let block = 0; block < 400; block++) ramp = smoother.advance();
    expect(ramp.moving).toBe(false);
    expect(smoother.current).toBeCloseTo(1, 9);
  });

  it('jumps rather than glides when its time is zero, which is what a switch wants', () => {
    const smoother = new Smoother();
    smoother.configure(48000, 256, 0);
    smoother.reset(0);
    smoother.setTarget(1);
    const ramp = smoother.advance();
    expect(ramp.end).toBe(1);
  });

  it('is continuous across blocks, so the ramps join without a step', () => {
    const smoother = new Smoother();
    smoother.configure(48000, 128, 30);
    smoother.reset(0);
    smoother.setTarget(1);
    let previousEnd = 0;
    for (let block = 0; block < 40; block++) {
      const ramp = smoother.advance();
      expect(ramp.start).toBeCloseTo(previousEnd, 12);
      previousEnd = ramp.end;
    }
  });
});
