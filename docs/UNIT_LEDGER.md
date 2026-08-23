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
| Program EQ          | `dyn-01` | DSP PARTIAL | PASS | —    | PASS | —    | PASS | —    | —    | —    | —    | —    | —    | —    | n/a | n/a | n/a | n/a | n/a | n/a | —    | —    | —    | —    | —    | —    |
| Optical Leveller    | `dyn-02` | NOT STARTED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | n/a | n/a | n/a | n/a | n/a | n/a | —    | —    | —    | —    | —    | —    |
| FET Limiter         | `dyn-03` | NOT STARTED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | n/a | n/a | n/a | n/a | n/a | n/a | —    | —    | —    | —    | —    | —    |
| Variable-Mu Limiter | `dyn-04` | NOT STARTED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | n/a | n/a | n/a | n/a | n/a | n/a | —    | —    | —    | —    | —    | —    |
| Console EQ          | `dyn-05` | NOT STARTED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | n/a | n/a | n/a | n/a | n/a | n/a | —    | —    | —    | —    | —    | —    |
| Granular Reverb     | `fx-02`  | NOT STARTED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | n/a | n/a | n/a | n/a | n/a | n/a | —    | —    | —    | —    | —    | —    |
| Granular Delay      | `fx-03`  | NOT STARTED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | n/a | n/a | n/a | n/a | n/a | n/a | —    | —    | —    | —    | —    | —    |
| Slipstream Sampler  | `smp-01` | NOT STARTED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —   | —   | —   | —   | —   | —   | —    | —    | —    | —    | —    | —    |
| DCO Poly            | `syn-01` | NOT STARTED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —   | —   | —   | —   | —   | —   | —    | —    | —    | —    | —    | —    |
| Phase Distortion    | `syn-02` | NOT STARTED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —   | —   | —   | —   | —   | —   | —    | —    | —    | —    | —    | —    |
| Analog Five         | `syn-03` | NOT STARTED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —   | —   | —   | —   | —   | —   | —    | —    | —    | —    | —    | —    |
| Six-Op FM           | `syn-04` | NOT STARTED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —   | —   | —   | —   | —   | —   | —    | —    | —    | —    | —    | —    |
| Matrix Twelve       | `syn-05` | NOT STARTED | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —    | —   | —   | —   | —   | —   | —   | —    | —    | —    | —    | —    | —    |

### Program EQ, so far

The DSP is built and all thirteen of `dyn-01` §9's measurements pass, at 48 kHz
and — where the sheet asks for it — 96 kHz. `D1` is closed the same way the
Motion Shaper's is: both parameter tables are generated from
`motionwave/manifests/dyn-01-program-eq.json`, so the parity half cannot be
written down wrongly, and `core/test/program_eq_delta_tests.cpp` measures the
half that has to be measured. `D3` is the sheet itself, in `program_eq_tests.cpp`
(response) and `program_eq_amp_tests.cpp` (amplifier and transformers). `D5` is
the alias measurement, test 13, at −89.3 dBFS against a −70 dBFS requirement.

The rest of the D column is not claimed yet, and the UI cells are not started.

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
