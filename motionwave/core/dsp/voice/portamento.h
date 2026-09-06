// Motion Wave — glide: one duration law, three shapes, and arrival that is exact.
//
// `lib-voice-substrate.md` §4 and §5.6. Everything runs in semitones, always:
// a glide linear in hertz from C2 to C4 spends more than half its time in the
// top octave and sounds like a mistake, and semitones drop straight into the
// pitch sum of (7), where they are exponentiated once with everything else.
//
// **Duration is one continuous law, not a two-way switch.** (11):
//
//     duration = clamp( T · (d/12)^κ · δ ,  1 ms ,  30 s )
//
// κ = 0 is constant time and κ = 1 is constant rate, and both classical laws
// carry a documented complaint — right for an octave, a whole tone is either
// too short to notice or too slow and wails. One `pow` per note-on removes the
// argument, and VS-25's middle row is the one a switch cannot produce.
//
// **Shape is separate from duration**, and (12)'s normalisation is the whole
// point of writing it out. The obvious RC glide — a one-pole slewing toward the
// target — never arrives: the note sits permanently flat by a fraction of a
// cent and beats against the voices that did arrive. Normalising over 3.5 time
// constants so s(1) = 1 exactly is the same fix `envelope.h` applies to its
// exponential segments, and 0.1 cent is the arrival tolerance because at
// 440 Hz it is a beat once every 39 seconds, longer than any note.
//
// **The origin is where the voice actually is.** `start` has no `fromNote`, and
// its absence is the point: a caller that could pass an origin would eventually
// pass the previous *note*, and a voice interrupted mid-glide would jump to a
// new ramp instead of smearing on. It is one line of state and VS-28 asks.
//
// **Pitch is written per sample.** A per-block pitch zippers at exactly the rate
// the host's buffer size sets, so the artefact moves when the user changes
// their buffer and reads as an environment problem. The shapes are stepped by
// recurrence — one multiply for the RC, a rotation for the S-curve — in double,
// so a thirty-second glide does not drift and every block split produces the
// same samples; the target is written exactly on arrival.
//
// Real-time safe: `prepare` sizes two vectors once; `start`, `commitChord` and
// `render` are arithmetic over them. `portamento_tests.cpp` arms `RtGuard`.
#pragma once

#include <cmath>
#include <cstdint>
#include <vector>

#include "note_id.h"

namespace mw::dsp::voice {

enum class GlideTrigger : std::uint8_t {
  Off,
  /// Every note glides from where its own voice currently is.
  On,
  /// Only when the new note overlaps a held one — fingered portamento. The
  /// caller asks `NoteRegistry`, which already owns the held set, so a glide
  /// and an arpeggiator cannot disagree about whether a key was down.
  Legato,
};

enum class GlideShape : std::uint8_t { Linear, Rc, SCurve };

/// How per-voice duration offsets are derived. All three sound different.
enum class StaggerMode : std::uint8_t {
  /// By position in the chord, sorted by `StaggerOrder`: (14).
  Spread,
  /// From each voice's own interval, (15). At κ = 1 it is 1 for every voice,
  /// because a constant-rate glide already staggers arrival by interval; this
  /// puts that natural stagger back under constant time.
  IntervalDerived,
  /// Each allocator slot carries an offset drawn once from the seed, (16): the
  /// same chord glides identically twice, a repeated note on a different slot
  /// glides differently, and a bounce matches its playback.
  VoiceFixed,
};

enum class StaggerOrder : std::uint8_t { LowFirst, HighFirst, OutsideIn, InsideOut, PlayOrder };

/// The clamps of (11). Below a millisecond a ramp is a click with extra steps;
/// past thirty seconds a glide outlives its note and reads as a stuck voice.
/// Both are ours — the sheet that suggests them marks them as its own choice.
inline constexpr float kGlideMinSeconds = 0.001f;
inline constexpr float kGlideMaxSeconds = 30.0f;
/// Time constants the RC shape is normalised over, shared with the envelope.
inline constexpr float kRcTimeConstants = 3.5f;
/// (14)'s floor on δ, so a stagger of 1 cannot ask for a zero-length glide.
inline constexpr float kStaggerFloor = 0.05f;

struct GlideConfig {
  GlideTrigger trigger = GlideTrigger::Off;
  GlideShape shape = GlideShape::Rc;
  StaggerMode staggerMode = StaggerMode::Spread;
  StaggerOrder staggerOrder = StaggerOrder::LowFirst;
  /// Nominal duration for a twelve-semitone glide, seconds.
  float timeSeconds = 0.400f;
  /// The duration law: 0 constant time, 1 constant rate.
  float kappa = 0.5f;
  /// Stagger depth, 0..1.
  float stagger = 0.0f;
  std::uint64_t seed = 0x14057B7EF767814Full;
};

/// (12) and (13) as a function of progress, for a face to draw. `Glide` steps
/// the same curves by recurrence; this is the closed form they agree with.
inline float glideShape(GlideShape shape, float u) noexcept {
  u = u < 0.0f ? 0.0f : (u > 1.0f ? 1.0f : u);
  switch (shape) {
    case GlideShape::Linear:
      return u;
    case GlideShape::Rc:
      return (1.0f - std::exp(-kRcTimeConstants * u)) / (1.0f - std::exp(-kRcTimeConstants));
    case GlideShape::SCurve:
      return 0.5f * (1.0f - std::cos(3.14159265f * u));
  }
  return u;
}

class Glide {
 public:
  void prepare(double sampleRate, int voices, const GlideConfig& config) noexcept {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    const auto n = static_cast<std::size_t>(voices > 0 ? voices : 1);
    voices_.assign(n, Voice{});
    chord_.assign(n, 0);
    setConfig(config);
    reset();
  }

