# Reference spec — matrix-modulated analogue polysynth

Internal research note. Target implementation: `SYN-05`, the analogue-voiced, matrix-modulated
instrument for MotionLab Studio.

## 0. How to read this document

Same rules and confidence markers as `syn-04-six-op-fm.md`:

- **[C]** confirmed against a primary source — the manufacturer's own MIDI implementation
  specification, or source code I read directly in this session.
- **[R]** reported by a reputable secondary source, not cross-checked against a primary one.
- **[U]** unconfirmed or inferred. **Do not build to a [U] value without checking it.**
- **[X]** explicitly unknown. Listed in §14.
- **[derived]** computed by me from a primary source; the derivation is shown.

**Intellectual-property rule.** Reference manufacturer and model names appear here because
engineering discussion requires them. They must not appear in shipped UI strings, code
identifiers, filenames, preset names, or marketing copy. No panel artwork, logotype, typeface or
badge may be reproduced or traced. §13 describes the *era's* design language only.

Sourcing note: the egress proxy on this machine blocks manufacturer sites, archive.org and
manual hosts. `github.com` is reachable, and the manufacturer's own **Matrix-12/Xpander MIDI
Specification** — the document that defines the patch structure, the parameter ranges, the
modulation source and destination enumerations and the multi-patch/zone structure — is mirrored
in a public repository, which I cloned and read. Every table in §§4–9 comes from that document or
from an editor built directly against it. See §12.

**A correction to the brief.** The brief asked for "the dual multimode filters". The primary
source shows **one multimode VCF per voice, with fifteen modes, flanked by two VCAs** (VCA 1
before the filter, VCA 2 after it). There is no second filter. What *is* dual is the instrument
itself: the twelve-voice keyboard model is two six-voice expander boards in one chassis, with two
voice banks in the multi-patch structure. **[C]** for the single filter (patch struct has one
`vcf` with one `fmode`); **[R]** for the two-board construction. §14.1.

---

## 1. Architecture

### 1.1 Per-voice signal path

```
   ┌────────┐  TRI SAW PULSE                 ┌──────────┐
   │ VCO 1  │───────────────┐                │ NOISE    │  (VCO 2 only)
   │ FREQ   │               │                └────┬─────┘
   │ DETUNE │  ◄── SYNC ────┼──────────┐          │
   │ PW     │               │          │          │
   │ VOL    │               ▼          │          ▼
   └────────┘        ┌──────────────────────────────────┐
   ┌────────┐        │  MIXER (per-oscillator VOL 0..63)│
   │ VCO 2  │───────►│                                  │
   │ FREQ   │        └───────────────┬──────────────────┘
   │ DETUNE │                        │
   │ PW     │                        ▼
   │ VOL    │                ┌───────────────┐
   │ NOISE  │                │    VCA 1      │  pre-filter gain, 0..63
   │ SYNC   │                └───────┬───────┘
   └───┬────┘                        │
       │  FM (amp 0..63)             ▼
       └────────────►┌───────────────────────────────┐
        dest =       │  VCF — 15 modes, 1..4 poles   │  FREQ 0..127, RES 0..63
        VCO1_FREQ or │  lowpass / highpass / bandpass│
        VCF_FREQ     │  / notch / phase shift        │
                     └───────────────┬───────────────┘
                                     ▼
                             ┌───────────────┐
                             │    VCA 2      │  post-filter gain, 0..63
                             └───────┬───────┘
                                     ▼
                              pan / volume / out
```

### 1.2 Per-voice control path

```
   SOURCES (27)                    MATRIX (20 routings)             DESTINATIONS (47)
   ┌─────────────────┐             ┌──────────────────┐             ┌──────────────────┐
   │ KBD LAG VEL RVEL│             │  source          │             │ VCO1 FRQ/PW/VOL  │
   │ PRES            │────────────►│  amount −63..+63 │────────────►│ VCO2 FRQ/PW/VOL  │
   │ TRK1..3         │             │  quantise flag   │             │ VCF FRQ/RES      │
   │ RMP1..4         │             │  destination     │             │ VCA1/VCA2 VOL    │
   │ ENV1..5         │             │  × 20 entries    │             │ LFO1..5 SPD/AMP  │
   │ PED1 PED2       │             │  ≤ 6 sources per │             │ ENV1..5 DLY/ATK/ │
   │ LFO1..5         │             │    destination   │             │   DCY/REL/AMP    │
   │ VIB LEV1 LEV2   │             └──────────────────┘             │ FM AMP, LAG SPD  │
   └─────────────────┘                                              └──────────────────┘
        ▲     ▲                                                            │
        │     └───── modulation destinations feed back into the sources ───┘
        │            (LFO speed, envelope times, ramp rates are all
        │             destinations AND their outputs are sources)
        │
   ┌────┴──────────────────────────────────────────────┐
   │ FIXED PATHS, outside the matrix (per-parameter    │
   │ enable bits): KEYB tracking, LAG, LEVER 1, VIB    │
   │ on VCO1 FREQ, VCO2 FREQ and VCF FREQ              │
   └───────────────────────────────────────────────────┘

   TRACKING GENERATORS (3): any source → 5-point piecewise-linear map → new source
   LAG PROCESSOR (1):       any source → slew limiter → source "LAG"
```

The architectural point to take away: **almost every modulator is also a destination**. LFO speed
and amplitude, every envelope segment time, envelope amplitude, ramp rates, FM amount and the lag
rate are all in the destination list. That, plus the tracking generators, is what makes this
instrument's modulation section qualitatively different from a fixed mod-wheel-and-two-LFOs
design, and it is why the matrix editor is the product.

---

## 2. Voice count, patches and modes

| Property | Value | Confidence |
|---|---|---|
| Voices (keyboard model) | 12, arranged as two banks of 6 | [C] for two banks (`bankM12[2]`), [R] for construction |
| Voices (expander model) | 6 | [C] |
| Single patches | 100 | [C] |
| Multi patches | 100 | [C] |
| Single-patch SysEx dump | 399 bytes: 6 intro + 188 double-byte values + 8 double-byte name + 1 EOX | [C] |
| Editable parameters per voice | ~1200 controls across the paged front panel; 226 in a full editor's parameter map | [C]/[R] |
| Zones (keyboard model) | 6 | [C] |
| Zones (expander model) | 3 | [C] |

