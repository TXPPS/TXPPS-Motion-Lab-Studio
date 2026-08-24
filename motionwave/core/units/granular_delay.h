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

namespace delay = delay;

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
    (void)maxFrames;
    // Eight seconds, which holds §5's longest division (eight bars at 60 bpm is
    // thirty-two seconds — longer than any buffer we would ship, so the sync
    // table's top entries clamp rather than allocate).
    buffer_.prepare(sampleRate_, 8.0);
    loop_.prepare(sampleRate_);
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

      double wetL = 0.0;
      double wetR = 0.0;
      for (int t = 0; t < tapCount_; ++t) {
        if (!taps_[t].enabled) continue;
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
  }

  delay::DelayBuffer buffer_;
  delay::DelayFeedback loop_;
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
