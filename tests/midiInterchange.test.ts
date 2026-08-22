import { describe, expect, it } from 'vitest';
import {
  buildMidiFile,
  parseMidiFile,
  type MidiFileData,
  type MidiTrackData,
} from '../src/model/midiFile';
import {
  buildImportPlan,
  gmDrumName,
  gmProgramName,
  GM_PROGRAM_NAMES,
} from '../src/model/midiImport';
import { buildMidiExport } from '../src/model/midiExport';
import type { MidiClip, ProjectData, Track } from '../src/model/types';

// ------------------------------------------------------------------ fixtures

function midiTrack(over: Partial<MidiTrackData>): MidiTrackData {
  const notes = over.notes ?? [];
  const channels = [...new Set(notes.map((n) => n.channel))].sort((a, b) => a - b);
  return {
    name: '',
    notes,
    ccs: [],
    bends: [],
    programs: [],
    channels,
    isDrums: channels.length > 0 && channels.every((c) => c === 9),
    lengthTicks: notes.reduce((m, n) => Math.max(m, n.tick + n.durTicks), 0),
    ...over,
  };
}

function midiFile(over: Partial<MidiFileData>): MidiFileData {
  return {
    format: 1,
    ppq: 480,
    tracks: [],
    tempos: [{ tick: 0, bpm: 120 }],
    sigs: [{ tick: 0, num: 4, den: 4 }],
    warnings: [],
    ...over,
  };
}

function track(over: Partial<Track> & Pick<Track, 'id' | 'type' | 'name'>): Track {
  return {
    color: '#37b89a',
    volume: 1,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    collapsed: false,
    output: 'master',
    ...over,
  };
}

function midiClip(
  over: Partial<MidiClip> & Pick<MidiClip, 'id' | 'trackId' | 'start' | 'length' | 'notes'>,
): MidiClip {
  return {
    type: 'midi',
    name: 'Clip',
    muted: false,
    ...over,
  };
}

function project(over: Partial<ProjectData>): ProjectData {
  return {
    schemaVersion: 6,
    id: 'p1',
    name: 'Round Trip',
    createdAt: 0,
    modifiedAt: 0,
    bpm: 120,
    timeSig: { num: 4, den: 4 },
    loop: { enabled: false, start: 0, end: 16 },
    metronome: false,
    masterVolume: 1,
    tracks: [],
    clips: [],
    workspace: { pxPerBeat: 40, snap: 0.25 },
    ...over,
  };
}

/** Absolute (beat, pitch, length, velocity) of every note in an import plan. */
function planNotes(
  plan: ReturnType<typeof buildImportPlan>,
  trackName: string,
): { beat: number; pitch: number; length: number; velocity: number }[] {
  const t = plan.tracks.find((x) => x.name === trackName);
  if (!t) throw new Error(`no imported track named ${trackName}`);
  return t.clips
    .flatMap((c) =>
      c.notes.map((n) => ({
        beat: c.start + n.start,
        pitch: n.pitch,
        length: n.length,
        velocity: n.velocity,
      })),
    )
    .sort((a, b) => a.beat - b.beat || a.pitch - b.pitch);
}

// -------------------------------------------------------------------- import

