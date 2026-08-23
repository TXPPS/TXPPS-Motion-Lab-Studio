// Motion Wave — the Variable-Mu Limiter's time constants. `dyn-04` §9 rows 1
// to 5 and 8.
//
// Positions 5 and 6 are the reason this suite is long. They are not an auto
// release: §4 describes more than one storage element on the control path, and
// the recovery a listener hears is wherever the charge happens to be. Row 5
// exists to reject the shortcut — sweep the repetition rate continuously and
// assert there is no step anywhere in the curve, which a model that *detects*
// multiple peaks and switches cannot pass however well it is tuned.
//
// Run with the oversampler off. These rows measure when the gain moves, not
// what it sounds like, and the wrapper's filters only add latency to that.
#include "../units/variable_mu.h"
#include "harness.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kRate = 48000.0;
constexpr int kBlock = 64;

class Driver {
 public:
  Driver(VariableMu& unit, double rate) : unit_(unit), rate_(rate) {}

  /// Advance `frames` of a 1 kHz sine at `amplitude` and return the reduction
  /// at the end. Amplitude zero is silence, which is how recoveries are timed.
  double run(double amplitude, int frames) {
    const double step = 2.0 * kPi * 1000.0 / rate_;
    for (int at = 0; at < frames; at += kBlock) {
      const int n = frames - at < kBlock ? frames - at : kBlock;
      for (int i = 0; i < n; ++i) {
        const double s = amplitude * std::sin(step * static_cast<double>(phase_ + i));
        left_[static_cast<std::size_t>(i)] = static_cast<float>(s);
        right_[static_cast<std::size_t>(i)] = static_cast<float>(s);
      }
      phase_ += n;
      float* channels[2] = {left_.data(), right_.data()};
      float* outChannels[2] = {outLeft_.data(), outRight_.data()};
      AudioBuffer in(channels, 2, n);
      AudioBuffer out(outChannels, 2, n);
      ProcessContext ctx;
      ctx.inputs = &in;
      ctx.inputCount = 1;
      ctx.outputs = &out;
      ctx.outputCount = 1;
      ctx.frames = n;
      ctx.sampleRate = rate_;
      ctx.playing = true;
      unit_.process(ctx);
    }
    return unit_.gainReductionDb(0);
  }

  /**
   * A rectified level rather than a tone, for the attack rows.
   *
   * The sidechain rectifies, so with a 1 kHz sine it is handed a new peak every
   * half period — 0.5 ms — while the attacks being measured are 0.2 and 0.4 ms.
   * The rise then quantises to the peak spacing: measured that way positions 1
   * and 2 read 0.188 ms and positions 3 and 4 read 0.625 ms, a ratio of 3.33
   * between two settings that differ by exactly two. §9 test 1 specifies a
   * 1 kHz sine and cannot measure the number it asks for, which is the same
   * conflict `dyn-03` §9 test 1 has and is resolved the same way.
   *
   * A constant is safe here even though the input transformer is a flux
   * integrator: its output filter is the exact inverse of that integrator, so
   * the linear path passes a step as a step and only the shaping is
   * frequency-dependent.
   */
  double level(double amplitude, int frames) {
    for (int at = 0; at < frames; at += kBlock) {
      const int n = frames - at < kBlock ? frames - at : kBlock;
      for (int i = 0; i < n; ++i) {
        left_[static_cast<std::size_t>(i)] = static_cast<float>(amplitude);
        right_[static_cast<std::size_t>(i)] = static_cast<float>(amplitude);
      }
      float* channels[2] = {left_.data(), right_.data()};
      float* outChannels[2] = {outLeft_.data(), outRight_.data()};
      AudioBuffer in(channels, 2, n);
      AudioBuffer out(outChannels, 2, n);
      ProcessContext ctx;
      ctx.inputs = &in;
      ctx.inputCount = 1;
      ctx.outputs = &out;
      ctx.outputCount = 1;
      ctx.frames = n;
      ctx.sampleRate = rate_;
      ctx.playing = true;
      unit_.process(ctx);
    }
    return unit_.gainReductionDb(0);
  }

  /// Seconds until the reduction falls to `remainingDb`, with the input gone.
  double recoverySeconds(double remainingDb, double limitSeconds) {
    const int step = static_cast<int>(kRate * 0.002);
    const int limit = static_cast<int>(kRate * limitSeconds);
    for (int at = 0; at < limit; at += step) {
      if (run(0.0, step) <= remainingDb) {
        return static_cast<double>(at + step) / kRate;
      }
    }
    return -1.0;
  }

