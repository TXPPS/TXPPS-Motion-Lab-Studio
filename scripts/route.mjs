/**
 * Ask the Reachability Matrix how a surface is reached, instead of guessing.
 *
 *   npm run route                          # every surface, and where it is reached
 *   npm run route -- sampler               # one surface, every form factor
 *   npm run route -- sampler phone-portrait
 *   npm run route:check                    # runs in the build
 *
 * The matrix has recorded `sampler | phone-portrait | nav-perform` for as long
 * as it has existed. A run still spent three attempts on `editor-tab-synth`,
 * which is not a control a phone has — the phone's editor strip excludes what
 * its bottom navigation already offers, so Instrument is reached through
 * Perform there and through the strip everywhere else. The answer was tracked
 * and the asking was awkward, so the asking is a command.
 *
 * `--check` is the half that keeps this honest. The two tables in that document
 * are written from one sweep and must agree; if the format moves under this
 * parser, every route goes missing at once and the disagreement is total, which
 * fails loudly rather than answering "not reached" to everything.
 *
 * @clone: working-tree — one generated document, read from the tree.
 */
import { emptiness, inconsistencies, load, match, routeFor } from './reach/routes.mjs';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const rest = args.filter((a) => !a.startsWith('--'));

const model = load();

const empty = emptiness(model);
if (empty) {
  console.error(`route: ${empty}`);
  console.error('The matrix is written by `npm run reachability`; run it, or check the format.');
  process.exit(1);
}

if (CHECK) {
  const problems = inconsistencies(model);
  if (problems.length > 0) {
    console.error(`route:check — the matrix disagrees with itself in ${problems.length} place(s).`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error('\nRe-run `npm run reachability`; both tables come from one sweep.');
    process.exit(1);
  }
  console.log(
    `route:check — ${model.reached.size} surfaces x ${model.forms.length} forms, ` +
      `${model.routes.size} recorded routes, both tables agree.`,
  );
  process.exit(0);
}

// The form factor, if the last word is one. Surface labels are prose and form
// ids are not, so there is nothing a query could say that this steals.
const form = model.forms.includes(rest[rest.length - 1]) ? rest.pop() : null;
const query = rest.join(' ');
const found = match(model, query);

if (found.length === 0) {
  console.error(`route: nothing matches "${query}". The matrix records:\n`);
  for (const label of model.reached.keys()) console.error(`  ${label}`);
  process.exit(1);
}

const pad = Math.max(...found.map((f) => f.length));
for (const surface of found) {
  const forms = form ? [form] : model.forms;
  for (const f of forms) {
    const via = routeFor(model, surface, f);
    // "not reached by the sweep" is not "unreachable" — the sweep navigates and
    // selects, and does not open a device or review a take. Saying which one it
    // is here stops the answer being read as a defect it may not be.
    const answer =
      via ??
      (model.reached.get(surface)?.get(f)
        ? '(reached, no route recorded)'
        : '—  not reached by the sweep');
    console.log(`${surface.padEnd(pad)}  ${f.padEnd(17)}  ${answer}`);
  }
}
