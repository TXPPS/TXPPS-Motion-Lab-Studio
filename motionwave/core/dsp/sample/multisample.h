// Motion Wave — §3.7 of `smp-01`: several files dropped together.
//
// 1. Pitch on each: the caller has run §3.1–3.6 over every file and hands in
//    what it found.
// 2. The filename's note name is a cross-check, not the answer. If it and the
//    detection differ by exactly ±12·k semitones, the filename wins — an
//    exact-octave disagreement is the signature of a detector octave error.
//    Any other disagreement, the detection wins and the file is flagged.
//    The fine tune stays with the detection in both cases: an octave error
//    leaves the sub-semitone residue intact, and the name has no residue.
// 3. Sort by root and place every boundary at the arithmetic midpoint.
// 4. Report the worst-case transposition rather than hiding it. Roots a minor
//    third apart never transpose a key by more than ±1 semitone; the figure
//    is reported over the keys between the roots, and separately over the
//    whole keyboard, because the extension below the lowest root to key 0 is
//    a transposition nobody chose and it would swamp the number that matters.
// 5. Velocity layers — members sharing a root — are ordered by loudness with
//    boundaries at the midpoints and zero crossfade: two separately recorded
//    layers are uncorrelated, so any crossfade between them phases.
//
// The one thing this file cannot tell: which octave convention named the
// files. C4 = 60 is scientific pitch notation and the default; a library
// named with C3 = 60 disagrees with every detection by exactly an octave and
// rule 2 then takes every filename. `middleCOctave` is the setting for that,
// and the report says how many members the rule moved so a user can see it.
#pragma once

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstddef>
#include <string>
#include <vector>

#include "measure.h"
#include "pitch.h"
#include "zone.h"

