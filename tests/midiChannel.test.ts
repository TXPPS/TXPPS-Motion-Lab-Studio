import { describe, expect, it } from 'vitest';
import { acceptsMidiChannel, midiTargetTrackIds } from '../src/audio/midi';
import { createEmptyProject } from '../src/model/demoProject';
import type { ProjectData, Track } from '../src/model/types';

/**
 * `Track.midiChannel` is the filter the schema has always documented and the
 * engine never applied: every incoming note reached the same track whatever
 * channel it arrived on, which made a MIDI import's drum track (channel 10)
 * and a multi-timbral controller equally useless.
 */

function track(patch: Partial<Track> & { id: string }): Track {
  return {
    type: 'instrument',
    name: patch.id,
    color: '#37b89a',
    volume: 0.85,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    collapsed: false,
    output: 'master',
    ...patch,
  };
}

function projectWith(tracks: Track[]): ProjectData {
  return { ...createEmptyProject('MIDI'), tracks };
}

describe('the channel filter itself', () => {
  it('treats 0 and an absent value as omni', () => {
    expect(acceptsMidiChannel(track({ id: 'a' }), 1)).toBe(true);
    expect(acceptsMidiChannel(track({ id: 'a' }), 16)).toBe(true);
    expect(acceptsMidiChannel(track({ id: 'a', midiChannel: 0 }), 7)).toBe(true);
  });

  it('takes one channel and refuses the other fifteen', () => {
    const t = track({ id: 'a', midiChannel: 10 });
    expect(acceptsMidiChannel(t, 10)).toBe(true);
    for (const ch of [1, 2, 9, 11, 16]) expect(acceptsMidiChannel(t, ch)).toBe(false);
  });
});

describe('where a note on a channel goes', () => {
  it('reaches an armed omni track whatever the channel', () => {
    const p = projectWith([track({ id: 'omni', armed: true })]);
    expect(midiTargetTrackIds(p, null, 1)).toEqual(['omni']);
    expect(midiTargetTrackIds(p, null, 13)).toEqual(['omni']);
  });

  it('reaches only the armed track listening to that channel', () => {
    const p = projectWith([
      track({ id: 'keys', armed: true, midiChannel: 1 }),
      track({ id: 'drums', armed: true, type: 'drum', midiChannel: 10 }),
    ]);
    expect(midiTargetTrackIds(p, null, 1)).toEqual(['keys']);
    expect(midiTargetTrackIds(p, null, 10)).toEqual(['drums']);
  });

  it('reaches every armed track that matches, so two can be layered', () => {
    const p = projectWith([
      track({ id: 'pad', armed: true, midiChannel: 0 }),
      track({ id: 'bass', armed: true, midiChannel: 2 }),
      track({ id: 'lead', armed: true, midiChannel: 5 }),
    ]);
    expect(midiTargetTrackIds(p, null, 2)).toEqual(['pad', 'bass']);
    expect(midiTargetTrackIds(p, null, 5)).toEqual(['pad', 'lead']);
  });

  it('goes nowhere when no track listens to the channel', () => {
    const p = projectWith([
      track({ id: 'keys', armed: true, midiChannel: 1 }),
      track({ id: 'drums', midiChannel: 10 }),
    ]);
    expect(midiTargetTrackIds(p, 'keys', 4)).toEqual([]);
  });

  it('falls back to the selected track, then to the first, filter included', () => {
    const p = projectWith([
      track({ id: 'keys', midiChannel: 1 }),
      track({ id: 'pad' }),
      track({ id: 'drums', type: 'drum', midiChannel: 10 }),
    ]);
    // Nothing armed: the selected track answers when it accepts the channel.
    expect(midiTargetTrackIds(p, 'pad', 3)).toEqual(['pad']);
    // The selection does not accept it, so the first track that does.
    expect(midiTargetTrackIds(p, 'drums', 1)).toEqual(['keys']);
    // Nothing accepts channel 12 — the selection does not override the filter.
    expect(midiTargetTrackIds(p, 'keys', 12)).toEqual(['pad']);
  });

  it('ignores audio, bus and folder tracks entirely', () => {
    const p = projectWith([
      track({ id: 'audio', type: 'audio', armed: true }),
      track({ id: 'bus', type: 'bus' }),
      track({ id: 'keys', armed: true }),
    ]);
    expect(midiTargetTrackIds(p, null, 1)).toEqual(['keys']);
  });

  it('skips a frozen track, whose instrument is not running', () => {
    const p = projectWith([
      track({ id: 'frozen', armed: true, freeze: { mediaId: 'm1', renderedAt: 1 } }),
      track({ id: 'live', armed: true }),
    ]);
    expect(midiTargetTrackIds(p, null, 1)).toEqual(['live']);
  });
});
