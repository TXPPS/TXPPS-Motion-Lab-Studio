// Motion Wave — the Variable-Mu Limiter's curve and harmonic profile.
// `dyn-04` §9 rows 6, 7, 9, 10, 11 and 15.
//
// §5's implementer rule is the reason this suite exists in the shape it does:
// model the transconductance law and let the ratio, the knee and the distortion
// all emerge from it, because a ratio parameter with a knee parameter beside it
// cannot reproduce the three at once. Every row here therefore measures a
// consequence rather than a setting — there is no ratio control to read back.
//
// The slopes are read from the *applied gain* rather than from the output
// level. That is not a shortcut: this unit's distortion rises with reduction by
// design, so at 20 dB of reduction a level measurement is reading harmonics as
// much as fundamental, and the FET Limiter's transfer curve measured 2.6:1,
// 9.8:1 and −4.5:1 from three defensible readings of the same render before it
// was read from the gain.
#include "../dsp/fft.h"
#include "../units/variable_mu.h"
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
constexpr int kBlock = 128;
constexpr std::size_t kN = 16384;
constexpr double kBinHz = kRate / static_cast<double>(kN);

struct Rendered {
  std::vector<float> samples;
  double reduction = 0.0;
};

void configure(VariableMu& unit, double threshold, double dcThreshold, int position = 4) {
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  unit.setTier(VariableMu::Tier::X4);
  for (int c = 0; c < kVariableMuChannels; ++c) {
    unit.setThreshold(c, threshold);
    unit.setDcThreshold(c, dcThreshold);
    unit.setTimeConstant(c, position);
  }
  unit.reset();
}

/// Ramped in and measured from the settled region, for the reason the FET
/// Limiter's suite records: an abrupt onset is a step as well as a tone, and a
/// harmonic reading taken while the gain is still moving measures the movement.
Rendered render(VariableMu& unit, double hz, double amplitude, bool capture = true) {
  const double step = 2.0 * kPi * std::floor(hz / kBinHz + 0.5) * kBinHz / kRate;
  std::vector<float> left(kBlock, 0.0f);
  std::vector<float> right(kBlock, 0.0f);
  std::vector<float> outLeft(kBlock, 0.0f);
  std::vector<float> outRight(kBlock, 0.0f);
  float* channels[2] = {left.data(), right.data()};
  float* outChannels[2] = {outLeft.data(), outRight.data()};
  Rendered out;
  if (capture) out.samples.assign(kN, 0.0f);

  const std::size_t ramp = static_cast<std::size_t>(kRate * 0.05);
  // Position 4's release is five seconds, so a short settle would measure the
  // loop still arriving. One second with the ramp is enough at the attack end
  // and the rows that need the release measure it directly.
  const std::size_t settle = static_cast<std::size_t>(kRate * 1.0);
  const std::size_t total = ramp + settle + (capture ? kN : 0);
  for (std::size_t base = 0; base < total; base += kBlock) {
    const std::size_t frames = std::min(static_cast<std::size_t>(kBlock), total - base);
    for (std::size_t j = 0; j < frames; ++j) {
      const std::size_t i = base + j;
      double shape = 1.0;
      if (i < ramp) {
        shape = 0.5 - 0.5 * std::cos(kPi * static_cast<double>(i) / static_cast<double>(ramp));
      }
      left[j] = static_cast<float>(amplitude * shape * std::sin(step * static_cast<double>(i)));
      right[j] = left[j];
    }
    AudioBuffer in(channels, 2, static_cast<int>(frames));
    AudioBuffer outBuf(outChannels, 2, static_cast<int>(frames));
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &outBuf;
    ctx.outputCount = 1;
    ctx.frames = static_cast<int>(frames);
    ctx.sampleRate = kRate;
    ctx.playing = true;
    unit.process(ctx);
    if (capture) {
      for (std::size_t j = 0; j < frames; ++j) {
        const std::size_t i = base + j;
        if (i >= ramp + settle) out.samples[i - ramp - settle] = outLeft[j];
      }
    }
  }
  out.reduction = unit.gainReductionDb(0);
  return out;
}

struct Harmonics {
  double h[6] = {0, 0, 0, 0, 0, 0};
  double ratio(int n) const { return h[0] > 0.0 ? h[n - 1] / h[0] : 0.0; }
  double thd() const {
    double sum = 0.0;
    for (int n = 2; n <= 6; ++n) sum += ratio(n) * ratio(n);
    return std::sqrt(sum);
  }
};

