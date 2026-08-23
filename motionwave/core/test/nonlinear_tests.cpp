// Motion Wave — the nonlinear stage library, against `lib-nonlinear.md` §7.
//
// Every case here is one row of that table, with its number rather than a
// paraphrase of it. The rows exist because the five dynamics and console units
// are all calibrated against the same curve, and a library that drifted by a
// decibel would move every one of their acceptance tests at once.
//
// Directive 06 §1 — the standing harness rule — applies to every measurement
// below: the bin width is stated and the probe frequency is chosen to land
// exactly on a bin. That is not tidiness. A 1 kHz probe at these lengths sits
// between bins, and the leakage from a −6 dBFS fundamental through even a
// Blackman-Harris window is comparable to the −80 dBc the even-order
// cancellation test asserts. Coherent sampling removes the question instead of
// bounding it.
#include "../dsp/fft.h"
#include "../dsp/nonlinear/fet_divider.h"
#include "../dsp/nonlinear/magnetic_core.h"
#include "../dsp/nonlinear/specs.h"
#include "../dsp/nonlinear/variable_gain.h"
#include "harness.h"
#include "rt_guard.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::dsp;
using namespace mw::dsp::nl;

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr std::size_t kN = 65536;
constexpr double kRate = 48000.0;
/// 0.732 Hz. Stated because the rule says to state it.
constexpr double kBinHz = kRate / static_cast<double>(kN);

/// The bin nearest `hz`, and the frequency that bin actually is.
struct Probe {
  std::size_t bin;
  double hz;
};

Probe probeFor(double hz) {
  const std::size_t bin = static_cast<std::size_t>(hz / kBinHz + 0.5);
  return {bin, static_cast<double>(bin) * kBinHz};
}

/// Harmonic magnitudes, normalised so `h[0]` is the fundamental.
struct Harmonics {
  double h[6] = {0, 0, 0, 0, 0, 0};
  double ratio(int n) const { return h[0] > 0.0 ? h[n - 1] / h[0] : 0.0; }
  double thd() const {
    double sum = 0.0;
    for (int n = 2; n <= 6; ++n) sum += ratio(n) * ratio(n);
    return std::sqrt(sum);
  }
};

/**
 * Drive `f` with a coherent sine and read its harmonics.
 *
 * The first `kN` samples are discarded: every stage here has a DC-restoration
 * high-pass at 5 Hz, whose settling is a decaying offset that would appear as a
 * skirt around DC and, through the window, under the fundamental.
 */
template <typename Fn>
Harmonics harmonicsOf(Fn&& f, double hz, double amplitude) {
  const Probe probe = probeFor(hz);
  std::vector<double> re(kN, 0.0);
  std::vector<double> im(kN, 0.0);
  const double step = 2.0 * kPi * probe.hz / kRate;
  for (std::size_t i = 0; i < kN; ++i) {
    f(static_cast<float>(amplitude * std::sin(step * static_cast<double>(i))));
  }
  for (std::size_t i = 0; i < kN; ++i) {
    re[i] = static_cast<double>(
        f(static_cast<float>(amplitude * std::sin(step * static_cast<double>(kN + i)))));
  }
  // No window. The probe is coherent — an exact whole number of cycles fits the
  // transform — so a rectangular window leaks nothing at all, and any window
  // would spread each harmonic across three bins for no benefit.
  fft(re, im);
  Harmonics out;
  for (int n = 1; n <= 6; ++n) {
    const std::size_t k = probe.bin * static_cast<std::size_t>(n);
    if (k >= kN / 2) break;
    out.h[n - 1] = std::sqrt(re[k] * re[k] + im[k] * im[k]);
  }
  return out;
}

double db(double ratio) { return 20.0 * std::log10(ratio > 1.0e-12 ? ratio : 1.0e-12); }

}  // namespace

