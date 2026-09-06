// Motion Wave — the state-variable filter with its controls moving.
//
// `svf_tests.cpp` is what the filter does to a steady signal. This suite is
// what happens when the cutoff, the resonance or the mode moves underneath it:
// the modulation sweeps, the clamp that keeps a swept cutoff off the Nyquist
// pole, the resonance law those sweeps are expressed in, `Off` as a wire and as
// a thing with no memory, the two process forms agreeing, and the real-time
// guarantee. The apparatus is `svf_harness.h`.
//
// **The brief's modulation case does not test what its title implies, and that
// is a finding rather than a footnote.** It asks for a 5 Hz sine over two
// octaves at Q = 4, with no sample-to-sample step larger than 3× the
// held-cutoff step. It passes — and it passes identically through a direct-form
// biquad retuned per sample, 0.994 against 0.994, the same number to three
// figures. At 5 Hz the cutoff moves about 0.02 % per sample, which a direct
// form tracks perfectly well. A row whose mutation passes is a row that is not
// testing what its title implies, which is the failure `CLAUDE.md` describes at
// spec level, so both rows are here: the brief's, recording the negative
// result, and the audio-rate one that actually discriminates. `smp-01` §4.1
// hands every voice per-sample cutoff arrays and §6.3 makes `CUTOFF` a matrix
// destination, so audio-rate modulation is the real case and not a stress test.
//
// Mutation-tested, each edit restored before the next. The mutations this
// suite is the one to catch:
//   `Off` running the integrators and returning `o.low` → red: the bit-exact
//     row, and only that one; the other two suites stay green.
//   `setMode` not resetting on entry to `Off` → red: the "Off has no memory"
//     row, and nothing else.
//   the cutoff clamp's ceiling raised from 0.45·fs to 0.999·fs (so `tan` runs
//     towards the Nyquist pole) → red: the clamp row, and only that one.
//   `qForResonance` mapped linearly, `kMinQ + r·(kMaxQ − kMinQ)` → red: the
//     Q-mapping row, 6 failures — the 50 % value (4.20 against 12.85), both
//     clamp round-trips and the peak heights that follow from them.
//   an unwarped gain applied to `tune` only → red: 1 failure here (the clamp
//     row) and 2 in `svf_tests.cpp` (the notch and the drawn curve). Its pair — the same
//     mutation applied to `gainFor`, which `magnitudeAt` shares — is invisible
//     to every row that compares the drawn curve against the audio, because
//     both sides move together; that suite's header derives why.
//
// Eight mutations were run across the two suites and eight were caught.
#include "../dsp/biquad.h"
#include "rt_guard.h"
#include "svf_harness.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw::dsp;
using namespace mw::test::svf;

namespace {

/**
 * The mutation: the same sweep through a direct-form biquad retuned per sample.
 *
 * `Biquad` is the core's own transposed direct form II, and `lowpassCoeffs` is
 * the RBJ cookbook — a correct, shipping, second-order lowpass. Nothing is
 * wrong with it except that its state is a pair of coefficient-scaled delayed
 * outputs, so recomputing the coefficients under it changes what the stored
 * numbers mean. This is the artefact the trapezoidal form exists to avoid, and
 * running it here rather than describing it is what makes the claim a
 * measurement.
 */
SweepResult sweepBiquad(double modHz, double centreHz, double octaves, double q, double heldHz) {
  Biquad biquad;
  biquad.reset();
  const int frames = static_cast<int>(kRate * 2.0);
  const int skip = static_cast<int>(kRate * 0.25);
  SweepResult out;
  double previous = 0.0;
  for (int n = 0; n < frames; ++n) {
    const double t = static_cast<double>(n) / kRate;
    const double fc = heldHz > 0.0
                          ? heldHz
                          : centreHz * std::exp2(octaves * std::sin(2.0 * kPi * modHz * t));
    biquad.setCoeffs(lowpassCoeffs(fc, q, kRate));
    const double y = biquad.process(sawAt(n, kRate));
    if (!std::isfinite(y)) {
      out.finite = false;
      return out;
    }
    if (n > skip) {
      out.largestStep = std::fmax(out.largestStep, std::fabs(y - previous));
      out.peak = std::fmax(out.peak, std::fabs(y));
    }
    previous = y;
  }
  return out;
}

}  // namespace

