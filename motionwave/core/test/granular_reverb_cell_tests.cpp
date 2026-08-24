// Motion Wave — the Granular Reverb's remaining DSP ledger cells.
//
// D1, D3 and D7 are measured elsewhere: D1 in `granular_reverb_delta_tests`,
// D3 by `fx-02` §9's rows in `granular_reverb_tests`, and D7 by the block-size
// rows in both. D2 and D11 are judged from the manifest by the UI harness,
// because a range and a preset round-trip are properties of the declaration
// rather than of the render. What is here is the rest.
#include "../units/generated/granular_reverb_params.gen.h"
#include "../units/granular_reverb.h"
#include "harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr int kBlock = 256;

/// Content across the band, so a rate change has something to be wrong about at
/// the top as well as the bottom.
float source(int index, double rate) {
  const double t = static_cast<double>(index) / rate;
  return static_cast<float>(0.2 * (std::sin(2.0 * kPi * 131.0 * t) +
                                   0.6 * std::sin(2.0 * kPi * 1103.0 * t) +
                                   0.3 * std::sin(2.0 * kPi * 7013.0 * t)));
}

struct Rendered {
  std::vector<float> left;
  std::vector<float> right;
};

Rendered render(GranularReverb& unit, int frames, double rate, int blockSize) {
  const std::size_t span = static_cast<std::size_t>(blockSize);
  std::vector<float> l(span, 0.0f);
  std::vector<float> r(span, 0.0f);
  std::vector<float> ol(span, 0.0f);
  std::vector<float> orr(span, 0.0f);
  float* ch[2] = {l.data(), r.data()};
  float* och[2] = {ol.data(), orr.data()};
  Rendered out;
  out.left.reserve(static_cast<std::size_t>(frames));
  out.right.reserve(static_cast<std::size_t>(frames));
  for (int at = 0; at < frames; at += blockSize) {
    const int n = std::min(blockSize, frames - at);
    for (int i = 0; i < n; ++i) {
      const float v = source(at + i, rate);
      l[static_cast<std::size_t>(i)] = v;
      r[static_cast<std::size_t>(i)] = v;
    }
    AudioBuffer in(ch, 2, n);
    AudioBuffer buffer(och, 2, n);
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &buffer;
    ctx.outputCount = 1;
    ctx.frames = n;
    ctx.sampleRate = rate;
    ctx.playing = true;
    unit.process(ctx);
    for (int i = 0; i < n; ++i) {
      out.left.push_back(ol[static_cast<std::size_t>(i)]);
      out.right.push_back(orr[static_cast<std::size_t>(i)]);
    }
  }
  return out;
}

void configure(GranularReverb& unit, double rate, int blockSize) {
  unit.prepare(rate, blockSize);
  unit.setMix(1.0);
  unit.setPreDelaySeconds(0.0);
  unit.setSizeSeconds(0.800);
  unit.setMinOffsetSeconds(0.020);
  unit.setDecaySeconds(2.0);
  unit.setGrainSeconds(0.060);
  unit.setDensity(350.0);
  unit.setDamping(0.45);
  unit.setDiffusion(0.60);
  unit.setSeed(0x9E3779B97F4A7C15ull);
  unit.reset();
}

double dbOf(double amplitude) {
  return amplitude <= 1.0e-12 ? -240.0 : 20.0 * std::log10(amplitude);
}

}  // namespace

MW_TEST("D4: bypassed, the unit is a wire") {
  /*
   * The ledger's threshold is −120 dBFS, and this unit can be held far better
   * than that because bypass here is not a crossfade to a parallel path — the
   * wet bus is simply not summed. What the row has to be careful about is the
   * *other* direction: X24 found four units publishing zeros from their meters
   * while bypassed, so a bypass that nulled by going silent would pass a
   * carelessly written version of this and be badly wrong.
   */
  constexpr double kRate = 48000.0;
  constexpr int kFrames = 96000;
  GranularReverb unit;
  configure(unit, kRate, kBlock);
  unit.setBypass(true);
  const Rendered out = render(unit, kFrames, kRate, kBlock);

  double worst = 0.0;
  double peak = 0.0;
  for (int i = 0; i < kFrames; ++i) {
    const std::size_t at = static_cast<std::size_t>(i);
    const double dry = static_cast<double>(source(i, kRate));
    peak = std::max(peak, std::fabs(dry));
    worst = std::max(worst, std::fabs(static_cast<double>(out.left[at]) - dry));
    worst = std::max(worst, std::fabs(static_cast<double>(out.right[at]) - dry));
  }
  std::printf("    D4: bypassed residual %.1f dBFS against a %.3f peak\n", dbOf(worst), peak);
  MW_EXPECT(dbOf(worst) <= -120.0);
  // A null against silence is not a null. This is the guard the four units X24
  // caught would have needed.
  MW_EXPECT(peak > 0.1);
}

