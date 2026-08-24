// Motion Wave — a recirculating diffusion tank.
//
// **Shared by `fx-02` and `fx-03`, deliberately, because echo density is a
// property of the diffusion architecture and not of the unit.** The Granular
// Reverb's V7 measured 0.9 normalised echo density at 125 ms against its
// sheet's 80 ms, and the Granular Delay would have walked into the same wall
// with the same series chain. `fx-02` §2.3 names the remedy for exactly that
// outcome — "if the series chain measures poorly on echo density (V7), switch
// to the tank" — and this is it, built once.
//
// **Why a series chain cannot get there and this can.** A chain of `n`
// allpasses turns one input echo into `n` output echoes; adding stages adds
// echoes linearly, and each of them is a discrete arrival. Measured, that made
// the reverb *worse*: normalised echo density counts what fraction of a window
// exceeds that window's own standard deviation, and a handful of widely spaced
// arrivals is more impulsive than the signal it replaced, not less. A
// recirculating tank turns one echo into a number that grows *exponentially*
// with time, because every pass around the figure-eight re-diffuses everything
// already in it. That is the whole difference and it is structural.
//
// The figure-eight topology and the principle of mutually prime lengths
// spanning successive orders of magnitude are the published literature's. The
// lengths and the decay law here are ours — see `LEGAL_NOTES.md` on why a
// specific published constant is not the thing to copy.
#pragma once

#include "diffuser.h"

#include <cmath>
#include <cstddef>
#include <vector>

namespace mw::dsp {

/// A plain delay line with its own storage, sized once.
class TankDelay {
 public:
  void prepare(int maxSamples) {
    buffer_.assign(static_cast<std::size_t>(maxSamples < 1 ? 1 : maxSamples), 0.0f);
    length_ = static_cast<int>(buffer_.size());
    write_ = 0;
  }
  void setLength(int samples) noexcept {
    length_ = samples < 1 ? 1 : (samples > static_cast<int>(buffer_.size())
                                     ? static_cast<int>(buffer_.size())
                                     : samples);
    if (write_ >= length_) write_ = 0;
  }
  void reset() noexcept {
    for (float& v : buffer_) v = 0.0f;
    write_ = 0;
  }
  float process(float x) noexcept {
    const float out = buffer_[static_cast<std::size_t>(write_)];
    buffer_[static_cast<std::size_t>(write_)] = x;
    if (++write_ >= length_) write_ = 0;
    return out;
  }
  /// A tap inside the line, which is what makes one pass produce many arrivals.
  float tap(int back) const noexcept {
    int at = write_ - back;
    while (at < 0) at += length_;
    return buffer_[static_cast<std::size_t>(at % length_)];
  }

 private:
  std::vector<float> buffer_;
  int length_ = 1;
  int write_ = 0;
};

/**
 * Two halves in a figure-eight, each half diffusing and delaying, each feeding
 * the other.
 *
 * The decay gain is set from a settling time rather than given directly,
 * because what a caller wants to say is "be dense within this long" and the
 * gain that achieves it depends on how long one lap takes. Setting the gain
 * directly is how a tank ends up with a tail of its own that nobody asked for:
 * a diffuser is supposed to smear an arrival, not add a second reverb behind
 * the first.
 */
class DiffusionTank {
 public:
  static constexpr int kStagesPerHalf = 2;
  static constexpr int kTapsPerHalf = 4;

  void prepare(double sampleRate) {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    // Fifty milliseconds per element, which bounds one lap at about 0.1 s and
    // is what the settling law below is written against.
    // Eight milliseconds per element, which is comfortably past the longest
    // above and is what bounds one lap at about 4 ms.
    const int maxSamples = static_cast<int>(sampleRate_ * 0.008) + 4;
    for (int half = 0; half < 2; ++half) {
      for (int s = 0; s < kStagesPerHalf; ++s) allpass_[half][s].prepare(maxSamples);
      delay_[half].prepare(maxSamples);
    }
    setLengths();
    setSettleSeconds(settleSeconds_);
    reset();
  }

  void reset() noexcept {
    for (int half = 0; half < 2; ++half) {
      for (int s = 0; s < kStagesPerHalf; ++s) allpass_[half][s].reset();
      delay_[half].reset();
      state_[half] = 0.0f;
    }
  }

  /**
   * How long the tank takes to fall 60 dB, which is what bounds its own tail.
   *
   * A tank whose settling time is comparable to the reverb around it would be a
   * second reverb in series, and its decay would add to the one the Decay
   * control sets — which is the failure mode that makes "just add a tank" the
   * wrong instruction and "add a tank that settles in 80 ms" the right one.
   */
  void setSettleSeconds(double seconds) noexcept {
    settleSeconds_ = seconds < 0.010 ? 0.010 : (seconds > 0.500 ? 0.500 : seconds);
    // One lap is both halves' delays; the gain per lap that gives −60 dB in
    // `settleSeconds` follows directly rather than being chosen by ear.
    const double lapSeconds =
        static_cast<double>(lapSamples_) / (sampleRate_ > 0.0 ? sampleRate_ : 48000.0);
    const double laps = lapSeconds > 0.0 ? settleSeconds_ / lapSeconds : 1.0;
    const double gain = laps > 0.0 ? std::pow(10.0, -3.0 / laps) : 0.0;
    decay_ = static_cast<float>(gain > 0.95 ? 0.95 : gain);
  }

