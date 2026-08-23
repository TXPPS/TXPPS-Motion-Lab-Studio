// Motion Wave — Optical Leveller, response and distortion. `dyn-02` §9 rows 7
// to 11.
//
// Split from the dynamics suite because they are the opposite measurement:
// those drive the loop and time what it does, and these keep the loop out of
// the way — PEAK REDUCTION at zero, so what is left is the amplifier, the two
// transformers and the cell sitting dark.
//
// That is also the point of most of them. §7's first observation about this
// unit is that it is not transparent with the compression off, and rows 7, 10
// and 11 are what say so with numbers.
//
// Directive 06 §1: each measurement states its bin width and puts the probe
// exactly on a bin, so a harmonic is one bin's worth and nothing leaks in from
// its neighbours.
#include "../dsp/fft.h"
#include "../units/optical_leveller.h"
#include "harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr int kBlock = 512;
constexpr std::size_t kN = 65536;
constexpr double kRate = 48000.0;
constexpr double kBinHz = kRate / static_cast<double>(kN);

const double kPlusTenDbm = static_cast<double>(dsp::nl::dbuToLinear(10.0));
const double kPlusSixteenDbm = static_cast<double>(dsp::nl::dbuToLinear(16.0));

/// Render a coherent sine, discarding a settling second first.
std::vector<float> render(OpticalLeveller& unit, double hz, double amplitude, std::size_t frames) {
  const double cycles = std::floor(hz / kBinHz + 0.5);
  const double step = 2.0 * kPi * cycles * kBinHz / kRate;
  unit.reset();
  std::vector<float> left(kBlock, 0.0f);
  std::vector<float> right(kBlock, 0.0f);
  float* channels[2] = {left.data(), right.data()};
  std::vector<float> outLeft(kBlock, 0.0f);
  std::vector<float> outRight(kBlock, 0.0f);
  float* outChannels[2] = {outLeft.data(), outRight.data()};
  std::vector<float> captured(frames, 0.0f);
  // A second of settling. The slowest thing in the chain is the valve stages'
  // 2 Hz restoration, and its transient would sit under the fundamental as a
  // skirt — the same lesson the Program EQ's response suite cost.
  const std::size_t settle = static_cast<std::size_t>(kRate);
  const std::size_t total = settle + frames;
  for (std::size_t at = 0; at < total; at += static_cast<std::size_t>(kBlock)) {
    const int count = static_cast<int>(std::min(static_cast<std::size_t>(kBlock), total - at));
    for (int i = 0; i < count; ++i) {
      const double index = static_cast<double>(at + static_cast<std::size_t>(i));
      left[static_cast<std::size_t>(i)] = static_cast<float>(amplitude * std::sin(step * index));
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
    for (int i = 0; i < count; ++i) {
      const std::size_t absolute = at + static_cast<std::size_t>(i);
      if (absolute >= settle) captured[absolute - settle] = outLeft[static_cast<std::size_t>(i)];
    }
  }
  return captured;
}

struct Harmonics {
  double h[6] = {0, 0, 0, 0, 0, 0};
  double ratio(int n) const { return h[0] > 0.0 ? h[n - 1] / h[0] : 0.0; }
  double thd() const {
    double sum = 0.0;
    for (int n = 2; n <= 6; ++n) sum += ratio(n) * ratio(n);
    return std::sqrt(sum);
  }
  double magnitude() const { return h[0]; }
};

Harmonics analyse(const std::vector<float>& out, double hz) {
  std::vector<double> re(kN, 0.0);
  std::vector<double> im(kN, 0.0);
  for (std::size_t i = 0; i < kN; ++i) re[i] = static_cast<double>(out[i]);
  dsp::fft(re, im);
  const std::size_t bin = static_cast<std::size_t>(std::floor(hz / kBinHz + 0.5));
  Harmonics h;
  for (int n = 1; n <= 6; ++n) {
    const std::size_t k = bin * static_cast<std::size_t>(n);
    if (k >= kN / 2) break;
    h.h[n - 1] = 2.0 * std::sqrt(re[k] * re[k] + im[k] * im[k]) / static_cast<double>(kN);
  }
  return h;
}

double db(double v) { return 20.0 * std::log10(v > 1.0e-15 ? v : 1.0e-15); }

/// A unit with the loop parked, for the measurements that are about everything
/// except the loop.
void configureClean(OpticalLeveller& unit) {
  unit.prepare(kRate, kBlock);
  unit.setPeakReduction(0.0);
  unit.setNoise(0.0);
  unit.reset();
}

/// Steady-state gain reduction for a tone, after `seconds`.
double reductionFor(OpticalLeveller& unit, double hz, double amplitude, double seconds) {
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
      const double t = static_cast<double>(at + i) / kRate;
      left[static_cast<std::size_t>(i)] =
          static_cast<float>(amplitude * std::sin(2.0 * kPi * hz * t));
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
  }
  return unit.gainReductionDb();
}

}  // namespace

MW_TEST("dyn-02 test 7: flat with the compression off") {
  OpticalLeveller unit;
  configureClean(unit);
  double worst = 0.0;
  double worstHz = 0.0;
  double reference = 0.0;
  for (double hz = 30.0; hz <= 15000.0; hz *= 1.6) {
    const Harmonics h = analyse(render(unit, hz, 0.05, kN), hz);
    const double level = db(h.magnitude() / 0.05);
    if (reference == 0.0) reference = level;
    if (std::fabs(level) > worst) {
      worst = std::fabs(level);
      worstHz = hz;
    }
  }
  std::printf("    test 7 bins %.4f Hz: worst |error| %.3f dB at %.0f Hz across 30 Hz-15 kHz\n",
              kBinHz, worst, worstHz);
  // The specification is ±0.1 dB; the sheet allows ±0.4 dB overall on the
  // model, which is the tolerance on the tolerance.
  MW_EXPECT(worst <= 0.4);
}

