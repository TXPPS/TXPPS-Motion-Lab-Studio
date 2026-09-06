// Motion Wave — the High tier's windowed-sinc interpolation table.
//
// `smp-01` §4.2: a windowed sinc stored at high phase resolution, shifted to
// the fractional read position, every input sample under the kernel multiplied
// and summed. The sheet marks the design constants — 16 taps, 512 phases, a
// Kaiser window — as [I], and §13 item 4 says to design them against V-3 and
// record what was chosen. This header is that record.
//
// **What was chosen, and what it measured.** The kernel is `sinc(x)` for
// |x| < 8 under a Kaiser window, tabulated 512 times per unit of `x` — one
// half, since it is symmetric — so a fractional phase is a linear blend of two
// adjacent entries. The window's `beta` was chosen from the continuous
// kernel's own transform, computed for 16 taps at each candidate (all figures
// relative to the input rate `fs`, response in dB):
//
//     beta   worst |H| on [0.75, 4]   H(0.979 fs)   H(0.708 fs)   -1 dB   -3 dB
//     10.0        -100.1                 -107          -101       0.423   0.465
//     10.5        -104.7                 -112           -99       0.421   0.464
//     11.0        -109.3                 -118           -84       0.419   0.464
//     12.0        -118.1                 -135           -71       0.415   0.462
//
// V-3's stimulus is a 1 kHz tone, whose first image at 44.1–192 kHz falls at
// 0.977–0.995 fs, so every row would pass the row it is graded by. The far
// stopband is what a low tone's images meet and the near stopband (0.6–0.75
// fs) is what a bright sample's images meet, and they pull against each other
// through the transition width: beta 10 has no margin on the first and beta 11
// gives back 15 dB on the second. **beta = 10.5** sits where both are at or
// below −99 dB. Sixteen taps therefore do reach −100 dBc under V-3, and the
// tap count stays at the sheet's number rather than a wider one of ours.
//
// **The cutoff is exactly `0.5 fs`**, not a margin below it. `sinc(n) = 0` at
// every non-zero integer, so the zero-phase row of the table is the identity
// and a read at an integer position returns the sample itself — which is what
// V-1 requires at r = 1 and what a cutoff of, say, `0.45 fs` would quietly
// break. The price is that the transition band straddles the fold corner when
// the kernel is stretched (below): content within about 0.2 fs/r of the corner
// is partly attenuated and partly folded, measured in `sample_sinc_tests`.
//
// **The stretched kernel.** Reading at `r > 1` moves input content above
// `fs/(2r)` past the output's Nyquist, where it folds. Evaluating the same
// prototype at `x / r` scales the kernel in time by `r`, which lowers its
// cutoff to `0.5 fs / r` — the sheet's first remedy — at the cost of `16 r`
// taps. One curve serves every ratio, exactly as the grain engine's prototype
// does; the two tables differ only in their window and in the alias floor each
// is graded to.
#pragma once

#include <cmath>
#include <cstddef>
#include <vector>

