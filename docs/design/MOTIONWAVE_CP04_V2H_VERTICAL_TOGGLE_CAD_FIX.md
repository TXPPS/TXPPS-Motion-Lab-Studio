# CP04 V2H — Fix the actual toggle CAD, not its screenshot

**Status:** editable geometry fix, review-only, owner approval not yet granted.

## Source modification

The authoritative generator at `design-assets/motionwave-ui-lock/v2d/cp04_v2d_repo_generator.py` now exports a **vertical YZ-plane toggle**. The faceplate is XY, the front camera points from +Z toward the panel, and +Y is visually up.

- `ON` (positive 21 degrees) = **lever UP**.
- `OFF` (negative 21 degrees) = **lever DOWN**.
- The lever and insulating ball remain attached to the center captured pivot. The fixed hex nut, washer, eyelet and lower retainer remain unchanged.
- OpenCascade did not accept the original shaft-to-pivot fillet when directly constructing the new Y-axis form. The source therefore builds the previously verified solid in XZ and applies a **rigid +90-degree Z-axis CAD rotation** to the finished moving solid. This changes the actual editable model geometry, not just the camera or an image.
- The GLB / STEP filenames are retained for downstream V2G front-view import compatibility. Existing pre-V2H binary models must be REGENERATED from this updated source and must not be reused.

## Reproduce and verify (no images)

Run from the repository root:

```sh
python design-assets/motionwave-ui-lock/v2d/cp04_v2d_repo_generator.py audit-out/cp04-v2h
python scripts/qa/verify-cp04-v2h-vertical.py audit-out/cp04-v2h
```

The generator performs **18 native CAD checks**, including 85 intermediate shaft poses, exact solid clearances, OFF/ON Y-axis displacement, centered X position and unchanged depth. The separate verifier reads the **exported STEP/GLB files**, verifies their existence and six watertight named meshes, checks that the physical insulating tip is below the pivot in OFF and above it in ON, and confirms the fixed mounting hardware has matching dimensions. The repository CI publishes the CAD only as a temporary review artifact.

## Scope and safety

- NO images, generic SVG assets, new mockups, rendering or DAW/UI/DSP code changes.
- A prior V2G preview/ZIP built before this fix should **not** be treated as proof of the corrected CAD. Rebuild any image assets later from this new geometry.
- No VST control state or parameter wiring altered. This is geometry and automated geometry QA only.
- Keep the PR **draft** until mechanical owner review, Blender/Cycles quality and genuine mobile/desktop UI signoff.
