// Motion Wave — the Normal tier's octave pyramid.
//
// `smp-01` §4.2's second remedy for upward-transposition aliasing: decimate
// the zone into an octave pyramid at load and read from the level whose
// Nyquist is above the bandwidth the read ratio leaves. Three levels cost
// `1/2 + 1/4 + 1/8` of the zone — the +87.5 % of §10.2 — and every one of
// those bytes is spent off the audio thread, at load, once.
//
// Half-band decimation with a proper filter, because a decimation that keeps
// every other sample without one does not remove the top octave, it folds it,
// and the pyramid would then be a table of pre-aliased copies. The filter is a
// Kaiser-windowed half-band sinc: 95 taps, beta 9, so its stopband is near
// −90 dB and its transition spans about ±3 % of the input rate around the
// quarter-rate corner — content up to 87 % of the new level's Nyquist passes
// flat. `sample_mipmap_tests` measures both figures rather than trusting them.
//
// A level is phase-aligned with the one above it: level `l`'s sample `j` is
// the filtered signal at level-0 frame `j << l`, because the filter is
// symmetric about the kept sample. The read head relies on that to keep one
// position, in level-0 frames, for every level.
#pragma once

#include <cmath>
#include <cstddef>
#include <vector>

namespace mw::dsp::sample {

/// Levels below the zone's own rate. Level 0 is the zone; levels 1–3 live here.
inline constexpr int kMipLevels = 3;
/// Half-band filter length. Odd, so the kept sample sits under the centre tap.
inline constexpr int kHalfBandTaps = 95;
/// Kaiser parameter for the half-band window; about −90 dB of stopband.
inline constexpr double kHalfBandBeta = 9.0;

/// The zeroth-order modified Bessel function, by its power series.
inline double halfBandBessel(double x) noexcept {
  const double half = 0.5 * x;
  double term = 1.0;
  double sum = 1.0;
  for (int k = 1; k < 200; ++k) {
    const double step = half / static_cast<double>(k);
    term *= step * step;
    sum += term;
    if (term < sum * 1.0e-17) break;
  }
  return sum;
}

/**
 * The half-band taps, centre first at index `kHalfBandTaps / 2`, normalised to
 * unit DC gain so a level neither gains nor loses level against the zone.
 *
 * `sinc(n / 2) / 2` is zero at every even non-zero `n`, which is what makes
 * this a half-band filter: about half the taps are exactly zero and the build
 * skips them. Exposed so a test can grade the design the build actually uses.
 */
inline std::vector<double> halfBandTaps() {
  std::vector<double> taps(static_cast<std::size_t>(kHalfBandTaps), 0.0);
  const int centre = kHalfBandTaps / 2;
  const double denominator = halfBandBessel(kHalfBandBeta);
  double sum = 0.0;
  for (int i = 0; i < kHalfBandTaps; ++i) {
    const double n = static_cast<double>(i - centre);
    const double u = n / static_cast<double>(centre + 1);
    const double window = halfBandBessel(kHalfBandBeta * std::sqrt(1.0 - u * u)) / denominator;
    const double x = 0.5 * n;
    const double sinc = n == 0.0 ? 1.0 : std::sin(3.14159265358979323846 * x) /
                                             (3.14159265358979323846 * x);
    taps[static_cast<std::size_t>(i)] = 0.5 * sinc * window;
    sum += taps[static_cast<std::size_t>(i)];
  }
  for (double& t : taps) t /= sum;
  return taps;
}

class MipMap {
 public:
  /**
   * Builds every level from the zone's data. Allocates, and is therefore a
   * load-time call: `sample_loop_tests` arms `RtGuard` around it to prove the
   * guard is awake, which is the same fact stated the other way round.
   *
   * Building stops early when a level would be shorter than four samples — a
   * zone that short has nothing above its top octave worth removing, and a
   * read head would spend more taps outside the buffer than in it.
   */
  void build(const float* data, std::size_t frames) {
    const std::vector<double> taps = halfBandTaps();
    const int centre = kHalfBandTaps / 2;
    built_ = 0;
    const float* in = data;
    std::size_t inFrames = frames;
    for (int level = 0; level < kMipLevels; ++level) {
      const std::size_t outFrames = (inFrames + 1) / 2;
      if (in == nullptr || outFrames < 4) break;
      std::vector<float>& out = levels_[static_cast<std::size_t>(level)];
      out.assign(outFrames, 0.0f);
      for (std::size_t j = 0; j < outFrames; ++j) {
        const long long at = static_cast<long long>(j) * 2;
        double acc = 0.0;
        for (int t = 0; t < kHalfBandTaps; ++t) {
          const double h = taps[static_cast<std::size_t>(t)];
          if (h == 0.0) continue;
          const long long k = at + static_cast<long long>(t - centre);
          if (k < 0 || k >= static_cast<long long>(inFrames)) continue;
          acc += h * static_cast<double>(in[static_cast<std::size_t>(k)]);
        }
        out[j] = static_cast<float>(acc);
      }
      in = out.data();
      inFrames = outFrames;
      built_ = level + 1;
    }
  }

  /// How many levels below the zone exist: 0 when nothing was built.
  int levels() const noexcept { return built_; }

  /// Level `l` in 1..levels(). Null outside that range, so a read head that
  /// asks for a level it was not told about reads nothing rather than memory.
  const float* level(int l) const noexcept {
    return (l >= 1 && l <= built_) ? levels_[static_cast<std::size_t>(l - 1)].data() : nullptr;
  }

  std::size_t frames(int l) const noexcept {
    return (l >= 1 && l <= built_) ? levels_[static_cast<std::size_t>(l - 1)].size() : 0;
  }

  /**
   * The level whose Nyquist is above the bandwidth a read at `rate` leaves.
   *
   * A ratio `r` leaves `fs / (2 r)`; level `l`'s Nyquist is `fs / 2^(l + 1)`,
   * so the rule is the largest `l` with `2^l < r`, and none at all at or below
   * two — §4.2 says the pyramid is for more than an octave up and plain
   * Hermite below. A loop rather than a logarithm, because whether `log2(4.0)`
   * is exactly two is a question about the host's libm and not about audio.
   */
  static int levelFor(double rate, int available) noexcept {
    double speed = rate < 0.0 ? -rate : rate;
    int level = 0;
    while (level < available && speed > 2.0) {
      speed *= 0.5;
      ++level;
    }
    return level;
  }

 private:
  std::vector<float> levels_[kMipLevels];
  int built_ = 0;
};

}  // namespace mw::dsp::sample
