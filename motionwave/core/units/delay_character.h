// Motion Wave — the Granular Delay's character: what the medium does to what
// passes through it. `fx-03` §6.3 (tape) and §6.4 (bucket-brigade).
//
// **Two halves, around the buffer, not one block inside the loop.** §1.2's
// diagram draws CHARACTER in the feedback chain, and §6.3 says repeat
// degradation "falls out for free from putting the saturator inside the loop".
// Both are true and neither is the whole picture: §9 V11 measures the *wet
// path's* bandwidth on a single pass, so a BBD's darkness has to be on the first
// repeat and not only on the recirculated ones. A physical device is a record
// stage, a medium and a playback stage, and the feedback re-enters the record
// stage — so `processIn` sits before the buffer write and `processOut` on the
// wet bus, and recirculation passes through both again because the loop's own
// read goes back into the buffer. That gives §6.3's accumulation and §6.4's
// coupling from one placement, and Clean is the identity on both halves, which
// is what lets V2 null the plain delay to −140 dBFS with this stage in circuit.
//
// **The bandwidth is coupled to the delay time, quantitatively, on both media.**
// A tape head has a gap, so the recorded wavelength `v/f` meets a sinc with its
// first null at `f = v/g` — slow the tape for a longer delay and the null falls.
// A bucket-brigade's clock is `f_clk = N / (2D)`, and its filters sit at a third
// of that, so 300 ms on a 4096-stage line is a 2.3 kHz lowpass. §8 calls this
// "the single most recognisable analogue-delay behaviour", and it is a derived
// number rather than a taste decision — V11 grades it at three delay times.
#pragma once

#include "../dsp/biquad.h"
#include "../dsp/grain/rng.h"
#include "../dsp/nonlinear/magnetic_core.h"
#include "../dsp/nonlinear/oversampler.h"

#include <cmath>
#include <cstdint>

namespace mw::units::delay {

enum class Character : std::uint8_t { Clean = 0, Tape, Bbd };
/// §9.3's tiers. Named for what they cost rather than for a product.
enum class Quality : std::uint8_t { Eco = 0, Normal, High };

/// §6.4's virtual stage counts, which set how dark a line gets at long times.
inline int bbdStagesFor(int selector) noexcept {
  return selector <= 0 ? 1024 : (selector == 1 ? 2048 : 4096);
}

/// `f_clk = N / (2·D)`, §6.4. The clock a line of `stages` needs for `seconds`.
inline double bbdClockHzFor(int stages, double seconds) noexcept {
  const double d = seconds < 0.001 ? 0.001 : seconds;
  return static_cast<double>(stages) / (2.0 * d);
}

/**
 * Where a tape head's gap loss first nulls, for a given delay.
 *
 * `|H| = |sin(π·g·f/v) / (π·g·f/v)|` nulls at `f = v/g`, and a machine that
 * lengthens its delay by slowing the tape moves that null down in proportion.
 * The gap width is ours to choose — the sheet's §11 says the relation is
 * standard theory and the width was not confirmed against a reachable source —
 * so it is chosen for a bright, fast machine: 25 kHz at 100 ms, which puts the
 * −3 dB point (0.443 of the null) at 11 kHz there, 3.7 kHz at 300 ms and
 * 2.2 kHz at half a second. Clamped so a very short delay does not ask for a
 * filter above Nyquist and a very long one does not go dark past usefulness.
 */
inline double tapeNullHzFor(double seconds) noexcept {
  const double d = seconds < 0.001 ? 0.001 : seconds;
  const double null = 25000.0 * (0.100 / d);
  return null < 2000.0 ? 2000.0 : (null > 40000.0 ? 40000.0 : null);
}

/**
 * A peak follower with separate attack and release, in seconds.
 *
 * The companders below need two of these with *mismatched* constants: the
 * mismatch is the breathing on the noise floor and the overshoot on a transient
 * that §6.4 lists among the artefacts worth having, and matched constants would
 * make the pair transparent and the model pointless.
 */
class Follower {
 public:
  void prepare(double sampleRate, double attackSeconds, double releaseSeconds) noexcept {
    attack_ = 1.0 - std::exp(-1.0 / (attackSeconds * sampleRate));
    release_ = 1.0 - std::exp(-1.0 / (releaseSeconds * sampleRate));
    reset();
  }
  void reset() noexcept { env_ = 0.0; }
  double process(double x) noexcept {
    const double a = std::fabs(x);
    env_ += (a > env_ ? attack_ : release_) * (a - env_);
    return env_;
  }
  double value() const noexcept { return env_; }

