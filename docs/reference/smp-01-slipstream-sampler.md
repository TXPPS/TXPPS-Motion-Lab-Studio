# Reference spec — SMP-01 Slipstream Sampler (four-engine sampler, multi-portamento, MPE)

Status: **research complete, ready to implement against**. Author: Research Analyst.
Class of device: polyphonic sampling instrument with an analysing importer, four
interchangeable playback engines (classic sample-rate conversion, granular, spectral phase
vocoder, hybrid), a per-voice portamento engine with staggered arrival, and a modulation
matrix fed by per-note MPE expression.

Like `fx-02`, this unit has **no single reference product**. It is not an emulation of
anything. Its analysis stages come from the music-information-retrieval literature, its
engines from the resampling and time-frequency literature, its expression layer from a
published standard, and its portamento behaviour from two expired patents and one piece of
published circuit analysis. That is the strongest position any sheet in this set is in: the
whole algorithm is public, well described, and free to implement.

## 0. How to read this document

Confidence markers, as in the other thirteen sheets:

- **[C]** confirmed — a specification, a paper, a patent, published circuit analysis, or
  derived analytically here from cited premises. The derivation is shown where it matters.
- **[R]** reported by a reputable secondary source, not cross-checked against a primary one.
- **[U]** unconfirmed. **Do not build to a [U] value without checking it.**
- **[I]** our own inference or design decision. Not a claim about anything published. These
  are the parts DSP is free to argue with; the [C] parts it is not.
- **[X]** explicitly unknown. Listed in §13.

**Sourcing constraint, and it is worse here than for `fx-02`.** Direct fetch is blocked for
every domain tested from this build environment — the egress proxy answers `EGRESS_BLOCKED`
and a direct `curl` is refused at the CONNECT tunnel with 403. `ccrma.stanford.edu`,
`arxiv.org`, `hal.science`, `dafx.de`, `patents.google.com`, `audition.ens.fr` and
`en.wikipedia.org` were all attempted and all refused. **Every source in §12 was reached by
search-engine extraction only**, and no repository was cloned (the brief forbids it, and
§0.1 explains why that is the right call here anyway).

The consequence is specific and must not be glossed over. **The equations in §3.3, §3.4 and
§4.4 are the standard published formulations, transcribed here from knowledge of them and
corroborated against the cited sources' descriptions — not copied from a fetched paper.**
The _form_ of each is [C]; a transcription error in any of them is silent and fatal, in
exactly the way `fx-02` §0 warns about its window equations. The implementing engineer must
pull the four papers named in §12.1 and §12.4 and check the equations before coding. Every
numeric parameter attached to those equations is marked separately, and most are [I].

**Intellectual-property rule for this file.** No manufacturer name, product name or model
number appears anywhere in the body of this document. Where a behaviour is known because a
particular instrument or application does it, the behaviour is described and the product is
named **only in §12, as a citation**. This is stricter than `syn-01` and matches `syn-05`.
The reason is that this unit has no hardware reference to model, so there is no engineering
need to name one, and a name that is never written cannot leak into a symbol, a preset or a
tooltip. Nothing here describes or traces any product's panel, artwork or visual identity.

### 0.1 Provenance and licence

| Class              | What it is                                             | Sources used here                                                                                        | May a value be written into `motionwave/`? |
| ------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Documentation**  | Papers, patents, standards, published circuit analysis | The MIR and DSP literature in §12; two expired US portamento patents; the MPE specification via `std-01` | Yes                                        |
| **Measurement**    | Instrumented observation of hardware                   | _None._ There is no hardware here to measure.                                                            | n/a                                        |
| **Implementation** | Somebody's code implementing any of the above          | _None read._ No repository was cloned and no source was transcribed.                                     | n/a — the question does not arise          |

**There is no copyleft exposure in this sheet at all**, which is the first time that is true
in this set. `scripts/licence-guard.mjs` has nothing to catch here because nothing was read
that it guards against. That is worth preserving: if a later analyst wants a reference
implementation of a phase vocoder or a YIN estimator, the answer is to obtain the papers,
not the repositories — the papers give the algorithm, which is the part we need, without the
expression, which is the part we must not take.

---

## 1. What this unit is, and the one thing it does that nothing else here does

Thirteen of the fourteen units are models of something. This one is not. Its job is to take
a file the user drops on it and turn it into an instrument that plays, and then to give four
genuinely different ways of playing it. Everything in §3 exists so that the drop works
without a dialogue, and everything in §4 exists because the four ways of moving a recording
in pitch and time have different, non-overlapping failure modes.

The distinctive feature is §5, and it is worth stating up front because the rest of the
document is arranged around it.

**A sampler transposes by reading faster or slower. A glide therefore moves the read rate,
which means a gliding sample also moves through its own material faster or slower.** Derived
exactly: for a linear glide of `n` semitones over `T` seconds, the source consumed is

```
    ∫₀ᵀ 2^(n·t / 12T) dt  =  T · 12 / (n · ln2) · (2^(n/12) − 1)
```

For `n = 12`, `T = 2 s` that is **2.885 seconds of source consumed in 2 seconds of wall
clock — 44 % more material than the note would otherwise have reached**. **[C, derived]**
On an oscillator this term does not exist; on a sampler it is the difference between a glide
that sounds like a glide and a glide that sounds like a tape speeding up. It is also the
single clearest argument for the granular and spectral engines, both of which decouple the
read rate from the pitch and make the term vanish. §5.6 states what each engine does with it.

The second distinctive feature is that the glide is **per voice, with derived offsets and
staggered arrival**, so a chord does not slide as a block. §5.4 specifies it numerically.

---

## 2. Architecture

### 2.1 Signal path

```
   ┌───────────────────────── one voice, × N ─────────────────────────┐
   │                                                                   │
   │   ZONE (sample data, root, loop, engine)                          │
   │        │                                                          │
   │        ▼                                                          │
   │   ┌──────────────────────────────────────────────┐                │
   │   │  PLAYBACK ENGINE — exactly one of four        │                │
   │   │                                               │                │
   │   │   CLASSIC   interpolated read at rate r       │                │
   │   │   GRANULAR  playhead speed ρ  ⟂  grain rate r │                │
   │   │   SPECTRAL  phase vocoder α = p/ρ, then × p   │                │
   │   │   HYBRID    transient ∥ tonal ∥ residual      │                │
   │   └───────────────────┬───────────────────────────┘                │
   │                       │                                            │
   │            ┌──────────▼──────────┐                                 │
   │            │  FILTER  SVF, 5 modes│  cutoff, res, key follow       │
   │            └──────────┬──────────┘                                 │
   │                       ▼                                            │
   │            ┌─────────────────────┐                                 │
   │            │  VCA  (ENV 1)       │                                 │
   │            └──────────┬──────────┘                                 │
   │                       ▼                                            │
   │                  pan (equal power)                                 │
   └───────────────────────┼────────────────────────────────────────────┘
                           ▼
               N voices summed on one bus ──► instrument output
```

### 2.2 Control path

```
  NOTE ON ──┬─► voice allocator ──┬─► GLIDE ENGINE (§5) ─► note pitch, per voice
            │                     └─► slot index v ──────► per-voice glide offset δᵥ
            ├─► zone lookup (key, velocity, round robin)
            ├─► snapshot of the member channel's controller state  (std-01 §6.1 rule 5)
            └─► ENV 1..3 gate, LFO 1..3 retrigger, RANDOM draw (seeded, §4.6)

  MPE member channel ─┬─► NOTE BEND   (dimension 1, 14-bit)  ─┐
                      ├─► PRESSURE    (dimension 2, 7-bit)    ├─► MODULATION MATRIX
                      └─► SLIDE/CC 74 (dimension 3, 7-bit)    │   (§6) 24 sources
  MPE master channel ─┬─► MASTER BEND / PRESSURE / SLIDE ─────┤        34 destinations
                      └─► CC 1, 2, 11, 64, 5, 65, 84 ─────────┘        16 routings

  pitch(voice) = glide(note) + rootOffset + zoneTune + fine
               + masterBend + noteBend + Σ(matrix → PITCH)
  rate(voice)  = 2^(pitch / 12) × (fsFile / fsHost)
```

Two properties of that last pair are load-bearing and are tested in §9.

- **Everything that moves pitch is summed in semitones and exponentiated once.** This is the
  same rule as `syn-01` §7 and `syn-05` §9.2, and the reason is the same: a modulation depth
  expressed in Hz is a different musical interval at every point on the keyboard.
- **The glide is applied to the note's own pitch only**, before the sum — not to the sum. If
  the glide smoothed the summed pitch, a pitch-bend gesture during a glide would be dragged
  through the glide's own time constant and the wheel would feel broken. §5.5.

### 2.3 The data model

A **zone** is the unit of mapping. Fields, with the de-facto opcode names from the open
text-based mapping format cited in §12.6 given in brackets where one exists, because using
the established names makes import and export from that format a table lookup rather than a
translation layer:

| Field                                       | Type                  | Notes                                                        |
| ------------------------------------------- | --------------------- | ------------------------------------------------------------ |
| key range [`lokey`, `hikey`]                | 0..127 each           | inclusive                                                    |
| velocity range [`lovel`,`hivel`]            | 1..127 each           | inclusive                                                    |
| root [`pitch_keycenter`]                    | 0..127                | the key at which the read rate is `fsFile/fsHost`            |
| fine tune                                   | ±100 cents            | the sub-semitone residue of pitch detection (§3.4)           |
| sample span                                 | start, end, in frames | after trim (§3.2)                                            |
| loop [`loop_start`,`loop_end`, `loop_mode`] | frames, enum          | `no_loop` / `loop_continuous` / `loop_sustain` / `alternate` |
| loop crossfade                              | frames                | §3.5                                                         |
| engine                                      | enum of four          | per zone, not per note (§4.6)                                |
| round-robin group, choke group              | ints                  |                                                              |
| gain, pan, key tracking                     | dB, −1..1, 0..2       | key tracking 0 = fixed pitch, 1 = normal, 2 = double         |

A **group** is a set of zones sharing envelopes, filter and engine settings. An
**instrument** is a set of groups plus the global controls in §7. Nothing above is
per-voice; voices hold only state.

---

## 3. Import — analysing a one-shot

A user drops a file. Everything in this section runs **off the audio thread**, at load, once,
and writes only into the zone model. None of it may run on a note-on: the analysis is
hundreds of milliseconds of work and the audio callback has 5.33 ms.

### 3.1 Pipeline order, and why it is this order

1. Decode to `float32` at the file's **native rate**. Do not resample on import.
2. DC measurement and removal (§3.2).
3. True-peak and loudness measurement. Store a gain; **do not rewrite the samples** (§3.2).
4. Silence trim (§3.2).
5. Onset detection over the trimmed span (§3.3).
6. Pitch detection over the sustain region (§3.4).
7. Loop-point search, which needs the pitch period from step 6 (§3.5).
8. Zoning decision, which needs the outputs of 5 and 6 (§3.6).

**Why native rate.** Resampling before analysis moves every onset and every loop candidate
off the sample indices the file actually has, and adds one generation of interpolation error
to material that is about to be interpolated again at playback. The rate ratio belongs in the
playback increment, where it costs nothing: `r = 2^(pitch/12) × fsFile/fsHost`. [I]

**Why measure and store rather than normalise.** A destructive normalise cannot be undone,
re-quantises the data, and — for a file already close to full scale — is the step that turns
inter-sample peaks into clipping. Store `gainDb` on the zone. [I]

### 3.2 Conditioning

| Step        | Rule                                                                                                                                                 | Why                                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| DC removal  | Subtract the whole-file mean if `\|mean\| > 1e−4` (−80 dBFS)                                                                                         | A DC offset makes every zero-crossing test in §3.5 wrong and puts a step at every loop join. [I] on the threshold                                |
| Peak        | True peak, 4× oversampled                                                                                                                            | A sample that reads −0.1 dBFS at 1× can be +0.6 dBTP; the zone's headroom budget needs the real number. [I]                                      |
| Trim, head  | First frame where 1 ms RMS exceeds `max(−60 dBFS, noiseFloor + 12 dB)`, then **back off 5 ms** or to the previous zero crossing, whichever is nearer | Trimming exactly at the threshold removes the first few samples of the attack, and a transient missing its leading edge is audibly softened. [I] |
| Trim, tail  | Last frame above the same threshold, plus 50 ms                                                                                                      | A hard tail cut is a click; 50 ms is below the shortest musically useful release and above the longest audible cut artefact. [I]                 |
| Noise floor | 10th percentile of 20 ms RMS frames                                                                                                                  | A percentile, not a minimum: one digital-silence frame in a noisy file makes a minimum useless. [I]                                              |

