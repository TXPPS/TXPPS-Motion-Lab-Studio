// Motion Wave — the Console EQ's amplifiers and transformers, both lineages.
// `dyn-05` §10 rows 7, 8, 9, 10, 17 and 18.
//
// These rows render, because their subject is the path rather than the curve.
// The curve rows are in `console_eq_curve_tests.cpp` and read the sections'
// own coefficients; putting a bandwidth measurement through this path would
// have the amplifiers' gain and their harmonics in every number.
//
// Levels are the sheet's, converted once and stated here: +4 dBu nominal is
// aligned to −18 dBFS as everything else in this project is, so +20 dBu is
// −2 dBFS, the British lineage's >+26 dBu clipping point is about +4 dBFS, and
// the American lineage's +28 dBm is about +6 dBFS.
#include "../dsp/fft.h"
#include "../units/console_eq.h"
#include "harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kRate = 96000.0;
constexpr std::size_t kN = 32768;
constexpr double kBinHz = kRate / static_cast<double>(kN);
constexpr int kBlock = 128;

/// −18 dBFS is +4 dBu, so a level in dBu is this many decibels lower in dBFS.
constexpr double kDbuToDbFs = -22.0;

struct Harmonics {
  double h[8] = {0, 0, 0, 0, 0, 0, 0, 0};
  double ratio(int n) const { return h[0] > 0.0 ? h[n - 1] / h[0] : 0.0; }
  double thd() const {
    double sum = 0.0;
    for (int n = 2; n <= 8; ++n) sum += ratio(n) * ratio(n);
    return std::sqrt(sum);
  }
};

std::vector<float> render(ConsoleEq& unit, double hz, double amplitude) {
  const double step = 2.0 * kPi * std::floor(hz / kBinHz + 0.5) * kBinHz / kRate;
  std::vector<float> left(kBlock, 0.0f);
  std::vector<float> right(kBlock, 0.0f);
  std::vector<float> outLeft(kBlock, 0.0f);
  std::vector<float> outRight(kBlock, 0.0f);
  float* channels[2] = {left.data(), right.data()};
  float* outChannels[2] = {outLeft.data(), outRight.data()};
  std::vector<float> captured(kN, 0.0f);

  // Ramped in and settled before the window, so the transformers' flux
  // integrators have arrived and the harmonics being read are the path's rather
  // than the onset's.
  const std::size_t ramp = static_cast<std::size_t>(kRate * 0.05);
  const std::size_t settle = static_cast<std::size_t>(kRate * 0.3);
  const std::size_t total = ramp + settle + kN;
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
    AudioBuffer out(outChannels, 2, static_cast<int>(frames));
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &out;
    ctx.outputCount = 1;
    ctx.frames = static_cast<int>(frames);
    ctx.sampleRate = kRate;
    ctx.playing = true;
    unit.process(ctx);
    for (std::size_t j = 0; j < frames; ++j) {
      const std::size_t i = base + j;
      if (i >= ramp + settle) captured[i - ramp - settle] = outLeft[j];
    }
  }
  return captured;
}

Harmonics analyse(const std::vector<float>& samples, double hz) {
  std::vector<double> re(kN, 0.0);
  std::vector<double> im(kN, 0.0);
  for (std::size_t i = 0; i < kN; ++i) re[i] = static_cast<double>(samples[i]);
  dsp::fft(re, im);
  const std::size_t bin = static_cast<std::size_t>(std::floor(hz / kBinHz + 0.5));
  Harmonics h;
  for (int n = 1; n <= 8; ++n) {
    const std::size_t k = bin * static_cast<std::size_t>(n);
    if (k >= kN / 2) break;
    h.h[n - 1] = std::sqrt(re[k] * re[k] + im[k] * im[k]);
  }
  return h;
}

double db(double v) { return 20.0 * std::log10(v > 1.0e-18 ? v : 1.0e-18); }
double amplitudeForDbu(double dbu) { return std::pow(10.0, (dbu + kDbuToDbFs) / 20.0); }

void configure(ConsoleEq& unit, ConsoleEq::Lineage lineage) {
  unit.setLineage(lineage);
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  unit.reset();
}

double rmsOf(const std::vector<float>& v) {
  double sum = 0.0;
  for (float s : v) sum += static_cast<double>(s) * static_cast<double>(s);
  return std::sqrt(sum / static_cast<double>(v.size()));
}

}  // namespace

