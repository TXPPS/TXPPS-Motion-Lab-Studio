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
#include "../core/units/generated/console_eq_params.gen.h"
#include "../core/units/generated/fet_limiter_params.gen.h"
#include "../core/units/generated/motion_shaper_params.gen.h"
#include "../core/units/generated/optical_leveller_params.gen.h"
#include "../core/units/generated/program_eq_params.gen.h"
#include "../core/units/generated/variable_mu_params.gen.h"
#include "unit_bridge.h"

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

/**
 * The unit the browser drives, and the buffers it is driven through.
 *
 * One instance rather than a handle table, because the boundary a browser needs
 * today is one unit under test — X24 renders a face against a real engine, not
 * a session. A handle table added now would be an API shaped by a guess about
 * the second caller, and ADR-0004 already says the parameter path is the thing
 * that must stay narrow.
 *
 * Held by value at module scope so no allocation crosses the boundary and there
 * is nothing for a caller to forget to free.
 */
mw::units::MotionShaper g_shaper;
std::vector<float> g_shaperIn;
std::vector<float> g_shaperOut;
std::vector<float> g_planarIn;
std::vector<float> g_planarOut;
std::vector<double> g_visual;
int g_shaperChannels = 2;

/**
 * The other four units, each behind the same boundary.
 *
 * The Motion Shaper keeps its hand-written exports because it has two the
 * others do not — a curve of breakpoints and a tempo — and folding those into a
 * shared shape would mean a boundary designed around one caller's exception.
 * Everything the five have in common lives in `UnitBridge` and is written once.
 */
mw::wasm::UnitBridge<mw::units::ProgramEq> g_programEq;
mw::wasm::UnitBridge<mw::units::OpticalLeveller> g_opticalLeveller;
mw::wasm::UnitBridge<mw::units::FetLimiter> g_fetLimiter;
mw::wasm::UnitBridge<mw::units::VariableMu> g_variableMu;
mw::wasm::UnitBridge<mw::units::ConsoleEq> g_consoleEq;

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

// ------------------------------------------------------------ the Motion Shaper
//
// Cell X24 asks for one integration test per unit: a real face driving a real
// engine and getting back real audio and real published state. That is what
// these exports are for, and it is why they are the *same* entry points the app
// will use rather than a test-only path — a boundary exercised only by tests is
// a boundary whose first real caller finds the bugs.

/// Prepare the unit. Off the audio thread, which across this boundary is all of it.
EMSCRIPTEN_KEEPALIVE
void mw_shaper_prepare(double sampleRate, int blockSize, int channels) {
  g_shaperChannels = channels < 1 ? 1 : (channels > 2 ? 2 : channels);
  g_shaper.prepare(sampleRate, blockSize);
  g_shaper.reset();
  g_shaperIn.assign(static_cast<std::size_t>(blockSize) *
                        static_cast<std::size_t>(g_shaperChannels),
                    0.0f);
  g_shaperOut.assign(g_shaperIn.size(), 0.0f);
}

/**
 * Set one parameter, by the id the manifest gave it.
 *
 * The dispatch is generated from the same manifest the TypeScript control table
 * is generated from, so an id arriving here is an id the unit has — the
 * boundary cannot be handed a control that names nothing.
 */
EMSCRIPTEN_KEEPALIVE
void mw_shaper_set_param(int id, double value) {
  mw::units::applyMotionShaperParam(g_shaper, id, value);
}

/**
 * Set one band's curve from a flat array of `[x, y, shape, tension]` quads.
 *
 * Flat doubles rather than a struct layout the caller has to reproduce: a
 * JavaScript view that agrees with a C++ struct is a duplicated ABI, and the
 * first time a field is added the two disagree silently.
 */
EMSCRIPTEN_KEEPALIVE
void mw_shaper_set_curve(int band, const double* quads, int count) {
  if (quads == nullptr || count <= 0) return;
  std::vector<mw::dsp::Breakpoint> points;
  points.reserve(static_cast<std::size_t>(count));
  for (int i = 0; i < count; ++i) {
    const double* q = quads + static_cast<std::ptrdiff_t>(i) * 4;
    const int shape = static_cast<int>(q[2] + 0.5);
    points.push_back(mw::dsp::Breakpoint{
        q[0], q[1],
        shape == 1   ? mw::dsp::SegmentShape::Arc
        : shape == 2 ? mw::dsp::SegmentShape::SCurve
        : shape == 3 ? mw::dsp::SegmentShape::Step
                     : mw::dsp::SegmentShape::Line,
        q[3]});
  }
  g_shaper.setCurve(band, points.data(), points.size());
}

