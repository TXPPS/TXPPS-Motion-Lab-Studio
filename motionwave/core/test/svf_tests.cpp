// Motion Wave — the shared state-variable filter's frequency responses.
//
// `smp-01` §2.1 and §7.4: one SVF per voice, five modes. The filter has three
// suites, split because they fail for different reasons and are read by
// different people: this one is what the filter *does* to a steady signal,
// `svf_resonance_tests.cpp` is the resonance control and the law behind it, and
// `svf_modulation_tests.cpp` is what happens when the controls move underneath
// it.
//
// Every response here is measured by driving a sine through the actual sample
// loop and reading the steady state, not by evaluating a transfer function —
// evaluating it would test the arithmetic in `magnitudeAt` against the
// arithmetic in the coefficients, which is two expressions of one belief.
// `magnitudeAt` is then checked against the loop, which is the direction that
// can find a bug in it. The apparatus is `svf_harness.h`.
//
// **Two of the brief's claims about these responses turned out to be
// arithmetically impossible, and they are recorded here rather than absorbed
// into a tolerance.** (A third, about self-oscillation, belongs to the
// resonance control and is argued in `svf_resonance_tests.cpp`.)
//
// 1. "LP within ±0.1 dB of the analytic second-order response at 10 kHz." A
//    discrete filter is the bilinear transform of its prototype, so its
//    response at 10 kHz on a 48 kHz stream is the prototype's at the prewarped
//    ratio `tan(π·10000/48000)/tan(π·1000/48000)` = 11.71, not at 10. The
//    measured −42.74 dB is right and the s-plane's −40.00 dB is the wrong
//    reference; a filter that read −40.00 there would be one that had not been
//    frequency-warped, which no bilinear filter is. So the analytic reference
//    is evaluated at the prewarped ratio and the s-plane figure is printed
//    beside it, because the 2.74 dB is a property of sampling and somebody
//    reading this should see it rather than find it later.
// 2. "Notch within ±0.1 dB of unity two octaves away." At Q = 0.7071 a
//    second-order notch is −0.578 dB two octaves out **by construction** —
//    `|1−x²|/√((1−x²)² + k²x²)` at x = 4, k = √2 — and no implementation of a
//    second-order notch can be nearer. It reaches ±0.1 dB at about three
//    octaves, or at two octaves once Q ≥ 1.9. Both are asserted: the analytic
//    value at two octaves to ±0.02 dB, and unity to ±0.15 dB at three.
//
// Mutation-tested, each edit restored before the next. The mutations this
// suite is the one to catch:
//   `k_` taken as `resonance` rather than `1/Q` → red: 20 failures here and 7
//     in `svf_resonance_tests.cpp` — every magnitude row, the bandpass, the
//     notch, the drawn curve, the corner at all four rates, the key-follow
//     corner, and the resonance suite's whole Q mapping. The modulation suite
//     stays green, which is correct: a wrong damping is a wrong response, not a
//     coefficient-update artefact.
//   `gainFor` returning `πf/fs` instead of `tan(πf/fs)` (the unwarped gain) →
//     red: the notch row only, 1 failure. **This is not what I predicted, and
//     the reason is worth more than the prediction was.** `magnitudeAt` calls
//     `gainFor` too, so mutating it moves the audio *and* the drawn curve by
//     the same amount: the drawn-curve row cannot see it, and the −3 dB row
//     still finds a corner because the whole response shifts coherently and the
//     bisection simply lands on the new one. That is the "same evaluation the
//     audio uses" property doing exactly what it is for, and its cost is that a
//     shared-path mutation is invisible to any row that compares the two sides.
//     What survives is the row with an *external* reference: the notch's
//     analytic skirt.
//   the same unwarped gain applied to `tune` only, leaving `magnitudeAt`'s
//     `tan` alone → red: 2 failures here (the notch and the drawn curve) and
//     the modulation suite's clamp row. Kept beside the one above because together
//     they say which rows depend on an external reference and which on the
//     internal agreement, and only the pair distinguishes them.
//   the two integrator updates written as `v1`/`v2` rather than `2·v−ic` (a
//     forward-Euler SVF instead of the trapezoidal one) → red: 29 failures here
//     and 9 in `svf_resonance_tests.cpp`, including the −3 dB point at every
//     rate. The corner lands about half an octave low, which is the half-sample
//     the trapezoidal rule buys.
//   `Mode::Bandpass` returning the raw `o.band` (constant skirt) instead of
//     `o.bandpass` (constant peak) → red: the bandpass row's four Q values, the
//     three BP rows of the magnitude table and the modes-agree row. This is the
//     mutation that row was written by, and the one it found in the product —
//     see its comment.
//   `notch` computed as `low + high` recomputed from a second evaluation with
//     a stale `k_` → not reachable; `notch` is `v0 − k·v1` from the one
//     evaluation, and the "one state, four outputs" row asserts the identity
//     that makes a second evaluation impossible to add unnoticed.
//
// Eight mutations were run across the three suites and eight were caught.
#include "svf_harness.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw::dsp;
using namespace mw::test::svf;

