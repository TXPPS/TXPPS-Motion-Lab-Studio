// Motion Wave — the photoresistive cell's dynamics, which are the whole unit.
//
// `dyn-02` §4. The cell *is* the dynamics engine and it is not a first-order
// system, so nothing here is an envelope follower with an attack and a release
// knob. What it models is a piece of physics with three states:
//
//   1. **Attack**, a single first-order rise, 10 ms from 10 % to 90 % of the
//      applied reduction. Slow enough that transients pass substantially
//      unattenuated — the unit levels, it does not limit, and that is the first
//      thing anyone notices about it.
//   2. **Release in two branches.** The first recovers about half the applied
//      reduction with a 60 ms time constant; the second recovers the rest, far
//      more slowly. Every source agrees on the 60 ms.
//   3. **Exposure history**, which is what makes the second branch's rate not a
//      number. A cell that has been saturated with light recovers more slowly,
//      and a cell that has been resting recovers quickly, so the same transient
//      arriving after two different histories recovers at two different rates.
//
// **Release must never be exposed as a fixed value.** §4's consequences are
// explicit: a model whose release is identical after 200 ms of work and after
// 60 s of it has no memory state, and the sheet's test 5 exists to fail it.
//
// The two release branches are modelled as two conductance components that sum,
// rather than as one state with a switching rate. Two components is what the
// published behaviour describes — half the reduction recovering quickly and the
// rest slowly, *at the same time* — and a single state that changed rate
// halfway would recover in two visibly straight segments where the hardware
// bends continuously.
#pragma once

#include <cmath>

namespace mw::dsp {

/// Everything the cell's behaviour is set from. Times in seconds.
struct OpticalCellConfig {
  /**
   * Attack, as a first-order time constant.
   *
   * Every published time constant for this cell is a **dB-domain
   * observation** — "10 ms" is a 10 %-to-90 % span of *gain reduction*, and
   * "0.06 s for 50 %" is half the reduction in decibels. The model runs in
   * conductance, because §4's implementer rule says to model the cell's
   * conductance and not the gain in dB, and the map between the two is
   * logarithmic. So a constant written straight from the sheet reproduces the
   * sheet's *number* and not the sheet's *behaviour*.
   *
   * These are therefore calibrated against the measurement rather than copied
   * from the specification, and the tests assert the observable.
   *
   * They are also calibrated *in the loop*. This unit is a feedback compressor,
   * and a feedback loop changes every effective time constant it contains — the
   * same cell that measured 9.98 ms of attack open-loop measured 5.35 ms once
   * the detector was watching the output it had just attenuated. The numbers
   * here are the ones that produce the published figures where the sheet
   * measures them, which is at the unit's output.
   */
  double attackSeconds = 0.00675;
  /// Release branch one, calibrated the same way and in the same loop, against
  /// the 60 ms every source agrees on.
  double releaseFastSeconds = 0.095;
  /**
   * Release branch two, at the two ends of the exposure range.
   *
   * The manufacturer's specification gives 0.5 to 5 s for the remainder; later
   * and widely repeated descriptions give 1 to 15 s. §10 of the sheet takes the
   * original specification as the primary target and the later range as the
   * outer envelope a heavily-exercised cell may reach, and so does this.
   *
   * Calibrated in conductance as above, 1.2 to 12 s produces the specification's
   * observable: 0.70 s to recover from 5 dB to 0.5 dB after a short history and
   * 2.92 s after a long one, both inside the published 0.5-to-5 s window, with
   * the constants themselves sitting inside the later sources' envelope. The
   * two accounts turn out not to disagree — they are measuring the same cell at
   * two points on its own history curve.
   */
  double releaseSlowMinSeconds = 1.2;
  double releaseSlowMaxSeconds = 12.0;
  /// How fast the exposure state accumulates and forgets. Its decay is much the
  /// slower of the two, which is what "a cell that has been resting recovers
  /// faster" means.
  double exposureRiseSeconds = 4.0;
  double exposureFallSeconds = 18.0;
  /// Share of the reduction the fast branch carries. The sheet's "0.06 s for
  /// 50 %".
  double fastShare = 0.5;
  /**
   * The conductance that counts as the cell working hard, for the exposure
   * state's full scale.
   *
   * Not 1.0, and that matters. The cell's conductance only approaches unity at
   * the very bottom of its 40 dB range, so an exposure state normalised against
   * unity barely moves at the 6-to-12 dB depths the unit is actually used at —
   * it reached 0.26 after a minute of steady work, which stretched the slow
   * release by far less than the sheet's memory test looks for. What "this cell
   * has been saturated with light" describes is a working depth sustained, not
   * the maximum the part can reach.
   */
  double exposureReference = 0.30;
  /**
   * How much more slowly the second branch fills than the first.
   *
   * Both branches attacked at the same rate to begin with, and the loop
   * overshot badly from cold: the pair rose together, the loop's output dropped
   * past its equilibrium, and the excess then had to leave through the *slow*
   * release — so a 200 ms burst on a fresh unit settled at 13.8 dB where the
   * same unit's equilibrium was 8.0 dB, and it took ten seconds to get there.
   * Two trap populations with the same capture rate is also not what the
   * physics describes; the deeper states fill more slowly, which is the same
   * asymmetry that makes them empty more slowly.
   */
  double slowAttackScale = 14.0;
};

/**
 * The cell.
 *
 * `process` takes how hard the panel is being driven, 0…1, and returns the
 * cell's conductance, 0…1 — not a gain and not decibels. Modelling the
 * conductance rather than the gain is §4's implementer rule, and it is not a
 * presentation choice: the cell's resistance is what has the time constants, so
 * a model that ran its envelope in decibels would be putting the physics one
 * transformation away from where it happens and would get the release curve's
 * *shape* wrong even with the right numbers.
 */
class OpticalCell {
 public:
  void prepare(double sampleRate, const OpticalCellConfig& config) noexcept {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    setConfig(config);
    reset();
  }

