/**
 * The stress matrix, measured.
 *
 * Directive 10 §5. Run at every section boundary; a regression against the
 * previous row is a P1. Every check reports a *number* — a ceiling, a
 * millisecond, a byte count — because an adjective cannot be compared against
 * last week's adjective, which is the whole point of keeping the table.
 *
 *   npm run preview &
 *   npm run stress                    # human-readable, plus a PROGRESS row
 *   node scripts/stress.mjs --json    # machine-readable
 *
 * A check that cannot run here says `BLOCKED` and names the capability it is
 * missing. `BLOCKED` and `0` look identical in a table and mean opposite
 * things.
 *
 * The first run of this file reported 284,000 transport operations per second
 * and a heap that had shrunk by 79 MB, and both were the probe rather than the
 * product: unawaited calls are not operations, and two heap samples with a
 * collection between them measure the collector. Everything below is written
 * against that — awaited work, settled state, and heap read either side of a
 * forced collection.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import {
  BASE,
  JSON_ONLY,
  SECTION_SCOPE,
  results,
  record,
  fail,
  PREINSTALLED_CHROMIUM,
} from './stress/harness.mjs';
import { run as runScaling } from './stress/scaling.mjs';
import { run as runFuzz } from './stress/fuzz.mjs';
import { run as runEndurance } from './stress/endurance.mjs';

const browser = await chromium.launch({
  ...(existsSync(PREINSTALLED_CHROMIUM) ? { executablePath: PREINSTALLED_CHROMIUM } : {}),
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    // Without these two the heap row is unreadable: usage is quantised to
    // 100 KB, and nothing can force a collection — so all two samples measure
    // is whether the collector happened to run between them.
    '--enable-precise-memory-info',
    '--js-flags=--expose-gc',
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(BASE);
await page.waitForSelector('[data-testid="app-root"]', { timeout: 20000 });
await page.waitForFunction(() => Boolean(window.__ml?.projectStore && window.__ml?.engine), null, {
  timeout: 20000,
});
// The engine is only real once its context is running; every measurement below
// is of an engine that has actually built its graph.
await page.evaluate(() => window.__ml.engine.start());

await runScaling(page);
await runFuzz(page);
await runEndurance(page);

// ------------------------------------------------------------- not run here

if (!JSON_ONLY) console.log('\nNot measurable on this host');
record(
  'audio dropout ceiling',
  'BLOCKED',
  '',
  'no audio device; xruns are not observable headless',
);
record(
  'per-device tiers',
  'BLOCKED',
  '',
  'no phone or tablet silicon — a desktop ceiling is not a tier',
);
record('force-quit mid-record', 'BLOCKED', '', 'needs a real OS kill, not a dispatched event');

if (pageErrors.length) fail('uncaught page errors', `${pageErrors.length}: ${pageErrors[0]}`);
else record('uncaught page errors', 0, 'errors', '');

await browser.close();
writeFileSync('stress-out.json', JSON.stringify(results, null, 2));

if (JSON_ONLY) {
  console.log(JSON.stringify(results, null, 2));
} else if (SECTION_SCOPE.length > 0) {
  console.log('\nScoped run: no PROGRESS row, which needs every section.');
} else {
  const v = (n) => results.find((r) => r.name === n)?.value;
  const num = (n, digits = 1) => {
    const x = v(n);
    return typeof x === 'number' ? x.toFixed(Math.abs(x) >= 100 ? 0 : digits) : String(x);
  };
  console.log('\nPROGRESS.md row:\n');
  console.log(
    `| ${process.env.STRESS_COMMIT ?? 'local'} | ` +
      `${num('frame p90 at 100 tracks')} / ${num('frame p90 at 200 tracks')} ms | ` +
      `${num('tracks at the frame ceiling')} tk / ${num('inserts at that point')} fx | ` +
      `${num('transport ops')} ops, quiet in ${num('time to quiescence')} ms | ` +
      `${num('note events')} notes, ${v('stuck notes')} stuck | ` +
      `${num('frame median, after 15 s')} ms, drift ${num('frame-time drift')} | ` +
      `${num('retained heap growth', 0)} KB | ` +
      `${num('worst tab switch to paint')} ms | ` +
      `${num('undo depth honoured')}/${num('redo steps honoured')} ${v('undo integrity')} | ` +
      `${v('survives backgrounding')} |`,
  );
}
