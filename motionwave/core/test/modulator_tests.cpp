// Motion Wave — the drawn curve and the phase that reads it.
//
// `fx-01` V7 and V8 live here, and both are exactness claims rather than sound
// claims: a 1/16 gate must land on the sample the grid says, 128 bars in and
// after a seek; swing at 100 % must put the pair boundary at exactly 2/3.
//
// V7 is the one that decides an implementation. Accumulating phase is the
// obvious approach and fails twice — it drifts by a rounding error per block
// that never comes back, and it is simply wrong after a locate because the
// transport moved and the accumulator did not. So the test seeks, which is the
// case an accumulator passes right up until somebody uses the product.
#include "../dsp/curve.h"
#include "../dsp/lfo_phase.h"
#include "harness.h"
#include "rt_guard.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw::dsp;

namespace {

/// A gate: on for the first half of each unit, off for the second.
Curve gateCurve(int units) {
  std::vector<Breakpoint> points;
  for (int i = 0; i < units; ++i) {
    const double at = static_cast<double>(i) / static_cast<double>(units);
    points.push_back(Breakpoint{at, 1.0, SegmentShape::Step, 0.0});
    points.push_back(Breakpoint{at + 0.5 / static_cast<double>(units), 0.0, SegmentShape::Step, 0.0});
  }
  Curve c;
  c.set(points.data(), points.size());
  return c;
}

/// Sample indices where a gate curve rises, driven from transport position.
std::vector<int> onsets(LfoPhase& phase, const Curve& curve, double bpm, double sampleRate,
                        int frames, double startQuarters) {
  std::vector<int> found;
  double last = 0.0;
  const double quartersPerSample = bpm / 60.0 / sampleRate;
  for (int i = 0; i < frames; ++i) {
    const double q = startQuarters + static_cast<double>(i) * quartersPerSample;
    const double v = curve.valueAt(phase.next(q, sampleRate));
    if (v > 0.5 && last <= 0.5) found.push_back(i);
    last = v;
  }
  return found;
}

}  // namespace

MW_TEST("a curve evaluates its shapes at the right values") {
  Breakpoint pts[] = {
      Breakpoint{0.0, 0.0, SegmentShape::Line, 0.0},
      Breakpoint{0.5, 1.0, SegmentShape::Line, 0.0},
  };
  Curve c;
  c.set(pts, 2);
  MW_EXPECT_NEAR(c.valueAt(0.0), 0.0, 1.0e-12);
  MW_EXPECT_NEAR(c.valueAt(0.25), 0.5, 1.0e-12);
  MW_EXPECT_NEAR(c.valueAt(0.5), 1.0, 1.0e-12);
  // The wrapping segment runs from the last point back to the first at x = 1.
  MW_EXPECT_NEAR(c.valueAt(0.75), 0.5, 1.0e-12);
}

MW_TEST("tension is mirror-symmetric about the diagonal") {
  // The property that makes a tension slider feel linear: `t` and `−t` must be
  // reflections of each other, so dragging one way is the same gesture as
  // dragging the other. Without it the control is sluggish at one end and
  // violent at the other, which is a thing users describe as "broken".
  //
  // "Mirror about the diagonal" means reflection in the line y = x, and the
  // reflection of a function in that line is its *inverse* — so the claim is
  // that `t` and `−t` undo each other. My first version of this test asserted
  // point symmetry about the centre instead, `f(u,t) = 1 − f(1−u,−t)`, which is
  // a different property that `u^p` does not have and never claimed to: at
  // u = 0.5 and p = 2 it wants 0.25 = 0.293. The code was right and the test
  // was wrong, which is worth recording because the two symmetries are easy to
  // conflate and only one of them makes the control feel right.
  for (const double t : {0.25, 0.5, 0.75, 1.0}) {
    for (const double u : {0.1, 0.25, 0.5, 0.75, 0.9}) {
      for (const SegmentShape shape : {SegmentShape::Arc, SegmentShape::SCurve}) {
        const double there = shapeSegment(u, shape, t);
        const double back = shapeSegment(there, shape, -t);
        MW_EXPECT_NEAR(back, u, 1.0e-12);
      }
    }
  }
}

