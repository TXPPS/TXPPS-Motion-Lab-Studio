# Motion Wave — progress

```
RESUME: Directive 09 — FSP8 parity, core workflow, live panels.
Live URL:        https://txpps-motionlab-studio.roan-crest.workers.dev
Deployed commit: see the Deploy row below — verified against the live bundle.
Current section: §2 COMPLETE (2.1–2.5). §1 COMPLETE. §3 next.
Next action:     §3 — the pane matrix. `docs/reference/fsp8-parity-windows.md`
                 already holds the work list: 113 reference panels against 111
                 MotionLab panes, with file paths. Start with the cheapest
                 high-value item — no keyboard shortcut opens any pane, while
                 `workspaceStore`'s toggle/reveal/setMaximized API already
                 exists and is already correct.
Open deviations: §2.5's "monitoring modes per the manual" and "latency
                 compensated" are DIVERGENT-BY-DESIGN — the manual documents no
                 such mode enum, and a live monitor path has nothing to
                 compensate. Reasons recorded under §2.5 below.
                 recordingController.ts is 630 lines against the ~400 rule;
                 four things have come out of it and what is left is one thing.
Ledger:          1 of 14 shipping (Program EQ). Cell 27 not yet added.
Carried:         every deviation listed under Directive 08 below still stands.
```

## Directive 09 §1 — the manual has been read

`docs/reference/fsp8-parity-spec.md` and its seven chapter documents. 687 pages,
cover to cover, ~10,800 lines of parity analysis, every behaviour in
**FSP8 does / MotionLab does / `PARITY`|`PARTIAL`|`MISSING`|`DIVERGENT-BY-DESIGN`**
form with the manual line number it came from.

This replaces web research as the reference. It also corrects
`docs/REFERENCE-FSP8.md`, which was assembled from search-engine extracts
because the manual was not fetchable from the previous environment: six of its
claims are wrong, listed in `fsp8-parity-mixing.md` §14.1. The one that has
already reached the product is the channel strip's I/O selectors, which the
manual puts at the **top** and which MotionLab currently draws at the bottom.

The manual PDF is **not tracked** — `.gitignore`. It is a vendor document this
repository may not redistribute; the parity spec is the tracked record of it.

## Directive 09 §2.1 — transport stop does not stop. Closed.

**It was not the Stop button.** MotionLab had two transport owners with a
one-way dependency: `recording.stop()` called `engine.stop()`, and nothing
called back. So the six routes that reached `engine.stop()` directly — the Stop
button, the space bar, the Show page's play/stop toggle, Control Link's MMC
stop, loading a project, the diagnostics self-test — halted the clock and left
`MediaRecorder` capturing. The playhead froze, the take timer kept climbing, the
microphone stayed open, and the take was never committed.

Of the directive's four hypotheses, **the third was right** and the second was a
symptom of it (the tick interval was only ever cleared on the record-button
path). The first and fourth were not: the flag was read correctly wherever it
was read, and the finaliser did not race the stop — nothing told it to start.

**The fix is structural, not a call-site patch.** `src/audio/transportStop.ts` is
a dependency-free announcement channel; the engine announces, the recording
controller listens. The import cycle between them is why the callback had never
been added, so removing the cycle is the fix rather than a place to hang one
more call. Listeners run **synchronously and before the clock is parked**: the
first so no audio exists after the stop instant, the second so the finaliser can
still ask the scheduler where the transport was.

Six further defects surfaced while proving it, every one of them real:

| #   | Defect                                                                      | Why it mattered                                                                                                                                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `TakeRecorder.stop()` assigned `stopPromise` **after** calling `rec.stop()` | `onstop` is not required to be asynchronous; with nothing left to flush, Firefox and Safari fire it inside the call. The handler nulled the field and the assignment put a settled promise back, so **every later stop short-circuited and never reached `rec.stop()`**. A second independent cause of the same reported symptom, on those two engines. |
| 2   | Space bar during a count-in started playback                                | `togglePlay` read "not rolling" as "stopped". The count-in then finished, found the transport playing, skipped its own `play(rollBeat)`, and the take recorded from wherever playback had begun.                                                                                                                                                        |
| 3   | Stop during a count-in zeroed the playhead                                  | The `!playing` branch read it as the second of two presses and moved the take the user had lined up.                                                                                                                                                                                                                                                    |
| 4   | Stop during `arming` was swallowed                                          | The guard read `phase !== 'recording'`, so a stop pressed at the permission prompt did nothing and the take began a moment later — the record button appearing to ignore the user.                                                                                                                                                                      |
| 5   | `start()` could be outrun by its own stop                                   | A boolean `cancelled` flag was cleared by the _next_ `start()`, so an older start resuming after an await read itself as live and trampled the take that had replaced it. Replaced by a generation counter; the unwind releases the device and owner it captured as locals, because the fields on `this` are cleared the moment the stop lands.         |
| 6   | The count-in counted at bar 1's tempo and signature                         | `project.bpm` / `project.timeSig` rather than the tempo map at the roll point. Punch in at bar 40 of a song that slows to 90 in 3/4 there, and it counted you in at 120 in 4/4 — a count-in to a pulse the take was not going to be recorded at.                                                                                                        |

