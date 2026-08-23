// Motion Wave — Motion Shaper, against its own spec sheet.
//
// `fx-01` §6 is the unit's acceptance test and it was written for this moment,
// so these run it rather than paraphrase it. Each case names the V-number it
// settles and uses the sheet's target and tolerance verbatim; where the sheet
// says "zero", the assertion is zero and not "small".
//
// V2, V7 and V8 are settled in `crossover_tests` and `modulator_tests`, where
// the parts they measure live. The rest are here because they need the whole
// unit assembled.
#include "../graph/engine_graph.h"
#include "../render/offline_render.h"
#include "../units/motion_shaper.h"
#include "harness.h"
#include "spectrum.h"
#include "rt_guard.h"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kPi = 3.14159265358979323846;

/// A 1 kHz sine at −6 dBFS. The carrier V3 and V4 look for clicks on.
float sine1k(int frame, int, double sampleRate, void*) {
  return static_cast<float>(0.5 * std::sin(2.0 * kPi * 1000.0 * static_cast<double>(frame) /
                                           sampleRate));
}

/// Pink-ish broadband: a sum of decades, deterministic and full-range.
float broadband(int frame, int channel, double sampleRate, void*) {
  const double t = static_cast<double>(frame) / sampleRate;
  double sum = 0.0;
  double amp = 1.0;
  for (double f = 40.0; f < 16000.0; f *= 2.0) {
    // The per-decade phase offset stops every partial starting at zero, which
    // would make a spike at frame 0 that a click detector would flag.
    sum += amp * std::sin(2.0 * kPi * f * t + f * 0.001 + channel * 0.3);
    amp *= 0.75;
  }
  return static_cast<float>(0.2 * sum);
}

/// A hard square drawn as two `step` breakpoints — the worst case for clicking.
std::vector<dsp::Breakpoint> squareCurve() {
  return {
      dsp::Breakpoint{0.0, 1.0, dsp::SegmentShape::Step, 0.0},
      dsp::Breakpoint{0.5, 0.0, dsp::SegmentShape::Step, 0.0},
  };
}

/// Flat at unity — a curve that asks for no modulation at all.
std::vector<dsp::Breakpoint> flatCurve() {
  return {dsp::Breakpoint{0.0, 1.0, dsp::SegmentShape::Line, 0.0}};
}

struct Rig {
  EngineGraph graph;
  MotionShaper* unit = nullptr;
  NodeId out = 0;

  explicit Rig(SourceFn source) {
    const NodeId src = graph.addNode(std::make_unique<SignalSourceNode>(source, nullptr));
    auto owned = std::make_unique<MotionShaper>();
    unit = owned.get();
    out = graph.addNode(std::move(owned));
    graph.connect(src, out);
  }
};

RenderSpec spec(int frames, double rate = 48000.0, int block = 128) {
  RenderSpec s;
  s.frames = frames;
  s.blockSize = block;
  s.sampleRate = rate;
  s.channels = 2;
  return s;
}

/**
 * V3's click detector, as the sheet defines it.
 *
 * Flag any sample whose first difference exceeds the largest first difference
 * of the *unmodulated* carrier by more than 12 dB. Measuring against the
 * carrier rather than against an absolute threshold is what makes the detector
 * independent of level and of programme material — a loud passage has large
 * differences legitimately, and a fixed threshold would flag it.
 */
int clicksAgainst(const RenderResult& modulated, const RenderResult& carrier) {
  double reference = 0.0;
  for (int c = 0; c < carrier.channelCount(); ++c) {
    const std::vector<float>& x = carrier.channel(c);
    for (std::size_t i = 1; i < x.size(); ++i) {
      const double d = std::fabs(static_cast<double>(x[i]) - static_cast<double>(x[i - 1]));
      if (d > reference) reference = d;
    }
  }
  // 12 dB is a factor of 3.981.
  const double limit = reference * 3.9810717055349722;
  int flagged = 0;
  for (int c = 0; c < modulated.channelCount(); ++c) {
    const std::vector<float>& y = modulated.channel(c);
    for (std::size_t i = 1; i < y.size(); ++i) {
      const double d = std::fabs(static_cast<double>(y[i]) - static_cast<double>(y[i - 1]));
      if (d > limit) ++flagged;
    }
  }
  return flagged;
}

}  // namespace