### 3.3 Onset detection

**Detection function: half-wave-rectified spectral flux**, the standard first choice for
percussive and mixed material. **[C]**

```
    X(m,k) = STFT of the trimmed signal,  Hann window, N = 1024, hop H = 256
    SF(m)  = Σ_k  H( |X(m,k)| − |X(m−1,k)| ),     H(x) = (x + |x|)/2
```

At 44.1 kHz, `H = 256` is a **5.8 ms** frame grid. The commonly published configuration is
`N = 1024, H = 512`, an 11.6 ms grid **[R]**; we halve the hop because this analysis is
offline and because 11.6 ms of placement error on a slice is audible as a soft attack, where
for the evaluation task 11.6 ms is comfortably inside the standard tolerance. [I]

Half-wave rectification is not optional: without it, energy _decreases_ count as evidence of
an onset and every note release produces a false positive. **[C]**

**Peak picking.** An onset is reported at frame `m` when all three hold:

```
    (a)  SF(m) ≥ SF(j)                       for all j ∈ [m−w, m+w]          w = 3 frames
    (b)  SF(m) ≥ mean( SF over [m−mw, m+w] ) + δ                             m = 3, δ per below
    (c)  m − lastOnset ≥ 30 ms
```

`δ` is set adaptively as `δ = 0.15 × median(SF)` over the whole file rather than as an
absolute number, because absolute thresholds do not survive a change of source level. The
published parameter set for this peak picker exists but **could not be read from this
environment**; `w = 3`, `m = 3`, `δ = 0.15 × median` and the 30 ms refractory period are
**[I]** and V-4 exists to bracket them. The 30 ms floor is derived: a 1/32 note at 200 BPM is
37.5 ms, so anything below 30 ms is separating a flam, not a note. **[C, derived]**

**Sample-accurate refinement, and this is the step that is usually missing.** The ODF grid
gives a frame, not a sample. Refine each onset by searching the raw signal backwards from the
frame centre over 20 ms for the **local minimum of 1 ms RMS**, then forwards from there to the
next zero crossing. The rule is asymmetric on purpose: **a slice may start early, never late.**
An early slice adds a few samples of near-silence; a late one removes the attack, which is the
only part of a percussive sound anybody recognises. [I], tested by V-5.

**Evaluation.** The standard evaluation tolerance in this field is **±50 ms**, with precision,
recall and F-measure computed against hand labels. **[C]** That tolerance is right for
transcription and far too loose for slicing, so §9 measures both it and a ±10 ms figure.

### 3.4 Pitch detection

**Algorithm: YIN.** **[C]** Chosen over plain autocorrelation because its cumulative-mean
normalisation and absolute-threshold step exist specifically to suppress the octave errors
that autocorrelation makes, and an octave error in a sampler is not a small error — it
mis-roots the zone and every key plays an octave out.

```
    (1)  d(τ)   = Σ_{j=1}^{W} ( x[j] − x[j+τ] )²
    (2)  d'(0)  = 1
         d'(τ)  = d(τ) / [ (1/τ) · Σ_{j=1}^{τ} d(j) ]
    (3)  τ*     = smallest τ with d'(τ) < 0.1, else argmin d'(τ)
    (4)  parabolic interpolation of d' about τ* → fractional τ̂
    (5)  f0     = fs / τ̂ ,   aperiodicity a = d'(τ*),  periodicity = 1 − a
```

The **absolute threshold of 0.1** is the published value **[C]**; the paper's own evaluation
used a 25 ms integration window over a 40–800 Hz search range **[C]**. Our parameters differ
and are **[I]**, for a stated reason: a musical instrument sampler must resolve A0 at 27.5 Hz,
whose period is 1604 samples at 44.1 kHz, and a 25 ms window is 1102 samples — shorter than
one period. Ours:

| Parameter          | Value                                    | Confidence and reason                                                           |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------------------- |
| Search range       | 27.5 Hz – 4186 Hz (A0 – C8)              | [I]; τ ∈ [10.5, 1604] samples at 44.1 kHz                                       |
| Window `W`         | 100 ms                                   | [I]; ≥ 2.7 periods at the lowest searched pitch                                 |
| Frames analysed    | 8, spread over the sustain region        | [I]; one window can land on a wolf note                                         |
| Combination        | median of frames with periodicity ≥ 0.65 | [I]; median rather than mean so one octave-slipped frame cannot move the answer |
| Absolute threshold | 0.1                                      | **[C]**                                                                         |

**Octave guard, on top of YIN's own.** After step 5, compare `d'(2τ̂)` with `d'(τ̂)`; if
`d'(2τ̂) < d'(τ̂) + 0.05`, prefer `2τ̂`. This catches the residual half-period lock on signals
with a strong second harmonic. [I], tested by V-6.

**What is written to the zone.** Let `ν = 69 + 12·log₂(f0 / A_ref)` where `A_ref` is the
project's reference pitch (default 440 Hz, and note `syn-01` §3.3's reason for making that a
setting rather than a constant).

```
    root      = round(ν)
    fine      = 100 · (ν − round(ν))        cents, −50 … +50
```

**Storing only `root` and discarding `fine` detunes every note by up to 50 cents.** It is the
most common sampler import bug and it is free to avoid. [I]

**Classification.** periodicity ≥ 0.90 → pitched; 0.65–0.90 → pitched, flagged in the UI for
review; < 0.65 → unpitched. The boundaries are **[I]** and V-6 brackets them.

### 3.5 Loop-point detection

Three cases, because one algorithm does not cover them and pretending it does is how samplers
acquire a loop button that works on strings and not on pads.

**Case A — pitched sustain (periodicity ≥ 0.90).** The loop length must be an **integer number
of pitch periods**. **[C]** — a loop whose length is not a whole number of periods restarts the
waveform at a different phase every pass, which is heard as a periodic timbral or pitch tick at
the loop rate. With `P = τ̂` from §3.4:

```
    candidate length  L = k · P,  k chosen as the smallest integer with k·P ≥ max(50 ms, 4P)
    refine            search s over ±P/2 around the period-quantised start, maximising
                      ρ(s) = Σ x[s+i]·x[e+i] / sqrt( Σ x[s+i]² · Σ x[e+i]² ),  i over 2P
    accept            if ρ ≥ 0.95
```

**Case B — unpitched sustain (noise, pad, texture).** Find the longest window in which 20 ms
RMS varies by < 1 dB and the spectral centroid varies by < 5 %. Minimum loop length **200 ms**,
derived: a loop of length `L` repeats at `1/L` Hz, and below about 50 ms that repetition rate
(20 Hz) crosses into the pitch range and the loop acquires an audible tone that is not in the
material. 200 ms puts the repetition at 5 Hz, which reads as movement rather than as pitch.
**[C, derived]**

**Case C — percussive or short one-shot.** No loop. `loop_mode = no_loop`.

**The crossfade law, and it is the part that is usually wrong.** Crossfade length is
`min(0.5 · L, 30 ms)` for case A and `0.25 · L` for case B — a shorter fade has less chance of
phase cancellation **[C]**, which is why case A's is short and tied to the period. The
**shape** must depend on the measured correlation at the join:

```
    ρ ≥ 0.98  →  equal-gain (linear) crossfade:      a + b = 1
    ρ < 0.98  →  equal-power crossfade:              a² + b² = 1,  a = cos(πu/2), b = sin(πu/2)
```

Derived: correlated signals sum in amplitude, so an equal-power fade over correlated material
produces a **+3 dB bump** in the middle of every crossfade; uncorrelated signals sum in power,
so an equal-gain fade over uncorrelated material produces a **−3 dB dip**. Either way the
result is a level pulse once per loop pass, which is precisely the artefact the crossfade was
added to remove. **[C, derived]** — tested by V-8.

### 3.6 Auto-zoning across the keyboard

One decision tree, evaluated once, from the outputs of §3.3 and §3.4:

| Condition                                                                | Map produced                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| onsets ≥ 4 **and** median inter-onset < 1.5 s **and** periodicity < 0.90 | **Slice map.** One zone per slice, mapped **chromatically upward from MIDI 36 (C1)** — the convention shared by several hosts **[R]**. Key tracking 0 (a slice does not transpose with the key). No loop. |
| periodicity ≥ 0.90                                                       | **Pitched map.** One zone, root and fine from §3.4, key range 0–127, key tracking 1, loop from §3.5 case A or B.                                                                                          |
| otherwise                                                                | **Percussive map.** One zone, root 60, key range 0–127, **key tracking 0** so the whole keyboard plays it at pitch, with key tracking exposed as one switch.                                              |

**Slice spans.** Slice `n` spans `[onset_n, onset_{n+1})` **plus a 20 ms tail with a 5 ms
fade-out**, not exactly up to the next onset. Cutting a slice at the next onset truncates the
previous hit's decay at full amplitude, and every slice then ends in a click. The overlap is
harmless because slices played in order do not retrigger each other. [I]

**Choke.** Slices default to **choke off**. A shared choke group makes fast re-triggering cut
the previous slice, which sounds tidier and destroys the loop's own decay tails; it is a
musical choice, not a default. [I]

### 3.7 Multi-file import (multisample)

When several files are dropped together:

1. Detect pitch on each (§3.4).
2. **Parse the filename for a note name as a cross-check, not as the answer.** Rule: if the
   parsed note and the detected note differ by exactly ±12 · k semitones, take the **filename**
   — an exact octave disagreement is the signature of a detector octave error. Any other
   disagreement: take the **detection**, and flag the file. [I]
3. Sort by root; place zone boundaries at the **arithmetic midpoint** between adjacent roots.
4. Report the worst-case transposition. If the roots are spaced a **minor third (3 semitones)**
   apart, no key is ever transposed by more than **±1 semitone** **[C]** — this is the standard
   multisampling spacing and the reason for it. As a working rule, shifts of two semitones or
   fewer are usually inaudible; three to four are noticeable but acceptable; beyond about five
   the algorithm becomes audible. **[R]** Show the number; do not hide it.
5. Velocity layers, when present, are clustered by loudness with boundaries at the midpoints
   and **zero crossfade width by default** — two separately recorded layers are uncorrelated,
   so any crossfade between them phases. [I]

---

## 4. The four playback engines

### 4.1 The shared voice contract

Every engine implements the same three-function contract, and the contract is what makes them
interchangeable:

```
    prepare(zone, note, sampleRate)   // no allocation; all buffers come from a pool
    render(out[], frames, pitch[], speed[])   // pitch in semitones, speed as a ratio
    release()
```

`pitch[]` and `speed[]` arrive as **per-sample arrays**, not per-block scalars, because the
glide (§5) moves continuously and a per-block pitch produces zipper noise at exactly the rate
the host's block size sets — an artefact that changes when the user changes their buffer size,
which is the hardest class of bug to diagnose. This is the same reasoning ADR-0004 gives for
parameter smoothing.

**No engine may allocate, lock, log or touch a file inside `render`.** `motionwave/core/test/rt_guard.h`
proves it, and V-27 is the test.

**One consequence of ADR-0003 that must be planned for now:** `motionwave/core/` has no
dependencies, so **there is no FFT library**. The spectral engine (§4.4) needs a real-input FFT
of length 1024–4096, and it will have to be written in core, with its twiddle tables built at
construction and its scratch buffers owned per voice. That is perhaps 200 lines and it is on
the critical path for this unit; do not discover it during §4.4.

### 4.2 Classic — sample-rate conversion

The read increment is the whole engine:

```
    r = 2^( pitch / 12 ) × ( fsFile / fsHost )
```