  void setConfig(const OpticalCellConfig& config) noexcept {
    config_ = config;
    attack_ = coeffFor(config.attackSeconds);
    slowAttack_ = coeffFor(config.attackSeconds * config.slowAttackScale);
    releaseFast_ = coeffFor(config.releaseFastSeconds);
    exposureRise_ = coeffFor(config.exposureRiseSeconds);
    exposureFall_ = coeffFor(config.exposureFallSeconds);
  }

  void reset() noexcept {
    fast_ = 0.0;
    slow_ = 0.0;
    exposure_ = 0.0;
  }

  double process(double drive) noexcept {
    const double target = drive < 0.0 ? 0.0 : (drive > 1.0 ? 1.0 : drive);
    const double fastTarget = target * config_.fastShare;
    const double slowTarget = target * (1.0 - config_.fastShare);

    // Rising and falling are different mechanisms in the cell, not one filter
    // with two coefficients: light drives the conductance up quickly and the
    // crystal relaxes back down on its own. Both branches attack together —
    // there is one illumination — and release independently.
    fast_ = fastTarget > fast_ ? approach(fast_, fastTarget, attack_)
                               : approach(fast_, fastTarget, releaseFast_);

    // The slow branch's rate is a function of exposure, recomputed per sample
    // because the exposure is moving. `exp` per sample is the honest cost of a
    // time constant that is genuinely not constant; there is no table that
    // would be correct, because the mapping is what the test measures.
    const double slowSeconds = slowReleaseSeconds();
    const double slowCoeff = coeffFor(slowSeconds);
    slow_ = slowTarget > slow_ ? approach(slow_, slowTarget, slowAttack_)
                               : approach(slow_, slowTarget, slowCoeff);

    // Exposure integrates the *light*, not the conductance.
    //
    // It was the conductance first, on the reasoning that the history which
    // matters is what the cell actually did. That is wrong about the physics
    // and it showed: the conductance is still high all through a release, so
    // the exposure kept climbing while the cell recovered, and a 200 ms burst
    // ended up with almost as much accumulated history as a minute of work —
    // the memory test measured a ratio of 1.19 where it needs at least 2. The
    // panel goes dark the moment the signal stops, so the phosphor stops
    // delivering light then, and the state starts forgetting.
    const double applied = fast_ + slow_;
    const double normalised = config_.exposureReference > 1.0e-6
                                  ? target / config_.exposureReference
                                  : target;
    const double exposureTarget = normalised > 1.0 ? 1.0 : normalised;
    exposure_ = exposureTarget > exposure_
                    ? approach(exposure_, exposureTarget, exposureRise_)
                    : approach(exposure_, exposureTarget, exposureFall_);
    return applied;
  }

  /// Conductance, 0…1. What the attenuator is handed.
  double conductance() const noexcept { return fast_ + slow_; }
  /// The history state, 0…1, for a face that wants to show why release moved.
  double exposure() const noexcept { return exposure_; }
  /// The second branch's current time constant, in seconds. The number the
  /// sheet says must never be a constant, exposed so a test can watch it move.
  double slowReleaseSeconds() const noexcept {
    const double e = exposure_ < 0.0 ? 0.0 : (exposure_ > 1.0 ? 1.0 : exposure_);
    return config_.releaseSlowMinSeconds +
           (config_.releaseSlowMaxSeconds - config_.releaseSlowMinSeconds) * e;
  }

 private:
  static double approach(double state, double target, double coeff) noexcept {
    const double next = target + (state - target) * coeff;
    // Flushed rather than left to drift into denormals: this runs per sample on
    // the audio thread and a decaying state is exactly where denormals arrive.
    return (next < 1.0e-30 && next > -1.0e-30) ? 0.0 : next;
  }

  double coeffFor(double seconds) const noexcept {
    if (seconds <= 0.0) return 0.0;
    return std::exp(-1.0 / (seconds * sampleRate_));
  }

  OpticalCellConfig config_{};
  double sampleRate_ = 48000.0;
  double attack_ = 0.0;
  double slowAttack_ = 0.0;
  double releaseFast_ = 0.0;
  double exposureRise_ = 0.0;
  double exposureFall_ = 0.0;
  double fast_ = 0.0;
  double slow_ = 0.0;
  double exposure_ = 0.0;
};

}  // namespace mw::dsp
