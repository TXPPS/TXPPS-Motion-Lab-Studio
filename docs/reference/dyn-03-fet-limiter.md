# DYN-03 — FET Limiting Amplifier

**Reference Spec Sheet — Motion Wave Research, internal only.**

Reference hardware studied: UREI / Universal Audio 1176 and 1176LN solid-state limiting amplifier.
**The manufacturer and model names in this document exist only in these research notes.** They must
not appear in shipped UI strings, class or file names, preset names, parameter identifiers, or
marketing copy — and in particular the nickname the reference unit's four-button mode is known by
must not be used as a Motion Wave feature name. No panel artwork, logo, typeface or badge has been
described here or may be traced; the era's design language — a row of interlocked square pushbuttons,
two large continuous attenuator knobs, two smaller time-constant knobs, a VU meter with a metering
selector — is general to late-1960s American solid-state outboard and is fair to evoke.

Sources are published manuals, manufacturer specifications, published circuit descriptions,
peer-reviewed and trade-press analysis, and semiconductor application notes. Nothing here derives
from disassembling or extracting assets from any commercial product.

---

## 1. What this unit is

A field-effect transistor used as a voltage-variable resistor forms the shunt leg of a divider at the
input of a high-gain solid-state amplifier. The sidechain rectifies the amplifier's **output** and
drives the FET gate, so this is a feedback design like DYN-02, but with a control element whose
response time is microseconds rather than milliseconds. It is the fastest of the five units by two
orders of magnitude, and almost everything characteristic about it follows from that speed acting on
a signal whose lowest components are slower than the detector.

There is no threshold control. The threshold is fixed by the circuit, moves with the ratio selection,
and is reached by driving the INPUT control harder.

## 2. Signal path block diagram

```
   balanced in
        |
  [ INPUT TRANSFORMER ]         600 R, Peerless then UTC
        |                       (removed in the last revision, replaced
        |                        by a differential amplifier)
        |
  [ INPUT control ]             T-pad style attenuator: sets drive into
        |                       the gain-reduction stage = sets how far
        |                       above the fixed threshold the signal sits
        |
   R5 ---+--- series leg
         |
        Q1  FET, shunt leg, channel resistance set by gate voltage
         |
        GND
         |
  [ 1108-type PREAMP ]          bipolar, Darlington input pair
        |
  [ OUTPUT control ]            attenuator: make-up gain
        |
  [ OUTPUT AMPLIFIER ]          Class A (2N3053) in early revisions;
        |                       push-pull, 1109-derived, from rev F
  [ OUTPUT TRANSFORMER ]        UA-5002 / UA-5002A: split secondary,
        |                       tertiary feedback winding to the output
        |                       stage, separate emitter winding
   balanced out
        |
        +---------------------------------+
                                          |  FEEDBACK: detector taps
                                          |  the output
                        +-----------------v------------------+
                        |  RATIO buttons: 4 / 8 / 12 / 20 :1  |
                        |  set sidechain gain AND threshold   |
                        +-----------------+------------------+
                                          |
                        [ RECTIFIER / PEAK DETECTOR ]
                                          |
                        [ ATTACK / RELEASE timing network ]
                                          |
                        -----> Q1 gate                (Q BIAS trim sets
                                                       Q1's operating point;
                                                       DIST TRIM nulls the
                                                       FET's distortion)
```

## 3. Controls

### 3.1 INPUT

Continuous rotary attenuator ahead of the gain-reduction stage. Because the threshold is internal and
fixed, INPUT is functionally the threshold control: turning it up pushes more of the signal above the
fixed threshold and produces more gain reduction. It also sets how hard the FET and the preamp are
driven, so it is simultaneously the drive control for the unit's nonlinearity. Default: unity, or
whatever produces no gain reduction on the intended source.

### 3.2 OUTPUT

Continuous rotary attenuator after the gain-reduction stage, before the output amplifier. Make-up
gain. Outside the detector loop, so it does not change the amount of gain reduction.

**Interaction:** INPUT and OUTPUT together set both the compression depth and the drive on the output
stage and output transformer. Two settings that produce the same gain reduction and the same output
level do _not_ produce the same distortion, because the split of gain between the two stages differs.
This is the unit's most-used "trick" after the four-button mode, and the model must reproduce it.

### 3.3 RATIO buttons — 4:1, 8:1, 12:1, 20:1

Four interlocked pushbuttons. Nominally exclusive: pressing one releases the others. Default 4:1.

Each button changes two things at once, and this is the fact implementers most often miss:

1. **The ratio** — the slope above threshold.
2. **The threshold** — higher ratios raise it. Published figures give an internal threshold of about
   **-32 dBm at 4:1 rising to about -25 dBm at 20:1** (Sound On Sound, "Universal Appeal"). That is
   roughly 7 dB of threshold movement across the four positions. **Marked as approximate:** these are
   the only published numbers found and they are given without measurement conditions; treat the 7 dB
   span as the target and the absolute values as provisional.

The consequence, which QA must check for, is counter-intuitive: **switching from 4:1 to 20:1 at a
fixed INPUT setting usually produces _less_ gain reduction on the meter**, not more, because the
threshold rose faster than the ratio steepened. A model in which higher ratios always give more gain
reduction is wrong.

The knee also changes with the button: harder at high ratios, softer at low ones.

### 3.4 ALL BUTTONS IN

Mechanically possible because the interlock can be defeated by pressing several buttons together. It
is not a documented mode; it is an out-of-specification state, and the model should treat it as one.

What is established about it:

- **The ratio lands somewhere between 12:1 and 20:1** and is described consistently as an unstable,
  non-monotonic curve rather than a straight line — "more like a severe plateau" than a slope.
- **The bias points change throughout the circuit**, not just in the ratio network, because several
  ratio resistors are placed in parallel rather than one being selected.
- **The attack and release times change**, and specifically there is a **lag on the attack of initial
  transients**, described in the trade press as behaving like a "reverse look-ahead": the first part
  of a transient gets through before the gain reduction arrives.
- **Distortion increases substantially**, and this is a direct consequence of the attack lag: the FET
  is being asked to move a long way, quickly, from a shifted operating point.

**Implementer rule.** Do not model this as "ratio = 16:1". Model it as a distinct state in which
(a) the parallel combination of all four ratio networks sets both a new sidechain gain and a new
threshold, (b) the detector's effective attack is delayed by a few milliseconds relative to the
selected attack setting before it engages, and (c) the FET's operating point is offset so that its
transfer curve is used further from its linear region. The audible signature — an unmissable
transient that punches through, followed by a hard clamp and audible harmonic grit — falls out of
those three changes. **Marked as inference:** the specific magnitude of the attack lag has no
published figure. **Unknown.** Start at 3–8 ms and tune by ear against published descriptions, and
flag the value as untested.

### 3.5 ATTACK

Continuous rotary, panel scale 1 to 7. **Reversed relative to modern convention: fully clockwise is
the fastest attack, fully counter-clockwise the slowest.** Published range: **20 µs (fastest, fully
clockwise) to 800 µs (slowest, fully counter-clockwise)**. Default: mid-travel.

On the reference unit, rotating the attack knob fully counter-clockwise past the slowest setting
reaches an **OFF** detent, in which no gain reduction occurs and the unit functions as a straight
line amplifier with up to **45 dB** of gain. This is a genuinely useful state — it is the unit's
colour without its dynamics — and Motion Wave should expose it, because otherwise users cannot get
the amplifier's character without compression.

### 3.6 RELEASE

Continuous rotary, panel scale 1 to 7, same reversed sense: clockwise is faster. Published range:
**50 ms (fastest) to 1100 ms (slowest)**. Default: mid-travel.

### 3.7 METER selector

Pushbuttons: **GR**, **+4**, **+8**, and **OFF**. In GR the meter reads gain reduction in dB and rests
at 0 dB with no signal or no compression. In +4 or +8 it reads output level, with 0 VU corresponding
to +4 dBm or +8 dBm at the rear-panel output. OFF also powers the unit down — the unit is on whenever
any button other than OFF is selected. That coupling is a quirk of the hardware; Motion Wave should
keep the metering choices and drop the power coupling.

### 3.8 Internal trims — Q BIAS and DIST TRIM

Not user controls on the hardware, but both are directly relevant to the model's nonlinearity.

- **Q BIAS** sets the FET's starting point at the beginning of its conducting range. The documented
  calibration procedure is to pass a signal at unity with the unit not limiting and adjust the trimmer
  until the output drops by 1 dB — i.e. the FET is biased just into conduction, at the very edge of
  gain reduction.
- **DIST TRIM** is adjusted with a roughly 1 kHz signal at unity gain for minimum distortion, i.e. it
  nulls the FET's own distortion at one operating point. It cannot null it everywhere.

**Implementer rule:** these two trims are why two units of the same revision sound different, and why
a well-adjusted unit is cleaner at rest than a drifted one. Expose them as a single "calibration" or
"unit variance" parameter rather than as two engineering trims, and let the default correspond to a
correctly calibrated unit.

## 4. Time constants

