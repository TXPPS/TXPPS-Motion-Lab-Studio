// Motion Wave — the state-variable filter's resonance control.
//
// The third of the SVF's suites. `svf_tests.cpp` measures what the filter does
// to a steady signal at a fixed resonance; `svf_modulation_tests.cpp` measures
// what happens when the controls move underneath it. This one is about the
// resonance control itself: the law that maps 0…100 % to a Q, the peak that law
// produces, the bound on that peak, and what the filter does at the top of the
// travel. They are separated because the resonance law is the one thing here
// that is a *choice* rather than a consequence, and a choice deserves its own
// argument. The apparatus is `svf_harness.h`.
//
// **The Q mapping, and why it is these two endpoints.**
// `Q = 0.7071 · (25/0.7071)^r`. Exponential rather than linear, so the control
// is roughly linear in decibels of peak across its travel — a linear map spends
// most of its rotation in a range where nothing audible changes and then does
// everything in the last tenth.
//
// Zero is Butterworth rather than the conventional 0.5, because `smp-01` §7.4's
// default patch is a lowpass at 20 kHz with resonance at 0, and a filter the
// user has never touched must not colour the sound: Q = 0.5 is −1.3 dB at
// 8 kHz with the cutoff fully open, where 1/√2 — the maximally flat response —
// is −0.1 dB.
//
// **"Self-oscillation at 100 % is acceptable only if bounded" cannot be
// satisfied as written, and the row below says so with a measurement.** This
// filter does not self-oscillate at all, and that is the design rather than a
// shortfall: Q = 25 is a stable pole pair whose impulse response decays to
// exactly zero — the denormal flush takes the tail to zero rather than to a
// denormal — within 60 s. A *linear* SVF oscillates only at infinite Q, where
// its output is unbounded; bounding one needs a saturating feedback path, which
// is a unit's character (`syn-01` §7 and `syn-03` §6.3 both put the
// non-linearity there, and both give a different onset point, so it is a
// parameter and not a constant) and not this building block's. The bound is
// therefore a *gain* bound, derived as `Q/√(1 − 1/2Q²)` = **+27.96 dB** at the
// cutoff rather than measured and then written down.
//
// The ringing row is pointed the way it is deliberately. It asserts that the
// impulse response reaches exactly zero, so a filter that had been given a
// self-oscillating feedback path would fail it. That is the direction the check
// needs to face: self-oscillation is the thing that would arrive by accident.
//
// Mutation-tested, each edit restored before the next. The mutation this suite
// is the one to catch:
//   `qForResonance` mapped linearly, `kMinQ + r·(kMaxQ − kMinQ)` → red: 6
//     failures here and none in either other suite — the 50 % value (4.20
//     against 12.85), both out-of-range clamps, and the peak heights that
//     follow from them.
// Two mutations recorded in `svf_tests.cpp` also turn these rows red, and are
// recorded there because that is where their effect is largest: `k_` taken as
// `resonance` (7 failures here, 20 there) and forward-Euler integrators
// (9 here, 29 there).
//
// Eight mutations were run across the three suites and eight were caught.
#include "svf_harness.h"

#include <cmath>
#include <cstdio>

using namespace mw::dsp;
using namespace mw::test::svf;

MW_TEST("resonance maps to the declared Q range and its peak gain is bounded") {
  /*
   * `Q = 0.7071 · (25/0.7071)^r`. The bound at 100 % is a *gain* bound, not an
   * oscillation bound, because this filter does not self-oscillate: Q = 25 is a
   * stable pole pair. See the file header. The peak of a second-order lowpass
   * is `Q/√(1 − 1/(2Q²))`, which at Q = 25 is 27.96 dB, and that is the number
   * asserted rather than a level chosen to sit above the measurement.
   */
  MW_EXPECT_NEAR(Svf::qForResonance(0.0), 0.70710678, 1.0e-6);
  MW_EXPECT_NEAR(Svf::qForResonance(1.0), 25.0, 1.0e-9);
  MW_EXPECT_NEAR(Svf::qForResonance(0.5), std::sqrt(0.70710678 * 25.0), 1.0e-5);
  // Out-of-range control values are clamped, not extrapolated: a modulator can
  // and will overshoot, and Q = 800 is a filter that rings for a minute.
  MW_EXPECT_NEAR(Svf::qForResonance(1.4), 25.0, 1.0e-9);
  MW_EXPECT_NEAR(Svf::qForResonance(-0.3), 0.70710678, 1.0e-6);
  // Round-trip, which is what lets the rest of this file ask for "Q = 4".
  for (double q : {0.75, 1.5, 4.0, 12.0, 24.0}) {
    MW_EXPECT_NEAR(Svf::qForResonance(Svf::resonanceForQ(q)), q, 1.0e-6);
  }

  for (double r : {0.0, 0.25, 0.5, 0.75, 1.0}) {
    const double q = Svf::qForResonance(r);
    double best = 0.0;
    double bestHz = 0.0;
    for (double hz = 600.0; hz <= 1400.0; hz += 2.0) {
      const double m = magnitudeOf(Svf::Mode::Lowpass, kRate, kCutoff, r, hz);
      if (m > best) {
        best = m;
        bestHz = hz;
      }
    }
    /*
     * At Q = 1/√2 exactly there is no resonant peak — that is what maximally
     * flat means — so the search returns its own lower bound and the reading
     * is the passband, not a peak. Asserting a peak height there would be
     * asserting against a number the search never found, which passes at ±1 dB
     * and means nothing; the claim at that end is the *absence* of a peak
     * instead, which is the property the default resonance is chosen for.
     */
    if (q <= kButterworthQ) {
      std::printf("    resonance %.2f → Q %7.4f: no peak; response at 600 Hz %7.4f dB, at the "
                  "cutoff %7.4f dB\n",
                  r, q, dB(best), dB(magnitudeOf(Svf::Mode::Lowpass, kRate, kCutoff, r, kCutoff)));
      MW_EXPECT_NEAR(bestHz, 600.0, 1.0e-9);  // the grid's edge: monotonic falling
      MW_EXPECT(dB(best) <= 0.0);
      continue;
    }
    const double predicted = q / std::sqrt(1.0 - 1.0 / (2.0 * q * q));
    std::printf("    resonance %.2f → Q %7.4f: LP peak %7.4f dB at %.0f Hz (prototype %7.4f dB)\n",
                r, q, dB(best), bestHz, dB(predicted));
    MW_EXPECT_NEAR(dB(best), dB(predicted), 1.0);
    // The peak has to be inside the search band rather than at its edge, or the
    // comparison above is against whatever the edge happened to read.
    MW_EXPECT(bestHz > 600.0 && bestHz < 1400.0);
  }
  // The stated bound, named as a number rather than left implicit.
  MW_EXPECT_NEAR(dB(25.0 / std::sqrt(1.0 - 1.0 / (2.0 * 25.0 * 25.0))), 27.9623, 0.001);
}

