// GENERATED FILE — do not edit.
//
// Written by scripts/generate-params.mjs from motionwave/manifests/dyn-04-variable-mu.json.
// Edit the manifest and re-run `npm run params`. A hand edit here is exactly
// the second opinion the manifest exists to prevent, and `npm run params:check`
// fails the build if one is present.
#pragma once

#include "../variable_mu.h"

namespace mw::units {

/**
 * The VariableMu's parameter ids.
 *
 * Stable and never renumbered: an id is what an automation lane and a saved
 * preset name a parameter by, so renumbering one silently re-points every
 * project that automated it.
 */
enum class VariableMuParam : int {
  InputA = 1,
  InputB = 2,
  ThresholdA = 3,
  ThresholdB = 4,
  TimeConstantA = 5,
  TimeConstantB = 6,
  DcThresholdA = 7,
  DcThresholdB = 8,
  Mode = 9,
  Oversampling = 10,
};

/// One row of the parameter table, for tests that sweep every parameter.
struct VariableMuParamRow {
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

inline constexpr int kVariableMuParamCount = 10;

inline constexpr VariableMuParamRow kVariableMuParams[kVariableMuParamCount] = {
    {1, "InputA", "Input A", 0.0, 20.0, 0.0, 0.0, 18.0, -70.0},
    {2, "InputB", "Input B", 0.0, 20.0, 0.0, 0.0, 18.0, -70.0},
    {3, "ThresholdA", "Threshold A", 0.0, 10.0, 10.0, 10.0, 2.0, -70.0},
    {4, "ThresholdB", "Threshold B", 0.0, 10.0, 10.0, 10.0, 2.0, -70.0},
    {5, "TimeConstantA", "Time Constant A", 0.0, 5.0, 3.0, 0.0, 5.0, -70.0},
    {6, "TimeConstantB", "Time Constant B", 0.0, 5.0, 3.0, 0.0, 5.0, -70.0},
    {7, "DcThresholdA", "DC Threshold A", 0.0, 1.0, 0.5, 0.0, 1.0, -70.0},
    {8, "DcThresholdB", "DC Threshold B", 0.0, 1.0, 0.5, 0.0, 1.0, -70.0},
    {9, "Mode", "Mode", 0.0, 1.0, 0.0, 0.0, 1.0, -60.0},
    {10, "Oversampling", "Oversampling", 0.0, 3.0, 2.0, 0.0, 3.0, -90.0},
};

/**
 * Route one parameter into the unit.
 *
 * Generated, which is the point: this switch and the TypeScript control table
 * are the same list, so a control naming no parameter does not compile and a
 * parameter with no control cannot be declared.
 */
inline void applyVariableMuParam(VariableMu& u, int id, double v) noexcept {
  switch (static_cast<VariableMuParam>(id)) {
    case VariableMuParam::InputA: {
      // A stepped attenuator on the hardware, 1 dB per step across 20 dB, with no gain anywhere on
      // it. It is the drive control: the threshold is set separately, so this decides how hard the
      // tube is worked for a given amount of reduction.
      u.setInputAttenuationDb(0, v);
      break;
    }
    case VariableMuParam::InputB: {
      // A stepped attenuator on the hardware, 1 dB per step across 20 dB, with no gain anywhere on
      // it. It is the drive control: the threshold is set separately, so this decides how hard the
      // tube is worked for a given amount of reduction.
      u.setInputAttenuationDb(1, v);
      break;
    }
    case VariableMuParam::ThresholdA: {
      // Reversed sense, §3.2. Ten fully clockwise is no compression and zero is maximum, which is
      // the panel and not a mistake.
      u.setThreshold(0, v);
      break;
    }
    case VariableMuParam::ThresholdB: {
      // Reversed sense, §3.2. Ten fully clockwise is no compression and zero is maximum, which is
      // the panel and not a mistake.
      u.setThreshold(1, v);
      break;
    }
    case VariableMuParam::TimeConstantA: {
      // The control is a choice index and the panel counts from one, so the +1 is the mapping.
      // Positions 5 and 6 are programme-dependent — see §4.
      u.setTimeConstant(0, static_cast<int>(v + 0.5) + 1);
      break;
    }
    case VariableMuParam::TimeConstantB: {
      // The control is a choice index and the panel counts from one, so the +1 is the mapping.
      // Positions 5 and 6 are programme-dependent — see §4.
      u.setTimeConstant(1, static_cast<int>(v + 0.5) + 1);
      break;
    }
    case VariableMuParam::DcThresholdA: {
      // A rear trim on the hardware, exposed because without it the published 2:1 to 30:1 ratio
      // range is unreachable. Secondary, with a calibrated default.
      u.setDcThreshold(0, v);
      break;
    }
    case VariableMuParam::DcThresholdB: {
      // A rear trim on the hardware, exposed because without it the published 2:1 to 30:1 ratio
      // range is unreachable. Secondary, with a calibrated default.
      u.setDcThreshold(1, v);
      break;
    }
    case VariableMuParam::Mode: {
      // The matrix is formed in the transformer windings, so it is a mode of the audio path rather
      // than a routing option around it.
      u.setMode(v < 0.5 ? VariableMu::Mode::LeftRight : VariableMu::Mode::LateralVertical);
      break;
    }
    case VariableMuParam::Oversampling: {
      const int i = static_cast<int>(v + 0.5);
      u.setTier(i <= 0 ? VariableMu::Tier::Off
      : (i == 1 ? VariableMu::Tier::X2
      : (i == 2 ? VariableMu::Tier::X4 : VariableMu::Tier::X8)));
      break;
    }
  }
}

}  // namespace mw::units