 private:
  VariableMu& unit_;
  double rate_;
  long long phase_ = 0;
  std::vector<float> left_ = std::vector<float>(kBlock, 0.0f);
  std::vector<float> right_ = std::vector<float>(kBlock, 0.0f);
  std::vector<float> outLeft_ = std::vector<float>(kBlock, 0.0f);
  std::vector<float> outRight_ = std::vector<float>(kBlock, 0.0f);
};

void configure(VariableMu& unit, int position, double threshold = 3.0) {
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  unit.setTier(VariableMu::Tier::Off);
  for (int c = 0; c < kVariableMuChannels; ++c) {
    unit.setTimeConstant(c, position);
    unit.setThreshold(c, threshold);
    unit.setDcThreshold(c, 0.5);
  }
  unit.reset();
}

/// The amplitude that settles at `targetDb` of reduction in this position.
double driveFor(int position, double targetDb, double threshold = 3.0) {
  double lo = 1.0e-3;
  double hi = 1.0;
  for (int i = 0; i < 16; ++i) {
    const double mid = std::sqrt(lo * hi);
    VariableMu unit;
    configure(unit, position, threshold);
    Driver driver(unit, kRate);
    if (driver.run(mid, static_cast<int>(kRate * 0.3)) < targetDb) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return std::sqrt(lo * hi);
}

/// The same, for the rectified probe the attack rows use.
double driveForLevel(int position, double targetDb) {
  double lo = 1.0e-3;
  double hi = 1.0;
  for (int i = 0; i < 16; ++i) {
    const double mid = std::sqrt(lo * hi);
    VariableMu unit;
    configure(unit, position);
    Driver driver(unit, kRate);
    if (driver.level(mid, static_cast<int>(kRate * 0.3)) < targetDb) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return std::sqrt(lo * hi);
}

/// Recovery after `count` bursts of 50 ms spaced `gapSeconds` apart.
double recoveryAfterBursts(int position, int count, double gapSeconds, double drive,
                           double limitSeconds) {
  VariableMu unit;
  configure(unit, position);
  Driver driver(unit, kRate);
  const int burst = static_cast<int>(kRate * 0.05);
  const int gap = static_cast<int>(kRate * gapSeconds) - burst;
  for (int i = 0; i < count; ++i) {
    driver.run(drive, burst);
    if (i + 1 < count && gap > 0) driver.run(0.0, gap);
  }
  return driver.recoverySeconds(1.0, limitSeconds);
}

}  // namespace

MW_TEST("dyn-04 test 1: the four fixed positions' attack and release") {
  // §4's table. Attack is a 10-90 % span and release is the recovery to 1 dB
  // remaining from 10 dB, which is a factor of ten.
  const double attackMs[4] = {0.2, 0.2, 0.4, 0.4};
  const double releaseS[4] = {0.3, 0.8, 2.0, 5.0};
  for (int p = 1; p <= 4; ++p) {
    const double drive = driveForLevel(p, 10.0);
    VariableMu unit;
    configure(unit, p);
    Driver driver(unit, kRate);
    const double settled = driver.level(drive, static_cast<int>(kRate * 0.4));

    VariableMu again;
    configure(again, p);
    Driver second(again, kRate);
    int at10 = -1;
    int at90 = -1;
    for (int i = 0; i < static_cast<int>(kRate * 0.01); ++i) {
      const double reduction = second.level(drive, 1);
      if (at10 < 0 && reduction >= settled * 0.1) at10 = i;
      if (at10 >= 0 && reduction >= settled * 0.9) {
        at90 = i;
        break;
      }
    }
    const double ms = static_cast<double>(at90 - at10) * 1000.0 / kRate;
    const double recovery = driver.recoverySeconds(1.0, releaseS[p - 1] * 3.0);
    std::printf("    test 1 position %d: %.2f dB, attack %.3f ms (target %.1f),"
                " recovery %.3f s (target %.1f)\n",
                p, settled, ms, attackMs[p - 1], recovery, releaseS[p - 1]);
    MW_EXPECT(at10 >= 0 && at90 > at10);
    // ±30 % on attack, which is what §9 test 1 allows because the published
    // figures are coarse; ±20 % on release.
    MW_EXPECT(ms >= attackMs[p - 1] * 0.7 && ms <= attackMs[p - 1] * 1.3);
    MW_EXPECT(recovery > 0.0);
    MW_EXPECT(recovery >= releaseS[p - 1] * 0.8 && recovery <= releaseS[p - 1] * 1.2);
  }
}

MW_TEST("dyn-04 tests 2 and 3: position 5 recovers by how much it has been asked") {
  const double drive = driveFor(5, 10.0);
  const double single = recoveryAfterBursts(5, 1, 0.5, drive, 8.0);
  const double repeated = recoveryAfterBursts(5, 10, 0.5, drive, 30.0);
  std::printf("    tests 2/3: one burst recovers in %.2f s (target 2), ten in %.2f s"
              " (target 10) — %.2fx\n",
              single, repeated, single > 0.0 ? repeated / single : 0.0);
  MW_EXPECT(single > 0.0 && repeated > 0.0);
  // ±40 % relative, as the row allows.
  MW_EXPECT(single >= 1.2 && single <= 2.8);
  MW_EXPECT(repeated >= 6.0 && repeated <= 14.0);
  MW_EXPECT_AT_LEAST_TIMES(repeated, single, 3.0, 0.01);
}

MW_TEST("dyn-04 test 4: position 6 has three regimes and they are ordered") {
  const double drive = driveFor(6, 10.0);
  const double single = recoveryAfterBursts(6, 1, 0.5, drive, 5.0);
  const double repeated = recoveryAfterBursts(6, 10, 0.5, drive, 30.0);

  VariableMu unit;
  configure(unit, 6);
  Driver driver(unit, kRate);
  driver.run(drive, static_cast<int>(kRate * 60.0));
  const double sustained = driver.recoverySeconds(1.0, 60.0);

  std::printf("    test 4: single %.2f s (target 0.3), repeated %.2f s (target 10),"
              " sustained %.2f s (target 25)\n",
              single, repeated, sustained);
  MW_EXPECT(single > 0.0 && repeated > 0.0 && sustained > 0.0);
  MW_EXPECT(single >= 0.18 && single <= 0.42);
  MW_EXPECT(repeated >= 6.0 && repeated <= 14.0);
  MW_EXPECT(sustained >= 15.0 && sustained <= 35.0);
  // Strictly increasing, which is the half a single-branch model fails.
  MW_EXPECT(repeated > single);
  MW_EXPECT(sustained > repeated);
}

MW_TEST("dyn-04 test 5: the recovery bends, it does not step") {
  // Sweeping the repetition rate rather than the burst count, because the row
  // is about there being no threshold at which "multiple peaks" begins.
  const double drive = driveFor(5, 10.0);
  const double rates[6] = {0.2, 0.5, 1.0, 2.0, 3.5, 5.0};
  double recovery[6] = {0, 0, 0, 0, 0, 0};
  for (int i = 0; i < 6; ++i) {
    // Four seconds of bursts at each rate, so the storage sees the same span of
    // time and only the density changes.
    const int count = static_cast<int>(4.0 * rates[i] + 0.5);
    recovery[i] = recoveryAfterBursts(5, count < 1 ? 1 : count, 1.0 / rates[i], drive, 30.0);
    std::printf("    test 5: %.1f bursts/s -> recovery %.2f s\n", rates[i], recovery[i]);
  }
  double worstStep = 0.0;
  for (int i = 1; i < 6; ++i) {
    MW_EXPECT(recovery[i] > 0.0);
    // Monotonic: denser material must never recover faster.
    MW_EXPECT(recovery[i] >= recovery[i - 1] - 0.05);
    const double step = recovery[i] - recovery[i - 1];
    if (step > worstStep) worstStep = step;
  }
  const double span = recovery[5] - recovery[0];
  std::printf("    test 5: span %.2f s, largest single step %.2f s (%.0f %% of the span)\n", span,
              worstStep, span > 0.0 ? 100.0 * worstStep / span : 0.0);
  // A switch puts the whole span into one step. A network puts it across all of
  // them, so no single step may carry most of the travel.
  MW_EXPECT(span > 1.0);
  MW_EXPECT(worstStep <= span * 0.7);
}

MW_TEST("dyn-04 test 8: the threshold's sense, which is backwards from a plug-in's") {
  // **Calibrated at the *higher* threshold setting, which is the whole probe.**
  // Bisecting the drive at a low setting and then reading both puts the higher
  // one below its threshold entirely, and the row then compares 13.76 dB
  // against exactly 0.00 — which the harness refuses, correctly. Two settings
  // that both compress is what makes the comparison say something about the
  // control's direction rather than about whether the signal happened to reach
  // one threshold at all.
  const double drive = driveFor(4, 4.0, 8.0);
  double reduction[2] = {0, 0};
  const double positions[2] = {8.0, 2.0};
  for (int i = 0; i < 2; ++i) {
    VariableMu unit;
    configure(unit, 4, positions[i]);
    Driver driver(unit, kRate);
    reduction[i] = driver.run(drive, static_cast<int>(kRate * 0.5));
  }
  std::printf("    test 8: THRESHOLD 8 reduces %.2f dB, THRESHOLD 2 reduces %.2f dB\n",
              reduction[0], reduction[1]);
  // *Decreasing* the control increases the reduction. A model with conventional
  // sense has inverted the panel.
  MW_EXPECT_EXCEEDS_BY(reduction[1], reduction[0], 3.0, 0.5);
}

MW_TEST_MAIN("variable-mu")
