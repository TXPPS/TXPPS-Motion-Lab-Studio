# Reference spec — FX-01 Motion Shaper (multiband rhythmic modulation processor)

Status: **research complete, ready to implement against**. Author: Research Analyst.
Class of device: multiband, drawable-LFO rhythmic modulation processor. The reference
product family for behaviour research is Cableguys **ShaperBox** (v3.x) and its
individually-sold Shaper modules.

## 0. How to read this document

Confidence markers, used on every non-obvious claim:

- **[C]** confirmed — vendor documentation or a first-party/established-press source, or
  derived analytically in this document from first principles that are themselves cited.
- **[R]** reported — a reputable secondary source (press review, vendor marketing page)
  but not cross-checked against the manual.
- **[U]** unconfirmed — plausible or commonly believed. **Do not build to a [U] claim.**
- **[I]** inference / our own design decision. Not a claim about the reference product.
  These are the parts DSP is free to argue with; the [C] parts it is not.

**Sourcing constraint.** `downloads.cableguys.com` (the PDF manual), `cableguys.com`,
`soundonsound.com` and `scribd.com` are **not fetchable from this build environment** — the
egress proxy returns `EGRESS_BLOCKED`. A direct fetch of the ShaperBox 3 manual PDF was
attempted once and refused. Everything below was gathered by search-engine extraction of
those pages. The substance is the vendor's; the exact wording of any given sentence is a
paraphrase. Exact numeric ranges are therefore marked [U] unless a source quoted the number
outright. Section 9 lists what could not be confirmed at all.

**Intellectual-property rule for this file.** Manufacturer and product names appear here
because this is an internal research note and naming the object of study is how research
works. They must **never** appear in shipped UI strings, code identifiers, filenames,
preset names, or marketing copy. What we are permitted to learn from is *behaviour and
interaction design* — what a control does, how a workflow is sequenced, why a layout works.
No panel artwork, logo, typeface or badge is described here, and none may be traced,
imitated or reproduced. Nothing in this document was obtained by decompilation or asset
extraction, and no such method may be used.

---

## 1. Reference family survey — architecture and interaction model

### 1.1 Module inventory

The v3 host contains a set of interchangeable processing modules ("Shapers"), each also
sold standalone. The full v3.6 module list, as documented by the manual's own contents
listing: **PitchShaper, ReverbShaper, TimeShaper 3, DriveShaper 2, NoiseShaper 2,
FilterShaper Core 3, LiquidShaper, CrushShaper 2, VolumeShaper 7, PanShaper 4,
WidthShaper 3** — eleven modules. **[C]**

Note a real conflict in the sources: vendor marketing copy and several reviews consistently
say "**nine** multiband effects — Volume, Time, Drive, Filter, Crush, Noise, Pan, Width and
the new Liquid". **[R]** The eleven-item list is the manual's contents page and includes
PitchShaper and ReverbShaper, which are sold as separate products and bundle additions. The
reconciliation that fits both: **nine modules ship inside the base host; PitchShaper and
ReverbShaper are separately-purchased modules that dock into the same host.** I take the
eleven-item manual listing as the better-documented statement of what the *host
architecture* supports, and the nine-item figure as the base-bundle content. **[I]**

What each module does, for our purposes:

| Reference module | Function | Confidence |
| --- | --- | --- |
| Volume | Gain modulation; the sidechain-ducking workhorse. v7 adds a compressor whose gain reduction is drawn on the *same* graph as the manual volume curve, so drawn and dynamic gain are read together. | [C] compressor-on-same-graph; [R] "British-inspired" voicing |
| Pan | Amplitude panning **plus delay-based Haas panning**, selectable/blendable. This is the notable one: two physically different pan laws in one module. | [R] |
| Width | Mid/side modulation, per band. | [R] |
| Filter | Dual filter, low-pass / high-pass / band-pass / notch / peaking, independently configured; **zero-delay-feedback topology with resonance compensation and internal saturation**; a "Safe Res" mode caps resonance below self-oscillation, defeatable. | [R] |
| Drive | Distortion set (multiple algorithms, count unknown). | [R] |
| Crush | Bit-depth reduction and sample-rate reduction (lo-fi digital distortion). | [R] |
| Noise | Modulated noise layering/texture rather than a processor of the input. | [R] |
| Time | Modulates the **position of a virtual playhead** in a recorded buffer, producing stutter, half-time, reverse, scratch, tape-stop and glitch. Sync'd to beats/bars, "all with sample accuracy". | [C] |
| Liquid | Flanging and phasing (modulated short delay / allpass chain) in one module. | [R] |
| Pitch | Multiband pitch shifting **with independent formant control** — described as making voices deeper/thinner/older/younger, which is only possible if the formant envelope is shifted independently of pitch. | [C] |
| Reverb | Rhythmically modulated reverb. Static controls named in the source: **Size, Decay, Pre-Delay, Width**. | [C] |

There is **no dedicated Send module** in the researched product line. The brief asked me to
enumerate a "send" module; I could find no evidence one exists. What exists instead is a
per-band and a master **Mix** (dry/wet) control, which covers the parallel-processing use
case a send would serve. **[C]** (absence confirmed across the manual contents listing and
three independent reviews; marked [C] as an absence, not a presence).

### 1.2 Band splitting

- **Three bands maximum.** Defined in a "Bands" section at the top-left, which also
  displays the audio spectrum and the modulation-signal level for each band. **[C]**
- Bands are **added**, not always-present: you add a low or a high band by dragging a
  **Split slider** to a frequency. So the device runs in 1-, 2- or 3-band configurations,
  and 1-band is the default state. **[C]**
- Crossover frequencies are user-set by dragging handles on the spectrum. Exact split
  frequencies are shown in a help-text strip at the bottom of the window on mouse-over
  rather than as a permanent numeric readout. **[C]**