**Single patch mode** copies one voice program to all voices — a conventional homogeneous
polysynth. **Multi patch mode** assigns a different single patch to each voice and additionally
stores per-voice transpose, volume, pan, detune and control source; a multi patch stores the
*assignment*, not the sounds. **Patch edit mode** is a submode of multi where the panel edits one
or more selected voices in the context of the whole multi. **[C]**

This three-mode structure is worth reproducing exactly: it is the reason the instrument is
genuinely multi-timbral rather than merely split-capable, and it maps cleanly onto a DAW
instrument that exposes one plug-in instance with per-zone MIDI channel routing.

---

## 3. Oscillators

Per voice, two VCOs. All parameters below are stored per single patch. **[C]** — MIDI spec patch
struct and editor parameter map.

| Parameter | Range | Unit | Notes |
|---|---|---|---|
| VCO 1 / 2 FREQ | 0..63 | table index | pitch, see below |
| VCO 1 / 2 DETUNE | **−31..+31** | signed | fine detune |
| VCO 1 / 2 PW | 0..63 | — | pulse width; only meaningful with the PULSE wave enabled |
| VCO 1 / 2 VOL | 0..63 | — | mixer level into VCA 1 |
| VCO 1 WAVE | bitfield | TRI / SAW / PULSE | **no noise on VCO 1** |
| VCO 2 WAVE | bitfield | TRI / SAW / PULSE / **NOISE** / **SYNC** | noise and sync are VCO 2 only |
| VCO 1 / 2 fixed mods | bitfield | KEYB / LAG / LEV1 / VIB | per-oscillator enables for the four fixed paths |

Waveforms are **bit flags, not an enum** — TRI, SAW and PULSE can be enabled simultaneously and
are summed. **[C]** (`VCOWaveFlags` is a bitfield: TRI 0x01, SAW 0x02, PULSE 0x04, SYNC 0x08,
NOISE 0x10). A single-selection waveform control is wrong.

**SYNC** is a flag on VCO 2. **[C]** Which oscillator is master and which is slave is not stated
in the MIDI specification; the flag living on VCO 2 implies VCO 2 is reset by VCO 1. **[U]**

**FM** is a separate section, not a matrix routing:

| Parameter | Range | Notes |
|---|---|---|
| FM AMP | 0..63 | also a matrix **destination** (`FM_AMP`) |
| FM DEST | 0..1 | 0 = VCO1_FREQ, 1 = VCF_FREQ |

**[C]** — `FMDestinationTypes` / `FMDestinationTypesNames`. The modulator is VCO 2. **[R]** The FM
path is audio-rate and separate from the matrix, so it survives even when all 20 matrix slots are
used.

The **real-world unit** of VCO FREQ 0..63 (semitones? a 5-octave span?) and of DETUNE ±31 (cents?)
is **[X]**. See §11.3 and §14.2.

---

## 4. Filter — the fifteen modes

One multimode VCF per voice.

| Parameter | Range | Notes |
|---|---|---|
| VCF FREQ | **0..127** | note the 7-bit resolution — twice that of every other continuous control |
| VCF RES | 0..63 | |
| VCF MODE | 0..14 | the fifteen modes below |
| VCA 1 VOL | 0..63 | pre-filter |
| VCA 2 VOL | 0..63 | post-filter |
| VCF fixed mods | bitfield | KEYB / LAG / LEV1 / VIB |

**[C]** — editor parameter map generated from the MIDI specification.

### 4.1 Complete mode table

Mode codes are the enum ordinals, which is the order they appear in the patch byte. **[C]** —
`VCFFilterTypes` / `VCFFilterTypesNames` in the manufacturer specification's reference source.

| Code | Name | Type | Slope | Notes |
|---:|---|---|---|---|
| 0 | LOW 1 | lowpass | 1-pole, 6 dB/oct | |
| 1 | LOW 2 | lowpass | 2-pole, 12 dB/oct | |
| 2 | LOW 3 | lowpass | 3-pole, 18 dB/oct | |
| 3 | LOW 4 | lowpass | 4-pole, 24 dB/oct | the conventional "analogue" voice |
| 4 | HIGH 1 | highpass | 1-pole, 6 dB/oct | |
| 5 | HIGH 2 | highpass | 2-pole, 12 dB/oct | |
| 6 | HIGH 3 | highpass | 3-pole, 18 dB/oct | |
| 7 | BAND 2 | bandpass | 2-pole, 6 dB/oct per side | |
| 8 | BAND 4 | bandpass | 4-pole, 12 dB/oct per side | |
| 9 | NOTCH 2 | band-reject | 2-pole | |
| 10 | PHASE 3 | allpass / phase shift | 3-pole | 3 poles of phase rotation, no magnitude change |
| 11 | HIGH 2 + LOW 1 | highpass 2-pole **plus** lowpass 1-pole in series | 12 dB/oct HP, 6 dB/oct LP | a wide bandpass with asymmetric skirts |
| 12 | HIGH 3 + LOW 1 | highpass 3-pole **plus** lowpass 1-pole | 18 / 6 | |
| 13 | NOTCH 2 + LOW 1 | 2-pole notch **plus** 1-pole lowpass | | |
| 14 | PHASE 3 + LOW 1 | 3-pole allpass **plus** 1-pole lowpass | | the "vocal"/comb-like mode |

