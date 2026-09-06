// Motion Wave — §3.5 of `smp-01`: loop points, and the crossfade law.
//
// Three cases, because one algorithm does not cover them and pretending it
// does is how a sampler acquires a loop button that works on strings and not
// on pads:
//
//   A  pitched sustain — the loop is an integer number of pitch periods, the
//      smallest count that reaches max(50 ms, 4P), and its start is refined
//      over ±P/2 for the best normalised correlation across the join. A loop
//      that is not a whole number of periods restarts the waveform at a
//      different phase every pass, heard as a tick at the loop rate.
//   B  unpitched sustain — the longest window over which 20 ms RMS holds
//      within 1 dB and the spectral centroid within 5 %, at least 200 ms so
//      the repetition sits at 5 Hz and reads as movement rather than pitch.
//   C  nothing. A percussive one-shot has no sustain to loop.
//
// Case A that fails its correlation falls through to case B: a pad with
// chorus on it is pitched by §3.4 and has no period-locked join, but may have
// a long stationary stretch. Ours, not the sheet's; the sheet stops at "accept
// if ρ ≥ 0.95".
//
// **The crossfade law is the part that is usually wrong.** Length is
// min(½L, 30 ms) for A and ¼L for B — a shorter fade has less chance of phase
// cancellation, which is why A's is short and tied to the period. The *shape*
// follows the correlation at the join: correlated material sums in amplitude,
// so an equal-power fade over it puts a +3 dB bump in the middle of every
// crossfade; uncorrelated material sums in power, so an equal-gain fade over
// it puts a −3 dB dip there. Either is a level pulse once per loop pass, the
// very artefact the crossfade was added to remove. `renderSustain` is the
// reference rendering, and V-8 measures its seam; the playback engine of §4.2
// has to produce the same join.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "measure.h"
#include "zone.h"

