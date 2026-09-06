// Motion Wave — the shared modulation matrix, as the sheets specify it.
// `smp-01` §9 row V-18 and §6.6; `syn-05` §9.2. The model's own contract —
// counts, refusals, removal, the allocation guard, determinism — is
// `mod_matrix_model_tests.cpp`, and `mod_matrix_harness.h` is what the two
// share.
//
// V-18 as the sampler's sheet states it, on the sampler's own capacities
// (24 sources, 34 destinations, 16 routings, 6 per destination): three
// sources into one destination at +1/3 each read within 1 % of one source at
// +1.0; a 17th routing and a 7th source on one destination are both refused
// at the model layer, and "refused" is checked as a result value *and* as a
// table left bit-for-bit as it was — because the failure the sheet names is
// the silent one, and a refusal that quietly took the routing anyway would
// pass a test that only read the return value.
//
// Then the amount law (linear, signed, zero with either sign collapsed), the
// summation rule (opposing modulations cancel before the clamp), the quantise
// grid (whole native units, per routing) and the reflexive case (a
// generator's own parameter is an index like any other).
//
// Mutation-tested, each edit to `mod_matrix.h` restored before the next; the
// verdicts are the measured ones, and where a mutation also reaches the model
// suite that is said:
//   each contribution clamped to the destination's range before it is added
//     (the clamp-before-sum the sheet forbids) → red: the cancel case only,
//     +2.0 and −1.5 reading 0 rather than +0.5. V-18 stayed green, and
//     should: three contributions of 20 into a ±60 range never touch the
//     clamp, so the cancel case is what carries this rule.
//   `add` returning Ok on a full matrix without storing (silent refusal)
//     → red: the 17th-routing case, on the result value — the table was
//     unchanged either way, which is exactly why the result is asserted.
//     Also the model suite's allocation case.
//   `add` never counting a destination's contributors → red: the 7th-source
//     case (result value and counts) and the three-source case (its count of
//     3); also the model suite's display-count and removal cases.
//   quantise applied to the destination's sum rather than to each routing's
//     contribution → red: the half-step half of the quantise case only, two
//     0.4-semitone routings reading 1 rather than 0. The ramp half stayed
//     green, as it should: with one routing the two rules cannot be told
//     apart, which is why the half-step pair is there.
//   a negative zero stored with its sign → red: the amount-law case, on both
//     `signbit` checks. The evaluations were still bit-identical, because −0
//     added to a sum leaves it unchanged; the stored form is what a display
//     reads, and it is the display the sheet's "collapse" is about.
//   `remove` never releasing its destination's count → red: the 7th-source
//     case, on the add that follows the removal; also the model suite's
//     removal case.
#include "mod_matrix_harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::dsp::mod;
using namespace mw::test::modmatrix;
using mw::dsp::voice::ModFrame;

MW_TEST("V-18: three sources at +1/3 sum to the single-source +1.0 case within 1 %") {
  ModMatrix m = samplerMatrix();
  // Five octaves of cutoff modulation in semitones. The unit is the test's
  // choice; the sheet's row is about the sum, not the unit.
  MW_EXPECT(m.setDestination(kCutoff, spec(60.0f, -60.0f, 60.0f)) == RoutingResult::Ok);
  const ModFrame full = frameAt(1.0f);
  float sums[kMaxDestinations];

  MW_EXPECT(m.add(route(0, kCutoff, 1.0f)) == RoutingResult::Ok);
  m.evaluate(full, sums);
  const float single = sums[kCutoff];

  m.clear();
  for (int s = 0; s < 3; ++s) MW_EXPECT(m.add(route(s, kCutoff, 1.0f / 3.0f)) == RoutingResult::Ok);
  MW_EXPECT_EQ(m.sourcesOn(kCutoff), 3);
  m.evaluate(full, sums);
  const float three = sums[kCutoff];

  std::printf("    V-18: single +1.0 = %.7f, three at +1/3 = %.7f, ratio %.7f\n",
              static_cast<double>(single), static_cast<double>(three),
              static_cast<double>(three / single));
  // A silent matrix would agree with itself; the single case has to be the
  // full-scale value before the comparison means anything.
  MW_EXPECT(single == 60.0f);
  MW_EXPECT_NEAR(three, single, 0.01 * static_cast<double>(single));
}

