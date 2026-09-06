// Motion Wave — the Granular Delay's transport: speed, and what speed does to
// pitch.
//
// `fx-03` §6.2 derives the thing this file exists for. An interpolating delay
// with a moving read point shifts pitch by `1 − D′(t)`; a tape transport does
// something stronger, because record and playback share one motor: the delay
// is a fixed *distance* between heads, so
//
//     ∫_{t−D(t)}^{t} v(τ) dτ = L        ⇒        pitch ratio = v(t) / v(t − D)
//
// Three consequences follow that a delay-time LFO cannot reproduce, and each is
// a row in §9: a constant speed error produces no pitch shift at all; the wobble
// depth depends on the delay time as `2a·sin(πfD)`, so wow on a slapback and wow
// on a long echo differ in kind rather than in size (V10); and both fall out for
// free from implementing the transport rather than the LFO. So the delay is not
// a number this file holds — it is a state it integrates:
//
//     D[n] = D[n−1] + 1 − v[n] / v[n − round(D[n−1])]                 (§6.2)
//
// with `v` read back from a history of itself. The history is decimated by 128
// and linearly interpolated, which §9.2 licenses: `v` is band-limited to 30 Hz
// and 375 Hz is twelve times that, so the decimation is lossless where it is
// read. At full rate the history would be 1.5 MB per head at eight seconds; nine
// heads at 128:1 are 108 KB together.
//
// **Every tap is its own transport, sharing one wow and flutter.** A real
// multi-head echo has one motor, so its heads cannot change time independently
// — and this unit's taps can, because §7.2 gives each a time control. Giving
// each tap a speed of its own is what lets a Tape-mode change on tap three bend
// tap three and leave the others alone, while the wow every head shares comes
// from one generator, because it is one motor's wobble.
#pragma once

#include "../dsp/grain/rng.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace mw::units::delay {

/// §6.2's three settings for what happens when a delay time changes.
enum class TimeChangeMode : std::uint8_t { Tape = 0, Digital, Instant };

/// §6.1's depth presets, as weighted wow-and-flutter percentages.
enum class Wear : std::uint8_t { Clean = 0, Studio, Vintage, Worn };

/**
 * The nominal weighted wow and flutter of each preset, as a fraction.
 *
 * §6.1's table: 0.02 % is a professional machine and inaudible, 0.08 % a good
 * cassette deck and still audible under some conditions. The four settings
 * bracket that: Clean is the digital case, Studio sits under the audibility
 * figure, Vintage is obvious and musical, Worn is seasick. The three non-zero
 * values are the sheet's own and are marked `[I]` there — they are our design
 * choice for where the control's detents fall, not a measurement of any machine,
 * and V9 grades the generator against them in the standard unit so that the
 * numbers stay comparable to real transports whatever we chose them to be.
 */
inline double nominalWrmsFor(Wear wear) noexcept {
  switch (wear) {
    case Wear::Studio: return 0.0005;
    case Wear::Vintage: return 0.0035;
    case Wear::Worn: return 0.015;
    case Wear::Clean:
    default: return 0.0;
  }
}

/**
 * Wow and flutter, as a fractional speed deviation `ε[n]`.
 *
 * Summed as a speed, never as a delay-time deviation — §6.2 is the whole reason.
 * Three components from §6.1's table: drift, slow filtered noise the weighting
 * excludes but a long tail hears; wow, a 1.2 Hz sine with 30 % band-limited
 * noise; flutter, a 16 Hz sine with the same. Scrape flutter is amplitude noise
 * at 500 Hz–3 kHz and is not a speed component, so it lives in the character
 * stage rather than here.
 *
 * **The amplitudes are derived from the preset's nominal WRMS through the
 * weighting curve, not chosen by ear.** IEC 386 / CCIR weight speed deviation
 * with a peak of one at 4 Hz and 6 dB per octave skirts either side, which is
 * `W(f) = min(f/4, 4/f)` with a rounded knee. The composite's weighted RMS per
 * unit of `w` is a constant of this design: the two sines contribute
 * `(W(f)·a)²/2` each, exactly, and the noise bands and the drift contribute
 * the integral of their filter responses against `W²`, which sits mostly on
 * the 4 Hz peak because the wow band runs from 0.3 to 6 Hz. With the wow and
 * flutter amplitudes in the ratio below the composite measures
 *
 *     sines:  W(1.2)·a_w/√2 = 0.369·w,  W(16)·a_f/√2 = 0.271·w  →  0.458·w
 *     bands and drift, numerically against the same weighting:   0.889·w
 *     composite:                                                  1.000·w
 *
 * so `a_w = 1.667·w` and `a_f = 1.484·w`. The first version of this comment
 * estimated the bands at a fifth of their sines' weighted power and put the
 * amplitudes at 3.11 and 2.77; V9 read every preset 86.6 % high, which is
 * what the row is for — the band integrals were computed rather than
 * guessed, and the amplitudes follow from them. Solving a generator's
 * amplitude for a published weighting curve and a stated target is
 * calibration against two published constraints, which is the one kind of
 * fitting this repository allows, and V9 keeps it honest: a change to any
 * band moves the composite and the row says by how much.
 */