**Tests.** `tests/transportStop.test.ts` (28) and `tests/countIn.test.ts` (11),
plus three real-browser cells in `e2e/recording.spec.ts`. Every one of them was
mutation-tested: reverting the announce fails 7 unit cells and 2 e2e cells by
name; reverting the recorder ordering fails 3; reverting the generation counter
fails 1; reverting either count-in fix fails 2 each.

**Why 222 e2e tests missed it.** Every recording spec ended its take by pressing
the record button a second time — the one route that always worked. The new
cells press Stop and the space bar.

`tests/transportStop.test.ts` also carries a **static guard**, in the manner of
`schemaWired.test.ts`: every line in `engine.ts` that clears the playing flag
must announce within the preceding 26 lines, and `scheduler.stop()` may be
called from `engine.ts` and nowhere else. A seventh stop path cannot be added
silently, which is how the first six came to exist.

## Directive 09 §2.2, §2.3, §2.5 — input, routing and monitoring

### §2.2 — "microphone input does not reach the app"

**The microphone was never the problem.** `getUserMedia`, permission handling,
device enumeration, hot-unplug and the whole capture path were correct and are
covered by end-to-end tests that open a real device. What was wrong is that
**arming a track did nothing observable**. It wrote one field. No device was
opened, and `engine.inputLevel` returned 0 for any track that was not
monitoring — so the meter sat dead. An armed track with a dead meter is
indistinguishable from a broken microphone, and the only way to get either
sound or a moving meter was to find a second button in a different panel.

The engine's `Monitor` is now an `InputTap`, and the two questions it used to
conflate are separated:

```
source → analyser → gain → channel input
                    ▲
                    └── zero when open but not monitored
```

The analyser sits **ahead** of the monitor gain, so the meter reads the device
whenever the input is open, audible or not — and it is still pre-trim,
pre-insert, pre-fader and pre-pan, which is what makes it an input meter rather
than a second channel meter.

### §2.5 — monitoring follows record-arm

`src/app/monitorActions.ts` is now the single reconciler. Arming, disarming, the
monitor button and a device change all reduce to one question — should this
track's input be open, and should it be heard — answered in one place from the
stored state and the preferences. It was answered separately at four call
sites, and the fourth is always the one that forgets to write
`monitoring: false` when the device refuses, leaving a lit monitor button
monitoring nothing.

Two preferences, both on by default, both with controls:

- **Arming a track opens its input** — so the meter reads. Off restores the old
  behaviour for anyone who would rather the browser's capture indicator stayed
  dark.
- **Arming a track also monitors it** — the reference documents this as a named
  option and recommends turning it on.

The permission rule is not weakened by any of it: a prompt is raised only by an
arm the user just pressed. A project saved with an armed track reconciles with
`mayPrompt: false` and stays silent, because "never ask at startup" is the rule
`inputManager` is built around.

**Two parts of §2.5 are DIVERGENT-BY-DESIGN, and the manual is the reason.**
The directive asks for monitoring modes "per the manual" and for latency
compensation. Read cover to cover, the manual documents **no** off/auto/input/
tape enum — that vocabulary belongs to a different DAW. What it has is a
monitor button, the follows-record options, and a separate _latency_ axis of
driver-level modes (§5.5 of `fsp8-parity-recording.md`) that a browser has no
API for. Nor can a page detect an interface's own hardware direct monitoring, so
"must not double-monitor" cannot be enforced; what the app can do is make
monitoring one click to turn off and warn about feedback, which it does. And
there is nothing to _compensate_ on a live monitor path — delay can only be
added, never removed. What was genuinely missing was that the app never told
anyone what latency they were tracking at. It does now.

### §2.3 — mono and stereo input

There was no track format at all, and the capture went out with
`channelCount: { ideal: 1 }` — a **hint**, which a device is free to ignore. On
a two-input interface a "mono" vocal take could come back as a stereo file with
a dead side, which pans half-way left the moment the knob is touched, and
nothing anywhere said what had been recorded.

