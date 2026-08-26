# Milestone 4 — Professional MIDI Composition, Piano Roll & Creative Workflow

**Describes commit `4b169156e0`.** History — a record of one tree at one
moment, which cannot go stale because it was never a claim about now.

Milestone 4 rebuilt the piano roll into a professional editing surface and gave
it the tool set MIDI composition actually needs: quantize with strength and
swing, seeded humanization, chord and voicing tools, a scale system, note-level
transforms, and note-level keyboard editing — all on top of a pure, tested
model layer, and all usable on a 6,000-note clip.

## 1. Verification status

| Area                                                                                              | Status                                                                                        |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Piano roll rebuild (windowed rendering, gradient grid, velocity lane, marquee, note labels, mute) | Implemented; e2e verified through real pointer events                                         |
| Note drag with pitch preview, Shift snap bypass, resize, double-click delete                      | Implemented; drag/resize covered by e2e gestures                                              |
| Quantize (grids incl. triplets, strength %, swing %, single undo step)                            | Implemented; 34 model unit tests + e2e through the toolbar button                             |
| Humanize (seeded timing/velocity/length/probability)                                              | Implemented; unit-verified deterministic given a seed; probability mutes, never deletes       |
| Chord tools (14 qualities, inversions, drop-2, spread, octave double)                             | Implemented; unit tests + e2e chordify through a real menu click                              |
| Scale system (12 scales, highlight, lock, suggestions)                                            | Implemented; unit tests + e2e (shading, lock-snapped note add)                                |
| MIDI transforms (transpose, reverse, mirror, stretch, legato, delete overlaps, thin, repeat)      | Implemented; unit tests; exposed in the Tools menu                                            |
| Note-level shortcuts (Ctrl+A/Ctrl+D override, arrow nudge/transpose, M mute)                      | Implemented; e2e verified; registered in the shortcut sheet, conflict-checked                 |
| Muted notes silent in playback **and** WAV export                                                 | Implemented; `muted` checked in the scheduler and the offline render                          |
| 10k-note performance (`#/qa-midi`, 6k-note clip open)                                             | Implemented; e2e asserts bounded mounts, scroll budget, editing at scale                      |
| Drum-lane naming in the roll (kick/snare/hat… labels on drum tracks)                              | Implemented; screenshot-inspected via the dense drum clip                                     |
| Dedicated drum grid editor / step sequencer                                                       | **Deferred** — the roll's drum-named lanes are honest; a separate step surface is not built   |
| Groove templates / groove extraction                                                              | **Deferred** — quantize swing covers the common case; template management does not exist      |
| Typing-keyboard velocity/sustain layers                                                           | **Deferred** — the virtual keyboard plays notes and shifts octaves (Z/X) as before            |
| Quantize/humanize live preview                                                                    | **Deferred** — both commit as one undoable step instead; determinism makes results repeatable |

Totals after M4: **196 unit tests** (34 new for the MIDI model), **129 e2e
tests** (7 new piano-roll tests), strict TypeScript, ESLint clean.

## 2. The audit, and what it found

The Milestone 1 piano roll was a viewer with note placement: single selection,
no marquee, no velocity editing, a full-content `<canvas>` grid redrawn on
zoom, every note always mounted, no quantize, no musical tools, and arrow keys
that scrolled the page. Opening anything dense was unusable, and the editing
vocabulary stopped at "add, drag, delete".

Two latent application bugs surfaced during this milestone's test work, both
worth recording:

1. **Every context-menu item was dead to a real mouse press.** The menu host
   closed on a capture-phase `pointerdown` anywhere — including _inside_ the
   menu — so the menu unmounted between `pointerdown` and `pointerup` and the
   item's `click` never fired. Keyboard/tap paths masked it; the first e2e test
   that clicked a menu item exposed it. Fixed with a `contains()` guard
   (`src/components/common/overlays.tsx`).
2. **Finishing a marquee added a stray note.** The release of a sweep still
   dispatches a `click` on the grid, which fell through to click-to-add: the
   selection you just made collapsed to one unwanted note under the pointer.
   Fixed by suppressing the add when the marquee actually moved
   (`PianoRoll.tsx`).

## 3. Model layer: pure, deterministic, undoable

All musical operations live in plain functions over `Note[]`
(`src/model/midiTools.ts`, `chords.ts`, `scales.ts`) with no store or DOM
dependencies, so every rule is unit-testable exactly:

- **Quantize** — `nearestSwungSlot` computes the target grid with odd slots
  displaced late by `swing × grid/2`; strength interpolates each start toward
  that target. Grids include 1/1…1/32 plus 1/4T, 1/8T, 1/16T triplets.
- **Humanize** — a seeded mulberry32 PRNG drives timing/velocity/length
  offsets; the same seed always produces the same result (asserted by test).
  `probability` _mutes_ skipped notes rather than deleting them — a humanize
  pass never destroys material.
