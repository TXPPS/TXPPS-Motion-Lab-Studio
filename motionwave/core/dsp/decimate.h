// Motion Wave — running a signal fast and bringing it back down cleanly.
//
// The answer that always works. A drawn modulator is discontinuous by design —
// a `step` node is a jump in value, and a node with tension is a jump in slope
// — and sampling either at the audio rate folds everything above Nyquist back
// into the band as inharmonic tones. Band-limiting each discontinuity in place
// (polyBLEP for a step, polyBLAMP for a corner) is the efficient fix and it is
// also the fiddly one: apply the wrong correction to the wrong class and it
// *injects* the discontinuity it was meant to remove.
//
// Generating the modulator at several times the rate and filtering before
// decimating does not care which class a discontinuity belongs to. It costs
// more arithmetic and it is correct by construction. For a control signal of a
// few hundred Hz that trade is not close — `fx-01` §7 puts the modulator at a
// small fraction of the unit's budget, so eight times a small fraction is still
// small.
//
// The measured case: the Motion Shaper's alias floor was −40.7 dBFS at the
// sheet's 90 Hz and −38.9 dBFS at 97.3 Hz, against a −80 dBFS target.
#pragma once

#include "biquad.h"

namespace mw::dsp {

/**
 * How many sub-samples one output sample is built from.
 *
 * Eight rather than four, and the measured benefit is what justifies it: the
 * Motion Shaper's alias floor is −69 dBFS at 1× and −87 dBFS at 8×, against a
 * −80 dBFS target. Eighteen decibels for one more octave of arithmetic on a
 * signal that `fx-01` §7 already costs at a small fraction of the unit.
 */
inline constexpr int kOversampleFactor = 8;

/**
 * The anti-imaging filter's corner, as a fraction of the *output* Nyquist.
 *
 * 0.75, chosen by measuring rather than by reasoning, because the two things it
 * trades off pull in opposite directions and neither is obvious:
 *
 *   corner   alias floor   clicks flagged by V3
 *   0.30      −87.0 dB           4
 *   0.45      −87.0 dB           2
 *   0.60      −87.0 dB           0
 *   0.75      −87.0 dB           0
 *   0.98      −87.0 dB           0
 *
 * The alias floor does not move at all — the oversampling is what buys it, not
 * the corner — so the corner is free to be chosen entirely on the other axis.
 * And on that axis a *lower* corner is worse, which is the opposite of the
 * intuition: a fourth-order Butterworth overshoots on a step, and the lower the
 * corner the longer and larger that ringing, until it trips the click detector.
 *
 * 0.75 sits clear of the 0.60 edge without hugging Nyquist, where the filter
 * still has anti-imaging work to do.
 */
inline constexpr double kDecimationCutoff = 0.75;

/**
 * Fourth-order Butterworth, as two cascaded biquads, running at the oversampled
 * rate.
 *
 * The Q values are the Butterworth pole pair for order four — 0.5412 and 1.3066
 * — and not two sections at 0.7071. Two Butterworth-second-order sections in
 * series make a Linkwitz-Riley response, which is −6 dB at the corner rather
 * than −3, and would take a visible bite out of a fast modulator's top end.
 */
class Decimator {
 public:
  /// `outputRate` is the rate being decimated *to*. `cutoffFraction` overrides
  /// the default corner as a fraction of the output Nyquist, for measuring
  /// where the corner has to sit.
  void prepare(double outputRate, double cutoffFraction = kDecimationCutoff) noexcept {
    const double oversampled = outputRate * static_cast<double>(kOversampleFactor);
    const double cutoff = outputRate * 0.5 * cutoffFraction;
    stage1_.setCoeffs(lowpassCoeffs(cutoff, 0.54119610014619698, oversampled));
    stage2_.setCoeffs(lowpassCoeffs(cutoff, 1.30656296487637652, oversampled));
    reset();
  }

  void reset() noexcept {
    stage1_.reset();
    stage2_.reset();
  }

  /// Feed one sub-sample. Every sub-sample must be fed, not only the kept ones.
  ///
  /// That is the whole point and the easiest thing to get wrong: filtering only
  /// the samples that survive decimation is not filtering at all, because the
  /// energy that would alias is in the ones being discarded.
  double push(double x) noexcept { return stage2_.process(stage1_.process(x)); }

 private:
  Biquad stage1_;
  Biquad stage2_;
};

}  // namespace mw::dsp
