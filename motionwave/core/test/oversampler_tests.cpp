// Motion Wave — the oversampling wrapper, against `lib-nonlinear.md` §7.
//
// Rows NL-09 to NL-16. The wrapper is the part of the nonlinear library that
// every one of the five units depends on and none of them can check for itself,
// because what it gets wrong is not a sound — it is a *number*: a latency that
// is half a sample out combs against every dry path in the session, and no
// amount of delay compensation fixes a number that was never true.
//
// Directive 06 §1 applies to the spectral rows: the bin width is stated, and
// the probe frequency is placed exactly on a bin so that every harmonic and
// every alias of one lands exactly on a bin too — n·f0 mod fs is an integer
// multiple of the bin width when f0 is. The alias grid is therefore resolvable
// by construction rather than by argument.
#include "../dsp/fft.h"
#include "../dsp/nonlinear/oversampler.h"
#include "../dsp/nonlinear/triode_stage.h"
#include "harness.h"
#include "rt_guard.h"

#include <algorithm>
#include <cmath>
#include <chrono>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::dsp;
using namespace mw::dsp::nl;

namespace {

constexpr double kPi = 3.14159265358979323846;

/// The declared latency of each factor, at the host rate. §4.6's table.
constexpr int kDeclared[4] = {0, 37, 46, 49};

/**
 * The nonlinearity a unit in this family actually runs.
 *
 * `curve` at the anchor drive of §4.1, driven full-scale — which is what "the
 * unit's maximum drive" means, since the drive is what maps full scale onto the
 * curve's argument. Its third harmonic is −45 dBc, and the harmonics fall away
 * fast from there, which is the shape of every stage in the library.
 */
struct UnitShaper {
  float operator()(float x) const noexcept { return curve(0.2735f * x) / 0.2735f; }
};

/**
 * A near-clipping shaper, for the recorded stress column.
 *
 * The argument reaches 2.5 against a clamp at 3, which is harder than anything
 * the five units do. It is here because the tier thresholds are only meaningful
 * next to the case that breaks them: at 2× the sixth harmonic of a 15 kHz probe
 * lands at 90 kHz, folds to 6 kHz *inside* the 96 kHz internal rate, and no
 * decimator can remove it because it is already in the audio band when the
 * decimator sees it. That is a property of a 2× tier rather than a defect in
 * one, and it is the argument a unit uses when it chooses 4× instead.
 */
struct HardShaper {
  float operator()(float x) const noexcept { return curve(2.5f * x) * 0.4f; }
};

/// Run `frames` samples through a factor, in one block.
template <int F, typename Shaper>
std::vector<float> runShaped(const std::vector<float>& in, int block, Shaper shaper) {
  Oversampler<F> os;
  std::vector<float> scratch(Oversampler<F>::scratchFloats(block), 0.0f);
  StageScratch slice{scratch.data(), scratch.size()};
  if (!os.prepare(48000.0, block, slice)) return {};
  os.reset();
  std::vector<float> out(in.size(), 0.0f);
  for (std::size_t at = 0; at + static_cast<std::size_t>(block) <= in.size();
       at += static_cast<std::size_t>(block)) {
    os.process(in.data() + at, out.data() + at, block, shaper);
  }
  return out;
}

template <int F>
std::vector<float> runOne(const std::vector<float>& in, int block) {
  return runShaped<F>(in, block, HardShaper{});
}

double db(double ratio) { return 20.0 * std::log10(ratio > 1.0e-15 ? ratio : 1.0e-15); }

}  // namespace

