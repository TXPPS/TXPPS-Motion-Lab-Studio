// Motion Wave — what a processor reads.
//
// The audio thread does not read "the value of parameter 7". It reads how that
// parameter behaves across the coming buffer: where it started, where it ends,
// and whether it moved at all. Automation, modulation and a user's finger all
// arrive as the same thing, so a processor never has to know which of them
// moved it (ADR-0004).
#pragma once

#include <cmath>

namespace mw {

/// One parameter across one buffer, in the parameter's own real unit.
struct ParamBlock {
  float start = 0.0f;
  float end = 0.0f;
  /// False when the value is constant across the buffer, which is the common
  /// case and lets a processor take its cheap path without comparing floats.
  bool moving = false;

  /// The value at a sample offset within a buffer of `frames`. Linear across
  /// the block: the smoother's own curve is exponential, but over 256 samples
  /// the difference is inaudible and a line is one multiply.
  float at(int frame, int frames) const noexcept {
    if (!moving || frames <= 1) return end;
    const float t = static_cast<float>(frame) / static_cast<float>(frames - 1);
    return start + (end - start) * t;
  }

  /// The per-sample increment for a processor that would rather add than
  /// interpolate.
  float increment(int frames) const noexcept {
    if (!moving || frames <= 1) return 0.0f;
    return (end - start) / static_cast<float>(frames - 1);
  }
};

/// A one-pole travelling toward a target, advanced once per buffer.
///
/// Run on the audio thread at block rate rather than per sample: the ramp
/// inside `ParamBlock` covers the buffer, and a one-pole evaluated every sample
/// would cost an exponential per sample to describe a line the processor is
/// going to interpolate anyway.
class Smoother {
 public:
  /// `timeMs` of zero makes this a pass-through, which is what a switch wants.
  void configure(float sampleRate, int blockFrames, float timeMs) noexcept {
    if (timeMs <= 0.0f || sampleRate <= 0.0f || blockFrames <= 0) {
      coefficient_ = 1.0f;
      return;
    }
    // Fraction of the remaining distance covered by one buffer. Expressed in
    // buffers rather than samples because that is the rate it is advanced at,
    // and deriving it per block from the sample rate would put a call to exp()
    // in the audio callback for a number that only changes when the device
    // does.
    const float tau = (timeMs * 0.001f) * sampleRate;
    const float blocks = static_cast<float>(blockFrames);
    coefficient_ = 1.0f - std::exp(-blocks / (tau > 1.0f ? tau : 1.0f));
    if (coefficient_ > 1.0f) coefficient_ = 1.0f;
  }

  /// Jump without travelling. Used when a processor is (re)configured, where
  /// gliding up from silence would be an audible artefact of loading a preset.
  void reset(float value) noexcept {
    current_ = value;
    target_ = value;
  }

  void setTarget(float value) noexcept { target_ = value; }

  float current() const noexcept { return current_; }
  float target() const noexcept { return target_; }

  /// Advance one buffer and describe the journey.
  ParamBlock advance() noexcept {
    const float from = current_;
    current_ += (target_ - current_) * coefficient_;
    // Snap when the remaining distance stops mattering, so a parameter that has
    // arrived reports `moving == false` and every processor downstream takes
    // its constant path instead of interpolating a line of zero length forever.
    if (std::fabs(target_ - current_) < kEpsilon * (1.0f + std::fabs(target_))) {
      current_ = target_;
    }
    ParamBlock block;
    block.start = from;
    block.end = current_;
    block.moving = from != current_;
    return block;
  }

 private:
  static constexpr float kEpsilon = 1e-6f;
  float current_ = 0.0f;
  float target_ = 0.0f;
  float coefficient_ = 1.0f;
};

}  // namespace mw
