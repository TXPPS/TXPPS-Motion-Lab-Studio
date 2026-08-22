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
  for (let i = from; i < to; i++)
    crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ data[i]) & 0xff]) & 0xffff;
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

interface PartitionPlan {
  /** -1 means the escape form is used and `raw` holds the sample width. */
  param: number;
  raw: number;
  count: number;
  bits: number;
}

interface RicePlan {
  /** 0 = 4-bit parameters, 1 = 5-bit parameters. */
  method: 0 | 1;
  order: number;
  partitions: PartitionPlan[];
  /** Total residual bits, including the 2-bit method and 4-bit order fields. */
  bits: number;
}

function planPartitions(
  res: Int32Array,
  u: Float64Array,
  blockSize: number,
  predOrder: number,
  order: number,
  method: 0 | 1,
): RicePlan | null {
  const parts = 1 << order;
  const per = blockSize >> order;
  // Every partition but the first must be non-empty, and the first also has to
  // give up room for the predictor's warm-up samples.
  if (blockSize % parts !== 0 || per <= predOrder) return null;
  const paramBits = method === 0 ? 4 : 5;
  const kmax = method === 0 ? 14 : 30;
  const partitions: PartitionPlan[] = [];
  let total = 6 + parts * paramBits;
  let at = 0;
  for (let p = 0; p < parts; p++) {
    const count = p === 0 ? per - predOrder : per;
    const rice = bestRiceParam(u, at, count, kmax);
    const raw = partitionRawWidth(res, at, count);
    const escBits = 5 + count * raw;
    if (escBits < rice.bits) {
      partitions.push({ param: -1, raw, count, bits: escBits });
      total += escBits;
    } else {
      partitions.push({ param: rice.param, raw: 0, count, bits: rice.bits });
      total += rice.bits;
    }
    at += count;
  }
  return { method, order, partitions, bits: total };
}

function planRice(
  res: Int32Array,
  u: Float64Array,
  blockSize: number,
  predOrder: number,
): RicePlan {
  let best: RicePlan | null = null;
  for (let order = 0; order <= MAX_PARTITION_ORDER; order++) {
    for (const method of [0, 1] as const) {
      const plan = planPartitions(res, u, blockSize, predOrder, order, method);
      if (plan && (!best || plan.bits < best.bits)) best = plan;
    }
  }
  if (!best) throw new Error('FLAC: no usable residual partitioning');
  return best;
}

function writeRice(w: BitWriter, plan: RicePlan, res: Int32Array, u: Float64Array): void {
  w.writeBits(plan.method, 2);
  w.writeBits(plan.order, 4);
  const paramBits = plan.method === 0 ? 4 : 5;
  const escape = plan.method === 0 ? 0xf : 0x1f;
  let at = 0;
  for (const part of plan.partitions) {
    if (part.param < 0) {
      w.writeBits(escape, paramBits);
      w.writeBits(part.raw, 5);
      // A width of zero means every residual in the partition is zero, and the
      // samples themselves occupy no bits at all.
      if (part.raw > 0) {
        for (let i = at; i < at + part.count; i++) w.writeBits(res[i], part.raw);
      }
    } else {
      w.writeBits(part.param, paramBits);
      const div = Math.pow(2, part.param);
      for (let i = at; i < at + part.count; i++) {
        const q = Math.floor(u[i] / div);
        w.writeUnary(q);
        if (part.param > 0) w.writeBits(u[i] - q * div, part.param);
      }
    }
    at += part.count;
  }
}

// ---------------------------------------------------------------------------
// Subframes
// ---------------------------------------------------------------------------

type SubframeKind = 'constant' | 'verbatim' | 'fixed';

interface SubframePlan {
  kind: SubframeKind;
  order: number;
  rice: RicePlan | null;
  /** Exact size of the subframe in bits, header included. */
  bits: number;
}

/** Subframe header: one zero bit, six type bits, one wasted-bits flag. */
const SUBFRAME_HEADER_BITS = 8;

/** Approximate cost used only to rank predictor orders against each other. */
function quickRiceBits(u: Float64Array, m: number): number {
  const r = bestRiceParam(u, 0, m, 30);
  return 6 + (r.param <= 14 ? 4 : 5) + r.bits;
}

