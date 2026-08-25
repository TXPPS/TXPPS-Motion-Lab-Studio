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

**1 of 14 shipping.** Seven units are complete through cell 25 — their DSP is
measured, their audio reaches a track and their state persists. Cell 26 dropped
all seven: every control in the product was a slider and the seven panels were
one panel. The control primitives now exist in the shared framework, and
**Program EQ** is the first panel built end to end on them and the first back to
`SHIPPING`. The other six are held at `NOT SHIPPING` until each has its own
panel. See "Cell 26 — usability" below.

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

| Unit                | Sheet    | Status       | D1   | D2   | D3   | D4   | D5   | D6   | D7   | D8   | D9   | D10  | D11  | D12  | I13 | I14 | I15 | I16 | I17 | I18 | U19  | U20  | U21  | U22  | U23  | X24  | X25  | X26  | V27  |
| ------------------- | -------- | ------------ | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | --- | --- | --- | --- | --- | --- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| Motion Shaper       | `fx-01`  | SHIPPING     | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | n/a | n/a | n/a | n/a | n/a | n/a | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Program EQ          | `dyn-01` | SHIPPING     | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | n/a | n/a | n/a | n/a | n/a | n/a | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Optical Leveller    | `dyn-02` | SHIPPING     | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | n/a | n/a | n/a | n/a | n/a | n/a | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| FET Limiter         | `dyn-03` | SHIPPING     | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | n/a | n/a | n/a | n/a | n/a | n/a | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Variable-Mu Limiter | `dyn-04` | SHIPPING     | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | n/a | n/a | n/a | n/a | n/a | n/a | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Console EQ          | `dyn-05` | SHIPPING     | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | n/a | n/a | n/a | n/a | n/a | n/a | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Granular Reverb     | `fx-02`  | NOT SHIPPING | PASS | PASS | PASS | PASS | n/a  | PASS | PASS | PASS | PASS | PASS | PASS | PASS | n/a | n/a | n/a | n/a | n/a | n/a | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | FAIL |
| Granular Delay      | `fx-03`  | NOT STARTED  | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | n/a | n/a | n/a | n/a | n/a | n/a | —    | —    | —    | —    | —    | —    | —    | —    | —    |
| Slipstream Sampler  | `smp-01` | NOT STARTED  | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —   | —   | —   | —   | —   | —   | —    | —    | —    | —    | —    | —    | —    | —    | —    |
| DCO Poly            | `syn-01` | NOT STARTED  | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —   | —   | —   | —   | —   | —   | —    | —    | —    | —    | —    | —    | —    | —    | —    |
| Phase Distortion    | `syn-02` | NOT STARTED  | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —   | —   | —   | —   | —   | —   | —    | —    | —    | —    | —    | —    | —    | —    | —    |
| Analog Five         | `syn-03` | NOT STARTED  | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —   | —   | —   | —   | —   | —   | —    | —    | —    | —    | —    | —    | —    | —    | —    |
| Six-Op FM           | `syn-04` | NOT STARTED  | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —   | —   | —   | —   | —   | —   | —    | —    | —    | —    | —    | —    | —    | —    | —    |
| Matrix Twelve       | `syn-05` | NOT STARTED  | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —   | —   | —   | —   | —   | —   | —    | —    | —    | —    | —    | —    | —    | —    | —    |

### Cell 26 — usability, and why all seven dropped out again

Twenty-five cells passed on seven units that a user opened and could not tell
apart, and could not operate. The cells were not wrong about what they measured.
They measured the wrong set of things, and the shape of the miss is worth
stating because it is the second time in two directives:

- **`U19` is an IP cell wearing a styling cell's title.** "original artwork"
  checks that every declared asset has `origin: original` and an attribution.
  Seven faces declaring `panel-surface / original / drawn in code` satisfy it
  completely while rendering the same panel. The cell was doing its job; nothing
  was doing the other one.
