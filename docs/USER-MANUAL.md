# MotionLab Studio — User Manual

A browser DAW: multitrack audio + MIDI arrangement, recording, comping,
automation, synths, samplers, drum racks, mixing with effects and sends,
and offline WAV export. Everything runs locally in your browser; projects
persist in browser storage.

For a first session, read the [Quick Start](QUICK-START.md). Keyboard
shortcuts: press **?** in the app.

---

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
- **Editor** (bottom) — Mixer, Piano Roll, Synth/Sampler, Diagnostics tabs.

On tablets the side panels become drawers; on phones the bottom navigation
switches whole workspaces (Arrange / Record / Perform / Edit / Mix /
Browse).

## 2. Tracks and clips

**+ Track** (or right-click the track area) creates Audio, Instrument,
Quick Sampler, Drum Rack, Multisample, classic Drum, or Bus tracks. Track
headers carry arm, mute, solo, volume, pan, collapse, and the **⋯** menu
(duplicate, delete, color, lock, edit group).

Clips: drag to move, drag edges to resize/trim, **Alt-drag** to copy,
double-click MIDI clips to edit notes, right-click for the full menu
(split, join, duplicate, fades, normalize, phase invert, mono sum, lock…).
Marquee-drag selects many; **Ctrl+C/V/X** work across tracks. Snap and
zoom controls live in the arrangement toolbar; the slip tool (**5**)
slides audio inside a clip without moving the clip.

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
