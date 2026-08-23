// Motion Wave — the shape every unit's WASM boundary has.
//
// Cell X24 asks for one integration test per unit: a real face driving a real
// engine and getting back real audio and real published state. Five units now
// need that, and five copies of the same buffer bookkeeping is five chances for
// one of them to interleave the wrong way round and be wrong only on the unit
// nobody looked at.
//
// So the bookkeeping is here once and the per-unit exports are a few lines each.
// What stays per unit is the part that genuinely differs: the parameter
// dispatch, which is generated, and the visual frame, which is the unit's own
// shape and cannot be written generically without inventing a schema neither
// side would check.
#pragma once

#include <cstddef>
#include <vector>

#include "../core/graph/node.h"

namespace mw::wasm {

/**
 * The buffers one unit is driven through, and the interleaving either way.
 *
 * Held by value at module scope by each unit's own instance of this, so no
 * allocation crosses the boundary and there is nothing for a caller to forget
 * to free. JavaScript has no destructor and every "remember to call free"
 * contract is eventually not remembered.
 */
template <typename Unit>
class UnitBridge {
 public:
  Unit& unit() noexcept { return unit_; }

  void prepare(double sampleRate, int blockSize, int channels) {
    channels_ = channels < 1 ? 1 : (channels > 2 ? 2 : channels);
    const int frames = blockSize > 0 ? blockSize : 128;
    unit_.prepare(sampleRate, frames);
    unit_.reset();
    interleavedIn_.assign(static_cast<std::size_t>(frames) * static_cast<std::size_t>(channels_),
                          0.0f);
    interleavedOut_.assign(interleavedIn_.size(), 0.0f);
  }

  /// Where the caller writes the block's input, interleaved.
  float* input() noexcept { return interleavedIn_.data(); }
  /// Where the caller reads the block's output, interleaved.
  const float* output() const noexcept { return interleavedOut_.data(); }

  /**
   * Process one block.
   *
   * Interleaved across the boundary and planar inside it, because `AudioBuffer`
   * is a planar view and a single pointer with a length is the simplest thing
   * to read from a `Float32Array`. The copy is the honest cost of one
   * convention across the boundary; a planar boundary would push the same copy
   * into every JavaScript caller instead.
   *
   * The song position is a parameter rather than a counter this keeps, because
   * the transport is the host's and a module with its own idea of where the
   * song is would drift from it.
   */
  void process(int frames, double sampleRate, double songSeconds, bool playing) {
    if (frames <= 0) return;
    const std::size_t span = static_cast<std::size_t>(frames);
    planarIn_.assign(static_cast<std::size_t>(channels_) * span, 0.0f);
    planarOut_.assign(planarIn_.size(), 0.0f);
    float* inPtr[2] = {nullptr, nullptr};
    float* outPtr[2] = {nullptr, nullptr};
    for (int c = 0; c < channels_; ++c) {
      inPtr[c] = planarIn_.data() + static_cast<std::size_t>(c) * span;
      outPtr[c] = planarOut_.data() + static_cast<std::size_t>(c) * span;
      for (int i = 0; i < frames; ++i) {
        inPtr[c][i] = interleavedIn_[static_cast<std::size_t>(i * channels_ + c)];
      }
    }
    AudioBuffer in(inPtr, channels_, frames);
    AudioBuffer out(outPtr, channels_, frames);
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &out;
    ctx.outputCount = 1;
    ctx.frames = frames;
    ctx.sampleRate = sampleRate;
    ctx.songSeconds = songSeconds;
    ctx.playing = playing;
    unit_.process(ctx);
    for (int c = 0; c < channels_; ++c) {
      for (int i = 0; i < frames; ++i) {
        interleavedOut_[static_cast<std::size_t>(i * channels_ + c)] = outPtr[c][i];
      }
    }
  }

  /// The buffer each unit's visual export serialises into. Module-lifetime, for
  /// the same reason the audio buffers are.
  std::vector<double>& visualScratch(std::size_t count) {
    visual_.assign(count, 0.0);
    return visual_;
  }

 private:
  Unit unit_;
  std::vector<float> interleavedIn_;
  std::vector<float> interleavedOut_;
  std::vector<float> planarIn_;
  std::vector<float> planarOut_;
  std::vector<double> visual_;
  int channels_ = 2;
};

}  // namespace mw::wasm

/**
 * The exports every unit has, spelled once.
 *
 * A macro rather than a template of functions because the boundary is plain C:
 * `EMSCRIPTEN_KEEPALIVE` needs a real symbol with a real name, and a name is
 * what a JavaScript caller binds to. The visual export is deliberately *not*
 * here — each unit's frame is its own shape, and a generic one would be a
 * schema neither side checks.
 */
#define MW_UNIT_EXPORTS(prefix, bridge, applyParam)                                          \
  EMSCRIPTEN_KEEPALIVE                                                                       \
  void prefix##_prepare(double sampleRate, int blockSize, int channels) {                    \
    (bridge).prepare(sampleRate, blockSize, channels);                                       \
  }                                                                                          \
  EMSCRIPTEN_KEEPALIVE                                                                       \
  void prefix##_set_param(int id, double value) { applyParam((bridge).unit(), id, value); }   \
  EMSCRIPTEN_KEEPALIVE                                                                       \
  float* prefix##_input() { return (bridge).input(); }                                        \
  EMSCRIPTEN_KEEPALIVE                                                                       \
  const float* prefix##_output() { return (bridge).output(); }                                \
  EMSCRIPTEN_KEEPALIVE                                                                       \
  void prefix##_process(int frames, double sampleRate, double songSeconds, int playing) {     \
    (bridge).process(frames, sampleRate, songSeconds, playing != 0);                          \
  }                                                                                           \
  EMSCRIPTEN_KEEPALIVE                                                                        \
  void prefix##_set_bypass(int bypass) { (bridge).unit().setBypass(bypass != 0); }             \
  EMSCRIPTEN_KEEPALIVE                                                                         \
  unsigned int prefix##_generation() { return (bridge).unit().visual().generation(); }
