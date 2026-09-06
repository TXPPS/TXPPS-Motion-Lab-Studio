// Motion Wave — the Slipstream Sampler's spectral engine. `smp-01` §4.4.
//
// A phase vocoder, plus the classic read head on its output. The arithmetic of
// one frame lives in `vocoder_frame.h`, together with the derivation of every
// equation and the record of which of them agreed with the sheet; this file is
// the scheduling — which frame is analysed when, how the overlap-add is
// normalised, and how the output is read at increment `p`.
//
// **The decomposition, which is why there is a resampler here at all.** A
// vocoder at stretch `alpha` changes duration by `alpha` and leaves pitch
// alone; resampling that result at increment `p` changes duration by `1/p` and
// pitch by `p`. The net duration factor is `alpha/p` and the wanted one is
// `1/rho`, so `alpha = p/rho`, and the vocoder's output is then read at
// increment `p`. Taken from the sheet, which derives it; re-checked here by
// substituting `rho = 1, p = 2` (an octave up at normal speed: `alpha = 2`, so
// the vocoder doubles the duration and the read at 2 halves it again) and
// `rho = 2, p = 1` (double speed at pitch: `alpha = 0.5`, read at 1).
//
// **The output resampler is the classic engine's**, in the sense the sheet
// means: the same three kernels behind the same `Quality` tiers, the same
// `MipMap::levelFor` rule for when Normal drops a level, and the same
// `SincTable` instance the instrument already built. What is *not* shared is
// `ClassicRead`'s position bookkeeping, and deliberately: that code wraps loops
// and applies a note's sample-start offset, and a vocoder's output stream has
// neither. The loop lives upstream, in the source read the analysis walks over,
// so a `ClassicRead` here would be carrying two disabled features and a
// `pos_` that cannot be rebased when the ring recycles. `outputSample()` below
// is the dispatch and nothing else.
//
// **Zero latency, structurally**, and where that is paid for. A real-time
// vocoder costs a window of latency because it cannot see the future; this one
// reads a stored file, so the analysis runs ahead of the synthesis. The read
// head is at output sample 0 from the first block. `spectral_zone.h` holds the
// two mechanisms that keep the work from arriving all at once.
//
// **The overlap-add normalisation, and why a transient frame needs its own.**
// A periodic Hann at 75 % overlap has an analysis-plus-synthesis squared-window
// sum of 1.5, and that constant is *measured* at prepare rather than assumed —
// `colaGain_` — because an assumed one becomes a quiet gain error the first
// time the window or the overlap moves.
//
// A transient frame resets its phase and takes `H_s = H_a`, which puts it off
// the grid its neighbours were placed on, so the window sum around it is not
// that constant. The sheet describes the consequence as a level notch on every
// transient. **Measured here it is the other sign and much larger**: at a 4x
// stretch the reset hold packs four times as many windows into the same span,
// so dividing by the constant multiplied the attack rather than notching it —
// a source peaking at 0.70 came out at 2.80. Either way the cause is one
// thing, a frame off the COLA grid divided by the constant its neighbours
// assume, and the fix is one thing: `norm_` accumulates the squared window
// alongside the signal and is divided out per output sample, which is right on
// the grid and off it. `sample_vocoder_tests` carries the measurement and the
// row that had predicted a notch and passed under the mutation.
//
#pragma once

#include "../interpolate.h"
#include "classic_read.h"
#include "sinc_table.h"
#include "spectral_transient.h"
#include "spectral_zone.h"
#include "vocoder_frame.h"
#include "zone.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace mw::dsp::sample {

