// Motion Wave — the parameter framework, tested.
//
// Everything the rest of the product depends on lives here: the taper laws that
// keep a display and a processor agreeing, the ramp that keeps a fast move from
// stepping, and the seam that keeps the audio thread from allocating.
#include "../param/param_set.h"
#include "harness.h"
#include "rt_guard.h"

using namespace mw;

namespace {

enum : ParamId { kGain = 1, kCutoff = 2, kMode = 3, kAttack = 4 };

const char* const kModes[] = {"Low", "Band", "High"};

// A spec table of the shape every processor declares. Static storage on
// purpose: ADR-0004 says specs are compile-time tables that outlive the set,
// because copying them per node would allocate once per plugin instance.
const ParamSpec kSpecs[] = {
    {kGain, "Gain", Unit::Decibels, -60.0f, 12.0f, 0.0f, Taper::Linear, 1.0f, 0, 20.0f, nullptr},
    {kCutoff, "Cutoff", Unit::Hertz, 20.0f, 20000.0f, 1000.0f, Taper::Logarithmic, 1.0f, 0, 20.0f,
     nullptr},
    {kMode, "Mode", Unit::Choice, 0.0f, 2.0f, 0.0f, Taper::Stepped, 1.0f, 3, 0.0f, kModes},
    {kAttack, "Attack", Unit::Milliseconds, 0.1f, 2000.0f, 10.0f, Taper::Exponential, 3.0f, 0,
     20.0f, nullptr},
};
constexpr std::size_t kSpecCount = sizeof(kSpecs) / sizeof(kSpecs[0]);

ParamSet makeSet() { return ParamSet(kSpecs, kSpecCount); }

}  // namespace

// ------------------------------------------------------------------- tapers

MW_TEST("a logarithmic taper puts the octave, not the hertz, at the halfway point") {
  const ParamSpec& cutoff = kSpecs[1];
  // 20 Hz to 20 kHz is ten octaves; half the travel must be five octaves up,
  // which is 632 Hz and nothing like the 10 kHz a linear taper would give.
  MW_EXPECT_NEAR(cutoff.toReal(0.5f), 632.4555f, 0.01f);
  MW_EXPECT_NEAR(cutoff.toReal(0.0f), 20.0f, 1e-4f);
  MW_EXPECT_NEAR(cutoff.toReal(1.0f), 20000.0f, 1e-2f);
}

MW_TEST("every taper round-trips, so a display and a processor cannot disagree") {
  for (std::size_t i = 0; i < kSpecCount; ++i) {
    const ParamSpec& spec = kSpecs[i];
    for (int step = 0; step <= 20; ++step) {
      const float n = static_cast<float>(step) / 20.0f;
      const float real = spec.toReal(n);
      const float back = spec.toNormalised(real);
      // Stepped and choice parameters quantise, so they round-trip to the
      // nearest step rather than to the input — which is the correct answer
      // and is asserted separately below.
      const float tolerance = (spec.taper == Taper::Stepped || spec.isChoice()) ? 0.26f : 1e-4f;
      MW_EXPECT_NEAR(back, n, tolerance);
    }
  }
}

MW_TEST("a normalised value outside 0..1 is clamped rather than extrapolated") {
  const ParamSpec& gain = kSpecs[0];
  // A controller sending slightly past full scale must not produce a gain
  // outside the parameter's own range: clamping at this one seam is what lets
  // every processor downstream trust its inputs.
  MW_EXPECT_NEAR(gain.toReal(1.5f), 12.0f, 1e-4f);
  MW_EXPECT_NEAR(gain.toReal(-0.5f), -60.0f, 1e-4f);
}

MW_TEST("a choice parameter selects a whole index and stops at the ends") {
  const ParamSpec& mode = kSpecs[2];
  MW_EXPECT_EQ(mode.toChoice(0.0f), 0);
  MW_EXPECT_EQ(mode.toChoice(0.5f), 1);
  MW_EXPECT_EQ(mode.toChoice(1.0f), 2);
  MW_EXPECT_EQ(mode.toChoice(9.0f), 2);
}