**[C]** for the mode list and ordering; **[R]** for the slope figures, which come from the
secondary description of the same list ("one-, two-, three- and four-pole low pass; one-, two- and
three-pole high pass; two- and four-pole band pass; two-pole notch; three-pole phase shift; two-
and three-pole high pass plus one-pole low pass; two-pole notch plus one-pole low pass; three-pole
phase shift plus one-pole low pass").

### 4.2 Implementation notes

- The fifteen modes are **taps and sums off one 4-pole ladder-style structure**, not fifteen
  independent filters. Implement a single cascade of four one-pole sections with a state-variable
  or tap-mixing output stage, and express each mode as a set of tap coefficients. That is what
  makes the modes share a cutoff frequency and resonance character, and it is why the composite
  modes (11–14) exist at all — they are the cheap sums the topology allows.
- **Resonance behaviour differs per mode.** With fewer poles in the loop, the same RES value gives
  less peaking and the filter cannot self-oscillate in the 1- and 2-pole modes. Model the feedback
  around the *whole* cascade, not around the tap, and this falls out.
- **The allpass modes (10, 14) must not change magnitude.** If your tap-mixing produces a magnitude
  ripple in PHASE 3, the coefficients are wrong. The audible signature is a static, resonant
  colouration when combined with the dry signal elsewhere in the chain.
- **VCF FREQ is 7-bit while everything else is 6-bit.** Preserve that: a matrix routing to
  `VCF_FRQ` with amount ±63 spans a different proportion of the destination's range than the same
  amount into a 0..63 destination. This asymmetry is real and must survive into our parameter
  model. **[C]**
- Mode is a **stepped** parameter, not continuous, and is **not** in the destination list — you
  cannot modulate the filter type. **[C]**

---

## 5. Envelopes — five per voice

| Parameter | Range | Unit | Notes |
|---|---|---|---|
| DELAY | 0..63 | time | pre-attack delay |
| ATTACK | 0..63 | time | |
| DECAY | 0..63 | time | |
| SUSTAIN | 0..63 | level | |
| RELEASE | 0..63 | time | |
| AMP (amplitude) | 0..63 | level | overall envelope output scaling — also a matrix destination |
| LFO TRIG SOURCE | 0..5 | enum | LFO1..LFO5, VIB |

**[C]** — patch struct and editor parameter map. So the shape is **DADSR**, five segments, with a
separate output amplitude.

### 5.1 Modes and triggering — bit flags

| Bit | Name | Meaning |
|---:|---|---|
| 0x01 | RESET | envelope restarts from zero on trigger rather than from its current level |
| 0x02 | — | unused; present in the byte but not documented in the original specification |
| 0x04 | MULTI | multi trigger; when clear, single trigger |
| 0x08 | GATED | envelope follows the gate rather than running to completion |
| 0x10 | EXTRIG | triggered by the external trigger input |
| 0x20 | LFOTRIG | triggered by the LFO named in LFO TRIG SOURCE |
| 0x40 | DADR | **DADR mode** — no sustain segment; delay/attack/decay/release runs through |
| 0x80 | FREERUN | envelope runs to completion regardless of the gate |

**[C]** — `EnveloppeModeFlags`. Note bit 0x02 is flagged in the reference source as
"original MIDI SPEC did not mention this unused bit". Treat writing it as undefined.

These are **independent bits**, not a mode enum: FREERUN + GATED + DADR + LFOTRIG can coexist.
That combinatorial freedom is the point — an LFO-triggered, free-running DADR envelope is a
looping shape generator, and it is how the instrument produces evolving pads without a sequencer.

### 5.2 Trigger semantics

The instrument distinguishes **single** and **multi** triggers explicitly, and both are available
to every envelope and every LFO and ramp:

- A **single trigger** is generated when a voice that is not gated receives a note-on. The gate is
  then set active.
- A **multi trigger** is generated by any note-on to that voice, including while it is already
  gated, and also by note-offs received while the voice is not gated.
- Zones do **not** pass a note-on to an already-gated voice; they turn the playing voice off and
  re-gate it. **[C]**

Implement the trigger bus as two one-sample pulses per voice (single, multi) plus a level gate,
and let every envelope, ramp and LFO subscribe to whichever it wants. This is much simpler than
special-casing each generator and it is exactly the hardware's structure.

The **real-world time units** of the 0..63 time parameters are **[X]** — see §14.2.

---

## 6. LFOs — five per voice

| Parameter | Range | Notes |
|---|---|---|
| SPEED | 0..63 | also a matrix destination |
| WAVE | 0..6 | see below |
| SAMPLE INPUT | 0..26 | any modulation source, used by the SAMPLE waveform |
| RETRIG POINT | 0..63 | the phase the LFO resets to when retriggered |
| AMP (amplitude) | 0..63 | also a matrix destination |
| LAG | 0/1 | routes the LFO output through the lag processor |
| RETRIG MODE | 0..3 | OFF / SINGLE / MULTI / EXTRIG |

**[C]** — patch struct `lfo[5]` and editor parameter map.

### 6.1 Waveforms

| Code | Name | Notes |
|---:|---|---|
| 0 | TRIANGLE | |
| 1 | UP SAW | |
| 2 | DOWN SAW | |
| 3 | SQUARE | |
| 4 | RANDOM | stepped random, new value each cycle |
| 5 | NOISE | continuous noise, not stepped |
| 6 | **SAMPLE** | samples the source named in SAMPLE INPUT, at the LFO rate |

**[C]** — `WaveTypes`. Seven waveforms, not six.

**SAMPLE is the important one.** It turns the LFO into a general-purpose sample-and-hold clocked
at the LFO rate, whose input is *any of the 27 modulation sources* — including another LFO, an
envelope, a ramp, pressure, or a tracking generator. Sampling a triangle LFO gives stepped
vibrato; sampling pressure gives a "held" expression value; sampling a ramp gives a staircase.
Build this as a first-class feature of the LFO, not as a separate module.

**RETRIG POINT** is a phase, 0..63 over the cycle. Combined with RETRIG MODE it gives repeatable
LFO phase per note — necessary for percussive uses and for deterministic rendering in a DAW.
**[C]**

**LAG** per LFO routes that LFO through the shared lag processor, which is how a square LFO
becomes a slewed pulse. **[C]**

---

## 7. Ramps, tracking generators and the lag processor

### 7.1 Ramps — four per voice

| Parameter | Range | Notes |
|---|---|---|
| RATE | 0..63 | time to traverse the ramp |
| flags | bitfield | GATED 0x01, LFOTRIG 0x02, EXTRIG 0x04, MULTI 0x08 (SINGLE if clear) |
| LFO TRIG SOURCE | 0..5 | LFO1..LFO5, VIB |

**[C]** — patch struct `ramp[4]`, `RampFlags`.

A ramp is a single rising segment from 0 to full over RATE, retriggerable. Functionally it is a
one-segment envelope, and it exists because it is cheap: four of them give four independent
delayed-onset modulations (ramp a vibrato in, ramp a filter open) without spending an envelope.
GATED makes the ramp fall back when the gate releases; MULTI restarts it on every multi trigger.

### 7.2 Tracking generators — three per voice

| Parameter | Range | Notes |
|---|---|---|
| INPUT | 0..26 | any modulation source |
| POINT 1..5 | 0..63 each | output value at five equally spaced input points |

**[C]** — patch struct `track[3]`, editor parameter map (`TRACK_n_POINT_1..5`, each 0..63).

This is a **five-point piecewise-linear transfer function** applied to any source, whose output is
itself a modulation source (`TRK1`, `TRK2`, `TRK3`). Input is divided into four equal segments;
POINT 1 is the output at input minimum, POINT 5 the output at input maximum, and the generator
interpolates linearly between them.

What it buys, and what the UI must make obvious:

- **Non-linear keyboard tracking** — a curve rather than a slope, for filter tracking that is
  correct across the whole keyboard.
- **Inversion and folding** — points need not be monotone, so a source can be made to rise then
  fall.
- **Velocity curves** — remap velocity response without touching the matrix amount.

Draw it as an editable five-point curve. It is the second-most-important editor surface after the
matrix itself.

### 7.3 Lag processor — one per voice

| Parameter | Range | Notes |
|---|---|---|
| LAG IN | 0..26 | any modulation source |
| LAG RATE | 0..63 | slew rate; also a matrix destination (`LAG_SPD`) |
| LAG MODE | bitfield | LEGATO 0x01, EXPO 0x02, EQUAL TIME 0x04 |

**[C]** — patch struct `fm_lag`, `LagModeFlags`, editor parameter map.

- **LEGATO** — lag applies only when notes overlap, i.e. fingered portamento.
- **EXPO** — exponential slew instead of linear.
- **EQUAL TIME** — constant *time* rather than constant *rate*: every transition takes the same
  time regardless of distance. With it clear, a large interval takes proportionally longer.

Its output is the modulation source `LAG`, and `LAG` is also one of the four fixed per-oscillator
and per-filter enable bits (§3, §4), so lag can reach pitch without spending a matrix slot.

---

## 8. Vibrato — the global LFO

Stored in the **multi** patch, not the single patch, and gated per single patch by the VIB enable
bit on VCO 1, VCO 2 and VCF. **[C]**

| Parameter | Range | Notes |
|---|---|---|
| SPEED | 0..63 | |
| LAG | 0/1 | |
| WAVE | 0..6 | same waveform enum as the per-voice LFOs |
| AMP | 0..63 | |
| SPEED MOD SOURCE | OFF / LEV2 / PED2 | a restricted three-way source |
| AMP MOD SOURCE | OFF / LEV2 / PED2 | |
| SPEED MOD AMOUNT | −63..+63 | |
| AMP MOD AMOUNT | −63..+63 | |

**[C]** — `multiXpPatch.vib`, `vmodT`.

The design intent is a performance vibrato that behaves identically across a layered multi without
having to program it into each layer, driven from whichever physical controller is assigned to
LEVER 2 or PEDAL 2. Note that LEVER 2 and PEDAL 2 are **basic-channel-only, broadcast to all
voices**, while LEVER 1 and PEDAL 1 are **per-channel** (§10.2) — that asymmetry is precisely what
makes this work in a multi-timbral setup.

---

## 9. The modulation matrix

This is the instrument's identity. Build the editor from this section.

### 9.1 Capacity

| Property | Value | Confidence |
|---|---|---|
| Modulation sources | **27** | [C] |
| Modulation destinations | **47** | [C] |
| Simultaneous routings per patch | **20** | [C] |
| Maximum sources per single destination | **6** | [C] |
| Amount magnitude | 0..63 (6 bits) | [C] |
| Amount sign | separate bit | [C] |
| Quantise | separate bit, per routing | [C] |

**[C]** — `MODULATION_SOURCE_COUNT = 27`, `MODULATION_DEST_COUNT = 47`,
`MODULATION_MAX_ENTRIES = 20`, `MODULATION_VALUE_MASK = 0x3F`, `MODULATION_SIGN_MASK = 0x40`,
`MODULATION_QTZ_MASK = 0x80` in the manufacturer specification's reference source; and
`MAX_MODULATION_SOURCE = 6` in an editor built against it.

So a routing is **three bytes**: source code, packed amount/sign/quantise, destination code.
The 20 routings are stored as a flat array; there is no per-destination sub-structure in the data,
but the instrument enforces the ≤6-sources-per-destination limit when you add one.

### 9.2 Amount range and law

```
amount_magnitude = byte & 0x3F          // 0..63
negative         = byte & 0x40
quantise         = byte & 0x80
effective        = negative ? −magnitude : +magnitude       // −63 .. +63
```
**[C]**

The scaling is **linear** in the destination's own units: an amount of ±63 is full-scale
modulation of that destination, ±32 is half. **[U]** — the specification defines the storage but
not the transfer curve; linear is what an editor's continuous amount knob implies and what the
6-bit two's-complement-free encoding suggests, but it is not stated. Verify by measurement
(§11.5).

**QUANTISE** forces the modulation to move the destination in integer steps of the destination's
own unit rather than continuously. Its principal use is quantised pitch modulation — a sample-hold
LFO into VCO FREQ with quantise on gives semitone-stepped random pitch rather than a continuous
warble. **[C]** for the flag and its name; the exact quantisation grid is **[U]**.

Note there is **no 0 amount with a sign** distinction: amount 0 with either sign is off. An editor
should collapse them.

### 9.3 Complete source list — 27 sources

Codes are the enum ordinals, which are the values written in the patch byte and in the
"Add Modulation Source" / "Change Source" SysEx commands (documented range 0–26). **[C]** —
`ModulationSourcesFlags` / `ModulationSourcesFlagsNames`.

| Code | Name | Meaning | Kind |
|---:|---|---|---|
| 0 | KBD | keyboard note number | performance |
| 1 | LAG | output of the lag processor | processor |
| 2 | VEL | note-on velocity | performance |
| 3 | RVEL | release velocity | performance |
| 4 | PRES | channel pressure / aftertouch | performance |
| 5 | TRK1 | tracking generator 1 output | processor |
| 6 | TRK2 | tracking generator 2 output | processor |
| 7 | TRK3 | tracking generator 3 output | processor |
| 8 | RMP1 | ramp 1 | generator |
| 9 | RMP2 | ramp 2 | generator |
| 10 | RMP3 | ramp 3 | generator |
| 11 | RMP4 | ramp 4 | generator |
| 12 | ENV1 | envelope 1 | generator |
| 13 | ENV2 | envelope 2 | generator |
| 14 | ENV3 | envelope 3 | generator |
| 15 | ENV4 | envelope 4 | generator |
| 16 | ENV5 | envelope 5 | generator |
| 17 | PED1 | pedal 1 (per-channel) | performance |
| 18 | PED2 | pedal 2 (broadcast) | performance |
| 19 | LFO1 | LFO 1 | generator |
| 20 | LFO2 | LFO 2 | generator |
| 21 | LFO3 | LFO 3 | generator |
| 22 | LFO4 | LFO 4 | generator |
| 23 | LFO5 | LFO 5 | generator |
| 24 | VIB | the global vibrato LFO | generator |
| 25 | LEV1 | lever 1 (per-channel; default pitch bend) | performance |
| 26 | LEV2 | lever 2 (broadcast; default CC 1) | performance |

The same 0..26 enumeration is reused for **LAG IN**, **LFO SAMPLE INPUT** and **TRACK INPUT**.
**[C]** — those three parameters are declared with range `KBD .. LEV2` in the editor's parameter
map. That is a genuine architectural simplification for us: one source-selection widget, one
source-resolution function, used in four places.

### 9.4 Complete destination list — 47 destinations

Codes are the enum ordinals. **[C]** — `ModulationDestinationTypes` /
`ModulationDestinationsTypesNames`.

| Code | Name | Target | Native range |
|---:|---|---|---|
| 0 | VCO1 FRQ | oscillator 1 pitch | 0..63 |
| 1 | VCO1 PW | oscillator 1 pulse width | 0..63 |
| 2 | VCO1 VOL | oscillator 1 mixer level | 0..63 |
| 3 | VCO2 FRQ | oscillator 2 pitch | 0..63 |
| 4 | VCO2 PW | oscillator 2 pulse width | 0..63 |
| 5 | VCO2 VOL | oscillator 2 mixer level | 0..63 |
| 6 | VCF FRQ | filter cutoff | **0..127** |
| 7 | VCF RES | filter resonance | 0..63 |
| 8 | VCA1 VOL | pre-filter amplifier | 0..63 |
| 9 | VCA2 VOL | post-filter amplifier | 0..63 |
| 10 | LFO1 SPD | LFO 1 speed | 0..63 |
| 11 | LFO1 AMP | LFO 1 amplitude | 0..63 |
| 12 | LFO2 SPD | | 0..63 |
| 13 | LFO2 AMP | | 0..63 |
| 14 | LFO3 SPD | | 0..63 |
| 15 | LFO3 AMP | | 0..63 |
| 16 | LFO4 SPD | | 0..63 |
| 17 | LFO4 AMP | | 0..63 |
| 18 | LFO5 SPD | | 0..63 |
| 19 | LFO5 AMP | | 0..63 |
| 20 | ENV1 DLY | envelope 1 delay | 0..63 |
| 21 | ENV1 ATK | envelope 1 attack | 0..63 |
| 22 | ENV1 DCY | envelope 1 decay | 0..63 |
| 23 | ENV1 REL | envelope 1 release | 0..63 |
| 24 | ENV1 AMP | envelope 1 amplitude | 0..63 |
| 25 | ENV2 DLY | | 0..63 |
| 26 | ENV2 ATK | | 0..63 |
| 27 | ENV2 DCY | | 0..63 |
| 28 | ENV2 REL | | 0..63 |
| 29 | ENV2 AMP | | 0..63 |
| 30 | ENV3 DLY | | 0..63 |
| 31 | ENV3 ATK | | 0..63 |
| 32 | ENV3 DCY | | 0..63 |
| 33 | ENV3 REL | | 0..63 |
| 34 | ENV3 AMP | | 0..63 |
| 35 | ENV4 DLY | | 0..63 |
| 36 | ENV4 ATK | | 0..63 |
| 37 | ENV4 DCY | | 0..63 |
| 38 | ENV4 REL | | 0..63 |
| 39 | ENV4 AMP | | 0..63 |
| 40 | ENV5 DLY | | 0..63 |
| 41 | ENV5 ATK | | 0..63 |
| 42 | ENV5 DCY | | 0..63 |
| 43 | ENV5 REL | | 0..63 |
| 44 | ENV5 AMP | | 0..63 |
| 45 | FM AMP | audio-rate FM amount | 0..63 |
| 46 | LAG SPD | lag processor rate | 0..63 |

Things this list tells you that a summary would not:

- **Envelope SUSTAIN is not a destination.** Delay, attack, decay, release and amplitude are;
  sustain is not. Neither is envelope *mode*. **[C]**
- **Filter mode, oscillator waveform, sync, and every other switch are not destinations.** Only
  continuous parameters can be modulated. **[C]**
- **Ramp rates are not destinations** even though ramp *outputs* are sources — asymmetric with the
  LFOs and envelopes, whose rates *are* destinations. **[C]**
- **Pan, voice volume, transpose and detune are multi-patch parameters and are not in the
  per-voice destination list.** **[C]**
- There is no "matrix amount" destination: the matrix cannot modulate itself. Self-modulating
  behaviour is achieved indirectly, by routing into LFO/envelope parameters.

### 9.5 Fixed paths outside the matrix

Four modulations bypass the matrix entirely and are enabled by bit flags on VCO 1, VCO 2 and VCF:

| Flag | Name | Meaning |
|---:|---|---|
| 0x01 | KEYB | keyboard tracking of that parameter |
| 0x02 | LAG | lag-processor output to that parameter |
| 0x04 | LEV 1 | lever 1 (pitch bend) to that parameter |
| 0x08 | VIB | the global vibrato to that parameter |

**[C]** — `ModulationFlags`. These cost no matrix slots, which is why the 20-slot budget is
workable in practice. An editor must show them, because a patch whose pitch bends "for no reason"
is usually one with LEV 1 enabled here rather than routed in the matrix.

### 9.6 Editing protocol — implications for the editor

The instrument's own remote-edit protocol reveals its editing model, and it is a better model
than a flat 20-row table. **[C]** — "Modulation edit follows" SysEx command:

```
[<id> 00 <action> <val_lo> <val_hi>]
  <id>     0..5   which of the (up to six) modulations on the currently displayed destination
  <action> 00     add modulation source          value = source id 0..26
           01     delete modulation
           02     change source                  value = source id 0..26
           03     set value                      value = unsigned amount
           04     dial value                     value = relative change
           05     set quantise                    0 = off, 1 = on
           06     toggle quantise
           07     sign                            0 = "+", 1 = "−"
```

So the native mental model is **destination-centric**: you select a destination, and see up to six
(source, amount, sign, quantise) rows for it. The flat 20-entry array is the storage format, not
the editing format.

**Recommendation for the MotionLab matrix editor.** Provide both views over one model:

1. **Destination view** (the native one): pick a destination, see its ≤6 contributors, with a
   running count of the global 20-slot budget. This is where sound design actually happens.
2. **Matrix grid view**: sources on one axis, destinations on the other, occupied cells marked
   with signed amount. 27 × 47 = 1269 cells, of which at most 20 are occupied, so render it as a
   sparse, scrollable, filterable grid — not 1269 live widgets.
3. **Source view**: pick a source, see everywhere it goes. Needed for "what does the mod wheel do
   in this patch".

All three must enforce the two hard limits (20 total, 6 per destination) at the model layer and
surface them in the UI *before* the user runs out, because the instrument's own failure mode —
silently refusing a new routing — is the single most-complained-about aspect of programming it.
Show "17 / 20 routings, 4 / 6 on VCF FRQ" permanently.

---

## 10. Zones, splits, layers and multi-timbral behaviour

### 10.1 Zones

A **Zone** is a polyphonic note-assignment module. Per zone:

| Parameter | Values | Notes |
|---|---|---|
| Control source (channel) | MIDI channels 1..16 or OMNI | keyboard model may also use its own keyboard |
| Lower note limit | 1..127 | |
| Upper note limit | 1..127 | |
| Note assignment mode | ROTATE / REASSIGN / RESET / UNI LOW / UNI HIGH / UNI LAST | |
| Enables (keyboard model only) | CONTROLLERS, KEYBOARD, VOICE ROB, MIDI OUT, MIDI IN | bit flags |

**[C]** — `zone[6]`, `nassT`, `zonefT`, and the overview text.

Six zones on the keyboard model, three on the expander. **[C]** Zone ranges may **overlap**, which
is exactly how layers are made: two zones with identical limits and different voice assignments
give a two-layer sound; adjacent non-overlapping limits give a split; partial overlap gives a
crossfade-free "both sounds in the middle" region.

Assignment modes:

- **ROTATE** — cycle through the zone's voices, so repeated notes land on fresh voices and
  releases ring.
- **REASSIGN** — reuse the same voice for the same note; chords spread across voices.
- **RESET** — always start from the first voice of the zone.
- **UNI LOW / UNI HIGH / UNI LAST** — unison: all the zone's voices play one note, chosen as the
  lowest / highest / most recent held key.

**Voice-stealing rule:** a zone will **not** pass a note-on to an already-gated voice. It turns
that voice off and re-gates it. **[C]** This is a hard requirement for parity — a naive
"steal the oldest" allocator produces different retrigger behaviour and audibly different unison
handling.

### 10.2 Per-voice multi-patch parameters

| Parameter | Range | Notes |
|---|---|---|
| Transpose | signed | per voice |
| Volume | 0..63 | per voice |
| Pan | LEFT, LF2, LF1, MID, RT1, RT2, RIGHT, OFF | **8 stepped positions**, not continuous |
| Detune | −31..+31 | per voice |
| Voice assign | ZONE1..ZONE6 or CHAN1..CHAN16 | which zone or raw MIDI channel drives this voice |

**[C]** — `bankM12[2]`, `panT`, `vassT`. The keyboard model stores this as **two banks of six**;
the expander stores one bank of six with a `cvmidi[6]` control-source array instead.

**Pan is a 3-bit stepped control with an OFF position**, not a continuous pot. Reproduce the eight
positions; a continuous pan is a deviation and should be offered, if at all, as an explicit
"extended" mode.

### 10.3 Controller assignment

- **LEVER 1** — default: channel pitch bend. **Per channel.**
- **LEVER 2** — default: CC 1. **Basic channel only, broadcast to all voices.**
- **PEDAL 1** — default: the hardware pedal 1 input. **Per channel.**
- **PEDAL 2** — default: the hardware pedal 2 input. **Basic channel only, broadcast.**
- **PRESSURE** — default: channel pressure.

Any of these may be reassigned to any MIDI controller 0–121; lever 2 may additionally be assigned
to channel pitch bend. **[C]**

The per-channel/broadcast split is the mechanism that makes independent per-zone pitch bend
coexist with a global modulation wheel. **It is also, in modern terms, a proto-MPE design** — a
per-note-channel dimension plus a zone-wide dimension. When we wire this instrument to MPE input
(see `std-01-mpe-midi2.md`), map MPE member-channel pitch bend to LEVER 1, channel pressure to
PRESSURE, and CC 74 to a user-selectable source; map master-channel controllers to LEVER 2 /
PEDAL 2. That mapping is architecturally exact, not an approximation.

### 10.4 Velocity scaling

The instrument offers four global velocity curves: **LINEAR**, **EXPO 1** (input 1 → output 1,
input 127 → output 255), **EXPO 2** (same but full output range spans input 16..120, for
controllers with limited velocity range), and **EXPO 3** (keyboard model only, "similar to the
other EXPO modes with linear response in the normal playing range"). **[C]**

Note the internal velocity resolution is **8-bit (0..255)**, not 7-bit. **[C]**

---

## 11. Verification — tests QA should run

| # | Test | Method | Target | Tolerance |
|---|---|---|---|---|
| 11.1 | **Filter mode inventory** | Sweep VCF MODE 0..14 with a white-noise source, RES 0, measure the magnitude response. | 15 distinct responses matching the type/slope column of §4.1; slopes within 1 dB/oct of nominal over a decade | ±1 dB/oct |
| 11.2 | **Allpass magnitude flatness** | Modes 10 and 14, white noise, RES 0 and RES 40. | mode 10 flat within ±0.5 dB across 20 Hz–20 kHz; mode 14 shows only the 1-pole LP rolloff | ±0.5 dB |
| 11.3 | **Resonance per pole count** | Modes 0..3, RES 0..63, measure peak gain at cutoff. | monotone increase with pole count; no self-oscillation in modes 0 and 1 at RES 63 | binary + record |
| 11.4 | **Filter cutoff resolution** | Step VCF FREQ 0..127 one unit at a time, measure −3 dB point. | 128 distinct cutoffs, monotone | exact count |
| 11.5 | **Matrix amount law** | One source (a static pedal at full), one destination (VCF FRQ), sweep amount −63..+63, measure cutoff. | monotone, symmetric about 0, and linear in the destination's native units — **this test defines the [U] in §9.2** | ±2 % of full scale from a straight line |
| 11.6 | **Matrix capacity limits** | Attempt a 21st routing; attempt a 7th source on one destination. | both refused, with a UI message, at the model layer | binary |
| 11.7 | **Matrix summation** | Route three sources to VCF FRQ at +21 each, all at full. | result equals the single-source +63 case | ±1 % |
| 11.8 | **Quantise flag** | Sample-and-hold LFO → VCO1 FRQ, amount +63, quantise on and off. | quantise-on output moves in discrete steps; record the step size and **resolve the [U] in §9.2** | n/a — defines the constant |
| 11.9 | **Tracking generator** | TRACK 1 input = KBD, points 0/63/0/63/0, route TRK1 → VCF FRQ. | cutoff traces the specified zig-zag with linear interpolation between the five points | ±2 % |
| 11.10 | **LFO SAMPLE waveform** | LFO 1 wave = SAMPLE, sample input = LFO 2 (triangle, slow), LFO 1 speed fast. | LFO 1 output is a staircase following LFO 2 | qualitative + step count |
| 11.11 | **LFO retrigger phase** | RETRIG MODE = SINGLE, RETRIG POINT = 0, 16, 32, 48; capture the first 100 ms after note-on, ten times. | identical each time; starting phase matches the retrigger point | sample-exact |
| 11.12 | **Envelope DADR mode** | DADR bit set, hold a key past the decay. | no sustain segment; envelope proceeds to release while the key is held | binary |
| 11.13 | **Envelope FREERUN** | FREERUN set, release the key during attack. | envelope completes regardless | binary |
| 11.14 | **LFO-triggered envelope loop** | LFOTRIG + FREERUN + DADR, LFO 1 at 2 Hz. | envelope retriggers at 2 Hz indefinitely | ±1 % on period |
| 11.15 | **Trigger semantics** | Overlapping notes to one voice; legato and staccato. | single trigger only on the first note of a gate; multi trigger on every note-on and on note-offs while ungated | binary, per §5.2 |
| 11.16 | **Zone voice stealing** | Two zones, overlapping ranges; play a note already sounding in a zone. | the sounding voice is gated off and re-gated, not layered | binary |
| 11.17 | **Unison modes** | UNI LOW / UNI HIGH / UNI LAST with a three-note chord held, then released one at a time. | pitch follows lowest / highest / most recently pressed held key | binary |
| 11.18 | **Pan positions** | Sweep pan through all eight values, measure L/R balance. | 7 discrete positions plus OFF; symmetric about MID | ±0.5 dB |
| 11.19 | **Lag EQUAL TIME** | LAG MODE with and without EQUAL TIME; glide a semitone and an octave. | with the flag, both take the same time; without, the octave takes ~12× longer | ±5 % |
| 11.20 | **Velocity curves** | LINEAR / EXPO 1 / EXPO 2, sweep velocity 1..127. | 8-bit internal output; EXPO 1 maps 1→1 and 127→255; EXPO 2 reaches full output at input 120 | ±2 LSB |
| 11.21 | **Patch import round-trip** | Import a 399-byte single-patch dump, export, compare. | byte-identical | exact |
| 11.22 | **CPU budget** | 12 voices, 5 envelopes + 5 LFOs + 4 ramps + 3 tracking generators + 20 routings all active. | within the per-instrument budget in `docs/PERFORMANCE.md` | per that document |

Test 11.5 and 11.8 are the two that convert [U] values in this sheet into [C] values. Run them
first; several other tests' expected results depend on their outcome.

---

## 12. Sources

Primary, read directly in this session:

- **Matrix-12/Xpander MIDI Specification**, the manufacturer's own document (a consolidation of
  three original plain-text specification files), together with its accompanying reference C
  source `XpanderSysEx.h`, which contains the patch structure, the fifteen filter-mode names, the
  27 modulation-source enumeration, the 47 modulation-destination enumeration, the envelope/ramp/
  LFO flag bitfields, the multi-patch and zone structures, and the modulation-edit SysEx protocol.
  Cloned from <https://github.com/xplorer2716/OberheimXpanderMidiSpec>. This is the source of
  every [C] in §§2–10 unless another is named.
- **Xplorer**, a GPL-3.0 real-time editor built against that specification, cloned from
  <https://github.com/xplorer2716/XplorerEditor>. Read for the exact parameter ranges
  (`XpanderToneFixedParameters.inc`, `XpanderTone.cpp`) and the capacity constants
  (`XpanderConstants.hpp`: `MODENTRIES_COUNT = 20`, `MAX_MODULATION_SOURCE = 6`, `LFO_COUNT = 5`,
  `ENV_COUNT = 5`, `TRACK_COUNT = 3`, `TRACK_POINTS_COUNTS = 5`, `RAMP_COUNT = 4`) and the amount
  bounds (`ModulationMatrixEntry::MAX_AMOUNT = 63`).

Secondary, via search-engine extraction:

- Manufacturer owner's manual, via ManualsLib page extracts — filter pole discussion.
  <https://www.manualslib.com/manual/803278/Oberheim-Matrix-12.html>
- Wikipedia, Oberheim Xpander and Oberheim Matrix synthesizers — 27 sources / 47 destinations /
  20 routings, the fifteen filter modes enumerated with slopes, two VCOs with FM of VCO 1 by
  VCO 2, five envelopes and five LFOs, the tracking generator's piecewise-linear description.
  <https://en.wikipedia.org/wiki/Oberheim_Xpander>,
  <https://en.wikipedia.org/wiki/Oberheim_Matrix_synthesizers>
- MATRIXSYNTH, "15 Filter Types of the Oberheim Matrix-12/Xpander" — the mode list in prose.
  <https://www.matrixsynth.com/2016/07/15-filter-types-of-oberheim-matrix.html>
- Perfect Circuit, "Oberheim Matrix-12 Analog Polyphonic Synthesizer" — 27/47/20 confirmation,
  six zones, splits and layers, the multi mode description.
  <https://www.perfectcircuit.com/signal/oberheim-matrix-12>
- Sound On Sound, Oberheim Xpander review — voice architecture, VCA ordering.
  <https://www.soundonsound.com/reviews/oberheim-xpander>
- MATRIXSYNTH display-replacement article and Benden Sound Technology's display upgrade page —
  three 40-character vacuum-fluorescent displays on the keyboard model.
  <https://www.matrixsynth.com/2008/11/ob-vfd-oberheim-matrix-12-display.html>
- muzines archive, contemporary 1985 magazine reviews — 61 keys, 12 voices, "two expanders in one
  chassis". <https://www.muzines.co.uk/articles/oberheim-matrix-12/9052>

---

## 13. UI era language (1984–1986 analogue-digital hybrid workstation)

For the UI team. This describes the *period vocabulary*, not any specific product's trade dress.
Nothing here licenses copying a panel layout, a logotype, a typeface, or a badge.

**Control taxonomy.** This is the *paged soft-control* idiom, and it is a different design
language from the membrane-and-slider digital instruments of the same years (compare
`syn-04-six-op-fm.md` §14):

- a **row of six continuous rotary encoders**, unlabelled, whose meaning is given by the display
  directly above or below them;
- a **matrix of page-select keys**, arranged in labelled functional families (oscillators, filter,
  envelopes, LFOs, modulation) rather than in one undifferentiated grid;
- **page-modifier keys** that step between sub-pages of the current page, so a page is a row of at
  most six parameters and everything deeper is a second page;
- an **illuminated indicator per key**, so the panel shows its own state.

Around 1200 parameters reach the user through six knobs. The whole design is a lesson in
"the display names the control".

**Layout logic.** Wide, low, rack-or-console proportions. Horizontal bands: displays and their
six encoders across the upper centre; page-select families below them, grouped by thin printed
rules and by family; performance controls (levers, master volume) at the far left near the
keyboard. Strong left-to-right reading order following signal flow: source → filter → amplifier →
modulation.

**Display technology.** **Vacuum-fluorescent, not LCD.** Multiple single-line displays of about 40
characters each (three of them on the keyboard model), each associated with a band of controls.
The VFD's characteristics are the era-defining ones: emissive rather than reflective, very high
contrast, wide viewing angle, visible phosphor bloom, and a slight blue-green fringe on a
predominantly cyan-white or amber glyph. Character cells with visible inter-segment gaps.

Our equivalent: a fixed-pitch, emissive-looking character field on a near-black ground, with a
subtle glow/bloom, one line per control band. Do **not** render it as a modern flat monochrome
LCD, and do not put graphics in it — the whole idiom is that the display holds six short parameter
names and six numbers, aligned above six knobs.

**Colour temperature.** Panel: near-black or very dark warm grey, matt (roughly L\* 15–20),
with light legends. Display glow: cyan-white around 6500–8000 K with a green-cyan halo, or amber
around 2000 K on some units — pick one and commit; do not mix. Indicator LEDs: a single saturated
red or amber, used only for "this page/parameter is selected" and for the modulation-present dot.
The overall impression is dark panel, bright text, one accent — the inverse of the light-grey
digital instruments of the same period.

**Typography.** Small, condensed, all-caps grotesque for panel legends, in a single weight, light
on dark. The display itself is a 5×7 or 5×8 character matrix; use real character-cell metrics.

**What to evoke, concretely, in an original design.** Six knobs under a character strip; page
families rather than a uniform key grid; a dark panel with a bright emissive strip; a "modulation
present" indicator on every modulatable parameter (the hardware's "mod dot", which is how a player
discovers what is already routed); and a matrix editor that is destination-centric with a running
budget readout. The matrix grid visualisation itself should be our own design — the *data* is in
§9, the *drawing* must be ours.

