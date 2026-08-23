# Responsive and orientation audit — Directive 02 §4

Nineteen form factors, both orientations where a device has two, both themes, three text
scales, and device safe-area insets. 982 surface probes, of which 570 are plugin editors —
every device in the picker opened on every cell.

The previous run (`docs/AUDIT-RESPONSIVE.md`) asked four questions, all about width, at six
portrait viewports. Its ten findings are fixed and this run confirms it: **horizontal
overflow is clean on eighteen of nineteen cells**, and the one exception is a wide-screen
widget rather than a control off the edge of a phone.

What that run could not see is that the product has a second axis. A phone in landscape is
360 px _tall_, and at that height the shortcuts sheet is 288 px and the Mix workspace's
mixer is smaller than one channel strip. Almost everything below is either a vertical
measurement or a question a width check cannot ask at all — orientation, touch size, safe
area, text scale — which is why a run at six portrait viewports came back clean.

**Sixteen tickets: 4 P0, 7 P1, 5 P2.** The single-sentence answer to the directive's
question — _is landscape a genuine second arrangement?_ — is **no**: a rotated phone opens
the arrangement on **zero whole track rows** where the same phone upright shows four to
eight. Section 3 has the numbers.

|                  |                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Instrument       | `scripts/overflow-audit.mjs` (extended; one instrument, not a second script)                                                     |
| Guards           | `e2e/orientation.spec.ts` (new), `e2e/trackheader.spec.ts` (existing)                                                            |
| Build audited    | `npm run build` taken at the start of this run, served by `npm run preview` on 4173                                              |
| Concurrent edits | seven files under `src/audio/` changed after that build; no component, stylesheet or hook did, so nothing measured here is stale |
| Screenshots      | `docs/audit/shots/`                                                                                                              |

> Line numbers are as of this audit. `src/` is being edited concurrently; the selectors and
> declarations quoted are the stable reference.

### Tickets at a glance

| id     | severity | what                                                         | cells   |
| ------ | -------- | ------------------------------------------------------------ | ------- |
| RA-001 | P0 ✅    | a landscape phone opens the arrangement on no whole track    | 3       |
| RA-002 | P0 ✅    | the track header row clips 29 px of its own control strip    | 14      |
| RA-003 | P0 ✅    | every plugin editor opens off the screen on a phone          | 9       |
| RA-004 | P0 ✅    | the shortcuts sheet clips ~1400 px and cannot be scrolled    | 19      |
| RA-005 | P1       | a plugin editor cannot be closed by touch                    | 14      |
| RA-006 | P1       | the rack's `Insert` button does not answer a pointer press   | 19      |
| RA-007 | P1       | nothing responds to a user's text-size setting               | 19      |
| RA-008 | P1       | channel strips clip vertically wherever the mixer is short   | 9       |
| RA-009 | P1       | sheets ignore the horizontal safe area                       | 6       |
| RA-011 | P1       | the product's own maximum interface scale breaks the console | 6       |
| RA-012 | P1       | the overflow menu button is 20×36 on a phone                 | 14      |
| RA-010 | P2       | the overview's window is wider than the overview             | 3       |
| RA-013 | P2       | the mixer scrolls sideways and clips downwards               | 1       |
| RA-014 | P2       | touch-target debt beyond the named tickets                   | 14      |
| RA-015 | P2       | sub-5 px clips                                               | various |
| RA-016 | P2       | the Diagnostics sheet does not close on Escape               | 19      |

Ids are stable identifiers, not a ranking; the sections below are grouped by severity, so
RA-010 to RA-012 are not in numeric order.

---

## 1. What was covered

### The matrix

| Form factor           | Cells                | Orientation          | Context |
| --------------------- | -------------------- | -------------------- | ------- |
| Phone small           | 360×740, 740×360     | portrait + landscape | touch   |
| Phone standard        | 390×844, 844×390     | portrait + landscape | touch   |
| Phone large           | 430×932, 932×430     | portrait + landscape | touch   |
| Tablet small          | 768×1024, 1024×768   | portrait + landscape | touch   |
| Tablet large          | 1024×1366, 1366×1024 | portrait + landscape | touch   |
| Tablet split-screen ½ | 512×768, 683×1024    | —                    | touch   |
| Tablet split-screen ⅓ | 341×768, 455×1024    | —                    | touch   |
| Laptop                | 1280×800, 1440×900   | —                    | mouse   |
| Desktop               | 1920×1080, 2560×1440 | —                    | mouse   |
| Ultrawide             | 3440×1440            | —                    | mouse   |

Split-screen cells are fractions of a tablet's _landscape_ width at its full landscape
height, which is what a side-by-side window on iPadOS or Android is. They are not phones —
a phone is short, a split window is a tall narrow column — and they break differently.

**Touch cells are created with `hasTouch`,** which is what turns on the product's own
`@media (pointer: coarse)` rules. The previous run measured phones with a mouse, so its
"4541 undersized tap targets" counted the desktop geometry of controls that grow under a
finger. That number is not comparable with this one.

### Per cell

Every surface the layout offers at that size: the six phone workspaces, the tablet combos
and drawers, the eight desktop editor tabs, all six browser tabs, the four top-level pages
(Live also in Stage mode), the four sheets, and the Inspector twice (track selected, clip
open). Then **all thirty devices in the rack's picker** — twenty-seven built-in effects and
the three third-party shelf plugins — inserted, opened and measured in their window.

Per cell the audit asks: horizontal _and vertical_ box overflow past the viewport; content
cut by its own box on either axis; truncation without an ellipsis; overlap between
statically-placed content-bearing siblings; scroll containers that clip the axis they do not
scroll, and inner scrollers that fill their outer one; sheets sized within the viewport and
dismissible by the documented gesture; the track header control strip specifically; and
touch targets against 44 CSS px on touch cells, 32 elsewhere.

### Variant passes

| Pass                       | What it changes                           | Result                       |
| -------------------------- | ----------------------------------------- | ---------------------------- |
| light / dark               | `data-theme`                              | identical, see §5            |
| root font-size 130% / 200% | `html { font-size }`                      | **no effect at all**, see §4 |
| `--ui-scale` 1.4           | the product's own maximum                 | 73 new defects, RA-011       |
| `--ui-scale` 2.0           | the WCAG 1.4.4 figure                     | 225 new defects, RA-007      |
| safe-area insets           | `--sat/--sab/--sal/--sar` = iPhone 14 Pro | 23 intrusions, RA-009        |

---

## 2. The grid

Numbers are **distinct defects** (de-duplicated by a class-only DOM path), not occurrences.
`pass` means zero. Known-benign patterns — the `::after { inset: -3px }` hit areas the
previous audit documented — are excluded.

