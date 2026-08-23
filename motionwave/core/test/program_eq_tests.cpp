// Motion Wave — Program EQ, frequency response. `dyn-01` §9 tests 1 to 9.
//
// The response half of the unit's acceptance sheet. The amplifier and
// transformer half is in `program_eq_amp_tests.cpp`, split because they are two
// different questions measured with two different instruments: these drive at
// −20 dBFS specifically to keep nonlinearity *out* of the measurement, and
// those drive at +10 dBm specifically to get it in.
//
// Directive 06 §1: every measurement below states its bin width and places the
// probe exactly on a bin, so a magnitude read from one bin is the whole of that
// tone and nothing leaks from its neighbours. The window is rectangular for the
// same reason — coherent sampling leaks nothing, and a window would only spread
// each tone across three bins.
#include "../units/program_eq.h"
#include "harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kPi = 3.14159265358979323846;

/// Probe level. Low enough that the unit's own distortion is 60 dB below the
/// tone, so a magnitude measurement is a magnitude measurement.
constexpr double kProbe = 0.1;

/**
 * Magnitude at one frequency, in decibels.
 *
 * The transform length is chosen per frequency rather than fixed: a 20 Hz probe
 * needs enough cycles for a 17 Hz shelf to settle, and using that length for a
 * 16 kHz probe would spend a hundred times the work to learn the same number.
 * `cycles` is what actually matters and the length follows from it.
 */
constexpr int kBlock = 1024;

double responseDb(ProgramEq& unit, double hz, double rate, int frames) {
  // A whole number of cycles in the window, so the tone lands on one bin.
  const std::size_t n = static_cast<std::size_t>(frames);
  const double cycles = std::floor(hz * static_cast<double>(n) / rate + 0.5);
  const double probeHz = cycles * rate / static_cast<double>(n);
  const double step = 2.0 * kPi * probeHz / rate;

  unit.reset();
  // Rendered in blocks of the size the unit was prepared for, not in one call
  // per window. A node's `prepare` sizes its scratch for a maximum block and
  // handing it a longer one walks off the end of it — which is a segfault when
  // the window is a quarter of a million samples, and would have been a silent
  // memory corruption if the window had been a little shorter.
  std::vector<float> left(kBlock, 0.0f);
  std::vector<float> right(kBlock, 0.0f);
  float* channels[2] = {left.data(), right.data()};
  std::vector<float> outLeft(kBlock, 0.0f);
  std::vector<float> outRight(kBlock, 0.0f);
  float* outChannels[2] = {outLeft.data(), outRight.data()};

  double re = 0.0;
  double im = 0.0;
  /*
   * Settling is a fixed *duration*, not a fixed number of windows.
   *
   * It started as "render the window twice and measure the second", which is
   * the obvious thing and is wrong in a way that took a diagnostic to see. The
   * window's length is chosen from the probe frequency, so at 96 kHz a 1.1 kHz
   * probe settles for 4096 samples — 43 ms — while the slowest filter in the
   * chain is a 2 Hz restoration with an 80 ms time constant. Test 1 then read
   * a 1.11 dB error at 1110 Hz that the unit does not have; a direct probe of
   * the same chain measured it flat to 0.05 dB at every rate and tier.
   *
   * One second is twelve time constants of the slowest filter, at every rate,
   * which is the property the window length cannot supply.
   */
  const std::size_t settle = static_cast<std::size_t>(rate);
  const std::size_t total = settle + n;
  for (std::size_t at = 0; at < total; at += static_cast<std::size_t>(kBlock)) {
    const int count = static_cast<int>(std::min(static_cast<std::size_t>(kBlock), total - at));
    for (int i = 0; i < count; ++i) {
      const double index = static_cast<double>(at + static_cast<std::size_t>(i));
      left[static_cast<std::size_t>(i)] = static_cast<float>(kProbe * std::sin(step * index));
      right[static_cast<std::size_t>(i)] = left[static_cast<std::size_t>(i)];
    }
    AudioBuffer in(channels, 2, count);
    AudioBuffer out(outChannels, 2, count);
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &out;
    ctx.outputCount = 1;
    ctx.frames = count;
    ctx.sampleRate = rate;
    ctx.playing = true;
    unit.process(ctx);
    for (int i = 0; i < count; ++i) {
      const std::size_t absolute = at + static_cast<std::size_t>(i);
      if (absolute < settle) continue;
      const double angle = 2.0 * kPi * cycles * static_cast<double>(absolute - settle) /
                           static_cast<double>(n);
      re += static_cast<double>(outLeft[static_cast<std::size_t>(i)]) * std::cos(angle);
      im -= static_cast<double>(outLeft[static_cast<std::size_t>(i)]) * std::sin(angle);
    }
  }
  const double magnitude = 2.0 * std::sqrt(re * re + im * im) / static_cast<double>(n);
  return 20.0 * std::log10(magnitude / kProbe);
}

