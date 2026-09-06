// Motion Wave — the importer's conditioning stage. `smp-01` §3.2.
//
// §9 has no row of its own for conditioning: it is the stage every other row
// runs through, so its faults show up as somebody else's number being wrong.
// That is exactly why it needs its own suite — a trim that eats 5 ms of attack
// makes V-5 look like a refinement bug, and a noise floor measured as a
// minimum rather than a percentile makes V-4 look like a threshold bug.
//
// SYNTHESISED, and for this stage the synthesis is nearly ideal: every
// quantity §3.2 measures is one the corpus can state exactly. A DC offset put
// there on purpose is known to the last bit; a true peak between samples can
// be constructed analytically; a noise floor is whatever amplitude the noise
// was scaled to. What a real file would add is the pathology — a fade-in that
// never quite reaches the gate, a click at the head from a bad edit, hum at
// 50 Hz that a percentile floor will happily count as the floor.
#include "../dsp/sample/analyse.h"
#include "harness.h"
#include "sample_corpus.h"

#include <cstdio>
#include <vector>

using namespace mw::dsp::sample;
namespace corpus = mw::test::corpus;

namespace {

Conditioning conditionOf(const corpus::Signal& s, const ConditioningOptions& o) {
  std::vector<double> x(s.x.size());
  for (std::size_t i = 0; i < s.x.size(); ++i) x[i] = s.x[i];
  return condition(x, s.rate, o);
}

}  // namespace

// ─────────────────────────────────────────────────────────── DC removal

MW_TEST("a DC offset above the threshold is measured and subtracted; below it, neither") {
  // §3.2: subtract the whole-file mean when |mean| > 1e-4. The reason is not
  // level: it is that every zero-crossing test downstream — the head trim's
  // own back-off, the onset refinement, the loop join — is wrong on a signal
  // that does not cross zero where it sounds like it does.
  // The offsets are measured as a CHANGE from the same file's own mean, not
  // as absolute values. A 300 ms tone in a 500 ms file does not have a mean of
  // zero — this one sits at −2.9e-4, which is already above the threshold on
  // its own — so comparing `dcOffset` against the offset that was added would
  // be measuring the stimulus rather than the stage. The first run of this row
  // did exactly that and reported four failures against a stage that was
  // right, which is the corpus-versus-product confusion in miniature.
  corpus::Signal base;
  base.rate = 44100.0;
  base.x.assign(base.frames(0.5), 0.0);
  corpus::addTone(base, base.frames(0.05), 220.0, corpus::db(-12.0),
                  corpus::partialsFor(corpus::Timbre::Sine), 2.0, 300.0);
  const double intrinsic = conditionOf(base, ConditioningOptions{}).dcOffset;
  std::printf("    the untouched file's own mean is %+.6f\n", intrinsic);
  for (double offset : {0.0, 5.0e-5, 1.0e-3, 0.02}) {
    corpus::Signal s = base;
    for (double& v : s.x) v += offset;
    ConditioningOptions o;
    const Conditioning c = conditionOf(s, o);
    std::printf("    added %+.5f -> mean %+.6f (change %+.6f), removed %s\n", offset, c.dcOffset,
                c.dcOffset - intrinsic, c.dcRemoved ? "yes" : "no");
    MW_EXPECT_NEAR(c.dcOffset - intrinsic, offset, 1.0e-6);
    MW_EXPECT_EQ(c.dcRemoved ? 1 : 0, std::fabs(c.dcOffset) > o.dcThreshold ? 1 : 0);
  }
}