| Control | Fastest (fully CW) | Slowest (fully CCW) | Law                                      |
| ------- | ------------------ | ------------------- | ---------------------------------------- |
| ATTACK  | 20 µs              | 800 µs              | continuous, scale 1–7, **unknown** taper |
| RELEASE | 50 ms              | 1100 ms             | continuous, scale 1–7, **unknown** taper |

Neither taper is published. **Marked as inference:** a logarithmic mapping from the 1–7 scale to the
published endpoints is the reasonable default (20 µs × (40)^((7-p)/6) for attack, 50 ms ×
(22)^((7-p)/6) for release), and it should be flagged as our estimate.

**Program dependence.** The unit is a feedback design with a peak detector, so program dependence
arrives through the loop rather than through a dual-slope element as in DYN-02. Two rules an
implementer can code:

1. Because the detector sees the _compressed_ output, the control signal shrinks as gain reduction
   deepens, so the effective attack slows and the effective ratio softens as reduction increases. Do
   not compensate for this; it is the character.
2. Because the timing network's charge state persists between events, closely spaced transients hold
   the gain down and recover together rather than individually. Model the timing network as a state,
   not as an envelope-follower reset per transient.

The 20 µs attack is faster than one period of any audio frequency below 50 kHz. **This is the origin
of the unit's low-frequency behaviour:** at the fastest attack settings the detector tracks _within_
the cycle of a bass note, so the gain is modulated at the signal frequency and the result is
harmonic distortion generated by the detector itself, not by any amplifier stage. The effect grows as
frequency falls and as attack is made faster. QA test 9 exists to confirm it is present.

## 5. Filter topology and curve shape

There is no user-facing filter. The relevant "filter" behaviour is:

- **The sidechain has no high-pass filter** in the original design, which is why low-frequency energy
  dominates the detector and why the unit ducks on bass content. Motion Wave may offer a sidechain
  high-pass as a clearly-labelled modern addition; it must default to off.
- **The compression curve is soft-kneed at 4:1 and progressively harder toward 20:1.** No published
  knee-width figures were found; **unknown**. Model the knee as emerging from the ratio network rather
  than as a separate parameter.
- **The static curve above threshold is not straight**, because the FET's transfer characteristic is
  not linear in dB. Departure from an ideal compressor is greatest at high gain reduction and at high
  ratios.

## 6. Nonlinearity sources, located in the path

1. **Input transformer** (present on all revisions except the last). Low-frequency, level-dependent,
   third-harmonic dominant hysteresis and saturation behaviour (Whitlock, Jensen). The last revision
   replaced it with a differential amplifier and therefore has a measurably different low-frequency
   character; if Motion Wave models a transformerless variant, that is the difference to expose.
2. **Q1, the FET — the signature nonlinearity of this unit.** The mechanism is documented in
   semiconductor application literature: when the gate-to-source voltage is modulated by the signal
   itself, the channel resistance varies within each cycle, producing **gain compression on one
   polarity and gain expansion on the other**. That asymmetry generates **second-order harmonic
   distortion**. This is the technically important statement in the whole sheet: the FET's distortion
   is _asymmetric_, so the unit's harmonic signature is second-harmonic-led, and it rises with gain
   reduction because deeper reduction moves the FET further along its curve. DIST TRIM nulls it at
   one point only.
3. **The 1108-type preamp**, bipolar with a Darlington input pair. Contributes at high drive.
   **Marked as inference:** treat as a soft symmetric limiter, third-harmonic led, secondary to (2).
4. **The output amplifier.** Class A in early revisions, push-pull from revision F. This is a real
   harmonic difference between revisions: a Class A single-ended stage produces even-order product,
   a push-pull stage cancels most even-order and leaves odd. If Motion Wave offers a revision switch,
   this is the parameter it should actually change.
5. **Output transformer**, with its tertiary feedback winding. The feedback winding reduces the
   transformer's own distortion relative to an unwrapped transformer; the model should give it less
   low-frequency distortion than the input transformer, not more. **Marked as inference** from the
   documented presence of the negative-feedback winding.
6. **The detector**, as described in §4 — at fast attack settings on low-frequency material the
   detector itself is a distortion generator.

## 7. Character artefacts a user notices

- **Transients are caught and held.** At 20 µs nothing gets past the detector except by the deliberate
  lag of the four-button state.
- **Low-frequency distortion that increases as attack is made faster**, from detector ripple.
- **Second-harmonic-led grit that grows with gain reduction**, from the FET.
- **Audible pumping at slow release with dense material**, because the timing network is a single
  state shared by all events.
- **The all-buttons state**: a distinctly audible transient escaping ahead of the clamp, an aggressive
  plateau rather than a slope, and a large step up in harmonic content.
