/**
 * Encoder tests.
 *
 * The FLAC half of this file contains a small independent decoder. An encoder
 * for a container format cannot be tested by inspecting the encoder's own
 * intermediate values -- the only question that matters is whether something
 * else can read the bytes back. The decoder below implements exactly the
 * subset the encoder emits (fixed predictors, Rice and escaped partitions,
 * every stereo mode) and recomputes both CRCs with a bitwise implementation
 * that shares no code with the table-driven one in the encoder.
 */
import { describe, expect, it } from 'vitest';
import { Requantizer, createRequantizers, quantizeChannel } from '../src/audio/encode/dither';
import { encodeWav, wavLayout } from '../src/audio/encode/wav';
import { encodeFlac, encodeFlacFromInt, md5Bytes } from '../src/audio/encode/flac';
import {
  AUDIO_FORMATS,
  EncodeError,
  encodeAudio,
  estimateSize,
  formatDescriptor,
} from '../src/audio/encode/index';

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/** Deterministic noise source; the encoders must not depend on Math.random. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// dither
// ---------------------------------------------------------------------------

const N = 8192;
const SINE_BIN = 101;
const LSB16 = 1 / 32768;

function quietSine(amplitudeLsb: number): Float64Array {
  const s = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    s[i] = amplitudeLsb * LSB16 * Math.sin((2 * Math.PI * SINE_BIN * i) / N);
  }
  return s;
}

/** Quantisation error in LSB units. */
function errorOf(signal: Float64Array, opts: ConstructorParameters<typeof Requantizer>[1]) {
  const q = new Requantizer(16, opts);
  const e = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i++) e[i] = q.next(signal[i]) - signal[i] * 32768;
  return e;
}

function correlation(a: Float64Array, b: Float64Array): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return ab / Math.sqrt(aa * bb);
}

function rms(a: Float64Array): number {
  let s = 0;
  for (const v of a) s += v * v;
  return Math.sqrt(s / a.length);
}

function binMagnitude(a: Float64Array, bin: number): number {
  let re = 0;
  let im = 0;
  for (let i = 0; i < a.length; i++) {
    const t = (2 * Math.PI * bin * i) / a.length;
    re += a[i] * Math.cos(t);
    im -= a[i] * Math.sin(t);
  }
  return (2 * Math.sqrt(re * re + im * im)) / a.length;
}

function bandPower(a: Float64Array, lo: number, hi: number): number {
  let p = 0;
  for (let k = lo; k < hi; k++) {
    const m = binMagnitude(a, k);
    p += m * m;
  }
  return p;
}

