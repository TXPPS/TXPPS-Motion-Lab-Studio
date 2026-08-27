/**
 * Reading the Reachability Matrix, rather than re-deriving what it already says.
 *
 * `npm run reachability` walks a live browser for minutes and writes
 * `docs/audit/REACHABILITY.md`, which records — per surface, per form factor —
 * whether it was reached and the exact sequence of controls that reached it.
 * That is a tracked, generated answer to "how do I get to X on a phone".
 *
 * It has been re-derived by guessing twice. A run wanting the sampler on a
 * phone tried `editor-tab-synth` three times before reading the matrix, which
 * had already recorded `nav-perform` — there is no synth tab on a phone at all,
 * because the phone's editor strip excludes what its bottom navigation already
 * offers. The RA backlog was the same shape from the other direction: a tracked
 * answer, re-derived because asking it was awkward.
 *
 * So asking is a command now. The document stays the record; this is the index
 * over it, and `--check` makes the index load-bearing — a matrix whose route
 * table and whose yes/no table disagree fails the build, which is the only
 * thing that stops a parser like this rotting quietly against a format change.
 *
 * @clone: working-tree — it reads one generated document out of the tree and
 * asks git nothing at all.
 */
import { readFileSync } from 'node:fs';

export const MATRIX_PATH = 'docs/audit/REACHABILITY.md';

/* A separator no label can contain, so a surface with spaces in its name — and
   most of them have — still splits back into exactly two parts. */
const SEP = String.fromCharCode(0);
const key = (surface, form) => surface + SEP + form;

/** A markdown table row split into trimmed cells, or null if it is not one. */
function cells(line) {
  if (!line.startsWith('|')) return null;
  const parts = line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());
  // The `| --- | --- |` separator carries no data and would otherwise arrive as
  // a surface called "---" that no query could ever match.
  if (parts.every((c) => /^-+$/.test(c))) return null;
  return parts;
}

/**
 * Both tables, from one pass.
 *
 * They are told apart by their second column: the matrix's is a form factor,
 * the route table's is the literal word `form`. Distinguishing them by position
 * in the file would break the moment a section is added above either one, which
 * is a thing generated documents do.
 */
export function parse(text) {
  const lines = text.split(/\r?\n/);
  /** @type {string[]} */
  let forms = [];
  /** @type {Map<string, Map<string, boolean>>} */
  const reached = new Map();
  /** @type {Map<string, string>} */
  const routes = new Map();
  let inRoutes = false;

  for (const line of lines) {
    const row = cells(line);
    if (!row || row.length < 2) continue;
    if (row[0] === 'surface' && row[1] === 'form') {
      inRoutes = true;
      continue;
    }
    if (row[0] === 'surface') {
      inRoutes = false;
      forms = row.slice(1);
      continue;
    }
    if (inRoutes) {
      if (row.length < 3) continue;
      routes.set(key(row[0], row[1]), row[2]);
    } else if (forms.length > 0 && row.length === forms.length + 1) {
      const byForm = new Map();
      forms.forEach((f, i) => byForm.set(f, row[i + 1] === 'yes'));
      reached.set(row[0], byForm);
    }
  }
  return { forms, reached, routes };
}

/** The matrix as it stands in the working tree. */
export function load(path = MATRIX_PATH) {
  return parse(readFileSync(path, 'utf8'));
}

/**
 * Surfaces whose label contains every word of the query, case-insensitively.
 *
 * Substring rather than exact, because the labels are prose written for a
 * reader — "MIDI/note FX rack", "export / bounce" — and requiring somebody to
 * reproduce the punctuation would put the awkwardness straight back.
 */
export function match(model, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...model.reached.keys()];
  return [...model.reached.keys()].filter((label) => {
    const hay = label.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** How one surface was reached on one form, or null if the sweep did not. */
export function routeFor(model, surface, form) {
  return model.routes.get(key(surface, form)) ?? null;
}

/**
 * Where the two tables disagree.
 *
 * A cell says `yes` and no route row explains it, or a route row exists for a
 * cell that says the sweep never got there. Either way one of the two halves is
 * describing a different run from the other, and a lookup built on the route
 * table would then be answering from a record the matrix itself contradicts.
 *
 * This is also what keeps the parser honest. A format change that this file
 * stops understanding shows up here as every row going missing at once, rather
 * than as a lookup that quietly answers "not reached" for everything.
 */
export function inconsistencies(model) {
  const problems = [];
  for (const [surface, byForm] of model.reached) {
    for (const [form, yes] of byForm) {
      const via = routeFor(model, surface, form);
      if (yes && !via) {
        problems.push(`${surface} on ${form}: the matrix says yes and no route is recorded.`);
      } else if (!yes && via) {
        problems.push(
          `${surface} on ${form}: a route is recorded and the matrix says not reached.`,
        );
      }
    }
  }
  for (const k of model.routes.keys()) {
    const [surface, form] = k.split(SEP);
    if (!model.reached.has(surface)) {
      problems.push(`${surface} on ${form}: a route is recorded for a surface with no matrix row.`);
    }
  }
  return problems;
}

/** A floor under the parse, so an empty read cannot pass for a clean matrix. */
export function emptiness(model) {
  if (model.forms.length === 0) return 'no form factors were parsed from the matrix table.';
  if (model.reached.size === 0) return 'no surfaces were parsed from the matrix table.';
  if (model.routes.size === 0)
    return 'no routes were parsed from the "How each was reached" table.';
  return null;
}
