// Motion Wave — halfband cascade oversampling.
//
// `lib-nonlinear.md` §3.5 and §4.6. It wraps a *nonlinear block*, never a whole
// unit: oversampling a linear filter costs CPU for nothing and moves its
// coefficients, and two of the five units are graded on frequency-response
// flatness to ±0.8 dB.
//
// The property the whole design turns on is that **the latency is an exact
// integer**. For a halfband of length L (necessarily L = 4m+3, which is what
// makes every other tap zero) the group delay is (L−1)/2 samples at its own
// upper rate, so interpolating with L_u and decimating with L_d costs
// (L_u + L_d − 2)/4 samples at the input rate — always an integer, since
// L_u + L_d − 2 = 4(m+n) + 4. Nesting adds one condition: an inner stage's
// delay, at its own input rate, must be even for it to be an integer at the
// rate outside it. Both are checked at `prepare`, which returns false rather
// than rounding. A half-sample error is 10 µs at 48 kHz, it combs against the
// dry path, and delay compensation is only ever as correct as the number a node
// reports.
//
// Halfbands are self-complementary, so passband ripple and stopband ripple are
// the same number: designing the first stage for −100 dB stopband gives
// 8.7e−5 dB of passband ripple for free. That matters because the Program EQ's
// flatness test fails at ±0.8 dB and the wrapper must not spend any of it.
#pragma once

#include <cstddef>
#include <cmath>

#include "curve.h"
#include "stage_scratch.h"

namespace mw::dsp::nl {

/// Longest halfband in the shipped cascade. Sized here so nothing allocates.
inline constexpr int kMaxHalfbandTaps = 75;

/// Modified Bessel function of the first kind, order zero — the Kaiser window's
/// only transcendental. The series converges in a dozen terms for the βs used
/// here, and it runs at `prepare` rather than per sample.
inline double besselI0(double x) noexcept {
  double sum = 1.0;
  double term = 1.0;
  for (int k = 1; k < 40; ++k) {
    term *= (x * 0.5) / static_cast<double>(k);
    const double contribution = term * term;
    sum += contribution;
    if (contribution < sum * 1.0e-16) break;
  }
  return sum;
}

/**
 * One halfband filter, as a two-phase FIR.
 *
 * Stored as taps rather than as a closed form because the two phases are used
 * differently: interpolation reads the even and odd tap subsets separately over
 * one history, and decimation reads all of them over the upper-rate history.
 * Writing that twice from a formula would be two chances to get the indexing
 * wrong in a way that only shows up as a fraction of a sample of delay.
 */
class Halfband {
 public:
  /// `length` must be 4m+3. Returns false otherwise, which is what makes the
  /// integer-latency guarantee checkable rather than assumed.
  bool design(int length, double kaiserBeta) noexcept {
    if (length < 3 || length > kMaxHalfbandTaps || (length - 3) % 4 != 0) return false;
    length_ = length;
    const int centre = (length - 1) / 2;
    const double denominator = besselI0(kaiserBeta);
    double sum = 0.0;
    for (int n = 0; n < length; ++n) {
      const double d = static_cast<double>(n - centre);
      // Ideal halfband: a sinc at half the upper Nyquist. Every even offset
      // from the centre lands on a zero of the sinc, which is the property that
      // halves the multiply count and is why the length is constrained.
      const double x = 0.5 * d;
      const double sinc = (n == centre) ? 1.0 : std::sin(3.14159265358979323846 * x) /
                                                    (3.14159265358979323846 * x);
      const double r = 2.0 * static_cast<double>(n) / static_cast<double>(length - 1) - 1.0;
      const double window = besselI0(kaiserBeta * std::sqrt(1.0 - r * r)) / denominator;
      const double h = 0.5 * sinc * window;
      taps_[n] = h;
      sum += h;
    }
    // Normalised to unity DC gain at the upper rate. Without it the window's
    // truncation shows up as a fraction of a decibel of level change that
    // scales with the factor, and a wrapper that changes the level is a wrapper
    // nobody can null against.
    for (int n = 0; n < length; ++n) taps_[n] = static_cast<float>(taps_[n] / sum);
    return true;
  }

