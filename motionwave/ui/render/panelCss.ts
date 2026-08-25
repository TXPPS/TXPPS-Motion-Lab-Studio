/**
 * Motion Wave — the panel's own rules: surface, furniture, lettering, layout.
 *
 * Emitted from TypeScript rather than shipped as a `.css` file because a panel
 * is mounted into two very different hosts — the framework's dev panel and
 * MotionLab Studio's React mixer — and a stylesheet that had to be linked by
 * each of them is a stylesheet one of them will forget. The face carries its
 * own appearance the way it carries its own controls.
 *
 * Everything is drawn: gradients, repeating gradients, borders and shadows.
 * Nothing is traced, photographed, matched to a product or licensed, and no
 * asset is loaded. The era language lives in proportion, surface and control
 * taxonomy, which is what an era language is — see `LEGAL_NOTES.md`, which
 * makes this a commercial-safety requirement rather than a preference.
 */

/**
 * Surfaces, as light behaves on them.
 *
 * Each is a different *physical* treatment rather than a different colour: a
 * brushed panel scatters along one axis, a wrinkle finish scatters in every
 * direction, a moulded one barely scatters at all. Drawing that difference is
 * what makes two panels of the same hue still read as two objects — and hue
 * alone was never going to be enough, since a rack of units from one decade
 * shares its colours.
 */
const SURFACES = `
.mw-panel[data-mw-surface='painted-steel'] {
  background-image:
    linear-gradient(180deg, var(--mw-fascia-high) 0%, var(--mw-fascia) 22%, var(--mw-fascia-low) 100%);
}
.mw-panel[data-mw-surface='brushed-alloy'] {
  background-image:
    repeating-linear-gradient(
      90deg,
      color-mix(in srgb, var(--mw-fascia-high) 55%, transparent) 0 1px,
      transparent 1px 3px
    ),
    linear-gradient(180deg, var(--mw-fascia-high), var(--mw-fascia) 40%, var(--mw-fascia-low));
}
.mw-panel[data-mw-surface='wrinkle-enamel'] {
  background-image:
    repeating-linear-gradient(38deg, color-mix(in srgb, var(--mw-fascia-low) 60%, transparent) 0 2px, transparent 2px 5px),
    repeating-linear-gradient(-52deg, color-mix(in srgb, var(--mw-fascia-high) 40%, transparent) 0 2px, transparent 2px 6px),
    linear-gradient(180deg, var(--mw-fascia), var(--mw-fascia-low));
}
.mw-panel[data-mw-surface='anodised'] {
  background-image:
    linear-gradient(160deg, var(--mw-fascia-high) 0%, var(--mw-fascia) 45%, var(--mw-fascia-low) 100%),
    repeating-linear-gradient(90deg, color-mix(in srgb, var(--mw-fascia-high) 22%, transparent) 0 1px, transparent 1px 7px);
}
.mw-panel[data-mw-surface='moulded'] {
  background-image: radial-gradient(120% 100% at 50% 0%, var(--mw-fascia-high), var(--mw-fascia) 55%, var(--mw-fascia-low));
}
.mw-panel[data-mw-surface='glass'] {
  background-image:
    linear-gradient(200deg, color-mix(in srgb, var(--mw-fascia-high) 80%, transparent) 0 22%, transparent 22% 100%),
    linear-gradient(180deg, var(--mw-fascia), var(--mw-fascia-low));
}
`;

/**
 * Furniture — the parts of a panel that are not controls.
 *
 * A rack unit is recognised by its ears and its screws before anything on it is
 * read, which is exactly the "distinguishable at a glance" cell 26 asks for.
 * The screws are radial gradients at the four corners of the ear strips; a
 * bezel is two borders of different lightness, which is what a moulded lip is.
 */
const FURNITURE = `
/* The ears are inset shadows and inset pseudo-elements, never borders with
   pseudo-elements hung outside them. The first version did exactly that — a
   1.5rem border each side with the screw plates at left: -1.5rem and
   right: -1.5rem — and an absolutely positioned box is placed against the
   *padding* box, so the right-hand plate stood 24 px past it. That is real
   overflow: scrollWidth minus clientWidth read 24 on a 390 px phone, which is a
   panel that scrolls sideways for furniture nobody can interact with. */
.mw-panel[data-mw-furniture='rack-ears'] {
  position: relative;
  padding-left: calc(var(--mw-space-6) + 1.75rem);
  padding-right: calc(var(--mw-space-6) + 1.75rem);
  box-shadow:
    inset 1.5rem 0 0 var(--mw-fascia-low),
    inset -1.5rem 0 0 var(--mw-fascia-low);
}
.mw-panel[data-mw-furniture='rack-ears']::before,
.mw-panel[data-mw-furniture='rack-ears']::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1.5rem;
  background-image:
    radial-gradient(circle at 50% var(--mw-space-7), var(--mw-fascia-low) 0 0.19rem, var(--mw-fascia-high) 0.19rem 0.25rem, transparent 0.25rem),
    radial-gradient(circle at 50% calc(100% - var(--mw-space-7)), var(--mw-fascia-low) 0 0.19rem, var(--mw-fascia-high) 0.19rem 0.25rem, transparent 0.25rem);
  pointer-events: none;
}
.mw-panel[data-mw-furniture='rack-ears']::before { left: 0; }
.mw-panel[data-mw-furniture='rack-ears']::after { right: 0; }
.mw-panel[data-mw-furniture='bezel'] {
  border: 0.375rem solid var(--mw-fascia-low);
  box-shadow: inset 0 0 0 var(--mw-hairline-strong) var(--mw-fascia-high);
}
.mw-panel[data-mw-furniture='none'] { border: var(--mw-hairline) solid var(--mw-fascia-low); }
`;

