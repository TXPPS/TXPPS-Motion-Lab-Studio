// Motion Wave — the Console EQ's curves, both lineages. `dyn-05` §10 rows 1 to
// 6, 11 to 16, and 19.
//
// Every row here reads `eqMagnitudeDbAt`, which cascades the *same section
// objects the audio passes through* and takes each one's magnitude from its own
// running coefficients. That is the house rule rather than a shortcut: a curve
// computed a second way agrees with the audio right up until one of the two is
// changed. It also keeps the amplifiers and transformers out of the reading,
// which they should be — they are not part of the EQ curve, they are what it is
// drawn through, and sweeping a tone through them would put their gain and
// their distortion into every bandwidth measurement.
//
// The distortion and level rows, where the amplifiers *are* the subject, are in
// `console_eq_drive_tests.cpp` and render.
#include "../units/console_eq.h"
#include "../units/console_eq_voicing.h"
#include "harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kRate = 48000.0;
constexpr int kBlock = 128;

ConsoleEq& prepared(ConsoleEq& unit) {
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  unit.reset();
  return unit;
}

/**
 * Run one silent block, so the curve being read is the one the unit is running.
 *
 * The setters mark the unit dirty and the sections are rebuilt at the top of
 * `process`, which is the pattern every unit in this project uses and is
 * correct: a rebuild belongs on the audio thread's own clock, not on whichever
 * thread happened to move a control. It does mean a reading taken *between*
 * blocks is the previous setting's — measured, every row here read 0.00 dB and
 * the whole suite reported a flat equaliser at maximum boost. A face is not
 * exposed to it, because a face reads the frame `process` publishes.
 */
void commit(ConsoleEq& unit, double rate = kRate) {
  std::vector<float> left(kBlock, 0.0f);
  std::vector<float> right(kBlock, 0.0f);
  std::vector<float> outLeft(kBlock, 0.0f);
  std::vector<float> outRight(kBlock, 0.0f);
  float* channels[2] = {left.data(), right.data()};
  float* outChannels[2] = {outLeft.data(), outRight.data()};
  AudioBuffer in(channels, 2, kBlock);
  AudioBuffer out(outChannels, 2, kBlock);
  ProcessContext ctx;
  ctx.inputs = &in;
  ctx.inputCount = 1;
  ctx.outputs = &out;
  ctx.outputCount = 1;
  ctx.frames = kBlock;
  ctx.sampleRate = rate;
  ctx.playing = true;
  unit.process(ctx);
}

/// The largest response within a decade either side of `aroundHz`, and where.
double peakDbNear(const ConsoleEq& unit, double aroundHz, double& atHz, double octaves = 6.0) {
  double best = -1.0e9;
  atHz = aroundHz;
  // A tenth of an octave is finer than any bandwidth being measured and coarse
  // enough to sweep the range without the row becoming a benchmark.
  //
  // **The window is a parameter because a wide one finds the wrong peak.** With
  // six octaves either side, a search "near 1.6 kHz" reaches down to 25 Hz and
  // returns the *low shelf's* maximum — test 6 read the mid band's peak as
  // 17.17 dB when the mid band was set to 12, and the number it was really
  // reporting was the shelf's 17.16.
  const int steps = static_cast<int>(octaves * 10.0);
  for (int i = -steps; i <= steps; ++i) {
    const double hz = aroundHz * std::pow(2.0, static_cast<double>(i) / 10.0);
    if (hz < 5.0 || hz > 22000.0) continue;
    const double db = unit.eqMagnitudeDbAt(hz);
    if (db > best) {
      best = db;
      atHz = hz;
    }
  }
  return best;
}

double troughDbNear(const ConsoleEq& unit, double aroundHz, double octaves = 6.0) {
  double worst = 1.0e9;
  const int steps = static_cast<int>(octaves * 10.0);
  for (int i = -steps; i <= steps; ++i) {
    const double hz = aroundHz * std::pow(2.0, static_cast<double>(i) / 10.0);
    if (hz < 5.0 || hz > 22000.0) continue;
    worst = std::min(worst, unit.eqMagnitudeDbAt(hz));
  }
  return worst;
}

