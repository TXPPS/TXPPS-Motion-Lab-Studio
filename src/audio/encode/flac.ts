/**
 * Native FLAC encoder.
 *
 * FLAC is the only lossless compressed format worth shipping from a browser
 * DAW: the decoder is everywhere, the bitstream is stable, and an archived
 * mixdown decodes to exactly the samples that were exported. That last point
 * is why the encoder is written out in full here rather than approximated --
 * a "FLAC-ish" file that a real decoder rejects is worse than no FLAC at all.
 *
 * What this encoder implements:
 *
 *  - "fLaC" marker, STREAMINFO (with the MD5 of the unencoded samples) and an
 *    optional VORBIS_COMMENT tag block.
 *  - Fixed polynomial predictors of order 0-4 with Rice-coded residuals. The
 *    order is chosen per subframe by costing each candidate, and CONSTANT and
 *    VERBATIM subframes are used whenever they are actually cheaper.
 *  - Rice partitioning: the residual is split into 2^p partitions each with its
 *    own parameter, and the partition order and parameters are chosen by exact
 *    bit count. Partitions that Rice codes badly fall back to the escape form.
 *  - Per-frame stereo decorrelation across independent / left-side /
 *    right-side / mid-side, decided by costing all four.
 *  - CRC-8 over each frame header and CRC-16 over each whole frame.
 *
 * Not implemented, deliberately: LPC subframes. They buy roughly another
 * 3-5 % on typical material for a large amount of numerical machinery
 * (autocorrelation, Levinson-Durbin, quantised coefficients, shift search)
 * and a much wider surface for a bitstream bug. Fixed predictors already give
 * most of the win, and every FLAC decoder handles them.
 *
 * DOM-free: this module is arithmetic and byte buffers only.
 */
import { createRequantizers, type DitherOptions } from './dither';

export type FlacBitDepth = 16 | 24;

export interface FlacMetadata {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  date?: string;
  comment?: string;
  /** Written as the stream's vendor string, which is where tools look. */
  software?: string;
}

export interface FlacEncodeOptions {
  sampleRate: number;
  bitDepth: FlacBitDepth;
  /** Samples per frame. 4096 is the reference encoder's default. */
  blockSize?: number;
  metadata?: FlacMetadata;
  /** Only used when encoding from floats. */
  dither?: DitherOptions;
}

export interface FlacResult {
  parts: Uint8Array[];
  totalBytes: number;
  /** MD5 of the unencoded interleaved samples, as written into STREAMINFO. */
  md5: Uint8Array;
}

const DEFAULT_BLOCK_SIZE = 4096;
const MAX_CHANNELS = 8;
const MAX_FIXED_ORDER = 4;
const MAX_PARTITION_ORDER = 6;
const DEFAULT_VENDOR = 'TXPPS MotionLab Studio FLAC';

/**
 * A residual sample wider than this is refused for the order that produced it.
 * The escape form stores a raw width in five bits, so 31 is the widest thing
 * the bitstream can describe, and staying a bit under keeps the intermediate
 * arithmetic inside the range where JavaScript bit operations are exact.
 */
const MAX_RESIDUAL_BITS = 30;

// ---------------------------------------------------------------------------
// CRC
// ---------------------------------------------------------------------------

/** FLAC frame headers are protected by CRC-8 with polynomial x^8+x^2+x+1. */
const CRC8_TABLE = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let b = 0; b < 8; b++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
    t[i] = c;
  }
  return t;
})();

/** Whole frames are protected by CRC-16 with polynomial x^16+x^15+x^2+1. */
const CRC16_TABLE = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 8;
    for (let b = 0; b < 8; b++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff;
    t[i] = c;
  }
  return t;
})();

export function crc8(data: Uint8Array, from: number, to: number): number {
  let crc = 0;
  for (let i = from; i < to; i++) crc = CRC8_TABLE[crc ^ data[i]];
  return crc;
}

export function crc16(data: Uint8Array, from: number, to: number): number {
  let crc = 0;
  for (let i = from; i < to; i++) crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ data[i]) & 0xff]) & 0xffff;
  return crc;
}

// ---------------------------------------------------------------------------
// MD5
// ---------------------------------------------------------------------------

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K = (() => {
  const k = new Int32Array(64);
  for (let i = 0; i < 64; i++) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  return k;
})();

/**
 * Incremental MD5. STREAMINFO carries the MD5 of the raw samples so a decoder
 * can prove a decode was bit exact, which means the encoder has to hash the
 * programme as it streams past rather than buffering it.
 */
