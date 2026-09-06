// Motion Wave — the Granular Delay's transport. `fx-03` §9 V7 to V10.
//
// Four rows about one thing: what happens to pitch when the read point moves.
// §6.2 derives it — an interpolating delay shifts pitch by `1 − D′(t)`, and a
// tape transport by `v(t) / v(t − D)`, which is stronger — and these rows are
// the derivation's consequences measured: no click when Digital mode moves the
// time (V7), the bend in Tape mode equal to the formula (V8), the wobble
// generator calibrated in the standard unit (V9), and the wobble's depth varying
// with delay time as `2a·sin(πfD)` (V10), which is the row that separates a
// transport from a delay-time LFO.
#include "../units/delay_transport.h"
#include "granular_delay_harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;
using namespace mw::test::fx03;

namespace {

/**
 * V7's session: a 1 kHz sine through one synced tap, with the division stepped
 * `changes` times at `everySamples` intervals, cycling every ordered pair of
 * divisions. Returns how many samples stepped by more than twelve decibels
 * over the un-modulated sine's own largest step.
 */
int flaggedSteps(delay::TimeChangeMode mode, int changes, int everySamples) {
  GranularDelay unit;
  configure(unit);
  unit.setSync(true);
  unit.setBpm(120.0);
  unit.setTimeChangeMode(mode);
  unit.reset();
  const Tone tone{1000.0, 0.5};
  // The un-modulated sine's largest step, exactly: `A · 2 sin(π f / fs)`.
  const double own = 0.5 * 2.0 * std::sin(kPi * 1000.0 / kRate);
  const double limit = own * 3.98107;  // +12 dB
  const int frames = changes * everySamples + everySamples;
  int pair = 0;
  int made = 0;
  int nextChangeAt = everySamples;
  const Rendered out = renderWith(unit, frames, tone, [&](int block) {
    // On schedule, at the first block boundary past each due time — the
    // interval need not be a whole number of blocks.
    if (made >= changes || block * kBlock < nextChangeAt) return;
    nextChangeAt += everySamples;
    // Every ordered pair (from, to) of the ten divisions, in sequence.
    const int from = pair / delay::kDivisionCount;
    const int to = pair % delay::kDivisionCount;
    pair = (pair + 1) % (delay::kDivisionCount * delay::kDivisionCount);
    TapSettings tap = unit.tap(0);
    tap.division = static_cast<delay::Division>(made % 2 == 0 ? from : to);
    unit.setTap(0, tap);
    ++made;
  });
  int flagged = 0;
  double worst = 0.0;
  for (std::size_t i = 1; i < out.left.size(); ++i) {
    const double step = std::fabs(static_cast<double>(out.left[i]) - static_cast<double>(out.left[i - 1]));
    worst = std::max(worst, step);
    if (step > limit) ++flagged;
  }
  std::printf("    V7: %d change(s) every %d samples — worst step %.4f against a limit of %.4f"
              " (own %.4f), %d flagged\n",
              made, everySamples, worst, limit, own, flagged);
  return flagged;
}

}  // namespace

MW_TEST("V7: Digital mode steps between every pair of divisions without a click") {
  /*
   * §9 V7: step the delay time between every pair of divisions, five hundred
   * times, over a 1 kHz sine; flag any sample whose first difference exceeds
   * the un-modulated sine's by more than 12 dB; require none. Every sixty
   * milliseconds, which is longer than the 20 ms fade — the fast case is below.
   */
  MW_EXPECT_EQ(flaggedSteps(delay::TimeChangeMode::Digital, 500, 2880), 0);
}

MW_TEST("V7: Instant mode does click, which is what makes the row a measurement") {
  // The same session with the hard jump. Two reads of a 1 kHz sine a fraction
  // of a cycle apart differ by up to the whole amplitude, and the row that
  // could not see that would not be seeing anything.
  MW_EXPECT(flaggedSteps(delay::TimeChangeMode::Instant, 500, 2880) > 0);
}

MW_TEST("V7: a change every block, faster than the fade, is still click-free") {
  /*
   * A knob sends a change per block, every 5.3 ms, and the fade takes 20 ms.
   * The first version of the transport restarted the fade on each change,
   * which put head A back at full gain in one sample — one click per block for
   * as long as the knob moved. A change that lands mid-fade now waits its turn.
   */
  MW_EXPECT_EQ(flaggedSteps(delay::TimeChangeMode::Digital, 500, kBlock), 0);
}

