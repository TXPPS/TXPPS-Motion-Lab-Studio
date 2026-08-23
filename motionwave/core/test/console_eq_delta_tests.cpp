// Motion Wave — Ledger cell D1 for the Console EQ.
//
// The measured half; the parity half is generated and so cannot be got wrong.
// The sweep, the determinism check and the block-size check are all shared —
// what is here is this unit's base configuration, which is the part that is
// genuinely its own and which is harder here than anywhere else in the project.
//
// **Both lineages' controls exist at once and only one set is in circuit.** A
// base that sat on one lineage would report every one of the other's ten
// parameters as dead, which is exactly the failure D1 is for. The sweep
// therefore renders each parameter with the lineage its control belongs to
// already selected, which is what a user does before touching it.
#include "../units/generated/console_eq_params.gen.h"
#include "delta_harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr int kBlock = 256;
constexpr double kRate = 48000.0;
/// Half a second. There is no detector in either lineage — §5 says the only
/// time-domain behaviour is filter group delay, ringing and the transformers'
/// low-frequency response — so nothing here needs seconds to settle.
constexpr int kFrames = 24000;

/// Which lineage each parameter belongs to. The shared controls work in either,
/// so they are left on the default.
bool wantsAmerican(int id) {
  for (const ConsoleEqParamRow& row : kConsoleEqParams) {
    if (row.id != id) continue;
    const char* name = row.symbol;
    return name[0] == 'B' && name[1] == 'a' && name[2] == 'n' && name[3] == 'd';
  }
  return false;
}

/**
 * Broadband, and weighted low.
 *
 * The transformers and the inductor cores are frequency-inverse — flux is the
 * integral of voltage — so a signal with no low content leaves half of what
 * this unit does with nothing to act on, and the low shelf's render-delta would
 * be measuring a filter rather than a filter and a core. The high partials are
 * there for the 12 kHz shelf and the 15 kHz band, which have nothing to say
 * below them.
 */
float source(int index, int channel, double rate) {
  const double t = static_cast<double>(index) / rate;
  const double phase = channel == 0 ? 0.0 : 0.9;
  const double partials = 1.0 * std::sin(2.0 * kPi * 47.0 * t + phase) +
                          0.8 * std::sin(2.0 * kPi * 173.0 * t) +
                          0.6 * std::sin(2.0 * kPi * 640.0 * t + phase) +
                          0.45 * std::sin(2.0 * kPi * 2100.0 * t) +
                          0.3 * std::sin(2.0 * kPi * 6300.0 * t + phase) +
                          0.2 * std::sin(2.0 * kPi * 13700.0 * t);
  // Enough level that the cores are working rather than idling — most of this
  // unit's parameters change a curve, but two of them change a nonlinearity.
  const double envelope = 0.5 + 0.5 * std::sin(2.0 * kPi * 0.9 * t);
  return static_cast<float>(0.11 * (0.4 + 0.6 * envelope) * partials);
}

std::vector<float> renderAt(ConsoleEq& unit, int blockSize) {
  const std::size_t span = static_cast<std::size_t>(blockSize);
  std::vector<float> left(span, 0.0f);
  std::vector<float> right(span, 0.0f);
  std::vector<float> outLeft(span, 0.0f);
  std::vector<float> outRight(span, 0.0f);
  float* channels[2] = {left.data(), right.data()};
  float* outChannels[2] = {outLeft.data(), outRight.data()};
  std::vector<float> captured;
  captured.reserve(static_cast<std::size_t>(kFrames) * 2u);
  for (int at = 0; at < kFrames; at += blockSize) {
    const int frames = std::min(blockSize, kFrames - at);
    for (int i = 0; i < frames; ++i) {
      left[static_cast<std::size_t>(i)] = source(at + i, 0, kRate);
      right[static_cast<std::size_t>(i)] = source(at + i, 1, kRate);
    }
    AudioBuffer in(channels, 2, frames);
    AudioBuffer out(outChannels, 2, frames);
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &out;
    ctx.outputCount = 1;
    ctx.frames = frames;
    ctx.sampleRate = kRate;
    ctx.playing = true;
    unit.process(ctx);
    for (int i = 0; i < frames; ++i) {
      captured.push_back(outLeft[static_cast<std::size_t>(i)]);
      captured.push_back(outRight[static_cast<std::size_t>(i)]);
    }
  }
  return captured;
}

std::vector<float> renderWith(int id, double value) {
  ConsoleEq unit;
  unit.setLineage(wantsAmerican(id) ? ConsoleEq::Lineage::American
                                    : ConsoleEq::Lineage::British);
  unit.prepare(kRate, kBlock);
  unit.setNoise(0.0);
  /*
   * **Every band is left working, and that is the whole difficulty of a D1
   * base on an equaliser.** A frequency switch changes nothing while its band's
   * amount is zero, and neither does a shelf/peak switch — the renders come out
   * bit-identical, and the sweep reports six live controls as dead. Measured:
   * -200 dBFS on all six, which is not a small difference but no difference at
   * all.
   *
   * The amounts are well short of maximum on purpose. At full boost the mid
   * bell is narrow enough that moving it between two adjacent detents lands it
   * where the previous setting had already fallen away, and the render-delta
   * then measures two mostly-unrelated curves rather than one control's travel.
   */
  unit.setBritishLowAmount(10.0);
  unit.setBritishMidAmount(10.0);
  unit.setBritishHighAmount(10.0);
  for (int b = 0; b < 3; ++b) unit.setAmericanAmount(b, 6.0);
  unit.reset();
  applyConsoleEqParam(unit, id, value);
  unit.reset();
  return renderAt(unit, kBlock);
}

/// A power of two, an odd size no host would pick but a plug-in must survive,
/// and one large enough to cross the wrapper's latency in a single call.
constexpr int kBlockSizes[3] = {64, 97, 1024};

}  // namespace

MW_TEST("D1: every Console EQ parameter's setter reaches the audio") {
  test::expectEveryParameterReachesAudio(kConsoleEqParams, kConsoleEqParamCount, renderWith);
}

MW_TEST("D1: two renders of the same setting are identical") {
  test::expectRendersAreDeterministic(kConsoleEqParams, kConsoleEqParamCount, renderWith);
}

MW_TEST("D1: the block size the host chooses does not change the audio") {
  test::expectBlockSizeIndependent(
      [](int blockSize) {
        ConsoleEq unit;
        unit.setLineage(ConsoleEq::Lineage::British);
        unit.prepare(kRate, blockSize);
        unit.setNoise(0.0);
        unit.setBritishLowAmount(12.0);
        unit.setBritishMidAmount(-9.0);
        unit.setHighPass(2);
        unit.reset();
        return renderAt(unit, blockSize);
      },
      kBlockSizes, 3);
}

MW_TEST_MAIN("console-eq-d1")
