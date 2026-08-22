# DYN-05 — Discrete Console Equalisers (two lineages)

**Reference Spec Sheet — Motion Wave Research, internal only.**

Reference hardware studied: the Neve 1073 channel amplifier (British, transformer-coupled, discrete
Class A, inductor EQ) and the API 550A / 550B discrete equalisers (American, discrete op-amp,
bridged-T EQ). **The manufacturer and model names in this document exist only in these research
notes.** They must not appear in shipped UI strings, class or file names, preset names, parameter
identifiers, or marketing copy. No panel artwork, logo, typeface or badge has been described here or
may be traced; the era's design language — concentric stepped rotary switches with coloured skirts,
one switch per band carrying both frequency and amount, a small EQ-in latching switch, narrow module
proportions — is general to late-1960s and early-1970s console modules and is fair to evoke.

This sheet covers both lineages because Motion Wave is building one console-EQ device family and the
two differ in ways that matter to the DSP, not just to the presets. **Section 8 is the
side-by-side.** Sources are manufacturers' manuals and product documentation, published circuit
analysis and published measurement discussion. Nothing here derives from disassembling or extracting
assets from any commercial product.

---

## 1. What these units are

Both are stepped, non-parametric equalisers built from discrete amplifier blocks with the
tone-shaping network placed around or between those blocks. Neither has a continuously variable
frequency control and neither has a Q control. Everything a user can do is a detent.

They differ fundamentally in how the curve is made:

* **The British lineage uses inductors.** Real wound inductors with real series resistance and real
  cores, switched together with capacitors, forming resonant networks in the feedback path of
  discrete transistor amplifier stages.
* **The American lineage does not.** The 550A uses **bridged-T RC networks** — resistors and
  capacitors only — around discrete op-amp modules with a summing node. Its sibling graphic EQ uses
  gyrators (active inductor simulations); the 550A uses neither real nor simulated inductors.

That correction matters: the brief for this project assumed inductor curves throughout, and it is
only half right. The proportional-Q behaviour that the American unit is famous for comes from the
bridged-T network's interaction with the boost/cut divider, not from an inductor.

## 2. Signal path block diagrams

### 2.1 British lineage (1073-type)

```
   mic in                     line in
     |                           |
 [ MIC INPUT TRANSFORMER ]   [ LINE INPUT TRANSFORMER ]
     |                           |
     +------------+--------------+
                  |
        [ BA283-type AMP STAGE 1 ]   discrete Class A, transformer-
                  |                  coupled, feedback-defined gain
                  |
      +-----------v------------------------------------+
      |  EQ SECTION, inductor networks in the feedback  |
      |  path of inverting discrete amplifier stages    |
      |                                                 |
      |   HPF   18 dB/oct, 50 / 80 / 160 / 300 Hz       |
      |   LF    shelf, 35 / 60 / 110 / 220 Hz, +/-16 dB |
      |   MF    bell, 360 Hz / 700 Hz / 1.6 / 3.2 /     |
      |         4.8 / 7.2 kHz, +/-18 dB, fixed Q        |
      |   HF    shelf, fixed 12 kHz, +/-16 dB           |
      +-----------+-------------------------------------+
                  |
              [ FADER ]
                  |
        [ BA283-type AMP STAGE 2 ]
                  |
        [ OUTPUT TRANSFORMER ]  600 R
                  |
              balanced out
```

The EQ, the filters and the fader sit *between* two amplifier stages. Within the EQ section, the
reactive networks sit in the feedback loops of inverting amplifier stages, which behave like inverting
op-amps with frequency-dependent closed-loop gain.

### 2.2 American lineage (550A-type)

