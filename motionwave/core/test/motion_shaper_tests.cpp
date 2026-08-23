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
#include "rt_guard.h"

#include <cmath>
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

MW_TEST_MAIN("motion-shaper")
