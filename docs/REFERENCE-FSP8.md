# Reference benchmark — Fender Studio Pro 8

TXPPS MotionLab Studio is benchmarked against **Fender Studio Pro 8** (the January 2026
rebrand of PreSonus Studio One Pro; version 8 is the first release under the Fender name).
This file is the single shared statement of what "professional, front to back" means for
this project. Every audit, gap list and milestone in `docs/` refers back to it.

MotionLab is a **browser-native** DAW. Where the reference depends on native-only
capability (VST/AU hosting, ASIO drivers, disc burning, hardware control surfaces over
proprietary protocols), the benchmark is _functional parity of the workflow_, not of the
mechanism — the feature must exist and be usable, implemented with web platform
primitives.

## 1. Pages / top-level views

| Reference        | Purpose                                                           |
| ---------------- | ----------------------------------------------------------------- |
| **Start page**   | Recent songs, templates, demos, setup, what's new                 |
| **Song page**    | The workstation: Arrange + Console + Browser + Inspector + Editor |
| **Project page** | Mastering: ordered track list, master chain, loudness, release    |
| **Show page**    | Live performance: setlists, players, patches, per-song setups     |

## 2. Song page anatomy

- **Transport**: play / stop / record / loop / return-to-zero / fast-forward, time display
  (bars·beats·ticks and h:m:s:frames), tempo, time signature, metronome + count-in,
  record mode (overwrite / mix / takes), pre-roll, punch in/out, performance meter.
- **Arrange view**: timeline ruler (bars, time, markers), track headers with
  colour/name/mute/solo/arm/monitor/inserts/sends, clip lanes, automation lanes,
  take lanes, folder tracks, zoom + scroll, **Arrangement Overview** (bird's-eye
  navigator with zoom / pan / highlight).
- **Global tracks**: Marker, Arranger (song sections), Chord, Tempo, Time-signature,
  Video.
- **Track types**: Audio, Instrument, Automation, Folder, Bus, FX channel, VCA.
- **Tools**: Arrow, Range, Split, Erase, Paint, Mute, Bend (time-warp), Listen/scrub,
  Zoom. Snap to grid / events / zero-crossing, adaptive snap, quantize panel.
- **Console (mixer)**: input / insert / send / EQ / dynamics / pan / fader / meter,
  **Channel Overview** (one channel's key parameters on a single horizontal strip),
  channel editor, groups, VCA, cue mixes, sidechain routing, metering (peak, RMS, LUFS,
  true-peak, correlation), spectrum + oscilloscope, plugin/effect presets and chains.
- **Browser**: Instruments, Effects, Loops, Sounds, Files, Pool, Cloud — search,
  favourites, audition, drag to arrange.
- **Inspector**: everything about the selected track/clip/event.
- **Editors**: Music (piano roll), Drum, Score/notation, Audio editor, Automation.

## 3. Editing and production capability

- Comping and take lanes; playlists; loop recording.
- Non-destructive audio editing: trim, split, heal, fades, crossfades, gain, normalize,
  phase invert, mono sum, strip silence, ripple edit, slip, nudge, insert silence.
- **Audio bend / warp**: transient detection, warp markers, timestretch, tempo-follow,
  groove extraction and groove quantize.
- **Melodyne-class pitch editing** → in MotionLab: **Vocal Tune** (pitch detection,
  correction strength / speed / formant, scale snapping, per-note manual pitch).
- **Audio → Note** (AI in the reference): convert audio to editable MIDI, monophonic and
  polyphonic.
- **Stem separation** (AI in the reference): split a mix into vocals / drums / bass /
  other.
- **Chord track + Chord Assistant**: detect chords, suggest progressions, make events
  follow the chord track.
- **Arranger track + Scratch Pads**: named song sections, drag to reorder, sandbox
  arrangements.
- **Note FX**: arpeggiator, chorder, repeater, input filter.
- **Event FX**: per-clip insert effects, render/transform to audio.
- **Instruments**: sampler (Sample One), drum sampler (Impact), virtual analogue synth,
  multi-instrument layering, macro controls.
- **Effects**: EQ, compressor, limiter, gate/expander, multiband, de-esser, saturation /
  distortion, amp + cab modelling, chorus, flanger, phaser, tremolo, auto-filter,
  rotary, delay (tempo-synced, ping-pong), reverb, stereo width, bitcrusher, tuner,
  analyser, vocal tune.
- **Automation**: read / touch / latch / write / off, curve shapes, tempo automation,
  automation of every effect and instrument parameter.
- **Mixdown / export**: master mixdown, stems, per-track, loop range, multiple formats,
  dithering, normalisation, metadata.
- **Import**: audio, MIDI file, project merge.
- **Macros, key commands, control link, themes, UI scaling.**

## 4. What MotionLab does _not_ attempt

Stated up front so "complete" stays honest:

- Third-party plugin hosting (VST/AU/AAX) — the web has no equivalent sandbox.
- Physical disc burning / DDP on the Project page.
- Proprietary control-surface protocols beyond Web MIDI.
- Video track scoring beyond a simple reference video (no video export).

Everything else on this page is in scope for MotionLab v2.
