# TXPPS MotionLab Studio

**Professional Music Production. Anywhere.**

A responsive, browser-based digital audio workstation proof-of-concept built with React,
TypeScript, and the Web Audio API. Local-first (IndexedDB), offline-capable (PWA), and
deployable to Cloudflare Pages.

## Milestone 1 scope

- Application shell with desktop, tablet, and dedicated phone layouts
- Real Web Audio playback: transport, synchronized playhead, loop, metronome
- Multitrack arrangement: audio, instrument, drum, and bus tracks with clip editing
- Mixer with real signal meters, faders, pan, mute/solo — shared state with track headers
- Piano roll editing driving a built-in polyphonic synth (TXPPS MotionSynth)
- Web MIDI input where the browser supports it
- Project persistence in IndexedDB with autosave, save-as, recents
- Offline-ready PWA shell (service worker + manifest)
- Diagnostics panel with copyable plain-text report and in-app smoke test

## Milestone 2 scope

The first complete audio-recording workflow: input → monitoring → arming →
count-in → recording → clip → waveform → editing → mixing → save → reload → play.

- Microphone input selection, arming and live monitoring, with permission
  requested only on a user action — never at startup
- Count-in recording via MediaRecorder with per-browser format negotiation,
  chunked so an interrupted take stays recoverable
- Recorded and imported audio stored as bytes in IndexedDB, separate from the
  project document, with cached waveform peak envelopes
- Production waveform rendering that never decodes audio during paint
- Nondestructive clip editing: trim, split, gain and fades
- Audio file import by picker or drag-and-drop, with honest per-browser format
  errors and storage-quota pre-flight
- Mixer insert effects (gain, EQ, compressor, tempo-synced delay, synthesised
  reverb) plus sends to effect buses
- Schema v2 with lossless, defensive v1 migration
- Interrupted-take recovery, offered rather than applied silently
- Offline WAV bounce of the full mix or the loop region, decoded and validated
  before it is offered
- Expanded diagnostics covering input, recording, media, storage and routing,
  plus eight one-shot checks

See [`docs/MILESTONE-2-RECORDING.md`](docs/MILESTONE-2-RECORDING.md) for the
architecture, the design decisions behind it, and a per-area statement of what
is verified, what is untested, and what is deliberately not offered.

## Milestone 3 scope

Workflow, not features: the same capabilities made faster, clearer and more
enjoyable to operate.

- Real multi-selection: shift-click, marquee rubber-band, select-all, group
  drag with preserved spacing
- Clip clipboard: copy/cut/paste at the playhead, duplicate-after-selection,
  Delete key
- Editing tools: pointer, split, erase, mute (keys 1-4); Escape escalates
  gently instead of instantly panicking audio
- A shortcut registry that drives the "?" help sheet and the hints in every
  context menu, conflict-checked by a unit test
- Browser search across projects/presets/loops and one-tap audition previews
- Project notes saved with the project; unused-media scan and confirm-gated
  cleanup
- Windowed clip rendering: scrolling a 100-track/1000-clip project went from
  200-275ms per frame to 28-63ms on the same CI machine (`#/qa-huge` fixture)

See [`docs/MILESTONE-3-WORKFLOW.md`](docs/MILESTONE-3-WORKFLOW.md) for the
audit findings, measurements, and deferrals.

## Milestone 4 scope

Professional MIDI composition: the piano roll rebuilt as a real editing
surface, backed by a pure, unit-tested musical model layer.

- Piano roll rebuild: windowed note rendering (selected notes always mounted),
  CSS-gradient grid, marquee selection, click-to-add, drag with pitch
  audition, resize, note labels, note mute (Alt+click / M), velocity lane with
  drag editing
- Quantize with musical grids (including triplets), strength %, swing %, as a
  single undo step
- Seeded humanization (timing/velocity/length/probability) — deterministic per
  seed; probability mutes rather than deletes
- Chord tools: 14 chordify qualities, inversions, drop-2, spread, octave
  double; scale system with 12 scales, out-of-scale shading, scale lock, and
  key/scale suggestions
- MIDI transforms: transpose, reverse, mirror, double/half length, legato,
  delete overlaps, thin, repeat
- Note-level shortcuts (select-all/duplicate/nudge/transpose/mute) that take
  priority inside the roll, registered in the conflict-checked shortcut sheet