  int length() const noexcept { return length_; }
  /// Group delay at the filter's own (upper) rate.
  int groupDelay() const noexcept { return (length_ - 1) / 2; }
  float tap(int n) const noexcept { return static_cast<float>(taps_[n]); }

 private:
  double taps_[kMaxHalfbandTaps] = {0.0};
  int length_ = 3;
};

/**
 * One 2× stage: interpolate on the way in, decimate on the way out.
 *
 * The two filters are separate objects with separate lengths because the
 * cascade's later stages use unequal pairs — a shorter interpolator is enough
 * where the images are already far from the band, and the decimator has to
 * reject what the nonlinearity just created.
 */
class HalfbandStage {
 public:
  bool prepare(int upLength, int downLength, double beta) noexcept {
    if (!up_.design(upLength, beta)) return false;
    if (!down_.design(downLength, beta)) return false;
    reset();
    return true;
  }

  void reset() noexcept {
    for (int i = 0; i < kMaxHalfbandTaps; ++i) {
      upHistory_[i] = 0.0f;
      downHistory_[i] = 0.0f;
    }
    downWrite_ = 0;
  }

  /// Delay of one round trip, at this stage's *input* rate.
  int roundTripDelay() const noexcept { return (up_.length() + down_.length() - 2) / 4; }
  /// The same delay at this stage's *upper* rate, which is what an outer stage
  /// has to be able to halve.
  int roundTripDelayUpper() const noexcept { return up_.groupDelay() + down_.groupDelay(); }

  /// `out` holds 2·frames samples.
  void interpolate(const float* in, float* out, int frames) noexcept {
    const int half = (up_.length() + 1) / 2;
    for (int n = 0; n < frames; ++n) {
      // Shifted rather than circular. The history is at most 38 floats and the
      // shift is a memmove the compiler vectorises; a circular index would cost
      // a modulo in the inner tap loop, which is the loop that matters.
      for (int i = half - 1; i > 0; --i) upHistory_[i] = upHistory_[i - 1];
      upHistory_[0] = in[n];
      float even = 0.0f;
      float odd = 0.0f;
      for (int i = 0; i < half; ++i) {
        const int e = 2 * i;
        const int o = 2 * i + 1;
        if (e < up_.length()) even += up_.tap(e) * upHistory_[i];
        if (o < up_.length()) odd += up_.tap(o) * upHistory_[i];
      }
      // The factor of two is the interpolator's gain: zero-stuffing halves the
      // energy and the filter has unity DC gain, so without it every stage
      // would cost 6 dB.
      out[2 * n] = 2.0f * even;
      out[2 * n + 1] = 2.0f * odd;
    }
  }

  /// `in` holds 2·frames samples.
  void decimate(const float* in, float* out, int frames) noexcept {
    const int length = down_.length();
    for (int n = 0; n < frames; ++n) {
      // The even sample first, then the output, then the odd sample. The order
      // is the whole latency guarantee and it took a measurement to find:
      // reading the filter after *both* samples had been pushed evaluated it at
      // the odd phase, which puts the composite kernel's centre on an odd index
      // of the zero-stuffed lattice — where the interpolator wrote nothing. The
      // round trip then measured 36.5 samples rather than 37, and a peak-index
      // test read 36. Half a sample is 10 µs at 48 kHz and it combs against
      // every dry path in the session; delay compensation cannot fix a number
      // that was never true.
      downHistory_[downWrite_] = in[2 * n];
      downWrite_ = (downWrite_ + 1) % kMaxHalfbandTaps;
      float sum = 0.0f;
      int at = (downWrite_ - 1 + kMaxHalfbandTaps) % kMaxHalfbandTaps;
      for (int j = 0; j < length; ++j) {
        sum += down_.tap(j) * downHistory_[at];
        at = (at - 1 + kMaxHalfbandTaps) % kMaxHalfbandTaps;
      }
      out[n] = flushSmall(sum);
      downHistory_[downWrite_] = in[2 * n + 1];
      downWrite_ = (downWrite_ + 1) % kMaxHalfbandTaps;
    }
  }