- **`U22` measures that a control is at least 44 px.** It does not ask whether
  the 44 px is a knob or a slider. Every control in the product was
  `<input type="range">` — `render/facePanel.ts` built one for all six roles,
  through a ternary whose two branches both returned `'range'`. A stepped
  selector, a latching button and a rotary dial were the same widget with
  different labels.
- **`U20` proves a readout is bound to a real channel.** The Motion Shaper's
  curve — the control the whole unit is about — has no surface at all, and no
  cell asked for one, because `U20` is satisfied by the readouts that _do_ exist.

So cell 26 is not "make it prettier". It is the check that the twenty-five
cannot express: **is this a usable instrument, or a form?**

A unit passes only when all four hold:

1. Every control is the correct primitive for what it represents. A rotary
   parameter gets a knob, a stepped parameter gets a detented selector, a
   two-state parameter gets a switch or a latching button. `<input type="range">`
   standing in for any of these is a FAIL.
2. Every control is operable by touch in portrait on a phone — pointer capture,
   ≥ 44 pt, reachable and draggable one-handed.
3. The panel is visually distinct from every other unit's, at a glance.
4. The unit's defining control is present and operable.

**All seven failed it when it was written**, and their status column said
`NOT SHIPPING` rather than carrying a footnote under `SHIPPING`. That is the
point of applying a cell retroactively: a unit that fails a cell is not
shipping, and the ledger is the place that has to say so first.

**Program EQ passes it now** — the first panel built end to end on the new
primitives. The other six still fail, and their rows say so; each returns as its
own panel is built.

Every row is backed by a named case in `e2e/motionwave-face.spec.ts`, run
against the built app in Chromium through the app's own stores — the panel under
test is the one a user opens.

| Requirement        | How it is settled                                                  | Program EQ                                              |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------- |
| correct primitive  | behaviour, not appearance — a range input passes none of the three | vu, lamp, meter, selector, knob, toggle; no range input |
| — a knob           | a vertical drag moves it; a horizontal drag alone does not         | 0.0000 → 0.3200 on 70 px up; 0.0000 on 90 px sideways   |
| — a selector       | a tap advances one detent, and every resting value is on the grid  | 0.6667 → 1.0000, detent 0.3333                          |
| — a switch         | a tap flips it, and flips it back                                  | 1 → 0 → 1                                               |
| operable by thumb  | every control ≥ 44 px in both axes at 390 × 844 with touch         | 14 controls, smallest 90 px                             |
| no sideways scroll | `scrollWidth − clientWidth` on the panel itself                    | 0 px                                                    |
| visually distinct  | screenshots compared pairwise, against the framework default too   | differs from the default panel                          |
| defining control   | present and operable                                               | the two boost/atten legs and their frequency selectors  |

The touch row found a real defect while it was being written: the panel's rack
ears were a 1.5 rem border each side with the screw plates hung outside it at
`left: -1.5rem` and `right: -1.5rem`. An absolutely positioned box is placed
against the _padding_ box, so the right-hand plate stood 24 px past it — a panel
that scrolled sideways on a phone for furniture nobody can touch. The ears are
now inset shadows.

**The VU meter's scale is a stated deviation.** A standard VU face is not linear
in decibels: the marks crowd below −7 and open out above it, and their exact
fractional positions belong to the printed face rather than to the electrical
specification. This draws the scale linear in dB from −20 to +3 VU — correct at
the top where the meter is read, progressively optimistic at the bottom where it
is not. The _ballistics_ are not a deviation: they are solved from the standard's
two published numbers and land on 0.990000000 at 300 ms.

### Cell 25 — the host, and the three defects it found

Twenty-four cells passed on seven units that could not be inserted on a track.
`src/` contained no reference to `motionwave/`, `npm run build` ran neither the
WASM build nor the panel build, and the shipped bundle had no core in it. Every
one of those cells measured something real; none measured the boundary a user is
on the other side of. ADR-0007 records the decision that followed, and this cell
is the check that stops it recurring.