- **Selectable crossover slope: 6, 12 or 24 dB/octave**, per split. The control is hidden
  until the mouse enters the spectrum area. **[C]**
- Each band carries its own module parameters *and its own modulation curve*. **[C]**

The interaction lesson worth copying: the crossover controls are **progressive-disclosure**
— hidden until hover, numeric value in a status strip rather than a permanent field. That
keeps a dense processor legible. The band split is also the *first* thing in the visual
hierarchy (top-left), which correctly signals that it is the outermost structural decision.

### 1.3 Module ordering and routing

- Modules are processed **in series**, forming a chain. **[C]**
- The chain order is **user-rearrangeable by dragging modules left/right in a
  "Shaper Bar"**, and the vendor documentation explicitly states the order materially
  changes the sound. **[C]**
- Whether the band split is *inside* each module or *outside* the whole chain: the
  documented behaviour is that **every module can independently be split into up to three
  bands**, with its own crossover frequencies. **[C]** That means the split is
  **per-module**, not a single global split feeding parallel chains — i.e. the topology is
  a series of modules, each of which internally splits, processes and re-sums.
- Per-band bypass and per-band solo: **unknown**. Not documented in any reachable source.

### 1.4 The drawable LFO editor

- Waveforms are built from **breakpoints** which may be **soft (curved) or hard
  (cornered)**. **[C]**
- **Three drawing tools ("Pens")**: a **Line Pen** (straight segments), an **Arc Pen**
  (curved arcs), and an **S-Curve Pen** (S-shaped segments). Plus a **Pointer** tool that
  creates and edits points **without** snapping to the grid. **[C]**
- **Snap to grid**: when active, newly added *and* dragged points snap to the background
  grid. The Pointer is the documented escape hatch from snapping. **[C]**
- The background grid has **Auto Straight / Auto Triplet** behaviour, on by default, which
  switches grid subdivision according to the LFO length. **[C]**
- Control-strip operations on the whole wave include **randomise all point positions**;
  the full operation list is **unknown**. **[C]** for randomise, **[U]** for the rest.
- **Wave Presets** load a shape into the current module *without touching any other
  setting* — sine/square/saw analogue shapes, sidechain-duck shapes, and rhythmic patterns.
  **Shift-click on a preset rescales it to the current wave's vertical range** instead of
  replacing the range, which is how you audition shapes inside a narrow filter-cutoff
  window without losing your calibration. **[C]** That modifier behaviour is the single
  best interaction idea in the product and we should copy it.
- **Nine Custom Wave slots** for user-stored shapes, store and one-click recall. **[C]**
- **Maximum point count: unknown.** No source states it.
- **Curve tension model (the exact parameterisation of arc/S curvature): unknown.** Sources
  confirm curvature exists and is dragged, not that it is a numeric parameter with a range.

### 1.5 Sync, rate and trigger modes

Four modes are documented:

1. **Host-synced loop.** The LFO loops at a selected note value or bar count, from
   **1/128 up to 32 bars**, in **straight, triplet and dotted** variants. **[C]** Grid
   highlighting differs by mode: in straight timings, LFO lengths longer than 1/4 always
   highlight main beats/bars; in dotted timings the three main divisions are always
   highlighted, and the Triplet option subdivides further to give true triplets in 3/4.
   **[C]**
2. **Free / Hertz mode.** The Length menu is replaced by a **Speed** parameter in Hz (a ms
   option is also referenced). Critically: **in Hz mode the LFO is phase-reset to the
   project position once, at transport start** — it is not free-running from an arbitrary
   phase — so replay from a given bar sounds identical each time. **[C]** This is a
   determinism decision, not a musical one, and we must copy it or our renders will not be
   reproducible.
3. **Audio-trigger mode.** The LFO restarts on each detected transient in either the
   through-signal or an external sidechain input. **Three named detection algorithms:
   "Drums", "General", "Complex".** **[C]** The algorithms themselves are **unknown**.
4. **MIDI trigger** (restart on note) and **MIDI switch** (note selects which stored wave
   is active). Both can run **simultaneously**, which is how the product gets fast
   note-repeat behaviour that the rate menu cannot express. **[C]**

An **envelope follower** is available as a modulation source alongside the drawn LFO.
**[C]** Its attack/release ranges are **unknown**.

There is an explicit **"Anti-Click Trigger Smoothing"** option, **on by default**, whose
stated purpose is to remove clicks caused by retriggering the LFO from MIDI. **[C]** This
is direct evidence that the reference product hit exactly the discontinuity problem
described in §4.5 and solved it with a defeatable smoothing stage rather than by
band-limiting. We should reach the same conclusion for the same reason.

### 1.6 Global and per-band controls

- **Smooth**: **0–100%**, smooths point-to-point transitions on the curve, and draws an
  animated smoothed line *on the same display* so the user sees the actual applied
  modulator, not just the drawn one. **[C]** The visual feedback is important: it makes
  smoothing legible instead of mysterious.
- **Mix**: a per-band dry/wet slider at upper right, **plus** a separate **Master Mix** in
  the top bar for the whole instance. **[C]** Two levels of wet/dry is a deliberate design:
  band-level blend for tone, master blend for commit level.
- **Depth**, **phase offset**, **swing**: no source states these exist as named global
  controls. Wave-level vertical rescaling (via shift-click preset load) covers part of what
  a Depth control would do. **Treat depth / phase-offset / swing as absent-or-unknown in
  the reference and as our own additions.** [I]
- **External sidechain input** with a view mode that shows the incoming audio **and** the
  sidechain signal in the central display simultaneously. **[C]**
- Known weakness worth designing around: the product's timing depends on the host's plugin
  delay compensation, and users report ducking landing late in hosts with imperfect PDC,
  and long-session drift. **[R]** Our engine controls its own transport, so we can and must
  do better — see §6 verification item V7.

