// Motion Wave — Slipstream Sampler voice-layer closure for F14.
// Covers the current PROGRESS.md resume target: allocation, envelope/filter
// composition, the 20 ms engine switch, and the first V-30 ParamSpec block.
#include "../dsp/sample/voice.h"
#include "harness.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <vector>

using namespace mw;
using namespace mw::dsp;
using namespace mw::dsp::sample;

namespace {

struct Fixture {
  static constexpr int kFrames = 48000;
  std::vector<float> data;
  SampleVoiceSource source;

  Fixture() : data(kFrames) {
    for (int i = 0; i < kFrames; ++i) {
      data[static_cast<std::size_t>(i)] =
          0.25f * std::sin(static_cast<float>(2.0 * 3.14159265358979323846 * 440.0 * i / 48000.0));
    }
    source.data = data.data();
    source.frames = data.size();
    source.fileRate = 48000.0;
    source.zone.root = 69;
    source.zone.start = 0;
    source.zone.end = data.size();
    source.zone.keyTracking = 1.0;
    source.zone.engine = Engine::Classic;
  }
};

SampleVoiceConfig baseConfig() {
  SampleVoiceConfig c;
  c.layer.engine = Engine::Classic;
  c.layer.quality = Quality::Eco;
  c.layer.polyphony = 32;
  c.layer.filterMode = Svf::Mode::Off;
  c.layer.cutoffHz = 20000.0f;
  c.layer.attack = 0.0001f;
  c.layer.decay = 0.0001f;
  c.layer.sustain = 1.0f;
  c.layer.release = 0.001f;
  c.layer.velocityAmp = 0.0f;
  c.granular.spray = 0.0f;
  c.granular.jitter = 0.0f;
  c.granular.lengthJitter = 0.0f;
  c.granular.pitchSpreadCents = 0.0f;
  return c;
}

}  // namespace

MW_TEST("sampler voice pool enforces the cap and panic drains release tails") {
  Fixture f;
  SamplerVoicePool pool;
  pool.prepare(48000.0, 32);
  const SampleVoiceConfig c = baseConfig();

  for (int i = 0; i < 128; ++i) {
    pool.noteOn(static_cast<voice::NoteId>(i + 1), 69, 127, f.source, c,
                static_cast<std::uint64_t>(1000 + i));
  }
  MW_EXPECT_EQ(pool.liveCount(), 32);
  MW_EXPECT_EQ(pool.sustainingCount(), 32);
  MW_EXPECT_EQ(static_cast<int>(pool.stealCount()), 96);

  pool.panic();
  MW_EXPECT_EQ(pool.sustainingCount(), 0);
  std::array<float, 128> l{};
  std::array<float, 128> r{};
  for (int i = 0; i < 8; ++i) pool.render(l.data(), r.data(), static_cast<int>(l.size()));
  MW_EXPECT_EQ(pool.liveCount(), 0);
}

MW_TEST("voice applies its envelope and the filter-off path remains finite stereo audio") {
  Fixture f;
  SampleVoice v;
  v.warm(48000.0);
  SampleVoiceConfig c = baseConfig();
  v.start(f.source, c, 69, 127, 44);

  std::array<float, 256> l{};
  std::array<float, 256> r{};
  v.render(l.data(), r.data(), static_cast<int>(l.size()));
  double energy = 0.0;
  for (std::size_t i = 0; i < l.size(); ++i) {
    MW_EXPECT(std::isfinite(l[i]));
    MW_EXPECT(std::isfinite(r[i]));
    energy += static_cast<double>(l[i] * l[i] + r[i] * r[i]);
  }
  MW_EXPECT(energy > 0.01);
  MW_EXPECT_NEAR(v.envelopeLevel(), 1.0f, 1e-4);

  v.release();
  for (int i = 0; i < 8 && v.active(); ++i) {
    v.render(l.data(), r.data(), static_cast<int>(l.size()));
  }
  MW_EXPECT(!v.active());
}

