# Reference spec — FX-02 Granular Reverb

Status: **research complete, ready to implement against**. Author: Research Analyst.
Class of device: reverberator built from a granular cloud fed back into its own source
buffer, with pitch-shifted grain sets (shimmer), freeze, damping and spectral tilt.

Unlike FX-01, this device has **no single reference product**. It is an academic subject.
The sources here are the granular-synthesis literature (Roads, Truax, Bencina, Brandtsegg)
and the artificial-reverberation literature (Schroeder, Moorer, Jot & Chaigne, Dattorro).
That is a better position to be in: the algorithm is public, well-described and free to
implement.

## 0. How to read this document

Confidence markers as in FX-01: **[C]** confirmed (paper, textbook, or derived here from
cited first principles), **[R]** reported by a secondary source, **[U]** unconfirmed,
**[I]** our own inference or design decision.

**Sourcing constraint.** Direct fetch is blocked by the egress proxy for essentially every
domain in this environment; all sources below were reached through search-engine extraction
of the paper text. Where a source is a PDF I have named it precisely enough that a DSP
engineer with unblocked access can pull the original before implementing — and for the
window equations and the T60 relation they **should**, because those are the parts where a
transcription error is silent and fatal.

**IP note.** Product names appearing in §4 are named as prior art in a public literature
survey. They must not appear in shipped UI, code identifiers, filenames or marketing copy.
Everything specified in §5–§7 is derived from published academic work, not from any
product's behaviour.

---

## 1. Granular synthesis fundamentals

### 1.1 Grain duration and what it does perceptually

The numbers below are the ones worth building the control ranges around, because they are
perceptual boundaries, not conventions.

- **Typical grain durations are 1–100 ms**; the granular literature most often quotes
  **3–100 ms** as the working range. **[C]**
- **~50 ms is the threshold of the microsound domain.** Below it, successive events **fuse**
  into a single percept; above it, they **separate into distinct rhythmic elements**.
  **[C]** This is the single most important number in the document: it is the boundary
  between "reverb" and "delay". A granular reverb lives below it; a granular delay (FX-03)
  lives across it.
- **A 4 ms interruption in pink noise is not perceptible; a 20 ms interruption is.** **[C]**
  This bounds how much gap a sparse cloud can contain before it stops sounding continuous,
  and it is directly testable (V4).
- Roads' own illustration of density: **a one-second cloud of twenty 100 ms grains is
  continuous and opaque; a one-second cloud of twenty 1 ms grains is sparse and
  transparent.** **[C]** In the terms of §1.3 those are overlap factors of 2.0 and 0.02.
- As particle density rises the percept moves through **point → pulse → line (tone) →
  surface (texture)**. **[C]**

Below roughly **10–15 ms** the grain envelope itself becomes spectrally significant and
introduces audible artefacts. **[C]** That sets the practical floor for a _reverb_ grain:
we should not default below 15 ms, and the UI should indicate when the user has entered the
region where the window is colouring the sound rather than merely gating it.

### 1.2 Grain envelope (window) — the equations

The grain envelope is a time-domain window, so applying it convolves the grain's spectrum
with the window's spectrum. **[C]** Window choice is therefore a tone decision, not a
cosmetic one.

The documented ranking, which is the reason we do not simply use a trapezoid:
**trapezoidal envelopes introduce the greatest spectral distortion, because of second-order
discontinuities at each envelope state transition; raised-cosine-bell envelopes produce
markedly less.** Gaussian envelopes are the classical choice; trapezoidal envelopes were
favoured by Truax and others for efficiency. **[C]**

Let `N` be the grain length in samples, `n = 0 … N−1`, and `x = n/(N−1) ∈ [0,1]`.

**Hann (raised cosine bell)** — our default:

```
    w(x) = 0.5 · (1 − cos(2πx))
```

**Tukey (cosine-tapered)** — our shape control, `α ∈ [0,1]`:

```
    w(x) = 0.5 · (1 + cos(π·(2x/α − 1)))          for 0 ≤ x < α/2
    w(x) = 1                                       for α/2 ≤ x ≤ 1 − α/2
    w(x) = 0.5 · (1 + cos(π·(2x/α − 2/α + 1)))     for 1 − α/2 < x ≤ 1
```

`α = 1` is exactly Hann; `α = 0` is rectangular (and will click). A Tukey with `α` around
0.2–0.4 is the right window for **long** grains, where you want the grain to carry the
source's body rather than a bell-shaped amplitude swell, and Hann is right for **short**
grains, where you want the smoothest possible spectrum. Bind `α` to grain length by
default, expose it as an override. [I]

**Gaussian** — for the smoothest possible spectrum, truncated:

```
    w(n) = exp( −½ · ( (n − M) / (σ·M) )² ),     M = (N−1)/2
```

With **σ = 0.3** the endpoint value is `exp(−½·(1/0.3)²) = 0.00387`, i.e. **−48.2 dB** —
inaudible truncation. With σ = 0.5 the endpoint is 0.135, i.e. **−17.4 dB**, which clicks
audibly. **Do not expose σ; fix it at 0.3.** [C, computed] Gaussian's cost is that it never
reaches 1.0 in the middle, so it needs ~1.9× the amplitude of Hann for the same loudness —
handle that in the normalisation of §1.3, not by scaling the window.

**Implementation.** Precompute one window per shape at 4096 points, read with linear
interpolation and a per-grain phase increment of `4096/N`. Cost is 4 flops/sample/grain,
against roughly 25 for evaluating a cosine. Do **not** compute the window with a
recursive resonator — it drifts over long grains and the drift lands exactly on the grain
tail, which is where a discontinuity clicks. [I]

### 1.3 Density, overlap and the amplitude normalisation

Let `R` = grain rate in grains per second, `L` = grain length in seconds.

```
    Overlap factor   O = R · L        (= expected number of grains sounding at once)
```

`O < 1` is a sparse, gappy cloud; `O ≈ 1` is on the edge; `O > 4` is continuous;
`O > 20` is dense and smooth. **Typical densities in the literature run from several
hundred to several thousand grains per second.** **[C]** At `L = 50 ms` that is
`O = 15` to `O = 150`.

**Loudness must not change when density changes.** The correct normalisation depends on
whether the grains are correlated:

- **Incoherent grains** (asynchronous scheduling, randomised read positions — our case):
  powers add. Expected output power gain is `O · mean(w²)`, so the per-grain amplitude must
  be

  ```
      A = 1 / sqrt( O · mean(w²) )
  ```

