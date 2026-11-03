# Motion Wave CP04 V2 — Physical Realism / Hero Asset Implementation Brief

**Checkpoint:** CP-UI-LOCK-004 V2
**Status:** specification for implementation, **not implemented or approved**
**Baseline:** `design-assets/motionwave-ui-lock/v1/`, `manifest-v1.json`, `controls-v1-review.svg`
**Prior quality references:** owner-approved RFM-48 controls and TM Frey UI. Inspect original approved source/render files when available; do not infer exact material or geometry from their names.
**Target set:** MW-CONTROL-001 (primary vintage knob), MW-CONTROL-006 (toggle), MW-CONTROL-007 (analog VU).
**Scope:** source artwork, physically plausible construction, controlled studio-light material response, edge softness, deterministic rendering and visual QA. No plugin integration or changes to DSP/parameters/presets.

## 0. Why V1 was rejected

The owner sees partially intersecting or floating components, invalid mechanical joins, overuniform cleanliness, unrealistic shiny/specular surfaces and hard vector boundaries that look unlike real manufactured objects. The repair is **geometry and assembly first, materials second, lighting third, final comp last**. Adding blur, grunge, strong drop shadows or noise over the existing shapes is prohibited as a substitute for corrected construction.

The next three heroes become the master quality bar before adapting the remaining five controls. **Do not batch-redesign all eight** or declare the family complete after producing a new contact sheet.

## 1. Non-negotiable manufacturing/occlusion rules

- Treat each control as a small manufactured assembly with a readable parts hierarchy: substrate/panel mounting surface → base hardware → body/shaft → pointer/needle → protective cover. Explicitly model or draw visible part boundaries. Never construct one object from crossing, disconnected front-facing polygons.
- Choose one consistent coordinate convention for all three: **+Z toward the viewer; panel surface Z=0; local up +Y**. Label each layer and describe which component is physically in front. Draw-order must match this construction; note transparent layers separately.
- Every moving part needs credible clearance around surrounding fixed components; use a **design-study starting clearance of approximately 0.5–2% of the relevant diameter** for visible adjacent parts, then adjust for material and projected scale. This is a visual tolerance, **not an engineering manufacturing specification**.
- Circular/rotational geometry must remain concentric unless the actual hardware deliberately offsets a pivot. Ribs, screws, nuts, cap, hub, detent ticks and pointer inserts cannot cross into each other arbitrarily. No floating trim, fused screws, impossible lever sockets, or needles appearing on top of protective glass.
- For meshes, enable bevels with small real radii and weighted/smooth normals where appropriate; eliminate coplanar faces, inverted normals, Z-fighting, self-intersections and boolean remnants. For SVG, use separate soft rolloff geometry rather than thick dark outlines masking topology mistakes.
- Before material work, produce **flat-grey front view, 3/4 view, side view, and exploded layer diagram** for each hero. Record part hierarchy and identify collisions. If topology is wrong, stop here.

## 2. Hero A — MW-CONTROL-001 primary molded vintage knob

**Functional assembly:** panel-printed tick ring (fixed, outside moving master) → mounting washer/base → outer skirt with real height → molded radial grip/ribbed sidewall → top cap with shallow curvature → physically recessed ivory indicator insert (moves with knob) → shallow contact shadow at panel interface.

**Starting normalized geometry (adjust against approved hardware references):**
- Let **D = finished outer knob diameter** and model from D, not random absolute pixel dimensions.
- Outer skirt radius ~0.50D. Top-cap visible radius ~0.39–0.44D; transition is a continuous fillet, not a hard nested-disc step.
- Visible sidewall/height ~0.12–0.19D in 3/4 view, with a clear seat and downward taper. Ensure the sidewall stays **behind** the cap silhouette.
- Rib depth ~0.015–0.035D; all ribs begin and end inside the sidewall band, never penetrate the top cap or tick marks. Repeating ribs may vary subtle microfacet reflections, **not radial placement or dimensions**.
- Indicator insert width ~0.018–0.028D, flush or slightly recessed in top cap. Add a hairline material seam and soft local occlusion; do not draw the indicator as a raised floating white stripe.
- Tick marks and frequency numbering belong to the **fixed panel/silkscreen layer**; the rotating knob source must not accidentally rotate its labels.

