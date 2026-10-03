// Motion Wave — Slipstream Sampler voice-layer parameters. `smp-01` §7.
// This is intentionally the parameter block consumed by the voice layer only;
// engine-specific character controls remain owned by their reader structs.
#pragma once

#include "../../param/param_set.h"
#include "../../param/param_spec.h"
#include "../svf.h"
#include "classic_read.h"
#include "zone.h"

#include <cstddef>

namespace mw::dsp::sample::param {

inline constexpr std::size_t kEngine = 0;
inline constexpr std::size_t kQuality = 1;
inline constexpr std::size_t kGain = 2;
inline constexpr std::size_t kPan = 3;
inline constexpr std::size_t kPolyphony = 4;
inline constexpr std::size_t kFilterMode = 5;
inline constexpr std::size_t kCutoff = 6;
inline constexpr std::size_t kResonance = 7;
inline constexpr std::size_t kKeyFollow = 8;
inline constexpr std::size_t kAttack = 9;
inline constexpr std::size_t kDecay = 10;
inline constexpr std::size_t kSustain = 11;
inline constexpr std::size_t kRelease = 12;
inline constexpr std::size_t kVelocityAmp = 13;
inline constexpr std::size_t kCount = 14;

inline constexpr const char* kEngineChoices[4] = {"Classic", "Granular", "Spectral", "Hybrid"};
inline constexpr const char* kQualityChoices[3] = {"Eco", "Normal", "High"};
inline constexpr const char* kFilterChoices[5] = {"LP", "HP", "BP", "Notch", "Off"};

inline ParamSpec choice(ParamId id, const char* name, int count, float def,
                        const char* const* choices) noexcept {
  return ParamSpec{id, name, Unit::Choice, 0.0f, static_cast<float>(count - 1), def,
                   Taper::Stepped, 1.0f, count, 0.0f, choices};
}
inline ParamSpec range(ParamId id, const char* name, Unit unit, float min, float max, float def,
                       Taper taper, int steps = 0, float smoothingMs = 20.0f) noexcept {
  return ParamSpec{id, name, unit, min, max, def, taper, 1.0f, steps, smoothingMs, nullptr};
}

inline void writeVoiceLayerSpecs(ParamId base, ParamSpec* out) noexcept {
  out[kEngine] = choice(base + static_cast<ParamId>(kEngine), "Engine", 4, 0.0f, kEngineChoices);
  out[kQuality] = choice(base + static_cast<ParamId>(kQuality), "Quality", 3, 1.0f, kQualityChoices);
  out[kGain] = range(base + static_cast<ParamId>(kGain), "Gain", Unit::Decibels, -60.0f, 12.0f, 0.0f, Taper::Linear);
  out[kPan] = range(base + static_cast<ParamId>(kPan), "Pan", Unit::Percent, -1.0f, 1.0f, 0.0f, Taper::Linear);
  out[kPolyphony] =
      range(base + static_cast<ParamId>(kPolyphony), "Polyphony", Unit::Linear, 1.0f, 64.0f, 32.0f,
            Taper::Stepped, 64, 0.0f);
  out[kFilterMode] = choice(base + static_cast<ParamId>(kFilterMode), "Filter Mode", 5, 0.0f, kFilterChoices);
  out[kCutoff] =
      range(base + static_cast<ParamId>(kCutoff), "Cutoff", Unit::Hertz, 20.0f, 20000.0f, 20000.0f,
            Taper::Logarithmic);
  out[kResonance] =
      range(base + static_cast<ParamId>(kResonance), "Resonance", Unit::Percent, 0.0f, 1.0f, 0.0f, Taper::Linear);
  out[kKeyFollow] =
      range(base + static_cast<ParamId>(kKeyFollow), "Key Follow", Unit::Percent, 0.0f, 1.0f, 0.0f, Taper::Linear);
  // SMP-01 specifies 0.1 ms..30 s for the sampler envelopes.
  out[kAttack] =
      range(base + static_cast<ParamId>(kAttack), "Attack", Unit::Seconds, 0.0001f, 30.0f, 0.005f,
            Taper::Logarithmic);
  out[kDecay] =
      range(base + static_cast<ParamId>(kDecay), "Decay", Unit::Seconds, 0.0001f, 30.0f, 0.25f,
            Taper::Logarithmic);
  out[kSustain] =
      range(base + static_cast<ParamId>(kSustain), "Sustain", Unit::Percent, 0.0f, 1.0f, 1.0f, Taper::Linear);
  out[kRelease] =
      range(base + static_cast<ParamId>(kRelease), "Release", Unit::Seconds, 0.0001f, 30.0f, 0.25f,
            Taper::Logarithmic);
  out[kVelocityAmp] =
      range(base + static_cast<ParamId>(kVelocityAmp), "Velocity To Amp", Unit::Percent, 0.0f, 1.0f, 1.0f,
            Taper::Linear);
}

struct VoiceLayerControls {
  Engine engine = Engine::Classic;
  Quality quality = Quality::Normal;
  float gainDb = 0.0f;
  float pan = 0.0f;
  int polyphony = 32;
  mw::dsp::Svf::Mode filterMode = mw::dsp::Svf::Mode::Lowpass;
  float cutoffHz = 20000.0f;
  float resonance = 0.0f;
  float keyFollow = 0.0f;
  float attack = 0.005f;
  float decay = 0.25f;
  float sustain = 1.0f;
  float release = 0.25f;
  float velocityAmp = 1.0f;
};

inline VoiceLayerControls controlsFrom(const ParamSet& set, std::size_t first = 0) noexcept {
  VoiceLayerControls c;
  c.engine = static_cast<Engine>(set.choice(first + kEngine));
  c.quality = static_cast<Quality>(set.choice(first + kQuality));
  c.gainDb = set.value(first + kGain);
  c.pan = set.value(first + kPan);
  c.polyphony = static_cast<int>(set.value(first + kPolyphony) + 0.5f);
  c.filterMode = static_cast<mw::dsp::Svf::Mode>(set.choice(first + kFilterMode));
  c.cutoffHz = set.value(first + kCutoff);
  c.resonance = set.value(first + kResonance);
  c.keyFollow = set.value(first + kKeyFollow);
  c.attack = set.value(first + kAttack);
  c.decay = set.value(first + kDecay);
  c.sustain = set.value(first + kSustain);
  c.release = set.value(first + kRelease);
  c.velocityAmp = set.value(first + kVelocityAmp);
  return c;
}

}  // namespace mw::dsp::sample::param
