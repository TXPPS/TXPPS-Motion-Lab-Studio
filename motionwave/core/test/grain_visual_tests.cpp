// Motion Wave — what the grain engine shows. `lib-grain-engine.md` §5.7 and
// §8, rows GE-13, GE-17 and GE-18.
//
// Ledger cell U20 and CLAUDE.md's rule that a picture is drawn from the same
// evaluation the audio uses. These three rows are the executable form of it: a
// published position must be the position the render read from, a published id
// must survive the pool's swap-remove, and the publish rate must be counted in
// samples rather than in blocks.
#include "../dsp/grain/engine.h"
#include "harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <map>
#include <vector>

using namespace mw;
using namespace mw::dsp::grain;

namespace {

constexpr double kRate = 48000.0;
constexpr int kSourceCapacity = 1 << 17;

struct Bed {
  std::vector<float> samples = std::vector<float>(kSourceCapacity, 0.0f);
  int writeIndex = kSourceCapacity / 2;

  Bed() {
    std::uint32_t state = 0xC0FFEEu;
    for (int i = 0; i < kSourceCapacity; ++i) {
      state = state * 1664525u + 1013904223u;
      samples[static_cast<std::size_t>(i)] = static_cast<float>(state >> 8) / 8388608.0f - 1.0f;
    }
  }

  GrainSource view() const {
    GrainSource source;
    source.data = samples.data();
    source.capacity = kSourceCapacity;
    source.mask = kSourceCapacity - 1;
    source.writeIndex = writeIndex;
    source.sampleRate = kRate;
    return source;
  }
};

std::vector<float> arena(const EngineConfig& config) {
  return std::vector<float>(GrainEngine::arenaBytes(config, 1024) / sizeof(float) + 4, 0.0f);
}

}  // namespace

MW_TEST("GE-13: a grain's id survives the pool moving it") {
  // `GrainPool::retire` swaps the last active grain into the freed slot, so slot
  // indices change under a grain that did nothing. A visualiser keyed on a slot
  // index would teleport a particle every time an unrelated neighbour ended;
  // this is the case that catches it, and the mutation is to key the view on
  // the slot instead and watch it fail by name.
  EngineConfig config;
  config.poolSlots = 256;
  config.tier = Tier::Max;
  std::vector<float> storage = arena(config);
  GrainEngine engine;
  engine.prepare(kRate, 512, config, storage.data(), storage.size() * sizeof(float));
  ScheduleConfig schedule;
  // Dense and short, so retirements are frequent and the swap is exercised
  // rather than merely reachable.
  schedule.grainsPerSecond = 1500.0f;
  SpawnParams spawn;
  spawn.grainSeconds = 0.030f;
  spawn.lengthJitter = 0.40f;
  spawn.sprayAmount = 0.8f;
  engine.setSpawn(0, spawn);
  engine.setSchedule(0, schedule);

  Bed bed;
  std::vector<float> l(64, 0.0f);
  std::vector<float> r(64, 0.0f);
  GrainFrame frame;
  // Every id ever published, against the pitch it was published with. A pitch
  // is fixed at spawn (§3), so an id that changes hands shows up as one id
  // carrying two pitches.
  std::map<std::uint32_t, float> pitchForId;
  std::map<std::uint32_t, float> panForId;
  int changes = 0;
  int published = 0;
  for (int block = 0; block < 8000; ++block) {
    GrainSource source = bed.view();
    engine.process(source, l.data(), r.data(), 64);
    bed.writeIndex += 64;
    while (engine.takeFrame(&frame)) {
      for (int i = 0; i < frame.published; ++i) {
        const GrainView& view = frame.grains[i];
        ++published;
        auto pitch = pitchForId.find(view.id);
        if (pitch == pitchForId.end()) {
          pitchForId[view.id] = view.pitchRatio;
          panForId[view.id] = view.pan;
        } else if (pitch->second != view.pitchRatio || panForId[view.id] != view.pan) {
          ++changes;
        }
      }
    }
  }
  std::printf("    GE-13: %d views published across %zu distinct ids, %d identity changes\n",
              published, pitchForId.size(), changes);
  MW_EXPECT(pitchForId.size() > 10000);
  MW_EXPECT_EQ(changes, 0);
}

