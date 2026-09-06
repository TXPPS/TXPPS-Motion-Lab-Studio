import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every field the project schema declares must be read by something.
 *
 * This exists because five of them were not. `punch` was a transport button
 * that toggled a field no audio code looked at; `preRoll` had no UI and no
 * reader; `countIn` was written to the project and read from a module-level
 * copy; `midiChannel` documented itself as an input filter and filtered
 * nothing; `clickLevel` was validated on load and never reached the click.
 * Each of them shipped as a control that did nothing, which is worse than a
 * missing feature — the product promised and did not deliver.
 *
 * The check is deliberately crude: it looks for the field name being read
 * anywhere outside the two files that only declare and validate it. A field
 * that passes is not proven correct; a field that fails is proven dead.
 */
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

/**
 * Files that only declare or validate the schema, so they do not count as readers.
 *
 * Compared by normalised path, and that is not a tidy-up. The exclusion was
 * `f.endsWith(d.replace('src/', '/'))` against paths from `join()`, which on
 * Windows are `...\model\types.ts` — so it matched nothing, `types.ts` stayed in
 * the readers blob, and **every field matched its own declaration**. The whole
 * file passed vacuously on this host: mutating away every reader of a field
 * left it green, which is precisely what it exists to make impossible. It only
 * ever worked where the separator happened to be a slash.
 */
const DECLARERS = ['src/model/types.ts', 'src/persistence/projectRepo.ts'];
const normalise = (p: string) => p.replace(/\\/g, '/');
const isDeclarer = (file: string) =>
  DECLARERS.some((d) => normalise(file).endsWith(d.replace(/^src\//, '/')));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Field names declared in an interface body, ignoring comments. */
function fieldsOf(source: string, interfaceName: string): string[] {
  const start = source.indexOf(`export interface ${interfaceName} {`);
  expect(start, `${interfaceName} not found`).toBeGreaterThan(-1);
  let depth = 0;
  let end = start;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(start, end);
  const fields: string[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    const m = /^([a-zA-Z][a-zA-Z0-9]*)\??\s*:/.exec(trimmed);
    if (m) fields.push(m[1]);
  }
  return fields;
}

const types = readFileSync(join(SRC, 'model/types.ts'), 'utf8');

/**
 * A project fixture BUILDS a project; it does not read one.
 *
 * Eleven files under `src/model` construct whole `ProjectData` objects — the
 * demo project, the QA fixtures, the stress projects — and every one of them
 * writes `workspace: { pxPerBeat, snap, laneScale }` as a literal. That
 * satisfies the `field:` half of the pattern below, so a `WorkspaceState` field
 * read by nothing in the product still passed: mutating away *every* reader of
 * `laneScale` left this file green, which is what a check that cannot fail
 * looks like.
 *
 * They are declarers in the same sense `types.ts` and `projectRepo.ts` are —
 * they say what the shape is, they do not consume it — so they are excluded on
 * the same grounds. Matched on the construction rather than by listing the
 * eleven names, because a twelfth fixture added next month would silently
 * reopen the hole a name list closes.
 */
const isFixture = (body: string) => /\bworkspace:\s*\{/.test(body) && /\bschemaVersion:/.test(body);

const readerFiles = sourceFiles(SRC).filter((f) => !isDeclarer(f));
const readers = readerFiles
  .map((f) => readFileSync(f, 'utf8'))
  .filter((body) => !isFixture(body))
  .join('\n');

/**
 * The exclusions actually excluded something.
 *
 * Both of them were broken at once and both failed silently — the declarer
 * match by path separator, the fixture one not at all until it was written —
 * and a file of ninety assertions that all pass against the schema's own
 * declaration reads exactly like a file of ninety assertions that pass. So the
 * filters are asserted rather than trusted: if either stops matching, this
 * says so instead of the suite going quietly green.
 */
describe('the readers blob excludes what only declares the schema', () => {
  it('drops both declarers, whatever the platform spells a path separator as', () => {
    expect(sourceFiles(SRC).length - readerFiles.length).toBe(DECLARERS.length);
  });

  it('drops the project fixtures, which construct a workspace rather than reading one', () => {
    const dropped = readerFiles.filter((f) => isFixture(readFileSync(f, 'utf8')));
    expect(
      dropped.length,
      'no fixture was recognised — the predicate has stopped matching',
    ).toBeGreaterThan(4);
  });

  it('and what is left does not contain the schema declaration itself', () => {
    // The one string that made every case vacuous. `WorkspaceState`'s body is
    // only in `types.ts`, so its presence here means a declarer got back in.
    expect(readers).not.toContain('export interface WorkspaceState');
    expect(readers).not.toContain('export interface Track {');
  });
});

/**
 * Fields whose only job is to be stored and handed back — a reader would be
 * make-work. Anything added here needs a reason beside it.
 */
const STORAGE_ONLY: Record<string, string> = {
  schemaVersion: 'the migration gate reads it in projectRepo, which is a declarer by definition',
  createdAt: 'shown by the browser through the project metadata list, not by field name',
  modifiedAt: 'same — the projects list formats it from the metadata record',
};

describe.each([
  ['ProjectData', 'the project'],
  ['Track', 'a track'],
  ['Note', 'a note'],
  // `WorkspaceState` is the fourth because it is where this defect had gone
  // next. `Track.height` was caught by the `Track` sweep only once something
  // read it; `pxPerBeat` and `snap` sat one level down inside `workspace` and
  // were swept by nothing at all, which is exactly the gap `laneScale` was
  // about to be added into.
  ['WorkspaceState', 'the saved workspace'],
])('every field %s declares is read by something', (interfaceName) => {
  const fields = fieldsOf(types, interfaceName);

  it(`finds a plausible field list for ${interfaceName}`, () => {
    // A non-vacuity check: a parser that found nothing would make every case
    // below pass. `WorkspaceState` genuinely declares three, so the floor is
    // per interface rather than one number that would have to be lowered to
    // the smallest — which is how a floor stops checking the large ones.
    expect(fields.length).toBeGreaterThanOrEqual(interfaceName === 'WorkspaceState' ? 3 : 6);
  });

  for (const field of fields) {
    const why = STORAGE_ONLY[field];
    it(`${field}${why ? ' is storage only' : ''}`, () => {
      if (why) return;
      // `.field` catches property access; `field:` catches destructuring and
      // object literals built from it.
      const used = new RegExp(`[.\\[']${field}\\b|\\b${field}\\s*[:,)]`).test(readers);
      expect(used, `${interfaceName}.${field} is declared and validated but nothing reads it`).toBe(
        true,
      );
    });
  }
});