| cell                | px        | layout          | h-overflow | v-overflow | clipped | overlap | scroll axis | sheets | track header | plugin editors | touch ≥44 | safe area |
| ------------------- | --------- | --------------- | ---------- | ---------- | ------- | ------- | ----------- | ------ | ------------ | -------------- | --------- | --------- |
| phone-sm-portrait   | 360×740   | phone (touch)   | pass       | 3          | 5       | pass    | pass        | pass   | **1**        | **30/30**      | 179       | pass      |
| phone-sm-landscape  | 740×360   | phone (touch)   | pass       | **5**      | **24**  | pass    | pass        | pass   | **1**        | **26/30**      | 166       | **7**     |
| phone-md-portrait   | 390×844   | phone (touch)   | pass       | 4          | 5       | pass    | pass        | pass   | **1**        | **30/30**      | 179       | pass      |
| phone-md-landscape  | 844×390   | phone (touch)   | pass       | 4          | **24**  | pass    | pass        | pass   | **1**        | **26/30**      | 186       | **2**     |
| phone-lg-portrait   | 430×932   | phone (touch)   | pass       | 4          | 6       | pass    | pass        | pass   | **1**        | **30/30**      | 199       | pass      |
| phone-lg-landscape  | 932×430   | phone (touch)   | pass       | 4          | **22**  | pass    | pass        | pass   | **1**        | 6/30           | 186       | pass      |
| tablet-sm-portrait  | 768×1024  | tablet (touch)  | pass       | 4          | 18      | pass    | pass        | pass   | **1**        | 3/30           | 189       | pass      |
| tablet-sm-landscape | 1024×768  | tablet (touch)  | pass       | 7          | 21      | pass    | **1**       | pass   | **1**        | 3/30           | 191       | pass      |
| tablet-lg-portrait  | 1024×1366 | tablet (touch)  | pass       | 3          | 9       | pass    | pass        | pass   | **1**        | 3/30           | 203       | pass      |
| tablet-lg-landscape | 1366×1024 | desktop (touch) | pass       | 4          | 13      | pass    | pass        | pass   | **1**        | 3/30           | 213       | pass      |
| split-sm-half       | 512×768   | phone (touch)   | pass       | 4          | 5       | pass    | pass        | pass   | **1**        | **30/30**      | 199       | **9**     |
| split-sm-third      | 341×768   | phone (touch)   | pass       | 3          | 6       | pass    | pass        | pass   | **1**        | **30/30**      | 179       | **23**    |
| split-lg-half       | 683×1024  | phone (touch)   | pass       | 4          | 7       | pass    | pass        | pass   | **1**        | 3/30           | 199       | **8**     |
| split-lg-third      | 455×1024  | phone (touch)   | pass       | 4          | 7       | pass    | pass        | pass   | **1**        | **30/30**      | 199       | **9**     |
| laptop-1280×800     | 1280×800  | desktop         | pass       | 3          | 17      | pass    | pass        | pass   | 6            | 3/30           | n/a       | pass      |
| laptop-1440×900     | 1440×900  | desktop         | pass       | 3          | 13      | pass    | pass        | pass   | 6            | 3/30           | n/a       | pass      |
| desktop-1920×1080   | 1920×1080 | desktop         | **1**      | 4          | 6       | pass    | pass        | pass   | 6            | 3/30           | n/a       | pass      |
| desktop-2560×1440   | 2560×1440 | desktop         | **1**      | 4          | 4       | pass    | pass        | pass   | 6            | 3/30           | n/a       | pass      |
| ultrawide-3440×1440 | 3440×1440 | desktop         | **1**      | 4          | 4       | pass    | pass        | pass   | 6            | 3/30           | n/a       | pass      |

Reading the columns:

- **h-overflow / v-overflow / clipped** exclude the plugin windows, which have their own
  column; otherwise RA-003 would dominate every phone row and hide everything else.
- **sheets**: 100 sheet and drawer probes across the matrix — every one fits inside its
  viewport on all four edges, carries a close control, and closes on the gesture the
  product documents for it. This column is a genuine pass. It says nothing about whether
  the sheet's _contents_ are reachable (RA-004) or about the keyboard (RA-016).
- **track header**: `1` on touch cells is RA-002, one distinct fault repeated on every
  header. `6` on mouse cells is the 32 px advisory (`.th-mini` 22×22, `.th-vol` 82×22) plus
  a 7 px ellipsised name — the same list the desktop has always had.
- **plugin editors**: `n/30` is how many of the thirty editors have a hard defect at that
  cell. `3/30` everywhere is the 3 px EQ-curve clip (RA-015); the large numbers are RA-003.
- **touch ≥44**: distinct interactive elements measuring under 44×44. See RA-014 for what
  is worth acting on and what is a DAW being a DAW.
- **safe area**: distinct chrome controls landing inside an injected device inset, from the
  dedicated pass. `pass` on the portrait phones because the top and bottom insets are
  handled; the failures are all horizontal and all in landscape or split-screen (RA-009).

Occurrence totals for the primary pass, before grouping: off-right 1116, off-bottom 265,
clipped 1239, clipped-vertically 1247, no-ellipsis 0, overlap 0, spill 921, scroll 5,
tap-target 18451.

---

## 3. Is landscape a real reflow? No.

**Nothing in the product answers orientation.** There is no `@media (orientation: …)` rule
anywhere in `src/styles/` — sixteen stylesheets, zero occurrences. `useViewport`
(`src/hooks/useViewport.ts:7-12`) keys off size only:

```ts
if (height < 500 || width < 700) return 'phone';
if (width <= 1024) return 'tablet';
return 'desktop';
```

A rotated phone therefore gets the portrait phone layout with 380 px less height, and the
chrome — which is all fixed-height and stacked vertically — eats the difference. The
measurement, from the audit's chrome-budget probe at every cell:

| cell                           | top bar | transport | arr toolbar | overview | bottom bar | ruler | **lanes** | **whole track rows** |
| ------------------------------ | ------- | --------- | ----------- | -------- | ---------- | ----- | --------- | -------------------- |
| phone-sm **portrait** 360×740  | 42      | 46        | 152         | 46       | 54         | 82    | 318       | **4**                |
| phone-sm **landscape** 740×360 | 42      | 46        | 84          | 46       | 54         | 82    | **6**     | **0**                |
| phone-md **portrait** 390×844  | 42      | 46        | 122         | 46       | 54         | 82    | 452       | **7**                |
| phone-md **landscape** 844×390 | 42      | 46        | 84          | 46       | 54         | 82    | **36**    | **0**                |
| phone-lg **portrait** 430×932  | 42      | 46        | 122         | 46       | 54         | 82    | 540       | **8**                |
| phone-lg **landscape** 932×430 | 42      | 46        | 84          | 46       | 54         | 82    | **76**    | **1**                |
| tablet-sm portrait 768×1024    | 42      | 52        | 45          | 46       | 24         | 82    | 299       | 4                    |
| tablet-sm landscape 1024×768   | 42      | 52        | 45          | 46       | 24         | 82    | 233       | 3                    |
| tablet-lg portrait 1024×1366   | 42      | 52        | 45          | 46       | 24         | 82    | 544       | 8                    |
| tablet-lg landscape 1366×1024  | 42      | 52        | 84          | 46       | 24         | 82    | 344       | 5                    |
| laptop 1280×800                | 42      | 52        | 68          | 46       | 24         | 82    | 224       | 3                    |
| desktop 2560×1440              | 42      | 52        | 36          | 46       | 24         | 82    | 653       | 10                   |

"Lanes" is `arr-scroll.clientHeight` minus the ruler and marker rows that sit _inside_ the
scroller, i.e. the height a track can use at scrollTop 0 — the state a user lands on.
"Whole track rows" is that divided by the 64 px lane height, floored.

The three landscape phones show **0, 0 and 1** whole tracks against **4, 7 and 8** upright.
The chrome does not change: the same top bar, the same transport, the same 46 px overview,
the same 82 px of ruler and marker rows, the same 54 px bottom nav, the same 64 px lane
height. That is the definition of a squashed portrait, and it is a finding in its own right
(RA-001).

![Landscape, 740×360: the whole first screen is chrome](shots/RA-001-landscape-360h-no-track-visible.png)

![The same phone upright, 360×740: four tracks](shots/RA-001-portrait-360w-four-tracks-visible.png)

The knock-on effects are the rest of this report: the Mix workspace's channel strips lose
39 px each (RA-008), the plugin window can no longer fit vertically (RA-003), and every
long sheet loses more of its content.

The tablets survive rotation because they have height to spare, not because anything
reflows. Note that **a large tablet in landscape (1366×1024) is served the desktop layout
with coarse-pointer rules** — that combination is what makes RA-002 apply to it too.

---

## 4. Text scaling: not implemented

The directive asks for 130% and 200%. Both were run. **Neither changes a single pixel.**

| pass     | `html` font-size | `body` font-size | a control's font-size | distinct defects           |
| -------- | ---------------- | ---------------- | --------------------- | -------------------------- |
| baseline | 16 px            | 12.5 px          | 11.5 px               | —                          |
| 130%     | 20.8 px          | 12.5 px          | 11.5 px               | byte-identical to baseline |
| 200%     | 32 px            | 12.5 px          | 11.5 px               | byte-identical to baseline |

Occurrence counts at 130% and 200% match each other exactly, in every category, on all
nineteen cells. The cause is that the product's type scale is expressed in pixels
(`src/styles/tokens.css:62-69`):

```css
--fs-2xs: calc(10.5px * var(--ui-scale));
--fs-xs:  calc(11px   * var(--ui-scale));
…
```

There is not one `rem` in any of the sixteen stylesheets. A browser or OS text-size setting
moves the root font size; nothing in MotionLab reads it.

The product's own control is the substitute, and it is capped: `clampScale`
(`src/state/prefsStore.ts:78-81`) clamps to `[0.85, 1.4]`, and the Preferences sheet offers
85 / 90 / 100 / 110 / 125 / 140 %. **200% is unreachable through any affordance in the
product.** Forcing `--ui-scale: 2` to see what would happen produces 225 new distinct
defects, including the top bar clipped by 314 px, the transport by 464 px and the bottom
editor's tab row by 511 px — plus the only `overlap` (12) and `no-ellipsis` (6) occurrences
in the whole audit. See RA-007 and RA-011.

![200% root font size, 390×844 — indistinguishable from 100%](shots/RA-007-root-font-200pct-unchanged.png)

---

## 5. Themes

Light and dark were run over the full matrix, all surfaces, all thirty plugin editors.

- 227 distinct defects in light, 227 in dark.
- Zero unique to either.
- Every occurrence count identical: off-right 1116, off-bottom 265, clipped 1402,
  clipped-vertically 1247, spill 921, scroll 5, tap 18451.

That is the three-theme contract in `CLAUDE.md` holding: themes redefine only the colour
block, so a theme cannot break a layout. Every ticket below applies equally to both. This
says nothing about contrast, which is a different audit.

---

## P0

### RA-001 — A phone in landscape opens the arrangement on no track at all

**Cells:** phone-sm-landscape (740×360), phone-md-landscape (844×390), phone-lg-landscape
(932×430).
**Measured:** 0, 0 and 1 whole track rows visible against 4, 7 and 8 in portrait; 6 px, 36 px
and 76 px of lane viewport out of 360, 390 and 430.
**Evidence:** `shots/RA-001-landscape-360h-no-track-visible.png`,
`shots/phone-md-landscape__song-arrange.png`.

At 740×360 the app spends 42 px on the top bar, 46 on the transport, 84 on the arrangement
toolbar, 46 on the overview and 54 on the bottom nav — 272 px of 360 — leaving `arr-scroll`
88 px, of which 82 px is the ruler and marker rows that live inside it. The first track
header is laid out at offset 82 in an 88 px viewport: six pixels of it are on screen.

**Cause.** No single declaration; the layout has no orientation concept.

- `src/hooks/useViewport.ts:7-12` decides the layout from width and height thresholds and
  never asks which way round the device is.
- `grep -rn "orientation" src/styles/` — nothing. Sixteen stylesheets, zero
  `@media (orientation: …)`.
- Every chrome row is a fixed height from `src/styles/tokens.css:136-148`
  (`--topbar-h: 42px`, `--transport-h: 52px`, `--bottomnav-h: 54px`) and
  `src/components/arrangement/Overview.tsx:22` (`OVERVIEW_H = 46`), none of which vary with
  available height.
- The lane height is a module constant: `const LANE_H = 64` in
  `src/components/arrangement/Arrangement.tsx:70`.

**Fixed** (`9b3a1c1`). Height is the scarce axis in landscape and width is not, so the fix
spends width to buy height. Below 500 px of height — the threshold `useViewport` already
uses to call a viewport a phone, so the CSS and the layout now agree about what a short
screen is — every band shortens (topbar 42→36, transport 46→40, nav 54→44, ruler 42→28,
global lanes 20→14), the overview is dropped, the toolbar stops wrapping and scrolls
sideways with a trailing fade, and in landscape the bottom nav becomes a side rail. The
rail is the single biggest win: it returns its whole 54 px rather than a fraction.

