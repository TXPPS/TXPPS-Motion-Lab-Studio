// CP04 V2.1A material recipe guard. No visual/aesthetic approval implied.
// JSON is a design target; source Python renderer and binary GLBs are in the
// accompanying chat ZIP and are deliberately NOT claimed to be in this repo.
import { readFileSync } from 'node:fs';

const path = new URL('../../design-assets/motionwave-ui-lock/v21a/materials.json', import.meta.url);
const spec = JSON.parse(readFileSync(path, 'utf8'));
const required = [
  'phenolic','ivory','nickel','satinMetal','bronze',
  'powdercoat','paper','ink','glass','bolt','back',
];
function must(ok, desc) {
  if (!ok) throw new Error('CP04 V2.1A material contract: ' + desc);
}
must(spec.schema === 'motionwave.cp04-v21a.lookdev.v1', 'schema');
must(spec.approval === 'NOT_APPROVED' && spec.productionImported === false, 'approval safety');
must(spec.renderer.includes('NOT calibrated PBR'), 'render provenance disclosure');
must(spec.geometrySources.length === 4, 'expected four V2C geometry scene references');
const expectedNodes = [3,5,5,10];
for (const [i,g] of spec.geometrySources.entries()) {
  must(/^[a-f0-9]{64}$/.test(g.sha256), 'SHA256 encoding ' + g.file);
  must(g.nodes === expectedNodes[i], 'unexpected named geometry nodes ' + g.file);
}
must(Object.keys(spec.materials).length === required.length, 'material class count');
for (const name of required) {
  const m = spec.materials[name];
  must(!!m, 'missing material ' + name);
  must(m.base.length === 3 && m.base.every(x=>Number.isFinite(x) && x>=0 && x<=1), 'RGB range ' + name);
  must(m.roughnessTarget>0 && m.roughnessTarget<=1, 'roughness range ' + name);
  must(m.metallic===0 || m.metallic===1, 'metallic flag ' + name);
  must(typeof m.texture==='string' && m.texture.length>8, 'missing substrate description '+name);
}
must(spec.materials.phenolic.metallic===0 && spec.materials.phenolic.roughnessTarget>=.55, 'glossy black polymer rejected');
must(spec.materials.powdercoat.metallic===0 && spec.materials.powdercoat.roughnessTarget>.6, 'powdercoat must be matte');
must(spec.materials.glass.roughnessTarget<spec.materials.paper.roughnessTarget, 'material response distinct');
must(spec.materials.ink.roughnessTarget>.65, 'printed legends must remain matte');
must(spec.criticalDefects.some(x=>x.includes('MW-CONTROL-001')), 'do not suppress unapproved grip geometry defect');
must(spec.criticalDefects.some(x=>x.includes('not mirrored as GitHub binaries')), 'do not misrepresent package availability');
must(spec.proof.independentSourceAndAlphaChecks===25, 'study evidence changed; reverify in actual renderer');
must(spec.proof.inputMeshHashesPreserved===true, 'V2C model integrity required');
console.log('CP04 V2.1A: 11 material prototypes + four V2C source hashes OK; owner approval: NOT GRANTED.');
console.log('This guard validates declared targets only; visual review and physical-size captures are separate.');
