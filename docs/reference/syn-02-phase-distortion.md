# Reference spec — SYN-02 Phase-distortion synth (eight-voice, dual-line, 8-stage envelopes)

Status: **research complete, ready to implement against**. Author: Research Analyst.
Class of device: eight-voice digital synthesiser using phase-distortion oscillators, two
independent DCO→DCW→DCA "lines" per voice, six eight-stage envelopes per voice, ring and
noise modulation. The reference instruments for behaviour research are the Casio **CZ-101**
and **CZ-1000** (1984, identical engines, different keybeds) and their larger siblings
**CZ-3000 / CZ-5000 / CZ-1**.

## 0. How to read this document

Confidence markers are the same set used elsewhere in `docs/reference/`:

- **[C]** confirmed — vendor documentation, the published MIDI/system-exclusive
  specification, or a formula derived analytically here from a cited implementation.
- **[R]** reported — reputable secondary source, not cross-checked against the manual.
- **[U]** unconfirmed. **Do not build to a [U] claim.**
- **[I]** inference or our own design decision.

**Sourcing constraint.** As with SYN-01, no PDF manual or archive page is reachable: the
egress proxy blocks WebFetch and refuses `curl` at the CONNECT tunnel. Search extraction and
anonymous `git` reads of public GitHub repositories were the two working channels. This
sheet is unusually well-sourced despite that, for two reasons: the instrument's complete
patch format is published as a system-exclusive specification and was read in full from a
repository, and the eight oscillator algorithms exist as exact, readable mathematics in the
Faust standard oscillator library, which was also cloned and read. §3 below is therefore
mathematics rather than description, and can be coded from directly.

**Intellectual-property rule for this file.** Manufacturer and model names appear because
this is an internal research note. They must **never** appear in shipped UI strings, code
identifiers, filenames, preset names, or marketing copy. No panel artwork, logo, typeface
or badge is described here and none may be traced. §12 describes the **era's** design
language — the vocabulary of mid-1980s digital synthesisers as a class — which is what the
UI team may evoke. Nothing here was obtained by decompilation or asset extraction. The
oscillator mathematics in §3 is taken from an open-source (MIT/STK-licensed) library
implementation and from published descriptions of the technique, not from firmware.

---

## 1. What phase distortion actually is

Phase distortion is a **waveshaping applied to the phase accumulator of a direct-digital
oscillator**, not to its output. That distinction is the whole technique and every
implementation decision follows from it.

A conventional DDS oscillator holds a phase accumulator `φ` that advances by a fixed
increment each sample, wraps at 1.0, and indexes a sine table:

```
    φ ← frac(φ + f/fs)
    out = cos(2π·φ)
```

A phase-distortion oscillator inserts one function between the accumulator and the table:

```
    φ ← frac(φ + f/fs)          ← the accumulator still advances linearly
    Φ = D(φ)                    ← a monotonic warp, D(0)=0, D(1)=1
    out = cos(2π·Φ)
```

`D` is monotonically increasing and satisfies `D(0) = 0`, `D(1) = 1`. Those two boundary
conditions are why the technique works and why it was patentable around a competitor's FM
patents: because `D` maps a full cycle onto a full cycle, **the output period is exactly the
input period**, so the pitch is unaffected no matter how violently the phase is bent. The
accumulator rushes through some parts of the cycle and crawls through others; the sine table
is read fast where the accumulator rushes and slow where it crawls; the result is a
waveform that still repeats at the fundamental but has acquired upper harmonics. [C]

Three consequences that matter for implementation:

1. **The harmonic series is always complete and always harmonic.** Unlike FM, which produces
   sidebands that can be inharmonic, PD produces only integer harmonics of the fundamental
   because the period is exactly preserved. This is why the technique sounds "subtractive"
   rather than "metallic" even though it is digital and additive-free.
2. **There is no filter anywhere in this instrument.** The brightness control is the shape
   of `D`. This is the single hardest thing for a synthesis engineer used to
   subtractive architectures to internalise: there is nothing to model as a filter, and
   adding one would change the instrument.
3. **`D` is piecewise linear in every one of the eight algorithms.** Its breakpoints are the
   only state. A piecewise-linear phase warp has a discontinuous derivative, which is a
   slope discontinuity in the output — and that is the source of both the instrument's
   brightness and its aliasing (§8).

The parameter that sets how bent `D` is called **DCW** — "digitally controlled wave". It
occupies exactly the position that filter cutoff occupies in a subtractive synth, both
functionally and in the patch structure. [C]

---

## 2. Voice architecture

### 2.1 Signal path

```
   ┌──────────────────────── one voice ────────────────────────────────┐
   │                                                                   │
   │  LINE 1                                                           │
   │  ┌──────────┐   ┌──────────┐   ┌──────────┐                       │
   │  │  DCO 1   │──▶│  DCW 1   │──▶│  DCA 1   │───┐                   │
   │  │ 2 wave   │   │ phase    │   │ level    │   │                   │
   │  │ slots,   │   │ warp amt │   │          │   │                   │
   │  │ alternat.│   └────▲─────┘   └────▲─────┘   │                   │
   │  └────▲─────┘        │              │         │                   │
   │       │              │              │         ├──▶ voice out      │
   │  ┌────┴─────┐   ┌────┴─────┐   ┌────┴─────┐   │                   │
   │  │ DCO1 env │   │ DCW1 env │   │ DCA1 env │   │                   │
   │  │ 8 stage  │   │ 8 stage  │   │ 8 stage  │   │                   │
   │  └──────────┘   └──────────┘   └──────────┘   │                   │
   │                                               │                   │
   │  LINE 2  (identical structure, own 3 envelopes)                   │
   │  ┌──────────┐   ┌──────────┐   ┌──────────┐   │                   │
   │  │  DCO 2   │──▶│  DCW 2   │──▶│  DCA 2   │───┘                   │
   │  └──────────┘   └──────────┘   └──────────┘                       │
   │                                                                   │
   │  MODULATION (one setting per patch, stored in line 1's word):     │
   │      NONE  |  RING  (line1 × line2)  |  NOISE                     │
   └───────────────────────────────────────────────────────────────────┘

   Common to all voices:  VIBRATO LFO (wave, rate, depth, delay)
                          PORTAMENTO (on/off, time)
                          PITCH BEND (range 0…12 semitones)
                          MASTER TUNE, KEY TRANSPOSE, OCTAVE, DETUNE
```

