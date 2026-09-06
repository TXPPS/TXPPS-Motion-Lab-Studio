// Motion Wave — the shared modulation matrix's own contract: what the model
// layer promises a display and an audio thread, beside what the sheets say it
// computes. The sheets' rows — V-18, the amount law, the summation rule, the
// quantise grid, the reflexive case — are `mod_matrix_tests.cpp`, and
// `mod_matrix_harness.h` is what the two share.
//
// The counts a display shows are read off the model ("17 / 20 routings, 4 / 6
// on this destination", `syn-05` §9.6) rather than kept beside it; no edit and
// no evaluation allocates, with the guard armed around `prepare` too, because
// the storage is fixed maxima and the claim is the stronger one; the guard is
// shown to be awake; two evaluations of one frame — and a trivially-copied
// matrix's — agree to the bit; a capacity beyond the storage maxima and a bad
// index are refused by name with the table untouched; and a removal keeps the
// survivors in order, releases its destination's count, and a move onto a
// full destination is refused where an add would be.
//
// Mutation-tested, each edit to `mod_matrix.h` restored before the next; the
// verdicts are the measured ones, and where a mutation also reaches the sheet
// suite that is said:
//   `add` returning Ok on a full matrix without storing (silent refusal)
//     → red: the allocation case, whose own `MatrixFull` assertion fired and
//     whose guard then counted the harness building the failure report —
//     that second count is the failure's, not the product's. Also the sheet
//     suite's 17th-routing case.
//   `add` never counting a destination's contributors → red: the
//     display-count case and the removal case; also the sheet suite's
//     7th-source and three-source cases.
//   `remove` never releasing its destination's count → red: the removal
//     case; also the sheet suite's 7th-source case.
//   `set` moving a routing onto a full destination without checking → red:
//     the removal case, with seven on a destination that allows six.
#include "mod_matrix_harness.h"
#include "rt_guard.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <type_traits>

using namespace mw;
using namespace mw::dsp::mod;
using namespace mw::test::modmatrix;
using mw::dsp::voice::ModFrame;

MW_TEST("the counts a display shows are read off the model: 17 / 20 routings, 4 / 6 on one destination") {
  // `syn-05` §9.6's readout, on that instrument's capacities — stated by the
  // consumer, as the sampler's are in the harness.
  MatrixConfig c;
  c.sources = 27;
  c.destinations = 47;
  c.maxRoutings = 20;
  c.maxSourcesPerDestination = 6;
  ModMatrix m;
  MW_EXPECT(m.prepare(c));
  MW_EXPECT_EQ(m.sources(), 27);
  MW_EXPECT_EQ(m.destinations(), 47);
  const int vcfFreq = 6;
  for (int s = 0; s < 4; ++s) MW_EXPECT(m.add(route(s, vcfFreq, 0.5f)) == RoutingResult::Ok);
  for (int i = 0; i < 13; ++i) MW_EXPECT(m.add(route(i, 10 + i, 0.5f)) == RoutingResult::Ok);
  MW_EXPECT_EQ(m.routingCount(), 17);
  MW_EXPECT_EQ(m.maxRoutings(), 20);
  MW_EXPECT_EQ(m.sourcesOn(vcfFreq), 4);
  MW_EXPECT_EQ(m.maxSourcesPerDestination(), 6);
  std::printf("    display: %d / %d routings, %d / %d on the destination\n", m.routingCount(),
              m.maxRoutings(), m.sourcesOn(vcfFreq), m.maxSourcesPerDestination());

  // The destination view lists the four in table order; the source view
  // finds source 2 in the filter routing and in its own row.
  int rows[kMaxRoutings];
  MW_EXPECT_EQ(m.contributors(vcfFreq, rows, kMaxRoutings), 4);
  for (int i = 0; i < 4; ++i) MW_EXPECT_EQ(rows[i], i);
  MW_EXPECT_EQ(m.uses(2, rows, kMaxRoutings), 2);
  MW_EXPECT_EQ(rows[0], 2);
  MW_EXPECT_EQ(rows[1], 6);
  MW_EXPECT_EQ(m.routing(6).destination, 12);
  // A caller's short list is filled to its capacity and no further.
  MW_EXPECT_EQ(m.contributors(vcfFreq, rows, 2), 2);
}

