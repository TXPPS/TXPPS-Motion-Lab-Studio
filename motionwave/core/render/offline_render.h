// Motion Wave — rendering a graph without a sound card.
//
// Every acceptance test in the Unit Ledger is a claim about samples: that a
// bypassed unit nulls to −120 dBFS, that the same material renders identically
// at six block sizes, that a declared latency equals a measured one. None of
// those can be settled by reasoning about the graph, and none of them needs an
// audio device — they need a deterministic renderer that produces the samples a
// device would have played. This is that renderer.
//
// It is in the core rather than in the test tree on purpose. The offline bounce
// a user exports has to be the same code path as the one the tests measure, or
// the tests are measuring something the product does not do — which is exactly
// the failure MotionLab Studio's `exportMix.ts` was written to avoid and which
// its own e2e parity tests exist to catch.
//
// Determinism is the whole contract. Nothing here reads a clock, a random
// source, or anything outside its arguments, so a render is a pure function of
// (graph, spec) and a golden file can be checked in.
#pragma once

#include <cmath>
#include <cstddef>
#include <vector>

#include "../graph/audio_buffer.h"
#include "../graph/engine_graph.h"
#include "../graph/node.h"

namespace mw {

/// What to render, and how finely.
struct RenderSpec {
  double sampleRate = 48000.0;
  int channels = 2;
  /// Total frames to produce. The renderer emits exactly this many.
  int frames = 0;
  /// Frames per call to `EngineGraph::process`.
  ///
  /// Varying this and getting the same samples back is Ledger cell 7, and it is
  /// a real check rather than a formality: any processor that keeps state in
  /// units of blocks rather than of samples — a smoother whose pole is derived
  /// from a block length, a modulator advanced once per call — fails it, and
  /// fails it silently at every size but the one it was written against.
  int blockSize = 128;
  /// Song seconds at the first frame. A bounce of bars 33–40 is not a bounce of
  /// bars 1–8 with an offset, because anything tempo-synced resolves against
  /// song position.
  double startSeconds = 0.0;
  bool playing = true;
};

/// Interleaved-by-channel render output, plus what it took to make it.
struct RenderResult {
  /// `channels` vectors of `frames` samples. Deinterleaved, because every
  /// analysis below wants one channel at a time.
  std::vector<std::vector<float>> channels;
  int frames = 0;
  double sampleRate = 48000.0;
  /// False when `prepare` refused the graph — a cycle, most likely. The caller
  /// gets an empty result rather than an arbitrary one.
  bool ok = false;

  const std::vector<float>& channel(int c) const { return channels[static_cast<std::size_t>(c)]; }
  int channelCount() const { return static_cast<int>(channels.size()); }
};

/// Where a render's input comes from.
///
/// A function of *absolute frame index* rather than a buffer, and that is the
/// point rather than a convenience: a signal defined this way is identical
/// however the render is cut into blocks, so a block-size invariance failure is
/// always the graph's and never the test signal's. A buffer-backed source would
/// make cell 7 test itself.
using SourceFn = float (*)(int frame, int channel, double sampleRate, void* user);

/// Silence. The input for a source-only graph, such as an instrument.
inline float silentSource(int, int, double, void*) { return 0.0f; }

/**
 * A node that generates from a `SourceFn`.
 *
 * The graph has no input port of its own — signal enters through a node, which
 * is what lets an instrument and a processed track be the same kind of graph.
 * This is that node for a render: it counts absolute frames itself, so the
 * function it calls never has to know where the transport is.
 *
 * Real-time safe: it holds one integer and calls a function pointer. A
 * `SourceFn` that allocates would break that, and the RT guard around the
 * render will say so by name.
 */
class SignalSourceNode : public Node {
 public:
  SignalSourceNode(SourceFn fn, void* user) : fn_(fn), user_(user) {}

  int inputCount() const override { return 0; }
  int outputCount() const override { return 1; }
  void reset() override { frame_ = 0; }

  void process(const ProcessContext& ctx) override {
    AudioBuffer& out = ctx.outputs[0];
    for (int c = 0; c < out.channelCount(); ++c) {
      float* dst = out.channel(c);
      for (int i = 0; i < ctx.frames; ++i) {
        dst[i] = fn_(frame_ + i, c, ctx.sampleRate, user_);
      }
    }
    frame_ += ctx.frames;
  }

