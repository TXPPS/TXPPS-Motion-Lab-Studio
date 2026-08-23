// Motion Wave — FET Limiter, against `dyn-03` §9.
//
// The dynamics half. What makes this unit different from the two before it is
// that its fastest attack is *shorter than a sample*: 20 µs is 0.96 of a sample
// period at 48 kHz and 0.88 at 44.1 kHz. The sheet's own test 1 concedes it,
// asking for 192 kHz to resolve the fast end — but a product does not choose
// its host rate, so the detector runs inside the oversampling wrapper and the
// control has to work at 44.1 kHz too.
//
// That is what the first row below measures, and it is the row a host-rate
// detector fails. Clocked at the host rate, every setting faster than one
// sample reaches its final value within that sample, so the top third of the
// control does nothing — and nothing is exactly what it would look like: the
// unit would still limit, still sound plausible, and simply have no fast end.
#include "../units/fet_limiter.h"
#include "harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kPi = 3.14159265358979323846;

/// Drives a unit one sample at a time, so the timing resolution is the host
/// period rather than a block.
class Driver {
 public:
  Driver(FetLimiter& unit, double rate) : unit_(unit), rate_(rate) {}

  double push(double sample) {
    left_[0] = static_cast<float>(sample);
    right_[0] = left_[0];
    float* channels[2] = {left_.data(), right_.data()};
    float* outChannels[2] = {outLeft_.data(), outRight_.data()};
    AudioBuffer in(channels, 2, 1);
    AudioBuffer out(outChannels, 2, 1);
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &out;
    ctx.outputCount = 1;
    ctx.frames = 1;
    ctx.sampleRate = rate_;
    ctx.playing = true;
    unit_.process(ctx);
    last_ = static_cast<double>(outLeft_[0]);
    return unit_.gainReductionDb();
  }

  /**
   * A tone whose amplitude is raised over `rampFrames` before it is held.
   *
   * Steady-state rows must use this and transient rows must not, and the two
   * are different measurements of different things. An abruptly started tone is
   * a step *and* a tone: its onset excites the wrapper's reconstruction filter,
   * and a peak detector with a 20 µs attack and a 200 ms release catches that
   * ringing and holds it for the whole measurement window. What comes back is
   * the transient, wearing a ratio's clothes — and no amount of loop tuning
   * fixes it, because the loop is answering the question honestly.
   *
   * A raised cosine over several attack constants gets the tone to full
   * amplitude without a discontinuity, so the settled region is about the level.
   */
  double rampedTone(double amplitude, double hz, int rampFrames, int holdFrames) {
    for (int i = 0; i < rampFrames; ++i) {
      const double t = static_cast<double>(phase_ + i) / rate_;
      const double shape =
          0.5 - 0.5 * std::cos(kPi * static_cast<double>(i) / static_cast<double>(rampFrames));
      push(amplitude * shape * std::sin(2.0 * kPi * hz * t));
    }
    phase_ += rampFrames;
    return tone(amplitude, hz, holdFrames);
  }

  /// A tone for `frames` samples, from phase zero. Returns the final reduction.
  double tone(double amplitude, double hz, int frames) {
    double reduction = 0.0;
    for (int i = 0; i < frames; ++i) {
      const double t = static_cast<double>(phase_ + i) / rate_;
      reduction = push(amplitude * std::sin(2.0 * kPi * hz * t));
    }
    phase_ += frames;
    return reduction;
  }

  /**
   * A rectified-DC level, for measuring a peak detector's own constant.
   *
   * A peak detector only rises when a new peak arrives. With the sheet's 1 kHz
   * sine that is once every 0.5 ms, which is ten times the 20 µs span the fast
   * end of the control is supposed to show — so measured that way every fast
   * setting reads about half a millisecond and the control appears to have no
   * fast end. It is the probe's peak spacing, not the loop: the same settings
   * measured against a level whose peak spacing is one sample come out at
   * 20.8, 135.4 and 812.5 µs against published 20, 126.5 and 800.
   *
   * This is not a signal anyone would listen to, and it is not meant to be. It
   * is the instrument that can resolve what the row is asking about.
   */
  double level(double amplitude, int frames) {
    double reduction = 0.0;
    for (int i = 0; i < frames; ++i) reduction = push(amplitude);
    phase_ += frames;
    return reduction;
  }

  double silence(int frames) {
    double reduction = 0.0;
    for (int i = 0; i < frames; ++i) reduction = push(0.0);
    phase_ += frames;
    return reduction;
  }

