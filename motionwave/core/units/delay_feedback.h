// Motion Wave — the Granular Delay's feedback path.
//
// `fx-03` §3.1 fixes the order and says why for two of the stages: the DC
// blocker is first so the saturator is not biased by accumulated DC, and the
// saturator is last before the routing matrix so what reaches the matrix is
// already bounded. The rest of the order is the sheet's.
//
// Separate from `fx-02`'s `FeedbackChain` rather than shared. That one is a
// blocker, a damping pole, a tilt and a soft limiter, which is the reverb's
// loop; this one has a two-ended loop filter, a character block and a hard
// stability requirement on the saturator. Merging them would mean a class with
// two disjoint halves and a mode switch, and the reverb's loop is asserted
// bit-exact by rows that have no business moving when a delay changes.
#pragma once

#include "delay_routing.h"

#include <cmath>

namespace mw::units::delay {

/// One-pole highpass, used for the mandatory DC blocker and the loop's own.
class OnePoleHighpass {
 public:
  void prepare(double sampleRate) noexcept {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    setCorner(corner_);
    reset();
  }
  void reset() noexcept {
    state_ = 0.0;
    previous_ = 0.0;
  }
  void setCorner(double hz) noexcept {
    corner_ = hz < 1.0 ? 1.0 : hz;
    const double k = std::exp(-2.0 * 3.14159265358979323846 * corner_ / sampleRate_);
    coefficient_ = k;
  }
  double process(double x) noexcept {
    // Difference-then-leak, which is the standard blocker: unity well above the
    // corner and exactly zero at DC rather than merely small.
    const double out = x - previous_ + coefficient_ * state_;
    previous_ = x;
    state_ = out;
    return out;
  }

 private:
  double sampleRate_ = 48000.0;
  double corner_ = 20.0;
  double coefficient_ = 0.0;
  double state_ = 0.0;
  double previous_ = 0.0;
};

/// One-pole lowpass for the loop's top end.
class OnePoleLowpass {
 public:
  void prepare(double sampleRate) noexcept {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    setCorner(corner_);
    reset();
  }
  void reset() noexcept { state_ = 0.0; }
  void setCorner(double hz) noexcept {
    const double nyquist = sampleRate_ * 0.5;
    corner_ = hz < 20.0 ? 20.0 : (hz > nyquist * 0.98 ? nyquist * 0.98 : hz);
    coefficient_ = 1.0 - std::exp(-2.0 * 3.14159265358979323846 * corner_ / sampleRate_);
  }
  double process(double x) noexcept {
    state_ += (x - state_) * coefficient_;
    return state_;
  }
  /**
   * Peak gain, which is one for a one-pole and is stated rather than assumed.
   *
   * §3.2(a) makes the loop filter's peak gain part of the stability condition,
   * and the reason this returns a constant is the reason the loop filter is a
   * one-pole cascade rather than a resonant SVF: a resonant filter's peak gain
   * moves with its own resonance control, so the safe feedback range would move
   * with a control the user does not associate with stability.
   */
  static constexpr double peakGain() noexcept { return 1.0; }

 private:
  double sampleRate_ = 48000.0;
  double corner_ = 20000.0;
  double coefficient_ = 1.0;
  double state_ = 0.0;
};

/**
 * §3.1's chain, and §3.2's stability mechanism.
 *
 * **The saturator is not a colour here; it is what makes feedback above 100 %
 * safe to expose.** A linear loop at `fb > 1` diverges without bound. A loop of
 * the form `x ← fb·tanh(x)` does not: it converges to the non-zero fixed point
 * of `a = fb·tanh(a)`, which is the dub runaway that sits at a level instead of
 * destroying the mix. §3.2 therefore allows `fb` to 130 % *on condition that*
 * the saturator cannot be defeated there, which is what the drive floor below
 * enforces.
 */
class DelayFeedback {
 public:
  void prepare(double sampleRate) noexcept {
    for (int ch = 0; ch < 2; ++ch) {
      blocker_[ch].prepare(sampleRate);
      blocker_[ch].setCorner(20.0);
      lowpass_[ch].prepare(sampleRate);
      highpass_[ch].prepare(sampleRate);
      highpass_[ch].setCorner(20.0);
    }
  }

