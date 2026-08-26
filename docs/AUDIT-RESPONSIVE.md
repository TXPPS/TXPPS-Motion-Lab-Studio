# Responsive overflow audit — what is cut off, and why

**Describes commit `d6bf69bc55`.** History — a record of one tree at one
moment, which cannot go stale because it was never a claim about now. Superseded by [`audit/RESPONSIVE_AUDIT.md`](audit/RESPONSIVE_AUDIT.md), which re-ran it across nineteen form factors.

A user reported from a phone that "tracks are having UI issues cutting off certain
portions", with one screenshot of one panel. Rather than hunt the rest of that class of bug
by eye, every surface of the app was measured at six viewports and asked four questions
about every element on it:

1. Is its content wider than its box while its own `overflow-x` is `visible`, `hidden` or
   `clip` — i.e. cut at the box edge, or painted over whatever sits beside it?
2. Does its border box cross the right edge of the viewport?
3. Is it a clipping box holding truncated text with no `text-overflow: ellipsis`?
4. Is it an interactive control smaller than 32×32 CSS px? (Advisory.)

Anything reachable by scrolling is deliberately not a finding: an element whose own
`overflow-x` is `auto`/`scroll` is a scroller doing its job, and a spill inside such a
scroller can still be brought into view. Without that rule the arrangement timeline alone
would bury everything real.

**Harness:** `scripts/overflow-audit.mjs`. Run it against the preview build:

```
npm run preview &
AUDIT_JSON=/tmp/overflow.json node scripts/overflow-audit.mjs
```

`AUDIT_ONLY=phone-360x740/page-show` re-checks one surface after a fix; the JSON is sorted
and jitter-free so two runs diff cleanly. Other knobs: `AUDIT_BASE`, `AUDIT_THEME`
(default `light` — the theme the bug was reported in), `AUDIT_SETTLE`.

**Scope of this run:** 128 probes — 6 viewports (360×740, 390×844, 430×932, 768×1024,
834×1112, 1280×800) × every surface the layout offers at that size: the six phone
workspaces, the tablet combos and drawers, the eight desktop editor tabs, all six browser
tabs, the four top-level pages (Live also in Stage mode), and the four sheets
(Preferences, Export, Shortcuts, Diagnostics). The Inspector is visited twice per layout —
once with a track selected and once with a clip open — because it is three different panels
and the insert rack only exists in the track one. Theme: light. Every surface was reached;
no step failed.

**Ten findings: 3 high, 4 medium, 3 low**, plus one advisory group (tap-target size) and
two measured-but-benign patterns documented at the end so nobody re-finds them.

Raw counts from the run, before grouping by root cause: 64 off-screen occurrences, 350
clipped, 14 truncated-without-ellipsis, 101 spills, 4541 undersized tap targets; 48
distinct layout defects, 20 distinct ellipsised truncations (by design), 271 distinct
tap-target advisories.

> Line numbers are as of this audit. `src/` is being edited concurrently, and `mixer.css`
> already shifted by ~50 lines mid-run — the selectors quoted are the stable reference.

---

## First: the reported symptom does not reproduce

The screenshot showed the Inspector's insert row with "Chain…" clipped off the right edge
at ~430px. On the build served at `localhost:4173` during this audit it fits, everywhere:

| viewport         | UI scale | `.fx-add` right edge | viewport edge |
| ---------------- | -------- | -------------------- | ------------- |
| 320×700 phone    | 1        | 310                  | 320           |
| 360×740 phone    | 1        | 350                  | 360           |
| 430×932 phone    | 1        | 420                  | 430           |
| 430×932 phone    | 1.5      | 416                  | 430           |
| 768×1024 tablet  | 1        | 758                  | 768           |
| 1280×800 desktop | 1        | 1270                 | 1280          |

What holds it is `.fx-add { display: flex }` with `.fx-add select { flex: 1 1 0; min-width:
0 }` (`src/styles/mixer.css:1164-1171`); the second select is capped by `.fx-preset,
.fx-chain-preset { max-width: 130px }` (`src/styles/mixer.css:1158-1163`). Either the fix
landed since the report, or the report predates the current build. **Do not remove the
`min-width: 0`** — it is the only thing keeping that row inside the screen.

One nearby latent risk, not currently overflowing: `.insp-row input[type='text'], …,
.insp-row select { width: 120px }` (`src/styles/panels.css:136-142`) is a fixed width on a
flex child in a row whose label is `flex: none`. It survives today only because 120px still
fits; it is the same shape as the bug that was reported.

The class of bug the user described is real and live, though — see finding 3, which cuts a
channel strip in half.

---

## High

### 1. The Live and Release pages push their own header off the screen on every phone

**Surfaces:** `page-show`, `page-show-stage` (all three phone widths), `page-mastering`
(360 only).
**Off by:** 111px at 360, 81px at 390, 41px at 430 on Live; 9px at 360 on Release.

