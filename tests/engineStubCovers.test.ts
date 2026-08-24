/**
 * The engine stub has to answer everything the UI asks the engine.
 *
 * `engineStub` is a hand-written stand-in, and a hand-written parallel of a
 * real interface drifts. It has now drifted three times in one session — a
 * component called `isInputOpen`, then `latency`, then `restart`, and each time
 * the failure arrived as a React render crash inside an unrelated test file,
 * naming a symptom rather than the cause.
 *
 * So the parallel is checked rather than trusted. Anything the UI calls as
 * `engine.something(...)` must exist on the stub.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { engineStub } from './setup.tsx';

const ROOT = join(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every `engine.<name>(` and `engine.<name>` read across the UI layers. */
function engineMembersUsedBy(dirs: string[]): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const dir of dirs) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bengine\.([A-Za-z_$][\w$]*)/g)) {
        const name = m[1];
        const at = used.get(name) ?? [];
        at.push(relative(ROOT, file).replace(/\\/g, '/'));
        used.set(name, at);
      }
    }
  }
  return used;
}

describe('the engine stub covers what the UI calls', () => {
  const used = engineMembersUsedBy(['src/components', 'src/pages', 'src/app', 'src/hooks']);

  it('found engine calls to check — otherwise this guard is checking nothing', () => {
    expect(used.size).toBeGreaterThan(5);
  });

  it.each([...used.keys()].sort())('stubs engine.%s', (name) => {
    expect(
      name in (engineStub as unknown as Record<string, unknown>),
      `${name} is called from ${used.get(name)?.join(', ')} but the stub has no such member — ` +
        'component tests will crash inside React with a message that names neither.',
    ).toBe(true);
  });
});
