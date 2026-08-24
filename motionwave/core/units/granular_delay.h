// Motion Wave — the Granular Delay, `fx-03`.
//
// One buffer, N taps, a routing matrix (§1.2). The topologies are a matrix
// choice rather than three engines, the per-tap order is fixed by §2 because
// pitch is a property of *how the grain is read* and so must precede
// everything, and the feedback tap is a separate dedicated read rather than the
// sum of the output taps — §3.2(c), which decouples "how many taps you hear"
// from "how long it rings" and is both more stable and more musical.
#pragma once

#include "../dsp/biquad.h"
#include "../dsp/grain/engine.h"
#include "../graph/node.h"
#include "delay_feedback.h"
#include "delay_line.h"
#include "delay_routing.h"
#include "../dsp/feedback_chain.h"
#include "delay_smear.h"
#include "delay_sync.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace mw::units {

/*
 * The grain engine's namespace, as `fx-02` also aliases it. `delay` needs no
 * alias — it is `mw::units::delay` and is already in scope here.
 */
namespace grain = dsp::grain;

/// What the face draws.
struct GranularDelayFrame {
  float inputPeak = 0.0f;
  float outputPeak = 0.0f;
  /// The loop signal, which is what §9 V4 grades — the thing that recirculates.
  float loopPeak = 0.0f;
  /// Delivered per-tap time in seconds, after §2's reach clamp.
  float tapSeconds[8] = {0, 0, 0, 0, 0, 0, 0, 0};
  float overlap = 0.0f;
  std::uint8_t activeTaps = 1;
  std::uint8_t padding[3] = {0, 0, 0};
};

inline constexpr int kMaxTaps = 8;

/// One tap's settings. §2's order is applied in `process`, not stored here.
struct TapSettings {
  double delaySeconds = 0.250;
  double level = 1.0;
  double pan = 0.0;  ///< −1 hard left, +1 hard right
  double pitchSemitones = 0.0;
  bool reverse = false;
  bool enabled = true;
};

class GranularDelay : public Node {
 public:
  void setMix(double amount) noexcept { mix_ = clamp01(amount); }
  void setFeedback(double amount) noexcept {
    // §3.2 exposes 0–130 %, and the saturator's drive floor is what makes the
    // top of that range safe rather than reckless. See `DelayFeedback`.
    loop_.setFeedback(amount < 0.0 ? 0.0 : (amount > 1.3 ? 1.3 : amount));
  }
  void setTopology(delay::Topology topology) noexcept {
    topology_ = topology;
    dirty_ = true;
  }
  void setCross(double amount) noexcept {
    cross_ = clamp01(amount);
    dirty_ = true;
  }
  void setSmear(double amount) noexcept {
    smearAmount_ = clamp01(amount);
    dirty_ = true;
  }
  void setLoopLowpass(double hz) noexcept { loop_.setLoopLowpass(hz); }
  void setLoopHighpass(double hz) noexcept { loop_.setLoopHighpass(hz); }
  void setDrive(double drive) noexcept { loop_.setDrive(drive); }
  void setBpm(double bpm) noexcept {
    bpm_ = bpm > 1.0 ? bpm : 1.0;
    dirty_ = true;
  }
  void setTapCount(int count) noexcept {
    tapCount_ = count < 1 ? 1 : (count > kMaxTaps ? kMaxTaps : count);
    dirty_ = true;
  }
  void setTap(int index, const TapSettings& settings) noexcept {
    if (index < 0 || index >= kMaxTaps) return;
    taps_[index] = settings;
    dirty_ = true;
  }
  /**
   * §3.2(c): the feedback tap is its own read, not the sum of the output taps.
   *
   * If `k` taps of level `g_i` all fed the loop, the worst-case loop gain would
   * be `fb·Σ|g_i|` — four taps at unity and `fb = 0.4` is already at the edge,
   * so adding a tap would shorten the tail. A dedicated read means the number
   * of taps you hear and the length of the ring are independent controls, which
   * is the more musical arrangement as well as the stable one.
   */
  void setFeedbackTapSeconds(double seconds) noexcept {
    feedbackSeconds_ = seconds < 0.001 ? 0.001 : seconds;
    dirty_ = true;
  }
  void setBypass(bool bypass) noexcept { bypass_ = bypass; }

