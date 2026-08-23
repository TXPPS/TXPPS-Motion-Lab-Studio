// Motion Wave — what the audio thread tells the face.
//
// Ledger cell 20 is that a visualiser shows *real engine state*: the playhead
// sits at the phase the modulator is actually at, the band shading is the level
// those bands actually carry, the ghosted waveform is the signal actually going
// in. Nothing decorative. A face that animates plausibly from the control values
// is drawing a second opinion, and the one that is wrong is always the one
// nobody is listening to.
//
// That makes this a publishing problem, and publishing across the audio boundary
// has exactly two hard rules. The audio thread may not block — so no mutex — and
// it may not allocate — so no queue that grows. A seqlock satisfies both: the
// writer bumps a counter, writes, bumps it again, and never waits for anyone.
// The reader retries if it caught a write in progress. Contention is a torn read
// the reader discards, not a stall the audio thread suffers.
//
// The cost on the audio thread is a handful of stores per block. That is what
// "zero audio-thread work added" has to mean in practice: not literally nothing,
// but nothing that can block, allocate, or scale with anything.
#pragma once

#include <atomic>
#include <cstdint>

namespace mw::dsp {

/// Bands a published frame can describe. Matches the widest unit that publishes.
inline constexpr int kVisualBands = 3;

/**
 * One frame of what a unit is doing, as the face needs to draw it.
 *
 * Plain data with no pointers, so it can be copied whole and handed across the
 * WebAssembly boundary as bytes. Every field is what the DSP *did*, never what
 * it was asked to do — `phase` is the modulator's own position after swing and
 * offset, not the phase the control implies.
 */
struct VisualFrame {
  /// Modulator position in its cycle, 0…1, where the playhead goes.
  float phase = 0.0f;
  /// Gain each band's modulator is applying right now, as a linear factor.
  float bandGain[kVisualBands] = {1.0f, 1.0f, 1.0f};
  /// Peak level entering each band this block, for the spectrum shading.
  float bandPeak[kVisualBands] = {0.0f, 0.0f, 0.0f};
  /// Peak of the input this block, for the ghosted waveform behind the curve.
  float inputPeak = 0.0f;
  /// Peak of the output, so a face can show what the unit did to the level.
  float outputPeak = 0.0f;
  /// True while a topology crossfade is running, which a face may want to show
  /// rather than appear to glitch.
  std::uint32_t crossfading = 0;
};

/**
 * A seqlock around one `VisualFrame`.
 *
 * The sequence is odd while a write is in progress and even when it is
 * complete, so a reader that sees the same even sequence either side of its
 * copy knows nothing changed underneath it. The writer never checks whether
 * anyone is reading, which is the property that makes this safe to call from
 * `process`.
 *
 * `relaxed` for the payload with `release`/`acquire` on the sequence: the
 * ordering that matters is that the payload's stores land *before* the closing
 * sequence bump, and that a reader's loads happen *after* it sees the opening
 * one. Making every field atomic would be slower and would not add a guarantee.
 */
class VisualPublisher {
 public:
  /// Called from the audio thread. Never blocks, never allocates.
  void publish(const VisualFrame& frame) noexcept {
    const std::uint32_t start = sequence_.load(std::memory_order_relaxed);
    sequence_.store(start + 1, std::memory_order_relaxed);
    std::atomic_thread_fence(std::memory_order_release);
    frame_ = frame;
    std::atomic_thread_fence(std::memory_order_release);
    sequence_.store(start + 2, std::memory_order_release);
  }

  /**
   * Called from the UI thread. Returns false when the frame was being written
   * and the caller should keep the one it had.
   *
   * A failed read is not an error and must not be retried forever: at 60 Hz
   * against a 48 kHz block rate the odds of catching a write are tiny, and the
   * right response to catching one is to draw last frame again — which is a
   * frame old, and invisible. Spinning would be a UI thread waiting on audio,
   * which is the dependency this whole structure exists to avoid.
   */
  bool read(VisualFrame& out) const noexcept {
    const std::uint32_t before = sequence_.load(std::memory_order_acquire);
    if ((before & 1u) != 0u) return false;
    std::atomic_thread_fence(std::memory_order_acquire);
    out = frame_;
    std::atomic_thread_fence(std::memory_order_acquire);
    return sequence_.load(std::memory_order_acquire) == before;
  }

  /// How many frames have been published, for a face to detect a stalled engine.
  std::uint32_t generation() const noexcept {
    return sequence_.load(std::memory_order_acquire) >> 1;
  }

 private:
  std::atomic<std::uint32_t> sequence_{0};
  VisualFrame frame_{};
};

}  // namespace mw::dsp
