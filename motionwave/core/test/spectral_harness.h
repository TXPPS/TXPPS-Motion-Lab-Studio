// Motion Wave — shared fixtures for the spectral engine's suites.
//
// Two suites share these: `sample_spectral_tests` (the nulls, the caps, the
// scheduling and real-time safety) and `sample_vocoder_tests` (V-22, V-23 and
// the phase arithmetic's mutations). What lives here is the apparatus — how a
// spectral voice is prepared, what a bowed note and a snare-like hit are, and
// how f0 stability, a spectral envelope and an inter-partial phase dispersion
// are measured — so that a number one suite prints means the same thing when
// the other prints it.
#pragma once

#include "../dsp/sample/spectral_read.h"
#include "harness.h"
#include "sample_harness.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <vector>

namespace mw::test::spectral {

using mw::dsp::sample::ClassicRead;
using mw::dsp::sample::ClassicSource;
using mw::dsp::sample::PhaseLock;
using mw::dsp::sample::Quality;
using mw::dsp::sample::SpectralControls;
using mw::dsp::sample::SpectralHead;
using mw::dsp::sample::SpectralRead;
using mw::test::sample::sharedSinc;

constexpr double kPi = 3.14159265358979323846;

/// V-20's configuration: phase lock off, transients off. Stated once, because
/// the null is specified against exactly this and a row that quietly enabled
/// either would be measuring something else and would still print a number.
inline SpectralControls nullControls(std::size_t n) {
  SpectralControls c;
  c.fftSize = n;
  c.phaseLock = PhaseLock::Off;
  c.transientsEnabled = false;
  c.blurPercent = 0.0;
  return c;
}

inline ClassicSource plainSource(const std::vector<float>& zone, double rate) {
  ClassicSource s;
  s.data = zone.data();
  s.frames = zone.size();
  s.sampleRate = rate;
  s.loopMode = mw::dsp::sample::LoopMode::NoLoop;
  return s;
}

/// Drives `render` in blocks, which is how the block-independence row varies
/// the buffer size without knowing anything about the engine.
inline std::vector<float> renderSpectral(SpectralRead& head, int frames,
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

inline std::vector<float> renderClassic(ClassicRead& head, int frames, double pitch, int block) {
  const std::vector<float> pitches(static_cast<std::size_t>(frames), static_cast<float>(pitch));
  std::vector<float> out(static_cast<std::size_t>(frames), 0.0f);
  for (int at = 0; at < frames; at += block) {
    const int n = std::min(block, frames - at);
    head.render(out.data() + at, n, pitches.data() + static_cast<std::size_t>(at), nullptr);
  }
  return out;
}

/**
 * The residual of `a` against `b` over [from, to), in dBFS relative to `b`'s
 * own RMS.
 *
 * Relative to the reference rather than to full scale, because a null stated
 * as "-100 dBFS" against a signal that happens to peak at -20 dBFS would be a
 * 20 dB easier test than the same words against a signal at 0 dBFS, and the
 * sheet means the harder one.
 */
inline double nullDb(const std::vector<float>& a, const std::vector<float>& b, std::size_t from,
                     std::size_t to) {
  to = std::min({to, a.size(), b.size()});
  if (from >= to) return 1000.0;
  double err = 0.0, ref = 0.0;
  for (std::size_t i = from; i < to; ++i) {
    const double d = static_cast<double>(a[i]) - static_cast<double>(b[i]);
    err += d * d;
    ref += static_cast<double>(b[i]) * static_cast<double>(b[i]);
  }
  const std::size_t n = to - from;
  const double rmsErr = std::sqrt(err / static_cast<double>(n));
  const double rmsRef = std::sqrt(ref / static_cast<double>(n));
  if (rmsRef <= 1.0e-12) return 1000.0;
  return 20.0 * std::log10(rmsErr / rmsRef + 1.0e-30);
}

/**
 * V-22's stimulus: a slowly-bowed harmonic series with vibrato.
 *
 * Twelve harmonics with a 1/k amplitude law, a 300 ms bowed attack, and 5 Hz
 * vibrato at 12 cents. The vibrato is what makes this a real test of the
 * vocoder rather than of a steady tone: a partial whose frequency is exactly
 * on a bin centre has a phase deviation of zero at every frame, so every
 * mutation to the deviation arithmetic is invisible on one. The vibrato keeps
 * every partial moving across bins throughout.
 */
inline std::vector<float> bowedNoteVibrato(double f0, double rate, std::size_t frames,
                                           double depthCents) {
  std::vector<float> x(frames, 0.0f);
  const double attack = 0.300 * rate;
  const int partials = 12;
  // Phase is integrated rather than evaluated, because a vibrato written as
  // sin(2*pi*f*t + d*sin(2*pi*fv*t)) has the wrong instantaneous frequency
  // — the derivative of the modulation term carries a factor of fv that the
  // written-down form does not — and the f0 stability row would then be
  // measuring the stimulus.
  std::vector<double> ph(static_cast<std::size_t>(partials), 0.0);
  for (std::size_t i = 0; i < frames; ++i) {
    const double t = static_cast<double>(i) / rate;
    const double env = i < attack ? static_cast<double>(i) / attack : 1.0;
    const double cents = depthCents * std::sin(2.0 * kPi * 5.0 * t);
    const double bend = std::pow(2.0, cents / 1200.0);
    double v = 0.0;
    for (int k = 1; k <= partials; ++k) {
      const std::size_t idx = static_cast<std::size_t>(k - 1);
      ph[idx] += 2.0 * kPi * f0 * static_cast<double>(k) * bend / rate;
      v += std::sin(ph[idx]) / static_cast<double>(k);
    }
    x[i] = static_cast<float>(0.25 * env * v);
  }
  return x;
}

/// The sheet's stimulus: the same note at 12 cents of vibrato.
inline std::vector<float> bowedNote(double f0, double rate, std::size_t frames) {
  return bowedNoteVibrato(f0, rate, frames, 12.0);
}

/**
 * V-23's stimulus: a snare-like hit — a 2 ms exponential attack, a noise body
 * decaying over 120 ms, and two tuned modes at 180 and 330 Hz.
 *
 * Deterministic noise from a counter-based hash rather than a library
 * generator, so the same hit is rendered by every run and by every target.
 */
inline std::vector<float> snareHit(double rate, std::size_t frames, std::size_t onset) {
  std::vector<float> x(frames, 0.0f);
  std::uint32_t state = 0x5eed1234u;
  for (std::size_t i = onset; i < frames; ++i) {
    const double t = static_cast<double>(i - onset) / rate;
    state = state * 1664525u + 1013904223u;
    const double noise = static_cast<double>(state >> 8) / 8388608.0 - 1.0;
    const double rise = 1.0 - std::exp(-t / 0.002);
    const double body = std::exp(-t / 0.040);
    const double tail = std::exp(-t / 0.120);
    const double modes = 0.4 * std::sin(2.0 * kPi * 180.0 * t) * tail +
                         0.3 * std::sin(2.0 * kPi * 330.0 * t) * tail;
    x[i] = static_cast<float>(0.5 * rise * (noise * body + modes));
  }
  return x;
}

/// 10–90 % rise time of an envelope, in samples. The envelope is a sliding RMS
/// over 1 ms — the same window `measure.h` uses for onset refinement, so a rise
/// time here and an onset placement there are measured on the same quantity.
inline double riseTimeSamples(const std::vector<float>& x, double rate, std::size_t from,
                              std::size_t to) {
  to = std::min(to, x.size());
  if (from >= to) return 0.0;
  const auto w = static_cast<std::size_t>(0.001 * rate);
  std::vector<double> env;
  env.reserve(to - from);
  for (std::size_t i = from; i + w < to; ++i) {
    double s = 0.0;
    for (std::size_t j = 0; j < w; ++j) {
      const double v = static_cast<double>(x[i + j]);
      s += v * v;
    }
    env.push_back(std::sqrt(s / static_cast<double>(w)));
  }
  if (env.empty()) return 0.0;
  const double peak = *std::max_element(env.begin(), env.end());
  if (peak <= 1.0e-9) return 0.0;
  std::size_t lo = 0, hi = 0;
  for (std::size_t i = 0; i < env.size(); ++i) {
    if (env[i] >= 0.1 * peak) {
      lo = i;
      break;
    }
  }
  for (std::size_t i = lo; i < env.size(); ++i) {
    if (env[i] >= 0.9 * peak) {
      hi = i;
      break;
    }
  }
  return hi > lo ? static_cast<double>(hi - lo) : 0.0;
}

/// Magnitude spectrum over `length` samples from `offset`, Hann-windowed.
inline std::vector<double> magSpectrum(const std::vector<float>& x, std::size_t offset,
                                       std::size_t length) {
  std::vector<double> re(length, 0.0), im(length, 0.0), w(length);
  mw::dsp::sample::hann(w);
  for (std::size_t i = 0; i < length; ++i) {
    const std::size_t at = offset + i;
    re[i] = at < x.size() ? static_cast<double>(x[at]) * w[i] : 0.0;
  }
  mw::dsp::fft(re, im);
  std::vector<double> mag(length / 2 + 1, 0.0);
  for (std::size_t k = 0; k < mag.size(); ++k) mag[k] = std::sqrt(re[k] * re[k] + im[k] * im[k]);
  return mag;
}

/**
 * V-22(b)'s instrument: energy per 1/3-octave band from `loHz` to `hiHz`, in dB.
 *
 * A 1/3-octave envelope rather than a bin-by-bin comparison because the
 * vocoder is free to move a partial's fine structure — the vibrato is not
 * phase-locked between the source and a 4x stretch of it, and it could not be
 * — while the spectral *envelope* is exactly what a stretch must not change.
 */
inline std::vector<double> thirdOctaveBands(const std::vector<double>& mag, double rate,
                                            std::size_t length, double loHz, double hiHz) {
  std::vector<double> bands;
  const double step = std::pow(2.0, 1.0 / 3.0);
  const double bin = rate / static_cast<double>(length);
  for (double f = loHz; f * step <= hiHz; f *= step) {
    const auto k0 = static_cast<std::size_t>(std::ceil(f / bin));
    const auto k1 = static_cast<std::size_t>(std::floor(f * step / bin));
    double sum = 0.0;
    for (std::size_t k = k0; k <= k1 && k < mag.size(); ++k) sum += mag[k] * mag[k];
    bands.push_back(10.0 * std::log10(sum + 1.0e-20));
  }
  return bands;
}

inline double correlationOf(const std::vector<double>& a, const std::vector<double>& b) {
  const std::size_t n = std::min(a.size(), b.size());
  if (n < 2) return 0.0;
  double ma = 0.0, mb = 0.0;
  for (std::size_t i = 0; i < n; ++i) {
    ma += a[i];
    mb += b[i];
  }
  ma /= static_cast<double>(n);
  mb /= static_cast<double>(n);
  double ab = 0.0, aa = 0.0, bb = 0.0;
  for (std::size_t i = 0; i < n; ++i) {
    const double da = a[i] - ma, db = b[i] - mb;
    ab += da * db;
    aa += da * da;
    bb += db * db;
  }
  const double den = std::sqrt(aa * bb);
  return den > 0.0 ? ab / den : 0.0;
}

/**
 * V-22(c)'s instrument: inter-partial phase dispersion, in dB.
 *
 * A partial set whose relative phases hold reconstructs the same waveform
 * every period; let them drift and successive periods stop matching. So the
 * dispersion is read off the output's **self-similarity at the fundamental
 * period** — the normalised correlation of the signal with itself one period
 * later — as `10*log10(1 - rho)`. A perfectly coherent periodic signal gives
 * `rho = 1` and a dispersion of -infinity; smear increases `1 - rho`.
 *
 * The stimulus must therefore be steady, and its period must be an integer
 * number of samples: a fractional lag would measure the instrument's own
 * rounding rather than the engine. `f0 = 240` at 48 kHz gives exactly 200.
 *
 * **THREE INSTRUMENTS WERE WRONG BEFORE THIS ONE.** Each printed a plausible
 * number and none looked broken, which is what makes a spectral measurement
 * dangerous and why all three are kept on the page rather than deleted.
 *
 *  1. *Fixed-bin harmonic phase.* Read `princarg(phi_k - k*phi_1)` at the bin
 *     `round(k*f0*N/fs)` and took its circular variance across frames. The
 *     stimulus carries 12 cents of vibrato, so partial 12 swings +/-18 Hz
 *     against a 23.4 Hz bin at N = 2048 and leaves its bin; the read then
 *     returned the phase of the window's skirt. It reported the unlocked
 *     vocoder at **-44.5 dB against the source's own -34.1 dB**, and no output
 *     can be more coherent than the material it was made from. That
 *     impossibility is what said the instrument was wrong.
 *  2. *Peak-following harmonic phase.* Following each partial to the bin its
 *     energy is actually in removed the leakage and did not fix the result: on
 *     a steady tone the unlocked vocoder read -51.6 dB against a source at
 *     -34.6. Not leakage — the metric was measuring the wrong property. An
 *     unlocked vocoder gives every bin a *constant* advance per frame, so
 *     `phi_k - k*phi_1` is exactly constant: a perfect score for an engine
 *     producing precisely the artefact under test. It measured the
 *     **stationarity** of a relationship rather than whether the relationship
 *     is the source's.
 *  3. *Main-lobe phase against the source.* Comparing `phi[peak+d] - phi[peak]`
 *     against the same quantity on the source needs the two reads to be at
 *     corresponding instants, and a 4x stretch has no such correspondence to
 *     offer without solving for the alignment first. It separated nothing:
 *     -34.5 dB unlocked against -34.1 dB locked, on an engine whose locking
 *     demonstrably changes the waveform's crest factor by 10 %.
 *
 * All three share a shape worth naming: each asked about a *relationship
 * between two measurements* whose correspondence had not been established. The
 * one below asks a signal about itself, which is why it needs no alignment and
 * why its floor — a perfectly periodic source reading exactly 1 — is checkable
 * rather than assumed. V-22(c)'s row asserts that floor before it asserts
 * anything about the engine.
 */
inline double periodicityRho(const std::vector<float>& x, double rate, double f0,
                             std::size_t from, std::size_t to) {
  const auto lag = static_cast<std::size_t>(std::round(rate / f0));
  to = std::min(to, x.size());
  if (lag == 0 || from + lag + 4096 > to) return 0.0;
  double ab = 0.0, aa = 0.0, bb = 0.0;
  for (std::size_t i = from; i + lag < to; ++i) {
    const double a = static_cast<double>(x[i]);
    const double b = static_cast<double>(x[i + lag]);
    ab += a * b;
    aa += a * a;
    bb += b * b;
  }
  const double d = std::sqrt(aa * bb);
  return d > 0.0 ? ab / d : 0.0;
}

inline double phaseDispersionDb(const std::vector<float>& x, double rate, double f0,
                                std::size_t from, std::size_t to) {
  const double rho = periodicityRho(x, rate, f0, from, to);
  return 10.0 * std::log10(1.0 - rho + 1.0e-12);
}

}  // namespace mw::test::spectral
