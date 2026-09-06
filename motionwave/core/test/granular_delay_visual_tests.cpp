// Motion Wave — Granular Delay, what the panel is told. Ledger cells U20, V27.
//
// V27 asks for a live visual that stops when the audio stops, and `fx-02`
// taught what "live" has to mean: a field that is a function of the controls
// is a control read back, however honestly it was computed, and a face drawn
// from it is still while the engine runs. So each field this unit publishes
// is graded against a discriminator — the way it could be got wrong.
//
//  - **pitchRatio** is the transport's own `v(t) / v(t − D)`, the same number
//    the read position is integrated from. It moves during a Tape-mode change
//    and returns to exactly one when the change is done, and it does not know
//    how loud the input is. A control-derived version could not do the first
//    and a meter-derived one could not do the last.
//  - **tapSeconds** is the delivered time after the transport, not the setting:
//    during a Digital fade it is still the old time, and after it the new one.
//  - **loopPeak** is the signal that recirculates, which a wet meter would hide
//    under the first arrival. It decays after the input stops, at the loop's
//    own rate.
//  - **liveGrains** and **cloudDepthSeconds** are the engine's, zero when no
//    tap is granular and non-zero the moment one is.
#include "granular_delay_harness.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;
using namespace mw::test::fx03;

namespace {

/// The frames published per block through `renderWith`, as the face sees them.
std::vector<GranularDelayFrame> framesOf(GranularDelay& unit, int frames, double hz, double amplitude,
                                         int stopAt) {
  std::vector<GranularDelayFrame> out;
  const Tone tone{hz, amplitude};
  renderWith(unit, frames, [&](int i) {
    return i < stopAt ? tone(i) : std::pair<float, float>{0.0f, 0.0f};
  }, [&](int block) {
    if (block > 0) {
      GranularDelayFrame frame;
      unit.visual().read(frame);
      out.push_back(frame);
    }
  });
  GranularDelayFrame last;
  unit.visual().read(last);
  out.push_back(last);
  return out;
}

}  // namespace

MW_TEST("V27: the pitch ratio moves through a Tape-mode change and is one once it is done") {
  GranularDelay unit;
  configure(unit);
  unit.setTimeChangeMode(delay::TimeChangeMode::Tape);
  unit.reset();
  double deepest = 0.0;
  int movingBlocks = 0;
  const Tone tone{330.0, 0.3};
  renderWith(unit, 5 * 48000, tone, [&](int block) {
    // Block 188, a second in: a boundary the block size reaches, which
    // `block * kBlock == 48000` is not.
    if (block == 188) {
      TapSettings tap = unit.tap(0);
      tap.delaySeconds = 0.450;
      unit.setTap(0, tap);
    }
    if (block > 0) {
      const double away = std::fabs(static_cast<double>(unit.frame().pitchRatio) - 1.0);
      deepest = std::max(deepest, away);
      if (away > 1.0e-3) ++movingBlocks;
    }
  });
  const double settled = static_cast<double>(unit.frame().pitchRatio);
  std::printf("    V27: pitch ratio strayed %.4f from one over %d block(s), settled at %.6f\n",
              deepest, movingBlocks, settled);
  MW_EXPECT(deepest > 0.02);
  MW_EXPECT(movingBlocks > 20);
  MW_EXPECT_NEAR(settled, 1.0, 1.0e-4);
}

MW_TEST("V27: twenty decibels of level does not move the pitch ratio") {
  auto trace = [](double amplitude) {
    GranularDelay unit;
    configure(unit);
    unit.setTimeChangeMode(delay::TimeChangeMode::Tape);
    unit.reset();
    std::vector<double> ratios;
    const Tone tone{330.0, amplitude};
    renderWith(unit, 2 * 48000, tone, [&](int block) {
      if (block == 94) {
        TapSettings tap = unit.tap(0);
        tap.delaySeconds = 0.400;
        unit.setTap(0, tap);
      }
      if (block > 0) ratios.push_back(static_cast<double>(unit.frame().pitchRatio));
    });
    return ratios;
  };
  const std::vector<double> quiet = trace(0.03);
  const std::vector<double> loud = trace(0.3);
  double worst = 0.0;
  double deepest = 0.0;
  for (std::size_t i = 0; i < quiet.size() && i < loud.size(); ++i) {
    worst = std::max(worst, std::fabs(quiet[i] - loud[i]));
    deepest = std::max(deepest, std::fabs(loud[i] - 1.0));
  }
  std::printf("    V27: −30 and −10 dBFS traces differ by at most %.2e across a bend of %.4f\n",
              worst, deepest);
  MW_EXPECT(deepest > 0.01);
  MW_EXPECT_NEAR(worst, 0.0, 0.0);
}