MW_TEST("a resonance sweep on a steady tone stays inside the declared bound") {
  // Resonance moved continuously 0 → 100 % over eight seconds while a tone at
  // the cutoff plays. The bound is the peak gain above plus a decibel of
  // allowance for the sweep's own transient: 0.5 amplitude in, so 12.5 out at
  // +27.96 dB. The row also refuses a silent render.
  Svf svf;
  svf.prepare(kRate);
  svf.setMode(Svf::Mode::Lowpass);
  svf.reset();
  const int frames = static_cast<int>(kRate * 8.0);
  double peak = 0.0;
  for (int n = 0; n < frames; ++n) {
    const double t = static_cast<double>(n) / kRate;
    const double x = 0.5 * std::sin(2.0 * kPi * kCutoff * t);
    const double y = static_cast<double>(svf.process(
        static_cast<float>(x), static_cast<float>(kCutoff), static_cast<float>(t / 8.0)));
    MW_EXPECT(std::isfinite(y));
    peak = std::fmax(peak, std::fabs(y));
  }
  const double bound = 0.5 * 25.0 / std::sqrt(1.0 - 1.0 / (2.0 * 25.0 * 25.0));
  std::printf("    resonance 0→100%% on a tone at the cutoff: peak %.4f (%.3f dB re input), "
              "bound %.4f\n",
              peak, dB(peak / 0.5), bound);
  MW_EXPECT(peak <= bound * 1.02);
  MW_EXPECT(peak > 0.5);
}

MW_TEST("at full resonance the filter rings and then stops, rather than oscillating") {
  /*
   * The brief allows self-oscillation at 100 % if bounded. This filter does not
   * oscillate, and the row says so with a measurement rather than leaving it as
   * an absence: an impulse at Q = 25 decays to *exactly* zero — the denormal
   * flush takes the tail to zero rather than to a denormal — within 60 s. A
   * filter that had been given a self-oscillating feedback path would still be
   * ringing, and this row would fail. That is the direction the check needs to
   * point, because self-oscillation is the thing that would arrive by accident.
   */
  Svf svf;
  svf.prepare(kRate);
  svf.setMode(Svf::Mode::Bandpass);
  svf.reset();
  double peak = 0.0;
  double last = 0.0;
  const int frames = static_cast<int>(kRate * 60.0);
  for (int n = 0; n < frames; ++n) {
    const double y =
        static_cast<double>(svf.process(n == 0 ? 1.0f : 0.0f, 1000.0f, 1.0f));
    peak = std::fmax(peak, std::fabs(y));
    last = std::fabs(y);
  }
  std::printf("    impulse at 100%% resonance: peak %.4f, |y| after 60 s %.3e\n", peak, last);
  /*
   * The floor is derived rather than set under the reading. A unit impulse into
   * the constant-peak bandpass excites the band state by `g/(1 + g(g + k))`
   * — one sample of the integrator's gain — and the normalisation multiplies by
   * `k = 1/25`. At 1 kHz on 48 kHz, `g = tan(π/48) = 0.0655`, so the first
   * output is about 0.0655/25 = 2.6e-3 and the ring's peak is a small multiple
   * of it. A tenth of that is a floor that a genuinely silent filter fails and
   * that this one clears by a factor of twenty.
   */
  const double g = std::tan(kPi * 1000.0 / kRate);
  const double firstSample = (g / (1.0 + g * (g + 1.0 / 25.0))) / 25.0;
  MW_EXPECT(peak > 0.1 * firstSample);
  MW_EXPECT(last == 0.0);
}

MW_TEST_MAIN("svf-resonance")
