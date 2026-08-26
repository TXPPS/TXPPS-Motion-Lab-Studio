// Motion Wave — two pulses and a level, which everything else subscribes to.
//
// `lib-voice-substrate.md` §4. Every envelope, every ramp and every LFO in the
// substrate is driven from this and from nothing else, which is why it comes
// before all of them: five instruments' worth of retrigger behaviour is one
// three-line rule read from one struct, instead of each generator being told
// separately what a note-on means to it.
//
// The rule, from the matrix synth's own structure:
//
//   single  a note-on to a voice that is **not** already gated
//   multi   any note-on, gated or not — plus a note-off to a voice that is not
//           gated
//   gate    high from note-on until note-off. A level, not a pulse.
//
// `single` is the "start of a phrase" trigger and `multi` is the "every key"
// one, and a generator picks whichever it wants. A legato line therefore
// retriggers a multi-triggered envelope on every key and leaves a
// single-triggered one running, which is the behaviour the difference exists to
// produce.
//
// **The pulses are broadcast, not consumed.** Nothing clears a pulse by reading
// it. If the first subscriber to look cleared it, whichever generator happened
// to be advanced first would silently own the trigger and the others would
// never see it — an ordering dependency between two envelopes that have nothing
// to do with each other, and the kind of defect that shows up as "the filter
// envelope retriggers and the amp envelope does not, sometimes". So the bank
// clears every pulse at `endStep()`, once, after everybody has advanced.
//
// Real-time safe by construction: `prepare()` sizes the array and every other
// method is a store into it.
#pragma once

#include <cstdint>
#include <vector>

#include "note_id.h"

namespace mw::dsp::voice {

/// What one voice's generators see this control step.
///
/// Deliberately four bools rather than a bitfield. It is read far more often
/// than it is written — every generator on every voice on every control step —
/// and a packed representation would buy four bytes per voice and cost a mask
/// at each of those reads.
struct TriggerBus {
  /// A note-on to a voice that was not gated. One control step.
  bool single = false;
  /// Any note-on, plus a note-off to a voice that was not gated. One step.
  bool multi = false;
  /// High from note-on to note-off. Survives the step.
  bool gate = false;
  /// Driven by something that is not the keyboard — an LFO, a sequencer, the
  /// host. A level the instrument owns; the bank never sets or clears it, which
  /// is why `endStep` leaves it alone.
  bool externalTrigger = false;
};

/// One `TriggerBus` per voice, and the rules that fill them.
///
/// The rules live here rather than in each instrument for the reason the whole
/// substrate exists: five instruments applying them separately is five chances
/// to get the gated/not-gated distinction backwards, and getting it backwards
/// is inaudible until somebody plays legato.
class TriggerBank {
 public:
  /// The one allocation. `capacity` is the voice set's, so the two are indexed
  /// by the same `VoiceId`.
  void prepare(int capacity) {
    buses_.assign(capacity <= 0 ? 0 : static_cast<std::size_t>(capacity), TriggerBus{});
  }

  /// Everything low, including gates. What a transport jump and a panic want:
  /// a gate left high across a reset is a voice that never releases.
  void reset() noexcept {
    for (auto& bus : buses_) bus = TriggerBus{};
  }

  /// A note-on. `single` only if the voice was not already sounding.
  void noteOn(VoiceId voice) noexcept {
    if (!valid(voice)) return;
    TriggerBus& bus = buses_[voice];
    // Read before the gate is raised, not after. Raising it first would make
    // every note-on look like a retrigger of a gated voice, so `single` would
    // never fire once and the distinction this file exists for would be gone —
    // silently, because every generator would still be triggered by `multi`.
    if (!bus.gate) bus.single = true;
    bus.multi = true;
    bus.gate = true;
  }

  /// A note-off. A `multi` pulse only when the voice was *not* gated.
  ///
  /// That reads backwards and is right: a note-off to a voice already released
  /// is the second half of a legato pair — the key that was still held under
  /// the new one — and the matrix synth retriggers its multi-triggered
  /// generators there. A note-off to a gated voice is an ordinary release and
  /// triggers nothing; it lowers the gate, and the release segment is the
  /// generators' response to that.
  void noteOff(VoiceId voice) noexcept {
    if (!valid(voice)) return;
    TriggerBus& bus = buses_[voice];
    if (!bus.gate) bus.multi = true;
    bus.gate = false;
  }

  /// The level nothing in here owns. Set by whatever drives it.
  void setExternal(VoiceId voice, bool high) noexcept {
    if (valid(voice)) buses_[voice].externalTrigger = high;
  }

  /// Every pulse low again — called once, after every generator has advanced.
  void endStep() noexcept {
    for (auto& bus : buses_) {
      bus.single = false;
      bus.multi = false;
    }
  }

  const TriggerBus& operator[](VoiceId voice) const noexcept { return buses_[voice]; }
  int capacity() const noexcept { return static_cast<int>(buses_.size()); }

 private:
  bool valid(VoiceId voice) const noexcept {
    return voice != kNoVoice && static_cast<std::size_t>(voice) < buses_.size();
  }

  std::vector<TriggerBus> buses_;
};

}  // namespace mw::dsp::voice
