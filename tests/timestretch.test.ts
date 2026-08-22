import { describe, expect, it } from 'vitest';
import { stretchChannel, wsolaGrid, pitchShiftChannel } from '../src/audio/timestretch';
import { detectPitch } from '../src/model/pitch';

const SR = 44100;

function sine(hz: number, seconds: number, amplitude = 0.5) {
  const data = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < data.length; i++) data[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / SR);
  return data;
}
function rms(d: Float32Array, from = 0, to = d.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += d[i] * d[i];
  return Math.sqrt(s / (to - from));
}

describe('sanity', () => {
  it('sine 1.5', () => {
    const src = sine(440, 1);
    const t0 = Date.now();
    const out = stretchChannel(src, SR, 1.5);
    console.log('ms', Date.now() - t0, 'len', out.length, 'expect', Math.round(src.length * 1.5));
    const p = detectPitch(out.subarray(20000, 20000 + 8192), SR);
    console.log('pitch', p, 'cents', 1200 * Math.log2(p.hz / 440));
    console.log('rms src', rms(src), 'out', rms(out), 'dB', 20 * Math.log10(rms(out) / rms(src)));
    const grid = wsolaGrid(SR, 1.5);
    console.log('grid', grid);
    expect(out.length).toBe(Math.round(src.length * 1.5));
  });

  it('clicks x2', () => {
    const data = new Float32Array(SR * 2);
    const spacing = Math.round(0.25 * SR);
    const decay = Math.round(0.003 * SR);
    for (let c = 0; c < 7; c++) {
      const at = Math.round(0.1 * SR) + c * spacing;
      for (let i = 0; i < decay; i++)
        data[at + i] = Math.exp(-i / (decay / 5)) * Math.sin((2 * Math.PI * 2500 * i) / SR);
    }
    for (const ratio of [2, 1.5, 0.75]) {
    const out = stretchChannel(data, SR, ratio);
    const peaks: number[] = [];
    let last = -1e9;
    for (let i = 0; i < out.length; i++) {
      if (Math.abs(out[i]) > 0.3 && i - last > 0.1 * SR) {
        peaks.push(i / SR);
        last = i;
      }
    }
    console.log('peaks', peaks.map((p) => p.toFixed(4)).join(' '));
    const diffs = peaks.slice(1).map((p, i) => p - peaks[i]);
    console.log('ratio', ratio, 'spacing', diffs.map((d) => d.toFixed(4)).join(' '), 'ideal', 0.25*ratio, 'first', peaks[0], 'idealFirst', 0.1*ratio);
    }
  });

  it('identity', () => {
    const src = sine(300, 0.3);
    const out = stretchChannel(src, SR, 1);
    let same = true;
    for (let i = 0; i < src.length; i++) if (src[i] !== out[i]) same = false;
    console.log('identical', same);
  });

  it('pitch shift', () => {
    const src = sine(220, 1);
    const t0 = Date.now();
    const up = pitchShiftChannel(src, SR, 7);
    console.log('shift ms', Date.now() - t0, 'len', up.length, src.length);
    const p = detectPitch(up.subarray(20000, 20000 + 8192), SR);
    const target = 220 * Math.pow(2, 7 / 12);
    console.log('shifted', p.hz, 'target', target, 'cents', 1200 * Math.log2(p.hz / target));
    console.log('rms', 20 * Math.log10(rms(up) / rms(src)));
  });
});
