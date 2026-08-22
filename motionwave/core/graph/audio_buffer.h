// Motion Wave — the buffer a processor is handed.
//
// A non-owning view: channel pointers and a frame count, nothing else. The
// graph owns the storage and allocates it once in `prepare`, so a processor
// that wants scratch space asks for it there rather than taking it during
// `process`. That is the whole reason this type does not own anything — a
// buffer that could allocate is a buffer someone will allocate.
#pragma once

#include <cstddef>
#include <cstring>

namespace mw {

class AudioBuffer {
 public:
  AudioBuffer() = default;
  AudioBuffer(float* const* channels, int channelCount, int frames)
      : channels_(channels), channelCount_(channelCount), frames_(frames) {}

  int channelCount() const noexcept { return channelCount_; }
  int frames() const noexcept { return frames_; }
  bool valid() const noexcept { return channels_ != nullptr && channelCount_ > 0; }

  float* channel(int c) noexcept { return channels_[c]; }
  const float* channel(int c) const noexcept { return channels_[c]; }

  /// A view of the same storage over fewer frames. Used by anything that
  /// processes a buffer in pieces — an automation point mid-block, a grain
  /// boundary — without copying.
  AudioBuffer head(int frames) const noexcept {
    return AudioBuffer(channels_, channelCount_, frames < frames_ ? frames : frames_);
  }

  void clear() noexcept {
    for (int c = 0; c < channelCount_; ++c) {
      std::memset(channels_[c], 0, static_cast<std::size_t>(frames_) * sizeof(float));
    }
  }

  /// Copies `src` over this buffer, channel for channel. A source with fewer
  /// channels repeats its last one, which is what makes a mono send feed a
  /// stereo bus without a separate code path.
  void copyFrom(const AudioBuffer& src) noexcept {
    const int frames = frames_ < src.frames_ ? frames_ : src.frames_;
    for (int c = 0; c < channelCount_; ++c) {
      const int sc = c < src.channelCount_ ? c : src.channelCount_ - 1;
      if (sc < 0) break;
      std::memcpy(channels_[c], src.channels_[sc],
                  static_cast<std::size_t>(frames) * sizeof(float));
    }
  }

  /// Sums `src` into this buffer. The mixer's only operation.
  void addFrom(const AudioBuffer& src, float gain = 1.0f) noexcept {
    const int frames = frames_ < src.frames_ ? frames_ : src.frames_;
    for (int c = 0; c < channelCount_; ++c) {
      const int sc = c < src.channelCount_ ? c : src.channelCount_ - 1;
      if (sc < 0) break;
      float* dst = channels_[c];
      const float* in = src.channels_[sc];
      for (int i = 0; i < frames; ++i) dst[i] += in[i] * gain;
    }
  }

  /// Largest absolute sample. Used by tests and meters; never by DSP, which
  /// should not need to scan a buffer it just wrote.
  float peak() const noexcept {
    float worst = 0.0f;
    for (int c = 0; c < channelCount_; ++c) {
      const float* in = channels_[c];
      for (int i = 0; i < frames_; ++i) {
        const float a = in[i] < 0.0f ? -in[i] : in[i];
        if (a > worst) worst = a;
      }
    }
    return worst;
  }

 private:
  float* const* channels_ = nullptr;
  int channelCount_ = 0;
  int frames_ = 0;
};

}  // namespace mw
