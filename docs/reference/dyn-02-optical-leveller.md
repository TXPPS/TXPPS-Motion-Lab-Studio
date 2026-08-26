# DYN-02 — Optical Levelling Amplifier

**Reference Spec Sheet — Motion Wave Research, internal only.**

Reference hardware studied: Teletronix LA-2A levelling amplifier and its later Universal
Audio-published documentation. **The manufacturer and model names in this document exist only in
these research notes.** They must not appear in shipped UI strings, class or file names, preset
names, parameter identifiers, or marketing copy. No panel artwork, logo, typeface or badge has been
described here or may be traced; the era's design language — large VU meter, two large control knobs,
a small mode toggle, a metering selector — is general to early-1960s American broadcast outboard and
is fair to evoke.

Sources are published manuals, manufacturer specifications, component data and published circuit
discussion. Nothing here derives from disassembling or extracting assets from any commercial product.

---

## 1. What this unit is

A valve gain stage whose input is attenuated by a light-dependent resistor, with the light supplied
by an electroluminescent panel driven from the unit's own **output**. It is a feedback compressor:
the sidechain picks the signal up after the gain-reduction element, so the detector sees the result
of its own action and self-corrects. That single fact explains most of the unit's behaviour — the
soft knee, the ratio that refuses to be a number, and the stability of the gain reduction under
widely varying input levels.

There is no attack control, no release control, no ratio control and no threshold control. There are
two knobs and a switch. Everything a modern compressor exposes as a parameter is, here, a property of
a cadmium sulphide photocell.

## 2. Signal path block diagram

```
   balanced in  --> [ INPUT TRANSFORMER ]
                             |
                    +--------v---------+
                    |  T4B ATTENUATOR  |   photocell in a shunt/series
                    |  (photocell R)   |   attenuator ahead of the amp
                    +--------+---------+
                             |
                    [ 12AX7 VOLTAGE AMP ]
                             |
                    [ 12BH7 CATHODE FOLLOWER ]
                             |
                    [ OUTPUT TRANSFORMER ] --> balanced out, 600 R
                             |
                             +------------------+
                                                |   FEEDBACK: sidechain
                                                |   taps the OUTPUT
                                  +-------------v--------------+
                                  |  PEAK REDUCTION control    |
                                  |  (sets sidechain drive)    |
                                  +-------------+--------------+
                                                |
                                  [ R37 PRE-EMPHASIS FILTER ]
                                                |
                                  [ 12AX7 SIDECHAIN VOLTAGE AMP ]
                                                |
                                  [ 6AQ5 EL PANEL DRIVER ]  ~90 VAC pk
                                                |
                            +-------------------v-------------------+
                            |  T4B: ELECTROLUMINESCENT PANEL        |
                            |    illuminates BOTH cells             |
                            |    cell 1 -> gain reduction (above)   |
                            |    cell 2 -> GR metering              |
                            +---------------------------------------+
```

Only the 12AX7 and 12BH7 on the audio side are in the signal path. The second 12AX7 and the 6AQ5 are
sidechain only, and swapping them changes the _dynamics_, not the tone. **Implementer rule: the
sidechain's own distortion is inside the feedback loop and therefore partially corrected; do not give
it the same weight as audio-path distortion.** The 6AQ5 driving the panel does add distortion to the
control signal, and enclosing it in the loop is what makes the arrangement behave.

## 3. Controls

### 3.1 PEAK REDUCTION

Continuous rotary, panel scale 0 to 100. **The numbers are arbitrary and correspond to no dB value**
— this is stated outright in the published manual. It sets how hard the sidechain drives the EL panel,
which is functionally a threshold control, but because the loop is a feedback loop it behaves as a
combined threshold-and-ratio control: turning it up lowers the effective threshold _and_ steepens the
effective curve. Default 0 (no reduction). Taper is **unknown**; treat the 0–100 scale as a
dimensionless control and calibrate its mapping to gain reduction empirically.

### 3.2 GAIN

Continuous rotary, make-up gain, up to 40 dB of output level. Post-gain-reduction; it does not
interact with the detector because the detector taps the output _before_ — see the caveat below.
Default set for unity.