MW_TEST("a step segment holds its start value and then jumps") {
  Breakpoint pts[] = {
      Breakpoint{0.0, 1.0, SegmentShape::Step, 0.0},
      Breakpoint{0.5, 0.0, SegmentShape::Step, 0.0},
  };
  Curve c;
  c.set(pts, 2);
  MW_EXPECT_NEAR(c.valueAt(0.0), 1.0, 1.0e-12);
  MW_EXPECT_NEAR(c.valueAt(0.49), 1.0, 1.0e-12);
  MW_EXPECT_NEAR(c.valueAt(0.5), 0.0, 1.0e-12);
  MW_EXPECT_NEAR(c.valueAt(0.99), 0.0, 1.0e-12);
}

MW_TEST("a curve read backwards is as correct as one read forwards") {
  // The cursor is a cache, not the truth. A transport locate moves the phase
  // arbitrarily, and a modulator that assumed monotonic advance would be wrong
  // for exactly one block after every seek — which reads as "it glitches
  // sometimes" and is the hardest kind of bug to be shown.
  const Curve c = gateCurve(4);
  std::vector<double> forward;
  for (int i = 0; i < 1000; ++i) forward.push_back(c.valueAt(static_cast<double>(i) / 1000.0));
  for (int i = 999; i >= 0; --i) {
    MW_EXPECT_NEAR(c.valueAt(static_cast<double>(i) / 1000.0), forward[static_cast<std::size_t>(i)],
                   0.0);
  }
}

MW_TEST("a zero-width segment is a value rather than a NaN") {
  // Two points dropped on the same position is a legal thing to draw, and
  // dividing by the zero span would poison every sample after it for the rest
  // of the session.
  Breakpoint pts[] = {
      Breakpoint{0.0, 0.2, SegmentShape::Line, 0.0},
      Breakpoint{0.5, 0.7, SegmentShape::Line, 0.0},
      Breakpoint{0.5, 0.9, SegmentShape::Line, 0.0},
  };
  Curve c;
  c.set(pts, 3);
  for (int i = 0; i < 1000; ++i) {
    MW_EXPECT(std::isfinite(c.valueAt(static_cast<double>(i) / 1000.0)));
  }
}

MW_TEST("host phase puts a 1/16 gate on the exact sample, 128 bars in") {
  // V7's first half. 174 BPM is deliberately not a round number: a tempo whose
  // samples-per-beat is an integer would hide a rounding bug.
  const double bpm = 174.0;
  const double sr = 48000.0;
  LfoPhase phase;
  phase.setMode(PhaseMode::Host);
  phase.setLengthQuarters(4.0);  // one bar of 4/4
  const Curve gate = gateCurve(16);

  // Bars 126–128, so any drift accumulated over the earlier ones would show.
  const double startQuarters = 126.0 * 4.0;
  const double quartersPerSample = bpm / 60.0 / sr;
  const int frames = static_cast<int>(8.0 / quartersPerSample);
  const std::vector<int> got = onsets(phase, gate, bpm, sr, frames, startQuarters);

  // A 1/16 at 174 BPM is a quarter of a beat: 0.25 * 60/174 s.
  const double samplesPerSixteenth = 0.25 * 60.0 / bpm * sr;
  int worst = 0;
  for (std::size_t i = 0; i < got.size(); ++i) {
    // The grid is absolute, so the expected onset is derived from song position
    // rather than from the first onset found.
    const double songSample =
        (startQuarters + static_cast<double>(got[i]) * quartersPerSample) / (bpm / 60.0) * sr;
    const double nearest = std::round(songSample / samplesPerSixteenth) * samplesPerSixteenth;
    const int err = static_cast<int>(std::round(std::fabs(songSample - nearest)));
    if (err > worst) worst = err;
  }
  std::printf("    128 bars in: %zu onsets, worst %d samples from the grid\n", got.size(), worst);
  MW_EXPECT(!got.empty());
  MW_EXPECT(worst <= 1);
}

MW_TEST("host phase is unmoved by a seek") {
  // V7's second half, and the reason phase is derived rather than accumulated.
  // Asking for bar 100 directly must give the same answer as arriving there.
  LfoPhase a;
  LfoPhase b;
  a.setMode(PhaseMode::Host);
  b.setMode(PhaseMode::Host);
  a.setLengthQuarters(4.0);
  b.setLengthQuarters(4.0);

  const double sr = 48000.0;
  const double bpm = 174.0;
  const double quartersPerSample = bpm / 60.0 / sr;

  // `a` plays from bar 1 to bar 100. `b` seeks straight there.
  const double target = 100.0 * 4.0;
  const int frames = static_cast<int>(target / quartersPerSample);
  double last = 0.0;
  for (int i = 0; i < frames; ++i) last = a.next(static_cast<double>(i) * quartersPerSample, sr);
  const double afterPlaying = a.next(target, sr);
  const double afterSeeking = b.next(target, sr);
  std::printf("    played to bar 100: phase %.12f; seeked: %.12f\n", afterPlaying, afterSeeking);
  MW_EXPECT_NEAR(afterPlaying, afterSeeking, 1.0e-12);
  (void)last;
}

