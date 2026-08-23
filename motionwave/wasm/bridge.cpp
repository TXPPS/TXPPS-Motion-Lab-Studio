// Motion Wave — the WebAssembly boundary.
//
// ADR-0001 makes the browser target the C++ core compiled to WASM, so this is
// not a testing convenience: without it there is no product on the platform the
// project is being developed against, and fourteen units would be built that
// none of the app could run.
//
// The one function that matters right now is `mw_render_reference`. It builds
// the same graph the native golden test builds — from the same header, so there
// is literally one definition — renders it, and hands back the samples. A
// bit-for-bit match against the native golden means the two targets agree about
// the DSP. A mismatch is a P0 and means they do not, which is worth finding
// before thirteen more units are written on top.
//
// The exports are plain C. Emscripten's `EMSCRIPTEN_KEEPALIVE` is enough for a
// function-level boundary and avoids dragging Embind's runtime into a module
// that has to be small enough to ship to a phone.
#include <cstddef>
#include <cstdint>
#include <vector>

#include "../core/render/offline_render.h"
#include "../core/render/reference_graph.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

namespace {

/**
 * Where a render is left for the caller to read.
 *
 * A module-level buffer rather than an allocation returned across the boundary,
 * because freeing across it is where WASM bindings leak: JavaScript has no
 * destructor and every "remember to call free" contract is eventually not
 * remembered. The buffer is grown on demand and owned here for the module's
 * lifetime.
 */
std::vector<float> g_output;

}  // namespace

extern "C" {

/**
 * Render the reference graph and return a pointer to interleaved output.
 *
 * Interleaved rather than planar because a single pointer and a length is the
 * simplest thing to read from a `Float32Array` view, and the caller
 * deinterleaves if it wants channels — one convention across the boundary is
 * worth more than saving the copy.
 *
 * Returns null when the render fails, which the caller must check: a graph with
 * a cycle refuses to render rather than rendering something arbitrary, and that
 * refusal has to survive the boundary.
 */
EMSCRIPTEN_KEEPALIVE
const float* mw_render_reference(float gain, int frames, int blockSize, double sampleRate) {
  mw::reference::SineGraph rig(gain);
  const mw::RenderResult r =
      mw::renderOffline(rig.graph, mw::reference::goldenSpec(frames, sampleRate, blockSize),
                        rig.out);
  if (!r.ok || r.channelCount() == 0) return nullptr;

  const std::size_t channels = static_cast<std::size_t>(r.channelCount());
  g_output.assign(static_cast<std::size_t>(r.frames) * channels, 0.0f);
  for (std::size_t c = 0; c < channels; ++c) {
    const std::vector<float>& src = r.channel(static_cast<int>(c));
    for (std::size_t i = 0; i < src.size(); ++i) {
      g_output[i * channels + c] = src[i];
    }
  }
  return g_output.data();
}

/// Samples in the last render, across all channels. Paired with the pointer.
EMSCRIPTEN_KEEPALIVE
int mw_render_length() { return static_cast<int>(g_output.size()); }

/// The gain the golden render was made at, so the caller cannot guess it wrong.
EMSCRIPTEN_KEEPALIVE
float mw_golden_gain() { return mw::reference::kGoldenGain; }

}  // extern "C"
