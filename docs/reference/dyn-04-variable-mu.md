# DYN-04 — Variable-Mu Tube Limiter

**Reference Spec Sheet — Motion Wave Research, internal only.**

Reference hardware studied: Fairchild model 670 stereo limiter (and its mono sibling, the 660).
**The manufacturer and model names in this document exist only in these research notes.** They must
not appear in shipped UI strings, class or file names, preset names, parameter identifiers, or
marketing copy. No panel artwork, logo, typeface or badge has been described here or may be traced;
the era's design language — a wide 6U chassis, two symmetrical channel strips of small stepped knobs
flanking a pair of VU meters, a mode switch between them — is general to late-1950s American disk
mastering equipment and is fair to evoke.

Sources are the manufacturer's owner's manual, peer-reviewed circuit modelling, published reviews
with measurements, and published circuit discussion. Nothing here derives from disassembling or
extracting assets from any commercial product.

---

## 1. What this unit is

The gain-reduction element is the audio amplifier itself. A remote-cutoff ("variable-mu") twin triode
runs as a push-pull amplifier between an input and an output transformer, and the sidechain shifts its
grid bias. As bias goes more negative the tube's transconductance falls and the stage's gain falls
with it. There is no separate attenuator, no photocell, no FET — **the thing being distorted and the
thing doing the compressing are the same component**, which is why gain reduction and harmonic
content on this unit are inseparable in a way they are not on DYN-02 or DYN-03.

It is a feedback design: the sidechain amplifier monitors the output voltage to control the gain of
the signal amplifier.

The stereo unit was built for disk mastering, and its stereo modes reflect the geometry of a cutting
lathe rather than the geometry of a mix bus.

## 2. Signal path block diagram

Per channel (the stereo unit contains two, exactly balanced):

```
   balanced in 600 R
        |
  [ INPUT GAIN ]  stepped attenuator, 1 dB/step, 20 dB total
        |
  [ INPUT TRANSFORMER ]  dual primary windings; in LAT/VERT mode the
        |                windings are switched to L+R and L-R to form
        |                the sum/difference matrix
        |
  +-----v----------------------------------------+
  |  VARIABLE-MU PUSH-PULL AMPLIFIER              |
  |  4 x 6386 remote-cutoff twin triode per       |
  |  channel; grid bias is the control input      |
  +-----+----------------------------------------+
        |
  [ OUTPUT TRANSFORMER ]  dual secondaries; in LAT/VERT mode switched
        |                 L+R and L-R to decode back to left/right
   balanced out
        |
        +----------------------------------+
                                           |  FEEDBACK: the sidechain
                                           |  monitors the OUTPUT
                     +---------------------v---------------------+
                     |  THRESHOLD control (AC threshold)         |
                     +---------------------+---------------------+
                                           |
                     [ SIDECHAIN AMPLIFIER, 6973 push-pull ]
                                           |
                     [ RECTIFIER ]
                                           |
                     [ TIME CONSTANT switch, 6 positions ]
                     |  sets the RC network(s) that shape the
                     |  control voltage; positions 5 and 6 use
                     |  more than one time constant at once
                                           |
                     [ DC THRESHOLD trim ] --> grid bias of the 6386s
```

Twenty valves and eleven transformers plus two inductors in the complete stereo unit, but almost none
of that is in the audio path: the audio path is a single variable push-pull amplification stage
between two transformers. Everything else is supply, sidechain and metering. **Implementer rule: the
model's audio path should be short — two transformers and one push-pull gain block — and the
complexity should live in the control path.**

## 3. Controls

### 3.1 INPUT GAIN

Stepped attenuator, **1 dB per step, 20 dB of range**, panel scale reading 20 down to 0. It is purely
an attenuator: fully clockwise (0 on the scale) is zero attenuation, and there is no gain available
here. Default 0 (no attenuation).

Because the threshold is set separately and the sidechain is fed from the output, INPUT GAIN sets how
hard the tube is driven for a given amount of gain reduction. It is the drive control.

### 3.2 THRESHOLD (AC threshold)