  void prepare(double sampleRate, int maxFrames) override {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    // Eight seconds, which holds §5's longest division (eight bars at 60 bpm is
    // thirty-two seconds — longer than any buffer we would ship, so the sync
    // table's top entries clamp rather than allocate).
    buffer_.prepare(sampleRate_, 8.0);
    loop_.prepare(sampleRate_);
    /*
     * **One engine, one pool, one ceiling — for up to eight taps.**
     *
     * The engine was built for this: `EngineConfig::tapCount` is documented as
     * "1 for the reverb, 1..8 for the delay", and the pool partitions its slots
     * per tap rather than per instance. That is the whole reason not to give
     * each tap its own engine, and the reason is the pool's guarantees: GE-08's
     * drop accounting, GE-15's zero-allocation proof and the 256-slot sizing at
     * 1.56x the 99.99th percentile all assume a single allocation domain.
     * Eight engines would split the ceiling eight ways, so a burst that fits one
     * shared pool drops in eight eighths — under exactly the load the sizing was
     * computed to survive, which is the worst possible place for a guarantee to
     * stop holding.
     */
    grain::EngineConfig config;
    config.tapCount = kMaxTaps;
    /*
     * **The pool is sized for eight taps, not for one.**
     *
     * `fx-02`'s 256 slots are 1.56x the 99.99th percentile of *one* tap's
     * live-grain count at an overlap of 96. This unit runs up to eight taps
     * through the same pool, and §4's table asks for 32 streams each at full
     * Smear — 256 grains in flight, against a 256-slot ceiling. Measured that
     * way it dropped 3527 grains in four seconds and spawned 13 % under rate.
     *
     * The same arithmetic, with this unit's own worst case: the count is a
     * renewal process with mean `μ = 32 x 8 = 256`, so its standard deviation is
     * `sqrt(μ) = 16` and the 99.99th percentile is `μ + 3.72σ = 315`. The same
     * 1.56 headroom gives 492, and 512 is the next sensible number. At 64 bytes
     * a slot that is 32 KB, against the 16 KB §9.2 budgets for the reverb — a
     * doubling on the smallest line in the memory table.
     */
    config.poolSlots = 512;
    /*
     * Max, because Studio's overlap cap is 32 per tap and §4's table asks for
     * exactly 32 at full Smear — the cap would bite at precisely the setting the
     * sheet describes as normal, and a control whose top end is clipped by a
     * quality tier is a control that lies. The tier stays a user choice; this is
     * only its default.
     */
    config.tier = grain::Tier::Max;
    grainArena_.assign(grain::GrainEngine::arenaBytes(config, maxFrames) / sizeof(float) + 4, 0.0f);
    grainConfig_ = config;
    grains_.prepare(sampleRate_, maxFrames, config, grainArena_.data(),
                    grainArena_.size() * sizeof(float));
    cloudL_.assign(static_cast<std::size_t>(maxFrames), 0.0f);
    cloudR_.assign(static_cast<std::size_t>(maxFrames), 0.0f);
    inputBlockerL_.setCoeffs(dsp::onePoleHighpassCoeffs(20.0, sampleRate_));
    inputBlockerR_.setCoeffs(dsp::onePoleHighpassCoeffs(20.0, sampleRate_));
    for (int i = 0; i < kMaxTaps; ++i) {
      filters_[i].setCoeffs(dsp::lowpassCoeffs(18000.0, 0.707, sampleRate_));
      filters_[i].reset();
    }
    dirty_ = true;
    reset();
  }

  void reset() noexcept {
    buffer_.reset();
    loop_.reset();
    grains_.reset();
    inputBlockerL_.reset();
    inputBlockerR_.reset();
    for (int i = 0; i < kMaxTaps; ++i) filters_[i].reset();
    inputPeak_ = 0.0f;
    outputPeak_ = 0.0f;
    loopPeak_ = 0.0f;
  }

