// Motion Wave — DYN-04, the Variable-Mu Limiter.
//
// The gain element *is* the amplifier. A remote-cutoff pair runs push-pull
// between two transformers and the sidechain moves its grid bias, so the thing
// being distorted and the thing doing the compressing are one component. That
// is why this unit's ratio, knee and distortion cannot be three parameters:
// §5's implementer rule is to model the transconductance law and let all three
// fall out of it, and a ratio control with a knee control beside it reproduces
// none of them at the same time. `RemoteCutoffCell` is that law.
//
// The audio path is deliberately short — §2's implementer rule — two
// transformers and one gain block. Everything else is control path.
#pragma once

#include "../dsp/nonlinear/magnetic_core.h"
#include "../dsp/nonlinear/oversampler.h"
#include "../dsp/nonlinear/specs.h"
#include "../dsp/nonlinear/variable_gain.h"
#include "../dsp/peak_detector.h"
#include "../dsp/timing_network.h"
#include "../dsp/visual_state.h"
#include "../graph/node.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace mw::units {

namespace nl = dsp::nl;

inline constexpr int kVariableMuChannels = 2;

/// What the face draws.
struct VariableMuFrame {
  float inputPeak = 0.0f;
  float outputPeak = 0.0f;
  /// One per channel, because the two channels are independent and in
  /// lateral/vertical mode they are not even the same signal. A face that
  /// showed one number would be hiding the mode's whole point.
  float gainReductionDb[kVariableMuChannels] = {0.0f, 0.0f};
  /// What the slow storage elements are holding, normalised. This is how a face
  /// can show *why* the release is where it is in positions 5 and 6 — the
  /// recovery is not a setting there, it is a state.
  float storage[kVariableMuChannels] = {0.0f, 0.0f};
  /// True when the transformers are matrixing rather than passing through.
  bool lateralVertical = false;
};

using VariableMuPublisher = dsp::FramePublisher<VariableMuFrame>;

class VariableMu : public Node {
 public:
  enum class Mode { LeftRight = 0, LateralVertical = 1 };
  enum class Tier { Off = 0, X2 = 1, X4 = 2, X8 = 3 };

  // ---- configuration, off the audio thread ----
  //
  // **Every one of these is per channel, and that is §3.5's requirement rather
  // than a generalisation.** The stereo unit is two complete channel strips: a
  // user can set a different threshold and a different time constant for the
  // lateral and the vertical path, and the sheet says in as many words that
  // this is the reason the unit is still used on mix buses. A single set of
  // controls driving both channels reproduces the *matrix* correctly and still
  // cannot do the thing the matrix is for.

  /// §3.1: an attenuator, 20 dB of range, and no gain anywhere on it. The panel
  /// reads 20 down to 0 and 0 is no attenuation, so the control is inverted in
  /// the same way the threshold is — it is a *drive* control, and turning it up
  /// drives the tube harder for a given amount of reduction.
  void setInputAttenuationDb(int channel, double db) noexcept {
    if (channel < 0 || channel >= kVariableMuChannels) return;
    const double clamped = db < 0.0 ? 0.0 : (db > 20.0 ? 20.0 : db);
    inputGain_[channel] = std::pow(10.0, -clamped / 20.0);
  }

  /**
   * §3.2, and the sense is backwards on purpose.
   *
   * Ten fully clockwise is *no* compression and zero is maximum. This is the
   * second inverted control in the project after DYN-03's time constants, and
   * §3.2 says exactly why it is called out: it is the kind of detail an
   * emulation silently corrects and then hears about from users who know the
   * hardware.
   */
  void setThreshold(int channel, double position) noexcept {
    if (channel < 0 || channel >= kVariableMuChannels) return;
    threshold_[channel] = position < 0.0 ? 0.0 : (position > 10.0 ? 10.0 : position);
    dirty_ = true;
  }

