// Motion Wave — §3.1 of `smp-01`: the importer's pipeline, in the sheet's order.
//
//   1. decode to float32 at the file's native rate      — the host's
//   2. DC measurement and removal                        — conditioning.h
//   3. true peak and loudness, stored as a gain          — conditioning.h
//   4. silence trim                                      — conditioning.h
//   5. onsets over the trimmed span                      — onset.h
//   6. pitch over the sustain region                     — pitch.h
//   7. loop search, which needs step 6's period          — loop.h
//   8. zoning, which needs steps 5 and 6                 — zoning.h
//
// Everything here runs off the audio thread, once, at load. It allocates
// freely and writes only into the zone model; none of it may run on a
// note-on, because the analysis is hundreds of milliseconds of work and the
// audio callback has 5.33 ms.
//
// **Native rate, never resampled.** Resampling before analysis moves every
// onset and loop candidate off the sample indices the file actually has, and
// adds a generation of interpolation error to material that is about to be
// interpolated again at playback. The rate ratio belongs in the playback
// increment, where it costs nothing.
//
// The sustain region the loop search sees is ours: the trimmed span less the
// attack — the larger of 20 ms and a tenth of the span — and less the 50 ms
// tail pad the trim added. A loop placed inside the attack repeats the
// transient; one placed in the pad repeats the noise floor.
#pragma once

#include <algorithm>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "conditioning.h"
#include "loop.h"
#include "multisample.h"
#include "onset.h"
#include "pitch.h"
#include "zone.h"
#include "zoning.h"

namespace mw::dsp::sample {

struct Options {
  /// A_ref for ν = 69 + 12·log2(f0 / A_ref). A setting, not a constant, for
  /// the reason `syn-01` §3.3 gives: an orchestra at 442 is not out of tune.
  double referencePitchHz = 440.0;
  /// The octave number of middle C in filenames. 4 is scientific pitch
  /// notation and the common library convention; a C3 = 60 library sets 3.
  int middleCOctave = 4;
  /// The sustain region's attack skip. Ours.
  double sustainSkipMs = 20.0;
  double sustainSkipFraction = 0.1;
  ConditioningOptions conditioning;
  OnsetOptions onset;
  PitchOptions pitch;
  LoopOptions loop;
  ZoningOptions zoning;
};

struct Analysis {
  double rate = 0.0;
  /// The analysis copy: the file with its DC removed and nothing else done.
  std::vector<double> signal;
  Conditioning conditioning;
  OnsetResult onsets;
  PitchResult pitch;
  LoopResult loop;
  double medianInterOnsetSeconds = 0.0;
  MapClass mapClass = MapClass::Percussive;
  std::vector<Zone> zones;
  std::size_t sustainBegin = 0;
  std::size_t sustainEnd = 0;
};

/// Steps 2–8 for one mono file already decoded at its native rate.
inline Analysis analyseOneShot(const float* mono, std::size_t frames, double fileRate,
                               const Options& o) {
  Analysis a;
  a.rate = fileRate;
  a.signal.resize(frames);
  for (std::size_t i = 0; i < frames; ++i) a.signal[i] = static_cast<double>(mono[i]);
  a.conditioning = condition(a.signal, fileRate, o.conditioning);
  const Conditioning& c = a.conditioning;

  a.onsets = detectOnsets(a.signal, c.start, c.end, fileRate, fromDb(c.noiseFloorDb), o.onset);
  a.pitch = detectPitch(a.signal, c.start, c.end, fileRate, o.referencePitchHz, o.pitch);
  a.medianInterOnsetSeconds = medianInterOnsetSeconds(a.onsets.onsets, fileRate);
  a.mapClass =
      classify(a.onsets.onsets.size(), a.medianInterOnsetSeconds, a.pitch.classification, o.zoning);

  const std::size_t span = c.end > c.start ? c.end - c.start : 0;
  const std::size_t skip = std::max(
      framesFor(o.sustainSkipMs, fileRate),
      static_cast<std::size_t>(o.sustainSkipFraction * static_cast<double>(span)));
  const std::size_t pad = framesFor(o.conditioning.tailPadMs, fileRate);
  a.sustainBegin = std::min(c.end, c.start + skip);
  a.sustainEnd = c.end > a.sustainBegin + pad ? c.end - pad : c.end;

  if (a.mapClass == MapClass::Pitched) {
    a.loop = findPeriodLoop(a.signal, a.sustainBegin, a.sustainEnd, a.pitch.period, fileRate, o.loop);
    if (a.loop.kind == LoopKind::None) {
      a.loop = findStationaryLoop(a.signal, a.sustainBegin, a.sustainEnd, fileRate, o.loop);
    }
    a.zones.push_back(pitchedZone(c, a.pitch, a.loop));
  } else if (a.mapClass == MapClass::Percussive) {
    a.loop = findStationaryLoop(a.signal, a.sustainBegin, a.sustainEnd, fileRate, o.loop);
    a.zones.push_back(percussiveZone(c, a.loop, o.zoning));
  } else {
    a.zones = sliceMap(c, a.onsets.onsets, fileRate, o.zoning);
  }
  return a;
}

struct MultisampleInput {
  const float* mono = nullptr;
  std::size_t frames = 0;
  double fileRate = 0.0;
  std::string name;
};

struct MultisampleAnalysis {
  std::vector<Analysis> files;
  Multisample map;
};

/// §3.7: every file through steps 2–8, then the cross-check, the boundaries,
/// the transposition report and the layers.
inline MultisampleAnalysis analyseMultisample(const std::vector<MultisampleInput>& inputs,
                                              const Options& o) {
  MultisampleAnalysis ms;
  std::vector<MultisampleMember> members;
  for (const MultisampleInput& in : inputs) {
    Analysis a = analyseOneShot(in.mono, in.frames, in.fileRate, o);
    MultisampleMember m;
    m.name = in.name;
    m.detectedRoot = a.pitch.root;
    m.detectedFine = a.pitch.fineCents;
    m.pitchClass = a.pitch.classification;
    m.loudnessDb = a.conditioning.loudnessDb;
    // A member is always the one-zone form of its file. A multisample is
    // pitched material by definition, and a slice map of one member would
    // have nowhere to go on a keyboard the other members share.
    m.zone = pitchedZone(a.conditioning, a.pitch, a.loop);
    members.push_back(std::move(m));
    ms.files.push_back(std::move(a));
  }
  ms.map = buildMultisample(members, o.middleCOctave);
  return ms;
}

}  // namespace mw::dsp::sample
