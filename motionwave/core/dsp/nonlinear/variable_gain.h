// Motion Wave — gain cells whose gain and whose distortion are the same thing.
//
// `lib-nonlinear.md` §3.2 and §4.3. The remote-cutoff cell is the reason the
// Variable-Mu Limiter sounds the way it does: the component being distorted and
// the component doing the compressing are one, so the ratio rises with gain
// reduction as a *consequence* of the element rather than as a curve somebody
// imposed. Neither cell owns a detector — they take a control voltage and
// return audio, and the unit closes the loop. That split is why a ratio control
// need not exist anywhere.
#pragma once

#include "triode_stage.h"

namespace mw::dsp::nl {

/**
 * A remote-cutoff gain cell.
 *
 * Transconductance falls with bias toward a cutoff voltage, §4.3 (8):
 *
 *     gm(v) = gm0 · (1 − v/Vc)^p ,   gain_dB(v) = 20·p·log10(1 − v/Vc)
 *
 * and differentiating gives a slope that *grows* as v approaches cutoff, so
 * each additional volt buys more decibels than the last. Following the formula
 * with p = 2.5, the slope at 20 dB of reduction is 2.19× the slope at 3 dB.
 *
 * A note on the sheet, because it cost time to reconcile: §4.3's worked control
 * voltages ("v/Vc = 0.056 at 3 dB", "0.309 at 20 dB") do not follow from its own
 * equation (9) at p = 2.5 — that equation puts them at 0.129 and 0.602. The two
 * slopes quoted alongside, 21.7 and 31.4 dB/V, are (10) evaluated at v = 0 and
 * at v/Vc = 0.309 respectively, so the worked column is inconsistent with
 * itself as well as with the formula. The formula is what is implemented,
 * because the formula is what the pass criterion grades — and the criterion,
 * "slope at 20 dB at least 1.40× the slope at 3 dB", is met with 2.19×.
 */
class RemoteCutoffCell {
 public:
  struct Config {
    /// Cutoff voltage. `control` runs from 0 (no reduction) toward this.
    float cutoffVolts = 1.0f;
    /// Exponent of the transconductance law, §4.3.
    float lawExponent = 2.5f;
    /**
     * How far up the curve the cell's balanced pair sits at full cutoff.
     *
     * The audio rides on the same electrode as the control, so driving the pair
     * toward cutoff moves its operating point — which is what makes distortion
     * rise faster than gain falls, and what brings the second harmonic back at
     * depth through `imbalancePerBias`. Setting this to zero gives a clean
     * variable gain and the distortion tests fail by name, which is the point:
     * it is the mechanism, not a seasoning.
     */
    float biasAtCutoff = 0.8f;
    /**
     * Fraction of the audio swing that appears at the control electrode, §4.3's
     * κ.
     *
     * This is the mechanism, and it is what separates this cell from a variable
     * gain with a saturator after it. The audio rides on the same electrode as
     * the control, so the gain the signal sees moves *with the signal* — and
     * because the second derivative of the transconductance law grows as
     * (1 − v/Vc)^(p−2), that modulation gets sharply more nonlinear as the cell
     * approaches cutoff. Distortion therefore rises far faster than gain falls,
     * which is the sheet's requirement and is a consequence here rather than a
     * parameter.
     *
     * 0.001 is ours, and it is small for a reason worth recording. The law's
     * own even order rises 6.8 dB between 3 dB and 20 dB of reduction — the
     * ratio of (1 − v/Vc) at those two points, and no more, because the second
     * harmonic of a power law is first order in the coupling. That is short of
     * the 10 dB the sheet requires, so the coupling cannot be the whole
     * mechanism at any value: raising it makes the cell distort more at *both*
     * points while the rise stays at 6.8 dB. What supplies the steep part is
     * the pair's operating point moving toward cutoff, which pulls its two
     * halves apart in proportion and returns even order in proportion to that.
     * So this is set low enough that the pair's mechanism dominates, and the
     * two together measure 12.3 dB. No published measurement of the reference
     * unit's grid coupling exists; `LEGAL_NOTES.md` records the class of number
     * this is.
     */
    float gridCoupling = 0.001f;
    PushPullStage::Config stage{};
  };

  void prepare(double sampleRate, const Config& config) noexcept {
    config_ = config;
    stage_.prepare(sampleRate, config.stage);
    lastControl_ = -1.0f;
  }

  void setConfig(const Config& config) noexcept {
    config_ = config;
    lastControl_ = -1.0f;  // force the stage's bias to be rewritten
  }

  void reset() noexcept {
    stage_.reset();
    lastControl_ = -1.0f;
  }

  /// `control` in volts, 0…cutoffVolts. The unit is responsible for having
  /// smoothed it; a step here is a step in the audio.
  float process(float x, float control) noexcept {
    const float v = clampControl(control);
    if (v != lastControl_) {
      PushPullStage::Config stage = config_.stage;
      stage.bias = config_.biasAtCutoff * (v / config_.cutoffVolts);
      stage_.setConfig(stage);
      lastControl_ = v;
    }
    // The audio at the control electrode, §4.3 (11). Evaluated per sample and
    // *not* folded into `linearGain`, because the meter's question is "how much
    // is this reducing" and the answer to that is the gain at zero signal — the
    // signal-dependent part is the distortion and belongs in the audio.
    const float modulated = v + config_.gridCoupling * x;
    return stage_.process(x) * lawGain(modulated);
  }