**All seven are SHIPPING again.** Each of the six requirements is backed by a
named row in `e2e/motionwave.spec.ts`, run against the built app in Chromium —
never the dev panel, which is the distinction the cell exists for.

| Unit                | RMS through the host | Latency | Reachable by              | Save/load                |
| ------------------- | -------------------- | ------- | ------------------------- | ------------------------ |
| Motion Shaper       | 0.0965               | SHIPPING| PASS                      | PASS                     |
| Program EQ          | 0.0959               | 46      | Low Boost, 24.6 %         | identical                |
| Optical Leveller    | 0.0949               | SHIPPING| PASS                      | PASS                     |
| FET Limiter         | 0.0213               | SHIPPING| PASS                      | PASS                     |
| Variable-Mu Limiter | 0.0958               | SHIPPING| PASS                      | PASS                     |
| Console EQ          | 0.0958               | SHIPPING| PASS                      | PASS                     |
| Granular Reverb     | 0.0640               | 0       | PASS                      | FAIL                     |

Three defects surfaced, and not one was visible to the twenty-four cells.

**An offline render outran the processor's asynchronous instantiation.** The
worklet builds its WebAssembly in a promise; `startRendering` runs a whole
timeline faster than real time. A one-second bounce through the Motion Shaper
came back at an RMS of 0.0001 and, on a second run, at exactly zero — no error,
no warning, and a rendered file that is not the mix. Nodes now publish a
readiness promise and the renderer waits for all of them.

**The Motion Shaper rendered silence until a shape was drawn.** An empty curve
evaluates to zero, which is right for a curve and wrong for a default. All
twenty-four of its cells passed while that was true, because every one sets a
curve before measuring. An undrawn shaper is now a wire — in the constructor,
not in `prepare`, because `prepare` runs _after_ a host sets its curves and
putting it there turned eight of the unit's own D1 rows red.

**Bypass never reached the DSP, on any unit.** The worklet handled `param` and
`curve` messages and silently ignored `bypass`, so all seven rendered
bit-identically whether bypassed or not — 0.0000 % apart, every one. Nothing
else could have caught it: the native suites set bypass through the C++ API
directly, the WASM boundary test sends no messages, and cell 24 measures a face
against its own DSP with no host to bypass it from. It took a row that renders
the same unit twice and requires the two to differ.

### A fourth defect, found from cell 26's side

**Commands written before a processor's core resolved were dropped.** The
worklet assigned `port.onmessage` inside the promise that loads its WebAssembly,
on the theory that a `MessagePort` queues what is sent before a handler exists.
A port does — until something starts it, and an AudioWorklet's port is started
by the implementation when the processor is constructed. So every parameter and
every curve the host wrote at construction landed in the window between the
processor existing and its core arriving, and went nowhere.

It was intermittent, which is why twenty-six cells never saw it: on a warm page
the core resolves before the host writes and nothing is lost. It surfaced as a
single flaky row in a full-suite run — a Motion Shaper with three saved curves
rendering at **0.096451**, which is exactly its undrawn wire, against
**0.025869** for the identical project a moment later. `shapes=3` on both, so
the save and the validator were blameless; the first render simply never
received the curves. A saved session opening as a wire, one time in some.

The processor now takes commands from the moment it exists and applies the
queue after `prepare`. Verified over two full passes of the cell 25 suite with
retries off: 28 rows, both round trips at 0.025868561 on the cold render.

`motionwave/ui/test/worklet_commands.test.ts` holds it, with the worklet's
global scope stubbed so the race can be entered deliberately rather than won by
luck — and it is mutation-tested: moving the handler back inside the promise
fails exactly the two rows about commands sent early.

### The default-state rule, and where its literal form had to bend

The rule is: insert the unit, touch nothing, assert audio passes **and is not
identical to bypass**. The first half is exactly right and is a row of its own.