- **Coherent grains** (synchronous scheduling, identical read position): amplitudes add,
  and the normalisation is `A = 1 / (O · mean(w))`.

Window constants, computed exactly:

| Window         | `mean(w)` | `mean(w²)`        |
| -------------- | --------- | ----------------- |
| Hann           | 0.5       | **0.375** (= 3/8) |
| Tukey(α)       | `1 − α/2` | `1 − 5α/8`        |
| Gaussian σ=0.3 | ≈ 0.376   | ≈ 0.266           |
| Rectangular    | 1         | 1                 |

**[C, computed]** — these fall straight out of integrating the window definitions above; the
Tukey values reduce to the Hann values at α = 1, which is the arithmetic check.

Getting this wrong is the most common failure in granular code: the device gets louder as
you turn density up, the user compensates with the output trim, and then the feedback loop
(§2.1) changes its effective gain with density and the reverb runs away. **The
normalisation must be inside the feedback loop.** See V6.

**Hann has a useful special property**: at a hop of exactly `N/2` (i.e. `O = 2`),
overlap-added Hann windows sum to exactly 1.0 — constant-overlap-add. That gives us an
exactly-verifiable test case (V2) even though the running device is asynchronous and does
not satisfy COLA.

### 1.4 Scheduling: synchronous, quasi-synchronous, asynchronous

Roads classifies grain organisation into Fourier/wavelet grids, **pitch-synchronous
overlapping streams**, **quasi-synchronous streams**, and **asynchronous clouds**. **[C]**
Bencina's architecture paper covers both pitch-synchronous and asynchronous forms and
reviews **two methods for generating stochastic grain onset times**, and makes the
structural point that granular synthesis "straddles the boundary between algorithmic event
scheduling and polyphonic event synthesis" — i.e. the scheduler and the voice pool are the
architecture, not an implementation detail. **[C]**

- **Synchronous / pitch-synchronous**: constant hop `H = 1/f₀`. The grain rate itself
  becomes an audible pitch. Wrong for reverb — it produces a comb-like, buzzing tail.
- **Quasi-synchronous**: constant hop with bounded random deviation. Interval between grains
  in a stream is _essentially_ equal. **[C]** Useful for the tighter end of our Diffusion
  control.
- **Asynchronous**: onsets drawn from a stochastic process. This is what a reverb wants,
  because it produces no periodicity for the ear to lock onto.

**Our scheduler** [I]: a Poisson-ish process implemented as a running fractional counter.

```
    nextOnsetDelta = (fs / R) · (1 + ξ · jitterAmount)     ξ ~ U(−1, +1)
```

accumulated in a **double-precision fractional sample counter**. When the counter passes an
integer boundary, a grain is spawned with its **fractional onset offset preserved** and
applied as an initial fractional read offset. `jitterAmount = 0` gives quasi-synchronous,
`jitterAmount = 1` gives asynchronous.

**The scheduling failure to design against, and it is a real one:** if grain onsets are
quantised to block boundaries, a 256-sample block at 48 kHz imposes a **187.5 Hz**
periodicity on the cloud, which is plainly audible as a buzz and is independent of every
user control. Onsets must be sample-accurate with fractional offset. This is verification
item **V3** and it is the most likely bug in a first implementation.

### 1.5 Spray and jitter — the randomisable dimensions

The literature names these as separate axes and they should be separate controls: **input
(position) jitter** on the read pointer, **output jitter** on the regularity of grain
production, **amplitude jitter**, **grain-length jitter**, and **per-grain stereo pan
placement** — with pan spread often specified so grains land randomly across a width, up to
hard-left/hard-right. **[C]**

For a reverb the useful defaults are: heavy position spray (it _is_ the diffusion), moderate
onset jitter, mild amplitude jitter, mild length jitter, wide pan spread.

---

## 2. Turning a grain cloud into a reverberator

### 2.1 The feedback topology

The mechanism documented in the granular-reverb literature is direct: **the granular
synthesis output is fed back into the source table together with the audio input**, creating
a regenerative loop inside the buffer. **[C]** Ervik & Brandtsegg's Csound implementation
is the concrete reference — **8 buffers recording 0.5 s each, playback time-stretched by a
factor of 8 so each lasts 4 s, with slow attack/release envelopes so instances overlap**.
**[C]** That is a granular reverb whose entire decay mechanism is time-stretch plus overlap.

Our topology takes the feedback-into-buffer form rather than the multi-buffer form, because
a single circular buffer with randomised read offsets gives the same statistical result with
one buffer instead of eight, and because freeze (§2.4) is trivial in that form.

```
                     ┌──────────────────── FEEDBACK PATH ────────────────────┐
                     │                                                        │
  in ──► pre-delay ──┴──► (+) ──► CIRCULAR BUFFER ══════════════════════╗     │
                            ▲      (write head W)                       ║     │
                            │                                           ║     │
                            │      grain reads at W − τᵢ, τᵢ random     ║     │
                            │      within [minOffset, minOffset+size]   ║     │
                            │                                    ┌──────╨──┐  │
                            │                                    │ GRAIN   │  │
                            │                                    │ POOL    │  │
                            │                                    │ (pitch, │  │
                            │                                    │  window,│  │
                            │                                    │  pan)   │  │
                            │                                    └────┬────┘  │
                            │                                         │       │
                            │                                    Σ grains     │
                            │                                         │       │
                            │   ┌──── DIFFUSION: 4 × Schroeder allpass ┤       │
                            │   │     (mutually prime, 5–50 ms)        │       │
                            │   ▼                                      ▼       │
                            │  wet ──────────────────────────────► MIX ──► out │
                            │                                          │       │
                            └── ×fb ◄── limiter ◄── tilt ◄── damp ◄── DC ──────┘
                                                    LPF     block
```

### 2.2 Decay control and the RT60 relation

For a delay line of length `t` seconds in a feedback loop of gain `g`, the standard
reverberation relation is

```
    g = 10^( −3·t / RT60 )          equivalently     RT60 = −3·t / log₁₀(g)
```

**[C]** — this is the canonical comb/FDN attenuation design (`g_comb = 10^(−3·t_comb/RT60)`)
and it is the formula our decay control must invert.

A granular loop does not have one delay time; it has a **distribution** of recirculation
times, because each grain reads from a random offset `τᵢ`. Let `τ̄` be the mean read offset.
Then to first order

```
    fb = 10^( −3·τ̄ / RT60 )
```

