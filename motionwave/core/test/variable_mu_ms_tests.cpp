// Motion Wave — the Variable-Mu Limiter's lateral/vertical matrix.
// `dyn-04` §9 rows 12, 13 and 14.
//
// The matrix is formed in the transformer windings (§3.5), which is why these
// rows are about the audio path rather than about routing: the encode happens
// before the input transformer's nonlinearity and the decode after the output
// transformer's, so a model that matrixed in software either side of the pair
// would pass row 12 and be a different circuit.
#include "../units/variable_mu.h"
#include "harness.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kRate = 48000.0;
constexpr int kBlock = 128;

struct Stereo {
  std::vector<float> left;
  std::vector<float> right;
};

/// `sideGain` of −1 gives an anti-phase pair; 0 gives mono.
Stereo run(VariableMu& unit, double amplitude, double sideGain, int frames, double hz = 200.0) {
  std::vector<float> l(kBlock, 0.0f);
  std::vector<float> r(kBlock, 0.0f);
  std::vector<float> ol(kBlock, 0.0f);
  std::vector<float> orr(kBlock, 0.0f);
  float* channels[2] = {l.data(), r.data()};
  float* outChannels[2] = {ol.data(), orr.data()};
  Stereo out;
  const double step = 2.0 * kPi * hz / kRate;
  for (int at = 0; at < frames; at += kBlock) {
    for (int i = 0; i < kBlock; ++i) {
      const double s = amplitude * std::sin(step * static_cast<double>(at + i));
      l[static_cast<std::size_t>(i)] = static_cast<float>(s);
      r[static_cast<std::size_t>(i)] = static_cast<float>(s * sideGain);
    }
    AudioBuffer in(channels, 2, kBlock);
    AudioBuffer outBuf(outChannels, 2, kBlock);
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &outBuf;
    ctx.outputCount = 1;
    ctx.frames = kBlock;
    ctx.sampleRate = kRate;
    ctx.playing = true;
    unit.process(ctx);
    for (int i = 0; i < kBlock; ++i) {
      out.left.push_back(ol[static_cast<std::size_t>(i)]);
      out.right.push_back(orr[static_cast<std::size_t>(i)]);
    }
  }
  return out;
}

double rms(const std::vector<float>& v, std::size_t from) {
  double sum = 0.0;
  std::size_t n = 0;
  for (std::size_t i = from; i < v.size(); ++i) {
    sum += static_cast<double>(v[i]) * static_cast<double>(v[i]);
    ++n;
  }
  return n > 0 ? std::sqrt(sum / static_cast<double>(n)) : 0.0;
}

double db(double v) { return 20.0 * std::log10(v > 1.0e-15 ? v : 1.0e-15); }

/// Configured so the sidechain never engages, which is what rows 12 and 14 ask
/// for: the matrix has to be correct before compression is added to it.
void quiescent(VariableMu& unit, VariableMu::Mode mode) {
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  unit.setThreshold(0, 10.0);
  unit.setThreshold(1, 10.0);
  unit.setMode(mode);
  unit.setTier(VariableMu::Tier::X4);
  unit.reset();
}

}  // namespace

MW_TEST("dyn-04 test 12: the matrix encodes, decodes, and comes back unchanged") {
  VariableMu unit;
  quiescent(unit, VariableMu::Mode::LateralVertical);
  // A mono signal is entirely lateral, so the vertical channel must be empty.
  // Read from the *internal* channels, which is what the row is about: after
  // the decode both outputs carry it again by construction.
  const Stereo mono = run(unit, 0.05, 1.0, 8192);
  const std::size_t settled = 4096;
  const double lateral = rms(mono.left, settled);
  // The decode puts the whole of a mono signal on both outputs equally, so the
  // difference of the outputs is what is left of the vertical path.
  std::vector<float> difference;
  for (std::size_t i = settled; i < mono.left.size(); ++i) {
    difference.push_back(mono.left[i] - mono.right[i]);
  }
  const double vertical = rms(difference, 0);
  std::printf("    test 12: mono in — lateral %.1f dBFS, vertical %.1f dBFS (%.1f dB down)\n",
              db(lateral), db(vertical), db(lateral) - db(vertical));
  MW_EXPECT_EXCEEDS_BY(db(lateral), db(vertical), 60.0, 1.0e-12);

  VariableMu anti;
  quiescent(anti, VariableMu::Mode::LateralVertical);
  const Stereo opposed = run(anti, 0.05, -1.0, 8192);
  std::vector<float> sum;
  for (std::size_t i = settled; i < opposed.left.size(); ++i) {
    sum.push_back(opposed.left[i] + opposed.right[i]);
  }
  const double leaked = rms(sum, 0);
  const double carried = rms(opposed.left, settled);
  std::printf("    test 12: anti-phase in — vertical %.1f dBFS, lateral %.1f dBFS (%.1f dB down)\n",
              db(carried), db(leaked), db(carried) - db(leaked));
  MW_EXPECT_EXCEEDS_BY(db(carried), db(leaked), 60.0, 1.0e-12);

  // And the round trip is unity, which is the ×0.5-on-decode convention doing
  // its job: a null side signal has to pass the lateral channel at unity or
  // every mono source through this mode is 6 dB out.
  VariableMu direct;
  quiescent(direct, VariableMu::Mode::LeftRight);
  const Stereo plain = run(direct, 0.05, 1.0, 8192);
  std::printf("    test 12: round trip %.3f dB against left/right\n",
              db(rms(mono.left, settled)) - db(rms(plain.left, settled)));
  MW_EXPECT_NEAR(db(rms(mono.left, settled)), db(rms(plain.left, settled)), 0.1);
}