- **Line-amplifier mode** (attack fully counter-clockwise, OFF detent): up to 45 dB of gain with all
  the transformer and amplifier character and none of the dynamics.
- **Noise floor**: signal-to-noise better than 81 dB referred to the threshold of limiting, 30 Hz to
  15 kHz.
- **Unit-to-unit variance** from Q BIAS and DIST TRIM drift.

## 8. Published measurements

| Quantity           | Value                                     | Conditions                             |
| ------------------ | ----------------------------------------- | -------------------------------------- |
| Attack time        | 20 µs to 800 µs                           | continuously variable                  |
| Release time       | 50 ms to 1100 ms                          | continuously variable                  |
| Ratios             | 4:1, 8:1, 12:1, 20:1                      | switched                               |
| Internal threshold | approx. -32 dBm at 4:1 to -25 dBm at 20:1 | conditions not stated                  |
| Signal-to-noise    | > 81 dB                                   | at threshold of limiting, 30 Hz–15 kHz |
| Distortion         | < 0.5 % THD                               | 50 Hz to 15 kHz, with limiting         |
| Line-amp gain      | up to 45 dB                               | attack OFF, no gain reduction          |
| Meter              | GR / +4 / +8 / OFF                        | 0 VU = +4 or +8 dBm at output          |

No published family of static transfer curves, no published knee widths, no published harmonic
spectra at stated gain reduction, and no published measurement of the four-button state were located.
**Obtaining measured curves for the four-button state is the highest-value outstanding research item
for this unit**, because that state is the reason users reach for it and it is the part of the model
with the least published support.

## 9. Verification — measurements for the QA agent

1. **Attack time endpoints.** Step a 1 kHz sine 20 dB above threshold. Measure 10 %–90 % of final gain
   reduction with ATTACK fully clockwise and fully counter-clockwise. Targets 20 µs and 800 µs,
   tolerance ±25 % relative at each endpoint. Requires 96 kHz or higher to resolve the fast end;
   run at 192 kHz for this test.
2. **Release time endpoints.** After 500 ms at 10 dB of gain reduction, remove the signal. Measure time
   to recover to 1 dB remaining, RELEASE fully clockwise and fully counter-clockwise. Targets 50 ms
   and 1100 ms, tolerance ±25 % relative.
3. **Control sense.** Assert that increasing the ATTACK control value makes attack _faster_ and
   increasing RELEASE makes release _faster_. A model with conventional sense has inverted the panel.
4. **Ratio slopes.** For each of the four buttons, sweep input and measure the local slope 20 dB above
   threshold. Targets 4:1, 8:1, 12:1, 20:1, tolerance ±20 % relative.
5. **Threshold movement — the critical ratio test.** Fix INPUT at a level producing 10 dB of gain
   reduction at 4:1. Without changing INPUT, switch to 20:1. **Assert the gain reduction decreases.**
   Assert the threshold difference between 4:1 and 20:1 is between 4 dB and 10 dB. A model in which
   20:1 gives more gain reduction than 4:1 at the same input has not implemented the moving threshold.
6. **Knee.** Measure the input range over which the local slope goes from 1.5:1 to 90 % of the nominal
   ratio, at 4:1 and at 20:1. Assert the 4:1 knee is at least 1.5× wider than the 20:1 knee. No
   absolute target exists; record for regression.
7. **Four-button state, ratio.** Assert the local slope 20 dB above threshold is between 10:1 and 25:1
   and that the curve is _not_ straight — assert the slope measured at 10 dB above threshold differs
   from the slope at 25 dB above threshold by at least 20 % relative.
8. **Four-button state, attack lag.** Apply a fast-rise burst with ATTACK fully clockwise. Measure the
   delay from burst onset to the point where gain reduction reaches 50 % of final, in the four-button
   state and in 20:1. **Assert the four-button delay is at least 10× the 20:1 delay.** This is the
   "reverse look-ahead" and it is the single behaviour that defines the state.
9. **Four-button state, distortion.** At 10 dB of gain reduction, 1 kHz, compare THD in the four-button
   state against 20:1. Assert the four-button state is at least 6 dB higher in THD.
10. **FET asymmetry.** At 10 dB of gain reduction, 1 kHz. Assert second harmonic exceeds third harmonic
    by at least 6 dB. Assert the harmonic content at 10 dB of reduction exceeds that at 2 dB of
    reduction by at least 8 dB. Both follow directly from the FET mechanism in §6.2.
11. **Detector ripple at low frequency.** 40 Hz sine, ATTACK fully clockwise, 10 dB of gain reduction.
    Assert measurable harmonic distortion above 1 %. Repeat with ATTACK fully counter-clockwise and
    assert it is at least 6 dB lower. If the two are the same, the detector is smoothing where the
    hardware does not.
