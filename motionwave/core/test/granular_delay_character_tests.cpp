// Motion Wave — the Granular Delay's medium. `fx-03` §9 V11 and V12, and the
// tape half's stated behaviours.
//
// §8 calls the coupling of bandwidth to delay time "the single most
// recognisable analogue-delay behaviour", and it is a derived number on both
// media: a bucket-brigade's clock is `N / (2D)` and its filters sit at a third
// of it; a tape head's gap loss nulls at `v / g` and slowing the tape for a
// longer delay moves that null down. So the rows here measure the wet path's
// corner at several delays and ask whether it moved by the formula, and then
// ask what the sampled line folds back into the band.
#include "../units/delay_character.h"
#include "granular_delay_harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;
using namespace mw::test::fx03;

namespace {

/// A unit with one tap on the medium, and nothing else in the way.
void onMedium(GranularDelay& unit, delay::Character character, delay::Quality quality,
              double seconds, double bias = 0.3, double age = 0.2) {
  configure(unit);
  TapSettings tap = unit.tap(0);
  tap.delaySeconds = seconds;
  unit.setTap(0, tap);
  unit.setCharacter(character);
  unit.setQuality(quality);
  unit.setBbdStages(2);  // 4096
  unit.setBias(bias);
  unit.setAge(age);
  unit.reset();
}

/**
 * The wet path's gain at `hz` for one setting, in decibels against the input.
 *
 * A tone at −20 dBFS, which sits near the compander's own reference so the
 * pair's round trip is unity and the number measured is the filters'. The
 * last half second of a second and a half is measured, after the tap has
 * arrived and every envelope has settled.
 */
double wetGainDb(delay::Character character, delay::Quality quality, double seconds, double hz,
                 double bias = 0.3, double age = 0.2) {
  GranularDelay unit;
  onMedium(unit, character, quality, seconds, bias, age);
  const Tone tone{hz, 0.1};
  const Rendered out = render(unit, 72000, tone);
  return toneLevelDb(out.left, hz, kRate, 48000, 24000) - dbOf(0.1);
}

/// Bisect for the frequency at which the wet path is 3 dB down.
double minusThreeDbHz(delay::Character character, delay::Quality quality, double seconds,
                      double bias = 0.3, double age = 0.2) {
  double low = 200.0;
  double high = 20000.0;
  const double reference = wetGainDb(character, quality, seconds, low, bias, age);
  for (int step = 0; step < 14; ++step) {
    const double mid = std::sqrt(low * high);
    const double gain = wetGainDb(character, quality, seconds, mid, bias, age) - reference;
    if (gain > -3.0) low = mid;
    else high = mid;
  }
  return std::sqrt(low * high);
}

}  // namespace

MW_TEST("V11: a bucket-brigade's bandwidth tracks a third of the clock the delay needs") {
  /*
   * §9 V11: Character = BBD, 4096 stages; delay 50, 150 and 300 ms; measure the
   * wet path's −3 dB point and require it to track `f_clk / 3` with
   * `f_clk = N / (2D)` — about 13.7 kHz, 4.6 kHz and 2.3 kHz — within ±15 %.
   *
   * The wet path is an eighth-order filter into the line and a fourth-order
   * one out of it, both at the corner, so the cascade is three decibels down a
   * little below the corner itself — at 0.93 of it for a Butterworth pair of
   * those orders — and the bucket hold's own sinc droop, 1.65 dB at a third of
   * the clock, takes the −3 dB point to about 0.87 of the corner where the hold
   * runs. At 50 ms the clock is past three quarters of the host rate and the
   * hold stands down, so only the filters' 0.93 is seen there. Both are inside
   * the tolerance and are the numbers the row expects, not discrepancies to
   * explain away.
   */
  const double delays[3] = {0.050, 0.150, 0.300};
  for (double seconds : delays) {
    const double corner = delay::bbdClockHzFor(4096, seconds) / 3.0;
    const double measured = minusThreeDbHz(delay::Character::Bbd, delay::Quality::Normal, seconds);
    std::printf("    V11: %.0f ms — −3 dB at %.0f Hz against f_clk/3 = %.0f Hz (%+.1f %%)\n",
                1000.0 * seconds, measured, corner, 100.0 * (measured / corner - 1.0));
    MW_EXPECT_NEAR(measured, corner, 0.15 * corner);
  }
}

