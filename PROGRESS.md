# Motion Wave — progress

**Read this first:** the Definition of Done is **not reachable on this build
host**, and no amount of work here will change that. Four of the five shipping
targets cannot be compiled in this container and no audio device can be opened
at all. ADR-0005 defines what "green" means under that constraint and every gate
below carries its classification. Nothing here is reported as passing that has
not actually run.

---

## Phase board

| Phase | Deliverable | Status |
| --- | --- | --- |
| 0 | ADRs; skeleton builds | **PASS (host target)** · shells BLOCKED |
| 1 | Real-time engine: graph, transport, PPQ=480, PDC, I/O | in progress |
| 2 | Tracks, mixer, routing, automation | not started |
| 3 | Editing, MIDI, piano roll, comping | not started |
| 4 | Design system, plugin framework, presets, browser | not started |
| 5 | Motion Shaper | research in progress |
| 6 | Vintage Collection (5) | research in progress |
| 7 | Granular Reverb + Delay | research in progress |
| 8 | Specialty sampler (multi-portamento, MPE) | research in progress |
| 9 | Synth Collection (5) | research in progress |
| 10 | Sync service, project portability | not started |
| 11 | Export, loudness targets, stems | not started |
| 12 | Hardening: perf, battery, accessibility, docs | not started |

## Phase 0 gate — result

**ADRs written:** 0001 stack and engine topology · 0002 project file format ·
0003 repository layout and module boundaries · 0004 parameter and automation
framework · 0005 verification under a constrained host.

**Skeleton builds:** the shared core configures and compiles under CMake +
Ninja with `-Wall -Wextra -Wpedantic -Werror -Wconversion -Wold-style-cast`,
and its tests run headlessly.

```
param: 15 case(s), 0 failure(s)
```

Two of those fifteen assert that draining and advancing every parameter in a set
allocates nothing, and a third is the mutation test proving the allocation guard
catches a deliberate allocation — a guard that cannot fail proves nothing.

| Target | Skeleton builds? | Why |
| --- | --- | --- |
| Host (Linux x86-64) | **PASS** | gcc 13.3 / clang 18.1 / cmake 3.28 present |
| Windows | **BLOCKED** | no toolchain on this host |
| macOS | **BLOCKED** | no Xcode, no macOS |
| iOS / iPadOS | **BLOCKED** | no Xcode, no Apple Developer account |
| Android | **BLOCKED** | no Android SDK/NDK |
| Web (WASM) | **BLOCKED** | Emscripten not installed |

Phase 0 advances on the host target and **carries** five BLOCKED shell gates,
per ADR-0005. They are re-listed every phase until a host exists that can run
them.

## QA dashboard

| Check | Class | Result |
| --- | --- | --- |
| Core compiles, warnings-as-errors | PASS | clean |
| Parameter taper round-trip, all laws | PASS | 15/15 |
| Audio path allocates nothing | PASS | 0 allocations over 64 blocks |
| Allocation guard catches an allocation | PASS | mutation-tested |
| Bypass null test to −120 dBFS | — | no processors yet |
| THD / aliasing per plugin | — | no processors yet |
| Golden-render regression | — | no renderer yet |
| Round-trip latency, xrun counting | **BLOCKED** | no audio device on this host |
| iPhone 24 tracks + 12 plugins @ 256 | **BLOCKED** | no device; will be MODELLED as a per-core time budget |
| Battery, thermal, touch latency | **BLOCKED** | no device |
| VoiceOver / TalkBack | **BLOCKED** | no device |

**MotionLab Studio** (the shipping web app) remains green: 1500 unit tests
across 80 files, 222 e2e, typecheck, lint and build clean.

## Active bugs

| # | Severity | Description | Owner |
| --- | --- | --- | --- |
| — | — | none open against Motion Wave | |

Carried from MotionLab Studio, unrelated to Motion Wave:

| # | Severity | Description |
| --- | --- | --- |
| ML-1 | P2 | Live modulator phase re-anchors only when a chain is rebuilt, not across a seek. Bounces are bar-locked; playback is not. |
| ML-2 | P2 | `paramIdExists` returns false for `smp:*` once a track has rack items, so converting a sampler track to a rack and reloading deletes its sampler lanes. Pinned by an existing test, so changing it is its own decision. |
| ML-3 | P3 | Level-changing devices have no in/out metering; the EQ has no live spectrum behind its curve. |

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
2. Phase 1: the node graph, the transport at PPQ = 480, and plugin delay
   compensation — all platform-independent, all testable here by offline render.
3. Build the offline render harness and the first golden-render regression, so
   Phase 1's correctness has somewhere to be asserted before any DSP lands.