**Interaction caveat, unresolved.** In a feedback design the point at which the sidechain taps
matters enormously: if it tapped after the make-up gain control, then GAIN would change the amount of
compression, which is not the reported behaviour of this unit. The published guidance is to set PEAK
REDUCTION first and then GAIN, which is consistent with GAIN being outside the loop. **Marked as
inference:** model GAIN as outside the detector path, and note the assumption in the code.

### 3.3 COMPRESS / LIMIT switch

Two positions. Nominal published behaviour is approximately **3:1 in COMPRESS** and approximately
**∞:1 in LIMIT**. Both figures are nominal. The compression ratio is nonlinear and frequency
dependent, so neither figure is absolute, and measured behaviour in LIMIT is reported as closer to
**10:1 to 20:1** than to infinity.

The two positions differ in knee as well as slope. COMPRESS has a very soft knee: compression does
not begin abruptly at a threshold, the effective ratio increases gradually with level. LIMIT raises
the ratio and hardens the knee. Default COMPRESS.

**Implementer rule:** do not implement this as a ratio parameter. Implement it as a change in the
sidechain's gain and rectification law, and let the ratio emerge from the loop. A ratio number
computed from a static curve will be right at one gain-reduction depth and wrong at all others.

### 3.4 METER selector

Three positions: GAIN REDUCTION, +4, +10. In GAIN REDUCTION the VU meter reads compression depth in
dB. In +4 or +10 it reads output level, calibrated so that 0 VU corresponds to +4 dBm or +10 dBm at
the amplifier output respectively. The meter's own ballistics are standard VU; the GR reading is
driven by the second photocell in the T4B, not by a separate detector, so **the meter shows what the
second cell sees, and the second cell has the same lag and memory as the first.** That is why the
meter appears to under-read fast transients.

### 3.5 R37, sidechain pre-emphasis (internal on the hardware)

A rear/internal potentiometer, factory set fully clockwise for a flat sidechain response. Turning it
counter-clockwise progressively rolls the low frequencies out of the detector path, making the
compressor increasingly sensitive to high frequencies. Published descriptions of its magnitude differ:
one gives up to about 10 dB of low-frequency attenuation with the emphasis taking effect above about
1 kHz; another gives up to 17 dB of boost at 15 kHz. These describe the same filter from opposite
ends, and neither is precise enough to build from without measurement. **Treat the exact curve as
unknown**; expose a normalised 0–100 control and target "flat at one end, roughly first-order
high-emphasis with a corner in the low kHz at the other".

Default: flat. Motion Wave should expose this on the panel, as most modern equivalents do, but should
default it to flat so the unit's baseline behaviour matches the hardware as shipped.

### 3.6 R3, stereo balance adjust

A calibration trim on dual-channel units, not a user control. Out of scope for a mono model.

## 4. Time constants — the core of this unit

The photocell is the entire dynamics engine and it is not a first-order system.

**Attack: 10 ms**, per the manufacturer's specification. This is a single figure and it is not
adjustable. It is slow enough that fast transients pass through substantially unattenuated, which is
why the unit sounds gentle on percussive material and why it does not work as a peak limiter.

**Release: two-stage, program dependent.** The original manufacturer specification states 0.06 s for
50 % of the release, with 0.5 to 5 s for the remainder. Later and widely repeated descriptions give
the first 50 % at about 60 ms and the remaining 50 % spread over 1 to 15 s. The 60 ms first stage is
agreed by every source. The second stage's range is where they disagree — see §10.

**The implementer's rule.** Model the cell's conductance, not the gain in dB, and give it two
relaxation branches plus a state variable representing exposure history:

1. Attack: single first-order rise with τ chosen so that the 10 % to 90 % gain-reduction time is
   10 ms.
2. Release stage one: first-order decay with τ ≈ 60 ms, which recovers approximately the first half
   of the applied gain reduction.
3. Release stage two: first-order decay with a τ that is **not constant**. It is a function of an
   exposure-history state variable `E`, which integrates the applied gain reduction over time with a
   long time constant of its own (order of seconds).
4. Map `E` to stage-two τ monotonically: a brief, shallow reduction gives τ near the short end of the
   published range; sustained deep reduction gives τ near the long end. Using the original
   specification's range this is τ2 ∈ [0.5 s, 5 s]; using the later range it is [1 s, 15 s].
   **This sheet takes the original specification's 0.5–5 s as the primary target and treats 1–15 s as
   the outer envelope that a heavily-exercised cell may reach.** Reasoning in §10.