/**
 * Lettering.
 *
 * Engraved legends are cut into the panel and read as a shadow above and a
 * highlight below; silkscreen sits on top of it and reads flat and slightly
 * heavier; a legend plate is a separate piece of material screwed to the
 * fascia. All three are the *type setting* of a period, not any typeface — the
 * font family stays the product's own throughout, which is both the honest
 * choice and the one `LEGAL_NOTES.md` requires.
 */
const LETTERING = `
.mw-panel[data-mw-lettering='engraved'] .mw-ctl-label,
.mw-panel[data-mw-lettering='engraved'] .mw-panel-title {
  text-shadow: 0 var(--mw-hairline) 0 var(--mw-fascia-high);
  letter-spacing: 0.06em;
}
.mw-panel[data-mw-lettering='silkscreen'] .mw-ctl-label,
.mw-panel[data-mw-lettering='silkscreen'] .mw-panel-title {
  font-weight: var(--mw-weight-bold);
  letter-spacing: 0.11em;
  text-transform: uppercase;
}
.mw-panel[data-mw-lettering='legend-plate'] .mw-ctl-label {
  background: var(--mw-fascia-low);
  border: var(--mw-hairline) solid var(--mw-fascia-high);
  border-radius: var(--mw-radius-sm);
  padding: var(--mw-space-1) var(--mw-space-3);
  letter-spacing: 0.04em;
}
`;

/**
 * Arrangements — how many controls sit across, and how big they are.
 *
 * This is the proportion half of the era language and it does more work than
 * the colour does. A 1950s programme equaliser is a wide shallow panel with few
 * large controls; a console strip is narrow and dense; a unit built around one
 * meter puts the meter in the middle and everything else beneath it. The count
 * is a *preferred* column width rather than a fixed column count, because a
 * fixed count collides with the 44 px floor and overflows — measured at 12 px
 * of horizontal scroll on the Variable-Mu before it was written this way.
 */
const ARRANGEMENTS = `
.mw-panel[data-mw-arrangement='wide-banded'] { --mw-ctl-size: 4.5rem; --mw-ctl-min: 5.5rem; }
.mw-panel[data-mw-arrangement='centre-stage'] { --mw-ctl-size: 3.5rem; --mw-ctl-min: 4.5rem; }
.mw-panel[data-mw-arrangement='strip'] { --mw-ctl-size: 3rem; --mw-ctl-min: 3.75rem; }
.mw-panel[data-mw-arrangement='console'] { --mw-ctl-size: 2.75rem; --mw-ctl-min: 3.5rem; }
.mw-panel[data-mw-arrangement='field'] { --mw-ctl-size: 3.75rem; --mw-ctl-min: 4.75rem; }
.mw-panel[data-mw-arrangement='centre-stage'] .mw-panel-readouts {
  justify-content: center;
}
/*
 * On a centre-stage panel the instrument gets the room, and on the one face
 * that has a curve the instrument is the curve.
 *
 * The wide breakpoint turns the body into a row of flex: 1 1 0 children, so
 * the editor ended up one of three equal columns — a small pale box beside two
 * columns of knobs, on a unit whose entire subject is the shape drawn in it.
 * That is the half of "looks weird" that survived giving the panel its own skin.
 *
 * It takes a whole row rather than a bigger share of one. Widening it inside
 * the row was tried first and moved the problem: at flex 2.2 the curve read
 * well and the controls collapsed to a single column, which made the panel
 * twice as tall as the window. A row of its own is what centre stage means
 * physically, and it is what this arrangement previously only said about
 * control sizes.
 *
 * No backticks in this comment: it lives inside a template literal, and the
 * first one closed the string and took the build with it.
 */
.mw-panel[data-mw-arrangement='centre-stage'] .mw-panel-body {
  flex-wrap: wrap;
}
.mw-panel[data-mw-arrangement='centre-stage'] .mw-panel-body > .mw-curve {
  flex: 1 1 100%;
  align-self: stretch;
  aspect-ratio: auto;
  height: 13rem;
}
.mw-panel[data-mw-arrangement='strip'] .mw-panel-controls,
.mw-panel[data-mw-arrangement='console'] .mw-panel-controls {
  gap: var(--mw-space-3);
}
`;

/** The panel's own frame: title, bands, readout row, control grid. */
const PANEL = `
.mw-panel {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--mw-space-5);
  padding: var(--mw-space-6);
  color: var(--mw-panel-ink);
  background-color: var(--mw-fascia);
  font-family: var(--mw-font-ui);
  font-size: var(--mw-text-md);
  /* Never hidden. A face that overflows its container is what U22 is looking
     for, and an overflow rule would make the failure invisible rather than
     absent. */
  overflow-x: visible;
}
.mw-panel * { box-sizing: border-box; }
.mw-panel-title {
  margin: 0;
  font-size: var(--mw-text-xl);
  font-weight: var(--mw-weight-medium);
  color: var(--mw-panel-ink);
}
.mw-panel-body { display: flex; flex-direction: column; gap: var(--mw-space-5); }
.mw-panel-readouts {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--mw-space-4);
}
.mw-panel-controls {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--mw-ctl-min, 4.5rem), 1fr));
  gap: var(--mw-control-gutter);
  align-items: start;
}
.mw-panel-band {
  display: contents;
}
`;

export const PANEL_CSS = `${PANEL}${SURFACES}${FURNITURE}${LETTERING}${ARRANGEMENTS}`;
