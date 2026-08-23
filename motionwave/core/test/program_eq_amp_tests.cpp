// Motion Wave — Program EQ, the amplifier and the transformers.
//
// `dyn-01` §9 tests 10 to 13, plus the distortion half of test 2. Split from
// the response suite because these are the opposite measurement: those drive at
// −20 dBFS specifically to keep nonlinearity out, and these drive at +10 dBm
// specifically to get it in.
//
// What they are really checking is §7's first bullet — that the unit is not
// transparent with every control at zero. The transformers and the valve stage
// are in circuit at all times, including in EQ OUT, and that is the single most
// commonly reported subjective property of the hardware.
//
// Directive 06 §1: bin width is stated with each measurement and every probe
// lands exactly on a bin, so a harmonic's magnitude is one bin's and its
// neighbours contribute nothing. Coherent sampling makes a window unnecessary
// rather than optional.
#include "../dsp/fft.h"
#include "../units/program_eq.h"
#include "harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr int kBlock = 1024;
constexpr std::size_t kN = 65536;
constexpr double kRate = 48000.0;
/// 0.732 Hz.
constexpr double kBinHz = kRate / static_cast<double>(kN);

/**
 * +10 dBm, the level every distortion figure in the sheet is stated at.
 *
 * Through the nonlinear library's full-scale reference of +22 dBu that is
 * −12 dBFS, and the conversion happens here and nowhere else — a second place
 * to turn dBm into an amplitude is a second chance for a distortion figure to
 * be measured at the wrong level and believed.
 */
const double kPlusTenDbm = static_cast<double>(dsp::nl::dbuToLinear(10.0));

