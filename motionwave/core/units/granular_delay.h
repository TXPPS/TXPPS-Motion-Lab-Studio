// Motion Wave — the Granular Delay, `fx-03`.
//
// One buffer, N taps, a routing matrix (§1.2). The topologies are a matrix
// choice rather than three engines, the per-tap order is fixed by §2 because
// pitch is a property of *how the grain is read* and so must precede
// everything, and the feedback tap is a separate dedicated read rather than the
// sum of the output taps — §3.2(c), which decouples "how many taps you hear"
// from "how long it rings" and is both more stable and more musical.
//
// The medium sits around the buffer rather than inside the loop
// (`delay_character.h`), every tap has a transport of its own sharing one wow
// (`delay_transport.h`), and what follows the read lives with the tap
// (`delay_tap.h`). What is left here is the signal path in the order §1.2 draws
// it, and the rebuild that turns thirty controls into that path's numbers.
#pragma once

#include "../dsp/biquad.h"
#include "../dsp/feedback_chain.h"
#include "../dsp/grain/engine.h"
#include "../dsp/visual_state.h"
#include "../graph/node.h"
#include "delay_character.h"
#include "delay_feedback.h"
#include "delay_line.h"
#include "delay_routing.h"
#include "delay_smear.h"
#include "delay_sync.h"
#include "delay_tap.h"
#include "delay_transport.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace mw::units {

namespace grain = dsp::grain;

/// §3.2(c): where the loop's own read takes its time from.
enum class FeedbackSource : std::uint8_t { Dedicated = 0, FirstTap, LongestTap };

/// What the face draws. Packed by `wasm/bridge.cpp` in this order.
struct GranularDelayFrame {
  float inputPeak = 0.0f;
  float outputPeak = 0.0f;
  /// The loop signal, which is what §9 V4 grades — the thing that recirculates.
  float loopPeak = 0.0f;
  /// `v(t)/v(t−D)` on the first tap, averaged over the block: the pitch the
  /// transport applied. The mean rather than the last sample, because the
  /// face's number and the audio's mean frequency over the same span are then
  /// the same quantity, and V8 holds them to two cents of each other.
  float pitchRatio = 1.0f;
  /// Delivered per-tap time in seconds, after the transport and §2's clamp.
  float tapSeconds[delay::kMaxTaps] = {0, 0, 0, 0, 0, 0, 0, 0};
  float overlap = 0.0f;
  /// The line's clock in BBD mode, `N/(2D)` — a number no control states.
  float clockHz = 0.0f;
  float duckGain = 1.0f;
  float cloudDepthSeconds = 0.0f;
  std::uint16_t liveGrains = 0;
  std::uint8_t activeTaps = 1;
  std::uint8_t padding = 0;
};

using GranularDelayPublisher = dsp::FramePublisher<GranularDelayFrame>;
using delay::TapSettings;

