// Motion Wave — Console EQ, what the panel is told. Ledger cells U20 and V27.
//
// The unit failed `V27` for the same reason the Program EQ did, and the fix is
// the same shape. Everything the face could draw was either a *level* — which
// every box has and which says nothing about this one — or a working Q and a
// bandwidth, which are functions of the control positions and sit perfectly
// still until a knob is turned. Real engine state, honestly published,
// satisfying `U20`; nothing on the panel moving with the music.
//
// What moves is the iron, and there are two pieces of it. The output
// transformer is in circuit on both lineages. The EQ section's inductor is in
// circuit on one, and that is the readout worth having: §7.2 is that the
// bridged-T panel has no inductors at all, so the same meter that breathes on
// one lineage reads exactly zero on the other. A meter that goes still when the
// lineage switch is thrown is showing the difference between the two units,
// which is more than a level could ever say and more than a decorative
// animation could fake.
//
// Three discriminators, because the field can be got wrong in three ways:
//
//  - wired to a level — caught by boosting the *same bell* at two centres and
//    probing each at its own, so the current through the inductor is the same
//    and only the flux differs. The first version of this case compared a low
//    shelf at 50 Hz against the same shelf at 1 kHz, where a shelf adds nothing
//    — the current differed as much as the flux did, and wiring the field to an
//    amplitude passed all six cases. The mutation is what said so;
//  - wired to the through signal instead of what the network added — caught by
//    a flat EQ reading zero while a boosted one does not;
//  - wired to any core rather than the EQ's — caught by the American lineage,
//    which has an output transformer and no inductor.
#include "../units/console_eq.h"
#include "harness.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kRate = 48000.0;
constexpr int kBlock = 256;

/// The level `dyn-05` §4.5 measures at, referred to the unit's headroom.
constexpr double kPlusTenDbm = 0.251;

/// One frame of what the face would draw, after rendering `seconds` of a tone.
ConsoleEqFrame renderTone(ConsoleEq& unit, double hz, double amplitude, double seconds) {
  const int blocks = static_cast<int>(seconds * kRate / kBlock);
  const double step = 2.0 * kPi * hz / kRate;
  std::vector<float> left(kBlock, 0.0f);
  std::vector<float> right(kBlock, 0.0f);
  std::vector<float> outLeft(kBlock, 0.0f);
  std::vector<float> outRight(kBlock, 0.0f);
  float* in[2] = {left.data(), right.data()};
  float* out[2] = {outLeft.data(), outRight.data()};
  AudioBuffer inBuffer(in, 2, kBlock);
  AudioBuffer outBuffer(out, 2, kBlock);

  long long n = 0;
  ConsoleEqFrame frame;
  for (int b = 0; b < blocks; ++b) {
    for (int i = 0; i < kBlock; ++i, ++n) {
      const float s = static_cast<float>(amplitude * std::sin(step * static_cast<double>(n)));
      left[static_cast<std::size_t>(i)] = s;
      right[static_cast<std::size_t>(i)] = s;
    }
    ProcessContext ctx;
    ctx.inputs = &inBuffer;
    ctx.inputCount = 1;
    ctx.outputs = &outBuffer;
    ctx.outputCount = 1;
    ctx.frames = kBlock;
    ctx.sampleRate = kRate;
    unit.process(ctx);
  }
  unit.visual().read(frame);
  return frame;
}

/// A British unit with the low band boosted, which is what puts current through
/// the inductor at all — the core sees what the network *added*, never the
/// signal passing through it.
void boostedBritish(ConsoleEq& unit) {
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  unit.setLineage(ConsoleEq::Lineage::British);
  unit.setEqIn(true);
  unit.setBritishLowFrequency(0);
  unit.setBritishLowAmount(12.0);
}

