# Milestone 7 — Sampler, Drum Rack & Instrument Workstation

**Describes commit `00024d9f14`.** History — a record of one tree at one
moment, which cannot go stale because it was never a claim about now.

Baseline commit: `cfe238c558` (Milestone 6 complete).

## Architecture

### One zone model, three views

`src/model/sampler.ts` defines the entire sampler as data: a `SamplerParams`
object holding master envelope/filter/LFO settings and a flat list of
`SampleZone`s. A zone is a mapping — media id, key range, velocity range, root
note, playback window (start/end seconds), loop window, reverse, one-shot,
gain/pan/tune, choke group, round-robin group, optional slice markers.

The `view` field (`quick` | `drum` | `multi`) is **only a UI hint**. The Quick
Sampler is a one-zone instrument; a drum pad is a fixed-key, non-key-tracking
one-shot zone; a multisample is many overlapping zones. The engine never
branches on the view, so anything the drum rack can do (chokes, per-pad tune)
the multisample can also do, and switching views never rebuilds audio state.

Zone lookup is pure math (`matchZones`): mute/solo filtering, key/velocity
range tests, round-robin selection via a caller-owned counter map, and a
linear crossfade through overlapping key ranges so multisample joins do not
step. `zonePlaybackRate` folds key tracking and coarse/fine tune into one
playback-rate factor. All of it is unit-tested without an AudioContext.

### Voice engine

`src/audio/samplerInstrument.ts` implements the same `Instrument` interface as
the synth (`scheduleNote`, `noteOn`, `noteOff`, `setSustain`, `allNotesOff`,
`dispose`), which is why the scheduler, live keyboard, MIDI input, automation
applier and offline export needed **no sampler-specific cases**. Each voice is
`BufferSource → (Biquad) → Gain (ADSR) → Panner → track channel`, with an
optional shared LFO targeting pitch or filter. Reversed playback uses a
per-buffer reversed copy held in a `WeakMap` cache. Choke groups release
same-group voices on trigger; a 48-voice cap per sampler releases the oldest
voice first and every voice registers with the engine's global 128-source
budget.

`RackInstrument` composes child instruments (synth or sampler) with per-child
key ranges and mute/solo. It dispatches the same `Instrument` calls to whichever
children accept the key, so racks work everywhere instruments work — including
inside the offline render, which builds the same rack from project data.

### Persistence and automation

Schema v5 adds `track.sampler` and `track.rack`. `validateSampler` clamps
every numeric field and drops unusable zones; the v4→v5 migration validates
per-track and per-rack-item, dropping malformed entries rather than failing
the load. `smp:` parameter ids (volume, filter cutoff/resonance, ADSR, LFO)
register in the same parameter registry as `synth:` ids, so lanes, the
automation applier, and the export path handle them with the code that
already existed.

## Quick Sampler guide

Select an instrument track and choose **Quick Sampler** in the synth panel's
instrument-kind menu (or create one from **+ Track → Quick Sampler Track**).
Drag a sample from **Browser → Samples** into the drop area, or load the demo
loop.

- **Trim**: drag the handles on the waveform. Edges snap to zero crossings;
  hold **Alt** to bypass the snap. The dimmed regions are outside the
  playback window. Trims are non-destructive — the source media never changes.
- **Root / Tune**: the root note plays the sample unpitched; coarse is
  semitones, fine is cents.
- **LOOP / REV / 1SHOT**: loop the window, reverse playback, ignore note-off.
- **Normalize**: sets zone gain so the windowed peak hits −0.3 dBFS.
- **Envelope / filter / LFO** in the header apply to the whole instrument and
  are automatable as `smp:` parameters from the track's automation lanes.

### Slices

**Detect transients** marks onsets with a deterministic RMS-jump detector
(honest assistant, not an oracle — expect good results on percussive
material). Markers show on the waveform; **Clear** removes them.

- **Slices → pads** converts each slice into a drum pad (the view switches to
  the drum rack; each pad plays its slice window from the same media).
- **Slices → MIDI** creates a MIDI clip at the playhead whose notes trigger
  the slices in order — swap the instrument to the sliced pads and the clip
  replays the loop, ready for rearranging.

## Drum Rack guide

