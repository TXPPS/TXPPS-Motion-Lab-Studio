# Reference spec — SYN-01 DCO polysynth (six-voice, one DCO per voice, BBD chorus)

Status: **research complete, ready to implement against**. Author: Research Analyst.
Class of device: six-voice programmable polysynth, one digitally-clocked analogue
oscillator per voice, common non-resonant high-pass, four-pole resonant low-pass, one
envelope, one LFO, bucket-brigade stereo chorus. The reference instruments for behaviour
research are the Roland **Juno-6 / Juno-60** (1982) and **Juno-106** (1984), which share a
sound engine and differ mainly in memory, arpeggiator, MIDI and chorus noise floor.

## 0. How to read this document

Confidence markers, used on every non-obvious claim:

- **[C]** confirmed — vendor service/owner documentation, or an instrumented measurement
  published with its method, or derived analytically here from cited premises.
- **[R]** reported — a reputable secondary source, but not cross-checked against the
  manual.
- **[U]** unconfirmed — plausible or commonly believed. **Do not build to a [U] claim**
  without checking it; a spec that states a value we then build wrong is worse than a gap.
- **[I]** inference or our own design decision. Not a claim about the reference product.
  These are the parts DSP is free to argue with; the [C] parts it is not.

**Sourcing constraint.** `analoguerenaissance.com`, `roland.com`, `archive.org`,
`sweetwater.com` and every PDF service manual are **not fetchable from this build
environment** — the egress proxy returns `EGRESS_BLOCKED`, and a direct HTTPS request
through `curl` is refused at the CONNECT tunnel with 403. One WebFetch was attempted
against the service-manual PDF and refused; it was not retried. Two channels remained
open and both were used: search-engine extraction of those pages, and anonymous `git`
reads of public GitHub repositories, which the session's git proxy serves. The second
channel is the stronger one here: an independent, published, method-documented measurement
project on this exact instrument was cloned and read in full (see §19). Numbers taken from
it are marked [C] because the measurement method is stated in the source; numbers that
exist only as a constant inside the same author's emulator are marked [I], because a
constant that sounds right is not a measurement.

**Intellectual-property rule for this file.** Manufacturer and model names appear here
because this is an internal research note and naming the object of study is how research
works. They must **never** appear in shipped UI strings, code identifiers, filenames,
preset names, or marketing copy. What we are permitted to learn from is _circuit behaviour
and sonic targets_. No panel artwork, logo, typeface or badge is described in this file,
and none may be traced, imitated or reproduced. Section 18 describes the **era's** design
language — the vocabulary of controls and materials common to early-1980s Japanese
polysynths — which is what the UI team may evoke. Nothing here was obtained by
decompilation or asset extraction, and no such method may be used.

---

## 1. Why this architecture is worth modelling

The instrument is interesting to us for one structural reason: it spends almost nothing on
its oscillator section and almost everything on what happens after it. One oscillator per
voice, no sync, no cross-modulation, one envelope shared between filter and amplifier. The
character therefore comes from four places — the way the oscillator is clocked, the
sub-oscillator and noise sitting in the same mixer as the main waveforms, the filter's
behaviour at high resonance, and a chorus that is really a short modulated delay running
in flanger territory. A model that gets the chorus and the filter right and the oscillator
merely adequate will sound like the reference. The reverse will not.

---

## 2. Voice architecture

### 2.1 Signal path (per voice, then common)

```
                        ┌──────────────────── one voice, ×6 ────────────────────┐
  master clock          │                                                       │
  (single, shared)      │   ┌─────────────────────────────────┐                 │
        │               │   │            D C O                │                 │
        ▼               │   │  ramp integrator, reset by the  │                 │
  ┌───────────┐  square │   │  divider's rising edge          │                 │
  │programmable├────────┼──▶│   ├─ SAW      ──────────┐       │                 │
  │ divider    │        │   │   ├─ PULSE (comparator) ┤       │                 │
  │ (per voice)│        │   │   │     ▲ pulse-width CV │      │                 │
  └───────────┘         │   │   └─ SUB (÷2 flip-flop) ┤       │                 │
        ▲               │   └─────────────────────────┼──────┘                 │
   pitch CV /           │                             │                        │
   divider value        │   NOISE (white → 1-pole LPF ┤ ≈5 kHz)                 │
                        │                             ▼                        │
                        │                      ┌────────────┐                  │
                        │                      │  MIXER     │ 4 levels          │
                        │                      └─────┬──────┘                  │
                        │                            ▼                          │
                        │                   ┌──────────────────┐                │
                        │                   │ VCF  4-pole LPF  │ resonance,     │
                        │                   │ 24 dB/oct, OTA   │ self-osc       │
                        │                   └────────┬─────────┘                │
                        │                            ▼                          │
                        │                   ┌──────────────────┐                │
                        │                   │ VCA              │                │
                        │                   └────────┬─────────┘                │
                        └────────────────────────────┼─────────────────────────┘
                                                     ▼
                                        ┌─────────────────────────┐
                                    6 voices summed on one bus
                                        └────────────┬────────────┘
                                                     ▼
                                        ┌─────────────────────────┐
                                        │  HPF  1-pole, 4 detents │  ← one for the
                                        │  non-resonant, no CV    │    whole instrument
                                        └────────────┬────────────┘
                                                     ▼
                                        ┌─────────────────────────┐
                                        │  BBD CHORUS  (I/II/I+II)│ → L, R
                                        └─────────────────────────┘
```

### 2.2 Control path

```
  KEY  ──┬─▶ voice assigner (cyclic) ──▶ divider value  ──▶ DCO pitch
         ├─▶ ENV gate  ──▶ ADSR ──┬──▶ VCF cutoff  (× ENV amount, ± polarity)
         │                        └──▶ VCA         (only if VCA switch = ENV)
         ├─▶ VCF key-follow (0…100 %)
         └─▶ ARPEGGIATOR (replaces held-key set with a stepped sequence)

  LFO ───┬─▶ DCO pitch     (vibrato, depth slider)
         ├─▶ pulse width   (only if PWM switch = LFO)
         └─▶ VCF cutoff    (depth slider)
   LFO has its own delay/fade-in envelope, retriggered from key-on.

  ENV ───┬─▶ pulse width   (only if PWM switch = ENV)
         └─▶ (see above)

  BEND lever ─┬─▶ DCO pitch (depth slider, bipolar)
              ├─▶ VCF cutoff (depth slider, bipolar)
              └─▶ LFO depth to DCO (the lever's "up" axis on some panels)
```

