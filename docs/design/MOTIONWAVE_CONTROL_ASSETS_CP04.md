# CP-UI-LOCK-004 — Original Editable Control Asset System

**Status:** pre-approval source-art prototype, not a production asset release.
**Design parent:** draft PR #11, CP-UI-LOCK-001/002. **Companion face-spec:** CP-UI-LOCK-003 in this branch.
**Rule:** No code or SVG from this catalog is imported by the DAW until its desktop/phone appearance, scale semantics and legal provenance are owner-approved.

## Asset source, style and rights

The first source master is `design-assets/motionwave-ui-lock/controls-v0.svg`: hand-authored procedural SVG paths/shapes, full resolution-independent vector, grouped layers, no embedded raster photos, no extracted commercial art and no custom distributed font files. Control classes (pointer skirts, flutes, detents, industrial toggles, VU frames) are generalized mechanical forms. Source art is original to Motion Wave and must be reviewed for accidental lookalike trade dress before distribution.

The SVG *overview* is static design art and not a functional knob, meter or plugin. Its meter needle value is decorative sample state **only for artwork inspection**. Production metering must be wired to actual published DSP channels; never reuse the static needle as a live display.

## Geometry / export contract

| Asset ID | Source geometry | Production intent | Minimum display size |
| --- | --- | --- | --- |
| MW-CONTROL-001 | Large pointer/skirt knob, tick ring, indicator, conical edge, separate face and shadow | Program EQ main boost/atten, Input/Output on dynamic units | 84px desktop, 72px phone visible |
| MW-CONTROL-002 | Compact machined collet knob with crisp pointer | Secondary inputs, output trims, granular macro small | 52px desktop, 56px touch when primary |
| MW-CONTROL-003 | Fluted cap / fine ridges, insulated highlight | Texture/space granular engine, optional second knob skin | 72px desktop, 64px phone |
| MW-CONTROL-004 | Chicken-head/detented selector pointer with cut angles | Program EQ frequency, ratio/step selectors where semantically correct | 74px desktop, 64px phone |
| MW-CONTROL-005 | Five mutually exclusive ratio buttons | FET 4:1 / 8:1 / 12:1 / 20:1 / All In (never dummy missing choice) | each target >=44×44 CSS px |
| MW-CONTROL-006 | Two-state mechanical toggle with explicit legend | Compress/Limit, Eq In, Limiting on/off when source manifest allows | target >=44×44 |
| MW-CONTROL-007 | Analog meter frame/glass/scale with separate needle layer | GR or VU with actual DSP channel/ballistics only | 280×140 desktop, 300×145 phone (can adapt) |
| MW-CONTROL-008 | Inset digital display housing, baseline and grid | Granular live data, delivered tap timeline, EQ readouts | content-dependent; should not hide labels |

Values above are **art direction targets**, not hardcoded component rules. Actual responsive unit geometry and parameter mapping require separate acceptance.

## Separate render and interaction layers

1. Structural ring, label/detent layer, knob shadow, chassis, cap, highlight and pointer must be independently editable rather than an opaque PNG.
2. The runtime component retains the real `ParamSpec` normalisation/choices and touch action. Visual control assets never normalize or change audio parameters themselves.
3. Detents and labels MUST follow real choice arrays; stepping must be exact. For a FET 1..7 timing control, the art must show hardware positions 1–7, not invented wall-clock units or a global “faster” semantics rule.
4. Needle movement is only drawn by runtime after a real published meter frame; offline concept art displays a static sentinel sample state with `STATIC ART` label.
5. Physical min hit 44×44 CSS px; visual diameter may be smaller only if a larger accessible target encloses it.
6. Reflect hover, focus-visible, pressed, bypass, disabled, automation-touch, out-of-range and “no telemetry” states. Reduce motion when OS indicates; do not continuously animate decorative material effects.
7. Layer assets at logical coordinate sizes, then render to true desktop and iPhone with devicePixelRatio 1, 2 and 3; no CSS transform scaling of the whole face.

## Material and typographic system

- Vintage broadcast: warm painted steel, champagne metal, dark Bakelite-like polymer, soft amber pilot state, restrained engraved text and inset glass. Physical legibility over imitation patina.
- Fast FET: near-black naval-grey anodized alloy, satin knobs, assertive but subtle mechanical indicator, white labels and unambiguous button selection.
- Mastering mu: bronze/charcoal dual-channel symmetry, silver/ivory dials, two matching meter units.
- Console EQ: modular dark slate with selective band identifier rings (blue/green/ochre/rust) accompanied by text labels, not color as sole communication.
- Modern granular: original distinct ice/iris/teal luminous state on matte mineral/graphite chassis; illumination limited to active interactions and actual live data, never a UI-wide glow.
- Typography: legible licensed/system UI face; no distributed fonts. Approx. 13–16px primary knob legends, 12px small labels and 13px live numbers at 100% CSS size. High-contrast labels must remain readable against real fascia gradient stops.

## Technical acceptance and QA

- Render the vector master in a real browser and inspect geometry at 100% and 200% sizes; check rings, pointer, ticks, font baselines, clipping, shadows, aliasing, color contrast and grouping.
- Digitally verify SVG parses without external references and image load works offline; include a manifest of exact asset IDs and source file.
- For future VST host integration, asset renderer must be deterministic with no animation on the audio thread, no high-frequency DOM reads inside parameter processing, no disabled cache releasing active controls.
- Test readouts and gesture behavior using the independent UI-01 browser suite: mouse, touch, pen, keyboard, automation, presets, bypass, selection. No performance or audio-path changes in this design sandbox.
- **No “commercial quality approved” claim** until real phone/desktop renders, owner comparison and per-control signoff.

## Current artifact state and next handoff

A source SVG proof and machine-readable manifest are stored in `design-assets/motionwave-ui-lock/`, under this feature branch. This supplies editable original geometry and documented interfaces, *not* production-ready final faces.

Next step: capture per-unit desktop/phone variants using genuine generated parameters, review the VU/knob/caption consistency, refine against the owner’s selected concepts, then implement a single Program EQ vertical slice under CP-UI-LOCK-005. Performance/DSP issue #10 remains deferred.
