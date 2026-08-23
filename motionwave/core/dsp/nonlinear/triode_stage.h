// Motion Wave — the single-ended and balanced gain stages.
//
// `lib-nonlinear.md` §3.2 and §4.1–4.2. These two types are the difference
// between a unit that sounds second-harmonic-led at moderate level with the
// third emerging as it is pushed, and a unit that sounds the same at every
// setting. A symmetric shaper cannot do the first at any drive, which is why
// the asymmetry here is an operating point rather than a curve choice.
//
// The design rule the whole family is calibrated by, §4.1 (4):
//
//     u0 >= A / 3
//
// — the operating point must be at least a third of the peak drive for the
// second harmonic to lead the third by 6 dB, and the two are equal at A = 3·u0.
// That inequality is the calibration for three of the five units.
#pragma once

#include "curve.h"
#include "stage_scratch.h"

namespace mw::dsp::nl {

/**
 * A one-pole high-pass that removes a stage's operating-point offset.
 *
 * A biased curve has a non-zero mean, and without this the offset walks into
 * the next stage and biases *it* — which is how a chain of three stages ends up
 * asymmetric in a way nobody designed and nobody can find, because each stage
 * on its own is correct.
 */
class DcRestore {
 public:
  void prepare(double sampleRate, float cornerHz) noexcept {
    const double w = 2.0 * 3.14159265358979323846 * static_cast<double>(cornerHz) / sampleRate;
    coeff_ = static_cast<float>(std::exp(-w));
    state_ = 0.0f;
  }
  void reset() noexcept { state_ = 0.0f; }
  float process(float x) noexcept {
    state_ = flushSmall(coeff_ * state_ + (1.0f - coeff_) * x);
    return x - state_;
  }

 private:
  float coeff_ = 0.999f;
  float state_ = 0.0f;
};

/**
 * One asymmetric gain stage.
 *
 * The Program EQ's make-up amplifier, the Optical Leveller's voltage amplifier
 * and the British console lineage's discrete Class A stages are all this with
 * different drive and bias. Not virtual: at 8× oversampling a virtual call is
 * eight indirect calls per host sample per channel, and the compiler cannot
 * inline the shaper into the oversampler's inner loop through one.
 */
class TriodeStage {
 public:
  struct Config {
    /// Peak input amplitude mapped onto the curve's argument. Sets how far up
    /// the curve the signal runs, and therefore the third-harmonic level.
    float drive = 0.2735f;
    /// Operating-point offset in the same units. §4.1's worked anchor for the
    /// Program EQ's make-up amplifier at +10 dBm and 0.15 % THD.
    float bias = 0.0459f;
    float restoreHz = 5.0f;
  };

  void prepare(double sampleRate, const Config& config) noexcept {
    sampleRate_ = sampleRate;
    config_ = config;
    restore_.prepare(sampleRate, config.restoreHz);
    // The stage's small-signal gain at its own operating point, divided out so
    // that changing the bias changes the *harmonics* and not the level. A stage
    // whose bias control also moved its gain would be two controls in one, and
    // the second of them would be invisible.
    normal_ = 1.0f / curveDerivatives(config.bias).first;
  }

  void setConfig(const Config& config) noexcept {
    const bool cornerMoved = config.restoreHz != config_.restoreHz;
    config_ = config;
    normal_ = 1.0f / curveDerivatives(config.bias).first;
    if (cornerMoved) restore_.prepare(sampleRate_, config.restoreHz);
  }

  void reset() noexcept { restore_.reset(); }

  float process(float x) noexcept {
    const float shaped = curve(config_.drive * x + config_.bias) * normal_;
    return restore_.process(shaped) / config_.drive;
  }

  /// The coefficients this instance is currently running at, for a face.
  Curvature curvature() const noexcept { return nl::curvature(config_.bias); }

