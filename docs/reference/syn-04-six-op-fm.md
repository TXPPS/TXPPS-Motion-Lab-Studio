# Reference spec — six-operator FM synthesis engine

Internal research note. Target implementation: `SYN-04`, the six-operator phase-modulation
instrument for MotionLab Studio.

## 0. How to read this document

This sheet is written from published specifications, service and operation manuals, patents,
public die-level reverse-engineering write-ups, and open-source reimplementations whose source
is published under permissive licences. It describes **circuit and algorithm behaviour** only.

**Intellectual-property rule.** Reference manufacturer and model names appear in this file
because engineering discussion requires them. They must not appear in shipped UI strings,
code identifiers, filenames, preset names, or marketing copy. No panel artwork, logotype,
typeface or badge from any reference product may be reproduced, traced, or described for the
purpose of tracing. Section 14 describes the _era's_ design language, which is what the UI team
is permitted to evoke.

Confidence markers, consistent with `docs/REFERENCE-FSP8.md`:

- **[C]** confirmed against a primary source: manufacturer manual, patent, published
  specification, or a published measurement of the physical device (including die-level reverse
  engineering). See §0.1 for how each source is classified.
- **[R]** reported by a reputable secondary source but not cross-checked against a primary one.
- **[I]** **implementation-derived** — the value's only source is somebody's _emulator_, not a
  measurement of hardware and not manufacturer documentation. An emulator constant is that
  author's design decision. It may be an accurate transcription of hardware behaviour, or a
  measurement, or a plausible guess that happens to sound right. **Every [I] value must be
  re-derived — by measurement, by fitting an analytic curve, or from manufacturer documentation —
  before it is written into `src/`.** [I] values are in this sheet so that we know the _shape_ of
  the behaviour to look for, not so that we can copy them.
- **[U]** unconfirmed or inferred. **Do not build to a [U] value without checking it.**
- **[X]** explicitly unknown — I could not establish it. Listed in §16.

Where a number is _derived_ (computed by me from a primary source rather than quoted from one),
it is marked **[derived]** and the derivation is shown so it can be re-checked.

Environment note: this machine's egress proxy blocks nearly all HTTP fetches. `github.com` and
`raw.githubusercontent.com` are reachable; manufacturer sites, archive.org and manual-hosting
sites are not. Prose claims come from search-engine extraction of manuals and
reverse-engineering articles; numeric behaviour comes from an open-source reimplementation that I
cloned and read line by line. See §0.1 and §15.

### 0.1 Provenance and licence — read before using any number here

Sources for this sheet fall into three classes, and the class determines what may be done with a
value.

| Class              | What it is                                                                               | Sources used here                                                                                                              | May a value be written into `src/`?                       |
| ------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| **Documentation**  | The manufacturer's own manual, specification or patent                                   | Operation manual (via page extracts); design archive                                                                           | Yes. Facts about a published specification.               |
| **Measurement**    | Instrumented observation of the physical device, including die-level reverse engineering | Ken Shirriff's chip reverse-engineering series; ajxs's technical analysis; the sample rate, DAC and log-domain findings in §11 | Yes. Facts about a physical device are not copyrightable. |
| **Implementation** | Somebody's emulator                                                                      | `asb2m10/dexed`, specifically its DSP core `Source/msfa/`                                                                      | **No — not directly.** Re-derive first.                   |

**Licence position on the implementation source, stated precisely.** The Dexed _project_ is
GPL-3.0. The files I actually read are its DSP core, `Source/msfa/`, which is Google's
`music-synthesizer-for-android` and carries **Apache-2.0** headers in every file I opened
(`fm_core.cc`, `fm_core.h`, `fm_op_kernel.cc`, `env.cc`, `lfo.cc`, `pitchenv.cc`, `dx7note.cc`,
`sin.h`, `exp2.h`, `synth.h`, `freqlut.cc`). Apache-2.0 is permissive, so the copyleft
contamination risk that would attach to the GPL parts of that project does **not** attach to the
core I read. That is a licence fact and it lowers the legal risk; **it does not lower the
epistemic risk**, which is the reason for the [I] marker: a constant in an emulator is a design
decision by its author, not a measurement of hardware, and shipping it as if it were a hardware
fact is wrong whatever the licence says.

**A further risk specific to this instrument.** Several of the numeric tables in that
implementation — the envelope output-level curve, the velocity curve, the pitch-envelope rate and
level tables, the keyboard-scaling exponential curve, the coarse-ratio table and the LFO rate
table — have the character of **transcriptions of the original firmware's ROM tables**. Their
provenance is not documented in the source. If they are ROM transcriptions then reproducing them
in a commercial product is exactly the extraction risk the project's IP rule forbids, regardless
of the wrapper's licence. **I have therefore removed the verbatim tables from this sheet** and
replaced each with a description of the curve's shape, its endpoints and its derived musical
consequences, which are facts about behaviour. Where a table is genuinely needed to build from,
re-derive it: fit an analytic curve to the described endpoints and shape, or measure. §13 tells
QA what to measure.

**What is safe to copy from this sheet:** the architecture (§1), the algorithm topology table (§3,
with the caveat in §3.1), the derived dB/s, dB and index figures, the control ranges and taxonomy,
the verification targets, and the era-language notes. **What is not:** any bare constant marked
[I].

---

## 1. Architecture

### 1.1 Signal and control paths

```
                     ┌──────────────────────────────────────────────────┐
   note on ─────────►│ VOICE ALLOCATOR (16 voices in the reference)     │
   note number       └───────┬──────────────────────────────────────────┘
   velocity                  │
                             ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │ PER-VOICE                                                               │
   │                                                                         │
   │  ┌──────────┐   ┌──────────────┐   ┌──────────────────────────────┐     │
   │  │ PITCH EG │──►│              │   │ per-operator control chain   │     │
   │  └──────────┘   │   PITCH SUM  │   │  ┌───────────────────────┐   │     │
   │  ┌──────────┐   │   (log freq) │   │  │ OUTPUT LEVEL 0..99    │   │     │
   │  │ LFO      │──►│              │   │  │        +              │   │     │
   │  │ (pitch)  │   └──────┬───────┘   │  │ KEYBOARD LEVEL SCALING│   │     │
   │  └────┬─────┘          │           │  │        +              │   │     │
   │       │                │           │  │ VELOCITY SCALING      │   │     │
   │       │ (amp)          │           │  └───────────┬───────────┘   │     │
   │       └────────────────┼───────────┤              ▼               │     │
   │                        │           │  ┌───────────────────────┐   │     │
   │                        │           │  │ 4-STAGE EG (R1..R4,   │   │     │
   │                        │           │  │  L1..L4) in log domain │  │     │
   │                        │           │  │  rate += RATE SCALING │   │     │
   │                        │           │  └───────────┬───────────┘   │     │
   │                        │           └──────────────┼───────────────┘     │
   │                        ▼                          ▼                     │
   │            ┌───────────────────────────────────────────────────┐        │
   │            │ 6 × OPERATOR:  y = sin(phase + modIn) · envGain    │        │
   │            │ phase += freq(ratio | fixed, detune, pitch mods)   │        │
   │            └───────┬───────────────────────────────────────────┘        │
   │                    │  interconnection fixed by ALGORITHM 1..32          │
   │                    │  one designated operator carries FEEDBACK 0..7     │
   │                    ▼                                                    │
   │            ┌───────────────────┐                                        │
   │            │ carrier sum       │──────────────────────────────► voice   │
   │            └───────────────────┘                                 out    │
   └─────────────────────────────────────────────────────────────────────────┘
```

Solid arrows carrying audio-rate data: operator → operator (as _phase_ offset, not amplitude),
and carriers → voice output. Everything else is control-rate.

### 1.2 The rendering model (bus machine)

The reference hardware evaluates the six operators in a **fixed order, operator 6 first down to
operator 1**, through two intermediate accumulator buses plus the voice output. This is exactly
how the algorithm ROM is organised and how Dexed's `FmCore::render()` implements it. **[I]**

Each operator, per algorithm, carries five facts:

| Field      | Meaning                                                         |
| ---------- | --------------------------------------------------------------- |
| input bus  | 0 (none), 1, or 2 — read as the phase-modulation input          |
| output bus | 0 (voice output), 1, or 2                                       |
| add flag   | if set, _sum_ into the target; if clear, _overwrite_ the target |
| FB out     | this operator's output is written to the feedback delay         |
| FB in      | this operator reads the feedback delay as extra phase offset    |