---

## 2. Our architecture

```
                              ┌──────────────── MODULATION ENGINE (control path) ─────────────────┐
                              │  transport phase φ ──┐                                            │
                              │  free-run Hz ────────┼─► phase source ─► swing warp ─► offset ─┐  │
   sidechain in ──┐           │  transient trigger ──┘                                         │  │
                  ├─► detector┤                                                                ▼  │
   main in ───────┤           │  env follower (atk/rel) ──────────────────────────►  CURVE EVAL    │
                  │           │                                            (piecewise analytic)    │
                  │           │                                                        │           │
                  │           │                              depth ─► scale ─► SMOOTH (2×one-pole) │
                  │           └────────────────────────────────────────────────┬───────────────────┘
                  │                                                            │ m_band[0..2] per sample
                  ▼                                                            ▼
        ┌─────────────────────────────── MODULE SLOT n (of N, series) ───────────────────────────┐
        │                                                                                        │
   in ──┼─► LR4 SPLIT ─┬─► LOW  ─► [allpass comp @ f2] ─► process(m0) ─► ×bandMix0 ─┐            │
        │              ├─► MID  ────────────────────────► process(m1) ─► ×bandMix1 ─┼─► Σ ─► out │
        │              └─► HIGH ────────────────────────► process(m2) ─► ×bandMix2 ─┘            │
        └────────────────────────────────────────────────────────────────────────────────────────┘
                  │
                  ▼   (slots run in series; order user-draggable)
        slot 1 ─► slot 2 ─► … ─► slot N ─► MASTER MIX (dry/wet against instance input) ─► out
```

Notes on the diagram:

- The split is **per module slot**, matching the reference (§1.3). Each slot owns its own
  crossover frequencies and slopes. A slot in 1-band mode bypasses the crossover entirely
  and must be **bit-identical to a straight wire** when its modulation is neutral — see
  verification V1.
- The instance-level dry path for Master Mix is tapped **before slot 1** and must be delayed
  by the total latency of the slot chain, or the mix will comb. See V6.
- The modulation engine runs at **audio rate**, not control rate. Reasons in §4.4.

---

## 3. Control specification

Everything in this section is **our spec** ([I]) unless a reference value is cited. Tapers
are given as the mapping from a normalised UI position `p ∈ [0,1]` to the value.

### 3.1 Instance / global

| Control | Range | Unit | Taper | Default | Interactions |
| --- | --- | --- | --- | --- | --- |
| Master Mix | 0–100 | % | linear | 100 | Dry path needs latency alignment (V6). Reference has this. **[C]** |
| Output trim | −24 … +24 | dB | linear in dB | 0 | Applied post-mix. |
| Sync mode | {Host, Free, Audio-trig, MIDI-trig} | enum | — | Host | Free mode phase-resets on transport start **[C]**. Audio-trig enables §3.4. |
| LFO length | 1/128 … 32 bars **[C]** | note | discrete list | 1 bar | Straight/Triplet/Dotted variant flag is separate. Ignored in Free mode. |
| Length variant | {Straight, Triplet, Dotted} | enum | — | Straight | Drives grid auto-subdivision **[C]**. |
| Free rate | 0.01 … 200 | Hz | log | 1.0 | Above ~20 Hz this becomes audio-rate AM — see §4.5 and V3. |
| Grid | {Off, 1/4 … 1/64, Auto} | enum | — | Auto | Auto switches straight/triplet by length **[C]**. |
| Anti-click smoothing | on/off | — | — | **on** | Reference default is on **[C]**. Off is a QA/measurement mode only. |
| Sidechain source | {Off, Internal, External} | enum | — | Off | External needs a bus input. |

### 3.2 Per module slot

| Control | Range | Unit | Taper | Default | Interactions |
| --- | --- | --- | --- | --- | --- |
| Slot enable | on/off | — | — | on | Bypass must be click-free (crossfade, §4.6). |
| Band count | 1, 2, 3 **[C]** | — | — | 1 **[C]** | 1 band bypasses crossover entirely. |
| Split A (low/mid) | 20 … 20 000 | Hz | log | 200 | Must satisfy A < B − 1/3 octave; clamp, don't swap. |
| Split B (mid/high) | 20 … 20 000 | Hz | log | 2 000 | As above. |
| Slope A, Slope B | {6, 12, 24} **[C]** | dB/oct | enum | 24 | 6 and 12 need band polarity handling — §4.2. |
| Band mix ×3 | 0–100 **[C]** | % | linear | 100 | Per-band dry/wet, distinct from Master Mix **[C]**. |
| Band solo ×3 | on/off | — | — | off | Not confirmed in reference (§1.3) — our addition. |

### 3.3 Per band modulation

| Control | Range | Unit | Taper | Default | Interactions |
| --- | --- | --- | --- | --- | --- |
| Curve | up to 128 breakpoints | — | — | flat at 1.0 | Point cap is ours; reference cap unknown. |
| Depth | 0–100 | % | linear | 100 | `m' = neutral + depth·(m − neutral)`; `neutral` is module-defined (1.0 for gain, 0.0 for pan). |
| Phase offset | −180 … +180 | deg | linear | 0 | Added to φ after swing warp, wrapped. |
| Swing | 0–100 **[I]** | % | linear | 0 | 100% ≡ boundary at 2/3, i.e. triplet feel. §4.3. |
| Smooth | 0–100 **[C]** | % | see below | 0 | Maps to time constant τ, **log**: `τ = 0.05·(4000)^p` ms → 0.05 ms … 200 ms. |
| Invert | on/off | — | — | off | `m ← 2·neutral − m`. |

### 3.4 Trigger / envelope follower

