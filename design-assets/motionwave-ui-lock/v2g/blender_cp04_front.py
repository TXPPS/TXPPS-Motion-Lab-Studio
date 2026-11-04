#!/usr/bin/env python3
"""CP04 V2G — editable Blender/Cycles front-view lookdev from existing GLBs.

No SVG generation, no side camera, no DAW/DSP/runtime alterations.
Blender 4.x only; authored source is NOT a visually approved Cycles render.

Usage:
blender --background --python blender_cp04_front.py -- --model INPUT.glb --kind toggle --render OUTPUT.png --blend OUTPUT.blend
"""
import argparse
import sys
from pathlib import Path

def arguments():
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    p=argparse.ArgumentParser()
    p.add_argument('--model',required=True)
    p.add_argument('--kind',choices=('toggle','knob'),required=True)
    p.add_argument('--render',required=True)
    p.add_argument('--blend',required=True)
    p.add_argument('--size',type=int,default=2048)
    p.add_argument('--samples',type=int,default=160)
    return p.parse_args(argv)

MATERIALS={
    'fixed_washer':((.34,.33,.31),.78,0),
    'fixed_bored_hex_nut':((.54,.52,.49),.54,1),
    'fixed_turned_eyelet':((.59,.57,.54),.48,1),
    'moving_pivot_ball_shaft':((.60,.59,.55),.43,1),
    'moving_blind_bored_insulating_tip':((.68,.61,.51),.78,0),
    'fixed_lower_retainer_cup':((.38,.38,.35),.73,1),
    'fixed_mount_washer':((.40,.39,.37),.76,1),
    'moving_molded_knob_body':((.125,.138,.134),.67,0),
    'moving_recessed_ivory_inlay':((.74,.69,.60),.83,0),
}

def material(bpy,label,appearance):
    rgb,roughness,metal=appearance
    mat=bpy.data.materials.new('MW_G2_'+label)
    mat.use_nodes=True
    nodes=mat.node_tree.nodes
    links=mat.node_tree.links
    bsdf=nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value=(*rgb,1.0)
    bsdf.inputs['Metallic'].default_value=metal
    bsdf.inputs['Roughness'].default_value=roughness
    if 'Coat Weight' in bsdf.inputs:bsdf.inputs['Coat Weight'].default_value=0
    coords=nodes.new('ShaderNodeTexCoord')
    noise=nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value=180 if metal else 230
    noise.inputs['Detail'].default_value=2.1
    noise.inputs['Roughness'].default_value=.61
    ramp=nodes.new('ShaderNodeMapRange')
    ramp.inputs['From Min'].default_value=.25
    ramp.inputs['From Max'].default_value=.78
    ramp.inputs['To Min'].default_value=max(.02,roughness-.035)
    ramp.inputs['To Max'].default_value=min(.98,roughness+.035)
    bump=nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value=.023 if metal else .048
    bump.inputs['Distance'].default_value=.001 if metal else .002
    links.new(coords.outputs['Generated'],noise.inputs['Vector'])
    links.new(noise.outputs['Fac'],ramp.inputs['Value'])
    links.new(ramp.outputs['Result'],bsdf.inputs['Roughness'])
    links.new(noise.outputs['Fac'],bump.inputs['Height'])
    links.new(bump.outputs['Normal'],bsdf.inputs['Normal'])
    return mat

def light(bpy,name,position,watts,dimensions):
    from mathutils import Vector
    data=bpy.data.lights.new(name,'AREA')
    data.energy=watts
    data.shape='RECTANGLE'
    data.size,data.size_y=dimensions
    o=bpy.data.objects.new(name,data)
    bpy.context.collection.objects.link(o)
    o.location=position
    o.rotation_euler=(Vector((0,0,3))-o.location).to_track_quat('-Z','Y').to_euler()

def main():
    import bpy
    a=arguments()
    model=Path(a.model).expanduser().resolve()
    if not model.is_file():raise FileNotFoundError(model)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(model))
    meshes=[x for x in bpy.context.scene.objects if x.type=='MESH']
    expected=6 if a.kind=='toggle' else 3
    if len(meshes)!=expected:raise RuntimeError(f'Expected {expected} editable parts; found {len(meshes)}')
    for obj in meshes:
        label=next((n for n in MATERIALS if n in obj.name),None)
        if label is None:raise RuntimeError('Unrecognized CAD part '+obj.name)
        obj.data.materials.clear()
        obj.data.materials.append(material(bpy,label,MATERIALS[label]))
    data=bpy.data.cameras.new('FRONT_ORTHOGRAPHIC_0DEG')
    cam=bpy.data.objects.new('FRONT_ORTHOGRAPHIC_0DEG',data)
    bpy.context.collection.objects.link(cam)
    cam.location=(0,0,100)
    cam.rotation_euler=(0,0,0) # Blender cameras look down -Z; +Y is up.
    data.type='ORTHO'
    data.ortho_scale=25 if a.kind=='toggle' else 43
    scene=bpy.context.scene
    scene.camera=cam
    light(bpy,'Key softbox top-left',(-23,25,44),550,(35,19))
    light(bpy,'Fill right',(28,9,38),220,(35,25))
    light(bpy,'Subtle lower fill',(-11,-30,30),95,(24,18))
    w=bpy.data.worlds.new('Neutral studio')
    w.use_nodes=True
    w.node_tree.nodes['Background'].inputs['Color'].default_value=(.45,.45,.45,1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value=.45
    scene.world=w
    scene.render.engine='CYCLES'
    scene.cycles.samples=max(16,a.samples)
    scene.render.film_transparent=True
    scene.render.resolution_x=a.size
    scene.render.resolution_y=a.size
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.render.image_settings.color_mode='RGBA'
    scene.render.image_settings.color_depth='16'
    try:scene.view_settings.view_transform='AgX'
    except TypeError:scene.view_settings.view_transform='Standard'
    try:scene.view_settings.look='Medium High Contrast'
    except TypeError:pass
    output=Path(a.render).expanduser().resolve()
    blend=Path(a.blend).expanduser().resolve()
    output.parent.mkdir(parents=True,exist_ok=True)
    blend.parent.mkdir(parents=True,exist_ok=True)
    scene.render.filepath=str(output)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    bpy.ops.render.render(write_still=True)
    print('V2G editable front 3D scene rendered — NOT owner approved:',output)

if __name__=='__main__':main()
