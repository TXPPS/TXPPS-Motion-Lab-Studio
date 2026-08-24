// Motion Wave — the grain engine's view of somebody else's buffer.
//
// `lib-grain-engine.md` §3. Non-owning, exactly like `AudioBuffer` and for the
// same reason: the reverb's buffer is a feedback loop and the delay's is a tap
// line, and an engine that owned the storage would have to hold an opinion
// about which. The unit writes it; the engine only reads behind the write head.
#pragma once

#include "sinc_table.gen.h"

#include <cmath>

namespace mw::dsp::grain {

struct GrainSource {
  const float* data = nullptr;
  /**
   * The second channel, or null for a mono source.
   *
   * **One source with two channels rather than two engines, and the reason is
   * the pool.** `fx-03`'s buffer is stereo where `fx-02`'s is mono, and the
   * obvious answer — an engine per channel — splits every guarantee the pool
   * makes. GE-08's drop accounting, GE-15's zero-allocation proof and the
   * 256-slot sizing at 1.56× the 99.99th percentile all assume one allocation
   * domain: two instances halve the ceiling each, so a burst that fits one
   * shared pool drops in two halved ones, and the drop would appear only under
   * exactly the load the sizing was computed to survive.
   *
   * So the source carries the second channel and `fx-02` is the degenerate
   * instance with `right` null. A null right is not a special case in the
   * render either — it is one branch per block, not per sample, so the mono
   * unit pays nothing for the delay's stereo.
   */
  const float* right = nullptr;
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

