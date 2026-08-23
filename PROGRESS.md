# Motion Wave — progress

```
RESUME: Directive 06
Current unit:  Console EQ (dyn-05) — STARTING. Two lineages, two filter
               engines, nineteen QA rows. core/dsp/bridged_t.h and
               core/dsp/inductor_section.h are written; the unit, the manifest,
               the tests and the face are not.
Last PASS:     dyn-04 DSP DONE — all fifteen §9 rows across four suites, D1
               across ten parameters plus block-size independence, and
               U19/U20/U22/U23.
Next action:   Write core/units/console_eq.h with a lineage switch (§10 test 19
               asserts the two engines produce measurably different curves, so
               one shared engine fails by construction). British: inductor bell
               with Q rising on frequency and on amount, LC shelves, third-order
               HPF, and MagneticCore INSIDE the EQ section for test 7's core
               saturation. American: bridged-T proportional Q, reciprocal cut,
               NO EQ-section saturation (test 17 asserts its absence), separate
               band-pass. Then manifest, tests, D1, face.
               Then the Program EQ WASM bridge, then report R2.
Units done:    Motion Shaper SHIPPING 24/24.
               Program EQ DSP DONE, 13/13 sheet rows, D1, four UI cells.
               Optical Leveller DSP DONE, 13/13 sheet rows, D1, four UI cells.
               FET Limiter DSP DONE, 16/16 sheet rows, D1, four UI cells.
               Variable-Mu DSP DONE, 15/15 sheet rows, D1, four UI cells.
Shared libraries built:
               core/dsp/biquad.h        RBJ sections, double state, denormal flush
               core/dsp/shelving.h      shelf + peaking + one-pole HP
               core/dsp/crossover.h     LR 6/12/24, three-band all-pass compensated
               core/dsp/curve.h         analytic per-sample breakpoint curve
               core/dsp/lfo_phase.h     transport-derived phase, swing, trigger
               core/dsp/smoother.h      two cascaded one-poles, 0.05 ms floor
               core/dsp/decimate.h      8x oversampling + 4th-order Butterworth
               core/dsp/fft.h           radix-2 FFT + Blackman-Harris window
               core/dsp/optical_cell.h  two-branch release + exposure history
               core/dsp/peak_detector.h timing network, panel-scale mapping
               core/dsp/timing_network.h  chained storage elements; dyn-04 pos 5/6
               core/dsp/bridged_t.h     proportional-Q RC bands + band-pass
               core/dsp/inductor_section.h  LC bell/shelf, third-order high-pass
               core/dsp/nonlinear/      curve, stages, variable gain, FET, core,
                                        oversampler (exact integer latency), specs
               core/render/             deterministic render, analysis, reference graph
               core/test/spectrum.h     proves its grids resolvable before reporting
               core/test/delta_harness.h D1's measured half, once, for every unit
                                        + block-size independence, for every unit
               motionwave/ui/render/    facePanel — any UnitFace into the DOM
               motionwave/ui/dev/       panel harness + AudioWorklet engine
               Specs only: lib-grain-engine, lib-voice-substrate
Standing rules earned the hard way:
             - DERIVE, DON'T RE-FIT. When a shared fix moves a finished unit's
               number, re-derive it from the physics. The Optical Leveller's
               attack passed at 10.6 ms while the cell ran four times slower,
               because model and test were both downstream of a DC offset. Most
               recently: NL-07's hysteresis floor, re-derived from the play
               operator (0.0036 % predicted, 0.0032 % measured) after the
               Steinmetz taper moved it, and the law checked at a second flux
               before being used.
             - PROBE FIRST. Twelve measurements so far were the instrument, not
               the unit. The last four: a transfer curve read from the fundamental
               while the energy was in the harmonics; two rows timing "one
               sample after arrival" from a 1 kHz sine, so they carried a cycle
               of the stimulus; an aliasing probe at exactly Fs/4, where every
               alias folds onto the probe's own bin and the band reads -139 dBc
               whatever the unit does; and a drive-split row measured at 1 kHz,
               where a transformer's flux is 33x below its specified saturation
               and the core has no answer to give at any level. Then dyn-04's
               attack read through a 1 kHz sine, quantising to the rectifier's
               peak spacing, and its threshold-sense row comparing 13.76 dB
               against exactly 0.00 — which the guard refused.
             - NO VACUOUS ASSERTIONS. MW_EXPECT_AT_LEAST_TIMES and
               MW_EXPECT_EXCEEDS_BY refuse two zeros, two equal values, or
               anything under a floor the row declares. The predicate is
               unit-tested in param_tests.cpp.
             - ONE WRAPPER PER CHANNEL. A shared oversampler filters the right
               channel through the left channel's history and makes the output
               depend on the host's block size. Mono renders are bit-identical,
               so it hides. expectBlockSizeIndependent is in delta_harness.h.
Open deviations:
             - Mix 0 on a multiband unit returns the all-pass of the input, not
               the input. Magnitude-flat, phase-rotated. Bypass returns it
               exactly, which is why it is a separate control.
             - polyBLEP removed rather than left dormant (Directive 06 §0.2).
             - dyn-01 §4.1: the second/third crossover is at A = 6*u0, not the
               3*u0 the prose states; 3*u0 is the 6 dB lead condition. Both are
               now asserted separately.
             - lib-nonlinear §4.2 eq (5): a push-pull pair returns no even order
               at zero bias for ANY gain imbalance. What returns it is an
               operating-point difference between the halves.
             - dyn-02 §4: one attack and two releases. A slow attack on the
               second branch was a workaround for a DC bug and became the unit's
               attack.
             - dyn-03 §9 test 1 specifies a 1 kHz sine, which cannot measure a
               20 us attack: a peak detector only rises when a peak arrives, and
               that probe delivers one every 0.5 ms. Rows use a rectified level.
             - dyn-03 §9 test 11 asks ATTACK to separate two distortion readings
               at 40 Hz by 6 dB. It cannot, and the sheet contradicts itself:
               §4's own published endpoints are 20 us and 800 us, and after the
               ln(9) conversion the slower is a 375 us constant — 1/67 of a
               40 Hz period. Both track the cycle completely and measure 0.83 dB
               and 0.82 dB of ripple. Separating them would need the attack
               about thirty times slower and would fail test 1's published
               endpoints, which are a measurement rather than a QA instruction.
               The row asserts §4's stated mechanism instead, and asserts more
               than was asked: THD above 1 %, H3 rising 23.3 dB as frequency
               falls from 1 kHz to 40 Hz, and the timing control that does set
               the ripple separating by 21.7 dB. H3 rather than THD because the
               element's own distortion is H2-led and swamps total THD.
             - dyn-04 §9 test 1 specifies a 1 kHz sine and cannot measure a
               0.2 ms attack with it, for the same reason dyn-03's test 1 could
               not measure 20 us: the sidechain rectifies, so a new peak arrives
               every 0.5 ms. Rows use a rectified level.
             - dyn-04 §9 tests 12 and 13 are measured through the decoded
               outputs' sum and difference rather than through internal taps,
               which is what a user can hear; the internal separation is exact.
             - dyn-05 §6.2's "-3 dB bandwidth" is undefined below 3 dB of boost
               and the published law quotes 3 octaves AT 2 dB. Rows measure the
               half-gain bandwidth, which is also how the section is
               parameterised.
             - dyn-03 §9 test 16 specifies a 12 kHz probe. At 48 kHz that is
               exactly Fs/4 and the row is vacuous; it runs at 44.1 kHz, where
               the same tone folds to 8.1 and 3.9 kHz inside the band, and which
               is also where a 20 us attack has least room.
             - Amp Sim (MotionLab) declares no latency; cabinet onset moves with
               the selected cab. Carried from Directive 03.
```