| Control | Range | Unit | Taper | Default | Interactions |
| --- | --- | --- | --- | --- | --- |
| Detect algorithm | {Drums, General, Complex} **[C]** name only | enum | — | Drums | Internals unknown — our implementations are ours. |
| Threshold | −60 … 0 | dBFS | linear in dB | −24 | |
| Retrigger hold | 1 … 500 | ms | log | 40 | Refractory period; prevents double-triggering on one hit. |
| Env attack | 0.1 … 200 | ms | log | 1 | `α = 1 − exp(−1/(fs·τ))`. |
| Env release | 1 … 2000 | ms | log | 100 | |

---

## 4. DSP formulation

### 4.1 Crossover — the Linkwitz-Riley cascade

An LR2*k* crossover is a parallel low-pass/high-pass pair, each built by cascading two
identical Butterworth filters of order *k*. Each branch is therefore **−6 dB at f_c**, so
the two branches sum to **0 dB at f_c**, and the network's summed response is **all-pass:
flat magnitude, smoothly rotating phase**. **[C]**

For LR4 (our default, 24 dB/oct), each branch is two cascaded Butterworth biquads with
**Q = 1/√2**. Using the standard RBJ bilinear forms with
`ω₀ = 2π f_c / f_s`, `α = sin(ω₀)/(2Q)`:

```
lowpass    b0 = (1−cos ω₀)/2   b1 = 1−cos ω₀     b2 = (1−cos ω₀)/2
highpass   b0 = (1+cos ω₀)/2   b1 = −(1+cos ω₀)  b2 = (1+cos ω₀)/2
allpass    b0 = 1−α            b1 = −2 cos ω₀    b2 = 1+α
common     a0 = 1+α            a1 = −2 cos ω₀    a2 = 1−α
```

Normalise all six coefficients by `a0` and run **transposed direct form II** in
double precision for the low crossover (see §4.7 on low-frequency coefficient
conditioning).

**The phase-compensation result, derived here so it is not taken on faith.** In the
analogue prototype, LR4 low-pass is `1/(s²+√2s+1)²` and high-pass is `s⁴/(s²+√2s+1)²`.
Their sum is `(s⁴+1)/(s²+√2s+1)²`, and since `s⁴+1 = (s²+√2s+1)(s²−√2s+1)`, the sum
reduces exactly to

```
    A(s) = (s² − √2·s + 1) / (s² + √2·s + 1)
```

— **a single second-order all-pass section with Q = 1/√2 at f_c**, whose phase sweeps 0°
→ −180° at f_c → −360° above. **[C, derived]**

This settles a conflict in the literature. Loudspeaker sources describe an LR4 crossover as
behaving like a "fourth-order all-pass". **[C]** The transfer function above is
unambiguously **second** order. The reconciliation: those sources name the all-pass by the
*crossover* order and by the fact that its phase rotates a full 360°, which is what a
second-order all-pass does. **For implementation, use the second-order section.** Building a
fourth-order all-pass because a source said "fourth-order" will double the phase rotation
and break the three-band sum.

**Consequence for the three-band split.** With a cascaded split — first L / (M+H) at `f₁`,
then M / H at `f₂` — the low band never passes through the `f₂` network and so does not
receive its phase rotation. Summing then is *not* flat. The fix is to pass the low band
through **the all-pass `A(s)` evaluated at f₂** (one biquad), which is exactly the sum of
the `f₂` crossover. This is drawn in the §2 diagram. **[C, derived]** Cost: one extra biquad
per channel.

For **12 dB/oct** (LR2, two cascaded first-order Butterworth): `LP − HP` is a first-order
all-pass, so **one branch must be polarity-inverted** to sum flat. For **6 dB/oct**
(first-order pair) `LP + HP = 1` exactly and it sums flat with no inversion and no
compensation. The UI must not expose the inversion; the engine applies it. **[C, derived]**

**Linear phase alternative — the honest trade-off.** A linear-phase FIR split has no phase
distortion but adds **latency of exactly half the filter order in samples**, and produces
**pre-ringing that precedes transients and audibly softens them**. **[C]** Minimum-phase
splits have no latency and no pre-ringing but rotate phase around each crossover; the
consensus in the mastering literature is that **phase shift is less objectionable than
pre-ringing in low frequency content**. **[R]** For a 100 Hz crossover, a usefully steep
linear-phase filter needs a long impulse response, and the resulting latency is a
significant fraction of a beat — unacceptable for a device whose entire purpose is
rhythmic placement, and unacceptable for a 256-sample phone buffer.

**Decision: LR4 minimum-phase only. Do not ship a linear-phase mode.** [I] The reference
product uses selectable-slope IIR splits and does not offer linear phase **[C]**, which is
consistent. Record this in the ADR with the pre-ringing and latency reasoning above.

### 4.2 Curve representation and evaluation

Store a curve as an ordered list of breakpoints `(x_i, y_i, type_i, t_i)` with
`x_i ∈ [0,1)` normalised to the LFO period, `y_i ∈ [0,1]`, `type ∈ {line, arc, scurve,
step}` describing the segment **from point i to point i+1**, and tension `t_i ∈ [−1, +1]`.
The curve wraps: the last point's segment runs to the first point at `x = 1`.

For a segment from `(x₀,y₀)` to `(x₁,y₁)`, let `u = (x − x₀)/(x₁ − x₀) ∈ [0,1]`, and let
`p = 2^(3t)` so `t ∈ [−1,1]` gives `p ∈ [1/8, 8]`. **[I]** — the reference's tension
parameterisation is unknown (§1.4), this is ours and is chosen so that `t` and `−t` are
mirror-symmetric about the diagonal, which is what makes a tension slider feel linear.

```
  line    f(u) = u
  arc     f(u) = u^p
  scurve  f(u) = 0.5·(2u)^p                      for u < 0.5
          f(u) = 1 − 0.5·(2(1−u))^p              for u ≥ 0.5
  step    f(u) = 0                               (hold y₀ until x₁)
```

