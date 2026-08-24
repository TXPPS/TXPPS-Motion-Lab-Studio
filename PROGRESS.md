# Motion Wave — progress

```
RESUME: Directive 10 — Emscripten, plugin windows, latency, V27.
Live URL:        https://txpps-motionlab-studio.roan-crest.workers.dev
Deployed commit: 1e532e4a62
Bundle verified: YES — live index-CGx0C4q-.js matches a clean-tree build of
                 that commit, byte for byte.
Current section: §0, §2, §3.1 COMPLETE. Contrast guard and the §5 stress
                 harness COMPLETE, with the first row of measured numbers
                 recorded below.
Next action:     The WASM backlog, then Program EQ's V27, then deploy and
                 report E3.
Open deviations: F11 is left to the browser's fullscreen — the one place the
                 reference's panel map is not matched.
                 §2.5's monitoring modes and latency compensation are
                 DIVERGENT-BY-DESIGN; §3.1 reopens the take-alignment half,
                 which is a different problem and is not divergent.
                 recordingController.ts is 630 lines against the ~400 rule.
Ledger:          0 of 14 shipping. V27 (live visual) is in the Ledger and its
                 guard; no unit has it yet.
```

## Directive 10 §0 — Emscripten, and a check that could not fail

The SDK is installed and pinned at 4.0.7. The freshly built core matches the
native golden **bit-for-bit**: `WASM vs native golden: worst difference
0.000e+0`. `motionwave/wasm/dist/motionwave.mjs` is what the boundary test
loads, so that is a statement about the artefact and not about a cached one.

Three things had to be fixed first, and each reported something other than what
was wrong.

`build.sh` looked for the SDK at one hard-coded path and sourced `emsdk_env.sh`
to configure it. That script calls bare `python`, which on Windows is an App
Execution Alias that prints "Python was not found" and exits — so sourcing it
silently left `emcc` off the PATH and the build failed a line later complaining
about something else. Every value it would have set is already written into
`.emscripten` by `emsdk activate`, so they are read from there.

`check-wasm-current.mjs` had the same hard-coded path and reported **SKIPPED**,
which is the one outcome that looks like success in a log while proving nothing.

And once it ran, **it could not fail**. `build.sh` copies its output over
`prebuilt/` as its last step; the check compared the two afterwards — a file
against the copy of itself that had just been written. It matched every time, on
every input, while standing guard over exactly the failure it could not see: a
tracked core that has quietly stopped being what the source builds, deployed to
everyone, findable in no commit. Reading the tracked bytes _before_ the rebuild
is the whole fix, and with it the check failed immediately — **307467 bytes
tracked against 306640 freshly built**, first differing inside the embedded
module's global section. It is now the verified build.

`wasm:check` runs in `npm run build`. It cannot be a hard requirement, because
the production build runs on Cloudflare where there is no toolchain — but its
honest skip is the right shape for that, and CI installs the SDK and runs it for
real.

### Builds are reproducible now, which is what makes a deploy verifiable

`__BUILD_TIME__` compiled `new Date()` into every bundle, so two builds of one
commit produced different asset hashes and the deployed hash could never be
compared against anything. It takes the commit's own date now. Two things had to
change for that to work: Vite writes a `vite.config.ts.timestamp-*.mjs` beside
its config while loading it, and three generated worklet copies were **tracked**
while `.gitignore` said in its own words that a tracked copy "would be a second
version of a file that must have one". Both made the tree dirty at the moment
the config was evaluated, so the commit-date path never ran.

## Directive 10 §2 — the three device-window defects

**The window could not be dragged, on any pointer type.** `onMove` read
`return`, newline, comment, `setPos(...)` — automatic semicolon insertion ended
the statement at the newline and everything below was dead. `git log -L` puts it
at `9a020d6`, the commit that added swipe-to-dismiss: the handler had been a
concise arrow whose body _was_ that call, and turning it into a block to add one
line above kept the `return`.

Nothing caught it. TypeScript greys unreachable code rather than failing a
build, and typescript-eslint defers `no-unreachable` to the compiler on the
reasonable assumption that the compiler is being asked. **`allowUnreachableCode:
false` is now set in all four tsconfigs**, and it flagged this exact line the
moment it was turned on. The window also forgot its position on every open; it
reopens where it was left.

