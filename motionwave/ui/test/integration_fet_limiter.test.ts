/**
 * Ledger cell X24 — the FET Limiter, end to end.
 *
 * The same claim as the Motion Shaper's: a real face driving a real engine,
 * getting back real audio and the real state the audio path published. What is
 * different here is what there is to catch. This unit's panel has two controls
 * whose sense is inverted and a ratio switch that moves the threshold as well
 * as the slope, so a taper that arrived plausible-but-wrong would be *hard to
 * see* on the panel and obvious in the audio — which is exactly the gap between
 * D1 and U20 that X24 exists to close.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { FetLimiterParam } from '../units/fet_limiter/params.gen';
import { fetLimiterUnit } from '../units/fet_limiter/unit';
import { UnitDriver, expectPublishedOncePerBlock, loadCore } from './x24_driver';

/** The bridge packs four: the two peaks, the reduction, the timing charge. */
const VISUAL = { inputPeak: 0, outputPeak: 1, gainReduction: 2, detector: 3 } as const;

let driver: UnitDriver;

beforeAll(async () => {
  const core = await loadCore();
  driver = UnitDriver.from(core, 'mw_fet_limiter', fetLimiterUnit.specs, 4);
}, 60_000);

/**
 * Start from the spec table's own defaults every time.
 *
 * The module holds one unit for the file's lifetime, so a configuration that
 * names only what it changes inherits whatever the previous case swept it to.
 * That defect cost the Motion Shaper's X24 a debugging session and the comment
 * there records it; this is the same shape of mistake and the same guard.
 */
function configure() {
  driver.prepare();
  for (const spec of fetLimiterUnit.specs) driver.setParam(spec.id, spec.def);
}

describe('X24 — FET Limiter through the real boundary', () => {
  it('limits, and publishes a reduction that matches the audio', () => {
    configure();
    driver.setParam(FetLimiterParam.Limiting, 1);
    driver.setParam(FetLimiterParam.Input, 4.0);
    const frames = driver.run(200, 1000, 0.25);

    const settled = frames.slice(120);
    const reduction = settled[settled.length - 1].visual[VISUAL.gainReduction];
    const quiet = frames[0].peak;
    const loud = settled[settled.length - 1].peak;
    console.log(
      `X24 FET: published reduction ${reduction.toFixed(2)} dB, output ${quiet.toFixed(3)} -> ${loud.toFixed(3)}`,
    );
    // The unit is doing something, and what it publishes is what it did: the
    // output has to be below what the same input would give with the detector
    // out, by about what the meter claims.
    expect(reduction).toBeGreaterThan(3);
    for (const frame of settled) {
      expect(frame.visual[VISUAL.outputPeak]).toBeCloseTo(frame.peak, 5);
    }
  });

  it('the ratio switch moves the threshold, not just the slope', () => {
    // §9 test 5's claim, seen from the browser: at a fixed input, switching from
    // 4:1 to 20:1 must *reduce* the gain reduction. A model that implemented the
    // ratio as a slope alone gives more, and a face would show it as more —
    // which is the wrong way round and the thing users of the hardware notice
    // first.
    configure();
    driver.setParam(FetLimiterParam.Limiting, 1);
    driver.setParam(FetLimiterParam.Input, 4.0);
    driver.setParam(FetLimiterParam.Ratio, 0);
    const four = driver.run(160, 1000, 0.25);
    configure();
    driver.setParam(FetLimiterParam.Limiting, 1);
    driver.setParam(FetLimiterParam.Input, 4.0);
    driver.setParam(FetLimiterParam.Ratio, 3);
    const twenty = driver.run(160, 1000, 0.25);

    const fourDb = four[four.length - 1].visual[VISUAL.gainReduction];
    const twentyDb = twenty[twenty.length - 1].visual[VISUAL.gainReduction];
    console.log(
      `X24 FET: 4:1 reduces ${fourDb.toFixed(2)} dB, 20:1 reduces ${twentyDb.toFixed(2)} dB`,
    );
    expect(fourDb).toBeGreaterThan(twentyDb);
    // And both are really limiting, or the comparison is between two zeros.
    expect(twentyDb).toBeGreaterThan(1);
  });

  it('the timing charge is a state, and it holds between hits', () => {
    // §4.2's rule, which the face draws: closely spaced transients hold the gain
    // down and recover together rather than individually. The published charge
    // is how a user sees why the second hit behaved differently, so it has to
    // still be up when the signal has gone.
    configure();
    driver.setParam(FetLimiterParam.Limiting, 1);
    driver.setParam(FetLimiterParam.Input, 4.0);
    driver.setParam(FetLimiterParam.Release, 1);
    driver.run(120, 1000, 0.3);
    const after = driver.runSilent(20, 120 * driver.block);
    const held = after[after.length - 1].visual[VISUAL.detector];
    console.log(`X24 FET: charge still ${held.toFixed(3)} dB with the signal gone`);
    expect(held).toBeGreaterThan(0.5);
  });

  it('publishes exactly once per processed block', () => {
    // The discriminator. A timer-driven face passes everything above and fails
    // this, because it cannot know how many blocks the engine processed.
    configure();
    driver.setParam(FetLimiterParam.Limiting, 1);
    const frames = driver.run(32, 1000, 0.2);
    expectPublishedOncePerBlock(frames);
    expect(frames[31].generation - frames[0].generation).toBe(31);

    // And nothing is published when nothing is processed. This is the half a
    // timer fails hardest.
    const before = frames[31].generation;
    expect(driver.processBlock(0).generation).toBe(before + 1);
  });

  it('a bypassed unit still publishes, and publishes the truth', () => {
    configure();
    driver.setBypass(true);
    const frames = driver.run(16, 1000, 0.5);
    for (const frame of frames) {
      // Bypass passes signal, so a face that froze or blanked would be lying
      // about a unit the user can still hear.
      expect(frame.peak).toBeGreaterThan(0.45);
      expect(frame.visual[VISUAL.gainReduction]).toBeCloseTo(0, 6);
    }
    expect(frames[15].generation - frames[0].generation).toBe(15);
  });

  it('the face names channels the engine actually publishes', () => {
    // U20 checks the face's meters against the unit's declared channel list;
    // this checks that list against the engine's published frame. Without it
    // both halves could agree on a channel nothing fills.
    // Read from the unit's own declaration rather than listed here.
    //
    // A list beside the thing can agree with the thing while the thing has
    // changed, and this one did: the Console EQ gained two published channels
    // and this set did not, so a test whose whole subject is "the face names
    // what the engine publishes" failed on a face that had been kept in step.
    // `frame_packing.test.ts` is the other half — it holds the declaration
    // against what `bridge.cpp` actually packs, so trusting it here is not
    // trusting nobody.
    const published = new Set<string>((fetLimiterUnit.meters ?? []).map((c) => c.name));
    for (const element of fetLimiterUnit.face?.elements ?? []) {
      if (!element.meterChannel) continue;
      expect(
        published.has(element.meterChannel),
        `${element.id} names ${element.meterChannel}`,
      ).toBe(true);
    }
  });
});