5. `E` must decay slowly when the unit is idle, so that a unit which has been resting recovers faster
   than one that has been working. This is the "memory" that sources describe: a cell that has been
   saturated with light recovers more slowly, and prolonged compression lengthens the release curve.

**Consequences the model must produce.** Release is not a fixed number and must never be exposed as
one. Two identical transients arriving after different histories must recover at different rates.
Programme with dense, sustained energy will show progressively longer recovery over the first several
seconds of processing, then settle.

## 5. Filter topology and the shape of the gain curve

There is no user filter. There are two frequency-dependent elements:

- **The sidechain pre-emphasis network (R37)** — see §3.5. First-order high-emphasis, corner in the
  low kHz at the extreme setting, flat as shipped.
- **The photocell's own frequency dependence.** The published specification for the compression ratio
  says explicitly that it is frequency dependent as well as nonlinear. The audio-path frequency
  response is specified as ±0.1 dB from 30 Hz to 15 kHz, so the frequency dependence is in the
  _dynamics_, not in the steady-state response.

The static gain-reduction curve is a soft, continuously curving function with no corner. It is
generated by the loop, not by a knee equation. In COMPRESS the curve's local slope approaches about
3:1 at moderate reduction; in LIMIT it steepens toward 10:1–20:1. **The departure from an ideal
compressor is that there is no threshold at all** — the local ratio is a continuous function of level
and of how long that level has been present. Any implementation that computes `if (level > threshold)`
has already diverged from the reference.

## 6. Nonlinearity sources, located in the path

1. **Input transformer.** Low-frequency, level-dependent, third-harmonic dominant, from hysteresis at
   low levels and saturation at high levels (Whitlock, Jensen). Frequency-inverse: it is a bass effect.
2. **The photocell attenuator itself.** A CdS cell's resistance is a nonlinear function of
   illumination and its resistance is also weakly signal-dependent at high signal voltages across it.
   The T4B is documented as using Clairex CL-505L cadmium sulphide cells. **Marked as inference:**
   the second-order signal dependence of the cell is small compared to the valve stage; model it as
   a mild static nonlinearity and revisit only if listening tests demand.
3. **12AX7 voltage amplifier, single-ended.** The dominant tone-shaping nonlinearity. Single-ended
   triode stages produce rising, predominantly **second-harmonic** distortion as level increases.
4. **12BH7 cathode follower.** Low distortion by topology; contributes mainly at extreme levels.
   **Marked as inference.**
5. **Output transformer.** Same mechanisms as the input transformer, at higher level, so it dominates
   the low-frequency harmonic contribution.
6. **The sidechain, inside the loop.** The 6AQ5 driving the EL panel distorts the control voltage.
   This does not add harmonics to the audio directly; it modulates the gain-reduction law, so its
   audible effect is on the _shape of the curve_, not on the spectrum. The feedback loop partially
   linearises it. Model it as a static nonlinearity applied to the control signal before the cell.
7. **The EL panel's response to drive** is itself nonlinear and its light output falls as the panel
   ages, which is why a worn cell compresses less for a given PEAK REDUCTION setting.

## 7. Character artefacts a user notices

- **Transients get through.** With a 10 ms attack, the leading edge of a snare or a consonant is not
  caught. The unit levels; it does not limit.
- **Release that "breathes" with the music** rather than pumping at a fixed rate. Dense passages
  recover slowly, sparse ones quickly.
- **Meter lag.** The GR meter is driven by a photocell with the same lag as the audio cell, so it
  under-reads short events. QA must not compare the model's meter against an instantaneous
  gain-reduction calculation.
- **Ageing and unit-to-unit variation.** EL phosphor degrades through copper ion migration within the
  crystals, and audio-rate operation accelerates that decline more than 50/60 Hz operation does.
  Published failure symptoms of a worn cell are slow recovery, low dark resistance and high light
  resistance. This is the physical basis for a "cell wear" or "vintage" control if Motion Wave wants
  one, and it should be an explicit parameter rather than baked in.
- **Noise floor** specified at 75 dB below +10 dBm — audibly higher than the program EQ of DYN-01.
- **Harmonic profile** second-harmonic dominant from the 12AX7 at moderate drive, with third-harmonic
  transformer content below roughly 100 Hz.

