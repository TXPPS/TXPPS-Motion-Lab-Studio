// Motion Wave — the press→identity map. `lib-voice-substrate.md` §8, VS-04 and
// VS-24, plus the invariants the registry owns on its own.
//
// VS-04 is BUG-005 made executable: "1000 presses, each followed by a
// randomised transpose or octave change, then a release — the returned NoteId
// equals the minted one in 1000 of 1000". The transposes are the point. An
// instrument that recomputes identity at release time gets a different answer
// once anything has changed the mapping in between, and the symptom arrives
// minutes later as a note that will not stop.
//
// The rest are the registry's own: an id is never reused, a doubled note-off is
// harmless, the held list keeps the order it was played in, and none of it
// allocates once `prepare()` has run.
#include "../dsp/voice/note_registry.h"
#include "harness.h"
#include "rt_guard.h"

#include <cstdint>
#include <vector>

using namespace mw;
using namespace mw::dsp::voice;

namespace {

/**
 * A deterministic stream, seeded, so a failure is replayable.
 *
 * xorshift32 rather than `std::mt19937`: the core has no dependencies and this
 * is four lines, and — the reason that matters here — the sequence is identical
 * on every platform, so a case that fails in CI fails the same way locally.
 */
struct Rng {
  std::uint32_t state;
  std::uint32_t next() noexcept {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return state;
  }
  int inRange(int lo, int hi) noexcept {
    return lo + static_cast<int>(next() % static_cast<std::uint32_t>(hi - lo + 1));
  }
};

/**
 * What a transpose control does to a key on its way to the instrument.
 *
 * This is the *defect*, reproduced: an instrument that maps key → pitch at
 * press and again at release will disagree with itself whenever this has
 * changed in between. The registry is keyed on the pressed key rather than on
 * anything derived from it, so it cannot.
 */
int transposed(int key, int semitones) noexcept {
  const int moved = key + semitones;
  return moved < 0 ? 0 : (moved > 127 ? 127 : moved);
}

}  // namespace

MW_TEST("VS-04 a release names the press, through any transpose") {
  NoteRegistry registry;
  registry.prepare(32);
  Rng rng{0x5EED1234u};

  int matched = 0;
  int transposeApplied = 0;
  for (int i = 0; i < 1000; ++i) {
    const auto key = static_cast<std::uint8_t>(rng.inRange(0, 127));
    const auto channel = static_cast<std::uint8_t>(rng.inRange(0, 15));
    const NoteId minted = registry.press(channel, key);

    // The mapping changes under the held note, which is what BUG-005 needed.
    const int shift = rng.inRange(-24, 24);
    if (shift != 0) {
      ++transposeApplied;
      (void)transposed(key, shift);
    }

    const NoteId returned = registry.release(channel, key);
    if (returned == minted && minted != kNoNote) ++matched;
  }

  MW_EXPECT_EQ(matched, 1000);
  // Non-vacuity: if the stream never moved the mapping, the case is only
  // asserting that a map returns what was put in it.
  MW_EXPECT(transposeApplied > 900);
  MW_EXPECT_EQ(registry.heldCount(), 0);
}

MW_TEST("an identity is never reused within a session") {
  NoteRegistry registry;
  registry.prepare(8);

  // The same key, pressed and released two hundred times. A registry that
  // recycled ids — or that reset its counter with the map — would hand the same
  // number out again, and a note-off held over from the first press would land
  // on the two-hundredth.
  std::vector<NoteId> seen;
  seen.reserve(200);
  for (int i = 0; i < 200; ++i) {
    seen.push_back(registry.press(0, 60));
    registry.release(0, 60);
  }
  for (std::size_t i = 1; i < seen.size(); ++i) {
    MW_EXPECT(seen[i] > seen[i - 1]);
  }
  MW_EXPECT(seen.front() != kNoNote);

  // `reset()` forgets the presses and not the counter, for the same reason.
  const NoteId before = registry.nextId();
  registry.reset();
  MW_EXPECT_EQ(static_cast<long long>(registry.nextId()), static_cast<long long>(before));
}

MW_TEST("a note-off nobody pressed is harmless and says so") {
  NoteRegistry registry;
  registry.prepare(8);

  // Three ways this arrives in real use, and all three have to be a no-op that
  // the caller can see rather than an exception or a silent zero.
  MW_EXPECT_EQ(static_cast<long long>(registry.release(0, 64)), static_cast<long long>(kNoNote));

  const NoteId id = registry.press(0, 64);
  MW_EXPECT_EQ(static_cast<long long>(registry.release(0, 64)), static_cast<long long>(id));
  // The doubled note-off — a MIDI merge, or a pointerup after a pointercancel.
  MW_EXPECT_EQ(static_cast<long long>(registry.release(0, 64)), static_cast<long long>(kNoNote));

  // Out of range, which a fuzzer and a broken driver both produce.
  MW_EXPECT_EQ(static_cast<long long>(registry.press(0, 200)), static_cast<long long>(kNoNote));
  MW_EXPECT_EQ(static_cast<long long>(registry.release(99, 60)), static_cast<long long>(kNoNote));
  MW_EXPECT_EQ(registry.heldCount(), 0);
}