/// A British unit with the *mid* band boosted at a chosen centre. The bell is
/// the same shape wherever it sits, so probing each one at its own centre puts
/// the same amount of signal into the inductor at two frequencies an octave and
/// a half apart — which is the only way to ask whether the meter is reading
/// flux or amplitude.
void boostedMid(ConsoleEq& unit, int index) {
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  unit.setLineage(ConsoleEq::Lineage::British);
  unit.setEqIn(true);
  unit.setBritishMidFrequency(index);
  unit.setBritishMidAmount(12.0);
}

}  // namespace

MW_TEST("dyn-05 V27: the EQ inductor is driven when the network is in circuit") {
  ConsoleEq unit;
  boostedBritish(unit);
  const ConsoleEqFrame frame = renderTone(unit, 50.0, kPlusTenDbm, 0.5);
  std::printf("    V27: 50 Hz +12 dB low — input peak %.4f, eq core %.4f, output core %.4f\n",
              static_cast<double>(frame.inputPeak), static_cast<double>(frame.eqCoreDrive),
              static_cast<double>(frame.outputCoreDrive));
  MW_EXPECT(frame.eqCoreDrive > 0.005f);
  MW_EXPECT(frame.outputCoreDrive > 0.005f);
}


MW_TEST("dyn-05 V27: the same current at two frequencies does not read the same") {
  // The discriminator, and the second attempt at it.
  //
  // The first compared a low shelf probed at 50 Hz against the same shelf probed
  // at 1 kHz, and it could not fail: a shelf adds almost nothing at 1 kHz, so
  // the *current through the inductor* differed by as much as the flux did.
  // Wiring the field to `|added|` — a level — passed all six cases. The
  // mutation found that, which is what `CLAUDE.md`'s rule about corrected
  // probes is for, and the answer was to fix the case rather than to keep a
  // green column.
  //
  // A bell is the same shape wherever it is tuned. Boost the mid band 12 dB at
  // 360 Hz and probe at 360 Hz; boost it 12 dB at 1600 Hz and probe at 1600 Hz.
  // The network adds the same amplitude in both — the output peaks below say so
  // — and flux is the integral of the voltage, so the iron sees the lower one by
  // the frequency ratio. A meter fed any amplitude reads the two the same.
  ConsoleEq low;
  ConsoleEq high;
  boostedMid(low, 0);   // 360 Hz
  boostedMid(high, 2);  // 1600 Hz
  const ConsoleEqFrame atLow = renderTone(low, 360.0, kPlusTenDbm, 0.5);
  const ConsoleEqFrame atHigh = renderTone(high, 1600.0, kPlusTenDbm, 0.5);
  std::printf(
      "    V27: same bell, same drive — 360 Hz core %.5f at peak %.4f, "
      "1600 Hz core %.5f at peak %.4f, ratio %.2f x\n",
      static_cast<double>(atLow.eqCoreDrive), static_cast<double>(atLow.outputPeak),
      static_cast<double>(atHigh.eqCoreDrive), static_cast<double>(atHigh.outputPeak),
      static_cast<double>(atLow.eqCoreDrive) /
          (static_cast<double>(atHigh.eqCoreDrive) + 1.0e-12));
  // The two really are carrying the same signal, so a reading that differs is
  // reading something other than how much signal there is.
  MW_EXPECT_NEAR(static_cast<double>(atLow.outputPeak), static_cast<double>(atHigh.outputPeak),
                 0.05);
  // 1600/360 is 4.4; asking for 2.5 leaves room for the bell's own width and
  // for the core's magnetising pole without leaving room for an amplitude.
  MW_EXPECT(atLow.eqCoreDrive > atHigh.eqCoreDrive * 2.5f);
}

