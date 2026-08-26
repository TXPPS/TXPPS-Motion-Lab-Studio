// Motion Wave — which voices are sounding, and which one gives way.
//
// `lib-voice-substrate.md` §4 and §5.1. This is PA-003 made unrepeatable.
//
// PA-003 was the same defect twice, in two unrelated instruments: sixty
// simultaneous note-ons against a capacity of twenty-four produced *sixty*
// sounding oscillators and one steal, and the sampler answered eighty live
// against a cap of forty-eight. Both had a steal loop that chose its victims by
// running over the allocated set — and did not remove each victim as it took
// it, so every pass chose the same voice and the loop ran out of iterations
// rather than out of work.
//
// The fix is structural rather than careful. **A voice's membership is its
// position in a permutation, not a flag**:
//
//     slots[0 .. live)          allocated, oldest first
//     slots[live .. capacity)   free
//
// Two flags can disagree with each other and with a count, and a loop that
// forgets to clear one leaves a voice that is allocated and free at once. A
// position cannot be in two places. Every operation here is a swap and an
// increment, so the invariant is not something to maintain; it is the only
// state there is. VS-02 walks the permutation after a hundred thousand random
// operations and requires every id to appear exactly once, which is a check on
// the representation rather than on the diligence of whoever wrote the loop.
//
// The second half is invariant I-C: **a victim leaves the allocated set, and
// nobody receives it**. `stealOne` returns nothing at all, and `allocate` takes
// its voice from the free span like every other path — so there is no value in
// this class for a caller to hold on to and no way to write the loop that
// produced the defect. There is deliberately no public `stealOne`, no
// `selectVictims`, and no `victims(int n, VoiceId* out)`: an interface that
// handed out a list would let a caller reconstruct PA-003 in three lines.
//
// Real-time safe by construction: `prepare()` allocates once and every other
// method is arithmetic over fixed storage, so all of this is legal on the audio
// thread. `voice_set_tests.cpp` arms `RtGuard` around it and says so.
#pragma once

#include <cstdint>
#include <vector>

#include "note_id.h"

namespace mw::dsp::voice {

/// How a free voice is chosen when there is one to spare.
enum class Allocation : std::uint8_t {
  /// Round the set, so a repeated key does not reuse the same voice and inherit
  /// its still-decaying tail. The default because it is what the polysynths do.
  RoundRobin,
  /// Lowest free index first. Deterministic in a way a golden render likes, and
  /// what a drum machine wants: pad 3 is always voice 3.
  LowestFree,
};

/// Which allocated voice gives way when there is not.
enum class StealOrder : std::uint8_t {
  /// A voice already in release, quietest first; then the oldest not started in
  /// this block; then the oldest of all. §5.1 spells the full order out.
  ReleasingQuietestFirst,
  /// The same, with one rule inserted ahead of age: a voice holding the same
  /// key as the incoming note. A hi-hat retrigger cutting its own tail rather
  /// than somebody else's.
  SameKeyFirst,
};

struct VoiceSetConfig {
  int capacity = 16;
  Allocation allocation = Allocation::RoundRobin;
  StealOrder stealOrder = StealOrder::ReleasingQuietestFirst;
  /// Voices stacked per note. Held here because the cap is counted in *voices*,
  /// which is what a musician hears run out.
  int unison = 1;
  /// Declick applied to a stolen voice, milliseconds. Zero is the hardware
  /// behaviour for the vintage units and is the default; the sampler sets 1.5,
  /// because a sample cut mid-waveform is a pop nobody asked for. Both are our
  /// judgement — no sheet gives a steal artefact — and `LEGAL_NOTES.md` says so.
  float stealFadeMs = 0.0f;
};

/**
 * The allocated set, the free set, and the one operation that moves between.
 *
 * `liveCount()` and `sustainingCount()` are different numbers on purpose. A
 * voice whose gate has fallen is still *live* — its tail is sounding and its
 * slot is not available — and it is no longer *sustaining*. Reporting one for
 * the other is how a stuck-note measure comes to read zero while twelve notes
 * are held: the sampler answered 0 for twelve held notes because a non-looping
 * sample schedules its own end at spawn, so §2.3 asks for the count of voices
 * with the gate up rather than the count of voices making noise.
 */
class VoiceSet {
 public:
  /// Size the set. Allocates once, and only here.
  void prepare(const VoiceSetConfig& config) noexcept {
    config_ = config;
    const int cap = config.capacity > 0 ? config.capacity : 1;
    config_.capacity = cap;
    const auto n = static_cast<std::size_t>(cap);
    slots_.resize(n);
    owner_.assign(n, kNoNote);
    gate_.assign(n, 0);
    level_.assign(n, 0.0f);
    bornInBlock_.assign(n, 0);
    age_.assign(n, 0);
    // The note→voice map is a flat table rather than a hash: a NoteId is
    // minted monotonically, so the only thing a lookup needs is the voice's own
    // record of which note it holds, walked over `capacity` entries. At a few
    // dozen voices that is faster than a hash and it allocates nothing.
    reset();
  }

