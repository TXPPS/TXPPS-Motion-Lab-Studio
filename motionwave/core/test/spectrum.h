// Motion Wave — spectral measurement that has to justify itself first.
//
// Directive 06 §1, made into a mechanism rather than a rule to remember:
//
//   Any alias or spectral measurement must state its bin width and prove the
//   alias grid is resolvable from the signal grid before reporting a number. A
//   measurement that cannot separate alias from signal is not a measurement.
//
// This exists because the alternative already happened. Measuring the Motion
// Shaper's alias floor at N = 4096 gave 11.72 Hz bins; the closest alias sits
// 10 Hz from a legitimate sideband, so the two shared a bin and the number was
// the sideband. Three attempts were spent on that, and one of them concluded —
// wrongly — that the sheet's own test frequency was unusable. It was not: 46000
// is not a multiple of 90, so alias and signal are never coincident, only
// closer together than the transform could see.
//
// The failure is invisible from the number alone. −53 dBFS looks like a
// measurement. So `resolvable()` is checked before any figure is reported, and
// `spuriousFloor` refuses rather than returning something plausible.
#pragma once

#include <cmath>
#include <cstdio>
#include <vector>
#include <cstddef>

#include "../dsp/fft.h"

namespace mw::test {

/// What a spectral measurement is being asked to separate.
struct SpectrumPlan {
  double sampleRate = 48000.0;
  /// Transform length. Bin width is `sampleRate / length`.
  std::size_t length = 32768;
  /// Carrier, or 0 for a signal that is only the modulator.
  double carrierHz = 1000.0;
  /// Spacing of the legitimate sidebands.
  double spacingHz = 90.0;

  double binWidth() const { return sampleRate / static_cast<double>(length); }

  /**
   * The closest an alias can sit to a legitimate sideband, in Hz.
   *
   * Sidebands live at `carrier + m·spacing`. Those above Nyquist fold to
   * `sampleRate − carrier − m·spacing`, so the question is how near a folded
   * one can come to an unfolded one. When the two grids are commensurate the
   * answer is zero and no transform length helps; when they are not, it is a
   * fixed non-zero gap and the transform simply has to be long enough.
   */
  double closestAliasGap() const {
    const double nyquist = sampleRate * 0.5;
    double best = sampleRate;
    for (int m = 1; m < 4000; ++m) {
      const double folded = sampleRate - carrierHz - static_cast<double>(m) * spacingHz;
      if (folded <= 0.0) break;
      if (folded > nyquist) continue;
      for (int n = 0; n < 4000; ++n) {
        const double side = carrierHz + static_cast<double>(n) * spacingHz;
        if (side > nyquist) break;
        const double gap = std::fabs(folded - side);
        if (gap > 1.0e-9 && gap < best) best = gap;
      }
    }
    return best;
  }

  /// True when the transform can tell an alias from a sideband.
  ///
  /// Two bins of margin rather than one: a Hann window spreads energy over
  /// roughly three bins, so a gap of exactly one bin is still a shared peak.
  bool resolvable() const { return closestAliasGap() >= 3.0 * binWidth(); }