class GranularDelay : public Node {
 public:
  // ---- §7.1 global ---------------------------------------------------------
  void setMix(double amount) noexcept { mix_ = clamp01(amount); }
  void setTopology(delay::Topology topology) noexcept { topology_ = topology; dirty_ = true; }
  void setCross(double amount) noexcept { cross_ = clamp01(amount); dirty_ = true; }
  void setTapCount(int count) noexcept {
    tapCount_ = count < 1 ? 1 : (count > delay::kMaxTaps ? delay::kMaxTaps : count);
    dirty_ = true;
  }
  void setSync(bool on) noexcept { ctx_.sync = on; dirty_ = true; }
  void setTimeMode(delay::TimeMode mode) noexcept { ctx_.timeMode = mode; dirty_ = true; }
  void setSpacing(delay::Spacing spacing) noexcept { ctx_.spacing = spacing; dirty_ = true; }
  void setFeedback(double amount) noexcept {
    // §3.2 exposes 0–130 %; the saturator's drive floor is what makes the top
    // of that range safe rather than reckless. See `DelayFeedback`.
    loop_.setFeedback(amount < 0.0 ? 0.0 : (amount > 1.3 ? 1.3 : amount));
  }
  void setFeedbackSource(FeedbackSource source) noexcept { fbSource_ = source; dirty_ = true; }
  void setFeedbackTapSeconds(double seconds) noexcept {
    fbSeconds_ = seconds < 0.001 ? 0.001 : seconds;
    dirty_ = true;
  }
  void setFeedbackDivision(delay::Division d) noexcept { fbDivision_ = d; dirty_ = true; }
  void setFeedbackModifier(delay::Modifier m) noexcept { fbModifier_ = m; dirty_ = true; }
  void setLoopLowpass(double hz) noexcept { loop_.setLoopLowpass(hz); }
  void setLoopHighpass(double hz) noexcept { loop_.setLoopHighpass(hz); }
  void setDrive(double drive) noexcept { loop_.setDrive(drive); }
  void setCharacter(delay::Character c) noexcept { character_ = c; dirty_ = true; }
  void setWear(delay::Wear wear) noexcept { wow_.setWear(wear); }
  void setBias(double bias) noexcept { bias_ = clamp01(bias); dirty_ = true; }
  void setAge(double age) noexcept { age_ = clamp01(age); dirty_ = true; }
  void setBbdStages(int selector) noexcept { stages_ = delay::bbdStagesFor(selector); dirty_ = true; }
  void setClockWhine(bool on) noexcept { whine_ = on; dirty_ = true; }
  void setTimeChangeMode(delay::TimeChangeMode mode) noexcept {
    timeMode_ = mode;
    for (delay::TapTransport& t : transport_) t.setMode(mode);
    loopTransport_.setMode(mode);
  }
  void setSmear(double amount) noexcept { smearAmount_ = clamp01(amount); dirty_ = true; }
  void setDucking(double amount) noexcept { ducking_ = clamp01(amount); }
  void setWidth(double amount) noexcept { width_ = amount < 0.0 ? 0.0 : (amount > 2.0 ? 2.0 : amount); }
  void setOutputTrimDb(double db) noexcept { trim_ = std::pow(10.0, db / 20.0); }
  void setQuality(delay::Quality q) noexcept { quality_ = q; dirty_ = true; }
  void setBypass(bool bypass) noexcept { bypass_ = bypass; }
  void setBpm(double bpm) noexcept {
    const double clamped = bpm > 1.0 ? bpm : 1.0;
    if (clamped == ctx_.bpm) return;
    ctx_.bpm = clamped;
    dirty_ = true;
  }
  // ---- §7.2 per tap -------------------------------------------------------
  void setTap(int index, const TapSettings& settings) noexcept {
    if (index < 0 || index >= delay::kMaxTaps) return;
    taps_[index] = settings;
    dirty_ = true;
  }
  const TapSettings& tap(int index) const noexcept { return taps_[index]; }

  void prepare(double sampleRate, int maxFrames) override {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    // Eight seconds, which holds §5's longest division (eight bars at 60 bpm is
    // thirty-two seconds — longer than any buffer we would ship, so the sync
    // table's top entries clamp rather than allocate).
    buffer_.prepare(sampleRate_, 8.0);
    loop_.prepare(sampleRate_);
    /*
     * **One engine, one pool, one ceiling — for up to eight taps.** The pool
     * partitions its slots per tap, and every guarantee it makes — GE-08's drop
     * accounting, GE-15's zero-allocation proof, the percentile sizing — assumes
     * one allocation domain. Eight engines would split the ceiling eight ways.
     * 512 slots: eight taps at 32 streams is a mean of 256 in flight, sd 16,
     * 99.99th percentile 315, times the same 1.56 headroom `fx-02` used.
     */
    grain::EngineConfig config;
    config.tapCount = delay::kMaxTaps;
    config.poolSlots = 512;
    config.tier = grain::Tier::Max;
    grainArena_.assign(grain::GrainEngine::arenaBytes(config, maxFrames) / sizeof(float) + 4, 0.0f);
    grains_.prepare(sampleRate_, maxFrames, config, grainArena_.data(),
                    grainArena_.size() * sizeof(float));
    cloudL_.assign(static_cast<std::size_t>(maxFrames), 0.0f);
    cloudR_.assign(static_cast<std::size_t>(maxFrames), 0.0f);
    inputBlockerL_.setCoeffs(dsp::onePoleHighpassCoeffs(20.0, sampleRate_));
    inputBlockerR_.setCoeffs(dsp::onePoleHighpassCoeffs(20.0, sampleRate_));
    for (int t = 0; t < delay::kMaxTaps; ++t) {
      transport_[t].prepare(sampleRate_, 8.0);
      state_[t].prepare(sampleRate_);
    }
    loopTransport_.prepare(sampleRate_, 8.0);
    wow_.prepare(sampleRate_, 0x5EEDF00DCAFEBABEull);
    for (int c = 0; c < 2; ++c) {
      record_[c].prepare(sampleRate_, 0xA5A5A5A5ull + static_cast<std::uint64_t>(c));
      play_[c].prepare(sampleRate_, 0x3C3C3C3Cull + static_cast<std::uint64_t>(c));
      loopPlay_[c].prepare(sampleRate_, 0x77777777ull + static_cast<std::uint64_t>(c));
    }
    // Ducking: §7.1's "input-triggered gain reduction on the wet bus". Fast to
    // catch the transient that should duck the repeat, slow enough that the
    // repeat comes back between phrases rather than between syllables.
    duckAttack_ = 1.0 - std::exp(-1.0 / (0.005 * sampleRate_));
    duckRelease_ = 1.0 - std::exp(-1.0 / (0.250 * sampleRate_));
    running_ = false;
    dirty_ = true;
    reset();
  }

