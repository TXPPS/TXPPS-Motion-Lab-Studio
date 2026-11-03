#!/usr/bin/env python3
"""CP04 G2.1B: review-only satin materials from six-part V2D GLBs.

Requirements: vtk, trimesh, numpy, Pillow. Does not edit mesh, UI, DAW or DSP.
Usage: python cp04_g2_repo_renderer.py <glb-dir> <output-dir>
"""
from __future__ import annotations
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
import trimesh
import vtk
from vtk.util.numpy_support import numpy_to_vtk, vtk_to_numpy
from PIL import Image, ImageDraw, ImageFont

MATERIALS={
  'fixed_washer':([.275,.285,.293],.81,.0,'matte powder-coated mount'),
  'fixed_bored_hex_nut':([.48,.485,.465],.60,.68,'satin metal nut'),
  'fixed_turned_eyelet':([.57,.57,.54],.55,.80,'soft satin nickel eyelet'),
  'moving_pivot_ball_shaft':([.60,.59,.56],.47,.72,'satin metal stem'),
  'moving_blind_bored_insulating_tip':([.57,.535,.462],.76,.0,'matte phenolic tip'),
  'fixed_lower_retainer_cup':([.31,.325,.326],.77,.35,'low-sheen lower retainer'),
}

def seam_safe_normals(normal_filter, name):
  """Deterministic bounded 3D micro-normal variation; no UV or tangent seams.

  Render-time normals only, NOT a physical bump depth or CAD alteration.
  """
  data=vtk.vtkPolyData();data.DeepCopy(normal_filter.GetOutput())
  points=vtk_to_numpy(data.GetPoints().GetData()).astype(np.float64)
  normals=vtk_to_numpy(data.GetPointData().GetNormals()).astype(np.float64)
  if 'insulating_tip' in name:amplitude,freq=.045,14.0
  elif name in ('fixed_bored_hex_nut','fixed_turned_eyelet','moving_pivot_ball_shaft'):amplitude,freq=.028,11.0
  else:amplitude,freq=.019,10.0
  x,y,z=points.T
  field=np.column_stack((np.sin(x*freq*1.14+y*freq*.82+z*freq*.23),
     np.sin(y*freq*.77+z*freq*1.10+x*freq*.29),
     np.sin(z*freq*.94+x*freq*.63-y*freq*.36)))
  tangent=field-(field*normals).sum(axis=1,keepdims=True)*normals
  altered=normals+amplitude*tangent
  altered/=np.maximum(1e-9,np.linalg.norm(altered,axis=1,keepdims=True))
  vtk_normals=numpy_to_vtk(altered.astype(np.float32),deep=True)
  vtk_normals.SetName('Normals');data.GetPointData().SetNormals(vtk_normals)
  return data

def render(model,output):
  scene=trimesh.load(model,force='scene')
  assert len(scene.geometry)==6 and set(scene.geometry)==set(MATERIALS)
  ren=vtk.vtkRenderer();ren.SetBackground(.20,.215,.218);ren.SetBackgroundAlpha(0.0)
  window=vtk.vtkRenderWindow();window.AddRenderer(ren);window.SetOffScreenRendering(True)
  window.SetSize(1080,1080);window.SetAlphaBitPlanes(1);window.SetMultiSamples(8)
  for name,m in scene.geometry.items():
    assert m.is_watertight and m.volume>0
    points=vtk.vtkPoints();points.SetData(numpy_to_vtk(np.asarray(m.vertices,np.float64),deep=True))
    poly=vtk.vtkPolyData();poly.SetPoints(points)
    cells=vtk.vtkCellArray()
    for face in m.faces:
      tri=vtk.vtkTriangle()
      for j,k in enumerate(face):tri.GetPointIds().SetId(j,int(k))
      cells.InsertNextCell(tri)
    poly.SetPolys(cells)
    normal=vtk.vtkPolyDataNormals();normal.SetInputData(poly);normal.SetFeatureAngle(48)
    normal.SplittingOn();normal.AutoOrientNormalsOn();normal.ConsistencyOn()
    mapper=vtk.vtkPolyDataMapper();normal.Update()
    mapper.SetInputData(seam_safe_normals(normal,name))
    actor=vtk.vtkActor();actor.SetMapper(mapper)
    rgb,rough,metal,_=MATERIALS[name]
    prop=actor.GetProperty();prop.SetInterpolationToPBR();prop.SetColor(*rgb)
    prop.SetRoughness(rough);prop.SetMetallic(metal)
    prop.SetCoatStrength(.015);prop.SetCoatRoughness(.85)
    ren.AddActor(actor)
  for position,intensity in [((-30,-38,62),1.10),((36,10,42),.54),((10,35,38),.26)]:
    light=vtk.vtkLight();light.SetLightTypeToSceneLight();light.SetPosition(*position)
    light.SetFocalPoint(0,0,7);light.SetIntensity(intensity);ren.AddLight(light)
  cam=ren.GetActiveCamera();cam.ParallelProjectionOn();cam.SetFocalPoint(0,0,11)
  cam.SetPosition(51,-70,75);cam.SetViewUp(0,0,1)
  cam.SetParallelScale(23);cam.OrthogonalizeViewUp();ren.ResetCameraClippingRange()
  window.Render()
  grab=vtk.vtkWindowToImageFilter();grab.SetInput(window);grab.SetInputBufferTypeToRGBA()
  grab.ReadFrontBufferOff();grab.Update()
  writer=vtk.vtkPNGWriter();writer.SetInputConnection(grab.GetOutputPort())
  writer.SetFileName(str(output));writer.Write();window.Finalize()
  out=Image.open(output).convert('RGBA');a=out.getchannel('A')
  assert a.getextrema()==(0,255)
  return out

