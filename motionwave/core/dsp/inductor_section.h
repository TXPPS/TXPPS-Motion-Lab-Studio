// Motion Wave — the British console lineage's filter engine.
//
// `dyn-05` §6.1. The reactive elements are real wound inductors, and three of
// this lineage's four characteristic behaviours fall out of that one fact: the
// band's Q depends on which frequency is selected, it depends on how much boost
// is asked for, and the shelves are not first-order. The fourth — the cores
// saturate — is why `MagneticCore` appears inside the EQ section here and
// nowhere else in the project.
//
// Nothing here is shared with `bridged_t.h`, deliberately. §10 test 19 asserts
// the two lineages produce measurably different curves for nominally equivalent
// settings, and says in as many words that if they match, the two devices are
// sharing a filter engine and one of them is wrong.
#pragma once

#include "biquad.h"
#include "shelving.h"

#include <cmath>

namespace mw::dsp {

/**
 * A switched LC bell, as the mid band of an inductor equaliser.
 *
 * **Q rises with the selected frequency, but only on the upper positions.**
 * §6.1 records the switching scheme: on the lower positions both the
 * inductance and the capacitance are switched, which holds Q roughly constant;
 * on the upper ones only the capacitors are switched and the inductance is
 * held. With L fixed and C set by the frequency, `Q = (1/R)·√(L/C)` grows in
 * proportion to the centre frequency — except that R is not a constant. A wound
 * inductor's AC resistance rises as the square root of frequency through skin
 * and proximity effect, so the growth is `√f` rather than `f`. That is the
 * difference between a 7.2 kHz bell 4.5 times narrower than the 1.6 kHz one and
 * one 2.1 times narrower, and only the second is a filter anyone would ship.
 *
 * **Q also rises with the amount**, which is §6.1's "constant bandwidth rather
 * than constant Q" and is the opposite convention to a textbook parametric. The
 * mechanism is the boost control itself: the network's damping is shared with
 * the divider, so at full boost the network is least damped. §10 test 3 asks
 * for at least 30 % between +4 and +18 dB.
 */
class InductorBell {
 public:
  struct Config {
    double frequency = 1600.0;
    double amountDb = 0.0;
    /// Q at `referenceHz` with the amount at zero.
    double qAtReference = 0.70;
    double referenceHz = 1600.0;
    /**
     * True on the positions where the inductance is switched along with the
     * capacitance, which holds Q constant across them.
     */
    bool inductanceSwitched = true;
    /// The panel's maximum, used to normalise the amount's effect on Q.
    double maxAmountDb = 18.0;
  };

  void prepare(double sampleRate) noexcept {
    sampleRate_ = sampleRate;
    filter_.reset();
    rebuild();
  }

  void setConfig(const Config& config) noexcept {
    config_ = config;
    rebuild();
  }

  void reset() noexcept { filter_.reset(); }
  double process(double x) noexcept { return filter_.process(x); }

  /// The response this section is actually running, for the face and for the
  /// rows that measure it. Read from the coefficients rather than recomputed
  /// from the control values, so a drawn curve cannot disagree with the audio.
  double magnitudeAt(double frequency) const noexcept {
    return filter_.magnitudeAt(frequency, sampleRate_);
  }

  /// What the section is currently working at, for the face and for the rows
  /// that measure it.
  double q() const noexcept { return q_; }

 private:
  void rebuild() noexcept {
    const double amount = config_.amountDb < 0.0 ? -config_.amountDb : config_.amountDb;
    const double maximum = config_.maxAmountDb > 1.0e-6 ? config_.maxAmountDb : 1.0;
    double q = config_.qAtReference;
    if (!config_.inductanceSwitched && config_.referenceHz > 1.0e-6) {
      q *= std::sqrt(config_.frequency / config_.referenceHz);
    }
    q *= 1.0 + kBoostDamping * (amount / maximum);
    q_ = q;
    const double gain = std::pow(10.0, config_.amountDb / 20.0);
    filter_.setCoeffs(peakingCoeffs(config_.frequency, gain, q, sampleRate_));
  }

  /**
   * How much the boost control's own position undamps the network.
   *
   * Ours. §6.1 marks the reference unit's inductor DCR unpublished, so no
   * measured value exists to take. Bounded from both sides by §10: test 3 wants
   * Q up at least 30 % between +4 and +18 dB, which puts this above 0.42, and
   * test 1 wants the band still to reach ±18 dB, which a strongly undamped
   * network overshoots rather than misses. `LEGAL_NOTES.md` records the class
   * of number this is.
   */
  static constexpr double kBoostDamping = 0.7;