  void reset() noexcept override {
    buffer_.reset();
    loop_.reset();
    grains_.reset();
    inputBlockerL_.reset();
    inputBlockerR_.reset();
    wow_.reset();
    for (int t = 0; t < delay::kMaxTaps; ++t) state_[t].reset();
    for (int c = 0; c < 2; ++c) {
      record_[c].reset();
      play_[c].reset();
      loopPlay_[c].reset();
    }
    duckEnv_ = 0.0;
    ratioSum_ = 0.0;
    ratioFrames_ = 0;
    inputPeak_ = 0.0f;
    outputPeak_ = 0.0f;
    loopPeak_ = 0.0f;
    // A seek snaps every transport to its nominal time rather than slewing to
    // it: a bend on the first block after a locate would be a bend nobody asked
    // for. The next `process` rebuilds and snaps because `running_` is false.
    running_ = false;
    dirty_ = true;
  }

  void process(const ProcessContext& ctx) override;

  GranularDelayFrame frame() const noexcept { return lastFrame_; }
  GranularDelayPublisher& visual() noexcept { return visual_; }

  /// Grains spawned since `reset`, for §9 V14's accounting.
  std::uint64_t spawnedGrains() const noexcept { return grains_.spawned(); }
  /// Grains the pool could not admit. §9 V14 requires this to stay zero.
  std::uint64_t droppedGrains() const noexcept { return grains_.dropped(); }
  /// A tap's delivered delay in seconds, after the transport.
  double deliveredTapSeconds(int t) const noexcept {
    return transport_[t].delaySamples() / sampleRate_;
  }
  double firstTapPitchRatio() const noexcept { return transport_[0].pitchRatio(); }

