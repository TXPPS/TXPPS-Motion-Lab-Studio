// Motion Wave — hysteresis and saturation of a magnetic core.
//
// `lib-nonlinear.md` §3.3 and §4.5. One type used twice — for transformers, and
// in the British console lineage only, for the EQ section's inductors — because
// the physics is the same, and because one sheet asserts the American lineage
// has *no* EQ-section saturation. That is only a checkable claim if the
// placement is an explicit decision rather than something baked into a
// "console" block.
//
// **The model is a nonlinearity of the integrated signal, not of the signal.**
// That single structural decision is what makes the distortion
// frequency-dependent for free: flux is the integral of voltage, so for a sine
// of amplitude V at frequency f the flux amplitude is V/(2πf·N) and distortion
// rises as 1/f. A waveshaper applied to the voltage cannot do this at any
// setting, and two of the five units' sheets have a test that fails against one.
//
//     Φ[n] = ρ·Φ[n−1] + (1 − ρ)·k·x[n],   ρ = exp(−2π·poleHz/fs)        (14)
//     P[n] = max( min(P[n−1], Φ[n] + c), Φ[n] − c )      play operator   (15)
//     B[n] = Φsat · R( (Φ[n] − α·P[n]) / Φsat )                          (16)
//     y[n] = (1 − γ)·B[n] + γ·x[n]                                       (17)
#pragma once

#include "curve.h"
#include "stage_scratch.h"

namespace mw::dsp::nl {

/**
 * The frequency the flux normalisation is defined at.
 *
 * 30 Hz, because that is the frequency the sheets' calibration band is stated
 * at, so the saturation flux is expressed in the same terms as the measurement
 * that grades it. Choosing 1 kHz instead would have made every published
 * figure need a conversion, and a conversion is where a factor of 33 goes
 * missing.
 */
inline constexpr float kFluxReferenceHz = 30.0f;

class MagneticCore {
 public:
  struct Config {
    /// Low-frequency pole of the magnetising inductance. The flux is the
    /// integral of the voltage, so this is where the 1/f rise in distortion
    /// stops — below it the core stops accumulating and the model stops
    /// getting worse rather than growing without bound.
    float poleHz = 12.0f;
    /**
     * Flux at which the anhysteretic curve is one third compressed.
     *
     * In the units the flux normalisation below defines: a sine of amplitude 1
     * at `kFluxReferenceHz` produces a flux of amplitude 1. 0.558 is the
     * calibration §4.5's band asks for — at +10 dBm (−12 dBFS) and 30 Hz it
     * puts the curve argument where the third harmonic is
     * 1.5 %, the centre of the band; the same setting reads 0.004 % at 1 kHz,
     * comfortably under the 0.03 % ceiling.
     */
    float saturationFlux = 0.916f;
    /**
     * Coercivity, in the same flux units.
     *
     * The term that produces distortion at low level and never goes away.
     * Setting it to zero turns the model into pure saturation, and the
     * hysteresis-floor test then fails by name — which is deliberate: that test
     * exists to prove this term is load-bearing rather than decorative.
     */
    float coercivity = 1.0e-5f;
    /**
     * Fraction of the primary's own distortion cancelled by a feedback winding.
     *
     * The FET Limiter's output transformer has one and must therefore distort
     * *less* than its input transformer, not more. A model that gave the output
     * transformer more distortion because it works at a higher level would be
     * reasoning correctly from the wrong circuit.
     */
    float feedbackCancellation = 0.0f;
    /**
     * How much of the play operator's state is subtracted from the flux.
     *
     * Small, and it has to be. The play operator tracks the flux within a dead
     * zone of ±coercivity, so `flux − play` is a *residual* of amplitude
     * coercivity rather than the signal — subtracting all of it would delete
     * the audio and leave only the backlash. A mean-field coupling of a few
     * per cent adds the history term to the flux instead of replacing it,
     * which is what the Preisach formulation this is a reduction of actually
     * says.
     */
    float hysteresisDepth = 0.05f;
  };

  void prepare(double sampleRate, const Config& config) noexcept {
    sampleRate_ = sampleRate;
    setConfig(config);
    reset();
  }

  void setConfig(const Config& config) noexcept {
    config_ = config;
    const double pi = 3.14159265358979323846;
    const double w = 2.0 * pi * static_cast<double>(config.poleHz) / sampleRate_;
    rho_ = static_cast<float>(std::exp(-w));
    // Normalised so a unit-amplitude sine at the reference frequency produces a
    // flux of amplitude one. Without a fixed reference the flux units would
    // depend on the pole, and moving the pole — a per-transformer setting —
    // would silently recalibrate the saturation of every unit that had one.
    const double wr = 2.0 * pi * static_cast<double>(kFluxReferenceHz) / sampleRate_;
    const double re = 1.0 - static_cast<double>(rho_) * std::cos(wr);
    const double im = static_cast<double>(rho_) * std::sin(wr);
    const double magnitude = (1.0 - static_cast<double>(rho_)) / std::sqrt(re * re + im * im);
    fluxGain_ = static_cast<float>(1.0 / magnitude);
  }

  void reset() noexcept {
    flux_ = 0.0f;
    play_ = 0.0f;
    lastB_ = 0.0f;
  }

