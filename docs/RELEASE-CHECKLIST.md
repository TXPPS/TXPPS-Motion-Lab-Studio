# Release & Developer Checklists

## Release checklist (per deploy)

- [ ] `npm run lint` — zero warnings
- [ ] `npx tsc -b --force` — zero errors (strict)
- [ ] `npm test` — all unit tests green (includes fuzzing)
- [ ] `npm run e2e` — full Chromium suite green
- [ ] `E2E_BROWSER=firefox npx playwright test` — Firefox suite green
      (known engine-specific skips only)
- [ ] `E2E_BROWSER=webkit npx playwright test` — WebKit suite green
      (known engine-specific skips only)
- [ ] `npm run build` — production build clean
- [ ] Screenshot pass on desktop / tablet / phone routes, personally
      inspected
- [ ] Performance spot-check against `docs/PERFORMANCE.md` budgets
      (`#/qa-huge`, `#/qa-max`)
- [ ] Docs updated: release notes, known limitations, compatibility
      matrix if anything changed
- [ ] Push to the deploy branch; verify the served asset embeds the new
      commit hash; load the production URL and run the Diagnostics smoke
      test
- [ ] Verify a second visit picks up the new service-worker version
      without a forced reload

## Developer checklist (per change)

- [ ] Feature-frozen? Bug fixes and hardening only for 1.0.
- [ ] State changes go through `projectStore.update()` — never mutate the
      current project object (undo history retains it by reference).
- [ ] New persisted fields: extend `validateProject` defensively, bump
      migrations, add a fuzz-surviving default, cover with a round-trip
      test.
- [ ] New parameters: register in `paramRegistry` so automation, engine
      and export stay in sync.
- [ ] Anything audible must be provable offline: extend the export tests
      if the render path changes.
- [ ] New UI: aria-labels, keyboard path, 44px touch targets, tokens for
      color (contrast AA), works at phone width, empty state written.
- [ ] Timers/listeners/nodes: cleanup path exists and is exercised.
- [ ] Budgets: if a hot path changed, re-run the profiling scripts and
      update `docs/PERFORMANCE.md` — numbers in docs must stay measured,
      never guessed.
