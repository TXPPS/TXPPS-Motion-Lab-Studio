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
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from './inventory.mjs';

const TIMEOUT_MS = 240_000;

/** Run a command; report only whether it succeeded. */
function run(command, env = {}) {
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
function apply(mutate) {
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

/** Whether a C++ compiler exists, which `curve:check` needs to answer at all. */
export function hasCompiler() {
  try {
    execSync('g++ --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
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
  if (entry.needs === 'emsdk' && !existsSync(join(process.env.EMSDK_DIR ?? '/home/user/emsdk'))) {
    return { verdict: 'BLOCKED', why: 'no activated emsdk on this host' };
  }
  if (entry.needs === 'g++' && !hasCompiler()) {
    return { verdict: 'BLOCKED', why: 'no C++ compiler on this host' };
  }
  if (entry.needs === 'dist' && !existsSync(join(ROOT, 'dist'))) {
    return { verdict: 'BLOCKED', why: 'no dist/ — run `npm run build` first' };
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

  let undo = () => {};
  let staged = false;
  try {
    undo = apply(entry.mutate);
    if (entry.stages) {
      execSync(`git add -f -- "${entry.mutate.file}"`, { cwd: ROOT, stdio: 'ignore' });
      staged = true;
    }
    const mutated = run(command, env);
    return mutated.ok
      ? { verdict: 'DECAYED', why: 'the mutation went through and the check still passed' }
      : { verdict: 'HELD', why: '' };
  } catch (e) {
    return { verdict: 'BROKEN', why: `the mutation could not be applied: ${e.message}` };
  } finally {
    if (staged) {
      try {
        execSync(`git reset -q -- "${entry.mutate.file}"`, { cwd: ROOT, stdio: 'ignore' });
      } catch {
        console.error(`  could not unstage ${entry.mutate.file} — unstage it by hand`);
      }
    }
    undo();
  }
}