| Cell | Whole rows before | After | Portrait | Guard needs |
| --- | --- | --- | --- | --- |
| 740×360 | 0 | **2** | 4 | 2 |
| 844×390 | 0 | **3** | 7 | 3 |
| 932×430 | 1 | **4** | 8 | 4 |

That clears the comparison guard *exactly* rather than comfortably — 4 against
`floor(8/2)` is the bar, not a margin over it. Anything that adds a band back to a short
viewport will fail the guard, which is why the comparison is kept rather than replaced by
the simpler floor.

`GLOBAL_LANE_H` was a JS constant no other code read; the lanes now take their height from
the same token every other band uses. They are shortened rather than dropped — losing the
only route to tempo and markers is a worse trade than 6 px a lane.

**Original fix direction.** A short viewport needs a different arrangement, not the same one with
less room. The cheapest version that would clear this ticket: below ~500 px of height,
collapse the transport into the top bar, drop `.arrangement-overview`, hold the ruler
outside the scroller so it does not consume the first screenful, and let `LANE_H` come from
a token the layout can lower. Anything that gets `wholeTrackRowsVisible` to ≥ 1 clears the
guard; ≥ 3 is what the portrait experience implies.

**Guard:** `e2e/orientation.spec.ts` → _"a … phone in landscape opens on at least one whole
track"_ and _"loses no more than half its tracks to rotation"_.

---

### RA-002 — The track header row clips 29 px of its own control strip, on every touch cell

**Cells:** all fourteen touch cells — every phone, every tablet, every split-screen window,
portrait and landscape.
**Measured:** the header row is 64 px and holds 93 px of controls. `.th-controls` is 44 px
tall and starts at offset 45, so **25 of its 44 px are cut** — the mute, solo and arm
buttons are more than half invisible.
**Evidence:** `shots/RA-002-track-header-strip-clipped.png`.

**Fixed** (`ea41f2d`). Two stacked 44 px rows need 88 px and the row is 64, so the two
requirements cannot both hold with two rows of controls. Row 1 gives up its buttons:
2 padding + 18 name + 44 strip = 64 exactly. The strip keeps mute, solo, monitor and arm —
four at 44 with 4 px between them is 188 px against the 208 px column — and what row 1 held
joins what the strip already sheds into the track menu, which a touch user reaches by
long-pressing the header. Growing `LANE_H` was the other way out and is the wrong one: it
buys a taller header by showing fewer tracks, on the devices that already show the fewest.

Removing monitor from the strip to make room was tried first and broke BUG-002; a phone is
exactly where "am I listening to this input" is hardest to answer from anything else.

**Cause.** Directive 02 §1 grew the strip to the touch minimum but nothing grew the row it
lives in.

```css
/* src/styles/arrangement.css:487-509 */
@media (pointer: coarse) {
  .th-controls .th-mini {
    width: 44px;
    height: 44px;
  }
  .th-row .th-mini {
    width: 36px;
    height: 36px;
  }
}
```

The header adds up to `--sp-3` 6 + `.th-row` 36 + `margin-top` 3 + `.th-controls` 44 +
`--sp-2` 4 = **93 px**. The row is `LANE_H = 64`
(`src/components/arrangement/Arrangement.tsx:70`), a constant with no coarse-pointer
variant, and `.th { overflow: hidden }` (`src/styles/arrangement.css:342-350`) takes the
difference out of the bottom.

Note `--track-h: calc(64px * var(--ui-scale))` in `src/styles/tokens.css:139` exists and is
referenced by nothing — the height that is actually used is the TypeScript constant.

**Why two audits missed it.** `e2e/trackheader.spec.ts` measures each control's own box and
the strip's _right_ edge; the controls really are 44×44 and the strip really does fit
horizontally. The previous overflow audit asked four questions, all about width. Neither
looks down.

**Fix direction.** Make the lane height answer the pointer — a coarse-pointer `LANE_H` of
~96, sourced from `--track-h` so CSS and TS agree — or put the strip on the name row and
accept a wider header column. Do not fix it by shrinking the buttons back: that reopens §1.

**Guard:** `e2e/orientation.spec.ts` → _"no header control is cut off"_, six cells; plus the
new vertical-fit assertion inside the audit's own track-header probe.

---

### RA-003 — Every plugin editor opens off the screen on a phone

**Cells:** all six phone cells, split-sm-half, split-sm-third, split-lg-third — 9 of 19.
**Measured:** 30 of 30 editors overflow on 360×740, 390×844, 430×932, 512×768, 341×768 and
455×1024; 26 of 30 on the two smaller landscape phones; 6 of 30 at 932×430. Worst overhang
199 px on a 341 px-wide window; 196 px at 360×740.
**Evidence:** `shots/RA-003-plugin-window-offscreen-360w.png`,
`shots/phone-md-landscape__plugin-eq8.png`.

The window opens at a hard-coded point:

```ts
/* src/components/mixer/PluginWindow.tsx:25 */
const DEFAULT_POS = { x: 220, y: 120 };
```

with `min-width: 320px` (`src/styles/mixer.css:1731-1746`). 220 + 320 = 540, so on anything
narrower than 540 px the editor cannot fit however wide it is allowed to be. The
`max-width: min(760px, calc(100vw - 24px))` on the same rule caps the _size_ and does
nothing about the _position_; on a 360 px phone the window is 336 px wide starting at 220,
so 196 px of it — the preset picker, the A/B pair and the close button — is off the right
edge. In landscape the same constant fails vertically: `y: 120` plus a 300 px body exceeds a
360 px screen.

The drag clamp has the same constant baked in
(`src/components/mixer/PluginWindow.tsx:105-106`): `Math.min(window.innerWidth - 220, …)`
keeps 220 px of window on screen, which on a 360 px phone permits a position that is already
more than half off.

**Fix direction.** Clamp the opening position to the viewport the same way the drag does,
against the window's measured size rather than a literal 220 — and on a phone-class viewport
open the editor as a sheet rather than a floating window, because a draggable window on a
touch screen with no title-bar affordance is the wrong object.

**Fixed** (`ea41f2d`). `windowPlace.ts` measures the window against the viewport instead of
opening it at a constant: the preferred offset is used when it fits, the window centres
when it does not, and when the window is taller than the screen the header is pinned on
screen — if something must be cut it has to be the bottom, because the top is what
dismisses it. It re-places on `resize` and `orientationchange`, so a rotation cannot strand
a window that was correct a moment before, and the drag clamp now uses the window's real
width rather than the unrelated constant 220 it used to. Separately, `min-width: 320px`
beat `max-width: calc(100vw - 24px)` below 344 px of viewport — CSS resolves `min-width`
last — which put the window 24 px wider than a small phone however the maximum was written;
the minimum now yields.