MW_TEST("no edit and no evaluation allocates") {
  // The guard is armed around everything, `prepare` included: the storage is
  // fixed maxima, so the claim is stronger than the substrate's "not after
  // prepare" and the test says so by arming earlier than the others do.
  ModMatrix m;
  float sums[kMaxDestinations];
  float peak = 0.0f;
  {
    test::RtGuard guard;
    MW_EXPECT(m.prepare(samplerConfig()));
    for (int d = 0; d < 34; ++d) {
      MW_EXPECT(m.setDestination(d, spec(2.0f, -1.0f, 1.0f)) == RoutingResult::Ok);
    }
    for (int i = 0; i < 16; ++i) MW_EXPECT(m.add(route(i, i % 34, 0.5f, (i & 1) != 0)) == RoutingResult::Ok);
    MW_EXPECT(m.add(route(0, 0, 0.5f)) == RoutingResult::MatrixFull);
    MW_EXPECT(m.set(3, route(5, 7, -0.25f)) == RoutingResult::Ok);
    MW_EXPECT(m.setAmount(4, 0.75f) == RoutingResult::Ok);
    MW_EXPECT(m.setQuantise(5, true) == RoutingResult::Ok);
    MW_EXPECT(m.remove(2) == RoutingResult::Ok);
    MW_EXPECT(m.add(route(20, 30, 1.0f)) == RoutingResult::Ok);
    int rows[kMaxRoutings];
    MW_EXPECT_EQ(m.contributors(7, rows, kMaxRoutings), 2);
    // A thousand grid points with every source moving — the branch on the
    // quantise flag is taken and not taken in the same run.
    for (int t = 0; t < 1000; ++t) {
      ModFrame f;
      for (int s = 0; s < kMaxSources; ++s) {
        f.sources[s] = std::sin(static_cast<float>(t * (s + 1)) * 0.01f);
      }
      m.evaluate(f, sums);
      for (int d = 0; d < m.destinations(); ++d) peak = std::max(peak, std::fabs(sums[d]));
    }
    MW_EXPECT_EQ(static_cast<long long>(guard.allocations()), 0LL);
  }
  // A matrix that computed nothing would allocate nothing either.
  MW_EXPECT(peak > 0.1f);
  std::printf("    rt: prepare, 34 specs, 19 edits and 1000 evaluations with no allocation; peak %.3f\n",
              static_cast<double>(peak));
}

MW_TEST("the allocation guard is awake, or the case above proves nothing") {
  // `param_tests.cpp`'s mutation of the guard, repeated here so this binary
  // carries its own proof: a guard nobody has seen fire is decoration.
  {
    test::RtGuard guard;
    volatile float* leak = new float[16];
    const std::size_t seen = guard.allocations();
    delete[] leak;
    MW_EXPECT(seen >= 1);
  }
  {
    test::RtGuard guard;
    MW_EXPECT_EQ(static_cast<long long>(guard.allocations()), 0LL);
  }
}

MW_TEST("two evaluations of one frame are bit-identical, and so is a copy's") {
  static_assert(std::is_trivially_copyable<ModMatrix>::value,
                "a routing table reaches the audio thread as one block copy");
  ModMatrix m = samplerMatrix();
  for (int d = 0; d < 34; ++d) {
    MW_EXPECT(m.setDestination(d, spec(3.0f + static_cast<float>(d), -10.0f, 10.0f)) == RoutingResult::Ok);
  }
  // Six on one destination, in an order that makes the float sum
  // order-sensitive, and quantise on some of them.
  for (int i = 0; i < 16; ++i) {
    const float amount = (i % 2 == 0 ? 1.0f : -1.0f) * (0.1f + 0.05f * static_cast<float>(i));
    MW_EXPECT(m.add(route(i, i < 6 ? kCutoff : i, amount, i % 3 == 0)) == RoutingResult::Ok);
  }
  ModFrame f;
  for (int s = 0; s < kMaxSources; ++s) f.sources[s] = 0.37f * static_cast<float>(s % 7) - 0.9f;
  float first[kMaxDestinations];
  float second[kMaxDestinations];
  float copied[kMaxDestinations];
  m.evaluate(f, first);
  m.evaluate(f, second);
  const ModMatrix copy = m;
  copy.evaluate(f, copied);
  MW_EXPECT(sameBits(first, second, m.destinations()));
  MW_EXPECT(sameBits(first, copied, m.destinations()));
  // Not a comparison between two silences.
  float peak = 0.0f;
  for (int d = 0; d < m.destinations(); ++d) peak = std::max(peak, std::fabs(first[d]));
  MW_EXPECT(peak > 0.5f);
  std::printf("    determinism: two passes and a copy agree to the bit; peak %.4f\n",
              static_cast<double>(peak));
}

