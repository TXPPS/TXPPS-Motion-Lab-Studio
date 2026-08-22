# Reference spec — FX-03 Granular Delay

Status: **research complete, ready to implement against**. Author: Research Analyst.
Class of device: multi-tap / ping-pong delay with per-tap processing, a saturating filtered
feedback path, granular scattering of the taps, and tape/BBD character modelling.

FX-03 shares its granular machinery with FX-02. **Read FX-02 §1 first** — grain windows,
the density/overlap normalisation, and the scheduler are specified there and are not
repeated here. This document covers what is different: delay topology, per-tap processing,
feedback stability, and analogue character.

## 0. How to read this document

Markers as in FX-01/FX-02: **[C]** confirmed, **[R]** reported, **[U]** unconfirmed,
**[I]** our inference or design decision.

**Sourcing constraint.** Direct fetch is blocked by the egress proxy in this environment;
all sources were reached through search-engine extraction. The two papers this document
leans on hardest — Raffel & Smith on BBD circuits and Chowdhury et al. on physical tape
modelling — must be pulled in full by the implementing engineer before the character models
in §6 are coded. I have their findings but not their coefficient tables.

**IP note.** Hardware model numbers and machine names in §6 are named as engineering prior
art: they identify published circuit and physical behaviour, which is the legitimate object
of study. They must not appear in shipped UI, code identifiers, preset names, filenames or
marketing copy. Nothing here describes or traces any product's visual design.

---

## 1. Delay topologies

### 1.1 The three topologies we need

**Single line with feedback.** One delay line, output tapped and fed back through gain,
filter and saturation. The baseline.

**Multi-tap.** One delay buffer read at several points. "A multi-output delay line is said
to be multitapped, because the signal is tapped off at different points in the delay
buffer"; **three or four taps is specifically what emulates the multi-head tape echoes,
most of which had three or four playback heads**, and applying feedback makes the delayed
signal far more complex. **[C]** That is the historical justification for our tap count and
it should set the default: **4 taps.**

**Ping-pong.** "Separate mono delay lines for left and right, each with its own delay time,
each feeding the input of the other." The input enters one channel, is delayed, and goes in
parallel to the output *and* to the opposite delay line, where it is delayed again. **[C]**

The documented feedback-routing variants are worth enumerating because they are all
musically distinct and cheap to offer: **a single feedback path shared by both delays;
cross-feedback; twin independent feedback paths; feedback summed to mono; "disintegrating"
feedback; and feedback length locked to the longest delay time.** **[C]** A practical note
from the same source: **setting cross-feed on one channel to 50% produces one effective
feedback time for both taps.** **[C]**

### 1.2 Our topology — one buffer, N taps, a routing matrix

Building three separate engines is the wrong answer. All three topologies are the same
structure with a different routing matrix:

```
                    ┌───────────────────────── FEEDBACK ─────────────────────────┐
                    │                                                             │
 in L ──► inGain ──►(+)──► DELAY BUFFER L ═══════════════╗                         │
 in R ──► inGain ──►(+)──► DELAY BUFFER R ═══════════════╣                         │
                    ▲                                     ║                        │
                    │        ┌────────────────────────────╨──────────────┐         │
                    │        │  TAP 1..N   each with:                    │         │
                    │        │    • time (ms or sync division)           │         │
                    │        │    • level, pan                           │         │
                    │        │    • pitch (grain read rate)              │         │
                    │        │    • filter (LP/HP/BP, per tap)           │         │
                    │        │    • reverse flag                         │         │
                    │        │    • GRAIN CLOUD (Smear ≥ 0) ─┐           │         │
                    │        └──────────────────────────────┼───────────┘         │
                    │                                        │                     │
                    │                            Σ taps ─────┴──► wet L/R          │
                    │                                              │               │
                    │  ┌───────────────────────────────────────────┘               │
                    │  ▼                                                            │
                    │  FEEDBACK CHAIN:                                              │
                    │    DC block (20 Hz HP) → loop filter (LP + HP)                 │
                    │      → CHARACTER (tape / BBD / clean, §6)                     │
                    │      → saturator (tanh) → 2×2 routing matrix M → ×fb ─────────┘
                    │
                    └──────────────────────────────────────────► MIX ──► out
```

The 2×2 feedback routing matrix `M` selects the topology:

| Mode | `M` | Behaviour |
| --- | --- | --- |
| Mono / dual | `[[1,0],[0,1]]` | Two independent lines. |
| Ping-pong | `[[0,1],[1,0]]` | Full cross — repeats alternate sides. |
| Blend | `[[1−c, c],[c, 1−c]]` | `c` is the Cross control, 0–100%. `c = 0.5` gives the "one feedback time for both taps" behaviour **[C]**. |
| Mono-summed feedback | `[[.5,.5],[.5,.5]]` | Repeats collapse to centre as they decay. |

**This matrix is also where the stability condition lives** — see §3.2. Do not implement
ping-pong as a special case; implement `M` and let the mode selector set it.

---

## 2. Per-tap processing

Every tap owns its own processing, applied in this fixed order. The order matters and is
not user-configurable, because reversing it breaks the granular read (pitch is a property
of how the grain is *read*, so it must precede everything).

```
    buffer ──► grain read (pitch, reverse) ──► filter ──► level ──► pan ──► wet bus
```

**Pitch** is implemented exactly as in FX-02 §3.1: read increment `r = 2^(s/12)`. In a
delay this has a consequence FX-02 does not have — a pitched tap consumes source material
at rate `r`, so its effective "reach" back into the buffer is `r × grainLength` per grain,
which must be inside the buffer or the tap reads uninitialised memory. Clamp.

The interval sets people actually use in a delay are narrower than in a reverb: the
documented "musically pleasing intervals" for granular delay are **octaves, fourths and
fifths**. **[C]** Offer the FX-02 sets, default to Unison.