```
   balanced in
        |
  [ INPUT stage ]
        |
        +--------> [ BRIDGED-T NETWORK, BAND 1 ] ----+
        |          (LF: 50/100/200/300/400 Hz,       |
        |           shelf or peak)                   |
        |                                            |
        +--------> [ BRIDGED-T NETWORK, BAND 2 ] ----+---> [ SUMMING NODE ]
        |          (MF: 0.4/0.8/1.5/3/5 kHz, peak)   |            |
        |                                            |            |
        +--------> [ BRIDGED-T NETWORK, BAND 3 ] ----+     [ 2520 DISCRETE
        |          (HF: 5/7/10/12.5/15 kHz,                  OP-AMP MODULES ]
        |           shelf or peak)                                |
        |                                                         |
        +--------> [ BAND-PASS FILTER, 12 dB/oct, 50 Hz-15 kHz ] -+
                   (independent of all EQ settings)               |
                                                                  |
                                                  [ 1:3 OUTPUT TRANSFORMER ]
                                                                  |
                                                            balanced out
```

The band networks sit in the feed-forward or feedback path with a summing node, which is what gives
the design its fixed relationship between band shape and boost amount.

## 3. Controls — British lineage

### 3.1 Mic/line gain
Microphone gain **+20 dB to +80 dB in 5 dB steps** (13 positions). Stepped rotary switch, no
intermediate values. Separate line gain path. Default: whatever gives nominal level; for a plug-in,
default the gain to unity-equivalent and treat the gain switch as a drive control, because it is the
principal way a user reaches the amplifier's nonlinearity.

### 3.2 HIGH FREQUENCY
Fixed frequency: **12 kHz shelf, ±16 dB**, continuously variable amount on the hardware's concentric
control. No frequency choice. Default 0.

### 3.3 MID FREQUENCY
Bell, **±18 dB**, six switched centre frequencies: **360 Hz, 700 Hz, 1.6 kHz, 3.2 kHz, 4.8 kHz,
7.2 kHz**. Q is not adjustable. Default 0 dB, 1.6 kHz.

Published Q estimates range from about **1.0 to 1.7**, with no manufacturer figure. **Unknown** as a
specification. The behaviour is better described than the number: the filter is *constant-bandwidth*
rather than constant-Q, so it gets narrower as boost or cut increases. **Marked as inference:** use
Q ≈ 1.2 at moderate settings as the starting point, implement constant bandwidth so that Q rises with
amount, and flag the value for measurement.

### 3.4 LOW FREQUENCY
Shelf, **±16 dB**, four switched frequencies: **35, 60, 110, 220 Hz**. Default 0 dB, 110 Hz.

### 3.5 HIGH-PASS FILTER
**18 dB per octave**, four switched corners: **50, 80, 160, 300 Hz**, plus out. An 18 dB/octave slope
is third-order, which is unusual — most console filters of the period were 12 dB/octave — and it is
one of the unit's identifying characteristics. Default out.

### 3.6 EQ IN
Latching switch, removes the EQ networks. As with DYN-01, it does **not** remove the amplifier stages
or the transformers. **Implementer rule: bypassing the EQ must not bypass the preamp colour.**

### 3.7 Interactions
The bands are not independent in the way a parametric's are. Because the networks sit in the feedback
paths of shared amplifier stages, adjacent bands interact: a large low shelf boost measurably changes
the mid band's effective response. **Marked as inference** from the topology; no published measurement
of the magnitude was found. Model the sections as a chain of real networks rather than as three
independent biquads summed in dB, and the interaction will appear on its own.

## 4. Controls — American lineage

### 4.1 Band structure, 550A
Three bands, each a dual-concentric stepped switch: the outer ring selects **frequency**, the inner
selects **boost or cut**.

| Band | Frequencies | Shape |
|---|---|---|
| 1 (LF) | 50, 100, 200, 300, 400 Hz | peak or shelf, switchable |
| 2 (MF) | 0.4, 0.8, 1.5, 3, 5 kHz | peak only |
| 3 (HF) | 5, 7, 10, 12.5, 15 kHz | peak or shelf, switchable |

The bands overlap deliberately: 400 Hz appears at the top of band 1 and the bottom of band 2, and
5 kHz appears at the top of band 2 and the bottom of band 3.

### 4.2 Boost/cut steps
**Five steps each way: ±2, ±4, ±6, ±9, ±12 dB**, plus zero. Stepped, detented, reciprocal — the cut
curve is the mirror of the boost curve at the same step. Default 0.

