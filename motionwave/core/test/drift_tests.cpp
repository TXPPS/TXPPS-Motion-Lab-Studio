// Motion Wave — per-voice drift. `lib-voice-substrate.md` §5.4 and §8: VS-16,
// VS-17, the drift's halves of VS-07 and VS-08, and VS-31. The statistics —
// VS-18 and VS-19 — are `drift_statistics_tests.cpp`; the two files are what
// the walk *is* and what it *measures as*.
//
// VS-16's song-position case is the one that shaped the implementation. A
// render of bars 33–40 has to match the tail of a render of bars 1–40 to the
// bit, and an Ornstein–Uhlenbeck *step* cannot do that — its state at bar 33
// is the history of bars 1–32. `drift.h` synthesises the walk as a function of
// song position with the OU process's own statistics instead, which is also
// what makes every block size and every stride evaluate the same arithmetic
// on the same numbers, so those cases are equalities rather than tolerances.
//
// Mutation-tested, each edit restored before the next, and recorded as
// observed rather than as predicted:
//   `advance` accumulating frames instead of reading the song position — the
//     recursion the design's step would have been → red: VS-16's song-position
//     and seed cases here, and every statistics case in the other file. VS-07's
//     block case stayed green, correctly: every split accumulates the same
//     frames. The song-position case is the one that separates the two.
//   `vintage` no longer scaling the walk → red: VS-17 only.
//   the seed ignored in the line draws → red: VS-16's seed case only, and
//     only because its bar is one σ: the calibration tables still differ by
//     seed, and a bar under 1.5 cents would have been cleared by them alone.
//   √(2/M) normalisation replaced by 1/M → red: VS-16's seed case here, and
//     the σ, crossing and both VS-19 cases in the other file.
//   `advance` evaluating at the start of the step rather than its end → red:
//     VS-07's block case here and VS-18's stride case there; nothing else.
#include "../dsp/voice/drift.h"
#include "harness.h"
#include "rt_guard.h"

#include <cmath>
#include <cstdint>
#include <vector>

using namespace mw;
using namespace mw::dsp::voice;

namespace {

constexpr double kRate = 48000.0;

DriftConfig vintage(float amount) {
  DriftConfig c;
  c.vintage = amount;
  return c;
}

DriftModel prepared(const DriftConfig& config, int voices = 16, double rate = kRate) {
  DriftModel m;
  m.prepare(rate, voices, config);
  return m;
}

/// The walk is a function of position, so a jump is a legal way to sample it.
void seek(DriftModel& m, double seconds) { m.advance(seconds, 0); }

/// Advances in `block`-frame steps to `endFrame` and returns every pitch.
std::vector<float> runTo(DriftModel& m, int block, std::int64_t endFrame) {
  for (std::int64_t f = 0; f < endFrame; f += block) {
    m.advance(static_cast<double>(f) / kRate, block);
  }
  std::vector<float> out;
  for (int v = 0; v < m.voices(); ++v) {
    for (int o = 0; o < m.oscillators(); ++o) out.push_back(m.pitchCents(v, o, 60.0f));
  }
  return out;
}

int mismatches(const std::vector<float>& a, const std::vector<float>& b) {
  int n = a.size() == b.size() ? 0 : 1;
  for (std::size_t i = 0; i < a.size() && i < b.size(); ++i) n += a[i] != b[i] ? 1 : 0;
  return n;
}

}  // namespace

// ────────────────────────────────────────────────── VS-17: off by default

MW_TEST("VS-17 at vintage zero every deviation is exactly zero, so two voices on one key null") {
  DriftModel m = prepared(vintage(0.0f));
  seek(m, 123.4);
  int nonzero = 0;
  for (int v = 0; v < m.voices(); ++v) {
    nonzero += m.cutoffFactor(v) != 1.0f ? 1 : 0;
    nonzero += m.envelopeTimeFactor(v) != 1.0f ? 1 : 0;
    nonzero += m.vcaGainDb(v) != 0.0f ? 1 : 0;
    for (int o = 0; o < m.oscillators(); ++o) {
      nonzero += m.pitchCents(v, o, 60.0f) != 0.0f ? 1 : 0;
      nonzero += m.pitchCents(v, o, 24.0f) != 0.0f ? 1 : 0;
      nonzero += m.walkCents(v, o) != 0.0f ? 1 : 0;
      nonzero += m.pulseWidthFactor(v, o) != 1.0f ? 1 : 0;
    }
  }
  MW_EXPECT_EQ(nonzero, 0);

  // Non-vacuity: the same model with the control up is not silent, so the
  // zeros above are the control and not a model that never drifts.
  m.setConfig(vintage(1.0f));
  seek(m, 123.4);
  int moving = 0;
  for (int v = 0; v < m.voices(); ++v) {
    for (int o = 0; o < m.oscillators(); ++o) moving += m.pitchCents(v, o, 60.0f) != 0.0f ? 1 : 0;
  }
  MW_EXPECT(moving > 0);
}

