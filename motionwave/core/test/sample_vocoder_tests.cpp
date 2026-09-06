// Motion Wave — the phase vocoder's arithmetic. `smp-01` §4.4, §9 V-22, V-23.
//
// The other half of the spectral engine's tests. `sample_spectral_tests` holds
// V-20's null and the structural rows — the null is the one that says the STFT
// round-trip is COLA-correct, and until it passes nothing here means anything.
// This file is what the vocoder does once it is *not* an identity: a 4x
// stretch, a moving pitch, a transient, and the phase locking.
//
// ---------------------------------------------------------------------------
// MUTATIONS, AND THE CASE THAT CATCHES EACH
// ---------------------------------------------------------------------------
//
// §13 item 1 says a sign error or a misplaced normalisation in `princarg` or in
// the phase advance would be **silent**. That is a claim about which tests can
// see which faults, so it is answered by naming them. Every row below was
// confirmed by making the edit, running this suite and recording what turned
// red — never by reasoning about what ought to, and two of the five predictions
// made before running were wrong, which is the reason for the rule.
//
//   1. `princarg` sign flipped — `x + twoPi*floor(...)` for `x - twoPi*...`.
//      caught by: "princarg maps to [-pi, pi)", and by BOTH glide rows.
//      **Predicted V-22(a) would catch it; V-22(a) passes.** A 4x stretch of a
//      vibratoed note survives the flip because the deviation it wraps is small
//      enough at that hop to stay inside the principal range either way, so the
//      wrap never fires. What does exercise it is a glide, where the residue
//      pushes the deviation across the boundary every frame. The direct row on
//      `princarg` is therefore not redundant with the engine's rows: it is the
//      only one that fails on the flip for a reason anybody can read.
//
//   2. The rounded analysis hop used in `dPhiExpected` instead of the actual
//      fractional one (`setActualHopInExpectedAdvance(false)`, and as a
//      standing default the member `actualHopInExpected_ = false`).
//      caught by: "the fractional hop's compensation removes a sideband...",
//      whose own contrast collapses once the expectation is already wrong.
//      Measured: -48.75 dBFS rounded against -59.24 dBFS actual.
//
//   3. The fractional-hop phase ramp omitted (`compensateResidue_ = false`).
//      caught by: "the actual hop, not a rounded one, ..." — the sibling row,
//      for the mirrored reason. Each of the two rows measures its own contrast
//      explicitly, so it is the *other* row that goes red when a default is
//      mutated, and between them neither fault can be made to disappear.
//      Measured: -48.77 dBFS without against -59.24 dBFS with.
//
//   4. Phase locking applied to the wrong region.
//      caught by: all three V-22 rows — (a) 2.06 cents becomes a failure,
//      (b) 0.997 correlation collapses, and (c) reports locking 31.8 dB WORSE
//      than off instead of 14.5 dB better.
//      **The first mutation tried here was rounding the region midpoint down
//      instead of up, and nothing caught it** — the boundary bin between two
//      peaks is where the magnitude is smallest and one bin of it changes
//      nothing measurable. That is a real limit on what these rows can see and
//      it is written down rather than papered over; the mutation that does
//      speak for the rule is assigning a region to its neighbouring peak.
//
//   5. The overlap-add re-normalisation dropped on a reset frame — dividing by
//      the constant `colaGain_` rather than by the window sum laid down.
//      caught by: "a reset frame carries its own overlap-add normalisation".
//      Measured: the stretched peak goes from 0.26 to 2.80 against a source
//      peak of 0.70 — four times over, not a notch. **The row that predicted a
//      notch passed under this mutation**; see the row itself for why, and for
//      why the check had to become an absolute level rather than a ratio.
#include "../dsp/sample/spectral_read.h"
#include "harness.h"
#include "sample_harness.h"
#include "spectral_harness.h"
#include "spectrum.h"

#include <cmath>
#include <cstddef>
#include <vector>

using namespace mw::test::spectral;
using mw::dsp::sample::PhaseLock;
using mw::dsp::sample::princarg;
using mw::dsp::sample::Quality;
using mw::dsp::sample::SpectralControls;

