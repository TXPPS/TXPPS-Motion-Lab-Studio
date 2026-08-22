/**
 * RIFF/WAVE encoder.
 *
 * Covers what an export dialog needs to offer: 16, 24 and 32-bit integer PCM
 * plus 32-bit float, any channel count, any sample rate, and an optional
 * LIST/INFO tag block.
 *
 * Two deliberate rules about the header:
 *
 *  - Plain WAVE_FORMAT_PCM is used whenever it is legal (16-bit, one or two
 *    channels), because the widest possible set of consumers -- phones, car
 *    stereos, old samplers -- reads that and nothing else reliably.
 *  - Above 16 bits or above two channels the format tag becomes
 *    WAVE_FORMAT_EXTENSIBLE, which is what the specification requires and what
 *    tells a reader unambiguously how many of the container's bits are valid
 *    and which speaker each channel feeds.
 *
 * Output is produced as a list of byte blocks rather than one buffer: the
 * caller hands the list straight to a Blob or a writable stream, so a long
 * export never needs a second full-size copy of itself in memory. Nothing here
 * touches the DOM, so it can be moved into a worker unchanged.
 */
import { createRequantizers, type DitherOptions } from './dither';

export type WavSampleFormat = 'int16' | 'int24' | 'int32' | 'float32';

/** RIFF INFO tags. Values are written as Latin-1, which is what readers expect. */
export interface WavMetadata {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  comment?: string;
  software?: string;
  /** Free-form; ISO 8601 (YYYY-MM-DD) is the conventional choice. */
  date?: string;
}

export interface WavEncodeOptions {
  sampleRate: number;
  format: WavSampleFormat;
  metadata?: WavMetadata;
  /** Ignored for 'float32', which is exact and needs no dither. */
  dither?: DitherOptions;
  /** Frames per emitted block. Larger blocks mean fewer, bigger allocations. */
  blockFrames?: number;
}

const DEFAULT_BLOCK_FRAMES = 16384;

const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

/** Trailing 14 bytes shared by both subformat GUIDs. */
const GUID_TAIL = [0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];

const INFO_TAGS: ReadonlyArray<readonly [keyof WavMetadata, string]> = [
  ['title', 'INAM'],
  ['artist', 'IART'],
  ['album', 'IPRD'],
  ['genre', 'IGNR'],
  ['comment', 'ICMT'],
  ['software', 'ISFT'],
  ['date', 'ICRD'],
];

export function bytesPerSample(format: WavSampleFormat): number {
  switch (format) {
    case 'int16':
      return 2;
    case 'int24':
      return 3;
    default:
      return 4;
  }
}

export function bitsPerSample(format: WavSampleFormat): number {
  return bytesPerSample(format) * 8;
}

/**
 * Standard speaker masks. Unusual channel counts get a zero mask, which means
 * "no assignment stated" rather than a wrong one.
 */
function channelMask(channels: number): number {
  switch (channels) {
    case 1:
      return 0x4; // FRONT_CENTER
    case 2:
      return 0x3; // FRONT_LEFT | FRONT_RIGHT
    case 4:
      return 0x33; // quad
    case 6:
      return 0x3f; // 5.1
    case 8:
      return 0x63f; // 7.1
    default:
      return 0;
  }
}

function needsExtensible(format: WavSampleFormat, channels: number): boolean {
  return bitsPerSample(format) > 16 || channels > 2;
}

/** Latin-1: RIFF INFO predates Unicode and readers assume single-byte text. */
function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[i] = code < 0x100 ? code : 0x3f;
  }
  return out;
}

interface InfoEntry {
  id: string;
  bytes: Uint8Array;
}

function infoEntries(meta: WavMetadata | undefined): InfoEntry[] {
  if (!meta) return [];
  const out: InfoEntry[] = [];
  for (const [key, id] of INFO_TAGS) {
    const value = meta[key];
    if (typeof value !== 'string' || value.length === 0) continue;
    out.push({ id, bytes: latin1(value) });
  }
  return out;
}