describe('midi import plan', () => {
  it('converts ticks to beats and splits clips at long rests', () => {
    const plan = buildImportPlan(
      midiFile({
        tracks: [
          midiTrack({
            name: 'Lead',
            notes: [
              { tick: 0, durTicks: 480, pitch: 60, velocity: 100, channel: 0 },
              { tick: 240, durTicks: 240, pitch: 64, velocity: 90, channel: 0 },
              // 19 beats of rest — well past the 2-bar default
              { tick: 480 * 20, durTicks: 480, pitch: 67, velocity: 80, channel: 0 },
            ],
          }),
        ],
      }),
    );

    expect(plan.tracks).toHaveLength(1);
    const clips = plan.tracks[0].clips;
    expect(clips).toHaveLength(2);
    expect(clips[0]).toMatchObject({ name: 'Lead 1', start: 0, length: 4 });
    expect(clips[0].notes.map((n) => [n.start, n.length, n.pitch])).toEqual([
      [0, 1, 60],
      [0.5, 0.5, 64],
    ]);
    // the second clip starts on the bar line before its note (beat 20 = bar 5)
    expect(clips[1]).toMatchObject({ start: 20, length: 4 });
    expect(clips[1].notes[0]).toMatchObject({ start: 0, pitch: 67 });
    expect(plan.noteCount).toBe(3);
    expect(plan.endBeat).toBe(24);
  });

  it('keeps one clip when the rest is shorter than the split threshold', () => {
    const plan = buildImportPlan(
      midiFile({
        tracks: [
          midiTrack({
            name: 'Lead',
            notes: [
              { tick: 0, durTicks: 480, pitch: 60, velocity: 100, channel: 0 },
              { tick: 480 * 6, durTicks: 480, pitch: 62, velocity: 100, channel: 0 },
            ],
          }),
        ],
      }),
    );
    expect(plan.tracks[0].clips).toHaveLength(1);
    expect(plan.tracks[0].clips[0]).toMatchObject({ name: 'Lead', start: 0, length: 8 });
  });

  it('adopts the file tempo and signature map', () => {
    const plan = buildImportPlan(
      midiFile({
        tempos: [
          { tick: 0, bpm: 100 },
          { tick: 480 * 8, bpm: 140 },
        ],
        sigs: [
          { tick: 0, num: 4, den: 4 },
          { tick: 480 * 8, num: 3, den: 4 },
        ],
        tracks: [
          midiTrack({
            name: 'Lead',
            notes: [{ tick: 0, durTicks: 480, pitch: 60, velocity: 100, channel: 0 }],
          }),
        ],
      }),
    );
    expect(plan.bpm).toBe(100);
    expect(plan.timeSig).toEqual({ num: 4, den: 4 });
    expect(plan.tempoMap?.tempos.map((t) => [t.beat, t.bpm])).toEqual([
      [0, 100],
      [8, 140],
    ]);
    // tick 3840 at 4/4 is bar 2, and TempoMap keys signatures by bar
    expect(plan.tempoMap?.sigs.map((s) => [s.bar, s.num, s.den])).toEqual([
      [0, 4, 4],
      [2, 3, 4],
    ]);
  });

  it('leaves the tempo alone when importTempo is off', () => {
    const plan = buildImportPlan(
      midiFile({
        tempos: [{ tick: 0, bpm: 174 }],
        tracks: [
          midiTrack({ notes: [{ tick: 0, durTicks: 480, pitch: 60, velocity: 100, channel: 0 }] }),
        ],
      }),
      { importTempo: false },
    );
    expect(plan.tempoMap).toBeUndefined();
    expect(plan.bpm).toBe(174);
  });

  it('makes channel-10 tracks drum tracks and names the rest from the GM program', () => {
    const plan = buildImportPlan(
      midiFile({
        tracks: [
          midiTrack({
            programs: [33],
            notes: [{ tick: 0, durTicks: 240, pitch: 40, velocity: 100, channel: 1 }],
          }),
          midiTrack({
            notes: [
              { tick: 0, durTicks: 60, pitch: 36, velocity: 120, channel: 9 },
              { tick: 240, durTicks: 60, pitch: 42, velocity: 90, channel: 9 },
            ],
          }),
        ],
      }),
    );
    expect(plan.tracks[0]).toMatchObject({
      name: 'Electric Bass (finger)',
      type: 'instrument',
      channel: 1,
      program: 33,
      programName: 'Electric Bass (finger)',
    });
    expect(plan.tracks[1]).toMatchObject({ name: 'Drums', type: 'drum', channel: 9 });
    expect(GM_PROGRAM_NAMES).toHaveLength(128);
    expect(gmProgramName(0)).toBe('Acoustic Grand Piano');
    expect(gmProgramName(127)).toBe('Gunshot');
    expect(gmDrumName(36)).toBe('Bass Drum 1');
    expect(gmDrumName(42)).toBe('Closed Hi-Hat');
    expect(gmDrumName(20)).toBe('');
  });

  it('filters channels, scales velocity and offsets the start', () => {
    const file = midiFile({
      tracks: [
        midiTrack({
          name: 'Split',
          notes: [
            { tick: 0, durTicks: 480, pitch: 60, velocity: 100, channel: 0 },
            { tick: 480, durTicks: 480, pitch: 62, velocity: 100, channel: 1 },
          ],
        }),
      ],
    });
    const plan = buildImportPlan(file, { channels: [0], velocityScale: 0.5, startBeat: 8 });
    const notes = plan.tracks[0].clips.flatMap((c) =>
      c.notes.map((n) => ({ beat: c.start + n.start, pitch: n.pitch, velocity: n.velocity })),
    );
    expect(notes).toEqual([{ beat: 8, pitch: 60, velocity: 50 }]);
    expect(plan.tempoMap?.tempos[0].beat).toBe(0);
  });

  it('merges every track into one when asked', () => {
    const plan = buildImportPlan(
      midiFile({
        tracks: [
          midiTrack({
            name: 'Left',
            notes: [{ tick: 0, durTicks: 480, pitch: 48, velocity: 100, channel: 0 }],
          }),
          midiTrack({
            name: 'Right',
            notes: [{ tick: 0, durTicks: 480, pitch: 72, velocity: 100, channel: 1 }],
          }),
        ],
      }),
      { mergeTracks: true },
    );
    expect(plan.tracks).toHaveLength(1);
    expect(plan.tracks[0].name).toBe('Left');
    expect(plan.tracks[0].clips[0].notes.map((n) => n.pitch)).toEqual([48, 72]);
  });

  it('survives an empty file and a conductor-only file', () => {
    const empty = buildImportPlan(midiFile({ tracks: [], tempos: [], sigs: [] }));
    expect(empty.tracks).toEqual([]);
    expect(empty.noteCount).toBe(0);
    expect(empty.bpm).toBe(120);
    expect(empty.timeSig).toEqual({ num: 4, den: 4 });
    expect(empty.warnings).toContain('No notes found in this file.');

    const conductorOnly = buildImportPlan(
      midiFile({ tracks: [midiTrack({ name: 'Conductor' })], tempos: [{ tick: 0, bpm: 96 }] }),
    );
    expect(conductorOnly.tracks).toEqual([]);
    expect(conductorOnly.bpm).toBe(96);
  });

  it('pulls notes before beat 0 onto the start and shortens the absurdly long ones', () => {
    const plan = buildImportPlan(
      midiFile({
        tracks: [
          midiTrack({
            name: 'Odd',
            notes: [
              { tick: -240, durTicks: 960, pitch: 60, velocity: 100, channel: 0 },
              { tick: 0, durTicks: 480 * 100000, pitch: 64, velocity: 100, channel: 0 },
            ],
          }),
        ],
      }),
    );
    const notes = plan.tracks[0].clips[0].notes;
    expect(notes[0]).toMatchObject({ start: 0, length: 1.5, pitch: 60 });
    expect(notes[1]).toMatchObject({ start: 0, length: 512, pitch: 64 });
    expect(plan.warnings).toContain('1 note(s) started before the song start and were moved.');
    expect(plan.warnings).toContain('1 very long note(s) were shortened.');
  });
});

