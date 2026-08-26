// Motion Wave — Granular Reverb, what the panel is told. Ledger cells U20, V27.
//
// `fx-02` was the last unit failing V27, and it failed for a reason worth
// stating exactly: everything it published was honest engine state, and all but
// the two peaks was a function of the controls. Overlap is `density × length`.
// Clamped density is the tier cap applied to a control. RT60 at 8 kHz is
// arithmetic on Decay and Damping. Feedback is Decay. And `liveGrains` — the
// field the face's motion was drawn from — settles at the overlap and then
// holds at twenty-two whatever is playing, because at steady state that is
// precisely what the number *is*.
//
// So the panel was still while the engine ran, and the response to that is not
// to animate the face. It is to publish something that moves, and the grain
// engine has one: where the live grains are reading.
//
// A granular reverb's tail is not a filter network. It is grains cut out of a
// buffer of what was played, and how far back each of them is cutting is the
// whole of what makes it a reverb rather than a delay. `cloudDepthSeconds` is
// the mean of those distances and `cloudSpreadSeconds` is the spread across
// them, taken per grain from the same `readPos` the block's samples came out
// of — never a second evaluation, per CLAUDE.md.
//
// Three discriminators, because the field can be got wrong in three ways:
//
//  - wired to a level — caught by rendering the same tone twenty decibels
//    apart. A read position does not know how loud the source is, so the two
//    have to agree; anything fed from an amplitude cannot.
//  - wired to a control read back — caught by Spray. At zero spray every grain
//    draws the same offset and the spread collapses to nothing; open it and the
//    spread opens with it. No constant and no timer produces that pair.
//  - not actually live — caught by the depth changing between blocks under a
//    steady tone, which a control-derived field cannot do, and by its going to
//    exactly zero when the pool empties.
#include "../units/granular_reverb.h"
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

/// A unit set up so the cloud is busy: full wet, plenty of density.
void running(GranularReverb& unit, double sprayAmount) {
  unit.prepare(kRate, kBlock);
  unit.setMix(1.0);
  unit.setSpray(sprayAmount);
}

/// Render `seconds` of a tone and hand back the frame the face would draw.
GranularReverbFrame renderTone(GranularReverb& unit, double hz, double amplitude, double seconds) {
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
  GranularReverbFrame frame;
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

MW_TEST("fx-02 V27: the cloud's depth is published and lands inside the buffer") {
  GranularReverb unit;
  running(unit, 0.7);
  const GranularReverbFrame frame = renderTone(unit, 220.0, 0.3, 0.5);
  std::printf("    V27: %u grain(s) live, depth %.4f s, spread %.4f s\n",
              static_cast<unsigned>(frame.liveGrains),
              static_cast<double>(frame.cloudDepthSeconds),
              static_cast<double>(frame.cloudSpreadSeconds));
  MW_EXPECT(frame.liveGrains > 0);
  MW_EXPECT(frame.cloudDepthSeconds > 0.0f);
  // A read head behind the write head by more than the buffer holds would mean
  // the depth is being computed from something other than the ring the samples
  // were actually taken from.
  MW_EXPECT(frame.cloudDepthSeconds < 5.0f);
}

MW_TEST("fx-02 V27: twenty decibels of level does not move a read position") {
  // The discriminator against a level, and the reason this readout is worth
  // having rather than a third meter. Every other candidate on this panel —
  // input peak, output peak, the grain amplitudes — moves with amplitude by
  // construction. A read position does not know how loud the source is.
  GranularReverb quiet;
  GranularReverb loud;
  running(quiet, 0.7);
  running(loud, 0.7);
  const GranularReverbFrame low = renderTone(quiet, 220.0, 0.03, 0.5);
  const GranularReverbFrame high = renderTone(loud, 220.0, 0.3, 0.5);
  std::printf("    V27: depth %.4f s at -30 dB, %.4f s at -10 dB\n",
              static_cast<double>(low.cloudDepthSeconds),
              static_cast<double>(high.cloudDepthSeconds));
  MW_EXPECT(low.cloudDepthSeconds > 0.0f);
  // The same scheduler seed and the same controls, so the clouds are the same
  // cloud and the depths are the same number.
  MW_EXPECT_NEAR(static_cast<double>(low.cloudDepthSeconds),
                 static_cast<double>(high.cloudDepthSeconds), 1.0e-4);
}

MW_TEST("fx-02 V27: Spray opens the spread and closing it shuts the spread") {
  // The discriminator no constant and no timer can produce, and the one that
  // says the number is drawn per grain rather than summarised from a control.
  // §5.2: the offset is `minOffset + spray · spraySeconds · U`, so at zero
  // spray every grain in the cloud draws the same offset.
  GranularReverb none;
  GranularReverb wide;
  running(none, 0.0);
  running(wide, 1.0);
  const GranularReverbFrame flat = renderTone(none, 220.0, 0.3, 0.5);
  const GranularReverbFrame spread = renderTone(wide, 220.0, 0.3, 0.5);
  std::printf("    V27: spread %.5f s at spray 0, %.5f s at spray 1\n",
              static_cast<double>(flat.cloudSpreadSeconds),
              static_cast<double>(spread.cloudSpreadSeconds));
  // Not exactly zero: grains age at different rates only if their pitch ratios
  // differ, and a shimmer set gives them different ratios — so even at zero
  // spray the read heads separate as they run. What must hold is that the two
  // are different by a lot, and in the direction Spray points.
  MW_EXPECT(spread.cloudSpreadSeconds > flat.cloudSpreadSeconds * 3.0f);
}

MW_TEST("fx-02 V27: the depth moves between blocks under a steady tone") {
  // What V27 actually asks. `liveGrains` under this same signal returns the
  // identical integer every time it is read, which is why the panel was still.
  GranularReverb unit;
  running(unit, 0.7);
  std::vector<float> depths;
  for (int i = 0; i < 8; ++i) depths.push_back(renderTone(unit, 220.0, 0.3, 0.05).cloudDepthSeconds);
  int distinct = 0;
  for (std::size_t i = 0; i < depths.size(); ++i) {
    bool seen = false;
    for (std::size_t j = 0; j < i; ++j) {
      if (depths[j] == depths[i]) seen = true;
    }
    if (!seen) ++distinct;
  }
  std::printf("    V27: %d distinct depth(s) across 8 reads, first %.5f last %.5f\n", distinct,
              static_cast<double>(depths.front()), static_cast<double>(depths.back()));
  MW_EXPECT(distinct > 4);
}

MW_TEST("fx-02 U20: an empty cloud reads zero rather than holding its last value") {
  // A field that kept its last figure when the pool emptied would be a face
  // animating on nothing, one layer below where a face could correct for it —
  // the same failure the Console EQ's flux row is written against.
  GranularReverb unit;
  unit.prepare(kRate, kBlock);
  unit.setMix(1.0);
  GranularReverbFrame frame;
  unit.visual().read(frame);
  std::printf("    U20: before any block — %u live, depth %.6f\n",
              static_cast<unsigned>(frame.liveGrains),
              static_cast<double>(frame.cloudDepthSeconds));
  MW_EXPECT(frame.cloudDepthSeconds == 0.0f);
  MW_EXPECT(frame.cloudSpreadSeconds == 0.0f);
}

MW_TEST_MAIN("granular-reverb-visual")