namespace {

constexpr double kRate = 48000.0;

SpectralControls stretchControls(PhaseLock lock, bool transients) {
  SpectralControls c;
  c.fftSize = 2048;
  c.phaseLock = lock;
  c.transientsEnabled = transients;
  c.transientSensitivity = 60.0;
  c.blurPercent = 0.0;
  return c;
}

/// A 4x stretch: `rho = 0.25` at `p = 1`, so `alpha = p/rho = 4`.
std::vector<float> stretch4x(const std::vector<float>& zone, int frames, PhaseLock lock,
                             bool transients, Quality tier) {
  SpectralRead head;
  head.prepare(plainSource(zone, kRate), &sharedSinc(), tier, kRate,
               stretchControls(lock, transients), nullptr, 3u);
  const std::vector<float> pitch(static_cast<std::size_t>(frames), 0.0f);
  const std::vector<float> speed(static_cast<std::size_t>(frames), 0.25f);
  return renderSpectral(head, frames, pitch, speed, 256);
}

}  // namespace

// -------------------------------------------------- the arithmetic itself

MW_TEST("princarg maps to [-pi, pi) and is exact on the values a wrap depends on") {
  MW_EXPECT_NEAR(princarg(0.0), 0.0, 1.0e-15);
  MW_EXPECT_NEAR(princarg(0.5), 0.5, 1.0e-15);
  MW_EXPECT_NEAR(princarg(-0.5), -0.5, 1.0e-15);
  // The two cases `std::fmod` gets wrong: `fmod` keeps its left operand's
  // sign, so a negative deviation would come back a whole turn out.
  MW_EXPECT_NEAR(princarg(-0.5 - 2.0 * kPi), -0.5, 1.0e-14);
  MW_EXPECT_NEAR(princarg(0.5 + 2.0 * kPi), 0.5, 1.0e-14);
  MW_EXPECT_NEAR(princarg(0.5 + 20.0 * kPi), 0.5, 1.0e-13);
  MW_EXPECT_NEAR(princarg(-0.5 - 20.0 * kPi), -0.5, 1.0e-13);
  // The half-open end: -pi maps to itself, +pi wraps to -pi. A closed range at
  // both ends would put two representations of the same deviation into the
  // estimator and the choice between them would depend on rounding.
  MW_EXPECT_NEAR(princarg(-kPi), -kPi, 1.0e-14);
  MW_EXPECT_NEAR(princarg(kPi), -kPi, 1.0e-14);
}

// ---------------------------------------------------------------- V-22

MW_TEST("V-22(a): a 4x stretch holds f0 to within 3 cents") {
  const double f0 = 220.0;
  const int sourceFrames = 24000;
  const std::vector<float> zone = bowedNote(f0, kRate, static_cast<std::size_t>(sourceFrames));
  // Four times the source's length, less the pipeline's own fill.
  const int frames = sourceFrames * 4 - 8192;
  const std::vector<float> out = stretch4x(zone, frames, PhaseLock::Identity, false,
                                           Quality::High);

  // Measured over the sustain, past the bowed attack: the attack's own
  // amplitude ramp biases a zero-crossing count, and the sheet's stimulus is a
  // *sustained* note.
  const std::size_t from = 40000;
  std::vector<float> sustain(out.begin() + static_cast<long>(from), out.end());
  const double hz = mw::test::sample::measureHz(sustain, kRate, 0);
  const double cents = mw::test::sample::centsBetween(hz, f0);
  std::printf("    V-22(a) f0 = %.4f Hz against %.1f, %+0.3f cents\n", hz, f0, cents);
  MW_EXPECT(std::fabs(cents) <= 3.0);
}