class SpectralRead {
 public:
  /// No allocation on any path `render` can reach. Every buffer is sized here.
  void prepare(const ClassicSource& source, const SincTable* sinc, Quality quality,
               double hostRate, const SpectralControls& controls, const SpectralHead* head,
               std::uint32_t seed) {
    src_ = source;
    sinc_ = sinc;
    quality_ = (quality == Quality::High && sinc == nullptr) ? Quality::Normal : quality;
    controls_ = controls;
    head_ = head;
    seed_ = seed;
    n_ = fftSizeFor(controls.fftSize, quality_);
    hopS_ = n_ / 4;  // 75 % overlap, the sheet's configuration.
    bins_ = n_ / 2 + 1;
    active_ = src_.data != nullptr && src_.frames > 0 && hostRate > 0.0 && src_.sampleRate > 0.0;
    fileToHost_ = active_ ? src_.sampleRate / hostRate : 1.0;

    window_.assign(n_, 0.0);
    hann(window_);
    // The COLA constant is measured from the window this run actually built,
    // not assumed from the textbook value for a periodic Hann at 75 %. A
    // measured constant survives a change of window or overlap; an assumed one
    // becomes a quiet gain error the first time either moves.
    colaGain_ = 0.0;
    for (std::size_t i = 0; i < n_; i += hopS_) colaGain_ += window_[i] * window_[i];

    re_.assign(n_, 0.0);
    im_.assign(n_, 0.0);
    mag_.assign(bins_, 0.0);
    phase_.assign(bins_, 0.0);
    prevPhase_.assign(bins_, 0.0);
    synthPhase_.assign(bins_, 0.0);
    transient_.prepare(bins_);
    peakOf_.assign(bins_, 0);
    peaks_.clear();
    peaks_.reserve(bins_);
    // The ring holds one window of synthesis plus the resampler's reach, and
    // is a power of two so the wrap is a mask rather than a modulo — the read
    // is per output sample and a division there is the whole engine's cost
    // profile changed for nothing.
    ringSize_ = 1;
    while (ringSize_ < n_ * 4) ringSize_ <<= 1;
    ringMask_ = ringSize_ - 1;
    ring_.assign(ringSize_, 0.0);
    norm_.assign(ringSize_, 0.0);

    // State. `readPos_` is in vocoder-output samples and is what `p` advances;
    // `analysePos_` is in source samples and is what `H_a` advances.
    analysePos_ = static_cast<double>(src_.sampleStart > src_.frames ? src_.frames
                                                                     : src_.sampleStart);
    readPos_ = 0.0;
    lastStart_ = static_cast<long long>(std::floor(analysePos_));
    writePos_ = 0.0;
    written_ = 0;
    frameIndex_ = 0;
    firstFrame_ = true;
    transforms_ = 0;
    resetFrames_ = 0;
    resetHold_ = 0;
    released_ = false;
    for (std::size_t i = 0; i < ringSize_; ++i) {
      ring_[i] = 0.0;
      norm_[i] = 0.0;
    }
  }

  /**
   * §4.1's contract. `pitch` is semitones and `speed` a ratio, both per sample.
   *
   * `p` is the read increment the classic engine would have used — the pitch
   * ratio times `fsFile/fsHost` — and `rho` is the speed. `alpha = p/rho` is
   * recomputed every sample because both move continuously under a glide, and
   * a per-block `alpha` is the zipper artefact §4.1 forbids, at the host's
   * buffer rate.
   */
  void render(float* out, int frames, const float* pitch, const float* speed) noexcept {
    for (int i = 0; i < frames; ++i) {
      if (!active_) {
        out[i] = 0.0f;
        continue;
      }
      const double p = semitoneRatio(static_cast<double>(pitch[i])) * fileToHost_;
      double rho = speed != nullptr ? static_cast<double>(speed[i]) : 1.0;
      // §7.3 gives speed a dead zone of +/-0.01 around zero; a freeze is a
      // stopped playhead, and dividing by a speed that is merely very small
      // sends `alpha` to infinity and the analysis hop with it.
      if (rho > -0.01 && rho < 0.01) rho = 0.0;
      const double alpha = rho == 0.0 ? kFreezeAlpha : p / rho;

      // Produce vocoder output until the read head plus its kernel's reach is
      // inside the region every overlapping window has already contributed to.
      //
      // That region ends `n_ - hopS_` behind the write frontier, not at the
      // frontier: a sample within one window of the frontier has had only some
      // of its four contributions laid down. The `norm_` divide would rescale
      // it to roughly the right level anyway — which is why V-20 still nulls
      // if this is got wrong — but only because an unmodified STFT's partial
      // sums happen to be consistent. Once a phase has been advanced they are
      // not, and reading early puts a window-length smear on every stretch.
      //
      // One synthesis hop per pass, so a slow read produces nothing this
      // sample and a fast one may produce several: that is the steady state's
      // "exactly one analysis frame per synthesis hop", with `alpha` setting
      // how many hops a sample of output costs.
      const double needed = readPos_ + kernelReach(p) + 1.0 + static_cast<double>(n_ - hopS_);
      while (active_ && needed >= static_cast<double>(written_)) {
        produceHop(alpha);
      }
      if (!active_) {
        out[i] = 0.0f;
        continue;
      }
      out[i] = outputSample(p);
      readPos_ += p;
    }
  }

