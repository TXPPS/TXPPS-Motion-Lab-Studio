import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_CUE_MIXES, cueSendOf, cueTouchedCount, normalizeCueMixes } from '../src/model/cueMix';
import { resolveChannels } from '../src/model/mixerGraph';
import { createEmptyProject } from '../src/model/demoProject';
import { useProjectStore } from '../src/state/projectStore';
import type { ProjectData } from '../src/model/types';

function setup(): { a: string; b: string } {
  useProjectStore.getState().setProject(createEmptyProject('Cues'), { markClean: true });
  const a = useProjectStore.getState().addTrack('audio');
  const b = useProjectStore.getState().addTrack('audio');
  useProjectStore.getState().setTrack(a, { volume: 0.8, pan: -0.5 });
  useProjectStore.getState().setTrack(b, { volume: 0.5 });
  return { a, b };
}

const project = (): ProjectData => useProjectStore.getState().project;

describe('a cue mix', () => {
  let a = '';
  let b = '';
  let cue = '';

  beforeEach(() => {
    ({ a, b } = setup());
    cue = useProjectStore.getState().addCueMix('Drummer')!;
  });

  it('starts as the main mix, channel for channel', () => {
    const main = resolveChannels(project());
    const heard = resolveChannels(project(), cue);
    for (const id of [a, b]) {
      expect(heard.get(id)!.gain).toBeCloseTo(main.get(id)!.gain, 6);
      expect(heard.get(id)!.pan).toBeCloseTo(main.get(id)!.pan, 6);
    }
    expect(cueTouchedCount(project().cueMixes![0])).toBe(0);
  });

  it('departs from the main mix only on the channels that were touched', () => {
    useProjectStore.getState().setCueSend(cue, a, { level: 1.4 });
    const heard = resolveChannels(project(), cue);
    expect(heard.get(a)!.gain).toBeCloseTo(1.4, 6);
    // b was never touched, so it still follows
    expect(heard.get(b)!.gain).toBeCloseTo(0.5, 6);
    // and the main mix is unchanged by any of it
    expect(project().tracks.find((t) => t.id === a)!.volume).toBeCloseTo(0.8, 6);
  });

  it('keeps following the main fader on untouched channels after it moves', () => {
    useProjectStore.getState().setTrack(b, { volume: 0.9 });
    expect(resolveChannels(project(), cue).get(b)!.gain).toBeCloseTo(0.9, 6);
  });

  it('takes its starting position from the main mix the moment it is touched', () => {
    useProjectStore.getState().setCueSend(cue, a, { mute: true });
    const send = cueSendOf(
      project().cueMixes![0],
      project().tracks.find((t) => t.id === a)!,
    );
    // muting alone must not throw away where the fader was
    expect(send.level).toBeCloseTo(0.8, 6);
  });

  it('mutes a channel in the cue without muting it in the main mix', () => {
    useProjectStore.getState().setCueSend(cue, a, { mute: true });
    expect(resolveChannels(project(), cue).get(a)!.audible).toBe(false);
    expect(resolveChannels(project()).get(a)!.audible).toBe(true);
  });

  it('survives the engineer soloing something else, by default', () => {
    useProjectStore.getState().setTrack(b, { solo: true });
    expect(resolveChannels(project()).get(a)!.audible).toBe(false);
    expect(resolveChannels(project(), cue).get(a)!.audible).toBe(true);
  });

  it('follows solo when it is asked to', () => {
    useProjectStore.getState().setCueMix(cue, { ignoreSolo: false });
    useProjectStore.getState().setTrack(b, { solo: true });
    expect(resolveChannels(project(), cue).get(a)!.audible).toBe(false);
  });

  it('scales the whole cue by its own level', () => {
    useProjectStore.getState().setCueMix(cue, { level: 0.5 });
    expect(resolveChannels(project(), cue).get(b)!.gain).toBeCloseTo(0.25, 6);
  });

  it('still obeys a folder and a VCA, because a cue is a balance not a console', () => {
    const vca = useProjectStore.getState().addVca()!;
    useProjectStore.getState().setTrack(a, { vcaId: vca });
    useProjectStore.getState().setTrack(vca, { volume: 0.5 });
    useProjectStore.getState().setCueSend(cue, a, { level: 1 });
    expect(resolveChannels(project(), cue).get(a)!.gain).toBeCloseTo(0.5, 6);
  });

  it('tells the engine when a channel’s automation must not write across it', () => {
    // A channel nobody has touched still follows the main mix, automation and
    // all — it just plays at the cue's level.
    let heard = resolveChannels(project(), cue);
    expect(heard.get(a)!.cueOverride).toBe(false);
    expect(heard.get(a)!.cueScale).toBe(1);

    useProjectStore.getState().setCueMix(cue, { level: 0.5 });
    useProjectStore.getState().setCueSend(cue, a, { level: 1.2 });
    heard = resolveChannels(project(), cue);
    expect(heard.get(a)!.cueOverride).toBe(true);
    expect(heard.get(b)!.cueOverride).toBe(false);
    expect(heard.get(b)!.cueScale).toBeCloseTo(0.5, 6);

    // muting in the cue is an override too, or a mute lane would reopen it
    useProjectStore.getState().setCueSend(cue, b, { mute: true });
    expect(resolveChannels(project(), cue).get(b)!.cueOverride).toBe(true);
  });

  it('never claims an override when no cue is monitored', () => {
    const main = resolveChannels(project());
    expect(main.get(a)!.cueOverride).toBe(false);
    expect(main.get(a)!.cueScale).toBe(1);
  });

  it('goes back to the main mix on match', () => {
    useProjectStore.getState().setCueSend(cue, a, { level: 1.4 });
    useProjectStore.getState().matchCueToMain(cue);
    expect(resolveChannels(project(), cue).get(a)!.gain).toBeCloseTo(0.8, 6);
  });

  it('is ignored entirely when nothing names it', () => {
    useProjectStore.getState().setCueSend(cue, a, { level: 1.4 });
    expect(resolveChannels(project(), null).get(a)!.gain).toBeCloseTo(0.8, 6);
    expect(resolveChannels(project(), 'no-such-cue').get(a)!.gain).toBeCloseTo(0.8, 6);
  });

  it('stops adding cues at the limit', () => {
    for (let i = 0; i < MAX_CUE_MIXES + 3; i++) useProjectStore.getState().addCueMix();
    expect(project().cueMixes!.length).toBe(MAX_CUE_MIXES);
  });
});

