# ADR-0001 — Stack and engine topology

**Status:** Accepted · **Date:** 2026-08-22 · **Decider:** Program Director
**Supersedes:** nothing · **Superseded by:** nothing

## Context

Motion Wave must run natively on Windows, macOS, iPadOS, Android and iPhone, share
one project format across all of them, and meet constraints that are unusually
specific for a cross-platform product:

- No allocations, locks, file I/O or logging on the audio thread, ever (§2.1).
- 44.1 through 192 kHz.
- Full plugin delay compensation.
- VST3/AU hosting on desktop, AUv3 on iOS.
- 24 tracks and 12 plugin instances on an iPhone at a 256-sample buffer.
- Visualisers at 60 fps, decoupled from audio via lock-free ring buffers.

Those constraints are not decoration. Two of them — the allocation rule and
plugin hosting — eliminate whole categories of stack before any scoring happens,
so the honest way to write this ADR is to say which, and why.

This repository already contains a working web DAW (MotionLab Studio: a Web
Audio engine, mixer, automation, 27 stock devices, a sampler, a synth, offline
bounce with realtime parity, WAM 2.0 third-party plugin hosting, ~1500 unit
tests and 222 end-to-end tests). It is deployed and in use. Any decision here
has to say what happens to it.

### Environment facts, measured rather than assumed

The build host for this programme is a Linux container. Verified this session:

| Available                                     | Not available                                                |
| --------------------------------------------- | ------------------------------------------------------------ |
| gcc 13.3, clang 18.1, cmake 3.28, ninja, make | Xcode, `swift`, any macOS toolchain                          |
| Rust 1.94 + cargo (host target only)          | Android SDK/NDK (`adb`, `gradle` absent)                     |
| Node 22, npm 10, Playwright Chromium          | Emscripten (`emcc` absent)                                   |
| npm registry, PyPI, crates.io reachable       | ALSA/JACK/PortAudio headers — **no audio device I/O at all** |
| 4 cores, 15 GB RAM                            | Any physical phone, tablet, Mac or Windows machine           |

This is decisive and is treated as such in ADR-0005. Four of the five shipping
targets cannot be compiled here, and none of them — including Linux — can open an
audio device. Any option whose value depends on compiling for a phone is an
option this programme cannot begin work on today.

## Options

### Option A — Shared C++ real-time core (JUCE or custom) + native platform shells

The conventional answer, and the one every shipping cross-platform DAW uses.

- **Real-time safety:** excellent. Manual memory management makes the
  no-allocation rule enforceable and, more importantly, _testable_.
- **iOS viability:** excellent. Core Audio, AUv3 hosting, background audio.
- **Animation:** excellent, via Metal/OpenGL.
- **Dev velocity here:** the DSP core compiles and tests headlessly today. The
  five shells do not compile here at all.
- **Maintenance:** heavy but standard; one core, five thin shells.
- **Skill overlap:** C++/JUCE is named as existing skill.

### Option B — TypeScript / Web Audio core everywhere, Capacitor + Electron shells

- **Real-time safety:** fails outright. JavaScript's audio callback runs under a
  garbage collector; "no allocations, ever" is not a property a JS AudioWorklet
  can offer, only approximate. Pre-allocated typed arrays get close and cannot
  get to the guarantee.
- **Sample rates:** the context rate is the platform's on iOS Safari and cannot
  be set to 88.2/176.4/192 kHz.
- **Plugin hosting:** VST3, AU and AUv3 hosting is not reachable from a
  WKWebView. This is not a performance gap; the capability does not exist.
- Rejected on the constraints, not on taste. It is scored below for the record.

### Option C — Shared C++ DSP core, compiled native _and_ to WebAssembly; per-platform UI

Option A plus one more compilation target for the same core. The web build runs
the identical DSP inside an AudioWorklet through WASM, where the audio callback
touches only pre-allocated linear memory and therefore genuinely holds the
no-allocation rule — the one way a browser can hold it.

- Everything Option A offers, plus a sixth target that this container **can**
  build and test end to end once Emscripten is available.
