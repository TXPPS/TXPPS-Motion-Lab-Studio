import { describe, expect, it } from 'vitest';
import { buildMidiFile, parseMidiFile } from '../src/model/midiFile';

describe('standard MIDI file', () => {
  it('round-trips notes, tempo and signature through a format-1 file', () => {
    const bytes = buildMidiFile(
      [
        {
          name: 'Bass',
          channel: 0,
          notes: [
            { tick: 0, durTicks: 480, pitch: 36, velocity: 100 },
            { tick: 480, durTicks: 240, pitch: 38, velocity: 88 },
            { tick: 1920, durTicks: 960, pitch: 43, velocity: 120 },
          ],
          ccs: [{ tick: 240, controller: 11, value: 64 }],
        },
        {
          name: 'Kit',
          channel: 9,
          notes: [{ tick: 0, durTicks: 120, pitch: 36, velocity: 127 }],
        },
      ],
      {
        ppq: 960,
        name: 'Test Song',
        tempos: [{ tick: 0, bpm: 96 }],
        sigs: [{ tick: 0, num: 3, den: 4 }],
      },
    );

    const parsed = parseMidiFile(bytes);
    expect(parsed.format).toBe(1);
    expect(parsed.ppq).toBe(960);
    // conductor track + two music tracks
    expect(parsed.tracks).toHaveLength(3);
    expect(parsed.tempos[0].bpm).toBeCloseTo(96, 2);
    expect(parsed.sigs[0]).toMatchObject({ num: 3, den: 4 });

    const bass = parsed.tracks.find((t) => t.name === 'Bass')!;
    expect(bass.notes).toHaveLength(3);
    expect(bass.notes[0]).toMatchObject({ tick: 0, durTicks: 480, pitch: 36, velocity: 100 });
    expect(bass.notes[2]).toMatchObject({ tick: 1920, durTicks: 960, pitch: 43 });
    expect(bass.ccs[0]).toMatchObject({ controller: 11, value: 64 });
    expect(bass.isDrums).toBe(false);

    const kit = parsed.tracks.find((t) => t.name === 'Kit')!;
    expect(kit.isDrums).toBe(true);
    expect(kit.channels).toEqual([9]);
  });

  it('handles overlapping same-pitch notes without losing either', () => {
    const bytes = buildMidiFile(
      [
        {
          name: 'Pad',
          channel: 0,
          notes: [
            { tick: 0, durTicks: 1920, pitch: 60, velocity: 90 },
            { tick: 480, durTicks: 480, pitch: 60, velocity: 40 },
          ],
        },
      ],
      { ppq: 480 },
    );
    const pad = parseMidiFile(bytes).tracks.find((t) => t.name === 'Pad')!;
    expect(pad.notes).toHaveLength(2);
    expect(pad.notes.map((n) => n.velocity).sort()).toEqual([40, 90]);
  });

  it('reads running status and multi-byte delta times', () => {
    // hand-built: two note-ons using running status, delta 0x81 0x00 = 128 ticks
    const track = [
      0x00,
      0x90,
      60,
      100, // note on C4
      0x81,
      0x00,
      62,
      100, // running status note on D4 after 128 ticks
      0x60,
      0x80,
      60,
      0x40,
      0x60,
      0x80,
      62,
      0x40,
      0x00,
      0xff,
      0x2f,
      0x00,
    ];
    const bytes = new Uint8Array([
      0x4d,
      0x54,
      0x68,
      0x64,
      0,
      0,
      0,
      6,
      0,
      0,
      0,
      1,
      0x01,
      0xe0,
      0x4d,
      0x54,
      0x72,
      0x6b,
      0,
      0,
      0,
      track.length,
      ...track,
    ]);
    const parsed = parseMidiFile(bytes);
    expect(parsed.ppq).toBe(480);
    const notes = parsed.tracks[0].notes;
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ tick: 0, pitch: 60 });
    expect(notes[1]).toMatchObject({ tick: 128, pitch: 62 });
  });

  it('rejects non-MIDI data and survives truncation', () => {
    expect(() => parseMidiFile(new Uint8Array([1, 2, 3]))).toThrow(/Not a MIDI file/);
    const good = buildMidiFile([
      { name: 'T', channel: 0, notes: [{ tick: 0, durTicks: 480, pitch: 60, velocity: 90 }] },
    ]);
    const truncated = good.subarray(0, good.length - 6);
    const parsed = parseMidiFile(truncated);
    expect(parsed.warnings.length + parsed.tracks.length).toBeGreaterThan(0);
  });

  it('estimates a length for a note that never gets a note-off', () => {
    const track = [0x00, 0x90, 64, 100, 0x60, 0xff, 0x2f, 0x00];
    const bytes = new Uint8Array([
      0x4d,
      0x54,
      0x68,
      0x64,
      0,
      0,
      0,
      6,
      0,
      0,
      0,
      1,
      0x01,
      0xe0,
      0x4d,
      0x54,
      0x72,
      0x6b,
      0,
      0,
      0,
      track.length,
      ...track,
    ]);
    const parsed = parseMidiFile(bytes);
    expect(parsed.tracks[0].notes).toHaveLength(1);
    expect(parsed.tracks[0].notes[0].durTicks).toBeGreaterThan(0);
    expect(parsed.warnings.join(' ')).toMatch(/note-off/);
  });
});