Note the two switch-selected exclusive routings. The PWM source is a three-way switch —
`MANUAL` / `LFO` / `ENV` — not a set of independent depths, and the VCA source is a
two-way switch — `ENV` / `GATE`. Both are latching state, not blendable amounts, and the
model must expose them as enumerations, not as continuous mix controls. [C]

---

## 3. The DCO — what it is and why it stays in tune

### 3.1 Mechanism

This is the part most often modelled wrongly, so it is worth being exact. The oscillator is
**not** a digital wavetable and its output is **not** a staircase. It is an analogue ramp
generator whose _reset_ is digital. [C]

1. A single high-frequency master clock is shared by the whole instrument. [C]
2. Each voice has a programmable counter (divider) loaded by the CPU with a value derived
   from the note number plus the current pitch modulation. The counter emits one square
   pulse per output period. [C]
3. That square wave's rising edge **discharges the integrator capacitor**, resetting the
   ramp. Between resets the capacitor charges linearly, producing a true analogue
   sawtooth. [C]
4. Because a higher note leaves the capacitor less time to charge, the ramp's amplitude
   would fall with pitch. The CPU therefore also emits a per-voice **DCO CV** that raises
   the charging voltage with pitch, holding the sawtooth's peak amplitude roughly constant
   across the keyboard. [C]

The consequence for us: pitch accuracy is set by a crystal-derived divider, so it is exact
and drift-free, while the _waveform_ is analogue and inherits the imperfections of an
integrator — a very slightly curved ramp rather than a mathematically straight one, and a
reset that is fast but not instantaneous. Pitch stability and analogue waveshape are
therefore independent properties, which is precisely the combination a pure digital or a
pure analogue model fails to reproduce. [C], with the "slightly curved ramp" consequence
marked [I] as our reading of the mechanism.

### 3.2 What that means for the implementation

- Generate the ramp from a phase accumulator and **band-limit the reset discontinuity**.
  The reference implementation studied here uses PolyBLEP correction on the saw reset, on
  both pulse edges and on the sub-oscillator's transition. [I] — this is an emulator's
  choice, not a property of the hardware, but it is the correct one: the hardware's
  discontinuity is genuinely fast, so a naive un-corrected reset aliases in a way the
  hardware does not.
- **Do not** reset the accumulator to zero on note-on. The measured reference emulator
  starts a new note part-way through the cycle, on the stated reasoning that a fast attack
  on a low note must produce audible output immediately rather than after most of a period
  of silence. [I]
- Apply a slow decay toward zero on the pulse and sub outputs (the studied implementation
  multiplies the held level by 0.998 per sample). This is a model of the AC coupling in the
  path and removes DC offset at extreme pulse widths. [I]

### 3.3 Tuning reference

The service documentation for the 1982 model specifies **A = 442 Hz**, not 440 Hz. [C]
This is small (≈7.85 cents sharp) but audible against a 440 Hz reference and is part of the
instrument's identity in a mix. Ship it as a **default that the user can change**, not as a
hard-wired constant: our host is a DAW and a 7.85-cent global offset that cannot be turned
off is a bug, not authenticity. [I]

---

## 4. The mixer — saw, pulse, sub, noise

Four sources arrive at one summing point. On the reference panel, saw and pulse are
**on/off switches** while sub and noise are **continuous level sliders**. [C]

| Source         | Control | Range    | Taper                       | Default | Notes                                                            |
| -------------- | ------- | -------- | --------------------------- | ------- | ---------------------------------------------------------------- |
| Sawtooth       | switch  | off / on | —                           | on      | Full-amplitude ramp, falling or rising is a sign convention only |
| Pulse          | switch  | off / on | —                           | off     | Width set by the PWM section, never fixed at 50 % — see §5       |
| Sub-oscillator | slider  | 0…10     | approx. linear in level [U] | 0       | Square at **f/2**, one octave below                              |
| Noise          | slider  | 0…10     | approx. linear in level [U] | 0       | White source, low-pass filtered at **≈5 kHz** [C]                |

The sub-oscillator is a **flip-flop toggled by the main oscillator's period**, so it is
phase-locked to the DCO by construction, one octave down, always a square. It cannot be
detuned and has no width control. [C]

The noise is low-pass filtered at approximately 5 kHz before the mixer — this figure comes
from documentation of a replacement filter module for the instrument. [C] Modelling it as
flat white noise makes the instrument noticeably brighter and hissier than the reference.

**Mixer headroom is a character feature.** The studied emulator sums the four sources and
then applies a soft compression above a threshold (levels above ~0.26 of full scale are
progressively squeezed) rather than letting the sum clip. [I] This matches the behaviour of
a summing node feeding a filter input with finite headroom: with saw + pulse + sub + noise
all at maximum the reference does not clip harshly, it thickens. Model the mixer output
stage as a soft saturator, not as a hard clip and not as a linear sum.

---

## 5. Pulse-width and PWM

The pulse is produced by a **comparator between the ramp and a control voltage**. [C] There
is no separate pulse oscillator; the pulse and the saw are two readings of the same ramp,
which is why they are perfectly phase-locked and why the pulse cannot be detuned against
the saw.

Controls:

| Control    | Type         | Positions / range        | Default  | Interaction                                                                  |
| ---------- | ------------ | ------------------------ | -------- | ---------------------------------------------------------------------------- |
| PWM source | 3-way switch | `MANUAL` / `LFO` / `ENV` | `MANUAL` | Selects what drives the comparator CV                                        |
| PWM depth  | slider       | 0…10                     | 0        | In `MANUAL` this **is** the width; in `LFO`/`ENV` it is the modulation depth |

The single slider serves two semantically different jobs depending on the switch. That is
not an accident to be tidied up — it is the interaction the player expects, and our UI must
reproduce the dual meaning (with the label changing) rather than splitting it into two
controls. [C]

**Width range.** At depth 0 the pulse is a square (50 % duty). The reference emulator maps
depth to a comparator threshold of `0.5 − 0.45 × depth`, i.e. a duty cycle sweeping from
50 % down to **5 %**, never reaching zero. [I] Service-procedure discussions for the 1984
model reference a calibration check across **50 % to 25 %** duty. [R] The two are not in
conflict — the calibration check need not exercise the full range — but the true minimum
width is **unknown**. Build to 50 %→5 % as the [I] target and flag it for measurement.