**Interpolation, by quality tier.** The tiers exist because the cost difference is a factor of
three and the audible difference only appears on bright material at large upward shifts.

| Tier   | Interpolator                            | Flops/sample | Target alias floor at +7 semitones |
| ------ | --------------------------------------- | ------------ | ---------------------------------- |
| Eco    | linear                                  | 4            | ≤ −40 dBc [I]                      |
| Normal | 4-point cubic Hermite (as `fx-02` §7.1) | 14           | ≤ −70 dBc [I]                      |
| High   | 16-tap windowed sinc, 512-phase table   | ≈ 44         | ≤ −100 dBc [I]                     |

The windowed-sinc table is the published tabulated-kernel method: a windowed sinc is stored at
high phase resolution and shifted to the fractional output position, with all input samples
under the kernel multiplied and summed. **[C]** Its design constants — 16 taps, 512 phases,
Kaiser window — are **[I]**; the one published resampler design note reachable from here
specifies its own filter against a **−0.08 dB passband ripple and −85 dB stopband** with a
4.1 kHz transition band at 44.1 kHz **[R]**, which is the right order for our High tier but is
not our specification. **Measure the table, do not trust it** (V-3).

**Upward transposition aliases; downward does not.** Reading faster (`r > 1`) moves content
above Nyquist, which folds. Two documented remedies **[C]**:

- **Stretch the kernel.** At `r > 1`, scale the sinc kernel in time by `r`, which lowers its
  cutoff to `0.5·fs/r` — the standard way to make a windowed-sinc resampler decimation-correct.
  Cost: the kernel spans `16·r` input samples, so the flop count rises linearly with `r`.
- **Mip-map.** Pre-decimate the sample into an octave pyramid at load and read from the level
  whose Nyquist is above the required bandwidth. Cost: a three-level pyramid is
  `1/2 + 1/4 + 1/8` = **+87.5 % memory**, and it is a load-time cost, not an audio-thread cost.

Spec [I]: High uses the stretched kernel; Normal uses the mip-map for `r > 2` only (more than
an octave up) and plain Hermite below it; Eco does neither, and **its aliasing is a documented
character option**, not merely a limitation — §8.

**Loop playback.** `loop_continuous`, `loop_sustain` (loop until the key releases, then run to
the end), and `alternate` (ping-pong). Ping-pong must **not repeat the turn-around sample** —
holding the endpoint for two samples at each end injects a periodic step at `2/L` Hz, which on
a 100 ms loop is a 20 Hz buzz that no filter setting removes.

**Sample-start offset** is a first-class destination (§6.3) and is applied **at note-on only**.
Moving the start of an already-sounding note is a different feature (a jump, not a modulation)
and doing it continuously turns a modulation wheel into a scrub control. [I]

### 4.3 Granular

**Read `fx-02` §1 first.** Grain windows, the density/overlap normalisation and the
sample-accurate fractional scheduler are specified there and are not repeated. This section is
only what an instrument needs that an effect does not.

**The playhead and the grain pitch are independent, and that is the point.**

```
    playhead   += speed · dt          speed ρ ∈ [−4, +4], ρ = 0 is freeze
    grain read  += r                  r = 2^(pitch/12) × fsFile/fsHost
```

The note's key determines `r`; nothing about the key touches `ρ`. That decoupling removes the
44 % material drift derived in §1 entirely, and it is why a glide sounds like a glide here.

Instrument-specific requirements on top of `fx-02`:

1. **Per-voice grain pools.** A shared pool makes each voice's grain density depend on how many
   other voices are sounding, so a chord is quieter and grainier per note than a single note.
   Pool sizes: 64 grains/voice (High), 16 (Normal), 8 (Eco).
2. **The first grain of a note must start on the note's exact sample index**, not at the next
   scheduler tick. At a density of 40 grains/second, waiting for the tick adds up to **25 ms of
   note-on jitter** — a timing error large enough to hear as sloppy playing and one that is
   invisible in a spectrum plot. V-24.
3. **The density normalisation `A = 1/sqrt(O · mean(w²))` must be inside the voice**, so that
   changing Density does not change the note's loudness. In an effect this is a level bug; in an
   instrument it is a **velocity-response** bug, because the user compensates with the zone gain
   and then the velocity curve is wrong at every other density. V-25.
4. **Scatter = 0 must collapse to a plain interpolated read**, bit-exact against the classic
   engine — the same guarantee `fx-03` §4 requires of Smear = 0, and for the same reason: it is
   the cheapest possible proof that the granular machinery has not quietly coloured everything.
   This is also what makes the hybrid engine's unity null (§4.5) achievable. V-21.

### 4.4 Spectral — phase vocoder

**The equations.** Analysis STFT with a Hann window of length `N`, analysis hop `H_a`,
synthesis hop `H_s`. A Hann window at **75 % overlap** (`H = N/4`) gives smooth
overlap-add reconstruction and is the standard configuration. **[C]**

```
    Δφ_expected(k) = 2π k H_a / N
    Δφ(m,k)        = princarg( φ(m,k) − φ(m−1,k) − Δφ_expected(k) )
                     princarg(x) = ((x + π) mod 2π) − π
    ω̂(m,k)         = 2πk/N + Δφ(m,k) / H_a                       instantaneous frequency
    φ_s(m,k)       = φ_s(m−1,k) + H_s · ω̂(m,k)                   synthesis phase
    α              = H_s / H_a                                    time-stretch factor
```

**[C]** for the formulation — the phase vocoder estimates each bin's true frequency from the
phase difference between successive frames and accumulates output phase using the synthesis
hop, and the stretch factor is `H_s/H_a` **[C]** — but see §0: these were transcribed from
knowledge of the standard formulation, not from a fetched paper. **Check them before coding.**

**Getting both pitch and speed out of one vocoder — derived.** We want a playback speed `ρ` and
a pitch ratio `p`. A vocoder at stretch `α` changes duration by `α` and leaves pitch alone;
resampling the result with increment `p` changes duration by `1/p` and pitch by `p`. Net
duration factor is `α/p`, and we want `1/ρ`. Therefore

```
    α = p / ρ ,   then read the vocoder's output with increment p
```

**[C, derived]** Two consequences worth naming. First, **the spectral engine contains the
classic engine** — the output resampler is the same code, so the interpolation quality tiers of
§4.2 apply here too and are not duplicated. Second, `p` moves continuously under a glide, so
`α` moves continuously, so `H_a = H_s/α` is generally **not an integer**.

**Fractional analysis hop.** Do not round `H_a` and hope. Round the analysis position to an
integer sample and **compensate the residue `Δ` as a linear phase ramp**, multiplying bin `k`
by `e^(−j2πkΔ/N)`, and use the **actual** hop in `Δφ_expected`. One complex rotation per bin,
precomputable per frame. Omitting it makes the residue wander with the glide and adds a
modulation sideband that appears only while the pitch is moving — which is exactly when nobody
looks for it. [I]

**Phasiness and phase locking.** The plain vocoder maintains horizontal (frame-to-frame) phase
coherence per bin but not vertical (bin-to-bin) coherence, and the perceptual result is the
artefact variously called phasiness, reverberance or loss of presence. **[C]** The published
remedy is **identity phase locking**: pick spectral peaks, and give every bin in a peak's
region of influence the peak's phase advance rather than its own. **[C]** Spec:

- a peak is a bin that is a strict local maximum of `|X|` over ±2 bins;
- its region of influence runs to the midpoint between it and each neighbouring peak;
- `Phase lock` control: `Off` / `Identity` / `Scaled`, default `Identity`.

Cost is one pass of `N/2` comparisons per frame — negligible against the FFT.

**Transients.** A vocoder stretches a transient's attack by `α`, turning a snare into a
whoosh. The published bin-level approach detects transient bins and processes them separately,
which avoids constraining the stretch factor and avoids damaging stationary components near a
transient peak. **[C]** We specify the simpler frame-level version and say so:

- reuse the §3.3 spectral flux as a detector, evaluated on the analysis frames;
- on a detected transient frame, **reset `φ_s := φ` for all bins** and force `H_s = H_a` for
  that one frame;
- re-normalise that frame's overlap-add contribution, because a reset frame is no longer part
  of the COLA sum that the neighbouring frames assume, and skipping the re-normalisation puts a
  level notch exactly on every transient.

This is **[I]** and it is a simplification of the cited method. V-23 measures whether it is good
enough; if it is not, the bin-level method is the fallback and it is fully specified in the
cited paper.

**Latency: zero, and the reason is structural.** A real-time phase vocoder costs one window of
latency. **This one is reading a stored file**, so the analysis can run ahead of the synthesis.
Two ways to pay for that, and we use both:

- **Head analysis, precomputed at zone load.** The first 100 ms of every zone is analysed at
  load and stored. At 44.1 kHz with `N = 2048, H = 512` that is 9 frames × 1025 bins × 8 bytes =
  **74 kB per zone**. It removes the note-on burst — otherwise a note-on must compute four FFTs
  inside one block to fill the overlap-add pipeline, and four 2048-point FFTs is roughly 225 000
  flops arriving in one 256-sample block.
- **Steady state: exactly one analysis frame per synthesis hop**, spread evenly. Never a burst.

Analysing an entire zone at load instead is possible and costs **4× the audio data** — a 75 %
overlap STFT of a real signal is exactly 4× redundant, so a 5-second 44.1 kHz mono zone goes
from 882 kB to **3.53 MB**. Offer it as a per-zone option for short zones; do not make it the
default. [I]

### 4.5 Hybrid

The hybrid engine is not a crossfade between the other three. It is a **three-way
decomposition of the source at import, with each layer played by the engine that handles that
kind of signal best**, which is the only arrangement in which "hybrid" means something testable.

Decomposition, computed offline at load:

| Layer         | Definition                                                                                                                      | Played by |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **Transient** | The first `T_t` ms after each detected onset (§3.3), `T_t` default 30 ms, with a 2 ms fade at its end                           | Classic   |
| **Tonal**     | Bins whose instantaneous frequency deviates from their bin centre by < 0.5 bin over 3 consecutive frames, resynthesised to time | Spectral  |
| **Residual**  | `original − transient − tonal`, in the time domain                                                                              | Granular  |

At playback: the transient layer is **pitch-shifted but not time-stretched**, and is scheduled
at the time position the tonal layer's time base says it belongs to. The tonal layer runs the
vocoder. The residual runs a grain cloud, which is what a noise floor wants — a phase vocoder
smears noise into a metallic wash and a plain resampler moves its spectrum bodily.

**The property that makes this specifiable rather than hand-wavy:** the decomposition is
**complementary by construction**, so with all three layer gains at unity, `α = 1`, `p = 1` and
scatter 0, the hybrid engine must **null against the classic engine to ≤ −100 dBFS**. That
follows from three facts: the classic path at `r = 1` is exact; the granular path at scatter 0
collapses to a plain read (§4.3 item 4); and the vocoder at `H_s = H_a` with no phase
modification is an STFT round-trip, which with Hann at 75 % overlap satisfies COLA and
reconstructs to float precision. −100 dBFS rather than −140 because a `float32` STFT round-trip
accumulates roughly 1e−6 relative error through two transforms. **[C, derived]** — V-21, and it
is the most valuable single test in this sheet.

### 4.6 Engine switching, and determinism

**Engine is per-zone state, not per-note.** Switching it while notes sound crossfades the old
and new engines over **20 ms with both rendering**, which doubles that voice's cost for 20 ms;
budget for it (§10). A switch that simply swaps the renderer produces a phase discontinuity at
the switch point.

**Every random draw must be seeded and reproducible.** Grain onset jitter, position spray,
per-grain pitch, per-voice glide offsets in voice-fixed mode (§5.4), and the RANDOM modulation
source all draw from a PRNG seeded from `(noteNumber, noteStartTick, voiceSlot,
instrumentSeed)` — **never** from a free-running global generator.

The reason is not tidiness. `CLAUDE.md` names offline bounce parity as a thing that must not
break, and MotionLab's parity is asserted by rendering the same bars two ways and comparing.
A free-running generator makes that comparison fail by construction, and the failure looks like
a DSP bug rather than a seeding bug. V-16.