MW_TEST("classic to scatter-zero granular switch is exactly twenty milliseconds and click-free") {
  Fixture f;
  SampleVoice v;
  v.warm(48000.0);
  SampleVoiceConfig c = baseConfig();
  v.start(f.source, c, 69, 127, 88);

  std::array<float, 64> l{};
  std::array<float, 64> r{};
  v.render(l.data(), r.data(), static_cast<int>(l.size()));
  const float before = l.back();
  v.requestEngine(Engine::Granular);
  MW_EXPECT(v.switching());
  MW_EXPECT_EQ(v.switchSamplesRemaining(), 960);

  std::array<float, 960> sl{};
  std::array<float, 960> sr{};
  v.render(sl.data(), sr.data(), static_cast<int>(sl.size()));
  MW_EXPECT(!v.switching());
  MW_EXPECT(v.requestedEngine() == Engine::Granular);
  MW_EXPECT(v.actualEngine() == Engine::Granular);
  MW_EXPECT(std::fabs(sl.front() - before) < 0.10f);
}

MW_TEST("hybrid request is explicit classic fallback until the complementary decomposition lands") {
  Fixture f;
  SampleVoice v;
  v.warm(48000.0);
  SampleVoiceConfig c = baseConfig();
  c.layer.engine = Engine::Hybrid;
  v.start(f.source, c, 69, 127, 99);
  MW_EXPECT(v.requestedEngine() == Engine::Hybrid);
  MW_EXPECT(v.actualEngine() == Engine::Classic);
}

MW_TEST("voice-layer ParamSpecs are sequential, valid, and every declared value is consumed") {
  constexpr ParamId base = 700;
  ParamSpec specs[param::kCount];
  param::writeVoiceLayerSpecs(base, specs);
  for (std::size_t i = 0; i < param::kCount; ++i) {
    MW_EXPECT_EQ(static_cast<int>(specs[i].id), static_cast<int>(base + i));
    MW_EXPECT(specs[i].name != nullptr && specs[i].name[0] != '\0');
    MW_EXPECT(specs[i].def >= specs[i].min && specs[i].def <= specs[i].max);
  }

  ParamSet set(specs, param::kCount);
  set.prepare(48000.0f, 128);
  set.beginBlock();
  const param::VoiceLayerControls rest = param::controlsFrom(set);
  MW_EXPECT(rest.engine == Engine::Classic);
  MW_EXPECT(rest.quality == Quality::Normal);
  MW_EXPECT_EQ(rest.polyphony, 32);
  MW_EXPECT(rest.filterMode == Svf::Mode::Lowpass);

  for (std::size_t i = 0; i < param::kCount; ++i) {
    const float def = specs[i].defaultNormalised();
    MW_EXPECT(set.post(specs[i].id, def < 0.5f ? 1.0f : 0.0f));
    for (int settle = 0; settle < 400; ++settle) set.beginBlock();
    const param::VoiceLayerControls moved = param::controlsFrom(set);
    // Reset before the next parameter so each case is isolated.
    MW_EXPECT(set.post(specs[i].id, def));
    for (int settle = 0; settle < 400; ++settle) set.beginBlock();

    bool changed = false;
    switch (i) {
      case param::kEngine: changed = moved.engine != rest.engine; break;
      case param::kQuality: changed = moved.quality != rest.quality; break;
      case param::kGain: changed = moved.gainDb != rest.gainDb; break;
      case param::kPan: changed = moved.pan != rest.pan; break;
      case param::kPolyphony: changed = moved.polyphony != rest.polyphony; break;
      case param::kFilterMode: changed = moved.filterMode != rest.filterMode; break;
      case param::kCutoff: changed = moved.cutoffHz != rest.cutoffHz; break;
      case param::kResonance: changed = moved.resonance != rest.resonance; break;
      case param::kKeyFollow: changed = moved.keyFollow != rest.keyFollow; break;
      case param::kAttack: changed = moved.attack != rest.attack; break;
      case param::kDecay: changed = moved.decay != rest.decay; break;
      case param::kSustain: changed = moved.sustain != rest.sustain; break;
      case param::kRelease: changed = moved.release != rest.release; break;
      case param::kVelocityAmp: changed = moved.velocityAmp != rest.velocityAmp; break;
      default: break;
    }
    MW_EXPECT(changed);
  }
}

MW_TEST_MAIN("sample-voice")
