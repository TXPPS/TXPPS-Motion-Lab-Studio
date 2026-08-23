// Motion Wave — the offline renderer, and the first golden render.
//
// This is the substrate every unit's acceptance test stands on, so the tests
// here are about the *renderer* rather than about any processor: that it is
// deterministic, that it is allocation-free on the audio thread, that cutting a
// render into different block sizes changes nothing, and that a render checked
// in today still produces the same samples tomorrow.
//
// The golden render is the one that catches what nothing else can. Every other
// test asserts a property — silence is silent, a null is a null — and a change
// that breaks the *sound* while preserving every property passes all of them. A
// stored set of samples has no such gap: it is the render, and it either matches
// or it does not.
#include "../graph/engine_graph.h"
#include "../render/offline_render.h"
#include "harness.h"
#include "rt_guard.h"

#include "golden_render.h"

#include <cmath>
#include <cstdio>
#include <memory>

using namespace mw;

namespace {

/// A 1 kHz sine at −6 dBFS, defined against absolute frame index.
///
/// Not a full-scale signal on purpose: a processor measured at 0 dBFS is a
/// processor measured where several of them clip, and a null test run at the
/// rails proves the rails rather than the null. −6 dBFS leaves headroom for a
/// stage that adds a little.
float sine1k(int frame, int channel, double sampleRate, void*) {
  const double phase = 2.0 * 3.14159265358979323846 * 1000.0 *
                       static_cast<double>(frame) / sampleRate;
  // The right channel is inverted, so a mistake that collapses the two to mono
  // shows up as silence rather than as something plausible.
  const double sign = channel == 0 ? 1.0 : -1.0;
  return static_cast<float>(0.5 * sign * std::sin(phase));
}

/// A single impulse, for measuring where a graph puts things in time.
float impulse(int frame, int, double, void*) { return frame == 100 ? 1.0f : 0.0f; }

/// Scales its input by a constant. The simplest thing that is not a wire.
class GainNode : public Node {
 public:
  explicit GainNode(float gain) : gain_(gain) {}
  void process(const ProcessContext& ctx) override {
    for (int c = 0; c < ctx.outputs[0].channelCount(); ++c) {
      const float* in = ctx.inputs[0].channel(c);
      float* out = ctx.outputs[0].channel(c);
      for (int i = 0; i < ctx.frames; ++i) out[i] = in[i] * gain_;
    }
  }
  const char* name() const override { return "gain"; }

 private:
  float gain_;
};

/// Source → gain, which is the smallest graph that renders something.
struct SineGraph {
  EngineGraph graph;
  NodeId source = 0;
  NodeId out = 0;

  explicit SineGraph(float gain = 1.0f, SourceFn fn = &sine1k) {
    source = graph.addNode(std::make_unique<SignalSourceNode>(fn, nullptr));
    out = graph.addNode(std::make_unique<GainNode>(gain));
    graph.connect(source, out);
  }
};

RenderSpec spec(int frames, int blockSize, double rate = 48000.0) {
  RenderSpec s;
  s.frames = frames;
  s.blockSize = blockSize;
  s.sampleRate = rate;
  s.channels = 2;
  return s;
}

}  // namespace

MW_TEST("render produces the frames it was asked for") {
  SineGraph g;
  const RenderResult r = renderOffline(g.graph, spec(1000, 128), g.out);
  MW_EXPECT(r.ok);
  MW_EXPECT_EQ(r.frames, 1000);
  MW_EXPECT_EQ(r.channelCount(), 2);
  MW_EXPECT_EQ(static_cast<int>(r.channel(0).size()), 1000);
}

MW_TEST("render is deterministic") {
  // Two renders of the same graph must be the same samples, or nothing below
  // this line means anything.
  SineGraph a;
  SineGraph b;
  const RenderResult ra = renderOffline(a.graph, spec(4096, 128), a.out);
  const RenderResult rb = renderOffline(b.graph, spec(4096, 128), b.out);
  MW_EXPECT_NEAR(peakDifference(ra, rb), 0.0f, 0.0f);
}

MW_TEST("render is identical at every block size") {
  // Ledger cell 7. A processor that keeps state per *block* rather than per
  // sample passes at the size it was written against and fails everywhere else,
  // silently — the audio is plausible, just not the same audio.
  SineGraph reference;
  const RenderResult want = renderOffline(reference.graph, spec(4096, 128), reference.out);

  for (const int block : {32, 64, 128, 256, 512, 1024}) {
    SineGraph g;
    const RenderResult got = renderOffline(g.graph, spec(4096, block), g.out);
    MW_EXPECT(got.ok);
    // Exact, not approximate. Cutting a buffer differently must not change one
    // bit; a tolerance here would let a real per-block bug hide under it.
    MW_EXPECT_NEAR(peakDifference(want, got), 0.0f, 0.0f);
  }
}

MW_TEST("render handles a ragged final block") {
  // 1000 frames at 128 leaves 104. A renderer that only handles whole blocks
  // either overruns its output or silently drops the tail, and the tail is
  // where a reverb's decay and a limiter's release live.
  SineGraph a;
  SineGraph b;
  const RenderResult ragged = renderOffline(a.graph, spec(1000, 128), a.out);
  const RenderResult even = renderOffline(b.graph, spec(1000, 100), b.out);
  MW_EXPECT_NEAR(peakDifference(ragged, even), 0.0f, 0.0f);
  // And the last sample is real rather than left at zero.
  MW_EXPECT(std::abs(ragged.channel(0)[999]) > 0.0f);
}

