// Motion Wave — the five measured shape families, on one envelope engine.
//
// `lib-voice-substrate.md` §5.2. Each consumer's envelope is `envelope.h`'s
// engine with a shape built here from that consumer's sheet — and only from the
// rows of the sheet that were *measured*. A value marked [I] there came out of
// somebody's emulator, which makes it their design decision rather than a fact
// about the hardware, and `LEGAL_NOTES.md` quarantines it: it does not reach
// this tree. So the panel-to-units laws — 0..99 to dB/s, 0..63 to seconds, the
// level tables — stay with the consumer, because those laws are exactly the
// quarantined tables, and every family here takes physical units. Where a
// constant genuinely has no published value the choice is named as a choice,
// so that the day somebody measures it there is one line to move.
//
// Two numbers here separate a faithful onset from a soft one: the DCO
// polysynth's attack ends at **one** time constant, `0.632 = 1 − e^−1` exactly,
// where a generic model running it to 95 % makes every short attack soft; and
// the six-operator attack starts about **89.9 dB down** rather than at −inf,
// which is what makes its onset percussive rather than late. Its decay is a
// straight line in dB, which is what VS-10 measures.
#pragma once

#include <cmath>
#include <cstdint>

#include "envelope.h"

namespace mw::dsp::voice {

/// One rate/level step for the rate-driven families. `rate` is in the domain's
/// units per second and `level` is an absolute target in that domain.
struct RateLevel {
  float rate = 1.0f;
  float level = 0.0f;
};

// ─────────────────────────────────────────────────────────── DCO polysynth
//
// `syn-01` §9, all [C]: five measured slider positions, decay and release
// measured identical (one timing circuit serves both), an attack that fits
// `(1 − e^(−x))/0.632`, and decay/release that fit an exponential over 3.5 time
// constants with a trailing term that forces arrival.

/// The measured slider rows, seconds. Release is decay: the sheet measured them
/// identical and builds both from one curve, so there is one row for both.
inline constexpr float kDcoPolySlider[5] = {0.0f, 2.5f, 5.0f, 7.5f, 10.0f};
inline constexpr float kDcoPolyAttack[5] = {0.001f, 0.03f, 0.24f, 0.65f, 3.25f};
inline constexpr float kDcoPolyDecay[5] = {0.002f, 0.096f, 0.984f, 4.449f, 19.783f};

/// Slider 0..10 to seconds through the measured rows, interpolated in the log
/// of time: the sheet says the law is logarithmic and the rows say so
/// themselves, each 2.5 of slider multiplying the time by four to ten. A
/// linear interpolation puts slider 6.25 at 2.7 s; the log law puts it at
/// 2.09 s, which is where the curve through the measurements is.
inline float dcoPolySeconds(const float (&rows)[5], float slider) noexcept {
  if (slider <= kDcoPolySlider[0]) return rows[0];
  if (slider >= kDcoPolySlider[4]) return rows[4];
  int i = 0;
  while (i < 3 && slider > kDcoPolySlider[i + 1]) ++i;
  const float t = (slider - kDcoPolySlider[i]) / (kDcoPolySlider[i + 1] - kDcoPolySlider[i]);
  return rows[i] * std::pow(rows[i + 1] / rows[i], t);
}
inline float dcoPolyAttackSeconds(float slider) noexcept {
  return dcoPolySeconds(kDcoPolyAttack, slider);
}
inline float dcoPolyDecaySeconds(float slider) noexcept {
  return dcoPolySeconds(kDcoPolyDecay, slider);
}

/// Linear domain, duration drive, times in seconds.
///
/// Duration drive is the measured behaviour the sheet's §9.3 records against
/// the textbook: decay duration is a function of the decay slider only (19.78 s
/// at sustain 0, 17.11 s at sustain 5), where a capacitor model shortens it.
inline EnvelopeShape dcoPoly(float attackSeconds, float decaySeconds, float sustain,
                             float releaseSeconds) noexcept {
  EnvelopeShape s;
  s.count = 4;
  s.sustainSegment = 2;
  s.endSegment = 3;
  s.domain = EnvelopeDomain::Linear;
  s.drive = SegmentDrive::Duration;
  // k = 1 in (4) is the sheet's `(1 − e^(−x))/0.632` verbatim: the segment ends
  // at exactly one time constant, not three to five.
  s.segments[0] = {1.0f, attackSeconds, SegmentCurve::TargetSeeking, 1.0f};
  // (3') over 3.5 time constants. The sheet's raw fit subtracts an *unscaled*
  // e^(−3.5), which reaches zero exactly for a release and undershoots the
  // sustain by 3 % for a decay to any S > 0 — a fit artefact, since the term
  // exists to force arrival. (3') is the same curve normalised to arrive.
  s.segments[1] = {sustain, decaySeconds, SegmentCurve::Exponential, 3.5f};
  s.segments[2] = {sustain, 0.0f, SegmentCurve::Linear, 1.0f};
  s.segments[3] = {0.0f, releaseSeconds, SegmentCurve::Exponential, 3.5f};
  return s;
}

// ──────────────────────────────────────────────────────── phase distortion
//
// `syn-02` §4.1, [C] for the structure: eight rate/level steps, rate is a speed
// and not a duration, the sustain step is any step, the end step is any step,
// and there is no loop. Segments are linear in the envelope's own domain, so a
// level step is a linear-amplitude fade and a pitch step is a linear-in-pitch
// glide — "linear" means different things in each, and neither gets a curve.

/// Rate drive, linear domain. `steps[i].rate` in units per second of whatever
/// the envelope drives; the 0..99 encodings and their physical speeds are the
/// consumer's, and the speed of a rate value is unmeasured there ([U]).
inline EnvelopeShape phaseDistortion(const RateLevel (&steps)[kMaxSegments], int sustainStep,
                                     int endStep) noexcept {
  EnvelopeShape s;
  s.count = kMaxSegments;
  s.domain = EnvelopeDomain::Linear;
  s.drive = SegmentDrive::Rate;
  for (int i = 0; i < kMaxSegments; ++i) {
    s.segments[i] = {steps[i].level, steps[i].rate, SegmentCurve::Linear, 1.0f};
  }
  s.sustainSegment = sustainStep;
  s.endSegment = endStep;
  return s;
}

// ─────────────────────────────────────────────────────────── analogue five
//
// `syn-03` §7: a conventional ADSR, very flat on the early revisions and more
// curved on the later ones ([R] — reported, with no constant), and a panel
// switch that disables the release stage globally ([C]).

enum class AnalogueRevision : std::uint8_t { Early, Later };

/// Duration drive, linear domain. With `releaseEnabled` false the note stops at
/// key-up whatever the release control says: the release segment is given no
/// time at all, and the engine's one-sample floor takes it to zero in a sample.
/// It is an argument rather than a field because the sheet says it is global
/// performance state, often a footswitch, and not part of the patch.
/// The later revision's curvature has no published constant. 3.5 time
/// constants is the only value measured on an RC-family envelope segment
/// anywhere in `docs/reference/` (`syn-01` §9.2) and it is used here as the
/// placeholder for "more curved"; this is the line that moves when the
/// instrument is measured.
inline EnvelopeShape analogueFive(float attackSeconds, float decaySeconds, float sustain,
                                  float releaseSeconds, AnalogueRevision revision,
                                  bool releaseEnabled) noexcept {
  const SegmentCurve curve =
      revision == AnalogueRevision::Early ? SegmentCurve::Linear : SegmentCurve::Exponential;
  EnvelopeShape s;
  s.count = 4;
  s.sustainSegment = 2;
  s.endSegment = 3;
  s.domain = EnvelopeDomain::Linear;
  s.drive = SegmentDrive::Duration;
  s.segments[0] = {1.0f, attackSeconds, curve, 3.5f};
  s.segments[1] = {sustain, decaySeconds, curve, 3.5f};
  s.segments[2] = {sustain, 0.0f, SegmentCurve::Linear, 1.0f};
  s.segments[3] = {0.0f, releaseEnabled ? releaseSeconds : 0.0f, curve, 3.5f};
  return s;
}

// ──────────────────────────────────────────────────────────── six-operator
//
// `syn-04` §5. Four rate/level pairs, integrated in decibels — a decay linear
// in dB is a true exponential in amplitude, and an implementation that lerps in
// amplitude sounds "synthetic and slow to die". The floor is where the panel's
// own level range bottoms out ([derived, corroborated]); the attack curve's
// class is stated in words in the sheet and its constant is quarantined code.

/// Where an attack from silence starts. −inf would make it infinitely long.
inline constexpr float kSixOperatorFloorDb = -89.9f;

/// Time constants for a rising segment. Chosen, not measured: the sheet's rising
/// branch is [I] code, and in words it is "fast in dB at the bottom and
/// decelerating at the top". 3.5 — the one RC-family constant measured in the
/// reference set — puts 60 % of a rise's dB travel in its first quarter. The
/// test asserts the class (floored, convex in dB), so measuring the hardware
/// moves this number and nothing else.
inline constexpr float kSixOperatorRiseK = 3.5f;

/// Decibel domain, rate drive: rates in dB/s, levels in dB with 0 dB full.
/// A rising segment seeks its target and a falling one is straight, the
/// hardware's rule per direction, decided here from the targets with the floor
/// as the level before segment 1 — so only a retrigger from *between* the
/// floor and L1 differs from the hardware, by curve class alone.
/// `zeroDistanceSeconds` is VS-09's smear; its per-rate law is [U] and the
/// consumer supplies it.
inline EnvelopeShape sixOperator(const RateLevel (&stages)[4],
                                 float zeroDistanceSeconds = 0.0f) noexcept {
  EnvelopeShape s;
  s.count = 4;
  s.sustainSegment = 2;
  s.endSegment = 3;
  s.domain = EnvelopeDomain::Decibel;
  s.drive = SegmentDrive::Rate;
  s.floorValue = kSixOperatorFloorDb;
  s.zeroDistanceSeconds = zeroDistanceSeconds;
  float previous = kSixOperatorFloorDb;
  for (int i = 0; i < 4; ++i) {
    const bool rising = stages[i].level > previous;
    s.segments[i] = {stages[i].level, stages[i].rate,
                     rising ? SegmentCurve::TargetSeeking : SegmentCurve::Linear,
                     kSixOperatorRiseK};
    previous = stages[i].level;
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────── matrix
//
// `syn-05` §5: DADSR — a pre-attack delay, then attack, decay, sustain and
// release — with an output amplitude that is *also a matrix destination*, and
// seven independent mode bits. The amplitude is deliberately not in the shape:
// a destination has to be applied where the grid can reach it, per grid point,
// and baking it into the targets would make the destination unreachable. The
// 0..63 times have no published units (§9 of the design), so this takes
// seconds and the consumer's table is uncalibrated until somebody measures it.

struct MatrixEnvelope {
  float delaySeconds = 0.0f;
  float attackSeconds = 0.01f;
  float decaySeconds = 0.1f;
  float sustain = 1.0f;
  float releaseSeconds = 0.1f;
  /// RESET: restart from the floor on a trigger rather than from the level.
  bool reset = false;
  /// MULTI: retrigger on every note-on; clear means single trigger.
  bool multi = false;
  /// GATED: hold the sustain segment while the gate is high and leave it when
  /// the gate falls. Clear is the hardware's FREERUN — run to completion
  /// regardless of the gate. The sheet describes those two bits as
  /// complementary and the engine has one bit for the pair.
  bool gated = true;
  /// DADR: no sustain hold; delay, attack, decay and release run through.
  bool dadr = false;
  /// Restart at the end: the engine's `freeRun`, which loops, and what the
  /// design's "free-running, no-sustain envelope is a looping shape generator"
  /// describes. EXTRIG and LFOTRIG are trigger *sources*, raised by the
  /// consumer on the `TriggerBus`, and so are not here.
  bool loop = false;
};

/// Duration drive, linear domain, five straight segments — the instrument's
/// curves are unmeasured, and a curve nobody measured is a guess dressed as a
/// fact. The delay is a segment whose target is the floor, so it holds at
/// silence for exactly its time; with RESET clear a retrigger mid-note ramps
/// to the floor over the delay rather than holding, because the segment model
/// has absolute targets, and what the hardware does there is unmeasured.
inline EnvelopeShape matrix(const MatrixEnvelope& e) noexcept {
  EnvelopeShape s;
  s.count = 5;
  s.sustainSegment = 3;
  s.endSegment = 4;
  s.domain = EnvelopeDomain::Linear;
  s.drive = SegmentDrive::Duration;
  s.segments[0] = {0.0f, e.delaySeconds, SegmentCurve::Linear, 1.0f};
  s.segments[1] = {1.0f, e.attackSeconds, SegmentCurve::Linear, 1.0f};
  s.segments[2] = {e.sustain, e.decaySeconds, SegmentCurve::Linear, 1.0f};
  s.segments[3] = {e.sustain, 0.0f, SegmentCurve::Linear, 1.0f};
  s.segments[4] = {0.0f, e.releaseSeconds, SegmentCurve::Linear, 1.0f};
  s.resetOnTrigger = e.reset;
  s.multiTrigger = e.multi;
  s.gated = e.gated;
  s.skipSustain = e.dadr;
  s.freeRun = e.loop;
  return s;
}

}  // namespace mw::dsp::voice
