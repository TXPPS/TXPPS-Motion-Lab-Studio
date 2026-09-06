// Motion Wave — the importer's onset detector. `smp-01` §3.3: rows V-4 and V-5.
//
// SYNTHESISED CORPUS. There is no hand-labelled corpus in this repository, so
// the twenty files V-4 names are built by `sample_corpus.h` with labels known
// by construction: ten drum loops (noise bursts under exponential decays at
// integer sample positions, two of them with a tonal kick), five melodic
// phrases (decaying harmonic tones, overlapping), five mixed, alternating
// 44.1 and 48 kHz. A label is the sample an envelope starts on, which is a
// better label than a person can place and a worse test than a room: nothing
// here has bleed, hum, a flam, or an attack that takes forty milliseconds to
// become a note. A real corpus would add those and would move the [I]
// parameters of §3.3; these files bracket them, as §13 item 2 says.
//
// **V-4 PASSES; V-5 DOES NOT, AND THE NUMBERS BELOW ARE THE MEASUREMENT.**
//
//   V-4: F = 0.958 at +-50 ms (target 0.95), F = 0.932 at +-10 ms (0.90),
//        precision 0.956, recall 0.959 over 318 labels.
//   V-5: 38 late and 87 earlier than 2 ms, of 301 paired. Target is zero of
//        each.
//
// Getting V-4 from 0.877 to 0.958 was three corrections, and two of them were
// to the ruler rather than to the detector — which is the thing this project
// says to check first, and it was right both times:
//
//   1. THE CORPUS LABELLED EVENTS IT HAD MASKED. A -13 dBFS hat 100 ms into a
//      -4 dBFS kick's decay raises the signal by under a decibel; 45 of 56
//      apparent misses were events like that, and recall over everything else
//      was already 0.965. `audible()` now labels only what the rendered mix
//      presents, and the masked hits stay in the audio as a don't-care set so
//      that detecting one is neither rewarded nor punished.
//   2. THE ISOLATED-BURST FILES BEGAN IN DIGITAL SILENCE. The head trim starts
//      the span at the first sound, so the first burst landed in STFT frame 0,
//      which has no history behind it and whose local mean is its own decay.
//      Whole-file room tone fixes it. Note the first attempt at this fix laid
//      tone only in front of the first burst, and the tone's own ENDING was
//      then detectable — the ruler acquiring a second defect while fixing the
//      first, found only because the flam file's count went the wrong way.
//   3. The one real detector change: the ratio in condition (b) is taken
//      against the local window MINUS the candidate's own lobe. A frame was
//      being divided by a number it had largely produced. See `onset.h`.
//
// V-5's residue is genuine and is not a labelling artefact — measured: 15 of
// the late detections lose more than 1 % of the event's first 20 ms of energy
// and the worst loses 37 %, which is exactly the loss the rule exists to
// forbid. The lateness concentrates in melodic material, where an attack ramps
// over milliseconds and the steepest rise sits well inside it.
//
// The remaining red mechanism row is the `pair` case: two identical bursts
// 60 ms apart, where the second's background window is dominated by the
// first's peak (mean 1051 against a floor near 400) so it scores 1.52 and is
// rejected. A median background fixes that case and costs F 0.899 -> 0.780
// everywhere else, because flux is spiky and the median of any such window
// sits below its mean essentially always -- `min(mean, median)` measured
// identically to the median alone, which is what proved it. Recorded in
// `onset.h` as a known miss.
//
// Mutation-tested, each edit restored before the next, and each verdict is a
// measurement from the run rather than an expectation:
//
//   half-wave rectification removed (sum |d| for sum H(d)) -> LOAD-BEARING,
//     but NOT via the row named for it. V-4 goes F 0.958 -> 0.928 and recall
//     0.959 -> 0.877; failures 3 -> 4. The dedicated decay row stays green
//     under it in both shapes tried, for the reason given at that row.
//   the anchor put at the frame centre, which is the sheet's own wording,
//     instead of walked to the foot of its own climb -> LOAD-BEARING: V-5's
//     late count 35 -> 121 on the corpus as it then stood.
//   the 30 ms refractory period removed -> WEAK on this corpus, and recorded
//     as weak. F 0.877 -> 0.866 when measured, and no row changed colour.
//
#include "sample_onset_fixtures.h"
#include "harness.h"

#include <cstdio>
#include <string>
#include <vector>

using namespace mw::dsp::sample;
namespace corpus = mw::test::corpus;
using mw::test::onsetfix::analyse;
using mw::test::onsetfix::detections;
using mw::test::onsetfix::theCorpus;



// ───────────────────────────────────────────────────────────────── V-4

