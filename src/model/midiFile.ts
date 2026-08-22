/**
 * Standard MIDI File reader and writer (format 0 and 1).
 *
 * Self-contained: no dependencies, no DOM. The reader is defensive — a
 * truncated or malformed file yields what could be parsed rather than throwing
 * — because dragging a broken .mid into a DAW should say "nothing usable in
 * there", not lose the session.
 *
 * Times are kept in the file's own ticks until the caller converts them, so the
 * importer can build a tempo map from the file before placing any note.
 */

export interface MidiNoteEvent {
  tick: number;
  durTicks: number;
  pitch: number;
  velocity: number;
  channel: number;
}

export interface MidiCcEvent {
  tick: number;
  controller: number;
  value: number;
  channel: number;
}

export interface MidiPitchBendEvent {
  tick: number;
  /** −1..1 */
  value: number;
  channel: number;
}

export interface MidiTrackData {
  name: string;
  notes: MidiNoteEvent[];
  ccs: MidiCcEvent[];
  bends: MidiPitchBendEvent[];
  /** program-change numbers seen, in order */
  programs: number[];
  /** channels used by this track's notes */
  channels: number[];
  /** true when every note is on channel 10 (1-based), i.e. GM drums */
  isDrums: boolean;
  lengthTicks: number;
}

export interface MidiTempoEvent {
  tick: number;
  bpm: number;
}

export interface MidiSigEvent {
  tick: number;
  num: number;
  den: number;
}

export interface MidiFileData {
  format: number;
  ppq: number;
  tracks: MidiTrackData[];
  tempos: MidiTempoEvent[];
  sigs: MidiSigEvent[];
  /** non-fatal problems worth telling the user about */
  warnings: string[];
}

class Reader {
  pos = 0;
  constructor(readonly data: Uint8Array) {}
  get remaining(): number {
    return this.data.length - this.pos;
  }
  u8(): number {
    if (this.pos >= this.data.length) throw new RangeError('eof');
    return this.data[this.pos++];
  }
  u16(): number {
    return (this.u8() << 8) | this.u8();
  }
  u32(): number {
    return ((this.u8() << 24) >>> 0) + (this.u8() << 16) + (this.u8() << 8) + this.u8();
  }
  bytes(n: number): Uint8Array {
    if (n < 0 || this.pos + n > this.data.length) throw new RangeError('eof');
    const out = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  /** Variable-length quantity. */
  vlq(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      value = (value << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) return value;
    }
    return value;
  }
  ascii(n: number): string {
    return String.fromCharCode(...this.bytes(n));
  }
}

const textOf = (b: Uint8Array): string => {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  try {
    return new TextDecoder().decode(b) || s;
  } catch {
    return s;
  }
};

/** Parse a Standard MIDI File. Throws only when the header is not a MIDI file. */
export function parseMidiFile(bytes: Uint8Array): MidiFileData {
  const r = new Reader(bytes);
  const warnings: string[] = [];
  if (r.remaining < 14) throw new Error('Not a MIDI file: too short');
  if (r.ascii(4) !== 'MThd') throw new Error('Not a MIDI file: missing MThd header');
  const headerLen = r.u32();
  const format = r.u16();
  const trackCount = r.u16();
  const division = r.u16();
  // Skip any header bytes past the standard six.
  if (headerLen > 6) r.bytes(headerLen - 6);

  let ppq = 480;
  if (division & 0x8000) {
    // SMPTE division: frames-per-second × ticks-per-frame.
    const fps = 256 - ((division >> 8) & 0xff);
    const tpf = division & 0xff;
    ppq = Math.max(1, Math.round(fps * tpf));
    warnings.push('SMPTE-timed file: timing converted approximately.');
  } else {
    ppq = division || 480;
  }

  const tracks: MidiTrackData[] = [];
  const tempos: MidiTempoEvent[] = [];
  const sigs: MidiSigEvent[] = [];

  for (let t = 0; t < trackCount; t++) {
    if (r.remaining < 8) {
      warnings.push(`File declares ${trackCount} tracks but ends after ${t}.`);
      break;
    }
    let id = r.ascii(4);
    let len = r.u32();
    // Some exporters pad between chunks; skip unknown chunk types.
    let guard = 0;
    while (id !== 'MTrk' && guard++ < 32 && r.remaining >= len + 8) {
      r.bytes(len);
      id = r.ascii(4);
      len = r.u32();
    }
    if (id !== 'MTrk') {
      warnings.push('Unreadable chunk encountered; stopped reading.');
      break;
    }
    const end = Math.min(r.pos + len, bytes.length);
    const track = readTrack(r, end, tempos, sigs, ppq, warnings);
    r.pos = end;
    tracks.push(track);
  }

  if (tempos.length === 0) tempos.push({ tick: 0, bpm: 120 });
  if (sigs.length === 0) sigs.push({ tick: 0, num: 4, den: 4 });
  tempos.sort((a, b) => a.tick - b.tick);
  sigs.sort((a, b) => a.tick - b.tick);

  return { format, ppq, tracks, tempos, sigs, warnings };
}

