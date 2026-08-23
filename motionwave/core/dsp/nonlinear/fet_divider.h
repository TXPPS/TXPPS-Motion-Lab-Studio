// Motion Wave — a voltage-variable resistor in the shunt leg of a divider.
//
// `lib-nonlinear.md` §3.2 and §4.4. The two hardware trims map onto two
// parameters with physical meaning rather than being modelled as a mystery:
// `bias` is where the element sits at the edge of conduction, and
// `feedbackFraction` is the fraction of the drain swing returned to the gate.
//
//     r(V) = r_on / (1 − V/Vp),   V = V_bias − control + λ·y          (12)
//     y    = x · Rs / (Rs + r(V))                                      (13)
//
// These are implicit in y. One step from the previous sample's solution
// converges below a Float32 step for the swings these units see and costs one
// divide; solving the quadratic costs a square root and buys nothing
// measurable.
//
// The leading even-order term of (13) carries a factor that vanishes at one
// value of λ, which is the physical meaning of the hardware's distortion trim —
// and it explains, without hand-waving, why that null holds at one operating
// point only: the cancellation is exact for the quadratic term of the ideal
// triode-region law, and neither the cubic term nor the drift of r_on with the
// control voltage is touched by it.
#pragma once

#include "triode_stage.h"

namespace mw::dsp::nl {

class FetDivider {
 public:
  struct Config {
    float seriesResistance = 1.0f;
    float onResistance = 0.02f;
    float pinchOffVolts = 1.0f;
    /**
     * The bias trim, in the same volts as `pinchOffVolts`.
     *
     * 0.8365 puts the element 1.00 dB into attenuation with no control signal,
     * which is the documented hardware calibration procedure. Derived rather
     * than tuned: 1 dB is a gain of 0.8913, so with Rs = 1 the shunt leg is
     * r = 0.1220, and r_on/(1 − V/Vp) = 0.1220 gives V/Vp = 0.8361.
     */
    float bias = 0.8361f;
    /// The distortion trim. Defaults to a correctly calibrated unit.
    float feedbackFraction = 0.5f;
  };

  void prepare(double, const Config& config) noexcept {
    config_ = config;
    lastY_ = 0.0f;
  }
  void setConfig(const Config& config) noexcept { config_ = config; }
  void reset() noexcept { lastY_ = 0.0f; }

  /// `control` reduces the gate voltage and so increases the attenuation.
  float process(float x, float control) noexcept {
    const float base = config_.bias - control;
    // Seeded from the previous sample rather than from zero. At audio rates the
    // solution moves by a fraction of a Float32 step between samples, so one
    // step from there is converged; one step from zero would not be, and the
    // error would be signal-dependent — which is to say, it would be
    // distortion the model did not intend.
    const float v = base + config_.feedbackFraction * lastY_;
    const float r = resistance(v);
    const float y = x * config_.seriesResistance / (config_.seriesResistance + r);
    // A second pass with the solution just found. This is the Newton step: the
    // first evaluation places the operating point, the second lands on it.
    const float v2 = base + config_.feedbackFraction * y;
    const float r2 = resistance(v2);
    lastY_ = flushSmall(x * config_.seriesResistance / (config_.seriesResistance + r2));
    return lastY_;
  }

  /**
   * Small-signal gain in decibels at a control voltage.
   *
   * Evaluated at y = 0, which is where a gain-reduction meter's question is
   * asked: "how much is this attenuating", not "what did this sample do". The
   * audio-dependent term is the distortion and belongs in the audio, not on the
   * meter.
   */
  float gainDb(float control) const noexcept {
    const float r = resistance(config_.bias - control);
    return 20.0f *
           std::log10(config_.seriesResistance / (config_.seriesResistance + r));
  }

 private:
  float resistance(float v) const noexcept {
    // Clamped short of pinch-off: at V = Vp the channel resistance is infinite
    // and the divider passes the signal untouched, and a control that can reach
    // it makes the last of its travel do nothing.
    const float u = v / config_.pinchOffVolts;
    const float clamped = u > 0.999f ? 0.999f : (u < -3.0f ? -3.0f : u);
    return config_.onResistance / (1.0f - clamped);
  }

  Config config_{};
  float lastY_ = 0.0f;
};

/**
 * A discrete gain block with global feedback.
 *
 * Low distortion at nominal level, rising steeply near the rails, symmetric,
 * third-harmonic led — the FET Limiter's preamp and the American console
 * lineage's op-amp modules. Symmetric by construction, with no bias term: a
 * feedback block's whole character is that the loop removes the asymmetry its
 * devices have, and a bias parameter here would be an invitation to model the
 * open-loop stage by mistake.
 */
class FeedbackBlockStage {
 public:
  struct Config {
    float drive = 0.15f;
    float railVolts = 1.0f;
    float restoreHz = 5.0f;
  };

  void prepare(double sampleRate, const Config& config) noexcept {
    config_ = config;
    sampleRate_ = sampleRate;
    restore_.prepare(sampleRate, config.restoreHz);
  }
  void setConfig(const Config& config) noexcept {
    const bool cornerMoved = config.restoreHz != config_.restoreHz;
    config_ = config;
    if (cornerMoved) restore_.prepare(sampleRate_, config.restoreHz);
  }
  void reset() noexcept { restore_.reset(); }

  float process(float x) noexcept {
    const float rail = config_.railVolts;
    const float shaped = rail * curve(config_.drive * x / rail);
    return restore_.process(shaped) / config_.drive;
  }

 private:
  Config config_{};
  DcRestore restore_;
  double sampleRate_ = 48000.0;
};

}  // namespace mw::dsp::nl