Harmonics analyse(const std::vector<float>& samples, double hz) {
  std::vector<double> re(kN, 0.0);
  std::vector<double> im(kN, 0.0);
  for (std::size_t i = 0; i < kN; ++i) re[i] = static_cast<double>(samples[i]);
  dsp::fft(re, im);
  const std::size_t bin = static_cast<std::size_t>(std::floor(hz / kBinHz + 0.5));
  Harmonics h;
  for (int n = 1; n <= 6; ++n) {
    const std::size_t k = bin * static_cast<std::size_t>(n);
    if (k >= kN / 2) break;
    h.h[n - 1] = std::sqrt(re[k] * re[k] + im[k] * im[k]);
  }
  return h;
}

double db(double v) { return 20.0 * std::log10(v > 1.0e-15 ? v : 1.0e-15); }

double reductionAt(double threshold, double dcThreshold, double inDb) {
  VariableMu unit;
  configure(unit, threshold, dcThreshold);
  return render(unit, 1000.0, std::pow(10.0, inDb / 20.0), false).reduction;
}

/// The local slope as a ratio: how many decibels of input buy one of output.
double slopeAt(double threshold, double dcThreshold, double inDb) {
  // A quarter of a decibel. The curve bends continuously — §5 says it has no
  // straight segment anywhere — so a wide secant averages the bend away: at
  // ±1 dB the endpoints measured 11.02:1 and 19.27:1 where the law puts them
  // 2.19x apart, because each reading had already smeared across a range over
  // which the slope itself moves.
  const double delta = 0.25;
  const double lower = inDb - delta - reductionAt(threshold, dcThreshold, inDb - delta);
  const double upper = inDb + delta - reductionAt(threshold, dcThreshold, inDb + delta);
  const double rise = upper - lower;
  return rise > 1.0e-6 ? (2.0 * delta) / rise : 1.0e6;
}

/// The input level, in dBFS, that settles at `targetDb` of reduction.
double inputFor(double threshold, double dcThreshold, double targetDb) {
  double lo = -60.0;
  double hi = 6.0;
  for (int i = 0; i < 14; ++i) {
    const double mid = 0.5 * (lo + hi);
    if (reductionAt(threshold, dcThreshold, mid) < targetDb) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return 0.5 * (lo + hi);
}

Harmonics harmonicsAt(double threshold, double targetDb, double& reduction) {
  const double inDb = inputFor(threshold, 0.5, targetDb);
  VariableMu unit;
  configure(unit, threshold, 0.5);
  const Rendered r = render(unit, 1000.0, std::pow(10.0, inDb / 20.0));
  reduction = r.reduction;
  return analyse(r.samples, 1000.0);
}

}  // namespace

MW_TEST("dyn-04 test 6: the ratio rises with the reduction") {
  // §5: inherent to the remote-cutoff tube. Its transconductance falls
  // non-linearly with bias, so each additional decibel of control voltage buys
  // more decibels of reduction than the last, and the curve bends upward with
  // no knee and no straight segment anywhere.
  const double depths[3] = {3.0, 10.0, 20.0};
  double slope[3] = {0, 0, 0};
  for (int i = 0; i < 3; ++i) {
    const double inDb = inputFor(2.0, 0.5, depths[i]);
    slope[i] = slopeAt(2.0, 0.5, inDb);
    std::printf("    test 6: at %4.1f dB of reduction (%6.2f dBFS in) the slope is %.2f:1\n",
                depths[i], inDb, slope[i]);
  }
  MW_EXPECT(slope[1] > slope[0]);
  MW_EXPECT(slope[2] > slope[1]);
  MW_EXPECT_AT_LEAST_TIMES(slope[2], slope[0], 2.0, 0.5);
}

MW_TEST("dyn-04 test 7: the DC threshold trim moves the ratio across its range") {
  // §3.6: the trim moves the effective ratio across roughly 2:1 to 30:1. The
  // row uses 20:1 as the pass floor because the published 30:1 is a
  // peak-limiting condition rather than the same measurement.
  double slope[2] = {0, 0};
  const double trim[2] = {0.0, 1.0};
  for (int i = 0; i < 2; ++i) {
    const double inDb = inputFor(2.0, trim[i], 10.0);
    slope[i] = slopeAt(2.0, trim[i], inDb);
    std::printf("    test 7: DC threshold %.0f — 10 dB of reduction at %6.2f dBFS, slope %.2f:1\n",
                trim[i], inDb, slope[i]);
  }
  MW_EXPECT(slope[0] <= 2.5);
  MW_EXPECT(slope[1] >= 20.0);
}