- The existing web DAW becomes the product's shipping web implementation and its
  interaction reference, and migrates onto the shared core rather than remaining
  a second engine forever.
- **Cost:** the core must stay free of platform assumptions — no file I/O, no
  threading primitives, no allocation in the processing path. That is a
  discipline you want regardless; here it is enforced by a build target that
  breaks when you violate it.

## Scoring

1 = poor, 5 = excellent. "Verifiable here" is not one of the six criteria the
brief lists; it is added because a gate that can never be run is a gate that can
never pass, and QA holds a veto.

| Criterion                                          | A: native only | B: web everywhere | C: shared core, native + WASM |
| -------------------------------------------------- | -------------- | ----------------- | ----------------------------- |
| Real-time safety                                   | 5              | 1                 | 5                             |
| iOS viability                                      | 5              | 1                 | 5                             |
| Animation performance                              | 5              | 3                 | 5                             |
| Dev velocity                                       | 3              | 4                 | 3                             |
| Long-term maintenance                              | 4              | 3                 | 3                             |
| Skill overlap (C++/JUCE, TS/React, Vite, Electron) | 4              | 5                 | 5                             |
| Verifiable in this environment                     | 2              | 4                 | 4                             |
| **Total**                                          | **28**         | **21**            | **30**                        |

Option B scores 1 on the first two criteria because it does not meet them at
all, and no strength elsewhere compensates for a constraint that is not met.

## Decision

**Option C.** One C++17 DSP and engine core, no platform dependencies, compiled:

- natively for Windows, macOS, Linux, iOS and Android;
- to WebAssembly for the browser, driven from an AudioWorklet.

UI is per-platform rather than one cross-platform framework: the touch-first
layout system the brief requires (reflow, not shrink, from phone to desktop) is
better served by native views on mobile and the existing React application on
web than by one toolkit compromising for all five. The design system is shared
as tokens and specification, not as a widget library.

### What happens to MotionLab Studio

It is the product's web implementation today and Motion Wave's interaction
reference. Its Web Audio engine is **not** the long-term engine: two engines
guarantee drift, and this codebase's own conventions already forbid a picture
drawn from a second opinion. The migration path is that the web target adopts
the shared core through WASM, at which point the TypeScript engine is deleted
rather than maintained in parallel. Until Emscripten is available on the build
host, both exist, and `PROGRESS.md` states which is which.

The repository becomes a monorepo: the shipping web app stays where it is, the
new core lands under `motionwave/` (ADR-0003), and neither disturbs the other.

## Consequences

- The core is written to a self-imposed freestanding discipline: no `new`,
  `malloc`, `std::vector::push_back`, mutex, `printf` or exception on any path
  reachable from `process()`. ADR-0004 gives the parameter system that makes
  this possible, and QA instruments for it.
- JUCE is **not** adopted for the core. The core is plain C++ with no framework
  dependency, so it can compile for WASM and for a headless test harness without
  dragging a GUI framework through the build. JUCE remains the candidate for the
  _desktop shell_ — plugin hosting and device I/O are exactly what it is good
  at — and that is a separate decision, deferred until a desktop toolchain
  exists to evaluate it on.
- Plugin hosting is a shell responsibility, not a core one. The core exposes a
  node interface; a shell adapts VST3/AU/AUv3 to it.
- The five shell targets are blocked in this environment. Work proceeds on the
  core, the project format, the parameter framework, the sync algorithm and the
  DSP — all of which are platform-independent and testable here. See ADR-0005.

## Rejected alternatives, and why

- **JUCE for the core as well as the shell.** Couples the DSP to a GUI framework
  and complicates the WASM target for no benefit the core needs. Reconsider if
  the desktop shell's needs turn out to reach into the core.
- **Rust for the core.** Genuinely strong on real-time safety and it is
  installed here. Rejected on skill overlap — the brief names C++/JUCE — and on
  the plugin-hosting story, where every SDK is a C++ API and the binding layer
  would be permanent overhead.
- **Keeping the TypeScript engine as the web engine permanently.** Two engines
  for one product. Every DSP fix would need writing twice and would drift the
  first time someone forgot. Rejected.
