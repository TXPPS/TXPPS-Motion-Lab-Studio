# ADR-0003 — Repository layout, module boundaries and conventions

**Status:** Accepted · **Date:** 2026-08-22 · **Decider:** Program Director

## Context

The repository already ships MotionLab Studio, the web DAW that ADR-0001 makes
Motion Wave's web implementation and interaction reference. Motion Wave's C++
core has to land without disturbing a deployed application, and the boundary
between the two has to be obvious to anyone who opens the tree.

## Decision

```
/                       MotionLab Studio (the shipping web app) stays put
  src/  tests/  e2e/    unchanged
motionwave/
  core/                 the shared C++ engine — no platform, no framework, no I/O
    dsp/                processors: filters, dynamics, oscillators, granular
    graph/              node graph, scheduler, PDC, transport
    param/              the parameter and automation framework (ADR-0004)
    project/            manifest model, operation log, migration
    test/               headless test harness and golden renders
  shell/
    desktop/            Windows/macOS/Linux — device I/O, VST3/AU hosting
    ios/                Core Audio, AUv3
    android/            AAudio
    web/                AudioWorklet + WASM bridge
  tools/                measurement rigs, benchmark harnesses, codegen
docs/
  adr/                  one file per locked decision
  reference/            Reference Spec Sheets, sources cited
CLAUDE.md PROGRESS.md LEGAL_NOTES.md
```

**`core/` may not include a platform header, a GUI framework, or anything that
allocates on a processing path.** This is the load-bearing rule of the whole
layout. It is what lets the same code compile for a phone, a desktop and a
WebAssembly sandbox, and it is enforced by the build rather than by memory: the
core builds against a freestanding-ish surface and a scripted check rejects
forbidden symbols reachable from `process()`.

Dependencies point one way: `shell/* → core/`. Never the reverse. A shell adapts
a platform to the core's interfaces; the core knows no shell exists.

### Conventions

- **No file over ~400 lines.** A file that grows past it is describing more than
  one thing and gets split at the seam that is already there.
- **Naming:** `PascalCase` types, `camelCase` functions and variables,
  `SCREAMING_SNAKE` compile-time constants, `snake_case` files matching their
  primary type. No Hungarian notation, no `m_` prefixes; members are named for
  what they are.
- **Errors:** the audio path cannot throw and does not return error codes — it
  is written so that failure is impossible by construction (pre-allocated,
  pre-validated, clamped at the boundary). Everything else returns an explicit
  result type; exceptions are used only where a constructor genuinely cannot
  complete, and never across the core's public boundary.
- **Comments explain why, in full sentences, and say what would go wrong
  otherwise.** A comment that restates the code is deleted. This is the
  convention the existing codebase already holds and it carries over unchanged.
- **Every behavioural change arrives with a test that fails without it.**

### Trademark hygiene in the tree

No file name, namespace, type, symbol, preset name or comment in `motionwave/`
carries a reference manufacturer's or product's name. Reference names live only
in `docs/reference/`, which is internal. `LEGAL_NOTES.md` records why.

## Consequences

- Two products in one repository until the web target migrates onto the shared
  core. `PROGRESS.md` states which is which so nobody has to guess.
- The core is testable without any platform, which is the only reason Phase 1
  can begin on this build host at all (ADR-0005).
- A shell that needs something from the core adds it to the core's interface
  rather than reaching in, which keeps the WASM target honest — if a shell can
  reach into the core, the WASM build will be the one that discovers it.
