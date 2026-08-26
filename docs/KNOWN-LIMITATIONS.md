# Known Limitations

Honest boundaries of the current release. None of these fail silently —
where a capability is missing the UI says so.

## By design

- No accounts, cloud sync, or collaboration — projects live in one
  browser's storage. Export audio or MIDI to move work between machines.
- No plugin hosting (VST/AU/CLAP) and no marketplace: the web has no
  equivalent sandbox for native plugin code.
- No video track, no disc burning or DDP, and no control-surface protocols
  beyond Web MIDI — a hardware controller is bound through Control Link,
  which speaks MIDI CC and pitch bend, not Mackie Control or HUI. All four
  are named in [the reference benchmark](REFERENCE-FSP8.md) §4 with the
  reason.
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
- **Third-party plugins declare no latency, so nothing compensates them.**
  Every built-in insert that delays its channel declares how much, and both
  render paths hold every other channel back to match the deepest — the live
  engine since Directive 03, and the bounce since `src/audio/pdc.ts` was made
  the one place that arithmetic lives. A WAM plugin implements no
  `latencySamples`, so a plugin with lookahead still puts its channel behind
  the others and nothing on screen says so. The route out is a freeze, which
  prints through the same renderer and therefore carries the compensation.

  **A bounce is sample-aligned to the timeline**, to within the master safety
  limiter below: the compensation's common offset is taken off the front of the
  file, which is the one thing the offline path can do that the live one cannot.
  `e2e/bouncealignment.spec.ts` measures it as a lag rather than a level.

- **Four places still carry latency**, all measured rather than reasoned about
  — the same note bounced with and without each processor, on Chromium at
  44.1 kHz:
  - **The master safety limiter costs 264 samples (5.99 ms), engaged or not.**
    It is a `DynamicsCompressorNode`, which delays its output even at neutral
    settings, and disengaging the limiter raises its threshold rather than
    unwiring the node. So the master output — monitored and bounced alike —
    sits 6 ms behind the timeline. Live and offline are identical, so nothing
    drifts between what you hear and what you deliver; what it does mean is
    that a bounce re-imported onto a track lands 6 ms late against the material
    it came from, and that the metronome, which is deliberately routed past the
    master, is 6 ms early against the mix. `e2e/masterlatency.spec.ts` measures
    the number, so it cannot quietly rot.

    It is **not** taken off the front of a bounce the way declared insert
    latency now is, and deliberately: 264 is a measurement of a Chromium node
    at one rate, not a figure any specification states. Compensating a bounce by
    a hard-coded constant would leave every other engine wrong by the
    difference instead of wrong by the whole thing, which is worse — the
    argument `latencyProbe.ts` exists to make. Measuring it per render is
    possible and is not done yet.

  - **The limiter insert costs 192 samples (4.35 ms)** in its oversampled
    brickwall stage, and its lookahead adds to that: the 3 ms default takes it
    to 324 samples (7.35 ms). Both are compensated on both render paths, and
    the transport shows the total.

    "Present even when the insert is bypassed" was true when it was written and
    is not now (PA-009). A bypassed limiter declares zero and `InsertChain`
    routes the signal around it, which is what makes the strong form of the
    bypass property — every bypassed insert renders exactly what no insert
    renders — hold for all thirty-four kinds.

  - **The multiband costs 270 samples (6.1 ms)**: it is the last processor
    still built on the browser's own `DynamicsCompressorNode`. Bypassing it
    takes that back out, because its bypass crossfades to a dry path.

  - **The bitcrusher costs (2^k − 1)/2 samples at a rate reduction of k** —
    31.5 samples (0.71 ms at 44.1 kHz) at its highest setting — from the
    boxcar hold cascade that does the reduction. This one is exactly known
    rather than measured, and its _own_ dry path is compensated, so its Mix
    control blends rather than combs; what is not compensated is the insert
    against the rest of the session. The delay no longer varies with Mix, so
    automating Mix does not sweep it.

  Every other insert is sample-aligned, the de-esser's band split and the
  compressor's detector included. Running one of these on one track of a
  doubled part no longer combs against the other — that is what the
  compensation is for, and it is now true of the bounce as well as of
  playback. What still combs is two inserts against each other _within_ one
  chain where only one of them declares, and a clip-level (event) chain, which
  neither path compensates.

  The saturator's and the distortion's parallel Mix is the one place a comb
  is _not_ compensated: both run their shapers at `oversample: '4x'`, whose
  up- and down-sampling filters are the browser's and are neither documented
  nor latency-free. A guessed compensation would be wrong in a way nobody
  could see, so the parameter says so where it is declared. Fully wet and
  fully dry are exact; the settings between them comb.

- **Sidechain keying reaches the compressor, gate, de-esser and limiter**, not
  the multiband: an insert carries one key input, and one key across three band
  detectors is not what keying a multiband would mean. The key is tapped
  post-fader on the source, so a key track that is faded down — or muted —
  keys weakly or not at all.
