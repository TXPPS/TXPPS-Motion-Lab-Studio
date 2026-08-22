// Motion Wave — the graph, rendering real samples.
//
// `topology_tests` proves the compensation numbers are right. This proves the
// graph applies them: an impulse sent down two paths of different latency has
// to come out of the mix as one impulse, not two.
#include "../graph/engine_graph.h"
#include "harness.h"
#include "rt_guard.h"

#include <memory>

using namespace mw;

namespace {

/// Emits a single 1.0 at frame `at` of the first block, then silence. The
/// simplest signal whose alignment is unambiguous when you look at the output.
class ImpulseSource : public Node {
 public:
  explicit ImpulseSource(int at) : at_(at) {}
  void prepare(double, int) override { emitted_ = 0; }
  void process(const ProcessContext& ctx) override {
    for (int p = 0; p < ctx.outputCount; ++p) ctx.outputs[p].clear();
    for (int i = 0; i < ctx.frames; ++i) {
      if (emitted_ + i == at_) {
        for (int c = 0; c < ctx.outputs[0].channelCount(); ++c) ctx.outputs[0].channel(c)[i] = 1.0f;
      }
    }
    emitted_ += ctx.frames;
  }
  int inputCount() const override { return 0; }
  const char* name() const override { return "impulse"; }

 private:
  int at_;
  int emitted_ = 0;
};

/// Multiplies by a constant. Enough to tell two paths apart in a sum.
class GainNode : public Node {
 public:
  explicit GainNode(float gain) : gain_(gain) {}
  void process(const ProcessContext& ctx) override {
    ctx.outputs[0].clear();
    if (ctx.inputCount > 0) ctx.outputs[0].addFrom(ctx.inputs[0], gain_);
  }
  const char* name() const override { return "gain"; }

 private:
  float gain_;
};

/// Renders `blocks` buffers and returns the whole output of one node.
std::vector<float> render(EngineGraph& graph, NodeId tap, int frames, int blocks) {
  std::vector<float> out;
  out.reserve(static_cast<std::size_t>(frames * blocks));
  for (int b = 0; b < blocks; ++b) {
    graph.process(frames, 0.0, true);
    const AudioBuffer buffer = graph.output(tap, frames);
    const float* ch = buffer.channel(0);
    for (int i = 0; i < frames; ++i) out.push_back(ch[i]);
  }
  return out;
}

/// Index of the first sample above a threshold, or -1.
int firstNonZero(const std::vector<float>& v, float threshold = 1e-6f) {
  for (std::size_t i = 0; i < v.size(); ++i) {
    if (std::fabs(v[i]) > threshold) return static_cast<int>(i);
  }
  return -1;
}

int countNonZero(const std::vector<float>& v, float threshold = 1e-6f) {
  int n = 0;
  for (const float s : v) {
    if (std::fabs(s) > threshold) ++n;
  }
  return n;
}

}  // namespace

MW_TEST("a chain passes an impulse through unchanged") {
  EngineGraph graph;
  const NodeId src = graph.addNode(std::make_unique<ImpulseSource>(5));
  const NodeId pass = graph.addNode(std::make_unique<PassThroughNode>());
  graph.connect(src, pass);
  MW_EXPECT(graph.prepare(48000.0, 64, 1));

  const std::vector<float> out = render(graph, pass, 64, 4);
  MW_EXPECT_EQ(firstNonZero(out), 5);
  MW_EXPECT_EQ(countNonZero(out), 1);
  MW_EXPECT_NEAR(out[5], 1.0, 1e-6);
}

MW_TEST("a declared latency delays the signal by exactly that many samples") {
  EngineGraph graph;
  const NodeId src = graph.addNode(std::make_unique<ImpulseSource>(0));
  const NodeId late = graph.addNode(std::make_unique<LatentNode>(37));
  graph.connect(src, late);
  MW_EXPECT(graph.prepare(48000.0, 64, 1));

  const std::vector<float> out = render(graph, late, 64, 4);
  MW_EXPECT_EQ(firstNonZero(out), 37);
  MW_EXPECT_EQ(countNonZero(out), 1);
  MW_EXPECT_EQ(graph.latencySamples(), 37);
}

MW_TEST("two paths of different latency arrive as one impulse, not two") {
  // The whole point of compensation, measured on samples rather than on the
  // plan. Uncompensated this produces two impulses 100 samples apart, which is
  // a flam nobody would call a bug — just a mix that will not tighten up.
  EngineGraph graph;
  const NodeId src = graph.addNode(std::make_unique<ImpulseSource>(3));
  const NodeId slow = graph.addNode(std::make_unique<LatentNode>(100));
  const NodeId fast = graph.addNode(std::make_unique<GainNode>(1.0f));
  const NodeId mix = graph.addNode(std::make_unique<PassThroughNode>());
  graph.connect(src, slow);
  graph.connect(src, fast);
  graph.connect(slow, mix);
  graph.connect(fast, mix);
  MW_EXPECT(graph.prepare(48000.0, 64, 1));

  const std::vector<float> out = render(graph, mix, 64, 8);
  MW_EXPECT_EQ(countNonZero(out), 1);
  MW_EXPECT_EQ(firstNonZero(out), 3 + 100);
  // Both paths landed on the same sample, so the sum is two.
  MW_EXPECT_NEAR(out[103], 2.0, 1e-6);
  MW_EXPECT_EQ(graph.latencySamples(), 100);
}

