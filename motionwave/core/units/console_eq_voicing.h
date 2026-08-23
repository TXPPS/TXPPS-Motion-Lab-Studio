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
  v.input.coercivity *= 0.45f;
  v.input.saturationFlux *= 0.85f;
  v.output.saturationFlux *= 0.70f;
  v.eq.saturationFlux *= 0.30f;
  v.stageA.drive = 0.14f;
  v.stageA.bias = 0.052f;
  v.stageB.drive = 0.11f;
  v.stageB.bias = 0.044f;
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
  v.output.saturationFlux *= 0.42f;
  v.stageB.drive = 0.10f;
  v.stageB.bias = 0.004f;
  return v;
}

}  // namespace mw::units::voicing