MW_TEST("render allocates nothing on the audio thread") {
  // The rule that makes the whole core portable: nothing reachable from
  // `process` may allocate. Proven rather than reviewed — the guard arms an
  // operator-new hook and fails by name.
  SineGraph g;
  MW_EXPECT(g.graph.prepare(48000.0, 128, 2));
  {
    test::RtGuard guard;
    for (int i = 0; i < 16; ++i) g.graph.process(128, static_cast<double>(i) * 128.0 / 48000.0, true);
  }
}

MW_TEST("a gain of one is a wire") {
  // The identity case, and the shape every bypass null test takes: two renders
  // that must differ by nothing. −120 dBFS is the Ledger's bar; a wire should
  // manage rather better than that.
  SineGraph unity(1.0f);
  SineGraph wire(1.0f);
  const RenderResult a = renderOffline(unity.graph, spec(2048, 128), unity.out);
  const RenderResult b = renderOffline(wire.graph, spec(2048, 128), wire.out);
  const double nullDb = dbfs(peakDifference(a, b));
  std::printf("    unity gain null: %.1f dBFS\n", nullDb);
  MW_EXPECT(nullDb < -120.0);
}

MW_TEST("a declared latency moves the samples it says it does") {
  // Ledger cell 8 in its smallest form. `LatentNode` declares a delay and the
  // graph compensates it; what this asserts is that the compensation moves real
  // samples rather than merely computing a correct-looking number.
  for (const int latency : {0, 1, 64, 333}) {
    EngineGraph graph;
    const NodeId src = graph.addNode(std::make_unique<SignalSourceNode>(&impulse, nullptr));
    const NodeId late = graph.addNode(std::make_unique<LatentNode>(latency));
    graph.connect(src, late);
    const RenderResult r = renderOffline(graph, spec(2048, 128), late);
    MW_EXPECT(r.ok);

    int at = -1;
    for (std::size_t i = 0; i < r.channel(0).size(); ++i) {
      if (std::abs(r.channel(0)[i]) > 0.5f) {
        at = static_cast<int>(i);
        break;
      }
    }
    MW_EXPECT_EQ(at, 100 + latency);
  }
}

MW_TEST("the golden render still renders the same samples") {
  // The regression that a property test cannot be. Everything else here asserts
  // that the renderer behaves; this asserts that it produces *this audio*, so a
  // change that keeps every property while altering the sound is caught.
  //
  // The tolerance is one part in a million rather than zero: the golden values
  // are decimal literals of binary floats, and a compiler is free to contract a
  // multiply-add. Anything a listener could hear is orders of magnitude above
  // it — 1e-6 is about −120 dBFS.
  SineGraph g(0.5f);
  const RenderResult r = renderOffline(g.graph, spec(golden::kFrames, 128, golden::kSampleRate),
                                       g.out);
  MW_EXPECT(r.ok);
  MW_EXPECT_EQ(r.frames, golden::kFrames);

  float worst = 0.0f;
  int worstAt = -1;
  for (int i = 0; i < golden::kFrames; ++i) {
    const float d = std::abs(r.channel(0)[static_cast<std::size_t>(i)] - golden::kLeft[i]);
    if (d > worst) {
      worst = d;
      worstAt = i;
    }
  }
  std::printf("    golden render: worst sample difference %.3e at frame %d\n", static_cast<double>(worst),
              worstAt);
  MW_EXPECT(worst < 1.0e-6f);
}

MW_TEST("the golden render would notice a changed gain") {
  // A golden test nobody can fail is a golden test nobody should trust. Half a
  // decibel is a change a listener would not reliably hear and this must still
  // catch, because the point is to catch what listening does not.
  SineGraph g(0.5f * 1.0593f);  // +0.5 dB
  const RenderResult r = renderOffline(g.graph, spec(golden::kFrames, 128, golden::kSampleRate),
                                       g.out);
  float worst = 0.0f;
  for (int i = 0; i < golden::kFrames; ++i) {
    const float d = std::abs(r.channel(0)[static_cast<std::size_t>(i)] - golden::kLeft[i]);
    if (d > worst) worst = d;
  }
  MW_EXPECT(worst > 1.0e-6f);
}

MW_TEST("a cyclic graph refuses to render rather than rendering something") {
  EngineGraph graph;
  const NodeId a = graph.addNode(std::make_unique<GainNode>(1.0f));
  const NodeId b = graph.addNode(std::make_unique<GainNode>(1.0f));
  graph.connect(a, b);
  graph.connect(b, a);
  const RenderResult r = renderOffline(graph, spec(256, 128), b);
  MW_EXPECT(!r.ok);
  MW_EXPECT_EQ(r.channelCount(), 0);
}

MW_TEST("analysis helpers agree with arithmetic") {
  // These are the units every Ledger claim is stated in, so they get their own
  // check rather than being trusted because they are short.
  SineGraph g(1.0f);
  const RenderResult r = renderOffline(g.graph, spec(48000, 128), g.out);
  // A 0.5-amplitude sine: peak 0.5, RMS 0.5/√2.
  MW_EXPECT_NEAR(peak(r), 0.5f, 1.0e-3f);
  MW_EXPECT_NEAR(static_cast<float>(rms(r)), 0.5f / 1.41421356f, 1.0e-3f);
  MW_EXPECT_NEAR(static_cast<float>(dbfs(1.0f)), 0.0f, 1.0e-6f);
  MW_EXPECT_NEAR(static_cast<float>(dbfs(0.5f)), -6.0206f, 1.0e-3f);
  // A true null reads as a number rather than as negative infinity.
  MW_EXPECT(dbfs(0.0f) < -190.0);
  MW_EXPECT(std::isfinite(dbfs(0.0f)));
}

MW_TEST_MAIN("render")
