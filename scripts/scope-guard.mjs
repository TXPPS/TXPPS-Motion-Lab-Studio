#!/usr/bin/env node
/**
 * Refuse a commit that stages files outside the declared work scope.
 *
 * Directive 05 §4. `git add` of a broad path has swept sub-agent work into a
 * commit twice: the audit screenshots in Directive 02, and Stream C's framework
 * files in Directive 04. Both times it was caught and self-reported afterwards,
 * which is the problem — a rule that depends on remembering is not a rule, and
 * "be careful with `git add -A`" has now failed twice while being believed.
 *
 * So scope is *declared*, never inferred. Before committing, the agent states
 * which paths this commit is about:
 *
 *     MW_SCOPE='motionwave/core motionwave/wasm' node scripts/scope-guard.mjs
 *
 * and anything staged outside those paths stops the commit with a list. The
 * declaration is the point: inferring scope from what happens to be staged
 * would accept exactly the sweep this exists to reject, because a sweep looks
 * like a wide scope.
 *
 * The escape hatch requires *naming* what is being swept in and why:
 *
 *     MW_SCOPE='docs' MW_SCOPE_ALSO='package.json:the test script moved' \
 *       node scripts/scope-guard.mjs
 *
 * A reason is mandatory and is not checked for quality — the value is in having
 * had to write one. An unexplained path is what gets rejected.
 */
import { execSync } from 'node:child_process';

const scope = (process.env.MW_SCOPE ?? '').trim();
const also = (process.env.MW_SCOPE_ALSO ?? '').trim();

if (scope === '') {
  console.error('scope-guard: MW_SCOPE is not set.\n');
  console.error('Declare what this commit is about, as space-separated path prefixes:');
  console.error("  MW_SCOPE='motionwave/core docs/UNIT_LEDGER.md' git commit ...\n");
  console.error('Scope is declared rather than inferred on purpose: inferring it from what');
  console.error('happens to be staged would accept the accidental sweep this exists to stop.');
  process.exit(1);
}

const prefixes = scope.split(/\s+/).filter(Boolean);

/**
 * Paths allowed despite being outside the scope, each with its stated reason.
 *
 * `path:reason`, comma-separated. The reason is never inspected; requiring one
 * is the mechanism, because a person who has to write "why is this here"
 * usually notices when the answer is "I do not know".
 */
const exempt = new Map();
for (const entry of also
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)) {
  const at = entry.indexOf(':');
  if (at <= 0 || entry.slice(at + 1).trim() === '') {
    console.error(`scope-guard: MW_SCOPE_ALSO entry "${entry}" has no reason.`);
    console.error('Use path:reason — an unexplained exemption is what this rejects.');
    process.exit(1);
  }
  exempt.set(entry.slice(0, at).trim(), entry.slice(at + 1).trim());
}

let staged = [];
try {
  staged = execSync('git diff --cached --name-only', { encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
} catch (e) {
  console.error(`scope-guard: could not read the index: ${String(e)}`);
  process.exit(1);
}

if (staged.length === 0) {
  console.log('scope-guard: nothing staged');
  process.exit(0);
}

const inScope = (path) =>
  prefixes.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`));

const strays = staged.filter((p) => !inScope(p) && !exempt.has(p));

if (strays.length > 0) {
  console.error(`scope-guard: ${strays.length} staged path(s) outside the declared scope.\n`);
  console.error(`  scope: ${prefixes.join(' ')}\n`);
  for (const p of strays) console.error(`  ${p}`);
  console.error('\nEither unstage them, widen MW_SCOPE if they genuinely belong to this commit,');
  console.error("or name each one in MW_SCOPE_ALSO as 'path:why it is here'.");
  console.error('\nThis has caught two real sweeps of sub-agent work. Do not widen the scope');
  console.error('to make it quiet — check whether another agent is still writing those files.');
  process.exit(1);
}

const noted = exempt.size > 0 ? `, ${exempt.size} named exemption(s)` : '';
console.log(`scope-guard: ${staged.length} staged path(s), all in scope${noted}`);
