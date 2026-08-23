// Motion Wave — splitting a signal into bands that add back up to itself.
//
// The Motion Shaper's three bands, and every multiband processor after it, rest
// on one property: with all bands passed through unmodified, the sum must be
// the input. `fx-01` V2 states the gate as ±0.05 dB from 20 Hz to 20 kHz, and
// there are exactly three ways to miss it, all of them silent:
//
//  1. Using the wrong all-pass order on the low band of a three-band split. The
//     loudspeaker literature calls an LR4 crossover "fourth-order all-pass",
//     which names the crossover rather than the section; the sum of an LR4 pair
//     is a *second*-order all-pass (`fx-01` §4.1 derives it). Building the
//     fourth-order one doubles the phase rotation and breaks the sum it was
//     added to fix.
//  2. Forgetting the polarity inversion at 12 dB/oct. An LR2 pair sums to a
//     *first*-order all-pass with a sign flip, not to unity, so one branch must
//     be inverted — and 6 dB/oct must not be, because a first-order pair sums to
//     exactly 1.
//  3. Cascading a three-band split without compensating at all, so the low band
//     misses the second crossover's phase entirely.
//
// Each of those produces a plausible-sounding device with a dip or a bump
// around a crossover that nobody notices until it is compared against the dry
// signal. That is why the sum flatness is a test rather than a review note.
#pragma once

#include "biquad.h"

namespace mw::dsp {

/// Crossover steepness. The numbers are dB per octave, as the UI shows them.
enum class Slope { Db6 = 6, Db12 = 12, Db24 = 24 };

/**
 * One two-way split: in at one point, out as low and high.
 *
 * Holds no opinion about how many bands there are. A three-way split is two of
 * these plus the compensation below, which is also how a four-way would be
 * built — the recursion is the reason this is a separate object rather than
 * three hard-coded bands.
 */
class TwoWaySplit {
 public:
  void prepare(double sampleRate, double frequency, Slope slope) noexcept {
    sampleRate_ = sampleRate;
    slope_ = slope;
    const double q = kButterworthQ;
    switch (slope) {
      case Slope::Db6:
        // First order, expressed as a biquad with the second-order terms zero.
        // One code path for every slope is worth more than the two multiplies
        // it costs: a separate one-pole class is a second place for the state
        // handling and the denormal flush to be got wrong.
        setFirstOrder(frequency);
        stages_ = 1;
        break;
      case Slope::Db12:
        // Linkwitz-Riley 2, which is two cascaded *first-order* Butterworth
        // sections — not one second-order Butterworth. The distinction is the
        // whole difference between −6 dB at the corner (LR, sums to unity
        // magnitude) and −3 dB (Butterworth, sums to +3 dB there). Building it
        // the second way measures as a 3 dB bump at every crossover, which is
        // what this did before the sum test caught it.
        setFirstOrder(frequency);
        lowB_.setCoeffs(lowA_.coeffs());
        highB_.setCoeffs(highA_.coeffs());
        stages_ = 2;
        break;
      case Slope::Db24:
        // Linkwitz-Riley 4 is two cascaded Butterworth sections per branch,
        // which is what makes each branch −6 dB at the corner and the pair sum
        // to 0 dB there rather than to +3.
        lowA_.setCoeffs(lowpassCoeffs(frequency, q, sampleRate));
        lowB_.setCoeffs(lowpassCoeffs(frequency, q, sampleRate));
        highA_.setCoeffs(highpassCoeffs(frequency, q, sampleRate));
        highB_.setCoeffs(highpassCoeffs(frequency, q, sampleRate));
        stages_ = 2;
        break;
    }
    reset();
  }

  void reset() noexcept {
    lowA_.reset();
    lowB_.reset();
    highA_.reset();
    highB_.reset();
  }

  /// Split one sample. `low` and `high` are written, never accumulated.
  void process(double x, double& low, double& high) noexcept {
    low = lowA_.process(x);
    high = highA_.process(x);
    if (stages_ == 2) {
      low = lowB_.process(low);
      high = highB_.process(high);
    }
    // At 12 dB/oct the pair sums to an *inverted* first-order all-pass, so one
    // branch has to flip to make the sum flat. At 6 and 24 it must not: a
    // first-order pair sums to exactly 1, and an LR4 pair to a second-order
    // all-pass with no sign change. Getting this backwards is a 6 dB notch at
    // the crossover that reads as "the 12 dB setting sounds thin".
    if (slope_ == Slope::Db12) high = -high;
  }