function planSubframe(
  x: Int32Array,
  n: number,
  bps: number,
  res: Int32Array,
  u: Float64Array,
): SubframePlan {
  let constant = true;
  for (let i = 1; i < n; i++) {
    if (x[i] !== x[0]) {
      constant = false;
      break;
    }
  }
  if (constant) {
    return { kind: 'constant', order: 0, rice: null, bits: SUBFRAME_HEADER_BITS + bps };
  }

  // Rank the fixed orders with a single-partition cost, then spend the full
  // partition search on the winner only. The ranking is cheap and the orders
  // differ by far more than the partitioning refines.
  let bestOrder = -1;
  let bestQuick = Number.POSITIVE_INFINITY;
  for (let order = 0; order <= Math.min(MAX_FIXED_ORDER, n - 1); order++) {
    const width = fixedResidual(x, n, order, res);
    if (width > MAX_RESIDUAL_BITS) continue;
    const m = n - order;
    zigzag(res, m, u);
    const bits = SUBFRAME_HEADER_BITS + order * bps + quickRiceBits(u, m);
    if (bits < bestQuick) {
      bestQuick = bits;
      bestOrder = order;
    }
  }

  const verbatimBits = SUBFRAME_HEADER_BITS + n * bps;
  if (bestOrder < 0) {
    return { kind: 'verbatim', order: 0, rice: null, bits: verbatimBits };
  }

  const m = n - bestOrder;
  fixedResidual(x, n, bestOrder, res);
  zigzag(res, m, u);
  const rice = planRice(res, u, n, bestOrder);
  const fixedBits = SUBFRAME_HEADER_BITS + bestOrder * bps + rice.bits;
  if (verbatimBits <= fixedBits) {
    return { kind: 'verbatim', order: 0, rice: null, bits: verbatimBits };
  }
  return { kind: 'fixed', order: bestOrder, rice, bits: fixedBits };
}

function writeSubframe(
  w: BitWriter,
  plan: SubframePlan,
  x: Int32Array,
  n: number,
  bps: number,
  res: Int32Array,
  u: Float64Array,
): void {
  w.writeBits(0, 1);
  if (plan.kind === 'constant') {
    w.writeBits(0, 6);
    w.writeBits(0, 1);
    w.writeBits(x[0], bps);
    return;
  }
  if (plan.kind === 'verbatim') {
    w.writeBits(1, 6);
    w.writeBits(0, 1);
    for (let i = 0; i < n; i++) w.writeBits(x[i], bps);
    return;
  }
  w.writeBits(0b001000 | plan.order, 6);
  w.writeBits(0, 1);
  for (let i = 0; i < plan.order; i++) w.writeBits(x[i], bps);
  // The scratch buffers are shared across the frame's candidate channels, so
  // the residual is regenerated here rather than carried inside the plan.
  fixedResidual(x, n, plan.order, res);
  zigzag(res, n - plan.order, u);
  writeRice(w, plan.rice!, res, u);
}

// ---------------------------------------------------------------------------
// Frame headers
// ---------------------------------------------------------------------------

const BLOCK_SIZE_CODES = new Map<number, number>([
  [192, 1],
  [576, 2],
  [1152, 3],
  [2304, 4],
  [4608, 5],
  [256, 8],
  [512, 9],
  [1024, 10],
  [2048, 11],
  [4096, 12],
  [8192, 13],
  [16384, 14],
  [32768, 15],
]);

const SAMPLE_RATE_CODES = new Map<number, number>([
  [88200, 1],
  [176400, 2],
  [192000, 3],
  [8000, 4],
  [16000, 5],
  [22050, 6],
  [24000, 7],
  [32000, 8],
  [44100, 9],
  [48000, 10],
  [96000, 11],
]);

interface FieldCoding {
  code: number;
  extraBits: 0 | 8 | 16;
  value: number;
}

function blockSizeCoding(n: number): FieldCoding {
  const known = BLOCK_SIZE_CODES.get(n);
  if (known !== undefined) return { code: known, extraBits: 0, value: 0 };
  if (n <= 256) return { code: 6, extraBits: 8, value: n - 1 };
  return { code: 7, extraBits: 16, value: n - 1 };
}

function sampleRateCoding(rate: number): FieldCoding {
  const known = SAMPLE_RATE_CODES.get(rate);
  if (known !== undefined) return { code: known, extraBits: 0, value: 0 };
  if (rate % 1000 === 0 && rate / 1000 <= 255) {
    return { code: 12, extraBits: 8, value: rate / 1000 };
  }
  if (rate <= 65535) return { code: 13, extraBits: 16, value: rate };
  if (rate % 10 === 0 && rate / 10 <= 65535) return { code: 14, extraBits: 16, value: rate / 10 };
  // Nothing in the header can express it; the decoder falls back to STREAMINFO.
  return { code: 0, extraBits: 0, value: 0 };
}

