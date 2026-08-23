// Motion Wave — FET Limiter, the transfer curve. `dyn-03` §9 rows 2, 4, 6, 7
// and 13.
//
// Every row here is a *settled* measurement, so every stimulus is ramped in and
// read from the held region. An abruptly started tone is a step as well as a
// tone, and this unit's detector is fast enough to catch the step — what comes
// back is the transient wearing a ratio's clothes.
//
// The timing row is the exception and uses a rectified level, because a peak
// detector cannot be measured faster than its probe delivers peaks.
#include "../units/fet_limiter.h"
#include "harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kRate = 96000.0;

/// Drives a unit one sample at a time. Shared shape with the dynamics suite;
/// kept separate because the two files measure different things and a common
/// driver would grow options for both.
class Driver {
 public:
  Driver(FetLimiter& unit, double rate) : unit_(unit), rate_(rate) {}

  double push(double sample) {
    left_[0] = static_cast<float>(sample);
    right_[0] = left_[0];
    float* channels[2] = {left_.data(), right_.data()};
    float* outChannels[2] = {outLeft_.data(), outRight_.data()};
    AudioBuffer in(channels, 2, 1);
    AudioBuffer out(outChannels, 2, 1);
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &out;
    ctx.outputCount = 1;
    ctx.frames = 1;
    ctx.sampleRate = rate_;
    ctx.playing = true;
    unit_.process(ctx);
    last_ = static_cast<double>(outLeft_[0]);
    return unit_.gainReductionDb();
  }

  /**
   * A tone raised over `ramp` samples and then held, returning the settled
   * output level as rms over the held region.
   *
   * Rms rather than peak, and rather than the fundamental. All three were
   * tried and the middle one is the trap: a transfer curve is a statement about
   * *level*, and at twenty decibels above threshold a large part of this unit's
   * output is its own harmonics. Read from the fundamental the four buttons
   * measured 9.8:1, −4.5:1, −1.3:1 and 0.2:1 — three of them expanding, which
   * the unit does not do; the energy had simply moved out of the bin being
   * counted. Peak has the opposite bias, reading the distortion as though it
   * were signal. Rms counts what is there.
   */
  double settledRms(double amplitude, double hz, int ramp, int hold) {
    for (int i = 0; i < ramp; ++i) {
      const double t = static_cast<double>(phase_ + i) / rate_;
      const double shape = 0.5 - 0.5 * std::cos(kPi * static_cast<double>(i) / ramp);
      push(amplitude * shape * std::sin(2.0 * kPi * hz * t));
    }
    phase_ += ramp;
    const int measureFrom = hold / 2;
    double sum = 0.0;
    int counted = 0;
    for (int i = 0; i < hold; ++i) {
      const double t = static_cast<double>(phase_ + i) / rate_;
      push(amplitude * std::sin(2.0 * kPi * hz * t));
      if (i >= measureFrom) {
        sum += last_ * last_;
        ++counted;
      }
    }
    phase_ += hold;
    return counted > 0 ? std::sqrt(sum / static_cast<double>(counted)) : 0.0;
  }

  double level(double amplitude, int frames) {
    double reduction = 0.0;
    for (int i = 0; i < frames; ++i) reduction = push(amplitude);
    phase_ += frames;
    return reduction;
  }

  double silence(int frames) {
    double reduction = 0.0;
    for (int i = 0; i < frames; ++i) reduction = push(0.0);
    phase_ += frames;
    return reduction;
  }

  double reduction() const { return unit_.gainReductionDb(); }

 private:
  FetLimiter& unit_;
  double rate_;
  std::vector<float> left_{1, 0.0f};
  std::vector<float> right_{1, 0.0f};
  std::vector<float> outLeft_{1, 0.0f};
  std::vector<float> outRight_{1, 0.0f};
  long phase_ = 0;
  double last_ = 0.0;
};