MW_TEST("V-18: a 17th routing on a 16-routing budget is refused and the matrix is unchanged") {
  ModMatrix m = samplerMatrix();
  for (int d = 0; d < 34; ++d) MW_EXPECT(m.setDestination(d, spec(1.0f, -1.0f, 1.0f)) == RoutingResult::Ok);
  // One routing per destination, so the only limit in play is the budget.
  for (int i = 0; i < 16; ++i) {
    int index = -1;
    MW_EXPECT(m.add(route(i, i, 0.5f), &index) == RoutingResult::Ok);
    MW_EXPECT_EQ(index, i);
  }
  MW_EXPECT_EQ(m.routingCount(), 16);
  MW_EXPECT_EQ(m.maxRoutings(), 16);

  const ModFrame frame = frameAt(0.75f);
  float before[kMaxDestinations];
  float after[kMaxDestinations];
  m.evaluate(frame, before);

  const RoutingResult seventeenth = m.add(route(16, 16, 0.5f));
  MW_EXPECT(seventeenth == RoutingResult::MatrixFull);
  MW_EXPECT_EQ(m.routingCount(), 16);
  MW_EXPECT_EQ(m.sourcesOn(16), 0);
  m.evaluate(frame, after);
  MW_EXPECT(sameBits(before, after, m.destinations()));
  std::printf("    V-18: %d / %d routings; 17th refused with result %d, table unchanged\n",
              m.routingCount(), m.maxRoutings(), static_cast<int>(seventeenth));

  // The refusal is the budget's, not the table's: free one slot and the same
  // routing goes in.
  MW_EXPECT(m.remove(0) == RoutingResult::Ok);
  MW_EXPECT(m.add(route(16, 16, 0.5f)) == RoutingResult::Ok);
  MW_EXPECT_EQ(m.routingCount(), 16);
}

MW_TEST("V-18: a 7th source on one destination is refused with room still in the budget") {
  ModMatrix m = samplerMatrix();
  MW_EXPECT(m.setDestination(kCutoff, spec(1.0f, -1.0f, 1.0f)) == RoutingResult::Ok);
  MW_EXPECT(m.setDestination(kPitch, spec(12.0f, -12.0f, 12.0f)) == RoutingResult::Ok);
  for (int s = 0; s < 6; ++s) MW_EXPECT(m.add(route(s, kCutoff, 1.0f / 6.0f)) == RoutingResult::Ok);
  MW_EXPECT_EQ(m.sourcesOn(kCutoff), 6);
  MW_EXPECT_EQ(m.maxSourcesPerDestination(), 6);

  const ModFrame frame = frameAt(1.0f);
  float before[kMaxDestinations];
  float after[kMaxDestinations];
  m.evaluate(frame, before);

  const RoutingResult seventh = m.add(route(6, kCutoff, 1.0f / 6.0f));
  MW_EXPECT(seventh == RoutingResult::DestinationFull);
  MW_EXPECT_EQ(m.sourcesOn(kCutoff), 6);
  MW_EXPECT_EQ(m.routingCount(), 6);
  MW_EXPECT(m.routingCount() < m.maxRoutings());
  m.evaluate(frame, after);
  MW_EXPECT(sameBits(before, after, m.destinations()));
  std::printf("    V-18: %d / %d on the destination with %d / %d routings; 7th refused with result %d\n",
              m.sourcesOn(kCutoff), m.maxSourcesPerDestination(), m.routingCount(), m.maxRoutings(),
              static_cast<int>(seventh));

  // The same source into another destination is fine — the limit is the
  // destination's — and freeing one contributor lets the seventh in.
  MW_EXPECT(m.add(route(6, kPitch, 0.25f)) == RoutingResult::Ok);
  MW_EXPECT(m.remove(0) == RoutingResult::Ok);
  MW_EXPECT(m.add(route(6, kCutoff, 1.0f / 6.0f)) == RoutingResult::Ok);
  MW_EXPECT_EQ(m.sourcesOn(kCutoff), 6);
}

