// Motion Wave — a press, and the identity it mints.
//
// `lib-voice-substrate.md` §4. Two integers and two sentinels, in a header of
// their own because everything else in the substrate depends on them and
// nothing about them depends on anything.
//
// The identities are deliberately not the same width. A `VoiceId` indexes a
// fixed set that is never larger than a few dozen, and 16 bits is generous. A
// `NoteId` is *minted*, monotonically, and never reused within a session —
// that is invariant I-B, and it is what makes a stale reference safe: a note-
// off that arrives after its note was stolen cannot alias whatever is playing
// now, because the number it names was never handed out twice.
//
// 32 bits at ten presses a second is eight days of continuous playing before a
// wrap, which is longer than a session; the substrate's `press()` saturates
// rather than wrapping, so the last id is repeated instead of the first being
// reissued. A repeated id is a note that cannot be released — audible, and
// findable. A reissued one is a note-off landing on somebody else's note.
#pragma once

#include <cstdint>

namespace mw::dsp::voice {

/// Index into a `VoiceSet`. Small, fixed, and reused by design.
using VoiceId = std::uint16_t;

/// A press's identity. Minted, monotonic, never reused within a session.
using NoteId = std::uint32_t;

/// "No voice" — returned by an allocation that could not be served, and stored
/// wherever a voice reference is absent. 0xFFFF rather than 0 because 0 is a
/// perfectly good voice index and a sentinel that collides with a real value is
/// a sentinel that will one day be mistaken for one.
inline constexpr VoiceId kNoVoice = 0xFFFFu;

/// "No note". Zero is never minted, so a zero-initialised field means absent
/// without anybody having to remember to write the sentinel into it.
inline constexpr NoteId kNoNote = 0u;

/// The largest id `press()` will mint. Beyond it the counter saturates.
inline constexpr NoteId kMaxNote = 0xFFFFFFFFu;

}  // namespace mw::dsp::voice