**A device on the master channel had no editor.** `PluginWindow` resolved its
channel with `project.tracks.find(...)`, and the master is not a member of that
array — it is `project.master`. The lookup returned `undefined` and the
component returned `null`, silently, for every device ever put there. Both the
window and the racks go through one `channelRack(project, channelId)` now.

**The options menu depended on which surface a device was opened from.** The
console's `DeviceRack` had a caret menu; the inspector's `InsertRack` — a second
component for the same job — had move and remove as inline buttons behind a
disclosure. Both offer the same menu now.

`e2e/devicewindow.spec.ts` enumerates its axes from the app rather than from
memory, and caught its own version of the same mistake twice: a hard-coded track
name the demo project does not have, and a slot index that assumes an empty rack.

## The app had no contrast guard. It does now.

`tests/contrast.test.ts`, running in `npm run build`. Motion Wave has had one
since it was written; the app has not, and the accent shipped at **4.12:1 dark
and 3.80:1 light** — both under the 4.5:1 the same product enforces one
directory over — with nothing looking.

It imports the maths and the CSS parsing from `motionwave/ui/design/` rather
than reimplementing them. A second implementation of a check is not a second
proof; it is a second thing that can be wrong. This is a test importing pure
functions — the rule that `src/` may not depend on `motionwave/` is about the
shipped product and is untouched.

**The palettes are discovered, not listed.** A block declaring `--accent` is a
palette. Listing them by selector was wrong twice: the dark palette is declared
under `:root, :root[data-theme='dark']`, a two-selector rule whose text contains
the file's own line ending — so a literal match passes on one operating system
and not the other — and a listed set silently stops covering a palette somebody
adds later. Five blocks are checked, 137 pairs.

**It found three pre-existing failures on its first run**, and one of them was
in the guard itself:

| Found                                                                                                          | Was                    | Now                                                  |
| -------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------- |
| The dark palette was not being checked at all — `:root` matched the metrics block, which declares no colours   | 0 of 27 pairs resolved | discovery by `--accent`                              |
| `--border-strong` on `--bg-panel`, dark. It is the scrollbar thumb as well as a border, so WCAG 1.4.11 applies | 2.52:1                 | **3.07:1** (`#6f6b65`)                               |
| `--lamp-ink` on `--monitor-lamp`, both light palettes — a lit lamp carrying a glyph                            | 4.26:1                 | **4.63:1** (`#4885b8`, still blue by `stateColours`) |

The self-check that caught the first one is deliberate: the failure it guards is
a rename that turns every case into the early return for an unresolved token —
all green, nothing checked.

Mutation-tested both ways. Planting the old `#67c290` fails
`--accent on --bg-active` by name; dimming `--text-dim` one shade in the light
palette fails two label pairs by name.

## Directive 10 §3.1 — takes land on the grid

Directive 09 §2.5 closed two problems as one and got half of it wrong.
Monitoring latency is irreducible — delay can only be added — and that half
stands. Take _alignment_ is a different problem with an exact answer, and it was
not being done: every take sat one round trip behind the beat, so a musician who
played correctly was told they had not.

The shift is not a move of the clip. The take's first samples are the audio from
_before_ the punch point, so the clip stays where the user punched in and starts
that far into the media. Moving the clip instead would drag the punch point
around, which is a different and worse thing to do to somebody's arrangement.

`recordLatencySec` adds `baseLatency + outputLatency` to a user offset in
preferences. Only the way out is measurable: **no browser exposes an input
latency at all**, so the way back in is the offset, and it is additive rather
than a replacement because a number the platform did give is still worth having.
Negative is allowed — an interface doing its own direct monitoring costs the
player no output latency, so the measured figure over-corrects.

`takePlacement` is pure, so where a take lands is checkable without a
microphone, a decoder or a browser. Eleven cases in `tests/recordLatency.test.ts`
including the one the feature exists for — a transient played on the beat, at a
30 ms round trip, resolving to the beat within 1e-9. Mutation-tested: removing
the shift fails five cases by name, and failing to shorten the clip by what it
skipped fails two.

**What is not verified here, and says so:** whether the number is right on a
given interface. That is a claim about hardware and it needs a cable —
`docs/HARDWARE_VERIFICATION.md` carries the loopback procedure, including the
direct-monitoring case where the offset should come out negative. The
compensation is PASS on its arithmetic and BLOCKED on its calibration; those are
different claims and the second is not implied by the first.

## Stress-test log