function readTrack(
  r: Reader,
  end: number,
  tempos: MidiTempoEvent[],
  sigs: MidiSigEvent[],
  _ppq: number,
  warnings: string[],
): MidiTrackData {
  const notes: MidiNoteEvent[] = [];
  const ccs: MidiCcEvent[] = [];
  const bends: MidiPitchBendEvent[] = [];
  const programs: number[] = [];
  const channels = new Set<number>();
  /** channel<<8|pitch → open note-ons, so overlapping same-pitch notes stack */
  const open = new Map<number, { tick: number; velocity: number }[]>();
  let name = '';
  let tick = 0;
  let running = 0;
  let lastTick = 0;

  while (r.pos < end) {
    let delta: number;
    try {
      delta = r.vlq();
    } catch {
      break;
    }
    tick += delta;
    let status: number;
    try {
      status = r.u8();
    } catch {
      break;
    }
    if (status < 0x80) {
      // running status: the byte we just read is the first data byte
      r.pos--;
      status = running;
      if (status < 0x80) break;
    } else if (status < 0xf0) {
      running = status;
    }

    try {
      if (status === 0xff) {
        const type = r.u8();
        const len = r.vlq();
        const data = r.bytes(len);
        if (type === 0x03 && !name) name = textOf(data).trim();
        else if (type === 0x51 && len >= 3) {
          const usPerQuarter = (data[0] << 16) | (data[1] << 8) | data[2];
          if (usPerQuarter > 0) tempos.push({ tick, bpm: 60000000 / usPerQuarter });
        } else if (type === 0x58 && len >= 2) {
          sigs.push({ tick, num: data[0] || 4, den: Math.pow(2, data[1]) || 4 });
        }
        if (type === 0x2f) break; // end of track
      } else if (status === 0xf0 || status === 0xf7) {
        r.bytes(r.vlq());
      } else {
        const cmd = status & 0xf0;
        const channel = status & 0x0f;
        if (cmd === 0x80 || cmd === 0x90) {
          const pitch = r.u8() & 0x7f;
          const vel = r.u8() & 0x7f;
          const key = (channel << 8) | pitch;
          if (cmd === 0x90 && vel > 0) {
            const list = open.get(key) ?? [];
            list.push({ tick, velocity: vel });
            open.set(key, list);
            channels.add(channel);
          } else {
            const list = open.get(key);
            const started = list?.shift();
            if (started) {
              notes.push({
                tick: started.tick,
                durTicks: Math.max(1, tick - started.tick),
                pitch,
                velocity: started.velocity,
                channel,
              });
            }
          }
        } else if (cmd === 0xa0) {
          r.bytes(2); // poly aftertouch
        } else if (cmd === 0xb0) {
          const controller = r.u8() & 0x7f;
          const value = r.u8() & 0x7f;
          ccs.push({ tick, controller, value, channel });
        } else if (cmd === 0xc0) {
          programs.push(r.u8() & 0x7f);
        } else if (cmd === 0xd0) {
          r.u8();
        } else if (cmd === 0xe0) {
          const lsb = r.u8() & 0x7f;
          const msb = r.u8() & 0x7f;
          bends.push({ tick, value: ((msb << 7) | lsb) / 8192 - 1, channel });
        } else {
          break;
        }
      }
    } catch {
      break;
    }
    lastTick = Math.max(lastTick, tick);
  }

  // Any note left hanging at end-of-track gets a nominal length rather than
  // being dropped — a hung note is a bug in the source file, not in the song.
  for (const [key, list] of open) {
    for (const started of list) {
      notes.push({
        tick: started.tick,
        durTicks: Math.max(1, lastTick - started.tick || 1),
        pitch: key & 0xff,
        velocity: started.velocity,
        channel: (key >> 8) & 0x0f,
      });
    }
    if (list.length) warnings.push('File contained notes with no note-off; lengths estimated.');
  }

  notes.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
  const chans = [...channels].sort((a, b) => a - b);
  return {
    name,
    notes,
    ccs,
    bends,
    programs,
    channels: chans,
    isDrums: chans.length > 0 && chans.every((c) => c === 9),
    lengthTicks: notes.reduce((m, n) => Math.max(m, n.tick + n.durTicks), lastTick),
  };
}

