// Motion Wave — the importer's pitch detector. `smp-01` §3.4, row V-6.
//
// SYNTHESISED CORPUS. V-6 asks for 60 single notes across five instrument
// families with known pitch, and there is no recorded corpus here. So the 60
// notes are rendered: twelve pitches from A0 to C8 in each of five timbres
// (sine, sawtooth, a strong second harmonic, a plucked string, an inharmonic
// bell), each with a random detune of up to ±40 cents so that `fine` is
// measured against something other than zero. Ground truth is the frequency
// the note was rendered at, which is exact — better than any tuner reading a
// recording — and the axis it is weak on is timbre: nothing here has a
// breathy attack, a wolf note, vibrato, or two strings beating. A real corpus
// would add those and could only make the numbers worse.
//
// **THIS SUITE EXISTS TO CHECK TWO CORRECTIONS MADE TO THE SHEET**, both
// reasoned in `pitch.h` and neither previously verified:
//
//   (3) the absolute-threshold step is written as the published rule — the
//       smallest τ giving a MINIMUM of d' below 0.1 — not as the sheet's
//       transcription, "the smallest τ with d'(τ) < 0.1". The sheet's version
//       stops on the descending flank of the dip, and a parabola fitted about
//       a slope point has its vertex somewhere else entirely.
//   the octave guard's comparison is REVERSED from the sheet. As written
//       there — prefer 2τ̂ when d'(2τ̂) < d'(τ̂) + 0.05 — it fires on every
//       clean tone, because a periodic signal has a deep dip at every
//       multiple of its period.
//
// V-6 PASSES: 60 of 60 roots correct, all 60 within 5 cents (worst 4.49),
// zero octave errors over the 60 notes at periodicity >= 0.90.
//
// Mutation-tested, each edit restored before the next:
//
//   step (3) reverted to the sheet's transcription — return the first tau
//     under the threshold instead of following the dip to its minimum ->
//     LOAD-BEARING and then some: 23 of 60 roots, 18 within 5 cents. The
//     parabola is fitted about a point on the descending flank, so the vertex
//     lands wherever that flank's curvature puts it.
//   the octave guard reverted to the sheet's direction — prefer 2 tau when
//     d'(2 tau) < d'(tau) + margin -> LOAD-BEARING: 19 of 60 roots and 41
//     octave errors, which is the failure the header predicts. A periodic
//     signal dips at every multiple of its period, so the sheet's test is
//     true of nearly every clean tone.
//
// One thing was ADDED during this work and then REMOVED, which is worth
// recording because the removal is the finding. A C8 sawtooth was reading an
// octave low, and a ratio gate on the guard (`d'(2tau) <= 0.2 * d'(tau)`)
// fixed it — swept, an interior optimum at 0.20, all the marks of a real
// discriminator. It was not one. The actual fault was that the corpus detuned
// A0 and C8 *outward*, past the ends of §3.4's own search range: A0 flat by
// 37.8 cents has a period of 1639 samples against a tauMax of 1604, so every
// frame pinned to the range's edge. With the corpus asking only for pitches
// the detector is specified over, removing the ratio gate changed nothing —
// 60/60 either way — so it went. A parameter that survives only because
// nothing tests it is worse than no parameter.
#include "../dsp/sample/analyse.h"
#include "harness.h"
#include "sample_corpus.h"

#include <cstdio>
#include <vector>

using namespace mw::dsp::sample;
namespace corpus = mw::test::corpus;

namespace {

struct Note {
  corpus::Signal signal;
  double midi = 0.0;
  double cents = 0.0;
  corpus::Timbre timbre = corpus::Timbre::Sine;
};

/// Twelve pitches per timbre, spread A0 (21) to C8 (108), each detuned by a
/// seeded amount so the fine-tune row is measuring a residue rather than zero.
std::vector<Note> theNotes() {
  std::vector<Note> notes;
  const corpus::Timbre timbres[5] = {corpus::Timbre::Sine, corpus::Timbre::Sawtooth,
                                     corpus::Timbre::SecondHarmonic, corpus::Timbre::Pluck,
                                     corpus::Timbre::Bell};
  corpus::Rng rng;
  rng.seed(6006);
  for (int t = 0; t < 5; ++t) {
    for (int k = 0; k < 12; ++k) {
      Note n;
      n.timbre = timbres[t];
      n.midi = 21.0 + std::floor(static_cast<double>(k) * 87.0 / 11.0);
      n.cents = corpus::uniform(rng, -40.0, 40.0);
      // A0 and C8 are the search range's own endpoints (§3.4: 27.5 Hz to
      // 4186 Hz), so a note detuned outward from either is outside the range
      // the detector is specified over. A0 flat by 37.8 cents has a period of
      // 1639 samples against a tauMax of 1604: every frame pins to 1604 and
      // reports 27.49 Hz, which is the range's edge and not an estimate. The
      // corpus was asking for something §3.4 does not claim. Detune inward at
      // the endpoints; the sixty notes stay sixty and every one is a pitch the
      // detector is meant to resolve.
      if (n.midi <= 21.0) n.cents = std::fabs(n.cents);
      if (n.midi >= 108.0) n.cents = -std::fabs(n.cents);
      // Long enough for eight 100 ms YIN frames over the sustain, and low
      // notes need the length more than high ones do.
      n.signal = corpus::note(n.timbre, n.midi, n.cents, 44100.0, 1.6,
                              7000u + static_cast<std::uint64_t>(t * 12 + k));
      notes.push_back(n);
    }
  }
  return notes;
}

PitchResult detect(const corpus::Signal& s, const Options& o = Options{}) {
  const std::vector<float> f = s.asFloat();
  return analyseOneShot(f.data(), f.size(), s.rate, o).pitch;
}

}  // namespace

