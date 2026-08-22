# Plugin audit — every stock device and instrument against the fifteen-point matrix

Scope: the twenty-seven kinds in `EFFECT_SPECS` (`src/model/effects.ts`) and the four
instruments the engine can build — `PolySynth`, `SamplerInstrument`, `DrumKit` and
`RackInstrument` — plus the automation, preset, sample-rate, channel-configuration and
fuzz behaviour the device-function audit (`docs/AUDIT-DEVICE-FUNCTION.md`) explicitly did
not cover. Third-party WAM plugins are out of scope except where the built-in matrix
touches them. The native `motionwave/` core has no processors and is out of scope.

**Status: the three P1s are fixed and the probes that found them are now the regression
tests for them.** The audit itself changed nothing under `src/`; the fixes landed
afterwards, in `704d18d`, and each finding below carries a *Fixed* note with the
re-measured number. The ten P2s remain open. Everything measured here is reproducible with
`npx vitest run tests/audit/` — seven files, fifty-seven cases, all passing against the tree
as audited. Every number below came out of one of them or out of `grep` over the named
line; nothing is quoted from memory and nothing is asserted from a name.

**Thirteen findings, none P0: three P1 and ten P2.** The three P1s were a reverb whose
automation re-renders an impulse response ninety times over one sweep, tempo-synced
inserts that ignore the tempo map, and a voice cap that is not enforced for notes sharing
a start time. All three are closed:

| ID     | Was                                                  | Is now                                              |
| ------ | ---------------------------------------------------- | --------------------------------------------------- |
| PA-001 | 90 re-renders / 27.1 M samples / 2396 ms per Size sweep | 30 / 5.1 M / 192 ms — and 180 → 26 for Damping       |
| PA-002 | 6/16 delay at 0.7500 s where the bar wants 0.5625 s   | 0.5625 s, sampled from the map at the playhead       |
| PA-003 | 60 simultaneous notes → 60 voices, 1 steal            | 24 live, 36 steals on 36 distinct voices             |

---

## What could not be run here, and is therefore not claimed

The test environment is jsdom. It has no Web Audio implementation at all, no audio device,
and no real-time thread. Four of the matrix's checks cannot be answered by rendering here,
and are classified rather than passed:

- **Bypass null to −120 dBFS** (check 5, second half). No renderer, so no null test. What
  exists instead is a structural proof over all twenty-seven kinds
  (`tests/effectCurves.test.ts:1015`): every route from a bypassed insert's input to its
  output that passes any processing sums to exactly zero, and the routes that pass none sum
  to exactly one. That is a stronger statement than a null test at one signal, and a weaker
  one than a null test at every signal, because it says nothing about a node whose output
  is not a linear function of its input.
- **Reported versus measured latency** (check 6). Measurement needs a browser. The measured
  figures in `docs/KNOWN-LIMITATIONS.md:35-73` were measured in Chromium and the master
  one is pinned by `e2e/masterlatency.spec.ts`; one of them is re-derived arithmetically
  below and one of them is now stale (PA-009).
- **Aliasing through the browser's own oversampler** (check 12). The five shapers ask for
  `oversample: '4x'`; the specification does not say what filters that uses, so what a
  browser actually produces cannot be computed. The aliasing figures below are for the
  _curves_, at 1× and against an ideal 4× reference, which bounds what the shipped path can
  achieve rather than describing it.
- **Buffer sizes 32…1024** (check 8). The check does not apply as posed. A Web Audio graph
  has no selectable block size: the render quantum is fixed at 128 frames by the
  specification, an `AudioWorkletProcessor` is always handed 128 frames, `AudioContext` is
  opened with `latencyHint: 'interactive'` and nothing else (`src/audio/engine.ts:281`),
  and no call anywhere in `src/` passes a `renderSizeHint`. No stock device is a worklet:
  the two worklets in the app are the live-waveform peak tap
  (`src/audio/peakTap.ts`, on the record path only) and whatever a third-party WAM plugin
  brings with it (`src/audio/wam/wamHost.ts`), neither of which is in scope here. The
  device buffer the browser then chooses is not observable from the page and cannot be
  varied from a test. See PA-013 for the one latent dependency on the quantum being 128.

A further limit on everything below: the probe context (`tests/audit/probeContext.ts`) is a
stand-in that records what each builder writes and how. It is a simulation of the
specification, not the browser. It proves facts about the graph this build constructs — what
value lands on which `AudioParam`, whether it was ramped or assigned, what each node is
connected to. It proves nothing about what the resulting audio sounds like.

---

## Findings

| #      | Sev | Device(s)                                                                       | Finding                                                                                                                                                                         |
| ------ | --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PA-001 | P1 ✅ | Reverb                                                                          | Automating Size or Damping re-renders the impulse response and hot-swaps the convolver buffer, tens of times per sweep, synchronously on the main thread                        |
| PA-002 | P1 ✅ | Delay, Ping-Pong, Tremolo, Auto Pan                                             | Tempo-synced divisions resolve at the tempo of beat 0, not at the tempo in force                                                                                                |
| PA-003 | P1 ✅ | MotionSynth, Sampler, Drum Rack                                                 | The voice cap is not enforced for notes that share a start time; one voice is stolen repeatedly while the rest all sound                                                        |
| PA-004 | P2  | Compressor, Gate, Limiter, De-esser, Saturator, Distortion, Amp Sim, Bitcrusher | Eighteen controls rebuild and swap a WaveShaper table on every automation frame instead of ramping                                                                              |
| PA-005 | P2  | Vocal Tune                                                                      | Six automation lanes are offered against a node that is a declared pass-through                                                                                                 |
| PA-006 | P2  | all twenty-seven                                                                | Insert automation renders on a 25 ms offline grid that widens to 375 ms on a long bounce, while playback applies it at 60–100 Hz; `KNOWN-LIMITATIONS.md` calls the bounce exact |
| PA-007 | P2  | MotionSynth, Sampler, Classic Kit                                               | A non-finite instrument parameter is guarded at neither end: it survives the load path and reaches the node                                                                     |
| PA-008 | P2  | Multiband                                                                       | A bypassed Multiband keeps publishing gain reduction, and the face keeps drawing it                                                                                             |
| PA-009 | P2  | Limiter (documentation)                                                         | `KNOWN-LIMITATIONS.md` says the limiter's clipper latency is present when bypassed; since the `clipperDry` leg landed it is not                                                 |
| PA-010 | P2  | Limiter, Multiband, Bitcrusher, Saturator, Distortion, Amp Sim, Filter          | No insert declares a latency and there is no compensation, so seven of them shift their channel against the rest of the session                                                 |
| PA-011 | P2  | Ping-Pong, Tremolo, Auto Pan                                                    | The division knob prints the straight name whatever the Feel control is set to, while the slot summary and the audio apply the Feel                                             |
| PA-012 | P2  | Filter                                                                          | Drive is a second uncompensated parallel blend of an oversampled shaper against a dry wire; the documentation says the saturator and distortion are the only one                |
| PA-013 | P2  | Compressor, Gate, Limiter, De-esser                                             | `Smoother` places its pole from a hard-coded 128-frame render quantum; correct today, silently wrong if a render size is ever hinted                                            |