MW_TEST("the four responses match the second-order prototype within a tenth of a dB") {
  // Q = 0.7071 is `resonance = 0` under this filter's law, which is stated in
  // `svf.h`: a filter the user has not touched must be maximally flat.
  const double resonance = 0.0;
  MW_EXPECT_NEAR(Svf::qForResonance(resonance), kButterworthQ, 1.0e-9);

  struct Row {
    Svf::Mode mode;
    const char* name;
    double hz;
  };
  const Row rows[] = {
      {Svf::Mode::Lowpass, "LP", 100.0},   {Svf::Mode::Lowpass, "LP", 1000.0},
      {Svf::Mode::Lowpass, "LP", 10000.0}, {Svf::Mode::Highpass, "HP", 100.0},
      {Svf::Mode::Highpass, "HP", 1000.0}, {Svf::Mode::Highpass, "HP", 10000.0},
      {Svf::Mode::Bandpass, "BP", 100.0},  {Svf::Mode::Bandpass, "BP", 1000.0},
      {Svf::Mode::Bandpass, "BP", 10000.0},
  };
  for (const Row& row : rows) {
    const double measured = magnitudeOf(row.mode, kRate, kCutoff, resonance, row.hz);
    const double ratio = warpedRatio(row.hz, kCutoff, kRate);
    const double expected = prototypeMagnitude(row.mode, ratio, kButterworthQ);
    const double sPlane = prototypeMagnitude(row.mode, row.hz / kCutoff, kButterworthQ);
    std::printf("    %s @%7.0f Hz: %8.4f dB, prototype at warped ratio %.4f = %8.4f dB"
                " (s-plane %8.4f dB)\n",
                row.name, row.hz, dB(measured), ratio, dB(expected), dB(sPlane));
    MW_EXPECT_NEAR(dB(measured), dB(expected), 0.1);
  }

  /*
   * −3.01 dB at the cutoff, for the lowpass and the highpass. That is the one
   * frequency where the bilinear warp is zero by construction, so it is also
   * the one place the s-plane figure is the right reference.
   *
   * The bandpass is deliberately not in this list. It is 0 dB at its centre —
   * `Mode::Bandpass` is the constant-peak normalisation, so unity there is what
   * it is *for*, at every Q. Asserting −3.01 dB on all three is the reading
   * that would be true of the raw integrator output at Butterworth Q only, and
   * it would go quiet the moment the resonance moved.
   */
  for (Svf::Mode mode : {Svf::Mode::Lowpass, Svf::Mode::Highpass}) {
    MW_EXPECT_NEAR(dB(magnitudeOf(mode, kRate, kCutoff, resonance, kCutoff)), -3.0103, 0.02);
  }
  MW_EXPECT_NEAR(dB(magnitudeOf(Svf::Mode::Bandpass, kRate, kCutoff, resonance, kCutoff)), 0.0,
                 0.02);
}

