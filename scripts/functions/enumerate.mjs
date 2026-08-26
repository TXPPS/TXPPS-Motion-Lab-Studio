// The Function Ledger's enumeration — the denominator, and only the denominator.
//
// Split out of `generate-functions.mjs` because two things now need it and
// they were counting different lists. The ledger enumerated 398 functions; the
// soak drove 136 of them and reported "69 of 136", which is a hit rate inside
// the sweep's own scope wearing the shape of a coverage figure. Read against
// the previous report's "69 of 396" it looks like coverage tripled. The
// numerator never moved.
//
// So both read this. A denominator that is derived once cannot disagree with
// itself, and `undrivenBy()` below is what makes the gap between the two
// numbers a list of names rather than a subtraction.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
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
 * Every axis, each read from its own source of truth.
 *
 * One function rather than top-level statements so it can be called twice —
 * once by the ledger and once by the soak — without either of them importing
 * a side effect.
 */
function collect(push) {
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
}

/**
 * Every function the product declares, sorted, deduplicated.
 *
 * Derived from the source every time rather than cached: a list that is
 * written down is a list of what somebody thought of.
 */
export function enumerate() {
  const rows = [];
  const push = (row) => {
    if (rows.some((r) => r.id === row.id)) return;
    rows.push(row);
  };
  collect(push);
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

/**
 * The rows a sweep never attempted, grouped by kind.
 *
 * `driven` is the set of ids the sweep tried at all — not the ones it passed.
 * The distinction is the whole point: a row that was driven and changed
 * nothing is a finding, and a row that was never driven is a hole, and folding
 * them together is how 262 holes came to be invisible behind a 51% figure.
 */
export function undrivenBy(driven) {
  const out = new Map();
  for (const row of enumerate()) {
    if (driven.has(row.id)) continue;
    if (!out.has(row.kind)) out.set(row.kind, []);
    out.get(row.kind).push(row.id);
  }
  return out;
}
