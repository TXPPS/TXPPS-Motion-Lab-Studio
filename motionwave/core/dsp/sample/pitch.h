// Motion Wave — §3.4 of `smp-01`: pitch by YIN, with the residue kept.
//
// The five equations, in the sheet's numbering:
//
//   (1)  d(τ)  = Σ_{j=1}^{W} (x[j] − x[j+τ])²
//   (2)  d'(0) = 1,  d'(τ) = d(τ) / [ (1/τ) Σ_{j=1}^{τ} d(j) ]
//   (3)  τ*    = the smallest τ that gives a minimum of d' below 0.1, else argmin
//   (4)  parabolic interpolation of d' about τ*  →  τ̂
//   (5)  f0 = fs / τ̂,  aperiodicity = d'(τ*),  periodicity = 1 − aperiodicity
//
// **(3) is written as the paper states it, not as the sheet transcribed it.**
// The sheet says "smallest τ with d'(τ) < 0.1"; the published step is the
// smallest τ that gives a *minimum* deeper than the threshold. The two differ
// at the first sample under the threshold, which lies on the dip's descending
// slope, and a parabola fitted about a slope point has its vertex somewhere
// else entirely — the fine tune comes out wrong by tens of cents. §13 item 1
// asks for exactly this check. The transcription is kept as a mutation in
// `sample_pitch_tests.cpp`.
//
// **The octave guard's comparison is the other way round from the sheet.**
// As written — prefer 2τ̂ if d'(2τ̂) < d'(τ̂) + 0.05 — it fires on every clean
// tone: a stationary periodic signal has d' near zero at *every* multiple of
// its period, so d'(2P) < d'(P) + 0.05 always holds and every note reads an
// octave low. A decaying one is no better — d'(2P) ≈ 4·d'(P) for a period
// short against the decay, still under the margin. The signature of a
// half-period lock is the opposite: the dip at the true period is *deeper*
// than the one YIN stopped at. So the guard prefers 2τ̂ when d'(2τ̂) is below
// d'(τ̂) by the sheet's margin. With d'(P/2) = 2·(odd-harmonic energy)/(total
// energy) for a harmonic tone, YIN's threshold locks the half period once the
// second harmonic is about 13 dB above the fundamental, and the guard as
// corrected recovers the octave up to about 16 dB. Beyond that the octave is
// the honest pitch of a two-component signal. Both directions are mutations
// in the test file.
//
// **`fine` is kept.** Storing only `root` detunes every note by up to 50
// cents; it is the most common sampler import bug and it is free to avoid.
//
// **The classification reads all frames; the pitch reads the accepted ones.**
// The pitch is the median of frames with periodicity ≥ 0.65, so one
// octave-slipped frame cannot move it. The periodicity that classifies the
// note is the median over *every* frame: a drum loop with a tonal kick has
// two frames at 0.95 and six at 0.3, and a median over the accepted frames
// alone would call it a pitched note and hand V-9 a pitched map for a loop.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "measure.h"

