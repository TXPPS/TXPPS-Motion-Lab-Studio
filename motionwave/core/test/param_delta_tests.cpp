// Motion Wave — Ledger cell D1, the half that has to be measured.
//
// D1 makes two claims about a unit. The first is that the set of controls the
// UI exposes and the set of setters the DSP has are the same set — which is not
// tested anywhere, because it is no longer possible to get wrong: both tables
// are generated from `motionwave/manifests/`, so a control naming a parameter
// the processor does not have fails to compile. Making the defect
// unconstructible is worth more than fourteen units' worth of parity tests, and
// it is the same move as `WetDryMixer`'s branded latency.
//
// The second claim is that each setter *reaches audio*, and that one cannot be
// made structural: a generated switch statement proves a call happens, not that
// the value it carries changes what comes out. A knob wired to a field nobody
// reads compiles perfectly. So every parameter is rendered twice at two
// distinct values and the two renders must differ.
//
// Two things this test needs that are easy to get wrong, both learned from
// probe errors earlier in this build:
//
//  * The base configuration has to be one where every parameter *can* matter.
//    With a flat curve there is no modulation, so Depth, Range, Offset, Rate
//    and Swing all move nothing and every one of them would report "no
//    difference" — a green test proving the setter dead and a red test proving
//    the setter dead look identical from here. The base below modulates hard,
//    across all three bands, from a broadband source.
//  * The difference has to be measured as more than "not bit-identical".
//    Denormal flushes and crossfade tails put small differences in places that
//    have nothing to do with the parameter, so the gate is an audible one.
#include "../dsp/fft.h"
#include "../graph/engine_graph.h"
#include "../render/offline_render.h"
#include "../units/generated/motion_shaper_params.gen.h"
#include "harness.h"

#include <cmath>
#include <cstdio>
#include <memory>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kPi = 3.14159265358979323846;

/// Broadband, so every band carries something to modulate.
float broadband(int frame, int channel, double sampleRate, void*) {
  const double t = static_cast<double>(frame) / sampleRate;
  double sum = 0.0;
  double amp = 1.0;
  for (double f = 40.0; f < 16000.0; f *= 2.0) {
    sum += amp * std::sin(2.0 * kPi * f * t + f * 0.001 + channel * 0.3);
    amp *= 0.75;
  }
  return static_cast<float>(0.2 * sum);
}

/**
 * A curve with a fast edge and no symmetry.
 *
 * The asymmetry is load-bearing for one parameter in particular: `PhaseOffset`
 * shifts the shape in time, and a shape symmetric about its half point is
 * unchanged by a 180° shift. A test that used a triangle would report the
 * offset setter dead when it works.
 */
std::vector<dsp::Breakpoint> shapedCurve() {
  return {
      dsp::Breakpoint{0.0, 1.0, dsp::SegmentShape::Line, 0.0},
      dsp::Breakpoint{0.35, 0.05, dsp::SegmentShape::Step, 0.0},
      dsp::Breakpoint{0.5, 0.8, dsp::SegmentShape::Arc, 0.6},
      dsp::Breakpoint{0.75, 0.1, dsp::SegmentShape::Line, 0.0},
  };
}

/**
 * The configuration every delta is measured against.
 *
 * Free-running rather than host-locked, so `Rate` has an effect at all — in
 * host mode the phase comes from the transport and the rate control is
 * correctly ignored, which would make its render-delta zero for a reason that
 * is not a bug. `SyncMode`'s own delta is Host against Free, so the mode still
 * gets measured; it is only the base that has to be the one where the most
 * parameters are live.
 */
void configureBase(MotionShaper& u) {
  const std::vector<dsp::Breakpoint> curve = shapedCurve();
  u.setBandCount(3);
  u.setCrossovers(220.0, 3200.0);
  u.setSlope(dsp::Slope::Db24);
  u.setSmooth(0.15);
  u.setMix(1.0);
  for (int b = 0; b < 3; ++b) {
    BandSettings s;
    s.depth = 1.0;
    s.rangeDb = -24.0;
    s.enabled = true;
    u.setBand(b, s);
    u.setCurve(b, curve.data(), curve.size());
  }
  u.phase().setMode(dsp::PhaseMode::Free);
  u.phase().setRateHz(4.0);
  u.phase().setSwing(0.0, 16.0);
  u.phase().setOffsetDegrees(0.0);
  u.setBpm(120.0);
}

