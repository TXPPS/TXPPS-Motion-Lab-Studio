// Motion Wave — Ledger cell D1 for the Variable-Mu Limiter.
//
// The measured half; the parity half is generated and so cannot be got wrong.
// The sweep, the determinism check and the block-size check are all in
// `delta_harness.h` — what is here is this unit's base configuration, which is
// the part that is genuinely its own.
//
// The base has to work harder than the other units' for two reasons. Every
// channel control exists twice, so a mono signal would leave half the manifest
// with nothing to change; and the mode switch matrixes the two channels, so a
// signal whose two channels are the same passes lateral/vertical identically to
// left/right and the mode's render-delta measures silence. The base is
// therefore stereo, decorrelated, and modulated — the modulation because a
// steady signal never lets the unit recover and the time-constant switch then
// has nothing to time.
#include "../units/generated/variable_mu_params.gen.h"
#include "delta_harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr int kBlock = 256;
constexpr double kRate = 48000.0;
/// Six seconds. Position 6's slow storage element recovers over twenty-five,
/// so no render can settle it — but six is long enough for the medium element
/// to separate the positions, and short enough that twenty-eight sweeps of it
/// are a test rather than an afternoon.
constexpr int kFrames = 288000;

/// Different in the two channels on purpose: a decorrelated pair has both sum
/// and difference content, which is what gives the mode switch and the
/// per-channel controls something to change.
float source(int index, int channel, double rate) {
  const double t = static_cast<double>(index) / rate;
  const double partials = std::sin(2.0 * kPi * 110.0 * t) +
                          0.6 * std::sin(2.0 * kPi * 337.0 * t + (channel == 0 ? 0.0 : 1.1)) +
                          0.35 * std::sin(2.0 * kPi * 1471.0 * t + (channel == 0 ? 0.7 : 2.4)) +
                          0.2 * std::sin(2.0 * kPi * 5300.0 * t);
  /*
   * Swells that fall a long way and stay down, not a gentle modulation.
   *
   * Two things have to be true at once and the first attempt had neither. The
   * signal must drop far enough, and for long enough, that the unit actually
   * *recovers* — otherwise the timing-constant switch has nothing to time, and
   * it measured −77.7 dBFS against a −70 gate: a working control reported dead,
   * which is the same way the FET Limiter's RELEASE first measured. Cubing the
   * raised cosine at 0.35 Hz gives roughly a second of quiet in every cycle,
   * which is long against position 1's 0.3 s recovery and short against
   * position 6's storage.
   *
   * And the floor must not be silence. With nothing coming in, both renders
   * output nothing whatever the gain is doing, so the interval that carries the
   * difference would carry none of it. Two per cent leaves a signal for the
   * recovered setting to pass at full gain while the held one is still
   * reducing.
   */
  const double swell = std::pow(0.5 - 0.5 * std::cos(2.0 * kPi * 0.35 * t), 3.0);
  const double envelope = 0.02 + 0.98 * swell;
  return static_cast<float>(0.30 * envelope * partials);
}

std::vector<float> renderWith(int id, double value) {
  VariableMu unit;
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  unit.setTier(VariableMu::Tier::X4);
  for (int c = 0; c < kVariableMuChannels; ++c) {
    // Well into limiting, so every control has something to act on. A base that
    // never reaches the threshold leaves the time constants and the DC trim
    // measuring nothing at all.
    unit.setThreshold(c, 2.0);
    unit.setDcThreshold(c, 0.5);
    unit.setTimeConstant(c, 4);
  }
  unit.reset();
  applyVariableMuParam(unit, id, value);
  unit.reset();

  std::vector<float> left(kBlock, 0.0f);
  std::vector<float> right(kBlock, 0.0f);
  std::vector<float> outLeft(kBlock, 0.0f);
  std::vector<float> outRight(kBlock, 0.0f);
  float* channels[2] = {left.data(), right.data()};
  float* outChannels[2] = {outLeft.data(), outRight.data()};
  std::vector<float> captured;
  captured.reserve(static_cast<std::size_t>(kFrames) * 2u);

  for (int at = 0; at < kFrames; at += kBlock) {
    for (int i = 0; i < kBlock; ++i) {
      left[static_cast<std::size_t>(i)] = source(at + i, 0, kRate);
      right[static_cast<std::size_t>(i)] = source(at + i, 1, kRate);
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
    // Both channels captured, because half this manifest only moves one of them
    // and a left-only capture would report those parameters dead.
    for (int i = 0; i < kBlock; ++i) {
      captured.push_back(outLeft[static_cast<std::size_t>(i)]);
      captured.push_back(outRight[static_cast<std::size_t>(i)]);
    }
  }
  return captured;
}

/// A power of two, an odd size no host would pick but a plug-in must survive,
/// and one large enough to cross the wrapper's latency in a single call.
constexpr int kBlockSizes[3] = {64, 97, 1024};

}  // namespace

MW_TEST("D1: every Variable-Mu parameter's setter reaches the audio") {
  test::expectEveryParameterReachesAudio(kVariableMuParams, kVariableMuParamCount, renderWith);
}

MW_TEST("D1: two renders of the same setting are identical") {
  test::expectRendersAreDeterministic(kVariableMuParams, kVariableMuParamCount, renderWith);
}

MW_TEST("D1: the block size the host chooses does not change the audio") {
  test::expectBlockSizeIndependent(
      [](int blockSize) {
        VariableMu unit;
        unit.prepare(kRate, blockSize);
        unit.setNoise(0.0);
        unit.setTier(VariableMu::Tier::X4);
        for (int c = 0; c < kVariableMuChannels; ++c) {
          unit.setThreshold(c, 2.0);
          unit.setTimeConstant(c, 5);
        }
        unit.setMode(VariableMu::Mode::LateralVertical);
        unit.reset();

        const std::size_t span = static_cast<std::size_t>(blockSize);
        std::vector<float> left(span, 0.0f);
        std::vector<float> right(span, 0.0f);
        std::vector<float> outLeft(span, 0.0f);
        std::vector<float> outRight(span, 0.0f);
        float* channels[2] = {left.data(), right.data()};
        float* outChannels[2] = {outLeft.data(), outRight.data()};
        std::vector<float> captured;
        const int frames = 48000;
        captured.reserve(static_cast<std::size_t>(frames) * 2u);
        for (int at = 0; at < frames; at += blockSize) {
          const int n = std::min(blockSize, frames - at);
          for (int i = 0; i < n; ++i) {
            left[static_cast<std::size_t>(i)] = source(at + i, 0, kRate);
            right[static_cast<std::size_t>(i)] = source(at + i, 1, kRate);
          }
          AudioBuffer in(channels, 2, n);
          AudioBuffer out(outChannels, 2, n);
          ProcessContext ctx;
          ctx.inputs = &in;
          ctx.inputCount = 1;
          ctx.outputs = &out;
          ctx.outputCount = 1;
          ctx.frames = n;
          ctx.sampleRate = kRate;
          ctx.playing = true;
          unit.process(ctx);
          for (int i = 0; i < n; ++i) {
            captured.push_back(outLeft[static_cast<std::size_t>(i)]);
            captured.push_back(outRight[static_cast<std::size_t>(i)]);
          }
        }
        return captured;
      },
      kBlockSizes, 3);
}

MW_TEST_MAIN("variable-mu-d1")