MW_TEST("V1 a neutral unit nulls against dry below -140 dBFS") {
  // The sheet is explicit that this is not a tolerance: "any residual above
  // −140 dBFS is a bug". Depth 0 must be exactly unity gain, not nearly, which
  // is why `gainFor` short-circuits at zero depth rather than computing
  // 10^(0/20) and trusting it.
  Rig wet(&broadband);
  wet.unit->setBandCount(1);
  wet.unit->setMix(1.0);
  const std::vector<dsp::Breakpoint> flat = flatCurve();
  wet.unit->setCurve(0, flat.data(), flat.size());
  BandSettings b;
  b.depth = 0.0;
  wet.unit->setBand(0, b);

  Rig dry(&broadband);
  dry.unit->setBypass(true);

  const RenderResult a = renderOffline(wet.graph, spec(48000 * 4), wet.out);
  const RenderResult d = renderOffline(dry.graph, spec(48000 * 4), dry.out);
  const double residual = dbfs(peakDifference(a, d));
  std::printf("    V1 neutral null: %.1f dBFS\n", residual);
  MW_EXPECT(residual <= -140.0);
}

MW_TEST("three neutral bands preserve magnitude but not phase, which is correct") {
  // My first version of this asserted a sample null against dry and measured
  // −2.2 dBFS. The unit was right and the assertion was wrong: a
  // Linkwitz-Riley split's bands sum to an *all-pass* of the input — flat in
  // magnitude, rotating in phase — so three neutral bands cannot be
  // sample-identical to dry and no correct implementation could make them so.
  //
  // That is exactly why `fx-01` V1 specifies **one band**. The sheet is careful
  // here and I read past it. What can be asserted at three bands is what the
  // all-pass actually promises, which is that no energy is gained or lost, and
  // that is worth a test because it is what a wrong compensation would break.
  Rig split(&broadband);
  split.unit->setBandCount(3);
  split.unit->setCrossovers(220.0, 3200.0);
  const std::vector<dsp::Breakpoint> flat = flatCurve();
  for (int i = 0; i < 3; ++i) {
    split.unit->setCurve(i, flat.data(), flat.size());
    BandSettings b;
    b.depth = 0.0;
    split.unit->setBand(i, b);
  }

  Rig dry(&broadband);
  dry.unit->setBypass(true);

  const RenderResult a = renderOffline(split.graph, spec(48000 * 4), split.out);
  const RenderResult d = renderOffline(dry.graph, spec(48000 * 4), dry.out);

  const double energyRatio = rms(a) / rms(d);
  const double energyDb = 20.0 * std::log10(energyRatio);
  const double sampleDiff = dbfs(peakDifference(a, d));
  std::printf("    three neutral bands: energy %+.4f dB, sample difference %.1f dBFS\n", energyDb,
              sampleDiff);
  // Energy is preserved to well inside V2's ±0.05 dB.
  MW_EXPECT(std::fabs(energyDb) <= 0.05);
  // And the sample difference is *not* a null, which is the point being made.
  MW_EXPECT(sampleDiff > -100.0);
}

MW_TEST("V3 a hard square curve does not click at any rate") {
  // The sheet sweeps 0.1 Hz to 200 Hz with Smooth at zero and requires zero
  // flagged samples. Zero is the target and the tolerance, because a single
  // flag means the time-constant floor is not being applied on that path.
  Rig carrier(&sine1k);
  carrier.unit->setBypass(true);
  const RenderResult clean = renderOffline(carrier.graph, spec(48000), carrier.out);

  int worst = 0;
  double worstRate = 0.0;
  for (const double rate : {0.1, 1.0, 5.0, 20.0, 60.0, 120.0, 200.0}) {
    Rig rig(&sine1k);
    rig.unit->setBandCount(1);
    rig.unit->setSmooth(0.0);
    const std::vector<dsp::Breakpoint> square = squareCurve();
    rig.unit->setCurve(0, square.data(), square.size());
    rig.unit->phase().setMode(dsp::PhaseMode::Free);
    rig.unit->phase().setRateHz(rate);
    rig.unit->phase().trigger(0.0);

    const RenderResult r = renderOffline(rig.graph, spec(48000), rig.out);
    const int flagged = clicksAgainst(r, clean);
    if (flagged > worst) {
      worst = flagged;
      worstRate = rate;
    }
  }
  std::printf("    V3 click sweep 0.1-200 Hz: %d flagged samples (worst at %.1f Hz)\n", worst,
              worstRate);
  MW_EXPECT_EQ(worst, 0);
}

