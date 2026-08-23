// Motion Wave — the canonical graph the golden render is made from.
//
// Extracted here so that it has exactly one definition. The native test and the
// WebAssembly boundary test both build it, and the whole point of comparing
// their outputs is that any difference is the *toolchain's* — so if each built
// its own copy of the graph, a divergence in the graphs would look exactly like
// a divergence in the compilers, and the boundary test would be testing whether
// two people can transcribe the same thing twice.
//
// It is in `core/render/` rather than in `core/test/` because the WASM bridge
// links the core and not the tests, and because a canonical signal path is a
// property of the engine rather than of any one suite.
#pragma once

#include <cmath>
#include <memory>

#include "../graph/engine_graph.h"
#include "../graph/node.h"
#include "offline_render.h"

namespace mw::reference {

/**
 * A 1 kHz sine at −6 dBFS, right channel inverted.
 *
 * Not full scale, because a signal measured at the rails is a signal measured
 * where several processors clip. The inversion means a mistake that collapses
 * the two channels to mono shows up as silence rather than as something
 * plausible.
 */
inline float sine1k(int frame, int channel, double sampleRate, void*) {
  const double phase =
      2.0 * 3.14159265358979323846 * 1000.0 * static_cast<double>(frame) / sampleRate;
  const double sign = channel == 0 ? 1.0 : -1.0;
  return static_cast<float>(0.5 * sign * std::sin(phase));
}

/// Scales its input. The simplest node that is not a wire.
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

/// Source into gain. The smallest graph that renders something non-trivial.
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

/// The exact configuration `golden_render.h` was generated from.
inline RenderSpec goldenSpec(int frames, double sampleRate, int blockSize = 128) {
  RenderSpec s;
  s.frames = frames;
  s.blockSize = blockSize;
  s.sampleRate = sampleRate;
  s.channels = 2;
  return s;
}

/// Gain the golden render was made at.
inline constexpr float kGoldenGain = 0.5f;

}  // namespace mw::reference
