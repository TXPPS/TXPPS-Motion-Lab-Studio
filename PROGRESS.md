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
| 1 | Real-time engine: graph, transport, PPQ=480, PDC, I/O | **PASS** (graph, transport, PDC) · device I/O BLOCKED |
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
param:    15 case(s), 0 failure(s)
tempo:    12 case(s), 0 failure(s)
topology: 12 case(s), 0 failure(s)
graph:     8 case(s), 0 failure(s)
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
| Tempo map: seconds↔ticks inverse across changes | PASS | 12/12 |
| Tempo ramp integrated in closed form, not averaged | PASS | asserted to differ from the average by >20 ms per bar |
| Bars↔ticks inverse under mixed time signatures | PASS | 12 bars, three signatures |
| Delay compensation: every path aligned at its join | PASS | 12/12, incl. sends, diamonds and key inputs |
| Graph order deterministic | PASS | asserted stable across runs |
| Compensation aligns real samples, not just numbers | PASS | impulse through two paths of differing latency arrives as one |
| Sidechain key arrives with the signal it keys | PASS | asserted by multiplying the two ports |
| Whole graph render allocates nothing | PASS | 0 allocations over 100 blocks |
| Short blocks render identically to full ones | PASS | 16- and 64-frame renders agree |
| Cycle detection | PASS | reported, not looped |
| Bypass null test to −120 dBFS | — | no processors yet |
| THD / aliasing per plugin | — | no processors yet |
| Golden-render regression | — | no renderer yet |
| Round-trip latency, xrun counting | **BLOCKED** | no audio device on this host |
| iPhone 24 tracks + 12 plugins @ 256 | **BLOCKED** | no device; will be MODELLED as a per-core time budget |
| Battery, thermal, touch latency | **BLOCKED** | no device |
| VoiceOver / TalkBack | **BLOCKED** | no device |

**MotionLab Studio** (the shipping web app) remains green: 1500 unit tests
across 80 files, 222 e2e, typecheck, lint and build clean.

## Directive 02 — §1 and §2

### §1 P0 defects — all three closed, with regression tests

Reproduced at 360, 390 and 430 px before any code changed. **Two of the three
reports described a real symptom with the wrong cause**, which is why the
directive asks for the cause.

| Ticket | Reported | What was actually true | Fix | Test |
| --- | --- | --- | --- | --- |
| BUG-001 | Controls overlap, crowd the name, collapse below usable size | **Overlap did not reproduce** — measured, the controls did not intersect at any phone width. The other two halves did: every control was **32×30 against the 44 pt minimum**, and a five-letter track name had **37 px for 42 px of text**. One cause under both — the header column is a fixed 176 px that does not answer the viewport, and its buttons are fixed-width with `flex: none`, so the strip could neither grow nor collapse by priority. Hypotheses 3 and 4 in the ticket were wrong: control size does not follow track height, and nothing was painting over anything | Reserved strip width; column 208 px on coarse pointers; fader, pan knob and automation button shed by the stated priority into the track menu | `e2e/trackheader.spec.ts` — 7 cases, real browser geometry |
| BUG-002 | The `M` button is doing monitoring | **`M` was already mute** — correctly bound, labelled and wired to stored state. What was true is that **mute lit blue** (`--mute-lamp: #63a0dc`), which is monitoring's colour in every DAW the user has met, so a lit M read as "listening". The defect was a token, not a binding. Separately real: there was **no monitor control in the track header at all**, and no monitor colour token existed | Mute is amber in all four palettes; monitoring owns blue and has a loudspeaker control on audio tracks; implicit mute (silenced by another track's solo) is hatched and still reports `aria-pressed=false` | `tests/stateColours.test.ts` (mutation-tested — restoring the blue fails two cases by name) and 6 cases in `tests/components/trackHeader.test.tsx` |
| BUG-003 | Vocal tuner non-functional | The **detector was never the problem** — it holds one cent from 55 Hz to 1.76 kHz and always has. The device drew an oscilloscope and read no pitch at all. Signal path was also fine: monitoring connects into the channel input upstream of the inserts, so the tuner sees live input independently of the transport | Window from 8192 samples (170 ms) to 4096; detector re-run every 40 ms instead of 120; range narrowed to the vocal 55 Hz–1.6 kHz | 6 new cases in `tests/pitch.test.ts` at the tuner's real configuration |

**A measured conflict between two acceptance criteria.** BUG-003 asks for ±1
cent at 55 Hz *and* ≤50 ms to the needle. At a 43 ms window the detector is
exact from 65 Hz up and **1.44 cents out at 55 Hz**; one cent at 55 Hz needs
about four periods, which is 73 ms. That is arithmetic, not an implementation
choice. Accuracy took the window; the 40 ms update rate carries the
responsiveness, so the number on screen is never more than 40 ms behind the
voice.

### §2 Live record visualisation — implemented

**MIDI.** The recorder already held closed and held notes and never exposed
them. Notes now draw from note-on, extending as they are held — waiting for
note-off would make the longest notes appear last and a held chord draw
nothing. Drawing is incremental: closed notes are painted once, only held notes
repaint. Pinned by a test that the live lane and the committed clip agree on
where a note goes, so the take does not jump when the transport stops.

**Audio.** `MediaRecorder` never exposes PCM, so a second tap was added on the
same source. §2.1's lock-free ring needs `SharedArrayBuffer`, which this
application deliberately forgoes (no COOP/COEP), so the reduction happens in an
`AudioWorklet` — two comparisons per sample, batches posted every 43 ms from a
recycled buffer pool, steady state allocation-free. **Deviation from the letter
of §2.1, documented where the code is.**

Under back-pressure the worklet **widens its buckets rather than dropping
them**, and the receiver appends a widened bucket as many times as it stands
for — otherwise a take recorded through a stall comes out shorter on screen
than on disk. That is §2.3's "degrade resolution, never drop", arrived at from
the same reasoning.

Measured: a sixty-minute take at 48 kHz is **675 000 level-0 buckets in under
16 MB**, allocated in chunks so nothing copies a multi-megabyte buffer mid-take.

**Not done in §2**, and open: take lanes for loop/punch passes draw into one
lane rather than per-pass; input-latency compensation is not applied to the
draw head; and the on-stop reconciliation against the written file is not
asserted. The 30-minute dual-record acceptance run needs a device and is
BLOCKED here.

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
| D2-1 | P1 | Live audio waveform draws all loop/punch passes into one lane; §2.1 wants a lane per pass. |
| D2-2 | P1 | The live draw head does not apply input-latency compensation, so what is drawn sits where the take was captured rather than where it will land. |
| D2-3 | P2 | The live envelope is not reconciled against the written file on stop; §2.1 calls a mismatch a P0 and nothing currently checks it. |
| D2-4 | P2 | The peak-tap worklet's own loop is unverified — jsdom has no `AudioContext`. BLOCKED under ADR-0005. |

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
2. Buffers and the `Node` interface, so the planned graph can actually render —
   then the offline render harness and the first golden-render regression.
3. Phase 2's mixer topology on top of it: channel, bus, VCA and send routing,
   with the pan laws and the metering the brief specifies.
