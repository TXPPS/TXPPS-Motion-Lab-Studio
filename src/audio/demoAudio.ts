/**
 * Procedurally generated demo media. Everything is synthesized at runtime with
 * deterministic seeds — no bundled or third-party audio, safe to redistribute,
 * and it works offline with zero network fetches.
 */
import { diagLog } from '../state/diagnostics';

export const MEDIA_SR = 44100;
export const MEDIA_BPM = 110;
const SPB = 60 / MEDIA_BPM; // seconds per beat

export interface MediaInfo {
  id: string;
  name: string;
  bars: number;
  seconds: number;
}

/** mulberry32 — deterministic PRNG so demo audio is identical everywhere. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RBJ biquad filter applied in place. */
function biquad(
  data: Float32Array,
  type: 'lowpass' | 'highpass' | 'bandpass',
  freq: number,
  q: number,
): void {
  const w0 = (2 * Math.PI * freq) / MEDIA_SR;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * q);
  let b0 = 0,
    b1 = 0,
    b2 = 0;
  const a0 = 1 + alpha,
    a1 = -2 * cw,
    a2 = 1 - alpha;
  if (type === 'lowpass') {
    b0 = (1 - cw) / 2;
    b1 = 1 - cw;
    b2 = (1 - cw) / 2;
  } else if (type === 'highpass') {
    b0 = (1 + cw) / 2;
    b1 = -(1 + cw);
    b2 = (1 + cw) / 2;
  } else {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  }
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    data[i] = y;
  }
}

function expDecay(t: number, tau: number): number {
  return Math.exp(-t / tau);
}

/** Add a one-shot into `dst` at second `at`, with per-sample generator `gen(t)`. */
function addHit(dst: Float32Array, at: number, durSec: number, gen: (t: number) => number): void {
  const start = Math.floor(at * MEDIA_SR);
  const n = Math.floor(durSec * MEDIA_SR);
  for (let i = 0; i < n && start + i < dst.length; i++) {
    dst[start + i] += gen(i / MEDIA_SR);
  }
}

function renderShaker(rand: () => number, vel: number): (t: number) => number {
  const amp = 0.16 * vel;
  return (t) => (rand() * 2 - 1) * amp * expDecay(t, 0.012) * (t < 0.002 ? t / 0.002 : 1);
}

function renderConga(freq: number, vel: number): (t: number) => number {
  const amp = 0.4 * vel;
  return (t) => Math.sin(2 * Math.PI * (freq - 30 * t * 8) * t) * amp * expDecay(t, 0.045);
}

// ---- drum one-shots (used by the drum-kit instrument) ----

function renderKick(): Float32Array[] {
  const dur = 0.3;
  const n = Math.floor(dur * MEDIA_SR);
  const d = new Float32Array(n);
  const rand = prng(101);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / MEDIA_SR;
    const f = 43 + 130 * Math.exp(-t / 0.055);
    phase += (2 * Math.PI * f) / MEDIA_SR;
    let s = Math.sin(phase) * 0.95 * expDecay(t, 0.085);
    if (t < 0.006) s += (rand() * 2 - 1) * 0.5 * expDecay(t, 0.002);
    d[i] = Math.tanh(s * 1.6) * 0.9;
  }
  return [d, d.slice()];
}

function renderSnare(): Float32Array[] {
  const dur = 0.24;
  const n = Math.floor(dur * MEDIA_SR);
  const noise = new Float32Array(n);
  const rand = prng(202);
  for (let i = 0; i < n; i++) {
    const t = i / MEDIA_SR;
    noise[i] = (rand() * 2 - 1) * expDecay(t, 0.06);
  }
  biquad(noise, 'highpass', 900, 0.8);
  biquad(noise, 'lowpass', 8500, 0.7);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / MEDIA_SR;
    d[i] = noise[i] * 0.75 + Math.sin(2 * Math.PI * 196 * t) * 0.45 * expDecay(t, 0.042);
  }
  return [d, d.slice()];
}

function renderClap(): Float32Array[] {
  const dur = 0.28;
  const n = Math.floor(dur * MEDIA_SR);
  const d = new Float32Array(n);
  const rand = prng(303);
  const bursts = [0, 0.012, 0.026];
  for (const b of bursts) {
    const start = Math.floor(b * MEDIA_SR);
    for (let i = start; i < n; i++) {
      const t = (i - start) / MEDIA_SR;
      d[i] += (rand() * 2 - 1) * 0.55 * expDecay(t, b === 0.026 ? 0.07 : 0.008);
    }
  }
  biquad(d, 'bandpass', 1500, 1.1);
  for (let i = 0; i < n; i++) d[i] *= 2.2;
  return [d, d.slice()];
}

