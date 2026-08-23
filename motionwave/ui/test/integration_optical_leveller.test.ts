/**
 * Ledger cell X24 — the Optical Leveller, end to end.
 *
 * The unit whose meter is deliberately *not* the truth: §3.4 says the reading
 * comes from a second photocell with the first one's lag, and QA is told in as
 * many words not to compare it against an instantaneous number. So the claim
 * here is unusual — the published reduction must lag the audio's, and a face
 * showing the real figure would be more accurate and less faithful.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { OpticalLevellerMeter } from '../units/optical_leveller/face';
import { OpticalLevellerParam } from '../units/optical_leveller/params.gen';
import { opticalLevellerUnit } from '../units/optical_leveller/unit';
import { UnitDriver, expectPublishedOncePerBlock, loadCore } from './x24_driver';

/** Five: the two peaks, the meter cell's reduction, exposure, release constant. */
const VISUAL = {
  inputPeak: 0,
  outputPeak: 1,
  gainReduction: 2,
  exposure: 3,
  releaseSeconds: 4,
} as const;

let driver: UnitDriver;

beforeAll(async () => {
  const core = await loadCore();
  driver = UnitDriver.from(core, 'mw_optical_leveller', opticalLevellerUnit.specs, 5);
}, 60_000);

function configure() {
  driver.prepare();
  for (const spec of opticalLevellerUnit.specs) driver.setParam(spec.id, spec.def);
}

describe('X24 — Optical Leveller through the real boundary', () => {
  it('levels, and the meter lags rather than leading', () => {
    configure();
    driver.setParam(OpticalLevellerParam.PeakReduction, 0.85);
    const frames = driver.run(400, 400, 0.4);
    const early = frames[20].visual[VISUAL.gainReduction];
    const late = frames[frames.length - 1].visual[VISUAL.gainReduction];
    console.log(
      `X24 Optical: meter reads ${early.toFixed(2)} dB early and ${late.toFixed(2)} dB settled`,
    );
    expect(late).toBeGreaterThan(3);
    // The meter is still climbing long after the audio has been reduced, which
    // is the second cell's lag and the whole reason the face reads it.
    expect(late).toBeGreaterThan(early + 1);
  });

  it('the exposure state is history, and it outlives the signal', () => {
    // §4: the second release branch's constant is a function of how long the
    // cell has been lit. A face that recomputed it from the panel would show a
    // constant; the engine shows a memory.
    configure();
    driver.setParam(OpticalLevellerParam.PeakReduction, 0.9);
    driver.run(600, 400, 0.5);
    const lit = driver.processBlock(0).visual[VISUAL.exposure];
    const after = driver.runSilent(60, 600 * driver.block);
    const resting = after[after.length - 1].visual[VISUAL.exposure];
    console.log(`X24 Optical: exposure ${lit.toFixed(4)} lit, ${resting.toFixed(4)} after silence`);
    expect(lit).toBeGreaterThan(0.01);
    expect(resting).toBeGreaterThan(0);
    expect(resting).toBeLessThan(lit);
  });

  it('publishes exactly once per processed block', () => {
    configure();
    const frames = driver.run(32, 400, 0.3);
    expectPublishedOncePerBlock(frames);
    expect(frames[31].generation - frames[0].generation).toBe(31);
    const before = frames[31].generation;
    expect(driver.processBlock(0).generation).toBe(before + 1);
  });

  it('a bypassed unit still publishes, and publishes the truth', () => {
    configure();
    driver.setBypass(true);
    const frames = driver.run(16, 400, 0.5);
    for (const frame of frames) {
      expect(frame.peak).toBeGreaterThan(0.45);
      expect(frame.visual[VISUAL.gainReduction]).toBeCloseTo(0, 5);
    }
    expect(frames[15].generation - frames[0].generation).toBe(15);
  });

  it('the face names channels the engine actually publishes', () => {
    const published = new Set<string>(Object.values(OpticalLevellerMeter));
    for (const element of opticalLevellerUnit.face?.elements ?? []) {
      if (!element.meterChannel) continue;
      expect(
        published.has(element.meterChannel),
        `${element.id} names ${element.meterChannel}`,
      ).toBe(true);
    }
  });
});