**Read this first:** the Definition of Done is **not reachable on this build
host**, and no amount of work here will change that. Four of the five shipping
targets cannot be compiled in this container and no audio device can be opened
at all. ADR-0005 defines what "green" means under that constraint and every gate
below carries its classification. Nothing here is reported as passing that has
not actually run.

---

## Phase board

| Phase | Deliverable                                           | Status                                                |
| ----- | ----------------------------------------------------- | ----------------------------------------------------- |
| 0     | ADRs; skeleton builds                                 | **PASS (host target)** · shells BLOCKED               |
| 1     | Real-time engine: graph, transport, PPQ=480, PDC, I/O | **PASS** (graph, transport, PDC) · device I/O BLOCKED |
| 2     | Tracks, mixer, routing, automation                    | not started                                           |
| 3     | Editing, MIDI, piano roll, comping                    | not started                                           |
| 4     | Design system, plugin framework, presets, browser     | not started                                           |
| 5     | Motion Shaper                                         | research in progress                                  |
| 6     | Vintage Collection (5)                                | research in progress                                  |
| 7     | Granular Reverb + Delay                               | research in progress                                  |
| 8     | Specialty sampler (multi-portamento, MPE)             | research in progress                                  |
| 9     | Synth Collection (5)                                  | research in progress                                  |
| 10    | Sync service, project portability                     | not started                                           |
| 11    | Export, loudness targets, stems                       | not started                                           |
| 12    | Hardening: perf, battery, accessibility, docs         | not started                                           |