function renderHat(open: boolean): Float32Array[] {
  const dur = open ? 0.42 : 0.07;
  const tau = open ? 0.13 : 0.016;
  const n = Math.floor(dur * MEDIA_SR);
  const d = new Float32Array(n);
  const rand = prng(open ? 404 : 505);
  for (let i = 0; i < n; i++) {
    const t = i / MEDIA_SR;
    d[i] = (rand() * 2 - 1) * expDecay(t, tau);
  }
  biquad(d, 'highpass', 6800, 0.8);
  for (let i = 0; i < n; i++) d[i] *= open ? 0.55 : 0.5;
  return [d, d.slice()];
}

// ---- audio-track loops ----

/** 2-bar percussion loop: 16th shaker + conga accents + rim clicks. */
function renderPercLoop(): Float32Array[] {
  const beats = 8;
  const n = Math.floor(beats * SPB * MEDIA_SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rand = prng(777);
  for (let bar = 0; bar < 2; bar++) {
    for (let s = 0; s < 16; s++) {
      const beat = bar * 4 + s * 0.25;
      const at = beat * SPB + (rand() - 0.5) * 0.004;
      const accent = s % 4 === 0 ? 1 : s % 2 === 0 ? 0.72 : 0.5;
      const g = renderShaker(prng(1000 + bar * 16 + s), accent);
      addHit(s % 2 === 0 ? L : R, at, 0.05, g);
      addHit(s % 2 === 0 ? R : L, at, 0.05, (t) => g(t) * 0.6);
    }
    const congas: [number, number, number][] = [
      [1.75, 185, 0.9],
      [2.75, 238, 0.7],
      [3.5, 185, 0.8],
    ];
    for (const [beat, f, v] of congas) {
      const at = (bar * 4 + beat) * SPB;
      addHit(L, at, 0.14, renderConga(f, v * 0.8));
      addHit(R, at, 0.14, renderConga(f, v));
    }
  }
  biquad(L, 'highpass', 300, 0.7);
  biquad(R, 'highpass', 300, 0.7);
  return [L, R];
}

/** 4-bar ambient texture pad: detuned A-minor partials + filtered air. */
function renderTexturePad(): Float32Array[] {
  const beats = 16;
  const n = Math.floor(beats * SPB * MEDIA_SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const loopSec = beats * SPB;
  const partials = [
    { f: 110.0, a: 0.2, lfo: 1 },
    { f: 164.81, a: 0.14, lfo: 2 },
    { f: 220.0, a: 0.12, lfo: 3 },
    { f: 261.63, a: 0.1, lfo: 4 },
    { f: 329.63, a: 0.08, lfo: 5 },
  ];
  for (const side of [0, 1]) {
    const dst = side === 0 ? L : R;
    const detune = side === 0 ? 0.9985 : 1.0015;
    for (const p of partials) {
      const lfoHz = p.lfo / loopSec; // whole cycles per loop => seamless
      const phase0 = (p.lfo * (side + 1) * Math.PI) / 3;
      let phase = phase0;
      for (let i = 0; i < n; i++) {
        const t = i / MEDIA_SR;
        phase += (2 * Math.PI * p.f * detune) / MEDIA_SR;
        const lfo = 0.65 + 0.35 * Math.sin(2 * Math.PI * lfoHz * t + phase0);
        dst[i] += Math.sin(phase) * p.a * lfo;
      }
    }
  }
  // air: lowpassed noise, slow seamless wobble
  const randL = prng(9001);
  const randR = prng(9002);
  const air = 0.05;
  const airL = new Float32Array(n);
  const airR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / MEDIA_SR;
    const wob = 0.6 + 0.4 * Math.sin((2 * Math.PI * 2 * t) / loopSec);
    airL[i] = (randL() * 2 - 1) * air * wob;
    airR[i] = (randR() * 2 - 1) * air * wob;
  }
  biquad(airL, 'lowpass', 1400, 0.7);
  biquad(airR, 'lowpass', 1400, 0.7);
  for (let i = 0; i < n; i++) {
    L[i] = (L[i] + airL[i]) * 0.55;
    R[i] = (R[i] + airR[i]) * 0.55;
  }
  // short edge fades to guarantee click-free clip boundaries
  const fadeN = Math.floor(0.02 * MEDIA_SR);
  for (let i = 0; i < fadeN; i++) {
    const k = i / fadeN;
    L[i] *= k;
    R[i] *= k;
    L[n - 1 - i] *= k;
    R[n - 1 - i] *= k;
  }
  return [L, R];
}

// ---- registry ----

interface MediaDef {
  name: string;
  bars: number;
  render: () => Float32Array[];
}

const MEDIA: Record<string, MediaDef> = {
  'perc-110-2bar': { name: 'Perc Loop (2 bar)', bars: 2, render: renderPercLoop },
  'texture-110-4bar': { name: 'Texture Pad (4 bar)', bars: 4, render: renderTexturePad },
};

const DRUMS: Record<number, { name: string; render: () => Float32Array[] }> = {
  36: { name: 'Kick', render: renderKick },
  38: { name: 'Snare', render: renderSnare },
  39: { name: 'Clap', render: renderClap },
  42: { name: 'Closed Hat', render: () => renderHat(false) },
  46: { name: 'Open Hat', render: () => renderHat(true) },
};

const channelCache = new Map<string, Float32Array[]>();
const bufferCache = new Map<string, AudioBuffer>();
const peaksCache = new Map<string, { min: Float32Array; max: Float32Array }>();

function renderChannels(key: string): Float32Array[] {
  let ch = channelCache.get(key);
  if (!ch) {
    const t0 = performance.now();
    if (MEDIA[key]) ch = MEDIA[key].render();
    else {
      const pitch = Number(key.replace('drum-', ''));
      const def = DRUMS[pitch] ?? DRUMS[42];
      ch = def.render();
    }
    channelCache.set(key, ch);
    diagLog('info', `Rendered demo media "${key}" in ${(performance.now() - t0).toFixed(0)}ms`);
  }
  return ch;
}

function toAudioBuffer(channels: Float32Array[]): AudioBuffer {
  const buf = new AudioBuffer({
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate: MEDIA_SR,
  });
  channels.forEach((c, i) => buf.copyToChannel(c, i));
  return buf;
}

export function listMedia(): MediaInfo[] {
  return Object.entries(MEDIA).map(([id, m]) => ({
    id,
    name: m.name,
    bars: m.bars,
    seconds: m.bars * 4 * SPB,
  }));
}

export function getMediaBuffer(id: string): AudioBuffer | null {
  if (!MEDIA[id]) {
    diagLog('warn', `Unknown mediaId "${id}"`);
    return null;
  }
  let buf = bufferCache.get(id);
  if (!buf) {
    buf = toAudioBuffer(renderChannels(id));
    bufferCache.set(id, buf);
  }
  return buf;
}

export function getMediaDurationSec(id: string): number {
  const m = MEDIA[id];
  return m ? m.bars * 4 * SPB : 0;
}

export function getDrumBuffer(pitch: number): AudioBuffer {
  const key = `drum-${DRUMS[pitch] ? pitch : 42}`;
  let buf = bufferCache.get(key);
  if (!buf) {
    buf = toAudioBuffer(renderChannels(key));
    bufferCache.set(key, buf);
  }
  return buf;
}

const PEAK_BUCKETS = 512;

/** min/max peaks (512 buckets) for waveform rendering. Pure math — no AudioBuffer needed. */
export function getMediaPeaks(id: string): { min: Float32Array; max: Float32Array } | null {
  if (!MEDIA[id]) return null;
  let p = peaksCache.get(id);
  if (!p) {
    const ch = renderChannels(id);
    const n = ch[0].length;
    const min = new Float32Array(PEAK_BUCKETS);
    const max = new Float32Array(PEAK_BUCKETS);
    const per = Math.ceil(n / PEAK_BUCKETS);
    for (let b = 0; b < PEAK_BUCKETS; b++) {
      let lo = 0,
        hi = 0;
      const start = b * per;
      const end = Math.min(n, start + per);
      for (let i = start; i < end; i++) {
        const v = (ch[0][i] + (ch[1]?.[i] ?? ch[0][i])) / 2;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      min[b] = lo;
      max[b] = hi;
    }
    p = { min, max };
    peaksCache.set(id, p);
  }
  return p;
}