class Md5 {
  private readonly block = new Uint8Array(64);
  private readonly words = new Int32Array(16);
  private blockLen = 0;
  private byteLen = 0;
  private h0 = 0x67452301;
  private h1 = 0xefcdab89;
  private h2 = 0x98badcfe;
  private h3 = 0x10325476;

  update(data: Uint8Array): void {
    this.byteLen += data.length;
    let i = 0;
    if (this.blockLen > 0) {
      const need = Math.min(64 - this.blockLen, data.length);
      this.block.set(data.subarray(0, need), this.blockLen);
      this.blockLen += need;
      i = need;
      if (this.blockLen === 64) {
        this.transform(this.block, 0);
        this.blockLen = 0;
      }
    }
    for (; i + 64 <= data.length; i += 64) this.transform(data, i);
    if (i < data.length) {
      this.block.set(data.subarray(i), 0);
      this.blockLen = data.length - i;
    }
  }

  digest(): Uint8Array {
    const bitLen = this.byteLen * 8;
    const pad = new Uint8Array(this.blockLen < 56 ? 64 : 128);
    pad.set(this.block.subarray(0, this.blockLen), 0);
    pad[this.blockLen] = 0x80;
    // The length field is 64 bits little-endian; byteLen can exceed 2^32 for a
    // long export, so the high word is derived by division rather than a shift.
    const lo = bitLen >>> 0;
    const hi = Math.floor(bitLen / 4294967296) >>> 0;
    const lenAt = pad.length - 8;
    for (let i = 0; i < 4; i++) pad[lenAt + i] = (lo >>> (8 * i)) & 0xff;
    for (let i = 0; i < 4; i++) pad[lenAt + 4 + i] = (hi >>> (8 * i)) & 0xff;
    for (let i = 0; i < pad.length; i += 64) this.transform(pad, i);

    const out = new Uint8Array(16);
    const hs = [this.h0, this.h1, this.h2, this.h3];
    for (let w = 0; w < 4; w++) {
      for (let i = 0; i < 4; i++) out[w * 4 + i] = (hs[w] >>> (8 * i)) & 0xff;
    }
    return out;
  }

  private transform(data: Uint8Array, at: number): void {
    const m = this.words;
    for (let i = 0; i < 16; i++) {
      const o = at + i * 4;
      m[i] = data[o] | (data[o + 1] << 8) | (data[o + 2] << 16) | (data[o + 3] << 24);
    }
    let a = this.h0;
    let b = this.h1;
    let c = this.h2;
    let d = this.h3;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) & 15;
      }
      const t = (f + a + MD5_K[i] + m[g]) | 0;
      const s = MD5_S[i];
      a = d;
      d = c;
      c = b;
      b = (b + ((t << s) | (t >>> (32 - s)))) | 0;
    }
    this.h0 = (this.h0 + a) | 0;
    this.h1 = (this.h1 + b) | 0;
    this.h2 = (this.h2 + c) | 0;
    this.h3 = (this.h3 + d) | 0;
  }
}

/** Exposed so a caller can verify a stream's STREAMINFO hash independently. */
export function md5Bytes(data: Uint8Array): Uint8Array {
  const h = new Md5();
  h.update(data);
  return h.digest();
}

// ---------------------------------------------------------------------------
// Bit writer
// ---------------------------------------------------------------------------

/**
 * MSB-first bit writer over a growable byte buffer.
 *
 * The accumulator is held as a plain number and shifted with multiplication
 * rather than `<<`, because a 32-bit shift in JavaScript wraps and the
 * bitstream routinely writes fields wider than the safe shift range.
 */
class BitWriter {
  private buf: Uint8Array;
  private len = 0;
  private acc = 0;
  private accBits = 0;

  constructor(capacity: number) {
    this.buf = new Uint8Array(Math.max(64, capacity));
  }

  reset(): void {
    this.len = 0;
    this.acc = 0;
    this.accBits = 0;
  }

  get byteLength(): number {
    return this.len;
  }

  get buffer(): Uint8Array {
    return this.buf;
  }

  private putByte(b: number): void {
    if (this.len === this.buf.length) {
      const grown = new Uint8Array(this.buf.length * 2);
      grown.set(this.buf);
      this.buf = grown;
    }
    this.buf[this.len++] = b;
  }

