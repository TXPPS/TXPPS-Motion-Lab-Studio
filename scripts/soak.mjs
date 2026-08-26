/**
 * The soak — four layers, one command.
 *
 *   npm run build && npm run preview &
 *   npm run soak                      # all four layers
 *   npm run soak -- --layer=fuzz      # one of them
 *   npm run soak -- --seed=12345      # replay a fuzz failure
 *   npm run soak -- --quick           # short fuzz, short endurance
 *
 * Directive 11 §3. The four layers ask four different questions and only the
 * four together are "test everything":
 *
 *  1. **Functional** — does each function do something? One at a time, on all
 *     three form factors, with the state diffed either side.
 *  2. **Fuzz** — do they still work in combination? Ten thousand seeded steps
 *     with structural invariants after every one, and a shrink to the shortest
 *     reproducing prefix when one breaks.
 *  3. **Properties** — do the laws hold for every input rather than for an
 *     example? Save round-trips, undo inverts, automation reads back.
 *  4. **Endurance** — what drifts? Ten minutes of playing and editing, sampled
 *     eight times, judged on slope rather than on a final reading.
 *
 * **This runs against a build, and it rebuilds nothing.** §10's rule is that a
 * green test against a stale artefact proves nothing, so the run records both
 * the bundle it is talking to *and* a fingerprint of every source that bundle
 * is built from, and `docs/audit/SOAK.md` carries both.
 *
 * The fingerprint is what `npm run docs-guard:release` compares, and the bundle
 * name is for identification only. Comparing the bundle was tried and cannot
 * work: its hash moves with the commit date, so committing the fresh report is
 * itself enough to invalidate the name the report has just been made to carry.
 * A check that cannot be satisfied gets turned off, which is the failure this
 * whole apparatus exists to prevent, arriving by a side door.
 *
 * The functional layer writes `docs/audit/soak-coverage.json`, which is what
 * fills the Function Ledger's `tested` column. A row is green there only if a
 * named part of the state was seen to change — never because an invocation did
 * not throw.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { launch, openApp, seedFixture, markBaseline, FORMS, BASE } from './soak/session.mjs';
import { runFunctional } from './soak/functional.mjs';
import { replay, shrink, DEFAULT_STEPS } from './soak/fuzz.mjs';
import { runProperties } from './soak/properties.mjs';
import { runEndurance } from './soak/endurance.mjs';
import { enumerate, undrivenBy } from './functions/enumerate.mjs';
import { srcFingerprint } from './srcfingerprint.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const arg = (name, fallback) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const QUICK = process.argv.includes('--quick');
const LAYERS = (arg('layer', 'functional,fuzz,properties,endurance') ?? '').split(',');
const SEED = Number(arg('seed', String((Date.now() / 1000) | 0))) >>> 0;
const STEPS = Number(arg('steps', String(QUICK ? 600 : DEFAULT_STEPS)));
const MINUTES = Number(arg('minutes', String(QUICK ? 1 : 10)));

/**
 * The artefact this run is actually talking to.
 *
 * Named rather than assumed. A soak that passed against yesterday's bundle and
 * a report that does not say which bundle are the same thing as no soak at all,
 * and the only way to tell them apart afterwards is to write the hash down.
 */
function bundleIdentity() {
  const indexPath = join(ROOT, 'dist', 'index.html');
  if (!existsSync(indexPath))
    return { entry: 'no dist/ — preview is serving something else', hash: '' };
  const html = readFileSync(indexPath, 'utf8');
  const entry = html.match(/assets\/(index-[\w-]+\.js)/)?.[1] ?? 'unknown';
  const file = join(ROOT, 'dist', 'assets', entry);
  const hash = existsSync(file)
    ? createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16)
    : '';
  return { entry, hash };
}

const bundle = bundleIdentity();
console.log(`soak: ${BASE}, bundle ${bundle.entry} (${bundle.hash || 'unhashed'})`);
console.log(`soak: seed ${SEED}, ${STEPS} fuzz step(s), ${MINUTES} endurance minute(s)\n`);

