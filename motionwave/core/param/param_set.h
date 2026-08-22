// Motion Wave — a processor's parameters, and the seam they cross on.
//
// One `ParamSet` per node. It owns the specs, the normalised values, the
// smoothers and the inbound ring, and it is the only place a change from
// outside the audio thread becomes a number a processor reads. Sized once at
// construction; nothing here allocates after that, which is what makes the
// no-allocation rule enforceable at one seam instead of everywhere (ADR-0004).
#pragma once

#include <cstddef>
#include <memory>

#include "param_block.h"
#include "param_spec.h"
#include "spsc_ring.h"

namespace mw {

/// A change on its way to the audio thread. Trivially copyable by construction,
/// because the ring will not accept anything else.
struct ParamChange {
  ParamId id = 0;
  float normalised = 0.0f;
  /// Where in the coming buffer the change lands. Reserved for sample-accurate
  /// automation; the block-rate path ignores it and applies at the top.
  int sampleOffset = 0;
};

/// Depth of the inbound ring. A user's finger produces at most one change per
/// UI frame per parameter and automation at most one per parameter per block,
/// so this is roughly two hundred parameters moving at once — far past any real
/// session, and the coalescing below means overflow costs nothing anyway.
inline constexpr std::size_t kParamRingDepth = 256;

class ParamSet {
 public:
  /// `specs` must outlive the set: specs are compile-time tables, not owned
  /// data. Copying them per node would be a needless allocation per instance
  /// of every plugin.
  ParamSet(const ParamSpec* specs, std::size_t count)
      : specs_(specs),
        count_(count),
        values_(new float[count]),
        smoothers_(new Smoother[count]),
        blocks_(new ParamBlock[count]) {
    for (std::size_t i = 0; i < count_; ++i) {
      const float n = specs_[i].defaultNormalised();
      values_[i] = n;
      const float real = specs_[i].toReal(n);
      smoothers_[i].reset(real);
      blocks_[i].start = real;
      blocks_[i].end = real;
      blocks_[i].moving = false;
    }
  }

  /// Called when the device opens or the buffer size changes — never from the
  /// audio thread while it is running.
  void prepare(float sampleRate, int blockFrames) noexcept {
    for (std::size_t i = 0; i < count_; ++i) {
      smoothers_[i].configure(sampleRate, blockFrames, specs_[i].smoothingMs);
      const float real = specs_[i].toReal(values_[i]);
      smoothers_[i].reset(real);
      blocks_[i].start = real;
      blocks_[i].end = real;
      blocks_[i].moving = false;
    }
  }

  // ---------------------------------------------------------------- producer

  /// Post a change from any non-audio thread. Never blocks and never
  /// allocates. A full ring drops the write rather than waiting, which is
  /// correct: the parameter's newest value is the only one that matters, and
  /// the next UI frame or automation block posts it again.
  bool post(ParamId id, float normalised) noexcept {
    ParamChange change;
    change.id = id;
    change.normalised = normalised < 0.0f ? 0.0f : (normalised > 1.0f ? 1.0f : normalised);
    return ring_.push(change);
  }

  /// Post in the parameter's own unit, for callers that think in decibels
  /// rather than in fractions.
  bool postReal(ParamId id, float real) noexcept {
    const ParamSpec* spec = find(id);
    if (spec == nullptr) return false;
    return post(id, spec->toNormalised(real));
  }

  // ---------------------------------------------------------------- consumer

  /// Drain the ring and advance every smoother by one buffer. The first thing a
  /// processor does, before it touches a sample.
  ///
  /// The loop is bounded by the ring's capacity rather than by `size()`: the
  /// producer may push while this runs, and a loop that chased a moving target
  /// could in principle not terminate inside an audio callback.
  void beginBlock() noexcept {
    ParamChange change;
    for (std::size_t drained = 0; drained < ring_.capacity(); ++drained) {
      if (!ring_.pop(change)) break;
      const std::size_t index = indexOf(change.id);
      if (index >= count_) continue;  // a change for a parameter we do not have
      values_[index] = change.normalised;
      const float real = specs_[index].toReal(change.normalised);
      if (specs_[index].isSmoothed()) {
        smoothers_[index].setTarget(real);
      } else {
        smoothers_[index].reset(real);
      }
    }
    for (std::size_t i = 0; i < count_; ++i) blocks_[i] = smoothers_[i].advance();
  }

  /// What the processor reads. Valid until the next `beginBlock`.
  const ParamBlock& block(std::size_t index) const noexcept { return blocks_[index]; }

  /// The settled value, for a processor that does not interpolate.
  float value(std::size_t index) const noexcept { return blocks_[index].end; }

  /// The choice a stepped parameter is on.
  int choice(std::size_t index) const noexcept {
    return specs_[index].toChoice(values_[index]);
  }

  // ------------------------------------------------------------------ shared

  std::size_t size() const noexcept { return count_; }
  const ParamSpec& spec(std::size_t index) const noexcept { return specs_[index]; }
  float normalised(std::size_t index) const noexcept { return values_[index]; }

  /// Linear scan. Parameter counts are tens, not thousands, and a scan over a
  /// contiguous array of ids beats a hash lookup at that size — but this is
  /// called from `beginBlock`, so if a processor ever carries hundreds of
  /// parameters this is the line to revisit.
  std::size_t indexOf(ParamId id) const noexcept {
    for (std::size_t i = 0; i < count_; ++i) {
      if (specs_[i].id == id) return i;
    }
    return count_;
  }

  const ParamSpec* find(ParamId id) const noexcept {
    const std::size_t i = indexOf(id);
    return i < count_ ? &specs_[i] : nullptr;
  }

 private:
  const ParamSpec* specs_;
  std::size_t count_;
  std::unique_ptr<float[]> values_;
  std::unique_ptr<Smoother[]> smoothers_;
  std::unique_ptr<ParamBlock[]> blocks_;
  SpscRing<ParamChange, kParamRingDepth> ring_;
};

}  // namespace mw