MW_TEST("NL-10: the declared latency is the measured latency, exactly") {
  // At every rate, because a latency stated in samples that was really a time
  // would be right at 48 kHz and wrong everywhere else — which is the failure
  // mode a single-rate test cannot see.
  const double rates[4] = {44100.0, 48000.0, 96000.0, 192000.0};
  for (double rate : rates) {
    std::vector<float> impulse(4096, 0.0f);
    impulse[512] = 1.0f;

    // Factor 1, then 2, 4, 8. Written out rather than looped because the
    // template parameter is a compile-time value and a loop over it would be a
    // recursive template for no gain in clarity.
    {
      Oversampler<1> os;
      MW_EXPECT(os.prepare(rate, 512, StageScratch{}));
      MW_EXPECT_EQ(os.latencySamples(), kDeclared[0]);
    }
    int measured[3] = {0, 0, 0};
    int declared[3] = {0, 0, 0};
    {
      Oversampler<2> os;
      std::vector<float> scratch(Oversampler<2>::scratchFloats(512), 0.0f);
      MW_EXPECT(os.prepare(rate, 512, StageScratch{scratch.data(), scratch.size()}));
      declared[0] = os.latencySamples();
      std::vector<float> out(impulse.size(), 0.0f);
      for (std::size_t at = 0; at + 512 <= impulse.size(); at += 512) {
        os.process(impulse.data() + at, out.data() + at, 512, [](float v) { return v; });
      }
      int best = 0;
      for (std::size_t i = 0; i < out.size(); ++i) {
        if (std::fabs(out[i]) > std::fabs(out[static_cast<std::size_t>(best)])) {
          best = static_cast<int>(i);
        }
      }
      measured[0] = best - 512;
    }
    {
      Oversampler<4> os;
      std::vector<float> scratch(Oversampler<4>::scratchFloats(512), 0.0f);
      MW_EXPECT(os.prepare(rate, 512, StageScratch{scratch.data(), scratch.size()}));
      declared[1] = os.latencySamples();
      std::vector<float> out(impulse.size(), 0.0f);
      for (std::size_t at = 0; at + 512 <= impulse.size(); at += 512) {
        os.process(impulse.data() + at, out.data() + at, 512, [](float v) { return v; });
      }
      int best = 0;
      for (std::size_t i = 0; i < out.size(); ++i) {
        if (std::fabs(out[i]) > std::fabs(out[static_cast<std::size_t>(best)])) {
          best = static_cast<int>(i);
        }
      }
      measured[1] = best - 512;
    }
    {
      Oversampler<8> os;
      std::vector<float> scratch(Oversampler<8>::scratchFloats(512), 0.0f);
      MW_EXPECT(os.prepare(rate, 512, StageScratch{scratch.data(), scratch.size()}));
      declared[2] = os.latencySamples();
      std::vector<float> out(impulse.size(), 0.0f);
      for (std::size_t at = 0; at + 512 <= impulse.size(); at += 512) {
        os.process(impulse.data() + at, out.data() + at, 512, [](float v) { return v; });
      }
      int best = 0;
      for (std::size_t i = 0; i < out.size(); ++i) {
        if (std::fabs(out[i]) > std::fabs(out[static_cast<std::size_t>(best)])) {
          best = static_cast<int>(i);
        }
      }
      measured[2] = best - 512;
    }
    std::printf("    NL-10 %.0f Hz: declared %d/%d/%d, measured %d/%d/%d\n", rate, declared[0],
                declared[1], declared[2], measured[0], measured[1], measured[2]);
    for (int i = 0; i < 3; ++i) {
      MW_EXPECT_EQ(declared[i], kDeclared[i + 1]);
      MW_EXPECT_EQ(measured[i], declared[i]);
    }
  }
}

MW_TEST("NL-11: the 1x path is an exact bypass, not a wrapper at unity") {
  // Exactly zero, not −140 dBFS. A halfband pair run at unity would still
  // truncate the top octave and still ripple, and the units' own bypass tests
  // assert −120 dBFS which neither of those reaches. So 1× must not be a
  // wrapper at all.
  std::vector<float> input(48000, 0.0f);
  for (std::size_t i = 0; i < input.size(); ++i) {
    const double t = static_cast<double>(i) / 48000.0;
    input[i] = static_cast<float>(0.4 * std::sin(2.0 * kPi * 220.0 * t) +
                                  0.3 * std::sin(2.0 * kPi * 3170.0 * t) +
                                  0.2 * std::sin(2.0 * kPi * 11000.0 * t));
  }
  const std::vector<float> wrapped = runOne<1>(input, 128);
  float worst = 0.0f;
  for (std::size_t i = 0; i < input.size(); ++i) {
    const float direct = HardShaper{}(input[i]);
    const float d = std::fabs(wrapped[i] - direct);
    if (d > worst) worst = d;
  }
  std::printf("    NL-11 worst difference against calling the shaper directly: %g\n",
              static_cast<double>(worst));
  MW_EXPECT_NEAR(static_cast<double>(worst), 0.0, 0.0);
}

