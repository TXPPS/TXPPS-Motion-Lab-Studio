// Motion Wave — zones, the channel state that outlives a note, and where a message lands.
//
// `lib-voice-substrate.md` §4 and §5.5, built to `std-01` Part A, which is
// documentation-sourced throughout and carries no quarantined value. Three
// things separate a receiver from a demo, and each is structural here:
//
//   Channel state lives whether or not a note sounds. Fourteen or fifteen
//   {bend, pressure, timbre} sets are alive at all times, because the values in
//   effect at the next note-on are the ones that note starts with. `bind` copies
//   them into the voice; nothing holds a pointer into a channel, because the
//   channel is reused the moment the note ends and a pointer would follow it.
//
//   A released voice is unreachable by channel, not merely ignoring it. Dispatch
//   walks the voices bound to a channel, and `unbind` removes the voice from
//   that walk — so a member bend arriving during a release tail has nowhere to
//   land. A receiver that *ignored* late bends would detune release tails the
//   moment somebody refactored the ignore; this one cannot, and VS-22 asks.
//
//   A configuration message recomputes **both** zones. Zones grow outward from
//   their masters, so a zone that will not fit truncates the other one, and a
//   receiver that recomputed only the addressed zone leaves the other claiming
//   channels it no longer owns. VS-23 was corrected in the design to count the
//   channels rather than trust the prose, because a receiver that quietly
//   ignored a message it could not fit was passing the row as first written.
//
// Two interpretations are ours and are said so. "Combine meaningfully" is the
// specification's whole instruction for a master-channel value meeting a
// member one: bend adds in semitones, pressure adds and clamps, and master
// timbre is an offset from its centre — a controller in the field that
// disagrees moves those three lines and nothing else. And a channel nobody has
// configured is a MIDI 1.0 channel, so its bend range defaults to ±2 rather
// than to the design's ±48: the configuration message is what makes a member
// channel ±48, and a receiver must assume nothing before it has seen one.
//
// The damper is `damper.h`, and it defers the *gate's* fall and nothing else:
// a note's identity ends and its channel unbinds here at note-off whatever the
// pedal is doing, which is what removes the sustain-pedal stuck-note class.
//
// Real-time safe: `prepare` sizes three per-voice tables once; the channels
// and zones are plain arrays. `mpe_tests.cpp` arms `RtGuard` around a
// configuration message mid-render, which is §6.2's constraining case.
#pragma once

#include <cstdint>
#include <vector>

#include "note_id.h"
#include "note_registry.h"
#include "voice_set.h"

namespace mw::dsp::voice {

enum class ZoneSide : std::uint8_t { Lower, Upper };

/// What the configuration message resets sensitivities to — the two most
/// commonly mis-implemented numbers in the specification.
inline constexpr float kMasterBendSemitones = 2.0f;
inline constexpr float kMemberBendSemitones = 48.0f;
/// MIDI 1.0's own default, for a channel no configuration message has touched.
inline constexpr float kDefaultBendSemitones = 2.0f;
inline constexpr std::uint8_t kUnboundChannel = 0xFFu;
/// A note-on with velocity zero is a note-off with *this* release velocity.
inline constexpr float kZeroVelocityRelease = 64.0f / 127.0f;

/// Per-channel controller state, alive whether or not a note sounds.
struct ChannelState {
  float bendNormalised = 0.0f;  ///< −1 … +1
  float pressure = 0.0f;
  float timbre = 0.5f;
  float bendSemitones = kDefaultBendSemitones;
  /// Per input device: a pad reports a finger's position, a wheel reports a
  /// movement from 64, and the data cannot say which. 64 never means "no
  /// change" unless this is false.
  bool timbreIsAbsolute = true;
};

struct Zone {
  bool active = false;
  ZoneSide side = ZoneSide::Lower;
  std::uint8_t masterChannel = 0;
  std::uint8_t memberCount = 0;
  float masterBendSemitones = kMasterBendSemitones;
};

/// What a note-on byte means once velocity zero has been read correctly.
struct NoteEvent {
  bool isOff = false;
  float velocity = 0.0f;
};

inline NoteEvent noteOnEvent(std::uint8_t velocity) noexcept {
  if (velocity == 0) return NoteEvent{true, kZeroVelocityRelease};
  return NoteEvent{false, static_cast<float>(velocity > 127 ? 127 : velocity) * (1.0f / 127.0f)};
}

class MpeRouter {
 public:
  /// `capacity` is the voice set's, so a `VoiceId` indexes both.
  void prepare(int capacity) noexcept {
    const auto n = static_cast<std::size_t>(capacity > 0 ? capacity : 1);
    channelOf_.assign(n, kUnboundChannel);
    zoneMaster_.assign(n, kUnboundChannel);
    expression_.assign(n, ChannelState{});
    reset();
  }