namespace mw::dsp::sample {

struct LoopOptions {
  /// §3.5 case A: k·P ≥ max(50 ms, 4P). The sheet's values.
  double minLengthMsA = 50.0;
  int minPeriods = 4;
  /// §3.5 case A: accept at ρ ≥ 0.95. The sheet's value.
  double acceptRho = 0.95;
  /// Ours: how many further period multiples to try before case A gives up.
  int periodMultipleAttempts = 8;
  /// §3.5 case B: 20 ms RMS within 1 dB, centroid within 5 %, at least 200 ms.
  /// The first three are the sheet's values; the 200 ms is derived there.
  double rmsFrameMs = 20.0;
  double rmsRangeDb = 1.0;
  double centroidRange = 0.05;
  double minLengthMsB = 200.0;
  /// §3.5: crossfade min(½L, 30 ms) for A, ¼L for B.
  double crossfadeFractionA = 0.5;
  double crossfadeCapMsA = 30.0;
  double crossfadeFractionB = 0.25;
  /// §3.5: equal-gain at ρ ≥ 0.98, equal-power below. Derived in the sheet.
  double equalGainAt = 0.98;
};

enum class LoopKind : std::uint8_t { None, PeriodLocked, Stationary };

struct LoopResult {
  LoopKind kind = LoopKind::None;
  std::size_t start = 0;
  std::size_t end = 0;
  std::size_t crossfade = 0;
  CrossfadeShape shape = CrossfadeShape::EqualPower;
  /// The correlation at the join that chose the shape.
  double rho = 0.0;
  /// Case A: how many periods the loop holds, and the period it was built on.
  int periods = 0;
  double period = 0.0;
  std::size_t length() const { return end > start ? end - start : 0; }
};

inline CrossfadeShape shapeFor(double rho, const LoopOptions& o) {
  return rho >= o.equalGainAt ? CrossfadeShape::EqualGain : CrossfadeShape::EqualPower;
}

/// The outgoing weight at progress u in [0, 1].
inline double fadeOut(double u, CrossfadeShape shape) {
  return shape == CrossfadeShape::EqualGain ? 1.0 - u : std::cos(0.5 * kPi * u);
}

/// The incoming weight at progress u in [0, 1].
inline double fadeIn(double u, CrossfadeShape shape) {
  return shape == CrossfadeShape::EqualGain ? u : std::sin(0.5 * kPi * u);
}

/// Case A over the sustain region [begin, end), given P from §3.4.
inline LoopResult findPeriodLoop(const std::vector<double>& x, std::size_t begin, std::size_t end,
                                 double period, double rate, const LoopOptions& o) {
  LoopResult r;
  end = std::min(end, x.size());
  if (period <= 1.0 || begin >= end) return r;
  const double minLength =
      std::max(o.minLengthMsA * 1.0e-3 * rate, static_cast<double>(o.minPeriods) * period);
  int k = static_cast<int>(std::ceil(minLength / period));
  if (static_cast<double>(k) * period < minLength) ++k;
  const std::size_t twoP = static_cast<std::size_t>(std::lround(2.0 * period));
  const std::size_t halfP = static_cast<std::size_t>(std::lround(0.5 * period));
  for (int attempt = 0; attempt < std::max(1, o.periodMultipleAttempts); ++attempt, ++k) {
    const std::size_t length = static_cast<std::size_t>(std::lround(static_cast<double>(k) * period));
    if (begin + length + twoP > end) break;
    // The period-quantised start: the loop centred in the sustain, snapped to
    // the period grid counted from the region's start.
    const double centre = static_cast<double>(begin) +
                          0.5 * (static_cast<double>(end - begin) - static_cast<double>(length));
    const double steps = std::floor((centre - static_cast<double>(begin)) / period);
    const std::size_t s0 = begin + static_cast<std::size_t>(std::max(0.0, steps) * period);
    const std::size_t lo = std::max(begin, s0 > halfP ? s0 - halfP : begin);
    const std::size_t limit = end - length - twoP;
    const std::size_t hi = std::min(s0 + halfP, limit);
    if (lo > hi) continue;
    std::size_t bestStart = lo;
    double bestRho = -2.0;
    for (std::size_t s = lo; s <= hi; ++s) {
      const double rho = normalisedCorrelation(x, s, s + length, twoP);
      if (rho > bestRho) {
        bestRho = rho;
        bestStart = s;
      }
    }
    if (bestRho < o.acceptRho) continue;
    r.kind = LoopKind::PeriodLocked;
    r.start = bestStart;
    r.end = bestStart + length;
    r.periods = k;
    r.period = period;
    r.rho = bestRho;
    const std::size_t cap = framesFor(o.crossfadeCapMsA, rate);
    const std::size_t fraction =
        static_cast<std::size_t>(std::lround(o.crossfadeFractionA * static_cast<double>(length)));
    // The fade blends the material before the loop start into the material
    // before its end, so it cannot be longer than what precedes the start.
    r.crossfade = std::min(std::min(fraction, cap), r.start);
    r.shape = shapeFor(r.rho, o);
    return r;
  }
  return r;
}

/// Case B over the sustain region [begin, end).
inline LoopResult findStationaryLoop(const std::vector<double>& x, std::size_t begin,
                                     std::size_t end, double rate, const LoopOptions& o) {
  LoopResult r;
  end = std::min(end, x.size());
  const std::size_t w = framesFor(o.rmsFrameMs, rate);
  if (begin >= end || end - begin < w) return r;
  const std::size_t frames = (end - begin) / w;
  std::vector<double> levelDb(frames), centroid(frames);
  for (std::size_t f = 0; f < frames; ++f) {
    const std::size_t s = begin + f * w;
    levelDb[f] = toDb(rmsOver(x, s, s + w));
    centroid[f] = spectralCentroid(x, s, s + w, rate);
  }
  std::size_t bestBegin = 0, bestLength = 0;
  for (std::size_t i = 0; i < frames; ++i) {
    double minDb = levelDb[i], maxDb = levelDb[i];
    double minC = centroid[i], maxC = centroid[i], sumC = 0.0;
    std::size_t j = i;
    for (; j < frames; ++j) {
      minDb = std::min(minDb, levelDb[j]);
      maxDb = std::max(maxDb, levelDb[j]);
      minC = std::min(minC, centroid[j]);
      maxC = std::max(maxC, centroid[j]);
      sumC += centroid[j];
      const double meanC = sumC / static_cast<double>(j - i + 1);
      if (maxDb - minDb >= o.rmsRangeDb || maxC - minC >= o.centroidRange * meanC) break;
    }
    if (j - i > bestLength) {
      bestLength = j - i;
      bestBegin = i;
    }
    if (i + bestLength >= frames) break;
  }
  const std::size_t length = bestLength * w;
  if (length < framesFor(o.minLengthMsB, rate)) return r;
  r.kind = LoopKind::Stationary;
  r.start = begin + bestBegin * w;
  r.end = r.start + length;
  const std::size_t fraction =
      static_cast<std::size_t>(std::lround(o.crossfadeFractionB * static_cast<double>(length)));
  r.crossfade = std::min(fraction, r.start);
  r.rho = normalisedCorrelation(x, r.start - r.crossfade, r.end - r.crossfade, r.crossfade);
  r.shape = shapeFor(r.rho, o);
  return r;
}

/**
 * One pass of the loop with its crossfade rendered: the last `crossfade`
 * samples blend the outgoing material before the loop end into the incoming
 * material before the loop start, so the pass's last sample is x[start − 1]
 * and the next pass's first is x[start]. `shape` is passed rather than read
 * from the loop so a test can render the wrong one and measure the pulse.
 */
inline std::vector<double> loopBody(const std::vector<double>& x, const LoopResult& loop,
                                    CrossfadeShape shape) {
  const std::size_t length = loop.length();
  std::vector<double> body(length, 0.0);
  if (length == 0 || loop.end > x.size()) return body;
  for (std::size_t i = 0; i < length; ++i) body[i] = x[loop.start + i];
  const std::size_t xf = std::min(loop.crossfade, std::min(loop.start, length));
  for (std::size_t i = 0; i < xf; ++i) {
    const double u = static_cast<double>(i + 1) / static_cast<double>(xf);
    const std::size_t at = length - xf + i;
    body[at] = fadeOut(u, shape) * x[loop.start + at] + fadeIn(u, shape) * x[loop.start - xf + i];
  }
  return body;
}

/// `frames` samples of the loop sustained, starting at the loop start. Joins
/// fall at every multiple of the loop length.
inline std::vector<double> renderSustain(const std::vector<double>& x, const LoopResult& loop,
                                         std::size_t frames, CrossfadeShape shape) {
  const std::vector<double> body = loopBody(x, loop, shape);
  std::vector<double> out(frames, 0.0);
  if (body.empty()) return out;
  for (std::size_t n = 0; n < frames; ++n) out[n] = body[n % body.size()];
  return out;
}

inline std::vector<double> renderSustain(const std::vector<double>& x, const LoopResult& loop,
                                         std::size_t frames) {
  return renderSustain(x, loop, frames, loop.shape);
}

}  // namespace mw::dsp::sample