### 4.3 Shelf/peak switches
Bands 1 and 3 only. Default peak. **Marked as inference:** no published default exists; peak is chosen
because it is the shape the proportional-Q behaviour is defined for.

### 4.4 BAND-PASS FILTER
Switchable, **12 dB per octave, 50 Hz to 15 kHz**, insertable independently of every EQ setting.
Two-state. Default out.

### 4.5 EQ IN
Latching switch that introduces the EQ silently. The op-amps and output transformer remain in circuit.

### 4.6 550B differences
Four overlapping bands instead of three, **seven** frequency positions per band instead of five, and
shelf/peak switching on bands 1 and 4 instead of 1 and 3. Same proportional-Q principle, same discrete
op-amp modules. The 550B's per-band boost/cut step count is given as seven switchable positions in
manufacturer copy; the exact dB values were not established. **Unknown** — do not guess; if Motion
Wave ships a four-band variant, use the 550A's five steps until the 550B's are confirmed.

### 4.7 Interactions
The overlapping frequency ranges are the main interaction: two bands set to the same overlapping
frequency stack, and because the Q is proportional to amount, two bands at 6 dB do **not** equal one
band at 12 dB — the two 6 dB curves are each three-octaves-ish wide and their sum is a wide 12 dB bump,
whereas one band at 12 dB is a one-octave-wide 12 dB bump. This is a genuine, audible, testable
difference and it is the best single demonstration that proportional Q has been implemented.

## 5. Time constants

Neither unit has a detector or any dynamics. The only time-domain behaviour is filter group delay and
ringing, plus the low-frequency behaviour of the transformers.

The British lineage's 18 dB/octave high-pass filter is the sharpest filter in the whole five-unit
project and will ring more than anything else Motion Wave ships. Its phase response is a
third-order minimum-phase response; **do not** implement it as a linear-phase filter, because the
phase shift is part of what the unit does to low-frequency transients.

## 6. Filter topology, order, Q behaviour, and departure from ideal

### 6.1 British lineage — inductor curves

The reactive elements are real wound inductors. The important behavioural consequences:

* **Band Q varies with frequency in a specific, documented pattern.** For the *lower* bands both the
  inductance and the capacitance are switched, which keeps Q roughly constant across those positions.
  For the *upper* bands only the capacitors are switched and the inductance is held constant, so **Q
  increases as the selected centre frequency rises**. A model with a single Q value per band is wrong
  at the frequency extremes.
* **Constant bandwidth rather than constant Q with amount.** The mid band narrows as boost or cut
  increases. This is the opposite convention to a textbook parametric where Q is independent of gain.
* **Finite inductor Q.** A wound inductor has series resistance, so the resonance is damped and the
  peak is lower and broader than the LC values alone predict. This is the main reason an inductor EQ's
  boost curve looks "softer at the top" than a biquad's. **Marked as inference** as to magnitude; no
  published measurement of the reference unit's inductor DCR was found.
* **Shelves are not first-order.** An LC shelving network produces a shelf with a slight resonant
  feature near the transition and an asymptote that is approached rather than reached. A first-order
  shelving biquad will not match it.
* **Core nonlinearity.** The inductor cores saturate under high low-frequency level, so a large low
  shelf boost on bass-heavy material adds harmonic content that a linear filter cannot produce. This
  is a real and audible part of the unit and it belongs in the EQ section, not in the amplifier model.
* **The 18 dB/octave high-pass is third-order** and therefore has an asymmetric, non-Butterworth
  shape. Its exact alignment is **unknown**; measure or derive from the schematic.

### 6.2 American lineage — bridged-T curves and proportional Q

* **Bridged-T RC networks**, not inductors, around discrete op-amp modules with a summing node,
  producing a fixed relationship between shape and amount.
* **Proportional Q, with published numbers**: the response is approximately **three octaves wide at
  2 dB of boost or cut and approximately one octave wide at 12 dB**. That is the most precise
  published Q figure available for any unit in this project and it should be treated as a target, not
  a guideline.
