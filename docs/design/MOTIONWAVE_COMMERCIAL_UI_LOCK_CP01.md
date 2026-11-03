# Motion Wave — Commercial UI Lock

Design checkpoint CP-UI-LOCK-001 · proposal, not owner approved · 2026-11-03

## Objective

Rebuild the five vintage and two granular plug-in faces as distinct, market-ready creative tools. Vintage units must faithfully communicate their actual hardware _control philosophy_ and mechanical proportions without copying brand identifiers, model badges, typography, panel art or unique trade dress. Granular effects require independent, flagship digital identities; not reskinned generic grids.

This phase deliberately locks UI architecture and visual design BEFORE any DSP tuning, optimization or processor behavior changes. Design approval never implies sound approval.

## Existing foundation / change boundary

- Stack this checkpoint above draft UI-01 PR #8, which fixes mobile rotary drag, display percentage scale, rotary size and Granular Delay tab overflow. Keep PR #8 independent and unmerged pending its gates.
- Production audio implementation, compiled WASM, stable ParamSpec ids, value ranges, tap topology, automation, projects and presets are untouched during design selection.
- Only use legitimate published hardware reference sheets already under docs/reference for technical/control topology; no scraped photographs as assets, no recreated logos/faceplates, no protected model names in shipped UI.
- Never use cosmetic fake meter or fake grain activity. Dynamic displays must connect to existing published DSP meter frames, handle absent data and respect reduced motion.
- Asset builds must be reproducible and retain provenance, license evidence and native vector/source deliverables, not just screenshots or flattened CSS.

## Family definitions

| Unit                    | Hardware-derived visual grammar                                                                                                             | Unique composition and hierarchy                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| DYN-01 Program EQ       | wide shallow mid-century passive program equalizer, engraved scales, broad stepped selectors, solid dark rotary skirts, optional pilot lamp | two horizontal low/high EQ networks; Low Boost and Low Atten distinct, not cancelling opposites; restrained output VU and an honest DSP response plot |
| DYN-02 Optical Leveller | pale broadcast steel, two _large_ continuous knobs, inset analog gain reduction VU, restrained metal toggle                                 | clearly primary Peak Reduction/Gain, mode and meter switch secondary; no fictional attack/release/ratio controls                                      |
| DYN-03 FET Limiter      | deep graphite rack fascia, four stepped ratio buttons, input/output rotary, faster attack/release rotaries, mechanical VU                   | crisp gain reduction focal meter, input/output stage clarity, accurate clockwise time labels (avoid false “more = faster” semantics)                  |
| DYN-04 Variable-Mu      | premium wide mastering unit, symmetrical dual-channel layout, satin metal, two large matched VU meters                                      | separate A/B gain/threshold/time groups and stereo mode bridge; do not accidentally mirror link status                                                |
| DYN-05 Console EQ       | tall or narrow modular console strip, differentiated bands, discrete detents, slim colored frequency rings                                  | band-by-band low/mid/high sections; clearly separate the two real circuit lineages instead of blending their frequency layouts                        |
| FX-02 Granular Reverb   | modern deep-mineral finish, large spacious data field, elegant high-resolution luminous particles                                           | true live grain cloud is the visual hero; dedicated time/texture/pitch/space zones, Freeze state and honest overlap/readout diagnostics               |
| FX-03 Granular Delay    | modern transport-workstation surface, dark technical glass and restrained brass/copper details, editable tap timeline                       | 8-tap head/time map as hero, always-visible eight transport macros, Loop/Medium/Time/Output/Tap1–8 as real pages; never all 139 controls on one page  |

## Shared visual system: implement after selecting approval comps

