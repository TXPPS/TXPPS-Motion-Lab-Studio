// Every icon the product ships, resampled from the one source artwork.
//
// It used to draw a synthetic waveform mark in code — a second logo, which
// looked like the real one only for as long as nobody changed either. There is
// one logo now and these are derived from it, so the icons cannot drift from
// the thing on the app's own splash.
//
// No dependencies, in keeping with the rest of `scripts/`: the PNG decoder and
// encoder below are a few dozen lines each, and the alternative is a toolchain
// requirement for an asset step that runs once in a blue moon.
//
//   node scripts/generate-icons.mjs           # rewrite every icon
//   node scripts/generate-icons.mjs --check   # fail if they are out of date
import { deflateSync, inflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'assets', 'MotionLab Studio - Logo & App Icon.png');
const ICON_DIR = join(ROOT, 'public', 'icons');
const PUBLIC = join(ROOT, 'public');

// ------------------------------------------------------------------- png

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Decode an 8-bit non-interlaced PNG to RGBA.
 *
 * Only the shapes the source artwork actually is — truecolour with or without
 * alpha. Anything else throws by name rather than producing a quietly wrong
 * icon: a palette PNG decoded as truecolour is not an error anyone would see
 * until the icon was already on a home screen.
 */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const depth = buf[24];
  const colour = buf[25];
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
  if (colour !== 2 && colour !== 6) throw new Error(`unsupported colour type ${colour}`);
  if (buf[28] !== 0) throw new Error('interlaced PNGs are not supported');

  const parts = [];
  let at = 8;
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') parts.push(buf.subarray(at + 8, at + 8 + len));
    if (type === 'IEND') break;
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(parts));

  const channels = colour === 6 ? 4 : 3;
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4, 255);
  const line = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    raw.copy(line, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        // Paeth: the neighbour closest to a + b - c.
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (line[i] + add) & 0xff;
    }
    line.copy(prev);
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = line[s];
      out[d + 1] = line[s + 1];
      out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
  }
  return { width, height, rgba: out };
}

// -------------------------------------------------------------- resample

/**
 * Area-average downsample.
 *
 * Every source pixel inside a destination pixel's footprint contributes, which
 * is what a large reduction needs: nearest-neighbour would alias the icon's
 * one-pixel graticule into moiré, and the grid is most of what makes the
 * artwork read as an oscilloscope.
 */
function resample(src, size) {
  const out = Buffer.alloc(size * size * 4);
  const scale = src.width / size;
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scale));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scale));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * src.width + sx) * 4;
          r += src.rgba[i];
          g += src.rgba[i + 1];
          b += src.rgba[i + 2];
          a += src.rgba[i + 3];
          n++;
        }
      }
      const d = (y * size + x) * 4;
      out[d] = Math.round(r / n);
      out[d + 1] = Math.round(g / n);
      out[d + 2] = Math.round(b / n);
      out[d + 3] = Math.round(a / n);
    }
  }
  return out;
}

/**
 * The artwork inset inside a full-bleed ground, for a maskable icon.
 *
 * Android crops a maskable icon to whatever shape the launcher uses — circle,
 * squircle, teardrop — and only guarantees the central 80%. This logo is a
 * rounded square that fills its own canvas edge to edge, so cropped to a circle
 * it loses its bezel and clips the trace. Drawn at 78% on a ground taken from
 * its own corner, the whole mark survives every mask, and the ground is the
 * same near-black so the join is invisible.
 */
function maskable(src, size) {
  const inner = Math.round(size * 0.78);
  const art = resample(src, inner);
  const ground = [src.rgba[0], src.rgba[1], src.rgba[2]];
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = ground[0];
    out[i * 4 + 1] = ground[1];
    out[i * 4 + 2] = ground[2];
    out[i * 4 + 3] = 255;
  }
  const off = Math.round((size - inner) / 2);
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      const s = (y * inner + x) * 4;
      const d = ((y + off) * size + (x + off)) * 4;
      out[d] = art[s];
      out[d + 1] = art[s + 1];
      out[d + 2] = art[s + 2];
      out[d + 3] = 255;
    }
  }
  return out;
}

// ------------------------------------------------------------------- run

if (!existsSync(SOURCE)) {
  console.error(`icons: no source artwork at ${SOURCE}`);
  process.exit(1);
}
const src = decodePNG(readFileSync(SOURCE));
mkdirSync(ICON_DIR, { recursive: true });

const TARGETS = [
  { path: join(ICON_DIR, 'icon-192.png'), size: 192, kind: 'plain' },
  { path: join(ICON_DIR, 'icon-512.png'), size: 512, kind: 'plain' },
  { path: join(ICON_DIR, 'icon-512-maskable.png'), size: 512, kind: 'maskable' },
  { path: join(PUBLIC, 'apple-touch-icon.png'), size: 180, kind: 'plain' },
  { path: join(PUBLIC, 'favicon-32.png'), size: 32, kind: 'plain' },
  { path: join(PUBLIC, 'favicon-16.png'), size: 16, kind: 'plain' },
];

const check = process.argv.includes('--check');
let stale = 0;
for (const t of TARGETS) {
  const png = encodePNG(
    t.size,
    t.size,
    t.kind === 'maskable' ? maskable(src, t.size) : resample(src, t.size),
  );
  const name = t.path.slice(ROOT.length + 1);
  if (check) {
    const current = existsSync(t.path) ? readFileSync(t.path) : null;
    if (!current || !current.equals(png)) {
      console.error(`STALE ${name}`);
      stale++;
    }
    continue;
  }
  writeFileSync(t.path, png);
  console.log(`wrote ${name} (${t.size}x${t.size}, ${t.kind})`);
}

if (check) {
  if (stale > 0) {
    console.error(`\n${stale} icon(s) are not what the source artwork produces.`);
    console.error('Run `npm run icons`.');
    process.exit(1);
  }
  console.log(`icons: all ${TARGETS.length} match the source artwork.`);
}