Photocell dark and light resistance figures were not found in a citable published source.
**Unknown** — the DSP team should obtain the CL-505L data sheet before fixing the attenuator's range.

## 8. Published measurements

From the manufacturer's specification for the reference unit (Library of Congress-hosted manual scan
and Universal Audio's reproduction of it).

| Quantity                 | Value                                     | Conditions                              |
| ------------------------ | ----------------------------------------- | --------------------------------------- |
| Gain                     | 40 ±1 dB                                  |                                         |
| Gain reduction available | up to 40 dB                               |                                         |
| Frequency response       | ±0.1 dB, 30 Hz to 15 kHz                  |                                         |
| Distortion               | < 0.35 % THD                              | +10 dBm output                          |
| Distortion               | < 0.75 % THD                              | +16 dBm output                          |
| Noise                    | 75 dB below +10 dBm output                |                                         |
| Maximum input            | +16 dBm                                   |                                         |
| Output level             | +10 dBm nominal, +16 dBm peaks            |                                         |
| Attack                   | 10 ms                                     |                                         |
| Release                  | 0.06 s for 50 %; 0.5 to 5 s for remainder | manufacturer specification              |
| Ratio, COMPRESS          | approx. 3:1                               | nominal, nonlinear, frequency dependent |
| Ratio, LIMIT             | approx. ∞:1 nominal; 10:1–20:1 measured   |                                         |

No published family of gain-reduction transfer curves at stated PEAK REDUCTION settings was located.
**This is the highest-value outstanding research item for this unit** — the static curve family is
what would let QA test the ratio behaviour against a number rather than against a shape.

## 9. Verification — measurements for the QA agent

1. **Static transfer curve.** For PEAK REDUCTION at 25, 50, 75 and 100, and for both COMPRESS and
   LIMIT, sweep a 1 kHz sine from -40 to +16 dBm-equivalent in 1 dB steps, allowing 30 s settling at
   each step. Plot output against input. Assert: (a) no discontinuity of slope anywhere — the curve
   must be smooth, a detected knee corner is a failure; (b) in COMPRESS the local slope at 10 dB of
   gain reduction is between 2.5:1 and 4:1; (c) in LIMIT the local slope at 10 dB of gain reduction is
   at least 8:1.
2. **Attack time.** Step a 1 kHz sine from -30 dBm to +10 dBm-equivalent. Measure 10 %–90 % of the
   final gain reduction. Target 10 ms, tolerance ±3 ms.
3. **Release stage one.** After 200 ms at a level producing 10 dB of gain reduction, remove the
   signal and measure the time to recover the first 5 dB. Target 60 ms, tolerance ±20 ms.
4. **Release stage two, short history.** Same as (3) but measure time to recover from 5 dB remaining
   to 0.5 dB remaining. Target within 0.5–5 s. Log the value.
5. **Release stage two, long history — the memory test.** Hold 10 dB of gain reduction for 60 s, then
   remove the signal and repeat the stage-two measurement. **Assert that this value is at least 2×
   the value measured in (4).** A model whose release is identical after 200 ms and after 60 s has no
   memory state and fails.
6. **History decay.** Run the long-history case in (5), let the model idle for 60 s with no signal,
   then rerun (4). Assert the result has returned to within 30 % of the original short-history value.
7. **Frequency response.** PEAK REDUCTION at 0. Sweep 30 Hz–15 kHz. Target ±0.1 dB, tolerance ±0.4 dB
   overall.
8. **Frequency-dependent dynamics.** Apply 60 Hz and 6 kHz tones separately at levels producing 6 dB
   of gain reduction each. Record the gain reduction; the specification says the ratio is frequency
   dependent, so a difference here is expected and should be logged as a baseline, not failed.
9. **Pre-emphasis control.** With the emphasis control at its extreme, apply a 100 Hz tone and a
   10 kHz tone at equal level. Assert the 10 kHz tone produces at least 6 dB more gain reduction than
   the 100 Hz tone. With the control flat, assert the two are within 2 dB.
10. **THD.** 1 kHz, no gain reduction. Target < 0.35 % at +10 dBm-equivalent and < 0.75 % at
    +16 dBm-equivalent, tolerance +0.15 percentage points. Assert second harmonic exceeds third by at
    least 6 dB at +10 dBm.
