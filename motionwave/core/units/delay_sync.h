// Motion Wave — the Granular Delay's tempo-sync divisions.
//
// `fx-03` §5 asks for two axes rather than a flat list: a base division and a
// modifier. That is fewer entries than the thirty a flat list needs, and it
// makes the dotted and triplet relationship legible instead of asking a user to
// know that "1/8 D" sits between "1/8" and "1/4".
#pragma once

#include <cstdint>

namespace mw::units::delay {

/// §5's base divisions, as fractions of a whole note.
enum class Division : std::uint8_t {
  SixtyFourth = 0,
  ThirtySecond,
  Sixteenth,
  Eighth,
  Quarter,
  Half,
  Whole,
  TwoBars,
  FourBars,
  EightBars,
};

/// §5's modifiers.
enum class Modifier : std::uint8_t { Straight = 0, Dotted, Triplet };

inline constexpr int kDivisionCount = 10;
inline constexpr int kModifierCount = 3;

/// Fraction of a whole note. 1/4 is 0.25, which gives one beat at 4/4.
inline double wholeNotesFor(Division division) noexcept {
  switch (division) {
    case Division::SixtyFourth: return 1.0 / 64.0;
    case Division::ThirtySecond: return 1.0 / 32.0;
    case Division::Sixteenth: return 1.0 / 16.0;
    case Division::Eighth: return 1.0 / 8.0;
    case Division::Quarter: return 1.0 / 4.0;
    case Division::Half: return 1.0 / 2.0;
    case Division::Whole: return 1.0;
    case Division::TwoBars: return 2.0;
    case Division::FourBars: return 4.0;
    case Division::EightBars: return 8.0;
  }
  return 1.0 / 4.0;
}

inline double factorFor(Modifier modifier) noexcept {
  switch (modifier) {
    case Modifier::Dotted: return 1.5;
    case Modifier::Triplet: return 2.0 / 3.0;
    case Modifier::Straight:
    default: return 1.0;
  }
}

/**
 * §5's formula: `(60/BPM) · 4 · division · modifier`.
 *
 * The `4` is there because `division` counts whole notes and a whole note is
 * four beats at 4/4, so a quarter comes out at `60/BPM` — one beat — which is
 * what every other line in the sheet assumes. Writing the constant into the
 * division table instead would make the table's numbers stop being fractions of
 * a whole note, and V3 grades this against the sample index of an impulse peak
 * at three tempos, where a factor of four is not a subtle failure.
 */
inline double delaySecondsFor(Division division, Modifier modifier, double bpm) noexcept {
  const double tempo = bpm > 1.0 ? bpm : 1.0;
  return (60.0 / tempo) * 4.0 * wholeNotesFor(division) * factorFor(modifier);
}

}  // namespace mw::units::delay
