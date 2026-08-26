# Reference spec — MPE and MIDI 2.0

Internal research note. Target implementation: `STD-01`, the per-note expression layer of
MotionLab Studio — MIDI input, clip storage, editing, playback, and the internal instrument API.

## 0. How to read this document

Confidence markers as in the other reference sheets:

- **[C]** confirmed against a primary source: the specification text itself, or a clause-by-clause
  analysis of it. See §0.1 for source classification.
- **[R]** reported by a reputable secondary source, not cross-checked against a primary one.
- **[I]** **implementation-derived** — the layout or constant's only source is somebody's
  _library implementing_ the standard, not the standard's own text. Libraries implement standards
  accurately most of the time, and wrongly some of the time. **Every [I] item must be checked
  against the specification document before it is written into `src/`.**
- **[U]** unconfirmed or inferred. **Do not build to a [U] value without checking it.**
- **[X]** explicitly unknown. Listed in §12.

Sourcing note: the egress proxy on this machine blocks `midi.org` and the CDN that hosts the MPE
and MIDI 2.0 specification PDFs. `github.com` is reachable. What follows is built from (a) a
detailed clause-by-clause comparison of the final MPE 1.0 specification against the widely
implemented 1.25a draft, published as an open document, which I read in full; (b) a MIT-licensed
MIDI 2.0 C++ library whose headers encode the UMP packet layouts and the complete MIDI-CI
sub-ID map, which I read directly; (c) search-engine extraction of the specification PDFs
themselves. §11 lists all of it. Where I am reasoning from an implementation rather than from
specification text, it is marked as such.

Unlike the two instrument sheets, this one is about a **standard we must conform to**, not a
product we are modelling. There is no intellectual-property constraint on naming it, and there is
no "era language" section.

### 0.1 Provenance and licence

| Class              | What it is                                                        | Sources used here                                                                                                                                          | May it be used directly?         |
| ------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **Documentation**  | The specification, or a published clause-by-clause analysis of it | _MIDI Polyphonic Expression v1.0_ (via extracts); the MPE final-vs-draft comparison notes; _M2-104-UM_ (via extracts); MDN and caniuse for Web MIDI status | Yes                              |
| **Measurement**    | n/a for a protocol                                                | —                                                                                                                                                          | —                                |
| **Implementation** | A library implementing the standard                               | **AM_MIDI2.0Lib** (`midi2-dev/AM_MIDI2.0Lib`), licence **MIT**                                                                                             | **Check against the spec first** |

**Licence position.** AM_MIDI2.0Lib is **MIT** — permissive, attribution-only. There is no
copyleft contamination risk here, and the risk profile is much lower than for the two instrument
sheets. **The epistemic caution still applies unchanged**: a packet layout read out of a library is
that library author's reading of the specification. For a _standard_, being wrong is worse than for
an emulator, because the failure mode is silent interoperability breakage with other people's
hardware rather than a slightly-off timbre.

Concretely: **everything in §9 that describes UMP bit layouts, MT 0x4 status codes, MIDI-CI sub-IDs,
Property Exchange status codes, and the min-centre-max scaling algorithm is [I]** and must be
checked against _M2-104-UM (UMP and MIDI 2.0 Protocol)_ and the _MIDI-CI_ specification before
implementation. Part A (MPE) is documentation-sourced and is **[C]**.

One item is documentation _and_ implementation: the min-centre-max scaling algorithm in §9.3 is
specified in the MIDI 2.0 protocol document; what I read was a library's implementation of it. The
_property_ it guarantees (min→min, centre→centre, max→max) is the specification's requirement and
is **[C]**; the exact code is **[I]**.

**What is safe to use from this sheet:** all of Part A, the "now versus later" analysis in §10, the
architectural rule in §10.4, and every verification test. **What needs checking first:** the tables
in §9.

---

## PART A — MPE

## 1. What MPE is, precisely

MPE is a **convention layered on MIDI 1.0**, not a new protocol. It uses ordinary MIDI 1.0
channel voice messages and adds a rule for how channels are grouped, so that each sounding note
gets its own channel and therefore its own pitch bend, pressure and timbre.

Two clarifications from the final specification that are frequently got wrong:

- MPE **extends MIDI Mode 3 ("Poly Mode")**. It is _not_ MIDI Mode 4 (Omni Off / Mono), despite
  the superficial resemblance. **[C]**
- Modes 1 and 2 must not be sent and must be ignored on receipt. **[C]**

Version: **MPE 1.0, published 12 March 2018**. It supersedes a widely implemented draft (1.25a,
December 2015) with which it is **incompatible in several places** — see §7. The RP number is
cited as RP-35 in the source I read; other references give RP-053. **[U]** on the number; the
date and content are **[C]**.

## 2. Zones, master channels and member channels

There are **exactly two possible zones**, and no others:

| Zone           | Master Channel | Member Channels  | Growth direction |
| -------------- | -------------- | ---------------- | ---------------- |
| **Lower Zone** | **1**          | from 2 upward    | ascending        |
| **Upper Zone** | **16**         | from 15 downward | descending       |

**[C]**

- Arbitrary splits — a zone spanning channels 2–8 with channel 1 as master, which the draft
  allowed — are **invalid in MPE 1.0 and must be ignored**. **[C]** This is the single most
  disruptive change from the draft, and older controllers in the field may still emit such
  configurations.
- In the draft the master channel was always to the _left_ of its zone. In 1.0 the lower zone's
  master is at the bottom and the upper zone's master is at the top, so the two zones grow toward
  each other. **[C]**
- **Channel 1 may be a member channel of the Upper Zone** if there is no Lower Zone. **[C]** A
  receiver that hard-codes "channel 1 is always a master channel" is non-conformant.
- Both zones may be active simultaneously, and they must not overlap.

Maximum polyphony: one zone alone gives **15 member channels**; two zones together give 14 member
channels total plus two masters. **[derived]**

