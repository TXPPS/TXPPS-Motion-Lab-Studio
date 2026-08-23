// Motion Wave — the band split, measured rather than reviewed.
//
// `fx-01` V2 is the gate: three bands, all modulation neutral, summed output
// within ±0.05 dB of the input from 20 Hz to 20 kHz, at every slope. It is
// stated that precisely because all three ways of getting a crossover wrong
// produce a device that sounds plausible — a dip or a bump near a corner that
// nobody hears until it is compared with the dry signal.
//
// Measured by driving a sine at each frequency until the filters settle and
// reading the steady-state amplitude, rather than by evaluating the transfer
// function. Evaluating it would test the arithmetic in `magnitudeAt` against
// the arithmetic in the coefficients — two expressions of the same belief. This
// runs the actual sample loop, so a state-handling bug, a denormal flush that
// eats signal, or a polarity error in the sum all show up.
#include "../dsp/crossover.h"
#include "harness.h"
#include "rt_guard.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw::dsp;

namespace {

constexpr double kPi = 3.14159265358979323846;

/**
 * Window length for the transfer-function measurement.
 *
 * The frequencies below are chosen as exact DFT bins of this length — `f = k ·
 * fs / N` — which is the whole reason it is a fixed power of two rather than
 * derived per frequency. A window holding a non-integer number of cycles leaks,
 * and leakage does *not* divide out of an input/output ratio the way it first
 * appears to: the windowed transform of the output is the convolution of
 * `H·X` with the window, not `H` times the windowed transform of the input. The
 * error is largest exactly where `H` varies fastest with frequency, which is at
 * a crossover — so a leaky probe reports its worst numbers at precisely the
 * places a crossover bug would, and reads as one.
 *
 * That is what the first two runs of this test did: 0.10 to 0.16 dB clustered
 * at 142 and 215 Hz against a 220 Hz corner. On exact bins the leakage is zero
 * and what is left is the filter.
 */
constexpr int kWindow = 32768;

/// Magnitude of the summed bands at DFT bin `k`, relative to the input.
///
/// The settle period is discarded rather than averaged in: a filter's start-up
/// transient is real output and would drag the measurement at low frequencies,
/// where the settle is longest and the tolerance tightest.
double sumMagnitudeAtBin(int bin, double sampleRate, double f1, double f2, Slope slope) {
  ThreeBandSplit split;
  split.prepare(sampleRate, f1, f2, slope);
  const double frequency = static_cast<double>(bin) * sampleRate / static_cast<double>(kWindow);
  const int settle = static_cast<int>(sampleRate * 0.5);

  double xRe = 0.0;
  double xIm = 0.0;
  double yRe = 0.0;
  double yIm = 0.0;
  for (int i = 0; i < settle + kWindow; ++i) {
    const double phase = 2.0 * kPi * frequency * static_cast<double>(i) / sampleRate;
    const double x = std::sin(phase);
    double low = 0.0;
    double mid = 0.0;
    double high = 0.0;
    split.process(x, low, mid, high);
    const double y = low + mid + high;
    if (i >= settle) {
      const double c = std::cos(phase);
      const double sn = std::sin(phase);
      xRe += x * c;
      xIm += x * sn;
      yRe += y * c;
      yIm += y * sn;
    }
  }
  const double xMag = std::sqrt(xRe * xRe + xIm * xIm);
  const double yMag = std::sqrt(yRe * yRe + yIm * yIm);
  return xMag < 1.0e-12 ? 0.0 : yMag / xMag;
}

double toDb(double ratio) { return 20.0 * std::log10(ratio < 1.0e-12 ? 1.0e-12 : ratio); }

/**
 * The bins V2 asks about: a log sweep across the audible band, snapped to exact
 * DFT bins of `kWindow` so nothing leaks.
 *
 * Deduplicated because at the bottom of the range consecutive log steps land on
 * the same bin — 20 Hz and 23 Hz are both bin 14 at 48 kHz — and measuring one
 * of them twice is time spent to learn nothing.
 */
std::vector<int> sweepBins(double sampleRate) {
  std::vector<int> out;
  int last = -1;
  for (double f = 20.0; f <= 20000.0; f *= 1.15) {
    const int bin = static_cast<int>(f * static_cast<double>(kWindow) / sampleRate + 0.5);
    if (bin > last && static_cast<double>(bin) * sampleRate / kWindow < sampleRate * 0.45) {
      out.push_back(bin);
      last = bin;
    }
  }
  return out;
}

/// The frequency a bin stands for, for printing.
double binHz(int bin, double sampleRate) {
  return static_cast<double>(bin) * sampleRate / static_cast<double>(kWindow);
}

}  // namespace

