// Motion Wave — §3.2 of `smp-01`: conditioning a dropped file before analysis.
//
// Five measurements in the order §3.1 gives them, and only one of them changes
// the signal. DC is subtracted from the analysis copy because every zero-
// crossing test after this point — the head trim, the onset refinement, the
// loop join — is wrong on a signal that does not cross zero where it sounds
// like it does. Nothing else is rewritten: peak and loudness become a stored
// `gainDb`, and the trim becomes a span. A destructive normalise cannot be
// undone, re-quantises the data, and on a file already near full scale it is
// the step that turns an inter-sample peak into a clip.
//
// True peak is measured at 4× by zero-stuffing and a Blackman-windowed sinc,
// evaluated polyphase so the stuffed zeros are never multiplied: three
// sixteen-tap kernels, one per intermediate phase, and the on-grid samples as
// they are. It is the structure of the broadcast loudness standard's true-peak
// stage at the same ratio. A sample that reads −0.1 dBFS on the grid can be
// +0.6 dBTP between samples, and the zone's headroom budget needs the real
// number.
//
// Every threshold below is the sheet's [I] choice. No row of §9 measures them
// directly; V-4 and V-5 depend on the trim leaving the first attack intact,
// which is the behaviour `sample_onset_tests.cpp` holds.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <vector>

#include "measure.h"