/// Render `frames` samples of a coherent sine and return the output.
std::vector<float> render(ProgramEq& unit, double hz, double amplitude, std::size_t frames,
                          std::size_t settle) {
  const double cycles = std::floor(hz / kBinHz + 0.5);
  const double step = 2.0 * kPi * cycles * kBinHz / kRate;
  unit.reset();
  std::vector<float> left(kBlock, 0.0f);
  std::vector<float> right(kBlock, 0.0f);
  float* channels[2] = {left.data(), right.data()};
  std::vector<float> outLeft(kBlock, 0.0f);
  std::vector<float> outRight(kBlock, 0.0f);
  float* outChannels[2] = {outLeft.data(), outRight.data()};
  std::vector<float> captured(frames, 0.0f);

  const std::size_t total = settle + frames;
  for (std::size_t at = 0; at < total; at += static_cast<std::size_t>(kBlock)) {
    const int count = static_cast<int>(std::min(static_cast<std::size_t>(kBlock), total - at));
    for (int i = 0; i < count; ++i) {
      const double index = static_cast<double>(at + static_cast<std::size_t>(i));
      left[static_cast<std::size_t>(i)] = static_cast<float>(amplitude * std::sin(step * index));
      right[static_cast<std::size_t>(i)] = left[static_cast<std::size_t>(i)];
    }
    AudioBuffer in(channels, 2, count);
    AudioBuffer out(outChannels, 2, count);
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &out;
    ctx.outputCount = 1;
    ctx.frames = count;
    ctx.sampleRate = kRate;
    ctx.playing = true;
    unit.process(ctx);
    for (int i = 0; i < count; ++i) {
      const std::size_t absolute = at + static_cast<std::size_t>(i);
      if (absolute >= settle) captured[absolute - settle] = outLeft[static_cast<std::size_t>(i)];
    }
  }
  return captured;
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

Harmonics harmonicsOf(ProgramEq& unit, double hz, double amplitude) {
  // A second of settling before the window, for the same reason the response
  // suite needs one: the slowest filter in the chain is a 2 Hz restoration, and
  // its transient would sit under the fundamental as a skirt.
  const std::vector<float> out = render(unit, hz, amplitude, kN, static_cast<std::size_t>(kRate));
  std::vector<double> re(kN, 0.0);
  std::vector<double> im(kN, 0.0);
  for (std::size_t i = 0; i < kN; ++i) re[i] = static_cast<double>(out[i]);
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

double db(double ratio) { return 20.0 * std::log10(ratio > 1.0e-15 ? ratio : 1.0e-15); }

}  // namespace

MW_TEST("dyn-01 test 10: the published distortion, and the harmonic that leads") {
  ProgramEq unit;
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  const Harmonics h = harmonicsOf(unit, 1000.0, kPlusTenDbm);
  std::printf("    test 10 bins %.4f Hz; +10 dBm = %.4f: THD %.4f %%, H2 %.1f dBc, H3 %.1f dBc,"
              " H2-H3 %.2f dB\n",
              kBinHz, kPlusTenDbm, h.thd() * 100.0, db(h.ratio(2)), db(h.ratio(3)),
              db(h.ratio(2)) - db(h.ratio(3)));
  // 0.15 % with +0.1/−0.15 percentage points, so 0.00 to 0.25 %.
  MW_EXPECT(h.thd() * 100.0 <= 0.25);
  MW_EXPECT(h.thd() * 100.0 >= 0.0);
  // Second-harmonic dominant, which is the whole reason §6.3 chose a
  // single-ended profile over the push-pull one it could not resolve.
  MW_EXPECT(db(h.ratio(2)) - db(h.ratio(3)) >= 6.0);

  // And it rises with level rather than being a constant the model applies.
  const Harmonics quiet = harmonicsOf(unit, 1000.0, kPlusTenDbm * 0.25);
  std::printf("    test 10: at 12 dB lower, THD %.4f %% — %.1f dB down\n", quiet.thd() * 100.0,
              db(h.thd()) - db(quiet.thd()));
  MW_EXPECT(quiet.thd() < h.thd());
}

MW_TEST("dyn-01 test 11: the transformers distort downward in frequency") {
  ProgramEq unit;
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  const Harmonics low = harmonicsOf(unit, 30.0, kPlusTenDbm);
  const Harmonics mid = harmonicsOf(unit, 1000.0, kPlusTenDbm);
  std::printf("    test 11: 30 Hz THD %.4f %% (H3-H2 %.1f dB), 1 kHz THD %.4f %%, rise %.1f dB\n",
              low.thd() * 100.0, db(low.ratio(3)) - db(low.ratio(2)), mid.thd() * 100.0,
              db(low.thd()) - db(mid.thd()));
  // Third-harmonic led at 30 Hz, because the B–H loop is symmetric about the
  // origin — the transformer has taken over from the valve, which is the whole
  // claim.
  MW_EXPECT(db(low.ratio(3)) - db(low.ratio(2)) >= 6.0);
  MW_EXPECT(db(low.thd()) - db(mid.thd()) >= 3.0);
}

MW_TEST("dyn-01 test 2, the half the response suite cannot measure") {
  // EQ OUT removes the passive network and leaves the amplifier. A model that
  // went clean in bypass would pass the level check in the response suite and
  // fail here — which is why the sheet asks for both.
  ProgramEq unit;
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  unit.setEqIn(true);
  const Harmonics in = harmonicsOf(unit, 1000.0, kPlusTenDbm);
  unit.setEqIn(false);
  const Harmonics out = harmonicsOf(unit, 1000.0, kPlusTenDbm);
  const double relative = std::fabs(out.thd() / in.thd() - 1.0);
  std::printf("    test 2: THD %.4f %% in, %.4f %% out — %.2f %% relative\n", in.thd() * 100.0,
              out.thd() * 100.0, relative * 100.0);
  MW_EXPECT(relative < 0.10);
  // And it is not zero, which is the failure the test is actually looking for.
  MW_EXPECT(out.thd() > 1.0e-4);
}

MW_TEST("dyn-01 test 12: the noise floor is the manual's, not silence") {
  ProgramEq unit;
  unit.prepare(kRate, kBlock);
  // No input at all. A model with a silent floor claims a signal-to-noise ratio
  // the hardware does not have, and a user who leaves the unit on a quiet track
  // hears the difference.
  const std::vector<float> out =
      render(unit, 1000.0, 0.0, kN, static_cast<std::size_t>(kRate * 3.0));
  double mean = 0.0;
  for (float v : out) mean += static_cast<double>(v);
  mean /= static_cast<double>(kN);
  double sum = 0.0;
  // About the mean, because a noise floor is the alternating part. Measuring
  // the raw rms instead is what turned a standing DC offset into a noise
  // reading 30 dB above the manual's — the number was real and it was not
  // noise, and the model's actual fault was the offset rather than the hiss.
  for (float v : out) {
    const double d = static_cast<double>(v) - mean;
    sum += d * d;
  }
  const double rms = std::sqrt(sum / static_cast<double>(kN));
  const double below = db(kPlusTenDbm) - db(rms);
  std::printf("    test 12: noise %.2f dBFS rms, %.1f dB below the +10 dBm reference;"
              " residual DC %.2e\n",
              db(rms), below, mean);
  MW_EXPECT_NEAR(below, 92.0, 3.0);
  // And the offset that measurement uncovered, asserted so it cannot come back.
  // A stage biased away from zero has to have its offset removed or it walks
  // into the next stage; the restoration filter that does that stalls in
  // float32 at oversampled rates, which is why its state is a double. −120 dBFS
  // is far below the noise floor and far above what the fix leaves behind.
  MW_EXPECT(std::fabs(mean) < 1.0e-6);
}

MW_TEST("dyn-01 test 13: nothing folds back into the band") {
  ProgramEq unit;
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  const double bin = std::floor(15000.0 / kBinHz + 0.5);
  const double hz = bin * kBinHz;
  std::printf("    test 13 bins %.4f Hz, probe %.2f Hz on bin %.0f — every harmonic and every\n"
              "          alias of one lands on a bin, so the alias grid is resolvable by\n"
              "          construction\n",
              kBinHz, hz, bin);
  // Full scale. "Maximum drive" for this unit is a full-scale input, since the
  // drive is what maps full scale onto the valve stage's curve argument.
  const std::vector<float> out = render(unit, hz, 1.0, kN, static_cast<std::size_t>(kRate));
  std::vector<double> re(kN, 0.0);
  std::vector<double> im(kN, 0.0);
  for (std::size_t i = 0; i < kN; ++i) re[i] = static_cast<double>(out[i]);
  dsp::fft(re, im);
  const std::size_t probeBin = static_cast<std::size_t>(bin);
  // Only harmonics below Nyquist are legitimate. At 15 kHz and a 48 kHz host
  // there is exactly one, so every other line under the probe is an alias.
  const double fundamental = std::sqrt(re[probeBin] * re[probeBin] + im[probeBin] * im[probeBin]);
  double worst = 0.0;
  double worstHz = 0.0;
  for (std::size_t k = 2; k < kN / 2; ++k) {
    const double at = static_cast<double>(k) * kBinHz;
    if (at >= 15000.0) break;
    if (k == probeBin) continue;
    const double magnitude = std::sqrt(re[k] * re[k] + im[k] * im[k]);
    if (magnitude > worst) {
      worst = magnitude;
      worstHz = at;
    }
  }
  std::printf("    test 13: worst spurious component %.1f dBFS at %.0f Hz\n",
              db(worst / fundamental), worstHz);
  MW_EXPECT(db(worst / fundamental) <= -70.0);
}

MW_TEST_MAIN("program-eq-amp")
