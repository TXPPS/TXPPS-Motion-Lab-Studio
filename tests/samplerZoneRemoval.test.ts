/**
 * A zone that leaves the model takes its sound with it.
 *
 * Reported from use: in a multisample, delete a sample, load another, play a
 * chord — and the deleted one sounds underneath the new one. The cause is not
 * the model and not the match. `SamplerInstrument.getParams()` is read live, so
 * the *next* note is correct the instant the zone goes; a voice already sounding
 * holds its own buffer and its own graph, and nothing about the removal reaches
 * it. If that voice is looping or held, `endsAt` is `Infinity` and it plays
 * until panic.
 *
 * The measure is the one `tests/audit/instrumentStuckNotes.test.ts` argues for
 * and for the same reason: under a probe context a correctly stopped voice stays
 * in the allocation set, because nothing retires it without a real graph.
 * `sustainingZones()` — zones of voices with no scheduled end — is independent
 * of that and is exactly the thing being claimed about.
 *
 * The fuzz case at the bottom is the property the directive asked for: after
 * removing *any* zone, in any sequence, no sounding voice references it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { RackInstrument, SamplerInstrument } from '../src/audio/samplerInstrument';
import type { ActiveHandle, SourceRegistry } from '../src/audio/synth';
import { cacheBuffer, resetMediaCaches } from '../src/audio/mediaLibrary';
import { defaultSamplerParams, makeZone } from '../src/model/sampler';
import type { SamplerParams, SampleZone } from '../src/model/sampler';
import { createProbeContext } from './audit/probeContext';
import { ZoneRetirement, zoneIdsOfTrack, zonesRemoved } from '../src/audio/zoneRetire';
import type { Track } from '../src/model/types';
import type { ZoneSink } from '../src/audio/zoneRetire';

function registry(): SourceRegistry {
  const live = new Set<ActiveHandle>();
  return {
    register: (h) => live.add(h),
    unregister: (h) => live.delete(h),
    canAllocate: () => true,
  };
}

/**
 * A looping zone, deliberately.
 *
 * A one-shot schedules its own end at spawn and runs the window out whatever
 * happens, so it cannot be the voice that outlives its zone. The looped one is
 * the case, and it is what a sustained multisample layer is.
 */
function loopingZone(mediaId: string, keyLo = 0, keyHi = 127): SampleZone {
  return makeZone({ mediaId, rootNote: 60, loop: true, oneShot: false, keyLo, keyHi });
}

interface Rig {
  inst: SamplerInstrument;
  params: SamplerParams;
  setZones: (zones: SampleZone[]) => void;
}

function rig(zones: SampleZone[]): Rig {
  const probe = createProbeContext();
  const state: { params: SamplerParams } = {
    params: { ...defaultSamplerParams('multi'), zones },
  };
  const inst = new SamplerInstrument(
    probe.ctx,
    probe.ctx.createGain(),
    't1',
    () => state.params,
    registry(),
  );
  return {
    inst,
    get params() {
      return state.params;
    },
    setZones: (next) => {
      state.params = { ...state.params, zones: next };
    },
  };
}

beforeEach(() => {
  resetMediaCaches();
  for (const id of ['m-a', 'm-b', 'm-c', 'm-d']) {
    cacheBuffer(id, new AudioBuffer({ length: 4410, sampleRate: 44100, numberOfChannels: 1 }));
  }
});

describe('a removed zone stops sounding', () => {
  it('silences the voice that was playing it', () => {
    const a = loopingZone('m-a');
    const b = loopingZone('m-b');
    const r = rig([a, b]);
    r.inst.noteOn(60, 100);
    expect(new Set(r.inst.sustainingZones())).toEqual(new Set([a.id, b.id]));

    r.setZones([b]);
    r.inst.retireZones(new Set([a.id]), 0);

    // The whole defect in one assertion: before the fix `a` is still here, and
    // the next chord sounds it underneath whatever replaced it.
    expect(r.inst.sustainingZones()).toEqual([b.id]);
  });

  it('leaves every other zone alone', () => {
    const a = loopingZone('m-a');
    const b = loopingZone('m-b');
    const c = loopingZone('m-c');
    const r = rig([a, b, c]);
    r.inst.noteOn(60, 100);
    r.setZones([a, c]);
    r.inst.retireZones(new Set([b.id]), 0);
    expect(new Set(r.inst.sustainingZones())).toEqual(new Set([a.id, c.id]));
  });

  it('does not click: the stop is a fade, not a cut', () => {
    // A removed zone is not a note-off, so it must not take the master release,
    // which can be seconds. Nor may it be a hard cut. The soft stop's 20 ms
    // time constant is what both of those requirements leave.
    const a = loopingZone('m-a');
    const r = rig([a]);
    r.inst.noteOn(60, 100);
    r.inst.retireZones(new Set([a.id]), 0);
    expect(r.inst.sustainingZones()).toEqual([]);
    // Still allocated — it is fading, not gone. Asserting zero here would be
    // asserting that jsdom runs an audio thread.
    expect(r.inst.activeVoices()).toBe(1);
  });

  it('reaches a sampler inside a rack', () => {
    const a = loopingZone('m-a');
    const probe = createProbeContext();
    const params: SamplerParams = { ...defaultSamplerParams('multi'), zones: [a] };
    const child = new SamplerInstrument(
      probe.ctx,
      probe.ctx.createGain(),
      't1',
      () => params,
      registry(),
    );
    const rack = new RackInstrument(() => [
      { id: 'r1', keyLo: 0, keyHi: 127, muted: false, solo: false, instrument: child },
    ]);
    rack.noteOn(60, 100);
    expect(rack.sustainingZones()).toEqual([a.id]);
    rack.retireZones(new Set([a.id]), 0);
    // A rack item carries its own sampler and loses zones exactly as a
    // track-level one does. Looking only at `track.sampler` is the shape of bug
    // that gets fixed on whichever surface somebody happened to be looking at.
    expect(rack.sustainingZones()).toEqual([]);
  });
});

