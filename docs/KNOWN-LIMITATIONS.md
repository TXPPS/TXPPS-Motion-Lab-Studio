# Known Limitations

Honest boundaries of the current release. None of these fail silently —
where a capability is missing the UI says so.

## By design

- No accounts, cloud sync, or collaboration — projects live in one
  browser's storage. Export audio or MIDI to move work between machines.
- No plugin hosting (VST/AU/CLAP) and no marketplace: the web has no
  equivalent sandbox for native plugin code.
- No video track, no disc burning or DDP, and no control-surface protocols
  beyond Web MIDI. All four are named in
  [the reference benchmark](REFERENCE-FSP8.md) §4 with the reason.
- The analysis features (Audio→Notes, Vocal Tune, stem separation, chord
  detection) are classical DSP running locally. They are not trained
  models, they never upload anything, and each panel says what its
  technique separates well and what it does not.

## Audio engine

- **Time-stretch is WSOLA**, so it is honest about transients: an isolated
  click in silence is spread across the frames containing it. Pitch-preserving
  stretch is rendered and cached per (media, speed, semitones); until that
  render lands, playback resamples at the same speed, so a clip can briefly be
  the wrong pitch — which is better than a clip that is silent for the first
  bar of a take.
- **The offline bounce resamples stretched clips** rather than waiting on that
  cache, so a tempo-followed clip's pitch moves in an export. Render it in
  place first if that matters.
- **Sample-rate follows the device** for playback (typically 44.1/48 kHz);
  export renders at whichever of 44.1–96 kHz you choose.
- **No plugin latency compensation.** Every insert here is latency-free except
  the limiter's lookahead and the de-esser's band split, which are compensated
  internally.
- **All media decodes into memory** (~10 MB per stereo minute). There is
  no disk streaming; hour-long multitrack sessions of recorded audio will
  grow memory accordingly. Decode caches are evicted when you switch
  projects.
- **Voice caps.** 128 simultaneous engine sources; 48 voices per sampler
  instrument (oldest voice steals first). Beyond that, notes are skipped
  rather than glitching the audio thread.
- Recording latency compensation is basic (count-in aligned); there is no
  per-device round-trip calibration.

## Browser & platform

See the full [Browser Compatibility](BROWSER-COMPATIBILITY.md) matrix.
Headlines:

- **Web MIDI** is unavailable in Safari and requires a permission prompt
  in Firefox 151+ — the on-screen and computer keyboards always work.
- **Recording format** depends on the browser's MediaRecorder (Opus/WebM
  in Chromium/Firefox; AAC/MP4 in Safari). Imported/recorded audio decodes
  through the browser, so exotic codecs vary by platform.
- iOS/iPadOS: background tabs suspend the AudioContext (playback pauses);
  the silent-switch and route changes are OS-controlled.
- Storage is subject to the browser's quota and eviction policy. The app
  requests persistent storage and shows usage in Diagnostics, but a
  browser under extreme disk pressure can still evict site data — export
  anything irreplaceable.

## Scale (measured, not guessed)

Measured on this project's CI hardware — see
[Performance Notes](PERFORMANCE.md) for numbers:

- Realistic sessions (≤100 tracks / ~1,000 clips / 500 automation lanes /
  11k notes) stay responsive (edits ~14 ms, scroll jumps ~32 ms).
- The absurd-scale fixture (500 tracks / 50,000 clips) stays functional
  but heavy: ~107 ms per edit, ~200 ms full-viewport scroll jumps, and
  ~74 MB heap. Undo history at that scale is memory-hungry (up to 60
  retained versions). This is far past musical use; treat it as headroom,
  not a target.

## Editing

- One undo history per session (60 steps), cleared when switching
  projects.
- The piano roll edits one clip at a time.
- **The score editor engraves but does not edit.** Notes are edited in the
  piano roll or the drum grid; the score reflects them.
- **Warp markers are detected, not dragged.** A clip can follow the tempo, be
  stretched and be transposed, and its transients can be detected; moving an
  individual warp marker on the waveform is not built.
- **Paint, Listen and drag-zoom tools** are not built. Pointer, Range, Split,
  Erase, Mute and Slip are.
- **Cue mixes and project merge** are not built.
- Crossfades require real trim headroom on both clips (the app checks and
  says so).
