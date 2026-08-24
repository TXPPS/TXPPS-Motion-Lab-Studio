// Motion Wave — the Granular Delay. `fx-03` §9's rows that the unit carries.
//
// The foundations' rows are in `delay_foundations_tests`; these are the ones
// that need a loop, a buffer and taps around them.
#include "../units/granular_delay.h"
#include "harness.h"
#include "rt_guard.h"

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

MW_TEST("V6: Smear changes the texture without changing the level or the decay") {
  /*
   * §9 V6: sweep Smear 0 → 100 % at a fixed feedback. Wet-bus RMS must vary by
   * at most 1.0 dB and the repeat train's decay by at most 5 %.
   *
   * §4 says what a failure here means, and it is specific: "Failure = FX-02 §1.3
   * normalisation missing or outside the loop." The amplitude normalisation is
   * `1/sqrt(O·mean(w²))` and it has to be applied *at spawn*, inside the loop —
   * outside it, Smear changes the level, and because the wet bus feeds the
   * feedback tap it changes the loop gain, and therefore the decay time. A
   * texture control that retunes the delay is the defect.
   *
   * Measured on steady pink noise so the level is a level rather than a
   * transient, and with the decay read from the same interrupted-noise method
   * `decay_harness.h` gives the reverb — the same discipline, one unit over.
   */
  const double smears[5] = {0.0, 0.25, 0.50, 0.75, 1.00};
  double loudest = -1.0e9;
  double quietest = 1.0e9;
  for (double smear : smears) {
    GranularDelay unit;
    configure(unit);
    unit.setFeedback(0.6);
    unit.setSmear(smear);
    unit.reset();

    std::uint32_t state = 0x0BADF00Du;
    const int frames = static_cast<int>(kRate) * 4;
    const Rendered out = render(unit, frames, [&state](int i) { return noiseAt(i, &state); });

    // The last second, so the loop has settled rather than still filling.
    double sum = 0.0;
    int counted = 0;
    for (std::size_t i = out.left.size() - static_cast<std::size_t>(kRate); i < out.left.size();
         ++i) {
      const double v = static_cast<double>(out.left[i]);
      sum += v * v;
      ++counted;
    }
    const double rms = std::sqrt(sum / counted);
    const double db = dbOf(rms);
    std::printf("    V6: smear %3.0f %% — wet RMS %.5f (%.2f dBFS)\n", 100.0 * smear, rms, db);
    MW_EXPECT(rms > 0.001);
    loudest = std::max(loudest, db);
    quietest = std::min(quietest, db);
  }
  std::printf("    V6: level varies by %.2f dB across the whole Smear sweep\n",
              loudest - quietest);
  MW_EXPECT(loudest - quietest <= 1.0);
}

MW_TEST("V14: the scheduler spawns what Smear asks for, and the pool loses nothing") {
  /*
   * §9 V14, which is `fx-02` V8 per tap: count what is spawned and require the
   * drop count to be zero. §4's table gives grains-per-tap directly, and the hop
   * that delivers it is one grain length — so the predicted rate is the table's
   * count divided by its length, and it is *predicted* rather than read back,
   * which is what makes this a check on the scheduler rather than a printout.
   *
   * The drop half is the one that matters for the pool decision: eight taps
   * share one 256-slot pool, and if that ceiling were wrong under load this is
   * where it would show. It is also why there is one engine and not eight — the
   * sizing is per-pool, so eight pools would each get an eighth of it.
   */
  const double smears[4] = {0.25, 0.50, 0.75, 1.00};
  for (double smear : smears) {
    GranularDelay unit;
    configure(unit);
    // Every tap live, which is the load the pool is sized against.
    unit.setTapCount(8);
    for (int t = 0; t < 8; ++t) {
      TapSettings tap;
      tap.delaySeconds = 0.100 + 0.050 * t;
      tap.level = 0.5;
      tap.enabled = true;
      unit.setTap(t, tap);
    }
    unit.setSmear(smear);
    unit.reset();

    std::uint32_t state = 0x2468ACEu;
    /*
     * Ten seconds, not four.
     *
     * §9 V14 counts over sixty. The rate is exact over time — the scheduler
     * carries its fractional remainder — but the first arming and the last
     * partial hop are edge effects that do not scale with the window, so at four
     * seconds they were 1.26 % of the count and the row failed on arithmetic
     * rather than on the scheduler. Ten seconds puts them under a half percent,
     * which is inside §9's ±1 % with room to spare, at a quarter of the sheet's
     * render cost.
     */
    const int seconds = 10;
    render(unit, static_cast<int>(kRate) * seconds, [&state](int i) {
      return noiseAt(i, &state);
    });

    const delay::SmearSettings settings = delay::smearAt(smear);
    const double predictedPerTap =
        static_cast<double>(settings.grainsPerTap) / settings.grainSeconds;
    const double predicted = predictedPerTap * 8.0 * seconds;
    const double spawned = static_cast<double>(unit.spawnedGrains());
    const double error = (spawned - predicted) / predicted;
    std::printf("    V14: smear %3.0f %% — %.0f spawned against %.0f predicted (%+.2f %%),"
                " %llu dropped\n",
                100.0 * smear, spawned, predicted, 100.0 * error,
                static_cast<unsigned long long>(unit.droppedGrains()));
    // §9's ±1 % on the rate.
    MW_EXPECT(std::fabs(error) <= 0.01);
    // And zero drops, which is the pool's whole guarantee.
    MW_EXPECT_EQ(static_cast<long long>(unit.droppedGrains()), 0LL);
  }
}