**Material identity:** dark phenolic/Bakelite-like molded polymer. Satin-to-low-sheen; broad soft highlights and slight mottled mold variation. Do **not** use metalness, chrome edges, oil-like gloss, repeated identical bright facet highlights or a mirror finish. Ivory pointer should be more matte than bare metal.

**Mandatory views/states:** top/front, 3/4 installed, side/clearance, isolated transparent RGBA; pointer positions 0%, 50%, 100% (or physically meaningful min/mid/max). The body does not distort or change size when pointer value changes.

## 3. Hero B — MW-CONTROL-006 toggle switch

**Assembly:** panel plane → threaded/bushed mounting hardware → face washer and nut (if exposed) → pivot socket/gimbal → metal lever shaft → distinct insulated or ivory ball tip → clearance shadow where lever enters the socket. Do not draw the shaft over the mounting plate as though it lacks a pivot.

**Geometry / positions:**
- Shaft axis originates inside the pivot, visible at every state; ball tip is attached, with a coherent taper and transition.
- Separate **OFF and ON geometry**; angle and height change about one physical pivot, not by free translation. A neutral/middle position is forbidden for a two-state source control unless its generated parameter has that third state.
- At either throw extreme, the lever, ball and surrounding recess must not intersect. Preserve believable space at the socket opening.
- Keep fixed plate shadows and screw locations unchanged between states; only the moving lever assembly changes.
- Provide installed front, 3/4, side and two-state overlay views. Diagram the pivot center and motion arc.

**Material identity:** muted brushed nickel/chrome shaft with *controlled* specular response; low-gloss satin mounted plate; warm matte porcelain-like or phenolic tip. The shaft may catch a narrow highlight, but the entire plate must not look polished like a mirror. Preserve a little metal machining variance without random scratches.

## 4. Hero C — MW-CONTROL-007 analog VU / gain-reduction meter

**Assembly, back to front:** sealed rear housing/recess → **flat printed scale card** → pivot post and mechanical stops → thin needle physically suspended in front of card → spacer/air gap → glass cover → gasket → front bezel and screws.

- Needle cannot pass through scale card, bezel, screws or protective glass. Pivot pin must land at the needle rotation center. Needle length must stay inside available dial clearance at both extremes.
- Scale ticks, divisions, numerals and calibration are printed and stationary. They must be consistent with the **actual future meter mode** (VU vs dB gain reduction); do not invent a final scale or use ambiguous values as authoritative.
- **Glass is the only appreciably specular large surface**. Reflection broad, soft and low opacity; do not lay a bright diagonal white streak across the scale or obscure the needle.
- Printed dial: lightly porous warm off-white stock, minimal aging, subtle edge vignette from the housing, no paper-grunge overlay.
- Front bezel: brushed/powder-coated muted metal with real chamfered edges and soft frame AO. Screws sit correctly on the frame, not overlapping glass.
- Create empty/no-data/static-preview and min/mid/max needle states. For design renders label needles **STATIC DEMO**. A future live needle must connect to actual DSP gain-reduction data and use appropriate meter ballistics; it cannot be a decorative oscillator.
- Include a cutaway layer stack and a render with glass hidden to verify needle placement.

## 5. Material calibration (starting ranges, not universal PBR truths)

Choose **one coherent physically-based lighting / color-management setup** and make materials differ through roughness, microgeometry and diffuse/specular balance. Values are exploratory Blender Principled BSDF starting points and must be judged by actual renders; they are **not fixed industrial material measurements**.

| Surface | Approx. roughness | Metallic | Required response / forbidden look |
| --- | --- | --- | --- |
| Molded phenolic/polymer | 0.48–0.72 | 0 | Soft broad highlight; subtle nonperiodic microvariation; never wet plastic |
| Rubberized/grip inserts | 0.65–0.88 | 0 | Light-absorbing fine relief; no uniform glossy ring |
| Brushed nickel/aluminum | 0.30–0.55 | 1 if exposed bare metal | Directional grain, broad controlled highlight; not chrome |
| Powder-coated chassis | 0.60–0.85 | 0 | Very fine matte particulate texture, rounded edge response |
| Ivory/painted pointer/tip | 0.52–0.76 | 0 | Warm diffuse material, low-gloss insert rather than glowing plastic |
| Glass cover | 0.08–0.22 | 0 | Real glass Fresnel; subtle room reflection, not a high-contrast glare bar |
| Printed legends/dial ink | 0.70–0.90 | 0 | Matte/surface-bound pigment, not extruded glossy type |