MW_TEST("three bands sum flat at 24 dB per octave") {
  // V2 proper, and the one that catches a wrong all-pass order on the low band.
  const double sr = 48000.0;
  double worst = 0.0;
  double worstAt = 0.0;
  for (const int bin : sweepBins(sr)) {
    const double db = toDb(sumMagnitudeAtBin(bin, sr, 220.0, 3200.0, Slope::Db24));
    if (std::fabs(db) > std::fabs(worst)) {
      worst = db;
      worstAt = binHz(bin, sr);
    }
  }
  std::printf("    LR4 sum: worst %+.7f dB at %.0f Hz\n", worst, worstAt);
  MW_EXPECT(std::fabs(worst) <= 0.05);
}

MW_TEST("three bands sum flat at 12 dB per octave") {
  // The polarity case. An LR2 pair sums to an *inverted* first-order all-pass,
  // so one branch must flip; without the flip this reads as a deep notch at the
  // crossover rather than as a small error.
  const double sr = 48000.0;
  double worst = 0.0;
  double worstAt = 0.0;
  for (const int bin : sweepBins(sr)) {
    const double db = toDb(sumMagnitudeAtBin(bin, sr, 220.0, 3200.0, Slope::Db12));
    if (std::fabs(db) > std::fabs(worst)) {
      worst = db;
      worstAt = binHz(bin, sr);
    }
  }
  std::printf("    LR2 sum: worst %+.7f dB at %.0f Hz\n", worst, worstAt);
  MW_EXPECT(std::fabs(worst) <= 0.05);
}

MW_TEST("three bands sum flat at 6 dB per octave") {
  // A first-order pair sums to exactly 1, so this one needs neither a polarity
  // flip nor an all-pass. Applying either would break it, which is why the
  // compensation is matched to the slope rather than always on.
  const double sr = 48000.0;
  double worst = 0.0;
  double worstAt = 0.0;
  for (const int bin : sweepBins(sr)) {
    const double db = toDb(sumMagnitudeAtBin(bin, sr, 220.0, 3200.0, Slope::Db6));
    if (std::fabs(db) > std::fabs(worst)) {
      worst = db;
      worstAt = binHz(bin, sr);
    }
  }
  std::printf("    first-order sum: worst %+.7f dB at %.0f Hz\n", worst, worstAt);
  MW_EXPECT(std::fabs(worst) <= 0.05);
}

MW_TEST("the sum stays flat at every supported sample rate") {
  // A crossover whose coefficients are conditioned badly drifts with the rate,
  // and drifts most where `w0` is smallest — a 220 Hz corner at 192 kHz. That
  // is the case single-precision state loses, and it is why the biquad keeps
  // its state in double.
  for (const double sr : {44100.0, 48000.0, 88200.0, 96000.0, 192000.0}) {
    double worst = 0.0;
    for (const int bin : sweepBins(sr)) {
      const double db = toDb(sumMagnitudeAtBin(bin, sr, 220.0, 3200.0, Slope::Db24));
      if (std::fabs(db) > std::fabs(worst)) worst = db;
    }
    std::printf("    %.0f Hz: worst %+.7f dB\n", sr, worst);
    MW_EXPECT(std::fabs(worst) <= 0.05);
  }
}