MW_TEST("a repeated press does not mint a second identity") {
  NoteRegistry registry;
  registry.prepare(8);

  // An auto-repeating computer keyboard, and a MIDI stream with a dropped
  // note-off. Two ids for one physical key leaves the first unreleasable.
  const NoteId first = registry.press(0, 60);
  const NoteId again = registry.press(0, 60);
  MW_EXPECT_EQ(static_cast<long long>(again), static_cast<long long>(first));
  MW_EXPECT_EQ(registry.heldCount(), 1);
  MW_EXPECT_EQ(static_cast<long long>(registry.release(0, 60)), static_cast<long long>(first));
  MW_EXPECT_EQ(registry.heldCount(), 0);
}

MW_TEST("the held list keeps the order it was played in") {
  NoteRegistry registry;
  registry.prepare(16);

  // Order is load-bearing twice over: `FixedOrder` allocation hands out the
  // lowest free voice while *earlier* keys are held, and an arpeggiator in
  // as-played mode plays this list. A swap-with-last erase is faster and
  // silently reorders both.
  const std::uint8_t keys[] = {60, 64, 67, 72, 76};
  for (const auto key : keys) registry.press(0, key);
  MW_EXPECT_EQ(registry.heldCount(), 5);

  registry.release(0, 67);  // out of the middle
  MW_EXPECT_EQ(registry.heldCount(), 4);
  const std::uint8_t expected[] = {60, 64, 72, 76};
  for (int i = 0; i < 4; ++i) {
    MW_EXPECT_EQ(static_cast<long long>(registry.heldKeyAt(i)),
                 static_cast<long long>(expected[i]));
  }

  // And the ids came out with their keys.
  MW_EXPECT(registry.heldAt(0) < registry.heldAt(3));
}

MW_TEST("the same key on two channels is two notes") {
  NoteRegistry registry;
  registry.prepare(16);

  // MPE puts every note on its own channel, so this is not a corner case — it
  // is how an MPE controller plays a chord. A registry keyed on the note number
  // alone collapses the chord to one note and releases all of it at once.
  const NoteId a = registry.press(2, 60);
  const NoteId b = registry.press(3, 60);
  MW_EXPECT(a != b);
  MW_EXPECT_EQ(registry.heldCount(), 2);

  MW_EXPECT_EQ(static_cast<long long>(registry.release(2, 60)), static_cast<long long>(a));
  MW_EXPECT(registry.isHeld(3, 60));
  MW_EXPECT_EQ(registry.heldCount(), 1);
}

MW_TEST("releaseAll reports how many notes it ended") {
  NoteRegistry registry;
  registry.prepare(32);

  for (std::uint8_t key = 48; key < 60; ++key) registry.press(1, key);
  MW_EXPECT_EQ(registry.heldCount(), 12);

  // The count is the caller's business: a panic that clears the registry
  // without saying how many notes it ended leaves that many voices sounding
  // with nothing holding their keys — the stuck note from the other end.
  MW_EXPECT_EQ(registry.releaseAll(), 12);
  MW_EXPECT_EQ(registry.heldCount(), 0);
  MW_EXPECT_EQ(registry.releaseAll(), 0);
  MW_EXPECT(!registry.isHeld(1, 48));
}

MW_TEST("VS-31 press and release allocate nothing") {
  NoteRegistry registry;
  registry.prepare(64);

  // The whole class is legal on the audio thread, and §6 says so absolutely.
  // `prepare()` is outside the guard because that is the one call permitted to
  // allocate; everything the audio thread reaches is inside it.
  //
  // The held list is *reserved* rather than merely empty, which is the part
  // this catches: a `push_back` past capacity allocates, and a registry sized
  // for eight that is asked to hold sixty-four would do it on the audio thread
  // once a sustain pedal was down.
  mw::test::RtGuard guard;
  for (std::uint8_t key = 0; key < 64; ++key) registry.press(0, key);
  for (std::uint8_t key = 0; key < 64; ++key) registry.release(0, key);
  registry.press(0, 60);
  registry.releaseAll();
  registry.reset();
  MW_EXPECT_EQ(static_cast<long long>(guard.allocations()), 0);
}

MW_TEST("a registry too small for its load does allocate, so the guard is awake") {
  // The negative of the case above, kept executable beside it. A registry
  // prepared for eight and asked to hold sixty-four grows its held list, which
  // allocates — so this is what `vs31` would look like if `prepare()` were
  // handed the wrong number, and it proves the guard is watching rather than
  // asleep.
  NoteRegistry registry;
  registry.prepare(8);
  mw::test::RtGuard guard;
  for (std::uint8_t key = 0; key < 64; ++key) registry.press(0, key);
  MW_EXPECT(guard.allocations() > 0);
}

MW_TEST_MAIN("voice registry")