MW_TEST("V8: in Tape mode the pitch follows 1000·(1 − D′), and settles back to unity") {
  /*
   * §9 V8: Tape mode, ramp the delay from 500 ms to 250 ms over one second with
   * a 1 kHz sine, track the instantaneous output frequency, and require it to
   * match `1000 · (1 − D′(t))` within two cents.
   *
   * `D` is read from the unit at every block boundary — the delivered time,
   * after the transport — and the output's phase is read off its zero
   * crossings at the same instants, so each window compares a frequency the
   * audio actually has against the derivative of a delay the unit actually
   * reported. The two agree only if the audio is read at the position the
   * transport publishes, which is the "one evaluation" rule as a measurement.
   *
   * Two more things the row checks that the formula alone would not: that a
   * bend happened at all — a transport that jumped would match the formula
   * trivially, with `D′` a single spike the windows never see — and that once
   * the speed settles the ratio is unity again while the delay has arrived
   * where it was sent. §6.2's first consequence is that a constant speed error
   * produces no pitch shift, and the settled state is exactly that error.
   */
  GranularDelay unit;
  configure(unit);
  TapSettings tap = unit.tap(0);
  tap.delaySeconds = 0.500;
  unit.setTap(0, tap);
  unit.setTimeChangeMode(delay::TimeChangeMode::Tape);
  unit.reset();

  constexpr int kSettle = 48000;       // buffer full, transport at rest
  constexpr int kRamp = 48000;         // the one-second ramp
  constexpr int kAfter = 4 * 48000;    // the slew's tail, then the settled state
  constexpr int kFrames = kSettle + kRamp + kAfter;
  const Tone tone{1000.0, 0.5};
  std::vector<double> delivered;       // D at the end of each block, in samples
  std::vector<double> published;       // the frame's pitch ratio per block
  const Rendered out = renderWith(unit, kFrames, tone, [&](int block) {
    const int at = block * kBlock;
    if (at >= kSettle && at <= kSettle + kRamp) {
      // Through the ramp one block at a time, and the last step lands exactly
      // on 250 ms: a ramp that stopped a block short would send 251.3 ms, and
      // the transport would arrive there — to a tenth of a sample — and the
      // row would read it as the transport being wrong.
      const double through = std::min(1.0, static_cast<double>(at - kSettle) / kRamp);
      TapSettings t = unit.tap(0);
      t.delaySeconds = 0.500 - 0.250 * through;
      unit.setTap(0, t);
    }
    if (block > 0) {
      delivered.push_back(unit.deliveredTapSeconds(0) * kRate);
      published.push_back(static_cast<double>(unit.frame().pitchRatio));
    }
  });
  // The last block's reading, which the callback cannot see.
  delivered.push_back(unit.deliveredTapSeconds(0) * kRate);
  published.push_back(static_cast<double>(unit.frame().pitchRatio));

  const std::vector<double> crossings =
      risingCrossings(out.left, static_cast<std::size_t>(kBlock), out.left.size());
  MW_EXPECT(crossings.size() > 1000);

  // Twenty-millisecond windows, four blocks each, across the ramp and its tail.
  constexpr int kWindowBlocks = 4;
  double worstCents = 0.0;
  double deepestCents = 0.0;
  double worstAgainstPublished = 0.0;
  int windows = 0;
  const int firstBlock = kSettle / kBlock;
  const int lastBlock = (kSettle + kRamp + 2 * 48000) / kBlock;
  for (int b = firstBlock; b + kWindowBlocks <= lastBlock; b += kWindowBlocks) {
    // Block `b` ends at sample `(b + 1) * kBlock - 1`; `delivered[b]` is D there.
    const double n0 = static_cast<double>((b + 1) * kBlock - 1);
    const double n1 = static_cast<double>((b + kWindowBlocks + 1) * kBlock - 1);
    const double d0 = delivered[static_cast<std::size_t>(b)];
    const double d1 = delivered[static_cast<std::size_t>(b + kWindowBlocks)];
    const double predicted = 1000.0 * (1.0 - (d1 - d0) / (n1 - n0));
    const double cycles = phaseCyclesAt(crossings, n1) - phaseCyclesAt(crossings, n0);
    const double measured = cycles * kRate / (n1 - n0);
    const double cents = 1200.0 * std::log2(measured / predicted);
    worstCents = std::max(worstCents, std::fabs(cents));
    deepestCents = std::max(deepestCents, std::fabs(1200.0 * std::log2(measured / 1000.0)));
    // The published ratio, averaged over the window, against the audio.
    double ratio = 0.0;
    for (int k = 1; k <= kWindowBlocks; ++k) ratio += published[static_cast<std::size_t>(b + k)];
    ratio /= kWindowBlocks;
    worstAgainstPublished =
        std::max(worstAgainstPublished, std::fabs(1200.0 * std::log2(measured / (1000.0 * ratio))));
    ++windows;
  }
  const double settledDelay = delivered.back();
  const double settledRatio = published.back();
  std::printf("    V8: %d window(s) — worst %.3f cents from 1000·(1 − D′), %.3f cents from the"
              " published ratio; deepest bend %.0f cents; settled at %.2f samples, ratio %.6f\n",
              windows, worstCents, worstAgainstPublished, deepestCents, settledDelay, settledRatio);
  MW_EXPECT(worstCents <= 2.0);
  MW_EXPECT(worstAgainstPublished <= 2.0);
  // A ramp from 500 to 250 ms over a second on a 250 ms slew is a bend of
  // hundreds of cents; a transport that had not bent would read zero here.
  MW_EXPECT(deepestCents > 100.0);
  // And it arrives: within a quarter of a percent of 250 ms, at unity pitch.
  MW_EXPECT_NEAR(settledDelay, 0.250 * kRate, 0.0025 * 0.250 * kRate);
  MW_EXPECT_NEAR(settledRatio, 1.0, 1.0e-4);
}

