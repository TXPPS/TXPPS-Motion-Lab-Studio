// Motion Wave — §3.6 of `smp-01`: one decision tree, evaluated once.
//
//   onsets ≥ 4, median inter-onset < 1.5 s, not pitched  →  slice map
//   pitched (periodicity ≥ 0.90)                          →  pitched map
//   otherwise                                             →  percussive map
//
// A slice map is one zone per slice, chromatic upward from MIDI 36, key
// tracking 0 — a slice does not transpose with the key — and no loop. Slice n
// spans [onset_n, onset_{n+1}) *plus a 20 ms tail with a 5 ms fade*: cut
// exactly at the next onset, the previous hit's decay is truncated at full
// amplitude and every slice ends in a click. The overlap is harmless because
// slices played in order do not retrigger each other. Choke is off by default
// — a shared choke group makes fast retriggering cut the previous slice,
// which sounds tidier and destroys the loop's own decay tails; it is a
// musical choice, not a default (§13 item 13 leaves it open).
//
// The percussive map carries a case B loop when one is found. The tree's row
// for it says nothing about loops, but §3.5 case B exists for "noise, pad,
// texture", and the tree routes every one of those here; without this, case
// B is unreachable and a pad never loops.
//
// Every loop the importer writes is `loop_sustain` — loop while the key is
// held, then run to the end — because a one-shot with a natural release
// after its loop is what a sampled instrument is, and `loop_continuous`
// cannot play that release. Ours; §7.1 says only "detected".
#pragma once

#include <algorithm>
#include <cstddef>
#include <vector>

#include "conditioning.h"
#include "loop.h"
#include "measure.h"
#include "onset.h"
#include "pitch.h"
#include "zone.h"

namespace mw::dsp::sample {

struct ZoningOptions {
  /// §3.6's slice condition. The sheet's [I] values, bracketed by V-9.
  int minSlices = 4;
  double maxMedianIoiSeconds = 1.5;
  /// §3.6: the 20 ms tail and 5 ms fade a slice borrows. The sheet's [I] values.
  double sliceTailMs = 20.0;
  double sliceFadeMs = 5.0;
  /// §3.6: chromatic from C1, the convention several hosts share. [R]
  int sliceBaseKey = 36;
  /// §3.6: the percussive map's root.
  int percussiveRoot = 60;
  /// §3.6: choke off. [I], and §13 item 13 calls it a taste question.
  bool sliceChoke = false;
};

inline double medianInterOnsetSeconds(const std::vector<Onset>& onsets, double rate) {
  std::vector<double> gaps;
  for (std::size_t i = 1; i < onsets.size(); ++i) {
    gaps.push_back(static_cast<double>(onsets[i].sample - onsets[i - 1].sample) / rate);
  }
  return median(gaps);
}

inline MapClass classify(std::size_t onsetCount, double medianIoiSeconds, PitchClass pitchClass,
                         const ZoningOptions& o) {
  const bool dense = onsetCount >= static_cast<std::size_t>(std::max(0, o.minSlices)) &&
                     medianIoiSeconds < o.maxMedianIoiSeconds;
  if (dense && pitchClass != PitchClass::Pitched) return MapClass::Slice;
  if (pitchClass == PitchClass::Pitched) return MapClass::Pitched;
  return MapClass::Percussive;
}

/// The fields every zone the importer writes shares: the trimmed span, the
/// gain that was not applied, and the DC that was taken off the analysis copy.
inline Zone baseZone(const Conditioning& c) {
  Zone z;
  z.start = c.start;
  z.end = c.end;
  z.gainDb = c.gainDb;
  z.dcOffset = c.dcRemoved ? c.dcOffset : 0.0;
  return z;
}

inline void applyLoop(Zone& z, const LoopResult& loop) {
  if (loop.kind == LoopKind::None) {
    z.loopMode = LoopMode::NoLoop;
    return;
  }
  z.loopMode = LoopMode::Sustain;
  z.loopStart = loop.start;
  z.loopEnd = loop.end;
  z.loopCrossfade = loop.crossfade;
  z.crossfadeShape = loop.shape;
}

/// §3.6's slice map. Slices past key 127 are not written: a loop with more
/// than 92 hits has no keyboard to land on, and a zone at a key it cannot
/// have would be a control that does nothing.
inline std::vector<Zone> sliceMap(const Conditioning& c, const std::vector<Onset>& onsets,
                                  double rate, const ZoningOptions& o) {
  std::vector<Zone> zones;
  const std::size_t tail = framesFor(o.sliceTailMs, rate);
  const std::size_t fade = framesFor(o.sliceFadeMs, rate);
  for (std::size_t n = 0; n < onsets.size(); ++n) {
    const int key = o.sliceBaseKey + static_cast<int>(n);
    if (key > 127) break;
    Zone z = baseZone(c);
    z.start = onsets[n].sample;
    z.end = n + 1 < onsets.size() ? std::min(c.end, onsets[n + 1].sample + tail) : c.end;
    if (z.end < z.start) z.end = z.start;
    z.fadeOutFrames = std::min(fade, z.end - z.start);
    z.loKey = key;
    z.hiKey = key;
    // Root is the slice's own key so that switching key tracking on plays the
    // slice at pitch on the key it already lives on.
    z.root = key;
    z.fineCents = 0.0;
    z.keyTracking = 0.0;
    z.loopMode = LoopMode::NoLoop;
    z.chokeGroup = o.sliceChoke ? 1 : 0;
    zones.push_back(z);
  }
  return zones;
}

inline Zone pitchedZone(const Conditioning& c, const PitchResult& p, const LoopResult& loop) {
  Zone z = baseZone(c);
  z.root = p.root;
  z.fineCents = p.fineCents;
  z.keyTracking = 1.0;
  z.flagged = p.classification == PitchClass::Flagged;
  applyLoop(z, loop);
  return z;
}

inline Zone percussiveZone(const Conditioning& c, const LoopResult& loop, const ZoningOptions& o) {
  Zone z = baseZone(c);
  z.root = o.percussiveRoot;
  z.fineCents = 0.0;
  z.keyTracking = 0.0;
  applyLoop(z, loop);
  return z;
}

}  // namespace mw::dsp::sample