MW_TEST("V27: the published tap time is the delivered one, through a Digital fade") {
  GranularDelay unit;
  configure(unit);
  const Tone tone{330.0, 0.3};
  std::vector<float> during;
  renderWith(unit, 48000, tone, [&](int block) {
    if (block * kBlock == 24064) {
      TapSettings tap = unit.tap(0);
      tap.delaySeconds = 0.400;
      unit.setTap(0, tap);
    }
    // One block after the change the fade is a quarter through, and the
    // delivered time is still the old head's.
    if (block * kBlock == 24064 + kBlock) during.push_back(unit.frame().tapSeconds[0]);
  });
  const GranularDelayFrame after = unit.frame();
  std::printf("    V27: tap time reads %.4f s during the fade and %.4f s after it\n",
              static_cast<double>(during.at(0)), static_cast<double>(after.tapSeconds[0]));
  MW_EXPECT_NEAR(static_cast<double>(during.at(0)), 0.250, 1.0e-4);
  MW_EXPECT_NEAR(static_cast<double>(after.tapSeconds[0]), 0.400, 1.0e-4);
  MW_EXPECT_EQ(static_cast<int>(after.activeTaps), 1);
}

MW_TEST("V27: the loop meter decays after the input stops, and reaches zero") {
  GranularDelay unit;
  configure(unit);
  unit.setFeedback(0.5);
  unit.reset();
  // Two seconds of tone, then six of silence: twenty-four passes at −6 dB each.
  const std::vector<GranularDelayFrame> frames = framesOf(unit, 8 * 48000, 330.0, 0.3, 2 * 48000);
  const std::size_t perSecond = static_cast<std::size_t>(48000 / kBlock);
  const float driven = frames[2 * perSecond - 1].loopPeak;
  const float later = frames[3 * perSecond].loopPeak;
  const float last = frames.back().loopPeak;
  const float lastOutput = frames.back().outputPeak;
  std::printf("    V27: loop peak %.4f driven, %.4f a second after the input stopped, %.2e at the end;"
              " output %.2e\n",
              static_cast<double>(driven), static_cast<double>(later), static_cast<double>(last),
              static_cast<double>(lastOutput));
  MW_EXPECT(driven > 0.05f);
  MW_EXPECT(later < driven * 0.5f);
  MW_EXPECT(later > 0.0f);
  // U20: a stopped unit reads zero, not its last value — the peaks are per block.
  MW_EXPECT(last < 1.0e-5f);
  MW_EXPECT(lastOutput < 1.0e-5f);
}

MW_TEST("V27: the grain fields are the engine's, zero for a plain tap and live for a smeared one") {
  GranularDelay plain;
  configure(plain);
  const std::vector<GranularDelayFrame> still = framesOf(plain, 48000, 330.0, 0.3, 48000);
  GranularDelay smeared;
  configure(smeared);
  smeared.setSmear(0.5);
  smeared.reset();
  const std::vector<GranularDelayFrame> busy = framesOf(smeared, 48000, 330.0, 0.3, 48000);
  int changes = 0;
  for (std::size_t i = 1; i < busy.size(); ++i) {
    if (busy[i].cloudDepthSeconds != busy[i - 1].cloudDepthSeconds) ++changes;
  }
  std::printf("    V27: plain tap %u grain(s); smeared %u grain(s), depth %.4f s, overlap %.2f,"
              " depth moved on %d block(s)\n",
              static_cast<unsigned>(still.back().liveGrains), static_cast<unsigned>(busy.back().liveGrains),
              static_cast<double>(busy.back().cloudDepthSeconds), static_cast<double>(busy.back().overlap),
              changes);
  MW_EXPECT_EQ(static_cast<int>(still.back().liveGrains), 0);
  MW_EXPECT_NEAR(static_cast<double>(still.back().cloudDepthSeconds), 0.0, 0.0);
  MW_EXPECT(busy.back().liveGrains > 0);
  MW_EXPECT(busy.back().cloudDepthSeconds > 0.2f);
  MW_EXPECT(busy.back().cloudDepthSeconds < 1.0f);
  MW_EXPECT(busy.back().overlap > 1.0f);
  // Live: the depth is a mean over grains that are being replaced, so it moves.
  MW_EXPECT(changes > 20);
}

MW_TEST("V27: the duck meter follows the input and lets go after it") {
  GranularDelay unit;
  configure(unit);
  unit.setDucking(1.0);
  unit.setFeedback(0.5);
  unit.reset();
  const std::vector<GranularDelayFrame> frames = framesOf(unit, 3 * 48000, 330.0, 0.5, 48000);
  const std::size_t perSecond = static_cast<std::size_t>(48000 / kBlock);
  const float ducked = frames[perSecond - 1].duckGain;
  const float released = frames.back().duckGain;
  std::printf("    V27: duck gain %.3f under input, %.3f two seconds after it\n",
              static_cast<double>(ducked), static_cast<double>(released));
  MW_EXPECT(ducked < 0.5f);
  MW_EXPECT(released > 0.99f);
}

MW_TEST_MAIN("granular-delay-visual")
