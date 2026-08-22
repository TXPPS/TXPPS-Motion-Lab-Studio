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

/** Files that only declare or validate the schema, so they do not count as readers. */
const DECLARERS = ['src/model/types.ts', 'src/persistence/projectRepo.ts'];

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
const readers = sourceFiles(SRC)
  .filter((f) => !DECLARERS.some((d) => f.endsWith(d.replace('src/', '/'))))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

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
])('every field %s declares is read by something', (interfaceName) => {
  const fields = fieldsOf(types, interfaceName);

  it(`finds a plausible field list for ${interfaceName}`, () => {
    expect(fields.length).toBeGreaterThan(5);
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
