# CP04 V2.1A — First matte/satin material trials (design study, unapproved)

**Status: IMPLEMENTED RENDER STUDY; NOT FINAL ASSETS AND NOT OWNER APPROVED.** Stacked on CP04 V2.0C geometry branch/PR #13. The existing DAW runtime and UI source files are untouched, with no DSP or automation changes.

## Actual work completed here

- Tested the 4 unchanged V2.0C GLB assemblies (knob, toggle OFF, toggle ON, and meter) under a consistent soft studio lighting setup. Geometry SHA-256 IDs and counts are registered in [materials.json](../../design-assets/motionwave-ui-lock/v21a/materials.json).
- Implemented a Python VTK/Pillow/NumPy/Scipy preview pipeline to render distinct phenolic, ivory, nickel, satin metal, powder-coated chassis, paper, glass and printed ink treatments. **This is a Phong preview and is NOT a physically-calibrated PBR or Blender shader.** The numeric roughness targets in the manifest are prospective material settings, not validated measured values.
- Deliberately avoided the V1 design's uniformly shiny reflections. Added low-strength stochastic fine variation **only within visible material masks**, rather than across the entire picture. Colorful detail is confined to glass/dial/ivory where appropriate.
- Repaired two **renderer normal artifacts**, not CAD geometry: (1) radial wedge lighting across the metal toggle retainer, by preserving sharp manufactured transitions instead of averaging normals across the inner wall and top surface; (2) black triangular shading near the knob's physically recessed ivory slot, by preserving that cap surface break.
- Generated a six-view 2400×1600 material study board, separate VU paper and **editable SVG** concept-only printed scale, four transparent RGBA review exports (900×700), 8 lit view images, and a relative-width mobile/desktop asset-footprint study. These are **renderings and scaled asset previews**, not real phone/desktop plugin screenshots, and no live DSP data is visualized.
- Independent checker passed **25 checks**, including byte-identical V2.0C source meshes, 3/5/5/10 watertight named-node models, exact OFF/ON fixed-toggle registrations, alpha transparency/border integrity and requested asset display footprints.
- Complete 35-file original-source/GLB/PNG/SVG/checksum ZIP is supplied in the ongoing ChatGPT development chat at **MotionWave_CP04_V21A_Material_Trial_Complete.zip**. GitHub stores the material recipe and checkpoint specification; it does **not** yet contain that binary ZIP or the full 20k-line-character source renderer. Do not claim a repository-only checkout reproduces the study until those files are imported.

## Human visual findings (recorded as defects, not hidden)

| Asset                       | Improvement seen                                                                                                                              | Remaining blocker                                                                                                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MW-CONTROL-001 vintage knob | Matte phenolic surface, softer lighting, true inset pointer, no black triangular normal artifact                                              | **FAIL quality gate**: compared with user-provided RFM-48 master, grip ribs are still rounded/scalloped and much less convincingly molded, sidewall/part profile is simplified, physical texture lacks subtle individual tooth edges |
| MW-CONTROL-006 toggle       | Metallic socket no longer has unrealistic radial shading streaks; ivory distal ball, true spherical pivot/shaft and matte nut/washer distinct | Owner eyelet ball visibility/proportion approval still outstanding; closeup metal/spherical transition quality needs a final reference review                                                                                        |
| MW-CONTROL-007 VU           | Muted powdercoat bezel, porous warm dial, low-gloss glass, printed card and independent static needle                                         | **Concept-only dial, deliberately uncalibrated**; real meter response, scale labels, ballistics and hardware host placement have not been implemented                                                                                |

No owner approval has been inferred. The G1 geometry gate remains **open**. G2 material exploration can proceed in isolation, but **no asset replacement, UI lock, merge or audio changes** until explicit source-art/geometry approval.

## Verified package paths

```text
review/CP04_V21A_Six_View_Material_Review.png
review/CP04_V21A_Native_Size_390_1440_QA.png
review/CP04_V21A_RFM48_Quality_Gap.png
materials/CP04_V21A_Material_Palette.png
materials/VU_scale_overlay_EDITABLE.svg
exports/knob_V21A_RGBA_STUDY.png
exports/toggle-off_V21A_RGBA_STUDY.png
exports/toggle-on_V21A_RGBA_STUDY.png
exports/vu_V21A_RGBA_STUDY.png
source/render_material_trials.py
source/make_native_qa.py
qa/render_report.json
qa/independent_check.json
MANIFEST.json
```

## Next smallest implementation step

**CP04 V2.1B = knob manufacturing fidelity**: fix the 24 smooth existing lobes into physically modeled, slightly radiused raised grip teeth with correctly curved shoulder and contact edges; preserve the true recessed ivory inlay. Update normalized shaft/silhouette inspection, verify watertight geometry with all-part collision tests, and re-render matte material under the **same** lighting. Compare at actual 72/84 CSS-pixel knob footprints and full-resolution 3/4 closeup against the approved RFM-48 reference. Once acceptable, refine the eyelet and meter while retaining material independence.

Do not ship or merge the source-art trial into the live DAW or begin DSP performance changes. Use draft PR workflow with explicit reviewer evidence.