  /// True when the two channels are genuinely different buffers.
  bool stereo() const noexcept { return right != nullptr && right != data; }
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
/// The channel a read should come from: `data` for 0, `right` (or `data`) for 1.
inline const float* channelOf(const GrainSource& source, int channel) noexcept {
  return (channel == 1 && source.right != nullptr) ? source.right : source.data;
}

inline float readCubicFrom(const float* data, int mask, double position) noexcept {
  const double floored = std::floor(position);
  const float fraction = static_cast<float>(position - floored);
  const int index = static_cast<int>(static_cast<long long>(floored) & mask);
  const float y0 = data[(index - 1) & mask];
  const float y1 = data[index];
  const float y2 = data[(index + 1) & mask];
  const float y3 = data[(index + 2) & mask];
  const float a = 0.5f * (-y0 + 3.0f * y1 - 3.0f * y2 + y3);
  const float b = y0 - 2.5f * y1 + 2.0f * y2 - 0.5f * y3;
  const float c = 0.5f * (-y0 + y2);
  return ((a * fraction + b) * fraction + c) * fraction + y1;
}

inline float readCubic(const GrainSource& source, double position) noexcept {
  return readCubicFrom(source.data, source.mask, position);
}

/**
 * A read whose anti-imaging filter scales with the pitch ratio.
 *
 * Catmull-Rom above has one fixed kernel, so its cutoff is always Nyquist. That
 * is right when the read increment is one and wrong the moment it is not:
 * reading at `rate` moves source content at `f` to `f·rate`, so everything
 * above `fs/(2·rate)` folds back into the band and no filter applied *after*
 * the read can separate it again. On the Wide set's +19 semitones the fold
 * corner is 8008 Hz, and a 10 kHz tone came back at −17.6 dBFS — an inharmonic
 * component 18 kHz up, at almost the level of the signal, where §9 V12 asks for
 * −70.
 *
 * Evaluating the prototype at `x/rate` gives a kernel whose cutoff is
 * `fs/(2·rate)`, which is precisely the filter the resampling needs, and it
 * costs nothing beyond the taps themselves — there is no separate filtering
 * pass over the buffer. The support grows with the rate, so the tap count does
 * too; that is the honest cost of shifting up, and it is bounded below.
 */
inline float readScaledFrom(const float* data, int mask, double position, double rate,
                            int maxTaps) noexcept {
  /*
   * The *magnitude* of the increment decides the kernel, because a reversed
   * grain reads backwards — its increment is negative — and reads backwards at
   * the same speed. Branching on the signed value would have sent every
   * reversed grain to Catmull-Rom however far up it was pitched, which is
   * exactly the case that needs the wider kernel most; the kernel is symmetric,
   * so the sign matters nowhere else.
   */
  const double speed = rate < 0.0 ? -rate : rate;
  // At or below unity there is no imaging to suppress — the kernel would be
  // narrower than the source's own sample spacing — so Catmull-Rom is both
  // cheaper and correct.
  if (speed <= 1.0) return readCubicFrom(data, mask, position);

  /*
   * The kernel's cutoff goes *below* `fs/(2·rate)`, not at it.
   *
   * A windowed sinc does not fall from passband to stopband at its cutoff; it
   * takes a transition band about `2/W` wide in normalised frequency to get
   * there. Placed exactly at the fold corner, §9 V12's 10 kHz tone — which sits
   * at 1.25 times that corner for the Wide set's +19 semitones — lands inside
   * the transition rather than past it, and measured exactly that way: −47.4
   * dBFS where the row asks for −70. Pulling the cutoff down by this margin
   * puts the same tone at 1.47 times the cutoff, comfortably into the stopband,
   * and costs the top 15 % of a shifted voice's usable band — a band that, for
   * an upward shift, was going to be discarded by the fold anyway.
   */
  constexpr double kCutoffMargin = 0.85;
  const double widened = speed / kCutoffMargin;
  const double span = static_cast<double>(kSincHalfWidth) * widened;
  int half = static_cast<int>(std::ceil(span));
  // Bounded so a large shift cannot make one grain cost unboundedly more than
  // its neighbours. The bound costs stopband depth at extreme ratios, which is
  // the right thing to spend: an unbounded tap count on the audio thread is a
  // deadline miss, and a deadline miss is not a quieter artefact.
  if (half > maxTaps / 2) half = maxTaps / 2;

  const double floored = std::floor(position);
  const int base = static_cast<int>(static_cast<long long>(floored) & mask);
  const double fraction = position - floored;
  const double perStep = static_cast<double>(kSincStepsPerUnit) / widened;

  double sum = 0.0;
  double weight = 0.0;
  for (int tap = -half + 1; tap <= half; ++tap) {
    // The prototype's own axis is this source sample's distance from the read
    // position divided by the rate, which is what turns one curve into the
    // family of kernels whose cutoffs are fs/(2·rate).
    const double at = std::fabs(static_cast<double>(tap) - fraction) * perStep;
    const int index = static_cast<int>(at);
    if (index >= kSincTablePoints - 1) continue;
    const double blend = at - static_cast<double>(index);
    const double h = static_cast<double>(kSincPrototype[index]) * (1.0 - blend) +
                     static_cast<double>(kSincPrototype[index + 1]) * blend;
    sum += h * static_cast<double>(data[(base + tap) & mask]);
    weight += h;
  }
  /*
   * Normalised by the weight actually used rather than by `1/rate`.
   *
   * The closed-form scaling assumes the whole kernel is present; the tap bound
   * above means it sometimes is not, and a truncated kernel that kept the
   * closed-form gain would make the shifted voice quieter exactly where it was
   * already being degraded. Dividing by the realised sum makes the read unity
   * at DC whatever the bound did.
   */
  return weight > 1.0e-9 ? static_cast<float>(sum / weight) : 0.0f;
}

inline float readScaled(const GrainSource& source, double position, double rate,
                        int maxTaps) noexcept {
  return readScaledFrom(source.data, source.mask, position, rate, maxTaps);
}

/// Linear, for the Eco tier. GE-11 publishes its alias figure untiered rather
/// than grading it, because the tier exists to be cheap and saying so is more
/// use than holding it to a number it is not trying to meet.
inline float readLinearFrom(const float* data, int mask, double position) noexcept {
  const double floored = std::floor(position);
  const float fraction = static_cast<float>(position - floored);
  const int index = static_cast<int>(static_cast<long long>(floored) & mask);
  const float y1 = data[index];
  const float y2 = data[(index + 1) & mask];
  return y1 + (y2 - y1) * fraction;
}

inline float readLinear(const GrainSource& source, double position) noexcept {
  return readLinearFrom(source.data, source.mask, position);
}

}  // namespace mw::dsp::grain