**Texture rule:** use restrained, mask-confined, mostly stochastic microtexture. No repeated obvious vector dots, full-sheet grain, heavy scratches, rust, artificial patina or identical “clean chrome” highlights on polymer/metal/glass. Surface imperfections must affect roughness and micro-normal more than base color. At final 1x displayed size, texture should read as material presence without becoming noise.

**Initial palette study, subject to real reference and owner review:**
- Polymer charcoal `#24282A`, shadow `#151A1C`, warm black `#343533`.
- Warm champagne aluminum `#B8B1A2`, nickel midtone `#858A89`, deep metal `#474E51`.
- Ivory/polymer insert `#D8CCB4`, printed warm white `#E4DECF`.
- Meter paper `#E5D8BA`, dark ink `#403B34`, constrained amber indication `#BD8A52`.
- Modern granular accent teal `#4FACA5` is **not** a blanket vintage-material tint. Use accents sparingly and consistently.

Avoid treating these HEX codes as physically measured material colors; calibrate scene exposure and reference display rendering first.

## 6. Lighting and realistic edge transitions

- Start with **one large softbox key top-left**, slightly in front and above; neutral low-intensity fill and a subtle environmental reflection. Lock camera and light rig across comparison renders. Suggested key-to-fill **2:1–4:1** as starting image luminance contrast (not a universal requirement).
- No blown white glints, neon bloom, strong fake outline strokes, over-crisp black “Illustrator” silhouettes, deep graphic-design dropshadows or uniform specular bands across dissimilar materials.
- Physical geometry should produce natural penumbra and chamfer highlight rolloff. Edge contours may be crisp in geometry but should not present an unnatural **hard black vector border** after rendering.
- At 1x scale, test **subpixel to ~1.5px antialiased edge transition** where physically appropriate; this is an output-inspection guide, **not an instruction to blur all boundaries**. Keep readable lettering and actual part seams crisp enough to remain usable.
- Apply soft contact AO only at real physical junctions. No floating gap shadows; no shadow leaked through transparent pixels or behind unrelated parts.
- Evaluate on both light and dark checkerboard backgrounds; check premultiplied-alpha fringes and halos at the visible perimeter.

## 7. Preferred production method and editable deliverables

For this realism checkpoint, **do not force all photorealism into primitive SVG gradients**. Prefer a reproducible hybrid pipeline:

1. Native editable physical master, ideally `Blender .blend` with named mesh/material collections, source textures and documented render settings. Keep the source and reproducible render script.
2. Export separate **transparent RGBA** body, moving indicator/lever/needle, cast shadow, optional glass and dial layers. Keep silhouette and pivot metadata explicit.
3. SVG remains authoritative for typography, tick scales, precise vector overlays and discrete UI states where these must remain crisp. If assets are 3D, do not pretend a flattened SVG is an editable 3D model.
4. Produce 2048px master exports for each square control and at least 1024px preview, plus exact-fit 1x/2x/3x production-density derivatives **after** size approval. Meter uses aspect-correct output rather than a stretched square.
5. Use linear-light or appropriate alpha compositing and verify no dark edge fringe on light or dark fascia. Keep RGB/alpha consistent across graphics pipeline.
6. No new runtime canvas, sprite atlas, VST view code or audio-thread work until owners approve V2 source and renders.

**Expected folder and file contract (new, no overwriting V0/V1):**

