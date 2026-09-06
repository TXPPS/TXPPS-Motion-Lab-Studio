// Motion Wave — §3.3 of `smp-01`: onset detection, and the sample it lands on.
//
// Detection function: half-wave-rectified spectral flux over a Hann STFT,
// N = 1024 and hop 256, at the file's native rate. Half-wave rectification is
// not a refinement: without it a decrease in energy counts as evidence, and
// every note release produces an onset. `sample_onset_tests.cpp` keeps the
// release case that goes red when the rectifier is removed.
//
// Peak picking is the sheet's three conditions — a local maximum over ±w
// frames, a margin δ over the mean of an asymmetric window that looks further
// back than forward, and a 30 ms refractory period. δ is 0.15 × the median
// flux of the whole file rather than an absolute number, because an absolute
// number does not survive a change of source level. The asymmetric window is
// what suppresses false positives inside a decay: the frames behind a decaying
// frame are louder than it, so the mean it must clear is high.
//
// There is a fourth condition the sheet does not have, and
// `OnsetOptions::meanRatio` argues for it: the frame must clear its local mean
// by a *factor*, not only by the fixed margin δ, because δ is a statistic of
// the whole file and cannot be right in both a loud bar and a quiet one.
//
#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <vector>

#include "measure.h"
#include "refine.h"

