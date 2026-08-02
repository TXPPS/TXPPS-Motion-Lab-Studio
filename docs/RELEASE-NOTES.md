# Release Notes

## 1.0.0-rc.1 — Public Beta Release Candidate

The feature set is frozen; this release hardens it for public use.

### Reliability & data safety
- Every project save now keeps the previous version as an atomic backup;
  unreadable projects restore from backup automatically.
- Autosave failures surface visibly (once) instead of silently; storage
  details stay in Diagnostics.
- Closing the tab with unsaved changes flushes an immediate save and asks
  for confirmation; edits made while a save is in flight are never
  wrongly marked as saved.
- Randomized fuzzing hardened project validation: non-finite numerics in
  notes/clips are rejected or clamped, and validation is now a JSON-stable
  fixpoint (stored state ≡ exported state).
- A browser missing hard requirements gets a readable "unsupported
  browser" card instead of a blank page.

### Performance
- Undo/redo stacks hold immutable project objects instead of JSON strings:
  at the 50,000-clip stress scale, edits 377 ms → 107 ms and undo
  133 ms → 1.3 ms.
- Decoded-audio caches are evicted when switching projects — memory no
  longer accumulates across sessions.
- New `#/qa-max` fixture (500 tracks / 50k clips / 20k notes / 1k lanes)
  with measured numbers in [Performance Notes](PERFORMANCE.md).

### Accessibility
- Zero axe-core violations (WCAG 2.1 AA ruleset) across all seven app
  surfaces: proper landmarks, real-button list rows, AA text contrast,
  keyboard-operable pads, reduced-motion support, pinch zoom re-enabled.

### Compatibility
- The full e2e suite now runs on Chromium, Firefox and WebKit engines;
  results and honest caveats in the
  [Browser Compatibility](BROWSER-COMPATIBILITY.md) matrix.
- Diagnostics gained detection-based feature reporting (never UA
  sniffing).

### PWA
- An available update no longer force-reloads a running session; it
  announces itself and applies on the next natural load.

### Onboarding
- First-run welcome card (once, reopenable from ⋯ → Welcome tour),
  keyboard-shortcut sheet, and a downloadable diagnostic package for bug
  reports.

### Earlier milestones
M1 foundation · M2 recording · M3 workflow & effects · M4 MIDI tools ·
M5 automation & mixing · M6 audio editing & comping · M7 sampler, drum
rack & instrument workstation. Details in `docs/MILESTONE-*.md`.
