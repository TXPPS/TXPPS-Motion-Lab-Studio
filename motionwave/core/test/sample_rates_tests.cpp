// Motion Wave — `smp-01` §9 V-29 for the classic read head: V-1, V-2 and V-3
// at every rate the sheet names, and a render that does not know its buffer
// size.
//
// "No artefact whose frequency follows the buffer size" is proved the strong
// way: a render in blocks of 32 through 1024 must be bit-identical to one
// long block. A head that computed anything per block — a level choice, a
// smoothed pitch, a kernel width — would differ somewhere in that set.
#include "sample_harness.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

using namespace mw::test::sample;
using mw::dsp::sample::semitoneRatio;

namespace {

const double kRates[6] = {44100.0, 48000.0, 88200.0, 96000.0, 176400.0, 192000.0};
const Quality kTiers[3] = {Quality::Eco, Quality::Normal, Quality::High};
const LoopMode kModes[4] = {LoopMode::NoLoop, LoopMode::Continuous, LoopMode::Sustain,
                            LoopMode::Alternate};

}  // namespace

MW_TEST("V-29: V-1 nulls at every rate") {
  for (double fs : kRates) {
    const std::size_t frames = static_cast<std::size_t>(fs * 0.5);
    const std::vector<float> zone = noiseZone(frames, 0x7EA5Eu, 0.9);
    ClassicSource source;
    source.data = zone.data();
    source.frames = frames;
    source.sampleRate = fs;
    ClassicRead head;
    head.prepare(source, &sharedSinc(), Quality::High, fs);
    const int rendered = static_cast<int>(frames) + 64;
    const std::vector<float> out = renderSteady(head, rendered, 0.0);
    double worst = 0.0;
    for (std::size_t i = 0; i < static_cast<std::size_t>(rendered); ++i) {
      const double expected = i < frames ? static_cast<double>(zone[i]) : 0.0;
      worst = std::max(worst, std::fabs(static_cast<double>(out[i]) - expected));
    }
    std::printf("    V-1 at %.1f kHz: %.1f dBFS\n", fs / 1000.0, dbOf(worst));
    MW_EXPECT(dbOf(worst) <= -140.0);
    MW_EXPECT(!head.active());
  }
}

MW_TEST("V-29: V-2 holds at every rate, every third key, High tier") {
  /*
   * Every third key rather than every key: the pitch arithmetic is shared by
   * the tiers and every key is swept at 48 kHz in `sample_classic_tests`;
   * what changes with the rate is which keys sit below Nyquist and how wide
   * the stretched kernel gets, and forty-three keys per rate cover both.
   */
  for (double fs : kRates) {
    const std::vector<float> zone = sineZone(1000.0, fs, static_cast<std::size_t>(fs / 100.0), 0.5);
    const ClassicSource source = toneSource(zone, fs, LoopMode::Continuous);
    const int frames = static_cast<int>(fs * 0.2);
    double worstCents = 0.0;
    int worstKey = -1;
    int measured = 0;
    int skipped = 0;
    for (int key = 0; key < 128; key += 3) {
      const double expected = 1000.0 * semitoneRatio(static_cast<double>(key - 60));
      if (expected > 0.45 * fs) {
        ++skipped;
        continue;
      }
      ClassicRead head;
      head.prepare(source, &sharedSinc(), Quality::High, fs);
      const std::vector<float> out = renderSteady(head, frames, static_cast<double>(key - 60));
      const double hz = measureHz(out, fs, 256);
      MW_EXPECT(hz > 0.0);
      if (hz <= 0.0) continue;
      const double cents = centsBetween(hz, expected);
      if (std::fabs(cents) > std::fabs(worstCents)) {
        worstCents = cents;
        worstKey = key;
      }
      ++measured;
      MW_EXPECT(std::fabs(cents) <= 0.5);
    }
    std::printf("    V-2 at %.1f kHz: %d keys measured, %d above 0.45 fs; worst %+.4f cent at key %d\n",
                fs / 1000.0, measured, skipped, worstCents, worstKey);
    MW_EXPECT_EQ(measured + skipped, 43);
  }
}

