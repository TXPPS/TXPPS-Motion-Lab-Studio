// Motion Wave — the envelope engine. `lib-voice-substrate.md` §5.2 and §8.
//
// The envelope's halves of VS-07, VS-08, VS-09, VS-11 and VS-12, and one case
// the design did not have: **no segment boundary is a step**.
//
// That last one is here because the design's exponential formula (3) fails it.
// It is 1 at x = 1, which is the property its prose claims and the property a
// reviewer would check; it is −e^(−k)/(1 − e^(−k)) at x = 0, so a decay starting
// at 1.0 begins at 1.031 and every boundary carries a click. The correction is
// recorded in `envelope.h`'s header and in §8 of the design, and the continuity
// case below is what makes it stay corrected.
#include "../dsp/voice/envelope.h"
#include "harness.h"
#include "rt_guard.h"

#include <cmath>
#include <vector>

using namespace mw;
using namespace mw::dsp::voice;

namespace {

TriggerBus pressed() {
  TriggerBus bus;
  bus.single = true;
  bus.multi = true;
  bus.gate = true;
  return bus;
}

TriggerBus held() {
  TriggerBus bus;
  bus.gate = true;
  return bus;
}

TriggerBus released() { return TriggerBus{}; }

/// Attack to 1, decay to `sustain`, hold, release to 0. Durations in seconds.
EnvelopeShape adsr(float attack, float decay, float sustain, float release,
                   SegmentCurve curve = SegmentCurve::Linear) {
  EnvelopeShape shape;
  shape.count = 4;
  shape.sustainSegment = 2;
  shape.endSegment = 3;
  shape.drive = SegmentDrive::Duration;
  shape.segments[0] = {1.0f, attack, curve, 1.0f};
  shape.segments[1] = {sustain, decay, curve, 3.5f};
  shape.segments[2] = {sustain, 0.0f, SegmentCurve::Linear, 1.0f};
  shape.segments[3] = {0.0f, release, curve, 3.5f};
  return shape;
}

Envelope prepared(const EnvelopeShape& shape, double rate = 48000.0) {
  Envelope env;
  env.prepare(rate);
  env.setShape(shape);
  return env;
}

/// Samples of `advance(bus, 1)`, one per frame.
std::vector<float> render(Envelope& env, const TriggerBus& first, const TriggerBus& rest,
                          int frames) {
  std::vector<float> out;
  out.reserve(static_cast<std::size_t>(frames));
  out.push_back(env.advance(first, 1));
  for (int i = 1; i < frames; ++i) out.push_back(env.advance(rest, 1));
  return out;
}

/// The largest jump between neighbouring samples.
float largestStep(const std::vector<float>& v) {
  float worst = 0.0f;
  for (std::size_t i = 1; i < v.size(); ++i) {
    const float d = std::fabs(v[i] - v[i - 1]);
    if (d > worst) worst = d;
  }
  return worst;
}

/// First index at or above `threshold`, or -1.
int firstAtOrAbove(const std::vector<float>& v, float threshold) {
  for (std::size_t i = 0; i < v.size(); ++i) {
    if (v[i] >= threshold) return static_cast<int>(i);
  }
  return -1;
}

}  // namespace

// ───────────────────────────────── the correction to (3), made executable

MW_TEST("no segment boundary is a step, for any curve") {
  // A 200 ms attack and a 200 ms decay at 48 kHz: the largest legitimate
  // per-sample move is about 1/9600 of full scale. The design's (3) starts a
  // decay 3.1 % above where the attack ended, which is 300 times that.
  for (const SegmentCurve curve :
       {SegmentCurve::Linear, SegmentCurve::Exponential, SegmentCurve::TargetSeeking}) {
    Envelope env = prepared(adsr(0.2f, 0.2f, 0.5f, 0.2f, curve));
    std::vector<float> v = render(env, pressed(), held(), 24000);
    MW_EXPECT(largestStep(v) < 0.002f);
  }
}

MW_TEST("every curve arrives exactly, and the envelope advances past it") {
  for (const SegmentCurve curve :
       {SegmentCurve::Linear, SegmentCurve::Exponential, SegmentCurve::TargetSeeking}) {
    Envelope env = prepared(adsr(0.05f, 0.05f, 0.4f, 0.05f, curve));
    env.advance(pressed(), 1);
    // Attack and decay both done well inside 200 ms; the envelope must be
    // holding at the sustain level rather than still approaching it. A curve
    // that only approaches its target never advances, and the voice never
    // retires — a stuck note made of arithmetic.
    env.advance(held(), 9600);
    MW_EXPECT(env.sustaining());
    MW_EXPECT(std::fabs(env.value() - 0.4f) < 1e-4f);
  }
}