  void release() noexcept {
    released_ = true;
    if (src_.loopMode == LoopMode::Sustain) src_.loopMode = LoopMode::NoLoop;
  }

  bool active() const noexcept { return active_; }
  /// Transforms computed since `prepare`. The head-analysis row reads this.
  std::size_t transforms() const noexcept { return transforms_; }
  std::size_t resetFrames() const noexcept { return resetFrames_; }
  std::size_t frameCount() const noexcept { return frameIndex_; }
  std::size_t fftSize() const noexcept { return n_; }
  /// The measured window-sum constant, so a test can state what it measured.
  double colaGain() const noexcept { return colaGain_; }

  /**
   * Two defeat switches, and why they are in the product header rather than in
   * a test's copy of the engine.
   *
   * The fractional-hop compensation's whole claim is that omitting it adds a
   * sideband **that appears only while the pitch is moving** — which is a claim
   * about a difference between two renders, and a difference cannot be measured
   * unless both renders can be produced. A test that reimplemented the
   * uncompensated engine to get the second one would be measuring its own copy,
   * and the two would drift apart at the first change to either; that is the
   * same fault as a second opinion about what the audio is doing, one layer up.
   *
   * So the defeated paths are here, they default to the correct behaviour, and
   * nothing but `sample_vocoder_tests` sets them. They are the executable form
   * of mutations 2 and 3 in that file's header, kept beside the correction they
   * replace rather than described in a comment — a correction whose defect
   * cannot still be run is a correction nobody can check.
   */
  void setHopResidueCompensation(bool on) noexcept { compensateResidue_ = on; }
  void setActualHopInExpectedAdvance(bool on) noexcept { actualHopInExpected_ = on; }

 private:
  /// A freeze holds the playhead, so the vocoder must keep producing output
  /// from the same source position for ever: an infinite stretch. A large
  /// finite alpha rather than an infinity keeps every `H_a = H_s/alpha`
  /// arithmetic finite; at 1e6 the analysis advances a sample per 2000 hops,
  /// which is a freeze at any musical timescale.
  static constexpr double kFreezeAlpha = 1.0e6;

  double kernelReach(double rate) const noexcept {
    switch (quality_) {
      case Quality::Eco:
        return 1.0;
      case Quality::Normal:
        return 2.0;
      case Quality::High:
      default:
        return static_cast<double>(SincTable::halfWidthFor(rate)) + 1.0;
    }
  }

