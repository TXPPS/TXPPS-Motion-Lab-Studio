// Motion Wave — one envelope engine, five measured shape families.
//
// `lib-voice-substrate.md` §4 and §5.2. Eight segments, any of which may be the
// sustain point and any of which may end the shape, because a dedicated
// "sustain stage" serves ADSR and nothing else — and one of the five consumers
// has eight stages with a pre-attack delay.
//
// **One position, two ways of moving it, and the curve is a pure function of
// position.** A segment holds a normalised `x` from 0 to 1; `SegmentDrive`
// decides how fast `x` moves and `SegmentCurve` decides the shape it traces:
//
//   Duration   x advances 1/(parameter · fs) per sample. The segment takes
//              `parameter` seconds however far it has to travel — which is what
//              makes decay duration a function of the decay control *only*,
//              measured on one consumer at 19.78 s with sustain at 0 and
//              17.11 s with sustain at 5. A textbook capacitor model shortens
//              it substantially and is wrong by being reasonable.
//   Rate       the same position, advanced at `parameter/distance` per second.
//              Speed is authoritative and time falls out of the distance, so a
//              rate of 60 across a zero-distance segment costs almost nothing
//              and the same rate across 90 dB takes far longer. `syn-02` §4.1
//              names inverting these two as the most common error in the class.
//
// Writing it as one position rather than as a recursion per curve per drive is
// deliberate. Four implementations of the same idea is four places to forget
// that a segment has to *arrive*, and a segment that never arrives never
// advances, so the voice never retires — a stuck note produced by arithmetic
// rather than by input handling, which would pass every note-handling test
// there is.
//
// **A correction to (3), recorded rather than quietly applied.** The design
// writes the exponential curve as
//
//     f(x) = (1 − e^(−k·x) − e^(−k)·(1 − x)) / (1 − e^(−k))
//
// and that is 1 at x = 1, which is the property its prose claims. It is
// −e^(−k)/(1 − e^(−k)) at x = 0 — about −3 % at k = 3.5 — so every segment
// starts a step away from where the one before it ended, and every segment
// boundary is a click. The numerator carries an offset *and* the whole thing is
// divided, and the two corrections cancel only at the far end. Adding e^(−k)
// back to the numerator and dropping the division gives
//
//     f(x) = 1 − e^(−k·x) + e^(−k)·x                                        (3')
//
// which is 0 at x = 0, 1 at x = 1, and monotonic for every k > 0 —
// `f'(x) = k·e^(−k·x) + e^(−k)`. This is the same shape as VS-02's finding one
// level down: the consequence the prose states is true, and a consequence
// nobody wrote down is not. §8 of the design records it, and the continuity
// case in `envelope_tests.cpp` is the executable form.
//
// Real-time safe: `prepare` and `setShape` are the only methods that touch
// anything but arithmetic, and neither allocates.
#pragma once

#include <cmath>
#include <cstdint>

#include "trigger_bus.h"

namespace mw::dsp::voice {

/// What a segment's `parameter` means.
enum class SegmentDrive : std::uint8_t { Duration, Rate };

/// The domain the envelope integrates in. `value()` is in this domain, always —
/// a consumer that wants amplitude from a `Decibel` envelope converts, because
/// converting here would make the six-operator engine's decay stop being a
/// straight line the moment anything sampled it.
enum class EnvelopeDomain : std::uint8_t { Linear, Decibel };

enum class SegmentCurve : std::uint8_t { Linear, Exponential, TargetSeeking };

struct Segment {
  float target = 0.0f;
  float parameter = 0.0f;  ///< seconds if Duration, units/second if Rate
  SegmentCurve curve = SegmentCurve::Linear;
  float shape = 1.0f;  ///< time constants for Exponential, k for TargetSeeking
};

inline constexpr int kMaxSegments = 8;

struct EnvelopeShape {
  Segment segments[kMaxSegments]{};
  int count = 4;
  int sustainSegment = 2;  ///< holds until release; ADSR is the case where it is 2
  int endSegment = 3;      ///< the shape stops here
  EnvelopeDomain domain = EnvelopeDomain::Linear;
  SegmentDrive drive = SegmentDrive::Duration;
  /// Floor in the envelope's own domain. The six-operator engine starts its
  /// attack about 89.9 dB down rather than at −inf, which is why its onset is
  /// percussive; it also removes the denormal an exact zero would produce.
  float floorValue = 0.0f;
  /// Minimum a zero-distance segment takes. Measured non-zero on the
  /// six-operator hardware and audible as a smear on fast percussive shapes.
  float zeroDistanceSeconds = 0.0f;
  /// Independent bits rather than a mode enum: an LFO-triggered, free-running,
  /// no-sustain envelope is a looping shape generator, and that combination is
  /// how the matrix instrument makes evolving pads without a sequencer.
  bool resetOnTrigger = false;
  bool multiTrigger = false;
  bool gated = true;
  bool freeRun = false;
  bool skipSustain = false;
};

class Envelope {
 public:
  void prepare(double sampleRate) noexcept {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    reset();
  }