### PA-001 (P1) — Reverb: automating Size or Damping re-renders the impulse response

**Claimed.** Size and Damping are ordinary automatable parameters. Both appear in the
add-lane menu like every other insert parameter, because `collectAutoParams` offers a lane
for every entry in `spec.params` (`src/model/paramRegistry.ts:420-425`).

**What happens.** `buildReverb`'s update re-renders the whole impulse whenever Size has
moved more than 0.05 s or Damping more than 50 Hz
(`src/audio/effectChain.ts:2041-2042`), and assigns it to `ConvolverNode.buffer`. The
automation applier calls that update on the rAF frame loop (`src/audio/engine.ts:1843`)
and again on the scheduler's worker tick (`:249`), skipping only lanes that moved less
than 0.0008 normalised (`:1065`).

**Measured** (`tests/audit/automation.test.ts`, driven at the 60 Hz frame rate over a six
second sweep of the full range):

| Sweep                  | Impulse re-renders | Samples generated | Synchronous work |
| ---------------------- | ------------------ | ----------------- | ---------------- |
| Size 0.2 → 6.0 s       | 90                 | 27,062,336        | 2396 ms          |
| Damping 800 → 16000 Hz | 180                | 31,104,000        | 2525 ms          |

That is roughly 40 % of one core, on the main thread, for one insert — plus ninety
discontinuities, because replacing a convolver's buffer discards the tail it was
convolving. Whether the stall is enough to starve the scheduler's 150 ms lookahead into an
audible dropout was **not** measured; that needs an audio device. Timings are Node on this
host, which runs the same V8 as the browser but is not the browser.

Note the interaction with PA-006: offline the same update runs on a 25 ms grid, so a
bounce re-renders at a different rate from the monitor path.

**Fixed** (`704d18d`). Two changes, only one of which is allowed to be audible.

The decay envelope now reads from a 4096-point table with linear interpolation instead of
calling `Math.pow(x, 2.2)` once per sample per channel — 576,000 calls for a six-second
stereo tail. That is a pure speed change and is tested as one: the worst sample difference
against the original across the whole Size range is 5.96e-8, half of one Float32 step, so
it is below what the `AudioBuffer` can store (`tests/reverbImpulse.test.ts`).

The re-render trigger is now a sixth-octave grid on each of Size and Damping rather than a
flat 0.05 s / 50 Hz threshold. The flat one was a quarter of the shortest tail the control
offers and under one per cent of the longest, which is why it fired constantly at the low
end. Decay time and damping frequency are both heard proportionally, so the grid is too.

| Sweep                  | Re-renders | Samples generated | Synchronous work |
| ---------------------- | ---------- | ----------------- | ---------------- |
| Size 0.2 → 6.0 s       | 90 → **30**  | 27,062,336 → **5,132,460** | 2396 ms → **192 ms** |
| Damping 800 → 16000 Hz | 180 → **26** | 31,104,000 → **4,492,800** | 2525 ms → **158 ms** |

The tail discontinuities scale with the swap count, so they fall by the same factor. They
are not eliminated: a convolver whose buffer is replaced still cuts what it was ringing.
Removing them entirely means two convolvers and a crossfade, which doubles the reverb's
steady-state cost permanently to fix an artefact of an uncommon gesture — the wrong trade,
and a design change rather than a fix. A sweep that reverses direction re-renders tails it
has already built; a small LRU cache would make that free, at 2–3 MB per reverb instance.
Not taken, for the same reason: real cost against a rare gesture.

### PA-002 (P1) — Tempo-synced inserts resolve at the tempo of beat 0

**Claimed.** The Delay's Time parameter is declared "Expressed in sixteenths so it follows
the project tempo" (`src/model/effects.ts:608`); the Tremolo blurb says "locked to the
project tempo" and Auto Pan's says "tempo-locked". `src/model/music.ts:155` exports
`projectBpmAt`, whose own comment reads "Instantaneous tempo at a beat. Use for delay sync
and readouts, not for spans."

**What happens.** Every driver passes the scalar `project.bpm`: `engine.syncGraph` at
`src/audio/engine.ts:573` and `:676`, the automation applier at `:1147`, and `exportMix` at
`:466`, `:507`, `:683` and `:857`. `projectBpmAt` has no caller in `src/audio/` at all —
asserted, not eyeballed, in `tests/audit/tempoSync.test.ts`. Meanwhile
`syncScalarTempo` pins `d.bpm` to the map's first event
(`src/state/projectStore.ts:2664`), so on a project with a tempo map the scalar is the
tempo at beat 0 and stays there.

**Measured.** A song at 120 that changes to 160 at bar 9: a Delay set to 6/16 is written
0.7500 s where the bar wants 0.5625 s — 33.3 % long, 188 ms per repeat. Under a tempo
_ramp_ the error is continuous rather than stepped.

Time signature is correctly ignored: a sixteenth is a sixteenth in any meter and none of
the four devices declares a bar-length division. Asserted in the same file so the matrix
row reads "correct" rather than "untested".

**Fixed** (`704d18d`). Every driver now samples the map instead of the pinned scalar:
`projectBpmAt` at the playhead in `engine.syncGraph` and in the automation applier, and at
the beat being rendered in `exportMix` — including the per-clip event chain, which gets the
tempo at the clip's own start. The scalar stays pinned to beat 0, which is what it is for.

The second half is *how often* to re-read it. A tempo ramp moves continuously, so
re-driving a chain per frame would put a full insert update pass — including the
waveshaper rebuilds of PA-004 — on the frame loop for the ramp's whole length, which is
the shape of PA-001. `src/audio/tempoSync.ts` gates it on a relative move of half a per
cent: on a half-second delay that tolerance is 2.5 ms, and a 120→160 ramp costs **55
insert passes over 480 frames** instead of 480, with the held tempo landing inside the gate
of the real one. The offline renderer only buys tracking when the map actually moves *and*
something reads it, so a bounce of a project with no synced insert pays nothing.

A 6/16 delay at bar 9 of the 120→160 song is now 0.5625 s, which is what the bar wants.

