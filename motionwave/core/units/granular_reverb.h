// Motion Wave — FX-02, the Granular Reverb.
//
// `fx-02` §2.1's topology: the granular output is fed back into the source
// buffer together with the input, so the decay mechanism is the buffer itself
// rather than a bank of combs. One circular buffer with randomised read offsets
// gives the same statistical result as the literature's eight time-stretched
// buffers, and it makes freeze trivial — which §2.4 says is the only safe form.
//
// The three stability hazards §2.2 calls mandatory are each somewhere specific:
// the density normalisation is applied at spawn *inside* the loop (the grain
// engine does it, and GE-06/V6 measure it), the DC blocker and the soft limiter
// are in `FeedbackChain`, and the feedback gain is capped at 0.98 below.
#pragma once

#include "../dsp/diffuser.h"
#include "../dsp/feedback_chain.h"
#include "../dsp/grain/engine.h"
#include "../dsp/visual_state.h"
#include "../graph/node.h"
#include "reverb_decay.h"
#include "shimmer_sets.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace mw::units {

namespace grain = dsp::grain;

/// What the face draws, beside the grain engine's own particle frame.
struct GranularReverbFrame {
  float inputPeak = 0.0f;
  float outputPeak = 0.0f;
  /// §6: not a control. `O = R·L` is the number that predicts both the sound
  /// and the CPU, and the panel shows it live.
  float overlap = 0.0f;
  float clampedDensity = 0.0f;
  /// §2.5 asks for this next to the Damping control, because it turns an opaque
  /// parameter into a legible one and costs nothing.
  float rt60At8k = 0.0f;
  float feedback = 0.0f;
  std::uint16_t liveGrains = 0;
  bool frozen = false;
};

using GranularReverbPublisher = dsp::FramePublisher<GranularReverbFrame>;

class GranularReverb : public Node {
 public:
  /// §3.2's interval sets; see `shimmer_sets.h` for the table and for the
  /// stability rule each one forces on the loop.
  void setPitchSet(shimmer::Set set) noexcept {
    pitchSet_ = set;
    dirty_ = true;
  }

  // ---- configuration, off the audio thread ----

  void setMix(double amount) noexcept { mix_ = clamp01(amount); }
  void setPreDelaySeconds(double seconds) noexcept {
    preDelaySeconds_ = seconds < 0.0 ? 0.0 : (seconds > 0.5 ? 0.5 : seconds);
    dirty_ = true;
  }

  /**
   * §6's sync-to-tempo option for the pre-delay.
   *
   * The division is in quarter notes — 1.0 is a quarter, 0.5 an eighth — and
   * zero means the control is in milliseconds, which is the default and what
   * every row written before this used. A synced pre-delay is the one place in
   * this unit where a musical value beats a time: a pre-delay is heard against
   * the material, and the material has a tempo.
   *
   * The tempo comes from the host per block, exactly as the Motion Shaper takes
   * it, rather than from the tempo map directly. A unit that read the map itself
   * would be keeping a second opinion about where the song is, and `node.h` says
   * in as many words that a processor wanting bars asks rather than remembers.
   */
  void setPreDelayQuarters(double quarters) noexcept {
    preDelayQuarters_ = quarters < 0.0 ? 0.0 : (quarters > 4.0 ? 4.0 : quarters);
    dirty_ = true;
  }

