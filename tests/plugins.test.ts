import { beforeEach, describe, expect, it } from 'vitest';
import { loadProject, saveProject, validateProject } from '../src/persistence/projectRepo';
import { resetDbConnection } from '../src/persistence/db';
import { createDemoProject } from '../src/model/demoProject';
import { SCHEMA_VERSION } from '../src/model/types';
import type { Effect, PluginRef, ProjectData } from '../src/model/types';
import {
  describeEffect,
  effectSpec,
  effectsInGroup,
  isKnownEffect,
  normaliseParams,
} from '../src/model/effects';
import {
  SHELF,
  describeOrigin,
  resolveSource,
  shelfPluginRef,
  urlConsentCopy,
} from '../src/audio/wam/shelf';
import {
  DEFAULT_THRESHOLDS,
  clearParityCache,
  compareParity,
  getParityRecord,
  isPrintRequired,
  parityKey,
  printRequiredPlugins,
  recordParity,
  rmsEnvelope,
} from '../src/audio/wam/parityProbe';

/**
 * A plugin the app has never heard of — the case that matters most, because it
 * is what a project made on someone else's machine looks like here.
 */
const STRANGER: PluginRef = {
  identifier: 'com.example.mysteryBox',
  source: 'https://plugins.example.com/mysteryBox/index.js',
  name: 'Mystery Box',
  vendor: 'Example Audio',
  version: '3.1.4',
  state: { preset: 'Cathedral', tail: [1, 2, 3], nested: { deep: true } },
  paramCache: [
    { id: 'size', label: 'Size', type: 'float', defaultValue: 0.5, minValue: 0, maxValue: 1 },
    {
      id: 'mode',
      label: 'Mode',
      type: 'choice',
      defaultValue: 0,
      minValue: 0,
      maxValue: 2,
      choices: ['Hall', 'Plate', 'Chamber'],
    },
  ],
};

/** Parameters no static spec could ever have declared — the whole point. */
const RUNTIME_PARAMS: Record<string, number> = {
  size: 0.77,
  mode: 2,
  'weird.key/with:punctuation': -12.5,
  band17Gain: 3.25,
  θ: 0.5,
};

function projectWithPlugin(ref: PluginRef = STRANGER): ProjectData {
  const p = createDemoProject();
  const track = p.tracks.find((t) => t.type === 'audio')!;
  track.effects = [
    { id: 'fx-plug', kind: 'wam', bypass: false, params: { ...RUNTIME_PARAMS }, plugin: ref },
  ];
  return p;
}

describe('the plugin shelf', () => {
  it('records a licence and where it was read, for every entry', () => {
    expect(SHELF.length).toBeGreaterThan(0);
    for (const entry of SHELF) {
      expect(entry.licence, `${entry.id} has no licence`).toBeTruthy();
      expect(entry.licenceSource, `${entry.id} does not say where its licence came from`).toMatch(
        /\S/,
      );
      // Everything shipped is served from our own origin, as a directory: a
      // WAM locates its descriptor and worklet relative to `import.meta.url`,
      // so rehosting the entry file alone would break it.
      expect(entry.path.startsWith('/plugins/')).toBe(true);
      expect(entry.path.endsWith('/index.js')).toBe(true);
    }
  });

  it('gives every entry a distinct id and identifier', () => {
    expect(new Set(SHELF.map((e) => e.id)).size).toBe(SHELF.length);
    expect(new Set(SHELF.map((e) => e.identifier)).size).toBe(SHELF.length);
  });

  it('resolves a shelf source to a path on our own origin', () => {
    const ref = shelfPluginRef(SHELF[0]);
    expect(ref.source).toBe(`shelf:${SHELF[0].id}`);
    const resolved = resolveSource(ref.source);
    expect(resolved.url).toBe(SHELF[0].path);
  });

  it('refuses an arbitrary URL, and says why in terms a musician can act on', () => {
    const refusal = resolveSource('https://plugins.example.com/thing/index.js');
    expect(refusal.url).toBeNull();
    expect(refusal.reason).toContain('curated shelf');
    // It names where the plugin was meant to come from: a project that opens
    // with a missing plugin has to be explicable, not merely survivable.
    expect(refusal.reason).toContain('https://plugins.example.com');
  });

  it('refuses a shelf id this build does not ship, without pretending it is a URL', () => {
    const refusal = resolveSource('shelf:not-a-real-plugin');
    expect(refusal.url).toBeNull();
    expect(refusal.reason).toContain('newer build');
  });

  it('states the real exposure before loading code from a typed URL', () => {
    const copy = urlConsentCopy('https://plugins.example.com/a/b/index.js?v=2');
    expect(copy.origin).toBe('https://plugins.example.com');
    const body = copy.body.join(' ');
    // The honest risk is the user's own work, not an abstraction about sandboxes.
    expect(body).toContain('projects and recordings');
    expect(body).toContain('send data over the internet');
    expect(body).toContain('We have not reviewed this one');
    // The URL itself appears in full — a URL nobody can read is a URL nobody
    // can judge.
    expect(body).toContain('https://plugins.example.com/a/b/index.js?v=2');
  });

  it('shows the raw string when a source does not parse as a URL', () => {
    expect(describeOrigin('::::not a url::::')).toBe('::::not a url::::');
  });
});