MW_TEST("removing DC actually moves the zero crossings, which is the point of removing it") {
  // The row that makes the one above mean something: a mutation that measures
  // the offset and forgets to subtract it passes on `dcOffset` alone.
  corpus::Rng rng;
  rng.seed(2101);
  corpus::Signal s;
  s.rate = 44100.0;
  s.x.assign(s.frames(0.5), 0.0);
  corpus::addTone(s, s.frames(0.05), 220.0, corpus::db(-20.0),
                  corpus::partialsFor(corpus::Timbre::Sine), 2.0, 300.0);
  // An offset larger than the tone's own amplitude: uncorrected, the signal
  // never crosses zero at all.
  for (double& v : s.x) v += 0.2;
  std::vector<double> x(s.x.size());
  for (std::size_t i = 0; i < s.x.size(); ++i) x[i] = s.x[i];
  int crossingsBefore = 0;
  for (std::size_t i = s.frames(0.1) + 1; i < s.frames(0.3); ++i) {
    if ((x[i] < 0.0) != (x[i - 1] < 0.0)) ++crossingsBefore;
  }
  const Conditioning c = condition(x, s.rate, ConditioningOptions{});
  int crossingsAfter = 0;
  for (std::size_t i = s.frames(0.1) + 1; i < s.frames(0.3); ++i) {
    if ((x[i] < 0.0) != (x[i - 1] < 0.0)) ++crossingsAfter;
  }
  std::printf("    zero crossings over 200 ms of a 220 Hz tone: %d before, %d after (expect ~88)\n",
              crossingsBefore, crossingsAfter);
  MW_EXPECT(c.dcRemoved);
  MW_EXPECT_EQ(crossingsBefore, 0);
  MW_EXPECT(crossingsAfter >= 80);
}

// ───────────────────────────────────────────────────────────── true peak

MW_TEST("true peak finds an inter-sample peak a sample-peak reading misses") {
  // §3.2's reason for 4x oversampling: a signal can read -0.1 dBFS on the
  // sample grid and be +0.6 dBTP between samples, and the zone's headroom
  // budget needs the real number.
  //
  // The stimulus is the classic worst case: a sine at exactly fs/4, phase
  // shifted so the grid samples land at +-1/sqrt(2) and the true peaks fall
  // exactly between them. The sample peak is 0.707 of the true peak — 3.01 dB
  // low — and no amount of looking at samples finds it.
  corpus::Signal s;
  s.rate = 44100.0;
  s.x.assign(s.frames(0.5), 0.0);
  const double amp = 0.5;
  for (std::size_t i = 0; i < s.x.size(); ++i) {
    const double t = static_cast<double>(i);
    s.x[i] = amp * std::sin(2.0 * corpus::kPi * 0.25 * t + corpus::kPi * 0.25);
  }
  const Conditioning c = conditionOf(s, ConditioningOptions{});
  std::printf("    sample peak %.5f (%.2f dBFS), true peak %.5f (%.2f dBFS), true amplitude %.5f\n",
              c.samplePeak, toDb(c.samplePeak), c.truePeak, c.truePeakDb, amp);
  MW_EXPECT_NEAR(c.samplePeak, amp * 0.70710678, 0.001);
  // The true peak must find most of the missing 3 dB. Not all of it: a
  // 16-tap kernel at 4x has a finite passband and fs/4 is the hardest case it
  // will ever see.
  MW_EXPECT(c.truePeak >= 0.97 * amp);
  MW_EXPECT(c.truePeak <= 1.02 * amp);
  MW_EXPECT(c.truePeak > c.samplePeak * 1.3);
}

MW_TEST("the stored gain is what a normalise would have applied, and the samples are untouched") {
  // §3.1 and §3.2: measure and store, never rewrite. A destructive normalise
  // cannot be undone, re-quantises the data, and on a file already near full
  // scale is the step that turns an inter-sample peak into a clip.
  corpus::Rng rng;
  rng.seed(2102);
  corpus::Signal s;
  s.rate = 44100.0;
  s.x.assign(s.frames(0.5), 0.0);
  corpus::addTone(s, s.frames(0.05), 440.0, corpus::db(-18.0),
                  corpus::partialsFor(corpus::Timbre::Sine), 2.0, 300.0);
  corpus::addFloor(s, -80.0, rng);
  std::vector<double> x(s.x.size());
  for (std::size_t i = 0; i < s.x.size(); ++i) x[i] = s.x[i];
  const std::vector<double> before = x;
  const Conditioning c = condition(x, s.rate, ConditioningOptions{});
  double worstChange = 0.0;
  for (std::size_t i = 0; i < x.size(); ++i) worstChange = std::max(worstChange, std::fabs(x[i] - before[i]));
  std::printf("    true peak %.2f dBFS -> stored gain %+.2f dB; largest sample change %.2e\n",
              c.truePeakDb, c.gainDb, worstChange);
  // The gain is the negative of the true peak — applying it would put the file
  // at 0 dBTP — CLAMPED to §7.1's control range, which stops at +12 dB. This
  // file peaks at −18 dBFS, so what is being read here is the clamp, and the
  // row says so rather than asserting a number the control cannot hold.
  const ConditioningOptions defaults;
  const double wanted = -c.truePeakDb;
  std::printf("    a normalise would want %+.2f dB; the control range caps it at %+.2f\n", wanted,
              defaults.gainMaxDb);
  MW_EXPECT(wanted > defaults.gainMaxDb);
  MW_EXPECT_NEAR(c.gainDb, defaults.gainMaxDb, 0.01);
  // And nothing was scaled: the only change conditioning may make is DC, and
  // this file's offset is far below the threshold.
  MW_EXPECT(!c.dcRemoved);
  MW_EXPECT(worstChange < 1.0e-12);
}

