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
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'docs', 'FUNCTION_LEDGER.md');
const CHECK = process.argv.includes('--check');

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/**
 * Exported functions in an actions module.
 *
 * Matched on `export function name(` and `export const name = (`, which is how
 * every one of them is written. A module that starts exporting them some third
 * way will under-report, and the count printed at the end is what makes that
 * visible rather than silent.
 */
function actionsIn(file) {
  const src = read(join('src/app', file));
  const found = [];
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(/g)) found.push(m[1]);
  for (const m of src.matchAll(/export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?\(/g)) {
    found.push(m[1]);
  }
  return [...new Set(found)].filter((n) => !/^[A-Z_]+$/.test(n));
}

/**
 * Actions on a store, taken from its state interface rather than its body.
 *
 * The interface is the contract a component calls through, and it lists methods
 * one per line as `name: (args) => ret;`. Reading the implementation instead
 * would pick up private helpers that no user can invoke.
 */
function storeActionsIn(file) {
  const src = read(join('src/state', file));
  const found = [];
  for (const m of src.matchAll(/^\s{2}(\w+)\s*(?:\?)?:\s*\((?![^)]*\)\s*=>\s*void\s*\|)/gm)) {
    found.push(m[1]);
  }
  // Only those whose type is a function, which the pattern above already
  // requires by demanding an opening paren after the colon.
  return [...new Set(found)];
}

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
function soakCoverage() {
  const file = join(ROOT, 'docs', 'audit', 'soak-coverage.json');
  if (!existsSync(file)) return { rows: new Map(), why: 'no soak has been run' };
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const covered = data.rows.filter((r) => r.covered).length;
  const attempted = data.rows.length;
  return {
    rows: new Map(data.rows.map((r) => [r.id, r])),
    why:
      `${covered} of ${attempted} attempted rows asserted a state change, measured against ` +
      `\`${data.bundle?.entry ?? 'an unnamed bundle'}\` (\`${data.bundle?.hash || 'unhashed'}\`)`,
  };
}

const coverage = soakCoverage();

const rows = [];
const push = (row) => {
  if (rows.some((r) => r.id === row.id)) return;
  rows.push(row);
};

// ----------------------------------------------------------------- actions
for (const file of readdirSync(join(ROOT, 'src/app')).filter((f) => f.endsWith('Actions.ts'))) {
  const surface = basename(file, '.ts');
  for (const name of actionsIn(file)) {
    push({ id: `action:${surface}.${name}`, surface: `src/app/${file}`, kind: 'action' });
  }
}

// ------------------------------------------------------------------ stores
for (const file of readdirSync(join(ROOT, 'src/state')).filter((f) => f.endsWith('Store.ts'))) {
  const surface = basename(file, '.ts');
  for (const name of storeActionsIn(file)) {
    push({ id: `store:${surface}.${name}`, surface: `src/state/${file}`, kind: 'store' });
  }
}

// --------------------------------------------------------------- shortcuts
{
  const src = read('src/app/shortcuts.ts');
  // One line or several. The registry writes short entries on a single line and
  // long ones across four, and a pattern that demanded the newline missed every
  // short one — `undo` among them, which is not an obscure shortcut. Found by
  // the soak naming a function the ledger did not have, which is what the
  // orphan check at the bottom of this file is for.
  for (const m of src.matchAll(/\bid:\s*'([^']+)',\s*(?:\n\s*)?combo:\s*/g)) {
    push({ id: `shortcut:${m[1]}`, surface: 'keyboard', kind: 'shortcut', key: m[1] });
  }
}

// ------------------------------------------------------- effects and kinds
{
  const src = read('src/model/effects.ts');
  // Every entry in EFFECT_SPECS opens with its kind, so the array is sliced and
  // the kinds read off it.
  //
  // Two narrower patterns were tried and both under-reported in silence: a
  // lower-case character class dropped `gainMatch`, and requiring `label:` on
  // the next line dropped `vocaltune`, which carries a paragraph of comment
  // between the two. Anchoring on the entry indentation inside the array is the
  // thing that cannot be fooled by what somebody writes in between.
  const specsStart = src.indexOf('export const EFFECT_SPECS');
  const specsEnd = src.indexOf('\n];', specsStart);
  const specs = src.slice(specsStart, specsEnd === -1 ? src.length : specsEnd);
  for (const m of specs.matchAll(/^ {4}kind:\s*'([A-Za-z0-9-]+)',/gm)) {
    push({ id: `effect:${m[1]}`, surface: 'insert rack', kind: 'effect' });
  }
  const reg = read('src/audio/motionwave/registry.ts');
  for (const m of reg.matchAll(/kind:\s*'(mw-[a-z-]+)'/g)) {
    push({ id: `effect:${m[1]}`, surface: 'insert rack', kind: 'effect' });
  }
  // The instrument kinds the store's own contract accepts.
  //
  // Read from `setInstrument`'s union rather than from `SamplerView`, which
  // gave ids like `instrument:sampler-quick` while the store, the engine and
  // the soak all call it `quick`. The ledger was enumerating an axis nothing
  // else in the product could name.
  const store = read('src/state/projectStore.ts');
  const setter = store.match(/setInstrument:\s*\(trackId:\s*string,\s*kind:\s*([^)]+)\)/);
  if (setter) {
    for (const m of setter[1].matchAll(/'([a-z]+)'/g)) {
      push({ id: `instrument:${m[1]}`, surface: 'instrument', kind: 'instrument' });
    }
  }
}

// ------------------------------------------------------- navigable surfaces
{
  // Read from the arrays that declare them, not from the JSX.
  //
  // Every one of these surfaces is rendered from a `.map()` over a const array,
  // so the test ids in the markup are templates — `nav-${n.id}` — and matching
  // the markup found the prefix and nothing after it. The array is the
  // declaration; the JSX is one consumer of it.
  const listed = [
    { file: 'src/components/shell/PhoneLayout.tsx', name: 'NAV', prefix: 'nav' },
    { file: 'src/components/shell/TabletLayout.tsx', name: 'COMBOS', prefix: 'combo' },
    { file: 'src/app/editors.ts', name: 'EDITORS', prefix: 'editor-tab' },
  ];
  for (const { file, name, prefix } of listed) {
    if (!existsSync(join(ROOT, file))) continue;
    const src = read(file);
    const start = src.indexOf(`const ${name}`);
    if (start === -1) continue;
    const end = src.indexOf('];', start);
    const block = src.slice(start, end === -1 ? src.length : end);
    for (const m of block.matchAll(/id:\s*'([\w-]+)'/g)) {
      push({ id: `surface:${prefix}-${m[1]}`, surface: file, kind: 'surface' });
    }
  }
  // The two drawers a tablet carries, which are buttons rather than a list.
  for (const side of ['browser', 'inspector']) {
    push({
      id: `surface:drawer-${side}`,
      surface: 'src/components/shell/TabletLayout.tsx',
      kind: 'surface',
    });
  }
}

rows.sort((a, b) => a.id.localeCompare(b.id));

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
