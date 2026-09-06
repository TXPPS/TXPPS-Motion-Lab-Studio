// Motion Wave — the importer's loop-point search. `smp-01` §3.5: V-7 and V-8.
//
// NOT `sample_loop_tests.cpp`, which another agent owns for §4.2's playback
// loop modes. This file is the offline search that decides where a loop is;
// that one is the read head that plays it.
//
// SYNTHESISED, and here the synthesis is the whole point: V-7's stimulus is
// specified as "a 220 Hz sawtooth with a 2 % amplitude decay", which is a
// description of a rendered signal rather than of a recording, and its target
// — a loop length that is an integer multiple of 200.45 samples — is
// arithmetic the corpus can be held to exactly. What a real corpus would add
// is material whose period is not constant: a string that drifts, a note with
// vibrato, an ensemble that beats. Case A assumes one period for the whole
// sustain, and nothing here tests that assumption.
//
// V-8's discriminator is the part worth reading. The sheet derives that
// correlated material summed under an equal-power fade gains 3 dB in the
// middle and uncorrelated material under an equal-gain fade loses 3 dB, so
// the shape law is not a preference — getting it backwards puts a level pulse
// once per loop pass, which is the artefact the crossfade exists to remove.
// The row applies the WRONG shape deliberately and measures the pulse.
#include "../dsp/sample/analyse.h"
#include "harness.h"
#include "sample_corpus.h"

#include <cstdio>
#include <vector>

using namespace mw::dsp::sample;
namespace corpus = mw::test::corpus;

namespace {

/// The signal as the importer sees it: conditioned, DC removed, trimmed.
Analysis analyse(const corpus::Signal& s) {
  const std::vector<float> f = s.asFloat();
  return analyseOneShot(f.data(), f.size(), s.rate, Options{});
}

/// Largest absolute first difference inside [begin, end), and the mean, so a
/// join can be compared against the material it joins.
void differenceStats(const std::vector<double>& x, std::size_t begin, std::size_t end,
                     double& worst, double& mean) {
  worst = 0.0;
  mean = 0.0;
  std::size_t n = 0;
  for (std::size_t i = begin + 1; i < end && i < x.size(); ++i) {
    const double d = std::fabs(x[i] - x[i - 1]);
    worst = std::max(worst, d);
    mean += d;
    ++n;
  }
  if (n > 0) mean /= static_cast<double>(n);
}

}  // namespace

// ───────────────────────────────────────────────────────────────── V-7

MW_TEST("V-7 a 220 Hz sawtooth loops on an integer number of 200.45-sample periods") {
  // 44100 / 220 = 200.4545..., and the sheet asks for the loop length to be an
  // integer multiple of it to within half a sample.
  const corpus::Signal s = corpus::sawtoothDecay(220.0, 44100.0, 3.0, 0.02, 4400);
  const Analysis a = analyse(s);
  const double period = 44100.0 / 220.0;
  MW_EXPECT(a.loop.kind == LoopKind::PeriodLocked);
  const double length = static_cast<double>(a.loop.length());
  const double periods = length / period;
  const double err = std::fabs(periods - std::round(periods)) * period;
  std::printf("    loop %zu..%zu = %.0f samples = %.4f periods of %.4f (error %.3f samples)\n",
              a.loop.start, a.loop.end, length, periods, period, err);
  std::printf("    join correlation rho = %.5f over %d periods, crossfade %zu, shape %s\n",
              a.loop.rho, a.loop.periods, a.loop.crossfade,
              a.loop.shape == CrossfadeShape::EqualGain ? "equal-gain" : "equal-power");
  MW_EXPECT(err <= 0.5);
  MW_EXPECT(a.loop.rho >= 0.99);
  // The sheet's own floor on the length: k*P >= max(50 ms, 4P).
  MW_EXPECT(length >= 0.050 * s.rate);
  MW_EXPECT(length >= 4.0 * period);
}

MW_TEST("V-7 the detected period is what the loop is built on, not a guess") {
  // A loop that is an integer number of periods of the WRONG period is still
  // an integer number of periods, so the row above cannot stand alone: it
  // would pass on a detector that found 110 Hz. This one pins the pitch.
  const corpus::Signal s = corpus::sawtoothDecay(220.0, 44100.0, 3.0, 0.02, 4400);
  const Analysis a = analyse(s);
  std::printf("    detected f0 %.3f Hz (period %.4f samples), periodicity %.4f\n", a.pitch.f0,
              a.pitch.period, a.pitch.periodicity);
  MW_EXPECT_NEAR(a.pitch.f0, 220.0, 0.5);
  MW_EXPECT(a.pitch.periodicity >= 0.90);
}

