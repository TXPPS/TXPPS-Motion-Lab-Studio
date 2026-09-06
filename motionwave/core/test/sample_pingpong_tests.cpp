// Motion Wave — the ping-pong loop, which is the mode with a rule of its own.
//
// `smp-01` §4.2: "Ping-pong must **not** repeat the turn-around sample —
// holding the endpoint for two samples at each end injects a periodic step at
// `2/L` Hz, which on a 100 ms loop is a 20 Hz buzz that no filter setting
// removes." Two rows, because the rule has two halves that different defects
// break: at unity the whole sequence is known and a repeat is countable; at
// every other ratio the kernels read across the turn and what is checked is
// that they read the mirrored extension.
//
// Mutations, and the row that caught each:
//
// - **Reflecting about the boundary after the last sample** (`span_ =
//   loopLength_`, which is exactly the implementation that holds the endpoint
//   twice): the ramp row reads 357 mismatches against the known sequence and
//   12 first differences that are not of size one — the held sample at each
//   turn. The mirrored-extension row reads −39.8 dBFS on the same mutation.
//   The sheet's 2/L Hz buzz, as arithmetic.
#include "sample_harness.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw::test::sample;
using mw::dsp::sample::semitoneRatio;

namespace {

constexpr double kRate = 48000.0;
const Quality kTiers[3] = {Quality::Eco, Quality::Normal, Quality::High};

/// The ping-pong's position sequence at unity: `S..E-1` forward, `E-2..S+1`
/// back, so the period is `2 (E - 1 - S)` and no sample is visited twice in a
/// row.
std::size_t pingPong(std::size_t start, std::size_t end, std::size_t k) {
  const std::size_t span = end - 1 - start;
  const std::size_t t = k % (2 * span);
  return start + (t <= span ? t : 2 * span - t);
}

}  // namespace

MW_TEST("alternate: a ramp at unity comes back with every first difference exactly one") {
  /*
   * A loop holding a ramp, and −100 everywhere else so any tap that reached
   * outside would be loud. At unity the head reads the ramp's own values, so
   * the whole sequence is known: every first difference is ±1, including at
   * the turn, and the period is 2 (E − 1 − S). A turn-around that repeated its
   * sample would put a 0 in that sequence; one that read past the end would
   * put −147.
   */
  std::vector<float> zone(64, -100.0f);
  const std::size_t start = 16;
  const std::size_t end = 48;
  for (std::size_t n = start; n < end; ++n) zone[n] = static_cast<float>(n);
  ClassicSource source;
  source.data = zone.data();
  source.frames = zone.size();
  source.sampleRate = kRate;
  source.loopStart = start;
  source.loopEnd = end;
  source.loopMode = LoopMode::Alternate;
  source.sampleStart = start;
  for (Quality tier : kTiers) {
    ClassicRead head;
    head.prepare(source, &sharedSinc(), tier, kRate);
    const std::vector<float> out = renderSteady(head, 400, 0.0);
    int mismatches = 0;
    int badSteps = 0;
    for (std::size_t k = 0; k < out.size(); ++k) {
      if (out[k] != static_cast<float>(pingPong(start, end, k))) ++mismatches;
      if (k > 0 && std::fabs(static_cast<double>(out[k]) - static_cast<double>(out[k - 1])) != 1.0) {
        ++badSteps;
      }
    }
    std::printf("    alternate %s: %d mismatches against the sequence, %d steps not of size one\n",
                tierName(tier), mismatches, badSteps);
    MW_EXPECT_EQ(mismatches, 0);
    MW_EXPECT_EQ(badSteps, 0);
  }
}