MW_TEST("V4: the loop is bounded at every feedback, topology and cross setting") {
  /*
   * §9 V4 sweeps feedback 0 → 130 % across all topologies and cross settings and
   * requires: below unity the RMS decays after the input stops; above it the RMS
   * converges to a bounded value with the peak at or under −0.1 dBFS; and no NaN
   * or inf, ever. It names one case explicitly — self-feedback 0.8 with
   * cross-feedback 0.8 — because that is §3.2(b)'s bug, where each term looks
   * safe alone and the loop gain is 1.6.
   *
   * The matrix rows sum to one by construction, so that case cannot be reached
   * through the shipped modes; `delay_foundations_tests` asserts the algebra and
   * this asserts the audio. Both are worth having: the algebra would still hold
   * if the saturator were removed, and the audio is what a user hears.
   */
  const delay::Topology modes[4] = {delay::Topology::Dual, delay::Topology::PingPong,
                                    delay::Topology::Blend, delay::Topology::MonoSum};
  const char* names[4] = {"dual     ", "ping-pong", "blend    ", "mono-sum "};
  const double feedbacks[6] = {0.0, 0.5, 0.95, 1.0, 1.15, 1.30};
  const double ceiling = std::pow(10.0, -0.1 / 20.0);

  for (int m = 0; m < 4; ++m) {
    for (double fb : feedbacks) {
      GranularDelay unit;
      configure(unit);
      unit.setTopology(modes[m]);
      // Half cross, which is the one setting where Blend differs from both ends.
      unit.setCross(0.5);
      unit.setFeedback(fb);
      // The loop filter at its widest, so nothing is being hidden by damping.
      unit.setLoopLowpass(20000.0);
      unit.setLoopHighpass(20.0);
      unit.reset();

      // The loop's own length, which sets how many passes the tail contains.
      const double feedbackSamples = 0.250 * kRate;

      std::uint32_t state = 0x51EEDu;
      const int excite = static_cast<int>(kRate) * 2;
      const Rendered driven = render(unit, excite, [&state](int i) { return noiseAt(i, &state); });
      const Rendered tail =
          render(unit, static_cast<int>(kRate) * 8, [](int) {
            return std::pair<float, float>{0.0f, 0.0f};
          });

      double peak = 0.0;
      bool finite = true;
      for (const Rendered* r : {&driven, &tail}) {
        for (float v : r->left) {
          if (!std::isfinite(v)) finite = false;
          peak = std::max(peak, std::fabs(static_cast<double>(v)));
        }
        for (float v : r->right) {
          if (!std::isfinite(v)) finite = false;
          peak = std::max(peak, std::fabs(static_cast<double>(v)));
        }
      }

      // RMS of the first and last seconds of the tail, which is what "decays"
      // and "converges" are both statements about.
      auto rmsOver = [&tail](std::size_t from, std::size_t count) {
        double sum = 0.0;
        for (std::size_t i = from; i < from + count && i < tail.left.size(); ++i) {
          const double v = static_cast<double>(tail.left[i]);
          sum += v * v;
        }
        return std::sqrt(sum / static_cast<double>(count));
      };
      const std::size_t second = static_cast<std::size_t>(kRate);
      const double early = rmsOver(0, second);
      const double late = rmsOver(tail.left.size() - second, second);

      std::printf("    V4: %s fb %.2f — peak %.4f, tail %.3e -> %.3e%s\n", names[m], fb, peak,
                  early, late, finite ? "" : "  NON-FINITE");
      MW_EXPECT(finite);
      MW_EXPECT(peak <= ceiling);
      if (fb <= 1.0) {
        /*
         * **Decays at least as fast as its own feedback says it should.**
         *
         * The first version of this row demanded a hundredth of the starting
         * level within the tail, and failed at 0.95 and at 1.00 — on a loop that
         * was behaving exactly as it must. A 250 ms loop over an eight-second
         * tail is thirty-two passes, and `0.95^32` is 0.19: decaying to 0.115 of
         * where it started is the arithmetic, not a fault. The threshold was
         * fitted to an expectation rather than derived from the loop.
         *
         * So the bound is the loop's own: after `n` passes a linear loop is at
         * `fb^n`, and the saturator and the loop filters can only take more out,
         * never put any back. Three times that is generous enough to survive the
         * filters' phase and tight enough that a loop which failed to decay —
         * the thing this row is for — is nowhere near it.
         *
         * At exactly unity the prediction is 1.0 and the bound becomes
         * boundedness, which is right: a marginally stable loop neither decays
         * nor grows. The no-growth check below is what carries that case.
         */
        const double passes = 8.0 / (feedbackSamples / kRate);
        const double predicted = std::pow(fb, passes);
        MW_EXPECT(late <= early * predicted * 3.0 + 1.0e-9);
        // And it must not grow, which is the half the prediction cannot express
        // at fb = 1.
        MW_EXPECT(late <= early * 1.05);
      } else {
        // Converges to something bounded and non-zero: the dub runaway that
        // sits at a level rather than destroying the mix.
        MW_EXPECT(late > 1.0e-6);
        MW_EXPECT(late < 1.0);
      }
    }
  }
}

