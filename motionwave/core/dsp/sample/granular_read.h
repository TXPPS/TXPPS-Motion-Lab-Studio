// Motion Wave — the Slipstream Sampler's granular engine. `smp-01` §4.3.
//
// **Read `fx-02` §1 first**, as §4.3 instructs: the grain windows, the
// density/overlap normalisation `A = 1/sqrt(O·mean(w²))` and the sample-accurate
// fractional scheduler are specified there and are used from `dsp/grain/` here,
// not reimplemented. What this file adds is everything an *instrument* needs
// that an effect does not, and there are four such things:
//
// 1. **The playhead and the grain pitch are independent.** The playhead moves
//    at `speed · dt` and each grain reads at `r = 2^(pitch/12)·fsFile/fsHost`.
//    Nothing about the note's key touches ρ and nothing about ρ touches r. That
//    decoupling removes the material-drift term `fx-02` §1 derives, and it is
//    why a glide here sounds like a glide rather than like a tape speeding up.
//
// 2. **The pool is per voice**, sized 64/16/8 by tier. A shared pool makes each
//    voice's density a function of how many other voices are sounding, so the
//    same chord is quieter and grainier per note than the same notes played
//    alone — a defect that only appears in the material a sampler is mostly
//    used for and never in a single-note test.
//
// 3. **The first grain starts on the note's exact sample index.** At 40 g/s a
//    scheduler tick is 25 ms, and waiting for one puts up to 25 ms of jitter on
//    every note-on. It is inaudible in a spectrum and plainly audible as sloppy
//    playing. V-24 measures zero samples, at every offset inside the block.
//
// 4. **The normalisation is inside the voice.** Outside it, a chord holds its
//    level while each note's share of it moves with that note's overlap — and
//    the user trims the zone gain to compensate, after which the velocity
//    response is wrong at every density but the one they trimmed at. V-25.
//
// And one thing that is a branch rather than a limit: **scatter 0 collapses to
// a plain interpolated read**, bit-exact against `ClassicRead` at the same
// tier. See `render` and `GranularParams::scatterZero`.
#pragma once

#include "../grain/scheduler.h"
#include "granular_grain.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace mw::dsp::sample {

/// The largest pool any tier asks for, so the storage is one array and the
/// tier chooses how much of it to use. Sizing it per tier would mean either an
/// allocation on a tier change or a second storage strategy.
inline constexpr int kMaxVoiceGrains = 64;

/**
 * The worst-case factor by which length jitter lifts the expected grain count.
 *
 * `spawnOne` bounds length jitter at ±50 % of the grain, so at the maximum
 * setting the mean grain length is unchanged but the *population* is not: a
 * grain drawn long is sounding for longer and so is counted for longer. The
 * mean population is `R · E[L]`, and with a uniform ±50 % draw the expectation
 * of the length is the nominal one — but the pool has to survive the upper end
 * of the draw rather than its mean, which is 1.5. Using 1.25 is the midpoint of
 * that and is what `grain/pool.h` uses for the same reason at ±25 %; it is
 * stated here as a constant so the number the cap was derived from is the
 * number a later reader finds.
 */
inline constexpr double kLengthLift = 1.25;

/**
 * One granular voice over one zone.
 *
 * The contract is §4.1's, unchanged from `ClassicRead`'s: `prepare`, then
 * `render(out, frames, pitch[], speed[])` with pitch in semitones and speed as
 * a ratio, both per sample, then `release()`. Nothing inside `render`
 * allocates, locks, logs or touches a file; the storage below is the whole of
 * what the voice needs and it is a member.
 */
