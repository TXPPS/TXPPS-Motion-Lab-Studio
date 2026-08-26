/**
 * Every layer below this one is only as true as the fact that it ran.
 *
 *   node scripts/check-checks.mjs --check   # static; runs in the build
 *   node scripts/check-checks.mjs           # and prove each gate can fail
 *   node scripts/check-checks.mjs --list    # the inventory, no verdicts
 *
 * Three findings, one shape. `tsconfig.e2e.json` was correct and invoked by
 * nothing, so thirty-one spec files were compiled by nothing. The panel spec
 * ran and could not fail, because the worklet it needed had been renamed. And
 * `wasm:check` compared a file against itself, passing every time, on every
 * input. In all three the check existed and its existence is what stopped
 * anybody asking — which is why the answer cannot be another check that
 * somebody has to remember to run.
 *
 * So: `--check` in the build. It enumerates what this repository declares it
 * checks — every npm script, every TypeScript project, every spec file under
 * every suite root — and fails if any of them is reached by nothing, or has no
 * entry in `checks/mutants.mjs` saying how it is known to be able to fail. The
 * full run then applies each of those mutations and requires the check to go
 * red. A `gate` that comes back green under its own mutation is a green column
 * that means nothing, and it is what this is for.
 */
import { execSync } from 'node:child_process';
import {
  ROOT,
  SUITES,
  npmScripts,
  specFiles,
  tsProjects,
  unclaimedInRoot,
} from './checks/inventory.mjs';
import { reachability } from './checks/reach.mjs';
import { CHECKS, DIRECT } from './checks/mutants.mjs';
import { runGate } from './checks/gates.mjs';

const STATIC_ONLY = process.argv.includes('--check');
const LIST_ONLY = process.argv.includes('--list');
const FILTER = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '';

const scripts = npmScripts();
const reach = reachability(scripts);
const problems = [];
const notes = [];

// ------------------------------------------------------- every script is known

for (const name of scripts.keys()) {
  if (!CHECKS[name]) {
    problems.push(
      `npm script "${name}" has no entry in scripts/checks/mutants.mjs. ` +
        'Say whether it is a check and how it can fail, or why it is not one.',
    );
  }
}
for (const name of Object.keys(CHECKS)) {
  if (!scripts.has(name)) {
    problems.push(`mutants.mjs has an entry for "${name}", which is not an npm script any more.`);
  }
}
for (const [name, entry] of Object.entries(CHECKS)) {
  if (entry.kind === 'tool' && !entry.why)
    problems.push(`"${name}" is marked a tool with no reason.`);
  if (entry.kind === 'gate' && !entry.mutate && entry.expect !== 'unfalsifiable') {
    problems.push(`"${name}" is a gate with no mutation.`);
  }
}
for (const [path, entry] of Object.entries(DIRECT)) {
  if (!reach.allText.includes(path))
    problems.push(`${path} is declared here and invoked by nothing.`);
  if (entry.expect === 'unfalsifiable' && !entry.unfalsifiableBecause) {
    problems.push(`${path}: expect is unfalsifiable and no reason is given.`);
  }
}

// --------------------------------------------------------- and is reached

/** Runs on a push, runs when documented, or runs when somebody remembers. */
const routeOf = (name) =>
  reach.byCi.has(name)
    ? 'ci'
    : reach.byDocs.has(name)
      ? 'documented'
      : CHECKS[name]?.manual
        ? 'manual'
        : 'orphan';

const checkNames = Object.entries(CHECKS)
  .filter(([, e]) => e.kind !== 'tool')
  .map(([n]) => n);

for (const name of checkNames) {
  if (routeOf(name) === 'orphan') {
    problems.push(
      `"${name}" is a ${CHECKS[name].kind} and nothing runs it: not a CI step, not a command ` +
        'in CLAUDE.md. It runs when somebody remembers, which is how the last three got missed.',
    );
  }
}

// ------------------------------------------------------- TypeScript projects

const projects = tsProjects();
const referenced = new Set([...projects.values()].flatMap((p) => p.references));
for (const [path] of projects) {
  if (path.startsWith('node_modules/')) continue;
  const named = reach.allText.includes(path.split('/').pop()) || reach.allText.includes(path);
  if (!named && !referenced.has(path)) {
    problems.push(
      `${path} is a TypeScript project and nothing compiles it. That is exactly what ` +
        'tsconfig.e2e.json was, and it cost thirty-one spec files.',
    );
  }
}

// --------------------------------------------------------------- spec files

for (const suite of SUITES) {
  const files = specFiles(suite);
  if (files.length === 0) problems.push(`${suite.root} holds no spec files at all.`);
  for (const { file, declares } of files) {
    if (!declares) problems.push(`${file} is in a suite root and declares no test.`);
  }
  for (const orphan of unclaimedInRoot(suite)) {
    problems.push(
      `${orphan} looks like a spec and does not match ${suite.id}'s pattern ` +
        `${suite.pattern}, so its runner will never see it.`,
    );
  }
  notes.push(`${suite.id}: ${files.length} file(s) under ${suite.root} (${suite.config})`);
}

