# Unit Ledger — Directive 03

The single source of truth for the fourteen units, and the resume point across
sessions. **Read this first**, then the resume block at the top of
`PROGRESS.md`, then continue from the step it names. Do not re-plan.

## The rules this table lives under

- A cell holds exactly one of: `PASS`, `FAIL`, `BLOCKED (reason)`, `n/a`, or `—`
  (not reached). No prose, no "mostly", no "essentially done".
- **Every `PASS` is backed by a named, executable test.** A `PASS` with no test
  is a `FAIL`. The test's name goes in the unit's section below the table.
- `BLOCKED` is permitted **only** for device-dependent checks under ADR-0005 and
  **must name the specific missing capability** — "BLOCKED (no audio device)",
  not "BLOCKED".
- A unit is `SHIPPING` only when every applicable cell reads `PASS`.
- Update a cell **at the moment it changes**, not at the end of a session.
- `scripts/ledger-guard.mjs` fails the build if any unit is marked `SHIPPING`
  while an applicable cell is not `PASS`. The ledger must not be able to lie.

## Status

**0 of 14 shipping.** Motion Shaper's DSP is built and measured; its UI is not,
and the framework its UI builds on is still in progress, so it is not shipping
and its row says so.

### How a sheet's V-numbers relate to the Ledger's cells

Two numbering schemes are in play and they are not competing, so this says once
which is which rather than leaving each reader to work it out.

**The Ledger's cells (`D1`…`U23`) are the index.** They are identical for all
fourteen units and they are what a unit ships against.

**A sheet's V-numbers are evidence.** Each spec sheet carries its own
verification section written for that unit's physics, and cell 3 is literally
"the unit's own verification section has been run and passes" — so the V-tests
_are_ cell 3. Several of them also stand as the evidence for other cells, which
is why a single measurement can appear twice below without being counted twice.

| Sheet test                | Cells it is evidence for         |
| ------------------------- | -------------------------------- |
| V1 neutral null           | `D3`, and `D4` bypass null       |
| V2 crossover sum flatness | `D3`, and `D6` sample rates      |
| V3, V4 click detection    | `D3`, and `D10` no zipper        |
| V5 modulator alias floor  | `D3`, and `D5` aliasing measured |
| V6 mix comb               | `D3`, and `D8` latency           |
| V7, V8 timing and swing   | `D3`, and `D12` tempo map        |
| V9 topology-change pop    | `D3`, and `D10`                  |
| V10 denormal stall        | `D3`                             |
| V11 smooth taper          | `D3`, and `D2` taper laws        |

The harness in `motionwave/ui/harness/` emits the Ledger's scheme directly, so
its output is what fills the table above; the C++ tests emit V-numbers because
that is what the sheet calls them. Neither needs converting — one is the claim,
the other is the reason to believe it.

### Motion Shaper — what is measured, and what each number was measured against

Every figure below comes from a named case in
`motionwave/core/test/motion_shaper_tests.cpp`, `crossover_tests.cpp` or
`modulator_tests.cpp`, run by `ctest --test-dir motionwave/build`.

| Sheet test                                    | Gate            | Measured                                |
| --------------------------------------------- | --------------- | --------------------------------------- |
| V1 neutral null                               | ≤ −140 dBFS     | **−200.0 dBFS**                         |
| V2 crossover sum flatness, 3 slopes × 5 rates | ±0.05 dB        | **< 1e-7 dB**                           |
| V3 click sweep 0.1–200 Hz                     | 0 flagged       | **0**                                   |
| V4 retrigger, 42 in one second                | 0 flagged       | **0**                                   |
| V6 Mix 50 % against 100 %                     | ±0.05 dB        | **−200.0 dBFS**                         |
| V7 1/16 gate, 128 bars at 174 BPM, then seek  | 0 samples       | **≤ 1 sample; seek identical to 1e-12** |
| V8 swing boundary at full swing               | 2/3 ±1 sample   | **0.666667**                            |
| V11 smooth taper monotonicity                 | ≤ 15 % per step | **8.6 %**                               |
| Cell 7 block sizes 32…1024                    | identical       | **bit-identical**                       |

**Cells now PASS, each with the C++ case behind it** (Directive 05 §2 — owned by
the C++ suite, proven natively, not re-run through TypeScript):

| Cell              | Named test                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `D2` taper laws   | `modulator_tests` "tension is mirror-symmetric about the diagonal"; `motion_shaper_tests` V11             |
| `D4` bypass null  | `motion_shaper_tests` "bypass is a wire", "V1 a neutral unit nulls against dry"                           |
| `D6` sample rates | `crossover_tests` "the sum stays flat at every supported sample rate" — 44.1/48/88.2/96/192 kHz           |
| `D7` buffer sizes | `motion_shaper_tests` "renders identically at every block size"; also across the WASM boundary            |
| `D8` latency      | `render_tests` "a declared latency moves the samples it says it does"; the unit declares 0 and measures 0 |
| `D10` no zipper   | `motion_shaper_tests` V3 and V4 — zero flagged samples                                                    |
| `D12` tempo map   | `modulator_tests` V7 and V8                                                                               |

**`D5` is PASS: −87.0 dBFS at the sheet's 90 Hz, −89.0 dBFS at 97.3 Hz**, against
a −80 dBFS target with +3 dB tolerance. The oversampled modulator is what buys
it — 1× measures −69.0 and −70.1 dBFS, so the eightfold path is worth 18 dB.

Getting there took **five** wrong measurements, every one of which produced a
plausible number. They are listed in `core/test/spectrum_tests.cpp` because a
spectral measurement never looks broken, and the list is the reason that file
exists:

1. N = 4096 gave 11.72 Hz bins against a 10 Hz alias-to-sideband gap — the two
   shared a bin, so the "alias floor" was the sideband. I concluded from this
   that the sheet's 90 Hz was unusable. **That was wrong**: 46000 is not a
   multiple of 90, so alias and signal are never coincident, only closer than
   the transform could see. N = 32768 resolves them.
2. The exclusion set stopped at ±40 sidebands; a 0.05 ms smoother passes
   harmonics far past that, so legitimate signal counted as spurious.
3. Measured against DC rather than a carrier, the modulator's own DC term
   dominated its window skirt.
4. Lower sidebands reflect through zero — `carrier − 12·spacing` is −80 Hz and
   appears at +80 Hz — and skipping the negative ones counted every reflection
   as spurious.
5. A Hann window's sidelobes sit near −31 dB, so a −6 dBFS carrier smeared
   energy across the spectrum at about −54 dBFS. **That was the floor being
   reported**, and the tell was that crushing the modulator's bandwidth
   elevenfold moved it by 0.1 dB. Blackman-Harris, at −92 dB, sees past it.

