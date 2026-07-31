# Milestone 2 — Recording, Media and Mixer Processing

Milestone 2 adds the first complete professional audio workflow: choose an input,
monitor it, arm a track, record with a count-in, get a real clip with a real
waveform, edit it nondestructively, process it through the mixer, save, reload,
and play it back.

Everything here is real browser audio. Nothing is simulated at the UI layer.

---

## 1. Verification status

The project instructions require each claim to be labelled honestly. This is that
labelling.

| Area | Status |
| --- | --- |
| Input selection, arming, monitoring | Implemented; verified by automated browser tests using a synthetic capture device |
| Count-in, capture, finalise, clip creation | Implemented; verified end to end in an automated browser test |
| Permission discipline (no startup prompt) | Implemented; **directly asserted** by counting `getUserMedia` calls |
| Microphone release after recording | Implemented; **directly asserted** on `MediaStreamTrack.readyState` |
| MediaRecorder format negotiation | Implemented; Opus/WebM verified in Chromium. **Safari AAC/MP4 not verified** — no Safari available |
| Waveform generation and rendering | Implemented; peak maths unit-tested, rendering verified in browser tests |
| Nondestructive trim / split / gain / fades | Implemented; invariants unit-tested |
| Audio file import | Implemented; pipeline unit-tested with a stubbed decoder. **Real-codec decoding not verified in CI** — jsdom has no Web Audio |
| Insert effects (gain, EQ, compressor, delay, reverb) | Implemented; graph construction and parameter clamping tested. **Audio output not measured** — no offline render comparison yet |
| Sends and buses | Implemented; routing and cycle rejection unit-tested |
| Schema v1 → v2 migration | Implemented; verified against realistic v1 project fixtures |
| Interrupted-take recovery | Implemented; **verified by unit-level reasoning and manual code paths only** — no automated crash-simulation test |
| Storage quota handling | Implemented; pre-flight check tested. **Actual quota exhaustion not simulated** |
| Real microphone hardware | **Not verified.** No physical audio input device was available in this environment |
| Real MIDI hardware | **Not verified.** No physical MIDI device was available |
| iOS / Safari behaviour | **Not verified.** No Apple device or Safari build was available |

Test totals: **120 unit tests**, **98 end-to-end tests**, strict TypeScript, ESLint
clean, production build succeeding.

---

## 2. Recording pipeline

### Order of operations

```
arm track
  → validate recorder support and an armed audio track
  → engine.start()                     (AudioContext, needs the user gesture)
  → acquire input stream               ← BEFORE the count-in, deliberately
  → count-in (metronome, bar-aware accents)
  → capture start beat = engine.getPositionBeats()
  → engine.play() + MediaRecorder.start(1000)
  → ... capture ...
  → MediaRecorder.stop()
  → decode → validate → peaks → IndexedDB → MediaRef → clip
```

The input stream is acquired **before** the count-in so that a device failure
surfaces while the user is still waiting, not after they have already performed.

The capture start beat is read at the moment the recorder actually starts, and
the count-in happens before that, so the clip lands where the user expects
regardless of encoder start-up latency.

### Why MediaRecorder

It is the only capture API available across Chromium, Safari and Firefox today,
it encodes off the main thread, and its output decodes back through the same
`decodeAudioData` path used for imports. Its container differs per browser, so
the format is **negotiated** (`pickMimeType`) and **reported in diagnostics**
rather than assumed.

### Crash safety

`MediaRecorder.start(1000)` chunks the stream every second, so an interrupted
take still holds recoverable data. On any finalise failure — decode error, quota
failure, cancel, or reload mid-recording — the bytes are written to a recovery
record instead of being discarded.

`commitTake` writes the encoded bytes and peaks to IndexedDB **before** touching
the project. A crash between the two leaves unreferenced media (recoverable by
pruning), never a clip pointing at media that does not exist.

### What is deliberately not offered

**Simultaneous multitrack recording.** One track records at a time. Supporting
several would require multi-device clock alignment and per-device drift
compensation that this milestone does not attempt, and offering a broken version
of it would be worse than not offering it. The rationale is recorded in
`src/audio/recordingController.ts`.

---

## 3. Microphone permission and privacy

These are hard rules in the code, not conventions:

- **`src/audio/inputManager.ts` is the only module that calls `getUserMedia`.**
- Permission is **never** requested at startup. `probePermission()` inspects the
  Permissions API without prompting; `requestPermission()` runs only from a user
  gesture and stops its tracks immediately after the grant.
