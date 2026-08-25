/**
 * Plant each probe's old defect and confirm the probe still fails on it.
 *
 *   npm run preview &
 *   npm run probe:mutations             # run every recorded correction
 *   npm run probe:mutations -- --check  # registry against call sites, no browser
 *   npm run probe:mutations -- reach/   # one prefix
 *
 * Thirteen probe defects were found and fixed across the stress harness and the
 * reachability sweep. Each was diagnosed properly and none was verified, and
 * those are different things: a correction that quietly *widens* a check looks
 * exactly like one that fixes it, because both make the red go away. This is
 * what tells them apart — restore the defect, and the measurement must get
 * worse. If it does not, either the product moved and the correction is moot,
 * or the correction never caught anything.
 *
 * The comparison is differential and same-scope. Baseline and mutant run the
 * identical reduced sweep back to back, so a slow machine, a flaky route or a
 * warm cache moves both of them and cancels.
 *
 * `--check` is the half that runs in the build: every registry id must appear
 * in a probe source and every `unless(...)` / `mutated(...)` call site must have
 * a registry entry. That is what stops a correction being deleted along with
 * the evidence that it mattered, which is the failure mode this whole file is
 * about.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MUTATIONS, MUTATION_IDS } from './probe-mutant.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const CHECK = process.argv.includes('--check');
const FILTER = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '';

/**
 * The probe sources, and the ids each one actually plants.
 *
 * A list of files per probe rather than a single file, because two of the three
 * grew past the house limit of about four hundred lines and were split. The
 * `--check` below is what made that split safe to make: a correction whose call
 * site moved into a module this list does not name reads as a registry entry
 * planted nowhere, and fails the build rather than going quiet.
 */
const PROBES = {
  reachability: [
    'scripts/reachability.mjs',
    'scripts/reach/targets.mjs',
    'scripts/reach/walk.mjs',
    'scripts/reach/menus.mjs',
    'scripts/reach/report.mjs',
  ],
  stress: ['scripts/stress.mjs'],
  bypass: ['scripts/bypass-probe.mjs'],
};

function plantedIn(files) {
  const found = new Set();
  for (const file of files) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    for (const m of src.matchAll(/\b(?:unless|mutated)\(\s*'([^']+)'/g)) found.add(m[1]);
  }
  return found;
}

// ------------------------------------------------------------------- --check

if (CHECK) {
  const planted = new Map();
  for (const [probe, files] of Object.entries(PROBES)) {
    for (const id of plantedIn(files)) planted.set(id, probe);
  }
  const problems = [];
  for (const m of MUTATIONS) {
    if (m.expect === 'unfalsifiable' && !m.unfalsifiableBecause) {
      problems.push(`${m.id}: expect is unfalsifiable and no reason is given`);
    }
    if (!planted.has(m.id)) problems.push(`${m.id}: in the registry, planted nowhere`);
    else if (planted.get(m.id) !== m.probe) {
      problems.push(`${m.id}: registered against ${m.probe}, planted in ${planted.get(m.id)}`);
    }
  }
  for (const [id, probe] of planted) {
    if (!MUTATION_IDS.includes(id))
      problems.push(`${id}: planted in ${probe}, not in the registry`);
  }
  if (problems.length > 0) {
    console.error('probe:mutations --check failed:');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`probe:mutations --check: ${MUTATIONS.length} correction(s), each planted once.`);
  process.exit(0);
}

// -------------------------------------------------------------------- runner

