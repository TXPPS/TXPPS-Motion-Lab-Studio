import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makePoint } from '../src/model/automation';
import { createDemoProject } from '../src/model/demoProject';
import { denormParam, findAutoParam, listAutoParams } from '../src/model/paramRegistry';
import { DRUM_KIT_PARAMS, SYNTH_PRESETS } from '../src/model/presets';
import { defaultSamplerParams } from '../src/model/sampler';
import { validateProject } from '../src/persistence/projectRepo';
import type { RackItem, Track } from '../src/model/types';

/**
 * Every instrument lane a track offers must reach the instrument that track
 * plays through.
 *
 * This exists because a classic drum kit offered five lanes and honoured one.
 * `DrumKit` reads `volume`; Cutoff, Resonance, Attack and Release could be
 * drawn, recorded, played back and bounced, and moved no audio whatsoever. It
 * is the same defect as a control that does nothing, and worse in one way —
 * the user pays for it in the time spent drawing a curve that was never going
 * to be heard.
 *
 * The check is deliberately crude, in the manner of `schemaWired.test.ts`: it
 * reads the instrument's own source and looks for the field being read off its
 * parameters. A key that passes is not proven to be used correctly; a key that
 * fails is proven to be read by nothing.
 *
 * Channel lanes (volume, pan, mute, sends) belong to the mixer and effect
 * lanes to the insert chain, so neither is this file's business — it guards
 * the instrument surface, which is where the two parameter objects and the
 * four instrument classes can get out of step with each other.
 */
const SRC = join(__dirname, '..', 'src');
const synthSrc = readFileSync(join(SRC, 'audio/synth.ts'), 'utf8');
const samplerSrc = readFileSync(join(SRC, 'audio/samplerInstrument.ts'), 'utf8');
const engineSrc = readFileSync(join(SRC, 'audio/engine.ts'), 'utf8');
const exportSrc = readFileSync(join(SRC, 'audio/exportMix.ts'), 'utf8');

/** One class body, brace-matched from its declaration. */
function classBody(source: string, name: string): string {
  const at = source.search(new RegExp(`\\bclass ${name}\\b`));
  if (at < 0) throw new Error(`class ${name} not found`);
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error(`class ${name} never closes`);
}

/**
 * What each instrument reads. `PolySynth` holds no parameters of its own —
 * `Voice` reads them, one voice per note — so the two are one surface, and
 * splitting them here would let a parameter only `Voice` touches read as dead.
 */
const INSTRUMENT_SOURCE: Record<InstrumentName, string> = {
  DrumKit: classBody(synthSrc, 'DrumKit'),
  PolySynth: `${classBody(synthSrc, 'PolySynth')}\n${classBody(synthSrc, 'Voice')}`,
  SamplerInstrument: classBody(samplerSrc, 'SamplerInstrument'),
  // A rack plays its children, each with its own params; it never looks at the
  // track's `synth` or `sampler` at all, so nothing may be offered against it.
  RackInstrument: classBody(samplerSrc, 'RackInstrument'),
};

type InstrumentName = 'DrumKit' | 'PolySynth' | 'SamplerInstrument' | 'RackInstrument';

/**
 * Which instruments see which parameter object: a `synth:` lane names a field
 * of `SynthParams` and an `smp:` lane a field of `SamplerParams`. Offering the
 * wrong family would sail past the text search below — both objects have a
 * `volume` — so the family is checked before the field is.
 */
const READERS_OF: Record<string, InstrumentName[]> = {
  synth: ['DrumKit', 'PolySynth'],
  smp: ['SamplerInstrument'],
};

/**
 * Does this source read `key` off its parameters? The instruments spell that
 * three ways: `params.x` in a constructor, `p.x` off a local snapshot, and
 * `this.getParams().x` where the value is wanted at trigger time.
 */
function reads(source: string, key: string): boolean {
  return new RegExp(`(?:\\bparams|\\bp|getParams\\(\\))\\.${key}\\b`).test(source);
}

const project = createDemoProject();

function makeTrack(patch: Partial<Track> & Pick<Track, 'name' | 'type'>): Track {
  return {
    id: `t-${patch.name}`,
    color: '#888888',
    volume: 1,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    collapsed: true,
    output: 'master',
    ...patch,
  };
}