```text
design-assets/motionwave-ui-lock/v2/
  README_FIRST.md
  source/                 # editable .blend, source scripts, textures if any
  geometry/               # part hierarchy, pivot points, clearance diagrams
  materials/              # material swatches + calibrated render reference
  exports/
    MW-CONTROL-001/       # body, pointer, shadow, composites, min/mid/max
    MW-CONTROL-006/       # base, shaft, tip, shadow, OFF/ON
    MW-CONTROL-007/       # dial, needle, glass, bezel, static states
  review/                 # grey geometry + final controlled comparison boards
  manifest-v2.json        # provenance, files/hashes, states, light rig, approval flags
```

No source document should claim V2 files already exist merely because this brief names them.

## 8. Exact QA gates / reject conditions

**Gate G0 — references:** Locate and inspect **actual** RFM-48 knob master and TM Frey UI baseline where accessible. Record reference version/path/preview and visible material traits. If source is unavailable, mark benchmark **UNVERIFIED**; don't pretend a remembered image was directly reviewed.

**Gate G1 — geometry hard stop:** grey clay front/3/4/side and exploded diagrams of all 3; no visible intersections, floating components, impossible lever pivot, needle/glass collision, separated bezel or detached cap. A collision or occlusion error in any hero **blocks material shading**.

**Gate G2 — materials:** side-by-side standard-light render at common exposure; polymer is satin not metal, tip diffuse not glass, bezel metal not chrome, needle physical, glass subdued, microtexture nonperiodic and appropriately masked. No “one shiny shader for everything” look.

**Gate G3 — edge/shadow:** inspect 100%, 200%, 400% crops and nominal display size; no hard synthetic perimeter stroke, oversharpened halo, AO bleeding, alpha matte fringe, Z fighting or harsh light stripe. Do not hide geometry errors with blur.

**Gate G4 — state/art separation:** knob body identical at min/mid/max, only indicator/pointer state changes; toggle OFF/ON pivots around one fixed point; VU needle turns around a stable pivot below glass. All fixed elements remain perfectly registered.

**Gate G5 — display & integration safety:** physical-size previews at **390px mobile**, **768px tablet**, **1440px desktop**, plus 1x, 2x, 3x export inspection; touch target stays >=44px and original `ParamSpec` mapping preserved **without integrating this artwork**. No blurry scaling or clipped pointer.

**Gate G6 — review:** create side-by-side V1 vs V2 and, when available, RFM-48/TM Frey references; include each hero's clay, material, lit render, alpha composite, and failure notes. Manual owner approval **separate for 001, 006 and 007**. No auto-approval from CI green or aesthetic scoring.

**Acceptance rubric, in addition to all hard stops:** geometry/assembly 30%, materials 25%, light/edge 20%, control legibility/physical-size 15%, asset editability/state integrity 10%. Each area must score at least **4/5** in review, and all geometry collisions must be zero. Scores are reviewer judgments, not an automated evidence substitute.

## 9. Build and review order (minimal waste)

- **V2.0 Geometry audit:** freeze V1 archive and reference inventory, define coordinate conventions, list intersections, generate clay views for all 3. Stop on collisions.
- **V2.1 Knob hero:** build 001 and compare at native sizes. Owner material/form signoff before duplicating polymer shader.
- **V2.2 Switch hero:** build 006 using the same light rig but distinct machined/insulating surfaces; verify moving pivot and socket clearance.
- **V2.3 Meter hero:** build 007 with legible real part stack, truthful static/demo label and understated glass.
- **V2.4 Package/QA:** render separate RGBA parts, responsive size tests, image comparison sheets, checksums, reproducible source and manifest; report remaining defects and keep candidate status.

**Hard prohibition until explicit approval:** merging to default, deploying production, substituting assets into the existing DAW, altering audio/DSP/automation/parameters or beginning performance tuning.

## 10. Agent reporting contract

For each substep, report:
- Commit SHA and branch; exact created/modified files.
- What was physically wrong in V1 and how the construction changed.
- Clay/front/3/4/side and final lit image references, with genuine dimensions.
- Collision test result (and any still-unverified aspects); material/roughness choices and changes.
- Responsive 1x/2x/3x capture outcomes; alpha and state-pivot verification.
- Source-editability/provenance and which tests genuinely executed.
- Owner approval state (default **NOT APPROVED**); next smallest actionable step.

Do not write vague descriptions like "higher quality" or "realistic now" without a corresponding rendered artifact and before/after proof.