  double lastOutput() const { return last_; }
  void restartPhase() { phase_ = 0; }

 private:
  FetLimiter& unit_;
  double rate_;
  std::vector<float> left_{1, 0.0f};
  std::vector<float> right_{1, 0.0f};
  std::vector<float> outLeft_{1, 0.0f};
  std::vector<float> outRight_{1, 0.0f};
  long phase_ = 0;
  double last_ = 0.0;
};

void configure(FetLimiter& unit, double rate, FetRatio ratio, double attack, double release) {
  unit.prepare(rate, 256);
  unit.setNoise(0.0);
  unit.setRatio(ratio);
  unit.setAttack(attack);
  unit.setRelease(release);
  unit.setLimiting(true);
  unit.reset();
}

double db(double v) { return 20.0 * std::log10(v > 1.0e-15 ? v : 1.0e-15); }

}  // namespace

/**
 * The reduction reached one sample after the reduction first appears.
 *
 * Against a rectified level rather than a tone, and that is the whole
 * difference between this and the probe it replaces. Read from a 1 kHz sine,
 * "one sample after arrival" lands at whatever phase the arrival happened to
 * fall on, so the number carries a cycle's worth of the *stimulus* in it: the
 * slowest setting measured 0.4241 dB and the next one 0.2577, which reads as
 * the control running backwards and is really the probe. A rectified level has
 * no phase to land on, so what is left is the unit.
 *
 * Timed from arrival because the wrapper delays the signal; the delay is equal
 * at every setting and cancels out of the comparison, whereas the declared
 * latency does not — the detector sits *inside* the wrapper and sees the signal
 * after the interpolator alone.
 */
double reachedAfterArrival(double rate, double position) {
  FetLimiter unit;
  configure(unit, rate, FetRatio::R20, position, 4.0);
  Driver driver(unit, rate);
  driver.silence(8192);
  driver.restartPhase();
  double reduction = 0.0;
  int guard = 0;
  while (reduction <= 0.0 && guard++ < 8192) reduction = driver.level(0.3, 1);
  return driver.level(0.3, 1);
}

MW_TEST("dyn-03: the attack is still a control at 44.1 kHz") {
  // The row a host-rate detector fails. 20 µs is 0.88 samples at 44.1 kHz, so a
  // detector clocked at the host rate cannot be faster than one sample and
  // every setting above about position 5 collapses onto one behaviour.
  //
  // What is measured is the reduction reached after *one* host sample — 22.7 µs
  // at this rate, which sits inside the control's own 20-to-800 µs range and is
  // the shortest interval a host-rate observer has. A faster setting must be
  // further along by then; a host-rate detector cannot be further along at all,
  // because one sample is the whole of its first step. The wrapper's latency
  // delays every setting equally, so it cancels out of the comparison.
  constexpr double kRate = 44100.0;
  double reached[7] = {0, 0, 0, 0, 0, 0, 0};
  for (int p = 0; p < 7; ++p) {
    const double position = 1.0 + static_cast<double>(p);
    // Timed from the reduction's *arrival*, not from the call and not from the
    // wrapper's declared latency. Both of those were tried and both were the
    // instrument rather than the unit: measuring from the call reported 0.0000
    // dB at every setting, because the wrapper delays the signal; skipping the
    // declared latency over-shoots, because the detector lives *inside* the
    // wrapper and sees the signal after the interpolator alone rather than
    // after the round trip. Either way every setting read the same number,
    // which is exactly the failure this row exists to catch.
    reached[p] = reachedAfterArrival(kRate, position);
    std::printf("    position %d (%6.1f us nominal): %.4f dB one sample after arrival\n", p + 1,
                dsp::panelScaleToSeconds(position, 20.0, 800.0), reached[p]);
  }
  // Strictly monotonic across the whole control, which is the claim.
  for (int p = 1; p < 7; ++p) MW_EXPECT(reached[p] > reached[p - 1]);
  // And a real range rather than seven values within rounding of one another,
  // which is what a host-rate detector produces.
  // A real range rather than seven values within rounding of one another,
  // which is what a host-rate detector produces. Guarded, because two
  // reductions of zero would satisfy any ratio between them.
  MW_EXPECT_AT_LEAST_TIMES(reached[6], reached[0], 2.0, 0.01);
}

