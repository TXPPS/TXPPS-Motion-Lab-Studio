// Motion Wave — the Granular Delay's routing, sync and smear tables.
//
// These three pieces are testable before the unit exists around them, and two of
// them carry a rule the sheet says must be asserted in code rather than reviewed.
#include "../units/delay_feedback.h"
#include "../units/delay_routing.h"
#include "../units/delay_smear.h"
#include "../units/delay_sync.h"
#include "harness.h"

#include <cmath>
#include <cstdio>
#include <vector>

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

MW_TEST("fx-03 §3.2: a saturating loop above unity converges instead of diverging") {
  /*
   * The property that makes exposing feedback above 100 % defensible rather
   * than reckless: a linear loop at `fb > 1` diverges without bound, and a loop
   * of the form `x ← fb·tanh(x)` converges to the non-zero fixed point of
   * `a = fb·tanh(a)` — the dub runaway that sits at a level instead of
   * destroying the mix.
   *
   * **Measured on a circulating signal, not on a constant, and the first
   * version of this row used a constant.** It iterated the loop with a fixed
   * value looking for the algebraic fixed point, and read 0.223 where the
   * algebra says 0.195. Nothing was wrong with the loop: §3.1 puts a DC blocker
   * first, mandatory, so a constant is precisely the one input whose fixed point
   * the loop is built to destroy. The memoryless algebra describes the
   * *envelope* of something circulating, which is what §9's V4 grades and what
   * this now feeds it.
   */
  constexpr double kRate = 48000.0;
  constexpr int kDelaySamples = 4800;  // 100 ms, so the loop turns over ten times a second.

  auto runLoop = [](double feedback, Topology topology, double inputSeconds, double totalSeconds) {
    DelayFeedback loop;
    loop.prepare(kRate);
    loop.setRouting(routingFor(topology, 0.0));
    loop.setFeedback(feedback);
    loop.setLoopLowpass(18000.0);
    loop.setLoopHighpass(20.0);
    loop.reset();

    std::vector<double> lineL(kDelaySamples, 0.0);
    std::vector<double> lineR(kDelaySamples, 0.0);
    int at = 0;
    const int frames = static_cast<int>(kRate * totalSeconds);
    const int inputFrames = static_cast<int>(kRate * inputSeconds);
    // Peak per 100 ms, so the trace is one number per turn of the loop.
    std::vector<double> envelope;
    double windowPeak = 0.0;
    double worstPeak = 0.0;
    bool finite = true;
    for (int i = 0; i < frames; ++i) {
      const double drive =
          i < inputFrames
              ? 0.3 * std::sin(2.0 * 3.14159265358979323846 * 700.0 * i / kRate)
              : 0.0;
      const double wetL = lineL[static_cast<std::size_t>(at)] + drive;
      const double wetR = lineR[static_cast<std::size_t>(at)] + drive;
      double backL = 0.0;
      double backR = 0.0;
      loop.process(wetL, wetR, &backL, &backR);
      if (!std::isfinite(backL) || !std::isfinite(backR)) finite = false;
      lineL[static_cast<std::size_t>(at)] = backL;
      lineR[static_cast<std::size_t>(at)] = backR;
      if (++at >= kDelaySamples) at = 0;
      windowPeak = std::max(windowPeak, std::fabs(wetL));
      worstPeak = std::max(worstPeak, std::fabs(wetL));
      if ((i + 1) % kDelaySamples == 0) {
        envelope.push_back(windowPeak);
        windowPeak = 0.0;
      }
    }
    struct Result {
      std::vector<double> envelope;
      double worstPeak;
      bool finite;
    };
    return Result{envelope, worstPeak, finite};
  };

  // Above unity: bounded, converging, and never past −0.1 dBFS.
  const double runaway[3] = {1.05, 1.15, 1.30};
  for (double fb : runaway) {
    const auto result = runLoop(fb, Topology::Dual, 0.5, 40.0);
    const std::size_t n = result.envelope.size();
    const double settled = result.envelope[n - 1];
    const double earlier = result.envelope[n - 21];
    std::printf("    §3.2: fb %.2f — envelope %.4f at 38 s against %.4f two seconds earlier,"
                " peak %.4f\n",
                fb, settled, earlier, result.worstPeak);
    MW_EXPECT(result.finite);
    // Converged: twenty turns of the loop apart and no longer moving.
    MW_EXPECT(std::fabs(settled - earlier) <= 0.005);
    // Self-oscillating rather than dead, which is what "runaway" means.
    MW_EXPECT(settled > 0.01);
    // §9 V4's ceiling.
    MW_EXPECT(result.worstPeak <= std::pow(10.0, -0.1 / 20.0));
  }

  /*
   * Below unity the same loop must decay after the input stops — including
   * through full cross, which is the routing that carries the whole signal from
   * one channel to the other every pass and is where §3.2(b)'s bug lives. A
   * saturator that pinned the level regardless of feedback would pass every
   * assertion above and be useless as a delay.
   */
  const Topology modes[2] = {Topology::Dual, Topology::PingPong};
  for (Topology mode : modes) {
    const auto result = runLoop(0.7, mode, 0.5, 20.0);
    const std::size_t n = result.envelope.size();
    std::printf("    §3.2: fb 0.70 %s — envelope %.3e at 2 s falls to %.3e by 20 s\n",
                mode == Topology::Dual ? "dual     " : "ping-pong", result.envelope[20],
                result.envelope[n - 1]);
    MW_EXPECT(result.finite);
    MW_EXPECT(result.envelope[n - 1] < result.envelope[20] * 1.0e-3);
  }

  // The drive floor is in force above unity and not below it, which is the half
  // §3.2 says must not be defeatable and the half it says is the user's.
  DelayFeedback hot;
  hot.setFeedback(1.2);
  hot.setDrive(1.0);
  MW_EXPECT(hot.driveNow() >= 2.0);
  DelayFeedback gentle;
  gentle.setFeedback(0.9);
  gentle.setDrive(1.0);
  MW_EXPECT_NEAR(gentle.driveNow(), 1.0, 0.0);
}

MW_TEST_MAIN("delay-foundations")
