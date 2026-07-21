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

## Architecture

| Boundary | Location |
| --- | --- |
| Application shell | `src/App.tsx`, `src/components/shell/` |
| Project state | `src/state/projectStore.ts` (zustand, undo/redo) |
| Audio engine | `src/audio/engine.ts` (single AudioContext owner) |
| Transport & scheduling | `src/audio/scheduler.ts`, `src/state/transportStore.ts` |
| Timeline / tracks / clips | `src/components/arrangement/` |
| Mixer | `src/components/mixer/` |
| Instrument engine | `src/audio/synth.ts` (MotionSynth + drum kit) |
| Piano roll | `src/components/pianoroll/` |
| Persistence | `src/persistence/` (IndexedDB) |
| Diagnostics | `src/state/diagnostics.ts`, `src/components/diagnostics/` |
| Responsive layouts | `src/components/shell/`, `src/styles/` |
| PWA behavior | `vite.config.ts` (vite-plugin-pwa), `src/pwa/` |
| Testing | `tests/` (Vitest), `e2e/` (Playwright) |

Audio rule: exactly one `AudioContext`, owned by `AudioEngine`. UI components never touch
audio nodes directly — they act on stores; the engine reacts to store changes.

## Demo content

All demo audio is generated procedurally at runtime (synthesized drums, bass, keys,
percussion and texture loops) — no third-party or copyrighted material is included.

## Deployment

Built as a static site (`dist/`) for Cloudflare Pages, project `txpps-motionlab-studio`.
`public/_redirects` provides the SPA fallback; `public/_headers` keeps the service worker
and app shell revalidated.