and `y(u) = y₀ + (y₁ − y₀)·f(u)`.

**Sampling rule — the important one.** Do **not** rasterise the curve into a wavetable and
interpolate. Evaluate the piecewise analytic function **per sample**, holding a cursor to
the current segment index and advancing it when the phase crosses `x_{i+1}`. Reasons:

1. A table forces a resolution choice; any choice steps. Per-sample analytic evaluation has
   no resolution at all — it is exact to float precision at every sample.
2. It is *cheaper*, not dearer: a segment evaluation is one `pow` at worst (replaceable by
   a fast exp2/log2 pair, or by two multiplies when `p` snaps to 1, 2 or 0.5), versus a
   table read plus interpolation plus the memory traffic of a table per band per slot.
3. Segment transitions are detected exactly, which is what §4.6's discontinuity handling
   needs in order to know a discontinuity happened.

The residual stepping problem is therefore **not** table resolution — it is that the curve
itself is legitimately discontinuous at `step` breakpoints and at the loop wrap. That is
handled in §4.5/§4.6, not here.

### 4.3 Phase, swing, offset

Per sample, the phase source produces `φ ∈ [0,1)`:

- **Host mode**: `φ = frac(ppq / L)` where `ppq` is the transport position in quarter notes
  and `L` is the LFO length in quarter notes. Deriving φ from absolute transport position
  rather than by accumulating an increment is what makes locate/loop/seek sample-accurate
  and prevents the long-session drift reported against the reference. **[R]** on the drift
  report, **[I]** on the fix.
- **Free mode**: accumulate `φ += rate/f_s`, but **reset φ to the value implied by
  transport position at transport start**, matching the reference's determinism rule
  **[C]**.
- **Trigger modes**: `φ` resets to 0 on trigger and runs forward at the length rate,
  clamping at 1 (one-shot) or wrapping (loop) per a mode flag.

**Swing** warps φ within pairs of subdivisions. Let `n` be the number of swing units per
LFO period (default: swing unit = 1/16 note). Let `q = frac(φ·n/2)` be position within a
*pair*, and let the boundary be `b = 0.5 + s·(2/3 − 0.5) = 0.5 + s/6` for swing amount
`s ∈ [0,1]`, so `s = 1` puts the boundary at 2/3 — exact triplet feel.

```
    q' = 0.5·q/b                          if q < b
    q' = 0.5 + 0.5·(q − b)/(1 − b)        if q ≥ b
```

then reassemble `φ' = (floor(φ·n/2) + q')·2/n`. This is continuous and monotonic, so it
introduces no discontinuity of its own; its derivative is piecewise constant, which means
swing changes the *rate* of the modulator in each half of a pair, and that is musically
correct.

**Offset** is applied last: `φ'' = frac(φ' + offset/360)`.

### 4.4 Why the modulator runs at audio rate

Running the modulator once per block and linearly ramping across the block is the common
shortcut. It is wrong here for two specific reasons:

1. The device explicitly supports **audio-rate modulation** — the reference offers free-run
   rates in Hz and audio-rate stutter/AM behaviour. A block-rate modulator at a 256-sample
   buffer has a 187 Hz Nyquist; every modulation frequency above ~90 Hz aliases.
2. Even at low rates, a per-block ramp turns a drawn *curve* into a piecewise-linear
   approximation with 256-sample segments. The corner frequency of the resulting error is
   in the audible band and it is exactly the "stepping" the brief asks us to avoid.

Cost is negligible (§7), so there is no reason to take the shortcut.

### 4.5 Click-free gain modulation

A discontinuity in a gain multiplier produces a step in the output whose spectrum falls at
6 dB/octave from DC — broadband, and audible as a click regardless of what the program
material is. Two mitigations exist and they are **not** interchangeable:

- **Band-limiting the modulator** (polyBLEP / BLEP correction, the standard technique for
  band-limiting waveform discontinuities). **[C]** This makes the *modulator* alias-free,
  which matters when the modulator is at audio rate and its harmonics fold. It does **not**
  make the gain change inaudible, because a band-limited step is still a step in energy.
- **Smoothing the modulator** with a lowpass. This removes the click by limiting the rate
  of gain change, at the cost of softening the drawn shape.

Both are needed, for different jobs:

**Smoothing filter.** Use **two cascaded one-poles** (critically damped), not one. A single
one-pole leaves a sharp corner at the onset of smoothing that is itself audible on fast
shapes, and it has a 6 dB/oct skirt that lets the discontinuity's high harmonics through.
Per pole:

```
    a = 1 − exp(−1 / (τ · f_s))
    y[n] = y[n−1] + a · (x[n] − y[n−1])
```

with `τ` from the Smooth control's log taper (§3.3): 0.05 ms … 200 ms. **A floor of
τ = 0.05 ms (about 2.4 samples at 48 kHz) is applied even at Smooth = 0** — this is our
equivalent of the reference's always-on "Anti-Click Trigger Smoothing" **[C]**, and it is
the reason Smooth = 0 does not click. QA measures this as V3.

**BLEP correction** is applied to `step`-type breakpoints and to the loop wrap when the
modulator rate exceeds ~2 Hz, using a 2-sample polyBLEP residual added at the fractional
crossing position. Below that rate the smoothing filter dominates and the correction is
inaudible; gating it saves the branch. **[I]**

**Trigger retrigger** is the worst case: an audio-rate transient trigger can reset φ at any
sample, discontinuously. The reference solves this with a defeatable smoothing option
**[C]**. We solve it the same way plus one addition: on retrigger, **do not reset the
smoothing filter state** — let it glide from wherever it was to the new curve value. That
converts a step into a τ-limited ramp for free.

### 4.6 Bypass, band-count and parameter changes

