/**
 * Bundle budget.
 *
 * The entry chunk is what a musician waits for before they can do anything, so
 * it gets a hard ceiling that CI enforces. Everything else — pages, editors,
 * QA fixtures — is code-split and only has to stay off the entry chunk.
 *
 * Raising a budget is a decision, not a formality: change the number here in
 * the same commit that makes it necessary, and say why in the message.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DIST = 'dist/assets';
const BUDGETS = {
  /** gzipped bytes of the entry JS chunk */
  entryJs: 140 * 1024,
  /** gzipped bytes of all CSS */
  css: 40 * 1024,
  /** gzipped bytes of everything the browser could ever download */
  totalJs: 420 * 1024,
};

const files = readdirSync(DIST).filter((f) => !f.endsWith('.map'));
const gz = (name) => gzipSync(readFileSync(join(DIST, name))).length;

let entryJs = 0;
let css = 0;
let totalJs = 0;
const rows = [];
for (const f of files) {
  if (statSync(join(DIST, f)).isDirectory()) continue;
  const size = gz(f);
  if (f.endsWith('.css')) css += size;
  else if (f.endsWith('.js')) {
    totalJs += size;
    // Vite names the entry chunk after the entry module.
    if (/^index-[^.]+\.js$/.test(f)) entryJs = size;
  }
  rows.push([f, size]);
}

rows.sort((a, b) => b[1] - a[1]);
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log('Largest assets (gzipped):');
for (const [name, size] of rows.slice(0, 12)) console.log(`  ${kb(size).padStart(10)}  ${name}`);
console.log('');

const checks = [
  ['entry JS', entryJs, BUDGETS.entryJs],
  ['all CSS', css, BUDGETS.css],
  ['all JS', totalJs, BUDGETS.totalJs],
];

let failed = false;
for (const [label, actual, budget] of checks) {
  const ok = actual <= budget;
  if (!ok) failed = true;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(9)} ${kb(actual).padStart(10)} / ${kb(budget)}`,
  );
}

if (failed) {
  console.error('\nBundle budget exceeded. Split the new code out of the entry chunk, or raise');
  console.error('the budget in scripts/check-bundle.mjs in the same commit and say why.');
  process.exit(1);
}