- `Track.inputChannels` — 1 or 2, per track, absent meaning mono.
- The constraint is now `exact`, so what was captured is known rather than
  hoped for. A device that genuinely cannot manage it throws
  `OverconstrainedError`; the fallback takes a best effort so the take still
  happens, and what the device actually granted is read back from
  `getSettings()` and **shown** when it disagrees with the choice.
- **A lease is keyed on the device _and_ the format.** Keyed on the device
  alone, a mono vocal track and a stereo keyboard track on one interface would
  share whichever stream opened first and the second would silently record in
  the other's format.
- Mono records one channel and is centred by the track's pan law.

Input trim, polarity and mono-sum already existed and are **richer than the
reference**, which has no per-track input trim at all — a browser user often has
no hardware gain control, so it is a necessity rather than a luxury. That is
recorded in the parity doc rather than "fixed".

### §2.4 — audio and MIDI setup

`src/components/settings/AudioSetup.tsx`. The device settings were scattered —
input in the track inspector, MIDI in the instrument panel, neither in
preferences — so a musician sitting down with a new interface had nowhere to go.

Default input · output device (`AudioContext.setSinkId`) · sample rate · latency
hint · a live readout of what the engine **actually** got · a latency breakdown ·
restart the engine · MIDI input.

Every row says whether it takes effect now or needs a restart, and where the
browser will not do the thing at all it says so rather than offering a control
that does nothing:

- **There is no buffer size.** Web Audio has no such control. `latencyHint` is
  what it offers instead, and it is labelled as what it is.
- **Output selection is Chromium-only.** Elsewhere the row reads "system
  default" and explains why.
- **Sample rate is a request.** The device may refuse it, and a refusal used to
  throw inside the constructor and leave the app with no engine at all. It now
  falls back and says so, and the readout reports what the context reports
  rather than echoing the choice back.

### The guard that came out of this

`tests/engineStubCovers.test.ts`. `engineStub` is a hand-written stand-in for
the engine, and a hand-written parallel of a real interface drifts — it drifted
three times in one session, each time surfacing as a React render crash inside
an unrelated test file, naming a symptom rather than a cause. The guard greps
the UI for `engine.<name>` and requires the stub to have it. On its first run it
found **four more** members that had been missing all along.

`tests/prefs.test.ts` was also tightened: `AudioSetup.tsx` is excluded from the
consumer sweep, because a preference must not be able to pass that guard by
rendering its own control and nothing else.

## Directive 09 — the Windows build was broken, and is now fixed

The directive moved this work to a local Windows clone so deploys could be
verified again. `npm run build` did not run there at all. Four separate causes,
all of them POSIX assumptions:

- `licence-guard.mjs`, `ledger-guard.mjs` and `generate-curve-golden.mjs` used
  `new URL(...).pathname`, which on Windows yields `/C:/…/APP%20Builds/…`;
  `join` then produced `C:\C:\…` with the space still percent-encoded. Now
  `fileURLToPath`.
- `sync-motionwave-assets.mjs` took a basename with `split('/').pop()`, and
  `join` had produced backslashes, so it tried to create a directory inside
  itself. Now `basename`.
- `core.autocrlf=true` checks out CRLF while `generate-params.mjs` writes LF, so
  **all fourteen generated parameter files read as stale** and the build
  refused. `.gitattributes` now pins `eol=lf` for the working tree on every
  platform. The regeneration that followed changed **zero bytes of content** —
  `git diff --numstat` over `motionwave/` is empty.
- `e2e/recording.spec.ts` passed Chromium `--use-fake-device-for-media-capture`,
  which is **not a Chromium switch**. Chromium ignores an unknown switch, so the
  auto-accepted prompt opened whatever real device the host had: on a machine
  with a microphone the specs passed while proving something other than what
  their own comment claims, and on a machine without one they failed for a
  reason that looked like a product bug. Now
  `--use-fake-device-for-media-stream`.

## Directive 09 — verification status

| Gate                                        | Result                                             |
| ------------------------------------------- | -------------------------------------------------- |
| `npm run typecheck`                         | clean                                              |
| `npm run lint`                              | clean                                              |
| `npm test`                                  | **1757 passing**, 100 files                        |
| `npm run build`                             | clean, on Windows                                  |
| `npx playwright test e2e/recording.spec.ts` | **15 passing**, real Chromium, fake capture device |
| `npx playwright test` (all)                 | **275 passing**, 0 failures                        |
| Deploy                                      | see the Deploy note below                          |

## fx-03 — the cloud, and a pool sized for one tap

The grain engine was built for this: `EngineConfig::tapCount` is documented as
"1 for the reverb, 1..8 for the delay", and the pool partitions its slots per
tap. So there is **one engine, one pool, one ceiling** for all eight taps, which
is the carried decision and the right one — eight engines would split every
guarantee the pool makes eight ways.

