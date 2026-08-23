#!/usr/bin/env node
/**
 * Fail the build if `docs/UNIT_LEDGER.md` claims something it cannot support.
 *
 * Directive 03 §3: "CI check: fail the build if any unit is marked SHIPPING
 * while any applicable cell is not PASS. The Ledger must not be able to lie."
 *
 * The failure this prevents is not dishonesty, it is drift. A ledger is updated
 * by hand at the moment a cell changes, across many sessions, and the one edit
 * everybody remembers to make is the status column — because that is the one
 * that feels like progress. Marking a unit SHIPPING and leaving two cells at `—`
 * is an ordinary slip, and it turns the one document the next session is told to
 * trust into a document that has to be re-checked by hand, which is the same as
 * not having it.
 */
import { readFileSync } from 'node:fs';

const LEDGER = new URL('../docs/UNIT_LEDGER.md', import.meta.url).pathname;

/** Values a cell is allowed to hold. Anything else is a typo or prose. */
const CELL = /^(PASS|FAIL|n\/a|—|BLOCKED \(.+\))$/;

const text = readFileSync(LEDGER, 'utf8');

// The unit table is the one whose first column is "Unit". Matched on the
// trimmed cell rather than on a literal prefix, because Prettier pads every
// column of a Markdown table to its widest entry — an exact `| Unit |` never
// survives the first format pass, and a guard that silently stops finding its
// own table is worse than no guard.
const lines = text.split('\n');
const firstCell = (line) => line.split('|')[1]?.trim();
const headerIndex = lines.findIndex((l) => l.startsWith('|') && firstCell(l) === 'Unit');
if (headerIndex === -1) {
  console.error('ledger-guard: no unit table found in docs/UNIT_LEDGER.md');
  process.exit(1);
}

const cells = (line) =>
  line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());

const columns = cells(lines[headerIndex]);
const problems = [];
let units = 0;
let shipping = 0;

for (let i = headerIndex + 2; i < lines.length; i++) {
  const line = lines[i];
  if (!line.startsWith('|')) break;
  const row = cells(line);
  if (row.length !== columns.length) {
    problems.push(`row ${i + 1}: ${row.length} cells against ${columns.length} columns`);
    continue;
  }
  const [unit, , status, ...rest] = row;
  units++;

  for (const [n, value] of rest.entries()) {
    if (!CELL.test(value)) {
      problems.push(
        `${unit} · ${columns[n + 3]}: "${value}" is not one of PASS/FAIL/n\\/a/—/BLOCKED (reason)`,
      );
    }
    // A bare BLOCKED with no reason is the loophole this closes: it would let
    // any cell be waved through without naming what is missing.
    if (value.startsWith('BLOCKED') && !/^BLOCKED \(.+\)$/.test(value)) {
      problems.push(`${unit} · ${columns[n + 3]}: BLOCKED must name the missing capability`);
    }
  }

  // Ownership, per Directive 05 §2. A cell owned by the C++ suite may not be
  // recorded as BLOCKED for a WASM reason: the whole point of the split is that
  // those cells are proven natively and need no toolchain. A `BLOCKED (no
  // wasmCore)` on D1..I18 is the old model leaking back, and it would silently
  // defer about 154 cells across fourteen units to a hardware pass.
  for (const [n, value] of rest.entries()) {
    const column = columns[n + 3];
    if (!/^(D|I)\d+$/.test(column ?? '')) continue;
    if (/BLOCKED/.test(value) && /wasm|emscripten/i.test(value)) {
      problems.push(
        `${unit} · ${column}: BLOCKED for a WASM reason, but this cell is owned by the ` +
          `C++ suite and runs natively — see docs/UNIT_LEDGER.md, "Who owns which cell"`,
      );
    }
  }

  if (status === 'SHIPPING') {
    shipping++;
    const notPass = rest
      .map((value, n) => ({ value, column: columns[n + 3] }))
      .filter(({ value }) => value !== 'PASS' && value !== 'n/a');
    if (notPass.length > 0) {
      problems.push(
        `${unit} is marked SHIPPING with ${notPass.length} cell(s) not PASS: ` +
          notPass.map((c) => `${c.column}=${c.value}`).join(', '),
      );
    }
  }
}

if (problems.length > 0) {
  console.error('ledger-guard: docs/UNIT_LEDGER.md does not support its own claims.\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nA unit is SHIPPING only when every applicable cell reads PASS, and every\n' +
      'PASS is backed by a named executable test. Fix the work or fix the claim.',
  );
  process.exit(1);
}

console.log(
  `ledger-guard: ${units} units, ${shipping} shipping, ${columns.length - 3} cells each, ` +
    'every claim supported',
);
