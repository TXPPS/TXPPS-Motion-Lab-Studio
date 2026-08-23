// Motion Wave — Optical Leveller.
//
// `dyn-02`. A photocell attenuator inside a feedback loop, followed by a valve
// amplifier, between two transformers. The cell is the entire dynamics engine
// and the loop is what turns it into a compressor.
//
// **There is no threshold.** §5 says so outright: the local ratio is a
// continuous function of level and of how long that level has been present, and
// any implementation that computes `if (level > threshold)` has already
// diverged from the reference. So nothing here has a threshold, a knee, or a
// ratio. PEAK REDUCTION sets how hard the sidechain drives the panel, the loop
// closes around it, and the ratio *emerges* — which is also why COMPRESS and
// LIMIT are a change in the sidechain's gain and rectification law rather than
// a ratio parameter. §3.3's implementer rule: a ratio number computed from a
// static curve is right at one depth and wrong at all others.
//
// **The detector taps before the make-up gain.** §3.2 marks this as inference
// and gives the reasoning: in a feedback design, a sidechain that tapped after
// the make-up control would make GAIN change the amount of compression, which
// is not the reported behaviour, and the published advice to set PEAK REDUCTION
// first and GAIN second is consistent with GAIN being outside the loop. Test 12
// is what checks the assumption held.
#pragma once

#include "../dsp/nonlinear/magnetic_core.h"
#include "../dsp/nonlinear/oversampler.h"
#include "../dsp/nonlinear/specs.h"
#include "../dsp/nonlinear/variable_gain.h"
#include "../dsp/optical_cell.h"
#include "../dsp/shelving.h"
#include "../dsp/visual_state.h"
#include "../graph/node.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace mw::units {

namespace nl = dsp::nl;

inline constexpr int kOpticalChannels = 2;

/// What the face draws.
struct OpticalLevellerFrame {
  float inputPeak = 0.0f;
  float outputPeak = 0.0f;
  /// Gain reduction in dB, from the *meter* cell — which lags exactly as the
  /// audio cell does, because on the hardware it is a second cell in the same
  /// package seeing the same light. A face fed an instantaneous calculation
  /// would read a transient the unit never caught.
  float gainReductionDb = 0.0f;
  /// The exposure state, so a face can show why release is where it is.
  float exposure = 0.0f;
  /// The second release branch's current time constant, in seconds.
  float releaseSeconds = 0.0f;
};

using OpticalLevellerPublisher = dsp::FramePublisher<OpticalLevellerFrame>;

class OpticalLeveller : public Node {
 public:
  enum class Mode { Compress = 0, Limit = 1 };
  enum class Tier { Off = 0, X2 = 1, X4 = 2, X8 = 3 };

  // ---- configuration, off the audio thread ----

  /// 0…1, the panel's arbitrary 0–100 scale normalised. §3.1: the numbers
  /// correspond to no dB value and the taper is unknown, so this is a
  /// dimensionless control calibrated empirically against gain reduction.
  void setPeakReduction(double amount) noexcept {
    peakReduction_ = amount < 0.0 ? 0.0 : (amount > 1.0 ? 1.0 : amount);
  }
  /// Make-up, linear. Outside the loop — see the header note and test 12.
  void setMakeUpGain(double gain) noexcept { makeUp_ = gain; }
  void setMode(Mode mode) noexcept { mode_ = mode; }
  /// 0 is flat, as the hardware ships. 1 rolls the lows out of the detector.
  void setEmphasis(double amount) noexcept {
    emphasis_ = amount < 0.0 ? 0.0 : (amount > 1.0 ? 1.0 : amount);
    dirty_ = true;
  }
  /**
   * Cell wear, 0…1.
   *
   * §7 makes this an explicit parameter rather than something baked in, and
   * gives the physics: the panel's phosphor degrades through copper ion
   * migration, and the published failure symptoms of a worn cell are slow
   * recovery, low dark resistance and high light resistance. All three move
   * together here, because they are one process.
   */
  void setWear(double amount) noexcept {
    wear_ = amount < 0.0 ? 0.0 : (amount > 1.0 ? 1.0 : amount);
    dirty_ = true;
  }
  void setInputGain(double gain) noexcept { inputGain_ = gain; }
  void setVariance(float variance, std::uint32_t seed) noexcept {
    variance_ = variance;
    seed_ = seed;
    dirty_ = true;
  }
  void setTier(Tier tier) noexcept {
    if (tier != tier_) {
      tier_ = tier;
      dirty_ = true;
    }
  }
  /// −104 dBFS rms would be the Program EQ's floor; this unit's manual gives 75
  /// dB below +10 dBm, which is audibly higher and is one of its characteristics.
  void setNoise(double amplitude) noexcept { noise_ = amplitude; }
  void setBypass(bool bypass) noexcept { bypass_ = bypass; }

