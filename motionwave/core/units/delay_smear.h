// Motion Wave — the Granular Delay's Smear continuum.
//
// `fx-03` §4 makes this one control on purpose: grains-per-tap, position spray,
// onset jitter and grain length only make sense moved together, and a panel
// offering four of them would let a user build settings that are simply broken.
//
// Note the direction, which is the opposite of the obvious one: **as smear
// rises, grains get shorter and more numerous.** That is what walks the tap
// across the 50 ms fusion threshold `fx-02` §1.1 documents — above it grains are
// heard as separate events, below it they fuse into a cloud — so the control is
// literally a traverse of a perceptual boundary, and the crossing point is worth
// marking on the face.
#pragma once

#include <cmath>

namespace mw::units::delay {

struct SmearSettings {
  int grainsPerTap = 1;
  double spraySeconds = 0.0;
  double onsetJitter = 0.0;
  double grainSeconds = 0.0;  ///< Zero means the window is bypassed entirely.

  /// True when the tap must reduce to a plain interpolated read.
  bool bypassed() const noexcept { return grainSeconds <= 0.0; }
};

/**
 * §4's table, interpolated between its five stated points.
 *
 * Interpolated rather than stepped because the sheet calls it a continuum and
 * the four quantities are meant to move together and smoothly; a stepped
 * version would put four simultaneous discontinuities at each of four settings,
 * which is audible as a lurch rather than as a sweep.
 *
 * **Zero is exact and is not the bottom of an interpolation.** §4: "Smear = 0
 * must be bit-exact identical to a conventional delay tap", and V2 nulls the
 * whole path against a plain interpolated delay at −140 dBFS to prove it. An
 * interpolation that merely approached one grain with no spray would leave the
 * granular machinery quietly colouring the plain delay, which is the one thing
 * this control must not do — so the bypass is a branch, not a limit.
 */
inline SmearSettings smearAt(double amount) noexcept {
  SmearSettings out;
  const double a = amount < 0.0 ? 0.0 : (amount > 1.0 ? 1.0 : amount);
  if (a <= 0.0) return out;  // Window bypassed: one continuous grain, no spray.

  // §4's rows at 25, 50, 75 and 100 %, with the 0 % row present only as the
  // start of the ramp — the real 0 % is the branch above.
  static constexpr double kAt[5] = {0.0, 0.25, 0.50, 0.75, 1.00};
  static constexpr double kGrains[5] = {1.0, 3.0, 8.0, 16.0, 32.0};
  static constexpr double kSpray[5] = {0.0, 0.015, 0.060, 0.150, 0.400};
  static constexpr double kJitter[5] = {0.0, 0.10, 0.35, 0.60, 1.00};
  static constexpr double kLength[5] = {0.120, 0.120, 0.080, 0.055, 0.035};

  int segment = 0;
  while (segment < 3 && a > kAt[segment + 1]) ++segment;
  const double span = kAt[segment + 1] - kAt[segment];
  const double t = span > 0.0 ? (a - kAt[segment]) / span : 0.0;
  auto lerp = [t](const double* table, int at) {
    return table[at] + (table[at + 1] - table[at]) * t;
  };

  // Rounded, not truncated: at 0.99 the grain count would otherwise read 31
  // rather than 32, and the count is what the pool is sized against.
  out.grainsPerTap = static_cast<int>(lerp(kGrains, segment) + 0.5);
  if (out.grainsPerTap < 1) out.grainsPerTap = 1;
  out.spraySeconds = lerp(kSpray, segment);
  out.onsetJitter = lerp(kJitter, segment);
  out.grainSeconds = lerp(kLength, segment);
  return out;
}

/**
 * The overlap a tap runs at, which is what the amplitude normalisation needs.
 *
 * `fx-02` §1.3's `A = 1/sqrt(O · mean(w²))` applies per tap, with `O` =
 * grains-per-tap × (grainLength / hop). Without it Smear changes the level and,
 * worse, changes the loop gain — which changes the decay time. That is V6, and
 * it is the same failure `fx-02` V6 grades one unit over.
 */
inline double overlapFor(const SmearSettings& smear, double hopSeconds) noexcept {
  if (smear.bypassed() || hopSeconds <= 0.0) return 1.0;
  return static_cast<double>(smear.grainsPerTap) * smear.grainSeconds / hopSeconds;
}

}  // namespace mw::units::delay