MW_TEST("a 5 Hz cutoff sweep is no rougher than a held cutoff — and does not discriminate") {
  /*
   * The brief's case, run and reported honestly: a 5 Hz sine over two octaves
   * at Q = 4, against 3× the largest step of the same filter with the cutoff
   * held at either extreme.
   *
   * It passes, and it proves nothing about the topology. At 5 Hz the cutoff
   * moves about 0.02 % per sample, which a direct-form biquad tracks perfectly
   * well — the mutation below reads 0.994 through the biquad and 0.994 through
   * this filter, the same number to three figures. **A row whose mutation
   * passes is a row that is not testing what its title implies**, which is the
   * failure `CLAUDE.md` describes at spec level, so the discriminating case is
   * the row after this one and this row's job is to record that the slow sweep
   * is clean rather than to claim it distinguishes anything.
   */
  const double resonance = Svf::resonanceForQ(4.0);
  const double centre = 1000.0;
  const SweepResult swept = sweepSvf(5.0, centre, 1.0, resonance, 0.0);
  const SweepResult low = sweepSvf(0.0, 0.0, 0.0, resonance, centre * 0.5);
  const SweepResult high = sweepSvf(0.0, 0.0, 0.0, resonance, centre * 2.0);
  const double held = std::fmax(low.largestStep, high.largestStep);
  std::printf("    5 Hz sweep: largest step %.6f, held %.6f, ratio %.3f (limit 3.0)\n",
              swept.largestStep, held, swept.largestStep / held);

  const SweepResult biquadSwept = sweepBiquad(5.0, centre, 1.0, 4.0, 0.0);
  const SweepResult biquadLow = sweepBiquad(0.0, 0.0, 0.0, 4.0, centre * 0.5);
  const SweepResult biquadHigh = sweepBiquad(0.0, 0.0, 0.0, 4.0, centre * 2.0);
  const double biquadHeld = std::fmax(biquadLow.largestStep, biquadHigh.largestStep);
  std::printf("    5 Hz sweep, direct-form biquad retuned per sample: ratio %.3f — the mutation "
              "passes here, which is why the audio-rate row exists\n",
              biquadSwept.largestStep / biquadHeld);

  MW_EXPECT(swept.finite);
  MW_EXPECT(swept.largestStep <= 3.0 * held);
  // Both measurements have to be measurements: a filter that output silence
  // would satisfy the inequality above with two zeros.
  MW_EXPECT(swept.peak > 0.1);
  MW_EXPECT(held > 1.0e-3);
}