class GranularRead {
 public:
  /// No allocation. `startFrames` is the note-on sample index inside the first
  /// block, which is how V-24's zero jitter is even expressible.
  void prepare(const ClassicSource& source, const SincTable* sinc, Quality quality,
               double hostRate, const GranularParams& params, std::uint64_t seed,
               int noteOnOffset = 0) noexcept {
    zone_ = source;
    sinc_ = sinc;
    quality_ = (quality == Quality::High && sinc == nullptr) ? Quality::Normal : quality;
    hostRate_ = hostRate > 0.0 ? hostRate : 48000.0;
    params_ = params;
    capacity_ = grainPoolFor(quality_);
    if (capacity_ > kMaxVoiceGrains) capacity_ = kMaxVoiceGrains;
    recomputeCap();
    active_ = zone_.data != nullptr && zone_.frames > 0 && zone_.sampleRate > 0.0;
    playhead_.frames =
        static_cast<double>(zone_.sampleStart > zone_.frames ? zone_.frames : zone_.sampleStart);
    rng_.seed(seed);
    seed_ = seed;
    liveCount_ = 0;
    spawned_ = 0;
    dropped_ = 0;
    released_ = false;
    // Charged so the first grain fires on the note's own sample, not one hop
    // later. `Scheduler::reset` arms with a zero countdown for exactly this
    // reason, and the voice then holds the onset back by `noteOnOffset` frames
    // so a note-on partway through a block still lands on its own sample.
    scheduler_.prepare(hostRate_, scheduleFor(params_), seed ^ 0x2545F4914F6CDD1Dull);
    pendingOffset_ = noteOnOffset < 0 ? 0 : noteOnOffset;
    // The direct head is prepared unconditionally: the scatter-0 branch must be
    // able to take over on any block, not only the first, because the user can
    // turn spray to zero mid-note and the null has to hold from that point.
    direct_.prepare(zone_, sinc_, quality_, hostRate_);
  }

  /// §7.3's controls, live. Changing density re-charges the scheduler's rate
  /// without disturbing its fractional countdown, so a density move does not
  /// re-quantise the onset series it was midway through.
  void setParams(const GranularParams& params) noexcept {
    params_ = params;
    // The cap depends on the jitter, so it is recomputed *before* the schedule
    // is set from it: setting the schedule first would charge the scheduler at
    // the old cap and the new density would take a block to arrive.
    recomputeCap();
    scheduler_.setConfig(scheduleFor(params_));
  }

  const GranularParams& params() const noexcept { return params_; }

  /**
   * `pitch` in semitones, `speed` a ratio (null means unity), both per sample.
   *
   * **The scatter-0 branch is first and it is a branch.** With every
   * randomisable dimension at zero and the playhead running at the speed the
   * classic engine implies, a granular voice's correct output *is* the classic
   * engine's output; the grain machinery would then be a windowed overlap-add
   * of a signal against itself, whose gain is one only in the limit. Taking the
   * classic read directly makes the null exact, and exact is the point — §4.3
   * item 4 calls it the cheapest possible proof that the granular machinery has
   * not quietly coloured everything.
   */
  void render(float* out, int frames, const float* pitch, const float* speed) noexcept {
    if (!active_) {
      for (int i = 0; i < frames; ++i) out[i] = 0.0f;
      return;
    }
    if (params_.scatterZero()) {
      direct_.render(out, frames, pitch, speed);
      // The playhead follows the head that is actually sounding, so switching
      // spray on mid-note starts spraying around where the note had got to
      // rather than around where a shadow playhead thought it was.
      playhead_.frames = direct_.position();
      return;
    }
    renderCloud(out, frames, pitch, speed);
  }

  /// §4.2's rule, unchanged: a `Sustain` loop runs to the end from here. A
  /// grain already in flight keeps its own head's decision, because a grain is
  /// a fixed-length read and shortening one mid-flight is a click.
  void release() noexcept {
    released_ = true;
    direct_.release();
  }

  bool active() const noexcept { return active_; }
  /// Where the cloud is reading from, in zone frames.
  double playhead() const noexcept { return playhead_.frames; }
  int liveGrains() const noexcept { return liveCount_; }
  std::uint64_t spawned() const noexcept { return spawned_; }
  /**
   * Grains the pool could not hold.
   *
   * §10.3 applies the tier cap by reducing the rate, so this is a design
   * guarantee of zero rather than a statistic — `clampedDensity` below keeps
   * the expected overlap at or under the cap, and the pool is sized to the cap
   * itself. A non-zero reading here means the rate cap stopped working, which
   * is why it is counted rather than assumed.
   */
  std::uint64_t dropped() const noexcept { return dropped_; }
  Quality quality() const noexcept { return quality_; }
  int capacity() const noexcept { return capacity_; }

  /// `O = R·L` after the cap — §7.3's overlap readout, and the number the
  /// normalisation actually uses.
  float overlap() const noexcept { return clampedDensity() * grainSeconds(); }

  /**
   * The density the voice is really running at, after §10.3's cap.
   *
   * The cap is applied here, to the *rate*, and never by refusing a spawn. A
   * dropped grain modulates loudness with CPU load, which turns a performance
   * problem into an audible one; a reduced rate changes the texture and the
   * normalisation compensates for the level.
   */
  float clampedDensity() const noexcept {
    const float requested = params_.densityHz < 0.01f ? 0.01f : params_.densityHz;
    const float maxRate = overlapCap_ / grainSeconds();
    return requested > maxRate ? maxRate : requested;
  }