  void process(const ProcessContext& ctx) override {
    if (dirty_) rebuild();
    const AudioBuffer& in = ctx.inputs[0];
    AudioBuffer& out = ctx.outputs[0];
    const int frames = ctx.frames;
    const bool stereoIn = in.channelCount() > 1;

    /*
     * The cloud renders the whole block up front, from the buffer as it stood
     * at the first frame.
     *
     * That is the engine's own contract — `GrainSource::writeIndex` is "where
     * the unit's write head is *at the first frame of this block*", and it
     * advances its own copy per sample rather than re-reading a moving head.
     * Rendering per-sample interleaved with the writes below would give it a
     * head that moved under it, which is an offset plus however far the head
     * travelled: a block-size-dependent artefact, and the one GE-12 measures.
     */
    if (!smear_.bypassed() && !bypass_) {
      grain::GrainSource source = buffer_.view(0);
      source.right = buffer_.rightData();
      grains_.process(source, cloudL_.data(), cloudR_.data(), frames);
    } else {
      for (int i = 0; i < frames; ++i) {
        cloudL_[static_cast<std::size_t>(i)] = 0.0f;
        cloudR_[static_cast<std::size_t>(i)] = 0.0f;
      }
    }

    for (int i = 0; i < frames; ++i) {
      const float dryL = in.channel(0)[i];
      const float dryR = stereoIn ? in.channel(1)[i] : dryL;
      inputPeak_ = std::max(inputPeak_, std::max(std::fabs(dryL), std::fabs(dryR)));

      /*
       * **The input is DC-blocked on the way into the buffer, not only in the
       * loop.** §3.1's blocker is in the feedback path, which stops DC
       * *accumulating* — and V5 grades the output, where a single delayed copy
       * of a DC input is still DC. Measured without this the row read −9.0 dBFS
       * against its −80: nothing was recirculating, the loop blocker was doing
       * its job, and the delay was faithfully reproducing the offset it had been
       * given. `fx-02` needed the same blocker for the same row.
       */
      const float blockedL = static_cast<float>(inputBlockerL_.process(static_cast<double>(dryL)));
      const float blockedR = static_cast<float>(inputBlockerR_.process(static_cast<double>(dryR)));

      if (bypass_) {
        // Still in circuit: the buffer keeps running so unbypassing does not
        // start from silence, and the meters keep moving — a bypassed unit that
        // published zeros is the defect X24 found on four units.
        buffer_.write(blockedL, blockedR);
        out.channel(0)[i] = dryL;
        if (out.channelCount() > 1) out.channel(1)[i] = dryR;
        outputPeak_ = std::max(outputPeak_, std::max(std::fabs(dryL), std::fabs(dryR)));
        continue;
      }

      double wetL = static_cast<double>(cloudL_[static_cast<std::size_t>(i)]);
      double wetR = static_cast<double>(cloudR_[static_cast<std::size_t>(i)]);
      for (int t = 0; t < tapCount_; ++t) {
        if (!taps_[t].enabled) continue;
        /*
         * **A smeared tap is rendered by the cloud, not here.**
         *
         * §4: "Smear = 0 must be bit-exact identical to a conventional delay
         * tap", and V2 nulls the whole path against a plain interpolated delay
         * at −140 dBFS to prove it. So the branch is on the *bypass*, not on a
         * blend: at zero the tap is this plain read and the grain engine never
         * sees it, and above zero it is the engine's and this loop skips it.
         * A crossfade between the two would leave the granular machinery
         * colouring the plain delay by however much of it was mixed in, which
         * is exactly what V2 exists to reject.
         */
        if (!smear_.bypassed()) continue;
        // §2's order: read (pitch lives in the read) → filter → level → pan.
        const double samples = tapSamples_[t];
        const double rawL = static_cast<double>(buffer_.read(0, samples));
        const double rawR = static_cast<double>(buffer_.read(1, samples));
        // The tap's own filter runs on the mono sum, because §2 gives each tap
        // one filter rather than two — a stereo pair through one filter's state
        // would be a filter hearing the sum and applying it to each side.
        const double filtered = filters_[t].process(0.5 * (rawL + rawR));
        const double level = filtered * taps_[t].level;
        // Pan places the tap; the buffer's own stereo position survives it,
        // because a centred tap must not collapse a ping-pong repeat to mono.
        const double side = 0.5 * (rawL - rawR) * taps_[t].level;
        wetL += level * tapGainL_[t] + side;
        wetR += level * tapGainR_[t] - side;
      }

      // §3.2(c): the loop's own read, independent of what the taps do.
      // Per channel, because the matrix is what crosses them — folding to mono
      // here would make every topology sound like the mono-summed one.
      const double loopL = static_cast<double>(buffer_.read(0, feedbackSamples_));
      const double loopR = static_cast<double>(buffer_.read(1, feedbackSamples_));
      double backL = 0.0;
      double backR = 0.0;
      loop_.process(loopL, loopR, &backL, &backR);
      loopPeak_ = std::max(loopPeak_,
                           static_cast<float>(std::max(std::fabs(backL), std::fabs(backR))));

      // The input routing vector is the mode selector's, like the matrix — see
      // `inputRoutingFor`. Without it a mono source stays centred for ever in
      // ping-pong, because swapping two identical channels changes nothing.
      buffer_.write(
          static_cast<float>(static_cast<double>(blockedL) * inputRouting_.left + backL),
          static_cast<float>(static_cast<double>(blockedR) * inputRouting_.right + backR));

      const double mix = mix_;
      const double outL = static_cast<double>(dryL) * (1.0 - mix) + wetL * mix;
      const double outR = static_cast<double>(dryR) * (1.0 - mix) + wetR * mix;
      out.channel(0)[i] = static_cast<float>(outL);
      if (out.channelCount() > 1) out.channel(1)[i] = static_cast<float>(outR);
      outputPeak_ =
          std::max(outputPeak_, static_cast<float>(std::max(std::fabs(outL), std::fabs(outR))));
    }
  }