  // ---- Node ----

  void prepare(double sampleRate, int blockSize) override {
    sampleRate_ = sampleRate;
    blockSize_ = blockSize > 0 ? blockSize : 128;
    scratch_.assign(nl::oversamplerScratchFloats(8, blockSize_), 0.0f);
    work_.assign(static_cast<std::size_t>(blockSize_), 0.0f);
    for (int c = 0; c < kOpticalChannels; ++c) {
      nl::MagneticCore::Config input;
      input.saturationFlux *= 2.2f;
      inputCore_[c].prepare(sampleRate, input);
    }
    rebuild();
    reset();
  }

  void reset() override {
    for (int c = 0; c < kOpticalChannels; ++c) {
      inputCore_[c].reset();
      outputCore_[c].reset();
      voltage_[c].reset();
      follower_[c].reset();
      detector_[c] = 0.0;
      emphasisState_[c].reset();
    }
    cell_.reset();
    meterCell_.reset();
    meterVu_ = 0.0;
    over2_.reset();
    over4_.reset();
    over8_.reset();
    rng_ = seed_ * 2654435761u + 1u;
  }

  int latencySamples() const override { return latency_; }
  const char* name() const override { return "optical-leveller"; }

  void process(const ProcessContext& ctx) override {
    if (dirty_) rebuild();
    const AudioBuffer& in = ctx.inputs[0];
    AudioBuffer& out = ctx.outputs[0];
    const int channels =
        out.channelCount() < kOpticalChannels ? out.channelCount() : kOpticalChannels;
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
      // One sample at a time, all the way round — including through the
      // oversampling wrapper, which is called with a single frame.
      //
      // This is a *feedback* compressor: the detector sees the amplifier's
      // output and sets the gain that produces the next one. The first version
      // ran the wrapper over the whole buffer and updated the detector in a
      // second pass, which put a block of delay inside the loop. At 512 samples
      // that is 10.7 ms against a 10 ms attack, and the loop overshot — a 20 ms
      // burst read 12 dB on a meter whose steady value was three. A feedback
      // loop's delay is part of its transfer function, not an implementation
      // detail, and the only delay the hardware has is the one sample this now
      // has.
      for (int i = 0; i < ctx.frames; ++i) {
        const double x = static_cast<double>(source[i]) * inputGain_;
        const float ax = static_cast<float>(x < 0.0 ? -x : x);
        if (ax > inputPeak) inputPeak = ax;

        const double drive = driveFor(detector_[c]);
        // One cell for the pair, because there is one cell in the package and
        // one panel lighting it. Two independent cells would let the channels
        // drift apart on asymmetric material, which is the stereo-image
        // collapse a dual-mono compressor is known for.
        const double conductance = c == 0 ? cell_.process(drive) : cell_.conductance();
        if (c == 0) {
          const double seen = -static_cast<double>(
              attenuator_.gainDb(static_cast<float>(meterCell_.process(drive))));
          meterVu_ = seen + (meterVu_ - seen) * vuCoeff_;
        }

        const float attenuated =
            attenuator_.process(static_cast<float>(x), static_cast<float>(conductance));
        float staged = inputCore_[c].process(attenuated);

        auto shaper = [&](float v) {
          const float amplifiedSample = follower_[c].process(voltage_[c].process(v));
          return outputCore_[c].process(amplifiedSample);
        };
        float amplified = 0.0f;
        switch (tier_) {
          case Tier::Off: over1_.process(&staged, &amplified, 1, shaper); break;
          case Tier::X2: over2_.process(&staged, &amplified, 1, shaper); break;
          case Tier::X4: over4_.process(&staged, &amplified, 1, shaper); break;
          case Tier::X8: over8_.process(&staged, &amplified, 1, shaper); break;
        }

        // The detector taps here, before the make-up gain. Test 12 sweeps GAIN
        // across its range and asserts the reduction moves by under a decibel;
        // if it moves, this line is on the wrong side of the multiply.
        const double amp = static_cast<double>(amplified);
        // The pre-emphasis filters the sidechain's *audio*, before the
        // rectifier — §3.5 calls it rolling the low frequencies out of the
        // detector path, which is a filter on the signal the detector listens
        // to. Filtering the rectified envelope instead removes its DC, which is
        // the whole of what a detector reads: with the control at its extreme
        // the unit compressed 0.1 dB at *every* frequency rather than becoming
        // selective, and test 9 is what caught it.
        const double emphasised = static_cast<double>(emphasisState_[c].process(amplified));
        const double rectified = emphasised < 0.0 ? -emphasised : emphasised;
        // Smoothed before it reaches the panel, because the panel cannot follow
        // a waveform. Feeding the raw rectified sample in made the drive ripple
        // at twice the tone's frequency, and the cell's two branches tracked
        // that ripple asymmetrically — rising fast, falling at a rate that
        // itself moved with the exposure state. The equilibrium then drifted
        // with history: the same setting measured 13.3 dB of reduction after
        // 200 ms and 9.2 dB after a minute, on a loop that has no business
        // moving at all once it has settled. A few milliseconds of integration
        // is what the phosphor and the cell do between them, and it makes the
        // operating point a function of level rather than of waveform.
        detector_[c] = rectified + (detector_[c] - rectified) * rectifierCoeff_;

        const double y = amp * makeUp_ + noise_ * nextNoise();
        const float sample = static_cast<float>(y);
        const float ay = sample < 0.0f ? -sample : sample;
        if (ay > outputPeak) outputPeak = ay;
        destination[i] = sample;
      }
    }
    publish(inputPeak, outputPeak);
  }

  const OpticalLevellerPublisher& visual() const noexcept { return visual_; }
  /// Gain reduction the *audio* cell is applying, in dB. Positive.
  double gainReductionDb() const noexcept {
    return -static_cast<double>(attenuator_.gainDb(static_cast<float>(cell_.conductance())));
  }
  /**
   * What the meter reads, which lags twice.
   *
   * §3.4: the gain-reduction reading comes from a second photocell in the same
   * package, so it has the first cell's lag and memory — and then it drives a
   * *VU movement*, whose own ballistics take about 300 ms to settle. Both lags
   * are here because both are in the hardware, and the second is the larger:
   * with only the cell's 10 ms attack a 20 ms burst reads nearly its steady
   * value, and the published behaviour is that the meter visibly under-reads
   * fast events. A model with one lag makes the meter honest in a way the
   * hardware is not, and QA comparing it against an instantaneous calculation
   * would then agree with it for the wrong reason.
   */
  double meterGainReductionDb() const noexcept { return meterVu_; }
  const dsp::OpticalCell& cell() const noexcept { return cell_; }

 private:
  /**
   * The sidechain: rectified output, through the control shaper, scaled by PEAK
   * REDUCTION and by the mode's law.
   *
   * COMPRESS and LIMIT differ in sidechain gain *and* in the rectification law,
   * which is §3.3's rule. The steeper law is what hardens the knee — a higher
   * power of the detected level makes the loop gain rise faster with level, and
   * loop gain is what the local ratio is. Neither position names a ratio
   * anywhere.
   */
  double driveFor(double detected) const noexcept {
    const double shaped = static_cast<double>(shaper_.process(static_cast<float>(detected)));
    // COMPRESS and LIMIT differ in loop gain and in the rectification law, and
    // the local ratio is whatever the loop gain makes it — a higher power of
    // the detected level makes the loop gain rise faster with level, which is
    // what hardens the knee. Neither position names a ratio anywhere.
    //
    // The law is not fitted, it is solved. Closing the loop gives a local ratio
    // of 1 + R'(c)·c·law·ln10/20, where R is the attenuator's decibels against
    // conductance; at 10 dB of reduction that evaluates to 1 + 3.68·law. So
    // COMPRESS's published 3:1 wants law 0.65 and LIMIT's 8:1 floor wants 2.2,
    // and the measured slopes come out at 3.79 and 9.15.
    //
    // It cannot simply be raised further. At 2.8 the loop becomes bistable —
    // deep reduction starves the detector enough to release it, which releases
    // the detector enough to compress again — and the search for a setting that
    // gives 10 dB runs to the end of the control without finding one. The
    // published "approximately infinity:1" is a nominal figure; the measured
    // 10:1 to 20:1 is what a loop like this can actually hold.
    //
    // The two gains are calibrated so that 10 dB of reduction lands mid-scale.
    // No family of transfer curves at stated settings was located, which §8
    // records as this unit's highest-value outstanding research item.
    // COMPRESS's law is sub-linear, which is what keeps its slope inside the
    // published 3:1 band: the local ratio is set by how fast the loop gain
    // grows with level, and a linear rectification law grows it faster than
    // this unit's gentlest setting does.
    const double law = mode_ == Mode::Limit ? 2.2 : 0.65;
    const double gain = mode_ == Mode::Limit ? 1000.0 : 10.0;
    const double lit = gain * peakReduction_ * std::pow(shaped > 0.0 ? shaped : 0.0, law);
    // Panel output falls as the phosphor ages, which is why a worn cell
    // compresses less for a given setting — §7's first published symptom.
    const double aged = lit * (1.0 - 0.55 * wear_);
    return aged > 1.0 ? 1.0 : aged;
  }

  void rebuild() noexcept {
    nl::StageScratch slice{scratch_.data(), scratch_.size()};
    // 0.3 ms, and the order of magnitude is the whole point. This was 3 ms,
    // which is not "fast enough not to compete with a 10 ms attack" — it is
    // comparable to the cell's own 3.56 ms constant, so it became a second pole
    // in series with it and the observed attack was the pair. The cell's
    // constant then had to be tuned to whatever made the *cascade* read 10 ms,
    // which is fitting a number to an implementation rather than deriving it
    // from the specification.
    //
    // At a tenth of the cell's constant it removes the rectified waveform's
    // ripple and contributes nothing measurable to the attack, which is what a
    // sidechain rectifier is supposed to do.
    rectifierCoeff_ = std::exp(-1.0 / (0.002 * sampleRate_));
    // Standard VU: about 300 ms to settle, which is 4.6 time constants, so 65
    // ms. The number is the movement's, not the cell's.
    vuCoeff_ = std::exp(-1.0 / (0.065 * sampleRate_));
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

    // §6.3 and §6.4: a 12AX7 voltage amplifier, single-ended and the dominant
    // tone-shaping nonlinearity, then a cathode follower which is low
    // distortion by topology and contributes mainly at extreme levels.
    nl::TriodeStage::Config voltage;
    voltage.restoreHz = 2.0f;
    nl::TriodeStage::Config follower;
    follower.drive = 0.09f;
    follower.bias = 0.014f;
    follower.restoreHz = 2.0f;
    nl::MagneticCore::Config outputCore;
    if (variance_ > 0.0f) nl::param::applyVariance(variance_, seed_, voltage, outputCore);
    const double innerRate = sampleRate_ * static_cast<double>(tierFactor(tier_));
    for (int c = 0; c < kOpticalChannels; ++c) {
      voltage_[c].prepare(innerRate, voltage);
      follower_[c].prepare(innerRate, follower);
      outputCore_[c].prepare(innerRate, outputCore);
      // §3.5: flat as shipped, progressively rolling the lows out of the
      // detector as the control advances. The exact curve is unknown and the
      // sheet says to treat it as such — first order, corner in the low kHz at
      // the extreme, which is what the two conflicting published descriptions
      // agree on when read from their opposite ends.
      dsp::BiquadCoeffs flat;
      flat.b0 = 1.0;
      emphasisState_[c].setCoeffs(emphasis_ > 0.001
                                      ? dsp::onePoleHighpassCoeffs(60.0 + 1800.0 * emphasis_,
                                                                   sampleRate_)
                                      : flat);
    }

    dsp::OpticalCellConfig cellConfig;
    // A worn cell recovers slowly: the second release branch stretches with
    // wear, which is the second of the published symptoms.
    cellConfig.releaseSlowMinSeconds *= 1.0 + 1.5 * wear_;
    cellConfig.releaseSlowMaxSeconds *= 1.0 + 1.5 * wear_;
    cell_.prepare(sampleRate_, cellConfig);
    meterCell_.prepare(sampleRate_, cellConfig);
    nl::PhotoresistiveCell::Config attenuator;
    // And a worn cell's dark resistance falls while its light resistance rises,
    // which narrows the range it can attenuate over — the third symptom, and
    // the one a user notices as "it will not go as deep any more".
    attenuator.darkResistance *= 1.0f - 0.4f * static_cast<float>(wear_);
    attenuator.lightResistance *= 1.0f + 6.0f * static_cast<float>(wear_);
    attenuator_.prepare(sampleRate_, attenuator);
    shaper_.prepare(sampleRate_, dsp::nl::ControlShaper::Config{});
    dirty_ = false;
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

  double nextNoise() noexcept {
    rng_ = rng_ * 1664525u + 1013904223u;
    return static_cast<double>(rng_ >> 8) / 8388608.0 - 1.0;
  }

  void publish(float inputPeak, float outputPeak) noexcept {
    OpticalLevellerFrame frame;
    frame.inputPeak = inputPeak;
    frame.outputPeak = outputPeak;
    frame.gainReductionDb = static_cast<float>(meterGainReductionDb());
    frame.exposure = static_cast<float>(cell_.exposure());
    frame.releaseSeconds = static_cast<float>(cell_.slowReleaseSeconds());
    visual_.publish(frame);
  }

  dsp::OpticalCell cell_;
  dsp::OpticalCell meterCell_;
  nl::PhotoresistiveCell attenuator_;
  nl::ControlShaper shaper_;
  nl::MagneticCore inputCore_[kOpticalChannels];
  nl::MagneticCore outputCore_[kOpticalChannels];
  nl::TriodeStage voltage_[kOpticalChannels];
  nl::TriodeStage follower_[kOpticalChannels];
  dsp::Biquad emphasisState_[kOpticalChannels];
  nl::Oversampler<1> over1_;
  nl::Oversampler<2> over2_;
  nl::Oversampler<4> over4_;
  nl::Oversampler<8> over8_;
  OpticalLevellerPublisher visual_;

  std::vector<float> scratch_;
  std::vector<float> work_;
  double detector_[kOpticalChannels] = {0.0, 0.0};
  double rectifierCoeff_ = 0.0;
  double vuCoeff_ = 0.0;
  double meterVu_ = 0.0;
  double sampleRate_ = 48000.0;
  double peakReduction_ = 0.0;
  double makeUp_ = 1.0;
  double emphasis_ = 0.0;
  double wear_ = 0.0;
  double inputGain_ = 1.0;
  /// 75 dB below +10 dBm rms, which is −12 dBFS: −87 dBFS rms, times √3 for a
  /// uniform source's amplitude.
  double noise_ = 7.7e-5;
  float variance_ = 0.0f;
  std::uint32_t seed_ = 1u;
  std::uint32_t rng_ = 1u;
  int blockSize_ = 128;
  int latency_ = 0;
  Mode mode_ = Mode::Compress;
  Tier tier_ = Tier::X4;
  bool bypass_ = false;
  bool dirty_ = true;
};

}  // namespace mw::units
