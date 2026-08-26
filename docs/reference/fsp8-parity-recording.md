# Parity — Recording

Directive 09 §1. Reference chapter: FSP8 user manual, "Recording" (manual pp. 75–98,
text lines 3132–4087) plus "Transport Controls" (p. 50, lines 2203–2226), "Retrospective
Recording" (p. 44, lines 2051–2101), "Audio Dropout Protection and Low-Latency
Monitoring" (pp. 14–17, lines 753–931), "Advanced / Console options" (p. 41, lines
1966–1990), "Transport Options" (p. 120, lines 5013–5045), "Comping / Takes and Layers"
(p. 131, lines 5420–5475), "Sample Rate / Resolution" (p. 28, lines 1411–1440).

**IP boundary.** This is a reference document only. The competitor product is named
here because provenance has to be citable; no name, symbol, filename, preset name or
UI string proposed for MotionLab or Motion Wave anywhere below is drawn from it. Where
FSP8's own term is load-bearing (e.g. "Layer", "Precount") it is quoted as _their_
term and a neutral MotionLab term is proposed alongside.

Legend: **PARITY** · **PARTIAL** · **MISSING** · **DIVERGENT-BY-DESIGN**.

Code read for the MotionLab column (all paths relative to repo root):
`src/state/transportStore.ts`, `src/state/inputStore.ts`, `src/state/projectStore.ts`,
`src/state/prefsStore.ts`, `src/audio/recordingController.ts`, `src/audio/recorder.ts`,
`src/audio/midiRecorder.ts`, `src/audio/inputManager.ts`, `src/audio/engine.ts`,
`src/audio/scheduler.ts`, `src/audio/freeze.ts`, `src/app/monitorActions.ts`,
`src/model/types.ts`, `src/persistence/projectRepo.ts`, `src/hooks/useKeyboard.ts`,
`src/app/shortcuts.ts`, `src/components/transport/TransportBar.tsx`,
`src/components/recording/RecordControls.tsx`,
`src/components/recording/RecordWorkspace.tsx`,
`src/components/arrangement/TrackHeader.tsx`, `src/components/mixer/ChannelStrip.tsx`,
`src/components/inspector/Inspector.tsx`.

---

## 1. Transport controls

### 1.1 Play

**FSP8 does:** Transport Controls sit at the bottom of the Session, Mastering Project
and Show pages. Play "start[s] playback at the current cursor location. You can also
Play by hitting the spacebar on your keyboard, which also works to stop the transport,
when it is in playback."

**MotionLab does:** `engine.play(fromBeat?)` in `src/audio/engine.ts:1829`. Starts the
`AudioContext` first (`engine.start()`), refuses a second scheduler if already playing
("no duplicate schedulers, ever"), and starts at `fromBeat ?? this.pausedAtBeat`. The
Play button (`TransportBar.tsx`, `data-testid="btn-play"`) calls `engine.play()` with no
argument, so it resumes from `pausedAtBeat`. Space is bound in `src/hooks/useKeyboard.ts:228`
to `engine.togglePlay()` (`engine.ts:1855`), which is play-if-stopped / stop-if-playing.
`src/app/shortcuts.ts` documents it as `Space → "Play / stop"`.

**Gap: PARITY.**

### 1.2 Stop (transport only, not recording)