- Define three scale families instead of scaling one flattened panel: compact phone, medium tablet, full desktop.
- Original control assets: 2D+vector layered rotary chassis/cap/indicator/scale, detented selector, two-state mechanical toggle, interlocked ratio button, LED/needle meter and readable diagnostic screen; export source files and 1x/2x/3x render guidance.
- Define per-control geometry, focus ring, hit target, automation touch indicator, disabled/bypass state and color contrast; never assume an SVG circle implies a complete tactile design.
- Text: a sober legal/licensed UI typeface, carefully sized digits, no pseudo-engraved unreadable micro-labels. Design targets >=12 px at CSS 100% for small legends, >=13 px numerical values, stable tabular numerals, stronger primary legends.
- Touch hit zones >=44 x 44 CSS px, no accidental mode switching; mouse relative/optional orbit, pen vertical, keyboard and accessible labels preserved.
- Shared interaction bindings MUST continue through the generated parameter descriptors. Do not hardcode parameter id lists into art scripts. Do not create a duplicate audio/automation state store.
- Preserve real visual data availability: no implied DSP changes, invented response curves, invented spectrum, or frame interpolation presented as measured facts.
- Real CSS responsive reflow: no transform/zoom scaling from a phone mockup to desktop; crisp at 1x/2x/3x DPI; no portrait horizontal scroll.

## Phone / tablet / desktop acceptance

- Phone reference: 390x844 CSS px at 1x/3x; layout may scroll vertically within measured bounds, but no sideways scroll or two simultaneously visible tap editors.
- Tablet: 768x1024 and landscape 1024x768; maintain readable control grouping and visible bypass, preset, compare and wet/dry if exposed by the unit.
- Desktop: 1280x800, 1440x900, 1920x1080 at browser 100% and Windows 125%/150% OS scale; do not simply stretch 60px knobs across unused space.
- Visual quality review: screenshot of every unit and state with recorded source SHA, typography metrics, crops, arc/tick alignments, radius/spacing rhythm, true LCD/VU data, hover/focus and active/disabled.
- Interaction review: upward touch increases normalized value; physical hardware parameters that invert perceived timing must have honest legends; mouse, touch, pen, fine mode, double-click default, preset reload, automation and multi-touch tested.
- Performance budget during UI-only phase: no avoidable animation work in background/hidden tabs, no extra DSP writes per frame, no expensive layout reads inside audio meter loops. Benchmark and tune after UI lock rather than silently changing DSP now.

## Design checkpoint sequence / owner approval gates

1. CP-UI-LOCK-001 (this contract): explicit scope, reference sheets, control fidelity matrix, interaction rules and objective test gates.
2. CP-UI-LOCK-002: **three non-production visual comps** — Program EQ, Granular Reverb, Granular Delay. For each, pair a full desktop composition with a separately designed phone composition and define hero/primary/advanced zone hierarchy. Review actual images.
3. CP-UI-LOCK-003: three remaining dynamics (Optical, FET, Variable-Mu) and Console EQ comps; a consistent vintage asset family with distinctive sub-identities.
4. CP-UI-LOCK-004: asset catalog, source SVG/3D references if needed, typography and icon rules, exact knob-scale/needle specs, 1x/2x/3x exports.
5. CP-UI-LOCK-005: implement approved Program EQ and one granular unit with real parameter bindings and telemetry; full desktop/mobile screenshots; preserve saved projects and audio.
6. CP-UI-LOCK-006: implement remaining five faces through one reviewable PR per unit/family, not a giant unreviewed style patch.
7. CP-UI-LOCK-007: real-device owner review, iPhone Safari/manual QA, keyboard/a11y/HiDPI/reduced-motion, screenshot defect closure; record explicit approval per unit. No implicit approval from tests or compilation.
8. CP-AQ-PERF-001 (DEFERRED): after lock, profile UI rAF, canvas, memory, high-DPI draw costs, virtualized tap controls and parameter/meter latency; then DSP performance/audio calibration in a separate checkpoint.

## Protection against false success

- A static concept is NOT a functional UI, screenshot proof, source art, or owner approval.
- Code compilation is NOT visual approval. Unit tests are NOT a physical iPhone Safari test. An attractive meter is NOT authentic unless its value comes from the real engine.
- No merge to default branch, production deploy or replacement of existing links merely because a concept has been generated.
- Never call this CP finished until desktop and phone actual code render captures match owner-approved comps and all named controls remain reachable and correct.