MW_TEST("the amount law is linear and signed, and zero with either sign is off") {
  ModMatrix m = samplerMatrix();
  const float fs = 48.0f;
  MW_EXPECT(m.setDestination(kPitch, spec(fs, -48.0f, 48.0f)) == RoutingResult::Ok);
  int index = -1;
  MW_EXPECT(m.add(route(0, kPitch, 0.0f), &index) == RoutingResult::Ok);
  float sums[kMaxDestinations];
  const ModFrame unit = frameAt(1.0f);

  // Linear in the destination's unit: with the source at exactly 1 the sum is
  // `amount × fullScale` to the bit, and negating the amount negates the sum.
  for (int k = -4; k <= 4; ++k) {
    const float amount = static_cast<float>(k) * 0.25f;
    MW_EXPECT(m.setAmount(index, amount) == RoutingResult::Ok);
    m.evaluate(unit, sums);
    MW_EXPECT(sums[kPitch] == amount * fs);
  }
  // The law is in the product: half a source at full amount is full source at
  // half amount.
  MW_EXPECT(m.setAmount(index, 1.0f) == RoutingResult::Ok);
  m.evaluate(frameAt(0.5f), sums);
  const float halfSource = sums[kPitch];
  MW_EXPECT(m.setAmount(index, 0.5f) == RoutingResult::Ok);
  m.evaluate(unit, sums);
  MW_EXPECT(sums[kPitch] == halfSource);
  MW_EXPECT(halfSource == 24.0f);

  // Zero with either sign is off, and the two are one stored value.
  float positive[kMaxDestinations];
  float negative[kMaxDestinations];
  float none[kMaxDestinations];
  MW_EXPECT(m.setAmount(index, 0.0f) == RoutingResult::Ok);
  MW_EXPECT(!std::signbit(m.routing(index).amount));
  m.evaluate(unit, positive);
  MW_EXPECT(m.setAmount(index, -0.0f) == RoutingResult::Ok);
  MW_EXPECT(!std::signbit(m.routing(index).amount));
  m.evaluate(unit, negative);
  m.clear();
  m.evaluate(unit, none);
  MW_EXPECT(sameBits(positive, negative, m.destinations()));
  MW_EXPECT(sameBits(positive, none, m.destinations()));

  // The end stops are the end stops, and an add collapses the same way.
  MW_EXPECT(m.add(route(0, kPitch, -0.0f), &index) == RoutingResult::Ok);
  MW_EXPECT(!std::signbit(m.routing(index).amount));
  MW_EXPECT(m.setAmount(index, 1.5f) == RoutingResult::Ok);
  MW_EXPECT(m.routing(index).amount == 1.0f);
  MW_EXPECT(m.set(index, route(0, kPitch, -2.0f)) == RoutingResult::Ok);
  MW_EXPECT(m.routing(index).amount == -1.0f);
  std::printf("    amount law: +/-0.25 steps exact to the bit; half source == half amount == %.1f\n",
              static_cast<double>(halfSource));
}

MW_TEST("opposing modulations cancel before the clamp, and the clamp applies to the sum") {
  ModMatrix m = samplerMatrix();
  // A ±1 destination whose full-scale routing produces 2: a single routing
  // can overdrive it, which is the only way the order of clamp and sum shows.
  MW_EXPECT(m.setDestination(kCutoff, spec(2.0f, -1.0f, 1.0f)) == RoutingResult::Ok);
  float sums[kMaxDestinations];
  const ModFrame unit = frameAt(1.0f);

  int a = -1;
  int b = -1;
  MW_EXPECT(m.add(route(0, kCutoff, 1.0f), &a) == RoutingResult::Ok);
  MW_EXPECT(m.add(route(1, kCutoff, -0.75f), &b) == RoutingResult::Ok);
  m.evaluate(unit, sums);
  const float cancelled = sums[kCutoff];
  // +2.0 and −1.5 is +0.5. Clamped first it would be +1 − 1 = 0.
  MW_EXPECT(cancelled == 0.5f);

  MW_EXPECT(m.remove(b) == RoutingResult::Ok);
  m.evaluate(unit, sums);
  const float high = sums[kCutoff];
  MW_EXPECT(high == 1.0f);
  MW_EXPECT(m.setAmount(a, -1.0f) == RoutingResult::Ok);
  m.evaluate(unit, sums);
  const float low = sums[kCutoff];
  MW_EXPECT(low == -1.0f);
  // A destination nothing feeds reads zero, inside its own range.
  MW_EXPECT(m.setDestination(kPitch, spec(1.0f, 0.25f, 0.5f)) == RoutingResult::Ok);
  m.evaluate(unit, sums);
  MW_EXPECT(sums[kPitch] == 0.25f);
  std::printf("    summation: +2.0 − 1.5 = %+.2f; +2.0 alone clamps to %+.2f, −2.0 to %+.2f\n",
              static_cast<double>(cancelled), static_cast<double>(high), static_cast<double>(low));
}

