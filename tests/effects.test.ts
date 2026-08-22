import { beforeEach, describe, expect, it } from 'vitest';
import {
  EFFECT_GROUPS,
  EFFECT_SPECS,
  MAX_INSERTS,
  choiceName,
  choiceOf,
  defaultParams,
  describeEffect,
  effectSpec,
  effectsInGroup,
  eq8Bands,
  formatParam,
  isKnownEffect,
  delayLayoutOf,
  matchTrimFor,
  modulationOf,
  normaliseParams,
  paramOf,
  TUNE_SCALE_IDS,
  tuneSettingsOf,
} from '../src/model/effects';
import { EFFECT_GROUP_LABELS } from '../src/model/effects';
import type { Effect, EffectKind } from '../src/model/types';
import { useProjectStore } from '../src/state/projectStore';
import { createDemoProject } from '../src/model/demoProject';

function reset() {
  useProjectStore.getState().setProject(createDemoProject(), { markClean: true });
}

function audioTrackId(): string {
  return useProjectStore.getState().project.tracks.find((t) => t.type === 'audio')!.id;
}

describe('effect specs', () => {
  it('gives every spec parameter a default inside its own range', () => {
    for (const spec of EFFECT_SPECS) {
      for (const p of spec.params) {
        expect(p.min, `${spec.kind}.${p.key} min<max`).toBeLessThan(p.max);
        expect(p.default, `${spec.kind}.${p.key} default >= min`).toBeGreaterThanOrEqual(p.min);
        expect(p.default, `${spec.kind}.${p.key} default <= max`).toBeLessThanOrEqual(p.max);
      }
    }
  });

  it('log-curve parameters never start at zero, which would break the mapping', () => {
    for (const spec of EFFECT_SPECS) {
      for (const p of spec.params) {
        if (p.curve === 'log') expect(p.min, `${spec.kind}.${p.key}`).toBeGreaterThan(0);
      }
    }
  });

  it('defaultParams covers exactly the spec keys', () => {
    for (const spec of EFFECT_SPECS) {
      expect(Object.keys(defaultParams(spec.kind)).sort()).toEqual(
        spec.params.map((p) => p.key).sort(),
      );
    }
  });

  it('recognises known kinds and rejects unknown ones', () => {
    expect(isKnownEffect('compressor')).toBe(true);
    expect(isKnownEffect('quantum-flux')).toBe(false);
    expect(effectSpec('reverb')).toBeTruthy();
  });
});

