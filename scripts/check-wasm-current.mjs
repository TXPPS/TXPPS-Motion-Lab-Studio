// Is the tracked WebAssembly core the one this source builds?
//
// `motionwave/wasm/prebuilt/motionwave.worklet.js` is a build artefact kept in
// git, because the app's production build has to run in places without a C++
// toolchain — Cloudflare's builder, a contributor who only wants the web app.
// A tracked artefact's failure mode is that it silently stops matching its
// source, and the symptom is the worst kind: the app builds, deploys, loads,
// and runs a version of the DSP nobody can find in the repository.
//
// So it is checked wherever the toolchain exists, and skipped honestly where it
// does not. Skipping is not a pass — it says so.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const emsdk = process.env.EMSDK_DIR ?? '/home/user/emsdk';
const prebuilt = join(root, 'motionwave/wasm/prebuilt/motionwave.worklet.js');
const fresh = join(root, 'motionwave/wasm/dist/motionwave.worklet.js');

if (!existsSync(prebuilt)) {
  console.error(`wasm:check: no tracked core at ${prebuilt} — the app cannot build without it.`);
  process.exit(1);
}

if (!existsSync(join(emsdk, 'emsdk_env.sh'))) {
  console.log(
    `wasm:check: SKIPPED — no emsdk at ${emsdk}, so the tracked core cannot be verified here.`,
  );
  console.log('  This is not a pass. CI has the toolchain and runs this check for real.');
  process.exit(0);
}

console.log('wasm:check: rebuilding to compare against the tracked core…');
execFileSync('bash', ['motionwave/wasm/build.sh'], { stdio: 'inherit' });

const a = readFileSync(prebuilt);
const b = readFileSync(fresh);
if (a.length !== b.length || !a.equals(b)) {
  console.error('');
  console.error('wasm:check: the tracked core is NOT what this source builds.');
  console.error(`  tracked ${a.length} bytes, freshly built ${b.length} bytes`);
  console.error('');
  console.error('The build script has already refreshed it. Commit the change:');
  console.error('  git add motionwave/wasm/prebuilt/motionwave.worklet.js');
  process.exit(1);
}

console.log(`wasm:check: the tracked core matches this source (${a.length} bytes).`);
