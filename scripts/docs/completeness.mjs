/**
 * Currency is not completeness.
 *
 * `docs/audit/SOAK.md` was overwritten with three lines by fifty-four scoped
 * probe runs, and `docs-guard` could not see it. The currency rule compares the
 * source fingerprint the report declares against `src/`, and a partial run
 * copies that fingerprint forward correctly — so the document was *current* and
 * *empty* at the same time, and every question the guard knew how to ask came
 * back green. 195 lines gone, found by `git diff`.
 *
 * "Only a full run writes the report" is the right fix for soak. It is not a fix
 * for the class. Every generated document can be truncated by the generator that
 * writes it, and the header, the stamp and the fingerprint all survive the
 * truncation *because they are written first* — before there is anything to
 * render. Everything that says a document is trustworthy is written before the
 * document has any content in it.
 *
 * So each GENERATED entry says what it must contain: the sections, the shape of
 * each, and a minimum it cannot be below. A report with no fuzz section, or a
 * table with zero rows, fails regardless of how current its fingerprint is.
 *
 * **A floor is derived or it is one.** A minimum chosen to sit just under
 * today's measurement is a constant fitted to the thing it checks, and this
 * repository has paid for one of those already — the Optical Leveller's attack,
 * re-fitted three times, each fit absorbing an interference rather than removing
 * it. So a minimum here is either derived from something outside the generator
 * that writes the document — the property harness's own list, the ledger's own
 * stated total — or it is one, which says "not empty" and cannot be fitted to
 * anything. `atLeast` takes the reason as an argument for that reason.
 */

/** A minimum with a reason. `why` is printed when the requirement fails. */
export const atLeast = (n, why) => ({ of: () => n, why });
/** A minimum read from somewhere else, so nobody has chosen it. */
export const asManyAs = (why, of) => ({ of, why });

/**
 * The data rows of every markdown table in `body`.
 *
 * The header row and the `| --- |` rule are not rows, and neither is a `|` that
 * happens to start a line outside a table — which is why the rule is what turns
 * counting on. A table with a header and no body is exactly the shape a
 * truncated generator produces, and it has to count as zero rather than as one.
 */
export function tableRows(body) {
  const rows = [];
  let inTable = false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) {
      inTable = false;
      continue;
    }
    if (/^\|[\s|:-]+\|$/.test(line)) {
      inTable = true;
      continue;
    }
    if (inTable) rows.push(line);
  }
  return rows;
}

/**
 * Everything under a heading, up to the next heading of the same level or
 * shallower. A deeper heading is part of the section, which is what lets a
 * requirement on `## 4. Endurance` reach a table under a `### ` inside it.
 */
export function sectionBody(text, heading) {
  const lines = text.split('\n');
  const depth = heading.match(/^#+/)[0].length;
  const start = lines.findIndex((l) => l.trimEnd() === heading);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => {
    const m = /^(#{1,6})\s/.exec(l);
    return m !== null && m[1].length <= depth;
  });
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

// ── The vocabulary ─────────────────────────────────────────────────────────
//
// Each requirement is `{ describe, check(doc) }` and returns a sentence naming
// what is missing, or null. They compose: `section` scopes its children to the
// body it found, so the requirement list reads as the shape of the document.

/** A heading that must be present, and what must be inside it. */
export const section = (heading, ...inner) => ({
  describe: `a "${heading}" section`,
  check(doc) {
    const body = sectionBody(doc.text, heading);
    if (body === null) return `has no "${heading}" section`;
    for (const req of inner) {
      const problem = req.check({ ...doc, text: body });
      if (problem) return `${heading.replace(/^#+\s*/, '')} — ${problem}`;
    }
    return null;
  },
});

/**
 * Table rows, in whatever scope this sits in.
 *
 * `matching` narrows to one table where a document has several and the heading
 * cannot separate them. The Function Ledger's 401 rows sit under no heading of
 * their own, below a kind table and an undriven table — counting all three would
 * make the claim "the ledger has as many rows as it says" true of a ledger whose
 * main table was empty and whose two small ones happened to add up.
 */
export const rows = (min, matching) => ({
  describe: `at least ${min.why}`,
  check(doc) {
    const all = tableRows(doc.text);
    const found = matching ? all.filter((row) => matching.test(row)).length : all.length;
    const want = min.of(doc);
    if (want === null) return `the minimum could not be derived: ${min.why}`;
    return found >= want
      ? null
      : `has ${found} table row(s) and needs ${want} — ${min.why}. A heading that is ` +
          `present above a table with no rows is what a truncated generator writes.`;
  },
});

/** A line the document must carry, named by what it says rather than by its shape. */
export const saying = (re, what) => ({
  describe: what,
  check: (doc) => (re.test(doc.text) ? null : `does not state ${what}`),
});

/** A JSON artefact's top-level keys. */
export const keys = (...names) => ({
  describe: `the keys ${names.join(', ')}`,
  check(doc) {
    const missing = names.filter((k) => doc.json?.[k] === undefined || doc.json[k] === '');
    return missing.length ? `is missing the key(s) ${missing.join(', ')}` : null;
  },
});

/** A JSON `rows` array: how many, and what each row has to carry. */
export const records = (min, fields) => ({
  describe: `at least ${min.why}, each with ${fields.join(', ')}`,
  check(doc) {
    const list = doc.json?.rows;
    if (!Array.isArray(list)) return 'has no `rows` array';
    const want = min.of(doc);
    if (want === null) return `the minimum could not be derived: ${min.why}`;
    if (list.length < want) return `has ${list.length} row(s) and needs ${want} — ${min.why}.`;
    const bad = list.findIndex((r) => fields.some((f) => r?.[f] === undefined));
    return bad < 0
      ? null
      : `row ${bad} is missing one of ${fields.join(', ')}: ` +
          JSON.stringify(list[bad]).slice(0, 80);
  },
});

// ── The driver ─────────────────────────────────────────────────────────────

/** Every way `text` falls short of what `must` demands. Empty means complete. */
export function incomplete(path, text, must) {
  let json = null;
  if (path.endsWith('.json')) {
    try {
      json = JSON.parse(text);
    } catch (e) {
      return [`is not valid JSON: ${e.message}`];
    }
  }
  const doc = { path, text, json };
  return must.map((req) => req.check(doc)).filter(Boolean);
}

/**
 * The document as its generator would leave it having measured nothing.
 *
 * Not a hypothesis — this is what happened. `soak.mjs` writes the title, the
 * "generated by" line, the bundle, the source fingerprint and the seed, and then
 * renders each layer from what it measured, so with no layers selected the file
 * was everything above the first `## ` and nothing else. A JSON artefact
 * truncates the same way: the stamps are assembled first and the rows come from
 * the run.
 *
 * The completeness rules are required to reject this for every generated
 * document, on every build. Without that they would be a list of shapes that
 * happen to match the files in the tree, which is the same thing as no rules —
 * rule 6 guards the state detector against exactly this and for the same reason.
 */
export function stubOf(path, text) {
  if (path.endsWith('.json')) {
    const json = JSON.parse(text);
    return `${JSON.stringify({ ...json, rows: [] }, null, 2)}\n`;
  }
  const cut = text.indexOf('\n## ');
  return cut < 0 ? `${text.split('\n').slice(0, 6).join('\n')}\n` : text.slice(0, cut + 1);
}