describe('the plugin effect kind', () => {
  it('is a known effect, so the load path does not filter it away', () => {
    expect(isKnownEffect('wam')).toBe(true);
    expect(isKnownEffect('definitely-not-an-effect')).toBe(false);
  });

  it('has a spec with no parameters, because only the plugin knows them', () => {
    const spec = effectSpec('wam');
    expect(spec).toBeDefined();
    expect(spec!.params).toEqual([]);
  });

  it('is not in the insert picker, because a bare plugin is not addable', () => {
    // A plugin is chosen from the shelf by name. If this ever regresses the
    // picker grows an entry that adds an insert holding nothing.
    expect(effectSpec('wam')!.group).toBe('utility');
    expect(effectsInGroup('utility').some((s) => s.kind === 'wam')).toBe(false);
  });

  it('summarises itself from the plugin reference', () => {
    const withPlugin: Effect = {
      id: 'x',
      kind: 'wam',
      bypass: false,
      params: {},
      plugin: STRANGER,
    };
    expect(describeEffect(withPlugin)).toContain('Example Audio');
    expect(describeEffect({ ...withPlugin, plugin: undefined })).toBe('no plugin');
  });
});

describe('parameters discovered at runtime', () => {
  it('keeps every parameter, including keys no spec declares', () => {
    const out = normaliseParams('wam', RUNTIME_PARAMS);
    expect(out).toEqual(RUNTIME_PARAMS);
    expect(Object.keys(out).length).toBe(Object.keys(RUNTIME_PARAMS).length);
  });

  it('does not clamp them, because there is no range to clamp to', () => {
    // A built-in effect's threshold is clamped into its spec range; a plugin's
    // is not, because the only thing that knows the range is the plugin.
    expect(normaliseParams('wam', { drive: 9999, offset: -9999 })).toEqual({
      drive: 9999,
      offset: -9999,
    });
    expect(normaliseParams('compressor', { threshold: 9999 }).threshold).toBe(0);
  });

  it('drops non-finite and non-numeric values without dropping the rest', () => {
    const out = normaliseParams('wam', {
      good: 1,
      nan: NaN,
      inf: Infinity,
      text: 'nope',
      alsoGood: 2,
    } as Record<string, unknown>);
    expect(out).toEqual({ good: 1, alsoGood: 2 });
  });

  it('survives a load with 40 arbitrary parameters intact', () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < 40; i++) many[`p${i}`] = i / 40;
    const p = projectWithPlugin();
    p.tracks.find((t) => t.effects?.length)!.effects![0].params = many;
    const loaded = validateProject(JSON.parse(JSON.stringify(p)));
    const fx = loaded.tracks.flatMap((t) => t.effects ?? []).find((e) => e.kind === 'wam')!;
    expect(Object.keys(fx.params).length).toBe(40);
    expect(fx.params).toEqual(many);
  });
});