**Reverse** plays the grain's source span backwards: start the read at the far end of the
span and use increment `−r`. **Reverse is only coherent when the tap is granular** — a
non-granular reversed tap has no defined span to reverse within, and implementations that
try produce a stutter at the buffer wrap. Spec: enabling Reverse on a tap forces that tap's
minimum grain length to 30 ms and its minimum grain count to 1. [I]

**Filter** per tap: one state-variable filter, LP/HP/BP selectable, 12 dB/oct, with cutoff
and resonance. Placing it per tap rather than only in the feedback path is what lets a
multi-tap delay build a spectral shape across the taps (bright early taps, dark late ones)
rather than only a decaying one.

**Level and pan** per tap. Individual level and panning controls per grain/tap are standard
in this class of device. **[C]** Pan uses equal-power (`cos`/`sin`) law.

---

## 3. The feedback path

### 3.1 What goes in it, in order

```
    wet bus ──► DC blocker (1-pole HP, 20 Hz)
             ──► loop lowpass (1-pole or SVF, 200 Hz – 20 kHz)
             ──► loop highpass (1-pole, 20 Hz – 2 kHz)
             ──► character block (§6: tape / BBD / clean)
             ──► saturator: tanh(drive · x)/drive
             ──► routing matrix M
             ──► × fb
             ──► summing point at the buffer input
```

The DC blocker is first so the saturator is not biased by accumulated DC. The saturator is
last before the matrix so its output is bounded when it reaches the routing.

### 3.2 Stability — the conditions, stated precisely

**The saturator is not a colour. It is the stability mechanism.** Note the two behaviours:

- With a **linear** loop and `fb > 1`, the output diverges without bound to inf/NaN.
- With a **saturating** loop of the form `x ← fb · tanh(x)`, `fb > 1` does **not** diverge.
  It converges to the non-zero fixed point of `a = fb · tanh(a)`, i.e. a bounded
  self-oscillation at a stable amplitude. This is the classic dub-delay runaway that sits
  at a level instead of destroying the mix.

This means we can safely expose `fb` **above 100%** — but only if the saturator is
guaranteed to be in the loop. Spec: `fb` range **0–130%**, and the saturator's drive is
**floored at a value that guarantees compression above −6 dBFS** and cannot be defeated when
`fb > 100%`. [I]

Three conditions that are routinely got wrong and each of which must be asserted in code:

**(a) Loop filter gain.** The condition for decay is `fb · max_ω |H_loop(ω)| < 1`, not
`fb < 1`. A resonant loop filter with `Q = 4` has ~12 dB of peak gain, so `fb = 0.5` with
that filter is *unstable*. **Normalise the loop filter to unity peak gain**, or scale `fb`
by `1/max|H|`. Our SVF must therefore be run in a resonance-compensated form in the loop.

**(b) The cross-feedback sum.** For the routing matrix `M = [[a,b],[b,a]]`, the eigenvalues
are `a+b` and `a−b`. Stability requires `max(|a+b|, |a−b|) · fb < 1`, i.e.

```
        ( |a| + |b| ) · fb  <  1
```

**Not** `|a|·fb < 1` and `|b|·fb < 1` separately. **[C, derived]** This is the single most
common ping-pong bug: self-feedback 0.8 and cross-feedback 0.8 gives an effective loop gain
of 1.6 and the delay explodes. Our `M` above is written with rows summing to 1 precisely so
this cannot happen; if any future mode changes that, this inequality must be asserted.

**(c) Multi-tap feedback sum.** If `k` taps of level `g_i` all feed the loop, the worst-case
loop gain is `fb · Σ|g_i|`. Four taps at unity level and `fb = 0.4` is already at the edge.
**Spec: the feedback tap is a separate, single, dedicated read — not the sum of the output
taps.** [I] That decouples "how many taps you hear" from "how long it rings", which is both
more stable and more musical. Offer "feedback source = tap N / longest tap / dedicated
time", which matches the documented variant "feedback length equal to the longest delay
time". **[C]**

**(d)** A DC blocker in the loop is mandatory (§3.1). A near-unity feedback loop integrates
any DC offset without bound and no saturator will save it, because tanh does not remove a
bias, it just compresses around it.

---

## 4. Granular scattering — the smear continuum

This is the feature that distinguishes FX-03 from a conventional delay, and it should be
**one control**, because the underlying parameters only make sense when moved together.

A granular delay "stores audio into a temporary buffer like a conventional delay, then
breaks the input into short sections called grains, from a few milliseconds to several
hundred milliseconds, with individual grains processed differently before output"; the
result ranges from "glitchy chaos to rich, evolving soundscapes" depending on grain length
and the processing applied — most commonly **pitch-shifting, reversal, time-stretching and
re-ordering, sometimes with random elements**. **[C]** Devices in this class generate on the
order of **64 grains with randomised positions around a fixed recording buffer**, where the
grains "smear out across the stereo field, overlap, and become a boiling swarm". **[R]**

**Our Smear control**, 0–100%, drives four things at once [I]:

| Smear | Grains per tap | Position spray | Onset jitter | Grain length |
| --- | --- | --- | --- | --- |
| 0% | 1 | 0 | 0 | (window bypassed) |
| 25% | 3 | ±15 ms | 10% | 120 ms |
| 50% | 8 | ±60 ms | 35% | 80 ms |
| 75% | 16 | ±150 ms | 60% | 55 ms |
| 100% | 32 | ±400 ms | 100% | 35 ms |

Note the direction: **as smear rises, grains get shorter and more numerous.** That is what
takes the tap across the 50 ms fusion threshold documented in FX-02 §1.1 **[C]** — above
50 ms the grains are heard as separate events (a scattered stutter), below it they fuse into
a cloud. The Smear control is literally a walk across that perceptual boundary, and it is
worth marking the crossing point on the control.

