// Motion Wave — the four linear-domain shape families. `lib-voice-substrate.md`
// §5.2 and §8. The decibel family has a regression in it and its own file.
//
// One measurable claim per family, taken from the sheet row the family is
// built from. The DCO polysynth: its attack ends at one time constant (VS-11
// through the family), its decay and release are one curve, its five measured
// slider rows are reproduced with a logarithmic law between them, and its
// decay does not shorten when the sustain rises (VS-12). Phase distortion: a
// step's time falls out of its distance, steps are straight, and sustain and
// end are any step. The analogue five: a straight early revision, a curved
// later one, and the release switch. The matrix: a delay that holds at the
// floor for exactly its time, DADR, and the loop.
//
// Every number is derived: 0.6225 is (1 − e^−0.5)/0.632, 2.092 s is the
// geometric mean of the 5 and 7.5 rows, 0.841 is (3') at x = 0.5 with k = 3.5.
// Measured on this tree: L(0.5) = 0.62243 and L(1) = 1.00000; slider 6.25
// gives 2.0923 s; mid-attack reads 0.5000 early and 0.8413 later; the matrix
// delay's first non-zero sample is 4801 and its attack peaks at 0.9996.
//
// Mutation-tested, each edit restored before the next:
//   DCO attack over 3.5 time constants instead of one → red: VS-11 only.
//   DCO release given a curve other than the decay's → red: "one curve" only.
//   slider rows interpolated linearly in time → red: the slider case only.
//   release switch ignored → red: "the release switch stops the note" only.
//   phase distortion under duration drive → red: both phase-distortion cases.
//   DADR not mapped to skipSustain → red: the DADR case only.
//   delay segment given no time → red: the matrix delay case only.
#include "../dsp/voice/envelope_shapes.h"
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

Envelope prepared(const EnvelopeShape& shape, double rate = 48000.0) {
  Envelope env;
  env.prepare(rate);
  env.setShape(shape);
  return env;
}

/// Samples of `advance(bus, 1)`, one per frame; `first` for the first frame.
std::vector<float> render(Envelope& env, const TriggerBus& first, const TriggerBus& rest,
                          int frames) {
  std::vector<float> out;
  out.reserve(static_cast<std::size_t>(frames));
  out.push_back(env.advance(first, 1));
  for (int i = 1; i < frames; ++i) out.push_back(env.advance(rest, 1));
  return out;
}

/// Frames until `env.segment()` reaches `index`, holding the gate. −1 if never.
int framesUntilSegment(Envelope& env, int index, int limit) {
  for (int i = 0; i < limit; ++i) {
    if (env.segment() >= index) return i;
    env.advance(held(), 1);
  }
  return -1;
}

}  // namespace

// ───────────────────────────────────────────────────────── DCO polysynth

MW_TEST("VS-11 the DCO polysynth attack ends at one time constant") {
  Envelope env = prepared(dcoPoly(1.0f, 1.0f, 1.0f, 1.0f));
  std::vector<float> v = render(env, pressed(), held(), 48000);
  MW_EXPECT(std::fabs(v[47999] - 1.0f) < 0.001f);
  MW_EXPECT(std::fabs(v[23999] - 0.6225f) < 0.002f);
}

MW_TEST("the DCO polysynth's decay and release are one curve") {
  // A decay from 1 to 0 over 200 ms, and a release from 1 to 0 over 200 ms.
  // One timing circuit serves both on the hardware, so they are the same
  // samples here — not similar, the same.
  Envelope decaying = prepared(dcoPoly(0.0f, 0.2f, 0.0f, 0.2f));
  decaying.advance(pressed(), 1);
  std::vector<float> decay = render(decaying, held(), held(), 9600);

  Envelope releasing = prepared(dcoPoly(0.0f, 0.0f, 1.0f, 0.2f));
  releasing.advance(pressed(), 1);
  releasing.advance(held(), 2);
  MW_EXPECT(releasing.sustaining());
  releasing.advance(released(), 1);
  std::vector<float> release = render(releasing, released(), released(), 9600);

  int differing = 0;
  for (std::size_t i = 0; i < decay.size(); ++i) {
    if (decay[i] != release[i]) ++differing;
  }
  MW_EXPECT_EQ(differing, 0);
  MW_EXPECT(decay[0] > 0.9f);
  MW_EXPECT(std::fabs(decay[9599]) < 1e-4f);
}

