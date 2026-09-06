// Motion Wave — the Slipstream Sampler's zone model. `smp-01` §2.3.
//
// A zone is the unit of mapping, and it is the only thing the importer in this
// directory writes. Nothing here is per voice: a voice holds state, a zone
// holds a description of a sample and where on the keyboard it lives. The
// field set follows the sheet's table, and the sheet's reason for that table
// is import and export — the de-facto opcode names of the open text mapping
// format make a zone a table lookup rather than a translation layer, so the
// names here keep that shape (`loKey`, `hiKey`, `loVel`, `hiVel`, `root`).
//
// Two fields are the importer's rather than the format's, and each exists
// because leaving it out is a known sampler bug:
//
//   `fineCents` — the sub-semitone residue of pitch detection. Storing only
//     `root` detunes every note by up to 50 cents (§3.4); V-6 measures it.
//   `dcOffset` — the whole-file mean the analysis subtracted (§3.2). The host's
//     samples are never rewritten, so the offset has to travel with the zone
//     for playback to subtract the same number; otherwise the loop points
//     found on the corrected signal sit on a step in the uncorrected one.
#pragma once

#include <cstddef>
#include <cstdint>

namespace mw::dsp::sample {

enum class LoopMode : std::uint8_t { NoLoop, Continuous, Sustain, Alternate };

/// §3.5's crossfade law: the shape follows the measured correlation at the
/// join, and the wrong one puts a ±3 dB pulse into every loop pass.
enum class CrossfadeShape : std::uint8_t { EqualGain, EqualPower };

enum class Engine : std::uint8_t { Classic, Granular, Spectral, Hybrid };

/// What §3.6's decision tree produced. Carried on the analysis rather than on
/// the zone because a slice map is many zones and the class is one fact.
enum class MapClass : std::uint8_t { Slice, Pitched, Percussive };

struct Zone {
  int loKey = 0;
  int hiKey = 127;
  int loVel = 1;
  int hiVel = 127;
  /// The key at which the read rate is `fsFile / fsHost`.
  int root = 60;
  /// −50 … +50 from detection. The field's range is ±100 so a user can move it.
  double fineCents = 0.0;
  /// Sample span in frames after trim, end exclusive.
  std::size_t start = 0;
  std::size_t end = 0;
  /// A slice's 5 ms fade over the 20 ms tail it borrows from the next slice
  /// (§3.6). Zero for every other kind of zone.
  std::size_t fadeOutFrames = 0;
  LoopMode loopMode = LoopMode::NoLoop;
  std::size_t loopStart = 0;
  std::size_t loopEnd = 0;
  std::size_t loopCrossfade = 0;
  CrossfadeShape crossfadeShape = CrossfadeShape::EqualPower;
  Engine engine = Engine::Classic;
  int roundRobinGroup = 0;
  /// 0 is no choke group. §3.6: slices default to choke off.
  int chokeGroup = 0;
  /// 0 = fixed pitch, 1 = normal, 2 = double.
  double keyTracking = 1.0;
  /// What a normalise to 0 dBTP would have applied, stored rather than done.
  double gainDb = 0.0;
  double pan = 0.0;
  double dcOffset = 0.0;
  /// §3.7 item 5: velocity layers get zero crossfade by default. In velocity
  /// units, so a value of 8 means the layers overlap over eight velocities.
  int velocityCrossfade = 0;
  /// Pitch in the 0.65–0.90 periodicity band (§3.4), or a multisample member
  /// whose name and detection disagree by other than an octave (§3.7).
  bool flagged = false;
};

}  // namespace mw::dsp::sample