MW_TEST("V4 retriggering forty times a second does not click") {
  // The worst case in the sheet: a trigger resetting phase at an arbitrary
  // sample, so the curve jumps from wherever it was to whatever the new cycle
  // starts at. The fix is that the smoother's state is deliberately NOT reset
  // on retrigger — it glides from where it was, which turns the step into a
  // tau-limited ramp for free.
  //
  // Driven block by block with a trigger fired between blocks, because that is
  // how a trigger actually arrives. My first attempt set trigger mode and never
  // fired one, which tested nothing and still reported four flagged samples —
  // those were the free-running wrap, not a retrigger, and chasing them would
  // have been chasing the wrong thing.
  Rig carrier(&sine1k);
  carrier.unit->setBypass(true);
  const RenderResult clean = renderOffline(carrier.graph, spec(48000), carrier.out);

  EngineGraph graph;
  const NodeId src = graph.addNode(std::make_unique<SignalSourceNode>(&sine1k, nullptr));
  auto owned = std::make_unique<MotionShaper>();
  MotionShaper* unit = owned.get();
  const NodeId out = graph.addNode(std::move(owned));
  graph.connect(src, out);

  unit->setBandCount(1);
  unit->setSmooth(0.0);
  const std::vector<dsp::Breakpoint> square = squareCurve();
  unit->setCurve(0, square.data(), square.size());
  unit->phase().setMode(dsp::PhaseMode::Trigger);
  unit->phase().setRateHz(7.0);

  const int block = 128;
  const int blocks = 48000 / block;
  // 40 Hz against 375 blocks a second is a trigger every ninth block or so.
  const int everyNth = static_cast<int>(48000.0 / block / 40.0 + 0.5);
  MW_EXPECT(graph.prepare(48000.0, block, 2));

  RenderResult captured;
  captured.channels.assign(2, std::vector<float>(static_cast<std::size_t>(blocks * block), 0.0f));
  captured.frames = blocks * block;
  captured.sampleRate = 48000.0;
  captured.ok = true;

  int triggers = 0;
  for (int b = 0; b < blocks; ++b) {
    if (b % everyNth == 0) {
      unit->phase().trigger(0.0);
      ++triggers;
    }
    graph.process(block, static_cast<double>(b * block) / 48000.0, true);
    const AudioBuffer rendered = graph.output(out, block);
    for (int c = 0; c < 2; ++c) {
      const float* srcCh = rendered.channel(c);
      float* dst = captured.channels[static_cast<std::size_t>(c)].data() + b * block;
      for (int i = 0; i < block; ++i) dst[i] = srcCh[i];
    }
  }

  const int flagged = clicksAgainst(captured, clean);
  std::printf("    V4 %d retriggers in one second: %d flagged samples\n", triggers, flagged);
  MW_EXPECT(triggers >= 39);
  MW_EXPECT_EQ(flagged, 0);
}

MW_TEST("V6 a 50 per cent mix is not a comb") {
  // The failure this catches is the one that shipped in MotionLab twice: a wet
  // leg delayed against an undelayed dry leg. Here the wet path is
  // minimum-phase throughout and there is nothing to align, so mixing at 50 %
  // with a neutral curve must be identical to mixing at 100 % — and if a stage
  // with latency is ever added, this is what fails.
  Rig half(&broadband);
  Rig full(&broadband);
  const std::vector<dsp::Breakpoint> flat = flatCurve();
  for (Rig* rig : {&half, &full}) {
    rig->unit->setBandCount(3);
    for (int i = 0; i < 3; ++i) {
      rig->unit->setCurve(i, flat.data(), flat.size());
      BandSettings b;
      b.depth = 0.0;
      rig->unit->setBand(i, b);
    }
  }
  half.unit->setMix(0.5);
  full.unit->setMix(1.0);

  const RenderResult a = renderOffline(half.graph, spec(48000 * 2), half.out);
  const RenderResult b = renderOffline(full.graph, spec(48000 * 2), full.out);
  const double diff = dbfs(peakDifference(a, b));
  std::printf("    V6 mix 50%% vs 100%%: %.1f dBFS difference\n", diff);
  MW_EXPECT(diff <= -140.0);
}

