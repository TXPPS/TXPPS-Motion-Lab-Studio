// Motion Wave — the allocated set. `lib-voice-substrate.md` §8, VS-01 and
// VS-02, plus the invariants the set owns on its own.
//
// VS-01 is PA-003 made executable, and PA-003 was the same defect in two
// unrelated instruments: sixty simultaneous note-ons against a capacity of
// twenty-four produced *sixty* sounding oscillators and one steal, and the
// sampler answered eighty live against a cap of forty-eight. Both stole by
// running over the allocated set without removing each victim as it took it, so
// every pass chose the same voice.
//
// VS-02 is the reason that cannot come back: membership is a position in a
// permutation rather than a flag, so after a hundred thousand random operations
// every id still appears exactly once across free ∪ allocated. A pair of flags
// can disagree; a position cannot be in two places.
//
// The rest are the set's own: a stolen note's late note-off is a no-op, panic
// lowers every gate without freeing a slot whose tail is still sounding, a
// capacity cut never silences a held note, and none of it allocates once
// `prepare()` has run.
#include "../dsp/voice/voice_set.h"
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
 * xorshift32 for the reason the registry's tests give: the core has no
 * dependencies, this is four lines, and the sequence is identical on every
 * platform — so a case that fails in CI fails the same way locally.
 */
struct Rng {
  std::uint32_t state;
  std::uint32_t next() noexcept {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return state;
  }
  int upTo(int n) noexcept { return n <= 0 ? 0 : static_cast<int>(next() % static_cast<unsigned>(n)); }
};

VoiceSet prepared(int capacity) {
  VoiceSet set;
  VoiceSetConfig config;
  config.capacity = capacity;
  set.prepare(config);
  return set;
}

/**
 * Is `slots` still a permutation of 0..capacity-1?
 *
 * The whole of VS-02 in one function, and it is deliberately written as a
 * counting sieve rather than a sort: a sort would hide a duplicate that landed
 * beside its twin, and the failure PA-003 produced was exactly a voice that was
 * in the set twice.
 */
bool isPermutation(const std::vector<VoiceId>& slots) {
  std::vector<int> seen(slots.size(), 0);
  for (const VoiceId v : slots) {
    if (v >= slots.size()) return false;
    if (seen[v]++ != 0) return false;
  }
  return true;
}

/**
 * The claim `isPermutation` alone cannot make: the two spans agree with the
 * voices' own records.
 *
 * Found by mutation, and worth writing down. Replacing `freeAt`'s swap with a
 * bare decrement — which is what a boolean flag per voice degenerates to —
 * leaves the array untouched, so it is still a permutation and the hundred
 * thousand operations above pass. What breaks is *disjointness*: a voice with
 * an owner ends up in the free span, where the next allocation will hand it
 * out while it is still sounding. So both are checked, every step.
 */
bool spansAgree(const VoiceSet& set) {
  const auto& slots = set.permutation();
  for (int i = 0; i < set.liveCount(); ++i) {
    if (set.noteOf(slots[static_cast<std::size_t>(i)]) == kNoNote) return false;
  }
  for (auto i = static_cast<std::size_t>(set.liveCount()); i < slots.size(); ++i) {
    // Read off the set's own record rather than through `noteOf`, which asks
    // only about the allocated span and would answer `kNoNote` for a voice that
    // is wrongly outside it — the exact case this is looking for.
    if (set.ownerOf(slots[i]) != kNoNote) return false;
  }
  return true;
}

}  // namespace

// ─────────────────────────────────────────────────────────── VS-01: the cap

MW_TEST("VS-01 sixty note-ons against a capacity of twenty-four") {
  // The exact case in the directive that recorded PA-003. Sixty presses at one
  // instant — no `beginBlock()` between them, because they arrive in one block,
  // which is what made rule 4 of victim selection necessary at all.
  VoiceSet set = prepared(24);
  NoteId note = 1;
  for (int i = 0; i < 60; ++i) set.allocate(note++);

  MW_EXPECT_EQ(set.liveCount(), 24);
  MW_EXPECT_EQ(static_cast<int>(set.stealCount()), 36);
  // And the counts agree with the representation rather than merely with each
  // other: a `live_` that had drifted from the permutation would satisfy both
  // lines above and still be the defect.
  MW_EXPECT(isPermutation(set.permutation()));
}