EMSCRIPTEN_KEEPALIVE
void mw_shaper_set_bpm(double bpm) { g_shaper.setBpm(bpm); }

EMSCRIPTEN_KEEPALIVE
void mw_shaper_set_bypass(int bypass) { g_shaper.setBypass(bypass != 0); }

/// Where the caller writes the block's input, interleaved.
EMSCRIPTEN_KEEPALIVE
float* mw_shaper_input() { return g_shaperIn.data(); }

/// Where the caller reads the block's output, interleaved.
EMSCRIPTEN_KEEPALIVE
const float* mw_shaper_output() { return g_shaperOut.data(); }

/**
 * Process one block at `songSeconds`.
 *
 * The song position is a parameter rather than a counter the module keeps,
 * because the transport is the host's and a module with its own idea of where
 * the song is would drift from it — which is the whole failure mode the
 * transport-derived phase in `LfoPhase` exists to avoid.
 */
EMSCRIPTEN_KEEPALIVE
void mw_shaper_process(int frames, double sampleRate, double songSeconds, int playing) {
  const int channels = g_shaperChannels;
  const std::size_t span = static_cast<std::size_t>(frames);
  g_planarIn.assign(static_cast<std::size_t>(channels) * span, 0.0f);
  g_planarOut.assign(g_planarIn.size(), 0.0f);
  float* inPtr[2] = {nullptr, nullptr};
  float* outPtr[2] = {nullptr, nullptr};
  for (int c = 0; c < channels; ++c) {
    inPtr[c] = g_planarIn.data() + static_cast<std::size_t>(c) * span;
    outPtr[c] = g_planarOut.data() + static_cast<std::size_t>(c) * span;
    for (int i = 0; i < frames; ++i) {
      inPtr[c][i] = g_shaperIn[static_cast<std::size_t>(i * channels + c)];
    }
  }
  // Deinterleaved for the call and re-interleaved after, because `AudioBuffer`
  // is a planar view and the boundary is interleaved. The copy is the honest
  // cost of one convention across the boundary; a planar boundary would push
  // the same copy into every JavaScript caller instead.
  mw::AudioBuffer in(inPtr, channels, frames);
  mw::AudioBuffer out(outPtr, channels, frames);
  mw::ProcessContext ctx;
  ctx.inputs = &in;
  ctx.inputCount = 1;
  ctx.outputs = &out;
  ctx.outputCount = 1;
  ctx.frames = frames;
  ctx.sampleRate = sampleRate;
  ctx.songSeconds = songSeconds;
  ctx.playing = playing != 0;
  g_shaper.process(ctx);
  for (int c = 0; c < channels; ++c) {
    for (int i = 0; i < frames; ++i) {
      g_shaperOut[static_cast<std::size_t>(i * channels + c)] = outPtr[c][i];
    }
  }
}

/**
 * Read the frame the audio path published, as nine doubles.
 *
 * Read through the seqlock rather than copied out of a shared struct: the
 * browser's reader and the audio path are the same thread here and would agree
 * whatever this did, but the app's will not be, and an integration test that
 * exercised a different read path than the product would be checking something
 * the product does not do.
 */
EMSCRIPTEN_KEEPALIVE
const double* mw_shaper_visual() {
  mw::dsp::VisualFrame frame;
  g_shaper.visual().read(frame);
  g_visual.assign(9, 0.0);
  g_visual[0] = static_cast<double>(frame.phase);
  for (int b = 0; b < 3; ++b) {
    g_visual[static_cast<std::size_t>(1 + b)] = static_cast<double>(frame.bandGain[b]);
    g_visual[static_cast<std::size_t>(4 + b)] = static_cast<double>(frame.bandPeak[b]);
  }
  g_visual[7] = static_cast<double>(frame.inputPeak);
  g_visual[8] = static_cast<double>(frame.outputPeak);
  return g_visual.data();
}

/// How many times the audio path has published. A face that stalls shows here.
EMSCRIPTEN_KEEPALIVE
unsigned int mw_shaper_generation() { return g_shaper.visual().generation(); }

// The four dynamics units. Each gets the common exports from the macro and one
// visual export of its own, because a frame is the unit's own shape — a generic
// serialiser would be a schema neither side of the boundary checks, which is
// exactly the duplicated ABI the curve export avoids.

