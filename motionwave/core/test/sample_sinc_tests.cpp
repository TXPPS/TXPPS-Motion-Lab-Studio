// Motion Wave — the High tier's sinc table, measured rather than trusted.
//
// `smp-01` §4.2: "Measure the table, do not trust it." The design record is in
// `sinc_table.h`; these rows are the measurement it was written from, kept
// executable so that a changed constant changes a printed number.
//
// Mutations, each kept executable beside the row that catches it:
//
// - **The stretch removed** (the prototype read at `x` rather than `x / r`
//   above unity): "the stretched kernel removes what would fold" reads the
//   14 kHz tone's fold at −6.0 dBFS instead of below −100. The same row
//   evaluates both kernels, so the defect is a printed number rather than a
//   remembered one. Note that V-3 as the sheet states it — a 1 kHz tone —
//   does **not** catch this mutation: its images sit deep in either kernel's
//   stopband. The stretch is about content near the fold, so that is what
//   this row plays.
// - **The phase grid offset by half a step** (`(i + 0.5) / kSincPhases`): the
//   identity row fails at every non-zero tap and V-1 in `sample_classic_tests`
//   reads about −50 dBFS.
#include "sample_harness.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw::test::sample;
using mw::test::bandPeakDb;
using mw::dsp::sample::kMaxStretch;
using mw::dsp::sample::kSincHalfWidth;
using mw::dsp::sample::kSincPhases;
using mw::dsp::sample::kSincPoints;

namespace {

/// The continuous kernel's transform at `f` cycles per input sample, from the
/// float table the read actually uses — not from the formula it was built by.
double responseDb(const SincTable& table, double f) {
  double sum = 0.0;
  double gain = 0.0;
  const double step = 1.0 / static_cast<double>(kSincPhases);
  for (int i = -(kSincPoints - 1); i < kSincPoints; ++i) {
    const double x = static_cast<double>(i) * step;
    const double h = static_cast<double>(table.entry(i < 0 ? -i : i));
    sum += h * std::cos(2.0 * kPi * f * x) * step;
    gain += h * step;
  }
  return dbOf(std::fabs(sum / gain));
}

/// Catmull-Rom's transform, the same way, so the two tiers are compared by one
/// instrument rather than by a constant read off a different one.
double catmullRomDb(double f) {
  double sum = 0.0;
  double gain = 0.0;
  const double step = 1.0 / 2048.0;
  for (double x = -2.0; x <= 2.0; x += step) {
    const double a = std::fabs(x);
    double h = 0.0;
    if (a < 1.0) h = 1.5 * a * a * a - 2.5 * a * a + 1.0;
    else if (a < 2.0) h = -0.5 * a * a * a + 2.5 * a * a - 4.0 * a + 2.0;
    sum += h * std::cos(2.0 * kPi * f * x) * step;
    gain += h * step;
  }
  return dbOf(std::fabs(sum / gain));
}

double pointBelow(double targetDb, double (*fn)(double)) {
  double last = 0.0;
  for (double f = 0.0; f <= 0.5; f += 0.0005) {
    if (fn(f) > targetDb) last = f;
  }
  return last;
}

double tableResponse(double f) { return responseDb(sharedSinc(), f); }

/// Resamples a tone at `rate` through the table and reports the level at the
/// frequency its first fold lands on. `kernelRate` is what the read is *told*
/// the rate is: passing 1.0 while advancing by `rate` is the unstretched
/// kernel, which is the mutation kept beside the row.
double foldLevelDb(double toneHz, double rate, double kernelRate, double* toneOut) {
  const double fs = 48000.0;
  const std::size_t frames = 400000;
  const std::vector<float> zone = sineZone(toneHz, fs, frames, 0.5);
  const int n = 65536;
  std::vector<float> out(static_cast<std::size_t>(n));
  double pos = 1024.0;
  for (int k = 0; k < n; ++k) {
    const double floored = std::floor(pos);
    out[static_cast<std::size_t>(k)] = sharedSinc().read(
        [&zone](long long i) {
          return (i >= 0 && static_cast<std::size_t>(i) < zone.size())
                     ? zone[static_cast<std::size_t>(i)]
                     : 0.0f;
        },
        static_cast<long long>(floored), pos - floored, kernelRate);
    pos += rate;
  }
  const double shifted = toneHz * rate;
  const double folded = std::fabs(fs - shifted);
  *toneOut = shifted;
  return bandPeakDb(out, fs, static_cast<std::size_t>(n), folded, 20.0, 0);
}

}  // namespace