**Smear = 0 must be bit-exact identical to a conventional delay tap.** At 0 the grain
window is bypassed entirely, one grain per tap runs continuously at the tap's position, and
the code path must reduce to a plain interpolated read. This is verification item V2 and it
is the cheapest possible guarantee that the granular machinery has not quietly coloured the
plain delay.

The amplitude normalisation of FX-02 §1.3 applies per tap: `A = 1/sqrt(O · mean(w²))` with
`O` = grains-per-tap × (grainLength / hop). Without it, Smear changes the level and — worse
— changes the feedback loop gain, which changes the decay time. That is verification V6.

---

## 5. Tempo sync divisions

Ship a two-axis selector: a base division and a modifier. This is fewer menu entries than a
flat list and it makes the dotted/triplet relationship legible.

**Base divisions:** 1/64, 1/32, 1/16, 1/8, 1/4, 1/2, 1/1, 2/1, 4/1, 8/1.
**Modifiers:** Straight (×1), Dotted (×1.5), Triplet (×2/3).

```
    delaySeconds = (60 / BPM) · 4 · division · modifier
```

where `division` is expressed as a fraction of a whole note (so 1/4 → 0.25, giving
`60/BPM` seconds — one beat — as expected at 4/4).

Per-tap times may be **absolute** (a division each) or **relative** (tap 1 sets the time,
taps 2..N are multiples of it: ×1, ×2, ×3, ×4 for even multi-head spacing, or a preset
ratio set). Multi-head tape echoes had three or four heads at fixed spacings **[C]**, so
ship head-spacing ratio presets: `{1,2,3}`, `{1,2,4}`, `{1,3,4}`, `{1,2,3,4}`.

**Delay-time changes must be smoothed, and the smoothing mode is a character control** —
see §6.2, because how a delay behaves when its time changes is the single loudest difference
between a digital and an analogue delay.

---

## 6. Tape and BBD character

### 6.1 Wow and flutter — what they are and what values to use

Definitions, from the measurement literature: **wow is variation in motor (or belt/pulley)
speed — slow; flutter comes from the capstan and pinch roller — a higher-frequency variation
in speed.** **[C]** "Drift" is slower still, and "scrape flutter" much faster, and both are
**greatly suppressed by the standard weighting**, leaving wow and flutter prominent. **[C]**

The perceptual anchor, and the most useful single number in this section: **listeners find
speed wobble most objectionable at 4 Hz, and less audible above and below.** The CCIR
weighting curve therefore **peaks at 4 Hz with 6 dB/octave roll-off on both sides**. **[C]**
IEC 386 and DIN 45507 use a **3.15 kHz test tone**, and define **four** curves — unweighted
wow & flutter, weighted wow, weighted flutter, and weighted wow & flutter combined. **[C]**
Specifications are quoted as a **WRMS percentage** (AES6-2008 / IEC 386 weighting), while
DIN and CCIR favour **peak-to-peak ±x%**. **[C]**

Calibration anchors for our depth control:

| Machine class | Weighted W&F | Audibility |
| --- | --- | --- |
| Professional tape machine | **0.02%** | Considered inaudible **[C]** |
| High-end cassette deck | **0.08%** | Still audible under some conditions **[C]** |
| Our "Clean" setting | 0.00% | — |
| Our "Studio" setting | 0.05% | Barely there [I] |
| Our "Vintage" setting | 0.35% | Obvious, musical [I] |
| Our "Worn" setting | 1.5% | Seasick [I] |

Rates. Sources conflict, and the conflict is worth stating. A tape-emulation practitioner
source gives **wow around 3–4 Hz and flutter around 16 Hz** **[R]**. The measurement
literature places wow at the *slow* end of the spectrum (motor and reel rotation — typically
well under a few Hz) and flutter above it. I take the measurement literature as better
documented and reconcile as follows [I]: the practitioner's "3–4 Hz for wow" is almost
certainly chosen because **4 Hz is where the ear is most sensitive** **[C]** — it is a
tuning-for-effect choice, not a description of a real transport. **Spec both bands and let
the preset choose**:

| Component | Rate | Waveform | Notes |
| --- | --- | --- | --- |
| Drift | 0.05 – 0.5 Hz | filtered noise | Slow detune; excluded from weighted measurements **[C]** but audible over long tails. |
| Wow | 0.3 – 6 Hz | sine + noise | Default 1.2 Hz sine plus 30% band-limited noise. |
| Flutter | 6 – 30 Hz | sine + noise | Default 16 Hz **[R]** plus noise. |
| Scrape | 500 Hz – 3 kHz | band-passed noise | Modelled as amplitude/phase noise, not delay modulation — at these rates delay modulation would alias. Depth ≤ 0.01%. |

Sum the components as a fractional **speed** deviation `ε(t)`, not as a delay-time
deviation — that distinction is the whole of §6.2.

### 6.2 The pitch behaviour when delay time changes — derived, because it is not obvious

An interpolating delay line produces "a characteristic pitch shift, similar to how the
Doppler shift works". **[C]** The exact relation is worth deriving because it dictates the
implementation.

For `y(t) = x(t − D(t))`, the instantaneous time-warp rate is `d/dt[t − D(t)]`, so

```
        pitch ratio  =  1 − D′(t)
```

**[C, derived]** — a delay time that is *shrinking* (`D′ < 0`) shifts **up**; growing shifts
**down**. Semitones = `12·log₂(1 − D′)`.

Now the tape case, which is different and better. On a tape transport the delay is a fixed
**distance** `L` between record and playback heads, so the delay *time* satisfies

```
        ∫_{t−D(t)}^{t}  v(τ) dτ  =  L
```

Differentiating with respect to `t`:  `v(t) − v(t−D)·(1 − D′(t)) = 0`, hence

