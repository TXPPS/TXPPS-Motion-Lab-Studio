// Motion Wave — one grain, and what it captures at birth.
//
// `lib-grain-engine.md` §3 and §5.4.
#pragma once

#include "source.h"
#include "window.h"

#include <cmath>
#include <cstdint>

namespace mw::dsp::grain {

/**
 * What a grain captures at spawn and never re-reads.
 *
 * A grain that consulted a live parameter mid-flight would change pitch or pan
 * under a user's hand, and would make the visualiser's particles disagree with
 * what is sounding — the particle would be drawn from the parameter and the
 * sound would come from wherever the grain had got to. Everything a grain needs
 * is frozen here.
 */
struct GrainSpec {
  double readOffset = 0.0;  ///< samples behind the write head, fractional
  int lengthSamples = 0;
  float pitchRatio = 1.0f;
  float amplitude = 1.0f;
  float pan = 0.0f;            ///< −1 hard left, +1 hard right
  float onsetFraction = 0.0f;  ///< sub-sample onset, 0..1
  WindowShape shape = WindowShape::Hann;
  float tukeyAlpha = 1.0f;
  bool reverse = false;
  std::uint8_t tap = 0;
};

/// One live grain. Trivially copyable, no owning members.
struct Grain {
  double readPos = 0.0;
  double readInc = 1.0;
  float windowPhase = 0.0f;
  float windowInc = 0.0f;
  int remaining = 0;
  int length = 0;
  float gainL = 0.0f;
  float gainR = 0.0f;
  float amplitude = 1.0f;
  float pitchRatio = 1.0f;
  float pan = 0.0f;
  float tukeyAlpha = 1.0f;
  /// The windowed amplitude the last rendered sample used. Read by the
  /// visualiser rather than recomputed, per §5.7.
  float lastWindow = 0.0f;
  std::uint32_t id = 0;
  WindowShape shape = WindowShape::Hann;
  std::uint8_t tap = 0;
  bool reverse = false;
};

/**
 * Equal-power pan.
 *
 * Equal-power rather than linear because grains are incoherent and their powers
 * add: a linear law would make a spread of grains quieter in the middle of the
 * image than at its edges, which reads as a hole in the stereo field that gets
 * deeper as spread rises.
 */
inline void panGains(float pan, float* left, float* right) noexcept {
  const float clamped = pan < -1.0f ? -1.0f : (pan > 1.0f ? 1.0f : pan);
  const float angle = (clamped + 1.0f) * 0.25f * 3.14159265358979323846f;
  *left = std::cos(angle);
  *right = std::sin(angle);
}

/**
 * Fill a grain from its spec.
 *
 * `writeIndex` is the source's write head at the first frame of the block, and
 * `onsetFrame` is how many frames into the block this grain starts — the two
 * together are where "behind the write head" is measured from. Getting that
 * wrong is not audible as a wrong position; it is audible as every grain in a
 * block reading from the same place, which sounds like a comb filter that
 * changes with the host's buffer size.
 */
inline void spawnGrain(Grain* grain, const GrainSpec& spec, const GrainSource& source,
                       int onsetFrame, std::uint32_t id) noexcept {
  const double head = static_cast<double>(source.writeIndex) + static_cast<double>(onsetFrame);
  const double start = head - spec.readOffset - static_cast<double>(spec.onsetFraction);
  grain->length = spec.lengthSamples < 1 ? 1 : spec.lengthSamples;
  grain->remaining = grain->length;
  grain->pitchRatio = spec.pitchRatio;
  grain->reverse = spec.reverse;
  // A reversed grain starts at the far end of the span it will read and walks
  // back, so it covers exactly the samples the forward grain would have. The
  // alternative — starting at the same place and decrementing — reads *ahead*
  // of the write head, which is the future.
  const double span = static_cast<double>(grain->length) * static_cast<double>(spec.pitchRatio);
  grain->readPos = spec.reverse ? start + span : start;
  grain->readInc = spec.reverse ? -static_cast<double>(spec.pitchRatio)
                                : static_cast<double>(spec.pitchRatio);
  grain->windowInc = 1.0f / static_cast<float>(grain->length);
  // The sub-sample onset moves the window's phase as well as the read position.
  // Moving only the read position leaves every grain's envelope quantised to
  // the sample grid, which is exactly the block-rate artefact GE-03 measures.
  grain->windowPhase = spec.onsetFraction * grain->windowInc;
  grain->amplitude = spec.amplitude;
  grain->pan = spec.pan;
  grain->shape = spec.shape;
  grain->tukeyAlpha = spec.tukeyAlpha;
  grain->tap = spec.tap;
  grain->id = id;
  grain->lastWindow = 0.0f;
  float left = 0.0f;
  float right = 0.0f;
  panGains(spec.pan, &left, &right);
  grain->gainL = left * spec.amplitude;
  grain->gainR = right * spec.amplitude;
}

/// One sample from one grain, accumulated into a stereo pair. Returns false
/// when the grain has finished and its slot may be retired.
template <bool kCubic>
inline bool renderGrainSample(Grain* grain, const GrainSource& source, float* left,
                              float* right) noexcept {
  if (grain->remaining <= 0) return false;
  const float window = windowAt(grain->shape, grain->windowPhase, grain->tukeyAlpha);
  const float sample = kCubic ? readCubic(source, grain->readPos) : readLinear(source, grain->readPos);
  const float value = sample * window;
  *left += value * grain->gainL;
  *right += value * grain->gainR;
  grain->lastWindow = window;
  grain->readPos += grain->readInc;
  grain->windowPhase += grain->windowInc;
  return --grain->remaining > 0;
}

}  // namespace mw::dsp::grain
