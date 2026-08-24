/**
 * Ledger cell X24 — the Granular Reverb, end to end.
 *
 * What this unit can get wrong across the boundary that the others could not:
 * **it is the first one whose panel is a picture of internal state rather than
 * of a level.** The cloud reads a grain frame, and the four readouts beside the
 * controls are quantities no control states — the overlap, the density the
 * quality tier actually allowed, the decay the damping actually produces, and
 * the loop gain the decay control actually set. Every one of those is a place a
 * face could show a plausible number that the audio disagrees with, and a
 * native row cannot catch it because natively there is no boundary to cross.
 *
 * The other thing X24 exists for, on every unit: a bypassed unit is still in
 * circuit and still audible, so its meters must still move. Four units were
 * publishing zeros there before this cell was written.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { GranularReverbParam } from '../units/granular_reverb/params.gen';
import { granularReverbUnit } from '../units/granular_reverb/unit';
import { UnitDriver, expectPublishedOncePerBlock, loadCore } from './x24_driver';

/** Seven: the two peaks, then the five numbers no control states. */
const VISUAL = {
  inputPeak: 0,
  outputPeak: 1,
  overlap: 2,
  clampedDensity: 3,
  rt60At8k: 4,
  feedback: 5,
  liveGrains: 6,
} as const;

let driver: UnitDriver;

beforeAll(async () => {
  const core = await loadCore();
  driver = UnitDriver.from(core, 'mw_granular_reverb', granularReverbUnit.specs, 7);
}, 60_000);

function configure() {
  driver.prepare();
  for (const spec of granularReverbUnit.specs) driver.setParam(spec.id, spec.def);
  // Fully wet, so what is measured is the cloud and not the dry signal it is
  // mixed with. Every row below is about the wet path.
  driver.setParam(GranularReverbParam.Mix, 100);
}

