// Motion Wave — the state-variable filter every voice shares.
//
// `smp-01` §2.1 puts one of these after each playback engine, with §7.4's
// controls: five modes, a logarithmic cutoff, resonance and key follow. The
// synth sheets want more from the same two integrators — a four-pole cascade,
// fifteen tap-mixed modes, a saturating feedback path — and all of it starts
// here, because a private filter per unit is how two synths end up disagreeing
// about what resonance means.
//
// Two decisions worth stating, because both cost something and both are the
// reason this is not the textbook direct-form biquad in `biquad.h`:
//
// **Trapezoidal (zero-delay-feedback) integration, retuned per sample.** The
// sheet hands every voice per-sample pitch and cutoff arrays (§4.1), so the
// cutoff moves on every sample and the filter is retuned on every sample. A
// direct-form biquad cannot be driven that way: its state is a pair of
// delayed, coefficient-scaled outputs, so a change of coefficients changes what
// the stored numbers mean, and under audio-rate modulation the recursion goes
// unstable even though every frozen coefficient set is stable. `svf_tests.cpp`
// retunes the core's own `Biquad` per sample through a 5 kHz sweep and it
// diverges to infinity; this filter, on the same sweep, stays within 4 % of its
// held-cutoff peak. The trapezoidal form's state is the two integrator outputs
// — the capacitor voltages of the analogue prototype — which mean the same
// thing whatever the cutoff is, so any per-sample cutoff trajectory is safe.
// The price is one `tan` per cutoff change, paid only when the cutoff moves.
//
// **State in double, flushed.** As in `biquad.h`: at 20 Hz on a 192 kHz stream
// the integrator gain is 3.3e-4 and single-precision state loses the corner.
// The integrators go through `flushDenormal` on every sample because the tests
// are built without `-ffast-math`, and a decaying resonance is exactly where
// denormals arrive and cost hundreds of cycles a sample.
#pragma once

#include "biquad.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace mw::dsp {

class Svf {
 public:
  /// `smp-01` §7.4's choice, in the sheet's order so a `ParamSpec` choice maps
  /// by ordinal. Off is a wire — bit-exact — and the integrators do not run.
  enum class Mode : std::uint8_t { Lowpass = 0, Highpass, Bandpass, Notch, Off };

  /**
   * Every response from one evaluation of one state. `notch == low + high` and
   * `input == high + k·band + low`, which `svf_tests.cpp` asserts.
   *
   * `band` is the integrator's own output and is therefore **constant-skirt**:
   * its peak is Q, so it reads +27.96 dB at full resonance. That is what the
   * two identities above need, and it is the wrong thing to send to a voice —
   * see `bandpass`, below.
   */
  struct Outputs {
    float low;
    float band;
    float high;
    float notch;

    /**
     * The constant-*peak* bandpass, which is what `Mode::Bandpass` returns.
     *
     * Unity at the centre whatever the resonance. The distinction is the one
     * `biquad.h`'s `bandpassCoeffs` makes for the delay's per-tap filter and it
     * matters more here, not less: `smp-01` §6.3 makes `RESONANCE` a matrix
     * destination, so on a bandpass patch a user modulating resonance for tone
     * would be modulating level by up to 28 dB, and on a voice that feeds a
     * summed bus that is a level jump nobody asked for. Scaling by `k = 1/Q` is
     * exactly that normalisation and costs one multiply.
     */
    float bandpass;
  };

  /**
   * The resonance law: `Q = kMinQ · (kMaxQ / kMinQ)^resonance`.
   *
   * Zero is Butterworth rather than the conventional 0.5 because the sheet's
   * default is "low-pass at 20 kHz, resonance 0", and a filter a user never
   * touches must not colour the sound: Q = 0.5 is −1.3 dB at 8 kHz with the
   * cutoff fully open, and 1/√2 is the maximally flat response, −0.1 dB there.
   * The top is finite, deliberately. A linear filter self-oscillates only at
   * infinite Q, where its output is unbounded; a bounded oscillation needs a
   * saturating feedback path, which is a unit's character and not this
   * building block's. Q = 25 is +28.0 dB of peak, and the law is exponential
   * so the control is roughly linear in decibels of peak across its travel.
   */
  static constexpr double kMinQ = kButterworthQ;
  static constexpr double kMaxQ = 25.0;

