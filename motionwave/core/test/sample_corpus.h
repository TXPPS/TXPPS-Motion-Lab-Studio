// Motion Wave — synthesised corpora with known ground truth for the importer.
//
// `smp-01` §9 rows V-4 to V-10 are written against hand-labelled files, and
// there is no hand-labelled corpus in this repository. So every corpus here is
// synthesised, seeded, and labelled by construction: a burst's label is the
// sample its envelope starts on, a note's pitch is the frequency it was
// rendered at, a loop's hit count is the number of hits that were placed.
//
// That is stronger than a hand label on the axis the rows measure — a person
// cannot label an onset to the sample — and weaker on every other axis: no
// room, no bleed, no tape hiss with hum in it, no drummer's flam, no bowed
// attack that takes forty milliseconds to decide it is a note. A real corpus
// would add exactly those, and the numbers here bracket the sheet's [I]
// parameters rather than confirm them, which is what §13 item 2 says.
//
// The one-sound-at-a-time primitives these are built from are in
// `sample_synth.h`.
//
// **A label is a promise that the event is there to be found, and `audible()`
// is what keeps it.** Placing a hit and labelling it are not the same act: a
// −13 dBFS hat landing 100 ms into the decay of a −4 dBFS kick raises the
// signal by under a decibel, and no detection function separates it from that
// decay, because there is nothing there to separate. Scored against labels
// like those, a detector's recall measures how densely the corpus was written.
// It measured exactly that here — 45 of 56 apparent misses were events
// masked below 6 dB, and recall over the rest was 0.965 against 0.871
// overall.
//
// So every corpus below labels an event only where the signal actually rises,
// and the rise is measured on the rendered file rather than assumed from the
// amplitudes that were asked for. The masked hits stay in the audio: they are
// what a real loop sounds like and a detector that fires on them is wrong.
// They are simply not claimed as findable. A real corpus gets this for free,
// because a person labelling by ear cannot hear what is not there.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "sample_synth.h"

