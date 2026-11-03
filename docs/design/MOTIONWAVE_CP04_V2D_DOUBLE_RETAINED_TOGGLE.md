# CP04 V2.0D — Double-Retained Toggle Hardware

**Date:** November 3, 2026  
**Checkpoint:** CP04 V2.0D / G1 geometry review  
**Status:** UNAPPROVED CANDIDATE — no production DAW, DSP or preset changes.

## Physical mistake discovered in the previous revision

The V2.0C eyelet included a metal pivot ball and a smaller _upper_ lip, but lacked a complete lower captured bearing. The cutaway demonstrated that the ball appeared insufficiently supported from underneath. A visually attractive spherical joint is not enough: it must have a coherent retaining assembly and correctly attached terminal handle.

## Actual V2.0D geometry implemented

- **MW-CONTROL-006** toggle now has **six separately editable CAD components**, up from five: an upper washer, chamfered/bored hex nut, lathed eyelet with a softened lip, one-piece spherical pivot and shaft with a true 0.30 mm junction fillet, a separate insulating ball with **blind axial bore**, and a lower retaining cup with an under-panel support flange.
- The two pivot retaining apertures have nominal diameters **4.24 mm** (top) and **2.92 mm** (bottom), both smaller than the **4.60 mm** spherical pivot ball. The lower cup is designed to be captured mechanically underneath the mounting hardware, without intersecting the pivot ball.
- The insulated free-end ball is **not** the ball inside the eyelet; it is an independent component. The blind bore has a nominal **0.05 mm radial clearance** around the metal shaft.
- The shaft preserves **±21°** throw around a fixed pivot. Fixed hardware is identical across OFF/ON.
- The previous V2.0C silhouette is preserved as a **reconstructed reference**, not passed off as the former original PNG file.
- Original render evidence includes installed front/three-quarter/side, cutaway, exploded, transparent RGBA, comparison board and a labeled geometric section diagram.

## Reproducibility and test evidence

**Repository source:** `design-assets/motionwave-ui-lock/v2d/cp04_v2d_repo_generator.py` creates six-component native **STEP** and Blender-importable **GLB** versions of OFF and ON using only CadQuery, NumPy and trimesh. It also runs **14 CAD checks** in the verified development environment, including:

- Fixed hardware non-penetration and ball clearance to **both** retainers.
- An 85-position analytical shaft clearance sweep, plus exact fused/filleted CAD solid checks at **OFF, center and ON**.
- A negative fault test for an oversized pivot ball and a negative test for a handle ball with no axial bore.

**Review package:** `MotionWave_CP04_V2D_G1_Geometry_Review.zip` is supplied directly in the development chat. It contains 37 original files: the standalone CAD generator above, additional full clay render/measurement source, STEP and GLB assemblies, independent QA outputs, high-resolution PNGs and SHA-256 manifest.

In the same development environment, independent verification also passed **13 checks** including 30 installed CAD part-pair solid-overlap comparisons across OFF and ON, STEP/GLB per-part counts (six each), watertightness and unchanged fixed geometry, negative-fault sensitivity, alpha channel and OFF/ON visual difference. These test sets have overlapping purposes and should not be treated as 27 fully independent safety claims.

**Important:** the complete rendered binary review ZIP is **not** stored in GitHub; only the standalone reproducible CAD source and this authoritative report are committed. Do not claim full mesh source and PNGs were pushed.

## G1 visual review and limitations

The CAD source and model checks improve the physical credibility of the toggle, but the G1 owner review is **not** passed automatically. Technical inspection still needed:

- Retainer silhouette and exposure of the ball at actual desktop and phone display sizes.
- Visual checking of seam transitions, render mesh normals and part occlusion on neutral grey clay, especially at the eyelet rim.
- Check physical legibility of fixed washer, nut and lower retainer in actual plugin framing, not just zoomed CAD.
- No load or long-term durability simulation, verified manufacturing tolerances, exact real-hardware dimensional correspondence or all possible dynamic interference proof is claimed.

**Decision boundary:** do not merge to default, deploy, change parameter IDs, rewrite automation or tune DSP from this geometry PR. When G1 is explicitly accepted, proceed to G2/G3 material response and lighting: low-sheen phenolic polymer, brushed/satin metal, soft edge rolloff and restrained glass reflections. No high-gloss generic plastic surfaces.
