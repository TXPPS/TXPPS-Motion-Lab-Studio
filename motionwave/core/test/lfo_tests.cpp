// Motion Wave — the LFO's verification rows. `lib-voice-substrate.md` §5.3, §8.
//
// VS-13, VS-14 and VS-15, the LFO's halves of VS-07 and VS-08, and its half of
// VS-31. The class's own contract — waveforms, sample-and-hold, `SampleInput`,
// the retrigger modes, the rate change — is `lfo_behaviour_tests.cpp`; the
// two files are the design's claims and the implementation's.
//
// Every number is derived: 0.25 is 250 ms × 5 Hz modulo 1, 0.85 and 0.188 are
// a measured slider position's two stages, 0.99 of a linear fade lands at
// 0.99 of its length, and the block sizes are the design's five.
//
// Mutation-tested against both LFO suites, each edit restored before the next:
//   sample-and-hold drawn from the sample the wrap was *noticed* at, rather
//     than from the wrap index → red: VS-07 only. That is the block-invariance
//     claim exactly: the wrap is noticed at a different sample in every split.
//   a one-stage delay, fading from the trigger with no silent period → red:
//     VS-14, VS-08's delay half, and "with retrigger off the delay still
//     restarts" (its depth is no longer zero at the trigger).
//   `Single` retrigger answering to `multi` → red: VS-13's instrument case (the
//     second voice's note-on resets the instrument's LFO) and the retrigger
//     modes case; nothing else.
//   `Maximum` combining as a sum → red: VS-15 only.
//   `Maximum` taking its sign from the larger source → red: VS-15 only.
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

/// A note-on to a voice that is already gated, or to a gated instrument.
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

/// Samples of `advance(bus, nullptr, 1)`, one per frame; `first` for the first.
std::vector<float> render(Lfo& lfo, const TriggerBus& first, const TriggerBus& rest,
                          int frames) {
  std::vector<float> out;
  out.reserve(static_cast<std::size_t>(frames));
  out.push_back(lfo.advance(first, nullptr, 1));
  for (int i = 1; i < frames; ++i) out.push_back(lfo.advance(rest, nullptr, 1));
  return out;
}

/// `a − b` folded into [0, 1).
float phaseDifference(float a, float b) {
  const float d = a - b;
  return d - std::floor(d);
}

}  // namespace

// ──────────────────────────────────────────────────────────────── VS-13

MW_TEST("VS-13 an instrument-scoped LFO modulates two voices in phase") {
  LfoConfig config;
  config.scope = LfoScope::Instrument;
  config.retrigger = LfoRetrigger::Single;
  config.wave = LfoWave::Sine;
  config.rateHz = 5.0f;
  Lfo lfo = prepared(config);
  // The instrument's bus: the first voice's note-on is a `single`, because
  // nothing was sounding; the second voice's, 250 ms later, is a `multi`.
  lfo.advance(pressed(), nullptr, 12000);
  const float beforeSecondNote = lfo.phase();
  lfo.advance(multiOnly(), nullptr, 1);
  // One object, one phase: the two voices read the same number, exactly.
  const float voiceA = lfo.value();
  const float voiceB = lfo.value();
  MW_EXPECT(voiceA == voiceB);
  // The claim that carries weight: the second note-on did not reset it. Five
  // hertz for 250 ms is 1.25 cycles, so the phase is 0.25 plus one sample.
  MW_EXPECT(std::fabs(beforeSecondNote - 0.25f) < 1e-4f);
  MW_EXPECT(std::fabs(lfo.phase() - (0.25f + 5.0f / 48000.0f)) < 1e-4f);
  lfo.advance(held(), nullptr, 35999);
  // One second in: five whole cycles, so the phase is back at zero.
  const float wrapped = phaseDifference(lfo.phase(), 0.0f);
  MW_EXPECT(wrapped < 1e-4f || wrapped > 1.0f - 1e-4f);
}

MW_TEST("VS-13 voice-scoped LFOs are offset by the interval between their notes") {
  LfoConfig config;
  config.scope = LfoScope::Voice;
  config.retrigger = LfoRetrigger::Single;
  config.wave = LfoWave::Sine;
  config.rateHz = 5.0f;
  Lfo a = prepared(config);
  Lfo b = prepared(config);
  a.advance(pressed(), nullptr, 12000);
  b.advance(quiet(), nullptr, 12000);
  a.advance(held(), nullptr, 1);
  b.advance(pressed(), nullptr, 1);
  for (int i = 0; i < 50; ++i) {
    a.advance(held(), nullptr, 480);
    b.advance(held(), nullptr, 480);
  }
  // 250 ms × 5 Hz = 1.25 cycles: a leads b by a quarter of a cycle.
  MW_EXPECT(std::fabs(phaseDifference(a.phase(), b.phase()) - 0.25f) < 1e-4f);
  // Non-vacuity: both moved, and they are not both sitting at zero.
  MW_EXPECT(a.phase() != b.phase());
  MW_EXPECT(std::fabs(a.value()) + std::fabs(b.value()) > 0.1f);
}