MW_TEST("dyn-04 test 13: the two channels are independent") {
  // Heavy compression on the vertical channel *only* — which needs the two
  // channels to have their own thresholds, and is why the unit's controls are
  // per channel. Arranging it by feeding a side-heavy signal instead does not
  // work and is what this row first did: with R = -0.35 L the lateral path
  // still carries 0.65 of the input and compresses 10.6 dB of its own, so the
  // row measured the *signal's* balance rather than the unit's independence.
  const double amplitude = 0.25;
  const double sideGain = -0.35;
  VariableMu open;
  quiescent(open, VariableMu::Mode::LateralVertical);
  const Stereo before = run(open, amplitude, sideGain, 24000);

  VariableMu vertical;
  quiescent(vertical, VariableMu::Mode::LateralVertical);
  vertical.setThreshold(1, 1.0);
  const Stereo after = run(vertical, amplitude, sideGain, 24000);

  const std::size_t settled = 12000;
  std::vector<float> sumBefore;
  std::vector<float> sumAfter;
  std::vector<float> diffBefore;
  std::vector<float> diffAfter;
  for (std::size_t i = settled; i < before.left.size(); ++i) {
    sumBefore.push_back(before.left[i] + before.right[i]);
    sumAfter.push_back(after.left[i] + after.right[i]);
    diffBefore.push_back(before.left[i] - before.right[i]);
    diffAfter.push_back(after.left[i] - after.right[i]);
  }
  const double sumChange = db(rms(sumAfter, 0)) - db(rms(sumBefore, 0));
  const double diffChange = db(rms(diffAfter, 0)) - db(rms(diffBefore, 0));
  std::printf("    test 13: vertical threshold down — lateral moved %.3f dB,"
              " vertical moved %.3f dB\n",
              sumChange, diffChange);
  MW_EXPECT(std::fabs(sumChange) < 0.5);
  MW_EXPECT(diffChange < -3.0);

  // And the reverse, which is the half that catches a model where only one
  // channel's control is wired.
  VariableMu lateral;
  quiescent(lateral, VariableMu::Mode::LateralVertical);
  lateral.setThreshold(0, 1.0);
  const Stereo swapped = run(lateral, amplitude, sideGain, 24000);
  std::vector<float> sumSwapped;
  std::vector<float> diffSwapped;
  for (std::size_t i = settled; i < swapped.left.size(); ++i) {
    sumSwapped.push_back(swapped.left[i] + swapped.right[i]);
    diffSwapped.push_back(swapped.left[i] - swapped.right[i]);
  }
  const double sumSwap = db(rms(sumSwapped, 0)) - db(rms(sumBefore, 0));
  const double diffSwap = db(rms(diffSwapped, 0)) - db(rms(diffBefore, 0));
  std::printf("    test 13: lateral threshold down — lateral moved %.3f dB,"
              " vertical moved %.3f dB\n",
              sumSwap, diffSwap);
  MW_EXPECT(std::fabs(diffSwap) < 0.5);
  MW_EXPECT(sumSwap < -3.0);
}

MW_TEST("dyn-04 test 14: the detectors are not linked") {
  // A signal present only in the side channel. The lateral channel sees nothing
  // and must therefore reduce nothing — if it does, the two detectors are wired
  // together and the mode's whole purpose is gone.
  VariableMu unit;
  quiescent(unit, VariableMu::Mode::LateralVertical);
  unit.setThreshold(0, 1.0);
  unit.setThreshold(1, 1.0);
  run(unit, 0.4, -1.0, 24000);
  std::printf("    test 14: vertical reduced %.3f dB, lateral reduced %.3f dB\n",
              unit.gainReductionDb(1), unit.gainReductionDb(0));
  MW_EXPECT(unit.gainReductionDb(0) < 0.5);
  // And the row proves nothing unless the other channel actually worked.
  MW_EXPECT(unit.gainReductionDb(1) >= 3.0);
}

MW_TEST_MAIN("variable-mu-ms")
