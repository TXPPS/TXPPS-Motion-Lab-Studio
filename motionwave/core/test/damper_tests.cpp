// Motion Wave — the sustain pedal. `lib-voice-substrate.md` §5.5 and §8: VS-06.
//
// The row reads three counts because each one is a different lifetime, and a
// pedal that extended the wrong one is the sustain-pedal stuck-note class:
// after a note released under the pedal, the registry holds no key
// (`heldCount`), the router holds no channel (`boundChannels`), and only the
// gate is still up (`sustainingCount`). Lifting the pedal drops the gates in
// the same call. The two cases after it are the pedal's own contract: a
// deferred release for a note that was stolen meanwhile finds nothing, and
// the deferred list is bounded so nothing on the audio thread grows.
//
// Mutation-tested, each edit restored before the next, and recorded as
// observed rather than as predicted:
//   lifting the damper clearing its list without dropping the gates → red:
//     VS-06 and the stolen-note case; nothing else.
//   a release under the pedal dropping the gate at once, so the pedal does
//     nothing → red: VS-06 (twelve sustaining, not zero) and the bounded case;
//     nothing else.
//   `unbind` (in `mpe.h`) leaving the voice on the channel's dispatch → red:
//     VS-06's bound-channel count, with VS-22 and A15 in `mpe_tests.cpp`.
#include "../dsp/voice/damper.h"
#include "../dsp/voice/mpe.h"
#include "harness.h"
#include "rt_guard.h"

#include <cstdint>

using namespace mw;
using namespace mw::dsp::voice;

namespace {

VoiceSet preparedSet(int capacity) {
  VoiceSet set;
  VoiceSetConfig config;
  config.capacity = capacity;
  set.prepare(config);
  return set;
}

}  // namespace

MW_TEST("VS-06 the damper defers the gate and nothing else") {
  NoteRegistry registry;
  registry.prepare(32);
  VoiceSet set = preparedSet(16);
  MpeRouter r;
  r.prepare(16);
  Damper damper;
  damper.prepare(16);
  r.configure(ZoneSide::Lower, 15);
  damper.setDown(true, set);

  for (int i = 0; i < 12; ++i) {
    const auto ch = static_cast<std::uint8_t>(1 + i);
    const auto key = static_cast<std::uint8_t>(60 + i);
    r.bind(ch, set.allocate(registry.press(ch, key)));
  }
  MW_EXPECT_EQ(registry.heldCount(), 12);
  MW_EXPECT_EQ(r.boundChannels(), 12);
  MW_EXPECT_EQ(set.sustainingCount(), 12);

  for (int i = 0; i < 12; ++i) {
    const auto ch = static_cast<std::uint8_t>(1 + i);
    const auto key = static_cast<std::uint8_t>(60 + i);
    const NoteId id = registry.release(ch, key);
    r.unbind(ch, set.voiceOf(id));
    MW_EXPECT(damper.release(id, set));
  }
  // Identity and channel ended at note-off; only the gates wait.
  MW_EXPECT_EQ(registry.heldCount(), 0);
  MW_EXPECT_EQ(r.boundChannels(), 0);
  MW_EXPECT_EQ(set.sustainingCount(), 12);
  MW_EXPECT_EQ(damper.pendingCount(), 12);

  MW_EXPECT_EQ(damper.setDown(false, set), 12);
  MW_EXPECT_EQ(set.sustainingCount(), 0);
  MW_EXPECT_EQ(damper.pendingCount(), 0);
  MW_EXPECT_EQ(set.liveCount(), 12);
}

MW_TEST("a deferred release for a stolen note finds nothing when the pedal lifts") {
  VoiceSet set = preparedSet(1);
  Damper damper;
  damper.prepare(1);
  set.allocate(1);
  damper.setDown(true, set);
  damper.release(1, set);
  set.allocate(2);  // steals the only voice from note 1
  MW_EXPECT_EQ(damper.setDown(false, set), 0);
  MW_EXPECT_EQ(set.sustainingCount(), 1);
  MW_EXPECT_EQ(static_cast<int>(set.noteOf(0)), 2);
}

MW_TEST("the damper's buffer is bounded: past it the oldest deferred gate falls early") {
  VoiceSet set = preparedSet(16);
  Damper damper;
  damper.prepare(2);  // room for eight deferred gates
  damper.setDown(true, set);
  for (NoteId n = 1; n <= 9; ++n) {
    set.allocate(n);
    damper.release(n, set);
  }
  MW_EXPECT_EQ(damper.pendingCount(), 8);
  // Note 1's gate fell when note 9 arrived: eight still up, and a release
  // for note 1 now finds it already down.
  MW_EXPECT_EQ(set.sustainingCount(), 8);
  MW_EXPECT(set.releaseNote(1));
  MW_EXPECT_EQ(set.sustainingCount(), 8);
}

MW_TEST("with the pedal up a release is immediate and nothing is queued") {
  VoiceSet set = preparedSet(4);
  Damper damper;
  damper.prepare(4);
  set.allocate(7);
  MW_EXPECT(!damper.release(7, set));
  MW_EXPECT_EQ(set.sustainingCount(), 0);
  MW_EXPECT_EQ(damper.pendingCount(), 0);
  MW_EXPECT(!damper.isDown());
}

MW_TEST("VS-31 deferring and lifting allocate nothing") {
  VoiceSet set = preparedSet(16);
  Damper damper;
  damper.prepare(16);
  mw::test::RtGuard guard;
  NoteId next = 1;
  for (int round = 0; round < 40; ++round) {
    damper.setDown((round & 1) == 0, set);
    for (int i = 0; i < 20; ++i) {
      const NoteId id = next++;
      set.allocate(id);
      damper.release(id, set);
    }
  }
  damper.setDown(false, set);
  damper.reset();
  MW_EXPECT_EQ(static_cast<int>(guard.allocations()), 0);
}

MW_TEST("the RtGuard is watching rather than asleep") {
  Damper damper;
  mw::test::RtGuard guard;
  damper.prepare(64);  // `prepare` is the one method that is allowed to
  MW_EXPECT(guard.allocations() > 0);
}

MW_TEST_MAIN("damper")
