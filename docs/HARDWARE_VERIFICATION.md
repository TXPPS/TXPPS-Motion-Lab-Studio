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