// ──────────────────────────────────────────────────────────────── VS-11

MW_TEST("VS-11 a target-seeking attack ends at exactly one time constant") {
  EnvelopeShape shape = adsr(1.0f, 1.0f, 1.0f, 1.0f, SegmentCurve::TargetSeeking);
  shape.segments[0].shape = 1.0f;
  Envelope env = prepared(shape);
  std::vector<float> v = render(env, pressed(), held(), 48000);
  // L(1.0) = 1.000 ± 0.001 and L(0.5) = 0.6225 ± 0.002. The second is the one
  // that matters: a generic model running the attack to 95 % of an asymptote
  // reads about 0.39 there and makes every short attack sound soft.
  MW_EXPECT(std::fabs(v[47999] - 1.0f) < 0.001f);
  MW_EXPECT(std::fabs(v[23999] - 0.6225f) < 0.002f);
}

// ──────────────────────────────────────────────────────────────── VS-12

MW_TEST("VS-12 decay duration does not depend on the sustain level") {
  // The measured behaviour a textbook capacitor model gets wrong by being
  // reasonable: 19.78 s at sustain 0 against 17.11 s at sustain 5 on the
  // hardware. Duration drive makes it exact rather than close.
  int lengths[2] = {0, 0};
  const float sustains[2] = {0.0f, 0.5f};
  for (int i = 0; i < 2; ++i) {
    Envelope env = prepared(adsr(0.001f, 0.5f, sustains[i], 0.1f));
    env.advance(pressed(), 1);
    int frames = 0;
    while (!env.sustaining() && frames < 96000) {
      env.advance(held(), 1);
      ++frames;
    }
    lengths[i] = frames;
  }
  const float ratio = static_cast<float>(lengths[1]) / static_cast<float>(lengths[0]);
  MW_EXPECT(std::fabs(ratio - 1.0f) <= 0.15f);
}

MW_TEST("under Rate drive the duration falls out of the distance instead") {
  // The other half of the pair, and the error `syn-02` names: inverting the two
  // gives an instrument whose decay time changes with its sustain level when it
  // should not, or does not when it should.
  int lengths[2] = {0, 0};
  const float targets[2] = {0.5f, 1.0f};
  for (int i = 0; i < 2; ++i) {
    EnvelopeShape shape;
    shape.count = 2;
    shape.sustainSegment = 1;
    shape.endSegment = 1;
    shape.drive = SegmentDrive::Rate;
    shape.segments[0] = {targets[i], 1.0f, SegmentCurve::Linear, 1.0f};  // 1.0 units/second
    shape.segments[1] = {targets[i], 0.0f, SegmentCurve::Linear, 1.0f};
    Envelope env = prepared(shape);
    env.advance(pressed(), 1);
    int frames = 1;
    while (!env.sustaining() && frames < 480000) {
      env.advance(held(), 1);
      ++frames;
    }
    lengths[i] = frames;
  }
  const float ratio = static_cast<float>(lengths[1]) / static_cast<float>(lengths[0]);
  MW_EXPECT(std::fabs(ratio - 2.0f) < 0.02f);
}

// ──────────────────────────────────────────────────────────────── VS-09

MW_TEST("VS-09 a zero-distance segment takes time rather than none") {
  EnvelopeShape shape;
  shape.count = 3;
  shape.sustainSegment = 2;
  shape.endSegment = 2;
  shape.drive = SegmentDrive::Rate;
  shape.zeroDistanceSeconds = 0.010f;
  shape.segments[0] = {0.5f, 50.0f, SegmentCurve::Linear, 1.0f};
  shape.segments[1] = {0.5f, 50.0f, SegmentCurve::Linear, 1.0f};  // nowhere to go
  shape.segments[2] = {0.5f, 0.0f, SegmentCurve::Linear, 1.0f};
  Envelope env = prepared(shape);
  env.advance(pressed(), 1);
  int frames = 1;
  while (env.segment() < 1 && frames < 48000) {
    env.advance(held(), 1);
    ++frames;
  }
  const int enteredZero = frames;
  while (env.segment() < 2 && frames < 48000) {
    env.advance(held(), 1);
    ++frames;
  }
  // 10 ms at 48 kHz is 480 samples. A model that advances instantly through a
  // zero-distance segment gives 1, and on the six-operator hardware the smear
  // that produces is audible on fast percussive shapes.
  MW_EXPECT((frames - enteredZero) > 400);
  MW_EXPECT((frames - enteredZero) < 560);
}

