// Motion Wave — the grain engine. `lib-grain-engine.md` §8.
//
// GE-02 runs first and is written first, because §5.3 says so in as many words:
// Hann at a hop of exactly half its length sums to one, that identity checks the
// table, the phase increment and the normalisation in isolation, and every later
// failure is ambiguous until it passes.
#include "../dsp/fft.h"
#include "../dsp/grain/engine.h"
#include "harness.h"
#include "rt_guard.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::dsp;
using namespace mw::dsp::grain;

namespace {

constexpr double kRate = 48000.0;
constexpr int kSourceCapacity = 1 << 17;  // 2.7 s at 48 kHz

/// A source buffer the tests own, with the engine's view over it.
struct Bed {
  std::vector<float> samples = std::vector<float>(kSourceCapacity, 0.0f);
  int writeIndex = 0;

  GrainSource view() const {
    GrainSource source;
    source.data = samples.data();
    source.capacity = kSourceCapacity;
    source.mask = kSourceCapacity - 1;
    source.writeIndex = writeIndex;
    source.sampleRate = kRate;
    return source;
  }

  void fillDc(float value) {
    std::fill(samples.begin(), samples.end(), value);
    writeIndex = kSourceCapacity / 2;
  }

  void fillSine(double hz, float amplitude) {
    for (int i = 0; i < kSourceCapacity; ++i) {
      samples[static_cast<std::size_t>(i)] = static_cast<float>(
          static_cast<double>(amplitude) *
          std::sin(2.0 * 3.14159265358979323846 * hz * i / kRate));
    }
    writeIndex = kSourceCapacity / 2;
  }
};

struct Rendered {
  std::vector<float> left;
  std::vector<float> right;
};

/// Run the engine for `frames`, in blocks, advancing the write head as a unit
/// would. The head moves because a real source is being written behind us.
Rendered run(GrainEngine& engine, Bed& bed, int frames, int blockSize, bool advanceHead = true) {
  Rendered out;
  out.left.reserve(static_cast<std::size_t>(frames));
  out.right.reserve(static_cast<std::size_t>(frames));
  std::vector<float> l(static_cast<std::size_t>(blockSize), 0.0f);
  std::vector<float> r(static_cast<std::size_t>(blockSize), 0.0f);
  for (int at = 0; at < frames; at += blockSize) {
    const int n = std::min(blockSize, frames - at);
    GrainSource source = bed.view();
    engine.process(source, l.data(), r.data(), n);
    for (int i = 0; i < n; ++i) {
      out.left.push_back(l[static_cast<std::size_t>(i)]);
      out.right.push_back(r[static_cast<std::size_t>(i)]);
    }
    if (advanceHead) bed.writeIndex += n;
  }
  return out;
}

std::vector<float> arena(const EngineConfig& config) {
  return std::vector<float>(GrainEngine::arenaBytes(config, 1024) / sizeof(float) + 4, 0.0f);
}

double db(double v) { return 20.0 * std::log10(v > 1.0e-18 ? v : 1.0e-18); }

}  // namespace

MW_TEST("GE-01: the window moments describe the tables they are shipped beside") {
  // Integrated here from the same tables the audio reads, against the closed
  // forms. If these two ever part company the device gets louder as density
  // rises, the user trims the output, and then the feedback loop's gain changes
  // with density and the reverb runs away.
  double sum = 0.0;
  double sumSquare = 0.0;
  for (int i = 0; i < kWindowPoints; ++i) {
    const double a = static_cast<double>(kHannWindow[i]);
    const double b = static_cast<double>(kHannWindow[i + 1]);
    sum += 0.5 * (a + b);
    sumSquare += 0.5 * (a * a + b * b);
  }
  const double mean = sum / kWindowPoints;
  const double meanSquare = sumSquare / kWindowPoints;
  std::printf("    GE-01 Hann: mean %.9f, mean square %.9f\n", mean, meanSquare);
  MW_EXPECT_NEAR(mean, 0.5, 1.0e-6);
  MW_EXPECT_NEAR(meanSquare, 0.375, 1.0e-6);
  MW_EXPECT_NEAR(static_cast<double>(kHannMean), mean, 1.0e-7);
  MW_EXPECT_NEAR(static_cast<double>(kHannMeanSquare), meanSquare, 1.0e-7);

  // Tukey at α = 1 is Hann *bit for bit*, which is what a phase remap of one
  // table gives and what a second table could only approximate.
  int mismatches = 0;
  for (int i = 0; i <= kWindowPoints; ++i) {
    const float phase = static_cast<float>(i) / static_cast<float>(kWindowPoints);
    if (windowAt(WindowShape::Tukey, phase, 1.0f) != windowAt(WindowShape::Hann, phase, 1.0f)) {
      ++mismatches;
    }
  }
  std::printf("    GE-01 Tukey(1) against Hann: %d of %d samples differ\n", mismatches,
              kWindowPoints + 1);
  MW_EXPECT_EQ(mismatches, 0);
  std::printf("    GE-01 Tukey(0.4) mean square %.6f; Gaussian mean %.6f, mean square %.6f\n",
              static_cast<double>(windowMeanSquare(WindowShape::Tukey, 0.4f)),
              static_cast<double>(kGaussianMean), static_cast<double>(kGaussianMeanSquare));
  MW_EXPECT_NEAR(static_cast<double>(windowMeanSquare(WindowShape::Tukey, 0.4f)), 0.750, 1.0e-4);
}

