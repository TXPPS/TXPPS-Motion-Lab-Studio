// Motion Wave — measuring a reverberation time, once, for every unit that has
// a feedback loop.
//
// `fx-02` §9 V5 and V11 and `fx-03`'s feedback rows all grade a decay, and a
// decay measured badly is worse than not measured: it produces a number with a
// tolerance beside it and no relationship to the thing it names. The first
// attempt at V5 was calibrated against measurements that varied by a factor of
// four, and the calibration broke when an unrelated change moved the spawn RNG
// stream.
//
// So the method is fixed here and used by every consumer:
//
//  1. **Interrupted noise, ISO 3382's method.** Steady-state broadband noise
//     until the loop settles, then a hard cut. The impulse method's variance is
//     a property of the *probe*, not of the reverb — whether a grain happens to
//     catch the impulse decides how much energy enters the loop at all. At the
//     cut, every grain slot is populated with equal expected energy, so the
//     lottery never happens.
//  2. **Schroeder backward integration** of the squared decay, not an envelope
//     fit. The instantaneous envelope of a granular tail is noisy and a
//     least-squares line through it follows whichever grains were loudest.
//  3. **T30**, fitted from −5 to −35 dB and extrapolated. A full 60 dB span is
//     noise-limited even in a deterministic system.
//  4. **An ensemble over independent seeds.** Starting phases are not
//     independent samples — they resample the stimulus while leaving the engine
//     on one stream — which is why sixteen of them gave a worse answer than
//     eight. Different seeds, nothing else.
//  5. **Mean and a 95 % confidence interval**, and a row passes only if the
//     whole interval is inside tolerance. A mean that happens to land while its
//     interval straddles the limit has not demonstrated anything.
//
// And before any of that is believed, `verifyAgainstReference` runs the method
// against a plain feedback delay line whose RT60 follows analytically from its
// gain. If the harness cannot reproduce that, no reverb number it produces is
// worth reading.
#pragma once

#include "harness.h"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>

namespace mw::test {

struct DecayEstimate {
  double mean = 0.0;
  double standardDeviation = 0.0;
  /// Half-width of the 95 % interval on the mean.
  double confidence = 0.0;
  int samples = 0;

  double low() const { return mean - confidence; }
  double high() const { return mean + confidence; }
  /// True when the *whole* interval sits inside a relative tolerance of the
  /// target — not merely the mean.
  bool within(double target, double relativeTolerance) const {
    const double band = target * relativeTolerance;
    return samples > 1 && low() >= target - band && high() <= target + band;
  }
};

/**
 * T30 from one decay curve, by Schroeder backward integration.
 *
 * `energyPerBlock` is the mean square of each block *after* the excitation
 * stopped. Returns a negative number when the curve never reaches −35 dB, which
 * a caller must treat as a missing sample rather than as a zero.
 */
inline double t30From(const std::vector<double>& energyPerBlock, double blockSeconds) {
  const std::size_t n = energyPerBlock.size();
  if (n < 4) return -1.0;
  std::vector<double> integrated(n, 0.0);
  double running = 0.0;
  for (std::size_t i = n; i-- > 0;) {
    running += energyPerBlock[i];
    integrated[i] = running;
  }
  if (integrated[0] <= 0.0) return -1.0;
  const double reference = integrated[0];
  std::size_t from = 0;
  std::size_t to = 0;
  for (std::size_t i = 0; i < n; ++i) {
    const double level = 10.0 * std::log10(integrated[i] / reference);
    if (from == 0 && level <= -5.0) from = i;
    if (from != 0 && level <= -35.0) {
      to = i;
      break;
    }
  }
  if (from == 0 || to <= from) return -1.0;
  const double levelFrom = 10.0 * std::log10(integrated[from] / reference);
  const double levelTo = 10.0 * std::log10(integrated[to] / reference);
  const double seconds = static_cast<double>(to - from) * blockSeconds;
  const double slope = (levelTo - levelFrom) / seconds;
  if (slope >= 0.0) return -1.0;
  // Extrapolated from the fitted 30 dB span to a full 60.
  return -60.0 / slope;
}

/*
 * The k'th member of an ensemble.
 *
 * Every row that averages over seeds draws them from this one sequence, so a
 * disagreement between two rows is a disagreement about the engine rather than
 * about which corner of the seed space each happened to sample. The odd
 * constants are the golden ratio and the FNV prime; any full-period odd
 * multiplier would do, and these two are simply the ones already in `rng.h`.
 *
 * The suffix is deliberate. Written `ull` the literals are `unsigned long long`
 * and promote `std::uint64_t` past its own width on LP64, which `-Wsign-conversion`
 * reports and `-Werror` then rejects.
 */
inline constexpr std::uint64_t seedAt(int k) noexcept {
  return std::uint64_t{0x9E3779B97F4A7C15} +
         static_cast<std::uint64_t>(k) * std::uint64_t{0x100000001B3};
}

/*
 * Student's two-sided 95 % quantile for `df` degrees of freedom.
 *
 * The normal quantile 1.96 is what a large ensemble converges to, and using it
 * at every size quietly understates the interval when the ensemble is small —
 * at eight samples the true multiplier is 2.365, so an interval computed at
 * 1.96 is 17 % narrower than it should be. That is the wrong direction for a
 * criterion that passes a row only when the whole interval is inside tolerance:
 * it would let a row pass on an interval that was never really that tight.
 * The table is exact to three decimals up to 30 and falls back to the normal
 * limit beyond, where the difference no longer reaches the third decimal.
 */
inline double tQuantile95(int df) noexcept {
  static constexpr double kTable[31] = {
      0.0,    12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
      2.201,  2.179,  2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080,
      2.074,  2.069,  2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042};
  if (df < 1) return kTable[1];
  if (df <= 30) return kTable[df];
  return 1.96;
}

/// Combine an ensemble of T30 readings into a mean and a 95 % interval.
inline DecayEstimate summarise(const std::vector<double>& readings) {
  DecayEstimate out;
  double sum = 0.0;
  for (double v : readings) {
    if (v <= 0.0) continue;
    sum += v;
    ++out.samples;
  }
  if (out.samples == 0) return out;
  out.mean = sum / out.samples;
  if (out.samples < 2) return out;
  double variance = 0.0;
  for (double v : readings) {
    if (v <= 0.0) continue;
    const double d = v - out.mean;
    variance += d * d;
  }
  out.standardDeviation = std::sqrt(variance / (out.samples - 1));
  // Student's quantile rather than the normal one, so an ensemble smaller than
  // the thirty this method asks for still reports an interval it can defend.
  out.confidence = tQuantile95(out.samples - 1) * out.standardDeviation /
                   std::sqrt(static_cast<double>(out.samples));
  return out;
}

/**
 * A plain feedback delay line: the reference the instrument is checked against.
 *
 * Its reverberation time follows analytically from the loop, `RT60 = −3t /
 * log10(g)`, with no stochastic anything — so if the harness cannot recover
 * that, the harness is what is wrong.
 */
class ReferenceLoop {
 public:
  void prepare(double sampleRate, double delaySeconds, double gain) {
    buffer_.assign(static_cast<std::size_t>(sampleRate * delaySeconds) + 1, 0.0f);
    write_ = 0;
    gain_ = gain;
  }

