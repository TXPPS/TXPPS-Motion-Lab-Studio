// Motion Wave — the classic read head's loop modes, sample start and real-time
// safety. `smp-01` §4.2's loop paragraph and §4.1's contract.
//
// Mutations, and the row that caught each:
//
// The ping-pong's own rule — never repeating the turn-around sample — has its
// own suite, `sample_pingpong_tests`, because it needs two rows and a mirrored
// reference. This file is the other three modes, the start rule and the guard.
//
// - **`release()` ignored by `loop_sustain`**: the sustain row's second render
//   keeps looping — 2600 mismatches against the file, and the head is still
//   active where it should have run out.
// - **Sample start read live from the zone** (a pointer kept instead of the
//   snapshot): the sample-start row's second render jumps to 999 where the
//   sounding note must carry on at 133.
// - **A tap wrapped by the nearest level sample instead of a nested read**
//   (`if (q == qf) return pick(k);` made unconditional): the continuous row's
//   +19 case on pyramid level 1 reads −22.5 dBFS against its reference.
#include "sample_harness.h"
#include "rt_guard.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw::test::sample;
using mw::dsp::sample::semitoneRatio;

namespace {

constexpr double kRate = 48000.0;
const Quality kTiers[3] = {Quality::Eco, Quality::Normal, Quality::High};
const LoopMode kModes[4] = {LoopMode::NoLoop, LoopMode::Continuous, LoopMode::Sustain,
                            LoopMode::Alternate};

std::size_t periodic(std::size_t start, std::size_t end, std::size_t p) {
  return p < end ? p : start + (p - start) % (end - start);
}

}  // namespace

