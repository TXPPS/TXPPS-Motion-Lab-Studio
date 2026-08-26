#!/usr/bin/env node
/**
 * Point git at `.githooks/`, on `npm install`.
 *
 * `.git/hooks` is not tracked, so a hook committed to the repository does
 * nothing until something says where it is. Running that by hand would put the
 * pre-push guard in the same class as the rule it replaces — a thing that works
 * when somebody remembers — so it hangs off `prepare`, which npm runs after an
 * install without being asked.
 *
 * It never fails the install. A tarball unpacked outside a repository, a
 * builder that fetched the source without `.git`, a git that is not on the path:
 * none of those is a reason to stop `npm install`, and a `prepare` that can
 * refuse is one somebody deletes. What matters is that a *developer's* checkout
 * gets the hook, and every one of those has a git.
 *
 * @clone: working-tree — it sets a config value and asks nothing about history,
 * so a `--depth 1` clone answers it exactly as well as a full one.
 */
import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' });
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
  console.log('install-hooks: core.hooksPath -> .githooks (pre-push checks the build tree)');
} catch {
  console.log('install-hooks: not a git checkout, or no git — skipped.');
}