Choose **Drum Rack** as the instrument kind, or load the built-in
procedurally generated kit. Pads start at **C1** and up to 104 pads stay
MIDI-addressable.

- **Assign**: drag any row from Browser → Samples onto a pad (or tap a row to
  fill the first free pad). Dropping on an occupied pad replaces it.
- **Pad detail** (click a pad): rename, color, mute/solo, gain, pan, pitch
  (semitones), choke group — pads sharing a choke group cut each other, e.g.
  closed hat choking the open hat.
- Pads preview on click once audio is running; MIDI clips trigger them at
  the pad's key.

## Multisample guide

Choose **Multisample** to see the zone list. Each row is one zone: key range,
root, velocity range and round-robin group, with a strip showing its keyboard
placement.

- Overlapping key ranges crossfade linearly through the overlap.
- Velocity ranges layer (e.g. soft/hard samples on the same keys).
- Zones sharing a **RR** group alternate per trigger.
- Rows are memoized against the fields they render, so 500+ zone instruments
  stay responsive while editing.

## Instrument Rack guide

Every instrument track has a rack section; adding a layer converts the track
to a rack (the kind menu shows **Instrument Rack**). Each layer is a full
synth or sampler with its own key range, mute/solo, name, color and order —
overlap ranges to layer, separate them to split the keyboard. Layers share
the track's channel strip, sends, inserts and automation. Removing the last
layer returns the track to its previous single instrument.

## Media & browser guide

**Browser → Samples** lists every sample source in one searchable list:
procedural one-shots and loops (repository-safe, generated at runtime) plus
the project's imported files and recordings, with duration/channel/rate
metadata and waveform thumbnails (skipped above 200 rows to keep the list
cheap).

- **Chips** filter by category; **★** favorites persist in localStorage;
  **Recent** tracks what you've auditioned, dragged or loaded.
- **Tap** a row to load it into the target instrument track — the first free
  pad on a drum rack, otherwise the quick sampler.
- **Drag** a row onto a pad, the quick-sampler drop area, or anywhere that
  accepts the internal `text/x-ml-media` payload.
- The play button auditions through the master bus; one audition at a time.

## Performance

Measured on this repository's CI runner (software rasterizer — numbers are
budgets for that environment, not hardware claims):

- `#/qa-drums` (100 assigned pads + 256-hit pattern): panel opens < 8 s
  budget (measured ~0.6 s), playback produces signal, active sources return
  to ≤ 2 after stop.
- `#/qa-multisample` (512 zones): zone list opens < 10 s budget (measured
  ~1.7 s including fixture boot); a single zone edit re-renders within a 4 s
  budget (measured well under it) thanks to memoized rows.
- A sampler-only project (every track sampler or rack) renders offline to a
  valid, non-silent WAV with zero missing media — the proof that export
  treats samplers as first-class instruments.

## Testing

- `tests/sampler.test.ts` — zone lookup (ranges, mute/solo, round-robin,
  crossfades, playback rate), slicing helpers (zero-crossing snap, transient
  gap rule), kit/preset builders, validation clamps, store ops
  (setInstrument, assignPad, slices→pads/MIDI, rack CRUD) and `smp:`
  parameter registration.
- `e2e/sampler.spec.ts` — 12 browser tests: trim drag with snap, slices to
  MIDI clip and pads through the UI, pad select/preview/mute, drag-and-drop
  pad assignment, kind switching, rack layer add/reorder, samples-tab
  search/favorites/tap-to-load, `smp:` automation binding, offline-render
  audibility, live meters + voice cleanup, and the two scale fixtures.

## Deliberately deferred

- **Disk-streaming / large file mapping** — all media decodes to memory;
  fine at this project's media sizes, wrong to claim beyond them.
- **Per-zone envelopes and filters** — master envelope/filter with per-zone
  gain/pan/tune ships now; the zone model has room for per-zone overrides.
- **Round-robin reset modes and random RR** — deterministic rotation only.
- **Sample-library import of SFZ/EXS/Kontakt formats** — out of scope.
- **Time-stretching inside zones** — same honesty rule as M6: no unreliable
  global stretch.
- **Recording directly into a pad** — recordings land in project media and
  can be assigned from the browser instead.