Any topology change (slot enable/disable, band count change, crossover slope change) must
be a **4 ms equal-power crossfade between the old and new signal paths**, both running for
the crossfade duration. Switching filter coefficients in place while the filter has state is
the standard source of a pop and is not acceptable at any setting. Crossover *frequency*
changes are the exception: recomputing biquad coefficients per block for a moving `f_c` is
fine and does not need a crossfade, because the state remains meaningful.

### 4.7 Numerical notes

- At `f_c = 20 Hz` and `f_s = 48 kHz`, `ω₀ ≈ 0.0026 rad`. Direct-form biquad coefficients
  become ill-conditioned in float32: `a1 ≈ −1.99999`, and the pole pair sits within
  0.0013 of the unit circle. **Run the low crossover in float64**, or use a state-variable
  / TPT topology whose coefficients stay well-scaled. TPT is preferred because it also
  behaves correctly under per-block `f_c` modulation.
- Denormals in the crossover state after silence will cost a large multiple of normal CPU
  on some ARM configurations. Enable flush-to-zero, and additionally add a −180 dBFS
  dither/noise floor into the filter states, or explicitly zero states after 100 ms of
  detected digital silence.

---

## 5. Character artefacts worth modelling

These are the ones that make the effect sound like a musical device rather than a
multiplier. Each is a deliberate, defeatable addition.

1. **Crossover phase smear as a feature.** The LR4 all-pass sum (§4.1) is a real, audible
   colour on drums even at neutral settings — a slight softening of transients. Do not
   "fix" it. Do make 1-band mode bypass the crossover entirely so that neutral really is
   neutral (V1).
2. **Ducking overshoot.** Curves drawn with a fast rise and a Smooth setting above ~20 ms
   overshoot slightly on the release because a two-pole smoother rings marginally. This is
   the sound people associate with a good sidechain pump. Keep it; do not critically
   over-damp.
3. **Haas panning artefacts.** If we implement delay-based panning (reference does **[R]**),
   the mono-sum comb filtering is the artefact and it is the point of the mode. It must be
   clearly labelled in the UI as mono-incompatible.
4. **Time-module playhead crossfade.** Any playhead jump needs a short crossfade (2–5 ms)
   or it clicks; the crossfade length is itself a character control — short is glitchy and
   digital, long is smeared and tape-like.
5. **Filter self-oscillation.** The reference explicitly ships a resonance cap with a
   defeat switch **[R]**. Copy the pattern: safe by default, unsafe available, and the
   unsafe mode must still be protected by an output limiter so a user cannot damage
   monitoring.

---

## 6. Verification — measurements QA must run

Every one of these is a pass/fail gate with a numeric target. "Sounds fine" is not a result.

| ID | Measurement | Method | Target | Tolerance |
| --- | --- | --- | --- | --- |
| V1 | **Neutral null.** 1 slot, 1 band, Depth 0, Mix 100%, curve flat at neutral. | Null against dry input, pink noise + a drum loop, 60 s. | **Exact null**, ≤ −140 dBFS peak residual (float32 rounding only). | Any residual above −140 dBFS is a bug, not a tolerance. |
| V2 | **Crossover sum flatness.** 3 bands, all modulation neutral, slope 24. | Log sweep 10 Hz–22 kHz, measure magnitude of output/input. | **±0.05 dB, 20 Hz–20 kHz.** | Failure here means the §4.1 all-pass compensation is missing or wrong. Also run at slopes 6 and 12 — these test the polarity handling. |
| V3 | **Click detection at extreme rates.** Square-ish curve (two `step` breakpoints), Smooth = 0, on a 1 kHz sine. Sweep LFO rate 0.1 Hz → 200 Hz. | Per-sample first difference of output; flag any sample where `\|Δy\|` exceeds the maximum `\|Δy\|` of the un-modulated 1 kHz sine by more than 12 dB. | **Zero flagged samples across the whole sweep.** | Zero. This is the anti-click floor (§4.5) doing its job; one flag means the τ floor is not applied on that path. |
| V4 | **Retrigger click.** Audio-trigger mode, trigger on every sample of a click train at 40 Hz, worst-case curve. | As V3. | **Zero flagged samples.** | Zero. |
| V5 | **Modulator alias floor.** Free mode, 90 Hz, `step` curve, on a 1 kHz sine. | FFT the output; identify sidebands not at `1000 ± k·90` Hz. | Spurious (aliased) content **≤ −80 dBFS**. | +3 dB. Tests the BLEP path. |
| V6 | **Master Mix comb test.** Mix 50%, all slots neutral. | Sweep; compare to Mix 100%. | **±0.05 dB** — identical, no comb. | Failure means the dry path is not latency-aligned. |
| V7 | **Timing accuracy and drift.** 1/16 gate curve, 128 bars at 174 BPM, then seek to bar 100 and play. | Cross-correlate gate onsets against expected sample positions. | **0 samples error** at every onset, including after the seek. | 0. Phase must come from transport position (§4.3), not accumulation. |
| V8 | **Swing correctness.** Swing 100%, 1/16 unit. | Measure onset positions of a gate curve. | Boundary at exactly **2/3** of each pair, i.e. onsets at 0 and 2/3 of each 1/8. | ±1 sample. |
| V9 | **Topology-change pop.** Toggle slot bypass, band count 1↔3, and slope 6↔24, 200 times each over programme material. | V3's difference detector. | **Zero flagged samples.** | Zero. Tests §4.6. |
| V10 | **Denormal stall.** Feed 30 s of programme then 30 s of digital silence, 3 bands, 8 slots. | Measure per-block processing time during the silence. | Silence-period block time **≤ 1.2×** the programme-period block time. | Above that, FTZ is not set or state is not being flushed. |
| V11 | **Smooth taper monotonicity.** Sweep Smooth 0→100 in 100 steps. | Measure −3 dB corner of the modulator path each step. | Monotonically decreasing, **0.05 ms … 200 ms**, no discontinuity > 15% between adjacent steps. | 15%. |

