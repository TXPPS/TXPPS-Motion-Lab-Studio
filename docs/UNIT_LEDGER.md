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

**Not yet measured:** V5 (modulator alias floor — needs the BLEP path, which is
not built), V9 (topology-change pop — needs the 4 ms crossfade of §4.6, not
built), V10 (denormal stall — needs per-block timing, and the timing here is not
trustworthy enough to assert a 1.2× ratio; a candidate for
`HARDWARE_VERIFICATION.md`).

**Not started:** every UI cell. `U19`–`U23` need the framework Stream C is
building.

| Unit                | Sheet    | Status      | D1  | D2  | D3  | D4   | D5  | D6  | D7   | D8   | D9  | D10 | D11 | D12 | I13 | I14 | I15 | I16 | I17 | I18 | U19 | U20 | U21 | U22 | U23 |
| ------------------- | -------- | ----------- | --- | --- | --- | ---- | --- | --- | ---- | ---- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Motion Shaper       | `fx-01`  | DSP PARTIAL | —   | —   | —   | PASS | —   | —   | PASS | PASS | —   | —   | —   | —   | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   |
| Program EQ          | `dyn-01` | NOT STARTED | —   | —   | —   | —    | —   | —   | —    | —    | —   | —   | —   | —   | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   |
| Optical Leveller    | `dyn-02` | NOT STARTED | —   | —   | —   | —    | —   | —   | —    | —    | —   | —   | —   | —   | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   |
| FET Limiter         | `dyn-03` | NOT STARTED | —   | —   | —   | —    | —   | —   | —    | —    | —   | —   | —   | —   | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   |
| Variable-Mu Limiter | `dyn-04` | NOT STARTED | —   | —   | —   | —    | —   | —   | —    | —    | —   | —   | —   | —   | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   |
| Console EQ          | `dyn-05` | NOT STARTED | —   | —   | —   | —    | —   | —   | —    | —    | —   | —   | —   | —   | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   |
| Granular Reverb     | `fx-02`  | NOT STARTED | —   | —   | —   | —    | —   | —   | —    | —    | —   | —   | —   | —   | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   |
| Granular Delay      | `fx-03`  | NOT STARTED | —   | —   | —   | —    | —   | —   | —    | —    | —   | —   | —   | —   | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   |
| Slipstream Sampler  | `smp-01` | NOT STARTED | —   | —   | —   | —    | —   | —   | —    | —    | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| DCO Poly            | `syn-01` | NOT STARTED | —   | —   | —   | —    | —   | —   | —    | —    | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Phase Distortion    | `syn-02` | NOT STARTED | —   | —   | —   | —    | —   | —   | —    | —    | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Analog Five         | `syn-03` | NOT STARTED | —   | —   | —   | —    | —   | —   | —    | —    | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Six-Op FM           | `syn-04` | NOT STARTED | —   | —   | —   | —    | —   | —   | —    | —    | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Matrix Twelve       | `syn-05` | NOT STARTED | —   | —   | —   | —    | —   | —   | —    | —    | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |

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