`.page` is a grid with only `grid-template-rows` declared
(`src/styles/pages.css:15-21`), so its single column is an implicit `auto` track — and an
`auto` track's minimum is the _min-content_ of its items. `.page-head`
(`src/styles/pages.css:23-30`) is a `display: flex` row with no `flex-wrap`, holding a back
button, an `<h1>`, a hint and two more buttons (`src/pages/ShowPage.tsx:77-97`), each `.btn`
carrying `white-space: nowrap` (`src/styles/base.css:220`). Its min-content is 470.9px,
which is wider than any phone.

The track therefore resolves to 470.891px regardless of viewport width, both children
(`.page-head` and `.show-body`) are laid out 471px wide, and `.app-body { overflow: hidden }`
(`src/styles/shell.css:106-112`) cuts everything past the viewport edge. The lost region
contains the "Add current song" and "Stage mode" buttons, and — because `.show-body`
inherits the same 471px — the right-hand edge of the stage readout, the transport, the
"Next" button and the marker jumps.

Proof it is the header and nothing else: hiding `.page-head` in the live DOM drops
`.show-page`'s `scrollWidth` from 471 to exactly 360; hiding only `.page-head .btn` does the
same. Hiding `.show-body`, `.show-stage`, `.stage-transport` or `.empty-state` changes
nothing.

**Fix:**

```css
.page {
  grid-template-columns: minmax(0, 1fr); /* the column may not floor at min-content */
}
.page-head {
  flex-wrap: wrap; /* buttons wrap instead of being cut */
  row-gap: var(--sp-2);
}
```

The first line is the structural one and fixes both pages at once; the second is what keeps
the buttons _usable_ rather than merely inside the box. `.page-head h1 { min-width: 0 }` is
worth adding while there.

### 2. The status bar hides its last three items on phones, unreachably

**Surfaces:** `page-start`, `page-mastering`, `page-show`, `page-show-stage` at 360/390/430.
**Hidden:** 179px of a 539px content run in a 360px bar; `span.sb-item` off-screen by 67px,
`span.sb-item.mono` by 52px.

`.statusbar` is `display: flex` with `white-space: nowrap` and `overflow: hidden`
(`src/styles/shell.css:586-601`), and every child is `.sb-item { flex: none }`
(`src/styles/shell.css:602-607`). Six non-shrinking items cannot fit, so "Online", the
"Saved hh:mm:ss" stamp and the deployed git commit are cut off with no scrollbar.

The affordance to fix this already exists and is unused: `.sb-item.shrink { flex: 0 1 auto;
min-width: 0; overflow: hidden; text-overflow: ellipsis }`
(`src/styles/shell.css:608-613`) — `grep` finds no `shrink` anywhere in
`src/components/shell/StatusBar.tsx:67-112`.

This only shows on the three non-Song pages because the Song page swaps the status bar for
`PhoneNav` at phone width (`src/App.tsx:127`).

**Fix:** in `StatusBar.tsx`, mark the compressible items `className="sb-item shrink"` (the
save stamp and the track/clip counts are the natural candidates), and drop the ones that
mean nothing on a phone — the commit hash and "Sources:" — behind the layout the shell
already knows. Do not simply add `overflow-x: auto`: a status bar that scrolls sideways is
worse than one that abbreviates.

### 3. A channel strip with a send is laid out in two half-width columns

**Surfaces:** `song-mix` at 360/390/430 (the Mix workspace), and any tall mixer.
**Effect:** the whole strip is halved — 49px columns instead of one 98px column.

```css
.dev-rack,
.strip-sends {
  grid-row: 4; /* src/styles/mixer.css:124-128 */
  margin-top: var(--row-tight);
}
```

The strip's own row template (`src/styles/mixer.css:43-52`) reserves **row 3 for the device
rack and row 4 for sends**:

```
auto             /* name        */
auto             /* input stage */
minmax(0, auto)  /* device rack */   <- row 3, currently left empty
auto             /* sends       */   <- row 4, currently holds both
```

So on any channel that has _both_ inserts and sends, two items are placed in the same cell,
grid auto-placement resolves the collision by creating an implicit second column, and the
strip's computed `grid-template-columns` becomes `49px 49px` instead of `98px`. Every
full-width row — name, input stage, pan, fader + meter, mute/solo/arm, readout, footer — is
then confined to column 1, and `.strip > * { overflow: hidden }`
(`src/styles/mixer.css:236-239`) cuts whatever does not fit.