MW_TEST("V9: each wear preset's weighted wow and flutter is its nominal figure") {
  /*
   * §9 V9: for each depth preset, demodulate a 3.15 kHz tone, apply the
   * CCIR / IEC 386 weighting — peak at 4 Hz, 6 dB per octave either side — and
   * require the weighted RMS within ±15 % of the nominal.
   *
   * What is weighted is the transport's own speed deviation `ε`, which is what
   * a wow-and-flutter meter measures: a tone recorded at constant speed and
   * played back through the wobbling transport, so the deviation heard is the
   * playback's alone. A delay's *output* carries `ε(t) − ε(t − D)` instead —
   * both heads share the motor — and that figure depends on the delay time in
   * the way V10 grades, so grading the preset through the output would be
   * grading `2a·sin(πfD)` and not the preset. Demodulating a tone whose phase
   * is the integral of `1 + ε` returns `ε` exactly, so the tone is not
   * synthesised only to be undone.
   *
   * The weighting is a second-order bandpass at 4 Hz with Q of a half, whose
   * skirts are the curve's 6 dB per octave and whose peak is one: it reads
   * 0.313 at 1.2 Hz and 0.258 at 16 Hz against the asymptotes' 0.30 and
   * 0.25, which is the rounding a real weighting network has at its knee. It
   * runs on `ε` decimated by 64, because `ε` holds nothing above 30 Hz and a
   * biquad at 4 Hz is far better conditioned at 750 Hz than at 48 kHz.
   */
  const delay::Wear presets[3] = {delay::Wear::Studio, delay::Wear::Vintage, delay::Wear::Worn};
  const char* names[3] = {"Studio", "Vintage", "Worn"};
  constexpr int kDecimate = 64;
  constexpr double kSlowRate = kRate / kDecimate;
  constexpr int kSeconds = 30;
  for (int p = 0; p < 3; ++p) {
    delay::WowFlutter wow;
    wow.prepare(kRate, 0x5EEDF00DCAFEBABEull);
    wow.setWear(presets[p]);
    dsp::Biquad weighting;
    weighting.setCoeffs(dsp::bandpassCoeffs(4.0, 0.5, kSlowRate));
    double weightedSum = 0.0;
    double unweightedSum = 0.0;
    long long counted = 0;
    const long long total = static_cast<long long>(kSeconds) * static_cast<long long>(kRate);
    for (long long n = 0; n < total; ++n) {
      const double epsilon = wow.next();
      if (n % kDecimate != 0) continue;
      const double weighted = weighting.process(epsilon);
      // The first two seconds settle the filter and are not the measurement.
      if (n < 2 * static_cast<long long>(kRate)) continue;
      weightedSum += weighted * weighted;
      unweightedSum += epsilon * epsilon;
      ++counted;
    }
    const double wrms = std::sqrt(weightedSum / static_cast<double>(counted));
    const double rms = std::sqrt(unweightedSum / static_cast<double>(counted));
    const double nominal = delay::nominalWrmsFor(presets[p]);
    std::printf("    V9: %-8s WRMS %.4f %% against a nominal %.4f %% (%+.1f %%); unweighted %.4f %%\n",
                names[p], 100.0 * wrms, 100.0 * nominal, 100.0 * (wrms / nominal - 1.0), 100.0 * rms);
    MW_EXPECT_NEAR(wrms, nominal, 0.15 * nominal);
  }
  // Clean is exactly zero, so a plain tap on tape never wobbles by accident.
  delay::WowFlutter clean;
  clean.prepare(kRate, 1u);
  clean.setWear(delay::Wear::Clean);
  double any = 0.0;
  for (int n = 0; n < 48000; ++n) any = std::max(any, std::fabs(clean.next()));
  MW_EXPECT_NEAR(any, 0.0, 0.0);
}

