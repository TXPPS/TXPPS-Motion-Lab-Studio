// Motion Wave — the second-order section everything else is built from.
//
// Crossovers, tone stacks, envelope detectors, band-splits and the five vintage
// equalisers all reduce to cascaded biquads, so this is the one place their
// arithmetic lives. A private copy per unit is how two of them end up
// disagreeing about what Q means at the Nyquist edge.
//
// Two decisions worth stating, because both cost something and both are the
// reason this is not the obvious three-line implementation:
//
// **Transposed direct form II, with state in double.** Direct form I needs four
// state words; TDF-II needs two and is the better-conditioned of the canonical
// forms for the coefficient magnitudes a low crossover produces. At a 40 Hz
// corner on a 192 kHz stream, `ω₀` is 1.3e-3 and the poles sit so close to the
// unit circle that single-precision state loses the difference between them —
// the filter's corner drifts, and it drifts further the higher the sample rate,
// which reads as "the plugin sounds different at 192 k" and is arithmetic.
//
// **Denormals are flushed explicitly.** A biquad fed silence after programme
// decays toward zero through the denormal range, where some hardware traps into
// microcode and a block that took 40 µs takes 4 ms. `-ffast-math` would set FTZ
// for the library, but the tests are deliberately built without it — a null
// test asserting −140 dBFS must not run against arithmetic the compiler was
// told it could reassociate — so the flush cannot come from a compiler flag and
// is done here where every filter gets it.
#pragma once

#include <cmath>

namespace mw::dsp {

/// Butterworth Q. A cascade of two of these is one Linkwitz-Riley branch.
inline constexpr double kButterworthQ = 0.70710678118654752440;

/**
 * Below this, state is treated as zero.
 *
 * Well under the smallest normal float (1.18e-38) and far under anything that
 * can affect a 32-bit output sample, so flushing here cannot change the audio;
 * it only stops the state from entering the range where the arithmetic gets
 * slow.
 */
inline constexpr double kDenormalFloor = 1.0e-30;

inline double flushDenormal(double v) noexcept {
  return (v > -kDenormalFloor && v < kDenormalFloor) ? 0.0 : v;
}

/// One second-order section: `b0 b1 b2 / 1 a1 a2`, already normalised by `a0`.
struct BiquadCoeffs {
  double b0 = 1.0;
  double b1 = 0.0;
  double b2 = 0.0;
  double a1 = 0.0;
  double a2 = 0.0;
};

/// The RBJ cookbook forms, with `a0` divided out at construction.
///
/// `frequency` is clamped into (0, Nyquist) rather than trusted: a modulated
/// cutoff swept to the rail produces `tan(π/2)` and a coefficient set of
/// infinities, and a filter that has been handed infinities never recovers —
/// it outputs NaN for the rest of the session. Clamping is cheaper than the
/// support thread.
inline BiquadCoeffs lowpassCoeffs(double frequency, double q, double sampleRate) noexcept {
  const double nyquist = sampleRate * 0.5;
  const double f = frequency < 1.0 ? 1.0 : (frequency > nyquist * 0.999 ? nyquist * 0.999 : frequency);
  const double w0 = 2.0 * 3.14159265358979323846 * f / sampleRate;
  const double cosw = std::cos(w0);
  const double alpha = std::sin(w0) / (2.0 * (q < 1.0e-4 ? 1.0e-4 : q));
  const double a0 = 1.0 + alpha;
  BiquadCoeffs c;
  c.b0 = ((1.0 - cosw) * 0.5) / a0;
  c.b1 = (1.0 - cosw) / a0;
  c.b2 = c.b0;
  c.a1 = (-2.0 * cosw) / a0;
  c.a2 = (1.0 - alpha) / a0;
  return c;
}

inline BiquadCoeffs highpassCoeffs(double frequency, double q, double sampleRate) noexcept {
  const double nyquist = sampleRate * 0.5;
  const double f = frequency < 1.0 ? 1.0 : (frequency > nyquist * 0.999 ? nyquist * 0.999 : frequency);
  const double w0 = 2.0 * 3.14159265358979323846 * f / sampleRate;
  const double cosw = std::cos(w0);
  const double alpha = std::sin(w0) / (2.0 * (q < 1.0e-4 ? 1.0e-4 : q));
  const double a0 = 1.0 + alpha;
  BiquadCoeffs c;
  c.b0 = ((1.0 + cosw) * 0.5) / a0;
  c.b1 = (-(1.0 + cosw)) / a0;
  c.b2 = c.b0;
  c.a1 = (-2.0 * cosw) / a0;
  c.a2 = (1.0 - alpha) / a0;
  return c;
}

/**
 * Second-order all-pass: unity magnitude, phase sweeping 0 → −360°.
 *
 * This is the section a three-band Linkwitz-Riley split needs on its low band,
 * and the reason it is needed is worth carrying here rather than only in the
 * spec sheet. A cascaded split sends the low band around the second crossover,
 * so the low band never receives that network's phase rotation and the three
 * bands no longer sum flat. `fx-01` §4.1 derives that the sum of an LR4 pair is
 * exactly one *second*-order all-pass — not fourth-order, which is what the
 * loudspeaker literature's naming suggests and which would double the rotation
 * and break the very sum it was added to fix.
 */
/**
 * Constant-peak-gain bandpass, which is the form a per-tap filter wants.
 *
 * The other common normalisation is constant *skirt* gain, whose peak rises
 * with Q — fine for an analysis filter and wrong here, because `fx-03` §2 puts
 * this filter inside a path that reaches the feedback loop. A filter whose
 * gain rose with its resonance control would move the loop's stability with a
 * control the user is turning for tone, which is the failure §3.2(a) describes
 * one stage further in.
 */
inline BiquadCoeffs bandpassCoeffs(double frequency, double q, double sampleRate) noexcept {
  const double nyquist = sampleRate * 0.5;
  const double f =
      frequency < 1.0 ? 1.0 : (frequency > nyquist * 0.999 ? nyquist * 0.999 : frequency);
  const double w0 = 2.0 * 3.14159265358979323846 * f / sampleRate;
  const double cosw = std::cos(w0);
  const double alpha = std::sin(w0) / (2.0 * (q < 1.0e-4 ? 1.0e-4 : q));
  const double a0 = 1.0 + alpha;
  BiquadCoeffs c;
  c.b0 = alpha / a0;
  c.b1 = 0.0;
  c.b2 = -alpha / a0;
  c.a1 = (-2.0 * cosw) / a0;
  c.a2 = (1.0 - alpha) / a0;
  return c;
}

inline BiquadCoeffs allpassCoeffs(double frequency, double q, double sampleRate) noexcept {
  const double nyquist = sampleRate * 0.5;
  const double f = frequency < 1.0 ? 1.0 : (frequency > nyquist * 0.999 ? nyquist * 0.999 : frequency);
  const double w0 = 2.0 * 3.14159265358979323846 * f / sampleRate;
  const double cosw = std::cos(w0);
  const double alpha = std::sin(w0) / (2.0 * (q < 1.0e-4 ? 1.0e-4 : q));
  const double a0 = 1.0 + alpha;
  BiquadCoeffs c;
  c.b0 = (1.0 - alpha) / a0;
  c.b1 = (-2.0 * cosw) / a0;
  c.b2 = 1.0;
  c.a1 = (-2.0 * cosw) / a0;
  c.a2 = (1.0 - alpha) / a0;
  return c;
}

/// One section with its own state. Copyable, so a stereo pair is two of these.
class Biquad {
 public:
  void setCoeffs(const BiquadCoeffs& c) noexcept { c_ = c; }
  const BiquadCoeffs& coeffs() const noexcept { return c_; }

