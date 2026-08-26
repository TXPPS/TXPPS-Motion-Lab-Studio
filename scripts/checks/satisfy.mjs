/**
 * Prove each check can *pass*, not only that it can fail.
 *
 * `gates.mjs` proves a check is load-bearing: break what it reads and it goes
 * red. That is half the question, and the other half cost a deploy.
 *
 * `docs-guard`'s currency rule compared the bundle `SOAK.md` declares against
 * `dist/`, and it could never have been satisfied: `vite.config.ts` compiles the
 * commit date into the bundle, so committing the fresh report is itself enough
 * to invalidate the name the report has just been made to carry. It would have
 * held its mutation test — break the declaration and it went red — and it was
 * unsatisfiable anyway. **A check that cannot be satisfied gets turned off**,
 * and turning one off is this whole apparatus failing by a side door.
 *
 * So every check declares a *constructed passing state*, in one of two shapes:
 *
 *  - `repair` — apply the gate's own mutation, run the documented writer, and
 *    the check must go green again. The strong form, and the one that would
 *    have caught the currency rule: it asks whether the state the check demands
 *    is reachable by doing the thing the error message tells you to do.
 *  - `edits` — a legal addition the check is supposed to tolerate. For a guard
 *    with no writer: a correctly licensed file, a document with a registry
 *    entry, a spec that presses through a real pointer.
 *
 * The verdicts:
 *
 *  - `ACCEPTS` — the constructed state passed. The check can be satisfied.
 *  - `REFUSES` — it did not. Either the check is unsatisfiable, or it is
 *    stricter than it says it is; both are findings and neither is a pass.
 *  - `KEPT`    — declared, with a reason, as having no constructible case.
 *  - `BLOCKED` — this host cannot run the check at all.
 *  - `BROKEN`  — the case would not apply, so the answer is unreadable.
 *
 * @clone: full-history — it makes a `--depth 1` clone of this repository to ask
 * whether a guard survives one. That needs something to truncate, so running
 * this driver from inside a shallow clone would prove nothing; `runShallow`
 * reports the clone's own failure rather than pretending.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './inventory.mjs';
import { apply, hasCompiler, indexIsEmpty, restore, run } from './gates.mjs';
import { emsdkToolchain } from '../emcxx.mjs';

/** Why this host cannot answer at all, or null. */
function blockedBecause(entry) {
  if (entry.needs === 'emsdk' && emsdkToolchain() === null) {
    return 'no emscripten on this host — set EMSDK_DIR';
  }
  if (entry.needs === 'g++' && !hasCompiler()) return 'no C++ compiler on this host';
  if (entry.needs === 'dist' && !existsSync(join(ROOT, 'dist'))) {
    return 'no dist/ — run `npm run build` first';
  }
  if (entry.satisfy?.stages && !indexIsEmpty()) {
    return 'the git index is not empty and this case stages a file';
  }
  return null;
}

/**
 * One check, run against a state built to satisfy it.
 *
 * The clean run comes first for the same reason it does in `runGate`: a check
 * that is already red makes every later verdict unreadable, and reporting
 * `REFUSES` for a check the tree was already failing would send somebody
 * looking at the wrong thing entirely.
 */
export function runSatisfy(name, command, entry) {
  if (entry.satisfiedBy) return { verdict: 'KEPT', why: entry.satisfiedBy };
  if (!entry.satisfy) {
    return { verdict: 'BROKEN', why: 'no constructed passing state is declared for this check' };
  }
  // A check may declare more than one constructed state, and several do: a
  // guard that reads git has one case for the legal edit it must tolerate and
  // another for the shallow clone Cloudflare hands it. All of them have to
  // accept, and the first that does not is the verdict.
  const cases = Array.isArray(entry.satisfy) ? entry.satisfy : [entry.satisfy];
  for (const spec of cases) {
    const result = runCase(command, entry, spec);
    if (result.verdict !== 'ACCEPTS') {
      return { ...result, why: `${spec.name ? `${spec.name}: ` : ''}${result.why}` };
    }
  }
  return {
    verdict: 'ACCEPTS',
    why: cases
      .map((c) => c.name)
      .filter(Boolean)
      .join('; '),
  };
}