---

## 5. The portamento engine

### 5.1 Domain

**The glide runs in semitones — that is, in the log-frequency domain — always.** A glide linear
in hertz from C2 to C4 spends more than half its time in the top octave and sounds like a
mistake. Working in semitones also means the glide's output drops straight into the pitch sum
of §2.2 and is exponentiated exactly once, with everything else.

### 5.2 The three laws

Let `d` = |target − origin| in semitones, `T` = the Glide Time control, `κ` = the Law control.

| Law               | Duration       | Behaviour                                                                                  |
| ----------------- | -------------- | ------------------------------------------------------------------------------------------ |
| **Constant time** | `T`            | However far apart the notes, the glide takes the same time. **[C]**                        |
| **Constant rate** | `T · d / 12`   | Rate is `R = 12/T` semitones per second; further notes take proportionally longer. **[C]** |
| **Hybrid**        | `T · (d/12)^κ` | `κ = 0` is constant time, `κ = 1` is constant rate. [I]                                    |

Both classical laws are documented, and so is the complaint against each: with constant time,
if the glide is right for an octave then a whole-tone slide is too short to notice; with
constant rate, if it is right for an octave then a whole-tone slide is too slow and wails.
**[C]** Neither is correct in general, which is why the control is `κ` and not a two-way
switch. A single continuous law that contains both endpoints costs one `pow` per note-on and
removes the argument. [I]

```
    duration = clamp( T · (d / 12)^κ · δᵥ , 1 ms , 30 s )
```

`δᵥ` is the per-voice offset of §5.4. The 1 ms floor exists because a glide shorter than about
a millisecond is a click with extra steps; the 30 s ceiling because a glide that outlives the
note is a stuck voice waiting to be reported as a bug. [I]

### 5.3 Shapes

`s(u)` maps normalised progress `u ∈ [0,1]` to normalised pitch travel, `pitch = origin + d·s(u)`.

| Shape       | `s(u)`                             | When it is right                                                                      |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| **Linear**  | `u`                                | Mechanical, even; matches the "constant speed" behaviour the patents describe **[C]** |
| **RC**      | `(1 − e^(−3.5u)) / (1 − e^(−3.5))` | Fast then slow; the shape a first-order slew circuit makes **[C]**                    |
| **S-curve** | `0.5 · (1 − cos(πu))`              | Zero pitch velocity at both ends                                                      |

The RC shape needs its normalisation explained, because the obvious implementation is wrong.
A one-pole slew toward a target **never arrives** — it approaches asymptotically, so the note
sits permanently flat by a fraction of a cent, and two voices glide-locked to the same target
never quite lock. The physical circuit has the same property and it does not matter there
because the residue disappears into thermal noise; in a sampler it disappears into a beat
against the other voices. Normalising over **3.5 time constants** so `s(1) = 1` exactly is the
same fix `syn-01` §9.2 applies to its envelope segments, and using the same constant means one
curve implementation serves both units.

**S-curve is the default when Stagger is non-zero.** With staggered arrivals, a linear law puts
a corner in each voice's pitch trace at its own arrival instant, and the ear hears a small stop
per voice — four little arrivals rather than one gesture. Zero terminal velocity removes it. [I]

### 5.4 Multi-portamento — per-voice offsets and staggered arrival

This is the unit's distinctive feature. Definition:

> When notes replace notes while glide is engaged, each sounding voice glides on **its own
> origin, its own duration and therefore its own arrival time**. The chord does not move as a
> block; it unfurls.

**Each voice's origin is where that voice actually is**, not the previous note's nominal pitch.
A voice interrupted mid-glide continues from its instantaneous pitch. This is what makes a fast
passage smear continuously rather than jump to a new ramp, and it is one line of state
(`originᵥ = currentPitchᵥ`) that is easy to get wrong by storing the previous _note_ instead.
V-17.

**Per-voice duration offsets `δᵥ`, three derivation modes.** All three are specified because
they sound different and each answers a real question.

**Mode 1 — Spread (deterministic, by position in the chord).** For `V` sounding voices sorted
by target pitch, voice `i` (0-based):

```
    δᵢ = 1 + S · ( 2i/(V−1) − 1 )        V > 1
    δᵢ = 1                               V = 1
    δᵢ ← max(δᵢ, 0.05)
```

`S` is the **Stagger** control, 0…1. At `S = 0` every voice arrives together, which is ordinary
polyphonic portamento. At `S = 1` durations run from 0.05·T to 2·T. The **Direction** control
chooses the sort key — `LOW FIRST`, `HIGH FIRST`, `OUTSIDE IN`, `INSIDE OUT`, `PLAY ORDER` —
and only the sort key changes; the law above is untouched.

**Mode 2 — Interval-derived, and this is the insight that makes the feature comprehensible.**

```
    δᵢ = ( dᵢ / d̄ )^(1−κ)          dᵢ = voice i's own interval, d̄ = mean interval of the chord
```

At `κ = 1` this is 1 for every voice — because **constant-rate glide already staggers arrival
by interval**, and that stagger is the natural one. Mode 2 is what gives you the same behaviour
under constant time. Stagger is not an effect bolted onto portamento; it is the part of
constant-rate portamento that constant-time throws away, put back where it can be controlled
independently of the law. [I], on a [C] premise.

**Mode 3 — Voice-fixed, which is the documented hardware behaviour.** Each allocator slot
carries a `δ` drawn **once at instrument construction** from the seeded generator, uniform in
`[1−S, 1+S]`. This reproduces a published circuit analysis of a 1981 four-voice instrument
whose designers deliberately fitted **a different capacitor value in each voice's portamento
circuit**, so each voice has its own time constant and the four voices spread out into four
different pitches during a slide before converging. **[C]** — §12.5.

Because the offsets belong to slots rather than to notes, the same chord played twice glides
identically, while a repeated note landing on a different slot glides differently. That is the
same round-robin character `syn-01` §13 argues for, arriving here for free.

**Staggered arrival, numerically.** These are the quantities the UI displays and §9 measures:

```
    durationᵥ = clamp( T · (dᵥ/12)^κ · δᵥ , 1 ms, 30 s )
    arrivalᵥ  = noteStart + durationᵥ
    A         = max(arrivalᵥ) − min(arrivalᵥ)              the arrival spread, in ms
```

Worked example, used verbatim as test V-15. Four voices, equal intervals (so `κ` cannot
matter), `T = 400 ms`, `κ = 0`, Mode 1, `S = 0.5`, Direction `LOW FIRST`:

| Voice | `δᵢ`   | Duration     |
| ----- | ------ | ------------ |
| 0     | 0.5000 | **200.0 ms** |
| 1     | 0.8333 | **333.3 ms** |
| 2     | 1.1667 | **466.7 ms** |
| 3     | 1.5000 | **600.0 ms** |

Arrival spread `A` = **400 ms**, arrival order exactly 0, 1, 2, 3.

**Arrival must be exact.** At `t = durationᵥ` the voice's pitch must equal its target to within
**0.1 cent**. That number is derived rather than chosen: 0.1 cent at 440 Hz is a **0.025 Hz**
beat — one cycle every 39 seconds, longer than any note. Five cents, by contrast, is a
**1.27 Hz** beat, plainly audible as chorusing on a sustained chord, and five cents is what an
un-normalised RC glide (§5.3) leaves behind. **[C, derived]**

### 5.5 What glides, and what does not

```
    pitchᵥ = glide(note)                       ← the ONLY thing the glide engine touches
           + rootOffset + zoneTune + fine
           + masterBend + noteBend
           + Σ( matrix → PITCH ) + Σ( matrix → FINE )/100
```

If the glide smoothed the whole sum, then pitch bend, vibrato and per-note MPE bend would all
be dragged through the glide's time constant, and a 2-second glide time would give the pitch
wheel two seconds of lag. Players read that as a broken controller, not as a portamento
setting. [I]

**Trigger modes:** `OFF` / `ON` (every note glides from the last note played on that slot) /
`LEGATO` (glide only when the new note overlaps a held one — fingered portamento **[C]**).

### 5.6 What each engine does with a glide

| Engine   | Mechanism                                                                                | The §1 material-drift term                                                       |
| -------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Classic  | Glide moves the read increment `r`                                                       | **Present, and large** — 44 % over a 12-semitone 2-second glide **[C, derived]** |
| Granular | Glide moves the grain read rate; playhead unaffected                                     | **Absent**                                                                       |
| Spectral | Glide moves `p`, hence `α = p/ρ` and the output resampler                                | **Absent**, at the cost of §4.4's fractional-hop compensation                    |
| Hybrid   | All three layers glide; the transient layer takes its **time base from the tonal layer** | **Absent**; transient alignment is tested at ≤ 1 ms (V-23)                       |

The classic engine's drift is not a defect to be corrected — it is what a sampler does, it is
what the player expects when they choose the classic engine, and removing it would be
correcting the instrument into something else. But it must be **documented on the control**,
because a user who reaches for glide on a two-bar loop and gets a tape effect deserves to know
which of the four engines to switch to.

### 5.7 Failure modes to design against

1. **Glide restarting from the nominal previous note** rather than the voice's current pitch.
   Produces an audible jump whenever notes arrive faster than the glide finishes. V-17.
2. **Per-block pitch updates.** Zipper noise whose rate follows the host's buffer size (§4.1).
3. **A glide that never arrives** (unnormalised RC, §5.3).
4. **Stagger applied to a single note.** `V = 1` must give `δ = 1` in mode 1, not `1 − S`;
   otherwise the Stagger control audibly changes monophonic glide time, which nobody expects.
5. **Unseeded per-voice offsets**, which break bounce parity (§4.6).

---

## 6. MPE, the modulation matrix, and the non-MPE fallback

### 6.1 The matrix is `syn-05`'s matrix

Do not build a second one. The ledger's rule is that shared DSP is built once, and the
destination-centric editor, the routing budget, the amount encoding and the two hard capacity
limits are all specified in `syn-05` §9. SMP-01 supplies its own source and destination lists
and its own capacities:

| Property                         | Value                                                         |
| -------------------------------- | ------------------------------------------------------------- |
| Sources                          | **24** (§6.2)                                                 |
| Destinations                     | **34** (§6.3)                                                 |
| Simultaneous routings per preset | **16** [I]                                                    |
| Maximum sources per destination  | **6** — same as `syn-05`, so the editor is identical [I]      |
| Amount                           | bipolar, −1.0 … +1.0, linear in the destination's native unit |

### 6.2 Sources

| #     | Source                                     | Kind      | Notes                                                                                                                |
| ----- | ------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------- |
| 0–2   | NOTE BEND, PRESSURE, SLIDE                 | per note  | The three MPE dimensions (§6.4)                                                                                      |
| 3–4   | STRIKE, LIFT                               | per note  | Note-on and note-off velocity; 14-bit when CC 88 precedes the note **[C]**                                           |
| 5     | KEY                                        | per note  | Note number, normalised                                                                                              |
| 6     | VOICE                                      | per voice | The allocator slot index, normalised — the source that makes per-voice variation programmable rather than hard-coded |
| 7     | GLIDE                                      | per voice | The glide's own progress `s(u)`, 0→1. Modulating grain density or cutoff with it ties the timbre to the gesture      |
| 8–10  | ENV 1, 2, 3                                | per voice | DAHDSR                                                                                                               |
| 11–13 | LFO 1, 2, 3                                | per voice | Free or tempo-synced, with retrigger phase (`syn-05` §6)                                                             |
| 14–15 | RAMP 1, 2                                  | per voice | One-segment, retriggerable (`syn-05` §7.1)                                                                           |
| 16    | RANDOM                                     | per note  | One seeded draw per note (§4.6)                                                                                      |
| 17–18 | TRACK 1, 2                                 | per voice | 5-point piecewise-linear shapers (`syn-05` §7.2) — this is where a velocity curve lives                              |
| 19    | LAG                                        | per voice | Slew of any source (`syn-05` §7.3)                                                                                   |
| 20–22 | MASTER BEND, MASTER PRESSURE, MASTER SLIDE | zone      | Master-channel dimensions                                                                                            |
| 23    | CC                                         | zone      | One assignable CC, learn-able                                                                                        |