MW_TEST("V-29: V-3 holds at every rate, every tier, every transposition") {
  const std::size_t length = 65536;
  const int offset = 1024;
  const std::size_t frames = (length + static_cast<std::size_t>(offset)) * 4 + 4096;
  const double semis[4] = {7.0, 12.0, 19.0, 24.0};
  for (double fs : kRates) {
    const std::vector<float> zone = sineZone(1000.0, fs, frames, 0.5);
    MipMap mip;
    mip.build(zone.data(), zone.size());
    ClassicSource source;
    source.data = zone.data();
    source.frames = frames;
    source.sampleRate = fs;
    source.mip = &mip;
    for (Quality tier : kTiers) {
      std::printf("    V-3 at %5.1f kHz %s:", fs / 1000.0, tierName(tier));
      for (double s : semis) {
        ClassicRead head;
        head.prepare(source, &sharedSinc(), tier, fs);
        const std::vector<float> out = renderSteady(head, static_cast<int>(length) + offset, s);
        const double carrier = 1000.0 * semitoneRatio(s);
        const double dbc = aliasDbc(out, fs, carrier, offset, length);
        std::printf("  +%2.0f: %7.1f", s, dbc);
        MW_EXPECT(dbc <= aliasTargetDbc(tier) + 3.0);
      }
      std::printf("  dBc\n");
    }
  }
}

MW_TEST("V-29: rendering in blocks of 32 to 1024 is bit-identical to one block") {
  const std::vector<float> zone = noiseZone(12000, 0xB10C5u, 0.5);
  MipMap mip;
  mip.build(zone.data(), zone.size());
  const int frames = 48000;
  std::vector<float> pitch(static_cast<std::size_t>(frames));
  std::vector<float> speed(static_cast<std::size_t>(frames));
  for (int i = 0; i < frames; ++i) {
    const double u = static_cast<double>(i) / static_cast<double>(frames - 1);
    // Across every pyramid level and through unity, where the exact path and
    // the interpolators hand over, and the speed through zero into reverse.
    pitch[static_cast<std::size_t>(i)] = static_cast<float>(-12.0 + 42.0 * u);
    speed[static_cast<std::size_t>(i)] = static_cast<float>(1.2 - 2.0 * u);
  }
  const int blocks[6] = {32, 64, 128, 256, 512, 1024};
  int cases = 0;
  for (Quality tier : kTiers) {
    for (LoopMode mode : kModes) {
      ClassicSource source;
      source.data = zone.data();
      source.frames = zone.size();
      source.sampleRate = 48000.0;
      source.loopStart = 2000;
      source.loopEnd = 9001;
      source.loopMode = mode;
      source.sampleStart = 500;
      source.mip = &mip;
      ClassicRead whole;
      whole.prepare(source, &sharedSinc(), tier, 48000.0);
      const std::vector<float> reference = renderBlocks(whole, frames, pitch, speed, frames);
      double peak = 0.0;
      for (float v : reference) peak = std::max(peak, std::fabs(static_cast<double>(v)));
      MW_EXPECT(peak > 1.0e-3);
      for (int block : blocks) {
        ClassicRead head;
        head.prepare(source, &sharedSinc(), tier, 48000.0);
        const std::vector<float> out = renderBlocks(head, frames, pitch, speed, block);
        const bool identical =
            std::memcmp(out.data(), reference.data(), sizeof(float) * out.size()) == 0;
        if (!identical) {
          std::printf("    %s %s differs at block size %d\n", tierName(tier), modeName(mode), block);
        }
        MW_EXPECT(identical);
        ++cases;
      }
    }
  }
  std::printf("    %d tier/mode/block cases bit-identical to a single block\n", cases);
}

MW_TEST_MAIN("sample-rates")
