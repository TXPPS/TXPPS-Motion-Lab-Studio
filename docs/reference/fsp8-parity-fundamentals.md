# Directive 09 §1 — Fundamentals & Pages Parity

**Chapters covered:** FSP8 "Fundamentals" (lines 2091–2736) and "Pages"
(lines 2737–3131), read cover to cover.
**Keyboard shortcuts are in the companion file** `parity-shortcuts.md` and are
not repeated here except where a shortcut _is_ the feature.

**IP boundary.** Reference/analysis only. The reference product's trademarked
names, unit names, template names and preset names appear here solely as
citations of its own documentation. Nothing here proposes a name for MotionLab
UI, code or filenames.

**Gap vocabulary:** `PARITY` · `PARTIAL` · `MISSING` · `DIVERGENT-BY-DESIGN`.

---

## 1. Nondestructive Editing and Undo / Redo — lines 2103–2113

### FSP8 does

- "Almost every editing and mixing action … can be undone and redone." (l. 2105)
- **"There is no limit to how far back actions can be undone and to how far
  forward actions can be redone once they have been undone."** (l. 2105–2106)
- Actions that cannot be undone are "accompanied by verification dialog boxes."
  (l. 2106–2107)
- **"Undo/redo history is cleared when you close a Session, Mastering Project,
  or Show, or when you exit."** (l. 2111)
- Separate **Undo History** browser under `Edit/History` (l. 7835–7841): "view
  and step through virtually every editing or mixing function that has occurred
  since a document was opened. Simply click on any edit in the list to instantly
  roll the document back to the point where that edit was made." History
  survives a save while the document stays open; it is cleared on close.
- Undo has its **own dedicated parallel stack for zoom** — `Undo Zoom`
  `[Alt]+[W]` / `Redo Zoom` `[Alt]+[E]` (l. 7872) — and **another** for
  visibility changes: "Visibility changes are not tracked by … normal
  Undo/Redo functionality, so a separate set of dedicated visibility undo/redo
  options are available." (l. 2734–2735)
- Undo is explicitly cited as covering the Retrospective Recording recall
  (l. 2094–2100) and step-record entry (l. 8345–8346).

### MotionLab does

`src/state/projectStore.ts` owns the only undo system in the product.

- `MAX_UNDO = 60` (line 68). **Bounded**, not unlimited: every push is
  `[...undoStack.slice(-(MAX_UNDO - 1)), project]`.
- Stacks hold previous **project objects, not serialised JSON** — the comment
  cites ~138 ms per edit saved on a 50,000-clip project.
- `update(mutator, opts?: { undoable?: boolean })` is the single mutation entry
  point; `undoable` defaults true. Any new undoable edit clears `redoStack`.
- **Gesture coalescing** — `beginGesture()` / `endGesture()` / `flushGestures()`
  with a `gestureDepth` counter, so a drag is one undo step and two simultaneous
  touch drags nest correctly. Change is detected by **reference identity**
  (`gestureSnapshot !== project`), so a gesture that ends where it started
  pushes nothing. Called from 25+ components (`PianoRoll`, `AutomationLanes`,
  `InsertRack`, `ChannelStrip`, `ClipView`, `DeviceRack`, `ScoreView`, …).
- **Undo backstop** in `src/App.tsx:88–101`: a window-level `pointerup` /
  `pointercancel` listener schedules `flushGestures()` on the next tick, so a
  gesture whose component unmounted mid-drag still commits its step.
- History is cleared on document change — `setProject()` resets `undoStack`,
  `redoStack`, `gestureSnapshot`, `gestureDepth`.
- Some actions are deliberately non-undoable and say so, e.g. `setNotes`:
  _"Free-form project notes. Not undoable: typing is a continuous gesture."_
- UI: two icon buttons in `src/components/shell/TopBar.tsx:129–147`, enabled off
  `undoStack.length > 0` / `redoStack.length > 0`, titled "Undo (Ctrl+Z)" /
  "Redo (Ctrl+Shift+Z)". `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` (plus `Ctrl+Y`) in
  `useKeyboard.ts:229–239`.
- `prefsStore.confirmDestructive` (default `true`) is the verification-dialog
  analogue.

### Gap

| Aspect                                                            | Gap                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Undo/redo exists and covers edits and mixing                      | **PARITY**                                                                                                                                                                                                                              |
| Unlimited depth                                                   | **DIVERGENT-BY-DESIGN** — capped at 60. A web app holding whole project snapshots in memory cannot be unbounded the way a native app with a disk-backed history can. Worth stating in the ADR rather than leaving as a silent constant. |
| History cleared on close                                          | **PARITY** — `setProject()` clears both stacks                                                                                                                                                                                          |
| History survives a save                                           | **PARITY** — save does not touch the stacks                                                                                                                                                                                             |
| Confirmation on non-undoable actions                              | **PARITY** — `confirmDestructive` preference + `DialogState.kind: 'confirm'`                                                                                                                                                            |
| **Undo History browser (click any past edit to roll back to it)** | **MISSING** — no list, no labels. `undoStack` holds `ProjectData[]` with no action names, so building this needs a label alongside each snapshot.                                                                                       |
| **Separate Zoom undo/redo stack**                                 | **MISSING** — no zoom history at all                                                                                                                                                                                                    |
| **Separate Visibility undo/redo stack**                           | **MISSING** — panel visibility changes are untracked in both directions                                                                                                                                                                 |
| Gesture coalescing                                                | **MotionLab-only strength.** The manual never describes it; MotionLab's is explicit and depth-counted.                                                                                                                                  |

**The highest-value item here is the Undo History browser.** It is the one undo
feature a user can _see_, and MotionLab has the data — it needs a label per
snapshot and a list.

---

## 2. Retrospective Recording — lines 2051–2100

### FSP8 does

> "Retrospective Recording captures every note you play on your MIDI keyboard or
> controller… even without hitting Record. Even when the transport is stopped!
> It works invisibly in the background on a track-by-track basis. Controller
> activity is captured as well." (l. 2053–2055)

Mechanics, precisely as documented:

- **Enabled by default.** Disabled at
  `Options/Advanced/MIDI/Enable retrospective recording`. (l. 2061–2064)
- **One independent buffer per Track.** Captures when the track is
  **record-armed or monitored** — notes, controller changes and parameter
  changes. (l. 2068–2069)
- **Two capture modes that never mix:**
  - _Transport playing (not recording)_: events stored with the correct Session
    location, and **Input Quantize is applied** if active. (l. 2071–2072)
  - _Transport stopped_: events stored **with times relative to each other**.
    (l. 2073)
  - "As soon as an event is received in one mode, the other mode will always
    delete the contents of the buffer." (l. 2074–2075)
- **Recall placement** follows the capture mode: play-captured events land at
  their true Session position; stop-captured events land with the **first event
  at the playback cursor**. (l. 2079–2081)
- Recalled events honour the standard recording options — Replace, Takes to
  Layers, Record Takes, Record Mix. (l. 2082–2083)
- **Three ways to recall** (l. 2085–2089): the key command `[Shift]+[NumPad*]`;
  right-click the Track control area → "Recall Retrospective Recording"; the
  Retrospective Recording button in the Inspector.
- **The recall is undoable**, and the undo puts the events _back in the buffer_
  so you can change the record mode and recall again (l. 2094–2100). Critically:
  _"if the buffer receives any new event after 'undo' the buffer is deleted."_

### MotionLab does

**Nothing.** Grep for `retrospective`, `captureBuffer`, `midiBuffer`,
`recallBuffer`, `ringBuffer` across `src/` returns **zero matches**.

`src/audio/midiRecorder.ts` is the opposite design and says so:
_"This captures live notes while the transport records, and commits them as a
clip when it stops."_ Its `captured: Note[]` is cleared on start and on commit;
`isRecording` is `trackId !== null`. Nothing accumulates when the transport is
not recording.

The one genuinely adjacent thing is take **recovery**, which is a different
problem (a take that was recorded and then lost):
`src/app/recoveryActions.ts`, `src/components/recording/RecoveryPanel.tsx`,
`inputStore.pendingRecoveries`, and the diagnostics field "Unrecovered takes".

### Gap

**MISSING — entirely.**

Notes toward building it, since this is one of the deep-dive items:

- MotionLab already has the right funnel point. `midiRecorder` hangs off
  `engine.liveNoteOn` / `liveNoteOff`, which is where hardware MIDI, the
  on-screen keyboard and the computer keyboard all converge. A retrospective
  ring buffer belongs on that same hook, so it captures all three input paths
  for free.
- The two-mode rule (playing vs. stopped, never merged) is the part that is easy
  to get wrong and is the whole reason the feature is trustworthy. It should be
  a test, not a comment.
- The undo semantics are unusual and load-bearing: undo returns events **to the
  buffer**, and a subsequent new event destroys the buffer. That is a genuine
  state machine, not a stack push.
- MotionLab's per-track arm state (`Track.armed`) and monitor state already
  exist, which is the gate the reference uses.

---

## 3. High-Precision Mix Engine — lines 2115–2128

### FSP8 does

- A "floating point, mixed-mode engine" that **switches between 32-bit single
  and 64-bit double precision on the fly**, depending on what the inserted
  plug-ins support. (l. 2118–2124)
- User setting: `Options/Audio Setup → Process Precision → Double (64-bit)`;
  otherwise everything is single precision. (l. 2127–2128)
- MIDI is converted on arrival to a **high-resolution 32-bit internal format** —
  "no zipper noise on instruments, smoother controller changes and pitch bends,
  more detailed automation" — and translated back to standard MIDI on the way
  out. (l. 2185–2190)

### MotionLab does

- `Float32Array` throughout: **201 occurrences across 19 files** in `src/audio/`.
  **No 64-bit audio path, and no `precision` setting.** Three double-precision
  arrays exist and none of them carries signal: `effectChain.ts` uses one for
  the Motion Wave frame boundary and `encode/flac.ts` two for the Rice parameter
  search. This bullet used to claim the type appeared nowhere at all, which was
  not true and would have sent anyone re-running the grep to the opposite
  conclusion. The verdict below is unchanged; it now rests on what is measurable.
- Summing is whatever the browser's Web Audio graph does, which is 32-bit float
  and not user-selectable.
- Export bit-depth reduction has real dither: `src/audio/encode/dither.ts`.
- MIDI: `Note.velocity` is a number, and automation is stored as float points,
  so the "high-resolution internal format" claim is met incidentally by
  JavaScript numbers rather than by a designed conversion layer.

### Gap

**DIVERGENT-BY-DESIGN.**

A Web Audio graph is 32-bit float and the app does not get to choose. There is
no 64-bit path to expose and no setting to add. This is not a gap to close on
the web platform; it is a constraint to record.

**It does, however, bear on Motion Wave.** ADR-0001 makes the C++ core the
long-term engine, and the core _can_ offer a precision choice. If that ever
becomes a product decision, it belongs in an ADR before it becomes a
`ParamSpec`, not after.

---

## 4. Documents — lines 2130–2160

### FSP8 does

Three document types, one per page (l. 2133–2144):

| Type               | Purpose                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sessions           | "music and audio creation and production… Recording, editing, arranging, and mixing" — and explicitly non-musical work: podcasts, dialogue editing |
| Shows              | live performance and rehearsal — Backing Tracks, Instrument Players, Setlists, Performance View                                                    |
| Mastering Projects | "mastering and releasing a collection of Sessions" — track sequencing, advanced metering, online publishing, CD burning                            |

- All three are created from one **New Document** window, from scratch or from a
  Smart Template. (l. 2146–2151)
- **The three types are interactive**: a Session can be pushed into a Show or a
  Mastering Project via `Session/Add to Show` and
  `Session/Add to Mastering Project`; a Session changed after being loaded into
  a Mastering Project is re-pulled with `Update Mastering File...`.
  (l. 2153–2156)
- **Multiple documents open simultaneously** (l. 3081–3087).

### MotionLab does

MotionLab has the same three destinations, but as **three views of one
document**, not three document types.

