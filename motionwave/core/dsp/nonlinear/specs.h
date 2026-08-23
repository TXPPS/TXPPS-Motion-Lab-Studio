// Motion Wave — the nonlinear library's parameters, as ADR-0004 wants them.
//
// `lib-nonlinear.md` §3.6. A unit adds its own base to the offsets below when
// it writes its **static** ParamSpec table. The library never builds a table at
// run time: `ParamSet` requires specs that outlive it, and building one per
// instance would be an allocation per instance of every plugin — which is
// exactly what ADR-0004 sized the framework to avoid.
//
// **Unit variance is one control, not two trims.** Three of the five sheets ask
// for a variance parameter and one of them names two engineering trims.
// Exposing two trims makes a user calibrate a plug-in; exposing one scalar that
// moves every per-instance deviation together is both easier to use and more
// faithful, because on the hardware the deviations are correlated — a drifted
// unit is drifted in every respect at once. The default is a correctly
// calibrated unit.
#pragma once

#include "../../param/param_set.h"
#include "../../param/param_spec.h"
#include "magnetic_core.h"
#include "triode_stage.h"

namespace mw::dsp::nl::param {

/// Offsets within a stage's parameter block. A unit adds its own base.
inline constexpr ParamId kDrive = 0;
inline constexpr ParamId kBias = 1;
inline constexpr ParamId kCoreDrive = 2;
inline constexpr ParamId kUnitVariance = 3;
inline constexpr ParamId kOversampling = 4;
inline constexpr std::size_t kStageParamCount = 5;

/// The oversampling choices, in the order the factors appear.
inline constexpr const char* kOversamplingChoices[4] = {"Off", "2x", "4x", "8x"};

/**
 * Fill caller-owned static storage with this library's specs, renumbered from
 * `base`.
 *
 * Called once, off the audio thread, from a unit's static initialiser. `out`
 * must have room for `kStageParamCount` entries — checked by the caller rather
 * than here, because a length parameter that is only ever passed correctly is a
 * length parameter nobody reads.
 */
inline void writeStageSpecs(ParamId base, ParamSpec* out) noexcept {
  out[kDrive] = ParamSpec{base + kDrive,
                          "Drive",
                          Unit::Percent,
                          0.0f,
                          1.0f,
                          0.2735f,
                          Taper::Linear,
                          1.0f,
                          0,
                          30.0f,
                          nullptr};
  // Bias is the operating point, and its default is the §4.1 anchor rather
  // than zero: a stage at zero bias is a symmetric stage, which is a different
  // device from the one the sheets describe.
  out[kBias] = ParamSpec{base + kBias, "Bias",   Unit::Percent, 0.0f, 0.5f,    0.0459f,
                         Taper::Linear, 1.0f,    0,             30.0f, nullptr};
  out[kCoreDrive] = ParamSpec{base + kCoreDrive, "Core", Unit::Percent, 0.0f, 2.0f,   1.0f,
                              Taper::Linear,     1.0f,   0,             30.0f, nullptr};
  // One scalar for every per-instance deviation, and it is deliberately not
  // smoothed to zero width: moving it is changing which unit you own, not
  // riding a control, so it travels at the same speed as any other knob and
  // nothing about it is momentary.
  out[kUnitVariance] = ParamSpec{base + kUnitVariance, "Variance", Unit::Percent, 0.0f, 1.0f,
                                 0.0f,                 Taper::Linear, 1.0f,       0,    30.0f,
                                 nullptr};
  // Zero smoothing, because it is a switch. Interpolating between two
  // oversampling factors is meaningless — they have different latencies, and a
  // half-way state would be a device with a fractional delay.
  out[kOversampling] = ParamSpec{base + kOversampling,
                                 "Oversampling",
                                 Unit::Choice,
                                 0.0f,
                                 3.0f,
                                 2.0f,
                                 Taper::Stepped,
                                 1.0f,
                                 4,
                                 0.0f,
                                 kOversamplingChoices};
}

/**
 * Read the block's settled values into a stage config.
 *
 * Called from a unit's `beginBlock`, after `ParamSet::beginBlock` and before
 * any sample is touched. `firstIndex` is where this stage's block starts in the
 * set — an index rather than an id, because `ParamSet` resolves ids by search
 * and doing that five times per block on the audio thread would be five linear
 * scans for values the unit already knows the position of.
 */
inline TriodeStage::Config triodeConfigFrom(const ParamSet& params,
                                            std::size_t firstIndex) noexcept {
  TriodeStage::Config out;
  out.drive = params.value(firstIndex + kDrive);
  out.bias = params.value(firstIndex + kBias);
  return out;
}

inline MagneticCore::Config coreConfigFrom(const ParamSet& params,
                                           std::size_t firstIndex) noexcept {
  MagneticCore::Config out;
  const float drive = params.value(firstIndex + kCoreDrive);
  // Core drive moves the saturation flux inversely: driving a transformer
  // harder is running further up the same curve, not changing the curve. A
  // parameter that scaled the *signal* into the core instead would also change
  // the level, and a level that moves with a distortion control is two controls
  // in one.
  out.saturationFlux = drive > 0.01f ? MagneticCore::Config{}.saturationFlux / drive
                                     : MagneticCore::Config{}.saturationFlux * 100.0f;
  return out;
}

/**
 * The variance scalar, applied to a stage.
 *
 * One place, so that "a drifted unit is drifted in every respect at once" is a
 * property of the code rather than a sentence in a document. The deviations are
 * deterministic in `seed` rather than random: two instances with the same seed
 * must render identically, or a bounce and its playback would differ.
 */
inline void applyVariance(float variance, std::uint32_t seed, TriodeStage::Config& stage,
                          MagneticCore::Config& core) noexcept {
  if (variance <= 0.0f) return;
  // A cheap deterministic hash, not a generator. Nothing here needs statistical
  // quality; it needs to be the same number every time for a given instance.
  auto spread = [&](std::uint32_t salt) {
    std::uint32_t h = seed * 2654435761u + salt * 2246822519u;
    h ^= h >> 15;
    h *= 2654435761u;
    h ^= h >> 13;
    return (static_cast<float>(h & 0xFFFFu) / 32768.0f - 1.0f) * variance;
  };
  stage.drive *= 1.0f + 0.10f * spread(1);
  stage.bias *= 1.0f + 0.25f * spread(2);
  core.saturationFlux *= 1.0f + 0.15f * spread(3);
  core.coercivity *= 1.0f + 0.30f * spread(4);
}

}  // namespace mw::dsp::nl::param