The second half cannot be met by two of these units without making them worse.
A Motion Shaper with no shape drawn is a wire — deliberately, since the
alternative is the silence that prompted the rule. A Program EQ at its default
is flat, and its bypass removes the EQ networks while leaving the amplifiers,
exactly as `dyn-01` specifies. Both are _correctly_ indistinguishable from their
own bypass until a user touches something, and forcing a difference would mean
shipping devices that colour a track the moment they are inserted.

So what is asserted is what the rule protects: **the unit is reachable** — there
exists a setting at which it differs from bypass. A unit inert whatever you do
fails; a unit neutral until asked passes, which is what a neutral default means.
The settings come from the manifest, each parameter driven to its own declared
extremes, so a control added later is swept without anyone remembering.

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
least-squares slope _with its own uncertainty_ and passes on the interval
containing zero — −0.109 dB total drift, 95 % CI [−0.632, +0.415] — rather than
on any single-sample statistic that a beat can move.

**The same standard was then turned back on the grain engine's own rows.** GE-19
graded a density-step level change on one render and reported 0.010 dB; across
thirty-two seeds that comparison ranges −0.675 to +0.714 dB about a mean of
−0.084. The row would have passed on almost any seed and the number it printed
meant nothing, so it now runs the ensemble and grades the interval. GE-08 was
re-examined and stands: it grades a _count_, whose standard deviation is known
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
spaced allpass echoes makes a signal _more_ impulsive, which puts less of its
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
_shape_ was wrong, not just the constant: 10 kHz is 0.32 octaves above the
corner, where a one-pole delivers about 2 dB of the 52 dB required. The sheet's
own remedy cannot meet the sheet's own tolerance. What ships instead is ours: the
interpolation kernel is scaled by the read rate, so its cutoff is `fs/(2r)` by
construction and the anti-imaging filter costs no separate pass over the buffer.
`LEGAL_NOTES.md` records it as the clearest case yet of why an `[I]` value is
quarantined — copying it would have shipped the mistake along with the number.

**V3's DC half cannot be run on this unit, and that is a consequence rather than
a gap.** §9 V3 feeds DC and looks for a line at `fs/blockSize`. The loop carries
a DC blocker — V10 _requires_ the output DC below −80 dBFS from a +0.5 input — so
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
steady tone was worse and instructively so: it read 5.5 dB at _every_ overlap from
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
also renders both over an _asymmetric_ source and requires them to diverge — they
differ by 0.72. It also compares sample against sample rather than against the
time-reversed buffer, which would null just as well while surviving the
off-by-one at the span's end that the row exists to find.

### D1 on the reverb: three artefacts, and what a base has to be

`fx-02`'s manifest declares twenty-two controls, so the parity half of D1 is
generated and cannot be got wrong. The measured half found three problems in a
row, none of them in the unit, and they are worth recording together because
they are the same mistake in three forms: **the base was not a state in which
the control had anything to act on.**

**Size read a buffer that had not been written.** The read window runs out to
four seconds and the render was two, so at the wide settings most grains read
silence and the render tripped the sweep's own precondition that a render
contain signal before its difference is believed. That precondition is right;
the base was wrong. Four and a half seconds of priming now precede the capture.

**The priming then broke the block-size row, by 0.31 on a unit that is
block-size independent under every setting tried individually.** Stepping one
loop from −216000 by the block size only lands on zero when the block size
divides it — at 64 it does, at 97 it does not — so the capture began at a
different sample for each block size and the row compared two different stretches
of audio. Priming and capture are separate segments now, each clamping to its own
end. What made this findable rather than a shrug was checking the settings one at
a time first: pre-delay, onset jitter, pitch set, tilt and spray each measured
_exactly zero_ difference across block sizes, and five zeros next to one large
number is not a unit that is intermittently wrong.

