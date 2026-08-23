// Motion Wave — Optical Leveller, against `dyn-02` §9.
//
// The dynamics half: the static curve, the two release branches, and the memory
// that makes the second of them not a number. The response and distortion half
// is in `optical_leveller_amp_tests.cpp`.
//
// What most of these rows are really checking is that the unit has no
// threshold. §5 is explicit — the local ratio is a continuous function of level
// and of how long that level has been present, and an implementation that
// computes `if (level > threshold)` has already diverged. So test 1 looks for a
// corner and fails if it finds one, rather than checking a knee against a
// number.
#include "../units/optical_leveller.h"
#include "harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <utility>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kRate = 48000.0;
constexpr int kBlock = 512;

/// +10 dBm through the library's full-scale reference.
const double kPlusTenDbm = static_cast<double>(dsp::nl::dbuToLinear(10.0));

/// Drive a unit with a steady sine for `seconds` and return the settled output
/// peak over the final tenth of that time.
double runTone(OpticalLeveller& unit, double amplitude, double hz, double seconds) {
  const int frames = static_cast<int>(kRate * seconds);
  std::vector<float> left(kBlock, 0.0f);
  std::vector<float> right(kBlock, 0.0f);
  float* channels[2] = {left.data(), right.data()};
  std::vector<float> outLeft(kBlock, 0.0f);
  std::vector<float> outRight(kBlock, 0.0f);
  float* outChannels[2] = {outLeft.data(), outRight.data()};
  const int measureFrom = frames - frames / 10;
  double peak = 0.0;
  for (int at = 0; at < frames; at += kBlock) {
    const int count = std::min(kBlock, frames - at);
    for (int i = 0; i < count; ++i) {
      const double t = static_cast<double>(at + i) / kRate;
      left[static_cast<std::size_t>(i)] = static_cast<float>(amplitude * std::sin(2.0 * kPi * hz * t));
      right[static_cast<std::size_t>(i)] = left[static_cast<std::size_t>(i)];
    }
    AudioBuffer in(channels, 2, count);
    AudioBuffer out(outChannels, 2, count);
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &out;
    ctx.outputCount = 1;
    ctx.frames = count;
    ctx.sampleRate = kRate;
    ctx.playing = true;
    unit.process(ctx);
    if (at >= measureFrom) {
      for (int i = 0; i < count; ++i) {
        peak = std::max(peak, std::fabs(static_cast<double>(outLeft[static_cast<std::size_t>(i)])));
      }
    }
  }
  return peak;
}

/// Push `seconds` of silence through, sampling the gain reduction each block.
/// `onSample` sees (seconds since the signal stopped, reduction in dB).
template <typename Fn>
void runSilence(OpticalLeveller& unit, double seconds, Fn&& onSample) {
  const int frames = static_cast<int>(kRate * seconds);
  std::vector<float> left(kBlock, 0.0f);
  std::vector<float> right(kBlock, 0.0f);
  float* channels[2] = {left.data(), right.data()};
  std::vector<float> outLeft(kBlock, 0.0f);
  std::vector<float> outRight(kBlock, 0.0f);
  float* outChannels[2] = {outLeft.data(), outRight.data()};
  for (int at = 0; at < frames; at += kBlock) {
    const int count = std::min(kBlock, frames - at);
    for (int i = 0; i < count; ++i) {
      left[static_cast<std::size_t>(i)] = 0.0f;
      right[static_cast<std::size_t>(i)] = 0.0f;
    }
    AudioBuffer in(channels, 2, count);
    AudioBuffer out(outChannels, 2, count);
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &out;
    ctx.outputCount = 1;
    ctx.frames = count;
    ctx.sampleRate = kRate;
    ctx.playing = true;
    unit.process(ctx);
    onSample(static_cast<double>(at) / kRate, unit.gainReductionDb());
  }
}

/// A unit configured for a dynamics measurement: no oversampling, no noise.
/// Neither affects a time constant, and both cost time or add a floor.
void configure(OpticalLeveller& unit, double peakReduction, OpticalLeveller::Mode mode) {
  unit.prepare(kRate, kBlock);
  unit.setTier(OpticalLeveller::Tier::Off);
  unit.setNoise(0.0);
  unit.setPeakReduction(peakReduction);
  unit.setMode(mode);
  unit.reset();
}

