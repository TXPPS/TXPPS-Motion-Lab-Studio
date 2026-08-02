# Known Limitations

Honest boundaries of the current release. None of these fail silently —
where a capability is missing the UI says so.

## By design (feature freeze)

- No accounts, cloud sync, or collaboration — projects live in one
  browser's storage. Export WAV (and use your browser's profile sync
  backup habits) to move work between machines.
- No plugin hosting (VST/AU/CLAP), no marketplace, no notation, no video.
- No AI-assisted features.

## Audio engine

- **No time-stretch.** Audio clips trim and slip but do not stretch to
  tempo; the M6 decision to avoid an unreliable global stretch stands.
- **Sample-rate follows the device.** The engine runs at the hardware rate
  (typically 44.1/48 kHz); export renders at 44.1 kHz.
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
- Crossfades require real trim headroom on both clips (the app checks and
  says so).
