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
 * The calibration §9 V5 requires, as the table the sheet names — built on a
 * measurement that was validated before it was trusted.
 *
 * **The first two attempts at this were withdrawn, and why matters.** The first
 * was fitted to impulse responses, whose variance is a property of the *probe*:
 * whether a grain happens to catch the impulse decides how much energy enters
 * the loop at all, and eight renders at one setting ranged from 0.0997 s to
 * 0.4027 s. It broke when an unrelated change moved the spawn RNG stream. The
 * second was a rate-squared law fitted to a sound measurement over too narrow a
 * range: it delivered 2 to 16 seconds within 3.5 % and inverted catastrophically
 * at one second, where the loop is short enough that the grains' own length
 * truncates the tail and the law's sign is wrong.
 *
 * So this is a measured mapping rather than a law. Behind it:
 *
 *  - ISO 3382's interrupted-noise excitation, Schroeder backward integration,
 *    T30 from −5 to −35 dB extrapolated — `decay_harness.h`.
 *  - An ensemble of sixteen independent *engine seeds* per point, reported with
 *    a 95 % interval. Starting phases are not independent samples.
 *  - The instrument checked first against a plain feedback delay line whose
 *    RT60 follows analytically from its gain: it recovers that to −0.15 %,
 *    −0.03 % and +0.01 % across a 58:1 range of decay times.
 *
 * **The floor is real and is the reason the short end cannot simply be fitted.**
 * Four settings spanning feedback gains from zero to 0.00025 all deliver between
 * 0.465 and 0.553 s: below about half a second the decay is the cloud's own and
 * no feedback setting reaches it. §6 says Size interacts with Decay's
 * calibration, and this is the interaction, measured.
 *
 * **The table is the default cloud's.** It was measured at an 800 ms size, 60 ms
 * grains and 350 grains a second, which is what §9 V5 specifies. Moving those
 * moves the cloud's contribution and therefore the short end of this curve; the
 * long end, where the loop dominates, is §2.2's relation and is
 * setting-independent.
 */
struct DecayPoint {
  double delivered;
  double feedback;
};

/**
 * Measured, mean of sixteen seeds per point. Monotone in both columns.
 *
 * Dense between 0.6 and 1.8 seconds on purpose: that is where the cloud's own
 * decay and the loop's are comparable and the mapping turns sharply — a gain of
 * 0.023 delivers 0.66 s and one of 0.036 delivers 0.97. Sampled coarsely there,
 * interpolation put the one-second setting 30 % long, which is the whole reason
 * this is a table rather than a curve.
 */
inline constexpr DecayPoint kDecayTable[] = {
    {0.634, 0.017237},  {0.658, 0.022757},  {0.967, 0.035522},  {1.116, 0.046687},
    {1.260, 0.056609},  {1.369, 0.065537},  {1.432, 0.077448},  {1.498, 0.087955},
    {1.584, 0.103105},  {1.767, 0.157169},  {2.200, 0.229724},  {3.180, 0.377855},
    {5.010, 0.545485},  {7.839, 0.689072},  {12.705, 0.797088}, {21.536, 0.875359},
    {39.609, 0.929689}, {60.658, 0.952638},
};

inline constexpr int kDecayPoints = 18;

/// The shortest decay any feedback setting delivers at the default cloud.
inline constexpr double kDecayFloorSeconds = 0.49;

/**
 * The feedback gain that delivers `target`, by interpolating the measurement.
 *
 * Interpolated in log-decay against gain, because the decay spans two decades
 * and a linear interpolation across that puts most of its error in the octave
 * users spend the most time in.
 */
inline double calibratedFeedback(double meanOffsetSeconds, double rt60Target) noexcept {
  (void)meanOffsetSeconds;  // the table already carries it, at the default cloud
  if (rt60Target <= kDecayTable[0].delivered) return kDecayTable[0].feedback;
  if (rt60Target >= kDecayTable[kDecayPoints - 1].delivered) {
    // §2.2 caps the gain at 0.98 internally; Freeze does not use it at all.
    return kDecayTable[kDecayPoints - 1].feedback > 0.98
               ? 0.98
               : kDecayTable[kDecayPoints - 1].feedback;
  }
  for (int i = 1; i < kDecayPoints; ++i) {
    if (rt60Target > kDecayTable[i].delivered) continue;
    const double lowLog = std::log(kDecayTable[i - 1].delivered);
    const double highLog = std::log(kDecayTable[i].delivered);
    const double t = (std::log(rt60Target) - lowLog) / (highLog - lowLog);
    const double gain = kDecayTable[i - 1].feedback +
                        t * (kDecayTable[i].feedback - kDecayTable[i - 1].feedback);
    return gain > 0.98 ? 0.98 : gain;
  }
  return kDecayTable[kDecayPoints - 1].feedback;
}

/// What the panel should show: the decay the loop will actually deliver, which
/// below the floor is the floor rather than what was asked for.
inline double deliveredRt60(double meanOffsetSeconds, double feedback) noexcept {
  const double loop = rt60For(meanOffsetSeconds, feedback);
  return loop < kDecayFloorSeconds ? kDecayFloorSeconds : loop;
}

}  // namespace mw::units::decay