MW_TEST("NL-12: the wrapper spends none of a unit's flatness budget") {
  // ±0.01 dB, against a budget of ±0.8 dB in the units that are graded on it.
  // Halfbands are self-complementary, so the passband ripple *is* the stopband
  // ripple — designing the first stage for −100 dB buys the flatness for free,
  // and this is the case that proves the design was actually done that way.
  Oversampler<4> os;
  std::vector<float> scratch(Oversampler<4>::scratchFloats(1024), 0.0f);
  MW_EXPECT(os.prepare(48000.0, 1024, StageScratch{scratch.data(), scratch.size()}));
  double worst = 0.0;
  double worstHz = 0.0;
  for (double hz = 20.0; hz <= 19000.0; hz *= 1.35) {
    os.reset();
    const int frames = 16384;
    std::vector<float> in(static_cast<std::size_t>(frames), 0.0f);
    std::vector<float> out(static_cast<std::size_t>(frames), 0.0f);
    for (int i = 0; i < frames; ++i) {
      in[static_cast<std::size_t>(i)] =
          static_cast<float>(0.25 * std::sin(2.0 * kPi * hz * static_cast<double>(i) / 48000.0));
    }
    for (int at = 0; at + 1024 <= frames; at += 1024) {
      os.process(in.data() + at, out.data() + at, 1024, [](float v) { return v; });
    }
    // Peak of the settled tail, past the wrapper's own latency and its filters'
    // ring. A peak taken from the head would be measuring the transient.
    double peakIn = 0.0;
    double peakOut = 0.0;
    for (int i = 8192; i < frames; ++i) {
      peakIn = std::max(peakIn, std::fabs(static_cast<double>(in[static_cast<std::size_t>(i)])));
      peakOut = std::max(peakOut, std::fabs(static_cast<double>(out[static_cast<std::size_t>(i)])));
    }
    const double error = std::fabs(db(peakOut / peakIn));
    if (error > worst) {
      worst = error;
      worstHz = hz;
    }
  }
  std::printf("    NL-12 worst passband error %.5f dB at %.0f Hz\n", worst, worstHz);
  MW_EXPECT(worst <= 0.01);
}

MW_TEST("NL-13: the render does not depend on how it was cut into blocks") {
  std::vector<float> input(24576, 0.0f);
  for (std::size_t i = 0; i < input.size(); ++i) {
    const double t = static_cast<double>(i) / 48000.0;
    input[i] = static_cast<float>(0.5 * std::sin(2.0 * kPi * 97.0 * t) +
                                  0.3 * std::sin(2.0 * kPi * 4400.0 * t));
  }
  const std::vector<float> reference = runOne<8>(input, 128);
  for (int block : {16, 64, 256, 1024}) {
    const std::vector<float> got = runOne<8>(input, block);
    double worst = 0.0;
    // Compared over the whole render minus the last partial block, since a
    // block size that does not divide the length leaves a tail nobody
    // processed and comparing it would be comparing two zeros.
    const std::size_t span = (input.size() / static_cast<std::size_t>(block)) *
                             static_cast<std::size_t>(block);
    for (std::size_t i = 0; i < span; ++i) {
      worst = std::max(worst, std::fabs(static_cast<double>(got[i] - reference[i])));
    }
    std::printf("    NL-13 block %4d: worst %g\n", block, worst);
    MW_EXPECT(worst <= 6.0e-8);
  }
}