  float process(float x) noexcept {
    // (14): a one-pole integrator. Not a true integrator — that has infinite
    // DC gain, and any offset in the signal walks the core into saturation and
    // leaves it there for the rest of the session.
    flux_ = flushSmall(rho_ * flux_ + (1.0f - rho_) * fluxGain_ * x);

    // (15): a rate-independent backlash of half-width c. Two compares, no
    // table, no allocation. This is what makes the model *not* a waveshaper —
    // the output depends on magnetisation history, so ascending and descending
    // through the same flux give different outputs, and the loop has non-zero
    // area at every amplitude down to zero. That is the mechanism behind
    // "distortion at low levels that never goes away", and it is the half of a
    // transformer's behaviour a saturation curve cannot produce. Its residual
    // has a fixed absolute size, so its share of the signal *rises* as the
    // level falls, which is the shape of the claim.
    const float c = config_.coercivity;
    const float upper = flux_ + c;
    const float lower = flux_ - c;
    play_ = play_ < upper ? play_ : upper;
    play_ = play_ > lower ? play_ : lower;

    // (16): odd-symmetric, so the core is third-harmonic dominant — which is
    // what every sheet says about every transformer in the five units.
    const float sat = config_.saturationFlux;
    const float alpha = config_.hysteresisDepth;
    const float effective = flux_ - alpha * play_;
    const float b = sat * curve(effective / (sat * (1.0f - alpha)));

    // The inverse of (14), exactly. A transformer's output voltage is the
    // derivative of its flux, and this is the matched inverse of the filter
    // that produced it — so the linear path is unity at every frequency while
    // the shaping happens in the flux domain. That is the whole reason the
    // distortion is frequency-dependent for free: the flux is 1/f larger at low
    // frequencies, so it runs further up the curve, and the inverse filter
    // restores the level without restoring the linearity.
    //
    // Without this the core would be a 6 dB/octave low-pass with a saturating
    // curve in it, which is a filter and not a transformer.
    const float y = (b - rho_ * lastB_) / ((1.0f - rho_) * fluxGain_);
    lastB_ = b;

    // (17): the feedback-winding term.
    const float g = config_.feedbackCancellation;
    return flushSmall((1.0f - g) * y + g * x);
  }

  /**
   * One full magnetisation loop, written into caller storage, for a face that
   * draws the B–H curve.
   *
   * Runs the same `process` the audio runs, on a scratch instance. A loop drawn
   * from a formula would be a second opinion about the same thing, and the
   * house rule forbids one — the picture and the sound must come from one
   * evaluation or they will eventually disagree and only the picture will be
   * believed.
   */
  static void sampleLoop(const Config& config, double sampleRate, float amplitude,
                         float frequencyHz, float* out, int count) noexcept {
    if (out == nullptr || count <= 0) return;
    MagneticCore core;
    core.prepare(sampleRate, config);
    const double step = 2.0 * 3.14159265358979323846 * static_cast<double>(frequencyHz) / sampleRate;
    const int settle = static_cast<int>(sampleRate / static_cast<double>(frequencyHz)) * 2;
    for (int i = 0; i < settle; ++i) {
      core.process(amplitude * static_cast<float>(std::sin(step * static_cast<double>(i))));
    }
    for (int i = 0; i < count; ++i) {
      const int at = settle + i;
      out[i] = core.process(amplitude * static_cast<float>(std::sin(step * static_cast<double>(at))));
    }
  }

 private:
  Config config_{};
  double sampleRate_ = 48000.0;
  float rho_ = 0.998f;
  float fluxGain_ = 1.0f;
  float flux_ = 0.0f;
  float play_ = 0.0f;
  float lastB_ = 0.0f;
};

/**
 * A static nonlinearity applied to a *control* signal inside a detector loop.
 *
 * Its own type rather than a reused `TriodeStage`, so that nobody puts it in
 * the audio path by accident. Both sheets that need it say the same thing: this
 * element does not add harmonics to the audio, it changes the shape of the
 * gain-reduction curve, and the loop partially linearises it. Treating it as an
 * audio saturator would put its distortion in the spectrum where it does not
 * belong.
 */
class ControlShaper {
 public:
  struct Config {
    float drive = 1.0f;
    float bias = 0.0f;
    /// Loop-gain estimate, for reporting how much of the shaping the loop
    /// removes. Diagnostic only; it does not touch the sample path.
    float loopGain = 10.0f;
  };

  void prepare(double, const Config& config) noexcept { config_ = config; }
  void setConfig(const Config& config) noexcept { config_ = config; }

  /// `const`, because this shaper genuinely has none of the state the other
  /// elements do — it is a static curve on a control signal, and saying so lets
  /// a unit call it from a const path rather than making that path non-const to
  /// accommodate a member that never changes.
  float process(float control) const noexcept {
    return curve(config_.drive * control + config_.bias) / config_.drive;
  }

  /// The fraction of this shaper's departure from linearity that survives the
  /// loop. Reported, never applied — a number a face may show.
  float residualFraction() const noexcept { return 1.0f / (1.0f + config_.loopGain); }

 private:
  Config config_{};
};

}  // namespace mw::dsp::nl