MW_UNIT_EXPORTS(mw_program_eq, g_programEq, mw::units::applyProgramEqParam)

/// Six doubles: the two peaks, the make-up amplifier's second- and third-order
/// coefficients, and how hard each transformer is being driven.
EMSCRIPTEN_KEEPALIVE
const double* mw_program_eq_visual() {
  mw::units::ProgramEqFrame frame;
  g_programEq.unit().visual().read(frame);
  std::vector<double>& out = g_programEq.visualScratch(6);
  out[0] = static_cast<double>(frame.inputPeak);
  out[1] = static_cast<double>(frame.outputPeak);
  out[2] = static_cast<double>(frame.c2);
  out[3] = static_cast<double>(frame.c3);
  out[4] = static_cast<double>(frame.inputCoreDrive);
  out[5] = static_cast<double>(frame.outputCoreDrive);
  return out.data();
}

MW_UNIT_EXPORTS(mw_optical_leveller, g_opticalLeveller, mw::units::applyOpticalLevellerParam)

/// Five doubles: the two peaks, the meter cell's reduction, the exposure state,
/// and the second release branch's current constant.
EMSCRIPTEN_KEEPALIVE
const double* mw_optical_leveller_visual() {
  mw::units::OpticalLevellerFrame frame;
  g_opticalLeveller.unit().visual().read(frame);
  std::vector<double>& out = g_opticalLeveller.visualScratch(5);
  out[0] = static_cast<double>(frame.inputPeak);
  out[1] = static_cast<double>(frame.outputPeak);
  out[2] = static_cast<double>(frame.gainReductionDb);
  out[3] = static_cast<double>(frame.exposure);
  out[4] = static_cast<double>(frame.releaseSeconds);
  return out.data();
}

MW_UNIT_EXPORTS(mw_fet_limiter, g_fetLimiter, mw::units::applyFetLimiterParam)

/// Four doubles: the two peaks, the reduction, and the timing network's charge.
EMSCRIPTEN_KEEPALIVE
const double* mw_fet_limiter_visual() {
  mw::units::FetLimiterFrame frame;
  g_fetLimiter.unit().visual().read(frame);
  std::vector<double>& out = g_fetLimiter.visualScratch(4);
  out[0] = static_cast<double>(frame.inputPeak);
  out[1] = static_cast<double>(frame.outputPeak);
  out[2] = static_cast<double>(frame.gainReductionDb);
  out[3] = static_cast<double>(frame.detector);
  return out.data();
}

MW_UNIT_EXPORTS(mw_variable_mu, g_variableMu, mw::units::applyVariableMuParam)

/// Seven doubles: the two peaks, a reduction and a storage state *per channel*
/// because the two channels are independent, and whether the matrix is in.
EMSCRIPTEN_KEEPALIVE
const double* mw_variable_mu_visual() {
  mw::units::VariableMuFrame frame;
  g_variableMu.unit().visual().read(frame);
  std::vector<double>& out = g_variableMu.visualScratch(7);
  out[0] = static_cast<double>(frame.inputPeak);
  out[1] = static_cast<double>(frame.outputPeak);
  out[2] = static_cast<double>(frame.gainReductionDb[0]);
  out[3] = static_cast<double>(frame.gainReductionDb[1]);
  out[4] = static_cast<double>(frame.storage[0]);
  out[5] = static_cast<double>(frame.storage[1]);
  out[6] = frame.lateralVertical ? 1.0 : 0.0;
  return out.data();
}

MW_UNIT_EXPORTS(mw_console_eq, g_consoleEq, mw::units::applyConsoleEqParam)

/// Seven doubles: the two peaks, which lineage is in circuit, the inductor
/// mid band's working Q, and the three bridged-T bandwidths.
EMSCRIPTEN_KEEPALIVE
const double* mw_console_eq_visual() {
  mw::units::ConsoleEqFrame frame;
  g_consoleEq.unit().visual().read(frame);
  std::vector<double>& out = g_consoleEq.visualScratch(7);
  out[0] = static_cast<double>(frame.inputPeak);
  out[1] = static_cast<double>(frame.outputPeak);
  out[2] = frame.american ? 1.0 : 0.0;
  out[3] = static_cast<double>(frame.midQ);
  for (int b = 0; b < 3; ++b) {
    out[static_cast<std::size_t>(4 + b)] = static_cast<double>(frame.bandwidthOctaves[b]);
  }
  return out.data();
}

}  // extern "C"
