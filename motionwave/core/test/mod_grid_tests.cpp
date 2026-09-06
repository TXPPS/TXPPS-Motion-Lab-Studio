// Motion Wave — the control-rate grid. `lib-voice-substrate.md` §4, §6.3, §8.
//
// VS-07 as the design states it: ten seconds of a sixteen-voice pattern at
// block sizes 16, 17, 64, 128 and 1024, and the peak difference against the
// 128 render is at most 6e−8 — half a float step. It is not nearly zero here;
// it is zero, because a grid point is an absolute frame and a sample's
// position inside the stride is computed from the absolute frame too, so the
// 17-frame render and the 128-frame render do the same arithmetic on the same
// numbers. The mutations that would make it a tolerance — evaluating at block
// starts, or measuring a sample's position from the run it happens to be in —
// are recorded below.
//
// Then the walk's own contract: runs never cross a grid point, a block that
// starts mid-stride gets a first run that is not a grid point, the grid moves
// by exactly the block, an empty block moves nothing, and a pair interpolates
// from its previous frame to its current one.
//
// Mutation-tested, each edit restored before the next:
//   modulators evaluated at block starts instead of grid points → red: VS-07,
//     "grid points are absolute", "fraction comes from the absolute frame" and
//     the stride-of-zero case.
//   a sample's fraction measured from its run rather than the absolute frame
//     → red: VS-07 and "fraction comes from the absolute frame" only.
//   runs allowed to cross grid points → red: VS-07 and the three walk cases.
//   the walk not moving the grid → red: VS-07, the two absolute-frame cases,
//     and the allocation case's non-vacuity check (nothing was ever modulated).
//   no interpolation, the current frame held across the run → red: the pair
//     case only. VS-07 stayed green, and should: a value held from an absolute
//     grid point is still the same in every split. Interpolation is a quality
//     claim, not a block-invariance one, and the pair case is what carries it.
//   flush threshold raised to 1e-10 → red: the flush case only.
#include "../dsp/voice/envelope.h"
#include "../dsp/voice/lfo.h"
#include "../dsp/voice/mod_grid.h"
#include "harness.h"
#include "rt_guard.h"

#include <cmath>
#include <cstdint>
#include <vector>

using namespace mw;
using namespace mw::dsp::voice;

namespace {

constexpr int kVoices = 16;
constexpr int kRate = 48000;
constexpr int kSeconds = 10;
constexpr int kSrcEnvelope = 0;
constexpr int kSrcLfo = 1;
/// The gate pattern repeats every 2.5 s; each voice plays a one-second note
/// starting 125 ms after the voice before it.
constexpr std::uint64_t kPatternFrames = 120000;
constexpr std::uint64_t kVoiceOffsetFrames = 6000;
constexpr std::uint64_t kNoteFrames = 48000;

struct Voice {
  Envelope env;
  Lfo lfo;
  ModPair pair;
  bool gate = false;
};

/// Sixteen voices with their own envelope times and LFO rates, gated by a
/// pattern decided from the **absolute** frame at every grid point, so every
/// block size sees the same notes at the same instants. Amplitude and pitch
/// are interpolated per sample from the pair and mixed into one channel.
void renderPattern(int block, int stride, std::vector<float>& out) {
  Voice voices[kVoices];
  for (int v = 0; v < kVoices; ++v) {
    const float f = static_cast<float>(v);
    EnvelopeShape shape;
    shape.count = 4;
    shape.sustainSegment = 2;
    shape.endSegment = 3;
    shape.segments[0] = {1.0f, 0.005f + 0.01f * f, SegmentCurve::TargetSeeking, 1.0f};
    shape.segments[1] = {0.6f, 0.05f + 0.02f * f, SegmentCurve::Exponential, 3.5f};
    shape.segments[2] = {0.6f, 0.0f, SegmentCurve::Linear, 1.0f};
    shape.segments[3] = {0.0f, 0.1f + 0.03f * f, SegmentCurve::Exponential, 3.5f};
    voices[v].env.prepare(kRate);
    voices[v].env.setShape(shape);
    LfoConfig config;
    config.wave = (v % 2) != 0 ? LfoWave::Sine : LfoWave::SampleHold;
    config.rateHz = 0.7f + 0.53f * f;
    config.retrigger = LfoRetrigger::Single;
    config.delaySeconds = 0.05f;
    config.fadeSeconds = 0.2f;
    voices[v].lfo.prepare(kRate, static_cast<std::uint64_t>(100 + v));
    voices[v].lfo.setConfig(config);
  }
  ModGrid grid;
  grid.stride = stride;
  const int total = kSeconds * kRate;
  out.assign(static_cast<std::size_t>(total), 0.0f);
  int done = 0;
  while (done < total) {
    const int frames = block < total - done ? block : total - done;
    GridWalk walk(grid, frames);
    GridRun run;
    while (walk.next(run)) {
      if (run.atGridPoint) {
        const std::uint64_t pos = run.frameIndex % kPatternFrames;
        for (int v = 0; v < kVoices; ++v) {
          const std::uint64_t start = static_cast<std::uint64_t>(v) * kVoiceOffsetFrames;
          const bool gate = pos >= start && pos < start + kNoteFrames;
          TriggerBus bus;
          bus.gate = gate;
          bus.single = gate && !voices[v].gate;
          bus.multi = bus.single;
          voices[v].gate = gate;
          ModFrame& frame = voices[v].pair.advanceFrame();
          frame.sources[kSrcEnvelope] = voices[v].env.advance(bus, stride);
          frame.sources[kSrcLfo] = voices[v].lfo.advance(bus, frame.sources, stride);
        }
      }
      for (int i = 0; i < run.frames; ++i) {
        const float t = run.fraction(i);
        float mix = 0.0f;
        for (int v = 0; v < kVoices; ++v) {
          const float amp = voices[v].pair.at(kSrcEnvelope, t);
          const float pitch = voices[v].pair.at(kSrcLfo, t);
          mix += amp * (1.0f + 0.1f * pitch);
        }
        out[static_cast<std::size_t>(done + run.offset + i)] = mix * (1.0f / 16.0f);
      }
    }
    done += frames;
  }
}

float peakDifference(const std::vector<float>& a, const std::vector<float>& b) {
  float worst = 0.0f;
  for (std::size_t i = 0; i < a.size() && i < b.size(); ++i) {
    const float d = std::fabs(a[i] - b[i]);
    if (d > worst) worst = d;
  }
  return worst;
}

}  // namespace