MW_TEST("D6: every supported rate, and the decay is in seconds at each") {
  /*
   * The ledger asks for 44.1 through 192 kHz. What can go wrong is not that a
   * unit refuses a rate — it is that something inside it is written in samples
   * where it should be in seconds, which shows as a decay half as long at twice
   * the rate. So the row measures the *time*, at every rate, rather than only
   * checking that the render came out finite.
   */
  const double rates[5] = {44100.0, 48000.0, 88200.0, 96000.0, 192000.0};
  double slowest = 0.0;
  double fastest = 1.0e9;
  for (double rate : rates) {
    GranularReverb unit;
    configure(unit, rate, kBlock);
    unit.setDecaySeconds(2.0);
    render(unit, static_cast<int>(rate * 2.0), rate, kBlock);

    // Three seconds: the 20 dB point lands near 1.1 s at every rate, so this is
    // ample, and at 192 kHz every extra second is 192 000 samples in a debug build.
    const int tailFrames = static_cast<int>(rate * 3.0);
    const std::size_t span = static_cast<std::size_t>(kBlock);
    std::vector<float> l(span, 0.0f);
    std::vector<float> r(span, 0.0f);
    std::vector<float> ol(span, 0.0f);
    std::vector<float> orr(span, 0.0f);
    float* ch[2] = {l.data(), r.data()};
    float* och[2] = {ol.data(), orr.data()};
    const int window = static_cast<int>(rate * 0.050);
    double start = 0.0;
    double crossed = -1.0;
    double sum = 0.0;
    int counted = 0;
    for (int at = 0; at < tailFrames; at += kBlock) {
      const int n = std::min(kBlock, tailFrames - at);
      AudioBuffer in(ch, 2, n);
      AudioBuffer buffer(och, 2, n);
      ProcessContext ctx;
      ctx.inputs = &in;
      ctx.inputCount = 1;
      ctx.outputs = &buffer;
      ctx.outputCount = 1;
      ctx.frames = n;
      ctx.sampleRate = rate;
      ctx.playing = true;
      unit.process(ctx);
      for (int i = 0; i < n; ++i) {
        const double v = static_cast<double>(ol[static_cast<std::size_t>(i)]);
        sum += v * v;
        if (++counted < window) continue;
        const double level = std::sqrt(sum / counted);
        sum = 0.0;
        counted = 0;
        if (start <= 0.0) {
          start = level;
          continue;
        }
        if (crossed < 0.0 && level > 0.0 && dbOf(level / start) <= -20.0) {
          crossed = static_cast<double>(at + i) / rate;
        }
      }
    }
    std::printf("    D6: %8.1f Hz — 20 dB of decay in %.3f s\n", rate, crossed);
    MW_EXPECT(crossed > 0.0);
    slowest = std::max(slowest, crossed);
    fastest = std::min(fastest, crossed);
  }
  /*
   * A loop written in samples rather than seconds would be off by the ratio of
   * the rates, which is 4.35 across this set — so the failure this row exists
   * for is a factor, not a margin. What is left is the cloud's own spread,
   * because the grain series is not the same series at two rates.
   */
  std::printf("    D6: spread across a 4.35:1 range of rates is %.1f %%\n",
              100.0 * (slowest - fastest) / fastest);
  MW_EXPECT((slowest - fastest) / fastest <= 0.15);
}

MW_TEST("D8: the declared latency is zero, and zero is what it delays by") {
  /*
   * The unit declares zero and the declaration has to be earned. There is no
   * rate change and no lookahead — §3.1's point is that a granular shifter needs
   * neither — so the dry path must arrive unshifted. Measured at Mix zero, where
   * the output *is* the dry path.
   */
  constexpr double kRate = 48000.0;
  constexpr int kFrames = 4096;
  GranularReverb unit;
  configure(unit, kRate, kBlock);
  unit.setMix(0.0);
  const Rendered out = render(unit, kFrames, kRate, kBlock);
  double worst = 0.0;
  for (int i = 0; i < kFrames; ++i) {
    worst = std::max(worst, std::fabs(static_cast<double>(out.left[static_cast<std::size_t>(i)]) -
                                      static_cast<double>(source(i, kRate))));
  }
  std::printf("    D8: dry-path residual at zero declared latency: %.1f dBFS\n", dbOf(worst));
  MW_EXPECT(dbOf(worst) <= -120.0);
}