  Slope slope() const noexcept { return slope_; }
  double sampleRate() const noexcept { return sampleRate_; }

 private:
  void setFirstOrder(double frequency) noexcept {
    // Bilinear-transformed first-order pair. `k = tan(π f / fs)`, so
    // lowpass = k/(1+k) · (1 + z⁻¹) / (1 + (k−1)/(k+1) z⁻¹).
    const double nyquist = sampleRate_ * 0.5;
    const double f = frequency < 1.0 ? 1.0
                                     : (frequency > nyquist * 0.999 ? nyquist * 0.999 : frequency);
    const double k = std::tan(3.14159265358979323846 * f / sampleRate_);
    const double norm = 1.0 / (k + 1.0);
    BiquadCoeffs lp;
    lp.b0 = k * norm;
    lp.b1 = k * norm;
    lp.b2 = 0.0;
    lp.a1 = (k - 1.0) * norm;
    lp.a2 = 0.0;
    BiquadCoeffs hp;
    hp.b0 = norm;
    hp.b1 = -norm;
    hp.b2 = 0.0;
    hp.a1 = (k - 1.0) * norm;
    hp.a2 = 0.0;
    lowA_.setCoeffs(lp);
    highA_.setCoeffs(hp);
  }

  Biquad lowA_;
  Biquad lowB_;
  Biquad highA_;
  Biquad highB_;
  Slope slope_ = Slope::Db24;
  int stages_ = 2;
  double sampleRate_ = 48000.0;
};

/**
 * Three bands whose sum is the input.
 *
 * Cascaded: split at `f1` into low and everything-above, then split the upper
 * part at `f2` into mid and high. That leaves the low band having skipped the
 * `f2` network, so it carries none of that network's phase — and a sum of
 * signals that disagree about phase is not the input, it is the input through a
 * filter nobody designed.
 *
 * The correction is one all-pass section on the low band at `f2`, because the
 * sum of the `f2` crossover *is* an all-pass at `f2`: putting the low band
 * through the same thing the other two bands' sum went through makes all three
 * agree. One biquad per channel, which is the cheapest correct answer.
 */
class ThreeBandSplit {
 public:
  void prepare(double sampleRate, double lowMid, double midHigh, Slope slope) noexcept {
    slope_ = slope;
    lower_.prepare(sampleRate, lowMid, slope);
    upper_.prepare(sampleRate, midHigh, slope);
    // Matched to the slope, since what has to be cancelled is the sum of *this*
    // crossover: LR4 sums to a second-order all-pass, LR2 to a first-order one,
    // and a 6 dB/oct pair sums to unity and so needs no compensation at all.
    switch (slope) {
      case Slope::Db24:
        compensate_.setCoeffs(allpassCoeffs(midHigh, kButterworthQ, sampleRate));
        compensating_ = true;
        break;
      case Slope::Db12: {
        // A first-order all-pass, written as a biquad with the second-order
        // terms zero: (k−1 + (k+1)z⁻¹) / ((k+1) + (k−1)z⁻¹).
        const double k = std::tan(3.14159265358979323846 * midHigh / sampleRate);
        const double norm = 1.0 / (k + 1.0);
        BiquadCoeffs c;
        c.b0 = (k - 1.0) * norm;
        c.b1 = 1.0;
        c.b2 = 0.0;
        c.a1 = (k - 1.0) * norm;
        c.a2 = 0.0;
        compensate_.setCoeffs(c);
        compensating_ = true;
        break;
      }
      case Slope::Db6:
        compensating_ = false;
        break;
    }
    reset();
  }

  void reset() noexcept {
    lower_.reset();
    upper_.reset();
    compensate_.reset();
  }

  /// Split one sample into three bands that sum back to it.
  void process(double x, double& low, double& mid, double& high) noexcept {
    double rest = 0.0;
    lower_.process(x, low, rest);
    upper_.process(rest, mid, high);
    if (compensating_) low = compensate_.process(low);
  }

  Slope slope() const noexcept { return slope_; }

 private:
  TwoWaySplit lower_;
  TwoWaySplit upper_;
  Biquad compensate_;
  bool compensating_ = true;
  Slope slope_ = Slope::Db24;
};

}  // namespace mw::dsp