// ─────────────────────────────────────────────────── VS-16: determinism

MW_TEST("VS-16 two models with one seed render the same drift, bit for bit") {
  DriftModel a = prepared(vintage(1.0f));
  DriftModel b = prepared(vintage(1.0f));
  MW_EXPECT_EQ(mismatches(runTo(a, 1024, 1024 * 400), runTo(b, 1024, 1024 * 400)), 0);
}

MW_TEST("VS-16 a render that starts at bar 33 matches the tail of one that ran from bar 1, exactly") {
  // Two-second bars: bar 33 starts at 64 s and bar 40 ends at 80 s. The tail
  // render is prepared cold and told only where the song is.
  constexpr std::int64_t kTailStart = 64 * 48000;
  constexpr std::int64_t kEnd = 80 * 48000;
  DriftModel whole = prepared(vintage(1.0f));
  DriftModel tail = prepared(vintage(1.0f));
  int bad = 0;
  int compared = 0;
  for (std::int64_t f = 0; f < kEnd; f += 1024) {
    whole.advance(static_cast<double>(f) / kRate, 1024);
    if (f < kTailStart) continue;
    tail.advance(static_cast<double>(f) / kRate, 1024);
    for (int v = 0; v < whole.voices(); ++v) {
      for (int o = 0; o < whole.oscillators(); ++o) {
        bad += whole.pitchCents(v, o, 60.0f) != tail.pitchCents(v, o, 60.0f) ? 1 : 0;
        ++compared;
      }
    }
  }
  MW_EXPECT_EQ(bad, 0);
  MW_EXPECT(compared > 10000);
}

MW_TEST("VS-16 changing only the seed changes the drift, so the cases above are not passing on silence") {
  DriftConfig a = vintage(1.0f);
  DriftConfig b = a;
  b.seed ^= 0x1234567ull;
  DriftModel ma = prepared(a);
  DriftModel mb = prepared(b);
  float worst = 0.0f;
  for (int k = 1; k <= 20; ++k) {
    seek(ma, 900.0 * k);
    seek(mb, 900.0 * k);
    for (int v = 0; v < ma.voices(); ++v) {
      for (int o = 0; o < ma.oscillators(); ++o) {
        const float d = std::fabs(ma.pitchCents(v, o, 60.0f) - mb.pitchCents(v, o, 60.0f));
        if (d > worst) worst = d;
      }
    }
  }
  // One σ. The calibration tables alone can differ by at most 1.5 cents
  // between seeds, so a walk that ignored its seed would still clear a
  // smaller bar on the strength of the tables.
  MW_EXPECT(worst > 3.0f);
}

MW_TEST("a tune is addressed by its count, so the third tune of a replay is the same third tune") {
  DriftModel a = prepared(vintage(1.0f));
  DriftModel b = prepared(vintage(1.0f));
  for (DriftModel* m : {&a, &b}) {
    seek(*m, 10.0);
    m->tune();
    seek(*m, 20.0);
    m->tune();
    seek(*m, 25.0);
  }
  int bad = 0;
  for (int v = 0; v < a.voices(); ++v) {
    for (int o = 0; o < a.oscillators(); ++o) {
      bad += a.pitchCents(v, o, 30.0f) != b.pitchCents(v, o, 30.0f) ? 1 : 0;
      bad += a.pitchCents(v, o, 72.0f) != b.pitchCents(v, o, 72.0f) ? 1 : 0;
    }
  }
  MW_EXPECT_EQ(bad, 0);
  MW_EXPECT_EQ(a.tuneCount(), 2);
}

// ───────────────────────────────────── VS-07 and VS-08: blocks and rates

MW_TEST("VS-07 the walk is a function of the frame: 16, 17, 64, 128 and 1024-frame blocks agree exactly") {
  // 69632 is divisible by every block size in the design's list, so each run
  // lands on the same frame and the comparison is an equality, not a tolerance.
  constexpr std::int64_t kEnd = 69632;
  const int sizes[] = {16, 17, 64, 128, 1024};
  DriftModel reference = prepared(vintage(1.0f));
  const std::vector<float> expected = runTo(reference, 128, kEnd);
  for (const int block : sizes) {
    DriftModel m = prepared(vintage(1.0f));
    MW_EXPECT_EQ(mismatches(runTo(m, block, kEnd), expected), 0);
  }
  // And not because nothing moved: the walk at the end is not the walk at 0.
  DriftModel fresh = prepared(vintage(1.0f));
  const std::vector<float> start = runTo(fresh, 128, 0);
  MW_EXPECT(mismatches(start, expected) > 0);
}

