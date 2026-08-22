// Motion Wave — graph order and delay compensation, tested.
//
// Compensation is the thing a mixer gets wrong quietly. Every case here is a
// topology where an uncompensated graph would still produce audio, just audio
// that is a few milliseconds out of alignment — which nobody hears as a bug,
// only as a mix that will not tighten up.
#include "../graph/topology.h"
#include "harness.h"

using namespace mw;

MW_TEST("a chain processes in order and its latency is the sum") {
  //  0 -> 1 -> 2
  Topology t(3);
  t.connect(0, 1);
  t.connect(1, 2);
  t.setLatency(0, 10);
  t.setLatency(1, 20);
  t.setLatency(2, 5);

  const std::vector<NodeId> order = t.processOrder();
  MW_EXPECT_EQ(static_cast<long long>(order.size()), 3);
  MW_EXPECT_EQ(static_cast<long long>(order[0]), 0);
  MW_EXPECT_EQ(static_cast<long long>(order[2]), 2);

  const LatencyPlan plan = t.plan();
  MW_EXPECT(plan.ordered);
  MW_EXPECT_EQ(plan.arrival[2], 30);
  MW_EXPECT_EQ(plan.outputLatency, 35);
  // Nothing to compensate: a chain has one path.
  MW_EXPECT_EQ(Topology::insertedSamples(plan), 0);
}

MW_TEST("two paths into a mix are aligned to the later one") {
  //  0 (latency 128) --+
  //                     +-> 2
  //  1 (latency 0)   ---+
  // The classic case: a linear-phase EQ on one source and nothing on the
  // other. Uncompensated, source 1 arrives 128 samples early and the mix is
  // smeared rather than obviously broken.
  Topology t(3);
  t.connect(0, 2);
  t.connect(1, 2);
  t.setLatency(0, 128);
  t.setLatency(1, 0);

  const LatencyPlan plan = t.plan();
  MW_EXPECT_EQ(plan.arrival[2], 128);
  MW_EXPECT_EQ(plan.compensation[0], 0);    // the late path needs nothing
  MW_EXPECT_EQ(plan.compensation[1], 128);  // the early path waits for it
  MW_EXPECT_EQ(plan.outputLatency, 128);
}

MW_TEST("a send path is compensated against the dry path it rejoins") {
  //  src --> dry ---------------> bus
  //   +--> fx (latency 512) ----^
  Topology t(4);
  const NodeId src = 0, dry = 1, fx = 2, bus = 3;
  t.connect(src, dry);
  t.connect(src, fx);
  t.connect(dry, bus);
  t.connect(fx, bus);
  t.setLatency(fx, 512);

  const LatencyPlan plan = t.plan();
  MW_EXPECT_EQ(plan.arrival[bus], 512);
  // Edge 2 is dry->bus and edge 3 is fx->bus, in the order they were added.
  MW_EXPECT_EQ(plan.compensation[2], 512);
  MW_EXPECT_EQ(plan.compensation[3], 0);
  MW_EXPECT_EQ(plan.outputLatency, 512);
}

MW_TEST("compensation accumulates through a chain rather than being reset") {
  //  0 -> 1(64) -> 3
  //  2(0) --------> 3      and then 3 -> 4(32)
  Topology t(5);
  t.connect(0, 1);
  t.connect(1, 3);
  t.connect(2, 3);
  t.connect(3, 4);
  t.setLatency(1, 64);
  t.setLatency(4, 32);

  const LatencyPlan plan = t.plan();
  MW_EXPECT_EQ(plan.arrival[3], 64);
  MW_EXPECT_EQ(plan.compensation[2], 64);  // the 2->3 edge waits for the 64
  MW_EXPECT_EQ(plan.arrival[4], 64);
  MW_EXPECT_EQ(plan.outputLatency, 96);
}

