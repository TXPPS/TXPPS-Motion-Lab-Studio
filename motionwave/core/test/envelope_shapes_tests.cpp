// Motion Wave — the decibel shape family. `lib-voice-substrate.md` §5.2, §8.
//
// VS-10 in full — both halves, because the row is written so that it cannot
// pass vacuously: the decibel-domain decay must regress to a straight line
// *and* the linear-in-amplitude version the sheet warns against must not. A
// case that asserted only the first would pass on an engine that had never
// heard of the dB domain, as long as its output happened to be straight.
//
// Then the six-operator family's own claims: the attack starts at the floor
// and is convex in dB, a rising segment seeks and a falling one is straight,
// and a rate-driven decay takes the same wall-clock time at four host rates —
// VS-08's rate-driven half. The four linear-domain families are in
// `envelope_shapes_linear_tests.cpp`; the two files are two things, a domain
// with a regression in it and four without.
//
// Every number is from the sheet or the design, never from what the code
// produced: 64.8 dB/s is what R = 50 is in `syn-04` §5.3's derived table, and
// the panel-code law that produced it is [I] and stays in the instrument.
// Measured on this tree: R² = 1.000000, slope −64.82 dB/s over 89.4 dB
// (n = 66 207); the amplitude-linear version reads R² = 0.7516 over the same
// excursion. The attack starts at −89.83 dB and is 60.1 % of the way at a
// quarter of its time.
//
// Mutation-tested, each edit restored before the next:
//   rising segments straight instead of target-seeking → red: "starts at the
//     floor and is convex" and "a rising segment seeks"; nothing else.
//   floor moved from −89.9 to −120 dB → red: "VS-10 ... straight line" (the
//     line ends in the wrong place) and "starts at the floor"; nothing else.
//   direction judged against the floor for every segment → red: "a rising
//     segment seeks" only.
#include "../dsp/voice/envelope_shapes.h"
#include "harness.h"
#include "rt_guard.h"

#include <cmath>
#include <vector>

using namespace mw;
using namespace mw::dsp::voice;