/**
 * A shallow clone of this repository, and the command run inside it.
 *
 * This is standing rule one made executable. `docs-guard` asked git whether
 * eleven commits existed; Cloudflare's builder clones with `--depth 1`, had
 * fetched none of them, failed all eleven and took `npm run build` down with
 * it. A claim about the repository, made from a truncated copy of it, is the
 * same error as BLOCKED being a claim about the host — and the only way to know
 * is to make the truncated copy and ask.
 *
 * `file://` rather than a bare path: git ignores `--depth` on a local-path
 * clone, and a clone that quietly had full history would answer the wrong
 * question and answer it green.
 */
function runShallow(command, env) {
  // And the same discipline turned on itself: cloning a shallow repository
  // shallower proves nothing, so this says it cannot answer rather than
  // reporting a truncation it did not cause.
  try {
    const already = execSync('git rev-parse --is-shallow-repository', {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    if (already === 'true') {
      return {
        ok: false,
        blocked: 'this checkout is already shallow; there is nothing to truncate',
      };
    }
  } catch {
    return { ok: false, blocked: 'git could not be asked about this checkout' };
  }
  const url = `file:///${ROOT.split('\\').join('/').replace(/^\/+/, '')}`;
  const dir = mkdtempSync(join(tmpdir(), 'mw-shallow-'));
  try {
    execSync(`git clone --depth 1 --quiet "${url}" "${dir}"`, {
      stdio: 'ignore',
      timeout: 240_000,
    });
    execSync(command, {
      cwd: dir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 240_000,
    });
    return { ok: true, output: '' };
  } catch (e) {
    return { ok: false, output: String(e.stdout ?? '') + String(e.stderr ?? '') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One constructed passing state. */
function runCase(command, entry, spec) {
  const blocked = blockedBecause({ ...entry, satisfy: spec });
  if (blocked) return { verdict: 'BLOCKED', why: blocked };

  const env = { ...(entry.env ?? {}), ...(spec.env ?? {}) };
  if (spec.shallow) {
    const shallow = runShallow(command, env);
    if (shallow.blocked) return { verdict: 'BLOCKED', why: shallow.blocked };
    return shallow.ok
      ? { verdict: 'ACCEPTS', why: '' }
      : {
          verdict: 'REFUSES',
          why: `it failed in a shallow clone, which is what the deploy builder makes: ${shallow.output
            .trim()
            .split('\n')
            .slice(-3)
            .join(' / ')}`,
        };
  }
  const clean = run(command, env);
  if (!clean.ok) {
    return {
      verdict: 'BROKEN',
      why: `already failing before the case was applied: ${clean.output
        .trim()
        .split('\n')
        .slice(-2)
        .join(' / ')}`,
    };
  }

  // `repair` reuses the gate's own mutation on purpose. The claim is not "some
  // state passes" — the tree we started from already passes — but "the state
  // this check demands is reachable from a broken one by running what it tells
  // you to run", which is precisely what the currency rule could not do.
  const edits = spec.repair ? [entry.mutate] : (spec.edits ?? []);
  const undos = [];
  try {
    // Applied one at a time, and a thunk is resolved after the edits before it
    // have landed — `docs-guard:release`'s case has to read the fingerprint of
    // a tree the previous edit has already changed.
    for (const edit of edits) undos.push(apply(typeof edit === 'function' ? edit() : edit));
    if (spec.repair) {
      const repaired = run(spec.repair, env);
      if (!repaired.ok) {
        return {
          verdict: 'REFUSES',
          why: `the documented repair (\`${spec.repair}\`) failed: ${repaired.output
            .trim()
            .split('\n')
            .slice(-2)
            .join(' / ')}`,
        };
      }
    }
    const withCase = run(command, env);
    return withCase.ok
      ? { verdict: 'ACCEPTS', why: '' }
      : {
          verdict: 'REFUSES',
          why: `it rejected a state it is supposed to accept: ${withCase.output
            .trim()
            .split('\n')
            .slice(-3)
            .join(' / ')}`,
        };
  } catch (e) {
    return { verdict: 'BROKEN', why: `the case could not be applied: ${e.message}` };
  } finally {
    // Undone in reverse, because a later edit may sit inside a file an earlier
    // one created and restoring the outer first would strand it.
    for (const undo of undos.reverse()) undo();
    restore(spec.restores ?? entry.restores);
  }
}