describe('X24 — Granular Reverb through the real boundary', () => {
  it('the overlap readout is the product of the two controls that set it', () => {
    // §6 calls this out as "not a control: display O = R·L live", because
    // neither Density nor Grain size predicts it alone. It is also the number
    // that predicts the CPU, so a face computing it in TypeScript would be a
    // second opinion about the unit's own load.
    configure();
    driver.setParam(GranularReverbParam.Density, 200);
    driver.setParam(GranularReverbParam.GrainSize, 50);
    const sparse = driver.run(40, 440, 0.2);
    const sparseOverlap = sparse[sparse.length - 1].visual[VISUAL.overlap];

    configure();
    driver.setParam(GranularReverbParam.Density, 800);
    driver.setParam(GranularReverbParam.GrainSize, 50);
    driver.setParam(GranularReverbParam.Quality, 2);
    const dense = driver.run(40, 440, 0.2);
    const denseOverlap = dense[dense.length - 1].visual[VISUAL.overlap];

    /*
     * **The readout is the overlap delivered, not the product asked for, and
     * this row learned that the hard way.** At the Studio default the same
     * 800 g/s × 50 ms reads 32 rather than 40, because §7.4's tier cap is 32
     * there and the engine gave what it capped to. The first version of this
     * expectation asserted 40 and was wrong: a panel showing 40 while 32 were
     * sounding is precisely the failure the readout exists to prevent. So the
     * uncapped arithmetic is checked on the tier that permits it, and the cap
     * is checked as a cap.
     */
    configure();
    driver.setParam(GranularReverbParam.Density, 800);
    driver.setParam(GranularReverbParam.GrainSize, 50);
    const capped = driver.run(40, 440, 0.2);
    const cappedOverlap = capped[capped.length - 1].visual[VISUAL.overlap];

    console.log(
      `X24 Granular Reverb: overlap ${sparseOverlap.toFixed(2)} at 200 g/s, ` +
        `${denseOverlap.toFixed(2)} at 800 on Max, ${cappedOverlap.toFixed(2)} on Studio`,
    );
    // 200 × 0.050 = 10, and 800 × 0.050 = 40 — the arithmetic §6 states.
    expect(sparseOverlap).toBeCloseTo(10, 0);
    expect(denseOverlap).toBeCloseTo(40, 0);
    // And §7.4's Studio ceiling, reported rather than hidden.
    expect(cappedOverlap).toBeLessThan(denseOverlap);
    expect(cappedOverlap).toBeCloseTo(32, 0);
  });

  it('the quality tier reports the density it actually allowed, not the one asked for', () => {
    // §7.4 caps the overlap per tier. A panel that echoed the control back
    // would tell a user on the Eco tier that they had two thousand grains a
    // second when the engine had given them a fraction of it — which is the
    // failure mode a readout exists to prevent, not one it may have.
    configure();
    driver.setParam(GranularReverbParam.Density, 2000);
    driver.setParam(GranularReverbParam.Quality, 2);
    const max = driver.run(40, 440, 0.2);

    configure();
    driver.setParam(GranularReverbParam.Density, 2000);
    driver.setParam(GranularReverbParam.Quality, 0);
    const eco = driver.run(40, 440, 0.2);

    const maxDensity = max[max.length - 1].visual[VISUAL.clampedDensity];
    const ecoDensity = eco[eco.length - 1].visual[VISUAL.clampedDensity];
    console.log(
      `X24 Granular Reverb: 2000 g/s asked — Max delivers ${maxDensity.toFixed(0)}, ` +
        `Eco ${ecoDensity.toFixed(0)}`,
    );
    expect(ecoDensity).toBeLessThan(maxDensity);
    expect(ecoDensity).toBeGreaterThan(0);
    // And the live grain count follows it, which is what says the cap reached
    // the scheduler rather than only the readout.
    expect(eco[eco.length - 1].visual[VISUAL.liveGrains]).toBeLessThan(
      max[max.length - 1].visual[VISUAL.liveGrains],
    );
  });

  it('the decay control sets a loop gain, and the damping readout follows the damping', () => {
    // Decay is inverted through a measured table rather than §2.2's formula,
    // which is inference — so the number the panel shows for the loop gain is
    // the one the loop is using, and there is no closed form a face could
    // reproduce even if it wanted to.
    configure();
    driver.setParam(GranularReverbParam.Decay, 1);
    const shortDecay = driver.run(24, 440, 0.2);
    configure();
    driver.setParam(GranularReverbParam.Decay, 20);
    const longDecay = driver.run(24, 440, 0.2);
    const low = shortDecay[shortDecay.length - 1].visual[VISUAL.feedback];
    const high = longDecay[longDecay.length - 1].visual[VISUAL.feedback];
    console.log(
      `X24 Granular Reverb: feedback ${low.toFixed(4)} at 1 s, ${high.toFixed(4)} at 20 s`,
    );
    expect(high).toBeGreaterThan(low);
    // §2.2 caps it at 0.98; above that the loop is marginally stable.
    expect(high).toBeLessThanOrEqual(0.98);

    configure();
    driver.setParam(GranularReverbParam.Decay, 8);
    driver.setParam(GranularReverbParam.Damping, 0);
    const bright = driver.run(24, 440, 0.2);
    configure();
    driver.setParam(GranularReverbParam.Decay, 8);
    driver.setParam(GranularReverbParam.Damping, 100);
    const dark = driver.run(24, 440, 0.2);
    const brightRt = bright[bright.length - 1].visual[VISUAL.rt60At8k];
    const darkRt = dark[dark.length - 1].visual[VISUAL.rt60At8k];
    console.log(
      `X24 Granular Reverb: 8 kHz decay ${brightRt.toFixed(3)} s undamped, ` +
        `${darkRt.toFixed(3)} s damped`,
    );
    // §2.5 asks for this beside the Damping control precisely because damping
    // shortens the top end without touching the Decay setting.
    expect(darkRt).toBeLessThan(brightRt);
  });

  it('the cloud is populated, and the count is the true one rather than the published cap', () => {
    // The frame caps its particle list at sixty-four so the publish path has a
    // fixed size, but the *count* is the real one — a panel that had only the
    // capped number would show the density control appearing to stop working
    // at the point the subset filled.
    configure();
    driver.setParam(GranularReverbParam.Density, 1600);
    driver.setParam(GranularReverbParam.GrainSize, 100);
    driver.setParam(GranularReverbParam.Quality, 2);
    const frames = driver.run(60, 440, 0.2);
    const live = frames[frames.length - 1].visual[VISUAL.liveGrains];
    console.log(`X24 Granular Reverb: ${live.toFixed(0)} grains sounding at 1600 g/s × 100 ms`);
    expect(live).toBeGreaterThan(64);
  });

  it('a bypassed unit still meters, because it is still in circuit', () => {
    configure();
    driver.setBypass(true);
    const bypassed = driver.run(24, 440, 0.25);
    const last = bypassed[bypassed.length - 1];
    console.log(
      `X24 Granular Reverb: bypassed input ${last.visual[VISUAL.inputPeak].toFixed(3)}, ` +
        `output ${last.visual[VISUAL.outputPeak].toFixed(3)}`,
    );
    expect(last.visual[VISUAL.inputPeak]).toBeGreaterThan(0.1);
    expect(last.visual[VISUAL.outputPeak]).toBeGreaterThan(0.1);
  });

  it('publishes once per block, which is what tells a real face from a timer', () => {
    configure();
    expectPublishedOncePerBlock(driver.run(24, 440, 0.2));
  });
});
