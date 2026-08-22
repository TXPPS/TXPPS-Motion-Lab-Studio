// Motion Wave — the parameter descriptor.
//
// A spec is the authority on what a control is: its range, its law, its unit,
// how fast it may move, and what it is called. Everything else in the system —
// automation, presets, modulation, host exposure, MIDI learn, the generic UI —
// is derived from the declaration rather than written per plugin (ADR-0004).
#pragma once

#include <cstdint>

#include "units.h"

namespace mw {

/// Stable within a processor. Never renumbered: a parameter's id is the key an
/// automation lane and a saved preset name it by, so renumbering one silently
/// re-points every project that automated it. Renaming the *display* name is
/// free; changing the id is not.
using ParamId = std::uint32_t;

struct ParamSpec {
  ParamId id = 0;
  /// Display name. Never a trademarked reference name — see LEGAL_NOTES.md.
  const char* name = "";
  Unit unit = Unit::Linear;
  float min = 0.0f;
  float max = 1.0f;
  float def = 0.0f;
  Taper taper = Taper::Linear;
  /// Only read when `taper == Exponential`.
  float exponent = 1.0f;
  /// Only read when `taper == Stepped`, or when `unit == Choice`, where it is
  /// the number of choices.
  int steps = 0;
  /// How long the value takes to travel, in milliseconds. Zero means the
  /// parameter is a switch and is never smoothed: crossfading between two
  /// filter modes is the processor's decision, and pretending a switch is
  /// continuous is worse than a click.
  float smoothingMs = 20.0f;
  /// Null unless `unit == Choice`; then it has `steps` entries.
  const char* const* choices = nullptr;

  constexpr bool isChoice() const noexcept { return unit == Unit::Choice; }
  constexpr bool isSmoothed() const noexcept { return smoothingMs > 0.0f && !isChoice(); }

  /// Real value from a normalised position, through this spec's law.
  float toReal(float normalised) const noexcept {
    if (isChoice()) {
      const int count = steps > 1 ? steps : 1;
      const float q = normalised < 0.0f ? 0.0f : (normalised > 1.0f ? 1.0f : normalised);
      return static_cast<float>(static_cast<int>(q * static_cast<float>(count - 1) + 0.5f));
    }
    return denormalise(normalised, min, max, taper, exponent, steps);
  }

  /// Normalised position from a real value. Inverse of `toReal`.
  float toNormalised(float real) const noexcept {
    if (isChoice()) {
      const int count = steps > 1 ? steps : 1;
      if (count < 2) return 0.0f;
      float idx = real < 0.0f ? 0.0f : real;
      const float top = static_cast<float>(count - 1);
      if (idx > top) idx = top;
      return idx / top;
    }
    return normalise(real, min, max, taper, exponent, steps);
  }

  /// The choice index a normalised position selects, clamped to the list.
  int toChoice(float normalised) const noexcept {
    const int count = steps > 1 ? steps : 1;
    int idx = static_cast<int>(toReal(normalised));
    if (idx < 0) idx = 0;
    if (idx >= count) idx = count - 1;
    return idx;
  }

  float defaultNormalised() const noexcept { return toNormalised(def); }
};

}  // namespace mw