/// The PEAK REDUCTION setting that settles at `targetDb` of reduction for a
/// steady tone at `amplitude`. Solved rather than tabulated: §3.1 says the
/// panel's 0–100 scale corresponds to no dB value, so there is no number to
/// look up and the mapping is what the loop makes it.
double settingFor(double targetDb, double amplitude, OpticalLeveller::Mode mode) {
  double lo = 0.0;
  double hi = 1.0;
  for (int step = 0; step < 22; ++step) {
    const double mid = 0.5 * (lo + hi);
    OpticalLeveller unit;
    configure(unit, mid, mode);
    runTone(unit, amplitude, 1000.0, 1.5);
    if (unit.gainReductionDb() < targetDb) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return 0.5 * (lo + hi);
}

double db(double v) { return 20.0 * std::log10(v > 1.0e-12 ? v : 1.0e-12); }

}  // namespace

MW_TEST("dyn-02 test 1: the transfer curve bends, and never corners") {
  // No threshold anywhere, so no knee to find. What is asserted is that the
  // slope is smooth — a detected corner is the failure — and that the local
  // slope at 10 dB of reduction is in the published band for each mode.
  for (int modeIndex = 0; modeIndex < 2; ++modeIndex) {
    const OpticalLeveller::Mode mode =
        modeIndex == 0 ? OpticalLeveller::Mode::Compress : OpticalLeveller::Mode::Limit;
    const double setting = settingFor(10.0, kPlusTenDbm, mode);
    double previousSlope = 0.0;
    double worstJump = 0.0;
    double slopeAtTen = 0.0;
    double lastIn = 0.0;
    double lastOut = 0.0;
    for (double inDb = -30.0; inDb <= 12.0; inDb += 2.0) {
      const double amplitude = kPlusTenDbm * std::pow(10.0, inDb / 20.0);
      OpticalLeveller unit;
      configure(unit, setting, mode);
      // Long enough for the slow branch and the exposure state to settle, which
      // is what "allowing settling at each step" means for a cell whose second
      // release constant runs to twelve seconds.
      const double outPeak = runTone(unit, amplitude, 1000.0, 40.0);
      const double outDb = db(outPeak);
      if (lastIn != 0.0) {
        const double slope = (inDb - lastIn) / (outDb - lastOut);
        if (previousSlope != 0.0) {
          // Fractional rather than absolute. A slope that has reached 12:1
          // legitimately changes by more per step than one at 2:1, so an
          // absolute bound would call the steep end of LIMIT a corner while
          // missing a real one at the shallow end. What a knee equation
          // produces is a *proportional* jump, and this is what sees it.
          worstJump = std::max(worstJump, std::fabs(slope - previousSlope) / slope);
        }
        if (std::fabs(unit.gainReductionDb() - 10.0) < 3.0) slopeAtTen = slope;
        previousSlope = slope;
      }
      lastIn = inDb;
      lastOut = outDb;
    }
    std::printf("    test 1 %s: setting %.4f, slope at 10 dB reduction %.2f:1,"
                " worst fractional slope step %.2f\n",
                modeIndex == 0 ? "COMPRESS" : "LIMIT   ", setting, slopeAtTen, worstJump);
    if (modeIndex == 0) {
      MW_EXPECT(slopeAtTen >= 2.5 && slopeAtTen <= 4.0);
    } else {
      MW_EXPECT(slopeAtTen >= 8.0);
    }
    // Smoothness. A knee equation shows here as a step in the slope between two
    // adjacent 2 dB points; a curve generated by a loop does not.
    MW_EXPECT(worstJump < 0.6);
  }
}