MW_TEST("V-22(b): a 4x stretch preserves the 1/3-octave envelope to r >= 0.98") {
  const double f0 = 220.0;
  const int sourceFrames = 32768;
  const std::vector<float> zone = bowedNote(f0, kRate, static_cast<std::size_t>(sourceFrames));
  const int frames = sourceFrames * 4 - 8192;
  const std::vector<float> out = stretch4x(zone, frames, PhaseLock::Identity, false,
                                           Quality::High);

  const std::size_t length = 16384;
  const std::vector<double> srcMag = magSpectrum(zone, 8192, length);
  const std::vector<double> outMag = magSpectrum(out, 40000, length);
  const std::vector<double> a = thirdOctaveBands(srcMag, kRate, length, 100.0, 8000.0);
  const std::vector<double> b = thirdOctaveBands(outMag, kRate, length, 100.0, 8000.0);
  MW_EXPECT(a.size() >= 12);
  const double r = correlationOf(a, b);
  std::printf("    V-22(b) %zu bands, envelope correlation = %.5f\n", a.size(), r);
  MW_EXPECT(r >= 0.98);
}

MW_TEST("V-22(c): identity locking reduces inter-partial phase dispersion by at least 6 dB") {
  // A **steady** note, and 240 Hz rather than the 220 the other two rows use.
  // Both choices are the instrument's, not the engine's: the dispersion is
  // read from the output's self-similarity one fundamental period later, so
  // the period must be an integer number of samples (48000/240 = 200 exactly,
  // where 48000/220 is 218.18 and the lag's rounding would be the measurement)
  // and the pitch must not be moving, or the signal is legitimately not
  // periodic and the instrument has nothing to measure. The vibrato is what
  // (a) and (b) need and what (c) cannot have; `spectral_harness.h` records the
  // three instruments that tried to measure this with the vibrato in.
  const double f0 = 240.0;
  const int sourceFrames = 32768;
  const std::vector<float> zone =
      bowedNoteVibrato(f0, kRate, static_cast<std::size_t>(sourceFrames), 0.0);
  const int frames = sourceFrames * 4 - 8192;

  // The instrument's own floor, asserted rather than assumed: a perfectly
  // periodic source must read exactly 1, and if it does not then nothing the
  // row goes on to print about the engine means anything.
  const double sourceRho = periodicityRho(zone, kRate, f0, 16384, 30000);
  std::printf("    V-22(c) source periodicity = %.6f\n", sourceRho);
  MW_EXPECT(sourceRho > 0.99999);

  const std::vector<float> locked = stretch4x(zone, frames, PhaseLock::Identity, false,
                                              Quality::High);
  const std::vector<float> loose = stretch4x(zone, frames, PhaseLock::Off, false, Quality::High);

  const std::size_t from = 40000;
  const auto to = static_cast<std::size_t>(frames);
  const double dbLocked = phaseDispersionDb(locked, kRate, f0, from, to);
  const double dbLoose = phaseDispersionDb(loose, kRate, f0, from, to);
  std::printf("    V-22(c) dispersion: locked %.3f dB, off %.3f dB, reduction %.3f dB\n",
              dbLocked, dbLoose, dbLoose - dbLocked);
  // Neither render may beat the source, which no engine can do and which every
  // one of the three rejected instruments reported at least once.
  MW_EXPECT(periodicityRho(locked, kRate, f0, from, to) <= sourceRho);
  MW_EXPECT(periodicityRho(loose, kRate, f0, from, to) <= sourceRho);
  // `EXCEEDS_BY` rather than a bare subtraction: two identical dispersions
  // would satisfy "at least 6 dB better" if either were computed as zero, and
  // a locking control that did nothing at all is exactly the case that
  // produces two identical numbers.
  MW_EXPECT_EXCEEDS_BY(dbLoose, dbLocked, 6.0, 1.0e-6);
}

// ---------------------------------------------------------------- V-23