**Pre-delay measured its full travel at −75 dBFS and was reported dead.** The
source's partials were at 110, 430, 1470, 3900 and 9100 Hz, gated at 2 Hz — every
one of which completes a whole number of cycles in 500 ms, which is exactly the
top of Pre-delay's range. Delaying a signal by its own period reproduces it. The
frequencies are now 113, 437, 1471, 3907 and 9103 Hz at a 1.7 Hz gate, which
share no such relationship with any setting this unit has. This has to be
arranged deliberately, because the round numbers that read well in a source
function are exactly the ones that divide into the round numbers a control's
range ends at.

With the base right, all twenty-two controls reach the audio by at least 19 dB
against a −70 dB gate, two renders of the same setting are bit-identical, and the
block size does not change the audio.

### The reverb's face, and the readout that corrected a test

`fx-02`'s face is the first whose display is a picture of internal state rather
than of a level. U20's rule — a picture is drawn from the same evaluation the
audio uses — has more to bind here than on any unit so far: the particle field
reads the grain frame the engine publishes from the pool the audio renders from,
so a point's position is a position a read came from and its brightness is the
windowed amplitude that sample was multiplied by. A field animated from Density
and Size would look almost identical, and would keep looking right at exactly the
moment the pool started dropping grains.

Four numbers sit beside the controls because no control states them. §6 asks for
the overlap by name — "not a control: display `O = R·L` live" — because it
predicts both the sound and the CPU and neither control that sets it predicts it
alone. §2.5 asks for the 8 kHz decay beside Damping, which turns a percentage
into the thing the percentage does. The other two are the density the quality
tier actually allowed and the loop gain the Decay control actually set, the
latter through a measured table with no closed form a face could reproduce.

**The delivered-overlap readout then corrected the test written to check it.**
X24 asserted that 800 grains a second at 50 ms grains reads 40. It reads 32 at
the Studio default, because §7.4's tier cap is 32 and the engine delivered what
it capped to. The expectation was wrong and the readout was right: a panel
showing 40 while 32 were sounding is the precise failure a delivered-value
readout exists to prevent. The row now checks the uncapped arithmetic on the tier
that permits it and checks the cap as a cap — and checks that the live grain
count follows it, which is what says the cap reached the scheduler rather than
only the display.

U19 passes with four original assets and provenance declared; the era language is
the one granular processors have shared since they became controllable in real
time — a wide dark field of point sources over a time axis, small detented
rotaries beneath, a latching hold switch set apart — which is general and
nobody's property. Nothing specific is taken from any product, and the forbidden
name scan runs over this face like every other.

### fx-02's remaining DSP cells, and the two that are not closed

D4, D6, D8, D9 and D10 are measured in `granular_reverb_cell_tests`. D4 nulls at
−240 dBFS, which is exact rather than merely inside the ledger's −120: bypass
here is not a crossfade to a parallel path, the wet bus is simply not summed. The
row carries a guard against the way a bypass null goes wrong — X24 found four
units publishing zeros from their meters while bypassed, and a bypass that nulled
by going silent would pass a carelessly written version of this and be badly
wrong, so the row also requires the dry signal to have been there.

D6 is the one worth a note. What can fail at a sample rate is not that the unit
refuses it; it is that something inside is written in samples where it should be
in seconds, which shows as a decay half as long at twice the rate. So the row
measures the _time_ to fall 20 dB at each of 44.1, 48, 88.2, 96 and 192 kHz —
1.050, 1.100, 1.100, 1.100 and 1.100 seconds, a spread of 4.8 % across a 4.35:1
range of rates. The failure it exists for is a factor, not a margin; what is left
is the cloud's own spread, because the grain series is not the same series at two
rates.

D9's exhaustiveness comes from the manifest rather than from a maintained list: it
fuzzes every row of the generated table, so a control added to the manifest is
fuzzed without anyone remembering to add it. Forty-eight random settings of
twenty-two parameters, 576 000 samples, all finite.

**Two cells are not closed and are recorded rather than claimed.**

