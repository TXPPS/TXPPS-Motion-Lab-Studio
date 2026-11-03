# First-wave approval comps: Program EQ / Granular Reverb / Granular Delay
CP-UI-LOCK-002 · non-production design specification · NOT APPROVED

The accompanying concept images in the conversation are MOOD / COMPOSITION REFERENCES, not truthful render captures, implementation blueprints, complete parameter maps or approved source art. Generative art can invent controls, duplicate switches, mislabel frequencies or depict fake meters. **The exact control lists below override any visual illustration.**

## DYN-01 — Program EQ / original broadcast-era rack design
**Visual personality:** premium mid-century cream/champagne painted chassis with deep charcoal rotary hardware, engraved dark legends, fine tonal surface variation, restrained amber power indication and small honest VU. Hardware authenticity comes from the control taxonomy and shape, NOT copying any single manufacturer's faceplate, exact color, lettering, logo, screws or scale artwork.

**Desktop composition target (1440-wide viewport; plug-in panel comfortably 1040–1220 wide):**
- Top bar: Program EQ, preset/compare/bypass and small consistent product identity.
- Large LOW group: Low Frequency (detented), Low Boost, Low Atten.
- Large HIGH group: High Frequency (detented), High Boost, Bandwidth, Atten Select (detented), High Atten.
- Lower secondary rail: true signal-dependent output VU; optional *genuine* response curve ONLY if a read-only DSP response query or validated transfer model exists; Input/Output.
- Foldable service section: Variance, Oversampling, Noise. EQ In must remain immediately reachable and clearly different from global plugin bypass.
- Correct tactile tick marks and labels: frequency selectors are discrete; boost/atten are continuous. Low Boost and Low Atten coexist and do not simply cancel one another.

**Phone composition (390 CSS px):** top title/preset and reachable EQ In; LOW and HIGH modules stacked as separate hardware-like cards, with independent three/five control grids; honest mini VU + output row; Advanced section collapsed by default. No tiny desktop rack squeezed with CSS transform.

**Mapping:** exactly 14 generated controls: Low Frequency, Low Boost, Low Atten, High Frequency, High Boost, Bandwidth, Atten Select, High Atten, EQ In, Input, Output, Variance, Oversampling, Noise. Existing published meter channels: InputPeak, OutputPeak, HarmonicSecond/Third, InputCoreDrive/OutputCoreDrive.

**Do not implement from concept art:** off-spec controls, fabricated continuous crossover frequency options, bogus default response graph, arbitrary input meters. A fixed example curve is allowed ONLY with prominent “illustration / not measured” caption in a non-interactive design presentation; shipped UI uses true data.

## FX-02 — Granular Reverb / modern flagship spatial engine
**Visual personality:** deep blue-black mineral casing with one wide, original, high-DPI particle field in restrained ice-cyan / iris-violet accents; concise typography, tangible dark knobs with precise pointer indicators, not glowing every component.

**Desktop:** full-width live grain field as HERO (roughly 40–45% above-the-fold height), small truthful left/right level rails, essential Mix/Decay/Size/Pre-delay/Freeze accessible without page changes. Secondary tabs or zones: SPACE (Diffusion, Damping, Tilt, Width), GRAINS (Grain size, Density, Spray, Min offset and jitter controls), PITCH (Pitch set/spread), SYSTEM (Quality, Output trim, Pre-delay sync, Bypass). Prefer rows of 3–4 deliberately sized knobs, not a generic list of all 23.

**Phone:** grain field retains a meaningful 16:9-ish display at width ~350, with clearly separated primary macros beneath; tabs for Texture/Space/Pitch; sticky small active section header if long. Freeze/bypass visually and semantically distinct. No partially shown offscreen knobs.

**Mapping:** the *exact* 23 generated controls are Mix, Pre-delay, Size, Min offset, Decay, Freeze, Grain size, Density, Spray, Onset jitter, Length jitter, Amp jitter, Window shape, Pitch set, Pitch spread, Diffusion, Damping, Tilt, Width, Output trim, Quality, Bypass, Pre-delay sync.

**Truthful meters:** existing engine publishes LiveGrains, Overlap, CloudDepth, CloudSpread, ClampedDensity, Rt60At8k, Feedback, InputPeak, OutputPeak. The grain cloud must use the actual grain sample positions / amplitudes and explicitly distinguish displayed subset from actual count; freeze shows actual held state after fade. No procedural particles pretending to be grains when the engine is idle.

## FX-03 — Granular Delay / original multi-head creative workstation
**Visual personality:** dark graphite display with restrained warm bronze/cyan transport accents, clean modular panels, detailed numbered tap timeline and tactile transport controls. It should NOT be a vintage tape-delay hardware clone and should NOT inherit the Reverb grain-cloud centerpiece.

**Desktop:** hero transport/tap graph occupying the primary area with 1–8 delivered head locations, enable/mute/solo status, loop feedback path and real time-change behavior. Always-available macros: Mix, Feedback, Smear, Taps, Sync, Topology, Character, Bypass / chosen priorities from the existing face definition. Tabs BELOW hero: Loop, Medium, Tap times, Output, Tap 1–Tap 8; no all-at-once wall of 139 controls. Make visible primary transport and loop level distinct from the editor's local tab parameters. Selected tab full width, not compressed beside readouts.

**Phone:** compact tap overview with horizontally scrollable/expandable tap tabs; selecting Tap 6 shows only Tap 6 parameters while the timeline provides current head context. Implement overflow without page-scale shrinking; true hidden panels have zero footprint.

**Mapping:** exactly 139 generated parameters. The existing group IDs and their bindings in granular_delay/face.ts are authoritative. Support 12 pages: Loop, Medium, Tap times, Output, Tap1–8. Meters already include PitchRatio, Tap1–8Seconds, LoopPeak, ClockHz, Overlap, DuckGain, CloudDepth, LiveGrains, ActiveTaps, InputPeak and OutputPeak.

**Truth:** the active tap time labels must come from rendered delayed time, not just requested dial settings. The timeline should distinguish Tape vs Digital transport changes honestly. A decorative waveform cannot claim to be an analyzed incoming signal; either consume real read-only signal buffers or use an unambiguous neutral schematic.

## Art handoff needed before implementation
For each of these three:
1. Separate original approved desktop and phone images, not just a combined moodboard.
2. Component catalog with realistic knobs, indicators, states and scale-tick constraints.
3. Per-panel annotated geometry at 390/768/1440 widths, grouped control-to-ParamSpec mapping.
4. Typography/font licensing and legibility check; anti-aliased 1x and high-DPI captures.
5. Hard rejection list: missing/wrong parameter, invented hardware control, copied trade dress, fake telemetry, tiny labels, generic grid, knob direction inversion or unsupported phone layout.

## Visual review scorecard (owner must explicitly select/approve)
- Authenticity of hardware/engine visual grammar: target 4/5 or better.
- Clear distinctive identity, professional industrial-art execution: target 4/5 or better.
- Readability and control grouping on phone AND desktop: target 4/5 or better.
- Control fidelity / parameter count / semantic correctness: mandatory 100%, not an average.
- DSP-independent operation and no regressions in audio/presets: mandatory 100%.
- Current status: CANDIDATES ONLY. No approved design and no production UI changes in this checkpoint.

After owner approval: convert selected imagery into editable layered assets and responsive code using a dedicated visual-to-code process, then close the render against the unchanged source comp. Don't ship raw generative mockup pixels or their hallucinated controls.
