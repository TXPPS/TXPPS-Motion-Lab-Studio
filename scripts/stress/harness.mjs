/**
 * What every stress section shares: the budget, the scoping, and the two
 * measurements that are easy to take wrongly.
 *
 * Split out of `scripts/stress.mjs`, which had reached 635 lines against a
 * house rule of about 400. The split is a move and nothing else — the whole
 * point of a harness that measures the product is that a refactor of it must be
 * provably inert, so `npm run probe:mutations` ran before and after and every
 * verdict is the same.
 *
 * `frames` and `heldBytes` are here rather than beside their callers because
 * both carry a correction that is easy to undo by rewriting them locally: the
 * frame sampler is what turns an unawaited loop's ten million discarded
 * promises into the 361 operations that actually happened, and `heldBytes`
 * forces collection before reading, without which the heap appears to shrink by
 * 79 MB and the harness is measuring the collector.
 */
import { unless } from '../probe-mutant.mjs';

const BASE = process.env.STRESS_BASE ?? 'http://localhost:4173';
const JSON_ONLY = process.argv.includes('--json');
/** Where the remote environment keeps its browser, when it has one. */
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';

/** One display refresh at 60 Hz. Two of these is the "it stutters" line. */
const FRAME_MS = 16.7;

/**
 * The p90 a frame has to exceed for the ceiling to count, in milliseconds.
 *
 * Two refreshes by default, which is the number the row means. It is settable
 * because the ceiling's *confirmation* step cannot be exercised on a machine
 * fast enough to carry four hundred tracks inside the budget: the branch never
 * runs, and a mutation of it reads as a correction that stopped mattering
 * rather than one that was never tried. A tighter budget puts the branch back
 * on the path, and the mutation driver sets it for both sides of its
 * comparison.
 */
const FRAME_BUDGET_MS = Number(process.env.STRESS_FRAME_BUDGET ?? FRAME_MS * 2);

/**
 * A single section, for the probe mutation driver.
 *
 * The full matrix walks to four hundred tracks and takes minutes, which is not
 * something that can be run once per recorded probe correction. Each section
 * gates on this, so a mutation of the transport fuzz runs the transport fuzz.
 * Baseline and mutant are scoped identically, so the reduction cannot flatter
 * either of them.
 */
const SECTION_SCOPE = (process.env.STRESS_ONLY ?? '').split(',').filter(Boolean);
const section = (name) => SECTION_SCOPE.length === 0 || SECTION_SCOPE.includes(name);

const results = [];
const record = (name, value, unit, note = '') => {
  results.push({ name, value, unit, note });
  if (!JSON_ONLY) {
    const shown = typeof value === 'number' ? value.toFixed(Math.abs(value) >= 100 ? 0 : 2) : value;
    console.log(
      `  ${name.padEnd(32)} ${String(shown).padStart(9)} ${String(unit).padEnd(7)} ${note}`,
    );
  }
};
const fail = (name, why) => {
  record(name, 'FAIL', '', why);
  process.exitCode = 1;
};
// ---------------------------------------------------------------- helpers

/**
 * Median, p90 and worst frame over `ms`.
 *
 * The median says what it feels like; the maximum says whether it stutters. A
 * mean hides the single long frame that is the only one a user notices.
 */
const framesOn = (page) => (ms) =>
  page.evaluate(async (duration) => {
    const gaps = [];
    let last = performance.now();
    const start = last;
    await new Promise((done) => {
      const tick = () => {
        const now = performance.now();
        gaps.push(now - last);
        last = now;
        if (now - start < duration) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    gaps.sort((a, b) => a - b);
    return {
      median: gaps[Math.floor(gaps.length / 2)] ?? 0,
      p90: gaps[Math.floor(gaps.length * 0.9)] ?? 0,
      max: gaps.at(-1) ?? 0,
    };
  }, ms);

/**
 * Heap after a forced collection, in bytes.
 *
 * Collected first and sampled second, so what is reported is what the app is
 * *holding* rather than what it has not got round to freeing. Retained growth
 * is a leak; uncollected garbage is not, and only one of those is worth a P1.
 */
const heldBytesOn = (page) => () =>
  page.evaluate(
    async (collections) => {
      if (!performance.memory || typeof window.gc !== 'function') return null;
      for (let i = 0; i < collections; i += 1) {
        window.gc();
        await new Promise((r) => setTimeout(r, 60));
      }
      return performance.memory.usedJSHeapSize;
    },
    unless('stress/forced-gc', 3, 0),
  );

/**
 * The two shared measurements, bound to the page a section is running on.
 *
 * They were closures over the driver's `page` and are now closures over one
 * handed in, which is the only thing the split changed about either. Neither
 * body moved: both carry a recorded probe correction — the frame sampler is
 * what turns an unawaited loop's ten million discarded promises into the three
 * hundred and sixty-odd operations that happened, and `heldBytes` forces
 * collection before reading, without which the heap appears to shrink by 79 MB.
 */
export function bind(page) {
  return { frames: framesOn(page), heldBytes: heldBytesOn(page) };
}

export {
  BASE,
  JSON_ONLY,
  PREINSTALLED_CHROMIUM,
  FRAME_MS,
  FRAME_BUDGET_MS,
  SECTION_SCOPE,
  section,
  results,
  record,
  fail,
};
