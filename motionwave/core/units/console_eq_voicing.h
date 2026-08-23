// Motion Wave — what the two console lineages are made of.
//
// `dyn-05` §3, §4 and §7. Separated from the unit because it is a different
// kind of statement: the unit says how a sample gets from the input to the
// output, and this says which detents exist and what each lineage's amplifiers
// and transformers are. Keeping them together made one file that described two
// things, and the second thing is the one a reader comes here to check against
// the sheet.
#pragma once

#include "../dsp/nonlinear/magnetic_core.h"
#include "../dsp/nonlinear/triode_stage.h"

namespace mw::units::voicing {

namespace nl = dsp::nl;

// §3 and §4. Written out rather than computed: these are switch positions on a
// panel, not a series, and a formula that happened to fit them would be a
// claim about the hardware that nobody made.
inline constexpr int kBritishLowCount = 4;
inline constexpr int kBritishMidCount = 6;
inline constexpr int kHighPassCount = 5;
inline constexpr int kAmericanCount = 5;

inline constexpr double kBritishLowHz[kBritishLowCount] = {35.0, 60.0, 110.0, 220.0};
inline constexpr double kBritishMidHz[kBritishMidCount] = {360.0,  700.0,  1600.0,
                                                           3200.0, 4800.0, 7200.0};
/// Index 0 is out; the rest are §3.5's four corners.
inline constexpr double kHighPassHz[kHighPassCount] = {0.0, 50.0, 80.0, 160.0, 300.0};
/// §4.1. The ranges overlap on purpose — 400 Hz is the top of band 1 and the
/// bottom of band 2, 5 kHz the top of band 2 and the bottom of band 3 — which
/// is what makes §10 test 13's stacking measurement possible at all.
inline constexpr double kAmericanHz[3][kAmericanCount] = {
    {50.0, 100.0, 200.0, 300.0, 400.0},
    {400.0, 800.0, 1500.0, 3000.0, 5000.0},
    {5000.0, 7000.0, 10000.0, 12500.0, 15000.0}};

/// The British high shelf has no frequency control at all, §3.2.
inline constexpr double kBritishHighHz = 12000.0;

struct Voicing {
  nl::MagneticCore::Config input;
  nl::MagneticCore::Config output;
  /// The EQ inductors' own cores. Only the British lineage has any.
  nl::MagneticCore::Config eq;
  nl::TriodeStage::Config stageA;
  nl::TriodeStage::Config stageB;
};

/**
 * §7.1 — transformer-coupled discrete Class A.
 *
 * Nickel cores, which is a specific claim and not a general one: they have low
 * hysteresis distortion *and* reach saturation at high level, so the model
 * lowers the coercivity and the saturation flux together rather than trading
 * one against the other.
 *
 * Two Class A single-ended stages, second-harmonic-led and rising with level,
 * with the drive split between them — §7.1 says that split is why the harmonic
 * profile depends on where the gain is taken, so making one stage do all of it
 * would remove a behaviour the mic-gain switch is supposed to have.
 *
 * The EQ cores are smaller than the transformers', which is what lets them
 * reach their knee at a level the EQ section can actually deliver. §10 test 7
 * measures that; with a transformer-sized core there the row measures nothing.
 */
inline Voicing british() noexcept {
  Voicing v;
  // **These cores are an order of magnitude larger than the library's default,
  // and the default is what was wrong here.** The default is calibrated for a
  // deliberately coloured transformer — 1.5 % third harmonic at −12 dBFS and
  // 30 Hz, which is a spec sheet's worth of character. A console module's
  // transformers are sized for a line level they are not supposed to colour:
  // §9.1 publishes 0.07 % from 50 Hz to 10 kHz at +20 dBu *output*. Working
  // back through the flux normalisation, +20 dBu at 50 Hz is a flux of 0.48,
  // and 50 Hz is the binding corner because a core's flux goes as 1/f — the
  // 1 kHz and 10 kHz readings are twenty and two hundred times easier. Holding
  // a quadratic core under half the published figure there needs a saturation
  // flux near sixteen. With the library's default this path measured 49.9 % at
  // 50 Hz; at ten times it still measured 0.16 %.
  //
  // A core this large is not a large-sounding transformer, it is a correctly
  // sized one: the unit's own maximum output of +26 dBu is a flux of 1.6 at
  // 30 Hz, a tenth of the knee, which is why §9.1 states the clipping point as
  // an amplifier limit and not a transformer one.
  //
  // The nickel core's low hysteresis distortion survives the resize, because
  // that is the coercivity and it is separate.
  v.input.coercivity *= 0.45f;
  v.input.saturationFlux *= 18.0f;
  // §7.1 puts the output transformer at the highest level in the unit, so it is
  // the smaller of the two and reaches its knee first.
  v.output.saturationFlux *= 14.0f;
  // The EQ inductors are *small*, and they can be because the unit drives them
  // with the network's own current rather than with the through signal — see
  // `ConsoleEq::shape`. With the boost control at centre they carry nothing, so
  // their size is bounded only by §10 test 7's 6 dB rather than pulling against
  // §9.1's flat-EQ specification.
  v.eq.saturationFlux *= 2.0f;
  // Two Class A single-ended stages, second-harmonic-led and rising with level,
  // with the drive split between them — §7.1 says that split is why the
  // harmonic profile depends on where the gain is taken. Sized so the pair
  // meets §9.1's 0.07 % at 1 kHz rather than by eye: at the library's usual
  // drive they measured 0.44 %.
  v.stageA.drive = 0.014f;
  v.stageA.bias = 0.0052f;
  v.stageB.drive = 0.011f;
  v.stageB.bias = 0.0044f;
  return v;
}

/**
 * §7.2 — discrete op-amp modules into a 1:3 step-up.
 *
 * The step-up is the point. It asks the transformer to swing three times the
 * op-amp's voltage, which is why it is the dominant nonlinearity at high level
 * and why §10 test 18 expects its third harmonic to lead — a saturation flux
 * well under the British output stage's is how a 1:3 ratio shows up in a model
 * that works in normalised units.
 *
 * The gain block is left near-symmetric on purpose. §7.2 marks its harmonic
 * order **unknown**, so giving it a second-harmonic signature would be
 * inventing a measurement; what is published is only that its distortion is low
 * at nominal level and rises steeply near the rails.
 *
 * There is no `eq` core here and that is §7.2's third point: no inductors,
 * therefore no core saturation in the EQ itself, and §10 test 17 asserts its
 * absence. A model that gave this device the British one's low-frequency EQ
 * saturation would be wrong in exactly the way the sheet predicts.
 */
inline Voicing american() noexcept {
  Voicing v;
  // A third of the British output stage's, so the step-up is unambiguously the
  // dominant nonlinearity at high level — which is what §7.2 says it is and
  // where it says the punch comes from. No THD figure is published for this
  // lineage at all (§9.2 marks it **unknown** and calls a measured curve the
  // highest-value outstanding research item), so its size is set by the
  // relationship the sheet does state rather than by a number it does not.
  v.output.saturationFlux *= 3.0f;
  v.stageB.drive = 0.010f;
  v.stageB.bias = 0.0004f;
  return v;
}

}  // namespace mw::units::voicing
