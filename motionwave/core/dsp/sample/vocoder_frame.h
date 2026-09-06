// Motion Wave — the phase vocoder's frame arithmetic. `smp-01` §4.4.
//
// This header holds everything that happens to *one* analysis frame: the
// windowed transform, the fractional-hop correction, the instantaneous
// frequency estimate, the phase advance, identity peak locking and the
// transient reset. `spectral_read.h` owns the scheduling — which frame, when,
// and what the output resampler does with the result — and the split is there
// because the two answer different questions and neither file fits under 400
// lines with the other in it.
//
// ---------------------------------------------------------------------------
// WHAT WAS DERIVED HERE, AND WHAT WAS TAKEN FROM THE SHEET
// ---------------------------------------------------------------------------
//
// §13 item 1 of the sheet says its §4.4 equations were transcribed from
// knowledge of the standard formulation rather than copied from a fetched
// paper, and that a sign error or a misplaced normalisation in `princarg` or
// in the phase advance would be **silent** — the code would run and sound
// merely mediocre. So every equation below was re-derived here from the
// definition of instantaneous frequency, and this comment records which came
// out agreeing with the sheet and which did not.
//
// **Derived: the expected advance.** Let the content near bin `k` be a
// sinusoid at radian frequency `w` in radians per sample. Frame `m` is the
// transform of `x[m·H_a + n]·win[n]`, so relative to frame `m−1` the sinusoid
// has run for `H_a` samples and its phase at the frame origin has advanced by
// `w·H_a`. A bin's own centre is `w_k = 2*pi*k/N`, so a component sitting
// exactly on the centre advances by
//
//     dPhiExpected(k) = w_k · H_a = 2*pi*k*H_a/N
//
// which is the sheet's first line. AGREES.
//
// **Derived: the deviation and `princarg`.** The measured advance is only ever
// known modulo 2*pi, because a phase is. The estimator's premise is that the
// component's true frequency is within half a bin-advance of the centre, so
// the deviation `w·H_a − w_k·H_a` is the value in `[-pi, pi)` congruent to the
// measured difference:
//
//     dPhi(m,k) = princarg( phi(m,k) − phi(m−1,k) − dPhiExpected(k) )
//     princarg(x) = ((x + pi) mod 2*pi) − pi
//
// AGREES with the sheet. The sign matters and is not free: `princarg` must map
// to a range **centred on zero**, because the quantity it is wrapping is a
// deviation from an expectation and the expectation is the centre of belief. A
// flipped sign — `princarg` returning `pi − ((x + pi) mod 2*pi)`, say — leaves
// every stationary bin's deviation at zero and so leaves the V-20 null intact,
// which is exactly the silence §13 item 1 warns about; `sample_vocoder_tests`'
// glide row is what catches it, because a moving partial is the only stimulus
// whose deviation is non-zero.
//
// **Derived: the instantaneous frequency.** Dividing the deviation by the hop
// converts a phase back into a frequency, so
//
//     wHat(m,k) = w_k + dPhi(m,k) / H_a
//
// AGREES. The divisor is the **actual** hop used to reach this frame, not a
// nominal or rounded one — see the fractional hop below, where the two differ.
//
// **Derived: the synthesis phase.** To place the same component at the same
// frequency in an output whose frames are `H_s` apart,
//
//     phiS(m,k) = phiS(m−1,k) + H_s · wHat(m,k)
//
// AGREES. Note there is no `alpha` anywhere in this line: the stretch enters
// only through the ratio `H_s/H_a`, and writing `alpha · dPhi` instead of
// `H_s · wHat` drops the bin-centre term and detunes everything but DC.
//
// **DERIVED AND DISAGREES IN SIGN WITH THE SHEET'S WORDING — the fractional
// hop.** The sheet says to compensate the residue by multiplying bin `k` by
// `e^(-j*2*pi*k*Delta/N)` without defining the sign of `Delta`. Deriving it:
// the transform here is `X(k) = sum x[n]·e^(-j*2*pi*k*n/N)`, and if the frame
// actually read starts at integer `t0` while the frame wanted starts at
// `t0 + d`, then the wanted frame is `y[n] = x[t0 + d + n]`, whose transform is
//
//     Y(k) = sum x[t0+d+n]·e^(-j*2*pi*k*n/N)
//          = e^(+j*2*pi*k*d/N) · X(k)        (substituting m = n + d)
//
// So with `d = wanted − rounded` the correction is `e^(+j*2*pi*k*d/N)`, which
// is the sheet's expression with the sheet's `Delta` being `−d`. Both are the
// same rotation and neither is wrong; what is wrong is picking one of the two
// spellings without knowing which `Delta` it belongs to, and that is a
// one-line edit that would sound like nothing until the pitch moved.
// `fractionalResidue` below fixes the convention as `wanted − rounded` and
// `analyseFrame` applies `+d`, in the one place that knows the residue, so the
// convention and its use cannot drift apart into two files.
//
// **TAKEN FROM THE SHEET, not derived:** the 75 % overlap with a Hann window
// as the reconstruction configuration; identity phase locking as the remedy
// for phasiness and its peak rule (strict local maximum over +/-2 bins,
// region of influence to the midpoint between peaks); the frame-level
// transient reset as the [I] simplification of the bin-level method; and the
// decomposition `alpha = p / rho` with the vocoder's output then read at
// increment `p`. Those are design decisions and citations rather than
// arithmetic, so there was nothing to re-derive.
#pragma once