  /// Takes effect at the next `start`. A running glide keeps the law it was
  /// given, so a control moved mid-note cannot make a voice jump.
  void setConfig(const GlideConfig& config) noexcept {
    config_ = config;
    for (std::size_t v = 0; v < voices_.size(); ++v) {
      // Uniform in [−1, 1], fixed per slot for a seed: (16)'s component value.
      voices_[v].slotDraw = bipolar(mix(config_.seed, static_cast<std::uint64_t>(v)));
    }
  }

  void reset() noexcept {
    for (Voice& v : voices_) {
      const float draw = v.slotDraw;
      v = Voice{};
      v.slotDraw = draw;
    }
    chordCount_ = 0;
    playCounter_ = 0;
    spread_ = 0.0f;
  }

  /// Begins a glide on one voice, from wherever that voice is.
  ///
  /// `anotherKeyHeld` is whether a key other than this one was down when this
  /// one was pressed — `registry.heldCount() > 1` after the press. A voice that
  /// has never sounded, a trigger of `Off`, a non-legato note under `Legato`,
  /// and a zero interval all land on the note directly.
  void start(VoiceId voice, float toNote, bool anotherKeyHeld) noexcept {
    if (!valid(voice)) return;
    Voice& v = voices_[voice];
    const double target = static_cast<double>(toNote);
    const bool glides = config_.trigger == GlideTrigger::On ||
                        (config_.trigger == GlideTrigger::Legato && anotherKeyHeld);
    if (!glides || !v.hasPitch || target == v.current) {
      jump(v, target);
      return;
    }
    v.origin = v.current;
    v.target = target;
    v.interval = std::fabs(target - v.origin);
    v.delta = 1.0;
    v.elapsed = 0;
    v.order = playCounter_++;
    if (!v.inChord && chordCount_ < static_cast<int>(chord_.size())) {
      chord_[static_cast<std::size_t>(chordCount_++)] = voice;
      v.inChord = true;
    }
    // Provisional, at δ = 1, so a render before the commit still glides.
    arm(v);
  }