```
        1 − D′(t)  =  v(t) / v(t − D)          i.e.    pitch ratio = v(t) / v(t − D)
```

**[C, derived]** This is a much stronger statement than the naive model, and it has three
consequences that a delay-time-LFO implementation gets wrong:

1. **A constant speed error produces no pitch shift at all** — only a change in delay time.
   Record and playback are on the same transport, so a steady speed offset cancels.
2. **The pitch-modulation depth depends on the delay time.** For `v = v₀(1 + a·sin 2πft)`,
   `v(t)/v(t−D) ≈ 1 + 2a·sin(πfD)·cos(2πf(t − D/2))`. The wobble depth is
   **`2a·sin(πfD)`** — it is **zero when `f·D` is an integer** and **maximal when
   `f·D = 0.5`**, i.e. when the delay equals half the wow period. Real tape echoes do this;
   a delay-time LFO does not. It is the reason wow on a short slapback sounds different in
   kind from wow on a long echo, not just smaller.
3. It comes out **for free** if you implement the transport rather than the LFO.

**Implementation** [I]: maintain the speed signal `v[n] = 1 + ε[n]` in a small circular
buffer, and update the delay time incrementally:

```
        D[n] = D[n−1] + 1 − v[n] / v[n − round(D[n−1])]
```

reading `v` at the delayed index from that same buffer. `v` is smooth and slowly varying so
the one-sample lag in the recursion is harmless. Then read the audio buffer at `n − D[n]`
with fractional interpolation.

**Fractional interpolation choice.** Interpolation is required to avoid zipper noise when
the delay length changes **[C]**, and the artefacts of varying delay time "become noticeable
even at very small relative rates of change", including difference tones, because a
time-varying delay is not a linear operator **[C]**.

- **Linear**: cheap, but its lowpass error varies with the fractional part, so a modulated
  delay gets a modulated treble — an audible "swishing" on top of the pitch effect.
- **Allpass**: flat magnitude, but the coefficient change under modulation produces
  transients. **Do not use allpass interpolation on a modulated delay line.**
- **Spec: 4-point cubic Hermite (3rd-order Lagrange)** on all modulated reads. Linear is
  permitted only on static taps at Eco quality.

**Delay-time change mode** is therefore a user-facing character control with three settings:

| Mode | Behaviour | Implementation |
| --- | --- | --- |
| **Tape** | Pitch bends as the time changes; the classic sound. | Slew the target delay time (default 250 ms slew) and let §6.2 produce the pitch bend naturally. |
| **Digital** | No pitch bend; the delay crossfades to the new time. | 20 ms equal-power crossfade between two read pointers. |
| **Instant** | Hard jump, glitchy. | No smoothing. Documented as a glitch effect. |

### 6.3 Tape character

The physical elements worth modelling, with what the literature actually says:

- **Bias.** A **40–150 kHz** tone mixed with the audio at the record head, which keeps the
  magnetic domains "stirred" so the average response to audio is nearly linear. **[C]**
  Critically for a delay: **as bias level increases, headroom and repeat level are
  reduced.** **[C]** So Bias is a real, distinct character control — not a duplicate of
  Drive. Range 0–100%, mapped to a combined (saturation-knee, HF-loss, level) trio.
- **Saturation.** "Usually some sort of soft-clip sigmoid or double sigmoid, with possible
  cross-over distortion", plus **hysteresis** and a stochastic "quantisation" from the
  finite number of magnetic particles. **[C]** The Jiles–Atherton hysteresis approach is the
  published real-time physical model (Chowdhury et al., DAFx-2019) and is the right target
  if we want the good version; a static `tanh` is the right target if we want the cheap one.
  **Spec: static asymmetric sigmoid at Eco/Normal quality, hysteresis model at High.** [I]
  Do **not** claim tape saturation is waveshaping — it is not, because hysteresis makes the
  output depend on magnetisation history, and that dependence is what produces the
  characteristic low-frequency behaviour.
- **Repeat degradation.** "Saturation accumulates at each re-recording/replay cycle; the
  more copies, the higher the saturation." **[C]** This falls out for free from putting the
  saturator inside the loop (§3.1) — each repeat passes through it again. Do not model it
  separately.
- **Head gap loss.** The record/playback head has finite non-zero gap width, which filters
  the signal in a way that **depends on tape speed**. **[C]** The standard relation is a
  sinc: for gap width `g` and speed `v`, the recorded wavelength is `λ = v/f` and the loss
  is

  ```
        |H_gap(f)| = | sin(π·g·f/v) / (π·g·f/v) |
  ```

  with its first null at `f = v/g`. **[I, standard magnetic-recording relation — verify
  against Chowdhury before coding.]** The consequence for a delay is the interesting part:
  **on a machine that changes delay time by changing tape speed, slowing down for a longer
  delay moves the null down and darkens the repeats.** Bandwidth is coupled to delay time.
  This is the same coupling BBDs have (§6.4) and it is the single most recognisable
  "analogue delay" behaviour.
- **Tape bandwidth and alignment.** The repeats' frequency response is set by tape
  bandwidth, system filtering and head-tape alignment; **older tape has lower bandwidth and
  a warmer top end.** **[C]** Model as a one-pole lowpass in the loop with the corner tied
  to an Age control, plus a gentle high shelf.

### 6.4 BBD character

BBDs are analogue **sampled** delay lines, and the sampling is the character.

- **Structure.** `N` stages clocked at `f_clk`; a sample advances one stage per clock
  half-cycle, so

  ```
        delay = N / (2 · f_clk)
  ```

  Documented device sizes: **MN3005 = 4096 stages, giving roughly 300 ms maximum delay;
  MN3007 = 1024 stages; MN3205/MN3207 are the low-voltage versions of the 4096- and
  1024-stage parts.** **[C]** Checking the arithmetic against those numbers:
  `4096/(2·f_clk) = 0.3 s` gives `f_clk ≈ 6.8 kHz` — so at maximum delay the **effective
  sample rate is under 7 kHz and the Nyquist limit is about 3.4 kHz.** [C, computed]
