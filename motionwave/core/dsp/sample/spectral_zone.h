// Motion Wave — the spectral engine's zone-level state and its tier caps.
//
// `smp-01` §10.3's caps and §7.3's controls, plus the head analysis a zone
// carries. Split from `spectral_read.h` because these belong to a **zone or a
// tier** and the read head belongs to a **voice**: the head analysis is
// computed once at load and shared by every note on that zone, the caps are
// properties of the quality tier, and a voice reads all of them and owns none.
// Keeping them in the voice's file would also have put the whole of it over the
// 400-line rule with two subjects in it.
//
// **Zero latency, structurally.** A real-time vocoder costs a window of
// latency because it cannot see the future. This one is reading a stored file,
// so the analysis runs ahead of the synthesis and the latency is zero — but
// only if the work is spread. Two mechanisms, both of them the sheet's:
//
// - **Head analysis at zone load.** `SpectralHead` precomputes the first 100 ms
//   of a zone. Without it a note-on has to compute four FFTs inside one block
//   to fill the overlap-add pipeline, which at N = 2048 is about 225 000 flops
//   arriving in one 256-sample block — a spike that is invisible in a mean CPU
//   figure and audible as a dropout on the first note of a chord.
// - **Exactly one analysis frame per synthesis hop in steady state.** Never a
//   burst. `sample_spectral_tests`' head-analysis row counts transforms in the
//   first block against the steady-state rate and fails on a burst.
//
//
// **The Formant control is deliberately absent.** §7.3 lists one and §13 item 6
// says not to ship it until the cepstral-liftering parameters are specified —
// the lifter cutoff, the envelope order, and the behaviour at low pitch where
// the envelope and the harmonic structure are not separable are all [X]. An
// under-specified formant shifter sounds worse than no formant control, so
// there is no destination for it here and adding one is a spec change first.
#pragma once

#include "../fft.h"
#include "classic_read.h"
#include "vocoder_frame.h"

#include <cstddef>
#include <cstdint>
#include <vector>

namespace mw::dsp::sample {

/// §10.3's per-tier FFT sizes, and §7.3's control. The cap is a property of the
/// quality tier and not of the control, so a project made on a desktop opens on
/// a phone with a smaller transform rather than refusing to open.
inline std::size_t fftSizeFor(std::size_t requested, Quality tier) noexcept {
  const std::size_t cap = tier == Quality::Eco ? 1024u : (tier == Quality::Normal ? 2048u : 4096u);
  std::size_t n = requested < 1024u ? 1024u : requested;
  if (n > cap) n = cap;
  return isPowerOfTwo(n) ? n : 2048u;
}

/// §10.3: spectral voices are capped at 2 / 8 / 32 by tier, and the cap is
/// applied by **refusing a new spectral voice and falling back to Classic**,
/// never by dropping a note. A silently dropped note is worse than a note that
/// plays with a different engine, and on a short note the difference is often
/// inaudible.
inline int spectralVoiceCap(Quality tier) noexcept {
  return tier == Quality::Eco ? 2 : (tier == Quality::Normal ? 8 : 32);
}

/**
 * Whether a note asking for the spectral engine may have it.
 *
 * Returning `false` means the caller prepares a `ClassicRead` for that note
 * instead — it does **not** mean the note is dropped, and there is no path
 * here that returns "no voice". The distinction is the whole of §10.3's rule
 * and it is stated as a function so that a call site cannot express the other
 * thing by accident.
 */
inline bool spectralVoiceAdmitted(int activeSpectralVoices, Quality tier) noexcept {
  return activeSpectralVoices < spectralVoiceCap(tier);
}

/// §7.3's spectral controls. Formant is absent by design — see the header.
struct SpectralControls {
  std::size_t fftSize = 2048;
  PhaseLock phaseLock = PhaseLock::Identity;
  /// 0…100 %, a character control: a randomised phase advance.
  double blurPercent = 0.0;
  /// 0…100 %, drives the §4.4 frame reset detector.
  double transientSensitivity = 50.0;
  /// Off entirely, which V-20 needs: the null is specified with transient
  /// handling off, and a detector that fires on the test signal would move
  /// frames off the COLA grid and the null with them.
  bool transientsEnabled = true;
};

/**
 * The per-zone head analysis: the first 100 ms, computed at load.
 *
 * Owned by the zone, not by the voice, because every note on that zone starts
 * from the same place and would otherwise each pay for the same nine
 * transforms. At 44.1 kHz with N = 2048 and H = 512 that is 9 frames of
 * 1025 bins — the sheet's 74 kB, here as two `double` arrays per frame.
 *
 * §13 item 8 records the 100 ms as [I]: nine frames covers the pipeline with
 * margin, and the right number depends on how far ahead the scheduler can
 * look, which the framework does not exist to answer yet.
 */
class SpectralHead {
 public:
  static constexpr double kHeadMs = 100.0;

  /// Load-time, so allocation is expected and fine. Nothing calls this from
  /// `render`.
  void build(const float* data, std::size_t frames, double rate, std::size_t n,
             std::size_t hop) {
    n_ = n;
    hop_ = hop;
    bins_ = n / 2 + 1;
    frames_ = 0;
    if (data == nullptr || frames == 0 || hop == 0 || !isPowerOfTwo(n)) return;
    const std::size_t span = static_cast<std::size_t>(kHeadMs * 1.0e-3 * rate);
    const std::size_t count = span / hop + 1;
    std::vector<double> window(n), re(n), im(n), mag(bins_), phase(bins_);
    hann(window);
    mag_.assign(count * bins_, 0.0);
    phase_.assign(count * bins_, 0.0);
    for (std::size_t m = 0; m < count; ++m) {
      analyseFrame(data, frames, static_cast<long long>(m * hop), 0.0, window, re, im, mag,
                   phase);
      for (std::size_t k = 0; k < bins_; ++k) {
        mag_[m * bins_ + k] = mag[k];
        phase_[m * bins_ + k] = phase[k];
      }
    }
    frames_ = count;
  }

  /**
   * The precomputed frame whose analysis start is exactly `start`, or null.
   *
   * Exactly, not nearly: a frame at a fractional or off-grid position has a
   * different phase reference, and returning a neighbouring frame instead
   * would put a phase step at the first note-on that the transient detector
   * would then read as an onset. A miss simply costs one transform, which is
   * the steady-state rate anyway.
   */
  bool lookup(long long start, double residue, std::size_t n, std::size_t hop,
              std::vector<double>& mag, std::vector<double>& phase) const noexcept {
    if (frames_ == 0 || n != n_ || hop != hop_ || residue != 0.0 || start < 0) return false;
    const auto s = static_cast<std::size_t>(start);
    if (s % hop_ != 0) return false;
    const std::size_t m = s / hop_;
    if (m >= frames_) return false;
    for (std::size_t k = 0; k < bins_; ++k) {
      mag[k] = mag_[m * bins_ + k];
      phase[k] = phase_[m * bins_ + k];
    }
    return true;
  }

  std::size_t frames() const noexcept { return frames_; }

 private:
  std::vector<double> mag_;
  std::vector<double> phase_;
  std::size_t n_ = 0;
  std::size_t hop_ = 0;
  std::size_t bins_ = 0;
  std::size_t frames_ = 0;
};

}  // namespace mw::dsp::sample