### 2.1 Zone scope

Every message is either **zone-scoped** (sent on the master channel, applies to all notes in the
zone) or **note-scoped** (sent on a member channel, applies to the note currently assigned to that
channel).

| Message                                        | On Master Channel                                            | On Member Channel                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Note On / Note Off                             | valid — receivers **must** respond                           | valid — the normal case                                                                                   |
| Pitch Bend                                     | zone-wide bend                                               | per-note bend (dimension 1)                                                                               |
| Channel Pressure                               | zone-wide, "combine meaningfully" with all sounding notes    | per-note pressure (dimension 2)                                                                           |
| CC 74                                          | zone-wide, "combine meaningfully"                            | per-note timbre / slide (dimension 3)                                                                     |
| Polyphonic Key Pressure                        | master channel only; handling now **required**, not optional | not used                                                                                                  |
| Program Change                                 | valid **only in Mode 4**                                     | not valid                                                                                                 |
| All other CCs (volume, sustain, modulation, …) | zone-wide                                                    | "not recommended" to send; a receiver "cannot be expected to respond" — **silently ignore, do not error** |
| RPN 0 (pitch bend sensitivity)                 | sets master-channel sensitivity                              | sets member sensitivity, zone-wide (§5)                                                                   |
| RPN 6 (MCM)                                    | zone configuration                                           | not valid                                                                                                 |
| System Common / Real Time / Exclusive          | affect the entire system, not a zone                         | —                                                                                                         |

**[C]** — the final specification's Table 1, as described in the comparison document.

The "combine meaningfully" wording for master-channel pressure and CC 74 is deliberately
unspecified. For MotionLab, **sum in the normalised domain and clamp** for pressure and CC 74, and
**sum** for pitch bend (master bend and member bend add, in semitones). Document this as our
interpretation; it is what most receivers do. **[U]**

## 3. The MPE Configuration Message (MCM)

The MCM is **RPN 0x0006** sent on a **master channel**. It creates, resizes or deletes a zone.

### 3.1 Byte layout

For the Lower Zone (master channel 1, status byte `B0`):

| Bytes      | Meaning                                                           |
| ---------- | ----------------------------------------------------------------- |
| `B0 64 06` | CC 100 (RPN LSB) = 0x06                                           |
| `B0 65 00` | CC 101 (RPN MSB) = 0x00                                           |
| `B0 06 mm` | CC 6 (Data Entry MSB) = **mm = number of Member Channels, 0..15** |

For the Upper Zone, the same three messages on channel 16 (status byte `BF`). **[C]**

- `mm = 0` **deletes** that zone. **[C]**
- Setting **both** zones to zero member channels deactivates MPE. What the device does after that
  is explicitly undefined and left to the manufacturer. **[C]**
- Data Entry LSB (CC 38) is not used for the MCM.
- The specification's examples are preceded by a Reset All Controllers (`B0 79 00` / `BF 79 00`).
  **[R]** — treat sending it as good practice, and treat receiving it as ordinary.

### 3.2 Overlap and truncation

Zones are allocated from their master channel outward. If a new MCM would make the two zones
overlap, **the other zone is truncated** — the specification retains the draft's partial
overwrite/truncate behaviour. **[C]** A receiver must therefore recompute _both_ zones' channel
sets on every MCM, not just the one addressed.

### 3.3 Required side effects of receiving an MCM

On receipt of an MCM, a compliant receiver **shall**:

1. Set the **Master Channel pitch bend sensitivity to ±2 semitones**. **[C]**
2. Set **every Member Channel's pitch bend sensitivity to ±48 semitones**. **[C]**
3. Stop all ongoing notes and reset all controls to reasonable default values on every channel
   entering or leaving MPE control. **[C]**

Those two default ranges are the most commonly mis-implemented numbers in MPE. They may be changed
afterwards with RPN 0 (§5), but the MCM **resets** them.

Power-on behaviour — whether a device starts in MPE mode — was specified in the draft and is now
**at the manufacturer's discretion**. **[C]** So a receiver must not assume anything before it has
seen an MCM.

## 4. The three dimensions

| #   | Dimension                | Message          | Resolution in MPE 1.0 | Channel                             |
| --- | ------------------------ | ---------------- | --------------------- | ----------------------------------- |
| 1   | **Pitch bend** ("glide") | Pitch Bend       | **14-bit**            | member (per note) and master (zone) |
| 2   | **Pressure** ("press")   | Channel Pressure | **7-bit**             | member (per note) and master (zone) |
| 3   | **Timbre / slide**       | **CC 74**        | **7-bit**             | member (per note) and master (zone) |

Plus two velocity dimensions: **strike** (note-on velocity) and **lift** (note-off velocity), both
7-bit natively and **14-bit capable via the High Resolution Velocity Prefix (CC 88)**. **[C]**

**Breaking changes from the draft that matter to us:**

- The draft made all five dimensions 14-bit capable. MPE 1.0 has **three 14-bit** (glide, strike,
  lift) and **two 7-bit** (press, slide). **[C]**
- **14-bit aftertouch is removed** — CC 70 (MSB) / CC 102 (LSB) are no longer part of the
  specification. **[C]**
- **14-bit CC 74 is removed** — CC 106 as its LSB is gone. **[C]**
- The draft supported CC 70–79 (MSB) and CC 102–111 (LSB) per note. MPE 1.0 restricts per-note
  control to **CC 74 only, with no LSB**. **[C]**

**Consequence for MotionLab.** Pressure and slide arriving over MPE are 7-bit — 128 steps. Store
and process them as normalised floats internally so that (a) our own automation and (b) a future
MIDI 2.0 input path can carry more resolution through the same code, but do not claim more
resolution than arrived. Smoothing/interpolation at the instrument is required to avoid audible
stepping on slow pressure sweeps; that is an implementation obligation, not a specification one.

