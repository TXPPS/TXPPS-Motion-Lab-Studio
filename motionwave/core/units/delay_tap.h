// Motion Wave — one tap of the Granular Delay: its settings, and its state.
//
// `fx-03` §2 fixes the per-tap order — read, filter, level, pan — and says why
// it is not the user's to change: pitch is a property of *how the grain is
// read*, so it has to come first, and a filter after the level is a filter whose
// resonance rides the fader. The read itself is the transport's business
// (`delay_transport.h`); what is here is everything after the read, and the
// resolution of a tap's time from the controls that can set it.
#pragma once

#include "../dsp/biquad.h"
#include "delay_sync.h"

#include <cmath>
#include <cstdint>

namespace mw::units::delay {

inline constexpr int kMaxTaps = 8;

/// §7.2's per-tap filter, a 12 dB/oct state-variable response. Off is a wire.
enum class TapFilter : std::uint8_t { Off = 0, Lowpass, Highpass, Bandpass };

/// §5: absolute, each tap its own time; or relative, taps as multiples of the first.
enum class TimeMode : std::uint8_t { Absolute = 0, Relative };

/**
 * §5's head-spacing presets, as the ratio each tap takes in Relative mode.
 *
 * Multi-head tape echoes had three or four heads at fixed spacings, and these
 * are the spacings the sheet lists. Beyond the preset's length a tap continues
 * the series, so an eight-tap delay on a three-head preset does not run out of
 * positions.
 */
enum class Spacing : std::uint8_t { Even = 0, OneTwoThree, OneTwoFour, OneThreeFour };

inline double spacingRatioFor(Spacing spacing, int tapIndex) noexcept {
  static constexpr double kOneTwoThree[3] = {1.0, 2.0, 3.0};
  static constexpr double kOneTwoFour[3] = {1.0, 2.0, 4.0};
  static constexpr double kOneThreeFour[3] = {1.0, 3.0, 4.0};
  const int k = tapIndex < 0 ? 0 : tapIndex;
  switch (spacing) {
    case Spacing::OneTwoThree: return k < 3 ? kOneTwoThree[k] : static_cast<double>(k + 1);
    case Spacing::OneTwoFour: return k < 3 ? kOneTwoFour[k] : static_cast<double>(k + 2);
    case Spacing::OneThreeFour: return k < 3 ? kOneThreeFour[k] : static_cast<double>(k + 2);
    case Spacing::Even:
    default: return static_cast<double>(k + 1);
  }
}

/// §7.2's discrete ratio positions, `×0.25 … ×8`.
inline constexpr int kRatioSteps = 10;
inline double ratioForStep(int step) noexcept {
  static constexpr double kRatios[kRatioSteps] = {0.25, 0.5, 0.75, 1.0, 1.5,
                                                  2.0,  3.0, 4.0,  6.0, 8.0};
  const int s = step < 0 ? 0 : (step >= kRatioSteps ? kRatioSteps - 1 : step);
  return kRatios[s];
}

/// One tap's settings, exactly as the controls set them. Resolution is below.
struct TapSettings {
  double delaySeconds = 0.250;  ///< Free time, used when sync is off.
  Division division = Division::Eighth;
  Modifier modifier = Modifier::Straight;
  /// Relative-mode ratio, as a step into `ratioForStep`. −1 follows the spacing.
  int ratioStep = -1;
  double level = 1.0;  ///< Linear. Zero is −∞ dB.
  double pan = 0.0;    ///< −1 hard left, +1 hard right.
  double pitchSemitones = 0.0;
  double fineCents = 0.0;
  TapFilter filter = TapFilter::Off;
  double cutoffHz = 20000.0;
  double q = 0.707;
  bool reverse = false;
  bool enabled = true;
  bool muted = false;
  bool solo = false;
};

/// What the unit needs to know about every tap at once to resolve one.
struct TapContext {
  bool sync = true;
  TimeMode timeMode = TimeMode::Absolute;
  Spacing spacing = Spacing::Even;
  double bpm = 120.0;
  /// Tap 0's resolved time, which Relative mode multiplies.
  double firstTapSeconds = 0.250;
  bool anySolo = false;
};

/// A tap's own nominal time, before the buffer's clamp.
inline double resolveTapSeconds(const TapSettings& tap, int index, const TapContext& ctx) noexcept {
  if (ctx.timeMode == TimeMode::Relative && index > 0) {
    const double ratio =
        tap.ratioStep >= 0 ? ratioForStep(tap.ratioStep) : spacingRatioFor(ctx.spacing, index);
    return ctx.firstTapSeconds * ratio;
  }
  return ctx.sync ? delaySecondsFor(tap.division, tap.modifier, ctx.bpm) : tap.delaySeconds;
}

/// Whether a tap sounds at all, given the solo state of the desk.
inline bool tapAudible(const TapSettings& tap, const TapContext& ctx) noexcept {
  if (!tap.enabled || tap.muted) return false;
  return !ctx.anySolo || tap.solo;
}

/**
 * The per-tap state: the filter, and a gain that does not step.
 *
 * §7.2 gives Mute and Solo a 4 ms crossfade, and the same smoother carries the
 * level control, because a level that stepped between blocks is D10's zipper
 * on the one control every tap has.
 */
class TapState {
 public:
  void prepare(double sampleRate) noexcept {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    gainCoeff_ = 1.0 - std::exp(-1.0 / (0.004 * sampleRate_));
    reset();
  }