* **Implementer rule for the intermediate steps:** interpolate the bandwidth logarithmically between
  the two published endpoints. Using bandwidth `BW` in octaves against amount `g` in dB:
  `BW(g) = 3 × (1/3)^((|g| − 2)/10)` gives 3 octaves at 2 dB and 1 octave at 12 dB.
  **Marked as inference** — only the two endpoints are published, and the law between them is our
  choice. QA test 6 measures all five steps so the law can be corrected when better data arrives.
* **Reciprocal cut.** The cut curve mirrors the boost curve, which is stated by the manufacturer and
  is a property of the bridged-T-plus-summing-node arrangement. A boost of +6 dB followed by a cut of
  −6 dB at the same frequency should very nearly cancel. This is *not* true of the British lineage and
  is not true of DYN-01 at all.
* **Departure from ideal:** an ideal parametric holds Q constant while gain varies. This design cannot
  — the two are mechanically tied. Any Motion Wave UI that exposes a Q control on this device family
  has misunderstood it.

## 7. Nonlinearity sources, located in the path

### 7.1 British lineage
1. **Microphone or line input transformer**, nickel-cored. Hysteresis distortion at low levels,
   saturation at high levels, third-harmonic dominant, frequency-inverse (Whitlock, Jensen). Nickel
   cores have low hysteresis distortion but reach saturation distortion at high level.
2. **BA283-type discrete Class A amplifier stages**, two of them in series, each two common-emitter
   stages plus an emitter follower with feedback setting AC gain and DC conditions. Class A
   single-ended stages produce **second-harmonic-led** distortion rising with level. There are two
   such stages, so drive splits between them and the harmonic profile depends on where the gain is
   taken — the mic gain switch and the fader position between the two stages are both drive controls.
3. **EQ inductor cores** — see §6.1.
4. **Output transformer** into 600 Ω, at the highest level in the unit.

### 7.2 American lineage
1. **Discrete op-amp modules.** Two of them. Their distortion signature is that of a discrete
   transistor gain block with feedback: low at nominal level, rising steeply near the rails.
   **Marked as inference** as to harmonic order; no published spectrum was found. **Unknown.**
2. **1:3 output transformer.** A step-up ratio, so the transformer is being asked to swing three times
   the op-amp's voltage; it is the dominant nonlinearity at high level and it is where the "punch"
   people describe is generated. Third-harmonic-dominant, low-frequency-weighted.
3. **No inductors**, therefore no core saturation in the EQ itself. A Motion Wave model that gives
   this device the same low-frequency EQ saturation as the British one is wrong.

## 8. Where the two lineages differ — the side-by-side

| | British lineage (1073-type) | American lineage (550A-type) |
|---|---|---|
| EQ element | real wound inductors + capacitors | bridged-T RC networks, no inductors |
| Amplifier | discrete Class A transistor stages, transformer-coupled | discrete op-amp modules |
| Bands | 3 + high-pass filter | 3 (550A) or 4 (550B) + band-pass filter |
| Frequency selection | stepped; HF fixed at 12 kHz | stepped; 5 positions/band (550A), 7 (550B) |
| Amount | continuous on the hardware control | stepped: ±2, 4, 6, 9, 12 dB |
| Q with amount | constant bandwidth: narrows as amount rises | proportional Q: 3 octaves at 2 dB, 1 octave at 12 dB |
| Q with frequency | roughly constant on lower bands; rises with frequency on upper bands | not reported to vary; **unknown** |
| Boost/cut symmetry | not reciprocal | reciprocal |
| Filter | high-pass, 18 dB/oct, 50/80/160/300 Hz | band-pass, 12 dB/oct, 50 Hz–15 kHz |
| Max boost | ±16 dB LF, ±18 dB MF, ±16 dB HF | ±12 dB all bands |
| EQ-section nonlinearity | yes — inductor core saturation | no |
| Dominant harmonic at drive | second (Class A stages) | third (1:3 output transformer) |
| Output | >+26 dBu into 600 Ω | up to +28 dBm |

The one-sentence version for implementers: **the British unit's character is in the inductors and the
Class A stages, the American unit's is in the proportional-Q law and the step-up output transformer,
and they must not share a filter engine.**

## 9. Published measurements

### 9.1 British lineage