namespace mw::dsp::sample {

struct PitchOptions {
  /// §3.4: A0 to C8. The sheet's [I] range — a 25 ms window at 40–800 Hz is
  /// the paper's evaluation, and an instrument sampler must resolve A0.
  double minHz = 27.5;
  double maxHz = 4186.0;
  /// §3.4: W = 100 ms, at least 2.7 periods at A0. The sheet's [I] choice.
  double windowMs = 100.0;
  /// §3.4: eight frames spread over the region. The sheet's [I] choice.
  int frames = 8;
  /// §3.4: the absolute threshold, the published value. [C]
  double threshold = 0.1;
  /// §3.4: frames below this periodicity do not vote. The sheet's [I] choice.
  double frameAccept = 0.65;
  /// §3.4: the octave guard's margin. The sheet's [I] value, with the
  /// comparison corrected as the header derives.
  double octaveGuardMargin = 0.05;
  /// §3.4's bands: ≥ 0.90 pitched, 0.65–0.90 flagged, below unpitched. The
  /// sheet's [I] boundaries, bracketed by V-6.
  double pitchedAt = 0.90;
  double flaggedAt = 0.65;
};

enum class PitchClass : std::uint8_t { Pitched, Flagged, Unpitched };

struct YinFrame {
  std::size_t start = 0;
  /// Fractional period in samples; zero when the frame gave no estimate.
  double tau = 0.0;
  double f0 = 0.0;
  double periodicity = 0.0;
  bool guardFired = false;
  bool accepted = false;
};

struct PitchResult {
  double f0 = 0.0;
  /// Fractional period in samples at the file's rate — §3.5 case A's P.
  double period = 0.0;
  double periodicity = 0.0;
  /// ν = 69 + 12·log2(f0 / A_ref).
  double midi = 0.0;
  int root = 60;
  double fineCents = 0.0;
  PitchClass classification = PitchClass::Unpitched;
  std::vector<YinFrame> frames;
  int accepted = 0;
  std::size_t window = 0;
  std::size_t tauMin = 0;
  std::size_t tauMax = 0;
};

/// (1), for τ in [0, tauMax]. Needs `window + tauMax` samples from `start`.
inline void differenceFunction(const std::vector<double>& x, std::size_t start, std::size_t window,
                               std::size_t tauMax, std::vector<double>& d) {
  d.assign(tauMax + 1, 0.0);
  const double* a = x.data() + start;
  for (std::size_t tau = 1; tau <= tauMax; ++tau) {
    const double* b = a + tau;
    double acc = 0.0;
    for (std::size_t j = 0; j < window; ++j) {
      const double diff = a[j] - b[j];
      acc += diff * diff;
    }
    d[tau] = acc;
  }
}

/// (2). A running sum of zero — a silent window — normalises to 1 rather than
/// to a division by zero, which reads as "no periodicity", which is true.
inline void cumulativeMeanNormalise(const std::vector<double>& d, std::vector<double>& dp) {
  dp.assign(d.size(), 1.0);
  double running = 0.0;
  for (std::size_t tau = 1; tau < d.size(); ++tau) {
    running += d[tau];
    dp[tau] = running > 0.0 ? d[tau] * static_cast<double>(tau) / running : 1.0;
  }
}

/// (3) as published: the first lag under the threshold, followed down to the
/// bottom of its dip; the global minimum over the range when nothing is under.
inline std::size_t absoluteThreshold(const std::vector<double>& dp, std::size_t tauMin,
                                     std::size_t tauMax, double threshold) {
  std::size_t best = tauMin;
  for (std::size_t tau = tauMin; tau <= tauMax; ++tau) {
    if (dp[tau] < dp[best]) best = tau;
    if (dp[tau] < threshold) {
      std::size_t t = tau;
      while (t + 1 <= tauMax && dp[t + 1] < dp[t]) ++t;
      return t;
    }
  }
  return best;
}

/// (4). The vertex of the parabola through (τ−1, τ, τ+1), clamped to the
/// neighbours: a vertex outside them would mean the three points were not a
/// dip, and reporting it would place the period on a slope.
inline double parabolicMinimum(const std::vector<double>& dp, std::size_t tau, double& value) {
  value = dp[tau];
  if (tau == 0 || tau + 1 >= dp.size()) return static_cast<double>(tau);
  const double a = dp[tau - 1], b = dp[tau], c = dp[tau + 1];
  const double den = a - 2.0 * b + c;
  if (den <= 0.0) return static_cast<double>(tau);
  const double delta = std::max(-1.0, std::min(1.0, 0.5 * (a - c) / den));
  value = b - 0.25 * (a - c) * delta;
  return static_cast<double>(tau) + delta;
}

/// §3.4's octave guard, corrected as the header derives. True, with `doubled`
/// set to the bottom of the dip nearest 2τ, when that dip is deeper than the
/// one at τ by at least `margin`.
inline bool octaveGuard(const std::vector<double>& dp, std::size_t tau, std::size_t tauMax,
                        double margin, std::size_t& doubled) {
  const std::size_t centre = 2 * tau;
  if (centre + 1 > tauMax) return false;
  std::size_t best = centre;
  for (std::size_t t = centre - 1; t <= centre + 1; ++t) {
    if (dp[t] < dp[best]) best = t;
  }
  while (best + 1 <= tauMax && dp[best + 1] < dp[best]) ++best;
  while (best > tau + 1 && dp[best - 1] < dp[best]) --best;
  // The guard only applies where there is an octave error to correct, and
  // "d' at tau is already excellent" is how that is known.
  //
  // A half-period lock is a compromise: YIN settled for tau because the dip
  // there was good enough to pass the threshold, and the dip at the true
  // period is better. When d'(tau) is *very* small there is no compromise to
  // undo — the signal really does repeat at tau — and doubling it invents an
  // octave error rather than fixing one. V-6 found exactly that: a C8
  // sawtooth at 44.1 kHz has only four partials under Nyquist, which makes
  // its d' at 2P nearly as deep as at P, the guard fired on all eight frames,
  // and the one octave error in sixty notes was the guard's own doing.
  //
  if (dp[best] < dp[tau] - margin) {
    doubled = best;
    return true;
  }
  return false;
}

/// One YIN frame. Needs `window + tauMax + 2` samples from `start`: one lag
/// past tauMax so the parabola about tauMax has a right-hand neighbour.
inline YinFrame yinFrame(const std::vector<double>& x, std::size_t start, std::size_t window,
                         std::size_t tauMin, std::size_t tauMax, double rate,
                         const PitchOptions& o) {
  YinFrame f;
  f.start = start;
  std::vector<double> d, dp;
  differenceFunction(x, start, window, tauMax + 1, d);
  cumulativeMeanNormalise(d, dp);
  std::size_t tau = absoluteThreshold(dp, tauMin, tauMax, o.threshold);
  std::size_t doubled = 0;
  if (octaveGuard(dp, tau, tauMax, o.octaveGuardMargin, doubled)) {
    tau = doubled;
    f.guardFired = true;
  }
  double value = 0.0;
  f.tau = parabolicMinimum(dp, tau, value);
  f.periodicity = 1.0 - dp[tau];
  f.f0 = f.tau > 0.0 ? rate / f.tau : 0.0;
  return f;
}

inline double midiFromHz(double f0, double referenceHz) {
  return 69.0 + 12.0 * std::log2(f0 / referenceHz);
}

/// root = round(ν), fine = 100·(ν − root). Both, always.
inline void rootAndFine(double midi, int& root, double& fineCents) {
  root = static_cast<int>(std::lround(midi));
  root = std::max(0, std::min(127, root));
  fineCents = 100.0 * (midi - static_cast<double>(root));
}

/// The whole of §3.4 over [begin, end) of a conditioned signal.
inline PitchResult detectPitch(const std::vector<double>& x, std::size_t begin, std::size_t end,
                               double rate, double referenceHz, const PitchOptions& o) {
  PitchResult r;
  end = std::min(end, x.size());
  if (begin >= end) return r;
  const std::size_t len = end - begin;
  std::size_t tauMin = static_cast<std::size_t>(std::floor(rate / o.maxHz));
  if (tauMin < 2) tauMin = 2;
  std::size_t tauMax = static_cast<std::size_t>(std::ceil(rate / o.minHz));
  std::size_t window = framesFor(o.windowMs, rate);
  std::size_t need = window + tauMax + 2;
  if (len < need) {
    // A region shorter than a full frame gives up lag range before it gives
    // up window: a window shorter than a period cannot see the period at all.
    window = len / 2;
    if (window < 8 || len < window + tauMin + 3) return r;
    tauMax = len - window - 2;
    need = len;
  }
  r.window = window;
  r.tauMin = tauMin;
  r.tauMax = tauMax;
  const int count = std::max(1, o.frames);
  const std::size_t room = len - need;
  std::vector<double> midis, periodicities;
  for (int k = 0; k < count; ++k) {
    const std::size_t offset =
        count > 1 ? (room * static_cast<std::size_t>(k)) / static_cast<std::size_t>(count - 1)
                  : room / 2;
    YinFrame f = yinFrame(x, begin + offset, window, tauMin, tauMax, rate, o);
    f.accepted = f.f0 > 0.0 && f.periodicity >= o.frameAccept;
    if (f.accepted) {
      midis.push_back(midiFromHz(f.f0, referenceHz));
      ++r.accepted;
    }
    periodicities.push_back(f.periodicity);
    r.frames.push_back(f);
  }
  r.periodicity = median(periodicities);
  if (r.accepted > 0) {
    r.midi = median(midis);
    r.f0 = referenceHz * std::pow(2.0, (r.midi - 69.0) / 12.0);
    r.period = rate / r.f0;
    rootAndFine(r.midi, r.root, r.fineCents);
    if (r.periodicity >= o.pitchedAt) {
      r.classification = PitchClass::Pitched;
    } else if (r.periodicity >= o.flaggedAt) {
      r.classification = PitchClass::Flagged;
    }
  } else {
    // Nothing voted. Report the most periodic frame so a UI can show what the
    // detector saw, and leave the classification unpitched.
    const YinFrame* best = nullptr;
    for (const YinFrame& f : r.frames) {
      if (best == nullptr || f.periodicity > best->periodicity) best = &f;
    }
    if (best != nullptr && best->f0 > 0.0) {
      r.f0 = best->f0;
      r.period = best->tau;
      r.midi = midiFromHz(r.f0, referenceHz);
      rootAndFine(r.midi, r.root, r.fineCents);
    }
  }
  return r;
}

}  // namespace mw::dsp::sample