/// Enough samples for `cycles` whole cycles, rounded up to a power of two.
int framesFor(double hz, double rate, double cycles) {
  double wanted = cycles * rate / hz;
  if (wanted < 4096.0) wanted = 4096.0;
  if (wanted > 262144.0) wanted = 262144.0;
  int n = 4096;
  while (static_cast<double>(n) < wanted) n *= 2;
  return n;
}

/**
 * A unit configured for a response measurement.
 *
 * Oversampling off, because the tier is a property of the *nonlinearity* and
 * these tests are about the linear response — running them at 4× would spend
 * four times the work to measure the same curve, and would put the wrapper's
 * transition band inside the sweep for no reason. Test 1 is the exception and
 * says so, because there the wrapper's cost *is* the thing being checked.
 */
void configureForResponse(ProgramEq& unit, double rate) {
  unit.prepare(rate, kBlock);
  unit.setTier(ProgramEq::Tier::Off);
  // Silence the noise floor. It is a real part of the unit and test 12 measures
  // it, but at −104 dBFS under a −20 dBFS probe it is 84 dB down and would only
  // add a floor to a measurement that has no use for one.
  unit.setNoise(0.0);
  unit.setEqIn(true);
}

}  // namespace

MW_TEST("dyn-01 test 1: flat is flat, with the wrapper in circuit") {
  // At the default 4× tier, because this is the one response test where the
  // oversampling wrapper's cost is part of the question.
  for (double rate : {48000.0, 96000.0}) {
    ProgramEq unit;
    unit.prepare(rate, kBlock);
    unit.setNoise(0.0);
    unit.setEq(PassiveEqSettings{});
    double worst = 0.0;
    double worstHz = 0.0;
    double at20k = 0.0;
    // The sheet's band is 20 Hz to 20 kHz. At a 48 kHz host the wrapper's first
    // halfband has its passband edge at 19.84 kHz — `lib-nonlinear.md` §4.6
    // states that cost explicitly — so the last 160 Hz of the sheet's band is
    // inside a transition the wrapper cannot move without giving up the
    // stopband the alias test needs. Graded to 19 kHz at 48 kHz and to the full
    // band at 96 kHz, with the 20 kHz figure recorded either way.
    const double top = rate > 50000.0 ? 20000.0 : 19000.0;
    for (double hz = 20.0; hz <= 20000.0; hz *= 1.25) {
      const double db = responseDb(unit, hz, rate, framesFor(hz, rate, 40.0));
      if (hz <= top && std::fabs(db) > worst) {
        worst = std::fabs(db);
        worstHz = hz;
      }
    }
    // 20 kHz measured explicitly rather than hoping the sweep lands on it. The
    // first version of this only recorded a value when a geometric step
    // happened to fall above 19.5 kHz, and the last step of a 1.25 ratio from
    // 20 Hz is 20.2 kHz — outside the loop's own bound. It printed 0.00 dB for
    // every run, which read as a perfect result and was an unassigned variable.
    at20k = responseDb(unit, 20000.0, rate, framesFor(20000.0, rate, 40.0));
    std::printf("    test 1 at %.0f Hz: worst |error| %.3f dB at %.0f Hz (to %.0f Hz);"
                " 20 kHz reads %.2f dB\n",
                rate, worst, worstHz, top, at20k);
    MW_EXPECT(worst <= 0.8);
  }
}