11. **Noise floor.** Target 75 dB below +10 dBm, tolerance ±3 dB.
12. **Make-up gain isolation.** At a fixed PEAK REDUCTION producing 10 dB of reduction, sweep GAIN
    across its full range. Assert the _amount_ of gain reduction changes by less than 1 dB. If it
    changes, the detector has been wired after the make-up gain.
13. **Meter lag.** Apply a 20 ms burst at a level that would produce 10 dB of steady-state reduction.
    Assert the GR meter reading peaks below 6 dB. An instantaneous meter is wrong.

## 10. Sources, and where they conflict

- Teletronix LA-2A levelling amplifier manual, Library of Congress recorded-sound preservation
  manuals collection (tile.loc.gov/.../Teletronix Model LA-2A Leveling Amplifier.pdf) and Universal
  Audio's reproduction (media.uaudio.com/assetlibrary/l/a/la-2a_manual.pdf) — gain, gain reduction,
  frequency response, distortion, noise, input and output levels, attack and release, meter
  calibration.
- Universal Audio LA-2A manual pages via ManualsLib (manualslib.com/manual/498361), including the
  calibration page covering meter zero, side-chain pre-emphasis R37 and stereo balance R3.
- Universal Audio LA-2A Tube Compressor manual (help.uaudio.com article 19378009641748) — PEAK
  REDUCTION scale is arbitrary, GAIN up to 40 dB, meter selector behaviour, COMPRESS ≈ 3:1 /
  LIMIT ≈ ∞:1 with the explicit caveat that the ratios are nonlinear and frequency dependent.
- GroupDIY threads on LA-2A topology and the T4 cell (groupdiy.com threads 50129, 80210, 18618, 86194) — feedback topology with the sidechain picking up after the opto cell, sidechain comprising
  voltage amplifier, pre-emphasis filter and panel driver, and the observation that enclosing the
  driver's distortion in the loop is what makes it work.
- ProReplicas T4B page and Black Lion Audio T4BLA product documentation — EL panel plus two
  photocells, Clairex CL-505L cadmium sulphide, one cell for gain reduction and one for metering,
  panel driven from the filtered and stepped-up audio at no more than about 90 V AC peak, and the
  failure modes of a worn cell.
- GroupDIY, "DIY T4B, matching EL Panels and Cells" — EL phosphor degradation by copper ion migration
  and its acceleration under audio-rate drive.
- Sweetwater InSync, "LA-2A Emphasis Control", and Waves/Gearspace discussion of the same — the R37
  filter's direction and approximate magnitude.
- Wombat Amplification and Gearspace/Fuzz Audio tube discussions — which valves are in the audio path
  (12AX7 voltage amp, 12BH7A cathode follower, output transformer) and which are sidechain only
  (second 12AX7, 6AQ5 panel driver).
- Whitlock, "Audio Transformers" (Jensen) — transformer nonlinearity mechanisms.
- Elliott Sound Products, "Valves — Distortion + Intermod" — single-ended triode harmonic profile.

**Conflicts and resolutions.**

_Release stage two: 0.5–5 s or 1–15 s?_ The manufacturer's own specification sheet says 0.5 to 5 s
for the remaining release. The 1-to-15-second figure appears in later marketing and secondary
writing and is repeated very widely. This sheet uses **0.5–5 s as the primary target** because it
comes from the manufacturer's published specification for the unit as built and calibrated, and
treats **1–15 s as the outer envelope** reachable by a cell with heavy exposure history — which is
consistent with both sources, since the specification would have been taken on a rested unit and the
longer figure is exactly the memory effect that every source describes. QA test 5 exists to check
that the model can reach the long end, and test 4 to check that it starts at the short end.

_Ratio in LIMIT: ∞:1 or 10–20:1?_ The manufacturer says approximately ∞:1; measurement-based
descriptions say 10:1 to 20:1. There is no real conflict: the manufacturer's figure is a design
intent for a feedback loop with high loop gain, and a real feedback loop has finite gain. **Target the
measured figure**, and QA test 1(c) is written accordingly with a floor of 8:1 rather than an
equality.

_Ratio in COMPRESS: is 3:1 a ratio at all?_ No. Every source that gives it also says the ratio is
nonlinear and frequency dependent. It is a local slope at some unstated operating point. Treated here
as a target for the local slope at 10 dB of gain reduction only.