MW_TEST("VS-08 the same seed drifts the same way in seconds at 44.1, 48, 96 and 192 kHz") {
  const double rates[] = {44100.0, 48000.0, 96000.0, 192000.0};
  DriftModel reference = prepared(vintage(1.0f), 16, 48000.0);
  for (const double t : {37.3, 250.0, 1234.5}) {
    seek(reference, t);
    float largest = 0.0f;
    for (const double rate : rates) {
      DriftModel m = prepared(vintage(1.0f), 16, rate);
      seek(m, t);
      for (int v = 0; v < m.voices(); ++v) {
        for (int o = 0; o < m.oscillators(); ++o) {
          // The grid cells fall at different times per rate, so the straight
          // lines between them differ; the process itself does not.
          MW_EXPECT_NEAR(m.pitchCents(v, o, 60.0f), reference.pitchCents(v, o, 60.0f), 0.05);
          const float mag = std::fabs(m.pitchCents(v, o, 60.0f));
          if (mag > largest) largest = mag;
        }
      }
    }
    MW_EXPECT(largest > 0.2f);
  }
}

// ──────────────────────────────────────────── the fixed per-voice spreads

MW_TEST("fixed deviations are per voice, bounded by their configured spread and scaled by vintage") {
  DriftModel m = prepared(vintage(1.0f), 32);
  const DriftConfig& c = m.config();
  int outside = 0;
  int distinct = 0;
  for (int v = 0; v < m.voices(); ++v) {
    outside += std::fabs(m.cutoffFactor(v) - 1.0f) > c.cutoffPercent * 0.01f + 1e-6f ? 1 : 0;
    outside += std::fabs(m.envelopeTimeFactor(v) - 1.0f) > c.envelopeTimePercent * 0.01f + 1e-6f ? 1 : 0;
    outside += std::fabs(m.vcaGainDb(v)) > c.vcaGainDb + 1e-6f ? 1 : 0;
    outside += std::fabs(m.pulseWidthFactor(v, 0) - 1.0f) > c.pulseWidthPercent * 0.01f + 1e-6f ? 1 : 0;
    distinct += m.cutoffFactor(v) != m.cutoffFactor(0) ? 1 : 0;
    distinct += m.pulseWidthFactor(v, 0) != m.pulseWidthFactor(v, 1) ? 1 : 0;
  }
  MW_EXPECT_EQ(outside, 0);
  MW_EXPECT(distinct > 8);

  // Half the control is half the deviation, exactly: one scalar, no curve.
  DriftModel half = prepared(vintage(0.5f), 32);
  for (int v = 0; v < m.voices(); ++v) {
    MW_EXPECT_NEAR(half.cutoffFactor(v) - 1.0f, 0.5f * (m.cutoffFactor(v) - 1.0f), 1e-6);
    MW_EXPECT_NEAR(half.vcaGainDb(v), 0.5f * m.vcaGainDb(v), 1e-6);
  }
}

// ──────────────────────────────────────────────── real-time safety, VS-31

MW_TEST("VS-31 advancing, tuning and reading allocate nothing") {
  DriftModel m = prepared(vintage(1.0f), 16);
  mw::test::RtGuard guard;
  float sink = 0.0f;
  for (int block = 0; block < 300; ++block) {
    m.advance(static_cast<double>(block) * 1024.0 / kRate, 1024);
    if (block == 100) m.tune();
    if (block == 200) m.reset();
    for (int v = 0; v < m.voices(); ++v) {
      sink += m.pitchCents(v, 0, 60.0f) + m.cutoffFactor(v) + m.envelopeTimeFactor(v) + m.vcaGainDb(v) +
              m.pulseWidthFactor(v, 1);
    }
  }
  MW_EXPECT_EQ(static_cast<int>(guard.allocations()), 0);
  MW_EXPECT(sink == sink);
}

MW_TEST("the RtGuard is watching rather than asleep") {
  DriftModel m;
  mw::test::RtGuard guard;
  m.prepare(kRate, 16, vintage(1.0f));  // `prepare` is the one call allowed to
  MW_EXPECT(guard.allocations() > 0);
}

MW_TEST_MAIN("drift")
