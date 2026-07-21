import { describe, expect, it } from 'vitest';
import {
  beatsPerBar,
  beatsToSeconds,
  dbToLin,
  faderPosToGain,
  formatPosition,
  formatTime,
  gainToFaderPos,
  linToDb,
  midiToFreq,
  midiToName,
  secondsToBeats,
  snapBeat,
  snapBeatFloor,
  wrapLoopBeat,
} from '../src/model/music';

describe('tempo conversions', () => {
  it('beats <-> seconds round-trip', () => {
    expect(beatsToSeconds(4, 120)).toBeCloseTo(2);
    expect(secondsToBeats(2, 120)).toBeCloseTo(4);
    expect(beatsToSeconds(1, 60)).toBeCloseTo(1);
  });
});

describe('time signature', () => {
  it('computes quarter beats per bar', () => {
    expect(beatsPerBar({ num: 4, den: 4 })).toBe(4);
    expect(beatsPerBar({ num: 3, den: 4 })).toBe(3);
    expect(beatsPerBar({ num: 6, den: 8 })).toBe(3);
    expect(beatsPerBar({ num: 7, den: 8 })).toBeCloseTo(3.5);
  });
});

describe('formatPosition', () => {
  it('is 1-based bars.beats.sixteenths', () => {
    expect(formatPosition(0, { num: 4, den: 4 })).toBe('1.1.1');
    expect(formatPosition(4, { num: 4, den: 4 })).toBe('2.1.1');
    expect(formatPosition(5.5, { num: 4, den: 4 })).toBe('2.2.3');
  });
});

describe('formatTime', () => {
  it('formats m:ss.t', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(65.4)).toBe('1:05.4');
    expect(formatTime(-3)).toBe('0:00.0');
  });
});

describe('decibel helpers', () => {
  it('linToDb and dbToLin invert', () => {
    expect(linToDb(1)).toBeCloseTo(0);
    expect(dbToLin(0)).toBeCloseTo(1);
    expect(linToDb(dbToLin(-6))).toBeCloseTo(-6);
    expect(linToDb(0)).toBe(-Infinity);
    expect(dbToLin(-Infinity)).toBe(0);
  });
});

describe('fader curve', () => {
  it('maps 0..1 position to 0..1.5 gain at the ends', () => {
    expect(faderPosToGain(0)).toBeCloseTo(0);
    expect(faderPosToGain(1)).toBeCloseTo(1.5);
  });
  it('gainToFaderPos inverts faderPosToGain', () => {
    for (const g of [0.05, 0.25, 0.85, 1.0, 1.5]) {
      expect(faderPosToGain(gainToFaderPos(g))).toBeCloseTo(g, 4);
    }
  });
  it('is monotonic', () => {
    expect(faderPosToGain(0.3)).toBeLessThan(faderPosToGain(0.6));
  });
});

describe('snap', () => {
  it('snaps to nearest and floors', () => {
    expect(snapBeat(1.1, 0.25)).toBeCloseTo(1.0);
    expect(snapBeat(1.2, 0.25)).toBeCloseTo(1.25);
    expect(snapBeat(3.7, 0)).toBe(3.7); // snap off
    expect(snapBeatFloor(1.9, 1)).toBe(1);
    expect(snapBeatFloor(1.999, 0.5)).toBeCloseTo(1.5);
  });
});

describe('wrapLoopBeat', () => {
  const loop = { enabled: true, start: 4, end: 8 };
  it('passes through before loop end', () => {
    expect(wrapLoopBeat(2, loop)).toBe(2);
    expect(wrapLoopBeat(7.9, loop)).toBeCloseTo(7.9);
  });
  it('wraps within the loop window', () => {
    expect(wrapLoopBeat(8, loop)).toBeCloseTo(4);
    expect(wrapLoopBeat(9, loop)).toBeCloseTo(5);
    expect(wrapLoopBeat(12, loop)).toBeCloseTo(4);
  });
  it('is identity when disabled', () => {
    expect(wrapLoopBeat(20, { enabled: false, start: 0, end: 8 })).toBe(20);
  });
});

describe('midi helpers', () => {
  it('names middle C correctly', () => {
    expect(midiToName(60)).toBe('C4');
    expect(midiToName(69)).toBe('A4');
    expect(midiToName(61)).toBe('C#4');
  });
  it('A4 is 440 Hz', () => {
    expect(midiToFreq(69)).toBeCloseTo(440);
    expect(midiToFreq(57)).toBeCloseTo(220);
    expect(midiToFreq(81)).toBeCloseTo(880);
  });
});
