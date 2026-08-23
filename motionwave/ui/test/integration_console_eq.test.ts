/**
 * Ledger cell X24 — the Console EQ, end to end.
 *
 * One device with two panels, so the thing to catch here is a lineage switch
 * that reaches the face and not the audio, or the reverse. Both would look
 * right on screen: the controls would relabel and the curve would redraw, and
 * the sound would be the other lineage's. §10 test 19 asserts natively that the
 * two engines differ; this asserts that the switch selects between them across
 * the boundary a user's click actually travels.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { ConsoleEqMeter } from '../units/console_eq/face';
import { ConsoleEqParam } from '../units/console_eq/params.gen';
import { consoleEqUnit } from '../units/console_eq/unit';
import { UnitDriver, expectPublishedOncePerBlock, loadCore } from './x24_driver';

/** Seven: the two peaks, the lineage, the mid Q, three bandwidths. */
const VISUAL = {
  inputPeak: 0,
  outputPeak: 1,
  american: 2,
  midQ: 3,
  bandOneWidth: 4,
  bandTwoWidth: 5,
  bandThreeWidth: 6,
} as const;

let driver: UnitDriver;

beforeAll(async () => {
  const core = await loadCore();
  driver = UnitDriver.from(core, 'mw_console_eq', consoleEqUnit.specs, 7);
}, 60_000);

function configure() {
  driver.prepare();
  for (const spec of consoleEqUnit.specs) driver.setParam(spec.id, spec.def);
}

describe('X24 — Console EQ through the real boundary', () => {
  it('boosting a band makes the band louder, on both lineages', () => {
    configure();
    const flat = driver.run(60, 1600, 0.2);
    configure();
    driver.setParam(ConsoleEqParam.MidAmount, 18);
    const boosted = driver.run(60, 1600, 0.2);
    const flatPeak = flat[flat.length - 1].peak;
    const boostedPeak = boosted[boosted.length - 1].peak;
    console.log(
      `X24 Console EQ: inductor mid +18 dB takes 1.6 kHz from ${flatPeak.toFixed(3)} to ${boostedPeak.toFixed(3)}`,
    );
    // Eighteen decibels is a factor of eight, and the probe is at the centre.
    expect(boostedPeak / flatPeak).toBeGreaterThan(4);

    configure();
    driver.setParam(ConsoleEqParam.Lineage, 1);
    driver.setParam(ConsoleEqParam.BandTwoFrequency, 2);
    driver.setParam(ConsoleEqParam.BandTwoAmount, 10);
    const bridged = driver.run(60, 1500, 0.2);
    configure();
    driver.setParam(ConsoleEqParam.Lineage, 1);
    const bridgedFlat = driver.run(60, 1500, 0.2);
    const ratio = bridged[bridged.length - 1].peak / bridgedFlat[bridgedFlat.length - 1].peak;
    console.log(`X24 Console EQ: bridged-T band 2 at +12 dB gives a factor of ${ratio.toFixed(2)}`);
    expect(ratio).toBeGreaterThan(3);
  });

  it('the lineage switch selects the engine, and the frame says which', () => {
    configure();
    const inductor = driver.run(16, 1000, 0.2);
    expect(inductor[inductor.length - 1].visual[VISUAL.american]).toBe(0);
    configure();
    driver.setParam(ConsoleEqParam.Lineage, 1);
    const bridged = driver.run(16, 1000, 0.2);
    expect(bridged[bridged.length - 1].visual[VISUAL.american]).toBe(1);
  });

  it('the published shape moves with the amount, which is where Q lives here', () => {
    // §6.2 ends by saying any UI exposing a Q control on this family has
    // misunderstood it: the shape and the amount are mechanically tied. So the
    // face has nothing to *set* and something to *show*, and this is the wire
    // that carries it — a bandwidth recomputed in TypeScript from the panel
    // would be a second opinion, which is the one rule this project has broken
    // fewest times.
    configure();
    driver.setParam(ConsoleEqParam.Lineage, 1);
    driver.setParam(ConsoleEqParam.BandTwoAmount, 6);
    const gentle = driver.run(8, 1500, 0.2);
    configure();
    driver.setParam(ConsoleEqParam.Lineage, 1);
    driver.setParam(ConsoleEqParam.BandTwoAmount, 10);
    const hard = driver.run(8, 1500, 0.2);
    const wide = gentle[gentle.length - 1].visual[VISUAL.bandTwoWidth];
    const narrow = hard[hard.length - 1].visual[VISUAL.bandTwoWidth];
    console.log(
      `X24 Console EQ: band 2 is ${wide.toFixed(3)} octaves at +2 dB, ${narrow.toFixed(3)} at +12`,
    );
    expect(narrow).toBeLessThan(wide);
    // The published endpoints, which §6.2 says to treat as targets.
    expect(narrow).toBeCloseTo(1.0, 1);

    // And the inductor lineage's Q moves with the amount too, the other way up.
    configure();
    driver.setParam(ConsoleEqParam.MidAmount, 4);
    const soft = driver.run(8, 1600, 0.2);
    configure();
    driver.setParam(ConsoleEqParam.MidAmount, 18);
    const loud = driver.run(8, 1600, 0.2);
    expect(loud[loud.length - 1].visual[VISUAL.midQ]).toBeGreaterThan(
      soft[soft.length - 1].visual[VISUAL.midQ],
    );
  });

  it('the EQ latch removes the networks and leaves the amplifiers', () => {
    // §3.6's implementer rule, across the boundary. The level must not move,
    // and the unit must still be publishing — a face that blanked here would be
    // describing a bypass the unit does not have.
    configure();
    const withEq = driver.run(40, 1000, 0.2);
    configure();
    driver.setParam(ConsoleEqParam.EqIn, 0);
    const withoutEq = driver.run(40, 1000, 0.2);
    const a = withEq[withEq.length - 1].peak;
    const b = withoutEq[withoutEq.length - 1].peak;
    console.log(`X24 Console EQ: EQ in ${a.toFixed(5)}, EQ out ${b.toFixed(5)}`);
    expect(Math.abs(20 * Math.log10(a / b))).toBeLessThan(0.2);
    expect(withoutEq[39].generation - withoutEq[0].generation).toBe(39);
  });

  it('publishes exactly once per processed block', () => {
    configure();
    const frames = driver.run(32, 1000, 0.2);
    expectPublishedOncePerBlock(frames);
    expect(frames[31].generation - frames[0].generation).toBe(31);
    const before = frames[31].generation;
    expect(driver.processBlock(0).generation).toBe(before + 1);
  });

  it('the face names channels the engine actually publishes', () => {
    const published = new Set<string>([
      ConsoleEqMeter.InputPeak,
      ConsoleEqMeter.OutputPeak,
      ConsoleEqMeter.MidQ,
      ConsoleEqMeter.BandOneWidth,
      ConsoleEqMeter.BandTwoWidth,
      ConsoleEqMeter.BandThreeWidth,
    ]);
    for (const element of consoleEqUnit.face?.elements ?? []) {
      if (!element.meterChannel) continue;
      expect(
        published.has(element.meterChannel),
        `${element.id} names ${element.meterChannel}`,
      ).toBe(true);
    }
  });
});