MW_TEST("dyn-02 test 2: the attack lets transients through, at 10 ms") {
  const double setting = settingFor(10.0, kPlusTenDbm, OpticalLeveller::Mode::Compress);
  OpticalLeveller unit;
  configure(unit, setting, OpticalLeveller::Mode::Compress);
  // Settled at a level well below where it compresses, then stepped up.
  runTone(unit, kPlusTenDbm * 0.01, 1000.0, 0.5);

  // The step, sampled per block so the timing resolution is 512 samples —
  // 10.7 ms at this rate, which is the whole measurement. Sampled per *sample*
  // instead, by reading the cell directly.
  const int frames = static_cast<int>(kRate * 0.1);
  std::vector<float> left(1, 0.0f);
  std::vector<float> right(1, 0.0f);
  float* channels[2] = {left.data(), right.data()};
  std::vector<float> outLeft(1, 0.0f);
  std::vector<float> outRight(1, 0.0f);
  float* outChannels[2] = {outLeft.data(), outRight.data()};
  int at10 = -1;
  int at90 = -1;
  double finalDb = 0.0;
  for (int i = 0; i < frames; ++i) {
    const double t = static_cast<double>(i) / kRate;
    left[0] = static_cast<float>(kPlusTenDbm * std::sin(2.0 * kPi * 1000.0 * t));
    right[0] = left[0];
    AudioBuffer in(channels, 2, 1);
    AudioBuffer out(outChannels, 2, 1);
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &out;
    ctx.outputCount = 1;
    ctx.frames = 1;
    ctx.sampleRate = kRate;
    ctx.playing = true;
    unit.process(ctx);
    finalDb = unit.gainReductionDb();
  }
  // Re-run, now knowing the final value, to find the 10 % and 90 % crossings.
  configure(unit, setting, OpticalLeveller::Mode::Compress);
  runTone(unit, kPlusTenDbm * 0.01, 1000.0, 0.5);
  for (int i = 0; i < frames; ++i) {
    const double t = static_cast<double>(i) / kRate;
    left[0] = static_cast<float>(kPlusTenDbm * std::sin(2.0 * kPi * 1000.0 * t));
    right[0] = left[0];
    AudioBuffer in(channels, 2, 1);
    AudioBuffer out(outChannels, 2, 1);
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &out;
    ctx.outputCount = 1;
    ctx.frames = 1;
    ctx.sampleRate = kRate;
    ctx.playing = true;
    unit.process(ctx);
    const double g = unit.gainReductionDb();
    if (at10 < 0 && g >= finalDb * 0.1) at10 = i;
    if (at90 < 0 && g >= finalDb * 0.9) {
      at90 = i;
      break;
    }
  }
  const double ms = static_cast<double>(at90 - at10) * 1000.0 / kRate;
  std::printf("    test 2: 10 %%-90 %% of %.2f dB in %.2f ms\n", finalDb, ms);
  MW_EXPECT_NEAR(ms, 10.0, 3.0);
}

MW_TEST("dyn-02 tests 3 to 6: two release branches, and a cell that remembers") {
  const double setting = settingFor(10.0, kPlusTenDbm, OpticalLeveller::Mode::Compress);

  // A release measurement: hold for `holdSeconds`, then release and time the
  // two stages. Returned as {stage one in ms, stage two in seconds}.
  auto release = [&](OpticalLeveller& unit, double holdSeconds) {
    runTone(unit, kPlusTenDbm, 1000.0, holdSeconds);
    const double start = unit.gainReductionDb();
    double toHalf = -1.0;
    double toFive = -1.0;
    double toClear = -1.0;
    runSilence(unit, 40.0, [&](double seconds, double reduction) {
      if (toHalf < 0.0 && reduction <= start * 0.5) toHalf = seconds;
      // Stage two is measured between two *absolute* levels — 5 dB remaining to
      // 0.5 dB remaining — because that is what the sheet says and because a
      // span defined relative to the starting depth compares two different
      // journeys whenever the starting depths differ.
      if (toFive < 0.0 && reduction <= 5.0) toFive = seconds;
      if (toFive >= 0.0 && toClear < 0.0 && reduction <= 0.5) toClear = seconds;
    });
    // Printed rather than only asserted. The depth a release starts from and
    // the exposure it starts with are what these three rows are comparing, and
    // when they disagreed it was those two numbers that said why — a cold unit
    // overshooting to 13.8 dB where its own equilibrium was 8.0, which is a
    // property of the loop and not of the release.
    std::printf("      (release from %.2f dB, exposure %.4f, slow tau %.2f s)\n", start,
                unit.cell().exposure(), unit.cell().slowReleaseSeconds());
    return std::pair<double, double>{toHalf * 1000.0, toClear - toFive};
  };

  OpticalLeveller shortHistory;
  configure(shortHistory, setting, OpticalLeveller::Mode::Compress);
  const auto shortRun = release(shortHistory, 0.2);
  std::printf("    test 3: stage one %.1f ms\n", shortRun.first);
  std::printf("    test 4: stage two after 200 ms of work, %.3f s\n", shortRun.second);
  // 60 ms ± 20, and the sheet's own band for the remainder.
  MW_EXPECT_NEAR(shortRun.first, 60.0, 20.0);
  MW_EXPECT(shortRun.second >= 0.5 && shortRun.second <= 5.0);

  OpticalLeveller longHistory;
  configure(longHistory, setting, OpticalLeveller::Mode::Compress);
  const auto longRun = release(longHistory, 60.0);
  const double ratio = longRun.second / shortRun.second;
  std::printf("    test 5: stage two after 60 s of work, %.3f s — %.2fx the short history\n",
              longRun.second, ratio);
  // The memory test. A model whose release is identical after 200 ms and after
  // 60 s has no history state, and this is the row that says so — guarded by
  // the harness, because two releases that both failed to be measured would
  // give a ratio of zero over zero and no assertion about it means anything.
  // A millisecond is the floor: a release shorter than that was not a release.
  MW_EXPECT_AT_LEAST_TIMES(longRun.second, shortRun.second, 2.0, 1.0e-3);

  // And the memory fades. A cell that has been resting recovers quickly again,
  // which is the other half of the claim and the half a one-way accumulator
  // would fail.
  runSilence(longHistory, 60.0, [](double, double) {});
  const auto rested = release(longHistory, 0.2);
  const double drift = std::fabs(rested.second / shortRun.second - 1.0);
  std::printf("    test 6: after 60 s idle, stage two %.3f s — %.1f %% from the original\n",
              rested.second, drift * 100.0);
  MW_EXPECT(drift <= 0.30);
}