The sheet-instead-of-window suggestion is **not** taken here. It is the better object on a
phone and it is a different change: a new presentation with its own dismissal, focus and
drag semantics, where this ticket is that the existing object opens somewhere unusable.
Worth its own ticket rather than smuggling in behind a placement fix.

**Guard:** `e2e/orientation.spec.ts` → _"the device window opens inside the viewport"_, four
cells, plus `tests/windowPlace.test.ts` for the arithmetic on eleven matrix cells.

---

### RA-004 — The keyboard shortcuts sheet clips most of its content and cannot be scrolled

**Cells:** all nineteen, both themes, every text scale.
**Measured:** at 1280×800 the body is 1399 px tall inside a 638 px sheet — the sheet clips
791 px away and nothing scrolls. Worst case 341×768: the body extends 1562 px below the
viewport. Roughly three of every four shortcuts in the product are unreachable at every
size.
**Evidence:** `shots/RA-004-shortcuts-sheet-unscrollable.png`,
`shots/phone-sm-landscape__sheet-shortcuts.png`.

**Cause: a class-name collision between two stylesheets.** `.sc-sheet` means the shortcuts
sheet in one file and the score's staff paper in another:

```css
/* src/styles/panels.css:361-371 — the shortcuts sheet */
.sc-sheet {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: min(80vh, 640px);
  overflow: hidden;
}
.sc-body {
  overflow-y: auto;
} /* :372 */

/* src/styles/score.css:212-217 — the score's page */
.sc-sheet {
  flex: none;
  display: block;
}
```

`src/main.tsx` imports `panels.css` at line 11 and `score.css` at line 18, so the later file
wins and the shortcuts sheet computes `display: block`. It is then not a column flex
container, `.sc-body` is never given a bounded height, its `overflow-y: auto` has nothing to
scroll, and the sheet's own `overflow: hidden` cuts the rest off. Measured computed values
at 1280×800: `.sc-sheet` `display: block`, `flex: 0 0 auto`, `clientHeight` 638,
`scrollHeight` 1429; `.sc-body` `clientHeight` 1399 = `scrollHeight`.

**Fixed** (`ea41f2d`), by the rename rather than by specificity, as directed. The shortcuts
family is now `ks-`; the score keeps `sc-`, having fifty classes under it to this one's
seven. `min-height: 0` was added to `.ks-body` as advised — a flex item's default
`min-height: auto` is its content, so without it the body cannot shrink and hands the
overflow straight back to the sheet, leaving a scroll that is declared and never happens.

Repointing the guard was part of the fix, not a tidy-up after it: the test queried
`.sc-sheet`, which after the rename finds the score's staff paper — a real element that
answers none of the questions being asked, so the test would have gone green while
measuring the wrong component.

**Guard:** `e2e/orientation.spec.ts` → _"the keyboard shortcuts sheet can be read to its
end"_.

---

## P1

### RA-005 — A plugin editor cannot be closed by touch

**Cells:** all fourteen touch cells.
**Measured:** close button 17×17, bypass lamp 10×10, A/B slots 20×22, preset picker 22 px
tall — against a 44 pt minimum. None of them has a coarse-pointer rule.

```css
/* src/styles/mixer.css:1871-1878 */
.pw-close {
  display: flex;
  align-items: center;
  padding: 2px;
}
/* src/styles/mixer.css:1780-1793 */
.pw-power {
  width: 10px;
  height: 10px;
}
/* src/styles/mixer.css:1853-1862 */
.pw-ab button {
  width: 20px;
  height: var(--control-h-sm);
}
```

`.pw-close` has no size of its own: it is 2 px of padding around a 13 px icon. Combined with
RA-003 — where the close button is one of the parts that lands off the screen — the only way
to dismiss a plugin editor on a phone is the Escape key handler at
`src/components/mixer/PluginWindow.tsx:88-97`, and a phone has no Escape key.
**Evidence:** `shots/RA-005-plugin-header-controls.png`.

**Fix direction.** The pattern already in the codebase is `::after { inset: -N px }`
(`src/styles/shell.css:164-169`), which grows the hit area without changing layout or the
drawn control. `.pw-close::after { inset: -14px }` makes it a 45 px target and looks
identical. Add a coarse-pointer block for the header row as a whole.

**Guard:** `e2e/orientation.spec.ts` → _"the device window header meets the touch minimum on
a phone"_.

---

### RA-006 — The rack's `Insert` button does not answer a real pointer press

**Cells:** all nineteen. On ten cells a second press works; on nine the audit could only
open the picker with a scripted `element.click()`.
**Measured:** `.dev-add` is 15 px tall (`src/styles/mixer.css:1703-1719`), and 12 px in a
bottom-editor mixer where the container queries shrink the rack. Traced with an event log:
`pointerdown` lands on the button, the strip is selected, the Channel Overview panel mounts
into `.mixer-wrap`, the strips reflow, the button moves 4 px, and `pointerup` and `click`
land on a different element.

**Cause.** Two things that are each defensible and are not, together: a control 12–15 px
tall, and a selection side-effect that changes the layout underneath the pointer between
press and release.

**Fix direction.** Reserve the Channel Overview's space whether or not a channel is
selected, so selecting one does not move the console; or select on `pointerup` rather than
`pointerdown`. Either alone fixes it. Growing `.dev-add` to a real target is worth doing
regardless.

Recorded rather than worked around: the audit's plugin sweep reports which route it needed
per cell, so a fix shows up as the note disappearing.

---

### RA-007 — Nothing in the product responds to a user's text-size setting

**Cells:** all nineteen. See §4 for the measurement.
**Measured:** root font-size at 130% and 200% produces geometry identical to 100% on every
cell, in every category. Zero `rem` units in `src/styles/`. The product's own scale caps at
140% (`src/state/prefsStore.ts:78-81`), so 200% — the figure WCAG 1.4.4 names — cannot be
reached at all.

Forcing `--ui-scale: 2` shows what the layout would do if the cap were simply raised: 225
new distinct defects, top bar clipped 314 px, transport 464 px, editor tab row 511 px,
Preferences sheet 151 px, plus the audit's only overlaps.

