# User Manual

MotionLab Studio is a complete DAW that runs in a browser. This manual is the
short version: what each surface is for and the handful of gestures that are not
obvious. [`PARITY.md`](PARITY.md) says what exists and what does not;
[`KNOWN-LIMITATIONS.md`](KNOWN-LIMITATIONS.md) says where the edges are.

## The four pages

The top bar switches between them.

- **Start** — recent projects, and six templates that build a routed session
  rather than an empty timeline.
- **Song** — the workstation. Everything below is here.
- **Release** — put finished mixes in order, measure them to BS.1770 against a
  delivery target, and export the set.
- **Live** — a setlist. Each entry carries its own tempo, signature, start point
  and a note; stage mode makes it readable from the back line.

## The song page in ninety seconds

- **Global tracks** sit above your tracks: markers, arranger sections, chords
  and tempo. The toolbar's section button shows and hides them.
- **The overview strip** above the ruler maps the whole song. Click it to jump;
  drag its window to scroll.
- **The ruler** reads wall clock over bars and beats. Drag its upper half to set
  the loop, click its lower half to move the playhead.
- **Tools** are 1–6: Pointer, Range, Split, Erase, Mute, Slip. The Range tool
  selects time across tracks — right-click the range for what you can do to it.
- **The editor panel** at the bottom holds the mixer, piano roll, drum grid,
  score, audio editor, chord assistant, instrument and diagnostics. A tab that
  is dimmed says what it needs.
- **The inspector** on the right is everything about what is selected: the
  track, the clip, its inserts, sends, note effects, macros and time/pitch.

## Gestures worth knowing

- **A knob**: drag to change, Shift for a ten-times finer ride, double-click for
  the default. Every knob in the product works this way.
- **Solo**: click to solo, right-click for solo-safe (a reverb return that
  should survive any solo).
- **An insert slot in the console**: click to open it in the inspector,
  right-click to bypass.
- **A tempo event**: drag up and down to change the tempo, sideways to move it,
  right-click to make it a ramp.
- **A section**: drag its right edge to resize, right-click to reorder — and the
  clips, automation, markers and chords inside it move with it.

## 1. The workspace

- **Top bar** — project name (click to rename), undo/redo, save, panel
  toggles, diagnostics, and the **⋯** menu (export, shortcuts, welcome
  tour).
- **Transport** — play/stop/record, position, tempo, time signature, loop
  toggle, metronome, master volume. **Space** toggles playback.
- **Browser** (left) — Projects, synth Presets, audio Loops, and Samples.
- **Arrangement** (center) — tracks and clips on a beat timeline.
- **Inspector** (right) — the selected track's or clip's parameters,
  inserts and sends.
- **Editor** (bottom) — Mixer, Piano Roll, Drums, Score, Audio, Chords,
  Instrument and Diagnostics tabs.

On tablets the side panels become drawers; on phones the bottom navigation
switches whole workspaces (Arrange / Record / Perform / Edit / Mix /
Browse).

**Full screen.** Every pane carries an expand control (⛶ in its corner or
tab bar): the arrangement, the bottom editor and — on desktop — the
browser and inspector. Expanding takes over the whole workspace; the same
control restores the exact previous layout, keeping your scroll position,
selection and undo history. On tablets, expanding the editor gives a
single-editor workflow with the Mixer/Piano/Instrument switcher still
available. The choice persists with your workspace layout.

## 2. Tracks and clips

**+ Track** (or right-click the track area) creates Audio, Instrument,
Quick Sampler, Drum Rack, Multisample, classic Drum, Bus, FX Channel, VCA
fader or Folder tracks. Track
headers carry arm, mute, solo, volume, pan, collapse, and the **⋯** menu
(duplicate, delete, color, lock, edit group).

Clips: drag to move, drag edges to resize/trim, **Alt-drag** to copy,
double-click MIDI clips to edit notes, right-click for the full menu
(split, join, duplicate, fades, normalize, phase invert, mono sum, lock…).
Marquee-drag selects many; **Ctrl+C/V/X** work across tracks. Snap and
zoom controls live in the arrangement toolbar; the slip tool (**6**)
slides audio inside a clip without moving the clip, and the range tool
(**2**) selects time across tracks for the range edits.