namespace mw::test::corpus {

/**
 * Which of `candidates` the rendered signal actually presents as an onset.
 *
 * The test is the one a listener applies: does the signal rise, over the
 * window an onset lives in, above what was already sounding? `riseDb` is the
 * margin required, and 6 dB is where this project draws it — a doubling of
 * amplitude, comfortably above the level a decaying hit fluctuates by, and
 * well below the 12–20 dB a hit in the open produces.
 *
 * Applied AFTER the file is rendered, never to the amplitudes that were asked
 * for, because masking is a property of the sum and not of any one layer.
 */
inline std::vector<std::size_t> audible(const Signal& s,
                                        const std::vector<std::size_t>& candidates,
                                        std::vector<std::size_t>* maskedOut = nullptr,
                                        double riseDb = 6.0, double windowMs = 10.0) {
  std::vector<std::size_t> kept;
  const std::size_t w = static_cast<std::size_t>(std::lround(windowMs * 1.0e-3 * s.rate));
  for (std::size_t at : candidates) {
    if (at < w || at + w >= s.x.size()) continue;
    double before = 0.0, after = 0.0;
    for (std::size_t i = 0; i < w; ++i) {
      const double b = s.x[at - w + i];
      const double a = s.x[at + i];
      before += b * b;
      after += a * a;
    }
    before = std::sqrt(before / static_cast<double>(w));
    after = std::sqrt(after / static_cast<double>(w));
    const double rise = before > 0.0 ? 20.0 * std::log10(after / before) : 1.0e9;
    if (rise >= riseDb) {
      kept.push_back(at);
    } else if (maskedOut != nullptr) {
      maskedOut->push_back(at);
    }
  }
  return kept;
}

// ──────────────────────────────────────────────────────────── the corpora

/// A kick: a decaying sine whose pitch falls from twice its resting frequency
/// over 30 ms, under a 3 ms click of noise. A kick made of lowpassed noise —
/// the first version of this corpus — is 100 ms of random magnitudes at −4
/// dBFS, and its spectral flux while it decays is as large as the flux of
/// the hit that lands on it; no real drum is that.
inline void addKick(Signal& s, std::size_t at, double level, double restHz, double decayMs, Rng& rng) {
  if (at >= s.x.size()) return;
  const double rate = s.rate;
  const double tau = decayMs * 1.0e-3 * rate;
  const std::size_t len = std::min(s.x.size() - at, static_cast<std::size_t>(std::lround(tau * 10.0)));
  double phase = 0.0;
  for (std::size_t i = 0; i < len; ++i) {
    const double t = static_cast<double>(i) / rate;
    const double f = restHz * (1.0 + std::exp(-t / 0.03));
    phase += 2.0 * kPi * f / rate;
    const double attack = std::min(1.0, static_cast<double>(i) / (0.0005 * rate));
    s.x[at + i] += level * attack * std::exp(-static_cast<double>(i) / tau) * std::sin(phase);
  }
  addBurst(s, at, level * 0.5, 3.0, 0.0, false, 0.0, rng);
}

/// Two bars of sixteenths at a random tempo: kicks, snares with a tonal body
/// under their noise, hats, ghost notes. `tonalKick` makes the kicks longer
/// and louder in their tone, so that some YIN frames of the loop are periodic
/// — the case the classification rule in `pitch.h` exists for.
inline Signal drumLoop(std::uint64_t seed, double rate, bool tonalKick) {
  Rng rng;
  rng.seed(seed);
  Signal s;
  s.rate = rate;
  const double bpm = uniform(rng, 90.0, 150.0);
  const double step = 60.0 / bpm / 4.0;
  const int steps = 32;
  const std::size_t lead = s.frames(0.05);
  s.x.assign(lead + s.frames(steps * step + 0.5), 0.0);
  for (int st = 0; st < steps; ++st) {
    const bool kick = st % 8 == 0 || uniform(rng, 0.0, 1.0) < 0.12;
    const bool snare = st % 8 == 4 || uniform(rng, 0.0, 1.0) < 0.08;
    const bool hat = uniform(rng, 0.0, 1.0) < 0.55;
    const bool ghost = !kick && !snare && !hat && uniform(rng, 0.0, 1.0) < 0.2;
    if (!kick && !snare && !hat && !ghost) continue;
    const std::size_t at = lead + s.frames(st * step);
    if (kick) {
      addKick(s, at, db(-4.0), uniform(rng, 50.0, 65.0), tonalKick ? 400.0 : uniform(rng, 90.0, 160.0), rng);
    }
    if (snare) {
      addTone(s, at, uniform(rng, 170.0, 220.0), db(-9.0), {{1.0, 1.0, 70.0}, {1.6, 0.5, 40.0}}, 0.3, 300.0);
      addBurst(s, at, db(-10.0), uniform(rng, 60.0, 120.0), 0.0, false, 0.3, rng);
    }
    // Hats and ghosts are the quiet events, and how quiet they are is what
    // decides whether this corpus measures the detector or measures masking.
    // At −20 dBFS under −4 dBFS kicks, a hat 100 ms into a kick's decay adds
    // 12 % to the flux of that decay — no detection function separates it,
    // and a corpus of those would be scoring the detector against events
    // nothing could find. −13 to −10 dBFS is still a hat under a kick and is
    // above the decay it lands in.
    if (hat) addBurst(s, at, db(uniform(rng, -13.0, -10.0)), uniform(rng, 15.0, 40.0), 4000.0, true, 0.2, rng);
    if (ghost) addBurst(s, at, db(-16.0), 40.0, 0.0, false, 0.5, rng);
    s.onsets.push_back(at);
  }
  addFloor(s, -72.0, rng);
  s.onsets = audible(s, s.onsets, &s.masked);
  return s;
}

/// Eight to fourteen decaying harmonic notes at random pitches and gaps,
/// overlapping as a played phrase does.
inline Signal melodicPhrase(std::uint64_t seed, double rate) {
  Rng rng;
  rng.seed(seed);
  Signal s;
  s.rate = rate;
  const int count = 8 + static_cast<int>(uniform(rng, 0.0, 6.99));
  std::vector<double> gaps;
  double total = 0.05;
  for (int i = 0; i < count; ++i) {
    gaps.push_back(uniform(rng, 0.15, 0.5));
    total += gaps.back();
  }
  s.x.assign(s.frames(total + 1.0), 0.0);
  double t = 0.05;
  for (int i = 0; i < count; ++i) {
    const std::size_t at = s.frames(t);
    const double midi = std::floor(uniform(rng, 48.0, 80.0));
    const double decay = uniform(rng, 200.0, 500.0);
    // Plucked, not bowed: the upper partials go first, as a string's do. Two
    // sustained bright notes a few hertz apart in a harmonic beat inside one
    // 43 Hz bin at up to a quarter of an onset's flux, and a phrase of those
    // is a corpus that measures the beating rather than the detector.
    std::vector<Partial> p;
    for (int n = 1; n <= 8; ++n) p.push_back({static_cast<double>(n), 1.0 / n, decay / std::pow(n, 0.8)});
    addTone(s, at, hz(midi), db(uniform(rng, -10.0, 0.0)), p, uniform(rng, 1.0, 3.0), 1500.0);
    s.onsets.push_back(at);
    t += gaps[static_cast<std::size_t>(i)];
  }
  addFloor(s, -72.0, rng);
  s.onsets = audible(s, s.onsets, &s.masked);
  return s;
}

/// A drum loop with a melodic phrase over it. Notes that would start within
/// 40 ms of a drum hit are dropped, so every label is one event.
inline Signal mixed(std::uint64_t seed, double rate) {
  Signal drums = drumLoop(seed, rate, false);
  Signal notes = melodicPhrase(seed ^ 0x5bd1e995u, rate);
  Signal s = drums;
  const std::size_t guard = s.frames(0.04);
  for (std::size_t at : notes.onsets) {
    bool clash = false;
    for (std::size_t d : drums.onsets) {
      if ((at > d ? at - d : d - at) < guard) clash = true;
    }
    if (clash) continue;
    Rng rng;
    rng.seed(seed + at);
    const double midi = std::floor(uniform(rng, 52.0, 76.0));
    std::vector<Partial> p;
    for (int n = 1; n <= 8; ++n) p.push_back({static_cast<double>(n), 1.0 / n, 300.0 / std::sqrt(n)});
    addTone(s, at, hz(midi), db(-8.0), p, 2.0, 1200.0);
    s.onsets.push_back(at);
  }
  std::sort(s.onsets.begin(), s.onsets.end());
  s.onsets = audible(s, s.onsets, &s.masked);
  return s;
}

/// One filtered noise burst in a short file: the unpitched one-shot.
inline Signal noiseOneShot(std::uint64_t seed, double rate) {
  Rng rng;
  rng.seed(seed);
  Signal s;
  s.rate = rate;
  const double decay = uniform(rng, 30.0, 200.0);
  s.x.assign(s.frames(0.05 + decay * 0.012 + 0.2), 0.0);
  const std::size_t at = s.frames(0.05);
  const double cutoff = uniform(rng, 0.0, 1.0) < 0.5 ? 0.0 : uniform(rng, 300.0, 6000.0);
  addBurst(s, at, db(-5.0), decay, cutoff, false, 0.5, rng);
  s.onsets.push_back(at);
  addFloor(s, -72.0, rng);
  return s;
}

/// Stationary lowpassed noise with short fades: the texture case B is for.
inline Signal noisePad(std::uint64_t seed, double rate, double seconds) {
  Rng rng;
  rng.seed(seed);
  Signal s;
  s.rate = rate;
  s.x.assign(s.frames(seconds + 0.1), 0.0);
  const std::size_t at = s.frames(0.05);
  const std::size_t len = s.frames(seconds);
  const double a = 1.0 - std::exp(-2.0 * kPi * 2000.0 / rate);
  const double fade = 0.03 * rate;
  double lp = 0.0;
  for (std::size_t i = 0; i < len && at + i < s.x.size(); ++i) {
    lp += a * (noise(rng) - lp);
    const double fi = static_cast<double>(i);
    const double fl = static_cast<double>(len - 1 - i);
    const double env = std::min(1.0, std::min(fi / fade, fl / fade));
    s.x[at + i] += db(-8.0) * env * lp * std::sqrt((2.0 - a) / a);
  }
  s.onsets.push_back(at);
  addFloor(s, -80.0, rng);
  return s;
}

/// A band-limited sawtooth whose amplitude falls linearly by `decayFraction`
/// over the file — V-7's stimulus.
inline Signal sawtoothDecay(double f0, double rate, double seconds, double decayFraction,
                            std::uint64_t seed) {
  Rng rng;
  rng.seed(seed);
  Signal s;
  s.rate = rate;
  s.f0 = f0;
  s.x.assign(s.frames(seconds + 0.1), 0.0);
  const std::size_t at = s.frames(0.05);
  const std::size_t len = s.frames(seconds);
  const double attack = 0.005 * rate;
  for (std::size_t i = 0; i < len && at + i < s.x.size(); ++i) {
    const double t = static_cast<double>(i) / rate;
    double v = 0.0;
    for (int n = 1; static_cast<double>(n) * f0 < 0.45 * rate; ++n) {
      v += std::sin(2.0 * kPi * n * f0 * t) / n;
    }
    const double fi = static_cast<double>(i);
    const double env = (fi < attack ? fi / attack : 1.0) *
                       (1.0 - decayFraction * fi / static_cast<double>(len));
    s.x[at + i] += 0.5 * env * v * (2.0 / kPi);
  }
  s.onsets.push_back(at);
  addFloor(s, -90.0, rng);
  return s;
}

// ──────────────────────────────────────────────────────────── evaluation

struct Score {
  int matched = 0;
  int detections = 0;
  int labels = 0;
  double precision() const {
    return detections > 0 ? static_cast<double>(matched) / detections : 0.0;
  }
  double recall() const { return labels > 0 ? static_cast<double>(matched) / labels : 0.0; }
  double f() const {
    const double p = precision(), r = recall();
    return p + r > 0.0 ? 2.0 * p * r / (p + r) : 0.0;
  }
};

/// Standard matching: each label takes the nearest unmatched detection within
/// the tolerance, in label order; each detection matches at most once.
inline Score scoreOnsets(const std::vector<std::size_t>& detected,
                         const std::vector<std::size_t>& labels, std::size_t tolerance,
                         const std::vector<std::size_t>& masked = {}) {
  Score sc;
  sc.labels = static_cast<int>(labels.size());
  std::vector<bool> used(detected.size(), false);
  // A detection that lands on a masked event is set aside before precision is
  // computed: it is neither a hit nor a false positive. The event is really
  // in the audio — it was placed there — and the only reason it is not a
  // label is that the mix put it below the margin at which this corpus is
  // willing to claim an onset is findable. Counting it against the detector
  // would score being right as being wrong, and a detector tuned to make that
  // number go up is a detector tuned to miss quiet hits.
  int excused = 0;
  for (std::size_t i = 0; i < detected.size(); ++i) {
    for (std::size_t m : masked) {
      const std::size_t gap = detected[i] > m ? detected[i] - m : m - detected[i];
      if (gap <= tolerance) {
        used[i] = true;
        ++excused;
        break;
      }
    }
  }
  sc.detections = static_cast<int>(detected.size()) - excused;
  for (std::size_t label : labels) {
    std::size_t best = detected.size();
    std::size_t bestGap = tolerance + 1;
    for (std::size_t i = 0; i < detected.size(); ++i) {
      if (used[i]) continue;
      const std::size_t gap = detected[i] > label ? detected[i] - label : label - detected[i];
      if (gap <= tolerance && gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    if (best < detected.size()) {
      used[best] = true;
      ++sc.matched;
    }
  }
  return sc;
}

}  // namespace mw::test::corpus
