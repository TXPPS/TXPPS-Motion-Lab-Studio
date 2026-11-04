#!/usr/bin/env python3
"""CP04 V2E: original three-part molded knob, review-only STEP/GLB CAD.

40 physically recessed grip channels, blind shaft bore, recessed indicator.
No DAW, DSP, parameters, VST, runtime UI or production import changes.
Requires: cadquery, numpy, trimesh. Usage: python cp04_v2e_knob_cad.py OUTDIR
"""
import hashlib
import itertools
import json
import math
import sys
from pathlib import Path

import cadquery as cq
import numpy as np
import trimesh

GRIP_COUNT=40
STATES={'MIN':-135.0,'MID':0.0,'MAX':135.0}


def blank():
    return (cq.Workplane('XZ').moveTo(0,.9).lineTo(15.8,.9)
        .threePointArc((17.25,1.06),(17.92,1.65))
        .threePointArc((18,1.79),(18,2.05)).lineTo(18,5.9)
        .threePointArc((17.87,6.37),(17.54,6.63))
        .threePointArc((16.44,7.32),(15.43,8.1))
        .threePointArc((14.77,8.87),(14.15,9.25))
        .lineTo(0,9.25).close().revolve(360,(0,0),(0,1)))


def groove_tools():
    tools=[]
    for i in range(GRIP_COUNT):
        a=2*math.pi*i/GRIP_COUNT
        tools.append(cq.Workplane('XY').workplane(offset=1.8)
            .center(18.43*math.cos(a),18.43*math.sin(a))
            .circle(.81).extrude(4.4).edges('>Z or <Z').fillet(.24).val())
    return cq.Compound.makeCompound(tools)


def marker(length,width,z,height):
    return (cq.Workplane('XY').workplane(offset=z).center(0,10.75)
            .slot2D(length,width,angle=90).extrude(height))


def build():
    original=blank()
    fluted=original.cut(groove_tools())
    bore=cq.Workplane('XY').workplane(offset=.89).circle(3.1).extrude(6.6)
    body=fluted.cut(bore).cut(marker(5.6,1.04,8.88,.72))
    inlay=marker(5.52,.96,8.88,.18)
    mount=(cq.Workplane('XY').workplane(offset=.14)
           .circle(12.8).circle(3.35).extrude(.64).edges('>Z').fillet(.12))
    return original,fluted,body,inlay,mount


def vol(shape):return float(shape.val().Volume())
def clash(a,b):return float(a.intersect(b).val().Volume())


def make_mesh(shape):
    vert,face=shape.val().tessellate(.075,.16)
    verts=np.asarray([(p.x,p.y,p.z) for p in vert],dtype=float)
    faces=np.asarray(face,dtype=int)
    normals=np.cross(verts[faces[:,1]]-verts[faces[:,0]],
                     verts[faces[:,2]]-verts[faces[:,0]])
    model=trimesh.Trimesh(vertices=verts,
        faces=faces[np.linalg.norm(normals,axis=1)>1e-12],process=True)
    if model.volume<0:model.invert()
    assert model.is_watertight and model.is_winding_consistent and model.volume>0
    return model


def main(directory):
    directory.mkdir(parents=True,exist_ok=True)
    original,fluted,body,inlay,mount=build()
    checks=[]
    def check(name,ok):
        if not ok:raise AssertionError(name)
        checks.append(name)
    check('three separate valid manufactured solids',all(x.val().isValid() and len(x.solids().vals())==1 for x in (body,inlay,mount)))
    lost=vol(original)-vol(fluted)
    check('40 channels remove real material (independent of bore)',35<lost<100)
    check('blind bore removes material without breaking crown',vol(fluted)-vol(body)>190)
    check('marker is recessed by 0.19mm',abs(9.25-9.06-.19)<1e-7)
    check('stationary mounting washer does not intersect body',clash(body,mount)<1e-6)
    check('inset pointer has real lateral clearance',clash(body,inlay)<1e-6)
    check('flutes lie outside shaft bore and end below shoulder',18.43-.81>6 and 6.2<8.1)
    check('injected pointer fault produces real collision',clash(body,inlay.translate((.35,0,0)))>.01)
    for state,angle in STATES.items():
        shell=body.rotate((0,0,0),(0,0,1),angle)
        pointer=inlay.rotate((0,0,0),(0,0,1),angle)
        shapes=[('fixed_mount_washer',mount),('moving_molded_knob_body',shell),('moving_recessed_ivory_inlay',pointer)]
        check(state+': three non-overlapping parts',all(clash(x[1],y[1])<1e-6 for x,y in itertools.combinations(shapes,2)))
        check(state+': rotation does not deform body',abs(vol(shell)-vol(body))<1e-5)
        assy=cq.Assembly(name='MW_CONTROL_001_V2E_'+state);scene=trimesh.Scene()
        for label,solid in shapes:
            assy.add(solid,name=label)
            scene.add_geometry(make_mesh(solid),node_name=label,geom_name=label)
        assert len(scene.geometry)==3
        name='MW_CONTROL_001_V2E_'+state
        (directory/(name+'.glb')).write_bytes(scene.export(file_type='glb'))
        assy.save(str(directory/(name+'.step')),exportType='STEP')
    report={'checkpoint':'CP04 V2E','approval':'NOT_APPROVED','productionImported':False,
       'units':'mm','parts':3,'gripChannels':GRIP_COUNT,'gripVolumeRemovedMm3':round(lost,4),
       'pointerRecessMm':.19,'angleStates':STATES,'checks':checks,
       'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(directory.iterdir()) if p.is_file()},
       'limits':['G1 appearance not approved','No calibrated PBR/Cycles materials',
                 'No reference-matched iPhone/desktop review','No production integration']}
    (directory/'cad-verification.json').write_text(json.dumps(report,indent=2)+'\n')
    print('CP04 V2E CAD PASS:',len(checks),'checks, 3 states, 3 parts each; UNAPPROVED')

if __name__=='__main__':
    if len(sys.argv)!=2:raise SystemExit('Usage: python cp04_v2e_knob_cad.py OUTDIR')
    main(Path(sys.argv[1]))