Locked clips/tracks refuse timing edits. Edit groups link selection across
their member tracks.

## 3. Recording and comping

Arm an audio track, optionally enable input monitoring, then press
transport **Record**: a count-in plays, capture starts at the playhead,
and the take becomes a clip when you stop. Recording over an existing clip
stacks **takes**: open the take lanes (clip menu), swipe across a lane to
comp that range from that take, click a lane to audition it, and promote,
mute, reorder or delete takes. Comp joins get micro-fades automatically.

If a recording is interrupted (tab closed, crash), the captured audio is
kept and offered for recovery on the next start.

## 4. MIDI and the piano roll

Double-click a MIDI clip (or open the Piano Roll tab) to edit notes: draw,
drag, resize, velocity-paint, marquee-select, quantize (with strength and
swing), transpose, humanize, scale-snap, and step input. The keyboard row
A–L plays notes live; **Z/X** shift octave. Web MIDI devices work where
the browser supports them (see the compatibility matrix) — enable in the
Synth tab's MIDI section.

## 5. Instruments

Every instrument track hosts one of:

- **MotionSynth** — 2-osc subtractive synth with filter, envelope, LFO and
  presets.
- **Quick Sampler** — one sample across the keyboard: trim with
  zero-crossing assist, loop/reverse/one-shot, tune, normalize, filter,
  LFO, slicing (transients → pads or a MIDI clip).
- **Drum Rack** — up to 104 pads with per-pad sample, name, color, tune,
  gain, pan, choke group; drag samples from the browser onto pads.
- **Multisample** — key zones × velocity layers × round-robins with
  crossfaded overlaps.
- **Instrument Rack** — layered/split synth and sampler children with
  per-layer key ranges and mute/solo.

Switch kinds with the instrument-type menu in the Synth tab header.
Sampler master parameters (`smp:` ids) are automatable like synth ones.

## 6. Mixing

The Mixer tab shows every track as a strip: fader, pan, mute/solo, meters
with clip hold, insert chain and sends. **Inserts**: EQ (3-band), filter,
compressor, saturator, delay, reverb, trim, gate — reorder by drag, bypass
per effect. **Sends** feed bus tracks (pre/post fader); buses route to
master or other buses (cycles are rejected). Automation modes (read /
touch / latch / write) sit at the top of each strip.

## 7. Automation

Open a track's automation lanes (track header **A** button). Any
automatable parameter — volume, pan, mute, sends, insert parameters,
synth/sampler parameters, tempo — gets a lane with draggable points and
per-segment curve shapes (linear, exp, log, S, stepped). Recording modes
capture fader/knob moves during playback. Automation applies sample-
accurately where the parameter supports ramps and is reflected in export.

## 8. Browser and media

- **Projects** — create, open, save, save-as, duplicate, rename, delete.
- **Presets** — synth presets applied to the selected instrument track.
- **Loops** — generated loops plus this project's imported/recorded audio;
  tap to place on the timeline at the playhead.
- **Samples** — every sample source with search, category chips,
  favorites, recents, waveform thumbnails and preview; tap to load into
  the target instrument, or drag onto pads/zones/drop areas.

Import audio by dropping files onto a track or via **Loops → Import audio
file** (WAV/MP3/M4A — whatever the browser decodes). Recordings and
imports are stored in the browser alongside the project.

## 9. Export

**⋯ → Export mix as WAV** renders the whole project offline (not a live
capture): clips, notes, instruments, effects, sends and automation render
exactly as playback schedules them. **Export loop region** bounces just
the loop. Files download as 16-bit WAV.

## 10. Saving, backups and recovery

- Autosave runs ~1.5 s after each change; the status bar shows save state.
- Every save keeps the previous version as a backup; if a stored project
  can't be read, the backup restores automatically.
- Closing with unsaved changes triggers a final save and a confirmation.
- If autosave ever fails (storage full/blocked), a warning toast appears —
  the app never fails silently. Check Diagnostics for details.

## 11. Diagnostics

The Diagnostics tab (or wrench icon) shows version, environment, detected
browser features, audio/MIDI state, storage usage, project stats and the
event log. **Copy Report** / **Download** produce a shareable diagnostic
package (no audio content included). **Run Smoke Test** exercises audio,
storage and state round-trips. **Panic** stops all sound and input
immediately.
