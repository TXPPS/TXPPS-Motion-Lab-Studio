// Motion Wave — the measurements every import stage shares.
//
// RMS over a span, a sliding 1 ms envelope, zero crossings, a Hann window, a
// spectral centroid, a percentile, a median and a normalised correlation. Each
// is here once so that §3.2's gate, §3.3's refinement, §3.5's loop search and
// §3.6's slice fades all mean the same thing by "1 ms RMS" and "zero crossing".
// Two stages measuring the same quantity two ways is how an onset lands on a
// different sample from the slice that starts there.
//
// Everything is double and allocates freely: the importer runs off the audio
// thread, once, at load (§3), and a float envelope of a −80 dBFS noise floor
// would be quantised by the very thing it is trying to measure.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <vector>

#include "../fft.h"

namespace mw::dsp::sample {

constexpr double kPi = 3.14159265358979323846;

/// −200 dB stands in for silence so a dB value is always a number a comparison
/// can order. A −inf that reached the percentile sort would be a NaN in
/// disguise the moment anything added to it.
constexpr double kSilenceDb = -200.0;

inline double toDb(double amplitude) {
  return amplitude > 0.0 ? 20.0 * std::log10(amplitude) : kSilenceDb;
}

inline double fromDb(double db) { return std::pow(10.0, db / 20.0); }

/// Milliseconds to frames, never below one: a window of zero frames is a
/// division by zero in every RMS below.
inline std::size_t framesFor(double ms, double rate) {
  const double f = std::round(ms * 1.0e-3 * rate);
  return f < 1.0 ? std::size_t{1} : static_cast<std::size_t>(f);
}

inline double rmsOver(const std::vector<double>& x, std::size_t begin, std::size_t end) {
  if (end > x.size()) end = x.size();
  if (begin >= end) return 0.0;
  double sum = 0.0;
  for (std::size_t i = begin; i < end; ++i) sum += x[i] * x[i];
  return std::sqrt(sum / static_cast<double>(end - begin));
}

/**
 * RMS of the window [n, n + w) for every n in [0, len − w].
 *
 * Computed directly rather than from a prefix sum of squares. A prefix sum
 * over a full-scale file is of order 1e6, and the difference of two such sums
 * across a −100 dBFS region is 1e-9 — inside the sum's own rounding, so the
 * envelope of the quiet region would be rounding noise, and the quiet region
 * is exactly where the onset refinement looks. The direct form costs w
 * multiplies per sample and w is 44 here.
 */
inline std::vector<double> slidingRms(const std::vector<double>& x, std::size_t w) {
  std::vector<double> out;
  if (w == 0 || x.size() < w) return out;
  out.resize(x.size() - w + 1);
  for (std::size_t n = 0; n < out.size(); ++n) out[n] = rmsOver(x, n, n + w);
  return out;
}

/// Non-overlapping frames of `w` over [begin, end). A final partial frame is
/// kept: dropping it would let a file end 19 ms after its last measured frame
/// and the tail trim would then miss the tail.
inline std::vector<double> frameRms(const std::vector<double>& x, std::size_t begin,
                                    std::size_t end, std::size_t w) {
  std::vector<double> out;
  if (w == 0) return out;
  for (std::size_t n = begin; n < end; n += w) out.push_back(rmsOver(x, n, std::min(n + w, end)));
  return out;
}

/**
 * The first index n in [from, limit) that is a zero crossing: x[n] is exactly
 * zero, or x[n] and x[n + 1] differ in sign, in which case the sample nearer
 * zero is returned. Returns `limit` when there is none.
 *
 * Exact zero counts because digital silence has no sign changes at all, and a
 * search that could not stop in silence would run on into the attack it was
 * meant to stay in front of.
 */
inline std::size_t zeroCrossingFrom(const std::vector<double>& x, std::size_t from,
                                    std::size_t limit) {
  limit = std::min(limit, x.size());
  for (std::size_t n = from; n < limit; ++n) {
    if (x[n] == 0.0) return n;
    if (n + 1 < x.size() && ((x[n] < 0.0) != (x[n + 1] < 0.0))) {
      return std::fabs(x[n + 1]) < std::fabs(x[n]) ? n + 1 : n;
    }
  }
  return limit;
}

/// The latest zero crossing at or before `from` and after `floor`; `floor`
/// itself when there is none, which the caller reads as "no crossing".
inline std::size_t zeroCrossingBackFrom(const std::vector<double>& x, std::size_t from,
                                        std::size_t floor) {
  if (x.empty()) return floor;
  from = std::min(from, x.size() - 1);
  for (std::size_t n = from; n > floor; --n) {
    if (x[n] == 0.0) return n;
    if ((x[n] < 0.0) != (x[n - 1] < 0.0)) return n;
  }
  return floor;
}

/// Periodic Hann, the STFT form: w[n] = ½(1 − cos 2πn/N). The periodic form is
/// the one whose overlapped sum is constant. The flux in §3.3 does not need
/// that property but the vocoder in §4.4 will, and one Hann in the core is
/// the rule — two would eventually be handed the same frame and disagree.
inline void hann(std::vector<double>& w) {
  const std::size_t n = w.size();
  for (std::size_t i = 0; i < n; ++i) {
    w[i] = 0.5 * (1.0 - std::cos(2.0 * kPi * static_cast<double>(i) / static_cast<double>(n)));
  }
}

inline std::size_t nextPowerOfTwo(std::size_t n) {
  std::size_t p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Spectral centroid of [begin, end) in Hz, Hann-windowed and zero-padded to a
 * power of two. Magnitude-weighted rather than power-weighted: §3.5 case B
 * asks for a 5 % stability, and a power weighting squares every fluctuation
 * of a noise frame before the criterion sees it.
 */
inline double spectralCentroid(const std::vector<double>& x, std::size_t begin, std::size_t end,
                               double rate) {
  if (end > x.size()) end = x.size();
  if (begin >= end) return 0.0;
  const std::size_t len = end - begin;
  const std::size_t n = nextPowerOfTwo(std::max<std::size_t>(len, 2));
  std::vector<double> re(n, 0.0), im(n, 0.0), w(len);
  hann(w);
  for (std::size_t i = 0; i < len; ++i) re[i] = x[begin + i] * w[i];
  fft(re, im);
  double num = 0.0, den = 0.0;
  for (std::size_t k = 0; k <= n / 2; ++k) {
    const double mag = std::sqrt(re[k] * re[k] + im[k] * im[k]);
    num += mag * static_cast<double>(k) * rate / static_cast<double>(n);
    den += mag;
  }
  return den > 0.0 ? num / den : 0.0;
}

/// The p-th quantile (0 … 1) by sorted position, on a copy.
inline double percentile(std::vector<double> values, double p) {
  if (values.empty()) return 0.0;
  std::sort(values.begin(), values.end());
  const double pos = p * static_cast<double>(values.size() - 1);
  const std::size_t i = static_cast<std::size_t>(std::floor(pos));
  return values[std::min(i, values.size() - 1)];
}

/// Lower median: the middle element, or the lower of the two middles. Not the
/// mean of the pair — a set split four and four between two clusters should
/// answer from one of them, not from a point in between that nothing measured.
inline double median(std::vector<double> values) {
  if (values.empty()) return 0.0;
  std::sort(values.begin(), values.end());
  return values[(values.size() - 1) / 2];
}

/// ρ = Σ x[a+i]·x[b+i] / sqrt(Σ x[a+i]² · Σ x[b+i]²) over i in [0, n) — §3.5's
/// join correlation. Zero when either span is silent, because a correlation
/// with nothing must not read as a high one.
inline double normalisedCorrelation(const std::vector<double>& x, std::size_t a, std::size_t b,
                                    std::size_t n) {
  if (n == 0 || a + n > x.size() || b + n > x.size()) return 0.0;
  double ab = 0.0, aa = 0.0, bb = 0.0;
  for (std::size_t i = 0; i < n; ++i) {
    ab += x[a + i] * x[b + i];
    aa += x[a + i] * x[a + i];
    bb += x[b + i] * x[b + i];
  }
  const double den = std::sqrt(aa * bb);
  return den > 0.0 ? ab / den : 0.0;
}

}  // namespace mw::dsp::sample