// ─────────────────────────────────────────────────────────── noise floor

MW_TEST("the noise floor is a percentile, so one silent frame cannot define it") {
  // §3.2's stated reason for a percentile rather than a minimum, made into a
  // measurement: a file with real room tone and one frame of digital silence
  // in it. A minimum reports the silence and the gate then sits 12 dB above
  // nothing, which opens the trim to the tone itself.
  corpus::Rng rng;
  rng.seed(2103);
  corpus::Signal s;
  s.rate = 44100.0;
  s.x.assign(s.frames(2.0), 0.0);
  const double toneDb = -50.0;
  for (std::size_t i = 0; i < s.x.size(); ++i) s.x[i] = corpus::db(toneDb) * corpus::noise(rng);
  corpus::addTone(s, s.frames(0.5), 330.0, corpus::db(-10.0),
                  corpus::partialsFor(corpus::Timbre::Sawtooth), 2.0, 800.0);
  // One 20 ms frame of true digital silence, as a bad edit leaves.
  for (std::size_t i = s.frames(1.6); i < s.frames(1.62); ++i) s.x[i] = 0.0;
  const Conditioning c = conditionOf(s, ConditioningOptions{});
  std::printf("    room tone at %.0f dBFS, one silent frame; measured floor %.2f dBFS, gate %.2f\n",
              toneDb, c.noiseFloorDb, c.gateDb);
  // The floor must report the tone, not the silence.
  MW_EXPECT(c.noiseFloorDb > toneDb - 8.0);
  MW_EXPECT(c.noiseFloorDb < toneDb + 8.0);
}

MW_TEST("the gate is the louder of -60 dBFS and floor + 12 dB") {
  // Both branches of `max(-60 dBFS, floor + 12 dB)`, because a rule with two
  // arms needs a case for each. A very quiet file takes the absolute arm; a
  // noisy one takes the relative arm.
  for (double floorDb : {-90.0, -40.0}) {
    corpus::Rng rng;
    rng.seed(2104);
    corpus::Signal s;
    s.rate = 44100.0;
    s.x.assign(s.frames(1.0), 0.0);
    for (std::size_t i = 0; i < s.x.size(); ++i) s.x[i] = corpus::db(floorDb) * corpus::noise(rng);
    corpus::addTone(s, s.frames(0.2), 440.0, corpus::db(-6.0),
                    corpus::partialsFor(corpus::Timbre::Sine), 2.0, 400.0);
    const Conditioning c = conditionOf(s, ConditioningOptions{});
    const double expected = std::max(-60.0, c.noiseFloorDb + 12.0);
    std::printf("    floor %.0f -> measured %.2f, gate %.2f (expected %.2f, %s arm)\n", floorDb,
                c.noiseFloorDb, c.gateDb, expected,
                c.noiseFloorDb + 12.0 > -60.0 ? "relative" : "absolute");
    MW_EXPECT_NEAR(c.gateDb, expected, 0.01);
  }
}

// ──────────────────────────────────────────────────────────────── trim