Continuous rotary, panel scale 0 to 10. **Reversed sense: 10 fully clockwise is no compression, 0 is
maximum compression.** Default 10. This is the second control in this project whose panel sense is
inverted relative to modern convention (DYN-03's time constants are the first), and it is exactly the
kind of detail that gets silently "fixed" in an emulation and then reported as a bug by users who know
the hardware. **Keep the inverted sense and label the control accordingly.**

### 3.3 TIME CONSTANT

Six-position rotary switch. See §4 for the values. Default position 4 (**marked as inference**; no
published default exists, and 4 is chosen because it is the slowest of the fixed-release positions
and therefore the most generally usable starting point).

### 3.4 METER selector

Switch per channel. On the hardware its positions are used for calibration as well as for reading
gain reduction. The exact position set is **unknown** from the sources consulted; the gain-reduction
position is the only one that matters for Motion Wave. Model the meter as reading gain reduction in
dB with standard VU ballistics.

### 3.5 LATERAL / VERTICAL versus LEFT / RIGHT mode switch

Two positions on the stereo unit.

- **LEFT/RIGHT**: the two channels operate independently on the two inputs.
- **LATERAL/VERTICAL**: a sum/difference matrix is formed _in the transformers themselves_. The input
  transformer's dual primary windings are switched to L+R and L−R; the two channels then compress the
  sum (lateral) and difference (vertical) signals independently; the output transformer's dual
  secondaries are switched L+R and L−R to decode back to left and right. This is the same operation
  now called mid/side, and it was named for the motion of a cutting stylus: lateral motion carries the
  mono-compatible content, vertical motion carries the difference.

**Implementer rule.** Encode with M = (L+R), S = (L−R), process, decode with L = (M+S), R = (M−S), and
apply the ×0.5 scaling once, on decode, so that a null side signal passes the lateral channel at unity.
Do not link the two channels' detectors in this mode — the whole point is that they are independent.
**Marked as inference:** the exact gain scaling in the reference unit's matrix follows from the
transformer turns ratios, which are not published; the ×0.5-on-decode convention is our choice and
should be documented as such.

The two channels' controls are also independent in both modes, which means a user can set different
thresholds and different time constants for lateral and vertical. Preserve that; it is the reason the
unit is still used on mix buses.

### 3.6 DC THRESHOLD (internal/rear trim)

Sets the standing grid bias of the gain tubes, and therefore the level at which limiting begins and
the effective ratio. The documented adjustment procedure is to apply a signal 3 dB above the desired
output level and adjust the DC threshold for the desired output level. Published descriptions say
this trim moves the effective ratio across roughly **2:1 to 30:1**.

Not a user control on the hardware. Motion Wave should expose it, because without it the unit's ratio
range is inaccessible, but it should be a secondary control with a calibrated default.

### 3.7 Interaction summary

1. INPUT GAIN sets drive, not threshold. Threshold is set by THRESHOLD and DC THRESHOLD.
2. THRESHOLD and DC THRESHOLD together set both the onset and the ratio — see §5.
3. TIME CONSTANT positions 5 and 6 make the release a function of the programme, so THRESHOLD
   indirectly changes the release in those positions.
4. In lateral/vertical mode the two channels' controls apply to M and S, not to L and R.

## 4. Time constants

The manufacturer's owner's manual gives six positions. Attack and release both change with position;
positions 5 and 6 have programme-dependent release with more than one published figure each.

| Position | Attack | Release                                                                                         |
| -------- | ------ | ----------------------------------------------------------------------------------------------- |
| 1        | 0.2 ms | 0.3 s                                                                                           |
| 2        | 0.2 ms | 0.8 s                                                                                           |
| 3        | 0.4 ms | 2 s                                                                                             |
| 4        | 0.4 ms | 5 s                                                                                             |
| 5        | 0.4 ms | 2 s for individual peaks; 10 s for multiple peaks                                               |
| 6        | 0.2 ms | 0.3 s for individual peaks; 10 s for multiple peaks; 25 s for consistently high programme level |

**Implementer rules for positions 5 and 6.** These are not "auto release" in the modern
envelope-follower sense; they are multiple RC networks with different time constants sharing one
control node, so the _observed_ release is the superposition of a fast branch that discharges quickly
and a slow branch that accumulates.

1. Give the control voltage two parallel storage elements in positions 5 and 6, and three in position
   6: a fast branch at the "individual peaks" figure, a medium branch at 10 s, and in position 6 a
   slow branch at 25 s.
2. Each branch charges during gain reduction and discharges at its own rate. The gain reduction
   applied is the maximum (or the sum, depending on how the branches are wired — **unknown**, and this
   is the one structural detail that needs the schematic) of the branches' contributions.
3. A single isolated peak charges mainly the fast branch and therefore recovers in the "individual
   peaks" time. Repeated peaks accumulate charge in the medium branch faster than it discharges, so
   the recovery lengthens toward 10 s. Sustained high level charges the slow branch and the recovery
   lengthens toward 25 s.
4. The transition between these regimes must be continuous, not switched. There is no threshold at
   which "multiple peaks" begins.

**Attack** is 0.2 ms or 0.4 ms depending on position — fast, but two orders of magnitude slower than
DYN-03. That is the reason this unit does not produce detector-ripple distortion on bass material the
way DYN-03 does: at 0.2 ms the detector cannot track within the cycle of a 60 Hz note.

## 5. Filter topology, curve shape, and departure from ideal

There is no user filter. The compression curve is where this unit departs most sharply from a textbook
compressor.

- **The ratio is not a control and not a constant.** The manual states that the compression ratio is a
  function of the amount of limiting as well as of the setting of the two threshold controls, and that
  it can be set to operate anywhere from 2:1 to 30:1. Published figures for the two extremes: as a
  compressor, 2:1 with a threshold 5 dB below normal programme level; as a peak limiter, 30:1 with a
  threshold 10 dB above normal programme level.
- **Ratio rises with gain reduction.** This is inherent to the remote-cutoff tube: its
  transconductance falls non-linearly with bias, so each additional dB of control voltage buys more dB
  of gain reduction than the last. The curve is therefore continuously bending upward, with no knee
  and no straight segment anywhere.
- **Distortion is a function of gain reduction.** The DAFx-12 modelling work on this unit specifically
  reports gain-reduction-dependent distortion as one of the device characteristics its model
  reproduces. This is the direct consequence of the gain element being the amplifier: driving the tube
  toward cutoff moves it into the curved part of its characteristic.

**Implementer rule:** model the tube's transconductance-versus-bias curve and let the ratio, the knee
and the distortion all emerge from it. A ratio parameter with a knee parameter will not reproduce any
of the three correctly at the same time.

The best available circuit-level reference is Raffensperger, "Toward a Wave Digital Filter Model of
the Fairchild 670 Limiter", DAFx-12, York, September 2012, which introduces a model for the 6386
triode specifically and combines a wave digital signal amplifier with a hybrid black-box sidechain.
The DSP team should obtain that paper; the open-source `wavechild670` implementation derived from it
is also available and is useful for cross-checking behaviour, though it must be treated as reference
reading and not as code to copy without checking its licence.

## 6. Nonlinearity sources, located in the path

1. **Input transformer.** Low-frequency, level-dependent, third-harmonic-dominant hysteresis and
   saturation (Whitlock, Jensen). In lateral/vertical mode the matrix is formed in this transformer,
   so **transformer nonlinearity happens after the M/S encode**, and any asymmetry between the windings
   produces a small amount of crosstalk between the lateral and vertical paths. **Marked as
   inference**, but worth modelling: it is a genuine difference between doing M/S in transformers and
   doing it in software.
2. **The 6386 push-pull gain stage — the dominant nonlinearity.** Two mechanisms superimpose:
   - _Push-pull cancellation of even harmonics._ A balanced push-pull stage cancels second-order
     product, leaving **third-harmonic-dominant** distortion. This is the opposite of the
     single-ended-triode signature in DYN-01 and DYN-02 and it is why this unit sounds firm rather
     than warm at moderate drive.
   - _Bias-dependent curvature._ As the sidechain drives the grids toward cutoff, the operating point
     moves into the curved region and total distortion rises with gain reduction. Any imbalance
     between the two halves also un-cancels some second harmonic, so at deep gain reduction the
     second harmonic reappears.
3. **The sidechain amplifier and rectifier.** Inside the feedback loop; distorts the control voltage
   rather than the audio, changing the shape of the curve. Model as a static nonlinearity on the
   control signal.
4. **Output transformer.** Highest-level element; dominant contributor to low-frequency thickening.
   In lateral/vertical mode it performs the decode, so its nonlinearity sits before the M/S decode
   from the listener's point of view.
5. **Valve ageing.** The unit is documented as consuming its gain valves quickly, and worn valves
   change both the gain and the bias-versus-transconductance curve. This is the physical basis for a
   "valve condition" parameter if Motion Wave wants one.

## 7. Character artefacts a user notices

- **Compression that tightens as it deepens**, because the ratio rises with gain reduction.
- **Distortion that arrives with the compression** rather than with the level.
- **Third-harmonic-led firmness at moderate drive**, with second harmonic appearing at deep reduction
  as the push-pull balance is disturbed.
- **Very long recoveries on dense material** in positions 5 and 6 — up to 25 s, which is long enough
  that the unit's gain audibly does not return between sections of a song.
- **Independent lateral and vertical behaviour** producing width changes: heavy compression on the
  vertical channel narrows the image, heavy compression on the lateral channel widens it.
- **Noise floor** specified 70 dB below +4 dBm — the noisiest of the five units, and audibly so.
- **Channel-to-channel drift** from valve ageing, which in lateral/vertical mode manifests as an image
  shift rather than as a level imbalance.

## 8. Published measurements

From the manufacturer's owner's manual unless stated.

| Quantity                   | Value                                              | Conditions                                              |
| -------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| Intermodulation distortion | < 1 %                                              | any level up to +18 dBm output, no limiting             |
| Intermodulation distortion | < 1 %                                              | +12 dBm output, with limiting                           |
| Frequency response         | 40 Hz to 15 kHz, ±1 dB                             |                                                         |
| Input and output impedance | 600 Ω                                              |                                                         |
| Input level range          | 0 dBm to +16 dBm                                   |                                                         |
| Output level               | +4 or +8 dBVU; +27 dBm clipping point              |                                                         |
| Noise                      | 70 dB below +4 dBm                                 |                                                         |
| Ratio range                | 2:1 to 30:1                                        | function of limiting amount and both threshold controls |
| As compressor              | 2:1, threshold 5 dB below normal programme level   |                                                         |
| As peak limiter            | 30:1, threshold 10 dB above normal programme level |                                                         |
| Attack                     | 0.2 to 0.4 ms                                      | by time-constant position                               |
| Release                    | 0.3 s to 25 s                                      | by time-constant position and programme                 |
| Input gain attenuator      | 20 dB range, 1 dB steps                            |                                                         |

Note that the distortion figures are **intermodulation**, not THD. No published THD-versus-gain-
reduction curve was located, and that is the measurement Motion Wave most needs. **Obtaining a
THD-versus-gain-reduction curve is the highest-value outstanding research item for this unit.**

## 9. Verification — measurements for the QA agent

1. **Time constants, fixed positions.** For positions 1–4, step a 1 kHz sine to produce 10 dB of gain
   reduction. Measure 10 %–90 % attack and the time to recover to 1 dB remaining. Targets from the
   table in §4; tolerance ±30 % relative on attack (the published figures are coarse) and ±20 %
   relative on release.
2. **Position 5, individual peak.** A single 50 ms burst producing 10 dB of reduction. Measure recovery
   to 1 dB. Target 2 s, tolerance ±40 % relative.
3. **Position 5, multiple peaks.** Ten such bursts at 500 ms intervals, then silence. Measure recovery
   to 1 dB from the last burst. Target 10 s, tolerance ±40 % relative. **Assert this is at least 3×
   the value from test 2.**
4. **Position 6, three regimes.** Repeat tests 2 and 3 in position 6 (targets 0.3 s and 10 s), then
   apply a continuous tone producing 10 dB of reduction for 60 s and measure recovery. Target 25 s,
   tolerance ±40 % relative. **Assert the three values are strictly increasing.** A model that returns
   the same recovery for all three has no multi-branch storage and fails.
5. **Continuity.** Sweep burst repetition rate continuously from 0.2 Hz to 5 Hz in position 5 and plot
   recovery time. Assert the curve is monotonic and has no step discontinuity. There must be no
   "multiple peaks detected" switch.
6. **Ratio rises with reduction.** Sweep input and measure the local slope at 3 dB, 10 dB and 20 dB of
   gain reduction. **Assert each is strictly greater than the previous**, and that the slope at 20 dB
   is at least 2× the slope at 3 dB.
7. **Ratio range via DC threshold.** At the two extremes of the DC threshold control, measure the local
   slope at 10 dB of reduction. Assert the range spans at least 2:1 to 20:1. The published 30:1 upper
   figure is a peak-limiting condition; 20:1 is used as the pass floor to avoid failing on a
   measurement-condition mismatch.
8. **Threshold control sense.** Assert that _decreasing_ the THRESHOLD control value increases gain
   reduction. An implementation with conventional sense has inverted the panel.
9. **Harmonic profile at moderate drive.** 1 kHz, 3 dB of gain reduction. **Assert third harmonic
   exceeds second harmonic by at least 6 dB.** This is the push-pull signature and it is the single
   test that distinguishes this unit's model from DYN-01's and DYN-02's.
10. **Distortion rises with gain reduction.** 1 kHz at 3 dB and at 20 dB of reduction, output level
    normalised. **Assert THD at 20 dB exceeds THD at 3 dB by at least 10 dB.**
11. **Second harmonic returns at depth.** At 20 dB of reduction, assert the second-to-third harmonic
    ratio has risen by at least 6 dB relative to the 3 dB case. This checks that the push-pull balance
    is being disturbed by the bias shift rather than being enforced perfectly.
12. **Lateral/vertical matrix correctness.** Feed a mono signal with the mode in LAT/VERT and both
    channels bypassed of compression. Assert the vertical channel output is at least 60 dB below the
    lateral channel. Feed an anti-phase signal and assert the reverse. Then assert L and R at the
    output match L and R at the input to within 0.1 dB.
13. **Lateral/vertical independence.** With heavy compression on vertical only, assert the mono sum is
    unchanged to within 0.5 dB while the difference signal is reduced. With heavy compression on
    lateral only, assert the reverse.
14. **No detector linking in LAT/VERT.** Apply a signal present only in the side channel. Assert the
    lateral channel shows less than 0.5 dB of gain reduction.
15. **Baseline specifications.** Frequency response 40 Hz–15 kHz within ±1 dB, tolerance ±0.5 dB
    additional. Noise 70 dB below +4 dBm, tolerance ±3 dB. Clipping point +27 dBm-equivalent,
    tolerance ±2 dB.

## 10. Sources, and where they conflict

- Fairchild 670 owner's manual, Internet Archive full text
  (archive.org/stream/Fairchild_670_owners_manual/Fairchild_670_owners_manual_djvu.txt) and via
  ManualsLib (manualslib.com/manual/1014936) — the six time-constant positions and their attack and
  release figures including the individual-peaks / multiple-peaks / consistently-high wording,
  distortion, frequency response, impedances, levels, noise, ratio range, control complement, and the
  DC threshold adjustment procedure.
- Sound On Sound, "Fairchild 660 & 670" — audio path is a single variable push-pull amplification
  stage between input and output transformers, exactly balanced in the stereo unit; most of the
  chassis is not in the audio path.
- Sound On Sound, "Heritage Audio Herchild 670" — input gain is a 1 dB-per-step 20 dB attenuator with
  a 20-to-0 scale; the AC threshold has a 0-to-10 scale on which 10 is no compression and 0 is maximum
  compression.
- Vintage Digital and Vintage King 670 pages — 20 valves, 11 transformers, 2 inductors, 6U, 65 lb;
  valve complement including eight 6386 (four per channel), two 12AX7, four 6973, two 12BH7, E80F or
  EF806, 5651, EL34, GZ34.
- Raffensperger, "Toward a Wave Digital Filter Model of the Fairchild 670 Limiter", DAFx-12, York,
  September 2012 (dafx.de paper archive) — feedback topology with the sidechain monitoring the output
  voltage, a novel 6386 triode model, hybrid WDF/black-box sidechain, and explicit discussion of static
  gain characteristics and gain-reduction-dependent distortion. Companion open-source implementation:
  github.com/praffensperger/wavechild670.
- GroupDIY threads on the 670's lateral/vertical switching circuit and matrix wiring (threads 26968,
  48649, 62543) and mix:analog's 670 tutorial — dual primary windings switched to L+R and L−R to
  encode, dual output windings switched to decode, lateral corresponding to mid and vertical to side.