MW_TEST("dyn-05 test 7: the inductor cores saturate, and the EQ is where it happens") {
  // Twelve decibels below clipping, as the row directs, with the low shelf at
  // its maximum on its lowest position and a 40 Hz probe under it.
  const double drive = amplitudeForDbu(26.0 - 12.0);
  ConsoleEq flat;
  configure(flat, ConsoleEq::Lineage::British);
  const Harmonics clean = analyse(render(flat, 40.0, drive), 40.0);

  ConsoleEq boosted;
  configure(boosted, ConsoleEq::Lineage::British);
  boosted.setBritishLowFrequency(0);
    boosted.setBritishLowAmount(16.0);
  const Harmonics dirty = analyse(render(boosted, 40.0, drive), 40.0);

  std::printf("    test 7: 40 Hz at %.1f dBFS — flat EQ %.4f %%, low shelf up %.4f %%"
              " (%.1f dB more)\n",
              db(drive), clean.thd() * 100.0, dirty.thd() * 100.0,
              db(dirty.thd()) - db(clean.thd()));
  MW_EXPECT_EXCEEDS_BY(db(dirty.thd()), db(clean.thd()), 6.0, 1.0e-9);
}

MW_TEST("dyn-05 test 8: bypassing the EQ does not bypass the preamp") {
  // §3.6's implementer rule, and the one users of both lineages would notice
  // first: the latch removes the networks, never the amplifiers or the
  // transformers.
  const double drive = amplitudeForDbu(20.0);
  ConsoleEq in;
  configure(in, ConsoleEq::Lineage::British);
  in.setEqIn(true);
  const std::vector<float> withEq = render(in, 1000.0, drive);
  const Harmonics withEqH = analyse(withEq, 1000.0);

  ConsoleEq out;
  configure(out, ConsoleEq::Lineage::British);
  out.setEqIn(false);
  const std::vector<float> withoutEq = render(out, 1000.0, drive);
  const Harmonics withoutEqH = analyse(withoutEq, 1000.0);

  const double levelChange = db(rmsOf(withEq)) - db(rmsOf(withoutEq));
  const double thdRatio = withoutEqH.thd() > 0.0 ? withEqH.thd() / withoutEqH.thd() : 0.0;
  std::printf("    test 8: EQ at zero against EQ out — %.4f dB of level, THD %.4f %% against"
              " %.4f %% (%.1f %% relative)\n",
              levelChange, withEqH.thd() * 100.0, withoutEqH.thd() * 100.0,
              (thdRatio - 1.0) * 100.0);
  MW_EXPECT(std::fabs(levelChange) <= 0.2);
  MW_EXPECT(std::fabs(thdRatio - 1.0) <= 0.10);
  // And the colour is really there to be kept — the row is satisfied trivially
  // by a linear path, which has no distortion on either side to compare. Two
  // thousandths of a per cent is well under §9.1's own 0.07 % ceiling and well
  // over a rounding error, so it says "these amplifiers are modelled" without
  // asserting a figure nobody published.
  MW_EXPECT(withoutEqH.thd() * 100.0 >= 0.002);
}

MW_TEST("dyn-05 test 9: the British lineage's baseline specifications") {
  const double drive = amplitudeForDbu(20.0);
  for (const double hz : {50.0, 1000.0, 10000.0}) {
    ConsoleEq unit;
    configure(unit, ConsoleEq::Lineage::British);
    const Harmonics h = analyse(render(unit, hz, drive), hz);
    std::printf("    test 9: %6.0f Hz at +20 dBu — THD %.4f %%\n", hz, h.thd() * 100.0);
    // 0.07 % with the published +0.03 percentage point tolerance.
    MW_EXPECT(h.thd() * 100.0 <= 0.10);
  }

  ConsoleEq quiet;
  configure(quiet, ConsoleEq::Lineage::British);
  quiet.setNoise(0.0);
  const double noiseFloor = db(rmsOf(render(quiet, 1000.0, 0.0)));
  ConsoleEq noisy;
  noisy.setLineage(ConsoleEq::Lineage::British);
  noisy.prepare(kRate, kBlock);
  noisy.reset();
  const double floorWithNoise = db(rmsOf(render(noisy, 1000.0, 0.0)));
  // −83 dBu at line gain, which is −105 dBFS on this alignment, ±3 dB.
  std::printf("    test 9: noise floor %.1f dBFS (%.1f dBu), silent path %.1f dBFS\n",
              floorWithNoise, floorWithNoise - kDbuToDbFs, noiseFloor);
  MW_EXPECT_NEAR(floorWithNoise - kDbuToDbFs, -83.0, 3.0);

  // Response, EQ flat. ±0.5 dB with ±0.3 dB additional tolerance.
  ConsoleEq flat;
  configure(flat, ConsoleEq::Lineage::British);
  const double reference = amplitudeForDbu(0.0);
  double lowest = 1.0e9;
  double highest = -1.0e9;
  for (const double hz : {20.0, 100.0, 1000.0, 10000.0, 20000.0}) {
    ConsoleEq probe;
    configure(probe, ConsoleEq::Lineage::British);
    const Harmonics h = analyse(render(probe, hz, reference), hz);
    const double level = db(h.h[0]);
    lowest = std::min(lowest, level);
    highest = std::max(highest, level);
  }
  std::printf("    test 9: response 20 Hz to 20 kHz spans %.3f dB\n", highest - lowest);
  MW_EXPECT(highest - lowest <= 1.6);
}

