import { describe, expect, it } from 'vitest';
import {
  analyseTransients,
  detectTransients,
  estimateTempo,
  spectralFlatness,
} from '../src/model/transients';

const SR = 44100;

function clickTrain(intervalSec: number, count: number, startSec = 0.1, tailSec = 0.5) {
  const length = Math.round((startSec + intervalSec * count + tailSec) * SR);
  const data = new Float32Array(length);
  const times: number[] = [];
  const decay = Math.round(0.004 * SR);
  for (let c = 0; c < count; c++) {
    const at = Math.round((startSec + c * intervalSec) * SR);
    times.push(at / SR);
    for (let i = 0; i < decay && at + i < length; i++) {
      data[at + i] = Math.exp(-i / (decay / 4)) * Math.sin((2 * Math.PI * 2000 * i) / SR);
    }
  }
  return { data, times };
}

describe('sanity', () => {
  it('clicks', () => {
    const { data, times } = clickTrain(0.5, 8);
    const a = analyseTransients(data, SR);
    console.log('flatness', a.flatness, 'method', a.method, 'n', a.transients.length);
    console.log('times', a.transients.map((t) => t.timeSec.toFixed(4)).join(' '));
    console.log('expected', times.map((t) => t.toFixed(4)).join(' '));
    console.log('strengths', a.transients.map((t) => t.strength.toFixed(2)).join(' '));
    console.log('tempo', a.tempo);
    console.log('snapped', estimateTempo(data, SR));
  });

  it('noise', () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296 - 0.5;
    };
    const data = new Float32Array(SR * 4);
    for (let i = 0; i < data.length; i++) data[i] = rnd() * 0.5;
    const a = analyseTransients(data, SR);
    console.log('noise flatness', a.flatness, a.method, 'onsets', a.transients.length, a.tempo);
  });

  it('silence', () => {
    const data = new Float32Array(SR * 2);
    console.log('silence', detectTransients(data, SR).length, estimateTempo(data, SR));
  });

  it('sine flatness', () => {
    const data = new Float32Array(SR);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin((2 * Math.PI * 440 * i) / SR);
    console.log('sine flatness', spectralFlatness(data, SR));
  });
});
