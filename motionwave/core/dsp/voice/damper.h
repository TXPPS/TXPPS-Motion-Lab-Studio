// Motion Wave — the sustain pedal, deferring gates and nothing else.
//
// `lib-voice-substrate.md` §5.5: the damper does not create a second lifetime
// concept. A note released under the pedal has already ended — the registry
// forgot its key and the router unbound its channel before this is asked, so
// it is unreachable by key and by channel from that instant, whatever the
// pedal is doing. What is deferred is `VoiceSet::releaseNote`, by identity, so
// a stolen note's deferred release finds nothing when the pedal lifts: the
// same protection a late note-off has, and the reason there is one identity
// rather than a held flag. That split is what removes the sustain-pedal
// stuck-note class, and VS-06 reads all three counts to prove it.
//
// Not in the design's file table: §5.5 states the rule and VS-06 tests it, but
// no file was named to carry it. It sits beside `mpe.h`, whose channel-reuse
// rules it completes, rather than inside it, because a pedal is not a zone.
//
// Real-time safe: the deferred list is reserved once in `prepare` and never
// grows past it — a run of notes under the pedal longer than the buffer lets
// the oldest deferred gate fall early, which is a voice that oldest-first
// stealing has most likely already taken. `mpe_tests.cpp` arms `RtGuard`.
#pragma once

#include <vector>

#include "note_id.h"
#include "voice_set.h"

namespace mw::dsp::voice {

class Damper {
 public:
  /// `capacity` is the voice set's. Four deferred gates per voice is room for
  /// a pedalled run that steals every voice three times over.
  void prepare(int capacity) noexcept {
    pending_.clear();
    pending_.reserve(static_cast<std::size_t>((capacity > 0 ? capacity : 1) * 4));
    down_ = false;
  }
  void reset() noexcept {
    pending_.clear();
    down_ = false;
  }

  /// The gate falls now, or when the pedal lifts. Returns true if deferred.
  bool release(NoteId note, VoiceSet& voices) noexcept {
    if (!down_) {
      voices.releaseNote(note);
      return false;
    }
    if (pending_.size() == pending_.capacity()) {
      voices.releaseNote(pending_.front());
      pending_.erase(pending_.begin());
    }
    pending_.push_back(note);
    return true;
  }

  /// Lifting drops every deferred gate in the same call, so VS-06's "within
  /// one block" is within the message. Returns how many gates fell.
  int setDown(bool down, VoiceSet& voices) noexcept {
    down_ = down;
    if (down) return 0;
    int dropped = 0;
    for (const NoteId id : pending_) dropped += voices.releaseNote(id) ? 1 : 0;
    pending_.clear();
    return dropped;
  }

  bool isDown() const noexcept { return down_; }
  int pendingCount() const noexcept { return static_cast<int>(pending_.size()); }

 private:
  std::vector<NoteId> pending_;
  bool down_ = false;
};

}  // namespace mw::dsp::voice
