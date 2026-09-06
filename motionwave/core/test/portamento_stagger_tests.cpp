// Motion Wave — glide, the stagger. `lib-voice-substrate.md` §5.6 and §8:
// VS-27 and the three derivations of δ, (14) to (16). The duration law, the
// shapes, the origin rule and real-time safety are `portamento_tests.cpp`;
// the two files are one voice's glide and a chord's.
//
// The worked case is (14) at S = 0.5 for four voices, used verbatim as the
// design's VS-27 and the sampler sheet's V-15, and its starts are scrambled
// on purpose so that the sort — not the order the notes happened to arrive
// in — is what puts voice 0 first.
//
// Mutation-tested, each edit restored before the next, and recorded as
// observed rather than as predicted:
//   the chord committed in start order rather than sorted → red: VS-27 and
//     the order case; nothing else.
//   (14) giving a lone voice 1 − S → red: nothing here; VS-28's single-voice
//     case in `portamento_tests.cpp` is what catches it, and every chord here
//     has more than one voice.
#include "../dsp/voice/portamento.h"
#include "harness.h"
#include "rt_guard.h"

#include <cmath>
#include <cstdint>
#include <cstdio>

using namespace mw;
using namespace mw::dsp::voice;

namespace {

constexpr double kRate = 48000.0;

GlideConfig on(float seconds = 0.4f, float kappa = 0.0f, GlideShape shape = GlideShape::Linear) {
  GlideConfig c;
  c.trigger = GlideTrigger::On;
  c.timeSeconds = seconds;
  c.kappa = kappa;
  c.shape = shape;
  return c;
}

Glide prepared(const GlideConfig& config, int voices = 4) {
  Glide g;
  g.prepare(kRate, voices, config);
  return g;
}

/// A first note on a voice lands directly; this is how every case gets an origin.
void place(Glide& g, VoiceId voice, float note) {
  g.start(voice, note, true);
  g.commitChord();
}

/// Four voices started out of order, each seven semitones above where it sits.
void scrambledChord(Glide& g) {
  for (const int i : {2, 0, 3, 1}) {
    const auto v = static_cast<VoiceId>(i);
    g.start(v, 67.0f + 2.0f * static_cast<float>(v), true);
  }
  g.commitChord();
}

}  // namespace

// ─────────────────────────────────────────── VS-27: the worked stagger

MW_TEST("VS-27 four voices, equal intervals, Spread at 0.5, LowFirst: 200 / 333 / 467 / 600 ms") {
  GlideConfig c = on();
  c.stagger = 0.5f;
  c.staggerMode = StaggerMode::Spread;
  c.staggerOrder = StaggerOrder::LowFirst;
  Glide g = prepared(c);
  for (VoiceId v = 0; v < 4; ++v) place(g, v, 60.0f + 2.0f * static_cast<float>(v));
  scrambledChord(g);
  const double expected[] = {0.2, 0.33333, 0.46667, 0.6};
  std::printf("    durations %.4f / %.4f / %.4f / %.4f s, spread %.4f s\n",
              static_cast<double>(g.durationSeconds(0)), static_cast<double>(g.durationSeconds(1)),
              static_cast<double>(g.durationSeconds(2)), static_cast<double>(g.durationSeconds(3)),
              static_cast<double>(g.arrivalSpread()));
  for (VoiceId v = 0; v < 4; ++v) {
    MW_EXPECT_NEAR(g.durationSeconds(v), expected[v], 0.01 * expected[v]);
  }
  MW_EXPECT_NEAR(g.arrivalSpread(), 0.4f, 0.004);

  // Arrival order by rendering all four, sample by sample.
  std::uint64_t arrived[4] = {0, 0, 0, 0};
  float sample = 0.0f;
  for (std::uint64_t i = 1; i <= 48000; ++i) {
    for (VoiceId v = 0; v < 4; ++v) {
      g.render(v, &sample, 1);
      if (arrived[v] == 0 && !g.gliding(v)) arrived[v] = i;
    }
  }
  MW_EXPECT(arrived[0] > 0 && arrived[0] < arrived[1]);
  MW_EXPECT(arrived[1] < arrived[2]);
  MW_EXPECT(arrived[2] < arrived[3]);
  MW_EXPECT_NEAR(static_cast<double>(arrived[3] - arrived[0]) / kRate, 0.4, 0.004);
}

