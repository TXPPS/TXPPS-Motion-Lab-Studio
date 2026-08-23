// GENERATED FILE — do not edit.
//
// Written by scripts/generate-params.mjs from motionwave/manifests/dyn-03-fet-limiter.json.
// Edit the manifest and re-run `npm run params`. A hand edit here is exactly
// the second opinion the manifest exists to prevent, and `npm run params:check`
// fails the build if one is present.
#pragma once

#include "../fet_limiter.h"

namespace mw::units {

/**
 * The FetLimiter's parameter ids.
 *
 * Stable and never renumbered: an id is what an automation lane and a saved
 * preset name a parameter by, so renumbering one silently re-points every
 * project that automated it.
 */
enum class FetLimiterParam : int {
  Input = 1,
  Output = 2,
  Attack = 3,
  Release = 4,
  Ratio = 5,
  Limiting = 6,
  Variance = 7,
  Oversampling = 8,
  Noise = 9,
};

/// One row of the parameter table, for tests that sweep every parameter.
struct FetLimiterParamRow {
  int id;
  const char* symbol;
  const char* name;
  double min;
  double max;
  double def;
  /**
   * Two values a render-delta test may set this parameter to. Chosen per
   * parameter rather than taken as the range ends, because for several of them
   * an end of the range is a setting where the unit does nothing audible — a
   * range of −90 dB with depth at zero modulates silence — and a delta test
   * that cannot hear a working setter proves nothing about a broken one.
   */
  double deltaLow;
  double deltaHigh;
  /**
   * The difference, in dBFS, that render-delta must exceed for this parameter.
   *
   * Per parameter rather than one number for the unit, because a control whose
   * whole job is to sit at a stated level cannot be graded against a gate above
   * that level. The Program EQ's noise floor is specified at 92 dB below
   * +10 dBm — turning it on and off differs by −104 dBFS, which is the
   * parameter working exactly as its manual says and would read as a dead
   * setter against a −70 dB gate. Declaring the gate in the manifest keeps that
   * an explicit claim with a reason beside it, rather than a special case
   * hidden in a test.
   */
  double deltaFloorDb;
};

inline constexpr int kFetLimiterParamCount = 9;

inline constexpr FetLimiterParamRow kFetLimiterParams[kFetLimiterParamCount] = {
    {1, "Input", "Input", -20.0, 40.0, 0.0, 0.0, 24.0, -70.0},
    {2, "Output", "Output", -20.0, 40.0, 0.0, -6.0, 6.0, -70.0},
    {3, "Attack", "Attack", 1.0, 7.0, 7.0, 1.0, 7.0, -70.0},
    {4, "Release", "Release", 1.0, 7.0, 4.0, 1.0, 7.0, -70.0},
    {5, "Ratio", "Ratio", 0.0, 4.0, 0.0, 0.0, 3.0, -70.0},
    {6, "Limiting", "Limiting", 0.0, 1.0, 1.0, 0.0, 1.0, -70.0},
    {7, "Variance", "Variance", 0.0, 1.0, 0.0, 0.0, 1.0, -105.0},
    {8, "Oversampling", "Oversampling", 0.0, 3.0, 3.0, 1.0, 3.0, -70.0},
    {9, "Noise", "Noise", 0.0, 1.0, 1.0, 0.0, 1.0, -100.0},
};

/**
 * Route one parameter into the unit.
 *
 * Generated, which is the point: this switch and the TypeScript control table
 * are the same list, so a control naming no parameter does not compile and a
 * parameter with no control cannot be declared.
 */
inline void applyFetLimiterParam(FetLimiter& u, int id, double v) noexcept {
  switch (static_cast<FetLimiterParam>(id)) {
    case FetLimiterParam::Input: {
      // This unit has no threshold control. INPUT is how hard the signal is driven into a fixed
      // threshold, which is why it is the first thing a user reaches for.
      u.setInputGain(std::pow(10.0, v / 20.0));
      break;
    }
    case FetLimiterParam::Output: {
      // Outside the detector loop; section 9 test 13 asserts sweeping it moves the reduction by
      // under half a decibel.
      u.setOutputGain(std::pow(10.0, v / 20.0));
      break;
    }
    case FetLimiterParam::Attack: {
      // Panel scale 1 to 7, fully clockwise being 7 and FASTEST. Section 9 test 3 exists to catch a
      // model that gave this the conventional sense, which is what a plug-in user would expect and
      // what the hardware does not do.
      u.setAttack(v);
      break;
    }
    case FetLimiterParam::Release: {
      // Same reversed sense as ATTACK.
      u.setRelease(v);
      break;
    }
    case FetLimiterParam::Ratio: {
      // The buttons move the threshold as well as the slope, and upward: at a fixed input, 20:1
      // gives LESS reduction than 4:1. The fifth position is every button at once, which is a
      // different device rather than a fifth ratio.
      const int i = static_cast<int>(v + 0.5);
      u.setRatio(i <= 0 ? FetRatio::R4
      : (i == 1 ? FetRatio::R8
      : (i == 2 ? FetRatio::R12
      : (i == 3 ? FetRatio::R20 : FetRatio::AllIn))));
      break;
    }
    case FetLimiterParam::Limiting: {
      // ATTACK at OFF on the hardware: the detector leaves and the unit is a line amplifier. The
      // amplifier and both transformers stay in circuit.
      u.setLimiting(v > 0.5);
      break;
    }
    case FetLimiterParam::Variance: {
      // One scalar for every per-instance deviation, including the element's own two trims -
      // section 3.8's Q BIAS and DIST TRIM, which are where a drifted unit of this design actually
      // differs. Its render-delta gate is -105 dBFS, and the reason is the topology rather than a
      // weak control: a feedback limiter drives to a fixed output level, so drift in the gain
      // element is absorbed by the loop and only the distortion difference survives. Perturbing the
      // trims moved this row from -112 to -94 dBFS; the remaining smallness is the loop doing its
      // job.
      u.setVariance(static_cast<float>(v), 23u);
      break;
    }
    case FetLimiterParam::Oversampling: {
      // Defaults to 8x, and not for polish. The fastest attack is 20 microseconds, which is 0.88 of
      // a sample at 44.1 kHz - at any lower factor the top of the ATTACK control stops being a
      // control.
      const int i = static_cast<int>(v + 0.5);
      u.setTier(i <= 0 ? FetLimiter::Tier::Off
      : (i == 1 ? FetLimiter::Tier::X2
      : (i == 2 ? FetLimiter::Tier::X4 : FetLimiter::Tier::X8)));
      break;
    }
    case FetLimiterParam::Noise: {
      // Scales the published figure: 81 dB below the threshold of limiting.
      u.setNoise(v * 3.0e-5);
      break;
    }
  }
}

}  // namespace mw::units
