// Motion Wave — one LFO, eight waveforms, and a delay in two stages.
//
// `lib-voice-substrate.md` §4 and §5.3. Five instruments' worth of low-
// frequency modulation in one class: the DCO polysynth's single instrument-wide
// triangle with its measured delay, the six-operator engine's key-synced
// sample-and-hold, and the matrix instrument's five per-voice LFOs with a
// retrigger point and a waveform that samples any other source.
//
// **Phase is derived from a sample count, not accumulated.** The design says
// "a double accumulator advanced by sample count", and the letter of that —
// `phase += frames · inc` per call — adds one rounding error per block, so a
// 16-frame render and a 1024-frame render differ in their last bits. That is
// inside VS-07's tolerance and it is still two renders that disagree. Deriving
// `origin + samples · inc` from an integer count gives the same bits in every
// split for one multiply, and a rate change rebases the origin so the phase is
// continuous through it. `dsp/lfo_phase.h` makes the same argument against
// accumulation for a transport-locked phase; this is the free-running form.
//
// **The delay is two stages, both measured.** Complete silence for
// `delaySeconds`, then a ramp to full depth over `fadeSeconds`. One consumer's
// sheet has both stages at five slider positions — 0/0, 0.064/0.053,
// 0.85/0.188, 1.20/0.348, 2.79/1.15 s — and a single-stage "fade in over N"
// has no silent period at all, which on a slow vibrato patch is the whole
// gesture. VS-14 asserts the silence is exact and the fade lands on time.
//
// **Random draws are addressed, not streamed.** Sample-and-hold takes its
// value at the k-th wrap from a fixed mix of (seed, k) and the noise wave from
// (seed, absolute sample), so which number a wrap gets does not depend on how
// the frames were divided into blocks — a generator advanced per call would
// give the same wrap a different value at every buffer size. The mix is
// SplitMix64's, as in `dsp/grain/rng.h`, with period 2^64: the design's
// default is a long period, and one consumer's audibly repeating short-period
// generator is a listening decision §9 leaves open.
//
// Waveforms are not band-limited: the square steps and the saw wraps instantly,
// as integer operations on the hardware's phase accumulator do, so a 20 Hz LFO
// on pitch produces audible content — correct, and not to be "fixed".
//
// Nothing here allocates: `prepare` stores three numbers and every other call
// is arithmetic over the members.
#pragma once

#include <cmath>
#include <cstdint>

#include "mod_grid.h"
#include "trigger_bus.h"

namespace mw::dsp::voice {

enum class LfoWave : std::uint8_t {
  Triangle,
  SawUp,
  SawDown,
  Square,
  Sine,
  SampleHold,
  Noise,
  /// Samples another modulation source at the LFO rate — a triangle gives
  /// stepped vibrato, pressure a held expression value, a ramp a staircase. It
  /// lives here, not in a module of its own, because this is where its clock is.
  SampleInput,
};

/// How many of these an instrument owns. `Instrument` is one for the whole
/// instrument, so two voices sounding together are modulated **in phase** —
/// a defining characteristic of one consumer, which per-voice LFOs would
/// change. The object is the same either way; the instrument reads the scope
/// to decide how many to build, and VS-13 drives both structures.
enum class LfoScope : std::uint8_t { Instrument, Voice };

/// Which pulse resets the phase. The depth envelope restarts on the same
/// pulse — and with `Off` still on `single`, because a delayed vibrato on a
/// free-running LFO is real: the phase is nobody's business, the delay the note's.
enum class LfoRetrigger : std::uint8_t { Off, Single, Multi, External };

struct LfoConfig {
  LfoWave wave = LfoWave::Triangle;
  LfoScope scope = LfoScope::Voice;
  LfoRetrigger retrigger = LfoRetrigger::Off;
  float rateHz = 5.0f;
  /// Phase the LFO resets to when retriggered, 0..1. Repeatable phase per note
  /// is what percussive uses need and what a deterministic render needs.
  float retriggerPhase = 0.0f;
  float delaySeconds = 0.0f;
  float fadeSeconds = 0.0f;
  float amplitude = 1.0f;
  /// Routed through the instrument's lag processor. Read by the consumer; the
  /// substrate has no lag processor and does not pretend to.
  bool throughLag = false;
  /// Source index when `wave == SampleInput`. Bounded by `kMaxModSources`.
  std::uint8_t sampleInput = 0;
};

/// How two contributions to one destination combine.
enum class ModCombine : std::uint8_t {
  Sum,
  /// Whichever is greater wins, sign from the first. The six-operator engine
  /// does exactly this for pitch and amplitude modulation, and summing gives
  /// noticeably deeper vibrato when the LFO and the wheel are both active —
  /// a different instrument, one enum value away. VS-15.
  Maximum,
};

inline float combine(ModCombine how, float first, float second) noexcept {
  if (how == ModCombine::Sum) return first + second;
  const float a = std::fabs(first);
  const float b = std::fabs(second);
  const float larger = a > b ? a : b;
  return first < 0.0f ? -larger : larger;
}

class Lfo {
 public:
  void prepare(double sampleRate, std::uint64_t seed) noexcept {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    seed_ = seed;
    derive();
    reset();
  }

