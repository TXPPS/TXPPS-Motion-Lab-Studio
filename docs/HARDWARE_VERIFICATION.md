# Hardware verification — the device-pass punch list

Directive 04 §5. This environment has no audio device, no real-time thread and
no thermal or battery instrumentation (ADR-0005), so some Definition-of-Done
cells cannot be settled here at all. Every one of them is listed below **with
the procedure to settle it**, written when the cell was blocked rather than
reconstructed afterwards — a punch list assembled at the end is a punch list
that has forgotten why half its entries are on it.

Two rules this file exists to enforce:

- A blocked cell is never marked PASS on the strength of reasoning. Where a
  structural proof or a direct measurement substitutes for a render-based test,
  the substitution is named here and the cell says which one it stands in for.
- The measurement lessons from the probe failures apply on hardware too:
  **measure a device in its linear regime**, and **let parameter ramps settle
  before measuring**. Both produced findings that looked like product defects
  and were the probe.

---

## Motion Shaper (`fx-01`)

### V10 — denormal stall

**Blocked by:** no trustworthy per-block timing. This host is a shared container
without a real-time thread, so block times vary by more than the 1.2× ratio the
test is trying to detect; asserting it here would produce a number that fails
randomly and teaches nothing.

**Procedure.** Three bands, eight slots, on a physical device at each tier.
Feed 30 s of programme material, then 30 s of digital silence. Log per-block
processing time throughout. The silence-period mean block time must be **≤ 1.2×**
the programme-period mean.

**What a failure means.** Flush-to-zero is not set on that platform, or filter
state is not being flushed. `core/dsp/biquad.h` flushes explicitly at 1e-30
rather than relying on a compiler flag, because the tests are deliberately built
without `-ffast-math`; a failure here means some other state — a smoother, a
grain envelope — is decaying into the denormal range unguarded.

**Devices that matter most.** ARM configurations, where the cost is a large
multiple rather than a small one.

### Cell 21 — 60 fps sustained, decoupled from the audio thread

**Blocked by:** no display and no compositor. Frame pacing cannot be measured
where nothing is being presented.

**Procedure.** Twelve instances, phone tier, 256-sample buffer. Record frame
times for 60 s while sweeping Depth and Rate on every instance. Require the
99th-percentile frame time under 16.7 ms, and — the part that matters more —
require **zero** change in audio-thread block time between the visualiser
running and being hidden. The second measurement is what proves decoupling; the
first only proves the UI is fast enough today.

### Cell 22 — responsive matrix and touch targets

**Blocked by:** no device viewport. Headless geometry answers layout questions
but not whether a 44 pt target is reachable with a thumb on a moving train.

**Procedure.** The nineteen-cell matrix from `docs/audit/RESPONSIVE_AUDIT.md`,
on real devices, plus the five cells that audit itself had to mark BLOCKED:
notch and home-indicator insets, the home-indicator gesture against the bottom
nav, the software keyboard, rotation mid-gesture, and momentum-scroll hand-off.

### U21 — 60 fps sustained, decoupled (Motion Shaper)

**Blocked by:** `no displayRefresh — needs a display and a requestAnimationFrame
clock`. Frame pacing needs two clocks this host does not have: a refresh to
count against, and an audio thread to be decoupled _from_.

**Half of it is already proven natively.** The decoupling property — that the
face costs the audio thread nothing — is asserted in
`motion_shaper_tests.cpp` under the RT guard, and the publish path is a seqlock
whose writer never waits for a reader. What remains for hardware is the frame
_rate_, which is a property of the drawing and not of the engine.

**Procedure.** Twelve instances, phone tier, 256-sample buffer. Record frame
times for 60 s while sweeping Depth and Rate on every instance and dragging a
curve node. Require the 99th-percentile frame time under 16.7 ms, and — the
measurement that matters more — **zero** change in audio-thread block time
between the visualiser running and being hidden.

### U22 — responsive matrix (Motion Shaper)

**Blocked by:** `no layoutEngine — needs a browser that computes layout; jsdom
reports every box as zero`.

**Procedure.** The nineteen-cell matrix from `docs/audit/RESPONSIVE_AUDIT.md`,
plus the face's own declared breakpoints at 30 em and 48 em, exercised at root
font sizes of 100 %, 130 % and 200 %. The breakpoints are in `em` precisely so
that the third of those reflows; a px breakpoint would not, which is
MotionLab's RA-007 one layer up.