function sampleSizeCoding(bps: number): number {
  switch (bps) {
    case 8:
      return 1;
    case 12:
      return 2;
    case 16:
      return 4;
    case 20:
      return 5;
    case 24:
      return 6;
    default:
      return 0;
  }
}

/**
 * The frame number uses the UTF-8 byte pattern extended to 36 bits. Only the
 * lengths a fixed-blocksize stream can reach are implemented; a longer stream
 * than six bytes can express is beyond the format's own limits anyway.
 */
function writeUtf8Number(w: BitWriter, value: number): void {
  if (value < 0x80) {
    w.writeBits(value, 8);
    return;
  }
  const lengths: [number, number][] = [
    [0x800, 2],
    [0x10000, 3],
    [0x200000, 4],
    [0x4000000, 5],
    [0x80000000, 6],
  ];
  const found = lengths.find(([limit]) => value < limit);
  if (!found) throw new RangeError(`FLAC frame number out of range: ${value}`);
  const bytes = found[1];
  const leadMask = [0, 0, 0xc0, 0xe0, 0xf0, 0xf8, 0xfc][bytes];
  w.writeBits(leadMask | Math.floor(value / Math.pow(2, 6 * (bytes - 1))), 8);
  for (let i = bytes - 2; i >= 0; i--) {
    w.writeBits(0x80 | (Math.floor(value / Math.pow(2, 6 * i)) % 64), 8);
  }
}

// ---------------------------------------------------------------------------
// Metadata blocks
// ---------------------------------------------------------------------------

function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.codePointAt(i)!;
    if (code > 0xffff) i++;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
      code = 0;
    }
  }
  return Uint8Array.from(out);
}

const VORBIS_FIELDS: ReadonlyArray<readonly [keyof FlacMetadata, string]> = [
  ['title', 'TITLE'],
  ['artist', 'ARTIST'],
  ['album', 'ALBUM'],
  ['genre', 'GENRE'],
  ['date', 'DATE'],
  ['comment', 'DESCRIPTION'],
];