**CC 74 absolute vs relative.** The specification distinguishes controllers that report an
_absolute position_ (a finger's position on a pad) from those that report a _relative_ movement
starting at 64. **[C]** A receiver cannot tell which it is getting from the data. MotionLab must
expose a per-input-device setting — "CC 74 is absolute / centred" — defaulting to absolute, and
must not assume 64 means "no timbre change".

## 5. Pitch bend sensitivity (RPN 0)

RPN **0x0000**, standard MIDI 1.0:

| Bytes      | Meaning                                      |
| ---------- | -------------------------------------------- |
| `Bn 65 00` | CC 101 (RPN MSB) = 0                         |
| `Bn 64 00` | CC 100 (RPN LSB) = 0                         |
| `Bn 06 ss` | Data Entry MSB = semitones                   |
| `Bn 26 cc` | Data Entry LSB = cents (optional, see below) |

Rules specific to MPE:

- Range is **±0 to ±96 semitones**. The draft said ±1 to ±96 and then contradicted itself; 1.0
  corrects it to include zero. **[C]**
- Pitch bend sensitivity **must be sent to every Member Channel** — one message per channel — but
  **all of them must carry the same value**, and the last one received applies to the **whole
  zone**. **[C]** In practice one message would suffice; sending all of them is required for
  compatibility and recommended by the specification.
- **The LSB (cents) was unused in the draft; in 1.0 it is allowed but not recommended, and a
  receiver may choose whether to respond.** **[C]** MotionLab should parse it and use it, and must
  not break if it never arrives.
- Master-channel and member-channel sensitivities are **independent**, and the MCM resets them to
  ±2 and ±48 respectively (§3.3). **[C]**

**Total bend applied to a note = master-channel bend (scaled by master sensitivity) + member-channel
bend (scaled by member sensitivity).** **[U]** — the specification's "combine meaningfully" wording
covers this; addition in semitones is the universal interpretation.

The specification adds a section on **calibrated pitch instruments** (new in 1.0), for instruments
whose pitch must be exact. **[C]** — its content is **[X]** to me; I could not read the clause.

## 6. Note lifecycle, channel reuse and voice stealing

This is where receivers most often fail conformance.

### 6.1 The rule set

1. A Member Channel is **assigned to a note from its Note On until its Note Off**. **[C]**
2. After the Note Off, **per-note control must stop**, "regardless of whether notes are kept active
   by a damper pedal or long release envelopes", specifically so that the channel can be reused
   quickly. **[C]**
3. Therefore **pitch bend and other per-note controllers received after a Note Off must not affect
   the release portion of that note**. **[C]** A receiver that keeps applying member-channel bend
   to a releasing voice will detune release tails when the channel is reused — the classic MPE
   receiver bug.
4. A releasing note may sound for a long time. The channel is nonetheless free. So a receiver must
   maintain, per member channel, a _current controller state_ that is independent of any sounding
   voice.
5. **All per-note control messages must be tracked per channel even when no notes are sounding**,
   because the values in effect at the moment of the next Note On are the ones that note starts
   with. **[C]** This means a receiver keeps 15 (or 14) sets of {bend, pressure, CC 74} alive at
   all times, and a Note On snapshots them.
6. **Running-status Note On with velocity 0 must be treated as Note Off with velocity 64**, not
   velocity 0. **[C]**
7. **Channel pressure should be set to zero immediately before a Note On or Note Off** — the
   specification hedges this with an exception. **[C]** A receiver must therefore tolerate a
   zero-pressure message arriving immediately before a note and not interpret it as an expressive
   gesture.
8. In **Mode 4** (Lower Zone only, mono devices) a new note on a member channel **stops the
   previous note on that channel**. **[C]**
9. **"Basic channel" in a Mode 3 / Mode 4 switch is defined as the lowest member channel.** **[C]**

### 6.2 Sender-side note allocation

For completeness, since MotionLab is also a _sender_ (playback of recorded MPE clips, and MIDI
output). The specification's guidance is explicitly vague and offers no interoperability
guarantee. **[C]** It says, in substance:

- allocate to the member channel with the **fewest active notes**;
- **prefer reusing** the channel that just released the same note number;
- **except** when the same note number should sound twice simultaneously with different bends;
- **prefer** the channel that would require the **smallest pitch bend** for notes already sounding
  on it;
- optionally reduce that channel's bend to vibrato depth while multiple notes share it.

For a DAW this is not sufficient. MotionLab's clip format must **store the member channel actually
recorded**, and playback must reproduce it, because the recorded expression curves were authored
against that channel assignment. Re-allocation is only permitted when the user edits the clip in a
way that requires it (splitting a note, changing a note's pitch so it collides). The specification
explicitly acknowledges that DAWs and MIDI mergers may dynamically reassign notes to other
channels. **[C]**

### 6.3 Receiver compliance checklist

A minimal compliant MPE receiver, in the order the logic must run:

1. Parse MCM on channels 1 and 16 only; recompute both zones on every MCM; truncate the other zone
   on overlap; treat `mm = 0` as delete; treat both-zero as MPE off.
2. On MCM, stop all notes, reset controllers, set master sensitivity ±2 and member sensitivity ±48.
3. Maintain per-member-channel controller state {pitch bend, pressure, CC 74} that persists across
   notes.
4. Maintain per-zone (master channel) state {pitch bend, pressure, CC 74, all other CCs, program}.
5. On Note On, allocate a voice, bind it to that member channel, and initialise it from the
   channel's current controller state.
6. While the note sounds, apply member-channel dimensions to that voice and master-channel
   dimensions to all voices in the zone.
7. On Note Off, unbind the channel immediately; the voice enters release; **stop applying
   member-channel controllers to it**.
8. Respond to Note On / Note Off on the **master** channel too.
9. Accept and ignore per-note messages that are not one of the three dimensions.
10. Handle High Resolution Velocity Prefix (CC 88) if present.
11. Ignore MIDI Modes 1 and 2; handle Mode 4 mono semantics.

**Points 3, 5 and 7 are the ones that separate a real implementation from a demo.**

## 7. Draft-1.25a compatibility

Devices in the field still emit draft-era configurations. MotionLab should implement a
**compatibility mode**, off by default, that:

- accepts arbitrary zone definitions (master channel plus an arbitrary member range) as the draft
  allowed, and maps them onto our internal zone model; **[C]** that these are invalid in 1.0
- accepts 14-bit aftertouch (CC 70/102) and 14-bit CC 74 (CC 106) and downgrades them;
- accepts per-note CC 70–79 and either maps CC 74 through and discards the rest, or exposes them
  as generic per-note controllers in our own richer internal model.

Log a warning naming the non-conformance rather than failing.

## 8. MPE message layout — quick reference

| Purpose                    | Bytes                                            | Channel             | Notes                                      |
| -------------------------- | ------------------------------------------------ | ------------------- | ------------------------------------------ |
| MCM, lower zone, N members | `B0 64 06`, `B0 65 00`, `B0 06 N`                | 1                   | N = 0..15; 0 deletes                       |
| MCM, upper zone, N members | `BF 64 06`, `BF 65 00`, `BF 06 N`                | 16                  |                                            |
| MPE off                    | both of the above with N = 0                     | 1 and 16            | subsequent behaviour undefined             |
| Pitch bend sensitivity     | `Bn 65 00`, `Bn 64 00`, `Bn 06 ss`, [`Bn 26 cc`] | each member channel | ss = 0..96 semitones                       |
| Per-note pitch bend        | `En ll hh`                                       | member              | 14-bit, centre 0x2000                      |
| Per-note pressure          | `Dn vv`                                          | member              | 7-bit                                      |
| Per-note timbre            | `Bn 4A vv`                                       | member              | CC 74, 7-bit                               |
| Zone pitch bend            | `E0 ll hh` / `EF ll hh`                          | master              |                                            |
| Zone pressure              | `D0 vv` / `DF vv`                                | master              |                                            |
| Zone timbre                | `B0 4A vv` / `BF 4A vv`                          | master              |                                            |
| Poly key pressure          | `An kk vv`                                       | master only         | handling required                          |
| Note on                    | `9n kk vv`                                       | member or master    | vv = 0 means note off, release velocity 64 |
| Note off with lift         | `8n kk vv`                                       | member or master    | vv = release velocity                      |
| High-res velocity prefix   | `Bn 58 ll` before the note                       | member              | CC 88 = velocity LSB                       |

`n` = channel nibble, 0-based. **[C]** for every row except the CC 88 usage, which is **[R]**.

---

## PART B — MIDI 2.0

## 9. What is actually in MIDI 2.0, and what it means for a browser DAW

MIDI 2.0 is three separable things. Conflating them is the usual source of confusion:

1. **The Universal MIDI Packet (UMP)** — a new container format. It can carry _either_ MIDI 1.0
   messages (message type 0x2) _or_ MIDI 2.0 messages (type 0x4). Adopting UMP does not require
   adopting the MIDI 2.0 protocol.
2. **The MIDI 2.0 protocol** — higher-resolution channel voice messages and genuinely per-note
   controllers, carried in UMP type 0x4.
3. **MIDI-CI** — a bidirectional negotiation layer carried in MIDI 1.0 System Exclusive, providing
   discovery, protocol negotiation (now largely superseded by UMP stream configuration), Profile
   Configuration, Property Exchange and Process Inquiry.

### 9.1 UMP message types

The top 4 bits of the first 32-bit word are the **Message Type (MT)**, and MT alone determines the
packet size.

|  MT | Size     | Contents                                                                                                                                       |
| --: | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 0x0 | 32 bits  | **Utility** — NOOP, JR Clock, JR Timestamp, Delta Clockstamp Ticks Per Quarter Note, Delta Clockstamp                                          |
| 0x1 | 32 bits  | **System Real Time and System Common** (except System Exclusive)                                                                               |
| 0x2 | 32 bits  | **MIDI 1.0 Channel Voice Messages**                                                                                                            |
| 0x3 | 64 bits  | **Data** — 7-bit System Exclusive                                                                                                              |
| 0x4 | 64 bits  | **MIDI 2.0 Channel Voice Messages**                                                                                                            |
| 0x5 | 128 bits | **Data** — 8-bit System Exclusive and Mixed Data Set                                                                                           |
| 0xD | 128 bits | **Flex Data** — tempo, time signature, metronome, key signature, chord, performance, lyric                                                     |
| 0xF | 128 bits | **UMP Stream** — endpoint discovery/info/name/product-id, stream configuration, function block discovery/info/name, start of clip, end of clip |

**[I]** — MT constants and the utility/Flex Data/UMP Stream sub-status maps read from an MIT
library's headers. The message-type-to-size mapping is corroborated by the specification's own
description **[R]**. Other MT values are reserved. Check the whole table against _M2-104-UM_.

The second nibble of word 0 is the **Group**, 0x0–0xF = groups 1–16. Each group carries a full
16-channel MIDI space, so a UMP endpoint addresses **256 channels**. **[I]**, corroborated by the specification's
description of Groups as sixteen interleaved streams **[R]**.

### 9.2 MIDI 2.0 Channel Voice message layout (MT 0x4)

```
word 0:  [ MT=0x4 : 4 ][ group : 4 ][ status : 4 ][ channel : 4 ][ index1 : 8 ][ index2 : 8 ]
word 1:  [ 32-bit data                                                                     ]
```

**[I]** — read from an MIT library's packet constructor. Check the field order and widths against
_M2-104-UM_ before writing a codec.

| Status | Message                            | index1           | index2           | word 1                                         |
| -----: | ---------------------------------- | ---------------- | ---------------- | ---------------------------------------------- |
|    0x0 | **Registered Per-Note Controller** | note number      | controller index | 32-bit value                                   |
|    0x1 | **Assignable Per-Note Controller** | note number      | controller index | 32-bit value                                   |
|    0x2 | Registered Controller (RPN)        | bank             | index            | 32-bit value                                   |
|    0x3 | Assignable Controller (NRPN)       | bank             | index            | 32-bit value                                   |
|    0x4 | Relative Registered Controller     | bank             | index            | signed 32-bit delta                            |
|    0x5 | Relative Assignable Controller     | bank             | index            | signed 32-bit delta                            |
|    0x6 | **Per-Note Pitch Bend**            | note number      | —                | 32-bit bend                                    |
|    0x8 | Note Off                           | note number      | attribute type   | velocity (16, high half) + attribute data (16) |
|    0x9 | Note On                            | note number      | attribute type   | velocity (16, high half) + attribute data (16) |
|    0xA | Poly Pressure                      | note number      | —                | 32-bit pressure                                |
|    0xB | Control Change                     | controller index | —                | 32-bit value                                   |
|    0xC | Program Change                     | —                | bank-valid flag  | program (8, high byte) + bank MSB/LSB          |
|    0xD | Channel Pressure                   | —                | —                | 32-bit pressure                                |
|    0xE | Pitch Bend                         | —                | —                | 32-bit bend                                    |
|    0xF | **Per-Note Management**            | note number      | option flags     | 0                                              |

**[I]** — every row read from an MIT library's message constructors. This is the table most worth
checking against the specification, because a wrong status nibble produces silent, hard-to-debug
interoperability failure.

What this table changes, relative to MIDI 1.0 and MPE:

- **RPN and NRPN are single atomic messages** with a 7-bit bank, a 7-bit index and a 32-bit value.
  The MIDI 1.0 four-message CC 98/99/6/38 dance is gone, and with it the ordering and
  interleaving bugs that plague RPN handling.
- **Relative controller messages** exist, carrying signed deltas — endless encoders become
  first-class.
- **Per-note controllers are addressed by note number**, not by channel. MPE's entire
  channel-rotation mechanism becomes unnecessary; a per-note controller message names the note it
  applies to.
- **Note On velocity 0 is a valid Note On.** The MIDI 1.0 running-status convention does not apply.
  A DAW converting MIDI 1.0 → MIDI 2.0 must translate `9n kk 00` to a Note Off, and must not
  translate a MIDI 2.0 Note On with velocity 0 into a Note Off going the other way.
- **Note attribute**: an 8-bit attribute _type_ plus 16 bits of attribute _data_ on every note,
  used for things like exact pitch at note-on. Preserve them through the clip format even if the
  instrument ignores them.
- **Per-Note Management** carries option flags — detaching a note's per-note controllers from a
  previously played note, and resetting per-note controllers to their defaults. **[C]** for the
  message and its shape; the exact flag bit assignments are **[U]**.

The **registered per-note controller index assignments** (which index means modulation, breath,
pitch, volume, pan, expression, brightness, and so on) are **[X]** — I could not obtain the
official table from this environment. It is needed before we can map MPE's CC 74 onto its MIDI 2.0
equivalent. **Obtain it before implementing the per-note controller path.**

### 9.3 Resolution and the scaling algorithm

MIDI 2.0 velocity is 16-bit; controllers, pressure and bend are 32-bit. Converting between
resolutions is **specified**, not left to the implementer, and the specification's algorithm is
not a simple shift.

**Downscale (higher → lower bits):** right shift. **[C]**

**Upscale (lower → higher bits):** "min-centre-max" bit-repeat:

```
if (srcVal == 0) return 0;
if (srcBits == 1) return (1 << dstBits) - 1;
scaleBits       = dstBits - srcBits;
bitShiftedValue = srcVal << scaleBits;
srcCenter       = 1 << (srcBits - 1);
if (srcVal <= srcCenter) return bitShiftedValue;      // below centre: plain shift
repeatBits  = srcBits - 1;
repeatValue = srcVal & ((1 << repeatBits) - 1);
repeatValue = (scaleBits > repeatBits) ? repeatValue << (scaleBits - repeatBits)
                                       : repeatValue >> (repeatBits - scaleBits);
while (repeatValue != 0) { bitShiftedValue |= repeatValue; repeatValue >>= repeatBits; }
return bitShiftedValue;
```

**[I]** for the code; **[C]** for the property it guarantees, which the specification requires.

The property this guarantees: **minimum maps to minimum, centre maps exactly to centre, maximum
maps exactly to maximum**. A naive `x << 25` leaves 7-bit maximum 127 mapping to 0xFE000000 rather
than 0xFFFFFFFF, so a "fully open" filter never quite opens, and a centred pitch bend of 0x2000
does not land exactly on 0x80000000. Implement the algorithm above verbatim and unit-test the
three fixed points.

### 9.4 MIDI-CI

Carried in MIDI 1.0 Universal System Exclusive: `F0 7E <device> 0D <sub-ID#2> …`, with `7E`
non-realtime, sub-ID#1 `0D` = MIDI-CI. Devices identify themselves by a **28-bit MUID**;
`0x0FFFFFFF` is the broadcast MUID. **[I]**

|        Sub-ID#2 | Category                  | Message                                                                                                                        |
| --------------: | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
|     0x70 / 0x71 | Management                | Discovery / Discovery Reply                                                                                                    |
|     0x72 / 0x73 | Management                | Endpoint Info / Reply                                                                                                          |
|            0x7D | Management                | ACK                                                                                                                            |
|            0x7E | Management                | Invalidate MUID                                                                                                                |
|            0x7F | Management                | NAK                                                                                                                            |
|       0x10–0x15 | Protocol Negotiation      | Negotiation, Reply, Set, Test, Test Responder, Confirm                                                                         |
| 0x20–0x29, 0x2F | **Profile Configuration** | Inquiry, Inquiry Reply, Set On, Set Off, Enabled, Disabled, Add, Remove, Details Inquiry, Details Reply, Profile Specific Data |
| 0x30–0x39, 0x3F | **Property Exchange**     | Capability, Capability Reply, Get, Get Reply, Set, Set Reply, Subscribe, Subscribe Reply, Notify                               |
|       0x40–0x44 | Process Inquiry           | Capability, Capability Reply, MIDI Message Report, Reply, End                                                                  |

**[I]** — the complete sub-ID map read from an MIT library's headers. Check against the MIDI-CI
specification, and note that MIDI-CI has revised since (protocol negotiation is deprecated, §9.4).

**Property Exchange** is a JSON-over-SysEx request/response system with HTTP-like status codes:
200 OK, 202 Accepted, 341 Resource Unavailable, 342 Bad Data, 343 Too Many Requests, 400 Bad
Request, 403 Unauthorized, 404 Resource Unsupported, 405 Resource Not Allowed, 413 Payload Too
Large, 415 Unsupported Media Type, 445 Invalid Data Version, 500 Internal Device Error. **[I]**
Payload encodings: 1 = ASCII, 2 = Mcoded7, 3 = Mcoded7 + zlib. **[I]** Chunking commands: Start,
End, Partial, Full, Notify. **[I]**

This is what would let a DAW read a device's patch list, parameter list and current state as
structured data instead of via per-device SysEx drivers — the single most valuable part of
MIDI 2.0 for a DAW, and the furthest from being usable today.

**Protocol Negotiation (0x10–0x15) is legacy.** In the current UMP era, protocol selection moved to
the UMP Stream messages (MT 0xF: Stream Configuration Request / Notification). **[R]** Do not build
against protocol negotiation.

## 10. What is relevant to MotionLab now, and what is later

### 10.1 The hard constraint

**The Web MIDI API carries MIDI 1.0 bytestream only. No browser ships UMP.** Chrome, Edge, Opera
and Firefox implement Web MIDI for MIDI 1.0; Safari and iOS do not implement Web MIDI at all.
There is W3C drafting work on MIDI 2.0 features but nothing shipping as of 2026. **[R]** —
consistent across every source I could reach; treat as the working assumption and re-check before
each release.

So: **MPE is a now problem. MIDI 2.0 on the wire is a later problem. MIDI 2.0's data model is a
now problem**, because getting it wrong now means a rewrite later.

### 10.2 Now — build this

| Item                                                                 | Why now                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Full MPE receiver** (§6.3)                                         | This is how expressive controllers reach a browser DAW today, over Web MIDI 1.0.                                                                                                                                                                                                                                                                             |
| **MPE sender** for MIDI output and for clip playback                 | Same.                                                                                                                                                                                                                                                                                                                                                        |
| **Per-note expression in the clip format**                           | Every note carries its own bend / pressure / slide curves, plus the member channel it was recorded on. Retrofitting this is a data-migration problem, so do it before the format ships.                                                                                                                                                                      |
| **Normalised float internal representation**                         | Store expression as float in a documented range (bend in semitones, pressure and slide in 0..1). Never store raw 7-bit.                                                                                                                                                                                                                                      |
| **Note-addressed per-note controllers internally**                   | Model expression as `(note instance, controller id) → value`, the MIDI 2.0 model, **not** as `(channel) → value`, the MPE model. Then MPE input becomes a translation layer at the edge, and MIDI 2.0 input later becomes a second translation layer, with no change to the core. This is the single most important architectural decision in this document. |
| **32-bit-capable controller values with the min-centre-max scaling** | Implement §9.3 now and route all 7-bit input through it. Costs nothing, removes the "filter never fully opens" class of bug immediately, and is forward-compatible.                                                                                                                                                                                          |
| **Instrument API declares per-note dimensions**                      | Our internal instruments (`syn-04`, `syn-05`, sampler) advertise which per-note dimensions they consume, so the UI can show what an expressive controller will actually do.                                                                                                                                                                                  |
| **CC 88 High Resolution Velocity Prefix**                            | Cheap, in MPE 1.0, and gives 14-bit strike/lift on controllers that send it.                                                                                                                                                                                                                                                                                 |
| **Draft-1.25a compatibility mode** (§7)                              | Real controllers in the field still emit draft configurations.                                                                                                                                                                                                                                                                                               |

### 10.3 Later — design for, do not build

| Item                                            | Trigger to build                                                                                                                                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UMP input/output**                            | A browser shipping UMP in Web MIDI, or a native wrapper. Keep the internal event struct UMP-shaped (group, channel, status, two index bytes, 32-bit data) so this is a codec, not a refactor.                                                         |
| **MIDI 2.0 protocol messages**                  | Same trigger. The per-note controller and per-note pitch bend paths already exist internally if §10.2 is done.                                                                                                                                        |
| **MIDI-CI Discovery and Profile Configuration** | Technically reachable now — Web MIDI grants SysEx with explicit user permission — but there is little to talk to, and Profiles are still thin on the ground. Revisit when a profile we care about (a keyboard or drum profile) is common in hardware. |
| **Property Exchange**                           | The high-value one for a DAW: device patch and parameter discovery without per-device drivers. Blocked on both browser support and device adoption. Track it.                                                                                         |
| **JR Timestamps / Delta Clockstamps**           | Only meaningful over a UMP transport. Relevant to our recording accuracy when it arrives.                                                                                                                                                             |
| **Flex Data (tempo, key, chord, lyrics)**       | Interesting for clip metadata interchange. No transport today.                                                                                                                                                                                        |

### 10.4 The one design rule

If MotionLab's internal event model is **note-addressed, 32-bit, and UMP-shaped**, then MPE is a
lossy input codec and MIDI 2.0 is a lossless one, and both are edge concerns. If the internal model
is channel-addressed and 7-bit, MPE support will be entangled with the voice allocator, per-note
expression will be limited to three dimensions forever, and MIDI 2.0 will require rewriting the
sequencer. Make this decision explicitly and record it in an ADR.

---

## 11. Verification — conformance tests QA should run

### 11.1 MPE receiver

| #   | Test                      | Input                                                                         | Expected                                                                  | Tolerance           |
| --- | ------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------- |
| A1  | Lower zone creation       | `B0 64 06`, `B0 65 00`, `B0 06 0F`                                            | zone: master 1, members 2–16; 15-note polyphony                           | exact               |
| A2  | Upper zone creation       | same on channel 16 with `06 0F`                                               | master 16, members 15–1                                                   | exact               |
| A3  | Both zones, no overlap    | lower with 7, upper with 7                                                    | members 2–8 and 15–9; masters 1 and 16                                    | exact               |
| A4  | Overlap truncation        | lower with 15, then upper with 7                                              | lower zone truncated; both zones recomputed                               | exact               |
| A5  | Zone deletion             | `06 00` on channel 1                                                          | lower zone removed; notes stopped; controls reset                         | exact               |
| A6  | MPE off                   | `06 00` on both masters                                                       | MPE deactivated                                                           | exact               |
| A7  | Channel 1 as upper member | upper zone with 15 members, no lower zone                                     | channel 1 is a **member**, not a master                                   | exact               |
| A8  | MCM default sensitivities | any MCM, then a full-scale member bend                                        | member bend = ±48 semitones; master bend = ±2                             | ±0.1 cents          |
| A9  | RPN 0 override            | MCM, then RPN 0 = 12 on all member channels                                   | member bend = ±12 zone-wide                                               | ±0.1 cents          |
| A10 | RPN 0 on one channel only | MCM, then RPN 0 = 12 on channel 5 only                                        | applies to the **whole zone**                                             | exact               |
| A11 | RPN 0 with LSB            | `06 12`, `26 32`                                                              | 18 semitones + 50 cents, or documented as ignored                         | ±0.5 cents          |
| A12 | Bend summation            | master bend +1 semitone, member bend +2                                       | note is +3 semitones                                                      | ±0.5 cents          |
| A13 | Controller state persists | CC 74 = 100 on channel 3 with no note sounding, **then** Note On on channel 3 | the note starts with timbre 100                                           | exact               |
| A14 | Release isolation         | Note On ch 3, Note Off ch 3, then pitch bend on ch 3                          | the releasing note's pitch **does not move**                              | 0 cents             |
| A15 | Rapid channel reuse       | Note Off ch 3, immediately Note On ch 3 with a new bend                       | new note bends, old note's tail does not                                  | 0 cents on the tail |
| A16 | Note On velocity 0        | `93 3C 00`                                                                    | treated as Note Off with release velocity 64                              | exact               |
| A17 | Master-channel notes      | Note On on channel 1 in a lower zone                                          | must sound                                                                | exact               |
| A18 | Poly key pressure         | `A0 3C 40` on the master                                                      | must be handled, not ignored                                              | exact               |
| A19 | Unsupported per-note CC   | CC 71 on a member channel                                                     | silently ignored, no error, no side effect                                | exact               |
| A20 | High-res velocity         | CC 88 = 64 then Note On velocity 100                                          | 14-bit strike ≈ 100.5                                                     | ±1 LSB              |
| A21 | Zero-pressure before note | `D3 00` then `93 3C 64`                                                       | the zero is not treated as a gesture                                      | exact               |
| A22 | Mode 4 mono               | Mode 4, two notes on one member channel                                       | first note stops                                                          | exact               |
| A23 | Invalid draft zone        | draft-style MCM defining channels 2–8                                         | **ignored** in strict mode; accepted with a warning in compatibility mode | exact               |

### 11.2 MPE sender / round trip

| #   | Test                                                                                                        | Expected                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| B1  | Record 10 overlapping MPE notes with continuous bend, pressure and slide, then play back and capture output | byte-identical channel assignment and controller stream, within the sequencer's quantisation   |
| B2  | Record, edit one note's pitch, play back                                                                    | only the edited note is reallocated if reallocation is needed; other notes keep their channels |
| B3  | Record on a 15-member zone, play back into an 8-member zone                                                 | notes redistributed, no note dropped, expression preserved per note                            |
| B4  | Export and re-import a clip                                                                                 | per-note expression curves bit-identical                                                       |
| B5  | Two zones simultaneously                                                                                    | notes routed to the correct zone; masters not confused                                         |

### 11.3 MIDI 2.0 data model (testable now, without a transport)

| #   | Test                         | Expected                                                                                                                |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| C1  | Upscale 7 → 32 bits          | 0 → 0x00000000; 64 → 0x80000000 exactly; 127 → 0xFFFFFFFF exactly                                                       |
| C2  | Upscale 14 → 32 bits         | 0 → 0; 0x2000 → 0x80000000 exactly; 0x3FFF → 0xFFFFFFFF exactly                                                         |
| C3  | Upscale then downscale       | round-trips to the original 7-bit or 14-bit value for all inputs                                                        |
| C4  | Upscale monotonicity         | strictly non-decreasing across the whole input range                                                                    |
| C5  | UMP packing                  | build MT 0x4 Note On / Per-Note Pitch Bend / Registered Controller packets and compare against the byte layouts in §9.2 |
| C6  | MIDI 1.0 → MIDI 2.0 note off | `9n kk 00` becomes a MIDI 2.0 Note Off, **not** a Note On with velocity 0                                               |
| C7  | MIDI 2.0 → MIDI 1.0 note on  | a MIDI 2.0 Note On with 16-bit velocity 0 becomes MIDI 1.0 velocity 1, not 0                                            |
| C8  | Per-note addressing          | internal expression events survive a channel reassignment of their note unchanged                                       |

Tests C1–C4 should be property-based over the full input domain, not sampled — they are cheap and
they catch the entire class of scaling bugs.

---

## 12. Sources

### Documentation

- **MPE final-versus-draft comparison notes**, a clause-by-clause comparison of MPE 1.0
  (12 March 2018) against draft 1.25a (15 December 2015), covering zone configuration, the MCM,
  dimension resolutions and the removals, pitch bend sensitivity, note allocation, and receiver
  obligations. <https://github.com/svgeesus/MPE-notes/blob/master/MPE-final-spec-notes.md> —
  the source of most [C] marks in Part A.

### Implementation (**[I]** — check against the specification before use)

- **AM_MIDI2.0Lib**, an **MIT**-licensed MIDI 2.0 C++ library. Read `include/utils.h` (UMP message
  type constants, utility and Flex Data sub-statuses, UMP Stream message ids, the complete MIDI-CI
  sub-ID map, Property Exchange status codes and encodings, MUID broadcast value, UMP version) and
  `include/umpMessageCreate.h` (the exact bit layout of every MT 0x4 channel voice message, and the
  min-centre-max scaling algorithm). <https://github.com/midi2-dev/AM_MIDI2.0Lib> — the source of
  the tables in §9.

### Secondary, via search-engine extraction (the specification PDFs are not fetchable here)

- MIDI Association, _MIDI Polyphonic Expression Version 1.0_, 12 March 2018 — the ±2 / ±48 default
  sensitivities set by the MCM, the "per-note control should stop after Note Off … to allow rapid
  reuse of unoccupied Member Channels" clause, the MCM byte example.
  <https://d30pueezughrda.cloudfront.net/campaigns/mpe/mpespec.pdf>
- MIDI Association, MPE adoption announcement and "How MIDI MPE pitch bend works".
  <https://midi.org/midi-polyphonic-expression-mpe-specification-adopted>,
  <https://midi.org/community/midi-specifications/how-midi-mpe-pitch-bend-works>
- Roger Linn Design, "Developers, how to add MPE" — the five per-note messages a receiver must
  listen for. <https://www.rogerlinndesign.com/support/support-developers-how-to-add-mpe>
- JUCE, "Understanding MPE zones". <https://docs.juce.com/master/tutorial_mpe_zones.html>
- _M2-104-UM: UMP and MIDI 2.0 Protocol Specification_ v1.0, via document-hosting extracts —
  message type table and packet sizes, groups as sixteen interleaved streams.
- MIDI Association, "The State of MIDI 2.0" (February 2026 update) — profiles adoption status.
  <https://midi.org/the-state-of-midi-2-0-high-resolution-performance-and-the-rise-of-profiles-update-feb-2026>
- MDN, Web MIDI API; caniuse; and 2026 browser-support surveys — Web MIDI is MIDI 1.0 bytestream
  only in every shipping browser; Safari and iOS do not implement it.
  <https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API>, <https://caniuse.com/midi>

---

## 13. Not confirmed, and conflicts

1. **MPE's Recommended Practice number.** Cited as RP-35 in the comparison document I read;
   other references give RP-053. The specification's date (12 March 2018) and content are not in
   doubt. **[U]** — cosmetic, but get it right in any user-facing text.
2. **Registered Per-Note Controller index assignments** in MIDI 2.0 — which index is modulation,
   breath, pitch, volume, pan, expression, brightness. **[X]** I could not obtain the official
   table. **Required before implementing the MIDI 2.0 per-note controller path**, and required to
   define the MPE CC 74 ↔ MIDI 2.0 mapping.
3. **Per-Note Management option-flag bit assignments.** The message exists and carries an
   8-bit option field; the two documented behaviours are "detach per-note controllers from a
   previously played note" and "reset per-note controllers to default". Which bit is which is
   **[U]**.
4. **"Combine meaningfully"** — the specification's wording for how master-channel pressure, CC 74
   and pitch bend combine with per-note values. Deliberately unspecified. MotionLab's choice
   (sum-and-clamp for pressure and timbre, sum in semitones for bend) is **[U]** and must be
   documented as our interpretation, with a preference toggle if a user reports a mismatch against
   another host.
5. **MPE 1.0 §2.4.1 "Calibrated Pitch Instruments"** — a new section in the final specification
   whose content I could not read. **[X]**
6. **Note allocation for senders.** The specification's guidance is explicitly vague and offers no
   interoperability guarantee; the comparison document I read calls it "handwavy prose … no interop
   with such vague and optional specification prose". Our clip-format decision (store the recorded
   channel) sidesteps it, but two hosts will legitimately allocate differently. **[C]** that it is
   unspecified.
7. **Web MIDI and MIDI 2.0 timeline.** Every source agrees no browser ships UMP as of 2026, and
   that W3C work is in draft. There is no published date. **[R]** — re-check before each release;
   this is the trigger for everything in §10.3.
8. **Whether Web MIDI SysEx access is sufficient for a practical MIDI-CI implementation** in a
   browser (permission model, latency, and message-size limits). Not investigated. **[X]**
9. **CC 88 High Resolution Velocity Prefix in MPE.** Its use for 14-bit strike and lift is
   described in the comparison document as the mechanism for the two 14-bit velocity dimensions;
   I did not confirm the exact prefix semantics against the specification text. **[R]**
10. **Everything in §9 is implementation-sourced.** The UMP message-type table, the MT 0x4 packet
    layouts and status codes, the MIDI-CI sub-ID map, the Property Exchange status codes and
    encodings, the broadcast MUID, and the scaling code are all **[I]**, read from an MIT-licensed
    library rather than from _M2-104-UM_ and the MIDI-CI specification (§0.1). The licence permits
    reuse; the **correctness** is what needs checking. **Obtaining the two specification documents
    is the highest-value follow-up for this sheet**, and it is a prerequisite for item 2 above.
    Part A (MPE) does not have this problem — it is documentation-sourced throughout.