  /// Takes effect immediately and continuously. The phase now becomes the
  /// origin and the count restarts, so the next sample is one step at the new
  /// rate from where this one is; without the rebase a rate automation would
  /// jump the LFO to wherever the count lands under the new rate. The trigger
  /// state is untouched — a control edit mid-note must not restart the delay.
  void setConfig(const LfoConfig& config) noexcept {
    const double p = unwrapped();
    origin_ = p - std::floor(p);
    samples_ = 0;
    config_ = config;
    derive();
    value_ = evaluate();
  }

  /// Phase to the retrigger point, held value zero, and the delay long since
  /// elapsed rather than just started: an LFO nobody has triggered yet is at
  /// full depth, as if a note had ended long ago.
  void reset() noexcept {
    samples_ = 0;
    clock_ = 0;
    origin_ = retriggerPhase_;
    sinceTrigger_ = kLongAgo;
    draws_ = 0;
    held_ = 0.0f;
    lastExternal_ = false;
    value_ = evaluate();
  }

  /// Advance `frames` samples and return the value at the end. `sources` is the
  /// voice's `ModFrame::sources`, read only by `SampleInput`, and may be null.
  float advance(const TriggerBus& triggers, const float* sources, int frames) noexcept {
    if (triggered(triggers)) {
      sinceTrigger_ = 0;
      if (config_.retrigger != LfoRetrigger::Off) {
        origin_ = retriggerPhase_;
        samples_ = 0;
        // A reset phase is a wrap: sample-and-hold starts every note on a fresh
        // draw, and the same note sequence draws the same values.
        ++draws_;
        draw(sources);
      }
    }
    lastExternal_ = triggers.externalTrigger;
    if (frames > 0) {
      const auto n = static_cast<std::uint64_t>(frames);
      const double cyclesBefore = std::floor(unwrapped());
      samples_ += n;
      sinceTrigger_ += n;
      clock_ += n;
      const double wraps = std::floor(unwrapped()) - cyclesBefore;
      // Several wraps in one call advance the draw index by all of them and
      // draw once, so the index stays in step with a per-sample walk.
      if (wraps > 0.0) {
        draws_ += static_cast<std::uint64_t>(wraps);
        draw(sources);
      }
    }
    value_ = evaluate();
    return value_;
  }

  float value() const noexcept { return value_; }

  float phase() const noexcept {
    const double p = unwrapped();
    return static_cast<float>(p - std::floor(p));
  }

  /// The two-stage delay envelope, 0..1: exactly 0 through the delay, then a
  /// straight ramp over the fade. From an integer count, so it cannot reach
  /// denormal territory and needs no flush.
  float depth() const noexcept {
    if (sinceTrigger_ < delaySamples_) return 0.0f;
    if (fadeSamples_ == 0) return 1.0f;
    const std::uint64_t into = sinceTrigger_ - delaySamples_;
    if (into >= fadeSamples_) return 1.0f;
    return static_cast<float>(into) / static_cast<float>(fadeSamples_);
  }

  const LfoConfig& config() const noexcept { return config_; }