---

## 14. Not confirmed, and conflicts

1. **"Dual multimode filters".** The brief specifies two filters per voice. The primary source
   shows **one** VCF per voice (one `vcf` struct, one `fmode` byte, one `VCF_FRQ` and one
   `VCF_RES` destination) plus **two VCAs** in series around it. Secondary sources are consistent
   with that and describe the twelve-voice model as two six-voice boards in one chassis, and one
   describes "fifteen VCAs" per voice, which is a different counting (the matrix's own multipliers)
   and should not be read as fifteen audio amplifiers. I have specified one filter and two VCAs.
   **Confirm with the product owner before implementation begins**, since a two-filter voice would
   be a substantial architectural difference.
2. **Real-world units for every 0..63 control.** VCO FREQ, DETUNE, LFO SPEED, all envelope times
   and the lag rate are specified only as 0..63 integers in every source I could reach. The
   owner's manual would give the ranges in Hz, cents and seconds, and it is not fetchable from
   this environment. **[X]** — this is the single biggest gap in this sheet. Either obtain the
   owner's manual through a channel that is not blocked, or measure against hardware, before the
   sound-design pass. Do not invent taper curves.
3. **Matrix amount transfer law.** Storage is documented (6-bit magnitude + sign); the curve is
   not. Assumed linear. **[U]** — test 11.5.
4. **Quantise grid.** The flag is documented, the step size is not. **[U]** — test 11.8.
5. **Sync master/slave.** The SYNC flag lives on VCO 2, implying VCO 1 is the master. **[U]**
6. **Zone page count.** The page-number table lists Zone 1–5 for the keyboard model (pages 80–84)
   while the patch structure declares six zones. Either page 85 is omitted from the table or the
   sixth zone is reached differently. The structure is the better evidence, so I have specified
   six zones. **[U]** on the page mapping only.
7. **Number of displays on the expander model.** Three are documented for the keyboard model.
   **[X]** for the expander.
8. **Envelope segment curve shapes.** Whether attack/decay/release are linear or exponential in
   the hardware is not stated in any source I reached. The lag processor has an explicit EXPO
   flag, which suggests the envelopes may be linear by default — but that is inference. **[X]**
9. **Filter self-oscillation.** Whether the 4-pole low-pass self-oscillates at maximum resonance
   is not stated in the sources I reached. **[X]** — test 11.3 records it.
10. **Keyboard velocity and pressure sensing on the keyboard model.** The velocity curve options
    and the internal 8-bit velocity resolution are documented; whether the keyboard itself sends
    polyphonic or channel pressure is **[X]**. The modulation source list has only `PRES`
    (singular), which implies channel pressure.
11. **Unused envelope flag bit 0x02.** Documented in the reference source as absent from the
    original specification. Behaviour when set is **[X]**.
