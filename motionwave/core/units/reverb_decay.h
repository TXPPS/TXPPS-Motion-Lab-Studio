// Motion Wave — turning a decay time into a feedback gain.
//
// `fx-02` §2.2, and the calibration §9 V5 requires rather than permits: the
// sheet marks its own formula **[I, derived by analogy]**, says it is correct in
// the mean and not exact, and says in as many words that the shipped Decay
// control must be calibrated against *measured* RT60 — "do not ship the
// uncalibrated formula".
//
// This is that calibration, and both corrections in it were measured before
// either was applied.
#pragma once

#include <cmath>

namespace mw::units::decay {

/**
 * §2.2's relation.
 *
 * A granular loop has no single delay time; it has a distribution of
 * recirculation times, because each grain reads from a random offset. The mean
 * offset stands in for the delay length:
 *
 *     fb = 10^(−3·τ̄ / RT60)
 *
 * The spread of those offsets is precisely what makes a granular tail smoother
 * than a comb's — the decay is a superposition of exponentials with the same
 * mean rate but different periods, which fills in the echo pattern.
 */
inline double feedbackFor(double meanOffsetSeconds, double rt60Seconds) noexcept {
  if (rt60Seconds <= 0.0) return 0.0;
  return std::pow(10.0, -3.0 * meanOffsetSeconds / rt60Seconds);
}

/// How many decibels per second a loop of this gain and mean offset loses.
inline double rt60For(double meanOffsetSeconds, double feedback) noexcept {
  if (feedback <= 0.0 || feedback >= 1.0) return 0.0;
  return -3.0 * meanOffsetSeconds / std::log10(feedback);
}

/**
 * **There is no calibration here yet, and that is a status rather than an
 * omission.**
 *
 * §9 V5 requires the shipped Decay control to be calibrated against *measured*
 * RT60 and forbids shipping the uncalibrated relation above. An attempt was
 * made and withdrawn, and what it established is worth keeping because it
 * constrains how the real one has to be built:
 *
 *  - Two mechanisms are real and identified. The cloud smears an impulse before
 *    the loop does anything, which lengthens short decays; and a loop whose
 *    per-pass gain is random decays faster than its mean gain says, because the
 *    decay follows the mean of the log rather than the log of the mean.
 *
 *  - **Neither can be measured from single impulse responses.** Which grains
 *    happen to catch the impulse decides how much energy enters the loop at
 *    all. Measured eight times at one size, the cloud's own decay ranged from
 *    0.0997 s to 0.4027 s — a factor of four. A three-point fit to numbers like
 *    that is fitting noise, and it proved it: adding the pitch sets shifted the
 *    spawn RNG stream and every coefficient moved by about two to one.
 *
 *  - Averaging over starting phases does not fix it either. Walking the engine
 *    by a different number of frames before the impulse changes the *state* the
 *    impulse lands in rather than resampling one quantity, and going from eight
 *    phases to sixteen moved the two-second error from +10.6 % to +12.4 %
 *    instead of converging it.
 *
 * So a sound calibration needs a designed excitation — an averaged energy decay
 * over many independent seeds, or a swept-sine measurement that does not depend
 * on a single impulse finding grains — and that is the outstanding work. Until
 * then the relation below is §2.2's own, unmodified, and the ledger says V5 is
 * not met rather than showing a number that came from noise.
 */

}  // namespace mw::units::decay