RenderSpec spec() {
  RenderSpec s;
  // A second, which is four cycles of the base rate: long enough that a change
  // to the modulator shows up as a shape rather than as a transient, and long
  // enough for the 4 ms topology crossfade to be a small part of it rather than
  // the whole measurement.
  s.frames = 48000;
  s.blockSize = 128;
  s.sampleRate = 48000.0;
  s.channels = 2;
  return s;
}

/// One render of the unit with `id` set to `value` and everything else at base.
RenderResult renderWith(int id, double value) {
  EngineGraph graph;
  const NodeId src = graph.addNode(std::make_unique<SignalSourceNode>(broadband, nullptr));
  auto owned = std::make_unique<MotionShaper>();
  MotionShaper* unit = owned.get();
  const NodeId out = graph.addNode(std::move(owned));
  graph.connect(src, out);
  configureBase(*unit);
  applyMotionShaperParam(*unit, id, value);
  return renderOffline(graph, spec(), out);
}

/// RMS of the sample-by-sample difference, in dBFS.
double differenceDb(const RenderResult& a, const RenderResult& b) {
  double sum = 0.0;
  std::size_t count = 0;
  for (int c = 0; c < a.channelCount(); ++c) {
    const std::vector<float>& x = a.channel(c);
    const std::vector<float>& y = b.channel(c);
    for (std::size_t i = 0; i < x.size(); ++i) {
      const double d = static_cast<double>(x[i]) - static_cast<double>(y[i]);
      sum += d * d;
      ++count;
    }
  }
  if (count == 0) return -200.0;
  const double rms = std::sqrt(sum / static_cast<double>(count));
  return rms > 0.0 ? 20.0 * std::log10(rms) : -200.0;
}


/**
 * Where in the spectrum a difference signal actually lives.
 *
 * The render-delta above proves a setter reaches audio. It does not prove the
 * setter reaches *its own* audio, and the gap is not hypothetical: wiring
 * `DepthHigh` to band 0 was tried against the test above and passed with a
 * −17.6 dB difference, because band 0's depth changing is a difference too. The
 * copy-paste band index is the single most likely defect in a table whose
 * indices are the one part still written by hand, so D1 is held to the stricter
 * reading — a band control must move its own band.
 *
 * Directive 06 §1: the bin width is 48000 / 32768 = 1.465 Hz. Nothing here is
 * an alias measurement and no grid needs resolving; the features being
 * separated are the three bands themselves, whose edges are 220 Hz and 3200 Hz
 * and so are 150 and 2185 bins apart. The window is Blackman-Harris rather than
 * Hann for the reason V5 established the hard way: a −31 dB sidelobe skirt from
 * a strong low partial would appear as high-band energy that is not there.
 */
struct BandEnergy {
  double low = 0.0;
  double mid = 0.0;
  double high = 0.0;

  double total() const { return low + mid + high; }
  double share(int band) const {
    const double t = total();
    if (t <= 0.0) return 0.0;
    return (band == 0 ? low : band == 1 ? mid : high) / t;
  }
};

BandEnergy differenceSpectrum(const RenderResult& a, const RenderResult& b) {
  constexpr std::size_t kN = 32768;
  // Started past the topology crossfade and the smoother's approach, both of
  // which are transients belonging to the change rather than to the setting.
  constexpr std::size_t kStart = 8000;
  std::vector<double> re(kN, 0.0);
  std::vector<double> im(kN, 0.0);
  std::vector<double> window(kN, 0.0);
  dsp::blackmanHarrisWindow(window);
  const std::vector<float>& x = a.channel(0);
  const std::vector<float>& y = b.channel(0);
  for (std::size_t i = 0; i < kN; ++i) {
    const std::size_t at = kStart + i;
    const double d = at < x.size() ? static_cast<double>(x[at]) - static_cast<double>(y[at]) : 0.0;
    re[i] = d * window[i];
  }
  dsp::fft(re, im);

  BandEnergy out;
  const double binHz = 48000.0 / static_cast<double>(kN);
  for (std::size_t k = 1; k < kN / 2; ++k) {
    const double hz = static_cast<double>(k) * binHz;
    const double power = re[k] * re[k] + im[k] * im[k];
    if (hz < 220.0) out.low += power;
    else if (hz < 3200.0) out.mid += power;
    else out.high += power;
  }
  return out;
}

