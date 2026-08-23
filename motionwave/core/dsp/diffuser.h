// Motion Wave — Schroeder allpass diffusion.
//
// `fx-02` §2.3 wants two diffusion mechanisms because they act on different
// timescales: grain spray diffuses on the scale of the size window, and a chain
// of allpasses diffuses on the scale of a few milliseconds. Neither substitutes
// for the other — spray alone leaves each grain's own attack intact, and
// allpasses alone leave the echo pattern of the read offsets.
#pragma once

#include <cstddef>
#include <vector>

namespace mw::dsp {

/**
 * One Schroeder allpass: `y = -g·x + z + g·y_delayed`, magnitude-flat by
 * construction.
 *
 * The delay owns its own storage, sized at `prepare` and never after. A
 * diffuser that resized when its time changed would allocate on the audio
 * thread the first time a user moved the control.
 */
class SchroederAllpass {
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

  void setGain(float gain) noexcept {
    // Held short of one: at unity the allpass is a pure resonator and the loop
    // it sits in stops decaying.
    gain_ = gain < -0.95f ? -0.95f : (gain > 0.95f ? 0.95f : gain);
  }

  void reset() noexcept {
    for (float& v : buffer_) v = 0.0f;
    write_ = 0;
  }

  float process(float x) noexcept {
    const float delayed = buffer_[static_cast<std::size_t>(write_)];
    const float v = x + gain_ * delayed;
    buffer_[static_cast<std::size_t>(write_)] = v;
    if (++write_ >= length_) write_ = 0;
    return delayed - gain_ * v;
  }

 private:
  std::vector<float> buffer_;
  int length_ = 1;
  int write_ = 0;
  float gain_ = 0.7f;
};

/**
 * Four of them in series, at mutually prime lengths.
 *
 * Mutually prime because two allpasses whose lengths share a factor reinforce
 * each other's periodicity, and the chain then rings at the common period
 * instead of dispersing — which is audible as a pitched twang on transients and
 * is the classic way a diffuser stops diffusing.
 */
class Diffuser {
 public:
  static constexpr int kStages = 4;

  void prepare(double sampleRate) {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    // Fifty milliseconds is §2.3's upper bound, so that is what each stage is
    // sized for once and for all.
    const int maxSamples = static_cast<int>(sampleRate_ * 0.050) + 4;
    for (int i = 0; i < kStages; ++i) stage_[i].prepare(maxSamples);
    setAmount(0.7f);
  }

  /**
   * One control for the whole chain: the times spread across §2.3's 5–50 ms
   * band and the gain rises with it.
   *
   * The primes are chosen at 48 kHz and scaled by the rate; the scaling can
   * make two of them share a factor again, so they are re-primed after scaling
   * rather than assumed.
   */
  void setAmount(float amount) noexcept {
    amount_ = amount < 0.0f ? 0.0f : (amount > 1.0f ? 1.0f : amount);
    static constexpr double kMilliseconds[kStages] = {5.3, 11.7, 23.9, 43.1};
    for (int i = 0; i < kStages; ++i) {
      const double scale = 0.35 + 0.65 * static_cast<double>(amount_);
      int samples = static_cast<int>(kMilliseconds[i] * 0.001 * sampleRate_ * scale + 0.5);
      samples = nextPrimeAtLeast(samples);
      stage_[i].setLength(samples);
      stage_[i].setGain(0.35f + 0.35f * amount_);
    }
  }

  void reset() noexcept {
    for (int i = 0; i < kStages; ++i) stage_[i].reset();
  }

  float process(float x) noexcept {
    float y = x;
    for (int i = 0; i < kStages; ++i) y = stage_[i].process(y);
    return y;
  }

 private:
  static int nextPrimeAtLeast(int n) noexcept {
    if (n < 2) return 2;
    for (int candidate = n;; ++candidate) {
      bool prime = true;
      for (int d = 2; d * d <= candidate; ++d) {
        if (candidate % d == 0) {
          prime = false;
          break;
        }
      }
      if (prime) return candidate;
    }
  }

  SchroederAllpass stage_[kStages];
  double sampleRate_ = 48000.0;
  float amount_ = 0.7f;
};

}  // namespace mw::dsp