MW_TEST("the measured slider rows are reproduced and the law between them is logarithmic") {
  for (int i = 0; i < 5; ++i) {
    MW_EXPECT_NEAR(static_cast<double>(dcoPolyAttackSeconds(kDcoPolySlider[i])),
                   static_cast<double>(kDcoPolyAttack[i]), 1e-6);
    MW_EXPECT_NEAR(static_cast<double>(dcoPolyDecaySeconds(kDcoPolySlider[i])),
                   static_cast<double>(kDcoPolyDecay[i]), 1e-6);
  }
  // Half-way between the 5 and 7.5 rows in slider is the geometric mean of
  // their times, 2.092 s. A linear interpolation would say 2.717 s.
  MW_EXPECT_NEAR(static_cast<double>(dcoPolyDecaySeconds(6.25f)), 2.0923, 0.005);
  float previous = dcoPolyDecaySeconds(0.0f);
  for (int step = 1; step <= 100; ++step) {
    const float now = dcoPolyDecaySeconds(static_cast<float>(step) * 0.1f);
    MW_EXPECT(now > previous);
    previous = now;
  }
  MW_EXPECT_NEAR(static_cast<double>(dcoPolyAttackSeconds(-1.0f)), 0.001, 1e-9);
  MW_EXPECT_NEAR(static_cast<double>(dcoPolyAttackSeconds(11.0f)), 3.25, 1e-6);
}

MW_TEST("VS-12 the DCO polysynth decay does not shorten when the sustain rises") {
  int lengths[2] = {0, 0};
  const float sustains[2] = {0.0f, 0.5f};
  for (int i = 0; i < 2; ++i) {
    Envelope env = prepared(dcoPoly(0.001f, 0.5f, sustains[i], 0.1f));
    env.advance(pressed(), 1);
    lengths[i] = framesUntilSegment(env, 2, 96000);
    MW_EXPECT(lengths[i] > 0);
  }
  const float ratio = static_cast<float>(lengths[1]) / static_cast<float>(lengths[0]);
  MW_EXPECT(std::fabs(ratio - 1.0f) <= 0.15f);
}

// ────────────────────────────────────────────────────── phase distortion

MW_TEST("a phase-distortion step's time falls out of its distance") {
  int lengths[2] = {0, 0};
  const float levels[2] = {0.5f, 1.0f};
  for (int i = 0; i < 2; ++i) {
    RateLevel steps[kMaxSegments] = {};
    for (RateLevel& step : steps) step = {2.0f, levels[i]};
    Envelope env = prepared(phaseDistortion(steps, 7, 7));
    env.advance(pressed(), 1);
    lengths[i] = framesUntilSegment(env, 1, 96000);
    MW_EXPECT(lengths[i] > 0);
  }
  // 2 units per second: 0.25 s to reach 0.5 and 0.5 s to reach 1.0. Inverting
  // rate and duration — the error `syn-02` §4.1 names — gives 1:1 here.
  const float ratio = static_cast<float>(lengths[1]) / static_cast<float>(lengths[0]);
  MW_EXPECT(std::fabs(ratio - 2.0f) < 0.02f);
  MW_EXPECT(std::fabs(static_cast<float>(lengths[0]) / 48000.0f - 0.25f) < 0.002f);
}

