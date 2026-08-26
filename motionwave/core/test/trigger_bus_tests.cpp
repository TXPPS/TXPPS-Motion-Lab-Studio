// Motion Wave — the trigger bus. `lib-voice-substrate.md` §4.
//
// Three claims, and each of them has a wrong implementation that is inaudible
// until somebody plays legato:
//
//   1. `single` is decided from the gate **as it was before the note-on**. An
//      implementation that raises the gate first never fires `single` at all
//      after the first note, and every generator still retriggers because
//      `multi` is unaffected — so the patch sounds broadly right and the
//      distinction the bus exists for is gone.
//   2. A note-off to a *gated* voice pulses nothing. Pulsing `multi` there
//      would retrigger every multi-triggered generator on release, which is an
//      envelope that restarts its attack when you let go of the key.
//   3. A pulse is broadcast, not consumed. Two generators reading the same step
//      both see it. If reading cleared it, whichever advanced first would own
//      the trigger and the ordering of two unrelated envelopes would decide
//      which one retriggered.
//
// The legato case at the bottom is the behavioural statement all three add up
// to, and it is the one a player would notice.
#include "../dsp/voice/trigger_bus.h"
#include "harness.h"
#include "rt_guard.h"

using namespace mw;
using namespace mw::dsp::voice;

namespace {

TriggerBank prepared(int capacity) {
  TriggerBank bank;
  bank.prepare(capacity);
  return bank;
}

}  // namespace

// ─────────────────────────────────────────────────── the three pulse rules

MW_TEST("a note-on to a silent voice raises both pulses and the gate") {
  TriggerBank bank = prepared(8);
  bank.noteOn(2);
  MW_EXPECT(bank[2].single);
  MW_EXPECT(bank[2].multi);
  MW_EXPECT(bank[2].gate);
}

MW_TEST("a note-on to a gated voice raises multi and not single") {
  TriggerBank bank = prepared(8);
  bank.noteOn(2);
  bank.endStep();
  bank.noteOn(2);
  // The whole of rule 1. An implementation that sets `gate` before testing it
  // passes every other case in this file and fails only here.
  MW_EXPECT(!bank[2].single);
  MW_EXPECT(bank[2].multi);
  MW_EXPECT(bank[2].gate);
}

MW_TEST("a note-off to a gated voice lowers the gate and pulses nothing") {
  TriggerBank bank = prepared(8);
  bank.noteOn(2);
  bank.endStep();
  bank.noteOff(2);
  MW_EXPECT(!bank[2].gate);
  MW_EXPECT(!bank[2].single);
  MW_EXPECT(!bank[2].multi);
}

MW_TEST("a note-off to a voice that is not gated raises multi") {
  TriggerBank bank = prepared(8);
  // The legato pair's second half: the key that was still held under the new
  // one, released after the voice had already been let go.
  bank.noteOff(3);
  MW_EXPECT(bank[3].multi);
  MW_EXPECT(!bank[3].single);
  MW_EXPECT(!bank[3].gate);
}

// ──────────────────────────────────────────────── pulses are one step long

MW_TEST("endStep clears the pulses and leaves the gate") {
  TriggerBank bank = prepared(8);
  bank.noteOn(1);
  bank.endStep();
  MW_EXPECT(!bank[1].single);
  MW_EXPECT(!bank[1].multi);
  MW_EXPECT(bank[1].gate);
}

MW_TEST("a pulse is broadcast, not consumed by the first reader") {
  TriggerBank bank = prepared(8);
  bank.noteOn(0);
  // Two subscribers, in the order they happen to be advanced in. Both must see
  // it — an envelope and an LFO on the same voice have no relationship, and a
  // bus that let the first reader take the pulse would make one exist.
  const bool firstSubscriber = bank[0].multi;
  const bool secondSubscriber = bank[0].multi;
  MW_EXPECT(firstSubscriber);
  MW_EXPECT(secondSubscriber);
}

MW_TEST("endStep leaves the external level alone") {
  TriggerBank bank = prepared(8);
  bank.setExternal(4, true);
  bank.noteOn(4);
  bank.endStep();
  // It is a level the instrument owns, and clearing it here would mean an
  // LFO-driven trigger lasted exactly one control step whatever its source did.
  MW_EXPECT(bank[4].externalTrigger);
  bank.setExternal(4, false);
  MW_EXPECT(!bank[4].externalTrigger);
}

// ─────────────────────────────────────────────────── legato, and the reset

MW_TEST("legato retriggers multi on every key and single only on the first") {
  TriggerBank bank = prepared(8);
  int singles = 0;
  int multis = 0;
  // Four keys pressed into one voice without a release between them, which is
  // what a monophonic legato line does.
  for (int key = 0; key < 4; ++key) {
    bank.noteOn(5);
    singles += bank[5].single ? 1 : 0;
    multis += bank[5].multi ? 1 : 0;
    bank.endStep();
  }
  MW_EXPECT_EQ(singles, 1);
  MW_EXPECT_EQ(multis, 4);
}

MW_TEST("reset lowers every gate") {
  TriggerBank bank = prepared(8);
  for (VoiceId v = 0; v < 8; ++v) bank.noteOn(v);
  bank.reset();
  for (VoiceId v = 0; v < 8; ++v) {
    // A gate left high across a transport jump is a voice that never releases,
    // which is the stuck-note class this substrate exists to close.
    MW_EXPECT(!bank[v].gate);
    MW_EXPECT(!bank[v].multi);
  }
}

MW_TEST("an absent or out-of-range voice is ignored rather than written") {
  TriggerBank bank = prepared(4);
  bank.noteOn(kNoVoice);
  bank.noteOff(kNoVoice);
  bank.setExternal(99, true);
  bank.noteOn(99);
  // Nothing to assert about the writes that did not happen except that the
  // voices that do exist are untouched — and that this did not run off the end,
  // which is the failure `kNoVoice` being 0xFFFF exists to make survivable.
  for (VoiceId v = 0; v < 4; ++v) MW_EXPECT(!bank[v].gate);
  MW_EXPECT_EQ(bank.capacity(), 4);
}

// ───────────────────────────────────────────────── real-time safety, §6.2

MW_TEST("nothing on the audio path allocates") {
  TriggerBank bank = prepared(24);
  mw::test::RtGuard guard;
  for (int i = 0; i < 500; ++i) {
    const VoiceId v = static_cast<VoiceId>(i % 24);
    bank.noteOn(v);
    if ((i & 1) == 0) bank.noteOff(v);
    if ((i & 3) == 0) bank.setExternal(v, (i & 7) == 0);
    bank.endStep();
  }
  bank.reset();
  MW_EXPECT_EQ(static_cast<int>(guard.allocations()), 0);
}

MW_TEST("the RtGuard is watching rather than asleep") {
  // The non-vacuity half: a guard that reports zero because it is not armed
  // reports zero for a leak too.
  TriggerBank bank;
  mw::test::RtGuard guard;
  bank.prepare(64);
  MW_EXPECT(guard.allocations() > 0);
}

MW_TEST_MAIN("trigger bus")
