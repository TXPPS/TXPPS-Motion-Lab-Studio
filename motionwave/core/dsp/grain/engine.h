// Motion Wave — the grain engine.
//
// `lib-grain-engine.md`. Two units need the same scheduler, the same windows,
// the same normalisation, the same interpolated pitched read and the same
// allocation-free lifecycle; they differ in what they granulate and in what they
// do with the result. This owns the first list and none of the second — it holds
// no opinion about where the source samples came from, and is handed a view of
// somebody else's buffer and a write-head index.
#pragma once

#include "../../param/spsc_ring.h"
#include "pool.h"
#include "scheduler.h"
#include "visual.h"

#include <cmath>
#include <cstddef>
#include <cstdint>

namespace mw::dsp::grain {

enum class Tier : std::uint8_t { Eco = 0, Studio = 1, Max = 2 };

struct EngineConfig {
  int tapCount = 1;  ///< 1 for the reverb, 1..8 for the delay
  int poolSlots = 256;
  int maxGrainSamples = 24000;  ///< 500 ms at 48 kHz
  Tier tier = Tier::Studio;
  /**
   * Part of the configuration, not drawn from a clock.
   *
   * A render is a pure function of (graph, spec) and a golden file is checked
   * in; a scheduler seeded from the wall clock would make every golden render
   * fail once and then pass again.
   */
  std::uint64_t seed = 0x9E3779B97F4A7C15ull;
};

struct SpawnParams {
  float grainSeconds = 0.060f;
  float lengthJitter = 0.25f;
  float minOffsetSeconds = 0.020f;
  float spraySeconds = 0.400f;
  float sprayAmount = 0.70f;
  float ampJitter = 0.15f;
  float panSpread = 1.0f;
  WindowShape shape = WindowShape::Hann;
  float tukeyAlpha = 1.0f;
  bool reverse = false;
  /// Weighted semitone set, §5.4. At most eight entries; a null set is unison.
  const float* pitchSemitones = nullptr;
  const float* pitchWeights = nullptr;
  int pitchCount = 0;
  float pitchSpreadCents = 0.0f;
};

/// Expected grains sounding at once, per tier. §5.6 and ADR-0006 §1.
inline int overlapCap(Tier tier) noexcept {
  switch (tier) {
    case Tier::Eco: return 12;
    case Tier::Max: return 96;
    case Tier::Studio:
    default: return 32;
  }
}

class GrainEngine {
 public:
  static constexpr int kMaxTaps = GrainPool::kMaxTaps;
  static constexpr int kRingDepth = 4;

  static std::size_t arenaBytes(const EngineConfig& config, int) noexcept {
    return GrainPool::storageBytes(config.poolSlots < 0 ? 0 : config.poolSlots);
  }

  bool prepare(double sampleRate, int maxFrames, const EngineConfig& config, void* arena,
               std::size_t bytes) noexcept {
    if (arena == nullptr || maxFrames <= 0) return false;
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    config_ = config;
    tapCount_ = config.tapCount < 1 ? 1 : (config.tapCount > kMaxTaps ? kMaxTaps : config.tapCount);
    if (bytes < arenaBytes(config, maxFrames)) return false;
    pool_.prepare(config.poolSlots, tapCount_, arena, bytes);
    for (int t = 0; t < tapCount_; ++t) {
      // Each tap's scheduler gets its own stream, derived from the one seed so
      // the whole engine stays a pure function of the configuration.
      schedulers_[t].prepare(sampleRate_,
                             schedule_[t],
                             config.seed + static_cast<std::uint64_t>(t) * 0xA5A5A5A5u);
      spawnRng_[t].seed(config.seed ^ (0xD1B54A32D192ED03ull * (static_cast<std::uint64_t>(t) + 1)));
    }
    // Sixty hertz, counted in samples so the rate is block-size invariant. At
    // 64-frame blocks a per-block publish would push 750 frames a second at a
    // screen that redraws sixty, and GE-18 grades the rate at two block sizes
    // precisely because counting blocks passes at one of them.
    publishInterval_ = static_cast<int>(sampleRate_ / 60.0);
    if (publishInterval_ < 1) publishInterval_ = 1;
    reset();
    return true;
  }

  void reset() noexcept {
    pool_.reset();
    for (int t = 0; t < kMaxTaps; ++t) schedulers_[t].reset();
    nextId_ = 1;
    spawned_ = 0;
    dropped_ = 0;
    publishCountdown_ = 0;
    sequence_ = 0;
  }