## Phase 0 gate — result

**ADRs written:** 0001 stack and engine topology · 0002 project file format ·
0003 repository layout and module boundaries · 0004 parameter and automation
framework · 0005 verification under a constrained host.

**Skeleton builds:** the shared core configures and compiles under CMake +
Ninja with `-Wall -Wextra -Wpedantic -Werror -Wconversion -Wold-style-cast`,
and its tests run headlessly.

```
param:    15 case(s), 0 failure(s)
tempo:    12 case(s), 0 failure(s)
topology: 12 case(s), 0 failure(s)
graph:     8 case(s), 0 failure(s)
```

Two of those fifteen assert that draining and advancing every parameter in a set
allocates nothing, and a third is the mutation test proving the allocation guard
catches a deliberate allocation — a guard that cannot fail proves nothing.

| Target              | Skeleton builds? | Why                                        |
| ------------------- | ---------------- | ------------------------------------------ |
| Host (Linux x86-64) | **PASS**         | gcc 13.3 / clang 18.1 / cmake 3.28 present |
| Windows             | **BLOCKED**      | no toolchain on this host                  |
| macOS               | **BLOCKED**      | no Xcode, no macOS                         |
| iOS / iPadOS        | **BLOCKED**      | no Xcode, no Apple Developer account       |
| Android             | **BLOCKED**      | no Android SDK/NDK                         |
| Web (WASM)          | **BLOCKED**      | Emscripten not installed                   |

Phase 0 advances on the host target and **carries** five BLOCKED shell gates,
per ADR-0005. They are re-listed every phase until a host exists that can run
them.

## QA dashboard

| Check                                              | Class       | Result                                                        |
| -------------------------------------------------- | ----------- | ------------------------------------------------------------- |
| Core compiles, warnings-as-errors                  | PASS        | clean                                                         |
| Parameter taper round-trip, all laws               | PASS        | 15/15                                                         |
| Audio path allocates nothing                       | PASS        | 0 allocations over 64 blocks                                  |
| Allocation guard catches an allocation             | PASS        | mutation-tested                                               |
| Tempo map: seconds↔ticks inverse across changes    | PASS        | 12/12                                                         |
| Tempo ramp integrated in closed form, not averaged | PASS        | asserted to differ from the average by >20 ms per bar         |
| Bars↔ticks inverse under mixed time signatures     | PASS        | 12 bars, three signatures                                     |
| Delay compensation: every path aligned at its join | PASS        | 12/12, incl. sends, diamonds and key inputs                   |
| Graph order deterministic                          | PASS        | asserted stable across runs                                   |
| Compensation aligns real samples, not just numbers | PASS        | impulse through two paths of differing latency arrives as one |
| Sidechain key arrives with the signal it keys      | PASS        | asserted by multiplying the two ports                         |
| Whole graph render allocates nothing               | PASS        | 0 allocations over 100 blocks                                 |
| Short blocks render identically to full ones       | PASS        | 16- and 64-frame renders agree                                |
| Cycle detection                                    | PASS        | reported, not looped                                          |
| Bypass null test to −120 dBFS                      | —           | no processors yet                                             |
| THD / aliasing per plugin                          | —           | no processors yet                                             |
| Golden-render regression                           | —           | no renderer yet                                               |
| Round-trip latency, xrun counting                  | **BLOCKED** | no audio device on this host                                  |
| iPhone 24 tracks + 12 plugins @ 256                | **BLOCKED** | no device; will be MODELLED as a per-core time budget         |
| Battery, thermal, touch latency                    | **BLOCKED** | no device                                                     |
| VoiceOver / TalkBack                               | **BLOCKED** | no device                                                     |