**The ceiling was still wrong, and V14 found it.** `fx-02`'s 256 slots are 1.56x
the 99.99th percentile of _one_ tap at an overlap of 96. This unit runs eight
taps, and §4's table asks for 32 streams each at full Smear — 256 grains in
flight against a 256-slot pool. Measured: **3527 grains dropped in four seconds
and the spawn rate 13.35 % under**. The same arithmetic with this unit's own
worst case — mean 256, sd 16, 99.99th percentile at 315, times 1.56 — gives 492,
so 512 slots. 32 KB against the reverb's 16 KB.

Two smaller things the same row surfaced. The default tier was Studio, whose
overlap cap is 32 per tap, which is exactly what §4's table asks for at full
Smear — the cap bit at precisely the setting the sheet calls normal, and a
control clipped by a quality tier is a control that lies. And the count window
was four seconds, where the first arming and last partial hop are 1.26 % of the
total; §9 counts over sixty, ten is enough to put them under half a percent.

With all three: **zero drops at every Smear, rate within 0.92 %**, and V6's level
variation across the whole sweep down to 0.52 dB against §9's 1.0 dB — which is
the row that proves `fx-02` §1.3's normalisation is applied at spawn and inside
the loop, where a texture control that retuned the delay would show up.

`SpawnParams` gained `level` and `pan`. The engine sums every tap into one
stereo pair, so a host cannot apply a tap's level and position afterwards
without unmixing what it just mixed; they belong where the grain is built and
the tap it came from is still known. Both default to unity and centre, so
`fx-02` is unchanged by their existence.

**Read this first:** the Definition of Done is **not reachable on this build
host**, and no amount of work here will change that. Four of the five shipping
targets cannot be compiled in this container and no audio device can be opened
at all. ADR-0005 defines what "green" means under that constraint and every gate
below carries its classification. Nothing here is reported as passing that has
not actually run.

---

## Phase board

| Phase | Deliverable                                           | Status                                                |
| ----- | ----------------------------------------------------- | ----------------------------------------------------- |
| 0     | ADRs; skeleton builds                                 | **PASS (host target)** · shells BLOCKED               |
| 1     | Real-time engine: graph, transport, PPQ=480, PDC, I/O | **PASS** (graph, transport, PDC) · device I/O BLOCKED |
| 2     | Tracks, mixer, routing, automation                    | not started                                           |
| 3     | Editing, MIDI, piano roll, comping                    | not started                                           |
| 4     | Design system, plugin framework, presets, browser     | not started                                           |
| 5     | Motion Shaper                                         | research in progress                                  |
| 6     | Vintage Collection (5)                                | research in progress                                  |
| 7     | Granular Reverb + Delay                               | research in progress                                  |
| 8     | Specialty sampler (multi-portamento, MPE)             | research in progress                                  |
| 9     | Synth Collection (5)                                  | research in progress                                  |
| 10    | Sync service, project portability                     | not started                                           |
| 11    | Export, loudness targets, stems                       | not started                                           |
| 12    | Hardening: perf, battery, accessibility, docs         | not started                                           |

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

| Target              | Skeleton builds? | Why                                        |
| ------------------- | ---------------- | ------------------------------------------ |
| Host (Linux x86-64) | **PASS**         | gcc 13.3 / clang 18.1 / cmake 3.28 present |
| Windows             | **BLOCKED**      | no toolchain on this host                  |
| macOS               | **BLOCKED**      | no Xcode, no macOS                         |
| iOS / iPadOS        | **BLOCKED**      | no Xcode, no Apple Developer account       |
| Android             | **BLOCKED**      | no Android SDK/NDK                         |
| Web (WASM)          | **BLOCKED**      | Emscripten not installed                   |

Phase 0 advances on the host target and **carries** five BLOCKED shell gates,
per ADR-0005. They are re-listed every phase until a host exists that can run
them.

## QA dashboard