- Muted notes are skipped by live playback and WAV export alike
- 11k+-note QA fixture (`#/qa-midi`); a 6,000-note clip stays editable with
  bounded mounts and budgeted scrolling on CI

See [`docs/MILESTONE-4-MIDI.md`](docs/MILESTONE-4-MIDI.md) for the audit,
architecture, and honest deferrals.

## Milestone 5 scope

A complete automation system and professional mixing workflow — one unified
model for every parameter.

- Automation lanes beneath tracks: expandable, resizable, named, color-coded
  by parameter family, windowed rendering
- One model for volume, pan, mute, sends, insert-effect parameters and synth
  parameters — normalized values with per-parameter linear/log mapping
- Point editing: add, delete, drag (Shift = fine, Alt = no snap), marquee
  multi-select, copy/paste at the playhead, duplicate, single-step undo
- Five curve shapes: linear, exponential, logarithmic, S-curve, stepped
- Playback: control-rate application with ramp smoothing (no direct value
  assignment anywhere); offline WAV export schedules real ramps for
  fader-domain lanes and measures as sample-accurate between knots
- Automation modes: Read, Touch, Latch, Off (Write and Trim honestly
  deferred); touch-riding a fader during playback writes the lane
- Mixer: bus tags with feed counts, automation indicators, track color
  language carried through
- Schema v3 with defensive lane validation; deleting a send/insert/bus
  removes its dependent lanes
- `#/qa-automation`: 100 tracks, exactly 500 lanes and 100,000 points, with a
  curve-showcase track

See [`docs/MILESTONE-5-AUTOMATION.md`](docs/MILESTONE-5-AUTOMATION.md) for the
architecture, the honest sample-accuracy statement, and deferrals.

## Milestone 6 scope

Professional audio editing: crossfades, comping, and multitrack safety — all
non-destructive.

- Fade shapes (linear, equal power, equal gain, S-curve) drawn as real curves
  and rendered through the shared schedule math
- Crossfades from the clip menu: real overlap from verifiable trim headroom,
  complementary shapes, single-step undo
- Take lanes with swipe comping: pack stacked clips into takes, swipe a lane
  to comp a range, click to audition, promote/mute/reorder/safe-delete;
  micro-fades at comp joins; comp indicator bar on the clip
- Time tools: split/heal (contiguity-checked), slip tool (5), ripple delete,
  clip nudge with arrows, zoom-to-selection
- Cleanup: normalize to −0.3 dBFS, phase invert, mono sum, DC/peak analysis,
  visual silence detection, sample-aware zoom past the peak-cache resolution
- Multitrack safety: clip and track locks enforced in the store, edit groups
  with linked selection
- Render proofs in CI: a phase-inverted duplicate cancels the bounce to
  silence; comps render take-correct material
- `#/qa-audio-edit`: 2,020-clip editing stress fixture

See [`docs/MILESTONE-6-AUDIO-EDITING.md`](docs/MILESTONE-6-AUDIO-EDITING.md)
for the audit, the short manual, and deferrals.

## Milestone 7 scope

Sampler, drum rack and instrument workstation. One zone-based sampler model
drives three views — the `view` field is a UI hint, never an engine branch —
and samplers implement the same `Instrument` interface as the synth, so the
scheduler, live keys, automation, mixer routing and offline export treat them
identically.

- Quick Sampler: drag a sample in, trim with zero-crossing assist (Alt
  bypasses), loop/reverse/one-shot, root + coarse/fine tune, normalize to
  −0.3 dBFS, master ADSR/filter/LFO
- Slicing: deterministic transient detection (RMS-jump over an energy
  envelope), manual markers, slices → drum pads, slices → MIDI clip; the
  source media is never modified
- Drum Rack: up to 104 MIDI-addressable pads (base C1), per-pad name, color,
  mute/solo, gain, pan, pitch and choke groups, drag-and-drop assignment,
  built-in procedurally generated kit
- Multisample: key zones, velocity layers, round-robin groups, per-zone root
  notes, linear crossfade through overlapping key ranges; zone rows are
  memoized so a 512-zone instrument edits responsively
- Instrument Rack: layered/split synth and sampler children with per-layer
  key range, mute/solo and reorder, sharing the track's channel strip,
  sends and automation