**Update timing matters.** The reference emulator only updates the comparator threshold at
the moment the phase wraps, so a fast modulator cannot change the width mid-cycle. [I]
This is the correct behaviour to copy: updating the threshold continuously lets a
fast LFO produce a spurious extra edge inside a single cycle, which is an audible click the
hardware does not make.

**PWM by envelope is a per-voice modulation** (each voice has its own envelope generator),
while PWM by LFO is **global** (one LFO for the instrument). Two voices held together will
therefore stay locked in `LFO` mode and diverge in `ENV` mode. [I] — derived from the
one-LFO / per-voice-envelope structure, which is [C].

---

## 6. The high-pass filter

A single-pole (**6 dB/octave**), **non-resonant**, **non-modulatable** high-pass with a
four-position slider. [C]

**1982 model** [C]:

| Position | Behaviour                  |
| -------- | -------------------------- |
| 0        | No filtering               |
| 1        | −6 dB/oct below **154 Hz** |
| 2        | −6 dB/oct below **339 Hz** |
| 3        | −6 dB/oct below **720 Hz** |

**1984 model** [C] — note that the positions are _not_ the same, and position 0 is a bass
**boost**, not a bypass:

| Position | Behaviour                       |
| -------- | ------------------------------- |
| 0        | **+6 dB low shelf below 65 Hz** |
| 1        | No filtering                    |
| 2        | −6 dB/oct below **225 Hz**      |
| 3        | −6 dB/oct below **720 Hz**      |

The corner frequencies for the 1982 model were derived from the component values in the
schematic via `f = 1/(2πRC)`; the 1984 figures come from a separate community measurement.
Both are cited in §19. The four positions are **detented, not continuous** — a continuous
knob here would be a functional change, not a cosmetic one, because patches depend on
landing exactly on these four responses. [C]

### 6.1 Where it sits — a genuine source conflict, and it matters

The panel places the high-pass slider immediately before the filter section, which reads as
"HPF then VCF". Circuit analysis of the 1984 model contradicts this: there is **one** HPF
for the whole instrument, operating on the **summed** output of all six voices, **after**
the VCF and VCA. [R] A separate summary of the same instrument's signal flow states the
per-voice order as mixer → HPF → VCF. [R] Both cannot be true.

**Resolution, with reasoning.** Take the _post-sum, post-VCF_ placement. Three arguments:
(a) the specific claim is the more detailed one and is made from the schematic, describing
the mechanism (all voice chips routed to one op-amp, HPF after it) rather than restating
the panel layout; (b) it is consistent with the part count — six voice filter/amplifier
modules and one high-pass network; (c) the panel-order claim is exactly the misreading the
panel layout invites. **[R], marked as a decision, not a certainty.**

**Why it is implementation-critical.** If the VCF and VCA were perfectly linear the two
placements would be indistinguishable. They are not: the VCF is strongly non-linear at high
resonance and drive. Removing bass **before** the filter means the filter never sees that
energy and so never distorts on it; removing it **after** means the filter distorts on the
full-bandwidth signal and the high-pass then strips the fundamental while leaving the
intermodulation products it generated. The second is audibly dirtier on bass patches with
resonance up. Build the second, and have QA compare against reference material before this
is locked (§17, test V-6).

---

## 7. The low-pass filter

**Topology.** Four-pole, **24 dB/octave**, resonant low-pass built around a custom OTA
array — four operational transconductance amplifiers in a cascade with a global feedback
path for resonance, not a discrete transistor ladder. [C] In the 1984 model the same OTA
array plus a VCA are potted into a single voice module, which is why that model's filter is
often described as more uniform voice-to-voice than the 1982 model's discrete build. [R]

For implementation, a four one-pole-cascade virtual-analogue structure with a resonance
feedback term `k = 4 × resonance` and zero-delay-feedback resolution of the loop is the
right class of model, and is what the studied emulator uses. [I] The important detail is not
the specific topology name but three behaviours:

1. **Self-oscillation.** Resonance reaches self-oscillation. Reported onset is around
   **9/10 of the resonance slider's travel**. [R] Above that the filter sings a clean sine
   at the cutoff frequency with no input.
2. **Passband loss with resonance.** As resonance rises the passband level drops; the
   reference does not compensate it away. Do not add automatic gain make-up: the "thinning
   out as you turn resonance up" is part of the sound.
3. **Cutoff shifts with resonance.** The studied emulator adds a cutoff offset proportional
   to resonance (`+0.5 × resonance` octaves at full). [I] This is a small but characteristic
   detuning of the resonant peak relative to the marked cutoff.

**Cutoff range.** The reference emulator maps the cutoff slider to
`f = 7.8 Hz × 2^(16.67 × slider)`, i.e. a base of 7.8 Hz and about **16.7 octaves** of
slider travel, clamped at Nyquist. [I] A modern commercial emulation of the same instrument
states its range as **20 Hz to 24 kHz** [R]. The hardware's true endpoints are **unknown**.
Build to roughly 20 Hz → 20 kHz over the slider with an exponential (constant
octaves-per-unit) taper, and treat the exact endpoints as a tuning parameter. The
filter is reported to track pitch accurately over **about 8 octaves** when key-follow is
engaged. [R]

**Where the non-linearity lives.** Two places, and only two:

- At the **filter input**, as saturation of the summed mixer signal driving the first pole.
  This is what makes the instrument thicken rather than clip when all four sources are up.
- In the **resonance feedback path**, which limits self-oscillation amplitude and produces
  the characteristic "squelch" — the resonant peak's amplitude compressing when a loud
  transient passes through. The 1982 model is consistently reported as more pronounced here
  than the 1984 model. [R]

Do not place saturation on the filter _output_; that produces a filter that distorts
brightly rather than one that distorts and then filters the distortion, which is the wrong
character.

### 7.1 Filter control set

| Control             | Range  | Unit              | Taper                               | Default | Interaction                                                            |
| ------------------- | ------ | ----------------- | ----------------------------------- | ------- | ---------------------------------------------------------------------- |
| Cutoff (`FREQ`)     | 0…10   | slider units → Hz | exponential, ≈constant octaves/unit | 10      | Sums in the octave domain with every other cutoff modulator            |
| Resonance (`RES`)   | 0…10   | —                 | approx. linear in feedback `k` [I]  | 0       | Raises cutoff slightly; reduces passband gain; self-oscillates ≈9+ [R] |
| Envelope amount     | 0…10   | octaves           | linear in octaves [I]               | 0       | Multiplied by the ENV polarity switch                                  |
| Envelope polarity   | switch | `+` / `−`         | —                                   | `+`     | Inverts the envelope's contribution only                               |
| LFO amount          | 0…10   | octaves           | linear in octaves [I]               | 0       | Global LFO, so all voices move together                                |
| Key follow (`KYBD`) | 0…10   | 0…100 %           | linear [C]                          | 0       | 100 % ≈ 1 octave of cutoff per octave of keyboard                      |