  void reset() noexcept {
    filter_.reset();
    gain_ = target_;
  }

  /// Apply a tap's settings. The filter is rebuilt; the gain starts moving.
  void configure(const TapSettings& tap, bool audible) noexcept {
    filterOn_ = tap.filter != TapFilter::Off;
    const double hz = tap.cutoffHz < 20.0 ? 20.0
                      : (tap.cutoffHz > 0.45 * sampleRate_ ? 0.45 * sampleRate_ : tap.cutoffHz);
    const double q = tap.q < 0.5 ? 0.5 : (tap.q > 8.0 ? 8.0 : tap.q);
    switch (tap.filter) {
      case TapFilter::Lowpass: filter_.setCoeffs(dsp::lowpassCoeffs(hz, q, sampleRate_)); break;
      case TapFilter::Highpass: filter_.setCoeffs(dsp::highpassCoeffs(hz, q, sampleRate_)); break;
      case TapFilter::Bandpass: filter_.setCoeffs(dsp::bandpassCoeffs(hz, q, sampleRate_)); break;
      case TapFilter::Off:
      default: break;
    }
    target_ = audible ? (tap.level < 0.0 ? 0.0 : tap.level) : 0.0;
    // §2: equal power, so a pan sweep holds its level.
    const double angle = (tap.pan * 0.5 + 0.5) * 3.14159265358979323846 * 0.5;
    gainL_ = std::cos(angle);
    gainR_ = std::sin(angle);
  }

  /// §2's order after the read: filter, level, pan. Both channels at once.
  void shape(double rawL, double rawR, double* wetL, double* wetR) noexcept {
    gain_ += (target_ - gain_) * gainCoeff_;
    // The tap's own filter runs on the mono sum, because §2 gives each tap one
    // filter rather than two — a stereo pair through one filter's state would
    // be a filter hearing the sum and applying it to each side.
    const double mid = 0.5 * (rawL + rawR);
    const double filtered = filterOn_ ? filter_.process(mid) : mid;
    const double level = filtered * gain_;
    // Pan places the tap; the buffer's own stereo position survives it,
    // because a centred tap must not collapse a ping-pong repeat to mono.
    const double side = 0.5 * (rawL - rawR) * gain_;
    *wetL += level * gainL_ + side;
    *wetR += level * gainR_ - side;
  }

  double gain() const noexcept { return gain_; }
  double panLeft() const noexcept { return gainL_; }
  double panRight() const noexcept { return gainR_; }

 private:
  dsp::Biquad filter_;
  double sampleRate_ = 48000.0;
  double gainCoeff_ = 0.01;
  double gain_ = 1.0;
  double target_ = 1.0;
  double gainL_ = 0.70710678;
  double gainR_ = 0.70710678;
  bool filterOn_ = false;
};

}  // namespace mw::units::delay
