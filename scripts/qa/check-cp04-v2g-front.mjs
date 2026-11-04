// CP04 V2G: policy guard, not a visual/Blender-render approval.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../../design-assets/motionwave-ui-lock/v2g/blender_cp04_front.py',import.meta.url),'utf8');
const docs=readFileSync(new URL('../../docs/design/MOTIONWAVE_CP04_V2G_FRONT_ORTHOGRAPHIC_RESTORE.md',import.meta.url),'utf8');
for(const expression of [
  /bpy\.ops\.import_scene\.gltf/,
  /cam\.location=\(0,0,100\)/,
  /cam\.rotation_euler=\(0,0,0\)/,
  /data\.type='ORTHO'/,
  /data\.ortho_scale=25 if a\.kind=='toggle' else 43/,
  /obj\.data\.materials\.append/,
  /scene\.render\.engine='CYCLES'/,
  /scene\.render\.film_transparent=True/,
  /scene\.render\.image_settings\.color_mode='RGBA'/,
  /expected=6 if a\.kind=='toggle' else 3/
]){
  assert.match(source,expression, 'Missing front-CAD reproducibility contract '+expression);
}
assert.match(docs,/NOT APPROVED/);
assert.match(docs,/not a calibrated physically based Blender\/Cycles result/);
assert.match(docs,/Do not merge or deploy without approval/);
assert.match(docs,/rejects the flat V2F SVG direction/);
console.log('CP04 V2G source/orthographic contract OK; this is NOT a Blender render or visual owner approval.');
