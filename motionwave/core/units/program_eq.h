// Motion Wave — Program EQ.
//
// `dyn-01`. A two-band passive equaliser followed by a valve amplifier that
// exists only to give back the network's insertion loss, between two 600 Ω
// transformers. The manual calls the result a no-loss, no-gain unit, and that
// architecture is the single most important fact about it: the tone-shaping
// element is lossy, reactive and entirely passive, and most of what people
// attribute to "the EQ" comes from the amplifier and the transformers, which
// are in circuit at all times.
//
// **The rule that shapes this file, §2:** the EQ IN/OUT switch removes the
// passive network and nothing else. A model that went clean in EQ OUT has
// wrongly bypassed the amplifier, and test 2 of §9 exists to catch exactly
// that — it asserts the two states differ by less than 0.2 dB in level *and*
// by less than 10 % in distortion.
//
// Where the nonlinearity is, §6, and where it is therefore oversampled:
//
//   input transformer  -> host rate. Its distortion goes as 1/f — a 15 kHz
//                         probe puts the flux at a five-hundredth of the
//                         reference, where the core is linear to the arithmetic
//                         floor — so oversampling it would cost a wrapper's
//                         latency to band-limit harmonics it does not make.
//   passive network    -> host rate, and it must be: oversampling a linear
//                         filter moves its coefficients, and this unit is
//                         graded on flatness to a fraction of a decibel.
//   valve + output     -> oversampled. The 12AX7's second harmonic of a 15 kHz
//       transformer       tone lands at 30 kHz and folds to 18 kHz, which is
//                         audible and is what test 13 measures.
#pragma once

#include "../dsp/nonlinear/magnetic_core.h"
#include "../dsp/nonlinear/oversampler.h"
#include "../dsp/nonlinear/specs.h"
#include "../dsp/nonlinear/triode_stage.h"
#include "../dsp/visual_state.h"
#include "../graph/node.h"
#include "passive_eq.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace mw::units {

/// The nonlinear library, which lives under `mw::dsp`. Aliased rather than
/// pulled in with a using-directive so that every element below still says
/// where it comes from — five of the fourteen units share these types, and a
/// bare `TriodeStage` would read as this unit's own.
namespace nl = dsp::nl;

inline constexpr int kProgramEqChannels = 2;

/// What the face draws. Two levels and the amplifier's harmonic profile, which
/// comes from the same `curvature()` the audio's shaping does — never a second
/// evaluation.
struct ProgramEqFrame {
  float inputPeak = 0.0f;
  float outputPeak = 0.0f;
  /// Second- and third-order coefficients of the make-up amplifier, right now.
  float c2 = 0.0f;
  float c3 = 0.0f;
  /// How hard each transformer is being driven, so a face can show the
  /// low-frequency thickening happening rather than implying it.
  float inputCoreDrive = 0.0f;
  float outputCoreDrive = 0.0f;
};

using ProgramEqPublisher = dsp::FramePublisher<ProgramEqFrame>;

/**
 * The unit.
 *
 * The oversampling factor is a compile-time template parameter on the wrapper,
 * so the four tiers are four members and the live one is chosen per block. That
 * costs the space of four filter states and buys an inlined inner loop; a
 * virtual dispatch per sample at 8× would be eight indirect calls the compiler
 * cannot see through.
 */
class ProgramEq : public Node {
 public:
  /// Oversampling tiers, matching the library's declared latencies.
  enum class Tier { Off = 0, X2 = 1, X4 = 2, X8 = 3 };

  // ---- configuration, off the audio thread ----