 private:
  static double clamp01(double v) noexcept { return v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v); }

  /// Whether a tap's read is the grain engine's rather than a plain head.
  bool granular(int t) const noexcept {
    // A pitched or reversed tap has no plain form: a plain delay cannot shift
    // pitch continuously and §2 says a reversed span needs a grain to define
    // it. Everything else follows Smear, and at zero it is a plain read — V2's
    // null against a conventional delay depends on this being a branch and
    // not a blend.
    return !smear_.bypassed() || taps_[t].reverse || taps_[t].pitchSemitones != 0.0 ||
           taps_[t].fineCents != 0.0;
  }

  void rebuild() noexcept;
  void publish() noexcept;

  delay::DelayBuffer buffer_;
  delay::DelayFeedback loop_;
  grain::GrainEngine grains_;
  std::vector<float> grainArena_;
  std::vector<float> cloudL_;
  std::vector<float> cloudR_;
  delay::TapTransport transport_[delay::kMaxTaps];
  delay::TapTransport loopTransport_;
  delay::TapState state_[delay::kMaxTaps];
  delay::WowFlutter wow_;
  delay::CharacterChannel record_[2];
  delay::CharacterChannel play_[2];
  delay::CharacterChannel loopPlay_[2];
  /*
   * Held as members because `SpawnParams` keeps *pointers* to the interval set
   * rather than copying it — a local array would dangle the moment `rebuild`
   * returned, and the engine would read whatever the stack held next.
   */
  float tapSemitones_[delay::kMaxTaps] = {0, 0, 0, 0, 0, 0, 0, 0};
  float tapWeight_[delay::kMaxTaps] = {1, 1, 1, 1, 1, 1, 1, 1};
  TapSettings taps_[delay::kMaxTaps];
  double tapSeconds_[delay::kMaxTaps] = {0, 0, 0, 0, 0, 0, 0, 0};
  bool tapGranular_[delay::kMaxTaps] = {false, false, false, false, false, false, false, false};
  bool tapLive_[delay::kMaxTaps] = {false, false, false, false, false, false, false, false};
  delay::TapContext ctx_;
  delay::SmearSettings smear_;
  delay::InputRouting inputRouting_;
  dsp::Biquad inputBlockerL_;
  dsp::Biquad inputBlockerR_;
  GranularDelayPublisher visual_;
  GranularDelayFrame lastFrame_;

  double sampleRate_ = 48000.0;
  double mix_ = 0.30;
  double cross_ = 0.5;
  double smearAmount_ = 0.0;
  double fbSeconds_ = 0.250;
  double bias_ = 0.0;
  double age_ = 0.0;
  double ducking_ = 0.0;
  double width_ = 1.0;
  double trim_ = 1.0;
  double duckEnv_ = 0.0;
  double duckAttack_ = 0.01;
  double duckRelease_ = 0.001;
  double duckGain_ = 1.0;
  double ratioSum_ = 0.0;
  int ratioFrames_ = 0;
  double longestSeconds_ = 0.25;
  int tapCount_ = 4;
  int stages_ = 4096;
  delay::Topology topology_ = delay::Topology::Dual;
  FeedbackSource fbSource_ = FeedbackSource::Dedicated;
  delay::Division fbDivision_ = delay::Division::Eighth;
  delay::Modifier fbModifier_ = delay::Modifier::Straight;
  delay::Character character_ = delay::Character::Clean;
  delay::TimeChangeMode timeMode_ = delay::TimeChangeMode::Digital;
  delay::Quality quality_ = delay::Quality::High;
  bool whine_ = true;
  bool bypass_ = false;
  bool dirty_ = true;
  bool running_ = false;

  float inputPeak_ = 0.0f;
  float outputPeak_ = 0.0f;
  float loopPeak_ = 0.0f;
};