MW_TEST("dyn-02 test 8: the dynamics are frequency dependent, and that is logged") {
  // The specification says the ratio is frequency dependent as well as
  // nonlinear, so a difference here is *expected*. The sheet says to record it
  // as a baseline rather than fail on it, and that is what this does — the
  // assertion is only that both frequencies compress at all, because a zero
  // would mean the detector had stopped seeing one of them.
  OpticalLeveller unit;
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  unit.setTier(OpticalLeveller::Tier::Off);
  unit.setPeakReduction(0.40);
  unit.reset();
  const double low = reductionFor(unit, 60.0, kPlusTenDbm, 3.0);
  unit.reset();
  const double high = reductionFor(unit, 6000.0, kPlusTenDbm, 3.0);
  std::printf("    test 8 baseline: 60 Hz reduces %.2f dB, 6 kHz reduces %.2f dB (difference"
              " %.2f dB)\n",
              low, high, high - low);
  MW_EXPECT(low > 1.0);
  MW_EXPECT(high > 1.0);
}

MW_TEST("dyn-02 test 9: the pre-emphasis makes the detector deaf to bass") {
  // Flat as shipped, and rolling the lows out of the detector as the control
  // advances. §3.5 treats the exact curve as unknown and asks for "flat at one
  // end, roughly first-order high-emphasis with a corner in the low kHz at the
  // other", which is what is built and what these two assertions bracket.
  OpticalLeveller flat;
  flat.prepare(kRate, kBlock);
  flat.setNoise(0.0);
  flat.setTier(OpticalLeveller::Tier::Off);
  flat.setPeakReduction(0.40);
  flat.setEmphasis(0.0);
  flat.reset();
  const double flatLow = reductionFor(flat, 100.0, kPlusTenDbm, 3.0);
  flat.reset();
  const double flatHigh = reductionFor(flat, 10000.0, kPlusTenDbm, 3.0);

  OpticalLeveller shaped;
  shaped.prepare(kRate, kBlock);
  shaped.setNoise(0.0);
  shaped.setTier(OpticalLeveller::Tier::Off);
  shaped.setPeakReduction(0.40);
  shaped.setEmphasis(1.0);
  shaped.reset();
  const double shapedLow = reductionFor(shaped, 100.0, kPlusTenDbm, 3.0);
  shaped.reset();
  const double shapedHigh = reductionFor(shaped, 10000.0, kPlusTenDbm, 3.0);

  std::printf("    test 9 flat: 100 Hz %.2f dB, 10 kHz %.2f dB (difference %.2f)\n", flatLow,
              flatHigh, flatHigh - flatLow);
  std::printf("    test 9 full: 100 Hz %.2f dB, 10 kHz %.2f dB (difference %.2f)\n", shapedLow,
              shapedHigh, shapedHigh - shapedLow);
  MW_EXPECT(std::fabs(flatHigh - flatLow) <= 2.0);
  MW_EXPECT(shapedHigh - shapedLow >= 6.0);
}

MW_TEST("dyn-02 test 10: the published distortion, at both published levels") {
  OpticalLeveller unit;
  configureClean(unit);
  const Harmonics ten = analyse(render(unit, 1000.0, kPlusTenDbm, kN), 1000.0);
  const Harmonics sixteen = analyse(render(unit, 1000.0, kPlusSixteenDbm, kN), 1000.0);
  std::printf("    test 10: THD %.4f %% at +10 dBm, %.4f %% at +16 dBm; H2-H3 %.2f dB\n",
              ten.thd() * 100.0, sixteen.thd() * 100.0, db(ten.ratio(2)) - db(ten.ratio(3)));
  // < 0.35 % and < 0.75 %, with +0.15 percentage points of tolerance.
  MW_EXPECT(ten.thd() * 100.0 <= 0.50);
  MW_EXPECT(sixteen.thd() * 100.0 <= 0.90);
  // And it rises with level rather than being a constant the model applies.
  MW_EXPECT(sixteen.thd() > ten.thd());
  // Second-harmonic dominant, from the single-ended 12AX7 that §6.3 names as
  // the unit's dominant tone-shaping nonlinearity.
  MW_EXPECT(db(ten.ratio(2)) - db(ten.ratio(3)) >= 6.0);
}

MW_TEST("dyn-02 test 11: the noise floor is this unit's, not the Program EQ's") {
  OpticalLeveller unit;
  unit.prepare(kRate, kBlock);
  unit.setPeakReduction(0.0);
  unit.reset();
  const std::vector<float> out = render(unit, 1000.0, 0.0, kN);
  double mean = 0.0;
  for (float v : out) mean += static_cast<double>(v);
  mean /= static_cast<double>(kN);
  double sum = 0.0;
  for (float v : out) {
    const double d = static_cast<double>(v) - mean;
    sum += d * d;
  }
  const double rms = std::sqrt(sum / static_cast<double>(kN));
  const double below = db(kPlusTenDbm) - db(rms);
  std::printf("    test 11: noise %.2f dBFS rms, %.1f dB below +10 dBm; residual DC %.2e\n",
              db(rms), below, mean);
  // 75 dB, ±3. Seventeen decibels noisier than the Program EQ's 92, which is
  // one of this unit's published characteristics rather than a defect.
  MW_EXPECT_NEAR(below, 75.0, 3.0);
  MW_EXPECT(std::fabs(mean) < 1.0e-5);
}

MW_TEST_MAIN("optical-leveller-amp")