#include "../fft.h"
#include "measure.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace mw::dsp::sample {

/// §7.3's Phase lock control. `Identity` is the default the sheet gives; §13
/// item 11 records that whether it beats `Scaled` on sampled-instrument
/// material specifically is [X], which is why both ship.
enum class PhaseLock : std::uint8_t { Off = 0, Identity = 1, Scaled = 2 };

/**
 * `((x + pi) mod 2*pi) - pi`, the principal value in `[-pi, pi)`.
 *
 * Written with `std::floor` rather than `std::fmod` because `fmod` keeps the
 * sign of its left operand: `fmod(-0.5, 2pi)` is `-0.5`, so the C expression
 * would return a value outside the range for every negative input and the
 * deviation of a bin below its centre would come back a whole turn wrong. That
 * is a silent error of exactly §13 item 1's kind, and it is why this is a
 * named function with its own row rather than an expression at three call
 * sites.
 */
inline double princarg(double x) noexcept {
  const double twoPi = 2.0 * kPi;
  return x - twoPi * std::floor((x + kPi) / twoPi);
}

/// The integer sample a frame is read from, and the sub-sample residue left
/// over. The convention is fixed here once: `residue = wanted - rounded`, so a
/// positive residue means the frame wanted is *later* than the frame read.
struct HopSplit {
  long long start = 0;
  double residue = 0.0;
};

inline HopSplit fractionalResidue(double wantedStart) noexcept {
  HopSplit s;
  const double r = std::floor(wantedStart);
  s.start = static_cast<long long>(r);
  s.residue = wantedStart - r;
  return s;
}

/**
 * One analysis frame: the windowed transform, corrected for the residue.
 *
 * `re`/`im` must be `n` long and are overwritten; `mag`/`phase` must be
 * `n/2 + 1` long. Nothing here allocates — every buffer is the caller's, which
 * is what lets this run from `render` under `RtGuard`.
 *
 * `residue` is `wanted - rounded` as `fractionalResidue` defines it, and the
 * rotation applied is `e^(+j*2*pi*k*residue/N)` for the reason derived in this
 * file's header. Omitting it leaves the analysis phase referenced to a frame
 * origin that wanders by up to a sample as the glide moves `H_a` through the
 * integers, and that wander is a modulation on every bin's phase — a sideband
 * that appears only while the pitch is moving.
 */
inline void analyseFrame(const float* source, std::size_t sourceFrames, long long start,
                         double residue, const std::vector<double>& window,
                         std::vector<double>& re, std::vector<double>& im,
                         std::vector<double>& mag, std::vector<double>& phase) noexcept {
  const std::size_t n = window.size();
  for (std::size_t i = 0; i < n; ++i) {
    const long long at = start + static_cast<long long>(i);
    const double x = (at >= 0 && static_cast<std::size_t>(at) < sourceFrames)
                         ? static_cast<double>(source[static_cast<std::size_t>(at)])
                         : 0.0;
    re[i] = x * window[i];
    im[i] = 0.0;
  }
  fft(re, im);
  const std::size_t bins = n / 2 + 1;
  const double step = 2.0 * kPi * residue / static_cast<double>(n);
  for (std::size_t k = 0; k < bins; ++k) {
    double kr = re[k];
    double ki = im[k];
    if (residue != 0.0) {
      const double a = step * static_cast<double>(k);
      const double c = std::cos(a);
      const double s = std::sin(a);
      const double rr = kr * c - ki * s;
      ki = kr * s + ki * c;
      kr = rr;
    }
    mag[k] = std::sqrt(kr * kr + ki * ki);
    phase[k] = std::atan2(ki, kr);
  }
}