### PA-003 (P1) — The synth voice cap is not enforced for simultaneous notes

**Claimed.** `docs/KNOWN-LIMITATIONS.md:89-92`: "24 voices per synth instrument and 48 per
sampler instrument (oldest voice steals first). Beyond that, notes are skipped rather than
glitching the audio thread."

**What happens.** `PolySynth.spawn` (`src/audio/synth.ts:358-364`) retires finished voices,
then — if the set is full — walks it for the smallest `startedAt` and calls
`stopNow(true, when)` on it. Two things then hold at once: `stopNow` stops a voice but does
not remove it from `this.voices` (removal waits for `onended`, or for a later `retireBy`
whose `when` has passed the voice's `endsAt`), and the walk uses a strict `<`, so with every
`startedAt` equal it never advances past the first voice in iteration order. The same voice
is therefore stolen again on every subsequent spawn while the set keeps growing.

**Measured** (`tests/audit/instruments.test.ts`, an uncapped registry so the instrument's own
ceiling is what is under test):

- Sixty notes at one instant: **60 oscillators started, 1 voice cut short.**
- Thirty notes at one instant: **6 steals, all landing on the same voice.**
- Sixty notes spaced half a second apart, four seconds long: 0 steals, because `retireBy`
  drops each voice about eleven notes after it started. The cap is correct whenever the
  notes are spread.

A dense chord, a hard-quantised strum and a stacked orchestral hit all produce the
simultaneous case. Live, the engine's global cap of 128 sources
(`src/audio/engine.ts:40`, `:1162-1167`) catches the overflow late and skips sources on
whatever track asks next, with a warning in the diagnostics log. Offline it is not caught
at all: `exportMix` uses a registry whose `canAllocate` is `() => true`
(`src/audio/exportMix.ts:138-142`).

`SamplerInstrument.spawn` (`src/audio/samplerInstrument.ts:86-91`) is the same three lines
against `MAX_SAMPLER_VOICES`, and it was reproduced: with a cached buffer behind a zone,
**eighty simultaneous notes leave eighty voices live against a ceiling of forty-eight**
(`SamplerInstrument.activeVoices()`). The steal itself cannot be counted the way it can on
the synth, because a sampler voice's ordinary release also cancels before it ramps, so the
"stolen once, repeatedly" half of the mechanism is read off the code rather than measured
on this instrument.

**Fixed** (`704d18d`). `src/audio/voiceCap.ts` holds the corrected steal, shared by both
instruments: loop until there is room rather than steal once, and remove each voice from
the allocation set as it is taken. Removing is what makes the loop terminate and the count
honest — the set is the ledger, not the lifetime, and the voice's own cleanup still runs on
its own schedule. That also dissolves the tie-break problem: with the stolen voice gone,
the walk cannot return it again.

Sixty simultaneous notes against a ceiling of 24 now leave **24 live, with 36 steals
landing on 36 distinct voices** (was: 60 live, 1 steal). Thirty notes give 6 steals on 6
voices (was 6 on 1). The sampler holds **48 of 80** (was 80). Stealing policy is
deliberately unchanged — oldest first, ties to whichever was inserted first — because the
finding is that the ceiling did not hold, not that the wrong voice was chosen. Preferring
voices already in their release phase would be less audible still and is a separate change.

Sixty oscillators are still *created* for a sixty-note instant; 36 are cut at their own
start time and produce about 30 ms each. That is what a hard voice cap does, and refusing
to spawn instead would mean the newest note never sounds, which is the wrong end to drop.

### PA-004 (P2) — Eighteen controls swap a table on every automation frame

**Claimed.** `ControlVca`'s own comment: "Curves are therefore rebuilt only when one of
those values actually moves, and the level controls that a musician sweeps live (depth,
lookahead, ballistics) are all ramped."

**What happens.** Under automation the value moves on every frame, so the guard never
holds. `ControlVca.setLaw` (`src/audio/effectChain.ts:562-579`) rebuilds two curves and
assigns them; `buildSaturator`, `buildDistortion` and `buildAmpSim` assign
`shaper.curve` (`:1357`, `:1390`, `:1430`); `buildBitcrusher` assigns `quantiser.curve`
(`:1512`); `buildAmpSim` also swaps `cab.buffer` (`:1435`) on a cabinet change. A
WaveShaper curve is swapped in one block; nothing ramps it.

**Measured**, one 360-frame sweep of each control's full range:

| Control                | Curve rebuilds | Synchronous work |
| ---------------------- | -------------- | ---------------- |
| `saturator.drive`      | 360            | 34.6 ms          |
| `distortion.drive`     | 360            | 41.0 ms          |
| `compressor.threshold` | 360            | 152.8 ms         |
| `gate.threshold`       | 361            | 117.6 ms         |
| `limiter.ceiling`      | 360            | 146.8 ms         |
| `deesser.threshold`    | 360            | 145.1 ms         |

The full list of eighteen signal-path controls that step rather than ramp is printed by
`tests/audit/paramReach.test.ts`: `compressor` threshold/ratio/knee, `gate`
threshold/ratio/range, `limiter` ceiling, `deesser` threshold/ratio, `saturator`
model/drive, `distortion` drive/hardness, `ampsim` model/cab, `bitcrusher` bits, and
`reverb` size/damping (the last two are PA-001). `analyser` resolution and smoothing also
step but are not in the signal path.

How audible one step is was not measured. The per-frame change is small — the engine's own
epsilon puts a compressor threshold lane at about 0.05 dB per frame — so the ranking here
is P2 on the CPU cost and on the principle that a swapped table is a discontinuity, not on
a demonstrated click.

### PA-005 (P2) — Vocal Tune offers six lanes against a pass-through

`buildPassThrough` (`src/audio/effectChain.ts:2239`) is the whole of the Vocal Tune node,
deliberately and for a good reason stated where it is declared: the correction runs offline
in the audio editor, which reads the settings from the static effect
(`src/components/audioeditor/AudioEditor.tsx:113-118`). Nothing reads a lane.

`collectAutoParams` offers a lane for every entry in every effect's `spec.params` with no
per-kind narrowing (`src/model/paramRegistry.ts:420-425`), so all six are on the add-lane
menu, the macro target picker and the MIDI-link picker. Measured: `listAutoParams` returns
`strength, speed, humanise, scale, key, formant` for a track carrying one Vocal Tune.

This is the drum-kit defect the team already fixed once, on the other surface:
`readableSynthParams` (`src/model/paramRegistry.ts:324`) narrows the instrument list per
instrument for exactly this reason, and `tests/laneWired.test.ts` guards it — but that
file's own header says "effect lanes to the insert chain, so neither is this file's
business". There is no equivalent guard for effect lanes.

### PA-006 (P2) — Insert automation is on a coarse grid offline and a different one live

`docs/KNOWN-LIMITATIONS.md:80-85` states: "Automation is smoothed while monitoring and
exact in the bounce. Live, every automated value approaches its target over a 15 ms time
constant at frame rate […] the offline render schedules the same lane as sample-accurate
ramps and reproduces the dip exactly. The bounce is the more faithful of the two."

That is true of volume, pan, mute and sends, which go through `scheduleLaneOnParam`
(`src/audio/exportMix.ts:298`) and are scheduled as ramps between knots. It is not true of
insert parameters. Those are applied by calling `InsertChain.updateOne` from inside a
`ctx.suspend()` callback on a 25 ms grid (`src/audio/exportMix.ts:659-687`), and each such
call ramps with `setParam`'s own 20 ms time constant. The grid widens so the render never
exceeds 4800 suspensions:

| Render length | Grid     | Effective rate |
| ------------- | -------- | -------------- |
| 30 s          | 25.0 ms  | 40 Hz          |
| 120 s         | 25.0 ms  | 40 Hz          |
| 300 s         | 62.5 ms  | 16 Hz          |
| 600 s         | 125.0 ms | 8 Hz           |
| 1800 s        | 375.0 ms | 2.7 Hz         |

Live the same parameters are applied at up to about 100 Hz, because `applyAutomation` runs
from both the rAF loop (`src/audio/engine.ts:1843`) and the scheduler's worker tick
(`:249`). So a filter sweep is smoother in the monitor than in the bounce, and a
thirty-minute album bounce quantises every insert sweep to under 3 Hz. Neither number is a
sample-accurate ramp.

### PA-007 (P2) — Instrument parameters are guarded at neither end

The load path clamps every insert parameter into its spec range with the comment "so a
corrupt value cannot reach an AudioParam" (`src/persistence/projectRepo.ts:349-353`), and
the write path refuses a non-finite value (`effectChain.setParam`, `engine.safeSet`).
`track.synth` goes through neither: `validateProject` never touches it,
`engine.readSynthParams` returns it verbatim (`src/audio/engine.ts:735-740`), and `Voice`
assigns `this.filter.frequency.value = voiceFilter.freqHz` directly
(`src/audio/synth.ts:136`).

**Measured**, two different outcomes depending on the route:

- **Through a save and load.** `validateProject` normalises through
  `JSON.parse(JSON.stringify(…))` first, and JSON has no NaN, so the field arrives as
  `null`. `null * synthKeyTrack(60)` is 0, which `clamp` pulls to the 40 Hz floor: the
  voice's lowpass is fully closed and the instrument is **silent, with nothing logged**.
- **In memory.** The value stays NaN: `synthVoiceFilter({…, cutoff: NaN}).freqHz` is NaN,
  and `synthAmpEnvelope({…, volume: NaN}).peak` is NaN. `AudioParam.value` is a restricted
  float, so a browser throws a `TypeError` at that assignment rather than accepting it.
  That is inferred from the WebIDL type, not observed here.

`Infinity` is caught, but by accident: `clamp` returns the bound because the comparison is
true. NaN fails both comparisons and passes through. No in-app route that produces a
non-finite synth field was found, so the exposure is a corrupt or hand-edited project, or a
future writer — the finding is the asymmetry and the silent outcome, not a live reproduction.

### PA-008 (P2) — A bypassed Multiband keeps reporting gain reduction

`buildMultiband`'s bypass is `wd.setMix(1, bypass)`, which takes the wet leg to zero and
opens the dry one. The three `DynamicsCompressorNode`s stay connected to the input and keep
working, and `gainReductionDb` is `Math.min(...bands.map((b) => b.comp.reduction))`
(`src/audio/effectChain.ts:1098`). `PluginFace` reads that every frame with no reference to
bypass (`src/components/mixer/PluginFace.tsx:434`).

**Measured.** With the three stand-in nodes reporting −7.5 dB, the bypassed insert reports
−7.5 dB. The four processors built on `ControlVca` report 0, because bypass takes the
`depth` gain that feeds their tap to zero. The Multiband is the only one that disagrees.

### PA-009 (P2) — A stale latency claim in `KNOWN-LIMITATIONS.md`

`docs/KNOWN-LIMITATIONS.md:48-52`: "**The limiter insert costs 192 samples (4.35 ms)** in
its oversampled brickwall stage — present even when the insert is bypassed".

The second half is no longer true. `buildLimiter` mutes `postClip` and opens `clipperDry`
on bypass (`src/audio/effectChain.ts:1040-1041`), which is the fix
`docs/AUDIT-DEVICE-FUNCTION.md` records. **Measured:** with the insert bypassed, the only
gain the 4× shaper feeds sits at 0, and the lookahead delay is written 0. The same
structural claim is asserted for all twenty-seven kinds at
`tests/effectCurves.test.ts:1015`. The 192-sample figure itself is not disputed — it was
measured in a browser, which cannot be done here.

### PA-010 (P2) — Nothing declares a latency, and seven inserts have one

**Measured:** no `EffectNode` carries a `latencySec` or `latencySamples` member, for any of
the twenty-seven kinds, and there is no delay compensation anywhere in `src/audio/` (no
occurrence of "compensat" outside the bitcrusher's own internal dry alignment). The check as
posed — reported latency equals measured latency — cannot pass, because nothing is reported.

For the twenty inserts that add no latency the answer is trivially right. Seven add one:
the Limiter (lookahead 0.5–10 ms, plus its 4× clipper), the Multiband (a
`DynamicsCompressorNode` per band), the Bitcrusher (its hold cascade), and the Saturator,
Distortion, Amp Sim and Filter (4× shapers). One of the seven is exact arithmetic rather
than the browser's, and it was re-derived here and matched against what the builder
applies:

| Rate divide | Stages | Group delay             | Dry leg held |
| ----------- | ------ | ----------------------- | ------------ |
| 1×          | 0      | 0 samples               | 0            |
| 2×          | 1      | 0.5 samples (0.010 ms)  | 0.5          |
| 4×          | 2      | 1.5 samples (0.031 ms)  | 1.5          |
| 8×          | 3      | 3.5 samples (0.073 ms)  | 3.5          |
| 16×         | 4      | 7.5 samples (0.156 ms)  | 7.5          |
| 32×         | 5      | 15.5 samples (0.323 ms) | 15.5         |
| 64×         | 6      | 31.5 samples (0.656 ms) | 31.5         |

The bitcrusher's own dry leg is compensated exactly; what is not compensated is the insert
against the rest of the session. The limiter's lookahead is applied verbatim in
milliseconds and returned to zero on bypass (measured at 0.5, 3 and 10 ms).

This is already written down in `docs/KNOWN-LIMITATIONS.md:35-73`, so the ticket is "declare
it, or compensate it", not "it is broken and nobody knew".

### PA-011 (P2) — A division knob that does not print its Feel

`formatParam` is handed a `ParamSpec` and a number and nothing else, so its `'div'` case
can only ask `describeDivision(value, 'straight')` (`src/model/effects.ts:1509`). The
collapsed slot has the whole effect and asks for the real modifier
(`describeEffect` → `divisionText`, `:1530`), and so does the audio. The knob face
(`src/components/mixer/PluginFace.tsx:193`) and the automation lane readout
(`src/model/paramRegistry.ts:479`) both use `formatParam`.

**Measured:**

| Device    | Feel    | Knob reads | Slot reads     |
| --------- | ------- | ---------- | -------------- |
| Ping-Pong | Dotted  | `3/16`     | `3/16 D · 30%` |
| Ping-Pong | Triplet | `3/16`     | `3/16 T · 30%` |
| Tremolo   | Dotted  | `1/4`      | `1/4 D · 60%`  |
| Tremolo   | Triplet | `1/4`      | `1/4 T · 60%`  |
| Auto Pan  | Dotted  | `1/2`      | `1/2 D · 80%`  |
| Auto Pan  | Triplet | `1/2`      | `1/2 T · 80%`  |

The Delay is unaffected: it has no Feel control, so straight is the truth for it.

### PA-012 (P2) — The Filter's Drive is a second uncompensated parallel blend

`docs/KNOWN-LIMITATIONS.md:68-74`: "The saturator's and the distortion's parallel Mix is
_the one place_ a comb is _not_ compensated".

`DriveStage` (`src/audio/effectChain.ts:1253-1281`) crossfades a `'4x'` WaveShaper against a
dry wire by `driveDb / 24`, and `buildFilter` gives every Filter one (`:1317`). That is the
same arrangement, and it is not mentioned anywhere.

**Measured:**

| Drive | Shaped leg | Dry leg |
| ----- | ---------- | ------- |
| 0 dB  | 0          | 1.0000  |
| 6 dB  | 0.25       | 0.7500  |
| 12 dB | 0.5        | 0.5000  |
| 18 dB | 0.75       | 0.2500  |
| 24 dB | 1          | 0.0000  |

At 12 dB the two legs are equal, which is where a comb is deepest. Only the two extremes
are exact. The trade may well be the right one — it is what gives Drive a real zero, and
that is stated where the stage is declared — but the sentence in the limitations document
is wrong, and the parameter says nothing where the saturator's and distortion's Mix both do.

### PA-013 (P2) — `Smoother` places its pole from a hard-coded render quantum

`RENDER_QUANTUM = 128` is a constant in `src/audio/effectChain.ts:357`, and `Smoother`
derives its feedback pole from `128 / ctx.sampleRate` on the documented rule that Web Audio
pins any delay inside a cycle to one render quantum. That is correct for every context this
app opens today, and the sample-rate sweep in check 7 confirms it holds exactly at five
rates.
It stops being correct the moment a context is opened whose render quantum is not 128 —
the constant is not read from anywhere, so the pole would be placed for 128 frames while
the loop ran at another length, and every dynamics processor's attack and release would be
wrong by that ratio with nothing to indicate it. No call in `src/` asks for a different
quantum today. This is a latent dependency, recorded so a future change to the context
options is not made without it.

---

## The matrix

One row per device, one column per check. `P` pass, `F<n>` fail against ticket PA-0`<n>`,
`B` blocked, `–` does not apply to this device. `P/B` appears only in column 5, where the
check has two halves: click-free passes by measurement and the null test is blocked.
`F4,6` means both PA-004 and PA-006 apply to that cell.

Columns: **1** every parameter reaches the DSP · **2** ranges, units, defaults, tapers ·
**3** automation works and does not zipper · **4** preset round-trip · **5** bypass
click-free / nulls · **6** reported latency · **7** sample rates 44.1–192 kHz · **8** buffer
sizes · **9** mono / stereo / mono→stereo · **10** sidechain · **11** metering ·
**12** oversampling · **13** NaN/Inf fuzz · **14** tempo and time-signature changes ·
**15** extreme values and runaway.

| Device       | 1   | 2   | 3    | 4   | 5   | 6   | 7   | 8   | 9   | 10  | 11  | 12  | 13  | 14  | 15  |
| ------------ | --- | --- | ---- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Compressor   | P   | P   | F4,6 | P   | P/B | P   | P   | –   | P   | P   | P   | –   | P   | –   | P   |
| Gate         | P   | P   | F4,6 | P   | P/B | P   | P   | –   | P   | P   | P   | –   | P   | –   | P   |
| Limiter      | P   | P   | F4,6 | P   | P/B | F10 | P   | –   | P   | P   | P   | P   | P   | –   | P   |
| Multiband    | P   | P   | F6   | P   | P/B | F10 | P   | –   | P   | –   | F8  | –   | P   | –   | P   |
| De-esser     | P   | P   | F4,6 | P   | P/B | P   | P   | –   | P   | P   | P   | –   | P   | –   | P   |
| EQ           | P   | P   | F6   | P   | P/B | P   | P   | –   | P   | –   | –   | –   | P   | –   | P   |
| EQ8          | P   | P   | F6   | P   | P/B | P   | P   | –   | P   | –   | –   | –   | P   | –   | P   |
| Filter       | P   | P   | F6   | P   | P/B | F10 | P   | –   | P   | –   | –   | P   | P   | –   | P   |
| Saturator    | P   | P   | F4,6 | P   | P/B | F10 | P   | –   | P   | –   | –   | P   | P   | –   | P   |
| Distortion   | P   | P   | F4,6 | P   | P/B | F10 | P   | –   | P   | –   | –   | P   | P   | –   | P   |
| Amp Sim      | P   | P   | F4,6 | P   | P/B | F10 | P   | –   | P   | –   | –   | P   | P   | –   | P   |
| Bitcrusher   | P   | P   | F4,6 | P   | P/B | F10 | P   | –   | P   | –   | –   | P   | P   | –   | P   |
| Chorus       | P   | P   | F6   | P   | P/B | P   | P   | –   | P   | –   | –   | –   | P   | –   | P   |
| Flanger      | P   | P   | F6   | P   | P/B | P   | P   | –   | P   | –   | –   | –   | P   | –   | P   |
| Phaser       | P   | P   | F6   | P   | P/B | P   | P   | –   | P   | –   | –   | –   | P   | –   | P   |
| Tremolo      | P   | F11 | F6   | P   | P/B | P   | P   | –   | P   | –   | –   | –   | P   | F2  | P   |
| Rotary       | P   | P   | F6   | P   | P/B | P   | P   | –   | P   | –   | –   | –   | P   | –   | P   |
| Delay        | P   | P   | F6   | P   | P/B | P   | P   | –   | P   | –   | –   | –   | P   | F2  | P   |
| Ping-Pong    | P   | F11 | F6   | P   | P/B | P   | P   | –   | P   | –   | –   | –   | P   | F2  | P   |
| Reverb       | P   | P   | F1,6 | P   | P/B | P   | P   | –   | P   | –   | –   | –   | P   | –   | P   |
| Stereo Width | P   | P   | F6   | P   | P/B | P   | P   | –   | P   | –   | –   | –   | P   | –   | P   |
| Auto Pan     | P   | F11 | F6   | P   | P/B | P   | P   | –   | P   | –   | –   | –   | P   | F2  | P   |
| Gain         | P   | P   | F6   | P   | P/B | P   | P   | –   | P   | –   | –   | –   | P   | –   | P   |
| Gain Match   | P   | P   | F6   | P   | P/B | P   | P   | –   | P   | –   | –   | –   | P   | –   | P   |
| Analyser     | P   | P   | F6   | P   | P/B | P   | P   | –   | P   | –   | –   | –   | P   | –   | P   |
| Tuner        | P   | P   | F6   | P   | P/B | P   | P   | –   | P   | –   | –   | –   | P   | –   | P   |
| Vocal Tune   | P   | P   | F5   | P   | P/B | P   | P   | –   | P   | –   | –   | –   | P   | –   | P   |

Instruments, on the same fifteen where they apply:

| Instrument       | 1   | 2   | 3   | 4   | 5   | 6   | 7   | 8   | 9   | 10  | 11  | 12  | 13  | 14  | 15  |
| ---------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MotionSynth      | P   | P   | P   | P   | –   | P   | P   | –   | P   | –   | –   | –   | F7  | –   | P   |
| Sampler          | P   | P   | P   | P   | –   | P   | P   | –   | P   | –   | –   | –   | F7  | –   | P   |
| Drum Rack        | P   | P   | P   | P   | –   | P   | P   | –   | P   | –   | –   | –   | F7  | –   | P   |
| Classic Drum Kit | P   | P   | P   | P   | –   | P   | P   | –   | P   | –   | –   | –   | F7  | –   | P   |
| Instrument Rack  | P   | –   | P   | P   | –   | P   | P   | –   | P   | –   | –   | –   | –   | –   | P   |

And the instrument-only checks:

| Instrument       | Polyphony & stealing | All-notes-off / stop | MPE | Portamento | Factory presets | Tuning & transpose |
| ---------------- | -------------------- | -------------------- | --- | ---------- | --------------- | ------------------ |
| MotionSynth      | F3                   | P                    | –   | P          | P               | P                  |
| Sampler          | F3                   | P                    | –   | –          | –               | P                  |
| Drum Rack        | F3                   | P                    | –   | –          | –               | P                  |
| Classic Drum Kit | –                    | P                    | –   | –          | P               | –                  |
| Instrument Rack  | –                    | P                    | –   | –          | –               | –                  |

Only the MotionSynth and the classic kit ship factory patches (`SYNTH_PRESETS` and
`DRUM_KIT_PARAMS` in `src/model/presets.ts`); the sampler and the drum rack are filled from
the user's own media, so there is no factory set to audition. What was checked for them
instead is that an authored patch round-trips exactly — see check 4.

---

## Evidence per check

**1 — every declared parameter reaches the DSP.** Measured over all twenty-seven kinds and
all 163 parameters (`tests/audit/paramReach.test.ts`): each parameter is moved on its own
from the default patch, and the whole graph's settled state is compared before and after.
Every parameter changes something, with three exceptions the device-function audit already
established as readout-only by design — `gainMatch.target`, `tuner.reference`,
`analyser.view` — and the six Vocal Tune parameters, which drive the audio editor's offline
retune rather than this graph. Seven parameters move nothing in the _default_ patch and
were re-probed in a configuration where they bite: the six EQ8 gain-band switches, because
an off switch ramps the band to 0 dB and the default already is 0 dB, and the Rotary's fast
rate, because the Speed switch starts on Slow. None of the seven is inert; all seven move
the graph once there is something for them to move.

The count is 163 rather than the 165 the device-function audit reports, because the two
shelf `Q` parameters it found dead (H-1) have since been removed from the declaration.

**2 — ranges, units, defaults and tapers.** The device-function audit covered units against
the DSP; what is added here is the taper. Every one of the 163 automation descriptors
round-trips `denormParam(normParam(v)) == v` to better than 1e-9 of its own span across 33
points, log-scaled parameters included. Defaults are inside their declared ranges (existing
`tests/effectCurves.test.ts`). PA-011 is the one failure, and it is a readout rather than a
range.

**3 — automation works on every automatable parameter, and moving one does not zipper.**
Every fx parameter is offered a lane and every lane resolves (measured: the count of `fx:`
descriptors equals the total parameter count). The zipper half is PA-004, PA-001 and
PA-006; PA-005 is a lane that reaches nothing at all. Everything that is written to an
`AudioParam` goes through `setParam`'s `setTargetAtTime` with a 20 ms constant, so those
are ramps by construction.

**4 — preset save/load restores exact state.** Fifty-nine factory effect presets and five
chain presets were applied, serialised, run through the real `validateProject`, and compared
key by key: **zero mismatches**, chain order and per-step bypass flags included. A value off
its own step grid survives unrounded (`-17.3719` stays `-17.3719`). The stronger form also
holds: for all twenty-seven kinds the settled graph built from the reloaded parameters is
identical to the one built from the originals. All eight synth factory presets round-trip
field for field, and a sampler patch in each of its three views — quick, drum and multi,
with filter, LFO and two zones carrying tuning and a choke group — round-trips exactly and
is a fixpoint under a second `validateSampler`.

**5 — bypass click-free, and nulls when neutral.** Click-free is measured: switching any of
the twenty-seven kinds out and back in produces **no** outright assignment and no field
replacement anywhere in the graph — every write is a scheduled ramp. The null test is
BLOCKED; see the opening section for the structural proof that stands in for it.

**6 — reported versus measured latency.** PA-010. Measurement is BLOCKED; the crusher's
group delay is exact arithmetic and matches.

**7 — sample rates 44.1 / 48 / 88.2 / 96 / 192 kHz.** Every kind was built at all five rates
and every settled parameter target compared. Seventeen targets move with the rate and all
seventeen are explained; **zero are unexplained**. Seven are the crusher's hold cascade,
which is a fixed number of _samples_ by definition (1, 2, 4, 8, 16, 32, plus the 1.5-sample
dry alignment at every rate). Ten are `Smoother` poles, and their implied time constants are
identical at every rate — 2.3474 ms and 177.3474 ms for the compressor, 147.3474 ms for the
gate, 77.3474 ms for the limiter, 87.3474 ms for the de-esser, each the remainder after the
2.6526 ms the biquad stage carries. The reverb impulse is 1.800 s at every rate; a
tempo-synced delay is the same number of seconds at every rate.

Two caveats. The export sheet offers 44.1, 48, 88.2 and 96 kHz only
(`src/components/common/ExportSheet.tsx:25`); 192 kHz is reachable only if the device puts
the live context there. And see PA-013.

**8 — buffer sizes 32…1024.** Does not apply; see the opening section.

**9 — mono, stereo and mono→stereo.** Measured. Twenty-two kinds are channel-count agnostic
and let Web Audio's own up-mixing rules apply. Five force an explicit two-channel
interpretation with `makeStereoTap` — Chorus, Tremolo, Rotary, Stereo Width, Auto Pan —
which is required for what each does, and two of those take the image apart with a splitter
(Tremolo, Stereo Width). Stereo Width's side channel is built from gains of +0.5, +0.5,
+0.5 and −0.5, so for a mono source up-mixed to L = R the side is exactly zero at any Width
setting and the processor is a wire — which is the one property a mid/side network has to
have on mono. The Tremolo writes the same depth to both channels, so mono stays centred at
a 0° stereo phase.

**10 — sidechain.** Specified per channel, and the control says exactly which inserts it
reaches: "compressor, gate, de-esser and limiter […] the multiband is the one dynamics
insert it does not reach" (`src/components/mixer/ChannelOverview.tsx:161`). Those four
expose a key input and a detector switch; the Multiband exposes neither, matching the
tooltip and the builder's own comment. One key drives every keyable insert on the channel at
once (`InsertChain.setSidechain`) — including a limiter, which is unusual but is what the
control claims.

**11 — metering accuracy and ballistics.** The four VCA processors publish the mean of a
256-sample window of their own control signal (5.33 ms at 48 kHz), clamped to −80…0 dB, so
the meter is the VCA's gain and carries the processor's own ballistics rather than a second
set. Bypass takes it to exactly 0. The Multiband is PA-008. Channel meters read sample peak
and RMS from a 1024-sample analyser window (21.3 ms at 48 kHz) once per rAF frame
(~16.7 ms); because the window is longer than the interval no peak can fall between two
reads, and the fall is a rate in dB/s from the preference
(`src/audio/engine.ts:1942`). Twenty-two devices publish no meter and their spec's
`gainReduction` flag is absent, which agrees — the general absence of in/out metering on
level-changing devices is already carried as ML-3 in `PROGRESS.md`.

**12 — oversampling.** Five shapers request `oversample: '4x'`: the limiter's brickwall
(`src/audio/effectChain.ts:998`), the Filter's drive stage (`:1268`), the saturator
(`:1338`), the distortion (`:1371`) and the amp sim (`:1407`). The bitcrusher's quantiser is
built at 1× deliberately — the aliasing a bit-reduction folds back is the sound the control
is for — and measures −35.4 dBc of alias at 4 bit.

Aliasing of the curves, a 5 kHz tone at 48 kHz, Blackman-Harris windowed, relative to the
fundamental. The 1× column is what the curve does with no oversampling; the ideal-4× column
is a brickwall reference and is a bound on what the browser's `'4x'` can achieve, not a
description of it:

| Curve                                       | worst at 1× | worst below 16 kHz at 1× | worst with ideal 4× |
| ------------------------------------------- | ----------- | ------------------------ | ------------------- |
| Saturator tube, 36 dB                       | −14.3 dBc   | −17.6 dBc                | −35.5 dBc           |
| Saturator tape, 36 dB                       | −14.3 dBc   | −17.5 dBc                | −32.9 dBc           |
| Saturator transistor, 36 dB                 | −14.3 dBc   | −17.5 dBc                | −32.5 dBc           |
| Distortion, 48 dB, hardness 12              | −14.3 dBc   | −17.5 dBc                | −32.5 dBc           |
| Distortion, 18 dB, hardness 8 (default)     | −14.3 dBc   | −17.5 dBc                | −36.6 dBc           |
| Saturator tube, 8 dB (default), −12 dBFS in | −39.0 dBc   | −44.0 dBc                | −69.8 dBc           |

The −14.3 dBc figure is the fifth harmonic of 5 kHz — 25 kHz — folding back to 23 kHz, at
the −14.0 dBc an ideal square wave's fifth harmonic carries, so the number is right for the
right reason rather than by coincidence. Raising the
factor keeps pushing it down but not monotonically, because which harmonic order lands on
which probe frequency changes with the factor: 1× −14.3, 2× −39.6, 4× −35.5, 8× −63.1, 16×
−62.9 dBc for the tube curve at 36 dB. Four times is not enough at the top of the drive
range; that is an observation about the ceiling, not a defect, and no ticket is raised for
it.

**13 — no NaN or Inf under any parameter combination.** Three fuzz passes over all
twenty-seven kinds, checking every `AudioParam` write, every `WaveShaper.curve` and every
`ConvolverNode.buffer` for a non-finite value. **Zero faults in all three.**
(a) each parameter set to each of fourteen adversarial values — both rails, the midpoint, a
random draw, a full span outside each rail, ±1e-9, ±1e12, `MAX_SAFE_INTEGER`,
`MIN_VALUE` — through `normaliseParams`; (b) the same plus `NaN`, `±Infinity` and ±1e308
_without_ normalising, which is the shape the automation applier delivers; (c) 200 random
whole-parameter-map draws per kind spanning 25 % outside each rail, at a random one of the
five sample rates and a random tempo — 5400 draws. The instruments are PA-007.

**14 — tempo-synced parameters follow tempo and time-signature changes.** PA-002 for the
tempo. The time signature is correctly not consulted, since a sixteenth is a sixteenth in
any meter and no device declares a bar-length division; asserted against a map that changes
from 4/4 to 7/8 at bar 9.

**15 — extreme values do not blow up or self-oscillate.** Every simple cycle in every
recorded graph was enumerated and the product of the gain nodes around it computed. Eight
kinds contain a feedback loop and nineteen contain none. At both rails of every feedback
control — the parameter driven to ±5, far outside its declared range — the largest loop gain
is exactly 0.9 (Delay, Ping-Pong, Flanger, Phaser), which is the clamp. The four control
smoothers sit at 0.9851, 0.9821, 0.9661 and 0.9699, strictly below one, which is what keeps
their DC gain at exactly one rather than above it. Combined with the fuzz above: no
parameter combination found here produces a non-finite value or a loop that grows.

Several devices can still produce very large _gain_ by design — six EQ8 bands can overlap
for +108 dB between them, and a Filter at resonance 20 lifts 26.0 dB at its own cutoff
before its drive stage is counted — with nothing between them and the output but the master
safety limiter. That is what those controls are,
not a runaway.

**Instruments — polyphony, note-off, MPE, portamento, presets and tuning.**

- Polyphony: PA-003. Measured on the synth (60 notes → 60 oscillators, 1 voice cut) and on
  the sampler (80 notes → 80 live voices against a cap of 48).
- All-notes-off and transport stop: `PolySynth.allNotesOff` stops every voice, clears the
  live and sustained maps and clears the glide origin, and a following `noteOff` writes
  nothing at all (measured). `DrumKit.allNotesOff` stops every running hit.
  `RackInstrument.allNotesOff` reaches every child including muted ones (measured), which is
  the correct behaviour — a muted child can still be holding a note from before it was muted.
- MPE: not claimed for these instruments, and declared out of scope in writing —
  `docs/MILESTONE-4-MIDI.md:156`, "Per-note color / CC lanes / MPE — out of scope". Nothing
  in `src/` treats a member channel as anything but a channel filter: `acceptsMidiChannel`
  routes a note to every armed track whose filter accepts its channel
  (`src/audio/midi.ts:25-27`), and pitch bend is parsed as a channel-wide control source
  (`:72`), never as a per-note one. The other MPE mentions in the repository are a list of
  the port types a WAM descriptor can carry (`src/audio/wam/wamEffectNode.ts:34`) and the
  reference sheet for Motion Wave's Phase 8 (`docs/reference/std-01-mpe-midi2.md`), both out
  of scope. Recorded as `–` rather than as a failure.
- Portamento: `synthGlideOf` returns null for a zero glide, for a first note and for a
  repeated pitch, and the ramp is exponential in frequency, which is what a portamento is.
  The morph delay is glided as the reciprocal of the pitch ramp so the pulse width is held
  constant through the slide. Only the MotionSynth has one; the sampler and the kits declare
  none.
- Factory presets, auditioned: all eight synth presets, at velocity 100 on C4, evaluated
  through `ampEnvelopeGain`, which is the Web Audio automation arithmetic rather than an
  approximation of it. Peaks −13.4 to −15.0 dBFS, RMS −19.6 to −28.3 dBFS, and each voice's
  filter is within 1.2 dB of unity at the played fundamental, so none is silent, none is
  choked and none is far louder than its neighbours. Every preset builds a voice without
  throwing, starts every oscillator it owns, and writes no non-finite value. Timbre and
  distortion were not auditioned — that needs a renderer.
- Tuning and transpose: the synth's oscillator is assigned the equal-tempered frequency of
  the key to better than 1e-9 cents at MIDI 21, 45, 60, 69, 96 and 108, anchored at A = 440.
  A sampler zone transposes exactly: an octave up is a rate of 2, an octave down 0.5, key
  tracking off holds 1, a coarse tune of +7 is 2^(7/12), and a fine tune of +50 is 50.000
  cents.

---

## Method

`tests/audit/probeContext.ts` is a `BaseAudioContext` stand-in in the manner of the one in
`tests/effectCurves.test.ts`, with one addition that the questions in this matrix need: it
records _how_ each value was written. An `AudioParam` distinguishes `setTargetAtTime` and
its relatives from an outright assignment to `.value`, records
`cancelScheduledValues` (which is what separates a voice being cut short from a voice being
released), and every mutable node field — `curve`, `buffer`, `type`, `fftSize` — records that
it was replaced and whether the replacement changed anything. It also exposes the stand-in
nodes so a test can supply a field the browser would own, which is the only way to ask what
a builder does with `DynamicsCompressorNode.reduction`.

Seven test files, fifty-six cases, all passing:

| File                                       | What it establishes                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `tests/audit/paramReach.test.ts`           | every control reaches the graph; which controls step rather than ramp; bypass never jumps |
| `tests/audit/automation.test.ts`           | the cost of an automation sweep per device; lane round-trip; the offline grid             |
| `tests/audit/rateAndFuzz.test.ts`          | sample-rate independence at five rates; three fuzz passes                                 |
| `tests/audit/tempoSync.test.ts`            | the tempo map against what the inserts are set to; the division readout                   |
| `tests/audit/instruments.test.ts`          | polyphony, note-off, preset audition, tuning, the instrument fuzz gap                     |
| `tests/audit/presetsMeteringAlias.test.ts` | preset round-trip through the real validator; bypassed metering; aliasing                 |
| `tests/audit/channelsAndLatency.test.ts`   | channel configurations; declared latency; loop gains; the Filter's drive blend            |

Two hypotheses were formed during this audit and then disproved by measurement before they
reached this document, which is the reason the probes exist rather than a reading:

- That the staggered-note case also overran the voice cap. It does not — `retireBy` drops
  each voice about eleven notes after it starts, and the measurement that suggested
  otherwise was counting registry handles, which are released on `onended` rather than on
  retirement. PA-003 is only about notes that share a start time.
- That automation freezes in a backgrounded tab, since `applyAutomation` runs on the rAF
  loop. It does not: it is also the scheduler's `onTick`, and the scheduler runs on a
  worker timer that browsers do not clamp (`src/audio/workerTimer.ts`). What that actually
  means is the opposite of a bug — the applier runs from two drivers at once, which is why
  PA-006's live figure is 60–100 Hz rather than 60.

---

## Regression status

`npm run typecheck`, `npm run lint` and `npx vitest run` were all clean against the tree as
audited: 89 files, 1597 unit tests, of which 57 were the probes added here. No file under
`src/` was modified by the audit.

After the P1 fixes: 91 files, 1610 tests, all passing. The five probes that asserted the
three defects now assert the corrected behaviour, and each keeps the original measurement
in its comment and its log line — a regression test that has forgotten what it is guarding
against is one nobody will recognise when it fails. Two new files cover the machinery the
fixes introduced: `tests/tempoSync.test.ts` (the re-drive gate, including that a 120→160
ramp costs 55 insert passes over 480 frames rather than 480) and
`tests/reverbImpulse.test.ts` (that the tabulated decay curve is inaudible — worst sample
difference 5.96e-8 against the `pow`-per-sample original, half of one Float32 step).