### 6.3 Destinations

Pitch and time: `PITCH` (semitones), `FINE` (cents), `GLIDE TIME`, `GLIDE LAW κ`,
`GLIDE STAGGER`, `PLAY SPEED ρ`.
Sample: `SAMPLE START`, `LOOP START`, `LOOP LENGTH`, `LOOP CROSSFADE`.
Granular: `GRAIN SIZE`, `GRAIN DENSITY`, `GRAIN SPRAY`, `GRAIN JITTER`, `GRAIN PITCH SPREAD`,
`GRAIN PAN SPREAD`.
Spectral: `FORMANT`, `BLUR`, `TRANSIENT SENSITIVITY`.
Hybrid: `TRANSIENT LEVEL`, `TONAL LEVEL`, `RESIDUAL LEVEL`.
Voice: `CUTOFF`, `RESONANCE`, `AMP`, `PAN`.
Generators: `ENV1 ATK`, `ENV1 DCY`, `ENV1 REL`, `ENV1 AMP`, `LFO1 RATE`, `LFO1 DEPTH`,
`LFO2 RATE`, `LFO2 DEPTH`, `LAG RATE`.

Note the reflexive entries — `GLIDE TIME`, `GLIDE STAGGER` and `GLIDE LAW` are destinations
while `GLIDE` is a source, and the LFO and envelope parameters are destinations while their
outputs are sources. That is the property `syn-05` §1.2 identifies as the thing that separates
a modulation matrix from a fixed routing list, and it costs nothing to preserve here.

**Not destinations, deliberately:** engine choice, loop mode, quality tier, FFT size, key
range, root key. Every one is a switch or a structural constant, and modulating it means
rebuilding state on the audio thread. `syn-05` §9.4 makes the same cut for the same reason.

### 6.4 MPE routing

The receiver's obligations are specified in `std-01` §6 and are **not restated here**; this
section is only the instrument-side mapping.

| MPE dimension                                  | Source    | Default routing                                                                      | Notes                                                                                           |
| ---------------------------------------------- | --------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 1 — pitch bend, member channel, 14-bit **[C]** | NOTE BEND | → `PITCH`, ±48 semitones after an MCM **[C]**                                        | The MCM resets member sensitivity to ±48 and master to ±2 **[C]**                               |
| 2 — channel pressure, member, 7-bit **[C]**    | PRESSURE  | → `AMP` and `CUTOFF`                                                                 | 7-bit: must be smoothed, see below                                                              |
| 3 — CC 74, member, 7-bit **[C]**               | SLIDE     | → `TONAL LEVEL` (hybrid) / `GRAIN DENSITY` (granular) / `CUTOFF` (classic, spectral) | Per-engine default, because the expressive dimension should reach the thing the engine is about |

**Pressure and slide arrive with 128 steps.** `std-01` §4 is explicit that MPE 1.0 removed the
14-bit forms of both. A slow swell therefore arrives as a staircase, and applied raw to a VCA
it is audible as a series of small steps. Smooth with a one-pole whose time constant is
**5 ms** — fast enough that a full-scale gesture in 100 ms is not visibly smeared (5 ms is 5 %
of it), slow enough to bridge the 7-bit steps. [I]

**Three instrument-side consequences of the MPE lifecycle rules, all of which bite harder in a
sampler than in a synth:**

1. **Per-note controllers must stop affecting a voice at its Note Off** **[C]**, and a sampler's
   release tails are long — a sampled piano can ring for ten seconds. A receiver that keeps
   applying member-channel bend to releasing voices will detune those tails when the channel is
   reused, and here the audience for that bug is every note. `std-01` A14/A15.
2. **A Note On snapshots the member channel's current controller state** **[C]**. If SLIDE is
   routed to `SAMPLE START`, that snapshot decides **which part of the sample plays**, not merely
   how bright it is. A wrong snapshot is therefore a wrong sound, not a slightly wrong sound.
3. **MPE bend and portamento both move pitch, and they must sum, not compete.** A finger sliding
   on a controller surface is producing a real glide; if the instrument's own portamento is also
   engaged, the two add in the semitone domain (§5.5) and that is correct.

### 6.5 Non-MPE fallback

The fallback is not a degraded mode to be apologised for. Most sequenced material will arrive
this way, and the three portamento control changes make multi-portamento fully drivable from an
ordinary MIDI 1.0 track.

| Input                        | Behaviour                                                                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel pitch bend           | → MASTER BEND, ±2 semitones by default; **applies to every sounding voice**                                                                                                       |
| Channel pressure             | → MASTER PRESSURE, broadcast to all voices                                                                                                                                        |
| **Poly key pressure**        | → PRESSURE, **per note** — the one genuine per-note dimension MIDI 1.0 has, and it must be honoured                                                                               |
| CC 74                        | → MASTER SLIDE, broadcast                                                                                                                                                         |
| **CC 65** Portamento on/off  | Toggles glide. Values 0–63 off, 64–127 on **[C]**                                                                                                                                 |
| **CC 5** Portamento time     | Sets `T` **[C]**; the value→time law is ours (below) because the standard does not define one                                                                                     |
| **CC 84** Portamento control | **Sets the glide origin note explicitly** for the next Note On on that channel **[C]** — it names the source note, so a glide can be produced without holding the first note down |

CC 84 is the important one and it is widely ignored by receivers. It is exactly the mechanism a
sequencer needs to drive §5.4: write the origin per note, and a chord's voices can be given
individually chosen origins without any dependence on what the allocator happened to do.

**CC 5 taper**, matching the Glide Time control's own law so that a value entered in the UI and
a value arriving over MIDI mean the same thing:

```
    T(v) = 0.001 · 30000^(v/127)  seconds        v = 0 → 1 ms,  v = 64 → 180 ms,  v = 127 → 30 s
```

**[I]** — the MIDI specification defines CC 5's meaning but not its scale, and receivers differ.
V-19 pins ours; §13 records that ours is a choice.

### 6.6 Amount law and summation

Amounts are **linear in the destination's native unit** and sum before any conversion:
pitch destinations sum in semitones and are exponentiated once (§2.2); level destinations sum in
decibels; time destinations sum in the log domain of their own taper. Clamping happens **after**
summing, at the destination's declared range, so that two large opposing modulations cancel
rather than each clamping first. `syn-05` §9.2 takes the same position and test 11.7 there is
the same test as V-18 here.

---

## 7. Control specification

Ranges, units and tapers are given in the vocabulary `motionwave/core/param/units.h` already
defines — `Unit::{Hertz, Seconds, Milliseconds, Semitones, Cents, Decibels, Percent, Ratio,
Choice}` and `Taper::{Linear, Logarithmic, Exponential, Stepped}` — so that each row below is
one `ParamSpec` (ADR-0004) and nothing here needs a bespoke conversion.

A logarithmic taper means `real = min · (max/min)^n`, i.e. constant ratio per unit of travel.
That is the law every time and every frequency control wants, because a listener hears ratios.

### 7.1 Zone and sample

| Control        | Range           | Unit         | Taper       | Default  | Notes                                                        |
| -------------- | --------------- | ------------ | ----------- | -------- | ------------------------------------------------------------ |
| Engine         | 4 choices       | Choice       | —           | Classic  | Per zone; switching crossfades 20 ms (§4.6)                  |
| Quality        | Eco/Normal/High | Choice       | —           | Normal   | Selects interpolator and caps (§10.3)                        |
| Root key       | 0…127           | Linear       | Stepped 128 | detected | §3.4                                                         |
| Fine tune      | −100…+100       | Cents        | Linear      | detected | The residue of §3.4; discarding it detunes by up to 50 cents |
| Key tracking   | 0…200           | Percent      | Linear      | 100      | 0 = fixed pitch (drum map), 200 = two semitones per key      |
| Sample start   | 0…100           | Percent      | Linear      | 0        | Applied at note-on only (§4.2)                               |
| Loop mode      | 4 choices       | Choice       | —           | detected | `no_loop` / continuous / sustain / alternate                 |
| Loop crossfade | 0…500           | Milliseconds | Logarithmic | detected | Shape follows the correlation rule (§3.5)                    |
| Gain           | −60…+12         | Decibels     | Linear      | 0        | Linear in dB is already perceptually even                    |
| Pan            | −100…+100       | Percent      | Linear      | 0        | Equal power                                                  |

### 7.2 Glide

| Control                | Range                           | Unit         | Taper       | Default   | Notes                                                                                        |
| ---------------------- | ------------------------------- | ------------ | ----------- | --------- | -------------------------------------------------------------------------------------------- |
| Mode                   | Off / On / Legato               | Choice       | —           | Off       | Legato = fingered portamento **[C]**                                                         |
| Time `T`               | 1 ms…30 s                       | Seconds      | Logarithmic | 120 ms    | Same law as CC 5 (§6.5)                                                                      |
| Law `κ`                | 0…100                           | Percent      | Linear      | 35        | 0 = constant time, 100 = constant rate (§5.2)                                                |
| Shape                  | Linear / RC / S-curve           | Choice       | —           | S-curve   | S-curve whenever Stagger > 0 (§5.3)                                                          |
| Stagger `S`            | 0…100                           | Percent      | Linear      | 0         | 0 reproduces ordinary polyphonic portamento exactly                                          |
| Spread mode            | Spread / Interval / Voice-fixed | Choice       | —           | Spread    | §5.4                                                                                         |
| Direction              | 5 choices                       | Choice       | —           | LOW FIRST | Sort key only; the law is unchanged                                                          |
| Arrival spread readout | —                               | Milliseconds | —           | —         | Not a control: display `A` live. It is the number that predicts what the gesture sounds like |

### 7.3 Per engine

| Engine   | Control                            | Range               | Unit         | Taper       | Default  | Notes                                                                   |
| -------- | ---------------------------------- | ------------------- | ------------ | ----------- | -------- | ----------------------------------------------------------------------- |
| Granular | Grain size                         | 5…500               | Milliseconds | Logarithmic | 60       | Below 15 ms the window colours the tone **[C]**, `fx-02` §1.1           |
| Granular | Density                            | 1…500               | Hertz        | Logarithmic | 40       | Per voice. `fx-02`'s 2000 g/s is an effect figure; ×32 voices it is not |
| Granular | Overlap readout                    | —                   | Ratio        | —           | —        | Display `O = R·L`; it predicts both sound and CPU                       |
| Granular | Spray / Jitter / Length jitter     | 0…100               | Percent      | Linear      | 40/50/20 | Scatter 0 must null against Classic (V-21)                              |
| Granular | Pitch spread                       | 0…100               | Cents        | Linear      | 0        | Per-grain detune                                                        |
| Granular | Speed `ρ`                          | −4…+4               | Ratio        | Linear      | 1        | 0 = freeze; a dead zone of ±0.01 around 0                               |
| Spectral | FFT size                           | 1024/2048/4096      | Choice       | —           | 2048     | 46 ms at 44.1 kHz; larger is smoother and blurs transients more         |
| Spectral | Phase lock                         | Off/Identity/Scaled | Choice       | —           | Identity | **[C]** for the method                                                  |
| Spectral | Formant                            | −24…+24             | Semitones    | Linear      | 0        | Envelope shift independent of pitch (§13 item 6)                        |
| Spectral | Blur                               | 0…100               | Percent      | Linear      | 0        | Randomised phase advance; a character control                           |
| Spectral | Transient sensitivity              | 0…100               | Percent      | Linear      | 50       | Drives the §4.4 reset detector                                          |
| Hybrid   | Transient length                   | 5…100               | Milliseconds | Logarithmic | 30       | §4.5                                                                    |
| Hybrid   | Transient / Tonal / Residual level | −60…+6              | Decibels     | Linear      | 0/0/0    | All three at 0 must null against Classic (V-21)                         |

### 7.4 Voice, filter, envelopes