  void setSchedule(std::uint8_t tap, const ScheduleConfig& schedule) noexcept {
    if (tap >= kMaxTaps) return;
    schedule_[tap] = schedule;
    schedulers_[tap].setConfig(cappedSchedule(tap));
  }

  void setSpawn(std::uint8_t tap, const SpawnParams& spawn) noexcept {
    if (tap >= kMaxTaps) return;
    spawn_[tap] = spawn;
    schedulers_[tap].setConfig(cappedSchedule(tap));
  }

  /**
   * Change the tier.
   *
   * The cap is applied by **reducing the density**, never by dropping a
   * sounding grain. ADR-0006 §1 puts the reason plainly: dropping a sounding
   * grain modulates loudness with CPU load, which turns a performance problem
   * into an audible one and makes it the user's problem to explain. Reducing
   * density changes the texture and the normalisation compensates, so the
   * result is sparser and level-stable — GE-19 holds the output RMS to 1 dB
   * across a Max-to-Eco transition with ninety-six grains live.
   */
  void setTier(Tier tier) noexcept {
    config_.tier = tier;
    for (int t = 0; t < tapCount_; ++t) schedulers_[t].setConfig(cappedSchedule(t));
  }

  void process(const GrainSource& source, float* outL, float* outR, int frames) noexcept {
    for (int i = 0; i < frames; ++i) {
      outL[i] = 0.0f;
      outR[i] = 0.0f;
    }
    if (!source.valid() || frames <= 0) return;

    int frame = 0;
    while (frame < frames) {
      // How far to the next onset on any tap. Rendering in spans between onsets
      // is what keeps a grain's start sample-accurate without testing every tap
      // on every sample.
      int span = frames - frame;
      for (int t = 0; t < tapCount_; ++t) {
        float fraction = 0.0f;
        const int until = schedulers_[t].framesToNextOnset(&fraction);
        if (until < span) span = until;
      }
      if (span > 0) {
        renderSpan(source, outL + frame, outR + frame, span, frame);
        for (int t = 0; t < tapCount_; ++t) schedulers_[t].consume(span);
        frame += span;
      }
      if (frame >= frames) break;
      for (int t = 0; t < tapCount_; ++t) {
        float fraction = 0.0f;
        if (schedulers_[t].framesToNextOnset(&fraction) != 0) continue;
        spawnOne(source, static_cast<std::uint8_t>(t), frame, fraction);
        schedulers_[t].advance();
      }
    }
    publishIfDue(source, frames);
  }

  float overlap(std::uint8_t tap) const noexcept {
    if (tap >= kMaxTaps) return 0.0f;
    return clampedDensity(tap) * spawn_[tap].grainSeconds;
  }

  /// Density after the cap. Shown, so a user on Eco is not lied to.
  float clampedDensity(std::uint8_t tap) const noexcept {
    if (tap >= kMaxTaps) return 0.0f;
    return cappedSchedule(tap).grainsPerSecond;
  }

  int liveGrains() const noexcept { return pool_.activeCount(); }
  std::uint64_t spawned() const noexcept { return spawned_; }
  std::uint64_t dropped() const noexcept { return dropped_; }
  const GrainPool& pool() const noexcept { return pool_; }

  /**
   * Consumer side of the visualiser ring, from the UI thread.
   *
   * False when no new frame is ready, in which case the UI draws the previous
   * one. A visualiser that misses a frame is fine; one that blocks the audio
   * thread is a defect (ADR-0004).
   */
  bool takeFrame(GrainFrame* out) noexcept { return ring_.pop(*out); }

 private:
  ScheduleConfig cappedSchedule(int tap) const noexcept {
    ScheduleConfig capped = schedule_[tap];
    const float length = spawn_[tap].grainSeconds > 1.0e-5f ? spawn_[tap].grainSeconds : 1.0e-5f;
    const float maxDensity = static_cast<float>(overlapCap(config_.tier)) / length;
    if (capped.grainsPerSecond > maxDensity) capped.grainsPerSecond = maxDensity;
    return capped;
  }

