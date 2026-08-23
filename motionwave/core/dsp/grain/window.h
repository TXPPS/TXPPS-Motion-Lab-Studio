// Motion Wave — grain windows and the constants the normalisation depends on.
//
// `lib-grain-engine.md` §3 and §5.3. The moments live beside the tables in
// `window_tables.gen.h` and both come out of one generator, because a window
// whose mean-square constant has drifted from its samples makes the device get
// louder as density rises — the user trims the output, and then the feedback
// loop's gain changes with density and the reverb runs away.
#pragma once

#include "window_tables.gen.h"

#include <cstdint>

namespace mw::dsp::grain {

enum class WindowShape : std::uint8_t { Hann = 0, Tukey = 1, Gaussian = 2, Rectangular = 3 };

/// Linear interpolation into a window table. The guard sample at `kWindowPoints`
/// is what lets phase reach exactly 1.0 without a branch in the inner loop.
inline float lookup(const float* table, float phase) noexcept {
  const float scaled = phase * static_cast<float>(kWindowPoints);
  int index = static_cast<int>(scaled);
  if (index < 0) index = 0;
  if (index >= kWindowPoints) return table[kWindowPoints];
  const float fraction = scaled - static_cast<float>(index);
  return table[index] + (table[index + 1] - table[index]) * fraction;
}

/**
 * The window at a phase in [0, 1].
 *
 * **Tukey is a phase remap of the Hann table, not a table of its own.** A Tukey
 * window is a Hann taper of total length `alpha` split across the two ends with
 * a flat middle, so the taper regions are exactly the two halves of a Hann of
 * period `alpha`. Remapping the phase into the same table is what makes
 * Tukey(α=1) equal Hann *bit for bit* rather than to within a rounding, which
 * GE-01 asserts and which a second table could only ever approximate.
 */
inline float windowAt(WindowShape shape, float phase, float tukeyAlpha) noexcept {
  if (phase <= 0.0f) phase = 0.0f;
  if (phase >= 1.0f) phase = 1.0f;
  switch (shape) {
    case WindowShape::Rectangular:
      return 1.0f;
    case WindowShape::Tukey: {
      float alpha = tukeyAlpha;
      if (alpha <= 0.0f) return 1.0f;
      if (alpha > 1.0f) alpha = 1.0f;
      const float half = alpha * 0.5f;
      float mapped;
      if (phase < half) {
        mapped = phase / alpha;
      } else if (phase > 1.0f - half) {
        mapped = 1.0f - (1.0f - phase) / alpha;
      } else {
        return 1.0f;
      }
      return lookup(kHannWindow, mapped);
    }
    case WindowShape::Gaussian:
      return lookup(kGaussianWindow, phase);
    case WindowShape::Hann:
    default:
      return lookup(kHannWindow, phase);
  }
}

/**
 * Mean of the window, for the coherent normalisation this engine does *not*
 * offer — exposed because the reverb's freeze path needs it and because a
 * library that hides half of a pair invites someone to re-derive the other.
 */
inline float windowMean(WindowShape shape, float tukeyAlpha) noexcept {
  switch (shape) {
    case WindowShape::Rectangular:
      return 1.0f;
    case WindowShape::Gaussian:
      return kGaussianMean;
    case WindowShape::Tukey: {
      const float alpha = tukeyAlpha < 0.0f ? 0.0f : (tukeyAlpha > 1.0f ? 1.0f : tukeyAlpha);
      // The flat middle contributes 1 over its length and the tapers contribute
      // Hann's mean over theirs. Exact, and it reduces to Hann's own at α = 1.
      return (1.0f - alpha) + alpha * kHannMean;
    }
    case WindowShape::Hann:
    default:
      return kHannMean;
  }
}

/**
 * Mean of the window squared. This is the one the amplitude normalisation uses.
 *
 * §5.3: grains here are incoherent — asynchronous onsets, randomised read
 * positions — so powers add and `A = 1/sqrt(O·mean(w²))` is the correct
 * normalisation. The coherent form is 6 dB out and is deliberately not offered
 * one enum value away.
 */
inline float windowMeanSquare(WindowShape shape, float tukeyAlpha) noexcept {
  switch (shape) {
    case WindowShape::Rectangular:
      return 1.0f;
    case WindowShape::Gaussian:
      return kGaussianMeanSquare;
    case WindowShape::Tukey: {
      const float alpha = tukeyAlpha < 0.0f ? 0.0f : (tukeyAlpha > 1.0f ? 1.0f : tukeyAlpha);
      return (1.0f - alpha) + alpha * kHannMeanSquare;
    }
    case WindowShape::Hann:
    default:
      return kHannMeanSquare;
  }
}

}  // namespace mw::dsp::grain
