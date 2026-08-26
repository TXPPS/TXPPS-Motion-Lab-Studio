/**
 * The FSP8 parity audit, kept honest against the code it describes.
 *
 *   node scripts/parity-guard.mjs           # verdicts against the repository
 *   node scripts/parity-guard.mjs --list    # what is claimed, and how it is settled
 *
 * `docs/reference/fsp8-parity-*.md` is eleven thousand lines of verdicts taken
 * by reading the reference manual against this repository at one moment.
 * Nothing kept them matching afterwards, and five of the eight items those
 * documents name as their own priorities had been closed while the documents
 * still called them missing. The headline one — "the cheapest high-value item
 * is that **no keyboard shortcut opens any pane**" — is answered by nine
 * shortcuts that have been in `src/app/shortcuts.ts` for directives.
 *
 * A stale audit is worse than no audit, for the same reason a configured check
 * nobody invokes is worse than a missing one: it is *evidence*, and it stops
 * anybody looking.
 *
 * It used to check thirteen claims. Thirteen of nine hundred and forty-seven is
 * not a guarded document, it is a guarded paragraph — so this now settles every
 * claim in the corpus one of three ways, and fails if any claim is settled none
 * of them:
 *
 *  - **Its own evidence.** The chapters record what they looked at as well as
 *    what they concluded — "Grepped `audioPart`, `consolidate`: no hits in
 *    `src/`" — and its key promises it: "`MISSING` — absent, with the grep that
 *    established it named". Every cited path and filename must still resolve
 *    and every symbol said to be absent must still be absent. **806 claims**,
 *    and its first run found three sentences that had stopped being true.
 *  - **A pinned predicate.** Thirteen claims the chapters call their own
 *    priorities, each tied to a predicate that must agree with the recorded
 *    verdict in both directions. This is the only check that can see a
 *    `MISSING` that quietly became true.
 *  - **A recorded judgement.** 141 claims across 99 sections whose MotionLab
 *    side is the absence of a whole subsystem, or a gesture no static read
 *    settles. Each section is named in `scripts/parity/judgement.mjs` with the
 *    reason, and a section listed there that *gains* a citation fails: that is
 *    a claim that became checkable and was left out.
 *
 * What this still does not check is the reference half. Whether FSP8 does what
 * the manual says is not knowable from this repository, and pretending
 * otherwise would be the second opinion CLAUDE.md's rule is about.
 */
import { readClaims, tally } from './parity/claims.mjs';
import { evidenceIn, pathExists, fileExists, stillAbsent } from './parity/evidence.mjs';
import { JUDGEMENT, REASONS, NARRATIVE, PROPOSED } from './parity/judgement.mjs';
import { PINNED, expected, read } from './parity/pinned.mjs';
import {
  workflowClaims,
  deviceClaims,
  unlistedDevices,
  brokenCitations,
} from './parity/workflow.mjs';

const LIST = process.argv.includes('--list');
const problems = [];

const { claims, unread, sections } = readClaims();

/*
 * A section that states a verdict and yields no claim.
 *
 * The chapters spell a gap eight different ways, and every one of them was
 * found by running the enumerator and looking at what it could not read rather
 * than by reading eleven thousand lines. A ninth spelling would land here.
 */
for (const s of unread) {
  if (NARRATIVE[s.id]) continue;
  problems.push(
    `${s.file}:${s.line} — ${s.id} states a verdict ${s.mentions} time(s) and no claim could be ` +
      'read from it. Either the chapter has a notation `scripts/parity/claims.mjs` does not know, ' +
      'or the section is narrative and belongs in NARRATIVE with the reason.',
  );
}
for (const id of Object.keys(NARRATIVE)) {
  if (!unread.some((s) => s.id === id)) {
    problems.push(
      `${id} is registered as NARRATIVE and now yields claims. Drop the entry — leaving it ` +
        'exempts whatever is written there next.',
    );
  }
}

// ---------------------------------------------------------------- evidence
const evidence = new Map();
for (const s of sections.values()) evidence.set(s.id, evidenceIn(s.text));

const checkable = (id) => {
  const e = evidence.get(id);
  return !!e && (e.paths.length > 0 || e.files.length > 0 || e.absent.length > 0);
};

for (const [id, e] of evidence) {
  const where = sections.get(id);
  for (const p of e.paths) {
    if (pathExists(p)) continue;
    problems.push(
      `${where.file}:${where.line} — ${id} cites \`${p}\`, which is not a file. ` +
        'A verdict resting on a path that has moved is a verdict nobody can re-derive.',
    );
  }
  for (const f of e.files) {
    if (fileExists(f) || PROPOSED[f]) continue;
    problems.push(
      `${where.file}:${where.line} — ${id} cites \`${f}\` and no such file exists. ` +
        'If the audit is proposing it rather than citing it, say so in PROPOSED.',
    );
  }
  for (const sym of e.absent) {
    if (stillAbsent(sym)) continue;
    problems.push(
      `${where.file}:${where.line} — ${id} says \`${sym}\` is absent from src/, and it is there ` +
        'now. Either the claim was closed and never written down, or the grep the audit named ' +
        'is not the one it meant.',
    );
  }
}
for (const [name, why] of Object.entries(PROPOSED)) {
  if (!fileExists(name)) continue;
  problems.push(
    `\`${name}\` is registered as PROPOSED (${why}) and now exists. It is a citation, not a ` +
      'proposal — drop the entry so the checker starts holding it to that.',
  );
}