/** One scoped run of a probe, returning the measurement the registry names. */
function run(entry, mutation) {
  const env = { ...process.env };
  if (mutation) env.MW_PROBE_MUTATION = mutation;
  else delete env.MW_PROBE_MUTATION;

  if (entry.probe === 'reachability') {
    env.REACH_FORMS = entry.scope.forms ?? '';
    env.REACH_TARGETS = entry.scope.targets ?? '';
    execFileSync(process.execPath, ['scripts/reachability.mjs', '--json'], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'ignore', 'inherit'],
      timeout: 300000,
    });
    const rows = JSON.parse(readFileSync(join(ROOT, 'reachability-out.json'), 'utf8'));
    // Whether the branch this correction is about was entered at all.
    //
    // Two forms, because the evidence is two different shapes: a counter the
    // sweep keeps (`counter:scrolls`), or a route it recorded taking
    // (`via:with a MIDI clip open`). Without one of these a correction the run
    // never tried reads as one that stopped mattering, and those want opposite
    // responses.
    let exercised = true;
    let why = '';
    if (entry.exercisedBy?.startsWith('counter:')) {
      const name = entry.exercisedBy.slice('counter:'.length);
      const counters = JSON.parse(readFileSync(join(ROOT, 'reachability-probe.json'), 'utf8'));
      exercised = (counters[name] ?? 0) > 0;
      why = `${name} = ${counters[name] ?? 0} in this scope`;
    } else if (entry.exercisedBy?.startsWith('via:')) {
      const needle = entry.exercisedBy.slice('via:'.length);
      exercised = rows.some((r) => (r.via ?? '').includes(needle));
      why = `no target was reached via "${needle}" in this scope`;
    }
    return {
      value: rows.filter((r) => r.state === 'REACHABLE').length,
      unit: 'reachable',
      exercised,
      why,
    };
  }

  if (entry.probe === 'bypass') {
    // One kind is enough. Every correction here is about how the render is
    // taken rather than about which insert took it, so a sweep of thirty-four
    // would cost thirty-four renders to learn what one render says.
    env.BYPASS_KINDS = entry.scope.kinds ?? 'reverb';
    execFileSync(process.execPath, ['scripts/bypass-probe.mjs', '--json'], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'ignore', 'inherit'],
      timeout: 600000,
    });
    const rows = JSON.parse(readFileSync(join(ROOT, 'bypass-out.json'), 'utf8'));
    const row = rows.find((r) => r.name === entry.metric);
    if (!row) throw new Error(`bypass-probe reported no row named "${entry.metric}"`);
    return { value: row.value, unit: row.unit ?? '', exercised: true, why: '' };
  }

  env.STRESS_ONLY = entry.scope.section;
  if (entry.scope.frameBudgetMs) env.STRESS_FRAME_BUDGET = String(entry.scope.frameBudgetMs);
  let failed = false;
  try {
    execFileSync(process.execPath, ['scripts/stress.mjs', '--json'], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'ignore', 'inherit'],
      timeout: 900000,
    });
  } catch {
    // A non-zero exit is `fail()` firing, which for some mutations is the
    // point: the probe is supposed to report a defect that is not there.
    failed = true;
  }
  const rows = JSON.parse(readFileSync(join(ROOT, 'stress-out.json'), 'utf8'));
  // The row that says whether the branch this correction is about did anything
  // on this run. Without it, a correction the host never gave a chance to
  // matter is indistinguishable from one that stopped mattering.
  const guard = entry.exercisedBy ? rows.find((r) => r.name === entry.exercisedBy) : null;
  const row = rows.find((r) => r.name === entry.metric);
  // A missing row is a registry that names a measurement the probe does not
  // make, which reads as a decayed correction and is not one. Two of the six
  // stress entries said exactly that on their first run.
  if (!row) throw new Error(`stress reported no row named "${entry.metric}"`);
  return {
    value: row.value,
    unit: row.unit ?? '',
    failed,
    note: row.note ?? '',
    exercised: guard ? guard.value > 0 : true,
    why: guard?.note ?? '',
  };
}

/** Did the mutation degrade the measurement in the direction the registry claims? */
function degraded(entry, base, mutant) {
  switch (entry.expect) {
    case 'fewer':
      return typeof mutant.value === 'number' && typeof base.value === 'number'
        ? mutant.value < base.value
        : mutant.failed && !base.failed;
    case 'more':
      return typeof mutant.value === 'number' && typeof base.value === 'number'
        ? mutant.value > base.value
        : false;
    case 'differs':
      return String(mutant.value) !== String(base.value);
    case 'fails':
      return mutant.failed && !base.failed;
    // A correction that is plainly right and no longer catches anything.
    //
    // Not a mute. The run prints it by name every time, with the reason, and
    // `--check` requires the reason to be there — so it stays visible in a way
    // deleting the entry would not. What it is not is a failure: keeping a
    // correct behaviour whose defect the product has grown out of is the right
    // call, and reporting it as rot would train somebody to stop reading this.
    case 'unfalsifiable':
      return true;
    default:
      throw new Error(`unknown expectation ${entry.expect}`);
  }
}

