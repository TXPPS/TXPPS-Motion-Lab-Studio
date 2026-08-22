// Motion Wave — what a processor is.
//
// One interface for a synth voice, a compressor, a bus sum and a hosted
// third-party plugin. The shells adapt VST3, AU and AUv3 to this; the core
// knows nothing about any of them (ADR-0003).
//
// The contract that matters is on `process`: it may not allocate, lock, read a
// file or log. Anything a processor needs at run time it takes in `prepare`,
// which runs off the audio thread and may do all three.
#pragma once

#include <vector>

#include "audio_buffer.h"

namespace mw {

/// Everything a processor is told about the block it is about to render.
struct ProcessContext {
  /// Input ports. Port 0 is the signal; a dynamics processor's key is port 1.
  /// A port with no connection is a valid, silent buffer rather than null, so
  /// a processor never has to check.
  const AudioBuffer* inputs = nullptr;
  int inputCount = 0;
  /// Output ports. Written, not accumulated: the graph sums them.
  AudioBuffer* outputs = nullptr;
  int outputCount = 0;
  int frames = 0;
  double sampleRate = 48000.0;
  /// Song position at the first frame of this block, in seconds. Ticks come
  /// from the tempo map; a processor that wants bars asks it rather than
  /// keeping a second opinion about where the song is.
  double songSeconds = 0.0;
  /// False while the transport is parked. A tempo-synced modulator still runs
  /// — a user auditioning a stopped session expects to hear it move — but
  /// anything that advances the song does not.
  bool playing = false;
};

class Node {
 public:
  virtual ~Node() = default;

  /// Off the audio thread. Allocate here, or nowhere.
  virtual void prepare(double sampleRate, int maxFrames) {
    (void)sampleRate;
    (void)maxFrames;
  }

  /// On the audio thread. No allocation, no lock, no I/O, no logging — the
  /// test harness arms an operator-new hook around this call and fails the
  /// test by name if anything allocates.
  virtual void process(const ProcessContext& ctx) = 0;

  /// Samples this node delays its output by. Reported, never guessed: the
  /// graph's compensation is only as correct as this number. A node whose
  /// latency changes must say so before the block in which it changes.
  virtual int latencySamples() const { return 0; }

  virtual int inputCount() const { return 1; }
  virtual int outputCount() const { return 1; }

  /// Called when the transport jumps. A processor holding a tail, a filter
  /// state or a voice has to decide what survives a seek; most reset.
  virtual void reset() {}

  /// A name for diagnostics and for the graph dump. Never a trademarked
  /// reference name (see LEGAL_NOTES.md).
  virtual const char* name() const { return "node"; }
};

/// Passes its input through unchanged. The graph's identity element, and the
/// thing a null test measures against.
class PassThroughNode : public Node {
 public:
  void process(const ProcessContext& ctx) override {
    for (int p = 0; p < ctx.outputCount; ++p) {
      if (p < ctx.inputCount) {
        ctx.outputs[p].copyFrom(ctx.inputs[p]);
      } else {
        ctx.outputs[p].clear();
      }
    }
  }
  const char* name() const override { return "passthrough"; }
};

/// Delays its input by a fixed number of samples and declares it. Used to test
/// that the graph's compensation actually aligns real samples rather than
/// merely computing the right numbers.
class LatentNode : public Node {
 public:
  explicit LatentNode(int latency) : latency_(latency < 0 ? 0 : latency) {}

  void prepare(double, int maxFrames) override {
    // One block plus the delay, so a read never overtakes a write.
    history_.assign(static_cast<std::size_t>(maxFrames + latency_ + 1) * kMaxChannels, 0.0f);
    stride_ = static_cast<std::size_t>(maxFrames + latency_ + 1);
    cursor_ = 0;
  }

  void process(const ProcessContext& ctx) override {
    const int frames = ctx.frames;
    const int channels = ctx.outputs[0].channelCount() < kMaxChannels
                             ? ctx.outputs[0].channelCount()
                             : kMaxChannels;
    for (int c = 0; c < channels; ++c) {
      const float* in = ctx.inputCount > 0 ? ctx.inputs[0].channel(c) : nullptr;
      float* out = ctx.outputs[0].channel(c);
      float* line = history_.data() + static_cast<std::size_t>(c) * stride_;
      std::size_t w = cursor_;
      for (int i = 0; i < frames; ++i) {
        // Write, then read `latency_` samples back. At zero latency that reads
        // what was just written, so this degenerates to a pass-through rather
        // than to a special case someone has to remember.
        line[w] = in != nullptr ? in[i] : 0.0f;
        out[i] = line[(w + stride_ - static_cast<std::size_t>(latency_)) % stride_];
        w = (w + 1) % stride_;
      }
    }
    cursor_ = (cursor_ + static_cast<std::size_t>(frames)) % stride_;
  }

  int latencySamples() const override { return latency_; }
  const char* name() const override { return "latent"; }

 private:
  static constexpr int kMaxChannels = 2;
  int latency_;
  std::vector<float> history_;
  std::size_t stride_ = 0;
  std::size_t cursor_ = 0;
};

}  // namespace mw
