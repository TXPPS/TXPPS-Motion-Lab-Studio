# ADR-0008 — Control primitives are shared, and a panel's identity is data

**Status:** accepted
**Date:** 2026-08-24
**Supersedes nothing. Constrains ADR-0007's boundary further.**

## The situation

Seven units passed twenty-five Definition-of-Done cells and a user opened them,
could not tell them apart, and could not operate them.

`render/facePanel.ts` built one widget for every role. The ternary that chose
the input type returned `'range'` on both of its branches, so a stepped wafer
selector, a latching button and a continuous dial were the same
`<input type="range">` with different labels. Separately, every `face.ts`
declared its controls with `c.role === 'switch' ? selector(...) : knob(...)`,
and the manifest writes `"control": "switch"` for a seven-position selector and
for an on/off lever alike — so the two collapsed together one layer before the
renderer collapsed them again.

None of the cells could see it. `U22` asks whether a control is at least 44 px
and never whether the 44 px is a knob or a slider. `U19` — "original artwork" —
is satisfied completely by seven faces each declaring `panel-surface`,
`origin: original`, "drawn in code from design tokens", while all seven render
the same panel; it is an IP cell wearing a styling cell's title. `U20` proves a
readout is bound to a channel the unit publishes, which the Motion Shaper's
readouts were, while the drawn curve the whole unit exists to apply had no
surface anywhere in the product.

## The decision

**One.** The control primitives are built once, in `motionwave/ui/render/controls/`,
and every unit uses them: rotary knob, stepped selector, bat toggle, rocker,
latching button, fader, VU meter, lamp, bar meter, numeric display, and a curve
editor surface. Each is a distinct _gesture_, not a distinct drawing.

**Two.** Which primitive a parameter may wear is derived from its `ParamSpec` and
checked; which of the suitable ones it _does_ wear is the face's declaration.
`render/faceControls.ts` throws at module load when the two disagree.

**Three.** A panel's appearance becomes data. `PanelSkin` carries era, surface,
hue, chroma, value, knob body, arrangement, lettering, furniture and lamp
colour, and `render/facePanel.ts` interprets it generically.

**Four.** Cell 26 is added to the Ledger and applied retroactively.

## Why not the obvious alternative

The obvious fix is per-unit drawing code: give each face its own renderer and
stop pretending one file can draw fourteen panels. It would have worked, and it
would have destroyed the property that makes fourteen faces affordable at all —
that a face is a _declaration_ the harness can check. U20's binding check, U22's
geometry check and U23's contrast check are all checks on a declared set of
elements. Fourteen hand-built panels have fourteen sets of elements that the
declaration merely describes, and the first one to drift does so silently.

So the rule at the top of `facePanel.ts` stands unchanged: nothing in it knows
what a Motion Shaper is. What changed is the assumption underneath it — that a
generic renderer implies a generic appearance. It does not, once appearance is
something a face can declare.

## What this costs

A panel's fascia is generated from its declared hue, chroma and lightness, so it
cannot be a palette token — if it were, every panel would be the same colour
again. That takes the fascia outside `design/tokens.css` and outside the
contrast table `U23` checks, which is a real loss.

It is paid for by solving rather than choosing: `render/skin.ts` searches for an
ink lightness that clears 7:1 against the generated fascia and throws if none
does, and `U23` measures the pair it will actually render rather than looking up
two tokens. At lightness 47 % neither black nor white clears 4.5:1, and both
look perfectly fine to someone who is not measuring — which is how a contrast
failure ships.

## What is _not_ licensed by this

Era language is taxonomy, proportion, surface treatment and the colour
temperature of a period. It is not any manufacturer's product. No skin may name,
trace, photograph, match the colour of, or reproduce the trade dress, badge,
typeface or panel artwork of a real unit, and no reference name may appear in a
skin, an identifier, a filename or a legend. `LEGAL_NOTES.md` governs, and it is
a commercial-safety requirement rather than a stylistic preference.

## Consequences

- A new unit gets its controls for free and declares only what makes it itself.
- A face that asks for the wrong primitive fails to load, with the parameter and
  its position count named.
- Cell 26 dropped all seven units out of `SHIPPING`. They return one at a time.