 private:
  Config config_{};
  DcRestore restore_;
  double sampleRate_ = 48000.0;
  float normal_ = 1.0f;
};

/**
 * Two half-stages driven anti-phase and subtracted.
 *
 *     y = ½·[ (1+β)·R(g(x + b)) − (1−β)·R(g(−x + b)) ]              §4.2 (5)
 *
 * At β = 0 every even-order term cancels *identically* — term by term, because
 * (5) reduces to an odd function of x — which is why the even-order test can
 * assert −80 dBc rather than "below some measured floor". Anything above the
 * arithmetic noise there means the two halves are not being evaluated on the
 * same curve, which is a real defect rather than a tolerance.
 *
 * At β ≠ 0 the even order returns in proportion, and to first order β *is* the
 * second-harmonic ratio. That makes the imbalance a legible parameter rather
 * than a fudge factor.
 */
class PushPullStage {
 public:
  struct Config {
    float drive = 0.2735f;
    /// Common-mode operating point. In the Variable-Mu Limiter this is driven
    /// by the unit's control voltage, because there the bias *is* the gain
    /// control.
    float bias = 0.0f;
    /**
     * Fractional transconductance mismatch between the two halves.
     *
     * A note that cost an afternoon, because the sheet's §4.2 is wrong about
     * this and the wrongness is instructive. Equation (5) there applies the
     * mismatch as an output gain difference and claims that at bias 0 the even
     * order returns "in proportion to β". It does not, and no push-pull model
     * can make it: at bias 0 the curve is odd, and a difference of two
     * evaluations at +gx and −gx of an odd function is odd for *any* scaling of
     * either half. Scaling one branch by (1+β) and the other by (1−β) and
     * subtracting gives exactly R(gx) back — the β cancels algebraically.
     *
     * So even-order cancellation at bias 0 is *stronger* than the sheet claims,
     * not weaker: it survives any imbalance. What actually returns even order
     * is a mismatch at a non-zero operating point, where the curve has
     * curvature for the mismatch to sample. The returned second harmonic is
     * proportional to β and to R''(bias), which is why it vanishes at bias 0
     * and grows as the pair is pushed toward cutoff — and that is exactly the
     * behaviour `imbalancePerBias` exists to produce.
     *
     * Applied to the drive rather than to the output because that is where a
     * transconductance mismatch lives; an output trim would be a level error
     * and would not distort at all.
     */
    float imbalance = 0.0f;
    /**
     * Additional imbalance per unit of |bias|.
     *
     * This is the mechanism behind the second harmonic reappearing at deep gain
     * reduction, and it is a mechanism rather than a fudge: pushing a balanced
     * pair toward cutoff does not push both halves equally. §4.2 (7). The
     * value is ours — no published measurement of the reference unit's
     * push-pull balance exists, which `LEGAL_NOTES.md` and §8.2 both record.
     */
    float imbalancePerBias = 0.35f;
    float restoreHz = 5.0f;
  };

  void prepare(double sampleRate, const Config& config) noexcept {
    sampleRate_ = sampleRate;
    config_ = config;
    restore_.prepare(sampleRate, config.restoreHz);
    normal_ = 1.0f / curveDerivatives(config.bias).first;
  }

  void setConfig(const Config& config) noexcept {
    const bool cornerMoved = config.restoreHz != config_.restoreHz;
    config_ = config;
    normal_ = 1.0f / curveDerivatives(config.bias).first;
    if (cornerMoved) restore_.prepare(sampleRate_, config.restoreHz);
  }

  void reset() noexcept { restore_.reset(); }

  float process(float x) noexcept {
    const float beta = effectiveImbalance();
    const float g = config_.drive;
    const float b = config_.bias;
    const float upper = curve(g * (1.0f + beta) * x + b);
    const float lower = curve(-g * (1.0f - beta) * x + b);
    const float shaped = 0.5f * (upper - lower) * normal_;
    return restore_.process(shaped) / g;
  }

  /**
   * Curvature as the *pair* presents it, not as one half does.
   *
   * The coefficient a balanced pair actually shows is one half's own, scaled
   * by the imbalance. Reporting one half's unscaled would tell a face the stage
   * is second-dominant when the whole point of the topology is that it is not;
   * reporting zero would hide the imbalance the unit is deliberately running.
   */
  Curvature curvature() const noexcept {
    Curvature out = nl::curvature(config_.bias);
    out.c2 *= effectiveImbalance();
    return out;
  }

  float effectiveImbalance() const noexcept {
    const float b = config_.bias < 0.0f ? -config_.bias : config_.bias;
    return config_.imbalance + config_.imbalancePerBias * b;
  }

 private:
  Config config_{};
  DcRestore restore_;
  double sampleRate_ = 48000.0;
  float normal_ = 1.0f;
};

}  // namespace mw::dsp::nl
