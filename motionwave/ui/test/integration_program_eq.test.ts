/**
 * Ledger cell X24 — the Program EQ, end to end.
 *
 * The unit whose defining behaviour is an *interaction*: boosting and
 * attenuating the low band at once does not cancel, it makes the resonant dip
 * the unit is known for. That is a claim about two controls at the same time,
 * which is precisely the class D1 cannot make — D1 moves one parameter and
 * watches the audio, so a pair that only misbehaves together passes it.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { ProgramEqMeter } from '../units/program_eq/face';
import { ProgramEqParam } from '../units/program_eq/params.gen';
import { programEqUnit } from '../units/program_eq/unit';
import { UnitDriver, expectPublishedOncePerBlock, loadCore } from './x24_driver';

/** Six: the two peaks, the make-up amplifier's curvature, the two core drives. */
const VISUAL = {
  inputPeak: 0,
  outputPeak: 1,
  c2: 2,
  c3: 3,
  inputCoreDrive: 4,
  outputCoreDrive: 5,
} as const;

let driver: UnitDriver;

beforeAll(async () => {
  const core = await loadCore();
  driver = UnitDriver.from(core, 'mw_program_eq', programEqUnit.specs, 6);
}, 60_000);

function configure() {
  driver.prepare();
  for (const spec of programEqUnit.specs) driver.setParam(spec.id, spec.def);
  // The noise generator defaults to full, which is right for a unit whose noise
  // floor is part of its character and wrong for a row measuring a level
  // difference of a few decibels.
  driver.setParam(ProgramEqParam.Noise, 0);
}

/** The level at `hz` after the unit has settled, from the audio itself. */
function levelAt(hz: number, blocks = 60): number {
  const frames = driver.run(blocks, hz, 0.15);
  return frames[frames.length - 1].peak;
}

describe('X24 — Program EQ through the real boundary', () => {
  it('boost and attenuation on the same band do not cancel', () => {
    // The unit's signature, and the reason both controls exist on one band. If
    // the boundary carried them as a single net amount the audio would be flat
    // here and the panel would still show two knobs.
    // **The highest corner and a probe under it.** The shelf's plateau is
    // *below* the selected frequency, so a 100 Hz probe against the 20 Hz
    // detent sits two octaves up the transition and reads almost none of the
    // boost — measured that way the boosted setting came out 0.5 dB *quieter*
    // than flat, which is the probe standing above the shelf rather than the
    // shelf failing to boost.
    const corner = 3; // the 100 Hz detent
    const probe = 60;
    configure();
    driver.setParam(ProgramEqParam.LowFreq, corner);
    const flat = levelAt(probe);

    configure();
    driver.setParam(ProgramEqParam.LowFreq, corner);
    driver.setParam(ProgramEqParam.LowBoost, 1);
    const boosted = levelAt(probe);

    configure();
    driver.setParam(ProgramEqParam.LowFreq, corner);
    driver.setParam(ProgramEqParam.LowBoost, 1);
    driver.setParam(ProgramEqParam.LowAtten, 1);
    const both = levelAt(probe);

    console.log(
      `X24 Program EQ: flat ${flat.toFixed(4)}, boost ${boosted.toFixed(4)}, boost+cut ${both.toFixed(4)}`,
    );
    expect(boosted).toBeGreaterThan(flat * 1.5);
    // Both up is not both off: the two networks overlap and leave a dip rather
    // than returning to flat.
    expect(Math.abs(20 * Math.log10(both / flat))).toBeGreaterThan(0.5);
  });

  it('publishes the make-up amplifier curvature and the drive the cores see', () => {
    // U20's rule from the engine's side: the face draws how curved the valve
    // stage is and how hard each transformer is worked, and both numbers are
    // the ones the audio path is running rather than a second calculation.
    //
    // The *coefficients* are asserted only to exist, not ordered. A curvature
    // is not a harmonic: the second harmonic goes as `c2·A` and the third as
    // `c3·A²`, so the second can lead the audio while the third leads the
    // polynomial, and a row that ordered the coefficients would be asserting
    // something about a spectrum from the wrong quantity. The natively measured
    // harmonics are `dyn-01`'s own rows.
    configure();
    const quiet = driver.run(40, 200, 0.1);
    const quietFrame = quiet[quiet.length - 1];
    configure();
    const loud = driver.run(40, 200, 0.4);
    const loudFrame = loud[loud.length - 1];
    console.log(
      `X24 Program EQ: c2 ${loudFrame.visual[VISUAL.c2].toExponential(2)}, c3 ${loudFrame.visual[VISUAL.c3].toExponential(2)}; ` +
        `core drive ${quietFrame.visual[VISUAL.inputCoreDrive].toFixed(3)} -> ${loudFrame.visual[VISUAL.inputCoreDrive].toFixed(3)}`,
    );
    expect(Math.abs(loudFrame.visual[VISUAL.c2])).toBeGreaterThan(0);
    expect(Math.abs(loudFrame.visual[VISUAL.c3])).toBeGreaterThan(0);
    expect(Number.isFinite(loudFrame.visual[VISUAL.c2])).toBe(true);
    // The core drives are the audio's, so they follow it. A constant here would
    // be a face showing a transformer that never works harder.
    expect(loudFrame.visual[VISUAL.inputCoreDrive]).toBeGreaterThan(
      quietFrame.visual[VISUAL.inputCoreDrive] * 2,
    );
  });

  it('publishes exactly once per processed block', () => {
    configure();
    const frames = driver.run(32, 1000, 0.2);
    expectPublishedOncePerBlock(frames);
    expect(frames[31].generation - frames[0].generation).toBe(31);
    const before = frames[31].generation;
    expect(driver.processBlock(0).generation).toBe(before + 1);
  });

  it('a bypassed unit still publishes, and publishes the truth', () => {
    configure();
    driver.setBypass(true);
    const frames = driver.run(16, 1000, 0.5);
    for (const frame of frames) {
      expect(frame.peak).toBeGreaterThan(0.45);
      expect(frame.visual[VISUAL.outputPeak]).toBeCloseTo(frame.peak, 5);
    }
    expect(frames[15].generation - frames[0].generation).toBe(15);
  });

  it('the face names channels the engine actually publishes', () => {
    const published = new Set<string>(Object.values(ProgramEqMeter));
    for (const element of programEqUnit.face?.elements ?? []) {
      if (!element.meterChannel) continue;
      expect(
        published.has(element.meterChannel),
        `${element.id} names ${element.meterChannel}`,
      ).toBe(true);
    }
  });
});
