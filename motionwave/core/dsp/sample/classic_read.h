// Motion Wave — the Slipstream Sampler's classic read head.
//
// `smp-01` §4.2: the read increment is the whole engine,
//
//     r = 2^(pitch / 12) × fsFile / fsHost
//
// and everything else here is about reading a buffer at a position that
// advances by `r` — which interpolator, which loop rule, and when neither may
// run at all. §4.1's contract is `prepare` / `render` / `release`, with pitch
// and speed as **per-sample** arrays: a glide moves continuously, and a
// per-block pitch makes zipper noise at the host's buffer rate, which is the
// artefact that changes when the user changes a setting that should not
// matter. Nothing on the render path allocates, locks, logs or touches a file;
// `sample_loop_tests` arms `RtGuard` around every tier and loop mode.
//
// Three properties are load-bearing and each has its row:
//
// - **At `r = 1` no interpolation occurs** (V-1). A read at an integer
//   position with a unity increment copies the sample. Each kernel here is an
//   identity at zero fraction anyway, so the copy is a statement of what the
//   read is rather than a rescue; the row's real work is catching a misaligned
//   table or an off-by-one, which no identity kernel hides.
// - **A ping-pong loop never repeats its turn-around sample.** The head
//   reflects about the loop's last sample and about its first, so at unity
//   the sequence at the top is `E−2, E−1, E−2` and not `E−1, E−1`. Holding the
//   endpoint for two samples puts a step at `2/L` Hz, which on a 100 ms loop
//   is a 20 Hz buzz no filter removes.
// - **Sample start is applied at note-on only.** `prepare` snapshots it; a
//   later change to the zone moves the next note and not the sounding one.
//   Moving a sounding note's start is a jump, not a modulation, and doing it
//   continuously turns a modulation wheel into a scrub control.
//
// Loop-edge taps are wrapped per tap by the mode's own rule — periodic for a
// loop, mirrored for a ping-pong, silence past the ends — on the side the
// head is moving toward once the loop is engaged, and on the side it came from
// once it has wrapped. That is what keeps a kernel that straddles a join
// reading the material that will actually be heard on both sides of it, and
// it is what makes a loop shorter than the kernel still correct.
#pragma once

#include "../interpolate.h"
#include "mipmap.h"
#include "sinc_table.h"
#include "zone.h"

#include <cmath>
#include <cstddef>
#include <cstdint>

namespace mw::dsp::sample {

/// §7.1's Quality control. Eco is linear, Normal is four-point Hermite with the
/// pyramid above an octave, High is the stretched windowed sinc.
enum class Quality : std::uint8_t { Eco = 0, Normal = 1, High = 2 };

// `LoopMode` is the zone model's (`zone.h`), not a second one: `Sustain` loops
// until `release()` and then runs to the end, `Alternate` is the ping-pong.

/// What the read head needs from a zone. Non-owning; the zone outlives the
/// voice, and the pyramid — when there is one — belongs to the zone too.
struct ClassicSource {
  const float* data = nullptr;
  std::size_t frames = 0;
  double sampleRate = 48000.0;  ///< fsFile
  std::size_t loopStart = 0;    ///< inclusive
  std::size_t loopEnd = 0;      ///< exclusive
  LoopMode loopMode = LoopMode::NoLoop;
  std::size_t sampleStart = 0;  ///< frames; read at note-on only
  const MipMap* mip = nullptr;  ///< optional; the Normal tier above r = 2
};

/**
 * The read head's view of a `Zone` over its decoded file.
 *
 * The importer writes loop points and the trimmed span in **file** frames
 * (`zoning.h`, `loop.h`), so the file buffer is handed over whole and the
 * span's end becomes the end of playable material. `startOffset` is the
 * note's sample-start modulation in frames, applied here and nowhere later.
 * Root, fine tune, key tracking, gain and DC offset are the voice's business
 * — they arrive summed in `pitch[]` or are applied around the read — and are
 * deliberately not read here, so that they are applied exactly once.
 */
inline ClassicSource sourceFor(const Zone& zone, const float* fileData, std::size_t fileFrames,
                               double fileRate, const MipMap* mip,
                               std::size_t startOffset) noexcept {
  ClassicSource source;
  source.data = fileData;
  source.frames = zone.end < fileFrames ? zone.end : fileFrames;
  source.sampleRate = fileRate;
  source.loopStart = zone.loopStart;
  source.loopEnd = zone.loopEnd;
  source.loopMode = zone.loopMode;
  source.sampleStart = zone.start + startOffset;
  source.mip = mip;
  return source;
}

/**
 * `2^(semitones / 12)`, exact at zero and at every whole octave.
 *
 * The libm `exp2` is correct but costs about as much as the rest of a voice's
 * sample, and its last bit differs between hosts. Splitting off the nearest
 * octave leaves `|f| <= 1/2`, where seven Taylor terms of `e^(f ln 2)` are
 * within 6e-9 — nine millionths of a cent — and the integer part goes through
 * `ldexp`, which is exact. At `f = 0` every term after the constant is zero,
 * so a pitch of exactly zero gives exactly one, which V-1's condition needs.
 */
inline double semitoneRatio(double semitones) noexcept {
  const double octaves = semitones / 12.0;
  const double whole = std::nearbyint(octaves);
  const double z = (octaves - whole) * 0.69314718055994530942;
  const double p =
      1.0 + z * (1.0 + z * (1.0 / 2.0 +
                           z * (1.0 / 6.0 +
                                z * (1.0 / 24.0 +
                                     z * (1.0 / 120.0 + z * (1.0 / 720.0 + z * (1.0 / 5040.0)))))));
  return std::ldexp(p, static_cast<int>(whole));
}

class ClassicRead {
 public:
  /// No allocation. A High request without a table degrades to Normal and
  /// `quality()` says so, rather than silently reading through nothing.
  void prepare(const ClassicSource& source, const SincTable* sinc, Quality quality,
               double hostRate) noexcept {
    src_ = source;
    sinc_ = sinc;
    quality_ = (quality == Quality::High && sinc == nullptr) ? Quality::Normal : quality;
    active_ = src_.data != nullptr && src_.frames > 0 && hostRate > 0.0 && src_.sampleRate > 0.0;
    fileToHost_ = active_ ? src_.sampleRate / hostRate : 1.0;
    framesD_ = static_cast<double>(src_.frames);
    if (src_.loopEnd > src_.frames) src_.loopEnd = src_.frames;
    // A loop that cannot hold a turn-around — or anything at all — is no loop.
    const std::size_t shortest = src_.loopMode == LoopMode::Alternate ? 2 : 1;
    if (src_.loopStart + shortest > src_.loopEnd) src_.loopMode = LoopMode::NoLoop;
    looping_ = src_.loopMode != LoopMode::NoLoop;
    loopStartD_ = static_cast<double>(src_.loopStart);
    loopEndD_ = static_cast<double>(src_.loopEnd);
    loopLength_ = loopEndD_ - loopStartD_;
    // The ping-pong reflects about the last sample, not the boundary after it.
    span_ = loopLength_ - 1.0;
    // Levels the pyramid offers, less any where the loop would be shorter than
    // the nested read a wrapped tap needs (`tap` below).
    mipLevels_ = src_.mip != nullptr ? src_.mip->levels() : 0;
    while (looping_ && mipLevels_ > 0 &&
           std::ldexp(loopLength_, -mipLevels_) < 8.0) {
      --mipLevels_;
    }
    pos_ = static_cast<double>(src_.sampleStart > src_.frames ? src_.frames : src_.sampleStart);
    dir_ = 1;
    inLoop_ = looping_ && pos_ >= loopStartD_;
    wrapped_ = false;
    released_ = false;
  }

