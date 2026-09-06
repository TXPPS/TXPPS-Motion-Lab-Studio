// Motion Wave — the synthesis primitives the importer's corpora are built from.
//
// Split from `sample_corpus.h`, which builds whole files out of these; this
// half is one sound at a time. `smp-01` §9's rows are written against a
// hand-labelled corpus and there is none in this repository, so every stimulus
// is synthesised and labelled by construction — see `sample_corpus.h` for what
// that buys and what it does not.
//
// Everything draws from `grain::Rng` with a stated seed, so a failing file can
// be regenerated and looked at.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "../dsp/grain/rng.h"

namespace mw::test::corpus {

using mw::dsp::grain::Rng;

constexpr double kPi = 3.14159265358979323846;

inline double db(double v) { return std::pow(10.0, v / 20.0); }
inline double hz(double midi) { return 440.0 * std::pow(2.0, (midi - 69.0) / 12.0); }
inline double uniform(Rng& rng, double lo, double hi) {
  return lo + (hi - lo) * static_cast<double>(rng.uniform());
}

struct Signal {
  std::vector<double> x;
  double rate = 44100.0;
  /// Labels: the sample each event's envelope starts on. Only events the
  /// rendered file actually presents — see `audible()` in `sample_corpus.h`.
  std::vector<std::size_t> onsets;
  /// Events that were placed but that the mix masked below the audibility
  /// margin. They are in the audio and are not required to be found; a
  /// detection on one is neither a hit nor a false positive, because the
  /// sound genuinely is there. Scoring without this set punishes a detector
  /// for being right.
  std::vector<std::size_t> masked;
  /// Ground-truth pitch when there is one.
  double f0 = 0.0;
  std::string name;