namespace mw::dsp::sample {

struct ConditioningOptions {
  /// §3.2: subtract the mean when |mean| exceeds this, −80 dBFS. The sheet's
  /// choice; below it a DC term is under any zero-crossing test's resolution.
  double dcThreshold = 1.0e-4;
  /// §3.2: the noise floor is the 10th percentile of 20 ms RMS frames. The
  /// sheet's choice — a percentile, so one frame of digital silence in a
  /// noisy file cannot make the floor read as −200 dB.
  double floorFrameMs = 20.0;
  double floorPercentile = 0.10;
  /// §3.2: the gate is 1 ms RMS against max(−60 dBFS, floor + 12 dB). The
  /// sheet's choice.
  double gateFrameMs = 1.0;
  double gateFloorDb = -60.0;
  double gateAboveFloorDb = 12.0;
  /// §3.2: back off 5 ms or to the previous zero crossing, whichever is
  /// nearer. The sheet's choice, because trimming exactly at the threshold
  /// removes the first few samples of the attack.
  double headBackoffMs = 5.0;
  /// §3.2: the tail keeps 50 ms after the last gated frame. The sheet's choice.
  double tailPadMs = 50.0;
  /// Taps per phase of the true-peak interpolator. Ours: sixteen keeps the
  /// passband flat to well under 0.1 dB over the band any peak lives in, which
  /// is finer than a headroom budget reads.
  std::size_t truePeakTaps = 16;
  /// §7.1's gain range. The stored gain is clamped into it so a silent file
  /// does not carry a +200 dB "normalise" into the zone.
  double gainMinDb = -60.0;
  double gainMaxDb = 12.0;
};

struct Conditioning {
  double dcOffset = 0.0;
  bool dcRemoved = false;
  double samplePeak = 0.0;
  double truePeak = 0.0;
  double truePeakDb = kSilenceDb;
  double noiseFloorDb = kSilenceDb;
  double gateDb = -60.0;
  /// RMS over the trimmed span in dBFS. What §3.7 clusters velocity layers by.
  double loudnessDb = kSilenceDb;
  /// −truePeakDb clamped to the control range: the normalise that was not
  /// applied, so playback can apply it reversibly.
  double gainDb = 0.0;
  std::size_t start = 0;
  std::size_t end = 0;
  /// Nothing rose above the gate. The span is then the whole file, because a
  /// trim that removed everything would hand the next stage an empty span.
  bool silent = false;
};

/**
 * The three intermediate-phase kernels of a 4× windowed-sinc interpolator.
 *
 * Phase p (1 … 3) evaluates the signal at i + p/4 as Σ_m x[i + m] · k_p[m] for
 * m from −taps/2 + 1 to taps/2. Each kernel is normalised to unit DC gain so a
 * constant interpolates to itself; without that, an interpolated peak would be
 * biased by the window's own sum, by an amount that differs per phase.
 */
inline std::vector<std::vector<double>> truePeakKernels(std::size_t taps) {
  if (taps < 2) taps = 2;
  const long half = static_cast<long>(taps / 2);
  std::vector<std::vector<double>> kernels(3, std::vector<double>(taps, 0.0));
  for (long p = 1; p <= 3; ++p) {
    std::vector<double>& k = kernels[static_cast<std::size_t>(p - 1)];
    const double phase = static_cast<double>(p) / 4.0;
    double sum = 0.0;
    for (long j = 0; j < static_cast<long>(taps); ++j) {
      const double t = static_cast<double>(j - half + 1) - phase;
      const double sinc = t == 0.0 ? 1.0 : std::sin(kPi * t) / (kPi * t);
      // Blackman across the kernel's extent, centred on the point being
      // evaluated rather than on a tap, so both ends taper symmetrically.
      const double u = (t + static_cast<double>(half)) / static_cast<double>(2 * half);
      const double window =
          0.42 - 0.5 * std::cos(2.0 * kPi * u) + 0.08 * std::cos(4.0 * kPi * u);
      k[static_cast<std::size_t>(j)] = sinc * window;
      sum += k[static_cast<std::size_t>(j)];
    }
    for (double& v : k) v /= sum;
  }
  return kernels;
}

/// The largest absolute value on the 4× grid: the grid samples themselves and
/// the three interpolated points between each pair.
inline double truePeak(const std::vector<double>& x, std::size_t taps) {
  double peak = 0.0;
  for (double v : x) peak = std::max(peak, std::fabs(v));
  if (x.size() < 2) return peak;
  const std::vector<std::vector<double>> kernels = truePeakKernels(taps);
  const long half = static_cast<long>(kernels[0].size() / 2);
  const long count = static_cast<long>(kernels[0].size());
  const long n = static_cast<long>(x.size());
  for (long i = 0; i + 1 < n; ++i) {
    for (const std::vector<double>& k : kernels) {
      double acc = 0.0;
      for (long j = 0; j < count; ++j) {
        const long idx = i + j - half + 1;
        if (idx < 0 || idx >= n) continue;
        acc += x[static_cast<std::size_t>(idx)] * k[static_cast<std::size_t>(j)];
      }
      peak = std::max(peak, std::fabs(acc));
    }
  }
  return peak;
}

/**
 * §3.2 in order: DC, peak, floor, gate, trim, loudness. `x` is the analysis
 * copy and is the one buffer this stage writes — the mean comes off it, and
 * `dcOffset` records what came off so the zone can carry it.
 */
inline Conditioning condition(std::vector<double>& x, double rate, const ConditioningOptions& o) {
  Conditioning c;
  const std::size_t n = x.size();
  if (n == 0) {
    c.silent = true;
    return c;
  }
  double mean = 0.0;
  for (double v : x) mean += v;
  mean /= static_cast<double>(n);
  c.dcOffset = mean;
  if (std::fabs(mean) > o.dcThreshold) {
    for (double& v : x) v -= mean;
    c.dcRemoved = true;
  }
  for (double v : x) c.samplePeak = std::max(c.samplePeak, std::fabs(v));
  c.truePeak = truePeak(x, o.truePeakTaps);
  c.truePeakDb = toDb(c.truePeak);

  std::vector<double> floorFrames = frameRms(x, 0, n, framesFor(o.floorFrameMs, rate));
  for (double& f : floorFrames) f = toDb(f);
  c.noiseFloorDb = percentile(floorFrames, o.floorPercentile);
  c.gateDb = std::max(o.gateFloorDb, c.noiseFloorDb + o.gateAboveFloorDb);
  const double gate = fromDb(c.gateDb);

  const std::size_t wg = framesFor(o.gateFrameMs, rate);
  std::size_t first = n;
  std::size_t lastEnd = 0;
  for (std::size_t f = 0; f < n; f += wg) {
    const std::size_t e = std::min(f + wg, n);
    if (rmsOver(x, f, e) > gate) {
      if (first == n) first = f;
      lastEnd = e;
    }
  }
  if (first == n) {
    c.silent = true;
    c.start = 0;
    c.end = n;
  } else {
    const std::size_t backoff = framesFor(o.headBackoffMs, rate);
    const std::size_t floorIdx = first > backoff ? first - backoff : 0;
    // A crossing found inside the back-off is, by construction, the nearer of
    // the two; the back-off point itself is the answer when there is none.
    c.start = zeroCrossingBackFrom(x, first, floorIdx);
    c.end = std::min(n, lastEnd + framesFor(o.tailPadMs, rate));
  }
  c.loudnessDb = toDb(rmsOver(x, c.start, c.end));
  c.gainDb = std::min(o.gainMaxDb, std::max(o.gainMinDb, -c.truePeakDb));
  return c;
}

}  // namespace mw::dsp::sample