- **Transforms** — transpose, reverse, mirror-around-center, stretch ×2/÷2,
  legato, delete-overlaps, thin, repeat. `repeatNotes` returns only the
  copies, so callers append without re-adding the source.
- **Chords** — 14 qualities from maj to 13 (pitches above 127 fold down an
  octave), inversions both directions, drop-2, spread, octave doubling.
- **Scales** — 12 scales with membership, nearest-member snapping (ties
  resolve downward), and coverage-ranked suggestions surfaced as a one-click
  hint in the toolbar.

Edits reach the store through two channels only: `updateNotes` for in-place
gesture edits, and `transformNotes(clipId, next)` which replaces by id as
**one undo step** — so "Quantize", "Humanize" or "Reverse" is always a single
Ctrl+Z away, which is why a live preview mode was cut rather than half-built.

## 4. The rebuilt piano roll

- **Windowed rendering on both axes.** The visible px window (quantized to
  200px steps, one viewport of overscan, rAF-coalesced scroll updates) mounts
  only notes in view — with the invariant that **selected notes always
  mount**, because a pointer-captured drag must never lose its element. The
  velocity lane windows horizontally only.
- **Grid as layered CSS gradients** (bars, beats, snap lines, rows, black-key
  shading, octave separators, out-of-scale shading) instead of a
  `gridW × gridH` canvas bitmap — the same replacement the arrangement got in
  Milestone 3, for the same reason: it composes on the GPU at any zoom.
- **Velocity lane**: sticky at the scroller's bottom; dragging a bar writes
  velocity to the whole selection; bars mirror selection and mute state.
- **Editing surface**: marquee on empty grid (mouse), click-to-add with scale
  lock applied, drag with per-row pitch audition, Shift bypasses snap,
  right-edge resize, Alt+click or M mutes, double-click deletes, labels appear
  when a note is wide enough to carry one.
- **Toolbar**: clip switcher, snap, selection velocity slider, quantize
  (grid/strength/swing/apply), key + scale + LOCK + suggestion hint, Tools and
  Chords menus, loop-this-clip, zoom. Controls keep natural width; the toolbar
  scrolls when narrow instead of crushing its selects.

Muted notes render dashed and dimmed, and are skipped by both the live
scheduler and the offline WAV render — mute is an audible contract, not a
visual one.

## 5. Keyboard model

Inside the piano roll (editor tab active), note-level shortcuts take priority
over clip-level ones: Ctrl+A selects the clip's notes (not the project's
clips), Ctrl+D duplicates the selected notes after themselves as one step,
arrows nudge by snap (Shift = quarter-snap fine nudge), ArrowUp/Down transpose
±1 (Shift = octave; with scale lock on, steps land on scale members), M toggles
mute with mixed states resolving toward muted. All of it is in the shortcut
registry, rendered in the "?" sheet under a "Piano roll" category, and covered
by the conflict-detection unit test.

## 6. Performance at 10k+ notes

`#/qa-midi` loads a deterministic 11k+-note project (6,144-note sustained
stack, ~3.1k-note drum groove with muted ghosts, 2,048-note arpeggio). The e2e
test opens the 6k clip and asserts, on CI's software rasteriser: mounted notes
stay bounded (< 2,500 for a 6,144-note clip), 20 horizontal scroll hops stay
under a 120ms/step budget, and a real marquee-plus-transpose edit completes
without locking the UI. Numbers are budgets calibrated to that environment,
not marketing figures.

## 7. Testing

- `tests/midiTools.test.ts` — 34 tests: swung-slot maths, strength
  interpolation, humanize determinism and probability-mute, every transform,
  chord/voicing construction, scale membership/snapping/suggestions, fixture
  integrity. One real bug was found by these tests before any UI existed: a
  `NaN` sentinel in `thinNotes` made the comparison always false and silently
  dropped every note.
- `e2e/pianoroll.spec.ts` — 7 tests driving the real UI: marquee → transpose →
  mute; Ctrl+A/Ctrl+D note-context override; quantize + single-step undo;
  chordify through a real context-menu click; velocity-lane drag; scale
  shading + lock-snapped add; and the dense-fixture responsiveness test.
  Store assertions target the open clip **by name** — the demo's first MIDI
  clip in document order is the drum groove, and an early version of the suite
  read the wrong clip and produced four false failures.

## 8. Deferred, and why

- **Dedicated drum grid / step sequencer** — the roll already gives drum
  tracks named lanes; a separate stepped surface deserves its own design pass
  rather than a checkbox implementation.
- **Groove templates and groove extraction** — swing covers the dominant use;
  template storage/apply UX was not going to be honest in this milestone.
- **Typing-keyboard velocity/sustain layers** — unchanged from M1: keys play,
  Z/X shift octave.
- **Quantize/humanize live preview** — deliberately replaced by deterministic
  single-step commits with instant undo.
- **Per-note color / CC lanes / MPE** — out of scope; the velocity lane is the
  one expression lane that exists and it is real.
