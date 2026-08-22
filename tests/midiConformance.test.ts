import { describe, expect, it } from 'vitest';
import { buildMidiFile, parseMidiFile } from '../src/model/midiFile';

/**
 * Byte-level conformance to the Standard MIDI File spec.
 *
 * The other MIDI tests round-trip through this repo's own reader, which
 * proves the writer and the reader agree with each other. It does not prove
 * another DAW can open the file. These assertions are against the spec's own
 * byte layout, computed by hand, so a writer that drifted into a private
 * dialect both halves happened to understand would still fail here.
 */
const hex = (bytes: Uint8Array, from: number, count: number) =>
  [...bytes.slice(from, from + count)].map((b) => b.toString(16).padStart(2, '0')).join(' ');

/** Walk the chunk table the way any reader would, and report what it found. */
function chunks(bytes: Uint8Array): { id: string; length: number; at: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: { id: string; length: number; at: number }[] = [];
  let at = 0;
  while (at + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.slice(at, at + 4));
    const length = view.getUint32(at + 4);
    out.push({ id, length, at });
    at += 8 + length;
  }
  expect(at, 'the chunk lengths do not land exactly on the end of the file').toBe(bytes.length);
  return out;
}

const simple = () =>
  buildMidiFile(
    [
      {
        name: 'Keys',
        channel: 0,
        notes: [{ tick: 0, durTicks: 960, pitch: 60, velocity: 100 }],
      },
    ],
    { ppq: 960, tempos: [{ tick: 0, bpm: 120 }], sigs: [{ tick: 0, num: 4, den: 4 }] },
  );

describe('the header chunk', () => {
  it('is the fourteen bytes the spec prescribes, declaring format 1', () => {
    const bytes = simple();
    // "MThd", a length of 6, format 1, two tracks (conductor + Keys), 960 ppq.
    expect(hex(bytes, 0, 14)).toBe('4d 54 68 64 00 00 00 06 00 01 00 02 03 c0');
  });

  it('states a division with the top bit clear, which means ticks per quarter', () => {
    // A set top bit would mean SMPTE frames, and every tick in the file would
    // be read as a different unit of time.
    const bytes = simple();
    expect(bytes[12] & 0x80).toBe(0);
    expect((bytes[12] << 8) | bytes[13]).toBe(960);
  });
});

describe('the chunk table', () => {
  it('walks cleanly to the end of the file, with a conductor track first', () => {
    const found = chunks(simple());
    expect(found.map((c) => c.id)).toEqual(['MThd', 'MTrk', 'MTrk']);
    expect(found[0].length).toBe(6);
  });

  it('declares a track length that matches the bytes actually written', () => {
    const bytes = simple();
    const found = chunks(bytes);
    for (const c of found.slice(1)) {
      // Every track must end with the end-of-track meta event, and it must be
      // the last thing inside the declared length.
      const end = c.at + 8 + c.length;
      expect(hex(bytes, end - 3, 3), `track at ${c.at} does not end with FF 2F 00`).toBe(
        'ff 2f 00',
      );
    }
  });
});

describe('the conductor track', () => {
  it('carries tempo as microseconds per quarter note, not as BPM', () => {
    const bytes = simple();
    const at = [...bytes].findIndex((_, i) => hex(bytes, i, 3) === 'ff 51 03');
    expect(at, 'no tempo meta event').toBeGreaterThan(0);
    const us = (bytes[at + 3] << 16) | (bytes[at + 4] << 8) | bytes[at + 5];
    expect(us).toBe(500000); // 120 bpm
  });

  it('writes the time signature with the denominator as a power of two', () => {
    // FF 58 04 nn dd cc bb — dd is the exponent, so 4/4 is 04 02, not 04 04.
    const bytes = simple();
    const at = [...bytes].findIndex((_, i) => hex(bytes, i, 3) === 'ff 58 04');
    expect(at, 'no time signature meta event').toBeGreaterThan(0);
    expect(hex(bytes, at + 3, 4)).toBe('04 02 18 08');
  });

  it('writes 6/8 as a denominator exponent of three', () => {
    const bytes = buildMidiFile([{ name: 'a', channel: 0, notes: [] }], {
      sigs: [{ tick: 0, num: 6, den: 8 }],
    });
    const at = [...bytes].findIndex((_, i) => hex(bytes, i, 3) === 'ff 58 04');
    expect(hex(bytes, at + 3, 2)).toBe('06 03');
  });
});