MW_TEST("the bandpass peaks at the cutoff") {
  // Swept rather than asserted at one point: a bandpass whose peak had moved
  // would still read −3.01 dB at the cutoff if it had moved symmetrically, and
  // the peak's *location* is the claim.
  const double resonance = Svf::resonanceForQ(4.0);
  double best = 0.0;
  double bestHz = 0.0;
  for (double hz = 700.0; hz <= 1400.0; hz += 5.0) {
    const double m = magnitudeOf(Svf::Mode::Bandpass, kRate, kCutoff, resonance, hz);
    if (m > best) {
      best = m;
      bestHz = hz;
    }
  }
  std::printf("    BP peak at %.0f Hz, %.4f dB (Q = %.4f)\n", bestHz, dB(best),
              Svf::qForResonance(resonance));
  // Within one step of the 5 Hz grid.
  MW_EXPECT_NEAR(bestHz, kCutoff, 5.0);

  /*
   * Unity at the centre whatever the resonance, which is the claim that says
   * `Mode::Bandpass` is the constant-*peak* normalisation and not the raw
   * integrator output.
   *
   * This row found the difference. The first version of it asserted 0 dB
   * against `o.band`, which is constant-*skirt* and reads 20·log10(Q) —
   * 12.04 dB at Q = 4, 27.96 dB at full resonance. The measurement was right
   * and the expectation was wrong, and the tempting repair was to widen the
   * tolerance until 12.04 fitted. Deriving it instead settled which output the
   * mode should carry: `biquad.h`'s `bandpassCoeffs` already chose
   * constant-peak for the delay's per-tap filter, on the argument that a filter
   * whose gain rises with its resonance moves a level with a control the user
   * is turning for tone, and `smp-01` §6.3 makes `RESONANCE` a matrix
   * destination on a voice feeding a summed bus. So the filter changed, not the
   * number.
   */
  for (double q : {0.7071067811865476, 2.0, 4.0, 25.0}) {
    const double r = Svf::resonanceForQ(q);
    const double atCentre = magnitudeOf(Svf::Mode::Bandpass, kRate, kCutoff, r, kCutoff);
    std::printf("    BP at the centre, Q = %7.4f: %8.4f dB\n", q, dB(atCentre));
    MW_EXPECT_NEAR(dB(atCentre), 0.0, 0.05);
  }

  // And the raw integrator output is the constant-skirt one, peaking at Q. Both
  // are wanted — the identities in the row below need this one — so the claim
  // is that they differ by exactly Q rather than that either is wrong.
  Svf svf;
  svf.prepare(kRate);
  svf.reset();
  const double q4 = Svf::qForResonance(resonance);
  double rawPeak = 0.0;
  double normalisedPeak = 0.0;
  const int settle = static_cast<int>(kRate);
  for (int n = 0; n < settle + 4096; ++n) {
    const double phase = 2.0 * kPi * kCutoff * static_cast<double>(n) / kRate;
    const Svf::Outputs o =
        svf.processAll(static_cast<float>(std::sin(phase)), static_cast<float>(kCutoff),
                       static_cast<float>(resonance));
    if (n < settle) continue;
    rawPeak = std::fmax(rawPeak, std::fabs(static_cast<double>(o.band)));
    normalisedPeak = std::fmax(normalisedPeak, std::fabs(static_cast<double>(o.bandpass)));
  }
  std::printf("    raw band output peaks at %.4f dB, prototype 20·log10(Q) = %.4f dB\n",
              dB(rawPeak), dB(q4));
  MW_EXPECT_NEAR(dB(rawPeak), dB(q4), 0.05);
  MW_EXPECT_NEAR(dB(normalisedPeak), 0.0, 0.05);
}

MW_TEST("the notch is deep at the cutoff and returns to unity outside it") {
  const double resonance = 0.0;
  const double atCutoff = magnitudeOf(Svf::Mode::Notch, kRate, kCutoff, resonance, kCutoff);
  std::printf("    notch at the cutoff: %.2f dB\n", dB(atCutoff));
  MW_EXPECT(dB(atCutoff) <= -60.0);

  // Two octaves either side, against the prototype rather than against unity.
  // The file header explains why: −0.578 dB is what a second-order notch *is*
  // there at Q = 0.7071, and grading it against unity to ±0.1 dB would be
  // grading it against a number no such filter can produce.
  for (double hz : {250.0, 4000.0}) {
    const double measured = magnitudeOf(Svf::Mode::Notch, kRate, kCutoff, resonance, hz);
    const double expected =
        prototypeMagnitude(Svf::Mode::Notch, warpedRatio(hz, kCutoff, kRate), kButterworthQ);
    std::printf("    notch @%6.0f Hz (two octaves): %.4f dB, prototype %.4f dB\n", hz,
                dB(measured), dB(expected));
    MW_EXPECT_NEAR(dB(measured), dB(expected), 0.02);
  }
  // And the skirt really does close: three octaves out it is inside ±0.15 dB of
  // unity, which is the distance at which the brief's claim becomes true.
  for (double hz : {125.0, 8000.0}) {
    const double measured = magnitudeOf(Svf::Mode::Notch, kRate, kCutoff, resonance, hz);
    std::printf("    notch @%6.0f Hz (three octaves): %.4f dB\n", hz, dB(measured));
    MW_EXPECT_NEAR(dB(measured), 0.0, 0.15);
  }
}