if (!existsSync(join(ROOT, 'scripts/reachability.mjs'))) throw new Error('probes are missing');

const entries = MUTATIONS.filter((m) => m.id.startsWith(FILTER));
console.log(`Planting ${entries.length} recorded probe correction(s).\n`);

/**
 * Baselines are shared by scope, since a scope is deterministic.
 *
 * The key carries `exercisedBy` as well, and that was not obvious. A baseline
 * is not only a number: it also carries whether the branch this correction is
 * about was entered, and that is computed from the *entry's own* guard. Two
 * entries with the same scope and different guards were sharing one baseline,
 * so `reach/reassert-selection` — whose guard is `counter:reasserts` — was
 * being judged on `counter:scrolls`, and printed BLOCKED naming a counter that
 * has nothing to do with it.
 *
 * That is the defect this whole file exists to prevent, arriving in this file:
 * a verdict that looks decisive and is about something else. It was visible
 * only because the reason is printed beside the verdict rather than left as a
 * word in a column.
 */
const baselines = new Map();
const verdicts = [];

for (const entry of entries) {
  const key = `${entry.probe}|${JSON.stringify(entry.scope)}|${entry.metric ?? ''}|${entry.exercisedBy ?? ''}`;
  if (!baselines.has(key)) baselines.set(key, run(entry, null));
  const base = baselines.get(key);
  const mutant = run(entry, entry.id);
  // BLOCKED and DECAYED are opposite findings and look identical in a column.
  //
  // A correction whose branch this host never entered has not stopped
  // mattering; it has not been tried. `exercisedBy` names a row the probe emits
  // saying whether the branch did anything on this run, and without that
  // distinction the ceiling's confirmation step reads as rot on any machine
  // fast enough never to need it.
  const blocked = base.exercised === false;
  const ok = blocked ? null : degraded(entry, base, mutant);
  verdicts.push({ entry, base, mutant, ok, blocked });
  const show = (r) => `${r.value}${r.failed ? ' (FAIL)' : ''}`;
  // KEPT is its own word in the column as well as in the summary. It printed
  // HELD, because an `unfalsifiable` expectation is satisfied by definition —
  // so the one verdict that means "this correction is not load-bearing" was
  // showing up as the one that means it is.
  const verdict = blocked
    ? 'BLOCKED'
    : entry.expect === 'unfalsifiable'
      ? 'KEPT   '
      : ok
        ? 'HELD   '
        : 'DECAYED';
  console.log(
    `${verdict} ${entry.id.padEnd(28)} ` +
      `${String(show(base)).padStart(8)} -> ${String(show(mutant)).padEnd(10)} ` +
      `${entry.expect}`,
  );
  if (blocked) console.log(`         not exercised here: ${base.why}`);
  else if (entry.expect === 'unfalsifiable') {
    console.log(`         kept, not load-bearing: ${entry.unfalsifiableBecause}`);
  } else if (!ok) console.log(`         defect restored: ${entry.defect}`);
}

const decayed = verdicts.filter((v) => v.ok === false);
const blockedOut = verdicts.filter((v) => v.blocked);
const kept = verdicts.filter((v) => !v.blocked && v.entry.expect === 'unfalsifiable');
const held = verdicts.filter((v) => v.ok === true && v.entry.expect !== 'unfalsifiable').length;
console.log(
  `\n${held}/${verdicts.length} correction(s) still load-bearing, ` +
    `${blockedOut.length} not exercised on this host, ${kept.length} kept without being one.`,
);
for (const v of blockedOut) console.log(`  BLOCKED ${v.entry.id} — ${v.base.why}`);
for (const v of kept) console.log(`  KEPT    ${v.entry.id} — ${v.entry.unfalsifiableBecause}`);
if (decayed.length > 0) {
  console.log('\nThese corrections no longer change the measurement:');
  for (const v of decayed) console.log(`  ${v.entry.id} — ${v.entry.cost}`);
  process.exitCode = 1;
}
