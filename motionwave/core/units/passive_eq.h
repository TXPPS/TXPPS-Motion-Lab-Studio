// Motion Wave — the Program EQ's passive equalising network.
//
// `dyn-01` §2 and §5. This is a *passive* LCR block sitting between the input
// transformer and a make-up amplifier that exists only to give back what the
// network loses. Everything a listener attributes to "the EQ" other than the
// tone shape itself is contributed by the amplifier and the transformers, which
// are in circuit at all times — including when every control here is at zero.
// That is the unit's single most-reported subjective property and it is why
// this file models the network and nothing else.
//
// **The rule that decides the whole design.** §3.3: model boost and cut as
// separate networks sharing one frequency selector, and let the combined
// response fall out; never compute a boost curve and a cut curve and add their
// decibels. A symmetric dB sum cancels, and the response people buy this unit
// for is the one where they do not.
//
// The legs do not cancel because they are not the same shape and not at the
// same place. The low boost is a broad shelf at the selected frequency; the low
// cut acts about 3.5 octaves *above* it and is narrow. Running both gives a
// lifted shelf with a scoop above — the "low-end trick", which the original
// operating instructions advise against on the theory that the two would
// cancel. They do not, and §5 of the sheet records that they never did.
#pragma once

#include "../dsp/shelving.h"

namespace mw::units {

/// Positions on the LOW FREQUENCY selector, in hertz. `dyn-01` §3.1.
inline constexpr double kLowFrequencies[4] = {20.0, 30.0, 60.0, 100.0};
/// Positions on the HIGH FREQUENCY selector. §3.4.
inline constexpr double kHighFrequencies[7] = {3000.0, 4000.0, 5000.0, 8000.0,
                                               10000.0, 12000.0, 16000.0};
/// Positions on ATTEN SEL. §3.7 — independent of the HIGH FREQUENCY selector,
/// which is what allows a boost at 10 kHz and a shelf cut from 5 kHz at once.
inline constexpr double kAttenFrequencies[3] = {5000.0, 10000.0, 20000.0};

/// Published maxima, §8. The +18 dB low-boost figure that circulates comes from
/// a plug-in emulation's documentation rather than from the hardware manual, so
/// the sheet takes +13.5 and so does this.
inline constexpr double kLowBoostMaxDb = 13.5;
inline constexpr double kLowAttenMaxDb = -17.5;
inline constexpr double kHighBoostMaxDb = 18.0;
inline constexpr double kHighAttenMaxDb = -16.0;

/**
 * How far above the selector the low cut actually acts, in octaves.
 *
 * 3.5 is the centre of the published three-to-four-octave range and is **our
 * inference**, not a measurement — §3.3 marks it as such. It puts a 30 Hz
 * selector setting's dip at about 340 Hz and a 100 Hz setting's at about
 * 1.1 kHz, which brackets the published statement that a 30–100 Hz setting dips
 * somewhere between 500 Hz and 2 kHz.
 */
inline constexpr double kLowAttenOctavesAbove = 3.5;

/// Q of the low cut. Narrower than the boost shelf, which every source agrees
/// on and no source numbers; ours, and the sheet says to expect that.
inline constexpr double kLowAttenQ = 1.0;

/// BANDWIDTH endpoints. §3.6 finds no published numeric range and records the
/// one usable constraint: even at its sharpest the bell is broad by modern
/// standards. These keep SHARP well below a typical parametric's Q and are
/// flagged as our estimate until measured.
inline constexpr double kBandwidthBroadQ = 0.6;
inline constexpr double kBandwidthSharpQ = 2.0;

/// Where the controls are, in dial positions of 0…1.
struct PassiveEqSettings {
  int lowFreqIndex = 2;   ///< default 60 Hz, §3.1
  double lowBoost = 0.0;
  double lowAtten = 0.0;
  int highFreqIndex = 4;  ///< default 10 kHz, §3.4
  double highBoost = 0.0;
  double bandwidth = 0.0;  ///< 0 = BROAD, 1 = SHARP
  int attenSelIndex = 1;   ///< default 10 kHz, §3.7
  double highAtten = 0.0;
};

/**
 * The dial law.
 *
 * §3.2: the dial is marked 0 to 10 with no decibel legend and its law is not
 * linear in dB — a passive network driven by a potentiometer in the divider
 * position rises quickly in the lower half of travel and compresses toward the
 * top. No published measurement of the pot's dB-per-degree law was found, so
 * this is exposed as a shaping exponent rather than hard-coded, and the sheet
 * says QA should treat the midpoint as untested.
 */
inline double dialToFraction(double position, double shape) noexcept {
  const double p = position < 0.0 ? 0.0 : (position > 1.0 ? 1.0 : position);
  return std::pow(p, shape);
}

inline constexpr double kDialShape = 0.6;

/**
 * The network, per channel.
 *
 * Four sections, one per leg, cascaded. Cascading is not the dB sum the sheet
 * forbids: what it forbids is computing a symmetric boost and cut at the *same*
 * place and adding them, which cancels. These four are at different frequencies
 * with different shapes, so the combined response is the thing the hardware
 * does — and the low-end trick falls out rather than being special-cased.
 */
class PassiveEq {
 public:
  void prepare(double sampleRate) noexcept {
    sampleRate_ = sampleRate;
    reset();
    setSettings(settings_);
  }

