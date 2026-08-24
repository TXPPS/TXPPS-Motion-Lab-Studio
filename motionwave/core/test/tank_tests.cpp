// Motion Wave — the shared diffusion tank.
//
// This component exists because `fx-02` V7 measured 0.9 normalised echo density
// at 125 ms against its sheet's 80 ms, and because echo density is a property
// of the diffusion architecture rather than of the unit — so `fx-03` would have
// hit the same wall with the same series chain. It is therefore measured here,
// on its own, before either unit adopts it: a component that fixes a row in one
// unit and is only ever measured through that unit cannot be reasoned about
// from the other.
#include "../dsp/tank.h"
#include "harness.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>

using namespace mw::dsp;

namespace {

constexpr double kRate = 48000.0;
constexpr double kGaussianFraction = 0.3173;

/// Abel and Huang's normalised echo density over a 20 ms window.
double densityAt(const std::vector<float>& x, std::size_t at) {
  const std::size_t window = static_cast<std::size_t>(kRate * 0.020);
  if (at + window > x.size()) return 0.0;
  double sum = 0.0;
  for (std::size_t i = 0; i < window; ++i) sum += static_cast<double>(x[at + i]);
  const double mean = sum / static_cast<double>(window);
  double variance = 0.0;
  for (std::size_t i = 0; i < window; ++i) {
    const double d = static_cast<double>(x[at + i]) - mean;
    variance += d * d;
  }
  const double sd = std::sqrt(variance / static_cast<double>(window));
  if (sd <= 0.0) return 0.0;
  int above = 0;
  for (std::size_t i = 0; i < window; ++i) {
    if (std::fabs(static_cast<double>(x[at + i]) - mean) > sd) ++above;
  }
  return (static_cast<double>(above) / static_cast<double>(window)) / kGaussianFraction;
}

/// Milliseconds at which the density first reaches 0.9, or −1.
double reaches(const std::vector<float>& x, double target) {
  const std::size_t window = static_cast<std::size_t>(kRate * 0.020);
  const std::size_t step = static_cast<std::size_t>(kRate * 0.001);
  for (std::size_t at = 0; at + window <= x.size(); at += step) {
    if (densityAt(x, at) >= target) {
      // The window describes its own midpoint, not its start.
      return 1000.0 * (static_cast<double>(at) + static_cast<double>(window) * 0.5) / kRate;
    }
  }
  return -1.0;
}

std::vector<float> impulseResponse(DiffusionTank& tank, double seconds) {
  const int frames = static_cast<int>(kRate * seconds);
  std::vector<float> out;
  out.reserve(static_cast<std::size_t>(frames));
  for (int i = 0; i < frames; ++i) {
    const float in = i == 0 ? 1.0f : 0.0f;
    float l = 0.0f;
    float r = 0.0f;
    tank.process(in, in, &l, &r);
    out.push_back(l);
  }
  return out;
}

}  // namespace

MW_TEST("the echo-density instrument is calibrated before it judges anything") {
  /*
   * Every spectral and statistical measurement in this project has needed this,
   * and this one is no exception: the measure returns a plausible number for a
   * signal it is wrong about, so it is run against three signals whose answer is
   * known before it is pointed at the tank.
   *
   * The sine is included because it is the measure's *false positive*: a
   * sinusoid spends most of its time near its extremes, so more than the
   * Gaussian fraction of it lies beyond one standard deviation and it scores
   * above one. A reverb tail is not tonal, so this does not affect the rows
   * below — but a reader who did not know it would misread a tonal input's
   * score as a very diffuse tail.
   */
  const std::size_t n = static_cast<std::size_t>(kRate);
  std::vector<float> gaussian(n);
  std::uint32_t state = 12345u;
  for (std::size_t i = 0; i < n; ++i) {
    double u = 0.0;
    for (int k = 0; k < 12; ++k) {
      state = state * 1664525u + 1013904223u;
      u += static_cast<double>(state >> 8) / 8388608.0;
    }
    gaussian[i] = static_cast<float>(u - 6.0);
  }
  const double noiseScore = densityAt(gaussian, 1000);
  std::printf("    instrument: Gaussian noise reads %.4f (must be ~1.00)\n", noiseScore);
  MW_EXPECT_NEAR(noiseScore, 1.0, 0.05);

  std::vector<float> sparse(n, 0.0f);
  for (std::size_t i = 0; i < n; i += static_cast<std::size_t>(kRate / 20.0)) sparse[i] = 1.0f;
  const double sparseScore = densityAt(sparse, 1000);
  std::printf("    instrument: 20 impulses a second reads %.4f (must be far under 0.9)\n",
              sparseScore);
  MW_EXPECT(sparseScore < 0.2);

  std::vector<float> tail(n);
  std::uint32_t other = 999u;
  for (std::size_t i = 0; i < n; ++i) {
    double u = 0.0;
    for (int k = 0; k < 12; ++k) {
      other = other * 1664525u + 1013904223u;
      u += static_cast<double>(other >> 8) / 8388608.0;
    }
    tail[i] = static_cast<float>((u - 6.0) * std::exp(-3.0 * static_cast<double>(i) / kRate));
  }
  std::printf("    instrument: a decaying Gaussian tail reads %.4f and crosses 0.9 at %.1f ms\n",
              densityAt(tail, 1000), reaches(tail, 0.9));
  MW_EXPECT_NEAR(densityAt(tail, 1000), 1.0, 0.1);
  MW_EXPECT(reaches(tail, 0.9) > 0.0 && reaches(tail, 0.9) < 30.0);
}