// -------------------------------------------------------------------- export

const exportProject = project({
  name: 'Export Me',
  tempoMap: {
    tempos: [
      { id: 't0', beat: 0, bpm: 120 },
      { id: 't1', beat: 12, bpm: 90 },
    ],
    sigs: [
      { id: 's0', bar: 0, num: 4, den: 4 },
      { id: 's1', bar: 2, num: 3, den: 4 },
      { id: 's2', bar: 3, num: 4, den: 4 },
    ],
  },
  tracks: [
    track({ id: 'keys', type: 'instrument', name: 'Keys' }),
    track({ id: 'pad', type: 'instrument', name: 'Pad' }),
    track({ id: 'kit', type: 'drum', name: 'Kit' }),
    track({ id: 'bus', type: 'bus', name: 'Bus' }),
  ],
  clips: [
    midiClip({
      id: 'c1',
      trackId: 'keys',
      name: 'Keys A',
      start: 0,
      length: 8,
      notes: [
        // deliberately overlapping: a held root under a moving upper voice
        { id: 'n1', start: 0, length: 4, pitch: 60, velocity: 100 },
        { id: 'n2', start: 1, length: 3, pitch: 64, velocity: 88 },
        { id: 'n3', start: 2, length: 2, pitch: 67, velocity: 120 },
        { id: 'n4', start: 6, length: 1.5, pitch: 72, velocity: 70 },
      ],
    }),
    midiClip({
      id: 'c2',
      trackId: 'keys',
      name: 'Keys B',
      // starts inside the 3/4 bar
      start: 8,
      length: 3,
      notes: [{ id: 'n5', start: 0, length: 3, pitch: 65, velocity: 95 }],
    }),
    midiClip({
      id: 'c3',
      trackId: 'pad',
      name: 'Pad A',
      start: 0,
      length: 4,
      notes: [{ id: 'n6', start: 0, length: 4, pitch: 48, velocity: 60 }],
    }),
    midiClip({
      id: 'c4',
      trackId: 'kit',
      name: 'Kit A',
      start: 0,
      length: 8,
      notes: [
        { id: 'd1', start: 0, length: 0.25, pitch: 36, velocity: 127 },
        { id: 'd2', start: 0.5, length: 0.25, pitch: 42, velocity: 80 },
        { id: 'd3', start: 1, length: 0.25, pitch: 38, velocity: 110 },
        { id: 'd4', start: 4, length: 0.25, pitch: 36, velocity: 127 },
      ],
    }),
  ],
});