  void setEq(const PassiveEqSettings& settings) noexcept {
    for (int c = 0; c < kProgramEqChannels; ++c) eq_[c].setSettings(settings);
  }
  /// EQ IN/OUT. Removes the passive network only — never the amplifier.
  void setEqIn(bool in) noexcept { eqIn_ = in; }
  /// Trim into the amplifier, linear. Every EQ control also changes this, which
  /// §3.10 says is not a bug to be normalised away.
  void setInputGain(double gain) noexcept { inputGain_ = gain; }
  void setOutputGain(double gain) noexcept { outputGain_ = gain; }
  void setTier(Tier tier) noexcept {
    if (tier != tier_) {
      tier_ = tier;
      dirty_ = true;
    }
  }
  /// Per-instance deviation, one scalar. See `nl::param::applyVariance`.
  void setVariance(float variance, std::uint32_t seed) noexcept {
    variance_ = variance;
    seed_ = seed;
    dirty_ = true;
  }
  /**
   * Noise, as a linear amplitude.
   *
   * The manual gives 92 dB below +10 dBm, and +10 dBm is −12 dBFS through the
   * library's full-scale reference, so the default is −104 dBFS. It is a real
   * part of the unit rather than a garnish: a model with a silent noise floor
   * claims a signal-to-noise ratio the hardware does not have. Deterministic,
   * because a bounce and its playback have to be the same audio.
   */
  void setNoise(double amplitude) noexcept { noise_ = amplitude; }
  void setBypass(bool bypass) noexcept { bypass_ = bypass; }

  // ---- Node ----

  void prepare(double sampleRate, int blockSize) override {
    sampleRate_ = sampleRate;
    blockSize_ = blockSize > 0 ? blockSize : 128;
    scratch_.assign(nl::oversamplerScratchFloats(8, blockSize_), 0.0f);
    work_.assign(static_cast<std::size_t>(blockSize_), 0.0f);
    for (int c = 0; c < kProgramEqChannels; ++c) {
      eq_[c].prepare(sampleRate);
      // §6.1 and §6.4: the same mechanisms in both transformers, but the output
      // one works at the highest level and is where most of the audible
      // low-frequency thickening happens. The input core is set gentler — not
      // because a smaller part was fitted, but because it sees a smaller
      // signal, and a model that drove them identically would put the
      // thickening in the wrong half of the unit.
      nl::MagneticCore::Config input;
      input.saturationFlux *= 2.2f;
      inputCore_[c].prepare(sampleRate, input);
    }
    rebuild();
    reset();
  }

  void reset() override {
    for (int c = 0; c < kProgramEqChannels; ++c) {
      eq_[c].reset();
      inputCore_[c].reset();
      outputCore_[c].reset();
      voltage_[c].reset();
      driver_[c].reset();
    }
    over2_.reset();
    over4_.reset();
    over8_.reset();
    // Re-seeded rather than left running, so two renders of the same bars carry
    // the same noise. A hiss that differed between a bounce and its playback
    // would make every null test in a session unrepeatable.
    rng_ = seed_ * 2654435761u + 1u;
  }

  int latencySamples() const override { return latency_; }
  const char* name() const override { return "program-eq"; }

  void process(const ProcessContext& ctx) override {
    if (dirty_) rebuild();
    const AudioBuffer& in = ctx.inputs[0];
    AudioBuffer& out = ctx.outputs[0];
    const int channels =
        out.channelCount() < kProgramEqChannels ? out.channelCount() : kProgramEqChannels;
    if (bypass_) {
      out.copyFrom(in);
      publish(0.0f, 0.0f);
      return;
    }

    float inputPeak = 0.0f;
    float outputPeak = 0.0f;
    for (int c = 0; c < channels; ++c) {
      const float* source = in.channel(c);
      float* destination = out.channel(c);
      for (int i = 0; i < ctx.frames; ++i) {
        const double x = static_cast<double>(source[i]);
        const float ax = static_cast<float>(x < 0.0 ? -x : x);
        if (ax > inputPeak) inputPeak = ax;
        // The input transformer, then the network, then the trim. In that order
        // because that is the circuit: the transformer sees the source rather
        // than the equalised signal, and swapping them would put the
        // low-frequency distortion after the low-frequency boost that causes it.
        double y = static_cast<double>(inputCore_[c].process(static_cast<float>(x)));
        if (eqIn_) y = eq_[c].process(y);
        work_[static_cast<std::size_t>(i)] = static_cast<float>(y * inputGain_);
      }
      // One oversampled block holding both valve stages and the output
      // transformer, because they are what generates harmonics near the band
      // edge.
      auto shaper = [&](float v) {
        const float amplified = driver_[c].process(voltage_[c].process(v));
        return outputCore_[c].process(amplified);
      };
      switch (tier_) {
        case Tier::Off:
          over1_.process(work_.data(), work_.data(), ctx.frames, shaper);
          break;
        case Tier::X2:
          over2_.process(work_.data(), work_.data(), ctx.frames, shaper);
          break;
        case Tier::X4:
          over4_.process(work_.data(), work_.data(), ctx.frames, shaper);
          break;
        case Tier::X8:
          over8_.process(work_.data(), work_.data(), ctx.frames, shaper);
          break;
      }
      for (int i = 0; i < ctx.frames; ++i) {
        double y = static_cast<double>(work_[static_cast<std::size_t>(i)]) * outputGain_;
        y += noise_ * nextNoise();
        const float sample = static_cast<float>(y);
        const float ay = sample < 0.0f ? -sample : sample;
        if (ay > outputPeak) outputPeak = ay;
        destination[i] = sample;
      }
    }
    publish(inputPeak, outputPeak);
  }