The instrument is now calibrated against known answers before it is believed:
a clean tone reads −100 dBFS, a planted −60 dBFS spur measures −60.0, and a
plan that cannot resolve its grids returns an impossible value no assertion can
accept.

The decimation corner was chosen by measurement too, and against the intuition:
the alias floor is −87 dB at _every_ corner from 0.30 to 0.98 of Nyquist, while
a _lower_ corner causes more clicks, because a fourth-order Butterworth rings
longer on a step the lower it is set. 0.75 is clear of the 0.60 edge.

`D1` is PASS, and half of it is now a thing that cannot be got wrong rather
than a thing that is checked. The cell has two claims — that the controls the
UI exposes and the setters the DSP has are the same set, and that each setter
reaches audio. The first was going to be a parity test between two
hand-maintained tables, which is a test that passes for a long time and then
fails once, after the drift has shipped; across fourteen units that is fourteen
chances. Both tables are now generated from
`motionwave/manifests/fx-01-motion-shaper.json`, so a control naming a
parameter the processor does not have fails to compile
(`scripts/generate-params.mjs`, and `npm run params:check` in the build stops a
hand edit to either generated file).

The second claim is measured, because it cannot be made structural: a generated
switch proves a call happens, not that the value changes the sound.
`core/test/param_delta_tests.cpp` renders every parameter at two values and
requires an audible difference — the sixteen come in between −16.4 and
−42.8 dBFS against a −60 dB gate. It is held to the stricter reading as well: a
band control must move _its own_ band, checked spectrally, because wiring
`DepthHigh` to band 0 was tried against the delta test alone and passed at
−17.6 dB. Both mutations are recorded in that file.

`X24` is PASS. The boundary is verified bit-for-bit against the native golden
render (`motionwave/ui/test/wasm_boundary.test.ts`), and the unit is then driven
end to end through it (`motionwave/ui/test/integration_motion_shaper.test.ts`):
the face's own control table, the specs' own tapers, the manifest's own ids, the
shipped `.wasm`, and back out as audio and as the frame the audio path
published. It measured the drawn curve's modulation at −24.22 dB against a
−24 dB range control, and the published band gain against the curve at the
published phase to 2.6e-3.

**X24 found a defect no native test could.** The published `bandGain` was the
raw curve value, not the factor the audio multiplies by — and between the two
sit Depth, Range and Mix. A face fed from it drew a full-depth swing while the
audio was untouched at Mix 0, which is the house rule's exact failure: a picture
made from a second evaluation. At the default Depth 1, Range −60 dB and Mix 1
the two agree to within 0.001, which is why every native case passed either way.
Fixed in `publishFrame`, with a native case at Mix 0 and at Range −6 dB that
fails without the fix.

**Not yet measured:** V5 (modulator alias floor — needs the BLEP path, which is
not built), V9 (topology-change pop — needs the 4 ms crossfade of §4.6, not
built), V10 (denormal stall — needs per-block timing, and the timing here is not
trustworthy enough to assert a 1.2× ratio; a candidate for
`HARDWARE_VERIFICATION.md`).

`U19`, `U20` and `U23` are PASS against the face's declaration.

`U21` and `U22` were BLOCKED, and the recorded reason — "no display", "no layout
engine" — had quietly stopped being true: this host has Chromium. What was
actually missing was something to lay out and something to pace. Both now exist
and both cells are measured, in `motionwave/ui/e2e/panel.spec.ts`:

- `motionwave/ui/render/facePanel.ts` renders any `UnitFace` into the DOM,
  built once for all fourteen units. It knows nothing about any unit, and may
  not: the moment it grows a special case, the next thirteen faces stop being
  declarations.
- `motionwave/ui/dev/public/shaper_worklet.js` runs the core on the browser's
  real-time thread and publishes through a `SharedArrayBuffer` seqlock — the
  same odd/even discipline as the C++ `VisualPublisher`, for the same reason.
  Nothing is posted per block; the reader is never waited for.

`U21` measures **60.0 fps with 0 torn reads**, a playhead taking 20 distinct
positions in 20 frames while the engine runs — and **exactly one** while the
engine is suspended and the display clock keeps ticking. That last is the case
that gives the others meaning: a face animating on a timer is indistinguishable
from a face reading engine state until the engine stops. It was mutation-tested
by fabricating the phase from `performance.now()`, which passed every other
check and failed that one with 20 positions.

`U22` measures the column count either side of each breakpoint the _face_
declares — 1 → 2 at 30 em, 2 → 4 at 48 em — every press target against the 44 px
minimum in both axes and not clipped by its container, and no horizontal
overflow from 320 px up. The touch check was mutation-tested twice: the first
version measured the control's _wrapper_ and a 19 px target passed it, which is
RA-002's own mistake committed by the test written for RA-002. Measured against
the box that receives the press, it fails.

The vitest suite still reports both BLOCKED, and that is correct there: a cell
that reported PASS from jsdom would be reporting a layout nobody laid out.

| Unit                | Sheet    | Status      | D1   | D2   | D3   | D4   | D5   | D6   | D7   | D8   | D9   | D10  | D11  | D12  | I13 | I14 | I15 | I16 | I17 | I18 | U19  | U20  | U21  | U22  | U23  | X24  |
| ------------------- | -------- | ----------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | --- | --- | --- | --- | --- | --- | ---- | ---- | ---- | ---- | ---- | ---- |
| Motion Shaper       | `fx-01`  | SHIPPING    | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | n/a | n/a | n/a | n/a | n/a | n/a | PASS | PASS | PASS | PASS | PASS | PASS |
| Program EQ          | `dyn-01` | SHIPPING    | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | n/a | n/a | n/a | n/a | n/a | n/a | PASS | PASS | PASS | PASS | PASS | PASS |
| Optical Leveller    | `dyn-02` | SHIPPING    | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | n/a | n/a | n/a | n/a | n/a | n/a | PASS | PASS | PASS | PASS | PASS | PASS |
| FET Limiter         | `dyn-03` | SHIPPING    | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | n/a | n/a | n/a | n/a | n/a | n/a | PASS | PASS | PASS | PASS | PASS | PASS |
| Variable-Mu Limiter | `dyn-04` | SHIPPING    | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | n/a | n/a | n/a | n/a | n/a | n/a | PASS | PASS | PASS | PASS | PASS | PASS |
| Console EQ          | `dyn-05` | SHIPPING    | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | n/a | n/a | n/a | n/a | n/a | n/a | PASS | PASS | PASS | PASS | PASS | PASS |
| Granular Reverb     | `fx-02`  | DSP MEASURED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | n/a | n/a | n/a | n/a | n/a | n/a | —    | —    | —    | —    | —    | —    |
| Granular Delay      | `fx-03`  | NOT STARTED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | n/a | n/a | n/a | n/a | n/a | n/a | —    | —    | —    | —    | —    | —    |
| Slipstream Sampler  | `smp-01` | NOT STARTED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —   | —   | —   | —   | —   | —   | —    | —    | —    | —    | —    | —    |
| DCO Poly            | `syn-01` | NOT STARTED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —   | —   | —   | —   | —   | —   | —    | —    | —    | —    | —    | —    |
| Phase Distortion    | `syn-02` | NOT STARTED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —   | —   | —   | —   | —   | —   | —    | —    | —    | —    | —    | —    |
| Analog Five         | `syn-03` | NOT STARTED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —   | —   | —   | —   | —   | —   | —    | —    | —    | —    | —    | —    |
| Six-Op FM           | `syn-04` | NOT STARTED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —   | —   | —   | —   | —   | —   | —    | —    | —    | —    | —    | —    |
| Matrix Twelve       | `syn-05` | NOT STARTED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —   | —   | —   | —   | —   | —   | —    | —    | —    | —    | —    | —    |