  /// The line a measurement prints before its number, so a reader can check it.
  void describe(const char* label) const {
    std::printf("    %s: N=%zu, bin %.2f Hz, closest alias-to-sideband gap %.2f Hz — %s\n", label,
                length, binWidth(), closestAliasGap(),
                resolvable() ? "resolvable" : "NOT RESOLVABLE");
  }
};

/**
 * Largest spurious component, in dBFS, or a refusal.
 *
 * Returns `+1.0` — an impossible dBFS value — when the plan cannot separate
 * alias from signal. A caller that ignores that gets a number no assertion will
 * accept, which is the intended outcome: the alternative is a plausible figure
 * that means nothing.
 *
 * `offset` skips the render's start so filters and ramps have settled, which is
 * the other standing rule this file inherits.
 */
inline double spuriousFloorDb(const std::vector<float>& samples, const SpectrumPlan& plan,
                              int offset) {
  if (!plan.resolvable()) return 1.0;
  const std::size_t n = plan.length;
  if (samples.size() < static_cast<std::size_t>(offset) + n) return 1.0;

  std::vector<double> window(n);
  const double coherentGain = mw::dsp::blackmanHarrisWindow(window);

  std::vector<double> re(n);
  std::vector<double> im(n, 0.0);
  for (std::size_t i = 0; i < n; ++i) {
    re[i] = static_cast<double>(samples[static_cast<std::size_t>(offset) + i]) * window[i];
  }
  mw::dsp::fft(re, im);

  // A bin is legitimate if it holds the carrier or any sideband, within the
  // window's own skirt. Four bins rather than three: a Blackman-Harris main
  // lobe is twice as wide as a Hann one, which is the price of its far lower
  // sidelobes and has to be paid here rather than pretended away.
  const double bin = plan.binWidth();
  const double skirt = 4.0 * bin;
  double worst = 0.0;
  for (std::size_t k = 1; k < n / 2; ++k) {
    const double f = static_cast<double>(k) * bin;
    bool legitimate = std::fabs(f - plan.carrierHz) < skirt || f < skirt;
    for (int side = 1; !legitimate && side < 4000; ++side) {
      const double up = plan.carrierHz + static_cast<double>(side) * plan.spacingHz;
      // The lower sideband keeps going past DC and comes back up the other
      // side: `carrier − n·spacing` at n = 12 is −80 Hz, which appears at
      // +80 Hz and is ordinary signal. Taking the absolute value is what makes
      // that so. Skipping the negative ones instead — which is what this did
      // first — counts every reflected lower sideband as spurious, and those
      // are low-order and strong. It is why the alias floor read −40 dBFS
      // whether the modulator was oversampled eight times or not at all: the
      // number was never measuring aliasing.
      const double down = std::fabs(plan.carrierHz - static_cast<double>(side) * plan.spacingHz);
      if (up > plan.sampleRate * 0.5 && down > plan.sampleRate * 0.5) break;
      if (std::fabs(f - up) < skirt) legitimate = true;
      if (std::fabs(f - down) < skirt) legitimate = true;
    }
    if (legitimate) continue;
    const double mag = 2.0 * std::sqrt(re[k] * re[k] + im[k] * im[k]) / coherentGain;
    if (mag > worst) worst = mag;
  }
  return worst <= 1.0e-10 ? -200.0 : 20.0 * std::log10(worst);
}

/**
 * Largest spurious component against an explicit list of legitimate lines.
 *
 * `spuriousFloorDb` above models the legitimate set as a carrier with evenly
 * spaced sidebands, which is what a modulator produces. A pitch shifter does
 * not: its outputs sit at `f·2^(s/12)` for the semitone offsets in the set, a
 * geometric grid no spacing parameter can describe. Passing that grid in
 * explicitly is the difference between measuring the shifter's aliasing and
 * measuring its output.
 *
 * Returns `+1.0` — an impossible dBFS value, which no assertion will accept —
 * when two legitimate lines sit closer together than the window can separate,
 * or when a legitimate line's own image would be indistinguishable from it. The
 * refusal is the point: a spectral measurement never looks broken, so it has to
 * say so itself.
 */
inline double spuriousFloorAgainst(const std::vector<float>& samples, double sampleRate,
                                   std::size_t length, const std::vector<double>& legitimateHz,
                                   int offset) {
  const double bin = sampleRate / static_cast<double>(length);
  const double skirt = 4.0 * bin;
  if (samples.size() < static_cast<std::size_t>(offset) + length) return 1.0;
  // Two legitimate lines closer than two skirts share a peak, and a set that
  // cannot be resolved cannot have anything excluded from it.
  for (std::size_t i = 0; i < legitimateHz.size(); ++i) {
    for (std::size_t j = i + 1; j < legitimateHz.size(); ++j) {
      if (std::fabs(legitimateHz[i] - legitimateHz[j]) < 2.0 * skirt) return 1.0;
    }
  }

  std::vector<double> window(length);
  const double coherentGain = mw::dsp::blackmanHarrisWindow(window);
  std::vector<double> re(length);
  std::vector<double> im(length, 0.0);
  for (std::size_t i = 0; i < length; ++i) {
    re[i] = static_cast<double>(samples[static_cast<std::size_t>(offset) + i]) * window[i];
  }
  mw::dsp::fft(re, im);

  double worst = 0.0;
  for (std::size_t k = 1; k < length / 2; ++k) {
    const double f = static_cast<double>(k) * bin;
    // DC's own skirt is excluded for the same reason it is above: a DC term
    // dominates the bins next to it and has nothing to do with aliasing.
    bool legitimate = f < skirt;
    for (double line : legitimateHz) {
      if (std::fabs(f - line) < skirt) {
        legitimate = true;
        break;
      }
    }
    if (legitimate) continue;
    const double mag = 2.0 * std::sqrt(re[k] * re[k] + im[k] * im[k]) / coherentGain;
    if (mag > worst) worst = mag;
  }
  return worst <= 1.0e-10 ? -200.0 : 20.0 * std::log10(worst);
}

/**
 * Render a test signal and measure it, for validating the instrument itself.
 *
 * Four separate errors were made in this measurement before it was trusted —
 * a transform too short to resolve the grids, an exclusion set too narrow, a
 * DC term dominating its own window skirt, and lower sidebands counted as
 * spurious once they reflected through zero. Every one of them produced a
 * plausible number, which is exactly what makes a spectral measurement
 * dangerous: it never looks broken.
 *
 * So the instrument is calibrated against signals whose answer is known. A pure
 * tone at the carrier must read essentially silent, and a signal with a
 * deliberate out-of-band component must read that component. A measurement that
 * cannot pass both is not measuring what it claims.
 */
inline std::vector<float> syntheticTone(double hz, double sampleRate, std::size_t n,
                                        double amplitude = 0.5) {
  std::vector<float> out(n);
  for (std::size_t i = 0; i < n; ++i) {
    out[i] = static_cast<float>(
        amplitude * std::sin(2.0 * 3.14159265358979323846 * hz * static_cast<double>(i) / sampleRate));
  }
  return out;
}

}  // namespace mw::test
