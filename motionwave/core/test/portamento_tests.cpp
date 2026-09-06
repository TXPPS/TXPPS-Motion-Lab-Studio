// Motion Wave — glide. `lib-voice-substrate.md` §5.6 and §8: VS-25, VS-26 and
// VS-28, the glide's halves of VS-07 and VS-31, and the sampler sheet's shape
// and law rows (V-11 to V-14 and V-17) where they add a number the design does
// not state. The stagger — VS-27 and the three derivations of δ — is
// `portamento_stagger_tests.cpp`; the two files are one voice's glide and a
// chord's.
//
// Every number is derived from the formulas, never read off the code: 3.4641
// is √12, 7.215 is 12·(1 − e^(−0.875))/(1 − e^(−3.5)), 1.757 is
// 12·0.5·(1 − cos(π/4)). Arrival is measured to 0.1 cent because that is a
// beat once every 39 seconds at 440 Hz, and it is the tolerance an
// unnormalised RC glide cannot meet — VS-26's own named mutation.
//
// Mutation-tested, each edit restored before the next, and recorded as
// observed rather than as predicted:
//   the RC shape as a one-pole slewing toward the target, no normalisation and
//     no snap → red: VS-26 (11.64 semitones at t = duration), the V-14 shape
//     case, and VS-25's κ = 0 case — without the snap a 24-semitone linear
//     glide, moving 0.125 cent a sample, never comes within 0.1 cent either.
//   `start` taking its origin from the previous *note* rather than the voice's
//     current pitch → red: VS-28's interrupt case only.
//   (14) giving a lone voice 1 − S → red: VS-28's single-voice case only.
//   the duration law as a two-way switch on κ → red: VS-25's middle row and
//     the sheet's V-13 numbers; both κ = 0 and κ = 1 stayed green, as a switch
//     would.
//   `Legato` ignoring whether another key was held → red: the legato case only.
//   pitch held for a whole block instead of written per sample → red: the
//     per-sample case, VS-26 and V-14.
//   the 1 ms and 30 s clamps removed → red: the clamp case only.
#include "../dsp/voice/portamento.h"
#include "harness.h"
#include "rt_guard.h"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::dsp::voice;

namespace {

constexpr double kRate = 48000.0;

GlideConfig on(float seconds = 0.4f, float kappa = 0.5f, GlideShape shape = GlideShape::Rc) {
  GlideConfig c;
  c.trigger = GlideTrigger::On;
  c.timeSeconds = seconds;
  c.kappa = kappa;
  c.shape = shape;
  return c;
}

Glide prepared(const GlideConfig& config, int voices = 4, double rate = kRate) {
  Glide g;
  g.prepare(rate, voices, config);
  return g;
}

/// A first note on a voice lands directly; this is how every case gets an origin.
void place(Glide& g, VoiceId voice, float note) {
  g.start(voice, note, true);
  g.commitChord();
}

/// Frames from the start of the glide until the pitch is within 0.1 cent of
/// `target`, rendered one sample at a time. Zero if it never gets there.
std::uint64_t framesToArrive(Glide& g, VoiceId voice, float target, std::uint64_t limit) {
  float sample = 0.0f;
  for (std::uint64_t i = 0; i < limit; ++i) {
    g.render(voice, &sample, 1);
    if (std::fabs(sample - target) < 0.001f) return i + 1;
  }
  return 0;
}

double secondsToArrive(Glide& g, VoiceId voice, float target) {
  return static_cast<double>(framesToArrive(g, voice, target, 35 * 48000)) / kRate;
}

}  // namespace

// ──────────────────────────────────────────── VS-25: one law, a continuum

MW_TEST("VS-25 kappa 0 is constant time: a 2-semitone and a 24-semitone glide take the same 400 ms") {
  Glide g = prepared(on(0.4f, 0.0f, GlideShape::Linear));
  place(g, 0, 60.0f);
  place(g, 1, 60.0f);
  g.start(0, 62.0f, true);
  g.start(1, 84.0f, true);
  g.commitChord();
  const double t2 = secondsToArrive(g, 0, 62.0f);
  const double t24 = secondsToArrive(g, 1, 84.0f);
  std::printf("    kappa 0: 2 semitones %.4f s, 24 semitones %.4f s\n", t2, t24);
  MW_EXPECT_NEAR(t2, 0.4, 0.001);
  MW_EXPECT_NEAR(t24, t2, 0.001);
}