MW_TEST("GE-02: constant overlap-add, which every later row depends on") {
  // Hann, hop exactly half the grain, unity pitch, nothing random anywhere.
  EngineConfig config;
  config.poolSlots = 64;
  std::vector<float> storage = arena(config);
  GrainEngine engine;
  MW_EXPECT(engine.prepare(kRate, 512, config, storage.data(), storage.size() * sizeof(float)));

  ScheduleConfig schedule;
  schedule.grainsPerSecond = 200.0f;  // hop 240 samples
  schedule.onsetJitter = 0.0f;
  SpawnParams spawn;
  spawn.grainSeconds = 0.010f;  // 480 samples, so the hop is exactly half
  spawn.lengthJitter = 0.0f;
  spawn.ampJitter = 0.0f;
  spawn.panSpread = 0.0f;
  spawn.sprayAmount = 0.0f;
  spawn.shape = WindowShape::Hann;
  engine.setSpawn(0, spawn);
  engine.setSchedule(0, schedule);

  Bed bed;
  bed.fillDc(1.0f);
  const Rendered out = run(engine, bed, 24000, 128);

  // The overlap is two and the grains are incoherent, so the normalisation is
  // `1/sqrt(O·mean(w²))`. The coherent form is 6 dB out and is deliberately not
  // offered one enum value away, so the expected level is derived here from the
  // formula §5.3 states rather than from the engine.
  const double expected = 1.0 / std::sqrt(2.0 * 0.375);
  double lowest = 1.0e9;
  double highest = -1.0e9;
  // Skip the first grain length, where the overlap is still filling in.
  for (std::size_t i = 960; i < out.left.size(); ++i) {
    const double left = static_cast<double>(out.left[i]);
    const double right = static_cast<double>(out.right[i]);
    const double magnitude = std::sqrt(left * left + right * right);
    lowest = std::min(lowest, magnitude);
    highest = std::max(highest, magnitude);
  }
  std::printf("    GE-02: level %.6f to %.6f, expected %.6f (ripple %.6f)\n", lowest, highest,
              expected, highest - lowest);
  // Constant is the table and the phase increment; the level is the constant.
  MW_EXPECT(highest - lowest <= 0.001);
  MW_EXPECT_NEAR(0.5 * (highest + lowest), expected, 0.001);
}

MW_TEST("GE-03: no component at the block rate, at any block size") {
  // The definitive signature of a scheduler that rounds onsets to the block
  // boundary is not that the artefact exists — it is that its level *moves with
  // the host's buffer size*, which is why this runs at four.
  constexpr int kBlocks[4] = {64, 128, 256, 512};
  double levels[4] = {0, 0, 0, 0};
  for (int b = 0; b < 4; ++b) {
    EngineConfig config;
    config.poolSlots = 64;
    std::vector<float> storage = arena(config);
    GrainEngine engine;
    engine.prepare(kRate, 512, config, storage.data(), storage.size() * sizeof(float));
    ScheduleConfig schedule;
    schedule.grainsPerSecond = 300.0f;
    schedule.onsetJitter = 0.0f;
    SpawnParams spawn;
    spawn.grainSeconds = 0.030f;
    spawn.lengthJitter = 0.0f;
    spawn.ampJitter = 0.0f;
    spawn.panSpread = 0.0f;
    spawn.sprayAmount = 0.0f;
    engine.setSpawn(0, spawn);
    engine.setSchedule(0, schedule);

    Bed bed;
    bed.fillDc(1.0f);
    const Rendered out = run(engine, bed, 32768 + 4800, kBlocks[b]);

    std::vector<double> re(32768, 0.0);
    std::vector<double> im(32768, 0.0);
    for (int i = 0; i < 32768; ++i) re[static_cast<std::size_t>(i)] = out.left[static_cast<std::size_t>(i + 4800)];
    fft(re, im);
    const double bin = kRate / 32768.0;
    // **Absolute, in dBFS, not a ratio against the grain-rate component.** With
    // the scheduler working there is barely a grain-rate component to divide
    // by — GE-02 has just shown the overlap-add is flat to thirteen parts in a
    // million — so a ratio here is two numbers at the noise floor over each
    // other, and it read −41 dB while the artefact it was grading was at −126.
    // The row's criterion is dBFS and that is what a full-scale reference makes
    // it. A real sinusoid of amplitude `a` puts `a·N/2` in its bin.
    auto levelDbfs = [&](double hz) {
      const std::size_t k = static_cast<std::size_t>(hz / bin + 0.5);
      if (k == 0 || k >= 16384) return -200.0;
      return db(2.0 * std::sqrt(re[k] * re[k] + im[k] * im[k]) / 32768.0);
    };
    const double blockRate = kRate / kBlocks[b];
    levels[b] = levelDbfs(blockRate);
    std::printf("    GE-03: block %4d — %.0f Hz at %.1f dBFS (grain rate %.1f dBFS)\n",
                kBlocks[b], blockRate, levels[b], levelDbfs(300.0));
    MW_EXPECT(levels[b] <= -80.0);
  }
  double lowest = levels[0];
  double highest = levels[0];
  for (int b = 1; b < 4; ++b) {
    lowest = std::min(lowest, levels[b]);
    highest = std::max(highest, levels[b]);
  }
  // **The spread is the definitive signature, and only while there is something
  // to spread.** A level that moves with the host's buffer size is what says an
  // onset was rounded to a block boundary — but these readings are at −170
  // dBFS, which is the FFT's own numerical floor, and the difference between
  // two floor readings is not a measurement. Grading it anyway would be the
  // same vacuous comparison the harness refuses one level down.
  constexpr double kMeaningfulDbfs = -140.0;
  std::printf("    GE-03: spread across block sizes %.1f dB, loudest %.1f dBFS\n",
              highest - lowest, highest);
  if (highest > kMeaningfulDbfs) {
    MW_EXPECT(highest - lowest <= 3.0);
  } else {
    std::printf("    GE-03: the artefact is below %.0f dBFS, so the spread is the noise"
                " floor's and is recorded rather than graded\n",
                kMeaningfulDbfs);
    MW_EXPECT(highest <= -80.0);
  }
}