namespace mw::dsp::sample {

/// Lobes either side of centre: sixteen taps at unity, `16 r` when stretched.
inline constexpr int kSincHalfWidth = 8;
/// Phases per unit of `x`. The table index of a distance `x` is `x * this`.
inline constexpr int kSincPhases = 512;
/// One entry per phase step out to the kernel's edge, plus the edge itself,
/// which is exactly zero so an interpolation that reaches it reads a true zero.
inline constexpr int kSincPoints = kSincHalfWidth * kSincPhases + 1;
/// The Kaiser parameter. See the table in the header comment.
inline constexpr double kSincKaiserBeta = 10.5;

/**
 * The most the kernel is allowed to stretch.
 *
 * Above this ratio the kernel stops widening and its cutoff stops tracking
 * `fs/(2r)`, so content between `fs/(2 kMaxStretch)` and `fs/(2r)` folds.
 * Sixty-four is six octaves up — key 127 on a zone rooted at 55 — and costs
 * 1024 taps per output sample there, which is bounded work. An unbounded
 * kernel is not a quieter artefact; on the audio thread it is a missed
 * deadline. Where it runs out is stated here rather than widened into a claim.
 */
inline constexpr double kMaxStretch = 64.0;

/// The zeroth-order modified Bessel function, by its power series. Used at
/// construction only.
inline double besselI0(double x) noexcept {
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
 * Builds its table at construction — the only allocation this tier makes —
 * and is shared by every voice of an instrument thereafter. Nothing in `read`
 * or `readStretched` allocates, locks, logs or touches a file.
 */
class SincTable {
 public:
  SincTable() : table_(static_cast<std::size_t>(kSincPoints), 0.0f) {
    const double denominator = besselI0(kSincKaiserBeta);
    for (int i = 0; i < kSincPoints; ++i) {
      const double x = static_cast<double>(i) / static_cast<double>(kSincPhases);
      const double u = x / static_cast<double>(kSincHalfWidth);
      const double window = u >= 1.0 ? 0.0 : besselI0(kSincKaiserBeta * std::sqrt(1.0 - u * u)) /
                                                 denominator;
      const double sinc = x == 0.0 ? 1.0 : std::sin(3.14159265358979323846 * x) /
                                               (3.14159265358979323846 * x);
      table_[static_cast<std::size_t>(i)] = static_cast<float>(sinc * window);
    }
    // The edge is zero by the window's definition; stating it removes the
    // rounding question for the guard read below.
    table_[static_cast<std::size_t>(kSincPoints - 1)] = 0.0f;
  }

  /// The prototype at table index `i`, for tests that grade the table itself.
  float entry(int i) const noexcept { return table_[static_cast<std::size_t>(i)]; }

  /// The kernel at a distance `x` (in input samples, either sign), by linear
  /// blend of the two nearest phases. Zero beyond the edge.
  double at(double x) const noexcept {
    const double scaled = std::fabs(x) * static_cast<double>(kSincPhases);
    const int index = static_cast<int>(scaled);
    if (index >= kSincPoints - 1) return 0.0;
    const double blend = scaled - static_cast<double>(index);
    return static_cast<double>(table_[static_cast<std::size_t>(index)]) * (1.0 - blend) +
           static_cast<double>(table_[static_cast<std::size_t>(index + 1)]) * blend;
  }

  /// Taps either side of the read position for a given ratio: eight at or
  /// below unity, `ceil(8 r)` above it, `8 kMaxStretch` at most.
  static int halfWidthFor(double rate) noexcept {
    const double speed = rate < 0.0 ? -rate : rate;
    if (speed <= 1.0) return kSincHalfWidth;
    const double capped = speed > kMaxStretch ? kMaxStretch : speed;
    return static_cast<int>(std::ceil(static_cast<double>(kSincHalfWidth) * capped));
  }

  /**
   * One interpolated sample at integer index `index` plus `fraction`, reading
   * taps through `fetch(i)`, which returns the source sample at absolute
   * index `i` under whatever wrap rule the caller applies.
   *
   * `rate` is the magnitude of the read increment. At or below unity the
   * kernel is the prototype itself; above it the prototype is evaluated at
   * `x / rate`, which is the stretch described at the top of the file.
   *
   * Normalised by the sum of the taps actually used rather than by the closed
   * form: the closed form assumes the whole kernel is present, and above
   * `kMaxStretch` it is not. Dividing by the realised sum keeps the read at
   * unity gain for a constant input whatever the bound did, and at zero
   * fraction that sum is exactly one — the identity row — so the exact path is
   * exact here too.
   */
  template <typename Fetch>
  float read(Fetch&& fetch, long long index, double fraction, double rate) const noexcept {
    const double speed = rate < 0.0 ? -rate : rate;
    const double stretch = speed <= 1.0 ? 1.0 : (speed > kMaxStretch ? kMaxStretch : speed);
    const int half = halfWidthFor(speed);
    const double perStep = static_cast<double>(kSincPhases) / stretch;
    double sum = 0.0;
    double weight = 0.0;
    for (int tap = -half + 1; tap <= half; ++tap) {
      const double scaled = std::fabs(static_cast<double>(tap) - fraction) * perStep;
      const int i = static_cast<int>(scaled);
      if (i >= kSincPoints - 1) continue;
      const double blend = scaled - static_cast<double>(i);
      const double h = static_cast<double>(table_[static_cast<std::size_t>(i)]) * (1.0 - blend) +
                       static_cast<double>(table_[static_cast<std::size_t>(i + 1)]) * blend;
      sum += h * static_cast<double>(fetch(index + static_cast<long long>(tap)));
      weight += h;
    }
    return weight > 1.0e-9 ? static_cast<float>(sum / weight) : 0.0f;
  }

 private:
  std::vector<float> table_;
};

}  // namespace mw::dsp::sample