  /// Every voice free, every counter zero. The steal total is *not* rewound —
  /// it is a session measure, and VS-01 reads it after a reset would have been
  /// tempting.
  void reset() noexcept {
    for (std::size_t i = 0; i < slots_.size(); ++i) {
      slots_[i] = static_cast<VoiceId>(i);
      owner_[i] = kNoNote;
      gate_[i] = 0;
      level_[i] = 0.0f;
      bornInBlock_[i] = 0;
      age_[i] = 0;
    }
    live_ = 0;
    sustaining_ = 0;
    cursor_ = 0;
    clock_ = 0;
  }

  /**
   * The only way a voice is obtained. Steals internally when the set is full.
   *
   * Every path through here ends with exactly one voice inside `[0, live)` for
   * this note, which is why sixty note-ons against a capacity of twenty-four
   * cannot leave sixty voices sounding however the victims were chosen.
   */
  VoiceId allocate(NoteId note) noexcept {
    if (slots_.empty()) return kNoVoice;
    // A steal *frees* a slot; it does not hand one over. Both halves go through
    // `takeFree()` for that reason — a steal path that assigned the victim
    // directly would leave the allocated span one shorter than the number of
    // voices sounding, which is PA-003 with the sign flipped and just as
    // invisible from outside.
    if (live_ >= effectiveCapacity()) stealOne(note);
    const VoiceId v = takeFree();
    owner_[v] = note;
    gate_[v] = 1;
    level_[v] = 1.0f;
    bornInBlock_[v] = 1;
    age_[v] = ++clock_;
    ++sustaining_;
    return v;
  }

  /**
   * Gate falls. The voice stays allocated until its tail retires.
   *
   * Returns false when the note is not ours. That is a stolen note's late
   * note-off, and it must be a no-op rather than a release of whoever holds the
   * voice now — without it, lifting an *earlier* key stops a note the player is
   * still holding.
   */
  bool releaseNote(NoteId note) noexcept {
    const VoiceId v = voiceOf(note);
    if (v == kNoVoice) return false;
    if (gate_[v]) {
      gate_[v] = 0;
      --sustaining_;
    }
    return true;
  }

  /// Called by the voice itself when its envelope reaches its floor.
  void retire(VoiceId voice) noexcept {
    const int i = indexOf(voice);
    if (i < 0) return;
    if (gate_[voice]) {
      gate_[voice] = 0;
      --sustaining_;
    }
    owner_[voice] = kNoNote;
    level_[voice] = 0.0f;
    freeAt(i);
  }

  /// Every gate down at once. Real-time safe: it is called from the audio
  /// thread when a panic message arrives, and it lowers gates rather than
  /// freeing slots — the tails still have to be rendered out.
  void panic() noexcept {
    for (int i = 0; i < live_; ++i) gate_[slots_[static_cast<std::size_t>(i)]] = 0;
    sustaining_ = 0;
  }