 private:
  double attack_ = 0.01;
  double release_ = 0.001;
  double env_ = 0.0;
};

/// Cascaded Butterworth sections. `order` is 2, 4 or 8.
class ButterworthLowpass {
 public:
  void configure(int order, double hz, double sampleRate) noexcept {
    // Section Qs of a Butterworth of each even order, from the pole angles.
    static constexpr double kQ2[1] = {0.70710678};
    static constexpr double kQ4[2] = {0.54119610, 1.30656296};
    static constexpr double kQ8[4] = {0.50979558, 0.60134489, 0.89997622, 2.56291545};
    sections_ = order >= 8 ? 4 : (order >= 4 ? 2 : 1);
    const double* q = sections_ == 4 ? kQ8 : (sections_ == 2 ? kQ4 : kQ2);
    // Never above 0.45 of the rate: a biquad asked for a corner at Nyquist is a
    // biquad with coefficients that are not a filter.
    const double corner = hz < 20.0 ? 20.0 : (hz > 0.45 * sampleRate ? 0.45 * sampleRate : hz);
    for (int i = 0; i < sections_; ++i) {
      stage_[i].setCoeffs(dsp::lowpassCoeffs(corner, q[i], sampleRate));
    }
  }
  void reset() noexcept {
    for (dsp::Biquad& s : stage_) s.reset();
  }
  double process(double x) noexcept {
    for (int i = 0; i < sections_; ++i) x = stage_[i].process(x);
    return x;
  }
  double magnitudeAt(double hz, double sampleRate) const noexcept {
    double m = 1.0;
    for (int i = 0; i < sections_; ++i) m *= stage_[i].magnitudeAt(hz, sampleRate);
    return m;
  }

 private:
  dsp::Biquad stage_[4];
  int sections_ = 1;
};

/**
 * One channel of the character stage. The unit holds two.
 *
 * Per channel rather than a stereo class, because every element here has state
 * and a stereo pair through one filter's state would be a filter hearing the
 * sum — the same reason each tap gets its own filter.
 */
class CharacterChannel {
 public:
  void prepare(double sampleRate, std::uint64_t seed) noexcept {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    rng_.seed(seed);
    // §6.4's compander parts are named and their time constants are not, so
    // these are ours: fast enough to track a note's attack, slow enough to hold
    // through a bar of decay, and different from each other on purpose.
    compressorEnv_.prepare(sampleRate_, 0.0015, 0.025);
    expanderEnv_.prepare(sampleRate_, 0.0025, 0.040);
    // Tape hysteresis at High is the shared magnetic core with its pole moved
    // up: at 12 Hz the core integrates like a transformer, and tape saturates
    // the record current itself rather than its integral, so the pole goes to
    // the top of the band and the model becomes a hysteretic curve of `x`.
    tapeCoreConfig_.poleHz = 16000.0f;
    tapeCore_.prepare(sampleRate_, tapeCoreConfig_);
    over_.prepare(23, 23, 8.0);
    reset();
    configure();
  }

  void reset() noexcept {
    compressorEnv_.reset();
    expanderEnv_.reset();
    antiAlias_.reset();
    reconstruct_.reset();
    gapLoss_.reset();
    tapeCore_.reset();
    over_.reset();
    held_ = 0.0;
    previousIn_ = 0.0;
    clockPhase_ = 0.0;
    whinePhase_ = 0.0;
    hfState_ = 0.0;
    ageState_ = 0.0;
  }

  void set(Character character, Quality quality, double bias, double age, int stages,
           double delaySeconds, bool whine) noexcept {
    character_ = character;
    quality_ = quality;
    bias_ = bias < 0.0 ? 0.0 : (bias > 1.0 ? 1.0 : bias);
    age_ = age < 0.0 ? 0.0 : (age > 1.0 ? 1.0 : age);
    stages_ = stages;
    delaySeconds_ = delaySeconds;
    whine_ = whine;
    configure();
  }

  double bbdClockHz() const noexcept { return clockHz_; }
  double tapeNullHz() const noexcept { return tapeNullHzFor(delaySeconds_); }