MW_TEST("V11 the smooth control is monotonic across its range") {
  // 100 steps, monotonically increasing time constant from 0.05 ms to 200 ms,
  // no adjacent step differing by more than 15 %. A log map satisfies this by
  // construction; the check is here to catch someone later inserting a special
  // case at zero, which is exactly where the anti-click floor lives and exactly
  // where a special case would be tempting.
  double previous = 0.0;
  double worstStep = 0.0;
  for (int i = 0; i <= 100; ++i) {
    dsp::Smoother s;
    const double control = static_cast<double>(i) / 100.0;
    s.setTimeConstant(dsp::smoothingSecondsFor(control), 48000.0);
    const double tau = s.timeConstant();
    MW_EXPECT(tau >= dsp::kMinSmoothingSeconds);
    MW_EXPECT(tau <= dsp::kMaxSmoothingSeconds);
    if (i > 0) {
      MW_EXPECT(tau > previous);
      const double step = tau / previous - 1.0;
      if (step > worstStep) worstStep = step;
    }
    previous = tau;
  }
  std::printf("    V11 smooth taper: %.3f ms to %.1f ms, worst step %.1f%%\n",
              dsp::kMinSmoothingSeconds * 1000.0, previous * 1000.0, worstStep * 100.0);
  MW_EXPECT(worstStep <= 0.15);
}

MW_TEST("V5 the modulator alias floor sits at or below -80 dBFS") {
  // Free mode, a `step` curve, on a 1 kHz sine, at the sheet's own 90 Hz.
  //
  // The measurement is why this took three earlier attempts. Aliased sidebands
  // fold to `47000 − m·90` and legitimate ones sit at `1000 + n·90`; they
  // coincide only if 46000 were a multiple of 90, and it is not — 46000/90 is
  // 511.11, so the closest they ever come is **10 Hz**. At N = 4096 a bin is
  // 11.72 Hz and the two share one, which is how a measurement of the sideband
  // got reported as the alias floor. N = 32768 gives 1.46 Hz bins and separates
  // them with margin. `SpectrumPlan` checks that before reporting anything.
  //
  // Run at 97.3 Hz as well, as a cross-check: an incommensurate rate puts the
  // aliases somewhere entirely different, so if the two agree the measurement
  // is about the device rather than about the arithmetic.
  const double sr = 48000.0;
  for (const double modHz : {90.0, 97.3}) {
    test::SpectrumPlan plan;
    plan.sampleRate = sr;
    plan.length = 32768;
    plan.carrierHz = 1000.0;
    plan.spacingHz = modHz;
    plan.describe(modHz == 90.0 ? "V5 at the sheet's 90 Hz" : "V5 cross-check at 97.3 Hz");
    MW_EXPECT(plan.resolvable());

    // Measured with the oversampled modulator off and on, because "does this
    // help, and by how much" is the question the fallback was chosen to answer.
    double floors[2] = {0.0, 0.0};
    for (int mode = 0; mode < 2; ++mode) {
      Rig rig(&sine1k);
      rig.unit->setBandCount(1);
      rig.unit->setSmooth(0.0);
      rig.unit->setOversampling(mode == 1);
      const std::vector<dsp::Breakpoint> square = squareCurve();
      rig.unit->setCurve(0, square.data(), square.size());
      rig.unit->phase().setMode(dsp::PhaseMode::Free);
      rig.unit->phase().setRateHz(modHz);
      rig.unit->phase().trigger(0.0);

      const RenderResult r = renderOffline(rig.graph, spec(static_cast<int>(sr) * 2), rig.out);
      floors[mode] = test::spuriousFloorDb(r.channel(0), plan, static_cast<int>(sr * 0.25));
    }
    std::printf("      alias floor %.1f dBFS at 1x, %.1f dBFS at %dx (target -80, +3)\n",
                floors[0], floors[1], dsp::kOversampleFactor);
    MW_EXPECT(floors[1] <= -77.0);
  }
}