**FSP8 does:** "Stop: Stop playback. You can also Stop by hitting the spacebar on your
keyboard, or [0] on the numerical keypad." Cursor stays where it stopped unless
Transport/Options/**Return to Start on Stop** is enabled ([Alt]/[Option]+[Num Pad 0]),
in which case "the playback cursor returns to the position from which it started."

**MotionLab does:** `engine.stop()` (`engine.ts:1840`). If playing: latches
`pausedAtBeat = scheduler.positionBeats()`, stops the scheduler, stops all sources
(soft), publishes `playState: 'stopped'` and the position to `transportStore`. If
**already stopped**, a second Stop press sets `pausedAtBeat = 0` — i.e. stop-stop is
return-to-zero, commented "second stop press: return to start (common DAW convention)".
Button title says so: `"Stop (Space) — press twice to return to start"`.

**Gap: PARTIAL.** Stop-in-place matches. "Return to Start on Stop" as a _persistent
option_ is **MISSING** — MotionLab hard-codes the double-press gesture instead and has
no preference for it (grepped `src/state/prefsStore.ts` for `returnToStart|onStop`: no
hits). MotionLab also has no separate "position playback started from"; the second press
always goes to beat 0, not to the play-start position. FSP8's option returns to the
_start position_, which is not necessarily zero.

### 1.3 Stop mid-record, and what happens to a partial take — **P0**

**FSP8 does:** Recording ends only through a record-stopping action. Every recording
recipe in the chapter terminates the same way: _"Recording continues until you manually
stop it by pressing [Space Bar] on the keyboard or clicking Stop in the Transport"_
(manual pp. 83, 84, 89, and again for Precount/Preroll and Loop Recording). So in FSP8,
**Stop is Stop for the recorder as well as for the transport** — spacebar and the Stop
button both end the take, and the audio captured so far becomes a normal Audio Event on
the record-enabled Track (crossfaded into any pre-existing Event at its edges when the
take was a punch-in, manual or Auto Punch: "the newly recorded audio is automatically
crossfaded at its edges with the existing Audio Event… The crossfade time is very small
and not audible; however, you can edit the crossfade manually"). Auto Punch is the one
case where the _recorder_ stops without the _transport_ stopping: "Recording
automatically stops at the Right Locator position. However, playback continues beyond
the Right Locator position until you manually stop it."

**MotionLab does:** **Two separate stops that do not know about each other.**

- `recording.stop()` (`recordingController.ts:376`) is the take-ending path. It clears
  the tick timer, sets `phase: 'finalizing'`, awaits `TakeRecorder.stop()`, releases the
  input, calls `engine.stop()`, then `commitTake(...)` → decode → peaks → `putMediaBlob`
  → `putPeaks` → `addRecordedClip` → `selectClip`. A partial take is a _complete_ take:
  whatever was captured is decoded and lands as a clip. `MediaRecorder` is started with
  `rec.start(1000)` so a timeslice chunk exists every second — commented "Periodic chunks
  mean an interrupted take still has recoverable data."
- `engine.stop()` (`engine.ts:1840`) — the Stop **button** (`TransportBar.tsx:398`) and
  **Space** (`useKeyboard.ts:228` → `engine.togglePlay()`) — does **not** touch the
  recorder. Grepped every `engine.stop()` call site and every
  `useTransportStore.subscribe`: the only subscriber is
  `src/app/automationActions.ts:263` (automation latch release), not recording.

Consequence, verified by reading: pressing **Space or the Stop button while a take is
being captured stops the transport and leaves `MediaRecorder` running**. `phase` stays
`'recording'`, `recordSeconds` keeps climbing on the 200 ms tick, the punch timer stays
armed, the live waveform tap keeps appending, and the microphone stream stays open. The
capture start beat is already latched, so when the user eventually presses R or the
record button the take is committed at its original start beat with a length that
includes all the wall-clock time the transport was stopped. Only these end a take:

- the record button in the transport (`RecordControls.tsx:62`, toggles on `phase`),
- `R` (`useKeyboard.ts:375` → `recording.toggle()`),
- `Escape` (`useKeyboard.ts` → `recording.cancel()` when `recording.isActive()`),
- the punch-out timer (`armPunchOut`, only when a finite punch end exists),
- a bound hardware control (`src/audio/controlLink.ts:66`).

Cancel is well-behaved and is worth keeping: `recording.cancel()` stashes
`this.recorder.snapshot()` through `stashRecovery()` into IndexedDB before aborting, so
an abandoned take is recoverable rather than discarded (`RecoveryPanel.tsx` surfaces it).
A `beforeunload` guard (`installUnloadGuard`) warns before a reload discards an
in-progress take.

**Gap: MISSING (P0).** The single most-repeated sentence in FSP8's Recording chapter —
"stop it by pressing [Space Bar] … or clicking Stop in the Transport" — is the one
behaviour MotionLab does not implement. Fix shape: `engine.stop()` should end an active
take (or `TransportBar`'s Stop and the Space handler should route through
`recording.isActive() ? recording.stop() : engine.stop()`), with the take committed, not
discarded. A regression test belongs in `tests/` asserting `phase === 'idle'` and a clip
present after a transport stop during `phase === 'recording'`.

### 1.4 Return to zero (RTZ)

**FSP8 does:** "Return to Zero (RTZ): Return the playback cursor to the beginning of the
timeline. You can also zero the transport by pressing [,] on the keyboard."

**MotionLab does:** `engine.returnToStart()` (`engine.ts:1860`) — `seek(0)` while
playing, otherwise sets `pausedAtBeat = 0` and publishes position 0. Bound to the
leftmost transport button (`btn-rts`, title "Return to start (Home)") and to **Enter**
(`useKeyboard.ts:379`; `shortcuts.ts` lists `Enter → "Return to start"`). Also present in
the transport overflow menu.

**Gap: PARITY** on behaviour; key differs (Enter vs `[,]`), which is cosmetic. Note the
button title says "(Home)" but the actual binding is Enter — a small UI/actual-binding
inconsistency worth a one-line fix.

### 1.5 Rewind / fast forward / marker shuttle

**FSP8 does:** "Go To Previous/Next Marker" shuttles to the previous/next marker on the
Marker Track; "Rewind and Fast Forward: Press these buttons to move the cursor back or
forward in time."

**MotionLab does:** `btn-rewind` / `btn-forward` in `TransportBar.tsx` call `nudgeBars(±1)`
— one whole bar, resolved through the tempo/signature map (`beatToBar` / `barToBeat`).
Right-click on either goes to the previous/next marker via `nextMarker` / `prevMarker`
(`src/model/arrangement.ts`); a previous-marker request with no marker behind falls back
to `returnToStart()`. Both buttons are hidden in the `compact` (phone) transport.

**Gap: PARITY** (functionally richer — marker shuttle is folded into the same buttons
rather than given its own pair).

### 1.6 Loop

**FSP8 does:** "Loop: Press to enable/disable Loop mode. You can also toggle looping by
pressing [/] on your keyboard" ([NumPad /] elsewhere in the chapter). The loop range is
the Left and Right Locators set in the Timeline Ruler. `Set Loop Start` / `Set Loop End`
place the locators at the playback cursor (unassigned by default). `Shift Loop` /
`Shift Loop Backwards` move the range to the next/previous range of equal length. Option
**Loop Follows Selection** snaps the locators around an edit selection — "These actions
can only take place when the Transport is stopped."

**MotionLab does:** `project.loop: LoopRegion` (`types.ts:712`), toggled by `btn-loop` in
`TransportBar.tsx` and by the overflow menu. The scheduler honours it in
`src/audio/scheduler.ts:336–368`: when `loop.enabled && nextBeat < loop.end &&
windowEndBeat >= loop.end`, the lookahead window is clipped to `loop.end`, a wrap is
flagged, `nextBeat` becomes `loop.start`, a new tempo anchor is pushed, `onLoopWrap` is
fired (which retires sounding sources so a note longer than the loop does not accumulate
a voice per lap) and `scheduleSounding(loop.start, …)` re-enters mid-clip material.

**Gap: PARITY** for loop playback. **MISSING:** Set-Loop-Start / Set-Loop-End commands,
Shift Loop / Shift Loop Backwards, and Loop Follows Selection (grepped `shortcuts.ts`
and `useKeyboard.ts` — no bindings). See §10 for the much larger gap: loop _recording_.

### 1.7 Record

**FSP8 does:** "Record: Begin recording at the current cursor location. You can also
activate recording by pressing [*] on the numeric keypad." On press the Record button
turns red, the cursor scrolls, and "new Events are recorded to any record-enabled
Tracks" — note the plural: FSP8 records every armed Track simultaneously.

**MotionLab does:** `RecordButton` (`RecordControls.tsx:45`) is a phase-driven toggle:
`recording` or `countIn` → `recording.stop()`; otherwise → `recording.start()`. Disabled
while `phase` is `'arming'` or `'finalizing'`. Bound to **R** (`useKeyboard.ts:375` →
`recording.toggle()`; comment: "'R' is not part of the virtual keyboard layout").
Recording starts at `engine.getPositionBeats()` unless punch or pre-roll move it
(§8). **One track at a time** — `RecordingController`'s header comment states the
decision explicitly: "Multitrack simultaneous recording is deliberately NOT offered: one
MediaRecorder per stream is reliable, but aligning several independently encoded streams
to one timeline is not, so the app records one armed track at a time and says so."

**Gap: PARTIAL / DIVERGENT-BY-DESIGN.** Single-track record is a documented, reasoned
divergence forced by `MediaRecorder`; multitrack simultaneous capture is **MISSING** and
should be recorded as a Motion Wave (native core) requirement rather than a MotionLab
defect. The button/key parity itself is fine.

### 1.8 Other Transport options

**FSP8 does:**

- **Enable Play Start Marker** ([Alt]/[Option]+[P]): separates the playback start marker
  from the edit selection so playback always starts from a chosen location.
- **Locate to the Mouse Cursor** ([Ctrl]/[Cmd]+[Space]).
- **Return to Start on Stop** — see §1.2.
- **Loop Follows Selection** — see §1.6.

**MotionLab does:** None of these. Playhead is set by clicking the ruler / typing a
position into the BBT cell (`PositionDisplay` in `TransportBar.tsx`, `parseBBT` →
`engine.seek`). Grepped `useKeyboard.ts`, `shortcuts.ts`, `prefsStore.ts` for
`playStart|locate|mouse`: absent.

**Gap: MISSING** (all four). Low priority; none is a recording blocker.

### 1.9 Position display / timebase

**FSP8 does:** Time Display supports Seconds, Bars, Samples and Frames, configured from
the smaller Time Display left of the Transport Bar. A separate "Remaining Record Time"
view shows available recording time from track count, sample rate and free disk space.

**MotionLab does:** `PositionDisplay` shows BBT and clock side by side, written straight
into the DOM on the engine frame loop (deliberately not through React — the comment
explains a re-rendering transport would re-render the whole bar 60×/s).
`usePrefsStore().primaryTimeDisplay` selects which of the two is emphasised
(`'bbt' | 'clock'`). Samples and Frames are absent. Remaining-record-time is absent
(grepped for `remaining|diskSpace|quota`: nothing in the transport path).

**Gap: PARTIAL.** Bars and Seconds present; Samples/Frames **MISSING**; remaining record
time **MISSING** (browser `navigator.storage.estimate()` would make this implementable).

---

## 2. Track creation and channel format (mono vs stereo) — **P0**

**FSP8 does:** Track/Add Tracks ([T]) offers Name, Count, Type, Color (+ Auto-Color),
**Format: "mono, stereo, or one of many available surround formats"**, FX Chain, Input,
Output (both with an Ascending option for multi-track creation), and Load Track Preset.
Shortcuts: Track/Add Audio Track (mono or stereo); right-click blank Track Column → "Add
Audio Track (Mono)" or "Add Audio Track (Stereo)"; right-click → "Add Tracks For All
Inputs" creates one Track per configured input.

Channel Format is _live_: in the Inspector, "A Track's Channel Format (mono or stereo)
can be switched with a single click of the single-circle (mono) or double-circle (stereo)
icon. You can toggle many Tracks' Channel Format simultaneously by selecting multiple
Tracks before clicking this icon." Multichannel surround formats come from the drop-down
beside the icon.

The routing rule is explicit and is the heart of the mono/stereo question:

> "Stereo Tracks can select from both mono and stereo Input Channels, while Mono Tracks
> can only select from mono Input Channels."

Input Channels themselves (mono or stereo, each mapping to one or a pair of Hardware
Inputs) are built in Session/Session Setup/Audio I/O Setup, per Session, and stored per
computer and per audio-device driver so a Session survives moving between interfaces.
Deleting an Audio Track: select it with no Audio Events selected and press [Delete].

**MotionLab does:** **No channel format at all.** `Track` (`src/model/types.ts:161`) has
no `channelFormat`, `channels` or `format` field; grepped `types.ts`, `projectStore.ts`
and `projectRepo.ts` for `mono|stereo|channelFormat`: the only hits are
`Track.monoSum?: boolean` ("sum the channel to mono at the input", `types.ts:611` region)
and `Clip.monoSum`, both of which are _mono-compatibility checks_, not a track format.
`addTrack('audio')` (`projectStore.ts:640`) creates one shape with no format choice.
Every channel is built stereo-capable: `engine.buildChannel` wires
`input → trim → inserts → mute → volume → pan(StereoPannerNode) → analyser → destination`
(`engine.ts:945`).

What a mono input actually produces, end to end:

1. `AudioInputManager.CONSTRAINTS` (`inputManager.ts:33`) asks for
   `channelCount: { ideal: 1 }` alongside `echoCancellation/noiseSuppression/autoGainControl: false`
   ("Recording/monitoring want raw signal, not voice-call processing"). `ideal` is a hint,
   not `exact` — a stereo interface may still hand back 2 channels; nothing downstream
   checks or reports which happened.
2. `TakeRecorder.start(stream)` encodes **the raw `getUserMedia` stream**, whatever its
   channel count, through `MediaRecorder`.
3. `commitTake` decodes with `ctx.decodeAudioData` and records the truth it finds:
   `mediaRef.channels = buffer.numberOfChannels`, `mediaRef.sampleRate = buffer.sampleRate`
   (`recorder.ts`). So the _file_ is mono if the device gave mono, stereo if it gave
   stereo — and the user is never told which.
4. Playback: `AudioBufferSourceNode → GainNode → … → StereoPannerNode`. A 1-channel
   buffer is up-mixed by Web Audio's default rules and lands centred; pan works normally.
   A 2-channel buffer plays as stereo. `clip.monoSum` (`engine.ts:1509`) can force an
   explicit equal-weight downmix per clip.
5. There is no "this track is mono" state anywhere, so no restriction on which input a
   track may select, and nothing that could enforce FSP8's mono-track/mono-input rule.

**Gap: MISSING (P0).** MotionLab has no track channel format, no mono/stereo choice at
creation, no format toggle, and no mono/stereo constraint between input and track.
Concretely what a user loses: they cannot ask for a mono take on purpose. The take's
channel count is whatever the browser decided to hand over. Minimum viable parity:
(a) add `Track.channelFormat: 'mono' | 'stereo'` (default `'mono'` for a new audio track
— this is a recording app and one microphone is the common case); (b) pass
`channelCount: { exact: 1 }` for a mono track and drop the constraint for a stereo one;
(c) verify after `decodeAudioData` and surface a mismatch through `diagLog` and the take
review rather than silently accepting it; (d) show the resulting format in
`TakeReview` beside duration and size. Surround is out of scope for the web product and
belongs to Motion Wave.

---

## 3. Input selection per track — **P0**

**FSP8 does:** An Audio Track's I/O can be set from **three** places, all equivalent:

- **Track Column** — expand the Track's control area, click the Input Selector
  immediately below the horizontal Track fader.
- **Console** ([F3]) — the two selectors above each Track's Fader and Pan; input on top,
  output beneath.
- **Inspector** ([F4]) — the Channel area carries the Channel Mode toggle (mono/stereo)
  plus Input and Output Channel selectors.

Choices are the Input Channels configured in Audio I/O Setup, not raw hardware ports.
**Re-recording**: Instrument Output and Bus channels also appear as inputs to any
_stereo_ Audio Track, grouped in branches in the input menu — this is how you "print"
the live output of a virtual instrument or a hybrid analog mix to audio.

Instrument Tracks select a **Keyboard** (FSP8's term for a MIDI controller) as input,
from the Track Column (Track size medium or larger; top selector = instrument output,
bottom = Keyboard input) or the Inspector. `All Inputs | Any` combines every defined
keyboard device and is always in the list even with no device defined; if no Keyboard is
flagged Default Instrument Input, new Instrument Tracks default to All Inputs.

**MotionLab does:** `Track.inputDeviceId?: string` — "audio tracks: selected input device
id, or 'default'" (`types.ts`). The selector lives in **one** place,
`TrackInputControls` (`RecordControls.tsx:100`), which is rendered by the desktop
Inspector (`Inspector.tsx:493`) and by the phone `RecordWorkspace`. Options are
`DEFAULT_INPUT` plus every `audioinput` from `navigator.mediaDevices.enumerateDevices()`
(`inputManager.refreshDevices`). Labels are only read once permission is granted —
`label: d.label || (d.deviceId === DEFAULT_INPUT ? 'Default input' : 'Input ' + (i+1))`,
commented "Empty labels mean permission has not been granted yet — never invent one."
Changing the device while monitoring tears the monitor down and restarts it on the new
device (`RecordControls.tsx` `onChange`). The select is disabled while
`phase === 'recording' || 'countIn'`. A `devicechange` listener re-enumerates and hard-
releases any held stream whose device disappeared.

There is **no** input selector on the mixer channel strip (grepped
`ChannelStrip.tsx` for `inputDeviceId`: no hits) and none in the track header
(`TrackHeader.tsx` has arm and monitor buttons only). There is **no** software
input-channel layer: a track points straight at a browser device id, so nothing survives
a change of interface the way FSP8's per-driver stored I/O maps do. There is no
re-recording path — a bus or instrument output cannot be selected as a track input
(the only "print an instrument to audio" mechanism is `src/audio/freeze.ts`, which is an
offline render, not a live capture).

Instrument tracks have no per-track MIDI input selection: `transportStore` holds one
global `midiSelectedId` for the whole app, and `midiRecorder` hangs off
`engine.liveNoteOn/liveNoteOff` so hardware MIDI, the on-screen keyboard and the computer
keyboard all feed the one armed track.

**Gap: PARTIAL (P0).**

- Per-track device selection: **PARITY** in substance (one device per audio track).
- Reachable from three surfaces: **PARTIAL** — Inspector and phone Record workspace only;
  the channel strip and the track header are the two obvious missing entry points, and
  the strip already has the room (it renders trim, polarity and mono in an "Input stage").
- Software I/O channel layer / per-driver portability: **MISSING** — arguably
  DIVERGENT-BY-DESIGN for the web, where device ids are already opaque and per-origin.
- Re-recording (bus/instrument output as a track input): **MISSING**.
- Per-track MIDI input (FSP8's Keyboard selection, All Inputs | Any): **MISSING** —
  one global MIDI input for the app.

---

## 4. Record-arm

**FSP8 does:** "To record to an Audio Track, the Track must be record-enabled. To
record-enable an Audio Track, click on the Track's Record Enable button once or select
the Track and press [R]." Arming is multi-select aware: "Select multiple Tracks and
record-enable any of them to record-enable all selected Tracks." The button turns red,
and "the Track's meter begins to move up and down if there is live audio input on the
Track's selected Input Channel" — i.e. **arming alone starts input metering**.

**Exclusive arm:** [Alt]/[Option]+click on Record Enable "record-enable[s] the related
Track and disarm[s] record-enable for all other Tracks."

**Clip indicator:** "When an Audio Track is record-enabled, a clip indicator appears at
the top of the input-level meter for that Track in the Arrange view. If clipping occurs
at the input, the clip indicator turns on. When clipping occurs, you should adjust the
input gain/level on your audio interface, as once the distorted signal is recorded, it
cannot be fixed."

Instrument Tracks arm the same way (click Record Enable, turns red); "If note data
arrives from the Track's selected Keyboard, the Instrument Track's meter moves up and
down, corresponding to that input."

**MotionLab does:** `Track.armed: boolean` (`types.ts:174`). Toggled from two places, both
a plain store write with no side effects:

- `TrackHeader.tsx:391` — `store.getState().setTrack(track.id, { armed: !track.armed })`,
  title "Record arm — routes live input here".
- `RecordControls.tsx` `data-testid="arm-track"` — same write; disabled while capturing.

Defaults (`projectStore.ts:648`): `armed: type === 'instrument' || type === 'drum'` —
**new instrument and drum tracks are armed on creation, audio tracks are not.** That is a
deliberate asymmetry (a new instrument track should play immediately) and it is what makes
`midiRecordTargetTrack()` usually win over the audio path.

Target resolution (`recordingController.ts`):

```
recordTargetTrack()      = audio tracks: armed ?? selected ?? null
midiRecordTargetTrack()  = instrument|drum tracks: armed ?? selected ?? null
start()                  = if (midiTrack?.armed) → MIDI path, else audio path
```

So **an unarmed but selected audio track will still be recorded onto** — arm is a
preference, not a precondition, on the audio path. The MIDI path does require `armed`.

No exclusive-arm modifier (grepped `TrackHeader.tsx` and `RecordControls.tsx` for
`altKey|metaKey` near arm: absent). No multi-select arm. No arm-driven metering: the
input meter is bound to `monitoring ? trackId : null` (`RecordControls.tsx`), and
`engine.inputLevel(trackId)` returns 0 for any track with no `Monitor` entry — so an
armed, unmonitored track shows a dead meter. No input clip indicator; the channel-strip
`StereoMeter`/`PeakReadout` read the post-fader analyser, which sees nothing at all
unless monitoring is on.

**Gap: PARTIAL.**

- Arm exists and persists: **PARITY**.
- Arm-implies-metering: **MISSING** — and this is the specific thing that makes
  "is my mic working?" unanswerable without also enabling monitoring, which risks
  feedback. Fix: open the stream and the analyser on arm; route it to the meter but not
  to the channel unless monitoring is on.
- Exclusive arm ([Alt]-click) and multi-select arm: **MISSING**.
- Input clip indicator: **MISSING** (`engine.ts` tracks `clipped` per meter but only on
  the post-fader channel analyser; `resetClipIndicators` exists at `engine.ts:2147`).
- Recording onto an _unarmed_ selected track: **DIVERGENT**. FSP8 requires arm. The
  fallback is convenient on a phone but means the record button's target is not the
  thing the arm lamp shows. At minimum the record banner should name the track it chose;
  it already does (`RecordingBanner` prints `trackName`).

---

## 5. Monitoring

### 5.1 Software monitoring

**FSP8 does:** "To monitor (listen to) live audio input on an Audio Track, click on the
Monitor enable button once. This button should turn blue, and you should begin to hear
your live audio input and see its input level on the Track meter." [Alt]/[Option]+click
engages monitoring on that Track and disengages it on all others. The manual then draws
the whole signal path — hardware input → Input Channel → Track → Output Channel →
interface outputs — and warns: "When monitoring live audio input from a microphone, avoid
listening with speakers that are in close proximity to the microphone. Otherwise, you
might create a feedback loop that could quickly generate dangerously loud audio levels."

**MotionLab does:** `Track.monitoring?: boolean` ("audio tracks: monitor the live input
through this channel"). One shared implementation, `src/app/monitorActions.ts`
`toggleMonitoring(trackId)` — the module docstring explains why it exists: monitoring is
reachable from the record workspace, the channel strip and the track header, "and each of
them has to do the same four things in the same order: tear down cleanly, ask for the
microphone if it has not been granted, open the device, and record on the track whether
it actually opened. Written out three times, the third copy is the one that forgets to
write `monitoring: false` when the device refuses."

`engine.startMonitoring(trackId, deviceId)` (`engine.ts:985`) acquires a source from
`AudioInputManager` under owner key `monitor:<trackId>`, then wires
`source → gain(1) → analyser(fftSize 1024) → ch.input` — i.e. into the **head of that
track's channel**, so as the comment says "monitored audio is shaped by that track's
volume, pan, mute/solo and bus routing exactly like recorded material will be."
Toggling repeatedly tears down first ("must not stack nodes"). `stopMonitoring` releases
the lease; `engine.panic()` calls `stopAllMonitoring()` and `audioInput.stopAll()`.

The stored flag is written from what the engine actually did, never from the request —
`setTrack(trackId, { monitoring: ok })`. `TrackHeader` reads `engine.isMonitoring(id)`
rather than the flag, commented "`engine.isMonitoring` is the truth; the stored flag is
what survives a save."

Feedback: `RecordControls.tsx` toasts "Monitoring on — use headphones to avoid feedback
into the microphone." on success.

**Gap: PARITY** for the core behaviour, and the signal path matches FSP8's description
(monitor through the channel, so inserts, fader, pan and routing all apply).
**MISSING:** [Alt]-click exclusive monitoring; a blue/lit state distinct from arm exists
(`mon-on` class, speaker icon) so that part is fine.

### 5.2 Does monitoring follow record-arm? — **P0**

**FSP8 does:** **Yes, by default, and it is configurable.** Two statements in the chapter:

- Audio: "Monitor-enable is, by default, automatically engaged when Record Enable is
  engaged." (p. 77)
- Instrument: "note that monitor-enable is, by default, automatically engaged when Record
  Enable is engaged. This behavior can be configured in the Studio
  Pro/Options/Advanced/Devices menu (macOS: Preferences/Advanced/Devices)." (p. 81)

The Console options page (p. 41) names the two switches:

> "If you would like Audio or Instrument Track monitoring to be enabled automatically when
> recording is enabled on a Track, engage the **Audio Track Monitoring Follows Record** and
> **Instrument Track Monitoring Follows Record** options."

Two related options sit beside them:

- **Audio Input follows Selection** — "automatically engage[s] Record and Monitor mode for
  any Audio Track you select" (the chapter adds: "Engaging this automatically
  record-enables the last Track selected in the Arrange view").
- **Instrument Input follows Selection** — "any Instrument Track you select automatically
  has Monitor and Record enabled, and all other Instrument Tracks have these disabled."

**MotionLab does:** **No.** Arming writes exactly one field (`{ armed: !track.armed }`) at
both call sites. Monitoring is a separate button with a separate code path
(`toggleMonitoring`). Grepped the whole tree for any coupling
(`armed.*monitor|monitor.*armed|MonitoringFollows|followsRecord|inputFollows`): nothing.
Grepped `src/state/prefsStore.ts` for any monitoring preference: nothing.

**Gap: was MISSING (P0); now PARITY on two of three.**

1. monitoring-follows-arm behaviour — **PARITY**. `src/app/monitorActions.ts`
   opens the monitor when a track is armed.
2. A preference to control it — **PARITY**. `prefs.monitorFollowsArm`, with
   `openInputOnArm` beside it in `SettingsSheet`.
3. input-follows-selection — **MISSING**.

This compounds §4: arm does not meter _and_ arm does not monitor, so arming a track has
no audible or visible consequence whatsoever until the user finds a second button. Fix
shape: a `prefsStore` pair (`audioMonitorFollowsRecord`, `instrumentMonitorFollowsRecord`,
both defaulting **on**, matching FSP8), applied in one place — the arm action should
route through an `armActions.ts` sibling of `monitorActions.ts` rather than writing the
store directly from two components, for exactly the reason `monitorActions.ts` gives.

### 5.3 Hardware / direct monitoring

**FSP8 does:** Names it "hardware monitoring" or "Hardware Direct Monitoring" and
recommends it where the interface supports it: "we recommend that you monitor live audio
input via the hardware, rather than through the software. This can help you to avoid
common problems that result from software latency, such as hearing a delay when you record
vocals, or recording off-beat." The trade-off is stated: "when monitoring with Hardware
Direct Monitoring engaged, you do not hear Insert FX on that channel, as you are
monitoring the signal before it is processed in software."

**MotionLab does:** Absent, and necessarily so — a browser has no route to an interface's
hardware mixer. The user can still enable direct monitoring on their interface
independently; MotionLab simply cannot know or control it.

**Gap: DIVERGENT-BY-DESIGN.** No web API exposes interface DSP monitoring. What
MotionLab _should_ do and does not: tell the user this is an option. A line in the record
panel ("If your interface has direct monitoring, use it and leave Monitor off here") would
cost nothing and would prevent the double-monitoring flam. Belongs to Motion Wave's native
shells as a real feature.

### 5.4 Tape-style monitoring (monitoring mutes playback)

**FSP8 does:** Console option **"Audio Track Monitoring Mutes Playback (Tape Style)"** —
"This option mutes playback of any pre-existing audio on Audio Tracks that have monitoring
enabled." That is FSP8's whole answer to the classic input/auto/repro monitoring
selector: rather than a per-track three-way mode, there is one global tape-style switch,
plus the per-track Monitor button, plus (for Instrument tracks) Replace mode which silences
the existing Part while recording over it (§11).

FSP8 therefore documents **no** off/auto/input/repro enum. The modes it does name are the
_latency_ modes in the Monitoring Mode Attributes table (§5.5), which are a different axis
entirely.

**MotionLab does:** Absent. Monitoring adds the live input to the channel; existing clips
on that track keep playing underneath. Grepped for `tape|mutePlayback|autoInput`: nothing.

**Gap: MISSING.** Cheap to add: in `engine.syncGraph`, when
`track.monitoring && prefs.tapeStyle`, gate the clip-scheduling path for that track (the
mute decision is already resolved as pure data in `resolveChannels`, which is the right
place — the comment there says the engine, the meters and the bounce must not disagree
about what is audible, and a tape-style mute must go through the same resolution).

### 5.5 Monitoring modes (the latency axis) and what low-latency monitoring disables

**FSP8 does:** Four modes, tabulated on manual p. 16:

| Type                                 | Direct Input | Necessary conditions                                                                      | Monitoring           | Insert FX                                                     | Send FX      |
| ------------------------------------ | ------------ | ----------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------- | ------------ |
| Standard Software Monitoring         | Disabled     | Large Device Buffer Size, low Process Buffer Size (Dropout Protection)                    | Standard latency     | All function                                                  | All function |
| Native Direct Monitoring             | Enabled      | Process Buffer Size must exceed Device Buffer Size                                        | Native low-latency   | Plug-ins ≤3 ms latency function normally, all others disabled | All function |
| Virtual Instrument Direct Monitoring | Enabled      | Process Buffer Size must exceed Device Buffer Size                                        | Native low-latency   | Plug-ins ≤3 ms function normally, all others disabled         | All function |
| Hardware Direct Monitoring           | Enabled      | "Use Native Direct Monitoring instead of Hardware Direct Monitoring" must be **disabled** | Hardware low-latency | **No Insert FX function**                                     | All function |

Mechanism: playback/processing and input monitoring are split into separate processes with
separate buffers. **Device Buffer Size** (Options/Audio Setup/Audio Device) sets what you
hear when monitoring; **Process Buffer Size** is set indirectly by the Dropout Protection
level (Options/Audio Setup/Processing). "As long as the Process Buffer Size is larger than
the Device Buffer Size you've specified, you have the option to use Native Low-Latency
Monitoring." Dropout Protection "Off" gives the lowest latency at the risk of dropouts. A
**Monitoring Latencies** display shows input round-trip and instrument latency in a
"Standard" and a "Low Latency" column.

Exactly what Native Low-Latency Monitoring disables:

- Any insert plug-in adding **more than 3 ms** of latency is silent in the monitor path
  while the channel is armed for monitoring or recording; such plug-ins "begin functioning
  again when recording/monitoring mode is disengaged." Qualifying plug-ins show a **green**
  power button in the Console rather than blue or gray.
- Unsupported on low-latency channels entirely: **External effects** (External Effect
  Mono/Stereo plug-in), **Analyzer plug-ins**, and **FX Chains that incorporate Splitter
  devices**.

Engaged per output: the **"D"** (Enable Direct Monitoring) button below an output's volume
fader — green for Native, blue for Hardware, dark when off. Channels monitored this way
show a "D" mark at the bottom of their strip. Also: "Enable low latency monitoring for
instruments" is a separate option.

**MotionLab does:** No monitoring-mode concept, no buffer settings, no latency readout.
The browser owns the buffer; `AudioContext` is created with defaults (`engine.ts:318`
logs only the sample rate). Monitoring is always MotionLab's single mode: raw input →
gain → analyser → channel input → the full insert chain → fader → pan → master. So
**inserts always function in the monitor path, with no latency cap** — the equivalent of
FSP8's "Standard Software Monitoring" row, with FSP8's Native low-latency behaviour
unavailable.

Delay compensation does exist for _playback_: `engine.ts:544` computes per-channel PDC
against `MAX_PDC_SEC * ctx.sampleRate` and writes `ch.pdc.delayTime`. It is not
subtracted from, or bypassed for, the monitor path — a monitored track's live input goes
through the same channel and therefore through the same PDC delay as its recorded
material, which is correct for alignment and wrong for latency (it _adds_ to what the
performer hears).

Nothing at all measures round-trip: `src/audio/latencyProbe.ts` exists — worth checking
whether it can supply a "your monitoring latency is ~X ms" readout, which is the single
highest-value piece of this section that a browser can actually deliver.

**Gap: MISSING** for modes; **DIVERGENT-BY-DESIGN** for the buffer controls (a web page
cannot set an ASIO buffer). Realistic partial parity: (1) surface measured round-trip
latency from `latencyProbe` in the record panel; (2) offer a "low-latency monitor" toggle
that bypasses the track's insert chain for the monitored signal only — that is the one
piece of FSP8's native mode a browser can genuinely reproduce, and it is a small change
because `startMonitoring` already chooses its own connection point; (3) do **not** apply
PDC to the monitor tap.

### 5.6 Monitoring an Instrument Track / virtual instrument

**FSP8 does:** "Instrument Tracks record and output musical performance data, not audio.
The virtual or external instrument to which the Instrument Track is routed generates the
audio." With the track's output routed to the instrument, click Monitor and it turns blue;
you should then see the Track meter move and hear the instrument. Instrument Tracks do not
appear in the Console — the instruments do, as Instrument Channels. External instruments
are monitored through an **Aux Channel** (recipe on p. 82, 10 steps, including "Click Save
Default before closing"); running external audio through the Console forces bouncing,
rendering and mixdown to real time.

**MotionLab does:** Instrument and drum tracks are always live: `engine.liveNoteOn/Off`
plays the track's instrument whenever notes arrive, with no monitor button
(`TrackHeader.tsx` renders the monitor button only for `track.type === 'audio'`; so does
`toggleMonitoring`, which returns false for any other type). The instrument's audio is the
track's own channel — there is no separate Instrument Channel. External hardware
instruments are not supported (no MIDI out beyond `src/audio/midi.ts` input handling; no
Aux channel concept — `TrackType` has `bus` and `fx` but no aux-return-for-external-gear).

**Gap: PARTIAL / DIVERGENT-BY-DESIGN.** Always-live instrument monitoring is simpler and
strictly better for a web DAW; the FSP8 Instrument-Channel indirection exists to serve
multi-out plug-ins and external gear, neither of which MotionLab has. External instrument
monitoring via Aux: **MISSING**, and correctly out of scope for the web target.

---

## 6. Input gain / trim, and input metering (pre- or post-fader)

**FSP8 does:** FSP8 deliberately puts input gain **on the hardware**, not in software, and
says why: "If the hardware's input level is set too low, and you increase the level later
in Fender Studio Pro to compensate, you also raise the level of any noise in the signal.
If the level is too high, you can overload the hardware input, causing unpleasant clipping
distortion that cannot be fixed. Therefore, you should set the input gain on your audio
interface as high as possible without overloading the input." And: "as once the distorted
signal is recorded, it cannot be fixed."

Metering: "As long as the input levels are not clipping in your audio interface or on the
Track to which you are recording… you can always adjust the levels of recorded material
after the recording is made. To visually monitor the input levels for any input in Fender
Studio Pro, it is best to view the Input Channels in the Console by clicking on the Inputs
tab in the Console." So the authoritative input meter is the **Input Channel** meter — a
pre-Track, pre-fader meter on the input strip itself. The armed Track's own meter also
moves with live input (§4), and carries a clip indicator at the top of the input-level
meter in the Arrange view. Audio I/O Setup also shows meters beside the software I/O
channels "to help identify a hardware channel."

**MotionLab does:**

- **Trim:** `Track.inputGainDb?: number` — "input trim applied ahead of the insert chain,
  in dB". Applied in `engine.syncGraph` (`engine.ts:683`) as
  `trimGain = 10^(inputGainDb/20) * (phaseInvert ? -1 : 1)` written to `ch.trim.gain`.
  The comment is worth keeping: "Input trim carries polarity: a negative gain IS the
  polarity flip, so the two never need separate nodes and can never fight each other."
  `Track.monoSum` reconfigures the same node's `channelCount`/`channelCountMode`.
  UI: `ChannelStrip.tsx:176` — a draggable `in-trim` readout, double-click resets to 0,
  in an "Input stage" section commented "Trim is the number a compressor downstream
  actually sees". Because the trim node is at the channel head and monitoring joins at
  `ch.input`, **trim applies to the monitored signal**.
  It does **not** apply to the recorded file: the recorder takes the raw stream (§15).
- **Input meter:** `InputMeter` (`RecordControls.tsx:17`) reads `engine.inputLevel(trackId)`
  on the engine frame loop and writes `transform: scaleX(...)` straight into the DOM, with
  a `data-hot` flag above 0.92. `engine.inputLevel` (`engine.ts:1034`) scans the
  **monitor's own analyser**, which sits between the monitor gain and `ch.input` — so it is
  **pre-trim, pre-insert, pre-fader, pre-pan**: a true input meter. It returns 0 for any
  track that is not monitoring, and `InputMeter` is passed `monitoring ? trackId : null`.
- **Channel meter:** `StereoMeter`/`PeakReadout` on the strip read `meterData`, fed from
  `ch.analyser`, which `buildChannel` places **after the panner**
  (`input → trim → inserts → mute → volume → pan → analyser → destination`,
  `engine.ts:945–959`). So the channel meter is **post-fader and post-pan**.
- **Clip indicator:** `meterData` carries a `clipped` flag with a `resetClipIndicators`
  (`engine.ts:2147`) — but only on the post-fader channel meter, not on the input meter.

**Gap: PARTIAL.**

- Software input trim: **richer than FSP8** (which has no per-track input trim at all,
  by design). Not a gap; worth noting the divergence and its reason — a browser user often
  has no hardware gain control, so a software trim is a necessity rather than a luxury.
- Pre-fader input metering: **PARITY** — and the tap point is right.
- Input metering without monitoring: **MISSING** (see §4).
- Input clip indicator: **MISSING** on the input meter. Given FSP8's emphasis that input
  clipping "cannot be fixed", and given that MotionLab already detects the analogous
  problem at the other end (`peaksAreSilent` → "Recorded, but the take is silent — check
  the input level"), a matching "the take clipped" report at commit time would be a
  natural, cheap counterpart.
- Post-fader channel meter: **PARITY** with normal DAW convention; FSP8 does not specify.

---

## 7. Cue mixes and the monitor mix

**FSP8 does:** Create an extra Stereo Output Channel in Session Setup/Audio I/O Setup →
Outputs, tick its **Cue Mix** checkbox; "You can create as many cue mixes as your audio
interface has available stereo outputs." Each Channel then shows a **Cue Mix object** — an
Activate button, horizontal level and pan faders, and a **Lock to Channel** button. By
default level and pan are locked to the channel's own, so each cue mix starts identical to
the main mix; changing either unlocks both. Deactivating a Channel's Cue Mix object removes
it from that mix. Double-clicking opens a larger pop-up; left/right arrows walk it across
the console. **"Cue mix mute follows channel"** must be engaged in preferences to use Cue
Mixes for FX Channels. An **External Cue Mix** mode (Outputs tab → "Use External Cue Mix
System") starts every cue folder empty and lets each header pick a destination output, for
hardware cue systems. **The Main output always acts as a Cue Mix.**

The chapter's "Creating a Good Monitor Mix" advice: build the performer a mix that sounds
like a finished record; use Sends and FX Channels to add reverb to the cue; "When adding
time-based effects, such as reverb or delay, you generally don't have to be concerned about
plug-in delay and latency… A few milliseconds of processing delay on a reverb will probably
not be audible."

**MotionLab does:** `ProjectData.cueMixes?: CueMix[]` — "headphone mixes: a separate balance
per performer, off the same channels" (`types.ts`), with per-entry "take the level and pan
from the main mix instead of the stored ones" (`types.ts:369`) — the lock-to-channel idea.
`engine.monitorCueId` selects which cue mix the main output is auditioning
(`engine.ts:200`, "cue mix being monitored on the main output, or null for the main mix"),
resolved through `resolveChannels(p, this.monitorCueId)` so the mute/solo/VCA/folder maths
is done once as pure data. `Track.soloSafe` exists for "reverb returns, talkback", and
`types.ts:384` notes "a cue is a monitor path: solo on the main mix should not silence it".

**Gap: PARTIAL.** The data model and the solo semantics are right and match FSP8's design.
What is **MISSING** is the hardware reality — a browser has one output device, so a cue mix
can only be _auditioned_ on the main output, never sent to a second physical pair
simultaneously with the main mix. That is **DIVERGENT-BY-DESIGN** and cannot be fixed on
the web; it is a genuine Motion Wave native-shell requirement. Also **MISSING**: cue-mix
sends on FX channels and the external-cue-system mode.

---

## 8. Activating recording: manual, Precount, Preroll, Auto Punch, Postroll

### 8.1 Manual

**FSP8 does:** "Recording starts at the current playback-cursor position and continues
until you manually stop recording." Record button turns red, cursor scrolls, "new Events
are recorded to any record-enabled Tracks."

**MotionLab does:** `recording.start()` → `captureWindow(project, engine.getPositionBeats())`
→ with no punch and no pre-roll: `rollBeat = playheadBeat`, `window = null` →
`engine.play(rollBeat)` → `recorder.start(stream)`. Ends only via the record button / R /
Esc (§1.3).

**Gap: PARITY** except for the stop path (§1.3) and single-track (§1.7).

### 8.2 Precount (count-in)

**FSP8 does:** "When Precount is enabled, pressing record shows a countdown in the record
button. The countdown represents the number of beats remaining before recording starts."
Set the bar count in the Metronome Setup menu's Bars field, or in the Record Panel. Enable
by clicking Precount in the Transport, from the Metronome context menu, or **[Shift]+[C]**.
"In Precount mode, the Metronome clicks for the specified number of bars. The number of
beats remaining before recording starts is displayed in the Record button in the Transport."
Precount and Preroll may be enabled at the same time, and either may be enabled while
Autopunch is active. Related: **Click Only in Precount** in the Metronome Setup —
disengaged by default — gives "a traditional count-in during the Precount bars" with no
click beyond them.

**MotionLab does:** `ProjectData.countIn?: number`, validated `clampNum(raw.countIn, 0, 8, 1)`
(`projectRepo.ts:650`) — **default 1 bar**. `setCountInBars` / `getCountInBars`
(`recordingController.ts:38–48`) clamp to 0..8 and read/write the **project**, with a
comment recording the bug that motivated it: "It was both: a field the transport wrote and
a module-level number the recorder read, so changing the count-in from the transport changed
nothing about a recording. One of them had to go, and the one that survives a save is the
project's."

`runCountIn()` (`recordingController.ts:250`): `bpb = beatsPerBar(p.timeSig)`,
`totalBeats = round(bpb * bars)`, `beatMs = (60 / p.bpm) * 1000`, sets
`phase: 'countIn'` and `countInBeatsLeft`, fires the first click immediately, then a
`setInterval` per beat calling `engine.playMetronomeClick(left % bpb === 0)` — accent on
the downbeat. Resolves false if cancelled.

UI: the record button renders the remaining beat count in place of the record dot while
`phase === 'countIn'` (`RecordControls.tsx` `count-in-num`) — exactly FSP8's "displayed in
the Record button". The metronome button carries a `t-badge` with the bar count; right-click
on it cycles `countIn` 0→4; the transport overflow menu has "Count-in: N bars"; the record
panel's own select offers **only Off / 1 bar / 2 bars** (`RecordControls.tsx`
`data-testid="count-in-bars"`).

`RecordingBanner` shows "Count-in — N" with a Cancel button. Pressing record/stop during
count-in calls `recording.stop()` which routes to `cancel()` for the `countIn` phase.

**Gap: PARTIAL.**

- Count-in exists, is per-project, counts beats, accents the downbeat, shows in the record
  button: **PARITY**.
- Three inconsistent ranges for one value — schema 0..8, transport menu 0..4, record panel
  0..2. Worth unifying.
- **Timing is wall-clock, not audio-clock.** `setInterval` at `(60/bpm)*1000` ms drifts
  under load and ignores the tempo map entirely (`p.bpm` is the beat-0 tempo, and
  `beatsPerBar(p.timeSig)` is the beat-0 signature — a count-in into a 6/8 section or a
  tempo ramp counts the wrong thing). Everything else in the app resolves tempo through
  `tempoMapOf` / `beatsPerBarAt`; the count-in is the one place that does not.
  Compare `captureWindow`, three functions above it, which correctly uses
  `beatsPerBarAt(map, startBeat - 1e-6)` for the pre-roll. This is a real defect, not a
  parity nicety.
- **Click Only in Precount:** **MISSING**. MotionLab's `clickRecordOnly` is the adjacent
  but different switch (§9).

### 8.3 Preroll

**FSP8 does:** "When you click Record with Preroll enabled, Fender Studio Pro starts
playback behind where the cursor is placed, by a number of bars specified by the Bars
parameter. When playback passes the cursor position, recording starts." Keyboard **[O]**.
Bars typed into a box in the Record Panel. Distinct from Precount: Preroll plays _the
Session_; Precount plays _clicks_.

**MotionLab does:** `ProjectData.preRoll?: number` — "pre-roll in bars before the punch
point", `clampNum(raw.preRoll, 0, 8, 0)` — **default 0**. Handled in `captureWindow`
(`recordingController.ts:82`):

```
startBeat    = punch enabled && punch.end > punch.start ? punch.start : playheadBeat
preRollBeats = clamp(preRoll, 0, 8) * beatsPerBarAt(map, max(0, startBeat - 1e-6))
rollBeat     = max(0, startBeat - preRollBeats)
window       = punch ? {punch.start, punch.end}
             : preRollBeats > 0 ? {startBeat, endBeat: +Infinity}
             : null
```

with the comment: "Only punch fixes an end. A pre-roll moves the start of the roll, not the
start of the clip, so it needs no window of its own." The transport rolls from `rollBeat`;
capture begins at `rollBeat` too; `commitTake` then sets
`clipStart = max(startBeat, window.startBeat)` and
`offsetSec = projectBeatRangeSec(project, startBeat, clipStart - startBeat)` so **the
run-up is kept inside the media and the clip simply starts past it** —
`addRecordedClip`'s comment: "A pre-roll take carries the run-up in its media and starts
past it. The audio is kept rather than cut, so the edge can be dragged back."

MIDI does the same, with a nicer rule for notes that straddle the punch point
(`midiRecorder.stop`): "A note that starts in the run-up is not part of the take, but one
that is still sounding at the punch point is: it is trimmed to the window rather than
dropped, which is what a player expects when they come in early and hold through."

The docstring on `captureWindow` records why it exists: "Punch and pre-roll were both
stored on the project and read by nobody: the transport's punch button toggled a flag that
changed nothing about a recording."

**Gap: PARITY**, and the run-up-kept-in-media behaviour is better than the manual describes.
UI is thin: pre-roll is only reachable from the transport overflow menu ("Pre-roll: N bars",
cycling 0→4), with no keyboard shortcut and no record panel field.

### 8.4 Auto Punch (punch in/out)

**FSP8 does:** "Auto Punch lets you set 'in' and 'out' points within Fender Studio Pro's
timeline according to the loop range. With Auto Punch enabled, recording will automatically
start at the beginning of your loop range and stop at the end point." Recipe: set the Left
Locator where recording should begin, the Right Locator where it should stop, click Auto
Punch in the Transport **or press [I]**, arm tracks, begin recording anywhere before the
Left Locator. "Recording automatically stops at the Right Locator position. However,
playback continues beyond the Right Locator position until you manually stop it."
Crossfades: "If you use the Auto Punch feature… or if you punch in manually, the newly
recorded audio is automatically crossfaded at its edges with the existing Audio Event, so
the transition between the old and new audio is not audible. The crossfade time is very
small and not audible; however, you can edit the crossfade manually."

**MotionLab does:** `ProjectData.punch?: { enabled, start, end }`. `btn-punch` in the
transport toggles `enabled`, defaulting `start`/`end` from the loop region; the overflow
menu has "Set the punch range from the loop" (disabled unless `loop.end > loop.start`).
The punch-in is implemented by `captureWindow` (above) — the roll starts at
`punch.start - preRoll`, the clip starts at `punch.start`. The punch-out is
`armPunchOut()` (`recordingController.ts:543`): converts the window to seconds via
`projectBeatRangeSec` (tempo-map aware) and sets a `setTimeout` that calls `this.stop()`
if still recording. The comment is honest about the slop: "The timer only has to be roughly
right: what the clip covers is decided from beats when the take is committed, so a few
milliseconds of slop here costs nothing but a few milliseconds of extra captured audio."
`commitTake` then clamps: `wanted = punchWindow.endBeat - clipStart`,
`lengthBeats = max(0.25, min(available, wanted))`.

**Gap: PARTIAL.**

- Punch region, punch-in, punch-out, tempo-aware conversion, extra audio retained in the
  media: **PARITY** (and cleaner than a timer alone would be).
- **DIVERGENT:** at the punch-out MotionLab calls `recording.stop()`, which calls
  `engine.stop()` — **the transport stops too**. FSP8 explicitly keeps playing past the
  Right Locator until the user stops it, which is what makes an auto-punch usable for
  checking the drop-out in context. This is a one-line behavioural fix (drop out of record,
  leave the transport rolling) and it interacts directly with §1.3: once transport-stop and
  record-stop are properly separated, punch-out should stop only the recorder.
- **MISSING:** the automatic crossfade with the underlying Event. MotionLab's punch take is
  a new clip laid over the existing one; `Clip.fadeIn`/`fadeOut` and `setClipFades` exist,
  so applying a short default crossfade at punch commit is straightforward. Without it, a
  punch-in has an audible edge — precisely the problem FSP8 calls out.
- **MISSING:** the [I] shortcut and any punch-locator UI separate from the loop.

### 8.5 Postroll

**FSP8 does:** "When Postroll is enabled, Fender Studio Pro ends playback a set amount of
bars after recording. This provides some context of the recorded material, helping you
assess the performance and make adjustments before recording another take. **Auto Punch
must be enabled for Postroll to be available.**" Bars typed into the Record Panel.

**MotionLab does:** Absent. Grepped for `postRoll|postroll`: no hits anywhere in `src/`.

**Gap: MISSING.** Directly follows from the punch-out fix above: once the transport keeps
rolling past the punch-out, `postRoll` bars is simply when to stop it.

### 8.6 The Record Panel

**FSP8 does:** A dedicated panel, opened from the View menu or **[Shift]+[Alt]+[R]**, and
also reachable next to the Transport Controls. Holds: Record Mode (Replace/Overdub), Record
Takes to Layers, Input Quantize, Record Takes / Record Mix, Undo Last Loop / Undo All Loops,
Note Repeat (+ its options window), Note Erase, and the typed Precount / Pre-roll / Post-roll
bar fields and Auto Punch.

**MotionLab does:** No single record panel. The equivalent controls are scattered:
count-in in `TrackInputControls`, pre-roll and punch in the transport overflow menu, click
level and click-record-only in the same menu, nothing at all for record mode / takes /
input quantize (none of which exist — §10, §11).

**Gap: PARTIAL.** The _settings_ that exist are all reachable; the organising surface is
**MISSING**, and it is the natural home for most of the gaps in §8, §10 and §11. Worth
proposing as one piece of work rather than a dozen scattered controls.

---

## 9. Metronome

**FSP8 does:**

_Global on/off._ "In the Transport, the Metronome button is to the left of the Master
Volume fader and meter… Click on the Metronome button, **or press [C]**, to globally engage
and disengage the metronome. **The metronome is globally disengaged by default.**"

_Per-output._ "the metronome can be engaged and disengaged both globally and for each
hardware output in the Console, including the Main Out and any Sub Outs. The Output
Channels in the Console also feature Metronome buttons and level controls above the volume
fader."

_Setup window._ Right-click or long-press the Metronome button for a context menu carrying
the Metronome Setup window, Precount enable, and a Click/Drum metronome toggle. In Setup you
choose "an individual sample and volume level for **Beats, Accents, and Subdivisions**.
Accents play on the downbeat, or first beat, of each new bar. Subdivisions play in the space
between each Beat. You can choose from **seventeen default samples** for each, including
Click, Clave, Rim Shot, and Tambourine. **By default, the Accent Level setting is higher
than the Beat Level setting**, as most musicians like to have the downbeat of each bar
emphasized." Presets are saved/recalled with **[Store]** and **[Load]**.

_Time signature and beat duration._ Beat duration divides a measure into "musically
meaningful divisions"; four options — **half, quarter, eighth, sixteenth** — chosen when
editing/inserting a time signature, or from the beat-duration indicator beside the tempo in
the transport bar. "By default, the beat duration is set to a quarter note for simple time
signatures, and a dotted quarter note for compound time signatures." Compound signatures
(12/8) can be felt as 12 eighths, 6 quarters or 4 dotted quarters; click the dot beside the
beat duration to make it dotted. Subdivision volume has its own slider in Metronome Setup.

_When it plays._ **Click in Playback** (Metronome Setup) — "allows you to enable/disable
the Metronome during playback, as opposed to while recording. Disabling Click in Play allows
you to leave the Metronome engaged in the Transport at all times, so that if you are
recording, you hear a click, but if you are playing back, you do not hear the click.
**Click in Play is engaged by default.**" Plus **Click Only in Precount** (§8.2),
**disengaged by default**.

_Render Metronome._ A [Render] button in the top-right of Metronome Setup creates an Audio
Track of the metronome, either the full Session length or a looped range within it (4, 8 or
16 bars).

_Drum Metronome._ An alternative to the click, "**75 pattern presets** from various
styles/genres, combined with matching drum samples. Users can choose between normal, double,
or half tempo playback." Enabled from Metronome Setup or the context menu. Also renderable.
Any drum pattern can be converted to an editable Instrument Pattern Part ("Create Music Part
For …", which creates a new Instrument Track with the sampler instrument preloaded), and
conversely a Pattern Part can become a drum click ("Instrument Parts > Create Drum Click",
with limitations: all loop samples must be one-shot and untransposed). With the transport
stopped, patterns preview from a play icon at the right of each pattern row, using the time
signature at the current transport position.

**MotionLab does:**

_Global on/off._ `ProjectData.metronome: boolean`, validated `raw.metronome === true`
(`projectRepo.ts:622`) — **off by default**, matching FSP8. `btn-metronome` in the
transport; also in the overflow menu. **No [C] shortcut** (grepped `shortcuts.ts`:
absent). Right-clicking the metronome button cycles the count-in instead of opening a
setup menu.

_Scheduling._ `src/audio/scheduler.ts:94–104`: when `project.metronome`, one
`{kind:'metronome', beat, accent}` event per beat, "The click counts the signature's
denominator, not quarter notes: 6/8 clicks six times a bar, 3/4 three times, and the
downbeat is accented." Dispatched via `deps.scheduleMetronome(when, accent)` →
`engine.scheduleTransportClick`.

_Sound._ `engine.scheduleMetronomeClick` (`engine.ts:1791`): a single square oscillator,
**1760 Hz accented / 1175 Hz normal**, gain ramped to 0.5/0.32 over 2 ms then decayed with
`setTargetAtTime(0, when+0.015, 0.012)`, stopped at `when+0.12`. Accent is louder than beat
— matching FSP8's default relationship. **One sound, no samples, no subdivisions.**

_Routing._ `metroGain` joins **after** the master analyser, straight at the destination
(`engine.ts:396`: "The click joins AFTER the analyser, straight at the destination: it is a
cue, never part of the mix"). So the click is excluded from meters and from the bounce.
Level: `clickGain(project)` = `clamp(project.clickLevel, 0, 2)` default **0.7**
(`engine.ts:72`), stepped by the overflow menu through `[0, 0.25, 0.5, 0.7, 1, 1.4]`.
The menu's comment argues the level belongs in the song, not in preferences: "it is saved
in the song, it is decided while tracking, and it is a different number for a loud drummer
than for a quiet vocal."

_When it plays._ `clickSounds(p, phase)` (`engine.ts:85`): with
`clickRecordOnly !== true` (the default) the click always sounds; with it on, only when
`phase === 'recording' || 'countIn'`. This is exactly FSP8's Click-in-Play, with the same
default (on). Toggled by the overflow menu ("Click: while recording only" /
"Click: whenever it is on", `data-testid="menu-click-record-only"`). The count-in
deliberately bypasses this test — `playMetronomeClick` is called directly, commented
"a count-in with no click is not a count-in."

_Loop wrap._ `retireSoundingAt` skips metronome handles (`engine.ts:1311`: "The metronome
is left alone: its clicks are scheduled one at a time").

_Time signature._ `timeSig` is a transport dropdown offering 2/4 3/4 4/4 5/4 6/4 7/4 5/8
6/8 7/8 9/8 12/8; `tempoMap` supports signature changes over time and the scheduler follows
it. There is no beat-duration/dotted-beat concept.

**Gap: PARTIAL.**

- On/off, default-off, per-project, accented downbeat, signature-following, click excluded
  from the mix, level in the project, click-in-play with matching default: **PARITY**, and
  several of these are better reasoned than the manual.
- **MISSING:** [C] shortcut; a Metronome Setup window; selectable sounds (17 in FSP8, 1
  here); separate Beat/Accent/Subdivision levels; **subdivision clicks at all**; beat
  duration (half/quarter/eighth/sixteenth) and the dotted-beat control for compound
  signatures; metronome presets (Store/Load); per-output metronome enable and level;
  Render Metronome; the entire Drum Metronome feature (75 patterns, tempo multipliers,
  pattern↔click conversion).
- Priority read: subdivisions and a couple of alternative click sounds are the two that
  musicians actually miss. The Drum Metronome is a large feature and a low-priority one;
  note that MotionLab already has a drum sampler and a pattern model, so it would be
  buildable later without new engine work.

---

## 10. Loop recording, takes, layers, comping

**FSP8 does:**

_Loop recording (audio)._ Set Left/Right Locators, engage Loop ([NumPad /]), activate
recording manually or via Pre-Roll or Auto Punch; "When the playback cursor reaches the
Right Locator position, it loops back to the Left Locator Position. Recording continues
until you manually stop it." Result: "**multiple Takes are created. These Takes represent
each recorded pass over the looped region.** If **Record Takes to Layers** is engaged in
the Record panel ([Shift]+[Alt]+[R]), the takes are automatically placed in separate layers
which are expanded when recording is stopped."

_Selecting takes._ "When there are multiple Takes available for an Audio Event, the Take
icon appears in the lower left corner of the Event… **By default, the last recorded Take is
selected.** To select any other take, [Right]/[Ctrl]-click on the Audio Event to expose a
list of Takes." Crucially: "**Takes are edited as a single Audio Event, so sizing or
splicing any Take splices all of the Takes contained in the Audio Event.**" Which enables
the comping idiom: "if you recorded three Takes for a vocal verse, you could split that
Audio Event in between each vocal phrase, and then, for each phrase, select the best of the
three Takes."

_Unpack Takes._ Right-click an Event → Unpack Takes → **to Tracks** (each Take at the right
time on its own new Track; "the settings of the originating Track are not duplicated"),
**to New Layers**, or **to Existing Layers**.

_Track Layers._ "both audio and instrument Tracks have optional layers that can be used to
record multiple different ideas to a single Track… The new layer is effectively like having
a whole new Track without duplicating Inserts, Sends, and I/O setup." Add Layer / Duplicate
Layer from the track context menu or the Inspector's Layer selection box. Remove by
selecting the Layer at the Track header then Remove Layer; multi-select with
[Shift]+[Left]-click then Remove Selected Layers — "you cannot group select (or group
Remove) multiple layers across multiple Tracks. One track at a time." Unpack Layers to
Tracks in three clicks, or Option/Alt-drag a Layer to convert it. Switching: the arrow
between Track name and layer name (then the 4-way arrow keys), the Expand Layers button's
Activate Layer buttons ("This swaps the two layers and keeps the previous Track contents as
an alternate layer"), or the Inspector's Layers field. Layers have their own Solo,
Activate, Duplicate and Remove. **Layers Follow Events** in the Inspector makes layers track
the parent Event when it is moved or duplicated. Events dragged into a layer cannot be moved
or copied out again. Rename an Event in a layer to label a take ("great", "not good").

_Comping entry points_ (Editing chapter, p. 131): with Record Takes To Layers engaged,
"all subsequent recordings are placed on layers, with one layer per take, and the layers are
shown as soon as recording is stopped. **The last recorded take is placed on the Track
automatically. If only one take is recorded, no Layers will be created.**" The Listen tool
auditions takes; with the Arrow tool, hovering a layer switches to a comping cursor; there
is also comping with the Range Tool and keyboard navigation.

_Set/Shift Loop._ `Set Loop Start` / `Set Loop End` (locators to the cursor) and
`Shift Loop` / `Shift Loop Backwards` (move the range by its own length) exist in Keyboard
Shortcuts with **no default key assigned**.

**MotionLab does:**

_Loop recording:_ **not implemented, and unguarded.** `recordingController` never reads
`project.loop`; grepping the file for `loop` returns nothing. The transport does honour the
loop while recording (the scheduler wraps regardless of `phase`), so what actually happens
is: the transport wraps back to `loop.start`, the recorder keeps capturing linearly,
`captureStartBeat` stays at the first pass's start, and at stop the take is committed as
**one clip beginning at the first pass and running for the full wall-clock duration of every
pass** — i.e. it runs straight over `loop.end` and past everything after it, out of sync
with what was heard from lap 2 onward. No takes are produced. This is worth treating as a
bug rather than a missing feature: recording with loop enabled silently produces a wrong
result, and either loop should be honoured properly or record should temporarily suspend it
and say so.

_Takes:_ the **data model is present and good**. `Clip.takes?: Take[]` ("alternative
takes; when present, `comp` decides what sounds"), `Clip.comp?: CompSegment[]` ("ordered
comp segments over the takes"), `Clip.takesOpen`, `Clip.soloTakeId`; `Take` carries
`offsetSec` ("seconds into the take's media that aligns with the clip's start") and a
`muted` flag ("muted takes stay listed but are skipped by solo-audition"). Store actions:
`packTakes(ids)`, `promoteTake`, `setCompRange` ("Assign a range of the comp to a take
(swipe comping)"), `deleteTake`, `moveTake`, `setTakeMuted`, `setSoloTake`, `setClipView`.
UI: `src/components/arrangement/TakeLanes.tsx`.

But **nothing creates takes automatically.** `packTakes` requires "two or more audio clips
on the same track" (`src/app/audioEditActions.ts:135`) and is a manual, user-invoked
operation. Grepped the whole tree for any recording-time take creation
(`takes: [`, `addTake`, `takes.push`): no hits. So the comping system exists but the
recording flow never feeds it.

_Layers:_ absent as a concept. There is no `Track.layers`, no per-track lane stack beyond
take lanes and automation lanes. Take lanes under a clip are the nearest analogue and are
narrower (they belong to one clip, not to the track).

**Gap:**

- Loop recording: **MISSING**, and currently **produces an incorrect take** rather than
  simply doing nothing — the highest-severity item in this section.
- Takes as a comping model: **PARITY** in substance (swipe comping, per-take offset, mute,
  solo-audition, promote) and in some ways cleaner than FSP8's "splice the Event, pick a
  take per splice".
- Takes from recording: **MISSING**. The obvious shape given the existing model: each loop
  pass (or each successive take over the same range on the same track) appends a `Take` to
  the clip rather than creating a new overlapping clip, with the newest promoted — matching
  FSP8's "the last recorded take is selected/placed on the Track automatically."
- Record Takes to Layers: **MISSING** (no layers).
- Unpack Takes to Tracks / Layers: **MISSING**.
- Track Layers as a whole: **MISSING**. Given take lanes already exist, layers may be a
  DIVERGENT-BY-DESIGN decision worth recording in an ADR rather than a gap to close —
  FSP8 has both because its takes are per-Event and its layers are per-Track; MotionLab
  could reasonably choose one.
- Set/Shift Loop commands: **MISSING**.

---

## 11. Instrument track recording modes

**FSP8 does:** All in the Record Panel ([Shift]+[Alt]+[R]).

_Replace / Overdub._ "When in the **Replace** recording mode, recording over any existing
Instrument Part results in the new material being recorded to a new Event, which replaces
that portion of the original Event. **While recording, you do not hear the previously
recorded Event playing back**, as the purpose of this mode is to replace the existing
material. When Replace is disabled, you are in **Overdub** recording mode. In this mode…
the newly recorded material [is] overdubbed, or added to, the existing material. While
recording, you hear the previously recorded Event playing, along with the material
currently being recorded, assuming that you are monitoring the Instrument Track."

_Takes to Layers._ "move[s] the contents of each Take created while recording in loop mode
to its own Layer below the current Track. If you engage this option while **Record Takes**
is enabled, the notes from each run-through of the loop are moved to their own new Layer.
Engaged while **Record Mix** is enabled, a new Layer is created each time recording is
started and stopped, containing all notes from the entirety of the most recent recording
pass."

_Input Quantize._ "Engage Input Quantize to snap recorded notes to the rhythmic value set by
the Quantize parameter. When recording parts that are destined to be heavily quantized (such
as synth arpeggios or drum-machine-style beats), this saves you the step of later Quantizing
the contents of your loop." (Elsewhere, p. 133: input quantization can be undone if you want
the performance as played.)

_Loop record modes._ "If Loop is engaged in the Transport while recording, the recording
mode changes either to **Loop Record Takes** or **Loop Record Mix**… functionally similar to
the regular Record Mode Overdub and Record Mode Replace. When Loop Record Takes is selected,
each pass through the looped region is recorded to a new Take within a single new Instrument
Part… **Only one Take can be selected at a time for any Instrument Part.** When Loop Record
Mix is selected, each pass through the looped region is added to the existing material
within a single new Instrument Part. For instance, if you loop a four-bar region to record a
new drum part, this would allow you to play one piece of the drum kit during each pass."

_Undo Last Loop / Undo All Loops._ "The standard Fender Studio Pro Undo/Redo functions do
not apply to individual record passes in Loop mode. Instead, use these two special Undo
buttons… Undo Last Loop to erase only the notes added in the most recent run-through of the
loop. Click Undo All Loops to erase all notes in the current loop."

_Note Repeat._ "any notes played retrigger according to the current Rate setting… set to QT
(to follow the current quantize value) or to any specific rhythmic value." Options window
(wrench icon, or via Key Remote): **Active**, **Rate**, **Gate** (note length), **Quantize**
(snap repeats to the grid; disable for free play), **Aftertouch** (key or poly pressure
controls velocity of repeats), **Single Mode** (a range of keys plays one note at different
rates; **Base** moves the octave, **Pitch** changes the note), **Key Remote** (MIDI control
of rate, active state, Note Erase, gate, Single Mode, quantize and aftertouch; **Base** and
**Range** set the control key range). Cannot be combined with Note Erase.

_Note Erase._ "any notes played during the current recording pass erase existing notes of
the same note value… It is only possible to engage this mode if Record Mix is engaged and
Note Repeat is disengaged."

_Rendering Note FX._ Event/Render Instrument Tracks, or right-click a Part →
Instrument Parts/Render Instrument Tracks, makes Note FX processing (plus Inspector
transposition and velocity changes) permanent in the note data.

**MotionLab does:** **None of it.** `midiRecorder.stop()` unconditionally creates a **new**
MIDI clip (`addMidiClip` + `addNotes`) at `clipStart`; existing clips underneath are left
alone. So the effective mode is neither Replace nor Overdub — it is "always create a new
overlapping clip", and both the old and the new part will sound on playback. `MidiRecorder`
has a `grid` field ("Quantise on commit; 0 keeps the performance exactly as played") but
`recordingController.startMidi` always calls
`midiRecorder.start(track.id, startBeat, 0, window)` — **input quantize is wired but
hard-coded to off with no UI**. Grepped for
`noteRepeat|noteErase|overdub|replaceMode|inputQuantize`: absent.

One good detail worth preserving: notes still held at stop are closed at the stop point
rather than dropped — "a musician who was holding a chord when they hit stop played that
chord." And the clip is rounded out to a whole bar: "a take that ends mid-bar is a clip
whose edge is in a musically meaningless place."

**Gap: MISSING** for Replace/Overdub, Takes to Layers, Loop Record Takes/Mix, Undo Last
Loop / Undo All Loops, Note Repeat (and its whole options set), Note Erase, and Render Note
FX. **PARTIAL** for Input Quantize (the plumbing exists; the setting and the UI do not —
this is the cheapest item in the section, roughly a `ProjectData.inputQuantize` field, a
record-panel selector, and passing it as the third argument).

Priority read: Replace/Overdub is the one that matters. Today, recording a second MIDI pass
over an existing part produces two stacked clips both sounding — a wrong-by-default result,
in the same class as the loop-recording problem in §10.

---

## 12. Step Record

**FSP8 does:** "Rather than playing in real time, or drawing in notes with the Paint tool,
you can simply specify a rhythmic value and press keys on your MIDI controller to enter
notes and chords." Reached by selecting an Instrument Track, opening the Editor ([Edit]),
then the **[Step]** button in the Editor toolbar. Controls:

- **Enable** — enter/exit Step Record mode.
- **Follow Q** — link Step Length to the current Quantize setting.
- **Step Length** — whole notes to 64th notes, in **Straight, Triplet (3 in the space of 2),
  Quintuplet (5 in 4), Septuplet (7 in 8), or Dotted (+50%)** groupings.
- **Back** — erase the most recent note or chord and move the cursor back to where it
  started; repeatable.
- **Rest** — move the cursor forward by one Step Length, creating a rest.

Workflow: place the cursor, open the toolbar, Enable, choose a length (changeable at any
time), play a note — a note of that length is created at the cursor; on release the cursor
advances. Hold several notes and release together for a chord. Enable again to exit.

**MotionLab does:** Absent. Grepped `src/` for `stepRecord|stepRecording|stepLength`:
no hits. `src/components/pianoroll/` has drawing/paint tools and `src/model/midiTools.ts`
has `quantizeNotes`, but no step-entry mode.

**Gap: MISSING.** Self-contained and reasonably cheap given the piano roll and
`heldNotes` already exist — the whole feature is a cursor, a length selector, and a
note-on/note-off handler that writes to the selected clip instead of the synth.

---

## 13. Retrospective recording

**FSP8 does:** "Retrospective Recording captures every note you play on your MIDI keyboard
or controller… even without hitting Record. Even when the transport is stopped! It works
invisibly in the background on a track-by-track basis. Controller activity is captured as
well. The moment something brilliant happens, all you have to do is press
_*[Shift]+[NumPad*]_* and the last performance will turn into an Instrument Part on the
respective Track."

**Enabled by default**; disable at Studio Pro/Options/Advanced/MIDI/"Enable retrospective
recording". The Advanced/MIDI page describes it as "all incoming MIDI data is captured for
each Track, even when not recording."

Mechanics, precisely:

- "Fender Studio Pro maintains **an independent buffer for each Track**. When a Track is
  **record-armed or monitored**, Retrospective Recording captures all notes, controller and
  parameter changes, whether the transport is playing or stopped."
- **Transport playing (not recording):** "Captured events are stored with the correct
  Session location and **Input Quantize is applied** (if that feature is active)."
- **Transport stopped:** "Captured events are stored with **times relative to each other**."
- "the buffer does not combine the events that are captured while the transport is playing
  with events that are captured while the transport is stopped. **As soon as an event is
  received in one mode, the other mode will always delete the contents of the buffer.**"
- On recall: play-captured events land at their correct Session position; stop-captured
  events are "placed on the Track starting with the first event at the playback cursor
  position."
- "Recalled events are added to the Track using the same options as the standard recording
  process (Replace, Takes to Layers, Record Takes, Record Mix, etc.)."
- Three recall routes: [Shift]+[NumPad*]; right-click the Track control area →
  "Recall Retrospective Recording"; the Retrospective Recording button in the Inspector
  ("When this button is lit, that means MIDI data was captured on the current Track while
  you weren't recording (i.e., during playback or with the Transport stopped)").
- Undo: recall is undoable and redoable; undoing "removes the events from the Track again
  and **places them back in the buffer**", so you can change the record mode and recall
  again. "**if the buffer receives any new event after 'undo' the buffer is deleted.**"

Related: **Record Offset** (Options/Advanced/MIDI) — "a value, in milliseconds, by which
any recorded musical performance should be offset in the arrangement, thereby compensating
for device/driver latency."

**MotionLab does:** Absent. Grepped `src/` for `retrospective|Retrospective`: nothing.
`src/audio/heldNotes.ts` tracks currently-held notes across the on-screen keyboard, the
computer keyboard and MIDI, but only for voice management and the keyboard display — it
keeps no history. `midiRecorder` only captures between `start()` and `stop()`. No record
offset setting either (grepped `recordOffset|latencyOffset`: absent).

**Gap: MISSING** (both retrospective recording and record offset).

Worth flagging as unusually high value-per-line for this codebase: every note already
passes through `engine.liveNoteOn` / `liveNoteOff`, which is exactly where `midiRecorder`
hooks in and exactly the hook the module docstring praises ("all three are recorded by one
hook instead of three that can drift"). A bounded ring buffer on the same hook, plus the
play/stopped-mode invalidation rule above, plus one command, would deliver the whole
feature. The FSP8 rule that the two capture modes never mix is the non-obvious part and is
worth copying exactly — it is what stops a recall from producing a nonsense timeline.

---

## 14. Audio recording format, and where files go

**FSP8 does:** "Fender Studio Pro records in the **Broadcast Wave** file format. This is the
only format supported, as it is the most widely used format, and it contains **timestamps
that mark when recordings start within a Session**. When recorded Broadcast Wave audio files
get bigger than **4 GB**, the **RF64** file format is automatically used as the standard file
format." Recommended file systems: **NTFS** on Windows, **APFS** on macOS.

Bit depth and sample rate are Session properties, set at Session creation:

- **Resolution: 16, 24, 32, or 64-bit (floating point)**; "The most common resolution
  setting in professional recording is 24-bit."
- **Sample rate:** defaults to the interface's current rate, supported "up to 768 kHz";
  "Fender Studio Pro is capable of recording at any sample rate your hardware audio device
  offers." Mismatched rates cause resampling of all audio files, "which can cause
  performance problems and should be avoided."

Also documented: "Remaining Record Time" view, computed from track count, sampling rate and
available disk space.

**MotionLab does:**

- **Container/codec is negotiated, not chosen.** `pickMimeType()` (`recorder.ts:36`) walks
  `['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus',
'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac']` through
  `MediaRecorder.isTypeSupported`, falling back to the browser default. The module docstring
  explains: "Its container differs per browser (Opus/WebM on Chromium and Firefox, AAC/MP4
  on Safari), so the format is negotiated below and reported in diagnostics rather than
  assumed." **So takes are lossy-compressed, and the codec depends on the browser.**
- **Sample rate** is the `AudioContext`'s (logged at creation, `engine.ts:318`; published
  to `transportStore.sampleRate`); on commit the _decoded_ rate is stored as
  `mediaRef.sampleRate`. Not user-selectable. **Bit depth** is not a concept — Web Audio is
  float32 throughout, and the stored artefact is a compressed blob.
- **Where files go:** IndexedDB, not the filesystem. `commitTake` calls
  `putMediaBlob(mediaId, take.blob, take.mimeType)` and `putPeaks(mediaId, peaks)`
  (`src/persistence/mediaStore.ts`), then `cacheBuffer` for the decoded buffer, **before**
  touching the project — "Persist bytes before touching the project so a failed write cannot
  leave a clip pointing at media that does not exist." `MediaRef` records `id`, `name`
  (`"<track name> take"`), `kind: 'recording'`, `mimeType`, `duration`, `sampleRate`,
  `channels`, `byteSize`, `createdAt`, `source: 'microphone'`, `peaksVersion`.
- **Timestamps:** the clip's timeline position is carried by `Clip.start` (beats) plus
  `Clip.offset` (seconds into the media), which is the same information BWF's timestamp
  carries, held in the project rather than in the file.
- **Recovery:** `putRecovery` stores an interrupted take's blob with `projectId`,
  `projectName`, `trackId`, `trackName`, `startBeat`, `durationSec` and `startedAt`;
  `RecoveryPanel` surfaces them and `useInputStore.pendingRecoveries` counts what was found
  at startup. `commitTake` clears the record on success (`deleteRecovery`).
- **Elsewhere in the app, 24-bit WAV does exist:** `src/audio/freeze.ts` writes track
  freezes as 24-bit WAV, with a comment on why ("24 bits puts the quantiser's error near
  −144 dBFS"). So the encoder exists; recording just does not use it.

**Gap: DIVERGENT-BY-DESIGN, with one real gap.**

- Lossy, browser-chosen format: forced by `MediaRecorder` being "the only capture API
  available across Chrome, Safari and Firefox today". Correctly reasoned and correctly
  documented in the code. Note for Motion Wave: the native core must record uncompressed,
  and this is one of the clearest cases where the web engine is explicitly not the
  long-term engine (ADR-0001).
- IndexedDB rather than a user-visible folder: forced by the browser sandbox.
- **The real gap: the user is never told.** `recorderMimeType` is captured into
  `inputStore` and `MediaRef.mimeType` is stored, but neither the record panel nor
  `TakeReview` shows format, sample rate or channel count. Given that the format varies by
  browser and that the channel count is whatever the device decided (§2), surfacing
  "48 kHz · mono · Opus" in the take review would cost one line and would answer three of
  this document's open questions at once.
- **MISSING:** any way to export a take losslessly at capture time; remaining-record-time
  (implementable from `navigator.storage.estimate()`).

---

## 15. Print effects while recording

**FSP8 does:** Insert effects can be placed on **Input Channels** so that they are printed
to the Track while recording. Open the Console → **Inputs** tab (double-click the Input
Channel in Small Console view to open its Insert Device Rack), insert an effect, "and those
effects are recorded at the input of any Track that uses that source. **Fender Studio Pro
automatically compensates for any latency caused by the Insert effects.**"

With the caveat: "when Insert effects are used on Input Channels, and effects are recorded
to a Track, **there is no way to go back and change the sound of the recording**. To avoid
this scenario, you might consider placing effects on the Audio Channels to which you are
recording for monitoring purposes only and printing with effects at mixdown."

**MotionLab does:** **Cannot print effects, by construction.** `recordingController.start()`
takes `audioInput.streamFor(this.deviceId)` — the raw `MediaStream` from `getUserMedia` —
and hands it to `MediaRecorder`. The track's trim, polarity, mono-sum and insert chain all
sit downstream at `ch.input`, on the monitoring path only. So a monitored take is heard
through the inserts and recorded without them.

There is no input-channel concept at all (§3), so there is nowhere to put a printing insert
even in principle.

**Gap: MISSING**, but the _default_ matches FSP8's own recommendation ("placing effects on
the Audio Channels to which you are recording for monitoring purposes only"), so the
practical harm is small and the current behaviour is arguably the safer one.

Implementation note if it is ever wanted: it is straightforward and does not need an input
channel layer — capture from a `MediaStreamAudioDestinationNode` fed by the track's insert
chain instead of from the raw stream, i.e. `source → trim → inserts → destinationNode`, then
`new MediaRecorder(destinationNode.stream)`. The reason to think twice is latency
compensation, which FSP8 explicitly provides and which MotionLab currently applies only on
the playback path (`ch.pdc`, `engine.ts:544`).

---

## 16. Disabling tracks (adjacent, from the same chapter)

**FSP8 does:** "When working in large Sessions with high Audio and Instrument Track counts,
it can be useful to disable certain Tracks that are not currently in use, to free up CPU and
RAM resources… **Disabling an Audio Track disables and unloads any Insert effects used.**"
Right-click the Track in Arrange view → "Disable Track" / "Enable Track". Same for
Instrument Tracks.

**MotionLab does:** No disable. `Track.locked` exists ("locked tracks refuse clip timing
edits and deletion") but that is an edit guard, not a resource one. The nearest analogue is
`src/audio/freeze.ts` — freezing an instrument track prints it and "builds no instrument and
schedules no notes anywhere — not live, not in a bounce", which recovers CPU the same way.

**Gap: PARTIAL.** Freeze covers the instrument case (better than disable, since the track
still sounds); audio-track insert unloading is **MISSING**.

---

## 17. Summary table

| #       | Behaviour                                                                        | Gap                                                         |
| ------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1.1     | Play / Space                                                                     | PARITY                                                      |
| 1.2     | Stop in place; Return-to-Start-on-Stop option                                    | PARTIAL (option MISSING)                                    |
| **1.3** | **Stop mid-record ends the take (Space / Stop button)**                          | **MISSING — P0**                                            |
| 1.4     | Return to zero                                                                   | PARITY (key differs; button tooltip wrong)                  |
| 1.5     | Rewind / FF / marker shuttle                                                     | PARITY                                                      |
| 1.6     | Loop playback                                                                    | PARITY                                                      |
| 1.6     | Set/Shift Loop, Loop Follows Selection                                           | MISSING                                                     |
| 1.7     | Record button / key                                                              | PARITY                                                      |
| 1.7     | Multitrack simultaneous record                                                   | MISSING (DIVERGENT-BY-DESIGN on web)                        |
| 1.8     | Play Start Marker, Locate to Mouse                                               | MISSING                                                     |
| 1.9     | Bars + Seconds display                                                           | PARTIAL (Samples/Frames, remaining time MISSING)            |
| **2**   | **Track channel format (mono/stereo), format toggle, mono-input rule**           | **MISSING — P0**                                            |
| **2**   | **What a mono input produces**                                                   | **UNDEFINED — device decides, user not told — P0**          |
| **3**   | **Per-track input selection**                                                    | **PARTIAL — one surface only — P0**                         |
| 3       | Software I/O channel layer, re-recording, per-track MIDI input                   | MISSING                                                     |
| 4       | Record arm exists and persists                                                   | PARITY                                                      |
| 4       | Arm implies input metering                                                       | MISSING                                                     |
| 4       | Exclusive arm ([Alt]-click), multi-select arm, input clip indicator              | MISSING                                                     |
| 4       | Record onto unarmed selected audio track                                         | DIVERGENT                                                   |
| 5.1     | Software monitoring through the channel                                          | PARITY                                                      |
| **5.2** | **Monitoring follows record-arm (+ its preference)**                             | **PARITY** — `monitorActions.ts`, `prefs.monitorFollowsArm` |
| 5.2     | Input follows selection                                                          | MISSING                                                     |
| 5.3     | Hardware direct monitoring                                                       | DIVERGENT-BY-DESIGN (no web API)                            |
| 5.4     | Tape-style (monitoring mutes playback)                                           | MISSING                                                     |
| 5.5     | Low-latency monitoring modes, buffer settings, latency readout                   | MISSING / DIVERGENT                                         |
| 5.6     | Instrument monitoring                                                            | PARTIAL (always live — simpler, defensible)                 |
| 6       | Input trim + polarity + mono-sum                                                 | Richer than FSP8                                            |
| 6       | Pre-fader input meter; post-fader channel meter                                  | PARITY                                                      |
| 6       | Input clip indicator                                                             | MISSING                                                     |
| 7       | Cue mixes (model, solo semantics)                                                | PARTIAL (single output device)                              |
| 8.1     | Manual record from playhead                                                      | PARITY                                                      |
| 8.2     | Count-in (bars, accent, shown in record button)                                  | PARTIAL (wall-clock timing; ranges disagree)                |
| 8.3     | Pre-roll (run-up kept in media)                                                  | PARITY                                                      |
| 8.4     | Punch in / punch out                                                             | PARTIAL (transport stops at punch-out; no crossfade)        |
| 8.5     | Post-roll                                                                        | MISSING                                                     |
| 8.6     | Record Panel as a surface                                                        | PARTIAL                                                     |
| 9       | Metronome on/off, default off, accent, signature-following, click-in-play        | PARITY                                                      |
| 9       | Sounds, subdivisions, beat duration, per-output, presets, render, drum metronome | MISSING                                                     |
| **10**  | **Loop recording**                                                               | **MISSING — and produces a wrong take today**               |
| 10      | Takes / comping model                                                            | PARITY                                                      |
| 10      | Takes created by recording                                                       | MISSING                                                     |
| 10      | Track Layers, Unpack Takes                                                       | MISSING                                                     |
| 11      | Replace / Overdub                                                                | MISSING (two stacked clips both sound)                      |
| 11      | Input Quantize                                                                   | PARTIAL (plumbed, hard-coded off)                           |
| 11      | Note Repeat, Note Erase, Undo Last/All Loops, Render Note FX                     | MISSING                                                     |
| 12      | Step Record                                                                      | MISSING                                                     |
| 13      | Retrospective recording; Record Offset                                           | MISSING                                                     |
| 14      | Recording format / location                                                      | DIVERGENT-BY-DESIGN (lossy, IndexedDB)                      |
| 14      | Format/rate/channels shown to the user                                           | MISSING                                                     |
| 15      | Print effects while recording                                                    | MISSING (default matches FSP8's own advice)                 |
| 16      | Disable track                                                                    | PARTIAL (freeze covers instruments)                         |
