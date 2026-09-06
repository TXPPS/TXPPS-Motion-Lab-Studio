// Motion Wave — what the Granular Delay's suites share.
//
// `fx-03` §9 has sixteen rows and the ledger adds twelve cells, and by the third
// file each of them was about to carry its own copy of the render loop, the
// plain-tap base and the tone measurements. Three copies of a measurement is
// the drift the manifests exist to prevent, one level up — the first copy to
// gain a fix leaves the others quietly weaker — so the shared parts are here
// and each suite keeps only what is genuinely its own.
#pragma once

#include "../units/granular_delay.h"
#include "harness.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <utility>
#include <vector>

namespace mw::test::fx03 {

constexpr double kPi = 3.14159265358979323846;
constexpr double kRate = 48000.0;
constexpr int kBlock = 256;

struct Rendered {
  std::vector<float> left;
  std::vector<float> right;
};

/**
 * Drive the unit `frames` samples from `source(index) -> {left, right}`.
 *
 * `onBlock(blockIndex)` runs before each block is processed, which is how a row
 * moves a control mid-render the way a host does: once per block, never
 * mid-block.
 */
template <typename Source, typename OnBlock>
Rendered renderWith(units::GranularDelay& unit, int frames, Source&& source, OnBlock&& onBlock,
                    double rate = kRate, int blockSize = kBlock) {
  const std::size_t span = static_cast<std::size_t>(blockSize);
  std::vector<float> l(span, 0.0f);
  std::vector<float> r(span, 0.0f);
  std::vector<float> ol(span, 0.0f);
  std::vector<float> orr(span, 0.0f);
  float* ch[2] = {l.data(), r.data()};
  float* och[2] = {ol.data(), orr.data()};
  Rendered out;
  out.left.reserve(static_cast<std::size_t>(frames));
  out.right.reserve(static_cast<std::size_t>(frames));
  int block = 0;
  for (int at = 0; at < frames; at += blockSize, ++block) {
    const int n = std::min(blockSize, frames - at);
    onBlock(block);
    for (int i = 0; i < n; ++i) {
      const std::pair<float, float> v = source(at + i);
      l[static_cast<std::size_t>(i)] = v.first;
      r[static_cast<std::size_t>(i)] = v.second;
    }
    AudioBuffer in(ch, 2, n);
    AudioBuffer buffer(och, 2, n);
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &buffer;
    ctx.outputCount = 1;
    ctx.frames = n;
    ctx.sampleRate = rate;
    ctx.playing = true;
    unit.process(ctx);
    for (int i = 0; i < n; ++i) {
      out.left.push_back(ol[static_cast<std::size_t>(i)]);
      out.right.push_back(orr[static_cast<std::size_t>(i)]);
    }
  }
  return out;
}

template <typename Source>
Rendered render(units::GranularDelay& unit, int frames, Source&& source, double rate = kRate,
                int blockSize = kBlock) {
  return renderWith(unit, frames, std::forward<Source>(source), [](int) {}, rate, blockSize);
}

/**
 * The plain base every row starts from: one tap at 250 ms of free time, fully
 * wet, no feedback, Clean, Digital time changes, Smear zero.
 *
 * Free time throughout, because §7.1's sync switch defaults to on and would
 * replace the seconds a row states with an eighth note. Rows that need the
 * sync table switch it back on themselves and say so.
 */
inline void configure(units::GranularDelay& unit, double rate = kRate, int blockSize = kBlock) {
  unit.prepare(rate, blockSize);
  unit.setMix(1.0);
  unit.setTapCount(1);
  unit.setSync(false);
  units::TapSettings tap;
  tap.delaySeconds = 0.250;
  tap.level = 1.0;
  unit.setTap(0, tap);
  unit.setFeedbackTapSeconds(0.250);
  unit.setFeedback(0.0);
  unit.setLoopLowpass(18000.0);
  unit.setLoopHighpass(20.0);
  unit.setSmear(0.0);
  unit.setCharacter(units::delay::Character::Clean);
  unit.setTimeChangeMode(units::delay::TimeChangeMode::Digital);
  unit.setQuality(units::delay::Quality::High);
  unit.reset();
}

inline double dbOf(double amplitude) {
  return amplitude <= 1.0e-12 ? -240.0 : 20.0 * std::log10(amplitude);
}

inline double rmsOf(const std::vector<float>& v, std::size_t from, std::size_t count) {
  double sum = 0.0;
  const std::size_t end = std::min(v.size(), from + count);
  for (std::size_t i = from; i < end; ++i) sum += static_cast<double>(v[i]) * static_cast<double>(v[i]);
  const std::size_t n = end > from ? end - from : 1;
  return std::sqrt(sum / static_cast<double>(n));
}

/// A mono tone at `hz`, on both channels.
struct Tone {
  double hz;
  double amplitude;
  double rate = kRate;
  std::pair<float, float> operator()(int index) const {
    const float v = static_cast<float>(
        amplitude * std::sin(2.0 * kPi * hz * static_cast<double>(index) / rate));
    return {v, v};
  }
};

/**
 * The peak amplitude of a sine at `hz` in `v[from, from + count)`, in dBFS.
 *
 * Goertzel under a Hann window. The window is what makes a product a few
 * hundred hertz from a −6 dBFS carrier measurable: a rectangular window over a
 * span that is not a whole number of the carrier's cycles leaks the carrier
 * across the whole spectrum at about −40 dB, which is exactly the level V12
 * asks about. Hann's coherent gain is one half, hence the four.
 */
inline double toneLevelDb(const std::vector<float>& v, double hz, double rate, std::size_t from,
                          std::size_t count) {
  const double w = 2.0 * kPi * hz / rate;
  const double coeff = 2.0 * std::cos(w);
  double s1 = 0.0;
  double s2 = 0.0;
  for (std::size_t i = 0; i < count; ++i) {
    const double hann = 0.5 - 0.5 * std::cos(2.0 * kPi * static_cast<double>(i) /
                                              static_cast<double>(count));
    const double x = static_cast<double>(v[from + i]) * hann;
    const double s0 = x + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const double re = s1 - s2 * std::cos(w);
  const double im = s2 * std::sin(w);
  const double amplitude = 4.0 * std::sqrt(re * re + im * im) / static_cast<double>(count);
  return dbOf(amplitude);
}

/**
 * Where a signal's positive-going zero crossings fall, in samples, with the
 * crossing instant interpolated between the two samples around it.
 *
 * Linear interpolation on a sine sampled forty-eight times per cycle places
 * the crossing to about a ten-thousandth of a sample, which is all V8 needs:
 * its two-cent tolerance is a part in eight hundred and sixty of a cycle.
 */
inline std::vector<double> risingCrossings(const std::vector<float>& v, std::size_t from,
                                           std::size_t count) {
  std::vector<double> out;
  const std::size_t end = std::min(v.size(), from + count);
  for (std::size_t i = from + 1; i < end; ++i) {
    const double a = static_cast<double>(v[i - 1]);
    const double b = static_cast<double>(v[i]);
    if (a < 0.0 && b >= 0.0) {
      out.push_back(static_cast<double>(i - 1) + a / (a - b));
    }
  }
  return out;
}

/**
 * The phase of a sine, in cycles, at sample `at`, read off its crossings.
 *
 * Between two crossings the phase is taken to advance linearly, which over one
 * cycle of a tone whose frequency moves by parts in a thousand is exact to the
 * same order.
 */
inline double phaseCyclesAt(const std::vector<double>& crossings, double at) {
  if (crossings.size() < 2) return 0.0;
  std::size_t k = 0;
  while (k + 2 < crossings.size() && crossings[k + 1] <= at) ++k;
  const double t0 = crossings[k];
  const double t1 = crossings[k + 1];
  return static_cast<double>(k) + (at - t0) / (t1 - t0);
}

/// The least-squares line through `n` points, and how well it fits.
struct LinearFit {
  double slope = 0.0;
  double intercept = 0.0;
  double rSquared = 0.0;
};

inline LinearFit fitLine(const double* x, const double* y, int n) {
  double sumX = 0.0;
  double sumY = 0.0;
  for (int i = 0; i < n; ++i) {
    sumX += x[i];
    sumY += y[i];
  }
  const double meanX = sumX / n;
  const double meanY = sumY / n;
  double sxy = 0.0;
  double sxx = 0.0;
  for (int i = 0; i < n; ++i) {
    sxy += (x[i] - meanX) * (y[i] - meanY);
    sxx += (x[i] - meanX) * (x[i] - meanX);
  }
  LinearFit fit;
  fit.slope = sxx > 0.0 ? sxy / sxx : 0.0;
  fit.intercept = meanY - fit.slope * meanX;
  double residual = 0.0;
  double total = 0.0;
  for (int i = 0; i < n; ++i) {
    const double predicted = fit.intercept + fit.slope * x[i];
    residual += (y[i] - predicted) * (y[i] - predicted);
    total += (y[i] - meanY) * (y[i] - meanY);
  }
  fit.rSquared = total > 0.0 ? 1.0 - residual / total : 0.0;
  return fit;
}

/// Where an impulse fed at sample zero comes out loudest, searching from `from`.
inline int peakIndex(const std::vector<float>& v, std::size_t from) {
  int best = -1;
  double top = 0.0;
  for (std::size_t i = from; i < v.size(); ++i) {
    const double a = std::fabs(static_cast<double>(v[i]));
    if (a > top) {
      top = a;
      best = static_cast<int>(i);
    }
  }
  return best;
}

}  // namespace mw::test::fx03
