// Motion Wave — the control-rate grid, and the frame a voice's modulators fill.
//
// `lib-voice-substrate.md` §4 and §6.3. Modulation is evaluated on a grid of
// **absolute** frame indices, never once per block. A 16-frame block and a
// 1024-frame block therefore hit the same grid points and produce the same
// samples, which is what the offline renderer's block-size cell asserts and
// what VS-07 measures at five block sizes: a modulator advanced once per call
// produces a different envelope at every buffer size, and the artefact moves
// when the user changes their buffer, so it reads as an environment problem
// rather than as the bug it is.
//
// Three pieces, and the split is the design:
//
//   `ModGrid`   the stride and where the song is, in frames. Absolute, so a
//               locate sets it and a block advances it, and grid points are
//               multiples of the stride whatever the block boundaries do.
//   `GridWalk`  cuts one block into runs that never cross a grid point, says
//               which runs start on one, and gives every sample its position
//               inside the stride as a fraction — computed from the absolute
//               frame, so sample 1037 gets the same fraction whether it is the
//               13th sample of a 1024-frame block or the first of a 17-frame one.
//   `ModPair`   the last two grid frames of one voice and the line between
//               them. At a grid point the modulators are advanced by one
//               stride, so the frame they fill is the value at the *end* of the
//               coming run, and the run interpolates from the frame before —
//               the same treatment `ParamBlock` gives a parameter, for the same
//               reason, and with no lag.
//
// **Interpolation is a multiply, not an accumulated slope.** `v += slope` per
// sample is one flop cheaper and it is a different sum in every block split —
// thirty-two additions from the grid point in one render, three from a mid-run
// start in another — and VS-07's tolerance is half a float step. Computing
// `prev + (cur − prev) · t` from the absolute position gives the same bits in
// every split, and the flop it costs is the price of a claim that can be
// checked to the bit rather than to a tolerance somebody would later widen.
//
// Nothing here allocates or holds a pointer to anything that does: a frame is
// thirty-two floats, a pair is two frames, a walk is three integers.
#pragma once

#include <cstdint>

namespace mw::dsp::voice {

/// Where modulation is evaluated. `stride` in samples: 32 is 1500 Hz at
/// 48 kHz, the Studio tier; a tier changes this and never a shape, because
/// every time in the substrate is in seconds and is unchanged by it.
struct ModGrid {
  int stride = 32;
  /// Absolute, from song position. Set on a locate; advanced by every walk.
  std::uint64_t frameIndex = 0;
};

/// The matrix instrument has twenty-seven sources; five spare.
inline constexpr int kMaxModSources = 32;

/// Every modulation source of one voice at one grid point. A destination is an
/// index into this — never a callback — which is what keeps the sample path
/// free of `std::function` and of anything that could allocate behind it.
struct ModFrame {
  float sources[kMaxModSources]{};
};

/// One run of a block: a span of samples that starts at a grid point or
/// mid-stride and ends before the next grid point.
struct GridRun {
  int offset = 0;             ///< first sample of the run, relative to the block
  int frames = 0;             ///< length; never crosses a grid point
  bool atGridPoint = false;   ///< the run starts on a grid point: evaluate here
  std::uint64_t frameIndex = 0;  ///< absolute index of the run's first sample
  int positionInStride = 0;   ///< `frameIndex % stride`
  float invStride = 1.0f / 32.0f;

  /// Interpolation position of the run's `i`th sample, 0 at the grid point and
  /// short of 1 before the next. From the absolute position, so it does not
  /// depend on where the block began.
  float fraction(int i) const noexcept {
    return static_cast<float>(positionInStride + i) * invStride;
  }
};

/// Cuts a block into runs and moves the grid along as it goes.
///
///     GridWalk walk(grid, frames);
///     GridRun run;
///     while (walk.next(run)) {
///       if (run.atGridPoint) { /* advance modulators by grid.stride */ }
///       for (int i = 0; i < run.frames; ++i) { /* pair.at(src, run.fraction(i)) */ }
///     }
///
/// The walk advances `grid.frameIndex` run by run, so a block that is walked
/// to the end has moved the grid by exactly its length and a consumer cannot
/// forget to — forgetting would freeze every grid point on the block boundary,
/// which is the once-per-block evaluation this file exists to prevent.
class GridWalk {
 public:
  GridWalk(ModGrid& grid, int frames) noexcept
      : grid_(grid),
        stride_(grid.stride > 0 ? grid.stride : 1),
        remaining_(frames > 0 ? frames : 0) {}

  bool next(GridRun& run) noexcept {
    if (remaining_ <= 0) return false;
    const std::uint64_t index = grid_.frameIndex;
    const int position = static_cast<int>(index % static_cast<std::uint64_t>(stride_));
    const int toBoundary = stride_ - position;
    const int frames = toBoundary < remaining_ ? toBoundary : remaining_;
    run.offset = offset_;
    run.frames = frames;
    run.atGridPoint = position == 0;
    run.frameIndex = index;
    run.positionInStride = position;
    run.invStride = 1.0f / static_cast<float>(stride_);
    grid_.frameIndex = index + static_cast<std::uint64_t>(frames);
    offset_ += frames;
    remaining_ -= frames;
    return true;
  }

 private:
  ModGrid& grid_;
  int stride_;
  int remaining_;
  int offset_ = 0;
};

/// The double buffer of §6.1: a voice's previous and current grid frames.
class ModPair {
 public:
  void reset() noexcept {
    previous_ = ModFrame{};
    current_ = ModFrame{};
  }

  /// At a grid point: the current frame becomes the previous one, and the
  /// frame returned is the one to fill with this grid point's values.
  ModFrame& advanceFrame() noexcept {
    previous_ = current_;
    return current_;
  }

  /// Source `source` at position `t` between the two frames.
  float at(int source, float t) const noexcept {
    const float from = previous_.sources[source];
    return from + (current_.sources[source] - from) * t;
  }

  const ModFrame& current() const noexcept { return current_; }
  const ModFrame& previous() const noexcept { return previous_; }

 private:
  ModFrame previous_{};
  ModFrame current_{};
};

/// §6.4's flush. State that decays towards zero on the control grid — a glide
/// residual, a smoothed depth — is tested once per grid point rather than per
/// sample, and anything under 1e-20 becomes an exact zero. The core's tests
/// are built without `-ffast-math`, so flush-to-zero is not in force where the
/// numbers are graded, and a denormal costs hundreds of cycles per sample on
/// some hardware and arrives silently.
inline float flushDenormal(float v) noexcept { return (v > -1e-20f && v < 1e-20f) ? 0.0f : v; }

}  // namespace mw::dsp::voice