/**
 * Size of a LIST/INFO chunk including its own 8-byte header, or 0 when there
 * is nothing to write. Each entry carries a NUL terminator inside its declared
 * size and is padded to an even length, as RIFF requires.
 */
function infoChunkSize(entries: InfoEntry[]): number {
  if (entries.length === 0) return 0;
  let size = 4; // the 'INFO' form type
  for (const e of entries) {
    const len = e.bytes.length + 1;
    size += 8 + len + (len & 1);
  }
  return 8 + size;
}

class ByteWriter {
  private readonly view: DataView;
  private pos = 0;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  ascii(text: string): void {
    for (let i = 0; i < text.length; i++) this.bytes[this.pos++] = text.charCodeAt(i) & 0xff;
  }
  u16(value: number): void {
    this.view.setUint16(this.pos, value, true);
    this.pos += 2;
  }
  u32(value: number): void {
    this.view.setUint32(this.pos, value >>> 0, true);
    this.pos += 4;
  }
  raw(data: ArrayLike<number>): void {
    for (let i = 0; i < data.length; i++) this.bytes[this.pos++] = data[i];
  }
  zeros(count: number): void {
    this.pos += count;
  }
  get offset(): number {
    return this.pos;
  }
}

export interface WavLayout {
  channels: number;
  frames: number;
  blockAlign: number;
  dataBytes: number;
  headerBytes: number;
  /** Whole file, including the pad byte after an odd-length data chunk. */
  totalBytes: number;
}

/**
 * Work out every size in the file without touching the samples, so an export
 * dialog can show the resulting file size before the render happens.
 */
export function wavLayout(
  channels: number,
  frames: number,
  opts: Pick<WavEncodeOptions, 'format' | 'metadata'>,
): WavLayout {
  const blockAlign = channels * bytesPerSample(opts.format);
  const dataBytes = frames * blockAlign;
  const extensible = needsExtensible(opts.format, channels);
  const isFloat = opts.format === 'float32';
  const fmtBody = extensible ? 40 : 16;
  // A 'fact' chunk is mandatory for every non-PCM tag and is what a reader
  // consults for the true sample count when the format is compressed.
  const factBytes = extensible || isFloat ? 12 : 0;
  const headerBytes =
    12 + (8 + fmtBody) + factBytes + infoChunkSize(infoEntries(opts.metadata)) + 8;
  return {
    channels,
    frames,
    blockAlign,
    dataBytes,
    headerBytes,
    totalBytes: headerBytes + dataBytes + (dataBytes & 1),
  };
}

function writeHeader(layout: WavLayout, opts: WavEncodeOptions): Uint8Array {
  const { channels, frames, blockAlign, dataBytes } = layout;
  const extensible = needsExtensible(opts.format, channels);
  const isFloat = opts.format === 'float32';
  const bits = bitsPerSample(opts.format);
  const entries = infoEntries(opts.metadata);
  const infoBytes = infoChunkSize(entries);

  const bytes = new Uint8Array(layout.headerBytes);
  const w = new ByteWriter(bytes);

  w.ascii('RIFF');
  // Everything after this field: the WAVE form type, all chunks, the data and
  // its pad byte.
  w.u32(layout.totalBytes - 8);
  w.ascii('WAVE');

  w.ascii('fmt ');
  w.u32(extensible ? 40 : 16);
  w.u16(extensible ? WAVE_FORMAT_EXTENSIBLE : isFloat ? WAVE_FORMAT_IEEE_FLOAT : WAVE_FORMAT_PCM);
  w.u16(channels);
  w.u32(opts.sampleRate);
  w.u32(opts.sampleRate * blockAlign);
  w.u16(blockAlign);
  w.u16(bits);
  if (extensible) {
    w.u16(22); // cbSize
    w.u16(bits); // every container bit is valid; no left-justified padding
    w.u32(channelMask(channels));
    w.u32(isFloat ? WAVE_FORMAT_IEEE_FLOAT : WAVE_FORMAT_PCM);
    w.raw(GUID_TAIL);
  }

  if (extensible || isFloat) {
    w.ascii('fact');
    w.u32(4);
    w.u32(frames);
  }

  if (infoBytes > 0) {
    w.ascii('LIST');
    w.u32(infoBytes - 8);
    w.ascii('INFO');
    for (const e of entries) {
      const len = e.bytes.length + 1;
      w.ascii(e.id);
      w.u32(len);
      w.raw(e.bytes);
      w.zeros(1 + (len & 1)); // NUL terminator, then the RIFF pad byte
    }
  }

  w.ascii('data');
  w.u32(dataBytes);
  if (w.offset !== bytes.length) {
    throw new Error(`WAV header size mismatch: wrote ${w.offset} of ${bytes.length}`);
  }
  return bytes;
}

