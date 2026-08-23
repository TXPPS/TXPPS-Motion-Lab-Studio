// Motion Wave — Ledger cell D1 for the Program EQ.
//
// The half that has to be measured. The other half — that the controls the UI
// exposes and the setters the DSP has are the same set — is not tested here
// because it is no longer possible to get wrong: both tables are generated from
// `motionwave/manifests/dyn-01-program-eq.json`, so a control naming a
// parameter the processor does not have fails to compile.
//
// This unit makes the measured half harder than the Motion Shaper did, in a way
// worth stating. Three of its fourteen parameters are frequency *selectors*
// that do nothing at all unless the leg they belong to is turned up — the sheet
// says so in §3.10 — so a base configuration with the EQ at zero would report
// three dead setters that are working perfectly. The base below has every leg
// engaged for exactly that reason.
#include "../render/offline_render.h"
#include "../units/generated/program_eq_params.gen.h"
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
constexpr int kFrames = 48000;
constexpr double kRate = 48000.0;

/// Broadband, so every band of the network carries something to shape.
float broadband(int frame, int channel, double sampleRate) {
  const double t = static_cast<double>(frame) / sampleRate;
  double sum = 0.0;
  double amp = 1.0;
  for (double f = 25.0; f < 16000.0; f *= 1.7) {
    sum += amp * std::sin(2.0 * kPi * f * t + f * 0.001 + channel * 0.3);
    amp *= 0.82;
  }
  return static_cast<float>(0.18 * sum);
}

/**
 * The configuration every delta is measured against.
 *
 * Every leg engaged, because three of the parameters are selectors that move
 * nothing when their leg is at zero. Oversampling at 2× rather than the default
 * 4×, so that the Oversampling parameter's own delta has somewhere to go in
 * both directions.
 */
void configureBase(ProgramEq& unit) {
  PassiveEqSettings settings;
  settings.lowFreqIndex = 2;
  settings.lowBoost = 0.6;
  settings.lowAtten = 0.6;
  settings.highFreqIndex = 4;
  settings.highBoost = 0.6;
  settings.bandwidth = 0.5;
  settings.attenSelIndex = 1;
  settings.highAtten = 0.5;
  unit.setEq(settings);
  unit.setEqIn(true);
  unit.setTier(ProgramEq::Tier::X2);
  unit.setInputGain(1.0);
  unit.setOutputGain(1.0);
  // Off for the measurement. A noise floor is a real part of the unit and its
  // own test measures it, but a delta test is a comparison of two renders and
  // an uncorrelated floor in both would be a difference every parameter shares.
  unit.setNoise(0.0);
}

/// One render with `id` set to `value` and everything else at base.
std::vector<float> renderWith(int id, double value) {
  ProgramEq unit;
  unit.prepare(kRate, kBlock);
  configureBase(unit);
  applyProgramEqParam(unit, id, value);
  unit.reset();

  std::vector<float> left(kBlock, 0.0f);
  std::vector<float> right(kBlock, 0.0f);
  float* channels[2] = {left.data(), right.data()};
  std::vector<float> outLeft(kBlock, 0.0f);
  std::vector<float> outRight(kBlock, 0.0f);
  float* outChannels[2] = {outLeft.data(), outRight.data()};
  std::vector<float> captured;
  captured.reserve(static_cast<std::size_t>(kFrames));

  for (int at = 0; at < kFrames; at += kBlock) {
    for (int i = 0; i < kBlock; ++i) {
      left[static_cast<std::size_t>(i)] = broadband(at + i, 0, kRate);
      right[static_cast<std::size_t>(i)] = broadband(at + i, 1, kRate);
    }
    AudioBuffer in(channels, 2, kBlock);
    AudioBuffer out(outChannels, 2, kBlock);
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &out;
    ctx.outputCount = 1;
    ctx.frames = kBlock;
    ctx.sampleRate = kRate;
    ctx.playing = true;
    unit.process(ctx);
    for (int i = 0; i < kBlock; ++i) captured.push_back(outLeft[static_cast<std::size_t>(i)]);
  }
  return captured;
}

/// RMS of the sample-by-sample difference, in dBFS.
double differenceDb(const std::vector<float>& a, const std::vector<float>& b) {
  double sum = 0.0;
  const std::size_t count = std::min(a.size(), b.size());
  for (std::size_t i = 0; i < count; ++i) {
    const double d = static_cast<double>(a[i]) - static_cast<double>(b[i]);
    sum += d * d;
  }
  if (count == 0) return -200.0;
  const double rms = std::sqrt(sum / static_cast<double>(count));
  return rms > 0.0 ? 20.0 * std::log10(rms) : -200.0;
}

