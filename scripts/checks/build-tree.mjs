#!/usr/bin/env node
/**
 * The build goes after the last edit — made structural rather than remembered.
 *
 *   node scripts/checks/build-tree.mjs --record               # the build's last step
 *   node scripts/checks/build-tree.mjs --verify               # by hand, about HEAD
 *   node scripts/checks/build-tree.mjs --verify --from-stdin  # the pre-push hook
 *
 * A commit was pushed that could not have built. Splitting `mutants.mjs` moved
 * a scripted-press string literal into a file `gesture-guard` does not exempt by
 * name, `npm run build` exited, and the deploy never happened. The cause is not
 * interesting and that is the point: the build was run, then the split was done,
 * and the build was not run again. `check-checks --check`, `lint` and
 * `format:check` all passed afterwards and not one of them is the build.
 *
 * This repository has learnt the same lesson three times now — `git add -A`
 * sweeping another agent's work in twice, and this. A rule that depends on
 * remembering is not a rule. `WetDryMixer`'s constructor is private and
 * `scope-guard` refuses an undeclared commit for the same reason: the ordering
 * has to be unforgettable rather than memorable.
 *
 * So the build records what it ran against, and the push compares.
 *
 * **What is compared, and why it is not simply two tree hashes.** A tree hash
 * of the working copy includes untracked files, so a scratch file that never
 * gets committed would refuse every push for ever — and a check that refuses
 * work nobody did wrong gets turned off, which is the failure mode the
 * satisfiability rule exists to catch. So the record is a manifest, and the
 * comparison runs over the paths that are actually in the commit:
 *
 *   1. Every path in the pushed commit must be in the manifest with the same
 *      blob. That catches a file edited after the build, and a file the commit
 *      contains that the build never read.
 *   2. Every path the manifest says was *tracked* must be in the commit. That
 *      catches a deletion made after the build, which rule 1 cannot see.
 *
 * An untracked path is in neither rule, which is exactly right: it is not in
 * the commit, so it is not part of what is being pushed.
 *
 * @clone: index — it writes a scratch index to hash the working tree, and reads
 * `ls-tree` of the commit being pushed. Both work in a `--depth 1` clone; the
 * commit being pushed is by definition present, and nothing here walks history.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const RECORD = join(ROOT, '.build-tree.json');
const ZERO = '0'.repeat(40);

const git = (args, opts = {}) =>
  execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });

/**
 * Every path git would put in a commit made from the working tree right now.
 *
 * Through a scratch index rather than the real one. `git add -A` against the
 * repository's own index would stage the developer's tree as a side effect of
 * running a build, which is the `git add -A` sweep this repository has already
 * been bitten by twice — a guard that quietly stages work would be a worse
 * defect than the one it exists to catch.
 */