**Modulation summing is in the octave (exponential) domain**, not in Hz. Every contributor
adds an octave offset to the base cutoff and the sum is then exponentiated once. [I] This
is both what a 1 V/octave control input does physically and the only way the modulation
depths stay musically constant across the keyboard.

**Depths in real units** — from the studied emulator's constants, therefore [I], and the
single largest gap in this sheet:

| Path                | Depth at full                                                         |
| ------------------- | --------------------------------------------------------------------- |
| Envelope → cutoff   | ±12 octaves [I]                                                       |
| LFO → cutoff        | ±3 octaves [I]                                                        |
| Bend lever → cutoff | ±4 octaves [I]                                                        |
| Key follow → cutoff | ±5 octaves across the 5 octaves either side of middle C, i.e. 1:1 [I] |

±12 octaves is very large and is almost certainly the emulator author's choice rather than a
measurement. Treat it as an upper bound that makes the extreme slider positions behave, and
have QA bracket it (§17, test V-4).

---

## 8. The VCA and the ENV/GATE switch

One switch selects what drives the amplifier: [C]

- **`ENV`** — the ADSR drives the VCA. Normal behaviour.
- **`GATE`** — the VCA is driven by the key gate directly. The envelope is _still running_
  and still available to the filter and to PWM; it simply no longer controls level.

`GATE` is not a hard on/off. The reference applies a very short ramp on each edge to
suppress clicks: measured **attack ≈ 3 ms, release ≈ 6 ms**, with the same curve shapes as
the main envelope's attack and release. [C] The studied emulator uses 2.47 ms / 5.7 ms with
a sustain of 0.98. [I] Either is fine; a true rectangular gate is not — it clicks in a way
the reference does not.

The practical consequence: `GATE` plus a filter envelope gives you the organ-like sound
where the level is flat but the timbre moves. Players use it constantly. Both switch
positions must be per-patch state.

There is also a master VCA level control whose taper the reference emulator models as
`gain = 0.1 × 1.2589^(10 × level)`, i.e. **−20 dB at 0, −10 dB at mid, 0 dB at full** — a
straight 20 dB exponential law. [I]

---

## 9. The envelope

**One ADSR generator per voice**, shared between VCF (via the amount slider and polarity
switch) and VCA (if the switch is in `ENV`) and PWM (if the switch is in `ENV`). There is
no second envelope. This is the single biggest constraint on what the instrument can do and
must not be "improved" in our model. [C]

### 9.1 Times

Manufacturer specification [C]: attack **1 ms – 3 s**, decay **2 ms – 12 s**, sustain
**0 – 100 %**, release **2 ms – 12 s**.

Direct measurement of the 1982 instrument disagrees with the published decay/release
maximum by a large factor, and the measurement is the better number because its method is
published [C]:

| Slider (0…10) | Attack (s) | Decay (s)  | Release (s) |
| ------------- | ---------- | ---------- | ----------- |
| 0             | 0.001      | 0.002      | 0.002       |
| 2.5           | 0.03       | 0.096      | 0.096       |
| 5             | 0.24       | 0.984      | 0.984       |
| 7.5           | 0.65       | 4.449      | 4.449       |
| 10            | **3.25**   | **19.783** | **19.783**  |

Decay and release measured **identical**, which is consistent with one timing circuit
serving both. Build them from one shared curve. [C]

**Conflict, and the resolution.** The manual says 12 s; the measurement says 19.8 s. Take
the measurement: it states its instrument, its method (waveform analysis in Sonic
Visualiser) and its slider positions, whereas the manual figure is a round marketing-grade
number and the manual itself warns that its envelope diagrams are not to scale. Note also
that the measured decay is the time to reach _silence_, while a manufacturer may quote a
time constant or a time to −60 dB; that alone could account for the factor. Implement
19.8 s and expose the curve as data so it can be retuned. [C]/[I]

The slider→time relationship is **logarithmic, not linear**. A published fit is
`t = t_min + (e^(0.5·s) − 1)/(e^5 − 1) × 3.25` for attack, with an analogous 0.4 exponent
for decay/release. [C] For implementation, interpolating the five measured points above is
simpler and more faithful than the fit; that is what the reference emulator does. [I]

### 9.2 Segment shapes

- **Attack: inverted exponential, one time constant per segment.** Measured normalised
  levels at slider 10 fit `L(x) = (1 − e^(−x)) / 0.632` where `x` is the fraction of the
  attack duration elapsed. [C] The `0.632` denominator is exactly `1 − e⁻¹`, i.e. the
  segment ends at exactly one RC time constant. This is a _fast-then-slow_ curve, not
  linear, and not the "3–5 time constants" that a generic analogue-envelope model assumes.
  Getting this wrong makes short attacks sound soft.
- **Decay and release: exponential decay over ≈3.5 time constants.** Fit
  `L(x) = S + (1 − S)·e^(−3.5x) − e^(−3.5)` for decay and `L(x) = S·e^(−3.5x) − e^(−3.5)`
  for release. [C] The trailing `− e^(−3.5)` term forces the segment to actually reach zero
  at the end rather than approaching it asymptotically.

### 9.3 A measured behaviour that contradicts textbook analogue envelopes

On a textbook analogue ADSR, raising the sustain level **shortens** the decay segment,
because the capacitor has less distance to travel. Direct measurement on this instrument
found decay duration essentially **unchanged** by sustain level (slider 10: 19.78 s at
sustain 0, 17.11 s at sustain 5). [C] Model decay duration as a function of the decay
slider **only**. This is the kind of detail that a "physically reasonable" implementation
gets wrong by being reasonable.

---

## 10. The LFO

**One LFO for the whole instrument**, not one per voice. Two voices sounding together are
therefore modulated in phase — this is a defining characteristic, and per-voice LFOs would
change the instrument. [C]