/**
 * Identity phase locking's regions. `peakOf[k]` is the bin whose phase advance
 * bin `k` takes.
 *
 * A peak is a strict local maximum of `|X|` over +/-2 bins, and its region of
 * influence runs to the midpoint between it and each neighbouring peak — the
 * sheet's rule, taken as given. With no peaks at all every bin owns itself,
 * which makes locking a no-op on a silent or perfectly flat frame rather than
 * a division by nothing.
 *
 * The midpoint is computed as `(a + b + 1) / 2`, so a boundary falling between
 * two bins goes to the upper peak. **That rounding is a convention and not a
 * rule the tests can defend**: rounding it the other way was tried as a
 * mutation and nothing in `sample_vocoder_tests` moved, because the boundary
 * bin between two peaks is where the magnitude is smallest and one bin of it
 * changes no measurement. Recorded here rather than left implied, so nobody
 * reads the choice as load-bearing. The mutation that *is* caught — by all
 * three V-22 rows — is assigning a region to its neighbouring peak.
 */
inline void lockRegions(const std::vector<double>& mag, std::size_t bins,
                        std::vector<std::size_t>& peaks,
                        std::vector<std::size_t>& peakOf) noexcept {
  peaks.clear();
  for (std::size_t k = 0; k < bins; ++k) peakOf[k] = k;
  if (bins < 5) return;
  for (std::size_t k = 2; k + 2 < bins; ++k) {
    const double v = mag[k];
    if (v > mag[k - 1] && v > mag[k - 2] && v > mag[k + 1] && v > mag[k + 2]) {
      peaks.push_back(k);
    }
  }
  if (peaks.empty()) return;
  std::size_t lo = 0;
  for (std::size_t p = 0; p < peaks.size(); ++p) {
    const std::size_t hi =
        p + 1 < peaks.size() ? (peaks[p] + peaks[p + 1] + 1) / 2 : bins;
    for (std::size_t k = lo; k < hi; ++k) peakOf[k] = peaks[p];
    lo = hi;
  }
}

/// A deterministic per-frame phase jitter for §7.3's Blur, drawn from a
/// counter-based hash rather than a running generator. §4.6 requires every
/// random draw to be reproducible, because MotionLab's offline-bounce parity
/// compares two renders of the same bars and a free-running generator makes
/// that comparison fail by construction — as a DSP bug, not a seeding one.
inline double blurJitter(std::uint32_t seed, std::uint32_t frame, std::uint32_t bin) noexcept {
  std::uint32_t h = seed ^ (frame * 2654435761u) ^ (bin * 40503u + 0x9e3779b9u);
  h ^= h >> 16;
  h *= 2246822519u;
  h ^= h >> 13;
  h *= 3266489917u;
  h ^= h >> 16;
  return (static_cast<double>(h) / 4294967296.0) * 2.0 - 1.0;
}

/**
 * The phase advance for one frame, and the synthesis spectrum it produces.
 *
 * `hopA` is the **actual** analysis hop that separated this frame from the
 * previous one, residues included — not the rounded integer distance between
 * the two reads, and not the nominal `H_s/alpha`. Using either of those in
 * `dPhiExpected` makes the estimator's expectation disagree with the frame it
 * is looking at by up to half a bin-advance, which reads as a frequency error
 * that follows the glide.
 *
 * `reset` is the transient case: the sheet says to set `phiS := phi` for all
 * bins and force `H_s = H_a` for that frame, which restores the source's own
 * inter-bin phase relationships and so restores the attack's waveform instead
 * of stretching it into a whoosh.
 */