  /// Before the buffer write: the record head, or the line's input.
  double processIn(double x) noexcept {
    switch (character_) {
      case Character::Tape: {
        // §6.3: raising the bias reduces headroom and repeat level, and costs
        // top end. Drive rises with bias, level falls, and a one-pole shaves
        // the highs — three effects of one control, which is what makes Bias a
        // control distinct from Drive.
        const double drive = 1.0 + 3.0 * bias_;
        double y;
        if (quality_ == Quality::High) {
          y = static_cast<double>(tapeCore_.process(static_cast<float>(x * drive))) / drive;
        } else {
          // Static, asymmetric: the even term is the crossover the literature
          // reports, small enough to read as warmth rather than as a fault.
          const double bent = x * drive;
          y = std::tanh(bent + 0.08 * bent * std::fabs(bent)) / drive;
        }
        hfState_ += hfCoeff_ * (y - hfState_);
        return hfState_ * tapeLevel_;
      }
      case Character::Bbd: {
        // §6.4 in order: the anti-alias filter first, because the compressor
        // is a nonlinearity and would fold what the filter is there to remove.
        double y = antiAlias_.process(x);
        const double env = compressorEnv_.process(y);
        y *= compressorGain(env);
        if (!holdActive_) return y;
        // The line samples at `f_clk`. The accumulator carries the fraction so
        // a clock that does not divide the sample rate is not quantised to one
        // that does — 6.8 kHz at 48 kHz is 7.06 samples per bucket, not 7 —
        // and the bucket takes the input *at the clock instant*, interpolated
        // between the two host samples around it. Holding the host sample
        // instead put up to one sample of jitter on every bucket's timing, and
        // one sample at 2 kHz is a quarter of a radian: sidebands twenty
        // decibels under the tone, in a pattern that repeats at the beat
        // between the clock and the host rate. The input has been lowpassed at
        // a third of the clock, so linear interpolation across one host sample
        // is accurate to parts in a thousand there.
        const double before = clockPhase_;
        clockPhase_ += clockStep_;
        if (clockPhase_ >= 1.0) {
          clockPhase_ -= 1.0;
          const double alpha = (1.0 - before) / clockStep_;
          held_ = previousIn_ + alpha * (y - previousIn_);
        }
        previousIn_ = y;
        return held_;
      }
      case Character::Clean:
      default:
        return x;
    }
  }

  /// On the wet bus: the playback head, or the line's output.
  double processOut(double x) noexcept {
    switch (character_) {
      case Character::Tape: {
        double y = gapLoss_.process(x);
        ageState_ += ageCoeff_ * (y - ageState_);
        y = ageState_;
        if (quality_ == Quality::High) {
          // Scrape flutter: §6.1 says it is amplitude noise at this rate rather
          // than delay modulation, at a depth no greater than 0.01 %.
          const double n = 2.0 * static_cast<double>(rng_.uniform()) - 1.0;
          y *= 1.0 + 1.0e-4 * n;
        }
        return y;
      }
      case Character::Bbd: {
        // The floor is added before the expander so the expander has something
        // to breathe on — the whole reason a compander was fitted to these
        // parts. −72 dBFS is a level chosen for the model, not measured from a
        // device; §11 says so and this comment says so again so nobody cites
        // it as a fact about a part.
        const double noise = kNoiseFloor * (2.0 * static_cast<double>(rng_.uniform()) - 1.0);
        double y = x + noise;
        const double env = expanderEnv_.process(y);
        const double gain = expanderGain(env);
        if (quality_ == Quality::High) {
          // Oversampled, because a gain that moves at audio rate multiplied into
          // the signal is a modulator, and its products above Nyquist fold
          // otherwise. The halfband pair is the shared one.
          float in = static_cast<float>(y);
          float up[2];
          float down[1];
          over_.interpolate(&in, up, 1);
          up[0] *= static_cast<float>(gain);
          up[1] *= static_cast<float>(gain);
          over_.decimate(up, down, 1);
          y = static_cast<double>(down[0]);
        } else {
          y *= gain;
        }
        y = reconstruct_.process(y);
        if (whine_ && quality_ != Quality::Eco) {
          whinePhase_ += clockHz_ / sampleRate_;
          if (whinePhase_ >= 1.0) whinePhase_ -= 1.0;
          y += kWhineLevel * std::sin(6.28318530717958647692 * whinePhase_);
        }
        return y;
      }
      case Character::Clean:
      default:
        return x;
    }
  }

 private:
  /// −72 dBFS and −78 dBFS: engineering choices for the model, per §11.
  static constexpr double kNoiseFloor = 0.000251;
  static constexpr double kWhineLevel = 0.000126;
  /// The compander's reference level, −12 dBFS, around which its gain is unity.
  static constexpr double kReference = 0.25;

