// Motion Wave — the one shaping function the nonlinear library is built on.
//
// `lib-nonlinear.md` §4.1. Every harmonic threshold in that document's §7 is
// derived from *this* expansion, which is why the curve is defined as a
// specific rational form rather than as "an approximation to tanh":
//
//     R(u) = u·(27 + u²) / (27 + 9u²),   u clamped to [−3, +3]
//
// Expanding about the origin gives R(u) = u − (8/27)u³ + O(u⁵), so a symmetric
// stage's third harmonic is 0.0741·A². Tanh's is 0.0833·A². The 11 % between
// them is 1 dB, and swapping one for the other later would fail four
// calibration tests for a reason nobody would find — the tests would be right
// and the curve would be right and only the pairing would be wrong.
//
// The clamp is what makes it bounded. Without it the rational grows as u/9 and
// a limiter built on it would have no limit. At the clamp R(±3) = ±1 exactly,
// which is why the saturation point needs no separate constant.
#pragma once

#include <cmath>

namespace mw::dsp::nl {

/// Where the curve stops. Beyond it the rational is no longer compressive.
inline constexpr float kCurveLimit = 3.0f;

/// The shaping function.
inline float curve(float u) noexcept {
  const float c = u < -kCurveLimit ? -kCurveLimit : (u > kCurveLimit ? kCurveLimit : u);
  const float uu = c * c;
  return c * (27.0f + uu) / (27.0f + 9.0f * uu);
}

/// First three derivatives at an operating point, in closed form.
struct CurveDerivatives {
  float first = 1.0f;
  float second = 0.0f;
  float third = 0.0f;
};

/**
 * Derivatives of `curve`, from the quotient rather than from a series.
 *
 * `D·R = N` differentiated by Leibniz gives each derivative in terms of the
 * lower ones, which is exact everywhere in the range and costs three divides.
 * A truncated series would agree near the origin and drift where these stages
 * actually run — the operating points in §4 sit at a twentieth of the limit,
 * but the drive sweeps in NL-02 reach six times that.
 */
inline CurveDerivatives curveDerivatives(float u0) noexcept {
  const float u = u0 < -kCurveLimit ? -kCurveLimit : (u0 > kCurveLimit ? kCurveLimit : u0);
  const float uu = u * u;
  const float d = 27.0f + 9.0f * uu;
  const float d1 = 18.0f * u;
  const float d2 = 18.0f;
  const float n = 27.0f * u + u * uu;
  const float n1 = 27.0f + 3.0f * uu;
  const float n2 = 6.0f * u;
  const float n3 = 6.0f;

  CurveDerivatives out;
  const float r = n / d;
  out.first = (n1 - r * d1) / d;
  out.second = (n2 - 2.0f * out.first * d1 - r * d2) / d;
  // The third derivative of the denominator is zero, so the Leibniz term for it
  // is absent rather than omitted.
  out.third = (n3 - 3.0f * out.second * d1 - 3.0f * out.first * d2) / d;
  return out;
}

/**
 * Normalised second- and third-order coefficients about `u0`.
 *
 * `y / R'(u0) = v + c2·v² + c3·v³ + …`, so for `v = A·sin θ` the harmonics are
 * H2/H1 = |c2|·A/2 and H3/H1 = |c3|·A²/4 — §4.1 (2) and (3).
 *
 * A face that draws a stage's harmonic profile calls this, and so does the
 * calibration test. There is no second formula anywhere, which is the rule that
 * has caught the most bugs in this codebase: a picture drawn from a second
 * evaluation agrees with the audio right up until one of them is changed.
 */
struct Curvature {
  float c2 = 0.0f;
  float c3 = 0.0f;
};

inline Curvature curvature(float u0) noexcept {
  const CurveDerivatives d = curveDerivatives(u0);
  Curvature out;
  // A vanishing first derivative would mean the operating point is at the
  // clamp, where there is no small-signal gain to normalise against and the
  // ratios are meaningless. Reported as zero curvature rather than as infinity,
  // because a face drawing infinity is worse than a face drawing nothing.
  if (d.first > 1.0e-6f) {
    out.c2 = d.second / (2.0f * d.first);
    out.c3 = d.third / (6.0f * d.first);
  }
  return out;
}

/**
 * Full-scale reference, §1.2.
 *
 * Every dBm and dBu figure in the five Reference Spec Sheets is converted
 * through this constant and nowhere else. It is a convention rather than a
 * measurement — §8.8 records that — and it was chosen because it makes every
 * published figure directly testable and puts the Variable-Mu Limiter's
 * clipping point above full scale. If the product ever decides a unit must not
 * exceed 0 dBFS, this constant moves and every calibration in §4 moves with it,
 * which is exactly why there is one of it.
 */
inline constexpr float kFullScaleDbu = 22.0f;

inline float dbuToLinear(float dbu) noexcept {
  return std::pow(10.0f, (dbu - kFullScaleDbu) / 20.0f);
}

inline float linearToDbu(float amplitude) noexcept {
  const float a = amplitude < 1.0e-12f ? 1.0e-12f : amplitude;
  return 20.0f * std::log10(a) + kFullScaleDbu;
}

/**
 * The denormal floor, matched to `dsp::flushDenormal`'s.
 *
 * Repeated here rather than included from `biquad.h` because a nonlinear stage
 * has no business depending on a filter, and because the value is a property of
 * the arithmetic rather than of either file.
 */
inline float flushSmall(float v) noexcept {
  return (v < 1.0e-30f && v > -1.0e-30f) ? 0.0f : v;
}

}  // namespace mw::dsp::nl
