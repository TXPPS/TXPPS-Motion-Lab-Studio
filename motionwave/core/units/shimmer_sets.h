// Motion Wave — the Granular Reverb's interval sets, and the stability rule
// that comes with them.
//
// `fx-02` §3.2 and §3.3. Separated from the unit because it is a different kind
// of statement: the unit says how a sample gets from the input to the output,
// and this says which chords the shimmer draws from and what each one forces the
// loop to do about itself.
#pragma once

#include <cmath>
#include <cstdint>

namespace mw::units::shimmer {

/**
 * §3.2's sets.
 *
 * Per-grain assignment is what makes a chord rather than a detune: a fixed
 * shift on every grain gives one transposed copy, while drawing per grain gives
 * a simultaneous chord whose voices are continuously reshuffled, which is the
 * sound people mean by shimmer. In a granular reverb this is free, because the
 * grains *are* the feedback path — a grain picks its own pitch when it is
 * spawned, and the shift is therefore inside the loop, where the literature
 * puts the best-sounding shimmer.
 *
 * Scale quantisation is deliberately absent. §3.2 could not find it documented
 * in the shimmer literature and it only makes musical sense once the root is
 * known, which means a user-set key or pitch detection on the input; the sheet
 * says to spec the interval sets now and treat quantisation as a later
 * addition, marked unconfirmed as prior art.
 */
enum class Set : std::uint8_t {
  Unison = 0,
  OctaveUp,
  OctaveDown,
  Fifth,
  Major,
  Minor,
  Sus,
  Wide,
};

inline constexpr int kMaxIntervals = 8;

struct Intervals {
  float semitones[kMaxIntervals] = {0, 0, 0, 0, 0, 0, 0, 0};
  float weights[kMaxIntervals] = {1, 0, 0, 0, 0, 0, 0, 0};
  int count = 1;

  float highest() const noexcept {
    float top = 0.0f;
    for (int i = 0; i < count; ++i) {
      if (semitones[i] > top) top = semitones[i];
    }
    return top;
  }

  float lowest() const noexcept {
    float bottom = 0.0f;
    for (int i = 0; i < count; ++i) {
      if (semitones[i] < bottom) bottom = semitones[i];
    }
    return bottom;
  }
};

/// §3.2's table, written out because it is a list of musical intervals and not
/// a series — a formula that happened to fit them would be a claim about music
/// that nobody made.
inline Intervals intervalsFor(Set set) noexcept {
  Intervals out;
  switch (set) {
    case Set::OctaveUp:
      out.count = 2;
      out.semitones[0] = 0.0f;   out.weights[0] = 0.6f;
      out.semitones[1] = 12.0f;  out.weights[1] = 0.4f;
      break;
    case Set::OctaveDown:
      out.count = 2;
      out.semitones[0] = 0.0f;   out.weights[0] = 0.6f;
      out.semitones[1] = -12.0f; out.weights[1] = 0.4f;
      break;
    case Set::Fifth:
      out.count = 2;
      out.semitones[0] = 0.0f;   out.weights[0] = 0.6f;
      out.semitones[1] = 7.0f;   out.weights[1] = 0.4f;
      break;
    case Set::Major:
      out.count = 4;
      out.semitones[0] = 0.0f;   out.weights[0] = 0.4f;
      out.semitones[1] = 4.0f;   out.weights[1] = 0.2f;
      out.semitones[2] = 7.0f;   out.weights[2] = 0.2f;
      out.semitones[3] = 12.0f;  out.weights[3] = 0.2f;
      break;
    case Set::Minor:
      out.count = 4;
      out.semitones[0] = 0.0f;   out.weights[0] = 0.4f;
      out.semitones[1] = 3.0f;   out.weights[1] = 0.2f;
      out.semitones[2] = 7.0f;   out.weights[2] = 0.2f;
      out.semitones[3] = 12.0f;  out.weights[3] = 0.2f;
      break;
    case Set::Sus:
      out.count = 4;
      out.semitones[0] = 0.0f;   out.weights[0] = 0.4f;
      out.semitones[1] = 5.0f;   out.weights[1] = 0.2f;
      out.semitones[2] = 7.0f;   out.weights[2] = 0.2f;
      out.semitones[3] = 12.0f;  out.weights[3] = 0.2f;
      break;
    case Set::Wide:
      out.count = 4;
      out.semitones[0] = -12.0f; out.weights[0] = 0.25f;
      out.semitones[1] = 0.0f;   out.weights[1] = 0.25f;
      out.semitones[2] = 12.0f;  out.weights[2] = 0.25f;
      out.semitones[3] = 19.0f;  out.weights[3] = 0.25f;
      break;
    case Set::Unison:
    default:
      break;
  }
  return out;
}

/**
 * §3.3's damping ceiling, in hertz.
 *
 * An upward shift in a feedback loop moves energy up on every pass: after `k`
 * passes the band `[f, 2f]` has become `[2^k·f, 2^{k+1}·f]`, energy piles into
 * the top octave, and the loop screams and then aliases. Holding the damping
 * corner at or below `0.5·fs / 2^(s_max/12)` means the shifted band cannot
 * climb past Nyquist before the filter has taken it away.
 *
 * The sheet is explicit that this is a clamp rather than a warning: both this
 * and the blocker below "turn an unstable configuration into an impossible one,
 * which is better than a warning label".
 */
inline double dampingCornerCeiling(const Intervals& intervals, double sampleRate) noexcept {
  const double top = static_cast<double>(intervals.highest());
  if (top <= 0.0) return sampleRate;  // no ceiling: nothing climbs
  return 0.5 * sampleRate / std::pow(2.0, top / 12.0);
}

/// §3.3's blocker corner. A downward shift mirrors the problem into the low end
/// and turns into a rumble, so the corner rises with the deepest shift.
inline double blockerCorner(const Intervals& intervals) noexcept {
  const double bottom = static_cast<double>(intervals.lowest());
  if (bottom >= 0.0) return 20.0;
  return 20.0 * std::pow(2.0, -bottom / 12.0);
}

}  // namespace mw::units::shimmer