  /// §3.3, positions 1 to 6. Five and six are programme-dependent; see §4.
  void setTimeConstant(int channel, int position) noexcept {
    if (channel < 0 || channel >= kVariableMuChannels) return;
    timeConstant_[channel] = position < 1 ? 1 : (position > 6 ? 6 : position);
    dirty_ = true;
  }

  /**
   * §3.6: the rear trim that sets the standing grid bias, and with it both the
   * onset and the ratio — published as moving the effective ratio across
   * roughly 2:1 to 30:1.
   *
   * Not a user control on the hardware. It is exposed because without it the
   * unit's ratio range is simply unreachable, and it is secondary rather than
   * primary because that is what it is on the panel.
   */
  void setDcThreshold(int channel, double position) noexcept {
    if (channel < 0 || channel >= kVariableMuChannels) return;
    dcThreshold_[channel] = position < 0.0 ? 0.0 : (position > 1.0 ? 1.0 : position);
    dirty_ = true;
  }

  void setMode(Mode mode) noexcept { mode_ = mode; }
  void setTier(Tier tier) noexcept {
    tier_ = tier;
    dirty_ = true;
  }
  void setNoise(double amplitude) noexcept { noise_ = amplitude; }
  void setBypass(bool bypass) noexcept { bypass_ = bypass; }
  void setVariance(float variance, std::uint32_t seed) noexcept {
    variance_ = variance;
    seed_ = seed;
    dirty_ = true;
  }

  // ---- Node ----

  void prepare(double sampleRate, int blockSize) override {
    sampleRate_ = sampleRate;
    blockSize_ = blockSize > 0 ? blockSize : 128;
    // One frame per call, as DYN-03 does and for the same reason: the sidechain
    // has to see the sample the gain block just produced, because this is a
    // feedback design. The scratch is per channel — a shared oversampler runs
    // the right channel through the left channel's filter history and makes the
    // output depend on the host's block size.
    scratch_.assign(static_cast<std::size_t>(kVariableMuChannels) *
                        nl::oversamplerScratchFloats(8, 1),
                    0.0f);
    rebuild();
    reset();
  }

  void reset() override {
    for (int c = 0; c < kVariableMuChannels; ++c) {
      inputCore_[c].reset();
      outputCore_[c].reset();
      cell_[c].reset();
      timing_[c].reset();
      over2_[c].reset();
      over4_[c].reset();
      over8_[c].reset();
      control_[c] = 0.0;
      reductionDb_[c] = 0.0;
    }
    rng_ = seed_ * 2654435761u + 1u;
  }

  int latencySamples() const override { return latency_; }
  const char* name() const override { return "variable-mu"; }