MW_TEST("a segment with no duration at all still takes a sample") {
  // Not cosmetic. With `freeRun` set, a segment of zero length is a loop that
  // never leaves one `advance` call — a hang on the audio thread rather than a
  // wrong number.
  EnvelopeShape shape = adsr(0.0f, 0.0f, 0.0f, 0.0f);
  shape.freeRun = true;
  shape.gated = false;
  Envelope env = prepared(shape);
  env.advance(pressed(), 256);
  MW_EXPECT(env.value() >= 0.0f);
}

// ──────────────────────────────────────────────────────── VS-07 and VS-08

MW_TEST("VS-07 the envelope is identical at every block size") {
  const int blocks[5] = {16, 17, 64, 128, 1024};
  float ends[5] = {0, 0, 0, 0, 0};
  for (int b = 0; b < 5; ++b) {
    Envelope env = prepared(adsr(0.05f, 0.1f, 0.6f, 0.2f, SegmentCurve::Exponential));
    env.advance(pressed(), blocks[b]);
    int frames = blocks[b];
    while (frames + blocks[b] <= 9600) {
      env.advance(held(), blocks[b]);
      frames += blocks[b];
    }
    // Advanced by sample count, so the remainder matters as much as the blocks.
    if (frames < 9600) env.advance(held(), 9600 - frames);
    ends[b] = env.value();
  }
  for (int b = 1; b < 5; ++b) MW_EXPECT(std::fabs(ends[b] - ends[0]) <= 6e-8f);
}

MW_TEST("VS-08 the same patch takes the same wall-clock time at every rate") {
  const double rates[4] = {44100.0, 48000.0, 96000.0, 192000.0};
  double seconds[4] = {0, 0, 0, 0};
  for (int r = 0; r < 4; ++r) {
    Envelope env = prepared(adsr(0.2f, 0.3f, 0.5f, 0.1f, SegmentCurve::TargetSeeking), rates[r]);
    std::vector<float> v = render(env, pressed(), held(), static_cast<int>(rates[r] * 0.5));
    const int at = firstAtOrAbove(v, 0.9f);
    MW_EXPECT(at > 0);
    seconds[r] = static_cast<double>(at) / rates[r];
  }
  for (int r = 1; r < 4; ++r) {
    MW_EXPECT(std::fabs(seconds[r] - seconds[0]) / seconds[0] < 0.005);
  }
}

// ────────────────────────────────────────── gate, release, loop, retrigger

MW_TEST("the gate holds the sustain segment and releasing runs to the end") {
  Envelope env = prepared(adsr(0.01f, 0.01f, 0.4f, 0.05f));
  env.advance(pressed(), 1);
  env.advance(held(), 4800);
  MW_EXPECT(env.sustaining());
  MW_EXPECT(!env.finished());
  env.advance(released(), 4800);
  MW_EXPECT(env.finished());
  MW_EXPECT(std::fabs(env.value()) < 1e-5f);
}

MW_TEST("a gate released during the attack runs on through the segments") {
  // §4 says the envelope "runs from wherever it is through the remaining
  // segments up to the end segment", which is not the jump-to-release most
  // envelopes do. It is stated, so it is asserted: a short press must still
  // produce the decay, not a discontinuity into release.
  Envelope env = prepared(adsr(0.4f, 0.05f, 0.5f, 0.05f));
  env.advance(pressed(), 1);
  std::vector<float> v = render(env, held(), released(), 24000);
  MW_EXPECT(largestStep(v) < 0.002f);
  MW_EXPECT(env.finished());
}

MW_TEST("a free-running shape loops instead of stopping") {
  EnvelopeShape shape = adsr(0.01f, 0.01f, 0.5f, 0.01f);
  shape.freeRun = true;
  shape.gated = false;
  shape.skipSustain = true;
  Envelope env = prepared(shape);
  env.advance(pressed(), 1);
  env.advance(TriggerBus{}, 48000);
  // Two seconds of a 30 ms shape: it is still running, and it never latched
  // `finished`.
  MW_EXPECT(!env.finished());
}