MW_TEST("alternate: at fractional ratios the read is the kernel on the mirrored extension") {
  /*
   * At ratios that are not one the exact path is idle and the kernels read
   * across the turn, so the reference is each tier's own kernel applied to
   * the zone's mirrored extension, at the head's own positions. A repeat, a
   * jump, or a tap gathered from the material beyond the loop instead of the
   * mirror all differ from that reference by far more than −140 dBFS.
   *
   * The sheet's language — the first difference at the turn against the
   * interior's maximum — is kept beside it, with the bound derived rather
   * than chosen. A mirror puts a slope corner at the turn, and a band-limited
   * kernel reconstructs a corner with the Gibbs overshoot in the derivative:
   * 8.95 % of the slope change, which is twice the slope, so 1.179 times the
   * interior for an ideal sinc. A windowed sinc rings less and Hermite less
   * still; linear cannot overshoot at all. Measured: High reads 1.166 at
   * r = 0.7, Normal 1.061, Eco 0.89.
   */
  const std::vector<float> zone = sineZone(100.0, kRate, 4800, 0.5);
  MipMap mip;
  mip.build(zone.data(), zone.size());
  const std::size_t lo = 1000;
  const std::size_t hi = 3399;
  ClassicSource source;
  source.data = zone.data();
  source.frames = zone.size();
  source.sampleRate = kRate;
  source.loopStart = lo;
  source.loopEnd = hi + 1;
  source.loopMode = LoopMode::Alternate;
  source.sampleStart = lo;
  source.mip = &mip;
  // The mirrored extension, in the frames of level `level` (0 or 1). Both
  // reflection points are even in level-0 frames, so level 1's mirror lands on
  // its own samples.
  auto mirrored = [&](int level, long long j) {
    const double scale = level == 0 ? 1.0 : 2.0;
    const double span = static_cast<double>(hi - lo);
    double p = static_cast<double>(j) * scale - static_cast<double>(lo);
    const double leg = std::floor(p / span);
    p -= leg * span;
    if (std::fmod(leg, 2.0) != 0.0) p = span - p;
    const std::size_t index = static_cast<std::size_t>((p + static_cast<double>(lo)) / scale);
    return level == 0 ? zone[index] : mip.level(1)[index];
  };
  const double ratios[3] = {0.7, 1.3, 2.6};
  for (Quality tier : kTiers) {
    for (double r : ratios) {
      ClassicRead head;
      head.prepare(source, &sharedSinc(), tier, kRate);
      const int frames = 20000;
      const std::vector<float> pitch(static_cast<std::size_t>(frames),
                                     static_cast<float>(12.0 * std::log2(r)));
      std::vector<float> out(static_cast<std::size_t>(frames));
      std::vector<double> at(static_cast<std::size_t>(frames));
      std::vector<int> dir(static_cast<std::size_t>(frames));
      for (int i = 0; i < frames; ++i) {
        at[static_cast<std::size_t>(i)] = head.position();
        dir[static_cast<std::size_t>(i)] = head.direction();
        head.render(out.data() + i, 1, pitch.data() + i, nullptr);
      }
      const double rate = mw::dsp::sample::semitoneRatio(12.0 * std::log2(r));
      double worst = 0.0;
      double turn = 0.0;
      double interior = 0.0;
      int turns = 0;
      // From 64 on: before the first reflection the taps below the loop read
      // the material actually played there, which is not the mirror.
      for (int i = 64; i < frames; ++i) {
        const double p = at[static_cast<std::size_t>(i)];
        const double pf = std::floor(p);
        const float frac = static_cast<float>(p - pf);
        float expected = 0.0f;
        if (tier == Quality::Eco) {
          const long long k = static_cast<long long>(pf);
          expected = mw::dsp::linear2(mirrored(0, k), mirrored(0, k + 1), frac);
        } else if (tier == Quality::Normal) {
          const int level = MipMap::levelFor(rate, mip.levels());
          const double q = level == 0 ? p : p * 0.5;
          const double qf = std::floor(q);
          const long long k = static_cast<long long>(qf);
          expected = mw::dsp::hermite4(mirrored(level, k - 1), mirrored(level, k),
                                       mirrored(level, k + 1), mirrored(level, k + 2),
                                       static_cast<float>(q - qf));
        } else {
          expected = sharedSinc().read([&mirrored](long long k) { return mirrored(0, k); },
                                       static_cast<long long>(pf), p - pf, rate);
        }
        worst = std::max(worst, std::fabs(static_cast<double>(out[static_cast<std::size_t>(i)]) -
                                          static_cast<double>(expected)));
        const double d = std::fabs(static_cast<double>(out[static_cast<std::size_t>(i)]) -
                                   static_cast<double>(out[static_cast<std::size_t>(i - 1)]));
        bool nearTurn = false;
        for (int j = i - 3; j <= i + 3; ++j) {
          if (j > 0 && j < frames &&
              dir[static_cast<std::size_t>(j)] != dir[static_cast<std::size_t>(j - 1)]) {
            nearTurn = true;
          }
        }
        if (nearTurn) turn = std::max(turn, d);
        else interior = std::max(interior, d);
        if (dir[static_cast<std::size_t>(i)] != dir[static_cast<std::size_t>(i - 1)]) ++turns;
      }
      std::printf("    alternate %s r=%.1f: %d turns; %.1f dBFS against the mirrored reference;"
                  " turn/interior step ratio %.3f\n",
                  tierName(tier), r, turns, dbOf(worst), turn / interior);
      MW_EXPECT(turns >= 4);
      MW_EXPECT(dbOf(worst) <= -140.0);
      MW_EXPECT(turn <= interior * (1.0 + 2.0 * 0.0895));
    }
  }
}

MW_TEST_MAIN("sample-pingpong")
