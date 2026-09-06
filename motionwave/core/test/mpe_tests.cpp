// Motion Wave — the MPE router. `lib-voice-substrate.md` §5.5 and §8: VS-20
// to VS-24, the router's half of VS-31, and the conformance rows of `std-01`
// §11.1 that the substrate can answer on its own. VS-06, the damper, is
// `damper_tests.cpp`.
//
// VS-23 is written the way the design corrected it: the two zones' member
// sets are counted and compared, by size and by channel, because a receiver
// that ignores a configuration message it cannot fit satisfies every
// sentence of the row's original prose — ten members, zero members, disjoint —
// while being the outcome the prose said must not pass. VS-22 has the same
// shape from the other side and carries the non-vacuity the design asks for:
// after the release tail is shown not to move, a new note on the same channel
// must start bent, or the test is passing on a router that dropped the
// channel.
//
// Mutation-tested, each edit restored before the next, and recorded as
// observed rather than as predicted:
//   `configure` recomputing only the addressed zone → red: VS-23's truncation
//     case (ten and ten, not disjoint), its grow-back case, and A7.
//   `configure` ignoring a message that will not fit → red: the same three
//     (ten and zero, under fourteen, was passing the row as first written).
//   the message leaving member sensitivity as it was → red: VS-20, VS-21,
//     VS-22 and the controllers-reset case; A10 stayed green, correctly — RPN 0
//     after the message sets the zone whatever the message left.
//   `unbind` leaving the voice on the channel's dispatch → red: VS-22, A15, and
//     VS-06's bound-channel count in `damper_tests.cpp`.
//   `bind` starting a voice from zeroed state rather than the channel's →
//     red: VS-21 and VS-22; A21 stayed green because its pressure is zero
//     either way, which is why VS-21 carries a non-zero timbre as well.
//   velocity zero mapped to release velocity zero → red: VS-24 only.
//   RPN 0 on a member applied to that channel alone → red: A10 only.
#include "../dsp/voice/mpe.h"
#include "harness.h"
#include "rt_guard.h"

#include <cmath>
#include <cstdint>

using namespace mw;
using namespace mw::dsp::voice;

namespace {

MpeRouter prepared(int capacity = 16) {
  MpeRouter r;
  r.prepare(capacity);
  return r;
}

int bits(std::uint16_t mask) {
  int n = 0;
  for (; mask != 0; mask = static_cast<std::uint16_t>(mask & (mask - 1u))) ++n;
  return n;
}

}  // namespace

// ───────────────────────────────────────────────────── VS-23: the zones

MW_TEST("VS-23 a second zone that will not fit truncates the first, and the two never overlap") {
  MpeRouter r = prepared();
  r.configure(ZoneSide::Lower, 10);
  r.configure(ZoneSide::Upper, 10);
  const std::uint16_t lower = r.memberMask(ZoneSide::Lower);
  const std::uint16_t upper = r.memberMask(ZoneSide::Upper);
  // Four, ten, fourteen, disjoint — and by channel, not only by count:
  // channels 2–5 and 15 down to 6 in MIDI's numbering, 1–4 and 14 down to 5 here.
  MW_EXPECT_EQ(bits(lower), 4);
  MW_EXPECT_EQ(bits(upper), 10);
  MW_EXPECT_EQ(bits(static_cast<std::uint16_t>(lower | upper)), 14);
  MW_EXPECT_EQ(lower & upper, 0);
  MW_EXPECT_EQ(lower, 0x001E);
  MW_EXPECT_EQ(upper, 0x7FE0);
  MW_EXPECT(r.isMaster(0) && r.isMaster(15));
  MW_EXPECT(r.isMember(4) && r.zoneFor(4).side == ZoneSide::Lower);
  MW_EXPECT(r.isMember(5) && r.zoneFor(5).side == ZoneSide::Upper);
}