  /**
   * One synthesis hop: analyse the frame at the current analysis position,
   * advance its phase, and overlap-add the result.
   *
   * The analysis position is fractional and the read is not, so the position
   * is split into an integer start and a residue, and the residue is
   * compensated as a linear phase ramp (`vocoder_frame.h` derives the sign).
   * `hopA` — what actually separated this frame from the last — is the
   * difference between the two *fractional* positions, not between the two
   * rounded reads: rounding it would make the estimator's expectation
   * disagree with the frame in front of it by up to half a sample's worth of
   * advance, on every bin, and that disagreement follows the glide.
   */
  void produceHop(double alpha) noexcept {
    const double hopA = static_cast<double>(hopS_) / alpha;
    const HopSplit split = fractionalResidue(analysePos_);
    if (split.start >= static_cast<long long>(src_.frames) && !firstFrame_) {
      active_ = false;
      return;
    }
    const double residue = compensateResidue_ ? split.residue : 0.0;
    if (head_ == nullptr || !head_->lookup(split.start, residue, n_, hopS_, mag_, phase_)) {
      analyseFrame(src_.data, src_.frames, split.start, residue, window_, re_, im_, mag_, phase_);
      ++transforms_;
    }

    // **The reset is held for a window, not applied to a frame.** A detection
    // says a transient is inside *this* analysis window, and that window is
    // `N` samples long — so the attack is still inside the next `N/H_a`
    // windows too, and stretching any of them stretches the attack. Resetting
    // only the frame that trips the detector left V-23 reading 12.5x the
    // source's rise time at N = 2048 with the phase reset and the `H_a`
    // placement both already in: the reset frame arrived at source spacing and
    // the three frames that still contained the attack did not, so the attack
    // was reassembled from four contributions spread over four synthesis hops.
    //
    // Holding the reset until the window that detected it has passed is what
    // makes the attack a contiguous piece of the source again. The hold is
    // derived — it is `N/H_a` frames, the number that still overlap the
    // detecting window — rather than a tuned constant, which is the difference
    // between a rule and a number fitted to today's measurement.
    if (transient_.detect(mag_, bins_, controls_.transientsEnabled,
                          controls_.transientSensitivity)) {
      resetHold_ = hopA > 0.0 ? static_cast<int>(std::ceil(static_cast<double>(n_) / hopA)) : 1;
    }
    const bool reset = resetHold_ > 0;
    if (resetHold_ > 0) --resetHold_;
    // The hop the estimator's expectation is built from. `hopA` is what
    // actually separates this frame's *wanted* position from the last one's;
    // the rounded alternative is the distance between the two integer reads,
    // which is what a frame that ignored its residue would have to assume. The
    // two differ by up to a sample, and the difference follows the glide.
    const double roundedHop = static_cast<double>(split.start - lastStart_);
    const double hopUsed = actualHopInExpected_ || firstFrame_ ? hopA : roundedHop;
    lastStart_ = split.start;
    lockRegions(mag_, bins_, peaks_, peakOf_);
    const double blur = controls_.blurPercent * 0.01;
    advancePhase(mag_, phase_, prevPhase_, synthPhase_, bins_, n_, hopUsed,
                 static_cast<double>(hopS_), controls_.phaseLock, peakOf_, blur, seed_,
                 static_cast<std::uint32_t>(frameIndex_), reset || firstFrame_, re_, im_);
    firstFrame_ = false;
    inverseFft(re_, im_);

    // Overlap-add, windowed a second time. The synthesis window is what makes
    // a modified frame taper into its neighbours instead of stepping; the
    // normalisation accumulator carries the squared window so that the divide
    // below is by what was actually laid down, which is the only form that is
    // right for a reset frame sitting off the grid.
    const auto base = static_cast<std::size_t>(writePos_);
    for (std::size_t i = 0; i < n_; ++i) {
      const std::size_t at = (base + i) & ringMask_;
      ring_[at] += re_[i] * window_[i];
      norm_[at] += window_[i] * window_[i];
    }

    // **The synthesis hop, and the one case where it is not `H_s`.** A reset
    // frame takes `H_s = H_a` — the sheet's rule, and it is the whole of the
    // transient handling. Resetting the phase alone restores the frame's own
    // waveform and does nothing about the attack being spread over `alpha`
    // times as long, because the *next* frame would still be placed a full
    // synthesis hop away; V-23 measured a rise time 13.7x the source's with
    // the phase reset in and this line out, which is a whoosh with the right
    // spectrum. Advancing by `H_a` instead packs the frames around a transient
    // at the source's own spacing, so the attack arrives at source rate and
    // the stretch resumes after it.
    //
    // The frontier is fractional because `H_a` is: rounding it here would put
    // the reset frame's contribution up to a sample away from where its phase
    // says it belongs, and that is a phase error of a whole bin at the top of
    // the spectrum.
    if (reset) ++resetFrames_;
    writePos_ += reset ? hopA : static_cast<double>(hopS_);
    written_ = static_cast<std::size_t>(writePos_);
    ++frameIndex_;

    // Clear the slot the next hop will write into, one window ahead of the
    // frontier: the ring is a power of two and a stale contribution from
    // `ringSize_` samples ago would otherwise add itself to this frame. The
    // span cleared is a whole synthesis hop even when the frame advanced by
    // less, because clearing less than the frontier can move would leave a
    // stale sample inside the next frame's span.
    const std::size_t clearFrom = written_ + n_;
    for (std::size_t i = 0; i < hopS_; ++i) {
      const std::size_t at = (clearFrom + i) & ringMask_;
      ring_[at] = 0.0;
      norm_[at] = 0.0;
    }

    analysePos_ += hopA;
    if (analysePos_ >= static_cast<double>(src_.frames) + static_cast<double>(n_)) {
      active_ = false;
    }
  }