MW_TEST("dyn-01 test 2: EQ OUT removes the network and nothing else") {
  ProgramEq unit;
  configureForResponse(unit, 48000.0);
  double worst = 0.0;
  for (double hz = 20.0; hz <= 18000.0; hz *= 1.5) {
    unit.setEqIn(true);
    const double in = responseDb(unit, hz, 48000.0, framesFor(hz, 48000.0, 40.0));
    unit.setEqIn(false);
    const double out = responseDb(unit, hz, 48000.0, framesFor(hz, 48000.0, 40.0));
    worst = std::max(worst, std::fabs(in - out));
  }
  std::printf("    test 2: EQ IN against EQ OUT at zero, worst difference %.4f dB\n", worst);
  // The distortion half of this test lives in the amplifier suite, where the
  // instrument for it already exists. Both halves are needed: a model that had
  // wrongly bypassed the amplifier would pass the level check and fail that one.
  MW_EXPECT(worst < 0.2);
}

MW_TEST("dyn-01 test 3: the low boost reaches its published maximum") {
  ProgramEq unit;
  configureForResponse(unit, 48000.0);
  for (int index = 0; index < 4; ++index) {
    PassiveEqSettings settings;
    settings.lowFreqIndex = index;
    settings.lowBoost = 1.0;
    unit.setEq(settings);
    double peak = -100.0;
    double peakHz = 0.0;
    for (double hz = 5.0; hz <= 500.0; hz *= 1.12) {
      const double db = responseDb(unit, hz, 48000.0, framesFor(hz, 48000.0, 60.0));
      if (db > peak) {
        peak = db;
        peakHz = hz;
      }
    }
    // The offset between the selector's label and the frequency of maximum gain
    // is logged rather than failed on, as the sheet directs: a passive shelf's
    // maximum is at DC and the label names a design centre, not a −3 dB point.
    std::printf("    test 3: %.0f Hz selector peaks %+.2f dB at %.0f Hz (offset %.2f octaves)\n",
                kLowFrequencies[index], peak, peakHz,
                std::log2(peakHz / kLowFrequencies[index]));
    MW_EXPECT_NEAR(peak, kLowBoostMaxDb, 1.0);
  }
}

MW_TEST("dyn-01 test 4: the low attenuation reaches its published maximum") {
  ProgramEq unit;
  configureForResponse(unit, 48000.0);
  for (int index = 0; index < 4; ++index) {
    PassiveEqSettings settings;
    settings.lowFreqIndex = index;
    settings.lowAtten = 1.0;
    unit.setEq(settings);
    double trough = 100.0;
    double troughHz = 0.0;
    for (double hz = 20.0; hz <= 6000.0; hz *= 1.08) {
      const double db = responseDb(unit, hz, 48000.0, framesFor(hz, 48000.0, 60.0));
      if (db < trough) {
        trough = db;
        troughHz = hz;
      }
    }
    std::printf("    test 4: %.0f Hz selector dips %+.2f dB at %.0f Hz\n", kLowFrequencies[index],
                trough, troughHz);
    MW_EXPECT_NEAR(trough, kLowAttenMaxDb, 1.0);
  }
}

