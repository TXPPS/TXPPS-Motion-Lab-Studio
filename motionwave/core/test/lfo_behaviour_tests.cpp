// Motion Wave — the LFO's own contract. `lib-voice-substrate.md` §5.3.
//
// What `lfo.h` promises beyond the verification rows, which live in
// `lfo_tests.cpp`: every waveform is what it says at the quarter points,
// sample-and-hold holds between wraps and draws at them from the seed,
// `SampleInput` samples a source on the LFO's own clock, each retrigger mode
// answers to its own pulse and no other, a note-on restarts the delay even
// when the phase runs free, and a rate change is continuous in phase and
// leaves the delay alone.
//
// Mutation-tested against both LFO suites, each edit restored before the next:
//   `External` retriggering on the level rather than the rising edge → red:
//     the retrigger modes case only ("held high is one trigger, not one per
//     step").
//   `setConfig` restarting the count without rebasing the origin → red: the
//     rate-change case only — the phase jumped from 0.4 to the old origin.
//   a single wrap not counted as a draw (`wraps > 1`) → red: sample-and-hold
//     and `SampleInput`; VS-07 stayed green because the retrigger's own draw
//     still gives a non-zero held value, which is why the wrap count is
//     asserted here rather than left to the block-size case.
#include "../dsp/voice/lfo.h"
#include "harness.h"
#include "rt_guard.h"

#include <cmath>
#include <vector>

using namespace mw;
using namespace mw::dsp::voice;

namespace {

TriggerBus pressed() {
  TriggerBus bus;
  bus.single = true;
  bus.multi = true;
  bus.gate = true;
  return bus;
}

TriggerBus held() {
  TriggerBus bus;
  bus.gate = true;
  return bus;
}

TriggerBus multiOnly() {
  TriggerBus bus;
  bus.multi = true;
  bus.gate = true;
  return bus;
}

TriggerBus quiet() { return TriggerBus{}; }

/// Prepare, configure, reset — the instrument's own order. The reset is what
/// puts the phase at the retrigger point: `setConfig` is continuous on
/// purpose, so a knob turned on a running LFO does not jump it.
Lfo prepared(const LfoConfig& config, double rate = 48000.0, std::uint64_t seed = 1234) {
  Lfo lfo;
  lfo.prepare(rate, seed);
  lfo.setConfig(config);
  lfo.reset();
  return lfo;
}

std::vector<float> render(Lfo& lfo, const TriggerBus& bus, int frames) {
  std::vector<float> out;
  out.reserve(static_cast<std::size_t>(frames));
  for (int i = 0; i < frames; ++i) out.push_back(lfo.advance(bus, nullptr, 1));
  return out;
}

}  // namespace

// ───────────────────────────────────────────────────────────── waveforms

MW_TEST("every waveform is what it says at the quarter points") {
  // 1 Hz at 48 kHz: 12 000 samples is a quarter of a cycle exactly.
  struct Expected {
    LfoWave wave;
    float at[4];
  };
  const Expected table[5] = {
      {LfoWave::Triangle, {0.0f, 1.0f, 0.0f, -1.0f}},
      {LfoWave::SawUp, {-1.0f, -0.5f, 0.0f, 0.5f}},
      {LfoWave::SawDown, {1.0f, 0.5f, 0.0f, -0.5f}},
      {LfoWave::Square, {1.0f, 1.0f, -1.0f, -1.0f}},
      {LfoWave::Sine, {0.0f, 1.0f, 0.0f, -1.0f}},
  };
  for (const Expected& row : table) {
    LfoConfig config;
    config.wave = row.wave;
    config.rateHz = 1.0f;
    Lfo lfo = prepared(config);
    MW_EXPECT(std::fabs(lfo.value() - row.at[0]) < 1e-5f);
    for (int q = 1; q < 4; ++q) {
      lfo.advance(held(), nullptr, 12000);
      MW_EXPECT(std::fabs(lfo.value() - row.at[q]) < 1e-4f);
    }
  }
}