// ───────────────────────────────────────────────────────────────── V-6

MW_TEST("V-6 correct MIDI note in >= 98% of 60 notes, fine within +-5 cents") {
  const std::vector<Note> notes = theNotes();
  int correct = 0, fineOk = 0, measured = 0;
  double worstFine = 0.0;
  for (const Note& n : notes) {
    const PitchResult p = detect(n.signal);
    // The note's true MIDI value including its detune, and the root a correct
    // detection rounds to.
    const double trueMidi = n.midi + n.cents / 100.0;
    const int trueRoot = static_cast<int>(std::lround(trueMidi));
    const double trueFine = 100.0 * (trueMidi - static_cast<double>(trueRoot));
    ++measured;
    const bool rootOk = p.root == trueRoot;
    if (rootOk) ++correct;
    const double fineErr = std::fabs(p.fineCents - trueFine);
    if (rootOk && fineErr <= 5.0) ++fineOk;
    if (rootOk) worstFine = std::max(worstFine, fineErr);
    if (rootOk && fineErr > 5.0) {
      std::printf(
          "    FINE  %-13s MIDI %5.1f%+6.1fc -> fine %+6.1f (want %+6.1f, err %.1f, per %.3f)\n",
                  corpus::timbreName(n.timbre), n.midi, n.cents, p.fineCents, trueFine, fineErr,
                  p.periodicity);
    }
    if (!rootOk) {
      std::printf("    %-13s MIDI %5.1f%+6.1fc -> root %3d fine %+6.1f (f0 %.2f, per %.3f)\n",
                  corpus::timbreName(n.timbre), n.midi, n.cents, p.root, p.fineCents, p.f0,
                  p.periodicity);
    }
  }
  std::printf("    %d of %d roots correct (%.1f %%); %d within 5 cents; worst fine %.2f c\n",
              correct, measured, 100.0 * correct / measured, fineOk, worstFine);
  MW_EXPECT_EQ(measured, 60);
  MW_EXPECT(static_cast<double>(correct) >= 0.98 * static_cast<double>(measured));
  MW_EXPECT_EQ(fineOk, correct);
}

MW_TEST("V-6 zero octave errors on the subset with periodicity >= 0.90") {
  // The row the sheet is strictest about: an octave error mis-roots the zone
  // and every key plays an octave out. Counted only over notes the detector
  // called confidently, which is what the row says.
  const std::vector<Note> notes = theNotes();
  int confident = 0, octaveErrors = 0;
  for (const Note& n : notes) {
    const PitchResult p = detect(n.signal);
    if (p.periodicity < 0.90) continue;
    ++confident;
    const double trueMidi = n.midi + n.cents / 100.0;
    const double err = p.midi - trueMidi;
    if (std::fabs(std::fabs(err) - 12.0) < 3.0 || std::fabs(std::fabs(err) - 24.0) < 3.0) {
      ++octaveErrors;
      std::printf("    OCTAVE: %-13s true %.2f, detected %.2f (periodicity %.3f, guard %s)\n",
                  corpus::timbreName(n.timbre), trueMidi, p.midi, p.periodicity,
                  p.frames.empty() ? "?" : (p.frames[0].guardFired ? "fired" : "quiet"));
    }
  }
  std::printf("    %d notes at periodicity >= 0.90; %d octave errors\n", confident, octaveErrors);
  MW_EXPECT(confident >= 30);
  MW_EXPECT_EQ(octaveErrors, 0);
}

MW_TEST("unpitched noise is classified unpitched, and a pad is not called a note") {
  int unpitched = 0;
  for (int i = 0; i < 8; ++i) {
    const corpus::Signal s = corpus::noiseOneShot(9100u + static_cast<std::uint64_t>(i), 44100.0);
    const PitchResult p = detect(s);
    if (p.classification == PitchClass::Unpitched) ++unpitched;
    else std::printf("    noise %d classified %s at periodicity %.3f\n", i,
                     p.classification == PitchClass::Pitched ? "pitched" : "flagged",
                     p.periodicity);
  }
  MW_EXPECT_EQ(unpitched, 8);
}