  /// Tempo the synced pre-delay resolves against. Set by the host per block.
  void setBpm(double bpm) noexcept {
    const double clamped = bpm > 1.0 ? bpm : 1.0;
    if (clamped == bpm_) return;
    bpm_ = clamped;
    // Only a synced pre-delay depends on it, so an unsynced unit does not
    // rebuild its whole coefficient set every time the host reports a tempo.
    if (preDelayQuarters_ > 0.0) dirty_ = true;
  }
  void setSizeSeconds(double seconds) noexcept {
    sizeSeconds_ = clampRange(seconds, 0.020, 4.000);
    dirty_ = true;
  }
  void setMinOffsetSeconds(double seconds) noexcept {
    minOffsetSeconds_ = clampRange(seconds, 0.005, 0.500);
    dirty_ = true;
  }
  /// §6: RT60 in seconds. Inverted to a feedback gain by §2.2's relation.
  void setDecaySeconds(double seconds) noexcept {
    decaySeconds_ = clampRange(seconds, 0.1, 60.0);
    dirty_ = true;
  }
  void setFreeze(bool frozen) noexcept { freezeTarget_ = frozen ? 0.0f : 1.0f; }
  void setGrainSeconds(double seconds) noexcept {
    grainSeconds_ = clampRange(seconds, 0.005, 0.500);
    dirty_ = true;
  }
  void setDensity(double grainsPerSecond) noexcept {
    density_ = clampRange(grainsPerSecond, 1.0, 2000.0);
    dirty_ = true;
  }
  void setSpray(double amount) noexcept {
    spray_ = clamp01(amount);
    dirty_ = true;
  }
  void setOnsetJitter(double amount) noexcept {
    onsetJitter_ = clamp01(amount);
    dirty_ = true;
  }
  void setLengthJitter(double amount) noexcept {
    lengthJitter_ = clamp01(amount);
    dirty_ = true;
  }
  void setAmpJitter(double amount) noexcept {
    ampJitter_ = clamp01(amount);
    dirty_ = true;
  }
  /// §6: 0 % is Hann and 100 % is Tukey with α = 0.1.
  void setWindowShape(double amount) noexcept {
    windowShape_ = clamp01(amount);
    dirty_ = true;
  }
  void setPitchSpreadCents(double cents) noexcept {
    pitchSpreadCents_ = clampRange(cents, 0.0, 100.0);
    dirty_ = true;
  }
  void setDiffusion(double amount) noexcept {
    diffusion_ = clamp01(amount);
    dirty_ = true;
  }
  void setDamping(double amount) noexcept {
    damping_ = clamp01(amount);
    dirty_ = true;
  }
  void setTiltDb(double decibels) noexcept {
    tiltDb_ = clampRange(decibels, -12.0, 12.0);
    dirty_ = true;
  }
  void setWidth(double amount) noexcept { width_ = clampRange(amount, 0.0, 2.0); }
  void setOutputTrimDb(double decibels) noexcept {
    outputTrim_ = std::pow(10.0, clampRange(decibels, -24.0, 24.0) / 20.0);
  }
  void setTier(grain::Tier tier) noexcept {
    tier_ = tier;
    dirty_ = true;
  }
  void setBypass(bool bypass) noexcept { bypass_ = bypass; }

  /**
   * The grain engine's seed.
   *
   * Exposed because an ensemble measurement needs independent draws of the
   * *engine*, not of the excitation: varying the noise or the starting phase
   * resamples the stimulus while leaving the scheduler and the spawn RNG on the
   * same stream, so the runs stay correlated and averaging them converges on
   * the wrong number. Changing the seed is what makes two runs independent.
   *
   * It is part of the configuration rather than drawn from a clock, so a render
   * stays a pure function of (graph, spec) and a golden file remains checkable.
   */
  void setSeed(std::uint64_t seed) noexcept {
    seed_ = seed;
    reseed_ = true;
    dirty_ = true;
  }

  // ---- Node ----