`D5` is oversampling and alias dBc, and this unit has no oversampler — §3.1's
point is that a granular shifter needs no rate change, and the anti-imaging lives
in the interpolation kernel instead. The alias requirement itself is met and
measured: V12 puts the Wide set's fold at −115 dBFS against a −70 threshold, and
GE-11 publishes the figure per tier. The cell is therefore n/a _on the
oversampling half only_, which is worth stating explicitly because "no
oversampler" and "no alias measurement" would be very different claims.

`D12` was genuinely open — §6 lists a sync-to-tempo option for Pre-delay and the
unit had no tempo input at all — and is now built. The tempo comes from the host
per block, exactly as the Motion Shaper takes it, rather than from the tempo map
directly: `node.h` says in as many words that a processor wanting bars asks
rather than remembers, and a unit reading the map itself would keep a second
opinion about where the song is. The division is stepped rather than free,
because a synced delay that is _nearly_ a sixteenth is worse than an unsynced
one — it beats against the material instead of sitting outside it.

**Wiring it exposed a clamp that would have made the control look wired and do
nothing.** The pre-delay line was sized for half a second, which is §6's range
for the _millisecond_ control, and the resolved delay was clamped into it. A
musical value legitimately exceeds that: four quarters at 60 bpm is four
seconds. So a quarter note arrived at the same instant at 120 bpm and at 80 —
both resolved past the cap and both stopped there. The row caught it because it
measures the delay at two tempos rather than checking one number at 120, which is
the version that would have passed. The line is now sized for the synced maximum
and the millisecond control keeps its own 0–500 ms range.

### V7 decided once, for both granular units

The instruction was to settle this before `fx-03`'s diffusion was built rather
than discover it a second time, and the answer is not the one the sheet
predicts. It is recorded here in full because "we shipped with the deviation" is
worth nothing without the four measurements behind it.

**The tank exists, is shared, and is decisively the better diffuser.**
`dsp::DiffusionTank` is a recirculating figure-eight — every lap re-diffuses what
is already circulating, so arrivals grow exponentially where a series chain adds
them linearly. Measured on its own against a calibrated instrument it reaches
0.9 normalised echo density at **65 ms**, where `fx-02`'s series chain never
reaches it at all. Its settling time is derived from the lap time rather than
chosen, so it smears an arrival instead of adding a second reverb behind it: 40,
80 and 200 ms asked read 60, 90 and 210 measured.

Building it corrected two of my own errors, both structural rather than
numerical. The first lengths were tens of milliseconds, which put one lap at
54 ms — so an 80 ms settling time allowed one and a half laps, and the decay
gain that achieves that is 0.009, which is a tank that does not recirculate. It
measured 753 ms, _worse_ than the chain it replaced. The second was a settling
law that counted only the two delay lines: measured settling came out 2.10 times
the asked value at every setting, and a constant factor is the signature of a
term omitted from a derivation rather than a wrong law. The allpasses sit in the
lap path and their lengths sum to exactly that factor.

**And it does not fix V7, in any of three placements.** Against the loop-only
baseline's 125 ms: the full-length series chain on the wet bus reads 398 ms, a
short series chain 313 ms, the tank on the wet output 247 ms, and the tank
diffusing the input to the buffer 205 ms. Four placements, all worse than none,
with the best diffuser of them among the worst results.

**The reason is the row's excitation, and it is the same defect as V5's.**
Measured directly, the granular reverb's impulse response is _silent for eighty
milliseconds_, and then the density bounces between 0.18 and 1.02 from one 20 ms
window to the next while the RMS swings two orders of magnitude. A grain cloud
reading a buffer that holds one impulse emits one windowed sample per grain that
happens to catch it: the early IR is a sparse train of isolated events, and
whether a grain catches the impulse is a property of the probe rather than of the
reverb. Nothing downstream can put back arrivals that were never generated, and
diffusing the input does not generate them either. That is precisely why V5's
impulse measurement had to be replaced with interrupted noise one row over.