MW_TEST("phase-distortion steps are straight, sustain at any step and end at any step") {
  RateLevel steps[kMaxSegments] = {{10.0f, 1.0f}, {10.0f, 0.2f}, {10.0f, 0.8f}, {10.0f, 0.4f},
                                   {10.0f, 0.6f}, {10.0f, 0.6f}, {10.0f, 0.0f}, {10.0f, 1.0f}};
  Envelope env = prepared(phaseDistortion(steps, 5, 6));
  std::vector<float> rise = render(env, pressed(), held(), 4700);
  // Straight: no sample strays from the line through the first and last by
  // more than a float's worth of accumulated step. A curve of any kind is off
  // that line by percent at the middle.
  const float first = rise.front();
  const float last = rise.back();
  const float span = static_cast<float>(rise.size() - 1);
  float worst = 0.0f;
  for (std::size_t i = 0; i < rise.size(); ++i) {
    const float onLine = first + (last - first) * (static_cast<float>(i) / span);
    worst = std::fmax(worst, std::fabs(rise[i] - onLine));
  }
  MW_EXPECT(worst < 1e-4f);
  MW_EXPECT(last > 0.97f);
  // Through the steps to step 5, which holds at 0.6 for as long as the gate
  // does; then release runs to step 6 and stops there. Step 7 is never entered.
  env.advance(held(), 48000);
  MW_EXPECT(env.sustaining());
  MW_EXPECT_EQ(env.segment(), 5);
  MW_EXPECT(std::fabs(env.value() - 0.6f) < 1e-4f);
  int highest = 0;
  for (int i = 0; i < 48000; ++i) {
    env.advance(released(), 1);
    if (env.segment() > highest) highest = env.segment();
  }
  MW_EXPECT(env.finished());
  MW_EXPECT_EQ(highest, 6);
  MW_EXPECT(std::fabs(env.value()) < 1e-6f);
}

// ──────────────────────────────────────────────────────── analogue five

MW_TEST("the early revision is straight and the later one is curved") {
  Envelope early = prepared(analogueFive(0.2f, 0.2f, 0.5f, 0.2f, AnalogueRevision::Early, true));
  std::vector<float> e = render(early, pressed(), held(), 9600);
  Envelope later = prepared(analogueFive(0.2f, 0.2f, 0.5f, 0.2f, AnalogueRevision::Later, true));
  std::vector<float> l = render(later, pressed(), held(), 9600);
  // Half-way through a 200 ms attack: a straight line is at 0.5, and (3') over
  // 3.5 time constants is at 0.841. Both arrive.
  MW_EXPECT(std::fabs(e[4799] - 0.5f) < 0.01f);
  MW_EXPECT(l[4799] > 0.8f);
  MW_EXPECT(std::fabs(e[9599] - 1.0f) < 1e-3f);
  MW_EXPECT(std::fabs(l[9599] - 1.0f) < 1e-3f);
}

MW_TEST("the release switch stops the note at key-up whatever the release says") {
  Envelope on = prepared(analogueFive(0.001f, 0.001f, 1.0f, 5.0f, AnalogueRevision::Early, true));
  on.advance(pressed(), 1);
  on.advance(held(), 1000);
  on.advance(released(), 4800);
  MW_EXPECT(on.value() > 0.5f);
  MW_EXPECT(!on.finished());

  Envelope off = prepared(analogueFive(0.001f, 0.001f, 1.0f, 5.0f, AnalogueRevision::Early, false));
  off.advance(pressed(), 1);
  off.advance(held(), 1000);
  MW_EXPECT(off.value() > 0.99f);
  off.advance(released(), 2);
  MW_EXPECT(off.finished());
  MW_EXPECT(std::fabs(off.value()) < 1e-6f);
}

// ───────────────────────────────────────────────────────────────── matrix