  /// Nought to one, mapped to the allpass coefficient the halves diffuse with.
  void setAmount(double amount) noexcept {
    const double a = amount < 0.0 ? 0.0 : (amount > 1.0 ? 1.0 : amount);
    // 0.7 at full, which is the value a Schroeder allpass is flattest at and
    // the top of the range `fx-02` §2.3 gives its own chain.
    const float g = static_cast<float>(0.7 * a);
    for (int half = 0; half < 2; ++half) {
      for (int s = 0; s < kStagesPerHalf; ++s) allpass_[half][s].setGain(g);
    }
  }

  /**
   * One sample in, one stereo pair out.
   *
   * The output is a sum of taps taken *inside* the delays rather than at their
   * ends, which is what turns one lap into several arrivals instead of one.
   * Taking only the end would make the tank's output as sparse as its lap time,
   * which is the thing it exists not to be.
   */
  void process(float inL, float inR, float* outL, float* outR) noexcept {
    float carried[2] = {inL + decay_ * state_[1], inR + decay_ * state_[0]};
    for (int half = 0; half < 2; ++half) {
      float v = carried[half];
      for (int s = 0; s < kStagesPerHalf; ++s) v = allpass_[half][s].process(v);
      state_[half] = delay_[half].process(v);
    }
    // Four taps per half at unequal spacings, so the two channels' arrival
    // patterns differ and the pair is decorrelated rather than duplicated.
    float left = 0.0f;
    float right = 0.0f;
    for (int t = 0; t < kTapsPerHalf; ++t) {
      left += delay_[0].tap(tapAt_[0][t]);
      right += delay_[1].tap(tapAt_[1][t]);
    }
    const float scale = 1.0f / static_cast<float>(kTapsPerHalf);
    *outL = left * scale;
    *outR = right * scale;
  }

 private:
  void setLengths() noexcept {
    // Ours. Mutually prime in samples after scaling, spanning a range rather
    // than clustering, which is the principle the literature states; the values
    // are not anyone's published set.
    /*
     * **Milliseconds, and the first version of this used tens of them.**
     *
     * Density buildup *is* recirculation: the tank turns one echo into many
     * because every lap re-diffuses what is already circulating, so the number
     * of laps inside the settling time is the whole mechanism. With 23 and 31 ms
     * delays a lap is 54 ms, so an 80 ms settling time allows one and a half
     * laps — and the decay gain that produces settles it in 1.5 laps by making
     * it 0.009, which is a tank that does not recirculate at all. Measured that
     * way it reached 0.9 echo density at 753 ms, *worse* than the series chain
     * it was meant to replace, because averaging four taps of a long line
     * smooths rather than multiplies.
     *
     * A 4 ms lap gives twenty laps inside 80 ms and a decay of about 0.71,
     * which recirculates properly. §2.3 says this in words — the allpass chain
     * "diffuses on the scale of *milliseconds*" — and the arithmetic is what
     * makes it a length rather than a sentiment.
     */
    static constexpr double kAllpassMs[2][kStagesPerHalf] = {{0.61, 1.39}, {0.83, 1.73}};
    static constexpr double kDelayMs[2] = {1.87, 2.29};
    /*
     * **The lap is everything in the loop, allpasses included.**
     *
     * Counting only the two delay lines made the measured settling time 2.10
     * times the asked one, at every setting — a constant factor, which is the
     * signature of a term left out of a derivation rather than of a law that is
     * wrong. The allpasses sit in the lap path and their lengths sum to exactly
     * that factor: 4.16 ms of delay lines against 8.72 ms of everything. A
     * Schroeder allpass is magnitude-flat, so it takes nothing out of the lap's
     * *gain* — but it is still time the signal spends going round, which is
     * what the settling law is counting.
     */
    lapSamples_ = 0;
    for (int half = 0; half < 2; ++half) {
      for (int s = 0; s < kStagesPerHalf; ++s) {
        const int stage = primeAtLeast(samplesFor(kAllpassMs[half][s]));
        allpass_[half][s].setLength(stage);
        lapSamples_ += stage;
      }
      const int length = primeAtLeast(samplesFor(kDelayMs[half]));
      delay_[half].setLength(length);
      lapSamples_ += length;
      // Taps spread through the line rather than bunched at its end.
      for (int t = 0; t < kTapsPerHalf; ++t) {
        tapAt_[half][t] = 1 + (length - 2) * (t + 1) / (kTapsPerHalf + 1);
      }
    }
  }

  int samplesFor(double milliseconds) const noexcept {
    return static_cast<int>(milliseconds * 0.001 * sampleRate_ + 0.5);
  }

  /// The scaling can make two lengths share a factor again, so they are
  /// re-primed after it rather than assumed to have stayed coprime.
  static int primeAtLeast(int candidate) noexcept {
    int n = candidate < 2 ? 2 : candidate;
    for (;; ++n) {
      bool prime = true;
      for (int d = 2; d * d <= n; ++d) {
        if (n % d == 0) {
          prime = false;
          break;
        }
      }
      if (prime) return n;
    }
  }

  double sampleRate_ = 48000.0;
  double settleSeconds_ = 0.080;
  int lapSamples_ = 1;
  float decay_ = 0.5f;
  float state_[2] = {0.0f, 0.0f};
  int tapAt_[2][kTapsPerHalf] = {{1, 2, 3, 4}, {1, 2, 3, 4}};
  SchroederAllpass allpass_[2][kStagesPerHalf];
  TankDelay delay_[2];
};

}  // namespace mw::dsp
