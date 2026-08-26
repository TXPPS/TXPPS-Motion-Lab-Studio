/**
 * Delay compensation, as arithmetic.
 *
 * The behaviour is asserted in a browser by `e2e/bouncealignment.spec.ts`,
 * which renders and correlates. This is the layer under it: the sum itself,
 * where the frozen-channel case and the cap can be stated without a graph, and
 * where the export path's allowance can be checked against the ceiling it is
 * supposed to be.
 */
import { describe, expect, it } from 'vitest';
import { MAX_PDC_SEC, channelLatencySamples, pdcPlan } from '../src/audio/pdc';
import { renderLayout } from '../src/audio/exportMix';

const RATE = 48000;

describe('pdcPlan', () => {
  it('holds every channel back to meet the deepest', () => {
    const plan = pdcPlan([0, 192, 480], 0, RATE);
    expect(plan.holdSamples).toEqual([480, 288, 0]);
    // Every channel is now 480 late: its own delay plus its hold.
    expect(plan.holdSamples.map((h, i) => h + [0, 192, 480][i])).toEqual([480, 480, 480]);
  });

  it('reports what the aligned mix costs, master included', () => {
    // The master is a floor rather than a peer — it is downstream of every
    // channel, so no amount of moving channels relative to each other touches
    // it, and it never appears in a hold.
    const plan = pdcPlan([0, 192], 64, RATE);
    expect(plan.holdSamples).toEqual([192, 0]);
    expect(plan.commonSamples).toBe(256);
  });

  it('costs nothing when nothing declares', () => {
    const plan = pdcPlan([0, 0, 0], 0, RATE);
    expect(plan.holdSamples).toEqual([0, 0, 0]);
    expect(plan.commonSamples).toBe(0);
  });

  it('clamps a hold to the delay line it has to fit in', () => {
    // A `DelayNode` asked for longer than it was built with clamps silently.
    // Clamping here makes the shortfall arithmetic instead of a property of a
    // node nobody is looking at.
    const deep = MAX_PDC_SEC * RATE + 5000;
    const plan = pdcPlan([0, deep], 0, RATE);
    expect(plan.holdSamples[0]).toBe(MAX_PDC_SEC * RATE);
    expect(plan.commonSamples).toBe(deep);
  });

  it('never lands a hold between samples', () => {
    // A `DelayNode` at a fractional delay interpolates rather than shifts: it
    // is a filter, and a gentle one is still not a wire. A compensation that
    // landed off-grid would trade a timing error for a frequency-response one
    // on every channel but the deepest.
    const plan = pdcPlan([10.4, 191.7, 0], 0.5, RATE);
    for (const h of plan.holdSamples) expect(Number.isInteger(h)).toBe(true);
    expect(Number.isInteger(plan.commonSamples)).toBe(true);
  });

  it('handles an empty session', () => {
    expect(pdcPlan([], 0, RATE)).toEqual({ holdSamples: [], commonSamples: 0 });
  });
});

describe('channelLatencySamples', () => {
  it('is zero for a frozen track however much its chain declares', () => {
    // A print already carries the inserts and joins the channel at the chain's
    // output on both paths, so the audio on that channel is not subject to the
    // delay the chain still declares. Compensating for it would push a frozen
    // track late by exactly what freezing removed.
    expect(channelLatencySamples(true, 480)).toBe(0);
    expect(channelLatencySamples(false, 480)).toBe(480);
  });

  it('takes a frozen track out of the deepest-channel decision', () => {
    const chains = [480, 192];
    const frozen = [true, false];
    const plan = pdcPlan(
      chains.map((l, i) => channelLatencySamples(frozen[i], l)),
      0,
      RATE,
    );
    // 192, not 480: the frozen channel is not 480 late, so nothing has to wait
    // for it.
    expect(plan.commonSamples).toBe(192);
    expect(plan.holdSamples).toEqual([192, 0]);
  });
});

describe('renderLayout carries room for the compensation', () => {
  it('renders past the range by the allowance and still delivers the range', () => {
    const l = renderLayout(10, 2, RATE, MAX_PDC_SEC);
    expect(l.trimFrames).toBe(2 * RATE);
    expect(l.keptFrames).toBe(10 * RATE);
    expect(l.allowanceFrames).toBe(MAX_PDC_SEC * RATE);
    // Trim the pre-roll *and* the common offset, and there must still be a
    // whole range left: that is the entire reason the allowance exists.
    expect(l.frames - l.trimFrames - l.allowanceFrames).toBe(l.keptFrames);
  });

  it('asks for nothing extra when there is nothing to compensate', () => {
    const l = renderLayout(3.5, 0, 44100);
    expect(l.allowanceFrames).toBe(0);
    expect(l.frames).toBe(l.keptFrames);
  });

  it('leaves room for anything pdcPlan can return under the cap', () => {
    // The two numbers have to agree or the render throws on a project it should
    // have handled. `MAX_PDC_SEC` is the delay line's length and so the ceiling
    // on a hold; the allowance is that same figure in frames.
    const l = renderLayout(4, 2, RATE, MAX_PDC_SEC);
    const plan = pdcPlan([MAX_PDC_SEC * RATE, 0], 0, RATE);
    expect(plan.commonSamples).toBeLessThanOrEqual(l.allowanceFrames);
  });
});
