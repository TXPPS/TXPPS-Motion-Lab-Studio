// Motion Wave — per-voice drift, the statistics. `lib-voice-substrate.md` §5.4
// and §8: VS-18 and VS-19. The walk's determinism, block and rate invariance
// and real-time safety are `drift_tests.cpp`; the two files are what the walk
// *is* and what it *measures as*.
//
// Every magnitude asserted is the configured one, never the design's literal:
// the design's numbers descend from a table its sheet marks [I], and
// `drift.h` records what replaced each and why. The measurements are
// ensemble ones over 128 oscillators at instants three correlation times
// apart, because a single oscillator's sample statistics over a finite window
// are biased by exactly the correlation this file is trying to measure — and
// the walk is a function of position, so an instant is reached by a jump
// rather than by rendering everything before it.
//
// Measured on this tree, 48 kHz, defaults, and printed by the cases: ensemble
// σ = 2.993 cents over 2432 readings against a configured 3.0; the
// autocorrelation crosses 1/e at 327.7 s against a configured 300 (the
// truncated line shape decays a little slower than the ideal, and the design's
// tolerance is ±15 %); right after a tune the measured-range RMS is 0.329
// cents and the octaves below C3 read 7.3 times that; after a tune the walk
// grows 1.162 / 2.345 / 3.117 cents at 0.1, 0.5 and 3 τ against the conditioned
// process's 1.28 / 2.39 / 3.00.
//
// Mutation-tested, each edit restored before the next, and recorded as
// observed rather than as predicted:
//   the line frequencies drawn uniformly instead of as Lorentzian quantiles
//     → red: VS-18's crossing case and VS-19's resume case; σ stayed green,
//     as it is exact by construction either way.
//   √(2/M) normalisation replaced by 1/M → red: VS-18's σ and crossing cases
//     and both VS-19 cases here, and VS-16's seed case in the other file.
//   (6)'s octave growth removed, k(note) = 1 everywhere → red: VS-19's shape
//     case only.
//   `tune()` not re-anchoring the process → red: both VS-19 cases only.
//   `advance` accumulating frames instead of reading the song position → red:
//     every case here, because a jump no longer reaches the instant it names.
#include "../dsp/voice/drift.h"
#include "harness.h"
#include "rt_guard.h"

#include <cmath>
#include <cstdio>
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

DriftModel prepared(const DriftConfig& config, int voices = 64) {
  DriftModel m;
  m.prepare(kRate, voices, config);
  return m;
}

/// The walk is a function of position, so a jump is a legal way to sample it.
void seek(DriftModel& m, double seconds) { m.advance(seconds, 0); }

/// Every oscillator's walk at the model's current position.
void walks(const DriftModel& m, std::vector<double>& out) {
  out.clear();
  for (int v = 0; v < m.voices(); ++v) {
    for (int o = 0; o < m.oscillators(); ++o) out.push_back(static_cast<double>(m.walkCents(v, o)));
  }
}

double rms(const std::vector<double>& xs) {
  double sum = 0.0;
  for (const double x : xs) sum += x * x;
  return xs.empty() ? 0.0 : std::sqrt(sum / static_cast<double>(xs.size()));
}

}  // namespace

// ──────────────────────────────────────── VS-18: magnitude and correlation

MW_TEST("VS-18 the walk's standard deviation is the configured one at vintage 1") {
  DriftModel m = prepared(vintage(1.0f));
  const double tau = static_cast<double>(m.config().walkSeconds);
  std::vector<double> sample;
  std::vector<double> all;
  for (int k = 0; k < 19; ++k) {
    seek(m, tau * (6.0 + 3.0 * k));
    walks(m, sample);
    all.insert(all.end(), sample.begin(), sample.end());
  }
  MW_EXPECT(all.size() >= 2000);
  std::printf("    ensemble sigma %.3f cents over %d readings\n", rms(all), static_cast<int>(all.size()));
  MW_EXPECT_NEAR(rms(all), static_cast<double>(m.config().pitchWalkCents), 0.3);
}

MW_TEST("VS-18 the autocorrelation crosses 1/e at the configured correlation time") {
  DriftModel m = prepared(vintage(1.0f));
  const double tau = static_cast<double>(m.config().walkSeconds);
  const double lags[] = {0.6, 0.8, 0.9, 1.0, 1.1, 1.2, 1.5};
  double r[7] = {0.0};
  std::vector<double> now;
  std::vector<double> later;
  for (int li = 0; li < 7; ++li) {
    double cross = 0.0;
    double power = 0.0;
    for (int k = 0; k < 19; ++k) {
      const double t = tau * (6.0 + 3.0 * k);
      seek(m, t);
      walks(m, now);
      seek(m, t + lags[li] * tau);
      walks(m, later);
      for (std::size_t i = 0; i < now.size(); ++i) {
        cross += now[i] * later[i];
        power += now[i] * now[i];
      }
    }
    r[li] = cross / power;
  }
  // Monotone through the bracket, and crossing 1/e inside it.
  MW_EXPECT(r[0] > r[6]);
  const double target = std::exp(-1.0);
  double crossing = 0.0;
  for (int li = 0; li < 6; ++li) {
    if (r[li] >= target && r[li + 1] < target) {
      crossing = lags[li] + (lags[li + 1] - lags[li]) * (r[li] - target) / (r[li] - r[li + 1]);
    }
  }
  MW_EXPECT(crossing > 0.0);
  std::printf("    autocorrelation crosses 1/e at %.1f s (tau %.0f); R(0.6) %.3f R(1.0) %.3f R(1.5) %.3f\n",
              crossing * tau, tau, r[0], r[3], r[6]);
  MW_EXPECT_NEAR(crossing * tau, tau, 0.15 * tau);
}

