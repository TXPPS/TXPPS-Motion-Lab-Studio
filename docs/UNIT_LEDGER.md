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

`X24` is PASS: the WASM boundary is verified bit-for-bit against the native
golden render, including block-size invariance across it
(`motionwave/ui/test/wasm_boundary.test.ts`).

**Not yet measured:** V5 (modulator alias floor — needs the BLEP path, which is
not built), V9 (topology-change pop — needs the 4 ms crossfade of §4.6, not
built), V10 (denormal stall — needs per-block timing, and the timing here is not
trustworthy enough to assert a 1.2× ratio; a candidate for
`HARDWARE_VERIFICATION.md`).

**Not started:** every UI cell. `U19`–`U23` need the framework Stream C is
building.

| Unit                | Sheet    | Status      | D1  | D2   | D3  | D4   | D5   | D6   | D7   | D8   | D9  | D10  | D11 | D12  | I13 | I14 | I15 | I16 | I17 | I18 | U19 | U20 | U21 | U22 | U23 | X24  |
| ------------------- | -------- | ----------- | --- | ---- | --- | ---- | ---- | ---- | ---- | ---- | --- | ---- | --- | ---- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---- |
| Motion Shaper       | `fx-01`  | DSP PARTIAL | —   | PASS | —   | PASS | PASS | PASS | PASS | PASS | —   | PASS | —   | PASS | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   | PASS |
| Program EQ          | `dyn-01` | NOT STARTED | —   | —    | —   | —    | —    | —    | —    | —    | —   | —    | —   | —    | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   | —    |
| Optical Leveller    | `dyn-02` | NOT STARTED | —   | —    | —   | —    | —    | —    | —    | —    | —   | —    | —   | —    | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   | —    |
| FET Limiter         | `dyn-03` | NOT STARTED | —   | —    | —   | —    | —    | —    | —    | —    | —   | —    | —   | —    | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   | —    |
| Variable-Mu Limiter | `dyn-04` | NOT STARTED | —   | —    | —   | —    | —    | —    | —    | —    | —   | —    | —   | —    | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   | —    |
| Console EQ          | `dyn-05` | NOT STARTED | —   | —    | —   | —    | —    | —    | —    | —    | —   | —    | —   | —    | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   | —    |
| Granular Reverb     | `fx-02`  | NOT STARTED | —   | —    | —   | —    | —    | —    | —    | —    | —   | —    | —   | —    | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   | —    |
| Granular Delay      | `fx-03`  | NOT STARTED | —   | —    | —   | —    | —    | —    | —    | —    | —   | —    | —   | —    | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   | —    |
| Slipstream Sampler  | `smp-01` | NOT STARTED | —   | —    | —   | —    | —    | —    | —    | —    | —   | —    | —   | —    | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —    |
| DCO Poly            | `syn-01` | NOT STARTED | —   | —    | —   | —    | —    | —    | —    | —    | —   | —    | —   | —    | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —    |
| Phase Distortion    | `syn-02` | NOT STARTED | —   | —    | —   | —    | —    | —    | —    | —    | —   | —    | —   | —    | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —    |
| Analog Five         | `syn-03` | NOT STARTED | —   | —    | —   | —    | —    | —    | —    | —    | —   | —    | —   | —    | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —    |
| Six-Op FM           | `syn-04` | NOT STARTED | —   | —    | —   | —    | —    | —    | —    | —    | —   | —    | —   | —    | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —    |
| Matrix Twelve       | `syn-05` | NOT STARTED | —   | —    | —   | —    | —    | —    | —    | —    | —   | —    | —   | —    | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —    |

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