  const char* name() const override { return "signal-source"; }

 private:
  SourceFn fn_;
  void* user_;
  int frame_ = 0;
};

/**
 * Render `graph` to samples, capturing the output of `outputNode`.
 *
 * The node is named rather than inferred. A graph's last node in process order
 * is usually its output and is not always — a metering tap, a sidechain send or
 * an analysis branch can order last while carrying nothing anyone wants to
 * hear, and a renderer that guessed would capture it silently.
 */
inline RenderResult renderOffline(EngineGraph& graph, const RenderSpec& spec, NodeId outputNode) {
  RenderResult out;
  out.sampleRate = spec.sampleRate;
  out.frames = spec.frames;
  if (spec.frames <= 0 || spec.channels <= 0 || spec.blockSize <= 0) return out;
  if (!graph.prepare(spec.sampleRate, spec.blockSize, spec.channels)) return out;

  out.channels.assign(static_cast<std::size_t>(spec.channels),
                      std::vector<float>(static_cast<std::size_t>(spec.frames), 0.0f));

  int frame = 0;
  while (frame < spec.frames) {
    const int block =
        (spec.frames - frame) < spec.blockSize ? (spec.frames - frame) : spec.blockSize;
    const double songSeconds = spec.startSeconds + static_cast<double>(frame) / spec.sampleRate;
    graph.process(block, songSeconds, spec.playing);

    const AudioBuffer rendered = graph.output(outputNode, block);
    for (int c = 0; c < spec.channels && c < rendered.channelCount(); ++c) {
      const float* src = rendered.channel(c);
      float* dst = out.channels[static_cast<std::size_t>(c)].data() + frame;
      for (int i = 0; i < block; ++i) dst[i] = src[i];
    }
    frame += block;
  }

  out.ok = true;
  return out;
}

// ---------------------------------------------------------------- analysis
//
// The measurements the Ledger's cells are phrased in. They live beside the
// renderer because every unit's acceptance test needs the same handful, and
// thirteen private copies of "peak in dBFS" is how two of them end up
// disagreeing about what dBFS means.

/// Largest absolute sample across every channel.
inline float peak(const RenderResult& r) {
  float top = 0.0f;
  for (const auto& ch : r.channels) {
    for (const float v : ch) {
      const float a = v < 0.0f ? -v : v;
      if (a > top) top = a;
    }
  }
  return top;
}

/// Peak difference between two renders, sample for sample.
///
/// The null test in one number. Returns a large value rather than zero when the
/// two disagree in shape, because a null test that silently compares the first
/// 100 samples of a 100 000-sample render is worse than no null test.
inline float peakDifference(const RenderResult& a, const RenderResult& b) {
  if (a.frames != b.frames || a.channelCount() != b.channelCount()) return 1.0e9f;
  float top = 0.0f;
  for (int c = 0; c < a.channelCount(); ++c) {
    const std::vector<float>& x = a.channel(c);
    const std::vector<float>& y = b.channel(c);
    for (std::size_t i = 0; i < x.size(); ++i) {
      const float d = x[i] - y[i];
      const float m = d < 0.0f ? -d : d;
      if (m > top) top = m;
    }
  }
  return top;
}

/// Amplitude as dBFS, with a floor so a true null is a number rather than −inf.
///
/// −200 dB is far below the −120 dB the null tests assert and far below what
/// 32-bit float can represent meaningfully, so it reads as "silent" without
/// producing an infinity that formats badly and compares strangely.
inline double dbfs(float amplitude) {
  const float a = amplitude < 0.0f ? -amplitude : amplitude;
  if (a <= 1.0e-10f) return -200.0;
  return 20.0 * std::log10(static_cast<double>(a));
}

/// Root mean square across every channel, which is what a level claim means.
inline double rms(const RenderResult& r) {
  double sum = 0.0;
  std::size_t n = 0;
  for (const auto& ch : r.channels) {
    for (const float v : ch) {
      sum += static_cast<double>(v) * static_cast<double>(v);
      ++n;
    }
  }
  if (n == 0) return 0.0;
  return std::sqrt(sum / static_cast<double>(n));
}

}  // namespace mw
