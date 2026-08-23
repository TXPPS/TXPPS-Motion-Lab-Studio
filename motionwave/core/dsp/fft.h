// Motion Wave — the discrete Fourier transform the core needs anyway.
//
// Written here rather than in a test because `smp-01` puts a real FFT on the
// Slipstream Sampler's critical path — its spectral engine is a phase vocoder —
// and `motionwave/core/` may take no dependency (ADR-0003). One implementation
// used by both the sampler and every spectral measurement is worth more than a
// fast one in the product and a slow one in the tests, because then only one of
// them is ever exercised.
//
// Iterative radix-2, decimation in time. Not the fastest possible shape: a
// split-radix or a real-input transform would be roughly twice as quick. That
// optimisation is deferred until something measures it as the bottleneck,
// because a correct transform that is understood beats a fast one that is not,
// and the sampler's own budget already assumes a real-FFT cost this can be
// specialised into later.
#pragma once

#include <cmath>
#include <cstddef>
#include <vector>

namespace mw::dsp {

/// True when `n` is a power of two, which radix-2 requires.
inline bool isPowerOfTwo(std::size_t n) noexcept { return n != 0 && (n & (n - 1)) == 0; }

/**
 * In-place complex FFT.
 *
 * `re` and `im` are `n` samples each; `n` must be a power of two. The caller
 * owns the storage, so this allocates nothing and can be used from a prepared
 * processor as well as from a test.
 */
inline void fft(std::vector<double>& re, std::vector<double>& im) {
  const std::size_t n = re.size();
  if (n < 2 || !isPowerOfTwo(n) || im.size() != n) return;

  // Bit-reversal permutation.
  for (std::size_t i = 1, j = 0; i < n; ++i) {
    std::size_t bit = n >> 1;
    for (; (j & bit) != 0; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      std::swap(re[i], re[j]);
      std::swap(im[i], im[j]);
    }
  }

  for (std::size_t len = 2; len <= n; len <<= 1) {
    const double angle = -2.0 * 3.14159265358979323846 / static_cast<double>(len);
    const double wRe = std::cos(angle);
    const double wIm = std::sin(angle);
    for (std::size_t i = 0; i < n; i += len) {
      double curRe = 1.0;
      double curIm = 0.0;
      for (std::size_t k = 0; k < len / 2; ++k) {
        const std::size_t a = i + k;
        const std::size_t b = a + len / 2;
        const double tRe = re[b] * curRe - im[b] * curIm;
        const double tIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        // Recurrence rather than a table: the accumulated error over one stage
        // is far below what any measurement here resolves, and a table would be
        // state this header does not otherwise need.
        const double nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/**
 * A four-term Blackman-Harris window, and the coherent gain to divide by.
 *
 * The window choice is not a detail; it sets the floor a measurement can see.
 * A Hann window's highest sidelobe is about −31 dB and its skirt reaches −60 dB
 * only some way out, so a −6 dBFS carrier smears energy across the spectrum at
 * roughly −54 dBFS — which is precisely the "alias floor" this project measured
 * five different ways before recognising it. The tell was that crushing the
 * modulator's bandwidth by a factor of eleven moved the number by 0.1 dB: a
 * real alias would have gone with it.
 *
 * Blackman-Harris puts its highest sidelobe near −92 dB, which is the headroom
 * an −80 dBFS target needs. It costs resolution — the main lobe is twice as
 * wide — which is why `SpectrumPlan` demands the alias grid be resolvable with
 * margin before it will report anything.
 */
inline double blackmanHarrisWindow(std::vector<double>& w) {
  const std::size_t n = w.size();
  const double a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
  const double twoPi = 2.0 * 3.14159265358979323846;
  double sum = 0.0;
  for (std::size_t i = 0; i < n; ++i) {
    const double t = static_cast<double>(i) / static_cast<double>(n - 1);
    w[i] = a0 - a1 * std::cos(twoPi * t) + a2 * std::cos(2.0 * twoPi * t) -
           a3 * std::cos(3.0 * twoPi * t);
    sum += w[i];
  }
  return sum;
}

}  // namespace mw::dsp