Measured at 390×844, demo project: `strip-Keys` and `strip-Lead` (the two tracks with
sends) report `grid-template-columns: "49px 49px"` with `.strip-mid` boxed at 49px against
69px of content — 20px of the fader lane and the meter's printed dB scale gone — and
`.strip-pan` clipped by 4px. `strip-Drums`, `strip-Bass`, `strip-Texture` and the buses all
compute `98px` and are correct. The scale that gets cut is the one
`src/styles/mixer.css:834-844` explicitly protects: _"a scale that loses its minus sign
reads '48' and tells the engineer the opposite of the truth."_

It hides on desktop because the short-mixer container query sets `.strip-sends { display:
none }` (`src/styles/mixer.css:1962-1964`) below 26.4em, so the collision never happens in
the bottom editor. It shows wherever the mixer is tall: the phone Mix workspace, and a
tablet or maximised console.

**Fix:** split the selector so each lands on its own row.

```css
.dev-rack {
  grid-row: 3;
  margin-top: var(--row-tight);
}
.strip-sends {
  grid-row: 4;
  margin-top: var(--row-tight);
}
```

Worth adding `.strip { grid-template-columns: minmax(0, 1fr); }` as a structural guard, so a
future row collision degrades into an overlap someone will see rather than a silent second
column. Re-check the four `@container mixer` blocks after the change: they renumber rows,
and `.dev-rack` currently has no explicit row inside them.

---

## Medium

### 4. Preferences: a setting row's label column collapses to 2px on a phone

**Surface:** `sheet-preferences` at 360 (54px spill) and 390 (24px).

`.set-row { grid-template-columns: minmax(0, 1fr) auto }`
(`src/styles/settings.css:59-66`). The `auto` control column takes whatever it needs first,
so on a 360px sheet the "Interface scale" control leaves the `minmax(0, 1fr)` label column
**2px wide**. `.set-label` has `min-width: 0` (`src/styles/settings.css:70-75`) so its box
dutifully collapses — and its text, having nowhere to go, paints straight across the
control.

**Fix:** stack the row at phone width rather than fighting for it.

```css
@media (max-width: 480px) {
  .set-row {
    grid-template-columns: 1fr;
  }
  .set-control {
    justify-content: flex-start;
  }
}
```

### 5. Preferences → Key commands: the description paints over the key combo

**Surface:** `sheet-preferences`; 102px spill at 360, 72px at 390, 32px at 430.

`.kc-row { grid-template-columns: minmax(0, 1fr) auto auto }`
(`src/styles/settings.css:260-267`) with `.kc-combo { min-width: 96px }`
(`src/styles/settings.css:285-286`) leaves the description 75px at 360. `.kc-desc` is itself
a flex row (`src/styles/settings.css:271-278`) whose children keep the default `min-width:
auto`, so the description text and the nowrap `.kc-when` chip
(`src/styles/settings.css:279-283`) refuse to shrink and spill over the combo button.
Worst case measured: "Set the velocity of the focused note (Shift: ±10)".

**Fix:** the same phone breakpoint (stack `.kc-row` to `1fr` and put the combo underneath),
plus `.kc-desc { flex-wrap: wrap }` and `min-width: 0` on its text child so the description
wraps instead of overhanging.

### 6. Browser → Pool: "Import MIDI" is cut off at the panel edge

**Surface:** `browser-pool` on desktop, 26px.

`.pool-head .btn { flex: 1 1 0 }` (`src/styles/panels.css:621-623`) asks the two buttons to
share the width, but `.btn` is `white-space: nowrap` (`src/styles/base.css:220`) and keeps
`min-width: auto`, so neither can shrink below its own text. "Import audio" + "Import MIDI"
need ~229px; the browser panel is 203px at its default 16% of 1280. `.panel-body {
overflow-x: hidden }` (`src/styles/shell.css:651-658`) cuts the difference, and nothing
scrolls to it.

**Fix:** `.pool-head .btn { min-width: 0; }` — and, so the labels degrade legibly rather
than mid-word, `overflow: hidden; text-overflow: ellipsis` on the button. `.pool-head {
flex-wrap: wrap }` is the alternative if both labels must stay whole.

### 7. Start page hero overruns its box, and gets worse with a longer project name

**Surface:** `page-start` at 390, 10px.

`.start-hero` (`src/styles/pages.css:100-104`) is a nowrap flex row: a 44px logo, an
unconstrained `<div>` holding the title and strapline, a spacer, and a `Continue "<project
name>"` button (`src/pages/StartPage.tsx:107-117`). The button is a `.btn` — nowrap,
`min-width: auto` — and the title block has no `min-width: 0`, so the row exceeds its box
and eats the page's right padding. It reads as "nearly fine" today only because the demo
project's name is short; the overrun grows one-for-one with the project name.

**Fix:** `.start-hero { flex-wrap: wrap; row-gap: var(--sp-4); }` and `.start-hero > div {
min-width: 0; }`. If the button must stay on the first line, give it `min-width: 0` and
ellipsise the name inside it.

---