| Property            | Value                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Waveform            | Triangle [C]                                                                  |
| Rate, specified     | **0.3 Hz – 20 Hz** [C]                                                        |
| Rate, measured      | slider 0 / 2.5 / 5 / 7.5 / 10 → **0.30 / 0.85 / 3.39 / 11.49 / 22.22 Hz** [I] |
| Rate taper          | Logarithmic; interpolate the five points above                                |
| Delay, measured     | slider 0 / 2.5 / 5 / 7.5 / 10 → **0 / 0.064 / 0.85 / 1.20 / 2.79 s** [C]      |
| Fade-in after delay | **0 / 0.053 / 0.188 / 0.348 / 1.15 s** [C]                                    |
| Trigger             | Key-on, when no other voice is already sounding [I]                           |

The **delay control is two-stage**: a period of complete silence, then a fade-in ramp to
full depth. Both stages were measured separately (table above) and both scale with the one
slider. A single-stage "fade in over N seconds" model is wrong and audibly so on slow
vibrato patches. [C]

Modulation depths from the LFO, in real units:

| Destination         | Depth at full slider                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| DCO pitch (vibrato) | **±300 cents** [I] — the emulator's comment cites the manual's page 14 |
| VCF cutoff          | **±3 octaves** [I]                                                     |
| Pulse width         | full width range (see §5)                                              |

The bend lever's pitch axis is **±700 cents** at full depth. [I]

---

## 11. The chorus

This is the single most identity-carrying block in the instrument and the one where a
generic "chorus" plug-in will not do.

### 11.1 Structure

A **triangle-wave LFO** modulating **two bucket-brigade delay lines** of 256 stages each,
one per output channel. The right channel's modulation is **inverted** — 180° out of phase
with the left — which is what produces the wide stereo image from a mono source. Dry signal
is mixed with wet in both channels. [C]

Signal conditioning around the delay lines, from the reference emulator [I]:

- A one-pole low-pass at **≈7.2 kHz** _before_ the delay line (an anti-alias filter for the
  BBD's sampling; community analysis of the schematic reports a 12 dB/oct low-pass in this
  position, so a one-pole is a simplification [R]).
- A one-pole low-pass at **≈10.6 kHz** on each delayed output.

The BBD clock works out at roughly **70 kHz** [C] (256 stages, ~1.5–5.4 ms delay range),
so the delay line's own sampling artefacts are minor and do **not** need modelling as
bit-crushing.

**No compander.** Most BBD chorus designs put a compressor before the delay line and an
expander after it to fight the BBD's noise and distortion. This design has neither, which
means the delay path **distorts when the input is loud**, and the delayed copy of a
sawtooth measurably rounds off compared to the dry copy. [C] Model this as a mild
saturation on the delay-line input. The reference emulator has the saturation coded but
commented out (`tanh(x·0.6)·1.862`), so the exact amount is [U] — but its presence is [C].

### 11.2 The three modes, in real units

Measured from the 1982 instrument by waveform analysis; the I+II rate was independently
confirmed by a second author's analysis tool. [C]

| Mode       | LFO rate     | Delay, left    | Delay, right                  | Image            | Character                |
| ---------- | ------------ | -------------- | ----------------------------- | ---------------- | ------------------------ |
| **I**      | **0.513 Hz** | 1.54 – 5.15 ms | 1.51 – 5.40 ms (inverted mod) | Stereo           | Mild                     |
| **II**     | **0.863 Hz** | 1.54 – 5.15 ms | 1.51 – 5.40 ms (inverted mod) | Stereo           | Deeper, richer           |
| **I + II** | **9.75 Hz**  | 3.22 – 3.56 ms | 3.28 – 3.65 ms (**in phase**) | Effectively mono | Fast wobble, rotary-like |

Three things in that table are the whole point and are easy to get wrong:

1. **Modes I and II differ only in rate.** Same delay range, same depth. Anyone who
   implements mode II as "deeper" is modelling the description rather than the circuit.
   The perceived extra depth comes entirely from the faster sweep. [C]
2. **I+II is not the two modes summed.** It is a _third_ setting: rate jumps by more than
   10×, the delay range collapses to a narrow ±0.17 ms around 3.4 ms, and the right
   channel's modulation stops being inverted. It is a vibrato, not a chorus. [C]
3. **The delay times are far shorter than a conventional chorus.** Standard chorus practice
   puts the minimum delay around 7 ms; modes I and II run from 1.5 ms. By the usual
   taxonomy modes I and II are **flangers** and I+II is a **vibrato**. [C] A model built to
   textbook chorus delay times will not sound like this instrument at all.

The wet/dry ratio in the reference emulator is **0.44 dry / 0.56 wet** in all three
active modes. [I]

**Mode switching must be click-free.** The reference emulator ramps the mix to fully dry,
switches the delay parameters, then ramps back. [I] Copy this: changing delay time under a
signal produces a pitch discontinuity otherwise.

### 11.3 Model-to-model difference

The 1984 instrument's chorus is consistently reported as **noticeably quieter** — less hiss
— than the 1982 instrument's. [R] If we ship a "vintage noise" control, this is the axis it
should move.

---

## 12. The arpeggiator

Present on the 1982 model, absent from the 1984 model (which has MIDI instead). [C]

| Control      | Positions / range             | Notes                                                                  |
| ------------ | ----------------------------- | ---------------------------------------------------------------------- |
| Mode         | `UP` / `UP & DOWN` / `DOWN`   | [R]                                                                    |
| Range        | 1 / 2 / 3 octaves             | [R]                                                                    |
| Rate         | **1.5 – 50 Hz**               | [R] — steps per second, i.e. 90 – 3000 steps/min                       |
| Clock source | Internal, or external trigger | External is **one pulse per note at +5 V**, _not_ 24 ppqn DIN sync [C] |

The rate range is worth noting: 1.5 Hz is very slow and 50 Hz is well past the point where
individual steps fuse into a tone. Both extremes are used musically.

The held-note set feeds the pattern; releasing all keys stops it. Behaviour when notes are
added to a running pattern (immediate re-sort vs. insert at end of cycle) is **unknown**.

**Our host is a DAW**, so the arpeggiator must additionally sync to host tempo with note
divisions. That is a deliberate departure and should be exposed as a mode switch
(`FREE` / `SYNC`) rather than replacing the free-running rate. [I]

---

## 13. Voices and voice assignment

Six voices, one DCO each. [C] The assigner is **cyclic (rotary)**: voices are handed out in
rotation, so the seventh simultaneous note steals the voice used by the first. [R] A second
selectable mode assigns in fixed channel order 1→6 while earlier keys are held. [R] A
unison mode stacks all six voices on one key. [R]