**Fix direction.** This is a real piece of work, not a one-line fix, and it is the ticket
most worth scheduling deliberately. The honest first step is to decide whether `--ui-scale`
is meant to _be_ the text-size mechanism — in which case it must be driven from the root
font size so an OS setting reaches it, and its ceiling has to go to 2.0 with the shell
made to survive that — or whether the type scale moves to `rem` and `--ui-scale` keeps
governing geometry only. Do not raise the cap without doing the second half; at 2.0 today
the top bar loses a third of itself.

---

### RA-008 — Channel strips are cut off vertically wherever the mixer is short

**Cells:** phone-sm/md/lg landscape, tablet-sm portrait and landscape, tablet-lg landscape,
laptop 1280×800 and 1440×900, desktop 1920×1080.
**Measured:** the strip is clipped by **39 px** on a landscape phone and **66 px** in the
tablet's bottom editor; `.strip-btns` (mute / solo / arm, and the master's `DIM`) by 30 px
on touch cells and 15–22 px on the laptop and desktop bottom editor; `.dev-rack` by 27–28 px;
`.strip-mid`, which holds the fader and the meter's printed dB scale, by 3–8 px.
**Evidence:** `shots/RA-008-mixer-strips-clipped-landscape.png`.

**Cause.** `.mixer { overflow-y: hidden }` (`src/styles/mixer.css:14-33`) with
`align-items: stretch`, so every strip is exactly the mixer's height, and
`.strip > * { overflow: hidden }` (`src/styles/mixer.css:248-251`) so each row loses
whatever does not fit. The comment above that rule says the container queries are what stop
it coming to that — and they do, down to a point: the ladder in
`src/styles/mixer.css:1997-2149` sheds rows at `max-height` 26.4 em, 22.4 em, 20.4 em and
16.96 em (~330, 280, 255 and 212 px). Below 212 px there is no further tier, and a landscape
phone's Mix workspace gives the mixer well under half of that.

The scale being cut is the one `src/styles/mixer.css:850-856` explicitly protects:
_"a scale that loses its minus sign reads '48' and tells the engineer the opposite of the
truth."_

**Fix direction.** Add tiers below 16.96 em that shed the fader/meter block and leave name,
rack and mute/solo — or, better, make a mixer under ~200 px scroll vertically instead of
clipping, since at that height the strip is not a strip any more.

---

### RA-009 — Sheets ignore the horizontal safe area

**Cells:** phone-sm-landscape, phone-md-landscape, split-sm-half, split-sm-third,
split-lg-half, split-lg-third. 23 distinct intrusions at the worst cell.
**Measured** with iPhone 14 Pro insets injected (portrait 59 top / 34 bottom, landscape 59
each side / 21 bottom): `settings-sheet` footer buttons 35 px inside the left and right
bands, `export-run` 35 px, `shortcuts-close` 34 px, the diagnostics close button 51 px,
`copy-report` / `panic` / `run-smoke` 49 px.

**Cause.** `.app` pads itself by the insets
(`src/styles/shell.css:99-101`: `padding-left: var(--sal); padding-right: var(--sar)`), and
that is the only place the horizontal insets are consumed —
`grep -rn "\-\-sal\|\-\-sar" src/styles/` returns three lines in the whole product: those two,
and `--sar` on the toast stack at `src/styles/shell.css:926-929`. Every sheet is `position: fixed; inset: 0`
(`src/styles/settings.css:5-14`, `src/styles/shell.css:952-960`), which is positioned
against the viewport and therefore escapes `.app`'s padding entirely. The bottom inset is
handled — `.sheet { padding-bottom: var(--sab) }` at `src/styles/shell.css:971` — the sides
are not.

**Fix direction.** Pad the scrims, not the sheets:
`padding: var(--sp-5) calc(var(--sp-5) + var(--sar)) var(--sp-5) calc(var(--sp-5) + var(--sal))`
on `.sheet-scrim` and `.sheet-overlay`. One change covers all four sheets.

**Caveat.** This is the layout's _response_ to insets, measured by overriding the four
tokens. Whether a real notch, Dynamic Island or home indicator actually covers those
controls is BLOCKED — see §BLOCKED.

---

### RA-011 — The product's own maximum interface scale breaks the console

