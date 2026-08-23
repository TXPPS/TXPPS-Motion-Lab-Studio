// Motion Wave — Ledger cell D1 for the FET Limiter.
//
// The measured half; the parity half is generated and so cannot be got wrong.
// The sweep and the determinism check are in `delta_harness.h`, shared with the
// other units — what is here is this unit's base configuration, which is the
// part that is genuinely its own.
//
// Getting the base right matters here for a different reason than it did for
// the Optical Leveller. This unit has no threshold control: the threshold is
// fixed and INPUT is how hard the signal is driven into it, so a base that does
// not reach limiting leaves the four ratio positions indistinguishable and the
// timing controls with nothing to time. The base drives hard.
#include "../units/generated/fet_limiter_params.gen.h"
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
constexpr double kRate = 48000.0;
/// One second. This unit's slowest release is 1.1 s, so a render has to be at
/// least that to have settled anywhere — and short enough that eighteen sweeps
/// of it are a test rather than a coffee break.
constexpr int kFrames = 48000;

/**
 * Broadband under a continuous amplitude modulation.
 *
 * The envelope is not decoration and it took two attempts. A *steady* signal
 * never lets the unit release, so RELEASE had nothing to do and its
 * render-delta measured −79.7 dBFS — a working control reported as a dead one.
 * Gating the signal on and off was no better at −83.0, for a subtler reason:
 * during the gaps both renders are silent and during the bursts the loop
 * re-converges to the same equilibrium, so the release only differs for a few
 * tens of milliseconds either side and the rest of the window dilutes it away.
 *
 * A continuous modulation keeps the unit in the release-limited regime for the
 * whole render: the level is always falling somewhere, so the release constant
 * is always shaping the reduction rather than only setting how a burst starts.
 * Four hertz spans the control's own 50 ms-to-1.1 s range — fast enough that
 * the slow end never catches up, slow enough that the fast end always does.
 *
 * A parameter can only be shown to reach the audio by a stimulus that asks it
 * to, which is the same lesson the Optical Leveller's ratio rows cost when they
 * were measuring an onset instead of a level.
 */
float broadband(int frame, int channel, double sampleRate) {
  const double t = static_cast<double>(frame) / sampleRate;
  double sum = 0.0;
  double amp = 1.0;
  for (double f = 45.0; f < 14000.0; f *= 1.9) {
    sum += amp * std::sin(2.0 * kPi * f * t + f * 0.001 + channel * 0.3);
    amp *= 0.85;
  }
  // 20 dB of swing, sinusoidal so there is no discontinuity for the wrapper's
  // reconstruction filter to ring on and hand the detector a transient the
  // signal does not contain.
  const double envelope = std::pow(10.0, -1.0 + std::sin(2.0 * kPi * 4.0 * t));
  return static_cast<float>(0.25 * sum * envelope);
}

void configureBase(FetLimiter& unit) {
  // Into limiting, but not past the element's ceiling. At a gain of 8 the unit
  // sat pinned at its maximum 45 dB and *could not release at all* — the
  // control was clamped, so `wanted` had to fall 30 dB before the reduction
  // moved and RELEASE measured as a dead control at every setting. Driving a
  // limiter into its stop is not a harder test, it is a test of the stop.
  unit.setInputGain(1.0);
  unit.setOutputGain(1.0);
  unit.setAttack(5.0);
  unit.setRelease(4.0);
  unit.setRatio(FetRatio::R8);
  unit.setLimiting(true);
  // 2x rather than the unit's own 8x default: fourteen sweeps of two seconds
  // each at 8x is a coffee break, and the Oversampling parameter's own delta
  // still has somewhere to go in both directions.
  unit.setTier(FetLimiter::Tier::X2);
}

std::vector<float> renderWith(int id, double value) {
  FetLimiter unit;
  unit.prepare(kRate, kBlock);
  configureBase(unit);
  applyFetLimiterParam(unit, id, value);
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

MW_TEST("D1: every FET Limiter parameter's setter reaches the audio") {
  test::expectEveryParameterReachesAudio(kFetLimiterParams, kFetLimiterParamCount,
                                         renderWith);
}

MW_TEST("D1: two renders of the same setting are identical") {
  test::expectRendersAreDeterministic(kFetLimiterParams, kFetLimiterParamCount,
                                      renderWith);
}

/// A power of two, an odd size no host would pick but a plug-in must survive,
/// and one large enough to cross the wrapper's latency in a single call.
constexpr int kBlockSizes[3] = {64, 97, 1024};

MW_TEST("D1: the block size the host chooses does not change the audio") {
  // Stereo and both channels different, which is what it takes to see this: a
  // mono render of this unit was bit-identical at every block size while the
  // right channel was being filtered through the left channel's history.
  test::expectBlockSizeIndependent(
      [](int blockSize) {
        FetLimiter unit;
        unit.prepare(kRate, blockSize);
        unit.setNoise(0.0);
        unit.setLimiting(true);
        unit.setTier(FetLimiter::Tier::X8);
        unit.setRatio(FetRatio::R8);
        unit.setAttack(7.0);
        unit.setRelease(4.0);
        unit.reset();

        const std::size_t span = static_cast<std::size_t>(blockSize);
        std::vector<float> left(span, 0.0f);
        std::vector<float> right(span, 0.0f);
        std::vector<float> outLeft(span, 0.0f);
        std::vector<float> outRight(span, 0.0f);
        float* channels[2] = {left.data(), right.data()};
        float* outChannels[2] = {outLeft.data(), outRight.data()};
        std::vector<float> captured;
        captured.reserve(static_cast<std::size_t>(kFrames));
        for (int at = 0; at < kFrames; at += blockSize) {
          // The last call is short whenever the block size does not divide the
          // render, which is the point of including a size that does not.
          const int frames = std::min(blockSize, kFrames - at);
          for (int i = 0; i < frames; ++i) {
            left[static_cast<std::size_t>(i)] = broadband(at + i, 0, kRate);
            right[static_cast<std::size_t>(i)] = broadband(at + i, 1, kRate);
          }
          AudioBuffer in(channels, 2, frames);
          AudioBuffer out(outChannels, 2, frames);
          ProcessContext ctx;
          ctx.inputs = &in;
          ctx.inputCount = 1;
          ctx.outputs = &out;
          ctx.outputCount = 1;
          ctx.frames = frames;
          ctx.sampleRate = kRate;
          ctx.playing = true;
          unit.process(ctx);
          for (int i = 0; i < frames; ++i) {
            captured.push_back(outLeft[static_cast<std::size_t>(i)]);
            captured.push_back(outRight[static_cast<std::size_t>(i)]);
          }
        }
        return captured;
      },
      kBlockSizes, 3);
}

MW_TEST_MAIN("fet-limiter-d1")