// ---------------------------------------------------------------- writing

function vlqBytes(value: number): number[] {
  const v = Math.max(0, Math.round(value));
  const out = [v & 0x7f];
  let rest = v >> 7;
  while (rest > 0) {
    out.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return out;
}

interface RawEvent {
  tick: number;
  /** lower sorts first at the same tick: meta 0, note-off 1, note-on 2 */
  order: number;
  bytes: number[];
}

function chunk(id: string, payload: number[]): number[] {
  const len = payload.length;
  return [
    ...[...id].map((c) => c.charCodeAt(0)),
    (len >>> 24) & 0xff,
    (len >>> 16) & 0xff,
    (len >>> 8) & 0xff,
    len & 0xff,
    ...payload,
  ];
}

function serialiseTrack(events: RawEvent[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const out: number[] = [];
  let last = 0;
  for (const e of events) {
    out.push(...vlqBytes(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  out.push(0x00, 0xff, 0x2f, 0x00);
  return out;
}

export interface MidiWriteTrack {
  name: string;
  channel: number;
  notes: { tick: number; durTicks: number; pitch: number; velocity: number }[];
  ccs?: { tick: number; controller: number; value: number }[];
}

export interface MidiWriteOptions {
  ppq?: number;
  tempos?: MidiTempoEvent[];
  sigs?: MidiSigEvent[];
  /** Song title, written as the sequence name on the conductor track. */
  name?: string;
}

/**
 * Write a format-1 file: a conductor track carrying tempo and signature, then
 * one MTrk per supplied track. Every DAW reads this shape.
 */
export function buildMidiFile(tracks: MidiWriteTrack[], opts: MidiWriteOptions = {}): Uint8Array {
  const ppq = Math.max(24, Math.round(opts.ppq ?? 960));
  const conductor: RawEvent[] = [];
  if (opts.name) {
    const text = [...opts.name.slice(0, 120)].map((c) => c.charCodeAt(0) & 0x7f);
    conductor.push({ tick: 0, order: 0, bytes: [0xff, 0x03, ...vlqBytes(text.length), ...text] });
  }
  for (const t of opts.tempos ?? [{ tick: 0, bpm: 120 }]) {
    const us = Math.max(1, Math.round(60000000 / Math.max(1, t.bpm)));
    conductor.push({
      tick: Math.max(0, Math.round(t.tick)),
      order: 0,
      bytes: [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff],
    });
  }
  for (const s of opts.sigs ?? [{ tick: 0, num: 4, den: 4 }]) {
    const denPow = Math.round(Math.log2(Math.max(1, s.den)));
    conductor.push({
      tick: Math.max(0, Math.round(s.tick)),
      order: 0,
      bytes: [0xff, 0x58, 0x04, Math.max(1, Math.min(32, s.num)), denPow, 24, 8],
    });
  }

  const payload: number[] = [];
  payload.push(...chunk('MTrk', serialiseTrack(conductor)));

  for (const t of tracks) {
    const evs: RawEvent[] = [];
    const text = [...(t.name || 'Track').slice(0, 120)].map((c) => c.charCodeAt(0) & 0x7f);
    evs.push({ tick: 0, order: 0, bytes: [0xff, 0x03, ...vlqBytes(text.length), ...text] });
    const ch = Math.max(0, Math.min(15, Math.round(t.channel)));
    for (const n of t.notes) {
      const tick = Math.max(0, Math.round(n.tick));
      const pitch = Math.max(0, Math.min(127, Math.round(n.pitch)));
      const vel = Math.max(1, Math.min(127, Math.round(n.velocity)));
      evs.push({ tick, order: 2, bytes: [0x90 | ch, pitch, vel] });
      evs.push({
        tick: tick + Math.max(1, Math.round(n.durTicks)),
        order: 1,
        bytes: [0x80 | ch, pitch, 0x40],
      });
    }
    for (const c of t.ccs ?? []) {
      evs.push({
        tick: Math.max(0, Math.round(c.tick)),
        order: 0,
        bytes: [
          0xb0 | ch,
          Math.max(0, Math.min(127, c.controller)),
          Math.max(0, Math.min(127, c.value)),
        ],
      });
    }
    payload.push(...chunk('MTrk', serialiseTrack(evs)));
  }

  const header = chunk('MThd', [
    0x00,
    0x01, // format 1
    ((tracks.length + 1) >> 8) & 0xff,
    (tracks.length + 1) & 0xff,
    (ppq >> 8) & 0xff,
    ppq & 0xff,
  ]);
  return new Uint8Array([...header, ...payload]);
}
