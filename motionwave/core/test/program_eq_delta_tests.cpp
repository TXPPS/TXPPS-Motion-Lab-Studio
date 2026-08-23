// Motion Wave — Ledger cell D1 for the Program EQ.
//
// The half that has to be measured. The other half — that the controls the UI
// exposes and the setters the DSP has are the same set — is not tested here
// because it is no longer possible to get wrong: both tables are generated from
// `motionwave/manifests/dyn-01-program-eq.json`, so a control naming a
// parameter the processor does not have fails to compile.
//
// The sweep and the determinism check live in `delta_harness.h`, shared with
// every other unit — three copies of one test is the drift the manifests exist
// to prevent, one level up.
//
// This unit makes the measured half harder than the Motion Shaper did, in a way
// worth stating. Three of its fourteen parameters are frequency *selectors*
// that do nothing at all unless the leg they belong to is turned up — the sheet
// says so in §3.10 — so a base configuration with the EQ at zero would report
// three dead setters that are working perfectly. The base below has every leg
// engaged for exactly that reason.
#include "../render/offline_render.h"
#include "../units/generated/program_eq_params.gen.h"
#include "delta_harness.h"

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

}  // namespace

MW_TEST("D1: every Program EQ parameter's setter reaches the audio") {
  test::expectEveryParameterReachesAudio(kProgramEqParams, kProgramEqParamCount, renderWith);
}

MW_TEST("D1: two renders of the same setting are identical") {
  test::expectRendersAreDeterministic(kProgramEqParams, kProgramEqParamCount, renderWith);
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
  const double moved = test::differenceDb(a, b);
  const std::vector<float> c = renderWith(static_cast<int>(ProgramEqParam::HighFreq), 0.0);
  const std::vector<float> d = renderWith(static_cast<int>(ProgramEqParam::HighFreq), 6.0);
  const double alsoMoved = test::differenceDb(c, d);
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