MW_TEST("V-23: a 4x stretch of a snare hit keeps its rise time inside 1.5x") {
  const int sourceFrames = 16384;
  const std::size_t onset = 2048;
  const std::vector<float> zone = snareHit(kRate, static_cast<std::size_t>(sourceFrames), onset);

  const double unstretched = riseTimeSamples(zone, kRate, onset - 512, onset + 4096);

  const int frames = sourceFrames * 4 - 8192;
  const std::vector<float> out = stretch4x(zone, frames, PhaseLock::Identity, true,
                                           Quality::High);
  // The hit lands where the vocoder's own time base puts it: the source onset
  // stretched by alpha, less the pipeline fill the read head starts behind.
  double peak = 0.0;
  std::size_t peakAt = 0;
  for (std::size_t i = 0; i < out.size(); ++i) {
    const double v = std::fabs(static_cast<double>(out[i]));
    if (v > peak) {
      peak = v;
      peakAt = i;
    }
  }
  MW_EXPECT(peak > 0.05);
  const std::size_t searchFrom = peakAt > 6000 ? peakAt - 6000 : 0;
  const double stretched = riseTimeSamples(out, kRate, searchFrom, peakAt + 4096);

  std::printf("    V-23 rise: %.1f samples unstretched, %.1f stretched, ratio %.3f\n",
              unstretched, stretched, stretched / unstretched);
  MW_EXPECT(unstretched > 0.0);
  MW_EXPECT(stretched > 0.0);
  MW_EXPECT(stretched <= 1.5 * unstretched);
}

MW_TEST("a reset frame carries its own overlap-add normalisation, and the level says so") {
  const int sourceFrames = 16384;
  const std::size_t onset = 4096;
  const std::vector<float> zone = snareHit(kRate, static_cast<std::size_t>(sourceFrames), onset);
  const int frames = sourceFrames * 4 - 8192;
  const std::vector<float> out = stretch4x(zone, frames, PhaseLock::Identity, true,
                                           Quality::High);

  // **What the fault actually is, measured rather than assumed.** The sheet
  // describes a level *notch* on every transient, and the first version of this
  // row looked for one: it compared the RMS at the peak against the RMS after
  // it and required the attack to be the louder. That row passed with the
  // normalisation removed, because both windows scale together and a ratio
  // between them cannot see a gain error at all.
  //
  // Removing the divide and measuring showed the sign is the other way here,
  // and by a long way: the peak went from 0.26 to **2.80**, a factor of ten
  // over full scale. The reason is the transient hold — the frames around a
  // detected attack are packed at `H_a` rather than `H_s`, which at a 4x
  // stretch is four times as many windows overlapping, so the window sum there
  // is several times the COLA constant instead of a fraction of it. Dividing by
  // the constant then multiplies the attack rather than notching it.
  //
  // Either way the cause is the same — a frame off the COLA grid divided by the
  // constant its neighbours assume — and either way the check has to be against
  // an **absolute** level the source fixes, not a ratio inside the output.
  double srcPeak = 0.0;
  for (float v : zone) srcPeak = std::max(srcPeak, std::fabs(static_cast<double>(v)));
  double outPeak = 0.0;
  for (float v : out) outPeak = std::max(outPeak, std::fabs(static_cast<double>(v)));
  std::printf("    reset normalisation: source peak %.5f, stretched peak %.5f, ratio %.3f\n",
              srcPeak, outPeak, outPeak / srcPeak);
  MW_EXPECT(srcPeak > 0.1);
  // A stretch may not invent level. Anything approaching the source's own peak
  // is fine; a multiple of it is the ungrated overlap-add arriving.
  MW_EXPECT(outPeak <= 1.5 * srcPeak);
  // And it may not lose the attack either, which is the notch the sheet names
  // and is the direction this would fail in at a stretch below unity.
  MW_EXPECT(outPeak >= 0.4 * srcPeak);
}

// ------------------------------------------ the fractional analysis hop

