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
const core = join(root, 'motionwave/wasm/dist/motionwave.worklet.js');
const processor = join(root, 'motionwave/ui/worklet/unit_worklet.js');

const targets = [
  join(root, 'public/worklets'),
  join(root, 'motionwave/ui/dev/public'),
];

if (!existsSync(core)) {
  console.error(`motionwave: no core at ${core}`);
  console.error('Run `npm run build:wasm` first — it needs emsdk, see CLAUDE.md.');
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
  `motionwave: core (${Math.round(coreBytes / 1024)} KB) and processor synced to ${targets.length} target(s)`,
);