MW_TEST("only the sort key changes between orders; HighFirst reverses and PlayOrder follows the starts") {
  GlideConfig c = on();
  c.stagger = 0.5f;
  c.staggerOrder = StaggerOrder::HighFirst;
  Glide g = prepared(c);
  for (VoiceId v = 0; v < 4; ++v) place(g, v, 60.0f);
  scrambledChord(g);
  MW_EXPECT_NEAR(g.durationSeconds(3), 0.2f, 0.002);
  MW_EXPECT_NEAR(g.durationSeconds(0), 0.6f, 0.006);

  c.staggerOrder = StaggerOrder::PlayOrder;
  Glide p = prepared(c);
  for (VoiceId v = 0; v < 4; ++v) place(p, v, 60.0f);
  scrambledChord(p);
  MW_EXPECT_NEAR(p.durationSeconds(2), 0.2f, 0.002);
  MW_EXPECT_NEAR(p.durationSeconds(1), 0.6f, 0.006);

  c.staggerOrder = StaggerOrder::OutsideIn;
  Glide o = prepared(c);
  for (VoiceId v = 0; v < 4; ++v) place(o, v, 60.0f);
  for (VoiceId v = 0; v < 4; ++v) o.start(v, 67.0f + 2.0f * static_cast<float>(v), true);
  o.commitChord();
  // The outermost pair is shortest, the innermost longest.
  MW_EXPECT(o.durationSeconds(0) < o.durationSeconds(1));
  MW_EXPECT(o.durationSeconds(3) < o.durationSeconds(2));
}

MW_TEST("IntervalDerived puts constant-rate's natural stagger back under constant time") {
  // Intervals 2, 4, 6, 8 with a mean of 5: at κ = 0 the durations are T·d/5.
  GlideConfig c = on();
  c.staggerMode = StaggerMode::IntervalDerived;
  Glide g = prepared(c);
  for (VoiceId v = 0; v < 4; ++v) place(g, v, 60.0f);
  for (VoiceId v = 0; v < 4; ++v) g.start(v, 62.0f + 2.0f * static_cast<float>(v), true);
  g.commitChord();
  for (VoiceId v = 0; v < 4; ++v) {
    const double d = 2.0 + 2.0 * static_cast<double>(v);
    MW_EXPECT_NEAR(g.durationSeconds(v), 0.4 * d / 5.0, 0.002);
  }
  // At κ = 1 every δ is 1, and the rate law alone staggers by interval.
  c.kappa = 1.0f;
  Glide r = prepared(c);
  for (VoiceId v = 0; v < 4; ++v) place(r, v, 60.0f);
  for (VoiceId v = 0; v < 4; ++v) r.start(v, 62.0f + 2.0f * static_cast<float>(v), true);
  r.commitChord();
  for (VoiceId v = 0; v < 4; ++v) {
    const double d = 2.0 + 2.0 * static_cast<double>(v);
    MW_EXPECT_NEAR(r.durationSeconds(v), 0.4 * d / 12.0, 0.002);
  }
}

MW_TEST("VoiceFixed offsets belong to slots and to the seed") {
  GlideConfig c = on();
  c.staggerMode = StaggerMode::VoiceFixed;
  c.stagger = 0.5f;
  Glide a = prepared(c);
  Glide b = prepared(c);
  c.seed ^= 0xABCDEFull;
  Glide other = prepared(c);
  int same = 0;
  int differ = 0;
  int spread = 0;
  for (Glide* g : {&a, &b, &other}) {
    for (VoiceId v = 0; v < 4; ++v) place(*g, v, 60.0f);
    for (VoiceId v = 0; v < 4; ++v) g->start(v, 72.0f, true);
    g->commitChord();
  }
  for (VoiceId v = 0; v < 4; ++v) {
    same += a.durationSeconds(v) == b.durationSeconds(v) ? 1 : 0;
    differ += a.durationSeconds(v) != other.durationSeconds(v) ? 1 : 0;
    spread += a.durationSeconds(v) != a.durationSeconds(0) ? 1 : 0;
    MW_EXPECT(a.durationSeconds(v) >= 0.2f && a.durationSeconds(v) <= 0.6f);
  }
  MW_EXPECT_EQ(same, 4);
  MW_EXPECT(differ >= 3);
  MW_EXPECT(spread >= 2);
}

MW_TEST("a chord of sixteen sorts, commits and renders without allocating") {
  GlideConfig c = on();
  c.stagger = 0.7f;
  c.staggerOrder = StaggerOrder::OutsideIn;
  Glide g = prepared(c, 16);
  for (VoiceId v = 0; v < 16; ++v) place(g, v, 60.0f);
  float out[64];
  mw::test::RtGuard guard;
  for (int round = 0; round < 20; ++round) {
    for (VoiceId v = 0; v < 16; ++v) g.start(v, 40.0f + static_cast<float>((v * 7 + round) % 48), true);
    g.commitChord();
    for (VoiceId v = 0; v < 16; ++v) g.render(v, out, 64);
  }
  MW_EXPECT_EQ(static_cast<int>(guard.allocations()), 0);
  MW_EXPECT(g.arrivalSpread() > 0.0f);
}

MW_TEST("the RtGuard is watching rather than asleep") {
  Glide g;
  mw::test::RtGuard guard;
  g.prepare(kRate, 64, on());  // `prepare` is the one call allowed to
  MW_EXPECT(guard.allocations() > 0);
}

MW_TEST_MAIN("portamento stagger")