describe('midi export plan', () => {
  it('writes one track per MIDI track, drums on channel 10', () => {
    const plan = buildMidiExport(exportProject);
    expect(plan.files).toHaveLength(1);
    const [file] = plan.files;
    expect(file.tracks.map((t) => [t.name, t.channel])).toEqual([
      ['Keys', 0],
      ['Pad', 1],
      ['Kit', 9],
    ]);
    expect(plan.noteCount).toBe(10);
    expect(file.options.ppq).toBe(960);
    expect(file.options.name).toBe('Export Me');
  });

  it('turns the tempo and signature map into conductor events', () => {
    const { options } = buildMidiExport(exportProject).files[0];
    expect(options.tempos).toEqual([
      { tick: 0, bpm: 120 },
      { tick: 12 * 960, bpm: 90 },
    ]);
    // bar 2 starts at beat 8, and the 3/4 bar puts bar 3 at beat 11
    expect(options.sigs).toEqual([
      { tick: 0, num: 4, den: 4 },
      { tick: 8 * 960, num: 3, den: 4 },
      { tick: 11 * 960, num: 4, den: 4 },
    ]);
  });

  it('expands a tempo ramp into steps, since a MIDI file has no ramps', () => {
    const ramped = project({
      tempoMap: {
        tempos: [
          { id: 'r0', beat: 0, bpm: 100, curve: 'ramp' },
          { id: 'r1', beat: 4, bpm: 140 },
        ],
        sigs: [{ id: 's0', bar: 0, num: 4, den: 4 }],
      },
      tracks: [track({ id: 'k', type: 'instrument', name: 'K' })],
      clips: [
        midiClip({
          id: 'c',
          trackId: 'k',
          start: 0,
          length: 4,
          notes: [{ id: 'n', start: 0, length: 1, pitch: 60, velocity: 100 }],
        }),
      ],
    });
    const { options } = buildMidiExport(ramped).files[0];
    expect(options.tempos?.map((t) => t.tick)).toEqual([0, 960, 1920, 2880, 3840]);
    expect(options.tempos?.[2].bpm).toBeCloseTo(120, 6);
  });

  it('excludes muted material unless asked to include it', () => {
    const muted = project({
      ...exportProject,
      tracks: exportProject.tracks.map((t) => (t.id === 'pad' ? { ...t, mute: true } : t)),
      clips: exportProject.clips.map((c) =>
        c.id === 'c2'
          ? { ...c, muted: true }
          : c.id === 'c1'
            ? {
                ...(c as MidiClip),
                notes: (c as MidiClip).notes.map((n) =>
                  n.id === 'n4' ? { ...n, muted: true } : n,
                ),
              }
            : c,
      ),
    });
    const plain = buildMidiExport(muted);
    expect(plain.files[0].tracks.map((t) => t.name)).toEqual(['Keys', 'Kit']);
    expect(plain.noteCount).toBe(7);

    const all = buildMidiExport(muted, { includeMuted: true });
    expect(all.files[0].tracks.map((t) => t.name)).toEqual(['Keys', 'Pad', 'Kit']);
    expect(all.noteCount).toBe(10);
  });

  it('exports a selection and a range, keeping song positions', () => {
    const selection = buildMidiExport(exportProject, { clipIds: ['c4'] });
    expect(selection.files[0].tracks.map((t) => t.name)).toEqual(['Kit']);
    expect(selection.noteCount).toBe(4);

    const ranged = buildMidiExport(exportProject, {
      trackIds: ['keys'],
      range: { start: 2, end: 8 },
    });
    const ticks = ranged.files[0].tracks[0].notes.map((n) => n.tick);
    // the note at beat 0 is out; beat 2 and beat 6 survive at their song positions
    expect(ticks).toEqual([2 * 960, 6 * 960]);

    const clipped = buildMidiExport(exportProject, {
      trackIds: ['keys'],
      range: { start: 0, end: 3 },
    });
    // notes still sounding at the range end are cut there
    expect(clipped.files[0].tracks[0].notes.map((n) => [n.tick / 960, n.durTicks / 960])).toEqual([
      [0, 3],
      [1, 2],
      [2, 1],
    ]);
  });

  it('splits into one file per track on request', () => {
    const plan = buildMidiExport(exportProject, { perTrack: true });
    expect(plan.files.map((f) => f.name)).toEqual([
      'Export Me - Keys',
      'Export Me - Pad',
      'Export Me - Kit',
    ]);
    expect(plan.files.every((f) => f.tracks.length === 1)).toBe(true);
    // every stem keeps the song's tempo map so it opens at the right tempo
    expect(plan.files[2].options.tempos).toHaveLength(2);
  });

  it('reports an empty export rather than writing a headerless file', () => {
    const plan = buildMidiExport(project({}));
    expect(plan.files).toEqual([]);
    expect(plan.warnings).toContain('Nothing to export: no unmuted MIDI notes in range.');
  });

  it('cuts notes that run past the end of their clip', () => {
    const over = project({
      tracks: [track({ id: 'k', type: 'instrument', name: 'K' })],
      clips: [
        midiClip({
          id: 'c',
          trackId: 'k',
          start: 0,
          length: 2,
          notes: [
            { id: 'a', start: 1, length: 8, pitch: 60, velocity: 100 },
            { id: 'b', start: 4, length: 1, pitch: 62, velocity: 100 },
          ],
        }),
      ],
    });
    const plan = buildMidiExport(over);
    expect(plan.files[0].tracks[0].notes).toEqual([
      { tick: 960, durTicks: 960, pitch: 60, velocity: 100 },
    ]);
    expect(plan.warnings).toContain('1 note(s) lay past the end of their clip and were skipped.');
  });
});