| Check                                              | Class       | Result                                                        |
| -------------------------------------------------- | ----------- | ------------------------------------------------------------- |
| Core compiles, warnings-as-errors                  | PASS        | clean                                                         |
| Parameter taper round-trip, all laws               | PASS        | 15/15                                                         |
| Audio path allocates nothing                       | PASS        | 0 allocations over 64 blocks                                  |
| Allocation guard catches an allocation             | PASS        | mutation-tested                                               |
| Tempo map: seconds↔ticks inverse across changes    | PASS        | 12/12                                                         |
| Tempo ramp integrated in closed form, not averaged | PASS        | asserted to differ from the average by >20 ms per bar         |
| Bars↔ticks inverse under mixed time signatures     | PASS        | 12 bars, three signatures                                     |
| Delay compensation: every path aligned at its join | PASS        | 12/12, incl. sends, diamonds and key inputs                   |
| Graph order deterministic                          | PASS        | asserted stable across runs                                   |
| Compensation aligns real samples, not just numbers | PASS        | impulse through two paths of differing latency arrives as one |
| Sidechain key arrives with the signal it keys      | PASS        | asserted by multiplying the two ports                         |
| Whole graph render allocates nothing               | PASS        | 0 allocations over 100 blocks                                 |
| Short blocks render identically to full ones       | PASS        | 16- and 64-frame renders agree                                |
| Cycle detection                                    | PASS        | reported, not looped                                          |
| Bypass null test to −120 dBFS                      | —           | no processors yet                                             |
| THD / aliasing per plugin                          | —           | no processors yet                                             |
| Golden-render regression                           | —           | no renderer yet                                               |
| Round-trip latency, xrun counting                  | **BLOCKED** | no audio device on this host                                  |
| iPhone 24 tracks + 12 plugins @ 256                | **BLOCKED** | no device; will be MODELLED as a per-core time budget         |
| Battery, thermal, touch latency                    | **BLOCKED** | no device                                                     |
| VoiceOver / TalkBack                               | **BLOCKED** | no device                                                     |

**MotionLab Studio** (the shipping web app) remains green: 1500 unit tests
across 80 files, 222 e2e, typecheck, lint and build clean.

## Directive 02 — §1 to §4

### §1 P0 defects — all three closed, with regression tests

Reproduced at 360, 390 and 430 px before any code changed. **Two of the three
reports described a real symptom with the wrong cause**, which is why the
directive asks for the cause.

| Ticket  | Reported                                                     | What was actually true                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Fix                                                                                                                                                                                                        | Test                                                                                                                                               |
| ------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUG-001 | Controls overlap, crowd the name, collapse below usable size | **Overlap did not reproduce** — measured, the controls did not intersect at any phone width. The other two halves did: every control was **32×30 against the 44 pt minimum**, and a five-letter track name had **37 px for 42 px of text**. One cause under both — the header column is a fixed 176 px that does not answer the viewport, and its buttons are fixed-width with `flex: none`, so the strip could neither grow nor collapse by priority. Hypotheses 3 and 4 in the ticket were wrong: control size does not follow track height, and nothing was painting over anything | Reserved strip width; column 208 px on coarse pointers; fader, pan knob and automation button shed by the stated priority into the track menu                                                              | `e2e/trackheader.spec.ts` — 7 cases, real browser geometry                                                                                         |
| BUG-002 | The `M` button is doing monitoring                           | **`M` was already mute** — correctly bound, labelled and wired to stored state. What was true is that **mute lit blue** (`--mute-lamp: #63a0dc`), which is monitoring's colour in every DAW the user has met, so a lit M read as "listening". The defect was a token, not a binding. Separately real: there was **no monitor control in the track header at all**, and no monitor colour token existed                                                                                                                                                                                | Mute is amber in all four palettes; monitoring owns blue and has a loudspeaker control on audio tracks; implicit mute (silenced by another track's solo) is hatched and still reports `aria-pressed=false` | `tests/stateColours.test.ts` (mutation-tested — restoring the blue fails two cases by name) and 6 cases in `tests/components/trackHeader.test.tsx` |
| BUG-003 | Vocal tuner non-functional                                   | The **detector was never the problem** — it holds one cent from 55 Hz to 1.76 kHz and always has. The device drew an oscilloscope and read no pitch at all. Signal path was also fine: monitoring connects into the channel input upstream of the inserts, so the tuner sees live input independently of the transport                                                                                                                                                                                                                                                                | Window from 8192 samples (170 ms) to 4096; detector re-run every 40 ms instead of 120; range narrowed to the vocal 55 Hz–1.6 kHz                                                                           | 6 new cases in `tests/pitch.test.ts` at the tuner's real configuration                                                                             |

**A measured conflict between two acceptance criteria.** BUG-003 asks for ±1
cent at 55 Hz _and_ ≤50 ms to the needle. At a 43 ms window the detector is
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

| #   | Severity | Description                   | Owner |
| --- | -------- | ----------------------------- | ----- |
| —   | —        | none open against Motion Wave |       |

### §3 plugin and instrument audit — complete, three P1s closed

