// Motion Wave — where the modulator thinks it is in the bar.
//
// Two of `fx-01`'s gates live entirely in this file, and both are about
// *exactness* rather than about sound:
//
//   V7  1/16 gate curve, 128 bars at 174 BPM, then a seek to bar 100. Zero
//       samples of error at every onset, including after the seek.
//   V8  Swing 100 % puts the boundary at exactly 2/3 of each pair, ±1 sample.
//
// V7 is why phase is *derived* from transport position rather than accumulated.
// An accumulator is the obvious implementation and it fails twice: it drifts,
// because each block adds a rounding error that never comes back, and it is
// simply wrong after a locate, because the transport moved and the accumulator
// did not. The reference product has a drift report against it for exactly
// this. Deriving `phi = frac(ppq / length)` costs one division and cannot drift,
// because nothing accumulates.
//
// Free-running mode does accumulate — it has to, it is not locked to anything —
// but it is re-seeded from transport position when the transport starts, so a
// bounce of the same bars twice produces the same modulation. Without that,
// "render it again" would be a different record.
#pragma once

#include <cmath>

namespace mw::dsp {

/// Where the phase comes from.
enum class PhaseMode {
  /// Locked to the transport. Sample-accurate across locate, loop and seek.
  Host,
  /// Free-running at its own rate, re-seeded at transport start.
  Free,
  /// Reset to zero by an external trigger, then running forward.
  Trigger,
};

/// What a trigger does when the curve reaches its end.
enum class TriggerEnd {
  /// Wrap and keep going.
  Loop,
  /// Hold at 1.0 until the next trigger.
  OneShot,
};

/**
 * Warp a phase within pairs of subdivisions, for swing.
 *
 * `units` is how many swing units fill one LFO period — 16 for a 1/16 feel
 * across a bar-long shape. The boundary within a pair moves from 1/2 at no
 * swing to 2/3 at full, which is the triplet feel exactly rather than
 * approximately; V8 asserts that number.
 *
 * Continuous and monotonic by construction, so it introduces no discontinuity
 * of its own. Its derivative is piecewise constant, which means swing changes
 * the modulator's *rate* within each half of a pair — which is what swing is,
 * and is why this cannot be done by simply shifting alternate onsets.
 */
inline double applySwing(double phi, double amount, double units) noexcept {
  if (amount <= 0.0 || units < 2.0) return phi;
  const double s = amount > 1.0 ? 1.0 : amount;
  const double pairs = units * 0.5;
  const double scaled = phi * pairs;
  const double whole = std::floor(scaled);
  const double q = scaled - whole;
  // 0.5 at s = 0, 2/3 at s = 1.
  const double b = 0.5 + s / 6.0;
  const double warped = (q < b) ? (0.5 * q / b) : (0.5 + 0.5 * (q - b) / (1.0 - b));
  return (whole + warped) / pairs;
}

/**
 * The modulator's position in its own cycle.
 *
 * Holds no audio state, only where it is. Kept separate from the curve because
 * every band and every slot of one instance share a phase source while drawing
 * different shapes on it — and because the two are tested separately, which is
 * what let the swing arithmetic be checked without a curve in the way.
 */
class LfoPhase {
 public:
  void setMode(PhaseMode mode) noexcept { mode_ = mode; }
  void setTriggerEnd(TriggerEnd end) noexcept { triggerEnd_ = end; }
  /// LFO length in quarter notes, for host mode.
  void setLengthQuarters(double quarters) noexcept {
    lengthQuarters_ = quarters > 1.0e-6 ? quarters : 1.0e-6;
  }
  /// Cycles per second, for free and trigger modes.
  void setRateHz(double hz) noexcept { rateHz_ = hz < 0.0 ? 0.0 : hz; }
  void setSwing(double amount, double units) noexcept {
    swing_ = amount;
    swingUnits_ = units;
  }
  /// Degrees, applied last so it shifts the finished shape rather than warping it.
  void setOffsetDegrees(double degrees) noexcept { offset_ = degrees / 360.0; }

  /// Restart the cycle. A trigger, or a transport start in free mode.
  void trigger(double atQuarters) noexcept {
    free_ = 0.0;
    finished_ = false;
    // Re-seeded from transport rather than simply zeroed, so that two renders
    // of the same bars agree. A free LFO that started wherever the play button
    // happened to be pressed would make a bounce unrepeatable.
    seedQuarters_ = atQuarters;
  }

  void reset() noexcept {
    free_ = 0.0;
    finished_ = false;
    seedQuarters_ = 0.0;
  }

  /**
   * Phase for the frame at transport position `quarters`.
   *
   * `quarters` is absolute song position, which is what makes host mode
   * seek-proof: the answer depends only on where the song is, so jumping there
   * gives the same phase as arriving there.
   *
   * `sampleRate` is only used by the accumulating modes; host mode ignores it
   * entirely, which is another way of saying it cannot drift.
   */
  double next(double quarters, double sampleRate) noexcept {
    double phi = 0.0;
    switch (mode_) {
      case PhaseMode::Host:
        phi = quarters / lengthQuarters_;
        break;
      case PhaseMode::Free:
        phi = free_;
        advanceFree(sampleRate);
        break;
      case PhaseMode::Trigger:
        phi = finished_ ? 1.0 : free_;
        if (!finished_) {
          advanceFree(sampleRate);
          if (triggerEnd_ == TriggerEnd::OneShot && free_ >= 1.0) {
            free_ = 1.0;
            finished_ = true;
          }
        }
        break;
    }
    // Wrap before warping. Swing is defined on a position within a cycle, and
    // handing it a phase of 37.4 would put the pair boundary in a different
    // place every cycle.
    if (mode_ != PhaseMode::Trigger || !finished_) phi = phi - std::floor(phi);
    phi = applySwing(phi, swing_, swingUnits_);
    phi += offset_;
    return phi - std::floor(phi);
  }

  /// Where a free or trigger cycle was seeded, for diagnostics.
  double seedQuarters() const noexcept { return seedQuarters_; }
  bool finished() const noexcept { return finished_; }

 private:
  void advanceFree(double sampleRate) noexcept {
    if (sampleRate > 0.0) free_ += rateHz_ / sampleRate;
    // Kept in [0, 2) rather than wrapped to [0, 1), so a one-shot can tell it
    // has passed the end. Subtracting rather than using `fmod` keeps the value
    // from losing precision over a long session.
    while (free_ >= 2.0) free_ -= 1.0;
  }

  PhaseMode mode_ = PhaseMode::Host;
  TriggerEnd triggerEnd_ = TriggerEnd::Loop;
  double lengthQuarters_ = 4.0;
  double rateHz_ = 1.0;
  double swing_ = 0.0;
  double swingUnits_ = 16.0;
  double offset_ = 0.0;
  double free_ = 0.0;
  double seedQuarters_ = 0.0;
  bool finished_ = false;
};

}  // namespace mw::dsp