// ───────────────────────────────────────────────────────────────── V-8

MW_TEST("V-8 sustaining a loop for 60 s leaves no join louder than the interior") {
  const corpus::Signal s = corpus::sawtoothDecay(220.0, 44100.0, 3.0, 0.02, 4400);
  const Analysis a = analyse(s);
  MW_EXPECT(a.loop.kind != LoopKind::None);
  const std::size_t frames = static_cast<std::size_t>(60.0 * s.rate);
  const std::vector<double> out = renderSustain(a.signal, a.loop, frames);
  const std::size_t len = a.loop.length();
  MW_EXPECT(len > 0);

  // The interior's largest first difference, measured away from every join.
  double interiorWorst = 0.0, interiorMean = 0.0;
  differenceStats(out, len / 4, len / 4 + len / 2, interiorWorst, interiorMean);

  // Every join in 60 seconds: the first difference across the wrap, and the
  // RMS 10 ms either side of it.
  double worstJumpDb = -200.0, worstStepDb = 0.0;
  const std::size_t w = framesFor(10.0, s.rate);
  int joins = 0;
  for (std::size_t at = len; at + w < out.size(); at += len) {
    ++joins;
    const double jump = std::fabs(out[at] - out[at - 1]);
    worstJumpDb = std::max(worstJumpDb, toDb(jump) - toDb(interiorWorst));
    const double before = rmsOver(out, at - w, at);
    const double after = rmsOver(out, at, at + w);
    worstStepDb = std::max(worstStepDb, std::fabs(toDb(after) - toDb(before)));
  }
  std::printf("    %d joins in 60 s; interior max |dx| %.6f; worst join exceeds it by %.3f dB\n",
              joins, interiorWorst, worstJumpDb);
  std::printf("    worst level step across a join: %.4f dB\n", worstStepDb);
  MW_EXPECT(joins >= 100);
  MW_EXPECT(worstJumpDb <= 1.0);
  MW_EXPECT(worstStepDb <= 0.2);
}

MW_TEST("V-8 the wrong crossfade shape produces the level pulse the sheet derives") {
  // The discriminator. §3.5 derives that correlated material — which is what a
  // period-locked loop's join is, rho >= 0.98 — sums in amplitude, so an
  // equal-power fade over it gains about 3 dB in the middle of the fade. The
  // importer chose equal-gain here; rendering the same loop with equal-power
  // must show that gain, or the shape law is not doing anything and V-8's
  // first row is passing for the wrong reason.
  const corpus::Signal s = corpus::sawtoothDecay(220.0, 44100.0, 3.0, 0.02, 4400);
  const Analysis a = analyse(s);
  MW_EXPECT(a.loop.kind == LoopKind::PeriodLocked);
  MW_EXPECT(a.loop.rho >= 0.98);
  MW_EXPECT(a.loop.shape == CrossfadeShape::EqualGain);
  MW_EXPECT(a.loop.crossfade > 0);

  const std::vector<double> right = loopBody(a.signal, a.loop, CrossfadeShape::EqualGain);
  const std::vector<double> wrong = loopBody(a.signal, a.loop, CrossfadeShape::EqualPower);
  // The middle of the crossfade, where the sheet says the bump is.
  const std::size_t xf = a.loop.crossfade;
  const std::size_t mid = right.size() - xf / 2;
  const std::size_t w = std::min<std::size_t>(xf / 4, framesFor(2.0, s.rate));
  const double rightRms = rmsOver(right, mid - w, mid + w);
  const double wrongRms = rmsOver(wrong, mid - w, mid + w);
  const double bumpDb = toDb(wrongRms) - toDb(rightRms);
  std::printf("    crossfade %zu samples; mid-fade RMS: equal-gain %.5f, equal-power %.5f\n", xf,
              rightRms, wrongRms);
  std::printf("    the wrong shape adds %+.2f dB there (the sheet derives about +3)\n", bumpDb);
  // Not exactly 3 dB: the material is correlated but not identical, and the
  // measurement is an RMS over a window rather than a point. The claim worth
  // holding is that the pulse is real, positive, and of that order.
  MW_EXPECT(bumpDb >= 1.0);
  MW_EXPECT(bumpDb <= 4.0);
}