MW_TEST("D9: no combination of parameters produces a non-finite sample") {
  /*
   * Every control driven to random points of its own declared range, in
   * combination. The generated table is what makes this exhaustive rather than a
   * list somebody maintained: a control added to the manifest is fuzzed by this
   * row without anyone remembering to add it. The ranges come from the specs, so
   * every value this row sets is a value the UI can send.
   */
  constexpr double kRate = 48000.0;
  std::uint32_t state = 0xC0FFEEu;
  auto next = [&state]() {
    state = state * 1664525u + 1013904223u;
    return static_cast<double>(state >> 8) / 16777216.0;
  };
  long long checked = 0;
  for (int trial = 0; trial < 48; ++trial) {
    GranularReverb unit;
    unit.prepare(kRate, kBlock);
    for (int i = 0; i < kGranularReverbParamCount; ++i) {
      const GranularReverbParamRow& row = kGranularReverbParams[i];
      applyGranularReverbParam(unit, row.id,
                               row.min + next() * (row.max - row.min));
    }
    unit.reset();
    /*
     * Four thousand frames per trial rather than twelve. What this row covers is
     * *combinations*, and a setting that produces a non-finite sample does so
     * within a few blocks — a longer render buys duration, not coverage, and the
     * trial count is what buys coverage. Forty-eight trials are kept.
     */
    const Rendered out = render(unit, 4000, kRate, kBlock);
    for (float v : out.left) {
      MW_EXPECT(std::isfinite(v));
      ++checked;
    }
    for (float v : out.right) MW_EXPECT(std::isfinite(v));
  }
  std::printf("    D9: 48 random settings of %d parameters, %lld samples all finite\n",
              kGranularReverbParamCount, checked);
  MW_EXPECT(checked > 0);
}

MW_TEST("D10: a parameter moved under automation does not step") {
  /*
   * The zipper cell. A control changed between blocks that reaches a coefficient
   * directly puts a discontinuity at every block boundary, and on a reverb the
   * audible one is Mix, because it scales the whole wet bus — a stepped Mix is a
   * click at 187 Hz on a 256-sample buffer.
   *
   * What is measured is the largest sample-to-sample step, against the same
   * render with the control held still. A moving control legitimately changes
   * the signal; what it may not do is change it faster than the signal itself
   * moves.
   */
  constexpr double kRate = 48000.0;
  constexpr int kFrames = 48000;
  auto worstStepOf = [](bool automate) {
    GranularReverb unit;
    configure(unit, kRate, kBlock);
    const std::size_t span = static_cast<std::size_t>(kBlock);
    std::vector<float> l(span, 0.0f);
    std::vector<float> r(span, 0.0f);
    std::vector<float> ol(span, 0.0f);
    std::vector<float> orr(span, 0.0f);
    float* ch[2] = {l.data(), r.data()};
    float* och[2] = {ol.data(), orr.data()};
    double worst = 0.0;
    float previous = 0.0f;
    for (int at = 0; at < kFrames; at += kBlock) {
      const int n = std::min(kBlock, kFrames - at);
      if (automate) {
        // One step per block, which is how a host delivers automation.
        const double through = static_cast<double>(at) / static_cast<double>(kFrames);
        applyGranularReverbParam(unit, static_cast<int>(GranularReverbParam::Mix),
                                 100.0 * through);
      }
      for (int i = 0; i < n; ++i) {
        const float v = source(at + i, kRate);
        l[static_cast<std::size_t>(i)] = v;
        r[static_cast<std::size_t>(i)] = v;
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
        const float now = ol[static_cast<std::size_t>(i)];
        if (at + i > 0) worst = std::max(worst, std::fabs(static_cast<double>(now - previous)));
        previous = now;
      }
    }
    return worst;
  };
  const double still = worstStepOf(false);
  const double moving = worstStepOf(true);
  std::printf("    D10: worst sample-to-sample step %.5f held, %.5f under automation\n", still,
              moving);
  // A per-block jump in a gain that scales the whole wet bus shows up here as a
  // multiple, not a margin.
  MW_EXPECT(moving <= still * 1.25 + 1.0e-4);
  // And the row proves nothing if nothing was rendered.
  MW_EXPECT(still > 1.0e-4);
}