  void setShape(const EnvelopeShape& shape) noexcept {
    shape_ = shape;
    shape_.count = clampInt(shape.count, 1, kMaxSegments);
    shape_.endSegment = clampInt(shape.endSegment, 0, shape_.count - 1);
    shape_.sustainSegment = clampInt(shape.sustainSegment, 0, shape_.count - 1);
    reset();
  }

  void reset() noexcept {
    level_ = shape_.floorValue;
    index_ = 0;
    x_ = 0.0f;
    start_ = level_;
    dx_ = 0.0f;
    holding_ = false;
    finished_ = false;
    idle_ = true;
  }

  /// Advance `frames` samples of song time and return the value at the end.
  ///
  /// By sample count, never by block count. A generator advanced once per call
  /// produces a different envelope at every buffer size, and the offline
  /// renderer names that as the failure its block-size cell exists to catch.
  float advance(const TriggerBus& triggers, int frames) noexcept {
    if (shape_.multiTrigger ? triggers.multi : triggers.single) trigger();
    for (int i = 0; i < frames; ++i) step(triggers.gate);
    return level_;
  }

  float value() const noexcept { return level_; }
  bool sustaining() const noexcept { return holding_; }
  bool finished() const noexcept { return finished_; }
  int segment() const noexcept { return index_; }

  /// The shape, sampled for a face to draw, by running the same `advance` on a
  /// scratch copy. A curve drawn from a formula would be a second opinion, and
  /// a second opinion is how a face comes to disagree with what is heard.
  static void sampleShape(const EnvelopeShape& shape, double sampleRate, float gateSeconds,
                          float* out, int count) noexcept {
    if (out == nullptr || count <= 0) return;
    Envelope scratch;
    scratch.prepare(sampleRate);
    scratch.setShape(shape);
    // The whole window is the gate plus whatever runs after it, and the release
    // is part of the picture — a face that stopped at note-off would draw an
    // envelope nobody hears the end of.
    const double total = static_cast<double>(gateSeconds) * 2.0;
    const double perPoint = total / static_cast<double>(count);
    const int framesPer = static_cast<int>(perPoint * sampleRate + 0.5);
    TriggerBus bus;
    bus.single = true;
    bus.multi = true;
    bus.gate = true;
    for (int i = 0; i < count; ++i) {
      bus.gate = static_cast<double>(i) * perPoint < static_cast<double>(gateSeconds);
      out[i] = scratch.advance(bus, framesPer < 1 ? 1 : framesPer);
      bus.single = false;
      bus.multi = false;
    }
  }

 private:
  static int clampInt(int v, int lo, int hi) noexcept { return v < lo ? lo : (v > hi ? hi : v); }
  const Segment& seg() const noexcept { return shape_.segments[index_]; }

  /// A retrigger. `resetOnTrigger` decides whether it starts from the floor or
  /// from wherever the envelope had got to — the second is what stops a
  /// retrigger during a release tail from clicking, and it is why this is a bit
  /// on the shape rather than a fixed behaviour.
  void trigger() noexcept {
    if (shape_.resetOnTrigger) level_ = shape_.floorValue;
    finished_ = false;
    holding_ = false;
    idle_ = false;
    enterSegment(0);
  }