namespace mw::dsp::sample {


struct OnsetOptions {
  /// §3.3: N = 1024 [C] and hop 256 — the sheet's [I] halving of the published
  /// 512, because this analysis is offline and 11.6 ms of placement error is
  /// a soft attack on a slice where it is inside the tolerance for
  /// transcription.
  std::size_t fftSize = 1024;
  std::size_t hop = 256;
  /// §3.3 (a)–(c). w, m and δ's fraction are the sheet's [I] choices, which
  /// V-4 brackets and does not confirm (§13 item 2). The 30 ms refractory is
  /// derived: a 1/32 note at 200 BPM is 37.5 ms.
  int peakWindow = 3;
  int meanMultiplier = 3;
  double deltaFraction = 0.15;
  /// Ours, and the corpus is what asked for it: condition (b) is also a
  /// ratio, `SF(m) ≥ meanRatio × background(m)`, alongside the sheet's margin.
  ///
  /// The sheet's condition (b) is `SF(m) ≥ mean(local) + δ` with
  /// `δ = 0.15 × median` over the whole file. Both terms are level-invariant,
  /// which was the point, and neither survives the dynamic range *inside* one
  /// file: in a quiet passage the local mean is near zero and δ is 15 % of a
  /// median the file's own silence dragged down, so the bar falls to nothing
  /// and a decaying note's ripple clears it. The melodic corpus returned 84
  /// onsets for 13 notes before this term existed.
  ///
  /// 4.0 is where F peaks on the corpus — 0.9147 at ±50 ms, against 0.8985 at
  /// 3.0 and 0.8967 at 5.0 — and the shape either side of it is gentle, which
  /// is what a value chosen on a threshold rather than fitted to a score looks
  /// like. It is [I] in the sheet's sense and V-4 brackets it, exactly as §13
  /// item 2 says of w, m and δ.
  ///
  /// Two other forms were tried and both fail, recorded because both are the
  /// obvious fix. A whole-file floor (some percentile of the flux) is a
  /// statistic of whatever the file mostly *is*, and a phrase of decaying
  /// notes is mostly decay: the melodic files' 90th percentile sat at 17
  /// against onsets at 100 and let all 84 through. A rise against the
  /// preceding frame fails because condition (a) has already made `sf[m − 1]`
  /// part of the same peak's rising flank — it rejected two thirds of the
  /// true onsets and kept the ripple, the exact inverse of its purpose.
  double meanRatio = 4.0;
  double refractoryMs = 30.0;
  /// §3.3's refinement measures a 1 ms RMS. The sheet's [I] choice.
  ///
  /// The sheet's companion figure — search back 20 ms — has no parameter here
  /// because the refinement no longer searches back over a window: the anchor
  /// is walked to the foot of its own climb, which is bounded by `riseSpanMs`
  /// and needs no second range. See `refineOnset`.
  double refineRmsMs = 1.0;
  /// Ours: the window the attack is FOUND with, as against `refineRmsMs`,
  /// which is the window its foot is PLACED with.
  ///
  /// One envelope cannot do both jobs, and V-5's lateness was the proof. A
  /// 1 ms RMS holds a third of a cycle of a 55 Hz kick, so its output swings
  /// once per cycle *inside a single event* — measured, with no neighbouring
  /// hit anywhere in the 30 ms behind it: 0.30, 0.46, 0.46, 0.19, 0.29, 0.54,
  /// 0.52, 0.27 through one attack. A walk over that stops at whichever trough
  /// the waveform happened to put there, which is why 36 of the 38 late
  /// detections had their label *inside* the flux frame the peak picker had
  /// already chosen correctly: the frame was right and the envelope could not
  /// resolve the attack within it.
  ///
  /// 5 ms spans a quarter cycle at 50 Hz and a whole cycle above 200, which is
  /// enough to average the swing away. Swept against the quantity V-5 exists
  /// to protect — attack energy lost — 3.5 ms gives 14 late and 11 losing more
  /// than 1 %; **5 ms gives 7 and 6**; 6 ms gives 10 and 9; 8 ms gives 9 and 8
  /// with the worst single loss rising to 53 %. Before this existed the
  /// figures were 38 late and 23 over 1 %.
  ///
  /// The cost is a wider early bias, because a longer window reports a rise as
  /// soon as the attack enters it. That is the direction §3.3 says to err in
  /// and the one V-5's tolerance column does not fail the build over. [I],
  /// bracketed by V-5.
  double coarseRmsMs = 5.0;
  /// Ours: the baseline distance the anchor's rise is measured over.
  ///
  /// Long enough to span a cycle of low material, so that a 1 ms RMS window's
  /// beating against a 60 Hz waveform does not choose the anchor; short
  /// enough not to bias it late, because the rise measured over a long
  /// baseline keeps growing well past the onset and its maximum then sits
  /// inside the attack. Measured across the corpus, the anchor's median error
  /// runs +0.75 ms at 2 ms, +1.59 at 5, +3.23 at 10 and +3.96 at 20. Two
  /// milliseconds is the least biased and still spans a 500 Hz cycle; below
  /// the octave where that matters, the foot rule below is what carries it.
  /// [I], bracketed by V-5.
  double riseSpanMs = 2.0;
  /// Ours: how far back the anchor may be walked to the foot of its own
  /// attack. 30 ms is the longest attack this importer treats as an onset —
  /// past it a sound is a swell — and it is the same figure §3.3's refractory
  /// period uses to decide two events are one. See `refineOnset`. [I],
  /// bracketed by V-5.
  double attackSpanMs = 30.0;
};

struct Onset {
  /// Flux frame index, and the absolute sample that frame starts on.
  std::size_t frame = 0;
  std::size_t frameStart = 0;
  /// Where the refinement searched back from.
  std::size_t anchor = 0;
  /// The refined, sample-accurate onset. Absolute, like every span.
  std::size_t sample = 0;
  double flux = 0.0;
};

struct OnsetResult {
  std::vector<double> flux;
  double medianFlux = 0.0;
  double delta = 0.0;
  std::vector<Onset> onsets;
  std::size_t begin = 0;
  std::size_t end = 0;
};

/// SF(m) = Σ_k H(|X(m,k)| − |X(m−1,k)|), H(x) = (x + |x|)/2, over [begin, end).
/// Frame m starts at begin + m·hop; the tail is zero-padded so an onset in the
/// last window is seen. Frame 0 is compared against silence, so a file whose
/// first sound is already under way at its start gets an onset there, which
/// is what a slice map of a truncated loop needs.
inline std::vector<double> spectralFlux(const std::vector<double>& x, std::size_t begin,
                                        std::size_t end, const OnsetOptions& o) {
  std::vector<double> flux;
  const std::size_t n = o.fftSize;
  const std::size_t hop = o.hop;
  if (end > x.size()) end = x.size();
  if (begin >= end || n < 2 || hop == 0 || !isPowerOfTwo(n)) return flux;
  const std::size_t frames = (end - begin + hop - 1) / hop;
  std::vector<double> w(n), re(n), im(n), prev(n / 2 + 1, 0.0), mag(n / 2 + 1, 0.0);
  hann(w);
  flux.resize(frames);
  for (std::size_t m = 0; m < frames; ++m) {
    const std::size_t s = begin + m * hop;
    for (std::size_t i = 0; i < n; ++i) {
      re[i] = s + i < end ? x[s + i] * w[i] : 0.0;
      im[i] = 0.0;
    }
    fft(re, im);
    double sum = 0.0;
    for (std::size_t k = 0; k <= n / 2; ++k) {
      mag[k] = std::sqrt(re[k] * re[k] + im[k] * im[k]);
      const double d = mag[k] - prev[k];
      sum += 0.5 * (d + std::fabs(d));
    }
    flux[m] = sum;
    prev.swap(mag);
  }
  return flux;
}

/// §3.3's three conditions, in the sheet's order. Returns frame indices.
inline std::vector<std::size_t> pickPeaks(const std::vector<double>& sf, double rate,
                                          const OnsetOptions& o, double& medianOut,
                                          double& deltaOut) {
  std::vector<std::size_t> peaks;
  const long count = static_cast<long>(sf.size());
  if (count == 0) return peaks;
  medianOut = median(sf);
  deltaOut = o.deltaFraction * medianOut;
  const long w = std::max(0, o.peakWindow);
  const long mw = static_cast<long>(std::max(0, o.meanMultiplier)) * w;
  const double refractoryFrames = o.refractoryMs * 1.0e-3 * rate / static_cast<double>(o.hop);
  long last = -1;
  for (long m = 0; m < count; ++m) {
    const double v = sf[static_cast<std::size_t>(m)];
    // A flux of exactly zero is silence against silence, and a run of zeros
    // would otherwise satisfy (a) and (b) with δ = 0 at every frame.
    if (v <= 0.0) continue;
    bool isMax = true;
    for (long j = std::max(0L, m - w); j <= std::min(count - 1, m + w); ++j) {
      if (sf[static_cast<std::size_t>(j)] > v) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;
    double sum = 0.0;
    long members = 0;
    for (long j = std::max(0L, m - mw); j <= std::min(count - 1, m + w); ++j) {
      sum += sf[static_cast<std::size_t>(j)];
      ++members;
    }
    // The background the ratio is taken against: the same window with the
    // candidate's own lobe removed.
    //
    // The sheet's window contains frame m and the w frames either side — the
    // frames the candidate's own energy spreads into. That is right for a
    // margin, where δ is small and the self-contribution is a detail, and
    // wrong for a ratio, where the frame would be divided by a number it
    // largely produced. The corpus measures the difference: an isolated burst
    // in room tone scores 2.04 against the full window and 4.03 against the
    // background, and removing the lobe moved F from 0.877 to 0.899.
    //
    // A MEDIAN was tried here instead of a mean and is recorded because it
    // looks obviously right and is not. The case for it is real — the second
    // of two identical bursts 60 ms apart has a window whose mean (1051) is
    // almost entirely the *first* burst's peak, so the second scores 1.52 and
    // is rejected, while the median of the same frames sits near their 400
    // floor and scores it properly. But flux is spiky, so the median of any
    // such window is below its mean essentially always, not only in that
    // case: swapping it in dropped F from 0.899 to 0.780 by admitting decay
    // ripple everywhere, and `min(mean, median)` measured identically to the
    // median alone, which is what proved the median is not selectively lower.
    // The mean is kept, and the isolated-pair case is a known miss rather
    // than a fixed one — see the suite header.
    //
    // Two further forms were tried against that case and both cost more than
    // they buy, measured on the corpus:
    //
    //   Excluding the PREVIOUS accepted onset's lobe as well as the
    //   candidate's own. Arithmetically it does what it should: on the pair
    //   file the second burst's background falls from 1051 to 470 and its
    //   ratio rises from 1.52 to 3.41. It still misses, because `meanRatio`
    //   is 4.0, and lowering the threshold to admit 3.41 admits a great deal
    //   else — F(+-50 ms) 0.958 -> 0.936 at 3.5, 0.929 at 3.2, 0.915 at 3.0.
    //   Even at 4.0 the exclusion alone costs 0.958 -> 0.947, because taking
    //   frames out of the background lowers it everywhere and not only where
    //   a neighbouring hit is the problem.
    //
    //   A trailing background that skips everything within the refractory
    //   period of the previous onset. F(+-50 ms) 0.927, and it breaks the
    //   frame-grid row outright (9 of 20 refined onsets outside the window).
    //
    //   Excluding every frame that was ITSELF ACCEPTED as a peak, which is
    //   provenance rather than position: a frame the detector has already
    //   called an onset is a different event's peak by its own verdict, and a
    //   window with no neighbouring onset is untouched. It is the form this
    //   comment's last paragraph asks for and it does not work either --
    //   F(+-50 ms) 0.958 -> 0.947 with precision 0.936, because onsets are
    //   dense over most of the corpus so the exclusion fires almost
    //   everywhere, and the pair file still misses: its second burst reaches
    //   3.41 against a bar of 4.0, exactly as the lobe exclusion did.
    //
    // The pair case needs the background to know that one frame in its window
    // is a *different event's peak* rather than a loud sample of the same
    // background. Provenance expresses that and still does not fix it: the
    // ratio the second burst can reach is set by the room tone the first burst
    // decays onto, and 3.41 is what that tone allows. Admitting it means
    // lowering `meanRatio` for every file, which costs more than this case is
    // worth. Left as a known miss.
    double bgSum = 0.0;
    long bgMembers = 0;
    for (long j = std::max(0L, m - mw); j <= std::min(count - 1, m + w); ++j) {
      if (j >= m - w && j <= m + w) continue;
      bgSum += sf[static_cast<std::size_t>(j)];
      ++bgMembers;
    }
    // An empty window is the first frames of a file, where there is nothing
    // behind the candidate to compare it to. The ratio is withdrawn there
    // rather than evaluated against zero, and the sheet's margin stands alone.
    const double background = bgMembers > 0 ? bgSum / static_cast<double>(bgMembers) : 0.0;
    const double localMean = sum / static_cast<double>(members);
    if (v < localMean + deltaOut) continue;
    if (background > 0.0 && v < o.meanRatio * background) continue;
    if (last >= 0 && static_cast<double>(m - last) < refractoryFrames) continue;
    peaks.push_back(static_cast<std::size_t>(m));
    last = m;
  }
  return peaks;
}

/// The whole of §3.3 over [begin, end) of a conditioned signal.
inline OnsetResult detectOnsets(const std::vector<double>& x, std::size_t begin, std::size_t end,
                                double rate, double noiseFloorAmp, const OnsetOptions& o) {
  OnsetResult r;
  r.begin = begin;
  r.end = std::min(end, x.size());
  if (r.begin >= r.end) return r;
  r.flux = spectralFlux(x, r.begin, r.end, o);
  const std::vector<std::size_t> peaks = pickPeaks(r.flux, rate, o, r.medianFlux, r.delta);
  const std::size_t w1 = framesFor(o.refineRmsMs, rate);
  const std::vector<double> env = slidingRms(x, w1);
  // A second, longer envelope for finding the attack. See `refineOnset`.
  const std::size_t wCoarse = framesFor(o.coarseRmsMs, rate);
  const std::vector<double> coarse = slidingRms(x, wCoarse);
  for (std::size_t m : peaks) {
    Onset on;
    on.frame = m;
    on.frameStart = r.begin + m * o.hop;
    on.flux = r.flux[m];
    on.sample = refineOnset(x, env, coarse, w1, on.frameStart,
                            std::min(on.frameStart + o.fftSize, r.end), r.begin, noiseFloorAmp,
                            framesFor(o.riseSpanMs, rate), framesFor(o.attackSpanMs, rate),
                            wCoarse, on.anchor);
    // Two frames that refine to the same attack are one event; a slice of
    // zero length would otherwise sit between them.
    if (!r.onsets.empty() && on.sample <= r.onsets.back().sample) continue;
    r.onsets.push_back(on);
  }
  return r;
}

}  // namespace mw::dsp::sample