const browser = await launch();
const report = { seed: SEED, bundle, srcFingerprint: srcFingerprint(), layers: {} };
const pageErrors = [];

// -------------------------------------------------------------- 1. functional

if (LAYERS.includes('functional')) {
  console.log('Functional sweep');
  const rows = [];
  for (const form of FORMS) {
    const { page, errors } = await openApp(browser, form);
    rows.push(...(await runFunctional({ page, form })));
    pageErrors.push(...errors.map((e) => `${form.id}: ${e}`));
    await page.close();
    const mine = rows.filter((r) => r.form === form.id);
    console.log(
      `  ${form.id.padEnd(8)} ${mine.filter((r) => r.state === 'PASS').length}/${mine.length} ` +
        'row(s) asserted a state change',
    );
  }
  report.layers.functional = rows;

  // A row is covered if *any* form factor saw it change something. A row that
  // works on a desktop and not on a phone is a §5 defect and is listed as one
  // rather than folded into a coverage number that would hide it.
  const byId = new Map();
  for (const row of rows) {
    const at = byId.get(row.id) ?? { id: row.id, forms: {}, covered: false };
    at.forms[row.form] = { state: row.state, why: row.why };
    if (row.state === 'PASS') at.covered = true;
    byId.set(row.id, at);
  }
  const coverage = [...byId.values()];
  mkdirSync(join(ROOT, 'docs', 'audit'), { recursive: true });
  writeFileSync(
    join(ROOT, 'docs', 'audit', 'soak-coverage.json'),
    `${JSON.stringify(
      { bundle, srcFingerprint: report.srcFingerprint, seed: SEED, rows: coverage },
      null,
      2,
    )}\n`,
  );
  const green = coverage.filter((r) => r.covered).length;
  console.log(`  ${green}/${coverage.length} row(s) have a state-asserting result\n`);
}

// -------------------------------------------------------------------- 2. fuzz