 private:
  Halfband up_;
  Halfband down_;
  float upHistory_[kMaxHalfbandTaps] = {0.0f};
  float downHistory_[kMaxHalfbandTaps] = {0.0f};
  int downWrite_ = 0;
};

/// Scratch, in floats, a factor needs for a given block size.
inline std::size_t oversamplerScratchFloats(int factor, int maxFrames) noexcept {
  // Two buffers at the highest rate. Two rather than one because a stage reads
  // its input while writing its output and aliasing them would make the result
  // depend on the direction of the inner loop.
  return static_cast<std::size_t>(2 * factor * maxFrames);
}

/**
 * The wrapper.
 *
 * At `kFactor == 1` this is an exact bypass — the shaper is called on the
 * samples and nothing else happens. Not "a wrapper run at unity": a halfband
 * pair at unity would still truncate the top octave, and the bypass null test
 * asserts −120 dBFS which a truncated octave does not reach.
 */
template <int kFactor>
class Oversampler {
 public:
  static_assert(kFactor == 1 || kFactor == 2 || kFactor == 4 || kFactor == 8,
                "Only power-of-two factors up to 8 have a declared, integer latency.");

  static std::size_t scratchFloats(int maxFrames) noexcept {
    return oversamplerScratchFloats(kFactor, maxFrames);
  }

  bool prepare(double, int maxFrames, StageScratch scratch) noexcept {
    maxFrames_ = maxFrames;
    scratch_ = scratch;
    if (kFactor == 1) {
      latency_ = 0;
      return true;
    }
    if (scratch.data == nullptr || scratch.floats < scratchFloats(maxFrames)) return false;

    // The shipped cascade, §4.6. The first stage is long because it is the one
    // whose transition band sits against the audio band; the later ones work
    // where the images are already far away and can be shorter.
    static constexpr int kUp[3] = {75, 35, 19};
    static constexpr int kDown[3] = {75, 39, 31};
    static constexpr double kBeta[3] = {10.04, 8.0, 8.0};
    stages_ = kFactor == 2 ? 1 : (kFactor == 4 ? 2 : 3);

    latency_ = 0;
    for (int s = 0; s < stages_; ++s) {
      if (!stage_[s].prepare(kUp[s], kDown[s], kBeta[s])) return false;
    }
    // Fold the delays from the innermost stage outwards, halving at each step,
    // and refuse if any halving is not exact. This is the nesting condition:
    // stage 2's delay is measured at 4·fs and has to survive two halvings to
    // reach the host rate as a whole number.
    int accumulated = 0;
    for (int s = stages_ - 1; s >= 0; --s) {
      accumulated += stage_[s].roundTripDelayUpper();
      if (s > 0) {
        if (accumulated % 2 != 0) return false;
        accumulated /= 2;
      }
    }
    if (accumulated % 2 != 0) return false;
    latency_ = accumulated / 2;
    return true;
  }

  void reset() noexcept {
    for (int s = 0; s < stages_; ++s) stage_[s].reset();
  }

  /// Exact, and the number the node reports to the graph's compensation.
  int latencySamples() const noexcept { return latency_; }

  template <typename Shaper>
  void process(const float* in, float* out, int frames, Shaper&& shaper) noexcept {
    if (kFactor == 1) {
      for (int i = 0; i < frames; ++i) out[i] = shaper(in[i]);
      return;
    }
    float* a = scratch_.data;
    float* b = scratch_.data + static_cast<std::size_t>(kFactor) * static_cast<std::size_t>(maxFrames_);

    const float* source = in;
    int count = frames;
    for (int s = 0; s < stages_; ++s) {
      float* destination = (s % 2 == 0) ? a : b;
      stage_[s].interpolate(source, destination, count);
      count *= 2;
      source = destination;
    }
    float* work = const_cast<float*>(source);
    for (int i = 0; i < count; ++i) work[i] = shaper(work[i]);
    for (int s = stages_ - 1; s >= 0; --s) {
      count /= 2;
      float* destination = (s == 0) ? out : ((s % 2 == 0) ? a : b);
      stage_[s].decimate(work, destination, count);
      work = destination;
    }
  }

 private:
  HalfbandStage stage_[3];
  StageScratch scratch_{};
  int maxFrames_ = 0;
  int stages_ = 0;
  int latency_ = 0;
};

}  // namespace mw::dsp::nl