**MotionLab Studio** (the shipping web app) remains green: 1500 unit tests
across 80 files, 222 e2e, typecheck, lint and build clean.

## Directive 02 — §1 to §4

### §1 P0 defects — all three closed, with regression tests

Reproduced at 360, 390 and 430 px before any code changed. **Two of the three
reports described a real symptom with the wrong cause**, which is why the
directive asks for the cause.

| Ticket  | Reported                                                     | What was actually true                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Fix                                                                                                                                                                                                        | Test                                                                                                                                               |
| ------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUG-001 | Controls overlap, crowd the name, collapse below usable size | **Overlap did not reproduce** — measured, the controls did not intersect at any phone width. The other two halves did: every control was **32×30 against the 44 pt minimum**, and a five-letter track name had **37 px for 42 px of text**. One cause under both — the header column is a fixed 176 px that does not answer the viewport, and its buttons are fixed-width with `flex: none`, so the strip could neither grow nor collapse by priority. Hypotheses 3 and 4 in the ticket were wrong: control size does not follow track height, and nothing was painting over anything | Reserved strip width; column 208 px on coarse pointers; fader, pan knob and automation button shed by the stated priority into the track menu                                                              | `e2e/trackheader.spec.ts` — 7 cases, real browser geometry                                                                                         |
| BUG-002 | The `M` button is doing monitoring                           | **`M` was already mute** — correctly bound, labelled and wired to stored state. What was true is that **mute lit blue** (`--mute-lamp: #63a0dc`), which is monitoring's colour in every DAW the user has met, so a lit M read as "listening". The defect was a token, not a binding. Separately real: there was **no monitor control in the track header at all**, and no monitor colour token existed                                                                                                                                                                                | Mute is amber in all four palettes; monitoring owns blue and has a loudspeaker control on audio tracks; implicit mute (silenced by another track's solo) is hatched and still reports `aria-pressed=false` | `tests/stateColours.test.ts` (mutation-tested — restoring the blue fails two cases by name) and 6 cases in `tests/components/trackHeader.test.tsx` |
| BUG-003 | Vocal tuner non-functional                                   | The **detector was never the problem** — it holds one cent from 55 Hz to 1.76 kHz and always has. The device drew an oscilloscope and read no pitch at all. Signal path was also fine: monitoring connects into the channel input upstream of the inserts, so the tuner sees live input independently of the transport                                                                                                                                                                                                                                                                | Window from 8192 samples (170 ms) to 4096; detector re-run every 40 ms instead of 120; range narrowed to the vocal 55 Hz–1.6 kHz                                                                           | 6 new cases in `tests/pitch.test.ts` at the tuner's real configuration                                                                             |

**A measured conflict between two acceptance criteria.** BUG-003 asks for ±1
cent at 55 Hz _and_ ≤50 ms to the needle. At a 43 ms window the detector is
exact from 65 Hz up and **1.44 cents out at 55 Hz**; one cent at 55 Hz needs
about four periods, which is 73 ms. That is arithmetic, not an implementation
choice. Accuracy took the window; the 40 ms update rate carries the
responsiveness, so the number on screen is never more than 40 ms behind the
voice.

### §2 Live record visualisation — implemented

**MIDI.** The recorder already held closed and held notes and never exposed
them. Notes now draw from note-on, extending as they are held — waiting for
note-off would make the longest notes appear last and a held chord draw
nothing. Drawing is incremental: closed notes are painted once, only held notes
repaint. Pinned by a test that the live lane and the committed clip agree on
where a note goes, so the take does not jump when the transport stops.