function checkChannels(channels: Float32Array[]): { count: number; frames: number } {
  if (channels.length === 0) throw new RangeError('WAV export needs at least one channel.');
  const frames = channels[0].length;
  for (const ch of channels) {
    if (ch.length !== frames) throw new RangeError('WAV export channels differ in length.');
  }
  return { count: channels.length, frames };
}

/**
 * Encode to a list of byte blocks: header first, then the sample data in
 * blocks of `blockFrames`.
 *
 * Samples are converted straight from the per-channel float arrays into the
 * output bytes, so no interleaved copy of the programme is ever materialised.
 */
export function encodeWavParts(
  channels: Float32Array[],
  opts: WavEncodeOptions,
): { parts: Uint8Array[]; layout: WavLayout } {
  const { count, frames } = checkChannels(channels);
  if (!Number.isFinite(opts.sampleRate) || opts.sampleRate <= 0) {
    throw new RangeError(`Invalid sample rate: ${opts.sampleRate}`);
  }
  const layout = wavLayout(count, frames, opts);
  const parts: Uint8Array[] = [writeHeader(layout, opts)];

  const bps = bytesPerSample(opts.format);
  const isFloat = opts.format === 'float32';
  const bits = bitsPerSample(opts.format);
  // Float output is bit-exact, so dithering it would only add noise.
  const quant = isFloat ? null : createRequantizers(count, bits, opts.dither);
  const blockFrames = Math.max(1, Math.floor(opts.blockFrames ?? DEFAULT_BLOCK_FRAMES));

  for (let start = 0; start < frames; start += blockFrames) {
    const n = Math.min(blockFrames, frames - start);
    const block = new Uint8Array(n * layout.blockAlign);
    const view = new DataView(block.buffer);
    let off = 0;
    for (let i = 0; i < n; i++) {
      const frame = start + i;
      for (let c = 0; c < count; c++) {
        const x = channels[c][frame];
        if (isFloat) {
          view.setFloat32(off, Number.isFinite(x) ? x : 0, true);
        } else {
          const code = quant![c].next(x);
          if (bps === 2) {
            view.setInt16(off, code, true);
          } else if (bps === 3) {
            // No DataView helper for 24-bit; write the two's complement bytes.
            const u = code < 0 ? code + 0x1000000 : code;
            block[off] = u & 0xff;
            block[off + 1] = (u >>> 8) & 0xff;
            block[off + 2] = (u >>> 16) & 0xff;
          } else {
            view.setInt32(off, code, true);
          }
        }
        off += bps;
      }
    }
    parts.push(block);
  }

  // RIFF chunks are word-aligned; an odd data chunk needs a trailing pad byte
  // that is not counted in the chunk size.
  if (layout.dataBytes & 1) parts.push(new Uint8Array(1));
  return { parts, layout };
}

/** Single-buffer convenience for callers that want the whole file at once. */
export function encodeWav(channels: Float32Array[], opts: WavEncodeOptions): Uint8Array {
  const { parts, layout } = encodeWavParts(channels, opts);
  const out = new Uint8Array(layout.totalBytes);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