MW_TEST("the zero-phase row is the identity, so a read at an integer is the sample") {
  const SincTable& table = sharedSinc();
  MW_EXPECT_NEAR(static_cast<double>(table.entry(0)), 1.0, 0.0);
  for (int d = 1; d <= kSincHalfWidth; ++d) {
    MW_EXPECT(std::fabs(static_cast<double>(table.entry(d * kSincPhases))) < 1.0e-12);
  }
  std::vector<float> buffer(64);
  for (std::size_t i = 0; i < buffer.size(); ++i) buffer[i] = static_cast<float>(i) * 0.01f - 0.3f;
  auto fetch = [&buffer](long long i) {
    return (i >= 0 && static_cast<std::size_t>(i) < buffer.size()) ? buffer[static_cast<std::size_t>(i)]
                                                                     : 0.0f;
  };
  for (long long i = 8; i < 56; ++i) {
    MW_EXPECT(table.read(fetch, i, 0.0, 1.0) == buffer[static_cast<std::size_t>(i)]);
  }
}

MW_TEST("the table's response matches the design record and is no duller than Hermite") {
  const double stop = [] {
    double worst = -400.0;
    for (double f = 0.75; f <= 4.0; f += 0.0025) worst = std::max(worst, tableResponse(f));
    return worst;
  }();
  const double p01 = pointBelow(-0.1, tableResponse);
  const double p1 = pointBelow(-1.0, tableResponse);
  const double p3 = pointBelow(-3.0, tableResponse);
  const double hermite3 = pointBelow(-3.0, catmullRomDb);
  std::printf("    table: -0.1 dB at %.3f fs, -1 dB at %.3f fs, -3 dB at %.3f fs; worst on [0.75, 4] fs"
              " %.1f dB; H(0.979 fs) %.1f dB, H(0.708 fs) %.1f dB\n",
              p01, p1, p3, stop, tableResponse(0.979), tableResponse(0.708));
  std::printf("    Catmull-Rom for comparison: -3 dB at %.3f fs, H(0.979 fs) %.1f dB\n", hermite3,
              catmullRomDb(0.979));
  // V-3's number: the far stopband is what a low tone's images meet.
  MW_EXPECT(stop <= -100.0);
  // Derived rather than chosen: a High tier that rolled off before the Normal
  // tier would be a downgrade sold as an upgrade.
  MW_EXPECT(p3 >= hermite3);
}

MW_TEST("DC gain is unity at every phase and every stretch") {
  std::vector<float> flat(4096, 0.75f);
  auto fetch = [&flat](long long i) {
    return (i >= 0 && static_cast<std::size_t>(i) < flat.size()) ? flat[static_cast<std::size_t>(i)]
                                                                   : 0.0f;
  };
  const double rates[5] = {0.5, 1.0, 1.4983, 3.0, 8.0};
  double worst = 0.0;
  for (double rate : rates) {
    for (int p = 0; p < 64; ++p) {
      const double fraction = static_cast<double>(p) / 64.0;
      const float v = sharedSinc().read(fetch, 2048, fraction, rate);
      worst = std::max(worst, std::fabs(static_cast<double>(v) - 0.75));
    }
  }
  std::printf("    DC: worst deviation from unity %.2e\n", worst);
  MW_EXPECT(worst <= 1.0e-6);
}

MW_TEST("the stretched kernel removes what would fold, and the unstretched one does not") {
  const double rate = mw::dsp::sample::semitoneRatio(19.0);
  double tone = 0.0;
  const double stretched = foldLevelDb(14000.0, rate, rate, &tone);
  const double unstretched = foldLevelDb(14000.0, rate, 1.0, &tone);
  std::printf("    +19: a 14 kHz tone would land at %.0f Hz; its fold reads %.1f dBFS stretched,"
              " %.1f dBFS unstretched (mutation)\n",
              tone, stretched, unstretched);
  // Relative to the −6 dBFS tone: −100 dBc is −106 dBFS.
  MW_EXPECT(stretched <= -106.0 + 3.0);
  MW_EXPECT(unstretched > -20.0);
  // The transition band straddles the fold corner, and this is what it costs:
  // recorded, not graded, because sixteen taps cannot have it both ways.
  const double leak = foldLevelDb(10000.0, rate, rate, &tone);
  std::printf("    +19: a 10 kHz tone, 0.32 octave above the 8 kHz fold corner, folds to %.0f Hz"
              " at %.1f dBFS\n",
              std::fabs(48000.0 - tone), leak);
  MW_EXPECT(leak < stretched + 200.0);
}

MW_TEST("the kernel widens with the ratio and stops at kMaxStretch") {
  MW_EXPECT_EQ(SincTable::halfWidthFor(0.5), 8);
  MW_EXPECT_EQ(SincTable::halfWidthFor(1.0), 8);
  MW_EXPECT_EQ(SincTable::halfWidthFor(1.5), 12);
  MW_EXPECT_EQ(SincTable::halfWidthFor(-4.0), 32);
  MW_EXPECT_EQ(SincTable::halfWidthFor(kMaxStretch), 512);
  MW_EXPECT_EQ(SincTable::halfWidthFor(1000.0), 512);
}

MW_TEST_MAIN("sample-sinc")