| Quantity | Value | Conditions |
|---|---|---|
| EIN | better than −125 dBu | at 60 dB gain |
| Distortion | not more than 0.07 % | 50 Hz to 10 kHz, +20 dBu output into 600 Ω, 80 kHz measurement bandwidth |
| Noise | −83 dBu | all line gain settings, 22 Hz–22 kHz |
| Frequency response | ±0.5 dB, 20 Hz–20 kHz; −3 dB at 40 kHz | |
| Maximum output | > +26 dBu | into 600 Ω |
| Mic gain | +20 to +80 dB, 5 dB steps | |
| LF shelf | ±16 dB at 35/60/110/220 Hz | |
| MF bell | ±18 dB at 360 Hz/700 Hz/1.6/3.2/4.8/7.2 kHz, fixed Q | |
| HF shelf | ±16 dB at 12 kHz | |
| HPF | 18 dB/octave at 50/80/160/300 Hz | |

### 9.2 American lineage

| Quantity | Value | Conditions |
|---|---|---|
| Boost/cut | ±2, 4, 6, 9, 12 dB, five steps | reciprocal |
| Bandwidth | ≈3 octaves at 2 dB; ≈1 octave at 12 dB | proportional Q |
| Band-pass filter | 12 dB/octave, 50 Hz–15 kHz | switchable, independent of EQ |
| Maximum output | up to +28 dBm | |
| Output transformer | 1:3 | |

No THD, noise or frequency-response specification for the American unit was located in a citable
form. **Unknown**, and obtaining a measured THD-versus-level curve for it is the highest-value
outstanding research item for this sheet. No published curve family exists for either unit in a form
this research could cite.

## 10. Verification — measurements for the QA agent

Run at 48 kHz and 96 kHz. Drive at −20 dBFS for response measurements.

**British lineage**

1. **Band maxima.** For each LF frequency, maximum boost and maximum cut. Target ±16 dB, tolerance
   ±1.5 dB. For each MF frequency, target ±18 dB, tolerance ±1.5 dB. HF shelf at 12 kHz, target
   ±16 dB, tolerance ±1.5 dB.
2. **Mid-band Q versus frequency — the critical inductor test.** Measure the −3 dB bandwidth of the mid
   bell at +12 dB boost at 360 Hz and at 7.2 kHz. **Assert the Q at 7.2 kHz is measurably higher than
   at 360 Hz**, by at least 20 %. A model with one Q constant per band fails here, and this test is the
   direct expression of the documented switching scheme (both L and C switched on the lower bands,
   only C on the upper).
3. **Constant bandwidth versus amount.** Measure the mid bell's Q at +4 dB and at +18 dB at 1.6 kHz.
   **Assert Q rises with amount** by at least 30 %.
4. **Shelf shape.** The LF shelf at 60 Hz, +16 dB. Assert the response has a local maximum or a
   flattening feature near the transition rather than the monotonic asymptotic approach of a
   first-order shelf, and log the deviation from a first-order shelf fitted to the same corner and
   amount. No absolute target; this establishes the regression baseline.
5. **High-pass slope.** For each of 50, 80, 160, 300 Hz, measure the slope one to two octaves below the
   corner. Target 18 dB/octave, tolerance ±2 dB/octave. Assert the phase response is minimum-phase by
   checking the group delay is not constant across the transition.
6. **Band interaction.** Measure the mid band's response at 1.6 kHz, +12 dB, with the LF shelf at 0 and
   again at +16 dB at 220 Hz. **Assert the mid band's peak gain changes by a non-zero but small
   amount** (target: between 0.2 dB and 2 dB of change). Zero change means the bands have been
   implemented as independent summed biquads.
7. **Inductor saturation.** 40 Hz sine, LF shelf +16 dB at 35 Hz, at a level 12 dB below clipping.
   **Assert measurable harmonic distortion at least 6 dB above the same measurement with the LF shelf
   at 0.** If flat-EQ and boosted-EQ distortion are equal, the EQ section is linear and the inductor
   model is missing.
8. **Bypass equivalence.** EQ IN at zero versus EQ OUT: within 0.2 dB and within 10 % relative THD.
   The preamp colour must survive EQ bypass.
