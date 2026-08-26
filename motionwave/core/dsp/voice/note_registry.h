// Motion Wave — the one place a press becomes an identity.
//
// `lib-voice-substrate.md` §4, invariant I-B. Written on press, read on
// release, never recomputed.
//
// The defect this closes is BUG-005, and it is worth stating plainly because
// the shape recurs: an instrument that computes a note's identity from the key
// at *release* time gets a different answer whenever anything has changed the
// mapping in between — a transpose, an octave shift, a scale lock, a change of
// MPE zone. The note-off then names a note nobody is playing, the real one is
// never released, and the symptom is a stuck note minutes later with nothing to
// point at. `release()` returns the id `press()` minted for that key, or
// `kNoNote`. That return value is not an error code to swallow: it is the fact
// that makes a doubled note-off, a note-off for a key nobody pressed, and a
// cancelled pointer gesture all harmless in exactly the same way.
//
// Real-time safe by construction. `prepare()` allocates the table once; every
// other method is arithmetic over fixed storage, so this whole class is legal
// on the audio thread (§6, and `voice_registry_tests.cpp` arms `RtGuard`
// around it).
#pragma once

#include <cstdint>
#include <vector>

#include "note_id.h"

namespace mw::dsp::voice {

/// MIDI's own limits, and therefore the table's.
inline constexpr int kKeys = 128;
inline constexpr int kChannels = 16;
inline constexpr int kSlots = kKeys * kChannels;

/**
 * Every key currently down, and the identity each press minted.
 *
 * One held-key set in the product. A portamento asking "was another key
 * already down?" and an arpeggiator asking "what is held?" must not be able to
 * get different answers, and two sets is how they would.
 */
class NoteRegistry {
 public:
  /**
   * Size the table. Allocates once, and only here.
   *
   * `maxHeld` bounds the *held* list rather than the slot table: the table is
   * always 128 keys by 16 channels because MIDI says so, and the held list is
   * what a caller iterates. A physical keyboard cannot hold more than ten, an
   * MPE controller more than about fifteen, and a sequencer as many as it likes
   * — so it is a parameter rather than a constant.
   */
  void prepare(int maxHeld) noexcept {
    slots_.assign(static_cast<std::size_t>(kSlots), kNoNote);
    held_.reserve(static_cast<std::size_t>(maxHeld > 0 ? maxHeld : 1));
    held_.clear();
    next_ = 1;  // 0 is kNoNote and is never minted.
  }

  /// Forget every press. The id counter is *not* rewound: see `press()`.
  void reset() noexcept {
    for (auto& slot : slots_) slot = kNoNote;
    held_.clear();
  }

  /**
   * Mint an identity for this press.
   *
   * A second press of a key already down returns the id already held rather
   * than minting a second one. A MIDI stream with a missing note-off, an
   * auto-repeating computer keyboard and a pointer that re-enters a key it
   * never left all produce that, and the alternative — two ids for one physical
   * key — leaves the first unreleasable.
   *
   * The counter saturates at `kMaxNote` instead of wrapping. Wrapping would
   * reissue id 1 while the original might still be sounding, which is the one
   * failure this class exists to prevent; saturating repeats the last id
   * instead, which is a stuck note — worse to play and far easier to find.
   */
  NoteId press(std::uint8_t channel, std::uint8_t key) noexcept {
    const int index = slotOf(channel, key);
    if (index < 0) return kNoNote;
    if (slots_[static_cast<std::size_t>(index)] != kNoNote) {
      return slots_[static_cast<std::size_t>(index)];
    }
    const NoteId id = next_;
    if (next_ < kMaxNote) ++next_;
    slots_[static_cast<std::size_t>(index)] = id;
    held_.push_back(Held{id, channel, key});
    return id;
  }

  /**
   * The identity this key's press minted, removed from the map.
   *
   * `kNoNote` when there was no such press. Every caller has to handle it, and
   * that is the point: a note-off with no press is not an error, it is Tuesday.
   */
  NoteId release(std::uint8_t channel, std::uint8_t key) noexcept {
    const int index = slotOf(channel, key);
    if (index < 0) return kNoNote;
    const NoteId id = slots_[static_cast<std::size_t>(index)];
    if (id == kNoNote) return kNoNote;
    slots_[static_cast<std::size_t>(index)] = kNoNote;
    forget(id);
    return id;
  }

  /// Is this key down? Cheaper than searching the held list, and used by the
  /// legato test on every press.
  bool isHeld(std::uint8_t channel, std::uint8_t key) const noexcept {
    const int index = slotOf(channel, key);
    return index >= 0 && slots_[static_cast<std::size_t>(index)] != kNoNote;
  }

  int heldCount() const noexcept { return static_cast<int>(held_.size()); }

  NoteId heldAt(int index) const noexcept {
    return inRange(index) ? held_[static_cast<std::size_t>(index)].id : kNoNote;
  }

  std::uint8_t heldKeyAt(int index) const noexcept {
    return inRange(index) ? held_[static_cast<std::size_t>(index)].key : 0u;
  }

  std::uint8_t heldChannelAt(int index) const noexcept {
    return inRange(index) ? held_[static_cast<std::size_t>(index)].channel : 0u;
  }

  /**
   * End every held note, and say how many there were.
   *
   * Called on panic, on a transport stop, and when a zone leaves MPE control.
   * The count is returned rather than logged because the caller is the one that
   * has to release that many voices, and a panic that clears the registry
   * without telling anyone leaves the voices sounding with nothing holding
   * their keys — which is the stuck note again, from the other end.
   */
  int releaseAll() noexcept {
    const int n = heldCount();
    for (const Held& h : held_) {
      const int index = slotOf(h.channel, h.key);
      if (index >= 0) slots_[static_cast<std::size_t>(index)] = kNoNote;
    }
    held_.clear();
    return n;
  }

  /// The next id `press()` would mint. For tests and for a session snapshot.
  NoteId nextId() const noexcept { return next_; }

 private:
  struct Held {
    NoteId id;
    std::uint8_t channel;
    std::uint8_t key;
  };

  static int slotOf(std::uint8_t channel, std::uint8_t key) noexcept {
    if (key >= kKeys || channel >= kChannels) return -1;
    return static_cast<int>(channel) * kKeys + static_cast<int>(key);
  }

  bool inRange(int index) const noexcept {
    return index >= 0 && index < static_cast<int>(held_.size());
  }

  /**
   * Drop one entry from the held list without reordering the rest.
   *
   * Order is load-bearing: `FixedOrder` allocation hands out the lowest free
   * voice "while earlier keys are held", and an arpeggiator in as-played mode
   * plays this list. A swap-with-last erase is faster and would silently
   * reorder both.
   */
  void forget(NoteId id) noexcept {
    std::size_t write = 0;
    for (std::size_t read = 0; read < held_.size(); ++read) {
      if (held_[read].id == id) continue;
      if (write != read) held_[write] = held_[read];
      ++write;
    }
    held_.resize(write);
  }

  std::vector<NoteId> slots_;
  std::vector<Held> held_;
  NoteId next_ = 1;
};

}  // namespace mw::dsp::voice