| Control             | Range                      | Unit    | Taper       | Default | Notes                                                     |
| ------------------- | -------------------------- | ------- | ----------- | ------- | --------------------------------------------------------- |
| Polyphony           | 1…64                       | Linear  | Stepped 64  | 32      | Per-engine caps in §10.3                                  |
| Stealing            | Oldest / Quietest / Lowest | Choice  | —           | Oldest  | Steal must retrigger, not crossfade (`syn-01` §13)        |
| Filter mode         | LP/HP/BP/Notch/Off         | Choice  | —           | LP      | One SVF; mode is a switch, never modulated                |
| Cutoff              | 20…20000                   | Hertz   | Logarithmic | 20000   | `f = 20 · 1000^n`, i.e. 9.97 octaves of travel            |
| Resonance           | 0…100                      | Percent | Linear      | 0       |                                                           |
| Key follow          | 0…100                      | Percent | Linear      | 0       | 100 % = one octave of cutoff per octave of keyboard       |
| ENV 1–3 D/A/H/D/S/R | 0.1 ms…30 s                | Seconds | Logarithmic | —       | `t = 0.0001 · 300000^n`                                   |
| LFO 1–3 rate        | 0.01…100                   | Hertz   | Logarithmic | 5       | `f = 0.01 · 10000^n`; or a sync division                  |
| LFO retrigger phase | 0…360                      | Linear  | Linear      | 0       | Deterministic rendering needs a defined start phase       |
| Velocity → amp      | 0…100                      | Percent | Linear      | 100     | Curve shaped by TRACK 1 (§6.2), default `(v/127)^1.5` [I] |

**Every control in this section must reach the engine.** `CLAUDE.md`'s rule — a control that
does nothing is a bug of the same class as a wrong number — is enforced statically in
MotionLab by `tests/schemaWired.test.ts` and its siblings, and this unit needs the equivalent:
a table-driven test that every `ParamSpec` declared by SMP-01 is read by some engine, and that
every value the engines read is declared. V-30.

---

## 8. Character artefacts worth modelling

| Artefact                          | Magnitude / condition                                        | Confidence  | Why it matters                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Glide material drift**          | 44 % extra source over a 12-semitone, 2-second classic glide | [C] derived | The sampler's own sound. Keep it; document it; offer three engines that do not have it (§5.6)                                          |
| **Upward-transposition aliasing** | −40 dBc at Eco, +7 semitones                                 | [I]         | The characteristic sound of low-bit-rate hardware samplers. Keep Eco reachable as a _character_ setting, not only as a mobile fallback |
| **Loop seam**                     | One level or timbre event per loop pass                      | [C] derived | The crossfade law of §3.5 removes it; the wrong law creates a ±3 dB pulse at the loop rate                                             |
| **Grain-rate periodicity**        | Audible as pitch or flutter when `O` ≈ 1–3 with low jitter   | [C]         | `fx-02` §8.1. A feature at the sparse end of Density                                                                                   |
| **Phasiness**                     | Rises with `\|α − 1\|`                                       | [C]         | The vocoder's own signature; phase locking reduces it but does not remove it                                                           |
| **Transient smearing**            | Attack lengthened by ≈ `α` without transient handling        | [C]         | The reason §4.4 has a reset path at all                                                                                                |
| **Voice-fixed glide spread**      | Repeated notes glide differently; a chord unfurls            | [C]         | The documented hardware behaviour of §5.4 mode 3, and the unit's identity                                                              |
| **Velocity-layer switching**      | A step in timbre at a layer boundary                         | [I]         | Mitigated by round-robin and by TRACK-shaped velocity, **not** by crossfading two uncorrelated recordings (§3.7)                       |
| **Zone crossfade phasing**        | Comb filtering where two zones overlap                       | [I]         | The argument for zero-width velocity crossfades by default                                                                             |
| **Note-on grain jitter**          | Up to `1/R` seconds (25 ms at 40 g/s)                        | [C] derived | **Not** a character artefact — a bug. Listed here so nobody rationalises it as one (V-24)                                              |

---

## 9. Verification — the unit's acceptance test

This section is the acceptance test for SMP-01 and is executed as ledger cell **D3**. Every
row states a stimulus, a measurement, a numeric target and a tolerance. The DoD column names
the other ledger cells a row also satisfies. Rows marked **BLOCKED** under ADR-0005 must name
the missing capability, not merely fail.

| ID       | Test                              | Method                                                                                                                                                     | Target                                                                                                                                        | Tolerance                                                                                                    | DoD           |
| -------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------- |
| **V-1**  | **Unity null**                    | Classic, High, root = played key, tune 0, `fsFile == fsHost`, no filter/env/mod, no loop. Render; null against the decoded file.                           | ≤ **−140 dBFS** residual                                                                                                                      | None. At `r = 1` no interpolation may occur; a non-zero residual means the interpolator runs unconditionally | D4            |
| **V-2**  | Transposition accuracy            | 1 kHz sine zone rooted at 60; play every key 0…127; FFT peak.                                                                                              | `f = 1000 · 2^((k−60)/12)`                                                                                                                    | **±0.5 cent**                                                                                                | D2, I18       |
| **V-3**  | Interpolation alias floor         | 1 kHz sine at −6 dBFS, +7 semitones (`r = 1.4983`), each quality tier. Worst non-harmonic component.                                                       | Eco ≤ −40 dBc · Normal ≤ −70 dBc · High ≤ **−100 dBc**                                                                                        | +3 dB. Repeat at +12, +19, +24 semitones                                                                     | D5            |
| **V-4**  | Onset detection                   | 20 files with hand-labelled onsets (10 drum loops, 5 melodic, 5 mixed). Precision/recall/F.                                                                | F ≥ **0.95** at ±50 ms **[C]**; F ≥ **0.90** at ±10 ms                                                                                        | None on the ±50 ms figure                                                                                    | D3            |
| **V-5**  | Onset placement bias              | Same corpus, refined onsets (§3.3).                                                                                                                        | Every detection lies in **[label − 2 ms, label]** — early is allowed, late is not                                                             | 0 late detections                                                                                            | D3            |
| **V-6**  | Pitch detection                   | 60 single notes, A0…C8, five instrument families, known pitch.                                                                                             | Correct MIDI note in ≥ **98 %**; fine tune within ±5 cents of ground truth; **zero octave errors** on the subset with periodicity ≥ 0.90      | Zero on octave errors                                                                                        | D3            |
| **V-7**  | Loop period locking               | Synthetic 220 Hz sawtooth with a 2 % amplitude decay.                                                                                                      | Loop length an exact integer multiple of **200.45 samples** (44100/220); join correlation ρ ≥ 0.99                                            | ±0.5 sample                                                                                                  | D3            |
| **V-8**  | Loop seam                         | Sustain each detected loop for 60 s. Per-sample first difference at each join vs. the loop interior's maximum; and RMS 10 ms before vs. 10 ms after.       | No join sample exceeds the interior maximum by > **1 dB**; level step ≤ **0.2 dB**                                                            | As stated. Failure means the §3.5 crossfade law is inverted                                                  | D3            |
| **V-9**  | Auto-zoning decision              | 30-file corpus: 10 pitched one-shots, 10 drum loops, 10 unpitched one-shots.                                                                               | Correct map class in **29/30**; slice count within **±1** of the labelled hit count on the loops                                              | As stated                                                                                                    | D3            |
| **V-10** | Multisample mapping               | 12 files spanning two octaves at 3-semitone spacing.                                                                                                       | Boundaries at the arithmetic midpoint, **exactly**; worst-case transposition **±1 semitone** **[C]**                                          | 0 keys                                                                                                       | D3            |
| **V-11** | Glide law — constant time         | `κ = 0`, `T = 500 ms`, `S = 0`. Intervals 1, 7, 12, 24 semitones. Time from note-on until pitch is within 0.1 cent of target.                              | **500 ms** in all four cases                                                                                                                  | **±2 ms**                                                                                                    | D2            |
| **V-12** | Glide law — constant rate         | `κ = 1`, `T = 500 ms` (so `R = 24` semitones/s). Same intervals.                                                                                           | **41.7 / 291.7 / 500.0 / 1000.0 ms**                                                                                                          | ±2 ms                                                                                                        | D2            |
| **V-13** | Glide law — hybrid                | `κ = 0.5`, `T = 500 ms`. Intervals 3 and 24 semitones.                                                                                                     | **250.0 ms** and **707.1 ms**                                                                                                                 | ±2 ms                                                                                                        | D2            |
| **V-14** | Glide shapes                      | 12 semitones over 1 s; sample pitch at `u` = 0.25/0.5/0.75.                                                                                                | Linear **3.000 / 6.000 / 9.000** · RC **7.215 / 10.223 / 11.478** · S-curve **1.757 / 6.000 / 10.243** semitones                              | ±0.02 semitone. S-curve pitch velocity at both ends ≤ 0.5 semitone/s                                         | D2            |
| **V-15** | **Stagger — arrival spread**      | 4 voices, equal intervals, `T = 400 ms`, `κ = 0`, Spread mode, `S = 0.5`, LOW FIRST.                                                                       | Durations **200.0 / 333.3 / 466.7 / 600.0 ms**; spread `A` = **400 ms**; arrival order exactly 0,1,2,3                                        | ±2 ms per voice; order exact                                                                                 | D2            |
| **V-16** | **Determinism and bounce parity** | Voice-fixed stagger, `S = 0.5`, granular engine with full jitter. Render the same 8 bars twice from a cold instance; then render offline and in real time. | Two cold renders **bit-identical**; offline vs. real time ≤ **−120 dBFS** difference                                                          | Bit-identical is exact. This is the seeded-PRNG test (§4.6)                                                  | D10, D11      |
| **V-17** | Glide interrupt                   | C2→C4 over 2 s, linear; at `t = 700 ms` send C3.                                                                                                           | The new glide's origin = **44.4 semitones** (36 + 24·0.35); no adjacent-sample pitch step > 0.01 semitone                                     | ±0.05 semitone                                                                                               | D9            |
| **V-18** | Matrix summation and limits       | Three sources → `CUTOFF` at +1/3 each; then attempt a 17th routing and a 7th source on one destination.                                                    | Result equals the single-source +1.0 case within **1 %**; both over-capacity attempts refused at the model layer                              | 1 %; refusal is binary                                                                                       | D1            |
| **V-19** | Non-MPE portamento control        | CC 65 = 127, CC 5 = 64, CC 84 = 48, then Note On 60.                                                                                                       | Glide starts at MIDI **48** and takes **180 ms**                                                                                              | ±2 ms                                                                                                        | I16           |
| **V-20** | Spectral identity                 | Spectral, `α = 1`, `p = 1`, phase lock off, transient handling off. Null against Classic at `r = 1`.                                                       | ≤ **−100 dBFS**                                                                                                                               | +3 dB. Proves the STFT round-trip is COLA-correct                                                            | D3            |
| **V-21** | **Hybrid completeness**           | Hybrid, three layer gains at 0 dB, `α = 1`, `p = 1`, scatter 0. Null against Classic at `r = 1`.                                                           | ≤ **−100 dBFS**                                                                                                                               | +3 dB. Proves the §4.5 decomposition is complementary and that scatter 0 collapses to a plain read           | D3            |
| **V-22** | Spectral stretch quality          | 4× stretch of a sustained bowed note. (a) f0 stability; (b) 1/3-octave spectral-envelope correlation against the source; (c) phase lock on vs. off.        | (a) ≤ **±3 cents**; (b) ≥ **0.98** over 100 Hz–8 kHz; (c) identity locking reduces inter-partial phase dispersion by ≥ **6 dB**               | (a) ±1 cent, (b) 0.01, (c) 1 dB                                                                              | D3            |
| **V-23** | Transient preservation            | 4× stretch of a snare hit; 10–90 % envelope rise time, and, in Hybrid, the transient layer's onset alignment against the tonal layer's time base.          | Rise time ≤ **1.5×** the unstretched value; alignment ≤ **1 ms**                                                                              | Rise time must be < 2× or the transient path is not working                                                  | D3            |
| **V-24** | Granular note-on timing           | Density 40 g/s; 200 note-ons at random sample offsets inside the block.                                                                                    | First non-zero output sample at exactly the scheduled sample offset — **0 samples** of jitter, every time                                     | Zero                                                                                                         | D7            |
| **V-25** | Density loudness invariance       | Sweep Density 10 → 400 g/s on a steady zone.                                                                                                               | RMS varies ≤ **0.5 dB**                                                                                                                       | 0.1 dB. Tighter than `fx-02` V4 because here it is the velocity response                                     | D2            |
| **V-26** | Polyphony, stealing, panic        | 128 simultaneous note-ons against a cap of 32; then all-notes-off; then 2 000 randomised seeded note events.                                               | Exactly **32** sounding, **96 steals on 96 distinct voices**; `sustainingVoices() == 0` within one block of panic; **0 stuck** after the fuzz | Exact                                                                                                        | I13, I14, I15 |
| **V-27** | **Real-time safety**              | `rt_guard.h` armed around 10 minutes of playback with every control automated and the engine switched mid-note 100 times.                                  | **Zero** allocations, locks, file I/O or logging on the audio path                                                                            | Zero. Mutation-test the guard itself                                                                         | D9            |
| **V-28** | Streaming under-run               | Zone larger than the preload buffer, 32 voices, 32-sample blocks, 10 minutes.                                                                              | **Zero** under-runs; if the loader falls behind, the voice fades out over 5 ms rather than playing an unfilled buffer                         | Zero                                                                                                         | D7            |
| **V-29** | Rates and buffer sizes            | Every test above at 44.1, 48, 88.2, 96, 176.4 and 192 kHz, and at buffer sizes 32, 64, 128, 256, 512, 1024.                                                | Results invariant within each test's own tolerance; **no artefact whose frequency follows the buffer size**                                   | As each test states                                                                                          | D6, D7        |
| **V-30** | Control wiring                    | Table-driven: every declared `ParamSpec` is read by an engine; every value an engine reads is declared.                                                    | **Zero** unwired parameters, **zero** undeclared reads                                                                                        | Zero                                                                                                         | D1            |
| **V-31** | CPU linearity                     | Profile each engine at 1, 2, 4, 8, 16, 32 voices.                                                                                                          | Linear fit **R² ≥ 0.98** per engine; extracted per-voice slope within **±25 %** of §10.1                                                      | As stated. A non-linear fit means cache or allocation behaviour is leaking into the audio thread             | D9            |