MW_TEST("dyn-02 test 12: the make-up gain is outside the loop") {
  // §3.2 marks the tap point as inference and gives the reasoning; this is what
  // checks the inference held. If the detector were on the wrong side of the
  // multiply, turning up GAIN would compress harder, and the published advice
  // to set PEAK REDUCTION first and GAIN second would be wrong.
  const double setting = settingFor(10.0, kPlusTenDbm, OpticalLeveller::Mode::Compress);
  double lowest = 100.0;
  double highest = -100.0;
  for (double gainDb : {-12.0, 0.0, 12.0, 24.0}) {
    OpticalLeveller unit;
    configure(unit, setting, OpticalLeveller::Mode::Compress);
    unit.setMakeUpGain(std::pow(10.0, gainDb / 20.0));
    runTone(unit, kPlusTenDbm, 1000.0, 3.0);
    lowest = std::min(lowest, unit.gainReductionDb());
    highest = std::max(highest, unit.gainReductionDb());
  }
  std::printf("    test 12: reduction across 36 dB of make-up spans %.4f dB\n", highest - lowest);
  MW_EXPECT(highest - lowest < 1.0);
}

MW_TEST("dyn-02 test 13: the meter lags, because the meter is a cell too") {
  // §3.4: the gain-reduction reading comes from a second photocell in the same
  // package, so it has the same lag and the same memory. QA must not compare
  // the model's meter against an instantaneous calculation, and a 20 ms burst
  // is where the difference shows.
  const double setting = settingFor(10.0, kPlusTenDbm, OpticalLeveller::Mode::Compress);
  OpticalLeveller unit;
  configure(unit, setting, OpticalLeveller::Mode::Compress);
  double peakMeter = 0.0;
  const int frames = static_cast<int>(kRate * 0.02);
  std::vector<float> left(1, 0.0f);
  std::vector<float> right(1, 0.0f);
  float* channels[2] = {left.data(), right.data()};
  std::vector<float> outLeft(1, 0.0f);
  std::vector<float> outRight(1, 0.0f);
  float* outChannels[2] = {outLeft.data(), outRight.data()};
  for (int i = 0; i < frames; ++i) {
    const double t = static_cast<double>(i) / kRate;
    left[0] = static_cast<float>(kPlusTenDbm * std::sin(2.0 * kPi * 1000.0 * t));
    right[0] = left[0];
    AudioBuffer in(channels, 2, 1);
    AudioBuffer out(outChannels, 2, 1);
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &out;
    ctx.outputCount = 1;
    ctx.frames = 1;
    ctx.sampleRate = kRate;
    ctx.playing = true;
    unit.process(ctx);
    peakMeter = std::max(peakMeter, unit.meterGainReductionDb());
  }
  std::printf("    test 13: a 20 ms burst reads %.2f dB on a meter whose steady value is 10\n",
              peakMeter);
  MW_EXPECT(peakMeter < 6.0);
}

MW_TEST_MAIN("optical-leveller")