MW_TEST("VS-23 a truncated zone grows back when the zone that squeezed it is deleted") {
  MpeRouter r = prepared();
  r.configure(ZoneSide::Lower, 10);
  r.configure(ZoneSide::Upper, 10);
  MW_EXPECT_EQ(bits(r.memberMask(ZoneSide::Lower)), 4);
  r.configure(ZoneSide::Upper, 0);
  MW_EXPECT_EQ(bits(r.memberMask(ZoneSide::Lower)), 10);
  MW_EXPECT(!r.zone(ZoneSide::Upper).active);
  MW_EXPECT(!r.isMaster(15));
}

MW_TEST("A3 two zones of seven take channels 2–8 and 15–9 and share nothing") {
  MpeRouter r = prepared();
  r.configure(ZoneSide::Lower, 7);
  r.configure(ZoneSide::Upper, 7);
  MW_EXPECT_EQ(r.memberMask(ZoneSide::Lower), 0x00FE);
  MW_EXPECT_EQ(r.memberMask(ZoneSide::Upper), 0x7F00);
  MW_EXPECT_EQ(bits(static_cast<std::uint16_t>(r.memberMask(ZoneSide::Lower) |
                                               r.memberMask(ZoneSide::Upper))),
               14);
}

MW_TEST("A7 channel 1 is a member of an upper zone of fifteen when there is no lower zone") {
  MpeRouter r = prepared();
  r.configure(ZoneSide::Upper, 15);
  MW_EXPECT(r.isMember(0));
  MW_EXPECT(!r.isMaster(0));
  MW_EXPECT_EQ(bits(r.memberMask(ZoneSide::Upper)), 15);
  // A lower zone arriving afterwards takes its master and its members back.
  r.configure(ZoneSide::Lower, 3);
  MW_EXPECT(r.isMaster(0));
  MW_EXPECT_EQ(bits(r.memberMask(ZoneSide::Upper)), 11);
  MW_EXPECT_EQ(r.memberMask(ZoneSide::Lower), 0x000E);
}

// ─────────────────────────────────────────── VS-20 to VS-22: the numbers

MW_TEST("VS-20 the configuration message sets member sensitivity to ±48 and master to ±2") {
  MpeRouter r = prepared();
  // A plain channel's own range first, so the message is seen to *reset* it.
  r.setBendSensitivity(3, 12.0f);
  r.configure(ZoneSide::Lower, 15);
  r.bind(3, 0);
  r.setBend(3, 1.0f);
  MW_EXPECT_NEAR(r.bendSemitones(0), 48.0f, 0.01);
  // A note on the master channel itself bends at the master's range, and a
  // member adds the master's bend on top of its own — A12's summation.
  r.bind(0, 1);
  r.setBend(0, 1.0f);
  MW_EXPECT_NEAR(r.bendSemitones(1), 2.0f, 0.01);
  MW_EXPECT_NEAR(r.bendSemitones(0), 50.0f, 0.01);
}

MW_TEST("A10 RPN 0 on one member channel sets the whole zone's member sensitivity") {
  MpeRouter r = prepared();
  r.configure(ZoneSide::Lower, 15);
  r.setBendSensitivity(5, 12.0f);
  r.bind(3, 0);
  r.setBend(3, 1.0f);
  MW_EXPECT_NEAR(r.bendSemitones(0), 12.0f, 0.01);
  // Outside any zone the same message is that channel's alone.
  MpeRouter plain = prepared();
  plain.setBendSensitivity(5, 12.0f);
  plain.bind(3, 0);
  plain.setBend(3, 1.0f);
  MW_EXPECT_NEAR(plain.bendSemitones(0), kDefaultBendSemitones, 0.01);
  plain.bind(5, 1);
  plain.setBend(5, 1.0f);
  MW_EXPECT_NEAR(plain.bendSemitones(1), 12.0f, 0.01);
}

MW_TEST("VS-21 a bend set with nothing sounding is what the next note starts with") {
  MpeRouter r = prepared();
  r.configure(ZoneSide::Lower, 15);
  r.setBend(3, 0.25f);
  r.setTimbre(4, 100.0f / 127.0f);
  MW_EXPECT_EQ(r.boundVoices(), 0);
  r.bind(3, 0);
  MW_EXPECT_NEAR(r.bendSemitones(0), 12.0f, 0.01);
  r.bind(4, 1);
  MW_EXPECT_NEAR(r.timbre(1), 100.0f / 127.0f, 1e-6);
}