void configure(FetLimiter& unit, FetRatio ratio, double attack, double release) {
  unit.prepare(kRate, 256);
  unit.setNoise(0.0);
  unit.setRatio(ratio);
  unit.setAttack(attack);
  unit.setRelease(release);
  unit.setLimiting(true);
  unit.setTier(FetLimiter::Tier::X4);
  unit.reset();
}

double db(double v) { return 20.0 * std::log10(v > 1.0e-15 ? v : 1.0e-15); }

/// The settled output level, in dBFS, for an input level in dBFS.
double transferAt(FetRatio ratio, double inDb) {
  FetLimiter unit;
  configure(unit, ratio, 4.0, 4.0);
  Driver driver(unit, kRate);
  const double amplitude = std::pow(10.0, inDb / 20.0);
  return db(driver.settledRms(amplitude, 1000.0, static_cast<int>(kRate * 0.05),
                               static_cast<int>(kRate * 0.30)));
}

/**
 * The input level at which the unit first does anything, in dBFS.
 *
 * Found rather than read from the unit, because the threshold is a private
 * consequence of the ratio network and a test that asked the unit where its
 * threshold was would be asking the thing under test to grade itself.
 */
double thresholdOf(FetRatio ratio) {
  double lo = -70.0;
  double hi = 0.0;
  for (int i = 0; i < 22; ++i) {
    const double mid = 0.5 * (lo + hi);
    FetLimiter unit;
    configure(unit, ratio, 4.0, 4.0);
    Driver driver(unit, kRate);
    driver.settledRms(std::pow(10.0, mid / 20.0), 1000.0, static_cast<int>(kRate * 0.05),
                       static_cast<int>(kRate * 0.40));
    if (driver.reduction() < 0.5) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return 0.5 * (lo + hi);
}

/// Local slope of the transfer curve, as a compression ratio, at `overDb` above
/// that ratio's threshold.
double slopeAt(FetRatio ratio, double thresholdDb, double overDb) {
  const double centre = thresholdDb + overDb;
  const double lowIn = centre - 1.5;
  const double highIn = centre + 1.5;
  const double lowOut = transferAt(ratio, lowIn);
  const double highOut = transferAt(ratio, highIn);
  return (highIn - lowIn) / (highOut - lowOut);
}

}  // namespace

MW_TEST("dyn-03 test 2: the release endpoints") {
  // After 500 ms at 10 dB, remove the signal and time the recovery to 1 dB
  // remaining. A rectified level rather than a tone, for the same reason the
  // attack row uses one: a peak detector's own constant cannot be measured
  // through a probe whose peaks arrive more slowly than it moves.
  for (int fast = 0; fast < 2; ++fast) {
    const double position = fast == 1 ? 7.0 : 1.0;
    const double target = fast == 1 ? 50.0 : 1100.0;
    FetLimiter unit;
    configure(unit, FetRatio::R20, 4.0, position);
    Driver driver(unit, kRate);
    // A level that settles near 10 dB of reduction, found by search so the row
    // does not depend on a threshold constant it would have to restate.
    const double threshold = thresholdOf(FetRatio::R20);
    driver.level(std::pow(10.0, (threshold + 14.0) / 20.0), static_cast<int>(kRate * 0.5));
    const double start = driver.reduction();

    int recovered = -1;
    const int frames = static_cast<int>(kRate * 3.0);
    for (int i = 0; i < frames; ++i) {
      if (driver.silence(1) <= 1.0) {
        recovered = i;
        break;
      }
    }
    const double ms = static_cast<double>(recovered) * 1000.0 / kRate;
    std::printf("    test 2 position %.0f: %.2f dB recovers to 1 dB in %.1f ms (target %.0f)\n",
                position, start, ms, target);
    MW_EXPECT(recovered > 0);
    MW_EXPECT(start > 5.0);
    MW_EXPECT(ms >= target * 0.75 && ms <= target * 1.25);
  }
}