inline void GranularDelay::rebuild() noexcept {
  dirty_ = false;
  smear_ = delay::smearAt(smearAmount_);
  loop_.setRouting(delay::routingFor(topology_, cross_));
  inputRouting_ = delay::inputRoutingFor(topology_);
  ctx_.anySolo = false;
  for (int t = 0; t < tapCount_; ++t) ctx_.anySolo = ctx_.anySolo || (taps_[t].enabled && taps_[t].solo);
  ctx_.firstTapSeconds = delay::resolveTapSeconds(taps_[0], 0, ctx_);

  longestSeconds_ = 0.001;
  for (int t = 0; t < delay::kMaxTaps; ++t) {
    const bool live = t < tapCount_ && delay::tapAudible(taps_[t], ctx_);
    tapLive_[t] = live;
    tapGranular_[t] = granular(t);
    const double ratio = std::pow(2.0, (taps_[t].pitchSemitones + taps_[t].fineCents / 100.0) / 12.0);
    // §2: a reversed tap needs a grain of at least 30 ms to reverse within.
    double grainSeconds = smear_.bypassed() ? 0.0 : smear_.grainSeconds;
    if (tapGranular_[t] && grainSeconds < 0.030) grainSeconds = taps_[t].reverse ? 0.030 : 0.120;
    const double asked = delay::resolveTapSeconds(taps_[t], t, ctx_);
    tapSeconds_[t] = delay::clampDelaySeconds(asked, buffer_, ratio, grainSeconds);
    if (live) longestSeconds_ = std::max(longestSeconds_, tapSeconds_[t]);
    // Rounded, not truncated — the 0.010 × 48000 = 479.99998 lesson.
    const double samples = std::floor(tapSeconds_[t] * sampleRate_ + 0.5);
    if (running_) transport_[t].setDelay(samples);
    else transport_[t].reset(samples);
    state_[t].configure(taps_[t], live);

    // Each tap's cloud, from §4's one control: Smear drives grains-per-tap,
    // spray, onset jitter and grain length together because the four only make
    // sense moved together. A tap's read offset is its cloud's minimum offset
    // and its pitch is the cloud's interval set.
    grain::SpawnParams spawn;
    spawn.grainSeconds = static_cast<float>(grainSeconds > 0.0 ? grainSeconds : 0.120);
    spawn.lengthJitter = static_cast<float>(smear_.onsetJitter * 0.25);
    spawn.minOffsetSeconds = static_cast<float>(tapSeconds_[t]);
    spawn.spraySeconds = static_cast<float>(smear_.spraySeconds);
    spawn.sprayAmount = smear_.spraySeconds > 0.0 ? 1.0f : 0.0f;
    spawn.ampJitter = static_cast<float>(smear_.onsetJitter * 0.15);
    spawn.level = static_cast<float>(live ? taps_[t].level : 0.0);
    spawn.pan = static_cast<float>(taps_[t].pan);
    spawn.panSpread = static_cast<float>(smear_.onsetJitter * 0.5);
    spawn.reverse = taps_[t].reverse;
    tapSemitones_[t] = static_cast<float>(taps_[t].pitchSemitones + taps_[t].fineCents / 100.0);
    tapWeight_[t] = 1.0f;
    spawn.pitchSemitones = &tapSemitones_[t];
    spawn.pitchWeights = &tapWeight_[t];
    spawn.pitchCount = 1;
    grains_.setSpawn(static_cast<std::uint8_t>(t), spawn);

    grain::ScheduleConfig schedule;
    // The hop that gives §4's overlap is one grain length; a pitched-only tap
    // at Smear zero runs one continuous stream. A tap that is disabled or
    // silent spawns nothing rather than filling pool slots the audible ones need.
    const double hop = grainSeconds > 0.0 ? grainSeconds : 1.0;
    const int streams = smear_.bypassed() ? 1 : smear_.grainsPerTap;
    schedule.grainsPerSecond =
        live && tapGranular_[t] ? static_cast<float>(static_cast<double>(streams) / hop) : 0.0f;
    schedule.onsetJitter = static_cast<float>(smear_.onsetJitter);
    grains_.setSchedule(static_cast<std::uint8_t>(t), schedule);
  }
  grains_.setTier(quality_ == delay::Quality::Eco      ? grain::Tier::Eco
                  : quality_ == delay::Quality::Normal ? grain::Tier::Studio
                                                        : grain::Tier::Max);

  // §3.2(c): the loop's own read. Dedicated has its own time and follows the
  // global sync switch; the other two follow a tap, which is the documented
  // "feedback length equal to the longest delay time" variant.
  double loopSeconds = ctx_.sync ? delay::delaySecondsFor(fbDivision_, fbModifier_, ctx_.bpm)
                                 : fbSeconds_;
  if (fbSource_ == FeedbackSource::FirstTap) loopSeconds = tapSeconds_[0];
  if (fbSource_ == FeedbackSource::LongestTap) loopSeconds = longestSeconds_;
  const double loopSamples =
      std::floor(delay::clampDelaySeconds(loopSeconds, buffer_, 1.0, 0.0) * sampleRate_ + 0.5);
  if (running_) loopTransport_.setDelay(loopSamples);
  else loopTransport_.reset(loopSamples);

  // The medium: one set of numbers for both channels and both playback paths.
  // The bandwidth couples to the longest line, because that is the line the
  // slowest clock and the slowest tape are set by.
  for (int c = 0; c < 2; ++c) {
    record_[c].set(character_, quality_, bias_, age_, stages_, longestSeconds_, whine_);
    play_[c].set(character_, quality_, bias_, age_, stages_, longestSeconds_, whine_);
    loopPlay_[c].set(character_, quality_, bias_, age_, stages_, longestSeconds_, false);
  }
  running_ = true;
}

