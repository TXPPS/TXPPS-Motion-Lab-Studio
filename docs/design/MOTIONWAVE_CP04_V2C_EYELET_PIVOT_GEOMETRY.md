# CP04 V2.0C — Toggle Eyelet Spherical Pivot Correction

**Status:** construction-only grey-model candidate; **NOT OWNER APPROVED**.  
**Date:** November 3, 2026.  
**Parent:** [V2.0B geometry hardening](MOTIONWAVE_CP04_V2B_CAD_GEOMETRY_HARDENING.md).  
**Live DAW/runtime:** unchanged. No DSP, parameter IDs, automation, presets, or deployed GUI changed.

## User-identified defect and exact correction

V2.0B contained a rounded **distal insulating ball** at the far end of the toggle handle, but the **lower metal spherical pivot ball inside the bezel eyelet** was missing. The lever entered an open-looking socket, making the hardware visually and mechanically implausible.

V2.0C now constructs the two independent ends correctly:

- **Proximal metal pivot joint:** radius **2.30 mm**, centered on the fixed pivot at **Z=2.90 mm**. The metal ball and shaft are fused as **one watertight CAD solid** rather than stacked intersecting mesh shells.
- **Real retaining eyelet:** lathed/revolved CAD ring with variable inner bore; outer radius **4.75 mm** and upper retaining mouth radius **2.12 mm**. The upper mouth is smaller than the pivot ball so the ball remains visually captured within its socket.
- **Distal handle ball:** retains the separate insulating cap already present in V2.0B; it was not the part identified as missing.
- **Pivot travel:** ±21° about the same stationary joint in OFF and ON; fixed washer, nut and eyelet meshes are identical between the two positions.
- **Tessellation:** fine OpenCascade tessellation with degeneracy filtering; preserve watertight and winding-consistent exported GLBs.

All dimensions are **nominal study geometry**, not a certified manufactured switch design.

## Verified results and falsification checks

The latest build and **independent** verifier completed in this development chat:

- **15/15 named geometry checks passed** across knob, switch, and VU.
- **85 CAD actuator poses** swept from -21° through +21°: **0 mm³** solid common volume between moving ball/shaft and stationary eyelet.
- Approximate minimum radial shaft-to-lip gap at extreme throw: **0.1318 mm**. This estimate is not a real-world tolerance or durability certification.
- The ball diameter **4.60 mm** exceeds the eyelet mouth diameter **4.24 mm**; visible ball cap extends approximately **0.95 mm** above mouth plane.
- OFF/ON GLBs each have **five independently named watertight meshes**, including the monolithic metal ball/shaft and separate insulated free-end ball.
- **Negative fault injection #1:** substituting an oversized pivot ball (radius **2.65 mm**) produces a detected CAD intersection of **4.98236 mm³**.
- **Negative fault injection #2:** lowering the knob inlay by **0.10 mm** produces detected exported-mesh intersection segments; normal inlay has zero.
- Existing knob and VU mesh construction is **unchanged from V2.0B** and its critical clearances are rechecked; no silent styling changes to those units.

**Verification boundary:** these are exact CAD common-solid and selected exported triangle mesh checks. They do **not** prove all-pairs self-intersection freedom, long-term stress performance, production tolerances, or the suitability of the toggle for physical fabrication.

## Source, evidence and provenance

- **GitHub-tracked:** `design-assets/motionwave-ui-lock/v2c/toggle_cad_standalone.py`, a standalone toggle CAD source generator that produces OFF/ON named GLBs and replays the 85-position intersection and negative fault checks with CadQuery, NumPy and trimesh.
- **Conversation package:** `MotionWave_CP04_V2C_Eyelet_Ball_Pivot_Complete.zip`, containing 40 files: full inherited baseline + V2C geometry and verification scripts, four named editable GLB scenes, 16 construction views, additional high-resolution toggle views, real V2.0B-versus-V2.0C closeups, test JSON and SHA-256 manifest. ZIP checked and manifest hashes verified after packaging.
- **Key review image:** `review/CP04_V2C_Toggle_Eyelet_Pivot_Closeup_Comparison.png`, a close-up comparison of the former open eyelet and the new OFF/ON ball-in-socket assembly. All images are **real geometric renders**, not AI-styled images. The model package is supplied in the ongoing ChatGPT development conversation and is **not yet mirrored to GitHub as binary assets**.

## Remaining G1 owner-approval blockers

- Independently review new eyelet-ball visual proportions and readibility at actual plugin display sizes. The ball is deliberately visible above the retaining lip; owner approval is **not inferred** from test passes.
- Improve remaining geometry shading artifacts and visually inspect the spherical-to-shaft transition. A technically valid Boolean fusion may still require a **blended manufactured fillet** to look convincing.
- Complete all-pairs collision/containment and, if the source is intended as true hardware CAD, inspect tolerance under motion and load. Keep separate from DAW GUI concerns.
- Realistic satin materials, brushed finish, subtle microtexture, glass, and soft highlight rolloff are **G2/G3**, not implemented in V2.0C.
- Do not merge to production or declare UI Lock completed. The existing DAW remains functional and unaffected.

**Next smallest step:** owner-side G1 silhouette check for this eyelet joint. Then correct remaining shader/fillet issues in geometry and proceed to G2 material prototypes only after physical geometry is accepted.