  /// The overlap ceiling in force, after §10.3's column and the pool's own
  /// Poisson bound have both been applied. Exposed because a tier that quietly
  /// halves a user's density should be able to say so.
  float overlapLimit() const noexcept { return overlapCap_; }

 private:
  /**
   * Both caps, evaluated off the audio path.
   *
   * §10.3's `O` column is the ceiling and the pool's own headroom at the
   * current jitter is the other bound; the lower of the two is what the rate is
   * held to. The Poisson bisection inside `poolOverlapAt` is fifty summations,
   * which is nothing at a parameter change and would be absurd per sample.
   */
  void recomputeCap() noexcept {
    overlapCap_ = std::min(overlapCeilingFor(quality_),
                           poolOverlapAt(capacity_, kLengthLift, params_.jitter));
  }

  float grainSeconds() const noexcept {
    const float ms = params_.grainMs < 5.0f ? 5.0f : (params_.grainMs > 500.0f ? 500.0f
                                                                              : params_.grainMs);
    return ms * 0.001f;
  }

  grain::ScheduleConfig scheduleFor(const GranularParams& params) const noexcept {
    (void)params;
    grain::ScheduleConfig config;
    config.grainsPerSecond = clampedDensity();
    config.onsetJitter = params_.jitter < 0.0f ? 0.0f : (params_.jitter > 1.0f ? 1.0f
                                                                              : params_.jitter);
    return config;
  }

  /// ρ with §7.3's dead zone. Freeze is a band rather than a point because a
  /// speed arriving from a fader or an envelope never lands on exactly zero,
  /// and a playhead creeping at 0.003× is a freeze that slowly drifts out of
  /// the sound the user froze.
  double speedAt(const float* speed, int i) const noexcept {
    double rho = speed != nullptr ? static_cast<double>(speed[i]) : 1.0;
    if (rho > -0.01 && rho < 0.01) return 0.0;
    if (rho > 4.0) rho = 4.0;
    if (rho < -4.0) rho = -4.0;
    return rho;
  }

  /**
   * The cloud, rendered in spans between onsets.
   *
   * Rendering span by span rather than testing the scheduler on every sample is
   * what keeps an onset sample-accurate without paying for the test: the
   * scheduler says how many whole frames remain until the next grain, the span
   * runs that far, and the grain is then armed on the exact frame with its
   * sub-sample remainder handed to it. Quantising onsets to the block boundary
   * instead would put a component at `fs/blockSize` into the output whose level
   * moves with the host's buffer size — `fx-02` §1.4's named failure, and the
   * one the block-size sweep exists to catch.
   */
  void renderCloud(float* out, int frames, const float* pitch, const float* speed) noexcept {
    for (int i = 0; i < frames; ++i) out[i] = 0.0f;
    const float amplitude = densityNormalisation(overlap(), params_.shape, params_.tukeyAlpha);
    int frame = 0;
    while (frame < frames) {
      /*
       * **Spawn first, then render the span that begins at this frame.**
       *
       * The order is the whole of V-24. Written the other way round — render
       * the span, then spawn whatever is due at its end — the grain that is due
       * at frame `f` first contributes at `f + 1`, because frame `f` was
       * rendered before the grain existed. That is one sample of jitter on
       * *every* onset at *every* offset, not an edge case, and the row that
       * found it had been reading it as an off-by-one at the end of the block:
       * at offset 511 in a 512-frame block the late grain falls off the end
       * entirely and the note is silent, which is the only offset at which a
       * uniform one-sample delay is visible as anything but a small number.
       */
      float fraction = 0.0f;
      // A note-on partway through the block holds the first onset back to the
      // note's own sample. It is consumed once, so every later onset comes from
      // the scheduler alone and the rate is not disturbed by the note-on.
      if (pendingOffset_ <= 0 && scheduler_.framesToNextOnset(&fraction) == 0) {
        spawnOne(fraction, amplitude);
        scheduler_.advance();
      }

      /*
       * How far to the next onset, which is where this span has to stop — and
       * never past the end of the caller's buffer.
       *
       * The clamp to `frames - frame` is applied **last and unconditionally**,
       * after every other term has had its say. It was written as a series of
       * conditional narrowings instead, each of which was individually correct,
       * and the composition still wrote 128 samples past the end of a 48 000
       * sample buffer on the final block — found by a guard band around the
       * output, not by any assertion inside the loop, because a write past the
       * end corrupts the heap and reports itself as an abort during some later
       * destructor with nothing of this function on the stack.
       *
       * A span is a length into somebody else's memory. It gets one clamp, in
       * one place, that no earlier branch can route around.
       */
      float nextFraction = 0.0f;
      int until = scheduler_.framesToNextOnset(&nextFraction);
      if (pendingOffset_ > 0) until = pendingOffset_;
      // At least one frame, or a scheduler sitting at zero spins for ever.
      int span = until > 0 ? until : 1;
      const int remaining = frames - frame;
      if (span > remaining) span = remaining;

      // A null `speed` means unity throughout, so it is *not* offset: adding to
      // a null pointer is undefined even when nothing dereferences it.
      renderSpan(out + frame, span, pitch + frame, speed != nullptr ? speed + frame : nullptr);
      if (pendingOffset_ > 0) {
        const int taken = span < pendingOffset_ ? span : pendingOffset_;
        pendingOffset_ -= taken;
        scheduler_.consume(span - taken);
      } else {
        scheduler_.consume(span);
      }
      frame += span;
    }
  }