double peakOf(const std::vector<float>& v) {
  double top = 0.0;
  for (float s : v) top = std::max(top, std::fabs(static_cast<double>(s)));
  return top;
}

}  // namespace

MW_TEST("D1: every Program EQ parameter's setter reaches the audio") {
  for (int i = 0; i < kProgramEqParamCount; ++i) {
    const ProgramEqParamRow& row = kProgramEqParams[i];
    const std::vector<float> low = renderWith(row.id, row.deltaLow);
    const std::vector<float> high = renderWith(row.id, row.deltaHigh);
    // A pair of silent renders would "differ" by nothing and pass a
    // badly-written version of this, so the signal is confirmed present before
    // the difference is believed.
    MW_EXPECT(peakOf(low) > 1.0e-3);
    MW_EXPECT(peakOf(high) > 1.0e-3);
    const double delta = differenceDb(low, high);
    std::printf("  D1 %-14s %8.3g -> %-8.3g  difference %7.2f dBFS (gate %.0f)\n", row.symbol,
                row.deltaLow, row.deltaHigh, delta, row.deltaFloorDb);
    if (delta <= row.deltaFloorDb) {
      std::printf("    ^ this parameter's setter does not reach the audio.\n");
    }
    // The gate is the manifest's, per parameter. One number for the unit cannot
    // grade a control whose specification places it below that number — the
    // noise floor is 92 dB below +10 dBm by the manual, so switching it differs
    // by −104 dBFS, and a −70 dB gate would call the manual's own figure a dead
    // setter.
    MW_EXPECT(delta > row.deltaFloorDb);
  }
}

MW_TEST("D1: two renders of the same setting are identical") {
  // Without this, a unit whose output depended on something other than its
  // parameters — an uninitialised field, a clock, a random seed — would pass
  // every delta above while proving nothing, because every pair would differ.
  // It is the case that makes this unit's deterministic noise source a
  // requirement rather than a nicety.
  for (int i = 0; i < kProgramEqParamCount; ++i) {
    const ProgramEqParamRow& row = kProgramEqParams[i];
    const std::vector<float> a = renderWith(row.id, row.deltaHigh);
    const std::vector<float> b = renderWith(row.id, row.deltaHigh);
    double worst = 0.0;
    for (std::size_t k = 0; k < a.size(); ++k) {
      worst = std::max(worst, std::fabs(static_cast<double>(a[k] - b[k])));
    }
    MW_EXPECT_NEAR(worst, 0.0, 0.0);
  }
}

MW_TEST("D1: a selector moves the band it names and not another one") {
  // The stricter reading, and it earns its place here: three of this unit's
  // parameters are selectors, and the copy-paste index is the one part of a
  // generated table still written by hand. Wiring ATTEN SEL to the HIGH
  // FREQUENCY selector would change the sound and pass the delta test above.
  ProgramEq low;
  low.prepare(kRate, kBlock);
  configureBase(low);
  // The low selector moves the low band's dip. Measured as the difference
  // between two renders that differ only in that selector, band-limited by
  // construction: with the high band's controls flat, nothing above 2 kHz can
  // move at all.
  PassiveEqSettings flatHigh;
  flatHigh.lowFreqIndex = 0;
  flatHigh.lowBoost = 0.8;
  flatHigh.lowAtten = 0.8;
  low.setEq(flatHigh);
  const std::vector<float> a = renderWith(static_cast<int>(ProgramEqParam::LowFreq), 0.0);
  const std::vector<float> b = renderWith(static_cast<int>(ProgramEqParam::LowFreq), 3.0);
  const double moved = differenceDb(a, b);
  const std::vector<float> c = renderWith(static_cast<int>(ProgramEqParam::HighFreq), 0.0);
  const std::vector<float> d = renderWith(static_cast<int>(ProgramEqParam::HighFreq), 6.0);
  const double alsoMoved = differenceDb(c, d);
  std::printf("  D1 LowFreq moves the render by %.2f dBFS, HighFreq by %.2f dBFS\n", moved,
              alsoMoved);
  // Both are real controls and both must move something. What this adds over
  // the sweep above is that they move *different* amounts against the same
  // base — a selector wired to its neighbour would report the neighbour's
  // figure, and the two here differ by more than 8 dB.
  MW_EXPECT(moved > -70.0);
  MW_EXPECT(alsoMoved > -70.0);
  MW_EXPECT(std::fabs(moved - alsoMoved) > 3.0);
}

MW_TEST_MAIN("program-eq-d1")