MW_TEST("an audio-rate cutoff sweep is stable here and diverges through a retuned biquad") {
  /*
   * The row that discriminates, and the reason `svf.h` is not a biquad.
   *
   * `smp-01` §4.1 hands every voice per-sample pitch and cutoff arrays, and §6.3
   * makes `CUTOFF` a matrix destination whose sources include audio-rate LFOs.
   * So the cutoff genuinely moves at kilohertz, and the direct form's state —
   * two delayed, coefficient-scaled outputs — stops meaning what the new
   * coefficients assume it means. Every frozen coefficient set is stable; the
   * time-varying recursion is not, and it does not degrade gracefully, it
   * diverges to infinity in under two seconds.
   *
   * 3 kHz, ±1 octave about 1 kHz at Q = 4 is the configuration chosen because
   * the biquad's divergence there is unambiguous rather than marginal — it
   * overflows at sample 79442. The SVF's own ratio on the same sweep is 0.975.
   */
  const double resonance = Svf::resonanceForQ(4.0);
  const double centre = 1000.0;
  const SweepResult swept = sweepSvf(3000.0, centre, 1.0, resonance, 0.0);
  const SweepResult low = sweepSvf(0.0, 0.0, 0.0, resonance, centre * 0.5);
  const SweepResult high = sweepSvf(0.0, 0.0, 0.0, resonance, centre * 2.0);
  const double held = std::fmax(low.largestStep, high.largestStep);
  std::printf("    3 kHz sweep, SVF: largest step %.6f, held %.6f, ratio %.3f, peak %.4f\n",
              swept.largestStep, held, swept.largestStep / held, swept.peak);
  MW_EXPECT(swept.finite);
  MW_EXPECT(swept.largestStep <= 3.0 * held);
  MW_EXPECT(swept.peak > 0.1);

  const SweepResult mutant = sweepBiquad(3000.0, centre, 1.0, 4.0, 0.0);
  std::printf("    3 kHz sweep, direct-form biquad retuned per sample: %s\n",
              mutant.finite ? "finite" : "DIVERGED — this is the artefact the TPT form avoids");
  MW_EXPECT(!mutant.finite);

  // And the mutation must be a fair comparison rather than a broken filter: the
  // same biquad with the cutoff held is well-behaved, so what diverged is the
  // retuning and not the structure.
  const SweepResult mutantHeld = sweepBiquad(0.0, 0.0, 0.0, 4.0, centre);
  MW_EXPECT(mutantHeld.finite);
  MW_EXPECT(mutantHeld.peak > 0.1);
}

MW_TEST("Off is a wire, bit for bit") {
  Svf svf;
  svf.prepare(kRate);
  svf.setMode(Svf::Mode::Off);
  std::vector<float> in(1024);
  std::vector<float> out(1024, 0.0f);
  std::vector<float> cutoff(1024);
  for (std::size_t i = 0; i < in.size(); ++i) {
    in[i] = static_cast<float>(sawAt(static_cast<int>(i), kRate));
    // A moving cutoff, so a mode that ignored `Off` and ran the integrators
    // would be found even if its coefficients happened to be near-unity.
    cutoff[i] = static_cast<float>(200.0 + 8000.0 * static_cast<double>(i) / 1024.0);
  }
  long long differing = 0;
  for (std::size_t i = 0; i < in.size(); ++i) {
    if (svf.process(in[i], cutoff[i], 0.9f) != in[i]) ++differing;
  }
  MW_EXPECT_EQ(differing, 0LL);

  // The block form too, and out of place.
  svf.process(out.data(), in.data(), static_cast<int>(in.size()), cutoff.data(), 0.9f);
  long long blockDiffering = 0;
  for (std::size_t i = 0; i < in.size(); ++i) {
    if (out[i] != in[i]) ++blockDiffering;
  }
  MW_EXPECT_EQ(blockDiffering, 0LL);
  // And in place, which is what a voice chain actually does.
  std::vector<float> scratch = in;
  svf.process(scratch.data(), scratch.data(), static_cast<int>(scratch.size()), cutoff.data(),
              0.9f);
  long long inPlaceDiffering = 0;
  for (std::size_t i = 0; i < in.size(); ++i) {
    if (scratch[i] != in[i]) ++inPlaceDiffering;
  }
  MW_EXPECT_EQ(inPlaceDiffering, 0LL);
  // The row proves nothing about a wire if nothing went through it.
  MW_EXPECT(std::fabs(static_cast<double>(in[600])) > 0.01);
}

