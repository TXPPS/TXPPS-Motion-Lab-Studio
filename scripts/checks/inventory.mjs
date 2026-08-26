/**
 * What this repository *declares* it checks.
 *
 * Read off the files rather than listed by hand, because a hand-written list of
 * the checks is itself a check that nobody runs — which is the whole defect
 * this sweep exists for. Three sources: `package.json`'s scripts, the
 * TypeScript projects on disk, and the spec files under each suite's root.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..', '..');

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const posix = (p) => relative(ROOT, p).split('\\').join('/');

/** Every npm script, by name. */
export function npmScripts() {
  return new Map(Object.entries(JSON.parse(read('package.json')).scripts ?? {}));
}

/**
 * Every TypeScript project in the tree, and what each one references.
 *
 * `tsconfig.e2e.json` was here, correct, and invoked by nothing for three
 * directives — so the question this answers is not "does the project compile"
 * but "does anything ever ask it to". References are followed because
 * `tsc -b` reaches a project through the root's reference list without naming
 * it, and a project reached that way is reached.
 */
export function tsProjects() {
  const out = new Map();
  const scan = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        scan(path);
        continue;
      }
      if (!/^tsconfig(\..+)?\.json$/.test(entry)) continue;
      // Comments are legal in a tsconfig and `JSON.parse` will not have them,
      // so the references come off a regex rather than off a parse. Only the
      // reference list is needed, and it is a flat list of paths.
      const src = readFileSync(path, 'utf8');
      const refs = [...src.matchAll(/"path"\s*:\s*"([^"]+)"/g)].map((m) =>
        posix(resolve(dir, m[1])),
      );
      out.set(posix(path), { references: refs });
    }
  };
  scan(ROOT);
  return out;
}

/**
 * Each suite, the directory its specs live in, and the config that owns it.
 *
 * Declared here rather than parsed out of the configs on purpose: this is the
 * claim ("the browser suite is `e2e/`, and `playwright.config.ts` is what says
 * so"), and `--run` proves it by asking the runner to enumerate what it will
 * actually execute. A claim checked against the thing it describes is a claim;
 * one read out of that thing is a restatement.
 */
export const SUITES = [
  {
    id: 'test',
    script: 'test',
    root: 'tests',
    pattern: /\.test\.tsx?$/,
    config: 'vite.config.ts',
    declares: /\b(?:test|it)\s*\(/,
  },
  {
    id: 'e2e',
    script: 'e2e',
    root: 'e2e',
    pattern: /\.spec\.ts$/,
    config: 'playwright.config.ts',
    declares: /\b(?:test|test\.\w+)\s*\(/,
  },
  {
    id: 'test:mw',
    script: 'test:mw',
    root: 'motionwave/ui/test',
    pattern: /\.test\.tsx?$/,
    config: 'motionwave/ui/vitest.config.ts',
    declares: /\b(?:test|it)\s*\(/,
  },
  {
    id: 'e2e:mw',
    script: 'e2e:mw',
    root: 'motionwave/ui/e2e',
    pattern: /\.spec\.ts$/,
    config: 'motionwave/ui/playwright.config.ts',
    declares: /\b(?:test|test\.\w+)\s*\(/,
  },
  {
    id: 'test:core',
    script: 'test:core',
    root: 'motionwave/core/test',
    pattern: /_tests\.cpp$/,
    config: 'scripts/run-core-tests.mjs',
    declares: /\bMW_TEST\s*\(/,
  },
];

/** Every spec file under a suite root, with whether it declares any test. */
export function specFiles(suite) {
  const dir = join(ROOT, suite.root);
  const out = [];
  const scan = (d) => {
    for (const entry of readdirSync(d)) {
      const path = join(d, entry);
      if (statSync(path).isDirectory()) {
        scan(path);
        continue;
      }
      if (!suite.pattern.test(entry)) continue;
      out.push({ file: posix(path), declares: suite.declares.test(readFileSync(path, 'utf8')) });
    }
  };
  scan(dir);
  return out;
}

/**
 * Files under a suite root that no pattern claims.
 *
 * A helper module (`e2e/perfScale.ts`, `tests/setup.ts`) is legitimate and
 * common; a spec named `foo.spec.tsx` where the runner wants `.spec.ts` is a
 * dead file that looks alive in a directory listing. Reported rather than
 * failed, because only a human can tell the two apart.
 */
export function unclaimedInRoot(suite) {
  const dir = join(ROOT, suite.root);
  const out = [];
  const scan = (d) => {
    for (const entry of readdirSync(d)) {
      const path = join(d, entry);
      if (statSync(path).isDirectory()) {
        scan(path);
        continue;
      }
      if (suite.pattern.test(entry)) continue;
      if (/\.(spec|test)\./.test(entry)) out.push(posix(path));
    }
  };
  scan(dir);
  return out;
}