  /// No zones, every channel a plain channel, every voice unbound. The timbre
  /// convention survives: it belongs to the device, not to the session.
  void reset() noexcept {
    for (auto& c : channels_) resetState(c);
    zones_[0] = Zone{};
    zones_[1] = Zone{};
    zones_[1].side = ZoneSide::Upper;
    zones_[1].masterChannel = 15;
    requested_[0] = 0;
    requested_[1] = 0;
    for (std::size_t v = 0; v < channelOf_.size(); ++v) {
      channelOf_[v] = kUnboundChannel;
      zoneMaster_[v] = kUnboundChannel;
      resetState(expression_[v]);
    }
  }

  /// The configuration message. Returns the channels that entered or left MPE
  /// control as a bitmask, because the third mandatory side effect — every
  /// note on those channels stops — reaches the registry and the voice set,
  /// and `stopNotesOn` below applies it to them.
  std::uint16_t configure(ZoneSide side, std::uint8_t memberCount) noexcept {
    const std::uint16_t before = controlled();
    const int s = side == ZoneSide::Lower ? 0 : 1;
    const int o = 1 - s;
    requested_[s] = memberCount > 15 ? 15 : static_cast<int>(memberCount);
    // The addressed zone gets what it asked for; the other keeps what is
    // left. Both are recomputed from their last requests, so a zone that was
    // truncated grows back when the zone that squeezed it is deleted.
    const int n = requested_[s];
    const int otherCap = n > 0 ? 14 - n : 15;
    const int m = requested_[o] < otherCap ? requested_[o] : (otherCap < 0 ? 0 : otherCap);
    zones_[s].active = n > 0;
    zones_[s].memberCount = static_cast<std::uint8_t>(n);
    zones_[o].active = m > 0;
    zones_[o].memberCount = static_cast<std::uint8_t>(m);
    const std::uint16_t changed = static_cast<std::uint16_t>(before ^ controlled());
    for (std::uint8_t ch = 0; ch < kChannels; ++ch) {
      if (((changed >> ch) & 1u) != 0u) resetChannel(ch);
    }
    // §3.3's first two side effects, on the zone the message addressed.
    zones_[s].masterBendSemitones = kMasterBendSemitones;
    channels_[zones_[s].masterChannel].bendSemitones = kMasterBendSemitones;
    dispatch(zones_[s].masterChannel);
    forEachMember(zones_[s], [this](std::uint8_t ch) {
      channels_[ch].bendSemitones = kMemberBendSemitones;
      dispatch(ch);
    });
    return changed;
  }

  bool active() const noexcept { return zones_[0].active || zones_[1].active; }
  const Zone& zone(ZoneSide side) const noexcept { return zones_[side == ZoneSide::Lower ? 0 : 1]; }

  /// The zone a channel belongs to, master or member, or an inactive zone.
  const Zone& zoneFor(std::uint8_t channel) const noexcept {
    if (channel < kChannels) {
      if (zones_[0].active && channel <= zones_[0].memberCount) return zones_[0];
      if (zones_[1].active && channel >= 15 - zones_[1].memberCount) return zones_[1];
    }
    return none_;
  }
  bool isMaster(std::uint8_t channel) const noexcept {
    return (zones_[0].active && channel == 0) || (zones_[1].active && channel == 15);
  }
  bool isMember(std::uint8_t channel) const noexcept {
    const Zone& z = zoneFor(channel);
    return z.active && channel != z.masterChannel;
  }
  /// The member channels of a zone as a bitmask — what VS-23 counts.
  std::uint16_t memberMask(ZoneSide side) const noexcept {
    std::uint16_t mask = 0;
    forEachMember(zone(side), [&mask](std::uint8_t ch) {
      mask = static_cast<std::uint16_t>(mask | (1u << ch));
    });
    return mask;
  }

