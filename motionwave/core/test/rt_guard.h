// Motion Wave — proving the audio path does not allocate.
//
// The rule in §2.1 is absolute: no allocations, locks, file I/O or logging on
// the audio thread, ever. A rule that is only ever reviewed is a rule that gets
// broken by someone adding a `std::vector` to a processor in a hurry, and the
// symptom — an occasional dropout on a phone under load — is the hardest kind
// of bug to find after the fact.
//
// So it is not reviewed, it is measured. `RtGuard` arms a global operator-new
// hook for the duration of a scope; anything that allocates inside it is
// recorded, and the test that wrapped the scope fails by name. This is a test
// build only: the hook is compiled out of shipping builds entirely, so it costs
// the product nothing.
#pragma once

#include <atomic>
#include <cstddef>
#include <cstdlib>
#include <new>

namespace mw::test {

/// Counts allocations while armed. Not thread-local on purpose: the tests drive
/// the "audio thread" synchronously, and a global counter also catches an
/// allocation made on a helper thread the processor should not have spawned.
struct AllocationSpy {
  static std::atomic<bool>& armed() {
    static std::atomic<bool> flag{false};
    return flag;
  }
  static std::atomic<std::size_t>& count() {
    static std::atomic<std::size_t> n{0};
    return n;
  }
  static void note() {
    if (armed().load(std::memory_order_relaxed)) {
      count().fetch_add(1, std::memory_order_relaxed);
    }
  }
};

/// Arms the spy for a scope and reports what happened inside it.
///
///     {
///       RtGuard guard;
///       processor.process(buffer, frames);
///       MW_EXPECT_EQ(guard.allocations(), 0);
///     }
class RtGuard {
 public:
  RtGuard() {
    AllocationSpy::count().store(0, std::memory_order_relaxed);
    AllocationSpy::armed().store(true, std::memory_order_relaxed);
  }
  ~RtGuard() { AllocationSpy::armed().store(false, std::memory_order_relaxed); }

  RtGuard(const RtGuard&) = delete;
  RtGuard& operator=(const RtGuard&) = delete;

  /// Allocations observed so far in this scope.
  std::size_t allocations() const {
    return AllocationSpy::count().load(std::memory_order_relaxed);
  }

  /// Stops counting early, for a test that wants to assert over part of a
  /// scope and then set up the next one.
  void disarm() { AllocationSpy::armed().store(false, std::memory_order_relaxed); }
};

}  // namespace mw::test

// The hooks themselves. Defined in every test binary; `operator new` is
// replaceable by the standard, so this is a supported interception rather than
// a trick. Deliberately not `noexcept`-throwing on failure beyond the standard
// contract: the point is to observe, not to change behaviour under test.
//
// GCC at -O2 pairs a `new` in this translation unit with the *builtin* delete
// while this replacement takes the allocation, and then reports the `free`
// below as freeing memory a mismatched allocator returned. It is the optimiser
// reasoning about a replacement it has already decided to ignore, and the pair
// here is `malloc`/`free` throughout, which is correct by construction.
// Suppressed narrowly and only here; nothing else in the tree replaces these.
//
// **Not `inline`, deliberately.** A replacement `operator new` may not be
// inline — [basic.stc.dynamic] says so — and marking it inline lets an
// optimising compiler pair a `new` in this translation unit with the *global*
// delete while the replacement takes the allocation, which is a genuine
// mismatch and which -O2 diagnoses as one. Every test binary includes this
// header exactly once, so a non-inline definition is a single definition and
// there is nothing to collide with.
#if defined(__GNUC__) && !defined(__clang__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wmismatched-new-delete"
#endif

void* operator new(std::size_t size) {
  ::mw::test::AllocationSpy::note();
  void* p = std::malloc(size == 0 ? 1 : size);
  if (p == nullptr) throw std::bad_alloc();
  return p;
}

void* operator new[](std::size_t size) { return ::operator new(size); }

void operator delete(void* p) noexcept { std::free(p); }
void operator delete[](void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }
void operator delete[](void* p, std::size_t) noexcept { std::free(p); }

#if defined(__GNUC__) && !defined(__clang__)
#pragma GCC diagnostic pop
#endif