- Penny Cool and Native Instruments 670 features — the DC threshold moving the effective ratio from
  roughly 2:1 to 30:1 and the variable-mu control mechanism.
- Whitlock, "Audio Transformers" (Jensen) — transformer nonlinearity mechanisms.
- Elliott Sound Products, "Valves — Distortion + Intermod", plus push-pull cancellation discussion —
  even-order cancellation in balanced stages and the residual third harmonic.

**Conflicts and resolutions.**

_Position 6, individual-peak release._ The manual's full text as archived gives **0.3 s**. A widely
reproduced secondary table gives 0.8 s. The archived manual text is the primary source and this sheet
uses **0.3 s**, which also makes the table internally consistent: position 6 shares position 1's
0.2 ms attack and position 1's 0.3 s release, and adds the programme-dependent branches on top. QA
test 4 uses the 0.3 s figure with a wide tolerance so that either value passes; the strict assertion
is the ordering, not the absolute number.

_Whether positions 5 and 6 are "automatic release"._ Some sources call them auto-release settings.
The manual describes them as an automatic function of programme material with several stated figures,
which is a description of a multi-time-constant network, not of an adaptive algorithm. **Model the
network**; the adaptive behaviour is emergent. §4 gives the rule.

_Ratio._ Sources give 2:1 to 30:1 and also "1:2 to 1:30" (the same range written the other way round).
There is no conflict of substance. The important point, which every source agrees on, is that the
ratio is not a setting but a consequence.

_Meter switch positions._ Not established. **Unknown** — recorded as such rather than guessed.
