// Motion Wave — band-limiting a modulator's own discontinuities.
//
// `fx-01` §4.5 is careful that this and the smoother do different jobs and are
// not interchangeable, so it is worth stating which is which before the code:
//
//   The smoother limits the *rate* of gain change. That is what stops a click,
//   and it is why Smooth = 0 does not tick.
//
//   This limits the *bandwidth* of the modulator itself. That is what stops
//   aliasing when the modulator runs fast enough for its own harmonics to fold
//   — a drawn square at 90 Hz has harmonics well past Nyquist, and every one of
//   them folds back as an inharmonic tone that no amount of smoothing removes,
//   because smoothing acts on the gain and the aliases are already in it.
//
// V5 is the gate: free mode, 90 Hz, a `step` curve, on a 1 kHz sine; spurious
// content not at 1000 ± k·90 Hz must sit at or below −80 dBFS.
//
// polyBLEP is the standard technique and the reason it is chosen over a longer
// windowed-sinc BLEP is cost: two samples of correction against a table lookup
// and a convolution, for a modulator that runs per sample per band per slot. At
// this residual length the correction is exact for a step and approximate for
// the corner either side of it, which is the trade the literature describes and
// which V5's −80 dBFS target already accounts for.
#pragma once

namespace mw::dsp {

/**
 * The polyBLEP residual at a normalised distance from a discontinuity.
 *
 * `t` is where the sample sits relative to the step, in units of the sample
 * period: negative just before, positive just after, and only |t| < 1 matters.
 * `dt` is the modulator's phase increment per sample, which is what sets how
 * wide the correction has to be — a slow modulator's step is already nearly
 * band-limited and needs almost nothing.
 *
 * Returns the amount to *add* to the raw signal. The caller scales it by the
 * height of the step, because the residual describes the shape of the
 * correction and not its size.
 */
inline double polyBlep(double t, double dt) noexcept {
  if (dt <= 0.0) return 0.0;
  if (t < dt) {
    // Just after the step: the leading half of the correction.
    const double x = t / dt;
    return x + x - x * x - 1.0;
  }
  if (t > 1.0 - dt) {
    // Just before the next one: the trailing half.
    const double x = (t - 1.0) / dt;
    return x * x + x + x + 1.0;
  }
  return 0.0;
}

/**
 * Below this modulator rate the correction is not applied.
 *
 * `fx-01` §4.5 puts the gate at about 2 Hz and the reasoning is that below it
 * the smoothing filter dominates: the step's harmonics are already far enough
 * below Nyquist that folding is inaudible, and the branch costs more than it
 * buys. Stated as a rate rather than as a phase increment so it reads the same
 * way at every sample rate.
 */
inline constexpr double kBlepMinRateHz = 2.0;

}  // namespace mw::dsp
