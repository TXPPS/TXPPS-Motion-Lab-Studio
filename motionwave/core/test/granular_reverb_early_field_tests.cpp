// Motion Wave — evidence for the experimental early reflection field.
//
// This is NOT sonic approval: it protects the legacy zero path, verifies that
// the new causal path contributes genuine early energy, and checks that the
// early layer cannot bypass DC protection or alter the calibrated feedback.
#include "../units/granular_reverb.h"
#include "harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kRate = 48000.0;
constexpr int kFrames = 48000;
constexpr double kPi = 3.14159265358979323846;

std::vector<float> render(double early, int block, int kind, bool explicitZero = true) {
  GranularReverb u;
  u.prepare(kRate, block);
  u.setMix(1.0);
  u.setPreDelaySeconds(0.0);
  u.setDiffusion(0.6);
  u.setDamping(0.0);
  u.setDensity(350.0);
  u.setGrainSeconds(0.060);
  if (explicitZero || early != 0.0) u.setEarlyField(early);
  u.reset();

  std::vector<float> a(static_cast<std::size_t>(block), 0.0f);
  std::vector<float> b(static_cast<std::size_t>(block), 0.0f);
  std::vector<float> oa(static_cast<std::size_t>(block), 0.0f);
  std::vector<float> ob(static_cast<std::size_t>(block), 0.0f);
  float* ch[2] = {a.data(), b.data()};
  float* och[2] = {oa.data(), ob.data()};
  std::vector<float> result;
  result.reserve(kFrames);
  for (int at = 0; at < kFrames; at += block) {
    const int n = std::min(block, kFrames - at);
    for (int i = 0; i < n; ++i) {
      const int index = at + i;
      float x = 0.0f;
      if (kind == 0) x = index == 0 ? 0.5f : 0.0f;
      if (kind == 1) {
        const double t = static_cast<double>(index) / kRate;
        x = static_cast<float>(0.2 * std::sin(2.0 * kPi * 220.0 * t));
      }
      if (kind == 2) x = 0.4f;
      a[static_cast<std::size_t>(i)] = x;
      b[static_cast<std::size_t>(i)] = x;
    }
    AudioBuffer in(ch, 2, n);
    AudioBuffer out(och, 2, n);
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &out;
    ctx.outputCount = 1;
    ctx.frames = n;
    ctx.sampleRate = kRate;
    ctx.playing = true;
    u.process(ctx);
    for (int i = 0; i < n; ++i) result.push_back(oa[static_cast<std::size_t>(i)]);
  }
  return result;
}

double energy(const std::vector<float>& signal, int begin, int end) {
  double power = 0.0;
  for (int i = begin; i < end; ++i) {
    const double s = signal[static_cast<std::size_t>(i)];
    power += s * s;
  }
  return power;
}

}  // namespace

MW_TEST("legacy early-field zero path is bit-identical to untouched default") {
  const std::vector<float> defaultRender = render(0.0, 256, 1, false);
  const std::vector<float> zeroRender = render(0.0, 256, 1, true);
  MW_EXPECT_EQ(static_cast<int>(defaultRender.size()), kFrames);
  for (int i = 0; i < kFrames; ++i) {
    MW_EXPECT(defaultRender[static_cast<std::size_t>(i)] ==
              zeroRender[static_cast<std::size_t>(i)]);
  }
}

MW_TEST("a dry transient produces earlier wet energy with the field enabled") {
  const std::vector<float> legacy = render(0.0, 256, 0);
  const std::vector<float> withField = render(0.5, 256, 0);
  // 5–75 ms after a transient: independent of the stochastic cloud's chance
  // of catching an impulse in its source table. Not a V7 echo-density claim.
  const int begin = 240;
  const int end = 3600;
  const double base = energy(legacy, begin, end);
  const double dense = energy(withField, begin, end);
  std::printf("    early field 5–75 ms: baseline %.9g, enabled %.9g\n", base, dense);
  MW_EXPECT(dense > 1.0e-8);
  MW_EXPECT(dense > base * 1.2 + 1.0e-9);
}

MW_TEST("the optional field does not change calibrated feedback or finite output") {
  GranularReverb base;
  GranularReverb early;
  base.prepare(kRate, 256);
  early.prepare(kRate, 256);
  base.setDecaySeconds(3.0);
  early.setDecaySeconds(3.0);
  early.setEarlyField(0.5);
  MW_EXPECT(base.feedback() == early.feedback());

  const std::vector<float> captured = render(0.5, 256, 1);
  double peak = 0.0;
  for (float sample : captured) {
    MW_EXPECT(std::isfinite(sample));
    peak = std::max(peak, std::fabs(static_cast<double>(sample)));
  }
  MW_EXPECT(peak > 1.0e-4);
  MW_EXPECT(peak < 5.0);
}

MW_TEST("early-field enabled render has no block-size signature") {
  const std::vector<float> a = render(0.4, 128, 1);
  const std::vector<float> b = render(0.4, 256, 1);
  MW_EXPECT_EQ(static_cast<int>(a.size()), static_cast<int>(b.size()));
  for (int i = 0; i < kFrames; ++i) {
    MW_EXPECT(a[static_cast<std::size_t>(i)] == b[static_cast<std::size_t>(i)]);
  }
}

MW_TEST("early-field DC blocker prevents steady input leaking to wet output") {
  const std::vector<float> captured = render(0.5, 256, 2);
  double mean = 0.0;
  for (int i = 24000; i < kFrames; ++i) mean += captured[static_cast<std::size_t>(i)];
  mean /= 24000.0;
  std::printf("    early field DC mean, last half second: %.9g\n", mean);
  MW_EXPECT(std::fabs(mean) < 0.001);
}

MW_TEST_MAIN("granular-reverb-early-field")