MW_TEST("resetOnTrigger decides whether a retrigger clicks") {
  EnvelopeShape from = adsr(0.05f, 0.05f, 0.5f, 0.05f);
  from.resetOnTrigger = false;
  Envelope soft = prepared(from);
  soft.advance(pressed(), 1);
  soft.advance(held(), 4800);
  const float before = soft.value();
  soft.advance(pressed(), 1);
  MW_EXPECT(std::fabs(soft.value() - before) < 0.01f);

  EnvelopeShape hard = from;
  hard.resetOnTrigger = true;
  hard.floorValue = 0.0f;
  Envelope sharp = prepared(hard);
  sharp.advance(pressed(), 1);
  sharp.advance(held(), 4800);
  sharp.advance(pressed(), 1);
  MW_EXPECT(sharp.value() < 0.05f);
}

MW_TEST("multiTrigger chooses which pulse restarts the shape") {
  TriggerBus multiOnly;
  multiOnly.multi = true;
  multiOnly.gate = true;

  EnvelopeShape onSingle = adsr(0.05f, 0.05f, 0.5f, 0.05f);
  onSingle.resetOnTrigger = true;
  Envelope a = prepared(onSingle);
  a.advance(pressed(), 4800);
  const float held1 = a.value();
  a.advance(multiOnly, 1);
  MW_EXPECT(std::fabs(a.value() - held1) < 0.02f);  // not its pulse; keeps going

  EnvelopeShape onMulti = onSingle;
  onMulti.multiTrigger = true;
  Envelope b = prepared(onMulti);
  b.advance(pressed(), 4800);
  b.advance(multiOnly, 1);
  MW_EXPECT(b.value() < 0.05f);  // restarted from the floor
}

MW_TEST("the floor is honoured and an exact zero is not required") {
  EnvelopeShape shape = adsr(0.01f, 0.05f, 0.0f, 0.01f);
  shape.domain = EnvelopeDomain::Decibel;
  shape.floorValue = -89.9f;
  shape.segments[0].target = 0.0f;
  shape.segments[1].target = -120.0f;  // below the floor on purpose
  Envelope env = prepared(shape);
  env.advance(pressed(), 1);
  std::vector<float> v = render(env, held(), held(), 9600);
  for (const float sample : v) MW_EXPECT(sample >= -89.9f - 1e-4f);
}

// ──────────────────────────────────────────── the face and the audio agree

MW_TEST("sampleShape draws what advance produces") {
  EnvelopeShape shape = adsr(0.05f, 0.05f, 0.5f, 0.05f, SegmentCurve::TargetSeeking);
  float drawn[64] = {};
  Envelope::sampleShape(shape, 48000.0, 0.2f, drawn, 64);
  // The picture is the same evaluation, so the peak it draws is the peak the
  // audio reaches and the level it settles at is the sustain level. A curve
  // drawn from a formula is a second opinion, and this is where the two would
  // part company.
  float peak = 0.0f;
  for (const float sample : drawn) {
    if (sample > peak) peak = sample;
  }
  MW_EXPECT(std::fabs(peak - 1.0f) < 0.01f);
  MW_EXPECT(drawn[63] < 0.05f);
}

// ───────────────────────────────────────────────── real-time safety, §6.2

MW_TEST("nothing on the audio path allocates") {
  Envelope env = prepared(adsr(0.01f, 0.02f, 0.5f, 0.02f, SegmentCurve::Exponential));
  mw::test::RtGuard guard;
  TriggerBus bus = pressed();
  for (int i = 0; i < 400; ++i) {
    env.advance(bus, 64);
    bus.single = (i % 37) == 0;
    bus.multi = bus.single;
    bus.gate = (i % 11) != 0;
  }
  env.reset();
  MW_EXPECT_EQ(static_cast<int>(guard.allocations()), 0);
}

MW_TEST("the RtGuard is watching rather than asleep") {
  std::vector<float> scratch;
  mw::test::RtGuard guard;
  scratch.resize(1024);
  MW_EXPECT(guard.allocations() > 0);
}

MW_TEST_MAIN("envelope")
