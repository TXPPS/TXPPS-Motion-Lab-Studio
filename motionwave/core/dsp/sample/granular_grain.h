// Motion Wave — one grain of the Slipstream Sampler's granular engine.
//
// `smp-01` §4.3 and `fx-02` §1. A grain here is a windowed read of a *zone*,
// and that is the one thing it does not share with `dsp/grain/grain.h`: that
// grain reads a power-of-two circular buffer through a mask, because an effect
// granulates a delay line whose only structure is a write head. A zone is a
// linear span with loop points, a trimmed end, a mip pyramid and a quality
// tier, and none of those survive a mask wrap.
//
// So the read is `ClassicRead`'s — the same head, the same kernels, the same
// loop-edge rules — rather than a second implementation of it. That is what
// makes V-21's null *bit-exact* rather than merely close: at scatter 0 the
// voice runs one grain whose head was prepared exactly as the classic engine's
// would be, so the two are not two evaluations that agree, they are one
// evaluation. A grain that re-derived the read would have to be graded against
// the classic engine instead of nulled against it, and a −100 dBc grade cannot
// tell a correct interpolator from one that is wrong in the ninth bit.
//
// The window, its mean-square constant and the deterministic generator come
// from `dsp/grain/` unchanged. There is no second window table and no second
// PRNG anywhere under this directory.
#pragma once

#include "../grain/rng.h"
#include "../grain/window.h"
#include "classic_read.h"

#include <cmath>
#include <cstddef>
#include <cstdint>

namespace mw::dsp::sample {

/// §7.3's granular block, in the units the sheet's table states.
struct GranularParams {
  /// 5…500 ms. Below 15 ms the window colours the tone (`fx-02` §1.1).
  float grainMs = 60.0f;
  /// 1…500 Hz, per voice. `fx-02`'s thousands are an effect figure.
  float densityHz = 40.0f;
  /// Position spray, 0…100 %, as a fraction of the grain length's own span.
  float spray = 0.40f;
  /// Onset jitter, 0…100 %. Zero is quasi-synchronous, one is Poisson.
  float jitter = 0.50f;
  /// Grain-length jitter, 0…100 %.
  float lengthJitter = 0.20f;
  /// Per-grain detune, 0…100 cents.
  float pitchSpreadCents = 0.0f;
  /// Speed ρ ∈ [−4, +4]. Zero is freeze, with a ±0.01 dead zone.
  float speed = 1.0f;
  grain::WindowShape shape = grain::WindowShape::Hann;
  float tukeyAlpha = 1.0f;