class WowFlutter {
 public:
  void prepare(double sampleRate, std::uint64_t seed) noexcept {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    rng_.seed(seed);
    // One-pole coefficients for the three noise bands. A one-pole lowpass on
    // unit-variance white noise has output variance `a / (2 − a)`, which is what
    // `noiseGain` below inverts so each band's noise arrives at unit RMS before
    // its depth is applied.
    driftLp_ = onePole(0.5);
    wowLp_ = onePole(6.0);
    wowHp_ = onePole(0.3);
    flutterLp_ = onePole(30.0);
    flutterHp_ = onePole(6.0);
    driftGain_ = noiseGain(driftLp_);
    wowGain_ = noiseGain(wowLp_);
    flutterGain_ = noiseGain(flutterLp_);
    reset();
  }

  void setWear(Wear wear) noexcept {
    const double w = nominalWrmsFor(wear);
    wowDepth_ = 1.667 * w;
    flutterDepth_ = 1.484 * w;
    // Drift is excluded from the weighted figure, so it has no calibration to
    // answer to; half the wow depth keeps it audible on a long tail without
    // dominating a short one.
    driftDepth_ = 0.5 * wowDepth_;
  }

  void reset() noexcept {
    wowPhase_ = 0.0;
    flutterPhase_ = 0.0;
    driftState_ = 0.0;
    wowNoise_ = 0.0;
    wowNoiseHp_ = 0.0;
    flutterNoise_ = 0.0;
    flutterNoiseHp_ = 0.0;
  }

  /// One sample of `ε`. Zero at `Wear::Clean`, exactly.
  double next() noexcept {
    if (wowDepth_ <= 0.0) return 0.0;
    const double twoPi = 6.28318530717958647692;
    wowPhase_ += 1.2 / sampleRate_;
    if (wowPhase_ >= 1.0) wowPhase_ -= 1.0;
    flutterPhase_ += 16.0 / sampleRate_;
    if (flutterPhase_ >= 1.0) flutterPhase_ -= 1.0;

    // Band-limited noise: lowpass, then a one-pole highpass built from the
    // difference against a slower lowpass of the same signal.
    const double white = 2.0 * static_cast<double>(rng_.uniform()) - 1.0;
    const double whiteRms = 0.57735026918962576;  // uniform on ±1
    wowNoise_ += wowLp_ * (white / whiteRms - wowNoise_);
    wowNoiseHp_ += wowHp_ * (wowNoise_ - wowNoiseHp_);
    const double wowBand = (wowNoise_ - wowNoiseHp_) * wowGain_;
    flutterNoise_ += flutterLp_ * (white / whiteRms - flutterNoise_);
    flutterNoiseHp_ += flutterHp_ * (flutterNoise_ - flutterNoiseHp_);
    const double flutterBand = (flutterNoise_ - flutterNoiseHp_) * flutterGain_;
    driftState_ += driftLp_ * (white / whiteRms - driftState_);

    const double wow = wowDepth_ * (std::sin(twoPi * wowPhase_) + 0.3 * wowBand);
    const double flutter = flutterDepth_ * (std::sin(twoPi * flutterPhase_) + 0.3 * flutterBand);
    const double drift = driftDepth_ * driftState_ * driftGain_;
    return wow + flutter + drift;
  }

 private:
  double onePole(double hz) const noexcept {
    return 1.0 - std::exp(-6.28318530717958647692 * hz / sampleRate_);
  }
  static double noiseGain(double a) noexcept { return 1.0 / std::sqrt(a / (2.0 - a)); }

