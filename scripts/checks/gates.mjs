/**
 * Run a check clean, run it mutated, and require it to disagree with itself.
 *
 * The strong form of "this check works". A check that passes proves nothing on
 * its own — `wasm:check` passed for weeks while comparing a file against
 * itself, and every green in that column was true and meaningless. What says a
 * check is load-bearing is that breaking the thing it reads turns it red.
 *
 * Every mutation is applied to a copy-on-disk and restored in a `finally`, so
 * an interrupted run leaves the tree as it found it.
 *
 * @clone: index — it stages and unstages one file for `scope-guard`'s gate, and
 * checks out what a mutated run rewrote. Nothing here asks about a commit, so a
 * shallow clone answers every question it has.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from './inventory.mjs';
import { emsdkToolchain } from '../emcxx.mjs';

const TIMEOUT_MS = 240_000;

/** Run a command; report only whether it succeeded. */
export function run(command, env = {}) {
  try {
    execSync(command, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: TIMEOUT_MS,
    });
    return { ok: true, output: '' };
  } catch (e) {
    return { ok: false, output: String(e.stdout ?? '') + String(e.stderr ?? '') };
  }
}

/**
 * Apply a mutation and hand back the undo.
 *
 * A created file is deleted; an edited one is restored from a copy rather than
 * from the reverse edit, because a reverse edit that does not match leaves the
 * tree quietly wrong and this runs against the working copy.
 */
export function apply(mutate) {
  const path = join(ROOT, mutate.file);
  if (mutate.content !== undefined) {
    if (existsSync(path)) throw new Error(`${mutate.file} already exists`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, mutate.content);
    return () => rmSync(path, { force: true });
  }
  const backup = `${path}.mutant-backup`;
  const src = readFileSync(path, 'utf8');
  if (!src.includes(mutate.from)) throw new Error(`${mutate.file} does not contain the anchor`);
  copyFileSync(path, backup);
  writeFileSync(path, src.replace(mutate.from, mutate.to));
  return () => {
    copyFileSync(backup, path);
    rmSync(backup, { force: true });
  };
}

/**
 * Put back anything the *check* rewrote, not just what the edit touched.
 *
 * `wasm:check` runs `build.sh`, which copies its output over the tracked
 * `prebuilt/` core as its last step. So a run against an edited source leaves a
 * mutant artefact in git — correctly reported as not matching its source, and
 * then left there for whoever committed next. Shared with the satisfiability
 * driver because it disturbs exactly the same files.
 */
export function restore(paths) {
  for (const path of paths ?? []) {
    try {
      execSync(`git checkout -- "${path}"`, { cwd: ROOT, stdio: 'ignore' });
    } catch {
      console.error(`  could not restore ${path} — check it out by hand`);
    }
  }
}

/**
 * Whether *any* C++ compiler exists, which `curve:check` needs to answer at all.
 *
 * It used to ask only `g++`, and reported BLOCKED — "no C++ compiler on this
 * host" — on a machine that had been compiling forty-two core suites through
 * emsdk's clang since `run-core-tests.mjs` was written. Three consecutive
 * summaries carried that verdict. BLOCKED is not DECAYED and it is not a pass
 * either; it is a claim about the host, and this one was false.
 */
export function hasCompiler() {
  try {
    execSync('g++ --version', { stdio: 'ignore' });
    return true;
  } catch {
    return emsdkToolchain() !== null;
  }
}

/** Whether the git index is empty, which `scope-guard`'s mutation requires. */
export function indexIsEmpty() {
  try {
    return execSync('git diff --cached --name-only', { cwd: ROOT, encoding: 'utf8' }).trim() === '';
  } catch {
    return false;
  }
}

/**
 * Whether the tracked tree is exactly `HEAD`, which `push-guard`'s subject is.
 *
 * `push-guard` compares a *commit* against what the last build read, so on a
 * working tree with edits in it the check is correctly red before anything has
 * been done to it — and `runGate` would read that as BROKEN and say the check is
 * failing, which is a claim about the check rather than about the tree. BLOCKED
 * is the right verdict and it is the same distinction the compiler cases draw:
 * a check that cannot be asked here has not stopped mattering.
 *
 * Untracked files are not part of a commit and are not part of the question.
 */