  void prepare(double sampleRate, int blockSize) override {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    blockSize_ = blockSize > 0 ? blockSize : 128;

    // Sized for the largest read the controls can ask for: the minimum offset,
    // the size window, one whole grain at the deepest pitch, and the pre-delay.
    // Rounded up to a power of two because the engine's wrap is a mask.
    const double longest = 0.500 + 4.000 + 0.500 * 2.0 + 0.500 + 0.5;
    int capacity = 1;
    while (static_cast<double>(capacity) < longest * sampleRate_) capacity <<= 1;
    buffer_.assign(static_cast<std::size_t>(capacity), 0.0f);
    capacity_ = capacity;
    mask_ = capacity - 1;

    /*
     * Sized for the *synced* maximum, not the millisecond control's range.
     *
     * §6 gives Pre-delay 0–500 ms, and a musical value legitimately exceeds
     * that: four quarters at 60 bpm is four seconds. Sizing this line at half a
     * second and clamping the resolved delay into it made a quarter note arrive
     * at the same instant at 120 bpm and at 80, because both resolved past the
     * cap and both stopped there — a tempo control that looked wired and was
     * being clamped away downstream.
     */
    preDelay_.assign(static_cast<std::size_t>(sampleRate_ * kMaxPreDelaySeconds) + 4, 0.0f);
    wetL_.assign(static_cast<std::size_t>(blockSize_), 0.0f);
    wetR_.assign(static_cast<std::size_t>(blockSize_), 0.0f);

    grain::EngineConfig config;
    config.seed = seed_;
    config.tapCount = 1;
    config.poolSlots = 256;
    config.maxGrainSamples = static_cast<int>(sampleRate_ * 0.5) + 1;
    config.tier = tier_;
    arena_.assign(grain::GrainEngine::arenaBytes(config, blockSize_) / sizeof(float) + 4, 0.0f);
    engine_.prepare(sampleRate_, blockSize_, config, arena_.data(),
                    arena_.size() * sizeof(float));

    loopDiffuser_.prepare(sampleRate_);
    chain_.prepare(sampleRate_);
    /*
     * A second high-pass, on the way *into* the buffer.
     *
     * §2.2's blocker is in the feedback path and stops DC accumulating around
     * the loop, which it does. It does not stop DC arriving in the first place
     * — and a grain cloud is not unity for DC. Its gain for *coherent* content
     * is `O·mean(w)·A = 0.816·sqrt(O)`, which at the default overlap of 21 is
     * 3.74, so a +0.5 offset at the input leaves the wet output at 1.18 with
     * nothing having accumulated at all. A reverb buffer holding DC is
     * meaningless in any case; this keeps it out.
     */
    inputBlocker_.setCoeffs(dsp::onePoleHighpassCoeffs(20.0, sampleRate_));
    rebuild();
    reset();
  }

  void reset() override {
    inputBlocker_.reset();
    for (float& v : buffer_) v = 0.0f;
    for (float& v : preDelay_) v = 0.0f;
    writeIndex_ = 0;
    preWrite_ = 0;
    loopPeak_ = 0.0f;
    freezeGain_ = 1.0f;
    engine_.reset();
    loopDiffuser_.reset();
    chain_.reset();
  }

  int latencySamples() const override { return 0; }
  const char* name() const override { return "granular-reverb"; }