MW_TEST("the low band really is low and the high band really is high") {
  // A sum can be flat while the bands are nonsense — pass the input through
  // untouched and add two silences and V2 passes. This is what stops that:
  // each band has to actually contain its own range.
  ThreeBandSplit split;
  split.prepare(48000.0, 220.0, 3200.0, Slope::Db24);
  const double probe = 50.0;  // Well inside the low band.
  double lowPeak = 0.0;
  double highPeak = 0.0;
  for (int i = 0; i < 48000; ++i) {
    const double x = std::sin(2.0 * kPi * probe * static_cast<double>(i) / 48000.0);
    double low = 0.0;
    double mid = 0.0;
    double high = 0.0;
    split.process(x, low, mid, high);
    if (i > 24000) {
      const double la = low < 0.0 ? -low : low;
      const double ha = high < 0.0 ? -high : high;
      if (la > lowPeak) lowPeak = la;
      if (ha > highPeak) highPeak = ha;
    }
  }
  std::printf("    50 Hz: low band %.3f, high band %.2e\n", lowPeak, highPeak);
  MW_EXPECT(lowPeak > 0.9);
  // 50 Hz is more than two octaves below the 220 Hz corner and four below
  // 3200, so at 24 dB/oct the high band should hold essentially nothing.
  MW_EXPECT(highPeak < 1.0e-3);
}

MW_TEST("splitting allocates nothing once prepared") {
  ThreeBandSplit split;
  split.prepare(48000.0, 220.0, 3200.0, Slope::Db24);
  {
    mw::test::RtGuard guard;
    double low = 0.0;
    double mid = 0.0;
    double high = 0.0;
    for (int i = 0; i < 4096; ++i) split.process(0.5, low, mid, high);
  }
}

MW_TEST("a filter fed silence flushes rather than stalling in denormals") {
  // `fx-01` V10 in its unit form. A biquad decaying toward zero passes through
  // the denormal range, where some hardware traps into microcode and a 40 µs
  // block becomes milliseconds. The flush is explicit here rather than left to
  // `-ffast-math`, because the tests are deliberately built without it.
  Biquad b;
  b.setCoeffs(lowpassCoeffs(1000.0, kButterworthQ, 48000.0));
  b.process(1.0);
  for (int i = 0; i < 100000; ++i) b.process(0.0);
  // After that many zero samples the state must be exactly zero, not merely
  // small: "small" is the denormal range this exists to leave.
  MW_EXPECT_NEAR(b.process(0.0), 0.0, 0.0);
}

MW_TEST("a cutoff driven to the rails does not produce NaN") {
  // A modulated cutoff swept to Nyquist gives `tan(pi/2)` and a coefficient set
  // of infinities, and a filter handed infinities never recovers — it outputs
  // NaN for the rest of the session. The clamp is what stops one automation
  // lane from silencing a track permanently.
  for (const double f : {0.0, -100.0, 24000.0, 48000.0, 1.0e9}) {
    Biquad b;
    b.setCoeffs(lowpassCoeffs(f, kButterworthQ, 48000.0));
    double y = 0.0;
    for (int i = 0; i < 256; ++i) y = b.process(std::sin(static_cast<double>(i) * 0.1));
    MW_EXPECT(std::isfinite(y));
  }
}

MW_TEST("an all-pass passes every frequency at unity") {
  // The property the three-band compensation depends on. If this section had
  // magnitude ripple it would put the ripple onto the low band, which is the
  // opposite of its job.
  Biquad ap;
  ap.setCoeffs(allpassCoeffs(3200.0, kButterworthQ, 48000.0));
  for (const int bin : sweepBins(48000.0)) {
    MW_EXPECT_NEAR(ap.magnitudeAt(binHz(bin, 48000.0), 48000.0), 1.0, 1.0e-9);
  }
}

MW_TEST_MAIN("crossover")