// ──────────────────────────────────────────────────────────────── VS-14

MW_TEST("VS-14 the delay is two stages: exact silence, then a fade that lands on time") {
  LfoConfig config;
  config.wave = LfoWave::Square;  // |output| is the depth envelope itself
  config.rateHz = 5.0f;
  config.retrigger = LfoRetrigger::Single;
  config.delaySeconds = 0.85f;
  config.fadeSeconds = 0.188f;
  Lfo lfo = prepared(config);
  std::vector<float> v = render(lfo, pressed(), held(), 60000);
  int firstNonZero = -1;
  for (std::size_t i = 0; i < v.size(); ++i) {
    if (v[i] != 0.0f) {
      firstNonZero = static_cast<int>(i);
      break;
    }
  }
  MW_EXPECT(firstNonZero > 0);
  const double silence = static_cast<double>(firstNonZero) / 48000.0;
  MW_EXPECT(std::fabs(silence - 0.85) <= 0.85 * 0.05);
  // A one-stage model fades from the first sample and has no silent region at
  // all; this one is silent for four fifths of a second.
  MW_EXPECT(silence > 0.8);
  int at99 = -1;
  for (std::size_t i = static_cast<std::size_t>(firstNonZero); i < v.size(); ++i) {
    if (std::fabs(v[i]) >= 0.99f) {
      at99 = static_cast<int>(i);
      break;
    }
  }
  MW_EXPECT(at99 > firstNonZero);
  const double fade = static_cast<double>(at99 - firstNonZero) / 48000.0;
  MW_EXPECT(std::fabs(fade - 0.188) <= 0.188 * 0.05);
  // Monotonic through the fade, and full depth after it.
  for (int i = firstNonZero + 1; i <= at99; ++i) {
    MW_EXPECT(std::fabs(v[static_cast<std::size_t>(i)]) >=
              std::fabs(v[static_cast<std::size_t>(i - 1)]));
  }
  MW_EXPECT(std::fabs(v.back()) == 1.0f);
}

// ──────────────────────────────────────────────────────────────── VS-15

MW_TEST("VS-15 Maximum takes the larger contribution and not the sum") {
  LfoConfig config;
  config.wave = LfoWave::Sine;
  config.rateHz = 5.0f;
  Lfo lfo = prepared(config);
  const float wheel = 1.0f;
  float peakMaximum = 0.0f;
  float peakSum = 0.0f;
  for (int i = 0; i < 9600; ++i) {
    const float l = lfo.advance(held(), nullptr, 1);
    peakMaximum = std::fmax(peakMaximum, std::fabs(combine(ModCombine::Maximum, l, wheel)));
    peakSum = std::fmax(peakSum, std::fabs(combine(ModCombine::Sum, l, wheel)));
  }
  // Within 2 % of the larger contribution, and at least 40 % below their sum.
  MW_EXPECT(std::fabs(peakMaximum - 1.0f) <= 0.02f);
  MW_EXPECT(peakMaximum <= 0.6f * peakSum);
  MW_EXPECT(peakSum > 1.9f);
  // Sign from the first source, whichever is larger.
  MW_EXPECT(combine(ModCombine::Maximum, -0.2f, 0.9f) == -0.9f);
  MW_EXPECT(combine(ModCombine::Maximum, 0.2f, -0.9f) == 0.9f);
  MW_EXPECT(combine(ModCombine::Maximum, -0.9f, 0.2f) == -0.9f);
}

// ──────────────────────────────────────────────────────── VS-07 and VS-08

MW_TEST("VS-07 the LFO is identical at every block size") {
  const LfoWave waves[4] = {LfoWave::Sine, LfoWave::SampleHold, LfoWave::Noise,
                            LfoWave::Triangle};
  const int blocks[5] = {16, 17, 64, 128, 1024};
  for (const LfoWave wave : waves) {
    float ends[5] = {0, 0, 0, 0, 0};
    float phases[5] = {0, 0, 0, 0, 0};
    for (int b = 0; b < 5; ++b) {
      LfoConfig config;
      config.wave = wave;
      config.rateHz = 7.3f;
      config.retrigger = LfoRetrigger::Single;
      config.delaySeconds = 0.05f;
      config.fadeSeconds = 0.1f;
      Lfo lfo = prepared(config);
      lfo.advance(pressed(), nullptr, blocks[b]);
      int frames = blocks[b];
      while (frames + blocks[b] <= 9600) {
        lfo.advance(held(), nullptr, blocks[b]);
        frames += blocks[b];
      }
      if (frames < 9600) lfo.advance(held(), nullptr, 9600 - frames);
      ends[b] = lfo.value();
      phases[b] = lfo.phase();
    }
    // The same bits, not nearly the same: the phase is derived from a count.
    for (int b = 1; b < 5; ++b) {
      MW_EXPECT(std::fabs(ends[b] - ends[0]) <= 6e-8f);
      MW_EXPECT(phases[b] == phases[0]);
    }
    MW_EXPECT(ends[0] != 0.0f);
  }
}

