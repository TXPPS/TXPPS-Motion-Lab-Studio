// What the app is built from, as one number.
//
// `docs/audit/SOAK.md` used to declare only the bundle it measured, and
// `docs-guard` compared that name against `dist/`. It could never pass: the
// bundle's hash moves with the commit date — `vite.config.ts` compiles it in —
// so committing the fresh soak report is itself enough to invalidate the hash
// the report has just been made to name. A check that cannot be satisfied gets
// turned off, which is how the whole class of failure this guards against
// started.
//
// The question worth asking is narrower and stable: **has any source the bundle
// is built from changed since the soak ran?** A documentation commit has not
// changed it. Editing one line of `src/` has.
//
// Hashed from the files rather than from git, so it is the same number in a
// dirty tree, in a shallow clone, and on a machine with no git at all — three
// places where the git answer is either wrong or unavailable.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/** Extensions that end up in the bundle. A `.md` beside a component does not. */
const COMPILED = /\.(ts|tsx|css|json|html)$/;

function walk(dir, out) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (COMPILED.test(name)) out.push(full);
  }
  return out;
}

/**
 * A stable digest of every compiled source, path included.
 *
 * Paths are hashed as well as contents because moving a file changes what the
 * bundle is without changing any byte of any file. Line endings are normalised
 * for the reason the WASM check needed it: `.gitattributes` checks out LF and a
 * Windows editor writes CRLF, and a digest that moved on that would report a
 * source change where there is none.
 */
export function srcFingerprint() {
  const files = walk(join(ROOT, 'src'), []);
  const h = createHash('sha256');
  const CR = String.fromCharCode(13);
  const LF = String.fromCharCode(10);
  for (const full of files) {
    h.update(relative(ROOT, full).split(sep).join('/'));
    h.update(
      readFileSync(full, 'utf8')
        .split(CR + LF)
        .join(LF),
    );
  }
  return h.digest('hex').slice(0, 16);
}
