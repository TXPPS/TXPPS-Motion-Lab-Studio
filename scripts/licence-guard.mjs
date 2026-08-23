#!/usr/bin/env node
/**
 * Fail the build if copyleft-licensed source enters the repository.
 *
 * Directive 03 §2.1. Motion Wave is a commercial product, so GPL, AGPL and
 * SSPL source cannot be linked into it — and the risk is not that somebody
 * decides to add some, it is that a coefficient table or a difference equation
 * is pasted in from a reference implementation during a long modelling session
 * and nobody notices for a month. A check that runs on every build is the only
 * kind that catches that.
 *
 * What this deliberately does *not* flag: prose in `docs/` that names a licence.
 * The reference sheets record where every model's information came from and
 * whether it was usable, and "this emulator is GPL-3.0, so its constants are
 * quarantined and were re-derived" is exactly the sentence that keeps the
 * project safe. Banning the words would delete the audit trail rather than the
 * risk. So the scan is over source, and over any vendored directory a
 * dependency might arrive in.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** Directories never scanned: build output, dependencies, and the git store. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'test-results',
  'playwright-report',
  '.vite',
]);

/**
 * Only files that could actually be compiled or linked into the product.
 *
 * Markdown is absent on purpose — see the note above about the audit trail.
 */
const SOURCE_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.m',
  '.mm',
  '.lib',
  '.dsp',
  '.faust',
]);

/**
 * Phrases that appear in a copyleft header and essentially nowhere else.
 *
 * Matched case-insensitively against the first part of the file, because a
 * licence notice lives at the top; a mention halfway down a 2000-line file is
 * far more likely to be a comment about provenance than a grant of terms.
 */
const BANNED = [
  'gnu general public license',
  'gnu lesser general public license',
  'gnu affero general public license',
  'server side public license',
  'licensed under the gpl',
  'spdx-license-identifier: gpl',
  'spdx-license-identifier: agpl',
  'spdx-license-identifier: lgpl',
  'spdx-license-identifier: sspl',
];

/** How much of each file is treated as its header. */
const HEADER_CHARS = 4000;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/**
 * The scanner cannot scan itself: its own pattern list is, necessarily, a list
 * of the phrases it is looking for. Exempted by exact path rather than by any
 * cleverness with string assembly, so the exemption is one obvious line rather
 * than a trick that hides what the patterns are.
 */
const SELF = join(ROOT, 'scripts', 'licence-guard.mjs');

const offenders = [];
for (const path of walk(ROOT)) {
  if (path === SELF) continue;
  if (!SOURCE_EXT.has(extname(path))) continue;
  let head;
  try {
    head = readFileSync(path, 'utf8').slice(0, HEADER_CHARS).toLowerCase();
  } catch {
    continue; // unreadable or binary; nothing to link either way
  }
  for (const phrase of BANNED) {
    if (head.includes(phrase)) {
      offenders.push({ path: path.slice(ROOT.length), phrase });
      break;
    }
  }
}

if (offenders.length > 0) {
  console.error('Copyleft-licensed source found. This cannot ship in a commercial product.\n');
  for (const o of offenders) console.error(`  ${o.path}\n    matched: "${o.phrase}"`);
  console.error(
    '\nRe-derive the behaviour from the reference spec sheet and public documentation,\n' +
      'delete the file, and record what was removed and what replaced it in LEGAL_NOTES.md.',
  );
  process.exit(1);
}

console.log(`licence-guard: no copyleft source (${BANNED.length} patterns over source files)`);