  void process(const ProcessContext& ctx) override {
    if (dirty_) rebuild();
    const AudioBuffer& in = ctx.inputs[0];
    AudioBuffer& out = ctx.outputs[0];
    const int channels =
        out.channelCount() < kVariableMuChannels ? out.channelCount() : kVariableMuChannels;
    if (bypass_) {
      out.copyFrom(in);
      // Bypass passes the signal through, so the meters carry on reading it.
      const float passed = peakOfBuffer(out);
      publish(passed, passed);
      return;
    }

    const bool matrix = mode_ == Mode::LateralVertical && channels == 2;
    float inputPeak = 0.0f;
    float outputPeak = 0.0f;

    for (int i = 0; i < ctx.frames; ++i) {
      // §3.5: the matrix is formed in the transformer windings, so the encode
      // happens *before* the input transformer's nonlinearity and the decode
      // *after* the output transformer's. Doing it in software either side of
      // the pair would be a different circuit, and §6.1 says so.
      double source[kVariableMuChannels] = {0.0, 0.0};
      for (int c = 0; c < channels; ++c) source[c] = static_cast<double>(in.channel(c)[i]);
      if (matrix) {
        const double m = source[0] + source[1];
        const double s = source[0] - source[1];
        source[0] = m;
        source[1] = s;
      }

      double shaped[kVariableMuChannels] = {0.0, 0.0};
      for (int c = 0; c < channels; ++c) {
        const double driven = source[c] * inputGain_[c];
        const float magnitude = static_cast<float>(driven < 0.0 ? -driven : driven);
        if (magnitude > inputPeak) inputPeak = magnitude;
        float staged = inputCore_[c].process(static_cast<float>(driven));

        auto loop = [&](float v) {
          const float y = cell_[c].process(v, static_cast<float>(control_[c]));
          // §2: the sidechain monitors the OUTPUT. That is what makes the ratio
          // rise with reduction rather than being a number — the control signal
          // shrinks as the gain falls, so the loop settles further along the
          // transconductance curve at every step.
          const double level = static_cast<double>(y < 0.0f ? -y : y);
          control_[c] = timing_[c].process(sidechain(c, level)) * cutoffVolts_;
          reductionDb_[c] = -static_cast<double>(cell_[c].gainDb(static_cast<float>(control_[c])));
          return outputCore_[c].process(y);
        };
        float processed = 0.0f;
        switch (tier_) {
          case Tier::Off: over1_[c].process(&staged, &processed, 1, loop); break;
          case Tier::X2: over2_[c].process(&staged, &processed, 1, loop); break;
          case Tier::X4: over4_[c].process(&staged, &processed, 1, loop); break;
          case Tier::X8: over8_[c].process(&staged, &processed, 1, loop); break;
        }
        shaped[c] = static_cast<double>(processed);
      }

      if (matrix) {
        const double m = shaped[0];
        const double s = shaped[1];
        // §3.5's implementer rule: the ×0.5 goes here, once, on decode, so a
        // null side signal passes the lateral channel at unity.
        shaped[0] = 0.5 * (m + s);
        shaped[1] = 0.5 * (m - s);
      }
      for (int c = 0; c < channels; ++c) {
        const double y = shaped[c] + noise_ * nextNoise();
        const float sample = static_cast<float>(y);
        const float magnitude = sample < 0.0f ? -sample : sample;
        if (magnitude > outputPeak) outputPeak = magnitude;
        out.channel(c)[i] = sample;
      }
    }
    publish(inputPeak, outputPeak);
  }

  // ---- read back ----

  double gainReductionDb(int channel = 0) const noexcept {
    return channel >= 0 && channel < kVariableMuChannels ? reductionDb_[channel] : 0.0;
  }
  double storage(int channel = 0) const noexcept {
    return channel >= 0 && channel < kVariableMuChannels ? timing_[channel].stageValue(1) : 0.0;
  }
  VariableMuPublisher& visual() noexcept { return visual_; }

 private:
  /**
   * The sidechain's own shape, §6.3.
   *
   * A static nonlinearity on the *control* signal rather than on the audio: the
   * sidechain amplifier and rectifier sit inside the loop, so what they distort
   * is the control voltage, and what that changes is the shape of the curve
   * rather than the sound of the signal. Modelled as the sheet directs.
   *
   * The threshold is subtracted in decibels because the control is a rectified
   * level and the panel's effect is a threshold, not a gain.
   */
  double sidechain(int channel, double level) const noexcept {
    if (level <= 1.0e-9) return 0.0;
    const double overDb = 20.0 * std::log10(level) - thresholdDb_[channel];
    if (overDb <= 0.0) return 0.0;
    // **Proportional, with no compression of its own.** A compressive term was
    // tried here and is wrong on this unit specifically: §5's defining property
    // is that the ratio *rises* with reduction, which it does because the
    // transconductance law's slope grows as the pair approaches cutoff — and a
    // sidechain whose gain falls as the control grows cancels exactly that. It
    // measured 1.61:1 at 3 dB of reduction and 1.55:1 at 20, a ratio falling
    // where the sheet's whole §5 says it must rise.
    //
    // Nothing is needed in its place. The control voltage is clamped short of
    // cutoff by the cell itself, which is where the hardware's limit is too.
    return sidechainGain_[channel] * overDb;
  }

