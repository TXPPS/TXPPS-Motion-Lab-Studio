// GENERATED FILE — do not edit.
//
// Written by scripts/generate-params.mjs from motionwave/manifests/fx-03-granular-delay.json.
// Edit the manifest and re-run `npm run params`. A hand edit here is exactly
// the second opinion the manifest exists to prevent, and `npm run params:check`
// fails the build if one is present.
#pragma once

#include "../granular_delay.h"

namespace mw::units {

/**
 * The GranularDelay's parameter ids.
 *
 * Stable and never renumbered: an id is what an automation lane and a saved
 * preset name a parameter by, so renumbering one silently re-points every
 * project that automated it.
 */
enum class GranularDelayParam : int {
  Mix = 1,
  Topology = 2,
  Cross = 3,
  TapCount = 4,
  Sync = 5,
  TimeMode = 6,
  Spacing = 7,
  Feedback = 8,
  FeedbackSource = 9,
  FeedbackTime = 10,
  FeedbackDivision = 11,
  FeedbackModifier = 12,
  LoopLowpass = 13,
  LoopHighpass = 14,
  Drive = 15,
  Character = 16,
  TimeChange = 17,
  Smear = 18,
  Ducking = 19,
  Width = 20,
  OutputTrim = 21,
  Quality = 22,
  Bypass = 23,
  Wear = 24,
  Bias = 25,
  Age = 26,
  Stages = 27,
  ClockWhine = 28,
  Tap1Time = 100,
  Tap1Division = 101,
  Tap1Modifier = 102,
  Tap1Level = 104,
  Tap1Pan = 105,
  Tap1Pitch = 106,
  Tap1Fine = 107,
  Tap1Filter = 108,
  Tap1Cutoff = 109,
  Tap1Q = 110,
  Tap1Reverse = 111,
  Tap1Mute = 112,
  Tap1Solo = 113,
  Tap2Time = 120,
  Tap2Division = 121,
  Tap2Modifier = 122,
  Tap2Ratio = 123,
  Tap2Level = 124,
  Tap2Pan = 125,
  Tap2Pitch = 126,
  Tap2Fine = 127,
  Tap2Filter = 128,
  Tap2Cutoff = 129,
  Tap2Q = 130,
  Tap2Reverse = 131,
  Tap2Mute = 132,
  Tap2Solo = 133,
  Tap3Time = 140,
  Tap3Division = 141,
  Tap3Modifier = 142,
  Tap3Ratio = 143,
  Tap3Level = 144,
  Tap3Pan = 145,
  Tap3Pitch = 146,
  Tap3Fine = 147,
  Tap3Filter = 148,
  Tap3Cutoff = 149,
  Tap3Q = 150,
  Tap3Reverse = 151,
  Tap3Mute = 152,
  Tap3Solo = 153,
  Tap4Time = 160,
  Tap4Division = 161,
  Tap4Modifier = 162,
  Tap4Ratio = 163,
  Tap4Level = 164,
  Tap4Pan = 165,
  Tap4Pitch = 166,
  Tap4Fine = 167,
  Tap4Filter = 168,
  Tap4Cutoff = 169,
  Tap4Q = 170,
  Tap4Reverse = 171,
  Tap4Mute = 172,
  Tap4Solo = 173,
  Tap5Time = 180,
  Tap5Division = 181,
  Tap5Modifier = 182,
  Tap5Ratio = 183,
  Tap5Level = 184,
  Tap5Pan = 185,
  Tap5Pitch = 186,
  Tap5Fine = 187,
  Tap5Filter = 188,
  Tap5Cutoff = 189,
  Tap5Q = 190,
  Tap5Reverse = 191,
  Tap5Mute = 192,
  Tap5Solo = 193,
  Tap6Time = 200,
  Tap6Division = 201,
  Tap6Modifier = 202,
  Tap6Ratio = 203,
  Tap6Level = 204,
  Tap6Pan = 205,
  Tap6Pitch = 206,
  Tap6Fine = 207,
  Tap6Filter = 208,
  Tap6Cutoff = 209,
  Tap6Q = 210,
  Tap6Reverse = 211,
  Tap6Mute = 212,
  Tap6Solo = 213,
  Tap7Time = 220,
  Tap7Division = 221,
  Tap7Modifier = 222,
  Tap7Ratio = 223,
  Tap7Level = 224,
  Tap7Pan = 225,
  Tap7Pitch = 226,
  Tap7Fine = 227,
  Tap7Filter = 228,
  Tap7Cutoff = 229,
  Tap7Q = 230,
  Tap7Reverse = 231,
  Tap7Mute = 232,
  Tap7Solo = 233,
  Tap8Time = 240,
  Tap8Division = 241,
  Tap8Modifier = 242,
  Tap8Ratio = 243,
  Tap8Level = 244,
  Tap8Pan = 245,
  Tap8Pitch = 246,
  Tap8Fine = 247,
  Tap8Filter = 248,
  Tap8Cutoff = 249,
  Tap8Q = 250,
  Tap8Reverse = 251,
  Tap8Mute = 252,
  Tap8Solo = 253,
};

/// One row of the parameter table, for tests that sweep every parameter.
struct GranularDelayParamRow {
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

inline constexpr int kGranularDelayParamCount = 139;

inline constexpr GranularDelayParamRow kGranularDelayParams[kGranularDelayParamCount] = {
    {1, "Mix", "Mix", 0.0, 100.0, 30.0, 0.0, 100.0, -70.0},
    {2, "Topology", "Topology", 0.0, 3.0, 0.0, 0.0, 1.0, -70.0},
    {3, "Cross", "Cross", 0.0, 100.0, 50.0, 0.0, 100.0, -70.0},
    {4, "TapCount", "Taps", 0.0, 7.0, 3.0, 0.0, 7.0, -70.0},
    {5, "Sync", "Sync", 0.0, 1.0, 1.0, 0.0, 1.0, -70.0},
    {6, "TimeMode", "Tap times", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {7, "Spacing", "Spacing", 0.0, 3.0, 0.0, 0.0, 3.0, -70.0},
    {8, "Feedback", "Feedback", 0.0, 130.0, 35.0, 0.0, 90.0, -70.0},
    {9, "FeedbackSource", "Feedback from", 0.0, 2.0, 0.0, 0.0, 2.0, -70.0},
    {10, "FeedbackTime", "Feedback time", 1.0, 8000.0, 250.0, 50.0, 1500.0, -70.0},
    {11, "FeedbackDivision", "Feedback division", 0.0, 9.0, 3.0, 2.0, 4.0, -70.0},
    {12, "FeedbackModifier", "Feedback modifier", 0.0, 2.0, 0.0, 0.0, 1.0, -70.0},
    {13, "LoopLowpass", "Loop LP", 200.0, 20000.0, 6000.0, 300.0, 20000.0, -70.0},
    {14, "LoopHighpass", "Loop HP", 20.0, 2000.0, 90.0, 20.0, 2000.0, -70.0},
    {15, "Drive", "Drive", 0.0, 100.0, 20.0, 0.0, 100.0, -70.0},
    {16, "Character", "Character", 0.0, 2.0, 1.0, 0.0, 2.0, -70.0},
    {17, "TimeChange", "Time change", 0.0, 2.0, 1.0, 0.0, 2.0, -70.0},
    {18, "Smear", "Smear", 0.0, 100.0, 0.0, 0.0, 100.0, -70.0},
    {19, "Ducking", "Ducking", 0.0, 100.0, 0.0, 0.0, 100.0, -70.0},
    {20, "Width", "Width", 0.0, 200.0, 100.0, 0.0, 200.0, -70.0},
    {21, "OutputTrim", "Output trim", -24.0, 24.0, 0.0, -24.0, 24.0, -70.0},
    {22, "Quality", "Quality", 0.0, 2.0, 2.0, 0.0, 2.0, -70.0},
    {23, "Bypass", "Bypass", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {24, "Wear", "Wear", 0.0, 3.0, 1.0, 0.0, 3.0, -70.0},
    {25, "Bias", "Bias", 0.0, 100.0, 30.0, 0.0, 100.0, -70.0},
    {26, "Age", "Age", 0.0, 100.0, 20.0, 0.0, 100.0, -70.0},
    {27, "Stages", "Stages", 0.0, 2.0, 2.0, 0.0, 2.0, -70.0},
    {28, "ClockWhine", "Clock whine", 0.0, 1.0, 1.0, 0.0, 1.0, -90.0},
    {100, "Tap1Time", "Tap1 time", 1.0, 8000.0, 250.0, 50.0, 1500.0, -70.0},
    {101, "Tap1Division", "Tap1 division", 0.0, 9.0, 3.0, 2.0, 4.0, -70.0},
    {102, "Tap1Modifier", "Tap1 modifier", 0.0, 2.0, 0.0, 0.0, 1.0, -70.0},
    {104, "Tap1Level", "Tap1 level", -60.0, 6.0, 0.0, -60.0, 6.0, -70.0},
    {105, "Tap1Pan", "Tap1 pan", -100.0, 100.0, -30.0, -100.0, 100.0, -70.0},
    {106, "Tap1Pitch", "Tap1 pitch", -24.0, 24.0, 0.0, -12.0, 12.0, -70.0},
    {107, "Tap1Fine", "Tap1 fine", -50.0, 50.0, 0.0, -50.0, 50.0, -70.0},
    {108, "Tap1Filter", "Tap1 filter", 0.0, 3.0, 0.0, 0.0, 1.0, -70.0},
    {109, "Tap1Cutoff", "Tap1 cutoff", 20.0, 20000.0, 20000.0, 200.0, 20000.0, -70.0},
    {110, "Tap1Q", "Tap1 Q", 0.5, 8.0, 0.707, 0.5, 8.0, -70.0},
    {111, "Tap1Reverse", "Tap1 reverse", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {112, "Tap1Mute", "Tap1 mute", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {113, "Tap1Solo", "Tap1 solo", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {120, "Tap2Time", "Tap2 time", 1.0, 8000.0, 500.0, 50.0, 1500.0, -70.0},
    {121, "Tap2Division", "Tap2 division", 0.0, 9.0, 4.0, 2.0, 4.0, -70.0},
    {122, "Tap2Modifier", "Tap2 modifier", 0.0, 2.0, 0.0, 0.0, 1.0, -70.0},
    {123, "Tap2Ratio", "Tap2 ratio", 0.0, 10.0, 0.0, 1.0, 9.0, -70.0},
    {124, "Tap2Level", "Tap2 level", -60.0, 6.0, 0.0, -60.0, 6.0, -70.0},
    {125, "Tap2Pan", "Tap2 pan", -100.0, 100.0, 30.0, -100.0, 100.0, -70.0},
    {126, "Tap2Pitch", "Tap2 pitch", -24.0, 24.0, 0.0, -12.0, 12.0, -70.0},
    {127, "Tap2Fine", "Tap2 fine", -50.0, 50.0, 0.0, -50.0, 50.0, -70.0},
    {128, "Tap2Filter", "Tap2 filter", 0.0, 3.0, 0.0, 0.0, 1.0, -70.0},
    {129, "Tap2Cutoff", "Tap2 cutoff", 20.0, 20000.0, 20000.0, 200.0, 20000.0, -70.0},
    {130, "Tap2Q", "Tap2 Q", 0.5, 8.0, 0.707, 0.5, 8.0, -70.0},
    {131, "Tap2Reverse", "Tap2 reverse", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {132, "Tap2Mute", "Tap2 mute", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {133, "Tap2Solo", "Tap2 solo", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {140, "Tap3Time", "Tap3 time", 1.0, 8000.0, 750.0, 50.0, 1500.0, -70.0},
    {141, "Tap3Division", "Tap3 division", 0.0, 9.0, 4.0, 2.0, 4.0, -70.0},
    {142, "Tap3Modifier", "Tap3 modifier", 0.0, 2.0, 1.0, 0.0, 1.0, -70.0},
    {143, "Tap3Ratio", "Tap3 ratio", 0.0, 10.0, 0.0, 1.0, 9.0, -70.0},
    {144, "Tap3Level", "Tap3 level", -60.0, 6.0, 0.0, -60.0, 6.0, -70.0},
    {145, "Tap3Pan", "Tap3 pan", -100.0, 100.0, -60.0, -100.0, 100.0, -70.0},
    {146, "Tap3Pitch", "Tap3 pitch", -24.0, 24.0, 0.0, -12.0, 12.0, -70.0},
    {147, "Tap3Fine", "Tap3 fine", -50.0, 50.0, 0.0, -50.0, 50.0, -70.0},
    {148, "Tap3Filter", "Tap3 filter", 0.0, 3.0, 0.0, 0.0, 1.0, -70.0},
    {149, "Tap3Cutoff", "Tap3 cutoff", 20.0, 20000.0, 20000.0, 200.0, 20000.0, -70.0},
    {150, "Tap3Q", "Tap3 Q", 0.5, 8.0, 0.707, 0.5, 8.0, -70.0},
    {151, "Tap3Reverse", "Tap3 reverse", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {152, "Tap3Mute", "Tap3 mute", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {153, "Tap3Solo", "Tap3 solo", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {160, "Tap4Time", "Tap4 time", 1.0, 8000.0, 1000.0, 50.0, 1500.0, -70.0},
    {161, "Tap4Division", "Tap4 division", 0.0, 9.0, 5.0, 2.0, 4.0, -70.0},
    {162, "Tap4Modifier", "Tap4 modifier", 0.0, 2.0, 0.0, 0.0, 1.0, -70.0},
    {163, "Tap4Ratio", "Tap4 ratio", 0.0, 10.0, 0.0, 1.0, 9.0, -70.0},
    {164, "Tap4Level", "Tap4 level", -60.0, 6.0, 0.0, -60.0, 6.0, -70.0},
    {165, "Tap4Pan", "Tap4 pan", -100.0, 100.0, 60.0, -100.0, 100.0, -70.0},
    {166, "Tap4Pitch", "Tap4 pitch", -24.0, 24.0, 0.0, -12.0, 12.0, -70.0},
    {167, "Tap4Fine", "Tap4 fine", -50.0, 50.0, 0.0, -50.0, 50.0, -70.0},
    {168, "Tap4Filter", "Tap4 filter", 0.0, 3.0, 0.0, 0.0, 1.0, -70.0},
    {169, "Tap4Cutoff", "Tap4 cutoff", 20.0, 20000.0, 20000.0, 200.0, 20000.0, -70.0},
    {170, "Tap4Q", "Tap4 Q", 0.5, 8.0, 0.707, 0.5, 8.0, -70.0},
    {171, "Tap4Reverse", "Tap4 reverse", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {172, "Tap4Mute", "Tap4 mute", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {173, "Tap4Solo", "Tap4 solo", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {180, "Tap5Time", "Tap5 time", 1.0, 8000.0, 1250.0, 50.0, 1500.0, -70.0},
    {181, "Tap5Division", "Tap5 division", 0.0, 9.0, 5.0, 2.0, 4.0, -70.0},
    {182, "Tap5Modifier", "Tap5 modifier", 0.0, 2.0, 1.0, 0.0, 1.0, -70.0},
    {183, "Tap5Ratio", "Tap5 ratio", 0.0, 10.0, 0.0, 1.0, 9.0, -70.0},
    {184, "Tap5Level", "Tap5 level", -60.0, 6.0, 0.0, -60.0, 6.0, -70.0},
    {185, "Tap5Pan", "Tap5 pan", -100.0, 100.0, -15.0, -100.0, 100.0, -70.0},
    {186, "Tap5Pitch", "Tap5 pitch", -24.0, 24.0, 0.0, -12.0, 12.0, -70.0},
    {187, "Tap5Fine", "Tap5 fine", -50.0, 50.0, 0.0, -50.0, 50.0, -70.0},
    {188, "Tap5Filter", "Tap5 filter", 0.0, 3.0, 0.0, 0.0, 1.0, -70.0},
    {189, "Tap5Cutoff", "Tap5 cutoff", 20.0, 20000.0, 20000.0, 200.0, 20000.0, -70.0},
    {190, "Tap5Q", "Tap5 Q", 0.5, 8.0, 0.707, 0.5, 8.0, -70.0},
    {191, "Tap5Reverse", "Tap5 reverse", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {192, "Tap5Mute", "Tap5 mute", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {193, "Tap5Solo", "Tap5 solo", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {200, "Tap6Time", "Tap6 time", 1.0, 8000.0, 1500.0, 50.0, 1500.0, -70.0},
    {201, "Tap6Division", "Tap6 division", 0.0, 9.0, 6.0, 2.0, 4.0, -70.0},
    {202, "Tap6Modifier", "Tap6 modifier", 0.0, 2.0, 0.0, 0.0, 1.0, -70.0},
    {203, "Tap6Ratio", "Tap6 ratio", 0.0, 10.0, 0.0, 1.0, 9.0, -70.0},
    {204, "Tap6Level", "Tap6 level", -60.0, 6.0, 0.0, -60.0, 6.0, -70.0},
    {205, "Tap6Pan", "Tap6 pan", -100.0, 100.0, 15.0, -100.0, 100.0, -70.0},
    {206, "Tap6Pitch", "Tap6 pitch", -24.0, 24.0, 0.0, -12.0, 12.0, -70.0},
    {207, "Tap6Fine", "Tap6 fine", -50.0, 50.0, 0.0, -50.0, 50.0, -70.0},
    {208, "Tap6Filter", "Tap6 filter", 0.0, 3.0, 0.0, 0.0, 1.0, -70.0},
    {209, "Tap6Cutoff", "Tap6 cutoff", 20.0, 20000.0, 20000.0, 200.0, 20000.0, -70.0},
    {210, "Tap6Q", "Tap6 Q", 0.5, 8.0, 0.707, 0.5, 8.0, -70.0},
    {211, "Tap6Reverse", "Tap6 reverse", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {212, "Tap6Mute", "Tap6 mute", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {213, "Tap6Solo", "Tap6 solo", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {220, "Tap7Time", "Tap7 time", 1.0, 8000.0, 1750.0, 50.0, 1500.0, -70.0},
    {221, "Tap7Division", "Tap7 division", 0.0, 9.0, 6.0, 2.0, 4.0, -70.0},
    {222, "Tap7Modifier", "Tap7 modifier", 0.0, 2.0, 1.0, 0.0, 1.0, -70.0},
    {223, "Tap7Ratio", "Tap7 ratio", 0.0, 10.0, 0.0, 1.0, 9.0, -70.0},
    {224, "Tap7Level", "Tap7 level", -60.0, 6.0, 0.0, -60.0, 6.0, -70.0},
    {225, "Tap7Pan", "Tap7 pan", -100.0, 100.0, -45.0, -100.0, 100.0, -70.0},
    {226, "Tap7Pitch", "Tap7 pitch", -24.0, 24.0, 0.0, -12.0, 12.0, -70.0},
    {227, "Tap7Fine", "Tap7 fine", -50.0, 50.0, 0.0, -50.0, 50.0, -70.0},
    {228, "Tap7Filter", "Tap7 filter", 0.0, 3.0, 0.0, 0.0, 1.0, -70.0},
    {229, "Tap7Cutoff", "Tap7 cutoff", 20.0, 20000.0, 20000.0, 200.0, 20000.0, -70.0},
    {230, "Tap7Q", "Tap7 Q", 0.5, 8.0, 0.707, 0.5, 8.0, -70.0},
    {231, "Tap7Reverse", "Tap7 reverse", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {232, "Tap7Mute", "Tap7 mute", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {233, "Tap7Solo", "Tap7 solo", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {240, "Tap8Time", "Tap8 time", 1.0, 8000.0, 2000.0, 50.0, 1500.0, -70.0},
    {241, "Tap8Division", "Tap8 division", 0.0, 9.0, 7.0, 2.0, 4.0, -70.0},
    {242, "Tap8Modifier", "Tap8 modifier", 0.0, 2.0, 0.0, 0.0, 1.0, -70.0},
    {243, "Tap8Ratio", "Tap8 ratio", 0.0, 10.0, 0.0, 1.0, 9.0, -70.0},
    {244, "Tap8Level", "Tap8 level", -60.0, 6.0, 0.0, -60.0, 6.0, -70.0},
    {245, "Tap8Pan", "Tap8 pan", -100.0, 100.0, 45.0, -100.0, 100.0, -70.0},
    {246, "Tap8Pitch", "Tap8 pitch", -24.0, 24.0, 0.0, -12.0, 12.0, -70.0},
    {247, "Tap8Fine", "Tap8 fine", -50.0, 50.0, 0.0, -50.0, 50.0, -70.0},
    {248, "Tap8Filter", "Tap8 filter", 0.0, 3.0, 0.0, 0.0, 1.0, -70.0},
    {249, "Tap8Cutoff", "Tap8 cutoff", 20.0, 20000.0, 20000.0, 200.0, 20000.0, -70.0},
    {250, "Tap8Q", "Tap8 Q", 0.5, 8.0, 0.707, 0.5, 8.0, -70.0},
    {251, "Tap8Reverse", "Tap8 reverse", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {252, "Tap8Mute", "Tap8 mute", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {253, "Tap8Solo", "Tap8 solo", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
};

/**
 * Route one parameter into the unit.
 *
 * Generated, which is the point: this switch and the TypeScript control table
 * are the same list, so a control naming no parameter does not compile and a
 * parameter with no control cannot be declared.
 */
inline void applyGranularDelayParam(GranularDelay& u, int id, double v) noexcept {
  switch (static_cast<GranularDelayParam>(id)) {
    case GranularDelayParam::Mix: {
      // Zero must null exactly, which §9 V1 measures at −140 dBFS.
      u.setMix(v * 0.01);
      break;
    }
    case GranularDelayParam::Topology: {
      // Selects the 2×2 routing matrix M of §1.2. Ping-pong is a matrix setting, not a special
      // case, which is what V13 grades.
      u.setTopology(static_cast<delay::Topology>(static_cast<int>(v + 0.5)));
      break;
    }
    case GranularDelayParam::Cross: {
      // c in the Blend matrix; 50 % gives one shared feedback time for both sides. Acts in Blend
      // only.
      u.setCross(v * 0.01);
      break;
    }
    case GranularDelayParam::TapCount: {
      // Four by default: three or four playback heads is what the multi-head tape echoes had, §1.1.
      u.setTapCount(static_cast<int>(v + 0.5) + 1);
      break;
    }
    case GranularDelayParam::Sync: {
      // On, each tap and the feedback read take a division; off, they take milliseconds.
      u.setSync(v > 0.5);
      break;
    }
    case GranularDelayParam::TimeMode: {
      // §5: absolute gives each tap its own time; relative makes taps 2–8 multiples of the first,
      // by the spacing or by each tap’s own ratio.
      u.setTimeMode(static_cast<delay::TimeMode>(static_cast<int>(v + 0.5)));
      break;
    }
    case GranularDelayParam::Spacing: {
      // §5’s head-spacing presets. Acts in Relative mode, on taps whose ratio is Auto.
      u.setSpacing(static_cast<delay::Spacing>(static_cast<int>(v + 0.5)));
      break;
    }
    case GranularDelayParam::Feedback: {
      // Past 100 % is safe only because the loop saturator’s drive is floored there (§3.2); the
      // runaway sits at a level rather than exploding.
      u.setFeedback(v * 0.01);
      break;
    }
    case GranularDelayParam::FeedbackSource: {
      // §3.2(c): the loop’s read is its own, not the sum of the taps. Longest tap is the documented
      // variant.
      u.setFeedbackSource(static_cast<FeedbackSource>(static_cast<int>(v + 0.5)));
      break;
    }
    case GranularDelayParam::FeedbackTime: {
      // Used when Sync is off and the source is Dedicated.
      u.setFeedbackTapSeconds(v * 0.001);
      break;
    }
    case GranularDelayParam::FeedbackDivision: {
      // Used when Sync is on and the source is Dedicated.
      u.setFeedbackDivision(static_cast<delay::Division>(static_cast<int>(v + 0.5)));
      break;
    }
    case GranularDelayParam::FeedbackModifier: {
      u.setFeedbackModifier(static_cast<delay::Modifier>(static_cast<int>(v + 0.5)));
      break;
    }
    case GranularDelayParam::LoopLowpass: {
      // A one-pole, so its peak gain is unity and §3.2(a)’s condition holds without compensation.
      u.setLoopLowpass(v);
      break;
    }
    case GranularDelayParam::LoopHighpass: {
      u.setLoopHighpass(v);
      break;
    }
    case GranularDelayParam::Drive: {
      // 0–100 % onto a tanh drive of 1–12, and floored above 100 % feedback whatever this says.
      u.setDrive(1.0 + v * 0.11);
      break;
    }
    case GranularDelayParam::Character: {
      // Selects §6’s block. Tape by default, which is §9.1’s default case; Clean is the identity on
      // both halves, which is what V2 depends on.
      u.setCharacter(static_cast<delay::Character>(static_cast<int>(v + 0.5)));
      break;
    }
    case GranularDelayParam::TimeChange: {
      // §6.2: Tape bends the pitch through the transport, Digital crossfades two heads over 20 ms,
      // Instant jumps.
      u.setTimeChangeMode(static_cast<delay::TimeChangeMode>(static_cast<int>(v + 0.5)));
      break;
    }
    case GranularDelayParam::Smear: {
      // §4’s one control: grains per tap, spray, onset jitter and grain length together. Zero must
      // null against a plain delay (V2).
      u.setSmear(v * 0.01);
      break;
    }
    case GranularDelayParam::Ducking: {
      u.setDucking(v * 0.01);
      break;
    }
    case GranularDelayParam::Width: {
      u.setWidth(v * 0.01);
      break;
    }
    case GranularDelayParam::OutputTrim: {
      u.setOutputTrimDb(v);
      break;
    }
    case GranularDelayParam::Quality: {
      // Defaults to High rather than the sheet’s Normal: the grain pool was sized against
      // thirty-two streams per tap at full Smear, which Normal’s cap clips at exactly the setting
      // §4 calls ordinary. Recorded in the ledger.
      u.setQuality(static_cast<delay::Quality>(static_cast<int>(v + 0.5)));
      break;
    }
    case GranularDelayParam::Bypass: {
      // A bypassed unit is still in circuit and still meters.
      u.setBypass(v > 0.5);
      break;
    }
    case GranularDelayParam::Wear: {
      // §6.1’s wow and flutter presets, graded by V9 in weighted RMS. Acts on Tape.
      u.setWear(static_cast<delay::Wear>(static_cast<int>(v + 0.5)));
      break;
    }
    case GranularDelayParam::Bias: {
      // Headroom, repeat level and top end all fall as it rises, §6.3 — which is what makes it a
      // control distinct from Drive. Acts on Tape.
      u.setBias(v * 0.01);
      break;
    }
    case GranularDelayParam::Age: {
      // Older tape has lower bandwidth and a warmer top, §6.3. Acts on Tape.
      u.setAge(v * 0.01);
      break;
    }
    case GranularDelayParam::Stages: {
      // Sets the clock a delay time needs, and so how dark the line gets at long times (§6.4, V11).
      // Acts on BBD.
      u.setBbdStages(static_cast<int>(v + 0.5));
      break;
    }
    case GranularDelayParam::ClockWhine: {
      // Residual clock at f_clk, −78 dBFS by design (§6.4, §11). Under the −70 dB delta gate on
      // purpose, so the gate is lowered for this row rather than the level raised.
      u.setClockWhine(v > 0.5);
      break;
    }
    case GranularDelayParam::Tap1Time: {
      { TapSettings t = u.tap(0); t.delaySeconds = v * 0.001; u.setTap(0, t); }
      break;
    }
    case GranularDelayParam::Tap1Division: {
      { TapSettings t = u.tap(0); t.division = static_cast<delay::Division>(static_cast<int>(v + 0.5)); u.setTap(0, t); }
      break;
    }
    case GranularDelayParam::Tap1Modifier: {
      { TapSettings t = u.tap(0); t.modifier = static_cast<delay::Modifier>(static_cast<int>(v + 0.5)); u.setTap(0, t); }
      break;
    }
    case GranularDelayParam::Tap1Level: {
      // −60 is −∞: the tap is silent, and its 4 ms fade is what stops that being a click.
      { TapSettings t = u.tap(0); t.level = v <= -59.5 ? 0.0 : std::pow(10.0, v / 20.0); u.setTap(0, t); }
      break;
    }
    case GranularDelayParam::Tap1Pan: {
      { TapSettings t = u.tap(0); t.pan = v * 0.01; u.setTap(0, t); }
      break;
    }
    case GranularDelayParam::Tap1Pitch: {
      // A pitched tap is read by a grain, because a plain delay cannot shift pitch; octaves,
      // fourths and fifths are the musical set (§2).
      { TapSettings t = u.tap(0); t.pitchSemitones = v; u.setTap(0, t); }
      break;
    }
    case GranularDelayParam::Tap1Fine: {
      { TapSettings t = u.tap(0); t.fineCents = v; u.setTap(0, t); }
      break;
    }
    case GranularDelayParam::Tap1Filter: {
      { TapSettings t = u.tap(0); t.filter = static_cast<delay::TapFilter>(static_cast<int>(v + 0.5)); u.setTap(0, t); }
      break;
    }
    case GranularDelayParam::Tap1Cutoff: {
      { TapSettings t = u.tap(0); t.cutoffHz = v; u.setTap(0, t); }
      break;
    }
    case GranularDelayParam::Tap1Q: {
      // Per tap only, not in the loop, so it carries no stability constraint (§7.2).
      { TapSettings t = u.tap(0); t.q = v; u.setTap(0, t); }
      break;
    }
    case GranularDelayParam::Tap1Reverse: {
      // Reverse is only coherent with a grain to reverse within, so it forces a grain of at least
      // 30 ms (§2).
      { TapSettings t = u.tap(0); t.reverse = v > 0.5; u.setTap(0, t); }
      break;
    }
    case GranularDelayParam::Tap1Mute: {
      { TapSettings t = u.tap(0); t.muted = v > 0.5; u.setTap(0, t); }
      break;
    }
    case GranularDelayParam::Tap1Solo: {
      { TapSettings t = u.tap(0); t.solo = v > 0.5; u.setTap(0, t); }
      break;
    }
    case GranularDelayParam::Tap2Time: {
      { TapSettings t = u.tap(1); t.delaySeconds = v * 0.001; u.setTap(1, t); }
      break;
    }
    case GranularDelayParam::Tap2Division: {
      { TapSettings t = u.tap(1); t.division = static_cast<delay::Division>(static_cast<int>(v + 0.5)); u.setTap(1, t); }
      break;
    }
    case GranularDelayParam::Tap2Modifier: {
      { TapSettings t = u.tap(1); t.modifier = static_cast<delay::Modifier>(static_cast<int>(v + 0.5)); u.setTap(1, t); }
      break;
    }
    case GranularDelayParam::Tap2Ratio: {
      { TapSettings t = u.tap(1); t.ratioStep = static_cast<int>(v + 0.5) - 1; u.setTap(1, t); }
      break;
    }
    case GranularDelayParam::Tap2Level: {
      // −60 is −∞: the tap is silent, and its 4 ms fade is what stops that being a click.
      { TapSettings t = u.tap(1); t.level = v <= -59.5 ? 0.0 : std::pow(10.0, v / 20.0); u.setTap(1, t); }
      break;
    }
    case GranularDelayParam::Tap2Pan: {
      { TapSettings t = u.tap(1); t.pan = v * 0.01; u.setTap(1, t); }
      break;
    }
    case GranularDelayParam::Tap2Pitch: {
      // A pitched tap is read by a grain, because a plain delay cannot shift pitch; octaves,
      // fourths and fifths are the musical set (§2).
      { TapSettings t = u.tap(1); t.pitchSemitones = v; u.setTap(1, t); }
      break;
    }
    case GranularDelayParam::Tap2Fine: {
      { TapSettings t = u.tap(1); t.fineCents = v; u.setTap(1, t); }
      break;
    }
    case GranularDelayParam::Tap2Filter: {
      { TapSettings t = u.tap(1); t.filter = static_cast<delay::TapFilter>(static_cast<int>(v + 0.5)); u.setTap(1, t); }
      break;
    }
    case GranularDelayParam::Tap2Cutoff: {
      { TapSettings t = u.tap(1); t.cutoffHz = v; u.setTap(1, t); }
      break;
    }
    case GranularDelayParam::Tap2Q: {
      // Per tap only, not in the loop, so it carries no stability constraint (§7.2).
      { TapSettings t = u.tap(1); t.q = v; u.setTap(1, t); }
      break;
    }
    case GranularDelayParam::Tap2Reverse: {
      // Reverse is only coherent with a grain to reverse within, so it forces a grain of at least
      // 30 ms (§2).
      { TapSettings t = u.tap(1); t.reverse = v > 0.5; u.setTap(1, t); }
      break;
    }
    case GranularDelayParam::Tap2Mute: {
      { TapSettings t = u.tap(1); t.muted = v > 0.5; u.setTap(1, t); }
      break;
    }
    case GranularDelayParam::Tap2Solo: {
      { TapSettings t = u.tap(1); t.solo = v > 0.5; u.setTap(1, t); }
      break;
    }
    case GranularDelayParam::Tap3Time: {
      { TapSettings t = u.tap(2); t.delaySeconds = v * 0.001; u.setTap(2, t); }
      break;
    }
    case GranularDelayParam::Tap3Division: {
      { TapSettings t = u.tap(2); t.division = static_cast<delay::Division>(static_cast<int>(v + 0.5)); u.setTap(2, t); }
      break;
    }
    case GranularDelayParam::Tap3Modifier: {
      { TapSettings t = u.tap(2); t.modifier = static_cast<delay::Modifier>(static_cast<int>(v + 0.5)); u.setTap(2, t); }
      break;
    }
    case GranularDelayParam::Tap3Ratio: {
      { TapSettings t = u.tap(2); t.ratioStep = static_cast<int>(v + 0.5) - 1; u.setTap(2, t); }
      break;
    }
    case GranularDelayParam::Tap3Level: {
      // −60 is −∞: the tap is silent, and its 4 ms fade is what stops that being a click.
      { TapSettings t = u.tap(2); t.level = v <= -59.5 ? 0.0 : std::pow(10.0, v / 20.0); u.setTap(2, t); }
      break;
    }
    case GranularDelayParam::Tap3Pan: {
      { TapSettings t = u.tap(2); t.pan = v * 0.01; u.setTap(2, t); }
      break;
    }
    case GranularDelayParam::Tap3Pitch: {
      // A pitched tap is read by a grain, because a plain delay cannot shift pitch; octaves,
      // fourths and fifths are the musical set (§2).
      { TapSettings t = u.tap(2); t.pitchSemitones = v; u.setTap(2, t); }
      break;
    }
    case GranularDelayParam::Tap3Fine: {
      { TapSettings t = u.tap(2); t.fineCents = v; u.setTap(2, t); }
      break;
    }
    case GranularDelayParam::Tap3Filter: {
      { TapSettings t = u.tap(2); t.filter = static_cast<delay::TapFilter>(static_cast<int>(v + 0.5)); u.setTap(2, t); }
      break;
    }
    case GranularDelayParam::Tap3Cutoff: {
      { TapSettings t = u.tap(2); t.cutoffHz = v; u.setTap(2, t); }
      break;
    }
    case GranularDelayParam::Tap3Q: {
      // Per tap only, not in the loop, so it carries no stability constraint (§7.2).
      { TapSettings t = u.tap(2); t.q = v; u.setTap(2, t); }
      break;
    }
    case GranularDelayParam::Tap3Reverse: {
      // Reverse is only coherent with a grain to reverse within, so it forces a grain of at least
      // 30 ms (§2).
      { TapSettings t = u.tap(2); t.reverse = v > 0.5; u.setTap(2, t); }
      break;
    }
    case GranularDelayParam::Tap3Mute: {
      { TapSettings t = u.tap(2); t.muted = v > 0.5; u.setTap(2, t); }
      break;
    }
    case GranularDelayParam::Tap3Solo: {
      { TapSettings t = u.tap(2); t.solo = v > 0.5; u.setTap(2, t); }
      break;
    }
    case GranularDelayParam::Tap4Time: {
      { TapSettings t = u.tap(3); t.delaySeconds = v * 0.001; u.setTap(3, t); }
      break;
    }
    case GranularDelayParam::Tap4Division: {
      { TapSettings t = u.tap(3); t.division = static_cast<delay::Division>(static_cast<int>(v + 0.5)); u.setTap(3, t); }
      break;
    }
    case GranularDelayParam::Tap4Modifier: {
      { TapSettings t = u.tap(3); t.modifier = static_cast<delay::Modifier>(static_cast<int>(v + 0.5)); u.setTap(3, t); }
      break;
    }
    case GranularDelayParam::Tap4Ratio: {
      { TapSettings t = u.tap(3); t.ratioStep = static_cast<int>(v + 0.5) - 1; u.setTap(3, t); }
      break;
    }
    case GranularDelayParam::Tap4Level: {
      // −60 is −∞: the tap is silent, and its 4 ms fade is what stops that being a click.
      { TapSettings t = u.tap(3); t.level = v <= -59.5 ? 0.0 : std::pow(10.0, v / 20.0); u.setTap(3, t); }
      break;
    }
    case GranularDelayParam::Tap4Pan: {
      { TapSettings t = u.tap(3); t.pan = v * 0.01; u.setTap(3, t); }
      break;
    }
    case GranularDelayParam::Tap4Pitch: {
      // A pitched tap is read by a grain, because a plain delay cannot shift pitch; octaves,
      // fourths and fifths are the musical set (§2).
      { TapSettings t = u.tap(3); t.pitchSemitones = v; u.setTap(3, t); }
      break;
    }
    case GranularDelayParam::Tap4Fine: {
      { TapSettings t = u.tap(3); t.fineCents = v; u.setTap(3, t); }
      break;
    }
    case GranularDelayParam::Tap4Filter: {
      { TapSettings t = u.tap(3); t.filter = static_cast<delay::TapFilter>(static_cast<int>(v + 0.5)); u.setTap(3, t); }
      break;
    }
    case GranularDelayParam::Tap4Cutoff: {
      { TapSettings t = u.tap(3); t.cutoffHz = v; u.setTap(3, t); }
      break;
    }
    case GranularDelayParam::Tap4Q: {
      // Per tap only, not in the loop, so it carries no stability constraint (§7.2).
      { TapSettings t = u.tap(3); t.q = v; u.setTap(3, t); }
      break;
    }
    case GranularDelayParam::Tap4Reverse: {
      // Reverse is only coherent with a grain to reverse within, so it forces a grain of at least
      // 30 ms (§2).
      { TapSettings t = u.tap(3); t.reverse = v > 0.5; u.setTap(3, t); }
      break;
    }
    case GranularDelayParam::Tap4Mute: {
      { TapSettings t = u.tap(3); t.muted = v > 0.5; u.setTap(3, t); }
      break;
    }
    case GranularDelayParam::Tap4Solo: {
      { TapSettings t = u.tap(3); t.solo = v > 0.5; u.setTap(3, t); }
      break;
    }
    case GranularDelayParam::Tap5Time: {
      { TapSettings t = u.tap(4); t.delaySeconds = v * 0.001; u.setTap(4, t); }
      break;
    }
    case GranularDelayParam::Tap5Division: {
      { TapSettings t = u.tap(4); t.division = static_cast<delay::Division>(static_cast<int>(v + 0.5)); u.setTap(4, t); }
      break;
    }
    case GranularDelayParam::Tap5Modifier: {
      { TapSettings t = u.tap(4); t.modifier = static_cast<delay::Modifier>(static_cast<int>(v + 0.5)); u.setTap(4, t); }
      break;
    }
    case GranularDelayParam::Tap5Ratio: {
      { TapSettings t = u.tap(4); t.ratioStep = static_cast<int>(v + 0.5) - 1; u.setTap(4, t); }
      break;
    }
    case GranularDelayParam::Tap5Level: {
      // −60 is −∞: the tap is silent, and its 4 ms fade is what stops that being a click.
      { TapSettings t = u.tap(4); t.level = v <= -59.5 ? 0.0 : std::pow(10.0, v / 20.0); u.setTap(4, t); }
      break;
    }
    case GranularDelayParam::Tap5Pan: {
      { TapSettings t = u.tap(4); t.pan = v * 0.01; u.setTap(4, t); }
      break;
    }
    case GranularDelayParam::Tap5Pitch: {
      // A pitched tap is read by a grain, because a plain delay cannot shift pitch; octaves,
      // fourths and fifths are the musical set (§2).
      { TapSettings t = u.tap(4); t.pitchSemitones = v; u.setTap(4, t); }
      break;
    }
    case GranularDelayParam::Tap5Fine: {
      { TapSettings t = u.tap(4); t.fineCents = v; u.setTap(4, t); }
      break;
    }
    case GranularDelayParam::Tap5Filter: {
      { TapSettings t = u.tap(4); t.filter = static_cast<delay::TapFilter>(static_cast<int>(v + 0.5)); u.setTap(4, t); }
      break;
    }
    case GranularDelayParam::Tap5Cutoff: {
      { TapSettings t = u.tap(4); t.cutoffHz = v; u.setTap(4, t); }
      break;
    }
    case GranularDelayParam::Tap5Q: {
      // Per tap only, not in the loop, so it carries no stability constraint (§7.2).
      { TapSettings t = u.tap(4); t.q = v; u.setTap(4, t); }
      break;
    }
    case GranularDelayParam::Tap5Reverse: {
      // Reverse is only coherent with a grain to reverse within, so it forces a grain of at least
      // 30 ms (§2).
      { TapSettings t = u.tap(4); t.reverse = v > 0.5; u.setTap(4, t); }
      break;
    }
    case GranularDelayParam::Tap5Mute: {
      { TapSettings t = u.tap(4); t.muted = v > 0.5; u.setTap(4, t); }
      break;
    }
    case GranularDelayParam::Tap5Solo: {
      { TapSettings t = u.tap(4); t.solo = v > 0.5; u.setTap(4, t); }
      break;
    }
    case GranularDelayParam::Tap6Time: {
      { TapSettings t = u.tap(5); t.delaySeconds = v * 0.001; u.setTap(5, t); }
      break;
    }
    case GranularDelayParam::Tap6Division: {
      { TapSettings t = u.tap(5); t.division = static_cast<delay::Division>(static_cast<int>(v + 0.5)); u.setTap(5, t); }
      break;
    }
    case GranularDelayParam::Tap6Modifier: {
      { TapSettings t = u.tap(5); t.modifier = static_cast<delay::Modifier>(static_cast<int>(v + 0.5)); u.setTap(5, t); }
      break;
    }
    case GranularDelayParam::Tap6Ratio: {
      { TapSettings t = u.tap(5); t.ratioStep = static_cast<int>(v + 0.5) - 1; u.setTap(5, t); }
      break;
    }
    case GranularDelayParam::Tap6Level: {
      // −60 is −∞: the tap is silent, and its 4 ms fade is what stops that being a click.
      { TapSettings t = u.tap(5); t.level = v <= -59.5 ? 0.0 : std::pow(10.0, v / 20.0); u.setTap(5, t); }
      break;
    }
    case GranularDelayParam::Tap6Pan: {
      { TapSettings t = u.tap(5); t.pan = v * 0.01; u.setTap(5, t); }
      break;
    }
    case GranularDelayParam::Tap6Pitch: {
      // A pitched tap is read by a grain, because a plain delay cannot shift pitch; octaves,
      // fourths and fifths are the musical set (§2).
      { TapSettings t = u.tap(5); t.pitchSemitones = v; u.setTap(5, t); }
      break;
    }
    case GranularDelayParam::Tap6Fine: {
      { TapSettings t = u.tap(5); t.fineCents = v; u.setTap(5, t); }
      break;
    }
    case GranularDelayParam::Tap6Filter: {
      { TapSettings t = u.tap(5); t.filter = static_cast<delay::TapFilter>(static_cast<int>(v + 0.5)); u.setTap(5, t); }
      break;
    }
    case GranularDelayParam::Tap6Cutoff: {
      { TapSettings t = u.tap(5); t.cutoffHz = v; u.setTap(5, t); }
      break;
    }
    case GranularDelayParam::Tap6Q: {
      // Per tap only, not in the loop, so it carries no stability constraint (§7.2).
      { TapSettings t = u.tap(5); t.q = v; u.setTap(5, t); }
      break;
    }
    case GranularDelayParam::Tap6Reverse: {
      // Reverse is only coherent with a grain to reverse within, so it forces a grain of at least
      // 30 ms (§2).
      { TapSettings t = u.tap(5); t.reverse = v > 0.5; u.setTap(5, t); }
      break;
    }
    case GranularDelayParam::Tap6Mute: {
      { TapSettings t = u.tap(5); t.muted = v > 0.5; u.setTap(5, t); }
      break;
    }
    case GranularDelayParam::Tap6Solo: {
      { TapSettings t = u.tap(5); t.solo = v > 0.5; u.setTap(5, t); }
      break;
    }
    case GranularDelayParam::Tap7Time: {
      { TapSettings t = u.tap(6); t.delaySeconds = v * 0.001; u.setTap(6, t); }
      break;
    }
    case GranularDelayParam::Tap7Division: {
      { TapSettings t = u.tap(6); t.division = static_cast<delay::Division>(static_cast<int>(v + 0.5)); u.setTap(6, t); }
      break;
    }
    case GranularDelayParam::Tap7Modifier: {
      { TapSettings t = u.tap(6); t.modifier = static_cast<delay::Modifier>(static_cast<int>(v + 0.5)); u.setTap(6, t); }
      break;
    }
    case GranularDelayParam::Tap7Ratio: {
      { TapSettings t = u.tap(6); t.ratioStep = static_cast<int>(v + 0.5) - 1; u.setTap(6, t); }
      break;
    }
    case GranularDelayParam::Tap7Level: {
      // −60 is −∞: the tap is silent, and its 4 ms fade is what stops that being a click.
      { TapSettings t = u.tap(6); t.level = v <= -59.5 ? 0.0 : std::pow(10.0, v / 20.0); u.setTap(6, t); }
      break;
    }
    case GranularDelayParam::Tap7Pan: {
      { TapSettings t = u.tap(6); t.pan = v * 0.01; u.setTap(6, t); }
      break;
    }
    case GranularDelayParam::Tap7Pitch: {
      // A pitched tap is read by a grain, because a plain delay cannot shift pitch; octaves,
      // fourths and fifths are the musical set (§2).
      { TapSettings t = u.tap(6); t.pitchSemitones = v; u.setTap(6, t); }
      break;
    }
    case GranularDelayParam::Tap7Fine: {
      { TapSettings t = u.tap(6); t.fineCents = v; u.setTap(6, t); }
      break;
    }
    case GranularDelayParam::Tap7Filter: {
      { TapSettings t = u.tap(6); t.filter = static_cast<delay::TapFilter>(static_cast<int>(v + 0.5)); u.setTap(6, t); }
      break;
    }
    case GranularDelayParam::Tap7Cutoff: {
      { TapSettings t = u.tap(6); t.cutoffHz = v; u.setTap(6, t); }
      break;
    }
    case GranularDelayParam::Tap7Q: {
      // Per tap only, not in the loop, so it carries no stability constraint (§7.2).
      { TapSettings t = u.tap(6); t.q = v; u.setTap(6, t); }
      break;
    }
    case GranularDelayParam::Tap7Reverse: {
      // Reverse is only coherent with a grain to reverse within, so it forces a grain of at least
      // 30 ms (§2).
      { TapSettings t = u.tap(6); t.reverse = v > 0.5; u.setTap(6, t); }
      break;
    }
    case GranularDelayParam::Tap7Mute: {
      { TapSettings t = u.tap(6); t.muted = v > 0.5; u.setTap(6, t); }
      break;
    }
    case GranularDelayParam::Tap7Solo: {
      { TapSettings t = u.tap(6); t.solo = v > 0.5; u.setTap(6, t); }
      break;
    }
    case GranularDelayParam::Tap8Time: {
      { TapSettings t = u.tap(7); t.delaySeconds = v * 0.001; u.setTap(7, t); }
      break;
    }
    case GranularDelayParam::Tap8Division: {
      { TapSettings t = u.tap(7); t.division = static_cast<delay::Division>(static_cast<int>(v + 0.5)); u.setTap(7, t); }
      break;
    }
    case GranularDelayParam::Tap8Modifier: {
      { TapSettings t = u.tap(7); t.modifier = static_cast<delay::Modifier>(static_cast<int>(v + 0.5)); u.setTap(7, t); }
      break;
    }
    case GranularDelayParam::Tap8Ratio: {
      { TapSettings t = u.tap(7); t.ratioStep = static_cast<int>(v + 0.5) - 1; u.setTap(7, t); }
      break;
    }
    case GranularDelayParam::Tap8Level: {
      // −60 is −∞: the tap is silent, and its 4 ms fade is what stops that being a click.
      { TapSettings t = u.tap(7); t.level = v <= -59.5 ? 0.0 : std::pow(10.0, v / 20.0); u.setTap(7, t); }
      break;
    }
    case GranularDelayParam::Tap8Pan: {
      { TapSettings t = u.tap(7); t.pan = v * 0.01; u.setTap(7, t); }
      break;
    }
    case GranularDelayParam::Tap8Pitch: {
      // A pitched tap is read by a grain, because a plain delay cannot shift pitch; octaves,
      // fourths and fifths are the musical set (§2).
      { TapSettings t = u.tap(7); t.pitchSemitones = v; u.setTap(7, t); }
      break;
    }
    case GranularDelayParam::Tap8Fine: {
      { TapSettings t = u.tap(7); t.fineCents = v; u.setTap(7, t); }
      break;
    }
    case GranularDelayParam::Tap8Filter: {
      { TapSettings t = u.tap(7); t.filter = static_cast<delay::TapFilter>(static_cast<int>(v + 0.5)); u.setTap(7, t); }
      break;
    }
    case GranularDelayParam::Tap8Cutoff: {
      { TapSettings t = u.tap(7); t.cutoffHz = v; u.setTap(7, t); }
      break;
    }
    case GranularDelayParam::Tap8Q: {
      // Per tap only, not in the loop, so it carries no stability constraint (§7.2).
      { TapSettings t = u.tap(7); t.q = v; u.setTap(7, t); }
      break;
    }
    case GranularDelayParam::Tap8Reverse: {
      // Reverse is only coherent with a grain to reverse within, so it forces a grain of at least
      // 30 ms (§2).
      { TapSettings t = u.tap(7); t.reverse = v > 0.5; u.setTap(7, t); }
      break;
    }
    case GranularDelayParam::Tap8Mute: {
      { TapSettings t = u.tap(7); t.muted = v > 0.5; u.setTap(7, t); }
      break;
    }
    case GranularDelayParam::Tap8Solo: {
      { TapSettings t = u.tap(7); t.solo = v > 0.5; u.setTap(7, t); }
      break;
    }
  }
}

}  // namespace mw::units