MW_TEST("dyn-03 test 1: the attack endpoints, against a probe that can see them") {
  // At 192 kHz, as §9 test 1 directs — but against a rectified level rather
  // than the 1 kHz sine the same row specifies, because a peak detector cannot
  // be measured faster than its probe delivers peaks. See `Driver::level`.
  //
  // The targets are the published spans converted the way the model converts
  // them: a 10-to-90 span is what the sheet gives and what this measures, and
  // the detector's own constant is that divided by ln(9) and multiplied by the
  // loop's acceleration. If the conversion were wrong, one endpoint would land
  // and the other would not.
  constexpr double kRate = 192000.0;
  for (int fast = 0; fast < 2; ++fast) {
    const double position = fast == 1 ? 7.0 : 1.0;
    const double target = fast == 1 ? 20.0 : 800.0;

    FetLimiter unit;
    configure(unit, kRate, FetRatio::R20, position, 4.0);
    Driver driver(unit, kRate);
    driver.silence(8192);
    driver.restartPhase();
    const double finalDb = driver.level(0.3, static_cast<int>(kRate * 0.05));

    FetLimiter again;
    configure(again, kRate, FetRatio::R20, position, 4.0);
    Driver second(again, kRate);
    second.silence(8192);
    second.restartPhase();
    int at10 = -1;
    int at90 = -1;
    for (int i = 0; i < static_cast<int>(kRate * 0.05); ++i) {
      const double reduction = second.level(0.3, 1);
      if (at10 < 0 && reduction >= finalDb * 0.1) at10 = i;
      if (at10 >= 0 && reduction >= finalDb * 0.9) {
        at90 = i;
        break;
      }
    }
    const double micros = static_cast<double>(at90 - at10) * 1.0e6 / kRate;
    std::printf("    test 1 position %.0f: 10 %%-90 %% of %.2f dB in %.1f us (target %.0f)\n",
                position, finalDb, micros, target);
    // Neither crossing may be missing, and the span may not be zero — a
    // tolerance test between two identical indices passes and measures nothing.
    MW_EXPECT(at10 >= 0 && at90 > at10);
    MW_EXPECT(micros >= target * 0.75 && micros <= target * 1.25);
  }
}

MW_TEST("dyn-03 test 3: the panel's sense, which is backwards from a plug-in's") {
  // Fully clockwise is *fastest* on this panel, for both controls. A model with
  // conventional sense has inverted it, and would be wrong in a way that feels
  // right to anyone who has never used the hardware.
  constexpr double kRate = 96000.0;
  double attackReached[2] = {0, 0};
  for (int i = 0; i < 2; ++i) {
    // Twenty frames past the call used to be enough here by luck: the wrapper
    // delays by 49 samples, so both settings read 0.0000 dB and the row passed
    // on 0 > 0 until the comparison was guarded. Timed from arrival instead.
    attackReached[i] = reachedAfterArrival(kRate, i == 0 ? 1.0 : 7.0);
  }
  std::printf("    test 3: ATTACK 1 reaches %.4f dB, ATTACK 7 reaches %.4f dB in the same time\n",
              attackReached[0], attackReached[1]);
  MW_EXPECT_EXCEEDS_BY(attackReached[1], attackReached[0], 0.05, 0.01);

  double releaseLeft[2] = {0, 0};
  for (int i = 0; i < 2; ++i) {
    FetLimiter unit;
    configure(unit, kRate, FetRatio::R20, 7.0, i == 0 ? 1.0 : 7.0);
    Driver driver(unit, kRate);
    driver.tone(0.25, 1000.0, static_cast<int>(kRate * 0.3));
    releaseLeft[i] = driver.silence(static_cast<int>(kRate * 0.12));
  }
  std::printf("    test 3: RELEASE 1 leaves %.4f dB after 120 ms, RELEASE 7 leaves %.4f dB\n",
              releaseLeft[0], releaseLeft[1]);
  MW_EXPECT(releaseLeft[1] < releaseLeft[0]);
}

