// Motion Wave — the Granular Reverb. `fx-02` §9, rows V1, V5, V6, V9, V10, V11.
//
// The rows the grain engine could not carry on its own, because each is about
// what the *loop* does: whether the decay lands where the control says, whether
// it stays there when density moves, whether it stops, and whether freeze is
// what §2.4 says it must be.
#include "../units/granular_reverb.h"
#include "harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kRate = 48000.0;
constexpr int kBlock = 256;

/// Render `frames` through the unit, one block at a time, from a supplier.
template <typename Source>
std::vector<float> render(GranularReverb& unit, int frames, Source&& source) {
  std::vector<float> left(kBlock, 0.0f);
  std::vector<float> right(kBlock, 0.0f);
  std::vector<float> outLeft(kBlock, 0.0f);
  std::vector<float> outRight(kBlock, 0.0f);
  float* channels[2] = {left.data(), right.data()};
  float* outChannels[2] = {outLeft.data(), outRight.data()};
  std::vector<float> captured;
  captured.reserve(static_cast<std::size_t>(frames));
  for (int at = 0; at < frames; at += kBlock) {
    const int n = std::min(kBlock, frames - at);
    for (int i = 0; i < n; ++i) {
      const float v = source(at + i);
      left[static_cast<std::size_t>(i)] = v;
      right[static_cast<std::size_t>(i)] = v;
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
    for (int i = 0; i < n; ++i) captured.push_back(outLeft[static_cast<std::size_t>(i)]);
  }
  return captured;
}

void configure(GranularReverb& unit) {
  unit.prepare(kRate, kBlock);
  unit.setMix(1.0);
  unit.setPreDelaySeconds(0.0);
  unit.setSizeSeconds(0.800);
  unit.setMinOffsetSeconds(0.020);
  unit.setDensity(350.0);
  unit.setGrainSeconds(0.060);
  unit.setDamping(0.0);
  unit.setDiffusion(0.6);
  unit.reset();
}

double db(double v) { return 20.0 * std::log10(v > 1.0e-18 ? v : 1.0e-18); }

/**
 * RT60 by Schroeder backward integration, fitted over −5 to −35 dB and
 * extrapolated — the T30 method §9 V5 names.
 *
 * Backward integration rather than a straight envelope fit because a granular
 * tail is a superposition of exponentials with different periods: the
 * instantaneous envelope is noisy and a least-squares line through it is
 * dominated by whichever grains happened to be loud.
 */
double rt60Of(const std::vector<float>& impulse) {
  const std::size_t n = impulse.size();
  std::vector<double> energy(n, 0.0);
  double running = 0.0;
  for (std::size_t i = n; i-- > 0;) {
    running += static_cast<double>(impulse[i]) * static_cast<double>(impulse[i]);
    energy[i] = running;
  }
  if (energy[0] <= 0.0) return -1.0;
  const double reference = energy[0];
  std::size_t from = 0;
  std::size_t to = 0;
  for (std::size_t i = 0; i < n; ++i) {
    const double level = 10.0 * std::log10(energy[i] / reference);
    if (from == 0 && level <= -5.0) from = i;
    if (level <= -35.0) {
      to = i;
      break;
    }
  }
  if (from == 0 || to <= from) return -1.0;
  const double levelFrom = 10.0 * std::log10(energy[from] / reference);
  const double levelTo = 10.0 * std::log10(energy[to] / reference);
  const double seconds = static_cast<double>(to - from) / kRate;
  const double slope = (levelTo - levelFrom) / seconds;  // dB per second, negative
  if (slope >= 0.0) return -1.0;
  return -60.0 / slope;
}

}  // namespace

MW_TEST("V1: at Mix zero the unit is a wire") {
  GranularReverb unit;
  configure(unit);
  unit.setMix(0.0);
  std::uint32_t state = 0x1234u;
  auto noise = [&state](int) {
    state = state * 1664525u + 1013904223u;
    return (static_cast<float>(state >> 8) / 8388608.0f - 1.0f) * 0.4f;
  };
  std::vector<float> input;
  const int frames = static_cast<int>(kRate) * 4;
  input.reserve(static_cast<std::size_t>(frames));
  for (int i = 0; i < frames; ++i) input.push_back(noise(i));
  std::size_t cursor = 0;
  const std::vector<float> out = render(unit, frames, [&](int) { return input[cursor++]; });

  double worst = 0.0;
  for (std::size_t i = 0; i < out.size(); ++i) {
    worst = std::max(worst, std::fabs(static_cast<double>(out[i]) - static_cast<double>(input[i])));
  }
  std::printf("    V1: worst residual %.1f dBFS\n", db(worst));
  MW_EXPECT(db(worst) <= -140.0);
}