describe('loading cue mixes', () => {
  it('drops sends for tracks that are gone', () => {
    const cues = normalizeCueMixes(
      [
        {
          id: 'c1',
          name: 'Drummer',
          level: 1,
          ignoreSolo: true,
          sends: {
            alive: { level: 1, pan: 0, mute: false, follow: false },
            dead: { level: 1, pan: 0, mute: false, follow: false },
          },
        },
      ],
      new Set(['alive']),
    );
    expect(Object.keys(cues[0].sends)).toEqual(['alive']);
  });

  it('clamps values and defaults a missing follow to true', () => {
    const [cue] = normalizeCueMixes(
      [{ id: 'c', name: 'X', level: 99, sends: { t: { level: -5, pan: 9 } } }],
      new Set(['t']),
    );
    expect(cue.level).toBe(1.5);
    expect(cue.sends.t.level).toBe(0);
    expect(cue.sends.t.pan).toBe(1);
    expect(cue.sends.t.follow).toBe(true);
    expect(cue.ignoreSolo).toBe(true);
  });

  it('returns nothing for anything that is not a list of cues', () => {
    expect(normalizeCueMixes(undefined, new Set())).toEqual([]);
    expect(normalizeCueMixes(['nope', 3], new Set())).toEqual([]);
  });
});