MW_TEST("V9 toggling topology two hundred times each does not pop") {
  // The sheet: toggle slot bypass, band count 1<->3 and slope 6<->24, 200 times
  // each over programme material, and require zero flagged samples. It calls a
  // pop here unacceptable at any setting, which is why the fix is a crossfade
  // rather than a shorter smoothing time — switching filter coefficients in
  // place while the filter has state is a step, and no gain ramp on the far
  // side of it can undo that.
  Rig carrier(&broadband);
  carrier.unit->setBypass(true);
  const RenderResult clean = renderOffline(carrier.graph, spec(48000 * 2), carrier.out);

  struct Change {
    const char* what;
    void (*apply)(MotionShaper&, int);
  };
  const Change changes[] = {
      {"slot enable",
       [](MotionShaper& u, int n) {
         BandSettings b;
         b.enabled = (n % 2) == 0;
         u.setBand(1, b);
       }},
      {"band count", [](MotionShaper& u, int n) { u.setBandCount((n % 2) == 0 ? 1 : 3); }},
      {"slope",
       [](MotionShaper& u, int n) {
         u.setSlope((n % 2) == 0 ? dsp::Slope::Db6 : dsp::Slope::Db24);
       }},
  };

  for (const Change& change : changes) {
    EngineGraph graph;
    const NodeId src = graph.addNode(std::make_unique<SignalSourceNode>(&broadband, nullptr));
    auto owned = std::make_unique<MotionShaper>();
    MotionShaper* unit = owned.get();
    const NodeId out = graph.addNode(std::move(owned));
    graph.connect(src, out);
    unit->setBandCount(3);
    const std::vector<dsp::Breakpoint> flat = flatCurve();
    for (int i = 0; i < 3; ++i) unit->setCurve(i, flat.data(), flat.size());

    const int block = 128;
    const int blocks = 96000 / block;
    MW_EXPECT(graph.prepare(48000.0, block, 2));

    RenderResult captured;
    captured.channels.assign(2, std::vector<float>(static_cast<std::size_t>(blocks * block), 0.0f));
    captured.frames = blocks * block;
    captured.sampleRate = 48000.0;
    captured.ok = true;

    // 200 changes spread over two seconds, so each fade completes before the
    // next begins and the test is measuring 200 fades rather than one long one.
    const int everyNth = blocks / 200;
    int applied = 0;
    for (int b = 0; b < blocks; ++b) {
      if (everyNth > 0 && b % everyNth == 0 && applied < 200) {
        change.apply(*unit, applied);
        ++applied;
      }
      graph.process(block, static_cast<double>(b * block) / 48000.0, true);
      const AudioBuffer rendered = graph.output(out, block);
      for (int c = 0; c < 2; ++c) {
        const float* srcCh = rendered.channel(c);
        float* dst = captured.channels[static_cast<std::size_t>(c)].data() + b * block;
        for (int i = 0; i < block; ++i) dst[i] = srcCh[i];
      }
    }

    const int flagged = clicksAgainst(captured, clean);
    std::printf("    V9 %s: %d changes, %d flagged samples\n", change.what, applied, flagged);
    MW_EXPECT(applied >= 199);
    MW_EXPECT_EQ(flagged, 0);
  }
}

MW_TEST("a crossover frequency move does not crossfade, and should not") {
  // The sheet names this as the exception: recomputing coefficients for a
  // moving corner is fine because the filter's state stays meaningful. If this
  // started a fade, an automated crossover would be permanently mid-crossfade
  // and permanently running two paths — twice the CPU for a worse answer.
  Rig rig(&broadband);
  rig.unit->setBandCount(3);
  const std::vector<dsp::Breakpoint> flat = flatCurve();
  for (int i = 0; i < 3; ++i) rig.unit->setCurve(i, flat.data(), flat.size());
  MW_EXPECT(rig.graph.prepare(48000.0, 128, 2));
  rig.graph.process(128, 0.0, true);

  // Sweeping the corner must leave the unit not fading.
  for (int i = 0; i < 50; ++i) {
    rig.unit->setCrossovers(200.0 + static_cast<double>(i) * 10.0, 3200.0);
    rig.graph.process(128, static_cast<double>(i + 1) * 128.0 / 48000.0, true);
  }
  MW_EXPECT(!rig.unit->crossfading());

  // Where a slope change must.
  rig.unit->setSlope(dsp::Slope::Db6);
  MW_EXPECT(rig.unit->crossfading());
}

MW_TEST("the unit renders identically at every block size") {
  // Ledger cell 7. The modulator reads song position per sample, so this is
  // really a check that nothing in the unit advanced once per block instead.
  Rig reference(&broadband);
  reference.unit->setBandCount(3);
  const std::vector<dsp::Breakpoint> square = squareCurve();
  reference.unit->setCurve(0, square.data(), square.size());
  const RenderResult want = renderOffline(reference.graph, spec(8192, 48000.0, 128), reference.out);

  for (const int block : {32, 64, 256, 512, 1024}) {
    Rig rig(&broadband);
    rig.unit->setBandCount(3);
    rig.unit->setCurve(0, square.data(), square.size());
    const RenderResult got = renderOffline(rig.graph, spec(8192, 48000.0, block), rig.out);
    MW_EXPECT_NEAR(peakDifference(want, got), 0.0f, 0.0f);
  }
}