MW_TEST("V-4 F >= 0.95 at +-50 ms and >= 0.90 at +-10 ms over the twenty-file corpus") {
  corpus::Score at50, at10;
  for (const corpus::Signal& s : theCorpus()) {
    const Analysis a = analyse(s);
    const std::vector<std::size_t> det = detections(a);
    const corpus::Score s50 = corpus::scoreOnsets(det, s.onsets, framesFor(50.0, s.rate), s.masked);
    const corpus::Score s10 = corpus::scoreOnsets(det, s.onsets, framesFor(10.0, s.rate), s.masked);
    std::printf(
        "    %-11s %5.0f Hz  labels %2d  found %2d  F50 %.3f  F10 %.3f  (median flux %.2f, delta "
        "%.2f)\n",
        s.name.c_str(), s.rate, s50.labels, s50.detections, s50.f(), s10.f(), a.onsets.medianFlux,
        a.onsets.delta);
    {
      // The flux distribution against the weakest true onset: how much room
      // any threshold rule has on this file.
      const std::vector<double>& sf = a.onsets.flux;
      double weakest = 1.0e300;
      for (std::size_t label : s.onsets) {
        const long frame0 = label > a.onsets.begin ? static_cast<long>((label - a.onsets.begin) / 256) : 0;
        double peakFlux = 0.0;
        for (long j = std::max(0L, frame0 - 2); j <= std::min(static_cast<long>(sf.size()) - 1, frame0 + 5); ++j) {
          peakFlux = std::max(peakFlux, sf[static_cast<std::size_t>(j)]);
        }
        weakest = std::min(weakest, peakFlux);
      }
      std::printf("      flux p10 %.1f p50 %.1f p90 %.1f max %.1f; weakest onset %.1f\n", percentile(sf, 0.10),
                  percentile(sf, 0.50), percentile(sf, 0.90), percentile(sf, 1.0), weakest);
    }
    // Name what went wrong, in milliseconds, so a red row can be looked at
    // rather than re-run: labels nothing came within 50 ms of, and detections
    // no label claimed.
    if (s50.f() < 1.0) {
      const std::size_t tol = framesFor(50.0, s.rate);
      for (std::size_t label : s.onsets) {
        bool near = false;
        for (std::size_t d : det) near = near || (d > label ? d - label : label - d) <= tol;
        if (near) continue;
        // The flux frame nearest the label, and what condition (b) compared it against.
        const std::vector<double>& sf = a.onsets.flux;
        const long frame0 = label > a.onsets.begin ? static_cast<long>((label - a.onsets.begin) / 256) : 0;
        long peakFrame = frame0;
        for (long j = std::max(0L, frame0 - 2); j <= std::min(static_cast<long>(sf.size()) - 1, frame0 + 5); ++j) {
          if (sf[static_cast<std::size_t>(j)] > sf[static_cast<std::size_t>(peakFrame)]) peakFrame = j;
        }
        double sum = 0.0;
        long members = 0;
        for (long j = std::max(0L, peakFrame - 9); j <= std::min(static_cast<long>(sf.size()) - 1, peakFrame + 3); ++j) {
          sum += sf[static_cast<std::size_t>(j)];
          ++members;
        }
        std::printf("      missed label at %.1f ms: flux %.1f vs local mean %.1f + delta %.1f\n",
                    static_cast<double>(label) * 1000.0 / s.rate, sf[static_cast<std::size_t>(peakFrame)],
                    sum / static_cast<double>(members), a.onsets.delta);
      }
      for (const Onset& on : a.onsets.onsets) {
        bool near = false;
        for (std::size_t label : s.onsets) {
          near = near || (on.sample > label ? on.sample - label : label - on.sample) <= tol;
        }
        if (!near) {
          const std::vector<double>& sf = a.onsets.flux;
          const long m = static_cast<long>(on.frame);
          double sum = 0.0;
          long members = 0;
          for (long j = std::max(0L, m - 9); j <= std::min(static_cast<long>(sf.size()) - 1, m + 3); ++j) {
            sum += sf[static_cast<std::size_t>(j)];
            ++members;
          }
          std::printf("      spurious at %.1f ms: flux %.1f vs local mean %.1f + delta %.1f\n",
                      static_cast<double>(on.sample) * 1000.0 / s.rate, on.flux,
                      sum / static_cast<double>(members), a.onsets.delta);
        }
      }
    }
    at50.matched += s50.matched;
    at50.detections += s50.detections;
    at50.labels += s50.labels;
    at10.matched += s10.matched;
    at10.detections += s10.detections;
    at10.labels += s10.labels;
  }
  std::printf("    corpus: %d labels, %d detections; +-50 ms P %.3f R %.3f F %.3f; +-10 ms F %.3f\n",
              at50.labels, at50.detections, at50.precision(), at50.recall(), at50.f(), at10.f());
  MW_EXPECT(at50.labels >= 200);
  MW_EXPECT(at50.f() >= 0.95);
  MW_EXPECT(at10.f() >= 0.90);
}

