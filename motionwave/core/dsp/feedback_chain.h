// Motion Wave — what happens to a granular reverb's signal once per pass.
//
// `fx-02` §2.2 and §2.5. The order is fixed and each element is there for a
// stated failure: **DC blocker → damping → tilt → limiter → ×fb**. The DC
// blocker goes first so the limiter is not triggered by DC, and the limiter goes
// last so it is inside the loop — on the output it cannot arrest regeneration,
// which is the only thing it is for.
#pragma once

#include "biquad.h"
#include "shelving.h"

#include <cmath>

namespace mw::dsp {

class FeedbackChain {
 public:
  void prepare(double sampleRate) noexcept {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    // §2.2 hazard 2: grain windows have a non-zero mean, so any DC in the
    // source accumulates monotonically around the loop. A first-order high-pass
    // at 20 Hz in the feedback path is not optional — V10 feeds +0.5 DC for
    // sixty seconds at a thirty-second decay and requires the output DC under
    // −80 dBFS.
    dcBlocker_.setCoeffs(onePoleHighpassCoeffs(20.0, sampleRate_));
    releaseCoeff_ = static_cast<float>(std::exp(-1.0 / (0.005 * sampleRate_)));
    setTilt(0.0f);
    reset();
  }

  void reset() noexcept {
    dcBlocker_.reset();
    lowShelf_.reset();
    highShelf_.reset();
    damping_ = 0.0f;
    envelope_ = 0.0f;
  }

  /// §2.5: `d` in [0, 0.95]. The feedback low-pass makes RT60 fall with
  /// frequency, which is what air absorption does.
  void setDamping(float amount) noexcept {
    const float clamped = amount < 0.0f ? 0.0f : (amount > 1.0f ? 1.0f : amount);
    dampingCoeff_ = clamped * 0.95f;
  }

  /**
   * §2.5's symmetric shelving pair pivoting at 1 kHz.
   *
   * In the feedback path it compounds per pass, which is what makes it a
   * character control rather than an equaliser: −3 dB becomes −30 dB by the
   * tenth pass. That is worth saying in the tooltip, because users otherwise
   * find the control absurdly strong and conclude it is broken.
   */
  void setTilt(float decibels) noexcept {
    const float clamped = decibels < -12.0f ? -12.0f : (decibels > 12.0f ? 12.0f : decibels);
    const double low = std::pow(10.0, static_cast<double>(clamped) / 20.0);
    const double high = std::pow(10.0, static_cast<double>(-clamped) / 20.0);
    lowShelf_.setCoeffs(lowShelfCoeffs(1000.0, low, 1.0, sampleRate_));
    highShelf_.setCoeffs(highShelfCoeffs(1000.0, high, 1.0, sampleRate_));
  }

  /// The magnitude the damping filter applies at `hz`, so the unit can display
  /// the resulting RT60 at 8 kHz rather than leaving the control opaque.
  double dampingMagnitudeAt(double hz) const noexcept {
    const double d = static_cast<double>(dampingCoeff_);
    if (d <= 0.0) return 1.0;
    const double w = 2.0 * 3.14159265358979323846 * hz / sampleRate_;
    const double re = 1.0 - d * std::cos(w);
    const double im = d * std::sin(w);
    return (1.0 - d) / std::sqrt(re * re + im * im);
  }

  /**
   * One pass. `feedback` is applied last, so everything above happens at the
   * loop's own level rather than at a scaled one.
   *
   * The limiter is soft — a tanh knee above −3 dBFS with a five-millisecond
   * release — because §2.2 hazard 3 is that the instantaneous sum of many
   * grains can exceed headroom even with the loop gain below one. A hard clip
   * here would fold harmonics back into the buffer and they would recirculate.
   */
  float process(float x, float feedback) noexcept {
    float y = static_cast<float>(dcBlocker_.process(static_cast<double>(x)));
    damping_ = (1.0f - dampingCoeff_) * y + dampingCoeff_ * damping_;
    y = damping_;
    y = static_cast<float>(highShelf_.process(lowShelf_.process(static_cast<double>(y))));

    const float magnitude = y < 0.0f ? -y : y;
    envelope_ = magnitude > envelope_ ? magnitude
                                      : envelope_ * releaseCoeff_ + magnitude * (1.0f - releaseCoeff_);
    if (envelope_ > kThreshold) {
      // Above the knee the excess is compressed rather than removed, so the
      // limiter's own gain moves smoothly and does not modulate the tail.
      const float over = envelope_ / kThreshold;
      y *= std::tanh(over) / over;
    }
    return y * feedback;
  }

 private:
  /// −3 dBFS, §2.2.
  static constexpr float kThreshold = 0.7079458f;

  Biquad dcBlocker_;
  Biquad lowShelf_;
  Biquad highShelf_;
  double sampleRate_ = 48000.0;
  float dampingCoeff_ = 0.0f;
  float damping_ = 0.0f;
  float envelope_ = 0.0f;
  float releaseCoeff_ = 0.999f;
};

}  // namespace mw::dsp