MW_TEST("swing at 100 per cent puts the boundary at exactly two thirds") {
  // V8. The number is the whole claim: 2/3 is a triplet feel exactly, and a
  // swing control that lands near it is a swing control that is wrong.
  LfoPhase phase;
  phase.setMode(PhaseMode::Host);
  phase.setLengthQuarters(1.0);
  phase.setSwing(1.0, 2.0);  // one pair across the period

  // The warp maps the input phase at which the output crosses 0.5. At full
  // swing that input phase must be 2/3.
  double crossing = -1.0;
  double previous = 0.0;
  const int steps = 1000000;
  for (int i = 1; i <= steps; ++i) {
    const double in = static_cast<double>(i) / static_cast<double>(steps);
    const double out = applySwing(in, 1.0, 2.0);
    if (previous < 0.5 && out >= 0.5) {
      crossing = in;
      break;
    }
    previous = out;
  }
  std::printf("    swing boundary at %.6f (want 0.666667)\n", crossing);
  MW_EXPECT_NEAR(crossing, 2.0 / 3.0, 1.0e-5);
}

MW_TEST("swing is monotonic, so it warps time without ever running backwards") {
  // A swing that was not monotonic would move the modulator *backwards* within
  // a pair, which is not a groove — it is a discontinuity, and it would click.
  for (const double s : {0.0, 0.25, 0.5, 0.75, 1.0}) {
    double previous = -1.0;
    for (int i = 0; i <= 10000; ++i) {
      const double out = applySwing(static_cast<double>(i) / 10000.0, s, 16.0);
      MW_EXPECT(out >= previous - 1.0e-12);
      previous = out;
    }
  }
}

MW_TEST("swing at zero is the identity") {
  // A groove control at its default must change nothing at all, or every
  // project that never touches it is subtly off the grid.
  for (int i = 0; i <= 1000; ++i) {
    const double phi = static_cast<double>(i) / 1000.0;
    MW_EXPECT_NEAR(applySwing(phi, 0.0, 16.0), phi, 0.0);
  }
}

MW_TEST("a free-running phase is re-seeded so two renders agree") {
  // Determinism. A free LFO that started wherever the play button happened to
  // be pressed would make "render it again" a different record.
  LfoPhase a;
  LfoPhase b;
  a.setMode(PhaseMode::Free);
  b.setMode(PhaseMode::Free);
  a.setRateHz(3.7);
  b.setRateHz(3.7);
  a.trigger(8.0);
  b.trigger(8.0);
  for (int i = 0; i < 10000; ++i) {
    MW_EXPECT_NEAR(a.next(0.0, 48000.0), b.next(0.0, 48000.0), 0.0);
  }
}

MW_TEST("a one-shot trigger stops at the end rather than wrapping") {
  LfoPhase phase;
  phase.setMode(PhaseMode::Trigger);
  phase.setTriggerEnd(TriggerEnd::OneShot);
  phase.setRateHz(10.0);
  phase.trigger(0.0);
  double last = 0.0;
  for (int i = 0; i < 48000; ++i) last = phase.next(0.0, 48000.0);
  MW_EXPECT(phase.finished());
  MW_EXPECT_NEAR(last, 0.0, 1.0e-9);  // 1.0 wrapped to 0.0 by the final frac
}

MW_TEST("reading the modulator allocates nothing") {
  LfoPhase phase;
  phase.setMode(PhaseMode::Host);
  phase.setLengthQuarters(4.0);
  const Curve gate = gateCurve(16);
  {
    mw::test::RtGuard guard;
    double sum = 0.0;
    for (int i = 0; i < 48000; ++i) {
      sum += gate.valueAt(phase.next(static_cast<double>(i) * 0.0001, 48000.0));
    }
    (void)sum;
  }
}

MW_TEST_MAIN("modulator")
