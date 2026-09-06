// Motion Wave — the Granular Delay's remaining DSP ledger cells, and §9 V15.
//
// D1 and D7 are measured in `granular_delay_delta_tests`, D3 by the sheet's
// rows across `granular_delay_tests`, `_transport_tests` and `_character_tests`,
// and D2 and D11 are judged from the manifest by the UI harness. What is here
// is the rest: bypass (D4), sample rates (D6), latency (D8), the fuzz (D9), the
// zipper (D10), tempo (D12), and the CPU row.
#include "../units/generated/granular_delay_params.gen.h"
#include "granular_delay_harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <ctime>
#include <vector>

using namespace mw;
using namespace mw::units;
using namespace mw::test::fx03;

namespace {

/// Content across the band, so a rate change has something to be wrong about at
/// the top as well as the bottom.
struct Programme {
  double rate = kRate;
  std::pair<float, float> operator()(int index) const {
    const double t = static_cast<double>(index) / rate;
    const float v = static_cast<float>(0.2 * (std::sin(2.0 * kPi * 131.0 * t) +
                                              0.6 * std::sin(2.0 * kPi * 1103.0 * t) +
                                              0.3 * std::sin(2.0 * kPi * 7013.0 * t)));
    return {v, v};
  }
};

/// An impulse at `at`, and silence elsewhere.
struct Impulse {
  int at;
  std::pair<float, float> operator()(int index) const {
    const float v = index == at ? 0.5f : 0.0f;
    return {v, v};
  }
};

}  // namespace

MW_TEST("D4: bypassed, the unit is a wire, and still meters") {
  /*
   * The ledger's threshold is −120 dBFS. Bypass here is not a crossfade to a
   * parallel path — the wet bus is not summed — and the buffer keeps running
   * so unbypassing does not start from silence. The row also asserts the
   * meters moved: X24 found four units publishing zeros while bypassed, and a
   * bypass that nulled by going silent would pass a version of this that only
   * measured the residual.
   */
  GranularDelay unit;
  configure(unit);
  unit.setFeedback(0.6);
  unit.setBypass(true);
  unit.reset();
  const Programme source;
  const Rendered out = render(unit, 96000, source);
  double worst = 0.0;
  double peak = 0.0;
  for (std::size_t i = 0; i < out.left.size(); ++i) {
    const double dry = static_cast<double>(source(static_cast<int>(i)).first);
    peak = std::max(peak, std::fabs(dry));
    worst = std::max(worst, std::fabs(static_cast<double>(out.left[i]) - dry));
    worst = std::max(worst, std::fabs(static_cast<double>(out.right[i]) - dry));
  }
  const GranularDelayFrame frame = unit.frame();
  std::printf("    D4: bypassed residual %.1f dBFS against a %.3f peak; input meter %.3f\n",
              dbOf(worst), peak, static_cast<double>(frame.inputPeak));
  MW_EXPECT(dbOf(worst) <= -120.0);
  MW_EXPECT(peak > 0.1);
  MW_EXPECT(frame.inputPeak > 0.1f);
}

MW_TEST("D6: every supported rate, and a tap is in seconds at each") {
  /*
   * 250 ms is 11 025 samples at 44.1 kHz and 48 000 at 192 kHz, and the row
   * asks for exactly that at each: an impulse in, the wet peak out at the
   * sample the time names. Rounded to the nearest sample — the unit rounds its
   * own delay for the reason `rebuild` gives, that 0.010 × 48 000 is
   * 479.99998 in floating point.
   */
  const double rates[5] = {44100.0, 48000.0, 88200.0, 96000.0, 192000.0};
  for (double rate : rates) {
    GranularDelay unit;
    configure(unit, rate);
    const int frames = static_cast<int>(rate * 0.5);
    const Rendered out = render(unit, frames, Impulse{0}, rate);
    const int arrived = peakIndex(out.left, 100);
    const int expected = static_cast<int>(std::floor(0.250 * rate + 0.5));
    std::printf("    D6: %8.1f Hz — the tap arrives at sample %d, expected %d\n", rate, arrived,
                expected);
    MW_EXPECT_EQ(arrived, expected);
  }
}

