// Motion Wave — the graph that actually renders.
//
// `Topology` decides the order and the compensation; this runs it. Every
// buffer and every compensation delay is allocated in `prepare` and only
// indexed during `process`, which is what lets the whole render satisfy the
// no-allocation rule and be *proven* to (the graph tests arm the allocation
// guard around a hundred blocks).
#pragma once

#include <memory>
#include <vector>

#include "audio_buffer.h"
#include "node.h"
#include "topology.h"

namespace mw {

/// Storage plus the channel-pointer array an `AudioBuffer` view needs.
class OwnedBuffer {
 public:
  void resize(int channels, int frames) {
    channels_ = channels;
    frames_ = frames;
    data_.assign(static_cast<std::size_t>(channels) * static_cast<std::size_t>(frames), 0.0f);
    ptrs_.resize(static_cast<std::size_t>(channels));
    for (int c = 0; c < channels; ++c) {
      ptrs_[static_cast<std::size_t>(c)] =
          data_.data() + static_cast<std::size_t>(c) * static_cast<std::size_t>(frames);
    }
  }
  AudioBuffer view(int frames) noexcept {
    return AudioBuffer(ptrs_.data(), channels_, frames < frames_ ? frames : frames_);
  }
  int channels() const noexcept { return channels_; }

 private:
  std::vector<float> data_;
  std::vector<float*> ptrs_;
  int channels_ = 0;
  int frames_ = 0;
};

/// A fixed delay on one connection, applied so that every path into a node
/// arrives aligned. Zero delay is a copy, not a special case.
class EdgeDelay {
 public:
  void prepare(int channels, int maxFrames, int delaySamples) {
    delay_ = delaySamples < 0 ? 0 : delaySamples;
    stride_ = static_cast<std::size_t>(maxFrames + delay_ + 1);
    channels_ = channels;
    line_.assign(static_cast<std::size_t>(channels) * stride_, 0.0f);
    cursor_ = 0;
  }

  void process(const AudioBuffer& src, AudioBuffer& dst, int frames) noexcept {
    if (delay_ == 0) {
      dst.copyFrom(src);
      return;
    }
    for (int c = 0; c < dst.channelCount() && c < channels_; ++c) {
      const int sc = c < src.channelCount() ? c : src.channelCount() - 1;
      const float* in = sc >= 0 ? src.channel(sc) : nullptr;
      float* out = dst.channel(c);
      float* line = line_.data() + static_cast<std::size_t>(c) * stride_;
      std::size_t w = cursor_;
      for (int i = 0; i < frames; ++i) {
        line[w] = in != nullptr ? in[i] : 0.0f;
        out[i] = line[(w + stride_ - static_cast<std::size_t>(delay_)) % stride_];
        w = (w + 1) % stride_;
      }
    }
    cursor_ = (cursor_ + static_cast<std::size_t>(frames)) % stride_;
  }

  int delay() const noexcept { return delay_; }

 private:
  std::vector<float> line_;
  std::size_t stride_ = 0;
  std::size_t cursor_ = 0;
  int channels_ = 0;
  int delay_ = 0;
};

class EngineGraph {
 public:
  NodeId addNode(std::unique_ptr<Node> node) {
    nodes_.push_back(std::move(node));
    return nodes_.size() - 1;
  }

  void connect(NodeId from, NodeId to, int toPort = 0) {
    edges_.push_back(Edge{from, to, toPort});
  }

  Node* node(NodeId id) noexcept { return nodes_[id].get(); }
  std::size_t nodeCount() const noexcept { return nodes_.size(); }

  /// Off the audio thread. Plans the compensation, sizes every buffer and
  /// every delay, and prepares every node. After this returns, `process` is
  /// allocation-free.
  ///
  /// Returns false when the graph has a cycle, in which case it will not
  /// render — a cycle is a caller bug, and rendering something arbitrary
  /// rather than refusing would hide it.
  bool prepare(double sampleRate, int maxFrames, int channels) {
    sampleRate_ = sampleRate;
    maxFrames_ = maxFrames;
    channels_ = channels;

    Topology topology(nodes_.size());
    for (std::size_t i = 0; i < nodes_.size(); ++i) {
      topology.setLatency(i, nodes_[i]->latencySamples());
    }
    for (const Edge& e : edges_) topology.connect(e.from, e.to, e.toPort);

    order_ = topology.processOrder();
    if (order_.empty() && !nodes_.empty()) return false;
    plan_ = topology.plan();
    if (!plan_.ordered) return false;

    outputs_.resize(nodes_.size());
    inputs_.resize(nodes_.size());
    for (std::size_t i = 0; i < nodes_.size(); ++i) {
      const int outs = nodes_[i]->outputCount();
      const int ins = nodes_[i]->inputCount();
      outputs_[i].resize(static_cast<std::size_t>(outs));
      inputs_[i].resize(static_cast<std::size_t>(ins));
      for (int p = 0; p < outs; ++p) outputs_[i][static_cast<std::size_t>(p)].resize(channels, maxFrames);
      for (int p = 0; p < ins; ++p) inputs_[i][static_cast<std::size_t>(p)].resize(channels, maxFrames);
      nodes_[i]->prepare(sampleRate, maxFrames);
    }

    delays_.resize(edges_.size());
    for (std::size_t i = 0; i < edges_.size(); ++i) {
      delays_[i].prepare(channels, maxFrames, plan_.compensation[i]);
    }
    scratch_.resize(channels, maxFrames);

    // Views are rebuilt per block (they are two pointers and two ints), but
    // the arrays holding them are sized here so `process` never grows one.
    inputViews_.resize(kMaxPorts);
    outputViews_.resize(kMaxPorts);
    return true;
  }