Two consequences for the model:

- **Round-robin is audible even below the voice limit**, because consecutive repeated notes
  land on different voices with slightly different analogue characteristics. A model that
  always uses voice 0 for a monophonic line loses this. Implement rotation, and give each
  voice its own small fixed offsets (§14).
- **Voice stealing must retrigger, not crossfade.** The hardware simply reloads the
  divider and retriggers the envelope on the stolen voice. Modelling a graceful fade would
  be an improvement and therefore wrong.

Unison stacks all six voices with **no detune control** — the spread comes only from
voice-to-voice variation. Our model must therefore have real voice-to-voice variation or
unison will sound like a 15 dB level boost and nothing else. [I]

---

## 14. Character artefacts worth modelling

| Artefact                            | Magnitude                                        | Confidence | Why it matters                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pitch is drift-free                 | Exact; divider-derived                           | [C]        | Do **not** add oscillator drift. This instrument's identity is partly that it never goes out of tune. Adding vintage-analogue drift here is a category error. |
| Reference pitch A=442 Hz            | +7.85 cents vs. 440                              | [C]        | Default on, user-defeatable                                                                                                                                   |
| Ramp amplitude compensation         | Peak held constant across keyboard by the DCO CV | [C]        | Imperfect compensation means slight level tilt across the keyboard; magnitude **unknown**                                                                     |
| Noise source band-limited           | 1-pole LPF at ≈5 kHz                             | [C]        | Flat white noise is too bright                                                                                                                                |
| Mixer soft compression              | Above ≈0.26 of full scale                        | [I]        | Prevents hard clipping with all sources up                                                                                                                    |
| BBD path distortion                 | Delayed copy rounds off vs. dry; no compander    | [C]        | Amount [U]                                                                                                                                                    |
| BBD sampling                        | ≈70 kHz, 256 stages                              | [C]        | Minor; do not model as bit-crushing                                                                                                                           |
| Chorus hiss                         | Present, model-dependent; 1984 unit much quieter | [R]        | The one place a "noise" control belongs                                                                                                                       |
| Filter passband loss with resonance | Present, uncompensated                           | [C]        | Do not add make-up gain                                                                                                                                       |
| Cutoff rises with resonance         | ≈ +0.5 octave at full                            | [I]        | Small but characteristic                                                                                                                                      |
| Voice-to-voice variation            | Present; magnitude **unknown**                   | [U]        | Required for unison to work at all. Suggest per-voice fixed random offsets: cutoff ±2 %, VCA gain ±0.3 dB, envelope times ±3 % [I]                            |
| PWM at extreme width                | DC offset removed by AC coupling                 | [I]        | Modelled as a 0.998/sample leak                                                                                                                               |
| Note-on phase                       | Not reset to zero                                | [I]        | Fast attacks on low notes stay audible                                                                                                                        |

---

## 15. Verification — what QA must measure

Each test states a stimulus, a measurement, a target and a tolerance. Tolerances are wide
where the source figure is [I] or [R] and tight where it is [C].

| ID       | Test                   | Method                                                                                                        | Target                                                                                           | Tolerance                                                                             |
| -------- | ---------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| **V-1**  | Tuning reference       | Saw only, note A4, no modulation. FFT peak.                                                                   | 442.0 Hz (default) / 440.0 Hz (defeated)                                                         | ±0.5 cent                                                                             |
| **V-2**  | Envelope times         | VCA=ENV, sustain 0, decay slider at 0 / 2.5 / 5 / 7.5 / 10. Measure time from peak to −60 dBFS.               | 0.002 / 0.096 / 0.984 / 4.449 / 19.783 s                                                         | ±5 %                                                                                  |
| **V-3**  | Attack shape           | Attack slider 10, sample the envelope at 0.5 s intervals.                                                     | 0.224 / 0.410 / 0.580 / 0.716 / 0.847 / 0.956 at 0.5–3.0 s                                       | ±0.02 absolute                                                                        |
| **V-4**  | Filter env depth       | Cutoff at minimum, env amount full, sustain 1. Measure cutoff at envelope peak.                               | 12 octaves above base                                                                            | **±3 octaves** — this figure is [I]; the test exists to bracket it, not to confirm it |
| **V-5**  | Self-oscillation onset | No sources enabled, sweep resonance. Find first slider value producing sustained output >−40 dBFS.            | Slider ≈9.0 / 10                                                                                 | ±1.0 slider unit                                                                      |
| **V-6**  | HPF placement          | Bass patch, resonance 10, HPF position 3. Compare spectrum against the same patch with HPF placed pre-filter. | Post-VCF placement must show measurably **more** energy in 200 Hz–2 kHz intermodulation products | Qualitative; both variants must be renderable for A/B                                 |
| **V-7**  | HPF corners (1984 map) | White noise through each position, measure −3 dB point.                                                       | pos 0: +6 dB shelf below 65 Hz; pos 1: flat ±0.2 dB; pos 2: 225 Hz; pos 3: 720 Hz                | ±5 % on corners, ±0.5 dB on the shelf                                                 |
| **V-8**  | Chorus rates           | Sine input, chorus I / II / I+II. Measure the modulation period from the delay-induced pitch wobble.          | 0.513 / 0.863 / 9.75 Hz                                                                          | ±2 %                                                                                  |
| **V-9**  | Chorus delay range     | Impulse train, measure min and max delay of the wet copy per channel, mode I.                                 | L 1.54–5.15 ms, R 1.51–5.40 ms                                                                   | ±0.1 ms                                                                               |
| **V-10** | Chorus stereo phase    | Mode I vs. mode I+II. Cross-correlate L and R modulation.                                                     | Modes I/II: correlation ≈ −1. Mode I+II: ≈ +1                                                    | sign must be correct; magnitude >0.8                                                  |
| **V-11** | Noise spectrum         | Noise slider only, full. Measure −3 dB point.                                                                 | 5 kHz, −6 dB/oct above                                                                           | ±15 %                                                                                 |
| **V-12** | Gate mode click        | VCA=GATE, note on/off. Measure peak sample-to-sample delta at each edge.                                      | Attack ≈3 ms, release ≈6 ms ramps present                                                        | No delta implying a rise time <1 ms                                                   |
| **V-13** | Aliasing               | Saw only, chromatic sweep C1→C8, no filter. Measure worst-case non-harmonic energy.                           | < −60 dBFS relative to fundamental                                                               | Hard limit                                                                            |
| **V-14** | Mixer headroom         | Saw + pulse + sub + noise all at maximum, filter wide open.                                                   | No sample exceeds 0 dBFS; THD rises smoothly, no hard-clip discontinuity                         | Visual/harmonic-continuity check                                                      |
| **V-15** | Voice rotation         | Play the same note 7 times, monitor voice IDs.                                                                | 0,1,2,3,4,5,0                                                                                    | Exact                                                                                 |
| **V-16** | Unison spread          | Unison, one key, no chorus. Measure spectral width of the fundamental.                                        | Non-zero spread from voice variation alone                                                       | Must be >2 cents total spread                                                         |
| **V-17** | PWM edge integrity     | PWM=LFO, LFO at 20 Hz, note C2.                                                                               | No extra pulse edges within any single oscillator period                                         | Zero violations                                                                       |
| **V-18** | LFO delay two-stage    | Delay slider 10, note on, measure LFO output envelope.                                                        | Silence 0–2.79 s, then ramp to full over 1.15 s                                                  | ±10 %                                                                                 |