  /// Marks the start of a render block. Rule 3 of victim selection — "the
  /// oldest voice *not started in this block*" — is what stops a chord larger
  /// than the cap eating its own notes as it arrives, and it needs somewhere to
  /// be told that a new block has begun.
  void beginBlock() noexcept {
    for (auto& born : bornInBlock_) born = 0;
  }

  /// The envelope's current level, so victim selection can prefer the quietest
  /// releasing voice. Written by the voice, read only here.
  void setLevel(VoiceId voice, float level) noexcept {
    if (indexOf(voice) >= 0) level_[voice] = level;
  }

  int liveCount() const noexcept { return live_; }
  int sustainingCount() const noexcept { return sustaining_; }
  std::uint64_t stealCount() const noexcept { return steals_; }
  int capacity() const noexcept { return effectiveCapacity(); }

  /// Takes effect on the next allocation and never cuts a sounding voice.
  /// ADR-0006's rule for grains applies here in its own form: a tier that
  /// silenced a held note would turn a performance decision into an audible one.
  void setCapacity(int capacity) noexcept {
    config_.capacity = capacity > 0 ? capacity : 1;
    if (config_.capacity > static_cast<int>(slots_.size())) {
      config_.capacity = static_cast<int>(slots_.size());
    }
  }

  NoteId noteOf(VoiceId voice) const noexcept {
    return indexOf(voice) >= 0 ? owner_[voice] : kNoNote;
  }

  /// What a voice *records* as its owner, whether or not it is allocated.
  ///
  /// Different from `noteOf`, and the difference is the point: `noteOf` asks
  /// about the allocated span, so it answers `kNoNote` for a voice that is
  /// wrongly outside it — which is exactly the state VS-02 is looking for.
  NoteId ownerOf(VoiceId voice) const noexcept {
    return voice < owner_.size() ? owner_[voice] : kNoNote;
  }

  VoiceId voiceOf(NoteId note) const noexcept {
    if (note == kNoNote) return kNoVoice;
    for (int i = 0; i < live_; ++i) {
      const VoiceId v = slots_[static_cast<std::size_t>(i)];
      if (owner_[v] == note) return v;
    }
    return kNoVoice;
  }

  /// The permutation itself, for VS-02 to walk. Not part of the playing
  /// interface — a caller that reads it cannot change it, and the test that
  /// proves the partition holds has to be able to see both halves of it.
  const std::vector<VoiceId>& permutation() const noexcept { return slots_; }

 private:
  /// The cap in force, never larger than the storage `prepare()` sized.
  int effectiveCapacity() const noexcept {
    const int stored = static_cast<int>(slots_.size());
    return config_.capacity < stored ? config_.capacity : stored;
  }

  /// Where a voice sits in the permutation, or -1 if it is free.
  int indexOf(VoiceId voice) const noexcept {
    for (int i = 0; i < live_; ++i) {
      if (slots_[static_cast<std::size_t>(i)] == voice) return i;
    }
    return -1;
  }

  /// Move `slots[live]` into the allocated span. Round-robin rotates the free
  /// span first so a repeated key does not land on the voice it just left.
  VoiceId takeFree() noexcept {
    const auto liveIdx = static_cast<std::size_t>(live_);
    if (config_.allocation == Allocation::RoundRobin) {
      const int freeCount = effectiveCapacity() - live_;
      if (freeCount > 1) {
        const auto pick = liveIdx + static_cast<std::size_t>(cursor_ % freeCount);
        const VoiceId chosen = slots_[pick];
        slots_[pick] = slots_[liveIdx];
        slots_[liveIdx] = chosen;
        ++cursor_;
      }
    }
    return slots_[static_cast<std::size_t>(live_++)];
  }