MW_TEST("VS-22 a member bend after note-off does not move the release tail, and the next note starts bent") {
  MpeRouter r = prepared();
  r.configure(ZoneSide::Lower, 15);
  r.bind(3, 0);
  r.setBend(3, 0.25f);
  const float sounding = r.bendSemitones(0);
  r.unbind(3, 0);
  r.setBend(3, 1.0f);
  MW_EXPECT(r.bendSemitones(0) == sounding);
  MW_EXPECT_NEAR(sounding, 12.0f, 0.01);
  // The channel was not dropped: a new note on it starts at the full bend.
  r.bind(3, 1);
  MW_EXPECT_NEAR(r.bendSemitones(1), 48.0f, 0.01);
  MW_EXPECT(r.bendSemitones(0) == sounding);
}

MW_TEST("A15 rapid channel reuse: pressure on the reused channel reaches the new note only") {
  MpeRouter r = prepared();
  r.configure(ZoneSide::Lower, 15);
  r.bind(3, 0);
  r.setPressure(3, 0.4f);
  r.unbind(3, 0);
  r.bind(3, 1);
  r.setPressure(3, 0.9f);
  MW_EXPECT_NEAR(r.pressure(0), 0.4f, 1e-6);
  MW_EXPECT_NEAR(r.pressure(1), 0.9f, 1e-6);
}

// ───────────────────────────────────────── the message's side effects

MW_TEST("configuring stops per-note control on every channel that entered or left, and reports which") {
  MpeRouter r = prepared();
  r.bind(3, 0);
  r.bind(7, 1);
  const std::uint16_t entered = r.configure(ZoneSide::Lower, 5);
  MW_EXPECT_EQ(entered, 0x003F);
  MW_EXPECT_EQ(r.channelOf(0), kUnboundChannel);
  MW_EXPECT_EQ(r.channelOf(1), 7);
  MW_EXPECT_EQ(r.boundChannels(), 1);
  const std::uint16_t left = r.configure(ZoneSide::Lower, 0);
  MW_EXPECT_EQ(left, 0x003F);
  MW_EXPECT(!r.active());
}

MW_TEST("the configuration message resets the controllers of every channel it touches") {
  MpeRouter r = prepared();
  r.setBend(3, 0.5f);
  r.setPressure(3, 0.7f);
  r.setBend(9, 0.5f);
  r.configure(ZoneSide::Lower, 5);
  const ChannelState touched = r.snapshot(3);
  MW_EXPECT_NEAR(touched.bendNormalised, 0.0f, 1e-6);
  MW_EXPECT_NEAR(touched.pressure, 0.0f, 1e-6);
  MW_EXPECT_NEAR(touched.timbre, 0.5f, 1e-6);
  MW_EXPECT_NEAR(touched.bendSemitones, 48.0f, 1e-6);
  MW_EXPECT_NEAR(r.snapshot(9).bendNormalised, 0.5f, 1e-6);
}

MW_TEST("stopNotesOn ends identity, key and gate for the masked channels only") {
  NoteRegistry registry;
  registry.prepare(32);
  VoiceSet set;
  VoiceSetConfig config;
  config.capacity = 16;
  set.prepare(config);
  set.allocate(registry.press(3, 60));
  set.allocate(registry.press(3, 64));
  set.allocate(registry.press(7, 67));
  MW_EXPECT_EQ(stopNotesOn(static_cast<std::uint16_t>(1u << 3), registry, set), 2);
  MW_EXPECT_EQ(registry.heldCount(), 1);
  MW_EXPECT_EQ(registry.heldChannelAt(0), 7);
  MW_EXPECT_EQ(set.sustainingCount(), 1);
  MW_EXPECT_EQ(set.liveCount(), 3);
}

// ──────────────────────────────────────────── the three smaller rules