MW_TEST("case B finds a loop in a texture that has no period at all") {
  // §3.5 case B, which is unreachable through case A by construction: noise
  // has no pitch, so the period-locked branch cannot run and the stationary
  // branch is the only thing that can produce a loop for a pad.
  const corpus::Signal s = corpus::noisePad(5150, 44100.0, 3.0);
  const Analysis a = analyse(s);
  std::printf("    map class %s; loop kind %s; length %.0f ms; crossfade %zu; shape %s\n",
              a.mapClass == MapClass::Percussive ? "percussive" : "other",
              a.loop.kind == LoopKind::Stationary ? "stationary"
                                                  : (a.loop.kind == LoopKind::PeriodLocked
                                                         ? "period-locked"
                                                         : "none"),
              1000.0 * static_cast<double>(a.loop.length()) / s.rate, a.loop.crossfade,
              a.loop.shape == CrossfadeShape::EqualGain ? "equal-gain" : "equal-power");
  MW_EXPECT(a.loop.kind == LoopKind::Stationary);
  // The sheet's derived floor: 200 ms, so the repetition sits at 5 Hz and
  // reads as movement rather than as a pitch the material does not have.
  MW_EXPECT(static_cast<double>(a.loop.length()) >= 0.200 * s.rate);
  // Uncorrelated material takes the equal-power fade, which is the other half
  // of the shape law and the half V-8's discriminator above does not exercise.
  MW_EXPECT(a.loop.shape == CrossfadeShape::EqualPower);
  MW_EXPECT(a.loop.crossfade > 0);
}

MW_TEST("case A refuses a join it cannot make, and case B catches the fall") {
  // **THIS ROW DOES NOT YET EXERCISE THE rho >= 0.95 GATE, and says so.**
  //
  // Mutation-tested: disabling the gate entirely (`if (false && bestRho <
  // acceptRho)`) leaves all seven rows green, so nothing in this file can
  // currently tell an accepting search from one that accepts anything. The
  // stimulus below was written to be the case that fails — a tone whose upper
  // partials fade away across the note, so that no two periods are alike —
  // and it measures rho = 0.9998 regardless: an amplitude envelope slow
  // enough to sound like an instrument changes almost nothing between two
  // periods 4.5 ms apart, which is the whole reason case A works at all.
  //
  // What would exercise the gate is material whose waveform differs period to
  // period at a rate comparable to the period itself — a detuned unison beating
  // at tens of hertz, or a rough multiphonic. That is left undone rather than
  // faked, and the row below still earns its place: it holds that whatever the
  // search settles on, it never reports a period-locked loop whose own
  // measured correlation is below the threshold it is supposed to enforce.
  corpus::Rng rng;
  rng.seed(5300);
  corpus::Signal s;
  s.rate = 44100.0;
  s.x.assign(s.frames(3.0), 0.0);
  const std::size_t at = s.frames(0.05);
  const std::size_t len = s.frames(2.5);
  for (std::size_t i = 0; i < len && at + i < s.x.size(); ++i) {
    const double t = static_cast<double>(i) / s.rate;
    const double u = static_cast<double>(i) / static_cast<double>(len);
    double v = 0.0;
    // Partial n's amplitude sweeps from 1/n to nearly nothing at its own rate,
    // so the spectrum at any two instants a period apart is never the same.
    for (int n = 1; n <= 12; ++n) {
      const double amp = (1.0 / n) * std::exp(-u * static_cast<double>(n) * 1.5);
      v += amp * std::sin(2.0 * corpus::kPi * 220.0 * static_cast<double>(n) * t);
    }
    const double fade = std::min(1.0, std::min(u * 40.0, (1.0 - u) * 40.0));
    s.x[at + i] += 0.4 * fade * v;
  }
  corpus::addFloor(s, -80.0, rng);
  const Analysis a = analyse(s);
  std::printf("    moving timbre: periodicity %.4f, loop kind %s, rho %.4f\n", a.pitch.periodicity,
              a.loop.kind == LoopKind::PeriodLocked
                  ? "period-locked"
                  : (a.loop.kind == LoopKind::Stationary ? "stationary" : "none"),
              a.loop.rho);
  // Whatever it settles on, it must not be a period-locked loop whose own
  // measured correlation is below the sheet's acceptance threshold.
  if (a.loop.kind == LoopKind::PeriodLocked) MW_EXPECT(a.loop.rho >= 0.95);
}

MW_TEST("a percussive one-shot gets no loop") {
  // Case C. A detector that always finds a loop would pass both rows above.
  const corpus::Signal s = corpus::noiseOneShot(5200, 44100.0);
  const Analysis a = analyse(s);
  std::printf("    one-shot: loop kind %s, span %.0f ms\n",
              a.loop.kind == LoopKind::None ? "none" : "SOMETHING",
              1000.0 * static_cast<double>(a.conditioning.end - a.conditioning.start) / s.rate);
  MW_EXPECT(a.loop.kind == LoopKind::None);
  MW_EXPECT(a.zones.size() == 1);
  MW_EXPECT(a.zones[0].loopMode == LoopMode::NoLoop);
}

MW_TEST_MAIN("sample_looppoint")