MW_TEST("sample-and-hold holds between wraps and draws at them") {
  LfoConfig config;
  config.wave = LfoWave::SampleHold;
  config.rateHz = 10.0f;
  Lfo lfo = prepared(config, 48000.0, 7);
  // 23 000 samples at 10 Hz: wraps at 4800, 9600, 14400 and 19200 — four
  // changes, five held values, all inside [−1, 1).
  std::vector<float> v = render(lfo, held(), 23000);
  int changes = 0;
  std::vector<float> levels;
  levels.push_back(v[0]);
  for (std::size_t i = 1; i < v.size(); ++i) {
    if (v[i] != v[i - 1]) {
      ++changes;
      levels.push_back(v[i]);
    }
  }
  MW_EXPECT_EQ(changes, 4);
  for (const float level : levels) MW_EXPECT(level >= -1.0f && level < 1.0f);
  int distinct = 0;
  for (std::size_t i = 1; i < levels.size(); ++i) {
    if (levels[i] != levels[i - 1]) ++distinct;
  }
  MW_EXPECT(distinct >= 3);
  // The same seed is the same sequence; another seed is another.
  Lfo same = prepared(config, 48000.0, 7);
  Lfo other = prepared(config, 48000.0, 8);
  std::vector<float> s = render(same, held(), 23000);
  std::vector<float> o = render(other, held(), 23000);
  int sameDiffers = 0;
  int otherDiffers = 0;
  for (std::size_t i = 0; i < v.size(); ++i) {
    if (s[i] != v[i]) ++sameDiffers;
    if (o[i] != v[i]) ++otherDiffers;
  }
  MW_EXPECT_EQ(sameDiffers, 0);
  MW_EXPECT(otherDiffers > 0);
}

MW_TEST("SampleInput samples a source on the LFO's own clock") {
  LfoConfig config;
  config.wave = LfoWave::SampleInput;
  config.sampleInput = 3;
  config.rateHz = 10.0f;
  Lfo lfo = prepared(config);
  float sources[kMaxModSources] = {};
  // A ramp on source 3 that changes every sample. The output changes only at
  // the wraps, and at each wrap it is the source's value at that instant.
  int changes = 0;
  float last = lfo.value();
  for (int i = 1; i <= 23000; ++i) {
    sources[3] = static_cast<float>(i) * 1e-4f;
    const float value = lfo.advance(held(), sources, 1);
    if (value != last) {
      ++changes;
      MW_EXPECT(value == sources[3]);
      last = value;
    }
  }
  MW_EXPECT_EQ(changes, 4);
  MW_EXPECT(last > 1.9f);
}

// ────────────────────────────────────────────── retrigger, and the delay

MW_TEST("each retrigger mode answers to its own pulse and no other") {
  LfoConfig config;
  config.wave = LfoWave::Triangle;
  config.rateHz = 5.0f;
  config.retriggerPhase = 0.3f;
  const float step = 5.0f / 48000.0f;

  config.retrigger = LfoRetrigger::Off;
  Lfo off = prepared(config);
  off.advance(held(), nullptr, 4800);
  MW_EXPECT(std::fabs(off.phase() - 0.8f) < 1e-4f);
  off.advance(pressed(), nullptr, 1);
  MW_EXPECT(std::fabs(off.phase() - (0.8f + step)) < 1e-4f);

  config.retrigger = LfoRetrigger::Single;
  Lfo single = prepared(config);
  single.advance(held(), nullptr, 4800);
  single.advance(multiOnly(), nullptr, 1);
  MW_EXPECT(std::fabs(single.phase() - (0.8f + step)) < 1e-4f);
  single.advance(pressed(), nullptr, 1);
  MW_EXPECT(std::fabs(single.phase() - (0.3f + step)) < 1e-4f);

  config.retrigger = LfoRetrigger::Multi;
  Lfo multi = prepared(config);
  multi.advance(held(), nullptr, 4800);
  multi.advance(multiOnly(), nullptr, 1);
  MW_EXPECT(std::fabs(multi.phase() - (0.3f + step)) < 1e-4f);

  config.retrigger = LfoRetrigger::External;
  Lfo external = prepared(config);
  TriggerBus high;
  high.externalTrigger = true;
  external.advance(pressed(), nullptr, 4800);  // not its pulse
  MW_EXPECT(std::fabs(external.phase() - 0.8f) < 1e-4f);
  external.advance(high, nullptr, 1);
  MW_EXPECT(std::fabs(external.phase() - (0.3f + step)) < 1e-4f);
  // Held high is one trigger, not one per step.
  external.advance(high, nullptr, 4800);
  MW_EXPECT(std::fabs(external.phase() - (0.8f + step)) < 1e-4f);
  external.advance(quiet(), nullptr, 1);
  external.advance(high, nullptr, 1);
  MW_EXPECT(std::fabs(external.phase() - (0.3f + step)) < 1e-4f);
}

