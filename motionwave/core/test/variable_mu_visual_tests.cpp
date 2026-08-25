// Motion Wave — Variable-Mu, what the panel is told. Ledger cells U20 and V27.
//
// The storage meter published `stageValue(1)` — the *second* element of the
// timing network. `configureStorage` only builds a second element at time
// constant positions 5 and 6; the other four, the default among them, set
// `count = 1` and never touch that slot. So at four of six settings the panel
// read zero while the unit was compressing sixteen decibels, which is the
// failure X24 exists for arriving through a field that names a stage rather
// than the state.
//
// It carries `value()` now — the highest across the elements actually in
// circuit, which is what the attenuator is handed and therefore the storage the
// recovery comes out of. At positions 5 and 6 that is still the multi-element
// behaviour, because the elements are a chain and the observed recovery is
// wherever the charge happens to be.
//
// The discriminator is the first case: position 1, where there is exactly one
// element. Wire the field back to any fixed stage above the first and it reads
// zero there and nothing else in this file would notice.
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
constexpr int kBlock = 256;

/// A unit biased so the valve is working: input up, threshold well down.
void working(VariableMu& unit, int timeConstant) {
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  for (int c = 0; c < 2; ++c) {
    unit.setInputAttenuationDb(c, 12.0);
    unit.setThreshold(c, 3.0);
    unit.setTimeConstant(c, timeConstant);
  }
}

VariableMuFrame renderTone(VariableMu& unit, double hz, double amplitude, double seconds) {
  const int blocks = static_cast<int>(seconds * kRate / kBlock);
  const double step = 2.0 * kPi * hz / kRate;
  std::vector<float> left(kBlock, 0.0f);
  std::vector<float> right(kBlock, 0.0f);
  std::vector<float> outLeft(kBlock, 0.0f);
  std::vector<float> outRight(kBlock, 0.0f);
  float* in[2] = {left.data(), right.data()};
  float* out[2] = {outLeft.data(), outRight.data()};
  AudioBuffer inBuffer(in, 2, kBlock);
  AudioBuffer outBuffer(out, 2, kBlock);

  long long n = 0;
  VariableMuFrame frame;
  for (int b = 0; b < blocks; ++b) {
    for (int i = 0; i < kBlock; ++i, ++n) {
      const float s = static_cast<float>(amplitude * std::sin(step * static_cast<double>(n)));
      left[static_cast<std::size_t>(i)] = s;
      right[static_cast<std::size_t>(i)] = s;
    }
    ProcessContext ctx;
    ctx.inputs = &inBuffer;
    ctx.inputCount = 1;
    ctx.outputs = &outBuffer;
    ctx.outputCount = 1;
    ctx.frames = kBlock;
    ctx.sampleRate = kRate;
    unit.process(ctx);
  }
  unit.visual().read(frame);
  return frame;
}

}  // namespace

MW_TEST("dyn-04 V27: the storage reads at a time constant with one element") {
  // The case the old field failed, and the reason it failed silently: every
  // other row in this suite either uses a multi-element position or measures
  // the audio rather than the frame.
  VariableMu unit;
  working(unit, 1);
  const VariableMuFrame frame = renderTone(unit, 220.0, 0.5, 0.5);
  std::printf("    V27: position 1 — reduction %.3f dB, storage %.5f\n",
              static_cast<double>(frame.gainReductionDb[0]),
              static_cast<double>(frame.storage[0]));
  MW_EXPECT(frame.gainReductionDb[0] > 3.0f);
  MW_EXPECT(frame.storage[0] > 0.0f);
}

MW_TEST("dyn-04 V27: every time constant publishes a live storage") {
  // All six, because "works at the default" is what the old field looked like
  // it did from the two positions anybody happened to test.
  for (int position = 1; position <= 6; ++position) {
    VariableMu unit;
    working(unit, position);
    const VariableMuFrame frame = renderTone(unit, 220.0, 0.5, 0.5);
    std::printf("    V27: position %d — reduction %.3f dB, storage %.5f\n", position,
                static_cast<double>(frame.gainReductionDb[0]),
                static_cast<double>(frame.storage[0]));
    MW_EXPECT(frame.storage[0] > 0.0f);
  }
}

MW_TEST("dyn-04 V27: the storage grows with the signal it is storing") {
  // A field pinned to a constant would pass everything above. This is what says
  // the number is a measurement rather than a placeholder.
  VariableMu quiet;
  VariableMu loud;
  working(quiet, 1);
  working(loud, 1);
  const VariableMuFrame low = renderTone(quiet, 220.0, 0.05, 0.5);
  const VariableMuFrame high = renderTone(loud, 220.0, 0.5, 0.5);
  std::printf("    V27: storage %.5f quiet, %.5f loud\n", static_cast<double>(low.storage[0]),
              static_cast<double>(high.storage[0]));
  MW_EXPECT(high.storage[0] > low.storage[0] * 1.5f);
}

MW_TEST("dyn-04 V27: the storage falls when the signal stops") {
  // The valve's memory is the whole of this unit's character, so it must not
  // clear instantly — but it must not hold either, or the panel is a face
  // animating on nothing once the music ends.
  VariableMu unit;
  working(unit, 1);
  const VariableMuFrame driven = renderTone(unit, 220.0, 0.5, 0.5);
  const VariableMuFrame quiet = renderTone(unit, 220.0, 0.0, 1.0);
  std::printf("    V27: driven %.5f, after a second of silence %.6f\n",
              static_cast<double>(driven.storage[0]), static_cast<double>(quiet.storage[0]));
  MW_EXPECT(driven.storage[0] > 0.0f);
  MW_EXPECT(quiet.storage[0] < driven.storage[0] * 0.5f);
}

MW_TEST_MAIN("variable-mu-visual")