MW_TEST("dyn-01 test 5: the low-end trick, which is the whole unit") {
  // The critical test. Any model that returns a flat line here has summed the
  // two legs in decibels, which is what the original operating instructions
  // assumed would happen and what does not.
  ProgramEq unit;
  configureForResponse(unit, 48000.0);
  double dipHzAt[3] = {0, 0, 0};
  const int selectors[3] = {1, 2, 3};  // 30, 60, 100 Hz
  for (int s = 0; s < 3; ++s) {
    PassiveEqSettings settings;
    settings.lowFreqIndex = selectors[s];
    settings.lowBoost = 1.0;
    settings.lowAtten = 1.0;
    unit.setEq(settings);

    const double at30 = responseDb(unit, 30.0, 48000.0, framesFor(30.0, 48000.0, 60.0));
    double dip = 100.0;
    double dipHz = 0.0;
    double spread = 0.0;
    double lowest = 100.0;
    double highest = -100.0;
    for (double hz = 150.0; hz <= 3000.0; hz *= 1.06) {
      const double db = responseDb(unit, hz, 48000.0, framesFor(hz, 48000.0, 60.0));
      if (db < dip) {
        dip = db;
        dipHz = hz;
      }
      lowest = std::min(lowest, db);
      highest = std::max(highest, db);
    }
    spread = highest - lowest;
    dipHzAt[s] = dipHz;
    std::printf("    test 5: %.0f Hz selector — 30 Hz reads %+.2f dB, dip %+.2f dB at %.0f Hz,"
                " spread %.2f dB\n",
                kLowFrequencies[selectors[s]], at30, dip, dipHz, spread);
    if (selectors[s] == 2) {
      // (a), (b) and (c), at the 60 Hz selector the sheet names.
      MW_EXPECT(at30 >= 4.0);
      MW_EXPECT(dip <= -2.0);
      MW_EXPECT(dipHz >= 200.0 && dipHz <= 2000.0);
    }
    MW_EXPECT(spread > 1.0);
  }
  // And the dip moves upward with the selector, which is what makes the two
  // legs one network rather than two independent controls.
  std::printf("    test 5: dip moves %.0f -> %.0f -> %.0f Hz with the selector\n", dipHzAt[0],
              dipHzAt[1], dipHzAt[2]);
  MW_EXPECT(dipHzAt[1] > dipHzAt[0]);
  MW_EXPECT(dipHzAt[2] > dipHzAt[1]);
}

MW_TEST("dyn-01 test 6: the high boost bell, at every selector and both bandwidths") {
  ProgramEq unit;
  configureForResponse(unit, 48000.0);
  for (int index = 0; index < 7; ++index) {
    for (int sharp = 0; sharp < 2; ++sharp) {
      PassiveEqSettings settings;
      settings.highFreqIndex = index;
      settings.highBoost = 1.0;
      settings.bandwidth = sharp == 1 ? 1.0 : 0.0;
      unit.setEq(settings);
      const double centre = kHighFrequencies[index];
      double peak = -100.0;
      double lower = 0.0;
      double upper = 0.0;
      // Walk outward from the centre for the −3 dB points. Recorded rather than
      // graded: no published bandwidth figure exists, so this establishes the
      // baseline a regression would move.
      for (double hz = centre / 8.0; hz <= std::min(centre * 8.0, 22000.0); hz *= 1.05) {
        const double db = responseDb(unit, hz, 48000.0, framesFor(hz, 48000.0, 60.0));
        if (db > peak) peak = db;
      }
      for (double hz = centre; hz >= centre / 16.0; hz /= 1.02) {
        if (responseDb(unit, hz, 48000.0, framesFor(hz, 48000.0, 40.0)) < peak - 3.0) {
          lower = hz;
          break;
        }
      }
      for (double hz = centre; hz <= 23000.0; hz *= 1.02) {
        if (responseDb(unit, hz, 48000.0, framesFor(hz, 48000.0, 40.0)) < peak - 3.0) {
          upper = hz;
          break;
        }
      }
      const double octaves = (lower > 0.0 && upper > 0.0) ? std::log2(upper / lower) : 0.0;
      // The width is measured 3 dB below the *peak*, which for an 18 dB bell is
      // near its top and is a much narrower figure than the RBJ Q's own −3 dB
      // bandwidth. Recorded rather than graded — no published bandwidth exists
      // for this control — so the definition matters only for comparing one run
      // against the next, and it is stated so that a later reader does not
      // compare it against a differently-defined number.
      std::printf("    test 6: %5.0f Hz %s peak %+.2f dB, %.2f octaves at -3 dB from peak\n", centre,
                  sharp == 1 ? "SHARP" : "BROAD", peak, octaves);
      MW_EXPECT_NEAR(peak, kHighBoostMaxDb, 1.5);
    }
  }
}