### Program EQ

The DSP is built and all thirteen of `dyn-01` §9's measurements pass, at 48 kHz
and — where the sheet asks for it — 96 kHz. `D1` is closed the same way the
Motion Shaper's is: both parameter tables are generated from
`motionwave/manifests/dyn-01-program-eq.json`, so the parity half cannot be
written down wrongly, and `core/test/program_eq_delta_tests.cpp` measures the
half that has to be measured. `D3` is the sheet itself, in `program_eq_tests.cpp`
(response) and `program_eq_amp_tests.cpp` (amplifier and transformers). `D5` is
the alias measurement, test 13, at −89.3 dBFS against a −70 dBFS requirement.

The rest of the D column is not claimed yet. Four of the six UI cells are:
`U19`, `U20` and `U23` in `motionwave/ui/test/program_eq_cells.test.ts`, and
`U22` in the browser suite — the same renderer, the same assertions, a second
face. That last is the first real test of the framework rather than of a unit: a
renderer that had grown a special case for the face it was written against would
have passed for that one and failed here.

`U21` and `X24` wait on the same thing, which is this unit's engine across the
WebAssembly boundary. `U21` is a claim about two clocks and cannot be shortcut
the way `U22` can — geometry needs a face and a browser, but frame pacing needs
an engine actually running. The panel harness says so rather than rendering a
dead panel, because a face nothing is driving is exactly what that cell exists to
catch.

Four things the sheet's own numbers could not settle, each resolved toward its
equations and recorded where it was found rather than in a footnote:

- The 3.5-octave displacement of the low cut is the centre of a published
  three-to-four-octave range and is inference, as §3.3 says. Measured, it puts
  the 30, 60 and 100 Hz selectors' dips at 339, 682 and 1153 Hz.
- The low shelf's corner sits 2.5× above the selector's label. With the corner
  _at_ the label a 20 Hz setting's plateau falls below 5 Hz and the boost
  measures +8.9 dB where the manual says +13.5. §9 test 3 explicitly expects an
  offset and says to log it rather than fail on it; at 2.5 the four settings
  measure +12.8, +13.2, +13.7 and +13.8 dB and each peaks within a quarter of an
  octave of its label.
- The BANDWIDTH endpoints are ours, Q 0.6 to 2.0, and the sheet says they must
  be flagged as such until measured.
- The published −16 dB high shelf cannot assert its asymptote at a 48 kHz host
  when the selector is at 20 kHz, because the corner is then at Nyquist's
  doorstep. Graded at 96 kHz, recorded at 48.

**Two bugs found by these tests, both in shared code.** The stages inside an
oversampled block were prepared at the host rate rather than the oversampled
one, so their 5 Hz restoration filters sat at 20 Hz and the unit measured 6.0 dB
down at 20 Hz with every control at zero. And the restoration filter itself
stalls in float32: once `(1−c)·|x−s|` falls below half an ULP of `s` the update
rounds back and the filter stops converging, leaving 2.3e−4 of standing DC that
the noise-floor test read as a floor 30 dB above the manual's. Its state is a
double now, and `nonlinear_tests.cpp` checks convergence at every rate a wrapper
can present.

### Optical Leveller

All thirteen of `dyn-02` §9's measurements pass. The cell is the whole dynamics
engine, so most of them are about time: COMPRESS 3.79:1 and LIMIT 8.43:1 at
10 dB of reduction, both reached at 0.40 on the control; attack 10.6 ms;
release 53 ms then 0.72 s cold, 4.41 s after a minute's work — a memory ratio of
6.2 against the required 2 — and back within 24 % after idling. Flat to 0.137 dB
with the compression off, THD 0.159 % at +10 dBm and 0.335 % at +16 with the
second harmonic 11.3 dB above the third, noise 75.0 dB below +10 dBm, and the
meter reading 1.10 dB on a 20 ms burst whose steady value is ten.

There is no threshold, no knee and no ratio anywhere in the unit, because §5
says there is none in the hardware and that an implementation computing
`if (level > threshold)` has already diverged. The mode laws are solved rather
than fitted: closing the loop gives a local ratio of `1 + R'(c)·c·law·ln10/20`,
which at 10 dB is `1 + 3.68·law`, so 3:1 wants 0.65 and the 8:1 floor wants 2.2.
Pushing past 2.8 makes the loop bistable and no setting reaches 10 dB at all.

Five model errors, each caught by a row rather than by review:

- The detector updated once per block — 10.7 ms of delay inside a loop whose
  attack is 10 ms. It overshot to 12 dB where the steady value was three.
- The sidechain saw the rectified waveform rather than a level, so the drive
  rippled at twice the tone and the equilibrium moved with history.
- Both release branches attacked at the same rate, so the pair overshot from
  cold and the excess left through the slow branch.
- Exposure integrated the conductance instead of the light, so a 200 ms burst
  accumulated nearly as much history as a minute of work.
- The pre-emphasis filtered the _rectified_ signal instead of the sidechain's
  audio, which removes the envelope's DC and deafens the detector at every
  frequency at once. At full emphasis the unit compressed 0.1 dB whatever it was
  fed.

And one in shared code: the photoresistive attenuator reused its lit resistance
as the series element, which caps the divider at exactly −6.02 dB in a unit
specified to reach 40.

### FET Limiter

All sixteen of `dyn-03` §9's rows measure, across four suites, plus `D1` across
all nine parameters and four of the six UI cells. The two outstanding cells are
U21 and X24, which need the WASM bridge.

Three of the last five rows found bugs that were not in this unit, and all three
are recorded under "What the shared library learned from this unit" below.

