/**
 * Compiling C++ where there is no C++ toolchain.
 *
 * `CLAUDE.md` documents the core's tests as a CMake build against the host
 * compiler, and that is still canonical. It does not run on this machine —
 * there is no Visual Studio, no Ninja and no `g++`. What there *is* is emsdk,
 * which ships clang and a sysroot, so every dependency-free translation unit in
 * `motionwave/core/` compiles to WebAssembly and runs under Node. It is the
 * same compiler and the same source the shipping browser target is built from,
 * so a pass is a real pass; it is not the host target, which is why it
 * supplements the CMake build rather than replacing it.
 *
 * `run-core-tests.mjs` worked this out first and 42 suites have been running
 * here ever since. `generate-curve-golden.mjs` did not, and reported SKIPPED —
 * "no C++ compiler on this host" — on a host that had been compiling forty-two
 * suites with one all along. A check that says it cannot run is a check nobody
 * looks at again, and this one had been saying it for as long as anyone had
 * looked. So the compiler lives here, once, and both use it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Where emsdk is, unless `EMSDK_DIR` says otherwise. */
export const EMSDK = process.env.EMSDK_DIR ?? 'C:/Users/txpps/emsdk';

/**
 * `em++.py` through emsdk's own interpreter, rather than `em++.bat`.
 *
 * Node refuses to spawn a `.bat` from `execFile` — it returns `EINVAL` — and
 * the alternative, `shell: true`, would put every argument through `cmd.exe`
 * quoting. This repository lives under a path with a space in it, so that is a
 * quoting bug waiting to happen for no benefit. The `.py` is what the `.bat`
 * runs anyway.
 *
 * The interpreter search ends at a bare `python3` rather than at nothing:
 * emsdk does not always bundle one, and a host that has emscripten without it
 * usually has a system Python that will do.
 */
export function emsdkToolchain() {
  const emxx = join(EMSDK, 'upstream', 'emscripten', 'em++.py');
  if (!existsSync(emxx)) return null;
  const pythonDir = join(EMSDK, 'python');
  const python =
    (existsSync(pythonDir)
      ? readdirSync(pythonDir)
          .map((v) => join(pythonDir, v, 'python.exe'))
          .find(existsSync)
      : undefined) ?? 'python3';
  return { emxx, python };
}

/**
 * Compile one self-contained `main()` and return everything it printed.
 *
 * `-O0` for the same reason `run-core-tests.mjs` gives: the canonical build is
 * `-DCMAKE_BUILD_TYPE=Debug`, and at higher levels clang is permitted to elide
 * the allocation `rt_guard` exists to watch for. `-ffast-math` is absent for
 * the reason the CMake build gives — reassociation would make a null test
 * holding to −120 dBFS a different measurement.
 *
 * @returns the program's stdout, or null when this host has no emsdk
 */
export function compileAndRun(sourcePath, includeDir, outJs) {
  const tools = emsdkToolchain();
  if (!tools) return null;
  execFileSync(
    tools.python,
    [
      tools.emxx,
      '-std=c++17',
      '-O0',
      '-I',
      includeDir,
      sourcePath,
      '-o',
      outJs,
      '-sENVIRONMENT=node',
      '-sSINGLE_FILE=1',
      // A generator can print megabytes of table; the default 16MB heap is not
      // the constraint, the default *stack* is, and a golden emitter builds its
      // output before writing any of it.
      '-sALLOW_MEMORY_GROWTH=1',
      '-sSTACK_SIZE=4MB',
    ],
    { stdio: 'pipe' },
  );
  return execFileSync(process.execPath, [outJs], { encoding: 'utf8', maxBuffer: 1 << 28 });
}