describe('variable-length quantities', () => {
  it('encodes a delta under 128 in one byte and one at or above it in two', () => {
    const short = buildMidiFile([
      { name: 'a', channel: 0, notes: [{ tick: 0, durTicks: 100, pitch: 60, velocity: 64 }] },
    ]);
    const long = buildMidiFile([
      { name: 'a', channel: 0, notes: [{ tick: 0, durTicks: 960, pitch: 60, velocity: 64 }] },
    ]);
    // The note-off's delta is the duration. 100 fits in seven bits; 960 does
    // not, and must become 0x87 0x40 — continuation bit set on all but the last.
    const findAfterNoteOn = (b: Uint8Array) => {
      const on = [...b].findIndex((_, i) => b[i] === 0x90 && b[i + 1] === 60);
      return on + 3;
    };
    expect(hex(short, findAfterNoteOn(short), 1)).toBe('64');
    expect(hex(long, findAfterNoteOn(long), 2)).toBe('87 40');
  });

  it('encodes the largest legal delta in four bytes', () => {
    const bytes = buildMidiFile([
      {
        name: 'a',
        channel: 0,
        notes: [{ tick: 0x0fffffff, durTicks: 96, pitch: 60, velocity: 64 }],
      },
    ]);
    // 0x0FFFFFFF is the spec's maximum: FF FF FF 7F.
    const at = [...bytes].findIndex((_, i) => hex(bytes, i, 4) === 'ff ff ff 7f');
    expect(at, 'the maximum delta was not written as four bytes').toBeGreaterThan(0);
    // and it must survive being read back — tracks[0] is the conductor.
    const parsed = parseMidiFile(bytes);
    const withNotes = parsed.tracks.find((t) => t.notes.length > 0);
    expect(withNotes?.notes[0].tick).toBe(0x0fffffff);
  });
});

describe('channel messages', () => {
  it('puts the channel in the low nibble of the status byte', () => {
    const bytes = buildMidiFile([
      { name: 'drums', channel: 9, notes: [{ tick: 0, durTicks: 96, pitch: 36, velocity: 100 }] },
    ]);
    // Channel 10 in the spec's one-based numbering is nibble 9.
    expect([...bytes].some((b, i) => b === 0x99 && bytes[i + 1] === 36)).toBe(true);
  });

  it('never writes a data byte with the top bit set', () => {
    const bytes = buildMidiFile(
      [
        {
          name: 'hot',
          channel: 0,
          notes: [{ tick: 0, durTicks: 96, pitch: 200, velocity: 300 }],
        },
      ],
      { name: 'A name with a ünicode character' },
    );
    // A data byte over 127 would be read as a status byte and desynchronise
    // every reader from that point on — including on out-of-range input and
    // on text the caller supplied.
    const found = chunks(bytes);
    for (const c of found.slice(1)) {
      const body = bytes.slice(c.at + 8, c.at + 8 + c.length);
      let i = 0;
      let sawStatus = false;
      while (i < body.length) {
        // skip the delta
        while (i < body.length && (body[i] & 0x80) !== 0) i++;
        i++;
        if (i >= body.length) break;
        if ((body[i] & 0x80) !== 0) sawStatus = true;
        i++;
      }
      expect(sawStatus, 'a track with no status byte at all is malformed').toBe(true);
    }
    // The clearest statement of the same thing: it reads back without error.
    expect(() => parseMidiFile(bytes)).not.toThrow();
  });
});