`docs/audit/PLUGIN_AUDIT.md`. Twenty-seven effect kinds and five instrument rows
against the fifteen-point matrix — **480 cells**, backed by **57 executable
probes** in `tests/audit/`, not by reading. **Thirteen findings: no P0, three
P1, ten P2.** The P1s are fixed and their probes are now the regression tests.

| ID     | Was                                                                                                                                                 | Is now                                                                                                                                                                                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PA-001 | Reverb Size sweep: 90 impulse re-renders, 27.1 M samples, **2396 ms** of synchronous main-thread work. Damping: 180 / 31.1 M / 2525 ms              | **30 / 5.1 M / 192 ms** and **26 / 4.5 M / 158 ms**. Tabulated decay curve (5× faster, worst sample difference 5.96e-8 — half a Float32 step) plus a sixth-octave re-render grid in place of a flat threshold that was ¼ of the shortest tail and <1 % of the longest |
| PA-002 | Every tempo-synced insert ran at the tempo of beat 0. A 6/16 delay at bar 9 of a 120→160 song: **0.7500 s where the bar wants 0.5625 s**, 33 % long | **0.5625 s.** All seven drivers sample the map — at the playhead live, at the beat being rendered offline. Re-driving gated at 0.5 % relative, so a 120→160 ramp costs **55 insert passes over 480 frames**, not 480                                                  |
| PA-003 | 60 notes at one instant: **60 oscillators, 1 voice cut** against a ceiling of 24. Sampler: 80 live against 48                                       | **24 live, 36 steals on 36 distinct voices**; sampler 48 of 80. Stealing loops and removes each voice as it takes it                                                                                                                                                  |

The ten P2s are open and listed in the report. The three worth naming: insert
automation runs on a 25 ms offline grid that widens to 375 ms on a half-hour
bounce while playback applies it at 60–100 Hz, and `KNOWN-LIMITATIONS.md` calls
the bounce exact (PA-006); no insert declares a latency and seven have one, so
they shift their channel against the rest of the session (PA-010); eighteen
controls rebuild a WaveShaper table on every automation frame (PA-004 — the same
shape as PA-001, one tier down in cost).

What the audit could **not** claim, and does not: the bypass null test to
−120 dBFS, latency measurement, and aliasing through the browser's own 4×
oversampling are all BLOCKED under ADR-0005 — jsdom has no Web Audio, no device
and no real-time thread. A structural proof stands in for the null test, and the
shaper curves were measured directly instead of the rendered aliasing
(−14.3 dBc at 1×, −35.5 dBc with an ideal 4×, at full drive).

Two hypotheses the audit formed and disproved before publishing are recorded in
the report's Method section, which is the part of an audit that usually goes
missing.

### §4 responsive and orientation audit — complete, four P0s closed

`docs/audit/RESPONSIVE_AUDIT.md`. 19 matrix cells × the full surface walk =
**982 surface probes**, 570 of them plugin editors — all 30 devices in the
picker inserted, opened and measured on every cell — plus split screen, both
themes, two root font sizes, two UI scales and injected safe-area insets.
**16 tickets: four P0, seven P1, five P2.** The four P0s are closed.

| ID     | Was                                                                                                                                                                                        | Is now                                                                                                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RA-001 | A rotated phone opened the arrangement on **0, 0 and 1** whole track rows against 4, 7 and 8 upright. 272 px of 360 went on chrome, leaving an 88 px scroller of which 82 px was the ruler | **2, 3 and 4.** Below 500 px of height every band shortens, the overview goes, the toolbar scrolls sideways instead of wrapping, and in landscape the bottom nav becomes a side rail — the rail alone returns a whole 54 px |
| RA-002 | The 64 px track header held **93 px** of controls; 25 of the strip's 44 px were cut, on all 14 touch cells. My own §1 regression                                                           | Row 1 is text only: 2 + 18 + 44 = **64 exactly**. The strip keeps mute, solo, monitor and arm at 188 px in a 208 px column                                                                                                  |
| RA-003 | Every plugin editor opened **96–199 px off-screen** on 9 of 19 cells, close button included                                                                                                | Placement measures the window against the viewport, centres when the offset will not fit, pins the header on screen when the window is taller than the screen, and re-places on rotation                                    |
| RA-004 | The shortcuts sheet clipped **~1400 px** with nothing to scroll, on **all 19 cells** including a 2560 px desktop                                                                           | Two components were sharing the class `.sc-sheet`; the shortcuts family is now `ks-` and the score keeps `sc-`                                                                                                              |

**The one that was a genuine conflict, not a bug.** RA-002 is two of the
directive's own requirements colliding: 44 px touch targets and a 64 px lane
row cannot both hold with two rows of controls, because 44 × 2 = 88. Row 1 gave
up its buttons rather than `LANE_H` growing — growing it buys a taller header
by showing fewer tracks, on the devices that already show the fewest.