MW_TEST("NL-09: the alias floor is what each tier claims") {
  // 15 kHz at full drive. Every harmonic of it is above Nyquist at a 48 kHz
  // host, so every one comes back as an alias — this is the worst probe rather
  // than a representative one, which is the point.
  constexpr std::size_t kN = 32768;
  constexpr double kBinHz = 48000.0 / static_cast<double>(kN);
  const std::size_t bin = static_cast<std::size_t>(15000.0 / kBinHz + 0.5);
  const double hz = static_cast<double>(bin) * kBinHz;
  std::printf(
      "    NL-09 bins %.4f Hz, probe %.2f Hz on bin %zu; every harmonic and every alias of\n"
      "          one lands on a bin, so the alias grid is resolvable by construction\n",
      kBinHz, hz, bin);

  std::vector<float> input(kN * 2, 0.0f);
  for (std::size_t i = 0; i < input.size(); ++i) {
    input[i] = static_cast<float>(std::sin(2.0 * kPi * hz * static_cast<double>(i) / 48000.0));
  }

  // Only harmonics that fit *below* Nyquist are legitimate. The first version
  // of this marked a harmonic's folded bin legitimate too, which credited every
  // alias as though it were the thing that caused it and reported a −241 dBFS
  // floor from a render full of aliasing. At this probe and this host rate that
  // leaves exactly one legitimate line, the fundamental.
  std::vector<bool> legitimate(kN / 2, false);
  for (int n = 1; n <= 40; ++n) {
    const std::size_t k = bin * static_cast<std::size_t>(n);
    if (k >= kN / 2) break;
    legitimate[k] = true;
  }

  auto floorOf = [&](const std::vector<float>& out) {
    std::vector<double> re(kN, 0.0);
    std::vector<double> im(kN, 0.0);
    for (std::size_t i = 0; i < kN; ++i) re[i] = static_cast<double>(out[kN + i]);
    fft(re, im);
    const double fundamental = std::sqrt(re[bin] * re[bin] + im[bin] * im[bin]);
    double top = 0.0;
    for (std::size_t k = 2; k < kN / 2; ++k) {
      // The audible band below the probe. Content above 15 kHz is where the
      // images legitimately live and is not what a listener hears as aliasing.
      if (static_cast<double>(k) * kBinHz >= 15000.0) break;
      if (legitimate[k]) continue;
      top = std::max(top, std::sqrt(re[k] * re[k] + im[k] * im[k]));
    }
    return db(top / fundamental);
  };

  const double limits[4] = {0.0, -60.0, -70.0, -80.0};
  double graded[4] = {0, 0, 0, 0};
  double stress[4] = {0, 0, 0, 0};
  graded[0] = floorOf(runShaped<1>(input, 1024, UnitShaper{}));
  graded[1] = floorOf(runShaped<2>(input, 1024, UnitShaper{}));
  graded[2] = floorOf(runShaped<4>(input, 1024, UnitShaper{}));
  graded[3] = floorOf(runShaped<8>(input, 1024, UnitShaper{}));
  stress[0] = floorOf(runShaped<1>(input, 1024, HardShaper{}));
  stress[1] = floorOf(runShaped<2>(input, 1024, HardShaper{}));
  stress[2] = floorOf(runShaped<4>(input, 1024, HardShaper{}));
  stress[3] = floorOf(runShaped<8>(input, 1024, HardShaper{}));
  for (int tier = 0; tier < 4; ++tier) {
    std::printf("    NL-09 %dx: at the unit's drive %6.1f dBFS; near clipping %6.1f dBFS\n",
                1 << tier, graded[tier], stress[tier]);
  }
  // 1× is recorded rather than graded — that row exists to publish the untiered
  // figure, which is what a unit's own tier choice is argued from. It reads
  // −44.9 dBFS at the unit's drive, so a tier is not optional for anything in
  // this family.
  for (int tier = 1; tier < 4; ++tier) MW_EXPECT(graded[tier] <= limits[tier]);

  // The stress column is published, not graded, and the reason is worth having
  // in the record: at 2× a near-clipping shaper's sixth harmonic of this probe
  // folds to 6 kHz *inside* the 96 kHz internal rate, where it is already in
  // the audio band before the decimator sees it. No decimator removes it. That
  // is why the FET Limiter's tier question in §8.5 is a real question and not a
  // CPU preference.
  MW_EXPECT(stress[3] < stress[1]);
}

MW_TEST("NL-15/16: prepare allocates once, process never") {
  std::vector<float> scratch(Oversampler<8>::scratchFloats(256), 0.0f);
  Oversampler<8> os;
  TriodeStage stage;
  {
    // The library's own `prepare` allocates *nothing*: every filter is a fixed
    // array and the scratch is the caller's. The single allocation NL-15 counts
    // is the unit's arena — the `std::vector` above stands in for it here, and
    // it is deliberately outside the guard so that what is being measured is
    // the library rather than the test's own bookkeeping.
    test::RtGuard guard;
    os.prepare(48000.0, 256, StageScratch{scratch.data(), scratch.size()});
    stage.prepare(48000.0, TriodeStage::Config{});
    std::printf("    NL-15 prepare of the wrapper and a stage: %d allocation(s)\n",
                static_cast<int>(guard.allocations()));
    MW_EXPECT_EQ(static_cast<int>(guard.allocations()), 0);
  }
  std::vector<float> in(256, 0.1f);
  std::vector<float> out(256, 0.0f);
  os.process(in.data(), out.data(), 256, [&](float v) { return stage.process(v); });
  {
    test::RtGuard guard;
    for (int i = 0; i < 8; ++i) {
      os.process(in.data(), out.data(), 256, [&](float v) { return stage.process(v); });
    }
    std::printf("    NL-16 eight blocks at 8x: %d allocation(s)\n", static_cast<int>(guard.allocations()));
    MW_EXPECT_EQ(static_cast<int>(guard.allocations()), 0);
  }
}