- Browser → Samples: one-shots, loops and project media with search,
  category chips, favorites and recents (localStorage), waveform thumbnails,
  audition, tap-to-load and drag-out (`text/x-ml-media`) onto pads and zones
- `smp:` automation parameters (volume, cutoff, resonance, ADSR, LFO) flow
  through the same registry, engine and export paths as synth parameters
- Voice management: 48-voice sampler cap inside the engine's 128-source
  budget, choke groups, reversed-buffer cache; offline export mirrors the
  live instrument graph

See [`docs/MILESTONE-7-SAMPLER.md`](docs/MILESTONE-7-SAMPLER.md) for the
architecture, the user guides, and deferrals.

## Version 1.0 RC1 — production hardening

The feature set above is frozen; RC1 is stability, compatibility and polish:

- Data safety: every save keeps an atomic backup of the previous version;
  corrupted projects restore from it automatically; autosave failures warn
  visibly; closing with unsaved changes flushes a save and asks first;
  edits made during an in-flight save are never marked as persisted
- Fuzzing: randomized project corruption proves validation never crashes,
  always yields a playable project, and is a JSON-stable fixpoint
- Performance: object-based undo stacks (50k-clip edit 377 ms → 107 ms,
  undo 133 ms → 1.3 ms); media decode caches evicted on project switch
- Accessibility: zero axe-core violations (WCAG 2.1 AA ruleset) on all
  seven app surfaces; landmarks, real-button rows, AA contrast, pinch zoom
  re-enabled, reduced-motion support
- Cross-engine: the same e2e suite runs on Chromium, Firefox and WebKit
  (`E2E_BROWSER=firefox|webkit`) — see the compatibility matrix
- PWA: updates never force-reload a running session
- Onboarding: first-run welcome, shortcut sheet, feature-detecting
  diagnostics with a downloadable report

Guides: [User Manual](docs/USER-MANUAL.md) ·
[Quick Start](docs/QUICK-START.md) · [FAQ](docs/FAQ.md) ·
[Known Limitations](docs/KNOWN-LIMITATIONS.md) ·
[Browser Compatibility](docs/BROWSER-COMPATIBILITY.md) ·
[Performance Notes](docs/PERFORMANCE.md) ·
[Public Beta Guide](docs/BETA-GUIDE.md) ·
[Release Notes](docs/RELEASE-NOTES.md)

## Development

```bash
npm install
npm run dev        # start dev server
npm run build      # type-check + production build (dist/)
npm run preview    # serve the production build on :4173
npm test           # Vitest unit tests
npm run e2e        # Playwright browser + responsive tests (uses the preview build)
npm run lint       # ESLint
npm run format     # Prettier
```

## QA routes

Fixtures are never autosaved, so a QA run cannot overwrite a real project.

| Route            | Loads                                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| `#/qa`           | Layout stress fixture: 26 tracks, 133 clips, 27 mixer strips              |
| `#/qa-audio`     | Audio editing & routing: trims, splits, fades, clip gains, missing media, three buses with sends |
| `#/qa-huge`      | Extreme scale: 100 tracks, ~1080 clips, for performance QA               |
| `#/qa-midi`      | Dense MIDI: 11k+ notes across a 6k-note stack, drum groove, and arpeggios |
| `#/qa-automation`| Automation stress: 100 tracks, 500 lanes, 100,000 points, curve showcase |
| `#/qa-audio-edit`| Audio-editing stress: 2,020 clips, crossfade chain, take comps, split run, locks, groups |
| `#/qa-sampler`   | Sampler workstation: sliced quick sampler with `smp:` automation, drum rack beat, multisample, synth+sampler rack |
| `#/qa-drums`     | Drum-rack scale: 100 assigned pads and a dense 16th-note trigger pattern  |
| `#/qa-multisample`| Multisample scale: 512 zones (32 key bands × 4 velocity layers × 4 round-robins) |
| `#/qa-max`       | Absolute maximum: 500 tracks, 50,000 clips, 20,000 notes, 1,000 lanes — failure-mode hunting |
| `#/phone`        | Forces the phone layout on any screen size                                |
| `#/diagnostics`  | Opens the diagnostics panel on load                                       |
| `#/demo`         | Reseeds the demo project                                                  |

## Architecture