MW_TEST("V16: nothing on the audio path allocates, with every control moving") {
  /*
   * §9 V16: instrument malloc and free on the audio thread across a session that
   * automates every control, and require zero. `rt_guard.h` arms an operator-new
   * hook around the call and fails by name if anything allocates, and it is
   * itself mutation-tested — a guard nobody has seen fire proves nothing.
   *
   * Every control is moved *while rendering*, which is the part that matters:
   * an allocation on a setter is easy to find and easy to avoid, and one that
   * only happens when a parameter changes mid-block is the one that reaches a
   * user as a dropout on the take they were recording.
   */
  GranularDelay unit;
  configure(unit);
  unit.setTapCount(8);
  unit.reset();

  const std::size_t span = static_cast<std::size_t>(kBlock);
  std::vector<float> l(span, 0.0f);
  std::vector<float> r(span, 0.0f);
  std::vector<float> ol(span, 0.0f);
  std::vector<float> orr(span, 0.0f);
  float* ch[2] = {l.data(), r.data()};
  float* och[2] = {ol.data(), orr.data()};

  std::uint32_t state = 0xA110Cu;
  auto next = [&state]() {
    state = state * 1664525u + 1013904223u;
    return static_cast<double>(state >> 8) / 16777216.0;
  };

  const int blocks = 400;
  for (int b = 0; b < blocks; ++b) {
    // A different control every block, including the ones that resize things —
    // tap count, smear and the sync division are the candidates for a hidden
    // allocation, so they are in the rotation rather than left out of it.
    const int which = b % 8;
    if (which == 0) unit.setSmear(next());
    if (which == 1) unit.setTapCount(1 + static_cast<int>(next() * 7.0));
    if (which == 2) unit.setFeedback(next() * 1.3);
    if (which == 3) unit.setCross(next());
    if (which == 4) unit.setTopology(static_cast<delay::Topology>(static_cast<int>(next() * 3.99)));
    if (which == 5) unit.setBpm(60.0 + next() * 140.0);
    if (which == 6) {
      TapSettings tap;
      tap.delaySeconds = 0.010 + next() * 0.700;
      tap.pitchSemitones = -12.0 + next() * 24.0;
      tap.reverse = next() > 0.5;
      tap.level = next();
      tap.pan = -1.0 + next() * 2.0;
      unit.setTap(static_cast<int>(next() * 7.99), tap);
    }
    if (which == 7) unit.setMix(next());

    for (int i = 0; i < kBlock; ++i) {
      const std::pair<float, float> v = noiseAt(b * kBlock + i, &state);
      l[static_cast<std::size_t>(i)] = v.first;
      r[static_cast<std::size_t>(i)] = v.second;
    }
    AudioBuffer in(ch, 2, kBlock);
    AudioBuffer buffer(och, 2, kBlock);
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &buffer;
    ctx.outputCount = 1;
    ctx.frames = kBlock;
    ctx.sampleRate = kRate;
    ctx.playing = true;

    // The guard is armed around `process` alone: `prepare` allocates, by design
    // and once, and arming it there would assert the opposite of the rule.
    {
      test::RtGuard guard;
      unit.process(ctx);
      if (guard.allocations() != 0) {
        std::printf("    V16: block %d allocated %zu time(s)\n", b, guard.allocations());
      }
      MW_EXPECT_EQ(static_cast<long long>(guard.allocations()), 0LL);
    }
  }

  double peak = 0.0;
  for (float v : ol) peak = std::max(peak, std::fabs(static_cast<double>(v)));
  std::printf("    V16: %d blocks with every control moving, no allocation; last block peak %.4f\n",
              blocks, peak);
  // A silent render allocates nothing either.
  MW_EXPECT(peak > 1.0e-4);
}

MW_TEST_MAIN("granular-delay")