Also verify the curve editor's minimum height on a real device:
`minimumEditorHeightPx(true, inset)` returns 68 px for a 12 px inset, and below
that the top and bottom of the value range become the same touch target.

---

## Granular Reverb (`fx-02`) and Granular Delay (`fx-03`)

### V7 — echo density, where the ear is the final instrument

Normalised echo density (Abel and Huang) is measured offline and the number is
trustworthy: the measure is calibrated against signals whose answer is known —
Gaussian noise reads 0.995, a sparse impulse train 0.000, a decaying Gaussian
tail 1.011 crossing 0.9 at 10 ms. What the number cannot settle is the thing the
row is actually about.

**A tail that is not dense enough does not sound quiet or thin. It sounds like
flutter on transients** — a fast, grainy stutter on the attack of a snare or a
close-miked acoustic guitar, most obvious on dry percussive material and almost
inaudible on sustained pads. That is a judgement about audibility, and 0.9 at
80 ms is the literature's threshold rather than a measurement of *our* tail; a
reverb can be at 70 ms and still flutter on the wrong source, or at 95 ms and be
clean on every source anyone plays through it.

So this row's offline number is a gate, not a verdict, and the listening check is
what closes it.

**Procedure.** On a device, through monitors and again through headphones:

1. A dry snare hit, single, at 90 bpm with eight bars of silence after it. Decay
   at 2 s, Mix at 100 %, Damping at 0. Listen to the first 200 ms of the tail
   for a stutter or a pitched buzz at the grain rate. Repeat at Density 100, 350
   and 1500 g/s — the artefact, if present, moves with density and is worst at
   the sparse end.
2. The same, with a close-miked acoustic guitar chord, which is the hardest
   case: broadband, transient, and with enough sustain that a fluttering tail
   beats against the source.
3. On `fx-03`, the same two sources at Smear 25 % and 50 %, where the grains are
   long enough to be heard as separate events if the diffusion is not carrying
   them.
4. A/B against the diffusion disabled, which is the control. If the fluttering
   version cannot be told from the diffuse one, the offline number is measuring
   something inaudible and the tolerance is too tight rather than the unit too
   sparse — record that, do not tighten the unit.

**Pass.** No audible flutter or stutter on the first 200 ms of any of the above,
on either transducer, at any density.

**Why it cannot run here.** No transducer of any kind, and the artefact is
defined by audibility rather than by a threshold. Both units' offline rows are
green at the architecture level (the shared `DiffusionTank` reaches 0.9 at 65 ms
on its own), so what is left is exactly the part the ear decides.

---

## All units — the checks that need a device by their nature

| Cell                      | Why it cannot run here                                                                                                                                                                                                                       | Procedure                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 5, aliasing at full drive | Measured from the curve rather than from a rendered spectrum where oversampling is the platform's. In the C++ core the oversampler is ours, so this is measurable offline — but the _result_ still needs confirming against a real converter | FFT the render at full drive, identify content not at k·f₀, require the stated dBc |
| 21, 60 fps                | No display                                                                                                                                                                                                                                   | As above, per unit                                                                 |
| 22, responsive            | No viewport                                                                                                                                                                                                                                  | As above, per unit                                                                 |
| CPU budgets               | No representative silicon; a shared container's timings are not a phone's                                                                                                                                                                    | Per tier, twelve instances, 256-sample buffer, measure percentage of one core      |
| Thermal and battery       | No instrumentation of any kind                                                                                                                                                                                                               | Sustained 30-minute render at Max tier, log thermal state and drain                |

---

## Substitutions in force

Where a cell is answered by something other than the test its sheet names, the
substitution is recorded here so nobody later mistakes it for the real thing.

| Cell                           | Named test          | What stands in                                                     | Why it is honest                                                                |
| ------------------------------ | ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 4, bypass null to −120 dBFS    | Render and null     | **Nothing — this one runs.** Measured −200.0 dBFS on Motion Shaper | The offline renderer is real audio; no device is needed to subtract two buffers |
| 8, latency declared = measured | Render an impulse   | **Nothing — this one runs.** Measured at 0, 1, 64 and 333 samples  | Same reason                                                                     |
| 7, block-size invariance       | Render at six sizes | **Nothing — this one runs.** Bit-identical                         | Same reason                                                                     |

The pattern worth noting: most cells thought to need hardware do not. What
genuinely needs a device is timing, display and heat — not audio correctness.
