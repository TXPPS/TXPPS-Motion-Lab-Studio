# CP04 V2.0 — Physical Geometry Checkpoint

**Date:** 2026-11-03 · **Status:** GREY MODEL CANDIDATE · **Owner approval:** NOT GRANTED
**Parent:** CP04 V2 material-realism specification and V1 source-asset PR #12
**Scope:** three hero assemblies only; the DAW runtime, DSP, VST plugin and published site are unchanged.

## Actual work completed in this chat

A reproducible parametric Python implementation using `trimesh`, NumPy and headless VTK generated **four editable named-node GLB scenes** (knob, toggle OFF, toggle ON, VU meter), **16 independent construction renders** (front, 3/4, side and exploded, with both toggle states), and a 2400×1820 inspection board.

The complete `MotionWave_CP04_V2_Geometry_Package.zip` is attached in the same development conversation; it contains the executable `source/build_cp04_v2_geometry.py`, an independent verification script, .glb models, PNG evidence, measurement report and SHA-256 manifest. This GitHub checkpoint records their verified dimensions and acceptance status. **The binary GLBs and generated PNGs are not yet stored in this repository**; do not claim a repository-only checkout can regenerate those assets until the complete generator is added to version control.

## Asset-level construction

| Asset | Editable mesh nodes | Grey-model changes |
| --- | ---: | --- |
| 001 knob | 3 | Separate washer and near-flush indicator; cap, shoulder, rounded skirt, and 24 smoothly tapered molded grip lobes form one continuous watertight shell |
| 006 toggle OFF/ON | 5 in each state | Washer, true center-bored hex nut, hollow pivot socket, rotatable shaft, attached insulating tip; the fixed pivot and mount are identical in both throws |
| 007 analog VU | 10 | Back housing, flat printed-card placeholder, needle, pivot hub, glass, continuous hollow bezel, four mounted screws; correct Z-order of card / needle / cover |

**Shared convention:** nominal concept dimensions in millimeters, +Z toward viewer, panel Z=0, +Y up. These are geometric study dimensions, not validated physical manufacturing tolerances.

## Quantitative checks (all 13 initial analytic assertions passed)

- Knob body Z bounds **1.0–7.96mm**; washer top 0.72mm. Maximum rib radius **17.899mm**; total design outer diameter about **35.94mm**. Rib modulation tapers toward the cap rather than abruptly intersecting the shoulder.
- Near-flush marker upper edge **7.9925mm** against top **7.96mm**. The final recessed pocket has **not** yet been cut: treat as a known geometric fidelity defect.
- Toggle throw **±21°** about fixed pivot Z **2.90mm**; minimum calculated shaft-to-bore clearance **0.8718mm** in each state. OFF and ON side projections were independently compared and are different.
- VU card top **2.40mm**, needle axis **2.84mm**, glass underside **3.57mm**; VU needle length **29.30mm** inside the opening. Four screws located outside the glass aperture.
- All four exported scenes load with expected **3 / 5 / 5 / 10** separately named, watertight, positive-volume meshes. Their deliberately mating surfaces (tip/shaft, pivot/needle, screws/bezel) are recorded as expected joints.

## What these checks do NOT mean

The workspace has no full mesh Boolean collision solver installed. Therefore these are **analytical envelope, watertightness, placement and 2D-state checks**, not exhaustive mesh-to-mesh/self-intersection or swept-volume collision proof. The knob pointer is a surface-flush proxy awaiting a physically cut recess. The VU scale is deliberately absent, and all needles are static. The geometry does NOT yet meet the CP04 V2 G1 acceptance gate. No polished material textures, 2048px masters or final assets have been approved or shipped.

## Baseline inspection

The earlier, user-approved RFM-48 knob reference image was inspected. The ribbed molded surface and inlaid pointer inform the physical construction benchmark. Exact TM Frey reference artwork was **not verified** in this container. Do not claim an apples-to-apples material comparison between that finished photo-style reference and the V2 *grey clay* model.

## Next smallest correction — V2.0B geometry hardening

1. Boolean-cut a true pointer recess in knob cap; retain watertightness, radius-controlled fillets, no floating indicator.
2. Add true solid-solid overlap checks and classify intentional mechanical fits vs impossible penetrations, including continuous toggle throw sweep, meter glass/needle and frame-screw seating.
3. Improve VU frame corner radii and screw seating, and refine knob side-wall lobe shoulder termination against the RFM-48 physical reference.
4. Render neutral clay on dark/light substrates with dimension/pivot overlays, review any remaining geometry defects here, then request explicit **G1** approval.
5. Only after G1 is owner-approved, proceed to G2 material roughness/microtexture, G3 lighting/edge realism and G4–G6 responsive/layer/asset review.

**DO NOT MERGE/DEPLOY**: No production UI modifications, no parameter/automation/preset changes, no DSP/performance change. This PR is a geometry checkpoint, not a declaration of commercial visual quality.
