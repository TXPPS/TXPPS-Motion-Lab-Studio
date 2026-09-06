// Motion Wave — placing an onset on the sample it happens at. `smp-01` §3.3's
// refinement step, split from `onset.h` because it is a subject of its own:
// that file decides WHICH frames hold onsets, this one decides where inside a
// frame the onset is.
//
// **Where this departs from the sheet's wording.** The
// sheet says to search backwards from the frame centre. Derived here: for a
// burst that decays faster than the window, the flux peaks when the onset sits
// at the window's steepest falling slope, three-quarters of the way in, so the
// peak frame's *centre* is N/4 — 5.8 ms at 44.1 kHz — before the onset. A
// search that starts there begins in the silence in front of the attack, the
// first quiet millisecond it finds is that silence, and the onset is placed up
// to 6 ms early, outside V-5's 2 ms. So the anchor is the millisecond of
// steepest rise in the 1 ms RMS envelope inside the peak frame's span — which
// is the attack itself, and is inside the frame at every rate because the
// frame contains the onset with at least N/8 of margin either side. From
// there: back over 20 ms for the foot of the attack, then back again to a
// zero crossing. Early is allowed; late is not, and that asymmetry is why the
// crossing search runs backwards where the sheet says forwards — see below.
//
// The quiet point is referred to the attack, not to the noise floor. "The
// local minimum of 1 ms RMS over 20 ms" is, in front of an onset, a
// measurement of silence: every millisecond there is within a few dB of every
// other, so the deepest one is wherever the floor's own scatter fell and the
// onset lands up to 20 ms early. A band measured *down from the anchor*
// instead asks the question the rule is for — where has the attack not yet
// started — and answers it the same way whether the silence in front is at
// −60 dBFS or −90. Referred to the floor, the corpus came out 3 to 9 ms
// early with the anchor itself on the label to a tenth of a millisecond.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <vector>

#include "measure.h"

