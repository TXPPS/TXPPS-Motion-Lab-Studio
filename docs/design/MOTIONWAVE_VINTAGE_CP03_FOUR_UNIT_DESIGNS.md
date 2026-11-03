# CP-UI-LOCK-003 — Four Vintage Processor Face Designs

**Status:** candidate layouts, not visually approved or integrated into production.
**Source baseline:** CP-UI-LOCK-001/002 in stacked draft PR #11 and existing generated ParamSpecs and face definitions.
**Design goal:** a distinct, authentic-feeling instrument per circuit family, without manufacturer logos, typeface copying, badges, artwork tracing or distinctive trade dress reproduction.

## Design language, not product copies

The five vintage units share an original industrial art family: precision engraved tick rings, tactile machined caps, screws with plausible placement, bezel treatment, well-balanced panel shadows, uniform type weight and glass-covered analog meters. These are component _classes_, not photo-traced copies. A small subset is deliberately shared; face composition, materials, controls, historical behavior, panel proportions and meter focal points vary between products. If any candidate visually resembles a specific commercial panel beyond generic hardware conventions, revise its overall visual arrangement.

## DYN-02 Optical Leveller — restrained analog broadcast

**Controls (9, source-of-truth):** Peak Reduction (0..1), Gain (-20..40 dB), Mode (Compress/Limit), Emphasis (0..1), Cell Wear (0..1), Input (-20..20 dB), Variance (0..1), Oversampling (Off/2x/4x/8x), Noise (0..1).

**1200x460 conceptual desktop face:**

- Header 72 px, with the product name, presets, compare and separate global bypass; muted olive-charcoal finished metal, light etched engraving.
- Main lower-face horizontal sequence: **Peak Reduction** large 140px analogue dial at x≈160; **honest gain-reduction meter** large 330x175 analogue window at x≈330; **Gain** large 140px at x≈855. A small Compress/Limit mechanical toggle has its own strong visible state beside the meter.
- Input and Emphasis are smaller second-row adjustments, but not fictional attack/release/threshold/ratio controls.
- Cell Wear, Variance, Noise, Oversampling are behind an obviously accessible `Advanced` fold. Do not bury the main Mode toggle.
- Meter must use actual GR frame data and the renderer's truthful ballistics. The concept art needle is static and cannot be treated as runtime metering.

**390px phone:** header/primary bypass, one prominent honest VU, two same-sized primary knobs side by side (Peak Reduction / Gain), mode toggle, then Input/Emphasis, followed by Advanced drawer. No desktop-face shrinking or all controls in one 2-column grid.

**Reject:** off-spec Attack/Release controls, redundant output knob separate from Gain, fantasy ratio control, fake moving VU needle.

## DYN-03 FET Limiter — performance-grade aggressive utility

**Controls (9):** Input (-20..40 dB), Output (-20..40 dB), Attack (real 1..7), Release (real 1..7), Ratio (4:1 / 8:1 / 12:1 / 20:1 / All In), Limiting (Off/On), Variance, Oversampling, Noise.

**1200x460 conceptual desktop face:**

- Original graphite-blue black chassis and mechanically precise inset engraving, with copper/rust pilot indicator rather than large decorative neon.
- Input and Output large primary dual shafts. Attack/Release have explicit 1–7 scales and tooltip descriptors; **1–7 is a hardware position, not “milliseconds,” and increasing it must preserve the actual compressor timing law**. No invented independent Threshold control.
- Ratio is a clearly interlocking five-button selector, visually exhibiting _one selected state_; five buttons, not a false stepped dial or four silently omitting All In.
- Limiting Off/On visible (distinct from host bypass). Prominent gain-reduction meter from the exported C++/WASM frame.
- Small lower-right panel for Variance / Oversampling / Noise (Advanced), not fake ratio/meter modes.

**390px phone:** gain-reduction window first (or directly after compact input/output status), large Input/Output pair, Ratio as a visible single-row wrap or 2-row button bank, then Attack/Release with exact dial-position labels. Advanced drawer.

**Reject:** Threshold knob, Attack expressed in arbitrary ms labels, Ratio with missing All In, duplicated makeup gain, fake analog “GR” disconnected from DSP.

## DYN-04 Variable-Mu — symmetric two-channel mastering

