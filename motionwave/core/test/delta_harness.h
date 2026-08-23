// Motion Wave — the measured half of Ledger cell D1, once.
//
// D1 asks two things of a unit: that the controls the UI exposes and the
// setters the DSP has are the same set, and that each setter reaches audio. The
// first is not tested anywhere because it is generated — both tables come out
// of `motionwave/manifests/`, so a control naming a parameter the processor
// does not have fails to compile. The second has to be measured, and this is
// the measurement.
//
// It is a header rather than a third copy of the same file. By the Optical
// Leveller there were three units wanting an identical sweep, and three copies
// of a test is the drift the manifests exist to prevent, one level up: the
// first time one of them gained a case the others would silently be weaker.
// What stays per unit is what is genuinely that unit's — the base
// configuration, and any locality check its own parameters need.
#pragma once

#include "harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

namespace mw::test {

/// RMS of the sample-by-sample difference, in dBFS.
inline double differenceDb(const std::vector<float>& a, const std::vector<float>& b) {
  double sum = 0.0;
  const std::size_t count = std::min(a.size(), b.size());
  for (std::size_t i = 0; i < count; ++i) {
    const double d = static_cast<double>(a[i]) - static_cast<double>(b[i]);
    sum += d * d;
  }
  if (count == 0) return -200.0;
  const double rms = std::sqrt(sum / static_cast<double>(count));
  return rms > 0.0 ? 20.0 * std::log10(rms) : -200.0;
}

inline double peakOf(const std::vector<float>& v) {
  double top = 0.0;
  for (float s : v) top = std::max(top, std::fabs(static_cast<double>(s)));
  return top;
}

/**
 * Sweep every parameter and require an audible difference.
 *
 * `render(id, value)` must produce a render with that parameter set and
 * everything else at the unit's base configuration. `rows` is the generated
 * table, which carries each parameter's own gate — one number for a whole unit
 * cannot grade a control whose specification places it below that number, and
 * the noise floors are exactly that case.
 */
template <typename Row, typename RenderFn>
void expectEveryParameterReachesAudio(const Row* rows, int count, RenderFn&& render) {
  for (int i = 0; i < count; ++i) {
    const Row& row = rows[i];
    const std::vector<float> low = render(row.id, row.deltaLow);
    const std::vector<float> high = render(row.id, row.deltaHigh);
    // A pair of silent renders would "differ" by nothing and pass a
    // badly-written version of this, so the signal is confirmed present before
    // the difference is believed.
    MW_EXPECT(peakOf(low) > 1.0e-3);
    MW_EXPECT(peakOf(high) > 1.0e-3);
    const double delta = differenceDb(low, high);
    std::printf("  D1 %-16s %9.4g -> %-9.4g difference %7.2f dBFS (gate %.0f)\n", row.symbol,
                row.deltaLow, row.deltaHigh, delta, row.deltaFloorDb);
    if (delta <= row.deltaFloorDb) {
      std::printf("    ^ this parameter's setter does not reach the audio.\n");
    }
    MW_EXPECT(delta > row.deltaFloorDb);
  }
}

/**
 * Two renders of the same setting must be identical.
 *
 * Without this, a unit whose output depended on something other than its
 * parameters — an uninitialised field, a clock, a random seed — would pass
 * every delta above while proving nothing, because every pair would differ. It
 * is also what makes a deterministic noise source a requirement rather than a
 * nicety in the units that have one.
 */
template <typename Row, typename RenderFn>
void expectRendersAreDeterministic(const Row* rows, int count, RenderFn&& render) {
  for (int i = 0; i < count; ++i) {
    const Row& row = rows[i];
    const std::vector<float> a = render(row.id, row.deltaHigh);
    const std::vector<float> b = render(row.id, row.deltaHigh);
    double worst = 0.0;
    const std::size_t span = std::min(a.size(), b.size());
    for (std::size_t k = 0; k < span; ++k) {
      worst = std::max(worst, std::fabs(static_cast<double>(a[k] - b[k])));
    }
    MW_EXPECT_NEAR(worst, 0.0, 0.0);
  }
}

/**
 * The same input must render the same audio whatever block size the host uses.
 *
 * This is a D1-class claim rather than a per-unit one, so it lives here: any
 * state a unit shares across channels, or resets at a block boundary, or sizes
 * from `blockSize`, breaks it, and none of those show up in a mono render or in
 * a spectrum unless you already suspect them. The FET Limiter shared one
 * oversampler between its two channels with the channel loop outside the sample
 * loop, so the right channel ran through the left channel's halfband history
 * and every block boundary was a discontinuity. It measured as sidebands at
 * exactly the block rate — -32.7 dBc at 64 frames, -47.9 dBc at 256 — and it
 * meant an export and a realtime render of the same project did not agree.
 *
 * `render` is given a block size and must feed the unit that many frames at a
 * time, in stereo, and return the whole output. Comparing bit-for-bit is
 * deliberate: a unit that is block-size dependent is dependent by a mechanism,
 * and mechanisms do not produce differences that happen to be under a
 * tolerance.
 */
template <typename RenderFn>
void expectBlockSizeIndependent(RenderFn&& render, const int* blockSizes, int count) {
  if (count < 2) {
    MW_EXPECT(count >= 2);
    return;
  }
  const std::vector<float> reference = render(blockSizes[0]);
  MW_EXPECT(!reference.empty());
  for (int i = 1; i < count; ++i) {
    const std::vector<float> other = render(blockSizes[i]);
    double worst = 0.0;
    std::size_t at = 0;
    const std::size_t span = std::min(reference.size(), other.size());
    for (std::size_t k = 0; k < span; ++k) {
      const double d = std::fabs(static_cast<double>(reference[k]) - static_cast<double>(other[k]));
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (worst > 0.0) {
      std::printf("    block size %d against %d: worst difference %.3e at sample %zu\n",
                  blockSizes[i], blockSizes[0], worst, at);
    }
    MW_EXPECT(reference.size() == other.size());
    MW_EXPECT_NEAR(worst, 0.0, 0.0);
  }
}

}  // namespace mw::test
