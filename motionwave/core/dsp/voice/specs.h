// Motion Wave — the voice substrate's parameters, as ADR-0004 wants them.
//
// `lib-voice-substrate.md` §3's last file, in the shape `dsp/nonlinear/specs.h`
// set: a unit adds its own base to the offsets below when it writes its
// **static** `ParamSpec` table, and reads each block's settled values back
// into the substrate's own config structs. Parameters cross the audio boundary
// through `ParamSet` and nowhere else, so this is the only place a glide time,
// a vintage amount or an envelope stage becomes a number the substrate reads —
// six instruments declaring the same controls six ways would be six chances to
// label one in seconds and read it in milliseconds.
//
// The library never builds a table at run time: `ParamSet` requires specs that
// outlive it, and building one per instance would be an allocation per
// instance of every instrument, which is what ADR-0004 sized the framework to
// avoid. The binders take an *index* rather than an id for the reason the
// nonlinear library gives — `ParamSet` resolves ids by search, and a unit
// already knows where its block starts.
//
// **What is not here, and why.** MPE's sensitivities are not parameters: the
// configuration message and RPN 0 own them, and a spec that fought a
// controller for the same number would be the second opinion this framework
// exists to remove. The glide time's law is the framework's own logarithmic
// taper between the design's two clamps, not the sampler sheet's CC 5 curve,
// which that sheet marks as its own choice; the two agree at both ends because
// the clamps are the ends. And the drift *magnitudes* stay in `DriftConfig`,
// where a unit chooses its deviation set once — the user's control is the one
// scalar that scales them.
#pragma once

#include "../../param/param_set.h"
#include "../../param/param_spec.h"
#include "drift.h"
#include "envelope.h"
#include "lfo.h"
#include "portamento.h"
#include "voice_set.h"

