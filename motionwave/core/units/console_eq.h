// Motion Wave — DYN-05, the Console EQ family.
//
// Two lineages in one device, and they do not share a filter engine. §8's
// one-sentence version: the British unit's character is in the inductors and
// the Class A stages, the American unit's is in the proportional-Q law and the
// step-up output transformer. §10 test 19 asserts the two produce measurably
// different curves for nominally equivalent settings, so a shared engine fails
// by construction rather than by degree — which is why `inductor_section.h` and
// `bridged_t.h` are separate files with nothing in common but a biquad.
//
// The other rule that shapes this file is §3.6 and §4.5: the EQ-in switch
// removes the *networks*, never the amplifiers or the transformers. A bypass
// that took the colour with it would be the one thing users of both units say
// they buy them for.
#pragma once

#include "../dsp/bridged_t.h"
#include "../dsp/inductor_section.h"
#include "../dsp/nonlinear/magnetic_core.h"
#include "../dsp/nonlinear/oversampler.h"
#include "../dsp/nonlinear/specs.h"
#include "../dsp/nonlinear/triode_stage.h"
#include "../dsp/visual_state.h"
#include "../graph/node.h"
#include "console_eq_voicing.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace mw::units {

namespace nl = dsp::nl;

inline constexpr int kConsoleChannels = 2;

/// What the face draws.
struct ConsoleEqFrame {
  float inputPeak = 0.0f;
  float outputPeak = 0.0f;
  /// Which engine is in circuit. A face that showed one set of controls for
  /// both would be describing a device that does not exist.
  bool american = false;
  /// The mid band's working Q, which on the British lineage moves with both the
  /// selected frequency and the amount — so a face cannot draw the curve from
  /// the panel positions alone.
  float midQ = 0.0f;
  /// The American bands' working bandwidth in octaves, which is set by the
  /// amount and by nothing else.
  float bandwidthOctaves[3] = {0.0f, 0.0f, 0.0f};
};

using ConsoleEqPublisher = dsp::FramePublisher<ConsoleEqFrame>;

class ConsoleEq : public Node {
 public:
  enum class Lineage { British = 0, American = 1 };
  enum class Tier { Off = 0, X2 = 1, X4 = 2, X8 = 3 };
  enum class Shape { Peak = 0, Shelf = 1 };

  // ---- configuration, off the audio thread ----

  void setLineage(Lineage lineage) noexcept {
    lineage_ = lineage;
    dirty_ = true;
  }
  void setEqIn(bool in) noexcept { eqIn_ = in; }

  /// §3.1: +20 to +80 dB in 5 dB steps. Defaulted to unity-equivalent and
  /// treated as a drive control, because it is the principal way a user reaches
  /// the amplifier's nonlinearity.
  void setDriveDb(double db) noexcept { drive_ = std::pow(10.0, db / 20.0); }
  void setOutputDb(double db) noexcept { output_ = std::pow(10.0, db / 20.0); }

  // British lineage. Frequencies are detent indices; the tables are §3.
  void setBritishLow(int frequencyIndex, double amountDb) noexcept {
    britishLowIndex_ = clampIndex(frequencyIndex, voicing::kBritishLowCount);
    britishLowDb_ = clampAmount(amountDb, 16.0);
    dirty_ = true;
  }
  void setBritishMid(int frequencyIndex, double amountDb) noexcept {
    britishMidIndex_ = clampIndex(frequencyIndex, voicing::kBritishMidCount);
    britishMidDb_ = clampAmount(amountDb, 18.0);
    dirty_ = true;
  }
  void setBritishHigh(double amountDb) noexcept {
    britishHighDb_ = clampAmount(amountDb, 16.0);
    dirty_ = true;
  }
  /// Index 0 is out; 1 to 4 are 50, 80, 160 and 300 Hz.
  void setHighPass(int index) noexcept {
    highPassIndex_ = clampIndex(index, voicing::kHighPassCount);
    dirty_ = true;
  }