MW_TEST("dyn-03 test 5: the threshold moves with the ratio") {
  // The critical one. At a fixed input, switching from 4:1 to 20:1 must give
  // *less* gain reduction, because the higher ratio sits on a higher threshold.
  // A model that treated the buttons as a slope alone gets this backwards.
  constexpr double kRate = 96000.0;
  const double amplitude = 0.25;
  double reduction[2] = {0, 0};
  const FetRatio ratios[2] = {FetRatio::R4, FetRatio::R20};
  for (int i = 0; i < 2; ++i) {
    FetLimiter unit;
    configure(unit, kRate, ratios[i], 4.0, 4.0);
    Driver driver(unit, kRate);
    reduction[i] = driver.tone(amplitude, 1000.0, static_cast<int>(kRate * 0.4));
  }
  std::printf("    test 5: 4:1 reduces %.2f dB, 20:1 reduces %.2f dB at the same input\n",
              reduction[0], reduction[1]);
  MW_EXPECT(reduction[1] < reduction[0]);
  // And the threshold difference is between 4 and 10 dB. Measured as the input
  // level each ratio needs to reach the same reduction.
  double thresholds[2] = {0, 0};
  for (int i = 0; i < 2; ++i) {
    double lo = 0.005;
    double hi = 1.0;
    for (int step = 0; step < 24; ++step) {
      const double mid = std::sqrt(lo * hi);
      FetLimiter unit;
      configure(unit, kRate, ratios[i], 4.0, 4.0);
      Driver driver(unit, kRate);
      if (driver.tone(mid, 1000.0, static_cast<int>(kRate * 0.3)) < 6.0) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    thresholds[i] = db(std::sqrt(lo * hi));
  }
  std::printf("    test 5: 6 dB of reduction needs %.2f dBFS at 4:1 and %.2f dBFS at 20:1"
              " — %.2f dB apart\n",
              thresholds[0], thresholds[1], thresholds[1] - thresholds[0]);
  MW_EXPECT_EXCEEDS_BY(thresholds[1], thresholds[0], 4.0, 1.0e-3);
  MW_EXPECT(thresholds[1] - thresholds[0] <= 10.0);
}

MW_TEST("dyn-03 test 8: the four-button state's lag is what defines it") {
  // §9 calls this the single behaviour that defines the state and asks for at
  // least ten times the 20:1 delay — the "reverse look-ahead" people describe.
  //
  // Timed to the *same absolute* reduction in both states, not to half of each
  // one's own final value. The four-button state sits on a much lower threshold
  // and settles 15 dB deeper, so "half of final" is a different depth in each
  // and the comparison would be of two different journeys — the same instrument
  // error that made the Optical Leveller's release rows disagree with
  // themselves. Six decibels is a depth both states pass through.
  constexpr double kRate = 96000.0;
  constexpr double kMark = 6.0;
  double toMark[2] = {0, 0};
  const FetRatio ratios[2] = {FetRatio::R20, FetRatio::AllIn};
  for (int i = 0; i < 2; ++i) {
    FetLimiter unit;
    configure(unit, kRate, ratios[i], 7.0, 4.0);
    Driver driver(unit, kRate);
    driver.silence(4096);
    driver.restartPhase();
    // Timed from the signal's *arrival* rather than from the call, because the
    // wrapper delays it by its declared latency and consuming that delay with
    // the tone would run the attack before the clock started. The first version
    // did exactly that and reported 0.0 µs for both states — which satisfies
    // "at least ten times" arithmetically and measures nothing at all.
    int arrived = -1;
    for (int f = 0; f < static_cast<int>(kRate * 0.4); ++f) {
      const double reduction = driver.tone(0.3, 1000.0, 1);
      if (arrived < 0 && reduction > 0.5) arrived = f;
      if (arrived >= 0 && reduction >= kMark) {
        toMark[i] = static_cast<double>(f - arrived) * 1.0e6 / kRate;
        break;
      }
    }
    std::printf("    test 8 %s: reaches %.0f dB after %.1f us\n",
                i == 0 ? "20:1  " : "all-in", kMark, toMark[i]);
  }
  // The guard is the harness's now rather than this row's, because the
  // failure it catches — two zeros satisfying "at least ten times" — is a
  // class rather than this row's accident. A microsecond is the floor: any
  // lag shorter than that is a clock that never started.
  MW_EXPECT_AT_LEAST_TIMES(toMark[1], toMark[0], 10.0, 1.0);
}

MW_TEST("dyn-03 test 12: with the attack off it is a line amplifier") {
  constexpr double kRate = 96000.0;
  FetLimiter unit;
  configure(unit, kRate, FetRatio::R20, 7.0, 4.0);
  unit.setLimiting(false);
  Driver driver(unit, kRate);
  double worst = 0.0;
  for (double amplitude : {0.01, 0.1, 0.5, 0.95}) {
    unit.reset();
    worst = std::max(worst, driver.tone(amplitude, 1000.0, static_cast<int>(kRate * 0.1)));
  }
  std::printf("    test 12: worst reduction with the detector out, %.6f dB\n", worst);
  MW_EXPECT(worst < 0.01);
}

MW_TEST_MAIN("fet-limiter")
