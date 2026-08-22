# MotionLab Studio v2.0

v1 was a very well-built Song page. v2 is a DAW.

The work was scoped by a role-based audit of the v1 codebase against
[Fender Studio Pro 8](REFERENCE-FSP8.md) — ten discipline leads read the source and
reported what was missing, wrong, shallow or unpolished, and the result became
[the build plan](BUILD-PLAN-V2.md). [`PARITY.md`](PARITY.md) is the answer, feature by
feature.

## Correctness fixes that came first

These were live bugs in v1, found by the audit and fixed before any feature work:

- **Starting or looping into a recorded clip was silent.** The mid-clip gate asked the
  procedural demo table for the media's duration, which returns 0 for anything real.
- **Bounces lost notes.** Voice stealing cut voices at `ctx.currentTime`, which stays 0
  for the whole of an offline render, so any track past the voice cap lost its earliest
  note in the export but not in playback.
- **The master fader was inert on every saved project.** The store wrote only the legacy
  `masterVolume` scalar while the engine read `master.volume`, which validation always
  materialises.
- **The metronome was metered as programme** and squeezed by the safety limiter, because
  it was wired into the master analyser rather than the destination.
- **Playback broke up in a background tab.** The transport ran on `setInterval`, which
  browsers clamp to about 1 Hz when hidden. It now runs on a worker timer, and
  control-rate automation rides the same tick instead of the animation frame.
- **The reverb was different every time.** Its impulse was built from `Math.random()` per
  node, so a bounce never matched what was monitored and two bounces never matched each
  other. It is seeded from the effect's own id.
- **Undo could wedge open.** A drag whose clip scrolled out of the arrangement's view
  window unmounted mid-gesture, never saw `pointerup`, and left the undo gesture open —
  silently making every later edit non-undoable. Two simultaneous touch drags did the
  same by sharing one snapshot slot.
- **Two tabs destroyed each other's work.** Both autosaved the same project every 1.5 s,
  and because a save rewrites the single backup, the copy that could have rescued the
  loser was overwritten too.

## What is new

**Four pages.** Start, Song, Release (mastering) and Live (show), behind a real router
with code-split pages.

**A tempo map.** Tempo jumps and linear ramps, mid-song signature changes, and one
integral-based beat/second conversion shared by playback, recording, import, waveform
layout, automation and the offline bounce.

**Global tracks.** Markers, arranger sections that carry their contents when reordered, a
chord track, and a tempo track — over an Arrangement Overview that maps the whole song.

**A console.** Input trim with polarity and mono sum, named insert slots, send rows,
stereo metering with a printed dB scale, solo-safe, folder tracks, VCA faders, FX
channels, a real master channel with its own chain, and a Channel Overview.

**27 effects** with plugin faces — the EQ's own magnitude curve with draggable handles,
the compressor's transfer curve and live gain reduction, the waveshaper's curve, the
modulator's LFO, live spectrum and scope.

**Six editors** from one registry: piano roll, drum grid, an editable score, audio
editor, chord assistant, console.

**Recording that keeps what was played.** An armed instrument or drum track records MIDI
from every input — hardware, the on-screen keys, the computer keyboard — with a chord
still held at the stop kept rather than dropped.

**Cue mixes.** A separate headphone balance per performer off the same channels, where
every channel nobody has touched follows the main mix, and any cue bounces to its own
file.

**Control Link.** Bind a knob, fader, pedal or button to the transport, a macro or any
automatable parameter by moving it.

**Project merge.** Another song's tracks, routing, sends, automation and global tracks
land at the playhead, re-identified so nothing collides.

**Audio intelligence**, all local and offline: Audio→Notes (mono and poly), Vocal Tune,
stem separation, transient and tempo detection, draggable warp markers rendered through a
pitch-preserving stretcher, groove extraction and application, chord detection.

**Delivery.** Stems and per-track bounces through the same signal path the mix used, WAV
and FLAC at any depth and rate, TPDF and shaped dither, true-peak normalisation, metadata,
and a BS.1770 measurement of every rendered file. MIDI file import and export.

**The product around it.** Four themes, interface scaling, preferences, a session lock,
CI on every push, and a bundle budget.

## Known limits

Stated in full in [`PARITY.md`](PARITY.md) and [`KNOWN-LIMITATIONS.md`](KNOWN-LIMITATIONS.md).
The ones worth knowing before you start:

- **Stem separation is classical DSP, not a trained model.** It separates a well-recorded
  mix usefully and a dense one only partly. The four stems always sum back to the input.
- **The offline bounce resamples stretched clips** rather than waiting on the
  pitch-preserving stretch cache, so a tempo-followed clip's pitch moves in an export.
- **The score edits pitch, timing and duration.** Velocity, mute, per-note pan and
  detune, off-grid placement and the quantize tools stay piano-roll work.
- **A warp render lands a moment after the drag**, like a tempo-follow stretch: a clip
  already sounding keeps playing the previous render until the new one is ready.
- **No third-party plugin hosting.** The web has no equivalent sandbox.