MW_TEST("NL-01: the second-over-third rule holds at the sheet's anchor") {
  // §4.1's worked anchor for the Program EQ's make-up amplifier at +10 dBm,
  // targeting 0.15 % THD with the second harmonic 12 dB above the third.
  TriodeStage stage;
  TriodeStage::Config config;  // the defaults *are* the anchor
  stage.prepare(kRate, config);
  const Harmonics h = harmonicsOf([&](float x) { return stage.process(x); }, 1000.0, 0.2512);
  std::printf("    NL-01 bins %.4f Hz; H2/H1 %.3e, H3/H1 %.3e, THD %.4f %%, H2-H3 %.2f dB\n",
              kBinHz, h.ratio(2), h.ratio(3), h.thd() * 100.0, db(h.ratio(2)) - db(h.ratio(3)));
  MW_EXPECT_NEAR(h.ratio(2), 1.40e-3, 1.40e-3 * 0.15);
  MW_EXPECT_NEAR(h.ratio(3), 3.50e-4, 3.50e-4 * 0.15);
  MW_EXPECT_NEAR(h.thd() * 100.0, 0.144, 0.02);
  MW_EXPECT(db(h.ratio(2)) - db(h.ratio(3)) >= 6.0);
}

MW_TEST("NL-02: the second/third crossover sits where the drive rule says") {
  // §4.1 (4): the two are equal at A = 3·u0. The sweep runs A from half that to
  // twice it, and the ratio must fall monotonically through the crossing — a
  // reversal would mean the two harmonics are not separated by one power of A,
  // which is the property the whole family's character rests on.
  TriodeStage::Config config;
  const double u0 = static_cast<double>(config.bias);
  double crossingA = -1.0;
  double previous = 1.0e9;
  bool monotone = true;
  for (int i = 0; i <= 24; ++i) {
    const double a = u0 * (0.5 + 5.5 * static_cast<double>(i) / 24.0);
    TriodeStage stage;
    stage.prepare(kRate, config);
    const double amplitude = a / static_cast<double>(config.drive);
    const Harmonics h = harmonicsOf([&](float x) { return stage.process(x); }, 1000.0, amplitude);
    const double ratio = h.ratio(2) / h.ratio(3);
    if (ratio > previous * 1.001) monotone = false;
    if (crossingA < 0.0 && ratio <= 1.0) crossingA = a;
    previous = ratio;
  }
  // Against 6·u0, not the 3·u0 the row states. The sheet's own equations put
  // the crossing there: (2) and (3) are equal when 0.4444·u0·A = 0.0741·A²,
  // i.e. A = 6·u0. The 3·u0 in §4.1 is the *6 dB lead* condition (4) — "u0 ≥
  // A/3" — which is a different point on the same sweep, and the prose has
  // conflated the two. Measured 2.000× the stated value, which is the
  // signature of exactly that conflation rather than of a modelling error.
  std::printf("    NL-02 H2/H3 crosses unity at A = %.5f; 6*u0 = %.5f; ratio %.3f\n", crossingA,
              6.0 * u0, crossingA / (6.0 * u0));
  MW_EXPECT(monotone);
  MW_EXPECT_NEAR(crossingA, 6.0 * u0, 6.0 * u0 * 0.12);
  // And the condition the sheet actually derived: at A = 3·u0 the second leads
  // the third by 6 dB. That is the calibration three of the five units use.
  TriodeStage lead;
  lead.prepare(kRate, config);
  const Harmonics h =
      harmonicsOf([&](float x) { return lead.process(x); }, 1000.0,
                  3.0 * u0 / static_cast<double>(config.drive));
  std::printf("    NL-02 at A = 3*u0 the second leads the third by %.2f dB\n",
              db(h.ratio(2)) - db(h.ratio(3)));
  MW_EXPECT_NEAR(db(h.ratio(2)) - db(h.ratio(3)), 6.0, 0.6);
}