MW_TEST("with retrigger off the delay still restarts on a note-on") {
  LfoConfig config;
  config.wave = LfoWave::Square;
  config.rateHz = 5.0f;
  config.retrigger = LfoRetrigger::Off;
  config.delaySeconds = 0.1f;
  Lfo lfo = prepared(config);
  lfo.advance(held(), nullptr, 4800);
  MW_EXPECT(lfo.depth() == 1.0f);  // nobody has triggered it: full depth
  const float before = lfo.phase();
  lfo.advance(pressed(), nullptr, 1);
  MW_EXPECT(lfo.depth() == 0.0f);
  MW_EXPECT(lfo.value() == 0.0f);
  MW_EXPECT(std::fabs(lfo.phase() - before) < 1e-3f);  // the phase ran on
  lfo.advance(held(), nullptr, 4800);
  MW_EXPECT(lfo.depth() == 1.0f);
}

MW_TEST("a rate change is continuous in phase and does not restart the delay") {
  LfoConfig config;
  config.wave = LfoWave::Sine;
  config.rateHz = 5.0f;
  config.retrigger = LfoRetrigger::Single;
  config.delaySeconds = 0.5f;
  Lfo lfo = prepared(config);
  lfo.advance(pressed(), nullptr, 28800);  // 0.6 s: 3 cycles, the delay over
  MW_EXPECT(lfo.depth() == 1.0f);
  lfo.advance(held(), nullptr, 3840);  // 0.4 of a cycle further
  const float before = lfo.phase();
  MW_EXPECT(std::fabs(before - 0.4f) < 1e-4f);
  config.rateHz = 2.0f;
  lfo.setConfig(config);
  MW_EXPECT(std::fabs(lfo.phase() - before) < 1e-6f);
  MW_EXPECT(lfo.depth() == 1.0f);
  lfo.advance(held(), nullptr, 4800);  // 0.1 s at 2 Hz is a fifth of a cycle
  MW_EXPECT(std::fabs(lfo.phase() - 0.6f) < 1e-4f);
}

// ───────────────────────────────────────────────── real-time safety, §6.2

MW_TEST("nothing on the audio path allocates, through a retrigger and a redraw") {
  LfoConfig config;
  config.wave = LfoWave::SampleInput;
  config.sampleInput = 5;
  config.rateHz = 40.0f;
  config.retrigger = LfoRetrigger::Multi;
  Lfo lfo = prepared(config);
  float sources[kMaxModSources] = {};
  mw::test::RtGuard guard;
  for (int i = 0; i < 400; ++i) {
    sources[5] = static_cast<float>(i);
    lfo.advance((i % 9) == 0 ? multiOnly() : held(), sources, 64);
  }
  MW_EXPECT_EQ(static_cast<int>(guard.allocations()), 0);
  MW_EXPECT(lfo.value() > 300.0f);
}

MW_TEST("the RtGuard is watching rather than asleep") {
  std::vector<float> scratch;
  mw::test::RtGuard guard;
  scratch.resize(1024);
  MW_EXPECT(guard.allocations() > 0);
}

MW_TEST_MAIN("lfo behaviour")