  /// 2:1 in decibels: output amplitude is the geometric mean of input and reference.
  double compressorGain(double env) const noexcept {
    const double e = env < 1.0e-5 ? 1.0e-5 : env;
    return std::sqrt(kReference / e);
  }
  /// 1:2, the mirror — but on its own detector with its own constants.
  double expanderGain(double env) const noexcept {
    const double e = env < 1.0e-5 ? 1.0e-5 : env;
    const double g = e / kReference;
    // Bounded, because an expander with an unbounded gain is a noise generator
    // the moment its detector sees silence — real parts clip here too.
    return g > 4.0 ? 4.0 : g;
  }

  void configure() noexcept {
    clockHz_ = bbdClockHzFor(stages_, delaySeconds_);
    clockStep_ = clockHz_ / sampleRate_;
    /*
     * The bucket hold runs only while its images can be heard. A hold at
     * `f_clk` puts an image of every component `f` at `f_clk − f`, and the
     * input is lowpassed at `f_clk / 3`, so the lowest image sits at
     * `2·f_clk / 3`. In the device that image is removed by an analogue filter
     * in continuous time; on a sampled host it is real only below the host's
     * Nyquist. Above three quarters of the host rate the images all lie past
     * Nyquist, where a hold on the host grid can only fold them back into the
     * band as something the device never produced — a 5 kHz tone at 50 ms on
     * a 4096-stage line came back with a −19 dB partner at 12 kHz that no
     * bucket-brigade makes. Below that clock the images are the device's own
     * and the reconstruction filter treats them the way its analogue
     * counterpart does.
     */
    holdActive_ = clockHz_ <= 0.75 * sampleRate_;
    // §6.4: the rule of thumb is a lowpass at a third of the lowest clock.
    // Eighth order in, because V12 asks for alias products at −60 dBFS with a
    // 5 kHz tone 1.14 octaves above a 2.27 kHz corner, and 55 dB in an octave
    // and a bit is what eight poles give. Fourth order out: its job is the
    // images, which sit a full clock away.
    antiAlias_.configure(8, clockHz_ / 3.0, sampleRate_);
    reconstruct_.configure(4, clockHz_ / 3.0, sampleRate_);
    // Tape: the gap-loss null moves with the delay; −3 dB at 0.443 of the null.
    gapLoss_.configure(2, 0.443 * tapeNullHzFor(delaySeconds_), sampleRate_);
    // Age: older tape has lower bandwidth and a warmer top, §6.3. Twenty
    // kilohertz new, four kilohertz worn.
    const double ageHz = 20000.0 - 16000.0 * age_;
    ageCoeff_ = 1.0 - std::exp(-6.28318530717958647692 * ageHz / sampleRate_);
    // Bias: highs and level both fall as it rises.
    const double hfHz = 20000.0 - 12000.0 * bias_;
    hfCoeff_ = 1.0 - std::exp(-6.28318530717958647692 * hfHz / sampleRate_);
    tapeLevel_ = 1.0 - 0.3 * bias_;
    // The hysteretic core's headroom falls with bias: the same "headroom and
    // repeat level are reduced" statement, applied to the High-tier model.
    tapeCoreConfig_.saturationFlux = static_cast<float>(0.916 * (1.0 - 0.5 * bias_));
    tapeCoreConfig_.hysteresisDepth = static_cast<float>(0.05 + 0.10 * bias_);
    tapeCore_.setConfig(tapeCoreConfig_);
  }

  dsp::grain::Rng rng_;
  Follower compressorEnv_;
  Follower expanderEnv_;
  ButterworthLowpass antiAlias_;
  ButterworthLowpass reconstruct_;
  ButterworthLowpass gapLoss_;
  dsp::nl::MagneticCore tapeCore_;
  dsp::nl::MagneticCore::Config tapeCoreConfig_;
  dsp::nl::HalfbandStage over_;
  double sampleRate_ = 48000.0;
  double bias_ = 0.0;
  double age_ = 0.0;
  double delaySeconds_ = 0.25;
  double clockHz_ = 8192.0;
  double clockStep_ = 0.17;
  double previousIn_ = 0.0;
  double hfCoeff_ = 1.0;
  double ageCoeff_ = 1.0;
  double tapeLevel_ = 1.0;
  double held_ = 0.0;
  double clockPhase_ = 0.0;
  double whinePhase_ = 0.0;
  double hfState_ = 0.0;
  double ageState_ = 0.0;
  int stages_ = 4096;
  Character character_ = Character::Clean;
  Quality quality_ = Quality::Normal;
  bool whine_ = true;
  bool holdActive_ = true;
};

}  // namespace mw::units::delay
