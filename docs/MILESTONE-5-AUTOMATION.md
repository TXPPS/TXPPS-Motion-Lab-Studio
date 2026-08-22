# Milestone 5 — Automation, Modulation, Mixing & Professional Production

One automation system for every parameter: track volume, pan, mute, sends,
insert-effect parameters and synth parameters all move through the same lane
model, the same editing surface, the same playback applier and the same
offline-render path. Nothing here is a per-parameter special case, which is
what keeps 500 lanes affordable and the behavior predictable.

## 1. Verification status

| Area                                                                                      | Status                                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unified lane model (normalized values, sorted points, five curve shapes)                  | Implemented; 32 unit tests over curve math, interpolation, validation, store ops, fixture integrity                                                      |
| Parameter binding registry (volume/pan/mute, sends, insert params, synth params)          | Implemented; ids, names, units, ranges, defaults, log/linear scaling, formatting; unit-tested round-trips                                                |
| Serialization + schema v3 migration                                                       | Implemented; malformed lanes dropped, values clamped, dangling parameter ids removed; v2 projects load unchanged                                         |
| Lane UI (expand/collapse, resize, names, value readout, per-family colors)                | Implemented; e2e drives every control through real pointer events                                                                                        |
| Point editing (add, delete, drag, marquee, multi-select, copy/paste/duplicate, undo/redo) | Implemented; e2e verified including single-step undo for paste and delete                                                                                |
| Curves (linear, exponential, logarithmic, S-curve, stepped)                               | Implemented; unit-tested math; curve menu e2e verified; showcase track in the QA fixture                                                                 |
| Live playback application                                                                 | Implemented; control-rate (per animation frame) with 15ms `setTargetAtTime` smoothing — **not** claimed sample-accurate (see §4)                         |
| Offline render application                                                                | Implemented; fader-domain lanes become scheduled ramps (sample-accurate between knots); e2e measures rendered amplitude actually following a volume ride |
| Automation modes: Read, Touch, Latch, Off                                                 | Implemented; touch e2e-verified end to end (fader ride during playback lands in the lane)                                                                |
| Write and Trim modes                                                                      | **Deferred** — see §6                                                                                                                                    |
| Mixer: track colors, bus tags with feed counts, automation indicator                      | Implemented; screenshot-inspected                                                                                                                        |
| Sidechain routing                                                                         | **Deferred** — see §6                                                                                                                                    |
| 100 tracks / 500 lanes / 100k points fixture (`#/qa-automation`)                          | Implemented; exact counts unit-asserted; e2e asserts bounded DOM, scroll budget, editing during playback                                                 |
| Tempo automation                                                                          | **Deferred** — see §6                                                                                                                                    |

Totals after M5: **228 unit tests**, **137 e2e tests**, strict TypeScript,
ESLint clean.

## 2. Architecture

### The model (`src/model/automation.ts`)

A lane is `{ paramId, points[], enabled, height? }`; a point is
`{ beat, value, curve }` where **value is normalized 0..1**. The descriptor in
the registry maps normalized values to real units (linear, or logarithmic for
frequencies), which buys three things at once: every lane renders and edits
identically, curve math never needs to know its domain, and copying a volume
ride onto a filter lane is well-defined.

Points stay sorted — every mutation funnels through one normalizer — so
readers binary-search. `laneValueAt` holds the first value before the first
point and the last after the last; the curve stored on a segment's _left_
point shapes it (`exp` = t³, `log` = 1−(1−t)³, `s` = smoothstep, `step` =
hold-then-jump).

### The binding registry (`src/model/paramRegistry.ts`)

Every automatable control advertises `{ id, name, unit, min, max, default,
scale, format, get }`. Ids are stable within a track: `volume`, `pan`,
`mute`, `send:<busId>`, `fx:<effectId>:<paramKey>`, `synth:<key>`. Insert
parameters reuse `EFFECT_SPECS` — adding an effect parameter automatically
makes it automatable with the right range and unit. Deleting a send, insert
or bus removes its dependent lanes in the same store commit; persistence
validation drops any lane whose parameter no longer resolves, so a dangling
binding cannot survive either path.

### Playback (`engine.ts`)

On every project change the engine resolves lanes into a flat index and
records which core parameters automation now owns; `syncGraph` stops driving
those statically. Each animation frame the applier evaluates every indexed
lane at the playhead and, when a value moved more than an epsilon, applies it:

- volume/pan/send → `setTargetAtTime` (τ = 15ms) on the channel nodes
- mute → the mute gate, honoring manual mute/solo first
- insert params → in-place `update` of the effect node (its own 20ms ramps),
  with the same overrides passed into `sync` so a static re-sync never stomps
  an automated value
- synth params → an override map merged into `getParams`, so voices pick up
  automated values when they are scheduled (per-voice granularity)

Nothing is ever assigned directly to `AudioParam.value`, so control-rate
updates cannot produce zipper steps. When the transport is stopped the same
applier runs at the paused position — seeking previews automation, and a
disabled lane hands its parameter back to the static value on the next sync.

### Offline render (`exportMix.ts`)