  void process(const ProcessContext& ctx) override {
    if (dirty_) rebuild();
    const AudioBuffer& in = ctx.inputs[0];
    AudioBuffer& out = ctx.outputs[0];
    const int channels = out.channelCount() < 2 ? out.channelCount() : 2;
    if (bypass_) {
      out.copyFrom(in);
      publish(peakOfBuffer(out), peakOfBuffer(out));
      return;
    }
    const int frames = ctx.frames;

    // The engine reads behind our write head, so the head it is given is the
    // one at the first frame of the block and it advances its own copy.
    grain::GrainSource source;
    source.data = buffer_.data();
    source.capacity = capacity_;
    source.mask = mask_;
    source.writeIndex = writeIndex_;
    source.sampleRate = sampleRate_;
    engine_.process(source, wetL_.data(), wetR_.data(), frames);

    float inputPeak = 0.0f;
    float outputPeak = 0.0f;
    for (int i = 0; i < frames; ++i) {
      float dry = in.channel(0)[i];
      if (channels > 1) dry = 0.5f * (dry + in.channel(1)[i]);
      const float magnitude = dry < 0.0f ? -dry : dry;
      if (magnitude > inputPeak) inputPeak = magnitude;

      // Pre-delay, ahead of the buffer so it delays what recirculates as well
      // as what is heard — a pre-delay only on the dry path would not be one.
      preDelay_[static_cast<std::size_t>(preWrite_)] = dry;
      int readAt = preWrite_ - preDelaySamples_;
      if (readAt < 0) readAt += static_cast<int>(preDelay_.size());
      const float delayed = preDelay_[static_cast<std::size_t>(readAt)];
      if (++preWrite_ >= static_cast<int>(preDelay_.size())) preWrite_ = 0;

      /*
       * **The feedback tap is the wet cloud folded to mono, and the fold costs
       * gain that has to be given back.**
       *
       * The buffer is mono, so the loop has to sum the engine's two channels —
       * and a stereo spread of incoherent grains loses power in that sum. With
       * the pan uniform across the image, each grain contributes
       * `0.5·(cos θ + sin θ)` to the mono sum with θ uniform on [0, π/2], so
       * the mean square of that factor is `0.25·(1 + E[sin 2θ]) = 0.25·(1 +
       * 2/π) = 0.4092` and the fold is 0.6397 in amplitude. Left uncorrected
       * the loop runs at 0.64 of the gain the decay control asked for, and the
       * measured RT60 comes out a third to a half short of the setting —
       * which reads as the §2.2 formula being wrong when it is the fold.
       */
      /*
       * **The diffusion stays inside the loop, and three other placements were
       * measured before that was settled.**
       *
       * §2.3 reads as an instruction to put the chain on the wet bus so every
       * grain's first arrival is diffused. Measured against the loop-only
       * placement's 125 ms on §9 V7, the full-length chain there read 398 ms and
       * a short one 313 ms. `dsp::DiffusionTank` — a recirculating figure-eight
       * that reaches 0.9 echo density in 65 ms *on its own*, where a series
       * chain never reaches it at all — read 247 ms on the wet output and
       * 205 ms diffusing the input to the buffer. Every placement is worse than
       * none, and the tank is the best diffuser of the three by a wide margin.
       *
       * That is not four failures of placement; it is the row's excitation. The
       * impulse response of a grain cloud reading a buffer that holds one
       * impulse is a sparse train of single windowed samples at grain-read
       * times: measured directly it is *silent for eighty milliseconds*, and
       * then the density bounces between 0.18 and 1.02 from one 20 ms window to
       * the next while the RMS swings two orders of magnitude. Nothing
       * downstream can put back arrivals that were never generated, and nothing
       * upstream helps either, because the sparseness is in which grains happen
       * to catch the impulse — the same property of the probe that made V5's
       * impulse measurement worthless one row over.
       *
       * So the loop keeps the chain it was calibrated with, V7 is recorded as
       * not met for the reason above rather than for a diffusion deficiency, and
       * the question that remains — whether it flutters on a transient — is in
       * `docs/HARDWARE_VERIFICATION.md`, where the ear is the instrument.
       */
      const float wet = kMonoFoldCompensation *
                        0.5f *
                        (wetL_[static_cast<std::size_t>(i)] +
                         wetR_[static_cast<std::size_t>(i)]);
      const float diffused = loopDiffuser_.process(wet);
      const float returned = chain_.process(diffused, static_cast<float>(feedback_));
      // The loop signal, which is what §9 V9 grades: the thing that recirculates
      // and therefore the thing that can run away. The wet *output* is taken
      // before the chain and is a level a user trims; this is not.
      const float loopMagnitude = returned < 0.0f ? -returned : returned;
      if (loopMagnitude > loopPeak_) loopPeak_ = loopMagnitude;

      /*
       * **Freeze stops the write head; it does not set the feedback to one.**
       * §2.4 is explicit that only one of the two is safe: at unity the loop is
       * marginally stable, in float it drifts, DC accumulates, and the tone
       * changes over the hold. Stopping the write leaves the buffer bit-exact
       * and holdable indefinitely, which is what V11 measures over ten minutes.
       *
       * The gain crossfades over ten milliseconds so the buffer does not
       * contain a step at the freeze point — a step there clicks once per pass
       * for as long as the tail lasts.
       */
      freezeGain_ += (freezeTarget_ - freezeGain_) * freezeCoeff_;
      if (freezeGain_ > kFrozenThreshold) {
        // **The head stops; it does not write silence.** Writing a faded value
        // and carrying on advancing erases the buffer one lap at a time, which
        // measured as the frozen tone vanishing entirely rather than drifting.
        // The fade is on what is *written* so the buffer has no step at the
        // freeze point; once it has reached zero the head stops and the
        // contents are held exactly.
        const float blocked =
            static_cast<float>(inputBlocker_.process(static_cast<double>(delayed)));
        buffer_[static_cast<std::size_t>(writeIndex_ & mask_)] =
            blocked * freezeGain_ + returned;
        ++writeIndex_;
      }

      // §6: width is mid/side on the wet bus only, so a mono dry stays mono.
      const float mid = 0.5f * (wetL_[static_cast<std::size_t>(i)] +
                                wetR_[static_cast<std::size_t>(i)]);
      const float side = 0.5f *
                         (wetL_[static_cast<std::size_t>(i)] -
                          wetR_[static_cast<std::size_t>(i)]) *
                         static_cast<float>(width_);
      const float wetLeft = mid + side;
      const float wetRight = mid - side;

      const float dryGain = static_cast<float>(1.0 - mix_);
      const float wetGain = static_cast<float>(mix_ * outputTrim_);
      for (int c = 0; c < channels; ++c) {
        const float wetChannel = c == 0 ? wetLeft : wetRight;
        const float sample = in.channel(c)[i] * dryGain + wetChannel * wetGain;
        const float level = sample < 0.0f ? -sample : sample;
        if (level > outputPeak) outputPeak = level;
        out.channel(c)[i] = sample;
      }
    }
    publish(inputPeak, outputPeak);
  }

