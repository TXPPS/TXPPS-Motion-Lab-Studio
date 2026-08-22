// Motion Wave — the song's clock, tested.
//
// Every one of these is a case where getting it wrong puts the playhead and
// the notes in different places, which is the class of bug that only shows up
// after a tempo change and only where nobody is looking.
#include "../graph/tempo_map.h"
#include "harness.h"

using namespace mw;

MW_TEST("a quarter note at 120 is half a second, and PPQ is 480") {
  TempoMap map;
  MW_EXPECT_EQ(kTicksPerQuarter, 480);
  MW_EXPECT_NEAR(map.secondsAt(480), 0.5, 1e-12);
  MW_EXPECT_NEAR(map.secondsAt(1920), 2.0, 1e-12);
}

MW_TEST("480 divides by every subdivision a sequencer needs") {
  // This is why the number is 480 rather than something rounder: triplets,
  // quintuplets and 32nds all have to land on whole ticks or they accumulate
  // rounding over a long arrangement.
  for (int div : {2, 3, 4, 5, 6, 8, 10, 12, 16}) {
    MW_EXPECT_EQ(kTicksPerQuarter % div, 0);
  }
}

MW_TEST("a tempo change moves time only after the change") {
  TempoMap map;
  map.setTempo(0, 120.0);
  map.setTempo(1920, 60.0);  // bar 2 at 4/4
  MW_EXPECT_NEAR(map.secondsAt(1920), 2.0, 1e-12);
  // A bar at 60 bpm is four seconds, so bar 3 lands at 2 + 4.
  MW_EXPECT_NEAR(map.secondsAt(3840), 6.0, 1e-12);
}

MW_TEST("seconds and ticks are inverses across a tempo change") {
  TempoMap map;
  map.setTempo(0, 100.0);
  map.setTempo(960, 140.0);
  map.setTempo(2880, 75.0);
  for (Tick t : {0, 137, 959, 960, 961, 2000, 2879, 2880, 5000, 19200}) {
    const double sec = map.secondsAt(t);
    MW_EXPECT_EQ(map.tickAt(sec), t);
  }
}

MW_TEST("a tempo ramp is integrated, not averaged") {
  TempoMap map;
  map.setTempo(0, 60.0, /*ramp=*/true);
  map.setTempo(1920, 120.0);
  // Tempo linear in ticks means time is the integral of 60/(PPQ*bpm), whose
  // closed form over 60->120 bpm across a bar is (60/480)*ln(2)/slope.
  // Averaging the tempo instead would give 4*60/90 = 2.6667 s, which is 27 ms
  // adrift over a single bar — audible against a click, and cumulative.
  const double slope = (120.0 - 60.0) / 1920.0;
  const double expected = (60.0 / 480.0) * std::log(120.0 / 60.0) / slope;
  MW_EXPECT_NEAR(map.secondsAt(1920), expected, 1e-9);
  MW_EXPECT(std::fabs(map.secondsAt(1920) - 2.6666667) > 0.02);
  // And the ramp is still invertible.
  MW_EXPECT_EQ(map.tickAt(map.secondsAt(1000)), 1000);
}

MW_TEST("the tempo at a point on a ramp is the interpolated one") {
  TempoMap map;
  map.setTempo(0, 60.0, true);
  map.setTempo(1920, 120.0);
  MW_EXPECT_NEAR(map.bpmAt(0), 60.0, 1e-9);
  MW_EXPECT_NEAR(map.bpmAt(960), 90.0, 1e-9);
  MW_EXPECT_NEAR(map.bpmAt(1920), 120.0, 1e-9);
}

MW_TEST("bars and beats count from one, the way a musician does") {
  TempoMap map;
  MW_EXPECT_EQ(map.barBeatAt(0).bar, 1);
  MW_EXPECT_EQ(map.barBeatAt(0).beat, 1);
  MW_EXPECT_EQ(map.barBeatAt(0).tickInBeat, 0);
  MW_EXPECT_EQ(map.barBeatAt(480).beat, 2);
  MW_EXPECT_EQ(map.barBeatAt(1920).bar, 2);
  MW_EXPECT_EQ(map.barBeatAt(1920 + 240).tickInBeat, 240);
}

MW_TEST("a time signature change re-bars everything after it") {
  TempoMap map;
  map.setTimeSignature(0, 4, 4);
  map.setTimeSignature(1920, 3, 4);  // from bar 2, three beats to the bar
  MW_EXPECT_EQ(map.barBeatAt(1920).bar, 2);
  MW_EXPECT_EQ(map.barBeatAt(1920 + 1440).bar, 3);  // one 3/4 bar later
  MW_EXPECT_EQ(map.tickAtBar(3), 1920 + 1440);
}

MW_TEST("an eighth-note signature has half-length beats") {
  TempoMap map;
  map.setTimeSignature(0, 7, 8);
  MW_EXPECT_EQ(TempoMap::ticksPerBeat(8), 240);
  MW_EXPECT_EQ(map.tickAtBar(2), 7 * 240);
  MW_EXPECT_EQ(map.barBeatAt(240).beat, 2);
}

MW_TEST("bars and ticks are inverses under mixed signatures") {
  TempoMap map;
  map.setTimeSignature(0, 4, 4);
  map.setTimeSignature(1920, 5, 8);
  map.setTimeSignature(1920 + 5 * 240 * 2, 3, 4);
  for (std::int64_t bar = 1; bar <= 12; ++bar) {
    MW_EXPECT_EQ(map.barBeatAt(map.tickAtBar(bar)).bar, bar);
  }
}

MW_TEST("setting a tempo twice at one tick replaces it rather than stacking") {
  TempoMap map;
  map.setTempo(960, 140.0);
  map.setTempo(960, 90.0);
  MW_EXPECT_EQ(static_cast<long long>(map.tempos().size()), 2);
  MW_EXPECT_NEAR(map.bpmAt(960), 90.0, 1e-9);
}

MW_TEST("a nonsensical tempo is refused rather than producing infinite time") {
  TempoMap map;
  map.setTempo(480, 0.0);
  map.setTempo(480, -30.0);
  MW_EXPECT_EQ(static_cast<long long>(map.tempos().size()), 1);
  MW_EXPECT(std::isfinite(map.secondsAt(96000)));
}

MW_TEST_MAIN("tempo")