  const ProgramEqPublisher& visual() const noexcept { return visual_; }
  const PassiveEq& band(int channel) const noexcept { return eq_[channel]; }

  /**
   * Read-back for the generated parameter dispatch, and nothing else.
   *
   * The unit's own API takes the network's settings as one struct, because the
   * eight controls are one network and three of them are selectors two others
   * share. A parameter, though, is one control moving one value, so the
   * generated dispatch reads the current settings back and writes one field —
   * rather than keeping its own copy, which would be exactly the second opinion
   * the manifest exists to make impossible.
   */
  PassiveEqSettings eqSettings() const noexcept { return eq_[0].settings(); }
  bool eqIn() const noexcept { return eqIn_; }

 private:
  void rebuild() noexcept {
    nl::StageScratch slice{scratch_.data(), scratch_.size()};
    // Every tier is prepared, not only the live one. A tier change is a
    // parameter change and must not allocate or fail on the audio thread, and a
    // wrapper prepared lazily would run its filter design inside `process` the
    // first time somebody turned the knob.
    over1_.prepare(sampleRate_, blockSize_, slice);
    over2_.prepare(sampleRate_, blockSize_, slice);
    over4_.prepare(sampleRate_, blockSize_, slice);
    over8_.prepare(sampleRate_, blockSize_, slice);
    switch (tier_) {
      case Tier::Off: latency_ = over1_.latencySamples(); break;
      case Tier::X2: latency_ = over2_.latencySamples(); break;
      case Tier::X4: latency_ = over4_.latencySamples(); break;
      case Tier::X8: latency_ = over8_.latencySamples(); break;
    }

    // §6.3: a 12AX7 voltage amplifier followed by a 12AU7 driver. The sheet
    // records an unresolved conflict about whether the output stage is
    // push-pull and takes the conservative answer — second-harmonic dominant at
    // moderate drive with the third emerging near clipping — because that is
    // what every listening description reports and because the input stage is
    // unambiguously a single-ended small-signal triode. Both stages are
    // single-ended here, and the choice is flagged for measurement rather than
    // settled.
    nl::TriodeStage::Config voltage;  // the anchor of lib-nonlinear §4.1
    nl::TriodeStage::Config driver;
    // The driver runs at a lower gain and a shallower operating point: it is
    // there to drive a transformer, not to add colour, and giving it the
    // voltage stage's curvature would roughly double the unit's second harmonic
    // and miss the published 0.15 %.
    driver.drive = 0.12f;
    driver.bias = 0.020f;
    // 2 Hz, not the library's 5 Hz default. The manual specifies the amplifier
    // section alone as flat from 20 Hz to 20 kHz within ±0.5 dB, so its own
    // low-frequency corner has to sit far below 20 Hz — and two cascaded
    // restorations at 5 Hz cost 1.9 dB at 10 Hz, which swallowed the bottom of
    // the low shelf and made the published +13.5 dB unreachable at the 20 and
    // 30 Hz selector settings. The restoration exists to stop a biased stage's
    // offset walking into the next one, and 2 Hz does that just as well.
    voltage.restoreHz = 2.0f;
    driver.restoreHz = 2.0f;
    nl::MagneticCore::Config outputCore;
    if (variance_ > 0.0f) nl::param::applyVariance(variance_, seed_, voltage, outputCore);
    // **At the oversampled rate, not the host rate.** Everything inside the
    // wrapper is called `kFactor` times per host sample, so a filter prepared
    // at the host rate has its corner multiplied by the factor. Both valve
    // stages carry a 5 Hz DC-restoration high-pass and the output transformer a
    // 12 Hz magnetising pole; prepared at 48 kHz and run at 4× they sat at
    // 20 Hz and 48 Hz, and the unit measured 6.0 dB down at 20 Hz with every
    // control at zero. The response tests found it, and nothing else would
    // have: at 1 kHz the error is 0.007 dB.
    const double innerRate = sampleRate_ * static_cast<double>(tierFactor(tier_));
    for (int c = 0; c < kProgramEqChannels; ++c) {
      voltage_[c].prepare(innerRate, voltage);
      driver_[c].prepare(innerRate, driver);
      outputCore_[c].prepare(innerRate, outputCore);
    }
    curvature_ = voltage_[0].curvature();
    dirty_ = false;
  }