  void rebuild() noexcept {
    const double innerRate = sampleRate_ * static_cast<double>(tierFactor(tier_));
    const std::size_t span = nl::oversamplerScratchFloats(8, 1);
    for (int c = 0; c < kVariableMuChannels; ++c) {
      nl::StageScratch slice{scratch_.data() + static_cast<std::size_t>(c) * span, span};
      over1_[c].prepare(sampleRate_, 1, slice);
      over2_[c].prepare(sampleRate_, 1, slice);
      over4_[c].prepare(sampleRate_, 1, slice);
      over8_[c].prepare(sampleRate_, 1, slice);
    }
    switch (tier_) {
      case Tier::Off: latency_ = over1_[0].latencySamples(); break;
      case Tier::X2: latency_ = over2_[0].latencySamples(); break;
      case Tier::X4: latency_ = over4_[0].latencySamples(); break;
      case Tier::X8: latency_ = over8_[0].latencySamples(); break;
    }

    for (int c = 0; c < kVariableMuChannels; ++c) {
      // §3.2: ten is no compression and zero is maximum, so the panel maps to a
      // threshold that *falls* as the number falls. The span is the published
      // pair of operating conditions in §5 — a compressor with the threshold
      // 5 dB below programme level, and a peak limiter with it 10 dB above.
      thresholdDb_[c] = kThresholdAtTen - (10.0 - threshold_[c]) * kThresholdPerStep;
      // §3.6: the trim moves the ratio. In a feedback loop the ratio is 1 + L,
      // so the trim is the loop gain — which is also why it moves the onset at
      // the same time, exactly as the hardware's does.
      sidechainGain_[c] = kSidechainMin + dcThreshold_[c] * (kSidechainMax - kSidechainMin);

      dsp::TimingNetwork::Config timing;
      timing.attackSeconds = attackSecondsFor(timeConstant_[c]) / attackConstants() *
                             (1.0 + loopGain(sidechainGain_[c]));
      configureStorage(timing, timeConstant_[c]);
      timing_[c].prepare(innerRate, timing);
    }

    nl::MagneticCore::Config input;
    nl::MagneticCore::Config output;
    // §6.4: the output transformer is the highest-level element and the
    // dominant contributor to low-frequency thickening, so unlike DYN-03's it
    // has no feedback winding to quieten it.
    output.saturationFlux *= 0.8f;
    nl::RemoteCutoffCell::Config cell;
    cell.cutoffVolts = static_cast<float>(cutoffVolts_);
    cell.lawExponent = static_cast<float>(kLawExponent);
    // §6.2 puts the pair *balanced* at moderate drive and has the second
    // harmonic reappear only as the bias approaches cutoff. The library's own
    // default of 0.5 makes the halves 13 % apart at 3 dB of reduction, where
    // the control has moved only an eighth of the way to cutoff, and the second
    // and third harmonics then measure equal there — a stage that never sounds
    // balanced, on the one row that tells this unit apart from the two
    // single-ended ones. Calibrated against §9's two published harmonic
    // constraints: the third must lead by 6 dB at 3 dB of reduction, and the
    // second must have come back by 6 dB at 20.
    cell.stage.imbalancePerBias = kImbalancePerBias;
    if (variance_ > 0.0f) {
      nl::param::applyPushPullVariance(variance_, seed_, cell.stage, output);
    }
    for (int c = 0; c < kVariableMuChannels; ++c) {
      inputCore_[c].prepare(innerRate, input);
      outputCore_[c].prepare(innerRate, output);
      cell_[c].prepare(innerRate, cell);
    }
    dirty_ = false;
  }

  /// §4's table. Attack is a 10–90 % span; release is a recovery to 1 dB
  /// remaining from 10 dB, which is a factor of ten and so `ln(10)` constants.
  static double attackSecondsFor(int position) noexcept {
    return (position == 1 || position == 2 || position == 6) ? 0.0002 : 0.0004;
  }