def fitted(image,target,crop_pad=.07):
  bbox=image.getchannel('A').getbbox();assert bbox
  x0,y0,x1,y1=bbox;pad=int(max(x1-x0,y1-y0)*crop_pad)
  obj=image.crop((max(0,x0-pad),max(0,y0-pad),min(image.width,x1+pad),min(image.height,y1+pad)))
  obj.thumbnail((int(target*.95),int(target*.95)),Image.Resampling.LANCZOS)
  dest=Image.new('RGBA',(target,target),(0,0,0,0))
  dest.alpha_composite(obj,((target-obj.width)//2,(target-obj.height)//2))
  return dest

def board(states,outdir):
  W,H=1200,1140;board=Image.new('RGB',(W,H),'#151e26');d=ImageDraw.Draw(board)
  bold='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
  font=ImageFont.truetype(bold,27)
  d.text((35,24),'CP04 G2.1B  /  SATIN MATERIAL REVIEW',font=font,fill='#f5f1e7')
  d.text((35,68),'Six distinct V2D CAD parts, provisional PBR roughness, no fake gloss or live UI changes',fill='#c2c8c9')
  for i,state in enumerate(('OFF','ON')):
    y=108+i*495
    d.text((34,y+10),state,font=font,fill='#e8dbc6')
    obj=states[state]
    cover=fitted(obj,420)
    bg=Image.new('RGBA',(420,420),'#30393f');bg.alpha_composite(cover)
    board.paste(bg.convert('RGB'),(55,y+50))
    for j,size in enumerate((96,160,256)):
      asset=fitted(obj,size)
      asset.save(outdir/f'MW006_G2_{state}_{size}px.png')
      bg=Image.new('RGBA',(size,size),'#30393f');bg.alpha_composite(asset)
      x=[510,650,860][j]
      board.paste(bg.convert('RGB'),(x,y+92))
      d.text((x,y+58),f'{size}px',fill='#d8dbd9')
  dest=outdir/'CP04_G2_Satin_And_Native_Size_Review.png';board.save(dest)
  return dest

def main():
  assert len(sys.argv)==3,'Usage: python cp04_g2_repo_renderer.py <glb-dir> <output-dir>'
  glbs,outdir=Path(sys.argv[1]),Path(sys.argv[2]);outdir.mkdir(parents=True,exist_ok=True)
  names={state:glbs/f'MW_CONTROL_006_V2D_{state}.glb' for state in ('OFF','ON')}
  before={k:hashlib.sha256(p.read_bytes()).hexdigest() for k,p in names.items()}
  states={}
  for state,p in names.items():
    original=render(p,outdir/f'MW006_G2_{state}_render_rgba.png')
    out=fitted(original,1024);out.save(outdir/f'MW006_G2_{state}_isolated_1024.png')
    states[state]=original
  board(states,outdir)
  after={k:hashlib.sha256(p.read_bytes()).hexdigest() for k,p in names.items()}
  assert before==after,'source geometry modified during materials study'
  files=sorted(outdir.glob('*.png'))
  assert len(files)==11,len(files)
  for p in files:
    img=Image.open(p)
    assert img.width>=96 and img.height>=96
    if 'isolated' in p.name:assert img.mode=='RGBA' and img.getchannel('A').getextrema()==(0,255)
  report={'checkpoint':'CP04 G2.1B','status':'MATERIAL STUDY ONLY / NOT APPROVED',
    'source_cad_unchanged':True,'source_sha256':before,
    'material_parameters':{k:{'rgb':v[0],'roughness':v[1],'metallic':v[2],'type':v[3]} for k,v in MATERIALS.items()},
    'images':[p.name for p in files],
    'limitations':['shader micro-normal variation is a visual study, not calibrated physical microtexture','no approved iPhone layout',
      'no manufacturer-reference roughness measurement','no VST runtime integration']}
  (outdir/'G2_REVIEW_REPORT.json').write_text(json.dumps(report,indent=2)+'\n')
  print('CP04 G2.1B review artifacts:',len(files),'PNGs, 6 material profiles, unchanged source CAD')

if __name__=='__main__':main()