  GranularDelayFrame frame() const noexcept {
    GranularDelayFrame f;
    f.inputPeak = inputPeak_;
    f.outputPeak = outputPeak_;
    f.loopPeak = loopPeak_;
    f.activeTaps = static_cast<std::uint8_t>(tapCount_);
    f.overlap = static_cast<float>(delay::overlapFor(smear_, smear_.grainSeconds));
    for (int i = 0; i < kMaxTaps; ++i) {
      f.tapSeconds[i] = static_cast<float>(tapSamples_[i] / sampleRate_);
    }
    return f;
  }

  /**
   * §2's per-tap filter, exposed so a tap can be shaped independently.
   *
   * Per tap rather than only in the feedback path, because that is what lets a
   * multi-tap delay build a spectral *shape* across the taps — bright early
   * ones, dark late ones — rather than only a decaying one.
   */
  dsp::Biquad& tapFilter(int index) noexcept { return filters_[index]; }

  /// Grains spawned since `reset`, for §9 V14's accounting.
  std::uint64_t spawnedGrains() const noexcept { return grains_.spawned(); }
  /// Grains the pool could not admit. §9 V14 requires this to stay zero.
  std::uint64_t droppedGrains() const noexcept { return grains_.dropped(); }

 private:
  static double clamp01(double v) noexcept { return v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v); }

  void rebuild() noexcept {
    dirty_ = false;
    smear_ = delay::smearAt(smearAmount_);
    loop_.setRouting(delay::routingFor(topology_, cross_));
    inputRouting_ = delay::inputRoutingFor(topology_);
    for (int t = 0; t < kMaxTaps; ++t) {
      const double ratio = std::pow(2.0, taps_[t].pitchSemitones / 12.0);
      const double grain = smear_.bypassed() ? 0.0 : smear_.grainSeconds;
      const double seconds =
          delay::clampDelaySeconds(taps_[t].delaySeconds, buffer_, ratio, grain);
      // Rounded, not truncated — the 0.010 × 48000 = 479.99998 lesson.
      tapSamples_[t] = std::floor(seconds * sampleRate_ + 0.5);
      // §2: equal power, so a pan sweep holds its level.
      const double angle = (taps_[t].pan * 0.5 + 0.5) * 3.14159265358979323846 * 0.5;
      tapGainL_[t] = std::cos(angle);
      tapGainR_[t] = std::sin(angle);
    }
    feedbackSamples_ =
        std::floor(delay::clampDelaySeconds(feedbackSeconds_, buffer_, 1.0, 0.0) * sampleRate_ +
                   0.5);

    /*
     * Each tap's cloud, from §4's one control.
     *
     * Smear drives grains-per-tap, spray, onset jitter and grain length
     * together, because the four only make sense moved together — and the
     * engine's tap slots map one-to-one onto this unit's taps, so a tap's read
     * offset becomes its cloud's minimum offset and its pitch becomes the
     * cloud's interval set.
     */
    for (int t = 0; t < kMaxTaps; ++t) {
      grain::SpawnParams spawn;
      spawn.grainSeconds = static_cast<float>(smear_.grainSeconds);
      spawn.lengthJitter = static_cast<float>(smear_.onsetJitter * 0.25);
      spawn.minOffsetSeconds = static_cast<float>(tapSamples_[t] / sampleRate_);
      spawn.spraySeconds = static_cast<float>(smear_.spraySeconds);
      spawn.sprayAmount = smear_.spraySeconds > 0.0 ? 1.0f : 0.0f;
      spawn.ampJitter = static_cast<float>(smear_.onsetJitter * 0.15);
      // The tap's level and position ride with the grain, because the engine
      // sums every tap into one pair and the host cannot unmix them afterwards.
      spawn.level = static_cast<float>(taps_[t].level);
      spawn.pan = static_cast<float>(taps_[t].pan);
      // Spread is the *smear*'s business, not the tap's: at zero the grains sit
      // exactly where the tap is panned.
      spawn.panSpread = static_cast<float>(smear_.onsetJitter * 0.5);
      spawn.reverse = taps_[t].reverse;
      tapSemitones_[t] = static_cast<float>(taps_[t].pitchSemitones);
      tapWeight_[t] = 1.0f;
      spawn.pitchSemitones = &tapSemitones_[t];
      spawn.pitchWeights = &tapWeight_[t];
      spawn.pitchCount = 1;
      grains_.setSpawn(static_cast<std::uint8_t>(t), spawn);

      grain::ScheduleConfig schedule;
      /*
       * The hop that gives §4's overlap.
       *
       * `overlapFor` is grains-per-tap times length over hop, so the hop that
       * delivers the table's stated overlap is one grain length — see the note
       * in `delay_smear.h` on why the count is streams rather than grains in
       * flight. A tap that is disabled or silent spawns nothing rather than
       * filling pool slots the audible taps need.
       */
      const double hop = smear_.grainSeconds > 0.0 ? smear_.grainSeconds : 1.0;
      const bool live = t < tapCount_ && taps_[t].enabled && !smear_.bypassed();
      schedule.grainsPerSecond =
          live ? static_cast<float>(static_cast<double>(smear_.grainsPerTap) / hop) : 0.0f;
      schedule.onsetJitter = static_cast<float>(smear_.onsetJitter);
      grains_.setSchedule(static_cast<std::uint8_t>(t), schedule);
    }
  }

  delay::DelayBuffer buffer_;
  delay::DelayFeedback loop_;
  grain::GrainEngine grains_;
  grain::EngineConfig grainConfig_;
  std::vector<float> grainArena_;
  std::vector<float> cloudL_;
  std::vector<float> cloudR_;
  /*
   * Held as members because `SpawnParams` keeps *pointers* to the interval set
   * rather than copying it — a local array would dangle the moment `rebuild`
   * returned, and the engine would read whatever the stack held next.
   */
  float tapSemitones_[kMaxTaps] = {0, 0, 0, 0, 0, 0, 0, 0};
  float tapWeight_[kMaxTaps] = {1, 1, 1, 1, 1, 1, 1, 1};
  dsp::Biquad filters_[kMaxTaps];
  TapSettings taps_[kMaxTaps];
  double tapSamples_[kMaxTaps] = {0, 0, 0, 0, 0, 0, 0, 0};
  double tapGainL_[kMaxTaps] = {0, 0, 0, 0, 0, 0, 0, 0};
  double tapGainR_[kMaxTaps] = {0, 0, 0, 0, 0, 0, 0, 0};
  delay::SmearSettings smear_;
  delay::InputRouting inputRouting_;
  dsp::Biquad inputBlockerL_;
  dsp::Biquad inputBlockerR_;

  double sampleRate_ = 48000.0;
  double mix_ = 0.35;
  double cross_ = 0.0;
  double smearAmount_ = 0.0;
  double bpm_ = 120.0;
  double feedbackSeconds_ = 0.250;
  double feedbackSamples_ = 12000.0;
  int tapCount_ = 1;
  delay::Topology topology_ = delay::Topology::Dual;
  bool bypass_ = false;
  bool dirty_ = true;

  float inputPeak_ = 0.0f;
  float outputPeak_ = 0.0f;
  float loopPeak_ = 0.0f;
};

}  // namespace mw::units