MW_TEST("an exponential taper resolves the bottom of a wide time range") {
  const ParamSpec& attack = kSpecs[3];
  // A cubic law over 0.1 to 2000 ms: a tenth of the travel has to still be in
  // single-figure milliseconds, or the fast half of the control is unusable.
  MW_EXPECT(attack.toReal(0.1f) < 5.0f);
  MW_EXPECT(attack.toReal(0.5f) < 300.0f);
  MW_EXPECT_NEAR(attack.toReal(1.0f), 2000.0f, 1e-2f);
}

// -------------------------------------------------------------------- ramps

MW_TEST("a parameter that has not moved reports a constant block") {
  ParamSet set = makeSet();
  set.prepare(48000.0f, 128);
  set.beginBlock();
  const ParamBlock& gain = set.block(0);
  MW_EXPECT(!gain.moving);
  MW_EXPECT_NEAR(gain.end, 0.0f, 1e-6f);
  MW_EXPECT_NEAR(gain.at(64, 128), gain.end, 1e-6f);
}

MW_TEST("a change travels over several blocks instead of stepping") {
  ParamSet set = makeSet();
  set.prepare(48000.0f, 128);
  set.beginBlock();
  set.post(kGain, kSpecs[0].toNormalised(-24.0f));

  set.beginBlock();
  const ParamBlock first = set.block(0);
  // It must have started moving and must not have arrived: a 20 ms smoother at
  // 48 kHz covers about a seventh of the distance in one 128-frame buffer, and
  // arriving inside one buffer is the zipper this exists to prevent.
  MW_EXPECT(first.moving);
  MW_EXPECT(first.end < first.start);
  MW_EXPECT(first.end > -24.0f);

  for (int i = 0; i < 200; ++i) set.beginBlock();
  MW_EXPECT_NEAR(set.value(0), -24.0f, 1e-3f);
  MW_EXPECT(!set.block(0).moving);
}

MW_TEST("the block's interpolation matches its own endpoints") {
  ParamBlock block;
  block.start = 0.0f;
  block.end = 1.0f;
  block.moving = true;
  MW_EXPECT_NEAR(block.at(0, 129), 0.0f, 1e-6f);
  MW_EXPECT_NEAR(block.at(128, 129), 1.0f, 1e-6f);
  MW_EXPECT_NEAR(block.at(64, 129), 0.5f, 1e-6f);
  MW_EXPECT_NEAR(block.increment(129) * 128.0f, 1.0f, 1e-6f);
}

MW_TEST("a switch arrives at once, because pretending it is continuous is worse") {
  ParamSet set = makeSet();
  set.prepare(48000.0f, 128);
  set.beginBlock();
  set.post(kMode, 1.0f);
  set.beginBlock();
  // Mode has smoothingMs == 0 and is a choice: it must be on its new setting
  // after one block, not sliding between two filter modes.
  MW_EXPECT_EQ(set.choice(2), 2);
  MW_EXPECT(!set.block(2).moving);
}

// --------------------------------------------------------------- the seam

MW_TEST("draining and advancing the whole set allocates nothing") {
  ParamSet set = makeSet();
  set.prepare(48000.0f, 128);
  set.post(kGain, 0.25f);
  set.post(kCutoff, 0.75f);
  {
    ::mw::test::RtGuard guard;
    for (int i = 0; i < 64; ++i) set.beginBlock();
    MW_EXPECT_EQ(static_cast<long long>(guard.allocations()), 0);
  }
}

MW_TEST("posting from the producer side allocates nothing either") {
  ParamSet set = makeSet();
  set.prepare(48000.0f, 128);
  {
    ::mw::test::RtGuard guard;
    for (int i = 0; i < 100; ++i) set.post(kGain, static_cast<float>(i) / 100.0f);
    MW_EXPECT_EQ(static_cast<long long>(guard.allocations()), 0);
  }
}