- **Automation is smoothed while monitoring and exact in the bounce — for
  volume, pan and sends.** Live, every automated value approaches its target
  over a 15 ms time constant at frame rate, so a 20 ms fader dip is heard as
  roughly 45 ms; the offline render schedules those lanes as sample-accurate
  ramps and reproduces the dip exactly. The bounce is the more faithful of the
  two.

  **Insert-parameter lanes are different**, and this used to say "exact" of them
  too, which was wrong (PA-006). An insert's parameters are not all AudioParams —
  several rebuild a waveshaper table or re-render an impulse — so they cannot be
  scheduled ahead and are instead applied on a grid, by suspending and resuming
  the render. That grid is one frame at 60 Hz, matching the rate the live
  applier runs at, so the two agree. It has a ceiling: an `OfflineAudioContext`
  schedules every suspension up front, so a render longer than about 33 minutes
  widens the grid and the resolution drops. When that happens the diagnostics
  log says so and by how much; it is no longer silent.

- **All media decodes into memory** (~10 MB per stereo minute). There is
  no disk streaming; hour-long multitrack sessions of recorded audio will
  grow memory accordingly. Decode caches are evicted when you switch
  projects.
- **Voice caps.** 128 simultaneous engine sources; 24 voices per synth
  instrument and 48 per sampler instrument (oldest voice steals first).
  Beyond that, notes are skipped rather than glitching the audio thread.
- **A frozen track is a print, and a print is a file.** Freezing renders the
  track — its notes, its instrument, its note FX and its inserts — from bar 1
  to its last clip, so the file is as long as the track's material however
  sparse that material is, at roughly 10 MB a stereo minute (24-bit WAV). The
  fader, pan, mute, solo and sends stay live and the print is otherwise
  sample-identical to the instrument it replaces, which
  `e2e/freeze.spec.ts` measures: the two renders differ by 6.7e-8 of full
  scale, which is the 24-bit quantiser. The one place they can differ audibly
  is pan: a print is a stereo file, so a _mono_ instrument panned off centre is
  panned by the browser's stereo law rather than its mono law. At centre — and
  for anything whose insert chain already outputs stereo — the two are
  identical. Editing anything the print was made from releases the freeze
  rather than playing a stale render, and that includes the tempo map, because
  notes are printed at seconds.
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
- **The score edits pitch, timing and duration — not everything.** Velocity,
  mute, per-note pan and detune, off-grid placement, triplet grids and the
  quantize/humanize tools are piano-roll work, and the staff engraves at most
  two voices, so denser polyphony is more comfortable in the roll. A forced
  enharmonic spelling (the same sound written as a different letter) is not
  offered: a note stores a MIDI number and the letter is re-derived from the
  key on every re-engrave, so the choice would have nowhere to live.
- **A warp render lands a moment after the drag.** Markers are dragged in the
  audio editor's Bend / Warp lane and the map is rendered through the time
  stretcher, which is too heavy for the scheduling path — so a clip that is
  already sounding keeps playing the previous render until the new one is
  ready, exactly as a tempo-follow stretch does. The clip's length in the
  arrangement does not follow the warped length either: warping past the clip's
  end trims it, as any other trim would.
- Crossfades require real trim headroom on both clips (the app checks and
  says so).
- **A short note cannot be resized by dragging its edge.** The handle gives way
  below a body of 24 px so the note stays draggable, because both gestures are
  a drag and the handle is on top — a handle wider than the note it sits on
  does not make resizing easier, it makes moving impossible. Zoom in, or use
  Alt+←/→. `src/components/pianoroll/geometry.ts` states the rule and
  `tests/pianoRollGeometry.test.ts` holds it.
- **The piano roll's toolbar scrolls sideways on a phone.** About twenty
  controls in 390 px. The nudge pad starts on screen because it is an edit a
  phone cannot otherwise make; on a 360 px screen the zoom pair is one
  horizontal flick away. Every one of them is 44 px and reachable — measured,
  not assumed — but "reachable after a flick" is not "in front of you".

## Targets that are smaller than the minimum, and why they conform

- **The console's per-device controls are 5 px (power), 12 px (name) and
  20 x 16 (options) on a desktop.** That is what a rack showing four devices in
  88 px can be, and WCAG 2.5.8 permits it only through its equivalent
  alternative: the options menu carries every command the inline controls
  offer, and its entries are 44 px on a finger and 28 on a pointer. On touch
  the inline controls are dropped rather than grown, so nothing undersized is
  the only route to anything. `tests/deviceMenu.test.ts` fails if a command
  exists inline and not in the menu, which is the moment the exception lapses.

- **An `::after` hit area is clipped by any scroller above it.** This codebase's
  answer for a control that must stay small — `.resize-handle`, `.dev-power`,
  `.pw-power` — is a negative-inset pseudo-element, and inside `overflow: auto`
  it does not deliver what it declares. Measured: `.dev-power` declared 44 x 44
  and reached 16 x 16 in the device rack, and 1 x 1 once a second device was on
  the channel, because the neighbouring row's hit area covered it and painted
  later. Two consequences, both live: a declared inset is not a measurement,
  and a hit area must be bounded by the row that holds it. `reachableBox` in
  `e2e/pointer.ts` is the only honest way to ask.
