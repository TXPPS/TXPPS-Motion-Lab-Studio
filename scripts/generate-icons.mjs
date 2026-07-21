// Generates PWA PNG icons (192, 512, 512-maskable) without external dependencies.
// Draws the MotionLab waveform mark onto an RGBA buffer and encodes a PNG via zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [0x11, 0x16, 0x1c];
const BG_EDGE = [0x0b, 0x0e, 0x12];
const TEAL = [0x37, 0xb8, 0x9a];
const AMBER = [0xd9, 0xa1, 0x3c];

// Waveform polyline in 0..1 unit space (same shape as favicon.svg)
const WAVE = [
  [0.125, 0.5], [0.25, 0.5], [0.3125, 0.28], [0.40625, 0.72], [0.5, 0.375],
  [0.59375, 0.625], [0.65625, 0.47], [0.75, 0.5], [0.875, 0.5],
];

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx, qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

function drawIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const pad = maskable ? 0 : 0;
  const radius = maskable ? 0 : size * 0.19;
  const stroke = size * 0.055;
  const dotR = size * 0.06;
  const dotX = 0.78 * size, dotY = 0.235 * size;
  // Content scale: maskable icons keep artwork inside the 80% safe zone
  const cs = maskable ? 0.72 : 1;
  const off = (1 - cs) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // rounded-rect alpha mask
      let alpha = 255;
      if (!maskable) {
        const cx = Math.max(radius - x, x - (size - 1 - radius), 0);
        const cy = Math.max(radius - y, y - (size - 1 - radius), 0);
        if (cx > 0 && cy > 0) {
          const d = Math.hypot(cx, cy);
          if (d > radius) alpha = Math.max(0, 255 - (d - radius) * 255);
        }
      }
      // vertical gradient background
      const t = y / size;
      let r = BG[0] + (BG_EDGE[0] - BG[0]) * t;
      let g = BG[1] + (BG_EDGE[1] - BG[1]) * t;
      let b = BG[2] + (BG_EDGE[2] - BG[2]) * t;
      // waveform stroke
      const ux = (x / size - off) / cs, uy = (y / size - off) / cs;
      let dMin = Infinity;
      for (let s = 0; s < WAVE.length - 1; s++) {
        const [ax, ay] = WAVE[s];
        const [bx, by] = WAVE[s + 1];
        dMin = Math.min(dMin, distToSegment(ux, uy, ax, ay, bx, by) * size * cs);
      }
      if (dMin < stroke) {
        const k = Math.min(1, (stroke - dMin) / (size * 0.008));
        r = r + (TEAL[0] - r) * k;
        g = g + (TEAL[1] - g) * k;
        b = b + (TEAL[2] - b) * k;
      }
      // amber dot
      const dd = Math.hypot(x - (off * size + dotX * cs), y - (off * size + dotY * cs));
      if (dd < dotR * cs) {
        const k = Math.min(1, (dotR * cs - dd) / (size * 0.008));
        r = r + (AMBER[0] - r) * k;
        g = g + (AMBER[1] - g) * k;
        b = b + (AMBER[2] - b) * k;
      }
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = alpha;
    }
  }
  void pad;
  return encodePNG(size, size, rgba);
}

writeFileSync(join(outDir, 'icon-192.png'), drawIcon(192));
writeFileSync(join(outDir, 'icon-512.png'), drawIcon(512));
writeFileSync(join(outDir, 'icon-512-maskable.png'), drawIcon(512, { maskable: true }));
console.log('Icons written to', outDir);