  /// Swap the voice at `i` out of the allocated span. One swap, one decrement:
  /// the free span grows by exactly the entry the allocated span lost, so no id
  /// can be duplicated or dropped however often this runs.
  void freeAt(int i) noexcept {
    const auto a = static_cast<std::size_t>(i);
    const auto b = static_cast<std::size_t>(live_ - 1);
    const VoiceId v = slots_[a];
    slots_[a] = slots_[b];
    slots_[b] = v;
    --live_;
  }

  /**
   * Choose a victim and remove it. Nothing is handed back.
   *
   * The order is the whole fix. A `selectVictim` that ran over a set it had not
   * updated is PA-003; a `stealOne` that returned its victim before the swap is
   * PA-003 with an extra step. Returning nothing at all is the strongest form:
   * there is no value here for a caller to hold, so there is no way to write
   * the loop that produced the defect. `owner_[v] = kNoNote` is the companion
   * half — when voice v is taken from note A and given to note B, A's later
   * note-off has to find nothing rather than release B.
   */
  void stealOne(NoteId incoming) noexcept {
    const int i = selectVictim(incoming);
    const VoiceId v = slots_[static_cast<std::size_t>(i)];
    owner_[v] = kNoNote;
    if (gate_[v]) {
      gate_[v] = 0;
      --sustaining_;
    }
    freeAt(i);
    ++steals_;
  }

  /**
   * §5.1's order, with every tie broken by lowest voice index.
   *
   * Determinism is not tidiness here: a golden render compares samples, and a
   * victim chosen by iteration order would make the same input render two ways
   * on two runs.
   */
  int selectVictim(NoteId incoming) const noexcept {
    int best = 0;
    // 1. A voice already in release, quietest first.
    float quietest = 0.0f;
    int released = -1;
    for (int i = 0; i < live_; ++i) {
      const VoiceId v = slots_[static_cast<std::size_t>(i)];
      if (gate_[v]) continue;
      if (released < 0 || level_[v] < quietest) {
        released = i;
        quietest = level_[v];
      }
    }
    if (released >= 0) return released;

    // 2. The same key, when the caller asked for it. `incoming` is an identity
    //    rather than a key, so "same key" is the note this set already holds
    //    with that identity — which is a retrigger of a note still sounding.
    if (config_.stealOrder == StealOrder::SameKeyFirst) {
      for (int i = 0; i < live_; ++i) {
        if (owner_[slots_[static_cast<std::size_t>(i)]] == incoming) return i;
      }
    }

    // 3. The oldest voice not started in this block, so a chord larger than the
    //    cap does not eat its own notes as it arrives.
    int oldest = -1;
    std::uint64_t oldestAge = 0;
    for (int i = 0; i < live_; ++i) {
      const VoiceId v = slots_[static_cast<std::size_t>(i)];
      if (bornInBlock_[v]) continue;
      if (oldest < 0 || age_[v] < oldestAge) {
        oldest = i;
        oldestAge = age_[v];
      }
    }
    if (oldest >= 0) return oldest;

    // 4. The oldest of all, so rule 3 cannot deadlock when one block carries
    //    more note-ons than the cap — which is the sixty-notes case exactly.
    oldestAge = 0;
    for (int i = 0; i < live_; ++i) {
      const VoiceId v = slots_[static_cast<std::size_t>(i)];
      if (i == 0 || age_[v] < oldestAge) {
        best = i;
        oldestAge = age_[v];
      }
    }
    return best;
  }

  VoiceSetConfig config_{};
  std::vector<VoiceId> slots_;
  std::vector<NoteId> owner_;
  std::vector<std::uint8_t> gate_;
  std::vector<float> level_;
  std::vector<std::uint8_t> bornInBlock_;
  std::vector<std::uint64_t> age_;
  int live_ = 0;
  int sustaining_ = 0;
  int cursor_ = 0;
  std::uint64_t clock_ = 0;
  std::uint64_t steals_ = 0;
};

}  // namespace mw::dsp::voice