  dsp::grain::Rng rng_;
  double sampleRate_ = 48000.0;
  double wowDepth_ = 0.0;
  double flutterDepth_ = 0.0;
  double driftDepth_ = 0.0;
  double driftLp_ = 0.0;
  double wowLp_ = 0.0;
  double wowHp_ = 0.0;
  double flutterLp_ = 0.0;
  double flutterHp_ = 0.0;
  double driftGain_ = 1.0;
  double wowGain_ = 1.0;
  double flutterGain_ = 1.0;
  double wowPhase_ = 0.0;
  double flutterPhase_ = 0.0;
  double driftState_ = 0.0;
  double wowNoise_ = 0.0;
  double wowNoiseHp_ = 0.0;
  double flutterNoise_ = 0.0;
  double flutterNoiseHp_ = 0.0;
};

/// What one tap reads this sample: up to two heads, and how they are mixed.
struct HeadRead {
  double delayA = 0.0;
  double delayB = 0.0;
  double gainA = 1.0;
  double gainB = 0.0;
  bool twoHeads = false;
};

/**
 * One tap's transport: its speed, its history, and its heads.
 *
 * The three time-change modes are three ways of getting from one delay to
 * another, and only one of them touches the speed:
 *
 *  - **Tape** keeps the head spacing `L` and slews the speed toward `L / T`.
 *    The recursion does the rest — the delay arrives at `T` because that is
 *    where `L / v` is, and the pitch bends on the way because `v(t) ≠ v(t − D)`
 *    while it is moving. 250 ms, which §6.2 gives as the default motor slew.
 *  - **Digital** starts a second head at the new delay and crossfades to it over
 *    20 ms, equal power. The speed does not move, so nothing bends.
 *  - **Instant** sets the delay. Documented as a glitch effect, and it is one.
 *
 * `L` is renormalised to `D·s` at every Tape-mode change. That is the identity
 * the recursion preserves — the tape between the heads — so it changes nothing
 * audible, and it keeps `s` from wandering off after a hundred changes in one
 * direction.
 */
class TapTransport {
 public:
  static constexpr int kDecimate = 128;

  void prepare(double sampleRate, double maxDelaySeconds) {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    const int samples = static_cast<int>(sampleRate_ * maxDelaySeconds) + kDecimate;
    ring_.assign(static_cast<std::size_t>(samples / kDecimate + 4), 1.0f);
    slew_ = 1.0 - std::exp(-1.0 / (0.250 * sampleRate_));
    crossfadeSamples_ = static_cast<int>(0.020 * sampleRate_);
    reset(0.25 * sampleRate_);
  }

  void reset(double delaySamples) noexcept {
    speed_ = 1.0;
    speedTarget_ = 1.0;
    delayA_ = delaySamples;
    delayB_ = delaySamples;
    spacing_ = delaySamples;
    crossfading_ = false;
    hasPending_ = false;
    fadePosition_ = 0;
    written_ = 0;
    ringWrite_ = 0;
    for (float& v : ring_) v = 1.0f;
    lastRatio_ = 1.0;
  }

  void setMode(TimeChangeMode mode) noexcept { mode_ = mode; }

  /// The delay is `delayA_`'s steady state, in samples.
  double delaySamples() const noexcept { return delayA_; }
  double speed() const noexcept { return speed_; }
  /// `v[n] / v[n − D]` from the last sample — the instantaneous pitch ratio.
  double pitchRatio() const noexcept { return lastRatio_; }

  /// A new nominal delay, in samples, arriving through whichever mode is set.
  void setDelay(double samples) noexcept {
    const double wanted = samples < 1.0 ? 1.0 : samples;
    switch (mode_) {
      case TimeChangeMode::Tape:
        /*
         * The head spacing is not touched. `L` is the tape between the heads
         * and a machine cannot change it by turning a knob; the new delay is
         * reached by speed alone, and the recursion delivers `L / s` once the
         * speed has settled. The first version renormalised `L` to `D·s` on
         * every call, which is only the invariant *at rest* — mid-slew the tape
         * between the heads was recorded at speeds the current one is not, so
         * `D·s` overstates it, and a knob turned over a second of slew left the
         * delay 9.7 % short of where it was sent (V8 measured it).
         */
        speedTarget_ = spacing_ / wanted;
        break;
      case TimeChangeMode::Digital:
        if (crossfading_) {
          // A change that lands mid-fade waits for the fade to finish rather
          // than restarting it. Restarting put head A back at full gain in one
          // sample — a click per block for as long as a knob was moving, which
          // is exactly when Digital mode promises there will be none. The wait
          // is at most twenty milliseconds, under a knob's own update rate.
          if (std::fabs(wanted - delayB_) < 0.5) return;
          pending_ = wanted;
          hasPending_ = true;
          return;
        }
        if (std::fabs(wanted - delayA_) < 0.5) return;
        delayB_ = wanted;
        crossfading_ = true;
        fadePosition_ = 0;
        break;
      case TimeChangeMode::Instant:
      default:
        delayA_ = wanted;
        spacing_ = wanted * speed_;
        crossfading_ = false;
        break;
    }
  }