MW_TEST("V10: the wobble's depth follows 2a·sin(πfD), which a delay-time LFO cannot do") {
  /*
   * §9 V10: wow at 1 Hz and a fixed depth; sweep the delay from 0.1 s to 2.0 s
   * and measure the pitch-deviation amplitude at each. §6.2's second
   * consequence says it follows `2a·sin(πfD)` — zero where `f·D` is an integer,
   * greatest where it is a half — and the tolerance is ten percent of the
   * curve, read as ten percent of its peak so the nulls are held to something.
   *
   * The transport is driven directly with a pure sine for `ε`, because the
   * row is about the recursion and the generator has noise and flutter on top
   * that would blur a null. The unit's wiring of the generator into every
   * head is the case after this one.
   */
  constexpr double kDepth = 0.005;
  constexpr double kWowHz = 1.0;
  const double delays[9] = {0.1, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0};
  double worstError = 0.0;
  for (double seconds : delays) {
    delay::TapTransport transport;
    transport.prepare(kRate, 8.0);
    transport.reset(seconds * kRate);
    transport.setMode(delay::TimeChangeMode::Tape);
    // Four seconds for the history behind the longest delay to fill with the
    // wobble, then two seconds — two whole wow cycles — of measurement.
    const int settle = 4 * 48000;
    const int measure = 2 * 48000;
    double deviation = 0.0;
    for (int n = 0; n < settle + measure; ++n) {
      const double epsilon = kDepth * std::sin(2.0 * kPi * kWowHz * static_cast<double>(n) / kRate);
      transport.advance(epsilon);
      if (n >= settle) deviation = std::max(deviation, std::fabs(transport.pitchRatio() - 1.0));
    }
    const double predicted = 2.0 * kDepth * std::fabs(std::sin(kPi * kWowHz * seconds));
    const double error = std::fabs(deviation - predicted) / (2.0 * kDepth);
    worstError = std::max(worstError, error);
    std::printf("    V10: D = %.2f s — deviation %.5f against %.5f predicted (%+.1f %% of the peak)\n",
                seconds, deviation, predicted, 100.0 * (deviation - predicted) / (2.0 * kDepth));
    MW_EXPECT(error <= 0.10);
  }
  std::printf("    V10: worst departure from 2a·sin(πfD) is %.1f %% of the peak\n", 100.0 * worstError);
}

MW_TEST("V10: the unit wires one wobble into every head, and the wow's null survives the trip") {
  /*
   * Through the whole unit this time, on the Vintage preset, whose wow is a
   * 1.2 Hz sine. A delay of 5/6 s puts `f·D` at one, where §6.2 says the sine
   * contributes nothing to the pitch; 5/12 s puts it at a half, the peak. The
   * 1.2 Hz line in the published pitch ratio has to be far smaller at the null
   * than at the peak — the bands and the drift are broadband and do not null,
   * which is why the row reads the line rather than the whole excursion, and
   * why a delay-time LFO would read the same line at both delays.
   */
  auto wowLineAt = [](double seconds) {
    GranularDelay unit;
    configure(unit);
    TapSettings tap = unit.tap(0);
    tap.delaySeconds = seconds;
    unit.setTap(0, tap);
    unit.setCharacter(delay::Character::Tape);
    unit.setWear(delay::Wear::Vintage);
    unit.reset();
    std::vector<float> trace;
    const Tone tone{440.0, 0.3};
    renderWith(unit, 9 * 48000, tone, [&](int block) {
      if (block * kBlock >= 48000) {
        trace.push_back(static_cast<float>(unit.frame().pitchRatio - 1.0f));
      }
    });
    // The trace runs at the block rate; eight seconds of it resolves 1.2 Hz
    // from the bands either side to an eighth of a hertz.
    const double blockRate = kRate / kBlock;
    return toneLevelDb(trace, 1.2, blockRate, 0, trace.size());
  };
  const double atPeak = wowLineAt(5.0 / 12.0);
  const double atNull = wowLineAt(5.0 / 6.0);
  std::printf("    V10: the 1.2 Hz wow line in the pitch ratio reads %.1f dB at 417 ms (peak)"
              " and %.1f dB at 833 ms (null)\n",
              atPeak, atNull);
  MW_EXPECT(atPeak > -60.0);
  MW_EXPECT(atNull < atPeak - 14.0);
  // And with no wear at all the ratio is exactly one: nothing wobbles a tap
  // that was not asked to.
  GranularDelay clean;
  configure(clean);
  clean.setCharacter(delay::Character::Tape);
  clean.setWear(delay::Wear::Clean);
  clean.reset();
  double worst = 0.0;
  renderWith(clean, 48000, Tone{440.0, 0.3}, [&](int block) {
    if (block > 0) worst = std::max(worst, std::fabs(static_cast<double>(clean.frame().pitchRatio) - 1.0));
  });
  MW_EXPECT_NEAR(worst, 0.0, 0.0);
}

MW_TEST_MAIN("granular-delay-transport")
