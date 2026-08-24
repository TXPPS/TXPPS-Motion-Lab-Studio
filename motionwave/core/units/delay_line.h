// Motion Wave — the Granular Delay's buffer and one tap's read.
//
// `fx-03` §1.2: one buffer, N taps. The taps read it; nothing else does. That
// is what makes the topologies a routing choice rather than three engines, and
// it is also what bounds the memory — a per-tap buffer would multiply the
// largest allocation in the unit by the tap count.
#pragma once

#include "../dsp/grain/source.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace mw::units::delay {

/**
 * A stereo circular buffer sized in seconds, with a power-of-two capacity.
 *
 * Power of two so the wrap is a mask rather than a modulo: the read happens
 * once per tap per grain per sample, which is the innermost loop this unit has,
 * and a division there is the difference between a delay that runs sixteen
 * instances on a phone and one that runs four.
 */
class DelayBuffer {
 public:
  void prepare(double sampleRate, double seconds) {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    int wanted = static_cast<int>(sampleRate_ * seconds) + 4;
    int capacity = 1;
    while (capacity < wanted) capacity <<= 1;
    capacity_ = capacity;
    mask_ = capacity - 1;
    left_.assign(static_cast<std::size_t>(capacity_), 0.0f);
    right_.assign(static_cast<std::size_t>(capacity_), 0.0f);
    reset();
  }

  void reset() noexcept {
    for (float& v : left_) v = 0.0f;
    for (float& v : right_) v = 0.0f;
    writeIndex_ = 0;
  }

  void write(float l, float r) noexcept {
    left_[static_cast<std::size_t>(writeIndex_ & mask_)] = l;
    right_[static_cast<std::size_t>(writeIndex_ & mask_)] = r;
    ++writeIndex_;
  }

  /// Where the write head is at the first frame of a block. See `GrainSource`.
  int writeIndex() const noexcept { return writeIndex_; }
  int capacity() const noexcept { return capacity_; }
  double sampleRate() const noexcept { return sampleRate_; }

  /// The longest delay this buffer can hold, which is what a tap clamps to.
  double maxDelaySeconds() const noexcept {
    // Two grains of headroom below the capacity, because a pitched grain reads
    // *further* back than its own start — see `reachSeconds` below.
    return static_cast<double>(capacity_) / sampleRate_ - 0.5;
  }

  dsp::grain::GrainSource view(int channel) const noexcept {
    dsp::grain::GrainSource source;
    source.data = channel == 0 ? left_.data() : right_.data();
    source.capacity = capacity_;
    source.mask = mask_;
    source.writeIndex = writeIndex_;
    source.sampleRate = sampleRate_;
    return source;
  }

  /// A plain interpolated read, `delaySamples` behind the head.
  float read(int channel, double delaySamples) const noexcept {
    const dsp::grain::GrainSource source = view(channel);
    return dsp::grain::readCubic(source, static_cast<double>(writeIndex_) - delaySamples);
  }

 private:
  double sampleRate_ = 48000.0;
  int capacity_ = 0;
  int mask_ = 0;
  int writeIndex_ = 0;
  std::vector<float> left_;
  std::vector<float> right_;
};

/**
 * How far back a pitched grain reaches, in seconds.
 *
 * §2: a pitched tap consumes source material at rate `r`, so a grain of length
 * `L` covers `r·L` seconds of buffer — and §2 says to clamp, because a tap
 * whose reach runs past the buffer reads uninitialised memory. That is not a
 * quiet defect: at two octaves up a 120 ms grain reaches back 480 ms, so a tap
 * set near the end of a one-second buffer walks off it.
 */
inline double reachSeconds(double pitchRatio, double grainSeconds) noexcept {
  const double r = pitchRatio < 0.0 ? -pitchRatio : pitchRatio;
  return (r < 1.0 ? 1.0 : r) * grainSeconds;
}

/**
 * The greatest delay a tap may be given, once its own reach is accounted for.
 *
 * Written as a function rather than applied at the setter so the *face* can ask
 * it too: a control whose top end silently means something different depending
 * on another control is worse than one whose range visibly shortens.
 */
inline double clampDelaySeconds(double asked, const DelayBuffer& buffer, double pitchRatio,
                                double grainSeconds) noexcept {
  const double ceiling = buffer.maxDelaySeconds() - reachSeconds(pitchRatio, grainSeconds);
  const double top = ceiling < 0.001 ? 0.001 : ceiling;
  return asked < 0.0 ? 0.0 : (asked > top ? top : asked);
}

}  // namespace mw::units::delay