inline void GranularDelay::process(const ProcessContext& ctx) {
  if (dirty_) rebuild();
  const AudioBuffer& in = ctx.inputs[0];
  AudioBuffer& out = ctx.outputs[0];
  const int frames = ctx.frames;
  ratioFrames_ += frames;
  const bool stereoIn = in.channelCount() > 1;
  const bool stereoOut = out.channelCount() > 1;

  /*
   * The cloud renders the whole block up front, from the buffer as it stood at
   * the first frame — the engine's own contract (`GrainSource::writeIndex` is
   * the head *at the first frame of this block*). Interleaving it with the
   * writes below would hand it a head that moved under it, which is the
   * block-size-dependent artefact GE-12 measures.
   */
  bool anyGranular = false;
  for (int t = 0; t < tapCount_; ++t) anyGranular = anyGranular || (tapLive_[t] && tapGranular_[t]);
  if (anyGranular && !bypass_) {
    grain::GrainSource source = buffer_.view(0);
    source.right = buffer_.rightData();
    grains_.process(source, cloudL_.data(), cloudR_.data(), frames);
  } else {
    for (int i = 0; i < frames; ++i) {
      cloudL_[static_cast<std::size_t>(i)] = 0.0f;
      cloudR_[static_cast<std::size_t>(i)] = 0.0f;
    }
  }

  const bool tape = character_ == delay::Character::Tape;
  const bool eco = quality_ == delay::Quality::Eco;
  for (int i = 0; i < frames; ++i) {
    const float dryL = in.channel(0)[i];
    const float dryR = stereoIn ? in.channel(1)[i] : dryL;
    const double dryPeak = std::max(std::fabs(dryL), std::fabs(dryR));
    inputPeak_ = std::max(inputPeak_, static_cast<float>(dryPeak));
    duckEnv_ += (dryPeak > duckEnv_ ? duckAttack_ : duckRelease_) * (dryPeak - duckEnv_);

    // DC-blocked on the way into the buffer, not only in the loop: §3.1's
    // blocker stops DC *accumulating*, and V5 grades the output, where a single
    // delayed copy of a DC input is still DC. Measured without this the row
    // read −9 dBFS against its −80.
    const float blockedL = static_cast<float>(inputBlockerL_.process(static_cast<double>(dryL)));
    const float blockedR = static_cast<float>(inputBlockerR_.process(static_cast<double>(dryR)));

    if (bypass_) {
      // Still in circuit: the buffer keeps running so unbypassing does not
      // start from silence, and the meters keep moving — a bypassed unit that
      // published zeros was the defect X24 found on four units.
      ratioSum_ += 1.0;
      buffer_.write(blockedL, blockedR);
      out.channel(0)[i] = dryL;
      if (stereoOut) out.channel(1)[i] = dryR;
      outputPeak_ = std::max(outputPeak_, static_cast<float>(dryPeak));
      continue;
    }

    // One motor's wobble, shared by every head. Zero unless the medium is tape.
    const double epsilon = tape ? wow_.next() : 0.0;
    double wetL = static_cast<double>(cloudL_[static_cast<std::size_t>(i)]);
    double wetR = static_cast<double>(cloudR_[static_cast<std::size_t>(i)]);
    for (int t = 0; t < tapCount_; ++t) {
      const delay::HeadRead head = transport_[t].advance(epsilon);
      if (t == 0) ratioSum_ += transport_[0].pitchRatio();
      if (!tapLive_[t] || tapGranular_[t]) continue;
      // Linear only where §9.3 permits it: Eco, and nothing moving the read.
      const bool still = eco && epsilon == 0.0 && !head.twoHeads;
      double rawL = still ? buffer_.readLinear(0, head.delayA) : buffer_.read(0, head.delayA);
      double rawR = still ? buffer_.readLinear(1, head.delayA) : buffer_.read(1, head.delayA);
      if (head.twoHeads) {
        rawL = rawL * head.gainA + buffer_.read(0, head.delayB) * head.gainB;
        rawR = rawR * head.gainA + buffer_.read(1, head.delayB) * head.gainB;
      }
      state_[t].shape(rawL, rawR, &wetL, &wetR);
    }

    // §3.2(c): the loop's own read, through the playback half of the medium so
    // a compander pair sees the same signal round the loop that it sees at the
    // output — a feedback taken from the compressed domain would compress the
    // repeats twice per pass and expand them once.
    const delay::HeadRead loopHead = loopTransport_.advance(epsilon);
    double loopL = buffer_.read(0, loopHead.delayA);
    double loopR = buffer_.read(1, loopHead.delayA);
    if (loopHead.twoHeads) {
      loopL = loopL * loopHead.gainA + buffer_.read(0, loopHead.delayB) * loopHead.gainB;
      loopR = loopR * loopHead.gainA + buffer_.read(1, loopHead.delayB) * loopHead.gainB;
    }
    loopL = loopPlay_[0].processOut(loopL);
    loopR = loopPlay_[1].processOut(loopR);
    double backL = 0.0;
    double backR = 0.0;
    loop_.process(loopL, loopR, &backL, &backR);
    loopPeak_ = std::max(loopPeak_, static_cast<float>(std::max(std::fabs(backL), std::fabs(backR))));

    // The record head sees the new input and the returned repeats together,
    // which is where §6.3's repeat-by-repeat accumulation comes from.
    const double inL = static_cast<double>(blockedL) * inputRouting_.left + backL;
    const double inR = static_cast<double>(blockedR) * inputRouting_.right + backR;
    buffer_.write(static_cast<float>(record_[0].processIn(inL)),
                  static_cast<float>(record_[1].processIn(inR)));

    // The playback head, on the wet bus; then §7.1's ducking and width.
    wetL = play_[0].processOut(wetL);
    wetR = play_[1].processOut(wetR);
    duckGain_ = 1.0 - ducking_ * std::min(1.0, duckEnv_ / 0.3);
    const double mid = 0.5 * (wetL + wetR) * duckGain_;
    const double side = 0.5 * (wetL - wetR) * duckGain_ * width_;
    wetL = mid + side;
    wetR = mid - side;

    const double outL = (static_cast<double>(dryL) * (1.0 - mix_) + wetL * mix_) * trim_;
    const double outR = (static_cast<double>(dryR) * (1.0 - mix_) + wetR * mix_) * trim_;
    out.channel(0)[i] = static_cast<float>(outL);
    if (stereoOut) out.channel(1)[i] = static_cast<float>(outR);
    outputPeak_ = std::max(outputPeak_, static_cast<float>(std::max(std::fabs(outL), std::fabs(outR))));
  }
  publish();
}