MW_TEST("the matrix delay holds at the floor for exactly its time before the attack") {
  MatrixEnvelope m;
  m.delaySeconds = 0.1f;
  m.attackSeconds = 0.05f;
  m.decaySeconds = 0.05f;
  m.sustain = 0.5f;
  m.releaseSeconds = 0.05f;
  Envelope env = prepared(matrix(m));
  std::vector<float> v = render(env, pressed(), held(), 9600);
  int firstAbove = -1;
  for (std::size_t i = 0; i < v.size(); ++i) {
    if (v[i] > 0.0f) {
      firstAbove = static_cast<int>(i);
      break;
    }
  }
  // 100 ms at 48 kHz is 4800 samples of exact silence, then the attack starts.
  MW_EXPECT(firstAbove >= 4798);
  MW_EXPECT(firstAbove <= 4802);
  MW_EXPECT(std::fabs(v[7199] - 1.0f) < 0.01f);
  // The sustain hold latches when the sustain segment *completes*, one sample
  // after the decay arrives.
  env.advance(held(), 4);
  MW_EXPECT(env.sustaining());
  MW_EXPECT(std::fabs(env.value() - 0.5f) < 0.01f);
}

MW_TEST("DADR runs through the sustain while the gate is still held") {
  MatrixEnvelope m;
  m.delaySeconds = 0.01f;
  m.attackSeconds = 0.01f;
  m.decaySeconds = 0.01f;
  m.sustain = 0.5f;
  m.releaseSeconds = 0.01f;
  Envelope holding = prepared(matrix(m));
  holding.advance(pressed(), 1);
  holding.advance(held(), 48000);
  MW_EXPECT(holding.sustaining());
  MW_EXPECT(!holding.finished());

  m.dadr = true;
  Envelope through = prepared(matrix(m));
  through.advance(pressed(), 1);
  through.advance(held(), 48000);
  MW_EXPECT(through.finished());
  MW_EXPECT(std::fabs(through.value()) < 1e-6f);
}

MW_TEST("a looping matrix shape restarts at its end") {
  MatrixEnvelope m;
  m.delaySeconds = 0.01f;
  m.attackSeconds = 0.01f;
  m.decaySeconds = 0.01f;
  m.sustain = 0.5f;
  m.releaseSeconds = 0.01f;
  m.gated = false;
  m.loop = true;
  Envelope env = prepared(matrix(m));
  env.advance(pressed(), 1);
  env.advance(released(), 96000);
  MW_EXPECT(!env.finished());
  // Still cycling two seconds into a 40 ms shape: one more cycle holds both
  // the attack's peak and the delay's silence.
  float lowest = 1.0f;
  float highest = 0.0f;
  for (int i = 0; i < 2000; ++i) {
    const float level = env.advance(released(), 1);
    if (level < lowest) lowest = level;
    if (level > highest) highest = level;
  }
  MW_EXPECT(highest > 0.9f);
  MW_EXPECT(lowest < 0.01f);
}

// ───────────────────────────────────────────────── real-time safety, §6.2

MW_TEST("nothing on the audio path allocates, for any linear family") {
  RateLevel pd[kMaxSegments] = {};
  for (RateLevel& step : pd) step = {40.0f, 0.7f};
  MatrixEnvelope m;
  m.dadr = true;
  Envelope envs[4] = {
      prepared(dcoPoly(0.01f, 0.05f, 0.5f, 0.05f)), prepared(phaseDistortion(pd, 3, 6)),
      prepared(analogueFive(0.01f, 0.05f, 0.5f, 0.05f, AnalogueRevision::Later, true)),
      prepared(matrix(m))};
  mw::test::RtGuard guard;
  TriggerBus bus = pressed();
  for (int i = 0; i < 400; ++i) {
    for (Envelope& env : envs) env.advance(bus, 64);
    bus.single = (i % 37) == 0;
    bus.multi = bus.single;
    bus.gate = (i % 11) != 0;
  }
  MW_EXPECT_EQ(static_cast<int>(guard.allocations()), 0);
}

MW_TEST("the RtGuard is watching rather than asleep") {
  std::vector<float> scratch;
  mw::test::RtGuard guard;
  scratch.resize(1024);
  MW_EXPECT(guard.allocations() > 0);
}

MW_TEST_MAIN("envelope shapes, linear")