MW_TEST("D8: the declared latency is zero, and zero is what the dry path delays by") {
  /*
   * Half wet. The dry half of an impulse at sample zero has to be at sample
   * zero of the output — the dry path is not the buffer — and the wet half at
   * the tap. A unit that delayed its dry path by a block would put the two out
   * of time with every other track in the session, and its declared latency
   * would be a lie the host compensates for in the wrong direction.
   */
  GranularDelay unit;
  configure(unit);
  unit.setMix(0.5);
  unit.reset();
  const Rendered out = render(unit, 24000, Impulse{0});
  std::printf("    D8: output at sample 0 is %.4f; wet peak at sample %d\n",
              static_cast<double>(out.left[0]), peakIndex(out.left, 100));
  MW_EXPECT_NEAR(static_cast<double>(out.left[0]), 0.25, 1.0e-6);
  MW_EXPECT_EQ(peakIndex(out.left, 100), 12000);
}

MW_TEST("D9: no combination of parameters produces a non-finite sample") {
  /*
   * Every control driven to random points of its own declared range, in
   * combination — a hundred and thirty-nine of them, eight taps' worth. The
   * generated table is what makes this exhaustive rather than a list somebody
   * maintained: a control added to the manifest is fuzzed by this row without
   * anyone remembering to add it.
   */
  std::uint32_t state = 0xC0FFEEu;
  auto next = [&state]() {
    state = state * 1664525u + 1013904223u;
    return static_cast<double>(state >> 8) / 16777216.0;
  };
  long long checked = 0;
  for (int trial = 0; trial < 48; ++trial) {
    GranularDelay unit;
    unit.prepare(kRate, kBlock);
    for (int i = 0; i < kGranularDelayParamCount; ++i) {
      const GranularDelayParamRow& row = kGranularDelayParams[i];
      applyGranularDelayParam(unit, row.id, row.min + next() * (row.max - row.min));
    }
    unit.reset();
    const Rendered out = render(unit, 4000, Programme{});
    for (float v : out.left) {
      MW_EXPECT(std::isfinite(v));
      ++checked;
    }
    for (float v : out.right) MW_EXPECT(std::isfinite(v));
  }
  std::printf("    D9: 48 random settings of %d parameters, %lld samples all finite\n",
              kGranularDelayParamCount, checked);
  MW_EXPECT(checked > 0);
}

MW_TEST("D10: a parameter moved under automation does not step") {
  /*
   * The zipper cell, on the two gains a host is most likely to automate: Mix,
   * which scales the whole wet bus, and a tap's Level, which §7.2 gives a 4 ms
   * fade for exactly this reason. Each is compared against the same render
   * with the control held: a moving control changes the signal, and what it
   * may not do is change it faster than the signal itself moves.
   */
  auto worstStepOf = [](int id, double from, double to, bool automate, double held) {
    GranularDelay unit;
    configure(unit);
    unit.setFeedback(0.4);
    applyGranularDelayParam(unit, id, automate ? from : held);
    unit.reset();
    constexpr int kFrames = 48000;
    const Rendered out = renderWith(unit, kFrames, Programme{}, [&](int block) {
      if (!automate) return;
      const double through = static_cast<double>(block * kBlock) / kFrames;
      applyGranularDelayParam(unit, id, from + (to - from) * through);
    });
    double worst = 0.0;
    for (std::size_t i = 1; i < out.left.size(); ++i) {
      worst = std::max(worst, std::fabs(static_cast<double>(out.left[i]) - static_cast<double>(out.left[i - 1])));
    }
    return worst;
  };
  const int rows[2] = {static_cast<int>(GranularDelayParam::Mix),
                       static_cast<int>(GranularDelayParam::Tap1Level)};
  const double froms[2] = {0.0, -60.0};
  const double tos[2] = {100.0, 6.0};
  const char* names[2] = {"Mix", "Tap 1 level"};
  for (int r = 0; r < 2; ++r) {
    /*
     * The reference is the worst step at any *held* position along the travel,
     * not only at its end. Mix blends the dry signal with a wet one of the same
     * size, and halfway along the two are uncorrelated and their steps add —
     * a held render at 50 % steps twice as hard as one at 100 %, which the
     * first version of this row read as a zipper. What a moving control may
     * not do is step harder than the signal does at any position it passes
     * through.
     */
    double still = 0.0;
    for (int k = 0; k <= 4; ++k) {
      const double held = froms[r] + (tos[r] - froms[r]) * (k / 4.0);
      still = std::max(still, worstStepOf(rows[r], froms[r], tos[r], false, held));
    }
    const double moving = worstStepOf(rows[r], froms[r], tos[r], true, tos[r]);
    std::printf("    D10: %-12s worst step %.5f held anywhere along the travel, %.5f under"
                " automation\n",
                names[r], still, moving);
    MW_EXPECT(moving <= still * 1.25 + 1.0e-4);
    MW_EXPECT(still > 1.0e-4);
  }
}

