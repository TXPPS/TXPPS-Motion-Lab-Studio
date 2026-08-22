# ADR-0005 — What "green" means when four of five targets cannot be built here

**Status:** Accepted · **Date:** 2026-08-22 · **Decider:** Program Director + QA
**Related:** ADR-0001 (stack)

## Context

The phase plan gates on things this build host cannot do. Phase 1's gate is
"plays/records audio on desktop + iPhone, zero dropouts"; Phase 2's is "24-track
session on iPhone passes perf gate"; the Definition of Done requires a full
device matrix including battery and thermal soak tests.

Measured facts about the host (ADR-0001 records the full table):

- No Xcode, no macOS, no Android SDK/NDK, no Windows toolchain. Four of the five
  shipping targets cannot be compiled, let alone run.
- No ALSA/JACK/PortAudio headers. **No audio device can be opened at all**, so
  even a Linux build cannot measure round-trip latency or count xruns against
  real hardware.
- No physical device of any kind, so nothing can be soak-tested, thermally
  profiled or battery-measured.

QA holds a veto over phase advancement. A gate that can never be run is a gate
that can never pass, so without a decision here the programme stops at Phase 1
and stays there. The wrong answer is to relax the gates until they pass on what
we have; that produces a green board and an unshipped product.

## Decision

Every gate is classified, and the classification is published beside the result.
There are three classes and they are never blurred.

**PASS** — the gate ran here, on real code, and met its target. Only claimable
for platform-independent work: DSP correctness, engine logic, project format,
sync algorithms, parameter and automation behaviour, and anything measurable by
rendering offline.

**MODELLED** — the gate cannot run here, but a *proxy* was run whose result
bounds the real one, and the proxy's relationship to the real gate is stated.
Example: the iPhone dropout budget cannot be measured, but worst-case
per-block processing time for 24 tracks and 12 plugins can be measured on this
host and converted to a required per-core budget, which a phone either meets or
does not. A MODELLED result is a prediction with its assumptions attached, and
it is never reported as a pass.

**BLOCKED** — no proxy is honest. Battery drain, thermal throttling, Core Audio
behaviour, AUv3 hosting, touch latency, VoiceOver. These are listed with the
external dependency that would unblock them, and they stay red.

A phase advances when its PASS gates pass and its MODELLED gates are within
budget. It advances **carrying** its BLOCKED gates, which are re-listed in every
subsequent phase report until a host exists that can run them. The Definition of
Done is not reachable in this environment and `PROGRESS.md` says so at the top
rather than at the bottom.

## Consequences

- The DSP core is written test-first against offline rendering, which is the
  form of verification that survives having no audio device. Every processor is
  driven by a fixed input buffer and its output measured — null tests, THD+N,
  aliasing, impulse and step response, latency reporting. This is stronger
  verification than listening on a device, not weaker.
- Real-time safety is verified **statically and by instrumentation**, not by
  hoping. A processing path is compiled against an allocator that aborts, and a
  scripted check greps the reachable set for forbidden calls. That runs here.
- The performance budgets become explicit per-core time budgets rather than
  device claims, so a device test later becomes a comparison against a number
  that already exists instead of a fresh negotiation.
- Anything requiring a device, an SDK or a developer account is escalated once,
  listed as BLOCKED, and not re-litigated per phase.

## What would unblock each class

| Blocked capability | What it needs |
| --- | --- |
| macOS/iOS build, Core Audio, AUv3, notarisation | A Mac with Xcode; an Apple Developer account |
| Android build, AAudio, background audio | Android SDK + NDK; a device or emulator |
| Windows build, ASIO | A Windows toolchain; an ASIO SDK licence |
| Any audio device I/O, xrun counting, round-trip latency | ALSA/JACK/PortAudio headers on this host, plus a sound device |
| Battery, thermal, touch latency, VoiceOver/TalkBack | Physical devices |
| WASM build of the core | Emscripten on this host |