describe('the property: no sounding voice survives its zone', () => {
  /** The deterministic generator the rest of the suite uses. */
  function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a ^= a << 13;
      a ^= a >>> 17;
      a ^= a << 5;
      return ((a >>> 0) % 100000) / 100000;
    };
  }

  it('holds for every sequence of adds, plays and removes the fuzzer can build', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = seeded(seed * 7919);
      let zones: SampleZone[] = [];
      let n = 0;
      const r = rig(zones);
      const removed = new Set<string>();

      for (let step = 0; step < 60; step++) {
        const roll = rnd();
        if (roll < 0.35 || zones.length === 0) {
          const z = loopingZone(['m-a', 'm-b', 'm-c', 'm-d'][n % 4], 0, 127);
          n++;
          zones = [...zones, z];
          r.setZones(zones);
        } else if (roll < 0.7) {
          r.inst.noteOn(48 + Math.floor(rnd() * 36), 40 + Math.floor(rnd() * 80));
        } else {
          const victim = zones[Math.floor(rnd() * zones.length)];
          zones = zones.filter((z) => z.id !== victim.id);
          removed.add(victim.id);
          r.setZones(zones);
          // What the engine's graph sync does on every project change. The
          // sequence never touches a delete button — this is the point of
          // driving it from the sync rather than from a call site.
          r.inst.retireZones(new Set([victim.id]), 0);
        }

        const stillSounding = r.inst.sustainingZones().filter((id) => removed.has(id));
        expect(stillSounding, `seed ${seed}, step ${step}`).toEqual([]);
      }
    }
  });

  it('would catch the defect it was written for', () => {
    // Non-vacuity, and it is the half that matters: the loop above only proves
    // something if `sustainingZones` can report a removed zone at all. Remove
    // one without telling the instrument and it must.
    const a = loopingZone('m-a');
    const r = rig([a]);
    r.inst.noteOn(60, 100);
    r.setZones([]);
    expect(r.inst.sustainingZones()).toEqual([a.id]);
  });
});

describe('the diff the graph sync runs', () => {
  /** A track carrying zones both at its own level and inside a rack item. */
  function track(id: string, own: string[], racked: string[] = []): Track {
    return {
      id,
      name: id,
      type: 'instrument',
      sampler: own.length
        ? { ...defaultSamplerParams('multi'), zones: own.map((m) => loopingZone(m)) }
        : undefined,
      rack: racked.length
        ? {
            items: [
              {
                id: `${id}-r`,
                kind: 'sampler',
                keyLo: 0,
                keyHi: 127,
                muted: false,
                solo: false,
                sampler: {
                  ...defaultSamplerParams('multi'),
                  zones: racked.map((m) => loopingZone(m)),
                },
              },
            ],
          }
        : undefined,
    } as unknown as Track;
  }

  function sink(): ZoneSink & { asked: string[][] } {
    const asked: string[][] = [];
    return {
      asked,
      retireZones(gone) {
        asked.push([...gone].sort());
        return gone.size;
      },
    };
  }

  it("reads a rack item's zones as well as the track's own", () => {
    const t = track('t1', ['m-a'], ['m-b']);
    expect(zoneIdsOfTrack(t).size).toBe(2);
  });

  it('names exactly what went', () => {
    expect([...zonesRemoved(new Set(['a', 'b', 'c']), new Set(['b']))].sort()).toEqual(['a', 'c']);
    expect(zonesRemoved(new Set(['a']), new Set(['a', 'b'])).size).toBe(0);
  });

  it('says nothing on the first sync, then reports every later removal', () => {
    const watch = new ZoneRetirement();
    const s = sink();
    const before = track('t1', ['m-a', 'm-b']);
    const ids = [...zoneIdsOfTrack(before)];

    watch.sync([before], 0, () => s);
    // Nothing on the first pass: there is no previous project to differ from,
    // and reporting one would silence every zone of every freshly loaded song.
    expect(s.asked).toEqual([]);

    const after = {
      ...before,
      sampler: { ...before.sampler!, zones: before.sampler!.zones.slice(1) },
    } as Track;
    watch.sync([after], 0, () => s);
    expect(s.asked).toEqual([[ids[0]]]);
  });

  it('does not record a track whose instrument has not been built yet', () => {
    const watch = new ZoneRetirement();
    const s = sink();
    const t = track('t1', ['m-a', 'm-b']);
    // Frozen, audio, or simply not built yet: no sink. Recording it here would
    // make the sync after its instrument appears diff against a set nothing was
    // ever sounding, and silence a zone that had only just arrived.
    watch.sync([t], 0, () => null);
    const fewer = { ...t, sampler: { ...t.sampler!, zones: t.sampler!.zones.slice(1) } } as Track;
    watch.sync([fewer], 0, () => s);
    expect(s.asked).toEqual([]);
  });

  it('forgets a track that has gone', () => {
    const watch = new ZoneRetirement();
    const s = sink();
    const t = track('t1', ['m-a', 'm-b']);
    watch.sync([t], 0, () => s);
    watch.sync([], 0, () => s);
    // The id comes back carrying different zones. Without the cleanup this
    // diffs against the old track's set and silences the new one's.
    watch.sync([track('t1', ['m-c'])], 0, () => s);
    expect(s.asked).toEqual([]);
  });
});
