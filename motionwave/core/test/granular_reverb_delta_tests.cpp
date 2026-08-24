// Motion Wave — Ledger cell D1 for the Granular Reverb.
//
// The measured half; the parity half is generated and so cannot be got wrong.
// The sweep, the determinism check and the block-size check are all shared —
// what is here is this unit's base configuration, which is the part that is
// genuinely its own.
//
// **Three things make a D1 base awkward on this unit and each is a way the
// sweep could report a live control as dead.**
//
// The mix sits at 100 %. Every control except Mix and Bypass acts on the wet
// path, and at the default 35 % their travel arrives attenuated and mixed with
// an unchanged dry signal — which does not make a difference vanish, but does
// shrink the smaller ones toward the threshold for no reason that has anything
// to do with the control.
//
// The render is long enough for the loop to matter. Damping, Tilt and Decay do
// nothing on a first arrival: they are in the feedback path, so a render that
// ended before the signal had gone round would report all three as dead. Two
// seconds at a two-second decay is several passes.
//
// The engine is seeded rather than left to itself. A stochastic cloud is
// perfectly deterministic given its seed, and the determinism row is what makes
// the sweep believable — without it a unit whose output depended on something
// other than its parameters would pass every delta while proving nothing.
#include "../units/generated/granular_reverb_params.gen.h"
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
/// Two seconds, which is several passes at the base's two-second decay.
constexpr int kFrames = 96000;

/**
 * Broadband and gated, so both what the cloud reads and what it does with
 * silence are exercised.
 *
 * The bursts matter more here than the spectrum does. A continuously excited
 * reverb hides its tail underneath the input, and several of these controls —
 * Decay, Damping, Tilt, Freeze — are audible mostly in what happens after the
 * input stops.
 *
 * **Nothing here is commensurate with half a second, and the first version of
 * this source was commensurate with all of it.** Partials at 110, 430, 1470,
 * 3900 and 9100 Hz, gated at 2 Hz, all complete a whole number of cycles in
 * 500 ms — which is exactly the top of Pre-delay's range. Delaying a signal by
 * its own period reproduces it, so the sweep measured Pre-delay's full travel
 * at −75 dBFS and reported the control as dead. It is not dead; the excitation
 * was blind to it. The frequencies below share no such relationship with any
 * setting this unit has, which has to be arranged deliberately because the
 * round numbers that read well in a source function are exactly the ones that
 * divide into the round numbers a control's range ends at.
 */
float source(int index, int channel, double rate) {
  const double t = static_cast<double>(index) / rate;
  const double phase = channel == 0 ? 0.0 : 0.7;
  const double partials = 1.0 * std::sin(2.0 * kPi * 113.0 * t + phase) +
                          0.7 * std::sin(2.0 * kPi * 437.0 * t) +
                          0.5 * std::sin(2.0 * kPi * 1471.0 * t + phase) +
                          0.35 * std::sin(2.0 * kPi * 3907.0 * t) +
                          0.25 * std::sin(2.0 * kPi * 9103.0 * t + phase);
  const double gate = std::sin(2.0 * kPi * 1.7 * t) > 0.0 ? 1.0 : 0.0;
  return static_cast<float>(0.12 * gate * partials);
}

/*
 * The buffer is filled before anything is captured, and Size is why.
 *
 * The read window runs out to four seconds. A render that captured from the
 * first sample would have most grains reading a buffer that had not been
 * written yet, so the output at the wide settings is near silence — which trips
 * the sweep's own precondition that a render contain signal before its
 * difference is believed. That precondition is right and the base was wrong:
 * D1 asks whether a control reaches the audio, and it can only ask that from a
 * state where the control has something to act on.
 *
 * The priming runs as its own segment rather than as negative indices in the
 * capture loop, and that is not tidiness. Stepping one loop from −216000 by the
 * block size only lands on zero when the block size divides it: at 64 it does,
 * at 97 it does not, so the capture began at a different sample for each block
 * size and the block-size row failed by 0.31 — on a unit that is block-size
 * independent under every setting tried individually. The test was measuring
 * its own misalignment. Two segments, each clamping to its own end, start the
 * capture at the same sample whatever the host's block size is.
 */