/**
 * The half-gain bandwidth in octaves.
 *
 * **Half-gain, not −3 dB, and the distinction decides whether three of the five
 * American steps can be measured at all.** A −3 dB bandwidth is read 3 dB below
 * the peak, which at 2 dB of boost is a contour the curve never reaches — and
 * §6.2's published law quotes three octaves *at 2 dB*, so it cannot mean that.
 * Half-gain is also how a peaking section is parameterised, so the number that
 * goes into the filter is the number that comes back out.
 */
double bandwidthOctaves(const ConsoleEq& unit, double centreHz) {
  double atHz = centreHz;
  const double peak = peakDbNear(unit, centreHz, atHz);
  if (std::fabs(peak) < 0.05) return 0.0;
  const double target = peak * 0.5;
  auto edge = [&](int direction) {
    double lo = atHz;
    double hi = atHz * std::pow(2.0, direction * 8.0);
    for (int i = 0; i < 40; ++i) {
      const double mid = std::sqrt(lo * hi);
      if (std::fabs(unit.eqMagnitudeDbAt(mid)) > std::fabs(target)) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return std::sqrt(lo * hi);
  };
  return std::log2(edge(1) / edge(-1));
}

double qOf(const ConsoleEq& unit, double centreHz) {
  const double octaves = bandwidthOctaves(unit, centreHz);
  if (octaves <= 0.0) return 0.0;
  const double span = std::pow(2.0, octaves);
  return std::sqrt(span) / (span - 1.0);
}

void british(ConsoleEq& unit) { unit.setLineage(ConsoleEq::Lineage::British); }
void american(ConsoleEq& unit) { unit.setLineage(ConsoleEq::Lineage::American); }

}  // namespace

MW_TEST("dyn-05 test 1: the band maxima, British lineage") {
  // **A shelf's maximum is its plateau, not its peak.** §9.1 specifies the low
  // and high bands as ±16 dB, which is the amount the shelf *arrives* at; §6.1
  // says in the same breath that an LC shelf overshoots slightly on the way
  // there, and §10 test 4 asserts that overshoot exists. Reading the peak makes
  // the two rows contradict each other — the shelf measured 18.18 dB against a
  // 16 dB specification for the same reason it passed test 4. The bell has no
  // such distinction and is read at its peak.
  const double midHz[6] = {360.0, 700.0, 1600.0, 3200.0, 4800.0, 7200.0};
  for (int i = 0; i < 4; ++i) {
    ConsoleEq unit;
    british(unit);
    prepared(unit);
    unit.setBritishLowFrequency(i);
    unit.setBritishLowAmount(16.0);
    commit(unit);
    // Two octaves below the lowest corner, where every one of the four
    // positions has reached its plateau.
    const double boost = unit.eqMagnitudeDbAt(8.0);
    unit.setBritishLowFrequency(i);
    unit.setBritishLowAmount(-16.0);
    commit(unit);
    const double cut = unit.eqMagnitudeDbAt(8.0);
    std::printf("    test 1: LF %5.0f Hz — boost %+.2f dB, cut %+.2f dB\n",
                voicing::kBritishLowHz[i], boost, cut);
    MW_EXPECT_NEAR(boost, 16.0, 1.5);
    MW_EXPECT_NEAR(cut, -16.0, 1.5);
  }
  for (int i = 0; i < 6; ++i) {
    ConsoleEq unit;
    british(unit);
    prepared(unit);
    unit.setBritishMidFrequency(i);
    unit.setBritishMidAmount(18.0);
    commit(unit);
    double at = 0.0;
    const double boost = peakDbNear(unit, midHz[i], at, 1.5);
    unit.setBritishMidFrequency(i);
    unit.setBritishMidAmount(-18.0);
    commit(unit);
    const double cut = troughDbNear(unit, midHz[i], 1.5);
    std::printf("    test 1: MF %5.0f Hz — boost %+.2f dB, cut %+.2f dB\n", midHz[i], boost,
                cut);
    MW_EXPECT_NEAR(boost, 18.0, 1.5);
    MW_EXPECT_NEAR(cut, -18.0, 1.5);
  }
  // **The high shelf is measured at 96 kHz, because at 48 it has nowhere to
  // arrive.** Its corner is 12 kHz and the audio band ends at 20, three
  // quarters of an octave later — the LC transition is still overshooting
  // there, and read at 20 kHz the shelf measured 17.75 dB against a 16 dB
  // specification for the same reason test 4 passes. The ±16 dB in §9.1 is the
  // amount the shelf arrives at, and it arrives above the band.
  ConsoleEq unit;
  british(unit);
  unit.prepare(96000.0, kBlock);
  unit.setNoise(0.0);
  unit.reset();
  unit.setBritishHighAmount(16.0);
  commit(unit, 96000.0);
  const double boost = unit.eqMagnitudeDbAt(40000.0);
  unit.setBritishHighAmount(-16.0);
  commit(unit, 96000.0);
  const double cut = unit.eqMagnitudeDbAt(40000.0);
  std::printf("    test 1: HF 12 kHz — boost %+.2f dB, cut %+.2f dB\n", boost, cut);
  MW_EXPECT_NEAR(boost, 16.0, 1.5);
  MW_EXPECT_NEAR(cut, -16.0, 1.5);
}