namespace {

TriggerBus pressed() {
  TriggerBus bus;
  bus.single = true;
  bus.multi = true;
  bus.gate = true;
  return bus;
}

TriggerBus held() {
  TriggerBus bus;
  bus.gate = true;
  return bus;
}

Envelope prepared(const EnvelopeShape& shape, double rate = 48000.0) {
  Envelope env;
  env.prepare(rate);
  env.setShape(shape);
  return env;
}

/// Samples of `advance(bus, 1)`, one per frame; `first` for the first frame.
std::vector<float> render(Envelope& env, const TriggerBus& first, const TriggerBus& rest,
                          int frames) {
  std::vector<float> out;
  out.reserve(static_cast<std::size_t>(frames));
  out.push_back(env.advance(first, 1));
  for (int i = 1; i < frames; ++i) out.push_back(env.advance(rest, 1));
  return out;
}

/// Least squares of y against x: the slope and the coefficient of determination.
struct Fit {
  double slope = 0.0;
  double r2 = 0.0;
  int n = 0;
};

Fit fitLine(const std::vector<double>& x, const std::vector<double>& y) {
  Fit f;
  f.n = static_cast<int>(x.size());
  if (f.n < 2) return f;
  double sx = 0.0;
  double sy = 0.0;
  for (int i = 0; i < f.n; ++i) {
    sx += x[static_cast<std::size_t>(i)];
    sy += y[static_cast<std::size_t>(i)];
  }
  const double mx = sx / static_cast<double>(f.n);
  const double my = sy / static_cast<double>(f.n);
  double sxx = 0.0;
  double sxy = 0.0;
  double syy = 0.0;
  for (int i = 0; i < f.n; ++i) {
    const double dx = x[static_cast<std::size_t>(i)] - mx;
    const double dy = y[static_cast<std::size_t>(i)] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  f.slope = sxy / sxx;
  f.r2 = (sxy * sxy) / (sxx * syy);
  return f;
}

/// The straight part of a decay in dB: from the first sample at the peak until
/// the level reaches half a dB above `floorDb`, as (seconds, dB) pairs.
void decayInDb(const std::vector<float>& dbPerSample, double fs, float floorDb,
               std::vector<double>& t, std::vector<double>& y) {
  std::size_t start = 0;
  while (start < dbPerSample.size() && dbPerSample[start] < -0.01f) ++start;
  for (std::size_t i = start; i < dbPerSample.size(); ++i) {
    if (dbPerSample[i] <= floorDb + 0.5f) break;
    t.push_back(static_cast<double>(i) / fs);
    y.push_back(static_cast<double>(dbPerSample[i]));
  }
}

}  // namespace

// ──────────────────────────────────────────────────────────────── VS-10

MW_TEST("VS-10 the decibel-domain decay is a straight line in dB") {
  // R = 50 is 64.8 dB/s in `syn-04` §5.3's derived table. The code-to-rate law
  // behind that table is [I] and stays out of this tree, so the family is
  // given the physical rate and the row is asserted in physical units.
  const float kRate50 = 64.8f;
  const RateLevel stages[4] = {
      {1.0e6f, 0.0f}, {kRate50, -96.0f}, {kRate50, -96.0f}, {kRate50, -96.0f}};
  Envelope env = prepared(sixOperator(stages));
  std::vector<float> v = render(env, pressed(), held(), 96000);
  std::vector<double> t;
  std::vector<double> y;
  decayInDb(v, 48000.0, kSixOperatorFloorDb, t, y);
  const Fit fit = fitLine(t, y);
  // Non-vacuity: the decay must actually have traversed the range. A shape that
  // never left 0 dB, or one whose floor cut it off at −20, regresses beautifully.
  MW_EXPECT(fit.n > 10000);
  MW_EXPECT(y.front() - y.back() > 80.0);
  MW_EXPECT(fit.r2 >= 0.999);
  MW_EXPECT(std::fabs(-fit.slope - 64.8) <= 64.8 * 0.05);
  // The floor is where the panel's level range ends: −96 is below it, and the
  // straight line stops at −89.9 rather than passing through. The number is
  // the sheet's, written here rather than read from the header, so a header
  // that moved it could not move this expectation with it.
  MW_EXPECT(v.back() >= -89.9f - 1e-4f);
  MW_EXPECT(v.back() <= -89.9f + 1e-3f);
}

MW_TEST("VS-10 a decay interpolated linearly in amplitude is not straight in dB") {
  // The other half. The same excursion — full scale down to the floor, over the
  // same 1.39 s a 64.8 dB/s decay takes — as a straight line in *amplitude*,
  // which is what a port that lerps between level values produces. Read in dB
  // it is a log curve that spends most of its 90 dB in the last few percent
  // of its time, and no straight line fits it.
  const float floorAmp = std::pow(10.0f, kSixOperatorFloorDb / 20.0f);
  EnvelopeShape naive;
  naive.count = 3;
  naive.sustainSegment = 2;
  naive.endSegment = 2;
  naive.domain = EnvelopeDomain::Linear;
  naive.drive = SegmentDrive::Duration;
  naive.segments[0] = {1.0f, 0.0f, SegmentCurve::Linear, 1.0f};
  naive.segments[1] = {floorAmp, -kSixOperatorFloorDb / 64.8f, SegmentCurve::Linear, 1.0f};
  naive.segments[2] = {floorAmp, 0.0f, SegmentCurve::Linear, 1.0f};
  Envelope env = prepared(naive);
  std::vector<float> amp = render(env, pressed(), held(), 96000);
  std::vector<float> db;
  db.reserve(amp.size());
  for (const float a : amp) db.push_back(a > 0.0f ? 20.0f * std::log10(a) : -200.0f);
  std::vector<double> t;
  std::vector<double> y;
  decayInDb(db, 48000.0, kSixOperatorFloorDb, t, y);
  const Fit fit = fitLine(t, y);
  MW_EXPECT(fit.n > 10000);
  MW_EXPECT(y.front() - y.back() > 80.0);
  MW_EXPECT(fit.r2 < 0.9);
}

// ────────────────────────────────────────────── the six-operator attack

MW_TEST("the six-operator attack starts at the floor and is convex in dB") {
  // 89.9 dB at 899 dB/s: a 100 ms attack, 4800 samples.
  const RateLevel stages[4] = {{899.0f, 0.0f}, {50.0f, -20.0f}, {50.0f, -20.0f}, {50.0f, -89.9f}};
  Envelope env = prepared(sixOperator(stages));
  std::vector<float> v = render(env, pressed(), held(), 4800);
  // Not −inf, and not silence for long: the first sample is already inside a
  // decibel of the floor. Omitting the floor is the soft, late attack.
  MW_EXPECT(v[0] > -89.9f - 1e-3f);
  MW_EXPECT(v[0] < -89.9f + 1.0f);
  // A quarter of the way through, more than half of the dB travel is done —
  // 60 % at k = 3.5. A linear-in-dB attack, the "clicky but flat" onset the
  // sheet names as a naive port's tell, reads exactly 25 % here.
  const float travelled = (v[1199] - kSixOperatorFloorDb) / -kSixOperatorFloorDb;
  MW_EXPECT(travelled > 0.5f);
  MW_EXPECT(std::fabs(v[4799]) < 0.01f);
}

MW_TEST("a rising six-operator segment seeks and a falling one is straight") {
  const RateLevel swell[4] = {{100.0f, -30.0f}, {100.0f, 0.0f}, {100.0f, -40.0f}, {100.0f, -89.9f}};
  const EnvelopeShape s = sixOperator(swell);
  MW_EXPECT(s.segments[0].curve == SegmentCurve::TargetSeeking);
  MW_EXPECT(s.segments[1].curve == SegmentCurve::TargetSeeking);
  MW_EXPECT(s.segments[2].curve == SegmentCurve::Linear);
  MW_EXPECT(s.segments[3].curve == SegmentCurve::Linear);
  MW_EXPECT(s.domain == EnvelopeDomain::Decibel);
  MW_EXPECT(s.drive == SegmentDrive::Rate);
}

// ──────────────────────────────────────────────────────────────── VS-08

MW_TEST("VS-08 a rate-driven decay takes the same wall-clock time at every host rate") {
  const double rates[4] = {44100.0, 48000.0, 96000.0, 192000.0};
  double seconds[4] = {0, 0, 0, 0};
  for (int r = 0; r < 4; ++r) {
    const RateLevel stages[4] = {
        {1.0e6f, 0.0f}, {100.0f, -89.9f}, {100.0f, -89.9f}, {100.0f, -89.9f}};
    Envelope env = prepared(sixOperator(stages), rates[r]);
    env.advance(pressed(), 1);
    int frames = 0;
    int atPeak = -1;
    int atMinus60 = -1;
    while (frames < static_cast<int>(rates[r]) && atMinus60 < 0) {
      const float level = env.advance(held(), 1);
      ++frames;
      if (atPeak < 0 && level >= -0.01f) atPeak = frames;
      if (atPeak >= 0 && level <= -60.0f) atMinus60 = frames;
    }
    MW_EXPECT(atPeak > 0);
    MW_EXPECT(atMinus60 > atPeak);
    seconds[r] = static_cast<double>(atMinus60 - atPeak) / rates[r];
  }
  // 60 dB at 100 dB/s is 0.6 s at every rate, within half a percent. Measured
  // 0.6002 / 0.5998 / 0.6001 / 0.6007 s.
  MW_EXPECT(std::fabs(seconds[0] - 0.6) < 0.01);
  for (int r = 1; r < 4; ++r) MW_EXPECT(std::fabs(seconds[r] - seconds[0]) / seconds[0] < 0.005);
}

// ───────────────────────────────────────────────── real-time safety, §6.2

MW_TEST("nothing on the audio path allocates") {
  const RateLevel op[4] = {{5000.0f, 0.0f}, {200.0f, -30.0f}, {200.0f, -30.0f}, {400.0f, -89.9f}};
  Envelope env = prepared(sixOperator(op, 0.002f));
  mw::test::RtGuard guard;
  TriggerBus bus = pressed();
  for (int i = 0; i < 400; ++i) {
    env.advance(bus, 64);
    bus.single = (i % 37) == 0;
    bus.multi = bus.single;
    bus.gate = (i % 11) != 0;
  }
  MW_EXPECT_EQ(static_cast<int>(guard.allocations()), 0);
}

MW_TEST("the RtGuard is watching rather than asleep") {
  std::vector<float> scratch;
  mw::test::RtGuard guard;
  scratch.resize(1024);
  MW_EXPECT(guard.allocations() > 0);
}

MW_TEST_MAIN("envelope shapes")
