# CP04 G2.1B — Satin Material Study / Toggle Only

**Date:** November 3, 2026  
**Status:** **REVIEW CANDIDATE — UNAPPROVED**  
**Scope:** MW-CONTROL-006 toggle, from already-verified V2D six-part STEP/GLB assembly. No audio, DSP, parameter, DAW runtime or production work.

## What was actually produced

A reproducible G2 rendering source is committed at `design-assets/motionwave-ui-lock/g2/cp04_g2_repo_renderer.py`.

The renderer reads the **unchanged** six-part V2D GLB meshes (OFF and ON). It outputs transparent 1024×1024 PNG source previews, 96/160/256-pixel native-size variants, full-resolution 1080px RGBA captures, a comparison sheet, and machine-readable material profiles/manifest. Build and artifact integrity checks compare SHA-256 of the original OFF/ON GLBs before and after rendering to guarantee **no source-mesh modification**.

**The source and review ZIP are provided in the same development chat.** A dedicated [G2 review-only GitHub Action](../../.github/workflows/cp04-g2-material-review.yml) rebuilds six-part V2D CAD, renders the satin candidates from that model, verifies their alpha, dimensions and source preservation, and uploads temporary review evidence. These PNG artifacts are **not yet committed to the repository**. This workflow does not touch production.

## Material study profile (tentative VTK PBR inputs)

| Part                | Visual target                       | PBR roughness | Metallic factor |
| ------------------- | ----------------------------------- | ------------: | --------------: |
| Mount washer        | matte powder-coated metal           |          0.81 |            0.00 |
| Hex mounting nut    | subdued satin brushed metal         |          0.60 |            0.68 |
| Eyelet              | satin nickel, rolled edge highlight |          0.55 |            0.80 |
| Pivot ball and stem | restrained machined satin metal     |          0.47 |            0.72 |
| Free-end handle tip | warm matte phenolic polymer         |          0.76 |            0.00 |
| Lower cup           | low-sheen bearing housing           |          0.77 |            0.35 |

These are **shader study parameters**, not measured physical material properties. Partly metallic shader factors are deliberate appearance studies in a point-lit scene with no calibrated image-based environment; they are **not certified PBR measurements**. They are insufficient to declare authentic machined metal, phenolic pore structure or installed-glass optics.

## Geometry shading and texture findings

- The first G2.0 pass reduced excessive gloss but looked too uniform and dark. It is retained as an A/B baseline.
- Experimental G2.1 tangent-space normal maps produced visible **black UV/tangent-seam artifacts** on the spherical handle and the eyelet. That attempt was **REJECTED**, and its output must not be used as a candidate master.
- **G2.1B** replaces that fragile tangent-UV method with deterministic, low-amplitude 3D normal variation assigned _only to renderer normals_. It does not displace, repaint, or alter CAD geometry. In the inspected OFF/ON candidate board, the prior black seam artifacts were not apparent.
- Fine material realism is **still incomplete**: the phenolic is not yet a calibrated molded-polymer microtexture, metal machining direction is not fully physically anchored, and the scene has no measured HDRI studio environment. These remain explicit G2 blockers.

## Physical-size verdict

Actual **96, 160 and 256-pixel** isolated assets were rendered without CSS scaling. At 96px the eyelet and internal captured-ball features are difficult to distinguish; at 160px or above the silhouette improves. Cropping alone cannot manufacture visible subpixel detail. The eventual mobile design must allow enough visible artwork space while preserving a 44px or larger touch target. Do **not** mark G1 approved from a zoomed render.

## Acceptance/test boundaries

The material study shows honest progress on excessive gloss, material differentiation, softer edge reflection, and image export separation, but is **not** full G2 or G3 acceptance. It still requires:

- Geometry G1 owner approval at real plugin size.
- High-quality reference lighting, linear color-management/controlled exposure and final material swatches.
- Material-specific roughness textures and anisotropic machining grain that do not cause UV seams.
- Full-resolution 1x/2x/3x UI integration checks; actual iPhone/desktop viewing, and no unintended halos or alpha edges.
- Independent review against verified approved RFM-48 and TM Frey image masters, not remembered impressions.
- No merged/live asset substitutions until owner approval; no DSP/performance work.

**Next smallest step:** use the G2.1B study to refine physically anchored material normal/roughness fields, expose distinct highlight responses under a common softbox/HDRI rig, then obtain explicit owner appearance sign-off before propagating the treatment to the other two hero controls.