describe('effect catalogue', () => {
  it('covers every kind the project schema can hold', () => {
    // The picker is generated from the specs, so a kind without one is a kind
    // a musician can never reach.
    const kinds: EffectKind[] = [
      'trim',
      'compressor',
      'gate',
      'limiter',
      'multiband',
      'deesser',
      'eq3',
      'eq8',
      'filter',
      'saturator',
      'distortion',
      'ampsim',
      'bitcrusher',
      'chorus',
      'flanger',
      'phaser',
      'tremolo',
      'rotary',
      'delay',
      'pingpong',
      'reverb',
      'width',
      'autopan',
      'gainMatch',
      'analyser',
      'tuner',
      'vocaltune',
    ];
    for (const kind of kinds) expect(effectSpec(kind), kind).toBeTruthy();
    expect(EFFECT_SPECS.length).toBe(kinds.length);
    expect(new Set(EFFECT_SPECS.map((s) => s.kind)).size).toBe(EFFECT_SPECS.length);
  });

  it('gives every effect a label, a blurb and a picker group', () => {
    for (const spec of EFFECT_SPECS) {
      expect(spec.label.length, spec.kind).toBeGreaterThan(0);
      expect(spec.blurb.length, spec.kind).toBeGreaterThan(10);
      expect(EFFECT_GROUPS, spec.kind).toContain(spec.group);
      expect(EFFECT_GROUP_LABELS[spec.group]).toBeTruthy();
      expect(spec.params.length, spec.kind).toBeGreaterThan(0);
    }
  });

  it('partitions the catalogue across the groups with nothing lost or doubled', () => {
    const grouped = EFFECT_GROUPS.flatMap((g) => effectsInGroup(g));
    expect(grouped.length).toBe(EFFECT_SPECS.length);
    expect(new Set(grouped.map((s) => s.kind)).size).toBe(EFFECT_SPECS.length);
  });

  it('flags gain reduction only on processors that measure it', () => {
    const reporting = EFFECT_SPECS.filter((s) => s.gainReduction).map((s) => s.kind);
    expect(reporting.sort()).toEqual(
      ['compressor', 'deesser', 'gate', 'limiter', 'multiband'].sort(),
    );
    for (const spec of EFFECT_SPECS) {
      if (spec.gainReduction) expect(spec.group, spec.kind).toBe('dynamics');
    }
  });

  it('gives every parameter a unit or a set of named choices', () => {
    for (const spec of EFFECT_SPECS) {
      for (const p of spec.params) {
        expect(p.unit !== undefined || p.choices !== undefined, `${spec.kind}.${p.key}`).toBe(true);
        expect(p.step, `${spec.kind}.${p.key} step`).toBeGreaterThan(0);
        expect(p.step, `${spec.kind}.${p.key} step`).toBeLessThanOrEqual(p.max - p.min);
      }
      expect(new Set(spec.params.map((p) => p.key)).size, spec.kind).toBe(spec.params.length);
    }
  });

  it('makes every choice parameter an exact index into its own list', () => {
    for (const spec of EFFECT_SPECS) {
      for (const p of spec.params) {
        if (!p.choices) continue;
        expect(p.min, `${spec.kind}.${p.key}`).toBe(0);
        expect(p.max, `${spec.kind}.${p.key}`).toBe(p.choices.length - 1);
        expect(p.step, `${spec.kind}.${p.key}`).toBe(1);
        expect(p.choices.length, `${spec.kind}.${p.key}`).toBeGreaterThan(1);
        expect(formatParam(p, p.default)).toBe(p.choices[p.default]);
      }
    }
  });

  it('reads and names a choice, clamping a value from outside the list', () => {
    const fx: Effect = {
      id: 'x',
      kind: 'saturator',
      bypass: false,
      params: { ...defaultParams('saturator'), model: 2 },
    };
    expect(choiceOf(fx, 'model')).toBe(2);
    expect(choiceName(fx, 'model')).toBe('Transistor');
    expect(choiceOf({ ...fx, params: { model: 99 } }, 'model')).toBe(2);
    expect(choiceOf({ ...fx, params: { model: -4 } }, 'model')).toBe(0);
    // A parameter with no choice list is not a choice; nothing to name.
    expect(choiceName(fx, 'drive')).toBe('');
  });

  it('exports the eight-band EQ as bands a response plot can draw', () => {
    const fx: Effect = {
      id: 'x',
      kind: 'eq8',
      bypass: false,
      params: { ...defaultParams('eq8'), b1On: 1, b1Freq: 500, b1Gain: 5, b1Q: 2, hpOn: 0 },
    };
    const bands = eq8Bands(fx);
    expect(bands.length).toBe(8);
    const band1 = bands[2];
    expect(band1.type).toBe('peaking');
    expect(band1.freqHz).toBe(500);
    expect(band1.gainDb).toBe(5);
    expect(band1.q).toBe(2);
    expect(band1.enabled).toBe(true);
    expect(bands[0].enabled).toBe(false);
    // Pass filters have no gain of their own, whatever a stale project stored.
    expect(bands[0].gainDb).toBe(0);
  });
});

describe('parameter normalisation', () => {
  it('clamps out-of-range values into the spec range', () => {
    const p = normaliseParams('compressor', { threshold: -900, ratio: 5000, attack: 3 });
    expect(p.threshold).toBe(-60);
    expect(p.ratio).toBe(20);
    expect(p.attack).toBe(3);
  });

  it('substitutes defaults for missing, non-numeric and non-finite values', () => {
    const p = normaliseParams('delay', {
      feedback: NaN,
      tone: 'loud' as unknown as number,
      mix: Infinity,
    });
    const spec = effectSpec('delay')!;
    for (const s of spec.params) expect(Number.isFinite(p[s.key])).toBe(true);
    expect(p.feedback).toBe(spec.params.find((x) => x.key === 'feedback')!.default);
    expect(p.tone).toBe(spec.params.find((x) => x.key === 'tone')!.default);
  });

  it('returns an empty map for an unknown kind rather than throwing', () => {
    expect(normaliseParams('nonsense' as never, { a: 1 })).toEqual({});
  });

  it('paramOf falls back to the spec default when a value is absent', () => {
    const fx: Effect = { id: 'x', kind: 'eq3', bypass: false, params: {} };
    expect(paramOf(fx, 'midFreq')).toBe(1000);
    expect(paramOf(fx, 'not-a-param')).toBe(0);
  });
});

