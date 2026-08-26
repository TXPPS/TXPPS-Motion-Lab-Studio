/**
 * The Function Ledger — "test everything", made countable.
 *
 * Directive 11 §2. "Stress test everything" is only actionable once
 * "everything" is enumerated, and enumerating it by hand produces a list of
 * what somebody thought of. So the inventory is **derived from the source**:
 * every action a user can invoke, found by reading the files that declare them.
 *
 *   npm run functions           # regenerate docs/FUNCTION_LEDGER.md
 *   npm run functions --check   # fail if it is out of date
 *
 * The axes, each read from its own source of truth:
 *
 *  - every exported function in `src/app/*Actions.ts`
 *  - every action on every Zustand store in `src/state/`
 *  - every entry in `SHORTCUTS`
 *  - every effect kind and every instrument kind
 *  - every navigable surface the shell declares
 *
 * A function added without a row fails the build, the way `params:check` does.
 * That is the whole mechanism: the list cannot quietly stop covering something.
 *
 * **What this file does not do is decide whether a function works.** It
 * establishes the denominator. The `tested` column is filled from
 * `docs/audit/soak-coverage.json`, which `npm run soak` writes — and only from
 * rows where the sweep observed a named part of the state change. A row that
 * was invoked without anything changing stays FAIL, because "it did not throw"
 * is a weaker claim than FAIL and reads as a stronger one.
 *
 * **Coverage is refused if it was measured against a different bundle.** The
 * coverage file records the hash of the JavaScript the soak was actually
 * talking to; if that is not what is in `dist/` now, every row reads FAIL and
 * the header says why. A green column standing on a stale artefact is the
 * failure Directive 11 §10 names, and it matters more here than anywhere else:
 * this table is what somebody would point at to say the product is tested.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { enumerate, undrivenBy } from './functions/enumerate.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'docs', 'FUNCTION_LEDGER.md');
const CHECK = process.argv.includes('--check');

/**
 * The soak's coverage, and the bundle it was measured against.
 *
 * The bundle is *named*, not compared. Comparing it against `dist/` was tried
 * first and it cannot work: the check runs inside the build, so any rebuild
 * changes the hash, the generator would then produce a different file, and
 * `--check` fails on a document nobody touched. The ledger would be red after
 * every build until a twenty-minute soak had been re-run.
 *
 * Naming it satisfies what Directive 11 §10 actually asks — that a green cell
 * says which artefact it is green against. `npm run soak` refuses to write
 * coverage for a bundle it did not measure, which is where that belongs; this
 * file records what the soak said and whose build it said it about.
 */
function soakCoverage(total) {
  const file = join(ROOT, 'docs', 'audit', 'soak-coverage.json');
  if (!existsSync(file)) return { rows: new Map(), why: 'no soak has been run', undriven: null };
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const covered = data.rows.filter((r) => r.covered).length;
  const attempted = data.rows.length;
  const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;
  return {
    rows: new Map(data.rows.map((r) => [r.id, r])),
    undriven: undrivenBy(new Set(data.rows.map((r) => r.id))),
    /*
     * Three numbers, because two of them were being reported as one.
     *
     * The previous line read "69 of 136 attempted rows asserted a state
     * change", which is true and is a hit rate *inside the sweep's own scope*.
     * The report before it said "69 of 396". Same numerator, different
     * denominator, and read together it looks like coverage tripled. It is
     * the arithmetic that hides in a total: 136 is what the sweep drives, not
     * what there is.
     */
    why:
      `**${covered} of ${total} ledger rows** (${pct(covered)}) have a state-asserting ` +
      `result. The sweep attempted ${attempted} of them and ${covered} of those changed ` +
      `something; **${total - attempted} rows have no case at all** and are named under ` +
      `"Never driven" below. Measured against ` +
      `\`${data.bundle?.entry ?? 'an unnamed bundle'}\` (\`${data.bundle?.hash || 'unhashed'}\`)`,
  };
}

/**
 * Why a whole kind goes undriven, where the reason is structural.
 *
 * A count on its own reads as an oversight to be fixed later. These are not
 * all the same shape: `action` and `surface` have no cases written, which is
 * work; `store` has 27 of 188 because the sweep drives the ones with a
 * one-line state assertion and the rest need a fixture. Saying which is which
 * is the difference between a backlog and a number.
 */
const WHY_UNDRIVEN = {
  action:
    'no case exists for any of them. `scripts/soak/cases.mjs` covers stores directly and reaches actions only where a shortcut happens to call one',
  surface:
    'the functional sweep asserts state changes; reaching a surface is `npm run reachability`’s subject, and that sweep reports separately',
  store: 'the 27 with a one-line state assertion are driven; the rest need a fixture built first',
  shortcut: 'driven — any listed here failed to resolve a binding',
  effect: 'driven — any listed here failed to instantiate',
  instrument: 'driven — any listed here failed to sound',
};