---

## 7. CPU and memory cost model

Budget: **12 instances, phone, 256-sample buffer, 48 kHz.** 256 samples = **5.33 ms** of
wall clock per block for *everything* — all 12 instances plus the rest of the engine. A
defensible allocation is **30% of one core for all 12 instances**, i.e. **~2.5% of a core
per instance**, i.e. roughly **133 µs per block per instance** on a core that has 5.33 ms.

### 7.1 Per-sample arithmetic, one instance, stereo, 3 bands, one Volume slot

| Item | Count | Flops each | Flops/sample |
| --- | --- | --- | --- |
| LR4 split, low/mid at f₁ (LP×2 + HP×2 biquads) | 4 biquads × 2 ch | 9 | 72 |
| LR4 split, mid/high at f₂ | 4 biquads × 2 ch | 9 | 72 |
| All-pass compensation on low band @ f₂ | 1 biquad × 2 ch | 9 | 18 |
| Modulator: phase, swing warp, segment eval, depth | 3 bands | ~25 | 75 |
| Modulator: 2× one-pole smoothing | 3 bands × 2 poles | 3 | 18 |
| Gain apply | 3 bands × 2 ch | 1 | 6 |
| Band mix + recombine | 3 bands × 2 ch | 3 | 18 |
| **Total** | | | **≈ 280 flops/sample** |

At 48 kHz: **13.4 Mflop/s per instance**; **161 Mflop/s for 12 instances**. A current
mid-range phone core sustains on the order of 2–8 Gflop/s scalar and several times that
with NEON, so the arithmetic is **~2–8% of one core for all twelve** — comfortably inside
budget. **Arithmetic is not the constraint. Memory is.**

Add per additional slot in the chain: another 162 flops/sample of crossover plus the
module's own cost. Eight slots of Volume ≈ 2 000 flops/sample ≈ 96 Mflop/s per instance,
which at 12 instances is **1.15 Gflop/s** — that is now a real number and the reason §7.4
recommends a hard slot cap on mobile.

### 7.2 Per-module incremental costs (per sample, stereo, 3 bands)

| Module | Extra flops/sample | Notes |
| --- | --- | --- |
| Volume | 6 | Trivial. |
| Pan (amplitude) | ~18 | Two gains + pan law. |
| Pan (Haas) | ~30 + 2 delay lines | Delay lines are memory, not flops. |
| Width (M/S) | ~30 | Encode, scale, decode per band. |
| Drive | 60–400 | Depends entirely on oversampling — see below. |
| Crush | ~40 | Cheap, but **aliases by design**; do not oversample it. |
| Filter (2 ZDF SVF per band) | ~200 | ZDF/TPT SVF ≈ 15 flops/sample/channel/filter. |
| Liquid (phaser, 6 allpass) | ~220 | 6 × biquad × 2 ch × 3 bands, plus LFO. |
| Time | ~120 + heavy memory | Interpolated read + crossfade. See §7.3. |
| Pitch | **500–2000** | Granular or phase-vocoder per band. The expensive one. |
| Reverb | 300–800 | Depends on architecture; see FX-02. |

**Drive and oversampling.** Anti-aliasing a saturator needs 4× oversampling to push
harmonic images above audibility, and a polyphase FIR up/downsampler at 4× costs roughly
2 × 32 taps × 4 = ~256 flops/sample/channel. That is **more than the entire rest of the
instance**. Recommendation: **2× oversampling on mobile, 4× on desktop**, exposed as a
quality setting, not a per-preset parameter. [I]

### 7.3 Memory

Delay-line and buffer memory is the binding constraint, and the Time module is the problem.

A playhead-modulation module needs a recorded history at least as long as the maximum
backwards playhead excursion. If we honour the reference's **32-bar** maximum LFO length
**[C]** at a slow tempo, the requirement is absurd: 32 bars of 4/4 at 60 BPM is 128 s;
stereo float32 at 48 kHz is **49 MB per band**, **147 MB for three bands**, **1.76 GB for
twelve instances**. That does not fit on a phone and would not fit on most desktops either.

Three mitigations, in order of importance:

1. **Record the full-band signal once per slot, not once per band.** Read three
   independent playheads from the one buffer and apply the band filter *after* the read —
   the low tap only needs the LP branch, the mid tap only the BP, the high tap only the HP,
   so this costs ~13 biquads/channel instead of 9 but divides buffer memory by **3**.
2. **Cap the history buffer independently of the LFO length menu.** Spec: history =
   `clamp(4 bars at current tempo, 2 s, 12 s)`. At 12 s stereo float32 that is
   **4.6 MB per slot**; twelve instances with one Time slot each is **55 MB**, which is
   affordable. Playhead excursions beyond the buffer clamp to its oldest sample rather than
   reading garbage, and the UI must grey out the unreachable region of the curve so the
   limit is visible rather than mysterious.
3. **Store history as float32, never float64**, and allocate lazily — a Time slot that has
   never been enabled allocates nothing.

Other memory, per instance: filter states and curve data are negligible (a 128-point curve
is ~2 KB; all filter state under 4 KB). A Pitch module's grain buffers are covered in
FX-02/FX-03; budget **256 KB per band** as a placeholder. [I]

### 7.4 Mobile recommendations

- **Hard cap of 4 module slots per instance on mobile**, 8 on desktop. [I]
- **One Time slot and one Pitch slot per instance maximum** on mobile. [I]
- Oversampling 2× on mobile (§7.2).
- Allocate all buffers on load or on first enable, never on the audio thread.
- The 3-band split should be **skipped entirely, not run with neutral settings**, when band
  count is 1 — this is both the V1 correctness requirement and a 162 flop/sample saving.

---

## 8. Sources