  void setBend(std::uint8_t channel, float normalised) noexcept {
    if (channel >= kChannels) return;
    channels_[channel].bendNormalised = clamp(normalised, -1.0f, 1.0f);
    dispatch(channel);
  }
  void setPressure(std::uint8_t channel, float value) noexcept {
    if (channel >= kChannels) return;
    channels_[channel].pressure = clamp(value, 0.0f, 1.0f);
    dispatch(channel);
  }
  void setTimbre(std::uint8_t channel, float value) noexcept {
    if (channel >= kChannels) return;
    channels_[channel].timbre = clamp(value, 0.0f, 1.0f);
    dispatch(channel);
  }

  /// RPN 0. On a master it is the zone's; on a member it is the **zone's**
  /// member sensitivity — the specification says the last one received applies
  /// to every member — and on a plain channel it is that channel's own.
  void setBendSensitivity(std::uint8_t channel, float semitones) noexcept {
    if (channel >= kChannels) return;
    const float s = clamp(semitones, 0.0f, 96.0f);
    if (isMaster(channel)) {
      zones_[channel == 0 ? 0 : 1].masterBendSemitones = s;
      channels_[channel].bendSemitones = s;
      dispatch(channel);
      return;
    }
    if (isMember(channel)) {
      forEachMember(zoneFor(channel), [this, s](std::uint8_t ch) {
        channels_[ch].bendSemitones = s;
        dispatch(ch);
      });
      return;
    }
    channels_[channel].bendSemitones = s;
    dispatch(channel);
  }

  void setTimbreAbsolute(bool absolute) noexcept {
    timbreAbsolute_ = absolute;
    for (auto& c : channels_) c.timbreIsAbsolute = absolute;
    for (auto& e : expression_) e.timbreIsAbsolute = absolute;
  }
  bool timbreIsAbsolute() const noexcept { return timbreAbsolute_; }

  /// The snapshot a note-on takes. A copy, never a reference.
  ChannelState snapshot(std::uint8_t channel) const noexcept {
    return channel < kChannels ? channels_[channel] : ChannelState{};
  }

  void bind(std::uint8_t channel, VoiceId voice) noexcept {
    if (!valid(voice) || channel >= kChannels) return;
    channelOf_[voice] = channel;
    expression_[voice] = channels_[channel];
    // A voice on a member channel adds its zone's master on top of its own
    // state; a voice on the master channel *is* on the master and adds nothing.
    zoneMaster_[voice] = isMember(channel) ? zoneFor(channel).masterChannel : kUnboundChannel;
  }

  /// After this the voice is unreachable by channel. Its expression stays as
  /// it was, so a release tail keeps the bend it had rather than snapping.
  void unbind(std::uint8_t channel, VoiceId voice) noexcept {
    if (valid(voice) && channelOf_[voice] == channel) channelOf_[voice] = kUnboundChannel;
  }

  std::uint8_t channelOf(VoiceId voice) const noexcept {
    return valid(voice) ? channelOf_[voice] : kUnboundChannel;
  }
  int boundVoices() const noexcept {
    int n = 0;
    for (const auto ch : channelOf_) n += ch != kUnboundChannel ? 1 : 0;
    return n;
  }
  /// Channels with at least one voice bound — the count VS-06 reads.
  int boundChannels() const noexcept {
    std::uint16_t mask = 0;
    for (const auto ch : channelOf_) {
      if (ch != kUnboundChannel) mask = static_cast<std::uint16_t>(mask | (1u << ch));
    }
    int n = 0;
    for (; mask != 0; mask = static_cast<std::uint16_t>(mask & (mask - 1u))) ++n;
    return n;
  }