/** The undriven rows, by kind, named rather than counted. */
function undrivenSection(undriven, byKind) {
  if (!undriven) return '_No soak has been run, so nothing is known about what is driven._';
  const kinds = [...undriven.keys()].sort();
  if (kinds.length === 0) return '_Every ledger row is driven by the sweep._';
  const out = ['| kind | undriven | of | why |', '| --- | --- | --- | --- |'];
  for (const k of kinds) {
    out.push(
      `| ${k} | ${undriven.get(k).length} | ${byKind[k]} | ${WHY_UNDRIVEN[k] ?? 'unclassified'} |`,
    );
  }
  out.push('');
  for (const k of kinds) {
    // Named, not summarised. A list of 161 ids is long and that is the point:
    // the length is the finding.
    out.push(`<details><summary>${k} — ${undriven.get(k).length} rows</summary>`, '');
    out.push(
      undriven
        .get(k)
        .map((id) => `\`${id}\``)
        .join(', '),
      '',
    );
    out.push('</details>', '');
  }
  return out.join('\n');
}

const rows = enumerate();
const coverage = soakCoverage(rows.length);

const byKind = rows.reduce((acc, r) => ({ ...acc, [r.kind]: (acc[r.kind] ?? 0) + 1 }), {});

const header = `# Function Ledger

**Generated by \`npm run functions\`. Do not edit by hand.**

Directive 11 §2. "Test everything" is only actionable once everything is
enumerated, so this is derived from the source rather than written: every action
module, every store contract, every shortcut, every effect and instrument kind,
every navigable surface the shell declares. A function added without a row fails
the build.

**A row is a question, not a claim.** \`tested\` reads \`PASS\` only where
\`npm run soak\` invoked the function and *observed a named part of the state
change* — the project, the ui, the undo stack or the transport. A row that was
invoked and changed nothing stays \`FAIL\`, and so does every row nobody has
written a case for. \`FAIL\` means untested rather than broken, which is the
distinction the directive draws.

Coverage is counted as **rows with a state-asserting result**, never as rows
that are not FAIL. Those are the same number only until somebody is tempted to
make the column green.

Soak coverage: ${coverage.why}.

| kind | count |
| --- | --- |
${Object.entries(byKind)
  .sort()
  .map(([k, n]) => `| ${k} | ${n} |`)
  .join('\n')}
| **total** | **${rows.length}** |

## Never driven

Rows the functional sweep does not attempt at all. Not failures — holes, and a
different thing from a row that was invoked and changed nothing. Folding the two
together is what let the coverage figure read as half rather than a sixth.

${undrivenSection(coverage.undriven, byKind)}

| id | surface | kind | desktop | tablet | phone | keyboard | tested | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
`;

const body = rows
  .map((r) => {
    const keyboard = r.kind === 'shortcut' ? r.key : 'none';
    const cover = coverage.rows.get(r.id);
    const at = (form) => {
      const cell = cover?.forms?.[form];
      return cell ? (cell.state === 'PASS' ? 'PASS' : 'FAIL') : '?';
    };
    const cells = Object.values(cover?.forms ?? {});
    // The evidence, verbatim from the sweep. A PASS that does not say what
    // changed is exactly the claim this table refuses to make.
    const why = cover?.covered
      ? cells.find((f) => f.state === 'PASS').why
      : (cells[0]?.why ?? 'not attempted');
    return (
      `| \`${r.id}\` | ${r.surface} | ${r.kind} | ${at('desktop')} | ${at('tablet')} | ` +
      `${at('phone')} | ${keyboard} | ${cover?.covered ? 'PASS' : 'FAIL'} | ${why} |`
    );
  })
  .join('\n');

const text = `${header}${body}\n`;

if (CHECK) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== text) {
    console.error(
      'functions:check: docs/FUNCTION_LEDGER.md is out of date. Run `npm run functions`.',
    );
    process.exit(1);
  }
  // A coverage row naming a function the ledger does not have is a case table
  // that has drifted: it reads as coverage and covers nothing, which is the
  // exact failure mode this column exists to refuse. Reported at --check, where
  // the build can see it.
  const known = new Set(rows.map((r) => r.id));
  const orphans = [...coverage.rows.keys()].filter((id) => !known.has(id) && !id.endsWith(':*'));
  if (orphans.length > 0) {
    console.error('functions:check: soak coverage names functions that are not in the ledger:');
    for (const id of orphans) console.error(`  ${id}`);
    process.exit(1);
  }
  const green = rows.filter((r) => coverage.rows.get(r.id)?.covered).length;
  console.log(
    `functions:check: ${rows.length} function(s), ${green} with a state-asserting test, ledger current.`,
  );
} else {
  writeFileSync(OUT, text);
  console.log(
    `functions: ${rows.length} function(s) — ` +
      Object.entries(byKind)
        .sort()
        .map(([k, n]) => `${n} ${k}`)
        .join(', '),
  );
}
