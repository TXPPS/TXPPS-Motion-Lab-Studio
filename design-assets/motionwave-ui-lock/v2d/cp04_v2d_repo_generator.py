#!/usr/bin/env python3
"""MotionWave CP04 V2H: front-face vertical throw correction of six-part V2D CAD.

A design/review asset only. No VST, parameter, automation, project, or DSP code.
Usage: python cp04_v2d_repo_generator.py [output_dir]
Dependencies: cadquery, numpy, trimesh.
"""
import itertools
import json
import math
import sys
from pathlib import Path

import cadquery as cq
import numpy as np
import trimesh

PIVOT_Z = 2.90
PIVOT_RADIUS = 2.30
EYELET_MOUTH_RADIUS = 2.12
LOWER_MOUTH_RADIUS = 1.46
SHAFT_RADIUS = 1.47
HANDLE_BORE_RADIUS = 1.52
MAX_THROW = 21.0


def eyelet():
    return (cq.Workplane('XZ').moveTo(4.75, 2.50).lineTo(4.75, 4.025)
        .threePointArc((4.695, 4.183), (4.53, 4.25))
        .lineTo(2.12, 4.25).lineTo(2.12, 4.025)
        .threePointArc((2.161, 3.825), (2.310, 3.670))
        .threePointArc((2.443, 3.518), (2.48, 3.38))
        .lineTo(2.48, 2.50).close().revolve(360, (0, 0), (0, 1)))


def lower_cup():
    return (cq.Workplane('XZ').moveTo(4.25, -.42).lineTo(4.25, .15)
        .lineTo(3.05, .15).lineTo(3.05, 2.43).lineTo(2.44, 2.43)
        .threePointArc((2.21, 1.78), (1.75, 1.15))
        .lineTo(1.46, .82).lineTo(1.46, -.42)
        .close().revolve(360, (0, 0), (0, 1)))


def washer():
    return (cq.Workplane('XY').circle(9.1).circle(3.2).extrude(.70)
        .edges('>Z').fillet(.12).translate((0, 0, .15)))


def nut():
    return (cq.Workplane('XY').polygon(6, 13.6).circle(3.3).extrude(1.65)
        .edges('>Z').chamfer(.16).edges('|Z').fillet(.12)
        .translate((0, 0, .85)))


def axis(degrees):
    a = math.radians(degrees)
    # Physical front camera is above +Z, screen-up is +Y.
    # ON (+angle) moves UP; OFF (-angle) moves DOWN; never sideways.
    return cq.Vector(0, math.sin(a), math.cos(a))


def _construction_axis(degrees):
    """Build the proven filleted pivot in its canonical OpenCascade XZ plane.

    The sphere/shaft fillet crosses a kernel seam when constructed directly
    in YZ. A rigid +90-degree Z rotation preserves the validated manufactured
    solid while changing the *actual exported CAD*, not merely its camera.
    """
    a = math.radians(degrees)
    return cq.Vector(math.sin(a), 0, math.cos(a))


def _orient_to_front_vertical(solid):
    return solid.rotate((0, 0, 0), (0, 0, 1), 90)


def moving_joint(degrees):
    origin = cq.Vector(0, 0, PIVOT_Z)
    d = _construction_axis(degrees)
    sphere = cq.Workplane('XY').sphere(PIVOT_RADIUS).translate((0, 0, PIVOT_Z))
    shaft = cq.Solid.makeCylinder(SHAFT_RADIUS, 14.15, origin + d.multiply(1.05), d)
    combined = sphere.union(cq.Workplane('XY').newObject([shaft]))
    # The seam may be emitted as CIRCLE or BSPLINE depending on throw angle.
    seam = combined.edges().filter(
        lambda e: 9.2 < e.Length() < 9.3 and (e.Center() - origin).Length < 3.0
    )
    assert seam.size() == 1, 'missing or ambiguous shaft-to-ball fillet seam'
    combined = seam.fillet(.30)
    assert len(combined.solids().vals()) == 1 and combined.val().isValid()
    return _orient_to_front_vertical(combined)


def insulating_tip(degrees):
    origin = cq.Vector(0, 0, PIVOT_Z)
    d = _construction_axis(degrees)
    center = origin + d.multiply(16.2)
    cap = cq.Workplane('XY').sphere(3.35).translate((center.x, center.y, center.z))
    bore = cq.Solid.makeCylinder(HANDLE_BORE_RADIUS, 4.45,
                                  origin + d.multiply(11.6), d)
    part = cap.cut(cq.Workplane('XY').newObject([bore]))
    assert part.val().isValid()
    return _orient_to_front_vertical(part)


def parts(degrees):
    return [
        ('fixed_washer', washer()),
        ('fixed_bored_hex_nut', nut()),
        ('fixed_turned_eyelet', eyelet()),
        ('moving_pivot_ball_shaft', moving_joint(degrees)),
        ('moving_blind_bored_insulating_tip', insulating_tip(degrees)),
        ('fixed_lower_retainer_cup', lower_cup()),
    ]


def overlap(a, b):
    return float(a.intersect(b).val().Volume())