const RACK_ITEM: RackItem = {
  id: 'rk1',
  name: 'Layer',
  color: '#888888',
  keyLo: 0,
  keyHi: 127,
  muted: false,
  solo: false,
  kind: 'synth',
  synth: { ...SYNTH_PRESETS[0] },
};

const synthTrack = makeTrack({ name: 'Keys', type: 'instrument', synth: { ...SYNTH_PRESETS[0] } });
const kitTrack = makeTrack({ name: 'Kit', type: 'drum', synth: { ...DRUM_KIT_PARAMS } });
const drumRackTrack = makeTrack({
  name: 'Pads',
  type: 'drum',
  synth: { ...DRUM_KIT_PARAMS },
  sampler: defaultSamplerParams('drum'),
});
const quickSamplerTrack = makeTrack({
  name: 'Quick',
  type: 'instrument',
  sampler: defaultSamplerParams('quick'),
});

/**
 * One shape per instrument the engine can build, plus the two track types that
 * own no instrument at all. `instrument` is what `engine.syncGraph` picks for
 * that shape — rack, then sampler, then drum kit, then poly synth — and the
 * last test in this file checks that ordering is still what the engine says.
 */
const SHAPES: { what: string; track: Track; instrument: InstrumentName | null }[] = [
  { what: 'an audio track', track: makeTrack({ name: 'Audio', type: 'audio' }), instrument: null },
  { what: 'a bus', track: makeTrack({ name: 'Bus', type: 'bus' }), instrument: null },
  { what: 'a synth track', track: synthTrack, instrument: 'PolySynth' },
  { what: 'a classic drum kit', track: kitTrack, instrument: 'DrumKit' },
  { what: 'a drum track holding a sampler', track: drumRackTrack, instrument: 'SamplerInstrument' },
  { what: 'a quick sampler', track: quickSamplerTrack, instrument: 'SamplerInstrument' },
  {
    what: 'an instrument rack',
    track: makeTrack({
      name: 'Rack',
      type: 'instrument',
      synth: { ...SYNTH_PRESETS[0] },
      rack: { items: [RACK_ITEM] },
    }),
    instrument: 'RackInstrument',
  },
];

/** The lanes that name an instrument parameter rather than a channel or insert one. */
function instrumentLanes(track: Track) {
  return listAutoParams(track, project).filter((p) => /^(synth|smp):/.test(p.id));
}

describe('every instrument lane a track offers reaches its instrument', () => {
  for (const shape of SHAPES) {
    it(`${shape.what}: ${shape.instrument ?? 'no instrument'}`, () => {
      for (const lane of instrumentLanes(shape.track)) {
        const [prefix, key] = [lane.id.slice(0, lane.id.indexOf(':')), lane.id.split(':')[1]];
        const readers = READERS_OF[prefix] ?? [];
        expect(
          shape.instrument !== null && readers.includes(shape.instrument),
          `${shape.what} offers ${lane.id} ("${lane.name}") but plays through ` +
            `${shape.instrument ?? 'no instrument'}, which never sees that parameter object`,
        ).toBe(true);
        expect(
          reads(INSTRUMENT_SOURCE[shape.instrument as InstrumentName], key),
          `${shape.what} offers ${lane.id} ("${lane.name}") and ` +
            `${shape.instrument} never reads ${key}`,
        ).toBe(true);
      }
    });
  }

  /**
   * The loop above is vacuously true for a track that offers nothing, so the
   * shapes that do have a parameter-reading instrument are pinned separately —
   * otherwise deleting every descriptor would make this file pass.
   */
  it('and the instruments that read parameters are actually offered some', () => {
    for (const shape of SHAPES) {
      const some = shape.instrument !== null && shape.instrument !== 'RackInstrument';
      expect(instrumentLanes(shape.track).length > 0, `${shape.what}`).toBe(some);
    }
  });
});

describe('a classic drum kit offers the one lane it can honour', () => {
  it('offers Level and none of the four the kit has no filter or envelope for', () => {
    expect(instrumentLanes(kitTrack).map((p) => p.id)).toEqual(['synth:volume']);
  });

  it('leaves the poly synth with all five', () => {
    expect(instrumentLanes(synthTrack).map((p) => p.id)).toEqual([
      'synth:cutoff',
      'synth:resonance',
      'synth:attack',
      'synth:release',
      'synth:volume',
    ]);
  });

  it('leaves a drum track holding a sampler on the sampler surface', () => {
    const ids = instrumentLanes(drumRackTrack).map((p) => p.id);
    expect(ids).toContain('smp:filterCutoff');
    expect(ids.some((id) => id.startsWith('synth:'))).toBe(false);
  });
});