function workingTree() {
  const dir = mkdtempSync(join(tmpdir(), 'mw-buildtree-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') };
  try {
    git(['read-tree', 'HEAD'], { env });
    git(['add', '-A'], { env });
    const files = {};
    for (const line of git(['ls-files', '-s'], { env }).split('\n')) {
      const m = /^\d+ ([0-9a-f]{40}) \d+\t(.+)$/.exec(line);
      if (m) files[m[2]] = m[1];
    }
    return files;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every path in a commit, with the blob at it. */
function committed(sha) {
  const files = {};
  for (const line of git(['ls-tree', '-r', sha]).split('\n')) {
    const m = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (m) files[m[2]] = m[1];
  }
  return files;
}

/**
 * What the build just ran against.
 *
 * Written after the build rather than before it, because "a build succeeded" is
 * the thing being recorded and that is not known until it has. The build writes
 * nothing tracked — its outputs are `dist/` and `public/worklets/`, both ignored
 * — so the tree it read and the tree recorded here are the same one.
 */
function record() {
  const files = workingTree();
  const tracked = git(['ls-files']).split('\n').filter(Boolean);
  writeFileSync(
    RECORD,
    `${JSON.stringify({ head: git(['rev-parse', 'HEAD']).trim(), tracked, files }, null, 2)}\n`,
  );
  console.log(
    `build-tree: recorded ${Object.keys(files).length} path(s) as what this build ran against.`,
  );
}

/** How the pushed commit differs from what the build read. Empty means it does not. */
function differences(sha) {
  const rec = JSON.parse(readFileSync(RECORD, 'utf8'));
  const head = committed(sha);
  const out = [];
  for (const [path, blob] of Object.entries(head)) {
    if (rec.files[path] === undefined)
      out.push(`${path} — in the commit, and the build never saw it`);
    else if (rec.files[path] !== blob) out.push(`${path} — changed after the build ran`);
  }
  const inCommit = new Set(Object.keys(head));
  for (const path of rec.tracked) {
    if (!inCommit.has(path))
      out.push(`${path} — tracked when the build ran, and not in the commit`);
  }
  return out.sort();
}

/**
 * The commits this push would publish.
 *
 * A pre-push hook is handed `<local ref> <local sha> <remote ref> <remote sha>`
 * on stdin, and only the tip of each ref matters: the tip is what gets built and
 * deployed, and requiring a green build of every commit in a range would refuse
 * every ordinary branch.
 *
 * Read only when `--from-stdin` says to, which the hook passes and a person does
 * not. Sniffing for it instead was the first draft and it hung: outside a hook
 * stdin is a pipe nobody is going to close, so `readFileSync(0)` blocks for ever
 * and the guard looks like a guard that has crashed. Run by hand the question is
 * about `HEAD`, and asking it should never be able to wedge a terminal.
 */
function pushedTips() {
  if (!process.argv.includes('--from-stdin')) {
    return [{ ref: 'HEAD', sha: git(['rev-parse', 'HEAD']).trim() }];
  }
  let stdin = '';
  try {
    stdin = readFileSync(0, 'utf8');
  } catch {
    stdin = '';
  }
  const tips = stdin
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 4 && /^[0-9a-f]{40}$/.test(p[1]) && p[1] !== ZERO)
    .map((p) => ({ ref: p[0], sha: p[1] }));
  return tips.length ? tips : [{ ref: 'HEAD', sha: git(['rev-parse', 'HEAD']).trim() }];
}

function verify() {
  /*
   * The one override, and it takes a reason for the same reason `MW_SCOPE_ALSO`
   * does: the reason is never inspected, and having to write one is the whole
   * mechanism. An override that is a bare flag is one somebody adds to their
   * shell profile.
   */
  const anyway = process.env.BUILD_OK_ANYWAY;
  if (anyway) {
    console.error(`build-tree: overridden — ${anyway}`);
    return 0;
  }
  if (!existsSync(RECORD)) {
    console.error('');
    console.error('build-tree: no build has been recorded in this checkout.');
    console.error('');
    console.error('  Run `npm run build`. Nothing here knows whether what you are pushing');
    console.error('  compiles, and the last time that was true the commit could not have.');
    console.error('');
    return 1;
  }
  for (const { ref, sha } of pushedTips()) {
    const diff = differences(sha);
    if (diff.length === 0) continue;
    console.error('');
    console.error(`build-tree: ${ref} is not the tree the last successful build ran against.`);
    console.error('');
    for (const line of diff.slice(0, 20)) console.error(`  ${line}`);
    if (diff.length > 20) console.error(`  … and ${diff.length - 20} more`);
    console.error('');
    console.error('  Run `npm run build`, then push. The build is the check and it goes after');
    console.error('  the last edit — `lint`, `format:check` and `check-checks` all pass on a');
    console.error('  tree that does not build, and all three did.');
    console.error('');
    console.error('  If you have a reason to push anyway, say what it is:');
    console.error("    BUILD_OK_ANYWAY='…' git push");
    console.error('');
    return 1;
  }
  console.log('build-tree: what you are pushing is what the last successful build read.');
  return 0;
}

const mode = process.argv[2];
if (mode === '--record') record();
else if (mode === '--verify') process.exit(verify());
else {
  console.error('usage: build-tree.mjs --record | --verify');
  process.exit(2);
}
