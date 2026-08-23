// GENERATED FILE — do not edit.
//
// Written by scripts/generate-params.mjs from motionwave/manifests/fx-01-motion-shaper.json.
// Edit the manifest and re-run `npm run params`. A hand edit here is exactly
// the second opinion the manifest exists to prevent, and `npm run params:check`
// fails the build if one is present.
#pragma once

#include "../motion_shaper.h"

namespace mw::units {

/**
 * The MotionShaper's parameter ids.
 *
 * Stable and never renumbered: an id is what an automation lane and a saved
 * preset name a parameter by, so renumbering one silently re-points every
 * project that automated it.
 */
enum class MotionShaperParam : int {
  BandCount = 1,
  CrossoverLowMid = 2,
  CrossoverMidHigh = 3,
  Slope = 4,
  Smooth = 5,
  Mix = 6,
  DepthLow = 7,
  DepthMid = 8,
  DepthHigh = 9,
  RangeLow = 10,
  RangeMid = 11,
  RangeHigh = 12,
  Rate = 13,
  Swing = 14,
  PhaseOffset = 15,
  SyncMode = 16,
};

/// One row of the parameter table, for tests that sweep every parameter.
struct MotionShaperParamRow {
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
};

inline constexpr int kMotionShaperParamCount = 16;

inline constexpr MotionShaperParamRow kMotionShaperParams[kMotionShaperParamCount] = {
    {1, "BandCount", "Bands", 0.0, 2.0, 2.0, 0.0, 2.0},
    {2, "CrossoverLowMid", "Low / Mid", 30.0, 2000.0, 220.0, 40.0, 1500.0},
    {3, "CrossoverMidHigh", "Mid / High", 500.0, 16000.0, 3200.0, 700.0, 12000.0},
    {4, "Slope", "Slope", 0.0, 2.0, 2.0, 0.0, 2.0},
    {5, "Smooth", "Smooth", 0.0, 1.0, 0.0, 0.0, 1.0},
    {6, "Mix", "Mix", 0.0, 1.0, 1.0, 0.0, 1.0},
    {7, "DepthLow", "Low Depth", 0.0, 1.0, 1.0, 0.0, 1.0},
    {8, "DepthMid", "Mid Depth", 0.0, 1.0, 1.0, 0.0, 1.0},
    {9, "DepthHigh", "High Depth", 0.0, 1.0, 1.0, 0.0, 1.0},
    {10, "RangeLow", "Low Range", -90.0, 0.0, -60.0, -90.0, -6.0},
    {11, "RangeMid", "Mid Range", -90.0, 0.0, -60.0, -90.0, -6.0},
    {12, "RangeHigh", "High Range", -90.0, 0.0, -60.0, -90.0, -6.0},
    {13, "Rate", "Rate", 0.05, 200.0, 2.0, 0.5, 40.0},
    {14, "Swing", "Swing", 0.0, 1.0, 0.0, 0.0, 1.0},
    {15, "PhaseOffset", "Offset", 0.0, 360.0, 0.0, 0.0, 180.0},
    {16, "SyncMode", "Sync", 0.0, 2.0, 0.0, 0.0, 1.0},
};

/**
 * Route one parameter into the unit.
 *
 * Generated, which is the point: this switch and the TypeScript control table
 * are the same list, so a control naming no parameter does not compile and a
 * parameter with no control cannot be declared.
 */
inline void applyMotionShaperParam(MotionShaper& u, int id, double v) noexcept {
  switch (static_cast<MotionShaperParam>(id)) {
    case MotionShaperParam::BandCount: {
      // The control is a choice index and the unit counts bands from one, so the +1 is the mapping
      // and not an off-by-one.
      u.setBandCount(static_cast<int>(v + 0.5) + 1);
      break;
    }
    case MotionShaperParam::CrossoverLowMid: {
      // Both corners go in together because they are one filter network; the other one is read back
      // rather than remembered here.
      u.setCrossovers(v, u.midHighHz());
      break;
    }
    case MotionShaperParam::CrossoverMidHigh: {
      u.setCrossovers(u.lowMidHz(), v);
      break;
    }
    case MotionShaperParam::Slope: {
      const int i = static_cast<int>(v + 0.5);
      u.setSlope(i <= 0 ? dsp::Slope::Db6 : (i == 1 ? dsp::Slope::Db12 : dsp::Slope::Db24));
      break;
    }
    case MotionShaperParam::Smooth: {
      u.setSmooth(v);
      break;
    }
    case MotionShaperParam::Mix: {
      u.setMix(v);
      break;
    }
    case MotionShaperParam::DepthLow: {
      BandSettings s = u.band(0);
      s.depth = v;
      u.setBand(0, s);
      break;
    }
    case MotionShaperParam::DepthMid: {
      BandSettings s = u.band(1);
      s.depth = v;
      u.setBand(1, s);
      break;
    }
    case MotionShaperParam::DepthHigh: {
      BandSettings s = u.band(2);
      s.depth = v;
      u.setBand(2, s);
      break;
    }
    case MotionShaperParam::RangeLow: {
      BandSettings s = u.band(0);
      s.rangeDb = v;
      u.setBand(0, s);
      break;
    }
    case MotionShaperParam::RangeMid: {
      BandSettings s = u.band(1);
      s.rangeDb = v;
      u.setBand(1, s);
      break;
    }
    case MotionShaperParam::RangeHigh: {
      BandSettings s = u.band(2);
      s.rangeDb = v;
      u.setBand(2, s);
      break;
    }
    case MotionShaperParam::Rate: {
      u.phase().setRateHz(v);
      break;
    }
    case MotionShaperParam::Swing: {
      // Sixteenths, which is what the sheet's swing control shifts; the unit exposes the amount and
      // fixes the grid rather than shipping two controls that only make sense together.
      u.phase().setSwing(v, 16.0);
      break;
    }
    case MotionShaperParam::PhaseOffset: {
      u.phase().setOffsetDegrees(v);
      break;
    }
    case MotionShaperParam::SyncMode: {
      const int i = static_cast<int>(v + 0.5);
      u.phase().setMode(i <= 0 ? dsp::PhaseMode::Host
      : (i == 1 ? dsp::PhaseMode::Free : dsp::PhaseMode::Trigger));
      break;
    }
  }
}

}  // namespace mw::units