  // ---- read back ----

  /// §6's overlap readout, and the CPU predictor.
  float overlap() const noexcept { return engine_.overlap(0); }
  float feedback() const noexcept { return static_cast<float>(feedback_); }
  /// Peak of the signal that recirculates, since the last read. Reading clears
  /// it, so a caller measures a window rather than a running maximum.
  float takeLoopPeak() noexcept {
    const float peak = loopPeak_;
    loopPeak_ = 0.0f;
    return peak;
  }
  bool takeGrainFrame(grain::GrainFrame* out) noexcept { return engine_.takeFrame(out); }
  GranularReverbPublisher& visual() noexcept { return visual_; }
  const grain::GrainEngine& engine() const noexcept { return engine_; }

 private:
  static double clamp01(double v) noexcept { return v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v); }
  static double clampRange(double v, double low, double high) noexcept {
    return v < low ? low : (v > high ? high : v);
  }

  static float peakOfBuffer(const AudioBuffer& buffer) noexcept {
    float peak = 0.0f;
    for (int c = 0; c < buffer.channelCount(); ++c) {
      const float* samples = buffer.channel(c);
      for (int i = 0; i < buffer.frames(); ++i) {
        const float magnitude = samples[i] < 0.0f ? -samples[i] : samples[i];
        if (magnitude > peak) peak = magnitude;
      }
    }
    return peak;
  }

  void rebuild() noexcept {
    if (reseed_) {
      // A seed change has to reach the engine, and the engine takes its seed at
      // prepare. Re-preparing into the arena the unit already owns allocates
      // nothing.
      grain::EngineConfig config;
      config.seed = seed_;
      config.tapCount = 1;
      config.poolSlots = 256;
      config.maxGrainSamples = static_cast<int>(sampleRate_ * 0.5) + 1;
      config.tier = tier_;
      engine_.prepare(sampleRate_, blockSize_, config, arena_.data(),
                      arena_.size() * sizeof(float));
      reseed_ = false;
    }
    /*
     * Rounded, not truncated. `0.010 × 48000` is 479.99998 in float and
     * truncating it gives 479 samples — a 0.33 % error that showed up once as
     * ripple at the hop period, which is the kind of defect that reads as a DSP
     * problem and is an arithmetic one.
     */
    const double preDelay =
        preDelayQuarters_ > 0.0 ? preDelayQuarters_ * 60.0 / bpm_ : preDelaySeconds_;
    preDelaySamples_ =
        static_cast<int>(std::min(preDelay, kMaxPreDelaySeconds) * sampleRate_ + 0.5);

    /*
     * §2.2's relation, inverted. A granular loop has no single delay time — it
     * has a distribution of recirculation times, because each grain reads from
     * a random offset — so the mean offset stands in for `t`:
     *
     *     fb = 10^(−3·τ̄ / RT60),   τ̄ = minOffset + size/2
     *
     * The sheet marks this **[I, derived by analogy]** and says in as many
     * words that it is correct in the mean and not exact, and that V5 grades the
     * shipped control against *measured* RT60 rather than against the formula.
     * So this is the starting point a calibration would correct, not the last
     * word — and the row that measures it is written before any correction is.
     */
    meanOffsetSeconds_ = minOffsetSeconds_ + sizeSeconds_ * 0.5;

    const shimmer::Intervals intervals = shimmer::intervalsFor(pitchSet_);
    for (int i = 0; i < intervals.count; ++i) {
      pitchSemitones_[i] = intervals.semitones[i];
      pitchWeights_[i] = intervals.weights[i];
    }
    pitchCount_ = intervals.count;
    /*
     * §3.3, and it is a clamp rather than a warning on purpose.
     *
     * An upward shift in a feedback loop moves energy up on every pass: after
     * `k` passes the band `[f, 2f]` has become `[2^k·f, 2^{k+1}·f]`, energy
     * piles into the top octave, the loop screams and then aliases. A downward
     * shift does the mirror thing into the low end and turns into a rumble.
     * The sheet's remedy is to make the damping track the set and to raise the
     * DC corner with the deepest shift — "both turn an unstable configuration
     * into an impossible one, which is better than a warning label".
     */
    const double ceiling = shimmer::dampingCornerCeiling(intervals, sampleRate_);
    chain_.setDampingFloor(intervals.highest() > 0.0f
                               ? static_cast<float>(chain_.dampingForCorner(ceiling))
                               : 0.0f);
    chain_.setDcCorner(shimmer::blockerCorner(intervals));

    // The engine is configured first, so `overlap()` is the capped number
    // actually in force rather than the one the panel asked for.
    configureEngine();
    // §2.2's relation, calibrated against an interrupted-noise ensemble whose
    // instrument was validated against an analytic reference first.
    // `reverb_decay.h` carries the measurement, the fit and its status.
    feedback_ = decay::calibratedFeedback(meanOffsetSeconds_, decaySeconds_);

    loopDiffuser_.setAmount(static_cast<float>(diffusion_));
    chain_.setDamping(static_cast<float>(damping_));
    chain_.setTilt(static_cast<float>(tiltDb_));
    // Ten milliseconds, §2.4.
    freezeCoeff_ = static_cast<float>(1.0 - std::exp(-1.0 / (0.010 * sampleRate_)));
    dirty_ = false;
  }

  void configureEngine() noexcept {
    grain::ScheduleConfig schedule;
    schedule.grainsPerSecond = static_cast<float>(density_);
    schedule.onsetJitter = static_cast<float>(onsetJitter_);

    grain::SpawnParams spawn;
    spawn.grainSeconds = static_cast<float>(grainSeconds_);
    spawn.lengthJitter = static_cast<float>(lengthJitter_);
    spawn.minOffsetSeconds = static_cast<float>(minOffsetSeconds_);
    spawn.spraySeconds = static_cast<float>(sizeSeconds_);
    spawn.sprayAmount = static_cast<float>(spray_);
    spawn.ampJitter = static_cast<float>(ampJitter_);
    spawn.panSpread = 1.0f;
    // §6: the shape control runs Tukey's alpha from 1 down to 0.1, and alpha
    // of one is Hann exactly — so zero really is Hann rather than nearly Hann.
    spawn.shape = windowShape_ <= 0.0 ? grain::WindowShape::Hann : grain::WindowShape::Tukey;
    spawn.tukeyAlpha = static_cast<float>(1.0 - 0.9 * windowShape_);
    spawn.pitchSpreadCents = static_cast<float>(pitchSpreadCents_);
    spawn.pitchSemitones = pitchSemitones_;
    spawn.pitchWeights = pitchWeights_;
    spawn.pitchCount = pitchCount_;
    engine_.setSpawn(0, spawn);
    engine_.setSchedule(0, schedule);
    engine_.setTier(tier_);
  }

  void publish(float inputPeak, float outputPeak) noexcept {
    GranularReverbFrame frame;
    frame.inputPeak = inputPeak;
    frame.outputPeak = outputPeak;
    frame.overlap = engine_.overlap(0);
    frame.clampedDensity = engine_.clampedDensity(0);
    frame.feedback = static_cast<float>(feedback_);
    frame.liveGrains = static_cast<std::uint16_t>(engine_.liveGrains());
    frame.frozen = freezeTarget_ < 0.5f;
    // The loop applies `fb · |H_damp(ω)|` per pass, so the decay at 8 kHz is
    // §2.2's relation evaluated with that product rather than with `fb` alone.
    const double perPass = feedback_ * chain_.dampingMagnitudeAt(8000.0);
    frame.rt60At8k = static_cast<float>(decay::deliveredRt60(meanOffsetSeconds_, perPass));
    visual_.publish(frame);
  }

  /// See the feedback tap. `1 / 0.6397`, from the pan law rather than fitted.
  static constexpr float kMonoFoldCompensation = 1.5632f;
  /// Below this the freeze fade is finished and the head stops.
  static constexpr float kFrozenThreshold = 1.0e-4f;
  /// Four quarter notes at 60 bpm, which is the longest §6's sync list can ask
  /// for. The millisecond control's own range stays 0–500 ms.
  static constexpr double kMaxPreDelaySeconds = 4.0;

  grain::GrainEngine engine_;
  dsp::Biquad inputBlocker_;
  dsp::Diffuser loopDiffuser_;
  dsp::FeedbackChain chain_;
  GranularReverbPublisher visual_;
  std::vector<float> buffer_;
  std::vector<float> preDelay_;
  std::vector<float> wetL_;
  std::vector<float> wetR_;
  std::vector<float> arena_;

  double sampleRate_ = 48000.0;
  int blockSize_ = 128;
  int capacity_ = 0;
  int mask_ = 0;
  int writeIndex_ = 0;
  int preWrite_ = 0;
  int preDelaySamples_ = 0;

  double mix_ = 0.35;
  double preDelaySeconds_ = 0.020;
  /// Quarter notes; zero means the pre-delay is in milliseconds.
  double preDelayQuarters_ = 0.0;
  double bpm_ = 120.0;
  double sizeSeconds_ = 0.800;
  double minOffsetSeconds_ = 0.020;
  double decaySeconds_ = 3.0;
  double grainSeconds_ = 0.060;
  double density_ = 350.0;
  double spray_ = 0.70;
  double onsetJitter_ = 0.60;
  double lengthJitter_ = 0.25;
  double ampJitter_ = 0.15;
  double windowShape_ = 0.0;
  double pitchSpreadCents_ = 0.0;
  double diffusion_ = 0.60;
  double damping_ = 0.45;
  double tiltDb_ = 0.0;
  double width_ = 1.0;
  double outputTrim_ = 1.0;
  double feedback_ = 0.5;
  double meanOffsetSeconds_ = 0.42;
  float loopPeak_ = 0.0f;
  float freezeGain_ = 1.0f;
  float freezeTarget_ = 1.0f;
  float freezeCoeff_ = 0.002f;
  float pitchSemitones_[8] = {0, 0, 0, 0, 0, 0, 0, 0};
  float pitchWeights_[8] = {1, 0, 0, 0, 0, 0, 0, 0};
  int pitchCount_ = 1;
  shimmer::Set pitchSet_ = shimmer::Set::Unison;
  grain::Tier tier_ = grain::Tier::Studio;
  std::uint64_t seed_ = 0x9E3779B97F4A7C15ull;
  bool reseed_ = false;
  bool bypass_ = false;
  bool dirty_ = true;
};

}  // namespace mw::units