MW_TEST("prepare refuses capacities beyond the storage maxima, and bad indices are named") {
  ModMatrix m;
  MatrixConfig c = samplerConfig();
  c.maxRoutings = kMaxRoutings + 1;
  MW_EXPECT(!m.prepare(c));
  MW_EXPECT(!m.prepared());
  c = samplerConfig();
  c.destinations = kMaxDestinations + 1;
  MW_EXPECT(!m.prepare(c));
  c = samplerConfig();
  c.sources = kMaxSources + 1;
  MW_EXPECT(!m.prepare(c));
  c = samplerConfig();
  c.sources = 0;
  MW_EXPECT(!m.prepare(c));
  // Unprepared, every mutator says so and an evaluation touches nothing.
  MW_EXPECT(m.add(route(0, 0, 1.0f)) == RoutingResult::NotPrepared);
  MW_EXPECT(m.setDestination(0, spec(1.0f, -1.0f, 1.0f)) == RoutingResult::NotPrepared);
  float sums[kMaxDestinations];
  for (float& v : sums) v = -7.0f;
  m.evaluate(frameAt(1.0f), sums);
  for (float v : sums) MW_EXPECT(v == -7.0f);

  MW_EXPECT(m.prepare(samplerConfig()));
  MW_EXPECT(m.add(route(24, 0, 1.0f)) == RoutingResult::BadSource);
  MW_EXPECT(m.add(route(-1, 0, 1.0f)) == RoutingResult::BadSource);
  MW_EXPECT(m.add(route(0, 34, 1.0f)) == RoutingResult::BadDestination);
  MW_EXPECT(m.setDestination(34, spec(1.0f, -1.0f, 1.0f)) == RoutingResult::BadDestination);
  MW_EXPECT(m.add(route(0, 0, std::nanf(""))) == RoutingResult::BadAmount);
  MW_EXPECT(m.remove(0) == RoutingResult::BadRouting);
  MW_EXPECT(m.setAmount(0, 0.5f) == RoutingResult::BadRouting);
  MW_EXPECT(m.setQuantise(0, true) == RoutingResult::BadRouting);
  MW_EXPECT(m.set(0, route(0, 0, 0.5f)) == RoutingResult::BadRouting);
  MW_EXPECT_EQ(m.routingCount(), 0);
  int index = -1;
  MW_EXPECT(m.add(route(0, 0, 0.5f), &index) == RoutingResult::Ok);
  MW_EXPECT(m.setAmount(index, std::nanf("")) == RoutingResult::BadAmount);
  MW_EXPECT(m.routing(index).amount == 0.5f);
  MW_EXPECT(m.set(index, route(0, 0, std::nanf(""))) == RoutingResult::BadAmount);
  MW_EXPECT(m.routing(index).amount == 0.5f);
}

MW_TEST("a removal keeps the survivors in order and frees the destination; a move onto a full one is refused") {
  ModMatrix m = samplerMatrix();
  MW_EXPECT(m.add(route(1, 0, 0.1f)) == RoutingResult::Ok);
  MW_EXPECT(m.add(route(2, 1, 0.2f)) == RoutingResult::Ok);
  MW_EXPECT(m.add(route(3, 2, 0.3f)) == RoutingResult::Ok);
  MW_EXPECT(m.remove(1) == RoutingResult::Ok);
  MW_EXPECT_EQ(m.routingCount(), 2);
  MW_EXPECT_EQ(m.routing(0).source, 1);
  MW_EXPECT_EQ(m.routing(1).source, 3);
  MW_EXPECT_EQ(m.sourcesOn(1), 0);
  MW_EXPECT_EQ(m.sourcesOn(2), 1);

  for (int s = 0; s < 6; ++s) MW_EXPECT(m.add(route(s, 5, 0.5f)) == RoutingResult::Ok);
  MW_EXPECT_EQ(m.sourcesOn(5), 6);
  // Onto a full destination: refused, and the routing has not moved.
  MW_EXPECT(m.set(0, route(1, 5, 0.1f)) == RoutingResult::DestinationFull);
  MW_EXPECT_EQ(m.routing(0).destination, 0);
  MW_EXPECT_EQ(m.sourcesOn(0), 1);
  MW_EXPECT_EQ(m.sourcesOn(5), 6);
  // Within its own destination: no room needed, count unchanged.
  MW_EXPECT(m.set(0, route(9, 0, 0.1f)) == RoutingResult::Ok);
  MW_EXPECT_EQ(m.routing(0).source, 9);
  MW_EXPECT_EQ(m.sourcesOn(0), 1);
  // Onto one with room: both counts move.
  MW_EXPECT(m.set(0, route(9, 1, 0.1f)) == RoutingResult::Ok);
  MW_EXPECT_EQ(m.sourcesOn(0), 0);
  MW_EXPECT_EQ(m.sourcesOn(1), 1);
  // `clear` empties the table and every count, and keeps the specs.
  MW_EXPECT(m.setDestination(1, spec(5.0f, -5.0f, 5.0f)) == RoutingResult::Ok);
  m.clear();
  MW_EXPECT_EQ(m.routingCount(), 0);
  MW_EXPECT_EQ(m.sourcesOn(5), 0);
  MW_EXPECT(m.destinationSpec(1).fullScale == 5.0f);
}

MW_TEST_MAIN("mod-matrix-model")