describe('TPDF dither', () => {
  it('decorrelates the quantisation error from the signal, which truncation does not', () => {
    const signal = quietSine(2);
    const rounded = errorOf(signal, { kind: 'none' });
    const dithered = errorOf(signal, { kind: 'tpdf', seed: 12345 });

    // Rounding a 2-LSB sine leaves an error that tracks the waveform: that is
    // distortion, and it is what a listener hears on a fade tail.
    expect(Math.abs(correlation(rounded, signal))).toBeGreaterThan(0.15);
    expect(Math.abs(correlation(dithered, signal))).toBeLessThan(0.03);
  });

  it('replaces harmonic distortion with a flat noise floor', () => {
    const signal = quietSine(2);
    const rounded = errorOf(signal, { kind: 'none' });
    const dithered = errorOf(signal, { kind: 'tpdf', seed: 999 });

    // Odd harmonics of a symmetric staircase are the audible product of
    // undithered rounding; dither pushes them below its own noise.
    expect(binMagnitude(dithered, 3 * SINE_BIN)).toBeLessThan(
      binMagnitude(rounded, 3 * SINE_BIN) / 2,
    );
    expect(binMagnitude(dithered, 5 * SINE_BIN)).toBeLessThan(
      binMagnitude(rounded, 5 * SINE_BIN) / 2,
    );
  });

  it('adds exactly the noise power TPDF dither is meant to add', () => {
    // Theory: quantiser variance LSB^2/12 plus triangular dither variance
    // LSB^2/6 gives an RMS error of exactly half an LSB.
    const e = errorOf(quietSine(8), { kind: 'tpdf', seed: 7 });
    expect(rms(e)).toBeGreaterThan(0.47);
    expect(rms(e)).toBeLessThan(0.53);
  });

  it('is reproducible under a seed and different under another', () => {
    const signal = quietSine(3);
    const a = errorOf(signal, { kind: 'tpdf', seed: 42 });
    const b = errorOf(signal, { kind: 'tpdf', seed: 42 });
    const c = errorOf(signal, { kind: 'tpdf', seed: 43 });
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it('gives each channel its own noise so the hiss does not image to the centre', () => {
    const [l, r] = createRequantizers(2, 16, { kind: 'tpdf', seed: 5 });
    const el: number[] = [];
    const er: number[] = [];
    for (let i = 0; i < 512; i++) {
      el.push(l.next(0));
      er.push(r.next(0));
    }
    expect(el).not.toEqual(er);
  });
});

describe('second-order noise shaping', () => {
  const signal = quietSine(2);
  const flat = errorOf(signal, { kind: 'tpdf', seed: 12345 });
  const shaped = errorOf(signal, { kind: 'tpdf', noiseShaping: 'second-order', seed: 12345 });

  it('moves error energy out of the low band and into the top of the spectrum', () => {
    const lowFlat = bandPower(flat, 1, N / 20);
    const lowShaped = bandPower(shaped, 1, N / 20);
    const highFlat = bandPower(flat, (N / 2) * 0.9, N / 2);
    const highShaped = bandPower(shaped, (N / 2) * 0.9, N / 2);
    expect(lowShaped).toBeLessThan(lowFlat / 50);
    expect(highShaped).toBeGreaterThan(highFlat * 5);
  });

  it('pays for that with more total noise, by the factor its transfer function predicts', () => {
    // The noise transfer function (1 - z^-1)^2 has taps 1, -2, 1, so total
    // error power grows by 1 + 4 + 1 = 6.
    expect(rms(shaped) / rms(flat)).toBeGreaterThan(Math.sqrt(6) * 0.92);
    expect(rms(shaped) / rms(flat)).toBeLessThan(Math.sqrt(6) * 1.08);
  });

  it('leaves no correlation with the signal', () => {
    expect(Math.abs(correlation(shaped, signal))).toBeLessThan(0.02);
  });
});

describe('requantisation range', () => {
  it('clamps overs to full scale rather than wrapping them', () => {
    const q = new Requantizer(16);
    expect(q.next(2)).toBe(32767);
    expect(q.next(-2)).toBe(-32768);
    expect(q.next(1)).toBe(32767);
    expect(q.next(-1)).toBe(-32768);
  });

  it('turns a non-finite sample into silence instead of a full-scale click', () => {
    const q = new Requantizer(24);
    expect(q.next(Number.NaN)).toBe(0);
    expect(q.next(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('scales to the requested depth', () => {
    expect(quantizeChannel(Float32Array.from([0.5]), 16)[0]).toBe(16384);
    expect(quantizeChannel(Float32Array.from([0.5]), 24)[0]).toBe(4194304);
  });
});

// ---------------------------------------------------------------------------
// WAV
// ---------------------------------------------------------------------------

interface RiffChunk {
  id: string;
  size: number;
  offset: number;
}

function parseRiff(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, len: number) =>
    String.fromCharCode(...Array.from(bytes.subarray(at, at + len)));
  const chunks: RiffChunk[] = [];
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = text(at, 4);
    const size = view.getUint32(at + 4, true);
    chunks.push({ id, size, offset: at + 8 });
    at += 8 + size + (size & 1);
  }
  const find = (id: string) => chunks.find((c) => c.id === id);
  return {
    riffId: text(0, 4),
    riffSize: view.getUint32(4, true),
    form: text(8, 4),
    chunks,
    find,
    view,
    text,
  };
}

function infoTags(bytes: Uint8Array): Record<string, string> {
  const riff = parseRiff(bytes);
  const list = riff.find('LIST');
  if (!list) return {};
  expect(riff.text(list.offset, 4)).toBe('INFO');
  const out: Record<string, string> = {};
  let at = list.offset + 4;
  const end = list.offset + list.size;
  while (at + 8 <= end) {
    const id = riff.text(at, 4);
    const size = riff.view.getUint32(at + 4, true);
    // The declared size includes the NUL terminator.
    out[id] = riff.text(at + 8, size - 1);
    at += 8 + size + (size & 1);
  }
  return out;
}

function ramp(frames: number, offset = 0): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = Math.sin((i + offset) * 0.05) * 0.8;
  return out;
}

describe('WAV encoder', () => {
  it('writes plain PCM for 16-bit stereo so every consumer can read it', () => {
    const frames = 100;
    const bytes = encodeWav([ramp(frames), ramp(frames, 7)], {
      sampleRate: 44100,
      format: 'int16',
    });
    const riff = parseRiff(bytes);
    expect(riff.riffId).toBe('RIFF');
    expect(riff.form).toBe('WAVE');
    expect(riff.riffSize).toBe(bytes.length - 8);

    const fmt = riff.find('fmt ')!;
    expect(fmt.size).toBe(16);
    expect(riff.view.getUint16(fmt.offset, true)).toBe(1); // WAVE_FORMAT_PCM
    expect(riff.view.getUint16(fmt.offset + 2, true)).toBe(2);
    expect(riff.view.getUint32(fmt.offset + 4, true)).toBe(44100);
    expect(riff.view.getUint32(fmt.offset + 8, true)).toBe(44100 * 4); // byte rate
    expect(riff.view.getUint16(fmt.offset + 12, true)).toBe(4); // block align
    expect(riff.view.getUint16(fmt.offset + 14, true)).toBe(16);
    expect(riff.find('fact')).toBeUndefined();

    const data = riff.find('data')!;
    expect(data.size).toBe(frames * 4);
    expect(bytes.length).toBe(44 + frames * 4);
  });

  it('round-trips 16-bit samples to within one code', () => {
    const left = ramp(64);
    const bytes = encodeWav([left], { sampleRate: 48000, format: 'int16' });
    const riff = parseRiff(bytes);
    const data = riff.find('data')!;
    for (let i = 0; i < 64; i++) {
      const code = riff.view.getInt16(data.offset + i * 2, true);
      expect(Math.abs(code / 32768 - left[i])).toBeLessThan(1 / 32768);
    }
  });

  it('switches to WAVE_FORMAT_EXTENSIBLE above 16 bits and states the valid bits', () => {
    const frames = 101; // odd, so the data chunk needs a pad byte
    const bytes = encodeWav([ramp(frames)], { sampleRate: 96000, format: 'int24' });
    const riff = parseRiff(bytes);
    const fmt = riff.find('fmt ')!;
    expect(fmt.size).toBe(40);
    expect(riff.view.getUint16(fmt.offset, true)).toBe(0xfffe);
    expect(riff.view.getUint16(fmt.offset + 14, true)).toBe(24);
    expect(riff.view.getUint16(fmt.offset + 16, true)).toBe(22); // cbSize
    expect(riff.view.getUint16(fmt.offset + 18, true)).toBe(24); // valid bits
    expect(riff.view.getUint32(fmt.offset + 20, true)).toBe(0x4); // mono: front centre
    expect(riff.view.getUint32(fmt.offset + 24, true)).toBe(1); // PCM subformat GUID

    const fact = riff.find('fact')!;
    expect(riff.view.getUint32(fact.offset, true)).toBe(frames);

    const data = riff.find('data')!;
    expect(data.size).toBe(frames * 3);
    expect(data.size % 2).toBe(1);
    // The pad byte is outside the chunk size but inside the file and the RIFF size.
    expect(bytes.length % 2).toBe(0);
    expect(riff.riffSize).toBe(bytes.length - 8);
  });

  it('round-trips 24-bit samples', () => {
    const src = ramp(50);
    const bytes = encodeWav([src], { sampleRate: 44100, format: 'int24' });
    const riff = parseRiff(bytes);
    const data = riff.find('data')!;
    for (let i = 0; i < 50; i++) {
      const o = data.offset + i * 3;
      const raw = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
      const code = raw >= 0x800000 ? raw - 0x1000000 : raw;
      expect(Math.abs(code / 8388608 - src[i])).toBeLessThan(1 / 8388608);
    }
  });

  it('stores 32-bit float exactly, including samples above full scale', () => {
    const src = Float32Array.from([0, 0.25, -0.25, 1, -1, 1.5, -1.5]);
    const bytes = encodeWav([src], { sampleRate: 44100, format: 'float32' });
    const riff = parseRiff(bytes);
    const fmt = riff.find('fmt ')!;
    expect(riff.view.getUint16(fmt.offset, true)).toBe(0xfffe);
    expect(riff.view.getUint32(fmt.offset + 24, true)).toBe(3); // IEEE float subformat
    const data = riff.find('data')!;
    for (let i = 0; i < src.length; i++) {
      expect(riff.view.getFloat32(data.offset + i * 4, true)).toBe(src[i]);
    }
  });

  it('uses extensible for more than two channels even at 16 bits', () => {
    const bytes = encodeWav([ramp(8), ramp(8, 1), ramp(8, 2)], {
      sampleRate: 44100,
      format: 'int16',
    });
    const riff = parseRiff(bytes);
    const fmt = riff.find('fmt ')!;
    expect(fmt.size).toBe(40);
    expect(riff.view.getUint16(fmt.offset, true)).toBe(0xfffe);
    expect(riff.view.getUint16(fmt.offset + 2, true)).toBe(3);
    expect(riff.view.getUint16(fmt.offset + 12, true)).toBe(6); // block align
  });

  it('writes a LIST/INFO block that a reader can walk', () => {
    const bytes = encodeWav([ramp(16)], {
      sampleRate: 44100,
      format: 'int16',
      metadata: {
        title: 'Night Drive',
        artist: 'TXPPS',
        genre: 'Electronic',
        software: 'MotionLab',
        date: '2026-08-22',
        comment: 'odd', // 3 characters plus NUL: an even chunk, no pad
      },
    });
    expect(infoTags(bytes)).toEqual({
      INAM: 'Night Drive',
      IART: 'TXPPS',
      IGNR: 'Electronic',
      ISFT: 'MotionLab',
      ICRD: '2026-08-22',
      ICMT: 'odd',
    });
    const riff = parseRiff(bytes);
    expect(riff.riffSize).toBe(bytes.length - 8);
    expect(riff.find('data')!.size).toBe(32);
  });

  it('omits the LIST block entirely when there is nothing to say', () => {
    const bytes = encodeWav([ramp(16)], { sampleRate: 44100, format: 'int16', metadata: {} });
    expect(parseRiff(bytes).find('LIST')).toBeUndefined();
    expect(bytes.length).toBe(44 + 32);
  });

  it('predicts its own size before encoding', () => {
    const opts = { sampleRate: 44100, format: 'int24' as const, metadata: { title: 'Sizing' } };
    const layout = wavLayout(2, 777, opts);
    const bytes = encodeWav([ramp(777), ramp(777, 3)], opts);
    expect(bytes.length).toBe(layout.totalBytes);
    expect(layout.dataBytes).toBe(777 * 6);
  });

  it('produces identical bytes for identical seeds and different bytes for different ones', () => {
    const src = [ramp(256)];
    const opts = { sampleRate: 44100, format: 'int16' as const };
    const a = encodeWav(src, { ...opts, dither: { kind: 'tpdf', seed: 1 } });
    const b = encodeWav(src, { ...opts, dither: { kind: 'tpdf', seed: 1 } });
    const c = encodeWav(src, { ...opts, dither: { kind: 'tpdf', seed: 2 } });
    expect(hex(a)).toBe(hex(b));
    expect(hex(a)).not.toBe(hex(c));
  });

  it('refuses channels of differing length', () => {
    expect(() => encodeWav([ramp(10), ramp(11)], { sampleRate: 44100, format: 'int16' })).toThrow(
      /differ in length/,
    );
  });
});

// ---------------------------------------------------------------------------
// FLAC: an independent decoder
// ---------------------------------------------------------------------------

/** Bitwise CRC, sharing no code with the encoder's lookup tables. */
function refCrc8(data: Uint8Array, from: number, to: number): number {
  let crc = 0;
  for (let i = from; i < to; i++) {
    crc ^= data[i];
    for (let b = 0; b < 8; b++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

function refCrc16(data: Uint8Array, from: number, to: number): number {
  let crc = 0;
  for (let i = from; i < to; i++) {
    crc ^= data[i] << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

class BitReader {
  private bit = 0;
  constructor(private readonly data: Uint8Array) {}
  seekByte(n: number): void {
    this.bit = n * 8;
  }
  get bytePos(): number {
    return this.bit >>> 3;
  }
  get aligned(): boolean {
    return (this.bit & 7) === 0;
  }
  read(bits: number): number {
    let v = 0;
    for (let i = 0; i < bits; i++) {
      if (this.bit >>> 3 >= this.data.length) throw new Error('FLAC: read past end of stream');
      const byte = this.data[this.bit >>> 3];
      v = v * 2 + ((byte >>> (7 - (this.bit & 7))) & 1);
      this.bit++;
    }
    return v;
  }
  readSigned(bits: number): number {
    const v = this.read(bits);
    const half = Math.pow(2, bits - 1);
    return v >= half ? v - 2 * half : v;
  }
  readUnary(): number {
    let q = 0;
    while (this.read(1) === 0) q++;
    return q;
  }
  align(): void {
    this.bit = (this.bit + 7) & ~7;
  }
}

interface StreamInfo {
  minBlockSize: number;
  maxBlockSize: number;
  minFrameSize: number;
  maxFrameSize: number;
  sampleRate: number;
  channels: number;
  bitDepth: number;
  totalSamples: number;
  md5: Uint8Array;
}

interface SubframeSummary {
  type: string;
  order: number;
  residual?: ResidualInfo;
}

interface FrameInfo {
  blockSize: number;
  byteLength: number;
  assignment: number;
  frameNumber: number;
  sampleRate: number;
  bitDepth: number;
  subframes: SubframeSummary[];
}

interface DecodedStream {
  info: StreamInfo;
  vendor: string;
  comments: string[];
  frames: FrameInfo[];
  channels: Int32Array[];
}

const FLAC_BLOCK_SIZES = [
  0, 192, 576, 1152, 2304, 4608, -1, -1, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768,
];
const FLAC_RATES = [
  0, 88200, 176400, 192000, 8000, 16000, 22050, 24000, 32000, 44100, 48000, 96000,
];
const FLAC_DEPTHS: Record<number, number> = { 1: 8, 2: 12, 4: 16, 5: 20, 6: 24 };

function readUtf8Number(r: BitReader): number {
  const b0 = r.read(8);
  if (b0 < 0x80) return b0;
  const shapes: [number, number, number][] = [
    [0xe0, 0xc0, 1],
    [0xf0, 0xe0, 2],
    [0xf8, 0xf0, 3],
    [0xfc, 0xf8, 4],
    [0xfe, 0xfc, 5],
  ];
  const shape = shapes.find(([mask, tag]) => (b0 & mask) === tag);
  if (!shape) throw new Error('FLAC: malformed frame number');
  let v = b0 & (0xff >> (shape[2] + 2));
  for (let i = 0; i < shape[2]; i++) {
    const b = r.read(8);
    if ((b & 0xc0) !== 0x80) throw new Error('FLAC: malformed frame number continuation');
    v = v * 64 + (b & 0x3f);
  }
  return v;
}

interface ResidualInfo {
  method: number;
  partitionOrder: number;
  escaped: number;
  maxParam: number;
}

function decodeResidual(
  r: BitReader,
  x: Int32Array,
  blockSize: number,
  order: number,
): ResidualInfo {
  const method = r.read(2);
  if (method > 1) throw new Error(`FLAC: reserved residual method ${method}`);
  const partOrder = r.read(4);
  const parts = 1 << partOrder;
  const per = blockSize >> partOrder;
  const paramBits = method === 0 ? 4 : 5;
  const escape = method === 0 ? 0xf : 0x1f;
  let at = order;
  let escaped = 0;
  let maxParam = -1;
  for (let p = 0; p < parts; p++) {
    const count = p === 0 ? per - order : per;
    const param = r.read(paramBits);
    if (param === escape) {
      escaped++;
      const raw = r.read(5);
      for (let i = 0; i < count; i++) x[at++] = raw === 0 ? 0 : r.readSigned(raw);
    } else {
      if (param > maxParam) maxParam = param;
      const div = Math.pow(2, param);
      for (let i = 0; i < count; i++) {
        const u = r.readUnary() * div + (param > 0 ? r.read(param) : 0);
        x[at++] = u % 2 === 0 ? u / 2 : -(u + 1) / 2;
      }
    }
  }
  if (at !== blockSize) throw new Error('FLAC: residual length mismatch');
  return { method, partitionOrder: partOrder, escaped, maxParam };
}

function decodeSubframe(
  r: BitReader,
  blockSize: number,
  bps: number,
): { samples: Int32Array; info: SubframeSummary } {
  if (r.read(1) !== 0) throw new Error('FLAC: subframe padding bit set');
  const type = r.read(6);
  let wasted = 0;
  if (r.read(1) === 1) wasted = r.readUnary() + 1;
  const eff = bps - wasted;
  const x = new Int32Array(blockSize);
  let info: SubframeSummary;

  if (type === 0) {
    x.fill(r.readSigned(eff));
    info = { type: 'constant', order: 0 };
  } else if (type === 1) {
    for (let i = 0; i < blockSize; i++) x[i] = r.readSigned(eff);
    info = { type: 'verbatim', order: 0 };
  } else if (type >= 8 && type <= 12) {
    const order = type - 8;
    for (let i = 0; i < order; i++) x[i] = r.readSigned(eff);
    const residual = decodeResidual(r, x, blockSize, order);
    for (let i = order; i < blockSize; i++) {
      switch (order) {
        case 1:
          x[i] += x[i - 1];
          break;
        case 2:
          x[i] += 2 * x[i - 1] - x[i - 2];
          break;
        case 3:
          x[i] += 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3];
          break;
        case 4:
          x[i] += 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4];
          break;
        default:
          break;
      }
    }
    info = { type: 'fixed', order, residual };
  } else {
    throw new Error(`FLAC: unsupported subframe type ${type}`);
  }

  if (wasted > 0) for (let i = 0; i < blockSize; i++) x[i] *= Math.pow(2, wasted);
  return { samples: x, info };
}

function decodeFlac(bytes: Uint8Array): DecodedStream {
  if (String.fromCharCode(...Array.from(bytes.subarray(0, 4))) !== 'fLaC') {
    throw new Error('FLAC: missing stream marker');
  }
  let at = 4;
  let last = false;
  let info: StreamInfo | null = null;
  let vendor = '';
  const comments: string[] = [];

  while (!last) {
    const head = bytes[at];
    last = (head & 0x80) !== 0;
    const type = head & 0x7f;
    const len = (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];
    const body = bytes.subarray(at + 4, at + 4 + len);
    if (type === 0) {
      if (len !== 34) throw new Error('FLAC: STREAMINFO must be 34 bytes');
      const r = new BitReader(body);
      info = {
        minBlockSize: r.read(16),
        maxBlockSize: r.read(16),
        minFrameSize: r.read(24),
        maxFrameSize: r.read(24),
        sampleRate: r.read(20),
        channels: r.read(3) + 1,
        bitDepth: r.read(5) + 1,
        totalSamples: r.read(36),
        md5: body.slice(18, 34),
      };
    } else if (type === 4) {
      const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
      const decode = (o: number, n: number) => new TextDecoder().decode(body.subarray(o, o + n));
      const vlen = view.getUint32(0, true);
      vendor = decode(4, vlen);
      let o = 4 + vlen;
      const count = view.getUint32(o, true);
      o += 4;
      for (let i = 0; i < count; i++) {
        const clen = view.getUint32(o, true);
        comments.push(decode(o + 4, clen));
        o += 4 + clen;
      }
    }
    at += 4 + len;
  }
  if (!info) throw new Error('FLAC: no STREAMINFO');

  const out: Int32Array[] = [];
  for (let c = 0; c < info.channels; c++) out.push(new Int32Array(info.totalSamples));
  const frames: FrameInfo[] = [];
  let written = 0;

  while (at < bytes.length) {
    const start = at;
    const r = new BitReader(bytes);
    r.seekByte(at);
    if (r.read(14) !== 0x3ffe) throw new Error('FLAC: lost frame sync');
    r.read(1);
    r.read(1); // blocking strategy
    const bsCode = r.read(4);
    const srCode = r.read(4);
    const assignment = r.read(4);
    const ssCode = r.read(3);
    r.read(1);
    const frameNumber = readUtf8Number(r);

    let blockSize = FLAC_BLOCK_SIZES[bsCode];
    if (bsCode === 6) blockSize = r.read(8) + 1;
    else if (bsCode === 7) blockSize = r.read(16) + 1;
    if (blockSize <= 0) throw new Error(`FLAC: bad block size code ${bsCode}`);

    let sampleRate = srCode === 0 ? info.sampleRate : (FLAC_RATES[srCode] ?? 0);
    if (srCode === 12) sampleRate = r.read(8) * 1000;
    else if (srCode === 13) sampleRate = r.read(16);
    else if (srCode === 14) sampleRate = r.read(16) * 10;

    const bitDepth = ssCode === 0 ? info.bitDepth : FLAC_DEPTHS[ssCode];
    if (!bitDepth) throw new Error(`FLAC: bad sample size code ${ssCode}`);
    if (!r.aligned) throw new Error('FLAC: frame header is not byte aligned');

    const headerEnd = r.bytePos;
    if (r.read(8) !== refCrc8(bytes, start, headerEnd)) {
      throw new Error('FLAC: frame header CRC-8 mismatch');
    }

    const subCount = assignment < 8 ? assignment + 1 : 2;
    const decoded: Int32Array[] = [];
    const subInfo: SubframeSummary[] = [];
    for (let s = 0; s < subCount; s++) {
      // The side channel of a decorrelated pair carries one extra bit.
      const extra =
        (assignment === 8 && s === 1) ||
        (assignment === 9 && s === 0) ||
        (assignment === 10 && s === 1)
          ? 1
          : 0;
      const sf = decodeSubframe(r, blockSize, bitDepth + extra);
      decoded.push(sf.samples);
      subInfo.push(sf.info);
    }

    r.align();
    const frameEnd = r.bytePos;
    if (r.read(16) !== refCrc16(bytes, start, frameEnd)) {
      throw new Error('FLAC: frame CRC-16 mismatch');
    }
    at = r.bytePos;

    let chans: Int32Array[] = decoded;
    if (assignment === 8) {
      const l = decoded[0];
      const rr = new Int32Array(blockSize);
      for (let i = 0; i < blockSize; i++) rr[i] = l[i] - decoded[1][i];
      chans = [l, rr];
    } else if (assignment === 9) {
      const rr = decoded[1];
      const l = new Int32Array(blockSize);
      for (let i = 0; i < blockSize; i++) l[i] = rr[i] + decoded[0][i];
      chans = [l, rr];
    } else if (assignment === 10) {
      const l = new Int32Array(blockSize);
      const rr = new Int32Array(blockSize);
      for (let i = 0; i < blockSize; i++) {
        const side = decoded[1][i];
        const sum = 2 * decoded[0][i] + (side & 1);
        l[i] = (sum + side) >> 1;
        rr[i] = l[i] - side;
      }
      chans = [l, rr];
    }

    for (let c = 0; c < chans.length; c++) out[c].set(chans[c].subarray(0, blockSize), written);
    written += blockSize;
    frames.push({
      blockSize,
      byteLength: at - start,
      assignment,
      frameNumber,
      sampleRate,
      bitDepth,
      subframes: subInfo,
    });
  }

  if (written !== info.totalSamples) {
    throw new Error(`FLAC: decoded ${written} samples, STREAMINFO says ${info.totalSamples}`);
  }
  return { info, vendor, comments, frames, channels: out };
}

/** Interleaved little-endian bytes, which is what STREAMINFO's MD5 covers. */
function interleave(channels: Int32Array[], bitDepth: number): Uint8Array {
  const bytesPer = bitDepth / 8;
  const out = new Uint8Array(channels[0].length * channels.length * bytesPer);
  let at = 0;
  for (let i = 0; i < channels[0].length; i++) {
    for (const ch of channels) {
      const v = ch[i];
      out[at] = v & 0xff;
      out[at + 1] = (v >> 8) & 0xff;
      if (bytesPer === 3) out[at + 2] = (v >> 16) & 0xff;
      at += bytesPer;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// FLAC: signals
// ---------------------------------------------------------------------------

const FRAMES = 5000; // one full 4096 block plus a short final one
const MAX16 = 32767;
const MIN16 = -32768;

function silence(n = FRAMES): Int32Array {
  return new Int32Array(n);
}

function square(n = FRAMES): Int32Array {
  const x = new Int32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.floor(i / 64) % 2 === 0 ? MAX16 : MIN16;
  return x;
}

function sine(n = FRAMES, amp = 30000, period = 137): Int32Array {
  const x = new Int32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.round(amp * Math.sin((2 * Math.PI * i) / period));
  return x;
}

function noise(seed: number, n = FRAMES, span = 32768): Int32Array {
  const rnd = prng(seed);
  const x = new Int32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.floor(rnd() * 2 * span) - span;
  return x;
}

function alternating(n = FRAMES): Int32Array {
  const x = new Int32Array(n);
  for (let i = 0; i < n; i++) x[i] = i % 2 === 0 ? MAX16 : MIN16;
  return x;
}

function expectRoundTrip(channels: Int32Array[], bitDepth: 16 | 24, sampleRate = 44100) {
  const { parts, totalBytes, md5 } = encodeFlacFromInt(channels, { sampleRate, bitDepth });
  const bytes = new Uint8Array(totalBytes);
  let off = 0;
  for (const p of parts) {
    bytes.set(p, off);
    off += p.length;
  }
  const decoded = decodeFlac(bytes);
  for (let c = 0; c < channels.length; c++) {
    expect(Array.from(decoded.channels[c])).toEqual(Array.from(channels[c]));
  }
  expect(hex(decoded.info.md5)).toBe(hex(md5));
  expect(hex(decoded.info.md5)).toBe(hex(md5Bytes(interleave(channels, bitDepth))));
  return { decoded, bytes };
}

describe('MD5 (STREAMINFO hash)', () => {
  it('matches the RFC 1321 test vectors', () => {
    expect(hex(md5Bytes(new Uint8Array(0)))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(hex(md5Bytes(ascii('abc')))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(hex(md5Bytes(ascii('message digest')))).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(hex(md5Bytes(ascii('abcdefghijklmnopqrstuvwxyz')))).toBe(
      'c3fcd3d76192e4007dfb496cca67e13b',
    );
    // 80 bytes: forces a second block, with the length padding in that block.
    const eighty = '1234567890'.repeat(8);
    expect(hex(md5Bytes(ascii(eighty)))).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });
});

describe('FLAC encoder', () => {
  it('round-trips silence and codes it as constant subframes', () => {
    const { decoded } = expectRoundTrip([silence(), silence()], 16);
    for (const f of decoded.frames) {
      for (const s of f.subframes) expect(s.type).toBe('constant');
    }
  });

  it('round-trips a full-scale square wave', () => {
    expectRoundTrip([square()], 16);
  });

  it('round-trips a sine and actually compresses it', () => {
    const { bytes } = expectRoundTrip([sine(), sine(FRAMES, 24000, 91)], 16);
    expect(bytes.length).toBeLessThan(FRAMES * 2 * 2 * 0.9);
  });

  it('round-trips white noise, where compression cannot help', () => {
    expectRoundTrip([noise(1), noise(2)], 16);
  });

  it('round-trips alternating full-scale samples', () => {
    expectRoundTrip([alternating()], 16);
  });

  it('round-trips 24-bit material', () => {
    const a = sine(FRAMES, 8000000, 211);
    const b = noise(9, FRAMES, 8388608);
    expectRoundTrip([a, b], 24);
    expectRoundTrip([new Int32Array(FRAMES).fill(-8388608)], 24);
  });

  it('round-trips mono, and multichannel beyond a stereo pair', () => {
    expectRoundTrip([sine()], 16);
    const six = [sine(), noise(3), square(), silence(), sine(FRAMES, 12000, 53), noise(4)];
    const { decoded } = expectRoundTrip(six, 16);
    expect(decoded.info.channels).toBe(6);
    for (const f of decoded.frames) expect(f.assignment).toBe(5); // 6 independent channels
  });

  it('handles a stream with no samples at all', () => {
    const { decoded } = expectRoundTrip([new Int32Array(0)], 16);
    expect(decoded.info.totalSamples).toBe(0);
    expect(decoded.frames).toHaveLength(0);
  });

  it('handles a stream shorter than one block', () => {
    const { decoded } = expectRoundTrip([sine(37), sine(37, 12000, 11)], 16);
    expect(decoded.frames).toHaveLength(1);
    expect(decoded.frames[0].blockSize).toBe(37);
  });

  it('reports STREAMINFO fields that match the frames it wrote', () => {
    const { decoded, bytes } = expectRoundTrip([sine(), sine(FRAMES, 9000, 67)], 16, 48000);
    const info = decoded.info;
    expect(info.sampleRate).toBe(48000);
    expect(info.channels).toBe(2);
    expect(info.bitDepth).toBe(16);
    expect(info.totalSamples).toBe(FRAMES);
    expect(info.minBlockSize).toBe(FRAMES - 4096);
    expect(info.maxBlockSize).toBe(4096);

    expect(decoded.frames.map((f) => f.blockSize)).toEqual([4096, FRAMES - 4096]);
    expect(decoded.frames.map((f) => f.frameNumber)).toEqual([0, 1]);

    // The declared frame sizes are checked against the frames as they sit in
    // the byte stream, measured by the decoder rather than reported by the
    // encoder.
    const measured = decoded.frames.map((f) => f.byteLength);
    expect(info.minFrameSize).toBe(Math.min(...measured));
    expect(info.maxFrameSize).toBe(Math.max(...measured));
    expect(framesStartOffset(bytes) + measured[0] + measured[1]).toBe(bytes.length);
  });

  it('carries an unusual sample rate in the frame header', () => {
    const { decoded } = expectRoundTrip([sine(1000)], 16, 37000);
    expect(decoded.info.sampleRate).toBe(37000);
    for (const f of decoded.frames) expect(f.sampleRate).toBe(37000);
  });

  it('decorrelates a correlated stereo pair and leaves an uncorrelated one alone', () => {
    const l = sine();
    const r = new Int32Array(FRAMES);
    for (let i = 0; i < FRAMES; i++) r[i] = Math.round(l[i] * 0.97) + (i % 3);
    const correlated = expectRoundTrip([l, r], 16);
    for (const f of correlated.decoded.frames) expect(f.assignment).toBeGreaterThanOrEqual(8);

    const independent = expectRoundTrip([noise(11), noise(12)], 16);
    for (const f of independent.decoded.frames) expect(f.assignment).toBe(1);
  });

  it('beats independent coding on the correlated pair', () => {
    const l = sine();
    const r = new Int32Array(FRAMES);
    for (let i = 0; i < FRAMES; i++) r[i] = Math.round(l[i] * 0.97) + (i % 3);
    const together = encodeFlacFromInt([l, r], { sampleRate: 44100, bitDepth: 16 }).totalBytes;
    const apart =
      encodeFlacFromInt([l], { sampleRate: 44100, bitDepth: 16 }).totalBytes +
      encodeFlacFromInt([r], { sampleRate: 44100, bitDepth: 16 }).totalBytes;
    expect(together).toBeLessThan(apart);
  });

  it('detects a corrupted frame through the CRCs it wrote', () => {
    const { bytes } = expectRoundTrip([sine(1024)], 16);
    const damaged = bytes.slice();
    // Well past the metadata blocks, inside the first frame's subframe data.
    damaged[damaged.length - 8] ^= 0x40;
    expect(() => decodeFlac(damaged)).toThrow(/CRC-16/);

    const headerDamaged = bytes.slice();
    // The frame-number byte: still a legal header, so the CRC-8 is what catches it.
    headerDamaged[framesStartOffset(bytes) + 4] ^= 0x01;
    expect(() => decodeFlac(headerDamaged)).toThrow(/CRC-8/);
  });

  it('writes tags a Vorbis comment reader can find', () => {
    const { parts, totalBytes } = encodeFlacFromInt([sine(512)], {
      sampleRate: 44100,
      bitDepth: 16,
      metadata: { title: 'Néon', artist: 'TXPPS', genre: 'Ambient', software: 'MotionLab 1.0' },
    });
    const bytes = new Uint8Array(totalBytes);
    let off = 0;
    for (const p of parts) {
      bytes.set(p, off);
      off += p.length;
    }
    const decoded = decodeFlac(bytes);
    expect(decoded.vendor).toBe('MotionLab 1.0');
    expect(decoded.comments).toContain('TITLE=Néon');
    expect(decoded.comments).toContain('ARTIST=TXPPS');
    expect(decoded.comments).toContain('GENRE=Ambient');
  });

  it('encodes from floats and stays lossless against its own requantisation', () => {
    const src = new Float32Array(3000);
    for (let i = 0; i < src.length; i++) src[i] = 0.7 * Math.sin(i * 0.031) + 0.1 * Math.sin(i);
    const bytes = encodeFlac([src], { sampleRate: 44100, bitDepth: 16 });
    const decoded = decodeFlac(bytes);
    const expected = quantizeChannel(src, 16);
    expect(Array.from(decoded.channels[0])).toEqual(Array.from(expected));
  });

  it('rejects depths and channel counts the format cannot carry', () => {
    expect(() =>
      encodeFlacFromInt([sine(64)], { sampleRate: 44100, bitDepth: 32 as unknown as 16 }),
    ).toThrow(/bit depth/);
    const many = Array.from({ length: 9 }, () => sine(64));
    expect(() => encodeFlacFromInt(many, { sampleRate: 44100, bitDepth: 16 })).toThrow(/channels/);
  });
});

describe('FLAC residual coding paths', () => {
  function allResiduals(frames: FrameInfo[]): ResidualInfo[] {
    return frames.flatMap((f) => f.subframes.flatMap((s) => (s.residual ? [s.residual] : [])));
  }

  it('escapes partitions that Rice coding would code badly', () => {
    // Long silent runs with rare impulses: whole partitions are zero, where the
    // escape form costs five bits and Rice costs one bit per sample.
    const x = new Int32Array(FRAMES);
    for (let i = 0; i < FRAMES; i += 500) x[i] = i % 1000 === 0 ? 30000 : -30000;
    const { decoded } = expectRoundTrip([x], 16);
    const escaped = allResiduals(decoded.frames).reduce((n, r) => n + r.escaped, 0);
    expect(escaped).toBeGreaterThan(0);
  });

  it('splits the residual into partitions when the signal is not stationary', () => {
    // Quiet for half the block, loud for the other half: one Rice parameter for
    // the whole frame would be wrong for both halves.
    const x = new Int32Array(FRAMES);
    for (let i = 0; i < FRAMES; i++) {
      const amp = i % 2048 < 1024 ? 40 : 28000;
      x[i] = Math.round(amp * Math.sin((2 * Math.PI * i) / 97));
    }
    const { decoded } = expectRoundTrip([x], 16);
    const orders = allResiduals(decoded.frames).map((r) => r.partitionOrder);
    expect(Math.max(...orders)).toBeGreaterThan(0);
  });

  it('switches to five-bit Rice parameters when the residual is large', () => {
    // Gaussian-ish noise: the peaks are far above the mean, so Rice coding
    // (which pays for the mean) beats the escape form (which pays for the
    // peak). The parameter lands around 18, past what four bits can express.
    const rnd = prng(21);
    const x = new Int32Array(FRAMES);
    for (let i = 0; i < FRAMES; i++) {
      let g = 0;
      for (let k = 0; k < 12; k++) g += rnd();
      x[i] = Math.round((g - 6) * 131072);
    }
    const { decoded } = expectRoundTrip([x], 24);
    const methods = allResiduals(decoded.frames).map((r) => r.method);
    expect(methods).toContain(1);
    expect(Math.max(...allResiduals(decoded.frames).map((r) => r.maxParam))).toBeGreaterThan(14);
  });

  it('falls back to verbatim when nothing predicts the signal', () => {
    // Full-range noise at the very top of the 24-bit range leaves residuals as
    // wide as the samples, so raw storage can win.
    const x = new Int32Array(2048);
    const rnd = prng(31);
    for (let i = 0; i < x.length; i++) x[i] = Math.floor(rnd() * 16777216) - 8388608;
    const { decoded } = expectRoundTrip([x], 24);
    const kinds = decoded.frames.flatMap((f) => f.subframes.map((s) => s.type));
    expect(kinds).toContain('verbatim');
  });

  it('round-trips randomised material across depths, lengths and channel counts', () => {
    const rnd = prng(2026);
    for (let trial = 0; trial < 24; trial++) {
      const bitDepth = trial % 2 === 0 ? 16 : 24;
      const full = bitDepth === 16 ? 32768 : 8388608;
      const channelCount = 1 + Math.floor(rnd() * 3);
      const length = 1 + Math.floor(rnd() * 9000);
      // Amplitudes from a couple of LSB up to full scale, so every Rice
      // parameter range and both partition strategies get used.
      const amp = Math.max(2, Math.floor(full * Math.pow(rnd(), 3)));
      const chans: Int32Array[] = [];
      for (let c = 0; c < channelCount; c++) {
        const x = new Int32Array(length);
        const period = 3 + Math.floor(rnd() * 400);
        for (let i = 0; i < length; i++) {
          const tone = amp * Math.sin((2 * Math.PI * i) / period);
          const grit = (rnd() - 0.5) * amp * 0.4;
          x[i] = Math.max(-full, Math.min(full - 1, Math.round(tone + grit)));
        }
        chans.push(x);
      }
      expectRoundTrip(chans, bitDepth, 44100);
    }
  });
});

/** First byte after the metadata blocks, used to size the frame region. */
function framesStartOffset(bytes: Uint8Array): number {
  let at = 4;
  for (;;) {
    const head = bytes[at];
    const len = (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];
    at += 4 + len;
    if (head & 0x80) return at;
  }
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

describe('encodeAudio', () => {
  const mix = [ramp(1000), ramp(1000, 5)];

  it('produces a WAV blob whose size is exactly what estimateSize predicted', () => {
    const opts = { format: 'wav' as const, sampleRate: 44100, bitDepth: 24 as const };
    const out = encodeAudio(mix, opts);
    expect(out.ext).toBe('wav');
    expect(out.mime).toBe('audio/wav');
    expect(out.blob.type).toBe('audio/wav');
    expect(out.bytes).toBe(estimateSize(1000, 2, opts));
    expect(out.blob.size).toBe(out.bytes);
  });

  it('produces a FLAC blob smaller than the equivalent WAV', () => {
    const opts = { format: 'flac' as const, sampleRate: 44100, bitDepth: 16 as const };
    const out = encodeAudio(mix, opts);
    expect(out.ext).toBe('flac');
    expect(out.mime).toBe('audio/flac');
    expect(out.blob.size).toBe(out.bytes);
    const wav = encodeAudio(mix, { format: 'wav', sampleRate: 44100, bitDepth: 16 });
    expect(out.bytes).toBeLessThan(wav.bytes);
  });

  it('estimates a FLAC file as smaller than the raw samples but not by magic', () => {
    const raw = 1000 * 2 * 2;
    const est = estimateSize(1000, 2, { format: 'flac', sampleRate: 44100, bitDepth: 16 });
    expect(est).toBeLessThan(raw);
    expect(est).toBeGreaterThan(raw / 3);
  });

  it('rejects combinations the format cannot express, with a message that says why', () => {
    expect(() => encodeAudio(mix, { format: 'flac', sampleRate: 44100, bitDepth: 32 })).toThrow(
      EncodeError,
    );
    expect(() => encodeAudio(mix, { format: 'flac', sampleRate: 44100, bitDepth: 32 })).toThrow(
      /16, 24-bit/,
    );
    expect(() =>
      encodeAudio(mix, { format: 'wav', sampleRate: 44100, bitDepth: 16, float: true }),
    ).toThrow(/32-bit only/);
    expect(() =>
      encodeAudio(mix, { format: 'flac', sampleRate: 44100, bitDepth: 24, float: true }),
    ).toThrow(/floating-point/i);
    expect(() => encodeAudio([], { format: 'wav', sampleRate: 44100, bitDepth: 16 })).toThrow(
      /no channels/,
    );
  });

  it('describes every format it offers', () => {
    expect(AUDIO_FORMATS.length).toBeGreaterThan(1);
    for (const f of AUDIO_FORMATS) {
      expect(f.description.length).toBeGreaterThan(20);
      expect(f.bitDepths.length).toBeGreaterThan(0);
      expect(formatDescriptor(f.id)).toBe(f);
    }
    expect(formatDescriptor('flac').compressed).toBe(true);
    expect(formatDescriptor('wav').compressed).toBe(false);
    expect(() => formatDescriptor('mp3' as 'wav')).toThrow(/Unknown export format/);
  });

  it('applies dither through the entry point reproducibly', () => {
    const opts = {
      format: 'wav' as const,
      sampleRate: 44100,
      bitDepth: 16 as const,
      dither: { kind: 'tpdf' as const, seed: 77 },
    };
    expect(encodeAudio(mix, opts).bytes).toBe(encodeAudio(mix, opts).bytes);
  });
});