// ──────────────────────────────────────────────────────────────── VS-07

MW_TEST("VS-07 the grid produces the same samples at every block size") {
  std::vector<float> reference;
  renderPattern(128, 32, reference);
  // Non-vacuity: the render carries modulation. Notes rise past 0.3 of full
  // scale and fall back under 0.05, so a grid that froze would be caught.
  float highest = 0.0f;
  float lowest = 1.0f;
  for (const float s : reference) {
    if (s > highest) highest = s;
    if (s < lowest) lowest = s;
  }
  MW_EXPECT(highest > 0.3f);
  MW_EXPECT(lowest < 0.05f);
  const int blocks[4] = {16, 17, 64, 1024};
  for (const int block : blocks) {
    std::vector<float> render;
    renderPattern(block, 32, render);
    MW_EXPECT_EQ(static_cast<long long>(render.size()), static_cast<long long>(reference.size()));
    MW_EXPECT(peakDifference(render, reference) <= 6e-8f);
  }
}

// ─────────────────────────────────────────────────────────────── the walk

MW_TEST("grid points are absolute frames, not block starts") {
  ModGrid grid;
  grid.stride = 32;
  grid.frameIndex = 1000;
  GridWalk walk(grid, 100);
  GridRun run;
  std::vector<GridRun> runs;
  while (walk.next(run)) runs.push_back(run);
  // Frame 1000 is 8 into a stride: 24 frames to the grid point at 1024, then
  // 32, 32, and the 12 that are left.
  MW_EXPECT_EQ(static_cast<long long>(runs.size()), 4);
  MW_EXPECT_EQ(runs[0].offset, 0);
  MW_EXPECT_EQ(runs[0].frames, 24);
  MW_EXPECT(!runs[0].atGridPoint);
  MW_EXPECT_EQ(runs[0].positionInStride, 8);
  MW_EXPECT_EQ(static_cast<long long>(runs[0].frameIndex), 1000);
  MW_EXPECT_EQ(runs[1].offset, 24);
  MW_EXPECT_EQ(runs[1].frames, 32);
  MW_EXPECT(runs[1].atGridPoint);
  MW_EXPECT_EQ(static_cast<long long>(runs[1].frameIndex), 1024);
  MW_EXPECT_EQ(runs[2].offset, 56);
  MW_EXPECT(runs[2].atGridPoint);
  MW_EXPECT_EQ(runs[3].offset, 88);
  MW_EXPECT_EQ(runs[3].frames, 12);
  MW_EXPECT(runs[3].atGridPoint);
  MW_EXPECT_EQ(static_cast<long long>(grid.frameIndex), 1100);
}