MW_TEST("V11: the tape head's gap loss moves down with the delay, and Age darkens it further") {
  /*
   * §6.3's coupling on the other medium. The gap-loss null is 25 kHz at 100 ms
   * and scales as `1/D`, with −3 dB at 0.443 of the null: about 11 kHz at
   * 100 ms and 3.7 kHz at 300 ms. The gap width is ours (§11), so the row
   * grades the *relation* — the corner at 300 ms is a third of the corner at
   * 100 ms — rather than a number nobody measured on a machine.
   */
  // Bias and age each add a one-pole above the gap loss and would fold their
  // own corners into the ratio, so they are at zero for this measurement.
  const double at100 = minusThreeDbHz(delay::Character::Tape, delay::Quality::Normal, 0.100, 0.0, 0.0);
  const double at300 = minusThreeDbHz(delay::Character::Tape, delay::Quality::Normal, 0.300, 0.0, 0.0);
  std::printf("    V11: tape −3 dB at %.0f Hz for 100 ms and %.0f Hz for 300 ms (ratio %.2f)\n",
              at100, at300, at100 / at300);
  MW_EXPECT_NEAR(at100 / at300, 3.0, 0.45);
  // Old tape: the one-pole at 4 kHz takes over from the gap loss.
  GranularDelay unit;
  onMedium(unit, delay::Character::Tape, delay::Quality::Normal, 0.100);
  unit.setAge(1.0);
  unit.reset();
  const Tone probe{8000.0, 0.1};
  const Rendered out = render(unit, 72000, probe);
  const double worn = toneLevelDb(out.left, 8000.0, kRate, 48000, 24000) - dbOf(0.1);
  const double fresh = wetGainDb(delay::Character::Tape, delay::Quality::Normal, 0.100, 8000.0);
  std::printf("    V11: 8 kHz through 100 ms of tape: %.1f dB new, %.1f dB worn\n", fresh, worn);
  MW_EXPECT(worn < fresh - 4.0);
}

MW_TEST("V12: the sampled line folds nothing above −60 dBFS back into the band") {
  /*
   * §9 V12: BBD at 300 ms with a 5 kHz sine at −6 dBFS; alias products at or
   * under −60 dBFS, +3 dB tolerance. At 300 ms the clock is 6.83 kHz, so the
   * products of a 5 kHz tone sit at 1.83 kHz and 8.65 kHz — the first of them
   * squarely in the pass band. The input filter has to have removed the tone
   * before the line samples it, which is why it is eighth order: 5 kHz is 1.14
   * octaves above the corner and eight poles are what buy 55 dB there.
   *
   * Measured two ways. The named products, by Goertzel; and everything that is
   * not the carrier, as the residual after the carrier's own line is taken
   * out, so a product at a frequency the arithmetic did not predict is caught
   * too. The residual carries the line's noise floor and clock whine as well —
   * −72 and −78 dBFS by design — which is why the bound is a bound and not a
   * second measurement of the same thing.
   */
  auto floorAt = [](double seconds, delay::Quality quality, double clockHz) {
    GranularDelay unit;
    onMedium(unit, delay::Character::Bbd, quality, seconds);
    const Tone tone{5000.0, 0.5};
    const Rendered out = render(unit, 96000, tone);
    const std::size_t from = 48000;
    const std::size_t count = 48000;  // five thousand whole cycles of 5 kHz
    const double carrier = toneLevelDb(out.left, 5000.0, kRate, from, count);
    double worstProduct = -240.0;
    double worstHz = 0.0;
    for (int k = 1; k <= 4; ++k) {
      const double lower = std::fabs(k * clockHz - 5000.0);
      const double upper = k * clockHz + 5000.0;
      for (double hz : {lower, upper}) {
        // Folded onto the host's own band, since that is where it would land.
        double f = std::fmod(hz, kRate);
        if (f > kRate / 2.0) f = kRate - f;
        if (f < 50.0 || f > 20000.0) continue;
        const double level = toneLevelDb(out.left, f, kRate, from, count);
        if (level > worstProduct) {
          worstProduct = level;
          worstHz = f;
        }
      }
    }
    // The residual: project the carrier out and take what is left. Whole
    // cycles, so the projection is exact.
    double sinSum = 0.0;
    double cosSum = 0.0;
    for (std::size_t i = 0; i < count; ++i) {
      const double phase = 2.0 * kPi * 5000.0 * static_cast<double>(i) / kRate;
      const double x = static_cast<double>(out.left[from + i]);
      sinSum += x * std::sin(phase);
      cosSum += x * std::cos(phase);
    }
    const double a = 2.0 * sinSum / static_cast<double>(count);
    const double b = 2.0 * cosSum / static_cast<double>(count);
    double residual = 0.0;
    for (std::size_t i = 0; i < count; ++i) {
      const double phase = 2.0 * kPi * 5000.0 * static_cast<double>(i) / kRate;
      const double x = static_cast<double>(out.left[from + i]) - a * std::sin(phase) - b * std::cos(phase);
      residual += x * x;
    }
    // RMS times root two is the peak of a single sine carrying all of it —
    // the loudest any one product could possibly be.
    const double bound = dbOf(std::sqrt(residual / static_cast<double>(count)) * 1.41421356);
    std::printf("    V12: %.0f ms, clock %.0f Hz — carrier %.1f dBFS, worst product %.1f dBFS"
                " at %.0f Hz, residual bound %.1f dBFS\n",
                1000.0 * seconds, clockHz, carrier, worstProduct, worstHz, bound);
    MW_EXPECT(worstProduct <= -57.0);
    MW_EXPECT(bound <= -57.0);
    // The line is in circuit: its own noise floor is in the residual, at the
    // −72 dBFS the design puts it. A silent render would read −240 here, and
    // so would a render that had somehow missed the medium.
    MW_EXPECT(bound > -90.0);
    MW_EXPECT(carrier > -140.0);
  };
  floorAt(0.300, delay::Quality::Normal, delay::bbdClockHzFor(4096, 0.300));
  floorAt(0.300, delay::Quality::High, delay::bbdClockHzFor(4096, 0.300));
  // At 50 ms the clock is 41 kHz and every image lies past Nyquist, where the
  // device's own filter would remove it; the hold stands down there rather
  // than folding a partner into the band that no bucket-brigade makes.
  floorAt(0.050, delay::Quality::Normal, delay::bbdClockHzFor(4096, 0.050));
}

