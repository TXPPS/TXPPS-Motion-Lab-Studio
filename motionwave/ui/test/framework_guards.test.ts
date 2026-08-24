import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(directory = ROOT, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const path = `${directory}${entry}`;
    if (statSync(path).isDirectory()) {
      sourceFiles(`${path}/`, found);
      continue;
    }
    if (entry.endsWith('.ts') || entry.endsWith('.css')) found.push(path);
  }
  return found;
}

const FILES = sourceFiles();
const relative = (path: string): string => path.slice(ROOT.length);

describe('the house rules hold for this tree as well', () => {
  it('has no hand-written file over about four hundred lines', () => {
    // A file past it is describing more than one thing and gets split at the
    // seam that is already there (CLAUDE.md, ADR-0003).
    //
    // **Generated files are exempt, and only generated files.** The rule is
    // about a *reader* holding one idea at a time, and a `.gen.ts` has no
    // reader — it has a manifest, which is the thing to split if it ever gets
    // long. The Console EQ's is the first past the line, at twenty parameters
    // across two lineages, and splitting it would mean splitting a device that
    // ships as one. The suffix is checked rather than a list of paths so that
    // exempting a file is something the generator does and not something a
    // person can do by editing this test.
    const long = FILES.filter((path) => !path.endsWith('.gen.ts'))
      .map((path) => ({
        file: relative(path),
        lines: readFileSync(path, 'utf8').split('\n').length,
      }))
      .filter((entry) => entry.lines > 400);
    expect(long).toEqual([]);
  });

  it('never reaches into MotionLab Studio or into the C++ core', () => {
    // The two products share a repository and nothing else. `motionwave/core/`
    // is the other engineer's tree and has no TypeScript in it at all; a UI
    // module that imported from either would break the one boundary ADR-0003
    // calls load-bearing.
    for (const path of FILES) {
      if (!path.endsWith('.ts')) continue;
      const source = readFileSync(path, 'utf8');
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
      for (const specifier of imports) {
        expect(specifier, `${relative(path)} imports ${specifier}`).not.toMatch(/(^|\/)src\//);
        expect(specifier, `${relative(path)} imports ${specifier}`).not.toMatch(/core\//);
      }
    }
  });

  it('takes no dependency outside the standard library and the test runner', () => {
    // `node:path` joins the list for the WASM boundary test, which has to
    // locate the native golden header on disk. The rule this guard exists to
    // enforce is "no third-party dependency" — a standard-library module is
    // exactly what it is meant to allow, and widening it here is not the same
    // as weakening it.
    //
    // `vite` joins it for build configuration only, and only there: the panel
    // harness has to be built and served before Chromium can measure U21 and
    // U22 against it, and a build config that cannot import its build tool is
    // not a config. What the rule protects is the code that *ships* — the
    // harness, the units, the faces — so the allowance is scoped to files whose
    // name says they configure a build rather than run in one.
    const allowed = new Set(['vitest', 'node:fs', 'node:url', 'node:path', 'vitest/config']);
    // `@playwright/test` is the browser suite's runner, and the rule already
    // allows a test runner — vitest cannot drive Chromium, so the cells that
    // need one are written against the runner that can. Scoped to the browser
    // suite's own files so it never becomes an import shipping code can use.
    const buildConfig = /(^|\/)(vite|vitest|playwright)\.config\.ts$/;
    const browserSuite = /(^|\/)e2e\/[^/]+\.spec\.ts$/;
    for (const path of FILES) {
      if (!path.endsWith('.ts')) continue;
      const source = readFileSync(path, 'utf8');
      const permitted =
        buildConfig.test(path) || browserSuite.test(path)
          ? new Set([...allowed, 'vite', '@playwright/test'])
          : allowed;
      for (const match of source.matchAll(/from\s+'([^'.][^']*)'/g)) {
        expect(permitted.has(match[1]), `${relative(path)} imports ${match[1]}`).toBe(true);
      }
    }
  });
});

describe('one mechanism, not several', () => {
  it('exports each function and class from exactly one module', () => {
    // ADR-0004's promise is that automation, presets, modulation and the
    // generic face all follow from one declaration. That is only true while
    // there is one of each: a second `evaluate`, a second `denormalise` or a
    // second blend would each be a place a unit could get a different answer.
    const owners = new Map<string, string[]>();
    for (const path of FILES) {
      if (!path.endsWith('.ts') || relative(path).startsWith('test/')) continue;
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(
        /^export\s+(?:abstract\s+)?(?:function|class)\s+(\w+)/gm,
      )) {
        const list = owners.get(match[1]) ?? [];
        list.push(relative(path));
        owners.set(match[1], list);
      }
    }
    const duplicated = [...owners.entries()].filter(([, files]) => files.length > 1);
    expect(duplicated).toEqual([]);
  });

  it('keeps the parameter law in one file, so a face and a processor cannot disagree', () => {
    // The specific failure ADR-0004 names: a display that computes a real value
    // one way and a processor that computes it another. The law is arithmetic,
    // and arithmetic is easy to write out again by accident.
    //
    // The test detects a *logarithm*, which is a proxy for the law rather than
    // the law itself, so a file with an unrelated logarithm in it has to be
    // named and given a reason. Named rather than pattern-matched away for the
    // same reason `MW_SCOPE_ALSO` takes a reason it never inspects: having to
    // write one is the mechanism. A rule that quietly stopped covering new
    // files would be a rule nobody noticed had lapsed.
    const ELSEWHERE = new Map([
      [
        'render/controls/ballistics.ts',
        'a VU movement, solved from ANSI C16.5-1942 — no parameter is involved',
      ],
    ]);
    const withLaw = FILES.filter((path) => {
      if (!path.endsWith('.ts')) return false;
      return /Math\.log\(|Math\.pow\(max/.test(readFileSync(path, 'utf8'));
    })
      .map(relative)
      .filter((path) => !ELSEWHERE.has(path));
    expect(withLaw).toEqual(['param/units.ts']);
  });
});

describe('the single entry point actually loads', () => {
  it('resolves every re-export at runtime, not just at type-check time', async () => {
    // A barrel is where a circular import shows up, and it shows up as a
    // binding that is `undefined` at load rather than as a compile error — the
    // one failure mode `tsc` cannot see.
    const framework = await import('../index');
    for (const name of [
      'defineParam',
      'ParamSet',
      'AutomationLane',
      'AutomationPlayer',
      'AutomationRecorder',
      'ModulationMatrix',
      'capturePreset',
      'PresetMigrations',
      'MeterBus',
      'MeterSnapshot',
      'declareLatency',
      'WetDryMixer',
      'verifyUnit',
      'probeHost',
      'applyTheme',
    ]) {
      expect(framework[name as keyof typeof framework], name).toBeDefined();
    }
  });
});