MW_TEST("VS-08 the LFO period and delay are the same seconds at every host rate") {
  const double rates[4] = {44100.0, 48000.0, 96000.0, 192000.0};
  double periods[4] = {0, 0, 0, 0};
  double silences[4] = {0, 0, 0, 0};
  for (int r = 0; r < 4; ++r) {
    LfoConfig config;
    config.wave = LfoWave::Sine;
    config.rateHz = 5.0f;
    config.retrigger = LfoRetrigger::Single;
    config.delaySeconds = 0.11f;
    Lfo lfo = prepared(config, rates[r]);
    // Rising zero crossings of the phase: the first is at 0.2 s and the fifth
    // at 1.0 s, so four periods lie between them.
    int crossings = 0;
    int first = -1;
    int fifth = -1;
    int firstNonZero = -1;
    float lastPhase = lfo.phase();
    const int total = static_cast<int>(rates[r] * 1.1);
    for (int i = 1; i <= total; ++i) {
      const float value = lfo.advance(i == 1 ? pressed() : held(), nullptr, 1);
      if (firstNonZero < 0 && value != 0.0f) firstNonZero = i;
      const float p = lfo.phase();
      if (p < lastPhase) {
        ++crossings;
        if (crossings == 1) first = i;
        if (crossings == 5) fifth = i;
      }
      lastPhase = p;
    }
    MW_EXPECT(first > 0);
    MW_EXPECT(fifth > first);
    periods[r] = static_cast<double>(fifth - first) / (4.0 * rates[r]);
    silences[r] = static_cast<double>(firstNonZero) / rates[r];
  }
  MW_EXPECT(std::fabs(periods[0] - 0.2) < 0.001);
  MW_EXPECT(std::fabs(silences[0] - 0.11) < 0.001);
  for (int r = 1; r < 4; ++r) {
    MW_EXPECT(std::fabs(periods[r] - periods[0]) / periods[0] < 0.005);
    MW_EXPECT(std::fabs(silences[r] - silences[0]) / silences[0] < 0.005);
  }
}

// ───────────────────────────────────────────────── real-time safety, §6.2

MW_TEST("nothing on the audio path allocates") {
  const LfoWave waves[8] = {LfoWave::Triangle, LfoWave::SawUp,      LfoWave::SawDown,
                            LfoWave::Square,   LfoWave::Sine,       LfoWave::SampleHold,
                            LfoWave::Noise,    LfoWave::SampleInput};
  Lfo lfos[8];
  for (int i = 0; i < 8; ++i) {
    LfoConfig config;
    config.wave = waves[i];
    config.rateHz = 3.0f + static_cast<float>(i);
    config.retrigger = static_cast<LfoRetrigger>(i % 4);
    config.delaySeconds = 0.01f;
    config.fadeSeconds = 0.02f;
    config.sampleInput = static_cast<std::uint8_t>(i);
    lfos[i] = prepared(config, 48000.0, static_cast<std::uint64_t>(i));
  }
  float sources[kMaxModSources] = {};
  mw::test::RtGuard guard;
  TriggerBus bus = pressed();
  for (int i = 0; i < 500; ++i) {
    for (Lfo& lfo : lfos) sources[i % kMaxModSources] = lfo.advance(bus, sources, 64);
    bus.single = (i % 37) == 0;
    bus.multi = (i % 13) == 0;
    bus.externalTrigger = (i % 7) < 3;
    if (i == 250) {
      LfoConfig config = lfos[0].config();
      config.rateHz = 9.0f;
      lfos[0].setConfig(config);
    }
  }
  for (Lfo& lfo : lfos) lfo.reset();
  MW_EXPECT_EQ(static_cast<int>(guard.allocations()), 0);
}

MW_TEST("the RtGuard is watching rather than asleep") {
  std::vector<float> scratch;
  mw::test::RtGuard guard;
  scratch.resize(1024);
  MW_EXPECT(guard.allocations() > 0);
}

MW_TEST_MAIN("lfo")