MW_TEST("dyn-01 test 7: BANDWIDTH touches nothing but the boost bell") {
  ProgramEq unit;
  configureForResponse(unit, 48000.0);
  double worst = 0.0;
  for (double hz = 100.0; hz <= 18000.0; hz *= 1.6) {
    PassiveEqSettings broad;
    broad.highBoost = 0.0;
    broad.bandwidth = 0.0;
    unit.setEq(broad);
    const double a = responseDb(unit, hz, 48000.0, framesFor(hz, 48000.0, 40.0));
    PassiveEqSettings sharp = broad;
    sharp.bandwidth = 1.0;
    unit.setEq(sharp);
    const double b = responseDb(unit, hz, 48000.0, framesFor(hz, 48000.0, 40.0));
    worst = std::max(worst, std::fabs(a - b));
  }
  std::printf("    test 7: BANDWIDTH swept with the boost at zero, worst change %.6f dB\n", worst);
  MW_EXPECT(worst < 0.1);
}

MW_TEST("dyn-01 test 8: the high attenuation is a shelf, not a bell") {
  for (double rate : {48000.0, 96000.0}) {
    ProgramEq unit;
    configureForResponse(unit, rate);
    for (int index = 0; index < 3; ++index) {
      PassiveEqSettings settings;
      settings.attenSelIndex = index;
      settings.highAtten = 1.0;
      unit.setEq(settings);
      const double corner = kAttenFrequencies[index];
      // The asymptote, measured as high as the rate allows. A shelf has
      // reached its final value two octaves above its corner; a bell has come
      // back up, which is what this separates.
      const double top = rate > 50000.0 ? 40000.0 : 22000.0;
      const double asymptote = responseDb(unit, top, rate, framesFor(top, rate, 60.0));
      const double atTwice = responseDb(unit, std::min(corner * 4.0, top), rate,
                                        framesFor(std::min(corner * 4.0, top), rate, 60.0));
      std::printf("    test 8 at %.0f Hz: %5.0f Hz selector, %.0f Hz reads %+.2f dB,"
                  " two octaves up %+.2f dB\n",
                  rate, corner, top, asymptote, atTwice);
      // Graded where the rate can express the asymptote. At a 48 kHz host the
      // 20 kHz selector's corner is at Nyquist's doorstep and its shelf has
      // nowhere left to settle — that is a property of the sample rate, not of
      // the model, so it is recorded there and graded at 96 kHz.
      if (rate > 50000.0 || index < 2) {
        MW_EXPECT_NEAR(asymptote, kHighAttenMaxDb, 1.5);
        MW_EXPECT(std::fabs(asymptote - atTwice) < 1.0);
      }
    }
  }
}

MW_TEST("dyn-01 test 9: the HF selector does nothing with the boost at zero") {
  ProgramEq unit;
  configureForResponse(unit, 48000.0);
  double worst = 0.0;
  for (double hz = 200.0; hz <= 18000.0; hz *= 1.6) {
    double first = 0.0;
    for (int index = 0; index < 7; ++index) {
      PassiveEqSettings settings;
      settings.highFreqIndex = index;
      settings.highBoost = 0.0;
      settings.highAtten = 1.0;  // the attenuation is on, and has its own selector
      unit.setEq(settings);
      const double db = responseDb(unit, hz, 48000.0, framesFor(hz, 48000.0, 40.0));
      if (index == 0) first = db;
      worst = std::max(worst, std::fabs(db - first));
    }
  }
  std::printf("    test 9: HI FREQ swept with the boost at zero, worst change %.6f dB\n", worst);
  MW_EXPECT(worst < 0.1);
}

MW_TEST_MAIN("program-eq")