MW_TEST("one state produces all four outputs at once") {
  /*
   * The SVF's defining property, and the reason `smp-01` §7.4 can call the mode
   * a switch rather than four filters: the four responses are four readings of
   * one pair of integrators. The identities below hold sample by sample and are
   * what a second evaluation — a `magnitudeAt` that recomputed its own state, a
   * notch built by running an LP and an HP separately — could not satisfy.
   * This is `CLAUDE.md`'s "a picture is drawn from the same evaluation the
   * audio uses" at the level of the four outputs themselves.
   */
  Svf svf;
  svf.prepare(kRate);
  svf.reset();
  const double resonance = Svf::resonanceForQ(4.0);
  const double k = 1.0 / Svf::qForResonance(resonance);
  double worstNotch = 0.0;
  double worstSum = 0.0;
  double energy = 0.0;
  for (int n = 0; n < 4096; ++n) {
    const float x = static_cast<float>(sawAt(n, kRate));
    const Svf::Outputs o = svf.processAll(x, 1000.0f, static_cast<float>(resonance));
    worstNotch = std::fmax(worstNotch, std::fabs(static_cast<double>(o.notch) -
                                                 (static_cast<double>(o.low) +
                                                  static_cast<double>(o.high))));
    worstSum = std::fmax(
        worstSum, std::fabs(static_cast<double>(x) -
                            (static_cast<double>(o.high) + k * static_cast<double>(o.band) +
                             static_cast<double>(o.low))));
    energy += static_cast<double>(o.band) * static_cast<double>(o.band);
  }
  std::printf("    notch − (low + high): %.3e; input − (high + k·band + low): %.3e\n", worstNotch,
              worstSum);
  // A float round-trip of numbers of order one, so 1e-6 rather than 1e-12.
  MW_EXPECT(worstNotch < 1.0e-6);
  MW_EXPECT(worstSum < 1.0e-6);
  // The identities hold trivially for a silent filter; this says one ran.
  MW_EXPECT(energy > 1.0e-3);
}

MW_TEST("the modes agree with the simultaneous outputs") {
  // `process` selects from `processAll`, so this is bit-exact rather than
  // near. If it ever stops being, a second evaluation has appeared.
  const double resonance = Svf::resonanceForQ(6.0);
  for (int m = 0; m < 4; ++m) {
    const Svf::Mode mode = static_cast<Svf::Mode>(m);
    Svf selected;
    Svf all;
    selected.prepare(kRate);
    all.prepare(kRate);
    selected.setMode(mode);
    long long mismatches = 0;
    for (int n = 0; n < 2048; ++n) {
      const float x = static_cast<float>(sawAt(n, kRate));
      const float fc = static_cast<float>(400.0 + 300.0 * std::sin(0.01 * static_cast<double>(n)));
      const float a = selected.process(x, fc, static_cast<float>(resonance));
      const Svf::Outputs o = all.processAll(x, fc, static_cast<float>(resonance));
      const float b = mode == Svf::Mode::Highpass  ? o.high
                      : mode == Svf::Mode::Bandpass ? o.bandpass
                      : mode == Svf::Mode::Notch    ? o.notch
                                                    : o.low;
      if (a != b) ++mismatches;
    }
    MW_EXPECT_EQ(mismatches, 0LL);
  }
}

MW_TEST("the minus three dB point tracks the cutoff at every sample rate") {
  /*
   * The rate row, and the one that catches an unwarped integrator gain. The
   * error `πf/fs` versus `tan(πf/fs)` shrinks with the sample rate — 2.7 % at
   * 44.1 kHz and 0.16 % at 192 kHz — so a single-rate check written at 192 kHz
   * would let it through. Bisection on the measured response rather than on
   * `magnitudeAt`, so this is the sample loop's own corner.
   */
  const double resonance = 0.0;
  for (double rate : {44100.0, 48000.0, 96000.0, 192000.0}) {
    double low = 500.0;
    double high = 2000.0;
    for (int i = 0; i < 40; ++i) {
      const double mid = 0.5 * (low + high);
      if (dB(magnitudeOf(Svf::Mode::Lowpass, rate, kCutoff, resonance, mid)) > -3.0103) {
        low = mid;
      } else {
        high = mid;
      }
    }
    const double corner = 0.5 * (low + high);
    const double errorPercent = 100.0 * (corner - kCutoff) / kCutoff;
    std::printf("    fs = %6.0f Hz: −3.01 dB at %9.3f Hz (%+.4f %%)\n", rate, corner,
                errorPercent);
    MW_EXPECT(std::fabs(errorPercent) <= 1.0);
  }
}