 private:
  /// 2^62 samples: a trigger a million years ago, and no overflow for as long.
  static constexpr std::uint64_t kLongAgo = std::uint64_t{1} << 62;
  static constexpr float kTwoPi = 6.283185307f;

  static std::uint64_t mix(std::uint64_t seed, std::uint64_t index) noexcept {
    std::uint64_t z = seed + (index + 1) * 0x9E3779B97F4A7C15ull;
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
    return z ^ (z >> 31);
  }

  /// Uniform on [−1, 1) from the top 24 bits — every value a float can hold
  /// in that range without a gap.
  static float bipolar(std::uint64_t h) noexcept {
    return static_cast<float>(h >> 40) * (2.0f / 16777216.0f) - 1.0f;
  }

  void derive() noexcept {
    const float rate = config_.rateHz > 0.0f ? config_.rateHz : 0.0f;
    inc_ = static_cast<double>(rate) / sampleRate_;
    const float p = config_.retriggerPhase;
    retriggerPhase_ = static_cast<double>(p - std::floor(p));
    delaySamples_ = toSamples(config_.delaySeconds);
    fadeSamples_ = toSamples(config_.fadeSeconds);
    sampleInput_ = config_.sampleInput < kMaxModSources ? config_.sampleInput : kMaxModSources - 1;
  }

  std::uint64_t toSamples(float seconds) const noexcept {
    if (!(seconds > 0.0f)) return 0;
    return static_cast<std::uint64_t>(static_cast<double>(seconds) * sampleRate_ + 0.5);
  }

  double unwrapped() const noexcept { return origin_ + static_cast<double>(samples_) * inc_; }

  bool triggered(const TriggerBus& t) const noexcept {
    switch (config_.retrigger) {
      case LfoRetrigger::Off:
      case LfoRetrigger::Single:
        return t.single;
      case LfoRetrigger::Multi:
        return t.multi;
      case LfoRetrigger::External:
        // A level, so the edge is the event: a trigger held high across ten
        // control steps is one trigger, not ten.
        return t.externalTrigger && !lastExternal_;
    }
    return false;
  }

  void draw(const float* sources) noexcept {
    if (config_.wave == LfoWave::SampleInput) {
      held_ = sources != nullptr ? sources[sampleInput_] : 0.0f;
    } else {
      held_ = bipolar(mix(seed_, draws_));
    }
  }

  float evaluate() const noexcept {
    const float p = phase();
    float w = 0.0f;
    switch (config_.wave) {
      case LfoWave::Triangle:
        // Zero and rising at phase 0, like the sine, so a retrigger to phase 0
        // starts a vibrato from no deviation on either.
        w = p < 0.25f ? 4.0f * p : (p < 0.75f ? 2.0f - 4.0f * p : 4.0f * p - 4.0f);
        break;
      case LfoWave::SawUp:
        w = 2.0f * p - 1.0f;
        break;
      case LfoWave::SawDown:
        w = 1.0f - 2.0f * p;
        break;
      case LfoWave::Square:
        w = p < 0.5f ? 1.0f : -1.0f;
        break;
      case LfoWave::Sine:
        w = std::sin(kTwoPi * p);
        break;
      case LfoWave::SampleHold:
      case LfoWave::SampleInput:
        w = held_;
        break;
      case LfoWave::Noise:
        w = bipolar(mix(seed_ ^ 0x5851F42D4C957F2Dull, clock_));
        break;
    }
    return config_.amplitude * depth() * w;
  }

  LfoConfig config_{};
  double sampleRate_ = 48000.0;
  double inc_ = 5.0 / 48000.0;
  double origin_ = 0.0;
  double retriggerPhase_ = 0.0;
  std::uint64_t seed_ = 0;
  std::uint64_t samples_ = 0;       ///< since the phase origin
  std::uint64_t clock_ = 0;         ///< since reset; never rebased
  std::uint64_t sinceTrigger_ = kLongAgo;
  std::uint64_t delaySamples_ = 0;
  std::uint64_t fadeSamples_ = 0;
  std::uint64_t draws_ = 0;
  int sampleInput_ = 0;
  float held_ = 0.0f;
  float value_ = 0.0f;
  bool lastExternal_ = false;
};

}  // namespace mw::dsp::voice