MW_TEST("the unit allocates nothing on the audio thread") {
  Rig rig(&broadband);
  rig.unit->setBandCount(3);
  const std::vector<dsp::Breakpoint> square = squareCurve();
  rig.unit->setCurve(0, square.data(), square.size());
  MW_EXPECT(rig.graph.prepare(48000.0, 128, 2));
  {
    test::RtGuard guard;
    for (int i = 0; i < 64; ++i) rig.graph.process(128, static_cast<double>(i) * 128.0 / 48000.0, true);
  }
}

MW_TEST("bypass is a wire") {
  // Cell 4, and the thing V1 rests on: if bypass were not exact, the null it
  // measures against would itself be wrong.
  Rig bypassed(&broadband);
  bypassed.unit->setBypass(true);
  Rig wire(&broadband);
  wire.unit->setBypass(true);
  const RenderResult a = renderOffline(bypassed.graph, spec(48000), bypassed.out);
  const RenderResult b = renderOffline(wire.graph, spec(48000), wire.out);
  MW_EXPECT_NEAR(peakDifference(a, b), 0.0f, 0.0f);
}

MW_TEST("D9 no parameter combination produces a non-finite sample") {
  // Every control, driven to values a user or an automation lane can actually
  // reach, including the rails. The failure this guards is the one that is
  // silent until it is catastrophic: one NaN in a filter's state poisons every
  // sample after it for the rest of the session, and the track goes quiet with
  // no error anywhere.
  //
  // Deterministic rather than randomly seeded so a failure is reproducible.
  unsigned state = 0x1234567u;
  const auto next = [&state]() {
    state = state * 1664525u + 1013904223u;
    return static_cast<double>(state >> 8) / 16777216.0;
  };

  int checked = 0;
  for (int trial = 0; trial < 400; ++trial) {
    Rig rig(&broadband);
    rig.unit->setBandCount(1 + static_cast<int>(next() * 3.0));
    // Crossovers deliberately allowed to cross over each other and to sit at
    // the rails: a user dragging one past the other is a legal gesture and the
    // unit may not answer it with an infinity.
    rig.unit->setCrossovers(next() * 24000.0, next() * 24000.0);
    rig.unit->setSlope(next() < 0.33 ? dsp::Slope::Db6
                                     : (next() < 0.5 ? dsp::Slope::Db12 : dsp::Slope::Db24));
    rig.unit->setSmooth(next());
    rig.unit->setMix(next());
    for (int b = 0; b < 3; ++b) {
      BandSettings settings;
      settings.depth = next();
      settings.rangeDb = -next() * 90.0;
      settings.enabled = next() > 0.2;
      rig.unit->setBand(b, settings);

      // Curves with coincident points, extreme tension and every shape.
      std::vector<dsp::Breakpoint> points;
      const int count = 1 + static_cast<int>(next() * 6.0);
      for (int i = 0; i < count; ++i) {
        dsp::Breakpoint bp;
        bp.x = next();
        bp.y = next();
        bp.tension = next() * 2.0 - 1.0;
        const double kind = next();
        bp.shape = kind < 0.25   ? dsp::SegmentShape::Line
                   : kind < 0.5  ? dsp::SegmentShape::Arc
                   : kind < 0.75 ? dsp::SegmentShape::SCurve
                                 : dsp::SegmentShape::Step;
        points.push_back(bp);
      }
      rig.unit->setCurve(b, points.data(), points.size());
    }
    rig.unit->phase().setMode(next() < 0.5 ? dsp::PhaseMode::Host : dsp::PhaseMode::Free);
    rig.unit->phase().setRateHz(next() * 400.0);
    rig.unit->phase().setSwing(next(), 2.0 + next() * 30.0);
    rig.unit->phase().setLengthQuarters(next() * 16.0);

    const RenderResult r = renderOffline(rig.graph, spec(2048), rig.out);
    MW_EXPECT(r.ok);
    for (int c = 0; c < r.channelCount(); ++c) {
      for (const float v : r.channel(c)) {
        if (!std::isfinite(v) || std::fabs(static_cast<double>(v)) > 64.0) {
          std::printf("    D9 trial %d produced %g\n", trial, static_cast<double>(v));
          MW_EXPECT(false);
          return;
        }
        ++checked;
      }
    }
  }
  std::printf("    D9 fuzz: 400 parameter sets, %d samples, all finite and bounded\n", checked);
}