def mesh(shape):
    vertices, faces = shape.val().tessellate(.045, .140)
    verts = np.asarray([(v.x, v.y, v.z) for v in vertices], dtype=float)
    faces = np.asarray(faces, dtype=int)
    normals = np.cross(verts[faces[:, 1]] - verts[faces[:, 0]],
                       verts[faces[:, 2]] - verts[faces[:, 0]])
    m = trimesh.Trimesh(vertices=verts,
        faces=faces[np.linalg.norm(normals, axis=1) > 1e-12], process=True)
    if m.volume < 0: m.invert()
    assert m.is_watertight and m.is_winding_consistent and m.volume > 0
    return m


def save_parts(geometry, target, name):
    s = trimesh.Scene()
    assy = cq.Assembly(name='MotionWave_CP04_V2D')
    for label, shape in geometry:
        assert shape.val().isValid()
        s.add_geometry(mesh(shape), node_name=label, geom_name=label)
        assy.add(shape, name=label)
    (target / (name + '.glb')).write_bytes(s.export(file_type='glb'))
    assy.save(str(target / (name + '.step')), exportType='STEP')
    return len(s.geometry)


def validate():
    tests = []
    def test(label, passed, info=None):
        if not passed: raise AssertionError(label)
        tests.append({'check':label, 'pass':True, 'details':info or {}})
    fixed = {'washer':washer(), 'nut':nut(), 'eyelet':eyelet(), 'lower':lower_cup()}
    ball = cq.Workplane('XY').sphere(PIVOT_RADIUS).translate((0, 0, PIVOT_Z))
    for (an, a), (bn, b) in itertools.combinations(fixed.items(), 2):
        test(an + ' / ' + bn + ' fixed-part clearance', overlap(a, b) < 1e-7)
    test('ball stays inside both retainers without penetration',
         overlap(ball, fixed['eyelet']) < 1e-7 and overlap(ball, fixed['lower']) < 1e-7)
    test('upper and lower apertures mechanically smaller than sphere',
         PIVOT_RADIUS > EYELET_MOUTH_RADIUS and PIVOT_RADIUS > LOWER_MOUTH_RADIUS)
    # Broad 85-pose analytic shaft sweep, 3 detailed fused fillet CAD poses.
    swept = []
    for a in np.linspace(-MAX_THROW, MAX_THROW, 85):
        p = cq.Vector(0, 0, PIVOT_Z)
        stem = cq.Workplane('XY').newObject([
            cq.Solid.makeCylinder(SHAFT_RADIUS, 14.15,
                                 p + axis(float(a)).multiply(1.05), axis(float(a)))])
        swept.append(overlap(stem, fixed['eyelet']))
    test('85-pose shaft sweep clears eyelet', max(swept) < 1e-7,
         {'positions':85, 'max_overlap_mm3':max(swept)})
    for a in (-MAX_THROW, 0, MAX_THROW):
        joint = moving_joint(a)
        cap = insulating_tip(a)
        test(f'detailed fused CAD pose {a:+g}',
             overlap(joint, fixed['eyelet']) < 1e-7 and
             overlap(joint, fixed['lower']) < 1e-7 and
             overlap(joint, cap) < 1e-7)
    # Lock physical UP/DOWN displacement: this fails if X-axis motion returns.
    off_axis, on_axis = axis(-MAX_THROW), axis(MAX_THROW)
    test('vertical Y-axis throw with no X-axis lateral component',
         abs(off_axis.x) < 1e-12 and abs(on_axis.x) < 1e-12 and
         off_axis.y < 0 < on_axis.y)
    off_tip, on_tip = insulating_tip(-MAX_THROW).val().Center(), insulating_tip(MAX_THROW).val().Center()
    test('OFF tip physically DOWN and ON tip physically UP',
         off_tip.y < -4 and on_tip.y > 4)
    test('symmetric vertical travel and no left/right shift',
         abs(off_tip.y + on_tip.y) < 1e-5 and
         abs(off_tip.x) < 1e-5 and abs(on_tip.x) < 1e-5)
    test('OFF and ON keep identical forward protrusion',
         abs(off_tip.z - on_tip.z) < 1e-5)
    test('oversized pivot is correctly rejected',
         overlap(fixed['eyelet'],
                 cq.Workplane('XY').sphere(2.65).translate((0, 0, PIVOT_Z))) > .001)
    test('unbored handle tip is correctly rejected',
         overlap(moving_joint(-MAX_THROW),
                 cq.Workplane('XY').sphere(3.35).translate((
                    0, -16.2*math.sin(math.radians(MAX_THROW)),
                    PIVOT_Z+16.2*math.cos(math.radians(MAX_THROW))))) > .001)
    return tests


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent/'out'
    output.mkdir(parents=True, exist_ok=True)
    checks = validate()
    n_off = save_parts(parts(-MAX_THROW), output, 'MW_CONTROL_006_V2D_OFF')
    n_on = save_parts(parts(MAX_THROW), output, 'MW_CONTROL_006_V2D_ON')
    report = {'checkpoint':'CP04 V2H', 'owner_approved':False,
              'front_view_axis':'+Y screen up / +Z toward viewer',
              'throw':{'OFF':'DOWN -21 degrees','ON':'UP +21 degrees'},
              'part_counts':{'OFF':n_off,'ON':n_on}, 'checks':checks,
              'limits':'No real manufacturing/stress certification; no plugin integration.'}
    (output/'verification.json').write_text(json.dumps(report, indent=2)+'\n')
    print('V2H VERTICAL CAD PASS:',len(checks),'checks,',n_off,'named STEP/GLB parts per state')


if __name__ == '__main__': main()