export function committedCleanly() {
  try {
    const dirty = execSync('git status --porcelain --untracked-files=no', {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    return dirty === '';
  } catch {
    return false;
  }
}

/**
 * One gate: clean must pass, mutated must fail.
 *
 * Four verdicts, and they are not interchangeable. `HELD` is the check working.
 * `DECAYED` is a check that no longer notices the thing it was written for.
 * `BROKEN` is a check that is red before anything was done to it, which makes
 * the mutation unreadable either way. `BLOCKED` is this host being unable to
 * enter the branch at all — a missing toolchain, an absent `dist/` — and it is
 * not `DECAYED`: a check that could not run here has not stopped mattering.
 */
export function runGate(name, command, entry) {
  // Asked of `em++.py` rather than of a directory, and through the one place
  // that knows where emsdk is. The directory test used a default path this host
  // does not use, so it answered a question about a machine that is not this
  // one — and a directory that exists without emscripten in it would have
  // answered "available" and then failed for a reason nobody could read.
  if (entry.needs === 'emsdk' && emsdkToolchain() === null) {
    return { verdict: 'BLOCKED', why: 'no emscripten on this host — set EMSDK_DIR' };
  }
  if (entry.needs === 'g++' && !hasCompiler()) {
    return { verdict: 'BLOCKED', why: 'no C++ compiler on this host' };
  }
  if (entry.needs === 'dist' && !existsSync(join(ROOT, 'dist'))) {
    return { verdict: 'BLOCKED', why: 'no dist/ — run `npm run build` first' };
  }
  if (entry.needs === 'committed') {
    if (!existsSync(join(ROOT, '.build-tree.json'))) {
      return { verdict: 'BLOCKED', why: 'no build has been recorded — run `npm run build`' };
    }
    if (!committedCleanly()) {
      return {
        verdict: 'BLOCKED',
        why: 'the working tree differs from HEAD; this asks about a commit',
      };
    }
  }
  if (entry.stages && !indexIsEmpty()) {
    return { verdict: 'BLOCKED', why: 'the git index is not empty and this gate stages a file' };
  }
  if (entry.expect === 'unfalsifiable') {
    return { verdict: 'KEPT', why: entry.unfalsifiableBecause };
  }

  const env = entry.env ?? {};
  const clean = run(command, env);
  if (!clean.ok) {
    return {
      verdict: 'BROKEN',
      why: `it is already failing: ${clean.output.trim().split('\n').slice(-3).join(' / ')}`,
    };
  }

  /*
   * A check can be load-bearing in more than one way, and each way is its own
   * claim.
   *
   * `docs-guard` enforces four unrelated rules and one mutation could only ever
   * speak for one of them. Its completeness rule — added because `SOAK.md` was
   * truncated to three lines while every other rule stayed green — would have
   * been proved by nothing at all while the entry read HELD, which is a green
   * column meaning less than it appears to. So `mutate` may be a list, and
   * every one of them has to turn the check red for the gate to hold.
   */
  const mutations = Array.isArray(entry.mutate) ? entry.mutate : [entry.mutate];
  for (const mutation of mutations) {
    const settled = runOneMutation(command, env, entry, mutation);
    if (settled) return settled;
  }
  return {
    verdict: 'HELD',
    why: mutations.length > 1 ? `${mutations.length} mutations, each of them caught` : '',
  };
}

/** One mutation: a verdict if it settles the gate, null if the check caught it. */
function runOneMutation(command, env, entry, mutation) {
  let undo = () => {};
  let staged = false;
  try {
    undo = apply(mutation);
    if (entry.stages) {
      execSync(`git add -f -- "${mutation.file}"`, { cwd: ROOT, stdio: 'ignore' });
      staged = true;
    }
    const mutated = run(command, env);
    return mutated.ok
      ? { verdict: 'DECAYED', why: `the mutation to ${mutation.file} went through and it passed` }
      : null;
  } catch (e) {
    return { verdict: 'BROKEN', why: `the mutation could not be applied: ${e.message}` };
  } finally {
    if (staged) {
      try {
        execSync(`git reset -q -- "${mutation.file}"`, { cwd: ROOT, stdio: 'ignore' });
      } catch {
        console.error(`  could not unstage ${mutation.file} — unstage it by hand`);
      }
    }
    undo();
    /*
     * And anything the *check* rewrote, not just what the mutation edited.
     *
     * `wasm:check` runs `build.sh`, which copies its output over the tracked
     * `prebuilt/` core as its last step. So the mutated run leaves a mutant
     * artefact in git — a core with a shelf plateau of 2.75 sitting in a
     * tracked file, correctly reported as not matching its source and then left
     * there for whoever committed next. The gate has to put back everything it
     * disturbed, not everything it meant to.
     */
    restore(entry.restores);
  }
}
