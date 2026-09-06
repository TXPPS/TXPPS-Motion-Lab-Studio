/**
 * Ledger cell X24 — the Granular Delay, end to end.
 *
 * What this unit can get wrong across the boundary that the others could not:
 * **its panel is a picture of a transport.** The pitch ratio, the eight
 * delivered tap times and the clock are all numbers the audio thread computes
 * on its way to reading the buffer, and each is a place a face could show a
 * plausible number the audio disagrees with — a tap time that is the setting
 * rather than what the head is doing, a pitch ratio derived from a control.
 * Natively there is no boundary to cross; here there is, and the tempo goes
 * across it by its own export.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { GranularDelayParam } from '../units/granular_delay/params.gen';
import { granularDelayUnit } from '../units/granular_delay/unit';
import { UnitDriver, expectPublishedOncePerBlock, loadCore } from './x24_driver';

/** Eighteen: three levels, then the fifteen numbers no control states. */
const VISUAL = {
  inputPeak: 0,
  outputPeak: 1,
  loopPeak: 2,
  pitchRatio: 3,
  tap1Seconds: 4,
  clockHz: 13,
  duckGain: 14,
  cloudDepth: 15,
  liveGrains: 16,
  activeTaps: 17,
} as const;

let driver: UnitDriver;

beforeAll(async () => {
  const core = await loadCore();
  driver = UnitDriver.from(core, 'mw_granular_delay', granularDelayUnit.specs, 18);
}, 60_000);

function configure() {
  driver.prepare();
  for (const spec of granularDelayUnit.specs) driver.setParam(spec.id, spec.def);
  driver.setParam(GranularDelayParam.Mix, 100);
  driver.setParam(GranularDelayParam.Sync, 0);
  driver.setParam(GranularDelayParam.TapCount, 0);
  driver.setParam(GranularDelayParam.Tap1Time, 250);
  driver.setParam(GranularDelayParam.Character, 0);
  driver.setParam(GranularDelayParam.TimeChange, 2);
  driver.setParam(GranularDelayParam.Feedback, 0);
}

const last = (frames: readonly { visual: number[] }[]) => frames[frames.length - 1].visual;