  /// `smp-01` §7.4's floor, and the ceiling the prompt's clamp names. Above
  /// 0.45·fs the prewarped gain `tan(πf/fs)` climbs towards infinity at
  /// Nyquist, and a filter handed an infinite coefficient outputs NaN for the
  /// rest of the session.
  static constexpr double kMinCutoffHz = 20.0;
  static constexpr double kMaxCutoffFraction = 0.45;

  static double qForResonance(double resonance) noexcept {
    return kMinQ * std::pow(kMaxQ / kMinQ, clamp01(resonance));
  }

  /// The exact inverse, so a test can ask for "Q = 4" in the control's units.
  static double resonanceForQ(double q) noexcept {
    const double c = std::fmin(std::fmax(q, kMinQ), kMaxQ);
    return std::log(c / kMinQ) / std::log(kMaxQ / kMinQ);
  }

  /**
   * §7.4's key follow: 100 % is one octave of cutoff per octave of keyboard,
   * about `rootNote` (middle C by default). Not clamped — negative follow is
   * inverse tracking, a legitimate setting on several of the synths — and the
   * result is not clamped either, because `process` clamps every cutoff it is
   * handed and clamping twice would hide which seam a bad value came through.
   */
  static double cutoffFor(double baseHz, double keyFollow01, double noteNumber,
                          double rootNote = 60.0) noexcept {
    return baseHz * std::exp2(keyFollow01 * (noteNumber - rootNote) / 12.0);
  }

  /// A default-constructed filter is a valid 48 kHz filter rather than one
  /// with unset coefficients, so a `process` before `prepare` is wrong-rate and
  /// not undefined.
  Svf() noexcept { prepare(48000.0); }

  void prepare(double sampleRate) noexcept {
    sampleRate_ = sampleRate > 1.0 ? sampleRate : 1.0;
    maxCutoffHz_ = kMaxCutoffFraction * sampleRate_;
    // The cache is keyed on the control values, so a rate change must retune
    // even if the next call carries the same cutoff as the last one did.
    cachedResonance_ = 0.0f;
    k_ = dampingFor(0.0);
    cachedCutoff_ = static_cast<float>(maxCutoffHz_);
    retune(gainFor(maxCutoffHz_));
    reset();
  }

  /// Clear the integrators. On a transport seek or a voice steal, where
  /// carrying a resonant ring across a discontinuity would play a note that
  /// never happened.
  void reset() noexcept {
    ic1_ = 0.0;
    ic2_ = 0.0;
  }

  /// A switch, never modulated (§7.4). Changing between the four responses is
  /// continuous — they share one state — and entering Off clears it: a wire
  /// has no memory, and leaving Off must start from rest rather than replay a
  /// ring frozen when the filter was switched out.
  void setMode(Mode mode) noexcept {
    if (mode == mode_) return;
    if (mode == Mode::Off) reset();
    mode_ = mode;
  }
  Mode mode() const noexcept { return mode_; }

  /// One sample, all four responses. Advances the state whatever the mode.
  Outputs processAll(float x, float cutoffHz, float resonance) noexcept {
    tune(cutoffHz, resonance);
    const double v0 = static_cast<double>(x);
    const double v3 = v0 - ic2_;
    const double v1 = a1_ * ic1_ + a2_ * v3;
    const double v2 = ic2_ + a2_ * ic1_ + a3_ * v3;
    ic1_ = flushDenormal(2.0 * v1 - ic1_);
    ic2_ = flushDenormal(2.0 * v2 - ic2_);
    Outputs o;
    o.low = static_cast<float>(v2);
    o.band = static_cast<float>(v1);
    o.high = static_cast<float>(v0 - k_ * v1 - v2);
    o.notch = static_cast<float>(v0 - k_ * v1);
    o.bandpass = static_cast<float>(k_ * v1);
    return o;
  }

  /// One sample of the selected mode. Selecting from `processAll` rather than
  /// computing the mode's response separately is what makes the four modes
  /// and the four simultaneous outputs the same numbers.
  float process(float x, float cutoffHz, float resonance) noexcept {
    if (mode_ == Mode::Off) return x;
    const Outputs o = processAll(x, cutoffHz, resonance);
    switch (mode_) {
      case Mode::Highpass: return o.high;
      case Mode::Bandpass: return o.bandpass;
      case Mode::Notch: return o.notch;
      case Mode::Lowpass:
      case Mode::Off:
      default: return o.low;
    }
  }