**Audio.** `MediaRecorder` never exposes PCM, so a second tap was added on the
same source. §2.1's lock-free ring needs `SharedArrayBuffer`, which this
application deliberately forgoes (no COOP/COEP), so the reduction happens in an
`AudioWorklet` — two comparisons per sample, batches posted every 43 ms from a
recycled buffer pool, steady state allocation-free. **Deviation from the letter
of §2.1, documented where the code is.**

Under back-pressure the worklet **widens its buckets rather than dropping
them**, and the receiver appends a widened bucket as many times as it stands
for — otherwise a take recorded through a stall comes out shorter on screen
than on disk. That is §2.3's "degrade resolution, never drop", arrived at from
the same reasoning.

Measured: a sixty-minute take at 48 kHz is **675 000 level-0 buckets in under
16 MB**, allocated in chunks so nothing copies a multi-megabyte buffer mid-take.

**Not done in §2**, and open: take lanes for loop/punch passes draw into one
lane rather than per-pass; input-latency compensation is not applied to the
draw head; and the on-stop reconciliation against the written file is not
asserted. The 30-minute dual-record acceptance run needs a device and is
BLOCKED here.

## Active bugs

| #   | Severity | Description                   | Owner |
| --- | -------- | ----------------------------- | ----- |
| —   | —        | none open against Motion Wave |       |

### §3 plugin and instrument audit — complete, three P1s closed

`docs/audit/PLUGIN_AUDIT.md`. Twenty-seven effect kinds and five instrument rows
against the fifteen-point matrix — **480 cells**, backed by **57 executable
probes** in `tests/audit/`, not by reading. **Thirteen findings: no P0, three
P1, ten P2.** The P1s are fixed and their probes are now the regression tests.

| ID     | Was                                                                                                                                                 | Is now                                                                                                                                                                                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PA-001 | Reverb Size sweep: 90 impulse re-renders, 27.1 M samples, **2396 ms** of synchronous main-thread work. Damping: 180 / 31.1 M / 2525 ms              | **30 / 5.1 M / 192 ms** and **26 / 4.5 M / 158 ms**. Tabulated decay curve (5× faster, worst sample difference 5.96e-8 — half a Float32 step) plus a sixth-octave re-render grid in place of a flat threshold that was ¼ of the shortest tail and <1 % of the longest |
| PA-002 | Every tempo-synced insert ran at the tempo of beat 0. A 6/16 delay at bar 9 of a 120→160 song: **0.7500 s where the bar wants 0.5625 s**, 33 % long | **0.5625 s.** All seven drivers sample the map — at the playhead live, at the beat being rendered offline. Re-driving gated at 0.5 % relative, so a 120→160 ramp costs **55 insert passes over 480 frames**, not 480                                                  |
| PA-003 | 60 notes at one instant: **60 oscillators, 1 voice cut** against a ceiling of 24. Sampler: 80 live against 48                                       | **24 live, 36 steals on 36 distinct voices**; sampler 48 of 80. Stealing loops and removes each voice as it takes it                                                                                                                                                  |

The ten P2s are open and listed in the report. The three worth naming: insert
automation runs on a 25 ms offline grid that widens to 375 ms on a half-hour
bounce while playback applies it at 60–100 Hz, and `KNOWN-LIMITATIONS.md` calls
the bounce exact (PA-006); no insert declares a latency and seven have one, so
they shift their channel against the rest of the session (PA-010); eighteen
controls rebuild a WaveShaper table on every automation frame (PA-004 — the same
shape as PA-001, one tier down in cost).

What the audit could **not** claim, and does not: the bypass null test to
−120 dBFS, latency measurement, and aliasing through the browser's own 4×
oversampling are all BLOCKED under ADR-0005 — jsdom has no Web Audio, no device
and no real-time thread. A structural proof stands in for the null test, and the
shaper curves were measured directly instead of the rendered aliasing
(−14.3 dBc at 1×, −35.5 dBc with an ideal 4×, at full drive).

Two hypotheses the audit formed and disproved before publishing are recorded in
the report's Method section, which is the part of an audit that usually goes
missing.

### §4 responsive and orientation audit — complete, four P0s closed