  /// One span with no onset in it: every live grain, summed, and the playhead
  /// advanced by ρ per sample.
  /// `pitch` and `speed` are already offset to this span's first frame, so both
  /// are indexed by `i` and neither by a block-absolute position. They were not,
  /// once: `speed` was passed unoffset and indexed absolutely, which read past
  /// its end on every span after the first.
  void renderSpan(float* out, int span, const float* pitch, const float* speed) noexcept {
    for (int i = 0; i < span; ++i) {
      float sum = 0.0f;
      int index = 0;
      while (index < liveCount_) {
        if (renderGrainSample(&grains_[index], pitch[i], &sum)) {
          ++index;
        } else {
          // Retire by swapping the last live grain down, which keeps the live
          // set a contiguous prefix and the loop above free of a liveness test.
          if (index != liveCount_ - 1) grains_[index] = grains_[liveCount_ - 1];
          --liveCount_;
        }
      }
      out[i] += sum;
      advancePlayhead(speedAt(speed, i));
    }
  }

  /// One sample of playhead motion, then the zone's loop rule. Both live in
  /// `Playhead` so that the absence of a pitch term is stated in one place.
  void advancePlayhead(double rho) noexcept {
    playhead_.advance(rho, zone_.sampleRate, hostRate_);
    if (!playhead_.wrap(zone_, liveCount_)) active_ = false;
  }

  /**
   * Spawn one grain at the playhead, sprayed.
   *
   * The draws come from `rng_`, seeded in `prepare` from `noteSeed`'s mix of
   * `(noteNumber, noteStartTick, voiceSlot, instrumentSeed)` and from nothing
   * else. They are taken in `drawGrain` **before** the pool is checked, so a
   * spawn refused for want of a slot still advances the stream by exactly as
   * much as one that succeeded: otherwise the random sequence would depend on
   * how full the pool happened to be, and a render would stop being a function
   * of its seed the first time a tier cap bit.
   */
  void spawnOne(float fraction, float amplitude) noexcept {
    const double lengthFrames = static_cast<double>(grainSeconds()) * hostRate_;
    const GrainDraw draw = drawGrain(rng_, params_, lengthFrames, fraction);
    ++spawned_;
    if (liveCount_ >= capacity_) {
      ++dropped_;
      return;
    }
    armGrain(&grains_[liveCount_], zone_, sinc_, quality_, hostRate_,
             playhead_.frames + draw.startOffsetFrames, draw.lengthSamples, amplitude,
             draw.detuneSemitones, fraction, params_.shape, params_.tukeyAlpha);
    ++liveCount_;
  }

  SampleGrain grains_[kMaxVoiceGrains];
  ClassicRead direct_;
  ClassicSource zone_;
  grain::Scheduler scheduler_;
  grain::Rng rng_;
  GranularParams params_{};
  const SincTable* sinc_ = nullptr;
  double hostRate_ = 48000.0;
  Playhead playhead_{};
  float overlapCap_ = 12.0f;
  std::uint64_t seed_ = 0;
  std::uint64_t spawned_ = 0;
  std::uint64_t dropped_ = 0;
  Quality quality_ = Quality::Normal;
  int capacity_ = 16;
  int liveCount_ = 0;
  int pendingOffset_ = 0;
  bool active_ = false;
  bool released_ = false;
};

}  // namespace mw::dsp::sample