| Boundary                  | Location                                                  |
| ------------------------- | --------------------------------------------------------- |
| Application shell         | `src/App.tsx`, `src/components/shell/`                    |
| Project state             | `src/state/projectStore.ts` (zustand, undo/redo)          |
| Audio engine              | `src/audio/engine.ts` (single AudioContext owner)         |
| Transport & scheduling    | `src/audio/scheduler.ts`, `src/state/transportStore.ts`   |
| Timeline / tracks / clips | `src/components/arrangement/`                             |
| Mixer                     | `src/components/mixer/`                                   |
| Instrument engine         | `src/audio/synth.ts` (MotionSynth + drum kit)             |
| Sampler & racks           | `src/model/sampler.ts`, `src/audio/samplerInstrument.ts`, `src/components/sampler/` |
| Recording                 | `src/audio/inputManager.ts`, `recorder.ts`, `recordingController.ts` |
| Clip scheduling maths     | `src/audio/clipSchedule.ts` (shared by playback and export) |
| Insert effects            | `src/model/effects.ts`, `src/audio/effectChain.ts`        |
| Automation                | `src/model/automation.ts`, `src/model/paramRegistry.ts`, `src/components/arrangement/AutomationLanes.tsx` |
| Import / export           | `src/audio/importAudio.ts`, `src/audio/exportMix.ts`      |
| Piano roll                | `src/components/pianoroll/`                               |
| Persistence               | `src/persistence/` (IndexedDB)                            |
| Diagnostics               | `src/state/diagnostics.ts`, `src/components/diagnostics/` |
| Responsive layouts        | `src/components/shell/`, `src/styles/`                    |
| PWA behavior              | `vite.config.ts` (vite-plugin-pwa), `src/pwa/`            |
| Testing                   | `tests/` (Vitest), `e2e/` (Playwright)                    |

Audio rule: exactly one `AudioContext`, owned by `AudioEngine`. UI components never touch
audio nodes directly — they act on stores; the engine reacts to store changes.

## Demo content

All demo audio is generated procedurally at runtime (synthesized drums, bass, keys,
percussion and texture loops) — no third-party or copyrighted material is included.

## Deployment

**Production is deployed automatically by Cloudflare Workers Builds.** The Worker
`txpps-motionlab-studio` is connected to this repository from the Cloudflare
dashboard; every push to the production branch builds and deploys with no GitHub
secrets and no manual step.

| Setting           | Value                                                 |
| ----------------- | ----------------------------------------------------- |
| Worker            | `txpps-motionlab-studio`                              |
| Production URL    | https://txpps-motionlab-studio.roan-crest.workers.dev |
| Production branch | `claude/motionlab-studio-poc-3l1gwa`                  |
| Root directory    | repository root                                       |
| Build command     | `npm run build`                                       |
| Deploy command    | `npx wrangler deploy -c wrangler.workers.toml`        |

Both `wrangler.toml` and `wrangler.workers.toml` are Workers Static Assets configs
targeting the same Worker, so the deploy works with or without the `-c` flag. SPA
routing comes from `not_found_handling = "single-page-application"`; there is no
`_redirects` file (Workers Static Assets rejects a `/*` catch-all as an infinite
loop). `public/_headers` keeps `sw.js` and the app shell revalidated.

`.github/workflows/deploy.yml` is a **manual fallback only** (`workflow_dispatch`).
It does not run on push, because without Cloudflare secrets it would report a
misleading failure on every commit.

Run the e2e suite against a deployed origin with
`E2E_BASE_URL=https://<host> npx playwright test`.

### Updating an installed PWA

The service worker is built with `registerType: 'autoUpdate'` and emits
`skipWaiting()` + `clientsClaim()`, and `sw.js` is served with `Cache-Control:
no-cache`. A returning client therefore revalidates the worker, activates the new
one immediately, and picks up the new bundle — normally within one reload, with no
reload loop (the update only fires when the precache revision actually changes).

If a device is still pinned to an old build:

1. **Safari / installed PWA on iOS** — close every tab and window of the app, then
   reopen. If it persists: Settings → Safari → Advanced → Website Data → search
   `workers.dev` → swipe to delete that entry. For a home-screen install, delete the
   icon and re-add it from Safari.
2. **Any browser** — open `#/diagnostics` and check the reported Git commit; it must
   read the deployed commit. A hard reload (Cmd/Ctrl+Shift+R) forces a fresh shell.