MW_TEST("loop_continuous: across the join the read is the kernel on the periodic extension") {
  /*
   * At unity the output is the file's periodic extension exactly. At half
   * speed every other read sits between two samples and the kernel straddles
   * the join, so the reference is the same kernel applied to the extended
   * file — computed here with the shared kernels on wrapped indices. A head
   * whose join taps read the material beside the loop instead of the loop's
   * own continuation differs from that reference at every pass.
   */
  const std::vector<float> zone = noiseZone(2000, 0xC0FFEEu, 0.8);
  MipMap mip;
  mip.build(zone.data(), zone.size());
  ClassicSource source;
  source.data = zone.data();
  source.frames = zone.size();
  source.sampleRate = kRate;
  source.loopStart = 500;
  source.loopEnd = 1301;  // odd length, so the pyramid's join is fractional
  source.loopMode = LoopMode::Continuous;
  source.sampleStart = 100;
  source.mip = &mip;
  auto at = [&zone, &source](long long i) {
    if (i < 0) return 0.0f;
    return zone[periodic(source.loopStart, source.loopEnd, static_cast<std::size_t>(i))];
  };
  for (Quality tier : kTiers) {
    ClassicRead unity;
    unity.prepare(source, &sharedSinc(), tier, kRate);
    const std::vector<float> one = renderSteady(unity, 6000, 0.0);
    int mismatches = 0;
    for (std::size_t k = 0; k < one.size(); ++k) {
      if (one[k] != at(static_cast<long long>(100 + k))) ++mismatches;
    }
    ClassicRead half;
    half.prepare(source, &sharedSinc(), tier, kRate);
    const std::vector<float> two = renderSteady(half, 6000, -12.0);
    double worst = 0.0;
    for (std::size_t k = 0; k < two.size(); ++k) {
      const double p = 100.0 + 0.5 * static_cast<double>(k);
      const long long i = static_cast<long long>(std::floor(p));
      const float frac = static_cast<float>(p - std::floor(p));
      float expected = 0.0f;
      if (frac == 0.0f) expected = at(i);
      else if (tier == Quality::Eco) expected = mw::dsp::linear2(at(i), at(i + 1), frac);
      else if (tier == Quality::Normal) {
        expected = mw::dsp::hermite4(at(i - 1), at(i), at(i + 1), at(i + 2), frac);
      } else {
        expected = sharedSinc().read(at, i, 0.5, 0.5);
      }
      worst = std::max(worst, std::fabs(static_cast<double>(two[k]) - static_cast<double>(expected)));
    }
    std::printf("    continuous %s: %d mismatches at unity; worst %.1f dBFS against the reference at"
                " half speed\n",
                tierName(tier), mismatches, dbOf(worst));
    MW_EXPECT_EQ(mismatches, 0);
    MW_EXPECT(dbOf(worst) <= -140.0);
  }
  // The pyramid's join, at +19: level 1 with a fractional loop length.
  ClassicRead up;
  up.prepare(source, &sharedSinc(), Quality::Normal, kRate);
  const std::vector<float> high = renderSteady(up, 6000, 19.0);
  const double r = semitoneRatio(19.0);
  double worst = 0.0;
  // From 512 on the head has wrapped at least once, so on both sides of the
  // loop the material the kernel should see is the periodic extension.
  for (std::size_t k = 512; k < high.size(); ++k) {
    const double p = 100.0 + r * static_cast<double>(k);
    const double wrapped = p < 1301.0 ? p : 500.0 + std::fmod(p - 500.0, 801.0);
    const double q = wrapped * 0.5;
    const double qf = std::floor(q);
    const long long j = static_cast<long long>(qf);
    auto level = [&mip](long long i) {
      return (i >= 0 && static_cast<std::size_t>(i) < mip.frames(1))
                 ? mip.level(1)[static_cast<std::size_t>(i)]
                 : 0.0f;
    };
    // The reference for a wrapped tap on the level is the level's own Hermite
    // at the fractional index, which is what the head does. Taps that need no
    // wrap are the level samples themselves.
    auto levelAt = [&](long long i) {
      const double p0 = static_cast<double>(i) * 2.0;
      if (p0 < 1301.0 && p0 >= 500.0) return level(i);
      double w = std::fmod(p0 - 500.0, 801.0);
      if (w < 0.0) w += 801.0;
      w += 500.0;
      const double qq = w * 0.5;
      const double qqf = std::floor(qq);
      const long long jj = static_cast<long long>(qqf);
      if (qq == qqf) return level(jj);
      return mw::dsp::hermite4(level(jj - 1), level(jj), level(jj + 1), level(jj + 2),
                               static_cast<float>(qq - qqf));
    };
    const float expected = mw::dsp::hermite4(levelAt(j - 1), levelAt(j), levelAt(j + 1),
                                             levelAt(j + 2), static_cast<float>(q - qf));
    worst = std::max(worst, std::fabs(static_cast<double>(high[k]) - static_cast<double>(expected)));
  }
  std::printf("    continuous Normal at +19 on level 1: worst %.1f dBFS against the reference\n",
              dbOf(worst));
  MW_EXPECT(dbOf(worst) <= -120.0);
}

MW_TEST("loop_sustain: loops until release, then runs to the end and stops") {
  const std::vector<float> zone = noiseZone(3000, 0xBEEFu, 0.8);
  ClassicSource source;
  source.data = zone.data();
  source.frames = zone.size();
  source.sampleRate = kRate;
  source.loopStart = 800;
  source.loopEnd = 1400;
  source.loopMode = LoopMode::Sustain;
  ClassicRead head;
  head.prepare(source, &sharedSinc(), Quality::High, kRate);
  const std::vector<float> held = renderSteady(head, 4000, 0.0);
  int mismatches = 0;
  for (std::size_t k = 0; k < held.size(); ++k) {
    if (held[k] != zone[periodic(800, 1400, k)]) ++mismatches;
  }
  MW_EXPECT_EQ(mismatches, 0);
  MW_EXPECT(head.active());
  const std::size_t from = static_cast<std::size_t>(head.position());
  MW_EXPECT(from >= 800 && from < 1400);
  head.release();
  const std::vector<float> tail = renderSteady(head, 3000, 0.0);
  int tailMismatches = 0;
  for (std::size_t k = 0; k < tail.size(); ++k) {
    const float expected = from + k < zone.size() ? zone[from + k] : 0.0f;
    if (tail[k] != expected) ++tailMismatches;
  }
  std::printf("    sustain: %d mismatches while held, released at %zu, %d mismatches running out\n",
              mismatches, from, tailMismatches);
  MW_EXPECT_EQ(tailMismatches, 0);
  MW_EXPECT(!head.active());
}