  /// Once per chord, after every `start` in it. The stagger modes that need the
  /// whole chord — the sort, the mean interval — get it here; a chord is the
  /// note-ons that arrived in one block, and one note cannot see the others.
  void commitChord() noexcept {
    const int n = chordCount_;
    if (n == 0) return;
    sortChord(n);
    double meanInterval = 0.0;
    for (int i = 0; i < n; ++i) meanInterval += voices_[chord_[static_cast<std::size_t>(i)]].interval;
    meanInterval /= static_cast<double>(n);
    double shortest = 1e9;
    double longest = 0.0;
    for (int i = 0; i < n; ++i) {
      Voice& v = voices_[chord_[static_cast<std::size_t>(i)]];
      double delta = 1.0;
      switch (config_.staggerMode) {
        case StaggerMode::Spread:
          // (14). V = 1 is 1, not 1 − S: otherwise the stagger control audibly
          // changes monophonic glide time, which reads as the control being
          // broken rather than as the law being asymmetric.
          if (n > 1) {
            delta = 1.0 + static_cast<double>(config_.stagger) *
                              (2.0 * static_cast<double>(i) / static_cast<double>(n - 1) - 1.0);
          }
          break;
        case StaggerMode::IntervalDerived:
          // (15). The exponent is 1 − κ, so at κ = 1 every voice gets 1.
          if (meanInterval > 0.0) {
            delta = std::pow(v.interval / meanInterval, 1.0 - static_cast<double>(config_.kappa));
          }
          break;
        case StaggerMode::VoiceFixed:
          delta = 1.0 + static_cast<double>(config_.stagger) * static_cast<double>(v.slotDraw);
          break;
      }
      v.delta = delta < static_cast<double>(kStaggerFloor) ? static_cast<double>(kStaggerFloor) : delta;
      arm(v);
      v.inChord = false;
      const double seconds = static_cast<double>(v.duration) / sampleRate_;
      if (seconds < shortest) shortest = seconds;
      if (seconds > longest) longest = seconds;
    }
    spread_ = static_cast<float>(longest - shortest);
    chordCount_ = 0;
  }

  /// Writes `frames` of per-sample pitch, semitones. The target is written
  /// exactly on arrival and the glide ends there.
  void render(VoiceId voice, float* pitchOut, int frames) noexcept {
    if (!valid(voice) || pitchOut == nullptr) return;
    Voice& v = voices_[voice];
    for (int i = 0; i < frames; ++i) {
      if (v.active) {
        ++v.elapsed;
        if (v.elapsed >= v.duration) {
          v.current = v.target;
          v.active = false;
        } else {
          double s = 0.0;
          switch (v.shape) {
            case GlideShape::Linear:
              s = static_cast<double>(v.elapsed) * v.invDuration;
              break;
            case GlideShape::Rc:
              v.e *= v.eStep;
              s = (1.0 - v.e) * rcNorm_;
              break;
            case GlideShape::SCurve: {
              const double c = v.c * v.cStep - v.s * v.sStep;
              v.s = v.s * v.cStep + v.c * v.sStep;
              v.c = c;
              s = 0.5 * (1.0 - c);
              break;
            }
          }
          v.current = v.origin + (v.target - v.origin) * s;
        }
      }
      pitchOut[i] = static_cast<float>(v.current);
    }
  }

  float note(VoiceId voice) const noexcept {
    return valid(voice) ? static_cast<float>(voices_[voice].current) : 0.0f;
  }
  /// Duration this voice's glide was given, for the UI's arrival display.
  float durationSeconds(VoiceId voice) const noexcept {
    return valid(voice) ? static_cast<float>(static_cast<double>(voices_[voice].duration) / sampleRate_)
                        : 0.0f;
  }
  /// max(arrival) − min(arrival) across the last committed chord, seconds.
  float arrivalSpread() const noexcept { return spread_; }
  bool gliding(VoiceId voice) const noexcept { return valid(voice) && voices_[voice].active; }
  const GlideConfig& config() const noexcept { return config_; }

 private:
  static constexpr double kPi = 3.14159265358979323846;

  struct Voice {
    double current = 0.0;
    double origin = 0.0;
    double target = 0.0;
    double interval = 0.0;
    double delta = 1.0;
    double invDuration = 0.0;
    double e = 1.0;       ///< e^(−k·u), stepped
    double eStep = 1.0;
    double c = 1.0;       ///< cos(π·u), rotated
    double s = 0.0;
    double cStep = 1.0;
    double sStep = 0.0;
    std::uint64_t elapsed = 0;
    std::uint64_t duration = 0;
    std::uint32_t order = 0;
    float slotDraw = 0.0f;
    GlideShape shape = GlideShape::Rc;
    bool hasPitch = false;
    bool active = false;
    bool inChord = false;
  };