9. **Baseline specifications.** THD ≤ 0.07 % at +20 dBu-equivalent, 50 Hz–10 kHz, tolerance +0.03
   percentage points. Noise −83 dBu at line gain, tolerance ±3 dB. Response ±0.5 dB 20 Hz–20 kHz with
   EQ flat, tolerance ±0.3 dB additional; −3 dB at 40 kHz, tolerance ±10 kHz on the corner.
10. **Harmonic profile.** 1 kHz at +20 dBu-equivalent. Assert second harmonic exceeds third by at least
    4 dB. Assert 40 Hz THD exceeds 1 kHz THD at the same level by at least 3 dB (transformer
    signature).

**American lineage**

11. **Step values.** For each band and each of the five steps, measure peak gain. Targets 2, 4, 6, 9,
    12 dB, tolerance ±0.5 dB. Assert the cut steps mirror the boost steps to within 0.3 dB.
12. **Proportional Q — the critical test.** For the mid band at 1.5 kHz, measure −3 dB bandwidth in
    octaves at each of the five steps. Targets: **3 octaves at 2 dB (tolerance ±0.6 octave) and
    1 octave at 12 dB (tolerance ±0.2 octave)**. Assert bandwidth is strictly decreasing across the
    five steps.
13. **The stacking test.** Two bands at overlapping frequencies, both at +6 dB, versus one band at
    +12 dB. Assert the two-band result has at least 1.5× the −3 dB bandwidth of the single-band result
    at comparable peak gain. This is the strongest single confirmation that proportional Q is real in
    the model rather than a cosmetic Q curve.
14. **Reciprocity.** +6 dB on band 2 at 1.5 kHz in series with −6 dB on band 2 at 1.5 kHz (two
    instances). Assert the combined response is within 0.5 dB of flat from 20 Hz to 20 kHz.
15. **Shelf/peak switch.** Bands 1 and 3 in shelf mode at maximum. Assert the response is asymptotic
    (gain at 20 Hz within 1 dB of gain at 50 Hz for band 1 shelf) rather than peaking.
16. **Band-pass filter.** Assert 12 dB/octave slopes, tolerance ±2 dB/octave, with −3 dB points at
    50 Hz and 15 kHz, tolerance ±15 % on each corner. Assert the filter's response is unchanged by any
    EQ setting.
17. **No EQ-section saturation.** Repeat test 7's method on this device. **Assert the difference in
    distortion between flat EQ and full low boost at the same output level is less than 3 dB.** This
    device has no inductors and must not gain low-frequency EQ saturation by copy-paste from the
    British model.
18. **Output transformer signature.** 40 Hz at a level near +28 dBm-equivalent. Assert third harmonic
    exceeds second by at least 4 dB.
19. **Cross-family check.** Run tests 3 and 12 on both models. Assert the British model's Q *rises*
    with amount and the American model's bandwidth *falls* with amount, and that the two engines
    produce measurably different curve shapes for nominally equivalent settings. If they match, the
    two devices are sharing a filter engine and one of them is wrong.

## 11. Sources, and where they conflict

**British lineage**

* AMS Neve 1073 product documentation (ams-neve.com, 1073 mic preamp and equaliser; 1073LBEQ module)
  — band structure, ±16 dB shelves, ±18 dB fixed-Q mid with the six centre frequencies, 18 dB/octave
  high-pass at 50/80/160/300 Hz, mic gain +20 to +80 dB in 5 dB steps, Class A, Marinair input
  transformers.
* Neve 1073 and 1084 user manual, issue 5 (via Scribd and the AMS Neve PDF library), and the 1073
  documentation pack at technicalaudio.com/neve/neve_pdf/1073-fullpak.pdf — EIN better than −125 dBu
  at 60 dB gain, distortion not more than 0.07 % from 50 Hz to 10 kHz at +20 dBu into 600 Ω in an
  80 kHz bandwidth, noise −83 dBu at all line gain settings 22 Hz–22 kHz, response ±0.5 dB 20 Hz–20 kHz
  and −3 dB at 40 kHz, maximum output >+26 dBu into 600 Ω.
