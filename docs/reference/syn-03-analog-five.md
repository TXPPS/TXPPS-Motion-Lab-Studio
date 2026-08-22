# Reference spec — SYN-03 Analog five-voice (two VCOs, poly-mod, four-pole ladder-class LPF)

Status: **research complete with named gaps, ready to implement against**. Author: Research
Analyst.
Class of device: five-voice fully-programmable analogue polysynth, two VCOs per voice with
hard sync, a per-voice modulation matrix ("poly-mod"), one four-pole resonant low-pass and
two four-stage envelopes per voice, one global LFO, microprocessor auto-tune. The reference
instrument for behaviour research is the Sequential Circuits **Prophet-5** (1978–1984,
revisions 1 through 3.3) with the 2020 **Rev 4** reissue used only where it documents
behaviour the vintage instrument had but never specified.

## 0. How to read this document

Confidence markers, as elsewhere in `docs/reference/`:

- **[C]** confirmed — vendor documentation, service documentation, or derived here from
  cited premises.
- **[R]** reported — reputable secondary source, not cross-checked against the manual.
- **[U]** unconfirmed. **Do not build to a [U] claim.**
- **[I]** inference or our own design decision.

**Sourcing constraint, and a warning specific to this sheet.** The egress proxy blocks
WebFetch for every domain tried and refuses `curl` at the CONNECT tunnel with 403;
`archive.org` hosts the full text of both the owner's manual and the service manual for
this instrument and **neither could be read**. GitHub's anonymous git lane, which carried
most of the weight in SYN-01 and SYN-02, has no equivalent asset here — there is no public
measurement repository for this instrument comparable to the one that exists for the DCO
polysynth. **This sheet is therefore materially weaker than the other two**, and it is
weaker in a specific place: control ranges in real units. The architecture, the routing and
the revision differences are well-sourced. The numbers are not. §13 lists the gaps and they
are more numerous than in the other sheets. Do not treat this sheet's silence on a value as
permission to invent one.

**Intellectual-property rule for this file.** Manufacturer and model names appear because
this is an internal research note. They must **never** appear in shipped UI strings, code
identifiers, filenames, preset names, or marketing copy. No panel artwork, logo, typeface or
badge is described here and none may be traced. §11 describes the **era's** design language.
Nothing here was obtained by decompilation or asset extraction.

---

## 1. Why this architecture is worth modelling

The instrument's historical importance is that it was the first fully programmable
polyphonic synthesiser, but its *musical* importance is one feature: **poly-mod**. A global
LFO modulating all voices identically is a chorus effect. A modulation matrix that runs
**independently inside every voice**, sourced from that voice's own filter envelope and its
own second oscillator, is a different instrument — it makes each note in a chord evolve on
its own timeline. Every characteristic sound associated with this instrument (the sync
sweep, the metallic filter attack, the bell-like poly-mod stab) comes from that one
structural decision. A model that implements poly-mod as a global modulation matrix will be
functionally complete and sonically wrong.

The second reason is the revision split. The same instrument exists in two filter
implementations that are audibly different, and both are wanted. This is a genuine
opportunity: a single engine with a switchable filter model gives us two instruments for
slightly more than the cost of one, and it is what the manufacturer's own current reissue
does. [R]

---

## 2. Voice architecture

### 2.1 Signal path (per voice, ×5)

```
   ┌───────────────────────── one voice ─────────────────────────────────┐
   │                                                                     │
   │  ┌──────────────────┐                                               │
   │  │   OSC A          │  saw ─┐                                       │
   │  │   freq (4 oct)   │  pulse┤ (width knob)                          │
   │  │   ◀── SYNC from B│       │                                       │
   │  └──────────────────┘       │                                       │
   │                             ├──▶ ┌──────────┐                       │
   │  ┌──────────────────┐  saw ─┤    │  MIXER   │                       │
   │  │   OSC B          │  tri ─┤    │  A / B / │──▶ ┌────────────────┐ │
   │  │   freq + fine    │  pulse┤    │  NOISE   │    │ VCF 4-pole LPF │ │
   │  │   LO FREQ sw     │       │    └──────────┘    │ 24 dB/oct      │ │
   │  │   KEYBOARD sw    │───────┘                    │ resonance,     │ │
   │  └────────┬─────────┘                            │ self-osc       │ │
   │           │                                      └───────┬────────┘ │
   │           │ (also a poly-mod source)                     ▼          │
   │           │                                      ┌────────────────┐ │
   │           │                                      │      VCA       │ │
   │           │                                      └───────┬────────┘ │
   └───────────┼──────────────────────────────────────────────┼──────────┘
               │                                              ▼
               │                                   5 voices summed → out
               │
   ┌───────────▼─────────────────────────────────────────────────────────┐
   │  POLY-MOD  (per voice — this is the whole point)                    │
   │                                                                     │
   │   sources          amount           destinations (switches)         │
   │   ┌──────────┐   ┌────────┐        ┌──────────────────┐             │
   │   │FILTER ENV│──▶│ amount │───┬───▶│ FREQ A           │             │
   │   └──────────┘   └────────┘   ├───▶│ PW A             │             │
   │   ┌──────────┐   ┌────────┐   └───▶│ FILTER cutoff    │             │
   │   │  OSC B   │──▶│ amount │────────┘                  │             │
   │   └──────────┘   └────────┘                           │             │
   │   Both sources share the three destination switches.  │             │
   └─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Control path

```
  KEY ──┬─▶ voice assign (5) ──▶ OSC A, OSC B pitch  (OSC B only if its KEYBOARD sw is on)
        ├─▶ FILTER ENV (ADSR) ──┬─▶ VCF cutoff × env amount
        │                       └─▶ POLY-MOD source 1
        ├─▶ AMP ENV (ADSR) ─────▶ VCA
        └─▶ VCF keyboard tracking (off / half / full)

  LFO ──┬─ waveforms: saw, triangle, square (combinable)
        └─▶ WHEEL-MOD ─────┐
  NOISE ───────────────────┤ source mix knob blends LFO ↔ noise
                           └─▶ destinations (switches): FREQ A, FREQ B,
                                                        PW A,  PW B, FILTER
                               depth = mod wheel position × amount

  OSC B ─▶ POLY-MOD source 2 (per voice, audio rate or sub-audio)
  OSC B ─▶ SYNC to OSC A (switch on OSC A)
