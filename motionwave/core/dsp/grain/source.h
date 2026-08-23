// Motion Wave — the grain engine's view of somebody else's buffer.
//
// `lib-grain-engine.md` §3. Non-owning, exactly like `AudioBuffer` and for the
// same reason: the reverb's buffer is a feedback loop and the delay's is a tap
// line, and an engine that owned the storage would have to hold an opinion
// about which. The unit writes it; the engine only reads behind the write head.
#pragma once

#include <cmath>

namespace mw::dsp::grain {

struct GrainSource {
  const float* data = nullptr;
  /// Power of two, so the wrap is a mask. A modulo per interpolated read per
  /// grain is a division in the innermost loop this engine has.
  int capacity = 0;
  int mask = 0;
  /**
   * Where the unit's write head is *at the first frame of this block*.
   *
   * The engine advances its own copy per sample and never re-reads this
   * mid-block, because a read offset measured against a moving head is not an
   * offset — it is an offset plus however far the head happened to travel, and
   * that difference is a block size.
   */
  int writeIndex = 0;
  double sampleRate = 48000.0;

  bool valid() const noexcept {
    return data != nullptr && capacity > 0 && (capacity & (capacity - 1)) == 0 &&
           mask == capacity - 1;
  }
};

/**
 * Catmull-Rom at a fractional position, wrapping on the mask.
 *
 * Cubic rather than linear because GE-11 grades the alias floor at −60 and
 * −70 dBFS for the two upper tiers and linear interpolation reaches neither at a
 * pitch ratio of two; and Catmull-Rom rather than a windowed sinc because this
 * runs once per grain per sample and the engine's whole CPU budget is linear in
 * overlap.
 *
 * `position` is an absolute index into the circular buffer, fractional.
 */
inline float readCubic(const GrainSource& source, double position) noexcept {
  const double floored = std::floor(position);
  const float fraction = static_cast<float>(position - floored);
  const int index = static_cast<int>(static_cast<long long>(floored) & source.mask);
  const int mask = source.mask;
  const float y0 = source.data[(index - 1) & mask];
  const float y1 = source.data[index];
  const float y2 = source.data[(index + 1) & mask];
  const float y3 = source.data[(index + 2) & mask];
  const float a = 0.5f * (-y0 + 3.0f * y1 - 3.0f * y2 + y3);
  const float b = y0 - 2.5f * y1 + 2.0f * y2 - 0.5f * y3;
  const float c = 0.5f * (-y0 + y2);
  return ((a * fraction + b) * fraction + c) * fraction + y1;
}

/// Linear, for the Eco tier. GE-11 publishes its alias figure untiered rather
/// than grading it, because the tier exists to be cheap and saying so is more
/// use than holding it to a number it is not trying to meet.
inline float readLinear(const GrainSource& source, double position) noexcept {
  const double floored = std::floor(position);
  const float fraction = static_cast<float>(position - floored);
  const int index = static_cast<int>(static_cast<long long>(floored) & source.mask);
  const float y1 = source.data[index];
  const float y2 = source.data[(index + 1) & source.mask];
  return y1 + (y2 - y1) * fraction;
}

}  // namespace mw::dsp::grain