MW_TEST("GE-17: a published position is the position the render read from") {
  EngineConfig config;
  config.poolSlots = 256;
  config.tier = Tier::Max;
  std::vector<float> storage = arena(config);
  GrainEngine engine;
  engine.prepare(kRate, 512, config, storage.data(), storage.size() * sizeof(float));
  ScheduleConfig schedule;
  schedule.grainsPerSecond = 900.0f;
  SpawnParams spawn;
  spawn.grainSeconds = 0.080f;
  spawn.sprayAmount = 0.6f;
  engine.setSpawn(0, spawn);
  engine.setSchedule(0, schedule);

  Bed bed;
  std::vector<float> l(128, 0.0f);
  std::vector<float> r(128, 0.0f);
  GrainFrame frame;
  double worstSamples = 0.0;
  int checked = 0;
  int frames = 0;
  for (int block = 0; block < 600; ++block) {
    GrainSource source = bed.view();
    engine.process(source, l.data(), r.data(), 128);
    const int head = bed.writeIndex + 128;
    bed.writeIndex += 128;
    while (engine.takeFrame(&frame)) {
      ++frames;
      // The pool's own grains, read directly, against what was published.
      const GrainPool& pool = engine.pool();
      const Grain* grains = pool.active();
      const int live = pool.activeCount();
      MW_EXPECT_EQ(static_cast<int>(frame.live), live);
      MW_EXPECT_EQ(static_cast<int>(frame.published),
                   live < kPublishedGrains ? live : kPublishedGrains);
      for (int i = 0; i < frame.published; ++i) {
        const GrainView& view = frame.grains[i];
        for (int g = 0; g < live; ++g) {
          if (grains[g].id != view.id) continue;
          const double expected =
              (static_cast<double>(head) - grains[g].readPos) / kRate;
          const double error = std::fabs(static_cast<double>(view.positionSeconds) - expected) * kRate;
          worstSamples = std::max(worstSamples, error);
          ++checked;
          break;
        }
      }
    }
  }
  std::printf("    GE-17: %d views across %d frames; worst position error %.4f samples\n", checked,
              frames, worstSamples);
  MW_EXPECT(checked > 500);
  MW_EXPECT(worstSamples <= 1.0);
}

MW_TEST("GE-18: the publish rate is counted in samples, not in blocks") {
  // A rate that changes with block size is counting blocks. Sixty hertz at a
  // 64-frame block is 750 publishes a second to a screen that redraws sixty.
  const int blocks[2] = {64, 1024};
  for (int b = 0; b < 2; ++b) {
    EngineConfig config;
    config.poolSlots = 256;
    std::vector<float> storage = arena(config);
    GrainEngine engine;
    engine.prepare(kRate, 1024, config, storage.data(), storage.size() * sizeof(float));
    ScheduleConfig schedule;
    schedule.grainsPerSecond = 350.0f;
    SpawnParams spawn;
    engine.setSpawn(0, spawn);
    engine.setSchedule(0, schedule);

    Bed bed;
    std::vector<float> l(static_cast<std::size_t>(blocks[b]), 0.0f);
    std::vector<float> r(static_cast<std::size_t>(blocks[b]), 0.0f);
    GrainFrame frame;
    int taken = 0;
    const int total = static_cast<int>(kRate) * 10;
    for (int at = 0; at < total; at += blocks[b]) {
      GrainSource source = bed.view();
      engine.process(source, l.data(), r.data(), blocks[b]);
      bed.writeIndex += blocks[b];
      // Drained every block, as a UI at display rate would drain it — the ring
      // is four deep and a producer that outran the consumer would show up here
      // as a rate below sixty rather than above it.
      while (engine.takeFrame(&frame)) ++taken;
    }
    const double rate = static_cast<double>(taken) / 10.0;
    /*
     * **Sixty, or the block rate, whichever is lower — and the second half is
     * physics rather than slack.**
     *
     * The engine publishes from `process`, so it cannot publish more often than
     * the host calls it. At 1024 frames the audio thread runs 46.9 times a
     * second, and asking for sixty publishes would be asking for thirteen
     * callbacks that do not happen. Sixty *is* reached at 64 frames, where the
     * block rate is 750 — and that is the half of this row that does the work,
     * because an engine counting blocks instead of samples would publish 750
     * times a second there and pass nothing.
     */
    const double blockRate = kRate / static_cast<double>(blocks[b]);
    const double expected = std::min(60.0, blockRate);
    std::printf("    GE-18: block %4d — %.1f frames per second (block rate %.1f, expected %.1f)\n",
                blocks[b], rate, blockRate, expected);
    MW_EXPECT_NEAR(rate, expected, 1.0);
  }
}

MW_TEST_MAIN("grain-visual")