`docs/audit/RESPONSIVE_AUDIT.md`. 19 matrix cells × the full surface walk =
**982 surface probes**, 570 of them plugin editors — all 30 devices in the
picker inserted, opened and measured on every cell — plus split screen, both
themes, two root font sizes, two UI scales and injected safe-area insets.
**16 tickets: four P0, seven P1, five P2.** The four P0s are closed.

| ID     | Was                                                                                                                                                                                        | Is now                                                                                                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RA-001 | A rotated phone opened the arrangement on **0, 0 and 1** whole track rows against 4, 7 and 8 upright. 272 px of 360 went on chrome, leaving an 88 px scroller of which 82 px was the ruler | **2, 3 and 4.** Below 500 px of height every band shortens, the overview goes, the toolbar scrolls sideways instead of wrapping, and in landscape the bottom nav becomes a side rail — the rail alone returns a whole 54 px |
| RA-002 | The 64 px track header held **93 px** of controls; 25 of the strip's 44 px were cut, on all 14 touch cells. My own §1 regression                                                           | Row 1 is text only: 2 + 18 + 44 = **64 exactly**. The strip keeps mute, solo, monitor and arm at 188 px in a 208 px column                                                                                                  |
| RA-003 | Every plugin editor opened **96–199 px off-screen** on 9 of 19 cells, close button included                                                                                                | Placement measures the window against the viewport, centres when the offset will not fit, pins the header on screen when the window is taller than the screen, and re-places on rotation                                    |
| RA-004 | The shortcuts sheet clipped **~1400 px** with nothing to scroll, on **all 19 cells** including a 2560 px desktop                                                                           | Two components were sharing the class `.sc-sheet`; the shortcuts family is now `ks-` and the score keeps `sc-`                                                                                                              |

**The one that was a genuine conflict, not a bug.** RA-002 is two of the
directive's own requirements colliding: 44 px touch targets and a 64 px lane
row cannot both hold with two rows of controls, because 44 × 2 = 88. Row 1 gave
up its buttons rather than `LANE_H` growing — growing it buys a taller header
by showing fewer tracks, on the devices that already show the fewest.

**Two regressions I caused and caught**, by running the whole e2e suite rather
than the specs I was working on. Removing monitor from the touch strip to make
room broke BUG-002, and a phone is exactly where "am I listening to this input"
is hardest to answer from anything else — the track menu it was competing with
is already reachable by long-press. And the toolbar scrolling sideways put
three zoom controls past the right edge, which the chrome-integrity guard
called clipped. It was right to: viewport geometry alone cannot tell
"unreachable" from "reachable by swiping". The guard was made _more_ precise
rather than looser — a control is excused only when an ancestor both permits
horizontal scrolling and actually has overflow — and the affordance it was
implicitly asking for was genuinely missing, so the bar now fades at its
trailing edge.

**Seven P1s and five P2s remain open**, listed in the report. The P1s worth
naming: a plugin editor cannot be dismissed by touch at all (close 17×17,
bypass 10×10); the rack's `Insert` button answers no first press on any cell,
because selecting a strip reflows it out from under the pointer between press
and release; text scaling is not implemented rather than imperfect — 130 % and
200 % root font size produce byte-identical geometry, because the type scale is
`px × --ui-scale` and there is no `rem` in the codebase; and the product's own
140 % scale adds 73 defects.

**What held.** Horizontal overflow is clean on 18 of 19 cells and the previous
audit's ten fixes hold at sizes that audit never tested. Zero overlaps, zero
un-ellipsised truncation, all 100 sheet and drawer probes fit and dismiss.
Light and dark are **bit-identical** — 227 defects each, none unique to either.

**Five cells are BLOCKED** headless and say so: real device insets, the
home-indicator gesture, the software keyboard, rotation mid-gesture and
momentum-scroll hand-off. Each names what would settle it.

### A pre-existing test failure, not caused by this work

`e2e/automation.spec.ts:348` — the touch fader ride writes one automation point
where it wants more than one. Verified by stashing the §4 work and running it
against the previous commit, where it fails identically. Its own comment already
describes this container's audio stack suspending playback mid-test. Logged
rather than fixed, because it is not this directive's and pretending the suite
is fully green would be worse than saying so. **249 of 250 e2e pass.**