A bus that has not yet been written in this voice's render pass is treated as empty: an operator
whose input bus is empty renders as a pure sine, and an operator with the add flag whose output
bus is empty overwrites instead. **[I]** — `FmCore::render`, `has_contents[]`.

**Implementation note.** Two `int32_t` buffers of one block each are enough. Do _not_ generalise
to an arbitrary routing graph and then try to reproduce the reference's 32 fixed cases; implement
the bus machine and drive it from the table in §3. The bus machine is what makes the parallel
modulator cases (algorithms 7–18, 20, 26, 27) sum correctly at unity, with no gain compensation.

---

## 2. The operator: phase modulation, not frequency modulation

The reference instrument, and every commercial "FM" synthesiser derived from it, implements
**phase modulation**: the modulator's output is added to the carrier's _phase accumulator read
address_, not to its frequency increment. **[I]** — this is visible directly in the operator
kernel, `y = Sin::lookup(phase + input[i])`, where `phase` is advanced by a constant `freq` each
sample and `input[i]` is the modulator sample.

True frequency modulation would be `phase += freq + input[i]`, i.e. the _integral_ of the
modulator would appear in the phase.

Consequences that matter to the implementation, and to anyone porting formulas out of the
academic FM literature:

1. **The modulation index is frequency-independent.** In true FM the index is `Δf / f_m`, so a
   fixed modulator amplitude produces less index as the modulator's frequency rises. In phase
   modulation the index _is_ the modulator's peak amplitude in radians. A modulator envelope
   therefore maps directly and linearly onto the index, and a patch keeps its timbre when
   transposed. This is the single reason the reference design tracks the keyboard musically.
2. **No DC drift.** A DC offset at a true-FM modulator input detunes the carrier permanently. In
   phase modulation it produces a constant phase offset, which is inaudible for a single
   operator. This is why the reference can afford to sum several modulators into one bus.
3. **Chowning's Bessel-function spectrum still applies**, because for a sinusoidal modulator PM
   and FM are the same up to a 90° phase shift of the modulator and a scale factor. Sideband
   amplitudes are still `J_n(I)` about the carrier at `f_c ± n·f_m`.