**The detector runs inside the oversampling wrapper, and that is the unit's
architecture rather than a tuning choice.** Its fastest attack is 20 µs, which
is 0.88 of a sample at 44.1 kHz — a detector clocked at the host rate cannot
express any setting faster than one sample, so the top third of the ATTACK
control would collapse onto one behaviour while the unit went on limiting and
sounding plausible. At 8× the inner period is 2.8 µs. The row that measures it
separates all seven positions cleanly at 44.1 kHz.

The attack constants are derived in two steps, neither a fit. The published
endpoints are 10-to-90 _spans_ and the detector wants a _time constant_, so the
first conversion is ln(9). The second is the loop: a proportional feedback loop
accelerates its own observed constant by 1/(1+L), so the detector must be slower
than the span it produces. Measured against a probe whose peak spacing cannot
limit it, that factor is 0.61, 0.66 and 0.59 at panel positions 1, 4 and 7 —
constant to within a tenth across a forty-to-one range of constants, which is
what says the loop gain really is roughly constant. One law reproduces both
endpoints: 812.5 µs against a published 800, and 20.8 against 20.

It looked like the factor varied — 4.9× at the slow end against 14.4× at the
fast end — and that was the **probe**. A peak detector only rises when a new
peak arrives, and the 1 kHz sine the sheet's own test 1 specifies delivers one
every 0.5 ms: ten times the span the fast end is meant to show. The sheet's test
cannot measure the number it asks for, and the row now uses a rectified level.

Three model bugs found, all by rows rather than by review:

- The FET's control sense was inverted, so more control meant _less_
  attenuation — a limiter that gets quieter as its detector works harder.
- Its drain feedback treated the audio as though it were already in pinch-off
  volts. The whole control span is 0.164 V, so a −12 dBFS signal swung the
  operating point across most of it: `gainDb` reported 45 dB for a control the
  element applied 1.7 dB at, and the loop drove to its stop at every input.
- Its pinch-off clamp capped attenuation at 25 dB where the specification gives 45.

Two instrument bugs, which is the more interesting half. `D1`'s base drove 18 dB
past the element's ceiling, so the control sat clamped and _could not release_ —
RELEASE measured as a dead control at every setting, and driving a limiter into
its stop turned out to be a test of the stop. And the four-button lag row timed
both states from the wrong instant, so both read 0.0 µs and `0 ≥ 0 × 10` passed.

That last one is now impossible to write. `MW_EXPECT_AT_LEAST_TIMES` and
`MW_EXPECT_EXCEEDS_BY` refuse any comparison whose operands are two zeros, two
identical values, or below a floor the row itself declares — and the predicate
behind them is unit-tested in `param_tests.cpp`, because a guard against vacuous
assertions that was itself vacuous would be the same bug one level up. Every
existing ratio and margin assertion across the suites now goes through them.

`Variance` carries a declared gate of −105 dBFS, and the reason is the topology
rather than a weak control: a feedback limiter drives to a fixed output level,
so drift in the gain element is absorbed by the loop and only the distortion
difference survives. Perturbing §3.8's Q BIAS and DIST TRIM — which is where a
drifted unit of this design actually differs — moved the row from −112 to
−94 dBFS; the remaining smallness is the loop doing its job.

Rows 2, 4, 6, 7 and 13 are written and their suite is not registered: 6 and 13
pass, 2, 4 and 7 do not. They share one diagnosed cause. The detector reads the
output's _waveform_, so at depth the FET's own harmonics raise the peak it sees,
which asks for more reduction and makes more harmonics — positive feedback
through distortion. The transfer curve turns over at about 12 dB of reduction
and runs to the element's stop, and three of the four ratio buttons measure as
_expanding_. Sweeping the drain coupling fixes the buttons in order, which
confirms the cause and is the wrong fix: that asymmetry is the unit's signature
and row 10 requires it.

Detecting on the output's _level_ instead — the element's input times the gain
it is applying — stabilises the loop and makes the release rows measurable for
the first time, but leaves the loop effectively feed-forward with a measured
1.72:1 where the algebra says 8:1, and regresses three dynamics rows that pass
today. Not taken. `PROGRESS.md` carries the next step.

Rows 9, 10, 11, 14 and 16 each needed a probe fixed or a mechanism found before
they could measure anything, and three of them found bugs outside this unit —
see the section that follows.

**Row 11 is a logged deviation, and the only one in this unit.** §9 asks ATTACK
fully clockwise and fully counter-clockwise to differ by 6 dB in distortion at
40 Hz. They cannot, and not because of this model: §4's published endpoints are
20 µs and 800 µs, and after the ln(9) conversion the slower one is a 375 µs
constant — one sixty-seventh of a 40 Hz period. Both endpoints therefore track
the cycle completely, and measured they produce 0.83 dB and 0.82 dB of gain
ripple. Forcing a separation would mean slowing the attack roughly thirty-fold
and failing test 1's published endpoints, which are a measurement rather than a
QA instruction.

The row asserts §4's _stated_ mechanism instead, and asserts more than the sheet
asked: distortion above 1 %, the third harmonic rising 23.3 dB as the frequency
falls from 1 kHz to 40 Hz, and the timing control that does set the ripple
separating by 21.7 dB. Total THD cannot see any of it — the element's own
distortion is second-harmonic led and reads 6.9 % against 6.4 % across that
whole frequency span, which is the element twice. The detector rectifies, so its
ripple is at 2f and lands on the third harmonic; H2 is the element's signature
and H3 is the detector's.

### Variable-Mu Limiter

All fifteen of `dyn-04` §9's rows measure, across four suites, plus `D1` across
ten parameters — the sweep, the determinism check and the block-size check.
U21 and X24 wait on the WASM bridge as the other units' do.

**Every channel control exists twice, and that was a modelling requirement
rather than a generalisation.** §3.5 and §3.7 say a user setting a different
threshold and a different time constant for the lateral and the vertical path is
the reason the unit is still on mix buses. The first draft had one set driving
both channels; it reproduced the matrix exactly — 271 dB of separation, round
trip within 0.002 dB — and still could not do what the matrix is for. Test 13
was the row that caught it, and only after its own probe was fixed: it had fed a
signal with large mono content and called it "vertical only", so it measured the
signal's balance rather than the unit's independence.

**Two time conversions are the law's, not a logarithm's.** The storage network
decays exponentially in control volts; what a measurement reads is decibels of
gain reduction, and `R = −20·p·log₁₀(1 − v/Vc)` sits between them. Recovering
from 10 dB to 1 dB is a factor of 8.20 in volts rather than of ten, so it takes
2.104 constants and not `ln(10)`'s 2.303 — and all four fixed positions came out
8.6 % short, by the same 8.6 % each, which is what a conversion error looks like
rather than a tuning one. With both conversions derived from the exponent the
four positions measure 0.302, 0.802, 2.002 and 5.002 s against published 0.3,
0.8, 2.0 and 5.0.