  /// A block: cutoff per sample, resonance per block. In place is allowed.
  void process(float* out, const float* in, int frames, const float* cutoffHz,
               float resonance) noexcept {
    if (frames <= 0) return;
    const std::size_t n = static_cast<std::size_t>(frames);
    if (mode_ == Mode::Off) {
      if (out != in) std::memmove(out, in, n * sizeof(float));
      return;
    }
    for (std::size_t i = 0; i < n; ++i) out[i] = process(in[i], cutoffHz[i], resonance);
  }

  /**
   * Magnitude at `frequencyHz` for the given controls, for a drawn curve.
   *
   * From the same `g` and `k` the audio runs, so the curve cannot disagree
   * with the sound. A trapezoidal SVF is exactly the bilinear transform of its
   * analogue prototype, so its response at a digital frequency is the
   * prototype's at the prewarped ratio `tan(πf/fs) / g` — the cutoff lands
   * where it was asked for and everything else warps towards Nyquist, which
   * is what every biquad in this core does too. `svf_tests.cpp` checks this
   * against the sample loop rather than the other way round.
   */
  double magnitudeAt(double frequencyHz, double cutoffHz, double resonance,
                     Mode mode) const noexcept {
    if (mode == Mode::Off) return 1.0;
    const double k = dampingFor(resonance);
    const double x = std::tan(kPi * frequencyHz / sampleRate_) / gainFor(cutoffHz);
    const double x2 = x * x;
    const double den = std::sqrt((1.0 - x2) * (1.0 - x2) + k * k * x2);
    switch (mode) {
      case Mode::Highpass: return x2 / den;
      // `k·x/den`, the constant-peak normalisation `Outputs::bandpass` applies.
      case Mode::Bandpass: return k * x / den;
      case Mode::Notch: return std::fabs(1.0 - x2) / den;
      case Mode::Lowpass:
      case Mode::Off:
      default: return 1.0 / den;
    }
  }

 private:
  static constexpr double kPi = 3.14159265358979323846;

  /// `fmin`/`fmax` rather than comparisons: both return the other operand
  /// when one is NaN, so a modulator that has gone NaN pins the control at
  /// its floor instead of poisoning the state for the rest of the session.
  static double clamp01(double v) noexcept { return std::fmin(std::fmax(v, 0.0), 1.0); }
  static double dampingFor(double resonance) noexcept { return 1.0 / qForResonance(resonance); }

  /// The prewarped integrator gain, `tan(π·fc/fs)`, with the cutoff clamped.
  double gainFor(double cutoffHz) const noexcept {
    const double f = std::fmin(std::fmax(cutoffHz, kMinCutoffHz), maxCutoffHz_);
    return std::tan(kPi * f / sampleRate_);
  }

  void retune(double g) noexcept {
    a1_ = 1.0 / (1.0 + g * (g + k_));
    a2_ = g * a1_;
    a3_ = g * a2_;
  }

  /// Coefficients are a function of the two controls and are cached on them,
  /// so a held cutoff costs a comparison a sample and a moving one costs the
  /// `tan` it needs; the `pow` behind the damping is paid only when the
  /// resonance moves, which is once a block.
  void tune(float cutoffHz, float resonance) noexcept {
    if (cutoffHz == cachedCutoff_ && resonance == cachedResonance_) return;
    if (resonance != cachedResonance_) {
      k_ = dampingFor(static_cast<double>(resonance));
      cachedResonance_ = resonance;
    }
    cachedCutoff_ = cutoffHz;
    retune(gainFor(static_cast<double>(cutoffHz)));
  }

  double sampleRate_ = 48000.0;
  double maxCutoffHz_ = 0.45 * 48000.0;
  double ic1_ = 0.0;
  double ic2_ = 0.0;
  double k_ = 1.0;
  double a1_ = 0.0;
  double a2_ = 0.0;
  double a3_ = 0.0;
  float cachedCutoff_ = 0.0f;
  float cachedResonance_ = 0.0f;
  Mode mode_ = Mode::Lowpass;
};

}  // namespace mw::dsp