  /**
   * One output sample at `readPos_`, through the classic engine's kernels.
   *
   * The tier dispatch is `ClassicRead::readAt`'s, less the loop wrapping and
   * the mip-map: a vocoder's output is a stream this voice just made, so there
   * is no pyramid of it to read from and no join for a tap to straddle. At
   * `rate == 1` and an integer position the exact path returns the sample
   * itself, which is what V-20's null needs — an interpolator that ran
   * unconditionally would put its own error into a test whose target is the
   * STFT round-trip.
   */
  float outputSample(double rate) const noexcept {
    const double floored = std::floor(readPos_);
    const double frac = readPos_ - floored;
    const long long i = static_cast<long long>(floored);
    const double r = rate < 0.0 ? -rate : rate;
    if (r == 1.0 && frac == 0.0) return static_cast<float>(tap(i));
    switch (quality_) {
      case Quality::Eco:
        return linear2(static_cast<float>(tap(i)), static_cast<float>(tap(i + 1)),
                       static_cast<float>(frac));
      case Quality::Normal:
        return hermite4(static_cast<float>(tap(i - 1)), static_cast<float>(tap(i)),
                        static_cast<float>(tap(i + 1)), static_cast<float>(tap(i + 2)),
                        static_cast<float>(frac));
      case Quality::High:
      default:
        return sinc_->read([this](long long k) noexcept { return static_cast<float>(tap(k)); }, i,
                           frac, r);
    }
  }

  /// The vocoder's output at absolute stream index `at`, normalised by the
  /// window sum actually laid down there. A sample the overlap-add has not
  /// reached, or one the ring has already recycled, is zero rather than stale
  /// — a stale sample would be a whole window of old audio arriving as a click.
  double tap(long long at) const noexcept {
    if (at < 0) return 0.0;
    const auto a = static_cast<std::size_t>(at);
    if (a >= written_ || (written_ - a) > ringSize_ - n_) return 0.0;
    const std::size_t idx = a & ringMask_;
    const double w = norm_[idx];
    // Below a hundredth of the COLA constant the divide amplifies whatever
    // rounding is in the numerator rather than recovering a signal; the edges
    // of the very first frame are the only place it happens.
    return w > colaGain_ * 0.01 ? ring_[idx] / w : 0.0;
  }

  ClassicSource src_;
  const SincTable* sinc_ = nullptr;
  const SpectralHead* head_ = nullptr;
  SpectralControls controls_;
  Quality quality_ = Quality::Normal;
  std::size_t n_ = 2048;
  std::size_t hopS_ = 512;
  std::size_t bins_ = 1025;
  std::size_t ringSize_ = 8192;
  std::size_t ringMask_ = 8191;
  double colaGain_ = 1.5;
  double fileToHost_ = 1.0;
  double analysePos_ = 0.0;
  double readPos_ = 0.0;
  /// The overlap-add frontier, fractional because a reset frame advances it by
  /// `H_a`. `written_` is its floor and is what the ring and the read bound use.
  double writePos_ = 0.0;
  std::size_t written_ = 0;
  std::size_t frameIndex_ = 0;
  std::size_t transforms_ = 0;
  std::size_t resetFrames_ = 0;
  /// Frames still inside a detected transient's own analysis window. See the
  /// derivation at the call site: the hold is `N/H_a`, never a tuned constant.
  int resetHold_ = 0;
  std::uint32_t seed_ = 0;
  long long lastStart_ = 0;
  bool active_ = false;
  bool firstFrame_ = true;
  /// Both default to the correct behaviour; only `sample_vocoder_tests` moves
  /// them, through the two setters above.
  bool compensateResidue_ = true;
  bool actualHopInExpected_ = true;
  bool released_ = false;

  std::vector<double> window_;
  std::vector<double> re_;
  std::vector<double> im_;
  std::vector<double> mag_;
  std::vector<double> phase_;
  std::vector<double> prevPhase_;
  std::vector<double> synthPhase_;
  std::vector<double> ring_;
  std::vector<double> norm_;
  std::vector<std::size_t> peaks_;
  std::vector<std::size_t> peakOf_;
  TransientDetector transient_;
};

}  // namespace mw::dsp::sample
