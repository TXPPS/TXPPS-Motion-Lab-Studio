// Motion Wave — parameter units and taper laws.
//
// The conversion between the normalised 0..1 value that automation, hosts and
// controllers speak and the real value in a parameter's own unit lives here and
// nowhere else. ADR-0004 is explicit about why: a display that computes a real
// value one way and a processor that computes it another produces two answers
// to one question, which is how a control ends up labelled in one unit and read
// in another. One function, both callers.
#pragma once

#include <cmath>

namespace mw {

/// What a parameter's real value means. Drives formatting and, for Choice,
/// the shape of the taper.
enum class Unit {
  Linear,   ///< a bare number
  Decibels,
  Hertz,
  Seconds,
  Milliseconds,
  Percent,  ///< real value 0..1, displayed x100
  Ratio,    ///< n:1
  Semitones,
  Cents,
  Choice,   ///< real value is an index into ParamSpec::choices
};

/// How the normalised position maps onto the real range.
enum class Taper {
  /// Even. The default, and correct whenever the parameter is already
  /// perceptually even — decibels and semitones are.
  Linear,
  /// Constant ratio per unit of travel: the law frequency wants, because a
  /// listener hears octaves, not hertz. Requires min > 0.
  Logarithmic,
  /// A power law, `min + (max - min) * n^k`. Used where the range is not a
  /// ratio but the interesting part is still bunched at one end — an attack
  /// time that must resolve a millisecond and reach two seconds.
  Exponential,
  /// Quantised to `steps` evenly spaced positions, including both ends.
  Stepped,
};

/// Real value from a normalised 0..1 position.
///
/// `n` is clamped rather than trusted: a controller sending 1.0000001 must not
/// produce a value outside the parameter's own range, and clamping at this one
/// seam means no caller downstream has to.
inline float denormalise(float n, float min, float max, Taper taper, float exponent,
                         int steps) noexcept {
  n = n < 0.0f ? 0.0f : (n > 1.0f ? 1.0f : n);
  switch (taper) {
    case Taper::Logarithmic:
      // Guarded rather than asserted: a logarithmic taper with a zero or
      // negative minimum is a specification error, and answering with the
      // linear reading is better than a NaN reaching a filter coefficient.
      if (min <= 0.0f || max <= 0.0f) return min + n * (max - min);
      return min * std::pow(max / min, n);
    case Taper::Exponential:
      return min + (max - min) * std::pow(n, exponent);
    case Taper::Stepped: {
      if (steps < 2) return min;
      const float q = std::round(n * static_cast<float>(steps - 1));
      return min + (max - min) * (q / static_cast<float>(steps - 1));
    }
    case Taper::Linear:
    default:
      return min + n * (max - min);
  }
}

/// Normalised 0..1 position from a real value. The exact inverse of
/// `denormalise` for every taper, which `param_tests` asserts by round-trip.
inline float normalise(float v, float min, float max, Taper taper, float exponent,
                       int steps) noexcept {
  const float lo = min < max ? min : max;
  const float hi = min < max ? max : min;
  v = v < lo ? lo : (v > hi ? hi : v);
  switch (taper) {
    case Taper::Logarithmic:
      if (min <= 0.0f || max <= 0.0f || max == min) {
        return max == min ? 0.0f : (v - min) / (max - min);
      }
      return std::log(v / min) / std::log(max / min);
    case Taper::Exponential: {
      if (max == min || exponent <= 0.0f) return 0.0f;
      const float t = (v - min) / (max - min);
      return std::pow(t < 0.0f ? 0.0f : t, 1.0f / exponent);
    }
    case Taper::Stepped: {
      if (steps < 2 || max == min) return 0.0f;
      const float t = (v - min) / (max - min);
      return std::round(t * static_cast<float>(steps - 1)) / static_cast<float>(steps - 1);
    }
    case Taper::Linear:
    default:
      return max == min ? 0.0f : (v - min) / (max - min);
  }
}

}  // namespace mw
