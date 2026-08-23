/**
 * The panel harness's build.
 *
 * Separate from MotionLab's because they are separate products and the root
 * config's `src/` aliases have no meaning here — `motionwave/core/` may not
 * depend on `src/`, and neither may anything that ships beside it.
 *
 * The two headers are what make `SharedArrayBuffer` exist at all. Without
 * cross-origin isolation the constructor is not defined, the worklet has no way
 * to publish that does not allocate per block, and U21 would be measuring a
 * face paced against `postMessage` — which is a different claim about a
 * different architecture.
 */
import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  root: here,
  publicDir: resolve(here, 'public'),
  build: { outDir: resolve(here, 'dist'), emptyOutDir: true },
  server: { headers: isolation },
  preview: { headers: isolation, port: 4183, strictPort: true },
});