MW_TEST("the fractional hop's compensation removes a sideband that appears only under a glide") {
  // A pure tone, glided slowly. The stimulus is chosen so the answer is
  // stated rather than searched for: one line at 1 kHz plus whatever the
  // glide legitimately puts near it, and every other component is the
  // artefact. A glide of a quarter semitone over the render keeps the tone
  // inside a band `spuriousFloorAgainst` can exclude as one line.
  const double toneHz = 1000.0;
  const int sourceFrames = 65536;
  const std::vector<float> zone =
      mw::test::sample::sineZone(toneHz, kRate, static_cast<std::size_t>(sourceFrames), 0.5);

  const int frames = 32768;
  std::vector<float> pitch(static_cast<std::size_t>(frames));
  const std::vector<float> speed(static_cast<std::size_t>(frames), 1.0f);
  // A continuous glide: `p` moves through the whole render, so `H_a = H_s/alpha`
  // sweeps continuously through the integers and the residue wanders. A fixed
  // fractional pitch would sit on one residue and the artefact would be a
  // fixed offset rather than a modulation.
  for (std::size_t i = 0; i < pitch.size(); ++i) {
    pitch[i] = static_cast<float>(0.25 * static_cast<double>(i) /
                                  static_cast<double>(pitch.size()));
  }

  auto measure = [&](bool compensate) {
    SpectralControls c = stretchControls(PhaseLock::Off, false);
    c.fftSize = 2048;
    SpectralRead head;
    head.prepare(plainSource(zone, kRate), &sharedSinc(), Quality::High, kRate, c, nullptr, 5u);
    head.setHopResidueCompensation(compensate);
    const std::vector<float> out = renderSpectral(head, frames, pitch, speed, 256);
    // The legitimate set is the glided tone's band. The measurement window
    // sits late in the render where the pitch has moved a known amount, so
    // the line is where `p` puts it.
    const std::size_t offset = 16384;
    const double at = 0.25 * static_cast<double>(offset + 8192) / static_cast<double>(frames);
    const std::vector<double> legitimate = {toneHz * std::pow(2.0, at / 12.0)};
    return mw::test::spuriousFloorAgainst(out, kRate, 16384, legitimate,
                                          static_cast<int>(offset));
  };

  const double withIt = measure(true);
  const double without = measure(false);
  std::printf("    glide spurious floor: with compensation %7.2f dBFS, without %7.2f dBFS\n",
              withIt, without);
  // Both must be real measurements — `spuriousFloorAgainst` returns +1.0 when
  // it refuses, and a refusal on either side would make the comparison
  // meaningless while still printing two numbers.
  MW_EXPECT(withIt < 0.0);
  MW_EXPECT(without < 0.0);
  // The mutation this row exists for: the compensation is load-bearing, and
  // the size of the gap is the measurement the brief asks to be reported.
  MW_EXPECT_EXCEEDS_BY(without, withIt, 6.0, 1.0e-6);
}

MW_TEST("the actual hop, not a rounded one, is what the expected advance is built from") {
  // The same glide, measured with the estimator told the rounded hop instead
  // of the fractional one. This is mutation 2 in the header, made available as
  // a switch so the row can measure it rather than assert about it — the two
  // faults it separates (a missing ramp, a rounded expectation) look identical
  // in a spectrum and are different edits.
  const double toneHz = 1000.0;
  const std::vector<float> zone = mw::test::sample::sineZone(toneHz, kRate, 65536, 0.5);
  const int frames = 32768;
  std::vector<float> pitch(static_cast<std::size_t>(frames));
  const std::vector<float> speed(static_cast<std::size_t>(frames), 1.0f);
  for (std::size_t i = 0; i < pitch.size(); ++i) {
    pitch[i] = static_cast<float>(0.25 * static_cast<double>(i) /
                                  static_cast<double>(pitch.size()));
  }

  auto measure = [&](bool actualHop) {
    SpectralControls c = stretchControls(PhaseLock::Off, false);
    SpectralRead head;
    head.prepare(plainSource(zone, kRate), &sharedSinc(), Quality::High, kRate, c, nullptr, 5u);
    head.setActualHopInExpectedAdvance(actualHop);
    const std::vector<float> out = renderSpectral(head, frames, pitch, speed, 256);
    const std::size_t offset = 16384;
    const double at = 0.25 * static_cast<double>(offset + 8192) / static_cast<double>(frames);
    const std::vector<double> legitimate = {toneHz * std::pow(2.0, at / 12.0)};
    return mw::test::spuriousFloorAgainst(out, kRate, 16384, legitimate,
                                          static_cast<int>(offset));
  };

  const double actual = measure(true);
  const double rounded = measure(false);
  std::printf("    expected-advance hop: actual %7.2f dBFS, rounded %7.2f dBFS\n", actual,
              rounded);
  MW_EXPECT(actual < 0.0);
  MW_EXPECT(rounded < 0.0);
  MW_EXPECT_EXCEEDS_BY(rounded, actual, 6.0, 1.0e-6);
}

