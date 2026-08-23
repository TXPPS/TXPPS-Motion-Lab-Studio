// Motion Wave — the reason a drawn square wave does not click.
//
// A discontinuity in a gain multiplier puts a step in the output, and a step's
// spectrum falls at 6 dB/octave from DC: broadband, and audible as a click
// whatever the programme material is. `fx-01` §4.5 is precise about the two
// available mitigations not being interchangeable, and it is worth carrying the
// distinction here because reaching for the wrong one produces a device that
// measures beautifully and still ticks.
//
//   Band-limiting the modulator (polyBLEP) makes the *modulator* alias-free,
//   which matters when it runs at audio rate and its harmonics fold. It does
//   not make the gain change inaudible: a band-limited step is still a step in
//   energy.
//
//   Smoothing limits the rate of gain change, which is what actually removes
//   the click, at the cost of softening the drawn shape.
//
// This is the second one. Two cascaded one-poles rather than one, because a
// single pole leaves a sharp corner at the onset of smoothing that is itself
// audible on fast shapes, and its 6 dB/oct skirt lets the discontinuity's high
// harmonics straight through.
//
// The floor is the load-bearing part. τ never goes below 0.05 ms — about 2.4
// samples at 48 kHz — even with the Smooth control at zero, and that floor is
// the whole reason Smooth = 0 does not click. V3 measures it by sweeping an LFO
// with a square curve from 0.1 Hz to 200 Hz and requiring zero flagged samples;
// one flag means the floor is not applied on that path.
#pragma once

#include <cmath>

namespace mw::dsp {

/**
 * Shortest smoothing time constant, in seconds.
 *
 * 0.05 ms. Below this a gain step is fast enough to click; above it the drawn
 * shape starts to soften visibly at the top of the Smooth range. It is applied
 * unconditionally rather than as the bottom of the control's range, so that a
 * control at zero still gets it — a user who wants a hard square gets the
 * hardest square that does not tick, which is a different thing from getting a
 * tick.
 */
inline constexpr double kMinSmoothingSeconds = 0.00005;

/// Longest, from the Smooth control's top end.
inline constexpr double kMaxSmoothingSeconds = 0.2;

/**
 * Two cascaded one-poles, critically damped.
 *
 * Not a general-purpose lowpass: it is specifically the gain-path smoother, and
 * it is separate from `Biquad` because the thing it must guarantee is a *rate*
 * limit rather than a frequency response, and because its state must survive
 * events that reset everything else — see `retrigger` below.
 */
class Smoother {
 public:
  /**
   * `seconds` is the requested time constant; the floor is applied here rather
   * than by the caller, so no call site can forget it.
   */
  void setTimeConstant(double seconds, double sampleRate) noexcept {
    const double tau = seconds < kMinSmoothingSeconds
                           ? kMinSmoothingSeconds
                           : (seconds > kMaxSmoothingSeconds ? kMaxSmoothingSeconds : seconds);
    // The exact one-pole coefficient rather than the 1/(τ·fs) approximation.
    // At the floor, τ·fs is 2.4 samples, where the approximation is 40 % out —
    // and the floor is precisely where being right matters, because that is the
    // setting the anti-click guarantee rests on.
    coeff_ = 1.0 - std::exp(-1.0 / (tau * sampleRate));
    tau_ = tau;
  }

  /// Time constant actually in force, after the floor. V11 sweeps this.
  double timeConstant() const noexcept { return tau_; }

  /// Jump to a value without smoothing. For a prepare, not for a retrigger.
  void snapTo(double value) noexcept {
    a_ = value;
    b_ = value;
  }

  void reset() noexcept { snapTo(0.0); }

  /**
   * Deliberately does nothing to the state.
   *
   * An audio-rate trigger can reset the modulator's phase at any sample, which
   * is the worst case for a click: the curve jumps from wherever it was to
   * whatever the new cycle starts at. Resetting the smoother would make that
   * jump instantaneous and guarantee the click. Leaving the state alone lets it
   * glide from where it was to the new value, which converts the step into a
   * τ-limited ramp for free — the fix costs nothing and is the difference
   * between V4 passing and failing.
   *
   * A named no-op rather than an absent call, so that a reader looking for
   * "what happens to the smoother on retrigger" finds the answer and the reason
   * instead of finding nothing and assuming it was overlooked.
   */
  void retrigger() noexcept {}

  double process(double x) noexcept {
    a_ += coeff_ * (x - a_);
    b_ += coeff_ * (a_ - b_);
    return b_;
  }

  double value() const noexcept { return b_; }

 private:
  double coeff_ = 1.0;
  double tau_ = kMinSmoothingSeconds;
  double a_ = 0.0;
  double b_ = 0.0;
};

/**
 * Map the Smooth control's 0…1 to a time constant, logarithmically.
 *
 * Log rather than linear because the useful range spans four decades, and half
 * a linear control would be spent between 100 ms and 200 ms where nothing
 * changes audibly. V11 requires this to be monotonic with no step larger than
 * 15 % between adjacent settings, which a log map satisfies by construction —
 * the check exists to catch someone later inserting a special case at zero.
 */
inline double smoothingSecondsFor(double control) noexcept {
  const double c = control < 0.0 ? 0.0 : (control > 1.0 ? 1.0 : control);
  const double lo = std::log(kMinSmoothingSeconds);
  const double hi = std::log(kMaxSmoothingSeconds);
  return std::exp(lo + (hi - lo) * c);
}

}  // namespace mw::dsp