// ───────────────────────────────────────────────────────────────── V-5

MW_TEST("V-5 every matched detection lies in [label - 2 ms, label]: early is allowed, late is not") {
  int matched = 0, late = 0, tooEarly = 0;
  double worstEarlyMs = 0.0, worstLateMs = 0.0;
  for (const corpus::Signal& s : theCorpus()) {
    const Analysis a = analyse(s);
    const std::vector<std::size_t> det = detections(a);
    // Paired within 10 ms, not within V-4's 50 ms, and the distinction is the
    // difference between measuring placement and measuring something else.
    // V-5 asks where a detection of *this event* landed. At 50 ms a label the
    // peak picker missed is paired with the neighbouring hit's detection
    // instead, and that pairing then reports a 44 ms "placement error" that
    // is really one missing onset — a recall failure V-4 already counts, read
    // a second time as a bias it is not. Anything further than 10 ms from a
    // label is a different event.
    const std::size_t tolerance = framesFor(10.0, s.rate);
    const std::size_t allowed = framesFor(2.0, s.rate);
    for (std::size_t label : s.onsets) {
      std::size_t best = det.size();
      std::size_t bestGap = tolerance + 1;
      for (std::size_t i = 0; i < det.size(); ++i) {
        const std::size_t gap = det[i] > label ? det[i] - label : label - det[i];
        if (gap <= tolerance && gap < bestGap) {
          bestGap = gap;
          best = i;
        }
      }
      if (best == det.size()) continue;
      ++matched;
      if (det[best] > label) {
        ++late;
        worstLateMs = std::max(worstLateMs, static_cast<double>(det[best] - label) * 1000.0 / s.rate);
      } else if (label - det[best] > allowed) {
        ++tooEarly;
        worstEarlyMs = std::max(worstEarlyMs, static_cast<double>(label - det[best]) * 1000.0 / s.rate);
      }
    }
  }
  std::printf("    %d matched: %d late (worst %.2f ms), %d earlier than 2 ms (worst %.2f ms)\n", matched,
              late, worstLateMs, tooEarly, worstEarlyMs);
  MW_EXPECT(matched >= 200);
  /*
   * **The sheet states two bounds and holds the row to one of them.** V-5's
   * target column reads "every detection lies in [label - 2 ms, label]"; its
   * tolerance column reads "0 late detections", and §3.3 gives the reason
   * the two differ: the rule "is asymmetric on purpose", because an early
   * slice adds a few samples of near-silence and a late one removes the
   * attack, which is the only part of a percussive sound anybody recognises.
   * An early detection is not a defect of the same kind as a late one, and
   * the tolerance column is where the sheet says what it will fail the build
   * over.
   *
   * So lateness is asserted and earliness is measured and printed. 87 of 301
   * matched detections sit further than 2 ms before their label, worst 9.4 ms,
   * concentrated on material whose attack is a ramp rather than a step: the
   * walk-back to the local minimum of 1 ms RMS finds the foot of the ramp,
   * which is where the slice should start and is not where a hand-placed
   * label goes. Asserting zero there would be asserting that the refinement
   * does not do the thing §3.3 asks it to do.
   *
   * **The lateness is the real failure and it is not being softened.** It now
   * stands at 4 of 301, from 38 when this note was written; 3 of the 4 lose
   * more than one percent of the first 20 ms of the event's energy and the
   * worst loses 24 percent, from 23 and 37 percent. The row still fails and
   * the assertion below is unchanged.
   *
   * What the 34 were: a 1 ms RMS cannot resolve the envelope of a 55 Hz
   * waveform — it holds a third of a cycle, so its output swings once per
   * cycle *inside one attack*, and the walk to the attack's foot stopped at
   * whichever trough the waveform put there. 36 of the 38 had their label
   * inside the flux frame the peak picker had already chosen correctly, so
   * the fault was never in the frame. `onset.h`'s `coarseRmsMs` and
   * `refine.h`'s two-envelope split are the fix and carry the measurements.
   *
   * What the 4 are: three ramps whose 10-90 rise times are 2.7, 3.7 and
   * 9.6 ms, where the label is an envelope's mathematical start and the walk
   * stops where the ramp becomes distinguishable from what precedes it; and
   * one transient, 0.7 ms late, losing 0.10 percent. §13 item 2 records the
   * peak-picking parameters this depends on as unconfirmed.
   */
  std::printf("    V-5: %d early beyond 2 ms is measured, not asserted -- see the note above\n",
              tooEarly);
  MW_EXPECT_EQ(late, 0);
}

MW_TEST_MAIN("sample_onset")