describe('X24 — Granular Delay through the real boundary', () => {
  it('a synced tap follows the tempo the host sends, and the readout says where it is', () => {
    // The tempo crosses the boundary by its own export, not as a parameter,
    // because it is the host's and has no control. A quarter is 500 ms at 120
    // and 666.7 ms at 90 — and the readout is the *delivered* time, so it has
    // to move when the tempo does, which a setting echoed back would not.
    configure();
    driver.setParam(GranularDelayParam.Sync, 1);
    driver.setParam(GranularDelayParam.Tap1Division, 4);
    driver.setTempo(120);
    const at120 = last(driver.run(8, 440, 0.2))[VISUAL.tap1Seconds];
    driver.setTempo(90);
    const at90 = last(driver.run(8, 440, 0.2))[VISUAL.tap1Seconds];
    console.log(
      `X24 Granular Delay: a quarter reads ${at120.toFixed(4)} s at 120, ${at90.toFixed(4)} s at 90`,
    );
    expect(at120).toBeCloseTo(0.5, 3);
    expect(at90).toBeCloseTo(2 / 3, 3);
  });

  it('the clock readout is N / (2D) on a bucket-brigade and zero elsewhere', () => {
    configure();
    driver.setParam(GranularDelayParam.Character, 2);
    driver.setParam(GranularDelayParam.Stages, 2);
    driver.setParam(GranularDelayParam.Tap1Time, 300);
    const bbd = last(driver.run(8, 440, 0.2))[VISUAL.clockHz];
    configure();
    const clean = last(driver.run(8, 440, 0.2))[VISUAL.clockHz];
    console.log(
      `X24 Granular Delay: clock ${bbd.toFixed(1)} Hz at 300 ms on 4096 stages, ${clean} on Clean`,
    );
    expect(bbd).toBeCloseTo(4096 / 0.6, 0);
    expect(clean).toBe(0);
  });

  it('the pitch ratio bends through a Tape-mode time change and settles back to one', () => {
    // The transport's own `v(t) / v(t − D)`, not a control: it moves only
    // while the speed is slewing, and it returns to exactly one afterwards
    // even though the speed is now double what it was.
    configure();
    driver.setParam(GranularDelayParam.TimeChange, 0);
    driver.run(40, 330, 0.2);
    driver.setParam(GranularDelayParam.Tap1Time, 125);
    const frames = driver.run(750, 330, 0.2, 40 * 128);
    let deepest = 0;
    for (const frame of frames)
      deepest = Math.max(deepest, Math.abs(frame.visual[VISUAL.pitchRatio] - 1));
    const settled = last(frames)[VISUAL.pitchRatio];
    console.log(
      `X24 Granular Delay: pitch ratio strayed ${deepest.toFixed(4)} from one, settled at ${settled.toFixed(6)}`,
    );
    expect(deepest).toBeGreaterThan(0.05);
    expect(settled).toBeCloseTo(1, 3);
    // And the delivered time arrived: 125 ms, from a transport that got there
    // by speed rather than by being told.
    expect(last(frames)[VISUAL.tap1Seconds]).toBeCloseTo(0.125, 3);
  });

  it('the loop meter is the signal recirculating, and it decays after the input stops', () => {
    configure();
    driver.setParam(GranularDelayParam.Feedback, 50);
    const driven = last(driver.run(200, 330, 0.3))[VISUAL.loopPeak];
    const quiet = driver.runSilent(1200, 200 * 128);
    const later = quiet[400].visual[VISUAL.loopPeak];
    const end = last(quiet)[VISUAL.loopPeak];
    console.log(
      `X24 Granular Delay: loop ${driven.toFixed(4)} driven, ${later.toFixed(4)} a second on, ${end.toExponential(2)} at the end`,
    );
    expect(driven).toBeGreaterThan(0.05);
    expect(later).toBeLessThan(driven * 0.5);
    expect(later).toBeGreaterThan(0);
    expect(end).toBeLessThan(1e-4);
  });

  it('the grain fields are the engine’s: nothing for a plain tap, a cloud once smeared', () => {
    configure();
    const plain = last(driver.run(60, 330, 0.2));
    configure();
    driver.setParam(GranularDelayParam.Smear, 50);
    const smeared = last(driver.run(60, 330, 0.2));
    console.log(
      `X24 Granular Delay: ${plain[VISUAL.liveGrains]} grain(s) plain, ${smeared[VISUAL.liveGrains]} smeared ` +
        `reading ${smeared[VISUAL.cloudDepth].toFixed(3)} s back`,
    );
    expect(plain[VISUAL.liveGrains]).toBe(0);
    expect(smeared[VISUAL.liveGrains]).toBeGreaterThan(0);
    expect(smeared[VISUAL.cloudDepth]).toBeGreaterThan(0.2);
    expect(smeared[VISUAL.activeTaps]).toBe(1);
  });

  it('a bypassed unit still meters, because it is still in circuit', () => {
    configure();
    driver.setBypass(true);
    const bypassed = last(driver.run(24, 440, 0.25));
    console.log(
      `X24 Granular Delay: bypassed input ${bypassed[VISUAL.inputPeak].toFixed(3)}, output ${bypassed[VISUAL.outputPeak].toFixed(3)}`,
    );
    expect(bypassed[VISUAL.inputPeak]).toBeGreaterThan(0.1);
    expect(bypassed[VISUAL.outputPeak]).toBeGreaterThan(0.1);
  });

  it('publishes once per block, which is what tells a real face from a timer', () => {
    configure();
    expectPublishedOncePerBlock(driver.run(24, 440, 0.2));
  });
});