**Run order.** V-1, V-20 and V-21 first, before anything else in §4 is trusted — they are the
three nulls, they are cheap, and each one isolates a whole engine. V-27 continuously from the
first commit, because a real-time violation found late is a redesign.

---

## 10. CPU and memory model

### 10.1 Per-voice cost

Budget, stated the way `docs/PERFORMANCE.md` and ADR-0006 state it: **one instrument instance,
phone, 256-sample buffer, 48 kHz**, allocated **~15 % of a core** — an instrument gets more than
an insert because there is one of it, not twelve.

Per voice, per sample, mono source into a stereo bus:

| Item                                            | Classic | Granular             | Spectral  | Hybrid    |
| ----------------------------------------------- | ------- | -------------------- | --------- | --------- |
| Read advance + wrap                             | 2       | 2 per grain          | —         | 2         |
| Interpolation (Normal: 4-point Hermite)         | 14      | 14 per grain         | 14        | 14        |
| Grain window + pan accumulate                   | —       | 8 per grain          | —         | 8/grain   |
| FFT pair, `N = 2048`, `H = 512`, real transform | —       | —                    | **220**   | 220       |
| Per-bin phase work, 1025 bins                   | —       | —                    | **48**    | 48        |
| Envelope + filter (SVF) + amp + pan             | 24      | 24                   | 24        | 24        |
| **Total at typical settings**                   | **40**  | **≈ 78** (`O` = 2.4) | **≈ 306** | **≈ 400** |

The FFT figure is `2 × 2.5·N·log₂N / H = 2 × 2.5 × 2048 × 11 / 512 = 220` flops/sample, on the
stated assumption that a real-input FFT costs about `2.5·N·log₂N`. **[I, computed]** — an
assumption, not a measurement; V-31 checks it against reality.

Worked totals at 48 kHz:

| Configuration                  | flops/sample | Mflop/s |
| ------------------------------ | ------------ | ------- |
| 32 voices, Classic, Normal     | 1 280        | **61**  |
| 32 voices, Granular, `O` = 2.4 | 2 496        | **120** |
| 32 voices, Granular, `O` = 8   | 6 784        | **326** |
| **8 voices, Spectral**         | 2 448        | **118** |
| 32 voices, Spectral            | 9 792        | **470** |
| 32 voices, Hybrid              | 12 800       | **614** |

A mid-range phone core sustains roughly 2–8 Gflop/s scalar **[U]** — the same assumption every
other sheet in this set rests on, and the same warning applies: these are operation counts, not
measurements.

### 10.2 Memory

| Item                                                | Size                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Sample data, `float32`                              | 4 bytes per frame per channel — 882 kB for 5 s mono at 44.1 kHz                                                           |
| Mip-map pyramid, 3 levels (optional)                | **+87.5 %** of the above                                                                                                  |
| Spectral head analysis, per zone                    | **74 kB** (9 frames × 1025 bins × 8 B)                                                                                    |
| Full spectral analysis, per zone (optional)         | **4× the audio data** — 3.53 MB for the 5 s zone above                                                                    |
| Streaming preload buffer, per zone                  | **64 kB** [I], sitting beside a documented commercial default of 60 kB and a reported stable floor of 6 kB on SSD **[R]** |
| Grain pool, per voice                               | 64 × 64 B = 4 kB                                                                                                          |
| Voice state (filter, envelopes, glide, FFT scratch) | ≈ 40 kB with a 4096-point scratch                                                                                         |
| Window tables                                       | Shared with `fx-02`; 64 kB for the whole process                                                                          |

**Everything is allocated at construction or at zone load, off the audio thread.** A grain
spawn that finds the pool full is dropped and **counted**, and that counter is a QA output
exactly as it is in `fx-02` V8.

### 10.3 Quality tiers and caps

| Tier   | Interpolation                          | Max granular `O` | Max spectral voices | Spectral FFT | Notes                                  |
| ------ | -------------------------------------- | ---------------- | ------------------- | ------------ | -------------------------------------- |
| Eco    | linear                                 | 4                | **2**               | 1024         | Mobile default. Hybrid unavailable     |
| Normal | 4-point Hermite, mip-map above `r = 2` | 12               | 8                   | 2048         | Desktop default; mobile below 8 voices |
| High   | 16-tap windowed sinc, stretched kernel | 32               | 32                  | 4096         | Desktop only                           |

The granular cap is applied by **reducing the grain rate `R`, never by dropping grains**, for
`fx-02` §7.4's reason: dropping grains modulates loudness with CPU load. The spectral cap is
applied by **refusing new spectral voices and falling back to Classic for them**, with the
fallback shown in the UI — a silently dropped note is worse than a note that plays with a
different engine, and in a sampler the difference is often inaudible on short notes.

---

## 11. Implementation order

In dependency order, with the "done" condition being the test IDs from §9:

1. Zone model, `ParamSpec` table, voice allocator, envelopes, filter → V-26, V-30
2. Classic engine at Normal quality → **V-1**, V-2, V-29
3. Import conditioning and onset detection → V-4, V-5
4. Pitch detection and auto-zoning → V-6, V-9, V-10
5. Loop detection and the crossfade law → V-7, V-8
6. Glide engine: the three laws and three shapes → V-11, V-12, V-13, V-14, V-17
7. **Multi-portamento: offsets, direction, arrival spread** → **V-15**, V-16
8. Modulation matrix (reusing `syn-05`'s) and MPE routing → V-18, V-19
9. Granular engine (reusing `fx-02`'s grain machinery) → V-24, V-25, V-21 (scatter-0 null)
10. Real FFT in core, then the spectral engine → **V-20**, V-22, V-23
11. Hybrid decomposition → **V-21**
12. Quality tiers, mip-map, windowed-sinc table → V-3
13. Streaming → V-28
14. Rate and buffer sweep, real-time guard → V-27, V-29, V-31

Steps 1–2 are the whole instrument for a user with one drum hit, and they are also what proves
the framework. Do not start step 10 before step 2's null passes.

---

## 12. Sources

Every substantive claim above traces to one of these. All were reached by **search-engine
extraction**; none was fetched, and no repository was cloned (§0). Reference product names
appear **only in this section**, as citations.

### 12.1 Onset detection

- Bello, Daudet, Abdallah, Duxbury, Davies & Sandler, _A Tutorial on Onset Detection in Music
  Signals_, IEEE Trans. Speech and Audio Processing, 2005 —
  <https://hajim.rochester.edu/ece/sites/zduan/teaching/ece472/reading/Bello_2005.pdf>. The
  survey of detection functions: amplitude envelope, spectral magnitude and phase,
  time-frequency and probabilistic methods. **Pull this before coding §3.3.**
- Dixon, _Onset Detection Revisited_, DAFx-06, Montreal —
  <https://www.dafx.de/paper-archive/2006/papers/p_133.pdf>. Weighted phase deviation and the
  half-wave-rectified complex difference; the peak-picking parameter set this sheet marks [I]
  because it could not be read.
- Duxbury, Bello, Davies & Sandler, _Complex Domain Onset Detection for Musical Signals_,
  DAFx-03.
- Essentia `OnsetDetection` reference documentation —
  <https://essentia.upf.edu/reference/streaming_OnsetDetection.html>. The commonly published
  configuration: 44.1 kHz, frame 1024, hop 512, 11.6 ms resolution. **[R]**
- MIREX Audio Onset Detection task description —
  <https://www.music-ir.org/mirex/wiki/2015:Audio_Onset_Detection>. The ±50 ms evaluation
  tolerance and the precision/recall/F-measure protocol.

### 12.2 Pitch detection

- de Cheveigné & Kawahara, _YIN, a fundamental frequency estimator for speech and music_,
  JASA 111(4), 2002, pp. 1917–1930 — <http://audition.ens.fr/adc/pdf/2002_JASA_YIN.pdf>. The
  cumulative-mean-normalised difference function, the absolute threshold of 0.1, parabolic
  interpolation, the 25 ms integration window and 40–800 Hz search range of the paper's own
  evaluation, and the claim of roughly threefold lower error rates than the alternatives.
  **Pull this before coding §3.4.**
- `libf0` YIN documentation — <https://groupmm.github.io/libf0/build/html/index_yin.html>.

### 12.3 Resampling and interpolation

- Smith & Gossett, _A flexible sampling-rate conversion method_, and Julius O. Smith,
  _Physical Audio Signal Processing_ — Windowed Sinc Interpolation —
  <https://www.dsprelated.com/freebooks/pasp/Windowed_Sinc_Interpolation.html>. The tabulated
  windowed-sinc method and the bandlimited-interpolation argument.
- de Soras, _The Quest For The Perfect Resampler_, 2003 —
  <https://ldesoras.fr/doc/articles/resampler-en.pdf>. A worked filter specification
  (−0.08 dB passband ripple against −85 dB stopband, 4.1 kHz transition at 44.1 kHz) used here
  only as an order-of-magnitude cross-check. **[R]**
- Niemitalo, _Polynomial Interpolators for High-Quality Resampling of Oversampled Audio_ —
  <http://yehar.com/blog/wp-content/uploads/2009/08/deip.pdf>. The SNR comparison table for
  polynomial interpolators. **Its numbers are not quoted here** — only its existence — because
  the table could not be read; §13 item 3.
- KVR DSP forum, _Anti-Aliasing files for sampler playback_ —
  <https://www.kvraudio.com/forum/viewtopic.php?t=571563>. The two documented remedies for
  upward-transposition aliasing: an octave pyramid of pre-bandlimited copies, and a
  windowed-sinc kernel stretched in time when transposing upwards. **[R]**

### 12.4 Time-frequency processing

- Laroche & Dolson, _Improved Phase Vocoder Time-Scale Modification of Audio_, IEEE Trans.
  Speech and Audio Processing 7(3), 1999, pp. 323–332. Identity and scaled phase locking; the
  characterisation of the artefact as phasiness / reverberance / loss of presence.
  **Pull this before coding §4.4.**
- Laroche & Dolson, _Phase-vocoder: about this phasiness business_, IEEE ASSP Workshop, 1997.
- Röbel, _A new approach to transient processing in the phase vocoder_, DAFx-03, London —
  <http://articles.ircam.fr/textes/Roebel03a/index.pdf>. Bin-level transient detection and
  processing, and the argument for operating at bin level rather than frame level. The fallback
  if §4.4's frame-level reset fails V-23.
- Průša & Holighaus, _Phase Vocoder Done Right_ — <https://arxiv.org/pdf/2202.07382>.
- Zölzer (ed.), _DAFX: Digital Audio Effects_, 2nd ed., Wiley 2011, ch. 7 "Time-Frequency
  Processing". The analysis/synthesis block structure and the hop-size relationship.
- Serra & Smith, spectral modelling synthesis (sinusoids + residual) — the antecedent for the
  three-way decomposition in §4.5.
- Cepstral / true-envelope formant preservation: liftered log-magnitude envelope, divided out
  before shifting and reapplied after — <https://github.com/jurihock/stftPitchShift> (method
  description only; **no code read**) and
  <https://synsinger.wordpress.com/2013/03/24/fft-pitch-shifting-with-formant-preservation-revisited/>. **[R]**

### 12.5 Portamento

- US Patent 4,103,581, _Constant speed portamento_ —
  <https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/4103581>. Expired.
- US Patent 4,354,414, _Constant speed polyphonic portamento system_ —
  <https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/4354414>. Expired. States
  that prior portamento was limited to monophonic generation, that the frequency transition is
  usually a constant frequency change per unit time, and that a documented variation makes the
  transition speed proportional to the interval — the two laws of §5.2.
- CA 1,093,868, _Variable rate portamento system_ —
  <https://patents.google.com/patent/CA1093868A/en>.
- Synth Hacker, _Portamento Voice Spreading from the Mono/Poly_, 2013 —
  <http://synthhacker.blogspot.com/2013/04/portamento-voice-spreading-from-monopoly.html>.
  Schematic analysis of the Korg Mono/Poly's KLM-354 board showing **a different capacitor value
  in each voice's portamento circuit**, so the four voices hold four different pitches during a
  slide before converging. This is the published precedent for §5.4 mode 3.
- Gearspace, _Preferred glide: constant rate or constant time?_ —
  <https://gearspace.com/board/electronic-music-instruments-and-electronic-music-production/1073581-preferred-glide-constant-rate-constant-time.html>,
  and MOD WIGGLER, _Portamento (glide) over fixed time, regardless of interval?_ —
  <https://www.modwiggler.com/forum/viewtopic.php?t=203579>. The practitioner statement of both
  laws' failure modes, and the observation that "constant time" is so called because a
  first-order slew circuit's response to a step is exponential with an RC time constant. **[R]**
- suzumushi, _PolyPortamento_ (VST3) — <https://www.kvraudio.com/product/polyportamento-by-suzumushi>.
  Prior art for polyphonic portamento driven over MPE by converting note-ons into per-channel
  pitch-bend streams, and the observation that most MPE instruments implement only the bend
  dimension. Product page read; **no code read**. **[R]**

### 12.6 MIDI, MPE and mapping

- `docs/reference/std-01-mpe-midi2.md` — the MPE receiver obligations, zone model, the ±2/±48
  default sensitivities, the 7-bit pressure and slide resolution, the release-isolation and
  controller-snapshot rules, and CC 88 high-resolution velocity. **All [C] marks in §6.4 route
  through that sheet.**
- MIDI Association forum, _Portamento and Portamento time_ —
  <https://midi.org/community/midi-specifications/portamento-and-portamento-time>, with
  <https://studiocode.dev/resources/midi-cc/> and
  <https://nickfever.com/music/midi-cc-list>. CC 5 = portamento time, CC 65 = portamento on/off
  (0–63 off, 64–127 on), CC 84 = portamento control, which **specifies the source note** for the
  glide into the next note on that channel.
- SFZ format documentation — <https://sfzformat.com/> and
  <https://sfzlab.github.io/sfz-website/documentation/getting-started/what_is_sfz/>. The opcode
  vocabulary used in §2.3: `lokey`/`hikey` with `pitch_keycenter`, `lovel`/`hivel`,
  `loop_start`/`loop_end`/`loop_mode`, and the `xfin`/`xfout` crossfade family.

### 12.7 Sampling practice, looping and streaming

- Sound On Sound, _Sampling Basics, Part 3_ —
  <https://www.soundonsound.com/techniques/sampling-basics-part-3>, and Troy Woodfield,
  _Looping Techniques_ — <https://troywoodfield.tripod.com/looptech.html>. Loop points at
  matching amplitude and correlation; the crossfade-length/phase trade-off; **loop points chosen
  to span the same number of pitch periods, which is what keeps a loop constant in pitch.**
- LoopAuditioneer user guide — <https://loopauditioneer.sourceforge.io/userguide.html>.
  Automatic sustain-section detection and cross-correlation over a window around the candidate
  loop points. **[R]**
- Sound On Sound, _Q. How can I get my multisampled synths to sound more even?_ —
  <https://www.soundonsound.com/sound-advice/q-how-can-get-my-multisampled-synths-sound-more-even>.
  **Sampling every minor third means samples are only ever transposed by ±1 semitone**, and the
  trade of sample count against velocity layers.
- Cedar Sound Studios, _From Wrong Key to Perfect Match in One Click_ —
  <https://www.cedarsoundstudios.com/blogs/news/from-wrong-key-to-perfect-match-in-one-click>.
  The working rule that shifts of two semitones or fewer are usually inaudible, three to four
  acceptable, and beyond five the algorithm becomes audible. **[R]**
- Peachpit, _Sampling and Slicing Drums_ —
  <https://www.peachpit.com/articles/article.aspx?p=3150370&seqNum=2>, and MusicRadar,
  _How to chop beats with Simpler's Slice mode_ —
  <https://www.musicradar.com/tuition/tech/how-to-chop-beats-with-ableton-simplers-new-slice-mode-632939>.
  Slice markers at detected transients mapped **chromatically upward from C1** across several
  hosts. **[R]**
- ADSR, _How to Use and Optimize Kontakt DFD_ —
  <https://www.adsrsounds.com/kontakt-tutorials/how-to-use-and-optimize-kontakt-dfd/>. The
  documented default per-sample preload buffer of **60 kB** and the reported stable floor of
  **6 kB** on solid-state storage, used in §10.2 only as a calibration anchor. **[R]**

### 12.8 Internal

- `docs/reference/fx-02-granular-reverb.md` §1 — grain windows, the density/overlap
  normalisation `A = 1/sqrt(O·mean(w²))`, the sample-accurate fractional scheduler, the 50 ms
  fusion threshold, cubic-Hermite cost.
- `docs/reference/fx-03-granular-delay.md` §4 — the "scatter zero must null exactly" guarantee.
- `docs/reference/syn-05-matrix-twelve.md` §7, §9 — the matrix, the tracking generators, the lag
  processor, and the EQUAL TIME flag, which is the same constant-time/constant-rate distinction
  §5.2 draws.
- `docs/reference/syn-01-dco-poly.md` §7, §9, §13 — octave-domain modulation summing, the 3.5
  time-constant envelope normalisation reused in §5.3, and the round-robin argument.
- ADR-0003 (no core dependencies — hence §4.1's FFT), ADR-0004 (`ParamSpec`), ADR-0005
  (verification under a constrained host), ADR-0006 (mobile performance tiers).

---

## 13. What I could not confirm

Listed so that nobody builds to a guess, and so the next analyst knows where to dig. This
sheet has more of these than the others because nothing in it is a model of a physical object
whose behaviour could settle an argument.

1. **Every equation in §3.3, §3.4 and §4.4 is a transcription, not a copy.** No paper PDF was
   fetchable from this environment (§0). The formulations are standard and are corroborated by
   the cited sources' prose descriptions, but a sign error or a misplaced normalisation in the
   cumulative-mean difference function, in `princarg`, or in the phase-advance accumulation
   would be **silent** — the code would run and sound merely mediocre. **Obtaining the four
   papers named in §12.1 and §12.4 is the highest-value follow-up for this sheet**, and it is a
   prerequisite for items 2 and 3.
2. **The published peak-picking parameters for the onset detector.** `w`, the multiplier `m` and
   the threshold `δ` in §3.3 are ours **[I]**. The source that fixes them exists and could not be
   read. V-4 brackets them; it does not confirm them.
3. **Interpolator SNR figures.** The −40 / −70 / −100 dBc targets in §4.2 are engineering targets
   **[I]**, not measurements taken from the published comparison table, which could not be read.
   If the measured High-tier figure falls short, the fault is more likely in our table's design
   constants (taps, phases, window) than in the target.
4. **The exact windowed-sinc table design.** 16 taps, 512 phases and a Kaiser window are **[I]**.
   The one reachable published specification uses a different design against a −85 dB stopband
   **[R]**. Design ours against V-3 and record what was chosen.
5. **The CC 5 value→time law.** The MIDI specification defines what CC 5 _means_ and not how a
   value maps to a duration, and receivers differ. Ours (§6.5) is **[I]**. A user moving a
   project between hosts will get different glide times, and that is not a bug we can fix — it
   is a gap in the standard, and it should be said so in the manual.
6. **Formant preservation as specified.** §7.3 exposes a Formant control and §12.4 names the
   cepstral-liftering method, but the method's parameters — lifter cutoff, envelope order, and
   the behaviour at low pitch where the envelope and the harmonic structure are not separable —
   are **[X]** here. **Do not ship the Formant control until this is specified**; an
   under-specified formant shifter sounds worse than no formant control at all.
7. **Whether the frame-level transient reset in §4.4 is good enough.** The cited method operates
   at bin level specifically to avoid damaging stationary components near a transient peak
   **[C]**. Our simplification will damage them. V-23 measures the rise time but not that
   collateral damage; a listening comparison against the bin-level method is needed before the
   simplification is locked.
8. **The 100 ms head-analysis figure.** Nine frames covers the overlap-add pipeline at
   `N = 2048, H = 512` with margin, but the right number depends on how far ahead the scheduler
   can look, which the framework (§2.4 of the directive) does not exist to answer yet. **[I]**
9. **Real phone throughput.** Every Mflop/s figure in §10 is an operation count. The 2–8 Gflop/s
   scalar assumption is **[U]** and is inherited unchanged from `fx-01`, `fx-02` and `fx-03`. The
   spectral engine's 8-voice mobile cap rests entirely on it. **Profile before committing.**
10. **The real-FFT cost assumption** of `2.5·N·log₂N` flops. **[I, computed]** — a textbook
    approximation, not a measurement of the FFT we have not written yet. V-31 settles it.
11. **Whether identity phase locking is the right default.** The literature reports that it
    reduces phasiness **[C]**; whether it is preferable to scaled phase locking for _sampled
    instrument_ material specifically — as opposed to the polyphonic mixes the papers evaluate —
    is **[X]**. Ship both, default to identity, and revisit after V-22.
12. **Stagger's musical defaults.** `S = 0`, `κ = 0.35`, LOW FIRST and the S-curve are chosen so
    that the feature is discoverable without being imposed. There is no prior art to calibrate
    against, because as far as I could establish **no shipping instrument exposes a per-voice
    glide-offset control at all** — the one documented hardware precedent (§12.5) is a fixed
    consequence of component tolerance rather than a control, and the one MPE plug-in found does
    polyphonic portamento without staggering it. **[I]** throughout §5.4, and the product owner
    should hear V-15's four settings before the defaults are locked.
13. **Slice choke default.** §3.6 sets choke off with a stated reason; the opposite default is
    defensible and this is a taste question that a sound designer should settle, not an analyst.
    **[U]**
14. **Whether the velocity-layer crossfade should be exposed at all.** §3.7 argues for zero width
    because two separately recorded layers are uncorrelated and phase against each other. Some
    libraries crossfade anyway and are well regarded, which suggests the argument is incomplete —
    possibly because the correlated part of two layers of the same instrument is small enough at
    the crossover point for the phasing to be inaudible. Not resolved. **[U]**