  float process(float x) noexcept {
    const float delayed = buffer_[static_cast<std::size_t>(write_)];
    buffer_[static_cast<std::size_t>(write_)] = x + delayed * static_cast<float>(gain_);
    if (++write_ >= static_cast<int>(buffer_.size())) write_ = 0;
    return delayed;
  }

  static double analyticRt60(double delaySeconds, double gain) {
    return -3.0 * delaySeconds / std::log10(gain);
  }

 private:
  std::vector<float> buffer_;
  int write_ = 0;
  double gain_ = 0.5;
};

/**
 * Run the whole method against the reference loop and report.
 *
 * This is step zero of any decay row: an instrument that cannot measure a known
 * answer is not measuring an unknown one either.
 */
inline bool verifyAgainstReference(double sampleRate, int blockSize) {
  constexpr double kDelays[3] = {0.050, 0.120, 0.250};
  constexpr double kGains[3] = {0.70, 0.90, 0.97};
  bool allGood = true;
  for (int c = 0; c < 3; ++c) {
    ReferenceLoop loop;
    loop.prepare(sampleRate, kDelays[c], kGains[c]);
    const double expected = ReferenceLoop::analyticRt60(kDelays[c], kGains[c]);

    std::uint32_t state = 0x13579BDFu;
    const int driveBlocks = static_cast<int>(sampleRate * (expected * 2.0 + 1.0) / blockSize);
    for (int b = 0; b < driveBlocks; ++b) {
      for (int i = 0; i < blockSize; ++i) {
        state = state * 1664525u + 1013904223u;
        loop.process((static_cast<float>(state >> 8) / 8388608.0f - 1.0f) * 0.3f);
      }
    }
    const int tailBlocks = static_cast<int>(sampleRate * (expected * 2.0 + 0.5) / blockSize);
    std::vector<double> energy;
    energy.reserve(static_cast<std::size_t>(tailBlocks));
    for (int b = 0; b < tailBlocks; ++b) {
      double sum = 0.0;
      for (int i = 0; i < blockSize; ++i) {
        const double v = static_cast<double>(loop.process(0.0f));
        sum += v * v;
      }
      energy.push_back(sum / blockSize);
    }
    const double measured = t30From(energy, static_cast<double>(blockSize) / sampleRate);
    const double error = measured > 0.0 ? 100.0 * (measured / expected - 1.0) : 0.0;
    std::printf("    instrument: delay %.0f ms gain %.2f — analytic %.3f s, measured %.3f s"
                " (%+.2f %%)\n",
                kDelays[c] * 1000.0, kGains[c], expected, measured, error);
    if (measured <= 0.0 || std::fabs(error) > 3.0) allGood = false;
  }
  return allGood;
}

}  // namespace mw::test
