// Copies the Motion Wave runtime into the places that serve it.
//
// There are two consumers and there must be one source. `motionwave/wasm/dist/`
// is where `build:wasm` puts the Emscripten core; `motionwave/ui/worklet/` holds
// the processor that drives it. Both have to be reachable as static assets by
// the app (`public/worklets/`) and by the dev harness
// (`motionwave/ui/dev/public/`), and the two copies must be the same file —
// a harness proving a worklet the app does not run is the shape of problem
// ADR-0007 exists to close.
//
// Copied rather than symlinked because Vite's `public/` handling, the service
// worker's precache and Cloudflare's asset upload all treat a symlink
// differently from a file, and the difference shows up only in the deployed
// build.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();
/*
 * A freshly built core if there is one, otherwise the tracked copy.
 *
 * `motionwave/wasm/dist/` only exists on a machine with Emscripten. The app's
 * production build runs everywhere — Cloudflare's builder, a contributor's
 * laptop, a CI runner that only cares about the web app — and requiring a C++
 * toolchain to build a TypeScript app would mean the deployed site could only
 * ever be built from a machine set up for the native work.
 *
 * `prebuilt/` is tracked in git for exactly that reason, and it is checked
 * rather than trusted: `npm run wasm:check` rebuilds and compares byte for
 * byte, and CI has the toolchain and runs it, so a stale copy fails there
 * instead of shipping.
 */
const freshCore = join(root, 'motionwave/wasm/dist/motionwave.worklet.js');
const prebuiltCore = join(root, 'motionwave/wasm/prebuilt/motionwave.worklet.js');
const core = existsSync(freshCore) ? freshCore : prebuiltCore;
const processor = join(root, 'motionwave/ui/worklet/unit_worklet.js');

const targets = [
  join(root, 'public/worklets'),
  join(root, 'motionwave/ui/dev/public'),
];

if (!existsSync(core)) {
  console.error('motionwave: no core to ship.');
  console.error(`  looked for a fresh build at ${freshCore}`);
  console.error(`  and the tracked copy at   ${prebuiltCore}`);
  console.error('Run `npm run build:wasm` (needs emsdk, see CLAUDE.md), or restore the');
  console.error('tracked copy — the app cannot ship without one of them.');
  process.exit(1);
}
if (!existsSync(processor)) {
  console.error(`motionwave: no processor at ${processor}`);
  process.exit(1);
}

/*
 * A size floor rather than only an existence check.
 *
 * An Emscripten SINGLE_FILE build embeds the wasm as base64, so the real thing
 * is hundreds of kilobytes. A failed or partial build can still leave a small
 * valid-looking file behind, and copying that into `public/` produces a bundle
 * that ships, loads, and has no engine in it — which is the exact false green
 * this directive was written out of.
 */
const coreBytes = statSync(core).size;
if (coreBytes < 100_000) {
  console.error(`motionwave: core at ${core} is only ${coreBytes} bytes — that is not a build.`);
  process.exit(1);
}

for (const target of targets) {
  mkdirSync(target, { recursive: true });
  for (const file of [core, processor]) {
    const to = join(target, file.split('/').pop());
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(file, to);
  }
}

console.log(
  `motionwave: core (${Math.round(coreBytes / 1024)} KB, ${
    core === freshCore ? 'freshly built' : 'tracked prebuilt'
  }) and processor synced to ${targets.length} target(s)`,
);