constexpr int kPrimeFrames = 216000;  // 4.5 s, past the widest read window

std::vector<float> renderAt(GranularReverb& unit, int blockSize) {
  const std::size_t span = static_cast<std::size_t>(blockSize);
  std::vector<float> left(span, 0.0f);
  std::vector<float> right(span, 0.0f);
  std::vector<float> outLeft(span, 0.0f);
  std::vector<float> outRight(span, 0.0f);
  float* channels[2] = {left.data(), right.data()};
  float* outChannels[2] = {outLeft.data(), outRight.data()};
  std::vector<float> captured;
  captured.reserve(static_cast<std::size_t>(kFrames) * 2u);
  const int total = kPrimeFrames + kFrames;
  for (int at = 0; at < total;) {
    // Clamp to the priming boundary as well as to the end, so the capture
    // begins at exactly `kPrimeFrames` for every block size.
    const int limit = at < kPrimeFrames ? kPrimeFrames : total;
    const int frames = std::min(blockSize, limit - at);
    for (int i = 0; i < frames; ++i) {
      left[static_cast<std::size_t>(i)] = source(at + i, 0, kRate);
      right[static_cast<std::size_t>(i)] = source(at + i, 1, kRate);
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
    if (at >= kPrimeFrames) {
      for (int i = 0; i < frames; ++i) {
        captured.push_back(outLeft[static_cast<std::size_t>(i)]);
        captured.push_back(outRight[static_cast<std::size_t>(i)]);
      }
    }
    at += frames;
  }
  return captured;
}

void configureBase(GranularReverb& unit, int blockSize) {
  unit.prepare(kRate, blockSize);
  // Fully wet: see the header note. Mix's own sweep still covers 0 to 100.
  unit.setMix(1.0);
  unit.setPreDelaySeconds(0.020);
  unit.setSizeSeconds(0.800);
  unit.setMinOffsetSeconds(0.020);
  unit.setDecaySeconds(2.0);
  unit.setGrainSeconds(0.060);
  unit.setDensity(350.0);
  unit.setDamping(0.45);
  unit.setDiffusion(0.60);
  unit.setTier(grain::Tier::Studio);
  // One seed for every render in this file, so a difference between two of them
  // is the parameter and never the draw.
  unit.setSeed(0x9E3779B97F4A7C15ull);
  unit.reset();
}

std::vector<float> renderWith(int id, double value) {
  GranularReverb unit;
  configureBase(unit, kBlock);
  applyGranularReverbParam(unit, id, value);
  /*
   * Reset *after* the parameter is applied, not before.
   *
   * Several of these settings size something — the read window, the minimum
   * offset, the grain length — and the buffers behind them are allocated in
   * `prepare` and re-primed in `reset`. Applying a size and then rendering
   * without a reset would render the first pass through state that belonged to
   * the previous size, which is a difference the sweep would happily report as
   * the parameter working.
   */
  unit.reset();
  return renderAt(unit, kBlock);
}

/// A power of two, an odd size no host would pick but a plug-in must survive,
/// and one large enough to cross several grain onsets in a single call.
constexpr int kBlockSizes[3] = {64, 97, 1024};

}  // namespace

MW_TEST("D1: every Granular Reverb parameter's setter reaches the audio") {
  test::expectEveryParameterReachesAudio(kGranularReverbParams, kGranularReverbParamCount,
                                         renderWith);
}

MW_TEST("D1: two renders of the same setting are identical") {
  test::expectRendersAreDeterministic(kGranularReverbParams, kGranularReverbParamCount,
                                      renderWith);
}

MW_TEST("D1: the block size the host chooses does not change the audio") {
  test::expectBlockSizeIndependent(
      [](int blockSize) {
        GranularReverb unit;
        configureBase(unit, blockSize);
        unit.setPitchSet(shimmer::Set::Fifth);
        unit.setTiltDb(-3.0);
        unit.reset();
        return renderAt(unit, blockSize);
      },
      kBlockSizes, 3);
}

MW_TEST_MAIN("granular-reverb-d1")