MW_TEST("the head trim lands before the attack, never inside it") {
  // §3.2: the first 1 ms frame over the gate, then back off 5 ms or to the
  // previous zero crossing, whichever is NEARER. The reason for backing off at
  // all is that trimming at the threshold removes the first samples of the
  // attack, and a transient missing its leading edge is audibly softened.
  corpus::Rng rng;
  rng.seed(2105);
  corpus::Signal s;
  s.rate = 44100.0;
  s.x.assign(s.frames(1.0), 0.0);
  for (std::size_t i = 0; i < s.x.size(); ++i) s.x[i] = corpus::db(-70.0) * corpus::noise(rng);
  const std::size_t at = s.frames(0.3);
  corpus::addBurst(s, at, corpus::db(-6.0), 60.0, 0.0, false, 0.0, rng);
  const Conditioning c = conditionOf(s, ConditioningOptions{});
  const double startMs = 1000.0 * static_cast<double>(c.start) / s.rate;
  const double atMs = 1000.0 * static_cast<double>(at) / s.rate;
  std::printf("    burst at %.1f ms; trimmed span starts %.1f ms (%.2f ms early)\n", atMs, startMs,
              atMs - startMs);
  MW_EXPECT(c.start <= at);
  MW_EXPECT(atMs - startMs <= 5.5);
  // **THE 5 ms BACK-OFF IS NOT WHAT THIS ROW MEASURES, and the mutation says
  // so.** Setting `backoff` to zero leaves the row green: the trim still lands
  // 0.68 ms before the burst, because §3.2's rule takes the back-off *or the
  // previous zero crossing, whichever is nearer*, and on a burst rising out of
  // room tone there is always a crossing within a millisecond. The back-off is
  // the fallback arm, and it binds only where the material does not cross zero
  // near the attack — a lowpassed kick out of digital silence.
  //
  // What is checked here is the property that matters either way: the span
  // never opens inside the attack. Constructing the case where the back-off
  // itself binds needs material with no crossing in front of the onset, and is
  // left undone rather than claimed.
}

MW_TEST("the tail keeps 50 ms past the last sound, because a hard cut is a click") {
  corpus::Rng rng;
  rng.seed(2106);
  corpus::Signal s;
  s.rate = 44100.0;
  s.x.assign(s.frames(2.0), 0.0);
  for (std::size_t i = 0; i < s.x.size(); ++i) s.x[i] = corpus::db(-80.0) * corpus::noise(rng);
  corpus::addTone(s, s.frames(0.2), 440.0, corpus::db(-6.0),
                  corpus::partialsFor(corpus::Timbre::Sine), 2.0, 500.0);
  const Conditioning c = conditionOf(s, ConditioningOptions{});
  // Where does the tone actually fall under the gate? Measured, not assumed.
  const double gate = fromDb(c.gateDb);
  const std::size_t w = framesFor(1.0, s.rate);
  std::size_t lastLoud = c.start;
  for (std::size_t n = c.start; n + w < s.x.size(); n += w) {
    std::vector<double> x(s.x.size());
    for (std::size_t i = 0; i < s.x.size(); ++i) x[i] = s.x[i];
    if (rmsOver(x, n, n + w) > gate) lastLoud = n + w;
  }
  const double padMs = 1000.0 * (static_cast<double>(c.end) - static_cast<double>(lastLoud)) / s.rate;
  std::printf("    last frame over the gate ends at %.1f ms; span ends at %.1f ms (pad %.1f ms)\n",
              1000.0 * static_cast<double>(lastLoud) / s.rate,
              1000.0 * static_cast<double>(c.end) / s.rate, padMs);
  MW_EXPECT(c.end > lastLoud);
  MW_EXPECT_NEAR(padMs, 50.0, 6.0);
}

MW_TEST("a file that never rises above the gate keeps its whole span rather than none of it") {
  // The degenerate case, and the one where a trim can do real damage: silence
  // in, and the trim must hand the next stage something rather than an empty
  // range. `silent` is how the caller knows.
  corpus::Rng rng;
  rng.seed(2107);
  corpus::Signal s;
  s.rate = 44100.0;
  s.x.assign(s.frames(0.5), 0.0);
  for (std::size_t i = 0; i < s.x.size(); ++i) s.x[i] = corpus::db(-100.0) * corpus::noise(rng);
  const Conditioning c = conditionOf(s, ConditioningOptions{});
  std::printf("    silent file: span %zu..%zu of %zu, flagged silent %s\n", c.start, c.end,
              s.x.size(), c.silent ? "yes" : "no");
  MW_EXPECT(c.silent);
  MW_EXPECT_EQ(static_cast<long long>(c.start), 0);
  MW_EXPECT_EQ(static_cast<long long>(c.end), static_cast<long long>(s.x.size()));
}

MW_TEST_MAIN("sample_conditioning")
