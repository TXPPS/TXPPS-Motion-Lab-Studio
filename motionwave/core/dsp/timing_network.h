// Motion Wave — the control-voltage storage network.
//
// `dyn-04` §4 positions 5 and 6, and the reason they are not "auto release".
// The hardware has more than one storage element on the control path, and their
// recoveries are 2 s, 10 s and 25 s. The observed recovery is not one of those
// three selected by a rule; it is where the charge happens to be, which is why
// §9 test 5 sweeps the repetition rate continuously and asserts there is no
// step anywhere in the curve. A model that detects "multiple peaks" and
// switches to a longer release passes tests 2 and 3 and fails test 5 by
// construction — and would sound like it, because the switch is audible.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>

namespace mw::dsp {

/**
 * A cascade of storage elements, each holding up the one before it.
 *
 * The topology is a chain, not a set of independent branches, and the
 * difference is the whole behaviour. The fast element discharges toward the
 * *medium* element rather than toward zero, and the medium toward the slow, so
 * the recovery a listener hears is fast down to whatever the next element along
 * has accumulated and slow from there. A single peak leaves the slow elements
 * nearly empty and recovers fast; repeated peaks charge them and the same fast
 * element then has a raised floor to decay to. Nothing decides which regime is
 * in effect, because nothing needs to.
 *
 * Each element charges faster than it discharges. That is not a convenience: a
 * storage capacitor fed through a diode and drained through a resistor does
 * exactly this, and with a single symmetric constant the medium element cannot
 * reach a useful charge inside the ten bursts §9 test 3 applies — it would
 * track their *mean* rather than accumulating toward their peak, and the
 * measured recovery would come out around half the published figure.
 */
class TimingNetwork {
 public:
  static constexpr std::size_t kMaxStages = 3;

  struct Stage {
    /// Time constant of this element's discharge, in seconds.
    double releaseSeconds = 0.3;
    /// Time constant of its charge from the element before it, in seconds.
    /// Ignored on the first element, which charges through the attack.
    double accumulateSeconds = 0.3;
  };

  struct Config {
    double attackSeconds = 0.0004;
    Stage stages[kMaxStages] = {};
    /// One element is an ordinary attack/release; two and three are §4's
    /// programme-dependent positions.
    std::size_t count = 1;
  };

  void prepare(double sampleRate, const Config& config) noexcept {
    sampleRate_ = sampleRate;
    setConfig(config);
    reset();
  }

  void setConfig(const Config& config) noexcept {
    config_ = config;
    count_ = std::min(config.count, kMaxStages);
    if (count_ == 0) count_ = 1;
    attack_ = coefficient(config.attackSeconds);
    for (std::size_t i = 0; i < count_; ++i) {
      release_[i] = coefficient(config_.stages[i].releaseSeconds);
      accumulate_[i] = coefficient(config_.stages[i].accumulateSeconds);
    }
  }

  void reset() noexcept {
    for (std::size_t i = 0; i < kMaxStages; ++i) state_[i] = 0.0;
  }

  /**
   * Advance one sample and return the control value.
   *
   * **Every element discharges to ground, and each charges from the one in
   * front of it only while that one is higher.** That is a diode and a resistor
   * per element, which is what the hardware has, and the "only while higher"
   * is the diode: once the fast node falls the path blocks and the storage
   * element is left to leak through its own resistance.
   *
   * Making an element discharge toward its *source* instead deadlocks the
   * chain. The fast element decays toward the slow one while the slow one
   * charges toward the fast one, and with the two rates comparable they meet in
   * the middle and stop: measured, the gain reduction settled at 5.58 dB of an
   * initial 12.2 and stayed there past sixteen seconds, so every recovery row
   * in positions 5 and 6 timed out rather than returning a wrong number.
   *
   * The control is the maximum across the elements, because they are all
   * diode-coupled to the same grid line. Taking the first element's value would
   * be right only in the chain that deadlocks.
   */
  double process(double target) noexcept {
    // Advanced from the values held on entry, so a single sample cannot
    // propagate down the whole chain — that would be a much faster network than
    // the one being modelled.
    double previous[kMaxStages];
    for (std::size_t i = 0; i < count_; ++i) previous[i] = state_[i];

    double highest = 0.0;
    for (std::size_t i = 0; i < count_; ++i) {
      const double above = i == 0 ? target : previous[i - 1];
      const double charge = i == 0 ? attack_ : accumulate_[i];
      if (above > previous[i]) {
        state_[i] += (above - previous[i]) * charge;
      } else {
        state_[i] -= previous[i] * release_[i];
      }
      if (state_[i] > highest) highest = state_[i];
    }
    return highest;
  }

  double value() const noexcept {
    double highest = 0.0;
    for (std::size_t i = 0; i < count_; ++i) {
      if (state_[i] > highest) highest = state_[i];
    }
    return highest;
  }
  /// For tests and for the visualiser: what each element is holding.
  double stageValue(std::size_t i) const noexcept { return i < kMaxStages ? state_[i] : 0.0; }

 private:
  double coefficient(double seconds) const noexcept {
    if (seconds <= 0.0 || sampleRate_ <= 0.0) return 1.0;
    return 1.0 - std::exp(-1.0 / (seconds * sampleRate_));
  }

  Config config_{};
  double sampleRate_ = 48000.0;
  double attack_ = 1.0;
  double release_[kMaxStages] = {1.0, 1.0, 1.0};
  double accumulate_[kMaxStages] = {1.0, 1.0, 1.0};
  double state_[kMaxStages] = {0.0, 0.0, 0.0};
  std::size_t count_ = 1;
};

}  // namespace mw::dsp