  /// On the audio thread. Allocates nothing.
  void process(int frames, double songSeconds, bool playing) {
    if (frames > maxFrames_) frames = maxFrames_;
    for (const NodeId id : order_) {
      const int ins = nodes_[id]->inputCount();
      const int outs = nodes_[id]->outputCount();

      for (int p = 0; p < ins && p < kMaxPorts; ++p) {
        inputs_[id][static_cast<std::size_t>(p)].view(frames).clear();
      }
      // Sum every incoming edge through its compensation delay. Summing rather
      // than copying is what makes a port a bus: two sends into one return is
      // the same code path as one.
      for (std::size_t e = 0; e < edges_.size(); ++e) {
        const Edge& edge = edges_[e];
        if (edge.to != id) continue;
        const int port = edge.toPort < ins ? edge.toPort : 0;
        // Port 0 of the source: nodes with several outputs are not modelled
        // yet, and adding a `fromPort` to `Edge` is the change when they are.
        AudioBuffer src = outputs_[edge.from][0].view(frames);
        AudioBuffer tmp = scratch_.view(frames);
        delays_[e].process(src, tmp, frames);
        AudioBuffer dst = inputs_[id][static_cast<std::size_t>(port)].view(frames);
        dst.addFrom(tmp);
      }

      for (int p = 0; p < ins && p < kMaxPorts; ++p) {
        inputViews_[static_cast<std::size_t>(p)] =
            inputs_[id][static_cast<std::size_t>(p)].view(frames);
      }
      for (int p = 0; p < outs && p < kMaxPorts; ++p) {
        outputViews_[static_cast<std::size_t>(p)] =
            outputs_[id][static_cast<std::size_t>(p)].view(frames);
        outputViews_[static_cast<std::size_t>(p)].clear();
      }

      ProcessContext ctx;
      ctx.inputs = inputViews_.data();
      ctx.inputCount = ins < kMaxPorts ? ins : kMaxPorts;
      ctx.outputs = outputViews_.data();
      ctx.outputCount = outs < kMaxPorts ? outs : kMaxPorts;
      ctx.frames = frames;
      ctx.sampleRate = sampleRate_;
      ctx.songSeconds = songSeconds;
      ctx.playing = playing;
      // The views are views of `outputs_[id]`'s own storage, so a node writing
      // into `ctx.outputs` has already written where the next node will read.
      nodes_[id]->process(ctx);
    }
  }

  /// A node's output for this block, for the caller to read or write.
  AudioBuffer output(NodeId id, int frames, int port = 0) noexcept {
    return outputs_[id][static_cast<std::size_t>(port)].view(frames);
  }

  /// What the graph delays its output by, and therefore what a host must be
  /// told and what input monitoring must account for.
  int latencySamples() const noexcept { return plan_.outputLatency; }

  const LatencyPlan& plan() const noexcept { return plan_; }
  const std::vector<NodeId>& order() const noexcept { return order_; }

 private:
  /// A node with more ports than this is a design problem, not a case to
  /// handle: the port arrays are sized once and a growable one would allocate
  /// inside `process`.
  static constexpr int kMaxPorts = 8;

  std::vector<std::unique_ptr<Node>> nodes_;
  std::vector<Edge> edges_;
  std::vector<NodeId> order_;
  LatencyPlan plan_;
  std::vector<std::vector<OwnedBuffer>> outputs_;
  std::vector<std::vector<OwnedBuffer>> inputs_;
  std::vector<EdgeDelay> delays_;
  OwnedBuffer scratch_;
  std::vector<AudioBuffer> inputViews_;
  std::vector<AudioBuffer> outputViews_;
  double sampleRate_ = 48000.0;
  int maxFrames_ = 0;
  int channels_ = 0;
};

}  // namespace mw