- `PageId = 'start' | 'song' | 'mastering' | 'show'` (`src/app/router.ts`).
- `ShowPage` writes into `project.show: ShowSetup`; `MasteringPage` writes into
  `project.mastering: MasteringProject`. **Both are fields on the single
  `ProjectData`**, so a setlist and a running order save with the song.
- **Exactly one project is open at a time.** `projectStore` holds one `project`;
  `setProject()` replaces it and wipes undo.
- The Session→Mastering hand-off exists and is _stronger_ than a file import:
  `MasteringPage.addCurrentSong()` renders the live project offline
  (`renderProject` over `projectEndBeat`), measures it to BS.1770-4
  (`measureChannels`), encodes to WAV, stores the blob in IndexedDB
  (`putMediaBlob`) and registers a `MediaRef`. `ShowPage.addFromCurrentSong()`
  pushes a `SetlistEntry` carrying `{ name, projectId, startBeat, bpm, timeSig,
color }`.
- No "Update Mastering File" — a re-render is a fresh `addCurrentSong()`.
- `StartPage` offers `Continue "{name}"`, a **Recent** list (`listProjects()`
  with Open / Duplicate / Delete), and a **template grid**.

### Gap

| Aspect                                                                               | Gap                                                                                                                              |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Three work modes (produce / master / perform)                                        | **PARITY**                                                                                                                       |
| Session → Mastering hand-off                                                         | **PARITY**, arguably stronger (offline render + loudness measurement in one action)                                              |
| Session → Show hand-off                                                              | **PARITY**                                                                                                                       |
| **"Update Mastering File" — re-pull a changed Session into an existing master item** | **MISSING**. `MasterItem` already stores `mediaId`; re-rendering into the same id is a small action with a real workflow payoff. |
| **Multiple documents open at once**                                                  | **MISSING** — single-document by architecture (`projectStore` holds one project)                                                 |
| One New Document dialog for all three types                                          | **PARTIAL** — templates create Songs only; there is no "new Show" or "new Master"                                                |

The multiple-documents gap is what makes Quick Switch (§18) unimplementable
today. It is the root, not a leaf.

---

## 5. Automatic Delay Compensation — lines 2162–2168

### FSP8 does

- Automatic across the whole audio path, no settings to manage: "The sync and
  timing of every Audio Channel … are automatically maintained, no matter what
  processing is being used." (l. 2166–2168, l. 13527–13531)
- **The current total plug-in delay time is displayed in the left-side
  Transport, below the current sample rate.** (l. 13533)
- Manual per-track delay in ms, positive or negative, in the Inspector, for
  aligning distant ambient mics. (l. 13540–13551)

### MotionLab does

Real, measured, per-channel PDC — and it is one of the stronger parts of the
codebase.

- `src/audio/engine.ts`: every channel carries `pdc: DelayNode`, created with
  `ctx.createDelay(MAX_PDC_SEC)`. Routing is `inserts.exit → pdc → muteGain` —
  **after the inserts, before the fader** (engine lines 951–955).
- Alignment (engine lines 524–556): `deepest = max(latencySamples)` across
  channels, then per channel `behind = min(cap, deepest - latencySamples)` and
  `safeSet(ch.pdc.delayTime, behind / sampleRate)`. Recomputed whenever an
  insert is added, removed or bypassed.
- **Latency is measured, not declared.** `src/audio/latencyProbe.ts` renders an
  impulse through the insert and through a dry wire in an `OfflineAudioContext`
  and takes the peak offset (`IMPULSE_SEC = 0.25`, `RENDER_SEC = 0.75`). Its
  header records that this became P0 under PA-010 / Directive 03 because seven
  inserts were delaying their channel silently.
