/**
 * Static CP-UI-LOCK-004 source-art guard; not part of the DAW renderer.
 * The SVG is a source illustration, never a fake live control or meter.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = new URL('../../design-assets/motionwave-ui-lock/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', base), 'utf8'));
const svg = readFileSync(new URL(manifest.source, base), 'utf8');

function fail(message) {
  throw new Error('UI Lock asset guard: ' + message);
}

if (manifest.schema !== 'motionwave.ui-lock.source-asset-catalog.v0') {
  fail('unknown asset manifest schema');
}
if (manifest.status !== 'CANDIDATE_UNAPPROVED' || manifest.runtimeImported !== false) {
  fail('source assets falsely marked approved or production-imported');
}
if (!svg.startsWith('<svg ') || !svg.trimEnd().endsWith('</svg>')) {
  fail('SVG source missing standalone root');
}
if (!svg.includes('viewBox="0 0 1600 920"')) {
  fail('source master viewBox unexpectedly changed');
}
if (/\b(?:https?:)?\/\//i.test(svg) && !svg.includes('http://www.w3.org/2000/svg')) {
  fail('unexpected network reference');
}
if (/<script\b|<image\b|<foreignObject\b|<iframe\b|@import|url\(https?:/i.test(svg)) {
  fail('external code, bitmap or remotely referenced resource');
}
if (!svg.includes('STATIC CONCEPT ART ONLY')) {
  fail('source sheet lost mandatory nonfunctional-art disclosure');
}
if (!Array.isArray(manifest.assets) || manifest.assets.length !== 8) {
  fail('expected exactly eight catalog entries');
}

const xmlIds = [...svg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const actual = new Set(xmlIds);
if (actual.size !== xmlIds.length) {
  fail('duplicate SVG IDs cause wrong gradients or invalid layer references');
}
const defined = new Set();
for (const asset of manifest.assets) {
  if (defined.has(asset.id)) fail('duplicate manifest asset: ' + asset.id);
  defined.add(asset.id);
  if (!/^MW-CONTROL-00[1-8]$/.test(asset.id)) fail('invalid stable asset ID: ' + asset.id);
  if (!actual.has(asset.id) || asset.symbolGroup !== '#' + asset.id) {
    fail('missing editable SVG layer: ' + asset.id);
  }
  if (asset.touchTargetMinPx < 44) fail('touch target too small: ' + asset.id);
  if (asset.phoneVisiblePx <= 0 || asset.desktopVisiblePx <= 0) {
    fail('nonpositive sizing declaration: ' + asset.id);
  }
  if (!asset.states.length) fail('no design state specification: ' + asset.id);
}
const sourceGroups = xmlIds.filter((id) => id.startsWith('MW-CONTROL-'));
if (sourceGroups.length !== 8) fail('unregistered SVG group found');

if (manifest.provenance.externalAssets || manifest.provenance.fontFilesIncluded) {
  fail('unapproved external assets or fonts');
}

console.log(
  `CP-UI-LOCK-004 source art: ${manifest.assets.length} editable assets; ${xmlIds.length} unique SVG IDs; offline-safe; candidate only.`,
);
console.log(fileURLToPath(new URL(manifest.source, base)));