  /**
   * Gain in decibels at a control voltage, from the same law `process` uses.
   *
   * The gain-reduction meter reads this, so a meter cannot disagree with the
   * audio. That is the house rule, and it is the rule that has caught the most
   * bugs here — a meter fed from a second formula agrees right up until one of
   * the two is changed.
   */
  float gainDb(float control) const noexcept {
    const float v = clampControl(control);
    return 20.0f * config_.lawExponent * std::log10(ratio(v));
  }

  float linearGain(float control) const noexcept { return lawGain(clampControl(control)); }

  Curvature curvature() const noexcept { return stage_.curvature(); }

 private:
  float clampControl(float control) const noexcept {
    // Stopped short of cutoff rather than at it. At v = Vc the gain is exactly
    // zero and the slope is infinite, and a control that can reach it makes the
    // meter read −inf on the last hundredth of its travel.
    const float top = config_.cutoffVolts * 0.999f;
    return control < 0.0f ? 0.0f : (control > top ? top : control);
  }
  float ratio(float v) const noexcept { return 1.0f - v / config_.cutoffVolts; }
  /// The transconductance law itself. Floored rather than allowed to go
  /// negative: the audio can swing the electrode past cutoff on one half cycle,
  /// where the device is simply off, and `pow` of a negative base is a NaN
  /// travelling into the mix.
  float lawGain(float v) const noexcept {
    const float r = ratio(v);
    return r <= 1.0e-4f ? 0.0f : std::pow(r, config_.lawExponent);
  }

  Config config_{};
  PushPullStage stage_;
  float lastControl_ = -1.0f;
};

/**
 * The Optical Leveller's attenuator element.
 *
 * Its dynamics — the two release branches, the exposure-history state — belong
 * to that unit and are not here: they are what makes that unit *that unit*,
 * while what belongs in a shared library is only the cell's static curvature,
 * which its sheet marks as a mild second-order effect.
 *
 * `signalDependence` defaults to zero, which makes this a clean attenuator.
 * That is the correct default until a data sheet arrives, and it is stated as a
 * default rather than an omission so that nobody adds a guess later believing
 * they are filling a gap.
 */
class PhotoresistiveCell {
 public:
  struct Config {
    /**
     * The cell's own resistance at each end of its illumination, and the series
     * element it divides against.
     *
     * The series resistance is its *own* number and has to be. An earlier
     * version reused the lit resistance as the series element, which caps the
     * divider at exactly −6.02 dB — the two are equal at full illumination, so
     * the cell can never attenuate past a half — and this unit is specified to
     * reach 40 dB of gain reduction. The bug is invisible at small reductions
     * and impossible past six of them.
     *
     * Values are normalised rather than in ohms: no citable published figure
     * for the reference cell's dark and light resistance was found, which §6 of
     * the sheet records as an outstanding item. What is calibrated is the
     * *ratio*, against the published 40 dB of available reduction.
     */
    float darkResistance = 1.0f;
    float lightResistance = 1.0e-4f;
    float seriesResistance = 0.01f;
    float signalDependence = 0.0f;
  };

  void prepare(double, const Config& config) noexcept { config_ = config; }
  void setConfig(const Config& config) noexcept { config_ = config; }
  void reset() noexcept {}

  /// `conductance` runs 0 (dark, no attenuation) to 1 (fully illuminated).
  float process(float x, float conductance) noexcept {
    const float c = conductance < 0.0f ? 0.0f : (conductance > 1.0f ? 1.0f : conductance);
    const float ax = x < 0.0f ? -x : x;
    // The cell's own resistance moves with the signal across it, which is the
    // second-order effect the sheet describes. Applied to the resistance rather
    // than to the output, because that is where it happens: a term added to the
    // output would give the same harmonic at one setting and the wrong one at
    // every other.
    const float r = resistanceAt(c) * (1.0f + config_.signalDependence * ax);
    return x * r / (r + config_.seriesResistance);
  }

  float gainDb(float conductance) const noexcept {
    const float c = conductance < 0.0f ? 0.0f : (conductance > 1.0f ? 1.0f : conductance);
    const float r = resistanceAt(c);
    return 20.0f * std::log10(r / (r + config_.seriesResistance));
  }

 private:
  float resistanceAt(float c) const noexcept {
    // Logarithmic between the two endpoints: a photoresistor's resistance falls
    // by orders of magnitude with illumination, and interpolating it linearly
    // would spend nearly all of the control's travel in the last decade.
    const float lo = std::log(config_.lightResistance);
    const float hi = std::log(config_.darkResistance);
    return std::exp(hi + (lo - hi) * c);
  }

  Config config_{};
};

}  // namespace mw::dsp::nl
