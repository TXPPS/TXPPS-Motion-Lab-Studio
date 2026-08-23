// Motion Wave — Ledger cell D1 for the Optical Leveller.
//
// The measured half; the parity half is generated and so cannot be got wrong.
// The sweep and the determinism check are in `delta_harness.h`, shared with the
// other units — what is here is this unit's base configuration, which is the
// part that is genuinely its own.
//
// Getting that base right matters more here than it did for the two units
// before. This is a *feedback* compressor with time constants running to
// seconds, so a render short enough to be quick is a render where the loop is
// still moving, and two of its parameters — Wear and Emphasis — do nothing at
// all unless the loop is working. The base compresses, and the renders are long
// enough for the fast branch and the exposure state to have settled.
#include "../units/generated/optical_leveller_params.gen.h"
#include "delta_harness.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr int kBlock = 512;
constexpr double kRate = 48000.0;
/// Two seconds. Long enough for the loop to settle and for the slow branch to
/// have moved; short enough that fourteen sweeps of it are a test and not a
/// coffee break.
constexpr int kFrames = 96000;

/// Broadband with a strong low end, so the pre-emphasis has something to remove
/// and the transformers have something to work on.
float broadband(int frame, int channel, double sampleRate) {
  const double t = static_cast<double>(frame) / sampleRate;
  double sum = 0.0;
  double amp = 1.0;
  for (double f = 45.0; f < 14000.0; f *= 1.9) {
    sum += amp * std::sin(2.0 * kPi * f * t + f * 0.001 + channel * 0.3);
    amp *= 0.85;
  }
  return static_cast<float>(0.25 * sum);
}

void configureBase(OpticalLeveller& unit) {
  unit.setPeakReduction(0.35);
  unit.setMode(OpticalLeveller::Mode::Compress);
  unit.setEmphasis(0.4);
  unit.setWear(0.0);
  unit.setMakeUpGain(1.0);
  unit.setInputGain(1.0);
  unit.setTier(OpticalLeveller::Tier::X2);
}

std::vector<float> renderWith(int id, double value) {
  OpticalLeveller unit;
  unit.prepare(kRate, kBlock);
  configureBase(unit);
  applyOpticalLevellerParam(unit, id, value);
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

}  // namespace

MW_TEST("D1: every Optical Leveller parameter's setter reaches the audio") {
  test::expectEveryParameterReachesAudio(kOpticalLevellerParams, kOpticalLevellerParamCount,
                                         renderWith);
}

MW_TEST("D1: two renders of the same setting are identical") {
  test::expectRendersAreDeterministic(kOpticalLevellerParams, kOpticalLevellerParamCount,
                                      renderWith);
}

MW_TEST_MAIN("optical-leveller-d1")
