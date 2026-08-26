/**
 * What each script needs of the repository, declared rather than assumed.
 *
 * `docs-guard` ran `git cat-file -e` on eleven commits its historical documents
 * name. Cloudflare's builder clones with `--depth 1`, had fetched none of them,
 * failed all eleven, and `npm run build` exited 1 — so the deploy did not
 * happen and the live site sat on the previous commit while a bundle check
 * politely waited for a hash that was never coming.
 *
 * The lesson generalises past that one guard: **a claim about the repository,
 * made from a truncated copy of it, is the same error as BLOCKED being a claim
 * about the host.** Both are answers about an environment rather than about the
 * product, and both read as findings.
 *
 * So a script that invokes git says which copy can answer it, in one line the
 * build reads:
 *
 *   // @clone: working-tree — reads files, nothing about history
 *   // @clone: index        — reads what is staged
 *   // @clone: full-history — asks about commits; must handle a shallow clone
 *
 * `full-history` carries an obligation the other two do not: the script has to
 * detect a shallow clone and skip that part with a note, because the build
 * runs in one. `check-checks --check` enforces both halves — the declaration,
 * and the shallow handling that `full-history` implies.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from './inventory.mjs';

/** Anything that actually shells out to git, as opposed to mentioning it. */
const INVOKES_GIT = /exec(?:File)?Sync\(\s*[`'"]git[\s`'"]/;

/** The declaration, and the vocabulary it is allowed to use. */
const DECLARES = /@clone:\s*(working-tree|index|full-history)\b/;

/** How a script proves it noticed the clone might be truncated. */
const HANDLES_SHALLOW = /is-shallow-repository/;

function* scripts(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* scripts(path);
    else if (entry.endsWith('.mjs')) yield path;
  }
}

/**
 * One row per script that invokes git.
 *
 * Scripts that only *mention* git in a comment are not listed: four of them do,
 * explaining why they do not ask it anything, and demanding a declaration from
 * a file that makes no claim would turn the rule into paperwork.
 */
export function cloneClaims() {
  const out = [];
  for (const path of scripts(join(ROOT, 'scripts'))) {
    const src = readFileSync(path, 'utf8');
    if (!INVOKES_GIT.test(src)) continue;
    const declared = DECLARES.exec(src);
    out.push({
      file: relative(ROOT, path).split('\\').join('/'),
      declared: !!declared,
      needs: declared?.[1] ?? 'undeclared',
      handlesShallow: HANDLES_SHALLOW.test(src),
    });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}
