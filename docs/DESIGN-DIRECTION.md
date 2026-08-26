# Design Direction — TXPPS MotionLab Studio

**Kind:** direction, written to be built from. It argues for a look; it does not
report how much of that look the product currently has.
**Scope:** the product's visual identity — colour, material, type, controls.
**Non-scope:** layout, information architecture, feature set. Those are settled and good.

The client's critique is that the UI "looks generic and like 'AI slop'". This
document treats that as a correct observation, finds the mechanisms that produce
it, and specifies a replacement precisely enough that an engineer who has never
read the critique can build it.

Everything here is expressed as changes to `src/styles/tokens.css` plus a bounded
set of component rules. Nothing here requires a layout change, a component
rewrite, or a new dependency.

---

# Part 1 — Diagnosis

## 1.1 The tells, measured

I converted every surface, border and text token in the dark theme to CIE L\*
(perceptual lightness), HSL hue and chroma. The result is not a matter of taste.

| token              | hex       | L\*   | ΔL\* from previous | chroma | hue |
| ------------------ | --------- | ----- | ------------------ | ------ | --- |
| `--bg-deep`        | `#06080b` | 2.1   | —                  | 5      | 216 |
| `--bg-app`         | `#0a0d11` | 3.5   | 1.4                | 7      | 214 |
| `--bg-input`       | `#0d1116` | 4.9   | 1.4                | 9      | 213 |
| `--bg-panel`       | `#12161d` | 7.1   | 2.2                | 11     | 218 |
| `--bg-panel-2`     | `#161b23` | 9.6   | 2.5                | 13     | 217 |
| `--bg-float`       | `#1a212a` | 12.4  | 2.8                | 16     | 214 |
| `--border-soft`    | `#1b212a` | 12.5  | 0.1                | 15     | 216 |
| `--bg-raised`      | `#1d242d` | 13.9  | 1.4                | 16     | 214 |
| `--bg-hover`       | `#232b36` | 17.2  | 3.3                | 19     | 215 |
| `--border`         | `#262e39` | 18.6  | 1.4                | 19     | 215 |
| `--bg-active`      | `#2a333f` | 20.9  | 2.3                | 21     | 214 |
| `--border-strong`  | `#36414f` | 27.1  | 6.2                | 25     | 214 |
| _(nothing at all)_ |           | 27–61 | **33.9**           |        |     |
| `--text-faint`     | `#8b94a1` | 61.0  | 33.9               | 22     | 215 |
| `--text-dim`       | `#9aa3ae` | 66.6  | 5.6                | 20     | 213 |
| `--text`           | `#e9e6dd` | 91.3  | 24.7               | 12     | 45  |

### Tell 1 — one hue, and it is _the_ hue

Fourteen of the fifteen tokens above sit between **hue 213 and 218**. That is
slate blue-grey: Tailwind's `slate`, Bootstrap's `gray`, the default cool grey of
every UI kit and therefore of every generative model's prior. It is, verbatim,
the "undifferentiated grey-blue palette" in the brief. The one token that escapes
it — `--text` at `#e9e6dd`, hue 45, a warm off-white — is the single best colour
decision in the file and nobody built on it.

### Tell 2 — the whole product happens inside 19 L\* points

Nine surface tokens are packed between L\* 2.1 and 20.9, with steps of 1.4–3.3.
`--border-soft` (12.5) and `--bg-float` (12.4) are **0.1 L\* apart** and therefore
the same colour. `--bg-raised`, whose entire job is to be _raised_, sits 4.3 L\*
above `--bg-panel-2` — below the threshold at which a viewer reads a step as
deliberate rather than as a rendering artefact.

Then there is a **33.9 L\* void** with nothing in it, and text arrives at 61.
The palette has no midtones, so nothing in the product can be mid-grey: an
element is either "almost the background" or "text".

### Tell 3 — a single 1px border is the only structural device in the product

```
44 × border: 1px solid var(--border-soft)
25 × border-bottom: 1px solid var(--border-soft)
18 × border: 1px solid var(--border)
11 × border: 1px solid var(--border-strong)
  … 130+ single-weight 1px borders across 8,372 lines of CSS
```

And they are nearly invisible:

- `--border-soft` against `--bg-panel-2`: **1.07:1**
- `--border` against `--bg-panel-2`: **1.26:1**

So the console is a field of near-identical rectangles separated by lines the eye
can barely resolve, at a uniform weight, with nothing else carrying structure.
This is the "evenly-weighted borders on every box" tell in its pure form.

### Tell 4 — the depth tokens exist and are not used

`tokens.css` defines `--sh-1` … `--sh-4`, `--sh-inset`. Across all 16 stylesheets:

```
--sh-1      1 use
--sh-2      0 uses      ← the elevation step for "raised chrome"
--sh-3      3 uses
--sh-4      3 uses
--sh-inset  2 uses
```

There are seventeen `box-shadow` declarations in the entire product, and eight of
them are one-off literals written past the token system (`0 2px 5px rgba(0,0,0,.5)`
on the fader cap, `0 0 6px rgba(216,74,68,.8)` on the clip LED). **There is no
material language.** Nothing is raised, nothing is inset, nothing is flat —
everything is flat, and the flatness is not a decision, it is an omission.

The fader — the single most important control in a DAW — is drawn as:

```css
/* src/styles/mixer.css */
.fader .fader-track {
  width: 4px;
  background: var(--bg-deep);
  border: 1px solid var(--border-soft);
}
.fader .fader-thumb {
  width: 26px;
  height: 14px;
  background: linear-gradient(var(--bg-hover), var(--bg-raised) 45%, var(--bg-panel-2));
  border: 1px solid var(--border-strong);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.5);
}
```

A 4px line, a rounded rectangle with a soft three-stop gradient across a 4.3 L\*
range, and one literal shadow. It is a web slider thumb. It has no waist, no
grip, no index line, no cast direction, no scale printed beside it.

### Tell 5 — one accent colour does thirteen unrelated jobs

```
--accent      99 uses
--accent-bg   40 uses
--accent-hi   14 uses
--accent-line 12 uses
--accent-dim  10 uses
                  = 175 uses of one teal
--info         3 uses      ← the blue exists and is essentially unused
```

The same `#37b89a` currently means: solo engaged, insert engaged, send enabled,
selected list row, active segmented option, primary button, focus ring, cue-mix
live, resize-handle hover, FX-channel tint, EQ handle, meter mid-band, and
"add" affordances. Thirteen meanings, one colour. That is not an accent system,
it is a highlight colour.

It also produces a specific, embarrassing error: **solo is teal and mute is
amber**. On every console ever built, solo is yellow. We inverted the one colour
convention in audio that is genuinely universal.

```css
/* src/styles/arrangement.css */
.th-mini.m-on {
  background: var(--warm-bg);
  color: var(--warm);
} /* mute  = amber */
.th-mini.s-on {
  background: var(--accent-bg);
  color: var(--accent);
} /* solo  = teal  */
.th-mini.r-on {
  background: var(--danger-bg);
  color: var(--danger);
} /* arm   = red   */
.th-mini.on {
  background: var(--accent-bg);
  color: var(--accent);
} /* …and so is everything else */
```

### Tell 6 — type is one family at two weights, and one feature flag is dead

```
16 × font-family: var(--font-num)     (= --font-mono)
15 × font-family: var(--font-mono)
 2 × font-family: var(--font)         (everything else inherits it)
```

Two faces: the OS UI face and the OS mono face. Weights in use are 400 (implicit)
and 600/700 (58 declarations); 500 appears seven times. There is no condensed
face — which is why the mixer strip, at a fixed 96px, truncates almost every
label it draws. There is no distinction between the face used for a _number_ and
the face used for a _label_ beyond "mono vs not-mono".

`base.css` also ships `font-feature-settings: 'tnum' 1, 'cv08' 1`. `cv08` is an
**Inter-specific** character variant. Inter was removed from the stack in commit
`3d787cc` and the flag was left behind, so the product is asking for a feature no
loaded font has. It is a fossil of exactly the font the "AI slop" critiques name
first.

### Tell 7 — spacing is even, not rhythmic

```css
/* src/styles/mixer.css */
.strip {
  display: grid;
  grid-template-rows: /* 9 rows */;
  row-gap: 4px;
}
```

Nine functionally different rows — identity, input stage, inserts, sends, pan,
fader, transport buttons, readout, routing — separated by nine identical 4px
gaps. Nothing groups. The eye gets no help deciding that "trim / Ø / M" is one
thing and "M / S / ●" is another. This is the "spacing that is even rather than
rhythmic" tell, and it is also why the strip reads as a form rather than as a
channel.

### Tell 8 — controls are web form controls

`input[type='range']` is styled once in `base.css` with a 4px track and a **13px
circular thumb filled with the accent colour**, and that control is then used for
sends, plugin parameters, cue levels and inspector values — i.e. for most of the
parameters in the product. A round accent-coloured dot on a hairline track is the
default HTML range slider with a colour swapped. `select` is a native select with
a drawn caret. `.btn` is a 1px-bordered rounded rectangle. Nothing in the product
is drawn as a thing you would find on a piece of audio hardware.

### Tell 9 — there is a real metering bug hiding inside the visual one

`.meter-fill` and `.smeter-fill` share an identical four-stop gradient, and
`mixer.css` says so explicitly:

```css
/* Same stops as .meter-fill: the same signal has to read the same on both meters */
```

They do not. `Meter` positions its fill with `normDb()` — **linear in dB**.
`StereoMeter` positions its fill with `meterScalePosition()` — **`x^1.9`**. The
same −13 dB signal lands at 78% of the mono meter and 62% of the stereo meter,
while both draw their colour change at the same fixed 62% gradient stop. The two
meters in the product disagree about what "hot" means. A percentage-based
gradient cannot express a dB-based scale; this is a visual-design defect that
became an accuracy defect.

### What the outside world says the tells are

The searches agree with the file. The named fingerprint of AI-generated UI in
2026 is _"the Inter typeface, an indigo-to-purple gradient, three rounded cards
in a row"_; _"gray 1px borders on every card"_; _"depth cues that behave like
decoration because each component uses a different shadow recipe"_; and
underneath all of it, that a model with no design constraint returns _"the
statistical average of millions of templates"_ — and **"an average isn't a style,
it's the absence of one."**

We do not have purple gradients or emoji. What we have is the deeper version of
the same failure: a palette that is the statistical average of a dark UI kit, one
1px border doing all structural work, shadow recipes written ad hoc past an
unused token system, and a single accent standing in for a vocabulary. The
surface symptoms differ; the mechanism is identical.