MW_TEST("VS-01 eighty note-ons against a capacity of forty-eight") {
  // The sampler's half of PA-003, which reported eighty live against a cap of
  // forty-eight. Repeated at a different size because a cap that worked at one
  // number and not another would be an off-by-one hiding behind a passing test.
  VoiceSet set = prepared(48);
  NoteId note = 1;
  for (int i = 0; i < 80; ++i) set.allocate(note++);

  MW_EXPECT_EQ(set.liveCount(), 48);
  MW_EXPECT_EQ(static_cast<int>(set.stealCount()), 32);
  MW_EXPECT(isPermutation(set.permutation()));
}

MW_TEST("VS-01 live never exceeds the cap at any point, not only at the end") {
  // Not only at the end. A set that overshot to sixty and recovered to
  // twenty-four before anybody looked would pass both cases above, and sixty
  // oscillators is what the defect *sounded* like.
  VoiceSet set = prepared(24);
  NoteId note = 1;
  int worst = 0;
  for (int i = 0; i < 60; ++i) {
    set.allocate(note++);
    if (set.liveCount() > worst) worst = set.liveCount();
  }
  MW_EXPECT_EQ(worst, 24);
}

// ──────────────────────────────────────────────── VS-02: partition integrity

MW_TEST("VS-02 the partition survives a hundred thousand operations") {
  constexpr int kCapacity = 32;
  VoiceSet set = prepared(kCapacity);
  Rng rng{0x5eed1234u};
  NoteId next = 1;
  std::vector<NoteId> outstanding;
  outstanding.reserve(64);

  for (int step = 0; step < 100000; ++step) {
    switch (rng.upTo(4)) {
      case 0: {
        const NoteId note = next++;
        set.allocate(note);
        outstanding.push_back(note);
        break;
      }
      case 1: {
        if (outstanding.empty()) break;
        const int i = rng.upTo(static_cast<int>(outstanding.size()));
        set.releaseNote(outstanding[static_cast<std::size_t>(i)]);
        break;
      }
      case 2: {
        // Retire whatever is at a random position in the allocated span. This
        // is the voice telling the set its envelope reached the floor, and it
        // is the operation that moves an id from the allocated half back into
        // the free half.
        if (set.liveCount() == 0) break;
        const int i = rng.upTo(set.liveCount());
        set.retire(set.permutation()[static_cast<std::size_t>(i)]);
        break;
      }
      default:
        set.beginBlock();
        break;
    }

    // Walked every step rather than once at the end, because a partition that
    // breaks and heals is a partition that was broken while a voice was being
    // rendered from it.
    if (!isPermutation(set.permutation()) || !spansAgree(set)) {
      MW_EXPECT(false);
      break;
    }
    if (set.liveCount() < 0 || set.liveCount() > kCapacity) {
      MW_EXPECT(false);
      break;
    }
    if (outstanding.size() > 48) outstanding.clear();
  }

  MW_EXPECT(isPermutation(set.permutation()));
  MW_EXPECT(spansAgree(set));
  MW_EXPECT(set.liveCount() >= 0 && set.liveCount() <= kCapacity);
}

MW_TEST("VS-02 the live span and the free span are disjoint and complete") {
  // The claim VS-02 makes in words: every id appears exactly once across free ∪
  // allocated. Stated as two spans of one array, which is what makes it true by
  // construction rather than by maintenance.
  VoiceSet set = prepared(8);
  for (NoteId n = 1; n <= 5; ++n) set.allocate(n);
  set.retire(set.permutation()[1]);
  set.allocate(99);

  const auto& slots = set.permutation();
  MW_EXPECT_EQ(static_cast<int>(slots.size()), 8);
  MW_EXPECT(isPermutation(slots));
  for (int i = 0; i < set.liveCount(); ++i) {
    MW_EXPECT(set.noteOf(slots[static_cast<std::size_t>(i)]) != kNoNote);
  }
  for (int i = set.liveCount(); i < 8; ++i) {
    MW_EXPECT_EQ(static_cast<int>(set.noteOf(slots[static_cast<std::size_t>(i)])),
                 static_cast<int>(kNoNote));
  }
}