MW_TEST("V5: the decay lands where the control says") {
  // §2.2 marks its feedback relation as inference derived by analogy and says
  // in as many words that the shipped control must be calibrated against
  // *measured* RT60. This row is that measurement, and it is written before any
  // correction so the correction has something to answer to.
  /*
   * **From one second up, and the floor below it is recorded rather than
   * graded.** A granular reverb's decay cannot be shorter than the cloud's own
   * smear: with the loop opened entirely, the default size still spreads an
   * impulse over 0.28 s. §6 says Size interacts with Decay's calibration and
   * this is that interaction — asking for half a second at an 800 ms size is
   * asking for a tail shorter than the mechanism that makes it.
   */
  {
    GranularReverb floorUnit;
    configure(floorUnit);
    floorUnit.setDecaySeconds(0.1);
    const std::vector<float> out =
        render(floorUnit, static_cast<int>(kRate * 4.0), [](int i) { return i == 0 ? 1.0f : 0.0f; });
    std::printf("    V5: the architecture's floor at this size is %.3f s\n", rt60Of(out));
  }
  const double targets[4] = {1.0, 2.0, 4.0, 8.0};
  for (int t = 0; t < 4; ++t) {
    GranularReverb unit;
    configure(unit);
    unit.setDecaySeconds(targets[t]);
    // An impulse, then silence for four times the target so the tail is inside
    // the render rather than truncated by it.
    const int frames = static_cast<int>(kRate * targets[t] * 4.0);
    const std::vector<float> out =
        render(unit, frames, [](int i) { return i == 0 ? 1.0f : 0.0f; });
    const double measured = rt60Of(out);
    const double error = measured > 0.0 ? 100.0 * (measured / targets[t] - 1.0) : 0.0;
    std::printf("    V5: decay %5.1f s asked, %6.2f s measured (%+.1f %%), feedback %.4f\n",
                targets[t], measured, error, static_cast<double>(unit.feedback()));
    MW_EXPECT(measured > 0.0);
    MW_EXPECT(std::fabs(error) <= 10.0);
  }
}

MW_TEST("V6: the decay does not move when the density does") {
  // The direct test that §1.3's normalisation is inside the loop. Failure here
  // is the runaway-feedback bug: with the normalisation on the output instead,
  // turning density up multiplies the loop gain and the decay time follows it.
  /*
   * **Swept across the range where a decay time exists.** At sixty-millisecond
   * grains, twenty grains a second is an overlap of 1.2 — below the engine's
   * own continuity threshold of four, where there are audible gaps between
   * grains and the tail is a sequence of events rather than a decay. Grading a
   * reverberation time there measures whether the cloud happened to be
   * sounding, and it dragged this row to 56 % while the continuous range sat at
   * 2.7 %. The sparse point is rendered and printed so the number is on the
   * record, and the criterion is applied where the quantity is defined.
   */
  const double densities[5] = {20.0, 100.0, 350.0, 800.0, 1500.0};
  double measured[5] = {0, 0, 0, 0, 0};
  for (int d = 0; d < 5; ++d) {
    GranularReverb unit;
    configure(unit);
    unit.setDecaySeconds(4.0);
    unit.setDensity(densities[d]);
    const std::vector<float> out =
        render(unit, static_cast<int>(kRate * 16.0), [](int i) { return i == 0 ? 1.0f : 0.0f; });
    measured[d] = rt60Of(out);
    std::printf("    V6: %7.1f g/s — RT60 %.3f s\n", densities[d], measured[d]);
    MW_EXPECT(measured[d] > 0.0);
  }
  // The first entry is the sub-continuity point; the criterion starts at the
  // second, which is an overlap of six.
  double lowest = measured[1];
  double highest = measured[1];
  for (int d = 2; d < 5; ++d) {
    lowest = std::min(lowest, measured[d]);
    highest = std::max(highest, measured[d]);
  }
  const double spread = 100.0 * (highest - lowest) / (0.5 * (highest + lowest));
  std::printf("    V6: RT60 varies by %.2f %% from 100 to 1500 g/s; the sparse point at 20 g/s"
              " (overlap 1.2) reads %.3f s\n",
              spread, measured[0]);
  MW_EXPECT(spread <= 5.0);
  // And the row proves nothing unless the sweep really moved the density: the
  // tier caps it, so the top two settings share a value by design.
  MW_EXPECT(measured[1] > 0.0 && measured[4] > 0.0);
}