**[I, derived by analogy]** — mark this as inference. It is correct in the mean, and the
spread of `τᵢ` is precisely what makes a granular tail smoother than a comb's (the decay is
a superposition of exponentials with the same mean rate but different periods, which fills
in the echo pattern). It is _not_ exact, and §6/V5 requires that the shipped Decay control
be **calibrated against measured RT60**, not trusted from the formula. Build a lookup
correction table from the measurement if the error exceeds the V5 tolerance.

**The three stability hazards, all mandatory to handle:**

1. **Density-dependent loop gain.** If the §1.3 normalisation is not applied inside the
   loop, turning Density up multiplies the loop gain and the reverb runs away. Apply `A`
   before the feedback tap.
2. **DC accumulation.** Grain windows have non-zero mean, so any DC in the source
   accumulates monotonically around the loop. A **first-order high-pass at 20 Hz in the
   feedback path is not optional.**
3. **Unbounded transients.** Even with `fb < 1` the instantaneous sum of many grains can
   exceed headroom. Put a **soft limiter (tanh-style, threshold −3 dBFS, 5 ms release) in
   the feedback path**, after the tilt filter. It must be in the loop, not on the output,
   or it cannot arrest regeneration.

Additionally, cap `fb` at **0.98** internally except in Freeze, which does not use `fb` at
all (§2.4).

### 2.3 Diffusion

Two independent mechanisms produce diffusion and we want both, because they act on
different timescales:

- **Grain spray** (randomised read offsets, §1.5) diffuses on the scale of the _size_
  window — tens to hundreds of milliseconds. It builds the tail's statistical smoothness.
- **An allpass chain** diffuses on the scale of _milliseconds_ — it builds echo density
  immediately after each grain onset, which is what stops sparse settings sounding like
  discrete taps.

Use the classic Schroeder/Moorer building block. Delay-line lengths **should be mutually
prime and span successive orders of magnitude** — a principle that runs unbroken from
Schroeder's 1962 designs into modern implementations. **[C]** Use the **two-multiply
allpass** popularised by Moorer, which became the standard block because it is more
efficient than Schroeder's three-multiply form. **[C]**

Spec [I]: 4 allpass sections per channel, delays **{7.13, 11.31, 17.29, 23.71} ms** for the
left channel and **{7.79, 12.41, 18.83, 25.19} ms** for the right (different lengths per
channel is what decorrelates the two outputs), `g` swept **0 → 0.72** by the Diffusion
control. Convert to samples and then **adjust each to the nearest prime number of samples**
at the running sample rate — that is what "mutually prime" means in practice.

Dattorro's plate topology is the alternative worth knowing: a **"tank" of recirculating
diffusers arranged in a figure-eight**, in the Griesinger style. **[C]** It is a strictly
better-sounding diffuser than a plain series chain and costs about the same. If the series
chain measures poorly on echo density (V7), switch to the tank.

### 2.4 Freeze / infinite hold

Two implementations exist and only one is safe.

- **Wrong: set `fb = 1.0`.** The loop is then marginally stable; in float arithmetic it will
  drift up or down, DC and near-DC energy accumulates, and the tone changes over the hold.
- **Right: stop the write head.** The buffer's contents are held exactly; grains continue to
  read from it; the input is muted from the buffer (but may still pass to the dry path). The
  held material is bit-exact and can be held indefinitely with no drift and no possibility
  of runaway. **[I]** — the literature describes freeze as "capturing incoming audio while
  continuing to granulate the frozen instant" **[R]**, which is exactly this.

Freeze must **crossfade the write head to a stop over 10 ms** so the buffer does not contain
a step at the freeze point, and the region around the freeze boundary should be excluded
from grain read positions for the first `L` seconds, or grains straddling the boundary will
click once per pass.

While frozen, `fb` is ignored and the tail is sustained by the buffer itself.

### 2.5 Damping and spectral tilt

**Damping** is a lowpass in the feedback path. The design intent, stated plainly in the
literature: the feedback gain sets the **low-frequency T60**, and the feedback lowpass
causes **T60 to decrease with frequency, which is natural** — matching air absorption, which
increases significantly with frequency. **[C]**

One-pole lowpass in the loop:

```
    y[n] = (1 − d) · x[n] + d · y[n−1]
```

where `d ∈ [0, 0.95]`. To hit a _target_ HF decay ratio, note that per pass the loop applies
`fb · H_lp(ω)`, so `RT60(ω) = −3·τ̄ / log₁₀( fb · |H_lp(ω)| )`. Expose the control as
"Damping 0–100%" mapped to `d`, and **display the resulting RT60 at 8 kHz** next to the
control — that turns an opaque parameter into a legible one and costs nothing.

**Spectral tilt** is a separate, symmetric control: a first-order shelving pair pivoting at
**1 kHz**, low shelf `+T` dB and high shelf `−T` dB, `T ∈ [−12, +12]`. Placed in the
feedback path it compounds per pass, which is what makes it a _character_ control rather
than an EQ: a −3 dB tilt becomes −30 dB by the tenth pass. Document that compounding in the
tooltip, because users will otherwise find the control absurdly strong.

Also required in the loop, in this order: **DC blocker (20 Hz HPF) → damping LPF → tilt →
limiter → ×fb**. The DC blocker goes first so the limiter is not triggered by DC.

---

## 3. Pitch-shifted grains, shimmer and scale quantisation

### 3.1 Grain pitch shifting is nearly free

This is granular synthesis's structural advantage over every other reverb architecture and
it is the main reason to choose it. To shift a grain by `s` semitones, read the buffer with
increment

```
    r = 2^(s/12)
```

while the **window still runs for `L` seconds of output**. The grain therefore consumes
`r·L` seconds of source. No phase vocoder, no FFT, no latency — the cost is the same
interpolated read we were already doing. **[C]** — this is exactly what the shimmer
literature describes as the "granular pitch-shift layer" alternative to phase-vocoder
time-scale modification followed by resampling. **[C]**

The consequence to state plainly: **grain resampling shifts formants along with pitch.** A
voice pitched up an octave sounds like a voice pitched up an octave, not like the same voice
singing higher. For shimmer this is desirable — the shimmer voice should not sound like the
source. If formant-preserved shifting is ever wanted, that needs a different algorithm
(PSOLA or a phase vocoder with spectral-envelope division) and is **out of scope for this
device.**