Directive 10 §5. `npm run stress`, against a preview build. Measured numbers per
run so drift is visible; a regression against the previous row is a P1.

| Commit       | p90 @100 / @200 tk | Ceiling          | Transport fuzz            | Stuck-note fuzz     | Sustained run       | Retained heap | Tab switch | Undo/redo | Backgrounding |
| ------------ | ------------------ | ---------------- | ------------------------- | ------------------- | ------------------- | ------------- | ---------- | --------- | ------------- |
| `1e532e4a62` | 17.7 / 18.3 ms     | >408 tk /1200 fx | 196 ops, quiet in 1425 ms | 3240 notes, 0 stuck | 28.9 ms, drift −0.1 | +5 KB         | 97.5 ms    | 60/60 ok  | ok            |

Read the first column and not the second. The ceiling is a threshold crossing,
and a threshold crossing read off a noisy signal is bimodal — three runs of the
first version reported **276, 408, 276** on one machine against one build,
flipping either side of the budget. The fixed-load p90s are the comparable
numbers and a P1 should be judged on those; the ceiling is kept because §5 asks
for it and because a _large_ move in it still means something. It now takes two
consecutive over-budget samples to count, and with that it reports the same
figure run to run.

`>408` is the honest reading: frame p90 never left one frame all the way to the
sweep's own bound of 400 added tracks, so the ceiling on this host is above
that, not at it.

Three cells report `BLOCKED` rather than a number, and that distinction is the
point — `BLOCKED` and `0` look identical in a table and mean opposite things:

| Not measured here     | Why                                                             |
| --------------------- | --------------------------------------------------------------- |
| Audio dropout ceiling | No audio device; xruns are not observable in headless Chromium. |
| Per-device tiers      | No phone or tablet silicon. A desktop ceiling is not a tier.    |
| Force-quit mid-record | Needs a real OS kill, not a dispatched event.                   |

### Two of the first run's numbers were the probe, not the product

Worth recording because both looked exactly like findings.

**"284,000 transport operations per second."** The fuzz fired unawaited promises
in a tight loop, so what it measured was how fast a `for` loop can discard them.
Awaited, one per frame — the fastest a keyboard repeat can actually produce
them — it is **33/s, worst op 1.1 ms**.

**"75 sources still running after a stop."** Read as a leak, and it is not one.
A voice already scheduled ahead has its stop clamped to its own start time
(`Math.max(at, when)`, `samplerInstrument.ts`), so a transport stop cannot
retire it earlier than the moment it was going to begin; under a loaded frame
loop the lookahead reaches further ahead and those retirements land past the
half-second the probe was sleeping for. It always reaches zero. The row now
waits for quiescence and _times_ it — **1425 ms** — and fails only if it never
arrives. The wrong diagnosis was ruled out by experiment rather than by
argument: a source stopped before its start time does fire `onended` in
Chromium, tested three ways, so nothing was being stranded.

A third number needed no correction and is the one worth watching: **retained
heap growth of +5 KB across a 15-second run at 408 tracks**, sampled after a
forced collection on both sides so it is what the app is holding rather than
what it has not got round to freeing.

## Verification status