// ------------------------------------------------------- controls exist

MW_TEST("blur is a character control and does something, and zero blur changes nothing") {
  const std::vector<float> zone = bowedNote(220.0, kRate, 16384);
  const int frames = 24000;
  auto render = [&](double blur) {
    SpectralControls c = stretchControls(PhaseLock::Identity, false);
    c.blurPercent = blur;
    SpectralRead head;
    head.prepare(plainSource(zone, kRate), &sharedSinc(), Quality::High, kRate, c, nullptr, 9u);
    const std::vector<float> pitch(static_cast<std::size_t>(frames), 0.0f);
    const std::vector<float> speed(static_cast<std::size_t>(frames), 0.5f);
    return renderSpectral(head, frames, pitch, speed, 256);
  };
  const std::vector<float> dry = render(0.0);
  const std::vector<float> wet = render(60.0);
  const std::vector<float> dryAgain = render(0.0);

  // Deterministic: §4.6 requires it, because MotionLab's offline-bounce parity
  // compares two renders of the same bars and a free-running generator makes
  // that comparison fail as what looks like a DSP bug.
  double worstSame = 0.0;
  for (std::size_t i = 0; i < dry.size(); ++i) {
    worstSame = std::max(worstSame, std::fabs(static_cast<double>(dry[i] - dryAgain[i])));
  }
  MW_EXPECT(worstSame == 0.0);

  double changed = 0.0;
  for (std::size_t i = 8192; i < dry.size(); ++i) {
    changed = std::max(changed, std::fabs(static_cast<double>(dry[i] - wet[i])));
  }
  std::printf("    blur: 0%% vs 60%% worst difference %.5f\n", changed);
  // A control that does nothing is a bug of the same class as a wrong number.
  MW_EXPECT(changed > 1.0e-3);
}

MW_TEST("blur at 60 %% is still deterministic across two renders of the same seed") {
  const std::vector<float> zone = bowedNote(220.0, kRate, 16384);
  const int frames = 16000;
  auto render = [&]() {
    SpectralControls c = stretchControls(PhaseLock::Identity, false);
    c.blurPercent = 60.0;
    SpectralRead head;
    head.prepare(plainSource(zone, kRate), &sharedSinc(), Quality::High, kRate, c, nullptr, 11u);
    const std::vector<float> pitch(static_cast<std::size_t>(frames), 0.0f);
    const std::vector<float> speed(static_cast<std::size_t>(frames), 0.5f);
    return renderSpectral(head, frames, pitch, speed, 256);
  };
  const std::vector<float> a = render();
  const std::vector<float> b = render();
  double worst = 0.0;
  for (std::size_t i = 0; i < a.size(); ++i) {
    worst = std::max(worst, std::fabs(static_cast<double>(a[i] - b[i])));
  }
  MW_EXPECT(worst == 0.0);
}

MW_TEST("transient sensitivity at zero never resets, and the control spans a real range") {
  const std::vector<float> zone = snareHit(kRate, 16384, 4096);
  const int frames = 40000;
  auto render = [&](double sensitivity) {
    SpectralControls c = stretchControls(PhaseLock::Identity, true);
    c.transientSensitivity = sensitivity;
    SpectralRead head;
    head.prepare(plainSource(zone, kRate), &sharedSinc(), Quality::High, kRate, c, nullptr, 13u);
    const std::vector<float> pitch(static_cast<std::size_t>(frames), 0.0f);
    const std::vector<float> speed(static_cast<std::size_t>(frames), 0.25f);
    return renderSpectral(head, frames, pitch, speed, 256);
  };
  const std::vector<float> off = render(0.0);
  const std::vector<float> on = render(100.0);
  double changed = 0.0;
  for (std::size_t i = 0; i < off.size(); ++i) {
    changed = std::max(changed, std::fabs(static_cast<double>(off[i] - on[i])));
  }
  std::printf("    transient sensitivity 0 vs 100: worst difference %.5f\n", changed);
  MW_EXPECT(changed > 1.0e-3);
}

MW_TEST_MAIN("sample-vocoder")