inline void GranularDelay::publish() noexcept {
  GranularDelayFrame f;
  f.inputPeak = inputPeak_;
  f.outputPeak = outputPeak_;
  f.loopPeak = loopPeak_;
  f.pitchRatio = static_cast<float>(ratioFrames_ > 0 ? ratioSum_ / ratioFrames_ : 1.0);
  ratioSum_ = 0.0;
  ratioFrames_ = 0;
  f.activeTaps = static_cast<std::uint8_t>(tapCount_);
  f.overlap = static_cast<float>(delay::overlapFor(smear_, smear_.grainSeconds));
  f.clockHz = character_ == delay::Character::Bbd ? static_cast<float>(record_[0].bbdClockHz()) : 0.0f;
  f.duckGain = static_cast<float>(duckGain_);
  f.cloudDepthSeconds = grains_.cloudDepthSeconds();
  f.liveGrains = static_cast<std::uint16_t>(grains_.liveGrains());
  for (int t = 0; t < delay::kMaxTaps; ++t) {
    f.tapSeconds[t] = static_cast<float>(transport_[t].delaySamples() / sampleRate_);
  }
  lastFrame_ = f;
  visual_.publish(f);
  // Peaks are per block, like every other unit's: a peak that only ever rose
  // would be a meter that read the loudest thing since the session started.
  inputPeak_ = 0.0f;
  outputPeak_ = 0.0f;
  loopPeak_ = 0.0f;
}

}  // namespace mw::units