MW_TEST("§6.3: bias reduces headroom, repeat level and top end together") {
  /*
   * The sheet's statement, measured as three numbers that all move the same
   * way when one control does. Bias is a control distinct from Drive because
   * it costs level and top end as well as headroom; a bias that only added
   * distortion would be a second drive knob.
   */
  auto through = [](double bias, double hz, double amplitude) {
    GranularDelay unit;
    onMedium(unit, delay::Character::Tape, delay::Quality::Normal, 0.100);
    unit.setBias(bias);
    unit.setAge(0.0);
    unit.reset();
    const Tone tone{hz, amplitude};
    const Rendered out = render(unit, 72000, tone);
    return toneLevelDb(out.left, hz, kRate, 48000, 24000) - dbOf(amplitude);
  };
  const double lowBiasLevel = through(0.0, 1000.0, 0.1);
  const double highBiasLevel = through(1.0, 1000.0, 0.1);
  const double lowBiasTop = through(0.0, 12000.0, 0.1) - lowBiasLevel;
  const double highBiasTop = through(1.0, 12000.0, 0.1) - highBiasLevel;
  const double lowBiasHot = through(0.0, 1000.0, 0.8) - through(0.0, 1000.0, 0.1);
  const double highBiasHot = through(1.0, 1000.0, 0.8) - through(1.0, 1000.0, 0.1);
  std::printf("    §6.3: level %.1f → %.1f dB, 12 kHz %.1f → %.1f dB, compression at +18 dB"
              " %.1f → %.1f dB, from bias 0 to 1\n",
              lowBiasLevel, highBiasLevel, lowBiasTop, highBiasTop, lowBiasHot, highBiasHot);
  MW_EXPECT(highBiasLevel < lowBiasLevel - 1.5);
  MW_EXPECT(highBiasTop < lowBiasTop - 2.0);
  // Less headroom: a hot signal gains less than a quiet one, and more so with bias.
  MW_EXPECT(highBiasHot < lowBiasHot - 1.0);
}

MW_TEST("§6.4: the published clock is the clock, and Clean publishes none") {
  GranularDelay bbd;
  onMedium(bbd, delay::Character::Bbd, delay::Quality::Normal, 0.300);
  render(bbd, 4 * kBlock, Tone{440.0, 0.1});
  const double published = static_cast<double>(bbd.frame().clockHz);
  std::printf("    §6.4: 300 ms on 4096 stages publishes %.1f Hz\n", published);
  MW_EXPECT_NEAR(published, 4096.0 / 0.6, 1.0);
  GranularDelay clean;
  onMedium(clean, delay::Character::Clean, delay::Quality::Normal, 0.300);
  render(clean, 4 * kBlock, Tone{440.0, 0.1});
  MW_EXPECT_NEAR(static_cast<double>(clean.frame().clockHz), 0.0, 0.0);
}

MW_TEST_MAIN("granular-delay-character")