- **Aliasing and the filters.** BBDs "sample the incoming signal at audio rates, which
  causes audible aliasing unless the input is sufficiently bandlimited; nearly all
  bucket-brigade circuits are preceded and followed by low-pass filters", and the rule of
  thumb given is that **the lowpass cutoff should be about 1/3 of the lowest clock speed.**
  **[C]** At 6.8 kHz clock that is a **2.3 kHz** lowpass — which is exactly why long analogue
  delays sound so dark, and it is a *derived* number, not a taste decision.
- **The bandwidth/delay-time coupling.** "The bandwidth of charge-transfer delay lines is
  proportional to the clock frequency; bandwidth is reduced as the clock frequency is
  reduced." **[C]** So, as with tape: **longer delay ⇒ darker repeats**, and the
  relationship is quantitative. Implement the anti-alias and reconstruction filters with
  cutoff `= f_clk/3` where `f_clk = N/(2·D)` for a chosen virtual stage count `N`. Expose
  `N` as a "Stages" character control (1024 / 2048 / 4096) — it directly sets how dark the
  device gets at long times.
- **Companding.** "Compander circuits typically accompany BBDs to prevent overloading and
  reduce noise, allowing a wider dynamic range at the cost of altering the signal's
  dynamics"; the common parts are **NE570, NE571, SA571.** **[C]** Model as a 2:1
  compressor before the line and a 1:2 expander after, with matched but *not identical*
  time constants — the mismatch is what produces the characteristic **breathing on the noise
  floor and transient overshoot** before the compressor settles. Model the noise floor
  explicitly (the compander exists to hide it) at around **−72 dBFS** shaped by the output
  lowpass, so the expander has something to breathe on. [I]
- **Clock whine.** Residual clock feedthrough at `f_clk`. At long delays `f_clk` is inside
  the audio band (6.8 kHz above), so this is an audible tone. Model as a very low-level
  (−78 dBFS) sine at `f_clk`, defeatable. [I]

The published modelling reference for all of the above is **Raffel & Smith, "Practical
Modeling of Bucket-Brigade Device Circuits", DAFx-10** **[C]**, extended by **Holters &
Parker, "A Combined Model for a Bucket Brigade Device and Its Input and Output Filters"
(DAFx-2018)** **[C]**. Pull both before coding §6.4; I have their conclusions but not their
coefficients.

---

## 7. Control specification

All ranges are our spec [I] unless a source is cited.

### 7.1 Global

| Control | Range | Unit | Taper | Default | Interactions |
| --- | --- | --- | --- | --- | --- |
| Mix | 0–100 | % | linear (equal-power > 50) | 30 | 0% must null exactly (V1). |
| Topology | {Dual, Ping-pong, Blend, Mono-fb} | enum | — | Dual | Sets matrix `M` (§1.2). |
| Cross | 0–100 | % | linear | 50 in Blend | `c` in `M`; 50% gives one shared feedback time **[C]**. |
| Tap count | 1–8 | — | — | **4** | 3–4 is the tape-head-emulating value **[C]**. |
| Sync | on/off | — | — | on | Selects division vs ms per tap. |
| Feedback | 0–130 | % | linear | 35 | > 100% is safe **only** with the saturator floored (§3.2). |
| Feedback source | {Tap N, Longest tap, Dedicated} | enum | — | Dedicated | "Longest tap" matches a documented variant **[C]**. |
| Loop LP | 200–20000 | Hz | log | 6000 | Must be unity-peak-gain normalised (§3.2a). |
| Loop HP | 20–2000 | Hz | log | 90 | |
| Drive | 0–100 | % → tanh drive 1–12 | linear | 20 | Floored when Feedback > 100%. |
| Character | {Clean, Tape, BBD} | enum | — | Clean | Selects §6 block. |
| Time-change mode | {Tape, Digital, Instant} | enum | — | Digital | §6.2. |
| Smear | 0–100 | % | linear | 0 | §4. **0 must null against a plain delay (V2).** |
| Ducking | 0–100 | % | linear | 0 | Input-triggered gain reduction on the wet bus. |
| Width | 0–200 | % | linear | 100 | Wet bus M/S. |
| Output trim | −24 … +24 | dB | linear in dB | 0 | |
| Quality | {Eco, Normal, High} | enum | — | Normal | §9.3. |

### 7.2 Per tap (×N)

| Control | Range | Unit | Taper | Default | Interactions |
| --- | --- | --- | --- | --- | --- |
| Time (free) | 1–8000 | ms | log | — | Clamped to buffer length (§9.2). |
| Division | 1/64 … 8/1 | note | discrete | 1/8 | ×1 / ×1.5 / ×⅔ modifier. §5. |
| Ratio (relative mode) | ×0.25 … ×8 | — | discrete | ×n | Head-spacing presets in §5. |
| Level | −∞ … +6 | dB | dB, −∞ at 0 | 0 | Does **not** set feedback (§3.2c). |
| Pan | −100 … +100 | % | linear | spread | Equal-power. |
| Pitch | −24 … +24 | semitones | discrete | 0 | Octaves/4ths/5ths are the musical set **[C]**. |
| Fine | −50 … +50 | cents | linear | 0 | |
| Filter type | {Off, LP, HP, BP} | enum | — | Off | 12 dB/oct SVF. |
| Filter cutoff | 20–20000 | Hz | log | 20000 | |
| Filter Q | 0.5–8 | — | log | 0.707 | Per-tap only; not in the loop, so no stability constraint. |
| Reverse | on/off | — | — | off | Forces grain length ≥ 30 ms (§2). |
| Mute / Solo | — | — | — | — | Crossfade 4 ms. |

