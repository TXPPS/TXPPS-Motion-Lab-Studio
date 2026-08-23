// Motion Wave — a peak detector with a persistent timing network.
//
// Shared, because two of the five dynamics units have one and they differ only
// in their constants. What is *not* shared is where it runs: the FET Limiter's
// fastest attack is 20 µs, which is shorter than one sample period at every
// rate this product supports, so its detector runs inside the oversampling
// wrapper and is constructed with the wrapper's rate. See the note on
// `attackSeconds`.
//
// `dyn-03` §4.2 gives the one rule that makes this a *timing network* rather
// than an envelope follower: the charge state persists between events, so
// closely spaced transients hold the gain down and recover together rather than
// individually. That is what a state is; an implementation that reset per
// transient would let the second of two hits through.
#pragma once

#include <cmath>

namespace mw::dsp {

struct PeakDetectorConfig {
  /**
   * Attack, as a first-order time constant, in seconds.
   *
   * **The rate this is prepared at decides whether the control works.** The
   * FET Limiter's range runs from 20 µs to 800 µs, and 20 µs is 0.96 samples at
   * 48 kHz and 0.88 at 44.1 kHz. A detector running at the host rate cannot
   * express any setting faster than one sample, so the whole top of the control
   * collapses onto a single behaviour — and that top is the range the unit is
   * known for. Prepared at 8× and 44.1 kHz the same 20 µs is seven sub-samples,
   * which is a time constant rather than a step.
   */
  double attackSeconds = 0.00002;
  double releaseSeconds = 0.050;
};

class PeakDetector {
 public:
  void prepare(double sampleRate, const PeakDetectorConfig& config) noexcept {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    setConfig(config);
    reset();
  }

  void setConfig(const PeakDetectorConfig& config) noexcept {
    config_ = config;
    attack_ = coeffFor(config.attackSeconds);
    release_ = coeffFor(config.releaseSeconds);
  }

  void reset() noexcept { state_ = 0.0; }

  /// `level` is a rectified sample. Returns the detector's state, which is the
  /// timing network's charge and persists across calls.
  double process(double level) noexcept {
    const double coeff = level > state_ ? attack_ : release_;
    state_ = level + (state_ - level) * coeff;
    // Flushed rather than left to drift: a decaying detector state is exactly
    // where denormals arrive, and this runs at eight times the audio rate.
    if (state_ < 1.0e-30 && state_ > -1.0e-30) state_ = 0.0;
    return state_;
  }

  double state() const noexcept { return state_; }

 private:
  double coeffFor(double seconds) const noexcept {
    if (seconds <= 0.0) return 0.0;
    return std::exp(-1.0 / (seconds * sampleRate_));
  }

  PeakDetectorConfig config_{};
  double sampleRate_ = 48000.0;
  double attack_ = 0.0;
  double release_ = 0.0;
  double state_ = 0.0;
};

/**
 * A first-order rise covers 10 % to 90 % in this many time constants.
 *
 * ln(9) — worth a name because published attack figures are nearly always a
 * 10-to-90 span while a model's constant is a time constant, and confusing the
 * two is a factor of 2.2 that looks like a calibration error.
 */
inline constexpr double kTenToNinety = 2.197224577;

/**
 * A first-order decay falls from ten units to one in this many time constants.
 *
 * ln(10). Published *release* figures are usually a recovery to a stated
 * remaining depth rather than a time constant, and this is the conversion — the
 * same trap as `kTenToNinety` at the other end of the envelope, and the same
 * factor of two-and-a-bit that looks like a calibration error.
 */
inline constexpr double kTenToOne = 2.302585093;

/**
 * The 1-to-7 panel scale mapped onto published endpoints, logarithmically.
 *
 * `dyn-03` §4 gives both endpoints and says neither taper is published, marking
 * a logarithmic mapping as the reasonable default and as our inference. The
 * sense is **reversed**: 7 is fully clockwise and fastest, which is the panel's
 * own convention and the thing §9 test 3 exists to catch a model getting the
 * wrong way round.
 */
inline double panelScaleToSeconds(double position, double fastest, double slowest) noexcept {
  const double p = position < 1.0 ? 1.0 : (position > 7.0 ? 7.0 : position);
  return fastest * std::pow(slowest / fastest, (7.0 - p) / 6.0);
}

}  // namespace mw::dsp