namespace mw::dsp::sample {

/// How far above the measured noise floor a millisecond still counts as part
/// of an attack.
///
/// Four rather than two, and the difference is a units mismatch worth naming.
/// §3.2's noise floor is the 10th percentile of 20 ms RMS frames; the walk
/// reads a sliding 1 ms RMS. On the same stationary tone the 1 ms figure runs
/// about 3.7 times the 20 ms percentile — 0.019 against 0.0051 on the
/// frame-grid file — because a short window fluctuates upward far more than a
/// long one and a low percentile deliberately sits under the fluctuation. A
/// factor of two therefore never fired, and the walk went on into the tone.
/// Four clears the mismatch with margin and is still 20 dB below the 0.5 an
/// attack reaches there, so it stops in the tone and never inside a hit.
inline constexpr double kFloorStopFactor = 4.0;

/**
 * The sample an onset in the frame [frameStart, frameEnd) lands on. `env` is
 * the file's sliding 1 ms RMS (`slidingRms(x, w1)`), so env[n] describes
 * [n, n + w1). `floorAmp` keeps the rise measurement finite on digital silence.
 */
inline std::size_t refineOnset(const std::vector<double>& x, const std::vector<double>& env,
                               const std::vector<double>& coarse, std::size_t w1,
                               std::size_t frameStart, std::size_t frameEnd, std::size_t spanBegin,
                               double floorAmp, std::size_t riseSpan, std::size_t attackSpan,
                               std::size_t coarseWindow, std::size_t& anchorOut) {
  const std::size_t envLen = env.size();
  if (envLen == 0 || frameStart >= envLen) {
    anchorOut = frameStart;
    return frameStart;
  }
  // The anchor: the millisecond of steepest rise, where the rise is measured
  // over `span` rather than over one window.
  //
  // The window stays at the sheet's 1 ms, because that is what sets how
  // precisely the foot can then be placed. What cannot stay at 1 ms is the
  // *baseline the rise is measured against*. A 1 ms window holds two thirds
  // of a cycle of a 60 Hz kick, so its output oscillates with where the
  // window sits inside the waveform — the corpus showed 0.33, 0.36, 0.40,
  // 0.30, 0.11, 0.27, 0.44 through what is a smooth attack — and the largest
  // one-window rise then lands on whichever later cycle the beating favoured,
  // up to 13 ms after the onset. A backward search cannot undo that: every
  // `footDb` from 12 to 40 dB traded those late detections for others 3 ms
  // early.
  //
  // Comparing against the level `span` earlier spans a whole cycle of
  // anything this importer resolves, so the comparison is between two
  // stretches of signal rather than between two points of one waveform. The
  // anchor it returns is a millisecond inside the attack, which is all the
  // foot search below needs; making `span` longer costs nothing there and
  // only ever moves the anchor later into a rise it has already found.
  const std::size_t hi = std::min(frameEnd, envLen);
  const double eps = std::max(floorAmp, 1.0e-9);
  const std::size_t span = std::max(w1, riseSpan);
  std::size_t anchor = frameStart;
  double bestRise = -1.0e300;
  for (std::size_t n = frameStart; n < hi; ++n) {
    const double before = n >= span ? coarse[n - span] : 0.0;
    const double rise = std::log(coarse[n] + eps) - std::log(before + eps);
    if (rise > bestRise) {
      bestRise = rise;
      anchor = n;
    }
  }
  // Walk the anchor back down its own rise, to the start of the climb the
  // steepest point belongs to.
  //
  // This is what makes the placement bound rather than merely usually right.
  // The steepest rise is somewhere *inside* an attack, never at its start,
  // and on a hit that lands over a sounding note there is no quiet point in
  // front to search back to — the level there is the previous sound. The
  // backward threshold search below then finds nothing, keeps the anchor, and
  // the detection is late: thirty of the corpus's remaining late detections
  // had a late anchor and not one had an early one, which is that fault and
  // no other. Following the envelope back while it is still descending ends
  // at the bottom of this attack's climb whatever is underneath it, so the
  // anchor is at or before the onset by construction rather than by
  // threshold. `span` bounds the walk: further back than the baseline the
  // rise was measured over is a different event.
  // The walk takes the minimum over the whole stretch rather than stopping at
  // the first sample that rises, because a 1 ms RMS of any real waveform is
  // not monotonic — it dips once per cycle — and a walk that stops at the
  // first dip stops a cycle into the attack. The earliest quietest point of
  // the climb is what "the start of this rise" means.
  // The walk is bounded by `attackSpan`, not by the rise baseline, and the
  // difference is the whole of V-5 on melodic material.
  //
  // `span` is how far apart two levels have to be to compare them; it says
  // nothing about how long an attack lasts. Bounding the walk by it meant the
  // walk could reach back 2 ms, so a note ramping over 3 ms had its start
  // outside the walk's reach and the detection stayed inside the attack: 20
  // of 27 late detections were on the five melodic files, against 5 on the
  // ten drum files, and 15 of them lost more than 1 % of the event's first
  // 20 ms of energy — one lost 37 %. That is the loss V-5 exists to forbid,
  // not a labelling artefact.
  //
  // 30 ms covers any attack this importer is asked to place — beyond it a
  // sound is a swell rather than an onset, and §3.3's own 30 ms refractory
  // period says the same thing from the other side. The walk stops at the
  // quietest point regardless, so a fast attack is unaffected by the wider
  // bound: there is nothing quieter behind a click.
  // The walk stops when the level stops falling, not at the quietest point in
  // the window, and both halves of that matter.
  //
  // Bounding by 2 ms left the start of a 3 ms ramp out of reach and 27
  // detections inside their own attacks. Taking the quietest point over 30 ms
  // instead put 217 of 289 more than 2 ms early, because past the foot of the
  // attack the window is silence and the quietest sample in silence is wherever
  // the noise fell. Neither is a threshold question: what is wanted is the
  // point where this attack began, and that is where the descent ends.
  //
  // So: walk back while the envelope keeps falling, tolerating the dips a 1 ms
  // RMS shows once per cycle by requiring a rise sustained over `riseSpan`
  // before stopping. The 30 ms bound is a backstop for material that never
  // stops falling, not the rule.
  //
  // The walk also stops at the noise floor, and that is the third thing it
  // needs. Room tone is monotonically quieter than any attack, so a walk that
  // only watches for the descent to end never ends inside it: once whole-file
  // tone was added to the test files — itself a fix, for a different fault —
  // the walk ran 2.5 to 4.5 ms past every attack into the tone behind it, and
  // eleven of twenty bursts landed outside V-5's window on the early side.
  // `floorAmp` is the noise floor §3.2 already measured, and a millisecond
  // that is at it is not part of an attack by definition.
  // Where there is no room behind the onset for the coarse window to have
  // seen anything but the attack, the coarse envelope is not usable and the
  // fine one is what there is.
  //
  // `slidingRms(x, W)[n]` covers [n, n + W), so the coarse level at a point
  // less than W after the file's first sound is already reading that sound.
  // The frame-grid file's head trim opens 12 samples before its first burst
  // against a 221-sample window: the coarse envelope climbs monotonically
  // backwards from the anchor there — 0.411, 0.430, 0.456, 0.463, 0.481 —
  // and any walk over it stops at once, leaving the foot 167 samples inside
  // the attack. The fine envelope has no such lead and shows the step
  // exactly, which is what makes it the right instrument in this one case.
  const bool coarseUsable = anchor >= spanBegin + coarseWindow;
  const std::vector<double>& walkEnv = coarseUsable ? coarse : env;
  const double floorStop = floorAmp * kFloorStopFactor;
  const std::size_t limit = anchor > frameStart + attackSpan ? anchor - attackSpan : frameStart;
  std::size_t foot = anchor;
  for (std::size_t n = anchor; n > limit; --n) {
    if (walkEnv[n - 1] <= floorStop) break;
    if (walkEnv[n - 1] <= walkEnv[foot]) {
      foot = n - 1;
      continue;
    }
    // Higher than the running foot: only a real turn if it stays higher over
    // a whole rise span, otherwise it is one cycle's dip and the walk goes on.
    bool sustained = true;
    for (std::size_t k = 1; k <= riseSpan && n > k; ++k) {
      if (walkEnv[n - k] <= walkEnv[foot]) {
        sustained = false;
        break;
      }
    }
    if (sustained) break;
  }
  // The coarse walk found WHICH millisecond the attack starts in; the fine
  // envelope says where inside it. A window long enough to average away a
  // 55 Hz waveform's own cycle is also long enough to smear the foot of a
  // click by half its length, so the last step re-minimises on the 1 ms
  // envelope over the coarse window's own span.
  //
  // The fine step resolves the coarse window's own uncertainty and nothing
  // wider. A sliding RMS of length W reports a rise from the moment the attack
  // enters its window, so the foot it names can be up to W early and is never
  // late; the attack therefore begins somewhere in [foot, foot + W]. Taking
  // the quietest fine millisecond in that interval walks to the last quiet
  // point before the energy arrives, which is the foot at 1 ms resolution.
  //
  // Searching a minimum over a window *centred* on the coarse foot was tried
  // and is wrong in both directions: backward-only pushed 276 of 300
  // detections more than 2 ms early, because the quietest point of a 3.5 ms
  // window is almost always earlier than the attack; symmetric let the search
  // fall into a trough inside the attack and made the worst late case worse.
  {
    const std::size_t allow = coarseUsable ? coarseWindow : 0;
    const std::size_t hiFine = std::min(foot + allow, envLen ? envLen - 1 : 0);
    std::size_t fine = foot;
    for (std::size_t n = foot; n <= hiFine && n < envLen; ++n) {
      if (env[n] <= env[fine]) fine = n;
    }
    foot = fine;
  }
  anchor = foot;
  anchorOut = anchor;
  // The foot of the attack: walking back from the anchor, the first
  // millisecond that is quiet relative to the anchor itself.
  //
  // Relative to the anchor, not to the window's own minimum, and that is the
  // correction. A band `plateauDb` above the minimum is a band above the
  // *noise floor* when the 20 ms before an onset is silence, so every
  // millisecond in front of the attack qualifies and "the latest one" is
  // whichever the floor's own scatter put last — the corpus placed onsets 3
  // to 9 ms early that way, with the anchor sitting on the label to a tenth
  // of a millisecond. Referred to the anchor the band means what it is for:
  // the point where the attack has not yet started, which is where the slice
  // must begin. Whatever the level of the silence in front of it.
  // The anchor is already the foot: it was walked back to the bottom of its
  // own climb above. A second backward search from it — the sheet's "search
  // back 20 ms for the local minimum" — would walk into whatever precedes the
  // attack and land there, which is what put 165 of the corpus's detections
  // more than 2 ms early while the anchor itself was correct. One placement
  // rule, applied once.
  const std::size_t p = anchor;
  // To a zero crossing — backwards, which is the direction the sheet's own
  // asymmetry requires even though it says forwards.
  //
  // Starting a slice mid-cycle puts a step at its start, so the crossing is
  // not optional; but the crossing *after* the foot is inside the attack by
  // as much as half a cycle, and at 60 Hz that is 8 ms of the transient gone.
  // The sheet's rule is "a slice may start early, never late", and only the
  // backwards search can promise it: forwards, the corpus produced late
  // detections on every file — small ones, a few samples, but late is the
  // one thing V-5 does not permit and a rule that holds by a tenth of a
  // millisecond is a rule that is about to stop holding.
  //
  // Bounded to `span`, the same distance the anchor's rise was measured over,
  // which is one cycle of anything this stage resolves. Narrower does not
  // work: at one millisecond a 60 Hz waveform frequently holds no crossing at
  // all, the search reports none, and the slice starts mid-cycle — six of
  // twenty-one on the corpus. Wider does not either: over a full 20 ms the
  // nearest crossing is not the one found and detections landed 42 ms early.
  // The foot itself is the answer when nothing crosses inside the span, which
  // is a DC-offset file that conditioning should already have corrected.
  const std::size_t floor = p > spanBegin + span ? p - span : spanBegin;
  const std::size_t back = zeroCrossingBackFrom(x, p, floor);
  return back > floor ? back : p;
}

}  // namespace mw::dsp::sample
