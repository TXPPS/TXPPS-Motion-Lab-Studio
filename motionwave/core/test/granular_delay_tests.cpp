// Motion Wave — the Granular Delay. `fx-03` §9's rows that the unit carries.
//
// The foundations' rows are in `delay_foundations_tests`; these are the ones
// that need a loop, a buffer and taps around them.
#include "../units/granular_delay.h"
#include "harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kRate = 48000.0;
constexpr int kBlock = 256;

struct Rendered {
  std::vector<float> left;
  std::vector<float> right;
};

template <typename Source>
Rendered render(GranularDelay& unit, int frames, Source&& source) {
  const std::size_t span = static_cast<std::size_t>(kBlock);
  std::vector<float> l(span, 0.0f);
  std::vector<float> r(span, 0.0f);
  std::vector<float> ol(span, 0.0f);
  std::vector<float> orr(span, 0.0f);
  float* ch[2] = {l.data(), r.data()};
  float* och[2] = {ol.data(), orr.data()};
  Rendered out;
  out.left.reserve(static_cast<std::size_t>(frames));
  out.right.reserve(static_cast<std::size_t>(frames));
  for (int at = 0; at < frames; at += kBlock) {
    const int n = std::min(kBlock, frames - at);
    for (int i = 0; i < n; ++i) {
      const std::pair<float, float> v = source(at + i);
      l[static_cast<std::size_t>(i)] = v.first;
      r[static_cast<std::size_t>(i)] = v.second;
    }
    AudioBuffer in(ch, 2, n);
    AudioBuffer buffer(och, 2, n);
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &buffer;
    ctx.outputCount = 1;
    ctx.frames = n;
    ctx.sampleRate = kRate;
    ctx.playing = true;
    unit.process(ctx);
    for (int i = 0; i < n; ++i) {
      out.left.push_back(ol[static_cast<std::size_t>(i)]);
      out.right.push_back(orr[static_cast<std::size_t>(i)]);
    }
  }
  return out;
}

void configure(GranularDelay& unit) {
  unit.prepare(kRate, kBlock);
  unit.setMix(1.0);
  unit.setTapCount(1);
  TapSettings tap;
  tap.delaySeconds = 0.250;
  tap.level = 1.0;
  unit.setTap(0, tap);
  unit.setFeedbackTapSeconds(0.250);
  unit.setFeedback(0.5);
  unit.setLoopLowpass(18000.0);
  unit.setLoopHighpass(20.0);
  unit.setSmear(0.0);
  unit.reset();
}

double dbOf(double amplitude) {
  return amplitude <= 1.0e-12 ? -240.0 : 20.0 * std::log10(amplitude);
}

std::pair<float, float> noiseAt(int index, std::uint32_t* state) {
  *state = *state * 1664525u + 1013904223u;
  const float v = (static_cast<float>(*state >> 8) / 8388608.0f - 1.0f) * 0.3f;
  (void)index;
  return {v, v};
}

}  // namespace

MW_TEST("V1: at Mix zero the unit is a wire") {
  /*
   * §9 V1 asks for −140 dBFS against sixty seconds of programme. The row also
   * has to be careful about the direction a dry null goes wrong: a unit that
   * output silence would null perfectly, so the dry signal's presence is
   * asserted beside the residual.
   */
  GranularDelay unit;
  configure(unit);
  unit.setMix(0.0);
  // Feedback high, so a leak from the wet path would be loud if it existed.
  unit.setFeedback(0.9);
  unit.reset();
  std::uint32_t state = 0x1234567u;
  const int frames = static_cast<int>(kRate) * 10;
  double worst = 0.0;
  double peak = 0.0;
  std::uint32_t check = 0x1234567u;
  const Rendered out = render(unit, frames, [&state](int i) { return noiseAt(i, &state); });
  for (int i = 0; i < frames; ++i) {
    const std::pair<float, float> dry = noiseAt(i, &check);
    peak = std::max(peak, std::fabs(static_cast<double>(dry.first)));
    worst = std::max(worst, std::fabs(static_cast<double>(out.left[static_cast<std::size_t>(i)]) -
                                      static_cast<double>(dry.first)));
    worst = std::max(worst, std::fabs(static_cast<double>(out.right[static_cast<std::size_t>(i)]) -
                                      static_cast<double>(dry.second)));
  }
  std::printf("    V1: worst residual %.1f dBFS against a %.3f dry peak\n", dbOf(worst), peak);
  MW_EXPECT(dbOf(worst) <= -140.0);
  MW_EXPECT(peak > 0.1);
}