  /**
   * How many constants of the *control's* own exponential the published spans
   * are, through the transconductance law.
   *
   * **Not `ln(9)` and not `ln(10)`, and the difference is measurable.** Those
   * are the answers when the quantity being timed is the one decaying, and here
   * it is not: the storage network decays exponentially in control volts, while
   * what a measurement reads is decibels of gain reduction, and the law between
   * them is `R = −20·p·log10(1 − v/Vc)`. Recovering from 10 dB to 1 dB is a
   * factor of 8.20 in volts rather than of ten, so it takes 2.104 constants and
   * not 2.303 — and every one of the four fixed positions came out 8.6 % short
   * of its published figure, by the same 8.6 % each time, which is what a
   * conversion error looks like rather than a tuning one.
   *
   * Computed from the exponent rather than written down, so the two cannot
   * drift apart if the law is ever recalibrated.
   */
  static double recoveryConstants() noexcept {
    return std::log(controlFor(10.0) / controlFor(1.0));
  }

  /// The same for a 10–90 % attack span, measured against a 10 dB final
  /// reduction — which is the condition §9 test 1 states.
  static double attackConstants() noexcept {
    const double whole = controlFor(10.0);
    return std::log((1.0 - controlFor(1.0) / whole) / (1.0 - controlFor(9.0) / whole));
  }

  /// The loop's own gain at `kAttackReferenceDb`, from the closed form above.
  static double loopGain(double sidechainGain) noexcept {
    const double remaining = 1.0 - controlFor(kAttackReferenceDb);
    return 20.0 * kLawExponent * sidechainGain / (2.302585092994046 * remaining);
  }

  /// The control voltage, as a fraction of cutoff, that produces `reductionDb`.
  static double controlFor(double reductionDb) noexcept {
    return 1.0 - std::pow(10.0, -reductionDb / (20.0 * kLawExponent));
  }

  static void configureStorage(dsp::TimingNetwork::Config& timing, int position) noexcept {
    const double fast[6] = {0.3, 0.8, 2.0, 5.0, 2.0, 0.3};
    timing.stages[0].releaseSeconds = fast[position - 1] / recoveryConstants();
    timing.count = 1;
    if (position < 5) return;
    // §4's positions 5 and 6: more than one storage element, and the observed
    // recovery is wherever the charge happens to be rather than a figure the
    // model selects. See `TimingNetwork` for why the elements are a chain.
    timing.stages[1].releaseSeconds = 10.0 / recoveryConstants();
    timing.stages[1].accumulateSeconds = timing.stages[0].releaseSeconds * kAccumulateRatio;
    timing.count = 2;
    if (position < 6) return;
    timing.stages[2].releaseSeconds = 25.0 / recoveryConstants();
    // Scaled to the element it charges *from*, not to the fast branch. Position
    // 6's slow element sat on the same short path as its medium one, so a five
    // second burst train filled both and the repeated-peaks recovery came out
    // at 14.2 s against a published 10 — the 25 s element answering a question
    // that belongs to the 10 s one.
    timing.stages[2].accumulateSeconds = timing.stages[1].releaseSeconds * kAccumulateRatio;
    timing.count = 3;
  }

  /**
   * The loudest sample in a buffer, for the bypass path.
   *
   * **A bypassed unit still passes audio, so its meters must still read.**
   * Publishing zeros there makes a face show silence for a unit the user can
   * hear, which is the one thing a meter must never do — and it looked correct
   * in every native row, because bypass is not what those measure. Ledger cell
   * X24 caught it: four of the five units did this and the Motion Shaper, which
   * had an integration test, did not.
   */
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

