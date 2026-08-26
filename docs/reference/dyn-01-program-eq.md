# DYN-01 — Passive Program Equaliser with Tube Make-Up Amplifier

**Reference Spec Sheet — Motion Wave Research, internal only.**

Reference hardware studied: Pulse Techniques (Pultec) EQP-1A program equaliser, and the
documentation published for it and its descendants. **The manufacturer and model names in this
document exist only in these research notes.** They must not appear in shipped UI strings, class or
file names, preset names, parameter identifiers, or marketing copy. Implementers take the behaviour,
not the badge. No panel artwork, logo, typeface or badge from the reference unit has been described
here or may be traced; where this sheet talks about appearance it describes the general design
language of late-1950s American broadcast outboard, which the UI team is free to evoke.

Everything below is drawn from published manuals, manufacturer specification sheets, academic
modelling papers and published measurement discussion. Nothing here comes from disassembling,
decompiling or extracting assets from any commercial product, and no implementer should do so.

---

## 1. What this unit is

It is a two-band passive equaliser followed by a valve amplifier that exists only to make back the
loss of the passive network. The manual is explicit that the amplifier restores the insertion loss
of the equalising network, giving what the manufacturer described as a no-loss, no-gain unit
(Pultec EQP-1A installation and operating instructions, as reproduced by ManualsLib and Manualzz).
That architecture is the single most important fact for the model: the tone-shaping element is
lossy, reactive and entirely passive, and the colour that people attribute to the "EQ" is largely
contributed by the amplifier and its output transformer, which are in circuit at all times,
including when every EQ control is at zero.

## 2. Signal path block diagram

```
        balanced 600 R in
              |
      [ INPUT TRANSFORMER ]            600 R primary, per manual
              |
              +-------------------------------------------+
              |                                           |
    +---------v-----------+                     +---------v-----------+
    |  LOW-FREQUENCY      |                     |  HIGH-FREQUENCY     |
    |  SHELVING SECTION   |                     |  SECTION            |
    |                     |                     |                     |
    |  LOW FREQ selector  |                     |  HI FREQ selector    |
    |   20/30/60/100 Hz   |                     |   3/4/5/8/10/12/16k  |
    |   (sets L and C for |                     |  BOOST  -> bell,     |
    |    BOTH boost and   |                     |    Q set by BANDWIDTH|
    |    atten legs)      |                     |                      |
    |  BOOST  -> shelf up |                     |  ATTEN SEL 5/10/20k  |
    |  ATTEN  -> shelf dn |                     |  ATTEN -> HF shelf dn|
    +---------+-----------+                     +---------+-----------+
              |                                           |
              +----------------- passive LCR --------------+
                                  network
                                     |
                        insertion loss, always present
                                     |
                      [ VALVE MAKE-UP AMPLIFIER ]
                         12AX7 / ECC83 voltage amp
                                     |
                         12AU7 / ECC82 driver stage
                                     |
                      [ OUTPUT TRANSFORMER ]  600 R load
                                     |
                              balanced output
```

