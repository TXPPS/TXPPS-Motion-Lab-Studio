// GENERATED FILE — do not edit.
//
// Written by scripts/generate-params.mjs from motionwave/manifests/dyn-05-console-eq.json.
// Edit the manifest and re-run `npm run params`. A hand edit here is exactly
// the second opinion the manifest exists to prevent, and `npm run params:check`
// fails the build if one is present.
#pragma once

#include "../console_eq.h"

namespace mw::units {

/**
 * The ConsoleEq's parameter ids.
 *
 * Stable and never renumbered: an id is what an automation lane and a saved
 * preset name a parameter by, so renumbering one silently re-points every
 * project that automated it.
 */
enum class ConsoleEqParam : int {
  Lineage = 1,
  Drive = 2,
  Output = 3,
  EqIn = 4,
  LowFrequency = 5,
  LowAmount = 6,
  MidFrequency = 7,
  MidAmount = 8,
  HighAmount = 9,
  HighPass = 10,
  BandOneFrequency = 11,
  BandOneAmount = 12,
  BandOneShape = 13,
  BandTwoFrequency = 14,
  BandTwoAmount = 15,
  BandThreeFrequency = 16,
  BandThreeAmount = 17,
  BandThreeShape = 18,
  BandPass = 19,
  Oversampling = 20,
};

/// One row of the parameter table, for tests that sweep every parameter.
struct ConsoleEqParamRow {
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

inline constexpr int kConsoleEqParamCount = 20;

inline constexpr ConsoleEqParamRow kConsoleEqParams[kConsoleEqParamCount] = {
    {1, "Lineage", "Lineage", 0.0, 1.0, 0.0, 0.0, 1.0, -60.0},
    {2, "Drive", "Drive", -20.0, 20.0, 0.0, -12.0, 14.0, -70.0},
    {3, "Output", "Output", -20.0, 20.0, 0.0, -12.0, 12.0, -70.0},
    {4, "EqIn", "EQ In", 0.0, 1.0, 1.0, 1.0, 0.0, -70.0},
    {5, "LowFrequency", "Low Freq", 0.0, 3.0, 2.0, 0.0, 3.0, -70.0},
    {6, "LowAmount", "Low", -16.0, 16.0, 0.0, -16.0, 16.0, -70.0},
    {7, "MidFrequency", "Mid Freq", 0.0, 5.0, 2.0, 0.0, 5.0, -70.0},
    {8, "MidAmount", "Mid", -18.0, 18.0, 0.0, -18.0, 18.0, -70.0},
    {9, "HighAmount", "High", -16.0, 16.0, 0.0, -16.0, 16.0, -70.0},
    {10, "HighPass", "High-Pass", 0.0, 4.0, 0.0, 0.0, 4.0, -70.0},
    {11, "BandOneFrequency", "Band 1 Freq", 0.0, 4.0, 2.0, 0.0, 4.0, -70.0},
    {12, "BandOneAmount", "Band 1", 0.0, 10.0, 5.0, 5.0, 10.0, -70.0},
    {13, "BandOneShape", "Band 1 Shape", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {14, "BandTwoFrequency", "Band 2 Freq", 0.0, 4.0, 2.0, 0.0, 4.0, -70.0},
    {15, "BandTwoAmount", "Band 2", 0.0, 10.0, 5.0, 5.0, 10.0, -70.0},
    {16, "BandThreeFrequency", "Band 3 Freq", 0.0, 4.0, 2.0, 0.0, 4.0, -70.0},
    {17, "BandThreeAmount", "Band 3", 0.0, 10.0, 5.0, 5.0, 10.0, -70.0},
    {18, "BandThreeShape", "Band 3 Shape", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {19, "BandPass", "Band-Pass", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {20, "Oversampling", "Oversampling", 0.0, 3.0, 2.0, 0.0, 3.0, -90.0},
};

/**
 * Route one parameter into the unit.
 *
 * Generated, which is the point: this switch and the TypeScript control table
 * are the same list, so a control naming no parameter does not compile and a
 * parameter with no control cannot be declared.
 */
inline void applyConsoleEqParam(ConsoleEq& u, int id, double v) noexcept {
  switch (static_cast<ConsoleEqParam>(id)) {
    case ConsoleEqParam::Lineage: {
      // Named for the element that makes the curve, which is the difference that matters and is
      // also the only honest way to name them.
      u.setLineage(v < 0.5 ? ConsoleEq::Lineage::British : ConsoleEq::Lineage::American);
      break;
    }
    case ConsoleEqParam::Drive: {
      // The mic gain switch on the hardware, +20 to +80 dB in 5 dB steps. §3.1 says to default it
      // to unity-equivalent and treat it as a drive control, because it is the principal way a user
      // reaches the amplifier's nonlinearity.
      u.setDriveDb(v);
      break;
    }
    case ConsoleEqParam::Output: {
      u.setOutputDb(v);
      break;
    }
    case ConsoleEqParam::EqIn: {
      // Removes the networks and nothing else. §3.6 and §4.5: the amplifiers and the transformers
      // stay in circuit, which is what §10 test 8 measures.
      u.setEqIn(v >= 0.5);
      break;
    }
    case ConsoleEqParam::LowFrequency: {
      u.setBritishLowFrequency(static_cast<int>(v + 0.5));
      break;
    }
    case ConsoleEqParam::LowAmount: {
      u.setBritishLowAmount(v);
      break;
    }
    case ConsoleEqParam::MidFrequency: {
      // The lower two positions switch the inductance with the capacitance and hold Q constant; the
      // upper four switch only the capacitance, so Q climbs. §6.1, and §10 test 2 measures it.
      u.setBritishMidFrequency(static_cast<int>(v + 0.5));
      break;
    }
    case ConsoleEqParam::MidAmount: {
      u.setBritishMidAmount(v);
      break;
    }
    case ConsoleEqParam::HighAmount: {
      // No frequency control: §3.2 fixes the high band at 12 kHz and the hardware has no choice to
      // offer.
      u.setBritishHighAmount(v);
      break;
    }
    case ConsoleEqParam::HighPass: {
      // 18 dB per octave, which is third order and unusual for the period — §3.5 calls it one of
      // the unit's identifying characteristics.
      u.setHighPass(static_cast<int>(v + 0.5));
      break;
    }
    case ConsoleEqParam::BandOneFrequency: {
      u.setAmericanFrequency(0, static_cast<int>(v + 0.5));
      break;
    }
    case ConsoleEqParam::BandOneAmount: {
      // Five detents each way plus zero, and the values are a table rather than a series — the gap
      // widens at the top. Q follows the amount, so this control sets the shape as well as the
      // size.
      u.setAmericanAmount(0, ConsoleEq::americanStepDb(static_cast<int>(v + 0.5)));
      break;
    }
    case ConsoleEqParam::BandOneShape: {
      // §4.3: only the outer bands switch shape. The default is peak, which is the shape the
      // proportional-Q behaviour is defined for.
      u.setAmericanShape(0, v < 0.5 ? ConsoleEq::Shape::Peak : ConsoleEq::Shape::Shelf);
      break;
    }
    case ConsoleEqParam::BandTwoFrequency: {
      u.setAmericanFrequency(1, static_cast<int>(v + 0.5));
      break;
    }
    case ConsoleEqParam::BandTwoAmount: {
      // Five detents each way plus zero, and the values are a table rather than a series — the gap
      // widens at the top. Q follows the amount, so this control sets the shape as well as the
      // size.
      u.setAmericanAmount(1, ConsoleEq::americanStepDb(static_cast<int>(v + 0.5)));
      break;
    }
    case ConsoleEqParam::BandThreeFrequency: {
      u.setAmericanFrequency(2, static_cast<int>(v + 0.5));
      break;
    }
    case ConsoleEqParam::BandThreeAmount: {
      // Five detents each way plus zero, and the values are a table rather than a series — the gap
      // widens at the top. Q follows the amount, so this control sets the shape as well as the
      // size.
      u.setAmericanAmount(2, ConsoleEq::americanStepDb(static_cast<int>(v + 0.5)));
      break;
    }
    case ConsoleEqParam::BandThreeShape: {
      // §4.3: only the outer bands switch shape. The default is peak, which is the shape the
      // proportional-Q behaviour is defined for.
      u.setAmericanShape(2, v < 0.5 ? ConsoleEq::Shape::Peak : ConsoleEq::Shape::Shelf);
      break;
    }
    case ConsoleEqParam::BandPass: {
      // 12 dB per octave, 50 Hz to 15 kHz, and independent of every EQ setting — §4.4, which is why
      // it sits outside the EQ-in latch here as it does on the panel.
      u.setBandPass(v >= 0.5);
      break;
    }
    case ConsoleEqParam::Oversampling: {
      const int i = static_cast<int>(v + 0.5);
      u.setTier(i <= 0 ? ConsoleEq::Tier::Off
      : (i == 1 ? ConsoleEq::Tier::X2
      : (i == 2 ? ConsoleEq::Tier::X4 : ConsoleEq::Tier::X8)));
      break;
    }
  }
}

}  // namespace mw::units