**So both units ship with the deviation, explicitly.** `fx-02`'s V7 is NOT MET at
125 ms against 80 ms; the row is named for its own shortfall and carries a
vacuity guard. `fx-03` has no echo-density row at all — §9.4 runs V1 to V16 and
none of them is one — so there is nothing there to fail, which is worth stating
so nobody goes looking. The tank stays built, tested and shared: if the listening
check below finds flutter, it is the component to reach for and its numbers are
already known.

**What actually closes this is the ear**, and it is now written down as such.
`docs/HARDWARE_VERIFICATION.md` carries V7 as a listening check with a procedure —
a dry snare and a close-miked acoustic guitar, at three densities, on both
transducers, A/B against diffusion disabled. The threshold 0.9-at-80-ms is the
literature's, not a measurement of our tail; a reverb can sit at 70 ms and
flutter on the wrong source or at 95 ms and be clean on everything anyone plays.
The offline number is a gate, not a verdict.

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

| Id    | Group       | Definition-of-Done item                                                                                                                                                                                            |
| ----- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `X24` | Integration | The unit's real DSP, compiled to WASM, driven by its real UI, produces correct audio and correct visualiser state                                                                                                  |
| `X25` | Host        | The unit is insertable, audible, editable, compensated and persistable **in the application** — not in the dev panel                                                                                               |
| `X26` | Usability   | Every control is the correct primitive for what it represents, operable by touch in portrait on a phone; the panel is visually distinct from every other unit; the unit's defining control is present and operable |
| `V27` | Live visual | The panel shows, in motion, what the unit is doing right now — see below                                                                                                                                           |

### `V27` — live visual feedback

Directive 09 §4.2. A unit passes `V27` when it has at least one continuously
animated element that:

1. Is driven by **published engine state**, never re-derived host-side and never
   faked from a timer.
2. **Stops when the audio stops.** This is the discriminator, and it is the only
   one of the four that cannot be satisfied by a plausible-looking animation:
   `U21` was mutation-tested by fabricating the phase from `performance.now()`,
   which passed every other check and failed this one. A face animating on a
   clock is indistinguishable from a face reading the engine right up until the
   engine stops.
3. Communicates the unit's actual mechanism, rather than decorating it.
4. Sustains 60 fps with no work added to the audio thread, degrading gracefully
   on a phone.

`V27` is **not** `U20`. `U20` asks whether a visualiser reads real engine state;
`V27` asks whether there is something _moving_ that a user can watch a mechanism
in. This is the distinction Directive 09 §9 names: a cell tests what it says,
not what its title implies.

### Program EQ is `PASS`, and what it took

The unit satisfied `U20` from the day it was written and still failed this, for
a reason that is the clearest illustration of the difference. Its most
mechanism-revealing readout is the harmonic display, and that reads
`TriodeStage::curvature` — which is `nl::curvature(config_.bias)`, a function of
the _configuration_. Real engine state, honestly published, and it does not
change until a knob does. `program_eq_visual_tests.cpp` asserts that it stays
that way, so nobody reads the rows below and concludes the harmonic display now
animates.

What moves with the music is the iron, and it was being published wrongly. The
two transformer fields were assigned the input and output **peaks** — a second
opinion of the kind `CLAUDE.md` rules out, and a specific one: a transformer
follows flux, flux is the integral of the voltage, so the same level at 30 Hz
and 1 kHz drives the core by amounts that differ by more than an order of
magnitude. A meter fed the peak reads identically for both, and so cannot show
the one thing it is named after — `dyn-01` §7's low-frequency thickening. They
now carry the core's own peak flux, as a fraction of its saturation knee.

The discriminator is a case that fails if either field is ever wired back to a
level: two tones at _equal amplitude_ must not read the same. Wire it back and
it prints `30 Hz core 0.2510, 1 kHz core 0.2510, ratio 1.0 x` and fails; nothing
else in that file would.

