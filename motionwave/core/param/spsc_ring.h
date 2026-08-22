// Motion Wave — the one structure allowed to cross the audio thread boundary.
//
// A single-producer, single-consumer ring buffer over storage that is allocated
// once, at construction, and never again. This is the whole mechanism by which
// a user's finger reaches a filter coefficient and by which a meter reaches the
// screen; ADR-0004 says nothing else crosses, and nothing else does.
//
// Wait-free on both sides. The producer never blocks and never grows the
// buffer: a full ring drops the oldest-relevant write rather than allocating,
// because a parameter's newest value is the only one that matters and a
// visualiser that misses a frame draws the previous one.
#pragma once

#include <atomic>
#include <cstddef>
#include <memory>
#include <type_traits>

namespace mw {

/// `Capacity` is rounded up to a power of two so the index wrap is a mask
/// rather than a modulo — the consumer runs in the audio callback, where a
/// division per element is a cost with no reason to exist.
template <typename T, std::size_t Capacity>
class SpscRing {
  static_assert(std::is_trivially_copyable<T>::value,
                "A type crossing the audio boundary must be trivially copyable: "
                "copying it must not allocate, lock, or run a destructor.");
  static_assert(Capacity >= 2, "A ring needs room for at least one element plus the gap.");

 public:
  SpscRing() : storage_(new T[kCapacity]) {}

  /// Producer side. Returns false when the ring is full; the caller decides
  /// what to do about it, and for parameters the answer is to coalesce rather
  /// than to wait.
  bool push(const T& value) noexcept {
    const std::size_t w = write_.load(std::memory_order_relaxed);
    const std::size_t next = (w + 1) & kMask;
    if (next == read_.load(std::memory_order_acquire)) return false;  // full
    storage_[w] = value;
    write_.store(next, std::memory_order_release);
    return true;
  }

  /// Consumer side — the audio thread. No allocation, no lock, no syscall.
  bool pop(T& out) noexcept {
    const std::size_t r = read_.load(std::memory_order_relaxed);
    if (r == write_.load(std::memory_order_acquire)) return false;  // empty
    out = storage_[r];
    read_.store((r + 1) & kMask, std::memory_order_release);
    return true;
  }

  bool empty() const noexcept {
    return read_.load(std::memory_order_acquire) == write_.load(std::memory_order_acquire);
  }

  /// Elements currently readable. Advisory: the producer may add more between
  /// this call and the next pop, which is why it is never used to size a loop
  /// that must terminate.
  std::size_t size() const noexcept {
    const std::size_t w = write_.load(std::memory_order_acquire);
    const std::size_t r = read_.load(std::memory_order_acquire);
    return (w - r) & kMask;
  }

  static constexpr std::size_t capacity() noexcept { return kCapacity - 1; }

 private:
  static constexpr std::size_t roundUpPow2(std::size_t v) noexcept {
    std::size_t p = 1;
    while (p < v) p <<= 1;
    return p;
  }
  static constexpr std::size_t kCapacity = roundUpPow2(Capacity);
  static constexpr std::size_t kMask = kCapacity - 1;

  std::unique_ptr<T[]> storage_;
  // Padded apart so the producer's and consumer's cursors do not share a cache
  // line. Sharing one costs a coherence round trip on every push and pop, and
  // the audio thread is the side that pays for it.
  alignas(64) std::atomic<std::size_t> write_{0};
  alignas(64) std::atomic<std::size_t> read_{0};
};

}  // namespace mw