namespace mw::dsp::voice::param {

// ------------------------------------------------------------ offsets

inline constexpr ParamId kGlideTrigger = 0;
inline constexpr ParamId kGlideShape = 1;
inline constexpr ParamId kGlideTime = 2;
inline constexpr ParamId kGlideLaw = 3;
inline constexpr ParamId kGlideStagger = 4;
inline constexpr ParamId kGlideStaggerMode = 5;
inline constexpr ParamId kGlideStaggerOrder = 6;
inline constexpr std::size_t kGlideParamCount = 7;

inline constexpr ParamId kVintage = 0;
/// A press, carried as a two-state switch whose *change* is the event: the
/// face flips it on every press, the binder fires once per flip.
inline constexpr ParamId kTune = 1;
inline constexpr std::size_t kDriftParamCount = 2;

inline constexpr ParamId kLfoWave = 0;
inline constexpr ParamId kLfoRate = 1;
inline constexpr ParamId kLfoDelay = 2;
inline constexpr ParamId kLfoFade = 3;
inline constexpr ParamId kLfoAmount = 4;
inline constexpr ParamId kLfoRetrigger = 5;
inline constexpr std::size_t kLfoParamCount = 6;

inline constexpr ParamId kEnvAttack = 0;
inline constexpr ParamId kEnvDecay = 1;
inline constexpr ParamId kEnvSustain = 2;
inline constexpr ParamId kEnvRelease = 3;
inline constexpr std::size_t kEnvelopeParamCount = 4;

inline constexpr ParamId kVoices = 0;
inline constexpr ParamId kUnison = 1;
inline constexpr ParamId kAllocation = 2;
inline constexpr std::size_t kVoiceParamCount = 3;

/// One layout for a unit that wants the whole substrate in one block.
inline constexpr std::size_t kGlideFirst = 0;
inline constexpr std::size_t kDriftFirst = kGlideFirst + kGlideParamCount;
inline constexpr std::size_t kLfoFirst = kDriftFirst + kDriftParamCount;
inline constexpr std::size_t kEnvelopeFirst = kLfoFirst + kLfoParamCount;
inline constexpr std::size_t kVoiceFirst = kEnvelopeFirst + kEnvelopeParamCount;
inline constexpr std::size_t kSubstrateParamCount = kVoiceFirst + kVoiceParamCount;

// ------------------------------------------------------------ choices

/// Each list is in its enum's order, so a choice index *is* the enum value.
/// `specs_tests.cpp` checks every list against its enum's last member.
inline constexpr const char* kGlideTriggerChoices[3] = {"Off", "On", "Legato"};
inline constexpr const char* kGlideShapeChoices[3] = {"Linear", "RC", "S-Curve"};
inline constexpr const char* kStaggerModeChoices[3] = {"Spread", "Interval", "Per Voice"};
inline constexpr const char* kStaggerOrderChoices[5] = {"Low First", "High First", "Outside In",
                                                        "Inside Out", "Play Order"};
inline constexpr const char* kTuneChoices[2] = {"Ready", "Tune"};
inline constexpr const char* kLfoWaveChoices[8] = {"Triangle", "Saw Up", "Saw Down", "Square",
                                                   "Sine",     "S&H",    "Noise",    "Sample"};
inline constexpr const char* kLfoRetriggerChoices[4] = {"Off", "Single", "Multi", "External"};
inline constexpr const char* kAllocationChoices[2] = {"Round Robin", "Lowest Free"};

// ------------------------------------------------------------ writers

namespace detail {
/// A choice spec: never smoothed, because a switch half-way is a device that
/// does not exist.
inline ParamSpec choice(ParamId id, const char* name, int count, float def,
                        const char* const* choices) noexcept {
  return ParamSpec{id,  name,        Unit::Choice, 0.0f, static_cast<float>(count - 1), def,
                   Taper::Stepped, 1.0f, count, 0.0f, choices};
}
inline ParamSpec range(ParamId id, const char* name, Unit unit, float min, float max, float def,
                       Taper taper, float exponent, float smoothingMs) noexcept {
  return ParamSpec{id, name, unit, min, max, def, taper, exponent, 0, smoothingMs, nullptr};
}
}  // namespace detail

/// `out` must have room for `kGlideParamCount` entries.
inline void writeGlideSpecs(ParamId base, ParamSpec* out) noexcept {
  out[kGlideTrigger] = detail::choice(base + kGlideTrigger, "Glide", 3, 0.0f, kGlideTriggerChoices);
  out[kGlideShape] = detail::choice(base + kGlideShape, "Glide Shape", 3, 1.0f, kGlideShapeChoices);
  // Logarithmic between the clamps of (11): a millisecond needs the same
  // resolution as a second, and the middle of the travel is 173 ms.
  out[kGlideTime] = detail::range(base + kGlideTime, "Glide Time", Unit::Seconds, kGlideMinSeconds,
                                  kGlideMaxSeconds, 0.4f, Taper::Logarithmic, 1.0f, 20.0f);
  out[kGlideLaw] = detail::range(base + kGlideLaw, "Glide Law", Unit::Linear, 0.0f, 1.0f, 0.5f,
                                 Taper::Linear, 1.0f, 20.0f);
  out[kGlideStagger] = detail::range(base + kGlideStagger, "Stagger", Unit::Percent, 0.0f, 1.0f,
                                     0.0f, Taper::Linear, 1.0f, 20.0f);
  out[kGlideStaggerMode] =
      detail::choice(base + kGlideStaggerMode, "Stagger Mode", 3, 0.0f, kStaggerModeChoices);
  out[kGlideStaggerOrder] =
      detail::choice(base + kGlideStaggerOrder, "Stagger Order", 5, 0.0f, kStaggerOrderChoices);
}

/// `out` must have room for `kDriftParamCount` entries.
inline void writeDriftSpecs(ParamId base, ParamSpec* out) noexcept {
  // Zero by default, for the reason `drift.h` gives: one consumer must be
  // exact, and a drift that defaulted on would silently wrong it.
  out[kVintage] = detail::range(base + kVintage, "Vintage", Unit::Percent, 0.0f, 1.0f, 0.0f,
                                Taper::Linear, 1.0f, 30.0f);
  out[kTune] = detail::choice(base + kTune, "Tune", 2, 0.0f, kTuneChoices);
}

/// `out` must have room for `kLfoParamCount` entries.
inline void writeLfoSpecs(ParamId base, ParamSpec* out) noexcept {
  out[kLfoWave] = detail::choice(base + kLfoWave, "LFO Wave", 8, 0.0f, kLfoWaveChoices);
  out[kLfoRate] = detail::range(base + kLfoRate, "LFO Rate", Unit::Hertz, 0.01f, 50.0f, 5.0f,
                                Taper::Logarithmic, 1.0f, 20.0f);
  // Both delay stages resolve tens of milliseconds at the bottom of a
  // five-second range: the measured pairs start at 64 ms and 53 ms.
  out[kLfoDelay] = detail::range(base + kLfoDelay, "LFO Delay", Unit::Seconds, 0.0f, 5.0f, 0.0f,
                                 Taper::Exponential, 2.0f, 20.0f);
  out[kLfoFade] = detail::range(base + kLfoFade, "LFO Fade", Unit::Seconds, 0.0f, 5.0f, 0.0f,
                                Taper::Exponential, 2.0f, 20.0f);
  out[kLfoAmount] = detail::range(base + kLfoAmount, "LFO Amount", Unit::Percent, 0.0f, 1.0f,
                                  1.0f, Taper::Linear, 1.0f, 20.0f);
  out[kLfoRetrigger] =
      detail::choice(base + kLfoRetrigger, "LFO Retrigger", 4, 0.0f, kLfoRetriggerChoices);
}

/// `out` must have room for `kEnvelopeParamCount` entries. Times, for a
/// duration-driven shape; a rate-driven consumer converts its own rate law.
inline void writeEnvelopeSpecs(ParamId base, ParamSpec* out) noexcept {
  out[kEnvAttack] = detail::range(base + kEnvAttack, "Attack", Unit::Seconds, 0.001f, 10.0f,
                                  0.01f, Taper::Exponential, 3.0f, 20.0f);
  out[kEnvDecay] = detail::range(base + kEnvDecay, "Decay", Unit::Seconds, 0.001f, 20.0f, 0.3f,
                                 Taper::Exponential, 3.0f, 20.0f);
  out[kEnvSustain] = detail::range(base + kEnvSustain, "Sustain", Unit::Percent, 0.0f, 1.0f, 0.8f,
                                   Taper::Linear, 1.0f, 20.0f);
  out[kEnvRelease] = detail::range(base + kEnvRelease, "Release", Unit::Seconds, 0.001f, 20.0f,
                                   0.3f, Taper::Exponential, 3.0f, 20.0f);
}

/// `out` must have room for `kVoiceParamCount` entries. None is smoothed: a
/// cap takes effect at the next allocation and is never interpolated.
inline void writeVoiceSpecs(ParamId base, ParamSpec* out) noexcept {
  out[kVoices] = ParamSpec{base + kVoices, "Voices", Unit::Linear, 1.0f, 32.0f, 16.0f,
                           Taper::Stepped, 1.0f, 32, 0.0f, nullptr};
  out[kUnison] = ParamSpec{base + kUnison, "Unison", Unit::Linear, 1.0f, 4.0f, 1.0f,
                           Taper::Stepped, 1.0f, 4, 0.0f, nullptr};
  out[kAllocation] = detail::choice(base + kAllocation, "Allocation", 2, 0.0f, kAllocationChoices);
}

/// Every block at the layout above. `out` needs `kSubstrateParamCount`.
inline void writeSubstrateSpecs(ParamId base, ParamSpec* out) noexcept {
  writeGlideSpecs(base + static_cast<ParamId>(kGlideFirst), out + kGlideFirst);
  writeDriftSpecs(base + static_cast<ParamId>(kDriftFirst), out + kDriftFirst);
  writeLfoSpecs(base + static_cast<ParamId>(kLfoFirst), out + kLfoFirst);
  writeEnvelopeSpecs(base + static_cast<ParamId>(kEnvelopeFirst), out + kEnvelopeFirst);
  writeVoiceSpecs(base + static_cast<ParamId>(kVoiceFirst), out + kVoiceFirst);
}

// ------------------------------------------------------------ binding

/// The settled glide controls over `base`, which carries the seed and anything
/// a unit fixes for itself. Called from a unit's `beginBlock`, after
/// `ParamSet::beginBlock`, before any sample is touched.
inline GlideConfig glideConfigFrom(const ParamSet& params, std::size_t first,
                                   const GlideConfig& base) noexcept {
  GlideConfig out = base;
  out.trigger = static_cast<GlideTrigger>(params.choice(first + kGlideTrigger));
  out.shape = static_cast<GlideShape>(params.choice(first + kGlideShape));
  out.timeSeconds = params.value(first + kGlideTime);
  out.kappa = params.value(first + kGlideLaw);
  out.stagger = params.value(first + kGlideStagger);
  out.staggerMode = static_cast<StaggerMode>(params.choice(first + kGlideStaggerMode));
  out.staggerOrder = static_cast<StaggerOrder>(params.choice(first + kGlideStaggerOrder));
  return out;
}

/// The one scalar over a unit's own deviation set.
inline DriftConfig driftConfigFrom(const ParamSet& params, std::size_t first,
                                   const DriftConfig& base) noexcept {
  DriftConfig out = base;
  out.vintage = params.value(first + kVintage);
  return out;
}

/// True once per press of the tune control. `last` is the unit's own record of
/// the switch, so a held value fires nothing and a flip fires exactly once.
inline bool tuneRequested(const ParamSet& params, std::size_t first, int& last) noexcept {
  const int now = params.choice(first + kTune);
  if (now == last) return false;
  last = now;
  return true;
}

inline LfoConfig lfoConfigFrom(const ParamSet& params, std::size_t first,
                               const LfoConfig& base) noexcept {
  LfoConfig out = base;
  out.wave = static_cast<LfoWave>(params.choice(first + kLfoWave));
  out.rateHz = params.value(first + kLfoRate);
  out.delaySeconds = params.value(first + kLfoDelay);
  out.fadeSeconds = params.value(first + kLfoFade);
  out.amplitude = params.value(first + kLfoAmount);
  out.retrigger = static_cast<LfoRetrigger>(params.choice(first + kLfoRetrigger));
  return out;
}

/// The four stages written onto an ADSR-shaped `base`: segments 0 to 3 are
/// attack to 1, decay to the sustain level, the hold, and release to the
/// floor. Curves, domain and drive are the unit's and are left alone — they
/// are what makes one shape family different from another.
inline EnvelopeShape adsrShapeFrom(const ParamSet& params, std::size_t first,
                                   const EnvelopeShape& base) noexcept {
  EnvelopeShape out = base;
  const float sustain = params.value(first + kEnvSustain);
  out.segments[0].target = 1.0f;
  out.segments[0].parameter = params.value(first + kEnvAttack);
  out.segments[1].target = sustain;
  out.segments[1].parameter = params.value(first + kEnvDecay);
  out.segments[2].target = sustain;
  out.segments[3].target = base.floorValue;
  out.segments[3].parameter = params.value(first + kEnvRelease);
  return out;
}

inline VoiceSetConfig voiceSetConfigFrom(const ParamSet& params, std::size_t first,
                                         const VoiceSetConfig& base) noexcept {
  VoiceSetConfig out = base;
  out.capacity = static_cast<int>(params.value(first + kVoices) + 0.5f);
  out.unison = static_cast<int>(params.value(first + kUnison) + 0.5f);
  out.allocation = static_cast<Allocation>(params.choice(first + kAllocation));
  return out;
}

}  // namespace mw::dsp::voice::param
