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

**0 of 14 shipping.** The framework they are all built against does not exist
yet (§2.3, §2.4), so no unit can be started: rule 3 of the directive is that a
unit is built or it is not started, and there is no third state.

| Unit                | Sheet    | Status      | D1  | D2  | D3  | D4  | D5  | D6  | D7  | D8  | D9  | D10 | D11 | D12 | I13 | I14 | I15 | I16 | I17 | I18 | U19 | U20 | U21 | U22 | U23 |
| ------------------- | -------- | ----------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Motion Shaper       | `fx-01`  | NOT STARTED | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   |
| Program EQ          | `dyn-01` | NOT STARTED | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   |
| Optical Leveller    | `dyn-02` | NOT STARTED | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   |
| FET Limiter         | `dyn-03` | NOT STARTED | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   |
| Variable-Mu Limiter | `dyn-04` | NOT STARTED | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   |
| Console EQ          | `dyn-05` | NOT STARTED | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   |
| Granular Reverb     | `fx-02`  | NOT STARTED | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   |
| Granular Delay      | `fx-03`  | NOT STARTED | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | n/a | n/a | n/a | n/a | n/a | n/a | —   | —   | —   | —   | —   |
| Slipstream Sampler  | `smp-01` | NOT STARTED | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| DCO Poly            | `syn-01` | NOT STARTED | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Phase Distortion    | `syn-02` | NOT STARTED | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Analog Five         | `syn-03` | NOT STARTED | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Six-Op FM           | `syn-04` | NOT STARTED | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| Matrix Twelve       | `syn-05` | NOT STARTED | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   | —   |

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

## Per-unit notes

Nothing yet. Each unit gets a section here as it starts, carrying the named test
behind every `PASS` and every deviation from its spec sheet with the measured
reason.