- Device **labels are only shown once the browser populates them**, which it does
  only after permission. Before that the UI says so rather than inventing names.
- Streams are refcounted leases and are released on `visibilitychange` when not
  recording, so a backgrounded tab does not hold the microphone open.
- `engine.panic()` stops all monitoring and releases every input stream.

Two automated tests assert the first two points directly, by wrapping
`getUserMedia` in an init script and counting calls.

**No microphone recordings are committed to this repository.** Test audio is
either procedurally generated or produced by Chromium's synthetic capture device
at test time.

---

## 4. Media, waveforms and storage

### Storage split

| What | Where | Why |
| --- | --- | --- |
| Project document | IndexedDB `projects` | Small, rewritten on every autosave |
| `MediaRef` metadata | Inside the project document | Small; keeps media discoverable with the project |
| Encoded audio bytes | IndexedDB `media` | Large; must not be rewritten on every autosave |
| Peak envelopes | IndexedDB `peaks` | Cache; regenerable, so failure to write is non-fatal |
| Interrupted takes | IndexedDB `recovery` | Survives a crash independently of any project |

Saving a project therefore never rewrites megabytes of audio, and `localStorage`
is never involved.

### Waveforms

Peaks are computed **once** per media item and cached in memory and in IndexedDB.
Rendering never decodes audio and never walks raw samples — `sampleWindow` reads
the min/max envelope in `O(output columns)`, which is what keeps a project with
many clips cheap to draw.

The envelope always brackets the zero line by design, so an all-positive signal
still draws symmetrically rather than as a one-sided block.

Missing media renders an explicit "missing" state. It never renders as silence,
because silence and absence are different problems with different fixes.

---

## 5. Nondestructive editing

No edit ever rewrites audio. Every operation adjusts clip metadata:

- **Trim start** moves the timeline position and the source offset together, so
  the audio under the playhead does not shift.
- **Trim end** changes the musical length and the source duration together.
- **Split** adjusts the right half's source offset (`left.offset + leftLength ×
  secondsPerBeat`) rather than copying audio, and drops any fade that would land
  across the cut.
- **Fades** are gain ramps applied at schedule time, and they honour mid-clip
  entry — a loop wrap or a seek into the middle of a fade still produces the
  correct gain.
- **Clip gain** is a scheduled gain, not a destructive normalise.

---

## 6. Mixer processing

### Signal path

```
input → [insert 1 → insert 2 → …] → mute → volume → pan → analyser → output
                    │                                      │
        pre-fader send tap                     post-fader send tap