  Biquad filter_;
  Config config_{};
  double sampleRate_ = 48000.0;
  double q_ = 0.7;
};

/**
 * A shelving section built from an LC network rather than an RC one.
 *
 * §6.1: an LC shelf has a slight resonant feature near the transition and an
 * asymptote it approaches rather than reaches, and a first-order shelving
 * biquad will not match it. §10 test 4 measures exactly that — it asks for a
 * local maximum or a flattening feature near the transition rather than the
 * monotonic approach of a first-order shelf.
 *
 * The slope parameter above one is what produces it: the term under the root in
 * the shelving design shrinks as the slope rises, which is an under-damped
 * transition and is what an LC network has. Above about 3.2 the term goes
 * negative at ±16 dB and the section stops being a shelf at all, so this is
 * bounded by the arithmetic as well as by the measurement.
 */
class InductorShelf {
 public:
  struct Config {
    double frequency = 60.0;
    double amountDb = 0.0;
    bool high = false;
  };

  void prepare(double sampleRate) noexcept {
    sampleRate_ = sampleRate;
    filter_.reset();
    rebuild();
  }

  void setConfig(const Config& config) noexcept {
    config_ = config;
    rebuild();
  }

  void reset() noexcept { filter_.reset(); }
  double process(double x) noexcept { return filter_.process(x); }

  /// The response this section is actually running, for the face and for the
  /// rows that measure it. Read from the coefficients rather than recomputed
  /// from the control values, so a drawn curve cannot disagree with the audio.
  double magnitudeAt(double frequency) const noexcept {
    return filter_.magnitudeAt(frequency, sampleRate_);
  }

 private:
  void rebuild() noexcept {
    const double gain = std::pow(10.0, config_.amountDb / 20.0);
    filter_.setCoeffs(config_.high
                                ? highShelfCoeffs(config_.frequency, gain, kSlope, sampleRate_)
                                : lowShelfCoeffs(config_.frequency, gain, kSlope, sampleRate_));
  }

  /// See the class comment. Ours, bounded by §10 test 4 and by the design
  /// arithmetic; `LEGAL_NOTES.md` records the class of number this is.
  static constexpr double kSlope = 1.6;

  Biquad filter_;
  Config config_{};
  double sampleRate_ = 48000.0;
};

/**
 * The 18 dB/octave high-pass, §3.5.
 *
 * Third order, so a biquad and a single pole rather than one section of each —
 * an 18 dB slope cannot come from an even-order cascade, and building it from
 * two second-order sections at reduced Q gives 24 dB/octave with a soft knee,
 * which measures as the wrong slope one octave down.
 *
 * **The alignment is Butterworth and that is our choice, not a measurement.**
 * §6.1 says the reference unit's exact alignment is unknown and asks for it to
 * be measured or derived from the schematic; neither was available, so the
 * maximally-flat alignment is used and recorded. §10 test 5 grades the slope
 * and the minimum-phase behaviour, both of which any third-order alignment has,
 * so the row does not silently bless the choice.
 */
class ThirdOrderHighPass {
 public:
  void prepare(double sampleRate) noexcept {
    sampleRate_ = sampleRate;
    rebuild();
    reset();
  }

  void setCorner(double hz) noexcept {
    corner_ = hz;
    rebuild();
  }
  void setEnabled(bool enabled) noexcept { enabled_ = enabled; }

  void reset() noexcept {
    pair_.reset();
    single_.reset();
  }

  double process(double x) noexcept {
    if (!enabled_) return x;
    return single_.process(pair_.process(x));
  }

  double magnitudeAt(double frequency) const noexcept {
    if (!enabled_) return 1.0;
    return pair_.magnitudeAt(frequency, sampleRate_) * single_.magnitudeAt(frequency, sampleRate_);
  }

 private:
  void rebuild() noexcept {
    // A third-order Butterworth has one real pole at the corner and a complex
    // pair at Q = 1. Not 0.707: that is the second-order value, and using it
    // here puts a 1.2 dB dip just above the corner.
    pair_.setCoeffs(highpassCoeffs(corner_, 1.0, sampleRate_));
    single_.setCoeffs(onePoleHighpassCoeffs(corner_, sampleRate_));
  }

  Biquad pair_;
  Biquad single_;
  double sampleRate_ = 48000.0;
  double corner_ = 80.0;
  bool enabled_ = false;
};

}  // namespace mw::dsp