---

## 16. Control inventory

Complete list, for the UI team's layout work and for parameter-ID assignment. `sl` = slider
0…10, `sw` = switch.

| Section | Control             | Type  | Range                  | Default                |
| ------- | ------------------- | ----- | ---------------------- | ---------------------- |
| DCO     | LFO depth (vibrato) | sl    | 0…10 → 0…±300 ¢        | 0                      |
| DCO     | PWM depth           | sl    | 0…10                   | 0                      |
| DCO     | PWM source          | sw3   | MAN / LFO / ENV        | MAN                    |
| DCO     | Range               | sw3   | 16′ / 8′ / 4′          | 8′                     |
| DCO     | Saw                 | sw2   | off / on               | on                     |
| DCO     | Pulse               | sw2   | off / on               | off                    |
| DCO     | Sub level           | sl    | 0…10                   | 0                      |
| DCO     | Noise level         | sl    | 0…10                   | 0                      |
| HPF     | Cutoff              | sw4   | 4 detents (see §6)     | pos 1 (flat, 1984 map) |
| VCF     | Cutoff              | sl    | 0…10                   | 10                     |
| VCF     | Resonance           | sl    | 0…10                   | 0                      |
| VCF     | Env polarity        | sw2   | + / −                  | +                      |
| VCF     | Env amount          | sl    | 0…10                   | 0                      |
| VCF     | LFO amount          | sl    | 0…10                   | 0                      |
| VCF     | Key follow          | sl    | 0…10 → 0…100 %         | 0                      |
| VCA     | Source              | sw2   | ENV / GATE             | ENV                    |
| VCA     | Level               | sl    | 0…10 → −20…0 dB        | 8                      |
| ENV     | A / D / S / R       | sl ×4 | see §9.1               | 0 / 5 / 10 / 2         |
| LFO     | Rate                | sl    | 0…10 → 0.3…22 Hz       | 5                      |
| LFO     | Delay               | sl    | 0…10 → 0…2.79 s + fade | 0                      |
| Chorus  | Mode                | sw4   | off / I / II / I+II    | off                    |
| Arp     | Mode                | sw3   | UP / UP&DOWN / DOWN    | UP                     |
| Arp     | Range               | sw3   | 1 / 2 / 3 oct          | 1                      |
| Arp     | Rate                | sl    | 1.5…50 Hz              | mid                    |
| Global  | Bend → DCO depth    | sl    | 0…10 → 0…±700 ¢        | mid                    |
| Global  | Bend → VCF depth    | sl    | 0…10 → 0…±4 oct        | 0                      |

---

## 17. Implementation order

For the synthesis engineer, in dependency order, with the "done" condition being the test IDs
from §15:

1. DCO with band-limited saw/pulse/sub + band-limited noise → V-1, V-11, V-13
2. Mixer with soft saturation → V-14
3. Envelope with the measured curves → V-2, V-3
4. VCF with octave-domain modulation summing → V-4, V-5
5. VCA with ENV/GATE → V-12
6. LFO with two-stage delay → V-18
7. PWM with wrap-synchronous update → V-17
8. Voice allocator → V-15, V-16
9. HPF on the summed bus → V-6, V-7
10. Chorus → V-8, V-9, V-10
11. Arpeggiator (free-running first, then host sync)

---

## 18. UI era-language notes

What follows describes the **design language of early-1980s Japanese programmable
polysynths as a class**. It contains no description of any specific product's artwork,
logo, typeface or badge, and nothing here may be traced from a photograph. It is a
vocabulary, and our panel must be an original composition in that vocabulary.

**Control taxonomy.** The era's defining choice is the **slider, not the knob**. A
polysynth of this generation presents its entire synthesis section as a bank of short-throw
linear faders in a single horizontal row, with rotary controls reserved for global
functions (master volume, tuning) and switches reserved for discrete choices. This is
legible from a distance in a way a knob bank is not: the row of fader caps traces the
patch's shape as a visible contour, and a player reads the patch by its silhouette. Our
panel should keep that: **the synthesis parameters are faders, and the fader tops form a
readable line**.

**Layout logic.** Left-to-right signal order, always: modulation source, then oscillator,
then mixer, then filters, then amplifier, then envelope, then effects. Sections are
separated by thin printed rules and named by a small header in a contrasting weight, not by
boxes or panels. Within a section, controls read in the order they act. A player who has
never seen the instrument can find the filter cutoff because it is where the signal path
says it should be. This is the strongest thing to borrow, and it costs nothing.

**Panel proportions.** Wide and shallow: the control surface is a horizontal band above the
keyboard with a height on the order of one-fifth to one-quarter of its width, with the
patch-memory section at one end and the performance controls (bend, modulation) as a
separate small cluster to the left of the keys, below the main panel plane. Everything is
in one plane; there are no sub-panels, no popovers, no depth. For a screen implementation,
this argues for a **single-row, horizontally scrolling or responsively wrapping strip**
rather than a grid of cards.

**Switch and button language.** Discrete choices are **multi-position slide switches or
lever switches** with the positions silkscreened beside them, not menus. Patch selection is
a row of momentary buttons each with its own indicator. The indicator is the state; there
is no separate readout of "which patch is selected" beyond which button is lit.

