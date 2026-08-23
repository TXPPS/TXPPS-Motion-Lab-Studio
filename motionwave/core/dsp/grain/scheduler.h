// Motion Wave — when a grain starts, to a fraction of a sample.
//
// `lib-grain-engine.md` §5.1. The artefact this exists to prevent is the one
// GE-03 measures: a scheduler that rounds onsets to the block boundary puts a
// component at `fs/blockSize` into the output, and its level *moves with the
// host's buffer size*, which is the definitive signature and the reason that row
// runs at four block sizes rather than one.
#pragma once

#include "rng.h"

#include <cmath>

namespace mw::dsp::grain {

struct ScheduleConfig {
  float grainsPerSecond = 350.0f;
  /**
   * Zero gives a constant hop and one a fully stochastic onset series.
   *
   * A reverb wants the stochastic end: a constant hop makes the grain rate
   * audible as a pitch, so a 350 grains-per-second reverb hums at 350 Hz.
   */
  float onsetJitter = 0.6f;
};

class Scheduler {
 public:
  void prepare(double sampleRate, const ScheduleConfig& config, std::uint64_t seed) noexcept {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    rng_.seed(seed);
    setConfig(config);
    reset();
  }

  void setConfig(const ScheduleConfig& config) noexcept {
    config_ = config;
    const float rate = config.grainsPerSecond < 0.01f ? 0.01f : config.grainsPerSecond;
    hop_ = sampleRate_ / static_cast<double>(rate);
  }

  /**
   * Ready to fire on the next sample, not one hop from now.
   *
   * Arming with a full hop instead means a unit that has just been started is
   * silent for a hop — imperceptible at 350 grains a second and total at one,
   * where a 200 ms grain never spawns inside a 16 000-sample render at all. The
   * pitch row measured silence and read as a NaN rather than as a wrong
   * frequency, which is the shape of failure that costs the most to diagnose.
   */
  void reset() noexcept {
    countdown_ = 0.0;
    spawned_ = 0;
    armed_ = true;
  }

  /**
   * Frames until the next onset, and the sub-sample fraction of that onset.
   *
   * A whole-sample count so the engine can render in spans between onsets, and
   * a fraction handed to the grain as both an initial fractional read offset
   * *and* an initial window phase — moving only the read position would leave
   * every envelope quantised to the sample grid, which is the artefact this
   * whole class exists to avoid.
   */
  int framesToNextOnset(float* outFraction) noexcept {
    if (!armed_) {
      countdown_ = nextHop();
      armed_ = true;
    }
    const double whole = std::floor(countdown_);
    *outFraction = static_cast<float>(countdown_ - whole);
    return static_cast<int>(whole);
  }

  /// Consume `frames` of the countdown without spawning.
  void consume(int frames) noexcept {
    if (!armed_) {
      countdown_ = nextHop();
      armed_ = true;
    }
    countdown_ -= static_cast<double>(frames);
    if (countdown_ < 0.0) countdown_ = 0.0;
  }

  /// The onset fired: charge the next hop, keeping the fractional remainder so
  /// the rate is exact over time rather than exact per hop.
  void advance() noexcept {
    const double whole = std::floor(countdown_);
    const double fraction = countdown_ - whole;
    countdown_ = fraction + nextHop();
    ++spawned_;
    armed_ = true;
  }

  std::uint64_t spawnCount() const noexcept { return spawned_; }
  double hopSamples() const noexcept { return hop_; }

 private:
  /**
   * The next inter-onset interval.
   *
   * At full jitter this is an exponential draw, which is what makes the onset
   * series Poisson and the count of sounding grains Poisson with it — the
   * distribution §5.6's pool arithmetic assumes. Interpolating toward the
   * constant hop rather than scaling the exponential keeps the *mean* at the
   * set rate at every jitter setting, which GE-08 grades to ±1 %.
   */
  double nextHop() noexcept {
    const float jitter = config_.onsetJitter < 0.0f
                             ? 0.0f
                             : (config_.onsetJitter > 1.0f ? 1.0f : config_.onsetJitter);
    if (jitter <= 0.0f) return hop_;
    // Exponential with mean 1, from a uniform draw held off zero.
    float u = rng_.uniform();
    if (u < 1.0e-7f) u = 1.0e-7f;
    const double exponential = -std::log(static_cast<double>(u));
    return hop_ * (1.0 - static_cast<double>(jitter) + static_cast<double>(jitter) * exponential);
  }

  Rng rng_;
  ScheduleConfig config_{};
  double sampleRate_ = 48000.0;
  double hop_ = 137.0;
  double countdown_ = 0.0;
  std::uint64_t spawned_ = 0;
  bool armed_ = false;
};

}  // namespace mw::dsp::grain