---

## 8. Character artefacts worth modelling — summary

1. **Bandwidth coupled to delay time** (§6.3 head-gap, §6.4 clock rate). The most
   recognisable analogue-delay behaviour, and quantitative in both cases.
2. **Wow depth that depends on `f·D`** (§6.2) — zero at integer `f·D`, maximum at
   `f·D = 0.5`. Falls out of the transport model; impossible with a delay-time LFO.
3. **Repeat-by-repeat saturation accumulation** (§6.3), free from loop placement.
4. **Compander breathing and transient overshoot** (§6.4) — the reason a BBD delay's
   repeats have a slight "swell" on the noise floor after a transient.
5. **Clock whine** at long BBD delays (§6.4).
6. **Self-oscillation that sits at a level** rather than exploding (§3.2), which is a
   *feature* and the reason feedback goes past 100%.
7. **Difference tones under modulation.** A time-varying delay is non-linear, so non-periodic
   input produces difference tones even with perfectly smooth time changes. **[C]** Do not
   try to remove these; they are the sound.

---

## 9. CPU, memory and verification

### 9.1 CPU cost model

Budget as before: **12 instances, phone, 256-sample buffer, 48 kHz**; allocate **~4% of a
core per instance**.

Per sample, stereo, `T` taps, `G` grains per tap:

| Item | Flops |
| --- | --- |
| Buffer write ×2 | 4 |
| Per grain: read advance + cubic Hermite + window + pan-accumulate (FX-02 §7.1) | **24 × T × G** |
| Per tap: SVF filter ×2 ch | 30 × T |
| Wow/flutter transport recursion (§6.2) | 12 |
| Feedback chain: DC block, loop LP, loop HP, tanh, matrix, ×fb (×2 ch) | 60 |
| Character block — Tape (sigmoid + gap-loss LPF + shelf) ×2 | 40 |
| Character block — BBD (2 LPFs + compander + expander + noise) ×2 | 110 |
| Mix, width, trim | 14 |

Worked cases:

| Setting | `T` | `G` | flops/sample | Mflop/s @48k | ×12 |
| --- | --- | --- | --- | --- | --- |
| Clean, 4 taps, Smear 0 | 4 | 1 | 306 | 14.7 | 176 Mflop/s |
| **Default: Tape, 4 taps, Smear 0** | 4 | 1 | 346 | 16.6 | **199 Mflop/s** |
| BBD, 4 taps, Smear 0 | 4 | 1 | 416 | 20.0 | 240 Mflop/s |
| Tape, 4 taps, Smear 50% | 4 | 8 | 1 042 | 50.0 | 600 Mflop/s |
| Tape, 8 taps, Smear 100% | 8 | 32 | 6 550 | 314 | **3.8 Gflop/s** |

The last row is out of budget on a phone. As in FX-02, the fix is the Quality tier, and the
cap must be applied by **reducing `G`, never by dropping grains mid-flight**.

### 9.2 Memory

The delay buffer is the whole story.

```
    bufferSeconds = clamp( 1.25 × longestConfiguredTapTime , 0.5 s , 8 s )
```

Allocate to the **configured** maximum, not the theoretical one — a user with a 250 ms
slapback should not pay for 8 seconds. Reallocate off the audio thread on a tempo or time
change, with the old buffer kept alive until the crossfade completes.

| Case | Stereo float32 |
| --- | --- |
| 0.5 s minimum | 192 KB |
| 2 s typical | 768 KB |
| 8 s maximum | **3.07 MB** |
| 12 instances at 2 s | 9.2 MB |
| 12 instances at 8 s | **37 MB** — allowed but flagged to the host |

Plus per instance: grain pool 256 × 64 B = 16 KB; per-tap filter state < 1 KB; speed-history
buffer for §6.2 (needs `maxDelay` samples of `float32` — **another 1.5 MB at 8 s**, so store
it decimated by 64 and interpolate, reducing it to 24 KB; `v` is band-limited to 30 Hz so
decimation is lossless here). Window tables are shared with FX-02.

### 9.3 Quality tiers

| Tier | Interpolation | Max `T × G` | Tape model | BBD model |
| --- | --- | --- | --- | --- |
| Eco | linear (static taps), Hermite (modulated) | 8 | static sigmoid | filters + compander, no clock whine |
| Normal | cubic Hermite | 32 | static sigmoid | full |
| High | cubic Hermite + anti-alias on pitched reads | 128 | hysteresis model | full + oversampled compander |

### 9.4 Verification — measurements QA must run

