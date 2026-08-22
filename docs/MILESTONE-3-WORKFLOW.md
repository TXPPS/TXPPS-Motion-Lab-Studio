# Milestone 3 — Professional Workflow, Mixing, Arrangement & Polish

Milestone 3 changed no audio capability. It changed how fast and how pleasantly
the existing capabilities operate. Every item below exists because the opening
UX audit found the friction, not to lengthen a feature list.

## 1. Verification status

| Area                                        | Status                                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-selection, marquee, group move        | Implemented; unit + e2e verified through real pointer events                                                                                      |
| Clipboard (copy/cut/paste/duplicate/delete) | Implemented; unit + e2e verified, including deleted-track and snapshot edge cases                                                                 |
| Editing tools (pointer/split/erase/mute)    | Implemented; e2e verified                                                                                                                         |
| Shortcut registry + help sheet + menu hints | Implemented; conflict-checked by unit test                                                                                                        |
| Windowed clip rendering                     | Implemented; perf measured before/after on the same CI machine                                                                                    |
| Browser search + audition                   | Implemented; e2e verified                                                                                                                         |
| Project notes                               | Implemented; e2e verified through save → reload                                                                                                   |
| Unused-media scan/cleanup                   | Implemented; scan is report-only, delete is confirm-gated. **Not e2e verified** — exercised via the diagnostics panel manually in CI browser only |
| Mixer unity detent                          | Implemented; CSS derived from the fader curve. Visual only — **not asserted by a test**                                                           |
| Range/draw/zoom/hand tools                  | **Deferred** — the brief says only fully-usable tools                                                                                             |
| Editable shortcut bindings                  | **Deferred** — the registry exists; a rebinding UI does not                                                                                       |
| Settings pages                              | **Deferred** — workspace layout, snap and zoom already persist; a dedicated settings surface was cut for scope honesty                            |
| Favorites/tags in the browser               | **Deferred**                                                                                                                                      |

Totals after M3: **162 unit tests**, **122 e2e tests**, strict TypeScript,
ESLint clean.

## 2. The audit, and what it found

Walking every workflow (create → record → arrange → edit → mix → export) with
the code open, the load-bearing frictions were:

1. **Single-clip selection only.** No marquee, no group move, no clipboard, no
   Delete key. Arranging meant one clip at a time through a context menu.
2. **Undiscoverable shortcuts.** Alt+drag duplicate and Ctrl+E split existed but
   nothing taught them.
3. **Escape = instant audio panic.** The key musicians press most casually was
   bound to the most drastic action.
4. **No browser search or preview.** Finding a loop meant reading every row;
   knowing what it sounded like meant placing it on the timeline first.
5. **Ctrl+S dead while typing.** Focus in any field sent Ctrl+S to the
   browser's own save-page dialog. (Found by a failing test, fixed by special-
   casing save through the typing guard.)
6. **No windowing.** Every clip in the project mounted a canvas; large projects
   made scrolling unusable (measured below).

## 3. Selection model

`selectedClipIds` (ordered) with `selectedClipId` as the primary the inspector
follows. Click replaces; Shift/Ctrl-click toggles; marquee drag on empty lane
space rubber-bands (mouse only — on touch, a drag on empty space must remain a
scroll); Ctrl+A selects all; clicking empty space or Escape clears.

Group drag moves every selected clip by one shared delta **in one store
update**, clamped at zero as a block so internal spacing never compresses.
Re-anchoring each move from the grabbed clip's current position keeps the group
drift-free after the clamp engages. Lane changes stay single-clip: moving many
clips across heterogeneous track types has no predictable meaning.

## 4. Clipboard

In-memory, not the OS clipboard — clip data references media ids that mean
nothing outside this project's storage. Copies are deep-cloned snapshots, so
editing an original after copying does not change what pastes. Paste lands the
block at the snapped playhead on the clips' own tracks; clips whose track was
deleted are skipped and reported rather than guessed onto another track.
Duplicate (Ctrl+D) places the copies immediately after the selection's span.

## 5. Escape, escalating

Cancel recording (stashing the take) → close dialog/menu → non-pointer tool
back to pointer → clear selection → and only then audio panic. The stuck-note
rescue is still always reachable; it just stopped being the first response.

## 6. Tools

Pointer, Split, Erase, Mute — keys 1–4. Non-pointer tools act on press at the
snapped position under the cursor and never begin a drag; clip edge and fade
handles stop taking pointer events while a non-pointer tool is active, because
a handle swallowing the press near a border makes the tool feel unreliable.
Range, draw, zoom and hand are deferred, not half-shipped.

## 7. Windowed rendering (performance)

The 100-track / 1078-clip fixture (`#/qa-huge`) made the cost model measurable:

| Change                                                  | Scroll step (same CI machine, software raster) |
| ------------------------------------------------------- | ---------------------------------------------- |
| Baseline (every clip mounted, full-content grid canvas) | 200–275 ms                                     |
| + clip windowing                                        | ~95 ms                                         |
| + grid canvas → repeating CSS gradients                 | ~40 ms floor, 63 ms window-crossing jump       |
| Paint-only step after all changes                       | **28 ms**                                      |

Three separate causes, found by measuring rather than guessing:

1. **Every clip mounted a canvas.** Now only clips near the viewport mount
   (one viewport of overscan, 200px quantisation). Selected clips always
   mount, so an edge-scrolling drag can never unmount the element that holds
   its own pointer capture.
2. **The grid canvas spanned the whole timeline** — a ~5300×5900px bitmap at
   fixture scale, repainted on every scroll. Replaced with repeating CSS
   gradients, which are resolution-free and composite on the GPU.
3. **Per-lane filtering was O(tracks × clips)** — 100k predicate calls per
   render. Visible clips are now grouped per track in one pass.

The absolute CI numbers are a software-rasteriser floor; GPU hardware renders
these frames in a few ms. The budgets in the test are calibrated to CI and say
so in the test body.

## 8. Discoverability

One shortcut registry drives the `?` help sheet and the hints rendered in
context menus — the fast path is taught every time the slow path is used, and
the sheet cannot describe bindings that do not exist. A unit test asserts no
two entries claim one combo and that no binding steals a virtual-keyboard note
key (why split is Ctrl+E, not S).

## 9. Browser

Search filters all three tabs with honest empty states. Every media row has an
audition button that previews to the master outside the transport; starting a
new preview replaces the running one so tapping down a list never stacks
sounds. Escape/panic stops a running audition.

## 10. Project upkeep

- **Notes**: a free-form textarea saved with the project. `validateProject`
  rebuilds the object on load, so the field is carried explicitly — otherwise
  one save/load cycle would have silently dropped it.
- **Unused media**: a report-only scan (count + size), and a confirm-gated
  delete. Reference collection scans every saved project _plus the open one_,
  because the open project may hold an unsaved new recording that a
  saved-data-only scan would call unused.

## 11. Mixer

Unity-gain detent line on every fader at the exact 0 dB point of the fader
curve (gain = pos^2.2 × 1.5 → 83.2% of travel). Fader and pan double-click
reset to unity/centre already existed and are unchanged.