MW_TEST("Off has no memory, so leaving it starts from rest") {
  /*
   * A filter switched to Off and back must not replay the ring it was holding
   * when it was switched out. That is not pedantry: `smp-01` §7.4 makes the
   * mode a switch on a live voice, and a resonant tail that reappears seconds
   * later, at the level it had when the user bypassed the filter, is the kind
   * of artefact that gets reported as "the sampler glitches occasionally".
   */
  Svf ringing;
  ringing.prepare(kRate);
  ringing.setMode(Svf::Mode::Bandpass);
  ringing.process(1.0f, 1000.0f, 1.0f);
  for (int n = 0; n < 32; ++n) ringing.process(0.0f, 1000.0f, 1.0f);
  ringing.setMode(Svf::Mode::Off);
  ringing.process(0.0f, 1000.0f, 1.0f);
  ringing.setMode(Svf::Mode::Bandpass);

  Svf fresh;
  fresh.prepare(kRate);
  fresh.setMode(Svf::Mode::Bandpass);

  double worst = 0.0;
  double energy = 0.0;
  for (int n = 0; n < 512; ++n) {
    const float x = static_cast<float>(sawAt(n, kRate));
    const double a = static_cast<double>(ringing.process(x, 1000.0f, 1.0f));
    const double b = static_cast<double>(fresh.process(x, 1000.0f, 1.0f));
    worst = std::fmax(worst, std::fabs(a - b));
    energy += b * b;
  }
  std::printf("    after Off and back: largest difference from a fresh filter %.3e\n", worst);
  MW_EXPECT(worst == 0.0);
  MW_EXPECT(energy > 1.0e-4);
}

MW_TEST("the cutoff is clamped to twenty hertz and to 0.45 of the rate") {
  /*
   * Not "the clamp is present" but "the clamp changes the answer": each
   * out-of-range request must produce the same response as the boundary it is
   * clamped to. A clamp that let `tan` run to the Nyquist pole produces an
   * infinite coefficient, and a filter handed an infinity never recovers — it
   * outputs NaN for the rest of the session, which is `biquad.h`'s comment and
   * is worth having a measurement of rather than a belief about.
   */
  const double resonance = 0.0;
  const double ceilingHz = Svf::kMaxCutoffFraction * kRate;
  const double atCeiling = magnitudeOf(Svf::Mode::Lowpass, kRate, ceilingHz, resonance, 5000.0);
  const double aboveCeiling =
      magnitudeOf(Svf::Mode::Lowpass, kRate, kRate * 0.9, resonance, 5000.0);
  const double atFloor = magnitudeOf(Svf::Mode::Highpass, kRate, 20.0, resonance, 100.0);
  const double belowFloor = magnitudeOf(Svf::Mode::Highpass, kRate, 0.001, resonance, 100.0);
  std::printf("    cutoff %.0f Hz vs %.0f Hz: %.4f dB vs %.4f dB\n", ceilingHz, kRate * 0.9,
              dB(atCeiling), dB(aboveCeiling));
  std::printf("    cutoff 20 Hz vs 0.001 Hz: %.4f dB vs %.4f dB\n", dB(atFloor), dB(belowFloor));
  MW_EXPECT_NEAR(dB(aboveCeiling), dB(atCeiling), 0.001);
  MW_EXPECT_NEAR(dB(belowFloor), dB(atFloor), 0.001);
  // Both readings have to be readings: two NaNs compare unequal, but two
  // silences would satisfy the equality above.
  MW_EXPECT(atCeiling > 1.0e-4);
  MW_EXPECT(atFloor > 1.0e-4);

  // A NaN cutoff pins to the floor rather than poisoning the state, which is
  // what `fmin`/`fmax` buy over comparisons. A modulation chain that divides by
  // a depth of zero is how one arrives.
  Svf svf;
  svf.prepare(kRate);
  svf.setMode(Svf::Mode::Lowpass);
  const double nan = std::nan("");
  for (int n = 0; n < 64; ++n) {
    MW_EXPECT(std::isfinite(svf.process(0.5f, static_cast<float>(nan), 0.5f)));
  }
}

