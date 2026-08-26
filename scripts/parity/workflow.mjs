// The two parity documents that are not FSP8 chapters.
//
// `docs/PARITY.md` is the workflow-level table — Yes / Partial / No, section by
// section — and `docs/DEVICE-PARITY.md` is the device-face gap list. Both
// record product state and neither was checked by anything. That is the same
// position the eleven-thousand-line FSP8 chapters were in before `parity-guard`
// grew past its thirteen pinned claims, and it is the position the directive
// calls out: a document that records state and is not verified will be wrong,
// and its being wrong is invisible.
//
// They are read here rather than by `claims.mjs` because their notation is not
// the chapters'. The chapters say MISSING / PARTIAL / PARITY in eight different
// shapes; these two say **Yes** in a fixed column and name effect kinds in
// backticks. A parser stretched to cover both would be worse at each.
//
// What is settled, and how:
//
//   PARITY.md         every row's verdict is one of the three the document's
//                     own key declares — a fourth spelling is a claim nobody
//                     defined — and every repository path or filename its
//                     detail column cites still resolves.
//   DEVICE-PARITY.md  every effect kind it names in the "Ours" column exists in
//                     `EFFECT_SPECS` or the Motion Wave registry, and every row
//                     whose "Ours" column is a dash still has no counterpart.
//                     That second one is the direction that catches a closure:
//                     "we have no Expander" stops being true the day somebody
//                     adds `expander`.
//
// What is not settled is the prose. "No live GR line drawn on the graph itself"
// is a claim about a face, and no static read decides it — those rows go to the
// judgement path with a reason, the same as the chapters' 141.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { evidenceIn, pathExists, fileExists } from './evidence.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/** The three verdicts `docs/PARITY.md` declares in its own key, and only those. */
const WORKFLOW_VERDICTS = new Set(['Yes', 'Partial', 'No']);

const isRule = (line) => /^\|[\s|:-]*\|?\s*$/.test(line.replace(/-/g, '-'));
const cells = (line) =>
  line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());

/**
 * `docs/PARITY.md` — one claim per table row.
 *
 * The subject is the reference feature in column one and the verdict is the
 * bolded word in column two. A row whose second column is not one of the three
 * is reported rather than skipped: an undefined verdict reads as a considered
 * answer and is not one.
 */
export function workflowClaims() {
  const file = 'docs/PARITY.md';
  const lines = read(file).split(/\r?\n/);
  const claims = [];
  const problems = [];
  let heading = '(preamble)';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^#{2,4}\s+(.*)$/.exec(line);
    if (h) {
      heading = h[1].trim();
      continue;
    }
    if (!line.startsWith('|') || isRule(line)) continue;
    const c = cells(line);
    if (c.length < 2) continue;
    const bare = c[1].replace(/\*/g, '').trim();
    // The header row of every table, which names the two products.
    if (bare === 'MotionLab' || c[0] === 'Reference') continue;
    if (!bare) continue;

    if (!WORKFLOW_VERDICTS.has(bare)) {
      problems.push(
        `${file}:${i + 1}: "${bare}" is not one of the three verdicts this document's own ` +
          `key declares (Yes, Partial, No). A fourth spelling reads as an answer and is not one.`,
      );
      continue;
    }
    claims.push({
      id: `workflow/${heading}#${c[0].replace(/`/g, '')}`,
      file,
      line: i + 1,
      verdict: bare,
      detail: c.slice(2).join(' — '),
    });
  }
  return { claims, problems };
}

/**
 * `docs/DEVICE-PARITY.md` — the column that can be checked, checked.
 *
 * A device row opens with our kind in backticks or with an em dash meaning we
 * have none. Both are decidable against `src/model/effects.ts`, and the second
 * is the one that goes stale silently: a gap closes and the document keeps
 * saying it is open.
 */
export function deviceClaims() {
  const file = 'docs/DEVICE-PARITY.md';
  const lines = read(file).split(/\r?\n/);
  const kinds = installedKinds();
  const claims = [];
  const problems = [];
  let heading = '(preamble)';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^#{2,4}\s+(.*)$/.exec(line);
    if (h) {
      heading = h[1].trim();
      continue;
    }
    if (!line.startsWith('|') || isRule(line)) continue;
    const c = cells(line);
    if (c.length < 2 || c[0] === 'Ours') continue;

    const mine = /`([A-Za-z0-9-]+)`/.exec(c[0])?.[1] ?? null;
    const none = /^[—-]$/.test(c[0].trim());
    if (!mine && !none) continue;

    if (mine && !kinds.has(mine)) {
      problems.push(
        `${file}:${i + 1}: names \`${mine}\` as one of ours and no such kind is in ` +
          `EFFECT_SPECS or the Motion Wave registry. The row describes a device that is ` +
          `not in the product.`,
      );
      continue;
    }
    claims.push({
      id: `device/${heading}#${mine ?? `absent-${c[1].replace(/\*/g, '').trim()}`}`,
      file,
      line: i + 1,
      verdict: mine ? 'HAVE' : 'NONE',
      detail: c.slice(1).join(' — '),
      // The gap column is prose about a face. Recorded, never decided here.
      gap: c.at(-1) ?? '',
    });
  }
  return { claims, problems, kinds };
}

