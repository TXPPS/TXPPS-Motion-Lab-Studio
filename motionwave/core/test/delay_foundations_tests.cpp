// Motion Wave — the Granular Delay's routing, sync and smear tables.
//
// These three pieces are testable before the unit exists around them, and two of
// them carry a rule the sheet says must be asserted in code rather than reviewed.
#include "../units/delay_routing.h"
#include "../units/delay_smear.h"
#include "../units/delay_sync.h"
#include "harness.h"

#include <cmath>
#include <cstdio>

using namespace mw::units::delay;

MW_TEST("fx-03 §3.2(b): the loop gain is the sum of the routing terms, not each alone") {
  /*
   * The single most common ping-pong bug, named as such in §3.2: self-feedback
   * 0.8 and cross-feedback 0.8 pass a check of each term separately and give an
   * effective loop gain of 1.6. The eigenvalues of `[[a,b],[b,a]]` are `a±b`, so
   * the worst mode's gain is `(|a|+|b|)·fb`.
   *
   * This is asserted rather than reviewed because the wrong version is not
   * obviously wrong on the page — it looks like a per-channel stability check,
   * which is exactly what it is not.
   */
  Routing dangerous;
  dangerous.self = 0.8;
  dangerous.cross = 0.8;
  std::printf("    §3.2(b): self 0.8, cross 0.8 — worst-case gain %.2f\n",
              dangerous.worstCaseGain());
  MW_EXPECT_NEAR(dangerous.worstCaseGain(), 1.6, 1.0e-12);
  // Each term alone is under one, which is what makes the separate check pass.
  MW_EXPECT(dangerous.self < 1.0 && dangerous.cross < 1.0);
  // And the combination does not decay, at any feedback that looks safe.
  MW_EXPECT(!decaysWhenLinear(dangerous, 0.7));

  /*
   * Every shipped mode has rows summing to one, which is what makes the
   * feedback control alone decide stability. §3.2 says that if a future mode
   * breaks that, the inequality must be asserted — so it is asserted here for
   * every mode, and a new mode that broke it would fail this row rather than a
   * user's session.
   */
  const Topology modes[4] = {Topology::Dual, Topology::PingPong, Topology::Blend,
                             Topology::MonoSum};
  for (Topology mode : modes) {
    for (double cross = 0.0; cross <= 1.0; cross += 0.05) {
      const Routing routing = routingFor(mode, cross);
      MW_EXPECT_NEAR(routing.worstCaseGain(), 1.0, 1.0e-12);
      // So a linear loop decays below unity feedback and not above it, whatever
      // the mode and the cross control are set to.
      MW_EXPECT(decaysWhenLinear(routing, 0.99));
      MW_EXPECT(!decaysWhenLinear(routing, 1.01));
    }
  }
  std::printf("    §3.2(b): all four modes have unity worst-case gain at every cross setting\n");
}

MW_TEST("fx-03 §3.2(a): a resonant loop filter's peak gain is part of the condition") {
  /*
   * §3.2(a): the condition for decay is `fb · max|H_loop| < 1`, not `fb < 1`. A
   * resonant filter at Q = 4 has about 12 dB of peak gain, so a loop at half
   * feedback through it is unstable — which is the sentence the sheet writes and
   * the arithmetic nobody does.
   */
  const Routing dual = routingFor(Topology::Dual, 0.0);
  const double twelveDb = std::pow(10.0, 12.0 / 20.0);
  std::printf("    §3.2(a): fb 0.5 through a %.2f× (12 dB) peak is a loop gain of %.2f\n",
              twelveDb, 0.5 * twelveDb);
  MW_EXPECT(!decaysWhenLinear(dual, 0.5, twelveDb));
  // Normalised to unity peak, which is what the unit does, the same setting is
  // comfortably stable.
  MW_EXPECT(decaysWhenLinear(dual, 0.5, 1.0));
}

MW_TEST("fx-03 §5: a division is a fraction of a whole note, and a quarter is one beat") {
  /*
   * §5's formula carries a factor of four because the divisions count whole
   * notes. The check that matters is the one V3 grades: at 4/4 a quarter must
   * come out at exactly one beat, because every other line in the sheet assumes
   * it — and a missing factor of four is not a subtle failure.
   */
  const double bpms[3] = {60.0, 120.0, 174.0};
  for (double bpm : bpms) {
    const double quarter = delaySecondsFor(Division::Quarter, Modifier::Straight, bpm);
    std::printf("    §5: %6.1f bpm — a quarter is %.6f s, one beat is %.6f\n", bpm, quarter,
                60.0 / bpm);
    MW_EXPECT_NEAR(quarter, 60.0 / bpm, 1.0e-12);
    // A whole note is four beats, and eight bars is thirty-two.
    MW_EXPECT_NEAR(delaySecondsFor(Division::Whole, Modifier::Straight, bpm), 4.0 * 60.0 / bpm,
                   1.0e-12);
    MW_EXPECT_NEAR(delaySecondsFor(Division::EightBars, Modifier::Straight, bpm),
                   32.0 * 60.0 / bpm, 1.0e-9);
    // Dotted is half again; a triplet is two thirds. Checked as ratios so the
    // row fails on the modifier rather than on the division it was applied to.
    MW_EXPECT_NEAR(delaySecondsFor(Division::Eighth, Modifier::Dotted, bpm) /
                       delaySecondsFor(Division::Eighth, Modifier::Straight, bpm),
                   1.5, 1.0e-12);
    MW_EXPECT_NEAR(delaySecondsFor(Division::Eighth, Modifier::Triplet, bpm) /
                       delaySecondsFor(Division::Eighth, Modifier::Straight, bpm),
                   2.0 / 3.0, 1.0e-12);
    // And a dotted eighth is a quarter's three quarters, which is the
    // relationship §5 says the two-axis selector exists to make legible.
    MW_EXPECT_NEAR(delaySecondsFor(Division::Eighth, Modifier::Dotted, bpm),
                   0.75 * delaySecondsFor(Division::Quarter, Modifier::Straight, bpm), 1.0e-12);
  }
}

