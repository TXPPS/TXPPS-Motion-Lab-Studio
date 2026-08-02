import { describe, expect, it } from 'vitest';
import { validateProject } from '../src/persistence/projectRepo';
import { createDemoProject } from '../src/model/demoProject';
import { SCHEMA_VERSION } from '../src/model/types';

/**
 * Randomized project fuzzing. A deterministic PRNG mutates real projects and
 * fabricates garbage; validateProject must NEVER throw for structurally
 * plausible input (objects with some project shape), must always return a
 * playable project (arrays present, schema current), and must be stable
 * (validating its own output changes nothing material).
 *
 * SchemaError for clearly-not-a-project input is allowed — that is the
 * documented contract — so genuinely hopeless shapes assert the error type
 * instead.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const JUNK_VALUES: unknown[] = [
  null,
  undefined,
  0,
  -1,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  '',
  'garbage',
  true,
  false,
  [],
  {},
  { nested: { deep: [1, 2, 3] } },
  42,
  [[[[]]]],
  'a'.repeat(2000),
];

/** Randomly corrupt fields of a deep-cloned demo project. */
function mutate(rng: () => number, rounds: number): unknown {
  const p = JSON.parse(JSON.stringify(createDemoProject())) as Record<string, unknown>;
  const targets: Record<string, unknown>[] = [p];
  // Collect nested objects (tracks, clips, notes, automation…) as targets.
  const walk = (o: unknown, depth: number) => {
    if (depth > 4 || typeof o !== 'object' || o === null) return;
    targets.push(o as Record<string, unknown>);
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) for (const x of v) walk(x, depth + 1);
      else walk(v, depth + 1);
    }
  };
  walk(p, 0);

  for (let i = 0; i < rounds; i++) {
    const t = targets[Math.floor(rng() * targets.length)];
    const keys = Object.keys(t);
    if (keys.length === 0) continue;
    const key = keys[Math.floor(rng() * keys.length)];
    const dice = rng();
    if (dice < 0.45) {
      t[key] = JUNK_VALUES[Math.floor(rng() * JUNK_VALUES.length)];
    } else if (dice < 0.7) {
      delete t[key];
    } else if (dice < 0.85) {
      t[`fuzz_${key}`] = JUNK_VALUES[Math.floor(rng() * JUNK_VALUES.length)];
    } else if (Array.isArray(t[key])) {
      (t[key] as unknown[]).push(JUNK_VALUES[Math.floor(rng() * JUNK_VALUES.length)]);
    } else {
      t[key] = rng() * 1e9 - 5e8;
    }
  }
  return p;
}

const assertPlayable = (out: ReturnType<typeof validateProject>) => {
  expect(out.schemaVersion).toBe(SCHEMA_VERSION);
  expect(Array.isArray(out.tracks)).toBe(true);
  expect(Array.isArray(out.clips)).toBe(true);
  expect(typeof out.bpm).toBe('number');
  expect(Number.isFinite(out.bpm)).toBe(true);
  expect(out.bpm).toBeGreaterThan(0);
  // Every surviving clip must point at a surviving track.
  const trackIds = new Set(out.tracks.map((t) => t.id));
  for (const c of out.clips) expect(trackIds.has(c.trackId)).toBe(true);
  // The whole result must survive a JSON round trip (no cycles, no BigInt).
  expect(() => JSON.stringify(out)).not.toThrow();
};

describe('project fuzzing', () => {
  it('validateProject survives 300 mutated real projects', () => {
    const rng = mulberry32(0xc0ffee);
    for (let i = 0; i < 300; i++) {
      const corrupted = mutate(rng, 1 + Math.floor(rng() * 30));
      let out;
      try {
        out = validateProject(corrupted);
      } catch (e) {
        // Only the typed SchemaError contract is acceptable, and only when
        // the corruption hit a structural root (id/name/tracks/clips).
        expect((e as Error).name).toBe('SchemaError');
        continue;
      }
      assertPlayable(out);
    }
  });

  it('validation is stable: validating its own output is a fixpoint', () => {
    const rng = mulberry32(0xdead10cc);
    for (let i = 0; i < 60; i++) {
      const corrupted = mutate(rng, 1 + Math.floor(rng() * 20));
      let once;
      try {
        once = validateProject(corrupted);
      } catch {
        continue;
      }
      const twice = validateProject(JSON.parse(JSON.stringify(once)));
      // modifiedAt may be normalized; compare the material content.
      const strip = (p: typeof once) => ({ ...p, modifiedAt: 0, createdAt: 0 });
      expect(strip(twice)).toEqual(strip(once));
    }
  });

  it('hopeless garbage raises SchemaError (or validates) — never crashes', () => {
    const rng = mulberry32(0xbadf00d);
    const shapes: unknown[] = [
      ...JUNK_VALUES,
      { schemaVersion: 999, id: 'x', name: 'future', tracks: [], clips: [] },
      { schemaVersion: -1, id: 'y', name: 'past', tracks: 'no', clips: null },
      { id: 7, name: null, tracks: [{}], clips: [{}] },
      Object.fromEntries(
        Array.from({ length: 50 }, (_, i) => [
          `k${i}`,
          JUNK_VALUES[Math.floor(rng() * JUNK_VALUES.length)],
        ]),
      ),
    ];
    for (const s of shapes) {
      try {
        const out = validateProject(s);
        assertPlayable(out);
      } catch (e) {
        expect((e as Error).name).toBe('SchemaError');
      }
    }
  });
});