**Cells:** phone-md-landscape, tablet-sm-landscape, tablet-lg-portrait/landscape, laptop
1280×800 and 1440×900.
**Measured** at `--ui-scale: 1.4`, which the Preferences sheet offers as "140%": 73 distinct
defects that do not exist at 100%. `mix-mute-*` (the mixer's mute buttons) pushed 29–39 px
below the bottom of the mixer; `.strip-mid` cut by 24 px and the fader slot and level by
15 px at 1280×800; an Inspector button 51 px past the right edge; `groove-extract` 18 px past;
the transport's master section 21 px past.
**Evidence:** `shots/RA-011-ui-scale-140-mixer.png`.

`src/styles/tokens.css:29-31` says the offered range is 0.85–1.4 and that _"the layout is
tested at both ends"_. It is not: this is the first run to test the top end, and the top end
fails.

**Fix direction.** Same mechanism as RA-008 — the container-query ladder is keyed in `em`,
so raising `--ui-scale` raises the thresholds' pixel values and the mixer should shed rows
sooner, but the strip's fixed sub-elements grow faster than the tiers shed. Re-derive the
tiers with the scale at 1.4 rather than at 1.

---

### RA-012 — The overflow menu button is 20×36 on a phone

**Cells:** all fourteen touch cells; 15×36 in a split-screen third.
**Measured:** `[data-testid="topbar-overflow"]` is 20 px wide against a 44 pt minimum.

This one is called out separately from RA-014 because of what is behind it: on a phone the
top bar has no icons for Preferences, Export, Keyboard shortcuts or Diagnostics — the audit
reaches all four through the overflow menu because _that is the only route a phone user
has_ (the surface map in `scripts/overflow-audit.mjs` says so, and it is right). A 20 px
target is the door to four surfaces.

**Fix direction.** `::after { inset: -12px }`, per RA-005.

---

## P2

### RA-010 — The arrangement overview's window is wider than the overview

**Cells:** desktop-1920×1080, desktop-2560×1440, ultrawide-3440×1440.
**Measured:** `.ov-window` measures 2749 px past the right edge of the viewport at 3440×1440;
`.arr-overview` reports 3338 px of content in its box.
**Evidence:** `shots/RA-010-overview-window-wider-than-overview.png`.

Nothing paints outside the app — `.arr-overview { overflow: hidden }`
(`src/styles/arrangement.css:913-922`) clips it — so this is not a control off the screen.
The defect is that the navigator's window covers the whole navigator:
`viewW = max(6, (viewportW / pxPerBeat) * scale)` in
`src/components/arrangement/Overview.tsx:136` is unclamped, so when the timeline shows more
beats than the project contains, the window is drawn wider than the strip it sits in. Since
`.arr-overview`'s pointer handler returns early for presses on `.ov-window`
(`src/components/arrangement/Overview.tsx:164-166`), click-to-jump becomes unreachable on
exactly the screens where it is least needed.

**Fix direction.** `Math.min(width - viewLeft, …)` on `viewW`, and let the whole-project
case read as "the window is the whole strip" rather than as an overhang.

### RA-013 — The mixer scrolls sideways and clips downwards

**Cell:** tablet-sm-landscape (1024×768). **Measured:** 6 px of content below the fold in a
box with `overflow-x: auto; overflow-y: hidden` (`src/styles/mixer.css:14-33`).

The only scroll-axis defect in the matrix, and the only nested-scroller finding — there are
no scroll traps anywhere else. It is the same root as RA-008 seen from the container's side:
six pixels the container knows about and no gesture reaches.

### RA-014 — Touch-target debt beyond the named tickets

**Cells:** all fourteen touch cells. **Measured:** 313 distinct interactive elements under
44×44, 26 045 occurrences.

Most of this is a DAW being a DAW — a mixer is made of small controls and it scrolls, so
they are reachable — and it should not be fixed by growing everything. These are the ones
whose size is a usability fault rather than a density decision, all fixable with a
pseudo-element hit area:

| size  | element                                | where                                         |
| ----- | -------------------------------------- | --------------------------------------------- |
| 5×5   | `.dev-power`                           | the on/off lamp on every device in every rack |
| 10×10 | `.pw-power`                            | plugin window bypass (also RA-005)            |
| 17×17 | `.pw-close`                            | plugin window close (also RA-005)             |
| 12×4  | `.meter-clip-led`                      | the transport's clip indicator                |
| 46×6  | `.smeter-over`                         | every strip's overload LED                    |
| 18×16 | `.in-flag`                             | strip input stage (Ø)                         |
| 20×20 | `.color-swatches button`, `.eq-handle` | Inspector, EQ face                            |
| 20×22 | `.pw-ab button`                        | plugin A/B                                    |
| 13×13 | `.ms-normalize input`                  | Release page                                  |
| n×20  | `.browser-tab-*`                       | all six browser tabs, 20 px tall              |
| 31×24 | `.tool-*`                              | arrangement tool buttons                      |
| 40×22 | `.switch`                              | every toggle in Preferences                   |

### RA-016 — The Diagnostics sheet is the only sheet that does not close on Escape

**Cells:** all nineteen — this is not viewport-dependent, but it is in the directive's
"modals and sheets … dismissible" column, so it belongs here rather than nowhere.

Preferences (`src/components/settings/SettingsSheet.tsx:80-83`), Export
(`src/components/common/ExportSheet.tsx:46-49`) and Keyboard shortcuts
(`src/components/common/ShortcutsSheet.tsx:31-38`) each install their own `keydown`
listener. `src/components/diagnostics/DiagnosticsSheet.tsx` installs none, and the global
Escape ladder in `src/hooks/useKeyboard.ts:378-397` — whose own comment says
_"overlay open → close it"_ — only knows about `ui.dialog` and `ui.contextMenu`, not
`diagnosticsOpen`. So Escape on an open Diagnostics sheet falls through to the next rung
(clear the selection, then audio panic).

It is still dismissible on every cell: it has a close button and a scrim tap, which is why
the **sheets** column passes. Low severity, one line to fix, and the kind of thing that is
only ever found by pressing the key.

**Fix direction.** Add `diagnosticsOpen` to the ladder's overlay rung rather than a fourth
per-sheet listener — four components with four copies of the same handler is what made this
easy to miss.

**Guard:** `e2e/orientation.spec.ts` → _"every sheet closes on Escape"_.

### RA-015 — Sub-5 px clips

**Cells:** as listed. Grouped because each is small, none is benign, and they share no cause.

- `.t-display` (the transport's bars/beats readout) clipped 5 px horizontally at 430×932 and
  341×768.
- `.fx-curve` clipped 3 px vertically inside the plugin window on all nineteen cells, in the
  EQ, EQ8 and Filter editors — `CURVE_H = 96` in `src/components/mixer/PluginFace.tsx:64`
  against a container that resolves to 93.
- `.panel-title` clipped 3 px vertically in the drawers, the shortcuts sheet and the
  diagnostics sheet on the tablet cells.
- `[data-testid="pane-main"]` clipped 3 px vertically on the laptop and desktop cells.

---

## Measured, and not defects

- **Light and dark are the same layout.** §5. Reported as a pass, not omitted.
- **All 100 sheet and drawer probes fit and dismiss.** Every sheet sits inside its viewport
  on all four edges at every cell including 341×768 and 740×360, carries a close control at
  least 36×36, and closes on the first press of that control. RA-004 is about a sheet's
  _contents_ rather than its box, and RA-016 is about the keyboard rather than the control;
  neither changes this result.
- **Zero overlaps at any cell**, at 100% and 140% scale. The strip-collision class of bug
  the previous audit found (its finding 3) has not come back. Overlaps appear only at a
  forced 200% scale.
- **Zero truncation without an ellipsis.** The previous audit's finding 8 (`DIM`) is fixed;
  `DIM` now clips with an ellipsis and is labelled `ELLIPSIS`, sorted last.
- **Horizontal overflow is clean on 18 of 19 cells** once the plugin windows are set aside.
  The previous run's fixes hold at sizes it never tested, including 341 px and 3440 px.
- **Hit-area overhang.** `.resize-handle::after { inset: -3px }`
  (`src/styles/shell.css:164-169`) reports a 3 px spill and a 3 px clip on its parent. A
  pseudo-element enlarges `scrollWidth` without affecting layout. Benign, and exactly the
  fix this report recommends for RA-005, RA-012 and RA-014.
- **Ellipsised truncation.** Track names, project names, browser blurbs, diagnostics values
  and mixer strip labels clip with `text-overflow: ellipsis`. A name longer than its column
  is a decision. The audit labels these and sorts them below everything else.
- **Clip fade handles.** The previous audit's finding 9 is fixed with
  `overflow: clip; overflow-clip-margin: 6px` (`src/styles/arrangement.css:218-229`), and
  the instrument now understands that idiom — see the calibration note below — so it no
  longer re-reports the fix as the bug it removed.

---

## BLOCKED — cannot be answered headless

These are not passes and they are not omissions. Each needs hardware or a device cloud.

| Check                                    | Why it cannot run here                                                                                                                                                                                                                                                                                                                                                                              | What would settle it                                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notch / Dynamic Island / home indicator  | Headless Chromium resolves every `env(safe-area-inset-*)` to `0px`, and `viewport-fit=cover` has no effect without a device that has an unsafe area. RA-009 was measured by overriding the four tokens in `src/styles/tokens.css:193-196`, which tests **the layout's response to insets**, not the insets themselves.                                                                              | A real iPhone 14 Pro / Pixel with a display cutout, or an iOS Simulator with Safari Web Inspector. One device in each orientation, three screenshots. |
| Home-indicator gesture conflict          | The bottom nav sits in the home-indicator strip. Whether a swipe on `nav-arrange` is stolen by the system gesture is an OS behaviour with no headless equivalent.                                                                                                                                                                                                                                   | Manual test on iOS and Android; ten seconds per device.                                                                                               |
| IME / software keyboard                  | No IME in headless. The keyboard shrinks the _visual_ viewport without changing the layout viewport, and nothing in the product listens to `visualViewport` (`grep -rn "visualViewport" src/` finds one read-only diagnostic at `src/diagnostics/layout.ts:107-108`). The likely failure — a focused input scrolled under the keyboard in the Preferences and Export sheets — is real and untested. | A real device, or Chrome DevTools' virtual-keyboard emulation driven by hand. Worth a ticket of its own once someone can see it.                      |
| Rotation mid-gesture                     | Playwright can resize a viewport but cannot rotate a device mid-pointer-sequence: there is no way to fire a genuine `orientationchange` between `pointerdown` and `pointerup`, and no touch-drag primitive that survives the resize. Given RA-001, rotating while dragging a clip is likely to leave the pointer over a different lane.                                                             | A device cloud that scripts rotation (BrowserStack/Sauce), or a manual test: start a clip drag, rotate, release, check where the clip landed.         |
| Momentum scrolling and rubber-band traps | The nested-scroller check here is structural — it asks whether an inner scroller fills its outer one. Whether iOS Safari's momentum actually hands a flick back to the parent is an engine behaviour.                                                                                                                                                                                               | Manual test on iOS Safari, one flick per scroller.                                                                                                    |
| iOS Dynamic Type / Android font scale    | RA-007 proves the product ignores the root font size, which is the mechanism both platforms use, so the outcome is known. What is not testable here is whether the platform applies its own text inflation on top.                                                                                                                                                                                  | A device with Dynamic Type at its largest setting. Expect no change, per RA-007.                                                                      |
| Colour rendering, contrast, HDR          | Out of scope. This audit is geometry; §5's theme result says the layouts are identical, not that the colours are legible.                                                                                                                                                                                                                                                                           | A contrast audit against the same matrix.                                                                                                             |

---

## Re-running

```bash
npm run build && (setsid npm run preview &)

# the primary pass: full matrix, every surface, all thirty plugin editors
AUDIT_JSON=/tmp/after.json AUDIT_SHOTS=docs/audit/shots node scripts/overflow-audit.mjs

# the variants
AUDIT_THEME=dark        AUDIT_JSON=/tmp/dark.json  node scripts/overflow-audit.mjs
AUDIT_TEXT_SCALE=200    AUDIT_PLUGINS=none AUDIT_JSON=/tmp/t200.json node scripts/overflow-audit.mjs
AUDIT_UI_SCALE=1.4      AUDIT_PLUGINS=none AUDIT_JSON=/tmp/ui140.json node scripts/overflow-audit.mjs
AUDIT_SAFE_AREA=device  AUDIT_PLUGINS=none AUDIT_JSON=/tmp/safe.json node scripts/overflow-audit.mjs

# one ticket at a time
AUDIT_ONLY=phone-sm-landscape/song-arrange   node scripts/overflow-audit.mjs   # RA-001
AUDIT_VIEWPORTS=split-sm-third AUDIT_PLUGINS=Compressor node scripts/overflow-audit.mjs  # RA-003
AUDIT_ONLY=sheet-shortcuts                   node scripts/overflow-audit.mjs   # RA-004

# prove a fix removed findings and added none
diff <(jq -S '.summary.distinct' /tmp/before.json) <(jq -S '.summary.distinct' /tmp/after.json)
```

The JSON is sorted and free of coordinates that jitter, so two runs diff cleanly. Each
viewport also carries a `chrome` block (the §3 table) and a `trackHeader` block, so RA-001
and RA-002 can be watched as numbers rather than as the presence or absence of a finding.

### What changed in the instrument

Everything below is additive; the existing calibrations are unchanged — findings reachable
through a scrollable ancestor are still suppressed, and truncation carrying
`text-overflow: ellipsis` is still labelled and sorted last rather than reported as a fault.

- Nineteen viewports with orientation and form-factor class, replacing six portrait ones.
- `hasTouch` on touch cells, and a 44 px tap minimum there against 32 px elsewhere.
- The vertical form of every horizontal question: `vbottom` (box past the bottom edge with
  nothing to scroll) and `vclipped` (content cut by its own box), both with the same
  reachable-by-scroll suppression and with ancestor-cascade suppression so a strip cut by
  39 px does not also report its meter, its bars and its scale cut by 39 px.
- `overlap` between statically-placed, untransformed, content-bearing siblings.
- `scroll`: a container that clips the axis it does not scroll, and an inner scroller that
  fills its outer one.
- `safe`: interactive chrome inside an injected device inset, excluding anything a scroll
  would move out of the band.
- A chrome-budget probe per cell (§3) and a vertical-fit assertion in the track-header probe.
- The plugin sweep: the picker is read out of the DOM rather than hard-coded, so a device
  added to `src/model/effects.ts` is audited the day it lands.
- Two new noise calibrations, both of which were removing real signal:
  `overflow: clip` with a non-zero `overflow-clip-margin` is a declared bleed and not a
  clip (without this the audit re-reports the previous audit's own fix as a bug on every
  cell forever); and the vertical clip floor is 2 px rather than 1 px, because
  pseudo-element hit areas enlarge `scrollHeight` everywhere.

### Guards

`e2e/orientation.spec.ts` holds the claims that must not regress. Seven of its declarations
are marked `test.fail()` and name their ticket — sixteen of the twenty-one runs — while five
runs are real passes that guard behaviour which currently works (sheets fitting and closing
at 740×360 and 341×768, the plugin window fitting on a tablet and a laptop, and the largest
landscape phone clearing the one-row floor).

Playwright **fails a `test.fail()` test that passes**, so the day a fix lands the suite says
so by name. Removing the `test.fail()` line is the last step of each fix, not an optional
tidy-up. Current state: 21 tests, 0 unexpected outcomes.

```
npx playwright test e2e/orientation.spec.ts e2e/trackheader.spec.ts
```