  /// `pitch` in semitones, `speed` a ratio (null means unity), both per sample.
  void render(float* out, int frames, const float* pitch, const float* speed) noexcept {
    for (int i = 0; i < frames; ++i) {
      if (!active_) {
        out[i] = 0.0f;
        continue;
      }
      const double ratio = semitoneRatio(static_cast<double>(pitch[i]));
      const double inc = ratio * fileToHost_ *
                         (speed != nullptr ? static_cast<double>(speed[i]) : 1.0) *
                         static_cast<double>(dir_);
      const double rate = inc < 0.0 ? -inc : inc;
      setEdgeRules(inc >= 0.0);
      out[i] = readAt(rate);
      advance(inc, rate);
    }
  }

  /// §4.2: a `Sustain` loop runs to the end from here. Other modes ignore it —
  /// their note ends when the owner's envelope does.
  void release() noexcept {
    released_ = true;
    if (src_.loopMode == LoopMode::Sustain) looping_ = false;
  }

  bool active() const noexcept { return active_; }
  /// The head, in level-0 frames of the zone.
  double position() const noexcept { return pos_; }
  /// +1 forward, −1 on a ping-pong's return leg.
  int direction() const noexcept { return dir_; }
  /// The tier actually in use.
  Quality quality() const noexcept { return quality_; }

 private:
  const float* levelData(int level) const noexcept {
    return level == 0 ? src_.data : src_.mip->level(level);
  }
  std::size_t levelFrames(int level) const noexcept {
    return level == 0 ? src_.frames : src_.mip->frames(level);
  }

  /// Which loop edges extend the material this sample. See the header.
  void setEdgeRules(bool forward) noexcept {
    wrapHigh_ = forward ? looping_ : wrapped_;
    wrapLow_ = forward ? wrapped_ : (looping_ && inLoop_);
    safeLo_ = wrapLow_ ? loopStartD_ : 0.0;
    safeHi_ = wrapHigh_ ? loopEndD_ : framesD_;
  }

  /// A level-0 position folded into the loop by the mode's rule.
  double wrapInto(double p) const noexcept {
    if (src_.loopMode == LoopMode::Alternate) {
      const double u = p - loopStartD_;
      const double leg = std::floor(u / span_);
      const double t = u - leg * span_;
      return loopStartD_ + (std::fmod(leg, 2.0) != 0.0 ? span_ - t : t);
    }
    double t = std::fmod(p - loopStartD_, loopLength_);
    if (t < 0.0) t += loopLength_;
    return loopStartD_ + t;
  }