if (LAYERS.includes('fuzz')) {
  console.log(`Combinatorial fuzz — seed ${SEED}`);
  const { page, errors } = await openApp(browser, FORMS[2]);
  await seedFixture(page);
  await markBaseline(page);
  const started = Date.now();
  const result = await replay(page, { seed: SEED, steps: STEPS });
  const elapsed = (Date.now() - started) / 1000;
  if (result.failed) {
    console.log(`  BROKE at step ${result.at} (${result.step}): ${result.why}`);
    console.log('  shrinking…');
    const shortest = await shrink(page, SEED, result.chosen.slice(0, result.at + 1));
    console.log(`  seed ${SEED}, shortest reproducing prefix (${shortest.length} steps):`);
    console.log(`    ${shortest.map((s) => `${s.name}#${s.index}`).join(' -> ')}`);
    report.layers.fuzz = { ...result, shortest, elapsed, steps: STEPS };
    process.exitCode = 1;
  } else {
    console.log(`  ${STEPS} step(s) in ${elapsed.toFixed(1)} s, every invariant held\n`);
    report.layers.fuzz = { failed: false, steps: STEPS, elapsed };
  }
  pageErrors.push(...errors.map((e) => `fuzz: ${e}`));
  await page.close();
}

// -------------------------------------------------------------- 3. properties

if (LAYERS.includes('properties')) {
  console.log('Properties');
  const { page, errors } = await openApp(browser, FORMS[2]);
  await seedFixture(page);
  await markBaseline(page);
  const rows = await runProperties(page, SEED);
  for (const row of rows) {
    console.log(`  ${row.state.padEnd(5)} ${row.id.padEnd(30)} ${row.why ?? row.what}`);
  }
  report.layers.properties = rows;
  if (rows.some((r) => r.state === 'FAIL')) process.exitCode = 1;
  pageErrors.push(...errors.map((e) => `properties: ${e}`));
  await page.close();
  console.log('');
}

// --------------------------------------------------------------- 4. endurance

if (LAYERS.includes('endurance')) {
  console.log(`Endurance — ${MINUTES} minute(s)`);
  const { page, errors } = await openApp(browser, FORMS[2]);
  await seedFixture(page);
  await markBaseline(page);
  const result = await runEndurance(page, { minutes: MINUTES });
  for (const finding of result.findings) {
    console.log(`  ${finding.state.padEnd(7)} ${finding.id.padEnd(20)} ${finding.why}`);
  }
  report.layers.endurance = result;
  if (result.findings.some((f) => f.state === 'FAIL')) process.exitCode = 1;
  pageErrors.push(...errors.map((e) => `endurance: ${e}`));
  await page.close();
  console.log('');
}

await browser.close();

// An uncaught exception anywhere is a failure of the layer that was running,
// whatever that layer decided about its own assertions.
if (pageErrors.length > 0) {
  console.log(`${pageErrors.length} uncaught page error(s):`);
  for (const e of pageErrors.slice(0, 8)) console.log(`  ${e.slice(0, 200)}`);
  process.exitCode = 1;
}
report.pageErrors = pageErrors;

mkdirSync(join(ROOT, 'docs', 'audit'), { recursive: true });
writeFileSync(join(ROOT, 'soak-out.json'), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(join(ROOT, 'docs', 'audit', 'SOAK.md'), markdown(report));
console.log('docs/audit/SOAK.md written.');

function markdown(r) {
  const NL = '\n';
  const lines = [
    '# Soak',
    '',
    '**Generated by `npm run soak`. Do not edit by hand.**',
    '',
    'Directive 11 §3. Four layers against one running build: a functional sweep',
    'that asserts a state change per function, a seeded combinatorial fuzz with',
    'structural invariants after every step, property checks that must hold for',
    'every input, and an endurance run judged on trends rather than endpoints.',
    '',
    `- **Bundle** \`${r.bundle.entry}\` (\`${r.bundle.hash || 'unhashed'}\`)`,
    `- **Source** \`${r.srcFingerprint}\``,
    `- **Seed** \`${r.seed}\``,
    '',
    'A report is about the source fingerprint named above and no other, and',
    '`npm run docs-guard:release` compares it against `src/` before a deploy.',
    '',
    'The *bundle* is named for identification and is deliberately not what the',
    'comparison uses. Its hash moves with the commit date — `vite.config.ts`',
    'compiles that in — so committing this report is itself enough to invalidate',
    'the bundle name the report has just been made to carry, and a check that',
    'cannot be satisfied gets turned off. The source fingerprint asks the',
    'narrower question that actually matters: has anything the bundle is built',
    'from changed since this ran?',
    '',
  ];
  if (r.layers.functional) {
    const rows = r.layers.functional;
    const ids = [...new Set(rows.map((x) => x.id))];
    const covered = ids.filter((id) => rows.some((x) => x.id === id && x.state === 'PASS'));
    /*
     * Both denominators, because reporting one of them hid the other.
     *
     * This line used to read "69 of 136 attempted rows asserted a state
     * change". True, and a hit rate inside the sweep's own scope. The report
     * before it said "69 of 396" — the same numerator against the whole
     * ledger. Nothing had improved; the denominator had moved, and read in
     * sequence it looks like coverage tripled.
     */
    const ledger = enumerate();
    const undriven = undrivenBy(new Set(ids));
    const holes = ledger.length - ids.length;
    lines.push(
      '## 1. Functional sweep',
      '',
      `**${covered.length} of ${ledger.length} ledger rows** ` +
        `(${((covered.length / ledger.length) * 100).toFixed(1)}%) asserted a state change ` +
        '**here**.',
      '',
      `The sweep attempted **${ids.length}** of them, and ${covered.length} of those changed ` +
        `something — a hit rate of ${((covered.length / ids.length) * 100).toFixed(1)}% ` +
        `**inside the sweep's own scope**, which is not the same figure and must not be ` +
        `reported as if it were.`,
      '',
      /*
       * "This sweep", not "at all", and the word matters.
       *
       * This line read "**N rows have no case at all**" while it was the only
       * instrument, and it stopped being true the moment the store sweep in
       * `npm test` started driving 159 of them. A generated document that says
       * "at all" about a subject it can only see part of is the same failure as
       * a hand-written one going stale — worse, because it regenerates and
       * carries the wrong word forward every time.
       *
       * `docs/FUNCTION_LEDGER.md` is where the two instruments are added up,
       * and it is the only place that can answer "at all".
       */
      `**${holes} rows have no case in *this* sweep.** How many have no case in ` +
        'any instrument is a question only `docs/FUNCTION_LEDGER.md` can answer, ' +
        'because it is the only thing that reads both this and the store sweep:',
      '',
      '| kind | not driven here | of |',
      '| --- | --- | --- |',
      ...[...undriven.keys()]
        .sort()
        .map(
          (k) =>
            `| ${k} | ${undriven.get(k).length} | ` +
            `${ledger.filter((row) => row.kind === k).length} |`,
        ),
      '',
      'They are named row by row in `docs/FUNCTION_LEDGER.md` under "Never driven", ' +
        'which subtracts what the store sweep drives before it calls anything a hole.',
      '',
      'A row is green here only when a named part of the state — the project, the',
      'ui, the undo stack, the transport — was observed to differ either side of',
      'the invocation. A row whose test proves only that nothing threw is not',
      'counted, because that is a weaker claim than FAIL and reads as a stronger',
      'one.',
      '',
      '| id | desktop | tablet | phone | evidence |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const id of ids) {
      const at = (form) => rows.find((x) => x.id === id && x.form === form);
      const mark = (form) => (at(form) ? (at(form).state === 'PASS' ? 'PASS' : 'FAIL') : '—');
      const why = (at('desktop') ?? at('tablet') ?? at('phone'))?.why ?? '';
      lines.push(
        `| \`${id}\` | ${mark('desktop')} | ${mark('tablet')} | ${mark('phone')} | ${why} |`,
      );
    }
    lines.push('');
  }
  if (r.layers.fuzz) {
    const f = r.layers.fuzz;
    lines.push('## 2. Combinatorial fuzz', '');
    if (f.failed) {
      lines.push(
        `**Broke at step ${f.at} (\`${f.step}\`): ${f.why}**`,
        '',
        `Seed \`${r.seed}\`. Shortest reproducing prefix, ${f.shortest.length} step(s):`,
        '',
        '```',
        f.shortest.map((s) => `${s.name}#${s.index}`).join(' -> '),
        '```',
        '',
      );
    } else {
      lines.push(
        `${f.steps} steps in ${f.elapsed.toFixed(1)} s, every invariant held after every one.`,
        '',
      );
    }
  }
  if (r.layers.properties) {
    lines.push('## 3. Properties', '', '| property | result | detail |', '| --- | --- | --- |');
    for (const p of r.layers.properties) {
      lines.push(`| ${p.what} | ${p.state} | ${p.why ?? ''} |`);
    }
    lines.push('');
  }
  if (r.layers.endurance) {
    const e = r.layers.endurance;
    lines.push(
      '## 4. Endurance',
      '',
      `${e.minutes} minute(s), ${e.readings.length} samples, playing throughout with tracks and`,
      'inserts added and deleted continuously.',
      '',
      '| what | result | measured |',
      '| --- | --- | --- |',
    );
    for (const f of e.findings) lines.push(`| ${f.id} | ${f.state} | ${f.why} |`);
    lines.push(
      '',
      '| sample | frame median | p90 | max | heap KB | sources | tracks |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const s of e.readings) {
      lines.push(
        `| ${s.at} | ${s.median.toFixed(1)} | ${s.p90.toFixed(1)} | ${s.max.toFixed(0)} | ` +
          `${s.heap === null ? '—' : (s.heap / 1024).toFixed(0)} | ${s.sources} | ${s.tracks} |`,
      );
    }
    lines.push('');
  }
  lines.push(
    '## Uncaught page errors',
    '',
    r.pageErrors.length === 0
      ? 'None.'
      : r.pageErrors.map((e) => `- \`${e.slice(0, 300)}\``).join(NL),
    '',
  );
  return lines.join(NL);
}