  void reset() noexcept {
    for (int ch = 0; ch < 2; ++ch) {
      blocker_[ch].reset();
      lowpass_[ch].reset();
      highpass_[ch].reset();
    }
  }

  void setLoopLowpass(double hz) noexcept {
    for (int ch = 0; ch < 2; ++ch) lowpass_[ch].setCorner(hz);
  }
  void setLoopHighpass(double hz) noexcept {
    for (int ch = 0; ch < 2; ++ch) highpass_[ch].setCorner(hz);
  }
  void setRouting(const Routing& routing) noexcept { routing_ = routing; }
  void setFeedback(double feedback) noexcept {
    feedback_ = feedback < 0.0 ? 0.0 : (feedback > 1.3 ? 1.3 : feedback);
  }
  /// User drive, in addition to the floor. Never below it — see `driveNow`.
  void setDrive(double drive) noexcept {
    drive_ = drive < 1.0 ? 1.0 : (drive > 8.0 ? 8.0 : drive);
  }

  double feedback() const noexcept { return feedback_; }

  /**
   * The drive actually applied.
   *
   * §3.2 requires the saturator to compress above −6 dBFS whenever `fb > 1`, and
   * requires that this cannot be defeated. So the floor is not a default the
   * user can turn down — it is a function of the feedback setting, and it rises
   * the moment the feedback passes unity. Below unity the loop is stable
   * linearly and the drive is the user's to choose.
   *
   * The floor's value is ours. A drive of 2 puts `tanh` 1.6 dB down at −6 dBFS
   * and 4.4 dB down at 0 dBFS, which is compression by any reading and is
   * gentle enough that a loop just past unity still sounds like a delay rather
   * than a fuzz box.
   */
  double driveNow() const noexcept {
    if (feedback_ <= 1.0) return drive_;
    return drive_ < kRunawayDriveFloor ? kRunawayDriveFloor : drive_;
  }

  /**
   * One sample of the loop, both channels at once.
   *
   * Both channels together because the routing matrix mixes them: doing one
   * channel and then the other would apply the matrix to a left that had
   * already been updated and a right that had not, which is a one-sample
   * asymmetry between the two — inaudible on its own and exactly the kind of
   * thing V13's "0 samples" ping-pong symmetry requirement exists to reject.
   */
  void process(double wetL, double wetR, double* outL, double* outR) noexcept {
    double value[2] = {wetL, wetR};
    for (int ch = 0; ch < 2; ++ch) {
      // §3.1's order: blocker first so the saturator is not biased.
      double v = blocker_[ch].process(value[ch]);
      v = lowpass_[ch].process(v);
      v = highpass_[ch].process(v);
      value[ch] = v;
    }
    const double drive = driveNow();
    for (int ch = 0; ch < 2; ++ch) {
      // Saturator last before the matrix, so what the matrix sees is bounded.
      value[ch] = std::tanh(drive * value[ch]) / drive;
    }
    *outL = feedback_ * (routing_.self * value[0] + routing_.cross * value[1]);
    *outR = feedback_ * (routing_.self * value[1] + routing_.cross * value[0]);
  }

  /// The peak gain the loop's filters contribute, for §3.2(a)'s condition.
  static constexpr double loopFilterPeakGain() noexcept { return OnePoleLowpass::peakGain(); }

 private:
  /// See `driveNow`. Ours, not the sheet's — §3.2 marks its own figure `[I]`.
  static constexpr double kRunawayDriveFloor = 2.0;

  OnePoleHighpass blocker_[2];
  OnePoleLowpass lowpass_[2];
  OnePoleHighpass highpass_[2];
  Routing routing_;
  double feedback_ = 0.4;
  double drive_ = 1.0;
};

}  // namespace mw::units::delay
