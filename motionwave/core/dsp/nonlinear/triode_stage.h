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
 *
 * **The state is a double, and that is load-bearing.** In float32 this filter
 * stops converging while its output is still visibly wrong, and the mechanism
 * is worth stating because it looks like nothing: the update is
 * `s += (1−c)(x − s)`, and once `(1−c)|x − s|` falls below half an ULP of `s`
 * the addition rounds back to `s` and the filter stalls there for ever. With a
 * 2 Hz corner at 192 kHz — a stage inside a 4× wrapper — `1−c` is 6.5e−5, so
 * it stalls with up to 2.8e−5 of the offset left. Divided back out by a drive
 * of 0.12 that is 2.3e−4 of standing DC on the output, which the Program EQ's
 * noise-floor test measured as a noise floor 30 dB louder than the manual's.
 *
 * The tell was that the offset did not decay: it settled to a constant and sat
 * there through ten seconds of silence, and it was four times smaller with
 * oversampling off — which is exactly the ratio of `1−c` at the two rates.
 */
class DcRestore {
 public:
  void prepare(double sampleRate, float cornerHz) noexcept {
    const double w = 2.0 * 3.14159265358979323846 * static_cast<double>(cornerHz) / sampleRate;
    coeff_ = std::exp(-w);
    state_ = 0.0;
  }
  void reset() noexcept { state_ = 0.0; }
  float process(float x) noexcept {
    const double in = static_cast<double>(x);
    state_ = coeff_ * state_ + (1.0 - coeff_) * in;
    if (state_ < 1.0e-300 && state_ > -1.0e-300) state_ = 0.0;
    return static_cast<float>(in - state_);
  }

 private:
  double coeff_ = 0.999;
  double state_ = 0.0;
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
 * How far apart the two halves' operating points sit, per unit of mismatch.
 *
 * Ours, and it is the number that sets how much even order a given imbalance
 * returns. No published measurement of the reference unit's push-pull balance
 * exists; `LEGAL_NOTES.md` records the class of number this is.
 */
inline constexpr float kImbalanceOperatingPointScale = 0.5f;

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
     * How mismatched the two halves are, as a fraction.
     *
     * It moves two things at once, and it has to move the second of them or it
     * does nothing at all at the operating point where a balanced stage sits.
     *
     * The sheet's equation (5) applies the mismatch as an output gain
     * difference. Split any half-stage into odd and even parts and the
     * composite is `(A+B)·f_odd + (A−B)·f_even`, so a gain mismatch returns
     * even order in proportion to `A−B` — but only in proportion to `f_even`
     * as well, and at zero bias `f_even` is *identically* zero, because
     * `R(g·x)` is an odd function. Scaling an odd function, on either side of
     * the subtraction, leaves it odd. Measured: a 10 % gain mismatch at zero
     * bias produces exactly 0.0000000000 of even part, and so does a 10 %
     * drive mismatch, which is what this used to apply.
     *
     * What actually breaks the symmetry is the halves sitting at *different
     * operating points*, which is what two mismatched devices physically are —
     * valves that differ in transconductance differ in cutoff too. Offsetting
     * them by ±δ makes each half's transfer non-odd, so `f_even` is non-zero at
     * any common-mode bias including zero, and the returned second harmonic is
     * `0.444·δ·A` — linear in the mismatch, and present where the stage
     * actually runs.
     *
     * That is not a detail. Even-order asymmetry is most of what makes a valve
     * stage sound like one, and both the Optical Leveller and the Variable-Mu
     * depend on it; a model whose imbalance control was inert at the balance
     * point would have shipped a stage that could not be unbalanced.
     */
    float imbalance = 0.0f;
    /**
     * Additional imbalance per unit of |bias|.
     *
     * This is the mechanism behind the second harmonic reappearing at deep gain
     * reduction, and it is a mechanism rather than a fudge: pushing a balanced
     * pair toward cutoff does not push both halves equally, so their operating
     * points separate and the pair stops cancelling. §4.2 (7).
     *
     * It is also what supplies the steep part of the Variable-Mu's
     * "distortion rises faster than gain falls" — the transconductance law's
     * own even order can only rise by the ratio of (1 − v/Vc) across the two
     * measurement points, which is 6.8 dB and short of the 10 dB required.
     *
     * The value is ours — no published measurement of the reference unit's
     * push-pull balance exists, which `LEGAL_NOTES.md` and §8.2 both record.
     */
    float imbalancePerBias = 0.5f;
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
    // Both mechanisms, because a mismatched pair has both. The gain difference
    // is the sheet's equation (5); the operating-point difference is what makes
    // the even order appear at all when the pair is sitting at balance.
    const float delta = beta * kImbalanceOperatingPointScale;
    const float upper = (1.0f + beta) * curve(g * x + b + delta);
    const float lower = (1.0f - beta) * curve(-g * x + b - delta);
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
    const CurveDerivatives d = curveDerivatives(config_.bias);
    const float beta = effectiveImbalance();
    const float delta = beta * kImbalanceOperatingPointScale;
    Curvature out;
    if (d.first > 1.0e-6f) {
      // Expanding the pair about its common-mode point, the x² coefficient is
      // ½g²[R'''(b)·δ + β·R''(b)] against a slope of g·R'(b), which normalises
      // to this. It reduces to the single-ended `R''/2R'` when the halves match
      // and to `R'''·δ/2R'` at zero bias — the term that survives where the
      // gain difference cannot.
      out.c2 = (d.third * delta + beta * d.second) / (2.0f * d.first);
      out.c3 = d.third / (6.0f * d.first);
    }
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
