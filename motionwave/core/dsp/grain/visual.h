// Motion Wave — what the grain engine shows, and how it crosses to the UI.
//
// `lib-grain-engine.md` §5.7, Ledger cell U20, and CLAUDE.md's rule that a
// picture is drawn from the same evaluation the audio uses, never a second
// opinion. The views here are filled **from the live grains after the block was
// rendered, using the same read position and window phase the samples came
// from**. There is no parallel particle simulation and no re-derivation of
// where a grain "would be".
#pragma once

#include <cstdint>

namespace mw::dsp::grain {

/// One grain as the visualiser sees it.
struct GrainView {
  /**
   * Monotonic spawn counter, stable for this grain's whole life.
   *
   * It has to be. `GrainPool::retire` swaps the last active grain into the
   * freed slot, so slot indices change under a grain that did nothing — a
   * visualiser keyed on slot index would teleport a particle every time an
   * unrelated neighbour ended, and GE-13 is the case that catches it.
   */
  std::uint32_t id = 0;
  float age = 0.0f;              ///< 0..1 through its window, now
  float positionSeconds = 0.0f;  ///< where in the buffer it is reading, now
  float pitchRatio = 1.0f;
  float pan = 0.0f;
  /// The current *windowed* amplitude, not the peak — a particle drawn at the
  /// peak would be at full brightness for its whole life and would say nothing.
  float amplitude = 0.0f;
  std::uint8_t tap = 0;
  std::uint8_t padding[3] = {0, 0, 0};
};

inline constexpr int kPublishedGrains = 64;

struct GrainFrame {
  std::uint32_t sequence = 0;
  float bufferSeconds = 0.0f;
  float writeHeadSeconds = 0.0f;
  std::uint16_t published = 0;
  /**
   * True count, which may exceed `published`.
   *
   * Both are sent so the UI can say "64 of 210 shown" instead of drawing a lie.
   * A visualiser that silently showed a subset would make a density control
   * appear to stop working at the point the subset filled.
   */
  std::uint16_t live = 0;
  std::uint8_t tapCount = 1;
  std::uint8_t padding[3] = {0, 0, 0};
  GrainView grains[kPublishedGrains];
};

}  // namespace mw::dsp::grain