  void reset() noexcept {
    for (int i = 0; i < 4; ++i) section_[i].reset();
  }

  void setSettings(const PassiveEqSettings& settings) noexcept {
    settings_ = settings;
    const double lowHz = kLowFrequencies[clampIndex(settings.lowFreqIndex, 4)];
    const double boost = dialToFraction(settings.lowBoost, kDialShape);
    const double atten = dialToFraction(settings.lowAtten, kDialShape);

    // §5: the boost potentiometer sits inside the divider that also damps the
    // LC section, so advancing it steepens the shelf *and* pulls the corner
    // down. A fixed-slope shelf cannot do this at any setting, which is why the
    // slope is a parameter of `lowShelfCoeffs` at all. The two coefficients
    // here are inference from the topology — no published curve family at
    // multiple boost settings was located.
    // At full boost the slope passes 1, which is a *resonant* shelf rather than
    // a monotone one — and that is the point, not an overshoot to be trimmed
    // away. A passive LC shelving network is under-damped, and the pot sitting
    // inside the divider is what damps it; a shelf that could not overshoot
    // would be modelling a network with a resistor where the hardware has an
    // inductor. It is also what makes the published maximum reachable at a
    // sensible frequency rather than at DC.
    const double slope = 0.55 + 0.85 * boost;
    // The corner sits *above* the selector's label, and pulls down as the pot
    // is advanced. §3.1 says the number on the panel is a nominal design centre
    // rather than a measured −3 dB point, and §9 test 3 says in as many words
    // that the frequency of maximum gain will not equal the label and that QA
    // should log the offset rather than fail on it — so the offset is a choice
    // this file has to make. Two-to-one is what makes the published +13.5 dB
    // reachable inside the audio band: with the corner *at* the label a 20 Hz
    // setting's plateau would be below 5 Hz, the boost would measure +8.9 dB
    // where the manual says +13.5, and the control would be quieter than the
    // hardware everywhere a listener can hear.
    const double corner = lowHz * (2.5 - 0.3 * boost);
    section_[0].setCoeffs(
        dsp::lowShelfCoeffs(corner, dsp::dbToGain(kLowBoostMaxDb * boost), slope, sampleRate_));

    // The cut leg, displaced upward. This is the entire mechanism of the
    // low-end trick: a cut that acted at the labelled frequency would be the
    // inverse of the boost and the two would cancel, which is exactly what the
    // original operating instructions assumed and exactly what does not happen.
    const double dipHz = lowHz * std::pow(2.0, kLowAttenOctavesAbove);
    section_[1].setCoeffs(dsp::peakingCoeffs(dipHz, dsp::dbToGain(kLowAttenMaxDb * atten),
                                             kLowAttenQ, sampleRate_));

    const double highHz = kHighFrequencies[clampIndex(settings.highFreqIndex, 7)];
    const double q = kBandwidthBroadQ +
                     (kBandwidthSharpQ - kBandwidthBroadQ) *
                         (settings.bandwidth < 0.0 ? 0.0
                                                   : (settings.bandwidth > 1.0 ? 1.0
                                                                               : settings.bandwidth));
    const double highBoost = dialToFraction(settings.highBoost, kDialShape);
    section_[2].setCoeffs(
        dsp::peakingCoeffs(highHz, dsp::dbToGain(kHighBoostMaxDb * highBoost), q, sampleRate_));

    // Its own selector, so a boost at 10 kHz and a shelf cut from 5 kHz coexist
    // — a documented technique rather than an accident, §3.8.
    const double attenHz = kAttenFrequencies[clampIndex(settings.attenSelIndex, 3)];
    const double highAtten = dialToFraction(settings.highAtten, kDialShape);
    section_[3].setCoeffs(dsp::highShelfCoeffs(
        attenHz, dsp::dbToGain(kHighAttenMaxDb * highAtten), 1.0, sampleRate_));
  }

  double process(double x) noexcept {
    double y = x;
    for (int i = 0; i < 4; ++i) y = section_[i].process(y);
    return y;
  }

  const PassiveEqSettings& settings() const noexcept { return settings_; }

 private:
  static int clampIndex(int index, int count) noexcept {
    return index < 0 ? 0 : (index >= count ? count - 1 : index);
  }

  dsp::Biquad section_[4];
  PassiveEqSettings settings_{};
  double sampleRate_ = 48000.0;
};

}  // namespace mw::units