MW_TEST("GE-05: a grain's pitch is the ratio it was spawned with") {
  const float semitones[5] = {7.0f, -12.0f, 12.0f, 19.0f, 24.0f};
  for (int s = 0; s < 5; ++s) {
    EngineConfig config;
    config.poolSlots = 8;
    std::vector<float> storage = arena(config);
    GrainEngine engine;
    engine.prepare(kRate, 512, config, storage.data(), storage.size() * sizeof(float));
    ScheduleConfig schedule;
    // One grain in the render: a 200 ms grain and a 1 Hz rate.
    schedule.grainsPerSecond = 1.0f;
    schedule.onsetJitter = 0.0f;
    SpawnParams spawn;
    spawn.grainSeconds = 0.200f;
    spawn.lengthJitter = 0.0f;
    spawn.ampJitter = 0.0f;
    spawn.panSpread = 0.0f;
    spawn.sprayAmount = 0.0f;
    spawn.shape = WindowShape::Hann;
    const float set[1] = {semitones[s]};
    spawn.pitchSemitones = set;
    spawn.pitchCount = 1;
    engine.setSpawn(0, spawn);
    engine.setSchedule(0, schedule);

    Bed bed;
    bed.fillSine(1000.0, 0.5f);
    const Rendered out = run(engine, bed, 16384, 128, false);

    std::vector<double> re(16384, 0.0);
    std::vector<double> im(16384, 0.0);
    for (int i = 0; i < 16384; ++i) re[static_cast<std::size_t>(i)] = out.left[static_cast<std::size_t>(i)];
    fft(re, im);
    std::size_t peak = 1;
    double best = 0.0;
    for (std::size_t k = 1; k < 8192; ++k) {
      const double m = re[k] * re[k] + im[k] * im[k];
      if (m > best) {
        best = m;
        peak = k;
      }
    }
    // Quadratic interpolation on the log magnitude, so the reading is not
    // quantised to the 2.93 Hz bin — two cents at 1.5 kHz is 1.7 Hz.
    const double y0 = db(std::sqrt(re[peak - 1] * re[peak - 1] + im[peak - 1] * im[peak - 1]));
    const double y1 = db(std::sqrt(best));
    const double y2 = db(std::sqrt(re[peak + 1] * re[peak + 1] + im[peak + 1] * im[peak + 1]));
    const double shift = 0.5 * (y0 - y2) / (y0 - 2.0 * y1 + y2);
    const double measured = (static_cast<double>(peak) + shift) * kRate / 16384.0;
    const double expected = 1000.0 * std::pow(2.0, static_cast<double>(semitones[s]) / 12.0);
    const double cents = 1200.0 * std::log2(measured / expected);
    std::printf("    GE-05: %+5.0f semitones — %.2f Hz against %.2f (%.2f cents)\n",
                static_cast<double>(semitones[s]), measured, expected, cents);
    MW_EXPECT(std::fabs(cents) <= 2.0);
  }
}

MW_TEST_MAIN("grain-engine")