MW_TEST("NL-14: a silent chain costs no more than a loud one") {
  // Denormals arrive silently as a tail decays and cost hundreds of cycles per
  // sample on some hardware — a dropout that only happens after the music
  // stops. Every filter state in this library is flushed at 1e−30 for that
  // reason, and this is the case that proves the flush is load-bearing rather
  // than decorative.
  //
  // It is a *timing* measurement, which on a shared machine is the least
  // trustworthy kind. The ratio is therefore reported at every run and asserted
  // loosely: a chain that had stalled on denormals reads several times slower,
  // not ten per cent, so a loose bound still separates the two states while a
  // tight one would only measure the machine's mood.
  Oversampler<8> os;
  std::vector<float> scratch(Oversampler<8>::scratchFloats(256), 0.0f);
  MW_EXPECT(os.prepare(48000.0, 256, StageScratch{scratch.data(), scratch.size()}));
  TriodeStage stage;
  stage.prepare(48000.0, TriodeStage::Config{});

  std::vector<float> loud(256, 0.0f);
  std::vector<float> silence(256, 0.0f);
  std::vector<float> out(256, 0.0f);
  for (int i = 0; i < 256; ++i) {
    loud[static_cast<std::size_t>(i)] =
        static_cast<float>(0.89 * std::sin(2.0 * kPi * 220.0 * static_cast<double>(i) / 48000.0));
  }

  auto meanOver = [&](const std::vector<float>& in, int blocks) {
    double total = 0.0;
    for (int b = 0; b < blocks; ++b) {
      const auto start = std::chrono::steady_clock::now();
      os.process(in.data(), out.data(), 256, [&](float v) { return stage.process(v); });
      const auto finish = std::chrono::steady_clock::now();
      total += std::chrono::duration<double>(finish - start).count();
    }
    return total / static_cast<double>(blocks);
  };

  // Paired and repeated, which took three attempts to get right and is worth
  // recording as a probe lesson rather than a detail.
  //
  // The row asks for the worst block in the silent region against the worst
  // block in the loud one, at 1.10×. Measured that way this reads 0.79, 1.58
  // and 1.15 on three consecutive runs of an unchanged binary: the worst block
  // in a minute is whatever the scheduler did, not what the arithmetic did.
  // Switching to the mean helped and was not enough — 0.99, 1.17, 1.02, 0.99 —
  // because the loud phase and the silent phase run at *different times* on a
  // shared machine, so slow drift lands entirely on the ratio.
  //
  // Alternating the two conditions puts both halves of every ratio in the same
  // few hundred milliseconds, and taking the median of several alternations
  // discards the one that collided with something else. Each silent run is
  // 6.4 s of audio because that is how long the 5 Hz restoration filters take
  // to decay from full scale into the denormal range — a shorter run would be
  // measuring silence that has not gone quiet yet.
  constexpr int kBlocksPerRun = 1200;
  double ratios[5] = {0, 0, 0, 0, 0};
  for (int pass = 0; pass < 5; ++pass) {
    const double loudMean = meanOver(loud, kBlocksPerRun);
    const double silentMean = meanOver(silence, kBlocksPerRun);
    ratios[pass] = silentMean / loudMean;
  }
  for (int i = 0; i < 4; ++i) {
    for (int j = i + 1; j < 5; ++j) {
      if (ratios[j] < ratios[i]) {
        const double swap = ratios[i];
        ratios[i] = ratios[j];
        ratios[j] = swap;
      }
    }
  }
  const double ratio = ratios[2];
  std::printf("    NL-14 silent/loud mean-time ratio over 5 paired passes: %.3f %.3f %.3f %.3f"
              " %.3f -> median %.3f\n",
              ratios[0], ratios[1], ratios[2], ratios[3], ratios[4], ratio);
  MW_EXPECT(ratio <= 1.10);
}

MW_TEST_MAIN("oversampler")