  void publish(float inputPeak, float outputPeak) noexcept {
    VariableMuFrame frame;
    frame.inputPeak = inputPeak;
    frame.outputPeak = outputPeak;
    for (int c = 0; c < kVariableMuChannels; ++c) {
      frame.gainReductionDb[c] = static_cast<float>(reductionDb_[c]);
      // What the network is holding, not what its second element holds.
      //
      // This read `stageValue(1)`, and the second storage element only exists
      // at time-constant positions 5 and 6 — `configureStorage` sets
      // `timing.count = 1` for the other four. So at four of the six settings,
      // including the default, the panel's storage meter published a slot the
      // model never writes and read zero while the unit compressed 15.9 dB. A
      // dead meter on a working unit is the failure X24 exists for, arriving
      // through a field that names a stage rather than the state.
      //
      // `value()` is the highest across the elements that are in circuit, which
      // is what the attenuator is actually handed and therefore the storage the
      // recovery comes out of. It is live at every position, and at positions 5
      // and 6 it is still the multi-element behaviour — the elements are a
      // chain and the observed recovery is wherever the charge happens to be.
      frame.storage[c] = static_cast<float>(timing_[c].value());
    }
    frame.lateralVertical = mode_ == Mode::LateralVertical;
    visual_.publish(frame);
  }

  double nextNoise() noexcept {
    rng_ = rng_ * 1664525u + 1013904223u;
    return static_cast<double>(rng_ >> 8) / 8388608.0 - 1.0;
  }

  static int tierFactor(Tier tier) noexcept {
    switch (tier) {
      case Tier::Off: return 1;
      case Tier::X2: return 2;
      case Tier::X4: return 4;
      case Tier::X8: return 8;
    }
    return 1;
  }

  /// Threshold in dBFS at the panel's 10, and how far each of the ten steps
  /// moves it. §5's two published operating points are a compressor 5 dB below
  /// programme level and a limiter 10 dB above it; taking programme level as
  /// −18 dBFS puts the span from −8 to −48 across the control's travel.
  static constexpr double kThresholdAtTen = -8.0;
  static constexpr double kThresholdPerStep = 4.0;
  /**
   * The sidechain gain at the two ends of the DC threshold trim, derived from
   * the published ratio range rather than chosen.
   *
   * A feedback compressor's local ratio is `1 + L`, and this loop's gain has a
   * closed form: the sidechain contributes `k` decibels of control per decibel
   * over threshold, and the transconductance law contributes
   * `20·p / (ln10 · (1 − v/Vc))` decibels of reduction per volt, so
   *
   *     L = 20·p·k / (ln10 · (1 − v/Vc)) .
   *
   * §3.6 publishes the trim as moving the effective ratio across roughly 2:1 to
   * 30:1. Evaluating at 10 dB of reduction, where `1 − v/Vc` is 0.631, gives
   * k = 0.029 for a ratio of two and k = 0.843 for thirty.
   *
   * The formula was checked before it was used: at the values this replaces it
   * predicted 1.570:1 and the render measured 1.57:1.
   */
  static constexpr double kSidechainMin = 0.0291;
  static constexpr double kSidechainMax = 0.843;
  /// How much faster a storage element charges than it discharges. §4 rule 3
  /// requires charging to outrun discharge or repeated peaks never accumulate;
  /// a diode-isolated capacitor charges through a much lower resistance than it
  /// drains through, which is what this is.
  /**
   * The charge path's constant, as a multiple of the *fast* branch's.
   *
   * Not of the storage element's own release, which is what this was, and the
   * difference is what makes both switch positions work from one number. What
   * decides how much charge a burst delivers is how the charge path compares
   * with the rate the fast node is draining at — so a position whose fast
   * branch dumps its charge in 0.14 s needs a proportionally quicker path than
   * one that takes 0.95 s, or the storage element never fills. Scaling off the
   * storage element's own constant instead served position 5 and left position
   * 6's repeated-peaks recovery at about a second against a published ten.
   *
   * Nine, calibrated against §4's published pairs in both programme-dependent
   * positions rather than fitted to any one of them, and the window is narrow.
   * A single 50 ms burst has to leave the storage element near or below the
   * 1 dB the recovery is measured to, or the isolated-peak figure stops being
   * the fast branch's at all; ten bursts have to fill it. The charge a single
   * burst delivers is the fast node's own integral, 0.4245 × τ0 / τa, which
   * sets the first condition; the second is what ten of them can accumulate
   * against the storage element's own leak. Measured across the four published
   * figures: at ten the position 5 train recovers in 5.91 s against a floor of
   * 6, at seven position 6's isolated peak stretches to 0.91 s against a
   * ceiling of 0.42, and at nine all four land — 2.00 and 6.19 s in position 5,
   * 0.30, 6.42 and 22.92 s in position 6.
   *
   * Note that the charge path is *slower* in seconds than the storage
   * element's discharge, and §4 rule 3 still holds: during a train of peaks the
   * fast node is elevated most of the time, so the charge arriving outruns the
   * leak and the recovery lengthens. The rule is about the net over a train,
   * not about the two constants.
   */
  static constexpr double kAccumulateRatio = 9.0;
  /**
   * The reduction §9 test 1 states its attack figures at, which is where the
   * loop gain is evaluated.
   *
   * A proportional feedback loop responds in `1/(1+L)` of the constant it is
   * built from, so the detector has to be slower than the span it produces by
   * that factor — and L is not a nominal number here, it moves with the trim
   * and with how deep the reduction is. Evaluating it at a nominal setting
   * would make the attack right at one trim position and wrong at the others.
   */
  static constexpr double kAttackReferenceDb = 10.0;
  /// See `rebuild`. Ours; `LEGAL_NOTES.md` records the class of number this is,
  /// because no published measurement of the reference unit's push-pull balance
  /// exists.
  static constexpr float kImbalancePerBias = 0.15f;
  /// The transconductance law's exponent, mirrored here because the time
  /// conversions above are derived from it. `RemoteCutoffCell` owns the value.
  static constexpr double kLawExponent = 2.5;