MW_TEST("dyn-05 test 2: the mid band's Q rises with the selected frequency") {
  // §6.1's switching scheme, and the row the sheet calls the critical inductor
  // test: both L and C are switched on the lower positions, only C above them,
  // so Q climbs across the upper ones. A model with one Q constant per band
  // fails here by name.
  ConsoleEq low;
  british(low);
  prepared(low);
  low.setBritishMidFrequency(0);
    low.setBritishMidAmount(12.0);
  commit(low);
  const double qLow = qOf(low, 360.0);

  ConsoleEq high;
  british(high);
  prepared(high);
  high.setBritishMidFrequency(5);
    high.setBritishMidAmount(12.0);
  commit(high);
  const double qHigh = qOf(high, 7200.0);

  std::printf("    test 2: Q at 360 Hz %.3f, at 7.2 kHz %.3f — %.2fx\n", qLow, qHigh,
              qLow > 0.0 ? qHigh / qLow : 0.0);
  MW_EXPECT_AT_LEAST_TIMES(qHigh, qLow, 1.2, 0.05);
}

MW_TEST("dyn-05 test 3: the mid band is constant-bandwidth, not constant-Q") {
  // The opposite convention to a textbook parametric, §6.1: the band narrows as
  // the amount rises rather than holding its shape.
  ConsoleEq gentle;
  british(gentle);
  prepared(gentle);
  gentle.setBritishMidFrequency(2);
    gentle.setBritishMidAmount(4.0);
  commit(gentle);
  const double qGentle = qOf(gentle, 1600.0);

  ConsoleEq hard;
  british(hard);
  prepared(hard);
  hard.setBritishMidFrequency(2);
    hard.setBritishMidAmount(18.0);
  commit(hard);
  const double qHard = qOf(hard, 1600.0);

  std::printf("    test 3: Q at +4 dB %.3f, at +18 dB %.3f — %.2fx\n", qGentle, qHard,
              qGentle > 0.0 ? qHard / qGentle : 0.0);
  MW_EXPECT_AT_LEAST_TIMES(qHard, qGentle, 1.3, 0.05);
}

MW_TEST("dyn-05 test 4: the low shelf is an LC network, not a first-order one") {
  // §6.1: an LC shelf has a slight resonant feature near the transition and an
  // asymptote it approaches rather than reaches. The measurement is the
  // overshoot past the asymptote — a first-order shelf approaches monotonically
  // and has none at all.
  ConsoleEq unit;
  british(unit);
  prepared(unit);
  unit.setBritishLowFrequency(1);
    unit.setBritishLowAmount(16.0);
  commit(unit);
  double at = 0.0;
  const double peak = peakDbNear(unit, 60.0, at);
  // Well below the corner, where any shelf has reached its asymptote.
  const double asymptote = unit.eqMagnitudeDbAt(6.0);
  std::printf("    test 4: shelf asymptote %+.2f dB, peak %+.2f dB at %.1f Hz —"
              " overshoot %.2f dB\n",
              asymptote, peak, at, peak - asymptote);
  MW_EXPECT(peak - asymptote >= 0.15);
  // And it is a feature rather than a resonance: a shelf that rang would be a
  // bell with a tail, which is a different filter.
  MW_EXPECT(peak - asymptote <= 3.0);
}

