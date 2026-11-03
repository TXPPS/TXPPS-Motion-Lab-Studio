# CP04 V2.0B — CAD-Hardened Geometry Checkpoint

**Date:** 2026-11-03 · **Status:** **GREY-MODEL CANDIDATE ONLY; NOT OWNER APPROVED**
**Parent:** [CP04 V2.0 grey-model checkpoint](MOTIONWAVE_CP04_V2_GREY_GEOMETRY_CHECKPOINT.md)
**Source of truth:** the `MotionWave_CP04_V2B_CAD_Hardened_Geometry_Package.zip` generated in this MotionLab development chat; 31 files, 2,227,837 bytes, with manifest SHA-256 values. **This repository currently stores the checkpoint report; the GLB/PNG/Python package remains provided as a separate chat artifact.**

## Actual changes, not proposed tasks

| Asset | V2.0 limitation | V2.0B corrected geometry and evidence |
| --- | --- | --- |
| MW-CONTROL-001 primary knob | Ivory pointer was effectively an overlay, not a genuine cut | Removed an actual **0.50 mm**-deep rounded-capsule recess from the top cap mesh; cut removes **4.7159 mm³**; independent ivory inlay is fitted **0.085 mm below** cap top, with **0.085 mm nominal side gap**. The continuous 24-lobe molded skirt profile remains watertight. |
| MW-CONTROL-006 toggle | Small unsupported-looking gaps between fixed washer, hex nut and pivot housing | Fixed parts are directly seated at Z boundaries **0.85 / 2.50 mm**. The moving shaft pivots at Z=**2.90 mm**, through **±21°**. Exact OpenCascade BRep intersection tested at **85 poses**: zero common solid volume, minimum radial clearance **0.8718 mm** at outer throw. |
| MW-CONTROL-007 meter | Square-cornered frame and loosely placed dial/glass | Rebuilt bezel with a continuous rounded/filleted CAD ring and small top chamfers; card now seats in housing; true glass/aperture clearance **X=0.45, Y=0.40 mm**. Needle Z=2.50–3.18 remains between card top 2.40 and glass underside 3.57. |

## Verification executed

**18 named geometry assertions pass:**
- 5 knob topological, pocket volume and inlay fit checks (K-B01–K-B05).
- 4 toggle CAD-mounted component, state registration and moving-throw checks (T-B01–T-B04).
- 4 meter CAD/part thickness, seating, bezel and needle/glass checks (M-B01–M-B04).
- 5 additional **actual exported GLB triangle-surface** crossing checks on the knob/body, both shaft/socket states, meter glass/bezel and needle/glass pairs (K-B06, T-B05–T-B06, M-B05–M-B06).

Independent verification reloads the 4 GLB files, confirms **3/5/5/10 independently named watertight positive-volume meshes**, and validates 16 real rendered clay views. A **deliberate -0.1 mm pointer penetration fault** produces detectable intersection segments; the passing zero-collision test is therefore not merely a constant or decorative assertion.

**Method boundary:** OpenCascade exact BRep common-volume checks on matching analytic CAD parts, plus VTK triangle-surface crossing checks on selected **actual exported** GLB mesh pairs. This does **not** certify all-pairs mesh containment, every triangle-triangle self-intersection, real-world tolerances, or manufacturing fit.

## Visual evidence and reproducibility

All included in downloadable chat ZIP:
- `source/base_v20.py` — baseline scene/VTK renderer with corrected normal splitting on sharp boundaries.
- `source/build_cp04_v2b.py` — pocket mesh surgery, CAD-rounded VU frame, tolerance changes, CAD intersection sweep, 16 views.
- `source/verify_cp04_v2b.py` — independent positive checks and deliberate negative/fault-injection test.
- `models/*.glb` — named editable 3D assemblies (no Blender master falsely claimed).
- `review/CP04_V20_vs_V20B_Actual_Comparison.png` — actual previous vs current renders (not AI-generated stock art).
- `review/CP04_V2_Three_Hero_Grey_Geometry_Review.png` — full 16-view construction board.
- `geometry/v2b_geometry_checks.json`, `geometry/construction_notes.md`, `MANIFEST.json` — values, limitations, file hashes.
- Unmodified user-provided RFM-48 knob reference included for checking the physical construction quality target.

Run `python source/build_cp04_v2b.py` and then `python source/verify_cp04_v2b.py` with NumPy, SciPy, Shapely, CadQuery/OpenCascade, trimesh, VTK and Pillow. No audio/VST project build or host regression test is claimed from this package.

## Remaining G1 blockers and next roadmap step

- This is **grey geometry**. No satin polymer, brushed metal, physically based roughness, PBR studio lighting, high-resolution transparent master or animated meter layer is finished.
- Complete all-pairs non-mating mesh self-intersection/containment audit and real-device UI integration tests remain outstanding.
- Explicit visual review/signoff of front/3/4/side/exploded geometry remains mandatory before locking G1 and proceeding to G2/G3 materials/lighting.
- Preserve all V0/V1 and V2.0 assets, DSP algorithms, generated parameter IDs, automation, project storage and production deployment. This is **not merged and not live**.

Do not claim aesthetic approval or manufacturing accuracy solely from successful tests.