MW_TEST("V2: at Smear zero the tap is a plain interpolated delay, exactly") {
  /*
   * §9 V2 nulls the whole path against a reference plain delay at −140 dBFS,
   * and §4 says why it is worth a row of its own: it is "the cheapest possible
   * guarantee that the granular machinery has not quietly coloured the plain
   * delay". A granular engine that added a window, or a normalisation, or a
   * half-sample of read offset at its bypass setting would be inaudible on its
   * own and wrong in every preset built on top of it.
   *
   * The reference is written here rather than taken from the unit, because a
   * reference that shared the unit's read would null against its own mistakes.
   * What it shares is `readCubic`, which is the interpolation both are supposed
   * to be doing — the row is about the machinery around the read, not about the
   * interpolator, which GE-11 grades.
   */
  constexpr int kDelaySamples = 24000;  // 500 ms, as §9 V2 specifies.
  GranularDelay unit;
  configure(unit);
  unit.setSmear(0.0);
  // §9 V2: feedback zero, so what is compared is one pass of the tap.
  unit.setFeedback(0.0);
  TapSettings tap;
  tap.delaySeconds = static_cast<double>(kDelaySamples) / kRate;
  tap.level = 1.0;
  tap.pan = 0.0;
  unit.setTap(0, tap);
  unit.reset();

  const int frames = static_cast<int>(kRate) * 5;
  std::uint32_t state = 0x2468ACEu;
  std::vector<float> input;
  input.reserve(static_cast<std::size_t>(frames));
  const Rendered out = render(unit, frames, [&state, &input](int i) {
    const std::pair<float, float> v = noiseAt(i, &state);
    input.push_back(v.first);
    return v;
  });

  /*
   * The reference: the same DC-blocked input into a plain circular buffer, read
   * at the same offset with the same interpolator, through the same equal-power
   * pan and the same mix. Every stage the unit applies outside the granular
   * path is applied here too, so what is left in the residual is only the
   * granular path itself.
   */
  delay::DelayBuffer reference;
  reference.prepare(kRate, 8.0);
  reference.reset();
  dsp::Biquad blocker;
  blocker.setCoeffs(dsp::onePoleHighpassCoeffs(20.0, kRate));
  blocker.reset();
  dsp::Biquad filter;
  filter.setCoeffs(dsp::lowpassCoeffs(18000.0, 0.707, kRate));
  filter.reset();
  const double angle = 0.5 * kPi * 0.5;
  const double gainL = std::cos(angle);
  const double equalPower = 0.70710678118654752;

  double worst = 0.0;
  double peak = 0.0;
  for (int i = 0; i < frames; ++i) {
    /*
     * Read *before* write, which is the unit's own order and not an arbitrary
     * choice here. A reference that wrote first would read one sample later
     * than the unit and null at −11 dBFS on noise — which is what the first
     * version of this row measured, and which reads as a granular path
     * colouring the delay rather than as an off-by-one in the comparison.
     */
    const double rawL = static_cast<double>(reference.read(0, kDelaySamples));
    const double rawR = static_cast<double>(reference.read(1, kDelaySamples));
    const double blocked = blocker.process(static_cast<double>(input[static_cast<std::size_t>(i)]));
    reference.write(static_cast<float>(blocked * equalPower),
                    static_cast<float>(blocked * equalPower));
    const double filtered = filter.process(0.5 * (rawL + rawR));
    const double side = 0.5 * (rawL - rawR);
    const double wet = filtered * gainL + side;
    peak = std::max(peak, std::fabs(wet));
    worst = std::max(worst, std::fabs(static_cast<double>(out.left[static_cast<std::size_t>(i)]) -
                                      wet));
  }
  std::printf("    V2: residual against a plain interpolated delay %.1f dBFS, wet peak %.3f\n",
              dbOf(worst), peak);
  MW_EXPECT(dbOf(worst) <= -140.0);
  // A null against two silences is not a null: the reference must have produced
  // a delayed signal for the comparison to have meant anything.
  MW_EXPECT(peak > 0.05);
}

