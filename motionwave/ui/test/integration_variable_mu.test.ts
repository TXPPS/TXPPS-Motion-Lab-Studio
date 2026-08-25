/**
 * Ledger cell X24 — the Variable-Mu Limiter, end to end.
 *
 * This unit has the most to catch of the five, because it is the only one whose
 * two channels are independent *and* whose mode changes what those channels
 * are. §3.5 says a user setting a different threshold on the lateral and the
 * vertical path is the reason the unit is still on mix buses; a boundary that
 * carried one channel's controls to both would pass every native row — they run
 * the same setting on both channels — and remove the feature in the browser.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { VariableMuParam } from '../units/variable_mu/params.gen';
import { variableMuUnit } from '../units/variable_mu/unit';
import { UnitDriver, expectPublishedOncePerBlock, loadCore } from './x24_driver';

/** Seven: the two peaks, a reduction and a storage state per channel, the mode. */
const VISUAL = {
  inputPeak: 0,
  outputPeak: 1,
  reductionA: 2,
  reductionB: 3,
  storageA: 4,
  storageB: 5,
  lateralVertical: 6,
} as const;

let driver: UnitDriver;

beforeAll(async () => {
  const core = await loadCore();
  driver = UnitDriver.from(core, 'mw_variable_mu', variableMuUnit.specs, 7);
}, 60_000);

/** From the spec table's defaults every time — the module holds one unit. */
function configure() {
  driver.prepare();
  for (const spec of variableMuUnit.specs) driver.setParam(spec.id, spec.def);
}

describe('X24 — Variable-Mu Limiter through the real boundary', () => {
  it('compresses, and the threshold runs backwards as the panel does', () => {
    // §3.2's inverted sense, seen from the browser: *lowering* the control
    // increases the reduction. This is the detail an emulation silently
    // corrects, and correcting it in the taper rather than in the DSP would
    // leave every native row passing.
    configure();
    driver.setParam(VariableMuParam.ThresholdA, 8);
    driver.setParam(VariableMuParam.ThresholdB, 8);
    const gentle = driver.run(160, 200, 0.3);
    configure();
    driver.setParam(VariableMuParam.ThresholdA, 2);
    driver.setParam(VariableMuParam.ThresholdB, 2);
    const hard = driver.run(160, 200, 0.3);

    const gentleDb = gentle[gentle.length - 1].visual[VISUAL.reductionA];
    const hardDb = hard[hard.length - 1].visual[VISUAL.reductionA];
    console.log(
      `X24 Variable-Mu: threshold 8 reduces ${gentleDb.toFixed(2)} dB, threshold 2 reduces ${hardDb.toFixed(2)} dB`,
    );
    expect(hardDb).toBeGreaterThan(gentleDb + 3);
    expect(hard[hard.length - 1].peak).toBeLessThan(gentle[gentle.length - 1].peak);
  });

  it('the two channels have their own controls all the way across', () => {
    // The row this unit exists for. One channel's threshold is taken down and
    // the other's is left alone; the published reductions must part company.
    configure();
    driver.setParam(VariableMuParam.ThresholdA, 2);
    driver.setParam(VariableMuParam.ThresholdB, 10);
    const frames = driver.run(160, 200, 0.3);
    const last = frames[frames.length - 1];
    console.log(
      `X24 Variable-Mu: channel A ${last.visual[VISUAL.reductionA].toFixed(2)} dB, B ${last.visual[VISUAL.reductionB].toFixed(2)} dB`,
    );
    expect(last.visual[VISUAL.reductionA]).toBeGreaterThan(3);
    expect(last.visual[VISUAL.reductionB]).toBeLessThan(0.5);
  });

  it('the storage network holds after the signal has gone', () => {
    // §4's positions 5 and 6: the recovery is a state rather than a setting, so
    // the face has to be able to show what is held. A published storage that
    // was recomputed from the panel would read zero here.
    configure();
    driver.setParam(VariableMuParam.ThresholdA, 1);
    driver.setParam(VariableMuParam.ThresholdB, 1);
    driver.setParam(VariableMuParam.TimeConstantA, 4);
    driver.setParam(VariableMuParam.TimeConstantB, 4);
    driver.run(300, 200, 0.4);
    const after = driver.runSilent(40, 300 * driver.block);
    const held = after[after.length - 1].visual[VISUAL.storageA];
    console.log(`X24 Variable-Mu: storage still ${held.toFixed(4)} with the signal gone`);
    expect(held).toBeGreaterThan(0.01);
  });

  it('the mode switch reaches the audio and says so', () => {
    configure();
    driver.setParam(VariableMuParam.Mode, 1);
    const frames = driver.run(16, 200, 0.2);
    expect(frames[frames.length - 1].visual[VISUAL.lateralVertical]).toBe(1);
    configure();
    driver.setParam(VariableMuParam.Mode, 0);
    const back = driver.run(16, 200, 0.2);
    expect(back[back.length - 1].visual[VISUAL.lateralVertical]).toBe(0);
  });

  it('publishes exactly once per processed block', () => {
    configure();
    const frames = driver.run(32, 200, 0.2);
    expectPublishedOncePerBlock(frames);
    expect(frames[31].generation - frames[0].generation).toBe(31);
    const before = frames[31].generation;
    expect(driver.processBlock(0).generation).toBe(before + 1);
  });

  it('the face names channels the engine actually publishes', () => {
    // Read from the unit's own declaration rather than listed here.
    //
    // A list beside the thing can agree with the thing while the thing has
    // changed, and this one did: the Console EQ gained two published channels
    // and this set did not, so a test whose whole subject is "the face names
    // what the engine publishes" failed on a face that had been kept in step.
    // `frame_packing.test.ts` is the other half — it holds the declaration
    // against what `bridge.cpp` actually packs, so trusting it here is not
    // trusting nobody.
    const published = new Set<string>((variableMuUnit.meters ?? []).map((c) => c.name));
    for (const element of variableMuUnit.face?.elements ?? []) {
      if (!element.meterChannel) continue;
      expect(
        published.has(element.meterChannel),
        `${element.id} names ${element.meterChannel}`,
      ).toBe(true);
    }
  });
});