The bounce schedules fader-domain lanes (volume, pan, mute, sends) as explicit
`linearRampToValueAtTime` sequences — curved segments subdivided ×16, stepped
jumps landed over 2ms — which is sample-accurate between knots. Insert-param
lanes apply through an `OfflineAudioContext.suspend()/resume()` control grid
(25ms, capped at 4800 suspensions with the grid widening for very long
renders). Synth-param lanes are evaluated per note at its start beat, matching
the live engine's per-voice semantics. An e2e test renders a volume ride to
zero and asserts the last quarter of the audio is at least 70% quieter than
the first — the render provably follows the lane.

### Editing surface (`AutomationLanes.tsx`)

Lanes expand beneath their track in the arrangement; both columns are driven
by one band-height function so headers and rows cannot drift. Rendering is
windowed exactly like clips and piano-roll notes: the SVG spans only the
visible window, segments are sampled adaptively (~7px steps, 3..24 per
segment), only points in the window mount, and selected points always mount
(the pointer-capture rule). Double-click adds, double-click on a point
deletes, drag moves (Shift = fine values, Alt = no snap), empty-space drag
marquee-selects, right-click carries curves and lane operations, and
Del/Ctrl+C/V/D route to the point selection when one exists. An empty lane
draws the parameter's current static value as a dashed line.

## 3. Mixing improvements

- Bus strips carry a colored `BUS n` tag whose tooltip names every track
  feeding the bus (by output routing or an enabled send), and take a subtle
  background tint.
- Tracks with active automation show an amber `A` chip naming the lane count
  and mode.
- Fader and pan moves on the mixer and track headers route through the touch/
  latch recorder; the strip color variable now also drives the bus tag and
  name so the arrangement's color language carries into the mixer.

## 4. What "no zipper" and "sample-accurate" mean here — honestly

- **Live playback** is control-rate: values update once per animation frame
  (~60Hz when the tab is foreground) and every update is a 15ms exponential
  ramp. This is inaudible as stepping in normal use, but it is not
  sample-accurate and is not claimed to be.
- **Offline render** schedules real ramps for volume/pan/mute/send lanes —
  sample-accurate between segment knots by construction. Insert-param lanes
  in the render are control-rate (25ms grid).
- No spectral measurement of zipper noise was performed; what is verified by
  test is that rendered amplitude follows the lane and that no path assigns
  `AudioParam.value` directly.

## 5. Performance (measured on this CI's software rasteriser)

`#/qa-automation` loads 100 tracks, exactly 500 lanes and exactly 100,000
points (unit-asserted). With the showcase and two dense tracks expanded, the
e2e run measures: mounted point elements bounded under 1,600; twenty
horizontal scroll hops averaging under the 130ms/step budget; and a point
drag completing during playback with the transport still running. The live
applier's per-frame cost is bounded by an epsilon skip per lane — lanes whose
value did not move do not touch the graph.

## 6. Deferred, and why

- **Write mode** — overwrite-from-transport-start needs punch-in/punch-out
  semantics and a preview of what will be destroyed; shipping it as "latch
  that deletes more" would be dishonest to its name.
- **Trim mode** — relative offsets over existing lanes require a second
  rendering layer (base curve + trim delta) to be legible; the milestone's
  budget went to making absolute automation solid.
- **Sidechain compression** — `DynamicsCompressorNode` has no external
  detector input; a real implementation needs an AudioWorklet compressor,
  which deserves its own DSP milestone. Nothing fake is shipped: no routing
  UI exists that does not do what it says.

  _Resolved in v2._ The diagnosis was right and the prescription was not: no
  AudioWorklet was needed. `ControlVca` builds a detector out of ordinary
  nodes, so every dynamics processor has a real external key input. The
  routing UI shipped ahead of the compressor being keyable, though, which
  left exactly the situation this bullet was written to prevent — see
  [`PARITY.md`](PARITY.md) for what a key reaches today.

- **Tempo automation** — the scheduler's beat↔time mapping and every open
  anchor assume constant tempo inside a window; automating BPM means
  integrating the tempo curve through the scheduler, export and recording
  offset math together. Foundation deliberately not started rather than half
  built.
- **Per-lane live readouts during playback** — lane headers show the value at
  the playhead, recomputed on edits; they do not chase the playhead per frame
  (500 lanes would mean 500 rAF subscribers).

## 7. Testing

- `tests/automation.test.ts` — 32 tests: curve endpoints and monotonicity,
  interpolation (holds, exact hits, binary-search vs linear reference),
  segment sampling, normalization, lane validation, registry listing and
  log/linear round-trips, stepped mute, store ops (single-step undo for
  insert/delete), touch-capture overwrite semantics, fixture exact counts.
- `e2e/automation.spec.ts` — 8 tests: lane creation through the picker; point
  add/drag/marquee/delete/undo; curve menu; copy/paste at the playhead and
  duplicate; lane disable/resize/remove and the A toggle; live value
  resolution during playback; offline render amplitude verification; save →
  reload persistence; touch capture; and the 100k-point stress test.
- Prior suites (129 e2e, 196 unit) all pass unchanged — automation changed
  `syncGraph`, the scheduler path and the export graph, and the recording,
  editing, piano-roll and layout tests are the regression net that proves
  those changes broke nothing.