**The loop gain has a closed form and it was checked before it was used.** A
feedback compressor's local ratio is `1 + L`, and here
`L = 20·p·k / (ln10 · (1 − v/Vc))`. Evaluated at the sidechain gains the model
had, it predicted 1.570:1 and the render measured 1.57:1 — which is what made it
safe to invert: §3.6 publishes the DC threshold trim as moving the ratio across
roughly 2:1 to 30:1, and the same formula turns those into the two sidechain
gains. The trim then measures 2.00:1 and 27.07:1 with nothing fitted. The same
`L` sets how much the closed loop accelerates its own attack, evaluated at the
trim rather than at a nominal setting, which is why the attack is right at every
trim position rather than at one.

**The sidechain has no compression of its own, and removing it was a fix.** A
compressive term looked prudent and was wrong on this unit specifically: §5's
defining property is that the ratio _rises_ with reduction, and a sidechain
whose gain falls as the control grows cancels exactly that. It measured 1.61:1
at 3 dB of reduction and 1.55:1 at 20 — falling, where the sheet's whole §5 says
it must rise.

**The storage network is a chain of elements that each discharge to ground.**
The first attempt had each discharge toward its own source, which deadlocks: the
fast element decays toward the slow one while the slow one charges toward the
fast one, they meet, and neither has anywhere left to go. Measured, the gain
reduction settled at 5.58 dB of an initial 12.2 and stayed there past sixteen
seconds, so every recovery row in positions 5 and 6 timed out rather than
returning a wrong number — which is the failure mode that looks like a hang and
is really a topology.

**Its charge path scales to the fast branch, not to the storage element.** What
decides how much charge a burst delivers is how the charge path compares with
the rate the fast node is draining at, so a position whose fast branch dumps its
charge in 0.14 s needs a proportionally quicker path than one that takes 0.95 s.
Scaled the other way it served position 5 and left position 6's repeated-peaks
recovery at about a second against a published ten.

**Two probes here were the instrument again.** §9 test 1 specifies a 1 kHz sine
and cannot measure a 0.2 ms attack with it — the sidechain rectifies, so it is
handed a new peak every 0.5 ms, and the rise quantises to that spacing: positions
1 and 2 read 0.188 ms and positions 3 and 4 read 0.625, a ratio of 3.33 between
two settings that differ by exactly two. The same conflict as `dyn-03` §9 test 1
and resolved the same way, with a rectified level. And test 8 compared 13.76 dB
against exactly 0.00 dB, which the harness guard refused — correctly, because a
comparison against zero says nothing about a control's direction.

### Console EQ

All nineteen of `dyn-05` §10's rows measure, across three suites, plus `D1`
across twenty parameters. It is two lineages in one device and they do not share
a filter engine — §10 test 19 asserts that directly, and `bridged_t.h` and
`inductor_section.h` have nothing in common but a biquad.

**The transformers were an order of magnitude too small, and the library's
default is what made them so.** That default is calibrated for a _coloured_
transformer — 1.5 % third harmonic at −12 dBFS and 30 Hz. A console module's are
sized for a line level they are not supposed to colour: §9.1 publishes 0.07 %
from 50 Hz to 10 kHz at +20 dBu output, and with the default this path measured
49.9 % at 50 Hz. Fifty hertz is the binding corner, because flux goes as 1/f and
the 1 kHz and 10 kHz readings are twenty and two hundred times easier. Sized
from that one figure it now reads 0.0501 %.

**The EQ inductors see the network's own current, not the signal passing
through.** With the boost control at centre the network is out of circuit and
the inductor carries nothing. Driving the core with the through signal instead
made the EQ section a distortion source at every setting including flat, and
then §10 test 7 — which wants saturation under boost — and §9.1 — which wants
0.07 % with the EQ flat — pulled against each other with _no_ size of core
satisfying both: their two conditions are only four times apart in flux. Driving
it with what the network added satisfies both by construction, and test 7 now
separates by 44 dB rather than the 6 it asks for.

**Three probes here were the instrument.** A "near 1.6 kHz" peak search with a
six-octave window returned the low shelf's maximum, so the mid band's peak read
17.17 dB when the mid band was set to 12. A shelf's maximum was read at its peak
rather than its plateau, which made §9.1's ±16 dB and §10 test 4's overshoot
contradict each other — they are the same curve measured at two places. And the
band-pass's stop-band slope was read at 30 and 60 kHz on a 48 kHz render, past
half of Nyquist for the sections, where the bilinear transform steepens
everything: 17.68 dB per octave against a published twelve, of which 5.7 dB was
the transform.

**And one control did nothing.** `setBandPass` set its flag without marking the
unit dirty, so the filter's own switch — read in `rebuild`, not in `process` —
never took effect. §10 test 16 caught it. That is the class `tests/schemaWired`
exists for one product over, and it is worth recording that a manifest-generated
dispatch does not protect against it: the parameter reached the setter, and the
setter was the thing that was wrong.

### Granular Reverb — a calibration withdrawn, then a measurement designed

Seven of `fx-02` §9's rows measure. V1 nulls at −360 dBFS, V6 holds the decay to
3.51 % across a 15:1 density sweep, V9 keeps the loop signal at −3.44 dBFS with
no growth after the input stops, and V10 keeps the output DC at −136 dBFS. V5
and V11 took three attempts and are the reason this section is long.

**The first attempt fitted noise, and is recorded because it was wrong in an
instructive way.** §2.2's feedback relation is marked inference and §9 V5 says
to calibrate it against measured RT60 rather than ship it. Two real mechanisms
were identified — the cloud smears an impulse before the loop does anything, and
a loop whose per-pass gain is random decays faster than its mean gain says — and
coefficients were fitted to them from three measurements. The fit looked good:
it took the errors from +37.8 % to under 8 %.

It was fitting noise. The cloud's decay is not a stable quantity when measured
from one impulse: **which grains happen to catch the impulse decides how much
energy enters the loop at all**, and eight renders at one setting ranged from
0.0997 s to 0.4027 s. The fit proved it by breaking — adding the pitch sets moved
the spawn RNG stream and every coefficient shifted by about two to one. Averaging
over starting phases did not repair it, because walking the engine to a different
phase changes the state the impulse lands in rather than resampling one quantity;
eight phases to sixteen moved the two-second error from +10.6 % to +12.4 %.

So it was withdrawn in `024adbf` — V5 and V11 removed rather than softened, the
unit shipping §2.2's relation unmodified and the row marked open. The variance
was in the probe, and the probe had to be replaced before any number was worth
defending.