MW_TEST("a quantised routing moves a pitch destination in whole semitones, per routing") {
  ModMatrix m = samplerMatrix();
  // One octave of pitch modulation in semitones, so the unit is a semitone
  // and the [U] grid — one native unit per step, the header's choice — is a
  // semitone grid.
  MW_EXPECT(m.setDestination(kPitch, spec(12.0f, -12.0f, 12.0f)) == RoutingResult::Ok);
  int index = -1;
  MW_EXPECT(m.add(route(0, kPitch, 1.0f, true), &index) == RoutingResult::Ok);

  const int frames = 2400;
  std::vector<float> stepped;
  std::vector<float> smooth;
  float sums[kMaxDestinations];
  float previous = 0.0f;
  int steps = 0;
  for (int t = 0; t <= frames; ++t) {
    ModFrame f;
    f.sources[0] = static_cast<float>(t) / static_cast<float>(frames);
    MW_EXPECT(m.setQuantise(index, true) == RoutingResult::Ok);
    m.evaluate(f, sums);
    const float v = sums[kPitch];
    // Every value is a whole semitone, and it moves by exactly one at a time.
    MW_EXPECT(v == std::round(v));
    if (t > 0) {
      const float d = v - previous;
      MW_EXPECT(d == 0.0f || d == 1.0f);
      if (d == 1.0f) ++steps;
    }
    previous = v;
    stepped.push_back(v);
    MW_EXPECT(m.setQuantise(index, false) == RoutingResult::Ok);
    m.evaluate(f, sums);
    smooth.push_back(sums[kPitch]);
  }
  auto distinct = [](std::vector<float> v) {
    std::sort(v.begin(), v.end());
    return static_cast<int>(std::unique(v.begin(), v.end()) - v.begin());
  };
  const int steppedValues = distinct(stepped);
  const int smoothValues = distinct(smooth);
  MW_EXPECT_EQ(steppedValues, 13);
  MW_EXPECT_EQ(steps, 12);
  MW_EXPECT(stepped.back() == 12.0f);
  MW_EXPECT(smoothValues > 1000);
  std::printf("    quantise: %d distinct values and %d unit steps over the ramp; continuous %d\n",
              steppedValues, steps, smoothValues);

  // Per routing, not per destination: two quantised routings of 0.4 semitone
  // each round to nothing. Rounding the sum would read 1.
  m.clear();
  MW_EXPECT(m.add(route(0, kPitch, 0.4f / 12.0f, true)) == RoutingResult::Ok);
  MW_EXPECT(m.add(route(1, kPitch, 0.4f / 12.0f, true)) == RoutingResult::Ok);
  m.evaluate(frameAt(1.0f), sums);
  MW_EXPECT(sums[kPitch] == 0.0f);
  // And the same pair unquantised is the 0.8 the rounding took away.
  MW_EXPECT(m.setQuantise(0, false) == RoutingResult::Ok);
  MW_EXPECT(m.setQuantise(1, false) == RoutingResult::Ok);
  m.evaluate(frameAt(1.0f), sums);
  MW_EXPECT_NEAR(sums[kPitch], 0.8, 1.0e-6);
}

MW_TEST("a destination that is a generator's own parameter is an index like any other") {
  ModMatrix m = samplerMatrix();
  // LFO 1's output into LFO 1's own rate, and the same routing into the
  // cutoff with the same spec: the matrix cannot tell them apart, which is
  // the point — nothing is special-cased, so nothing can be special-cased
  // wrongly.
  const DestinationSpec octaves = spec(4.0f, -4.0f, 4.0f);
  MW_EXPECT(m.setDestination(kLfo1Rate, octaves) == RoutingResult::Ok);
  MW_EXPECT(m.setDestination(kCutoff, octaves) == RoutingResult::Ok);
  MW_EXPECT(m.add(route(kSrcLfo1, kLfo1Rate, 0.5f)) == RoutingResult::Ok);
  MW_EXPECT(m.add(route(kSrcLfo1, kCutoff, 0.5f)) == RoutingResult::Ok);
  ModFrame f;
  f.sources[kSrcLfo1] = 0.25f;
  float sums[kMaxDestinations];
  m.evaluate(f, sums);
  MW_EXPECT(sums[kLfo1Rate] == 0.5f);
  MW_EXPECT(sameBits(&sums[kLfo1Rate], &sums[kCutoff], 1));
  int rows[kMaxRoutings];
  MW_EXPECT_EQ(m.uses(kSrcLfo1, rows, kMaxRoutings), 2);
  std::printf("    reflexive: LFO 1 -> LFO 1 rate = %+.3f, the same bits as LFO 1 -> cutoff\n",
              static_cast<double>(sums[kLfo1Rate]));
}

MW_TEST_MAIN("mod-matrix")