Product behaviour (all reached via search extraction; direct fetch blocked, see §0):

- [Cableguys — ShaperBox 3 product page](https://www.cableguys.com/shaperbox)
- [Cableguys — ShaperBox 3 support page](https://www.cableguys.com/support/shaperbox)
- [Cableguys ShaperBox 3 Manual v3.6.x (PDF)](https://downloads.cableguys.com/Cableguys-ShaperBox-3-Manual.pdf) — module list, band splitting, slopes, pens, snap, wave presets, custom slots, LFO lengths, Hz-mode reset behaviour, Smooth range, Mix
- [Cableguys — support: audio, automation, MIDI and timing](https://www.cableguys.com/support/audio-automation-midi-and-timing) — Anti-Click Trigger Smoothing, MIDI trigger/switch
- [Sound On Sound — Cableguys ShaperBox 3 review](https://www.soundonsound.com/reviews/cableguys-shaperbox-3)
- [Sound On Sound — Cableguys release ReverbShaper](https://www.soundonsound.com/news/cableguys-release-reverbshaper) — Size, Decay, Pre-Delay, Width
- [Sound On Sound — Cableguys introduce PitchShaper](https://www.soundonsound.com/news/cableguys-introduce-pitchshaper) — multiband pitch shift with formant control
- [MusicTech — ShaperBox 3 review](https://musictech.com/reviews/plug-ins/cableguys-shaperbox-3-review/)
- [MusicRadar — ShaperBox 3 review](https://www.musicradar.com/reviews/cableguys-shaperbox-3)
- [MusicRadar — stutter and glitch with TimeShaper 3](https://www.musicradar.com/how-to/stutter-glitch-timeshaper-3)
- [Cableguys — TimeShaper](https://www.cableguys.com/timeshaper) — playhead-position model, sample accuracy
- [Cableguys — FilterShaper Core](https://www.cableguys.com/filtershaper-core) — ZDF filters, Safe Res
- [KVR — ShaperBox latency issues in some DAWs](https://www.kvraudio.com/forum/viewtopic.php?t=624445) — host PDC dependence [R]
- [Dogs On Acid — sidechainers drifting over a project](https://www.dogsonacid.com/threads/shaperbox-and-other-sidechainers-drifting-out-over-the-course-of-a-project.830998/) — drift report [R]
- [Gearspace — ShaperBox 3 announcement thread](https://gearspace.com/board/new-product-alert-2-older-threads/1391554-shaperbox-3-audio-triggered-sidechain-gate-lfo-creative-fx.html) — Drums/General/Complex trigger algorithms

DSP:

- [Rane — Linkwitz-Riley Crossovers: A Primer](https://www.ranecommercial.com/legacy/note160.html) — LR4 in-phase outputs, −6 dB at crossover, 24 dB/oct
- [Wikipedia — Linkwitz–Riley filter](https://en.wikipedia.org/wiki/Linkwitz%E2%80%93Riley_filter) — all-pass summed response, phase rotation
- [musicdsp.org — 4th order Linkwitz-Riley filters](https://www.musicdsp.org/en/latest/Filters/266-4th-order-linkwitz-riley-filters.html) — implementation form
- [Cross-Time DSP — Phase Linearization](https://github.com/twest820/Cross-Time-DSP/wiki/Phase-Linearization) — allpass biquad cancelling LR4 phase error
- [Linear phase mixed FIR/IIR crossover networks (ResearchGate)](https://www.researchgate.net/publication/228326295_Linear_phase_mixed_FIRIIR_crossover_networks_Design_and_real-time_implementation) — FIR latency = half the filter order
- [Gearspace — bandsplitting for mastering: minimum or linear phase](https://gearspace.com/board/mastering-forum/1378687-bandsplitting-mastering-purposes-minimum-phase-linear-phase.html) — pre-ringing vs phase shift trade-off [R]
- [FabFilter Pro-MB — processing mode](https://www.fabfilter.com/help/pro-mb/using/processingmode) — dynamic-phase alternative
- [EarLevel Engineering — A one-pole filter](https://www.earlevel.com/main/2012/12/15/a-one-pole-filter/) — smoothing coefficient form
- [KVR — smoothing parameters thread](https://www.kvraudio.com/forum/viewtopic.php?t=212438) — 1–5 ms smoothing time constants for audio-rate modulation
- [KVR — BLEP / minBLEP / polyBLEP / bandlimited ramps](https://www.kvraudio.com/forum/viewtopic.php?t=248390) — discontinuity correction
- [flyingSand — PolyBLEP](https://christianfloisand.wordpress.com/tag/polyblep/) — wavetable aliasing and band-limited alternatives

---

## 9. What I could not confirm

Do not build to any of these without a further pass.

1. **Maximum breakpoint count** in the reference's curve editor. Our 128 is arbitrary.
2. **The curve tension parameterisation** — whether arc/S curvature is a numeric parameter
   or purely a drag gesture, and its range. §4.2's `p = 2^(3t)` is ours.
3. **Whether Depth, phase offset and swing exist as named controls** in the reference. I
   found no evidence for any of the three. They are specified here as our additions.
4. **The three transient-detection algorithms.** Names confirmed, internals unknown.
5. **Envelope-follower attack/release ranges.**
6. **Per-band solo and per-band bypass** in the reference.
7. **Exact crossover frequency range and defaults.**
8. **Crush module's bit-depth and sample-rate reduction ranges.**
9. **Whether the module count is nine or eleven** — see §1.1; I have given a reconciliation
   but it is inference, not a confirmed statement.
10. **Reference CPU and latency figures.** No source gives measured numbers. Every figure in
    §7 is derived from operation counts in this document, not measured against anything, and
    must be re-derived from a real profile once a prototype exists.
11. **Whether a "send" module exists.** I am confident it does not (§1.1) but I am proving a
    negative from secondary sources.