| ID | Measurement | Method | Target | Tolerance |
| --- | --- | --- | --- | --- |
| V1 | **Dry null.** Mix = 0%. | Null against input, 60 s pink noise + drums. | ≤ **−140 dBFS** residual. | None. |
| V2 | **Smear-zero null.** Smear = 0, Character = Clean, Feedback = 0, 1 tap at 500 ms, Time-change = Digital. | Null against a reference plain interpolated delay at the same time. | ≤ **−140 dBFS** residual. | None. This proves the granular path collapses exactly to a plain tap (§4). |
| V3 | **Delay-time accuracy.** Each division from 1/64 to 8/1, each modifier, at 60/120/174 BPM. | Impulse in, measure the sample index of the peak. | **0 samples** error. | ±1 sample (fractional-interpolation peak location only). |
| V4 | **Feedback stability sweep.** Feedback 0→130% in 1% steps, all topologies, Cross 0→100%, loop filter Q at max, 60 s each with programme then silence. | Peak and RMS of the loop signal. | With `fb ≤ 100%`: RMS decays after input stops. With `fb > 100%`: RMS converges to a **bounded** value and peak stays **≤ −0.1 dBFS**. **No NaN or inf ever.** | None. Tests §3.2 (a) and (b). Explicitly include self-fb 0.8 + cross-fb 0.8 as a named case. |
| V5 | **DC accumulation.** +0.5 DC in, Feedback 95%, 120 s. | Output DC. | ≤ **−80 dBFS**. | +3 dB. |
| V6 | **Smear level and decay independence.** Fixed Feedback 60%; sweep Smear 0→100%. | Wet-bus RMS on steady pink noise; and RT60 of the repeat train. | RMS varies ≤ **1.0 dB**; repeat-train decay time varies ≤ **5%**. | As stated. Failure = FX-02 §1.3 normalisation missing or outside the loop. |
| V7 | **Click on delay-time change.** Time-change mode = Digital; step the delay time between every pair of divisions, 500 times, over a 1 kHz sine. | Per-sample first difference; flag any sample exceeding the un-modulated sine's max `\|Δy\|` by > 12 dB. | **Zero flagged samples.** | Zero. |
| V8 | **Pitch bend on time change.** Time-change mode = Tape; ramp delay from 500 ms to 250 ms over 1 s, with a 1 kHz sine. | Track the instantaneous output frequency. | Matches `1000 · (1 − D′(t))` (§6.2). | **±2 cents.** |
| V9 | **Wow/flutter depth calibration.** Character = Tape, each depth preset. | 3.15 kHz test tone **[C]**; demodulate the instantaneous frequency; apply the **CCIR/IEC 386 weighting (4 Hz peak, 6 dB/oct skirts)** **[C]**; report WRMS %. | Measured WRMS within **±15%** of the preset's nominal (0.05 / 0.35 / 1.5%). | ±15%. Reporting in the standard unit is what makes this comparable to real machines. |
| V10 | **Wow-depth vs delay time.** Wow at 1 Hz, fixed depth; sweep delay time 0.1 s → 2.0 s. | Measure pitch-deviation amplitude at each. | Follows **`2a·sin(πfD)`** — nulls at `D = 1.0 s` and `2.0 s`, maximum at `D = 0.5 s` and `1.5 s`. | ±10% of the predicted curve. This is the test that the transport model (§6.2) was implemented and not a delay-time LFO. |
| V11 | **BBD bandwidth coupling.** Character = BBD, Stages = 4096; delay 50 ms, 150 ms, 300 ms. | Measure the −3 dB point of the wet path. | Tracks `f_clk/3` where `f_clk = N/(2D)` — i.e. ≈ 13.7 kHz, 4.6 kHz, **2.3 kHz**. | ±15%. |
| V12 | **BBD alias floor.** Character = BBD, 300 ms, 5 kHz sine at −6 dBFS. | FFT the wet path. | Alias products ≤ **−60 dBFS**. | +3 dB. The input filter must be doing its job before the sampled line. |
| V13 | **Ping-pong symmetry.** Ping-pong topology, mono input, Cross 100%. | Compare L and R repeat trains. | Repeats alternate exactly; L at odd taps and R at even taps match to **≤ 0.1 dB** and **0 samples**. | As stated. |
| V14 | **Grain accounting.** As FX-02 V8, per tap. | Count spawned / rendered / dropped over 60 s at Smear = 25/50/75/100%. | Spawn rate within **±1%** of predicted; **dropped = 0**. | 1%; zero drops. |
| V15 | **CPU linearity in `T×G`.** Profile at `T×G` = 4, 8, 16, 32, 64, 128. | Per-block time. | Linear fit, **R² ≥ 0.98**. | As stated. |
| V16 | **Allocation on the audio thread.** Run a 10-minute session automating every control including tap count, division, tempo and Character. | Instrument `malloc`/`free` on the audio thread. | **Zero** allocations. | Zero. |

---

## 10. Sources

Delay topology and behaviour:

- [Sound On Sound — Using Your Plug-in Delay Effects](https://www.soundonsound.com/techniques/using-your-plugin-delay-effects) — multi-tap definition, 3–4 taps emulating multi-head tape echoes
- [Sound On Sound — Reason: Delaying Tactics](https://www.soundonsound.com/techniques/reason-delaying-tactics) — feedback-routing variants (shared, cross, twin, mono-summed, disintegrating, longest-tap)
- [Audient — Delay Types Explained](https://audient.com/tutorial/delay-types-explained/) — ping-pong topology, cross-feed at 50%
- [Sound On Sound — Understanding Granular Delay](https://www.soundonsound.com/techniques/understanding-granular-delay) — buffer→grains, grain lengths, per-grain pitch/reverse/stretch/reorder, per-grain level and pan, musical intervals
- [Sound On Sound — Soundghost Scatter review](https://www.soundonsound.com/reviews/soundghost-scatter) — 64 grains, randomised positions, 1 s buffer, stereo smear [R]
- [Sound On Sound — Ableton Live: Grain Delay](https://www.soundonsound.com/techniques/ableton-live-grain-delay)
- [Gearspace — limiting an intended feedback loop (dub)](https://gearspace.com/board/so-much-gear-so-little-time/1140353-limiting-intented-feedback-loop-dub.html) — limiter/tanh in the loop and progressive distortion with repeats [R]

Delay-line interpolation and time-varying delay:

- [Julius O. Smith, *Physical Audio Signal Processing* — Delay-Line and Signal Interpolation](https://www.dsprelated.com/freebooks/pasp/Delay_Line_Signal_Interpolation.html)
- [Miller Puckette, *Theory and Technique of Electronic Music* — Variable and fractional shifts](https://msp.ucsd.edu/techniques/v0.11/book-html/node113.html) — artefacts of varying delay time, non-linearity, difference tones
- [Miller Puckette — Pitch shifting](https://msp.ucsd.edu/techniques/latest/book-html/node115.html)
- [*Fractionally addressed delay lines* (IEEE TSAP)](https://www.researchgate.net/publication/3333741_Fractionally_addressed_delay_lines)
- [New Music USA — Delays, Feedback, and Filters](https://newmusicusa.org/nmbx/delays-feedback-and-filters-a-trifecta/) — the Doppler-like pitch shift of interpolating delays

Wow, flutter and measurement:

- [Wikipedia — Wow and flutter measurement](https://en.wikipedia.org/wiki/Wow_and_flutter_measurement) — wow from motor/belt, flutter from capstan/pinch roller; four weighting curves; drift and scrape suppressed by weighting
- [Lindos Electronics — Wow and Flutter Measurement](https://lindos.co.uk/articles/wow-and-flutter-measurement) — 4 Hz perceptual peak, CCIR curve with 6 dB/oct skirts, 3.15 kHz test tone, IEC 386 / DIN 45507, WRMS vs peak-to-peak conventions, 0.02% professional / 0.08% cassette audibility figures
- [Virtins — Wow and Flutter Measurement using Multi-Instrument (PDF)](https://www.virtins.com/doc/Wow-and-Flutter-Measurement-using-Multi-Instrument.pdf)
- [Brüel & Kjær Wow and Flutter Meter 6203 manual (PDF)](https://www.technicalaudio.com/pdf/Bruel&Kjaer/Bruel&Kjaer_Wow_Flutter_Meter_6203.pdf)
- [Fractal Audio Wiki — Delay block](https://wiki.fractalaudio.com/wiki/index.php?title=Delay_block) — practitioner wow ≈ 3–4 Hz, flutter ≈ 16 Hz [R]

Tape:

- [Chowdhury et al., *Real-time Physical Modelling for Analog Tape Machines*, DAFx-2019 (PDF)](https://ccrma.stanford.edu/~jatin/420/tape/TapeModel_DAFx.pdf) — the physical-model reference; hysteresis, head geometry
- [KVR — Tape emulation explained?](https://www.kvraudio.com/forum/viewtopic.php?t=499395) — bias 40–150 kHz, bias raising reduces headroom and repeat level; sigmoid/double-sigmoid saturation; hysteresis and particle quantisation; finite head size filtering dependent on speed; per-generation saturation accumulation
- [Tonalux — Why Tape Saturation Is Not Waveshaping](https://tonalux.org/blog/tape-saturation-hysteresis-magnetic-memory) — history dependence [R]
- [Strymon dTape technology white paper](https://www.strymon.net/strymon-dtape-technology-white-paper/) [R]
- [Wikipedia — Roland Space Echo](https://en.wikipedia.org/wiki/Roland_Space_Echo) — free-running transport reducing wow and flutter

BBD:

- [Raffel & Smith, *Practical Modeling of Bucket-Brigade Device Circuits*, DAFx-10 (PDF)](https://dafx10.iem.at/proceedings/papers/RaffelSmith_DAFx10_P42.pdf) — the modelling reference; companding, pre/post lowpass, aliasing
- [Holters & Parker, *A Combined Model for a Bucket Brigade Device and Its Input and Output Filters*, DAFx-2018 (PDF)](https://www.hsu-hh.de/ant/wp-content/uploads/sites/699/2018/09/Holters-Parker-2018-A-Combined-Model-for-a-Bucket-Brigade-Device-and-its-Input-and-Output-Filters.pdf)
- [EffDub Audio — How BBDs Work in Analog Delay Pedals](https://effdubaudio.com/how-bbds-work/) — MN3005 = 4096 stages ≈ 300 ms; MN3007/MN3205/MN3207; NE570/571/SA571 companders; lowpass at 1/3 of the lowest clock; bandwidth proportional to clock frequency
- [General Guitar Gadgets — PT-80 technical info (PDF)](https://generalguitargadgets.com/wp-content/uploads/pt80techinfo.pdf) — pre/post filtering practice

---

## 11. What I could not confirm

1. **Head-gap-loss sinc formula (§6.3).** I have the qualitative statement from a reachable
   source ("finite non-zero head size introduces filtering depending on tape speed" **[C]**)
   but the `sinc(π·g·f/v)` form and typical gap widths are from standard magnetic-recording
   theory and were **not** confirmed against a reachable source. Verify against Chowdhury
   et al. before coding, and get a real gap width from it.
2. **Wow and flutter rates for specific machines.** The 3–4 Hz / 16 Hz figures are from a
   practitioner forum **[R]** and conflict with the measurement literature's placement of
   wow at slower rates. §6.1 states the conflict and picks a spread rather than a point.
   No source I could reach gives measured spectra for a specific tape echo.
3. **BBD compander time constants.** The parts are named **[C]**; the actual attack/release
   values are in the Raffel & Smith and Holters & Parker papers, which I could not fetch.
   The 2:1 / 1:2 ratios are standard for those parts but are **[U]** as stated here.
4. **BBD noise-floor level and clock-feedthrough level.** My −72 dBFS and −78 dBFS are
   engineering placeholders [I], not measurements.
5. **Whether `fb` above 100% is safe with the *hysteresis* tape model.** §3.2's fixed-point
   argument assumes a memoryless compressive nonlinearity. A hysteresis model has memory and
   the fixed-point argument does not straightforwardly apply. **Until someone proves
   otherwise, cap `fb` at 100% when the High-quality hysteresis tape model is active.** [I]
6. **Real phone throughput.** As in FX-01 and FX-02, every Mflop/s figure is an operation
   count, not a measurement, and rests on an assumed 2–8 Gflop/s scalar core **[U]**.
7. **Whether 8 taps × 32 grains is a configuration anyone wants.** It is specified because
   the control ranges permit it, and §9.3 caps it. If product decides nobody needs it, the
   cap can become a hard limit and the buffers shrink accordingly.