interface StreamInfoFields {
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

function streamInfoBlock(f: StreamInfoFields): Uint8Array {
  const w = new BitWriter(64);
  w.writeBits(0, 1); // not the last metadata block: a tag block follows
  w.writeBits(0, 7); // STREAMINFO
  w.writeBits(34, 24);
  w.writeBits(f.minBlockSize, 16);
  w.writeBits(f.maxBlockSize, 16);
  w.writeBits(f.minFrameSize, 24);
  w.writeBits(f.maxFrameSize, 24);
  w.writeBits(f.sampleRate, 20);
  w.writeBits(f.channels - 1, 3);
  w.writeBits(f.bitDepth - 1, 5);
  // 36 bits does not fit one write; the high nibble goes out separately.
  w.writeBits(Math.floor(f.totalSamples / 4294967296), 4);
  w.writeBits(f.totalSamples % 4294967296, 32);
  for (let i = 0; i < 16; i++) w.writeBits(f.md5[i], 8);
  return w.buffer.slice(0, w.byteLength);
}

function vorbisCommentBlock(meta: FlacMetadata | undefined): Uint8Array {
  const vendor = utf8Bytes(meta?.software?.trim() || DEFAULT_VENDOR);
  const comments: Uint8Array[] = [];
  for (const [key, field] of VORBIS_FIELDS) {
    const value = meta?.[key];
    if (typeof value !== 'string' || value.length === 0) continue;
    comments.push(utf8Bytes(`${field}=${value}`));
  }
  let bodyLen = 4 + vendor.length + 4;
  for (const c of comments) bodyLen += 4 + c.length;

  const out = new Uint8Array(4 + bodyLen);
  out[0] = 0x80 | 4; // last metadata block, type VORBIS_COMMENT
  out[1] = (bodyLen >>> 16) & 0xff;
  out[2] = (bodyLen >>> 8) & 0xff;
  out[3] = bodyLen & 0xff;
  const view = new DataView(out.buffer);
  let at = 4;
  view.setUint32(at, vendor.length, true);
  out.set(vendor, at + 4);
  at += 4 + vendor.length;
  view.setUint32(at, comments.length, true);
  at += 4;
  for (const c of comments) {
    view.setUint32(at, c.length, true);
    out.set(c, at + 4);
    at += 4 + c.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

const CHANNEL_INDEPENDENT = 0;
const CHANNEL_LEFT_SIDE = 8;
const CHANNEL_RIGHT_SIDE = 9;
const CHANNEL_MID_SIDE = 10;

interface Subframe {
  data: Int32Array;
  bps: number;
  plan: SubframePlan;
}

type BlockFiller = (start: number, count: number, out: Int32Array[]) => void;

function encodeCore(
  channelCount: number,
  frames: number,
  fill: BlockFiller,
  opts: FlacEncodeOptions,
): FlacResult {
  const bps = opts.bitDepth;
  if (bps !== 16 && bps !== 24) throw new RangeError(`FLAC bit depth must be 16 or 24, got ${bps}`);
  if (channelCount < 1 || channelCount > MAX_CHANNELS) {
    throw new RangeError(`FLAC supports 1 to ${MAX_CHANNELS} channels, got ${channelCount}`);
  }
  const sampleRate = Math.round(opts.sampleRate);
  if (!Number.isFinite(sampleRate) || sampleRate < 1 || sampleRate > 0xfffff) {
    throw new RangeError(`FLAC sample rate out of range: ${opts.sampleRate}`);
  }
  const blockSize = Math.max(16, Math.min(32768, Math.floor(opts.blockSize ?? DEFAULT_BLOCK_SIZE)));

  const chan: Int32Array[] = [];
  for (let c = 0; c < channelCount; c++) chan.push(new Int32Array(blockSize));
  const mid = new Int32Array(blockSize);
  const side = new Int32Array(blockSize);
  const res = new Int32Array(blockSize);
  const zig = new Float64Array(blockSize);
  const sampleBytes = bps / 8;
  const rawBlock = new Uint8Array(blockSize * channelCount * sampleBytes);
  const hash = new Md5();
  // Verbatim is the worst case: every subframe raw, plus a bit of header.
  const writer = new BitWriter(64 + blockSize * channelCount * (sampleBytes + 1));

  const srCoding = sampleRateCoding(sampleRate);
  const ssCode = sampleSizeCoding(bps);
  const frameParts: Uint8Array[] = [];
  let minFrameSize = Number.POSITIVE_INFINITY;
  let maxFrameSize = 0;
  let minBlock = Number.POSITIVE_INFINITY;
  let maxBlock = 0;

  for (let start = 0, frameNumber = 0; start < frames; start += blockSize, frameNumber++) {
    const n = Math.min(blockSize, frames - start);
    fill(start, n, chan);

    let at = 0;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < channelCount; c++) {
        const v = chan[c][i];
        rawBlock[at] = v & 0xff;
        rawBlock[at + 1] = (v >> 8) & 0xff;
        if (sampleBytes === 3) rawBlock[at + 2] = (v >> 16) & 0xff;
        at += sampleBytes;
      }
    }
    hash.update(rawBlock.subarray(0, at));

    let assignment = CHANNEL_INDEPENDENT + channelCount - 1;
    let subs: Subframe[];
    if (channelCount === 2) {
      const left = chan[0];
      const right = chan[1];
      for (let i = 0; i < n; i++) {
        // Arithmetic shift floors, which is exactly the rounding the decoder
        // undoes using the side channel's low bit.
        mid[i] = (left[i] + right[i]) >> 1;
        side[i] = left[i] - right[i];
      }
      const planL = planSubframe(left, n, bps, res, zig);
      const planR = planSubframe(right, n, bps, res, zig);
      const planM = planSubframe(mid, n, bps, res, zig);
      const planS = planSubframe(side, n, bps + 1, res, zig);
      const options: { cost: number; assignment: number; subs: Subframe[] }[] = [
        {
          cost: planL.bits + planR.bits,
          assignment: CHANNEL_INDEPENDENT + 1,
          subs: [
            { data: left, bps, plan: planL },
            { data: right, bps, plan: planR },
          ],
        },
        {
          cost: planL.bits + planS.bits,
          assignment: CHANNEL_LEFT_SIDE,
          subs: [
            { data: left, bps, plan: planL },
            { data: side, bps: bps + 1, plan: planS },
          ],
        },
        {
          cost: planS.bits + planR.bits,
          assignment: CHANNEL_RIGHT_SIDE,
          subs: [
            { data: side, bps: bps + 1, plan: planS },
            { data: right, bps, plan: planR },
          ],
        },
        {
          cost: planM.bits + planS.bits,
          assignment: CHANNEL_MID_SIDE,
          subs: [
            { data: mid, bps, plan: planM },
            { data: side, bps: bps + 1, plan: planS },
          ],
        },
      ];
      let best = options[0];
      for (const o of options) if (o.cost < best.cost) best = o;
      assignment = best.assignment;
      subs = best.subs;
    } else {
      subs = [];
      for (let c = 0; c < channelCount; c++) {
        subs.push({ data: chan[c], bps, plan: planSubframe(chan[c], n, bps, res, zig) });
      }
    }

    const bsCoding = blockSizeCoding(n);
    writer.reset();
    writer.writeBits(0x3ffe, 14); // sync
    writer.writeBits(0, 1); // reserved
    writer.writeBits(0, 1); // fixed block size, so the number below is a frame index
    writer.writeBits(bsCoding.code, 4);
    writer.writeBits(srCoding.code, 4);
    writer.writeBits(assignment, 4);
    writer.writeBits(ssCode, 3);
    writer.writeBits(0, 1); // reserved
    writeUtf8Number(writer, frameNumber);
    if (bsCoding.extraBits) writer.writeBits(bsCoding.value, bsCoding.extraBits);
    if (srCoding.extraBits) writer.writeBits(srCoding.value, srCoding.extraBits);
    writer.writeBits(crc8(writer.buffer, 0, writer.byteLength), 8);

    for (const s of subs) writeSubframe(writer, s.plan, s.data, n, s.bps, res, zig);
    writer.align();
    writer.writeBits(crc16(writer.buffer, 0, writer.byteLength), 16);

    const frame = writer.buffer.slice(0, writer.byteLength);
    frameParts.push(frame);
    if (frame.length < minFrameSize) minFrameSize = frame.length;
    if (frame.length > maxFrameSize) maxFrameSize = frame.length;
    if (n < minBlock) minBlock = n;
    if (n > maxBlock) maxBlock = n;
  }

  const md5 = hash.digest();
  const info = streamInfoBlock({
    // With no frames at all there is nothing to describe, and zero in the
    // frame-size fields is the format's own "unknown".
    minBlockSize: frames === 0 ? blockSize : minBlock,
    maxBlockSize: frames === 0 ? blockSize : maxBlock,
    minFrameSize: frames === 0 ? 0 : minFrameSize,
    maxFrameSize,
    sampleRate,
    channels: channelCount,
    bitDepth: bps,
    totalSamples: frames,
    md5,
  });
  const tags = vorbisCommentBlock(opts.metadata);
  const magic = Uint8Array.from([0x66, 0x4c, 0x61, 0x43]); // "fLaC"

  const parts = [magic, info, tags, ...frameParts];
  let totalBytes = 0;
  for (const p of parts) totalBytes += p.length;
  return { parts, totalBytes, md5 };
}

function checkChannels(channels: ArrayLike<{ length: number }>): number {
  if (channels.length === 0) throw new RangeError('FLAC export needs at least one channel.');
  const frames = channels[0].length;
  for (let i = 1; i < channels.length; i++) {
    if (channels[i].length !== frames) throw new RangeError('FLAC channels differ in length.');
  }
  return frames;
}

/** Encode integer samples that are already at the target bit depth. */
export function encodeFlacFromInt(channels: Int32Array[], opts: FlacEncodeOptions): FlacResult {
  const frames = checkChannels(channels);
  return encodeCore(
    channels.length,
    frames,
    (start, count, out) => {
      for (let c = 0; c < channels.length; c++) {
        out[c].set(channels[c].subarray(start, start + count));
      }
    },
    opts,
  );
}

/**
 * Encode normalised floats, requantising block by block so the programme is
 * never held twice: once as floats and again as integers.
 */
export function encodeFlacParts(channels: Float32Array[], opts: FlacEncodeOptions): FlacResult {
  const frames = checkChannels(channels);
  const quant = createRequantizers(channels.length, opts.bitDepth, opts.dither);
  return encodeCore(
    channels.length,
    frames,
    (start, count, out) => {
      for (let c = 0; c < channels.length; c++) {
        const src = channels[c];
        const dst = out[c];
        const q = quant[c];
        for (let i = 0; i < count; i++) dst[i] = q.next(src[start + i]);
      }
    },
    opts,
  );
}

/** Single-buffer convenience. */
export function encodeFlac(channels: Float32Array[], opts: FlacEncodeOptions): Uint8Array {
  const { parts, totalBytes } = encodeFlacParts(channels, opts);
  const out = new Uint8Array(totalBytes);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
