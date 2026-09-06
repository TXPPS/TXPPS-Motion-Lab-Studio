// Motion Wave — shared fixtures for the state-variable filter's three suites.
//
// `svf_tests.cpp` measures the filter's frequency responses,
// `svf_resonance_tests.cpp` the resonance control and its law, and
// `svf_modulation_tests.cpp` what happens when the controls move underneath it.
// What lives here is the apparatus they share — how a steady-state magnitude is
// measured, what the analogue prototype says, what the bilinear warp does to a
// frequency, the broadband signal the sweeps are driven with, and the sweep
// itself — so that a number printed by one suite means the same thing when
// another prints it.
//
// The prototype is written out here rather than taken from `Svf::magnitudeAt`
// deliberately: grading the measurements against the filter's own curve would
// be testing one expression of a belief against another. The curve is checked
// *against* these measurements, in `svf_tests.cpp`, which is the direction that
// can find a bug in it.
#pragma once

#include "../dsp/svf.h"
#include "harness.h"

#include <cmath>
#include <cstdio>

namespace mw::test::svf {

constexpr double kPi = 3.14159265358979323846;
constexpr double kRate = 48000.0;
constexpr double kCutoff = 1000.0;

using mw::dsp::Svf;

inline double dB(double linear) {
  return 20.0 * std::log10(linear <= 1.0e-12 ? 1.0e-12 : linear);
}

/**
 * Steady-state magnitude at `hz`, from the sample loop.
 *
 * One second of settle is discarded before the measurement window, because a
 * filter's start-up transient is real output and would drag the reading at low
 * frequencies — where the settle is longest and, at 100 Hz against a 1 kHz
 * corner, the tolerance is tightest.
 *
 * The window is a whole number of periods only when `hz` divides the rate
 * evenly, which most of these do not, so the correlation is taken against the
 * generator's own sine and cosine at the same phase rather than against a DFT
 * bin. That is exact for a single tone whatever the window length: the
 * cross-terms of a sine against its own quadrature integrate to a bounded
 * constant, which 32768 samples divides to under a thousandth of a dB.
 */
inline double magnitudeOf(Svf::Mode mode, double sampleRate, double cutoffHz, double resonance,
                          double hz) {
  Svf svf;
  svf.prepare(sampleRate);
  svf.setMode(mode);
  svf.reset();
  const int settle = static_cast<int>(sampleRate);
  const int window = 32768;
  for (int n = 0; n < settle; ++n) {
    const double phase = 2.0 * kPi * hz * static_cast<double>(n) / sampleRate;
    svf.process(static_cast<float>(std::sin(phase)), static_cast<float>(cutoffHz),
                static_cast<float>(resonance));
  }
  double re = 0.0;
  double im = 0.0;
  for (int n = 0; n < window; ++n) {
    const double phase = 2.0 * kPi * hz * static_cast<double>(n + settle) / sampleRate;
    const double y = static_cast<double>(
        svf.process(static_cast<float>(std::sin(phase)), static_cast<float>(cutoffHz),
                    static_cast<float>(resonance)));
    re += y * std::cos(phase);
    im += y * std::sin(phase);
  }
  return 2.0 * std::sqrt(re * re + im * im) / static_cast<double>(window);
}

/**
 * The analogue prototype's magnitude at frequency ratio `x`, damping `k = 1/Q`.
 *
 * `Mode::Bandpass` carries the `k` factor because the filter's bandpass mode is
 * the constant-*peak* normalisation — unity at the centre whatever the Q. The
 * raw integrator output `Outputs::band` is the constant-skirt one and peaks at
 * Q; `svf_tests.cpp`'s bandpass row asserts both and explains which is which.
 */
inline double prototypeMagnitude(Svf::Mode mode, double x, double q) {
  const double k = 1.0 / q;
  const double x2 = x * x;
  const double den = std::sqrt((1.0 - x2) * (1.0 - x2) + k * k * x2);
  switch (mode) {
    case Svf::Mode::Highpass: return x2 / den;
    case Svf::Mode::Bandpass: return k * x / den;
    case Svf::Mode::Notch: return std::fabs(1.0 - x2) / den;
    case Svf::Mode::Lowpass:
    case Svf::Mode::Off:
    default: return 1.0 / den;
  }
}

/// The frequency ratio the discrete filter actually realises at `hz` — the
/// bilinear warp. This is the difference between a reference that is right and
/// one that is 2.74 dB out at 10 kHz; `svf_tests.cpp`'s header derives it.
inline double warpedRatio(double hz, double cutoffHz, double sampleRate) {
  return std::tan(kPi * hz / sampleRate) / std::tan(kPi * cutoffHz / sampleRate);
}

/// A 55 Hz sawtooth. Broadband, so every part of the response is excited
/// wherever the cutoff has been swept to — a sine at one frequency can be
/// outside the passband for half a sweep and report a small step for a reason
/// that is not stability.
inline double sawAt(int n, double sampleRate) {
  const double t = static_cast<double>(n) / sampleRate;
  return 0.5 * (2.0 * std::fmod(55.0 * t, 1.0) - 1.0);
}

/// What a sweep produced. `finite` is false when the filter overflowed, which
/// is a result rather than a crash: the retuned-biquad mutation is *expected*
/// to reach it, and a run that simply died could not say so.
struct SweepResult {
  double largestStep = 0.0;
  double peak = 0.0;
  bool finite = true;
};

/// Largest sample-to-sample step of the SVF over two seconds, with the cutoff
/// either swept sinusoidally in the octave domain or held.
inline SweepResult sweepSvf(double modHz, double centreHz, double octaves, double resonance,
                            double heldHz) {
  Svf svf;
  svf.prepare(kRate);
  svf.setMode(Svf::Mode::Lowpass);
  svf.reset();
  const int frames = static_cast<int>(kRate * 2.0);
  const int skip = static_cast<int>(kRate * 0.25);
  SweepResult out;
  double previous = 0.0;
  for (int n = 0; n < frames; ++n) {
    const double t = static_cast<double>(n) / kRate;
    const double fc = heldHz > 0.0
                          ? heldHz
                          : centreHz * std::exp2(octaves * std::sin(2.0 * kPi * modHz * t));
    const double y = static_cast<double>(
        svf.process(static_cast<float>(sawAt(n, kRate)), static_cast<float>(fc),
                    static_cast<float>(resonance)));
    if (!std::isfinite(y)) {
      out.finite = false;
      return out;
    }
    if (n > skip) {
      out.largestStep = std::fmax(out.largestStep, std::fabs(y - previous));
      out.peak = std::fmax(out.peak, std::fabs(y));
    }
    previous = y;
  }
  return out;
}

}  // namespace mw::test::svf