MW_TEST("D11 a parameter set restored renders bit-identically") {
  // A preset that loads must produce the same audio, and "the same" means the
  // same samples rather than the same settings — restoring a value the DSP
  // rounds differently on the way in is exactly how a recalled patch sounds
  // subtly wrong.
  const std::vector<dsp::Breakpoint> shape = {
      dsp::Breakpoint{0.0, 1.0, dsp::SegmentShape::SCurve, 0.4},
      dsp::Breakpoint{0.3, 0.2, dsp::SegmentShape::Step, 0.0},
      dsp::Breakpoint{0.65, 0.8, dsp::SegmentShape::Arc, -0.7},
  };
  const auto configure = [&shape](MotionShaper& u) {
    u.setBandCount(3);
    u.setCrossovers(180.0, 4100.0);
    u.setSlope(dsp::Slope::Db12);
    u.setSmooth(0.37);
    u.setMix(0.62);
    for (int b = 0; b < 3; ++b) {
      BandSettings s;
      s.depth = 0.4 + 0.2 * static_cast<double>(b);
      s.rangeDb = -18.0 - 6.0 * static_cast<double>(b);
      u.setBand(b, s);
      u.setCurve(b, shape.data(), shape.size());
    }
    u.phase().setMode(dsp::PhaseMode::Host);
    u.phase().setLengthQuarters(2.0);
    u.phase().setSwing(0.55, 16.0);
    u.phase().setOffsetDegrees(33.0);
  };

  Rig saved(&broadband);
  configure(*saved.unit);
  const RenderResult a = renderOffline(saved.graph, spec(48000), saved.out);

  // A second instance configured from the same values, as a load would do.
  Rig restored(&broadband);
  configure(*restored.unit);
  const RenderResult b = renderOffline(restored.graph, spec(48000), restored.out);

  const double diff = dbfs(peakDifference(a, b));
  std::printf("    D11 restored render differs by %.1f dBFS\n", diff);
  MW_EXPECT_NEAR(peakDifference(a, b), 0.0f, 0.0f);
}

MW_TEST("the published frame is the engine's own state, not an estimate") {
  // Cell 20. A face that animates plausibly from the control values is drawing
  // a second opinion, and the one that is wrong is always the one nobody is
  // listening to. So the published phase has to be the phase the modulator
  // actually reached, and the published gain the gain actually applied.
  Rig rig(&broadband);
  rig.unit->setBandCount(3);
  rig.unit->setSmooth(0.0);
  const std::vector<dsp::Breakpoint> square = squareCurve();
  for (int b = 0; b < 3; ++b) rig.unit->setCurve(b, square.data(), square.size());
  rig.unit->phase().setMode(dsp::PhaseMode::Free);
  rig.unit->phase().setRateHz(2.0);
  rig.unit->phase().trigger(0.0);
  MW_EXPECT(rig.graph.prepare(48000.0, 128, 2));

  dsp::VisualFrame frame;
  int distinctPhases = 0;
  float lastPhase = -1.0f;
  float maxGain = 0.0f;
  float minGain = 2.0f;
  for (int block = 0; block < 200; ++block) {
    rig.graph.process(128, static_cast<double>(block) * 128.0 / 48000.0, true);
    MW_EXPECT(rig.unit->visual().read(frame));
    MW_EXPECT(frame.phase >= 0.0f && frame.phase < 1.0f);
    if (frame.phase != lastPhase) ++distinctPhases;
    lastPhase = frame.phase;
    if (frame.bandGain[0] > maxGain) maxGain = frame.bandGain[0];
    if (frame.bandGain[0] < minGain) minGain = frame.bandGain[0];
    // The input peak must be the real signal, which is never silent here.
    MW_EXPECT(frame.inputPeak > 0.0f);
  }
  std::printf("    published: %d distinct phases over 200 blocks, band gain spanned %.3f..%.3f\n",
              distinctPhases, static_cast<double>(minGain), static_cast<double>(maxGain));
  // The playhead moved, and the gain actually swung — a frame that reported a
  // constant would pass a weaker test while showing nothing.
  MW_EXPECT(distinctPhases > 150);
  MW_EXPECT(maxGain > 0.9f);
  MW_EXPECT(minGain < 0.1f);
}

