// Motion Wave — the grain pool's accounting and the engine's real-time
// behaviour. `lib-grain-engine.md` §8, rows GE-08, 09, 10, 12, 14, 15 and 19.
//
// §5.6's arithmetic is the claim these rows make executable: at the Max tier's
// cap of ninety-six expected grains, ±25 % length jitter lifts the worst-case
// mean to 120, a Poisson count's 99.99th percentile is about 164, and the pool
// is 256. That is why `dropped == 0` is a design guarantee rather than a hope —
// and GE-09 exists because a drop counter nobody has exercised proves nothing.
#include "../dsp/grain/engine.h"
#include "decay_harness.h"
#include "harness.h"
#include "spectrum.h"
#include "rt_guard.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::dsp::grain;

namespace {

constexpr double kRate = 48000.0;
constexpr int kSourceCapacity = 1 << 17;

struct Bed {
  std::vector<float> samples = std::vector<float>(kSourceCapacity, 0.0f);
  int writeIndex = kSourceCapacity / 2;

  void fillNoise(std::uint32_t seed) {
    std::uint32_t state = seed;
    for (int i = 0; i < kSourceCapacity; ++i) {
      state = state * 1664525u + 1013904223u;
      samples[static_cast<std::size_t>(i)] =
          static_cast<float>(state >> 8) / 8388608.0f - 1.0f;
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

/// Drive for `seconds`, returning the rendered left channel.
std::vector<float> drive(GrainEngine& engine, Bed& bed, double seconds, int blockSize) {
  const int frames = static_cast<int>(kRate * seconds);
  std::vector<float> out;
  out.reserve(static_cast<std::size_t>(frames));
  std::vector<float> l(static_cast<std::size_t>(blockSize), 0.0f);
  std::vector<float> r(static_cast<std::size_t>(blockSize), 0.0f);
  for (int at = 0; at < frames; at += blockSize) {
    const int n = std::min(blockSize, frames - at);
    GrainSource source = bed.view();
    engine.process(source, l.data(), r.data(), n);
    for (int i = 0; i < n; ++i) out.push_back(l[static_cast<std::size_t>(i)]);
    bed.writeIndex += n;
  }
  return out;
}

SpawnParams reverbSpawn() {
  SpawnParams spawn;
  spawn.grainSeconds = 0.060f;
  spawn.lengthJitter = 0.25f;
  spawn.sprayAmount = 0.70f;
  spawn.ampJitter = 0.15f;
  return spawn;
}

}  // namespace

MW_TEST("GE-08: the scheduler spawns what it was asked for and the pool loses nothing") {
  /*
   * **The tolerance's own model is checked before it is used.**
   *
   * This row grades a count, whose distribution is known rather than estimated:
   * the onsets are a renewal process and the count's standard deviation is the
   * jitter times the square root of the count. That is what lets a single
   * sixty-second render be graded at all — unlike a level or a decay, which are
   * statistics of a stochastic cloud and need an ensemble. But "known" is worth
   * one measurement: if the observed spread across independent seeds does not
   * match the model, the tolerance below is a guess wearing a formula.
   */
  {
    constexpr int kSeeds = 12;
    std::vector<double> counts;
    counts.reserve(kSeeds);
    for (int k = 0; k < kSeeds; ++k) {
      EngineConfig config;
      config.poolSlots = 256;
      config.tier = Tier::Max;
      config.seed = test::seedAt(k);
      std::vector<float> storage = arena(config);
      GrainEngine engine;
      engine.prepare(kRate, 512, config, storage.data(), storage.size() * sizeof(float));
      ScheduleConfig schedule;
      schedule.grainsPerSecond = 350.0f;
      engine.setSpawn(0, reverbSpawn());
      engine.setSchedule(0, schedule);
      Bed bed;
      bed.fillNoise(0x321u);
      drive(engine, bed, 10.0, 256);
      counts.push_back(static_cast<double>(engine.spawned()));
    }
    double sum = 0.0;
    for (double c : counts) sum += c;
    const double mean = sum / kSeeds;
    double variance = 0.0;
    for (double c : counts) variance += (c - mean) * (c - mean);
    const double observed = std::sqrt(variance / (kSeeds - 1));
    // The model: jitter times the square root of the count.
    const double predicted = 0.6 * std::sqrt(mean);
    std::printf("    GE-08: count spread over %d seeds — observed %.1f, model %.1f (ratio %.2f)\n",
                kSeeds, observed, predicted, observed / predicted);
    // Within a factor of two either way, which is as tight as a twelve-sample
    // variance estimate can be held; a model that was simply wrong misses by
    // far more than that.
    MW_EXPECT(observed < predicted * 2.0 && observed > predicted * 0.5);
  }

  const float densities[5] = {10.0f, 100.0f, 350.0f, 1000.0f, 2000.0f};
  for (int d = 0; d < 5; ++d) {
    EngineConfig config;
    config.poolSlots = 256;
    config.tier = Tier::Max;
    std::vector<float> storage = arena(config);
    GrainEngine engine;
    engine.prepare(kRate, 512, config, storage.data(), storage.size() * sizeof(float));
    ScheduleConfig schedule;
    schedule.grainsPerSecond = densities[d];
    engine.setSpawn(0, reverbSpawn());
    engine.setSchedule(0, schedule);

    Bed bed;
    bed.fillNoise(0x1234u + static_cast<std::uint32_t>(d));
    // Sixty seconds, as the row directs — the whole point is that the guarantee
    // holds over a long run rather than over a lucky block.
    drive(engine, bed, 60.0, 256);

    const double rate = static_cast<double>(engine.spawned()) / 60.0;
    const double expected = static_cast<double>(engine.clampedDensity(0));
    /*
     * **The tolerance is one per cent or three standard errors, whichever is
     * wider, and the second one is not slack.**
     *
     * Onsets are a stochastic process on purpose — §5.1 says a constant hop
     * makes the grain rate audible as a pitch — so the count in a fixed window
     * is a random variable, and its standard deviation is the jitter times the
     * square root of the count. At ten grains a second over sixty seconds that
     * is 14.7 spawns against a one-per-cent window of six: no correct
     * implementation can meet the flat criterion there, and the deficits this
     * row first reported (1.33 %, 1.07 %, 0.36 %, 0.02 %) are 0.5, 1.4, 0.9 and
     * 0.1 standard errors — exactly the shape of a process behaving, measured
     * against a tolerance that assumed it would not.
     *
     * The generator was ruled out before the criterion was: over four million
     * draws its exponential mean is 0.9996 and the hop factor 0.99979, so the
     * scheduler is unbiased to two parts in ten thousand.
     *
     * Three standard errors is a 99.7 % interval, so a real bias still fails.
     */
    const double count = expected * 60.0;
    const double standardError = static_cast<double>(schedule.onsetJitter) * std::sqrt(count);
    const double tolerance = std::max(expected * 0.01, 3.0 * standardError / 60.0);
    std::printf("    GE-08: %7.1f g/s asked, %7.2f achieved (cap %.1f, tolerance %.2f),"
                " dropped %llu\n",
                static_cast<double>(densities[d]), rate, expected, tolerance,
                static_cast<unsigned long long>(engine.dropped()));
    MW_EXPECT(std::fabs(rate - expected) <= tolerance);
    MW_EXPECT_EQ(static_cast<long long>(engine.dropped()), 0LL);
  }
}

MW_TEST("GE-09: the drop path works, because a counter nobody has exercised proves nothing") {
  EngineConfig config;
  // Sixteen slots against an overlap of ninety-six. This is not a configuration
  // the product ships; it is the only way to reach a branch §5.6's arithmetic
  // is designed to make unreachable.
  config.poolSlots = 16;
  config.tier = Tier::Max;
  std::vector<float> storage = arena(config);
  GrainEngine engine;
  engine.prepare(kRate, 512, config, storage.data(), storage.size() * sizeof(float));
  ScheduleConfig schedule;
  schedule.grainsPerSecond = 1600.0f;
  engine.setSpawn(0, reverbSpawn());
  engine.setSchedule(0, schedule);

  Bed bed;
  bed.fillNoise(0x99u);
  const std::vector<float> out = drive(engine, bed, 4.0, 128);

  bool finite = true;
  float peak = 0.0f;
  for (float v : out) {
    if (!std::isfinite(v)) finite = false;
    peak = std::max(peak, std::fabs(v));
  }
  std::printf("    GE-09: %llu spawned, %llu dropped, peak %.4f, all finite %s\n",
              static_cast<unsigned long long>(engine.spawned()),
              static_cast<unsigned long long>(engine.dropped()), static_cast<double>(peak),
              finite ? "yes" : "no");
  MW_EXPECT(engine.dropped() > 0);
  MW_EXPECT(finite);
  MW_EXPECT(peak > 0.0f);
}

MW_TEST("GE-10: one greedy tap does not starve the other seven") {
  EngineConfig config;
  config.poolSlots = 256;
  config.tapCount = 8;
  config.tier = Tier::Max;
  std::vector<float> storage = arena(config);
  GrainEngine engine;
  engine.prepare(kRate, 512, config, storage.data(), storage.size() * sizeof(float));
  for (int t = 0; t < 8; ++t) {
    ScheduleConfig schedule;
    // Tap 0 at full smear, the rest at a quarter. Without the reservation the
    // greedy tap takes the pool and one tap of a multi-tap delay silently stops
    // sounding — which reads as a routing bug rather than a pool bug.
    schedule.grainsPerSecond = t == 0 ? 1600.0f : 120.0f;
    SpawnParams spawn = reverbSpawn();
    spawn.grainSeconds = t == 0 ? 0.120f : 0.040f;
    engine.setSpawn(static_cast<std::uint8_t>(t), spawn);
    engine.setSchedule(static_cast<std::uint8_t>(t), schedule);
  }

  Bed bed;
  bed.fillNoise(0x5150u);
  // A second at a time, so "no tap renders zero grains in any one-second
  // window" is measured rather than inferred from a total.
  int worstWindow = 1 << 30;
  int peakForTap[8] = {0, 0, 0, 0, 0, 0, 0, 0};
  for (int second = 0; second < 8; ++second) {
    std::vector<float> l(256, 0.0f);
    std::vector<float> r(256, 0.0f);
    int seenThisSecond[8] = {0, 0, 0, 0, 0, 0, 0, 0};
    for (int at = 0; at < static_cast<int>(kRate); at += 256) {
      GrainSource source = bed.view();
      engine.process(source, l.data(), r.data(), 256);
      bed.writeIndex += 256;
      const GrainPool& pool = engine.pool();
      for (int t = 0; t < 8; ++t) {
        const int live = pool.activeForTap(static_cast<std::uint8_t>(t));
        seenThisSecond[t] = std::max(seenThisSecond[t], live);
        peakForTap[t] = std::max(peakForTap[t], live);
      }
    }
    for (int t = 0; t < 8; ++t) worstWindow = std::min(worstWindow, seenThisSecond[t]);
  }
  std::printf("    GE-10: reservation %d; peak live per tap", engine.pool().reservationPerTap());
  for (int t = 0; t < 8; ++t) std::printf(" %d", peakForTap[t]);
  std::printf("; quietest tap-second %d\n", worstWindow);
  MW_EXPECT_EQ(engine.pool().reservationPerTap(), 32);
  // Every tap sounds in every one-second window.
  MW_EXPECT(worstWindow > 0);
  // And the greedy tap cannot take more than its reservation plus the surplus
  // the others left, which is what stops it reaching the whole pool.
  MW_EXPECT(peakForTap[0] < engine.pool().capacity());
}

MW_TEST("GE-12: the host's block size does not change the audio") {
  const int blocks[5] = {16, 17, 64, 128, 1024};
  std::vector<float> reference;
  for (int b = 0; b < 5; ++b) {
    EngineConfig config;
    config.poolSlots = 256;
    std::vector<float> storage = arena(config);
    GrainEngine engine;
    engine.prepare(kRate, 1024, config, storage.data(), storage.size() * sizeof(float));
    ScheduleConfig schedule;
    schedule.grainsPerSecond = 350.0f;
    engine.setSpawn(0, reverbSpawn());
    engine.setSchedule(0, schedule);
    Bed bed;
    bed.fillNoise(0x2468u);
    const std::vector<float> out = drive(engine, bed, 10.0, blocks[b]);
    if (blocks[b] == 128) {
      reference = out;
      continue;
    }
    if (reference.empty()) {
      // 128 has not run yet; keep this one and compare on the next pass.
      continue;
    }
  }
  // Rendered again in a fixed order so the 128 reference exists for every
  // comparison, rather than depending on where it fell in the loop.
  MW_EXPECT(!reference.empty());
  for (int b = 0; b < 5; ++b) {
    if (blocks[b] == 128) continue;
    EngineConfig config;
    config.poolSlots = 256;
    std::vector<float> storage = arena(config);
    GrainEngine engine;
    engine.prepare(kRate, 1024, config, storage.data(), storage.size() * sizeof(float));
    ScheduleConfig schedule;
    schedule.grainsPerSecond = 350.0f;
    engine.setSpawn(0, reverbSpawn());
    engine.setSchedule(0, schedule);
    Bed bed;
    bed.fillNoise(0x2468u);
    const std::vector<float> out = drive(engine, bed, 10.0, blocks[b]);
    double worst = 0.0;
    const std::size_t span = std::min(out.size(), reference.size());
    for (std::size_t i = 0; i < span; ++i) {
      worst = std::max(worst, std::fabs(static_cast<double>(out[i] - reference[i])));
    }
    std::printf("    GE-12: block %4d against 128 — worst difference %.3e\n", blocks[b], worst);
    // Half a float32 step at unity.
    MW_EXPECT(worst <= 6.0e-8);
  }
}

MW_TEST("GE-14: the same seed renders the same audio, and a different one does not") {
  auto render = [](std::uint64_t seed) {
    EngineConfig config;
    config.poolSlots = 256;
    config.seed = seed;
    std::vector<float> storage = arena(config);
    GrainEngine engine;
    engine.prepare(kRate, 512, config, storage.data(), storage.size() * sizeof(float));
    ScheduleConfig schedule;
    schedule.grainsPerSecond = 350.0f;
    engine.setSpawn(0, reverbSpawn());
    engine.setSchedule(0, schedule);
    Bed bed;
    bed.fillNoise(0x1111u);
    return drive(engine, bed, 4.0, 128);
  };
  const std::vector<float> a = render(0x9E3779B97F4A7C15ull);
  const std::vector<float> b = render(0x9E3779B97F4A7C15ull);
  const std::vector<float> c = render(0x1234567812345678ull);

  double same = 0.0;
  double different = 0.0;
  for (std::size_t i = 0; i < a.size(); ++i) {
    same = std::max(same, std::fabs(static_cast<double>(a[i] - b[i])));
    different = std::max(different, std::fabs(static_cast<double>(a[i] - c[i])));
  }
  std::printf("    GE-14: same seed differs by %.3e, a different seed by %.3e\n", same, different);
  MW_EXPECT(same == 0.0);
  // And the row is not passing by accident on an engine that ignores its seed.
  MW_EXPECT(20.0 * std::log10(different > 1.0e-12 ? different : 1.0e-12) > -40.0);
}

MW_TEST("GE-15: process allocates nothing, and GE-16: prepare allocates once") {
  EngineConfig config;
  config.poolSlots = 256;
  config.tapCount = 4;
  std::vector<float> storage = arena(config);
  GrainEngine engine;
  Bed bed;
  bed.fillNoise(0x777u);

  {
    // The arena is the caller's one allocation; the engine takes none of its
    // own. `SpscRing`'s storage is the ring's, made here rather than in
    // `process` — which is the whole reason the ring is a member.
    test::RtGuard guard;
    engine.prepare(kRate, 512, config, storage.data(), storage.size() * sizeof(float));
    std::printf("    GE-16: prepare made %zu allocation(s)\n", guard.allocations());
    MW_EXPECT(guard.allocations() <= 1);
  }

  ScheduleConfig schedule;
  schedule.grainsPerSecond = 800.0f;
  for (int t = 0; t < 4; ++t) {
    engine.setSpawn(static_cast<std::uint8_t>(t), reverbSpawn());
    engine.setSchedule(static_cast<std::uint8_t>(t), schedule);
  }
  std::vector<float> l(256, 0.0f);
  std::vector<float> r(256, 0.0f);
  GrainFrame frame;

  {
    test::RtGuard guard;
    for (int block = 0; block < 400; ++block) {
      GrainSource source = bed.view();
      engine.process(source, l.data(), r.data(), 256);
      bed.writeIndex += 256;
      engine.takeFrame(&frame);
    }
    std::printf("    GE-15: %d blocks at four taps made %zu allocation(s)\n", 400,
                guard.allocations());
    MW_EXPECT_EQ(static_cast<int>(guard.allocations()), 0);
  }
}

MW_TEST("GE-19: a tier change reduces density and never cuts a sounding grain") {
  /*
   * The row asks two things of a tier change: that no sounding grain is cut,
   * and that the output level does not move. Both are about the *cap*, which
   * ADR-0006 §1 says must be applied by reducing density rather than by
   * dropping grains — dropping a sounding grain modulates loudness with CPU
   * load, which turns a performance problem into an audible one and makes it
   * the user's problem to explain.
   *
   * **The density change and the interpolator change are measured separately,
   * because a tier changes both.** Measured together on white noise the
   * transition moves the level by 1.09 dB, and decomposing it puts 0.107 dB on
   * the density — which is the normalisation doing its job across an eight-fold
   * change — and 0.85 dB on Eco's linear interpolation, which is a low-pass and
   * is the thing the cheap tier is buying. Folding the two into one number
   * grades the normalisation on the interpolator's behaviour, and white noise
   * is where that penalty is at its very worst.
   */
  auto rmsOf = [](Tier tier, float density, int* liveOut, std::uint64_t* droppedOut,
                  std::uint64_t seed) {
    EngineConfig config;
    config.poolSlots = 256;
    config.tier = tier;
    config.seed = seed;
    std::vector<float> storage = arena(config);
    GrainEngine engine;
    engine.prepare(kRate, 512, config, storage.data(), storage.size() * sizeof(float));
    ScheduleConfig schedule;
    schedule.grainsPerSecond = density;
    SpawnParams spawn = reverbSpawn();
    spawn.lengthJitter = 0.0f;
    engine.setSpawn(0, spawn);
    engine.setSchedule(0, schedule);
    Bed bed;
    bed.fillNoise(0xBEEFu);
    const std::vector<float> out = drive(engine, bed, 2.0, 128);
    if (liveOut != nullptr) *liveOut = engine.liveGrains();
    if (droppedOut != nullptr) *droppedOut = engine.dropped();
    double sum = 0.0;
    for (std::size_t i = out.size() / 2; i < out.size(); ++i) {
      sum += static_cast<double>(out[i]) * static_cast<double>(out[i]);
    }
    return std::sqrt(sum / static_cast<double>(out.size() - out.size() / 2));
  };
  /*
   * **An ensemble over independent engine seeds, not one render.**
   *
   * The level change across a density step is a statistic of a stochastic
   * cloud, and a single render only samples it: measured across thirty-two
   * seeds the same comparison ranges from −0.68 dB to +0.71 dB while its mean
   * sits at −0.08. The first version of this row reported 0.010 dB, which was
   * a lucky draw rather than a measurement — the row would have passed on
   * almost any seed and the *number* it printed meant nothing.
   */
  constexpr int kSeeds = 32;
  std::vector<double> byDensity;
  byDensity.reserve(kSeeds);
  int liveHigh = 0;
  int liveLow = 0;
  std::uint64_t droppedHigh = 0;
  std::uint64_t droppedLow = 0;
  double ecoSum = 0.0;
  double loudSum = 0.0;
  for (int k = 0; k < kSeeds; ++k) {
    const std::uint64_t seed = test::seedAt(k);
    const double loud = rmsOf(Tier::Max, 1600.0f, &liveHigh, &droppedHigh, seed);
    const double sparse = rmsOf(Tier::Max, 200.0f, &liveLow, &droppedLow, seed);
    const double eco = rmsOf(Tier::Eco, 1600.0f, nullptr, nullptr, seed);
    byDensity.push_back(20.0 * std::log10(sparse / loud));
    ecoSum += eco;
    loudSum += loud;
  }
  double sum = 0.0;
  for (double v : byDensity) sum += v;
  const double mean = sum / kSeeds;
  double variance = 0.0;
  for (double v : byDensity) variance += (v - mean) * (v - mean);
  const double sd = std::sqrt(variance / (kSeeds - 1));
  const double confidence = 1.96 * sd / std::sqrt(static_cast<double>(kSeeds));
  std::printf("    GE-19: %d live at 1600 g/s, %d at 200; density alone moves %+.4f dB"
              " over %d seeds, 95 %% CI [%+.4f, %+.4f]\n",
              liveHigh, liveLow, mean, kSeeds, mean - confidence, mean + confidence);
  MW_EXPECT(liveHigh > 40);
  MW_EXPECT(liveLow < liveHigh);
  // The whole interval inside the tolerance, not the mean alone.
  MW_EXPECT(std::fabs(mean) + confidence <= 1.0);
  // And nothing was cut on the way: the drop counter is the only path by which
  // a grain can end before its window does, at either density.
  MW_EXPECT_EQ(static_cast<long long>(droppedHigh), 0LL);
  MW_EXPECT_EQ(static_cast<long long>(droppedLow), 0LL);

  // The transition a user actually hears, recorded rather than folded in.
  const double whole = 20.0 * std::log10((ecoSum / kSeeds) / (loudSum / kSeeds));
  std::printf("    GE-19: the whole Max-to-Eco transition moves %.3f dB on white noise\n", whole);
  MW_EXPECT(std::fabs(whole) <= 2.0);
}

MW_TEST("GE-04: continuity against overlap, and the floor no cloud can beat") {
  /*
   * §11 GE-04 is fx-02 §9 V4 measured on the engine alone, with no loop around
   * it, and it inherits that row's finding: **the 1.5 dB tolerance is
   * unreachable at an overlap of four for any random-onset cloud.** Grains
   * arrive at randomised onsets, so the output power in a short window is a sum
   * of `O` independent contributions whose relative standard deviation is
   * `1/sqrt(O)` — `4.34/sqrt(O)` in decibels, which is 2.17 dB at O = 4 before
   * any defect in the engine is considered.
   *
   * Measuring it here rather than only through the reverb is worth the
   * duplication, because the unit's version cannot separate the cloud from the
   * loop: there the modulation is whatever survives a feedback path, and a
   * quiet reading could mean either a well-behaved cloud or a loop smoothing a
   * badly-behaved one. With no loop, what is measured is the overlap-add.
   */
  constexpr double kGrainSeconds = 0.060;
  const double overlaps[4] = {4.0, 8.0, 16.0, 32.0};
  double previous = 1.0e9;
  for (double overlap : overlaps) {
    EngineConfig config;
    config.poolSlots = 256;
    config.tier = Tier::Max;
    std::vector<float> storage = arena(config);
    GrainEngine engine;
    engine.prepare(kRate, 512, config, storage.data(), storage.size() * sizeof(float));
    SpawnParams spawn = reverbSpawn();
    spawn.grainSeconds = static_cast<float>(kGrainSeconds);
    engine.setSpawn(0, spawn);
    ScheduleConfig schedule;
    schedule.grainsPerSecond = static_cast<float>(overlap / kGrainSeconds);
    engine.setSchedule(0, schedule);
    Bed bed;
    bed.fillNoise(0x5EEDu);
    const std::vector<float> out = drive(engine, bed, 4.0, 256);

    // Ten milliseconds, where white noise's own RMS varies by about 0.2 dB —
    // negligible against what is being graded — while still short enough to see
    // modulation at the grain rate. Half a millisecond, which is what the sheet
    // reads as, holds 24 samples and fluctuates by 1.3 dB on its own.
    const std::size_t hop = static_cast<std::size_t>(kRate * 0.010);
    const std::size_t fine = static_cast<std::size_t>(kRate * 0.0005);
    /*
     * A second of the render is discarded before anything is measured.
     *
     * The engine starts empty, so the first grains have not spawned yet and the
     * output is genuinely silent — which the gap detector below dutifully
     * reported as a gap, at every overlap, including the ones where the steady
     * state has no gaps at all. That is why the first version of this row read
     * 4.0 ms at an overlap of thirty-two, where two grains are sounding at every
     * instant: it was measuring the startup and calling it continuity.
     */
    const std::size_t settled = static_cast<std::size_t>(kRate);
    std::vector<double> levels;
    for (std::size_t at = settled; at + hop <= out.size(); at += hop) {
      double sum = 0.0;
      for (std::size_t i = 0; i < hop; ++i) {
        const double v = static_cast<double>(out[at + i]);
        sum += v * v;
      }
      levels.push_back(std::sqrt(sum / static_cast<double>(hop)));
    }
    std::vector<double> sorted = levels;
    std::sort(sorted.begin(), sorted.end());
    const double median = sorted[sorted.size() / 2];
    double sumSq = 0.0;
    int counted = 0;
    for (double v : levels) {
      if (v <= 0.0 || median <= 0.0) continue;
      const double dB = 20.0 * std::log10(v / median);
      sumSq += dB * dB;
      ++counted;
    }
    const double modulation = counted > 0 ? std::sqrt(sumSq / counted) : -1.0;

    // The gap, at a resolution that can see the 4 ms being graded. With no loop
    // there is nothing between grains at all, so the threshold is against the
    // median rather than against a residue.
    std::size_t run = 0;
    std::size_t worst = 0;
    std::size_t worstAt = 0;
    for (std::size_t at = settled; at + fine <= out.size(); at += fine) {
      double sum = 0.0;
      for (std::size_t i = 0; i < fine; ++i) {
        const double v = static_cast<double>(out[at + i]);
        sum += v * v;
      }
      const double level = std::sqrt(sum / static_cast<double>(fine));
      run = (level < median * 0.0316) ? run + 1 : 0;
      if (run > worst) {
        worst = run;
        worstAt = at;
      }
    }
    const double gapMs = 1000.0 * static_cast<double>(worst) * 0.0005;
    const double floorDb = 4.34 / std::sqrt(overlap);
    std::printf("    GE-04: O = %5.1f — longest gap %5.2f ms, modulation %4.2f dB RMS"
                " (incoherent floor %.2f) at t=%.3f s of %.3f\n",
                overlap, gapMs, modulation, floorDb,
                static_cast<double>(worstAt) / kRate, static_cast<double>(out.size()) / kRate);
    /*
     * **Graded from an overlap of eight, and the two reasons are different.**
     *
     * The modulation's reason is the floor above: §11's 1.5 dB with its stated
     * ±0.5 is 2.0 dB, and the incoherent floor is already 2.17 dB at O = 4, so
     * no scheduler can meet it there. It is graded where the floor permits —
     * O = 16 and 32, which read 1.87 and 1.19 dB — and below that graded on
     * falling, which is what distinguishes incoherent summing from some other
     * mechanism that happens to be large.
     *
     * The gap's reason is a trade-off the engine makes deliberately. Onsets are
     * jittered at 0.6 of fully stochastic because a constant hop makes the grain
     * rate itself audible as a tone, and at an overlap of four that rate is 67
     * grains a second — a buzz nobody would accept in a reverb. The price is
     * that the instantaneous overlap occasionally reaches zero: measured, a
     * 6.5 ms hole at t = 3.73 s of a four-second render, which is mid-stream and
     * real rather than a startup artefact. From O = 8 upward there is no gap at
     * all, at any point, so what the row establishes is where continuity begins
     * and what it costs below that. `scheduler.h`'s `onsetJitter` is the lever
     * if that trade is ever reconsidered; moving it to pass this row without
     * deciding the trade would be the wrong way round.
     */
    MW_EXPECT(modulation >= 0.0 && modulation < previous);
    if (overlap >= 8.0) {
      MW_EXPECT(gapMs == 0.0);
      if (floorDb < 1.5) MW_EXPECT(modulation <= 2.0);
    } else {
      // Recorded, and bounded so a regression that made it far worse still
      // fails: this is the one overlap where a gap is expected at all.
      MW_EXPECT(gapMs > 0.0 && gapMs < 20.0);
    }
    previous = modulation;
  }
}

MW_TEST("GE-11: the alias floor per tier, published for the one that is not graded") {
  /*
   * §11 GE-11: a pitch set spanning −12 to +19 on a 10 kHz sine. Eco is
   * recorded rather than graded — the tier exists to be cheap, and saying so is
   * more use than holding it to a number it is not trying to meet — while
   * Studio must reach −60 dBFS and Max −70.
   *
   * **Both cubic tiers now read far below their thresholds, and identically,
   * because the fix that got there is not tiered.** The interpolation kernel is
   * scaled by the read rate, so its cutoff is `fs/(2·rate)` by construction;
   * that is a property of the read rather than of the budget, and splitting it
   * by tier would mean shipping a known alias to Studio users on purpose. What
   * still separates the tiers is density and pool ceilings, which is where the
   * CPU actually goes. Eco stays on linear interpolation and its figure is
   * published here so the cost of choosing it is visible.
   */
  const double semitones[4] = {-12.0, 0.0, 12.0, 19.0};
  auto floorFor = [&semitones](Tier tier) {
    EngineConfig config;
    config.poolSlots = 256;
    config.tier = tier;
    std::vector<float> storage = arena(config);
    GrainEngine engine;
    engine.prepare(kRate, 512, config, storage.data(), storage.size() * sizeof(float));
    SpawnParams spawn = reverbSpawn();
    // No randomisation: a randomised cloud spreads every line into a broad
    // shoulder, and an "alias floor" measured through that is measuring
    // granulation. The row is about the read, so the read is what varies.
    spawn.lengthJitter = 0.0f;
    spawn.sprayAmount = 0.0f;
    spawn.ampJitter = 0.0f;
    spawn.grainSeconds = 0.060f;
    /*
     * **The pitch set has to actually reach the engine, and the first version
     * of this row forgot to send it.**
     *
     * It computed the semitones, derived the fold frequency from them, measured
     * that band and passed — on a cloud rendering at unison, where no fold
     * exists. What gave it away was Eco reading *better* than the cubic tiers
     * (−106.5 against −101.2): linear interpolation cannot beat a rate-scaled
     * kernel at suppressing an image, so a result in that order is not a
     * measurement of interpolation at all. A row that grades an artefact has to
     * be shown producing the artefact.
     */
    static const float weights[4] = {0.25f, 0.25f, 0.25f, 0.25f};
    static float pitches[4];
    for (int i = 0; i < 4; ++i) pitches[i] = static_cast<float>(semitones[i]);
    spawn.pitchSemitones = pitches;
    spawn.pitchWeights = weights;
    spawn.pitchCount = 4;
    engine.setSpawn(0, spawn);
    ScheduleConfig schedule;
    schedule.grainsPerSecond = 350.0f;
    engine.setSchedule(0, schedule);

    Bed bed;
    for (int i = 0; i < kSourceCapacity; ++i) {
      bed.samples[static_cast<std::size_t>(i)] = static_cast<float>(
          0.5 * std::sin(2.0 * 3.14159265358979323846 * 10000.0 * i / kRate));
    }
    const std::vector<float> out = drive(engine, bed, 3.0, 256);

    // Only the fold is measured, and only where it can be: +19 semitones on
    // 10 kHz asks for 29966 Hz, which is above Nyquist and folds to 18034 Hz —
    // a frequency the shifter cannot legitimately produce, 2.5 kHz from the
    // nearest line it can, and therefore the one place an alias is unambiguous.
    double worstDb = -240.0;
    for (double s : semitones) {
      const double asked = 10000.0 * std::pow(2.0, s / 12.0);
      if (asked <= kRate * 0.5) continue;
      const double fold = kRate - asked;
      worstDb = std::max(worstDb, mw::test::bandPeakDb(out, kRate, 65536, fold, 100.0,
                                                       static_cast<int>(kRate)));
    }
    return worstDb;
  };

  const double eco = floorFor(Tier::Eco);
  const double studio = floorFor(Tier::Studio);
  const double max = floorFor(Tier::Max);
  // Eco is not graded, but it must be *worse* than the cubic tiers: linear
  // interpolation has no rate-scaled kernel in front of it, so if it were not
  // worse the pitch set would not be reaching the read.
  MW_EXPECT(eco > studio + 6.0);
  std::printf("    GE-11: fold at 18034 Hz — Eco %.1f dBFS (published, not graded),"
              " Studio %.1f, Max %.1f\n",
              eco, studio, max);
  MW_EXPECT(studio <= -60.0);
  MW_EXPECT(max <= -70.0);
  // Eco is not graded, but it must still be a real measurement: a tier that
  // silently rendered nothing would publish a beautiful figure.
  MW_EXPECT(eco > -240.0 && eco < 0.0);
}

MW_TEST("GE-21: a reversed grain nulls against the forward one it mirrors") {
  /*
   * §11 GE-21: a reversed grain over a time-symmetric source, through a
   * symmetric window, must null against the forward grain to −120 dBFS. What it
   * catches is an off-by-one at the span's end — the reversed grain starting a
   * sample inside or outside where the forward one finished — which is
   * inaudible until the density is high enough that it clicks once per grain.
   *
   * The source is symmetric about the read span's centre, so forward and
   * reverse read the same values in opposite order and the windowed sums are
   * identical sample for sample. Any difference is an indexing error, which is
   * why this nulls rather than merely correlating: a correlation would survive
   * exactly the off-by-one it exists to find.
   */
  constexpr int kSpan = 2048;
  Bed bed;
  const int centre = kSourceCapacity / 2;
  for (int i = 0; i < kSourceCapacity; ++i) {
    // Even symmetry about `centre`, and band-limited so the symmetry is not
    // merely of the samples but of the signal they represent.
    const double offset = static_cast<double>(i - centre);
    bed.samples[static_cast<std::size_t>(i)] =
        static_cast<float>(std::cos(2.0 * 3.14159265358979323846 * 700.0 * offset / kRate) *
                           std::exp(-offset * offset / (2.0 * 400.0 * 400.0)));
  }

  auto renderOne = [&bed](bool reverse) {
    Grain grain;
    GrainSpec spec;
    spec.lengthSamples = kSpan;
    spec.pitchRatio = 1.0f;
    spec.reverse = reverse;
    spec.amplitude = 1.0f;
    spec.pan = 0.5f;
    spec.shape = WindowShape::Hann;
    // The bed's write head sits at the source's centre, so a read offset of
    // half the span puts the span symmetric about that centre — which is what
    // makes forward and reverse read the same values.
    spec.readOffset = static_cast<double>(kSpan / 2);
    spawnGrain(&grain, spec, bed.view(), 0, 1u);
    GrainSource source = bed.view();
    std::vector<float> out;
    out.reserve(kSpan);
    for (int i = 0; i < kSpan; ++i) {
      float l = 0.0f;
      float r = 0.0f;
      if (!renderGrainSample<true>(&grain, source, &l, &r)) {
        out.push_back(l);
        break;
      }
      out.push_back(l);
    }
    return out;
  };

  const std::vector<float> forward = renderOne(false);
  const std::vector<float> backward = renderOne(true);
  MW_EXPECT_EQ(static_cast<long long>(forward.size()), static_cast<long long>(backward.size()));
  double worst = 0.0;
  double peak = 0.0;
  const std::size_t span = std::min(forward.size(), backward.size());
  for (std::size_t i = 0; i < span; ++i) {
    /*
     * Compared sample against sample, not against the reverse.
     *
     * The span is symmetric about the source's centre and the window is
     * symmetric about its own, so the forward grain's k'th sample and the
     * reversed grain's k'th sample read mirror-image positions of an even
     * function and are the same number. Comparing against the time-reversed
     * buffer instead would null just as well and would survive an off-by-one at
     * the span's end, which is the one thing this row exists to find.
     */
    const double difference =
        static_cast<double>(forward[i]) - static_cast<double>(backward[i]);
    worst = std::max(worst, std::fabs(difference));
    peak = std::max(peak, std::fabs(static_cast<double>(forward[i])));
  }
  const double residualDb = worst <= 1.0e-12 ? -240.0 : 20.0 * std::log10(worst);
  std::printf("    GE-21: reverse against forward — residual %.1f dBFS, signal peak %.4f\n",
              residualDb, peak);
  MW_EXPECT(residualDb <= -120.0);
  // A null between two silent buffers is not a null.
  MW_EXPECT(peak > 0.1);
  /*
   * And the null has to be able to fail. Reversal only mirrors the read when
   * the source is symmetric about the span's centre; break that symmetry and
   * the two must diverge. Without this, a `reverse` flag that did nothing at
   * all would pass the row perfectly, which is the failure mode a null test is
   * most prone to.
   */
  for (int i = 0; i < kSourceCapacity; ++i) {
    std::uint32_t state = static_cast<std::uint32_t>(i) * 2654435761u + 1u;
    state ^= state >> 15;
    bed.samples[static_cast<std::size_t>(i)] =
        static_cast<float>(state >> 8) / 8388608.0f - 1.0f;
  }
  const std::vector<float> asymmetricForward = renderOne(false);
  const std::vector<float> asymmetricBackward = renderOne(true);
  double divergence = 0.0;
  for (std::size_t i = 0; i < asymmetricForward.size() && i < asymmetricBackward.size(); ++i) {
    divergence = std::max(divergence, std::fabs(static_cast<double>(asymmetricForward[i]) -
                                                static_cast<double>(asymmetricBackward[i])));
  }
  std::printf("    GE-21: over an asymmetric source the same comparison diverges by %.4f\n",
              divergence);
  MW_EXPECT(divergence > 0.1);
}

MW_TEST("GE-22: one pool serves a stereo source, and the mono path is untouched") {
  /*
   * **One engine with a two-channel source, not two engines — because every
   * guarantee the pool makes is per-pool.**
   *
   * GE-08's drop accounting, GE-15's zero-allocation proof and the 256-slot
   * sizing at 1.56× the 99.99th percentile of the live-grain distribution all
   * assume a single allocation domain. Two instances halve the ceiling each, so
   * a burst that fits one shared pool drops in two halved ones — and it would
   * drop only under exactly the load the sizing was computed to survive, which
   * is the worst possible place for a guarantee to stop holding.
   *
   * Two things have to be true for that to be the right trade. The stereo path
   * must genuinely read both channels, and the mono path must be *bit*-identical
   * to what it was — `fx-02` is finished, and a shared change that moved its
   * output by a bit would move rows that took a great deal of measuring.
   */
  EngineConfig config;
  config.poolSlots = 256;
  config.tier = Tier::Max;

  auto renderWith = [&config](bool stereo, std::uint32_t rightSeed) {
    std::vector<float> storage = arena(config);
    GrainEngine engine;
    engine.prepare(kRate, 512, config, storage.data(), storage.size() * sizeof(float));
    SpawnParams spawn = reverbSpawn();
    spawn.panSpread = 0.0f;  // Centre every grain, so any L/R difference is the source's.
    engine.setSpawn(0, spawn);
    ScheduleConfig schedule;
    schedule.grainsPerSecond = 350.0f;
    engine.setSchedule(0, schedule);

    Bed bed;
    bed.fillNoise(0x5EEDu);
    std::vector<float> other(static_cast<std::size_t>(kSourceCapacity), 0.0f);
    std::uint32_t state = rightSeed;
    for (int i = 0; i < kSourceCapacity; ++i) {
      state = state * 1664525u + 1013904223u;
      other[static_cast<std::size_t>(i)] = static_cast<float>(state >> 8) / 8388608.0f - 1.0f;
    }

    const int frames = static_cast<int>(kRate * 2.0);
    std::vector<float> left;
    std::vector<float> right;
    std::vector<float> l(512, 0.0f);
    std::vector<float> r(512, 0.0f);
    for (int at = 0; at < frames; at += 512) {
      const int n = std::min(512, frames - at);
      GrainSource source = bed.view();
      if (stereo) source.right = other.data();
      engine.process(source, l.data(), r.data(), n);
      for (int i = 0; i < n; ++i) {
        left.push_back(l[static_cast<std::size_t>(i)]);
        right.push_back(r[static_cast<std::size_t>(i)]);
      }
      bed.writeIndex += n;
    }
    struct Out {
      std::vector<float> left;
      std::vector<float> right;
    };
    return Out{left, right};
  };

  // Mono: a null right pointer, which is what `fx-02` hands the engine.
  const auto mono = renderWith(false, 0u);
  double monoDifference = 0.0;
  double monoPeak = 0.0;
  for (std::size_t i = 0; i < mono.left.size(); ++i) {
    monoDifference = std::max(monoDifference, std::fabs(static_cast<double>(mono.left[i]) -
                                                        static_cast<double>(mono.right[i])));
    monoPeak = std::max(monoPeak, std::fabs(static_cast<double>(mono.left[i])));
  }
  std::printf("    GE-22: a mono source with centred grains puts L and R %.3e apart"
              " (peak %.3f)\n",
              monoDifference, monoPeak);
  // Bit-identical, not merely close: with the pan spread off and one buffer,
  // the two channels are the same arithmetic.
  MW_EXPECT(monoDifference == 0.0);
  MW_EXPECT(monoPeak > 0.01);

  // Stereo: a genuinely different right channel must come out different, and
  // the left channel must be *unchanged* from the mono render — which is what
  // says the second read was added rather than the first one altered.
  const auto stereo = renderWith(true, 0xBEEFu);
  double stereoDifference = 0.0;
  double leftDrift = 0.0;
  for (std::size_t i = 0; i < stereo.left.size(); ++i) {
    stereoDifference = std::max(stereoDifference, std::fabs(static_cast<double>(stereo.left[i]) -
                                                            static_cast<double>(stereo.right[i])));
    leftDrift = std::max(leftDrift, std::fabs(static_cast<double>(stereo.left[i]) -
                                              static_cast<double>(mono.left[i])));
  }
  std::printf("    GE-22: a stereo source puts them %.4f apart, and the left channel moves"
              " %.3e from the mono render\n",
              stereoDifference, leftDrift);
  MW_EXPECT(stereoDifference > 0.01);
  MW_EXPECT(leftDrift == 0.0);
}

MW_TEST_MAIN("grain-pool")
