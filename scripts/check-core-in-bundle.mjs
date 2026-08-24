// Asserts the shipped bundle contains a real Motion Wave core.
//
// The reason this exists is the state ADR-0007 was written out of: `npm run
// build` was green for months while producing a bundle with no engine in it at
// all. Twenty-four Ledger cells passed the whole time, because every one of
// them measured the units somewhere other than the shipped app.
//
// So this checks the *artefact*, not the build log. A build step that ran and
// silently produced nothing is indistinguishable from one that never ran, from
// the point of view of a user opening the app.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const failures = [];

function require(path, minBytes, mustContain) {
  const full = join(dist, path);
  if (!existsSync(full)) {
    failures.push(`missing: dist/${path}`);
    return;
  }
  const size = statSync(full).size;
  if (size < minBytes) {
    failures.push(`dist/${path} is ${size} bytes, expected at least ${minBytes}`);
    return;
  }
  if (mustContain) {
    const text = readFileSync(full, 'utf8');
    for (const needle of mustContain) {
      if (!text.includes(needle)) failures.push(`dist/${path} does not contain "${needle}"`);
    }
  }
}

/*
 * The core, as an Emscripten SINGLE_FILE build: the wasm is embedded as base64,
 * so the file is hundreds of kilobytes and contains the factory the worklet
 * calls. Checking for the factory name as well as the size is what separates
 * "a large file is present" from "the thing the audio thread needs is present".
 */
require('worklets/motionwave.worklet.js', 100_000, ['createMotionWaveCore']);

/*
 * The processor. Small, so the size floor is only a sanity check; what matters
 * is that it registers the name the host constructs by.
 */
require('worklets/unit_worklet.js', 2_000, ["registerProcessor('motion-wave-unit'"]);

if (failures.length > 0) {
  console.error('The shipped bundle does not contain a usable Motion Wave core:');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('');
  console.error('This is the false green ADR-0007 exists to prevent: a build that passes');
  console.error('while the app it produces has no engine in it. Run `npm run build:wasm`');
  console.error('and check `scripts/sync-motionwave-assets.mjs` ran.');
  process.exit(1);
}

console.log('bundle: Motion Wave core and processor present in dist/worklets/');
