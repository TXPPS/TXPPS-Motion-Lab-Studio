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
  it('has no file over about four hundred lines', () => {
    // A file past it is describing more than one thing and gets split at the
    // seam that is already there (CLAUDE.md, ADR-0003).
    const long = FILES.map((path) => ({
      file: relative(path),
      lines: readFileSync(path, 'utf8').split('\n').length,
    })).filter((entry) => entry.lines > 400);
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
    const allowed = new Set(['vitest', 'node:fs', 'node:url', 'node:path', 'vitest/config']);
    for (const path of FILES) {
      if (!path.endsWith('.ts')) continue;
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/from\s+'([^'.][^']*)'/g)) {
        expect(allowed.has(match[1]), `${relative(path)} imports ${match[1]}`).toBe(true);
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
    const withLaw = FILES.filter((path) => {
      if (!path.endsWith('.ts')) return false;
      return /Math\.log\(|Math\.pow\(max/.test(readFileSync(path, 'utf8'));
    }).map(relative);
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