MW_TEST("dyn-05 test 5: the high-pass is third order") {
  const double corners[4] = {50.0, 80.0, 160.0, 300.0};
  for (int i = 0; i < 4; ++i) {
    ConsoleEq unit;
    british(unit);
    prepared(unit);
    unit.setHighPass(i + 1);
    commit(unit);
    // One to two octaves below the corner, as the row directs — close enough
    // that the filter is still third order and far enough that the knee is
    // behind it.
    const double lower = unit.eqMagnitudeDbAt(corners[i] / 4.0);
    const double upper = unit.eqMagnitudeDbAt(corners[i] / 2.0);
    const double slope = upper - lower;
    std::printf("    test 5: %5.0f Hz — %.2f dB per octave one to two octaves down\n", corners[i],
                slope);
    MW_EXPECT_NEAR(slope, 18.0, 2.0);
  }
}

MW_TEST("dyn-05 test 6: the bands are a chain of networks, not three summed biquads") {
  ConsoleEq alone;
  british(alone);
  prepared(alone);
  alone.setBritishMidFrequency(2);
    alone.setBritishMidAmount(12.0);
  commit(alone);
  double at = 0.0;
  const double isolated = peakDbNear(alone, 1600.0, at, 1.0);

  ConsoleEq together;
  british(together);
  prepared(together);
  together.setBritishMidFrequency(2);
    together.setBritishMidAmount(12.0);
  together.setBritishLowFrequency(3);
    together.setBritishLowAmount(16.0);
  commit(together);
  const double combined = peakDbNear(together, 1600.0, at, 1.0);

  const double change = combined - isolated;
  std::printf("    test 6: mid peak %+.2f dB alone, %+.2f dB with the low shelf up — %.2f dB\n",
              isolated, combined, change);
  // Non-zero, because the networks are in series and share the amplifier's
  // feedback; small, because they are still different bands. Zero would mean
  // three independent biquads summed in decibels.
  MW_EXPECT(std::fabs(change) >= 0.2 && std::fabs(change) <= 2.0);
}

MW_TEST("dyn-05 test 11: the American steps, and that cut mirrors boost") {
  const double steps[5] = {2.0, 4.0, 6.0, 9.0, 12.0};
  const double centres[3] = {200.0, 1500.0, 10000.0};
  for (int b = 0; b < 3; ++b) {
    for (int s = 0; s < 5; ++s) {
      ConsoleEq unit;
      american(unit);
      prepared(unit);
      unit.setAmericanFrequency(b, 2);
    unit.setAmericanAmount(b, steps[s]);
    unit.setAmericanShape(b, ConsoleEq::Shape::Peak);
      commit(unit);
      double at = 0.0;
      const double boost = peakDbNear(unit, centres[b], at);
      unit.setAmericanFrequency(b, 2);
    unit.setAmericanAmount(b, -steps[s]);
    unit.setAmericanShape(b, ConsoleEq::Shape::Peak);
      commit(unit);
      const double cut = troughDbNear(unit, centres[b]);
      if (b == 1) {
        std::printf("    test 11: band %d step %+.0f — boost %+.2f dB, cut %+.2f dB\n", b + 1,
                    steps[s], boost, cut);
      }
      MW_EXPECT_NEAR(boost, steps[s], 0.5);
      MW_EXPECT_NEAR(cut, -steps[s], 0.5);
      // Reciprocal to within a third of a decibel, which is the row's own
      // tolerance and a property of the bridged-T plus summing node.
      MW_EXPECT_NEAR(boost, -cut, 0.3);
    }
  }
}

MW_TEST("dyn-05 test 12: proportional Q, against both published endpoints") {
  const double steps[5] = {2.0, 4.0, 6.0, 9.0, 12.0};
  double octaves[5] = {0, 0, 0, 0, 0};
  for (int s = 0; s < 5; ++s) {
    ConsoleEq unit;
    american(unit);
    prepared(unit);
    unit.setAmericanFrequency(1, 2);
    unit.setAmericanAmount(1, steps[s]);
    unit.setAmericanShape(1, ConsoleEq::Shape::Peak);
    commit(unit);
    octaves[s] = bandwidthOctaves(unit, 1500.0);
    std::printf("    test 12: %+.0f dB — %.3f octaves\n", steps[s], octaves[s]);
  }
  // The two published figures, which §6.2 says to treat as targets rather than
  // guidelines.
  MW_EXPECT_NEAR(octaves[0], 3.0, 0.6);
  MW_EXPECT_NEAR(octaves[4], 1.0, 0.2);
  for (int s = 1; s < 5; ++s) MW_EXPECT(octaves[s] < octaves[s - 1]);
}