  void renderSpan(const GrainSource& source, float* left, float* right, int span,
                  int frameOffset) noexcept {
    GrainSource moving = source;
    Grain* grains = pool_.active();
    const bool cubic = config_.tier != Tier::Eco;
    for (int i = 0; i < span; ++i) {
      moving.writeIndex = source.writeIndex + frameOffset + i;
      float l = 0.0f;
      float r = 0.0f;
      int index = 0;
      while (index < pool_.activeCount()) {
        const bool alive = cubic ? renderGrainSample<true>(&grains[index], moving, &l, &r)
                                 : renderGrainSample<false>(&grains[index], moving, &l, &r);
        if (alive) {
          ++index;
        } else {
          // Retire in place: the swap brings an unrendered grain into this slot,
          // so the index is not advanced and the loop sees it next.
          pool_.retire(index);
        }
      }
      left[i] = l;
      right[i] = r;
    }
  }

  void spawnOne(const GrainSource& source, std::uint8_t tap, int frame, float fraction) noexcept {
    Grain* slot = pool_.acquire(tap);
    if (slot == nullptr) {
      ++dropped_;
      return;
    }
    const SpawnParams& spawn = spawn_[tap];
    Rng& rng = spawnRng_[tap];

    GrainSpec spec;
    spec.tap = tap;
    spec.shape = spawn.shape;
    spec.tukeyAlpha = spawn.tukeyAlpha;
    spec.reverse = spawn.reverse;
    spec.onsetFraction = fraction;

    const float jitter = 1.0f + spawn.lengthJitter * rng.bipolar();
    double lengthSamples =
        static_cast<double>(spawn.grainSeconds) * static_cast<double>(jitter) * sampleRate_;
    if (lengthSamples < 4.0) lengthSamples = 4.0;
    if (lengthSamples > static_cast<double>(config_.maxGrainSamples)) {
      lengthSamples = static_cast<double>(config_.maxGrainSamples);
    }
    /*
     * **Rounded, not truncated, and it is worth a paragraph.**
     *
     * A grain length is a count of samples and the nearest integer is the one
     * meant. Truncating biases every grain short by up to a sample, which at
     * ten milliseconds is a fifth of a per cent — and 0.010f times 48 000 is
     * 479.99998 in float32, so the obvious case comes out 479 rather than 480.
     * The pair of windows is then offset by 240/479 instead of a half, they
     * stop summing to one, and the output ripples at exactly the hop period
     * with an amplitude of pi times the error. Measured: 0.33 %, against
     * GE-02's tolerance of 0.1 %.
     */
    spec.lengthSamples = static_cast<int>(lengthSamples + 0.5);

    spec.pitchRatio = drawPitch(spawn, rng);

    // Behind the write head by at least the minimum, plus a sprayed amount. The
    // grain must also fit: a grain reading `length × ratio` samples forward from
    // its start would run past the head without this.
    const double minOffset = static_cast<double>(spawn.minOffsetSeconds) * sampleRate_;
    const double sprayRange = static_cast<double>(spawn.spraySeconds) * sampleRate_ *
                              static_cast<double>(spawn.sprayAmount);
    const double spray = sprayRange > 0.0 ? static_cast<double>(rng.uniform()) * sprayRange : 0.0;
    const double reach = static_cast<double>(spec.lengthSamples) *
                         static_cast<double>(spec.pitchRatio);
    spec.readOffset = minOffset + spray + reach;

    spec.amplitude = 1.0f + spawn.ampJitter * rng.bipolar();
    if (spec.amplitude < 0.0f) spec.amplitude = 0.0f;
    // §5.3's incoherent normalisation, applied **at spawn** so it sits inside
    // whatever loop the unit builds around the engine. On the output instead,
    // turning density up multiplies the loop gain, the decay time changes with
    // density, and at long decays the reverb runs away — which is the whole
    // content of fx-02 V6 and fx-03 V6, and what GE-06 measures.
    spec.amplitude *= normalisation(tap);
    spec.pan = spawn.panSpread * rng.bipolar();

    spawnGrain(slot, spec, source, frame, nextId_++);
    ++spawned_;
  }

  float normalisation(int tap) const noexcept {
    const float o = clampedDensity(static_cast<std::uint8_t>(tap)) * spawn_[tap].grainSeconds;
    const float meanSquare = windowMeanSquare(spawn_[tap].shape, spawn_[tap].tukeyAlpha);
    const float denominator = o * meanSquare;
    if (denominator <= 1.0e-6f) return 1.0f;
    return 1.0f / std::sqrt(denominator);
  }

