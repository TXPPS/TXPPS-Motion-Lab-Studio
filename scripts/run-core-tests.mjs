/**
 * Run the C++ core's tests where there is no C++ toolchain.
 *
 *   npm run test:core            # every suite
 *   npm run test:core program_eq # only suites whose name contains this
 *
 * `CLAUDE.md` documents the core's tests as a CMake build against the host
 * compiler, and that is still the canonical way to run them. It does not run on
 * this machine: there is no Visual Studio, no Ninja and no `g++`, so `cmake`
 * cannot configure and the suite could not be run here at all. The consequence
 * was worse than inconvenience — a change to `motionwave/core/` could be made,
 * reviewed and committed on Windows without one of its tests ever executing.
 *
 * The core has no dependencies (ADR-0003), and each test is a `main()` over a
 * header-only harness. That is exactly what lets this work: emsdk ships clang
 * and a sysroot, so every suite compiles to WebAssembly and runs under Node.
 * It is the same compiler and the same source the shipping browser target is
 * built from, so a pass here is a real pass — it is not the host target, which
 * is why it supplements the CMake build rather than replacing it.
 *
 * **`-Wdouble-promotion` is the one flag from `mw_warnings` that is not
 * applied.** `oversampler.h` normalises its window in double and stores each
 * tap through a `static_cast<float>` — a deliberate quantisation, because the
 * tap has to be the same number whichever target built it, and the bit-exact
 * WASM boundary depends on it. GCC does not warn there and clang does. Dropping
 * the flag rather than "fixing" the line is the right way round: the line is
 * correct and load-bearing, and the first attempt at this rewrote it, misread
 * `double taps_[]` as a float array, and would have changed what the core
 * computes to silence a warning about a cast that is the point.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CORE = join(ROOT, 'motionwave', 'core');
const EMSDK = process.env.EMSDK_DIR ?? 'C:/Users/txpps/emsdk';
const OUT = join(ROOT, 'node_modules', '.cache', 'mw-core-tests');

/**
 * `em++.py` through emsdk's own interpreter, rather than `em++.bat`.
 *
 * Node refuses to spawn a `.bat` from `execFile` — it returns `EINVAL` — and
 * the alternative, `shell: true`, would put every argument through `cmd.exe`
 * quoting. This repository lives under a path with a space in it, so that is a
 * quoting bug waiting to happen for no benefit. The `.py` is what the `.bat`
 * runs anyway, and the interpreter to run it with is named in `.emscripten`.
 */
const emxx = join(EMSDK, 'upstream', 'emscripten', 'em++.py');
const python =
  [
    join(EMSDK, 'python', '3.13.3_64bit', 'python.exe'),
    ...(existsSync(join(EMSDK, 'python'))
      ? readdirSync(join(EMSDK, 'python')).map((v) => join(EMSDK, 'python', v, 'python.exe'))
      : []),
  ].find(existsSync) ?? 'python3';
if (!existsSync(emxx)) {
  console.error(`test:core: no emscripten at ${EMSDK}. Set EMSDK_DIR, or use the CMake build.`);
  process.exit(1);
}

/** `mw_warnings` from motionwave/CMakeLists.txt, less the flag documented above. */
const WARNINGS = [
  '-Wall',
  '-Wextra',
  '-Wpedantic',
  '-Werror',
  '-Wshadow',
  '-Wconversion',
  '-Wsign-conversion',
  '-Wold-style-cast',
];

const filter = process.argv[2] ?? '';
const suites = readdirSync(join(CORE, 'test'))
  .filter((f) => f.endsWith('_tests.cpp'))
  .filter((f) => f.includes(filter))
  .sort();

if (suites.length === 0) {
  console.error(`test:core: no suite matches "${filter}"`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let failed = 0;
let ran = 0;
for (const suite of suites) {
  const name = basename(suite, '.cpp');
  const js = join(OUT, `${name}.js`);
  try {
    execFileSync(
      python,
      [
        emxx,
        '-std=c++17',
        // -O0, which is what `CLAUDE.md`'s documented `-DCMAKE_BUILD_TYPE=Debug`
        // gives the canonical build, and it is load-bearing rather than lazy.
        // At -O1 clang elides the `new`/`delete` pair in `param_tests`' own
        // mutation case — C++14 permits exactly that — so `rt_guard` saw no
        // allocation and the case correctly reported that the guard was proving
        // nothing. The guard was fine; the optimiser had removed the thing it
        // was watching for. `-ffast-math` is absent for the reason the CMake
        // build gives: a null test holding to -120 dBFS must not run against
        // arithmetic the compiler was told it could reassociate.
        '-O0',
        '-I',
        CORE,
        ...WARNINGS,
        '-sEXIT_RUNTIME=1',
        '-sALLOW_MEMORY_GROWTH=1',
        // Emscripten's default stack is 64 KB and several suites put a whole
        // analysis window on it — `program_eq_tests` alone uses a quarter of a
        // million samples. Eleven suites died with "memory access out of
        // bounds" on the default, which reads like a product fault and is the
        // sandbox's stack: a host build has megabytes here without being asked.
        // Stated out loud rather than left as a difference someone rediscovers.
        '-sSTACK_SIZE=16MB',
        '-sINITIAL_MEMORY=256MB',
        '-o',
        js,
        join(CORE, 'test', suite),
      ],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (e) {
    failed += 1;
    console.error(`\n=== ${name}: DID NOT COMPILE ===`);
    console.error(
      String(e.stderr ?? e.stdout ?? e.message)
        .trim()
        .split('\n')
        .slice(-12)
        .join('\n'),
    );
    continue;
  }
  ran += 1;
  try {
    const out = execFileSync(process.execPath, [js], { encoding: 'utf8' });
    const summary = out.trim().split('\n').at(-1);
    console.log(`  ok   ${name.padEnd(34)} ${summary}`);
  } catch (e) {
    failed += 1;
    console.error(`\n=== ${name}: FAILED ===`);
    console.error(
      String(e.stdout ?? '')
        .trim()
        .split('\n')
        .slice(-25)
        .join('\n'),
    );
    console.error(
      String(e.stderr ?? '')
        .trim()
        .split('\n')
        .slice(-5)
        .join('\n'),
    );
  }
}

console.log(
  `\ntest:core: ${ran} suite(s) compiled and ran, ${failed} failure(s)` +
    (filter ? ` (filter "${filter}")` : ''),
);
process.exit(failed === 0 ? 0 : 1);