```

**Two modulation systems, deliberately different.** *Wheel-mod* is global, played from the
wheel, and its five destinations are the ones you want to move by hand. *Poly-mod* is
per-voice, always on, and its three destinations are the ones you want to move
automatically and independently. They are not variants of one matrix and must not be merged
in our implementation. [C]

**Part complement** (Rev 1/2 → Rev 3), useful as a structural cross-check: [R]

| Function | Rev 1 / 2 | Rev 3 | Count |
| --- | --- | --- | --- |
| VCO | SSM2030 | CEM3340 | **11** (10 voice + 1 for the LFO) |
| VCF | SSM2040 | CEM3320 | 5 |
| Envelope | SSM2050 | CEM3310 | **10** (2 per voice) |
| VCA | SSM2020 | (CEM3360, 2 per package) | 21 |

Eleven oscillators for five voices confirms that the **LFO is itself a VCO** — one more of
the same part running slowly. That is worth copying: the LFO's waveforms are the
oscillator's waveforms, and its behaviour at the top of its range is an oscillator's, not a
modulation source's.

---

## 3. The oscillators

### 3.1 Oscillator A

| Control | Type | Range | Default | Notes |
| --- | --- | --- | --- | --- |
| Frequency | knob | **4 octaves**, stepped in **semitones** | centre | [R] |
| Sawtooth | switch | off / on | on | Waveforms are switches, and they **sum** — saw and pulse can both be on |
| Pulse | switch | off / on | off | |
| Pulse width | knob | 0…10 | 5 (=50 %) | Endpoints **[U]** |
| Sync | switch | off / on | off | Hard sync, **B syncs A** |

Two things are load-bearing:

- **The frequency knob is stepped in semitones, not continuous.** [R] This is why the
  instrument can be played in tune without a tuner and why octave/fifth stacks are exact.
  Our implementation should quantise by default with a modifier key for fine adjustment.
- **Oscillator A is the sync slave.** Oscillator B is the master. This is the reverse of the
  arrangement on several contemporaries and matters because on this instrument the classic
  sync sweep is made by sweeping **A** (the slave) — usually via poly-mod from the filter
  envelope with `FREQ A` selected — while B holds the pitch. If we get the master/slave
  direction backwards, that patch cannot be built. [C]

Oscillator A has **no triangle** and **no independent tuning** beyond the semitone-stepped
frequency knob. It is the simpler of the two by design.

### 3.2 Oscillator B

| Control | Type | Range | Default | Notes |
| --- | --- | --- | --- | --- |
| Frequency | knob | 4 octaves, semitone steps | centre | [R] |
| Fine | knob | approx. ±1 semitone (**[U]**, endpoints unconfirmed) | centre | The detune control |
| Sawtooth / Triangle / Pulse | switches | off / on each | saw on | Three waveforms, summable |
| Pulse width | knob | 0…10 | 5 | Independent of A's |
| **LO FREQ** | switch | off / on | off | Drops B into the sub-audio range |
| **KEYBOARD** | switch | off / on | **on** | When off, B ignores the keyboard and holds a fixed pitch |

The last two switches are the instrument's cleverest economy and the thing most often
missed:

- With **LO FREQ on** and **KEYBOARD off**, oscillator B becomes a **per-voice LFO** with
  three waveform choices, routable through poly-mod to oscillator A's frequency, A's pulse
  width, or the filter. Because it is per-voice and free-running, every note in a chord gets
  its own modulation phase. This is the single most distinctive thing the architecture can
  do and it costs no extra hardware. [C]
- With **KEYBOARD off** but LO FREQ off, B becomes a fixed-pitch audio oscillator — a drone
  under the played note, or (with sync on) a fixed sync master producing a formant that does
  not track the keyboard.

The triangle on B and its absence on A is what makes B the natural modulator: a triangle is
the useful LFO shape, and A does not need one.

### 3.3 Mixer

Three level knobs — **Osc A**, **Osc B**, **Noise** — feeding the filter. [C] Noise lives
in the mixer here, not in the oscillator sections, and it is also available as a wheel-mod
source (§5), so the noise generator serves two roles. Whether the audio noise and the
modulation noise are the same generator, and what the modulation path's bandwidth is, are
**[U]**.

Mixer levels beyond about 7 or 8 drive the filter input into saturation; this is the
instrument's normal operating region and is where a large part of its perceived warmth
lives. Model it as **input-stage saturation of the filter**, not as a clean sum followed by
a limiter. [I]

---

## 4. Poly-mod

The modulation matrix that defines the instrument. Two sources, two amount knobs, three
destination switches, **entirely per-voice**. [C]

| Element | Detail |
| --- | --- |
| Source 1 | **Filter envelope** — the same ADSR that drives the filter, tapped before the filter's own amount knob |
| Source 1 amount | knob, 0…10, **unipolar** [U] |
| Source 2 | **Oscillator B** — the audio (or sub-audio) signal itself, **bipolar** |
| Source 2 amount | knob, 0…10 |
| Destination A | `FREQ A` switch — oscillator A frequency |
| Destination B | `PW A` switch — oscillator A pulse width |
| Destination C | `FILTER` switch — filter cutoff |

**Both sources are routed by the same three switches.** There is no per-source destination
matrix. If `FREQ A` is on, both the filter envelope (scaled by its amount) and oscillator B
(scaled by its amount) modulate A's frequency. This is a 2 × 3 matrix with **shared column
enables**, and it is a smaller and more opinionated design than a general matrix — reproduce
it exactly rather than "improving" it into a full routing grid. [C]

### 4.1 The three canonical patches this enables

Worth listing because they are the acceptance criteria for the section:

1. **Sync sweep.** Sync on, Osc B fixed, poly-mod source = filter envelope, destination =
   `FREQ A`, large amount. Each voice's own envelope sweeps its own slave oscillator against
   its own master. Polyphonic sync sweeps are not possible with a global LFO.
2. **Audio-rate cross-modulation.** Osc B in the audio range, poly-mod source = Osc B,
   destination = `FREQ A`. This is FM by another name and produces inharmonic, bell-like
   spectra. The pitch relationship between A and B decides whether the result is harmonic.
3. **Per-voice filter wobble.** Osc B with LO FREQ on and KEYBOARD off, poly-mod source =
   Osc B, destination = `FILTER`. Each held note's filter moves at its own phase.

### 4.2 Depths — the biggest gap in this sheet

**All poly-mod depths in real units are [U].** No accessible source gives them. What is
known: the `FREQ A` depth is large enough to produce full sync sweeps and audio-rate FM,
which implies at least several octaves at full amount; the `PW A` depth spans a usable pulse
width range; the `FILTER` depth is at least comparable to the filter envelope's own amount.

**[I] starting values, to be bracketed by measurement (§10, tests V-5 to V-7):**

| Path | Suggested full-amount depth |
| --- | --- |
| Filter env → Freq A | +5 octaves, unipolar |
| Filter env → PW A | full width range, unipolar |
| Filter env → Filter | +8 octaves, unipolar |
| Osc B → Freq A | ±5 octaves, bipolar |
| Osc B → PW A | ±full width range, bipolar |
| Osc B → Filter | ±8 octaves, bipolar |

Flag these prominently in the code as provisional. They are the values most likely to be
wrong in the first build.

---

## 5. Wheel-mod

Global, wheel-played, five destinations. [C]

| Element | Detail |
| --- | --- |
| Source | A **mix knob** blending **LFO ↔ noise** continuously |
| Depth | Modulation wheel position, scaled by the source amount |
| Destinations | `FREQ A`, `FREQ B`, `PW A`, `PW B`, `FILTER` — five switches |

The source mix is a genuine crossfade, not a selector: at intermediate positions the
modulation is LFO **plus** noise, which is how the instrument produces "unstable vibrato"
and breathy filter movement. [C]

The LFO itself: [C] for the structure, [R] for the range.

| Control | Range | Notes |
| --- | --- | --- |
| Frequency | approx. **0.03 – 27.5 Hz** [R] | Figure is from a circuit-modelled emulation of this instrument, not from the manual |
| Waveforms | sawtooth, triangle, square — **switches, combinable** | Summing saw + square gives shapes neither produces alone |
| Amount | knob | Sets the ceiling that the wheel scales |

The LFO's waveform switches summing rather than selecting is the same idiom as the
oscillators' waveform switches, and it is consistent with the LFO being a VCO (§2.2).

---

## 6. The filter — and the revision difference

### 6.1 Common properties

Four-pole, **24 dB/octave**, resonant low-pass, one per voice, **capable of self-oscillation**
at high resonance. [C] Keyboard tracking is **three-state — off / half / full** — implemented
as two switches rather than a knob, so the tracking amounts are exact and repeatable. [C]

| Control | Range | Default | Notes |
| --- | --- | --- | --- |
| Cutoff | knob 0…10 | 10 | Endpoints in Hz **[U]** |
| Resonance | knob 0…10 | 0 | Self-oscillates at roughly 60 % of travel [R] |
| Envelope amount | knob 0…10 | 0 | Unipolar; polarity is not switchable |
| Keyboard tracking | off / half / full | off | Two switches |

A circuit-modelled emulation of this instrument places the onset of self-oscillation at
**60.00 on a 0–100 cutoff-normalised resonance scale** [R], i.e. around 6/10 of the knob —
notably earlier in the travel than on the DCO polysynth in SYN-01, where it is around 9/10.
That difference is real and is part of why this instrument is described as more aggressive.

### 6.2 The two filter implementations

The instrument exists in two electrically different filters and both are wanted. All of the
following is **[R]** — it is consistently reported across independent sources but none of it
is a measurement, and this is exactly the kind of claim that accumulates as folklore. Treat
it as a **description of the target, to be confirmed by our own measurement**, not as spec.

| Property | Early revisions (SSM-based) | Later revisions (Curtis-based) |
| --- | --- | --- |
| Overall | Darker, more "organic", looser | Cleaner, tighter, more focused, "drier" |
| Low end | Fuller, more weight | Slightly leaner |
| Resonance | More liquid, more vocal, less predictable | More controlled, more consistent |
| Drive | Soft distortion when overdriven adds harmonics — reported as a large part of the chip's reputation | Less pronounced |
| Top end | "Silky" once the cutoff is open | Cleaner but flatter |
| Consistency | Varies noticeably unit to unit and voice to voice | Consistent |

One structural difference is **[C]** and explains part of the above: the later filter chip
integrates a **resonance VCA** on-die, whereas the earlier one does not and requires an
external VCA for voltage-controlled resonance. A resonance path built from a discrete
external VCA has different distortion and different level behaviour from an integrated one,
which is a concrete, modellable difference rather than a subjective one.

The **envelope chips also differ**, and this is a second, independent source of the
revisions' different character that is often attributed to the filter: the earlier envelope
generator's shape is reported as **very flat, almost linear**, while the later one has
**more curvature**. [R] If we implement one envelope shape for both revisions, we will have
modelled only half the difference.

**Implementation recommendation [I].** Build one four-pole structure with three
parameterised differences: (a) input-stage saturation amount, (b) resonance-path
non-linearity and its level compression, (c) passband loss versus resonance. Expose a
two-position "revision" switch that changes those three parameters plus the envelope
curvature. Do not build two separate filters — the differences are quantitative, and two
codebases will drift apart.

### 6.3 Where the non-linearity lives

Same principle as SYN-01: at the **filter input** (driven by the mixer) and in the
**resonance feedback path**. Not on the output. [I] The reported "soft distortion when
overdriven adds harmonics to the original signal" is an input-stage description. [R]

---

## 7. Envelopes

Two per voice — **filter envelope** and **amplifier envelope** — each a conventional
four-stage ADSR with knobs marked 0…10. [C]

| Property | Value |
| --- | --- |
| Stages | Attack, Decay, Sustain, Release |
| Time range | approx. **2 ms – 55 s** [R] — from a circuit-modelled emulation, not the manual |
| Sustain | 0…10, a level |
| Shape, early revisions | Very flat, close to **linear** [R] |
| Shape, later revisions | More curved (exponential-family) [R] |
| Release switch | A panel switch disables the release stage globally [C] |

The **release switch** is not a modulation feature, it is a performance control: with
release off, notes stop at key-up regardless of the release setting, which lets a player
switch between sustained and staccato articulation without changing the patch. It is often
tied to a footswitch. Model it as global state, not per-patch. [C]

The **55 s maximum** is far longer than the DCO polysynth in SYN-01 (19.8 s) and is worth
checking: it comes from an emulation's documentation, and emulations sometimes extend ranges
deliberately. [R], flagged.

---

## 8. Tuning, drift, and the auto-tune routine

This is the most interesting subsystem in the instrument and the one that most directly
produces its character.

### 8.1 Why it needs tuning at all

Ten voltage-controlled oscillators, each with its own exponential converter, each drifting
with temperature. Unlike the DCO instrument in SYN-01 — whose pitch is divider-derived and
exact — this instrument's pitch is an analogue voltage and is **wrong by default**. Every
sonic quality attributed to it that involves "width" or "movement" traces back to the fact
that its five voices are never quite in tune with each other.

### 8.2 The auto-tune routine

Pressing the `TUNE` button runs a microprocessor calibration. Documented behaviour: [R]

1. The routine completes in **under ten seconds**.
2. For each VCO, the microprocessor measures the oscillator's **period by counting CPU clock
   cycles** (clock ≈ **2.5 MHz**) within one oscillation.
3. It uses **successive approximation** to find the **14-bit control value** that puts the
   oscillator on a reference frequency, and repeats this at octave intervals to build a
   correction table per oscillator.
4. It measures only **C3 through C9** and **extrapolates C0–C2** from the curve, because
   counting periods at very low frequencies would take impractically long.
5. The routine also compensates the high-frequency flattening of the oscillator chips, which
   is why the later revision's high-frequency trim is left unused. [R]

**Three implications for the model, all of them character-bearing:**

- **Tuning accuracy is not uniform across the keyboard.** The bottom three octaves are
  extrapolated, not measured, so error is systematically larger there. A model that applies
  uniform random detune misses this: the correct shape is *small, structured error in the
  measured range and larger, monotonic error below C3*. [I]
- **Tuning is quantised to a 14-bit control value.** The correction can only ever be as fine
  as one LSB of that converter, so a residual error floor exists even immediately after
  tuning. Its size is **[U]** but its existence is [R].
- **Drift resumes immediately after tuning and accumulates with time and temperature.** The
  auto-tune is a reset, not a servo — nothing holds the oscillators in tune between presses.
  Our model should therefore have a **drift state that grows from the last tune event**, and
  the `TUNE` control should visibly reset it. That interaction — drift that you can hear
  accumulating and a button that fixes it — is worth reproducing as a feature, not hiding.

### 8.3 Per-voice variation

Every voice has its own oscillators, filter, envelopes and VCAs, each with component
tolerance. The reissue's approach is instructive: it exposes a single **"vintage" control
that scales the amount of randomness applied to VCOs, envelopes, LFO and filters**, with the
range described as spanning from the most stable revision's behaviour at one end to the
earliest and most temperamental revision's at the other. [R]

Copy that idea. A single scalar that scales **all** per-voice deviations at once is both
easier to use and more faithful than a set of independent drift controls, because on the
hardware the deviations are correlated — an early unit is loose in every respect at once.

**[I] suggested deviation set, scaled by one control:**

| Parameter | Deviation at "vintage = max" |
| --- | --- |
| VCO pitch, per oscillator, slow random walk | ±6 cents, correlation time ~30 s |
| VCO pitch, per oscillator, fixed offset from last tune | ±3 cents, ±10 cents below C3 |
| Filter cutoff, per voice | ±4 % |
| Envelope times, per voice | ±5 % |
| VCA gain, per voice | ±0.4 dB |
| Pulse width, per oscillator | ±2 % |

At "vintage = min" all of these go to zero except a small residual, which corresponds to the
most stable revision.

### 8.4 Unison

Unison stacks voices on a single key. On the vintage instrument there is **no detune
control**: the spread is entirely the voices' natural tuning error, which means **unison
sounds different before and after pressing `TUNE`** — thinner right after tuning, wider as
the instrument drifts. [I], derived from 8.2/8.3 and from the absence of a detune control on
the vintage panel; the derivation is sound but the effect's magnitude is [U].

The reissue adds explicit **voice count and detune amount** controls for unison. [R] Sources
disagree on the voice-count range (one says 1–5, another 1–10, the latter presumably
describing the ten-voice sibling). Take **1–5** for a five-voice instrument. [I]

Our implementation should offer both: a period-correct unison whose spread comes from the
drift model, and an explicit detune control for people who want it. The period-correct one
must be the default, because it is the one that responds to `TUNE`.

---

## 9. Control inventory

| Section | Control | Type | Range | Default |
| --- | --- | --- | --- | --- |
| Osc A | Frequency | knob | 4 oct, semitone steps | centre |
| Osc A | Sawtooth / Pulse | sw ×2 | off/on each | saw on |
| Osc A | Pulse width | knob | 0…10 | 5 |
| Osc A | Sync | sw | off/on | off |
| Osc B | Frequency | knob | 4 oct, semitone steps | centre |
| Osc B | Fine | knob | ≈ ±1 semitone [U] | centre |
| Osc B | Saw / Tri / Pulse | sw ×3 | off/on each | saw on |
| Osc B | Pulse width | knob | 0…10 | 5 |
| Osc B | LO FREQ | sw | off/on | off |
| Osc B | Keyboard | sw | off/on | **on** |
| Mixer | Osc A / Osc B / Noise | knob ×3 | 0…10 | 8 / 0 / 0 |
| Filter | Cutoff | knob | 0…10 | 10 |
| Filter | Resonance | knob | 0…10 | 0 |
| Filter | Env amount | knob | 0…10 | 0 |
| Filter | Keyboard | sw ×2 | off / half / full | off |
| Filter env | A / D / S / R | knob ×4 | 0…10 | 0/5/10/2 |
| Amp env | A / D / S / R | knob ×4 | 0…10 | 0/5/10/2 |
| Poly-mod | Filter env amount | knob | 0…10 | 0 |
| Poly-mod | Osc B amount | knob | 0…10 | 0 |
| Poly-mod | Freq A / PW A / Filter | sw ×3 | off/on each | all off |
| LFO | Frequency | knob | ≈0.03…27.5 Hz [R] | mid |
| LFO | Saw / Tri / Square | sw ×3 | off/on each | tri on |
| Wheel-mod | Source mix | knob | LFO ↔ noise | LFO |
| Wheel-mod | Freq A / Freq B / PW A / PW B / Filter | sw ×5 | off/on each | all off |
| Global | Glide (portamento) | knob | 0…10 | 0 |
| Global | Unison | sw | off/on | off |
| Global | Release | sw | off/on | on |
| Global | Hold | sw | off/on | off |
| Global | Master tune | knob | ± | centre |
| Global | Master volume | knob | 0…10 | 8 |
| Global | A-440 reference | sw | momentary | — |
| Global | Tune (auto-tune) | button | momentary | — |
| Global | Vintage / drift amount | knob | 0…10 | modern-era default [I] |

Program memory: **40 patches** on the early revisions; **120** on the later ones (a Rev 3.2
could be upgraded to 120, which is the only difference from a Rev 3.3 besides
factory-fitted MIDI on some late units). [R]

---

## 10. Verification — what QA must measure

| ID | Test | Method | Target | Tolerance |
| --- | --- | --- | --- | --- |
| **V-1** | Sync direction | Sync on, sweep Osc B frequency while holding Osc A. Then the reverse. | Sweeping **B** must change the *pitch*; sweeping **A** must change the *timbre* | Direction must be correct — this is pass/fail, not tolerance |
| **V-2** | Osc A frequency quantisation | Sweep the Osc A frequency knob, measure output pitch. | Exactly 49 discrete semitone steps over 4 octaves | Exact step count |
| **V-3** | Waveform switches sum | Osc A saw + pulse both on. FFT. | Spectrum is the sum of the two, not a crossfade | Level within 0.5 dB of the analytic sum |
| **V-4** | Poly-mod is per-voice | Osc B as LO FREQ modulator → Filter. Play a 5-note chord, hold. Analyse each voice's filter movement. | Five **uncorrelated** modulation phases | Pairwise correlation < 0.3 |
| **V-5** | Poly-mod Osc B → Freq A depth | Amount at max, Osc B at 1 Hz. Measure peak pitch deviation of Osc A. | Provisional ±5 octaves [I] | **±2 octaves** — the test exists to bracket the value, not confirm it |
| **V-6** | Poly-mod filter env → Freq A depth | Amount at max, filter env full. Measure pitch at envelope peak. | Provisional +5 octaves [I] | ±2 octaves, same caveat |
| **V-7** | Poly-mod shared destinations | Both amounts non-zero, `FREQ A` on only. | **Both** sources must affect Freq A; neither may affect PW A or filter | Exact routing |
| **V-8** | Filter self-oscillation onset | Mixer at zero, sweep resonance. | First sustained output at ≈6/10 of travel | ±1.0 knob unit |
| **V-9** | Revision A/B — resonance | Same patch, resonance 8, both filter models. Measure passband loss and resonant-peak level. | Early model: more passband loss, higher and less stable peak. Later: less loss, tighter peak | Qualitative but must differ measurably in both dimensions |
| **V-10** | Revision A/B — drive | Mixer at 10, cutoff mid, both models. Measure THD and harmonic profile. | Early model: higher THD, more even-order content | Must differ by >3 dB THD |
| **V-11** | Revision A/B — envelope shape | Attack at 5, capture the envelope. | Early: near-linear ramp. Later: visibly curved | Early model's max deviation from a straight line < 5 % |
| **V-12** | Keyboard tracking states | Tracking off / half / full, play C2 and C5. Measure cutoff shift. | 0 / 1.5 / 3 octaves across the 3-octave span | ±5 % |
| **V-13** | Envelope range | Attack, decay, release at 0 and 10. | ≈2 ms and ≈55 s | ±20 % — the source figure is [R] |
| **V-14** | Auto-tune convergence | Randomise all voice detune, press TUNE. | All voices within a tight band of the reference within simulated 10 s | ±3 cents C3–C7; ±10 cents below C3 (extrapolation error is intentional) |
| **V-15** | Drift accumulates after tune | Press TUNE, then measure voice spread at t = 0, 60 s, 600 s (accelerated). | Monotonically increasing spread | Must increase |
| **V-16** | Unison responds to TUNE | Unison on, no explicit detune. Measure spectral width immediately after TUNE and after simulated drift. | Narrower after TUNE, wider after drift | Must differ by >4 cents |
| **V-17** | Wheel-mod source is a crossfade | Source mix at centre, wheel full, destination FILTER. | Filter movement contains **both** periodic (LFO) and stochastic (noise) components | Both detectable |
| **V-18** | Release switch | Release knob at 10, release switch off. Key up. | Note stops within the VCA's click-suppression time | < 20 ms |
| **V-19** | Voice count | Play 6 notes. | 5 sounding, oldest stolen | Exact |
| **V-20** | Aliasing | Both oscillators saw, sync on, chromatic sweep C1→C7, filter open. | Non-harmonic energy < −60 dBFS. Sync is the worst case — test it specifically | Hard limit |

---

## 11. UI era-language notes

What follows describes the design language of **late-1970s / early-1980s American
programmable analogue polysynths as a class**. No specific product's artwork, logo, typeface
or badge is described and nothing may be traced from a photograph.

**Control taxonomy — knob-per-function, and its honesty.** This class is the high-water mark
of the one-knob-per-parameter panel: roughly forty rotary controls and thirty switches, all
visible at once, none hidden behind a mode. It predates the parameter-page editor of SYN-02
by only a few years but is its exact opposite. The knobs are **small, closely spaced, with a
pointer line and no skirt**, arranged in a dense grid. Switches are **rocker or momentary
membrane** with an integral indicator.

The interaction claim being made by that panel is worth stating because we should make the
same claim: *the whole instrument is in front of you, and nothing is more than one gesture
away*. For a screen implementation this means **no tabs, no accordions, no
progressive disclosure of the synthesis parameters**. If a control exists it is on the
surface. That is expensive in screen area and is the right trade.

**Layout logic.** Left to right in signal order, with the modulation systems bracketing the
audio path rather than sitting inside it: modulation matrix at the far left, then
oscillators, mixer, filter, envelopes, then performance and memory at the right. Sections
are separated by **printed rules and a section title in a heavier weight**, and each section
is a **tight cluster with generous space between clusters** — the grouping is done by
whitespace, not by boxes. That is the most transferable single idea in this sheet: *dense
inside a group, loose between groups*, which lets the eye parse forty controls at a glance.

**A specific, borrowable convention: the switch-bank as a matrix.** Both modulation systems
present as a small grid of labelled switches — sources down one axis, destinations along
the other — printed with the routing legend between them. This is a **modulation matrix
drawn as a physical object**, and it is far more legible than a list of dropdown routings.
Our poly-mod and wheel-mod sections should be drawn this way.

**Panel proportions.** Wide, shallow, and **tilted**: the control surface sits on a raked
plane above the keyboard, typically at 10–20° from horizontal, with the performance wheels
on a flat shelf to the left of the keys. The instrument reads as a piece of furniture rather
than an appliance — heavier and more deliberate than the SYN-01 or SYN-02 eras. Overall
proportion is roughly 4:1 to 5:1 width-to-panel-depth.

**Display technology.** Almost none, and that is the point. The vocabulary is: **two-digit
seven-segment LED numerals** for the program number, **single LEDs** beside switches to show
state, and a **printed legend** for everything else. There is no text display and no patch
name — a patch is a number, and the names live on a paper chart. When we add patch names we
should present them as a **modern addition in a clearly modern element**, not as a
simulated segment display.

**Colour temperature.** Dark and warm: a black or very dark panel with **warm white or cream
legends**, red LED indicators and red seven-segment numerals, and **natural wood** end
cheeks and (often) a wood surround. Accent colour is minimal — the red of the indicators is
usually the only saturated hue on the instrument. The wood is not decorative: it is what
makes the object read as an instrument rather than as equipment, and it is the single
strongest era signal available to us. A dark panel with a warm-neutral structural frame is
era language; a photographic wood texture is not.

**Material.** Painted or anodised metal panel, matte, with silkscreened legends. Knobs in
matte black plastic with a light pointer. Real wood or wood-toned structure. Everything is
heavy and nothing is glossy.

**What to avoid.** Simulated screws, photographic wood-grain bitmaps, faux-metal gradients,
LED bloom effects, and any silkscreen arrangement resembling a specific product's. The era
is achieved by **the all-visible knob-per-function panel, the dense-in-group /
loose-between-group spacing, the switch-matrix drawing of the modulation routing, the
minimal red-on-dark indicator language and the warm structural frame** — every one of which
is a functional or compositional decision rather than trade dress.

---

## 12. Sources

**Manufacturer and quasi-manufacturer:**

1. Sequential, *Prophet-5 User's Guide 1.3* (via search extraction; the PDF is not
   fetchable) — poly-mod sources and destinations, wheel-mod destinations, filter keyboard
   tracking off/half/full, unison with configurable voice count and detune on the reissue,
   the "vintage" control's function, pitch-wheel range 1–12 semitones per program,
   four-octave oscillator frequency range with semitone steps, polyphonic glide.
2. Sequential, *Prophet-5 / Prophet-10 (classics reissued)* product documentation —
   switchable filter revisions in the current product, and the statement of which chip each
   corresponds to.
3. Sequential Circuits, *Prophet-5 Owner's Manual* and *Prophet-5 Service Manual*, both
   present on archive.org as full text. **Not readable from this environment.** Named here
   because they are where every remaining [U] in §13 would be resolved.

**Circuit and revision documentation:**

4. Synth DIY Wiki, *Sequential Circuits Prophet-5* — revision history and the SSM → CEM
   chipset transition.
5. Electric Druid, *CEM3320 Filter designs* and *CEM3340 VCO designs* — the integrated
   resonance VCA in the later filter chip versus the external VCA required by the earlier
   one; the unused high-frequency trim on the later oscillator and the auto-tune's
   compensation for it.
6. SDIY / SSM2040 wiki page — the earlier filter's reputation for soft distortion when
   overdriven adding harmonics.
7. Mod Wiggler thread *Prophet 5 Rev3 tune circuit question*, and 9bit.se
   *Prophet-5 Rev 2 tuning* — the auto-tune routine: two stages, under ten seconds,
   period measurement by counting a 2.5 MHz CPU clock, successive approximation to a 14-bit
   CV, C3–C9 measured and C0–C2 extrapolated.
8. Sounddoctorin, *SCI Prophet 5 technical assistance* — service-level notes on the
   revisions.

**Emulation documentation, used only where it states a number the hardware documentation
does not, and always marked [R]:**

9. u-he *Repro-5 User Guide* — envelope range ≈2 ms to ≈55 s; LFO ≈0.03–27.5 Hz; filter
   self-oscillation above cutoff-normalised resonance 60.00; confirmation that the modelled
   chipset is the later (Curtis) one. This is a circuit-level model with published
   methodology, which is why its numbers are used at all; they are still not measurements of
   hardware.
10. u-he, *RePro Filters Unveiled* — filter modelling methodology.
11. Arturia *Prophet V* manual — used only as a cross-check on the poly-mod and wheel-mod
    control inventory.

**Secondary / reported:**

12. Wikipedia, *Prophet-5* — revision history, program counts, chipsets.
13. Equipboard, *The Sequential Prophet Guide* — per-voice nature of poly-mod, the
    revisions' sonic reputations, the envelope-chip difference between revisions.
14. Sound on Sound, *Sequential Prophet-5 & Prophet-10* review — reissue behaviour.
15. Kenton, *Prophet 5 rev 3.2 and 3.3* — the 40 → 120 program upgrade and what actually
    separates 3.2 from 3.3.
16. Vintage Synth Explorer and Gearspace revision threads — the SSM/CEM part complement
    counts (11 VCO / 5 VCF / 10 EG / 21 VCA) and the reported sonic differences.

---

## 13. What could not be confirmed

This list is longer than the other two sheets'. That is a sourcing outcome, not a research
shortcut: the two documents that would resolve most of it (the owner's manual and the
service manual) are both published and both unreachable from this environment.

1. **Every poly-mod depth in real units.** [U] The single largest gap. §4.2 gives [I]
   starting values; tests V-5 to V-7 exist to bracket them.
2. **Wheel-mod depths in real units** for all five destinations. [U]
3. **Filter cutoff endpoints in Hz.** [U]
4. **Pulse-width endpoints** for both oscillators. [U] Assumed to span a usable range around
   50 %.
5. **Oscillator B fine-tune range.** [U] Assumed ≈±1 semitone.
6. **Envelope range and curve.** [R] only, from an emulation. The 55 s maximum in particular
   should be checked.
7. **LFO frequency range.** [R] only, from the same emulation.
8. **Glide range and law** (linear vs. constant-time vs. constant-rate). [U]
9. **Filter envelope amount depth in octaves.** [U]
10. **Whether the mixer's noise and wheel-mod's noise are the same generator**, and the
    modulation noise path's bandwidth. [U]
11. **Residual tuning error after auto-tune** — quantisation floor of the 14-bit CV in
    cents. [U] Its existence is [R]; its size is not known.
12. **Per-voice component tolerance figures.** [U] Everything in §8.3 is [I].
13. **Unison spread on the vintage instrument.** [U] Its dependence on time-since-tune is
    derived, not measured.
14. **Voice-stealing policy** (oldest / quietest / round-robin). [U] "Oldest" assumed in
    test V-19.
15. **Whether the two revisions differ in oscillator character** as well as filter and
    envelope. [U] The oscillator chips differ; no source describes a sonic consequence.
16. **The exact behaviour of the `HOLD` switch** (sustain-all vs. latch). [U]
