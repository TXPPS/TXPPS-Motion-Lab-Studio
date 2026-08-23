// Motion Wave — shelving and peaking sections.
//
// Separate from `biquad.h` because those three forms (low-pass, high-pass,
// all-pass) are what a *crossover* needs and these three are what an
// *equaliser* needs, and the file was already at the size where a reader has to
// scroll to find out which kind of thing they are looking at. The coefficient
// algebra is the RBJ cookbook's in both files; the split is by use.
//
// The gain forms below take a linear gain rather than decibels, deliberately.
// Every unit in this repository stores its parameters in the units its sheet
// states them in and converts at one boundary, and a coefficient builder that
// accepted decibels would be a second place where that conversion happens.
#pragma once

#include "biquad.h"

namespace mw::dsp {

/// Clamp a frequency into the open band, for the same reason `biquad.h` does:
/// a corner swept to Nyquist produces `tan(π/2)` and a filter handed infinities
/// never recovers.
inline double clampCorner(double frequency, double sampleRate) noexcept {
  const double nyquist = sampleRate * 0.5;
  return frequency < 1.0 ? 1.0 : (frequency > nyquist * 0.999 ? nyquist * 0.999 : frequency);
}

/**
 * Low shelf.
 *
 * `slope` is the RBJ shelf-slope parameter S: 1.0 is the steepest shelf that
 * does not overshoot, and lower values are gentler. It is a parameter here
 * rather than fixed at 1 because a *passive* shelving network's slope moves
 * with how far the boost potentiometer is advanced — the pot sits inside the
 * divider that also damps the LC section — and a fixed-slope shelf cannot
 * reproduce that at any setting.
 */
inline BiquadCoeffs lowShelfCoeffs(double frequency, double gain, double slope,
                                   double sampleRate) noexcept {
  const double f = clampCorner(frequency, sampleRate);
  const double a = std::sqrt(gain < 1.0e-6 ? 1.0e-6 : gain);
  const double w0 = 2.0 * 3.14159265358979323846 * f / sampleRate;
  const double cosw = std::cos(w0);
  const double s = slope < 0.05 ? 0.05 : (slope > 2.0 ? 2.0 : slope);
  const double alpha = std::sin(w0) * 0.5 * std::sqrt((a + 1.0 / a) * (1.0 / s - 1.0) + 2.0);
  const double twoSqrtAAlpha = 2.0 * std::sqrt(a) * alpha;
  const double a0 = (a + 1.0) + (a - 1.0) * cosw + twoSqrtAAlpha;
  BiquadCoeffs c;
  c.b0 = a * ((a + 1.0) - (a - 1.0) * cosw + twoSqrtAAlpha) / a0;
  c.b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cosw) / a0;
  c.b2 = a * ((a + 1.0) - (a - 1.0) * cosw - twoSqrtAAlpha) / a0;
  c.a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cosw) / a0;
  c.a2 = ((a + 1.0) + (a - 1.0) * cosw - twoSqrtAAlpha) / a0;
  return c;
}

/// High shelf, same conventions.
inline BiquadCoeffs highShelfCoeffs(double frequency, double gain, double slope,
                                    double sampleRate) noexcept {
  const double f = clampCorner(frequency, sampleRate);
  const double a = std::sqrt(gain < 1.0e-6 ? 1.0e-6 : gain);
  const double w0 = 2.0 * 3.14159265358979323846 * f / sampleRate;
  const double cosw = std::cos(w0);
  const double s = slope < 0.05 ? 0.05 : (slope > 2.0 ? 2.0 : slope);
  const double alpha = std::sin(w0) * 0.5 * std::sqrt((a + 1.0 / a) * (1.0 / s - 1.0) + 2.0);
  const double twoSqrtAAlpha = 2.0 * std::sqrt(a) * alpha;
  const double a0 = (a + 1.0) - (a - 1.0) * cosw + twoSqrtAAlpha;
  BiquadCoeffs c;
  c.b0 = a * ((a + 1.0) + (a - 1.0) * cosw + twoSqrtAAlpha) / a0;
  c.b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cosw) / a0;
  c.b2 = a * ((a + 1.0) + (a - 1.0) * cosw - twoSqrtAAlpha) / a0;
  c.a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cosw) / a0;
  c.a2 = ((a + 1.0) - (a - 1.0) * cosw - twoSqrtAAlpha) / a0;
  return c;
}

/// Peaking bell. `q` is the conventional one: centre frequency over −3 dB
/// bandwidth in hertz.
inline BiquadCoeffs peakingCoeffs(double frequency, double gain, double q,
                                  double sampleRate) noexcept {
  const double f = clampCorner(frequency, sampleRate);
  const double a = std::sqrt(gain < 1.0e-6 ? 1.0e-6 : gain);
  const double w0 = 2.0 * 3.14159265358979323846 * f / sampleRate;
  const double cosw = std::cos(w0);
  const double alpha = std::sin(w0) / (2.0 * (q < 1.0e-4 ? 1.0e-4 : q));
  const double a0 = 1.0 + alpha / a;
  BiquadCoeffs c;
  c.b0 = (1.0 + alpha * a) / a0;
  c.b1 = (-2.0 * cosw) / a0;
  c.b2 = (1.0 - alpha * a) / a0;
  c.a1 = c.b1;
  c.a2 = (1.0 - alpha / a) / a0;
  return c;
}

/// First-order high-pass, as a biquad with the second-order terms zero.
///
/// A transformer's low-frequency roll-off is first order, and building it from
/// a second-order section at some chosen Q would put a resonance where the
/// hardware has none.
inline BiquadCoeffs onePoleHighpassCoeffs(double frequency, double sampleRate) noexcept {
  const double f = clampCorner(frequency, sampleRate);
  const double k = std::tan(3.14159265358979323846 * f / sampleRate);
  const double norm = 1.0 / (k + 1.0);
  BiquadCoeffs c;
  c.b0 = norm;
  c.b1 = -norm;
  c.b2 = 0.0;
  c.a1 = (k - 1.0) * norm;
  c.a2 = 0.0;
  return c;
}

/// Decibels to a linear gain, in one place.
inline double dbToGain(double db) noexcept { return std::pow(10.0, db / 20.0); }

}  // namespace mw::dsp
