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

MW_TEST("dyn-03: the attack is still a control at 44.1 kHz") {
  // The row a host-rate detector fails. 20 µs is 0.88 samples at 44.1 kHz, so a
  // detector clocked at the host rate cannot be faster than one sample and
  // every setting above about position 5 collapses onto one behaviour.
  //
  // What is measured is the reduction reached a fixed short time after the
  // signal arrives — 91 µs, four host samples, which sits inside the control's
  // own 20-to-800 µs range. A faster setting must be further along by then. The
  // wrapper's latency delays every setting equally, so it cancels out of the
  // comparison.
  constexpr double kRate = 44100.0;
  double reached[7] = {0, 0, 0, 0, 0, 0, 0};
  for (int p = 0; p < 7; ++p) {
    const double position = 1.0 + static_cast<double>(p);
    FetLimiter unit;
    configure(unit, kRate, FetRatio::R20, position, 4.0);
    Driver driver(unit, kRate);
    // Rested first, so the timing network starts from zero charge.
    driver.silence(2048);
    driver.restartPhase();
    // The wrapper delays the signal by its declared latency, so the detector
    // sees nothing at all for the first 49 samples. Measuring from the input's
    // arrival rather than from the call reported 0.0000 dB at every setting —
    // which looks exactly like the failure this row is written to catch, and
    // was the instrument instead.
    driver.tone(0.25, 1000.0, unit.latencySamples());
    reached[p] = driver.tone(0.25, 1000.0, 4);
    std::printf("    position %d (%6.1f us nominal): %.4f dB after 4 samples (91 us)\n", p + 1,
                dsp::panelScaleToSeconds(position, 20.0, 800.0), reached[p]);
  }
  // Strictly monotonic across the whole control, which is the claim.
  for (int p = 1; p < 7; ++p) MW_EXPECT(reached[p] > reached[p - 1]);
  // And a real range rather than seven values within rounding of one another,
  // which is what a host-rate detector produces.
  MW_EXPECT(reached[6] > reached[0] * 2.0);
}

MW_TEST("dyn-03 test 1: the attack endpoints, where the sheet can resolve them") {
  // At 192 kHz, as §9 test 1 directs — one sample is 5.2 µs there, so a 20 µs
  // constant is four samples and a 10 %-to-90 % span is measurable at the host
  // rate. The unit is the same one; only the instrument changes.
  constexpr double kRate = 192000.0;
  for (int fast = 0; fast < 2; ++fast) {
    const double position = fast == 1 ? 7.0 : 1.0;
    FetLimiter unit;
    configure(unit, kRate, FetRatio::R20, position, 4.0);
    Driver driver(unit, kRate);
    driver.silence(8192);
    driver.restartPhase();
    // The final value first, then the crossings.
    const double finalDb = driver.tone(0.25, 1000.0, static_cast<int>(kRate * 0.02));

    FetLimiter again;
    configure(again, kRate, FetRatio::R20, position, 4.0);
    Driver second(again, kRate);
    second.silence(8192);
    second.restartPhase();
    int at10 = -1;
    int at90 = -1;
    for (int i = 0; i < static_cast<int>(kRate * 0.02); ++i) {
      const double reduction = second.tone(0.25, 1000.0, 1);
      if (at10 < 0 && reduction >= finalDb * 0.1) at10 = i;
      if (at90 < 0 && reduction >= finalDb * 0.9) {
        at90 = i;
        break;
      }
    }
    const double micros = static_cast<double>(at90 - at10) * 1.0e6 / kRate;
    std::printf("    test 1 position %.0f: 10 %%-90 %% of %.2f dB in %.1f us\n", position,
                finalDb, micros);
    // ±25 % relative at each endpoint, on a 10 %-to-90 % span which is 2.197
    // time constants of a first-order rise.
    const double target = (fast == 1 ? 20.0 : 800.0) * 2.197224577;
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
    FetLimiter unit;
    configure(unit, kRate, FetRatio::R20, i == 0 ? 1.0 : 7.0, 4.0);
    Driver driver(unit, kRate);
    driver.silence(4096);
    driver.restartPhase();
    attackReached[i] = driver.tone(0.25, 1000.0, 20);
  }
  std::printf("    test 3: ATTACK 1 reaches %.4f dB, ATTACK 7 reaches %.4f dB in the same time\n",
              attackReached[0], attackReached[1]);
  MW_EXPECT(attackReached[1] > attackReached[0]);

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
  MW_EXPECT(thresholds[1] - thresholds[0] >= 4.0);
  MW_EXPECT(thresholds[1] - thresholds[0] <= 10.0);
}

MW_TEST("dyn-03 test 8: the four-button state's lag is what defines it") {
  // §9 calls this the single behaviour that defines the state and asks for at
  // least ten times the 20:1 delay — the "reverse look-ahead" people describe.
  constexpr double kRate = 96000.0;
  double halfway[2] = {0, 0};
  const FetRatio ratios[2] = {FetRatio::R20, FetRatio::AllIn};
  for (int i = 0; i < 2; ++i) {
    FetLimiter unit;
    configure(unit, kRate, ratios[i], 7.0, 4.0);
    Driver driver(unit, kRate);
    driver.silence(4096);
    driver.restartPhase();
    const double finalDb = driver.tone(0.3, 1000.0, static_cast<int>(kRate * 0.25));

    FetLimiter again;
    configure(again, kRate, ratios[i], 7.0, 4.0);
    Driver second(again, kRate);
    second.silence(4096);
    second.restartPhase();
    for (int f = 0; f < static_cast<int>(kRate * 0.25); ++f) {
      if (second.tone(0.3, 1000.0, 1) >= finalDb * 0.5) {
        halfway[i] = static_cast<double>(f) * 1.0e6 / kRate;
        break;
      }
    }
    std::printf("    test 8 %s: half of %.2f dB after %.1f us\n",
                i == 0 ? "20:1     " : "all-in   ", finalDb, halfway[i]);
  }
  MW_EXPECT(halfway[1] >= halfway[0] * 10.0);
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