  /// Member bend at member sensitivity, plus the zone's master bend at the
  /// master's. Addition is the universal reading of "combine meaningfully".
  float bendSemitones(VoiceId voice) const noexcept {
    if (!valid(voice)) return 0.0f;
    const ChannelState& e = expression_[voice];
    float total = e.bendNormalised * e.bendSemitones;
    const std::uint8_t m = zoneMaster_[voice];
    if (m != kUnboundChannel) {
      const Zone& z = zones_[m == 0 ? 0 : 1];
      if (z.active) total += channels_[m].bendNormalised * z.masterBendSemitones;
    }
    return total;
  }
  float pressure(VoiceId voice) const noexcept {
    if (!valid(voice)) return 0.0f;
    const std::uint8_t m = zoneMaster_[voice];
    const float master = m != kUnboundChannel ? channels_[m].pressure : 0.0f;
    return clamp(expression_[voice].pressure + master, 0.0f, 1.0f);
  }
  /// Master timbre is an offset from its centre, so an untouched master leaves
  /// a pad's absolute position exactly where the finger put it.
  float timbre(VoiceId voice) const noexcept {
    if (!valid(voice)) return 0.5f;
    const std::uint8_t m = zoneMaster_[voice];
    const float master = m != kUnboundChannel ? channels_[m].timbre - 0.5f : 0.0f;
    return clamp(expression_[voice].timbre + master, 0.0f, 1.0f);
  }

 private:
  static float clamp(float v, float lo, float hi) noexcept { return v < lo ? lo : (v > hi ? hi : v); }
  bool valid(VoiceId voice) const noexcept {
    return voice != kNoVoice && static_cast<std::size_t>(voice) < channelOf_.size();
  }
  void resetState(ChannelState& s) const noexcept {
    s = ChannelState{};
    s.timbreIsAbsolute = timbreAbsolute_;
  }

  template <typename Fn>
  void forEachMember(const Zone& z, Fn fn) const noexcept {
    if (!z.active) return;
    for (int i = 1; i <= static_cast<int>(z.memberCount); ++i) {
      const int ch = z.side == ZoneSide::Lower ? i : 15 - i;
      fn(static_cast<std::uint8_t>(ch));
    }
  }

  /// Masters and members of every active zone.
  std::uint16_t controlled() const noexcept {
    std::uint16_t mask = 0;
    for (const Zone& z : zones_) {
      if (!z.active) continue;
      mask = static_cast<std::uint16_t>(mask | (1u << z.masterChannel));
      forEachMember(z, [&mask](std::uint8_t ch) {
        mask = static_cast<std::uint16_t>(mask | (1u << ch));
      });
    }
    return mask;
  }

  /// A channel entering or leaving MPE control: controllers reset, and every
  /// voice on it cut loose so per-note control stops at once.
  void resetChannel(std::uint8_t ch) noexcept {
    resetState(channels_[ch]);
    for (std::size_t v = 0; v < channelOf_.size(); ++v) {
      if (channelOf_[v] != ch) continue;
      channelOf_[v] = kUnboundChannel;
      zoneMaster_[v] = kUnboundChannel;
    }
  }

  /// Dispatch by channel: only a voice bound to `ch` can be reached.
  void dispatch(std::uint8_t ch) noexcept {
    for (std::size_t v = 0; v < channelOf_.size(); ++v) {
      if (channelOf_[v] == ch) expression_[v] = channels_[ch];
    }
  }

  ChannelState channels_[kChannels]{};
  Zone zones_[2]{};
  Zone none_{};
  int requested_[2]{0, 0};
  bool timbreAbsolute_ = true;
  std::vector<std::uint8_t> channelOf_;
  std::vector<std::uint8_t> zoneMaster_;
  std::vector<ChannelState> expression_;
};

/// The configuration message's third side effect, applied to the rest of the
/// substrate: every held note on the masked channels ends — identity, key and
/// gate — and the count is returned. Walks the held list backwards, because a
/// release compacts the list below the entry it removes and never above it, so
/// nothing has to be copied aside on the audio thread.
inline int stopNotesOn(std::uint16_t channelMask, NoteRegistry& registry, VoiceSet& voices) noexcept {
  int stopped = 0;
  for (int i = registry.heldCount() - 1; i >= 0; --i) {
    const std::uint8_t ch = registry.heldChannelAt(i);
    if (ch >= kChannels || ((channelMask >> ch) & 1u) == 0u) continue;
    const NoteId id = registry.release(ch, registry.heldKeyAt(i));
    voices.releaseNote(id);
    ++stopped;
  }
  return stopped;
}

}  // namespace mw::dsp::voice