MW_TEST("key follow gives one octave of cutoff per octave of keyboard at a hundred percent") {
  // §7.4: 100 % is 1:1. Middle C is the root, so the root note itself never
  // moves whatever the follow amount — which is the property that makes the
  // control safe to modulate without detuning the patch's own reference point.
  MW_EXPECT_NEAR(Svf::cutoffFor(1000.0, 1.0, 60.0), 1000.0, 1.0e-9);
  MW_EXPECT_NEAR(Svf::cutoffFor(1000.0, 0.0, 96.0), 1000.0, 1.0e-9);
  MW_EXPECT_NEAR(Svf::cutoffFor(1000.0, 1.0, 72.0), 2000.0, 1.0e-9);
  MW_EXPECT_NEAR(Svf::cutoffFor(1000.0, 1.0, 48.0), 500.0, 1.0e-9);
  // Half follow is half an octave per octave, which is a factor of √2 — not
  // half the frequency change. The distinction is the whole reason §7.4 says
  // the summing is in the octave domain.
  MW_EXPECT_NEAR(Svf::cutoffFor(1000.0, 0.5, 72.0), 1000.0 * std::sqrt(2.0), 1.0e-9);
  // A non-default root, which a zone with a root other than middle C needs.
  MW_EXPECT_NEAR(Svf::cutoffFor(400.0, 1.0, 48.0, 36.0), 800.0, 1.0e-9);
  // Five octaves either side, which `syn-01` §7.1 calls the useful span.
  MW_EXPECT_NEAR(Svf::cutoffFor(1000.0, 1.0, 120.0), 32000.0, 1.0e-6);
  MW_EXPECT_NEAR(Svf::cutoffFor(1000.0, 1.0, 0.0), 1000.0 / 32.0, 1.0e-9);

  // And it reaches the filter: a note an octave up moves the measured corner an
  // octave up. A helper nothing calls is `CLAUDE.md`'s control that does
  // nothing, one layer down.
  const double followed = Svf::cutoffFor(1000.0, 1.0, 72.0);
  double low = 1000.0;
  double high = 4000.0;
  for (int i = 0; i < 40; ++i) {
    const double mid = 0.5 * (low + high);
    if (dB(magnitudeOf(Svf::Mode::Lowpass, kRate, followed, 0.0, mid)) > -3.0103) {
      low = mid;
    } else {
      high = mid;
    }
  }
  std::printf("    key follow 100%%, note 72: cutoff %.1f Hz, measured corner %.1f Hz\n", followed,
              0.5 * (low + high));
  MW_EXPECT_NEAR(0.5 * (low + high), 2000.0, 20.0);
}

MW_TEST("the drawn curve is the filter's own response") {
  // `magnitudeAt` graded against the sample loop, not the other way round. A
  // face that computed its own response from the control values would be a
  // second opinion, and the one that is wrong is always the one nobody is
  // listening to.
  Svf svf;
  svf.prepare(kRate);
  double worst = 0.0;
  for (int m = 0; m < 4; ++m) {
    const Svf::Mode mode = static_cast<Svf::Mode>(m);
    for (double r : {0.0, 0.5, 1.0}) {
      for (double hz : {60.0, 250.0, 1000.0, 4000.0, 15000.0}) {
        const double measured = magnitudeOf(mode, kRate, kCutoff, r, hz);
        const double drawn = svf.magnitudeAt(hz, kCutoff, r, mode);
        // The notch's floor is where a decibel comparison stops meaning
        // anything: both sides are effectively zero at the centre.
        if (measured < 1.0e-4 && drawn < 1.0e-4) continue;
        worst = std::fmax(worst, std::fabs(dB(measured) - dB(drawn)));
      }
    }
  }
  std::printf("    largest disagreement between the drawn curve and the loop: %.4f dB\n", worst);
  MW_EXPECT(worst < 0.05);
  MW_EXPECT(worst > 0.0);  // Sixty measurements that agreed exactly would mean
                           // the loop was not being run.
  // Off is a wire on the curve too, so a bypassed filter draws a flat line
  // rather than whatever its last mode's coefficients say.
  MW_EXPECT_NEAR(svf.magnitudeAt(3000.0, kCutoff, 0.9, Svf::Mode::Off), 1.0, 1.0e-12);
}

MW_TEST_MAIN("svf")
