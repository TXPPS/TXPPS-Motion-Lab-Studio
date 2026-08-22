# CLAUDE.md — how to work in this repository

Two products live here. Read this before touching either.

## What is here

**MotionLab Studio** (`src/`, `tests/`, `e2e/`) — a shipping web DAW: React 18 +
TypeScript strict + Vite, Web Audio engine, ~1500 unit tests, 222 end-to-end
tests, deployed to Cloudflare Workers. It works and it is in use.

**Motion Wave** (`motionwave/`) — the cross-platform native DAW under
construction. C++17 shared core, per-platform shells, targeting Windows, macOS,
iPadOS, Android and iPhone. ADR-0001 makes MotionLab Studio Motion Wave's web
implementation and interaction reference; its Web Audio engine is not the
long-term engine and will be replaced by the shared core compiled to WASM.

Do not let them bleed into each other. `motionwave/core/` may not depend on
anything in `src/`, and `src/` may not depend on `motionwave/`.

## Build and test

```bash
# MotionLab Studio (web)
npm run typecheck        # NEVER `npx tsc --noEmit` — see the gotcha below
npm run lint
npm test                 # vitest
npm run e2e              # playwright, uses the preview build
npm run build

# Motion Wave (core)
cd motionwave
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build build
./build/param_tests      # or: ctest --test-dir build
```

## Gotchas that have already cost time

- **`npx tsc --noEmit` type-checks nothing in this repo.** The root
  `tsconfig.json` is `files: []` with project references, so a bare invocation
  reports success having compiled zero files. Five real errors reached the
  branch behind it. Use `npm run typecheck`.
- **`tsc -b` is a *build*.** Running it with `--noEmit false` emits a `.js`
  beside every `.ts` in the tree. If you find a few hundred stray `.js` files,
  that is what happened; delete them and use the script.
- **`@container mixer` blocks in `src/styles/mixer.css` are source-order
  dependent.** The strip row templates renumber rows per tier; adding a rule in
  the middle can change which row an element lands in.
- The preview server (`npm run preview`) sometimes needs `setsid` to survive a
  backgrounded shell. Screenshots via `scripts/screenshot.mjs` need it running.

## Conventions, both products

- **Comments explain why, in full sentences, and say what would go wrong
  otherwise.** A comment that restates the code is deleted. This is the house
  style and a generic comment reads as foreign here.
- **Every behavioural change arrives with a test that fails without it.** Where
  a fix is subtle, mutation-test it: revert the fix and confirm the test fails.
- **No file over ~400 lines.** A longer file is describing more than one thing.
- **A picture is drawn from the same evaluation the audio uses.** Never a second
  opinion. This is why `src/model/synthFace.ts` and the `*Of()` descriptors in
  `src/model/effects.ts` exist, and it is the rule that has caught the most
  bugs in this codebase.
- **A control that does nothing is a bug of the same class as a wrong number.**
  Static guards enforce it: `tests/schemaWired.test.ts`, `tests/laneWired.test.ts`,
  `tests/prefs.test.ts`. Add to them rather than around them.

## Motion Wave core: the rules that are not negotiable

- `motionwave/core/` has **no dependencies** — no platform headers, no GUI
  framework, no third-party library. That is what lets it compile for a phone,
  a desktop and a WebAssembly sandbox from one source (ADR-0003).
- **Nothing on a path reachable from `process()` may allocate, lock, do file
  I/O, or log.** Proven, not reviewed: `motionwave/core/test/rt_guard.h` arms an
  operator-new hook around the call and the test fails by name if anything
  allocates. That guard is itself mutation-tested.
- Parameters cross the audio boundary through `ParamSet` and nowhere else
  (ADR-0004). If you find yourself wanting a second mechanism, the answer is
  that you want a `ParamSpec`.
- No trademarked reference name appears anywhere under `motionwave/` — not in a
  filename, type, symbol, preset name or comment. Reference names live only in
  `docs/reference/`. See `LEGAL_NOTES.md`; this is a commercial-safety
  requirement.
- **A value marked `[I]` in a spec sheet is quarantined.** It came from an
  emulator implementation rather than from a measurement or a manual, which
  makes it somebody's design decision rather than a fact about the hardware.
  Re-derive it or choose your own before it reaches `motionwave/`. `LEGAL_NOTES.md`
  explains why and names the affected set.

## What NOT to refactor

- **MotionLab's offline bounce parity.** `src/audio/exportMix.ts` and the
  realtime engine build through the same `InsertChain`; the parity is asserted
  by e2e tests that render the same bars two ways. Changing one side without
  the other silently breaks exports.
- **`ControlVca`'s `envelopeTop`** in `src/audio/effectChain.ts`. The limiter
  widens it and the gate narrows it, and both are load-bearing: the limiter
  could otherwise only reduce 0.40 dB, and a gate below −66 dBFS threshold did
  nothing at all. The comment there records the numbers.
- **The three-theme contract.** An explicit choice stamps `data-theme`; "system"
  stamps nothing and follows `prefers-color-scheme`. Every palette token must be
  defined on bare `:root` first.
- **`paramIdExists` in `src/persistence/projectRepo.ts` is deliberately wide.**
  It is the predicate `validateProject` *drops* lanes by; narrowing it deletes
  users' automation on the next save.

## Where the decisions are

`docs/adr/` — one file per locked decision, with the rejected alternatives.
`docs/reference/` — Reference Spec Sheets for every modelled unit, sources cited.
`PROGRESS.md` — phase board, QA dashboard, active bugs, next actions.
`LEGAL_NOTES.md` — provenance and IP compliance.
