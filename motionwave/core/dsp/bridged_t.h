// Motion Wave — the American console lineage's filter engine.
//
// `dyn-05` §6.2. Bridged-T RC networks around discrete op-amp modules with a
// summing node — **no inductors and no gyrators**, which the sheet corrects the
// project brief on directly. The proportional-Q behaviour this lineage is known
// for comes from the network's interaction with the boost/cut divider, not from
// a reactive resonance, and that is why nothing here is shared with the British
// engine: §10 test 19 asserts the two produce measurably different curves for
// nominally equivalent settings, and a shared engine would fail it by
// construction.
#pragma once

#include "biquad.h"
#include "shelving.h"

#include <cmath>

namespace mw::dsp {

/**
 * Bandwidth in octaves for a given boost or cut, §6.2's published law.
 *
 *     BW(g) = 3 · (1/3)^((|g| − 2)/10)
 *
 * Three octaves at 2 dB and one octave at 12 dB are the two *published*
 * endpoints — §6.2 calls them the most precise Q figures available for any unit
 * in this project and says to treat them as a target rather than a guideline.
 * The law between them is logarithmic interpolation and is marked as our
 * inference in the sheet; §10 test 12 measures all five steps so it can be
 * replaced when better data arrives.
 *
 * Reciprocal in the amount, because the bridged-T-plus-summing-node
 * arrangement is: cut mirrors boost, which is stated by the manufacturer and is
 * §10 test 14. Taking the magnitude here is what makes that true of the model.
 */
inline double bridgedTBandwidthOctaves(double amountDb) noexcept {
  const double amount = amountDb < 0.0 ? -amountDb : amountDb;
  return 3.0 * std::pow(1.0 / 3.0, (amount - 2.0) / 10.0);
}

/**
 * The Q a bandwidth in octaves implies.
 *
 * **The bandwidth is the half-gain one, not the −3 dB one, and the distinction
 * is not pedantry here.** A −3 dB bandwidth is measured 3 dB below the peak,
 * which for a 2 dB boost is a contour the curve never reaches — the published
 * "three octaves at 2 dB" cannot mean that, and a test written to the −3 dB
 * wording would be measuring an empty set at three of the five steps. The
 * half-gain convention is also the one the peaking section is parameterised in,
 * so the number that goes in is the number that comes out.
 */
inline double qForBandwidthOctaves(double octaves) noexcept {
  const double span = std::pow(2.0, octaves < 0.01 ? 0.01 : octaves);
  return std::sqrt(span) / (span - 1.0);
}

/// A band of the American lineage: peak or shelf, with the amount setting the
/// shape as well as the size.
class BridgedTBand {
 public:
  enum class Shape { Peak = 0, Shelf = 1 };

  struct Config {
    double frequency = 1500.0;
    /// Decibels. The panel is five detents each way; the value is what the
    /// detent selects rather than a continuous control.
    double amountDb = 0.0;
    Shape shape = Shape::Peak;
    /// Which end a shelf sits at. Ignored for a peak.
    bool highShelf = false;
  };

  void prepare(double sampleRate) noexcept {
    sampleRate_ = sampleRate;
    filter_.reset();
    rebuild();
  }

  void setConfig(const Config& config) noexcept {
    config_ = config;
    rebuild();
  }

  void reset() noexcept { filter_.reset(); }

  double process(double x) noexcept { return filter_.process(x); }

  /// The response this section is actually running, for the face and for the
  /// rows that measure it. Read from the coefficients rather than recomputed
  /// from the control values, so a drawn curve cannot disagree with the audio.
  double magnitudeAt(double frequency) const noexcept {
    return filter_.magnitudeAt(frequency, sampleRate_);
  }

  /// The bandwidth this band is currently working at, for the face and for the
  /// rows that measure it.
  double bandwidthOctaves() const noexcept {
    return bridgedTBandwidthOctaves(config_.amountDb);
  }

 private:
  void rebuild() noexcept {
    const double gain = std::pow(10.0, config_.amountDb / 20.0);
    if (config_.shape == Shape::Shelf) {
      // §10 test 15 asserts a shelf is asymptotic rather than peaking, so the
      // slope stays at one: a shelf given the band's proportional Q would
      // resonate at the corner, which is the British lineage's behaviour and
      // explicitly not this one's.
      filter_.setCoeffs(config_.highShelf
                                  ? highShelfCoeffs(config_.frequency, gain, 1.0, sampleRate_)
                                  : lowShelfCoeffs(config_.frequency, gain, 1.0, sampleRate_));
      return;
    }
    filter_.setCoeffs(peakingCoeffs(config_.frequency, gain,
                                          qForBandwidthOctaves(bandwidthOctaves()), sampleRate_));
  }

  Biquad filter_;
  Config config_{};
  double sampleRate_ = 48000.0;
};

/**
 * The switchable band-pass, §4.4 — 12 dB/octave, 50 Hz to 15 kHz.
 *
 * Independent of every EQ setting, which §10 test 16 asserts and which is why
 * it is a separate object rather than a mode of a band. On the hardware it is a
 * separate network with its own switch.
 */
class BandPass12 {
 public:
  void prepare(double sampleRate) noexcept {
    sampleRate_ = sampleRate;
    rebuild();
    reset();
  }

  void setEnabled(bool enabled) noexcept { enabled_ = enabled; }
  void setCorners(double lowHz, double highHz) noexcept {
    lowHz_ = lowHz;
    highHz_ = highHz;
    rebuild();
  }

  void reset() noexcept {
    high_.reset();
    low_.reset();
  }

  double process(double x) noexcept {
    if (!enabled_) return x;
    return low_.process(high_.process(x));
  }

  double magnitudeAt(double frequency) const noexcept {
    if (!enabled_) return 1.0;
    return high_.magnitudeAt(frequency, sampleRate_) * low_.magnitudeAt(frequency, sampleRate_);
  }

 private:
  void rebuild() noexcept {
    // Butterworth, so the pair is maximally flat in the pass band and the
    // −3 dB points land where the published corners say. A Q chosen for a
    // steeper knee would move both corners and §10 test 16 measures them.
    constexpr double kButterworthQ = 0.70710678118654752;
    high_.setCoeffs(highpassCoeffs(lowHz_, kButterworthQ, sampleRate_));
    low_.setCoeffs(lowpassCoeffs(highHz_, kButterworthQ, sampleRate_));
  }

  Biquad high_;
  Biquad low_;
  double sampleRate_ = 48000.0;
  double lowHz_ = 50.0;
  double highHz_ = 15000.0;
  bool enabled_ = false;
};

}  // namespace mw::dsp