MW_TEST("NL-03: a balanced pair cancels even order to the arithmetic floor") {
  PushPullStage stage;
  PushPullStage::Config config;
  config.imbalance = 0.0f;
  config.bias = 0.0f;
  stage.prepare(kRate, config);
  const Harmonics h = harmonicsOf([&](float x) { return stage.process(x); }, 1000.0, 0.5012);
  std::printf("    NL-03 H2 %.1f dBc, H4 %.1f dBc, H3 %.1f dBc\n", db(h.ratio(2)), db(h.ratio(4)),
              db(h.ratio(3)));
  // −80 dBc rather than "below the measured floor": at bias zero the
  // cancellation is term by term, not to a tolerance, so anything above the
  // arithmetic noise means the two halves are not on the same curve.
  MW_EXPECT(db(h.ratio(2)) <= -80.0);
  MW_EXPECT(db(h.ratio(4)) <= -80.0);

  // The stage is working rather than silent. The sheet asks for H3 ≥ −40 dBc,
  // and that is not reachable at the conditions the same row states: at drive
  // 0.2735 and −6 dBFS the curve argument is A = 0.137, and its own equation
  // (3) puts the third harmonic at 0.0741·A² = −57.1 dB. Reaching −40 would
  // need A = 0.37, which is 2.7× the stated input. Measured −57.2 against a
  // predicted −57.1, so the model is right and the threshold was written
  // against a different level. Asserted at −60, which is what "not silent"
  // means here and is still 180 dB above the cancelled even order.
  MW_EXPECT(db(h.ratio(3)) >= -60.0);

  // And the stronger claim the topology actually supports, which the sheet
  // misses: at bias zero the cancellation survives *any* imbalance, because a
  // difference of two evaluations of an odd function at +gx and −gx is odd
  // however either half is scaled. A model that returned even order here would
  // be one where the two halves are not the same curve.
  PushPullStage lopsided;
  PushPullStage::Config mismatched = config;
  mismatched.imbalance = 0.10f;
  lopsided.prepare(kRate, mismatched);
  const Harmonics m = harmonicsOf([&](float x) { return lopsided.process(x); }, 1000.0, 0.5012);
  std::printf("    NL-03 with 10 %% mismatch at bias 0: H2 %.1f dBc\n", db(m.ratio(2)));
  MW_EXPECT(db(m.ratio(2)) <= -80.0);
}

MW_TEST("NL-04: imbalance returns even order in proportion to itself") {
  // At a real operating point, not at bias zero. The sheet's row says "same" as
  // NL-03, i.e. bias 0, and that is impossible for any faithful push-pull
  // model — see the note on `PushPullStage::Config::imbalance`. What the row is
  // really asserting is that the returned even order is *linear* in the
  // mismatch rather than some threshold effect, and that is measured here.
  const double amounts[3] = {0.02, 0.05, 0.10};
  double measured[3] = {0, 0, 0};
  for (int i = 0; i < 3; ++i) {
    PushPullStage stage;
    PushPullStage::Config config;
    config.imbalance = static_cast<float>(amounts[i]);
    config.bias = 0.15f;
    config.imbalancePerBias = 0.0f;  // isolate the parameter under test
    stage.prepare(kRate, config);
    const Harmonics h = harmonicsOf([&](float x) { return stage.process(x); }, 1000.0, 0.5012);
    measured[i] = h.ratio(2);
    std::printf("    NL-04 imbalance %.2f -> H2/H1 %.5f (%.2f x)\n", amounts[i], measured[i],
                measured[i] / amounts[i]);
  }
  // A straight line through the origin. Fitted rather than eyeballed, because
  // "within a tolerance at three points" would also be satisfied by a curve
  // that happened to pass near all three.
  double sxy = 0.0;
  double sxx = 0.0;
  for (int i = 0; i < 3; ++i) {
    sxy += amounts[i] * measured[i];
    sxx += amounts[i] * amounts[i];
  }
  const double slope = sxy / sxx;
  double ssResidual = 0.0;
  double ssTotal = 0.0;
  const double mean = (measured[0] + measured[1] + measured[2]) / 3.0;
  for (int i = 0; i < 3; ++i) {
    const double r = measured[i] - slope * amounts[i];
    ssResidual += r * r;
    ssTotal += (measured[i] - mean) * (measured[i] - mean);
  }
  const double r2 = 1.0 - ssResidual / ssTotal;
  std::printf("    NL-04 slope %.4f, R2 %.6f\n", slope, r2);
  MW_EXPECT(r2 >= 0.99);
  // The proportionality itself is a prediction rather than a free number:
  // H2/H1 = |c2(bias)|·β·A, so at bias 0.15 and A = 0.2735·0.5012 the slope
  // should be about 0.0137·... — computed here from the curve rather than
  // written down, so that changing the curve fails this rather than silently
  // moving it.
  const double a = 0.2735 * 0.5012;
  const double predicted = std::fabs(static_cast<double>(curvature(0.15f).c2)) * a;
  std::printf("    NL-04 slope predicted from the curve: %.4f\n", predicted);
  MW_EXPECT_NEAR(slope, predicted, predicted * 0.20);
}

