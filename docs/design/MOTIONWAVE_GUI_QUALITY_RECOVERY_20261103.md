# Motion Wave GUI recovery — touch controls and professional visual quality

**Status:** Functional interaction fix and first readability foundation implemented in an isolated draft branch. **No visual or sound approval.** This document is a design brief and acceptance plan, not a claim that the interfaces now look professional.

## Reported failures

1. Knobs on both vintage and granular effects feel reversed while dragging on a touchscreen.
2. Existing faces look amateurish and generic across the vintage and granular range.

### Technical root causes found in source

- `render/controls/gesture.ts` automatically entered circular tracking whenever a pointer moved beyond 1.4 times a knob's radius. Straight vertical **touch** movement could cross that threshold and then be interpreted as an angle. The angular origin was also calculated against the *entire control*, including its label and readout, rather than the actual SVG dial.
- `render/controlCss.ts` redefined `--mw-ctl-size` on coarse pointers as `max(..., var(--mw-ctl-size))`. This self-reference is a **CSS custom-property cycle**, invalidating the size override on mobile.
- `render/panelCss.ts` used physical dial sizes as small as 2.75–3rem in dense panels. Because the visible circular body occupies only part of a 100-unit SVG, the perceived knob is smaller still. Control captions and values were both 11px.
- A generic `UnitFace` renderer applies shared controls and a handful of skin/arrangement variants to every effect. The architecture is good for maintaining DSP-independent parameter binding; it is not a substitute for a deliberately designed panel composition or well-made individual assets.

## Recovery gates

### Gate U1 — correct and consistent controls

- On touch/pen, drag **up increases normalized value**, down decreases, including when the finger goes far outside the visible knob.
- Do not switch to circular mode on touch/pen; desktop mouse angular mode is optional and its center follows the visible knob, not the caption box.
- Works for continuous knobs and stepped rotary selectors, including minimum/maximum clamping, pointer capture, secondary touches, parameter automation, undo and preset reloads.
- Some hardware-inspired values deliberately have inverse *meaning* (e.g., faster ATTACK at a clockwise position on the FET). Keep their circuit parameter semantics and clearly label speed/direction; do not invert the whole DSP mapping to mask a UI gesture bug.
- Gesture tests run at the shared layer; real browser touch tests run at 390px on **all seven vintage/granular faces**.
- No touch-induced page scrolling, pinch zoom, stuck drags or horizontal overflow.

### Gate U2 — visual foundation (this patch, not final polish)

- Remove the recursive CSS variable and keep each face's own knob sizing on touch.
- Increase undersized dial art where panel geometry allows and preserve a >=44px actual hit target.
- Raise the label and numerical readout sizes and give values a visually deliberate, high-contrast reading field.
- Keep native SVG resolution independence: **no CSS transform/zoom scaling** to turn a blurry phone mockup into a desktop interface.
- No new artwork dependency, no altered parameter IDs, no audio path changes.

### Gate U3 — full original professional GUI design (NEXT; not yet approved)

Treat **vintage** and **granular** as separate design families, while sharing the lower-level parameter and gesture substrate. A skin hue, a material gradient, a word describing an era and a generic control grid are insufficient.

- **Granular Reverb:** large coherent grain-field visualization as the hero, dedicated envelope/damping/decay sections, real engine-controlled feedback and overlap readouts, grouped density/size/spray/time/space with a strong visual hierarchy.
- **Granular Delay:** a readable animated multi-head/time transport or delay-line visualization, organized clock/sync/pitch/smear/feedback and stereo controls, separation between transport and tone shaping.
- **Program EQ / Console EQ:** distinctive original hardware-inspired fascia, clear low/mid/high bands, legible frequency and gain scales, continuous response curves or relevant real meter state. Do not copy existing brands' panel artwork.
- **Optical / FET / Variable-Mu:** distinctive compressor layouts, prominent honest gain-reduction metering, clear input/output gain relationship, differentiated timing controls, safe named starting presets, correct stereo/link behavior. No fake meter motion.
- Create original, crisp visual assets (vector paths for labels/scales; well-designed knobs with consistent light, material and pointer geometry). If raster detailing is used, provide adequate high-DPI sources and desktop/mobile render verification. No unlicensed logos, trademarks, or copied product imagery.
- Use readable **minimum body labels ~12px / live parameter values ~13px** at 100% root size as a baseline; no squashed/cropped legends. Prefer fewer well-composed controls per row over an oversized generic grid.
- Build in mobile (390px), tablet (768px), desktop (1440px) and high-DPI desktop contexts at each revision, rather than relying on a mobile-only preview.
- Capture actual implemented screenshots before making quality claims. Review screenshots for hierarchy, kerning/font raster quality, alignments, knob ticks, value legibility, meaningful spacing, accurate display states and dynamic motion. Compare against agreed reference direction and record defects.
- Preserve accessibility, contrast, reduced motion, keyboard input, source-of-truth parameter mapping, saved project data and audio runtime performance.

**Non-goal for this first PR:** declaring all faces visually polished or changing vintage DSP curves. The user has explicitly rejected the current appearance, so the full visual identity remains **BLOCKED FOR OWNER VISUAL APPROVAL** until real screenshots and a design selection are reviewed.

## Verification

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:mw
npm run build:panel
npx playwright test --config motionwave/ui/playwright.config.ts touch_rotary
```

Then exercise the actual MotionLab Studio insert editor on a physical iPhone/iPad and desktop browser, testing upward/downward gestures, rotary selectors, parameter recall and responsive layouts. Run the existing UI E2E and app test suites before merge. The existing native core sampler onset defects are tracked separately in issue #7 and must not be hidden.