MW_TEST("a sample's fraction comes from the absolute frame, not from its run") {
  // The same absolute sample, reached two ways: as the 31st sample of a
  // 128-frame block from frame 0, and as the first sample of a 17-frame block
  // from frame 30. The fractions must be the same bits.
  ModGrid wide;
  GridWalk wideWalk(wide, 128);
  GridRun wideRun;
  MW_EXPECT(wideWalk.next(wideRun));
  MW_EXPECT_EQ(wideRun.frames, 32);

  ModGrid narrow;
  narrow.frameIndex = 30;
  GridWalk narrowWalk(narrow, 17);
  GridRun first;
  GridRun second;
  MW_EXPECT(narrowWalk.next(first));
  MW_EXPECT(narrowWalk.next(second));
  MW_EXPECT_EQ(first.frames, 2);
  MW_EXPECT(!first.atGridPoint);
  MW_EXPECT(first.fraction(0) == wideRun.fraction(30));
  MW_EXPECT(first.fraction(1) == wideRun.fraction(31));
  MW_EXPECT_EQ(second.frames, 15);
  MW_EXPECT(second.atGridPoint);
  MW_EXPECT(second.fraction(0) == 0.0f);
  MW_EXPECT(second.fraction(14) == 14.0f / 32.0f);
  MW_EXPECT(wideRun.fraction(31) < 1.0f);
  GridRun third;
  MW_EXPECT(!narrowWalk.next(third));
  MW_EXPECT_EQ(static_cast<long long>(narrow.frameIndex), 47);
}

MW_TEST("an empty block moves nothing and a stride of zero is a stride of one") {
  ModGrid grid;
  grid.frameIndex = 77;
  GridWalk none(grid, 0);
  GridRun run;
  MW_EXPECT(!none.next(run));
  GridWalk negative(grid, -5);
  MW_EXPECT(!negative.next(run));
  MW_EXPECT_EQ(static_cast<long long>(grid.frameIndex), 77);

  ModGrid degenerate;
  degenerate.stride = 0;
  GridWalk walk(degenerate, 3);
  int runs = 0;
  while (walk.next(run)) {
    ++runs;
    MW_EXPECT(run.atGridPoint);
    MW_EXPECT_EQ(run.frames, 1);
  }
  MW_EXPECT_EQ(runs, 3);
}

// ─────────────────────────────────────────────────────────────── the pair

MW_TEST("a pair interpolates from its previous frame to its current one") {
  ModPair pair;
  ModFrame& first = pair.advanceFrame();
  first.sources[2] = 1.0f;
  ModFrame& second = pair.advanceFrame();
  second.sources[2] = 3.0f;
  MW_EXPECT(pair.previous().sources[2] == 1.0f);
  MW_EXPECT(pair.current().sources[2] == 3.0f);
  MW_EXPECT(pair.at(2, 0.0f) == 1.0f);
  MW_EXPECT(pair.at(2, 0.5f) == 2.0f);
  MW_EXPECT(pair.at(2, 1.0f) == 3.0f);
  // An untouched source is zero on both sides, not whatever was in memory.
  MW_EXPECT(pair.at(7, 0.5f) == 0.0f);
  pair.reset();
  MW_EXPECT(pair.at(2, 0.5f) == 0.0f);
}

MW_TEST("flushDenormal zeroes what is below 1e-20 and leaves a signal alone") {
  MW_EXPECT(flushDenormal(1e-40f) == 0.0f);
  MW_EXPECT(flushDenormal(-1e-40f) == 0.0f);
  MW_EXPECT(flushDenormal(1e-30f) == 0.0f);
  MW_EXPECT(flushDenormal(1e-19f) == 1e-19f);
  MW_EXPECT(flushDenormal(0.5f) == 0.5f);
  MW_EXPECT(flushDenormal(-0.5f) == -0.5f);
  MW_EXPECT(flushDenormal(0.0f) == 0.0f);
}

// ───────────────────────────────────────────────── real-time safety, §6.2

MW_TEST("nothing on the audio path allocates") {
  ModGrid grid;
  grid.stride = 32;
  ModPair pairs[kVoices];
  mw::test::RtGuard guard;
  float sink = 0.0f;
  const int blocks[6] = {16, 17, 64, 128, 1024, 3};
  for (int b = 0; b < 600; ++b) {
    GridWalk walk(grid, blocks[b % 6]);
    GridRun run;
    while (walk.next(run)) {
      if (run.atGridPoint) {
        for (ModPair& pair : pairs) {
          ModFrame& frame = pair.advanceFrame();
          frame.sources[0] = static_cast<float>(run.frameIndex % 97) * 0.01f;
        }
      }
      for (int i = 0; i < run.frames; ++i) {
        for (const ModPair& pair : pairs) sink += flushDenormal(pair.at(0, run.fraction(i)));
      }
    }
  }
  MW_EXPECT_EQ(static_cast<int>(guard.allocations()), 0);
  MW_EXPECT(sink > 0.0f);
}

MW_TEST("the RtGuard is watching rather than asleep") {
  std::vector<float> scratch;
  mw::test::RtGuard guard;
  scratch.resize(1024);
  MW_EXPECT(guard.allocations() > 0);
}

MW_TEST_MAIN("mod grid")