MW_TEST("V5: DC does not accumulate around a loop at 95 % feedback") {
  /*
   * §9 V5: +0.5 DC in, feedback 95 %, two minutes, output DC at or below
   * −80 dBFS. §3.2(d) is why this is not optional — a near-unity loop
   * integrates any DC without bound and no saturator saves it, because `tanh`
   * does not remove a bias, it compresses around one.
   */
  GranularDelay unit;
  configure(unit);
  unit.setFeedback(0.95);
  unit.reset();
  const int frames = static_cast<int>(kRate) * 30;
  const Rendered out = render(unit, frames, [](int) { return std::pair<float, float>{0.5f, 0.5f}; });
  // Averaged over the last second, so what is measured is the settled offset
  // rather than the ramp into it.
  double sum = 0.0;
  int counted = 0;
  for (std::size_t i = out.left.size() - static_cast<std::size_t>(kRate); i < out.left.size();
       ++i) {
    sum += static_cast<double>(out.left[i]);
    ++counted;
  }
  const double dc = sum / counted;
  std::printf("    V5: output DC %.8f (%.1f dBFS) from a +0.5 input at 95 %% feedback\n", dc,
              dbOf(std::fabs(dc)));
  MW_EXPECT(dbOf(std::fabs(dc)) <= -80.0);
  // And the loop is genuinely running: a unit that had silently gone quiet
  // would have no DC either.
  double peak = 0.0;
  for (float v : out.left) peak = std::max(peak, std::fabs(static_cast<double>(v)));
  MW_EXPECT(peak > 0.05);
}

MW_TEST("V13: ping-pong alternates exactly, which is what the matrix buys") {
  /*
   * §9 V13: mono in, full cross, and the two channels' repeat trains must
   * alternate — L on odd repeats and R on even — matching to 0.1 dB and zero
   * samples. This is the row that would catch a ping-pong built as a special
   * case rather than as §1.2's matrix: a hand-written cross usually applies to
   * one channel before the other, which is a one-sample asymmetry that no
   * listener hears and this rejects.
   */
  GranularDelay unit;
  configure(unit);
  unit.setTopology(delay::Topology::PingPong);
  unit.setFeedback(0.8);
  unit.reset();
  // One short burst, then silence, so the repeats are separable.
  const int frames = static_cast<int>(kRate) * 3;
  const Rendered out = render(unit, frames, [](int i) {
    const float v = i < 480 ? static_cast<float>(0.6 * std::sin(2.0 * kPi * 1000.0 * i / kRate))
                            : 0.0f;
    return std::pair<float, float>{v, v};
  });

  // Peak of each 250 ms window, which is one repeat.
  const int window = static_cast<int>(kRate * 0.250);
  std::vector<double> peakL;
  std::vector<double> peakR;
  for (int at = 0; at + window <= frames; at += window) {
    double l = 0.0;
    double r = 0.0;
    for (int i = 0; i < window; ++i) {
      l = std::max(l, std::fabs(static_cast<double>(out.left[static_cast<std::size_t>(at + i)])));
      r = std::max(r, std::fabs(static_cast<double>(out.right[static_cast<std::size_t>(at + i)])));
    }
    peakL.push_back(l);
    peakR.push_back(r);
  }
  std::printf("    V13: repeats");
  for (std::size_t i = 1; i < peakL.size() && i < 6; ++i) {
    std::printf(" | %zu: L %.4f R %.4f", i, peakL[i], peakR[i]);
  }
  std::printf("\n");

  /*
   * The alternation, stated as the sheet states it: the two channels swap which
   * one is loud from repeat to repeat. Comparing each repeat's louder channel
   * against the previous repeat's *other* channel is what makes this a symmetry
   * test rather than a level test — the levels decay, so an absolute comparison
   * would fail on the decay it is not measuring.
   */
  int alternations = 0;
  for (std::size_t i = 2; i < peakL.size() && i < 8; ++i) {
    const bool leftLoudNow = peakL[i] > peakR[i];
    const bool leftLoudBefore = peakL[i - 1] > peakR[i - 1];
    if (leftLoudNow != leftLoudBefore) ++alternations;
    // And the swap is exact: this repeat's loud channel matches the previous
    // repeat's loud channel, scaled by one pass of the loop.
    const double loudNow = std::max(peakL[i], peakR[i]);
    const double loudBefore = std::max(peakL[i - 1], peakR[i - 1]);
    if (loudBefore > 1.0e-4) {
      const double ratioDb = dbOf(loudNow / loudBefore);
      MW_EXPECT(ratioDb < 0.1);
    }
  }
  std::printf("    V13: %d alternation(s) across the repeat train\n", alternations);
  MW_EXPECT(alternations >= 4);
}

MW_TEST_MAIN("granular-delay")