## Low

### 8. The master strip's `DIM` label is cut with no ellipsis

**Surfaces:** every layout that shows a mixer; 2px.

`.strip-btns .th-mini { flex: 0 1 auto; min-width: 0; overflow: hidden }`
(`src/styles/mixer.css:260-264`) deliberately lets these shrink — the comment above it says
so — but sets no `text-overflow`, so "DIM" loses part of its last glyph rather than showing
an ellipsis. It is the only element in the app that trips the no-ellipsis check on a
real label.

**Fix:** add `white-space: nowrap; text-overflow: ellipsis;` to that rule, or give the
master's button row 2px more by trimming `.strip-btns { gap: 3px }`.

### 9. Clip fade handles are half-clipped at both ends of every clip

**Surfaces:** every arrangement, every layout; 5px each side.

`.fade-handle` is 11px wide (`src/styles/arrangement.css:537-546`) and is pushed outside the
clip by `transform: translateX(-5px)` / `translateX(5px)`
(`src/styles/arrangement.css:558-562`), while `.clip { overflow: hidden }`
(`src/styles/arrangement.css:218-223`) clips it. Measured on a 208px clip: the in-handle
occupies -5→6 and the out-handle 202→213, so a little under half of each handle's grab area
and of its visible dot is cut away.

**Fix:** inset the handles instead of overhanging (`left: 0` / `right: 0`, no transform), or
move `overflow: hidden` off `.clip` and onto the waveform canvas so the handles can ride the
corner as designed.

### 10. Drum editor ruler cuts its last bar number

**Surface:** `song-editor-drums` on desktop; 10px.

`.de-ruler` is `flex: none; overflow: hidden` (`src/styles/drumeditor.css:117-120`) and is
sized to exactly `gridW` (`src/components/drumeditor/DrumGrid.tsx:530-533`). `.de-bar-tick`
(`src/styles/drumeditor.css:128-140`) is an absolutely positioned label with no width, so
the final tick's digits run past the ruler's right edge and are cut.

**Fix:** `overflow: visible` on `.de-ruler` — the `.de-scroll` ancestor
(`src/styles/drumeditor.css:70-76`) already clips, and the ruler's background gradient does
not need the clip — or pad the ruler's width by one label.

---

## Advisory: tap targets below 32×32 on phones

169 distinct interactive elements measure under 32×32 CSS px on a phone. Most are
legitimate — a DAW's mixer is made of small controls, and the mixer scrolls, so they are
reachable. These are the ones worth a hit area:

| size  | element                                             | where                                    |
| ----- | --------------------------------------------------- | ---------------------------------------- |
| 5×5   | `.dev-power` (`src/styles/mixer.css:1571-1580`)     | device on/off lamp in every strip's rack |
| 10×10 | `.pw-power` (`src/styles/mixer.css:1747-1757`)      | plugin window power                      |
| 10×14 | `[data-testid="pr-note"]`                           | piano-roll note                          |
| 13×13 | mastering list row control                          | Release page                             |
| 46×6  | `.smeter-over` (`src/styles/mixer.css:798`)         | meter overload LED                       |
| 18×16 | `.in-flag`                                          | strip input stage                        |
| 20×20 | `.th-vol .knob`, inspector `.color-swatches button` | track header, Inspector                  |
| 22×22 | `.th-mini` (M/S/arm)                                | track header, mixer                      |

The pattern to copy is already in the codebase: `.resize-handle::after { position:
absolute; inset: -3px }` (`src/styles/shell.css:164-169`) grows the hit area without
changing layout or the drawn control. A `::after { inset: -12px }` on `.dev-power` makes it
a 29px target and changes nothing visually.

---

## Measured, not defects

Two patterns show up in the raw counts and should be recognised rather than "fixed":

- **Ellipsised truncation (20 distinct).** Browser list blurbs, diagnostics values, mixer
  strip labels, track names and the project name all clip with `text-overflow: ellipsis`.
  That is a name longer than its column, which is a design decision, not a fault. The audit
  labels these `ELLIPSIS` and sorts them below everything else.
- **Hit-area overhang (3 distinct).** `.resize-handle` reports a 3px "spill" and its parent
  panel `Group` a 3px "clip", both caused by `.resize-handle::after { inset: -3px }`
  (`src/styles/shell.css:164-169`). A pseudo-element enlarges `scrollWidth` without
  affecting layout. Benign, and exactly the fix recommended for the tap targets above.

## Re-running after a fix

```
AUDIT_JSON=/tmp/after.json node scripts/overflow-audit.mjs
diff <(jq -S '.summary.distinct' /tmp/before.json) <(jq -S '.summary.distinct' /tmp/after.json)
```

The summary is de-duplicated by a class-only DOM path and sorted, so the diff shows exactly
which defects a change removed — and which it introduced.
