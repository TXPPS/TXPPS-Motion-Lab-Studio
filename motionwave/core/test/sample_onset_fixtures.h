// Motion Wave — the fixtures the two onset suites share.
//
// `sample_onset_tests.cpp` measures V-4 and V-5 over the twenty-file corpus;
// `sample_onset_mech_tests.cpp` holds the mechanism rows. Both need the same
// analysis call and the same isolated-burst file, and a second copy of either
// would be a second thing to keep in step.
#pragma once

#include "../dsp/sample/analyse.h"
#include "sample_corpus.h"

#include <cstdint>
#include <string>
#include <vector>

namespace mw::test::onsetfix {

using mw::dsp::sample::Analysis;
using mw::dsp::sample::Onset;
using mw::dsp::sample::Options;
using mw::dsp::sample::analyseOneShot;




inline std::vector<mw::test::corpus::Signal> theCorpus() {
  std::vector<mw::test::corpus::Signal> files;
  for (int i = 0; i < 10; ++i) {
    mw::test::corpus::Signal s = mw::test::corpus::drumLoop(1000u + static_cast<std::uint64_t>(i),
                                        i % 2 == 0 ? 44100.0 : 48000.0, i >= 8);
    s.name = "drums-" + std::to_string(i);
    files.push_back(s);
  }
  for (int i = 0; i < 5; ++i) {
    mw::test::corpus::Signal s =
        mw::test::corpus::melodicPhrase(2000u + static_cast<std::uint64_t>(i), i % 2 == 0 ? 48000.0 : 44100.0);
    s.name = "melodic-" + std::to_string(i);
    files.push_back(s);
  }
  for (int i = 0; i < 5; ++i) {
    mw::test::corpus::Signal s = mw::test::corpus::mixed(3000u + static_cast<std::uint64_t>(i), i % 2 == 0 ? 44100.0 : 48000.0);
    s.name = "mixed-" + std::to_string(i);
    files.push_back(s);
  }
  return files;
}

inline Analysis analyse(const mw::test::corpus::Signal& s) {
  const std::vector<float> f = s.asFloat();
  return analyseOneShot(f.data(), f.size(), s.rate, Options{});
}

inline std::vector<std::size_t> detections(const Analysis& a) {
  std::vector<std::size_t> out;
  for (const Onset& on : a.onsets.onsets) out.push_back(on.sample);
  return out;
}

/// A quiet file with bursts at the given samples, 44.1 kHz, −72 dBFS floor.
///
/// **The first burst must not be the first thing in the trimmed span**, and
/// getting that wrong is what made the flam case report a corpus fault as a
/// detector fault. The head trim starts the analysis at the first sound, so a
/// file whose first burst is at 200 ms into digital silence has that burst in
/// STFT frame 0 — a frame with no history behind it, whose local mean is
/// computed from forward frames only and is therefore the burst's own decay.
/// Its ratio to that mean came out at 2.04 where the same burst in open space
/// measures 3 to 5, and it was rejected. No real recording is like that:
/// there is always room tone, and the trim keeps 5 ms of it plus whatever
/// precedes the gate.
///
/// So a burst is placed at `leadMs` after a quiet marker that the trim will
/// keep. It is not a licence to make detection easy — the marker is 40 dB
/// below the bursts and its own onset is not labelled — it is what stops the
/// file from testing the one condition the STFT cannot evaluate at its own
/// first frame.
inline mw::test::corpus::Signal burstsAt(const std::vector<std::size_t>& at, double seconds, double decayMs,
                        std::uint64_t seed) {
  mw::test::corpus::Rng rng;
  rng.seed(seed);
  mw::test::corpus::Signal s;
  s.rate = 44100.0;
  s.x.assign(s.frames(seconds), 0.0);
  // Room tone across the WHOLE file, not only in front of the first burst.
  //
  // Whole-file, because a stretch of tone that stops is an event: the first
  // version of this helper laid tone up to 30 ms before the first burst, and
  // its *ending* was a spectral change large enough to detect — the flam file
  // then reported two onsets where it has one hit, and the pair three where it
  // has two, an artefact of the ruler that would have been read as the
  // detector over-triggering. Tone that is simply always there has no edges
  // and adds no events, which is what a room actually sounds like.
  for (std::size_t i = 0; i < s.x.size(); ++i) s.x[i] += mw::test::corpus::db(-46.0) * mw::test::corpus::noise(rng);
  for (std::size_t a : at) {
    mw::test::corpus::addBurst(s, a, mw::test::corpus::db(-6.0), decayMs, 0.0, false, 0.0, rng);
    s.onsets.push_back(a);
  }
  mw::test::corpus::addFloor(s, -72.0, rng);
  return s;
}


}  // namespace mw::test::onsetfix