MW_TEST("VS-25 kappa 1 is constant rate: the octave-and-a-half takes twelve times the whole tone") {
  Glide g = prepared(on(0.4f, 1.0f, GlideShape::Linear));
  place(g, 0, 60.0f);
  place(g, 1, 60.0f);
  g.start(0, 62.0f, true);
  g.start(1, 84.0f, true);
  g.commitChord();
  const double t2 = secondsToArrive(g, 0, 62.0f);
  const double t24 = secondsToArrive(g, 1, 84.0f);
  std::printf("    kappa 1: 2 semitones %.4f s, 24 semitones %.4f s, ratio %.3f\n", t2, t24, t24 / t2);
  MW_EXPECT_NEAR(t24 / t2, 12.0, 0.24);
  MW_EXPECT_NEAR(t24, 0.8, 0.002);
}

MW_TEST("VS-25 kappa 0.5 is the middle a two-way switch cannot produce: a ratio of root twelve") {
  Glide g = prepared(on(0.4f, 0.5f, GlideShape::Linear));
  place(g, 0, 60.0f);
  place(g, 1, 60.0f);
  g.start(0, 62.0f, true);
  g.start(1, 84.0f, true);
  g.commitChord();
  const double t2 = secondsToArrive(g, 0, 62.0f);
  const double t24 = secondsToArrive(g, 1, 84.0f);
  std::printf("    kappa 0.5: 2 semitones %.4f s, 24 semitones %.4f s, ratio %.3f\n", t2, t24, t24 / t2);
  MW_EXPECT_NEAR(t24 / t2, 3.4641, 0.104);
  MW_EXPECT(t2 >= 0.001 && t24 <= 30.0);
}

MW_TEST("V-12 and V-13: the sheet's own constant-rate and hybrid numbers") {
  // κ = 1, T = 500 ms: 1, 7, 12 and 24 semitones take 41.7, 291.7, 500 and 1000 ms.
  const float intervals[] = {1.0f, 7.0f, 12.0f, 24.0f};
  const double expected[] = {0.0417, 0.2917, 0.5, 1.0};
  for (int i = 0; i < 4; ++i) {
    Glide g = prepared(on(0.5f, 1.0f, GlideShape::Linear));
    place(g, 0, 60.0f);
    g.start(0, 60.0f + intervals[i], true);
    g.commitChord();
    MW_EXPECT_NEAR(secondsToArrive(g, 0, 60.0f + intervals[i]), expected[i], 0.002);
  }
  // κ = 0.5, T = 500 ms: 3 and 24 semitones take 250.0 and 707.1 ms.
  Glide h = prepared(on(0.5f, 0.5f, GlideShape::Linear));
  place(h, 0, 60.0f);
  place(h, 1, 60.0f);
  h.start(0, 63.0f, true);
  h.start(1, 84.0f, true);
  h.commitChord();
  MW_EXPECT_NEAR(secondsToArrive(h, 0, 63.0f), 0.25, 0.002);
  MW_EXPECT_NEAR(secondsToArrive(h, 1, 84.0f), 0.7071, 0.002);
}

// ──────────────────────────────────────────────── VS-26: arrival is exact

MW_TEST("VS-26 every shape lands on its target within 0.1 cent at t = duration, and stays there") {
  for (const GlideShape shape : {GlideShape::Linear, GlideShape::Rc, GlideShape::SCurve}) {
    Glide g = prepared(on(0.4f, 0.0f, shape));
    place(g, 0, 60.0f);
    g.start(0, 72.0f, true);
    g.commitChord();
    const auto frames = static_cast<int>(static_cast<double>(g.durationSeconds(0)) * kRate + 0.5);
    std::vector<float> out(static_cast<std::size_t>(frames), 0.0f);
    g.render(0, out.data(), frames);
    std::printf("    shape %d: %.5f semitones at t = duration (%d frames), %.5f the sample before\n",
                static_cast<int>(shape), static_cast<double>(out.back()), frames,
                static_cast<double>(out[out.size() - 2]));
    MW_EXPECT_NEAR(out.back(), 72.0f, 0.001);
    MW_EXPECT(!g.gliding(0));
    // And not merely passing through: the sample before arrival is on the
    // curve, so nothing snapped there from far away.
    MW_EXPECT(std::fabs(out[out.size() - 2] - 72.0f) < 0.02f);
    g.render(0, out.data(), frames);
    MW_EXPECT_NEAR(out.back(), 72.0f, 0.001);
    MW_EXPECT_NEAR(g.note(0), 72.0f, 0.001);
  }
}

