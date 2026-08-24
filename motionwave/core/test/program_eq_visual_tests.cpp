// Motion Wave — Program EQ, what the panel is told. Ledger cells U20 and V27.
//
// `U20` is that a readout carries real engine state. `V27` adds that something
// on the panel *moves* with the music and stops when the music does — and the
// two are not the same cell, which is what this file exists to hold apart.
//
// The unit failed `V27` for a reason worth recording. Its most mechanism-
// revealing readout, the harmonic display, is fed from `TriodeStage::curvature`
// — and that is `nl::curvature(config_.bias)`, a function of the *configuration*
// only. It is real engine state and it satisfies `U20` honestly; it simply does
// not change until a knob does, so nothing on the panel moved with the signal.
//
// The two transformer readouts looked like they moved, and did, because they
// were assigned the input and output *peaks*. That is a second opinion of the
// kind CLAUDE.md rules out — "a picture is drawn from the same evaluation the
// audio uses" — and a specific one: a transformer follows flux, flux is the
// integral of the voltage, so the same level at 30 Hz and at 1 kHz drives the
// core by amounts that differ by more than an order of magnitude. A meter fed
// the peak reads the same for both, and the one thing that meter is named after
// — `dyn-01` §7's low-frequency thickening — is precisely the thing it could
// not show.
//
// So the cases below are built around that discriminator. Test 2 is the one
// that fails if the field is ever wired back to a level: two tones at *equal
// amplitude*, an octave-and-a-half decade apart, must produce readings that are
// not close. A peak-fed meter passes every other case in this file.
#include "../units/program_eq.h"
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

/// +10 dBm referred to the unit's headroom, the level `dyn-01` §4.5 measures at.
constexpr double kPlusTenDbm = 0.251;

/// One frame of what the face would draw, after rendering `seconds` of a tone.
ProgramEqFrame renderTone(ProgramEq& unit, double hz, double amplitude, double seconds) {
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
  ProgramEqFrame frame;
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

/// The same, with silence in, so a readout that holds its last value shows up.
ProgramEqFrame renderSilence(ProgramEq& unit, double seconds) {
  return renderTone(unit, 1000.0, 0.0, seconds);
}

}  // namespace

MW_TEST("dyn-01 V27: the transformer readout is the core's flux, not the level") {
  ProgramEq unit;
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  const ProgramEqFrame low = renderTone(unit, 30.0, kPlusTenDbm, 0.5);
  std::printf("    V27: 30 Hz at +10 dBm — input peak %.4f, core drive %.4f\n", static_cast<double>(low.inputPeak),
              static_cast<double>(low.inputCoreDrive));
  // Driven, and not by a coincidence: the core is in circuit and 30 Hz is where
  // §7 says the iron works.
  MW_EXPECT(low.inputCoreDrive > 0.05f);
}

MW_TEST("dyn-01 V27: equal levels at two frequencies do not read the same") {
  // The discriminator. Wire either transformer field back to a level and this
  // is the case that fails; nothing else in this file would.
  ProgramEq low;
  ProgramEq high;
  low.prepare(kRate, kBlock);
  high.prepare(kRate, kBlock);
  low.setNoise(0.0);
  high.setNoise(0.0);
  const ProgramEqFrame atThirty = renderTone(low, 30.0, kPlusTenDbm, 0.5);
  const ProgramEqFrame atKilo = renderTone(high, 1000.0, kPlusTenDbm, 0.5);
  std::printf("    V27: same amplitude — 30 Hz core %.4f, 1 kHz core %.4f, ratio %.1f x\n",
              static_cast<double>(atThirty.inputCoreDrive),
              static_cast<double>(atKilo.inputCoreDrive),
              static_cast<double>(atThirty.inputCoreDrive) /
                  (static_cast<double>(atKilo.inputCoreDrive) + 1.0e-12));
  // The peaks really are equal, so the two readings have no excuse to differ
  // unless they are reading something other than the level.
  MW_EXPECT_NEAR(static_cast<double>(atThirty.inputPeak), static_cast<double>(atKilo.inputPeak),
                 0.02);
  // Flux is the integral of the voltage: a decade and a half down in frequency
  // is a decade and a half up in flux for the same amplitude. Ten times is a
  // long way inside that and a long way outside anything a level could produce.
  MW_EXPECT(atThirty.inputCoreDrive > atKilo.inputCoreDrive * 10.0f);
}

MW_TEST("dyn-01 V27: the readout falls when the signal stops") {
  // V27's own discriminator, at the level the frame is published rather than
  // the level the face draws. A face animating on a timer is indistinguishable
  // from one reading the engine right up until the engine stops; a *field* that
  // holds its last driven value is the same failure one layer down, and it is
  // the one a face cannot correct for.
  ProgramEq unit;
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  const ProgramEqFrame driven = renderTone(unit, 30.0, kPlusTenDbm, 0.5);
  const ProgramEqFrame quiet = renderSilence(unit, 0.5);
  std::printf("    V27: driven %.4f, after half a second of silence %.6f\n", static_cast<double>(driven.inputCoreDrive),
              static_cast<double>(quiet.inputCoreDrive));
  MW_EXPECT(driven.inputCoreDrive > 0.05f);
  // The core's flux decays through its own magnetising pole rather than being
  // cleared, so this is "small", not "exactly zero" — a hard zero here would be
  // the model being reset behind the audio's back.
  MW_EXPECT(quiet.inputCoreDrive < driven.inputCoreDrive * 0.05f);
}

MW_TEST("dyn-01 V27: a bypassed unit reports iron that is doing nothing") {
  ProgramEq unit;
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  const ProgramEqFrame driven = renderTone(unit, 30.0, kPlusTenDbm, 0.5);
  MW_EXPECT(driven.inputCoreDrive > 0.05f);
  unit.setBypass(true);
  const ProgramEqFrame bypassed = renderTone(unit, 30.0, kPlusTenDbm, 0.25);
  std::printf("    V27: bypassed — level %.4f still read, core drive %.6f\n", static_cast<double>(bypassed.inputPeak),
              static_cast<double>(bypassed.inputCoreDrive));
  // The levels carry on, because signal really is passing. The transformers are
  // out of circuit, so they are not being driven by it — and X24 records that
  // publishing a stale value through bypass is the exact defect four of five
  // units shipped.
  MW_EXPECT(bypassed.inputPeak > 0.2f);
  MW_EXPECT(bypassed.inputCoreDrive == 0.0f);
}

MW_TEST("dyn-01 U20: the harmonic profile is the amplifier's own, and is not motion") {
  // Kept honest in both directions. `c2` and `c3` are real engine state and
  // belong on the panel — but they are a function of the bias, so they do not
  // move with the signal and cannot be what satisfies V27. Asserting that here
  // stops someone reading the V27 rows above and concluding the harmonic
  // display now animates.
  ProgramEq unit;
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  const ProgramEqFrame quiet = renderTone(unit, 1000.0, kPlusTenDbm * 0.05, 0.25);
  const ProgramEqFrame loud = renderTone(unit, 1000.0, kPlusTenDbm, 0.25);
  std::printf("    U20: c2 %.6f quiet, %.6f loud; c3 %.6f / %.6f\n", static_cast<double>(quiet.c2),
              static_cast<double>(loud.c2), static_cast<double>(quiet.c3),
              static_cast<double>(loud.c3));
  MW_EXPECT(quiet.c2 != 0.0f);
  MW_EXPECT(quiet.c2 == loud.c2);
  MW_EXPECT(quiet.c3 == loud.c3);
}

MW_TEST_MAIN("program-eq-visual")
