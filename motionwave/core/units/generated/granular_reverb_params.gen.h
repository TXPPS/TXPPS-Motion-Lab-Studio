// GENERATED FILE — do not edit.
//
// Written by scripts/generate-params.mjs from motionwave/manifests/fx-02-granular-reverb.json.
// Edit the manifest and re-run `npm run params`. A hand edit here is exactly
// the second opinion the manifest exists to prevent, and `npm run params:check`
// fails the build if one is present.
#pragma once

#include "../granular_reverb.h"

namespace mw::units {

/**
 * The GranularReverb's parameter ids.
 *
 * Stable and never renumbered: an id is what an automation lane and a saved
 * preset name a parameter by, so renumbering one silently re-points every
 * project that automated it.
 */
enum class GranularReverbParam : int {
  Mix = 1,
  PreDelay = 2,
  Size = 3,
  MinOffset = 4,
  Decay = 5,
  Freeze = 6,
  GrainSize = 7,
  Density = 8,
  Spray = 9,
  OnsetJitter = 10,
  LengthJitter = 11,
  AmpJitter = 12,
  WindowShape = 13,
  PitchSet = 14,
  PitchSpread = 15,
  Diffusion = 16,
  Damping = 17,
  Tilt = 18,
  Width = 19,
  OutputTrim = 20,
  Quality = 21,
  Bypass = 22,
  PreDelaySync = 23,
};

/// One row of the parameter table, for tests that sweep every parameter.
struct GranularReverbParamRow {
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

inline constexpr int kGranularReverbParamCount = 23;

inline constexpr GranularReverbParamRow kGranularReverbParams[kGranularReverbParamCount] = {
    {1, "Mix", "Mix", 0.0, 100.0, 35.0, 0.0, 100.0, -70.0},
    {2, "PreDelay", "Pre-delay", 0.0, 500.0, 20.0, 0.0, 500.0, -70.0},
    {3, "Size", "Size", 20.0, 4000.0, 800.0, 50.0, 4000.0, -70.0},
    {4, "MinOffset", "Min offset", 5.0, 500.0, 20.0, 5.0, 500.0, -70.0},
    {5, "Decay", "Decay", 0.1, 60.0, 3.0, 0.5, 60.0, -70.0},
    {6, "Freeze", "Freeze", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {7, "GrainSize", "Grain size", 5.0, 500.0, 60.0, 5.0, 500.0, -70.0},
    {8, "Density", "Density", 1.0, 2000.0, 350.0, 1.0, 2000.0, -70.0},
    {9, "Spray", "Spray", 0.0, 100.0, 70.0, 0.0, 100.0, -70.0},
    {10, "OnsetJitter", "Onset jitter", 0.0, 100.0, 60.0, 0.0, 100.0, -70.0},
    {11, "LengthJitter", "Length jitter", 0.0, 100.0, 25.0, 0.0, 100.0, -70.0},
    {12, "AmpJitter", "Amp jitter", 0.0, 100.0, 15.0, 0.0, 100.0, -70.0},
    {13, "WindowShape", "Window shape", 0.0, 100.0, 0.0, 0.0, 100.0, -70.0},
    {14, "PitchSet", "Pitch set", 0.0, 7.0, 0.0, 0.0, 7.0, -70.0},
    {15, "PitchSpread", "Pitch spread", 0.0, 100.0, 0.0, 0.0, 100.0, -70.0},
    {16, "Diffusion", "Diffusion", 0.0, 100.0, 60.0, 0.0, 100.0, -70.0},
    {17, "Damping", "Damping", 0.0, 100.0, 45.0, 0.0, 100.0, -70.0},
    {18, "Tilt", "Tilt", -12.0, 12.0, 0.0, -12.0, 12.0, -70.0},
    {19, "Width", "Width", 0.0, 200.0, 100.0, 0.0, 200.0, -70.0},
    {20, "OutputTrim", "Output trim", -24.0, 24.0, 0.0, -24.0, 24.0, -70.0},
    {21, "Quality", "Quality", 0.0, 2.0, 1.0, 0.0, 2.0, -70.0},
    {22, "Bypass", "Bypass", 0.0, 1.0, 0.0, 0.0, 1.0, -70.0},
    {23, "PreDelaySync", "Pre-delay sync", 0.0, 4.0, 0.0, 0.0, 4.0, -70.0},
};

/**
 * Route one parameter into the unit.
 *
 * Generated, which is the point: this switch and the TypeScript control table
 * are the same list, so a control naming no parameter does not compile and a
 * parameter with no control cannot be declared.
 */
inline void applyGranularReverbParam(GranularReverb& u, int id, double v) noexcept {
  switch (static_cast<GranularReverbParam>(id)) {
    case GranularReverbParam::Mix: {
      // Zero must null exactly, which §9 V1 measures at −360 dBFS — an equal-power law that only
      // approached zero would not.
      u.setMix(v * 0.01);
      break;
    }
    case GranularReverbParam::PreDelay: {
      // Ahead of the buffer, so it delays what the cloud reads rather than what the cloud produces.
      u.setPreDelaySeconds(v * 0.001);
      break;
    }
    case GranularReverbParam::Size: {
      // Sets the mean read offset with Min offset, and the decay calibration is indexed by that
      // mean — which is why reverb_decay.h takes it as an argument rather than assuming a size.
      u.setSizeSeconds(v * 0.001);
      break;
    }
    case GranularReverbParam::MinOffset: {
      // Clamped hard: below a grain length the grains read the write head and the loop
      // self-oscillates. §6 says clamp rather than warn, and an unreachable state is better than a
      // documented one.
      u.setMinOffsetSeconds(v * 0.001);
      break;
    }
    case GranularReverbParam::Decay: {
      // Inverted through reverb_decay.h's measured table rather than §2.2's formula, which is
      // inference. §9 V5 grades the result over an ensemble of seeds.
      u.setDecaySeconds(v);
      break;
    }
    case GranularReverbParam::Freeze: {
      // Stops the write head. §2.4 rules out setting the feedback to one, and §9 V11 is the row
      // that tells the two apart.
      u.setFreeze(v > 0.5);
      break;
    }
    case GranularReverbParam::GrainSize: {
      // Below 15 ms the window itself colours the sound; the face marks that point rather than
      // preventing it.
      u.setGrainSeconds(v * 0.001);
      break;
    }
    case GranularReverbParam::Density: {
      // With grain size this sets the overlap, which predicts both the sound and the CPU. §9 V13
      // measures that the cost really is linear in it.
      u.setDensity(v);
      break;
    }
    case GranularReverbParam::Spray: {
      // Randomises where in the size window each grain reads.
      u.setSpray(v * 0.01);
      break;
    }
    case GranularReverbParam::OnsetJitter: {
      // Zero makes the grain rate audible as a tone; the default trades that for the occasional gap
      // at low overlap, which is what GE-04 records.
      u.setOnsetJitter(v * 0.01);
      break;
    }
    case GranularReverbParam::LengthJitter: {
      // Widens the distribution of live grains, which is what the pool's 256 slots are sized
      // against.
      u.setLengthJitter(v * 0.01);
      break;
    }
    case GranularReverbParam::AmpJitter: {
      // Per-grain gain variation. It does not change the cloud's mean level, because the
      // normalisation is applied at spawn.
      u.setAmpJitter(v * 0.01);
      break;
    }
    case GranularReverbParam::WindowShape: {
      // Hann at zero, and the Tukey table is a phase remap of the Hann one so that end is bit-exact
      // rather than merely close.
      u.setWindowShape(v * 0.01);
      break;
    }
    case GranularReverbParam::PitchSet: {
      // A non-unison set clamps the damping corner and the blocker, so an unstable shimmer is
      // unreachable rather than warned about (§3.3).
      u.setPitchSet(static_cast<shimmer::Set>(static_cast<int>(v + 0.5)));
      break;
    }
    case GranularReverbParam::PitchSpread: {
      // Per-grain detune on top of the set.
      u.setPitchSpreadCents(v);
      break;
    }
    case GranularReverbParam::Diffusion: {
      // Drives the loop's allpass chain. It does not move §9 V7's echo density, because that row
      // measures the first arrivals and the chain is inside the loop — the ledger records why it
      // stays there.
      u.setDiffusion(v * 0.01);
      break;
    }
    case GranularReverbParam::Damping: {
      // Lower-bounded by the pitch set, so a shimmer cannot be undamped into a runaway.
      u.setDamping(v * 0.01);
      break;
    }
    case GranularReverbParam::Tilt: {
      // Compounds per pass, so a small setting is a large tail.
      u.setTiltDb(v);
      break;
    }
    case GranularReverbParam::Width: {
      // Mid/side on the wet bus only, so a mono dry stays mono.
      u.setWidth(v * 0.01);
      break;
    }
    case GranularReverbParam::OutputTrim: {
      // After the wet/dry mix, so it trims the whole unit rather than the tail.
      u.setOutputTrimDb(v);
      break;
    }
    case GranularReverbParam::Quality: {
      // Caps the overlap and selects the interpolation. GE-11 publishes what Eco costs in alias
      // floor rather than hiding it.
      u.setTier(static_cast<grain::Tier>(static_cast<int>(v + 0.5)));
      break;
    }
    case GranularReverbParam::Bypass: {
      // A bypassed unit is still in circuit and still meters, which is what X24 found four units
      // getting wrong.
      u.setBypass(v > 0.5);
      break;
    }
    case GranularReverbParam::PreDelaySync: {
      // Quarter notes; zero leaves Pre-delay in milliseconds, which is what every row written
      // before this one used. §6 lists the option and the tempo comes from the host per block
      // rather than from the map, so the unit keeps no second opinion about where the song is.
      u.setPreDelayQuarters(v);
      break;
    }
  }
}

}  // namespace mw::units