- Documented deliberate exclusions in `effectChain.ts`: the amp sim is left out
  (up to ~397 samples at 96 kHz — "a declaration of 397 would be compensating
  the model"); the bitcrusher's lag is compensated exactly; mid/side devices do
  not declare.
- WAM plugins declare latency to the host (`src/audio/motionwave/node.ts:199`).

### Gap

| Aspect                                                         | Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic PDC, no user settings                                | **PARITY** (stronger — measured rather than declared)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Total PDC displayed in the transport under the sample rate** | **PARITY.** `AudioStatusChip` shows it beside the sample rate, in milliseconds, and only when it is not zero — a permanent "0 ms" is a light that is always on. `AudioEngine.applyPdc` publishes the figure from the call that sets the delay lines, so the readout and the delay cannot disagree. The sample count is in the tooltip and on `data-pdc-samples`. `e2e/pdcreadout.spec.ts`. Until this landed, `pdcSamples()` was a documented test probe with no caller anywhere in the repository. |
| **Manual per-track delay in ms (±)**                           | **MISSING** — no `Track.delayMs` field                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Input / record latency compensation                            | **MISSING** — no `inputLatency` / `outputLatency` / `baseLatency` reading anywhere; the context is created with `{ latencyHint: 'interactive' }` and that is all                                                                                                                                                                                                                                                                                                                                    |

---

## 6. Audio Dropout Protection — lines 2170–2183

### FSP8 does

- Frames the trade-off explicitly: high buffers give headroom but add monitoring
  latency; low buffers risk dropouts. (l. 2172–2175)
- Hardware DSP interfaces solve input monitoring but "are not able to help keep
  virtual instruments free of disruptive latency, as those instruments must run
  within the DAW's native audio engine." (l. 2177–2179)
- Dropout Protection is a **user-selectable balance** between processing power
  and latency: lower for live tracking, higher for many virtual instruments.
  (l. 2613–2616)
- **Plug-in Nap** — "temporarily pausing the processing of plug-ins that don't
  pass audio at the current playback point." Status visible per plug-in in the
  Performance Monitor (a crescent icon in the CPU display); individual plug-ins
  can be excepted via tickboxes; also settable per plug-in from the Plug-in
  Editor menu, the Rack Slot Menu, or the Browser context menu. (l. 2618–2629)

### MotionLab does

- No buffer-size control, no dropout-protection setting, no plug-in nap. Grep
  for `dropout`, `xrun`, `glitch`, `underrun` finds only prose comments.
- The nearest analogue is **track freeze** (`src/audio/freeze.ts`,
  `releaseStaleFreezes()` called on every project update) — a manual, permanent
  version of what Plug-in Nap does automatically.
- The web platform does not expose a buffer size to set. `latencyHint:
'interactive'` is the whole of the control surface.

### Gap

**DIVERGENT-BY-DESIGN for the buffer/dropout setting** — the platform has no
knob to expose.

**MISSING for Plug-in Nap**, and this one is _not_ platform-blocked. The engine
knows which channels have no clips under the playhead, and bypassing their
insert chains during those stretches is implementable in Web Audio. It is a real
CPU win on a laptop and it is the kind of thing that shows up in the frame-load
meter immediately.

---

## 7. MIDI and beyond MIDI — lines 2185–2191

### FSP8 does

Converts inbound MIDI to a 32-bit internal representation for smoother
controllers, pitch bend and automation, and translates back to standard MIDI for
external gear. (l. 2187–2191)

### MotionLab does

- Web MIDI in `src/audio/midi.ts`; `transportStore` mirrors `midiSupported`,
  `midiEnabled`, `midiInputs`, `midiSelectedId`, `midiActivity`,
  `midiLastEvent`.
- MIDI **file** import and export in the TopBar overflow (`pickMidiFile`,
  `exportMidiFile`).
- Automation points are floats; velocity is a number. There is no explicit
  resolution-upgrade layer because there is no fixed-point layer to upgrade
  from.
- **No MIDI output to external gear** — inputs only.

### Gap

| Aspect                                  | Gap                                                                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| High-resolution internal representation | **PARITY by construction** — JS numbers, no 7-bit quantisation to escape                                                                     |
| MIDI input from hardware                | **PARITY**                                                                                                                                   |
| **MIDI output to external gear**        | **MISSING**                                                                                                                                  |
| MIDI file import/export                 | **PARITY** (the reference does not claim this in this chapter, but has it)                                                                   |
| MIDI Monitor view (l. 2600–2604)        | **MISSING** — `midiLastEvent` is a single string in `transportStore` and appears only in the diagnostics report, not as a filterable monitor |

---

## 8. Drag-and-Drop — lines 2193–2201

### FSP8 does

- Effects dragged from the Browser onto a Track to insert them; then dragged
  Track-to-Track to copy the effect **with its settings**. (l. 2195–2197)
- Virtual instrument dragged into blank arrange space **creates a new Instrument
  Track**; dropped onto an existing Instrument Track it **replaces** the
  instrument. (l. 2197–2198)
- **`[Esc]` cancels an in-progress drag.** (l. 2199)
- Framed as the point of the design: "allow you to work very quickly, without
  having to stop for menu navigation." (l. 2200–2201)

### MotionLab does

Four independent drag-and-drop systems plus one global guard:

1. **Global swallow** — `src/App.tsx:103–117`. Window-level `dragover`/`drop`:
   if the event carries files and nothing has already called `preventDefault()`,
   set `dropEffect = 'none'` and prevent it, so a stray file drop cannot
   navigate the browser away from unsaved work.
2. **Audio file → track lane** — `Arrangement.tsx:1152–1173`. Accepts only when
   `track.type === 'audio'` and the drag carries files; computes the drop beat
   from `(clientX - rect.left) / pxPerBeat`; calls `importDrop(dataTransfer,
{ trackId, startBeat })`.
3. **Device / insert between racks** — `DeviceRack.tsx`, custom MIME
   `DEVICE_MIME`, `effectAllowed: 'copyMove'`, drop targets on both the row and
   the rack container. **This is the reference's "drag the effect with its
   settings to another Track."**
4. **Media / sample drag** — MIME `text/x-ml-media`, from `SamplesTab.tsx` into
   `SamplerPanel.tsx` per-zone or panel-wide.
5. **Instrument / effect from the browser** — `InstrumentsTab.tsx`, configurable
   `dragType` / `dragValue`.

### Gap

| Aspect                                                             | Gap                                                                                                                                                                                       |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effect from browser onto a track                                   | **PARITY**                                                                                                                                                                                |
| Effect dragged track→track carrying its settings                   | **PARITY**                                                                                                                                                                                |
| Audio file onto a lane at a position                               | **PARITY**                                                                                                                                                                                |
| Sample onto a sampler zone                                         | **PARITY**                                                                                                                                                                                |
| **Instrument dropped in blank space creates a new track**          | **MISSING**                                                                                                                                                                               |
| **Instrument dropped on an existing instrument track replaces it** | **MISSING**                                                                                                                                                                               |
| **`Esc` cancels an in-flight drag**                                | **MISSING** — MotionLab's `Esc` is an escalating handler (`useKeyboard.ts:381`) but has no drag-cancel branch. Worth adding as the _first_ rung of that ladder, above "cancel recording". |
| **Drag to reorder tracks / setlist entries / release items**       | **MISSING** — `ShowPage` and `MasteringPage` both use ↑/↓ icon-button pairs                                                                                                               |
| Modifier-held drag variants (copy vs. move, replace, constrain)    | **MISSING** — see `parity-shortcuts.md` §2.11, ~15 of them                                                                                                                                |

---

## 9. Transport Controls — lines 2203–2222 _(deep dive)_

### FSP8 does

The manual lists exactly seven controls, left to right (l. 2207–2221):

| #   | Control                          | Manual text                                                   | Key                              |
| --- | -------------------------------- | ------------------------------------------------------------- | -------------------------------- |
| 1   | **Go To Previous / Next Marker** | "shuttle to the previous or next marker on the Marker Track"  | `Shift+B` / `Shift+N` (l. 13596) |
| 2   | **Rewind and Fast Forward**      | "move the cursor back or forward in time"                     | —                                |
| 3   | **Return to Zero (RTZ)**         | "Return the playback cursor to the beginning of the timeline" | `,`                              |
| 4   | **Stop**                         |                                                               | Spacebar, or NumPad `0`          |
| 5   | **Play**                         | "Start playback at the current cursor location"               | Spacebar (also stops)            |
| 6   | **Record**                       | "Begin recording at the current cursor location"              | NumPad `*`                       |
| 7   | **Loop**                         | "enable/disable Loop mode"                                    | `/`                              |

Transport Controls are present on the **Session, Mastering Project and Show
pages** (l. 2205).

Additional transport-adjacent facts stated elsewhere in the manual:

- The **Transport Bar** at the bottom of the Session page also carries the Track
  List, Inspector, MIDI Monitor, Record Panel, Transport Controls and Metronome
  Controls (l. 2995–3003), plus four panel-toggle buttons on its far right —
  Editor (pencil, `F2`), Channel Overview (fader), Console (`F3`) and Browser
  (folder, `F5`) (l. 3016–3031).
- The **left-side Transport** shows the current **sample rate**, and **below it
  the current total plug-in delay time** (l. 13533).
- A **[Performance] button in the Transport** opens the Performance Monitor
  (l. 903).
- **Auto Punch** is a transport button, `[I]` (l. 3552).
- **Metronome** is a button, `[C]`; Precount is `Shift+C`, Preroll is `[O]`
  (l. 3523, 3596).
- Ableton Link, when synchronised, draws **"a blue circle spinning around the
  On/Off button within the Transport Controls"** (l. 2016–2017).
- The Show page transport is reduced to **three buttons: Stop, Play, and
  Loop/Continue** (l. 15376).

### MotionLab does

`src/components/transport/TransportBar.tsx` (551 lines, `data-testid="transport"`),
with a `compact` variant for phones.

**Buttons, left to right:**

| Control         | testid            | In compact? | Behaviour                                                                                   |
| --------------- | ----------------- | ----------- | ------------------------------------------------------------------------------------------- |
| Return to start | `btn-rts`         | yes         | `engine.returnToStart()`; title "Return to start (Home)"                                    |
| Back one bar    | `btn-rewind`      | no          | `nudgeBars(-1)`, honouring the signature map; **right-click → previous marker**             |
| Forward one bar | `btn-forward`     | no          | `nudgeBars(1)`; **right-click → next marker**                                               |
| Play            | `btn-play`        | yes         | `engine.play()`; `aria-pressed={playing}`                                                   |
| Stop            | `btn-stop`        | yes         | `engine.stop()`; title "press twice to return to start"                                     |
| Record          | in `RecordButton` | yes         | `components/recording/RecordControls`                                                       |
| Loop            | `btn-loop`        | no          | toggles `loop.enabled`                                                                      |
| **Punch**       | `btn-punch`       | no          | toggles `project.punch`, defaulting its range to the loop bounds                            |
| **Metronome**   | `btn-metronome`   | no          | toggles; **right-click cycles count-in** `(countIn+1)%5`; renders a count-in badge when > 0 |

**Fields displayed:**

| Field                           | Detail                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Position (bars·beats·ticks)** | `pos-cell` / `pos-display`. Written **straight into the DOM from `engine.onFrame()`** via refs, never React state — the comment records that a re-rendering transport would re-render the whole bar and everything selecting from the same store 60×/s. **Click to type a position**: becomes an input, `Enter` commits through `parseBBT`, `Escape` cancels. |
| **Elapsed clock time**          | `clock-display`, non-compact only, `formatClock`                                                                                                                                                                                                                                                                                                              |
| Primary-display highlight       | whichever of the two matches `prefs.primaryTimeDisplay` (`'bbt'` \| `'clock'`) gets the `primary` class                                                                                                                                                                                                                                                       |
| **BPM**                         | `number` input, min 20 / max 999 / step 0.1                                                                                                                                                                                                                                                                                                                   |
| **TAP**                         | `btn-tap`, non-compact. Keeps up to 8 taps; a gap > 2000 ms restarts the count; needs ≥ 2 taps and mean span > 100 ms; sets BPM to 0.1 resolution                                                                                                                                                                                                             |
| **Time signature**              | `select`, non-compact: 2/4 3/4 4/4 5/4 6/4 7/4 5/8 6/8 7/8 9/8 12/8                                                                                                                                                                                                                                                                                           |
| **Performance meter**           | non-compact only — see §14                                                                                                                                                                                                                                                                                                                                    |
| **Master volume + meter**       | non-compact: output icon, `range` 0–1.5 step 0.01 (`master-volume`), and `<Meter meterId="master" />`                                                                                                                                                                                                                                                         |
| **Audio status chip**           | `audio-chip`, `data-audio-state`. Labels: `Audio Running · N.Nk` / `Start Audio` / `Starting…` / `Audio Suspended — tap` / `Interrupted — tap` / `Audio Error — retry`. Click → `engine.start()`. Compact collapses to a lamp when running.                                                                                                                   |
| **Overflow**                    | `transport-more`, rendered in both variants                                                                                                                                                                                                                                                                                                                   |

**Modes reachable from the transport overflow menu (10 items):**
enable/disable metronome · enable/disable loop · enable/disable punch ·
`Count-in: off | N bars` (cycles 0–4) · `Pre-roll: off | N bars` (cycles 0–4) ·
`Click level` (cycles `[0, 0.25, 0.5, 0.7, 1, 1.4]`) ·
`Click: while recording only` / `whenever it is on` ·
`Set the punch range from the loop` (disabled unless `loop.end > loop.start`) ·
`Return to start` · `Panic — stop all audio` (danger).

The count-in/pre-roll split carries its own reasoning in the code: _"A count-in
is a click; a pre-roll is the song. Both are wanted, and for different reasons."_
So does the click level's placement: it is saved in the song, not in
Preferences, _"because it is a different number for a loud drummer than for a
quiet vocal — which is a property of the session, not of the person."_

### Gap

| Control / field                                         | Gap                                                                                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Play · Stop · Record · Loop                             | **PARITY**                                                                                                                                                                     |
| Return to Zero                                          | **PARITY** (button); binding differs — see below                                                                                                                               |
| Rewind / Fast Forward                                   | **PARITY**, and MotionLab's is quantised to whole bars through the signature map rather than free-running                                                                      |
| **Previous / Next Marker as first-class buttons**       | **PARTIAL** — the function exists but only as a **right-click on rewind/forward**, which nothing in the UI advertises. This is the clearest "hidden feature" in the transport. |
| Punch in/out button                                     | **PARITY** (the reference's Auto Punch)                                                                                                                                        |
| Metronome button                                        | **PARITY**                                                                                                                                                                     |
| Count-in / pre-roll                                     | **PARITY**, and MotionLab separates them where the reference has Precount and Preroll as two keys                                                                              |
| Click level, click-while-recording-only                 | **MotionLab-only**                                                                                                                                                             |
| Tap tempo                                               | **MotionLab-only** (not in the reference's transport list)                                                                                                                     |
| Master volume + meter in the transport                  | **MotionLab-only**                                                                                                                                                             |
| Position readout, click-to-type                         | **PARITY**                                                                                                                                                                     |
| Clock / BBT dual display                                | **PARITY** — and the reference's floating Time Display (§12) also offers Samples and Frames, which MotionLab lacks                                                             |
| **Sample rate displayed**                               | **PARTIAL** — shown inside the audio chip's label (`· 44.1k`), not as a labelled field                                                                                         |
| **Total plug-in delay displayed under the sample rate** | **MISSING** — see §5; the number exists                                                                                                                                        |
| **Performance button opening a Performance Monitor**    | **PARTIAL** — MotionLab shows a permanent inline frame-load meter instead of a button opening a window                                                                         |
| **Ableton Link status ring on the transport**           | **MISSING** — no Link, no external sync of any kind                                                                                                                            |
| Transport present on all three pages                    | **PARTIAL** — `SongPage` has the full bar; `ShowPage` has a bespoke stage transport (return-to-start, big play/stop, metronome); `MasteringPage` has **no transport at all**   |

### Two concrete findings

1. **`btn-rts`'s tooltip is wrong.** `TransportBar.tsx:352` reads
   `title="Return to start (Home)"`. The handler binds `Enter`
   (`useKeyboard.ts:370`); there is no `Home` branch anywhere in
   `useKeyboard.ts`. Per CLAUDE.md, a control that advertises a key that does
   nothing is the same class of bug as a wrong number. Fix by binding `Home` (it
   is free) rather than by editing the string — `Home` is the better key.

2. **Marker navigation is undiscoverable.** `prevMarker`/`nextMarker` from
   `model/arrangement` are reachable only by right-clicking the rewind/forward
   buttons. The reference gives them **their own two buttons at the head of the
   transport**. Either promote them to buttons or bind `Shift+B`/`Shift+N`.

---

## 10. Key Commands — lines 2223–2290

Covered in full in **`parity-shortcuts.md`**, Part 1 (system) and Part 2 (the
204-row table).

Headline: the notation model and the rebinding editor are at parity — MotionLab
even has an orphaned-default guard the manual does not describe. The four
system-level gaps are **import**, **export**, **export-as-text**, and
**migration key maps from other DAWs**, plus the `Ctrl+K` **Find Command**
palette and the three `Ctrl+Alt+C/T/S` type-ahead locate dialogs.

---

## 11. Help and Information — lines 2292–2314

### FSP8 does

- **`F1`** opens the reference manual from anywhere; **from an open built-in
  plug-in, `F1` opens the relevant section of the manual**. (l. 2294–2298)
- **Info View** — a panel opened by the question-mark icon in the top toolbar on
  the Session, Mastering and Show pages. It "displays all possible actions for
  the selected mouse tool, as well as showing the possible modifiers and their
  related actions", and updates on hover over controls in the app and in the
  included plug-ins. `F1` from Info View jumps to the manual section.
  (l. 2300–2306)
- **Tooltips** on "many controls, tools, and windows". (l. 2308–2310)

### MotionLab does

- **Tooltips are pervasive** — nearly every control carries both `title=` and
  `aria-label=` (TopBar, TransportBar, MaximizeButton, BottomEditor tabs,
  StatusBar, MasteringPage targets, StartPage template cards).
- `MenuItem.shortcut` renders a right-aligned keyboard hint inside context
  menus, driven by the same registry.
- `BottomEditor` uses `e.unavailable ?? e.hint` as the title on **dimmed**
  (never hidden) tabs — a good instance of the Info View idea applied narrowly:
  the tab tells you why it does not apply.
- **`WelcomeSheet`** (`src/components/common/WelcomeSheet.tsx`) — 5 steps ("Hear
  it now", "Arrange", "Play instruments", "Record & import", "Your work stays
  here"). Auto-opens once (`txpps-motionlab-welcome-v1`), suppressed under
  `navigator.webdriver` or a `qa` hash. Reopenable from the TopBar overflow.
- **`ShortcutsSheet`** — the shortcut reference, `?` or overflow menu.
- **No manual, no docs viewer, no `F1`, no Info View.**

### Gap

| Aspect                                                                           | Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tooltips                                                                         | **PARITY**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Shortcut hints in menus                                                          | **PARITY**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| First-run guided tour                                                            | **PARITY** (the reference's Getting Started Tutorial, l. 2447–2450)                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **`F1` → documentation**                                                         | **MISSING** — there is no documentation to open                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **`F1` from an open plug-in → that plug-in's section**                           | **MISSING**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Info View: a live panel showing the current tool's actions and its modifiers** | **MISSING.** This is the most interesting missing item in the chapter. MotionLab has nine arrangement tools on `1`–`9`, each with modifier behaviours, and the only place any of that is written down is the shortcut sheet — which is modal and does not know which tool is selected. A non-modal strip that says what the _current_ tool does, and what Shift/Alt do to it right now, is a real usability gain and the registry already carries `description` and `when` for every entry. |

---

## 12. Smart Templates — lines 2316–2470

### FSP8 does

Templates that "optimize … configuration for a specific task" and bundle Track
Presets, File Import, optional Customization, **and step-by-step Tutorials**
(l. 2323–2327). Grouped under three headings — Record and Mix, Master and
Release, Rehearse and Perform (l. 2329–2330). The documented set:

Play Now (Drums / Guitar / Piano / Synth) · Record Now (Full Band / Guitar and
Vocal / Single Track) · Mix in Surround (Dolby Atmos with bed format, monitoring
format and sample rate; Surround with output format and sample rate) · Produce
Beats · Jam Now (Guitar / Bass / Piano / Vocals / None, plus downloadable
backing tracks with preview, download and uninstall) · Create Content · Import
Files (drag to a dropzone; audio, MIDI, AAF, Cubase Track Archives) · Audio
Interfaces (per-device I/O templates) · Demos · Tutorials.

Also documented (l. 2452–2470):

- **User templates** — `File > Save as Template`; they appear in the **User**
  tab of the New Document dialog (l. 2807–2808).
- **Customization** — templates enable/disable features to create an optimised
  workspace ("a user working strictly in audio recording would not require loops
  or patterns"), and a checkbox controls whether that applies.
- **Smart Templates download and install additional required content.**
- Tutorials start automatically, dim the screen to focus attention, navigate
  with buttons or arrow keys, `[ESC]` to exit.

### MotionLab does

`src/model/templates.ts` — `TEMPLATES`, six entries, pure data (they never touch
the store or the engine):

| id           | name           | bpm | summary                           |
| ------------ | -------------- | --- | --------------------------------- |
| `empty`      | Empty session  | 120 | 1 track                           |
| `songwriter` | Songwriter     | 96  | 4 tracks · vocal chain · plate    |
| `band`       | Band recording | 128 | 11 tracks · drum bus · folder     |
| `electronic` | Electronic     | 124 | 6 tracks · rack · sidechain-ready |
| `podcast`    | Podcast        | 120 | 3 tracks · speech chain           |
| `beat`       | Beat sketch    | 90  | 4 tracks · 8-bar loop             |

`Template = { id, name, blurb, summary, icon, color, bpm, timeSig, tracks }`;
`TemplateTrack = { name, type, color?, preset?, output?, armed?, inserts?,
sendTo?, folder? }`. `projectFromTemplate()` sets bpm/timeSig, enables an
**8-bar loop by default**, and resolves routing / sends / folder parenting **by
name** through an `idByName` map. Rendered as a card grid on `StartPage`
(`data-testid={'template-'+id}`).

### Gap

| Aspect                                                              | Gap                                                                                                                                                                        |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task-shaped starting points with tracks, inserts, sends and routing | **PARITY** — MotionLab's six map closely onto Record Now / Produce Beats / Create Content                                                                                  |
| Template sets tempo and time signature                              | **PARITY**                                                                                                                                                                 |
| Template pre-loads effects and sends                                | **PARITY**                                                                                                                                                                 |
| **User templates (`Save as Template`, a User tab)**                 | **MISSING**. `projectFromTemplate` is data-driven, so the inverse — derive a `Template` from the current project — is a genuinely small piece of work with a large payoff. |
| **Tutorials attached to templates**                                 | **MISSING** — one global welcome tour, not per-template                                                                                                                    |
| **Customization (a template enabling/disabling app features)**      | **MISSING** — no feature-gating concept                                                                                                                                    |
| Content download on template selection                              | **N/A** — no content store                                                                                                                                                 |
| Surround / Atmos templates                                          | **N/A** — stereo product                                                                                                                                                   |
| Per-audio-interface I/O templates                                   | **N/A** — browser I/O                                                                                                                                                      |
| Demos                                                               | **PARTIAL** — `createDemoProject()` is the _boot_ project and reseedable via `#/demo`, but is not offered as a browsable demo list                                         |
| Import Files as a starting point (drag to a dropzone)               | **PARTIAL** — drag-import onto an audio lane exists; there is no "start from these files" entry                                                                            |

---

## 13. Session Information and Track Notes — lines 2472–2500

### FSP8 does

One **Session Information** window with three tabs (l. 2481–2490):

- **Info** — meta information: artist name, album name, songwriter credits, year
  of release, and more. Clicking any field opens the Session Setup window to
  edit it. `Ctrl/Cmd+.` opens Meta Information directly.
- **Session Notes** — "a good spot to draft promotional copy, make notes about
  the collaboration process, or provide more information about the song's origin
  or original inspiration(s)."
- **Track Notes** — "a great space for collaborators to detail track revisions,
  give directions, or leave feedback."

Track notes are reached by right-clicking a track in the Mix Console → **Edit
Note**, or the notepad icon in the Inspector channel (l. 2494–2496). And
critically (l. 2498–2500): **Track and Channel Notes can be turned on as a
display option** via the wrench ("Options") icon in either the Arrangement or
the Mix Console — _"each Track or Channel will have its own notepad where you
can enter text."_

### MotionLab does

- **Project notes** — `ProjectData.notes?: string`, documented _"Free-form
  musician notes: lyrics, session to-dos, mix decisions."_ Action
  `setNotes(notes)`, **explicitly non-undoable** ("typing is a continuous
  gesture"). UI: `Inspector.tsx:547–558`, a "Notes" section with a 6-row
  `textarea` (`data-testid="project-notes"`), placeholder _"Lyrics, session
  to-dos, mix decisions… saved with the project."_
- **Per-track notes** — the field exists: `Track.notes?: string`, _"free-form
  per-track note shown in the inspector."_
- **Author metadata** — `ProjectData.artist?` and `genre?`, _"author metadata
  written into exports."_ Surfaced **only** in `ExportSheet.tsx` (seeded at line
  38, inputs at 361 and 385). There is **no `setArtist` / `setGenre` action on
  the project store** — the values can only be set at export time.
- **Setlist notes** — `SetlistEntry.note?`, edited via a prompt dialog on
  `ShowPage`, shown in the stage panel.
- **Mastering metadata** — `MasteringProject.title?` and `artist?` exist in the
  type and are **not surfaced in `MasteringPage.tsx` at all**.

### Gap

| Aspect                                                                      | Gap                                                                                                                                                                                                        |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project/session notes field, saved with the document                        | **PARITY**                                                                                                                                                                                                 |
| Per-track notes                                                             | **PARTIAL** — `Track.notes` exists in the type; no editing UI found                                                                                                                                        |
| Notes visible as an inline per-track/per-channel notepad (a display option) | **MISSING**                                                                                                                                                                                                |
| **Metadata (artist, genre) editable outside the export dialog**             | **MISSING** — and this is a real bug-shaped gap: `ProjectData.artist` is a persisted field with no setter and no editor. A user who types an artist name into the export sheet is not editing the project. |
| Album / songwriter / year / credits fields                                  | **MISSING**                                                                                                                                                                                                |
| `MasteringProject.title` / `artist` surfaced                                | **MISSING** — declared, unreachable                                                                                                                                                                        |
| One "Session Information" window gathering all of it                        | **MISSING** — notes live in the Inspector, metadata in the export sheet, setlist notes on the Show page, and mastering metadata nowhere                                                                    |

---

## 14. Flexible Parameter Control — lines 2502–2518

### FSP8 does

Four documented ways to move any parameter (l. 2506–2518):

1. **Scrollwheel** — hover and scroll to adjust variable controls smoothly, and
   to scroll through option lists (quantize value, I/O assignments).
2. **Click and drag** — including on numerical _displays_ (Transpose, Start/End
   times), dragging up or down.
3. **Double-click and type** — `Enter` commits.
4. **Right-click and type** — opens the Automation/Channel Macro window, where
   the value field can be double-clicked and typed into.

Plus, scattered: `Ctrl/Cmd+Shift+drag` to fine-tune (l. 18972) and
`Ctrl/Cmd+click` to reset a value to its default (l. 17652, 19923).

### MotionLab does

- `src/hooks/usePointerDrag.ts` exists and is the drag-a-control primitive.
- Position readout is double-click-to-type with `Enter`/`Escape`
  (`TransportBar.tsx:104–125`); BPM and master volume are native inputs.
- Right-click menus exist per object, built by each component's own
  `onContextMenu` — the design note in `useKeyboard.ts:130–142` explains why:
  one item list per object rather than a global menu registry that would rot.
- **`shortcuts.ts` documents none of the pointer conventions** — no scrollwheel
  entry, no fine-drag entry, no reset-to-default entry.

### Gap

| Aspect                                               | Gap                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Double-click and type, `Enter` commits               | **PARITY** (at least on the transport; needs a sweep of the plugin faces)                                                                                                                                                |
| Click and drag a control                             | **PARITY**                                                                                                                                                                                                               |
| Right-click a control for its menu                   | **PARITY**                                                                                                                                                                                                               |
| **Scrollwheel over a control**                       | **MISSING** — confirmed. `onWheel` / `'wheel'` appears in exactly two component files (`Arrangement.tsx`, `Mixer.tsx`) and in neither case adjusts a parameter. No fader, knob or numeric display responds to the wheel. |
| **`Ctrl/Cmd+Shift+drag` to fine-tune**               | **MISSING**                                                                                                                                                                                                              |
| **`Ctrl/Cmd+click` to reset a value to its default** | **MISSING.** This is the single most-missed convention in any plugin UI, and MotionLab has 27 effects with real faces. Every `ParamSpec` already carries a default.                                                      |
| A typed-value field in the automation/macro panel    | **PARTIAL** — macros exist (`MacroPanel.tsx`, `MAX_MACROS`), value typing not confirmed                                                                                                                                  |

**Recommendation:** these are _conventions_, and conventions that are not written
down are not conventions. Whatever the answer turns out to be, the pointer
grammar (wheel, fine-drag, reset-click, snap-bypass) belongs in
`shortcuts.ts` as `click`/`drag` pseudo-combos — the registry already has the
category for them and `findShortcutConflicts()` already excludes them.

---

## 15. Control Link — lines 2520–2528

### FSP8 does

"A clear and easy MIDI mapping protocol" for controlling the DAW and external
gear from hardware MIDI controllers, with minimal configuration.

### MotionLab does

- `ProjectData.controlLinks` with a `MAX_CONTROL_LINKS` cap, and
  `ProjectData.macros` with `MAX_MACROS` — so a mapping layer exists in the data
  model and `MacroPanel.tsx` edits macros.
- MIDI **input** is wired (`src/audio/midi.ts`, `transportStore` mirrors).
- No MIDI-learn assign flow of the kind the reference's `Alt+M` "Assign" implies
  (see `parity-shortcuts.md` §2.9).

### Gap

**PARTIAL** — the data model is there; the mapping/learn UX is the missing half.
Not a Fundamentals-chapter blocker; it has its own chapter in the manual and
belongs to whoever draws that directive.

---

## 16. Hardware Integration — lines 2530–2548

### FSP8 does

Integrated control for the vendor's own console mixers, interfaces, fader
controllers and pad controllers; connect the unit, install the companion control
software, and the hardware's control features appear inside the DAW.

### MotionLab does

Nothing, and cannot: a browser has Web MIDI and no vendor driver channel.

### Gap

**DIVERGENT-BY-DESIGN.** Out of scope for a web DAW. Generic MIDI control
surfaces (a fader bank speaking MIDI CC) are reachable through Control Link
(§15); vendor-specific integration is not.

---

## 17. View Options — lines 2550–2735 _(deep dive)_

### FSP8 does

The chapter's framing (l. 2554–2558): _"core design philosophy is about helping
you create while remaining unobtrusive. As such, we've made its View settings
highly configurable, so that you aren't distracted by elements you choose not to
use, and only see them when you want to."_

The View menu has **six sections**:

**1–2. Pages, Editor, Console** etc. — the basic views, each with its own key
(`F2`–`F11`, §3 of the shortcut file).

**3. Browser** — Instruments, Effects, Loops and more (`F5`–`F10`).

**4. Use-case views** (l. 2570–2646) — every one of these is a **floating,
resizable window**:

| View                      | What it shows                                                                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Record Panel**          | Replace/Overdub, Record takes to Layers, Input Quantize and more                                                                                                                                                                 |
| **Time Display**          | current playback position in **Seconds, Bars, Samples, or Frames**, configured from the small Time Display left of the Transport Bar                                                                                             |
| **Remaining Record Time** | recording time available, from track count, sample rate and free disk                                                                                                                                                            |
| **Chord Display**         | three modes — **Chord Track** (current chord + next chord in blue), **Input Chord** (what is being played on an external keyboard), **Editor** (mirrors the Note Editor inspector; with multiple tracks visible, all contribute) |
| **MIDI Monitor**          | filterable view of all MIDI in and out                                                                                                                                                                                           |
| **Performance Monitor**   | see §18                                                                                                                                                                                                                          |
| **Plug-in Manager**       | search, sort, remove, block, show/hide plug-ins; versions; blocklist reset; a Statistics tab covering frequency of use and each plug-in's effect on load times, save times and average preset size                               |
| **Note Repeat**           | see §20                                                                                                                                                                                                                          |
| **Video Player**          | see §21                                                                                                                                                                                                                          |

**5. Additional Views** (l. 2660–2671): Info View · Audio Bend · Strip Silence ·
Quantize · **Macros** (displayable in the Arrangement Window, Note Editor _or_
Audio Editor) · Chord Selector.

**6. Windows** (l. 2673–2688):

- **Toggle Floating Windows** — all plug-in windows at once
- **Toggle Optional Views** — Browser, Console, Edit windows at once
- **Toggle Detached Console** — "Useful if you use multiple monitors"
- **Toggle Detached Editor**
- **Fullscreen** `[Shift+F]`
- **Reset Window Positions** — "Useful for when complex projects get a little
  too busy, or when a document was saved on a different computer with a larger
  monitor setup and windows are positioned outside of the visible range."

**7. Zoom** (l. 2690–2701): Zoom In/Out horizontally · Zoom In/Out vertically ·
Zoom to Loop · Zoom to Selection · Zoom to Selection Horizontally · Zoom Full ·
**Undo/Redo Zoom** · **Toggle Zoom** · **Store Zoom State** · **Restore Zoom
State**.

**8. Visibility** (l. 2734–2735): **Undo Visibility Change / Redo Visibility
Change** — a dedicated undo stack, because "visibility changes are not tracked
by … normal Undo/Redo functionality."

### MotionLab does

Panel visibility is split across two stores, and the split matters.

**Persisted — `src/state/workspaceStore.ts`** (localStorage
`txpps-motionlab-workspace-v1`, debounced 400 ms):

| Field                                          | Default        | Toggled from                                                            |
| ---------------------------------------------- | -------------- | ----------------------------------------------------------------------- |
| `showBrowser`                                  | `true`         | TopBar icon + overflow                                                  |
| `showInspector`                                | `true`         | TopBar icon + overflow                                                  |
| `showEditor`                                   | `true`         | TopBar icon + overflow, and the chevron in `BottomEditor`               |
| `showMarkers`                                  | `true`         | `GlobalTracks.tsx:502` ("Markers")                                      |
| `showSections`                                 | `true`         | `GlobalTracks.tsx` ("Arranger")                                         |
| `showChords`                                   | `false`        | `GlobalTracks.tsx` ("Chords"); also force-enabled from `ChordAssistant` |
| `showTempoLane`                                | `false`        | `GlobalTracks.tsx` ("Tempo")                                            |
| `showOverview`                                 | `true`         | `Arrangement.tsx:979`                                                   |
| `browserSize` / `inspectorSize` / `editorSize` | 16 / 17 / 38 % | panel drag, `onResize`                                                  |
| `maximized`                                    | `null`         | `MaximizeButton`, per pane                                              |

Plus `reset()` → "Reset layout" in the TopBar overflow, which restores
`DEFAULT_LAYOUT` and writes a diagnostics line.

Two details worth keeping: `normalizeLayout()` clamps every size on read
(browser/inspector 10–40 %, editor 12–70 %) and rejects an unknown `maximized`;
and `SCROLL_KEEPERS` + `captureScroll()`/`restoreScroll()` preserve scroll
positions across a maximize by retrying for up to **15 rAF frames**, because
maximizing remounts conditionally-rendered panes.

`reveal(pane)` deserves a mention as a design-note: it clears another pane's
maximize _and_ switches the pane on, and the docstring records why — a command
that handled only one of the two hiding mechanisms "silently did nothing in the
other case."

**Not persisted — `src/state/uiStore.ts`:** `editorTab`, `browserTab`,
`phoneMode`, `channelOverview`, `diagnosticsOpen`, `shortcutsOpen`,
`welcomeOpen`, `settingsOpen`, `exportOpen`, `debugOverlay`, `forcedLayout`,
`openDevice`.

**Zoom lives in `uiStore` and is not persisted:** `pxPerBeat` (26), `laneScale`
(1), `prPxPerBeat` (32). Driven from `Arrangement.tsx` (`zoomTo`,
`nextPxPerBeat`, `laneScaleFromDrag`, wheel) and the zoom tool on `9`.

**Tablet-only local state**, lost on unmount and never persisted: `combo`
(`mixer` | `piano` | `synth`) and `drawer` (`browser` | `inspector`) in
`TabletLayout.tsx`.

### Gap

| View-menu item                                                                  | MotionLab                                                                                                           | Gap                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Show/hide Browser, Editor, Inspector                                            | TopBar icons + overflow, persisted                                                                                  | **PARITY**                                                                                                                                                                                                                             |
| Show/hide Markers / Arranger sections / Chords / Tempo lane                     | `GlobalTracks` options, persisted                                                                                   | **PARITY**                                                                                                                                                                                                                             |
| Arrangement overview strip                                                      | `showOverview`                                                                                                      | **PARITY**                                                                                                                                                                                                                             |
| **Reset Window Positions**                                                      | "Reset layout" (`workspaceStore.reset()`)                                                                           | **PARITY**, and MotionLab's clamping means a stored layout can never put a pane out of reach in the first place                                                                                                                        |
| Maximize a pane                                                                 | `maximized`, 4 panes, with scroll preservation                                                                      | **PARITY** (the reference has no direct equivalent — this is arguably better)                                                                                                                                                          |
| **Fullscreen `[Shift+F]`**                                                      | **No `requestFullscreen` anywhere in `src/`**. "Full screen" in MotionLab means pane maximize.                      | **MISSING**                                                                                                                                                                                                                            |
| **Detached Console / Detached Editor (second monitor)**                         | —                                                                                                                   | **MISSING** — plausible via `window.open` + a shared store, but a real piece of work                                                                                                                                                   |
| **Toggle Floating Windows (all plug-in windows at once)**                       | `openDevice` allows **exactly one** plugin window at a time, by design                                              | **DIVERGENT-BY-DESIGN** — nothing to toggle en masse                                                                                                                                                                                   |
| **Toggle Optional Views (browser + console + editor at once)**                  | Three separate toggles                                                                                              | **MISSING** — a one-key "get out of my way" is a different affordance from three toggles, and matches the chapter's stated philosophy                                                                                                  |
| **Zoom: Undo / Redo Zoom**                                                      | —                                                                                                                   | **MISSING**                                                                                                                                                                                                                            |
| **Zoom: Store / Restore / Toggle Zoom State**                                   | —                                                                                                                   | **MISSING**                                                                                                                                                                                                                            |
| **Zoom: to Loop / to Selection / Full**                                         | —                                                                                                                   | **MISSING** — only free zoom and the zoom tool                                                                                                                                                                                         |
| **Zoom persisted at all**                                                       | `pxPerBeat` etc. live in the non-persisted `uiStore`                                                                | **MISSING** — reopening a project resets the zoom                                                                                                                                                                                      |
| **Visibility undo/redo (dedicated stack)**                                      | —                                                                                                                   | **MISSING**                                                                                                                                                                                                                            |
| **Time Display as a floating window, in Seconds / Bars / Samples / Frames**     | Two inline cells (BBT + clock), `primaryTimeDisplay` picks the emphasis                                             | **PARTIAL** — no Samples, no Frames, not floating                                                                                                                                                                                      |
| **Remaining Record Time**                                                       | —                                                                                                                   | **MISSING**. Not a joke feature on the web: `navigator.storage.estimate()` is already read for the diagnostics "Storage used (MB of quota + %)", so remaining record time is computable from quota, sample rate and armed track count. |
| **Chord Display (Chord Track / Input Chord / Editor)**                          | `ChordAssistant.tsx` and a chords lane exist                                                                        | **PARTIAL** — no floating display, no input-chord recognition, no next-chord lookahead                                                                                                                                                 |
| **MIDI Monitor**                                                                | `midiLastEvent` (one string) in diagnostics only                                                                    | **MISSING**                                                                                                                                                                                                                            |
| **Record Panel**                                                                | Record modes live in `inputStore` (`RecordPhase`) and the transport overflow                                        | **PARTIAL** — no dedicated panel, no input quantize, no takes-to-layers                                                                                                                                                                |
| **Plug-in Manager (+ Statistics tab)**                                          | —                                                                                                                   | **MISSING** — plausible for MotionLab's WAM plugins; the blocklist idea in particular has a web analogue for a plugin that fails to load                                                                                               |
| **Info View**                                                                   | —                                                                                                                   | **MISSING** — see §11                                                                                                                                                                                                                  |
| **Audio Bend / Strip Silence / Quantize / Chord Selector menus in the toolbar** | `WarpTool.tsx` exists                                                                                               | **PARTIAL**                                                                                                                                                                                                                            |
| **Macros displayable in the Arrangement, Note Editor _or_ Audio Editor**        | `MacroPanel.tsx`, one location                                                                                      | **PARTIAL**                                                                                                                                                                                                                            |
| `channelOverview`                                                               | **declared in `uiStore`, read once in `Mixer.tsx:43`, and has no toggle UI anywhere** — grep returns exactly 3 hits | **BUG-shaped.** A visibility flag no one can flip. Per CLAUDE.md this is the "control that does nothing" class inverted: a control that isn't there for a thing that is. Either give it a toggle or delete the flag.                   |

**The two structural observations for this section:**

1. **Zoom is the biggest single hole.** The reference has eleven zoom commands,
   a zoom history with its own undo/redo, and a store/recall slot. MotionLab has
   free zoom and a zoom tool, with the state in a non-persisted store. Zoom
   to Loop, Zoom to Selection, Zoom Full and Store/Toggle Zoom are four commands
   that would each pay for themselves daily.

2. **Visibility undo.** The reference found this necessary enough to build a
   _second_ undo stack for it. MotionLab's panel state is persisted, which makes
   an accidental "Reset layout" unrecoverable — there is no confirm on it and no
   undo behind it. Cheapest fix: route `reset()` through
   `confirmDestructive`.

---

## 18. Performance Monitor — lines 2606–2646, 899–911, 13507–13517 _(deep dive)_

### FSP8 does

Opened from the View menu **or a `[Performance]` button in the Transport**
(l. 903). What it reports:

| Reported                                                                                                            | Source line      |
| ------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **Current total CPU usage**                                                                                         | 2608, 903, 13509 |
| **Current total disk usage**                                                                                        | 2608, 13509      |
| **Per-Insert-effect usage**                                                                                         | 2608, 13509      |
| **Per-Instrument usage**                                                                                            | 2608, 13509      |
| **Automation performance**                                                                                          | 903              |
| **Plug-in Nap status per plug-in** — a crescent icon in the CPU display                                             | 2621–2622        |
| **Cache section** — how much audio data is in the Audio Cache, with "show its contents" and "clean up unused items" | 13516–13517      |

What you can _do_ from it:

- **Double-click a name to open that Insert's or Instrument's editor.** (13511)
- **Tick the checkbox next to a name to deactivate it**, freeing its RAM and
  CPU; tick again (or use the Console's Activate button) to reactivate.
  (13511–13513)
- **Tick and drag up or down the list** to activate/deactivate many plug-ins
  quickly. (13515)
- **Except selected plug-ins from Plug-in Nap** via tickboxes on the right —
  "this option disables Plug-in Nap's influence on the plug-in and does not
  disable the plug-in itself." (2624–2625)
- Choose the **Dropout Protection** balance. (2613–2616)

The manual is also explicit about _why_ you read it (l. 2608–2609): "useful for
determining which demanding Instrument Tracks may be worth rendering to Audio
Events" — i.e. it is the input to the freeze decision. And (l. 906–908) when the
meters approach the top, lower the buffer while recording and raise it while
mixing.

### MotionLab does

There is **no CPU meter, no DSP-load meter, no disk meter, no per-plug-in usage,
and no dropout/xrun counter.** Greps for `cpu`, `dropout`, `xrun`, `glitch`,
`underrun`, `perfMonitor` return only prose comments.

The one load display is `PerformanceMeter` in `TransportBar.tsx:158–193`:

- Reads `engine.onFrame((dt) => …)`.
- `load = Math.min(1.5, dt / 0.0167)` — 16.7 ms is one frame's budget.
- Exponentially smoothed: `smoothed += (load - smoothed) * 0.08`.
- Writes the DOM **every tenth frame** (not every frame).
- Bar level: `'hot'` > 95 %, `'warm'` > 70 %, else `'ok'`.
- Renders `{pct}%` plus `activeSources` (`data-testid="perf-sources"`).
- Tooltip: `UI frame load · N active audio sources`.
- **Desktop/tablet only** — the compact phone bar has no perf meter.

Its doc comment is the honest framing and is worth quoting in full:

> "Web Audio renders on its own thread, so this is not 'DSP load' — it is the
> honest thing a browser can measure, which is whether the UI is keeping up.
> Audio dropouts show up here as long frames long before they are audible."

The **Diagnostics sheet** (`src/diagnostics/report.ts`,
`src/state/diagnostics.ts`, `DiagnosticsPanel.tsx`) is where the rest of the
system truth lives, and it reports a great deal the reference's monitor does
not: app version, git commit, build time, user agent, platform, viewport, online
state, PWA display mode, service-worker status, AudioContext state, **sample
rate**, **active audio sources**, transport state, MIDI support and device,
project name/tempo/track count/clip count, IndexedDB status; feature probes (Web
Audio, structuredClone, OfflineAudioContext, getUserMedia, MediaRecorder, Web
MIDI, IndexedDB, Storage estimate, Pointer events); and the recording/media
group — mic permission, input devices, recorder support, recording state, last
record error, last take, open input streams, monitoring, armed audio tracks,
project media refs, stored media, **storage used (MB of quota and %, warning
above 90 %)**, unrecovered takes, decoded buffers, missing media, **insert
effects**, **active sends**, **audio graph**, export status, last export.

Panel actions: **Copy Report** (with an `execCommand` fallback), **Download**
(`motionlab-diagnostics-{ts}.txt`), **Run Smoke Test**, **Clear Log**, **Panic
Audio**. Re-renders on a 1 s interval; storage figures every 10 s; shows the
last 80 log entries reversed. `installConsoleCapture()` patches
`console.warn`/`console.error`, catches `window.error` and
`unhandledrejection`, truncates to 500/300 chars, and deliberately downgrades
`ResizeObserver loop…` to `warn` so the error count "cannot cry wolf."

### Gap

| Reported item                                                    | Gap                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An always-visible load indicator in the transport                | **PARITY**, arguably better — the reference's is a window you open, MotionLab's is always on screen                                                                                                                                                                                                                           |
| Active source count                                              | **PARITY**                                                                                                                                                                                                                                                                                                                    |
| Sample rate                                                      | **PARITY** (in the audio chip)                                                                                                                                                                                                                                                                                                |
| **Total CPU**                                                    | **DIVERGENT-BY-DESIGN.** A browser cannot measure audio-thread CPU. The frame-load proxy is the honest substitute and the code says so. Nothing to close.                                                                                                                                                                     |
| **Disk usage**                                                   | **PARTIAL** — no throughput meter, but `navigator.storage.estimate()` gives used/quota and diagnostics already shows it                                                                                                                                                                                                       |
| **Per-insert and per-instrument usage**                          | **MISSING**, and only partly platform-blocked. Web Audio cannot time a node, but MotionLab could count and display _instances_ per track (it already reports "Insert effects" and "Audio graph" in diagnostics). A per-track insert count in the mixer is not CPU but it answers the same question: "what is expensive here?" |
| **Double-click a name to open its editor**                       | **N/A** without the list                                                                                                                                                                                                                                                                                                      |
| **Checkbox to deactivate an insert/instrument from the monitor** | **PARTIAL** — bypass exists per insert in the rack; not gathered in one list                                                                                                                                                                                                                                                  |
| **Tick-and-drag to bulk-activate/deactivate**                    | **MISSING**                                                                                                                                                                                                                                                                                                                   |
| **Plug-in Nap + per-plug-in exceptions**                         | **MISSING** — see §6                                                                                                                                                                                                                                                                                                          |
| **Audio Cache size, contents, and cleanup**                      | **PARTIAL** — diagnostics reports decoded buffers, stored media and storage used; there is no "clean up unused items" action                                                                                                                                                                                                  |
| **Dropout Protection setting**                                   | **DIVERGENT-BY-DESIGN** — no buffer knob on the web                                                                                                                                                                                                                                                                           |
| Everything in the diagnostics report                             | **MotionLab-only**, and far beyond what the reference's monitor offers                                                                                                                                                                                                                                                        |

**One concrete recommendation:** the perf meter is desktop/tablet only. Phones
are where frame load actually bites, and the compact bar has room for a
three-pixel lamp. Either show it compact or record the decision.

---

## 19. Pages: Start — lines 2745–2872 _(deep dive)_

### FSP8 does

The Start page is "the central location for document management and device
configuration controls, as well as your artist profile, a news feed, and links
to demos and tutorials." (l. 2749–2750)

**Navigation icons, top right** (l. 2754–2760) — the manual lists three and then
gives four:

- **User Profile and Notifications** — sign in/out, edit profile, and workspace
  notifications
- **Transfers** — upload/download status
- **Home** — "Click this to return to the Start Page from any other Page"
- **Quick Switch** — "a drop-down menu of all open documents"

**Notification Center** (l. 2762–2786) — collaboration invites, new/departed
collaborators, file updates, sync updates, workspace messages; actionable
buttons **Accept / Join / Reject / Receive / Show / Open / Retry**; per-item `X`
and "Clear all"; read state syncs to the server and across machines; new content
notifications open the installer.

**Tasks, centre-left** (l. 2790–2797) — three: **New** (Session / Show /
Mastering Project, each explained in one line), **Open…**, **Join…**
(collaborations).

**New Document dialog** (l. 2801–2808) — Record and Mix / Master and Release /
Rehearse and Perform open a blank document of each type; Smart Templates create
optimised ones; **`File > Save as Template` puts your own in the User tab.**

**Recent Files tab** (l. 2812–2821):

- most recently accessed documents, click to open
- **hover to the left of a document reveals a Pin icon**; pinned documents stay
- **right-click → open an auto-saved revision** from a list
- right-click → show in Explorer/Finder
- right-click → critical file info: **sample rate, BPM, and more**
- **"Open with Options"** — load without native plug-ins, without third-party
  plug-ins, or without ARA, for troubleshooting

**Sessions / Mastering / Shows tabs** (l. 2825–2841):

- one tab per document type, listing everything in the User storage location
- **magnifying glass toggles a Search filter**
- right-click → **Move to New Folder / New Folder**; a **New Folder (+)** button
  sits left of the Search icon
- folders can be renamed, moved, deleted, or opened in the OS file system, and
  **folder hierarchies created here are matched in the OS file system**
- documents move between folders by right-click **Move to Folder** or by
  dragging the document icon
- **Pin** moves a document to a smart "Pinned" folder pinned to the top of the
  tab

**Setup** (l. 2845–2864) — current audio device, plus links to Configure Audio
Device, Configure External Devices, Check for Updates (shows your version and
the current version), and About.

**Artist Profiles** (l. 2866–2872) — image (file picker or drag-drop, `X` to
remove), artist name, genre, artist web URL. **Multiple profiles** for engineers
working with several clients, switchable and removable. "The Artist name and
photo included in Artist Profiles will be written into metadata of exported
files."

**SoundCloud Dashboard** (l. 2874–2896) — sounds, fans, plays, downloads,
hearts, comments.

**News Feed** (l. 2898–2901).

### MotionLab does

`src/pages/StartPage.tsx`, `data-testid="start-page"`.

- **Hero** — logo, `<h1>MotionLab Studio</h1>`, tagline _"Professional music
  production. Anywhere. v{APP_VERSION}"_, and a primary
  `Continue "{currentName}"` button (`start-continue`) → `go('song')`.
- **Recent** column — `listProjects()` from `src/persistence/projectRepo`. Each
  row shows `{trackCount} tracks · {clipCount} clips · {timeAgo(modifiedAt)}`
  (a local `timeAgo`: "just now" under 90 s, then minutes, hours, days, then a
  locale date). Row `data-testid={'recent-'+name}`. A per-row overflow menu
  gives **Open / Duplicate / Delete (danger)**. Empty state: "No saved projects
  yet". The list refreshes off a `projectStore.subscribe` on `lastSavedAt` /
  `project.id`, because the boot save can still be in flight on mount.
- **Templates** — the six-card grid (§12), click → `newProjectFromTemplate()`
  then `go('song')`.
- **What's new** — a hardcoded local array of three items.
- **Footer status chips** — `Audio running|idle`, `Web MIDI
available|unavailable`, `Works offline` — plus **Mastering**, **Live** and
  **Preferences** buttons.

Page navigation itself lives in the TopBar, on every page: `PAGES` = Start
("Recent work and templates"), Song ("The workstation"), **Release**
("Mastering and delivery"), **Live** ("Setlist and stage view"), rendered as
four `page-tab` buttons (`data-testid={'page-'+id}`) with labels hidden on
phone. Routing is hash-based: `#/<page>[/<fixture>][?flags]`, with page aliases
(`home→start`, `arrange→song`, `master|project→mastering`, `live→show`) and ten
QA fixture routes.

### Gap

| Feature                                                                                        | Gap                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A start page as the document-management home                                                   | **PARITY**                                                                                                                                                                                                                                                                         |
| Continue the current work in one click                                                         | **PARITY** (MotionLab-only, actually — the reference has no equivalent)                                                                                                                                                                                                            |
| Recent list with per-item Open / Duplicate / Delete                                            | **PARITY** (the reference has Open; Duplicate is MotionLab-only)                                                                                                                                                                                                                   |
| Recent list shows useful per-file facts                                                        | **PARTIAL** — MotionLab shows tracks/clips/age; the reference shows **sample rate and BPM**                                                                                                                                                                                        |
| Templates on the start page                                                                    | **PARITY**                                                                                                                                                                                                                                                                         |
| **Home button to return to Start from any page**                                               | **PARITY** — the TopBar `page-tab` row is on every page and is better than one Home icon                                                                                                                                                                                           |
| **Quick Switch**                                                                               | **MISSING** — see §22                                                                                                                                                                                                                                                              |
| **Pin a document**                                                                             | **MISSING** — cheap and genuinely useful once the recent list is long                                                                                                                                                                                                              |
| **Search / filter the document list**                                                          | **MISSING** — no search on `StartPage` at all                                                                                                                                                                                                                                      |
| **Folders for organising documents**                                                           | **MISSING**                                                                                                                                                                                                                                                                        |
| **Separate tabs per document type**                                                            | **N/A** — single document type                                                                                                                                                                                                                                                     |
| **Open an auto-saved revision from the right-click menu**                                      | **MISSING** — worth checking whether `projectRepo` keeps revisions at all; if it does, this is UI-only                                                                                                                                                                             |
| **"Open with Options" (load without plug-ins, for troubleshooting)**                           | **MISSING** — a real analogue exists: opening a project whose WAM plugin fails to load. A "load without effects" recovery path would be worth having.                                                                                                                              |
| Setup: audio device / external devices                                                         | **PARTIAL** — audio and MIDI state show as **chips**, and Preferences is one click away; there is no device chooser (the browser owns that)                                                                                                                                        |
| Check for Updates / version display                                                            | **PARTIAL** — `APP_VERSION` in the tagline and `GIT_COMMIT` in the status bar; no update check (the service worker handles it)                                                                                                                                                     |
| About                                                                                          | **MISSING** — no about/credits/licence surface                                                                                                                                                                                                                                     |
| **Artist Profiles (name, image, genre, URL; multiple profiles; written into export metadata)** | **MISSING**, and this connects to §13: `ProjectData.artist` and `genre` exist, are written into exports, and have **no editor outside the export sheet**. An artist profile on the Start page that seeds those fields is the missing half of a feature that is already half-built. |
| Notification Center / collaboration                                                            | **N/A** — single-user product                                                                                                                                                                                                                                                      |
| Transfers                                                                                      | **N/A**                                                                                                                                                                                                                                                                            |
| SoundCloud dashboard                                                                           | **N/A**                                                                                                                                                                                                                                                                            |
| News feed                                                                                      | **PARTIAL** — "What's new" is a hardcoded three-item list                                                                                                                                                                                                                          |

---

## 20. Pages: Session — lines 2903–3034

### FSP8 does

- "A complete multitrack production environment with a **single-window
  interface**." (l. 2907)
- **Toolbar** (l. 2917–2932) — arrange-view mouse controls, Audio Bend, Strip
  Silence, Quantize, Macros, Video Player, Launcher, Scratch Pad, zooming; and
  **on the far right**, account info, home, and the open-documents switcher.
- **Overview button** (l. 2941–2953) — "a tiny overview of the entire Session
  … above the Arranger that can be navigated without changing the zoom level."
  A white **"Current View"** box marks the visible area; drag it to scroll,
  drag its handles to resize, click empty space to jump (`Cmd/Ctrl`+hover shows
  a timestamp). Wheel modifiers: `Shift` horizontal scroll, `Cmd/Ctrl` vertical
  zoom, `Cmd/Ctrl+Shift` horizontal zoom.
- **Arranger** (l. 2957–2961) — audio, instrument and folder tracks; divided by
  seconds or bars per the Ruler Format; drag-and-drop events.
- **Global Controls** below the track lanes (l. 2965–2975):
  - **Global Mute** — "To unmute all muted tracks at once… Clicking it again
    will mute the previously muted tracks."
  - **Global Solo** — same, for solo.
  - **Activate All Inserts** — temporarily deactivate every insert on every
    channel; press again to restore _"inserts that were deactivated before
    clicking Activate All Inserts will remain deactivated."_
- **Track size** (l. 2979–2989) — a context menu of size presets, or a
  **Vertical Zoom slider**. Audio displays fall back to a consolidated mono
  waveform below a height threshold, and _"This limit is the same for all
  multichannel audio files."_
- **Transport Bar** at the bottom (l. 2993–3031) — see §9; ends with four panel
  toggles: Editor (pencil, `F2`), Channel Overview (fader), Console (`F3`),
  Browser (folder, `F5`).

### MotionLab does

`src/pages/SongPage.tsx` is 29 lines: a `RecordingBanner` when not on a phone,
then one of three layouts off `useViewport().layout`.

- **`DesktopLayout.tsx`** — `react-resizable-panels`. Horizontal group:
  `pane-browser` (default 16 %, min 180 px, max 34 %) · `pane-center` (min
  320 px, containing a vertical group of `pane-arrangement` min 180 px and
  `pane-editor` default 38 %, min 150 px, max 68 %) · `pane-inspector` (default
  17 %, min 190 px, max 34 %). A separate maximized branch renders one pane full
  width with a `MaximizeButton` in its title.
- **`TabletLayout.tsx`** — arrangement plus exactly **one** bottom panel chosen
  from Mixer / Piano Roll / Instrument; side panels become **overlay drawers**,
  one at a time. Bottom panel defaults to 32 % under 820 px height, else 40 %.
  Only `arrange` and `editor` maximize states apply.
- **`PhoneLayout.tsx`** — compact transport plus exactly one workspace, chosen
  from a six-item bottom nav: Arrange · Record · Perform · Edit · Mix · Browse.
- **`BottomEditor.tsx`** — a `role="tablist"` driven entirely by `EDITORS` from
  `src/app/editors.ts`; tabs whose `appliesTo(project, {trackId, clipId})` is
  false are **dimmed with an explanatory title, never hidden**.
- **Arrangement overview** — `showOverview` in `workspaceStore`, toggled at
  `Arrangement.tsx:979`.
- **Global tracks** — markers, arranger sections, chords, tempo lane, each
  independently toggleable (`GlobalTracks.tsx:502–510`).
- Track height via `laneScale`; free zoom via `pxPerBeat` and the wheel; nine
  tools on `1`–`9`.

### Gap

| Feature                                                                  | Gap                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single-window multitrack environment                                     | **PARITY**                                                                                                                                                                                                                                                                                                                                                                                                                |
| Resizable browser / editor / inspector panes                             | **PARITY**, with size clamping the reference does not document                                                                                                                                                                                                                                                                                                                                                            |
| Arrangement overview strip                                               | **PARITY** (exists) — **PARTIAL** on behaviour: no documented "Current View" box drag, resize handles, click-to-jump or timestamp-on-hover. Wheel gestures: `Shift`+wheel horizontal scroll is **PARITY** (`Arrangement.tsx:489`), but `Ctrl`/`Cmd`+wheel is bound to **horizontal** zoom (`:484–488`) where the reference uses it for **vertical** zoom — same modifier, opposite axis. `Ctrl`+`Shift`+wheel is unbound. |
| Global tracks (markers, sections, chords, tempo)                         | **PARITY**                                                                                                                                                                                                                                                                                                                                                                                                                |
| Track height / vertical zoom                                             | **PARITY**                                                                                                                                                                                                                                                                                                                                                                                                                |
| Nine tools vs. six                                                       | **MotionLab-only** (Slip, Listen, Zoom added)                                                                                                                                                                                                                                                                                                                                                                             |
| Adaptive tablet and phone layouts                                        | **MotionLab-only** — the reference has one desktop layout                                                                                                                                                                                                                                                                                                                                                                 |
| **Global Mute (unmute all, click again to restore the previous set)**    | **MISSING** — grep for `globalSolo`/`clearSolo`/`soloAll` finds only the sampler's per-zone `anySolo`                                                                                                                                                                                                                                                                                                                     |
| **Global Solo (clear all solos, click again to restore)**                | **MISSING** — this is the one every mix engineer reaches for                                                                                                                                                                                                                                                                                                                                                              |
| **Activate All Inserts (bypass everything, restoring only what was on)** | **MISSING**. The restore semantics are the whole point and are subtle: inserts already off stay off.                                                                                                                                                                                                                                                                                                                      |
| Track size **presets** in a context menu                                 | **PARTIAL** — continuous `laneScale`, no presets                                                                                                                                                                                                                                                                                                                                                                          |
| Waveform collapses to mono below a height threshold                      | **MISSING** — no threshold logic found in `ClipView.tsx` or `peaks.ts`                                                                                                                                                                                                                                                                                                                                                    |
| Ruler format (seconds vs. bars)                                          | **PARTIAL** — the transport shows both readouts; the ruler itself was not verified                                                                                                                                                                                                                                                                                                                                        |
| Scratch Pad                                                              | **PARITY** — `ProjectData.scratchPads` / `activePadId`, with a real UI in `src/components/arrangement/ScratchPads.tsx` (menu items + panel)                                                                                                                                                                                                                                                                               |
| Launcher (clip launcher)                                                 | **MISSING** — grep for `launcher` / `clip launch` returns nothing in `src/`                                                                                                                                                                                                                                                                                                                                               |
| Toolbar: Audio Bend / Strip Silence / Quantize / Macros                  | **PARTIAL** — `WarpTool.tsx` and `MacroPanel.tsx` exist; not as toolbar menus                                                                                                                                                                                                                                                                                                                                             |
| Account / home / document-switcher at the toolbar's right                | **PARTIAL** — page tabs and overflow, no account, no switcher                                                                                                                                                                                                                                                                                                                                                             |

**The three Global Controls are the standout gap in this section.** They are
small, they are used constantly, and "click again to restore what was there
before" is exactly the kind of stateful behaviour that is worth a test.

---

## 21. Pages: Show — lines 3036–3057

### FSP8 does

- "An independent yet fully integrated live performance environment… Setlist
  management with playback of backing tracks, playing virtual instruments, and
  processing real instrument audio signals through virtual FX racks — all from a
  single, intuitive interface **that can easily receive content directly from
  any track on the Session page**." (l. 3038–3042)
- **Two customizable views — one for editing and one for performing.** The
  dedicated **Performance View** has customizable Macro Controls, works with
  hardware fader controllers, and _"hides any information not needed in the
  actual live performance."_ (l. 3044–3047)
- Shares the Browser, Console, External Devices and Instruments panels with the
  Session page. (l. 3050–3052)
- **Customizable keyboard shortcuts with dedicated Show page commands**, called
  out for use with the remote app. (l. 3052–3054)

### MotionLab does

`src/pages/ShowPage.tsx` writes into `project.show: ShowSetup` (default
`{ entries: [], cued: 0, stageMode: false }`), so setlists save with the project.

- **Header** — back to Song, `<h1>Setlist</h1>`, "N songs", a **Stage mode**
  toggle (`data-testid="stage-mode"`, title _"Stage mode — larger type, fewer
  controls"_), and **Add current song**.
- `addFromCurrentSong()` pushes `{ id, name, projectId, startBeat: 0, bpm,
timeSig, color }`; `ENTRY_COLORS` cycles six hues.
- `cue(index)` sets `show.cued`, **applies the entry's bpm and time signature**,
  and seeks to `startBeat`.
- **Entry rows** (`data-testid={'setlist-'+n}`) — number, name, `{bpm} BPM ·
n/d`, optional note; per row: performance note (prompt dialog), move up, move
  down, remove.
- **Stage aside** — `Now` (name + note); a big position readout driven by
  `engine.onFrame()` → `formatBBT`, with `{bpm} BPM · n/d`; transport (return to
  start, big Play/Stop `stage-play`, metronome); **Next** (`stage-next`, shows
  the next entry's name or "End of set"); and a **Jump** row rendering the first
  **12** project markers as seek buttons, or a single "Top" button when there
  are none.

### Gap

| Feature                                                                   | Gap                                                                                                                                                                                |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A dedicated live page, saved with the document                            | **PARITY**                                                                                                                                                                         |
| Setlist with ordering                                                     | **PARITY**                                                                                                                                                                         |
| Receive content from the Session page in one command                      | **PARITY** (`Add current song`)                                                                                                                                                    |
| Per-entry tempo and signature applied on cue                              | **PARITY**                                                                                                                                                                         |
| **Two views — one for editing, one for performing**                       | **PARITY** — `stageMode` is exactly this                                                                                                                                           |
| Per-entry performance notes                                               | **MotionLab-only**                                                                                                                                                                 |
| Jump-to-marker buttons on stage                                           | **MotionLab-only**                                                                                                                                                                 |
| **Performance View with customizable Macro Controls**                     | **PARTIAL** — stage mode is fixed; macros exist (`MacroPanel`) but are not placeable on the stage view                                                                             |
| **Performance View in a separate resizable window** (`Alt`+click Perform) | **MISSING**                                                                                                                                                                        |
| **Dedicated Show-page key commands**                                      | **MISSING** — `shortcuts.ts` has no Show category; `stage-play` and `stage-next` are click-only, and "next song" is precisely the thing a performer needs on a key or a footswitch |
| Instrument Players / FX racks for live input                              | **MISSING** — the setlist plays back; it does not host live instruments                                                                                                            |
| Backing-track playback distinct from the arrangement                      | **PARTIAL** — cue seeks the one open project                                                                                                                                       |
| Remote-app control                                                        | **N/A**                                                                                                                                                                            |
| Drag to reorder setlist entries                                           | **MISSING** — ↑/↓ buttons only                                                                                                                                                     |

**The `stage-next` binding is the highest-value single line in this section.** A
performer cannot reach a mouse.

---

## 22. Pages: Mastering — lines 3059–3079

### FSP8 does

- Sessions **and** audio files arranged "as a sequence of Tracks on a continuous
  timeline." (l. 3065)
- Effects per Track **and** on the master output Track, "in order to achieve
  sonic continuity." (l. 3069)
- **Metering displayed at all times**: Spectrum, Peak/RMS, and Phase.
  Loudness metering and **offline loudness analysis** to "the current EBU R128
  and LU/LUFS standards." (l. 3072–3075)
- Burn Red Book audio CDs; create MP3 albums, disc images and **DDP** images.
  (l. 3063–3064)
- **"Sessions can be added directly … without having to export a Session mix.
  After adding a Session to a Mastering Project, you can go back and change the
  Session mix, and the Mastering Project is automatically updated."**
  (l. 3077–3079)

### MotionLab does

`src/pages/MasteringPage.tsx` writes into `project.mastering: MasteringProject`
(default `{ items: [], targetLufs: -14, ceilingDbtp: -1 }`).

- **`TARGETS`** — Streaming −14 / −1 · Podcast −16 / −1 · Broadcast −23 / −2
  (EBU R128 / ATSC A/85) · Club/CD −9 / −0.3.
- **`addCurrentSong()`** — `engine.start()` → `preloadForRender` →
  `renderProject(project, { range: 0…projectEndBeat, onProgress })` →
  `measureChannels(channels, sampleRate)` (**BS.1770-4**) → `audioBufferToWav` →
  `putMediaBlob` → push a `MasterItem` `{ id, name, mediaId, gainDb, fadeIn,
fadeOut, gapAfter: 2, measured }` → `registerMedia({ kind: 'import', source:
'mastering render', peaksVersion })` → toast. Progress shows in the button.
- **Running order** (`data-testid={'master-item-'+n}`) — index, name, duration,
  LUFS, dBTP, with move up / move down / remove. `totalSeconds` sums
  `durationSeconds + gapAfter`. Off-target (> 1 LU) and over-ceiling items are
  flagged with a **`⚠` glyph plus an explicit `aria-label`** — the code comment
  records that hue alone was both a red/green-deficiency failure and a
  screen-reader failure.
- **Measured panel** — six cells: Integrated (LUFS), Range (LU), True peak
  (dBTP), Sample peak (dBFS), Short-term max (LUFS), Correlation (warns below
  0). Verdict line reads "Within 1 LU of target and under the ceiling." or
  "N LU louder/quieter than target." `fmtLufs` renders `−∞` at or below −70.
- **Release chain** — `InsertRack` over a bespoke `ChainHost` with `id:
'release'`, writing `mastering.effects`, capped by `MAX_INSERTS`, params
  clamped to each `effectSpec(kind).params[].min/max`.
- **Normalise every track to target** checkbox.

### Gap

| Feature                                                                         | Gap                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A dedicated mastering page, saved with the document                             | **PARITY**                                                                                                                                                                                                                      |
| Sequence of tracks on one timeline with gaps                                    | **PARITY** (`gapAfter`)                                                                                                                                                                                                         |
| Effects on the master output                                                    | **PARITY** (release chain)                                                                                                                                                                                                      |
| **Loudness metering to EBU R128 / LU / LUFS**                                   | **PARITY** — MotionLab measures BS.1770-4 with integrated, range, true peak, sample peak, short-term max and correlation, and states a verdict against a named target. This is at least as strong as what the manual describes. |
| Offline loudness analysis                                                       | **PARITY** — `measureChannels` runs on the offline render                                                                                                                                                                       |
| **Session added without exporting a mix**                                       | **PARITY** — `addCurrentSong()` renders in-app                                                                                                                                                                                  |
| **"Change the Session mix and the Mastering Project is automatically updated"** | **MISSING** — no re-render of an existing `MasterItem`. `MasterItem.mediaId` is already there, so re-rendering into the same id is a contained change and the highest-value item on this page.                                  |
| **Per-track effects** (as distinct from the master chain)                       | **PARTIAL** — `MasterItem` has `gainDb`, `fadeIn`, `fadeOut` but no insert chain                                                                                                                                                |
| **Spectrum / Peak-RMS / Phase meters displayed at all times**                   | **PARTIAL** — measured numbers are shown; correlation is a number, not a phase meter; there is no live spectrum                                                                                                                 |
| **A transport on the Mastering page**                                           | **MISSING** — the manual says transport controls are present on all three pages (l. 2205); MotionLab's Release page has none, so a running order cannot be auditioned in place                                                  |
| Add plain **audio files** (not just the current song) to the running order      | **MISSING** — only `addCurrentSong()`                                                                                                                                                                                           |
| CD burning / DDP / disc images                                                  | **N/A** — no browser path                                                                                                                                                                                                       |
| MP3 album creation                                                              | **PARTIAL** — export encoding exists; no album assembly                                                                                                                                                                         |
| `MasteringProject.title` / `artist`                                             | **MISSING** — declared in the type, never surfaced                                                                                                                                                                              |
| Drag to reorder items                                                           | **MISSING** — ↑/↓ buttons only                                                                                                                                                                                                  |

---

## 23. Quick Switch — lines 3081–3087 _(deep dive)_

### FSP8 does

> "In Fender Studio Pro, you can have multiple Sessions, Mastering Projects or
> Shows open simultaneously and can switch between them quickly. The fastest way
> to switch between any open Session, Mastering Project or Show, **as well as
> the Start page**, is to press `[Ctrl]+[Tab]` and continue to hold `[Ctrl]`…
> This displays a pop-up list of all open documents.
>
> While holding `[Ctrl]`, press `[Tab]` to cycle through the open documents.
> Release `[Ctrl]` when the desired document is selected." (l. 3082–3087)

It is also a clickable icon in the Start page's navigation cluster
(l. 2759–2760) and at the right of the Session toolbar (l. 2930–2932,
2941–2942): "Click onto the Documents icon next to it to switch between
currently open Sessions, Shows or Mastering Projects."

The interaction is the OS window-switcher idiom: **hold the modifier, tap to
advance, release to commit** — a most-recently-used cycle, not a static list.

### MotionLab does

**Nothing, and cannot today.** `projectStore` holds exactly one `project`;
`setProject()` replaces it and wipes undo. There is no open-document set to
cycle through.

What exists instead:

- **Page navigation** — four `page-tab` buttons in the TopBar
  (`data-testid={'page-'+id}`) present on every page, plus hash routing with
  aliases. On a phone the labels are hidden and the overflow menu gains
  `Go to {label}` entries for each non-current page.
- **Workspace navigation within the Song page** — `phoneMode` (six modes with a
  bottom nav), `editorTab` (eight editors as a tablist), `browserTab` (six
  browser tabs), and the tablet's `combo` selector.
- **Project switching** — via the Start page's Recent list, which _replaces_ the
  open project.

### Gap

| Aspect                                      | Gap                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Fast movement between the four **pages**    | **PARITY** — arguably better: the reference gives one Home icon and one switcher; MotionLab has a persistent four-tab row |
| **Multiple documents open at once**         | **MISSING** — architectural, see §4                                                                                       |
| **`Ctrl+Tab` hold-and-cycle switcher**      | **MISSING**                                                                                                               |
| **A switcher that includes the Start page** | **PARTIAL** — Start is one of the four page tabs                                                                          |
| A most-recently-used ordering               | **MISSING**                                                                                                               |

**The honest read:** MotionLab's page-tab row already solves the _user problem_
Quick Switch solves for three of the four things it switches between. What it
does not solve is switching _documents_, and that is blocked on the
single-document architecture, not on the switcher.

Two things are worth doing without touching that architecture:

1. **Bind the page tabs.** Four pages, four keys, and the switching is
   already there. `Ctrl+1..4` is the obvious shape and nothing claims it — the
   bare digits are the tool row, but the modified digits are free.
2. **A most-recently-used project switcher.** `listProjects()` already returns
   `modifiedAt`. A `Ctrl+Tab`-style overlay over the _recent_ list — hold, tap,
   release to open — gives the muscle memory without the multi-document model,
   at the cost of the current project being saved and closed on commit. That
   cost should be stated in the ADR rather than hidden.

---

## 24. Note Repeat — lines 2648–2653

### FSP8 does

"A tool that allows you to produce several selectably quantized notes from a
single key press of your MIDI controller. Note Repeat is highly configurable,
and can be controlled extensively using MIDI, which unlocks a wealth of
real-time creative options."

### MotionLab does

**No note-repeat and no arpeggiator.** No `noteRepeat` identifier anywhere. The
only `repeat` hits are `repeatNotes(src, 1)` from `src/model/midiTools.ts` — a
**duplicate-selection editing operation**, used by `Ctrl+D` in the piano roll and
by a context-menu item "Repeat selection ×2" — plus keyboard auto-repeat
handling and CSS.

### Gap

**MISSING.** Note that MotionLab has the right hook again: `engine.liveNoteOn` /
`liveNoteOff` is where all three input paths converge, and a repeat generator
belongs there, gated on a quantise value from `uiStore.prSnap` or its own
setting.

---

## 25. Video Player — lines 2655–2658

### FSP8 does

Plays video in sync with the transport, for scoring; audio can be extracted from
the imported clip and mixed. The Advanced options add "Set Session frame rate to
video frame rate when importing video file" and "Automatically create audio track
for sound from video" (l. 2276–2282), and `Ctrl/Cmd`-drag extracts only the audio
(l. 25853).

### MotionLab does

**Zero matches for `video` (case-insensitive) in all of `src/`.** No video track,
no import, no sync, no `<video>` element.

### Gap

**MISSING.** Not platform-blocked — HTML5 video, `currentTime` and
`requestVideoFrameCallback` all exist — but it is a whole feature area and a
scoring workflow, not a parity nudge. Belongs in its own directive if it is
wanted at all.

---

## 26. Summary of gaps by weight

**Architectural (an ADR before any code):**

1. Single-document vs. multiple open documents (§4, §23)
2. Undo depth capped at 60 vs. unlimited (§1)
3. 32-bit-only mix engine — a Web Audio constraint, and a Motion Wave decision (§3)

**Feature-shaped, high value, contained:** 4. **Retrospective Recording** (§2) — nothing exists; the input funnel does 5. **Undo History browser** (§1) — the data exists; labels and a list do not 6. **Global Mute / Global Solo / Activate All Inserts** (§20) — small, constant-use, stateful-restore 7. **Zoom commands and zoom history** (§17) — eleven commands, zero implemented 8. **Artist / project metadata editor** (§13, §19) — fields persisted, no setter, no UI 9. **User templates (save current project as a template)** (§12) — the data path already inverts 10. **"Update Mastering File"** (§4, §22) — `mediaId` is already stored 11. **Plug-in Nap** (§6, §18) — real CPU win, and implementable in Web Audio 12. **Info View** (§11) — nine tools with modifier grammar and nowhere that says so 13. **Total PDC readout in the transport** (§5, §9) — the number already exists

**Bug-shaped, fix now:** 14. `btn-rts` tooltip advertises `Home`; the handler binds `Enter` (§9) 15. `uiStore.channelOverview` is a visibility flag with no toggle anywhere (§17) 16. `ProjectData.artist` / `genre` are persisted with no store setter (§13) 17. `MasteringProject.title` / `artist` are declared and unreachable (§22) 18. `Ctrl/Cmd+E` means Split here and Export in the reference (§10 / shortcuts file) 19. Marker navigation hides on a right-click nothing advertises (§9) 20. "Reset layout" is destructive, unconfirmed, and has no undo behind it (§17)