  void step(bool gate) noexcept {
    if (idle_) return;
    if (holding_) {
      if (gate && shape_.gated) return;
      holding_ = false;
      leaveSegment();
      return;
    }
    x_ += dx_;
    if (x_ >= 1.0f) {
      level_ = floored(seg().target);
      // Held at the sustain point only if the gate is still down when the
      // segment *completes*. A gate released during the attack therefore runs
      // on through the remaining segments rather than jumping to the release,
      // which is what §4 says and is not what most envelopes do.
      if (index_ == shape_.sustainSegment && shape_.gated && !shape_.skipSustain && gate) {
        holding_ = true;
        return;
      }
      leaveSegment();
      return;
    }
    level_ = floored(start_ + (seg().target - start_) * curveAt(x_));
  }

  void leaveSegment() noexcept {
    if (index_ >= shape_.endSegment) {
      if (shape_.freeRun) {
        enterSegment(0);
        return;
      }
      finished_ = true;
      idle_ = true;
      return;
    }
    enterSegment(index_ + 1);
  }

  void enterSegment(int next) noexcept {
    index_ = clampInt(next, 0, shape_.count - 1);
    start_ = level_;
    x_ = 0.0f;
    dx_ = stepFor(seg());
    idle_ = false;
  }

  /// How far `x` moves per sample, which is the whole of `SegmentDrive`.
  float stepFor(const Segment& s) const noexcept {
    const double distance = std::fabs(static_cast<double>(s.target) - start_);
    double seconds = 0.0;
    if (shape_.drive == SegmentDrive::Duration) {
      seconds = s.parameter;
    } else if (distance > 0.0 && s.parameter > 0.0f) {
      seconds = distance / static_cast<double>(s.parameter);
    }
    if (distance <= 0.0 && shape_.zeroDistanceSeconds > seconds) {
      seconds = shape_.zeroDistanceSeconds;
    }
    // Never zero. A segment that takes no samples is a segment that never runs,
    // and with `freeRun` set it is a loop that spins the whole block inside one
    // `advance` — which is a hang on the audio thread rather than a wrong
    // number, and the reason this floor is here rather than in a caller.
    const double oneSample = 1.0 / sampleRate_;
    if (seconds < oneSample) seconds = oneSample;
    return static_cast<float>(1.0 / (seconds * sampleRate_));
  }

  float curveAt(float x) const noexcept {
    const float k = seg().shape > 1e-4f ? seg().shape : 1e-4f;
    switch (seg().curve) {
      case SegmentCurve::Linear:
        return x;
      case SegmentCurve::Exponential:
        // (3'), and the correction is in this file's header: the design divides
        // by (1 − e^(−k)) as well as offsetting, and the two only agree at
        // x = 1. This form is 0 at 0 and 1 at 1 by inspection.
        return 1.0f - std::exp(-k * x) + std::exp(-k) * x;
      case SegmentCurve::TargetSeeking: {
        // The approach, renormalised so the segment arrives at the end of the
        // time constants it was given rather than asymptotically. `k = 1` is the
        // DCO polysynth's attack and gives 0.6225 at the half-way point, which
        // is 1 − e^(−0.5) over 0.632 — the number that separates a faithful
        // short attack from a soft one.
        const float e = std::exp(-k);
        return (1.0f - std::exp(-k * x)) / (1.0f - e);
      }
    }
    return x;
  }

  float floored(float v) const noexcept { return v < shape_.floorValue ? shape_.floorValue : v; }

  EnvelopeShape shape_{};
  double sampleRate_ = 48000.0;
  float level_ = 0.0f;
  float start_ = 0.0f;
  float x_ = 0.0f;
  float dx_ = 0.0f;
  int index_ = 0;
  bool holding_ = false;
  bool finished_ = false;
  bool idle_ = true;
};

}  // namespace mw::dsp::voice
