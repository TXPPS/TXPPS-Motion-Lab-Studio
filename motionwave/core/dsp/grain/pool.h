// Motion Wave — the grain pool, and why exhaustion is unreachable.
//
// `lib-grain-engine.md` §5.6. The arithmetic there is the whole argument: at the
// Max tier's cap of ninety-six expected grains, length jitter of ±25 % lifts the
// worst-case mean to 120, a Poisson count's 99.99th percentile is about
// 120 + 4·sqrt(120) = 164, and the pool is 256. That is 1.56× the percentile and
// 2.13× the mean, which is why `dropped == 0` is a design guarantee rather than
// a hope — and GE-08 asserts it as exactly zero at five densities over sixty
// seconds each.
#pragma once

#include "grain.h"

#include <cstddef>
#include <cstdint>

namespace mw::dsp::grain {

/**
 * Fixed-size slot store with a free/active partition.
 *
 * **Membership is a position, not a flag.** Two flags can disagree with each
 * other and with a count; a position cannot. `active()` returns a contiguous
 * prefix, so the render loop has no liveness branch and no gaps to skip — which
 * matters more than it sounds, because the render loop is the engine's whole
 * CPU budget and GE-20 grades it as linear in overlap.
 */
class GrainPool {
 public:
  static std::size_t storageBytes(int slots) noexcept {
    return static_cast<std::size_t>(slots < 0 ? 0 : slots) * sizeof(Grain);
  }

  void prepare(int slots, int tapCount, void* storage, std::size_t bytes) noexcept {
    capacity_ = slots < 0 ? 0 : slots;
    if (bytes < storageBytes(capacity_)) capacity_ = 0;
    tapCount_ = tapCount < 1 ? 1 : tapCount;
    grains_ = static_cast<Grain*>(storage);
    reservation_ = capacity_ / tapCount_;
    reset();
  }

  void reset() noexcept {
    activeCount_ = 0;
    for (int t = 0; t < kMaxTaps; ++t) perTap_[t] = 0;
  }

  /**
   * A free slot for this tap, or null.
   *
   * **Per-tap reservation, §5.6.** Each tap is guaranteed `slots / tapCount`
   * and may borrow from the surplus above that. Without it a tap at Smear 100 %
   * starves a tap at Smear 25 %, one tap of a multi-tap delay silently stops
   * sounding, and it reads as a routing bug rather than a pool bug — which is
   * the kind of misattribution that costs a day.
   *
   * Null is a *miss*, counted by the caller. The pool never waits and never
   * grows: growing would allocate on the audio thread and waiting would be a
   * dropout.
   */
  Grain* acquire(std::uint8_t tap) noexcept {
    if (activeCount_ >= capacity_) return nullptr;
    const int index = tap < kMaxTaps ? tap : 0;
    if (perTap_[index] >= reservation_) {
      // Beyond its reservation this tap is competing for the surplus, which is
      // whatever the other taps have not claimed of theirs.
      int claimed = 0;
      for (int t = 0; t < tapCount_ && t < kMaxTaps; ++t) {
        claimed += perTap_[t] < reservation_ ? reservation_ : perTap_[t];
      }
      if (claimed >= capacity_) return nullptr;
    }
    Grain* slot = &grains_[activeCount_++];
    ++perTap_[index];
    return slot;
  }

  /**
   * Retire by index into the active prefix.
   *
   * The last active grain is swapped into the freed slot, so **slot indices are
   * not stable across a retirement** — which is exactly why `Grain::id` exists
   * and why the visualiser keys on it. A particle keyed on a slot index would
   * teleport whenever an unrelated neighbour ended, and GE-13 is the case that
   * catches it.
   */
  void retire(int activeIndex) noexcept {
    if (activeIndex < 0 || activeIndex >= activeCount_) return;
    const int tap = grains_[activeIndex].tap < kMaxTaps ? grains_[activeIndex].tap : 0;
    if (perTap_[tap] > 0) --perTap_[tap];
    const int last = activeCount_ - 1;
    if (activeIndex != last) grains_[activeIndex] = grains_[last];
    --activeCount_;
  }

  Grain* active() noexcept { return grains_; }
  const Grain* active() const noexcept { return grains_; }
  int activeCount() const noexcept { return activeCount_; }
  int capacity() const noexcept { return capacity_; }
  int reservationPerTap() const noexcept { return reservation_; }
  int activeForTap(std::uint8_t tap) const noexcept {
    return tap < kMaxTaps ? perTap_[tap] : 0;
  }

  static constexpr int kMaxTaps = 8;

 private:
  Grain* grains_ = nullptr;
  int capacity_ = 0;
  int activeCount_ = 0;
  int tapCount_ = 1;
  int reservation_ = 0;
  int perTap_[kMaxTaps] = {0, 0, 0, 0, 0, 0, 0, 0};
};

}  // namespace mw::dsp::grain
