// Motion Wave — the grain engine's deterministic generator.
//
// `lib-grain-engine.md` §6.3: a render is a pure function of (graph, spec) and a
// golden file is checked in, so a scheduler seeded from the wall clock would
// make every golden render fail once and then pass again, which is the worst
// shape a test failure can have. The seed is part of the configuration.
#pragma once

#include <cstdint>

namespace mw::dsp::grain {

/**
 * A 64-bit counter through a fixed mixing function.
 *
 * Counter-based rather than a state machine, and that is the property the
 * engine needs: block-size invariance (GE-12) requires the nth random number of
 * a render to be the nth regardless of how the frames were divided into blocks,
 * which a generator whose state advances per block cannot promise. Here the
 * state advances per *draw*, and draws happen per grain.
 *
 * SplitMix64. Not chosen for statistical quality — nothing here needs more than
 * a plausible sprinkle — but because it is a pure function of its counter, has
 * no bad seeds, and is four instructions.
 */
class Rng {
 public:
  void seed(std::uint64_t value) noexcept { state_ = value; }

  std::uint64_t next() noexcept {
    state_ += 0x9E3779B97F4A7C15ull;
    std::uint64_t z = state_;
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
    return z ^ (z >> 31);
  }

  /// Uniform on [0, 1). Twenty-four bits, which is every value a float32 can
  /// hold in that range without a gap — asking for more would return values the
  /// type cannot distinguish.
  float uniform() noexcept {
    return static_cast<float>(next() >> 40) * (1.0f / 16777216.0f);
  }

  /// Uniform on [-1, 1).
  float bipolar() noexcept { return uniform() * 2.0f - 1.0f; }

  std::uint64_t state() const noexcept { return state_; }

 private:
  std::uint64_t state_ = 0x9E3779B97F4A7C15ull;
};

}  // namespace mw::dsp::grain