MW_TEST("dyn-05 test 10: the British lineage's harmonic profile") {
  const double drive = amplitudeForDbu(20.0);
  ConsoleEq unit;
  configure(unit, ConsoleEq::Lineage::British);
  const Harmonics kilo = analyse(render(unit, 1000.0, drive), 1000.0);

  ConsoleEq low;
  configure(low, ConsoleEq::Lineage::British);
  const Harmonics bass = analyse(render(low, 40.0, drive), 40.0);

  std::printf("    test 10: 1 kHz — H2 %.1f dBc, H3 %.1f dBc (second leads by %.1f dB),"
              " THD %.4f %%\n",
              db(kilo.ratio(2)), db(kilo.ratio(3)), db(kilo.ratio(2)) - db(kilo.ratio(3)),
              kilo.thd() * 100.0);
  std::printf("    test 10: 40 Hz THD %.4f %% — %.1f dB above 1 kHz\n", bass.thd() * 100.0,
              db(bass.thd()) - db(kilo.thd()));
  // Class A single-ended stages are second-harmonic led.
  MW_EXPECT_EXCEEDS_BY(db(kilo.ratio(2)), db(kilo.ratio(3)), 4.0, 1.0e-9);
  // And the transformers are frequency-inverse, which is the signature the row
  // is really asking after.
  MW_EXPECT_EXCEEDS_BY(db(bass.thd()), db(kilo.thd()), 3.0, 1.0e-9);
}

MW_TEST("dyn-05 test 17: the American lineage has no EQ-section saturation") {
  // §7.2: no inductors, therefore no core saturation in the EQ itself. The row
  // exists because giving this device the British one's low-frequency EQ
  // saturation is the obvious copy-paste and the sheet says in as many words
  // that it would be wrong.
  //
  // **Level-matched at the input, not after the output stage.** The EQ sits
  // ahead of the op-amp and the step-up transformer, so trimming the output
  // leaves those twelve decibels hotter and the row measures the transformer
  // rather than the EQ — it read 11.2 dB apart that way, on a device that has
  // no EQ-section nonlinearity at all. Backing the drive off instead puts the
  // same level into everything downstream, and what is left is the question
  // being asked.
  const double drive = amplitudeForDbu(20.0);
  ConsoleEq flat;
  configure(flat, ConsoleEq::Lineage::American);
  const Harmonics clean = analyse(render(flat, 40.0, drive), 40.0);

  ConsoleEq boosted;
  configure(boosted, ConsoleEq::Lineage::American);
  boosted.setAmericanFrequency(0, 0);
    boosted.setAmericanAmount(0, 12.0);
    boosted.setAmericanShape(0, ConsoleEq::Shape::Shelf);
  boosted.setDriveDb(-12.0);
  const Harmonics dirty = analyse(render(boosted, 40.0, drive), 40.0);

  std::printf("    test 17: 40 Hz level-matched — flat %.4f %%, low boost %.4f %%"
              " (%.1f dB apart)\n",
              clean.thd() * 100.0, dirty.thd() * 100.0,
              std::fabs(db(dirty.thd()) - db(clean.thd())));
  MW_EXPECT(std::fabs(db(dirty.thd()) - db(clean.thd())) < 3.0);
}

MW_TEST("dyn-05 test 18: the step-up output transformer's signature") {
  // §7.2: a 1:3 ratio asks the transformer to swing three times the op-amp's
  // voltage, so it is the dominant nonlinearity at high level — and a
  // transformer core is odd-symmetric, so the third harmonic leads. That is the
  // opposite of the British lineage's Class A signature and it is the pair of
  // rows that keeps the two devices apart in the ear as well as on paper.
  const double drive = amplitudeForDbu(28.0);
  ConsoleEq unit;
  configure(unit, ConsoleEq::Lineage::American);
  const Harmonics h = analyse(render(unit, 40.0, drive), 40.0);
  std::printf("    test 18: 40 Hz at +28 dBm — H2 %.1f dBc, H3 %.1f dBc (third leads by %.1f dB),"
              " THD %.4f %%\n",
              db(h.ratio(2)), db(h.ratio(3)), db(h.ratio(3)) - db(h.ratio(2)), h.thd() * 100.0);
  MW_EXPECT_EXCEEDS_BY(db(h.ratio(3)), db(h.ratio(2)), 4.0, 1.0e-9);
}

MW_TEST_MAIN("console-eq-drive")