  static std::uint64_t mix(std::uint64_t seed, std::uint64_t index) noexcept {
    std::uint64_t z = seed + (index + 1) * 0x9E3779B97F4A7C15ull;
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
    return z ^ (z >> 31);
  }
  static float bipolar(std::uint64_t h) noexcept {
    return static_cast<float>(h >> 40) * (2.0f / 16777216.0f) - 1.0f;
  }
  bool valid(VoiceId voice) const noexcept {
    return voice != kNoVoice && static_cast<std::size_t>(voice) < voices_.size();
  }

  void jump(Voice& v, double target) noexcept {
    v.current = target;
    v.origin = target;
    v.target = target;
    v.active = false;
    v.duration = 0;
    v.hasPitch = true;
  }

  /// (11) for one voice, and the recurrences primed at its current progress,
  /// so a commit that rescales a glide already rendering continues from where
  /// it is rather than restarting.
  void arm(Voice& v) noexcept {
    const double ratio = v.interval / 12.0;
    double seconds = static_cast<double>(config_.timeSeconds) *
                     std::pow(ratio, static_cast<double>(config_.kappa)) * v.delta;
    if (!(seconds >= static_cast<double>(kGlideMinSeconds))) seconds = static_cast<double>(kGlideMinSeconds);
    if (seconds > static_cast<double>(kGlideMaxSeconds)) seconds = static_cast<double>(kGlideMaxSeconds);
    const double frames = std::floor(seconds * sampleRate_ + 0.5);
    v.duration = frames < 1.0 ? 1 : static_cast<std::uint64_t>(frames);
    v.invDuration = 1.0 / static_cast<double>(v.duration);
    v.shape = config_.shape;
    const double u = static_cast<double>(v.elapsed) * v.invDuration;
    const double k = static_cast<double>(kRcTimeConstants);
    v.eStep = std::exp(-k * v.invDuration);
    v.e = std::exp(-k * u);
    v.cStep = std::cos(kPi * v.invDuration);
    v.sStep = std::sin(kPi * v.invDuration);
    v.c = std::cos(kPi * u);
    v.s = std::sin(kPi * u);
    v.hasPitch = true;
    v.active = v.elapsed < v.duration;
  }

  /// The sort key for `StaggerOrder`; only the key changes between orders.
  double keyOf(const Voice& v, double centre) const noexcept {
    switch (config_.staggerOrder) {
      case StaggerOrder::LowFirst:
        return v.target;
      case StaggerOrder::HighFirst:
        return -v.target;
      case StaggerOrder::OutsideIn:
        return -std::fabs(v.target - centre);
      case StaggerOrder::InsideOut:
        return std::fabs(v.target - centre);
      case StaggerOrder::PlayOrder:
        return static_cast<double>(v.order);
    }
    return v.target;
  }

  /// Insertion sort over at most `capacity` entries, ties broken by voice
  /// index so the result is deterministic and a golden render is stable.
  void sortChord(int n) noexcept {
    double lo = 1e9;
    double hi = -1e9;
    for (int i = 0; i < n; ++i) {
      const double t = voices_[chord_[static_cast<std::size_t>(i)]].target;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    const double centre = 0.5 * (lo + hi);
    for (int i = 1; i < n; ++i) {
      const VoiceId id = chord_[static_cast<std::size_t>(i)];
      const double key = keyOf(voices_[id], centre);
      int j = i - 1;
      while (j >= 0) {
        const VoiceId other = chord_[static_cast<std::size_t>(j)];
        const double otherKey = keyOf(voices_[other], centre);
        if (otherKey < key || (otherKey == key && other < id)) break;
        chord_[static_cast<std::size_t>(j + 1)] = other;
        --j;
      }
      chord_[static_cast<std::size_t>(j + 1)] = id;
    }
  }

  GlideConfig config_{};
  double sampleRate_ = 48000.0;
  double rcNorm_ = 1.0 / (1.0 - std::exp(-static_cast<double>(kRcTimeConstants)));
  std::vector<Voice> voices_;
  std::vector<VoiceId> chord_;
  int chordCount_ = 0;
  std::uint32_t playCounter_ = 0;
  float spread_ = 0.0f;
};

}  // namespace mw::dsp::voice
