#!/usr/bin/env python3
"""Independent CP04 V2H verification of exported STEP/GLB, no image rendering."""
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path
import numpy as np
import trimesh

if len(sys.argv)!=2:
    raise SystemExit('Usage: python verify-cp04-v2h-vertical.py CAD_OUTPUT_DIR')
cad=Path(sys.argv[1])
generator=Path('design-assets/motionwave-ui-lock/v2d/cp04_v2d_repo_generator.py')
spec=importlib.util.spec_from_file_location('mwv2h',generator)
model=importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)
report=json.loads((cad/'verification.json').read_text())
assert report['checkpoint']=='CP04 V2H'
assert report['owner_approved'] is False
assert report['part_counts']=={'OFF':6,'ON':6}
assert report['front_view_axis']=='+Y screen up / +Z toward viewer'
assert report['throw']=={'OFF':'DOWN -21 degrees','ON':'UP +21 degrees'}
assert len(report['checks'])==18 and all(item['pass'] for item in report['checks'])
expected={'fixed_washer','fixed_bored_hex_nut','fixed_turned_eyelet',
          'fixed_lower_retainer_cup','moving_pivot_ball_shaft',
          'moving_blind_bored_insulating_tip'}
fixed=expected-{'moving_pivot_ball_shaft','moving_blind_bored_insulating_tip'}
states={}
for state, angle, sign in [('OFF',-21,-1),('ON',21,1)]:
    stem=model.axis(angle)
    assert abs(stem.x)<1e-10 and stem.y*sign>0.35
    glb=cad/f'MW_CONTROL_006_V2D_{state}.glb'
    step=cad/f'MW_CONTROL_006_V2D_{state}.step'
    assert glb.stat().st_size>5000 and step.stat().st_size>5000
    scene=trimesh.load(glb,force='scene')
    assert set(scene.geometry)==expected
    assert all(mesh.is_watertight and mesh.is_winding_consistent and mesh.volume>0
               for mesh in scene.geometry.values())
    tip=scene.geometry['moving_blind_bored_insulating_tip'].center_mass
    joint=scene.geometry['moving_pivot_ball_shaft'].center_mass
    assert abs(tip[0])<.002 and tip[1]*sign>4.0 and abs(joint[0])<.002
    states[state]={'tip':tip, 'scene':scene}
off=states['OFF']['tip']
on=states['ON']['tip']
assert abs(off[1]+on[1])<.01 and abs(off[2]-on[2])<.01
for part in fixed:
    a=states['OFF']['scene'].geometry[part]
    b=states['ON']['scene'].geometry[part]
    assert np.allclose(a.bounds,b.bounds,atol=1e-4), part
    assert abs(a.volume-b.volume)<1e-4, part
assert len(list(cad.glob('*.glb')))==2 and len(list(cad.glob('*.step')))==2
print('CP04 V2H exported true 3D: OFF/down, ON/up, six watertight named parts, fixed hardware invariant, 18 CAD checks PASS')