### Directive 03 §1 — the last MotionLab work, closed

**BUG-004 / BUG-005 — stuck keys and stuck notes were one bug, in the input
layer.** The directive's first diagnostic settled it before any fix: note-off
fired on a press and release over the same key and on nothing else.

| Scenario                    | note-on   | note-off | stuck      | lit        |
| --------------------------- | --------- | -------- | ---------- | ---------- |
| press/release on the key    | `[48]`    | `[48]`   | —          | —          |
| lift the finger away        | `[48]`    | `[]`     | **48**     | **48**     |
| pointer cancelled elsewhere | `[50]`    | `[]`     | **50**     | **50**     |
| ten fingers, reverse order  | 10        | 10       | —          | —          |
| window blur                 | `[48,52]` | `[]`     | **48, 52** | **48, 52** |
| tab hidden                  | `[48]`    | `[]`     | **48**     | **48**     |
| unmount while held          | `[48]`    | `[]`     | **48**     | —          |

The key dispatched note-off from its own `pointerup`, and the key is exactly the
element that never receives it — `pointerdown` releases pointer capture on
purpose so a finger can glide across the keyboard. **That also exonerates the
PA-003 voice-cap fix the directive asked to bisect**: its whole diff is the steal
block plus an accessor, and nothing downstream can matter when note-off is never
dispatched.

A second, independent instance was in the computer keyboard, and it was the
directive's candidate-2 failure rather than candidate 1: note-on took the pitch
from the octave at press time and note-off recomputed it at release time, so
pressing a key, hitting Z or X, and letting go sent note-off for a pitch nobody
was playing. Its blur handler also called `allNotesOff`, silencing notes it had
never started.

Both now go through one registry above every surface that plays notes.
**Fuzz: 4402 presses, 4025 releases, 1044 cancels, 529 octave shifts → 0 held,
0 unmatched note-ons**, seeded so a failure replays. All four instruments report
0 sustaining voices after 2,000 randomised events.

The engine half needed a measure the harness could not fake. `activeVoices` is
wrong for it — a correctly released voice stays in the allocation set until its
tail retires, and under a stub context nothing retires — and so is "panic wrote
something", for the same reason. `sustainingVoices` (voices with no scheduled
end) is the thing itself. A non-vacuity check caught the sampler answering 0 for
twelve held notes, because a non-looping sample schedules its own end at spawn;
the fuzz now uses a looping zone, the only sampler voice that can sustain.

**PA-010 — insert latency declared, compensated, and two combs fixed.** The
measurement needed fixing twice before it could be trusted: a full-scale impulse
makes a limiter _limit_, and a fixed 2048-sample offset arrives before the
parameter ramps have settled — which read as a rate-dependent bug in the device
(5 % short at 44.1 kHz, 40 % at 192 kHz) and was a rate-dependent bug in the
measurement.

| Device     | Measured                                       | Declared                              |
| ---------- | ---------------------------------------------- | ------------------------------------- |
| Limiter    | 214 / 336 / 1152 / 2112 at 0.5–10 ms lookahead | lookahead × rate + 192 ✓              |
| Saturator  | 192 samples at every rate                      | 192 ✓                                 |
| Distortion | 192 samples at every rate                      | 192 ✓                                 |
| Multiband  | 6.01 / 6.02 / 6.00 ms                          | 6 ms ✓                                |
| Amp Sim    | 192 + ~205 cabinet                             | **not declared** — see deviations     |
| Filter     | 7/8/16/32 samples                              | group delay, not latency              |
| Rotary     | 239/260/496/933                                | its Doppler line, which is the effect |

The more valuable find was internal: `WetDry` has always supported holding the
dry leg back, and the Saturator and Distortion never asked for it — so both were
a **192-sample comb at every Mix below 100 %**, a notch every 250 Hz at 48 kHz.
No channel-level compensation can fix that; both legs are inside the one insert.
A test had asserted this was deliberate on the grounds the delay was unknowable,
which was sound reasoning until the delay was measured.