Read interpolation quality matters more than usual here, because `r ≠ 1` means every sample
is interpolated. Linear interpolation at `r = 2` has a −6 dB error at Nyquist/2 and audible
aliasing on bright material. **Spec: 4-point cubic Hermite interpolation** (≈14 flops
against linear's ≈4). At `|s| > 12` semitones, additionally apply a one-pole lowpass at
`0.45·fs/r` before the read to suppress the aliasing that upward shifts fold back. [I]

### 3.2 Shimmer — pitch shift inside the feedback loop

The architecture is settled in the literature: **the best-sounding shimmer puts the +12
shift inside the reverb's feedback path**, not in a parallel send. **[C]** In a granular
reverb this is free, because the grains _are_ the feedback path — a grain simply picks its
own pitch when it is spawned.

**Per-grain pitch assignment** [I]: each grain draws a shift from a weighted interval set.
That is what makes a chord rather than a detune — a fixed shift on every grain gives one
transposed copy, while drawing per grain gives a simultaneous chord whose voices are
continuously reshuffled, which is the sound people mean by "shimmer".

Interval sets to ship:

| Name        | Semitone set       | Weights            |
| ----------- | ------------------ | ------------------ |
| Unison      | {0}                | 1                  |
| Octave up   | {0, +12}           | 0.6, 0.4           |
| Octave down | {0, −12}           | 0.6, 0.4           |
| Fifth       | {0, +7}            | 0.6, 0.4           |
| Major       | {0, +4, +7, +12}   | 0.4, 0.2, 0.2, 0.2 |
| Minor       | {0, +3, +7, +12}   | 0.4, 0.2, 0.2, 0.2 |
| Sus         | {0, +5, +7, +12}   | 0.4, 0.2, 0.2, 0.2 |
| Wide        | {−12, 0, +12, +19} | 0.25 each          |

The literature confirms products in this class shift by **perfect fourths, fifths and
octaves**, and that sub-octave plus octave-up simultaneously is a standard pairing. **[C]**

**Scale quantisation** (constraining shifts to a key rather than to intervals) is a
different feature and I could not find it documented in the shimmer literature. It is
straightforward to add — quantise the drawn shift to the nearest member of a scale-degree
set — but it only makes musical sense if the _root_ is known, which means either a
user-set key or pitch detection on the input. **Spec the interval sets now; treat
scale-quantisation as a later addition** and mark it unconfirmed as prior art. [I]

### 3.3 Shimmer stability — the specific failure mode

An upward shift in a feedback loop **moves energy up in frequency on every pass**. After
`k` passes the original band `[f, 2f]` has become `[2^k·f, 2^{k+1}·f]`; energy piles into
the top octave and the loop screams, and then aliases. A downward shift does the mirror
thing into the low end and turns into a rumble.

The literature's stated remedy is to **fine-tune what gets fed back by frequency, using a
low/mid/high crossover network in the feedback path**. **[C]**

Our rule [I], simpler and sufficient: make the damping filter **automatically track the
pitch set**. For a set whose maximum shift is `s_max > 0`, force

```
    f_damp ≤ 0.5 · fs / 2^(s_max/12)
```

and additionally scale the damping control's lower bound so the user cannot defeat it. For
`s_min < 0`, raise the DC-blocker corner to `20 · 2^(−s_min/12)` Hz. Both are cheap and both
turn an unstable configuration into an impossible one, which is better than a warning label.

---

## 4. Alternative architectures — the ADR comparison

This section exists so the ADR can justify choosing granular rather than assert it.

### 4.1 Schroeder (1962)

Parallel comb filters feeding series allpass filters. **[C]** Design rules from the
literature: delay lengths **mutually prime**, four comb delays typically between **30 and
45 ms**, and **open-loop comb gain should not exceed about 0.85 (−1.4 dB)** or response
fluctuations become excessive. **[C]**

- Cost: ~8 delay lines, ~40 flops/sample/channel. Essentially free.
- Weakness: audibly metallic; comb resonances colour the tail; no pitch capability;
  fixed echo pattern.

### 4.2 Moorer (1979)

Extends Schroeder: lowpass filters inside the comb feedback for frequency-dependent decay,
and the **two-multiply allpass** that became the standard building block. **[C]**

- Cost: ~50 flops/sample/channel.
- Weakness: same family of colouration, better managed.

### 4.3 Dattorro (1997) plate

A simplified plate-class topology in Griesinger's style: an input diffusion chain feeding a
**"tank"** — four recirculating diffusers arranged as a **figure-eight** that traps the sound
and recirculates it. **[C]** Dattorro's paper also makes the design point that Schroeder's
eigentone-density criterion is not a hard rule, and that **decorrelation of the decay and
the time density of echoes matter equally**. **[C]**

- Cost: ~14 delay lines and ~80 flops/sample. Still cheap.
- Strength: the best sound-per-flop of any architecture here. **This is the correct
  fallback if granular does not meet the phone budget**, and it is the right thing to ship
  as a separate "plate" algorithm regardless.
- Weakness: no pitch capability, no freeze without bolting one on, decay is not
  independently controllable per band without extra filters.

### 4.4 Feedback delay network (Jot & Chaigne)

`N` delay lines coupled by a **unitary feedback matrix**. **[C]** Matrix choices are a
documented trade: **circulant, sparse and Householder for computational efficiency;
Hadamard for a dense impulse response** — the Hadamard matrix is used in IRCAM's
Spatialisateur. **[C]** **Absorption filters** on each line are designed to give a target
RT60 per frequency band, and Jot adds a **tonal-correction filter in series** with the
network to compensate for the decay-time-dependent colouration. **[C]**

- Cost, and this is the fact that surprises people: an `N = 16` Hadamard FDN does **not**
  cost 256 multiplies. A fast Walsh-Hadamard transform computes it in `N·log₂N = 64`
  add/subtracts. With 16 delay lines and 16 one-pole absorption filters that is roughly
  **130 flops/sample/channel**. **[C, computed]** An FDN16 is _cheaper than our granular
  reverb._
- Strength: dense, smooth, precisely controllable RT60 per band; the best "neutral room".
- Weakness: no pitch capability, no freeze, and the sound is inherently smooth — it cannot
  do the sparse, grainy, textural settings that are the whole point of FX-02.

### 4.5 Convolution

Exact reproduction of a measured space. Requires partitioned convolution; **non-uniform
partitioning (Gardner, 1995)** is the standard way to get real-time operation without
I/O latency, and zero-latency schemes implement the head of the IR in direct form with FFT
blocks handling the tail. **[C]**

Cost, computed for our budget [C, computed]: uniformly-partitioned overlap-save with
partition size `B` and `P = M/B` partitions costs roughly `20·log₂(2B) + 8P`
flops/sample/channel. For `B = 256` and a **2-second** IR at 48 kHz (`M = 96 000`,
`P = 375`) that is `180 + 3000 ≈ 3 180` flops/sample/channel — **≈ 12 700 flops/sample for
true-stereo (4 IRs)**, i.e. **~610 Mflop/s for a single instance**. Twelve instances would
need **7.3 Gflop/s**, plus 1.5 MB of IR per instance.

**Convolution is disqualified for this product on cost alone**, before considering that it
cannot freeze, cannot shimmer, and cannot change decay time without swapping the IR.

### 4.6 Recommendation for the ADR

**Choose granular.** It is the only architecture in this list that natively provides
per-grain pitch shifting (§3.1), exact freeze (§2.4), and a continuous sparse-to-dense
texture axis, and it does so at a cost (§7) that is the same order as an FDN and two orders
below convolution. Its weakness — it is _not_ the most neutral-sounding room — is real, and
the answer is to **also** ship a Dattorro-class plate (§4.3) as a separate algorithm rather
than to try to make the granular engine sound neutral.

---

## 5. Our architecture

See the block diagram in §2.1. Signal flow, stated as an ordered list so it is
unambiguous:

1. Input → **pre-delay** (0–500 ms) → buffer write summing point.
2. Buffer write summing point = `input + feedbackSignal`, then → **circular buffer**
   (mono-sum or stereo, see §7.2), write head `W`.
3. **Scheduler** spawns grains at rate `R` with fractional onsets (§1.4). Each grain
   captures, at spawn time: read offset `τ ~ U(minOffset, minOffset + size)`, length
   `L·(1 + lengthJitter·ξ)`, pitch `r = 2^(s/12)` with `s` drawn from the interval set,
   pan `p ~ U(−spread, +spread)`, amplitude `A·(1 + ampJitter·ξ)`.
4. Grains render into a stereo accumulator with cubic-Hermite reads and table-lookup
   windows.
5. Accumulator → **diffusion allpass chain** (§2.3) → wet bus.
6. Wet bus → **DC blocker → damping LPF → tilt shelves → soft limiter → ×fb** → back to
   step 2.
7. Wet bus → **width** (M/S) → **mix** against the dry input → output.

The feedback tap is taken **after** diffusion so the allpass chain also participates in the
loop, which increases echo density per pass at no extra cost.

---

## 6. Control specification

All ranges are our spec [I] unless a literature value is cited.

| Control          | Range                   | Unit                 | Taper                         | Default  | Interactions                                                                                                                                     |
| ---------------- | ----------------------- | -------------------- | ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mix              | 0–100                   | %                    | linear (equal-power above 50) | 35       | 0% must null exactly (V1).                                                                                                                       |
| Pre-delay        | 0–500                   | ms                   | linear                        | 20       | Sync-to-tempo option; adds to latency budget only if > 0.                                                                                        |
| Size             | 20–4000                 | ms                   | log                           | 800      | Width of the read-offset window; sets `τ̄ ≈ minOffset + size/2`, so it interacts with Decay's calibration (§2.2).                                 |
| Min offset       | 5–500                   | ms                   | log                           | 20       | Floor of the read window. Must stay ≥ `L` or grains read the write head and self-oscillate. Clamp hard.                                          |
| Decay (RT60)     | 0.1–60                  | s                    | log                           | 3.0      | Inverts to `fb` via §2.2; `fb` capped 0.98. Ignored in Freeze.                                                                                   |
| Freeze           | on/off                  | —                    | —                             | off      | Stops write head (§2.4); `fb` ignored; 10 ms crossfade.                                                                                          |
| Grain size       | 5–500 **[C-informed]**  | ms                   | log                           | 60       | Below 15 ms the window colours the sound (§1.1) — show a UI marker there. Above ~50 ms the tail begins to separate into discrete events **[C]**. |
| Density          | 1–2000 **[C-informed]** | grains/s             | log                           | 350      | Literature range is hundreds to thousands **[C]**. Sets `O = R·L`; drives CPU directly (§7).                                                     |
| Overlap readout  | —                       | ×                    | —                             | —        | Not a control: display `O = R·L` live. It is the number that predicts both sound and CPU.                                                        |
| Spray (position) | 0–100                   | %                    | linear                        | 70       | Scales randomisation of `τ` within the size window.                                                                                              |
| Onset jitter     | 0–100                   | %                    | linear                        | 60       | 0 = quasi-synchronous, 100 = asynchronous (§1.4).                                                                                                |
| Length jitter    | 0–100                   | %                    | linear                        | 25       |                                                                                                                                                  |
| Amp jitter       | 0–100                   | %                    | linear                        | 15       |                                                                                                                                                  |
| Window shape     | 0–100                   | % → Tukey α 1→0.1    | linear                        | 0 (Hann) | Auto-linked to grain size by default.                                                                                                            |
| Pitch set        | enum (§3.2)             | —                    | —                             | Unison   | Non-unison sets force damping/HPF limits (§3.3).                                                                                                 |
| Pitch spread     | 0–100                   | cents                | linear                        | 0        | Per-grain random detune on top of the set.                                                                                                       |
| Diffusion        | 0–100                   | % → allpass g 0→0.72 | linear                        | 60       |                                                                                                                                                  |
| Damping          | 0–100                   | % → `d` 0→0.95       | linear                        | 45       | Display resulting RT60 @ 8 kHz. Lower-bounded by pitch set (§3.3).                                                                               |
| Tilt             | −12 … +12               | dB                   | linear                        | 0        | Compounds per pass — say so in the tooltip.                                                                                                      |
| Width            | 0–200                   | %                    | linear                        | 100      | M/S on the wet bus only.                                                                                                                         |
| Output trim      | −24 … +24               | dB                   | linear in dB                  | 0        |                                                                                                                                                  |
| Quality          | {Eco, Normal, High}     | enum                 | —                             | Normal   | Caps `O` (§7.4) and selects interpolation order.                                                                                                 |

---

## 7. CPU and memory cost model

Budget, as for FX-01: **12 instances, phone, 256-sample buffer, 48 kHz** — 5.33 ms of wall
clock per block for the whole engine. A reverb is expensive relative to a modulation
processor, so allocate it more: **~5% of a core per instance**.

### 7.1 The cost formula

The dominant term is grain rendering, and it is **linear in the overlap factor**:

```
    flops/sample  ≈  C_grain · O  +  C_fixed
    where O = R · L
```

`C_grain`, per grain per sample, for our spec (one buffer read, cubic Hermite, table window,
stereo pan-accumulate):

| Operation                              | Flops  |
| -------------------------------------- | ------ |
| Read-pointer advance + wrap            | 2      |
| 4-point cubic Hermite interpolation    | 14     |
| Window table read + lerp               | 4      |
| Amplitude + pan, accumulate to L and R | 4      |
| **C_grain**                            | **24** |

With linear interpolation instead of Hermite (Eco quality), `C_grain = 14`.

`C_fixed`, per sample, stereo:

| Item                                                      | Flops     |
| --------------------------------------------------------- | --------- |
| Buffer write + wrap                                       | 4         |
| 4 diffusion allpasses × 2 ch (two-multiply form, ~6 each) | 48        |
| DC blocker × 2                                            | 8         |
| Damping one-pole × 2                                      | 6         |
| Tilt shelves (2 biquads × 2 ch)                           | 36        |
| Soft limiter (envelope + tanh approx) × 2                 | 24        |
| Mix, width, trim                                          | 14        |
| Scheduler amortised (≈ R spawns/s × ~60 flops)            | ~1        |
| **C_fixed**                                               | **≈ 141** |

### 7.2 Worked figures

| Setting        | `R` (g/s) | `L` (ms) | `O`    | flops/sample | Mflop/s @48k | ×12 instances    |
| -------------- | --------- | -------- | ------ | ------------ | ------------ | ---------------- |
| Sparse texture | 60        | 80       | 4.8    | 256          | 12.3         | 148 Mflop/s      |
| **Default**    | **350**   | **60**   | **21** | **645**      | **31.0**     | **372 Mflop/s**  |
| Dense/smooth   | 800       | 60       | 48     | 1 293        | 62.1         | 745 Mflop/s      |
| Literature max | 2 000     | 100      | 200    | 4 941        | 237          | **2.85 Gflop/s** |

A current mid-range phone core sustains roughly 2–8 Gflop/s scalar and several times that
with NEON. The default setting at 12 instances is comfortable. **The "literature max" row is
not**, and that is the whole reason the Quality control exists.

For comparison from §4: FDN16 ≈ 130 flops/sample; Dattorro plate ≈ 80; convolution
≈ 12 700. The granular default sits between the cheap algorithmic reverbs and convolution,
about 5× the cost of an FDN and 20× cheaper than convolution.

### 7.3 Memory

Per instance:

| Item                                                                       | Size          |
| -------------------------------------------------------------------------- | ------------- |
| Circular buffer, **mono**, `maxOffset + maxSize + maxGrain` = 5 s, float32 | **960 KB**    |
| Circular buffer if **stereo** instead                                      | 1.92 MB       |
| Grain pool, 256 slots × 64 B                                               | 16 KB         |
| Diffusion allpass delay lines, ~50 ms × 2 ch, float32                      | 19 KB         |
| Window tables (4 shapes × 4096 × float32), **shared across all instances** | 64 KB total   |
| Pre-delay line, 500 ms stereo float32                                      | 192 KB        |
| **Per instance total (mono buffer)**                                       | **≈ 1.19 MB** |
| **12 instances**                                                           | **≈ 14.3 MB** |

**Decision: the granular buffer is mono.** [I] Reasons, in order: it halves the largest
allocation; it halves interpolation cost (one read per grain rather than two); and it
_sounds better_, because per-grain random panning of a mono source produces a fully
decorrelated stereo tail, whereas granulating stereo and preserving each grain's original
stereo position produces a narrower, more correlated tail. The cost is that a
hard-panned stereo source loses its placement in the tail — which for a reverb is
acceptable and arguably correct. The dry path is untouched and remains stereo.

### 7.4 Quality tiers

| Tier   | Interpolation                                   | Max `O` | Notes                                                         |
| ------ | ----------------------------------------------- | ------- | ------------------------------------------------------------- |
| Eco    | linear                                          | 12      | Mobile default. `C_grain = 14` → 309 flops/sample worst case. |
| Normal | cubic Hermite                                   | 32      | Desktop default; mobile if instance count < 6.                |
| High   | cubic Hermite + anti-alias LPF on shifted reads | 96      | Desktop only.                                                 |

The cap is applied by **reducing `R` to satisfy `R·L ≤ O_max`, not by dropping grains**.
Dropping grains modulates loudness with CPU load, which is unacceptable; reducing `R`
changes the density and the §1.3 normalisation compensates automatically, so the result is
quieter-textured but level-stable. Show the clamped density in the UI so the user is not
lied to.

Allocate everything at construction; **never allocate on the audio thread**. Grains are
taken from a fixed pool and a spawn that finds the pool full is dropped and counted — that
counter is a QA output (V8).

---

## 8. Character artefacts worth modelling

1. **Grain-rate periodicity at low density.** When `O` is around 1–3 and onset jitter is
   low, the grain rate is audible as a pitch or flutter. This is a _feature_ at the sparse
   end of the Density control and must not be smoothed away; it is the sound of a granular
   reverb rather than an FDN.
2. **Window-induced spectral bloom on short grains.** Below 10–15 ms the window's spectrum
   dominates **[C]** and the tail acquires a bright, formant-like ring. Keep it available;
   mark the region in the UI.
3. **Pitch-set beating.** Two grains at +7 semitones read from slightly different positions
   beat against each other. Pitch spread (§6) controls how much. This is what makes a
   shimmer sound like an ensemble rather than a transposer.
4. **Shimmer's rising spectral centroid.** Even with the §3.3 limits, the tail's centroid
   rises over the decay. That _is_ shimmer. Do not flatten it.
5. **Freeze-boundary discontinuity.** Handled in §2.4 — but a _deliberate_ version, a
   short buffer loop with an audible seam, is a useful glitch character and should be
   available as a "hard freeze" variant.
6. **Limiter pumping in the loop.** At long decays with dense input, the loop limiter
   breathes. This is audible and characterful at moderate settings and ugly at extreme
   ones; the 5 ms release is chosen to sit on the acceptable side.

---

## 9. Verification — measurements QA must run

| ID  | Measurement                                                                                                                   | Method                                                                                                                                 | Target                                                                                                                         | Tolerance                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | **Dry null.** Mix = 0%.                                                                                                       | Null against input, 60 s of pink noise + drums.                                                                                        | **≤ −140 dBFS** residual.                                                                                                      | None; any audible residual is a bug.                                                                                                                    |
| V2  | **COLA sanity.** Bypass feedback and randomisation; Hann window, hop = `N/2`, unity pitch, no spray.                          | Feed DC 1.0; measure output.                                                                                                           | Output = **1.000** constant.                                                                                                   | ±0.001. Proves the window table, phase increment and normalisation are all correct in isolation. Run this before anything else.                         |
| V3  | **Onset quantisation / block-rate buzz.** `R` = 300, `L` = 30 ms, jitter = 0, feedback = 0, input = DC.                       | FFT the output; look for a line at `fs/blockSize` (187.5 Hz at 256/48k) and its harmonics.                                             | Component at `fs/blockSize` **≤ −80 dBFS** relative to the grain-rate component.                                               | +3 dB. Repeat at block sizes 64, 128, 256, 512 — the artefact must not move with block size, which is the definitive test.                              |
| V4  | **Continuity vs overlap.** Sweep `O` from 0.25 to 32 with white-noise input.                                                  | Measure the longest inter-grain gap and the RMS modulation depth of the output envelope.                                               | At `O ≥ 4`, no gap exceeds **4 ms** (below the pink-noise perceptibility threshold **[C]**); envelope modulation ≤ 1.5 dB RMS. | ±0.5 dB.                                                                                                                                                |
| V5  | **RT60 accuracy.** For Decay settings {0.5, 1, 2, 4, 8, 16, 32, 60} s, at Damping 0.                                          | Impulse → **Schroeder backward integration** of the squared IR; fit the −5 dB to −35 dB region and extrapolate to −60 dB (T30 method). | Measured RT60 within **±10%** of the displayed value, in octave bands 250 Hz–4 kHz.                                            | ±10%. §2.2's `fb` formula is an approximation; if it fails, build a calibration table from this measurement — **do not** ship the uncalibrated formula. |
| V6  | **Decay independence from density.** Fix Decay = 4 s; sweep Density 20 → 1500 g/s.                                            | Measure RT60 at each.                                                                                                                  | RT60 varies by **≤ 5%** across the whole sweep.                                                                                | 5%. This is the direct test that the §1.3 normalisation is inside the loop. Failure here is the runaway-feedback bug.                                   |
| V7  | **Echo density buildup.** Default settings.                                                                                   | Normalised echo density of the IR (Abel–Huang measure) vs time.                                                                        | Reaches **0.9** within **80 ms** of the impulse.                                                                               | +20 ms. Below that the tail sounds grainy-in-a-bad-way; consider the Dattorro tank (§2.3).                                                              |
| V8  | **Grain-density accounting.** Instrument the scheduler.                                                                       | Over 60 s at each of Density = {10, 100, 350, 1000, 2000}: count grains spawned, grains rendered, grains dropped for pool exhaustion.  | `spawned/60` within **±1%** of the set rate; **dropped = 0**; `rendered = spawned`.                                            | 1% on rate; **zero** drops. A non-zero drop count means the pool is undersized for that `O` and the Quality cap (§7.4) is not being applied.            |
| V9  | **Feedback stability sweep.** Decay = 60 s, Freeze off, all pitch sets, Density at max, 10 minutes of programme then silence. | Peak and RMS of the loop signal.                                                                                                       | Loop RMS **must not grow** after input stops; peak **≤ −0.1 dBFS** at all times.                                               | None. Any monotonic growth is a fail.                                                                                                                   |
| V10 | **DC accumulation.** Feed a +0.5 DC offset for 60 s at Decay = 30 s.                                                          | Measure output DC.                                                                                                                     | **≤ −80 dBFS** DC at the output.                                                                                               | +3 dB. Tests the loop DC blocker.                                                                                                                       |
| V11 | **Freeze exactness.** Freeze with a 1 kHz sine in the buffer; hold 10 minutes.                                                | Measure output RMS and spectral centroid at t = 10 s and t = 600 s.                                                                    | RMS drift **≤ 0.1 dB**; centroid drift **≤ 1%**.                                                                               | As stated. Proves freeze is write-head-stop, not `fb = 1.0`.                                                                                            |
| V12 | **Shimmer aliasing.** Pitch set "Wide", 10 kHz sine input, High quality.                                                      | FFT; identify components not at `10 000 · 2^(s/12)` for `s` in the set.                                                                | Alias products **≤ −70 dBFS**.                                                                                                 | +3 dB. Tests §3.1's interpolation and pre-read lowpass.                                                                                                 |
| V13 | **CPU vs overlap linearity.** Profile at `O` = 4, 8, 16, 32, 64.                                                              | Per-block processing time.                                                                                                             | Fits `a·O + b` with **R² ≥ 0.98**; extracted `a` within **±25%** of `C_grain/fs`.                                              | As stated. A non-linear fit means allocation or cache behaviour is leaking into the audio thread.                                                       |

---

## 10. Sources

Granular synthesis:

- [Curtis Roads, _Microsound_ (MIT Press, 2001) — full text PDF](https://monoskop.org/images/d/d1/Roads_Curtis_Microsound.pdf) — time scales, the 50 ms fusion threshold, the 4 ms / 20 ms pink-noise interruption results, point→pulse→line→surface, the twenty-grain cloud illustration
- [Sound On Sound — review of Roads' _Microsound_](https://www.soundonsound.com/reviews/curtis-roads-microsound)
- [SFU Sonic Studio Handbook — Microsound](https://www.sfu.ca/sonic-studio-webdav/cmns/Handbook%20Tutorial/Microsound.html)
- [Barry Truax — Granular Synthesis](https://www.sfu.ca/~truax/gran.html) — real-time granular from 1986, quasi-synchronous streams, trapezoidal envelopes
- [Ross Bencina, _Implementing Real-Time Granular Synthesis_ (Audio Anecdotes, 2001)](http://www.rossbencina.com/static/code/granular-synthesis/BencinaAudioAnecdotes310801.pdf) — scheduling architecture, three envelope-generation algorithms, two stochastic-onset methods, the scheduling/synthesis boundary
- [University of Washington CSE490S — Granular Synthesis and Processing (lecture notes)](https://courses.cs.washington.edu/courses/cse490s/11au/lectures/G-Granular.pdf) — envelope spectral distortion ranking; the <10–15 ms artefact threshold
- [Brandtsegg et al., _Particle synthesis — a unified model for granular synthesis_ (LAC 2011)](http://lac.linuxaudio.org/2011/download/Partikkel_LAC_2011.pdf)
- [Csound _partikkel_ opcode manual](https://csound.com/manual/opcodes/partikkel/)
- [Keller & Truax, _Ecologically-based granular synthesis_ (CCRMA)](https://ccrma.stanford.edu/~dkeller/pdf/KellerTruax98.pdf)
- [Roads' five-way classification, via _Spectral Granular Synthesis_ (ICMC 2018)](https://quod.lib.umich.edu/i/icmc/bbp2372.2018.019/--spectral-granular-synthesis?rgn=main%3Bview%3Dfulltext)

Granular reverberation:

- [Ervik & Brandtsegg, _Creating reverb effects using granular synthesis_ (1st International Csound Conference, Hannover 2011)](https://www.incontri.hmtm-hannover.de/fileadmin/www.incontri/Csound_Conference/Ervik_Brandtsegg2.pdf) — feedback of granular output into the source table; the 8×0.5 s buffer, ×8 time-stretch, slow attack/release construction
- [Sound On Sound — Understanding Granular Delay](https://www.soundonsound.com/techniques/understanding-granular-delay) — buffer/grain relationship, feedback into the input for longer decays

Shimmer:

- [Zheng, _"Shimmer" Audio Effect: A Harmonic Reverberator_ (CCRMA)](https://ccrma.stanford.edu/~jingjiez/portfolio/echoing-harmonics/pdfs/Shimmer%20Audio%20Effect%20-%20A%20Harmonic%20Reverberator.pdf) — pitch shifter inside the feedback path; TSM-plus-resampling for the octave
- [Sound On Sound — Creating Shimmer Reverb Effects](https://www.soundonsound.com/techniques/creating-shimmer-reverb-effects) — crossover-controlled feedback for stability; fourths/fifths/octaves
- [ModWiggler — How does shimmer reverb work?](https://www.modwiggler.com/forum/viewtopic.php?t=136261) [R]

Artificial reverberation:

- [Julius O. Smith, _Physical Audio Signal Processing_ — Schroeder Reverberators](https://www.dsprelated.com/freebooks/pasp/Schroeder_Reverberators.html) — mutually prime delays, comb gain ≤ 0.85, 30–45 ms comb delays
- [Julius O. Smith — FDN Reverberation](https://www.dsprelated.com/freebooks/pasp/FDN_Reverberation.html)
- [Julius O. Smith — Lowpass-Feedback Comb Filter](https://www.dsprelated.com/freebooks/pasp/Lowpass_Feedback_Comb_Filter.html) — feedback sets LF T60, damping shortens T60 with frequency
- [Julius O. Smith, MUS420 Lecture 3 — Artificial Reverberation and Spatialization](https://ccrma.stanford.edu/~jos/Reverb/Reverb.pdf)
- [J. A. Moorer, _About This Reverberation Business_ (1979), IRCAM listing](http://articles.ircam.fr/textes/Moorer78b/) — two-multiply allpass, lowpass in comb feedback
- [Jon Dattorro, _Effect Design Part 1: Reverberator and Other Filters_ (JAES 1997)](https://ccrma.stanford.edu/~dattorro/EffectDesignPart1.pdf) — plate topology, the figure-eight tank, echo-density and decorrelation argument
- [Valhalla DSP — Getting Started With Reverb Design, Part 2: The Best Papers](https://valhalladsp.com/2021/09/22/getting-started-with-reverb-design-part-2-the-foundations/) — bibliography and design commentary [R]
- [McGill MUMT 618 — Late Reverberation](https://www.music.mcgill.ca/~gary/618/week3/node11.html)
- [_Improved Reverberation Time Control For Feedback Delay Networks_ (DAFx)](https://www.researchgate.net/publication/335756510_Improved_Reverberation_Time_Control_For_Feedback_Delay_Networks) — `g = 10^(−3t/RT60)` and the per-sample attenuation formulation
- [_Unitary Matrix Design for Diffuse Jot Reverberators_](https://www.researchgate.net/publication/230757792_Unitary_Matrix_Design_for_Diffuse_Jot_Reverberators) — circulant/sparse/Householder for efficiency, Hadamard for density
- [_FDNTB: The Feedback Delay Network Toolbox_](https://www.researchgate.net/publication/344467473_FDNTB_The_Feedback_Delay_Network_Toolbox)
- [Gardner-style non-uniform partitioned convolution — _A Low Latency Implementation of a Non Uniform Partitioned Convolution algorithm_](https://www.researchgate.net/publication/236839141_A_Low_Latency_Implementation_of_a_Non_Uniform_Partitioned_Convolution_algorithm_for_Room_acoustic_simulation)
- [Zero-latency convolution on Bela (project report)](https://csteinmetz1.github.io/bela-zlc/report.pdf)

---

## 11. What I could not confirm

1. **The exact `fb ↔ RT60` relation for a granular loop.** §2.2 is derived by analogy with
   the comb/FDN case and is marked [I]. **V5 exists specifically to catch this**, and the
   shipped control must be calibrated from measurement.
2. **Whether `τ̄` is the right time constant** or whether the _median_ or the harmonic mean
   of the offset distribution predicts RT60 better. Determine empirically during V5.
3. **Scale-quantised grain pitch as prior art.** Interval sets are documented **[C]**;
   key/scale quantisation of grain pitch is not, in anything I could reach.
4. **Abel–Huang normalised echo density** — I have cited the measure by name from the
   reverb-design literature but could not reach the original paper to transcribe its exact
   definition. The DSP engineer must pull it before implementing V7's metric; my 0.9-in-80 ms
   target is an engineering judgement, not a literature value. [I]
5. **Gaussian window `mean(w²)` = 0.266** is a numerical estimate for the truncated σ = 0.3
   case, computed here rather than taken from a source. Verify numerically in code.
6. **Real phone throughput.** Every Mflop/s figure in §7 is an operation count, not a
   measurement. The 2–8 Gflop/s scalar figure for a mid-range phone core is a rough
   engineering figure, **[U]**, and the whole budget rests on it. Profile before committing
   to the Quality-tier caps.
7. **Whether 12 simultaneous instances of _this_ effect is a realistic product requirement.**
   At the "literature max" row of §7.2 it is not achievable on any phone. If the product
   genuinely needs 12 reverbs, the Eco tier must be the mobile default and must be enforced,
   not suggested.