MW_TEST("the block form and the per-sample form are the same filter") {
  // Two ways into one algorithm is two places for it to drift. Bit-exact,
  // because the block form is a loop over the per-sample form and anything
  // else would be a second implementation.
  const int frames = 1024;
  std::vector<float> in(static_cast<std::size_t>(frames));
  std::vector<float> cutoff(static_cast<std::size_t>(frames));
  std::vector<float> block(static_cast<std::size_t>(frames), 0.0f);
  for (int n = 0; n < frames; ++n) {
    const std::size_t i = static_cast<std::size_t>(n);
    in[i] = static_cast<float>(sawAt(n, kRate));
    cutoff[i] = static_cast<float>(300.0 * std::exp2(2.0 * std::sin(0.002 * static_cast<double>(n))));
  }
  for (int m = 0; m < 4; ++m) {
    const Svf::Mode mode = static_cast<Svf::Mode>(m);
    Svf a;
    Svf b;
    a.prepare(kRate);
    b.prepare(kRate);
    a.setMode(mode);
    b.setMode(mode);
    b.process(block.data(), in.data(), frames, cutoff.data(), 0.6f);
    long long differing = 0;
    for (int n = 0; n < frames; ++n) {
      const std::size_t i = static_cast<std::size_t>(n);
      if (a.process(in[i], cutoff[i], 0.6f) != block[i]) ++differing;
    }
    MW_EXPECT_EQ(differing, 0LL);
  }
  // Zero and negative frame counts are a no-op rather than a read off the end
  // of a buffer: a voice whose block is split to zero at a loop point is
  // ordinary, not exceptional.
  Svf svf;
  svf.prepare(kRate);
  svf.setMode(Svf::Mode::Lowpass);
  std::vector<float> untouched(4, 7.0f);
  svf.process(untouched.data(), in.data(), 0, cutoff.data(), 0.5f);
  svf.process(untouched.data(), in.data(), -3, cutoff.data(), 0.5f);
  MW_EXPECT(untouched[0] == 7.0f);
}

MW_TEST("nothing on the audio path allocates, with the cutoff moving every sample") {
  /*
   * ADR-0003 and `smp-01` §4.1 V-27: no allocation, lock, file I/O or logging
   * on a path reachable from the audio callback. The guard is armed around
   * `process` alone — `prepare` is allowed to do whatever it likes, once — and
   * the mode is changed inside the armed scope too, because a setter that
   * allocated only when the mode moved mid-block is exactly the one that
   * reaches a user as a dropout on the take they were recording.
   */
  Svf svf;
  svf.prepare(kRate);
  const int frames = 256;
  std::vector<float> in(static_cast<std::size_t>(frames));
  std::vector<float> out(static_cast<std::size_t>(frames), 0.0f);
  std::vector<float> cutoff(static_cast<std::size_t>(frames));
  double peak = 0.0;
  for (int b = 0; b < 200; ++b) {
    for (int n = 0; n < frames; ++n) {
      const std::size_t i = static_cast<std::size_t>(n);
      const int global = b * frames + n;
      in[i] = static_cast<float>(sawAt(global, kRate));
      cutoff[i] = static_cast<float>(
          1000.0 * std::exp2(2.0 * std::sin(0.0007 * static_cast<double>(global))));
    }
    {
      mw::test::RtGuard guard;
      svf.setMode(static_cast<Svf::Mode>(b % 5));
      svf.process(out.data(), in.data(), frames, cutoff.data(),
                  static_cast<float>(0.5 + 0.5 * std::sin(0.05 * static_cast<double>(b))));
      if (guard.allocations() != 0) {
        std::printf("    block %d allocated %zu time(s)\n", b, guard.allocations());
      }
      MW_EXPECT_EQ(static_cast<long long>(guard.allocations()), 0LL);
    }
    for (float v : out) peak = std::fmax(peak, std::fabs(static_cast<double>(v)));
  }
  std::printf("    200 blocks, per-sample cutoff and a moving mode, no allocation; peak %.4f\n",
              peak);
  // A silent render allocates nothing either.
  MW_EXPECT(peak > 1.0e-3);
}

MW_TEST("the RtGuard is watching rather than asleep") {
  // A guard nobody has seen fire proves nothing — `granular_delay_tests.cpp`
  // V16's pattern, and the reason the row above is a measurement.
  std::vector<float> scratch;
  mw::test::RtGuard guard;
  scratch.resize(4096);
  MW_EXPECT(guard.allocations() > 0);
}

MW_TEST_MAIN("svf-modulation")