MW_TEST("D12: a synced pre-delay is a musical value, and follows the tempo") {
  /*
   * §6 lists a sync-to-tempo option for Pre-delay, and the ledger's D12 is what
   * holds it to the tempo rather than to a number that happened to be right at
   * 120 bpm. So the row measures the *delay itself*, at two tempos, by finding
   * where an impulse arrives — a quarter note is 0.500 s at 120 and 0.750 s at
   * 80, and a control that resolved once and cached would give the same answer
   * twice.
   *
   * Measured on the dry-plus-wet output with the cloud made as close to a plain
   * delay as its controls allow: one grain at a time, no spray, no jitter. The
   * pre-delay is ahead of the buffer, so what is being timed is when the input
   * first *reaches* the cloud, and a cloud with many overlapping randomised
   * grains smears that arrival across a window wider than the difference being
   * measured.
   */
  constexpr double kRate = 48000.0;
  auto firstArrival = [](double bpm, double quarters) {
    GranularReverb unit;
    unit.prepare(kRate, kBlock);
    unit.setMix(1.0);
    unit.setSizeSeconds(0.020);
    unit.setMinOffsetSeconds(0.005);
    unit.setGrainSeconds(0.005);
    unit.setDensity(2000.0);
    unit.setDecaySeconds(0.5);
    unit.setDamping(0.0);
    unit.setDiffusion(0.0);
    unit.setSpray(0.0);
    unit.setOnsetJitter(0.0);
    unit.setLengthJitter(0.0);
    unit.setAmpJitter(0.0);
    unit.setBpm(bpm);
    unit.setPreDelayQuarters(quarters);
    unit.reset();

    const int frames = static_cast<int>(kRate * 2.0);
    const std::size_t span = static_cast<std::size_t>(kBlock);
    std::vector<float> l(span, 0.0f);
    std::vector<float> r(span, 0.0f);
    std::vector<float> ol(span, 0.0f);
    std::vector<float> orr(span, 0.0f);
    float* ch[2] = {l.data(), r.data()};
    float* och[2] = {ol.data(), orr.data()};
    double arrival = -1.0;
    for (int at = 0; at < frames && arrival < 0.0; at += kBlock) {
      const int n = std::min(kBlock, frames - at);
      for (int i = 0; i < n; ++i) {
        // A short burst rather than one sample, so a grain has something to
        // catch however its window happens to land.
        const float v = (at + i) < 240 ? 0.8f : 0.0f;
        l[static_cast<std::size_t>(i)] = v;
        r[static_cast<std::size_t>(i)] = v;
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
        if (std::fabs(static_cast<double>(ol[static_cast<std::size_t>(i)])) > 0.02) {
          arrival = static_cast<double>(at + i) / kRate;
          break;
        }
      }
    }
    return arrival;
  };

  const double atOneTwenty = firstArrival(120.0, 1.0);
  const double atEighty = firstArrival(80.0, 1.0);
  const double halfAtOneTwenty = firstArrival(120.0, 0.5);
  std::printf("    D12: a quarter arrives at %.3f s at 120 bpm, %.3f s at 80,"
              " and an eighth at %.3f s at 120\n",
              atOneTwenty, atEighty, halfAtOneTwenty);
  MW_EXPECT(atOneTwenty > 0.0 && atEighty > 0.0 && halfAtOneTwenty > 0.0);
  // A quarter is 60/bpm seconds. The tolerance is the minimum read offset plus
  // a grain, which is what stands between the write and the first read.
  MW_EXPECT(std::fabs(atOneTwenty - 0.500) <= 0.030);
  MW_EXPECT(std::fabs(atEighty - 0.750) <= 0.030);
  MW_EXPECT(std::fabs(halfAtOneTwenty - 0.250) <= 0.030);
  // And a control that had cached its resolution would return the same number
  // at both tempos, which is the failure this row exists for.
  MW_EXPECT(atEighty - atOneTwenty > 0.15);
}

MW_TEST("D12: sync off leaves the pre-delay in milliseconds") {
  /*
   * The other half, and the one a sync control breaks most easily: adding a
   * musical mode must not quietly capture the millisecond mode. With sync at
   * zero the tempo may change by any amount and the delay may not move.
   */
  constexpr double kRate = 48000.0;
  auto renderAt = [](double bpm) {
    GranularReverb unit;
    configure(unit, kRate, kBlock);
    unit.setPreDelaySeconds(0.100);
    unit.setPreDelayQuarters(0.0);
    unit.setBpm(bpm);
    unit.reset();
    return render(unit, 24000, kRate, kBlock);
  };
  const Rendered slow = renderAt(60.0);
  const Rendered fast = renderAt(180.0);
  double worst = 0.0;
  for (std::size_t i = 0; i < slow.left.size() && i < fast.left.size(); ++i) {
    worst = std::max(worst, std::fabs(static_cast<double>(slow.left[i] - fast.left[i])));
  }
  double peak = 0.0;
  for (float v : slow.left) peak = std::max(peak, std::fabs(static_cast<double>(v)));
  std::printf("    D12: with sync off, tripling the tempo moves the output by %.1f dBFS\n",
              dbOf(worst));
  MW_EXPECT(dbOf(worst) <= -240.0);
  // Against a render that had something in it.
  MW_EXPECT(peak > 0.05);
}

MW_TEST_MAIN("granular-reverb-cells")