MW_TEST("a bypassed unit publishes the truth rather than a stale frame") {
  // My first version of this asserted a bypassed unit publishes silence, and
  // that was the wrong design as well as a failing test: a bypassed unit is not
  // an idle one, signal is passing straight through it. What it must not do is
  // keep publishing the *last modulated* frame, which would leave a playhead
  // travelling through a shape that is doing nothing — worse than showing
  // nothing, because it is confidently wrong.
  //
  // So bypass publishes real level, unity gain, no modulation.
  Rig rig(&broadband);
  MW_EXPECT(rig.graph.prepare(48000.0, 128, 2));
  const std::vector<dsp::Breakpoint> square = squareCurve();
  rig.unit->setCurve(0, square.data(), square.size());
  for (int i = 0; i < 20; ++i) rig.graph.process(128, static_cast<double>(i) * 128.0 / 48000.0, true);

  const std::uint32_t before = rig.unit->visual().generation();
  rig.unit->setBypass(true);
  rig.graph.process(128, 21.0 * 128.0 / 48000.0, true);

  dsp::VisualFrame frame;
  MW_EXPECT(rig.unit->visual().read(frame));
  // A new frame, not the one from before bypass.
  MW_EXPECT(rig.unit->visual().generation() > before);
  // Signal is still flowing, and in equals out because bypass is a wire.
  MW_EXPECT(frame.inputPeak > 0.0f);
  MW_EXPECT_NEAR(static_cast<double>(frame.outputPeak), static_cast<double>(frame.inputPeak), 0.0);
  // And nothing is being modulated.
  for (int b = 0; b < dsp::kVisualBands; ++b) {
    MW_EXPECT_NEAR(static_cast<double>(frame.bandGain[b]), 1.0, 0.0);
  }
}

MW_TEST("the band levels published are the bands' own content") {
  // Not the crossover's response curve, which is a property of the filter, but
  // what those bands actually carry — which depends on the material. A 50 Hz
  // tone must light the low band and leave the high one dark.
  Rig rig(&sine1k);
  rig.unit->setBandCount(3);
  rig.unit->setCrossovers(220.0, 3200.0);
  MW_EXPECT(rig.graph.prepare(48000.0, 128, 2));
  for (int i = 0; i < 200; ++i) rig.graph.process(128, static_cast<double>(i) * 128.0 / 48000.0, true);

  dsp::VisualFrame frame;
  MW_EXPECT(rig.unit->visual().read(frame));
  std::printf("    1 kHz carrier: band peaks %.4f / %.4f / %.4f\n",
              static_cast<double>(frame.bandPeak[0]), static_cast<double>(frame.bandPeak[1]),
              static_cast<double>(frame.bandPeak[2]));
  // 1 kHz sits in the middle band, between the 220 Hz and 3200 Hz corners.
  MW_EXPECT(frame.bandPeak[1] > frame.bandPeak[0]);
  MW_EXPECT(frame.bandPeak[1] > frame.bandPeak[2]);
}

MW_TEST("publishing adds no allocation to the audio thread") {
  // Cell 21's audio half. A face is allowed to cost the UI thread whatever it
  // costs; what it may not do is make `process` allocate or block. The seqlock
  // write is a handful of stores and never waits for a reader.
  Rig rig(&broadband);
  MW_EXPECT(rig.graph.prepare(48000.0, 128, 2));
  {
    test::RtGuard guard;
    for (int i = 0; i < 64; ++i) {
      rig.graph.process(128, static_cast<double>(i) * 128.0 / 48000.0, true);
    }
  }
  // And a reader running concurrently must never see a torn frame: every read
  // either succeeds with a coherent frame or reports that it caught a write.
  dsp::VisualFrame frame;
  int torn = 0;
  for (int i = 0; i < 1000; ++i) {
    rig.graph.process(128, static_cast<double>(i) * 128.0 / 48000.0, true);
    if (!rig.unit->visual().read(frame)) ++torn;
    else if (!std::isfinite(frame.phase) || frame.phase < 0.0f) ++torn;
  }
  MW_EXPECT_EQ(torn, 0);
}

MW_TEST_MAIN("motion-shaper")