* SI14 Lab, "Circuit Analysis of Neve 1073 Preamp (BA 283)", and GroupDIY threads 69131 and 41022 —
  BA283 as two common-emitter stages plus an emitter follower with feedback setting AC gain and DC
  conditions; EQ, filters and fader inserted between two amplifier stages; the BA284 EQ amplifiers
  functioning as inverting op-amps with reactive feedback networks.
* GroupDIY, "Neve 1073 inductor questions" and "Inductors for Neve type EQ design" (threads 2368,
  90093) — for the lower bands both inductance and capacitance are switched giving roughly constant Q,
  while on the upper bands only the capacitors are switched with inductance held constant, giving Q
  that increases with centre frequency.
* Gearspace threads 872168 and 1009466 on the 1073 mid-band Q — estimates between 1.0 and 1.7, and the
  observation that the "fixed Q" behaves as constant bandwidth, narrowing as boost or cut increases.

**American lineage**

* API 550A product page and manual (apiaudio.com/product/550a-discrete-3-band-eq;
  barryrudolph.com/recall/manuals/api550a.pdf) — reciprocal equalisation at 15 points in five steps to
  ±12 dB, three overlapping ranges, bands 1 and 3 selectable peak or shelf, band-pass filter insertable
  independently, proportional Q.
* Universal Audio API 500 Series EQ Collection manual (help.uaudio.com article 32524771071636) — the
  frequency lists for all three bands.
* Big Fish Audio and Alto Music 550A listings — the step values ±2, 4, 6, 9, 12 dB.
* Mix Online, "API 550A EQ", and Gearspace "API 550 history / tech info" (thread 723544) — bridged-T
  RC networks, two 2520 discrete op-amp modules, 1:3 output transformer, up to +28 dBm output,
  switchable 12 dB/octave 50 Hz–15 kHz band-pass filter, and the statement that the graphic sibling
  uses a gyrator design while the 550A uses filters in the feed-forward or feedback path with a
  summing node.
* Waves, "API 550 or API 560? The Differences Explained" — the proportional-Q figures: approximately
  three octaves wide at 2 dB of boost/cut narrowing to approximately one octave at 12 dB.
* API 550B documentation (barryrudolph.com/recall/manuals/api550balt.pdf) and Waves' 550 comparison —
  four overlapping bands, seven frequency positions per band, shelf/peak on bands 1 and 4.

**General**

* Whitlock, "Audio Transformers" (Jensen) — transformer hysteresis and saturation mechanisms, nickel
  versus steel core behaviour, third-harmonic dominance and frequency-inverse distortion.
* Elliott Sound Products, "Valves — Distortion + Intermod", and push-pull cancellation literature —
  used here for the general single-ended versus balanced harmonic argument applied to the Class A
  stages.

**Conflicts and resolutions.**

*British high shelf: ±16 dB or ±18 dB?* The manufacturer's own documentation gives **±16 dB** at
12 kHz. A plug-in emulation's documentation gives ±18 dB. This sheet uses the manufacturer's figure.

*British mid-band Q.* No manufacturer figure exists. Community estimates span 1.0 to 1.7 and one is
derived from matching a hardware emulation rather than from measuring hardware. **Recorded as unknown**
with a working value of 1.2 flagged as inference. The *behaviour* — constant bandwidth, Q rising with
frequency on the upper positions — is better attested than any number and is what the QA tests check.

*American unit: "15 points" or "21 points"?* The manufacturer's own product page says reciprocal
equalisation at **15 points** in five steps, which is consistent with three bands of five frequencies.
A retail listing says 21 points. **15 is correct**; 21 appears to be an error or a conflation with the
four-band sibling.

*Whether the American unit uses inductors.* Widely assumed, including in the brief for this project,
and **incorrect for the 550A**. The published circuit description is bridged-T RC networks; the
gyrator-based design is the graphic sibling. This is the most consequential correction in this sheet
and §7.2 and QA test 17 both depend on it.

*550B step values.* Manufacturer copy describes seven switchable frequency positions per band, but the
boost/cut step values for the 550B were not established. **Unknown.**
