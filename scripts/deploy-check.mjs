/**
 * Is what the worker serves the bundle this tree builds?
 *
 *   node scripts/deploy-check.mjs             # poll, then compare bytes
 *   node scripts/deploy-check.mjs --selftest  # prove it can say no
 *
 * Two things this exists to stop, and the first one has already happened.
 *
 * **The edge cache answers before the worker does.** Thirty-three minutes of
 * polling `/` returned the previous bundle name with `CF-Cache-Status: HIT` on
 * every response, while one request carrying a buster returned the new one. How
 * long that deploy actually took is not knowable from a reading taken through a
 * cache; what is known is that the edge was answering. The failure was safe in
 * that direction — a stale read says "not deployed" — but the same cache holds
 * the *new* name for a while after a rollback, and a poll that sees the name it
 * wants and stops is the direction somebody believes. So every request carries a
 * buster and `Cache-Control: no-cache`, and the header is reported rather than
 * assumed.
 *
 * Budget accordingly: a deploy polled this way took forty-four attempts, about
 * fifteen minutes, against the 260-280 s the procedure had assumed.
 *
 * **A name is not a bundle.** `vite.config.ts` compiles the commit and its date
 * in, so a matching name is strong evidence and not proof: two builds of two
 * trees at one commit produce one name. The bundle is fetched and compared byte
 * for byte against `dist/`, which is what every deploy in this project's
 * history has actually been verified by. The name is only how this knows when
 * to stop waiting.
 *
 * `// @clone: working-tree` — it reads `dist/` and the network, and asks git
 * nothing at all.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL_BASE = process.env.DEPLOY_URL ?? 'https://txpps-motionlab-studio.roan-crest.workers.dev';
const SELFTEST = process.argv.includes('--selftest');
const TRIES = Number(process.env.DEPLOY_TRIES ?? 60);
const EVERY_MS = Number(process.env.DEPLOY_EVERY_MS ?? 20_000);

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** The entry bundle this tree built, by name. */
function localBundle() {
  const dir = 'dist/assets';
  const names = readdirSync(dir).filter((n) => /^index-[A-Za-z0-9_-]+\.js$/.test(n));
  // Two files match the pattern: the app entry and a small chunk that shares
  // the prefix. The entry is the large one, and "large" is not a guess here —
  // the other is under 20 kB and this is over 400.
  const withSize = names.map((n) => ({ n, buf: readFileSync(join(dir, n)) }));
  withSize.sort((a, b) => b.buf.length - a.buf.length);
  if (withSize.length === 0) throw new Error('dist/assets has no index-*.js; run `npm run build`');
  return { name: withSize[0].n, buf: withSize[0].buf };
}

async function fetchNoCache(path) {
  const url = `${URL_BASE}${path}${path.includes('?') ? '&' : '?'}cb=${Date.now()}-${process.pid}`;
  const res = await fetch(url, {
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });
  return { res, cache: res.headers.get('cf-cache-status') ?? 'none' };
}

const local = localBundle();
console.log(`local   ${local.name}  ${local.buf.length} bytes  ${sha(local.buf).slice(0, 16)}`);

if (SELFTEST) {
  /*
   * The escape hatch this file would otherwise be.
   *
   * "It fetches and compares" is exactly what somebody would say about a
   * comparison that had stopped comparing, so the tool is asked to say no about
   * a byte it can see is wrong: the live bundle with one byte changed. A run
   * that reports a match here is a broken instrument and exits non-zero.
   */
  const { res } = await fetchNoCache(`/assets/${local.name}`);
  if (!res.ok) {
    console.error(`selftest: the worker does not serve ${local.name} (${res.status})`);
    process.exit(1);
  }
  const live = Buffer.from(await res.arrayBuffer());
  const bent = Buffer.from(live);
  bent[Math.floor(bent.length / 2)] ^= 0xff;
  const same = bent.equals(live);
  console.log(`selftest: one byte flipped, comparison says ${same ? 'MATCH' : 'differ'}`);
  if (same) {
    console.error('selftest: the comparison cannot see a changed byte');
    process.exit(1);
  }
  console.log('selftest: it can say no.');
}

// Guarded rather than exited from: `process.exit(0)` on this host trips a
// libuv assertion when a fetch handle is still closing, and a tool whose clean
// path prints a crash is a tool somebody stops believing.
if (!SELFTEST) {
  let servedName = null;
  let sawCache = 'none';
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    const { res, cache } = await fetchNoCache('/');
    sawCache = cache;
    const html = await res.text();
    servedName = (html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/) ?? [])[1] ?? null;
    const when = new Date().toISOString().slice(11, 19);
    console.log(
      `${when}  attempt ${attempt}: ${servedName ?? 'no bundle in the HTML'}  [cf-cache: ${cache}]`,
    );
    if (servedName === local.name) break;
    if (attempt === TRIES) {
      console.error(
        `\nthe worker is still serving ${servedName} after ${TRIES} attempts. That is a deploy ` +
          'that has not landed, or a build that failed — `git clone --depth 1` this repository and ' +
          'run `npm run build` in it to tell those apart.',
      );
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, EVERY_MS));
  }

  // The name only said when to stop waiting. This is the check.
  const { res } = await fetchNoCache(`/assets/${local.name}`);
  if (!res.ok) {
    console.error(`the worker names ${local.name} and will not serve it (${res.status})`);
    process.exit(1);
  }
  const live = Buffer.from(await res.arrayBuffer());
  // Into dist/, which is gitignored and already excluded from lint. Written to
  // the repository root it was a 450 kB minified bundle that eslint dutifully
  // read: 769 errors, none of them about this project.
  writeFileSync('dist/deploy-live.js', live);
  const ok = live.equals(local.buf);
  console.log(`live    ${local.name}  ${live.length} bytes  ${sha(live).slice(0, 16)}`);
  console.log(
    ok
      ? `\ndeploy-check: identical, byte for byte. Last HTML response was cf-cache ${sawCache}.`
      : '\ndeploy-check: the worker serves a bundle of this NAME that is not these BYTES.',
  );
  if (!ok) process.exitCode = 1;
}