MW_TEST("dyn-05 test 13: two bands at six do not equal one band at twelve") {
  // §4.7 and the row the sheet calls the strongest single confirmation that
  // proportional Q is real rather than a cosmetic Q curve. Two 6 dB curves are
  // each about two octaves wide and their sum is a wide 12 dB bump; one band at
  // 12 dB is a one-octave 12 dB bump.
  ConsoleEq single;
  american(single);
  prepared(single);
  single.setAmericanFrequency(1, 2);
    single.setAmericanAmount(1, 12.0);
    single.setAmericanShape(1, ConsoleEq::Shape::Peak);
  commit(single);
  double at = 0.0;
  const double singlePeak = peakDbNear(single, 1500.0, at);
  const double singleWidth = bandwidthOctaves(single, 1500.0);

  ConsoleEq stacked;
  american(stacked);
  prepared(stacked);
  // Band 1 at its top position and band 2 at its middle one — 400 Hz and
  // 1.5 kHz do not overlap enough, so both are put on the shared 5 kHz edge
  // where the ranges genuinely meet.
  stacked.setAmericanFrequency(1, 4);
    stacked.setAmericanAmount(1, 6.0);
    stacked.setAmericanShape(1, ConsoleEq::Shape::Peak);
  stacked.setAmericanFrequency(2, 0);
    stacked.setAmericanAmount(2, 6.0);
    stacked.setAmericanShape(2, ConsoleEq::Shape::Peak);
  commit(stacked);
  const double stackedPeak = peakDbNear(stacked, 5000.0, at);
  const double stackedWidth = bandwidthOctaves(stacked, 5000.0);

  std::printf("    test 13: one band %+.2f dB over %.3f octaves, two bands %+.2f dB over"
              " %.3f octaves — %.2fx\n",
              singlePeak, singleWidth, stackedPeak, stackedWidth,
              singleWidth > 0.0 ? stackedWidth / singleWidth : 0.0);
  MW_EXPECT_NEAR(stackedPeak, singlePeak, 1.5);
  MW_EXPECT_AT_LEAST_TIMES(stackedWidth, singleWidth, 1.5, 0.05);
}

MW_TEST("dyn-05 test 14: boost and cut cancel, on the American lineage only") {
  // §6.2: the cut curve mirrors the boost curve, which the manufacturer states
  // and which is a property of the bridged-T plus summing node. It is *not*
  // true of the British lineage and not true of DYN-01 at all, so a shared
  // engine would either give reciprocity to a unit that has none or take it
  // from the one that has it.
  ConsoleEq boost;
  american(boost);
  prepared(boost);
  boost.setAmericanFrequency(1, 2);
    boost.setAmericanAmount(1, 6.0);
    boost.setAmericanShape(1, ConsoleEq::Shape::Peak);
  commit(boost);
  ConsoleEq cut;
  american(cut);
  prepared(cut);
  cut.setAmericanFrequency(1, 2);
    cut.setAmericanAmount(1, -6.0);
    cut.setAmericanShape(1, ConsoleEq::Shape::Peak);
  commit(cut);

  double worst = 0.0;
  double worstHz = 0.0;
  for (int i = 0; i <= 100; ++i) {
    const double hz = 20.0 * std::pow(1000.0, static_cast<double>(i) / 100.0);
    const double combined = boost.eqMagnitudeDbAt(hz) + cut.eqMagnitudeDbAt(hz);
    if (std::fabs(combined) > std::fabs(worst)) {
      worst = combined;
      worstHz = hz;
    }
  }
  std::printf("    test 14: +6 into -6 leaves %+.4f dB at worst, at %.0f Hz\n", worst, worstHz);
  MW_EXPECT(std::fabs(worst) <= 0.5);
  // And the row proves nothing unless each half was really doing something.
  MW_EXPECT(std::fabs(boost.eqMagnitudeDbAt(1500.0)) >= 5.0);
}