MW_TEST("a key input is compensated like any other, so the detector stays in time") {
  //  key(0) -------------------> comp.port1
  //  main --> shaper(256) -----> comp.port0
  // A sidechain whose key arrives 256 samples ahead of the signal it is
  // ducking pumps early. It is a second port, not a second graph, and the plan
  // treats it the same.
  Topology t(4);
  const NodeId key = 0, main = 1, shaper = 2, comp = 3;
  t.connect(main, shaper);
  t.connect(shaper, comp, /*toPort=*/0);
  t.connect(key, comp, /*toPort=*/1);
  t.setLatency(shaper, 256);

  const LatencyPlan plan = t.plan();
  MW_EXPECT_EQ(plan.arrival[comp], 256);
  MW_EXPECT_EQ(plan.compensation[1], 0);    // shaper -> comp
  MW_EXPECT_EQ(plan.compensation[2], 256);  // key -> comp
}

MW_TEST("a diamond aligns at the join and not before") {
  //  0 --+--> 1(100) --+
  //      |             +--> 3
  //      +--> 2(20) ---+
  Topology t(4);
  t.connect(0, 1);
  t.connect(0, 2);
  t.connect(1, 3);
  t.connect(2, 3);
  t.setLatency(1, 100);
  t.setLatency(2, 20);

  const LatencyPlan plan = t.plan();
  MW_EXPECT_EQ(plan.arrival[1], 0);
  MW_EXPECT_EQ(plan.arrival[2], 0);
  MW_EXPECT_EQ(plan.arrival[3], 100);
  MW_EXPECT_EQ(plan.compensation[2], 0);   // 1 -> 3, already the latest
  MW_EXPECT_EQ(plan.compensation[3], 80);  // 2 -> 3 makes up the difference
  MW_EXPECT_EQ(Topology::insertedSamples(plan), 80);
}

MW_TEST("the graph reports the deepest output, not the longest chain") {
  //  0(1000) -> 1        an unrelated tail: 2(10) with nothing after it
  Topology t(3);
  t.connect(0, 1);
  t.setLatency(0, 1000);
  t.setLatency(2, 10);
  const LatencyPlan plan = t.plan();
  // Both 1 and 2 are unconsumed. The host must be told the worst of them.
  MW_EXPECT_EQ(plan.outputLatency, 1000);
}

MW_TEST("no compensation is ever negative") {
  Topology t(4);
  t.connect(0, 3);
  t.connect(1, 3);
  t.connect(2, 3);
  t.setLatency(0, 7);
  t.setLatency(1, 913);
  t.setLatency(2, 64);
  const LatencyPlan plan = t.plan();
  for (const int c : plan.compensation) MW_EXPECT(c >= 0);
  MW_EXPECT_EQ(plan.arrival[3], 913);
}

MW_TEST("a cycle is reported rather than looping forever") {
  Topology t(3);
  t.connect(0, 1);
  t.connect(1, 2);
  t.connect(2, 0);
  MW_EXPECT(t.processOrder().empty());
  const LatencyPlan plan = t.plan();
  MW_EXPECT(!plan.ordered);
}

MW_TEST("the order is deterministic, so two runs render the same samples") {
  // A graph whose processing order depends on iteration order produces a
  // different render between runs, and a golden-render regression would flag
  // it as drift when it is really nondeterminism.
  Topology t(6);
  t.connect(4, 5);
  t.connect(0, 5);
  t.connect(2, 5);
  const std::vector<NodeId> a = t.processOrder();
  const std::vector<NodeId> b = t.processOrder();
  MW_EXPECT(a == b);
  MW_EXPECT_EQ(static_cast<long long>(a.front()), 0);
}

MW_TEST("a graph with no edges still orders and reports zero latency") {
  Topology t(3);
  t.setLatency(1, 44);
  const LatencyPlan plan = t.plan();
  MW_EXPECT(plan.ordered);
  MW_EXPECT_EQ(plan.outputLatency, 44);
  MW_EXPECT_EQ(Topology::insertedSamples(plan), 0);
}

MW_TEST("an empty graph is not an error") {
  Topology t(0);
  const LatencyPlan plan = t.plan();
  MW_EXPECT(plan.ordered);
  MW_EXPECT_EQ(plan.outputLatency, 0);
}

MW_TEST_MAIN("topology")
