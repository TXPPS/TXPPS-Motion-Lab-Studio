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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

/**
 * Compared with line endings normalised.
 *
 * The same argument the generators make, and it was never applied here because
 * nobody ran this: `.gitattributes` checks the tracked artefact out as LF, and
 * a build on a Windows host writes CRLF, so the two differed by 21 bytes in a
 * 307,735-byte file and by nothing at all. The check then said "the tracked
 * core is NOT what this source builds" and told the reader to commit a file
 * whose content had not changed — which is worse than a false red, because
 * following the instruction commits line-ending churn over an artefact whose
 * whole purpose is to be bit-identical to its source.
 *
 * A `.wasm` cannot be normalised this way and must not be: it is binary, and a
 * CR inside it is data. Only the JavaScript wrapper is text, and it is the only
 * one this compares.
 */
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const normalised = (buffer) =>
  buffer
    .toString('latin1')
    .split(CR + LF)
    .join(LF);
const tracked = normalised(a);
const built = normalised(b);
if (tracked !== built) {
  console.error('');
  console.error('wasm:check: the tracked core is NOT what this source builds.');
  console.error(`  tracked ${tracked.length} bytes, freshly built ${built.length} bytes`);
  console.error('  (compared with line endings normalised, so this is a real difference)');
  console.error('');
  console.error('The build script has already refreshed it. Commit the change:');
  console.error('  git add motionwave/wasm/prebuilt/motionwave.worklet.js');
  process.exit(1);
}

/*
 * Put the tracked bytes back, now that they are known to be the right ones.
 *
 * `build.sh` copies its output over `prebuilt/` as its last step, so a *passing*
 * check leaves the working tree dirty by exactly the line endings this
 * comparison just decided were not a difference. That is not cosmetic here:
 * `npm run build` runs this check, and `vite.config.ts` compiles in the
 * commit's date for a clean tree and the wall clock for a dirty one — so a
 * build whose only dirt is 21 carriage returns produces a bundle nobody can
 * reproduce, and the deploy verification that hashes it cannot pass.
 *
 * Only on a pass. A genuine difference exits above, having said to commit it.
 */
if (!a.equals(b)) writeFileSync(prebuilt, a);

console.log(`wasm:check: the tracked core matches this source (${tracked.length} bytes).`);