MW_TEST("dyn-05 test 15: a shelf is asymptotic, not peaking") {
  // §10 test 15, and it is where the two lineages part company on shape as well
  // as on Q: the British shelf is *meant* to overshoot (test 4) and this one is
  // not, because there is no inductor in it.
  ConsoleEq unit;
  american(unit);
  prepared(unit);
  unit.setAmericanFrequency(0, 0);
    unit.setAmericanAmount(0, 12.0);
    unit.setAmericanShape(0, ConsoleEq::Shape::Shelf);
  commit(unit);
  const double atTwenty = unit.eqMagnitudeDbAt(20.0);
  const double atFifty = unit.eqMagnitudeDbAt(50.0);
  double at = 0.0;
  const double peak = peakDbNear(unit, 50.0, at);
  std::printf("    test 15: shelf %+.2f dB at 20 Hz, %+.2f dB at 50 Hz, peak %+.2f dB\n", atTwenty,
              atFifty, peak);
  MW_EXPECT_NEAR(atTwenty, atFifty, 1.0);
  // And no resonance anywhere: the peak is the asymptote, not a feature above
  // it.
  MW_EXPECT(peak - atTwenty <= 0.5);
}

MW_TEST("dyn-05 test 16: the band-pass is 12 dB per octave and ignores the EQ") {
  // **Measured at 192 kHz, and the corners are why.** A 15 kHz corner has an
  // octave and a half of audio band above it at 48 kHz, so the stop-band slope
  // has to be read at 30 and 60 kHz — past half of Nyquist for the sections,
  // where the bilinear transform's own frequency warping steepens everything it
  // touches. Read that way the slope measured 17.68 dB per octave against a
  // published twelve, and the extra 5.7 dB was the transform rather than the
  // filter. At 192 kHz the same two probes sit at a sixth of Nyquist and the
  // warping is negligible. The corners themselves are read at both rates.
  ConsoleEq unit;
  american(unit);
  unit.prepare(192000.0, kBlock);
  unit.setNoise(0.0);
  unit.reset();
  unit.setBandPass(true);
  commit(unit, 192000.0);
  const double lowSlope = unit.eqMagnitudeDbAt(50.0 / 2.0) - unit.eqMagnitudeDbAt(50.0 / 4.0);
  const double highSlope =
      unit.eqMagnitudeDbAt(15000.0 * 2.0) - unit.eqMagnitudeDbAt(15000.0 * 4.0);
  const double lowCorner = unit.eqMagnitudeDbAt(50.0);
  const double highCorner = unit.eqMagnitudeDbAt(15000.0);
  std::printf("    test 16: %.2f dB/oct below, %.2f dB/oct above; corners %+.2f and %+.2f dB\n",
              lowSlope, highSlope, lowCorner, highCorner);
  MW_EXPECT_NEAR(lowSlope, 12.0, 2.0);
  // Both differences are taken low-frequency-minus-high, so on the upper skirt
  // the sign is already positive: the response at 30 kHz is above the response
  // at 60 kHz by the slope.
  MW_EXPECT_NEAR(highSlope, 12.0, 2.0);
  // §10's ±15 % on each corner, expressed where it is measured: a 15 % shift in
  // frequency on a 12 dB/octave skirt is about 0.8 dB.
  MW_EXPECT_NEAR(lowCorner, -3.0, 1.0);
  MW_EXPECT_NEAR(highCorner, -3.0, 1.0);

  // Unchanged by any EQ setting, which is why it lives outside the EQ-in latch
  // in the unit exactly as it does on the panel.
  const double before = unit.eqMagnitudeDbAt(1500.0);
  unit.setAmericanFrequency(1, 2);
    unit.setAmericanAmount(1, 12.0);
    unit.setAmericanShape(1, ConsoleEq::Shape::Peak);
  unit.setAmericanFrequency(0, 0);
    unit.setAmericanAmount(0, -12.0);
    unit.setAmericanShape(0, ConsoleEq::Shape::Peak);
  commit(unit, 192000.0);
  const double after = unit.eqMagnitudeDbAt(1500.0);
  // The bands moved, so the total response must have; what may not move is the
  // filter's own contribution, which is read with the bands returned to zero.
  unit.setAmericanFrequency(1, 2);
    unit.setAmericanAmount(1, 0.0);
    unit.setAmericanShape(1, ConsoleEq::Shape::Peak);
  unit.setAmericanFrequency(0, 0);
    unit.setAmericanAmount(0, 0.0);
    unit.setAmericanShape(0, ConsoleEq::Shape::Peak);
  commit(unit, 192000.0);
  const double restored = unit.eqMagnitudeDbAt(1500.0);
  std::printf("    test 16: filter alone %+.3f dB, with bands %+.3f dB, restored %+.3f dB\n",
              before, after, restored);
  MW_EXPECT(std::fabs(after - before) >= 1.0);
  MW_EXPECT_NEAR(restored, before, 1.0e-9);
}