/**
 * Every effect kind the product actually installs.
 *
 * Three sources, because there are three. `EFFECT_SPECS` is the array; the
 * Motion Wave units register separately; and `WAM_SPEC` sits outside the array
 * on its own, which is why the first version of this reported `wam` as a device
 * the document had invented. It is in the picker like the rest of them.
 */
export function installedKinds() {
  const out = new Set();
  const src = read('src/model/effects.ts');
  const start = src.indexOf('export const EFFECT_SPECS');
  const end = src.indexOf('\n];', start);
  for (const m of src
    .slice(start, end === -1 ? src.length : end)
    .matchAll(/^ {4}kind:\s*'([A-Za-z0-9-]+)',/gm)) {
    out.add(m[1]);
  }
  for (const m of src.matchAll(/^export const \w*_SPEC: EffectSpec = \{\n\s*kind: '([\w-]+)'/gm)) {
    out.add(m[1]);
  }
  for (const m of read('src/audio/motionwave/registry.ts').matchAll(/kind:\s*'(mw-[a-z-]+)'/g)) {
    out.add(m[1]);
  }
  return out;
}

/**
 * Devices the gap list has never been told about.
 *
 * The direction that catches a shipped feature rather than a deleted one, and
 * the one that had already gone wrong: the document opens by saying "our
 * catalogue is 27 effect kinds", and the seven Motion Wave units shipped into
 * the picker without a row here. A gap list that does not know about a device
 * cannot have a gap for it, and its silence reads as parity.
 */
export function unlistedDevices() {
  const named = new Set(
    deviceClaims()
      .claims.filter((c) => c.verdict === 'HAVE')
      .map((c) => c.id.split('#')[1]),
  );
  return [...installedKinds()].filter((k) => !named.has(k)).sort();
}

/**
 * Citations in either document that no longer resolve.
 *
 * The same rule the chapters are held to: a document that names the file it
 * read is checkable against that file, and a name that has stopped resolving is
 * the first sign the sentence around it has stopped being true.
 */
export function brokenCitations() {
  const out = [];
  for (const file of ['docs/PARITY.md', 'docs/DEVICE-PARITY.md']) {
    const { paths, files } = evidenceIn(read(file));
    for (const p of paths) if (!pathExists(p)) out.push(`${file}: cites \`${p}\`, which is gone.`);
    for (const f of files) {
      if (!fileExists(f)) out.push(`${file}: cites \`${f}\`, which is in no directory now.`);
    }
  }
  return out;
}