## 1.2 What professional consoles do that we do not

**They use two materials, not one.** A real desk is painted steel chrome with
black glass wells cut into it — meter bridges, fader slots, display windows. Every
serious DAW keeps that split: the chrome is one value family, the _work surfaces_
(timeline ground, meter bodies, fader slots, value fields) are a distinctly
darker, distinctly cooler family. We have one family at one hue for both, which is
why our chrome and our content look like the same substance and why the console
reads as a webpage.

**They use more greys, further apart.** A professional dark theme runs its
surfaces across roughly 30 L\* with 4–8 L\* between adjacent steps, and it keeps
midtones available for control bodies. We run nine surfaces across 19 L\* with
1.4–3.3 steps and have no midtones at all.

**Colour is rationed and assigned.** Studio One / Fender Studio Pro, Logic,
Cubase and Pro Tools all reserve saturated colour for a small closed set of
meanings — record, clip, solo, mute, monitor, automation mode — and forbid it
everywhere else. Track colour is a _separate_ system, allowed on clip bodies and
channel identity and nowhere else. Chrome selection is expressed as a **lighter
surface**, not as a coloured surface. We use one green for both "signal present"
and "this row is selected", which means colour has stopped carrying information.
Bitwig is the clearest demonstration of the principle in the other direction:
its highlight colours are assigned per _signal type_ — modulation, automation,
input — so a colour tells you what kind of thing you are looking at.

**A fader is drawn as a cap in a slot.** Four things make it read as hardware, and
we have none of them: (1) the slot is _inset_ — a dark well with a light bottom
lip, not a filled line; (2) the cap has a **waist** — a hard-edged value change
across its middle, not a soft gradient; (3) the cap carries an **index line** you
read the value from; (4) there is a **printed scale** beside the slot with a
marked unity detent. A knob is the same logic rotated: value arc _outside_ the
cap, pointer _cut into_ the cap as a groove rather than painted on as a bright
line, detent tick at default.

**The console shows signal flow as vertical order plus material change.** Input at
the top, then the insert rack, then sends, then pan, then the fader, then the
output. The rack is visibly a _rack_ — slots seated in a rail — so you can see
that signal passes through a series of things. We have that order (which is a
credit to the existing work) but every row is the same material, so the ordering
carries no visual meaning.

**Numbers and labels are different objects.** Numeric readouts are monospaced,
tabular, often slashed-zero, and are the brightest text on the strip. Labels are
condensed, uppercase, tracked, and dim. Units are dimmer than their values. We
have the mono/not-mono split but no weight, width or brightness rule, so a dB
value and a bus name carry the same visual weight.

**Density comes from small type on quiet ground, not from tight boxes.** A pro
console packs information by making the ground uniform and the type small and
low-contrast, then letting the few lit things be loud. We pack information by
putting a visible border around each item, which multiplies visual noise by the
item count.

## 1.3 What is already good and must survive

This is a well-built product with a real design system underneath it. A redesign
that discards the following would be a regression.

1. **The token discipline itself.** "A component never writes a raw colour";
   "themes redefine only the colour block"; "geometry is expressed through
   `--ui-scale`". These three rules are why this redesign is a token edit rather
   than a rewrite. Keep them, and enforce the first one harder — the eight
   literal `box-shadow` values are the current violations.
2. **`--ui-scale`.** One multiplier driving every geometric token, tested at 0.85
   and 1.4, is better than most shipping DAWs manage. Every number in Part 2 is
   given as a `calc(px * var(--ui-scale))`.