MW_TEST("dyn-05 test 19: the two lineages are not sharing a filter engine") {
  // The row exists because a shared engine is the easy mistake, and it would
  // pass every other curve row on one lineage while quietly failing the sheet's
  // §8: the British Q *rises* with amount and the American bandwidth *falls*.
  ConsoleEq britishGentle;
  british(britishGentle);
  prepared(britishGentle);
  britishGentle.setBritishMidFrequency(2);
    britishGentle.setBritishMidAmount(4.0);
  commit(britishGentle);
  ConsoleEq britishHard;
  british(britishHard);
  prepared(britishHard);
  britishHard.setBritishMidFrequency(2);
    britishHard.setBritishMidAmount(12.0);
  commit(britishHard);

  ConsoleEq americanGentle;
  american(americanGentle);
  prepared(americanGentle);
  americanGentle.setAmericanFrequency(1, 2);
    americanGentle.setAmericanAmount(1, 4.0);
    americanGentle.setAmericanShape(1, ConsoleEq::Shape::Peak);
  commit(americanGentle);
  ConsoleEq americanHard;
  american(americanHard);
  prepared(americanHard);
  americanHard.setAmericanFrequency(1, 2);
    americanHard.setAmericanAmount(1, 12.0);
    americanHard.setAmericanShape(1, ConsoleEq::Shape::Peak);
  commit(americanHard);

  const double britishWide = bandwidthOctaves(britishGentle, 1600.0);
  const double britishNarrow = bandwidthOctaves(britishHard, 1600.0);
  const double americanWide = bandwidthOctaves(americanGentle, 1500.0);
  const double americanNarrow = bandwidthOctaves(americanHard, 1500.0);
  std::printf("    test 19: British %.3f -> %.3f octaves, American %.3f -> %.3f octaves\n",
              britishWide, britishNarrow, americanWide, americanNarrow);
  MW_EXPECT(britishNarrow < britishWide);
  MW_EXPECT(americanNarrow < americanWide);

  // **Both narrow with amount, and the difference is how much.** §8's table
  // reads "constant bandwidth: narrows as amount rises" against "proportional
  // Q: 3 octaves at 2 dB, 1 octave at 12 dB", which are not opposite directions
  // — they are the same direction at very different rates, and a row asserting
  // opposite signs would be asserting something neither sheet says. Across each
  // lineage's own published range the American law is a three-to-one change and
  // the British is not.
  ConsoleEq britishFull;
  british(britishFull);
  prepared(britishFull);
  britishFull.setBritishMidFrequency(2);
    britishFull.setBritishMidAmount(18.0);
  commit(britishFull);
  ConsoleEq americanFull;
  american(americanFull);
  prepared(americanFull);
  americanFull.setAmericanFrequency(1, 2);
    americanFull.setAmericanAmount(1, 2.0);
    americanFull.setAmericanShape(1, ConsoleEq::Shape::Peak);
  commit(americanFull);
  const double britishRange = britishWide / bandwidthOctaves(britishFull, 1600.0);
  const double americanRange = bandwidthOctaves(americanFull, 1500.0) / americanNarrow;
  std::printf("    test 19: bandwidth moves %.2fx across the British range and %.2fx across"
              " the American\n",
              britishRange, americanRange);
  MW_EXPECT_AT_LEAST_TIMES(americanRange, britishRange, 1.8, 0.05);

  // And at a nominally equivalent setting the two curves differ. If they match,
  // one of the two devices is wrong.
  ConsoleEq britishTwelve;
  british(britishTwelve);
  prepared(britishTwelve);
  britishTwelve.setBritishMidFrequency(2);
    britishTwelve.setBritishMidAmount(12.0);
  commit(britishTwelve);
  const double britishShape = bandwidthOctaves(britishTwelve, 1600.0);
  std::printf("    test 19: at +12 dB — British %.3f octaves, American %.3f octaves\n",
              britishShape, americanNarrow);
  MW_EXPECT_AT_LEAST_TIMES(americanNarrow, britishShape, 1.1, 0.05);
}

MW_TEST_MAIN("console-eq-curve")