inline void advancePhase(const std::vector<double>& mag, const std::vector<double>& phase,
                         std::vector<double>& prevPhase, std::vector<double>& synthPhase,
                         std::size_t bins, std::size_t n, double hopA, double hopS,
                         PhaseLock lock, const std::vector<std::size_t>& peakOf, double blur,
                         std::uint32_t seed, std::uint32_t frameIndex, bool reset,
                         std::vector<double>& outRe, std::vector<double>& outIm) noexcept {
  const double binW = 2.0 * kPi / static_cast<double>(n);
  if (reset) {
    for (std::size_t k = 0; k < bins; ++k) synthPhase[k] = phase[k];
  } else {
    // The per-bin advance is computed first for every bin, because identity
    // locking reads the advance of a bin that may be above this one: taking a
    // peak's advance from a `synthPhase` that has already been overwritten for
    // the bins below it would mix this frame's answer with the last one's.
    for (std::size_t k = 0; k < bins; ++k) {
      const double centre = binW * static_cast<double>(k);
      const double expected = centre * hopA;
      const double dev = princarg(phase[k] - prevPhase[k] - expected);
      const double wHat = centre + dev / hopA;
      outRe[k] = wHat;  // scratch: the advance per output sample, reused below
    }
    // Every peak's own phase is advanced first, because a bin in a region is
    // about to be written *from* its peak's new phase and reading one that had
    // not been advanced yet would lock the region to the previous frame.
    for (std::size_t k = 0; k < bins; ++k) {
      if (lock == PhaseLock::Off || peakOf[k] == k) synthPhase[k] += hopS * outRe[k];
    }
    if (lock != PhaseLock::Off) {
      // **Identity locking locks a phase, not an advance.**
      //
      // The first form written here gave every bin in a region the peak's
      // *advance* — `synthPhase[k] += hopS * wHat[peak]` — which is the
      // sentence "every bin in the region takes the peak's phase advance" read
      // literally, and it is wrong. Each bin still carries its own accumulated
      // offset from every earlier frame, so the offsets never converge and the
      // region's bins stay as incoherent as they were; V-22(c) measured the
      // dispersion 20.5 dB *worse* with locking on than off, which is what
      // sent this back to the definition.
      //
      // What vertical coherence means is that the region's bins hold the phase
      // relationship the *analysis* found between them. So the peak's phase is
      // advanced, and every other bin in the region is placed at the peak's new
      // phase plus the offset it has from the peak in this frame:
      //
      //     synthPhase[k] = synthPhase[peak] + (phase[k] - phase[peak])
      //
      // which is a phase assignment and not an accumulation — the bin's history
      // is deliberately discarded, and discarding it is the whole mechanism.
      for (std::size_t k = 0; k < bins; ++k) {
        const std::size_t owner = peakOf[k];
        if (owner == k) continue;
        const double offset = princarg(phase[k] - phase[owner]);
        if (lock == PhaseLock::Identity) {
          synthPhase[k] = synthPhase[owner] + offset;
        } else {
          // Scaled locking moves the bin part of the way to the locked phase
          // rather than all of it, so a bin far from its peak keeps some of its
          // own frequency. §13 item 11 records that whether this or identity is
          // the better default for sampled-instrument material is [X], which is
          // why both ship and identity is only the default.
          const double locked = synthPhase[owner] + offset;
          synthPhase[k] += 0.5 * princarg(locked - synthPhase[k]) + 0.5 * hopS * outRe[k];
        }
      }
    }
    if (blur > 0.0) {
      // Applied after the locking, not inside it: blur is a character control
      // that randomises the phase advance, and adding it before the lock would
      // let the lock immediately overwrite it on every non-peak bin — a control
      // that did nothing on most of the spectrum and something on the rest.
      for (std::size_t k = 0; k < bins; ++k) {
        synthPhase[k] +=
            blur * kPi * blurJitter(seed, frameIndex, static_cast<std::uint32_t>(k));
      }
    }
  }
  for (std::size_t k = 0; k < bins; ++k) {
    prevPhase[k] = phase[k];
    outRe[k] = mag[k] * std::cos(synthPhase[k]);
    outIm[k] = mag[k] * std::sin(synthPhase[k]);
  }
  // Hermitian symmetry, so the inverse transform is real. Bin 0 and bin N/2
  // are their own conjugates and must not be mirrored, or the transform gets
  // twice their energy and DC rides on everything.
  for (std::size_t k = bins; k < n; ++k) {
    outRe[k] = outRe[n - k];
    outIm[k] = -outIm[n - k];
  }
}

/**
 * The inverse transform, in place, by conjugation around the forward one.
 *
 * `fft.h` offers a forward transform only, and a separate inverse would be a
 * second implementation of the same butterflies — the thing this project's
 * no-duplicate-DSP rule exists to prevent. Conjugating the input, transforming,
 * conjugating the output and scaling by `1/N` is the inverse exactly, so there
 * is one set of butterflies in the core and both directions go through it.
 */
inline void inverseFft(std::vector<double>& re, std::vector<double>& im) noexcept {
  const std::size_t n = re.size();
  for (std::size_t i = 0; i < n; ++i) im[i] = -im[i];
  fft(re, im);
  const double scale = 1.0 / static_cast<double>(n);
  for (std::size_t i = 0; i < n; ++i) {
    re[i] *= scale;
    im[i] = -im[i] * scale;
  }
}

}  // namespace mw::dsp::sample