**Six eight-stage envelopes per voice.** That is not a typo and it is the instrument's
defining extravagance: DCO, DCW and DCA each get an independent eight-stage envelope, and
there are two lines. 48 rate/level pairs per patch. [C] — confirmed from the patch dump
structure, which allocates 16 bytes (8 × rate/level) plus one end-step byte to each of six
envelopes.

**There is no filter, no resonance control, no LFO routing matrix and no velocity.** The
keyboard does not send velocity; note velocity is always transmitted and received as 64.
[C] Everything expressive comes from the envelopes.

### 2.2 The four line modes

Stored as a 2-bit field. [C]

| Code | Mode | What sounds | Polyphony |
| --- | --- | --- | --- |
| `00` | **1** | Line 1 only | 8 voices |
| `01` | **2** | Line 2 only | 8 voices |
| `10` | **1 + 1′** | Line 1, plus a **detuned copy of line 1** | 4 voices |
| `11` | **1 + 2′** | Line 1, plus a **detuned line 2** | 4 voices |

The primed member of a pair is the one the **detune** parameter offsets; the unprimed one
plays at the nominal pitch. Both members of a pair consume a voice, so the stacked modes
halve polyphony from eight to four. [C]

**A conflict with the brief.** The task description lists the modes as "1+1′, 2+2′". The
published patch format for the CZ-101/1000/5000 unambiguously encodes `11` as **1+2′**, not
2+2′. Two readings are possible: either the brief is a paraphrase error, or a different
model in the family (the CZ-1, whose format was not read here) offers 2+2′. **Build 1, 2,
1+1′, 1+2′** — that set is [C] from the patch format — and flag 2+2′ as [U] pending a look
at the larger models' documentation.

### 2.3 Two waveforms per DCO, played in alternation

Each DCO has **two** waveform slots, not one. The patch word encodes a "first" and a
"second" waveform, each chosen from the eight. [C]

The crucial detail: the two waveforms are **not mixed in parallel**. The oscillator plays
one waveform for a cycle and then the other, alternating — the combination is in **series
(time), not in parallel (amplitude)**. [R] This produces a waveform whose true period is two
fundamental cycles, i.e. it introduces content at **f/2** and its odd multiples, which is
audibly a different thing from a crossfade and is why the paired waveforms sound rough and
buzzy rather than merely brighter.

Constraint from the hardware: a pair may combine **two non-resonant** waveforms, or **one
resonant with one non-resonant**, but **not two resonant** waveforms. [R] Enforce this in
the UI as a disabled state rather than as an error.

The waveform word also carries the ring/noise modulation selector, and only line 1's copy of
it is read — line 2's modulation bits are ignored by the hardware. [C] Model modulation as a
single per-patch enumeration, not as a per-line property.

---

## 3. The eight waveforms, as mathematics