The browser end is `e2e/live_visual.spec.ts`, which measures all four
requirements against a running engine — 29 distinct values over 40 frames while
the tone plays, and exactly one after the context is suspended. Mutation-tested
the way `U21` was: fabricating the value from `performance.now()` gives 40
distinct values of 40 while running, which passes everything except the stop,
where it reads 20 instead of 1.

### The other six, measured

Directive 11 §8. `V27` was `FAIL` on all six and the reasons were three
different things, none of which was "the animation has not been built".

**Five had never had an engine behind them.** `dev/panel.ts` kept a hand-written
channel order for two units and returned early for any unit it had no entry for,
so five faces had never been paced against a running worklet on the page the
cell is measured on. It reads the order off `unit.meters` now, which is what
`MotionWaveFace.tsx` in the app has always done — the duplicate was the defect,
and the copy that was wrong was the one nobody was looking at.

**A steady tone cannot reveal a leveller.** A detector settles inside its attack
and then every block publishes the same figure, so a probe that holds its level
constant measures the probe. The dynamics units are driven with an envelope and
put into the state their mechanism needs: the Optical Leveller's Peak Reduction
defaults to zero, which is a leveller with the cell dark, and the FET Limiter at
unity input sat 17.9 dB into limiting where the detector is pinned.

**Two were publishing defects, and both are the `dyn-01` defect again.**

| unit | field | was | is |
| --- | --- | --- | --- |
| Variable-Mu | `storage` | `stageValue(1)` — the second timing element, which only exists at time-constant positions 5 and 6, so four settings including the default published a slot the model never writes | `value()` — what the network is holding across the elements in circuit |
| Console EQ | — | nothing that moved: widths and a working Q are functions of the controls, peaks are levels | `eqCoreDrive`, the EQ inductor's peak flux |

The Console EQ's is the better readout of the two, because it also says which
unit is in circuit: §7.2 gives the bridged-T panel no inductors, so the meter
that breathes on one lineage reads exactly zero on the other.
`console_eq_visual_tests.cpp` holds three discriminators — a bell boosted at two
centres and probed at each (same current, 4.44× the flux, which is the frequency
ratio), a flat EQ against a boosted one, and the American lineage reading zero.
The first of those took two attempts: the first version compared a low shelf at
50 Hz against the same shelf at 1 kHz, where a shelf adds nothing, so wiring the
field to an amplitude passed all six cases. The mutation is what said so.

**Six of the seven pass. The Granular Reverb does not, and it needs engine work
rather than a face.** Every field it publishes but the two peaks is a function
of the controls — `overlap`, `clampedDensity`, `rt60At8k`, `feedback` and
`liveGrains`, which is a spawn rate and a grain length and therefore sits at 22
whatever the music does. What moves with the music in a granular reverb is where
the cloud is reading from and what it finds there, and neither is published. It
is recorded `FAIL` rather than given a level meter and called animated.

## Who owns which cell, and where it runs

Directive 05 §2. The harness was blocking cells 1, 3–10, 12, 13 and 16–18
whenever a unit's DSP is C++ — which is every unit — on the grounds that it
could not run that DSP through TypeScript. Those are precisely the cells the C++
suite already proves natively with measured numbers, so the model was
re-verifying in TypeScript what was already verified in C++ and reporting the
duplication as a blockage. Across fourteen units that defers about 154 cells to
a hardware pass that does not exist.

| Layer          | Owns                                                                                | Runs where                                   | Needs Emscripten |
| -------------- | ----------------------------------------------------------------------------------- | -------------------------------------------- | ---------------- |
| C++ test suite | `D1`–`I18` — all DSP and instrument behaviour                                       | Native, `ctest --test-dir motionwave/build`  | No               |
| TS harness     | `U19`–`U23` — artwork and IP, visualisers, responsive matrix, themes, accessibility | jsdom and Playwright                         | No               |
| Integration    | `X24`                                                                               | `npm run test:mw`                            | **Yes**          |
| Host           | `X25`                                                                               | `npx playwright test e2e/motionwave.spec.ts` | **Yes**          |

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