// ---------------------------------------------------------------- round trip

describe('midi round trip', () => {
  it('re-imports every note at the same beat through a real file', () => {
    const plan = buildMidiExport(exportProject);
    const bytes = buildMidiFile(plan.files[0].tracks, plan.files[0].options);
    const parsed = parseMidiFile(bytes);
    const back = buildImportPlan(parsed);

    expect(back.tracks.map((t) => [t.name, t.type])).toEqual([
      ['Keys', 'instrument'],
      ['Pad', 'instrument'],
      ['Kit', 'drum'],
    ]);
    expect(back.noteCount).toBe(plan.noteCount);

    expect(planNotes(back, 'Keys')).toEqual([
      { beat: 0, pitch: 60, length: 4, velocity: 100 },
      { beat: 1, pitch: 64, length: 3, velocity: 88 },
      { beat: 2, pitch: 67, length: 2, velocity: 120 },
      { beat: 6, pitch: 72, length: 1.5, velocity: 70 },
      { beat: 8, pitch: 65, length: 3, velocity: 95 },
    ]);
    expect(planNotes(back, 'Pad')).toEqual([{ beat: 0, pitch: 48, length: 4, velocity: 60 }]);
    expect(planNotes(back, 'Kit')).toEqual([
      { beat: 0, pitch: 36, length: 0.25, velocity: 127 },
      { beat: 0.5, pitch: 42, length: 0.25, velocity: 80 },
      { beat: 1, pitch: 38, length: 0.25, velocity: 110 },
      { beat: 4, pitch: 36, length: 0.25, velocity: 127 },
    ]);
  });

  it('brings the tempo change and the 3/4 bar back with it', () => {
    const plan = buildMidiExport(exportProject);
    const back = buildImportPlan(
      parseMidiFile(buildMidiFile(plan.files[0].tracks, plan.files[0].options)),
    );

    const tempos = back.tempoMap?.tempos ?? [];
    expect(tempos.map((t) => t.beat)).toEqual([0, 12]);
    expect(tempos[0].bpm).toBeCloseTo(120, 3);
    // 90 bpm is not an exact microseconds-per-quarter, so it returns rounded
    expect(tempos[1].bpm).toBeCloseTo(90, 3);
    expect(back.tempoMap?.sigs.map((s) => [s.bar, s.num, s.den])).toEqual([
      [0, 4, 4],
      [2, 3, 4],
      [3, 4, 4],
    ]);
  });
});