```

Inserts sit **ahead of the fader**, so moving the fader does not change how hard
a compressor works — what a mixing engineer expects.

Pre-fader sends tap the **insert output**, not the raw channel input:
"pre-fader" means pre-fader, not pre-insert. A send should carry the sound the
channel actually makes, minus only its fader move.

Buses never send onward, which keeps the graph acyclic by construction. On top of
that, `setSend` walks the routing graph and rejects any send that would create a
cycle.

### Effects

Five effects behind one `EffectNode` interface (`input`, `output`, `update`,
`dispose`), so the channel does not know which effect it holds:

| Effect | Built from |
| --- | --- |
| Gain | `GainNode` |
| EQ | three `BiquadFilterNode`s (low shelf, peaking, high shelf) |
| Compressor | `DynamicsCompressorNode` + makeup `GainNode` |
| Delay | `DelayNode` with a filtered feedback loop, tempo-synced in sixteenths |
| Reverb | `ConvolverNode` with a **synthesised** impulse + pre-delay |

Design decisions worth knowing:

- The reverb **synthesises its own impulse** (exponentially decaying, per-channel
  decorrelated, one-pole damped noise). The app ships no IR files and stays fully
  offline. The impulse is re-rendered only when the tail actually changes, not on
  every unrelated project edit.
- The chain is **rebuilt only when its shape changes** (effects added, removed or
  reordered). Parameter edits ramp in place with `setTargetAtTime`, so nothing
  zippers or clicks.
- **Bypass flattens each effect's own transfer function** rather than rerouting
  the graph — ratio 1 at a 0 dB threshold is mathematically transparent — so
  toggling bypass is silent.
- Delay feedback is hard-capped below 1, so the loop can never run away.
- An **unknown effect kind degrades to a bypassed pass-through**, so a project
  written by a newer build still plays, minus that effect.

### Insert slots on the strip

Full editing lives in the inspector, which has room for it. The mixer strip
carries a compact two-chip status row (`FX n` / `SND n`).

The strip is a CSS grid with **explicitly placed rows**, not auto-flow, so hiding
an optional row cannot shift the fader into the pan track. Below a 229px mixer
height a container query drops the insert row and re-maps to a six-track
template — measured across all six QA viewports, the short tablet mixer is
row-for-row identical to its pre-change heights.

---

## 7. Schema v2 migration

`SCHEMA_VERSION` is 2. v1 projects migrate forward losslessly and in place:

- Audio clips gain `offset`, `gain`, `fadeIn`, `fadeOut` defaults **without
  moving the clip**.
- Tracks gain optional `sends`, `effects`, `inputDeviceId`, `monitoring`.
- Projects gain an optional `media[]` array.

Loading is defensive because the data on disk is not under our control:

- Sends pointing at nonexistent tracks, or at the track itself, are dropped.
- Effects of an unknown kind are dropped rather than loading a broken chain.
- Every effect parameter is clamped into its spec range, so a corrupt value can
  **never reach an `AudioParam`**.
- The insert cap is enforced on load, not just in the UI.
- Non-array `sends`/`effects` and malformed media entries are discarded instead
  of throwing.

All of the above is covered by `tests/migration.test.ts` against realistic v1
fixtures.

---

## 8. Import

Import follows exactly the same path as a recorded take, so nothing downstream
can tell an import from a recording.

**Format support is the browser's, not ours.** Rather than gate on a hardcoded
extension list — which is wrong on every engine, since Safari decodes ALAC and
AAC that Chromium does not and Chromium/Firefox decode Opus/WebM that older
Safari does not — `decodeAudioData` decides, and its refusal is reported with the
actual format named and a suggestion of formats that work everywhere.

Before decoding: a per-file size ceiling (120 MB) and a storage-quota pre-flight
that reports free and needed bytes. A file that cannot fit is refused up front
rather than failing mid-write.

Multi-file drops import **sequentially** — parallel decodes of large files spike
memory — and land end to end on the timeline. One failure does not abort the
rest, and the summary toast reports partial success honestly rather than
claiming everything worked.

Drop targets are audio lanes only. A file dropped anywhere else is swallowed at
the window, because the browser default is to navigate to the file and discard
unsaved work.

---

## 9. Recovery

Stashed takes are discovered at boot on **every** path — restore, first run, and
IndexedDB failure — and are reported, never acted on. Recovering silently would
drop clips into whichever project happened to be open, which is rarely the one
that was being recorded into.

Recovering rebuilds the clip on its original track when that track still exists,
and creates a new audio track otherwise rather than guessing at a substitute. A
take from a different project is placed at bar 1, since its original start beat
means nothing in the current one.

A failed write **leaves the recovery record in place**, so a full disk cannot turn
a recoverable take into a lost one.

The panel appears in diagnostics and in the phone Record workspace — where
someone looking for a lost take will actually go — and only when something is
genuinely pending.

---

## 10. Diagnostics

Eighteen Milestone 2 fields were added to the copyable report: mic permission,
device count (noting when labels are withheld), recorder support and negotiated
MIME type, live recording state and duration, last take with size and silence
flag, open input streams with per-track ready state, monitoring cross-checked
against the engine's own count, media reference and stored-byte counts, storage
used against quota, unrecovered take count, decoded-buffer cache stats, missing
media, and insert/send counts.

Storage figures need async reads, so they are sampled when the panel opens and on
a slow interval. Until sampled, the field says so rather than reporting a
misleading zero.

---

## 11. Known limitations

- **No Safari/iOS verification.** Format negotiation includes AAC/MP4 for Safari
  but has not been run there.
- **No real microphone or MIDI hardware verification.** No such device was
  available.
- **No offline audio-render assertion** for the effects. Graph construction and
  parameter handling are tested; the produced audio has not been measured against
  a reference.
- **Quota exhaustion is not simulated.** The pre-flight check and error handling
  are implemented and unit-tested, but a genuinely full origin has not been
  exercised.
- **No WAV export yet.** Deferred; the `OfflineAudioContext` foundation is not in
  this milestone.
- Not started, per the milestone constraints: cloud collaboration, accounts,
  subscriptions, marketplace, AI generation, video, external plugin hosting,
  time-stretching, pitch correction, comping lanes, advanced automation, and full
  mastering.