MW_TEST("D12: a synced tap is a musical value, and follows the tempo in every mode") {
  /*
   * A quarter is 500 ms at 120 bpm and 666.7 ms at 90, and the row measures
   * the delay itself, by where an impulse arrives, at both tempos — a control
   * that resolved once and cached would give the same answer twice. Then the
   * change is made *while running*, once per time-change mode, because the
   * three modes get there differently and each has to get there: Instant at
   * once, Digital after its fade, Tape after its slew, with the bend on the
   * way that the frame publishes.
   */
  auto synced = [](delay::TimeChangeMode mode, double firstBpm, double secondBpm, int changeAt,
                   int impulseAt, double* bend) {
    GranularDelay unit;
    configure(unit);
    unit.setSync(true);
    unit.setBpm(firstBpm);
    unit.setTimeChangeMode(mode);
    TapSettings tap = unit.tap(0);
    tap.division = delay::Division::Quarter;
    unit.setTap(0, tap);
    unit.reset();
    double worstBend = 0.0;
    const Rendered out = renderWith(unit, impulseAt + 48000, Impulse{impulseAt}, [&](int block) {
      if (block * kBlock == changeAt) unit.setBpm(secondBpm);
      if (block > 0) worstBend = std::max(worstBend, std::fabs(static_cast<double>(unit.frame().pitchRatio) - 1.0));
    });
    if (bend != nullptr) *bend = worstBend;
    return peakIndex(out.left, static_cast<std::size_t>(impulseAt) + 100) - impulseAt;
  };
  double bend = 0.0;
  const int at120 = synced(delay::TimeChangeMode::Instant, 120.0, 120.0, -1, 0, nullptr);
  const int at90 = synced(delay::TimeChangeMode::Instant, 90.0, 90.0, -1, 0, nullptr);
  std::printf("    D12: a quarter arrives %d samples later at 120 bpm and %d at 90\n", at120, at90);
  MW_EXPECT_EQ(at120, 24000);
  MW_EXPECT_EQ(at90, 32000);

  // Running, 120 → 90 at half a second; the impulse a moment or three seconds later.
  const int instant = synced(delay::TimeChangeMode::Instant, 120.0, 90.0, 24064, 24064 + kBlock, nullptr);
  const int digital = synced(delay::TimeChangeMode::Digital, 120.0, 90.0, 24064, 24064 + 2400, nullptr);
  const int tape = synced(delay::TimeChangeMode::Tape, 120.0, 90.0, 24064, 24064 + 3 * 48000, &bend);
  std::printf("    D12: after the change — Instant %d, Digital %d, Tape %d samples; the tape bent"
              " by %.4f on the way\n",
              instant, digital, tape, bend);
  MW_EXPECT_EQ(instant, 32000);
  MW_EXPECT_EQ(digital, 32000);
  MW_EXPECT_NEAR(static_cast<double>(tape), 32000.0, 0.005 * 32000.0);
  MW_EXPECT(bend > 0.01);

  // Sync off: the tempo is not a control, and changing it moves nothing.
  GranularDelay unit;
  configure(unit);
  unit.setBpm(120.0);
  unit.reset();
  const Rendered out = renderWith(unit, 60000, Impulse{12032}, [&](int block) {
    if (block * kBlock == 6144) unit.setBpm(60.0);
  });
  const int free = peakIndex(out.left, 12132) - 12032;
  std::printf("    D12: with sync off, the tap stays at %d samples through a tempo change\n", free);
  MW_EXPECT_EQ(free, 12000);
}