  /// Clear the state. Called on a transport seek, where carrying a filter's
  /// memory across a discontinuity would ring on material that never played.
  void reset() noexcept {
    s1_ = 0.0;
    s2_ = 0.0;
  }

  /// One sample. Transposed direct form II.
  double process(double x) noexcept {
    const double y = c_.b0 * x + s1_;
    s1_ = flushDenormal(c_.b1 * x - c_.a1 * y + s2_);
    s2_ = flushDenormal(c_.b2 * x - c_.a2 * y);
    return y;
  }

  /**
   * Magnitude response at `frequency`, for tests and for drawing a curve.
   *
   * The same evaluation the audio uses, in the sense that matters: it is
   * computed from the coefficients this instance is actually running, so a
   * plotted curve cannot disagree with the filter. A face that computed its own
   * response from the control values would be a second opinion, and the one
   * that is wrong is always the one nobody is listening to.
   */
  double magnitudeAt(double frequency, double sampleRate) const noexcept {
    const double w = 2.0 * 3.14159265358979323846 * frequency / sampleRate;
    const double cw = std::cos(w);
    const double sw = std::sin(w);
    const double c2w = std::cos(2.0 * w);
    const double s2w = std::sin(2.0 * w);
    const double numRe = c_.b0 + c_.b1 * cw + c_.b2 * c2w;
    const double numIm = -(c_.b1 * sw + c_.b2 * s2w);
    const double denRe = 1.0 + c_.a1 * cw + c_.a2 * c2w;
    const double denIm = -(c_.a1 * sw + c_.a2 * s2w);
    const double num = std::sqrt(numRe * numRe + numIm * numIm);
    const double den = std::sqrt(denRe * denRe + denIm * denIm);
    return den == 0.0 ? 0.0 : num / den;
  }

 private:
  BiquadCoeffs c_;
  double s1_ = 0.0;
  double s2_ = 0.0;
};

}  // namespace mw::dsp