MW_TEST("dyn-05 V27: the American lineage has no inductor to drive") {
  // The discriminator no level and no timer could produce, and the one that
  // makes this readout worth putting on the panel rather than another meter.
  // §7.2: two op-amp modules and a 1:3 output transformer, and no inductors.
  // §10 test 17 asserts that absence in the audio; this asserts the panel says
  // so, which is the same fact arriving where a user can see it.
  ConsoleEq unit;
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  unit.setLineage(ConsoleEq::Lineage::American);
  unit.setEqIn(true);
  unit.setAmericanFrequency(0, 0);
  unit.setAmericanAmount(0, 12.0);
  const ConsoleEqFrame frame = renderTone(unit, 50.0, kPlusTenDbm, 0.5);
  std::printf("    V27: American — eq core %.6f, output core %.5f\n",
              static_cast<double>(frame.eqCoreDrive), static_cast<double>(frame.outputCoreDrive));
  // Exactly zero, not small: there is no object in that path to hold flux, so a
  // non-zero reading here would mean the field is fed from somewhere it should
  // not be — the through signal, or the wrong core.
  MW_EXPECT(frame.eqCoreDrive == 0.0f);
  // And the output transformer still works, so the panel is not simply dead.
  MW_EXPECT(frame.outputCoreDrive > 0.005f);
}

MW_TEST("dyn-05 V27: a flat EQ drives no inductor, because the network is out") {
  // The second way to get this wrong: driving the core with the signal passing
  // through rather than with what the network added. That makes the EQ section
  // a distortion source at every setting including flat, and it is the error
  // the note in `shape()` records at four times the specified flux.
  ConsoleEq unit;
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  unit.setLineage(ConsoleEq::Lineage::British);
  unit.setEqIn(true);
  const ConsoleEqFrame flat = renderTone(unit, 50.0, kPlusTenDbm, 0.5);
  ConsoleEq boosted;
  boostedBritish(boosted);
  const ConsoleEqFrame lifted = renderTone(boosted, 50.0, kPlusTenDbm, 0.5);
  std::printf("    V27: flat eq core %.6f, boosted %.5f\n", static_cast<double>(flat.eqCoreDrive),
              static_cast<double>(lifted.eqCoreDrive));
  MW_EXPECT(lifted.eqCoreDrive > flat.eqCoreDrive * 8.0f);
}

MW_TEST("dyn-05 V27: the readout falls when the signal stops") {
  // V27's own discriminator at the level the frame is published, rather than at
  // the level the face draws it. A field that holds its last driven value is a
  // face animating on a timer, one layer down, and it is the one a face cannot
  // correct for.
  ConsoleEq unit;
  boostedBritish(unit);
  const ConsoleEqFrame driven = renderTone(unit, 50.0, kPlusTenDbm, 0.5);
  const ConsoleEqFrame quiet = renderTone(unit, 50.0, 0.0, 0.5);
  std::printf("    V27: driven %.5f, after half a second of silence %.7f\n",
              static_cast<double>(driven.eqCoreDrive), static_cast<double>(quiet.eqCoreDrive));
  MW_EXPECT(driven.eqCoreDrive > 0.005f);
  // Small rather than exactly zero: the core's flux decays through its own
  // magnetising pole, and a hard zero would be the model being reset behind the
  // audio's back.
  MW_EXPECT(quiet.eqCoreDrive < driven.eqCoreDrive * 0.05f);
}

MW_TEST("dyn-05 U20: the working Q is the unit's own, and is not motion") {
  // Kept honest in both directions, as `dyn-01`'s harmonic display is. The Q
  // and the bandwidths are real engine state and belong on the panel; they are
  // functions of the controls, so they cannot be what satisfies V27, and saying
  // so here stops somebody reading the rows above and concluding that the curve
  // readout now animates.
  ConsoleEq unit;
  boostedBritish(unit);
  const ConsoleEqFrame quiet = renderTone(unit, 1000.0, kPlusTenDbm * 0.05, 0.25);
  const ConsoleEqFrame loud = renderTone(unit, 1000.0, kPlusTenDbm, 0.25);
  std::printf("    U20: mid Q %.6f quiet, %.6f loud\n", static_cast<double>(quiet.midQ),
              static_cast<double>(loud.midQ));
  MW_EXPECT(quiet.midQ != 0.0f);
  MW_EXPECT(quiet.midQ == loud.midQ);
}

MW_TEST_MAIN("console-eq-visual")