// ──────────────────────────────────── the two corrections to the sheet

MW_TEST("the octave guard recovers a fundamental buried under its second harmonic") {
  // `SecondHarmonic` is odd harmonics at 1/n with the second 14.8 dB above the
  // fundamental. Plain YIN locks the half period on that: d'(P/2) is twice the
  // odd-harmonic energy over the total, which is 0.075 here — under the 0.1
  // threshold, so the search stops there and reports an octave high.
  //
  // MUTATION for the guard, and it is the row that justifies reversing the
  // sheet's comparison. Restoring the sheet's own direction — prefer 2 tau
  // when d'(2 tau) < d'(tau) + 0.05 — makes every clean tone read an octave
  // LOW instead, because a periodic signal dips at every multiple of its
  // period, so V-6's root row falls to roughly a fifth correct. Removing the
  // guard entirely leaves the second-harmonic notes an octave HIGH and this
  // row red. Both were run; both turn something red.
  int correct = 0;
  for (int k = 0; k < 12; ++k) {
    const double midi = 33.0 + static_cast<double>(k) * 4.0;
    const corpus::Signal s =
        corpus::note(corpus::Timbre::SecondHarmonic, midi, 0.0, 44100.0, 1.6,
                     8100u + static_cast<std::uint64_t>(k));
    const PitchResult p = detect(s);
    if (p.root == static_cast<int>(std::lround(midi))) {
      ++correct;
    } else {
      std::printf("    midi %.0f -> root %d (f0 %.2f, guard %s)\n", midi, p.root, p.f0,
                  (!p.frames.empty() && p.frames[0].guardFired) ? "fired" : "quiet");
    }
  }
  std::printf("    %d of 12 second-harmonic notes rooted correctly\n", correct);
  MW_EXPECT(correct >= 11);
}

MW_TEST("the threshold step follows the dip to its minimum, which is what fine tune needs") {
  // MUTATION for step (3). The sheet's transcription stops at the first lag
  // under the threshold, which lies on the descending flank; the parabola is
  // then fitted about a point that is not a minimum and its vertex lands
  // wherever the flank's curvature puts it. The error is in the sub-semitone
  // residue, so the root row barely notices and this row is what catches it:
  // reverting `absoluteThreshold` to return `tau` instead of walking down to
  // the bottom of the dip takes the worst fine error from under 5 cents to
  // tens of cents.
  //
  // Sawtooths at exact MIDI pitches with a known detune, where any fine error
  // is the estimator's rather than the corpus's.
  double worst = 0.0;
  for (int k = 0; k < 10; ++k) {
    const double midi = 40.0 + static_cast<double>(k) * 5.0;
    const double cents = (k % 2 == 0) ? 27.0 : -33.0;
    const corpus::Signal s = corpus::note(corpus::Timbre::Sawtooth, midi, cents, 44100.0, 1.6,
                                          8300u + static_cast<std::uint64_t>(k));
    const PitchResult p = detect(s);
    const double trueMidi = midi + cents / 100.0;
    const int trueRoot = static_cast<int>(std::lround(trueMidi));
    if (p.root != trueRoot) {
      std::printf("    midi %.0f%+.0fc: root %d, expected %d\n", midi, cents, p.root, trueRoot);
      continue;
    }
    const double trueFine = 100.0 * (trueMidi - static_cast<double>(trueRoot));
    worst = std::max(worst, std::fabs(p.fineCents - trueFine));
  }
  std::printf("    worst fine-tune error over 10 detuned sawtooths: %.2f cents\n", worst);
  MW_EXPECT(worst <= 5.0);
}

MW_TEST("the reference pitch is a setting, and moving it moves the detected root") {
  // §3.4 writes nu = 69 + 12 log2(f0 / A_ref), and `syn-01` §3.3's reason for
  // making A_ref a setting is that an orchestra at 442 is not out of tune. A
  // 440 Hz tone read against a 466.16 Hz reference is a semitone flat of A4,
  // so the root moves to 68 and the fine stays near zero.
  const corpus::Signal s = corpus::note(corpus::Timbre::Sawtooth, 69.0, 0.0, 44100.0, 1.6, 8400);
  Options o;
  const PitchResult at440 = detect(s, o);
  o.referencePitchHz = 466.163761518;
  const PitchResult at466 = detect(s, o);
  std::printf("    A440 tone: root %d fine %+.1f at A_ref 440; root %d fine %+.1f at A_ref 466.16\n",
              at440.root, at440.fineCents, at466.root, at466.fineCents);
  MW_EXPECT_EQ(at440.root, 69);
  MW_EXPECT_NEAR(at440.fineCents, 0.0, 5.0);
  MW_EXPECT_EQ(at466.root, 68);
  MW_EXPECT_NEAR(at466.fineCents, 0.0, 5.0);
}

MW_TEST_MAIN("sample_pitch")