namespace mw::dsp::sample {

struct MultisampleMember {
  std::string name;
  int detectedRoot = 60;
  double detectedFine = 0.0;
  PitchClass pitchClass = PitchClass::Unpitched;
  double loudnessDb = kSilenceDb;
  /// The member's own zone from §3.6 — span, loop, gain, DC — before mapping.
  Zone zone;
};

struct MemberReport {
  /// −1 when the name carried no note.
  int filenameNote = -1;
  int root = 60;
  bool filenameUsed = false;
  bool flagged = false;
};

struct Multisample {
  /// One per member, in member order.
  std::vector<Zone> zones;
  std::vector<MemberReport> members;
  /// Over the keys between the lowest and highest root, in semitones.
  int worstTransposition = 0;
  /// Over every key, including the extension to 0 and 127.
  int worstTranspositionFullRange = 0;
  int distinctRoots = 0;
  /// The most velocity layers at any one root.
  int layers = 1;
  int filenameOverrides = 0;
};

inline int noteLetterIndex(char letter) {
  switch (static_cast<char>(std::toupper(static_cast<unsigned char>(letter)))) {
    case 'C': return 0;
    case 'D': return 2;
    case 'E': return 4;
    case 'F': return 5;
    case 'G': return 7;
    case 'A': return 9;
    case 'B': return 11;
    default: return -1;
  }
}

/**
 * The first note-name token in a filename — a letter, an optional `#`, `s`
 * or `b`, an optional minus, one or two digits — bounded by non-alphanumerics
 * on both sides, so "Bass2" and "Web3" are not notes. −1 when there is none.
 */
inline int parseNoteName(const std::string& name, int middleCOctave) {
  const auto alnum = [](char ch) { return std::isalnum(static_cast<unsigned char>(ch)) != 0; };
  for (std::size_t i = 0; i < name.size(); ++i) {
    const int semi = noteLetterIndex(name[i]);
    if (semi < 0) continue;
    if (i > 0 && alnum(name[i - 1])) continue;
    std::size_t j = i + 1;
    int accidental = 0;
    if (j < name.size() && (name[j] == '#' || name[j] == 's')) {
      accidental = 1;
      ++j;
    } else if (j < name.size() && name[j] == 'b') {
      accidental = -1;
      ++j;
    }
    bool negative = false;
    if (j < name.size() && name[j] == '-') {
      negative = true;
      ++j;
    }
    int octave = 0;
    std::size_t digits = 0;
    while (j < name.size() && digits < 2 && std::isdigit(static_cast<unsigned char>(name[j])) != 0) {
      octave = octave * 10 + (name[j] - '0');
      ++j;
      ++digits;
    }
    if (digits == 0) continue;
    if (j < name.size() && alnum(name[j])) continue;
    if (negative) octave = -octave;
    const int midi = 12 * (octave + 1 + (4 - middleCOctave)) + semi + accidental;
    if (midi < 0 || midi > 127) continue;
    return midi;
  }
  return -1;
}

/// Rule 2. The detection is the answer unless the name disagrees by an exact
/// octave, or there was no detection at all.
inline MemberReport crossCheck(const MultisampleMember& m, int middleCOctave) {
  MemberReport rep;
  rep.filenameNote = parseNoteName(m.name, middleCOctave);
  rep.root = m.detectedRoot;
  const bool detected = m.pitchClass != PitchClass::Unpitched;
  if (rep.filenameNote < 0) {
    rep.flagged = !detected;
    return rep;
  }
  if (!detected) {
    rep.root = rep.filenameNote;
    rep.filenameUsed = true;
    rep.flagged = true;
    return rep;
  }
  const int diff = rep.filenameNote - m.detectedRoot;
  if (diff == 0) return rep;
  if (diff % 12 == 0) {
    rep.root = rep.filenameNote;
    rep.filenameUsed = true;
    return rep;
  }
  rep.flagged = true;
  return rep;
}

/// Rules 2–5 over a set of analysed members.
inline Multisample buildMultisample(const std::vector<MultisampleMember>& members,
                                    int middleCOctave) {
  Multisample ms;
  const std::size_t n = members.size();
  ms.zones.resize(n);
  ms.members.resize(n);
  if (n == 0) return ms;
  for (std::size_t i = 0; i < n; ++i) {
    ms.members[i] = crossCheck(members[i], middleCOctave);
    if (ms.members[i].filenameUsed) ++ms.filenameOverrides;
  }

  std::vector<int> roots;
  for (const MemberReport& rep : ms.members) roots.push_back(rep.root);
  std::sort(roots.begin(), roots.end());
  roots.erase(std::unique(roots.begin(), roots.end()), roots.end());
  const std::size_t k = roots.size();
  ms.distinctRoots = static_cast<int>(k);

  // Rule 3: hikey_r = floor of the midpoint; the key above it starts the next.
  // An integer midpoint goes to the lower zone, so a two-semitone spacing
  // still transposes by at most one either way.
  std::vector<int> lo(k), hi(k);
  for (std::size_t r = 0; r < k; ++r) {
    lo[r] = r == 0 ? 0 : hi[r - 1] + 1;
    hi[r] = r + 1 < k ? static_cast<int>(std::floor(0.5 * static_cast<double>(roots[r] + roots[r + 1])))
                      : 127;
  }
  const auto zoneOf = [&](int key) {
    std::size_t r = 0;
    while (r + 1 < k && key > hi[r]) ++r;
    return r;
  };
  for (int key = 0; key <= 127; ++key) {
    const int t = std::abs(key - roots[zoneOf(key)]);
    ms.worstTranspositionFullRange = std::max(ms.worstTranspositionFullRange, t);
    if (key >= roots.front() && key <= roots.back()) {
      ms.worstTransposition = std::max(ms.worstTransposition, t);
    }
  }

  for (std::size_t i = 0; i < n; ++i) {
    Zone z = members[i].zone;
    z.root = ms.members[i].root;
    z.fineCents = members[i].detectedFine;
    z.keyTracking = 1.0;
    z.flagged = z.flagged || ms.members[i].flagged;
    const std::size_t r = static_cast<std::size_t>(
        std::lower_bound(roots.begin(), roots.end(), z.root) - roots.begin());
    z.loKey = lo[r];
    z.hiKey = hi[r];
    z.loVel = 1;
    z.hiVel = 127;
    z.velocityCrossfade = 0;
    ms.zones[i] = z;
  }

  // Rule 5: layers by loudness. Loudness maps linearly in dB onto 1 … 127 and
  // the boundaries sit at the midpoints between adjacent members' positions.
  for (std::size_t r = 0; r < k; ++r) {
    std::vector<std::size_t> group;
    for (std::size_t i = 0; i < n; ++i) {
      if (ms.members[i].root == roots[r]) group.push_back(i);
    }
    if (group.size() < 2) continue;
    ms.layers = std::max(ms.layers, static_cast<int>(group.size()));
    std::sort(group.begin(), group.end(), [&](std::size_t a, std::size_t b) {
      return members[a].loudnessDb < members[b].loudnessDb;
    });
    const double quietest = members[group.front()].loudnessDb;
    const double loudest = members[group.back()].loudnessDb;
    std::vector<double> position(group.size());
    for (std::size_t g = 0; g < group.size(); ++g) {
      position[g] = loudest > quietest
                        ? 1.0 + 126.0 * (members[group[g]].loudnessDb - quietest) / (loudest - quietest)
                        : 1.0 + 126.0 * static_cast<double>(g) / static_cast<double>(group.size() - 1);
    }
    int lower = 1;
    for (std::size_t g = 0; g < group.size(); ++g) {
      const int upper =
          g + 1 < group.size() ? static_cast<int>(std::floor(0.5 * (position[g] + position[g + 1])))
                               : 127;
      Zone& z = ms.zones[group[g]];
      z.loVel = std::min(lower, 127);
      z.hiVel = std::max(z.loVel, std::min(upper, 127));
      lower = z.hiVel + 1;
    }
  }
  return ms;
}

}  // namespace mw::dsp::sample