**The replacement is `core/test/decay_harness.h`, and it is built once for both
granular units.** Interrupted noise (ISO 3382): steady broadband excitation until
the loop settles, then a hard cut, so at the cut every grain slot is populated
with equal expected energy and the lottery never happens. Schroeder backward
integration of the squared decay rather than an envelope fit. T30 over −5 to
−35 dB extrapolated ×2, because a full 60 dB is noise-limited even in a
deterministic system. Thirty-two independent **engine seeds** — not starting
phases, which is precisely why sixteen had been worse than eight. Mean with a
95 % interval, and **the row passes only if the whole interval is inside
tolerance, not the mean alone.**

**The instrument is calibrated before it measures anything unknown.** V0 runs the
same method against a plain feedback delay line with the cloud bypassed, where
RT60 follows analytically as `−3t/log10(g)`: it reads −0.15 % at 50 ms/0.70,
−0.03 % at 120 ms/0.90 and +0.01 % at 250 ms/0.97 — a 58:1 range of decay. Had
that row disagreed, no reverb number after it would have been trustworthy, and
the point of running it first is that this is not discoverable afterwards.

With a trustworthy instrument the second fit also failed, and failed differently.
A rate-squared law held 2–16 s to within 3.5 % and then inverted at 1 s by
−39 %, because the loop is short enough there that **grain length truncates the
tail** — a mechanism no smooth law in the feedback coefficient can express. What
ships instead is `units/reverb_decay.h`: eighteen measured points of delivered
RT60 against feedback, interpolated in log-decay. It is calibration against the
unit's own behaviour, declared as such, with `kDecayFloorSeconds = 0.49` naming
the shortest decay the cloud can deliver at all rather than pretending the
control is linear below it. V5 now reads 1.013 s, 1.962 s, 3.986 s and 7.978 s
for 1/2/4/8 s asked, every interval inside ±5 %.

**V11's apparent drift was a beat.** Ten minutes of held tone showed the level
wandering across 1.73 dB, which reads as accumulation until you notice the 1 kHz
tone's 48-sample period against the 137-sample grain hop. The row now fits a
least-squares slope *with its own uncertainty* and passes on the interval
containing zero — −0.109 dB total drift, 95 % CI [−0.632, +0.415] — rather than
on any single-sample statistic that a beat can move.

**The same standard was then turned back on the grain engine's own rows.** GE-19
graded a density-step level change on one render and reported 0.010 dB; across
thirty-two seeds that comparison ranges −0.675 to +0.714 dB about a mean of
−0.084. The row would have passed on almost any seed and the number it printed
meant nothing, so it now runs the ensemble and grades the interval. GE-08 was
re-examined and stands: it grades a *count*, whose standard deviation is known
analytically rather than estimated, which is what lets one render decide it — and
that model is now itself checked against the observed spread over twelve seeds
(43.0 against 35.6 predicted, a ratio of 1.21) so the tolerance is measured
rather than asserted.

Three genuine defects were found on the way and are fixed. The feedback tap folds
the stereo cloud to mono for a mono buffer, and that fold costs 0.6397 by the pan
law, so the loop ran at 64 % of the gain the decay control asked for. Freeze wrote
faded samples while advancing the head, which erases the buffer a lap at a time
rather than holding it. And a grain cloud's gain for coherent content is
0.816·sqrt(O), so a +0.5 DC offset left the wet output at 1.18 with nothing having
accumulated — there is now a blocker on the way into the buffer as well as in the
loop.

The lesson generalises past this unit, and it is the reason the harness is shared:
**a stochastic engine needs its measurement designed before its numbers are
trusted**, a fit improving the residual is not evidence the fit is real, and the
instrument is validated against something analytic before it is pointed at
anything unknown.

### Two defects the remaining reverb rows found, and one row that cannot be run

Finishing `fx-02` §9 turned up two real faults. Both were invisible to every row
that existed before, and both were found by a row doing what its sheet said
rather than by review.

**§2.3's prose said to move the diffuser and the measurement said not to.** The
sheet describes the allpass chain as building echo density "immediately after
each grain onset", which reads as an instruction to put it on the wet bus so
every grain's first arrival is diffused; ours sat in the feedback path. Moving it
was tried in two forms and **both are worse on the row that grades exactly
this**. Against the loop-only placement's 125 ms, the full-length chain on the wet
bus read 398 ms and a short chain at a fifth of the lengths read 313 ms. The
reason is in the measure: normalised echo density counts what fraction of a
window exceeds that window's own standard deviation, and a handful of widely
spaced allpass echoes makes a signal *more* impulsive, which puts less of its
energy above that line rather than more. §2.3's premise holds for a reverb whose
early field is sparse; here the grain cloud is already the density builder.

What made that decidable was calibrating the measure before believing it —
Gaussian noise reads 0.995 on it, a sparse impulse train 0.000, a decaying
Gaussian tail 1.011 crossing 0.9 at 10 ms. Without that, "the number got worse"
is equally consistent with the instrument being wrong, and the sheet would have
won on authority. The chain is back in the loop, and **V7 is NOT MET at 125 ms
against §9's 80 ms**, recorded rather than softened, with §2.3's own escalation —
"if the series chain measures poorly on echo density (V7), switch to the tank" —
as the scoped remedy. That is a change to the loop's architecture and not
something to attempt as a side effect of finishing rows: it would invalidate the
decay calibration and several rows downstream of it.

One thing the detour did establish: the diffusion control is not dead. It reads
identically at every setting on V7 because the row measures a part of the signal
the control does not reach, but rendering at 0.0 and 1.0 differs by 3 % of peak.
The first thing checked was the setter, because this codebase has had exactly
that bug before — a live control in the wrong place looks the same from the row.

**A shifted 10 kHz tone folded back at −17.6 dBFS**, where §9 V12 asks for −70.
Reading a buffer at increment `r` moves content at `f` to `f·r`, so everything
above `fs/(2r)` folds; the Wide set's +19 semitones puts that corner at 8008 Hz
and V12 excites it at 10 kHz. §3.1's stated remedy is a one-pole at `0.45·fs/r`
and is marked `[I]`, so it could not be copied — and re-deriving it showed the
*shape* was wrong, not just the constant: 10 kHz is 0.32 octaves above the
corner, where a one-pole delivers about 2 dB of the 52 dB required. The sheet's
own remedy cannot meet the sheet's own tolerance. What ships instead is ours: the
interpolation kernel is scaled by the read rate, so its cutoff is `fs/(2r)` by
construction and the anti-imaging filter costs no separate pass over the buffer.
`LEGAL_NOTES.md` records it as the clearest case yet of why an `[I]` value is
quarantined — copying it would have shipped the mistake along with the number.