12. **Line-amplifier mode.** ATTACK at OFF. Assert zero gain reduction under all inputs, and assert the
    available gain reaches 45 dB, tolerance ±2 dB.
13. **Make-up isolation.** Sweep OUTPUT at fixed INPUT. Assert gain reduction changes by less than
    0.5 dB.
14. **Drive split.** Two settings giving the same output level and the same gain reduction but with
    INPUT differing by 10 dB. Assert measurable THD differs by at least 3 dB between them.
15. **Baseline specifications.** THD < 0.5 % from 50 Hz to 15 kHz with limiting, tolerance +0.2
    percentage points. Signal-to-noise > 81 dB at threshold of limiting, tolerance -3 dB.
16. **Aliasing.** With ATTACK fully clockwise and 15 dB of gain reduction on a 12 kHz tone, assert no
    alias product above -60 dBFS. A 20 µs attack is an aggressive nonlinearity and this unit is the
    most likely of the five to alias.

## 10. Sources, and where they conflict

- UREI 1176LN owner's manual, Internet Archive full text (archive.org/details/Urei_1176LN_owners_manual)
  and Universal Audio's reissue manual (media.uaudio.com/assetlibrary/1/1/1176ln_manual.pdf) —
  attack and release ranges, ratios, signal-to-noise, distortion, meter functions, OFF/power coupling.
- Universal Audio 1176LN manual via ManualsLib (manualslib.com/manual/828073, meter and control pages)
  — meter positions GR/+4/+8/OFF and their calibration.
- Sound On Sound, "Universal Appeal" — internal threshold approximately -25 dBm at 20:1 and -32 dBm at
  4:1.
- Universal Audio, "1176 Classic Limiter Collection: Tips & Tricks" — higher ratios raise the
  threshold and harden the knee.
- Inside Blackbird, "The 1176 Compressor", and Mix Online, "1176 Revision History" — R5/Q1 divider,
  T-pad input attenuator, 1108 preamp with Darlington pair, 2N3053 Class A output, UA-5002/5002A
  output transformer with split secondary, tertiary feedback winding and emitter winding, Peerless
  then UTC input transformer, revision F push-pull output derived from the 1109, revision G removing
  the input transformer for a differential amplifier.
- Black Ghost Audio, "The History of the 1176 Compressor: Revisions A to H" — revision naming and the
  LN module's introduction at revision C.
- Pulsar Audio, "The History of All-buttons-in Mode", MusicRadar's all-buttons feature, Sweetwater
  InSync "All-Button Mode", and the Journal on the Art of Record Production article "All Buttons In"
  — ratio landing between 12:1 and 20:1, bias points changing throughout the circuit, altered attack
  and release, the transient lag described as reverse look-ahead, and the substantial distortion
  increase.
- Mouser / EDN, "A Guide to Using FETs for Voltage Controlled Circuits, Part 1" — the mechanism by
  which a signal-modulated gate-source voltage produces compression on one polarity and expansion on
  the other, and hence second-order harmonic distortion.
- GroupDIY, "Hairball Audio Rev D 1176 Q-Bias calibration", and Gearspace "setting the bias on an
  1176" — the Q BIAS 1 dB-drop procedure and the DIST TRIM minimum-distortion procedure.
- Whitlock, "Audio Transformers" (Jensen) — transformer nonlinearity mechanisms.
- Elliott Sound Products, "Valves — Distortion + Intermod", and diyAudio/patent literature on
  push-pull even-order cancellation — the Class A versus push-pull harmonic difference.

**Conflicts and resolutions.**

_Attack and release ranges._ The manufacturer's manual gives 20 µs–800 µs attack and 50 ms–1100 ms
release. A widely distributed plug-in emulation's documentation gives "1 ms to less than 50 µs" for
attack and "1 s to 50 ms" for release. The emulation's numbers are a plug-in's own specification and
its attack figures are inconsistent with the hardware manual at both ends. **This sheet uses the
hardware manual.**

_Four-button ratio._ Sources give "between 12:1 and 20:1", "somewhere around 12:1 to 20:1", and
"a strange, unstable curve". No source gives a single number, and the ones that describe it in detail
all say it is not a straight line. **This sheet treats the ratio as a range and requires the model to
be non-linear across level** rather than picking a value, which is why QA test 7 checks slope
_variation_ rather than slope equality.

_Whether the four-button state is a "mode"._ It is not documented by the manufacturer as a mode. It is
an out-of-specification state that became a technique. Motion Wave should implement it and should not
name it after the reference unit or its nickname.
