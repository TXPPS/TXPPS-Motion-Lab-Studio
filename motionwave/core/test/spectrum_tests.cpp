// Motion Wave — calibrating the spectral instrument against known answers.
//
// This file exists because the alias measurement it validates was wrong five
// separate times, and every one of those produced a plausible number:
//
//   1. N = 4096 gave 11.72 Hz bins against a 10 Hz alias-to-sideband gap, so
//      the two shared a bin and the "alias floor" was the sideband.
//   2. The exclusion set stopped at ±40 sidebands; a 0.05 ms smoother passes
//      harmonics far past that, so legitimate signal counted as spurious.
//   3. Measured against DC instead of a carrier, the modulator's own DC term
//      dominated its window skirt.
//   4. Lower sidebands reflect through zero — `carrier − 12·spacing` is −80 Hz
//      and appears at +80 Hz — and skipping the negative ones counted every
//      reflection as spurious.
//   5. A Hann window's sidelobes sit near −31 dB, so a −6 dBFS carrier smeared
//      energy across the spectrum at about −54 dBFS. That was the floor being
//      reported, and the tell was that crushing the modulator's bandwidth
//      elevenfold moved it by 0.1 dB.
//
// A spectral measurement never looks broken. So the instrument is calibrated
// against signals whose answer is known before it is believed about signals
// whose answer is not.
#include "spectrum.h"
#include "harness.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;

namespace {
constexpr double kSr = 48000.0;
constexpr std::size_t kN = 32768;

test::SpectrumPlan planFor(double carrier, double spacing) {
  test::SpectrumPlan p;
  p.sampleRate = kSr;
  p.length = kN;
  p.carrierHz = carrier;
  p.spacingHz = spacing;
  return p;
}
}  // namespace

MW_TEST("a pure tone at the carrier reads as essentially nothing") {
  // The calibration that would have caught error 5 on sight. If the instrument
  // cannot see a clean signal as clean, no floor it reports means anything.
  const std::vector<float> tone = test::syntheticTone(1000.0, kSr, kN * 2, 0.5);
  const double floorDb = test::spuriousFloorDb(tone, planFor(1000.0, 90.0), 0);
  std::printf("    pure 1 kHz tone at -6 dBFS: floor %.1f dBFS\n", floorDb);
  // Well below the −80 dBFS the units are asked to meet, so the instrument has
  // headroom to measure that target rather than merely reach it.
  MW_EXPECT(floorDb <= -100.0);
}

MW_TEST("a deliberately planted tone is found, at its real level") {
  // The other half: an instrument that reads everything as silent would pass
  // the test above. Something out of band must show up, and at the right size.
  std::vector<float> mixed = test::syntheticTone(1000.0, kSr, kN * 2, 0.5);
  const std::vector<float> spur = test::syntheticTone(7333.0, kSr, kN * 2, 0.001);  // -60 dBFS
  for (std::size_t i = 0; i < mixed.size(); ++i) mixed[i] += spur[i];

  const double floorDb = test::spuriousFloorDb(mixed, planFor(1000.0, 90.0), 0);
  std::printf("    planted -60 dBFS spur at 7333 Hz: measured %.1f dBFS\n", floorDb);
  MW_EXPECT(std::fabs(floorDb + 60.0) <= 1.0);
}

MW_TEST("a measurement that cannot resolve its grids refuses to report") {
  // The standing rule as a mechanism. At 4096 bins the Motion Shaper's own
  // case is unresolvable, and the helper must say so rather than return the
  // plausible number that started all of this.
  test::SpectrumPlan coarse = planFor(1000.0, 90.0);
  coarse.length = 4096;
  MW_EXPECT(!coarse.resolvable());
  const std::vector<float> tone = test::syntheticTone(1000.0, kSr, 16384, 0.5);
  // +1.0 dBFS is impossible, so no assertion anywhere can accept it.
  MW_EXPECT(test::spuriousFloorDb(tone, coarse, 0) > 0.0);

  test::SpectrumPlan fine = planFor(1000.0, 90.0);
  fine.length = 32768;
  MW_EXPECT(fine.resolvable());
}

MW_TEST("the alias and sideband grids are separated, not coincident") {
  // The arithmetic that was got wrong once, kept as a test so it cannot be got
  // wrong again. Aliases fold to 47000 − m·90 and sidebands sit at 1000 + n·90;
  // they coincide only if 46000 were a multiple of 90. It is not — 46000/90 is
  // 511.11 — so they are never coincident, and the closest they come is 10 Hz.
  const test::SpectrumPlan p = planFor(1000.0, 90.0);
  std::printf("    90 Hz: closest alias-to-sideband gap %.2f Hz\n", p.closestAliasGap());
  MW_EXPECT(std::fabs(p.closestAliasGap() - 10.0) < 0.001);
  MW_EXPECT(std::fabs(46000.0 / 90.0 - 511.0) > 0.01);
}

MW_TEST("the transform inverts what it is given") {
  // The FFT itself, since everything above rests on it. A single bin in, one
  // sinusoid out, at the right frequency and amplitude.
  const std::size_t n = 1024;
  std::vector<double> re(n, 0.0);
  std::vector<double> im(n, 0.0);
  for (std::size_t i = 0; i < n; ++i) {
    re[i] = std::cos(2.0 * 3.14159265358979323846 * 7.0 * static_cast<double>(i) /
                     static_cast<double>(n));
  }
  dsp::fft(re, im);
  double peak = 0.0;
  std::size_t peakBin = 0;
  for (std::size_t k = 0; k < n / 2; ++k) {
    const double mag = std::sqrt(re[k] * re[k] + im[k] * im[k]);
    if (mag > peak) {
      peak = mag;
      peakBin = k;
    }
  }
  MW_EXPECT_EQ(static_cast<long long>(peakBin), 7);
  // A unit-amplitude cosine puts n/2 in its bin.
  MW_EXPECT_NEAR(peak, static_cast<double>(n) / 2.0, 1.0e-6);
}

MW_TEST_MAIN("spectrum")