| Gate                | Result                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` | clean                                                                                                                                          |
| `npm run lint`      | clean                                                                                                                                          |
| `npm test`          | **1964 passing**, 104 files                                                                                                                    |
| `npm run build`     | clean, and now runs the licence, ledger, params, accent, contrast, icon and WASM guards                                                        |
| `npm run test:mw`   | 311 of 312; the one failure is a pre-existing framework guard about `e2e/panel.spec.ts` importing `@playwright/test`, unrelated to any of this |
| WASM boundary       | **0.000e+0** worst difference against the native golden                                                                                        |
| Deploy              | verified — see the resume block                                                                                                                |

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

## Directive 09 §3 — panes, windows and the keyboard

`docs/reference/fsp8-parity-windows.md` enumerates **113 reference panels against
111 MotionLab panes**, with a file path for every one of ours. The near-equality
is the most misleading number in the audit and the document says so: the
reference's are weighted toward _windows_ — 13 detachable, 8 documented for a
second monitor, 17 keyboard-addressable — and MotionLab's toward inline strips
and disclosures inside four fixed panes. The gap is structural, not numerical.

### The pane matrix is automated

`e2e/panematrix.spec.ts`, in the shape of the responsive matrix: a table, not a
file of hand-written cases. Every pane, drawer and sheet is asked the same four
questions — does it open, does it close, does it close the way a keyboard user
expects, and does it remember what it was told. **32 cases**, all passing.

A table because the failure being looked for is the **odd one out**: the fifth
sheet, written after the other four, that quietly left out a focus trap; the one
layout whose divider is forgotten while the three beside it are kept. A
hand-written suite tests the panes somebody thought of, and the ones nobody
thought of are the ones that are broken.

### The panels answer the keyboard

`workspaceStore` has had `toggle`, `reveal` and `setMaximized` since it was
written, all three correct, and **no key reached any of them** — every pane could
only be opened by finding its button. The reference's F2–F10 map is matched,
because a professional user's hands already know it:

`F2` editor · `F3` mixer · `F4` inspector · `F5` browser · `F6`–`F10` the browser's
five tabs · `Shift+F` full-screen the arrangement · `Ctrl/Cmd+1–4` the four pages ·
`Home` return to start.

**`F11` is deliberately not bound.** It is the browser's own fullscreen, and
taking it would break the key a web user relies on to get back out of a
full-screen page — a worse trade than the parity is worth. `F5` _is_ claimed:
`Ctrl/Cmd+R` remains the reload, and a DAW that swallows an accidental F5 in the
middle of a take is protecting work rather than stealing a key.

### Seven defects, every one of them real

| #   | What was wrong                                                                                                                     | Why it mattered                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`uiStore.channelOverview` was a surface with no control** — declared, defaulted true, read once by the mixer, written by nothing | The inverse of the bug class `CLAUDE.md` names, and just as invisible: the console's overview strip could be neither hidden nor brought back. Moved to `workspaceStore` beside the other view options, given a toggle on the console's own header row, and it now survives a reload                                                                                                                                                           |
| 2   | **The tablet drawers were not modals**                                                                                             | A scrim and a click-outside, then `role="complementary"`, no `aria-modal`, no focus trap and **no Escape**. They cover the workspace and take the pointer, so they are modal to the person using them; a keyboard user tabbed straight through into an arrangement they could not see, and had no key that would close it. On a tablet that is a pane that will not go away — which is how it was reported                                    |
| 3   | **`DiagnosticsSheet` was the odd one out**                                                                                         | Its own comment called it modal. Scrim, no dialog role, no trap, no Escape — alone among five sibling sheets, and the odd one out is always the one written last                                                                                                                                                                                                                                                                              |
| 4   | **The tablet bottom panel forgot its divider**                                                                                     | The one layout with no `onResize`, while the three desktop panes beside it all persisted theirs                                                                                                                                                                                                                                                                                                                                               |
| 5   | **Every layout write was lost if the page went away first**                                                                        | The write is debounced 400 ms, which is right for a divider being dragged and wrong for a tab that is closing. The timer does not survive an unload. Now flushed on `pagehide` and on `visibilitychange` — `pagehide` rather than `beforeunload` because it fires on the back/forward cache path and on mobile app switches, which is exactly where a phone user was losing a layout                                                          |
| 6   | **A size dragged to its own stop was discarded on the next load**                                                                  | The layout reader _rejected_ an out-of-range number instead of clamping it, and a divider taken all the way to its maximum comes back from the panel library a hair over — 62.007 where the maximum is 62. It fell back to the default, which was then written back over the stored value, so the preference could never be made to stick at either end of its range. A number outside a range is a boundary; only a non-number is corruption |
| 7   | **The transport advertised a key nothing bound**                                                                                   | "Return to start (Home)" sat in the tooltip while the only binding was Enter. Home is now bound, and `tests/components/panelKeys.test.tsx` carries the guard for the class: a key the registry advertises must do something                                                                                                                                                                                                                   |

Defects 5 and 6 were not on the audit's list. They came out of writing the
matrix, which is the argument for the matrix.

### Two tickets the repository had already written down

`e2e/orientation.spec.ts` carries known defects as `test.fail()` tests naming a
ticket in `docs/audit/RESPONSIVE_AUDIT.md`. Playwright fails a `test.fail()`
test that _passes_, so the day a fix lands the suite says so by name. Both open
ones are now closed, and both were the user's own report written down and
measured before they made it.

**RA-016 — the Diagnostics sheet does not close on Escape.** Closed by defect 3
above. The suite reported it as `Expected to fail, but passed`.

**RA-005 — a plugin editor cannot be closed by touch.** Measured at close 17×17
and bypass lamp 10×10 against 44 pt, with the observation that on a phone the
window covers the console it was opened from and there is no Escape key. The
close button and A/B slots had since been fixed; the bypass lamp and the preset
picker had not. Measured here: `pw-power: 10x10`, `pw-preset: 95x22`.

The picker is now 44 pt — it is a `<select>` with no glyph to protect. The lamp
cannot be and must not be: a 44 pt bypass lamp is not a lamp. It keeps the
`::after` hit area the codebase already uses for `.resize-handle` and
`.dev-power`, but **the insets are now derived from 44** rather than chosen to
look generous — `.pw-power` was 32 pt and `.dev-power` 29 pt, both under the
rule they exist to satisfy.

Nobody had noticed because **the test measured the element's border box, which
an `::after` does not change** — so the codebase's own documented fix for a lamp
could never have satisfied its own cell. The test now measures the hit area, and
gained the check the box measurement was really standing in for: no expanded
area may overlap its neighbour's by more than a quarter of a target. An `::after`
that grows past its neighbour hands the press to the wrong control, which is
worse than a small target because it is silent. That is Directive 09 §9's rule
applied to a cell that already existed.

One smaller thing: the spec's header said "Six of these describe defects that
are open" long after four had been fixed and their annotations removed. The
count is gone; `grep -c 'test.fail()'` is the count and cannot go stale.

### What §3 has not closed

Named rather than left to be discovered:

- **No detach, float or second monitor for anything.** The reference detaches 13
  surfaces and has four menu commands for it. `PluginWindow` floats within the
  page and is the only thing here called a window.
- **`PluginWindow` forgets its position on every open** (`placed.current = false`
  on each device change). One device at a time is a defensible decision and its
  comment argues it; forgetting where the window was is not.
- **`editorTab` and `browserTab` do not survive a reload** while the panes
  hosting them do.
- **No Track List pane** — no per-track show/hide, no filter, no visibility
  presets. "Show me only the drums" is not currently possible.
- **No Launcher**, and **four of eight global lanes missing** (Ruler, Signature,
  Lyrics, Video). Signature is the sharpest: the model exists in `music.ts` and
  `notation.ts` and is already used by the score view, so there is data with no
  lane.
- **131 of the 204 harvested shortcuts are still unbound**, and 44 more sit on a
  different key — usually because the virtual musical keyboard claims
  `A W S E D F T G Y H U J K O L`, which is exactly where the reference put Zoom,
  Automation, Add Track, Solo and Duplicate. Convergence there needs a decision
  about which of the two is the more important muscle memory, not a patch.

## Directive 09 §4.2 — cell 27 is in the Ledger

`V27` is defined in `docs/UNIT_LEDGER.md` and enforced by
`scripts/ledger-guard.mjs`, which now reads 27 cells and 0 shipping.

**`V27` is not `U20`, and the difference is the point.** `U20` asks whether a
visualiser reads real engine state. `V27` asks whether there is something
_moving_ that a user can watch a mechanism in. Program EQ satisfies `U20` today —
its harmonic display reads the amplifier's own `curvature()` — and fails `V27`,
because nothing on its panel moves with the music. That is Directive 09 §9's new
standing rule applied to the cell being added: a cell tests what it says, not
what its title implies.

The discriminator is the one `U21` already uses: **it must stop when the audio
stops.** It is the only one of the four criteria a plausible-looking animation
cannot satisfy — `U21` was mutation-tested by fabricating its phase from
`performance.now()`, which passed every other check and failed that one.

The guard was mutation-tested here too: marking Program EQ `SHIPPING` while
`V27` reads `FAIL` fails by name.

**Not yet built:** the animations themselves. The infrastructure they need is in
place — `motionwave/core/dsp/visual_state.h` is a templated seqlock over any POD
payload, so a unit publishes its own frame shape, and `facePanel.ts` renders any
declared face. What is missing is a `graph` readout primitive: every existing
readout (`meter`, `vu`, `lamp`, `display`) draws a scalar, and a live response
curve is a series. That is the first piece of §4.3.

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
| `npm test`                                  | **1784 passing**, 101 files                        |
| `npm run build`                             | clean, on Windows                                  |
| `npx playwright test e2e/recording.spec.ts` | **15 passing**, real Chromium, fake capture device |
| `npx playwright test` (all)                 | see the Deploy note below                          |
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