// ------------------------------------------------------------------- report

if (LIST_ONLY) {
  console.log('Declared checks, and what runs them:\n');
  for (const name of checkNames.sort()) {
    console.log(`  ${routeOf(name).padEnd(11)} ${CHECKS[name].kind.padEnd(10)} ${name}`);
  }
  console.log('');
  for (const n of notes) console.log(`  ${n}`);
  process.exit(0);
}

if (problems.length > 0) {
  console.error('check-checks failed:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('');
  process.exit(1);
}

const byRoute = { ci: 0, documented: 0, manual: 0, orphan: 0 };
for (const name of checkNames) byRoute[routeOf(name)] += 1;
console.log(
  `check-checks --check: ${checkNames.length} declared check(s) — ` +
    `${byRoute.ci} on every push, ${byRoute.documented} documented, ` +
    `${byRoute.manual} manual with a reason; ` +
    `${projects.size} TypeScript project(s) compiled; ` +
    `${SUITES.reduce((n, s) => n + specFiles(s).length, 0)} spec file(s), each declaring tests.`,
);
if (STATIC_ONLY) process.exit(0);

// ------------------------------------------------------ the gates, for real

/**
 * What each suite's own runner says it will execute.
 *
 * The static pass proves a spec file declares tests; this proves the runner
 * agrees it exists. They are different claims, and it is the second one the
 * panel spec failed — the file was there, the tests were there, and the runner
 * was pointed somewhere else.
 */
function enumerated(suite) {
  try {
    if (suite.id === 'test' || suite.id === 'test:mw') {
      const config = suite.id === 'test:mw' ? ` --config ${suite.config}` : '';
      // Through a shell rather than `execFileSync`: on Windows the runners are
      // `.cmd` shims, and spawning one directly fails with EINVAL — which read
      // as "the suite could not be enumerated" and would have quietly left this
      // half of the sweep doing nothing.
      const out = execSync(`npx vitest list --filesOnly${config}`, {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 240_000,
      });
      return new Set(
        out
          .split('\n')
          .map((l) => l.trim().split('\\').join('/'))
          .filter((l) => suite.pattern.test(l))
          .map((l) => l.replace(/^.*?(tests|motionwave)\//, (m, g) => `${g}/`)),
      );
    }
    if (suite.id === 'e2e' || suite.id === 'e2e:mw') {
      const config = suite.id === 'e2e:mw' ? ` --config ${suite.config}` : '';
      const out = execSync(`npx playwright test --list --reporter=json${config}`, {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 240_000,
        maxBuffer: 64 * 1024 * 1024,
      });
      const files = new Set();
      const walk = (node) => {
        if (node?.file) files.add(String(node.file).split('\\').join('/'));
        for (const child of node?.suites ?? []) walk(child);
      };
      for (const s of JSON.parse(out).suites ?? []) walk(s);
      return files;
    }
    return null; // test:core enumerates by compiling; --run does not do that here
  } catch (e) {
    console.log(`  ${suite.id}: could not enumerate — ${String(e.message).split('\n')[0]}`);
    return null;
  }
}

console.log('\nWhat each runner says it will execute:');
let missing = 0;
for (const suite of SUITES) {
  if (FILTER && !suite.id.includes(FILTER)) continue;
  const listed = enumerated(suite);
  if (!listed) continue;
  const dead = specFiles(suite).filter(
    ({ file }) => ![...listed].some((l) => l.endsWith(file.split('/').pop())),
  );
  missing += dead.length;
  console.log(
    `  ${suite.id.padEnd(10)} ${listed.size} file(s) listed, ${dead.length} on disk unseen` +
      (dead.length ? `: ${dead.map((d) => d.file).join(', ')}` : ''),
  );
}

console.log('\nEach gate, mutated:');
const verdicts = [];
for (const [name, entry] of Object.entries(CHECKS)) {
  if (entry.kind !== 'gate') continue;
  if (FILTER && !name.includes(FILTER)) continue;
  const result = runGate(name, entry.command ?? `npm run ${name} --silent`, entry);
  verdicts.push({ name, ...result });
  console.log(`  ${result.verdict.padEnd(8)} ${name}${result.why ? ` — ${result.why}` : ''}`);
}
for (const [path, entry] of Object.entries(DIRECT)) {
  if (FILTER && !path.includes(FILTER)) continue;
  const result = runGate(path, `node ${path}`, entry);
  verdicts.push({ name: path, ...result });
  console.log(`  ${result.verdict.padEnd(8)} ${path}${result.why ? ` — ${result.why}` : ''}`);
}

const bad = verdicts.filter((v) => v.verdict === 'DECAYED' || v.verdict === 'BROKEN');
console.log(
  `\n${verdicts.length} gate(s): ` +
    ['HELD', 'BLOCKED', 'KEPT', 'DECAYED', 'BROKEN']
      .map((v) => `${verdicts.filter((x) => x.verdict === v).length} ${v}`)
      .join(', ') +
    `; ${missing} spec file(s) on disk that no runner listed.`,
);
process.exit(bad.length > 0 || missing > 0 ? 1 : 0);