  /// Advance one sample with the shared wobble `epsilon`, and say where to read.
  HeadRead advance(double epsilon) noexcept {
    speed_ += (speedTarget_ - speed_) * slew_;
    const double v = (1.0 + epsilon) * speed_;
    if ((written_ % kDecimate) == 0) {
      ring_[static_cast<std::size_t>(ringWrite_)] = static_cast<float>(v);
      ringWrite_ = (ringWrite_ + 1) % static_cast<int>(ring_.size());
    }
    ++written_;

    const double behindA = vBehind(delayA_);
    lastRatio_ = v / behindA;
    delayA_ += 1.0 - lastRatio_;
    if (delayA_ < 1.0) delayA_ = 1.0;

    HeadRead read;
    read.delayA = delayA_;
    if (crossfading_) {
      delayB_ += 1.0 - v / vBehind(delayB_);
      if (delayB_ < 1.0) delayB_ = 1.0;
      // Equal power, so a steady signal stays level through the fade.
      const double t = static_cast<double>(fadePosition_) / crossfadeSamples_;
      const double angle = t * 1.57079632679489661923;
      read.gainA = std::cos(angle);
      read.gainB = std::sin(angle);
      read.delayB = delayB_;
      read.twoHeads = true;
      if (++fadePosition_ >= crossfadeSamples_) {
        delayA_ = delayB_;
        spacing_ = delayA_ * speed_;
        crossfading_ = false;
        if (hasPending_) {
          hasPending_ = false;
          if (std::fabs(pending_ - delayA_) >= 0.5) {
            delayB_ = pending_;
            crossfading_ = true;
            fadePosition_ = 0;
          }
        }
      }
    }
    return read;
  }

 private:
  /// `v` as it was `delay` samples ago, from the decimated history.
  double vBehind(double delay) const noexcept {
    // Position in decimated units, measured back from the most recent write.
    // `written_ - 1` is the current sample and the newest ring entry was taken
    // `sinceWrite` samples before it, so the sample `delay` back from now is
    // `delay - sinceWrite` back from that entry. The first version added the
    // two, which read the history up to 254 samples too early in a sawtooth at
    // the decimation rate — inaudible on the wobble, but it integrated into a
    // delay that settled 0.13 % away from where a tempo change sent it.
    const double sinceWrite = static_cast<double>((written_ - 1) % kDecimate);
    const double behind = delay - sinceWrite;
    const double back = (behind < 0.0 ? 0.0 : behind) / kDecimate;
    const int size = static_cast<int>(ring_.size());
    const int whole = static_cast<int>(back);
    const double frac = back - whole;
    const int newest = (ringWrite_ - 1 + size) % size;
    const int i0 = (newest - whole + size * 4) % size;
    const int i1 = (i0 - 1 + size) % size;
    const double a = static_cast<double>(ring_[static_cast<std::size_t>(i0)]);
    const double b = static_cast<double>(ring_[static_cast<std::size_t>(i1)]);
    const double v = a + (b - a) * frac;
    return v > 1.0e-6 ? v : 1.0e-6;
  }

  std::vector<float> ring_;
  double sampleRate_ = 48000.0;
  double slew_ = 0.0;
  double speed_ = 1.0;
  double speedTarget_ = 1.0;
  double spacing_ = 0.0;
  double delayA_ = 0.0;
  double delayB_ = 0.0;
  double pending_ = 0.0;
  double lastRatio_ = 1.0;
  int crossfadeSamples_ = 960;
  int fadePosition_ = 0;
  int written_ = 0;
  int ringWrite_ = 0;
  bool crossfading_ = false;
  bool hasPending_ = false;
  TimeChangeMode mode_ = TimeChangeMode::Digital;
};

}  // namespace mw::units::delay
