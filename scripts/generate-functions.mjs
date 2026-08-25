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
 * establishes the denominator. The `tested`, `reachable` and `undo` columns are
 * filled by the sweeps that actually invoke things — a row here is a question,
 * not a claim.
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
  for (const m of src.matchAll(/\bid:\s*'([^']+)',\s*\n\s*combo:\s*([^,]+),/g)) {
    push({ id: `shortcut:${m[1]}`, surface: 'keyboard', kind: 'shortcut', key: m[1] });
  }
}

// ------------------------------------------------------- effects and kinds
{
  const src = read('src/model/effects.ts');
  for (const m of src.matchAll(/kind:\s*'([a-z0-9-]+)'\s*,\s*\n\s*label:/g)) {
    push({ id: `effect:${m[1]}`, surface: 'insert rack', kind: 'effect' });
  }
  const reg = read('src/audio/motionwave/registry.ts');
  for (const m of reg.matchAll(/kind:\s*'(mw-[a-z-]+)'/g)) {
    push({ id: `effect:${m[1]}`, surface: 'insert rack', kind: 'effect' });
  }
  const sampler = read('src/model/sampler.ts');
  const views = sampler.match(/export type SamplerView\s*=\s*([^;]+);/);
  if (views) {
    for (const m of views[1].matchAll(/'([a-z]+)'/g)) {
      push({ id: `instrument:sampler-${m[1]}`, surface: 'instrument', kind: 'instrument' });
    }
  }
  push({ id: 'instrument:synth', surface: 'instrument', kind: 'instrument' });
  push({ id: 'instrument:drumkit', surface: 'instrument', kind: 'instrument' });
  push({ id: 'instrument:rack', surface: 'instrument', kind: 'instrument' });
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

**A row is a question, not a claim.** This file establishes the denominator;
what fills the answer columns is the sweep that actually invokes each one and
asserts a state change. Until that sweep covers a row, its \`tested\` column
reads \`FAIL\`, and \`FAIL\` here means untested rather than broken — the
distinction the directive draws, and the reason there is no "covered by" prose
allowed in that column.

| kind | count |
| --- | --- |
${Object.entries(byKind)
  .sort()
  .map(([k, n]) => `| ${k} | ${n} |`)
  .join('\n')}
| **total** | **${rows.length}** |

| id | surface | kind | desktop | tablet | phone | keyboard | tested | undo | persists |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
`;

const body = rows
  .map((r) => {
    const keyboard = r.kind === 'shortcut' ? r.key : 'none';
    return `| \`${r.id}\` | ${r.surface} | ${r.kind} | ? | ? | ? | ${keyboard} | FAIL | ? | ? |`;
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
  console.log(`functions:check: ${rows.length} function(s), ledger current.`);
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