MW_TEST("dyn-04 tests 9, 10 and 11: the push-pull signature and how it breaks") {
  double shallowRed = 0.0;
  double deepRed = 0.0;
  const Harmonics shallow = harmonicsAt(2.0, 3.0, shallowRed);
  const Harmonics deep = harmonicsAt(2.0, 20.0, deepRed);

  std::printf("    test 9: at %.2f dB — H2 %.1f dBc, H3 %.1f dBc (third leads by %.1f dB),"
              " THD %.4f %%\n",
              shallowRed, db(shallow.ratio(2)), db(shallow.ratio(3)),
              db(shallow.ratio(3)) - db(shallow.ratio(2)), shallow.thd() * 100.0);
  std::printf("    test 10/11: at %.2f dB — H2 %.1f dBc, H3 %.1f dBc, THD %.4f %%"
              " (%.1f dB more), second/third up %.1f dB\n",
              deepRed, db(deep.ratio(2)), db(deep.ratio(3)), deep.thd() * 100.0,
              db(deep.thd()) - db(shallow.thd()),
              (db(deep.ratio(2)) - db(deep.ratio(3))) -
                  (db(shallow.ratio(2)) - db(shallow.ratio(3))));

  // Test 9: a balanced push-pull stage cancels the second-order product, so at
  // moderate drive the third harmonic leads. This is the single row that tells
  // this unit's model apart from DYN-01's and DYN-02's, which are both
  // single-ended and second-harmonic led.
  MW_EXPECT_EXCEEDS_BY(db(shallow.ratio(3)), db(shallow.ratio(2)), 6.0, 1.0e-9);
  // Test 10: distortion arrives with the compression, not with the level.
  MW_EXPECT_EXCEEDS_BY(db(deep.thd()), db(shallow.thd()), 10.0, 1.0e-9);
  // Test 11: driving the pair toward cutoff pulls its halves apart, so the
  // cancellation weakens and the second harmonic comes back. A model that
  // enforced the balance perfectly would pass 9 and 10 and fail this.
  const double shallowBalance = db(shallow.ratio(2)) - db(shallow.ratio(3));
  const double deepBalance = db(deep.ratio(2)) - db(deep.ratio(3));
  MW_EXPECT_EXCEEDS_BY(deepBalance, shallowBalance, 6.0, 1.0e-9);
}

MW_TEST("dyn-04 test 15: the baseline specifications") {
  // Response measured with the sidechain out of the way — §15's ±1 dB is the
  // amplifier's band, not the compressor's behaviour.
  const double probes[5] = {40.0, 200.0, 1000.0, 8000.0, 15000.0};
  double level[5] = {0, 0, 0, 0, 0};
  for (int i = 0; i < 5; ++i) {
    VariableMu unit;
    configure(unit, 10.0, 0.5);
    const Rendered r = render(unit, probes[i], 0.02);
    level[i] = db(analyse(r.samples, probes[i]).h[0]);
  }
  double lowest = level[0];
  double highest = level[0];
  for (int i = 1; i < 5; ++i) {
    lowest = std::min(lowest, level[i]);
    highest = std::max(highest, level[i]);
  }
  std::printf("    test 15: response 40 Hz to 15 kHz spans %.2f dB\n", highest - lowest);
  // ±1 dB with the published ±0.5 dB additional tolerance.
  MW_EXPECT(highest - lowest <= 3.0);

  // Noise, 70 dB below the nominal operating level. §7 calls this the noisiest
  // of the five units and says it is audibly so, which is why the row is
  // two-sided: a model that is too quiet here has lost a documented character
  // as surely as one that is too loud has a bug.
  VariableMu unit;
  unit.prepare(kRate, kBlock);
  unit.setTier(VariableMu::Tier::X4);
  for (int c = 0; c < kVariableMuChannels; ++c) unit.setThreshold(c, 10.0);
  unit.reset();
  const Rendered silence = render(unit, 1000.0, 0.0);
  double noiseSq = 0.0;
  for (std::size_t i = 0; i < kN; ++i) {
    noiseSq += static_cast<double>(silence.samples[i]) * static_cast<double>(silence.samples[i]);
  }
  const double noiseDb = db(std::sqrt(noiseSq / static_cast<double>(kN)));
  // +4 dBm nominal, aligned to −18 dBFS as everything else in this project is.
  const double signalToNoise = -18.0 - noiseDb;
  std::printf("    test 15: noise floor %.1f dBFS — %.1f dB below nominal (target 70)\n", noiseDb,
              signalToNoise);
  MW_EXPECT(signalToNoise >= 67.0 && signalToNoise <= 73.0);
}

MW_TEST_MAIN("variable-mu-curve")