MW_TEST("V15: cost is linear in taps times grains, so nothing else is on the audio thread") {
  /*
   * §9 V15: per-block cost against `T × G` at 4, 8, 16, 32, 64 and 128, fit to
   * a line, R² at least 0.98. The allocation half of that question is settled
   * by V16's hook far better than a clock could settle it; what is left is
   * whether cost grows the way work does, or faster because a working set
   * stopped fitting in cache. Each point is the median of repeated renders,
   * because one descheduled render moves a mean and not a median, and the
   * residuals are printed so a marginal fit can be read as curvature or as one
   * noisy point.
   *
   * `G` comes from Smear: §4's table gives four grains per tap at 30 % and
   * sixteen at 75 %, so one to eight taps at 30 % and four or eight at 75 %
   * are the six products.
   */
  const int taps[6] = {1, 2, 4, 8, 4, 8};
  const double smears[6] = {0.30, 0.30, 0.30, 0.30, 0.75, 0.75};
  double product[6];
  double cost[6];
  constexpr int kRepeats = 5;
  for (int p = 0; p < 6; ++p) {
    std::vector<double> runs;
    for (int r = 0; r < kRepeats; ++r) {
      GranularDelay unit;
      configure(unit);
      unit.setTapCount(taps[p]);
      for (int t = 0; t < taps[p]; ++t) {
        TapSettings tap;
        tap.delaySeconds = 0.100 + 0.070 * t;
        unit.setTap(t, tap);
      }
      unit.setSmear(smears[p]);
      unit.setFeedback(0.5);
      unit.reset();
      std::uint32_t state = 0x2BADCAFEu;
      auto noise = [&state](int) {
        state = state * 1664525u + 1013904223u;
        const float v = (static_cast<float>(state >> 8) / 8388608.0f - 1.0f) * 0.3f;
        return std::pair<float, float>{v, v};
      };
      render(unit, 24000, noise);  // warm the buffer and the caches
      const std::clock_t started = std::clock();
      render(unit, 96000, noise);
      runs.push_back(static_cast<double>(std::clock() - started) / CLOCKS_PER_SEC);
    }
    std::sort(runs.begin(), runs.end());
    cost[p] = runs[runs.size() / 2];
    product[p] = static_cast<double>(taps[p] * delay::smearAt(smears[p]).grainsPerTap);
  }
  const LinearFit fit = fitLine(product, cost, 6);
  std::printf("    V15:");
  for (int p = 0; p < 6; ++p) {
    const double predicted = fit.intercept + fit.slope * product[p];
    std::printf(" | T×G=%.0f %.3f s (%+.1f %%)", product[p], cost[p],
                100.0 * (cost[p] - predicted) / predicted);
  }
  std::printf("\n    V15: fit a=%.6f s per grain-tap, b=%.4f s, R^2 = %.4f\n", fit.slope, fit.intercept,
              fit.rSquared);
  MW_EXPECT(fit.rSquared >= 0.98);
  MW_EXPECT(fit.slope > 0.0);
}

MW_TEST_MAIN("granular-delay-cells")