This section is the reason the sheet exists. Everything below is exact and can be coded
directly. `φ` ∈ [0,1) is the linear accumulator phase; `d` ∈ [0,1] is the normalised DCW
amount (the instrument's 0…99 mapped to 0…1); the output is a cosine, so **every waveform
starts at +1**, not at zero — this matters for note-on click behaviour (§8.3).

These formulas are the algebraic simplification of the CZ oscillator set in the Faust
standard oscillator library, which credits Mike Moser-Booth's analysis and is
MIT/STK-licensed. Each was verified here to reduce to a pure cosine at `d = 0`, which is the
documented behaviour of DCW at minimum. [C]

### 3.1 The five phase-distortion waveforms

All five share one primitive: a **bilinear phase map** with a single breakpoint `k`.

```
    bilinear(φ, k) =  0.5 · φ / k                    for φ <  k
                      0.5 + 0.5 · (φ − k)/(1 − k)    for φ ≥ k
```

This maps [0,1] onto [0,1] and sends `φ = k` to `Φ = 0.5`. At `k = 0.5` it is the identity.
As `k → 0` the first half of the cosine is compressed into a vanishing fraction of the
period and the second half is stretched over the rest.

**Waveform 1 — Sawtooth.**

```
    k = clamp(0.5 − d/2, 0.01, 0.5)
    Φ = bilinear(φ, k)
    out = cos(2π · Φ)
```

At `d = 0`, `k = 0.5`, `Φ = φ`, output is a cosine. At `d = 1`, `k = 0.01`: the cosine
falls from +1 to −1 in the first 1 % of the period and then rises slowly back over the
remaining 99 %, which is a sawtooth with a rounded corner. The spectrum fills in
monotonically as `d` rises, which is what makes DCW read as a filter sweep. [C]

**Waveform 2 — Square.**

```
    i = clamp(d^0.25, 0, 1)
    u = frac(2φ)                       ← double-rate ramp
    h = (φ ≥ 0.5) ? 1 : 0              ← which half-cycle
    Φ = (u < i) ? 0 : (u − i)/(1 − i)
    out = cos(π · (h + Φ))
```

The phase is **frozen** for the first fraction `i` of each half-cycle and then swept through
a half-period of cosine over the remainder. Freezing the phase at the top or bottom of the
cosine flattens the peaks, so this is a sine with progressively flatter tops and bottoms,
reaching a true square at `d = 1`. Note the **fourth-root taper** on the index: this
waveform reaches recognisable squareness at low DCW values, much earlier in the sweep than
the sawtooth does. That taper is part of the algorithm, not a UI decision. [C]

**Waveform 3 — Pulse.**

```
    i = clamp(d, 0, 0.99)
    Φ = (φ < i) ? 0 : (φ − i)/(1 − i)
    out = cos(2π · Φ)
```

The same freeze-then-sweep structure, but applied once per **full** cycle rather than once
per half-cycle. The output sits at DC (+1) for a fraction `i` of the period and then
executes one complete cosine cycle in the remaining `1 − i`. That is a pulse train whose
duty cycle narrows as DCW rises — and because the "pulse" is a whole cosine cycle rather
than a rectangle, it is band-limited in a way a true rectangle is not. [C]

**Waveform 4 — Double sine.**

```
    k = clamp(0.5 − 0.49·d, 0.01, 0.5)
    Φ = bilinear(φ, k)
    out = cos(4π · Φ)                  ← note 4π, two cosine cycles per period
```

Identical phase map to the sawtooth, but the table is read **twice** per period. At `d = 0`
the output is a clean cosine at **twice** the fundamental — the fundamental itself is
absent. As `d` rises the two cycles become unequal in duration, which reintroduces the
fundamental and everything between. This is the only waveform whose `d = 0` state is not the
nominal pitch, and the UI must not describe it as "sine". [C]

**Waveform 5 — Half sine (also called saw-pulse).**

```
    k = clamp(0.5 − d/2, 0.01, 0.5)
    Φ = (φ < 0.5) ? φ : min(1, 0.5 + 0.5·(φ − 0.5)/k)
    out = cos(2π · Φ)
```

Asymmetric by construction: the **first** half of the cycle is read at normal speed, the
**second** half is compressed into a window of width `k` and the phase then holds at 1.0
(output +1) for whatever remains. At `d = 0`, `k = 0.5` and this reduces to the identity. The
result is one clean sine lobe followed by a fast blip and a DC rest, which gives it a
hollow, clarinet-adjacent character quite unlike the other four. [C]

### 3.2 The three resonant waveforms

These do **not** work by phase distortion at all, and calling them "PD waveforms" is a
category error that will produce a wrong implementation. They are **windowed hard sync**:
a sine oscillator running at some multiple of the fundamental, reset to zero phase at the
start of every fundamental period, and amplitude-modulated by a window function locked to
the fundamental. The audible result is a decaying "ping" once per period, which is what a
sharply resonant filter does when excited by a pulse train — hence the name. [C]

For these three the DCW parameter does **not** control brightness. It controls `r`, the
**ratio of the resonant frequency to the fundamental** (`r ≥ 1`), which is to say it moves
the simulated resonant peak up and down the spectrum exactly as a filter cutoff would. [C]

Let `s = sin(2π · frac(r · φ))` and `c = cos(2π · frac(r · φ))` — the hard-synced resonator,
reset every fundamental period because `φ` wraps.

**Waveform 6 — Resonant sawtooth.** Window is a falling ramp.

```
    out = 1 − (1 − φ) · (1 − c)
```

Equivalently: a raised-cosine resonator `(1−c)/2` scaled by the descending ramp `(1−φ)` and
offset to end at unity. The ping is loudest immediately after the sync reset and decays
linearly to nothing by the end of the period.

**Waveform 7 — Resonant triangle.** Window is a triangle, peaking mid-period.

```
    tri(φ) = (φ < 0.5) ? 2φ : 2 − 2φ
    out = tri(φ) · (1 + c) − 1
```

The resonance swells and falls within each period rather than decaying from the reset,
which gives it a softer, more vocal attack than waveform 6.

**Waveform 8 — Resonant trapezoid.** Window is flat then falling.

```
    out = min(2·(1 − φ), 1) · s
```

Full amplitude for the first half of the period, then a linear fall to zero. The flat
section makes this the loudest and most sustained of the three.

Note that waveform 8 uses `sin` where 6 and 7 use `cos`; that is a phase convention in the
source implementation, and whether the hardware matches it is [U]. It changes the waveform's
start-of-period value from +1 to 0 and is therefore worth checking against a real
instrument (§11, test V-9).

### 3.3 DCW range and mapping

| Waveform group | DCW 0…99 means | At DCW = 0 | At DCW = 99 |
| --- | --- | --- | --- |
| 1–5 (phase distortion) | Depth of the phase warp | Pure cosine at the fundamental (waveform 4: at 2×) | Fully-formed named shape |
| 6–8 (resonant) | Resonant frequency as a multiple `r` of the fundamental | `r = 1` — resonator at the fundamental, minimal effect | `r = r_max` |

`r_max` is **unknown**. The Faust implementation takes `r` as a free parameter with no
documented ceiling. For a first implementation use `r = 1 + 31·(DCW/99)`, i.e. up to 32×,
which puts the top of the sweep around 5 octaves above the fundamental — comparable to a
filter cutoff range. **[I], and one of the two most important things for QA to bracket.**

There is **no DCW knob** on the instrument. DCW's value at any moment is entirely the output
of its eight-stage envelope, optionally scaled by key follow. [C] This is a genuine
architectural difference from every subtractive synth: the "cutoff" has no static setting,
only an envelope. Our UI must not invent a DCW knob — but it must make the DCW envelope's
sustain level extremely easy to reach, because that level is what a player thinks of as
"the brightness of this patch".

---

## 4. The eight-stage envelopes

### 4.1 Structure

An envelope is **eight (rate, level) pairs plus an end-step pointer**, with per-step flags.
[C] Read from the published patch dump format:

| Field | Size | Meaning |
| --- | --- | --- |
| End step | 1 byte, values 0–7 | Which of the eight steps is the **last**. Steps beyond it are unused. |
| Steps | 8 × (rate, level) | The envelope proper |
| Direction flag | bit 0x80 on the **rate** byte | Set if the level **falls** during this step |
| Sustain flag | bit 0x80 on the **level** byte | This step is the sustain point |

Semantics:

- **Rate is a speed, not a duration.** A step's rate says how fast the envelope travels
  toward that step's level; the time taken therefore depends on the distance between the
  previous level and this one. 99 is the **fastest** rate, 0 the slowest. [C] This is the
  opposite convention from a time-based ADSR and inverting it is the most common
  implementation error.
- **Levels are absolute targets, 0…99.** A step can go up or down relative to the previous
  one; the direction flag is redundant with the levels and exists because the hardware's
  ramp generator needs to know its direction up front. [C]
- **The sustain step is any step.** When the envelope reaches the level of the step flagged
  as sustain, it **holds** there until key release, then continues from the next step. [C]
  There is no ADSR-style dedicated sustain segment.
- **The end step is any step.** On key release the envelope runs from wherever it is through
  the remaining steps up to the end step and then stops. [C]
- **No looping.** The published format contains no loop-point field and no repeat flag. The
  brief asks "how they loop" — on the CZ-101/1000/5000 patch structure, **they do not**.
  A patch can be made to *appear* to loop by placing sustain late and giving the DCA
  envelope a cyclical shape before it, but there is no loop mechanism. [C], stated as an
  absence — the format was read in full and no such field exists. If the CZ-1 has one, that
  is [U].

**Segment shape.** Every source describes rate/level segments without qualifying the curve,
and the encoding is a linear rate. Model segments as **linear in the envelope's own
domain**. [I] Because the DCA envelope's domain is level and the DCO envelope's domain is
pitch, "linear" means different things in each: a linear DCA ramp is a linear-amplitude
fade (which sounds fast-then-slow to the ear), and a linear DCO ramp is a linear-in-pitch
glide. Do not apply an exponential curve to either. The exact curve is [U]; a published
statement that segments range from "as short as one millisecond to as long as a minute"
[R] is the only timing datum found.

### 4.2 Rate and level encodings — three different ones

This is a real quirk of the format and is worth reproducing exactly if we ever import
patches, and worth knowing about regardless because it reveals the hardware's internal
resolution. [C]

| Envelope | Rate encoding (byte from parameter) | Level encoding |
| --- | --- | --- |
| **DCA** | `byte = 119·r/99` | `byte = 127·L/99` |
| **DCW** | `byte = 119·L/99 + 8` (the format's own text; the `+8` offset is real, byte 8 ⇒ 0, byte 77 ⇒ 99) | as DCA |
| **DCO** | `byte = 127·r/99` | levels 0–63 → bytes 0x00–0x3F; levels 64–99 → bytes **0x44–0x67** |

Three observations. First, the internal resolution is **7-bit at best** and in the DCW case
effectively `119 − 8 = 111` steps for 100 parameter values, so adjacent parameter values can
map to the same internal value — the parameter grid is not uniform. Second, the DCO level
encoding has a **discontinuity at 64**, skipping bytes 0x40–0x43. Third, the format's
description of the DCW encoding uses "level" where "rate" is meant; it is a known typo in
the widely-circulated document and should not be taken as evidence of a different scheme.

For our implementation: store parameters as 0…99 integers, exactly as the reference does.
Do **not** expose continuous floats. The quantisation of the parameter grid is audible on
slow envelopes and is part of the instrument's character (§8).

### 4.3 Key follow

Two key-follow parameters per line, each **0…9**, one for DCA and one for DCW. [C] Both use
non-uniform internal tables — the DCA table is roughly quadratic, the DCW table is roughly
linear until 7 and then jumps sharply at 8 and 9:

```
  DCA key follow 0…9 → internal 0x00 0x08 0x11 0x1A 0x24 0x2F 0x3A 0x45 0x52 0x5F
  DCW key follow 0…9 → internal 0x00 0x1F 0x2C 0x39 0x46 0x53 0x60 0x6E 0x92 0xFF
```

**DCW key follow reduces the DCW value as pitch rises**, so higher notes are less
distorted and therefore darker. [R] Functionally this is the equivalent of a fixed filter:
it makes the instrument behave like an acoustic instrument whose upper register is not
proportionally brighter. **DCA key follow reduces level as pitch rises.** [R] Both are
scaling of the envelope's output, not offsets. There is **no** DCO key follow parameter in
the patch format — pitch tracking is 1:1 and not adjustable. [C]

The two top settings of the DCW table (0x92, 0xFF) are far out of line with the rest of the
series, so settings 8 and 9 are a steep extension rather than a continuation. Reproduce the
table, do not interpolate a smooth curve through it. [C]

---

## 5. Ring modulation and noise modulation

Both are selected by a 3-bit field inside **line 1's** waveform word: `000` = none,
`100` = ring, `011` = noise. Only one may be active. Line 2's copy of the field is ignored
by the hardware. [C]

**Ring modulation** multiplies the two lines' outputs. [R] The pitch relationship between
the lines is set by octave and detune, so ring modulation plus a detuned line 2 gives sum
and difference frequencies that are generally inharmonic — this is the instrument's only
route to genuinely clangorous, bell-like material, and it is the reason the architecture
bothers with two lines at all. Because both lines have their own DCW and DCA envelopes,
the modulator's spectrum and level evolve independently of the carrier's, which is a
capability a fixed ring modulator does not have.

The exact form is **[U]**: whether it is a true four-quadrant multiply `L1 × L2`, a
multiply of one line by the other's DCA output only, or a multiply with one operand offset,
is not documented in anything found. Build `out = L1 × L2` with both lines full-amplitude
[I] and verify by ear against reference material.

**Noise modulation** is documented only by name in every accessible source. What it does
mechanically is **[U]**, and this is the largest single gap in this sheet. Two hypotheses,
both consistent with the sound of the patches that use it (percussion, wind, breath):

- (a) A noise source is applied to the **phase increment** of line 1, i.e. random frequency
  modulation. This produces the wideband, pitched-but-unstable hiss characteristic of the
  instrument's percussion presets and is the reading most consistent with a technique whose
  only lever is phase.
- (b) A noise source **replaces or is mixed into** one line's output.

Hypothesis (a) is the more likely on architectural grounds — the instrument has no mixer
into which a noise source could be summed, whereas it has a phase accumulator that is
trivially perturbable, and the modulation flag lives in the **waveform** word rather than in
any level parameter. **[I], flagged for verification.** Do not ship either until a
listening comparison is done (§11, test V-11).

---

## 6. Pitch: octave, detune, portamento, bend, vibrato

| Parameter | Range | Encoding | Notes |
| --- | --- | --- | --- |
| **Octave** | −1 / 0 / +1 | 2-bit field | Per-patch, whole-instrument [C] |
| **Detune sign** | + / − | 1 byte | [C] |
| **Detune, octave** | 0…3 | packed | [C] |
| **Detune, note** | 0…11 semitones | packed with the above | [C] |
| **Detune, fine** | 0…60 | 1 byte, 4 sub-ranges | [C] |
| **Portamento time** | 0…99 | MIDI CC 5 | [C] |
| **Bend range** | 0…12 semitones | sysex 0x40 | [C] |
| **Master tune** | 0…127 | MIDI CC 6 | [C] |
| **Key transpose** | 12 semitone positions | sysex 0x41 | [C] |

**Detune total range** is therefore **±(3 octaves + 11 semitones + 60 fine units)**, which
is just under ±4 octaves — consistent with a secondary source's "±4 octaves" description
[R]. The fine field's 61 steps span one semitone, so **one fine unit ≈ 1.64 cents**. [I] —
derived, since the field's span is not stated outright; the derivation assumes fine 0…60
covers exactly one semitone, which is the only reading consistent with the note field
being whole semitones.

Detune applies to the **primed** member of a line pair, so it does nothing in modes 1 and 2.
This is a common source of confusion and the UI should grey the detune controls out in the
single-line modes. [I]

**Vibrato** is a single global LFO with four waveforms and three parameters: [C]

| Parameter | Range | Notes |
| --- | --- | --- |
| Wave | 1 = triangle, 2 = saw up, 3 = saw down, 4 = square | [C] |
| Rate | 0…99 | Higher = faster. Absolute Hz **unknown** [U] |
| Depth | 0…99 | Absolute cents **unknown** [U] |
| Delay | 0…99 | "The larger the value, the later vibrato is applied" [C] |
| On/off | MIDI CC 1 on the small models (a switch, not a continuous wheel) | [C] |

On the smallest models CC 1 is a **binary vibrato on/off**, not a modulation wheel; only the
largest model treats CC 1 as a continuous wheel. [C] That is a real behavioural difference
and if we offer a "period-correct" mode it belongs there.

The rate, depth and delay encodings in the patch format are three-byte tables with visibly
non-linear spacing (delay values 25–99 map to byte triples whose third byte grows from 0x19
to well past 0xFF into a second byte), which tells us the internal timing is a
**multi-byte counter with a non-uniform parameter-to-counter map**, i.e. the perceived taper
is strongly logarithmic at the top of the range. [C] for the non-linearity; the actual times
in seconds are [U].

---

## 7. Voices, memory and the rest of the system

| Property | Value |
| --- | --- |
| Voices | **8** in line modes 1 and 2; **4** in 1+1′ and 1+2′ [C] |
| Velocity | None. Always sent and received as 64 [C] |
| Aftertouch | None [C] |
| Memory (small models) | 16 preset + 16 user + 16 cartridge [C] |
| Memory (largest model) | 32 preset + 32 user, in four banks of eight [C] |
| Patch size | **256 bytes**, transmitted as nibbles (low nibble first) [C] |
| Tone mix | A level 1…9, or off — mixes two patches [C] |
| System CPU | 8-bit microcontroller (µPD7811G-120 class) [R] |

Voice assignment behaviour (rotation order, stealing policy) is **[U]** — nothing found.

---

## 8. Resolution, aliasing and character artefacts

### 8.1 Where the roughness comes from

The instrument is a **fixed-sample-rate DDS with a piecewise-linear phase warp and no
band-limiting whatsoever**. Each of those three facts contributes an artefact, and together
they are the sound.

- **Slope discontinuities.** Every one of the five PD waveforms has at least one breakpoint
  where `dΦ/dφ` jumps. A slope discontinuity in the phase map produces a corner in the
  output whose spectrum rolls off at only 6 dB/octave — a huge amount of high-frequency
  energy, extending well past Nyquist at any useful DCW setting.
- **No oversampling, no band-limiting.** That energy folds. The instrument aliases audibly,
  and the aliasing is **pitch-dependent and DCW-dependent**: it rises with note pitch and
  with DCW, exactly the two axes a player moves.
- **Coarse output conversion.** The smallest models' output stage is described as a crude
  floating-point arrangement with a resistor-ladder mantissa rather than a linear DAC [R],
  which adds a level-dependent quantisation noise floor — noise that rises and falls with
  the signal instead of sitting under it.

**Sample rate is unknown [U].** No source gives it, and it is the single most important
unknown in this sheet, because the aliasing pattern — which is a defining part of the
character — cannot be reproduced without it.

### 8.2 What to do about it, and what not to do

Do **not** band-limit the oscillators. A PolyBLEP-corrected phase-distortion oscillator is a
different instrument. The correct approach is:

1. Compute the PD waveforms **naively** — literally the formulas in §3 — at an internal
   rate equal to the modelled hardware rate.
2. **Decimate to the host sample rate with a proper anti-alias filter.** This reproduces
   the hardware's own aliasing (which happened at the hardware rate and is now part of the
   signal) without adding a second layer of our own.

That ordering is the whole trick, and getting it backwards — running the naive formula at
the host rate — produces aliasing that changes when the user changes their session sample
rate, which is a bug the hardware cannot have. [I]

Because the hardware rate is unknown, expose it as a build constant and make QA's job to
bracket it (§11, test V-8). A rate in the region of 30–50 kHz would be typical for the era
and the CPU class. [I]

### 8.3 Artefact inventory

| Artefact | Confidence | Note |
| --- | --- | --- |
| Aliasing rising with pitch and DCW | [C] | Deliberate; reproduce, do not fix |
| Slope-discontinuity brightness | [C] | Inherent to piecewise-linear phase maps |
| Parameter grid quantisation (0…99, non-uniform internal tables) | [C] | Audible zipper on slow envelope moves; do **not** smooth |
| DCO level encoding discontinuity at 64 | [C] | Reproduce only in patch import, not in the UI |
| Level-dependent quantisation noise from the output stage | [R] | Model as a noise floor that scales with signal |
| Every waveform starts at **+1** (cosine convention) | [C] | Note-on click is real; the DCA envelope's first step is what suppresses it |
| Waveform 8 starts at 0 (sine convention) | [U] | Inconsistent with 6 and 7 in the source implementation; verify |
| Waveform pairs alternate per cycle, adding f/2 content | [R] | Not a crossfade |
| No pitch drift, no analogue instability | [C] | Crystal-derived. Adding drift would be wrong |
| No velocity, no aftertouch | [C] | Any velocity response we add is a modern extension and must be switchable |

---

## 9. Control inventory

Every stored parameter, for parameter-ID assignment. Six envelopes are listed once and
instantiated six times.

| Section | Control | Range | Default |
| --- | --- | --- | --- |
| Global | Line select | 1 / 2 / 1+1′ / 1+2′ | 1 |
| Global | Octave | −1 / 0 / +1 | 0 |
| Global | Detune sign | + / − | + |
| Global | Detune octave | 0…3 | 0 |
| Global | Detune note | 0…11 | 0 |
| Global | Detune fine | 0…60 | 0 |
| Global | Modulation | none / ring / noise | none |
| Global | Portamento on/off, time | off; 0…99 | off, 0 |
| Global | Bend range | 0…12 semitones | 2 |
| Vibrato | Wave | 1…4 | 1 |
| Vibrato | Rate / Depth / Delay | 0…99 each | 40 / 0 / 0 |
| Line *n* | Waveform 1 | 1…8 | 1 |
| Line *n* | Waveform 2 | 1…8, or none | none |
| Line *n* | DCA key follow | 0…9 | 0 |
| Line *n* | DCW key follow | 0…9 | 0 |
| Line *n* | DCO envelope | 8 × (rate 0…99, level 0…99), sustain step, end step | flat |
| Line *n* | DCW envelope | as above | see note |
| Line *n* | DCA envelope | as above | see note |

Sensible defaults for a new patch [I]: DCO envelope flat at the neutral pitch level with end
step 1; DCW envelope rising to 99 fast then sustaining at 60; DCA envelope attack to 99 at
rate 99, sustain at 80, release at rate 60.

---

## 10. Implementation order

1. Phase accumulator + the five PD phase maps (§3.1) at an internal rate → V-1, V-2
2. The three windowed-sync waveforms (§3.2) → V-3
3. Decimation with anti-aliasing → V-8
4. Eight-stage envelope engine with sustain/end pointers → V-4, V-5
5. DCW routing (envelope → phase-map parameter, with the two different meanings) → V-6
6. DCA, key follow tables → V-7
7. Two lines, line modes, detune → V-10
8. Ring and noise modulation → V-11
9. Vibrato, portamento, bend
10. Patch import from the published format (optional, but it is free validation)

---

## 11. Verification — what QA must measure

| ID | Test | Method | Target | Tolerance |
| --- | --- | --- | --- | --- |
| **V-1** | DCW = 0 is a pure cosine | Each of waveforms 1, 2, 3, 5 at DCW 0, note A4. FFT. | Only the fundamental; every harmonic below −80 dBFS | −80 dBFS |
| **V-2** | Waveform 4 at DCW 0 | Same, waveform 4. | Only **2 × fundamental**; the fundamental itself below −60 dBFS | −60 dBFS |
| **V-3** | Resonant peak tracks DCW | Waveform 6, note A2, sweep DCW 0→99. Track the spectral centroid peak. | Peak moves monotonically from 1× to `r_max` × fundamental | Monotonic; endpoint per §3.3 [I] |
| **V-4** | Rate is speed, not time | Two steps with identical rate but level distances of 20 and 80. | The 80-distance step takes **4×** as long | ±5 % |
| **V-5** | Sustain and end steps | Envelope with sustain on step 3 and end on step 6. Hold 5 s, release. | Holds at step 3's level; on release runs steps 4→6 and stops | Exact |
| **V-6** | DCW envelope is the only brightness control | Sweep the DCW envelope's sustain level 0→99 at fixed pitch. Measure spectral centroid. | Monotonic rise | Monotonic |
| **V-7** | DCW key follow table | Key follow 8 and 9, sweep pitch. Measure effective DCW. | Reproduces the 0x92 / 0xFF step, not a smooth curve | Table values exactly |
| **V-8** | Aliasing signature | Waveform 1 at DCW 99, chromatic sweep C2→C7, no envelope. Measure non-harmonic energy vs. pitch. | Rises monotonically with pitch; **must not change** when the host sample rate changes from 44.1 to 96 kHz | Difference between host rates < 1 dB |
| **V-9** | Waveform 8 start phase | Waveform 8, DCW 50, single cycle capture. | First sample is 0 (sine) or +1 (cosine) — record which | Report, then decide |
| **V-10** | Detune fine resolution | Mode 1+1′, detune fine 0 → 60. Measure beat frequency. | One fine unit ≈ 1.64 cents; 60 units ≈ 1 semitone | ±10 % on the semitone total |
| **V-11** | Noise modulation hypothesis | Build both hypotheses from §5, render the same percussion-style patch. | Blind A/B against reference material | Qualitative; must be settled before ship |
| **V-12** | Polyphony halving | Line mode 1 vs. 1+1′, play 8 notes. | 8 sounding vs. 4 sounding | Exact |
| **V-13** | Waveform pair alternation | Waveform 1 + waveform 3 as a pair, note A2. FFT. | Energy present at **f/2** | > −40 dBFS relative to fundamental |
| **V-14** | Parameter quantisation | Sweep any 0…99 parameter continuously via automation. | 100 discrete steps, no interpolation | Exact step count |
| **V-15** | No velocity | Send note-ons at velocity 1 and 127. | Identical output (in period-correct mode) | Bit-identical |

---

## 12. UI era-language notes

What follows describes the design language of **mid-1980s Japanese digital synthesisers as
a class**. It contains no description of any specific product's artwork, logo, typeface or
badge and nothing may be traced from a photograph.

**Control taxonomy — the defining break with the previous generation.** This generation
abandoned one-control-per-parameter. A patch here has roughly 130 stored values and a panel
with roughly a dozen buttons. The interaction model that replaced knob-per-function is:

1. A **parameter-select stage** — a small number of buttons that name *sections* (the
   equivalent of "DCO 1", "DCW 2", "DCA 1"), pressed to enter that part of the patch.
2. A **cursor pair** — left/right buttons that step through the parameters within the
   selected section.
3. A **value pair** — up/down (or +/−) buttons that increment and decrement the parameter
   the cursor is on.
4. A **single-line display** showing the current parameter and its value, and nothing else.

This is a **modal, page-based editor driven by four navigation buttons**. It is slow, and
the era knew it was slow; what it bought was a patch far deeper than a panel could hold. Our
UI should acknowledge the model without reproducing its speed penalty: keep the **section →
parameter → value** hierarchy as the information architecture, because it matches the
patch's actual structure, but let a pointer jump straight to any parameter. The hierarchy is
the era-correct part; the button-stepping is not worth preserving.

**The envelope editor is the exception and deserves the screen.** Six eight-stage envelopes
is the instrument's substance, and a period panel could only ever show one rate/level pair
at a time. This is the place where a modern implementation should depart from the era
completely: show the whole envelope as an editable **step graph** with the sustain and end
markers on it. That is not anachronistic decoration, it is exposing what the format already
stores.

**Display technology.** The period vocabulary is a **single-line reflective LCD**, typically
16 characters, dark grey segments on a yellow-green or grey-green field, usually
**unlit** — read by ambient light, not backlit. Character shapes are 5×7 dot matrix. There
are no graphics, no proportional text, no more than one line. If we evoke this, evoke the
*constraint* — a narrow, single-line status strip with monospaced text and a hard character
limit — rather than simulating LCD pixels. A faked dot-matrix font is skeuomorphism; a
genuinely terse one-line readout is era language.

**Panel proportions and layout logic.** Two distinct formats existed in this class and both
are worth knowing: a **compact format** with mini keys and a control surface only a few
centimetres deep running the full width above them, and a **full-size format** with a
conventional keybed and a proportionally larger but still shallow panel. In both, the panel
is divided left-to-right into three zones: performance controls at the far left (bend,
vibrato, portamento switches, near the player's left hand), the display and data-entry
cluster in the centre, and the patch-selection button matrix at the right. The synthesis
parameters have **no dedicated panel real estate at all** — they live behind the display.
That zoning is the single most transferable idea: **performance / navigate / recall**, left
to right.

**Switch and button language.** Rubber or membrane buttons in a regular grid, small, closely
spaced, with the legend printed on the button rather than beside it. Indicators are single
LEDs, often just one or two on the whole panel. Buttons are grouped by thin printed rules or
by tinted background blocks, not by borders. Nothing is round.

**Colour temperature.** Cool and dark, in contrast to the warm greys of the previous
generation: charcoal or near-black plastic with cool grey or white legends. Accent colour is
used sparingly and functionally — one hue for the patch-selection group, one for data entry.
The overall impression is of an office machine rather than a musical instrument, and that
was the point: this generation was sold on being affordable and precise, not on being warm.

**Material.** Moulded textured ABS throughout, matte, no metal, no wood. The instrument is
light and reads as light. Where the previous generation's restraint came from industrial
seriousness, this generation's comes from cost — and honestly reproducing that plainness
looks better today than dressing it up.

**What to avoid.** Simulated LCD pixel grids, fake ghosting on the display, drop shadows on
membrane buttons, and any suggestion of a specific product's silkscreen. The era is achieved
by the **modal information architecture, the single-line terse readout, the three-zone
panel and the cool dark palette** — all functional decisions, none of them trade dress.

---

## 13. Sources

**Primary, read in full via anonymous git:**

1. **`github.com/ajwills72/cz101`**, `docs/sysex.md` — the complete MIDI and
   system-exclusive specification for the CZ-101 / CZ-1000 / CZ-5000, itself derived from
   the long-circulated youngmonkey.ca document. Source of: the 256-byte patch structure and
   its 25 sections, the four line modes and their bit codes, the octave field, the detune
   sign/octave/note/fine fields, the vibrato wave/rate/depth/delay encodings, the two
   waveform slots per DCO, the ring/noise modulation bit codes and their placement in line
   1's word, the DCA and DCW key-follow tables, the eight-step envelope layout, the
   end-step and sustain-flag and direction-flag semantics, the three different rate/level
   encodings, the velocity-always-64 behaviour, the absence of aftertouch, the memory
   layout, portamento/bend/master-tune/tone-mix controls, and the absence of any loop
   field.
2. **`github.com/grame-cncm/faustlibraries`**, `oscillators.lib`, the `CZ` environment —
   MIT/STK-licensed implementations of all eight waveforms, credited to Mike Moser-Booth's
   analysis. Source of every formula in §3. Each was algebraically reduced and verified here
   to collapse to a pure cosine at DCW 0.
3. **`github.com/thorinside/czd_osc`** — a Faust CZ-style oscillator using the above
   library; used only to confirm the library's calling convention (`CZsaw(lf_sawpos(f),
   index)`), i.e. that `index` is the DCW analogue.

**Secondary, via search extraction:**

4. Wikipedia, *Phase distortion synthesis* and *Casio CZ synthesizers* — the technique's
   definition, its origin as a route around a competitor's FM patents, the eight-waveform
   inventory (five conventional plus three resonant: sawtooth, triangle, trapezoidal), the
   two-waveforms-per-DCO-in-alternation behaviour, and the prohibition on pairing two
   resonant waveforms.
5. Tonalux, *Phase Distortion Synthesis: How Casio Bent Sine Waves Into Complex Spectra* —
   the `Φ = φ + Δ(φ)` phase-transfer formulation, and DCW's behaviour differing between
   resonant and non-resonant waveforms.
6. Perfect Circuit, *Casio CZ Series History* and *The Basics of Phase Distortion and
   Frequency Modulation* — DDS framing, DCW as morphing control, resonant waveforms
   repositioning the peak above the fundamental.
7. Nathan Ho, *A Survey of Nonstandard Oscillators* — the clearest statement of the
   windowed-hard-sync mechanism behind the resonant waveforms.
8. kasploosh.com, *About Casio CZ Envelopes* — rate 99 = fastest / 0 = slowest, sustain and
   end assignable to any step, segment durations from ~1 ms to ~1 minute.
9. HandWiki, *Engineering: Casio CZ synthesizers* — waveform names, one-or-two waveforms per
   oscillator, series rather than parallel combination.
10. Polynominal, *Casio CZ-101 (1984)* — line modes and their polyphony cost, ring and noise
    modulation as fixed-depth options, 8-bit system CPU.
11. ajxs.me, *Casio CZ-101 Review* — output-stage description (floating-point arrangement
    with resistor-ladder mantissa) and its difference from the larger models.
12. Casio *CZ-1 Operation Manual*, DCW section (via ManualsLib extraction) — DCW as the
    waveshaping control operated by envelope.
13. Casio *CZ-101 Operation Manual* (via extraction) — detune range description, octave
    parameter, vibrato waveform list, delay parameter semantics.

---

## 14. What could not be confirmed

1. **Internal sample rate.** [U] The most important gap. The aliasing signature — a defining
   character trait — cannot be matched without it. See test V-8.
2. **`r_max`, the top of the resonant-waveform frequency ratio.** [U] Our 32× is [I].
3. **What noise modulation actually does.** [U] Two hypotheses in §5; neither confirmed.
4. **The exact form of ring modulation.** [U] Assumed `L1 × L2`.
5. **Envelope segment curve.** [U] Assumed linear in the destination domain.
6. **Envelope rate → seconds mapping.** [U] Only "≈1 ms to ≈1 minute" as endpoints [R]. The
   shape of the map between them is unknown, and it is not the same map for DCA, DCW and
   DCO given that their encodings differ.
7. **Vibrato rate in Hz, depth in cents, delay in seconds.** [U] Only the non-linear byte
   tables are known.
8. **Whether "2+2′" exists on any model.** [U] The read patch format has 1+2′.
9. **Whether any model's envelopes loop.** [U] The read format has no loop field; the larger
   models were not checked.
10. **Voice assignment and stealing policy.** [U]
11. **Waveform 8's start phase convention.** [U] See test V-9.
12. **Whether the DCO envelope's level 0 corresponds to the nominal pitch or to a pitch
    floor**, and how many semitones the DCO envelope's 0…99 range spans. [U] This makes
    pitch envelopes unbuildable to spec; they will need calibration by ear.