  // American lineage.
  void setAmericanBand(int band, int frequencyIndex, double amountDb, Shape shape) noexcept {
    if (band < 0 || band >= 3) return;
    americanIndex_[band] = clampIndex(frequencyIndex, voicing::kAmericanCount);
    americanDb_[band] = clampAmount(amountDb, 12.0);
    // §4.3: only bands 1 and 3 switch shape, and band 2 is peak only. Silently
    // accepting a shelf on band 2 would make a control that does nothing, which
    // is the same class of bug as a wrong number.
    americanShape_[band] = band == 1 ? Shape::Peak : shape;
    dirty_ = true;
  }
  void setBandPass(bool enabled) noexcept { bandPassEnabled_ = enabled; }

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
    scratch_.assign(static_cast<std::size_t>(kConsoleChannels) *
                        nl::oversamplerScratchFloats(8, 1),
                    0.0f);
    rebuild();
    reset();
  }

  void reset() override {
    for (int c = 0; c < kConsoleChannels; ++c) {
      inputCore_[c].reset();
      outputCore_[c].reset();
      eqCore_[c].reset();
      stageA_[c].reset();
      stageB_[c].reset();
      highPass_[c].reset();
      britishLow_[c].reset();
      britishMid_[c].reset();
      britishHigh_[c].reset();
      bandPass_[c].reset();
      for (int b = 0; b < 3; ++b) american_[c][b].reset();
      over2_[c].reset();
      over4_[c].reset();
      over8_[c].reset();
    }
    rng_ = seed_ * 2654435761u + 1u;
  }

  int latencySamples() const override { return latency_; }
  const char* name() const override { return "console-eq"; }

  void process(const ProcessContext& ctx) override {
    if (dirty_) rebuild();
    const AudioBuffer& in = ctx.inputs[0];
    AudioBuffer& out = ctx.outputs[0];
    const int channels =
        out.channelCount() < kConsoleChannels ? out.channelCount() : kConsoleChannels;
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
        const double x = static_cast<double>(source[i]) * drive_;
        const float magnitude = static_cast<float>(x < 0.0 ? -x : x);
        if (magnitude > inputPeak) inputPeak = magnitude;
        float staged = static_cast<float>(x);

        auto shaper = [&](float v) { return shape(c, v); };
        float processed = 0.0f;
        switch (tier_) {
          case Tier::Off: over1_[c].process(&staged, &processed, 1, shaper); break;
          case Tier::X2: over2_[c].process(&staged, &processed, 1, shaper); break;
          case Tier::X4: over4_[c].process(&staged, &processed, 1, shaper); break;
          case Tier::X8: over8_[c].process(&staged, &processed, 1, shaper); break;
        }

        const double y = static_cast<double>(processed) * output_ + noise_ * nextNoise();
        const float sample = static_cast<float>(y);
        const float level = sample < 0.0f ? -sample : sample;
        if (level > outputPeak) outputPeak = level;
        destination[i] = sample;
      }
    }
    publish(inputPeak, outputPeak);
  }

  ConsoleEqPublisher& visual() noexcept { return visual_; }
  double midQ() const noexcept { return britishMid_[0].q(); }
  double bandwidthOctaves(int band) const noexcept {
    return band >= 0 && band < 3 ? american_[0][band].bandwidthOctaves() : 0.0;
  }

  /**
   * The EQ curve the unit is running, in decibels.
   *
   * Cascaded from the *same section objects* the audio passes through, and
   * their magnitudes come from their own coefficients — so a drawn curve and a
   * measured render cannot disagree about the filter. That is the house rule,
   * and it is what lets the rows that measure bandwidth and band maxima read
   * this instead of sweeping a tone across a nonlinear path, where the
   * amplifiers' own gain would be part of every number.
   *
   * The amplifiers and transformers are deliberately *not* in it. They are not
   * part of the EQ curve, they are what the EQ curve is drawn through, and
   * including them would make a flat-EQ reading non-zero for reasons that have
   * nothing to do with the controls.
   */
  double eqMagnitudeDbAt(double frequency) const noexcept {
    double magnitude = 1.0;
    if (lineage_ == Lineage::American) {
      if (eqIn_) {
        for (int b = 0; b < 3; ++b) magnitude *= american_[0][b].magnitudeAt(frequency);
      }
      magnitude *= bandPass_[0].magnitudeAt(frequency);
    } else {
      if (eqIn_) {
        magnitude *= britishLow_[0].magnitudeAt(frequency);
        magnitude *= britishMid_[0].magnitudeAt(frequency);
        magnitude *= britishHigh_[0].magnitudeAt(frequency);
      }
      magnitude *= highPass_[0].magnitudeAt(frequency);
    }
    return 20.0 * std::log10(magnitude > 1.0e-12 ? magnitude : 1.0e-12);
  }

 private:
  /// One sample through whichever lineage is in circuit.
  float shape(int c, float v) noexcept {
    if (lineage_ == Lineage::American) {
      // §7.2: two op-amp modules and a 1:3 output transformer, and *no*
      // inductors — so nothing here saturates inside the EQ. §10 test 17
      // asserts that absence, and it is the one place where copying the
      // British path would be wrong rather than merely unmotivated.
      double y = static_cast<double>(v);
      if (eqIn_) {
        for (int b = 0; b < 3; ++b) y = american_[c][b].process(y);
      }
      // §4.4: the band-pass is independent of every EQ setting, so it sits
      // outside the EQ-in switch as it does on the panel.
      y = bandPass_[c].process(y);
      const float amplified = stageB_[c].process(static_cast<float>(y));
      return outputCore_[c].process(amplified);
    }

    // §7.1: input transformer, two Class A stages in series with the EQ
    // networks between them, output transformer. The EQ is between the stages
    // because that is where the feedback networks are, and it is what makes the
    // bands interact — §3.7 says to model them as a chain of real networks
    // rather than three independent biquads and the interaction appears on its
    // own, which §10 test 6 measures.
    const float staged = stageA_[c].process(inputCore_[c].process(v));
    double y = static_cast<double>(staged);
    if (eqIn_) {
      y = britishLow_[c].process(y);
      y = britishMid_[c].process(y);
      y = britishHigh_[c].process(y);
      // §6.1: the cores saturate under high low-frequency level, and it belongs
      // in the EQ section rather than in the amplifier model — a large low
      // shelf boost on bass-heavy material adds harmonic content a linear
      // filter cannot. §10 test 7 fails by name if this is missing.
      y = static_cast<double>(eqCore_[c].process(static_cast<float>(y)));
    }
    // The high-pass is a separate network on its own switch, so it is outside
    // the EQ-in latch exactly as the band controls are inside it.
    y = highPass_[c].process(y);
    const float amplified = stageB_[c].process(static_cast<float>(y));
    return outputCore_[c].process(amplified);
  }

  static int clampIndex(int index, int count) noexcept {
    return index < 0 ? 0 : (index >= count ? count - 1 : index);
  }
  static double clampAmount(double db, double limit) noexcept {
    return db < -limit ? -limit : (db > limit ? limit : db);
  }

  void rebuild() noexcept {
    const double innerRate = sampleRate_ * static_cast<double>(tierFactor(tier_));
    const std::size_t span = nl::oversamplerScratchFloats(8, 1);
    for (int c = 0; c < kConsoleChannels; ++c) {
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

    dsp::InductorShelf::Config low;
    low.frequency = voicing::kBritishLowHz[britishLowIndex_];
    low.amountDb = britishLowDb_;
    dsp::InductorShelf::Config high;
    high.frequency = voicing::kBritishHighHz;
    high.amountDb = britishHighDb_;
    high.high = true;

    dsp::InductorBell::Config mid;
    mid.frequency = voicing::kBritishMidHz[britishMidIndex_];
    mid.amountDb = britishMidDb_;
    // §3.3 marks the Q unpublished and gives 1.0 to 1.7 as the range of
    // estimates; 1.2 is the sheet's own starting point.
    mid.qAtReference = 1.2;
    mid.referenceHz = 1600.0;
    // §6.1's switching scheme: both L and C are switched on the lower two
    // positions, only C above them. The reference is the lowest position at
    // which the inductance stops changing, so the scaling starts from there.
    mid.inductanceSwitched = britishMidIndex_ < 2;
    mid.maxAmountDb = 18.0;

    voicing::Voicing v =
        lineage_ == Lineage::American ? voicing::american() : voicing::british();
    if (variance_ > 0.0f) {
      nl::param::applyVariance(variance_, seed_, v.stageA, v.output);
      nl::param::applyVariance(variance_, seed_ + 1u, v.stageB, v.input);
    }

    for (int c = 0; c < kConsoleChannels; ++c) {
      inputCore_[c].prepare(innerRate, v.input);
      outputCore_[c].prepare(innerRate, v.output);
      eqCore_[c].prepare(innerRate, v.eq);
      stageA_[c].prepare(innerRate, v.stageA);
      stageB_[c].prepare(innerRate, v.stageB);

      britishLow_[c].prepare(innerRate);
      britishLow_[c].setConfig(low);
      britishMid_[c].prepare(innerRate);
      britishMid_[c].setConfig(mid);
      britishHigh_[c].prepare(innerRate);
      britishHigh_[c].setConfig(high);

      highPass_[c].prepare(innerRate);
      highPass_[c].setEnabled(highPassIndex_ > 0);
      highPass_[c].setCorner(highPassIndex_ > 0 ? voicing::kHighPassHz[highPassIndex_] : 80.0);

      bandPass_[c].prepare(innerRate);
      bandPass_[c].setEnabled(bandPassEnabled_ && lineage_ == Lineage::American);
      bandPass_[c].setCorners(50.0, 15000.0);

      for (int b = 0; b < 3; ++b) {
        dsp::BridgedTBand::Config band;
        band.frequency = voicing::kAmericanHz[b][americanIndex_[b]];
        band.amountDb = americanDb_[b];
        band.shape = americanShape_[b] == Shape::Shelf ? dsp::BridgedTBand::Shape::Shelf
                                                       : dsp::BridgedTBand::Shape::Peak;
        band.highShelf = b == 2;
        american_[c][b].prepare(innerRate);
        american_[c][b].setConfig(band);
      }
    }
    dirty_ = false;
  }

  void publish(float inputPeak, float outputPeak) noexcept {
    ConsoleEqFrame frame;
    frame.inputPeak = inputPeak;
    frame.outputPeak = outputPeak;
    frame.american = lineage_ == Lineage::American;
    frame.midQ = static_cast<float>(britishMid_[0].q());
    for (int b = 0; b < 3; ++b) {
      frame.bandwidthOctaves[b] = static_cast<float>(american_[0][b].bandwidthOctaves());
    }
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

  nl::MagneticCore inputCore_[kConsoleChannels];
  nl::MagneticCore outputCore_[kConsoleChannels];
  nl::MagneticCore eqCore_[kConsoleChannels];
  nl::TriodeStage stageA_[kConsoleChannels];
  nl::TriodeStage stageB_[kConsoleChannels];
  dsp::InductorShelf britishLow_[kConsoleChannels];
  dsp::InductorBell britishMid_[kConsoleChannels];
  dsp::InductorShelf britishHigh_[kConsoleChannels];
  dsp::ThirdOrderHighPass highPass_[kConsoleChannels];
  dsp::BridgedTBand american_[kConsoleChannels][3];
  dsp::BandPass12 bandPass_[kConsoleChannels];
  nl::Oversampler<1> over1_[kConsoleChannels];
  nl::Oversampler<2> over2_[kConsoleChannels];
  nl::Oversampler<4> over4_[kConsoleChannels];
  nl::Oversampler<8> over8_[kConsoleChannels];
  std::vector<float> scratch_;
  ConsoleEqPublisher visual_;

  double sampleRate_ = 48000.0;
  int blockSize_ = 128;
  int latency_ = 0;
  double drive_ = 1.0;
  double output_ = 1.0;
  double noise_ = 1.6e-5;
  double britishLowDb_ = 0.0;
  double britishMidDb_ = 0.0;
  double britishHighDb_ = 0.0;
  double americanDb_[3] = {0.0, 0.0, 0.0};
  int britishLowIndex_ = 2;
  int britishMidIndex_ = 2;
  int highPassIndex_ = 0;
  int americanIndex_[3] = {2, 2, 2};
  Shape americanShape_[3] = {Shape::Peak, Shape::Peak, Shape::Peak};
  Lineage lineage_ = Lineage::British;
  Tier tier_ = Tier::X4;
  bool eqIn_ = true;
  bool bandPassEnabled_ = false;
  bool bypass_ = false;
  bool dirty_ = true;
  float variance_ = 0.0f;
  std::uint32_t seed_ = 1u;
  std::uint32_t rng_ = 1u;
};

}  // namespace mw::units