MW_TEST("V-14 the three shapes pass through the sheet's points, and the face's closed form agrees") {
  const GlideShape shapes[] = {GlideShape::Linear, GlideShape::Rc, GlideShape::SCurve};
  const float expected[3][3] = {{63.0f, 66.0f, 69.0f},
                                {67.215f, 70.223f, 71.478f},
                                {61.757f, 66.0f, 70.243f}};
  for (int s = 0; s < 3; ++s) {
    Glide g = prepared(on(1.0f, 0.0f, shapes[s]));
    place(g, 0, 60.0f);
    g.start(0, 72.0f, true);
    g.commitChord();
    std::vector<float> out(12000, 0.0f);
    for (int quarter = 0; quarter < 3; ++quarter) {
      g.render(0, out.data(), 12000);
      const float u = 0.25f * static_cast<float>(quarter + 1);
      MW_EXPECT_NEAR(out.back(), expected[s][quarter], 0.02);
      MW_EXPECT_NEAR(out.back(), 60.0f + 12.0f * glideShape(shapes[s], u), 0.001);
    }
  }
  // The S-curve has no pitch velocity at either end: under 0.5 semitone/s in
  // the last ten milliseconds of a one-second octave.
  Glide s = prepared(on(1.0f, 0.0f, GlideShape::SCurve));
  place(s, 0, 60.0f);
  s.start(0, 72.0f, true);
  s.commitChord();
  std::vector<float> out(48000, 0.0f);
  s.render(0, out.data(), 48000);
  MW_EXPECT(std::fabs(out[47999] - out[47519]) <= 0.005f);
  MW_EXPECT(std::fabs(out[479] - out[0]) <= 0.005f);
}

// ─────────────────────────────────────── VS-28: the origin is the voice

MW_TEST("VS-28 a note arriving mid-glide starts from where the voice is, not from the previous note") {
  Glide g = prepared(on(2.0f, 0.0f, GlideShape::Linear));
  place(g, 0, 36.0f);
  g.start(0, 60.0f, true);
  g.commitChord();
  std::vector<float> out(38400, 0.0f);  // 40 % of two seconds
  g.render(0, out.data(), 38400);
  const float before = g.note(0);
  MW_EXPECT_NEAR(before, 45.6f, 0.01);
  g.start(0, 48.0f, true);
  g.commitChord();
  const float after = g.note(0);
  float first = 0.0f;
  g.render(0, &first, 1);
  MW_EXPECT(std::fabs(after - before) < 0.02f);
  MW_EXPECT(std::fabs(first - before) < 0.02f);
  MW_EXPECT(g.gliding(0));

  // The sheet's V-17: interrupted at 35 % the origin is 44.4 semitones.
  Glide h = prepared(on(2.0f, 0.0f, GlideShape::Linear));
  place(h, 0, 36.0f);
  h.start(0, 60.0f, true);
  h.commitChord();
  out.assign(33600, 0.0f);
  h.render(0, out.data(), 33600);
  h.start(0, 48.0f, true);
  MW_EXPECT_NEAR(h.note(0), 44.4f, 0.05);
}

MW_TEST("VS-28 a single voice gets delta 1, so the stagger control cannot change monophonic glide time") {
  for (int step = 0; step <= 10; ++step) {
    GlideConfig c = on(0.4f, 0.0f, GlideShape::Linear);
    c.stagger = 0.1f * static_cast<float>(step);
    Glide g = prepared(c, 1);
    place(g, 0, 60.0f);
    g.start(0, 72.0f, true);
    g.commitChord();
    MW_EXPECT_NEAR(g.durationSeconds(0), 0.4f, 0.004);
  }
}

// ───────────────────────────────────────────── triggers and the clamps

