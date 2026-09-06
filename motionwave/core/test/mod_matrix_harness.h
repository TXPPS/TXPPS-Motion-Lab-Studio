// Motion Wave — what the modulation matrix's two suites share.
//
// `mod_matrix_tests.cpp` holds the sheets' rows — V-18 and the laws — and
// `mod_matrix_model_tests.cpp` holds the model's own contract: counts,
// refusals, removal, the allocation guard, determinism. Both build the same
// sampler-shaped matrix from the same capacities, and two copies of `smp-01`
// §6.1's numbers would be two places for them to disagree — the first file to
// gain a correction leaving the other quietly checking a different instrument.
// So the fixture is here once, as `granular_delay_harness.h` is for that
// unit's suites, and each file keeps only what is its own.
#pragma once

#include "../dsp/mod/mod_matrix.h"
#include "harness.h"

#include <cstring>

namespace mw::test::modmatrix {

/// The sampler's capacities, `smp-01` §6.1 — the consumer states them, the
/// matrix does not know them.
inline dsp::mod::MatrixConfig samplerConfig() {
  dsp::mod::MatrixConfig c;
  c.sources = 24;
  c.destinations = 34;
  c.maxRoutings = 16;
  c.maxSourcesPerDestination = 6;
  return c;
}

/// The suites' own names for a few of the sampler's 34 slots, in the order
/// `smp-01` §6.3 lists them. The matrix does not know that list and must
/// not: the sampler supplies it, and `syn-05` §9.3/§9.4 are the other
/// consumer's.
constexpr int kPitch = 0;      ///< semitones
constexpr int kCutoff = 22;    ///< the destination V-18 names
constexpr int kLfo1Rate = 30;  ///< a generator's own parameter
constexpr int kSrcLfo1 = 11;   ///< `smp-01` §6.2: LFO 1 is source 11

inline dsp::mod::ModMatrix samplerMatrix() {
  dsp::mod::ModMatrix m;
  MW_EXPECT(m.prepare(samplerConfig()));
  return m;
}

inline dsp::mod::DestinationSpec spec(float fullScale, float minimum, float maximum) {
  dsp::mod::DestinationSpec s;
  s.fullScale = fullScale;
  s.minimum = minimum;
  s.maximum = maximum;
  return s;
}

inline dsp::mod::Routing route(int source, int destination, float amount, bool quantise = false) {
  dsp::mod::Routing r;
  r.source = source;
  r.destination = destination;
  r.amount = amount;
  r.quantise = quantise;
  return r;
}

/// A frame with every source at one value.
inline dsp::voice::ModFrame frameAt(float value) {
  dsp::voice::ModFrame f;
  for (float& s : f.sources) s = value;
  return f;
}

/// Equal to the bit — the only equality a determinism claim can be made in.
inline bool sameBits(const float* a, const float* b, int n) {
  return std::memcmp(a, b, sizeof(float) * static_cast<std::size_t>(n)) == 0;
}

}  // namespace mw::test::modmatrix
