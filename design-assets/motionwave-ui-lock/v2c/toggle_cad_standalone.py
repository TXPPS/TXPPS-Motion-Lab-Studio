#!/usr/bin/env python3
"""CP04 V2.0C: standalone OFF/ON toggle CAD assembly and proof.

Nominal-mm design study, not certified manufacturing CAD. Does not touch DAW.
Run: python toggle_cad_standalone.py [output-directory]
Requires: cadquery, trimesh, numpy.
"""
import json
import math
import sys
from pathlib import Path
import cadquery as cq
import numpy as np
import trimesh

PIVOT_Z, BALL_R, MOUTH_R, SHAFT_R, LIMIT = 2.90, 2.30, 2.12, 1.47, 21.0
PROFILE = [(4.75,2.50),(4.75,4.13),(4.63,4.25),(2.12,4.25),
           (2.12,4.02),(2.15,3.90),(2.20,3.80),(2.30,3.70),
           (2.42,3.60),(2.48,3.46),(2.48,2.50)]

def eyelet():
    return cq.Workplane('XZ').polyline(PROFILE).close().revolve(360,(0,0),(0,1))

def stem(angle):
    a=math.radians(angle)
    pivot=cq.Vector(0,0,PIVOT_Z)
    direction=cq.Vector(math.sin(a),0,math.cos(a))
    sphere=cq.Workplane('XY').sphere(BALL_R).translate((0,0,PIVOT_Z))
    shaft=cq.Solid.makeCylinder(SHAFT_R,14.15,pivot+direction.multiply(1.05),direction)
    joined=sphere.union(cq.Workplane('XY').newObject([shaft]))
    assert len(joined.solids().vals())==1
    return joined

def cad_mesh(workplane):
    pts,tri=workplane.val().tessellate(.018,.06)
    xyz=np.array([[p.x,p.y,p.z] for p in pts],dtype=float)
    f=np.array(tri,dtype=int)
    area=np.linalg.norm(np.cross(xyz[f[:,1]]-xyz[f[:,0]],xyz[f[:,2]]-xyz[f[:,0]]),axis=1)
    m=trimesh.Trimesh(vertices=xyz,faces=f[area>1e-12],process=True)
    if m.volume<0:m.invert()
    assert m.is_watertight and m.is_winding_consistent and m.volume>0
    return m

def assembly(deg,path):
    sc=trimesh.Scene()
    washer=trimesh.creation.annulus(r_min=3.2,r_max=9.1,height=.70,sections=96)
    washer.apply_translation([0,0,.50])
    nut=trimesh.creation.annulus(r_min=3.3,r_max=6.8,height=1.65,sections=6)
    nut.apply_translation([0,0,1.675])
    cap=trimesh.creation.icosphere(subdivisions=3,radius=1)
    cap.apply_scale([3.35,3.35,3.80])
    a=math.radians(deg)
    cap.apply_translation([16.2*math.sin(a),0,PIVOT_Z+16.2*math.cos(a)])
    parts=[('01_fixed_washer',washer),('02_bored_hex_nut',nut),
           ('03_retaining_eyelet',cad_mesh(eyelet())),
           ('04_one_piece_pivot_ball_and_shaft',cad_mesh(stem(deg))),
           ('05_separate_insulated_handle_tip',cap)]
    for name,mesh in parts:
        assert mesh.is_watertight and mesh.volume>0,name
        sc.add_geometry(mesh,geom_name=name,node_name=name)
    path.write_bytes(sc.export(file_type='glb'))
    return {'file':path.name,'parts':[n for n,_ in parts],
            'mesh_faces':{n:len(m.faces) for n,m in parts}}

def main():
    output=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parent/'models'
    output.mkdir(parents=True,exist_ok=True)
    scan=[]
    for deg in np.linspace(-LIMIT,LIMIT,85):
        overlap=eyelet().intersect(stem(float(deg))).val().Volume()
        scan.append(float(overlap))
    assert max(scan)<1e-7
    assert BALL_R>MOUTH_R
    # Negative control: enlarged pivot ball would collide with socket.
    wrong=cq.Workplane('XY').sphere(2.65).translate((0,0,PIVOT_Z))
    false_fit=eyelet().intersect(wrong).val().Volume()
    assert false_fit>0.005
    saved=[assembly(-LIMIT,output/'MW-CONTROL-006_toggle_OFF_V2C.glb'),
           assembly(LIMIT,output/'MW-CONTROL-006_toggle_ON_V2C.glb')]
    test={'checkpoint':'CP04 V2.0C','approval':'NOT APPROVED','unit':'concept mm',
          'ball_radius_mm':BALL_R,'mouth_radius_mm':MOUTH_R,
          'pivot_z_mm':PIVOT_Z,'throw_degrees':[-LIMIT,LIMIT],
          'cad_sweep_positions':len(scan),'maximum_intersection_mm3':max(scan),
          'fault_enlarged_ball_intersection_mm3':false_fit,'models':saved}
    (output/'geometry_checks.json').write_text(json.dumps(test,indent=2))
    print(json.dumps(test,indent=2))

if __name__=='__main__':main()