MW_TEST("VS-18 the depth does not depend on how often the walk is stepped: 16, 32 and 64-frame strides agree") {
  constexpr std::int64_t kEnd = 4096 * 50;
  const int strides[] = {16, 32, 64};
  std::vector<float> at[3];
  for (int s = 0; s < 3; ++s) {
    DriftModel m = prepared(vintage(1.0f), 16);
    for (std::int64_t f = 0; f < kEnd; f += strides[s]) {
      m.advance(static_cast<double>(f) / kRate, strides[s]);
    }
    for (int v = 0; v < m.voices(); ++v) {
      for (int o = 0; o < m.oscillators(); ++o) at[s].push_back(m.walkCents(v, o));
    }
  }
  int bad = 0;
  for (std::size_t i = 0; i < at[0].size(); ++i) {
    bad += at[0][i] != at[1][i] ? 1 : 0;
    bad += at[1][i] != at[2][i] ? 1 : 0;
  }
  MW_EXPECT_EQ(bad, 0);
  MW_EXPECT(at[0].size() == 32);
}

// ─────────────────────────────────────────── VS-19: the tune, and the shape

MW_TEST("VS-19 right after a tune the walk is the residual and the table's error is structured by octave") {
  DriftModel m = prepared(vintage(1.0f));
  seek(m, 900.0);
  std::vector<double> before;
  walks(m, before);
  MW_EXPECT(rms(before) > 1.0);

  m.tune();
  const float floor = m.config().tuneResidualCents;
  int outside = 0;
  for (int v = 0; v < m.voices(); ++v) {
    for (int o = 0; o < m.oscillators(); ++o) {
      outside += std::fabs(m.walkCents(v, o)) > floor + 1e-6f ? 1 : 0;
    }
  }
  MW_EXPECT_EQ(outside, 0);

  // Every semitone C0–C8, every oscillator: the three octaves below the
  // calibration floor against the five above it.
  std::vector<double> below;
  std::vector<double> above;
  for (int v = 0; v < m.voices(); ++v) {
    for (int o = 0; o < m.oscillators(); ++o) {
      for (int note = 12; note <= 108; ++note) {
        const double cents = static_cast<double>(m.pitchCents(v, o, static_cast<float>(note)));
        (note < 48 ? below : above).push_back(cents);
      }
    }
  }
  std::printf("    after a tune: RMS %.3f cents in the measured range, %.3f below it (%.1fx)\n",
              rms(above), rms(below), rms(below) / rms(above));
  MW_EXPECT(rms(above) <= 0.4);
  MW_EXPECT_AT_LEAST_TIMES(rms(below), rms(above), 2.5, 0.01);
}

MW_TEST("VS-19 drift resumes after a tune and grows with the walk's own time constant") {
  // Pooled over five tunes at instants far apart, because one tune's 128
  // oscillators put six percent of scatter on each reading and the growth
  // between the last two points is smaller than that on a single realisation.
  DriftModel m = prepared(vintage(1.0f));
  const double tau = static_cast<double>(m.config().walkSeconds);
  const double sigma = static_cast<double>(m.config().pitchWalkCents);
  const double after[3] = {0.1 * tau, 0.5 * tau, 3.0 * tau};
  std::vector<double> pooled[3];
  std::vector<double> w;
  for (int k = 0; k < 5; ++k) {
    const double at = 900.0 + 5000.0 * k;
    seek(m, at);
    m.tune();
    for (int i = 0; i < 3; ++i) {
      seek(m, at + after[i]);
      walks(m, w);
      pooled[i].insert(pooled[i].end(), w.begin(), w.end());
    }
  }
  const double spread[3] = {rms(pooled[0]), rms(pooled[1]), rms(pooled[2])};
  std::printf("    after a tune: %.3f / %.3f / %.3f cents at 0.1, 0.5 and 3 tau\n", spread[0],
              spread[1], spread[2]);
  MW_EXPECT(spread[0] < spread[1]);
  MW_EXPECT(spread[1] < spread[2]);
  // The conditioned process grows as σ·√(1 − e^(−2t/τ)).
  for (int i = 0; i < 3; ++i) {
    const double expected = sigma * std::sqrt(1.0 - std::exp(-2.0 * after[i] / tau));
    MW_EXPECT_NEAR(spread[i], expected, 0.15 * expected);
  }
}

MW_TEST("the RtGuard is watching rather than asleep") {
  DriftModel m;
  mw::test::RtGuard guard;
  m.prepare(kRate, 16, vintage(1.0f));  // `prepare` is the one call allowed to
  MW_EXPECT(guard.allocations() > 0);
}

MW_TEST_MAIN("drift statistics")
