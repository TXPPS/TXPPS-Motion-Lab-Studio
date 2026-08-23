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
  //
  // One setter per control rather than one per band, because that is what the
  // panel has — the frequency and the amount are two rings of a concentric
  // switch, not one value — and because the generated parameter dispatch is one
  // statement per parameter.
  void setBritishLowFrequency(int index) noexcept {
    britishLowIndex_ = clampIndex(index, voicing::kBritishLowCount);
    dirty_ = true;
  }
  void setBritishLowAmount(double db) noexcept {
    britishLowDb_ = clampAmount(db, 16.0);
    dirty_ = true;
  }
  void setBritishMidFrequency(int index) noexcept {
    britishMidIndex_ = clampIndex(index, voicing::kBritishMidCount);
    dirty_ = true;
  }
  void setBritishMidAmount(double db) noexcept {
    britishMidDb_ = clampAmount(db, 18.0);
    dirty_ = true;
  }
  /// §3.2: the high band has no frequency control at all.
  void setBritishHighAmount(double db) noexcept {
    britishHighDb_ = clampAmount(db, 16.0);
    dirty_ = true;
  }
  /// Index 0 is out; 1 to 4 are 50, 80, 160 and 300 Hz.
  void setHighPass(int index) noexcept {
    highPassIndex_ = clampIndex(index, voicing::kHighPassCount);
    dirty_ = true;
  }

  // American lineage.
  void setAmericanFrequency(int band, int index) noexcept {
    if (band < 0 || band >= 3) return;
    americanIndex_[band] = clampIndex(index, voicing::kAmericanCount);
    dirty_ = true;
  }
  void setAmericanAmount(int band, double db) noexcept {
    if (band < 0 || band >= 3) return;
    americanDb_[band] = clampAmount(db, 12.0);
    dirty_ = true;
  }
  void setAmericanShape(int band, Shape shape) noexcept {
    if (band < 0 || band >= 3) return;
    // §4.3: only bands 1 and 3 switch shape, and band 2 is peak only. Silently
    // accepting a shelf on band 2 would make a control that does nothing, which
    // is the same class of bug as a wrong number.
    americanShape_[band] = band == 1 ? Shape::Peak : shape;
    dirty_ = true;
  }

  /// The detent tables, for a face that has to label the switches.
  static double britishLowHz(int index) noexcept {
    return voicing::kBritishLowHz[clampIndex(index, voicing::kBritishLowCount)];
  }
  static double britishMidHz(int index) noexcept {
    return voicing::kBritishMidHz[clampIndex(index, voicing::kBritishMidCount)];
  }
  static double americanHz(int band, int index) noexcept {
    const int b = band < 0 ? 0 : (band > 2 ? 2 : band);
    return voicing::kAmericanHz[b][clampIndex(index, voicing::kAmericanCount)];
  }

  /**
   * §4.2's five detents each way, plus zero.
   *
   * The steps are 2, 4, 6, 9 and 12, which is not a series — the gap widens at
   * the top — so the control is a position on a switch and this is the table it
   * selects from. A linear or logarithmic mapping would put the middle detents
   * in the wrong places and §10 test 11 measures every one of them.
   */
  static double americanStepDb(int position) noexcept {
    static constexpr double kSteps[11] = {-12.0, -9.0, -6.0, -4.0, -2.0, 0.0,
                                          2.0,   4.0,  6.0,  9.0,  12.0};
    return kSteps[clampIndex(position, 11)];
  }

  void setBandPass(bool enabled) noexcept {
    bandPassEnabled_ = enabled;
    // The filter's own switch is read in `rebuild`, not in `process`, so
    // without this the control does nothing at all — which is a bug of the same
    // class as a wrong number and is what §10 test 16 caught.
    dirty_ = true;
  }

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
      // Bypass passes the signal through, so the meters carry on reading it.
      const float passed = peakOfBuffer(out);
      publish(passed, passed);
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
    const double flat = static_cast<double>(staged);
    double y = flat;
    if (eqIn_) {
      y = britishLow_[c].process(y);
      y = britishMid_[c].process(y);
      y = britishHigh_[c].process(y);
      /*
       * §6.1: the cores saturate under high low-frequency level, and it belongs
       * in the EQ section rather than in the amplifier model — a large low
       * shelf boost on bass-heavy material adds harmonic content a linear
       * filter cannot. §10 test 7 fails by name if this is missing.
       *
       * **The core sees what the network added, not the signal passing
       * through.** An inductor carries the network's own current; with the
       * boost control at centre the network is out of circuit and the inductor
       * carries nothing. Driving the core with the through signal instead makes
       * the EQ section a distortion source at every setting including flat, and
       * then the row that asks for saturation under boost and the specification
       * that asks for 0.07 % with the EQ flat pull against each other with no
       * size of core that satisfies both — they are only four times apart in
       * flux. Measured with the through signal, 50 Hz at the unit's own
       * published operating level read 0.22 % against a 0.07 % specification.
       */
      const double added = y - flat;
      y = flat + static_cast<double>(eqCore_[c].process(static_cast<float>(added)));
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
        const bool shelf = americanShape_[b] == Shape::Shelf;
        band.shape = shelf ? dsp::BridgedTBand::Shape::Shelf : dsp::BridgedTBand::Shape::Peak;
        band.highShelf = b == 2;
        if (shelf) {
          // **In shelf mode the detent labels the plateau, not the corner.**
          // A console shelf marked 50 Hz lifts the 50 Hz region by the amount
          // selected; a shelving section whose *midpoint* sits at 50 Hz is only
          // half way there by then, and §10 test 15 measures exactly that — it
          // asks the gain at 20 Hz to be within a decibel of the gain at 50 Hz.
          // Placed at the midpoint the two read 11.61 and 6.00 dB.
          band.frequency *= shelf && !band.highShelf ? kShelfPlateau : 1.0 / kShelfPlateau;
        }
        american_[c][b].prepare(innerRate);
        american_[c][b].setConfig(band);
      }
    }
    dirty_ = false;
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

  /// How far above the labelled frequency a low shelf's corner sits so that the
  /// label is the plateau. Bounded by §10 test 15's one-decibel window between
  /// 20 and 50 Hz at band 1's lowest position.
  static constexpr double kShelfPlateau = 2.5;

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
  /// §9.1: −83 dBu at line gain, which is −105 dBFS on this project's
  /// alignment of +4 dBu to −18 dBFS. The generator is uniform on [−1, 1), so
  /// the amplitude is that over root three.
  double noise_ = 9.8e-6;
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
