# MotionLab Studio — UI Architecture Audit (pre-repair)

Measured with `scripts/audit-layout.mjs` and `scripts/audit-detail.mjs` against the
production build at commit `26d8b85`, in real Chromium at all six QA viewports.
Screenshots in `audit-out/`. Findings are measurements, not source inspection.

## Root causes

### RC-1 — Fixed-pixel fader/meter heights inside flex-squeezed strips (worst defect)

`Fader` and `Meter` accept `height` as a **number prop** (118 desktop / 110 tablet /
150 phone). The strip row that holds them, `.strip-mid`, is `flex: 1; min-height: 0`,
so it takes whatever vertical space is left over.

Measured at 1440x900 with the default 240px bottom panel: `.strip-mid` collapses to
**23px** while the fader still renders at its fixed 118px. Because `.fader` and
`.meter` position their internals `absolute`, those internals **paint outside the
23px box** and over the M/S buttons, the dB readout, the peak readout, and the
routing select. Nothing reports an overflow, so automated presence tests passed
while the UI was visibly broken.

The same bug inverts on phone: `.strip-mid` stretches to ~500px while the fader
stays 150px, leaving a large dead void (see `audit-phone-390x844-mix.png`).

Fix: fader/meter must derive their height from their container, and the strip must
use a bounded, proportional row model.

### RC-2 — Track header column is a separate, non-scrollable, JS-translated context

`.arr-headers` is `overflow: hidden` and its inner list is `position: absolute`,
translated by JavaScript from the _sibling_ scroller's `onScroll`.

Measured: wheeling over the track headers changes `scrollTop` by **0** — the header
column is not a scroll target at all. This is the reported "track areas do not
provide reliable vertical scrolling". Sync is also one-directional and frame-delayed.

Fix: one authoritative scroller; headers become `position: sticky; left: 0` inside it.

### RC-3 — Missing `min-width: 0` on intermediate flex wrappers kills tablet scrolling

`TabletLayout` wraps the arrangement in `<div style={{ flex: 1, minHeight: 0,
display: 'flex' }}>` with **no `minWidth: 0`**. Flex items default to
`min-width: auto`, so the wrapper refuses to shrink below content width and `.arr`
grows to **1836px inside a 1024px viewport**.

Measured consequence: tablet arrangement `scrollWidth - clientWidth = 0` — the
horizontal scroller has no range, so **horizontal scrolling is completely dead on
tablet** and the timeline is simply cut off (see `audit-tablet-1024x768.png`).

### RC-4 — No stress fixture, so scrolling was never actually exercised

The demo project has 8 mixer strips (8 x 84px < any desktop viewport) and 7 tracks.
Mixer horizontal scroll range measured **0 at every desktop/tablet viewport**. The
scrolling mechanisms were therefore never under load in tests.

### RC-5 — Phone transport controls overlap

`.transport.compact` mixes fixed-width buttons with a `flex: 1` display block at
390px wide. Measured/visible: the Stop button paints on top of the `1.1.1 BAR.BEAT`
readout (`audit-phone-390x844-mix.png`). `.transport { overflow: hidden }` hides the
damage instead of preventing it, which is why "transport within bounds" assertions
passed.

### RC-6 — Double-applied safe-area padding

`.app` applies `--sat/--sal/--sar`. `.bottomnav` correctly applies `--sab`. But
`.kbd` **also** applies `calc(8px + var(--sab))` while sitting _above_ the bottom
nav, so the bottom inset is counted twice in Perform mode. `.sheet` applies it a
third time in its own stacking context.

### RC-7 — Content-sized regions instead of viewport-constrained regions

`TabletLayout` sizes the editor panel with `height: '46%'` and, for the instrument
combo, `height: 'auto'` + `flex: '0 0 auto'` — the panel sizes itself from its
children rather than from the viewport budget.

### RC-8 — Artificial timeline height padding

`.arr-canvas-wrap` height is `RULER_H + total + 120`; the trailing `+120` fabricates
scroll room rather than expressing real content bounds.

### RC-9 — Scroll affordances hidden

Toolbars set `scrollbar-width: none`; the arrangement offers no visible horizontal
scrollbar on tablet/phone, so a clipped timeline reads as "broken" rather than
"scrollable".

### RC-10 — Strip sections are not baseline-aligned across strips

Bus and master strips have fewer rows than audio/instrument strips, so their faders,
buttons and readouts sit at different heights than their neighbours
(`audit-tablet-1024x768.png`). Real mixers align sections on a shared baseline.

## Answers to the specific audit questions

| #   | Question                             | Finding                                                                                                                                  |
| --- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Top-level containers                 | `.app` → `.app-main` → (`.side-panel`, `.center-col` → `.arr` + `.editor-panel`)                                                         |
| 3   | Ancestors preventing scrolling       | Tablet wrapper without `min-width: 0` (RC-3); `.arr-headers { overflow: hidden }` (RC-2)                                                 |
| 4   | Panels lacking `min-width/height: 0` | Tablet arrangement wrapper; strip internals                                                                                              |
| 5   | Own scrolling contexts               | `.arr-scroll`, `.mixer`, `.pr-scroll`, `.panel-body`, `.syn-scroll`, `.arr-toolbar`                                                      |
| 6   | Content-sized regions                | Tablet editor panel, instrument combo (RC-7)                                                                                             |
| 7   | Controls overflowing strips          | Fader + meter internals (RC-1)                                                                                                           |
| 8   | Headers/content unsynchronized       | Yes — separate contexts, JS-translated (RC-2)                                                                                            |
| 9   | Shared timeline coordinate system    | **Yes, correct** — ruler, grid, clips, playhead, loop all live in one scroller and stay synchronized (measured after `scrollLeft = 400`) |
| 10  | Strip widths                         | Fixed 84px desktop / 96px phone — stable, but too narrow and vertically unbounded                                                        |
| 11  | Multiple workspaces on mobile        | No — phone shows one mode; `browse` stacks browser+inspector inside the single Browse mode                                               |
| 12  | Toolbars wrap/overlap                | Transport overlaps on phone (RC-5)                                                                                                       |
| 13  | Safe-area double-applied             | Yes (RC-6)                                                                                                                               |
| 14  | Transforms vs hit testing            | Playhead/header transforms are `pointer-events: none` or non-interactive; no hit-testing damage found                                    |

## What was already correct (preserve)

- One shared horizontal timeline coordinate system for ruler/grid/clips/playhead/loop.
- Shift+wheel horizontal scrolling works (measured: `scrollLeft` 0 → 300).
- `overscroll-behavior: contain` on the arrangement scroller.
- Document never scrolls at any viewport (`scrollWidth == clientWidth` everywhere).

## Dependency decisions

| Library                    | Decision         | Reason                                                                                                                                                                                                                              |
| -------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **react-resizable-panels** | **Adopt**        | Tested resize with real min/max constraints, keyboard-accessible handles, and size-persistence callbacks. Directly serves the panel-sizing requirements; ~10KB.                                                                     |
| dnd-kit                    | Reject           | Timeline clip drag/resize is measured working and needs scroll-aware absolute coordinate math. dnd-kit's transform model would add risk with no benefit, and the brief says not to replace working low-level timeline interactions. |
| TanStack Virtual           | Reject (for now) | 24 tracks / 24 strips render fine. Virtualization complicates the sticky-header and shared-coordinate model and risks the playhead mapping. Revisit past ~200 tracks.                                                               |
| Dockview                   | Reject           | A docking migration would destabilize the audio/timeline systems for no gain at this checkpoint; the brief prefers a simpler resizable workstation shell.                                                                           |