  static float drawPitch(const SpawnParams& spawn, Rng& rng) noexcept {
    float semitones = 0.0f;
    if (spawn.pitchSemitones != nullptr && spawn.pitchCount > 0) {
      const int count = spawn.pitchCount > 8 ? 8 : spawn.pitchCount;
      float total = 0.0f;
      for (int i = 0; i < count; ++i) {
        total += spawn.pitchWeights != nullptr ? spawn.pitchWeights[i] : 1.0f;
      }
      float target = rng.uniform() * (total > 0.0f ? total : 1.0f);
      for (int i = 0; i < count; ++i) {
        const float weight = spawn.pitchWeights != nullptr ? spawn.pitchWeights[i] : 1.0f;
        target -= weight;
        if (target <= 0.0f) {
          semitones = spawn.pitchSemitones[i];
          break;
        }
        semitones = spawn.pitchSemitones[count - 1];
      }
    }
    semitones += spawn.pitchSpreadCents * rng.bipolar() * 0.01f;
    return std::pow(2.0f, semitones * (1.0f / 12.0f));
  }

  void publishIfDue(const GrainSource& source, int frames) noexcept {
    publishCountdown_ -= frames;
    if (publishCountdown_ > 0) return;
    publishCountdown_ += publishInterval_;
    if (publishCountdown_ < 0) publishCountdown_ = publishInterval_;

    GrainFrame frame;
    frame.sequence = ++sequence_;
    frame.bufferSeconds = static_cast<float>(static_cast<double>(source.capacity) / sampleRate_);
    frame.writeHeadSeconds =
        static_cast<float>(static_cast<double>(source.writeIndex + frames) / sampleRate_);
    frame.tapCount = static_cast<std::uint8_t>(tapCount_);
    const int live = pool_.activeCount();
    frame.live = static_cast<std::uint16_t>(live);

    // The **oldest by id**, deterministically, so particles persist between
    // frames instead of flickering as a random subset reshuffles. §5.7.
    const Grain* grains = pool_.active();
    int published = 0;
    std::uint32_t cutoff = 0xFFFFFFFFu;
    if (live > kPublishedGrains) cutoff = nthOldestId(grains, live, kPublishedGrains);
    for (int i = 0; i < live && published < kPublishedGrains; ++i) {
      if (grains[i].id > cutoff) continue;
      GrainView& view = frame.grains[published++];
      view.id = grains[i].id;
      // From the live grain, after the block was rendered, using the same read
      // position and window phase the samples came from. There is no parallel
      // particle simulation here and no re-derivation of where a grain "would
      // be" — that is CLAUDE.md's rule and Ledger cell U20's requirement.
      view.age = grains[i].windowPhase;
      const double behind =
          static_cast<double>(source.writeIndex + frames) - grains[i].readPos;
      view.positionSeconds = static_cast<float>(behind / sampleRate_);
      view.pitchRatio = grains[i].pitchRatio;
      view.pan = grains[i].pan;
      view.amplitude = grains[i].lastWindow * grains[i].amplitude;
      view.tap = grains[i].tap;
    }
    frame.published = static_cast<std::uint16_t>(published);
    ring_.push(frame);
  }

  /// The `n`th smallest id among the live grains, by selection — no allocation
  /// and no sort of a buffer the audio thread would have to own.
  static std::uint32_t nthOldestId(const Grain* grains, int live, int n) noexcept {
    std::uint32_t low = 0;
    std::uint32_t high = 0xFFFFFFFFu;
    for (int step = 0; step < 32; ++step) {
      const std::uint32_t mid = low + ((high - low) >> 1);
      int below = 0;
      for (int i = 0; i < live; ++i) {
        if (grains[i].id <= mid) ++below;
      }
      if (below >= n) {
        high = mid;
      } else {
        low = mid + 1;
      }
      if (low >= high) break;
    }
    return high;
  }

  GrainPool pool_;
  Scheduler schedulers_[kMaxTaps];
  Rng spawnRng_[kMaxTaps];
  ScheduleConfig schedule_[kMaxTaps];
  SpawnParams spawn_[kMaxTaps];
  SpscRing<GrainFrame, kRingDepth> ring_;
  EngineConfig config_{};
  double sampleRate_ = 48000.0;
  int tapCount_ = 1;
  int publishInterval_ = 800;
  int publishCountdown_ = 0;
  std::uint32_t nextId_ = 1;
  std::uint32_t sequence_ = 0;
  std::uint64_t spawned_ = 0;
  std::uint64_t dropped_ = 0;
};

}  // namespace mw::dsp::grain
