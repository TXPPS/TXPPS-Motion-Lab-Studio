// The two kinds of edit every check is proved with, and the shapes they take.
//
// Split out because both halves of the registry need them and the registry
// itself had grown past the house limit of about four hundred lines. A file
// that long is describing more than one thing, and this one was describing
// three: what each script *is*, how each gate is made to fail, and how each is
// made to pass.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './inventory.mjs';

/** A file created from nothing, and deleted again afterwards. */
export const creating = (file, content) => ({ file, content });
/** An edit to a tracked file. The driver restores the original either way. */
export const editing = (file, from, to) => ({ file, from, to });

/**
 * The satisfiability case for a generated file: break it, run the writer, and
 * the check must go green again.
 *
 * Written as one helper because every generator check has the same shape and
 * the same failure mode — the one `docs-guard`'s currency rule had, where the
 * state the check demanded could not be produced by the command its own error
 * message names.
 */
export const repairedBy = (repair) => ({ name: `\`${repair}\` restores it`, repair });

/** A file the check under test is supposed to accept without complaint. */
export const accepting = (name, file, content) => ({ name, edits: [creating(file, content)] });

/** What `docs/audit/SOAK.md` declares its source fingerprint to be, right now. */
export const currentDeclaredSource = () =>
  readFileSync(join(ROOT, 'docs/audit/SOAK.md'), 'utf8').match(
    /- \*\*Source\*\* `[0-9a-f]{16}`/,
  )?.[0] ?? '- **Source** `unknown`';

/** A TypeScript source that is well typed, lint-clean, formatted and MIT. */
export const CLEAN_TS =
  '// SPDX-License-Identifier: MIT\n' + 'export const satisfied: number = 1;\n';