  /** `bits` must be at most 16 and `value` already reduced to that width. */
  private push(value: number, bits: number): void {
    this.acc = this.acc * Math.pow(2, bits) + value;
    this.accBits += bits;
    while (this.accBits >= 8) {
      this.accBits -= 8;
      const scale = Math.pow(2, this.accBits);
      const byte = Math.floor(this.acc / scale);
      this.putByte(byte & 0xff);
      this.acc -= byte * scale;
    }
  }

  writeBits(value: number, bits: number): void {
    if (bits <= 0) return;
    const u = bits >= 32 ? value >>> 0 : (value >>> 0) % Math.pow(2, bits);
    if (bits > 16) {
      this.push(Math.floor(u / 65536), bits - 16);
      this.push(u % 65536, 16);
    } else {
      this.push(u, bits);
    }
  }

  /** `q` zero bits followed by a one bit, as Rice quotients are coded. */
  writeUnary(q: number): void {
    let left = q;
    while (left >= 16) {
      this.push(0, 16);
      left -= 16;
    }
    this.push(1, left + 1);
  }

  align(): void {
    if (this.accBits > 0) this.push(0, 8 - this.accBits);
  }
}

// ---------------------------------------------------------------------------
// Predictors and residual coding
// ---------------------------------------------------------------------------

/** Bits needed to hold `v` in two's complement; 0 only for 0. */
function signedWidth(v: number): number {
  if (v === 0) return 0;
  return v > 0 ? 33 - Math.clz32(v) : 33 - Math.clz32(-v - 1);
}

/**
 * Residual of the fixed polynomial predictor of the given order. Entry j of
 * the output predicts sample j + order, so the output holds n - order values.
 */
function fixedResidual(x: Int32Array, n: number, order: number, out: Int32Array): number {
  const m = n - order;
  switch (order) {
    case 0:
      for (let j = 0; j < m; j++) out[j] = x[j];
      break;
    case 1:
      for (let j = 0; j < m; j++) out[j] = x[j + 1] - x[j];
      break;
    case 2:
      for (let j = 0; j < m; j++) out[j] = x[j + 2] - 2 * x[j + 1] + x[j];
      break;
    case 3:
      for (let j = 0; j < m; j++) out[j] = x[j + 3] - 3 * x[j + 2] + 3 * x[j + 1] - x[j];
      break;
    default:
      for (let j = 0; j < m; j++) {
        out[j] = x[j + 4] - 4 * x[j + 3] + 6 * x[j + 2] - 4 * x[j + 1] + x[j];
      }
      break;
  }
  let widest = 0;
  for (let j = 0; j < m; j++) {
    const w = signedWidth(out[j]);
    if (w > widest) widest = w;
  }
  return widest;
}

/** Zigzag fold: Rice coding needs unsigned values with small magnitudes near zero. */
function zigzag(res: Int32Array, m: number, out: Float64Array): void {
  for (let j = 0; j < m; j++) {
    const v = res[j];
    out[j] = v >= 0 ? 2 * v : -2 * v - 1;
  }
}

interface ParamChoice {
  param: number;
  bits: number;
}

/**
 * Cheapest Rice parameter for one partition, excluding the parameter field.
 *
 * Only parameters around log2(mean) are costed: the bit count is convex in the
 * parameter, so the optimum is always adjacent to that estimate, and costing
 * all 31 candidates would dominate the encoder's run time.
 */
function bestRiceParam(u: Float64Array, from: number, count: number, kmax: number): ParamChoice {
  let sum = 0;
  for (let i = from; i < from + count; i++) sum += u[i];
  const mean = sum / count;
  const seed = mean < 1 ? 0 : Math.floor(Math.log2(mean));
  const lo = Math.max(0, Math.min(kmax, seed - 1));
  const hi = Math.max(0, Math.min(kmax, seed + 2));
  let best: ParamChoice = { param: lo, bits: Number.POSITIVE_INFINITY };
  for (let k = lo; k <= hi; k++) {
    const div = Math.pow(2, k);
    let bits = count * (k + 1);
    for (let i = from; i < from + count; i++) bits += Math.floor(u[i] / div);
    if (bits < best.bits) best = { param: k, bits };
  }
  return best;
}

/** Widest raw sample in a partition, which is what the escape form stores. */
function partitionRawWidth(res: Int32Array, from: number, count: number): number {
  let widest = 0;
  for (let i = from; i < from + count; i++) {
    const w = signedWidth(res[i]);
    if (w > widest) widest = w;
  }
  return widest;
}