MW_TEST("NL-05: the ratio rises with gain reduction, from the element") {
  RemoteCutoffCell cell;
  RemoteCutoffCell::Config config;
  cell.prepare(kRate, config);

  // Control voltages giving 3, 10 and 20 dB, solved from the same law the audio
  // uses rather than from a table — a table would be a second opinion about the
  // element, and the point of the cell is that there is only one.
  const double targets[3] = {-3.0, -10.0, -20.0};
  double controls[3] = {0, 0, 0};
  double slopes[3] = {0, 0, 0};
  for (int i = 0; i < 3; ++i) {
    double lo = 0.0;
    double hi = static_cast<double>(config.cutoffVolts) * 0.999;
    for (int step = 0; step < 60; ++step) {
      const double mid = 0.5 * (lo + hi);
      if (static_cast<double>(cell.gainDb(static_cast<float>(mid))) > targets[i]) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    controls[i] = 0.5 * (lo + hi);
    const double d = 1.0e-4;
    slopes[i] = std::fabs(static_cast<double>(cell.gainDb(static_cast<float>(controls[i] + d))) -
                          static_cast<double>(cell.gainDb(static_cast<float>(controls[i] - d)))) /
                (2.0 * d);
    std::printf("    NL-05 %.0f dB at v/Vc %.4f, slope %.2f dB/V\n", targets[i], controls[i],
                slopes[i]);
  }
  MW_EXPECT(slopes[1] > slopes[0]);
  MW_EXPECT(slopes[2] > slopes[1]);
  MW_EXPECT(slopes[2] >= slopes[0] * 1.40);

  // And the distortion rises faster than the gain falls. Measured at matched
  // output, so what is compared is harmonic content and not level.
  double thd[2] = {0, 0};
  const double at[2] = {controls[0], controls[2]};
  for (int i = 0; i < 2; ++i) {
    RemoteCutoffCell probe;
    probe.prepare(kRate, config);
    const double gain = static_cast<double>(probe.linearGain(static_cast<float>(at[i])));
    const Harmonics h = harmonicsOf(
        [&](float x) {
          return static_cast<float>(static_cast<double>(probe.process(x, static_cast<float>(at[i]))) /
                                    gain);
        },
        1000.0, 0.5012);
    thd[i] = h.thd();
  }
  std::printf("    NL-05 THD at 3 dB %.4f %%, at 20 dB %.4f %%, rise %.2f dB\n", thd[0] * 100.0,
              thd[1] * 100.0, db(thd[1]) - db(thd[0]));
  MW_EXPECT(db(thd[1]) - db(thd[0]) >= 10.0);
}

MW_TEST("NL-06: core distortion rises as the frequency falls") {
  MagneticCore::Config config;
  double thd[2] = {0, 0};
  const double freqs[2] = {1000.0, 30.0};
  double h3overH2 = 0.0;
  for (int i = 0; i < 2; ++i) {
    MagneticCore core;
    core.prepare(kRate, config);
    const Harmonics h =
        harmonicsOf([&](float x) { return core.process(x); }, freqs[i], 0.2512);
    thd[i] = h.thd();
    if (i == 1) h3overH2 = db(h.ratio(3)) - db(h.ratio(2));
  }
  std::printf("    NL-06 THD 1 kHz %.4f %%, 30 Hz %.4f %%, rise %.1f dB, H3-H2 at 30 Hz %.1f dB\n",
              thd[0] * 100.0, thd[1] * 100.0, db(thd[1]) - db(thd[0]), h3overH2);
  MW_EXPECT(thd[0] * 100.0 <= 0.03);
  MW_EXPECT_NEAR(thd[1] * 100.0, 1.5, 1.0);
  MW_EXPECT(db(thd[1]) - db(thd[0]) >= 3.0);
  MW_EXPECT(h3overH2 >= 6.0);
}

MW_TEST("NL-07: the hysteresis floor is there at low level and never goes away") {
  MagneticCore::Config config;
  MagneticCore core;
  core.prepare(kRate, config);
  const Harmonics h = harmonicsOf([&](float x) { return core.process(x); }, 30.0, 0.001);
  std::printf("    NL-07 THD at 30 Hz, -60 dBFS: %.4f %%\n", h.thd() * 100.0);
  MW_EXPECT(h.thd() * 100.0 >= 0.02);

  // The mutation, run rather than described. Coercivity is what turns the model
  // from a saturation curve into a hysteresis loop, and the whole reason the
  // library has a play operator is this number — so the test that proves it
  // matters is the one that removes it.
  MagneticCore::Config flat = config;
  flat.coercivity = 0.0f;
  MagneticCore clean;
  clean.prepare(kRate, flat);
  const Harmonics low = harmonicsOf([&](float x) { return clean.process(x); }, 30.0, 0.001);
  std::printf("    NL-07 with coercivity 0: %.5f %% — the floor is the play operator's\n",
              low.thd() * 100.0);
  MW_EXPECT(low.thd() * 100.0 <= 0.001);
}

MW_TEST("NL-08: a feedback winding reduces the core's distortion, never adds") {
  double thd[2] = {0, 0};
  const float cancellation[2] = {0.0f, 0.4f};
  for (int i = 0; i < 2; ++i) {
    MagneticCore::Config config;
    config.feedbackCancellation = cancellation[i];
    MagneticCore core;
    core.prepare(kRate, config);
    const Harmonics h = harmonicsOf([&](float x) { return core.process(x); }, 30.0, 0.2512);
    thd[i] = h.thd();
  }
  const double fraction = thd[1] / thd[0];
  std::printf("    NL-08 THD %.4f %% -> %.4f %% (%.1f %% of the plain core)\n", thd[0] * 100.0,
              thd[1] * 100.0, fraction * 100.0);
  MW_EXPECT(fraction >= 0.40 && fraction <= 0.70);
}

MW_TEST("NL-18: the curvature a face would draw is the curvature the audio has") {
  // The test that keeps a face honest. `curvature()` is what a harmonic-profile
  // display reads; if it and `process` disagree, the picture is a second
  // opinion and the house rule is broken silently.
  int checked = 0;
  double worst2 = 0.0;
  double worst3 = 0.0;
  for (int i = 0; i < 20; ++i) {
    TriodeStage::Config config;
    // Deterministic rather than random: a failing case has to be reproducible,
    // and a seeded generator is one more thing to keep in step between runs.
    config.drive = 0.15f + 0.03f * static_cast<float>(i % 5);
    config.bias = 0.02f + 0.012f * static_cast<float>(i % 7);
    TriodeStage stage;
    stage.prepare(kRate, config);
    const double amplitude = 0.25;
    const Harmonics h = harmonicsOf([&](float x) { return stage.process(x); }, 1000.0, amplitude);
    const Curvature c = stage.curvature();
    const double a = static_cast<double>(config.drive) * amplitude;
    const double predicted2 = std::fabs(static_cast<double>(c.c2)) * a / 2.0;
    const double predicted3 = std::fabs(static_cast<double>(c.c3)) * a * a / 4.0;
    const double e2 = std::fabs(h.ratio(2) / predicted2 - 1.0);
    const double e3 = std::fabs(h.ratio(3) / predicted3 - 1.0);
    if (e2 > worst2) worst2 = e2;
    if (e3 > worst3) worst3 = e3;
    ++checked;
  }
  std::printf("    NL-18 %d configs; worst H2 error %.2f %%, worst H3 error %.2f %%\n", checked,
              worst2 * 100.0, worst3 * 100.0);
  MW_EXPECT(worst2 <= 0.10);
  MW_EXPECT(worst3 <= 0.10);
}

MW_TEST("the library's parameters are declared once and reach the stages") {
  // A control that does nothing is a bug of the same class as a wrong number,
  // and a spec table nothing reads is a whole panel of them. This is the
  // library's half of that guard: every offset resolves to a distinct id from
  // the caller's base, and every one of them lands somewhere a stage reads.
  ParamSpec specs[param::kStageParamCount];
  param::writeStageSpecs(1000, specs);
  for (std::size_t i = 0; i < param::kStageParamCount; ++i) {
    MW_EXPECT_EQ(static_cast<int>(specs[i].id), static_cast<int>(1000 + i));
    MW_EXPECT(specs[i].name[0] != '\0');
  }
  // The oversampling switch names its factors and is never smoothed. A smoothed
  // switch would be interpolating between two latencies.
  MW_EXPECT(specs[param::kOversampling].isChoice());
  MW_EXPECT_EQ(specs[param::kOversampling].steps, 4);
  MW_EXPECT(!specs[param::kOversampling].isSmoothed());

  ParamSet set(specs, param::kStageParamCount);
  set.beginBlock();
  const TriodeStage::Config config = param::triodeConfigFrom(set, 0);
  std::printf("    specs: drive %.4f, bias %.4f from the block's settled values\n",
              static_cast<double>(config.drive), static_cast<double>(config.bias));
  // The defaults arrive as the §4.1 anchor rather than as zero. A stage at zero
  // bias is a symmetric stage, which is a different device from the one three
  // of the five sheets describe.
  MW_EXPECT_NEAR(static_cast<double>(config.drive), 0.2735, 1.0e-4);
  MW_EXPECT_NEAR(static_cast<double>(config.bias), 0.0459, 1.0e-4);
}

MW_TEST("unit variance moves every deviation together, and repeats exactly") {
  TriodeStage::Config stage;
  MagneticCore::Config core;
  const TriodeStage::Config cleanStage = stage;
  const MagneticCore::Config cleanCore = core;

  // Zero must be exactly a calibrated unit, not nearly one: the default has to
  // null against the sheets' numbers, and "nearly" would move every calibration
  // in §4 by an amount nobody chose.
  param::applyVariance(0.0f, 12345u, stage, core);
  MW_EXPECT_NEAR(static_cast<double>(stage.drive), static_cast<double>(cleanStage.drive), 0.0);
  MW_EXPECT_NEAR(static_cast<double>(core.coercivity), static_cast<double>(cleanCore.coercivity),
                 0.0);

  // Deterministic in the seed. Two instances with the same seed must render
  // identically or a bounce and its playback would differ — which is the same
  // failure the modulator's transport-derived phase exists to avoid, arrived at
  // from the other direction.
  TriodeStage::Config a = cleanStage;
  TriodeStage::Config b = cleanStage;
  MagneticCore::Config ca = cleanCore;
  MagneticCore::Config cb = cleanCore;
  param::applyVariance(0.5f, 7u, a, ca);
  param::applyVariance(0.5f, 7u, b, cb);
  MW_EXPECT_NEAR(static_cast<double>(a.drive), static_cast<double>(b.drive), 0.0);
  MW_EXPECT_NEAR(static_cast<double>(ca.saturationFlux), static_cast<double>(cb.saturationFlux),
                 0.0);

  // And every deviation moved, not just one. A variance control that only
  // reached the drive would be a drive trim with a misleading name.
  MW_EXPECT(a.drive != cleanStage.drive);
  MW_EXPECT(a.bias != cleanStage.bias);
  MW_EXPECT(ca.saturationFlux != cleanCore.saturationFlux);
  MW_EXPECT(ca.coercivity != cleanCore.coercivity);
  std::printf("    variance 0.5 at seed 7: drive %.4f -> %.4f, coercivity %.3g -> %.3g\n",
              static_cast<double>(cleanStage.drive), static_cast<double>(a.drive),
              static_cast<double>(cleanCore.coercivity), static_cast<double>(ca.coercivity));
}

MW_TEST("no element in the library allocates on the audio path") {
  // CLAUDE.md's rule, proven rather than reviewed: nothing reachable from
  // `process` may allocate, lock, do file I/O or log. Every element is here
  // because the guard is only as good as its coverage — the oversampler and the
  // triode stage are checked in `oversampler_tests`, and these are the five
  // that were not.
  MagneticCore core;
  core.prepare(kRate, MagneticCore::Config{});
  RemoteCutoffCell cell;
  cell.prepare(kRate, RemoteCutoffCell::Config{});
  PhotoresistiveCell optical;
  optical.prepare(kRate, PhotoresistiveCell::Config{});
  FetDivider fet;
  fet.prepare(kRate, FetDivider::Config{});
  FeedbackBlockStage block;
  block.prepare(kRate, FeedbackBlockStage::Config{});
  ControlShaper shaper;
  shaper.prepare(kRate, ControlShaper::Config{});

  float sink = 0.0f;
  {
    test::RtGuard guard;
    for (int i = 0; i < 4096; ++i) {
      const float x = static_cast<float>(0.4 * std::sin(0.05 * static_cast<double>(i)));
      const float control = static_cast<float>(0.3 + 0.2 * std::sin(0.001 * static_cast<double>(i)));
      sink += core.process(x);
      sink += cell.process(x, control);
      sink += optical.process(x, control);
      sink += fet.process(x, control);
      sink += block.process(x);
      sink += shaper.process(control);
    }
    std::printf("    rt: six elements over 4096 samples, %d allocation(s)\n",
                static_cast<int>(guard.allocations()));
    MW_EXPECT_EQ(static_cast<int>(guard.allocations()), 0);
  }
  // The accumulator is used so the loop cannot be optimised away — a guard over
  // code the compiler deleted proves nothing and looks identical to a pass.
  MW_EXPECT(std::isfinite(sink));
}

MW_TEST("the DC restoration converges, at every rate a wrapper can run it at") {
  // A biased stage's offset has to be removed or it walks into the next stage
  // and biases *it*. The filter that removes it is a one-pole, and in float32 a
  // one-pole with a low corner at a high rate stops converging while its output
  // is still wrong: once (1−c)|x−s| falls below half an ULP of s, the update
  // rounds back to s and the filter sits there for ever.
  //
  // This is not hypothetical and it is not small. Found through the Program EQ,
  // whose two valve stages run inside a 4× wrapper at 192 kHz: the unit settled
  // to a standing −2.0e−4 of DC and its noise-floor test read 30 dB above the
  // manual's figure. The tell was that the offset did not decay — it was the
  // same number after ten seconds as after one, and exactly four times smaller
  // with oversampling off, which is the ratio of (1−c) at the two rates.
  //
  // Every rate a wrapper can present to a stage, so the case fails at the rate
  // where it actually bit rather than only at the host rate.
  for (double rate : {48000.0, 96000.0, 192000.0, 384000.0}) {
    TriodeStage stage;
    TriodeStage::Config config;
    config.restoreHz = 2.0f;
    stage.prepare(rate, config);
    // Ten seconds of silence into a stage biased well away from zero.
    const int frames = static_cast<int>(rate * 10.0);
    float last = 0.0f;
    for (int i = 0; i < frames; ++i) last = stage.process(0.0f);
    std::printf("    DC restore at %7.0f Hz: settles to %+.3e\n", rate,
                static_cast<double>(last));
    // −120 dBFS. The float32 state settles at 2.3e−4 at 192 kHz, which is
    // 66 dB louder than this and would fail by three orders of magnitude.
    MW_EXPECT(std::fabs(static_cast<double>(last)) < 1.0e-6);
  }
}

MW_TEST_MAIN("nonlinear")