**Display technology.** This generation predates graphic displays entirely. The display
vocabulary available is: **single LEDs** (usually red or amber, occasionally green),
**seven-segment LED numerals** in groups of two or three for patch numbers, and printed
scales. There is no alphanumeric text display, no patch name, no waveform drawing. When we
add a display — and we will, because a DAW instrument needs patch names — it should read as
a **deliberate modern addition sitting in an era-correct panel**, not as a fake vintage
display. Do not simulate a segment display for text.

**Colour temperature.** The era's palette is warm-neutral: panels in a warm grey or beige
with a fine matte texture, legends printed in a cool dark grey or near-black, and **colour
used only as a coding system**, never decoratively. The coding is consistent and worth
copying: one accent hue per functional group, applied to the fader caps only, so the eye
can find "all the envelope controls" instantly. Indicator LEDs are the warmest thing on the
panel and are the only saturated colour. Nothing glows, nothing gradients, nothing has a
drop shadow.

**Material.** Matte painted steel or textured ABS, not gloss, not brushed metal. Fader caps
are matte plastic with a single moulded index line. End cheeks in wood or in a contrasting
moulded plastic. The whole object reads as an appliance, not as a luxury good — and that
restraint is why it still looks current.

**What to avoid.** Skeuomorphic screws, simulated scratches, fake photographic panel
textures, and any suggestion that our instrument is a scan of a real one. The era language
is achieved by **layout logic, control taxonomy and colour coding**, all of which are
functional decisions, and none of which is trade dress.

---

## 19. Sources

Every substantive claim above traces to one of these. Where two sources conflict the
conflict is stated in the body and the choice is reasoned there.

**Primary measurement (read in full via anonymous git, not via search extraction):**

1. Andy Harman / Pendragon Software, **`github.com/pendragon-andyh/Juno60`** — "Analysis of
   Roland Juno60 sound", MIT-licensed. Instrumented measurements of the DCO, envelope
   segments and durations, LFO delay, high-pass corner frequencies and chorus rates and
   delay times, with the analysis method (Sonic Visualiser) stated. Source of every [C]
   measurement in §6, §9, §10, §11. Its `Chorus/README.md` also documents the
   cross-check of the I+II rate against a second author's independent analysis tool.
2. Andy Harman, **`github.com/pendragon-andyh/junox`** — WebAudio emulation by the same
   author. Source of the [I] constants: cutoff mapping, modulation depths in octaves,
   mixer soft-compression threshold, chorus wet/dry and filter frequencies, gate-mode
   times, VCA gain law, envelope lookup tables, PWM width mapping and update timing.
   Explicitly labelled [I] throughout because an emulator constant is a design decision.

**Manufacturer documentation (via search extraction; not directly fetchable):**

3. Roland, _Juno-60 Technical Specifications_ (support.roland.com) — voice count, LFO rate
   0.3–20 Hz, envelope ranges, resonance to self-oscillation, key follow 0–100 %,
   arpeggiator mode/range switches.
4. Roland, _Juno-6 Technical Specifications_ (support.roland.com) — PWM switch positions
   ENV/MANUAL/LFO and their meaning.
5. Roland, _Juno-106 Owner's Manual_ / _Juno-106 Service Notes_ — DCO waveform inventory,
   sub-oscillator and noise as sound sources, voice-assignment modes.

**Circuit analysis and community measurement:**

6. Electric Druid, _Roland Juno DCOs_ — master clock, per-voice programmable counter,
   integrator reset by the counter's rising edge, DCO CV amplitude compensation, pulse by
   comparator. The clearest published account of the mechanism.
7. Stargirl Flowers, _The Design of the Roland Juno oscillators_ (blog.thea.codes) —
   corroborates 6 independently.
8. Sequence 15, _Analyzing the Juno-106 DCO circuit_ and _Why does the Juno-60 sound
   different from the Juno-106?_ (sequence15.blogspot.com) — the HPF-position claim in
   §6.1, and the voice-summing arrangement.
9. KVR Audio forum thread 313797 — 1984-model high-pass corner frequencies and the 12 dB/oct
   pre-BBD low-pass. Cited by source 1 rather than used directly.
10. AMSynths, _All about the IR3109 chip_, and Electric Druid, _Roland filter designs with
    the IR3109 or AS3109_ — four-OTA filter array, and the potted voice module in the 1984
    model.
11. Analogue Renaissance filter-clone documentation — noise source low-pass at 5 kHz.
    Cited by source 1.
12. Florian Anwander, _Roland Choruses and Ensemble Effects_ — BBD part complement
    (2 × clock driver + 2 × 256-stage delay).

**Secondary / reported:**

13. Wikipedia, _Roland Juno-60_ and _Roland Juno-106_ — model differences, MIDI vs.
    arpeggiator, chorus noise floor.
14. Cherry Audio DCO-106 documentation — the 20 Hz–24 kHz cutoff range figure, used only as
    a cross-check on a modern emulation and marked [R].
15. Kenton, _Instructions for arpeggio clock, Roland Juno 60_ — external clock is one pulse
    per note at +5 V, not DIN sync.
16. Syntaur forum, _Juno-106 PWM duty cycle calibration_ — the 50 %→25 % calibration range.

---

## 20. What could not be confirmed

Listed so that nobody builds to a guess, and so the next analyst knows where to dig.

1. **True minimum pulse width.** [U] Emulator implies 5 %; a service procedure mentions
   25 %. Needs an oscilloscope on a real instrument, or the service manual's PWM adjustment
   section.
2. **Envelope→cutoff depth in octaves.** [U] Only an emulator constant (±12 oct) exists.
   The largest single gap; see test V-4.
3. **LFO→cutoff and bend→cutoff depths.** [U] Same problem, same source.
4. **Filter cutoff endpoints in Hz.** [U] Only a modern emulation's stated range.
5. **HPF placement in the chain.** [R], resolved by reasoning in §6.1 but not settled.
   Two published claims contradict each other.
6. **Voice-to-voice variation magnitude.** [U] Known to exist, never measured. Our
   suggested figures in §14 are [I].
7. **BBD saturation amount.** [U] Its existence is [C], its magnitude is not.
8. **Sub and noise slider tapers.** [U] Assumed linear in level.
9. **Arpeggiator behaviour on note-add mid-pattern.** [U]
10. **Whether the 1982 and 1984 models differ in envelope timing.** [U] All envelope
    measurements here are from the 1982 model.
11. **Amplitude tilt across the keyboard** from imperfect DCO CV compensation. [U] Known to
    be a real effect; magnitude unmeasured.
12. **Resonance slider taper** — assumed linear in feedback coefficient. [U]
