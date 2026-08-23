// GENERATED FILE — do not edit.
//
// Written by scripts/generate-params.mjs from motionwave/manifests/dyn-02-optical-leveller.json.
// Edit the manifest and re-run `npm run params`. A hand edit here is exactly
// the second opinion the manifest exists to prevent, and `npm run params:check`
// fails the build if one is present.
#pragma once

#include "../optical_leveller.h"

namespace mw::units {

/**
 * The OpticalLeveller's parameter ids.
 *
 * Stable and never renumbered: an id is what an automation lane and a saved
 * preset name a parameter by, so renumbering one silently re-points every
 * project that automated it.
 */
enum class OpticalLevellerParam : int {
  PeakReduction = 1,
  Gain = 2,
  Mode = 3,
  Emphasis = 4,
  Wear = 5,
  Input = 6,
  Variance = 7,
  Oversampling = 8,
  Noise = 9,
};

/// One row of the parameter table, for tests that sweep every parameter.
struct OpticalLevellerParamRow {
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

inline constexpr int kOpticalLevellerParamCount = 9;

inline constexpr OpticalLevellerParamRow kOpticalLevellerParams[kOpticalLevellerParamCount] = {
    {1, "PeakReduction", "Peak Reduction", 0.0, 1.0, 0.0, 0.1, 0.6, -70.0},
    {2, "Gain", "Gain", -20.0, 40.0, 0.0, -6.0, 12.0, -70.0},
    {3, "Mode", "Mode", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {4, "Emphasis", "Emphasis", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {5, "Wear", "Cell Wear", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {6, "Input", "Input", -20.0, 20.0, 0.0, -6.0, 12.0, -70.0},
    {7, "Variance", "Variance", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {8, "Oversampling", "Oversampling", 0.0, 3.0, 2.0, 1.0, 3.0, -70.0},
    {9, "Noise", "Noise", 0.0, 1.0, 1.0, 0.0, 1.0, -95.0},
};

/**
 * Route one parameter into the unit.
 *
 * Generated, which is the point: this switch and the TypeScript control table
 * are the same list, so a control naming no parameter does not compile and a
 * parameter with no control cannot be declared.
 */
inline void applyOpticalLevellerParam(OpticalLeveller& u, int id, double v) noexcept {
  switch (static_cast<OpticalLevellerParam>(id)) {
    case OpticalLevellerParam::PeakReduction: {
      // The panel's 0-100 scale, normalised. Section 3.1 says the numbers correspond to no dB value
      // and the taper is unknown, so this is dimensionless and its mapping to reduction is whatever
      // the loop makes it.
      u.setPeakReduction(v);
      break;
    }
    case OpticalLevellerParam::Gain: {
      // Outside the detector loop, which section 3.2 marks as inference and test 12 checks:
      // sweeping this must move the reduction by under a decibel.
      u.setMakeUpGain(std::pow(10.0, v / 20.0));
      break;
    }
    case OpticalLevellerParam::Mode: {
      // A change in the sidechain's gain and rectification law, never a ratio parameter. Section
      // 3.3: a ratio computed from a static curve is right at one depth and wrong at all others.
      u.setMode(v > 0.5 ? OpticalLeveller::Mode::Limit : OpticalLeveller::Mode::Compress);
      break;
    }
    case OpticalLevellerParam::Emphasis: {
      // Internal on the hardware and factory-set flat. Exposed here as most modern equivalents do,
      // and defaulted flat so the baseline matches the unit as shipped.
      u.setEmphasis(v);
      break;
    }
    case OpticalLevellerParam::Wear: {
      // An explicit parameter rather than something baked in, as section 7 asks. All three
      // published symptoms of a worn cell move together because they are one process.
      u.setWear(v);
      break;
    }
    case OpticalLevellerParam::Input: {
      u.setInputGain(std::pow(10.0, v / 20.0));
      break;
    }
    case OpticalLevellerParam::Variance: {
      u.setVariance(static_cast<float>(v), 11u);
      break;
    }
    case OpticalLevellerParam::Oversampling: {
      const int i = static_cast<int>(v + 0.5);
      u.setTier(i <= 0 ? OpticalLeveller::Tier::Off
      : (i == 1 ? OpticalLeveller::Tier::X2
      : (i == 2 ? OpticalLeveller::Tier::X4 : OpticalLeveller::Tier::X8)));
      break;
    }
    case OpticalLevellerParam::Noise: {
      // Scales the manual's own figure: at 1 the floor is 75 dB below +10 dBm, which is 17 dB
      // noisier than the Program EQ and is one of this unit's published characteristics. Its
      // render-delta gate is -95 dBFS rather than the suite's -70 for the same reason the Program
      // EQ's is -110 - the parameter's job is to sit below that.
      u.setNoise(v * 7.7e-5);
      break;
    }
  }
}

}  // namespace mw::units