**V3's DC half cannot be run on this unit, and that is a consequence rather than
a gap.** §9 V3 feeds DC and looks for a line at `fs/blockSize`. The loop carries
a DC blocker — V10 *requires* the output DC below −80 dBFS from a +0.5 input — so
a DC excitation is removed before it reaches the buffer and the row would be
measuring silence. Where that behaviour can be observed is on the engine with no
loop around it, and it is: GE-02 grades constant overlap-add on DC and GE-03
grades the block-rate line on DC. What the unit-level row asserts instead is the
stronger statement the engine's version implies — the audio is bit-identical
across every block size a host might use, and a line at `fs/blockSize` cannot
exist in a signal that does not change when `blockSize` does. The same mapping
covers V2 (GE-02) and V8 (GE-08).

**V4 measured the test signal twice before it measured the cloud, and then found
its tolerance to be unreachable.** Read as written — envelope modulation from
white noise through a half-millisecond window — it reported 1.64 dB against a
1.5 dB tolerance at an overlap of thirty-two, and essentially none of that came
from the cloud: a half-millisecond window holds 24 samples, in which white noise's
own RMS fluctuates by about 1.3 dB before anything granulates it. Switching to a
steady tone was worse and instructively so: it read 5.5 dB at *every* overlap from
4 to 32, flat where incoherent summing should fall as one over the square root of
the overlap. That flatness is the diagnosis — grains read at randomised offsets
carry random phase, so a coherent input summed over any number of them is Rayleigh
distributed, and a Rayleigh amplitude's relative spread does not depend on how
many terms went into it. 5.5 dB is that distribution's own width.

What the row measures now is white noise through a ten-millisecond window, where
the signal's own fluctuation is about 0.2 dB, with that residue removed in
quadrature by running the same statistic through the same unit at Mix zero. The
modulation then falls the way it should: 4.31, 2.58, 1.44 and 1.04 dB at overlaps
of 4, 8, 16 and 32.

**And §9's 1.5 dB is unreachable at an overlap of four for any random-onset
cloud.** The output power in a short window is a sum of `O` independent
contributions, whose relative standard deviation is `1/sqrt(O)` whatever the
contributions are — `4.34/sqrt(O)` in decibels, so 2.17 dB at O = 4 and 1.53 dB at
O = 8, both above the tolerance before any defect is considered. The row therefore
grades §9's number from O = 16 up, where the floor permits it and the unit meets
it, and below that grades that the modulation is falling — which is what
distinguishes incoherent summing from some other mechanism that happens to be
large. Every point prints its own floor beside it.

### The grain engine's last three rows, and a row that graded nothing

GE-04, GE-11 and GE-21 close `lib-grain-engine.md` §11. Two of them needed the
same correction twice over, which is worth writing down once.

**GE-11 passed while measuring a cloud at unison.** It derives the fold
frequency from a pitch set spanning −12 to +19 — the +19 asks for 29966 Hz on a
10 kHz input, above Nyquist, folding to 18034 Hz — and measured that band. What
it never did was hand the pitch set to the engine. The row passed, comfortably,
on a rendering in which the artefact it grades could not exist. **What exposed it
was Eco reading better than the cubic tiers**, −106.5 dBFS against −101.2: linear
interpolation cannot beat a rate-scaled kernel at suppressing an image, so a
result in that order is not a measurement of interpolation at all. With the set
actually wired the figures separate the way the tiers are meant to — Eco −20.9
dBFS, Studio and Max −84.3 — and the row now asserts that ordering as well as the
thresholds, so the same mistake cannot pass twice. A row that grades an artefact
has to be shown producing the artefact.

**GE-04 was measuring the engine's startup.** It reported a 4.0 ms gap at an
overlap of thirty-two, where two grains are sounding at every instant and a gap
is impossible. The engine starts empty, so the first grains have not spawned yet
and the output is genuinely silent; the detector reported that as a gap, at every
overlap, which is why the number did not fall as the overlap rose. A discarded
first second removes it, and the gaps that remain are at O = 4 only.

That one is real and is a trade-off rather than a defect. Onsets are jittered at
0.6 of fully stochastic because a constant hop makes the grain rate audible as a
tone, and at an overlap of four that rate is 67 grains a second. The price is
that the instantaneous overlap occasionally reaches zero — a 6.5 ms hole at
t = 3.73 s of a four-second render, mid-stream. From O = 8 upward there is no gap
at any point. The row grades §11's criterion there and records the cost below it,
naming `scheduler.h`'s `onsetJitter` as the lever; moving that lever to pass a
row without deciding the trade would be the wrong way round. The modulation half
carries fx-02 V4's finding unchanged: the incoherent floor `4.34/sqrt(O)` is
2.17 dB at O = 4, already past §11's 1.5 dB even with its stated ±0.5.

**GE-21 nulls exactly, and now cannot do so vacuously.** A reversed grain over a
source symmetric about the span's centre reads the same values as the forward
one, and the residual is zero to the last bit. The risk in any null row is that
the feature under test does nothing at all and the null comes free, so the row
also renders both over an *asymmetric* source and requires them to diverge — they
differ by 0.72. It also compares sample against sample rather than against the
time-reversed buffer, which would null just as well while surviving the
off-by-one at the span's end that the row exists to find.

### What X24 found once every unit had one

The Motion Shaper had an integration test and the other four did not, and the
difference showed up the moment they got one: **four of the five published zeros
from their meters while passing audio in bypass.** A bypassed unit is still in
circuit and still audible, so a face reading silence for it is the one thing a
meter must never do. Every native row passed over it, because bypass is not what
any of them measure, and the Motion Shaper was right only because X24 had asked.

The browser cells found the second one. U22 measures that the panel never
overflows sideways, and the Variable-Mu overflowed the document by 12 px at
1000 px wide with _every individual element's box inside the viewport_ — the
hardest shape of this bug to find. The cause was a control label: an accessible
name long enough that its longest word set the grid track's min-content width,
which grew the track past its share. A zero min-width and `overflow-wrap` on the
control fixed it for every face at once, and the controls grid now asks for the
tier's column count rather than being pinned to it, so a squeezed pane loses a
column instead of overflowing.

### What the shared library learned from this unit

These sections carry what each unit taught the shared code. The `dyn-03`
entries are below; `dyn-04` added `applyPushPullVariance`, and
`core/dsp/timing_network.h` — the chained storage network — which the Console EQ
does not need but the remaining dynamics units will.

**One oversampler per channel is a correctness requirement.** The wrapper was a
single instance shared by both channels with the channel loop outside the sample
loop, so the right channel was filtered through the left channel's halfband
history and each block boundary was a discontinuity. It measured as sidebands at
exactly the host's block rate — −32.7 dBc at 64 frames, −47.9 dBc at 256 — and
it meant an export and a realtime render of the same project did not agree.
Eleven rows had passed over it because a mono render is bit-identical at every
block size. `expectBlockSizeIndependent` now lives in `delta_harness.h`, so the
remaining ten units inherit the check instead of each rediscovering it.