  nl::MagneticCore inputCore_[kVariableMuChannels];
  nl::MagneticCore outputCore_[kVariableMuChannels];
  nl::RemoteCutoffCell cell_[kVariableMuChannels];
  dsp::TimingNetwork timing_[kVariableMuChannels];
  nl::Oversampler<1> over1_[kVariableMuChannels];
  nl::Oversampler<2> over2_[kVariableMuChannels];
  nl::Oversampler<4> over4_[kVariableMuChannels];
  nl::Oversampler<8> over8_[kVariableMuChannels];
  std::vector<float> scratch_;
  VariableMuPublisher visual_;

  double sampleRate_ = 48000.0;
  int blockSize_ = 128;
  int latency_ = 0;
  double inputGain_[kVariableMuChannels] = {1.0, 1.0};
  double threshold_[kVariableMuChannels] = {10.0, 10.0};
  double dcThreshold_[kVariableMuChannels] = {0.5, 0.5};
  double thresholdDb_[kVariableMuChannels] = {-8.0, -8.0};
  double sidechainGain_[kVariableMuChannels] = {0.02, 0.02};
  double cutoffVolts_ = 1.0;
  double control_[kVariableMuChannels] = {0.0, 0.0};
  double reductionDb_[kVariableMuChannels] = {0.0, 0.0};
  /// §8: noise 70 dB below +4 dBm, which §7 calls the noisiest of the five
  /// units and audibly so. Aligning +4 dBm to −18 dBFS as everything else in
  /// this project does puts the floor at −88 dBFS rms; the generator is uniform
  /// on [−1, 1), so the amplitude is that over root three.
  double noise_ = 6.9e-5;
  int timeConstant_[kVariableMuChannels] = {4, 4};
  Mode mode_ = Mode::LeftRight;
  Tier tier_ = Tier::X4;
  bool bypass_ = false;
  bool dirty_ = true;
  float variance_ = 0.0f;
  std::uint32_t seed_ = 1u;
  std::uint32_t rng_ = 1u;
};

}  // namespace mw::units