// ────────────────────────────────────────────── the companion defect, VS-05

MW_TEST("VS-05 a stolen note's late note-off is a no-op") {
  // When voice v is taken from note A and given to note B, A's later note-off
  // must find nothing. Without the invalidation inside `stealOne`, releasing an
  // *earlier* key stops a note the player is still holding — which is the kind
  // of fault that gets blamed on the controller.
  VoiceSet set = prepared(1);
  const NoteId a = 1;
  const NoteId b = 2;
  const VoiceId v = set.allocate(a);
  MW_EXPECT_EQ(static_cast<int>(set.allocate(b)), static_cast<int>(v));

  MW_EXPECT(!set.releaseNote(a));
  MW_EXPECT_EQ(set.sustainingCount(), 1);
  MW_EXPECT_EQ(static_cast<int>(set.noteOf(v)), static_cast<int>(b));

  MW_EXPECT(set.releaseNote(b));
  MW_EXPECT_EQ(set.sustainingCount(), 0);
}

MW_TEST("sustaining and live are different numbers") {
  // §2.3's stuck-note measure. A released voice is still live — its tail is
  // sounding and its slot is not free — and it is no longer sustaining.
  // Reporting one for the other is how a stuck-note count reads zero while
  // twelve notes are held.
  VoiceSet set = prepared(4);
  for (NoteId n = 1; n <= 3; ++n) set.allocate(n);
  MW_EXPECT_EQ(set.liveCount(), 3);
  MW_EXPECT_EQ(set.sustainingCount(), 3);

  set.releaseNote(2);
  MW_EXPECT_EQ(set.liveCount(), 3);
  MW_EXPECT_EQ(set.sustainingCount(), 2);
}

MW_TEST("panic lowers every gate and frees nothing") {
  VoiceSet set = prepared(8);
  for (NoteId n = 1; n <= 6; ++n) set.allocate(n);
  set.panic();
  MW_EXPECT_EQ(set.sustainingCount(), 0);
  // The slots stay taken: the tails still have to be rendered out, and a panic
  // that freed them would hand a sounding voice to the next note-on.
  MW_EXPECT_EQ(set.liveCount(), 6);
  MW_EXPECT(isPermutation(set.permutation()));
}

MW_TEST("VS-30 a capacity cut never silences a held note") {
  VoiceSet set = prepared(16);
  for (NoteId n = 1; n <= 16; ++n) set.allocate(n);
  const std::uint64_t stealsBefore = set.stealCount();

  set.setCapacity(8);
  MW_EXPECT_EQ(set.liveCount(), 16);
  MW_EXPECT_EQ(set.sustainingCount(), 16);
  MW_EXPECT_EQ(static_cast<int>(set.stealCount()), static_cast<int>(stealsBefore));

  // And it takes effect on the next allocation rather than by cutting: the
  // seventeenth note steals instead of exceeding the new cap.
  set.allocate(17);
  MW_EXPECT(set.stealCount() > stealsBefore);
  MW_EXPECT_EQ(set.liveCount(), 16);
}

// ───────────────────────────────────────────────── real-time safety, §6

MW_TEST("nothing on the audio path allocates") {
  VoiceSet set = prepared(24);
  mw::test::RtGuard guard;
  NoteId note = 1;
  for (int i = 0; i < 200; ++i) {
    set.allocate(note++);
    if ((i & 3) == 0) set.releaseNote(note - 1);
    if ((i & 7) == 0) set.retire(set.permutation()[0]);
    if ((i & 15) == 0) set.beginBlock();
  }
  set.panic();
  MW_EXPECT_EQ(static_cast<int>(guard.allocations()), 0);
}

MW_TEST("the RtGuard is watching rather than asleep") {
  // The non-vacuity half, and the same shape the registry's tests use: a guard
  // that reports zero because it is not armed reports zero for a leak too.
  VoiceSet set;
  mw::test::RtGuard guard;
  VoiceSetConfig config;
  config.capacity = 64;
  set.prepare(config);  // `prepare` is the one method that is allowed to
  MW_EXPECT(guard.allocations() > 0);
}

MW_TEST_MAIN("voice set")