  /**
   * True when every randomisable dimension is off.
   *
   * §4.3 item 4 requires scatter 0 to *collapse to a plain interpolated read*,
   * and the word is collapse rather than approach. A limit — spray driven to
   * zero while the grain machinery still runs — leaves the window, the
   * overlap-add and the normalisation in the path, and their product is one
   * only in the limit of infinite overlap. It measured −38 dBFS against the
   * classic engine when it was written that way, which is not a null; the
   * branch below measures exactly zero.
   */
  bool scatterZero() const noexcept {
    return spray <= 0.0f && jitter <= 0.0f && lengthJitter <= 0.0f && pitchSpreadCents <= 0.0f;
  }
};

/// Per-voice pool sizes, §10.3 and §4.3 item 1. Slots, not overlap — see
/// `poolSafeOverlap` for why the two are different numbers.
inline int grainPoolFor(Quality quality) noexcept {
  switch (quality) {
    case Quality::Eco:
      return 8;
    case Quality::High:
      return 64;
    case Quality::Normal:
    default:
      return 16;
  }
}

/// §10.3's `Max granular O` column: the overlap ceiling each tier is allowed.
inline float overlapCeilingFor(Quality quality) noexcept {
  switch (quality) {
    case Quality::Eco:
      return 4.0f;
    case Quality::High:
      return 32.0f;
    case Quality::Normal:
    default:
      return 12.0f;
  }
}

/**
 * The largest mean overlap this pool can hold with drops at 1 in 10⁶.
 *
 * **§10.3's `O` column and the per-voice pool sizes cannot both be honoured,
 * and this is where that is resolved.** The onset series is Poisson at full
 * jitter, so the number of grains sounding at once is Poisson with mean `O` —
 * it is not `O` grains, it is `O` on average with a tail. `grain/pool.h` sizes
 * the effect's shared pool by that tail and arrives at 2.13× the mean; run the
 * same arithmetic on a per-voice pool of 8 against §10.3's Eco overlap of 4 and
 * the tail past 8 slots is 2.1 % — one grain in fifty would be dropped, and
 * §10.3 says grains are never dropped.
 *
 * The two rules conflict, so the one the sheet states as inviolable wins: the
 * rate is reduced until the pool can hold the cloud. That costs density on the
 * small tiers, which is what a tier is for, and it keeps `dropped() == 0` a
 * design guarantee rather than a hope. The cost is stated rather than hidden —
 * `clampedDensity()` is what the UI shows, so an Eco user is told the density
 * they are getting.
 *
 * `lift` is the worst-case factor by which length jitter raises the mean count
 * above `R·L`: a grain jittered longer is sounding for longer, so the expected
 * population rises even though the rate has not. Length jitter is bounded at
 * ±50 % of the grain in `spawnOne`, giving 1.25 at the maximum setting.
 *
 * Evaluated at `prepare` and on a parameter change, never per sample: the
 * bisection below is about fifty Poisson sums and has no business on the audio
 * path.
 */
inline double poissonTailAbove(double mean, int slots) noexcept {
  // Sum the body and subtract, which is stable here because `mean` never
  // exceeds the slot count by much and the terms fall away fast past it.
  double term = std::exp(-mean);
  double body = term;
  for (int k = 1; k <= slots; ++k) {
    term *= mean / static_cast<double>(k);
    body += term;
  }
  const double tail = 1.0 - body;
  return tail < 0.0 ? 0.0 : tail;
}

inline float poolSafeOverlap(int slots, double lift) noexcept {
  double lo = 0.0;
  double hi = static_cast<double>(slots);
  // Fifty halvings resolve the answer to about 1e-14 of a slot, which is far
  // past anything the density control can express.
  for (int i = 0; i < 50; ++i) {
    const double mid = 0.5 * (lo + hi);
    if (poissonTailAbove(mid * lift, slots) <= 1.0e-6) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return static_cast<float>(lo);
}

/**
 * The overlap this pool can hold at a given onset jitter.
 *
 * **The Poisson bound above is the worst case, not the case.** It assumes a
 * fully stochastic onset series, which is what `jitter = 1` produces — and
 * `Scheduler::nextHop` interpolates between a constant hop and an exponential
 * draw exactly as this interpolates between the two bounds. At `jitter = 0` the
 * onsets are evenly spaced, the live count is `O` plus the length lift and
 * nothing else, and a pool of `slots` holds `slots / lift` of them
 * deterministically. Applying the Poisson bound there would cost Eco five sixths
 * of its density to insure against a variance its scheduler does not have: the
 * cap came out at O = 0.79 against §10.3's 4, which is a gappy cloud at every
 * setting the user can reach, and a tier that cannot make a continuous sound is
 * not a cheaper tier but a broken one.
 *
 * Interpolating on the jitter is the same shape of answer `nextHop` gives and
 * for the same reason: the *mean* is the set rate at every jitter, and only the
 * spread around it changes. So the headroom the pool must hold changes with it
 * too, and the cap tracks the scheduler it is protecting rather than a fixed
 * assumption about what the scheduler might be doing.
 */
inline float poolOverlapAt(int slots, double lift, float jitter) noexcept {
  const double j = jitter < 0.0f ? 0.0 : (jitter > 1.0f ? 1.0 : static_cast<double>(jitter));
  const double deterministic = static_cast<double>(slots) / lift;
  const double stochastic = static_cast<double>(poolSafeOverlap(slots, lift));
  return static_cast<float>(deterministic + j * (stochastic - deterministic));
}

/**
 * One live grain: a read head, a window phase, and the amplitude it was born
 * with.
 *
 * The read head is a whole `ClassicRead` per grain rather than a position and
 * an increment, and it costs about 200 bytes a slot. That is the price of the
 * paragraph at the top of this file, and at the High tier's 64 slots it is
 * 13 kB a voice — allocated once in the voice, never on the audio path.
 */
struct SampleGrain {
  ClassicRead head;
  float windowPhase = 0.0f;
  float windowInc = 0.0f;
  int remaining = 0;
  float amplitude = 1.0f;
  float pitchOffset = 0.0f;  ///< semitones, this grain's own detune
  grain::WindowShape shape = grain::WindowShape::Hann;
  float tukeyAlpha = 1.0f;
  /// The window value the last rendered sample used, so a readout never
  /// recomputes what the audio already decided (`CLAUDE.md`'s one-evaluation
  /// rule). Zero until the grain has rendered its first sample.
  float lastWindow = 0.0f;
};

/**
 * Arm a grain over a zone at a given read position.
 *
 * `startFrames` is where in the zone this grain begins, already sprayed. It is
 * handed to `ClassicRead` as the source's `sampleStart`, which is the same
 * field the classic engine's note-on uses — so a grain at the playhead with no
 * spray prepares a head identical to the one a classic note-on prepares, and
 * that identity is what V-21 is measuring.
 *
 * `onsetFraction` moves the window's phase as well as the read position. Moving
 * only the read leaves every envelope quantised to the sample grid, which is
 * the block-rate buzz `fx-02` §1.4 names as the most likely first-implementation
 * bug — and it is invisible in a spectrum of the grain itself, because each
 * grain is individually correct.
 */
inline void armGrain(SampleGrain* grain, const ClassicSource& zone, const SincTable* sinc,
                     Quality quality, double hostRate, double startFrames, int lengthSamples,
                     float amplitude, float pitchOffsetSemitones, float onsetFraction,
                     grain::WindowShape shape, float tukeyAlpha) noexcept {
  ClassicSource source = zone;
  const double clamped = startFrames < 0.0 ? 0.0 : startFrames;
  source.sampleStart = static_cast<std::size_t>(clamped);
  grain->head.prepare(source, sinc, quality, hostRate);
  grain->remaining = lengthSamples < 1 ? 1 : lengthSamples;
  grain->windowInc = 1.0f / static_cast<float>(grain->remaining);
  grain->windowPhase = onsetFraction * grain->windowInc;
  grain->amplitude = amplitude;
  grain->pitchOffset = pitchOffsetSemitones;
  grain->shape = shape;
  grain->tukeyAlpha = tukeyAlpha;
  grain->lastWindow = 0.0f;
}

/**
 * One sample from one grain. Returns false when the grain is finished.
 *
 * `pitch` is the note's semitone value for this sample; the grain adds its own
 * detune. The two are summed *before* the ratio is taken rather than after,
 * because `semitoneRatio` is exponential and a product of two ratios is a sum
 * of two semitone values — doing it the other way round makes a 100-cent spread
 * mean something slightly different at every pitch, which is audible as the
 * spread widening as a glide rises.
 */
inline bool renderGrainSample(SampleGrain* grain, float pitch, float* out) noexcept {
  if (grain->remaining <= 0) return false;
  const float window = grain::windowAt(grain->shape, grain->windowPhase, grain->tukeyAlpha);
  const float notePitch = pitch + grain->pitchOffset;
  float sample = 0.0f;
  // The grain's read is at its own pitch and at unity speed: the playhead's
  // speed ρ moves *where grains are taken from* and never how fast one is read.
  // That decoupling is §4.3's whole point, and reading a grain at ρ would put
  // the material drift back that the engine exists to remove.
  grain->head.render(&sample, 1, &notePitch, nullptr);
  *out += sample * window * grain->amplitude;
  grain->lastWindow = window;
  grain->windowPhase += grain->windowInc;
  return --grain->remaining > 0;
}

/**
 * The seed for one note's draws, §4.6.
 *
 * Every random draw the voice makes comes from here and nothing comes from a
 * free-running generator. `CLAUDE.md` names offline bounce parity as a thing
 * that must not break, and MotionLab's parity is asserted by rendering the same
 * bars twice and comparing: a free-running generator makes that comparison fail
 * by construction, and the failure looks like a DSP bug rather than a seeding
 * bug, which is the most expensive shape a failure can have.
 *
 * The four fields are mixed rather than added because a note number and a voice
 * slot are both small integers, and adding them makes note 61 on slot 3 and
 * note 60 on slot 4 the same stream — two voices of one chord rendering
 * identical grain patterns, which sounds like a phasing artefact and reads as a
 * DSP bug too.
 */
inline std::uint64_t noteSeed(int noteNumber, std::uint64_t noteStartTick, int voiceSlot,
                              std::uint64_t instrumentSeed) noexcept {
  std::uint64_t h = instrumentSeed;
  h ^= static_cast<std::uint64_t>(noteNumber & 0x7F) * 0x9E3779B97F4A7C15ull;
  h ^= (noteStartTick + 0x165667B19E3779F9ull) * 0xC2B2AE3D27D4EB4Full;
  h ^= static_cast<std::uint64_t>(voiceSlot & 0xFF) * 0x165667B19E3779F9ull;
  h ^= h >> 29;
  return h * 0xBF58476D1CE4E5B9ull;
}

/**
 * Where the cloud is reading from, and how it moves.
 *
 * Separate from the grains because it is the half of §4.3 that the grains know
 * nothing about: a grain captures a start position at birth and reads at its
 * own pitch from there, while this walks the zone at the speed ρ alone. Keeping
 * them apart in the code is what keeps them apart in the arithmetic, and their
 * being apart is the engine's whole point.
 */
struct Playhead {
  double frames = 0.0;

  /**
   * Advance by ρ, converted from host samples to zone frames.
   *
   * **There is no pitch term here and there must never be one.** The scale is
   * the file-to-host rate ratio and nothing else; fold the note's read ratio in
   * and an octave up walks the material twice as fast, which is the coupling
   * `fx-02` §1 derives as a 44 % material drift and which §4.3 exists to
   * remove.
   */
  void advance(double rho, double fileRate, double hostRate) noexcept {
    frames += rho * (fileRate / hostRate);
  }

  /**
   * Fold back inside the material by the zone's own loop rule.
   *
   * A looping zone wraps; a non-looping one runs to the end and stops. Returns
   * false only when the voice is genuinely finished — which requires the last
   * grain to have run out as well as the playhead to have left, because a grain
   * in flight is still sounding and cutting it short is a click.
   */
  bool wrap(const ClassicSource& zone, int liveGrains) noexcept {
    const double end = static_cast<double>(zone.frames);
    const bool looping = zone.loopMode != LoopMode::NoLoop && zone.loopEnd > zone.loopStart;
    if (looping) {
      const double lo = static_cast<double>(zone.loopStart);
      const double hi = static_cast<double>(zone.loopEnd);
      const double length = hi - lo;
      if (frames >= hi || frames < lo) {
        double t = std::fmod(frames - lo, length);
        if (t < 0.0) t += length;
        frames = lo + t;
      }
      return true;
    }
    if (frames < 0.0) frames = 0.0;
    if (frames > end) frames = end;
    return !(frames >= end && liveGrains == 0);
  }
};

/// What one grain's three random dimensions came out as. A struct rather than
/// three out-parameters so the draw order is stated once, in `drawGrain`, and
/// cannot be reordered by a caller without the compiler noticing.
struct GrainDraw {
  double startOffsetFrames = 0.0;  ///< spray, relative to the playhead
  int lengthSamples = 1;
  float detuneSemitones = 0.0f;
};

/**
 * Draw one grain's spray, length and detune.
 *
 * **The three draws are taken unconditionally and in a fixed order**, before
 * any of them is used and whatever the parameter values are. Drawing only when
 * a dimension is enabled would make a spray of zero and a spray of one consume
 * different numbers of random numbers, so moving one control would re-phase
 * every *other* random dimension — two renders differing only in spray would
 * differ in their pitch spread too, and the difference would look like a DSP
 * bug rather than a draw-order bug.
 */
inline GrainDraw drawGrain(grain::Rng& rng, const GranularParams& params, double lengthFrames,
                           float onsetFraction) noexcept {
  const float sprayDraw = rng.bipolar();
  const float lengthDraw = rng.bipolar();
  const float pitchDraw = rng.bipolar();

  GrainDraw draw;
  const float lengthJitter =
      params.lengthJitter < 0.0f ? 0.0f : (params.lengthJitter > 1.0f ? 1.0f : params.lengthJitter);
  // Length jitter is bounded at half the grain, so a grain can never be
  // jittered to zero samples — a zero-length grain is a click with a window
  // that never opens. The bound is also what `kLengthLift` is derived from, so
  // changing it here without changing that makes the pool cap wrong.
  const double jittered =
      lengthFrames * (1.0 + 0.5 * static_cast<double>(lengthJitter) *
                                static_cast<double>(lengthDraw));
  draw.lengthSamples = static_cast<int>(jittered);
  if (draw.lengthSamples < 1) draw.lengthSamples = 1;

  // Spray is measured in grain lengths, so it stays a fixed *musical* amount as
  // the grain size changes rather than a fixed number of samples. Expressed in
  // samples it would be inaudible at 5 ms grains and a scrub at 500 ms ones,
  // from one setting.
  const float spray = params.spray < 0.0f ? 0.0f : (params.spray > 1.0f ? 1.0f : params.spray);
  draw.startOffsetFrames = static_cast<double>(spray) * lengthFrames *
                               static_cast<double>(sprayDraw) -
                           static_cast<double>(onsetFraction);
  draw.detuneSemitones = params.pitchSpreadCents * pitchDraw * 0.01f;
  return draw;
}

/**
 * `A = 1/sqrt(O · mean(w²))`, `fx-02` §1.3, evaluated per voice.
 *
 * §4.3 item 3: this must be *inside the voice*. Applied outside — at the
 * instrument's summing bus, where it is one multiply instead of thirty-two —
 * it still holds a chord's total level steady, and each note's contribution to
 * that chord then moves with the note's own overlap. In an effect that is a
 * level bug; here the user compensates with the zone's gain and the velocity
 * curve is then wrong at every density but the one they trimmed at. V-25.
 *
 * The overlap is clamped from below at one grain: at O < 1 the cloud is gappy
 * and boosting it toward a constant RMS would amplify the gaps rather than
 * fill them, which is a burst of noise between grains rather than a steady
 * level.
 */
inline float densityNormalisation(float overlap, grain::WindowShape shape,
                                  float tukeyAlpha) noexcept {
  const float o = overlap < 1.0f ? 1.0f : overlap;
  const float meanSquare = grain::windowMeanSquare(shape, tukeyAlpha);
  const float denominator = o * (meanSquare > 1.0e-9f ? meanSquare : 1.0e-9f);
  return 1.0f / std::sqrt(denominator);
}

}  // namespace mw::dsp::sample
