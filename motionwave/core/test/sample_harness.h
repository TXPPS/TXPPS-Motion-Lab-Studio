// Motion Wave — shared fixtures for the Slipstream Sampler's classic engine.
//
// Five suites share these: the read head's own rows, the loop modes, the
// rate-and-block sweep, the sinc table and the pyramid. What lives here is the
// apparatus — how a zone is made, how a render is driven, how a frequency and
// an alias floor are measured — so that a number printed by one suite means
// the same thing when another prints it.
#pragma once

#include "../dsp/sample/classic_read.h"
#include "harness.h"
#include "spectrum.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <vector>

namespace mw::test::sample {

constexpr double kPi = 3.14159265358979323846;

using mw::dsp::sample::ClassicRead;
using mw::dsp::sample::ClassicSource;
using mw::dsp::sample::LoopMode;
using mw::dsp::sample::MipMap;
using mw::dsp::sample::Quality;
using mw::dsp::sample::SincTable;

inline const char* tierName(Quality q) {
  return q == Quality::Eco ? "Eco   " : (q == Quality::Normal ? "Normal" : "High  ");
}

inline const char* modeName(LoopMode m) {
  switch (m) {
    case LoopMode::NoLoop:
      return "no_loop        ";
    case LoopMode::Continuous:
      return "loop_continuous";
    case LoopMode::Sustain:
      return "loop_sustain   ";
    case LoopMode::Alternate:
    default:
      return "alternate      ";
  }
}

/// One table for the whole binary: it is built once per instrument in the
/// product and there is no reason a test should pay for it per case.
inline const SincTable& sharedSinc() {
  static const SincTable table;
  return table;
}

inline double dbOf(double amplitude) {
  return amplitude <= 1.0e-15 ? -300.0 : 20.0 * std::log10(amplitude);
}

inline std::vector<float> sineZone(double hz, double sampleRate, std::size_t frames,
                                   double amplitude) {
  std::vector<float> zone(frames);
  for (std::size_t i = 0; i < frames; ++i) {
    zone[i] = static_cast<float>(
        amplitude * std::sin(2.0 * kPi * hz * static_cast<double>(i) / sampleRate));
  }
  return zone;
}

/// Full-band noise, so a null cannot be satisfied by a signal too smooth to
/// tell an interpolator from a copy.
inline std::vector<float> noiseZone(std::size_t frames, std::uint32_t seed, double amplitude) {
  std::vector<float> zone(frames);
  std::uint32_t state = seed;
  for (std::size_t i = 0; i < frames; ++i) {
    state = state * 1664525u + 1013904223u;
    zone[i] = static_cast<float>((static_cast<double>(state >> 8) / 8388608.0 - 1.0) * amplitude);
  }
  return zone;
}

/// A 1 kHz zone whose loop is exactly ten periods, so the join is seamless at
/// every rate this project tests: `fs / 100` is an integer for all six.
inline ClassicSource toneSource(const std::vector<float>& zone, double sampleRate,
                                LoopMode mode) {
  ClassicSource source;
  source.data = zone.data();
  source.frames = zone.size();
  source.sampleRate = sampleRate;
  source.loopMode = mode;
  source.loopStart = 0;
  source.loopEnd = static_cast<std::size_t>(sampleRate / 100.0);
  return source;
}

/// Drives `render` in blocks of `block`, which is how V-29 varies the buffer
/// size without the test knowing anything about the head.
inline std::vector<float> renderBlocks(ClassicRead& head, int frames,
                                       const std::vector<float>& pitch,
                                       const std::vector<float>& speed, int block) {
  std::vector<float> out(static_cast<std::size_t>(frames), 0.0f);
  for (int at = 0; at < frames; at += block) {
    const int n = std::min(block, frames - at);
    head.render(out.data() + at, n, pitch.data() + static_cast<std::size_t>(at),
                speed.empty() ? nullptr : speed.data() + static_cast<std::size_t>(at));
  }
  return out;
}

/// A constant pitch, unity speed, 256-frame blocks.
inline std::vector<float> renderSteady(ClassicRead& head, int frames, double pitch) {
  const std::vector<float> pitches(static_cast<std::size_t>(frames), static_cast<float>(pitch));
  const std::vector<float> speeds;
  return renderBlocks(head, frames, pitches, speeds, 256);
}

/**
 * Frequency by rising zero crossings, each placed by linear interpolation
 * between the two samples that straddle it. The estimate is cycles between
 * the first and last crossing over the time between them, so the only errors
 * that survive are the two endpoint placements: at 0.2 samples each over a
 * 20 000-sample window that is 2e-5 relative, or 0.03 cent. Zero when there
 * are too few crossings to call it a measurement.
 */
inline double measureHz(const std::vector<float>& x, double sampleRate, std::size_t from) {
  double first = -1.0;
  double last = -1.0;
  int count = 0;
  for (std::size_t k = from; k + 1 < x.size(); ++k) {
    const double a = static_cast<double>(x[k]);
    const double b = static_cast<double>(x[k + 1]);
    if (a <= 0.0 && b > 0.0) {
      const double t = static_cast<double>(k) + (-a / (b - a));
      if (first < 0.0) first = t;
      last = t;
      ++count;
    }
  }
  if (count < 3 || last <= first) return 0.0;
  return static_cast<double>(count - 1) * sampleRate / (last - first);
}

inline double centsBetween(double measuredHz, double expectedHz) {
  return 1200.0 * std::log2(measuredHz / expectedHz);
}

/**
 * V-3's instrument: the worst component that is not the carrier, in dB
 * relative to the carrier.
 *
 * The carrier is fitted by least squares at its known frequency and
 * subtracted before the transform. A −6 dBFS tone through a Blackman-Harris
 * window leaks about −126 dB two hundred bins away, which is where the first
 * fold of a +7 semitone read lands — close enough to a −100 dBc target that a
 * reading could have been the window rather than the resampler. Removing the
 * carrier first takes the window out of the answer; `sample_classic_tests`
 * calibrates the instrument against a pure tone to show what floor is left.
 * The transform then excludes only the fitted line's own skirt.
 */
inline double aliasDbc(const std::vector<float>& out, double sampleRate, double carrierHz,
                       int offset, std::size_t length) {
  if (out.size() < static_cast<std::size_t>(offset) + length) return 1000.0;
  double sc = 0.0, ss = 0.0, cc = 0.0, sn = 0.0, cs = 0.0;
  for (std::size_t i = 0; i < length; ++i) {
    const double t = static_cast<double>(i);
    const double c = std::cos(2.0 * kPi * carrierHz * t / sampleRate);
    const double s = std::sin(2.0 * kPi * carrierHz * t / sampleRate);
    const double x = static_cast<double>(out[static_cast<std::size_t>(offset) + i]);
    sc += x * c;
    ss += x * s;
    cc += c * c;
    sn += s * s;
    cs += c * s;
  }
  const double det = cc * sn - cs * cs;
  if (std::fabs(det) < 1.0e-12) return 1000.0;
  const double a = (sc * sn - ss * cs) / det;
  const double b = (ss * cc - sc * cs) / det;
  const double carrier = std::sqrt(a * a + b * b);
  if (carrier < 1.0e-6) return 1000.0;
  std::vector<float> residual(length);
  for (std::size_t i = 0; i < length; ++i) {
    const double t = static_cast<double>(i);
    const double fit = a * std::cos(2.0 * kPi * carrierHz * t / sampleRate) +
                       b * std::sin(2.0 * kPi * carrierHz * t / sampleRate);
    residual[i] = static_cast<float>(
        static_cast<double>(out[static_cast<std::size_t>(offset) + i]) - fit);
  }
  const std::vector<double> legitimate = {carrierHz};
  const double spurious = spuriousFloorAgainst(residual, sampleRate, length, legitimate, 0);
  if (spurious > 0.0) return 1000.0;
  return spurious - dbOf(carrier);
}

/// §4.2's targets, with §9's +3 dB tolerance applied by the caller.
inline double aliasTargetDbc(Quality q) {
  return q == Quality::Eco ? -40.0 : (q == Quality::Normal ? -70.0 : -100.0);
}

}  // namespace mw::test::sample