**PA-006 — the bounce now applies insert automation at the rate playback does.**
The grid was 25 ms capped at 4800 suspensions, widening to 375 ms at half an
hour while playback runs at 60–100 Hz. It now starts at one frame at 60 Hz, and
the ceiling moved from 4.5 minutes of full resolution to about 33 — past which it
still widens, but says so in the diagnostics log instead of degrading silently,
which was the actual defect.

**Touch.** The device-window close button was 17×17 against a 44 pt minimum,
which left an open editor on a phone with no way out; the target grows while the
glyph stays small, and swipe-down-to-dismiss rides the drag gesture the header
already had. The phone track strip now sheds **Solo** rather than Monitor, per
the directive: on a phone the arrangement is most often used to track, and solo
has a loud global alternative in the transport clear where an unnoticed monitor
state is silent by definition.

### Directive 03 §2.1 — copyleft purge, closed

Four repositories were fetched during research and **none was ever committed**.
Two are MIT and stay cited; one is documentation with nothing executable in it;
`grame/faustlibraries` is GPL across the library including its `dx7/` emulation
and is **deleted, 29 MB, gone from disk**. `syn-04` is re-derived from its
manuals, patents and published algorithm tables. The `syn-01` quarantine still
stands and is restated rather than quietly dropped.

`scripts/licence-guard.mjs` runs as the first step of `npm run build`. It scans
source extensions only and deliberately ignores Markdown — the reference sheets
have to be able to say "this emulator is GPL-3.0, so its constants are
quarantined", and banning the words would delete the audit trail rather than the
risk. Verified both ways.

`scripts/ledger-guard.mjs` joins it, failing the build if any unit is marked
SHIPPING with a cell that is not PASS, or if a `BLOCKED` cell does not name the
missing capability. Verified both ways.

Carried from MotionLab Studio, unrelated to Motion Wave:

| #    | Severity | Description                                                                                                                                                                                                             |
| ---- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ML-1 | P2       | Live modulator phase re-anchors only when a chain is rebuilt, not across a seek. Bounces are bar-locked; playback is not.                                                                                               |
| ML-2 | P2       | `paramIdExists` returns false for `smp:*` once a track has rack items, so converting a sampler track to a rack and reloading deletes its sampler lanes. Pinned by an existing test, so changing it is its own decision. |
| ML-3 | P3       | Level-changing devices have no in/out metering; the EQ has no live spectrum behind its curve.                                                                                                                           |
| D2-1 | P1       | Live audio waveform draws all loop/punch passes into one lane; §2.1 wants a lane per pass.                                                                                                                              |
| D2-2 | P1       | The live draw head does not apply input-latency compensation, so what is drawn sits where the take was captured rather than where it will land.                                                                         |
| D2-3 | P2       | The live envelope is not reconciled against the written file on stop; §2.1 calls a mismatch a P0 and nothing currently checks it.                                                                                       |
| D2-4 | P2       | The peak-tap worklet's own loop is unverified — jsdom has no `AudioContext`. BLOCKED under ADR-0005.                                                                                                                    |

## Escalations for the user

Per §"when to interrupt me", clause (c) — hard external blockers:

1. **No Apple Developer account, no macOS, no Xcode.** iOS, iPadOS and macOS
   cannot be built, run or tested. This blocks the Phase 1 gate as written and
   the entire Definition of Done.
2. **No Android SDK/NDK, no Windows toolchain, no audio device drivers or
   headers on this host.** Same consequence for the other three targets.
3. **The §3 reference URLs are unreachable.** The egress proxy blocks WebFetch
   for essentially every domain. Research proceeds via web search, which works
   and returns substantive material, and every spec sheet cites what it found —
   but the specific pages named in the brief were not fetched.

None of these stopped work: everything platform-independent proceeds, which is
most of the engine, all of the DSP, the project format, and the sync algorithm.

## Next three actions

1. Land the Reference Spec Sheets from the four Research Analysts and open the
   provenance register in `LEGAL_NOTES.md`.
2. Buffers and the `Node` interface, so the planned graph can actually render —
   then the offline render harness and the first golden-render regression.
3. Phase 2's mixer topology on top of it: channel, bus, VCA and send routing,
   with the pan laws and the metering the brief specifies.