/// The band each of the six band controls belongs to, by parameter id.
struct BandParam {
  MotionShaperParam id;
  int band;
  const char* symbol;
};

constexpr BandParam kBandParams[] = {
    {MotionShaperParam::DepthLow, 0, "DepthLow"},   {MotionShaperParam::DepthMid, 1, "DepthMid"},
    {MotionShaperParam::DepthHigh, 2, "DepthHigh"}, {MotionShaperParam::RangeLow, 0, "RangeLow"},
    {MotionShaperParam::RangeMid, 1, "RangeMid"},   {MotionShaperParam::RangeHigh, 2, "RangeHigh"},
};

/**
 * The gate, in dBFS of difference RMS.
 *
 * −60 is a change that is plainly audible against a signal rendering at about
 * −18 dBFS RMS, and it is far above anything a denormal flush or a crossfade
 * tail could produce. It is deliberately not "the two renders differ at all":
 * floating-point noise would pass that, and a setter that reached a field the
 * processor reads once at prepare and then ignores could too.
 */
constexpr double kAudibleDb = -60.0;

}  // namespace

MW_TEST("D1: every parameter's setter reaches the audio") {
  for (int i = 0; i < kMotionShaperParamCount; ++i) {
    const MotionShaperParamRow& row = kMotionShaperParams[i];
    const RenderResult low = renderWith(row.id, row.deltaLow);
    const RenderResult high = renderWith(row.id, row.deltaHigh);
    MW_EXPECT(low.ok && high.ok);
    // A pair of silent renders would "differ" by nothing and pass a
    // badly-written version of this check, so the signal is confirmed present
    // before the difference is believed.
    MW_EXPECT(peak(low) > 1.0e-3f);
    MW_EXPECT(peak(high) > 1.0e-3f);
    const double delta = differenceDb(low, high);
    std::printf("  D1 %-18s %8.3g -> %-8.3g  difference %7.2f dBFS\n", row.symbol, row.deltaLow,
                row.deltaHigh, delta);
    if (delta <= kAudibleDb) {
      std::printf("    ^ this parameter's setter does not reach the audio.\n");
    }
    MW_EXPECT(delta > kAudibleDb);
  }
}

/**
 * The other direction, and the reason the test above can be believed.
 *
 * Setting a parameter to the *same* value twice must produce identical audio.
 * Without this, a unit whose output depended on something other than its
 * parameters — an uninitialised field, a clock, a random seed — would pass
 * every delta above while proving nothing at all, because every pair of renders
 * would differ whatever was set.
 */
MW_TEST("D1: two renders of the same setting are identical") {
  for (int i = 0; i < kMotionShaperParamCount; ++i) {
    const MotionShaperParamRow& row = kMotionShaperParams[i];
    const RenderResult a = renderWith(row.id, row.deltaHigh);
    const RenderResult b = renderWith(row.id, row.deltaHigh);
    MW_EXPECT_NEAR(static_cast<double>(peakDifference(a, b)), 0.0, 0.0);
  }
}

MW_TEST("D1: a band control moves its own band and not another one") {
  for (const BandParam& p : kBandParams) {
    const MotionShaperParamRow& row = kMotionShaperParams[static_cast<int>(p.id) - 1];
    const RenderResult low = renderWith(row.id, row.deltaLow);
    const RenderResult high = renderWith(row.id, row.deltaHigh);
    const BandEnergy e = differenceSpectrum(low, high);
    const double own = e.share(p.band);
    std::printf("  D1 %-10s band %d  low %5.1f%%  mid %5.1f%%  high %5.1f%%\n", p.symbol, p.band,
                e.share(0) * 100.0, e.share(1) * 100.0, e.share(2) * 100.0);
    // Two thirds rather than "the largest": a crossover has skirts and a
    // modulated band spreads sidebands past its own edges, so some leakage is
    // correct. A control wired to the wrong band does not leak two thirds of
    // its energy into the right one — it puts nearly all of it in the wrong one.
    if (own <= 0.66) {
      std::printf("    ^ this control is changing a band that is not its own.\n");
    }
    MW_EXPECT(own > 0.66);
  }
}

MW_TEST_MAIN("param_delta_tests")
