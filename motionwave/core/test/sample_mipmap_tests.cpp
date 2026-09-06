// Motion Wave — the Normal tier's pyramid, graded.
//
// `smp-01` §4.2's mip-map remedy is only a remedy if each level is genuinely
// band-limited before it is decimated. The mutation these rows keep beside
// them is the obvious shortcut — keep every other sample and skip the filter —
// and the first row prints what that would read, so the number is on the page
// rather than in someone's memory.
#include "sample_harness.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw::test::sample;
using mw::dsp::sample::halfBandTaps;
using mw::dsp::sample::kHalfBandTaps;
using mw::dsp::sample::kMipLevels;

namespace {

double rmsOf(const float* data, std::size_t frames, std::size_t skip) {
  double sum = 0.0;
  std::size_t counted = 0;
  for (std::size_t i = skip; i + skip < frames; ++i) {
    const double v = static_cast<double>(data[i]);
    sum += v * v;
    ++counted;
  }
  return counted == 0 ? 0.0 : std::sqrt(sum / static_cast<double>(counted));
}

}  // namespace

MW_TEST("the half-band filter passes the lower band flat and removes the upper") {
  const double fs = 48000.0;
  const std::size_t frames = 48000;
  const double reference = 0.5 / std::sqrt(2.0);
  // 0.2 fs is inside the new level's band (its Nyquist is 0.25 fs) and inside
  // the filter's flat region; it must come through at the level it went in.
  const std::vector<float> pass = sineZone(0.2 * fs, fs, frames, 0.5);
  MipMap passMap;
  passMap.build(pass.data(), pass.size());
  const double passDb = dbOf(rmsOf(passMap.level(1), passMap.frames(1), 200) / reference);
  // 0.4 fs is above the new Nyquist; without the filter it would fold to
  // 0.1 fs at full level, and the pyramid would be a table of aliases.
  const std::vector<float> stop = sineZone(0.4 * fs, fs, frames, 0.5);
  MipMap stopMap;
  stopMap.build(stop.data(), stop.size());
  const double stopDb = dbOf(rmsOf(stopMap.level(1), stopMap.frames(1), 200) / reference);
  // The mutation, evaluated: bare decimation of the same tone.
  std::vector<float> bare(frames / 2);
  for (std::size_t j = 0; j < bare.size(); ++j) bare[j] = stop[2 * j];
  const double bareDb = dbOf(rmsOf(bare.data(), bare.size(), 200) / reference);
  std::printf("    level 1: 0.2 fs tone %+.3f dB, 0.4 fs tone %.1f dB (bare decimation would read"
              " %.1f dB)\n",
              passDb, stopDb, bareDb);
  MW_EXPECT(std::fabs(passDb) <= 0.05);
  MW_EXPECT(stopDb <= -85.0);
  MW_EXPECT(bareDb > -1.0);
}

MW_TEST("levels are phase-aligned with the zone") {
  // An impulse at frame 64 must sit at index 64 >> l on every level, with the
  // filter's symmetric response either side of it. The read head keeps one
  // position in level-0 frames and divides; a level with a half-sample offset
  // would put every note on that level a fraction of a sample late.
  std::vector<float> zone(256, 0.0f);
  zone[64] = 1.0f;
  MipMap map;
  map.build(zone.data(), zone.size());
  MW_EXPECT_EQ(map.levels(), kMipLevels);
  for (int l = 1; l <= map.levels(); ++l) {
    const float* d = map.level(l);
    const std::size_t centre = static_cast<std::size_t>(64 >> l);
    std::size_t peak = 0;
    for (std::size_t j = 1; j < map.frames(l); ++j) {
      if (std::fabs(static_cast<double>(d[j])) > std::fabs(static_cast<double>(d[peak]))) peak = j;
    }
    MW_EXPECT_EQ(static_cast<long long>(peak), static_cast<long long>(centre));
    for (std::size_t k = 1; k <= 4 && centre >= k; ++k) {
      MW_EXPECT_NEAR(static_cast<double>(d[centre - k]), static_cast<double>(d[centre + k]),
                     1.0e-7);
    }
  }
}

MW_TEST("levelFor picks the level whose Nyquist is above the bandwidth the ratio leaves") {
  MW_EXPECT_EQ(MipMap::levelFor(0.5, 3), 0);
  MW_EXPECT_EQ(MipMap::levelFor(1.0, 3), 0);
  MW_EXPECT_EQ(MipMap::levelFor(2.0, 3), 0);
  MW_EXPECT_EQ(MipMap::levelFor(2.0001, 3), 1);
  MW_EXPECT_EQ(MipMap::levelFor(3.0, 3), 1);
  MW_EXPECT_EQ(MipMap::levelFor(4.0, 3), 1);
  MW_EXPECT_EQ(MipMap::levelFor(4.5, 3), 2);
  MW_EXPECT_EQ(MipMap::levelFor(-4.5, 3), 2);
  MW_EXPECT_EQ(MipMap::levelFor(8.0, 3), 2);
  MW_EXPECT_EQ(MipMap::levelFor(9.0, 3), 3);
  MW_EXPECT_EQ(MipMap::levelFor(64.0, 3), 3);
  // Never a level the zone does not have.
  MW_EXPECT_EQ(MipMap::levelFor(64.0, 1), 1);
  MW_EXPECT_EQ(MipMap::levelFor(64.0, 0), 0);
}

MW_TEST("three levels cost 87.5 percent, and building stops where a level would be too short") {
  const std::vector<float> zone = noiseZone(100000, 0x51EEDu, 0.5);
  MipMap map;
  map.build(zone.data(), zone.size());
  std::size_t total = 0;
  for (int l = 1; l <= map.levels(); ++l) total += map.frames(l);
  const double share = static_cast<double>(total) / static_cast<double>(zone.size());
  std::printf("    pyramid: %zu frames over %zu, %.4f of the zone\n", total, zone.size(), share);
  MW_EXPECT_EQ(map.levels(), 3);
  MW_EXPECT_NEAR(share, 0.875, 0.0001);

  const std::vector<float> tiny(5, 0.1f);
  MipMap none;
  none.build(tiny.data(), tiny.size());
  MW_EXPECT_EQ(none.levels(), 0);
  MW_EXPECT(none.level(1) == nullptr);
  const std::vector<float> small(16, 0.1f);
  MipMap two;
  two.build(small.data(), small.size());
  MW_EXPECT_EQ(two.levels(), 2);
  MW_EXPECT_EQ(static_cast<long long>(two.frames(2)), 4LL);
  MW_EXPECT(two.level(3) == nullptr);
}

MW_TEST("the taps are a half-band design with unit DC gain") {
  const std::vector<double> taps = halfBandTaps();
  const int centre = kHalfBandTaps / 2;
  double sum = 0.0;
  int zeros = 0;
  for (int i = 0; i < kHalfBandTaps; ++i) {
    sum += taps[static_cast<std::size_t>(i)];
    const int n = i - centre;
    if (n != 0 && n % 2 == 0) {
      MW_EXPECT(std::fabs(taps[static_cast<std::size_t>(i)]) < 1.0e-15);
      ++zeros;
    }
  }
  MW_EXPECT_NEAR(sum, 1.0, 1.0e-12);
  MW_EXPECT_NEAR(taps[static_cast<std::size_t>(centre)], 0.5, 1.0e-3);
  // Even non-zero offsets in −centre..centre: two per even number up to it.
  MW_EXPECT_EQ(zeros, 2 * (centre / 2));
}

MW_TEST_MAIN("sample-mipmap")