**Two regressions I caused and caught**, by running the whole e2e suite rather
than the specs I was working on. Removing monitor from the touch strip to make
room broke BUG-002, and a phone is exactly where "am I listening to this input"
is hardest to answer from anything else — the track menu it was competing with
is already reachable by long-press. And the toolbar scrolling sideways put
three zoom controls past the right edge, which the chrome-integrity guard
called clipped. It was right to: viewport geometry alone cannot tell
"unreachable" from "reachable by swiping". The guard was made _more_ precise
rather than looser — a control is excused only when an ancestor both permits
horizontal scrolling and actually has overflow — and the affordance it was
implicitly asking for was genuinely missing, so the bar now fades at its
trailing edge.

**Seven P1s and five P2s remain open**, listed in the report. The P1s worth
naming: a plugin editor cannot be dismissed by touch at all (close 17×17,
bypass 10×10); the rack's `Insert` button answers no first press on any cell,
because selecting a strip reflows it out from under the pointer between press
and release; text scaling is not implemented rather than imperfect — 130 % and
200 % root font size produce byte-identical geometry, because the type scale is
`px × --ui-scale` and there is no `rem` in the codebase; and the product's own
140 % scale adds 73 defects.

**What held.** Horizontal overflow is clean on 18 of 19 cells and the previous
audit's ten fixes hold at sizes that audit never tested. Zero overlaps, zero
un-ellipsised truncation, all 100 sheet and drawer probes fit and dismiss.
Light and dark are **bit-identical** — 227 defects each, none unique to either.

**Five cells are BLOCKED** headless and say so: real device insets, the
home-indicator gesture, the software keyboard, rotation mid-gesture and
momentum-scroll hand-off. Each names what would settle it.

### A pre-existing test failure, not caused by this work

`e2e/automation.spec.ts:348` — the touch fader ride writes one automation point
where it wants more than one. Verified by stashing the §4 work and running it
against the previous commit, where it fails identically. Its own comment already
describes this container's audio stack suspending playback mid-test. Logged
rather than fixed, because it is not this directive's and pretending the suite
is fully green would be worse than saying so. **249 of 250 e2e pass.**

### Directive 03 §1 — the last MotionLab work, closed

**BUG-004 / BUG-005 — stuck keys and stuck notes were one bug, in the input
layer.** The directive's first diagnostic settled it before any fix: note-off
fired on a press and release over the same key and on nothing else.

| Scenario                    | note-on   | note-off | stuck      | lit        |
| --------------------------- | --------- | -------- | ---------- | ---------- |
| press/release on the key    | `[48]`    | `[48]`   | —          | —          |
| lift the finger away        | `[48]`    | `[]`     | **48**     | **48**     |
| pointer cancelled elsewhere | `[50]`    | `[]`     | **50**     | **50**     |
| ten fingers, reverse order  | 10        | 10       | —          | —          |
| window blur                 | `[48,52]` | `[]`     | **48, 52** | **48, 52** |
| tab hidden                  | `[48]`    | `[]`     | **48**     | **48**     |
| unmount while held          | `[48]`    | `[]`     | **48**     | —          |

The key dispatched note-off from its own `pointerup`, and the key is exactly the
element that never receives it — `pointerdown` releases pointer capture on
purpose so a finger can glide across the keyboard. **That also exonerates the
PA-003 voice-cap fix the directive asked to bisect**: its whole diff is the steal
block plus an accessor, and nothing downstream can matter when note-off is never
dispatched.

A second, independent instance was in the computer keyboard, and it was the
directive's candidate-2 failure rather than candidate 1: note-on took the pitch
from the octave at press time and note-off recomputed it at release time, so
pressing a key, hitting Z or X, and letting go sent note-off for a pitch nobody
was playing. Its blur handler also called `allNotesOff`, silencing notes it had
never started.

Both now go through one registry above every surface that plays notes.
**Fuzz: 4402 presses, 4025 releases, 1044 cancels, 529 octave shifts → 0 held,
0 unmatched note-ons**, seeded so a failure replays. All four instruments report
0 sustaining voices after 2,000 randomised events.

The engine half needed a measure the harness could not fake. `activeVoices` is
wrong for it — a correctly released voice stays in the allocation set until its
tail retires, and under a stub context nothing retires — and so is "panic wrote
something", for the same reason. `sustainingVoices` (voices with no scheduled
end) is the thing itself. A non-vacuity check caught the sampler answering 0 for
twelve held notes, because a non-looping sample schedules its own end at spawn;
the fuzz now uses a looping zone, the only sampler voice that can sustain.