describe('effect formatting', () => {
  it('formats each unit distinctly and never emits NaN', () => {
    for (const spec of EFFECT_SPECS) {
      for (const p of spec.params) {
        const text = formatParam(p, p.default);
        expect(text).not.toMatch(/NaN|undefined/);
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });

  it('summarises every effect kind with something readable', () => {
    for (const spec of EFFECT_SPECS) {
      const fx: Effect = {
        id: 'x',
        kind: spec.kind,
        bypass: false,
        params: defaultParams(spec.kind),
      };
      const summary = describeEffect(fx);
      expect(summary, spec.kind).not.toMatch(/NaN|undefined|Infinity/);
      expect(summary.length, spec.kind).toBeGreaterThan(0);
    }
  });

  it('moves the summary when the parameter it reports moves', () => {
    const base: Effect = {
      id: 'x',
      kind: 'gate',
      bypass: false,
      params: defaultParams('gate'),
    };
    expect(describeEffect(base)).not.toBe(
      describeEffect({ ...base, params: { ...base.params, threshold: -12 } }),
    );
    const synced: Effect = {
      id: 'y',
      kind: 'tremolo',
      bypass: false,
      params: { ...defaultParams('tremolo'), sync: 1, division: 2 },
    };
    expect(describeEffect(synced)).toContain('1/8');
    expect(describeEffect({ ...synced, params: { ...synced.params, sync: 0 } })).toContain('Hz');
  });
});

describe('insert chain store actions', () => {
  beforeEach(() => reset());

  it('adds an effect with spec defaults', () => {
    const tid = audioTrackId();
    const id = useProjectStore.getState().addEffect(tid, 'eq3');
    expect(id).toBeTruthy();
    const fx = useProjectStore.getState().project.tracks.find((t) => t.id === tid)!.effects![0];
    expect(fx.kind).toBe('eq3');
    expect(fx.bypass).toBe(false);
    expect(fx.params.midFreq).toBe(1000);
  });

  it('refuses to add past the slot cap and reports it by returning null', () => {
    const tid = audioTrackId();
    for (let i = 0; i < MAX_INSERTS; i++) {
      expect(useProjectStore.getState().addEffect(tid, 'trim')).toBeTruthy();
    }
    expect(useProjectStore.getState().addEffect(tid, 'trim')).toBeNull();
    const t = useProjectStore.getState().project.tracks.find((x) => x.id === tid)!;
    expect(t.effects!.length).toBe(MAX_INSERTS);
  });

  it('clamps parameter writes to the spec range', () => {
    const tid = audioTrackId();
    const id = useProjectStore.getState().addEffect(tid, 'compressor')!;
    useProjectStore.getState().setEffectParam(tid, id, 'ratio', 999);
    useProjectStore.getState().setEffectParam(tid, id, 'threshold', -999);
    const fx = useProjectStore.getState().project.tracks.find((t) => t.id === tid)!.effects![0];
    expect(fx.params.ratio).toBe(20);
    expect(fx.params.threshold).toBe(-60);
  });

  it('ignores writes to unknown parameters and non-finite values', () => {
    const tid = audioTrackId();
    const id = useProjectStore.getState().addEffect(tid, 'trim')!;
    useProjectStore.getState().setEffectParam(tid, id, 'notAParam', 5);
    useProjectStore.getState().setEffectParam(tid, id, 'gainDb', NaN);
    const fx = useProjectStore.getState().project.tracks.find((t) => t.id === tid)!.effects![0];
    expect(fx.params.notAParam).toBeUndefined();
    expect(fx.params.gainDb).toBe(0);
  });

  it('reorders within the chain and refuses to move past either end', () => {
    const tid = audioTrackId();
    const a = useProjectStore.getState().addEffect(tid, 'trim')!;
    const b = useProjectStore.getState().addEffect(tid, 'eq3')!;
    const order = () =>
      useProjectStore
        .getState()
        .project.tracks.find((t) => t.id === tid)!
        .effects!.map((e) => e.id);

    expect(order()).toEqual([a, b]);
    useProjectStore.getState().moveEffect(tid, b, -1);
    expect(order()).toEqual([b, a]);
    // already first: a move earlier is a no-op, not a crash or a duplicate
    useProjectStore.getState().moveEffect(tid, b, -1);
    expect(order()).toEqual([b, a]);
    useProjectStore.getState().moveEffect(tid, a, 1);
    expect(order()).toEqual([b, a]);
  });

  it('bypasses and removes without disturbing its neighbours', () => {
    const tid = audioTrackId();
    const a = useProjectStore.getState().addEffect(tid, 'trim')!;
    const b = useProjectStore.getState().addEffect(tid, 'delay')!;
    useProjectStore.getState().setEffectBypass(tid, a, true);
    let effects = useProjectStore.getState().project.tracks.find((t) => t.id === tid)!.effects!;
    expect(effects.find((e) => e.id === a)!.bypass).toBe(true);
    expect(effects.find((e) => e.id === b)!.bypass).toBe(false);

    useProjectStore.getState().removeEffect(tid, a);
    effects = useProjectStore.getState().project.tracks.find((t) => t.id === tid)!.effects!;
    expect(effects.map((e) => e.id)).toEqual([b]);
  });

  it('does nothing when the track or effect does not exist', () => {
    const tid = audioTrackId();
    expect(useProjectStore.getState().addEffect('no-such-track', 'trim')).toBeNull();
    expect(() => useProjectStore.getState().removeEffect(tid, 'no-such-fx')).not.toThrow();
    expect(() =>
      useProjectStore.getState().setEffectParam(tid, 'no-such-fx', 'gainDb', 1),
    ).not.toThrow();
    expect(() => useProjectStore.getState().moveEffect(tid, 'no-such-fx', 1)).not.toThrow();
  });
});

describe('sends', () => {
  beforeEach(() => reset());

  it('rejects a send to a non-bus track and to itself', () => {
    const p = useProjectStore.getState().project;
    const audio = p.tracks.find((t) => t.type === 'audio')!;
    const instrument = p.tracks.find((t) => t.type === 'instrument')!;

    useProjectStore.getState().setSend(audio.id, instrument.id, { enabled: true, amount: 0.5 });
    useProjectStore.getState().setSend(audio.id, audio.id, { enabled: true, amount: 0.5 });

    const after = useProjectStore.getState().project.tracks.find((t) => t.id === audio.id)!;
    expect(after.sends ?? []).toEqual([]);
  });

  it('creates and updates a send to a real bus', () => {
    const p = useProjectStore.getState().project;
    const audio = p.tracks.find((t) => t.type === 'audio')!;
    const bus = p.tracks.find((t) => t.type === 'bus')!;

    useProjectStore.getState().setSend(audio.id, bus.id, { enabled: true, amount: 0.4 });
    let send = useProjectStore
      .getState()
      .project.tracks.find((t) => t.id === audio.id)!
      .sends!.find((s) => s.busId === bus.id)!;
    expect(send.amount).toBeCloseTo(0.4);
    expect(send.preFader).toBe(false);

    useProjectStore.getState().setSend(audio.id, bus.id, { preFader: true });
    send = useProjectStore
      .getState()
      .project.tracks.find((t) => t.id === audio.id)!
      .sends!.find((s) => s.busId === bus.id)!;
    expect(send.preFader).toBe(true);
    // patching one field must not reset the others
    expect(send.amount).toBeCloseTo(0.4);
  });

  it('refuses a send that would create a routing cycle', () => {
    const p = useProjectStore.getState().project;
    const busA = p.tracks.find((t) => t.type === 'bus')!;
    const busB = p.tracks.filter((t) => t.type === 'bus')[1];
    expect(busB, 'demo project needs two buses for this test').toBeTruthy();

    // Route A into B, then try to send B back into A.
    useProjectStore.getState().setTrack(busA.id, { output: busB.id });
    useProjectStore.getState().setSend(busB.id, busA.id, { enabled: true, amount: 0.5 });

    const after = useProjectStore.getState().project.tracks.find((t) => t.id === busB.id)!;
    expect(after.sends ?? []).toEqual([]);
  });

  it('removes a send', () => {
    const p = useProjectStore.getState().project;
    const audio = p.tracks.find((t) => t.type === 'audio')!;
    const bus = p.tracks.find((t) => t.type === 'bus')!;
    useProjectStore.getState().setSend(audio.id, bus.id, { enabled: true, amount: 0.4 });
    useProjectStore.getState().removeSend(audio.id, bus.id);
    const after = useProjectStore.getState().project.tracks.find((t) => t.id === audio.id)!;
    expect(after.sends).toEqual([]);
  });
});

describe('Gain Match measures rather than guesses', () => {
  const match = (params: Record<string, number>): Effect => ({
    id: 'gm',
    kind: 'gainMatch',
    bypass: false,
    params,
  });

  it('corrects relative to the trim already applied, because the meter is after it', () => {
    // Measured −12 with +3 already on: the source is −15, and −18 needs −3.
    expect(matchTrimFor(match({ trim: 3, target: -18 }), -12)).toBe(-3);
    expect(matchTrimFor(match({ trim: 0, target: -18 }), -18)).toBe(0);
  });

  it('stops at the trim control own range instead of naming a value it has not got', () => {
    expect(matchTrimFor(match({ trim: 0, target: -18 }), -60)).toBe(24);
    expect(matchTrimFor(match({ trim: 0, target: -30 }), 6)).toBe(-24);
  });

  it('answers for nothing else', () => {
    expect(matchTrimFor(match({}), Number.NEGATIVE_INFINITY)).toBeNull();
    expect(matchTrimFor({ id: 't', kind: 'trim', bypass: false, params: {} }, -12)).toBeNull();
  });
});

describe('Vocal Tune carries the settings the editor retunes with', () => {
  const tune = (params: Record<string, number>): Effect => ({
    id: 'vt',
    kind: 'vocaltune',
    bypass: false,
    params,
  });

  it('reads its defaults as the audio editor terms', () => {
    const s = tuneSettingsOf(tune({}))!;
    expect(s.strength).toBe(0.8);
    expect(s.retuneMs).toBe(25);
    expect(s.humanise).toBe(0.6);
    expect(s.scaleId).toBe('major');
    expect(s.tonic).toBe(0);
    // Formant preservation is what the stretcher actually implements, and it
    // is on by default: a resampled shift moves the body of the voice with it.
    expect(s.formantPreserve).toBe(true);
  });

  it('maps the scale and key choices onto the product own scale list', () => {
    const s = tuneSettingsOf(tune({ scale: TUNE_SCALE_IDS.indexOf('min-pent'), key: 9 }))!;
    expect(s.scaleId).toBe('min-pent');
    expect(s.tonic).toBe(9);
  });

  it('answers for nothing else', () => {
    expect(tuneSettingsOf({ id: 'x', kind: 'trim', bypass: false, params: {} })).toBeNull();
  });
});

describe('the modulator a face draws is the one the audio runs', () => {
  const fx = (kind: EffectKind, params: Record<string, number>): Effect => ({
    id: 'm',
    kind,
    bypass: false,
    params,
  });

  it('reports chorus and flanger depth as the share of the sweep the audio can use', () => {
    // The audio clamps `depth / 1000` to the base delay, so 6 ms of sweep on a
    // 6 ms delay is full depth and the same 6 ms on 20 ms is under a third.
    expect(modulationOf(fx('chorus', { depth: 6, delay: 6 }), 120)?.depth).toBeCloseTo(1, 5);
    expect(modulationOf(fx('chorus', { depth: 6, delay: 20 }), 120)?.depth).toBeCloseTo(0.3, 5);
    expect(modulationOf(fx('flanger', { depth: 2, delay: 8 }), 120)?.depth).toBeCloseTo(0.25, 5);
  });

  it('draws nothing moving when a device is set to no modulation', () => {
    // The face used to fall back to 60 % whenever depth was zero, so a device
    // doing nothing drew a sweep.
    expect(modulationOf(fx('tremolo', { depth: 0 }), 120)?.depth).toBe(0);
    expect(modulationOf(fx('chorus', { depth: 0, delay: 8 }), 120)?.depth).toBe(0);
  });

  it('answers for the rotary, which has neither a depth nor a shape control', () => {
    const slow = modulationOf(fx('rotary', { hornDepth: 0.7, slowRate: 0.8, fastRate: 6.4 }), 120);
    expect(slow?.depth).toBeCloseTo(0.7, 5);
    expect(slow?.rateHz).toBeCloseTo(0.8, 5);
    const fast = modulationOf(
      fx('rotary', { hornDepth: 0.7, slowRate: 0.8, fastRate: 6.4, speed: 1 }),
      120,
    );
    expect(fast?.rateHz).toBeCloseTo(6.4, 5);
  });

  it('resolves a tempo lock, so the picture moves when the song does', () => {
    const free = modulationOf(fx('tremolo', { depth: 0.5, rate: 5 }), 120);
    expect(free?.rateHz).toBeCloseTo(5, 5);
    const locked = modulationOf(fx('tremolo', { depth: 0.5, sync: 1, division: 4 }), 120);
    // A quarter note at 120 bpm is 0.5 s, so a quarter-note tremolo is 2 Hz.
    expect(locked?.rateHz).toBeCloseTo(2, 5);
    expect(
      modulationOf(fx('tremolo', { depth: 0.5, sync: 1, division: 4 }), 60)?.rateHz,
    ).toBeCloseTo(1, 5);
  });

  it('answers for nothing that has no modulator', () => {
    expect(modulationOf(fx('reverb', {}), 120)).toBeNull();
    expect(modulationOf(fx('trim', {}), 120)).toBeNull();
  });
});

describe('the delay picture is the delay the audio builds', () => {
  const fx = (kind: EffectKind, params: Record<string, number>): Effect => ({
    id: 'd',
    kind,
    bypass: false,
    params,
  });

  it('carries the ping-pong Feel, which the audio applies and the layout ignored', () => {
    const straight = delayLayoutOf(fx('pingpong', { timeSixteenths: 4 }), 120)!;
    const dotted = delayLayoutOf(fx('pingpong', { timeSixteenths: 4, modifier: 1 }), 120)!;
    expect(dotted.timeSec).toBeCloseTo(straight.timeSec * 1.5, 6);
    const triplet = delayLayoutOf(fx('pingpong', { timeSixteenths: 4, modifier: 2 }), 120)!;
    expect(triplet.timeSec).toBeCloseTo((straight.timeSec * 2) / 3, 6);
  });

  it('leaves the plain delay straight, because it has no Feel control', () => {
    const a = delayLayoutOf(fx('delay', { timeSixteenths: 4 }), 120)!;
    const b = delayLayoutOf(fx('delay', { timeSixteenths: 4, modifier: 2 }), 120)!;
    expect(b.timeSec).toBeCloseTo(a.timeSec, 6);
  });

  it('reports the damping corner each kind actually has', () => {
    expect(delayLayoutOf(fx('delay', { tone: 4200 }), 120)?.toneHz).toBe(4200);
    // A ping-pong has no `tone`; it is the high cut that darkens its repeats.
    expect(delayLayoutOf(fx('pingpong', { highCut: 6500 }), 120)?.toneHz).toBe(6500);
  });

  it('reports the width, so a ping-pong at width zero is not drawn alternating', () => {
    expect(delayLayoutOf(fx('pingpong', { width: 0 }), 120)?.width).toBe(0);
    expect(delayLayoutOf(fx('pingpong', { width: 1 }), 120)?.width).toBe(1);
    expect(delayLayoutOf(fx('delay', {}), 120)?.width).toBe(0);
  });
});