MW_TEST("a send rejoining its dry path stays in phase") {
  //  src --> dry -----------------> bus
  //   +----> fx (latency 64) ------^
  // The case that produces comb filtering when it is wrong: two copies of the
  // same signal, offset. If compensation failed, the sum would cancel at every
  // frequency whose period divides the offset.
  EngineGraph graph;
  const NodeId src = graph.addNode(std::make_unique<ImpulseSource>(0));
  const NodeId dry = graph.addNode(std::make_unique<GainNode>(0.5f));
  const NodeId fx = graph.addNode(std::make_unique<LatentNode>(64));
  const NodeId bus = graph.addNode(std::make_unique<PassThroughNode>());
  graph.connect(src, dry);
  graph.connect(src, fx);
  graph.connect(dry, bus);
  graph.connect(fx, bus);
  MW_EXPECT(graph.prepare(48000.0, 128, 1));

  const std::vector<float> out = render(graph, bus, 128, 4);
  MW_EXPECT_EQ(countNonZero(out), 1);
  MW_EXPECT_EQ(firstNonZero(out), 64);
  MW_EXPECT_NEAR(out[64], 1.5, 1e-6);  // 0.5 dry + 1.0 wet, aligned
}

MW_TEST("a key input arrives with the signal it is keying") {
  // The detector on port 1 must see the same sample the processor sees on
  // port 0. A key 256 samples early makes a compressor duck before the note.
  class PortProbe : public Node {
   public:
    void process(const ProcessContext& ctx) override {
      ctx.outputs[0].clear();
      // Emit the *product* of the two ports, which is non-zero only where both
      // impulses land on the same sample.
      if (ctx.inputCount >= 2) {
        const float* a = ctx.inputs[0].channel(0);
        const float* b = ctx.inputs[1].channel(0);
        float* out = ctx.outputs[0].channel(0);
        for (int i = 0; i < ctx.frames; ++i) out[i] = a[i] * b[i];
      }
    }
    int inputCount() const override { return 2; }
    const char* name() const override { return "probe"; }
  };

  EngineGraph graph;
  const NodeId src = graph.addNode(std::make_unique<ImpulseSource>(10));
  const NodeId shaped = graph.addNode(std::make_unique<LatentNode>(256));
  const NodeId probe = graph.addNode(std::make_unique<PortProbe>());
  graph.connect(src, shaped);
  graph.connect(shaped, probe, 0);
  graph.connect(src, probe, 1);
  MW_EXPECT(graph.prepare(48000.0, 128, 1));

  const std::vector<float> out = render(graph, probe, 128, 8);
  MW_EXPECT_EQ(countNonZero(out), 1);
  MW_EXPECT_EQ(firstNonZero(out), 10 + 256);
}

MW_TEST("rendering a graph allocates nothing") {
  EngineGraph graph;
  const NodeId src = graph.addNode(std::make_unique<ImpulseSource>(1));
  const NodeId a = graph.addNode(std::make_unique<LatentNode>(48));
  const NodeId b = graph.addNode(std::make_unique<GainNode>(0.25f));
  const NodeId mix = graph.addNode(std::make_unique<PassThroughNode>());
  graph.connect(src, a);
  graph.connect(src, b);
  graph.connect(a, mix);
  graph.connect(b, mix);
  MW_EXPECT(graph.prepare(48000.0, 256, 2));

  {
    ::mw::test::RtGuard guard;
    for (int i = 0; i < 100; ++i) graph.process(256, 0.0, true);
    MW_EXPECT_EQ(static_cast<long long>(guard.allocations()), 0);
  }
}

MW_TEST("a graph with a cycle refuses to prepare rather than rendering nonsense") {
  EngineGraph graph;
  const NodeId a = graph.addNode(std::make_unique<PassThroughNode>());
  const NodeId b = graph.addNode(std::make_unique<PassThroughNode>());
  graph.connect(a, b);
  graph.connect(b, a);
  MW_EXPECT(!graph.prepare(48000.0, 64, 1));
}

MW_TEST("a block shorter than the maximum renders the same samples") {
  // A device callback does not promise a full buffer every time. Rendering the
  // same impulse in 16-frame blocks must put it in the same place as 64.
  auto build = [](int frames) {
    EngineGraph graph;
    const NodeId src = graph.addNode(std::make_unique<ImpulseSource>(70));
    const NodeId late = graph.addNode(std::make_unique<LatentNode>(33));
    graph.connect(src, late);
    graph.prepare(48000.0, 64, 1);
    return render(graph, late, frames, 256 / frames);
  };
  const std::vector<float> big = build(64);
  const std::vector<float> small = build(16);
  MW_EXPECT_EQ(firstNonZero(big), 103);
  MW_EXPECT_EQ(firstNonZero(small), 103);
}

MW_TEST_MAIN("graph")