MW_TEST("fx-03 §4: Smear zero bypasses the window, and the continuum runs the right way") {
  /*
   * Two claims. The first is §4's bit-exact requirement: at zero the window is
   * bypassed entirely rather than approached, because an interpolation that
   * merely tended toward one grain would leave the granular machinery colouring
   * the plain delay — which is what V2's −140 dBFS null exists to catch and what
   * a limit rather than a branch would quietly fail.
   *
   * The second is the direction, which is the opposite of the obvious one: as
   * smear rises the grains get *shorter* and *more numerous*. A table entered
   * from memory tends to get this backwards, and backwards is not obviously
   * wrong from the sound — it is a different effect that also smears.
   */
  MW_EXPECT(smearAt(0.0).bypassed());
  MW_EXPECT_EQ(static_cast<long long>(smearAt(0.0).grainsPerTap), 1LL);
  MW_EXPECT_NEAR(smearAt(0.0).spraySeconds, 0.0, 0.0);
  MW_EXPECT_NEAR(smearAt(0.0).onsetJitter, 0.0, 0.0);
  // And nothing above zero is bypassed, so the branch cannot swallow a setting.
  MW_EXPECT(!smearAt(0.01).bypassed());

  const double points[4] = {0.25, 0.50, 0.75, 1.00};
  const long long grains[4] = {3, 8, 16, 32};
  const double spray[4] = {0.015, 0.060, 0.150, 0.400};
  const double length[4] = {0.120, 0.080, 0.055, 0.035};
  for (int i = 0; i < 4; ++i) {
    const SmearSettings s = smearAt(points[i]);
    std::printf("    §4: smear %3.0f %% — %2d grain(s), spray %.0f ms, jitter %.0f %%, "
                "length %.0f ms\n",
                100.0 * points[i], s.grainsPerTap, 1000.0 * s.spraySeconds,
                100.0 * s.onsetJitter, 1000.0 * s.grainSeconds);
    MW_EXPECT_EQ(static_cast<long long>(s.grainsPerTap), grains[i]);
    MW_EXPECT_NEAR(s.spraySeconds, spray[i], 1.0e-9);
    MW_EXPECT_NEAR(s.grainSeconds, length[i], 1.0e-9);
  }

  // Monotone in both directions across the whole range, which is what makes it
  // a continuum rather than four presets with a slider over them.
  int lastGrains = 0;
  double lastLength = 1.0;
  for (double a = 0.01; a <= 1.0; a += 0.01) {
    const SmearSettings s = smearAt(a);
    MW_EXPECT(s.grainsPerTap >= lastGrains);
    MW_EXPECT(s.grainSeconds <= lastLength + 1.0e-12);
    lastGrains = s.grainsPerTap;
    lastLength = s.grainSeconds;
  }
  // The crossing §4 says to mark: somewhere in the sweep the grain length passes
  // below the 50 ms fusion threshold, and it does so once rather than wobbling.
  MW_EXPECT(smearAt(0.75).grainSeconds > 0.050);
  MW_EXPECT(smearAt(1.00).grainSeconds < 0.050);
}

MW_TEST("fx-03 §4: the overlap a tap runs at is the number the normalisation needs") {
  /*
   * `fx-02` §1.3's normalisation is `1/sqrt(O·mean(w²))` and `O` is
   * grains × length / hop. Getting `O` wrong does not sound like a wrong level;
   * it sounds like the *decay time* changing with Smear, because the loop gain
   * moves with it. That is V6, and it is the same failure the reverb's V6
   * grades one unit over.
   */
  /*
   * **`grains-per-tap` counts independent streams, not grains in flight**, and
   * reading it the other way is why this row failed first. §4's formula is
   * `O = grains-per-tap × (grainLength / hop)`: each of the N streams spawns
   * every `hop` and so contributes `L/hop` of overlap on its own. Dividing the
   * hop by N as well — which is what "N grains spread across one grain length"
   * suggests — counts the streams twice and gives N², or 1024 here.
   *
   * With the hop at one grain length each stream has exactly one grain sounding
   * at a time, so the overlap is the stream count, which is the reading that
   * makes §4's table say what it looks like it says.
   */
  const SmearSettings dense = smearAt(1.0);
  const double overlap = overlapFor(dense, dense.grainSeconds);
  std::printf("    §4: 32 streams of %.0f ms at a %.0f ms hop is an overlap of %.1f\n",
              1000.0 * dense.grainSeconds, 1000.0 * dense.grainSeconds, overlap);
  MW_EXPECT_NEAR(overlap, 32.0, 1.0e-9);
  // Halving the hop doubles the overlap, which is the other half of the formula
  // and the half a stream count alone cannot express.
  MW_EXPECT_NEAR(overlapFor(dense, dense.grainSeconds * 0.5), 64.0, 1.0e-9);
  // A bypassed tap is one continuous read, so its overlap is one whatever hop
  // it is asked about — the normalisation must not scale a plain delay.
  MW_EXPECT_NEAR(overlapFor(smearAt(0.0), 0.010), 1.0, 0.0);
  MW_EXPECT_NEAR(overlapFor(smearAt(0.0), 0.500), 1.0, 0.0);
}

MW_TEST_MAIN("delay-foundations")
