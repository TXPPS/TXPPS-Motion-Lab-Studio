// GENERATED FILE — do not edit.
//
// Written by scripts/generate-params.mjs from motionwave/manifests/dyn-01-program-eq.json.
// Edit the manifest and re-run `npm run params`. A hand edit here is exactly
// the second opinion the manifest exists to prevent, and `npm run params:check`
// fails the build if one is present.
#pragma once

#include "../program_eq.h"

namespace mw::units {

/**
 * The ProgramEq's parameter ids.
 *
 * Stable and never renumbered: an id is what an automation lane and a saved
 * preset name a parameter by, so renumbering one silently re-points every
 * project that automated it.
 */
enum class ProgramEqParam : int {
  LowFreq = 1,
  LowBoost = 2,
  LowAtten = 3,
  HighFreq = 4,
  HighBoost = 5,
  Bandwidth = 6,
  AttenSel = 7,
  HighAtten = 8,
  EqIn = 9,
  Input = 10,
  Output = 11,
  Variance = 12,
  Oversampling = 13,
  Noise = 14,
};

/// One row of the parameter table, for tests that sweep every parameter.
struct ProgramEqParamRow {
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

inline constexpr int kProgramEqParamCount = 14;

inline constexpr ProgramEqParamRow kProgramEqParams[kProgramEqParamCount] = {
    {1, "LowFreq", "Low Frequency", 0.0, 3.0, 2.0, 0.0, 3.0, -70.0},
    {2, "LowBoost", "Low Boost", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {3, "LowAtten", "Low Atten", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {4, "HighFreq", "High Frequency", 0.0, 6.0, 4.0, 0.0, 6.0, -70.0},
    {5, "HighBoost", "High Boost", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {6, "Bandwidth", "Bandwidth", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {7, "AttenSel", "Atten Select", 0.0, 2.0, 1.0, 0.0, 2.0, -70.0},
    {8, "HighAtten", "High Atten", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {9, "EqIn", "EQ In", 0.0, 1.0, 1.0, 0.0, 1.0, -70.0},
    {10, "Input", "Input", -20.0, 20.0, 0.0, -6.0, 12.0, -70.0},
    {11, "Output", "Output", -20.0, 20.0, 0.0, -6.0, 6.0, -70.0},
    {12, "Variance", "Variance", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {13, "Oversampling", "Oversampling", 0.0, 3.0, 2.0, 1.0, 3.0, -70.0},
    {14, "Noise", "Noise", 0.0, 1.0, 1.0, 0.0, 1.0, -110.0},
};

/**
 * Route one parameter into the unit.
 *
 * Generated, which is the point: this switch and the TypeScript control table
 * are the same list, so a control naming no parameter does not compile and a
 * parameter with no control cannot be declared.
 */
inline void applyProgramEqParam(ProgramEq& u, int id, double v) noexcept {
  switch (static_cast<ProgramEqParam>(id)) {
    case ProgramEqParam::LowFreq: {
      // One selector for both low legs, which is precisely why they interact rather than
      // cancelling.
      PassiveEqSettings s = u.eqSettings();
      s.lowFreqIndex = static_cast<int>(v + 0.5);
      u.setEq(s);
      break;
    }
    case ProgramEqParam::LowBoost: {
      PassiveEqSettings s = u.eqSettings();
      s.lowBoost = v;
      u.setEq(s);
      break;
    }
    case ProgramEqParam::LowAtten: {
      PassiveEqSettings s = u.eqSettings();
      s.lowAtten = v;
      u.setEq(s);
      break;
    }
    case ProgramEqParam::HighFreq: {
      PassiveEqSettings s = u.eqSettings();
      s.highFreqIndex = static_cast<int>(v + 0.5);
      u.setEq(s);
      break;
    }
    case ProgramEqParam::HighBoost: {
      PassiveEqSettings s = u.eqSettings();
      s.highBoost = v;
      u.setEq(s);
      break;
    }
    case ProgramEqParam::Bandwidth: {
      // Sets the Q of the high boost bell and nothing else, which test 7 asserts to within a tenth
      // of a decibel.
      PassiveEqSettings s = u.eqSettings();
      s.bandwidth = v;
      u.setEq(s);
      break;
    }
    case ProgramEqParam::AttenSel: {
      PassiveEqSettings s = u.eqSettings();
      s.attenSelIndex = static_cast<int>(v + 0.5);
      u.setEq(s);
      break;
    }
    case ProgramEqParam::HighAtten: {
      PassiveEqSettings s = u.eqSettings();
      s.highAtten = v;
      u.setEq(s);
      break;
    }
    case ProgramEqParam::EqIn: {
      // Removes the passive network only. The amplifier and both transformers stay in circuit,
      // which is what test 2 measures from two directions.
      u.setEqIn(v > 0.5);
      break;
    }
    case ProgramEqParam::Input: {
      u.setInputGain(std::pow(10.0, v / 20.0));
      break;
    }
    case ProgramEqParam::Output: {
      u.setOutputGain(std::pow(10.0, v / 20.0));
      break;
    }
    case ProgramEqParam::Variance: {
      // One scalar for every per-instance deviation. Two engineering trims would make a user
      // calibrate a plug-in, and on the hardware the deviations are correlated anyway.
      u.setVariance(static_cast<float>(v), 7u);
      break;
    }
    case ProgramEqParam::Oversampling: {
      const int i = static_cast<int>(v + 0.5);
      u.setTier(i <= 0 ? ProgramEq::Tier::Off
      : (i == 1 ? ProgramEq::Tier::X2
      : (i == 2 ? ProgramEq::Tier::X4 : ProgramEq::Tier::X8)));
      break;
    }
    case ProgramEqParam::Noise: {
      // Scales the manual's own figure rather than naming a level: at 1 the floor is 92 dB below
      // +10 dBm, which is what the hardware specifies, and at 0 it is off for anyone measuring. Its
      // render-delta gate is -110 dBFS rather than the suite's -70 for the obvious reason: the
      // parameter's whole job is to sit at -104 dBFS, so a gate above that would grade a working
      // control as a dead one.
      u.setNoise(v * 1.09e-5);
      break;
    }
  }
}

}  // namespace mw::units