MW_TEST("the tank becomes diffuse far faster than a series chain can") {
  /*
   * The claim the tank exists for, measured on the tank alone. A series chain
   * turns one echo into `n`; this turns one echo into a number that grows with
   * every lap, because each pass re-diffuses everything already circulating.
   *
   * The comparison against the series chain is the point of the row rather than
   * a decoration: `fx-02`'s series diffuser is what the reverb ships with today,
   * and "the tank is better" has to be a measurement before it is a reason to
   * change a unit that is otherwise finished.
   */
  DiffusionTank tank;
  tank.prepare(kRate);
  tank.setAmount(1.0);
  tank.setSettleSeconds(0.080);
  tank.reset();
  const std::vector<float> tankIr = impulseResponse(tank, 1.0);
  const double tankAt = reaches(tankIr, 0.9);

  Diffuser series;
  series.prepare(kRate);
  series.setAmount(1.0);
  series.reset();
  std::vector<float> seriesIr;
  seriesIr.reserve(static_cast<std::size_t>(kRate));
  for (int i = 0; i < static_cast<int>(kRate); ++i) {
    seriesIr.push_back(series.process(i == 0 ? 1.0f : 0.0f));
  }
  const double seriesAt = reaches(seriesIr, 0.9);

  std::printf("    tank reaches 0.9 echo density at %.1f ms; the series chain at %.1f ms\n",
              tankAt, seriesAt < 0.0 ? 9999.0 : seriesAt);
  MW_EXPECT(tankAt > 0.0);
  // §9 V7's target with its stated tolerance, on the component itself.
  MW_EXPECT(tankAt <= 80.0);
  // And decisively better than what it replaces, which is why a finished unit
  // is worth changing for it.
  MW_EXPECT(seriesAt < 0.0 || tankAt < seriesAt * 0.5);
}

MW_TEST("the tank's own tail settles where it was asked to, so it is not a second reverb") {
  /*
   * A tank with a long internal decay is a reverb, and a reverb in series with
   * a reverb adds its decay to the one the Decay control sets. That is the
   * failure that makes "add a tank" the wrong instruction; the settling time is
   * therefore derived from the lap time rather than chosen, and this row checks
   * the derivation against the tank's actual decay.
   */
  const double asked[3] = {0.040, 0.080, 0.200};
  for (double seconds : asked) {
    DiffusionTank tank;
    tank.prepare(kRate);
    tank.setAmount(1.0);
    tank.setSettleSeconds(seconds);
    tank.reset();
    const std::vector<float> ir = impulseResponse(tank, 2.0);

    // Time to fall 60 dB below the peak, measured on a 10 ms sliding RMS.
    const std::size_t window = static_cast<std::size_t>(kRate * 0.010);
    double peak = 0.0;
    std::vector<double> levels;
    for (std::size_t at = 0; at + window <= ir.size(); at += window) {
      double sum = 0.0;
      for (std::size_t i = 0; i < window; ++i) {
        sum += static_cast<double>(ir[at + i]) * static_cast<double>(ir[at + i]);
      }
      const double level = std::sqrt(sum / static_cast<double>(window));
      levels.push_back(level);
      peak = std::max(peak, level);
    }
    double settled = -1.0;
    for (std::size_t i = 0; i < levels.size(); ++i) {
      if (levels[i] > 0.0 && 20.0 * std::log10(levels[i] / peak) <= -60.0) {
        settled = static_cast<double>(i) * 0.010;
        break;
      }
    }
    std::printf("    settle asked %.0f ms — measured %.0f ms\n", 1000.0 * seconds,
                1000.0 * settled);
    MW_EXPECT(settled > 0.0);
    // Within a factor of two, which is as tight as a 60 dB decay measured on a
    // 10 ms window can be held, and far tighter than the failure it guards
    // against — a tank whose tail was the reverb's would be out by ten.
    MW_EXPECT(settled >= seconds * 0.5 && settled <= seconds * 2.0);
  }
}

MW_TEST("the tank decorrelates the pair rather than duplicating it") {
  /*
   * §2.3 asks for different lengths per channel because a stereo pair through
   * one diffuser comes out correlated, which is a mono signal wearing a stereo
   * field. The figure-eight gives each half its own lengths and its own taps, so
   * this is a check that the arrangement did what it is for.
   */
  DiffusionTank tank;
  tank.prepare(kRate);
  tank.setAmount(1.0);
  tank.setSettleSeconds(0.080);
  tank.reset();
  const int frames = static_cast<int>(kRate * 0.5);
  std::vector<double> l;
  std::vector<double> r;
  for (int i = 0; i < frames; ++i) {
    const float in = i == 0 ? 1.0f : 0.0f;
    float left = 0.0f;
    float right = 0.0f;
    tank.process(in, in, &left, &right);
    l.push_back(static_cast<double>(left));
    r.push_back(static_cast<double>(right));
  }
  double num = 0.0;
  double dl = 0.0;
  double dr = 0.0;
  for (int i = 0; i < frames; ++i) {
    num += l[static_cast<std::size_t>(i)] * r[static_cast<std::size_t>(i)];
    dl += l[static_cast<std::size_t>(i)] * l[static_cast<std::size_t>(i)];
    dr += r[static_cast<std::size_t>(i)] * r[static_cast<std::size_t>(i)];
  }
  const double correlation = num / std::sqrt(dl * dr + 1.0e-30);
  std::printf("    a mono impulse comes out with L/R correlation %.4f\n", correlation);
  MW_EXPECT(std::fabs(correlation) < 0.5);
  // And both channels carry signal: two uncorrelated silences correlate at
  // nothing too.
  MW_EXPECT(dl > 1.0e-6 && dr > 1.0e-6);
}

MW_TEST_MAIN("tank")