**PA-010 — insert latency declared, compensated, and two combs fixed.** The
measurement needed fixing twice before it could be trusted: a full-scale impulse
makes a limiter _limit_, and a fixed 2048-sample offset arrives before the
parameter ramps have settled — which read as a rate-dependent bug in the device
(5 % short at 44.1 kHz, 40 % at 192 kHz) and was a rate-dependent bug in the
measurement.

| Device     | Measured                                       | Declared                              |
| ---------- | ---------------------------------------------- | ------------------------------------- |
| Limiter    | 214 / 336 / 1152 / 2112 at 0.5–10 ms lookahead | lookahead × rate + 192 ✓              |
| Saturator  | 192 samples at every rate                      | 192 ✓                                 |
| Distortion | 192 samples at every rate                      | 192 ✓                                 |
| Multiband  | 6.01 / 6.02 / 6.00 ms                          | 6 ms ✓                                |
| Amp Sim    | 192 + ~205 cabinet                             | **not declared** — see deviations     |
| Filter     | 7/8/16/32 samples                              | group delay, not latency              |
| Rotary     | 239/260/496/933                                | its Doppler line, which is the effect |

The more valuable find was internal: `WetDry` has always supported holding the
dry leg back, and the Saturator and Distortion never asked for it — so both were
a **192-sample comb at every Mix below 100 %**, a notch every 250 Hz at 48 kHz.
No channel-level compensation can fix that; both legs are inside the one insert.
A test had asserted this was deliberate on the grounds the delay was unknowable,
which was sound reasoning until the delay was measured.

**PA-006 — the bounce now applies insert automation at the rate playback does.**
The grid was 25 ms capped at 4800 suspensions, widening to 375 ms at half an
hour while playback runs at 60–100 Hz. It now starts at one frame at 60 Hz, and
the ceiling moved from 4.5 minutes of full resolution to about 33 — past which it
still widens, but says so in the diagnostics log instead of degrading silently,
which was the actual defect.

**Touch.** The device-window close button was 17×17 against a 44 pt minimum,
which left an open editor on a phone with no way out; the target grows while the
glyph stays small, and swipe-down-to-dismiss rides the drag gesture the header
already had. The phone track strip now sheds **Solo** rather than Monitor, per
the directive: on a phone the arrangement is most often used to track, and solo
has a loud global alternative in the transport clear where an unnoticed monitor
state is silent by definition.

### Directive 03 §2.1 — copyleft purge, closed

Four repositories were fetched during research and **none was ever committed**.
Two are MIT and stay cited; one is documentation with nothing executable in it;
`grame/faustlibraries` is GPL across the library including its `dx7/` emulation
and is **deleted, 29 MB, gone from disk**. `syn-04` is re-derived from its
manuals, patents and published algorithm tables. The `syn-01` quarantine still
stands and is restated rather than quietly dropped.

`scripts/licence-guard.mjs` runs as the first step of `npm run build`. It scans
source extensions only and deliberately ignores Markdown — the reference sheets
have to be able to say "this emulator is GPL-3.0, so its constants are
quarantined", and banning the words would delete the audit trail rather than the
risk. Verified both ways.

`scripts/ledger-guard.mjs` joins it, failing the build if any unit is marked
SHIPPING with a cell that is not PASS, or if a `BLOCKED` cell does not name the
missing capability. Verified both ways.

Carried from MotionLab Studio, unrelated to Motion Wave:

| #    | Severity | Description                                                                                                                                                                                                             |
| ---- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ML-1 | P2       | Live modulator phase re-anchors only when a chain is rebuilt, not across a seek. Bounces are bar-locked; playback is not.                                                                                               |
| ML-2 | P2       | `paramIdExists` returns false for `smp:*` once a track has rack items, so converting a sampler track to a rack and reloading deletes its sampler lanes. Pinned by an existing test, so changing it is its own decision. |
| ML-3 | P3       | Level-changing devices have no in/out metering; the EQ has no live spectrum behind its curve.                                                                                                                           |
| D2-1 | P1       | Live audio waveform draws all loop/punch passes into one lane; §2.1 wants a lane per pass.                                                                                                                              |
| D2-2 | P1       | The live draw head does not apply input-latency compensation, so what is drawn sits where the take was captured rather than where it will land.                                                                         |
| D2-3 | P2       | The live envelope is not reconciled against the written file on stop; §2.1 calls a mismatch a P0 and nothing currently checks it.                                                                                       |
| D2-4 | P2       | The peak-tap worklet's own loop is unverified — jsdom has no `AudioContext`. BLOCKED under ADR-0005.                                                                                                                    |

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