  std::vector<float> asFloat() const {
    std::vector<float> out(x.size());
    for (std::size_t i = 0; i < x.size(); ++i) out[i] = static_cast<float>(x[i]);
    return out;
  }
  std::size_t frames(double seconds) const {
    return static_cast<std::size_t>(std::lround(seconds * rate));
  }
};

/// Uniform noise at unit RMS: a bipolar uniform has RMS 1/√3.
inline double noise(Rng& rng) { return static_cast<double>(rng.bipolar()) * 1.7320508075688772; }

inline void addFloor(Signal& s, double floorDb, Rng& rng) {
  const double a = db(floorDb);
  for (double& v : s.x) v += a * noise(rng);
}

struct Partial {
  double ratio;
  double amp;
  double decayMs;
};

/**
 * A tone from `at`: partials with their own exponential decays, an attack
 * ramp, band-limited to 0.45·rate so nothing folds. Amplitudes are scaled by
 * the sum of the partial amplitudes so `level` is roughly the peak.
 */
inline void addTone(Signal& s, std::size_t at, double f0, double level,
                    const std::vector<Partial>& partials, double attackMs, double lengthMs) {
  if (at >= s.x.size()) return;
  const double rate = s.rate;
  const std::size_t len =
      std::min(s.x.size() - at, static_cast<std::size_t>(std::lround(lengthMs * 1.0e-3 * rate)));
  const double attack = attackMs * 1.0e-3 * rate;
  double norm = 0.0;
  for (const Partial& p : partials) {
    if (p.ratio * f0 < 0.45 * rate) norm += p.amp;
  }
  if (norm <= 0.0) return;
  for (std::size_t i = 0; i < len; ++i) {
    const double t = static_cast<double>(i) / rate;
    const double env = attack > 0.0 && static_cast<double>(i) < attack
                           ? static_cast<double>(i) / attack
                           : 1.0;
    double v = 0.0;
    for (const Partial& p : partials) {
      if (p.ratio * f0 >= 0.45 * rate) continue;
      v += p.amp * std::exp(-t / (p.decayMs * 1.0e-3)) * std::sin(2.0 * kPi * p.ratio * f0 * t);
    }
    s.x[at + i] += level * env * v / norm;
  }
}

/**
 * A noise burst from `at`: white noise, one-pole lowpassed at `lowpassHz` when
 * that is positive — or its highpass complement when `highpass` — under an
 * exponential decay with an attack ramp. The lowpass is rescaled to unit RMS
 * (a one-pole with coefficient a has noise power gain a/(2 − a)) so a kick
 * and a hat at the same `level` are the same level.
 */
inline void addBurst(Signal& s, std::size_t at, double level, double decayMs, double lowpassHz,
                     bool highpass, double attackMs, Rng& rng) {
  if (at >= s.x.size()) return;
  const double rate = s.rate;
  const double tau = decayMs * 1.0e-3 * rate;
  const std::size_t len =
      std::min(s.x.size() - at, static_cast<std::size_t>(std::lround(tau * 12.0)));
  const double a = lowpassHz > 0.0 ? 1.0 - std::exp(-2.0 * kPi * lowpassHz / rate) : 1.0;
  const double lpGain = lowpassHz > 0.0 ? std::sqrt((2.0 - a) / a) : 1.0;
  const double attack = attackMs * 1.0e-3 * rate;
  double lp = 0.0;
  for (std::size_t i = 0; i < len; ++i) {
    const double n = noise(rng);
    lp += a * (n - lp);
    double v = n;
    if (lowpassHz > 0.0) v = highpass ? n - lp : lp * lpGain;
    const double env = std::exp(-static_cast<double>(i) / tau) *
                       (attack > 0.0 && static_cast<double>(i) < attack
                            ? static_cast<double>(i) / attack
                            : 1.0);
    s.x[at + i] += level * env * v;
  }
}

// ───────────────────────────────────────────────────────────── the timbres

enum class Timbre { Sine, Sawtooth, SecondHarmonic, Pluck, Bell };

/**
 * Five families. `SecondHarmonic` is odd harmonics at 1/n with a second
 * harmonic 14.8 dB above the fundamental: d'(P/2) = 2·(odd energy)/(total)
 * = 0.075, under YIN's 0.1 threshold, so plain YIN locks the half period and
 * the octave guard is what puts it right. `Bell` is stretched partials whose
 * upper members decay faster than the fundamental — inharmonic enough to
 * shallow the dip, not enough to move the pitch.
 */
inline std::vector<Partial> partialsFor(Timbre t) {
  std::vector<Partial> p;
  switch (t) {
    case Timbre::Sine:
      p.push_back({1.0, 1.0, 4000.0});
      break;
    case Timbre::Sawtooth:
      for (int n = 1; n <= 40; ++n) p.push_back({static_cast<double>(n), 1.0 / n, 3000.0});
      break;
    case Timbre::SecondHarmonic:
      p.push_back({1.0, 1.0, 3000.0});
      p.push_back({2.0, 5.5, 3000.0});
      p.push_back({3.0, 1.0 / 3.0, 3000.0});
      p.push_back({5.0, 1.0 / 5.0, 3000.0});
      p.push_back({7.0, 1.0 / 7.0, 3000.0});
      break;
    case Timbre::Pluck:
      for (int n = 1; n <= 12; ++n) p.push_back({static_cast<double>(n), 1.0 / n, 400.0 / n});
      break;
    case Timbre::Bell:
      for (int n = 1; n <= 6; ++n) {
        const double dn = static_cast<double>(n);
        p.push_back({dn * std::sqrt(1.0 + 0.0008 * dn * dn), std::pow(dn, -0.7),
                     900.0 / std::pow(dn, 1.5)});
      }
      break;
  }
  return p;
}

inline const char* timbreName(Timbre t) {
  switch (t) {
    case Timbre::Sine: return "sine";
    case Timbre::Sawtooth: return "sawtooth";
    case Timbre::SecondHarmonic: return "2nd-harmonic";
    case Timbre::Pluck: return "pluck";
    case Timbre::Bell: return "bell";
  }
  return "?";
}

/// One note: `seconds` long, with a 3 ms attack, a −80 dBFS floor and 40 ms of
/// lead-in, at `midi` plus `cents`.
inline Signal note(Timbre t, double midi, double cents, double rate, double seconds,
                   std::uint64_t seed) {
  Rng rng;
  rng.seed(seed);
  Signal s;
  s.rate = rate;
  s.f0 = hz(midi + cents / 100.0);
  s.x.assign(s.frames(seconds + 0.24), 0.0);
  const std::size_t at = s.frames(0.04);
  addTone(s, at, s.f0, db(-6.0), partialsFor(t), 3.0, seconds * 1000.0);
  s.onsets.push_back(at);
  addFloor(s, -80.0, rng);
  return s;
}

}  // namespace mw::test::corpus