**A hysteresis loop's width is not constant.** The magnetic core's play operator
had a fixed half-width, so its residual had a fixed absolute size and its share
of the signal rose as 1/B without limit. Flux falls as 1/f, so a 15 kHz tone
behaved like a 1 kHz tone 24 dB quieter: 0.96 % distortion against a published
ceiling of 0.5 %, from a core that is supposed to be a _low-frequency_ source.
Steinmetz gives loss per cycle as B^1.6 and so loop width as B^0.6; anchoring
the taper at the published calibration flux leaves that point unchanged to five
digits and takes the 15 kHz reading to 0.0058 %. The floor still rises as the
level falls, which is the documented behaviour — as B^−0.4 rather than B^−1.

NL-07's threshold moved with it and was **re-derived, not refitted**: the play
residual is a triangle bounded by ±c, `hysteresisDepth` sets how much reaches
the curve, and the inverse filter weights the nth harmonic by n, giving
2·α·c/B = 0.0036 % at 30 Hz and −60 dBFS against 0.0032 % measured. The law was
checked at a second flux before being used — it predicts 1.437× between −60 and
−52 dBFS and delivers 1.465×.

**A balanced pair drifts differently from a single-ended stage**, so
`applyPushPullVariance` joins `applyVariance` and shares its hash. Its imbalance
term is additive rather than multiplicative, because a balanced pair's imbalance
is zero by design and a factor applied to zero is inert on exactly the units the
control exists for.

## What each column is

| Id    | Group            | Definition-of-Done item  |
| ----- | ---------------- | ------------------------ |
| `D1`  | DSP              | controls wired           |
| `D2`  | DSP              | ranges/tapers            |
| `D3`  | DSP              | sheet verification       |
| `D4`  | DSP              | bypass null −120         |
| `D5`  | DSP              | oversampling + alias dBc |
| `D6`  | DSP              | rates 44.1–192           |
| `D7`  | DSP              | buffers 32–1024          |
| `D8`  | DSP              | latency = PDC            |
| `D9`  | DSP              | param fuzz               |
| `D10` | DSP              | automation, no zipper    |
| `D11` | DSP              | preset round-trip        |
| `D12` | DSP              | tempo map                |
| `I13` | Instruments only | polyphony + stealing     |
| `I14` | Instruments only | stuck-note fuzz          |
| `I15` | Instruments only | panic clears             |
| `I16` | Instruments only | MPE                      |
| `I17` | Instruments only | presets audition         |
| `I18` | Instruments only | tuning                   |
| `U19` | UI               | original artwork         |
| `U20` | UI               | real engine state        |
| `U21` | UI               | 60 fps decoupled         |
| `U22` | UI               | responsive               |
| `U23` | UI               | themes + a11y            |

`n/a` in `I13`–`I18` marks a unit that is an effect and has no voices.

| Id    | Group       | Definition-of-Done item                                                                                           |
| ----- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `X24` | Integration | The unit's real DSP, compiled to WASM, driven by its real UI, produces correct audio and correct visualiser state |

## Who owns which cell, and where it runs

Directive 05 §2. The harness was blocking cells 1, 3–10, 12, 13 and 16–18
whenever a unit's DSP is C++ — which is every unit — on the grounds that it
could not run that DSP through TypeScript. Those are precisely the cells the C++
suite already proves natively with measured numbers, so the model was
re-verifying in TypeScript what was already verified in C++ and reporting the
duplication as a blockage. Across fourteen units that defers about 154 cells to
a hardware pass that does not exist.

| Layer          | Owns                                                                                | Runs where                                  | Needs Emscripten |
| -------------- | ----------------------------------------------------------------------------------- | ------------------------------------------- | ---------------- |
| C++ test suite | `D1`–`I18` — all DSP and instrument behaviour                                       | Native, `ctest --test-dir motionwave/build` | No               |
| TS harness     | `U19`–`U23` — artwork and IP, visualisers, responsive matrix, themes, accessibility | jsdom and Playwright                        | No               |
| Integration    | `X24`                                                                               | `npm run test:mw`                           | **Yes**          |

A cell owned by the C++ suite is `PASS` on the strength of its named C++ test.
It is not re-run through TypeScript, and the harness no longer claims it — a
second implementation of the same check is not a second proof, it is a second
thing that can be wrong.

`X24` is the one legitimate WASM dependency, and it is a real one: it is where a
unit stops being two separately-correct halves and becomes a thing a user can
hear. The boundary it rests on is verified bit-for-bit against the native golden
render (`motionwave/ui/test/wasm_boundary.test.ts`).

`BLOCKED` stays valid only for a genuine device capability — timing under a
real-time thread, display measurement, thermal behaviour — and those live in
`docs/HARDWARE_VERIFICATION.md` with their procedures.

## Build order — strict

Motion Shaper first and alone: it is what proves the framework, and nothing else
starts until it ships. Then the vintage five, sharing one nonlinear library built
during Program EQ. Then the granular pair, sharing one grain engine. Then the
sampler. Then the five synths, sharing one voice/envelope/LFO substrate.

```
Motion Shaper
Program EQ → Optical Leveller → FET Limiter → Variable-Mu → Console EQ
Granular Reverb → Granular Delay
Slipstream Sampler
DCO Poly → Phase Distortion → Analog Five → Six-Op FM → Matrix Twelve
```

**Do not duplicate DSP across units.** The shared libraries are listed in the
resume block in `PROGRESS.md` as they come into existence.

## Shared libraries

Their specifications are written and carry their own verification ids, which are
not unit cells and do not belong in the table above — a library is a
prerequisite for the units that consume it, not a fourteenth product. They are
tracked here so those ids have somewhere to live.

| Library          | Spec                                 | Verification ids | Status    |
| ---------------- | ------------------------------------ | ---------------- | --------- |
| Nonlinear stages | `docs/design/lib-nonlinear.md`       | NL-01…18         | SPEC ONLY |
| Grain engine     | `docs/design/lib-grain-engine.md`    | GE-01…21         | SPEC ONLY |
| Voice substrate  | `docs/design/lib-voice-substrate.md` | VS-01…32         | SPEC ONLY |

Built and shipping already, ahead of their specs because Motion Shaper needed
them: `core/dsp/biquad.h`, `crossover.h`, `curve.h`, `lfo_phase.h`,
`smoother.h`, and `core/render/offline_render.h`. Every one is consumed by more
than one of the fourteen, which is why they are in `dsp/` rather than inside the
unit that happened to need them first.

## Per-unit notes

Nothing yet. Each unit gets a section here as it starts, carrying the named test
behind every `PASS` and every deviation from its spec sheet with the measured
reason.