3. **The accessibility work.** `5a17087` ("zero axe violations across all
   screens") lifted `--text-faint` to AA on every panel background, split
   `--danger-text` out so danger text clears AA, made `.btn.primary` ink invert
   with the accent, and gave every interactive class a focus, hover, active and
   disabled state. `e2e/accessibility.spec.ts` guards it. **Every value in Part 2
   is published with its measured contrast ratio and none is lower than what it
   replaces.**
4. **The three-theme contract.** Explicit `data-theme` wins; absent attribute
   follows `prefers-color-scheme`; `prefers-contrast: more` routes to the
   contrast theme. The duplicated blocks are ugly and correctly commented as
   hand-maintained pairs. Keep the structure exactly.
5. **The radii are already right.** 2/4/7/12px is a hardware-appropriate ladder,
   and 52 of 137 radius uses are the 2px step. "Oversized rounded corners" is one
   AI tell we simply do not have. Do not touch this.
6. **`--text: #e9e6dd`.** A warm off-white at hue 45 rather than a cold #fff.
   This is the seed of the whole new palette.
7. **The strip's row model.** Explicit `grid-row` placement, one flexible row,
   `overflow: hidden` per row, and four `@container` steps in `em` so the
   thresholds track `--ui-scale`. This was hard-won (see `docs/LAYOUT-AUDIT.md`
   RC-1) and is load-bearing. The redesign changes row _gaps_ and _backgrounds_,
   never the row model.
8. **Per-domain restraint that is already correct.** Red is already reserved for
   record and clipping. The clip hairline is `color-mix`ed from the surface
   rather than being pure black. Bypassed inserts read as "present but doing
   nothing". `.strip.silent` dims rather than hides. The printed meter scale is
   drawn on the meter, not in a tooltip. Take all of it forward.
9. **The icon set.** One inline sprite, 24×24 grid, 1.8px strokes, filled glyphs
   only where a solid shape _is_ the meaning (play, record, stop). That is a real
   rule, correctly applied. Part 2 adds a second weight, it does not replace the
   set.

---

# Part 2 — Direction

## 2.0 The idea, in one sentence

**Two materials on one desk: warm graphite chrome, cold black wells — and colour
that is only ever allowed to mean one thing.**

Everything below follows from that sentence.

- _Chrome_ is warm-neutral graphite (OKLCH hue ≈ 75, chroma ≤ 0.009). It is the
  painted metal of the desk: panels, strips, toolbars, buttons, headers.
- _Wells_ are cold near-black (OKLCH hue ≈ 245, chroma ≈ 0.013). They are the cut
  openings: fader slots, meter bodies, insert rails, value fields, the timeline
  ground, plugin displays.
- The hue difference is small in absolute terms and enormous in effect: it makes
  "chrome" and "content" read as different _substances_ rather than as two steps
  on one ramp, which is the job our 2.5 L\* steps were failing to do.
- Colour is a closed vocabulary of five meanings. Track colour is a separate,
  parallel system. Chrome selection is never colour — it is light.

## 2.1 The law of accent

This table is the rule. It is short on purpose. If a proposed use of colour is not
on it, the answer is no.

| Colour            | Token family    | Means, and means _only_                                                                                        | Where it may appear                                                              |
| ----------------- | --------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Green**         | `--accent`      | Signal is present and passing: monitor on, insert engaged, send enabled, meter below −18 dB, "this is working" | Lamps, LEDs, meter low band, engaged-insert dot                                  |
| **Yellow**        | `--solo`        | **Solo**, and musical selection (loop band, selected range, selected clip outline)                             | Solo lamps, loop band, selection outlines                                        |
| **Blue**          | `--mute`        | **Mute**, and the data domain: automation lanes, automation modes, MIDI/note material                          | Mute lamps, automation lanes and curves, MIDI clip tint                          |
| **Red**           | `--danger`      | **Record and clip.** Nothing else. Ever.                                                                       | Arm lamps, record button, clip LEDs, over indicators, destructive confirmations  |
| **Violet**        | `--key`         | Sidechain key, control link, VCA membership — "this control is driven from somewhere else"                     | Key-source badges, link lines, VCA tint                                          |
| **Neutral white** | `--text`        | The live value: playhead, peak-hold line, current-value index lines                                            | Playhead, hold lines, fader index line                                           |
| **Track colour**  | `--strip-color` | _Identity._ Which channel this is.                                                                             | Clip body tint, strip name bar, track-header rail, fader fill and cap index line |

**Forbidden, without exception:**

- Chrome selection may not use colour. A selected list row, an active tab, an
  active segmented option, a hovered resize handle, a "primary" button that is not
  destructive: all express themselves as **a lighter surface plus a light top
  edge**, never as `--accent-bg`. This single rule removes about 90 of the current
  175 accent uses.
- The focus ring may not use a semantic colour. It is neutral (`--border-focus`),
  and nothing else in the product may use that value.
- No hue may appear as coloured _text_ on chrome in the light theme unless it is
  the darkened `-hi` variant. Saturated hues in the light theme appear as **lamp
  fills with dark ink**, which is both more legible and more like hardware.
- Two hues may never be adjacent as the only difference between two states. Solo
  and mute are separated by hue, by lamp position, and by glyph.

### Mapping the current accent uses

| Currently                                         | Becomes                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `.th-mini.s-on` (solo) → `--accent`               | `--solo` lamp                                                                            |
| `.th-mini.m-on` (mute) → `--warm`                 | `--mute` lamp                                                                            |
| `.th-mini.r-on` (arm) → `--danger`                | unchanged                                                                                |
| `.th-mini.on` (generic engaged) → `--accent`      | `--accent` lamp — this one is correct                                                    |
| `.btn.on`, `.icon-btn.on`, `.seg button.on`       | `--bg-active` + `inset 0 1px 0 var(--edge-hi)` + `--text`                                |
| `.list-item.on`, `.browser-tabs button.on`        | `--bg-active` + 2px left rail in `--strip-color` where the row has one, else `--edge-hi` |
| `.btn.primary`                                    | `--accent` fill, `--lamp-ink` label — unchanged in kind, new values                      |
| `:focus-visible` → `--border-focus` (teal)        | `--border-focus` (neutral)                                                               |
| `.resize-handle:hover` → `--accent-dim`           | `--edge-hi`                                                                              |
| `.strip.fx` tint → `--accent` 6%                  | `--key` 8%                                                                               |
| `.cue-bar.live` → `--accent-bg`                   | `--key` — a cue mix _is_ "you are monitoring something else"                             |
| `.meter-mid` → `--accent`                         | `--meter-ok` (see §2.6)                                                                  |
| `.fader-fill`, `.fader-thumb::after` → `--accent` | `--strip-color`                                                                          |
| `.eq-handle` border → `--accent`                  | band-domain colour (see §2.8)                                                            |
| `.mixer-add`, `.co-add` hover → `--accent`        | `--edge-hi` + `--text`                                                                   |

## 2.2 The token block

Paste over the colour blocks in `src/styles/tokens.css`. **Every existing token
name is preserved**, so all 8,372 lines of downstream CSS keep compiling; new
tokens are added below the ones they extend. The geometry, type, motion, spacing
and z-layer blocks at the top of the file are unchanged except where §2.4 and
§2.5 say otherwise.

The two hand-maintained mirrors already in the file — `@media
(prefers-color-scheme: light) :root:not([data-theme])` and `@media
(prefers-contrast: more) :root:not([data-theme])` — must be updated with the same
values as their `[data-theme]` twins, exactly as the file's comments instruct.

```css
/* ====================================================================== */
/* DARK — the product's identity.                                          */
/* Chrome is warm-neutral graphite (OKLCH h≈75, C≤0.009).                   */
/* Wells are cold near-black (OKLCH h≈245, C≈0.013).                        */
/* The hue split is what makes chrome and content read as two materials.    */
/* ====================================================================== */
:root,
:root[data-theme='dark'] {
  color-scheme: dark;

  /* -- wells: cold. Anything cut INTO the desk. ------------------------- */
  --bg-deep: #05090e; /* L* 2.3  — timeline ground, deepest well      */
  --bg-input: #0a1015; /* L* 4.4  — editable value fields              */
  --bg-well: #0f1419; /* L* 6.1  — NEW: fader slots, meter bodies,
                                        insert rails, plugin displays      */

  /* -- chrome: warm graphite. Anything that is the desk itself. --------- */
  --bg-app: #191715; /* L* 7.9  — frame behind every panel           */
  --bg-panel: #22201e; /* L* 12.4 — panel ground                       */
  --bg-panel-2: #2b2926; /* L* 16.7 — strip body, secondary chrome       */
  --bg-float: #32302d; /* L* 20.0 — menus, dialogs, floating windows   */
  --bg-raised: #383632; /* L* 22.7 — button caps, master strip          */
  --bg-hover: #433f3b; /* L* 26.9                                      */
  --bg-active: #4d4945; /* L* 31.3 — pressed, and CHROME SELECTION      */
  --bg-scrim: rgba(9, 8, 7, 0.72);

  /* -- edges. A seam is a PAIR of lines, never one. --------------------- */
  --edge-lo: #12100e; /* L* 4.8  — NEW: the dark half of every seam   */
  --edge-hi: #52504c; /* L* 34.1 — NEW: the light half; top edge of
                                        anything raised. 2.36:1 vs edge-lo */
  --border-soft: #12100e; /* alias of --edge-lo, kept for existing CSS    */
  --border: #403d3a; /* L* 26.0 — a real, visible line               */
  --border-strong: #615e59; /* L* 40.0                                      */
  --border-focus: #edeae6; /* NEUTRAL. Reserved. Nothing else uses it.     */

  /* -- text ------------------------------------------------------------- */
  --text: #edeae6; /* L* 92.8                                      */
  --text-dim: #c2c1bc; /* L* 78.0                                      */
  --text-faint: #9d9b97; /* L* 64.0                                      */
  --text-inverse: #17150f;
  --lamp-ink: #17150f; /* NEW: glyph colour on a LIT lamp              */

  /* -- semantic: green = signal present ---------------------------------- */
  --accent: #67c290;
  --accent-hi: #7fdfaa;
  --accent-dim: #428f66; /* non-text only                                */
  --accent-bg: rgba(103, 194, 144, 0.14);
  --accent-line: rgba(103, 194, 144, 0.42);

  /* -- semantic: yellow = SOLO + musical selection ----------------------- */
  --solo: #efc945;
  --solo-hi: #ffe182;
  --solo-bg: rgba(239, 201, 69, 0.16);
  --solo-line: rgba(239, 201, 69, 0.45);
  /* --warm* are aliases of the solo family so existing rules keep working.
     New code writes --solo. Selection (loop band, ranges) uses --warm. */
  --warm: #efc945;
  --warm-hi: #ffe182;
  --warm-bg: rgba(239, 201, 69, 0.16);
  --warm-line: rgba(239, 201, 69, 0.45);

  /* -- semantic: blue = MUTE + the data domain --------------------------- */
  --mute: #63a0dc;
  --mute-hi: #7abafc;
  --mute-bg: rgba(99, 160, 220, 0.16);
  --mute-line: rgba(99, 160, 220, 0.45);
  --info: #63a0dc; /* the data domain and mute are one family       */
  --info-bg: rgba(99, 160, 220, 0.16);

  /* -- semantic: red = RECORD + CLIP. Nothing else. ---------------------- */
  --danger: #e2534a; /* fill/lamp only                               */
  --danger-text: #ff8074; /* the text-safe variant                        */
  --danger-bg: rgba(226, 83, 74, 0.16);
  --danger-line: rgba(226, 83, 74, 0.48);

  /* -- semantic: violet = keyed / linked / driven from elsewhere ---------- */
  --key: #c18dd8;
  --key-bg: rgba(193, 141, 216, 0.16);
  --key-line: rgba(193, 141, 216, 0.45);

  /* -- meters. Zones are dB boundaries, not gradient percentages. --------- */
  --meter-lo: #2d8c5e; /* below -18 dBFS                               */
  --meter-mid: #5ab370; /* -18 … -6                                     */
  --meter-hot: #efc945; /* -6 … -1                                      */
  --meter-clip: #f75d53; /* -1 … 0                                       */
  --meter-over: #ff766f; /* held over indicator                          */
  --meter-bg: #0f1419; /* = --bg-well                                  */
  --meter-rms: rgba(255, 255, 255, 0.24);
  --meter-seg: 3px; /* NEW: lit segment height                      */
  --meter-gap: 1px; /* NEW: unlit gap between segments              */

  /* -- timeline ---------------------------------------------------------- */
  --grid-bar: rgba(233, 234, 238, 0.15);
  --grid-beat: rgba(233, 234, 238, 0.07);
  --grid-sub: rgba(233, 234, 238, 0.03);
  --playhead: #f4f2ee;
  --loop-band: rgba(239, 201, 69, 0.16);

  /* -- material. See §2.3 for which surface takes which. ------------------ */
  --sh-1: 0 1px 0 var(--edge-hi);
  --sh-2: inset 0 1px 0 var(--edge-hi), 0 1px 2px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--edge-lo);
  --sh-3:
    0 10px 26px rgba(0, 0, 0, 0.62), 0 2px 6px rgba(0, 0, 0, 0.4), inset 0 1px 0 var(--edge-hi),
    0 0 0 1px var(--edge-lo);
  --sh-4:
    0 24px 60px rgba(0, 0, 0, 0.7), 0 4px 12px rgba(0, 0, 0, 0.45), inset 0 1px 0 var(--edge-hi),
    0 0 0 1px var(--edge-lo);
  --sh-well: inset 0 1px 2px rgba(0, 0, 0, 0.72), inset 0 0 0 1px var(--edge-lo);
  --sh-well-deep: inset 0 2px 5px rgba(0, 0, 0, 0.8), inset 0 0 0 1px var(--edge-lo);
  --sh-inset: inset 0 1px 0 var(--edge-hi);
  --sh-pressed: inset 0 1px 2px rgba(0, 0, 0, 0.6);
  --sh-focus: 0 0 0 2px var(--bg-app), 0 0 0 4px var(--border-focus);

  /* -- cap gradient stops (raised controls). The 46/47% pair is a HARD
        edge — the machined waist. Never soften it. ---------------------- */
  --cap-hi: #56534e;
  --cap-mid: #454340;
  --cap-lo: #33312e;
  --cap-base: #26241f;
  --grad-cap: linear-gradient(
    180deg,
    var(--cap-hi) 0%,
    var(--cap-mid) 46%,
    var(--cap-lo) 47%,
    var(--cap-base) 100%
  );
}

/* ====================================================================== */
/* LIGHT — a bright room, not a white page. Chrome is a mid-light warm      */
/* grey; wells stay materially darker so figure/ground survives the theme.  */
/* Mirror into @media (prefers-color-scheme: light) :root:not([data-theme]).*/
/* ====================================================================== */
:root[data-theme='light'] {
  color-scheme: light;

  --bg-deep: #a1a7ac; /* L* 68.2 */
  --bg-input: #f8f6f4; /* L* 97.0 */
  --bg-well: #b1b7bb; /* L* 74.1 */

  --bg-app: #c3c0bd; /* L* 77.9 */
  --bg-panel: #dedcda; /* L* 87.9 */
  --bg-panel-2: #d4d2ce; /* L* 84.2 */
  --bg-float: #f9f8f6; /* L* 97.6 */
  --bg-raised: #efeeeb; /* L* 94.1 */
  --bg-hover: #e7e5e1; /* L* 91.0 */
  --bg-active: #c9c6c2; /* L* 80.0 */
  --bg-scrim: rgba(39, 38, 33, 0.46);

  --edge-lo: #a4a09b;
  --edge-hi: #fafaf8;
  --border-soft: #b8b5b2;
  --border: #a4a09b;
  --border-strong: #7b7671;
  --border-focus: #272621;

  --text: #272621; /* L* 15.1 */
  --text-dim: #4f4e49; /* L* 33.1 */
  --text-faint: #5b5955; /* L* 38.0 */
  --text-inverse: #f9f8f6;
  --lamp-ink: #17150f;

  --accent: #00683f;
  --accent-hi: #005130;
  --accent-dim: #45a271; /* lamp fill, non-text */
  --accent-bg: rgba(0, 104, 63, 0.13);
  --accent-line: rgba(0, 104, 63, 0.42);

  --solo: #735c00; /* solo as TEXT */
  --solo-hi: #5f4b00;
  --solo-lamp: #efc945; /* solo as LIT LAMP, with --lamp-ink glyph */
  --solo-bg: rgba(239, 201, 69, 0.3);
  --solo-line: rgba(115, 92, 0, 0.45);
  --warm: #735c00;
  --warm-hi: #5f4b00;
  --warm-bg: rgba(239, 201, 69, 0.3);
  --warm-line: rgba(115, 92, 0, 0.45);

  --mute: #0e60a4;
  --mute-hi: #004f8c;
  --mute-lamp: #4e9be5;
  --mute-bg: rgba(14, 96, 164, 0.13);
  --mute-line: rgba(14, 96, 164, 0.42);
  --info: #0e60a4;
  --info-bg: rgba(14, 96, 164, 0.13);

  --danger: #b92f2b;
  --danger-text: #a92925;
  --danger-lamp: #ea5249;
  --danger-bg: rgba(185, 47, 43, 0.12);
  --danger-line: rgba(185, 47, 43, 0.45);

  --key: #804599;
  --key-bg: rgba(128, 69, 153, 0.13);
  --key-line: rgba(128, 69, 153, 0.42);

  --meter-lo: #008350;
  --meter-mid: #389854;
  --meter-hot: #a28300;
  --meter-clip: #c3302c;
  --meter-over: #d43538;
  --meter-bg: #b1b7bb;
  --meter-rms: rgba(0, 0, 0, 0.24);
  --meter-seg: 3px;
  --meter-gap: 1px;

  --grid-bar: rgba(21, 20, 17, 0.2);
  --grid-beat: rgba(21, 20, 17, 0.1);
  --grid-sub: rgba(21, 20, 17, 0.045);
  --playhead: #17150f;
  --loop-band: rgba(239, 201, 69, 0.34);

  --sh-1: 0 1px 0 var(--edge-hi);
  --sh-2: inset 0 1px 0 var(--edge-hi), 0 1px 2px rgba(39, 38, 33, 0.2), 0 0 0 1px var(--edge-lo);
  --sh-3:
    0 10px 26px rgba(39, 38, 33, 0.22), 0 2px 6px rgba(39, 38, 33, 0.14),
    inset 0 1px 0 var(--edge-hi), 0 0 0 1px var(--edge-lo);
  --sh-4:
    0 24px 60px rgba(39, 38, 33, 0.28), 0 4px 12px rgba(39, 38, 33, 0.18),
    inset 0 1px 0 var(--edge-hi), 0 0 0 1px var(--edge-lo);
  --sh-well: inset 0 1px 2px rgba(39, 38, 33, 0.35), inset 0 0 0 1px var(--edge-lo);
  --sh-well-deep: inset 0 2px 5px rgba(39, 38, 33, 0.42), inset 0 0 0 1px var(--edge-lo);
  --sh-inset: inset 0 1px 0 var(--edge-hi);
  --sh-pressed: inset 0 1px 2px rgba(39, 38, 33, 0.3);
  --sh-focus: 0 0 0 2px var(--bg-panel), 0 0 0 4px var(--border-focus);

  --cap-hi: #fafaf8;
  --cap-mid: #eceae7;
  --cap-lo: #ddd9d5;
  --cap-base: #cbc7c2;
  --grad-cap: linear-gradient(
    180deg,
    var(--cap-hi) 0%,
    var(--cap-mid) 46%,
    var(--cap-lo) 47%,
    var(--cap-base) 100%
  );
}

/* ====================================================================== */
/* CONTRAST — low vision and bright stages. Material is expressed with      */
/* LINES, not shadows: a shadow at AAA contrast is a black rectangle.       */
/* Mirror into @media (prefers-contrast: more) :root:not([data-theme]).     */
/* ====================================================================== */
:root[data-theme='contrast'] {
  color-scheme: dark;

  --bg-deep: #000000;
  --bg-input: #000000;
  --bg-well: #000000;
  --bg-app: #000000;
  --bg-panel: #0a0a0b;
  --bg-panel-2: #121213;
  --bg-float: #232120;
  --bg-raised: #1b1b1d;
  --bg-hover: #2c2c2f;
  --bg-active: #3b3b3f;
  --bg-scrim: rgba(0, 0, 0, 0.86);

  --edge-lo: #000000;
  --edge-hi: #6a6a70;
  --border-soft: #4a4a4e;
  --border: #7a7a80;
  --border-strong: #b0b0b6;
  --border-focus: #ffffff; /* 21:1 on black — better than the amber it
                                replaces, and no longer near --solo */

  --text: #ffffff;
  --text-dim: #e6e6e8;
  --text-faint: #cfcfd3;
  --text-inverse: #000000;
  --lamp-ink: #000000;

  --accent: #6eeeab;
  --accent-hi: #9fffc8;
  --accent-dim: #46b37c;
  --accent-bg: rgba(110, 238, 171, 0.22);
  --accent-line: rgba(110, 238, 171, 0.65);

  --solo: #ffe082;
  --solo-hi: #fff4d0;
  --solo-bg: rgba(255, 224, 130, 0.24);
  --solo-line: rgba(255, 224, 130, 0.65);
  --warm: #ffe082;
  --warm-hi: #fff4d0;
  --warm-bg: rgba(255, 224, 130, 0.24);
  --warm-line: rgba(255, 224, 130, 0.65);

  --mute: #8ec6ff;
  --mute-hi: #b8dbff;
  --mute-bg: rgba(142, 198, 255, 0.24);
  --mute-line: rgba(142, 198, 255, 0.65);
  --info: #8ec6ff;
  --info-bg: rgba(142, 198, 255, 0.24);

  --danger: #ff8a7e;
  --danger-text: #ffaca1;
  --danger-bg: rgba(255, 138, 126, 0.24);
  --danger-line: rgba(255, 138, 126, 0.65);

  --key: #e5acff;
  --key-bg: rgba(229, 172, 255, 0.24);
  --key-line: rgba(229, 172, 255, 0.65);

  --meter-lo: #4dc689;
  --meter-mid: #7de797;
  --meter-hot: #ffe082;
  --meter-clip: #ff9287;
  --meter-over: #ffaba4;
  --meter-bg: #000000;
  --meter-rms: rgba(255, 255, 255, 0.45);
  --meter-seg: 3px;
  --meter-gap: 1px;

  --grid-bar: rgba(255, 255, 255, 0.38);
  --grid-beat: rgba(255, 255, 255, 0.18);
  --grid-sub: rgba(255, 255, 255, 0.09);
  --playhead: #ffffff;
  --loop-band: rgba(255, 224, 130, 0.26);

  --sh-1: 0 0 0 1px var(--border-soft);
  --sh-2: 0 0 0 1px var(--border);
  --sh-3: 0 0 0 2px var(--border-strong), 0 10px 28px rgba(0, 0, 0, 0.92);
  --sh-4: 0 0 0 2px var(--border-strong), 0 20px 52px rgba(0, 0, 0, 0.96);
  --sh-well: inset 0 0 0 2px var(--border-soft);
  --sh-well-deep: inset 0 0 0 2px var(--border);
  --sh-inset: inset 0 1px 0 var(--edge-hi);
  --sh-pressed: inset 0 0 0 2px var(--border-strong);
  --sh-focus: 0 0 0 2px #000000, 0 0 0 4px var(--border-focus);

  --cap-hi: #3b3b3f;
  --cap-mid: #2c2c2f;
  --cap-lo: #1b1b1d;
  --cap-base: #121213;
  --grad-cap: linear-gradient(
    180deg,
    var(--cap-hi) 0%,
    var(--cap-mid) 46%,
    var(--cap-lo) 47%,
    var(--cap-base) 100%
  );
}
```

### Track colours

`TRACK_COLORS` in `src/model/types.ts` is currently eight ad-hoc hexes, four of
which are the semantic tokens themselves (`#37b89a` is `--accent`; `#d9a13c` is
`--warm`; `#4a90c4` is `--info`) — so a track's identity colour can be
indistinguishable from a state colour. Replace with eight hues at **identical
OKLCH lightness and chroma**, so no track shouts louder than another:

```ts
/* dark + system: L* 62, all eight at 4.86–4.91:1 on --bg-panel-2 */
export const TRACK_COLORS = [
  '#d87b7c',
  '#c98844',
  '#999b3e',
  '#50a772',
  '#00a6ad',
  '#529cd7',
  '#988bda',
  '#c67eb7',
];
```

The light and contrast themes need their own ramp at the same hues. Expose them
as CSS custom properties (`--track-1` … `--track-8`) so the theme block owns the
values and the model stores an _index_, not a hex:

```css
/* light  (L* 52) */  #bb6163 #ad6e27 #808020 #338b59 #008a8f #3782bb #7e72be #aa649c
/* contrast (L* 74) */ #ff9a9a #f1a657 #babb50 #65ca8c #00cad2 #6bbcff #b8abff #ef9bdc
```

Migration: keep reading a stored hex, but map any legacy hex to its nearest index
on load. Track colour appears at full strength only on **rails and edges** (2–3px);
clip and strip bodies use it at 18–24% mixed into the surface, which is what keeps
a coloured arrangement readable.

## 2.3 Contrast ledger

Measured, not estimated. No pair below is worse than the value it replaces.

**Dark**

| Pair                                       | Old   | New                  |
| ------------------------------------------ | ----- | -------------------- |
| `--text` on `--bg-panel`                   | 14.53 | **13.54** ✅ AAA     |
| `--text` on `--bg-panel-2`                 | 13.85 | **12.10** ✅ AAA     |
| `--text-dim` on `--bg-panel`               | 7.10  | **9.01** ✅ AAA      |
| `--text-dim` on `--bg-panel-2`             | 6.77  | **8.04** ✅ AAA      |
| `--text-faint` on `--bg-panel`             | 5.91  | **5.85** ✅ AA       |
| `--text-faint` on `--bg-panel-2`           | 5.64  | **5.23** ✅ AA       |
| `--text-faint` on `--bg-raised`            | 5.10  | **4.35** ⚠️ see note |
| `--text-faint` on `--bg-well`              | —     | **6.67** ✅ AA       |
| `--accent` on `--bg-panel-2`               | 6.98  | **6.70** ✅ AA       |
| `--solo` on `--bg-panel-2`                 | 7.50  | **9.06** ✅ AAA      |
| `--mute` on `--bg-panel-2`                 | —     | **5.24** ✅ AA       |
| `--danger-text` on `--bg-panel-2`          | 6.34  | **5.93** ✅ AA       |
| `--key` on `--bg-panel-2`                  | —     | **5.57** ✅ AA       |
| `--lamp-ink` on lit `--solo`               | —     | **12.20** ✅ AAA     |
| `--lamp-ink` on lit `--accent`             | —     | **9.02** ✅ AAA      |
| `--lamp-ink` on lit `--mute`               | —     | **7.07** ✅ AAA      |
| `--edge-hi` against `--edge-lo` (the seam) | —     | **2.36** (non-text)  |

> **Note on `--text-faint` on `--bg-raised` (4.35).** `--bg-raised` is now a
> _control cap_ surface, not a text surface. The rule that goes with this palette:
> **text on `--bg-raised` is `--text-dim` (6.69) or `--text` (10.05), never
> `--text-faint`.** Add this to the axe run as an explicit assertion. If any
> existing rule puts faint text on a raised surface, it moves to `--text-dim`.

**Light**

| Pair                             | Old                               | New              |
| -------------------------------- | --------------------------------- | ---------------- |
| `--text` on `--bg-panel`         | 15.41                             | **11.08** ✅ AAA |
| `--text-dim` on `--bg-panel`     | 6.59                              | **6.10** ✅ AA   |
| `--text-dim` on `--bg-panel-2`   | 6.24                              | **5.52** ✅ AA   |
| `--text-faint` on `--bg-panel`   | 5.24                              | **5.11** ✅ AA   |
| `--text-faint` on `--bg-panel-2` | 4.96                              | **4.63** ✅ AA   |
| `--accent` on `--bg-panel`       | **4.36 ❌ (existing AA failure)** | **5.03** ✅ AA   |
| `--solo` on `--bg-panel`         | —                                 | **4.71** ✅ AA   |
| `--mute` on `--bg-panel`         | —                                 | **4.76** ✅ AA   |
| `--danger-text` on `--bg-panel`  | —                                 | **5.07** ✅ AA   |
| `--lamp-ink` on `--solo-lamp`    | —                                 | **11.39** ✅ AAA |
| `--border-focus` on `--bg-panel` | —                                 | **11.08** ✅     |

The light theme's current `--accent` (`#17806a`) sits at **4.36:1** on
`--bg-panel` — a real, shipping AA failure that the new value fixes.

**Contrast**

| Pair                                         | New              |
| -------------------------------------------- | ---------------- |
| `--text` on `--bg-panel-2`                   | **18.72** ✅ AAA |
| `--text-dim` on `--bg-panel-2`               | **15.02** ✅ AAA |
| `--text-faint` on `--bg-panel-2`             | **12.05** ✅ AAA |
| `--text-faint` on `--bg-raised`              | **11.07** ✅ AAA |
| `--accent` on `--bg-panel-2`                 | **12.91** ✅ AAA |
| `--solo` on `--bg-panel-2`                   | **14.48** ✅ AAA |
| `--mute` on `--bg-panel-2`                   | **10.41** ✅ AAA |
| `--danger-text` on `--bg-panel-2`            | **10.40** ✅ AAA |
| `--border-focus` (#fff) on `--bg-app` (#000) | **21.00** ✅     |

## 2.4 Material and depth language

Four states. Every element in the product is exactly one of them, and the state
tells the user what they can do with it.

| State     | Meaning to the user                               | Surface                                  | Shadow token                                                    | Border                                         |
| --------- | ------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| **Flat**  | Chrome. Structure, not a control.                 | `--bg-panel` / `--bg-panel-2`            | _none_                                                          | _none_ — separated by a **seam**               |
| **Well**  | Something lives in here. Content, values, signal. | `--bg-well` / `--bg-input` / `--bg-deep` | `--sh-well` (deep variants: `--sh-well-deep`)                   | _none_ — the well's own inset ring is its edge |
| **Cap**   | You can press, grab or turn this.                 | `--grad-cap`                             | `--sh-2`                                                        | _none_ — `--edge-lo` ring is inside `--sh-2`   |
| **Float** | This is above the workstation.                    | `--bg-float`                             | `--sh-3` (menus, popovers) / `--sh-4` (dialogs, plugin windows) | _none_                                         |

### The seam replaces the border

A single 1px mid-grey line is the most generic structural device available, and
ours is invisible anyway (1.07–1.26:1). Replace it with a **two-line seam**: a
dark line and a light line, adjacent. The pair reads at 2.36:1 against each other
even though neither is high-contrast against the surface — which is exactly how a
panel joint reads on real equipment.

```css
/* horizontal seam: the element below a header, a toolbar, a section */
.seam-b {
  box-shadow:
    inset 0 -1px 0 var(--edge-lo),
    0 1px 0 var(--edge-hi);
}
.seam-t {
  box-shadow:
    inset 0 1px 0 var(--edge-hi),
    0 -1px 0 var(--edge-lo);
}
/* vertical seam: between panes, between console sections */
.seam-r {
  box-shadow:
    inset -1px 0 0 var(--edge-lo),
    1px 0 0 var(--edge-hi);
}
```

Apply to: `.topbar`, `.transport`, `.statusbar`, `.toolbar-h` bars, panel
headers, `.channel-overview`, `.cue-bar`, `.mixer-sep`, the resize handles, and
every `border-bottom: 1px solid var(--border-soft)` currently used as a divider.
`--border` survives only where a line genuinely _outlines_ an object (a text
input, a select, a card). That is a reduction from 130+ borders to roughly 25.

### Rules that make depth mean something

1. **Depth is never decorative.** If it is raised, you can press it. If it is
   inset, something lives in it. A card that is neither is flat.
2. **One light source: top.** Every highlight is on the top edge, every shadow
   falls down. No element ever carries a highlight on its bottom edge except a
   well, which carries it _outside_ the bottom (the lip).
3. **Nesting is bounded at two.** Flat → well → cap. A cap inside a well inside a
   well is a bug.
4. **No element gets both `--sh-2` and a `border`.** The ring is inside the token.
5. **The literals go.** Delete the eight one-off `box-shadow` values in
   `mixer.css`, `arrangement.css` and `recording.css`; they become `--sh-2`,
   `--sh-well` or the lamp glow in §2.5.
6. **Glow is legal exactly once:** on a lit lamp, at `0 0 7px -1px`, in the lamp's
   own colour. Nowhere else. Not on focus, not on hover, not on selection.
7. **Contrast theme substitutes lines for shadows** — already true of the current
   tokens and preserved above.

### What takes what

| Element                                                            | State                                                                        |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `.app`, `.workspace`, `.pane`                                      | flat                                                                         |
| `.topbar`, `.transport`, `.statusbar`, toolbars, panel headers     | flat + seam                                                                  |
| `.strip` body                                                      | flat                                                                         |
| `.strip.master`, `.strip.bus`                                      | flat, one step up (`--bg-raised` ground) + `--sh-1` left/right               |
| `.fader-track`, `.meter`, `.smeter-ch`, `.fx-gr-track`             | well (`--sh-well-deep`)                                                      |
| `.strip-inserts` rail, `.strip-sends` rail, `.fx-visual`           | well (`--sh-well`)                                                           |
| `.arr-lanes` timeline ground, `.pianoroll` grid, `.fx-curve`       | well (`--sh-well`), `--bg-deep`                                              |
| `input`, `select`, `textarea`, `.strip-route`, `.in-trim`          | well (`--sh-well`), `--bg-input`                                             |
| `.fader-thumb`, `.knob` cap, `.btn`, `.t-btn`, `.icon-btn`, `.seg` | cap (`--grad-cap` + `--sh-2`)                                                |
| `.ins-slot`, `.snd-row` (a module seated in the rail)              | cap, one step down (`--bg-panel-2` ground, `--sh-1`)                         |
| `.th-mini`, `.lamp` unlit                                          | well; lit → lamp fill (§2.5)                                                 |
| `.clip`                                                            | cap at 1px — `inset 0 1px 0 rgb(255 255 255/.10)`, `0 1px 2px rgb(0 0 0/.4)` |
| dropdowns, menus, tooltips, `.chip` popovers                       | float (`--sh-3`)                                                             |
| dialogs, sheets, floating plugin windows                           | float (`--sh-4`)                                                             |

## 2.5 Type

### Families

Three widths of one superfamily, all on Google Fonts, none of them Inter or
Roboto. IBM Plex was drawn for engineering documentation; it has a genuine
mechanical voice at small sizes, real tabular figures, and a condensed width —
which is what a 96px channel strip actually needs.

```html
<!-- index.html <head>, before the module script -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
/>
```

```css
--font:
  'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI Variable Text', 'Segoe UI', Roboto,
  'Noto Sans', sans-serif;
--font-cond:
  'IBM Plex Sans Condensed', 'IBM Plex Sans', system-ui, 'Segoe UI Variable Small', 'Segoe UI',
  Roboto, sans-serif; /* NEW */
--font-mono:
  'IBM Plex Mono', ui-monospace, 'SF Mono', 'Cascadia Mono', 'Roboto Mono', Menlo, Consolas,
  monospace;
--font-num: var(--font-mono);
```

**Six faces, ~150 KB, and the app must not need any of them.** The existing
comment in `tokens.css` — "a DAW must paint its chrome on the first frame and
work with no network at all" — is correct and is not being overruled. Honour it:

- `display=swap` so the system stack paints frame one and the webfont swaps in.
- The system fallbacks above are metric-near; if measured reflow at swap exceeds
  one line-height anywhere, add a `@font-face` with `size-adjust` on the local
  fallback rather than blocking paint.
- Add the six `.woff2` URLs to the service worker precache in
  `src/pwa/registerPwa.ts` so a second launch is genuinely offline-complete.
- CSP: `font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`. No other host.

**Delete `'cv08' 1` from `base.css`.** It is an Inter feature and no loaded font
answers it. Replace with the slashed zero, which IBM Plex Mono does have and
which is a genuine instrument-panel signal:

```css
body {
  font-feature-settings: 'tnum' 1;
}
.t-num,
.mono,
[class*='-val'],
[class*='-readout'] {
  font-feature-settings:
    'tnum' 1,
    'zero' 1;
}
```

### The scale

Unchanged — the eight steps are tested at 0.85 and 1.4 and they work. What
changes is that each step now has an assigned family and weight.

| Token      | px @1.0 | Family        | Weight | Case / tracking        | Used for                                                           |
| ---------- | ------- | ------------- | ------ | ---------------------- | ------------------------------------------------------------------ |
| `--fs-2xs` | 10.5    | `--font-cond` | 600    | UPPER, `--ls-caps`     | Micro-labels: panel titles, strip headers, knob labels, slot names |
| `--fs-2xs` | 10.5    | `--font-num`  | 500    | —                      | Micro numerics: meter scale ticks, send values, pan value          |
| `--fs-xs`  | 11      | `--font-cond` | 500    | sentence, `--ls-wide`  | Dense secondary labels: send names, routing, chips                 |
| `--fs-sm`  | 11.5    | `--font`      | 400    | sentence               | Control labels, button text, list subtitles                        |
| `--fs-sm`  | 11.5    | `--font-num`  | 500    | —                      | **The strip dB readout.** The most-read number on the desk         |
| `--fs-md`  | 12.5    | `--font`      | 400    | sentence               | Body, inspector values, list titles at 600                         |
| `--fs-lg`  | 14      | `--font`      | 600    | sentence, `--ls-tight` | Sub-headings, channel name in the overview                         |
| `--fs-lg`  | 14      | `--font-num`  | 400    | —                      | Transport time readout, tempo                                      |
| `--fs-xl`  | 17      | `--font`      | 600    | `--ls-tight`           | Panel/dialog headings                                              |
| `--fs-2xl` | 22      | `--font`      | 600    | `--ls-tight`           | Page titles                                                        |
| `--fs-3xl` | 30      | `--font-num`  | 400    | `--ls-tight`           | The big transport time display                                     |

### The three rules

1. **Every number is `--font-num`, tabular, slashed-zero, and at least
   `--fw-medium`.** No exceptions — including numbers inside labels ("+3.5",
   "48 kHz", "3 sends"). A number in the UI face is a bug.
2. **A value and its unit never share a weight or a colour.** Value: `--text`, 500. Unit/suffix: `--text-faint`, 400, and one step smaller where the step
   exists. `-6.0` is loud; `dB` is quiet.
3. **Labels are condensed uppercase; content is not.** `--font-cond` 600 UPPER at
   `--fs-2xs` with `--ls-caps` is _the_ label object, defined once (the
   consolidated `.t-label` rule in `base.css` already does this — keep it, change
   its family and add `--font-cond`). Anything that is user-authored text — track
   names, clip names, preset names — is `--font`, sentence case, never uppercased
   by CSS.

Only three weights ship (400, 500, 600) plus condensed 500/600. **700 is
retired**: the 14 `font-weight: 700` declarations become 600. At 10–12px, 700 in a
condensed face is heavier than 700 in `system-ui` and the strip headers currently
out-shout the section titles above them.

### Icons

Keep the 24×24, 1.8px, round-cap sprite. Add **one** second weight: `weight={1.4}`
for icons that are _decoration inside a label_ (list-row type glyphs, empty-state
icons, the strip's type icon at 11px), and keep 1.8 for icons that are _the
control_ (transport, tools, toolbar buttons). Two weights is a hierarchy; one is
the tell. `Icon.tsx` already accepts `weight` — this is a call-site change only.

## 2.6 Controls

All sizes are `calc(<px> * var(--ui-scale))`. Values in brackets are the coarse-
pointer variant, which the existing `@media (pointer: coarse)` blocks already
switch on.

### Fader

```
lane width       34px  [44px]          (--fader-w, replaces the hardcoded 30px)
scale column     12px, left of the lane, inside the lane box
track width      7px   [9px]
cap              30 × 15px  [38 × 20px], radius 2px
```

- **Scale.** Ticks at 0, −5, −10, −20, −30, −40, −60 dB, positioned with the same
  `faderPosToGain` inverse the thumb uses. Labels `--font-num` 500 at `--fs-2xs`,
  `--text-faint`. The **0 tick is `--text-dim` and 2px longer** — that is the
  unity mark and it must be findable without reading.
- **Track.** `background: var(--bg-well)`, radius 2px,
  `box-shadow: var(--sh-well-deep), 0 1px 0 var(--edge-hi)` — inset well with a
  light lip below it. This is the single change that makes the fader stop looking
  like a `<div>`.
- **Unity detent.** A 1px line across the full lane at 83.2% travel (the existing,
  correct figure) in `--text-faint` at 55%, plus a 2px nub on each side of the
  track. Keep the existing maths comment; it is right.
- **Fill.** 3px wide, centred in the 7px track, below the cap only.
  `background: color-mix(in srgb, var(--strip-color) 70%, var(--bg-well))`.
  **Flat, no gradient.** The console then reads as a colour-coded field of levels
  — which is a genuine at-a-glance benefit and the reason to spend track colour
  here.
- **Cap.** `background: var(--grad-cap)` — the 46%/47% hard stop is the machined
  waist and is 80% of why this reads as metal.
  `box-shadow: var(--sh-2), 0 2px 4px rgb(0 0 0 / .55)`.
  - **Grip:** three 1px lines at 4px pitch across the upper half,
    `rgb(0 0 0 / .28)`, each with `0 1px 0 rgb(255 255 255 / .06)` beneath.
    Implement as one `repeating-linear-gradient` on a `::before`.
  - **Index line:** 1px, full cap width, sitting _on_ the waist, in
    `color-mix(in srgb, var(--strip-color) 90%, white)`. You read the value from
    this line, not from the cap's edge.
- **Dragging.** Shadow to `0 3px 7px rgb(0 0 0 / .6)`; `--cap-hi` lightens one
  step. **No scale transform, no colour change, no glow.**
- **Focus.** Keep the existing inset outline (`outline: 2px solid
var(--border-focus); outline-offset: -2px`) — the strip clips its rows, so this
  exception is correct and must not be "fixed".

### Knob

Sizes: **26px** (strip pan), **34px** (plugin secondary), **44px** (plugin
primary). All three are SVG, as now.

- **Value arc, outside the cap.** r = size/2 − 1.5, `stroke-width: 3`,
  264° sweep from −132°. Track `--bg-well`; value in the parameter's **domain
  colour** (§2.8). `stroke-linecap: butt` — round caps on a value arc are a web
  tell; a real indicator ring has square ends.
- **Detent tick.** 1px × 4px at the parameter's default angle, `--text-faint`.
  For a pan knob that is 12 o'clock; for a gain knob it is unity.
- **Cap.** r = size/2 − 7. Filled with a vertical `linearGradient` from `--cap-hi`
  to `--cap-base`; `stroke: var(--edge-lo)`, 1px. Add a 1px highlight arc across
  the top third at `rgb(255 255 255 / .10)`.
- **Pointer — a machined slot, not a painted line.** Two overlapping lines from
  40% to 88% of the cap radius: first `rgb(0 0 0 / .6)` at 2.5px, then the same
  line offset 1px toward the light at `var(--edge-hi)` 1px. It reads as a groove
  cut into the cap. The current bright `--accent` line is the "web widget" tell in
  one stroke.
- **The value is never printed inside the cap.** Below the knob:
  value (`--font-num` 500, `--fs-2xs`, `--text`), then label (`--font-cond` 600
  UPPER, `--fs-2xs`, `--text-faint`).
- Keep `role="slider"` with `aria-valuetext`, `ns-resize`, double-click-to-default
  and the arrow-key steps exactly as they are.

### Buttons — two families, and only two

**1. Lamp** (`.lamp`, absorbing `.th-mini`, `.in-flag`, `.fx-chip`, insert bypass)
— a _state you switch_.

```css
.lamp {
  /* unlit */
  width: 22px;
  height: 22px; /* auto-width, min 26px, when lettered */
  border-radius: var(--radius-xs);
  background: var(--bg-well);
  box-shadow:
    var(--sh-well),
    0 1px 0 var(--edge-hi);
  color: var(--text-faint);
  font: 600 var(--fs-2xs)/1 var(--font-cond);
  text-transform: uppercase;
}
.lamp:hover:not(:disabled) {
  color: var(--text-dim);
  background: var(--bg-input);
}
.lamp[aria-pressed='true'] {
  /* lit */
  background: var(--lamp); /* set per instance: --solo/--mute/… */
  color: var(--lamp-ink);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.35),
    inset 0 -1px 2px rgb(0 0 0 / 0.35),
    0 0 0 1px color-mix(in srgb, var(--lamp) 55%, transparent),
    0 0 7px -1px color-mix(in srgb, var(--lamp) 60%, transparent);
}
```

Assignments: `M` → `--mute`. `S` → `--solo`. `●` (arm) → `--danger`.
monitor / insert-engaged / send-enabled → `--accent`. key/link → `--key`.

**2. Cap** (`.btn`, `.t-btn`, `.icon-btn`, `.seg button`) — a _command you press_.

```css
.btn {
  height: var(--control-h);
  border-radius: var(--radius);
  background: var(--grad-cap);
  box-shadow: var(--sh-2);
  border: none; /* the ring lives inside --sh-2 */
  color: var(--text);
  font: 400 var(--fs-sm)/1 var(--font);
}
.btn:hover:not(:disabled) {
  --cap-hi: <one step lighter>;
}
.btn:active:not(:disabled) {
  background: var(--bg-panel-2);
  box-shadow: var(--sh-pressed);
  transform: translateY(0.5px);
}
.btn.on {
  background: var(--bg-active);
  box-shadow:
    var(--sh-pressed),
    inset 0 1px 0 var(--edge-hi);
  color: var(--text);
} /* NOT --accent */
.btn.primary {
  background: var(--accent);
  color: var(--lamp-ink);
  box-shadow: var(--sh-2);
}
.btn.danger {
  color: var(--danger-text);
}
```

Pressing swaps the cap shadow for the well shadow. That is what a pressed button
looks like, it costs nothing, and it is currently expressed as a 0.5px translate
and a 3 L\* background change nobody can see.

`.seg` becomes a single well containing cap-less segments; the selected segment is
a cap seated in the well (`--grad-cap` + `--sh-2`). Keep the existing
`:focus-visible` compound-shadow fix — it is correct and hard-won.

**Retire the styled `input[type='range']` for audio parameters.** A round accent
dot on a hairline is the strongest "web form" signal in the product, and it is
used for sends, plugin parameters and cue levels. Replace with a **horizontal
slot control** built from the same parts as the fader: 5px inset track, a
20 × 11px cap with a waist and a 1px index line, a detent tick at default. The
native range stays only for non-audio settings (UI scale, zoom).

### Meter

- **Body:** `--bg-well`, `--sh-well-deep`, radius 2px, with `0 1px 0
var(--edge-hi)` outside the bottom.
- **Segmented, not smooth.** Mask the fill with
  `repeating-linear-gradient(to top, #000 0 var(--meter-seg), transparent
var(--meter-seg) calc(var(--meter-seg) + var(--meter-gap)))`. 3px lit / 1px dark.
  This is the single strongest hardware cue available and it costs one property.
  At `--ui-scale` 0.85 set `--meter-seg: 2px`; at 1.4 set `4px`.
- **Zones are dB boundaries, computed with the meter's own scale function — not
  fixed gradient percentages.** `−∞…−18` `--meter-lo`; `−18…−6` `--meter-mid`;
  `−6…−1` `--meter-hot`; `−1…0` `--meter-clip`. Emit the stop positions from
  `meterScalePosition()` into a CSS custom property so the printed scale and the
  colour change cannot disagree.
  **This fixes a real bug:** `.meter` positions with `normDb()` (linear in dB) and
  `.smeter` with `meterScalePosition()` (`x^1.9`), yet both draw their colour
  change at the same hardcoded 62%/84%/97% stops. The same −13 dB signal lands at
  78% on one meter and 62% on the other. Unify both on `meterScalePosition`.
- **Peak hold:** 1px full-width `--text` line. Keep the existing rAF-driven
  transform writes; do not move them into React.
- **Over:** the separate lamp above the bars is right — keep it, restyle as a
  `.lamp` with `--lamp: var(--meter-over)`.
- **Scale:** keep the printed ticks and their clamping. Set them in `--font-num`
  500 with `'zero' 1`.

### Slot (insert / send)

A **rack**: a well containing modules seated on a rail.

- **Rail:** `.strip-inserts` / `.strip-sends` become `background: var(--bg-well);
box-shadow: var(--sh-well); border-radius: var(--radius-xs); padding: 2px;`
- **Slot:** `background: var(--bg-panel-2); box-shadow: var(--sh-1);
border-radius: var(--radius-xs);` height 15px (strip) / 22px (inspector).
  - **2px left rail** in the processor's family colour (§2.8).
  - **LED** 5px round at the left: `--accent` when active, `--text-faint` at 35%
    when bypassed, `--bg-input` when empty.
  - **Name:** `--font-cond` 600 UPPER `--fs-2xs`, truncating.
  - **Bypassed:** the slot **sinks** — `box-shadow: var(--sh-pressed)`, name to
    `--text-faint`. Keep the existing strikethrough; it is unambiguous.
- **Empty slot:** the bare rail — `--bg-well` with a centred `+` in
  `--text-faint`. **Delete the dashed border.** Dashed 1px borders on empty states
  are a web-app convention, not a hardware one, and they appear four times
  (`.ins-slot.empty`, `.ins-slot.more`, `.mixer-add`, `.co-add`).

## 2.7 Density and rhythm

**Group with gaps, separate with seams.** Three gap values, used strictly:

| Gap    | Value               | Between                                                   |
| ------ | ------------------- | --------------------------------------------------------- |
| tight  | `--sp-1` (2px)      | items inside one group (slots in a rack, lamps in a trio) |
| group  | `--sp-4` (8px)      | one group and the next inside a region                    |
| region | _a seam_, not a gap | one region and the next                                   |

Applied to `.strip`, the uniform `row-gap: 4px` is replaced by explicit per-row
margins so the nine rows read as **four groups**:

```
  name                              ← identity
  ── seam ──
  input stage    (2px)              ┐
  insert rack    (2px)              │ signal path in
  send rack                         ┘
  ── 8px ──
  pan            (6px)              ┐
  fader + meter                     ┘ level
  ── 8px ──
  M S ●          (4px)              ┐
  dB readout     (2px)              │ console footer, on --bg-raised
  routing                           ┘
```

**Density contrast between chrome and content.** Chrome (toolbars, headers,
strips) is dense: 22/28/34px control ladder, `--fs-2xs`/`--fs-xs` labels, 2–4px
gaps. Content (dialogs, settings, the Start page, empty states) is open:
`--sp-5`/`--sp-6` gaps, `--fs-md` body at `--lh-body`. Right now `.settings` and
`.mixer` use nearly the same rhythm, which makes the workstation feel like a
settings screen.

## 2.8 Domain colours for processors and parameters

Five processor families, five fixed colours drawn from the track ramp. This is
what lets an insert rack be read at a glance and what gives a knob's value arc a
non-arbitrary colour.

| Family      | Processors                                     | Dark      | Light     | Contrast  |
| ----------- | ---------------------------------------------- | --------- | --------- | --------- |
| Dynamics    | compressor, limiter, gate, de-esser, multiband | `#c98844` | `#ad6e27` | `#f1a657` |
| EQ / filter | EQ, auto-filter, tone                          | `#529cd7` | `#3782bb` | `#6bbcff` |
| Time        | delay, reverb, chorus, flanger, phaser         | `#988bda` | `#7e72be` | `#b8abff` |
| Colour      | saturation, distortion, amp, cab, bitcrusher   | `#d87b7c` | `#bb6163` | `#ff9a9a` |
| Utility     | width, tuner, analyser, gain, meter            | `#7f8a93` | `#68727a` | `#a9b3bb` |

Expose as `--fx-dyn`, `--fx-eq`, `--fx-time`, `--fx-colour`, `--fx-util`. Used on:
the slot's 2px left rail, the plugin window's header rail, and a knob's value arc
inside that plugin. Nowhere else. `effectSpec()` in `src/model/effects.ts` gains a
`family` field; the CSS reads `var(--fx-<family>)`.

## 2.9 Worked example — the mixer channel strip

96px wide (112 touch), nine rows, unchanged grid model. Top to bottom:

**1. Identity bar** — 18px. Ground is `color-mix(in srgb, var(--strip-color) 22%,
var(--bg-panel-2))` with a **3px solid `--strip-color` bar along the top edge**
and `inset 0 -1px 0 var(--edge-lo)` beneath. Type icon at 11px, `weight 1.4`.
Name in `--font-cond` 600 UPPER `--fs-2xs`, `--text`, truncating. A bus or FX
channel **reverses** it — solid `--strip-color` fill, `--lamp-ink` text — so
channel types are distinguishable across a 40-channel desk without reading.
The automation dot becomes a 4px `--mute` LED (automation is the data domain).

**2. Seam.**

**3. Input stage** — 16px. A single well spanning the strip, containing: trim
value (`--font-num` 500 `--fs-2xs`, `--text` when non-zero, `--text-faint` at 0),
then `Ø` and `M` as 16px lamps with `--lamp: var(--solo)`. Trim being a number in
a well rather than a bordered button is the fix — it is a value, not a command.

**4. Insert rack** — a `--bg-well` rail, 2px padding, up to four 15px slots at 2px
pitch. Each slot: 2px family rail, 5px LED, condensed uppercase name. Empty →
bare rail with a `+`. This is the region that will change the strip's character
most: four bordered boxes become four modules seated in a rack.

**5. Send rack** — same rail, 14px rows, name left in `--font-cond` 500, value
right in `--font-num` 500. Rail colour: `--accent` at 40% (a send is signal
leaving). Currently these rows are filled `--accent-bg` with an `--accent-line`
border, which is the loudest thing on the strip for the least important
information.

**6. 8px group gap.**

**7. Pan** — 26px knob per §2.6, arc in `--fx-util`, detent at centre; value to
its right in `--font-num` 500 `--fs-2xs`.

**8. Fader + meter** — the flexible row. Left: the fader lane (34px) with its
printed scale, the track as a well, fill in `--strip-color`, cap with a waist, a
grip and a `--strip-color` index line. Right: the stereo meter — over lamp,
two segmented bars in a well, printed dB scale. This row is the visual centre of
the strip and should be the only place the eye rests.

**9. 8px group gap. Footer on `--bg-raised` with a top seam** — the console's
lower deck. `M` (`--mute`) · `S` (`--solo`) · `●` (`--danger`) as three 22px
lamps at 4px pitch. Below, the readout: dB value in `--font-num` 500 `--fs-sm`
`--text` on the left, unit `dB` in `--text-faint` 400 `--fs-2xs`; peak-hold value
right in `--text-faint`. Below that, routing as a well-styled field, `--font-cond`
500 UPPER.

**Selected strip:** `--strip-color` top bar goes to 5px and the strip ground
lifts one step to `--bg-panel-2` + `--sh-1`. **Not an accent border.**
**Silenced-by-others:** keep the existing 0.55 opacity drain — it reads
differently from a lit mute lamp, which is the point.
**Master:** `--bg-raised` ground, `--sh-1` on both vertical edges, no colour bar,
name in `--font-cond` 600 UPPER `--text-dim`.

What this achieves: seven of the nine rows currently carry a 1px border; after
this, **zero** do. Structure comes from three material zones (chrome / rack wells
/ raised footer) and one colour bar.

## 2.10 Worked example — a plugin window (compressor)

A floating window at `--sh-4`, `--bg-float`, radius `--radius-lg`.

**Header** — 30px. `--bg-panel-2` with a **3px `--fx-dyn` rail** along the top,
seam below. Left: family glyph at `weight 1.4`, then the processor name in
`--font-cond` 600 UPPER `--fs-xs` `--text`. Centre-right: preset select as a cap.
Right: bypass lamp (`--lamp: var(--accent)`, lit = engaged), then close.
The rail is how you know at a glance which of nine open windows is the compressor.

**Display** — the analysis region, and it is a **well**: `--bg-deep`,
`--sh-well-deep`, no radius on its outer corners (it is cut into the panel).
Inside: the transfer curve in `--fx-dyn` at 1.5px over a `--grid-sub` graticule,
the threshold line in `--solo` 1px dashed, the live input dot in `--text` at 60%.
Nothing here has a border; the well _is_ the frame.

**Gain reduction** — immediately right of the display, sharing its well. A 12px
segmented meter growing **downward** (keep the existing direction and its
comment). Zones `--meter-mid` → `--meter-hot` → `--meter-clip` by dB. Numeric GR
below in `--font-num` 500, label `GR` in `--font-cond` 600 UPPER `--text-faint`.

**Control deck** — `--bg-panel`, seam above. A row of 44px knobs at even pitch:
Threshold · Ratio · Attack · Release · Knee · Makeup. Each: value arc in
`--fx-dyn`, cap with a machined slot pointer, detent tick at default, value below
in `--font-num` 500, label below that in `--font-cond` 600 UPPER `--text-faint`.
Secondary controls (detector mode, key source, lookahead) sit in a second row at
34px or as segmented caps.

**Key/sidechain strip** — when a key is assigned, a 20px bar below the deck on
`--bg-panel-2` with a `--key` 2px left rail and the source name. Absent when no
key is assigned; not a greyed-out row.

**Footer** — 22px, `--bg-raised`, seam above, holding A/B, copy-to-B and the
latency figure in `--font-num` 400 `--fs-2xs` `--text-faint`.

Four material zones — panel, well, deck, footer — read in one glance, with exactly
two colours on screen (`--fx-dyn` and whatever is lit). Today the same window is
five bordered rectangles in one grey.

## 2.10a Mapping onto the device rack and plugin window that just landed

`DeviceRack.tsx` and `PluginWindow.tsx` arrived in the working tree while this
document was being written. They are the right components — the chain on the
strip in signal order, and the editor as a floating window — and §2.9 / §2.10
describe exactly these two surfaces. They also, unmodified, reproduce every tell
in Part 1, which is a useful demonstration that the problem is the token
vocabulary rather than any individual author's judgement:

| Just-landed rule                                                                     | Tell                                            | Becomes                                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.dev-slot { border: 1px solid var(--border-soft); background: var(--bg-raised) }`   | 1px border at 1.07:1 as the only structure      | Module seated in a rail: `background: var(--bg-panel-2); box-shadow: var(--sh-1)`, inside a `--bg-well` rail with `--sh-well`; 2px left rail in the device's family colour (§2.8) |
| `.dev-power { background: var(--accent) }`                                           | accent as generic "on"                          | Correct as-is — this is genuinely "signal passing". Give it the lamp treatment: 5px, `--accent` lit, `--text-faint` at 35% bypassed                                               |
| `.dev-slot.open { border-color: var(--accent) }`                                     | accent as chrome selection                      | `background: var(--bg-active); box-shadow: inset 0 1px 0 var(--edge-hi)` — open is a chrome state, not a signal state                                                             |
| `.dev-instrument { background: var(--accent-bg); border-color: var(--accent-line) }` | accent as identity                              | The instrument is the _source_: `--strip-color` at 22% with a 2px `--strip-color` left rail, `--lamp-ink`-free, name in `--font-cond` 600 UPPER                                   |
| `.dev-slot.drop-before { box-shadow: inset 0 2px 0 var(--accent) }`                  | accent as a drop target                         | `--solo` — a drop line is a _selection_, and selection is yellow                                                                                                                  |
| `.dev-add { border: 1px dashed var(--border) }`                                      | dashed empty state (the fifth in the product)   | Bare rail: `--bg-well`, `--sh-well`, centred `+` in `--text-faint`; on hover the rail lights `--edge-hi`                                                                          |
| `.dev-slot.bypassed` → `opacity: var(--opacity-disabled)` + strikethrough            | bypassed reads as _disabled_                    | Keep the strikethrough; replace the opacity with the slot **sinking**: `box-shadow: var(--sh-pressed)`, label to `--text-faint`. Bypassed is switched off, not unavailable        |
| `.dev-menu { opacity: 0 }` until hover                                               | invisible affordance                            | Keep — this one is right for a dense strip                                                                                                                                        |
| `.plugin-window { border: 1px solid var(--border-strong) }`                          | a floating window outlined rather than elevated | `box-shadow: var(--sh-4)`, no border. Header gets the 3px `--fx-<family>` rail from §2.10                                                                                         |
| `.pw-body`, `.pw-visual`, `.pw-params`, `.pw-foot`                                   | four flat regions in one grey                   | `--bg-panel` deck / `--bg-deep` well (`--sh-well-deep`) / `--bg-panel` deck / `--bg-raised` footer, separated by seams — the four material zones of §2.10                         |

`.dev-index` is already `font-variant-numeric: tabular-nums`, which is right; it
becomes `--font-num` 500 under §2.5 rule 1. The `.dev-list` scroll-hiding and the
`overscroll-behavior: contain` are correct and stay.

Nothing above changes the component's structure, its drag-and-drop, its keyboard
handling or its ARIA. It is a token and material substitution on eleven rules.

## 2.11 What NOT to do

Each of these would make the product read as _more_ AI-generated, not less.

1. **No gradients that are not a material.** The only legal gradients in the
   product are `--grad-cap` (a machined control body) and the meter fill. No
   gradient backgrounds on panels, headers, buttons, cards, dialogs or the app
   frame. Absolutely no purple-to-blue, teal-to-blue, or any two-hue gradient
   anywhere — the indigo→purple gradient is named as _the_ single loudest AI tell
   of 2026 and a teal→blue one is the same move in a different key.
2. **No glassmorphism.** No `backdrop-filter: blur()`, no translucent frosted
   panels, no floating orbs. A scrim over a modal is a flat `--bg-scrim`, which is
   what it already is.
3. **No glow except a lit lamp.** No glow on focus, hover, selection, the
   playhead, the record button or the app frame. One recipe, one place.
4. **No emoji. Anywhere.** Not in empty states, not in the browser, not in toasts,
   not in docs the app renders. The icon sprite covers every case; if it does not,
   add a glyph to the sprite.
5. **Do not enlarge the radii.** 2/4/7/12 is correct for this product. A 12px
   radius on a channel strip or a 16px radius on a button is instantly a web app.
   Resist the pull toward `--radius-lg` on small controls.
6. **Do not put a drop shadow on everything.** Shadows carry the four-state
   material language and nothing else. A flat panel has no shadow; a card that is
   not raised has no shadow; a table row never has a shadow.
7. **Do not reintroduce Inter, Roboto, Poppins, Montserrat, Space Grotesk, or a
   serif-italic accent face.** These are the named typographic fingerprints. IBM
   Plex, or the platform UI face, or nothing.
8. **Do not add a second accent hue "for visual interest".** Five meanings, five
   colours, closed set. If something needs to stand out and has no meaning on the
   list, it stands out by being _lighter_, not by being coloured.
9. **Do not use dashed borders as an empty-state or drop-target affordance.** A
   drop target is a well that lights its rail. An empty slot is a bare rail.
10. **Do not centre things that should be left-aligned.** A centred label above a
    centred value inside a centred card is the "three cards in a row" instinct
    applied to a DAW. Labels are left-aligned and values are right-aligned in every
    row that has both, so the numbers form a column you can scan.
11. **Do not soften the cap waist.** The 46%/47% hard stop is doing the work. A
    designer "cleaning up" that gradient into a smooth three-stop blend will
    silently return the fader to a web slider thumb.
12. **Do not let a component write a raw colour or a raw shadow.** The eight
    literal `box-shadow` values in the current CSS are how the material language
    got lost the first time.

## 2.12 How to land it without regressing anything

Ordered so that each step is independently shippable and independently
revertible.

| #   | Step                                                                                                                                   | Touches                                                               | Risk                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Palette swap: replace the three colour blocks + their two mirrors                                                                      | `tokens.css` only                                                     | Low — no selector changes. Re-run `e2e/accessibility.spec.ts` and the theme screenshots from `d885832` |
| 2   | Semantic re-point: solo→`--solo`, mute→`--mute`, chrome selection→`--bg-active`                                                        | ~14 rules in `base.css`, `arrangement.css`, `panels.css`, `mixer.css` | Low                                                                                                    |
| 3   | Material pass: seams replace dividers, wells replace flat inset boxes, caps replace bordered buttons; delete the eight shadow literals | `base.css` + one region at a time                                     | Medium — do the mixer first, it is the showcase                                                        |
| 4   | Type: load Plex, add `--font-cond`, kill `cv08`, apply the three rules, retire 700                                                     | `index.html`, `tokens.css`, `base.css`, then per-file                 | Medium — verify at 0.85 and 1.4 with `e2e/responsive.spec.ts`                                          |
| 5   | Controls: fader, knob, lamp, meter segmentation, rack slots                                                                            | `widgets.tsx`, `mixer.css`                                            | Medium — `e2e/console.spec.ts` and `layout.spec.ts` guard the geometry                                 |
| 6   | Track colours and domain colours                                                                                                       | `types.ts`, `effects.ts`, theme blocks                                | Low, needs a legacy-hex → index migration                                                              |

**Regression gates that must stay green at every step:** `e2e/accessibility.spec.ts`
(zero axe violations, seven surfaces), `e2e/layout.spec.ts` and
`e2e/responsive.spec.ts` (six viewports, both `--ui-scale` extremes),
`e2e/console.spec.ts`, and a manual pass of all three themes plus system-default
under both `prefers-color-scheme` values and `prefers-contrast: more`.

**Constraints this direction respects:**

- Three-theme contract — every value is given for `dark`, `light` and `contrast`,
  and the two `:root:not([data-theme])` mirrors are called out explicitly.
- CSP — Google Fonts is the only external origin, and the app is fully functional
  before and without it.
- 85%–140% UI scale — every size is a `--ui-scale` multiple; the only new
  scale-sensitive values (`--meter-seg`, `--meter-gap`) are given per scale band.
- Accessibility — every text pair is published with its measured ratio, none is
  below its predecessor, one existing AA failure (light `--accent`, 4.36:1) is
  fixed, focus rings are strengthened in all three themes, and every hover,
  active and disabled state in `base.css` is preserved by name.

---

## Sources

- [AI Slop Design: Why AI-Generated UI Looks Generic (Fix Guide 2026)](https://vibecodekit.dev/ai-slop-design)
- [AI Slop Fonts and Gradients: The Tells That Give Away AI Design — 925 Studios](https://www.925studios.co/blog/ai-slop-design-tells)
- [AI Design Slop: 16 Patterns That Out Your App as Vibe-Coded — Developers Digest](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it)
- [AI Slop: Why Everything Designed With AI Looks the Same — DesignPixil](https://designpixil.com/blog/ai-slop-design)
- [Slop — Impeccable](https://impeccable.style/slop/)
- [Beyond Skeuomorphism: The Evolution of Music Production Software User Interface Metaphors — Journal on the Art of Record Production](https://www.arpjournal.com/asarpwp/beyond-skeuomorphism-the-evolution-of-music-production-software-user-interface-metaphors-2/)
- [Cubase UI Should Look Like a Studio — Not a Minimal DAW — Steinberg Forums](https://forums.steinberg.net/t/cubase-ui-should-look-like-a-studio-not-a-minimal-daw/1034204)
- [Which version of your favourite DAW nailed the UI? — KVR Audio](https://www.kvraudio.com/forum/viewtopic.php?t=616875)
- [White Tie : Imperial — REAPER theme](https://www.houseofwhitetie.com/reaper/imperial/wt_imperial.html)
- [Bitwig Studio now has some gorgeous themes, thanks to user mods — CDM](https://cdm.link/bitwig-themes/)
- [Fender Studio Pro 8 — Sound On Sound](https://www.soundonsound.com/reviews/fender-studio-pro-8)
- [Fender Studio Pro 8 - First Look — Production Expert](https://www.production-expert.com/production-expert-1/fender-studio-pro-8-first-look)
- [Dark Mode Design Systems: Patterns, Tokens, and Hierarchy — Muzli](https://muz.li/blog/dark-mode-design-systems-a-complete-guide-to-patterns-tokens-and-hierarchy/)
- [Using Studio One's Mixing Console — Sound On Sound](https://www.soundonsound.com/techniques/using-studio-ones-mixing-console)