MW_TEST("sample start is applied at note-on only") {
  std::vector<float> zone(4096);
  for (std::size_t n = 0; n < zone.size(); ++n) zone[n] = static_cast<float>(n);
  ClassicSource source;
  source.data = zone.data();
  source.frames = zone.size();
  source.sampleRate = kRate;
  source.sampleStart = 123;
  ClassicRead head;
  head.prepare(source, &sharedSinc(), Quality::High, kRate);
  const std::vector<float> first = renderSteady(head, 10, 0.0);
  MW_EXPECT(first[0] == 123.0f && first[9] == 132.0f);
  // The zone moves its start under a sounding note; the note does not move.
  source.sampleStart = 999;
  const std::vector<float> second = renderSteady(head, 10, 0.0);
  MW_EXPECT(second[0] == 133.0f && second[9] == 142.0f);
  // The next note-on takes it.
  ClassicRead next;
  next.prepare(source, &sharedSinc(), Quality::High, kRate);
  const std::vector<float> third = renderSteady(next, 10, 0.0);
  MW_EXPECT(third[0] == 999.0f);
}

MW_TEST("nothing on the render path allocates, on every tier and loop mode, with pitch and speed moving") {
  /*
   * §9 V-27's shape, scoped to this engine: `RtGuard` armed around `render`
   * for every tier and loop mode, with the pitch sweeping from two octaves
   * down to six up — across every pyramid level and past the stretch cap —
   * and the speed sweeping through zero into reverse, so the backward rules
   * run under the guard too. `prepare` and `release` are inside the guard as
   * well: the contract says prepare allocates nothing either.
   */
  const std::vector<float> zone = noiseZone(8000, 0xA110Cu, 0.5);
  MipMap mip;
  mip.build(zone.data(), zone.size());
  const int frames = 4096;
  std::vector<float> pitch(static_cast<std::size_t>(frames));
  std::vector<float> speed(static_cast<std::size_t>(frames));
  for (int i = 0; i < frames; ++i) {
    const double u = static_cast<double>(i) / static_cast<double>(frames - 1);
    pitch[static_cast<std::size_t>(i)] = static_cast<float>(-24.0 + 96.0 * u);
    speed[static_cast<std::size_t>(i)] = static_cast<float>(1.5 - 3.0 * u);
  }
  int cases = 0;
  for (Quality tier : kTiers) {
    for (LoopMode mode : kModes) {
      ClassicSource source;
      source.data = zone.data();
      source.frames = zone.size();
      source.sampleRate = kRate;
      source.loopStart = 1000;
      source.loopEnd = 7001;
      source.loopMode = mode;
      source.sampleStart = 200;
      source.mip = &mip;
      ClassicRead head;
      std::vector<float> out(static_cast<std::size_t>(frames), 0.0f);
      std::size_t allocations = 0;
      {
        mw::test::RtGuard guard;
        head.prepare(source, &sharedSinc(), tier, kRate);
        for (int at = 0; at < frames; at += 256) {
          if (at == frames / 2) head.release();
          head.render(out.data() + at, 256, pitch.data() + at, speed.data() + at);
        }
        allocations = guard.allocations();
      }
      double peak = 0.0;
      for (float v : out) peak = std::max(peak, std::fabs(static_cast<double>(v)));
      if (allocations != 0) {
        std::printf("    %s %s allocated %zu time(s)\n", tierName(tier), modeName(mode),
                    allocations);
      }
      MW_EXPECT_EQ(static_cast<long long>(allocations), 0LL);
      // A silent render allocates nothing either.
      MW_EXPECT(peak > 1.0e-3);
      ++cases;
    }
  }
  std::printf("    %d tier/mode cases rendered with pitch and speed moving, no allocation\n", cases);
}

MW_TEST("building the pyramid does allocate, so the guard is awake") {
  // The negative kept executable beside the rows above: the load-time call
  // allocates by design, and a guard that did not see it would be asleep.
  const std::vector<float> zone = noiseZone(4096, 0x5EEDu, 0.5);
  mw::test::RtGuard guard;
  MipMap mip;
  mip.build(zone.data(), zone.size());
  MW_EXPECT(guard.allocations() > 0);
}

MW_TEST_MAIN("sample-loop")