MW_TEST("dyn-03 test 4: each button's slope, 20 dB above its own threshold") {
  const FetRatio ratios[4] = {FetRatio::R4, FetRatio::R8, FetRatio::R12, FetRatio::R20};
  const double targets[4] = {4.0, 8.0, 12.0, 20.0};
  for (int i = 0; i < 4; ++i) {
    const double threshold = thresholdOf(ratios[i]);
    const double slope = slopeAt(ratios[i], threshold, 20.0);
    std::printf("    test 4 %5.1f:1 — threshold %.2f dBFS, measured %.2f:1\n", targets[i],
                threshold, slope);
    // ±20 % relative, as the row states.
    MW_EXPECT(slope >= targets[i] * 0.80 && slope <= targets[i] * 1.20);
  }
}

MW_TEST("dyn-03 test 6: the knee narrows as the ratio rises") {
  // The input range over which the local slope travels from 1.5:1 to nine
  // tenths of the nominal ratio. No absolute target exists — the row says to
  // record it for regression — but the *relationship* is asserted: the 4:1
  // knee must be at least half again as wide as the 20:1 knee.
  auto kneeWidth = [](FetRatio ratio, double nominal) {
    const double threshold = thresholdOf(ratio);
    double lower = 0.0;
    double upper = 0.0;
    for (double over = 0.5; over <= 30.0; over += 0.5) {
      const double slope = slopeAt(ratio, threshold, over);
      if (lower == 0.0 && slope >= 1.5) lower = over;
      if (lower != 0.0 && slope >= nominal * 0.9) {
        upper = over;
        break;
      }
    }
    return upper > lower ? upper - lower : 0.0;
  };
  const double wide = kneeWidth(FetRatio::R4, 4.0);
  const double narrow = kneeWidth(FetRatio::R20, 20.0);
  std::printf("    test 6: 4:1 knee spans %.1f dB, 20:1 knee spans %.1f dB\n", wide, narrow);
  MW_EXPECT_AT_LEAST_TIMES(wide, narrow, 1.5, 0.25);
}

MW_TEST("dyn-03 test 7: the four-button state's ratio is not a constant") {
  const double threshold = thresholdOf(FetRatio::AllIn);
  const double atTwenty = slopeAt(FetRatio::AllIn, threshold, 20.0);
  const double atTen = slopeAt(FetRatio::AllIn, threshold, 10.0);
  const double atTwentyFive = slopeAt(FetRatio::AllIn, threshold, 25.0);
  const double spread = std::fabs(atTwentyFive - atTen) / atTen;
  std::printf("    test 7: slope %.2f:1 at 20 dB over; %.2f:1 at 10 dB and %.2f:1 at 25 dB"
              " — %.1f %% apart\n",
              atTwenty, atTen, atTwentyFive, spread * 100.0);
  MW_EXPECT(atTwenty >= 10.0 && atTwenty <= 25.0);
  // Not straight. A constant ratio here would mean the four buttons had become
  // a fifth ratio setting rather than a different device.
  MW_EXPECT(spread >= 0.20);
}

MW_TEST("dyn-03 test 13: the make-up gain is outside the loop") {
  const double threshold = thresholdOf(FetRatio::R8);
  double lowest = 100.0;
  double highest = -100.0;
  for (double gainDb : {-12.0, 0.0, 12.0, 24.0}) {
    FetLimiter unit;
    configure(unit, FetRatio::R8, 4.0, 4.0);
    unit.setOutputGain(std::pow(10.0, gainDb / 20.0));
    Driver driver(unit, kRate);
    driver.settledRms(std::pow(10.0, (threshold + 14.0) / 20.0), 1000.0,
                       static_cast<int>(kRate * 0.05), static_cast<int>(kRate * 0.60));
    lowest = std::min(lowest, driver.reduction());
    highest = std::max(highest, driver.reduction());
  }
  std::printf("    test 13: reduction across 36 dB of make-up spans %.4f dB\n", highest - lowest);
  MW_EXPECT(lowest > 1.0);
  MW_EXPECT(highest - lowest < 0.5);
}

MW_TEST_MAIN("fet-limiter-curve")
