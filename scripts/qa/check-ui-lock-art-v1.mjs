import { readFileSync } from 'node:fs';

const root = new URL('../../design-assets/motionwave-ui-lock/', import.meta.url);
const m = JSON.parse(readFileSync(new URL('manifest-v1.json', root), 'utf8'));
const board = readFileSync(new URL(m.sourceSheet, root), 'utf8');

function assert(test, reason) {
  if (!test) throw new Error('CP04-v1 material guard: ' + reason);
}
assert(m.schema === 'motionwave.ui-lock.source-asset-catalog.v1', 'schema');
assert(m.runtimeImported === false && m.state === 'CANDIDATE_NOT_APPROVED', 'approval claim');
assert(m.assets.length === 8, 'expected 8 independent masters');
assert(m.sharedLight.azimuthDegrees === 315, 'inconsistent declared light');
assert(m.provenance.externalImages === false && m.provenance.distributedFonts === false, 'external art dependency');
assert(board.includes('viewBox="0 0 1600 920"'), 'review canvas changed');
const allIds = new Set();
for (const asset of m.assets) {
  assert(!allIds.has(asset.id), 'duplicate ID ' + asset.id);
  allIds.add(asset.id);
  const src = readFileSync(new URL(asset.file, root), 'utf8');
  const rx = new RegExp('id="' + asset.id + '"', 'g');
  assert((src.match(rx) || []).length === 1, 'single editable root group absent ' + asset.id);
  assert((board.match(rx) || []).length === 1, 'sheet must show the same source group ' + asset.id);
  assert(src.includes('<svg ') && src.trimEnd().endsWith('</svg>'), 'invalid standalone SVG ' + asset.id);
  assert(src.includes('viewBox="0 0 ' + asset.viewBox + '"'), 'wrong standalone art dimensions ' + asset.id);
  assert(!/\<image\b|\<script\b|\<foreignObject\b|\b@import\b/i.test(src), 'inlined photo or script ' + asset.id);
  assert(!/\b(?:href|src)\s*=\s*["']https?:/i.test(src), 'external image or font ref ' + asset.id);
  assert(!/<rect[^>]*\b(?:x="0"\s+y="0"\s+)?width="(300|580)"\s+height="(300|280)"/i.test(src),
    'standalone backdrop may have been baked into the source ' + asset.id);
  assert(asset.editable === true && asset.transparentBackground === true && asset.productionReady === false,
    'not a transparent editable review asset ' + asset.id);
  for (const layer of asset.layers) {
    assert(src.includes('data-layer="' + layer + '"'), 'missing separated material/control layer ' + asset.id + ':' + layer);
  }
  assert(src.includes('mwx-contact') && src.includes('mwx-rim'), 'missing contact AO or raised edges ' + asset.id);
  console.log(asset.id + ': ' + asset.layers.length + ' editable material layers, transparent, source-only');
}
assert(!m.assets.some(x=>x.visualReview), 'asset in manifest already incorrectly approved');
console.log('CP04-v1: 8 of 8 candidate masters validated; browser render still required');