MW_TEST("Legato glides only when another key was held; Off never glides; a fresh voice lands") {
  GlideConfig c = on();
  c.trigger = GlideTrigger::Legato;
  Glide g = prepared(c);
  g.start(0, 60.0f, false);
  g.commitChord();
  g.start(0, 62.0f, false);
  g.commitChord();
  MW_EXPECT(!g.gliding(0));
  MW_EXPECT_NEAR(g.note(0), 62.0f, 1e-6);
  g.start(0, 64.0f, true);
  g.commitChord();
  MW_EXPECT(g.gliding(0));

  c.trigger = GlideTrigger::Off;
  Glide off = prepared(c);
  place(off, 0, 60.0f);
  off.start(0, 72.0f, true);
  off.commitChord();
  MW_EXPECT(!off.gliding(0));
  MW_EXPECT_NEAR(off.note(0), 72.0f, 1e-6);

  Glide fresh = prepared(on());
  fresh.start(1, 72.0f, true);
  fresh.commitChord();
  MW_EXPECT(!fresh.gliding(1));
  MW_EXPECT_NEAR(fresh.note(1), 72.0f, 1e-6);
}

MW_TEST("the duration is clamped to a millisecond and to thirty seconds") {
  Glide fast = prepared(on(0.00001f, 0.0f));
  place(fast, 0, 60.0f);
  fast.start(0, 72.0f, true);
  fast.commitChord();
  MW_EXPECT_NEAR(fast.durationSeconds(0), 0.001f, 1e-5);
  Glide slow = prepared(on(100.0f, 0.0f));
  place(slow, 0, 60.0f);
  slow.start(0, 72.0f, true);
  slow.commitChord();
  MW_EXPECT_NEAR(slow.durationSeconds(0), 30.0f, 1e-3);
}

// ───────────────────────────────────── per sample, and the block split

MW_TEST("VS-07 pitch is written per sample: one-frame and 1024-frame renders are the same samples") {
  Glide a = prepared(on(0.4f, 0.0f, GlideShape::Rc));
  Glide b = prepared(on(0.4f, 0.0f, GlideShape::Rc));
  for (Glide* g : {&a, &b}) {
    place(*g, 0, 60.0f);
    g->start(0, 72.0f, true);
    g->commitChord();
  }
  std::vector<float> one(20480, 0.0f);
  std::vector<float> big(20480, 0.0f);
  for (std::size_t i = 0; i < one.size(); ++i) a.render(0, &one[i], 1);
  for (std::size_t i = 0; i < big.size(); i += 1024) b.render(0, &big[i], 1024);
  int bad = 0;
  for (std::size_t i = 0; i < one.size(); ++i) bad += one[i] != big[i] ? 1 : 0;
  MW_EXPECT_EQ(bad, 0);
  // Per sample, not per block: no step is larger than four times the mean
  // slope, which is the RC's own steepest point, and the pitch moves inside
  // every block rather than only between them.
  const float mean = 12.0f / (0.4f * 48000.0f);
  float worst = 0.0f;
  for (std::size_t i = 1; i < 19000; ++i) {
    const float step = std::fabs(one[i] - one[i - 1]);
    if (step > worst) worst = step;
  }
  MW_EXPECT(worst <= 4.0f * mean);
  MW_EXPECT(big[10] != big[20]);
}

MW_TEST("VS-31 starting, committing and rendering allocate nothing") {
  GlideConfig c = on(0.3f, 0.5f, GlideShape::SCurve);
  c.stagger = 0.4f;
  Glide g = prepared(c, 16);
  std::vector<float> out(256, 0.0f);
  mw::test::RtGuard guard;
  for (int round = 0; round < 50; ++round) {
    for (VoiceId v = 0; v < 16; ++v) g.start(v, 48.0f + static_cast<float>((round * 7 + v) % 36), true);
    g.commitChord();
    for (int block = 0; block < 8; ++block) {
      for (VoiceId v = 0; v < 16; ++v) g.render(v, out.data(), 256);
    }
    if (round == 25) g.reset();
  }
  MW_EXPECT_EQ(static_cast<int>(guard.allocations()), 0);
}

MW_TEST("the RtGuard is watching rather than asleep") {
  Glide g;
  mw::test::RtGuard guard;
  g.prepare(kRate, 64, on());  // `prepare` is the one call allowed to
  MW_EXPECT(guard.allocations() > 0);
}

MW_TEST_MAIN("portamento")