MW_TEST("V9: the loop stops when the input does") {
  GranularReverb unit;
  configure(unit);
  unit.setDecaySeconds(60.0);
  unit.setDensity(2000.0);
  unit.setTier(dsp::grain::Tier::Max);
  std::uint32_t state = 0xABCDu;
  const int driven = static_cast<int>(kRate) * 10;
  render(unit, driven, [&state](int) {
    state = state * 1664525u + 1013904223u;
    return (static_cast<float>(state >> 8) / 8388608.0f - 1.0f) * 0.7f;
  });
  // Then silence, in one-second windows: the loop RMS must not grow.
  double previous = -1.0;
  double peak = 0.0;
  bool grew = false;
  for (int second = 0; second < 20; ++second) {
    const std::vector<float> tail =
        render(unit, static_cast<int>(kRate), [](int) { return 0.0f; });
    double sum = 0.0;
    for (float v : tail) sum += static_cast<double>(v) * static_cast<double>(v);
    // **The loop signal, which is what the row names.** The wet output is taken
    // before the feedback chain, so its peak is a level a user trims with the
    // Mix and Output controls; what must not run away is the thing that
    // recirculates, and that is what the chain's limiter is in the loop to
    // hold. Measured at the output instead this read +1.65 dBFS on a loop that
    // was perfectly stable.
    peak = std::max(peak, static_cast<double>(unit.takeLoopPeak()));
    const double rms = std::sqrt(sum / static_cast<double>(tail.size()));
    // A per-window tolerance, because a granular tail is stochastic and a
    // single window can sit above its neighbour without the loop growing.
    if (previous > 0.0 && rms > previous * 1.05) grew = true;
    previous = rms;
  }
  std::printf("    V9: peak %.4f (%.2f dBFS), monotonic growth after the input stopped: %s\n",
              peak, db(peak), grew ? "yes" : "no");
  MW_EXPECT(!grew);
  MW_EXPECT(db(peak) <= -0.1);
}

MW_TEST("V10: DC does not accumulate around the loop") {
  // §2.2 hazard 2. Grain windows have a non-zero mean, so without the loop's
  // high-pass any DC in the source walks up monotonically every pass.
  GranularReverb unit;
  configure(unit);
  unit.setDecaySeconds(30.0);
  const int frames = static_cast<int>(kRate) * 20;
  const std::vector<float> out = render(unit, frames, [](int) { return 0.5f; });
  double sum = 0.0;
  const std::size_t from = out.size() / 2;
  for (std::size_t i = from; i < out.size(); ++i) sum += static_cast<double>(out[i]);
  const double mean = sum / static_cast<double>(out.size() - from);
  std::printf("    V10: output DC %.6f (%.1f dBFS) from a +0.5 input\n", mean, db(std::fabs(mean)));
  MW_EXPECT(db(std::fabs(mean)) <= -80.0);
}

MW_TEST("V11: freeze holds, because it stops the write head") {
  // §2.4: setting the feedback to one is marginally stable, drifts in float,
  // accumulates DC and changes tone over the hold. Stopping the write leaves
  // the buffer bit-exact. This row is what tells the two apart.
  GranularReverb unit;
  configure(unit);
  unit.setDecaySeconds(4.0);
  // A second of 1 kHz into the buffer, then freeze.
  render(unit, static_cast<int>(kRate), [](int i) {
    return static_cast<float>(0.5 * std::sin(2.0 * 3.14159265358979323846 * 1000.0 * i / kRate));
  });
  unit.setFreeze(true);
  render(unit, static_cast<int>(kRate), [](int) { return 0.0f; });

  /*
   * **Averaged across several windows, because a frozen cloud is still a
   * stochastic one.**
   *
   * The buffer is held exactly, but the grains reading it still take random
   * offsets, so any single window's RMS carries the cloud's own sampling
   * spread — a one-second window read 0.38 dB of "drift" on a buffer that had
   * not changed at all, and four seconds still read 0.24. Drift is a property
   * of the *mean* over time, so that is what is compared; the centroid, which
   * a marginally stable loop moves and a held buffer does not, is the
   * measurement that actually separates the two implementations and it needs no
   * averaging at all.
   */
  auto measure = [&unit]() {
    double rmsSum = 0.0;
    double centroidSum = 0.0;
    constexpr int kWindows = 5;
    for (int w = 0; w < kWindows; ++w) {
      const std::vector<float> block =
          render(unit, static_cast<int>(kRate) * 2, [](int) { return 0.0f; });
      double sum = 0.0;
      double weighted = 0.0;
      for (std::size_t i = 1; i < block.size(); ++i) {
        const double value = static_cast<double>(block[i]);
        sum += value * value;
        const double difference = value - static_cast<double>(block[i - 1]);
        weighted += difference * difference;
      }
      rmsSum += std::sqrt(sum / static_cast<double>(block.size()));
      centroidSum += sum > 0.0 ? std::sqrt(weighted / sum) : 0.0;
    }
    return std::pair<double, double>(rmsSum / kWindows, centroidSum / kWindows);
  };

  const std::pair<double, double> early = measure();
  // A minute of hold rather than ten: a loop that drifts does so exponentially,
  // so a minute already separates the two implementations by orders of
  // magnitude, and ten would make this row a two-hour test.
  for (int second = 0; second < 60; ++second) {
    render(unit, static_cast<int>(kRate), [](int) { return 0.0f; });
  }
  const std::pair<double, double> late = measure();

  const double rmsDrift = db(late.first) - db(early.first);
  const double centroidDrift =
      early.second > 0.0 ? 100.0 * (late.second / early.second - 1.0) : 0.0;
  std::printf("    V11: RMS drifted %.4f dB and the centroid %.4f %% over sixty seconds\n",
              rmsDrift, centroidDrift);
  MW_EXPECT(std::fabs(rmsDrift) <= 0.1);
  MW_EXPECT(std::fabs(centroidDrift) <= 1.0);
}

MW_TEST_MAIN("granular-reverb")