The whole EQ network sits _between_ the input transformer and the valve amplifier. There is no
active filter anywhere. The tube complement is documented as an ECC83/12AX7 in the input section of
the amplifier and an ECC82/12AU7 driving the output transformer (Sonic Circus, Odyssey Pro Sound,
and Wikipedia's EQP-1 article all agree on this pairing).

The IN/OUT (EQ bypass) switch removes the passive network from the path but leaves the amplifier and
both transformers in circuit. **Implementer rule: bypassing the EQ in Motion Wave must not bypass
the amplifier stage.** A user who switches the EQ out should still hear the transformer and valve
colouration and should still see the same output level, because the amplifier gain does not change.

## 3. Controls

### 3.1 LOW FREQUENCY selector

Four stepped positions: 20, 30, 60, 100 Hz. Rotary switch, no intermediate values, no taper. Default
60 Hz. This one control sets the reactive components for **both** the low boost and the low
attenuation legs, which is precisely why the two interact rather than cancelling. The value shown is
a nominal design centre, not a measured -3 dB point.

### 3.2 LOW BOOST

Continuous, dial marked 0 through 10 with no dB legend on the panel. Published maximum is **+13.5 dB**
at the selected frequency (KMR Audio and Vintage King both give +13.5 dB boost / -17.5 dB attenuation
for the low band). A competing figure of +18 dB circulates, but it comes from a plug-in emulation's
documentation rather than from the hardware manual, so this sheet takes +13.5 dB. Default 0.

The dial is not linear in dB. The audible law of a passive shelving network driven by a potentiometer
in the divider position is roughly logarithmic in the lower half of travel and compresses toward the
top. **Marked as inference:** no published measurement of the pot's dB-per-degree law was found, so
implementers should expose a shaping curve rather than hard-code a law, and QA should treat the
midpoint value as untested.

### 3.3 LOW ATTEN

Continuous, dial 0 through 10, published maximum **-17.5 dB**. Default 0. Same frequency selector as
LOW BOOST.

**The interaction that defines the unit.** Boost and attenuation on the low band are _not_ inverse
curves, so they do not cancel:

- The boost leg is a broad shelf whose influence starts well below the selected frequency and rises
  gently. Multiple sources describe it as the wider of the two.
- The attenuation leg is narrower and its effective action sits **above** the selected frequency.
  The most usefully specific published statement is that the low attenuation control behaves like a
  midrange dip operating three to four octaves above the frequency the selector names, so that with
  the selector at 30–100 Hz the dip lands somewhere between roughly 500 Hz and 2 kHz
  (Ultimate Preset's EQP-1A guide). A second source describes the combined attenuation region more
  broadly as roughly 300 Hz to 4 kHz.
- Running both at once therefore produces a boosted shelf at and below the selected frequency with a
  dip sitting above it — the "low-end trick".

The original operating instructions advise against using both at once on the low band on the theory
that they would cancel (noted by Universal Audio's Pultec collection manual and by Variety of Sound).
They do not cancel in practice, and the same Variety of Sound analysis warns that the combined
low-frequency behaviour is _unpredictable_ rather than cleanly parameterisable. **Implementer rule:**
model the two legs as separate networks sharing one frequency selector and let the combined response
fall out of the network, rather than computing a boost curve and a cut curve and adding their dB
values. A dB-domain sum will produce a symmetric result and will be wrong.

Octave offset actually used by this sheet: place the attenuation leg's centre of action **3.5 octaves
above** the selected low frequency as the starting point (30 Hz selector → about 340 Hz; 100 Hz
selector → about 1.1 kHz), then tune against the published statement that a 30–100 Hz selector
setting dips between 500 Hz and 2 kHz. **Marked as inference:** the 3.5-octave figure is the centre
of the published three-to-four-octave range, not a measured value.

### 3.4 HIGH FREQUENCY selector

Seven stepped positions: 3, 4, 5, 8, 10, 12, 16 kHz. Default 10 kHz. Sets the centre of the HF boost
bell only. It has no effect on the HF attenuation section.

### 3.5 HIGH BOOST

Continuous, 0 through 10, published maximum **+18 dB** at the selected frequency. Default 0. This is
a peaking (bell) response, not a shelf.

### 3.6 BANDWIDTH

Continuous, panel legend runs from SHARP to BROAD. It sets the Q of the HF **boost** bell and nothing
else; it does not affect the HF attenuation shelf and does not affect either low-band control. No
published numeric Q range was found, so the endpoints are **unknown**. The one usable qualitative
constraint is repeated across sources: even at its sharpest the bell is broad by modern digital
standards. **Marked as inference:** a defensible starting range for Motion Wave is Q ≈ 0.6 at BROAD
to Q ≈ 2 at SHARP, which keeps the sharpest setting well below the Q of a typical parametric, but
this range is our estimate and must be flagged as such in the implementation notes until measured.

### 3.7 ATTEN SEL (high attenuation frequency)

Three stepped positions: 5, 10, 20 kHz. Default 10 kHz. Independent of the HIGH FREQUENCY selector,
which is what allows a boost at 10 kHz and a shelf cut starting at 5 kHz simultaneously.

### 3.8 HIGH ATTEN (high-frequency attenuation)

Continuous, 0 through 10, published maximum **-16 dB**, shelving. Default 0.

Because the two HF controls have independent frequency selectors, running boost and attenuation
together on the high band is a supported, documented technique: boost at 8 or 10 kHz with a small
amount of shelf attenuation yields a peak followed by a roll-off. Model this as two independent
networks in the same passive block, not as a dB-domain sum, for the same reason as the low band.

### 3.9 EQ IN/OUT

Two-state. Removes the passive network only. See §2.

### 3.10 Control interaction summary for implementers

1. LOW FREQ is shared by LOW BOOST and LOW ATTEN.
2. HI FREQ is shared by HIGH BOOST and BANDWIDTH.
3. ATTEN SEL is used only by HIGH ATTEN.
4. Boost and cut on the same band never cancel and must never be summed in dB.
5. Every EQ control affects the level presented to the make-up amplifier, so every EQ control
   indirectly affects harmonic content. This is not a bug to be normalised away.

## 4. Time constants

This unit has no detector and no dynamics, so there are no attack or release constants. The only
time-domain behaviour that matters is the group delay and ringing of the LC sections, which follows
directly from the filter model, and the low-frequency behaviour of the two transformers, which sets
how the unit responds to sustained bass energy. See §6.

## 5. Filter topology, order and departure from ideal

The equalising network is passive LCR: inductors, capacitors and resistors with the potentiometers
acting inside the network rather than as post-filter gain trims. There is a peer-reviewed circuit
model available — Barrera, Lizarraga-Seijas and Font, "Modeling the Pultec EQP-1A with Wave Digital
Filters", 21st Sound and Music Computing Conference, Porto, July 2024 — which derived the structure
from the schematic plus LTspice simulation and implemented it as a wave digital filter, first with
R-type adaptors and then in a reduced form suitable for real time. That paper and its companion
repository are the best available primary reference for topology and component values, and the DSP
team should obtain the paper directly rather than working from this summary.

Behavioural characteristics that a textbook biquad will _not_ reproduce:

- **The low shelf is not a clean first-order shelf.** Because the boost potentiometer sits inside the
  divider that also damps the LC section, changing boost changes the damping, so the corner frequency
  and the shelf slope both move with the boost amount. **Marked as inference** from the passive
  topology; no published curve family at multiple boost settings was located.
- **The low attenuation leg's action is displaced upward in frequency** relative to the number on the
  selector, by roughly three to four octaves, as described in §3.3. An ideal low shelf cut would act
  at the labelled frequency. This displacement is the entire mechanism of the low-end trick.
- **The boost leg is broader than the cut leg** on the low band. Sources consistently describe the
  boost as the wide curve and the cut as the narrow one.
- **The HF boost bell is broad even at SHARP**, and its skirt reaches far enough down that a 16 kHz
  boost is audible in the upper midrange.
- **The HF attenuation is a shelf, not a bell**, so it cannot be cancelled by the HF boost bell.
- **Passive network insertion loss is frequency dependent**, and the amplifier is flat, so the
  "flat" setting of the unit is not perfectly flat. The manual's own specification for the amplifier
  alone is 20 Hz to 20 kHz within ±0.5 dB; no published figure for the flatness of the complete unit
  with all controls at zero was found. Treat as **unknown** and measure.

Insertion loss of the passive section in dB is **unknown** from published sources. The manual states
only the net result ("loss: none", restored by the amplifier). Do not guess a figure; if the model
needs one, derive it from the network in the SMC paper.

## 6. Nonlinearity sources, located in the path

There are four, and only one of them is in the EQ.

1. **Input transformer, 600 Ω.** Nonlinear at low frequencies and at high levels. Two distinct
   mechanisms, both documented in Bill Whitlock's audio transformer chapter for Jensen: magnetic
   hysteresis, which produces distortion at _low_ signal levels and never goes away, and core
   saturation, which produces distortion at _high_ levels. The distortion produced is predominantly
   **odd-order, third-harmonic dominant**, because the B-H loop is symmetric about the origin, and it
   is inversely proportional to frequency, so it is a bass-region effect. A published measurement of
   the general behaviour gives 2.9 % THD, almost entirely third harmonic, for a 600 mV, 30 Hz input on
   a small signal transformer; that figure characterises the mechanism, not this specific part, and
   must not be quoted as a specification of the reference unit.
2. **The passive network itself** contributes essentially no nonlinearity except through inductor core
   behaviour at high low-frequency levels. **Marked as inference:** treat as second-order and model it
   only if listening tests demand it.
3. **The valve amplifier.** A 12AX7 voltage amplifier followed by a 12AU7 driver. Single-ended triode
   stages generate rising, predominantly **second-harmonic** distortion as level increases; a
   push-pull stage cancels most even-order product and leaves third. Sources differ on whether the
   output stage of this unit is push-pull; one product description says the amplifier operates in a
   push-pull arrangement, while the tube complement (a single dual-triode driving the output
   transformer) is also consistent with a single-ended or cathode-follower arrangement. **This
   conflict is unresolved.** The better-documented and more conservative choice for Motion Wave is a
   **second-harmonic-dominant** profile at moderate drive with third harmonic emerging near clipping,
   because that is what every listening description of the unit reports, and because the input stage
   is unambiguously a single-ended small-signal triode. Flag it for measurement.
4. **Output transformer, 600 Ω load.** Same mechanisms as the input transformer, and it is the one
   working at the highest level, so it is where most of the audible low-frequency thickening happens.

## 7. Character artefacts a user notices

- **Colour at zero.** With all four EQ controls at zero the unit is not transparent. The transformers
  and valve stage remain in circuit. This is the single most commonly reported subjective property
  and the model must reproduce it.
- **Harmonic profile.** Predominantly second-harmonic from the valve stage at moderate drive, with
  third-harmonic content from both transformers concentrated below roughly 100 Hz.
- **Noise floor.** The manual gives noise 92 dB below +10 dBm. Optimum input range is -15 dBm to
  +8 dBm and maximum peak output is +21 dBm.
- **Bass thickening under sustained low-frequency energy** rather than on transients, because the
  transformer mechanisms are level and frequency dependent rather than time dependent.
- **The low-end trick's audible signature** is a lift at and below the selected frequency together
  with a scoop several hundred Hz to a couple of kHz higher, which reads as more weight and less mud
  at the same time.
- **Drift.** Valve heater warm-up and component tolerance produce unit-to-unit variation. No published
  figure for drift magnitude was found; **unknown**.

## 8. Published measurements

All from the manufacturer's installation and operating instructions unless stated.

| Quantity                     | Value                                 | Conditions                    |
| ---------------------------- | ------------------------------------- | ----------------------------- |
| Amplifier frequency response | 20 Hz to 20 kHz, ±0.5 dB              | amplifier section alone       |
| Distortion                   | ≤ 0.15 % THD                          | +10 dBm into 600 Ω            |
| Noise                        | 92 dB below +10 dBm                   | not otherwise qualified       |
| Input impedance              | 600 Ω, transformer                    |                               |
| Output                       | transformer, into 600 Ω               |                               |
| Optimum input level          | -15 dBm to +8 dBm                     |                               |
| Maximum peak output          | +21 dBm                               |                               |
| Low band                     | +13.5 dB boost / -17.5 dB attenuation | at 20, 30, 60, 100 Hz         |
| High band boost              | +18 dB                                | at 3, 4, 5, 8, 10, 12, 16 kHz |
| High band attenuation        | -16 dB                                | at 5, 10, 20 kHz              |

No published family of frequency-response curves at stated control positions was located in a form
this research could cite. The reference unit's manual is reported to contain cut curves; that PDF
could not be retrieved from this machine. **Obtaining the manual's curve plates is the highest-value
outstanding research item for this unit.**

## 9. Verification — measurements for the QA agent

Run all of these at 48 kHz and at 96 kHz. Unless stated, drive at -20 dBFS to keep nonlinearity out
of the frequency-response measurements.

1. **Unity check.** All EQ controls at zero, EQ IN. Sweep 20 Hz–20 kHz. Target: within ±0.5 dB of the
   0 dB line across 20 Hz–20 kHz. Tolerance ±0.3 dB on the tolerance itself, i.e. fail if any point
   exceeds ±0.8 dB.
2. **Bypass equivalence.** Compare EQ IN at zero against EQ OUT. Target: the two must differ by less
   than 0.2 dB anywhere in band, and the THD at +10 dBm-equivalent must differ by less than 10 %
   relative. A model that goes clean in bypass has wrongly bypassed the amplifier.
3. **Low boost maxima.** For each of 20, 30, 60, 100 Hz, LOW BOOST at maximum, LOW ATTEN at zero.
   Target peak gain +13.5 dB, tolerance ±1.0 dB. Record the frequency of maximum gain; it will not
   equal the selector label, and QA should log the offset rather than fail on it.
4. **Low attenuation maxima.** Same four frequencies, LOW ATTEN at maximum, LOW BOOST at zero. Target
   maximum attenuation -17.5 dB, tolerance ±1.0 dB.
5. **Low-end trick, the critical test.** LOW FREQ = 60 Hz, LOW BOOST = maximum, LOW ATTEN = maximum.
   Assert three things: (a) gain at 30 Hz is positive and at least +4 dB; (b) there is a local minimum
   somewhere between 200 Hz and 2 kHz with at least 2 dB of dip relative to the 0 dB line; (c) the
   response is _not_ flat. Any model that returns a flat line here has summed the legs in dB and is
   wrong. Repeat at 30 Hz and 100 Hz selector positions and confirm the dip frequency moves upward
   with the selector.
6. **High boost bell.** For each of the seven HF selector positions, HIGH BOOST at maximum, BANDWIDTH
   at BROAD and again at SHARP. Target peak gain +18 dB, tolerance ±1.5 dB. Measure -3 dB bandwidth in
   octaves at each BANDWIDTH endpoint and record; there is no published target, so this test
   establishes the baseline for regression rather than passing or failing against a spec.
7. **Bandwidth isolation.** Sweep BANDWIDTH across its full range with HIGH BOOST at zero. Target: no
   measurable change in response, under 0.1 dB anywhere. BANDWIDTH must not affect anything but the
   boost bell.
8. **High attenuation shelf.** ATTEN SEL at 5, 10 and 20 kHz, HIGH ATTEN at maximum. Target -16 dB
   asymptotic attenuation, tolerance ±1.5 dB, and confirm the response is shelving rather than
   peaking by checking that attenuation at 20 kHz is within 1 dB of attenuation at the corner for the
   5 kHz setting.
9. **HF selector independence.** Confirm changing HI FREQ produces no change in the response when
   HIGH BOOST is at zero and HIGH ATTEN is at maximum.
10. **THD versus level.** All controls flat. Sweep input level and measure THD and the harmonic
    series at 1 kHz. Target 0.15 % at +10 dBm-equivalent, tolerance +0.1/-0.15 percentage points.
    Assert that the second harmonic exceeds the third by at least 6 dB at that level.
11. **Low-frequency transformer distortion.** 30 Hz sine at +10 dBm-equivalent. Assert third harmonic
    is at least 6 dB above second harmonic, and that total THD at 30 Hz exceeds THD at 1 kHz at the
    same level by at least 3 dB. This confirms the transformer model is frequency-dependent in the
    right direction.
12. **Noise floor.** No input, all controls flat. Target noise 92 dB below the +10 dBm reference,
    tolerance ±3 dB.
13. **Aliasing.** 15 kHz sine at maximum drive. Assert no alias product above -70 dBFS below 15 kHz.

## 10. Sources, and where they conflict

- Pultec EQP-1A installation and operating instructions, as reproduced by ManualsLib
  (manualslib.com/manual/1402888 and /1006513) and Manualzz (manualzz.com/doc/54723387) — passive
  network plus amplifier plus self-contained supply, amplifier restores insertion loss, amplifier
  flat 20 Hz–20 kHz ±0.5 dB, distortion ≤0.15 % at +10 dBm into 600 Ω, noise 92 dB below +10 dBm,
  600 Ω in, optimum input -15 to +8 dBm, maximum peak output +21 dBm.
- Wikipedia, "Pultec EQP-1" — tube complement, passive LC architecture.
- KMR Audio and Vintage King EQP-1A product pages — +13.5 dB low boost, -17.5 dB low attenuation,
  +18 dB high boost, -16 dB high attenuation, frequency lists.
- Sonic Circus and Odyssey Pro Sound EQP-1A pages — 12AX7/ECC83 input, 12AU7/ECC82 driving the
  output transformer.
- Barrera, Lizarraga-Seijas, Font, "Modeling the Pultec EQP-1A with Wave Digital Filters", SMC 2024,
  Porto (smcnetwork.org/smc2024/papers/SMC2024_paper_id132.pdf; repository copy at
  repositori.upf.edu) and the companion repository github.com/ABSounds/EQP-WDF-1A — circuit-derived
  topology, LTspice-validated, WDF realisation. Primary technical reference for the network.
- Ultimate Preset, "Understanding the Pultec Equalizer" — the low attenuation control acting three to
  four octaves above the selected frequency; 30–100 Hz selector dipping between 500 Hz and 2 kHz.
- Sweetwater InSync, "Boost and Attenuate on Pultec EQs" — boost and cut curves are not inverses,
  boost broad and starting below the selected frequency, cut narrower and starting above it.
- Variety of Sound, "A more realistic look at the Pultec style equalizer designs" (May 2021) — the
  original manual advises against simultaneous low boost and cut, and the combined low-frequency
  behaviour is unpredictable in practice.
- Universal Audio Pultec Passive EQ Collection manual (help.uaudio.com article 7183176266260) — boost
  control has slightly higher gain than the attenuation has cut and the frequencies they affect differ.
- Whitlock, "Audio Transformers" (Jensen Transformers, jensen-transformers.com) — hysteresis versus
  saturation distortion, odd-order symmetry, frequency dependence.
- Elliott Sound Products, "Valves — Distortion + Intermod" (sound-au.com/valves/thd-imd.html) —
  single-ended triode second-harmonic behaviour versus push-pull even-order cancellation.

**Conflicts and resolutions.**

_Low and high band maxima._ Hardware retail listings and the original manual give +13.5/-17.5 dB low
and +18/-16 dB high. A plug-in emulation's manual gives 18 dB low boost and 20 dB high boost with a
0–11 dial in 0.1 steps. The plug-in figures describe the plug-in, not the hardware, and the 0–11 dial
is an emulation convenience. **This sheet uses the hardware figures.**

_Push-pull versus single-ended make-up amplifier._ One retail description says push-pull; the tube
complement and other descriptions are consistent with a simpler arrangement. Unresolved — see §6.3.
The model should default to second-harmonic dominance and this must be re-checked against the
schematic in the SMC paper before the harmonic profile is frozen.

_Maximum output._ The manual's +21 dBm is used. A +24 dBm figure appears in some secondary writing
and is not supported by the manual.

_Whether simultaneous low boost and cut is "supposed" to work._ The manual says no, practice says yes,
and the analytical writing says it works but is not cleanly predictable. All three are correct
statements about different things and there is no conflict to resolve; model the network and let the
result emerge.