describe('a missing plugin becomes a tombstone, not a deletion', () => {
  beforeEach(async () => {
    await resetDbConnection();
  });

  it('survives validation with its identity, source, state and parameters', () => {
    const loaded = validateProject(JSON.parse(JSON.stringify(projectWithPlugin())));
    const fx = loaded.tracks.flatMap((t) => t.effects ?? []).find((e) => e.kind === 'wam');
    expect(fx, 'the plugin insert was filtered out of the chain').toBeDefined();
    expect(fx!.plugin).toEqual(STRANGER);
    expect(fx!.params).toEqual(RUNTIME_PARAMS);
  });

  it('keeps its place in the chain rather than being compacted out', () => {
    const p = createDemoProject();
    const track = p.tracks.find((t) => t.type === 'audio')!;
    track.effects = [
      { id: 'a', kind: 'eq3', bypass: false, params: {} },
      { id: 'b', kind: 'wam', bypass: true, params: { x: 1 }, plugin: STRANGER },
      { id: 'c', kind: 'delay', bypass: false, params: {} },
    ];
    const loaded = validateProject(JSON.parse(JSON.stringify(p)));
    const chain = loaded.tracks.find((t) => t.id === track.id)!.effects!;
    expect(chain.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    // Bypass is project state and survives with everything else.
    expect(chain[1].bypass).toBe(true);
  });

  it('round-trips through a real save and load with the state blob byte-identical', async () => {
    const p = projectWithPlugin();
    await saveProject(p);
    const back = await loadProject(p.id);
    expect(back).not.toBeNull();
    const fx = back!.tracks.flatMap((t) => t.effects ?? []).find((e) => e.kind === 'wam')!;
    expect(fx.plugin!.state).toEqual(STRANGER.state);
    expect(fx.plugin!.paramCache).toEqual(STRANGER.paramCache);
    expect(fx.params).toEqual(RUNTIME_PARAMS);
    // And a second round trip is a fixpoint — validation must not erode it.
    const twice = validateProject(JSON.parse(JSON.stringify(back)));
    expect(twice.tracks.flatMap((t) => t.effects ?? []).find((e) => e.kind === 'wam')).toEqual(fx);
  });

  it('survives on the master and mastering chains too, not just on a track', () => {
    const p = createDemoProject();
    const fx: Effect = { id: 'm1', kind: 'wam', bypass: false, params: { g: 1 }, plugin: STRANGER };
    p.master = { volume: 0.8, pan: 0, effects: [fx], limiter: true };
    p.mastering = {
      ...(p.mastering ?? { items: [], targetLufs: -14, ceilingDbtp: -1, normalize: false }),
      effects: [{ ...fx, id: 'm2' }],
    } as ProjectData['mastering'];
    const loaded = validateProject(JSON.parse(JSON.stringify(p)));
    expect(loaded.master?.effects?.[0].plugin).toEqual(STRANGER);
    expect(loaded.mastering!.effects?.[0].plugin).toEqual(STRANGER);
  });

  it('keeps the effect but drops a plugin reference with no identity', () => {
    const p = projectWithPlugin();
    // A hand-edited or truncated file: the slot is real, the reference is not.
    (
      p.tracks.find((t) => t.effects?.length)!.effects![0] as unknown as Record<string, unknown>
    ).plugin = { name: 'Half a record' };
    const loaded = validateProject(JSON.parse(JSON.stringify(p)));
    const fx = loaded.tracks.flatMap((t) => t.effects ?? []).find((e) => e.kind === 'wam');
    expect(fx).toBeDefined();
    expect(fx!.plugin).toBeUndefined();
    expect(fx!.params).toEqual(RUNTIME_PARAMS);
  });

  it('still drops an effect of a genuinely unknown kind', () => {
    // The tombstone rule is about plugins, not about anything unrecognised:
    // there is nothing to show and nothing to play for a kind we cannot name.
    const p = createDemoProject();
    const track = p.tracks.find((t) => t.type === 'audio')!;
    (track as unknown as { effects: unknown[] }).effects = [
      { id: 'z', kind: 'quantum-flux-capacitor', bypass: false, params: {} },
    ];
    const loaded = validateProject(JSON.parse(JSON.stringify(p)));
    expect(loaded.tracks.find((t) => t.id === track.id)!.effects).toEqual([]);
  });

  it('keeps an automation lane pointed at a plugin parameter', () => {
    // `paramIdExists` cannot see a plugin's parameters — they come from the
    // plugin. A lane dropped on that basis is automation deleted because a
    // network was slow.
    const p = projectWithPlugin();
    const track = p.tracks.find((t) => t.effects?.length)!;
    track.automation = [
      {
        id: 'lane1',
        paramId: 'fx:fx-plug:size',
        enabled: true,
        points: [
          { id: 'p0', beat: 0, value: 0, curve: 'linear' as const },
          { id: 'p1', beat: 4, value: 1, curve: 'linear' as const },
        ],
      },
    ];
    const loaded = validateProject(JSON.parse(JSON.stringify(p)));
    const lanes = loaded.tracks.find((t) => t.id === track.id)!.automation ?? [];
    expect(lanes.map((l) => l.paramId)).toEqual(['fx:fx-plug:size']);
  });
});

describe('the v6 → v7 migration', () => {
  it('stamps a v6 project as v7 and changes nothing else', () => {
    const p = createDemoProject();
    const raw = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
    raw.schemaVersion = 6;
    const loaded = validateProject(raw);
    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(7);
    // Additive means additive: everything that was there is still there, in
    // the same shape, with the same values.
    const before = validateProject(JSON.parse(JSON.stringify(p)));
    expect({ ...loaded, modifiedAt: 0 }).toEqual({ ...before, modifiedAt: 0 });
  });

  it('loads a v6 project that predates plugins without inventing any', () => {
    const raw = JSON.parse(JSON.stringify(createDemoProject())) as Record<string, unknown>;
    raw.schemaVersion = 6;
    const loaded = validateProject(raw);
    expect(loaded.tracks.flatMap((t) => t.effects ?? []).some((e) => e.kind === 'wam')).toBe(false);
  });

  it('refuses a project from a schema newer than this build', () => {
    const raw = JSON.parse(JSON.stringify(projectWithPlugin())) as Record<string, unknown>;
    raw.schemaVersion = SCHEMA_VERSION + 1;
    expect(() => validateProject(raw)).toThrow(/newer than this app/);
  });
});

describe('the parity probe decision', () => {
  const flat = (v: number, n = 12) => Array.from({ length: n }, () => v);

  beforeEach(() => {
    clearParityCache();
  });

  it('passes two envelopes that agree', () => {
    const offline = [0.1, 0.3, 0.5, 0.7, 0.9, 0.8, 0.6, 0.4];
    const realtime = offline.map((v) => v * 1.02);
    const r = compareParity(offline, realtime);
    expect(r.verdict).toBe('pass');
    expect(r.maxWindowError).toBeLessThan(DEFAULT_THRESHOLDS.window);
  });

  it('fails when the envelope shape diverges — a main-thread-driven modulation', () => {
    // The plugin's own LFO ran from a rAF tick in playback and did not fire in
    // step during the offline render, so the shapes disagree while the average
    // level is similar. This is exactly the silent-wrong-bounce case.
    const offline = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const realtime = [0.1, 0.9, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9];
    const r = compareParity(offline, realtime);
    expect(r.verdict).toBe('fail');
    expect(r.note).toContain('main thread');
  });

  it('fails on a level difference even when the shape matches', () => {
    const offline = [0.2, 0.4, 0.6, 0.8];
    const realtime = offline.map((v) => v / 2);
    const r = compareParity(offline, realtime);
    expect(r.verdict).toBe('fail');
    expect(r.levelRatio).toBeCloseTo(2, 5);
  });

  it('fails hardest when the plugin is silent in one context and not the other', () => {
    const loud = flat(0.4);
    const silent = flat(0);
    expect(compareParity(silent, loud).verdict).toBe('fail');
    expect(compareParity(silent, loud).note).toContain('silent when rendered offline');
    expect(compareParity(loud, silent).note).toContain('silent in playback');
  });

  it('is inconclusive rather than failing when both renders are silent', () => {
    // A plugin that made no sound on the probe proves nothing about parity —
    // it may simply need MIDI. Refusing to bounce every quiet plugin would be
    // wrong; deciding on no evidence would be worse.
    const r = compareParity(flat(0), flat(0));
    expect(r.verdict).toBe('inconclusive');
  });

  it('is inconclusive with nothing to compare', () => {
    expect(compareParity([], []).verdict).toBe('inconclusive');
    expect(compareParity([0.5], []).verdict).toBe('inconclusive');
  });

  it('only a failure makes a plugin print-required', () => {
    expect(isPrintRequired(undefined)).toBe(false);
    const base = { key: 'k', at: 0, maxWindowError: 0, levelRatio: 1, note: '' };
    expect(isPrintRequired({ ...base, verdict: 'pass' })).toBe(false);
    expect(isPrintRequired({ ...base, verdict: 'inconclusive' })).toBe(false);
    expect(isPrintRequired({ ...base, verdict: 'fail' })).toBe(true);
  });
});

describe('the parity cache', () => {
  beforeEach(() => {
    clearParityCache();
  });

  it('keys on identifier and version, so a plugin update re-probes', () => {
    expect(parityKey('com.x.y', '1.0.0')).toBe('com.x.y@1.0.0');
    recordParity('com.x.y', '1.0.0', {
      verdict: 'fail',
      maxWindowError: 0.9,
      levelRatio: 1,
      note: 'diverges',
    });
    expect(getParityRecord('com.x.y', '1.0.0')!.verdict).toBe('fail');
    // The new version has not been measured. It must not inherit the verdict —
    // in either direction: a fixed plugin should not stay blocked, and a broken
    // one should not be waved through on its predecessor's pass.
    expect(getParityRecord('com.x.y', '1.0.1')).toBeUndefined();
  });

  it('never caches an inconclusive verdict', () => {
    recordParity('com.x.z', '1.0.0', {
      verdict: 'inconclusive',
      maxWindowError: 0,
      levelRatio: 1,
      note: 'could not measure',
    });
    // "We could not measure" must not harden into "we decided": the next
    // attempt gets to try again.
    expect(getParityRecord('com.x.z', '1.0.0')).toBeUndefined();
  });

  it('names the plugins in a chain that must be printed before a bounce', () => {
    recordParity(STRANGER.identifier, STRANGER.version, {
      verdict: 'fail',
      maxWindowError: 0.8,
      levelRatio: 1,
      note: 'diverges',
    });
    const chain: Effect[] = [
      { id: 'a', kind: 'eq3', bypass: false, params: {} },
      { id: 'b', kind: 'wam', bypass: false, params: {}, plugin: STRANGER },
    ];
    const blocked = printRequiredPlugins(chain);
    expect(blocked.map((b) => b.effectId)).toEqual(['b']);
    expect(blocked[0].name).toBe('Mystery Box');
  });

  it('lets an unprobed plugin bounce through the normal offline path', () => {
    const chain: Effect[] = [{ id: 'b', kind: 'wam', bypass: false, params: {}, plugin: STRANGER }];
    expect(printRequiredPlugins(chain)).toEqual([]);
  });
});

describe('rmsEnvelope', () => {
  it('measures a constant signal as a flat envelope at its RMS', () => {
    const data = new Float32Array(4800).fill(0.5);
    const env = rmsEnvelope(data, 8);
    expect(env.length).toBe(8);
    for (const v of env) expect(v).toBeCloseTo(0.5, 6);
  });

  it('follows a ramp', () => {
    const data = new Float32Array(4800);
    for (let i = 0; i < data.length; i++) data[i] = i / data.length;
    const env = rmsEnvelope(data, 8);
    for (let i = 1; i < env.length; i++) expect(env[i]).toBeGreaterThan(env[i - 1]);
  });

  it('returns nothing when there is not a whole sample per window', () => {
    expect(rmsEnvelope(new Float32Array(4), 8)).toEqual([]);
  });
});