// ------------------------------------------------------------- judgement
const needsJudgement = new Set();
for (const c of claims) if (!checkable(c.section)) needsJudgement.add(c.section);

for (const id of needsJudgement) {
  const reason = JUDGEMENT[id];
  const where = sections.get(id);
  if (!reason) {
    problems.push(
      `${where.file}:${where.line} — ${id} makes a claim about this repository and cites nothing ` +
        'checkable. Cite the code it rests on, or record it in `scripts/parity/judgement.mjs` ' +
        'with the reason no read of this repository can settle it.',
    );
  } else if (!REASONS[reason]) {
    problems.push(`${id} is marked "${reason}", which is not one of: ${Object.keys(REASONS)}`);
  }
}
for (const id of Object.keys(JUDGEMENT)) {
  if (needsJudgement.has(id)) continue;
  const where = sections.get(id);
  problems.push(
    `${id} is recorded as needing judgement and now ${
      where ? 'cites checkable code' : 'no longer exists'
    }. ${where ? 'It became checkable and was left out of the sweep.' : 'The section was renamed or removed.'}`,
  );
}

// ---------------------------------------------------------------- pinned
for (const claim of PINNED) {
  if (!read(claim.doc).includes(claim.anchor)) {
    problems.push(
      `${claim.id}: "${claim.anchor}" is no longer in ${claim.doc}. ` +
        'Either the claim moved and this entry needs its new anchor, or it was dropped ' +
        'and this entry should go with it.',
    );
    continue;
  }
  const actual = claim.holds();
  if (actual === expected(claim)) continue;
  problems.push(
    actual
      ? `${claim.id}: recorded ${claim.verdict}, and the code now does it — ${claim.what}. ` +
          `Update ${claim.doc} and the verdict here in the same commit.`
      : `${claim.id}: recorded ${claim.verdict}, and the code no longer does it — ${claim.what}. ` +
          'That is a regression, not a stale document.',
  );
}

// --------------------------------------------- the two non-chapter documents
/*
 * `docs/PARITY.md` and `docs/DEVICE-PARITY.md` record product state and were
 * checked by nothing at all — the same position the chapters were in, one
 * directory up and with a different notation. Their first run found seven
 * shipped devices the gap list had never been told about.
 */
const workflow = workflowClaims();
const devices = deviceClaims();
problems.push(...workflow.problems, ...devices.problems, ...brokenCitations());
for (const kind of unlistedDevices()) {
  problems.push(
    `docs/DEVICE-PARITY.md: \`${kind}\` is in the picker and in no row of the gap list. ` +
      'A gap list that does not know about a device cannot have a gap for it, and its ' +
      'silence reads as parity.',
  );
}

// ------------------------------------------------------------------ report
const counts = tally(claims);
const byEvidence = claims.filter((c) => checkable(c.section)).length;

if (LIST) {
  console.log(`FSP8 parity: ${claims.length} claim(s) across ${sections.size} section(s)\n`);
  for (const [v, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${v}`);
  }
  console.log(`\n  ${byEvidence} settled by the audit's own citations`);
  console.log(`  ${PINNED.length} pinned to a predicate that must agree with the verdict`);
  console.log(
    `  ${claims.length - byEvidence} needing judgement, across ${needsJudgement.size} section(s):`,
  );
  const perReason = {};
  for (const id of needsJudgement)
    perReason[JUDGEMENT[id] ?? '(unregistered)'] =
      (perReason[JUDGEMENT[id] ?? '(unregistered)'] ?? 0) + 1;
  for (const [r, n] of Object.entries(perReason))
    console.log(`      ${String(n).padStart(3)}  ${r} — ${REASONS[r] ?? '???'}`);
  process.exit(0);
}

if (problems.length > 0) {
  console.error('parity-guard: the audit and the code disagree.\n');
  for (const p of problems) console.error(`  ${p}\n`);
  process.exit(1);
}
const parity = PINNED.filter((c) => c.verdict === 'PARITY').length;
console.log(
  `parity-guard: ${claims.length} claim(s) in ${sections.size} section(s) — ` +
    `${byEvidence} checked against the audit's own citations, ${PINNED.length} pinned to a ` +
    `predicate (${parity} at parity), ${claims.length - byEvidence} recorded as needing ` +
    `judgement with a reason. ${counts.MISSING} MISSING, ${counts.PARTIAL} PARTIAL still open.`,
);
console.log(
  `parity-guard: docs/PARITY.md ${workflow.claims.length} row(s), all three verdicts declared; ` +
    `docs/DEVICE-PARITY.md ${devices.claims.length} row(s), every named kind installed and ` +
    `every installed kind named.`,
);