  /**
   * One tap: the sample at integer index `j` of `level`, under the edge rules.
   *
   * On a pyramid level a wrapped tap can land between two samples — a loop
   * whose length is not a multiple of the level's stride has a fractional
   * period there — and it is read by a Hermite on the level itself. That is
   * the reconstruction the level's own read would make at that point, so the
   * join is consistent to the tier's own accuracy rather than to the nearest
   * sample, which for material near the level's Nyquist is not close.
   */
  float tap(int level, long long j) const noexcept {
    const double scale = std::ldexp(1.0, level);
    double p = static_cast<double>(j) * scale;
    const float* d = levelData(level);
    const std::size_t n = levelFrames(level);
    if (p >= safeLo_ && p < safeHi_) {
      return static_cast<std::size_t>(j) < n ? d[static_cast<std::size_t>(j)] : 0.0f;
    }
    if ((wrapHigh_ && p >= loopEndD_) || (wrapLow_ && p < loopStartD_)) p = wrapInto(p);
    if (p < 0.0 || p >= framesD_) return 0.0f;
    const double q = p / scale;
    const double qf = std::floor(q);
    const long long k = static_cast<long long>(qf);
    auto pick = [d, n](long long at) noexcept {
      return (at >= 0 && static_cast<std::size_t>(at) < n) ? d[static_cast<std::size_t>(at)]
                                                            : 0.0f;
    };
    if (q == qf) return pick(k);
    return hermite4(pick(k - 1), pick(k), pick(k + 1), pick(k + 2), static_cast<float>(q - qf));
  }

  float readAt(double rate) const noexcept {
    const double floored = std::floor(pos_);
    const double frac = pos_ - floored;
    const long long i = static_cast<long long>(floored);
    // The exact path. V-1's condition, stated as code.
    if (rate == 1.0 && frac == 0.0) return tap(0, i);
    switch (quality_) {
      case Quality::Eco:
        return linear2(tap(0, i), tap(0, i + 1), static_cast<float>(frac));
      case Quality::Normal: {
        const int level = MipMap::levelFor(rate, mipLevels_);
        if (level == 0) {
          return hermite4(tap(0, i - 1), tap(0, i), tap(0, i + 1), tap(0, i + 2),
                          static_cast<float>(frac));
        }
        const double q = std::ldexp(pos_, -level);
        const double qf = std::floor(q);
        const long long j = static_cast<long long>(qf);
        return hermite4(tap(level, j - 1), tap(level, j), tap(level, j + 1), tap(level, j + 2),
                        static_cast<float>(q - qf));
      }
      case Quality::High:
      default:
        return sinc_->read([this](long long k) noexcept { return tap(0, k); }, i, frac, rate);
    }
  }

  /// How far the kernel reaches past the head, so a `NoLoop` voice ends only
  /// once its trailing taps have left the buffer.
  double reach(double rate) const noexcept {
    switch (quality_) {
      case Quality::Eco:
        return 1.0;
      case Quality::Normal:
        return 2.0 * std::ldexp(1.0, MipMap::levelFor(rate, mipLevels_));
      case Quality::High:
      default:
        return static_cast<double>(SincTable::halfWidthFor(rate));
    }
  }

  void advance(double inc, double rate) noexcept {
    pos_ += inc;
    if (!looping_) {
      const double margin = reach(rate);
      if (pos_ >= framesD_ + margin || pos_ < -margin) active_ = false;
      return;
    }
    if (pos_ >= loopStartD_) inLoop_ = true;
    if (src_.loopMode == LoopMode::Alternate) {
      const double hi = loopStartD_ + span_;
      if (pos_ > hi || (pos_ < loopStartD_ && inLoop_)) {
        const double u = pos_ - loopStartD_;
        const double leg = std::floor(u / span_);
        if (std::fmod(leg, 2.0) != 0.0) dir_ = -dir_;
        pos_ = wrapInto(pos_);
        wrapped_ = true;
      }
    } else if (pos_ >= loopEndD_ || (pos_ < loopStartD_ && inLoop_)) {
      pos_ = wrapInto(pos_);
      wrapped_ = true;
    }
    // A head that never reached the loop and ran backwards off the start.
    if (!inLoop_ && pos_ < -reach(rate)) active_ = false;
  }

  ClassicSource src_;
  const SincTable* sinc_ = nullptr;
  Quality quality_ = Quality::Normal;
  double fileToHost_ = 1.0;
  double framesD_ = 0.0;
  double loopStartD_ = 0.0;
  double loopEndD_ = 0.0;
  double loopLength_ = 0.0;
  double span_ = 0.0;
  double safeLo_ = 0.0;
  double safeHi_ = 0.0;
  double pos_ = 0.0;
  int mipLevels_ = 0;
  int dir_ = 1;
  bool active_ = false;
  bool looping_ = false;
  bool inLoop_ = false;
  bool wrapped_ = false;
  bool wrapHigh_ = false;
  bool wrapLow_ = false;
  bool released_ = false;
};

}  // namespace mw::dsp::sample