/**
 * Narrowing what is OFFERED must not narrow what a saved project MEANS. These
 * three are the difference between a lane that stops being offered and a lane
 * that disappears with the user's points inside it.
 */
describe('a lane an earlier version offered is kept, not deleted', () => {
  const legacyKit = (): Track => ({
    ...kitTrack,
    automation: [
      { id: 'al-legacy', paramId: 'synth:cutoff', points: [makePoint(0, 0.25)], enabled: true },
    ],
  });

  it('still resolves, so the arrangement draws its row and the user can delete it', () => {
    const desc = findAutoParam(legacyKit(), project, 'synth:cutoff');
    expect(desc?.name).toBe('Synth · Cutoff');
  });

  it('survives the load path, which drops lanes it cannot account for', () => {
    const p = createDemoProject();
    const drum = p.tracks.find((t) => t.type === 'drum' && !t.sampler);
    expect(drum, 'the demo project no longer has a classic kit to test with').toBeDefined();
    drum!.automation = legacyKit().automation;
    const revived = validateProject(JSON.parse(JSON.stringify(p)));
    const kept = revived.tracks.find((t) => t.id === drum!.id)?.automation;
    expect(kept?.map((l) => l.paramId)).toEqual(['synth:cutoff']);
    expect(kept?.[0].points).toHaveLength(1);
  });

  it('but is not offered again as a new lane', () => {
    expect(instrumentLanes(legacyKit()).map((p) => p.id)).not.toContain('synth:cutoff');
  });
});

/**
 * The sampler's resonance is the number Web Audio reads as decibels of lift at
 * the corner, and the registry used to call it Q — so the same value read in
 * two different units depending on whether you were looking at the instrument
 * panel or at the automation lane.
 */
describe('resonance lanes are quoted in the unit the audio reads', () => {
  const smp = () => findAutoParam(quickSamplerTrack, project, 'smp:filterRes')!;

  it('the sampler lane says decibels, like the synth lane that writes the same field', () => {
    const syn = findAutoParam(synthTrack, project, 'synth:resonance')!;
    expect(smp().unit).toBe('dB');
    expect(smp().format(0.8)).toBe('0.8 dB');
    expect(smp().unit).toBe(syn.unit);
  });

  it('keeps the mapping the saved lanes were drawn against', () => {
    expect([smp().min, smp().max, smp().scale]).toEqual([0.1, 20, 'log']);
    // A stored lane point is normalized, so the midpoint of the log range is
    // what a half-height point has always meant and must go on meaning.
    expect(denormParam(smp(), 0.5)).toBeCloseTo(Math.sqrt(0.1 * 20), 9);
  });

  it('and the sampler still builds only filters whose Q is decibels', () => {
    expect(samplerSrc).toMatch(/filter\.Q\.value = p\.filterRes/);
    expect(readFileSync(join(SRC, 'model/sampler.ts'), 'utf8')).toMatch(
      /filterType: 'off' \| 'lowpass' \| 'highpass'/,
    );
  });
});

/**
 * The shapes above hard-code which instrument the engine builds for a track.
 * If that routing changes, every expectation in this file is measuring the
 * wrong instrument while still passing, so the routing itself is pinned.
 */
it('the instrument routing these shapes assume is still the engine and bounce', () => {
  expect(engineSrc, 'a drum track without a sampler no longer gets a DrumKit').toMatch(
    /type === 'drum' && !\w+\.sampler[\s\S]{0,200}?new DrumKit\(/,
  );
  expect(exportSrc, 'the bounce no longer gives a drum track a DrumKit').toMatch(
    /type === 'drum'[\s\S]{0,80}?new DrumKit\(/,
  );
  expect(engineSrc, 'a rack no longer outranks the sampler and the synth').toMatch(
    /rack\?\.items\.length\s*\?[\s\S]{0,160}?:\s*track\.sampler/,
  );
});