MW_TEST("a full ring refuses the write rather than growing") {
  ParamSet set = makeSet();
  set.prepare(48000.0f, 128);
  int accepted = 0;
  for (std::size_t i = 0; i < kParamRingDepth * 2; ++i) {
    if (set.post(kGain, 0.5f)) ++accepted;
  }
  // Bounded, and the bound is the ring's usable capacity. The point is that it
  // never allocated to accept more: the next block drains it and the next UI
  // frame posts the newest value again.
  MW_EXPECT(accepted > 0);
  MW_EXPECT(accepted < static_cast<int>(kParamRingDepth * 2));
}

MW_TEST("a change for an unknown parameter is ignored, not misapplied") {
  ParamSet set = makeSet();
  set.prepare(48000.0f, 128);
  const float before = set.value(0);
  set.post(9999, 1.0f);
  set.beginBlock();
  MW_EXPECT_NEAR(set.value(0), before, 1e-6f);
}

MW_TEST("the ring hands elements back in the order they were written") {
  SpscRing<ParamChange, 8> ring;
  for (int i = 0; i < 5; ++i) {
    ParamChange c;
    c.id = static_cast<ParamId>(i);
    MW_EXPECT(ring.push(c));
  }
  for (int i = 0; i < 5; ++i) {
    ParamChange out;
    MW_EXPECT(ring.pop(out));
    MW_EXPECT_EQ(static_cast<long long>(out.id), i);
  }
  ParamChange empty;
  MW_EXPECT(!ring.pop(empty));
}

MW_TEST("the allocation guard catches an allocation, or it is proving nothing") {
  // A guard that cannot fail is decoration. This is the mutation test for the
  // two assertions above: deliberately allocate inside an armed scope and
  // confirm the spy sees it.
  {
    ::mw::test::RtGuard guard;
    volatile float* leak = new float[16];
    const std::size_t seen = guard.allocations();
    delete[] leak;
    MW_EXPECT(seen >= 1);
  }
  // And confirm it stops counting once the scope closes, so one test's
  // allocation cannot fail the next one.
  volatile float* outside = new float[4];
  delete[] outside;
  {
    ::mw::test::RtGuard guard;
    MW_EXPECT_EQ(static_cast<long long>(guard.allocations()), 0);
  }
}

MW_TEST("the harness refuses a comparison whose operands prove nothing") {
  // The guard against vacuous assertions, tested — because a guard that was
  // itself vacuous would be the same bug one level up.
  //
  // It exists because of a real failure: a row asserting the four-button
  // attack lag was at least ten times another lag timed both from the wrong
  // instant, so both read 0.0 µs, and `0 >= 0 * 10` is true. It passed, printed
  // two zeros, and proved nothing. That shape — "a is at least N times b", "a
  // exceeds b by d" — is satisfied by two zeros and usually by two identical
  // values, and nine units remain to write dozens of them.
  MW_EXPECT(!test::isComparable(0.0, 0.0, 1.0e-6));
  MW_EXPECT(!test::isComparable(0.0, 5.0, 1.0e-6));
  MW_EXPECT(!test::isComparable(5.0, 0.0, 1.0e-6));
  // Two identical values, however large. A ratio between them is 1 whatever
  // they are, so no claim about that ratio is a claim about the unit.
  MW_EXPECT(!test::isComparable(7.5, 7.5, 1.0e-6));
  // Below the floor the row itself declared. The floor has to be the row's,
  // because what counts as too small to believe is the measurement's knowledge
  // and not the harness's.
  MW_EXPECT(!test::isComparable(1.0e-9, 4.0, 1.0e-6));
  // And the case that should pass.
  MW_EXPECT(test::isComparable(0.05, 0.5, 1.0e-6));
  MW_EXPECT(test::isComparable(-3.0, -9.0, 1.0e-6));
}

MW_TEST_MAIN("param")
