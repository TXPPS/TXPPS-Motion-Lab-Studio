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

/**
 * Where the SDK is, rather than where it was on the machine this was written on.
 *
 * A single hard-coded path meant this check reported SKIPPED on a machine with a
 * perfectly good install — and SKIPPED is the one outcome that looks like
 * success in a log while proving nothing. `.emscripten` rather than
 * `emsdk_env.sh`: the env script exists in a bare clone, the config file only
 * after `emsdk activate`, and an un-activated SDK cannot build anything.
 */
function findEmsdk() {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  for (const dir of [process.env.EMSDK_DIR, home && join(home, 'emsdk'), '/home/user/emsdk']) {
    if (dir && existsSync(join(dir, '.emscripten'))) return dir;
  }
  return null;
}
const emsdk = findEmsdk();
const prebuilt = join(root, 'motionwave/wasm/prebuilt/motionwave.worklet.js');
const fresh = join(root, 'motionwave/wasm/dist/motionwave.worklet.js');

if (!existsSync(prebuilt)) {
  console.error(`wasm:check: no tracked core at ${prebuilt} — the app cannot build without it.`);
  process.exit(1);
}

if (!emsdk) {
  console.log('wasm:check: SKIPPED — no activated emsdk found, so the tracked core');
  console.log('  cannot be verified here. Looked at: $EMSDK_DIR, ~/emsdk, /home/user/emsdk.');
  console.log('  This is not a pass. CI has the toolchain and runs this check for real.');
  process.exit(0);
}

/*
 * Read the tracked bytes BEFORE rebuilding.
 *
 * `build.sh` copies its output over `prebuilt/` as its last step — that is how
 * the tracked artefact is kept current. So a comparison made afterwards is
 * between a file and the copy of itself that was just written: it matched every
 * time, on every input, and could not have failed. A check that cannot fail
 * certifies nothing, and this one was standing guard over the exact failure it
 * could not see — a tracked core that has quietly stopped being what the source
 * builds, deployed to everyone, findable in no commit.
 */
const a = readFileSync(prebuilt);

console.log(`wasm:check: rebuilding with the SDK at ${emsdk} to compare against the tracked core…`);
execFileSync('bash', ['motionwave/wasm/build.sh'], {
  stdio: 'inherit',
  env: { ...process.env, EMSDK_DIR: emsdk },
});

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
