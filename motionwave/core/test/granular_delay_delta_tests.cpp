// Motion Wave — Ledger cells D1 and D7 for the Granular Delay.
//
// The measured half of D1; the parity half is generated and cannot be got
// wrong. The sweep, the determinism check and the block-size check are shared
// — what is here is this unit's base configuration, and one thing no other
// unit has needed: a base that knows which mode a control acts in.
//
// **Eleven of this unit's controls do nothing outside a mode, by design.** Cross
// is a term in the Blend matrix and no other. Spacing and every tap's Ratio
// exist in Relative mode. Wear, Bias and Age are properties of tape; Stages and
// the clock whine of a bucket-brigade. A tap's cutoff and Q are its filter's,
// and the filter has an Off position. Time-change mode is audible only while a
// time changes. A single base would report all of them dead, and the two ways
// out are both wrong: making each control do something in every mode would give
// Cross a job in Dual it has no business having, and dropping the rows would
// leave eleven controls nobody measures. So the render puts the unit in the mode
// a row acts in, and says so here rather than in eleven exceptions.
#include "../units/generated/granular_delay_params.gen.h"
#include "delta_harness.h"
#include "granular_delay_harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

using namespace mw;
using namespace mw::units;
using namespace mw::test::fx03;

namespace {

/// One second of priming so every tap and the loop have something to read,
/// then two and a half seconds captured — ten passes round the base's loop.
constexpr int kPrimeFrames = 48000;
constexpr int kFrames = 120000;

/**
 * Broadband and gated, and commensurate with nothing.
 *
 * `fx-02`'s D1 learned that partials which complete whole cycles in a control's
 * range null against that control: delaying a signal by its own period
 * reproduces it. The partials here share no period with any tap time in the
 * base, and the taps are not multiples of each other either — a first draft
 * put them at 100 ms steps, which is exactly what Relative mode's Even spacing
 * produces from a 100 ms first tap, so the Time-mode row measured nothing.
 */
std::pair<float, float> source(int index) {
  const double t = static_cast<double>(index) / kRate;
  const double gate = std::sin(2.0 * kPi * 1.7 * t) > 0.0 ? 1.0 : 0.0;
  const double partials = 1.0 * std::sin(2.0 * kPi * 113.0 * t) +
                          0.7 * std::sin(2.0 * kPi * 437.0 * t) +
                          0.5 * std::sin(2.0 * kPi * 1471.0 * t) +
                          0.35 * std::sin(2.0 * kPi * 3907.0 * t) +
                          0.25 * std::sin(2.0 * kPi * 9103.0 * t);
  const double right = 1.0 * std::sin(2.0 * kPi * 113.0 * t + 0.7) +
                       0.7 * std::sin(2.0 * kPi * 437.0 * t) +
                       0.5 * std::sin(2.0 * kPi * 1471.0 * t + 0.7) +
                       0.35 * std::sin(2.0 * kPi * 3907.0 * t) +
                       0.25 * std::sin(2.0 * kPi * 9103.0 * t + 0.7);
  return {static_cast<float>(0.12 * gate * partials), static_cast<float>(0.12 * gate * right)};
}

/// Eight taps at times that are multiples of nothing, panned alternately.
void configureBase(GranularDelay& unit, int blockSize) {
  unit.prepare(kRate, blockSize);
  unit.setMix(1.0);
  unit.setSync(false);
  unit.setTapCount(8);
  const double times[8] = {0.100, 0.230, 0.370, 0.410, 0.530, 0.610, 0.700, 0.790};
  for (int t = 0; t < 8; ++t) {
    TapSettings tap;
    tap.delaySeconds = times[t];
    tap.level = 1.0;
    tap.pan = t % 2 == 0 ? -0.5 : 0.5;
    unit.setTap(t, tap);
  }
  unit.setFeedbackTapSeconds(0.250);
  unit.setFeedback(0.5);
  unit.setLoopLowpass(18000.0);
  unit.setLoopHighpass(20.0);
  unit.setSmear(0.0);
  unit.setCharacter(delay::Character::Clean);
  unit.setQuality(delay::Quality::High);
  unit.setTimeChangeMode(delay::TimeChangeMode::Instant);
  unit.setBpm(120.0);
  unit.reset();
}

enum class Acts { Everywhere, Synced, Relative, Blend, Tape, Bbd, FilterOn, CutoffOn, QOn, SmearedBbd, WhileChanging };

/// The mode a row's control acts in, from its symbol; and its tap, if it has one.
Acts actsIn(const char* symbol, int* tap) {
  *tap = -1;
  if (std::strncmp(symbol, "Tap", 3) == 0 && symbol[3] >= '1' && symbol[3] <= '8') {
    *tap = symbol[3] - '1';
    const char* rest = symbol + 4;
    if (std::strcmp(rest, "Division") == 0 || std::strcmp(rest, "Modifier") == 0) return Acts::Synced;
    if (std::strcmp(rest, "Ratio") == 0) return Acts::Relative;
    if (std::strcmp(rest, "Filter") == 0) return Acts::FilterOn;
    if (std::strcmp(rest, "Cutoff") == 0) return Acts::CutoffOn;
    if (std::strcmp(rest, "Q") == 0) return Acts::QOn;
    return Acts::Everywhere;
  }
  if (std::strcmp(symbol, "Cross") == 0) return Acts::Blend;
  if (std::strcmp(symbol, "Spacing") == 0) return Acts::Relative;
  if (std::strcmp(symbol, "Wear") == 0 || std::strcmp(symbol, "Bias") == 0 || std::strcmp(symbol, "Age") == 0) return Acts::Tape;
  if (std::strcmp(symbol, "Stages") == 0 || std::strcmp(symbol, "ClockWhine") == 0) return Acts::Bbd;
  if (std::strcmp(symbol, "FeedbackDivision") == 0 || std::strcmp(symbol, "FeedbackModifier") == 0) return Acts::Synced;
  if (std::strcmp(symbol, "Quality") == 0) return Acts::SmearedBbd;
  if (std::strcmp(symbol, "TimeChange") == 0) return Acts::WhileChanging;
  return Acts::Everywhere;
}

void enterMode(GranularDelay& unit, Acts acts, int tapIndex) {
  TapSettings tap = tapIndex >= 0 ? unit.tap(tapIndex) : TapSettings{};
  switch (acts) {
    case Acts::Synced: unit.setSync(true); break;
    case Acts::Relative: unit.setTimeMode(delay::TimeMode::Relative); break;
    case Acts::Blend: unit.setTopology(delay::Topology::Blend); break;
    case Acts::Tape: unit.setCharacter(delay::Character::Tape); break;
    case Acts::Bbd: unit.setCharacter(delay::Character::Bbd); break;
    case Acts::FilterOn:
      tap.cutoffHz = 800.0;
      unit.setTap(tapIndex, tap);
      break;
    case Acts::CutoffOn:
      tap.filter = delay::TapFilter::Lowpass;
      unit.setTap(tapIndex, tap);
      break;
    case Acts::QOn:
      tap.filter = delay::TapFilter::Lowpass;
      tap.cutoffHz = 1000.0;
      unit.setTap(tapIndex, tap);
      break;
    case Acts::SmearedBbd:
      // Eco against High differs in the grain cap, the interpolation of a
      // moving read and the compander's oversampling; a plain clean tap shows
      // none of those.
      unit.setSmear(1.0);
      unit.setCharacter(delay::Character::Bbd);
      break;
    case Acts::WhileChanging:
    case Acts::Everywhere:
    default: break;
  }
}

/// Render with the capture aligned to `kPrimeFrames` whatever the block size.
std::vector<float> renderAt(GranularDelay& unit, int blockSize, bool changeMidway) {
  std::vector<float> captured;
  captured.reserve(static_cast<std::size_t>(kFrames) * 2u);
  const int total = kPrimeFrames + kFrames;
  const int changeAt = kPrimeFrames + 24000;
  bool changed = false;
  auto segment = [&](int from, int to) {
    for (int at = from; at < to;) {
      const int n = std::min(blockSize, to - at);
      if (changeMidway && !changed && at >= changeAt) {
        // A time change mid-render, for the row whose control is how a time
        // change happens: tap 1 from 100 ms to 400 ms.
        TapSettings tap = unit.tap(0);
        tap.delaySeconds = 0.400;
        unit.setTap(0, tap);
        changed = true;
      }
      const Rendered out = render(unit, n, [at](int i) { return source(at + i); }, kRate, n);
      if (at >= kPrimeFrames) {
        for (int i = 0; i < n; ++i) {
          captured.push_back(out.left[static_cast<std::size_t>(i)]);
          captured.push_back(out.right[static_cast<std::size_t>(i)]);
        }
      }
      at += n;
    }
  };
  // Two segments, each clamping to its own end, so the capture starts at the
  // same sample for a block size that divides the priming and one that does not.
  segment(0, kPrimeFrames);
  segment(kPrimeFrames, total);
  return captured;
}

const GranularDelayParamRow& rowFor(int id) {
  for (int i = 0; i < kGranularDelayParamCount; ++i) {
    if (kGranularDelayParams[i].id == id) return kGranularDelayParams[i];
  }
  return kGranularDelayParams[0];
}

std::vector<float> renderWithParam(int id, double value) {
  GranularDelay unit;
  configureBase(unit, kBlock);
  int tap = -1;
  const Acts acts = actsIn(rowFor(id).symbol, &tap);
  enterMode(unit, acts, tap);
  applyGranularDelayParam(unit, id, value);
  // Reset after the parameter, not before: several of these size or snap
  // something, and the first block would otherwise render from state that
  // belonged to the previous setting.
  unit.reset();
  return renderAt(unit, kBlock, acts == Acts::WhileChanging);
}

constexpr int kBlockSizes[3] = {64, 97, 1024};

}  // namespace

MW_TEST("D1: every Granular Delay parameter's setter reaches the audio") {
  test::expectEveryParameterReachesAudio(kGranularDelayParams, kGranularDelayParamCount,
                                         renderWithParam);
}

MW_TEST("D1: two renders of the same setting are identical") {
  test::expectRendersAreDeterministic(kGranularDelayParams, kGranularDelayParamCount,
                                      renderWithParam);
}

MW_TEST("D7: the block size the host chooses does not change the audio") {
  /*
   * Smeared, on tape with wear, so the grain engine, the wobble and both
   * character halves are all in the render — every place a block boundary
   * could leave a mark.
   */
  test::expectBlockSizeIndependent(
      [](int blockSize) {
        GranularDelay unit;
        configureBase(unit, blockSize);
        unit.setSmear(0.5);
        unit.setCharacter(delay::Character::Tape);
        unit.setWear(delay::Wear::Vintage);
        unit.reset();
        return renderAt(unit, blockSize, false);
      },
      kBlockSizes, 3);
}

MW_TEST_MAIN("granular-delay-d1")