**Controls (10):** Input A/B (0..20 dB), Threshold A/B (0..10), Time Constant A/B (choices 1..6), DC Threshold A/B (0..1), Mode (Left/Right or Lateral/Vertical), Oversampling (Off/2x/4x/8x).

**1200x530 conceptual desktop face:**

- Wide 2-part satin-dark bronze chassis, separate **A** and **B** equal-width channel columns, equal-size authentic left and right VU windows, narrow central mode bridge.
- Each channel clearly groups Input, Threshold, Time Constant; their knobs must be independent sources with correct A/B labels.
- DC Threshold A/B should have advanced trim/protection styling, not the same prominence as primary controls.
- Mode center selector highlights actual Left/Right vs Lateral/Vertical; never fake a stereo link control if none exists in the parameter set.
- Oversampling is a single shared Advanced choice, not duplicated per channel.
- Genuine meter channels for both sides; don't animate both needles identically unless the data is actually equal.

**390px phone:** Mode + paired mini-meter first, then distinct A/B panels stacked; each has its own Input/Threshold/Time Constant, followed by two clearly labeled DC trims and a shared Oversampling Advanced row.

**Reject:** Attack/Release and Ratio knobs, single-channel clone doubled without data separation, “link” button with no stable parameter, two magically synchronized needles.

## DYN-05 Console EQ — two _different_ discrete circuit-lineage faces

**Controls (20):** Lineage (Inductor / Bridged-T), Drive, Output, EQ In, Low Freq, Low, Mid Freq, Mid, High, High-Pass, Band 1 Freq, Band 1, Band 1 Shape, Band 2 Freq, Band 2, Band 3 Freq, Band 3, Band 3 Shape, Band-Pass, Oversampling.

**1200x540 conceptual desktop:**

- Tall, modular channel-strip visual architecture with a main **Lineage segmented control** top. Switching lineage must visibly change which original circuitry controls are in the active workspace; no meaningless global row with both networks active.
- **Inductor mode:** Low Freq selector (35/60/110/220 Hz) + Low continuous gain, Mid Freq selector (360 Hz..7.2k) + Mid gain, High gain, High-Pass discrete 0/50/80/160/300. Distinct warm slate/blue frequency skirts with enough offset for 44px interaction.
- **Bridged-T mode:** Band1/2/3 each with frequency + stepped ±gain; Band1/3 Shape selector Peak/Shelf; Band-Pass toggle. Three separate discrete bands with color-blind-safe pattern/label distinctions.
- Persistent shared header/footer: Drive, Output, EQ In, Oversampling drawer. Avoid displaying Inductor-only controls as live in Bridged-T mode or vice versa.
- Real DSP-driven frequency response only if its read-only computation is available and verified; concept-only schematic must be labeled illustrative.

**390px phone:** active-lineage segmented switch at top; single selected family rendered into vertically stacked band cards; fixed/visible EQ In and Drive/Output section; inactive lineage is not mounted interactively and does not clutter the page.

**Reject:** mixing the two electronic lineages into one frequency selector palette, inventing HF frequency control in Inductor mode, forcing every band into identical generic knob arrangement.

## Hardware-control fidelity and shared system contract

- Each knob scale is derived from generated `ParamSpec` min/max/choices and _actual DSP semantics_, not generic visual-number markup. Values, automation IDs and project serialization remain unchanged.
- Phone: at least 44px touch targets, readable legend >=12px, numeric values >=13px, touch up=increase normalized value (regardless of analog timing semantics); no CSS transform scaling.
- Desktop: no phone grid stretched across empty width. True face compositions with dedicated equipment zones.
- Keyboard/pointer/fine-step/double-click reset/preset recall are preserved; UI must not confuse host bypass with EQ In, Limiting, or analog mode.
- Each dynamic meter reads an existing published frame; static drawings must say `NONFUNCTIONAL CONCEPT`. Never fake analysis, reduction or VU movement.
- **No production implementation/approval claim.** This checkpoint is a rigorous geometry and control mapping handoff; images and art assets remain candidates.

## Review outcomes required

Owner separately approves or rejects DYN-02, DYN-03, DYN-04 and the two DYN-05 lineage faces at desktop/phone sizes. A design approval requires correct controls, general hardware authenticity, professional aesthetic quality, no brand imitation, transparent readouts and practical reachability; typography and knob assets are then shared through CP-UI-LOCK-004.
