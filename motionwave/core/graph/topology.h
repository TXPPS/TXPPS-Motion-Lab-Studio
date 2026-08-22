// Motion Wave — graph order and plugin delay compensation.
//
// Deliberately pure: this file knows about nodes, edges and latencies, and
// nothing about audio, buffers or threads. That is what lets the hardest thing
// in a mixer — making every path arrive aligned when the processors on them
// have different latencies — be tested exhaustively without a sound card.
//
// The failure this prevents is specific and famous. Put a linear-phase EQ on
// the snare and nothing else, and without compensation the snare arrives a
// few milliseconds late against the overheads; the mix does not sound broken,
// it sounds slightly wrong, and the engineer blames the room.
#pragma once

#include <algorithm>
#include <cstddef>
#include <vector>

namespace mw {

using NodeId = std::size_t;

struct Edge {
  NodeId from = 0;
  NodeId to = 0;
  /// Which input of `to` this feeds. A dynamics processor's key input is a
  /// second port, not a second graph.
  int toPort = 0;
};

/// The result of planning. Every field is in samples.
struct LatencyPlan {
  /// Per node: how far behind the graph's input its own input is, once every
  /// path feeding it has been aligned.
  std::vector<int> arrival;
  /// Per edge, in the order the edges were given: how much delay to insert on
  /// this connection so its signal arrives with the others at the same node.
  std::vector<int> compensation;
  /// The whole graph's reported latency — what a host must be told, and what
  /// input monitoring has to account for.
  int outputLatency = 0;
  /// False when the graph contains a cycle, in which case nothing else here is
  /// meaningful. A cycle is a bug in the caller, not a condition to survive.
  bool ordered = true;
};

/// A directed graph of processors and the latency each one adds.
class Topology {
 public:
  explicit Topology(std::size_t nodeCount) : latency_(nodeCount, 0) {}

  /// `samples` is what the node itself adds — a lookahead, an oversampling
  /// filter pair, an FFT hop. Reported by the node, never guessed at.
  void setLatency(NodeId node, int samples) {
    if (node < latency_.size()) latency_[node] = samples < 0 ? 0 : samples;
  }

  void connect(NodeId from, NodeId to, int toPort = 0) {
    edges_.push_back(Edge{from, to, toPort});
  }

  std::size_t nodeCount() const noexcept { return latency_.size(); }
  const std::vector<Edge>& edges() const noexcept { return edges_; }
  int latency(NodeId node) const noexcept { return latency_[node]; }

  /// Processing order: every node appears after everything that feeds it.
  /// Empty when the graph has a cycle.
  std::vector<NodeId> processOrder() const {
    const std::size_t n = latency_.size();
    std::vector<int> indegree(n, 0);
    for (const Edge& e : edges_) {
      if (e.to < n) ++indegree[e.to];
    }
    std::vector<NodeId> ready;
    ready.reserve(n);
    // Ascending node id among the ready set, so the order is deterministic.
    // A graph that processes in a different order between two runs produces a
    // different render, and a golden-render test would flag it as a drift that
    // is really just a hash iteration order.
    for (NodeId i = 0; i < n; ++i) {
      if (indegree[i] == 0) ready.push_back(i);
    }
    std::vector<NodeId> order;
    order.reserve(n);
    while (!ready.empty()) {
      const auto it = std::min_element(ready.begin(), ready.end());
      const NodeId node = *it;
      ready.erase(it);
      order.push_back(node);
      for (const Edge& e : edges_) {
        if (e.from != node || e.to >= n) continue;
        if (--indegree[e.to] == 0) ready.push_back(e.to);
      }
    }
    if (order.size() != n) return {};  // a cycle: some node never reached zero
    return order;
  }

  /// Plan the compensation.
  ///
  /// A node's input is aligned at the latest arrival among the paths feeding
  /// it; every other path is delayed to match. The graph's own latency is the
  /// latest arrival plus that node's own latency, over every node nothing
  /// consumes — which is the definition a host wants, not the sum along the
  /// longest chain.
  LatencyPlan plan() const {
    LatencyPlan result;
    const std::size_t n = latency_.size();
    result.arrival.assign(n, 0);
    result.compensation.assign(edges_.size(), 0);

    const std::vector<NodeId> order = processOrder();
    if (order.empty() && n > 0) {
      result.ordered = false;
      return result;
    }

    for (const NodeId node : order) {
      int latest = 0;
      for (const Edge& e : edges_) {
        if (e.to != node) continue;
        const int produced = result.arrival[e.from] + latency_[e.from];
        latest = latest > produced ? latest : produced;
      }
      result.arrival[node] = latest;
    }

    for (std::size_t i = 0; i < edges_.size(); ++i) {
      const Edge& e = edges_[i];
      const int produced = result.arrival[e.from] + latency_[e.from];
      // Never negative: `arrival` is the maximum over exactly this set, so the
      // difference is the delay this path is short by.
      result.compensation[i] = result.arrival[e.to] - produced;
    }

    std::vector<bool> consumed(n, false);
    for (const Edge& e : edges_) {
      if (e.from < n) consumed[e.from] = true;
    }
    for (NodeId i = 0; i < n; ++i) {
      if (consumed[i]) continue;
      const int total = result.arrival[i] + latency_[i];
      result.outputLatency = result.outputLatency > total ? result.outputLatency : total;
    }
    return result;
  }

  /// Total delay inserted by a plan. Not needed to run the graph — it is the
  /// number that tells you whether compensation is costing more memory than
  /// the session can afford, which is the trade every DAW makes silently.
  static long long insertedSamples(const LatencyPlan& plan) {
    long long total = 0;
    for (const int c : plan.compensation) total += c;
    return total;
  }

 private:
  std::vector<int> latency_;
  std::vector<Edge> edges_;
};

}  // namespace mw