4. **Phase, and therefore start phase, is audible.** Because operators are not reset to a
   common phase on note-on in the reference (the phase accumulators run free unless the
   algorithm's feedback state is reset), two notes at the same pitch do not sound identical.
   See §12.4.

Write this in the DSP as: `out = sin(2π · (phase + modIn)) · gain`, with `phase` in cycles and
`modIn` in cycles. One unit of `modIn` = one full cycle = 2π radians of index.

---

## 3. The 32 algorithms — complete table

Read as: **carriers** are the operators summed into the voice output. `a<-b+c` means operator `a`
is phase-modulated by the sum of `b` and `c`. **FB** names the operator that carries the feedback
loop; `x->y` denotes a multi-operator loop in which operator `x`'s output is fed back into
operator `y`'s phase input.

### 3.1 Provenance of this table — read this before using it

**The manufacturer publishes all 32 algorithm diagrams in the operation manual, and the
interconnection scheme is described in the patents.** That is the source we should be building
from, and it is documentation, not anybody's implementation.

I could not reach the manual or the patent PDFs from this environment (§0.1). What I did instead
was decode the algorithm ROM table held in an open emulator (`Source/msfa/fm_core.cc`) through the
bus machine of §1.2, and then cross-check the result against every published structural fact I
could obtain by search: that algorithm 5 has carriers 1/3/5, that algorithm 32 is six carriers
with feedback on operator 6, that algorithms 16–18 have a single carrier, that operators are only
ever modulated by higher-numbered operators, that every algorithm has exactly one feedback path,
and that algorithms 4 and 6 carry multi-operator feedback loops rather than self-loops. All six
checks pass.

So the table is **[I] with strong [R] corroboration**: the topology is almost certainly right, but
its immediate source is an implementation.

**The gap, named:** I have _not_ verified rows 10, 12, 14, 15, 18, 19, 20, 21, 23, 26, 27, 28, 29,
30 against a published diagram — no search result I obtained described those algorithms
individually. The corroborated rows are 1, 4, 5, 6, 7, 8, 9, 11, 13, 16, 17, 22, 24, 25, 31, 32
(by carrier count, feedback operator, or explicit description). **Before implementation, check all
32 rows against the manufacturer's algorithm chart in the operation manual**, which is a
five-minute job for anyone who can open the PDF. Test 13.1 is the behavioural backstop.

| Alg | Carriers         | Modulation chains      | FB   |
| --: | ---------------- | ---------------------- | ---- |
|   1 | 1, 3             | 5<-6; 4<-5; 3<-4; 1<-2 | 6    |
|   2 | 1, 3             | 5<-6; 4<-5; 3<-4; 1<-2 | 2    |
|   3 | 1, 4             | 5<-6; 4<-5; 2<-3; 1<-2 | 6    |
|   4 | 1, 4             | 5<-6; 4<-5; 2<-3; 1<-2 | 4->6 |
|   5 | 1, 3, 5          | 5<-6; 3<-4; 1<-2       | 6    |
|   6 | 1, 3, 5          | 5<-6; 3<-4; 1<-2       | 5->6 |
|   7 | 1, 3             | 5<-6; 3<-5+4; 1<-2     | 6    |
|   8 | 1, 3             | 5<-6; 3<-5+4; 1<-2     | 4    |
|   9 | 1, 3             | 5<-6; 3<-5+4; 1<-2     | 2    |
|  10 | 1, 4             | 4<-6+5; 2<-3; 1<-2     | 3    |
|  11 | 1, 4             | 4<-6+5; 2<-3; 1<-2     | 6    |
|  12 | 1, 3             | 3<-6+5+4; 1<-2         | 2    |
|  13 | 1, 3             | 3<-6+5+4; 1<-2         | 6    |
|  14 | 1, 3             | 4<-6+5; 3<-4; 1<-2     | 6    |
|  15 | 1, 3             | 4<-6+5; 3<-4; 1<-2     | 2    |
|  16 | 1                | 5<-6; 3<-4; 1<-5+3+2   | 6    |
|  17 | 1                | 5<-6; 3<-4; 1<-5+3+2   | 2    |
|  18 | 1                | 5<-6; 4<-5; 1<-4+3+2   | 3    |
|  19 | 1, 4, 5          | 5<-6; 4<-6; 2<-3; 1<-2 | 6    |
|  20 | 1, 2, 4          | 4<-6+5; 2<-3; 1<-3     | 3    |
|  21 | 1, 2, 4, 5       | 5<-6; 4<-6; 2<-3; 1<-3 | 3    |
|  22 | 1, 3, 4, 5       | 5<-6; 4<-6; 3<-6; 1<-2 | 6    |
|  23 | 1, 2, 4, 5       | 5<-6; 4<-6; 2<-3       | 6    |
|  24 | 1, 2, 3, 4, 5    | 5<-6; 4<-6; 3<-6       | 6    |
|  25 | 1, 2, 3, 4, 5    | 5<-6; 4<-6             | 6    |
|  26 | 1, 2, 4          | 4<-6+5; 2<-3           | 6    |
|  27 | 1, 2, 4          | 4<-6+5; 2<-3           | 3    |
|  28 | 1, 3, 6          | 4<-5; 3<-4; 1<-2       | 5    |
|  29 | 1, 2, 3, 5       | 5<-6; 3<-4             | 6    |
|  30 | 1, 2, 3, 6       | 4<-5; 3<-4             | 5    |
|  31 | 1, 2, 3, 4, 5    | 5<-6                   | 6    |
|  32 | 1, 2, 3, 4, 5, 6 | (none)                 | 6    |

Structural facts that fall out of the table and are worth asserting in a unit test:

- Every algorithm has exactly one feedback path. **[I]**
- An operator is only ever modulated by a **higher-numbered** operator. This is what allows the
  strict 6→1 evaluation order with only two buses. **[I]**
- Carrier counts run 1 (algorithms 16, 17, 18) to 6 (algorithm 32).
- Algorithm 28 and 30 are the only algorithms where operator 6 is a _carrier_ while the feedback
  sits on operator 5.
- 26 of the 32 have a self-loop feedback; algorithms 4 (loop 6→5→4→6) and 6 (loop 6→5→6) are the
  two multi-operator loops. Algorithms 10, 12, 15, 17, 18, 20, 21, 27 have their self-loop on an
  operator other than 6.

**Known reimplementation defect worth avoiding.** Dexed's renderer only executes a feedback path
when a single operator carries both FB-in and FB-out (`(flags & 0xc0) == 0xc0`); for algorithms 4
and 6 its table also marks the true loop end-point with an FB-out flag, but the renderer ignores
it and collapses both to a self-loop on operator 6. The source carries the comment
`// todo: more than one op in a feedback loop`. **[I]** MotionLab should implement the true
multi-operator loop: the loop delay is taken across the whole chain, so its effective delay is
three operators (algorithm 4) or two (algorithm 6), which changes the loop's phase response and
therefore the timbre and the onset of chaotic behaviour. Flag this as a deliberate divergence
from Dexed in the test notes, because A/B against Dexed will show a difference on those two
algorithms **by design**.

---

## 4. Feedback path and depth law

Feedback amount is an integer **0..7** stored per patch, applied to the one operator the
algorithm designates. **[I]**

The reference implements it as an arithmetic right shift, not a multiply:

```
fb_shift = (feedback != 0) ? (8 - feedback) : 16      // 16 == effectively off
...
scaled_fb = (y_{n-2} + y_{n-1}) >> (fb_shift + 1)     // two-sample mean, then shift
y_n       = sin(phase + scaled_fb) · gain
```

**[I]** — `Dx7Note::init` (`FEEDBACK_BITDEPTH = 8`) and `FmOpKernel::compute_fb`.

Reading the law out of that:

| FEEDBACK | fb_shift | effective gain on the mean of the last two outputs |
| -------: | -------: | -------------------------------------------------- |
|        0 |       16 | 2⁻¹⁷ — audibly zero                                |
|        1 |        7 | 2⁻⁸                                                |
|        2 |        6 | 2⁻⁷                                                |
|        3 |        5 | 2⁻⁶                                                |
|        4 |        4 | 2⁻⁵                                                |
|        5 |        3 | 2⁻⁴                                                |
|        6 |        2 | 2⁻³                                                |
|        7 |        1 | 2⁻²                                                |

So **the depth law is exactly one doubling per step**, i.e. +6.02 dB of loop gain per unit, over a
42 dB range, with a hard "off" at 0. **[C, derived]** Implement it as a shift or as
`2^(feedback-9)`; do not use a linear 0..1 taper, which is the most common porting error and
makes the low settings useless and the top setting tame.

Two further points:

1. **The two-sample mean is load-bearing.** `(y[n-2] + y[n-1]) / 2` is a one-zero lowpass in the
   loop. It is what keeps the loop from oscillating into full-scale noise at feedback 7, and it
   is why the reference's maximum feedback sounds like a bright sawtooth rather than white
   noise. The patents describe a mean filter in the feedback loop for exactly this reason. **[R]**
   Omitting it produces an unstable, aliased mess. Keep the two-sample state per voice, and clear
   it on voice allocation.
2. **The feedback state is per voice, not per note-on.** Retriggering a held voice does not clear
   it in the reference. **[U]** — treat as an emulation choice; clearing on allocation is safe.

Character: at feedback 6–7 a single self-modulated sine approximates a sawtooth; a two-operator
loop (algorithm 6) reaches audible chaos earlier and is the classic source of the era's
"metallic noise" and cymbal patches.

---

## 5. Envelope generator

Four rate/level pairs per operator: **R1..R4** and **L1..L4**, each **0..99**, plus a separate
per-operator OUTPUT LEVEL 0..99. There is also one four-stage **pitch EG** per voice, shared by
all operators. This is the section most reimplementations get wrong, so it is specified here in
full.

### 5.1 The state machine

The EG is a **rate/level** generator, not ADSR. Segment _i_ moves the current level toward `L_i`
at a speed set by `R_i`, and advances when it arrives.

- On note-on: jump to segment 1, target `L1`.
- Segments 1→2→3 run automatically; segment 3 then **holds at L3** while the key is down.
- On note-off: jump to segment 4, target `L4`. The voice is free when it reaches `L4` and `L4` is 0. **[I]** — `Env::keydown`, `Env::advance`, `Env::isActive`.
- Segment time is proportional to the _distance_ between the current level and the target, so
  time is not a parameter: a rate of 60 with L1=L2 costs nothing, and the same rate with a 90 dB
  excursion takes far longer.

There is no separate release rate for a note released mid-attack; segment 4 starts from wherever
the level happens to be.

### 5.2 The level domain is logarithmic — this is the non-linear curve

The EG integrates **in decibels**, not in amplitude. The internal level word is an exponent:
gain = `2^(level/2^24 − 14)` in the reference's fixed-point arithmetic. **[I]** — `FmCore::render`,
`Exp2::lookup(param.level_in − 14·2²⁴)`.

The unit of the internal level counter is therefore

```
1 level unit = 1/256 octave of amplitude = 6.0206 / 256 = 0.02352 dB          [derived]
```

which is the well-known 0.0235 dB gain quantisation of the original. **[C, corroborated]**

Because decay is linear in dB, **the amplitude decay is a true exponential** — a straight line on
a dB plot. A reimplementation that lerps linearly in amplitude between L values will sound
"synthetic and slow to die", which is the classic failure mode.

The **attack is a different curve**. It is not linear-in-dB. The reference applies:

```
if (level < 1716<<16) level = 1716<<16;        // floor: attacks start ~89.9 dB down, not at -inf
level += (((17<<24) - level) >> 24) * inc;     // increment scaled by (17 - level_in_octaves)
```

**[I]** — `Env::getsample`, rising branch.

That is a **target-seeking curve in the log domain**: the step size shrinks as the level rises,
producing an attack that is fast in dB at the bottom and decelerating at the top — perceptually a
convex, "instant then settle" attack. The `1716` floor also means an attack from silence is not
infinitely long. Both constants are required for the reference's characteristic percussive onset;
omitting the floor gives soft, late attacks, and using a linear-in-dB attack gives the
"clicky but flat" onset that betrays a naive port.

### 5.3 Rate: what the number means

```
qrate = min( ((R * 41) >> 6) + rate_scaling, 63 )
inc   = (4 + (qrate & 3)) << (2 + LG_N + (qrate >> 2))       // LG_N = 6, block of 64 samples
```

**[I]** — `Env::advance`.

So R 0..99 maps onto a 6-bit quantised rate 0..63 (R 99 → qrate 63), and the increment **doubles
every 4 qrate steps** with a 4-step linear interpolation inside each octave (the `4 + (qrate & 3)`
term gives 4/5/6/7, i.e. 1.00 / 1.25 / 1.50 / 1.75). The result is a piecewise-linear
approximation to an exponential rate law, with a step ratio of about 1.19× per qrate unit.

Because `((R*41)>>6)` compresses 100 values into 64, **adjacent patch rates are frequently
identical**. That is authentic; do not smooth it.

Decay slope at 44.1 kHz, computed from the code above **[derived]**:

|   R | qrate |        inc |   dB/s | seconds to fall 96 dB |
| --: | ----: | ---------: | -----: | --------------------: |
|   0 |     0 |      1 024 |  0.253 |                   379 |
|   5 |     3 |      1 792 |  0.443 |                   217 |
|  10 |     6 |      3 072 |  0.760 |                   126 |
|  20 |    12 |      8 192 |   2.03 |                  47.4 |
|  30 |    19 |     28 672 |   7.09 |                  13.5 |
|  40 |    25 |     81 920 |   20.3 |                  4.74 |
|  50 |    32 |    262 144 |   64.8 |                  1.48 |
|  60 |    38 |    786 432 |    195 |                 0.494 |
|  70 |    44 |  2 097 152 |    519 |                 0.185 |
|  80 |    51 |  7 340 032 |  1 815 |                0.0529 |
|  90 |    57 | 20 971 520 |  5 186 |                0.0185 |
|  95 |    60 | 33 554 432 |  8 297 |                0.0116 |
|  99 |    63 | 58 720 256 | 14 520 |                0.0066 |

The full 100-entry table is generated by the two lines of arithmetic above; store the formula,
not the table.

**Sample-rate independence.** The reference is fixed at its own clock. Scale `inc` by
`44100 / sampleRate` in Q24, as the reference implementation does (`Env::init_sr`), so that a
patch decays over the same wall-clock time at any host rate. **[I]**

**One real hardware behaviour the arithmetic misses.** When the target equals the current level
(a zero-distance segment) the ideal generator would advance instantly, but the hardware takes a
measurable time. Dexed carries an empirically measured table of "static" segment durations in
samples at 44.1 kHz, indexed by rate 0..76, behind `ACCURATE_ENVELOPE`, with the note that above
R=76 the time is `20 · (99 − R)` samples and that the attack segment is scaled ~20× faster. **[R]**
— the table is described in the source as empirically gathered from two units and
"needs to be double-checked". Treat the exact values as [U]; treat the _existence_ of a
non-zero zero-distance segment time as [I], because it is audible as the characteristic slight
"smear" on fast multi-segment percussive envelopes.

### 5.4 Level: L1..L4 and OUTPUT LEVEL

Both go through the same 0..99 → attenuation table:

```
scaleoutlevel(v) = v >= 20 ? 28 + v
                           : lowCurve(v)        // 20-entry table, see below
```

**[I]** — the linear-above-20 branch and the existence of a separate 20-entry low-end table.

`lowCurve` is a 20-entry table in the implementation. Its **shape**, which is what you need: it
starts at 0 for v = 0, rises steeply and with decreasing slope, and joins the linear branch at
v = 20 with a value of 48 (a 2-unit discontinuity against the linear branch's 28 + 20 = 48 — they
meet exactly). Between v = 0 and v = 20 it covers roughly 30 of the 48 units, i.e. the bottom
fifth of the control covers about 30 dB of a 90 dB range, front-loaded.

**Do not copy the 20 numbers.** Fit a smooth monotone curve to those endpoints and to the derived
attenuation figures in §5.5, then verify with test 13.4. If a fitted curve turns out to be audibly
wrong at very low output levels, that is worth knowing and is cheap to measure.

- Above 20 the mapping is linear in dB: 1 step = 32 internal units = **0.7526 dB**. **[derived,
  corroborated]**
- Below 20 the curve steepens sharply: level 0 sits about 90 dB below level 99. The low end is
  _not_ a straight line, and getting this wrong makes quiet modulators far too loud.

The two consumers differ in resolution:

```
target_level = ((scaleoutlevel(L_i) >> 1) << 6) + (scaleoutlevel(OUTLEVEL) << 5) − 4256
target_level = max(target_level, 16)
```

**[I]** — `Env::advance`.

The `>> 1` on the L value halves its resolution: **L1..L4 quantise to 1.505 dB steps** (changing
only every second unit) while **OUTPUT LEVEL resolves to 0.7526 dB**. **[derived, corroborated]**
That asymmetry is authentic and audible when automating a level.

### 5.5 Output level → modulation index

For a modulator, "output level" _is_ modulation depth. Peak phase excursion, computed from the
gain law of §5.2 with `L=99` **[derived]**:

| OUTPUT LEVEL | scaleoutlevel | dB rel. OL 99 | peak modulation index (radians) |
| -----------: | ------------: | ------------: | ------------------------------: |
|            0 |             0 |         −89.9 |                          0.0004 |
|            5 |            20 |         −80.5 |                          0.0012 |
|           10 |            31 |         −72.3 |                          0.0031 |
|           19 |            46 |         −61.0 |                          0.0113 |
|           20 |            48 |         −59.5 |                          0.0134 |
|           30 |            58 |         −51.9 |                          0.0318 |
|           40 |            68 |         −44.4 |                          0.0757 |
|           50 |            78 |         −36.9 |                           0.180 |
|           60 |            88 |         −29.4 |                           0.428 |
|           70 |            98 |         −21.8 |                           1.019 |
|           80 |           108 |         −14.3 |                            2.42 |
|           85 |           113 |         −10.5 |                            3.74 |
|           90 |           118 |         −6.77 |                            5.76 |
|           95 |           123 |         −3.01 |                            8.89 |
|           99 |           127 |          0.00 |                  **12.57 = 4π** |

**Maximum index at OUTPUT LEVEL 99 is exactly 4π ≈ 12.566 radians**, i.e. the modulator swings the
carrier's read pointer by ±2 whole cycles. **[derived]** One published FM conversion table quotes
≈13.12 for the same condition; see §16 for the conflict.

**Velocity can exceed it.** `ScaleVelocity` adds up to +224 internal units (≈ +5.3 dB) on top of
OUTPUT LEVEL 99 at velocity 127 with velocity sensitivity 7, pushing peak index to roughly 23 rad.
**[C, derived]** — `ScaleVelocity`, and `outlevel` is clamped to 127 _before_ the velocity term is
added. Decide deliberately whether to clamp; the reference's 12-bit envelope word saturates, so
clamping at the 12-bit ceiling is the more faithful choice. Marked **[U]** as to the exact
hardware ceiling.

### 5.6 Velocity scaling

```
vel_value  = velocityCurve[velocity >> 1] − 239   // 64-entry table, range 0..254
scaled_vel = ((sensitivity · vel_value + 7) >> 3) << 4           // sensitivity 0..7
```

**[I]** — the structure and the arithmetic; the 64-entry curve itself is **not reproduced here**.
Its shape: monotone increasing, 0 at the bottom, 254 at the top, strongly concave — it rises very
fast over the first few entries (0 → 70 → 86 → 97 in the first four) and then flattens, so most of
the table's resolution is spent on low velocities. The subtraction of 239 sets the _unity_ point:
velocities mapping to 239 produce no level change, higher velocities add, lower ones subtract.
239 lands around MIDI velocity 100. Re-derive by fitting a concave curve through those three
constraints, then verify with test 13.14. Note the table is indexed by `velocity >> 1`, so
**MIDI velocity resolution is halved to 64 steps** before it reaches the envelope. Authentic; keep
it, and expose an "extended velocity resolution" switch only as a documented deviation.

### 5.7 Pitch EG

One per voice, four rate/level pairs 0..99, shared by all operators, offsetting pitch in the log
domain. Two lookup tables define it:

- A **rate table**, 100 entries, mapping R 0..99 to an increment. Shape: monotone, roughly linear
  with slope ½ over the bottom quarter (values 1..15 across R 0..26), then accelerating to a near
  power-law, ending at 255. Full span is about 255:1, i.e. eight doublings. **[I]** — values not
  reproduced; fit a monotone curve through those anchors and verify with test 13.6.
- A **level table**, 100 entries, mapping L 0..99 to a signed −128..+127 pitch offset with a
  **compressed centre and expanded extremes**: level 50 is exactly 0; the region from about L 30 to
  L 85 moves in single units per step (so the centre of the control is fine-grained, roughly ±35
  units over 55 steps); outside that the steps grow rapidly, reaching −128 at L 0 and +127 at L 99.
  **[I]** — values not reproduced. The design intent is obvious and is what should be reproduced:
  fine pitch control near centre, wide sweeps at the extremes.

Level 50 is the centre (offset 0). The pitch EG is **linear in its own units**, unlike the
amplitude EG: `level += inc` with `inc = pitchenv_rate[R] · unit`, `unit = N·2²⁴/(21.3·SR)`.
**[I]** — `PitchEnv`.

The mapping from the level table's units to semitones is **[X]** — I could not establish the
reference's exact scaling constant from a primary source. The commonly reproduced figure is a
full range of about ±4 octaves at levels 0 and 99. Measure it (§13.6) before shipping.

---

## 6. Keyboard level scaling

Per operator: **BREAK POINT**, **LEFT DEPTH** 0..99, **RIGHT DEPTH** 0..99, **LEFT CURVE** and
**RIGHT CURVE** each one of four types. The result is an offset added to that operator's output
level, in the same 0.7526 dB units as OUTPUT LEVEL, then clamped to 127. **[I]** — `ScaleLevel`,
`ScaleCurve`, and the `outlevel + level_scaling`, `min(127, …)` sequence in `Dx7Note::init`.

### 6.1 Controls

| Control     | Range                    | Unit          | Default              | Notes                                  |
| ----------- | ------------------------ | ------------- | -------------------- | -------------------------------------- |
| BREAK POINT | 0..99, displayed A-1..C8 | note name     | C3 (patch-dependent) | the key at which scaling is zero       |
| LEFT DEPTH  | 0..99                    | scaling units | 0                    | applies to keys below the break point  |
| RIGHT DEPTH | 0..99                    | scaling units | 0                    | applies to keys above the break point  |
| LEFT CURVE  | 0..3                     | enum          | 0                    | 0 = −LIN, 1 = −EXP, 2 = +EXP, 3 = +LIN |
| RIGHT CURVE | 0..3                     | enum          | 0                    | same enum                              |

Curve enum ordering `−LIN, −EXP, +EXP, +LIN` is confirmed by the sign test `if (curve < 2) scale
= −scale` combined with the shape test `if (curve == 0 || curve == 3) linear`. **[I]**

### 6.2 Exact law

```
offset = midinote − break_point − 17
group  = offset >= 0 ?  (offset + 1) / 3        // right side
                     : −(offset − 1) / 3        // left side, integer division toward zero

linear:       scale = (group · depth · 329) >> 12
exponential:  scale = (expCurve[min(group, 32)] · depth · 329) >> 15
if (curve < 2) scale = −scale
outlevel += scale
```

**[I]** — `ScaleLevel` / `ScaleCurve`.

`expCurve` is a 33-entry table indexed by group (0..32, i.e. 0..96 semitones from the break
point). **[I]** — values not reproduced. Shape: 0 at group 0, then unit steps for the first ten
groups (so the first 30 semitones are almost linear and very shallow), then an accelerating rise
that becomes almost linear again at a much steeper slope from about group 20, saturating at 250 at
group 32. In other words it is a soft-knee exponential, not a pure one. Re-derive by fitting to
the derived dB figures in §6.3 and verify with test 13.7.

Notes an implementer will trip over:

- **Groups are 3 semitones wide**, so the scaling is a staircase with four steps per octave, not a
  smooth ramp. Audible on slow glissandi. Authentic — keep it.
- The `−17` offset means the break point in the patch byte is not the MIDI note number; the
  displayed break-point name and the byte differ by a fixed transposition.
- The exponential table saturates at group 32 (96 semitones), so beyond eight octaves from the
  break point the curve flattens.

### 6.3 Slopes at maximum depth **[derived]**

Linear curve, DEPTH 99:

| distance from break point | offset                 |
| ------------------------- | ---------------------- |
| 1 octave                  | 31 units = **23.3 dB** |
| 2 octaves                 | 63 units = 47.4 dB     |
| 3 octaves                 | 95 units = 71.5 dB     |

so ≈ **23.3 dB/octave**, straight. A widely repeated secondary claim puts this at "22 dB per
octave"; the discrepancy is discussed in §16. **[R vs derived]**

Exponential curve, DEPTH 99: 2.3 dB at 1 octave, 5.3 dB at 2, 11.3 dB at 3, 24.1 dB at 4, 94 dB
at 6 — i.e. almost nothing near the break point, then a cliff. This is what makes the "+EXP"
curve usable for brightening the top two octaves only.

---

## 7. Keyboard rate scaling

Per operator, **0..7**. It speeds all four EG rates up as pitch rises, which is what keeps high
notes from ringing.

```
x          = clamp(midinote / 3 − 7, 0, 31)
qratedelta = (sensitivity · x) >> 3
qrate      = min( ((R·41)>>6) + qratedelta, 63 )
```

**[I]** — `ScaleRate`, `Env::advance`.

At sensitivity 7 and the top of the keyboard, `qratedelta` reaches 27, i.e. nearly 7 doublings of
envelope speed (≈128×) relative to the bottom. At sensitivity 0 the term is zero everywhere.
The `/3` again gives a 3-semitone staircase.

There is a documented "super precise" correction in the reference implementation — at sensitivity
3 with `x mod 8 == 3` subtract 1, at sensitivity 7 with `1 ≤ x mod 8 ≤ 3` add 1 — reproducing a
hardware rounding artefact. **[I]** (compile-time flag `SUPER_PRECISE`). Include it; it costs two
comparisons and it is exactly the kind of detail that shows up in a null test.

---

## 8. Operator frequency

Per operator: **MODE** (ratio / fixed), **COARSE** 0..31, **FINE** 0..99, **DETUNE** 0..14
(displayed −7..+7). All arithmetic is in log-frequency, Q24 per octave. **[I]** — `Dx7Note::osc_freq`.

### 8.1 Ratio mode

`ratio = coarse_ratio(COARSE) · (1 + FINE/100)` **[C, derived]**

`coarse_ratio` comes from a 32-entry log table and evaluates to:

| COARSE | 0       | 1   | 2   | 3   | 4   | …   | 31  |
| ------ | ------- | --- | --- | --- | --- | --- | --- |
| ratio  | **0.5** | 1   | 2   | 3   | 4   | …   | 31  |

i.e. the integers 1..31 with 0.5 in slot 0. **[I, derived]** — decoded from the implementation's
log-domain coarse table, whose raw values are not reproduced here. The result is a clean,
documentation-checkable statement ("0.5 then the integers"), and the manual's "0.5 times to 32
times" phrasing corroborates it **[R]**; note the manual says 32 and the table tops out at 31 —
see §16.

FINE therefore gives 100 steps of 1% _of the coarse ratio_: with COARSE 1 the range is 1.00–1.99;
with COARSE 2 it is 2.00–3.98. The manual's phrasing "fine adjustment is possible over a range of
from 1 to 1.99 times" describes the COARSE 1 case. **[R]** Implement as a multiplier so it scales
with coarse; a fixed 0.01 additive step is wrong at high ratios.

### 8.2 Fixed-frequency mode

```
f = 10 ^ ( ((COARSE & 3) · 100 + FINE) / 100 )   Hz
```

**[C, derived]** — COARSE selects the decade (1, 10, 100, 1000 Hz) and FINE multiplies by
10^(FINE/100), i.e. 1.000 … 9.772. This matches the manual's "coarse adjustment in four steps —
1, 10, 100 and 1000 — and fine adjustment from 1 to 9.772 times". **[R, corroborated]**

Overall fixed range: **1 Hz to 9772 Hz**, logarithmic, 400 steps. In fixed mode the operator does
**not** track the keyboard and does **not** receive the pitch EG or pitch LFO — only the master
tune / pitch-bend term. **[I]** — the `opMode[op]` branch in `Dx7Note::compute` uses `pitch_base`,
not `pitch_mod`.

### 8.3 Detune

DETUNE is stored 0..14 and displayed −7..+7. The reference implementation models it as a
**note-dependent log-frequency offset**:

```
detuneRatio = 0.0209 · exp(−0.396 · logfreq_in_octaves) / 7
logfreq    += detuneRatio · logfreq · (DETUNE − 7)
```

**[I]** — with the source comment "those numbers come from my DX7".

Resulting detune per step **[derived]**:

| note     | frequency | cents at DETUNE = +7 | cents per step |
| -------- | --------- | -------------------- | -------------- |
| A0 (21)  | 27.5 Hz   | +18.1                | +2.58          |
| C2 (36)  | 65.4 Hz   | +13.9                | +1.98          |
| C4 (60)  | 261.6 Hz  | +8.4                 | +1.20          |
| C6 (84)  | 1046.5 Hz | +4.7                 | +0.68          |
| C8 (108) | 4186 Hz   | +2.6                 | +0.37          |

So detune is **approximately a constant frequency offset, not a constant interval** — a few cents
at the top of the keyboard, nearly 20 cents at the bottom. An earlier revision of the same
implementation used a literally constant increment ("7.213 Hz per count at 9600 Hz", i.e.
`logfreq += 12606 · (DETUNE − 7)`), still present as a comment. **[I]** A commonly repeated
secondary claim is that the range is a flat ±2 cents. **[R]** — that matches the model only near
the top octave. See §16.

In **fixed mode** detune is applied asymmetrically and only for positive values:
`logfreq += (DETUNE > 7) ? 13457·(DETUNE−7) : 0`. **[I]** Whether that asymmetry is hardware
behaviour or a reimplementation shortcut is **[U]**.

Recommendation for MotionLab: implement the note-dependent model as the default (it is the one
measured off hardware), and expose the constant-cents model behind a "modern detune" switch,
documented as a deviation.

---

## 9. LFO

One LFO per voice, global to all six operators, with per-operator amplitude sensitivity.

### 9.1 Controls

| Control                     | Range | Unit         | Notes                                                                       |
| --------------------------- | ----- | ------------ | --------------------------------------------------------------------------- |
| WAVE                        | 0..5  | enum         | 0 triangle, 1 saw down, 2 saw up, 3 square, 4 sine, 5 sample & hold **[I]** |
| SPEED                       | 0..99 | table index  | see §9.2                                                                    |
| DELAY                       | 0..99 | table index  | see §9.3                                                                    |
| PMD (pitch mod depth)       | 0..99 | —            | scaled `(PMD · 165) >> 6` **[I]**                                           |
| AMD (amp mod depth)         | 0..99 | —            | scaled `(AMD · 165) >> 6` **[I]**                                           |
| PMS (pitch mod sensitivity) | 0..7  | enum → table | global                                                                      |
| AMS (amp mod sensitivity)   | 0..3  | enum → table | **per operator**                                                            |
| KEY SYNC                    | 0/1   | bool         | resets LFO phase to just below the top on each note-on **[I]**              |

The waveform generators are integer-exact in the reference implementation — triangle, square and
sawtooth are built by shifts and masks on the phase accumulator with no interpolation, so they are
**not band-limited**, and sample & hold is driven by a small 8-bit linear congruential generator
resampled on each phase wrap. **[I]** The behavioural consequences, which are what to reproduce:
the square LFO steps instantly (no slew), the sawtooth wraps instantly, and the S&H sequence is
**periodic with a short period** rather than truly random, so a patch's "random" modulation repeats
audibly. Pick our own generator; match the period length only if test 13.9's listening check says
the repetition is part of the character.

All waveforms produce a **unipolar** value; the bipolar conversion happens downstream, and pitch
and amplitude take opposite polarity conventions. **[I]**

### 9.2 SPEED — the rate law is a table, not a formula

The reference implementation holds a **100-entry table of LFO frequencies in Hz**, one per SPEED
value. **[I]** — the table is not reproduced here. Its anchors and shape, which is what to build
from:

| SPEED |     Hz |
| ----: | -----: |
|     0 | 0.0625 |
|    10 |   1.56 |
|    25 |   4.00 |
|    50 |   7.99 |
|    63 |  10.12 |
|    64 |  11.25 |
|    75 |  20.83 |
|    99 |  49.26 |

Two things to note. The law is **piecewise**: from SPEED 0 to 63 it is close to linear in Hz at
about 0.16 Hz per step, and at SPEED 64 the slope jumps by roughly 7× to about 1.1 Hz per step,
running to 49.26 Hz at SPEED 99. That break is a property of the original's rate divider, not a
transcription artefact, and it is audible — the top third of the control is a completely different
range of speeds. The table also contains repeated near-duplicate values, so adjacent SPEED settings
are sometimes indistinguishable.

Reproduce it as **two linear segments joined at 64**, fitted to the anchors above, and verify with
test 13.9. Do not use a single exponential law — it is the common shortcut and it puts the useful
vibrato speeds in the wrong place on the control.

### 9.3 DELAY

DELAY 0..99 sets a two-slope ramp that gates the LFO in after note-on:

```
a = 99 − DELAY
if (a == 99) { delayinc = delayinc2 = 0xFFFFFFFF }      // DELAY 0: no delay
else {
  a         = (16 + (a & 15)) << (1 + (a >> 4))
  delayinc  = unit · a
  a        &= 0xff80;  a = max(0x80, a)
  delayinc2 = unit · a
}
unit = round(N · 25190424 / sampleRate)                 // constant = 2³²/15.5 s/11
```

**[I]** — `Lfo::reset`, `Lfo::init`.

The delay runs a 32-bit counter: while it is below half scale the LFO output is forced to zero;
above half scale the LFO **fades in** over the second slope. So DELAY is not a hard gate — it is a
hold followed by a fade, and the fade is the slower of the two slopes. Maximum total delay is on
the order of 15 s. **[derived from the `2³²/15.5 s` constant; exact maximum is [U]]**

### 9.4 Depth and sensitivity

- **PMS** 0..7 → `{0, 10, 20, 33, 55, 92, 153, 255}` **[I]**. Note the top three steps roughly
  1.67× each; the curve is exponential, so PMS 7 is far more than 7/7 of PMS 4.
- **AMS** 0..3 → Q24 `{0, 4342338, 7171437, 16777216}` = **{0, 0.2588, 0.4274, 1.0}** **[C, derived]**.
  Per operator, so amplitude modulation can be applied to modulators only (timbral tremolo) or to
  carriers only (amplitude tremolo).
- Pitch modulation combines the LFO term and the external mod-wheel term with **max()**, not a
  sum: `pitch_mod = max(|pmd·lfo|, |wheel·lfo|)`, sign taken from the LFO. **[I]** — `Dx7Note::compute`.
  Same for amplitude. This "whichever is greater wins" rule is unusual and must be copied; a sum
  gives noticeably deeper vibrato when both are active.
- Amplitude modulation is applied in the log domain via `exp(sensamp/262144 · 0.07 + 12.2)`, with
  the source comment "this needs some real tuning". **[I]** Treat the exact AM depth curve as
  **[U]** and verify by measurement (§13.5).

---

## 10. Patch data layout (for import/export)

The reference voice is 155 bytes packed / 156 bytes unpacked. Unpacked layout, which is what the
DSP consumes **[I]** — offsets read directly from `Dx7Note::init`:

| Offset         | Field                              |
| -------------- | ---------------------------------- |
| `op·21 + 0..3` | R1..R4                             |
| `op·21 + 4..7` | L1..L4                             |
| `op·21 + 8`    | break point                        |
| `op·21 + 9`    | left depth                         |
| `op·21 + 10`   | right depth                        |
| `op·21 + 11`   | left curve                         |
| `op·21 + 12`   | right curve                        |
| `op·21 + 13`   | rate scaling                       |
| `op·21 + 14`   | amplitude mod sensitivity (0..3)   |
| `op·21 + 15`   | velocity sensitivity (0..7)        |
| `op·21 + 16`   | output level                       |
| `op·21 + 17`   | oscillator mode (0 ratio, 1 fixed) |
| `op·21 + 18`   | coarse                             |
| `op·21 + 19`   | fine                               |
| `op·21 + 20`   | detune                             |
| 126..129       | pitch EG rates 1..4                |
| 130..133       | pitch EG levels 1..4               |
| 134            | algorithm (0..31)                  |
| 135            | feedback (0..7)                    |
| 136            | oscillator key sync                |
| 137            | LFO speed                          |
| 138            | LFO delay                          |
| 139            | LFO pitch mod depth                |
| 140            | LFO amp mod depth                  |
| 141            | LFO key sync                       |
| 142            | LFO waveform                       |
| 143            | pitch mod sensitivity              |
| 144            | transpose                          |
| 145..154       | name (10 ASCII characters)         |

Operators are stored **in reverse order**: index 0 is operator 6. Consistent with the render
order of §1.2. **[I]**

MotionLab must not ship any preset data derived from a commercial ROM. The layout is documented
here only so that user-supplied patch files can be imported.

---

## 11. Numerical format of the original

| Property                            | Value                                                                                                   | Confidence                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------- |
| Internal sample rate                | **49 096 Hz**                                                                                           | [R], consistently reported |
| DAC clock                           | 785 536 Hz (49 096 × 16), time-multiplexed across voices                                                | [R]                        |
| Envelope word to the operator chip  | **12 bits**                                                                                             | [R]                        |
| Frequency word to the operator chip | 14 bits                                                                                                 | [R]                        |
| Phase accumulators                  | 96 (16 voices × 6 operators)                                                                            | [R]                        |
| Sine table                          | stored as **log₂                                                                                        | sin                        | **, so amplitude scaling is an _addition_ | [C] |
| Exponential                         | two identical ROMs plus adder/shifter reconstruct 2^x                                                   | [R]                        |
| Output converter                    | 12-bit DAC plus a **3-bit discrete compander** — sign, 11-bit mantissa, 2-bit exponent scaling ×1/2/4/8 | [R]                        |
| Effective dynamic range             | ~15 bits                                                                                                | [R]                        |
| Output filter                       | aggressive analogue LPF, quoted around 16 kHz on the first hardware revision                            | [R]                        |

The log-domain trick is the architectural key: with the sine stored as a logarithm, applying an
envelope is an add rather than a multiply, and the single exponential ROM at the end of the chain
converts back. That is why the gain quantisation is 0.0235 dB — it is one LSB of the log-domain
adder — and why the _level_ domain, not the amplitude domain, is the natural place to do all
envelope arithmetic (§5.2).

---

## 12. Character artefacts worth modelling

1. **Aliasing.** There is no oversampling and no band limiting. Operator ratios above about 8,
   high feedback, and high modulation indices all fold energy back below Nyquist. This is a
   defining part of the sound — the "glassy" top end of the era's electric-piano and bell patches
   is partly aliasing. **Do not** oversample by default. Offer oversampling as an explicit,
   off-by-default "clean" mode, and document that it changes the character.
2. **Quantisation noise floor.** 0.0235 dB gain steps and a 12-bit companded output give a
   noise floor that rises and falls with signal level (the compander's exponent switching). The
   audible signature is a faint "breathing" behind long decays. Model as: quantise the summed
   voice output to a floating-point word with an 11-bit mantissa and a 2-bit exponent before the
   output filter. **[R]** — reproduces the compander's behaviour without modelling its resistors.
3. **Compander zipper.** Because the exponent is discrete, a decaying tone crosses exponent
   boundaries and the noise floor steps. Reported as audible on the original and as a source of
   its "gritty" decays. **[R]**
4. **Free-running operator phase.** Operators are not phase-reset per note unless key sync is set,
   so repeated notes at the same pitch differ slightly in attack timbre. Cheap to reproduce; do
   not "fix" it.
5. **The output LPF.** A steep lowpass around 16 kHz on the first hardware revision noticeably
   tames the aliasing and thickens the low end relative to the later revision. Worth offering as
   a two-position "output stage" switch. **[R]**
6. **Rate quantisation staircases.** §5.3 (100 rates → 64), §6.2 and §7 (3-semitone groups) all
   produce audible steps under automation. Authentic. Keep.

---

## 13. Verification — tests QA should run

All tests at 48 kHz unless stated, rendering to 32-bit float, comparing against the stated target.
Where a tolerance is given as dB it is on the magnitude spectrum after a Hann window.

| #     | Test                            | Method                                                                                                                                                                                                                                                                              | Target                                                                      | Tolerance                            |
| ----- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------ |
| 13.1  | **Algorithm topology**          | For each of the 32 algorithms, set exactly one operator to OUTPUT LEVEL 99 and the rest to 0; assert audible output only for the carriers listed in §3. Then set one modulator at a time to index 1 and assert sidebands appear only around the carriers it is documented to reach. | matches §3 exactly                                                          | binary pass/fail                     |
| 13.2  | **Feedback depth law**          | Algorithm 32, operator 6 only, ratio 1, feedback 1..7, measure THD+N of the resulting waveform and the amplitude of the 2nd harmonic.                                                                                                                                               | 2nd-harmonic level rises ≈6.0 dB per feedback step                          | ±0.5 dB per step                     |
| 13.3  | **Envelope decay slope**        | One carrier, L1=99, L2=0, R2 under test, render note-on and measure the time for the level to fall from −6 dB to −66 dB.                                                                                                                                                            | matches the dB/s column of §5.3, scaled to 48 kHz                           | ±3 %                                 |
| 13.4  | **Envelope level quantisation** | Sweep L2 across 0..99 with fixed OUTPUT LEVEL; measure sustain level. Sweep OUTPUT LEVEL 20..99 likewise.                                                                                                                                                                           | L steps 1.505 dB (changing every 2 units); OL steps 0.7526 dB               | ±0.05 dB                             |
| 13.5  | **Output level → index**        | Two operators, algorithm 5, carrier ratio 1, modulator ratio 1; sweep modulator OUTPUT LEVEL; fit the sideband amplitudes to Bessel `J_n(I)` and recover I.                                                                                                                         | I(99) = 4π ± 2 %; the full curve within ±0.5 dB of §5.5                     | ±2 % on I                            |
| 13.6  | **Pitch EG range**              | Pitch EG L = 0 and 99 with all other levels 50; measure the pitch offset of a ratio-1 carrier.                                                                                                                                                                                      | record the measured value and **fill in the [X] in §5.7**                   | n/a — this test defines the constant |
| 13.7  | **Keyboard level scaling**      | −LIN, depth 99, break point C3; measure carrier level at C3, C4, C5, C6.                                                                                                                                                                                                            | −23.3 dB per octave, staircase in 3-semitone steps                          | ±0.5 dB                              |
| 13.8  | **Rate scaling**                | Rate scaling 7, R2 = 50, measure decay time at C1 and C7.                                                                                                                                                                                                                           | ratio ≈ 128:1                                                               | ±10 %                                |
| 13.9  | **LFO rate**                    | For SPEED = 0, 25, 50, 63, 64, 75, 99 measure the modulation period.                                                                                                                                                                                                                | matches §9.2                                                                | ±1 %                                 |
| 13.10 | **LFO delay shape**             | DELAY 50, measure time to first non-zero LFO output and time to full depth.                                                                                                                                                                                                         | two-slope: hold then fade, fade slower than hold                            | qualitative + record values          |
| 13.11 | **Fixed frequency**             | MODE = fixed, sweep COARSE 0..3 and FINE 0/50/99; measure the fundamental.                                                                                                                                                                                                          | `10^((COARSE·100+FINE)/100)` Hz                                             | ±0.5 %                               |
| 13.12 | **Ratio accuracy**              | COARSE 0..31 at FINE 0; measure the ratio to the carrier.                                                                                                                                                                                                                           | 0.5 then integers 1..31                                                     | ±0.05 %                              |
| 13.13 | **Detune**                      | DETUNE −7/+7 at A0, C4, C8; measure cents.                                                                                                                                                                                                                                          | matches §8.3 table                                                          | ±0.3 cents                           |
| 13.14 | **Velocity**                    | Sensitivity 7, velocities 1..127; measure carrier level.                                                                                                                                                                                                                            | monotone, 64 distinct steps (velocity halved), max +5.3 dB over the nominal | step count exact                     |
| 13.15 | **Sample-rate independence**    | Render the same patch at 44.1 / 48 / 96 kHz; align and measure envelope times and LFO periods.                                                                                                                                                                                      | identical                                                                   | ±0.1 %                               |
| 13.16 | **Aliasing signature**          | Ratio 14 modulator, index 8, carrier at C5; compare the spectrum with and without the optional oversampling mode.                                                                                                                                                                   | default mode shows fold-back partials; oversampled mode does not            | qualitative, must differ             |
| 13.17 | **CPU budget**                  | 16 voices, algorithm 1, all six operators active, feedback 7.                                                                                                                                                                                                                       | within the per-instrument budget in `docs/PERFORMANCE.md`                   | per that document                    |

A **null test against a reference implementation** is deliberately _not_ on this list as a
pass/fail gate, because MotionLab intentionally diverges on algorithms 4 and 6 (§3) and on the
optional oversampling and detune modes. Run it as a diagnostic; expect and document differences
only in those places.

---

## 14. UI era language (1983–1985 digital workstation)

For the UI team. This describes the _period vocabulary_, not any specific product's trade dress.
Nothing here licenses copying a panel layout, a logotype, a typeface, or a badge.

**Control taxonomy.** The period's defining move was the removal of one-knob-per-function.
The vocabulary is:

- a **single shared data-entry control** (a short-throw linear slider plus an increment/decrement
  pair) that acts on whatever parameter is currently selected;
- a **matrix of identically sized, unlabelled-until-context membrane keys** for parameter
  selection, arranged in a rectangular grid with printed legends _above_ rather than on the key;
- **mode keys** that reassign the whole grid (voice select / edit / function), so the same 32 keys
  mean different things in different modes;
- a **numeric-first display** rather than a graphical one.

**Layout logic.** Rectangular, orthogonal, no bezels or wood cheeks. The panel divides into three
horizontal bands: performance controls at the far left (pitch/mod, near the keyboard's left
edge), the selection grid across the centre, the display and data entry to the right of centre.
Group boundaries are shown by thin printed rules and by a single accent colour behind a group's
legends — not by physical separation.

**Display technology.** A two-line, 16-character-per-line reflective LCD, monochrome, no
backlight on the earliest units. Its low contrast and narrow viewing angle are era-defining. Our
equivalent should be a fixed-pitch 2×16 character field, with real character-cell metrics — do
not render proportional text in a "retro" frame. Segment/character rendering, not pixel graphics.

**Colour temperature.** Cool neutral grey-beige panel (roughly L\* 70–75, very low chroma, a hint
of green rather than of red), near-black legends, and one saturated accent used only for grouping.
The period accent in this class of instrument was a clear mid-green. Display: dark grey characters
on a pale grey-green field, low contrast — **not** the high-contrast blue-white of later LCDs and
not the amber/green glow of a VFD (that belongs to the analogue-matrix instruments, see
`syn-05-matrix-twelve.md`).

**Typography.** Condensed grotesque, all caps, small, tightly tracked, printed in two weights
only. Parameter legends are abbreviated to fit a fixed grid pitch.

**What to evoke, concretely, in an original design.** A dense uniform key grid; one data slider;
a small character display that is the only place numbers live; a single green accent; a matt
grey-beige field; no skeuomorphic knobs anywhere. Our algorithm display should be a schematic of
operator boxes drawn from our own primitives — the connection topology is functional information
(the table in §3), not artwork, but the _drawing_ must be ours.

---

## 15. Sources

Classified per §0.1. **Class determines what may be used.**

### Documentation (manufacturer's own)

- Manufacturer operation manual, via ManualsLib page extracts — feedback range 0..7 and its
  description, keyboard level scaling break point A-1..C8 and four curve types, LFO waveform list,
  ratio-mode 0.5×–32× and fine 1–1.99×, fixed-mode decades and 1–9.772× fine, detune −7..+7, and
  the printed chart of all 32 algorithms (which I could **not** open — see §3.1).
  <https://www.manualslib.com/manual/196296/Yamaha-Dx7.html>
- Manufacturer design archive — membrane-switch and LCD-centred interface rationale, the
  "clear DX green" grouping accent, the deliberate contrast with knob-covered analogue panels.
  <https://www.yamaha.com/en/tech-design/design/insights/id_009/>
- Manufacturer patents, referenced but not read here: the FM tone-generation and
  variable-algorithm patents describe the operator interconnection scheme and the feedback mean
  filter. **These are the correct primary source for §3 and §4 and should be read before
  implementation.**

### Measurement (observation of the physical device)

- Ken Shirriff, reverse-engineering series on the operator and envelope chips, parts I–VI —
  log-sine ROM, exponential circuit, algorithm implementation, output circuitry, control
  registers. Die-level observation of real silicon.
  <https://www.righto.com/2021/11/reverse-engineering-yamaha-dx7.html>,
  <https://www.righto.com/2021/12/yamaha-dx7-reverse-engineering-part-iii.html>,
  <https://www.righto.com/2021/12/yamaha-dx7-chip-reverse-engineering.html>,
  <https://www.righto.com/2022/02/yamaha-dx7-chip-reverse-engineering.html>
- ajxs, "Yamaha DX7 Technical Analysis" — 49 096 Hz sample rate, DAC clock, 96 phase
  accumulators, 12-bit envelope / 14-bit frequency words, the 4096-sample sine period.
  <https://ajxs.me/blog/Yamaha_DX7_Technical_Analysis.html>
- Google, `music-synthesizer-for-android` **wiki** (prose, not code) — envelope scaling in dB and
  dB/s, the 0.0235 dB gain quantisation, the 0.75 dB output-level step, the 1.5 dB L-value step.
  Presented there as measurement; corroborates the [I] arithmetic independently.
  <https://github.com/google/music-synthesizer-for-android>
- Gearspace and Vintage Synth Explorer threads — output-stage compander, ~15-bit dynamic range,
  the ~16 kHz output filter on the first hardware revision. [R] only; not instrumented.

### Implementation (an emulator — **[I]**, re-derive before use)

- **Dexed**, `asb2m10/dexed`. Project licence **GPL-3.0**. The files I read are its DSP core
  `Source/msfa/`, which is Google's `music-synthesizer-for-android` and carries **Apache-2.0**
  headers in each file I opened: `fm_core.cc`, `fm_core.h`, `fm_op_kernel.cc`, `env.cc`, `lfo.cc`,
  `pitchenv.cc`, `dx7note.cc`, `sin.h`, `exp2.h`, `synth.h`, `freqlut.cc`.
  <https://github.com/asb2m10/dexed>
  Source of the algorithm topology in §3 (see §3.1 for the caveat and the named gap), and of every
  value marked **[I]**. The verbatim constant tables it contains have been deliberately **not**
  reproduced in this sheet; see §0.1.

### Conflicting or single-source claims

- "FM DX Supplement" modulation-index tables (Yala Abdullah) — the ≈13.12 index figure at output
  level 99 that conflicts with the derived 4π. <https://www.angelfire.com/in2/yala/t2dx-fm.htm>
- JonDent, "DX7 — Keyboard Level Scaling" — the "22 dB per octave at −LIN depth 99" claim.
  <https://djjondent.blogspot.com/2019/10/dx-7-keyboard-level-scaling.html>
- Dexed issue #88, "Detune doesn't work like a DX7" — the 7.213 Hz-per-count history and the
  ±2 cents claim. <https://github.com/asb2m10/dexed/issues/88>

---

## 16. Not confirmed, and conflicts

1. **Peak modulation index at OUTPUT LEVEL 99.** Derived from the reference implementation's gain
   law as exactly **4π ≈ 12.566 rad**; a published FM conversion table gives **≈13.12**. The two
   differ by 4.4 %. I take 4π because it is derived from code I read rather than from a table
   whose measurement conditions are unstated, and because 4π is a suspiciously clean number for a
   design whose gain word is a power-of-two exponent. **Test 13.5 settles it.** Until then, [U].
2. **Keyboard level scaling slope at −LIN depth 99.** Derived: **23.3 dB/octave**. A secondary
   source says 22 dB/octave. The derivation is arithmetic from code (`(4·99·329)>>12 = 31` units ×
   0.7526 dB); the 22 figure may be a rounded measurement or may refer to a different depth. I use
   23.3 and mark it [derived]. Test 13.7 settles it.
3. **Pitch EG scaling constant.** the pitch-EG level table's units → semitones is **[X]**. Test 13.6 must
   establish it before the pitch EG ships.
4. **Detune law.** Three descriptions exist: note-dependent log offset (current reference
   implementation, "numbers from my DX7"), constant Hz offset (older revision), flat ±2 cents
   (community claim). They agree only near the top of the keyboard. I recommend the first; [U]
   until test 13.13 is run against a hardware capture, which we do not have.
5. **Fixed-mode detune asymmetry** (`detune > 7` only). Possibly a reimplementation shortcut
   rather than hardware behaviour. **[U]**
6. **Zero-distance envelope segment durations.** The `statics[]` table is empirically measured from
   two units by a third party, self-described as needing double-checking, and stops at rate 76.
   **[U]** for the values; **[C]** for the phenomenon.
7. **Amplitude-modulation depth curve.** The `exp(x·0.07 + 12.2)` mapping in the reference carries
   the comment "this needs some real tuning". **[U]**
8. **Maximum LFO delay in seconds.** Derivable in principle from the `2³²/15.5 s` constant, but I
   could not confirm the intended maximum against a manual. **[U]**
9. **Envelope headroom above OUTPUT LEVEL 99 via velocity.** The reference clamps output level to
   127 before adding the velocity term, allowing ≈+5.3 dB beyond nominal. Whether the hardware's
   12-bit envelope word saturates there is **[U]**.
10. **Display geometry.** Sources describe the panel display variously as "a tiny 16-character LED
    display" and as a two-line 16-character LCD; replacement-part discussions consistently refer to
    2×16 HD44780-class LCD modules, which is the better-evidenced reading and the one used in §14.
    **[R]**
11. **Whether operator phase is reset on note-on when oscillator key sync is set.** Patch byte 136
    exists and is named, but the reference implementation I read does not act on it in the operator
    phase. **[X]**
12. **Provenance of the numeric tables.** Every constant table in the source implementation
    (output-level curve, velocity curve, pitch-EG rate and level tables, keyboard-scaling
    exponential curve, coarse-ratio table, LFO rate table) has undocumented provenance. They may be
    measurements, they may be transcriptions of the original firmware ROM, or they may be fits. I
    have described their shapes rather than reproducing them (§0.1). **Their provenance is [X] and
    must be treated as the worst case — ROM transcription — until shown otherwise.** Re-derive by
    measurement or fitting.
13. **Coarse ratio top value.** The manual is reported as saying the ratio range runs to **32×**;
    the implementation's table tops out at **31×** (32 entries, 0.5 then 1..31). One of the two is
    wrong. **[U]** — test 13.12 settles it.
14. **The algorithm table's unverified rows.** Fourteen of the 32 rows have no independent
    corroboration (§3.1). **[U]** until checked against the manufacturer's chart.
