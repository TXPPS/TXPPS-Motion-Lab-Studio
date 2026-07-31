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

| Boundary                  | Location                                                  |
| ------------------------- | --------------------------------------------------------- |
| Application shell         | `src/App.tsx`, `src/components/shell/`                    |
| Project state             | `src/state/projectStore.ts` (zustand, undo/redo)          |
| Audio engine              | `src/audio/engine.ts` (single AudioContext owner)         |
| Transport & scheduling    | `src/audio/scheduler.ts`, `src/state/transportStore.ts`   |
| Timeline / tracks / clips | `src/components/arrangement/`                             |
| Mixer                     | `src/components/mixer/`                                   |
| Instrument engine         | `src/audio/synth.ts` (MotionSynth + drum kit)             |
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