MW_TEST("VS-24 a note-on with velocity zero is a note-off with release velocity 64") {
  const NoteEvent off = noteOnEvent(0);
  MW_EXPECT(off.isOff);
  MW_EXPECT_NEAR(off.velocity, 64.0f / 127.0f, 1.0f / 127.0f);
  const NoteEvent on = noteOnEvent(100);
  MW_EXPECT(!on.isOff);
  MW_EXPECT_NEAR(on.velocity, 100.0f / 127.0f, 1e-6);
  MW_EXPECT(!noteOnEvent(1).isOff);
}

MW_TEST("A21 a zero pressure before a note is the value the note starts with, not a gesture") {
  MpeRouter r = prepared();
  r.configure(ZoneSide::Lower, 15);
  r.bind(4, 1);
  r.setPressure(4, 0.5f);
  r.setPressure(3, 0.9f);
  r.setPressure(3, 0.0f);
  r.bind(3, 0);
  MW_EXPECT_NEAR(r.pressure(0), 0.0f, 1e-6);
  MW_EXPECT_NEAR(r.pressure(1), 0.5f, 1e-6);
}

MW_TEST("pressure adds and clamps; master timbre is an offset from its centre") {
  MpeRouter r = prepared();
  r.configure(ZoneSide::Lower, 15);
  r.bind(3, 0);
  r.setPressure(3, 0.6f);
  r.setPressure(0, 0.6f);
  MW_EXPECT_NEAR(r.pressure(0), 1.0f, 1e-6);
  r.setTimbre(3, 0.3f);
  MW_EXPECT_NEAR(r.timbre(0), 0.3f, 1e-6);
  r.setTimbre(0, 0.7f);
  MW_EXPECT_NEAR(r.timbre(0), 0.5f, 1e-6);
}

MW_TEST("a voice on the master channel is not counted twice") {
  MpeRouter r = prepared();
  r.configure(ZoneSide::Lower, 15);
  r.bind(0, 0);
  r.setBend(0, 1.0f);
  MW_EXPECT_NEAR(r.bendSemitones(0), 2.0f, 1e-6);
}

MW_TEST("the timbre convention belongs to the device and survives a reset") {
  MpeRouter r = prepared();
  MW_EXPECT(r.snapshot(3).timbreIsAbsolute);
  r.setTimbreAbsolute(false);
  r.reset();
  MW_EXPECT(!r.snapshot(3).timbreIsAbsolute);
  MW_EXPECT(!r.timbreIsAbsolute());
}

// ───────────────────────────────────────────────── real-time safety, VS-31

MW_TEST("VS-31 a configuration message mid-render allocates nothing") {
  NoteRegistry registry;
  registry.prepare(64);
  VoiceSet set;
  VoiceSetConfig config;
  config.capacity = 16;
  set.prepare(config);
  MpeRouter r = prepared(16);
  mw::test::RtGuard guard;
  for (int round = 0; round < 20; ++round) {
    r.configure(ZoneSide::Lower, static_cast<std::uint8_t>(3 + (round % 12)));
    r.configure(ZoneSide::Upper, static_cast<std::uint8_t>(round % 8));
    for (std::uint8_t ch = 1; ch < 6; ++ch) {
      const NoteId id = registry.press(ch, static_cast<std::uint8_t>(48 + ch));
      r.bind(ch, set.allocate(id));
      r.setBend(ch, 0.3f);
      r.setPressure(ch, 0.5f);
      r.setTimbre(ch, 0.6f);
      r.setBendSensitivity(ch, 24.0f);
    }
    for (std::uint8_t ch = 1; ch < 4; ++ch) {
      const NoteId id = registry.release(ch, static_cast<std::uint8_t>(48 + ch));
      r.unbind(ch, set.voiceOf(id));
      set.releaseNote(id);
    }
    stopNotesOn(0xFFFFu, registry, set);
    if (round == 10) r.reset();
  }
  MW_EXPECT_EQ(static_cast<int>(guard.allocations()), 0);
}

MW_TEST("the RtGuard is watching rather than asleep") {
  MpeRouter r;
  mw::test::RtGuard guard;
  r.prepare(64);  // `prepare` is the one method that is allowed to
  MW_EXPECT(guard.allocations() > 0);
}

MW_TEST_MAIN("mpe")