  /// Samples per host sample inside the wrapper, for the tier in force.
  static int tierFactor(Tier tier) noexcept {
    switch (tier) {
      case Tier::Off: return 1;
      case Tier::X2: return 2;
      case Tier::X4: return 4;
      case Tier::X8: return 8;
    }
    return 1;
  }

  /// A deterministic white source. Not a generator with statistical claims — it
  /// needs to be the same numbers every render, which is a property a better
  /// generator would not add.
  double nextNoise() noexcept {
    rng_ = rng_ * 1664525u + 1013904223u;
    return static_cast<double>(rng_ >> 8) / 8388608.0 - 1.0;
  }

  void publish(float inputPeak, float outputPeak) noexcept {
    ProgramEqFrame frame;
    frame.inputPeak = inputPeak;
    frame.outputPeak = outputPeak;
    frame.c2 = curvature_.c2;
    frame.c3 = curvature_.c3;
    frame.inputCoreDrive = inputPeak;
    frame.outputCoreDrive = outputPeak;
    visual_.publish(frame);
  }

  PassiveEq eq_[kProgramEqChannels];
  nl::MagneticCore inputCore_[kProgramEqChannels];
  nl::MagneticCore outputCore_[kProgramEqChannels];
  nl::TriodeStage voltage_[kProgramEqChannels];
  nl::TriodeStage driver_[kProgramEqChannels];
  nl::Oversampler<1> over1_;
  nl::Oversampler<2> over2_;
  nl::Oversampler<4> over4_;
  nl::Oversampler<8> over8_;
  ProgramEqPublisher visual_;
  nl::Curvature curvature_{};

  std::vector<float> scratch_;
  std::vector<float> work_;
  double sampleRate_ = 48000.0;
  double inputGain_ = 1.0;
  double outputGain_ = 1.0;
  /**
   * −104 dBFS **rms**: 92 dB below the +10 dBm reference, which is −12 dBFS.
   *
   * The amplitude is √3 times that, because the source below is uniform over
   * ±1 and a uniform distribution's rms is its amplitude over √3. Setting the
   * amplitude to the rms figure directly reads 4.8 dB quieter than the manual
   * — a signal-to-noise ratio nobody measured and the model would be claiming.
   */
  double noise_ = 1.09e-5;
  float variance_ = 0.0f;
  std::uint32_t seed_ = 1u;
  std::uint32_t rng_ = 1u;
  int blockSize_ = 128;
  int latency_ = 0;
  Tier tier_ = Tier::X4;
  bool eqIn_ = true;
  bool bypass_ = false;
  bool dirty_ = true;
};

}  // namespace mw::units
