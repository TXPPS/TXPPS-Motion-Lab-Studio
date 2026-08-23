import { describe, expect, it } from 'vitest';

import { METER_FLOOR_DB, MeterBus, amplitudeToDb } from '../metering/bus';
import { MeterSnapshot } from '../metering/snapshot';

describe('the up path never makes the producer wait', () => {
  it('hands the reader the last complete frame', () => {
    const snapshot = new MeterSnapshot(3);
    snapshot.publish([0.25, 0.5, 0.75]);
    const into = new Float32Array(3);
    expect(snapshot.read(into)).toBe(true);
    expect([...into]).toEqual([0.25, 0.5, 0.75]);
  });

  it('refuses to report a frame it caught mid-write, instead of blocking for it', () => {
    const snapshot = new MeterSnapshot(2);
    snapshot.publish([1, 1]);
    // The odd sequence is what a write in progress looks like. A lock would
    // make the reader wait here, and a reader that waits on the audio thread is
    // a dropout waiting for the compositor to be busy.
    snapshot.beginWriteForTest();
    expect(snapshot.read(new Float32Array(2))).toBe(false);
    snapshot.endWriteForTest();
    expect(snapshot.read(new Float32Array(2))).toBe(true);
  });

  it('leaves the sequence even when a publish throws, so the meter does not freeze', () => {
    const snapshot = new MeterSnapshot(2);
    const hostile = {
      length: 2,
      get 0() {
        return 0.5;
      },
      get 1(): number {
        throw new Error('the producer blew up mid-frame');
      },
    } as unknown as ArrayLike<number>;
    expect(() => snapshot.publish(hostile)).toThrow();
    // Without the finally, the sequence stays odd and every later read fails
    // forever: one bad frame would stop the meter for the rest of the session.
    expect(snapshot.version % 2).toBe(0);
    expect(snapshot.read(new Float32Array(2))).toBe(true);
  });

  it('never writes outside its slots', () => {
    const snapshot = new MeterSnapshot(2);
    snapshot.publish([1, 2, 3, 4]);
    snapshot.publishSlot(9, 1);
    const into = new Float32Array(2);
    snapshot.read(into);
    expect([...into]).toEqual([1, 2]);
  });
});

describe('a reader keeps the frame it had when it misses one', () => {
  it('repeats the previous frame rather than flashing to zero', () => {
    const bus = new MeterBus([
      { name: 'in', kind: 'peak' },
      { name: 'out', kind: 'peak' },
    ]);
    const reader = bus.reader();
    bus.publish([0.5, 0.25]);
    reader.poll();
    expect(reader.value('in')).toBeCloseTo(0.5, 6);

    bus.snapshot.beginWriteForTest();
    expect(reader.poll()).toBe(false);
    // A meter that repeats a frame at 60 fps is invisible; one that drops to
    // zero for a frame is a flash the eye catches every time.
    expect(reader.value('in')).toBeCloseTo(0.5, 6);
    expect(reader.missedFrames).toBe(1);
    bus.snapshot.endWriteForTest();
  });

  it('holds a peak and lets it fall at the rate it was given', () => {
    const bus = new MeterBus([{ name: 'out', kind: 'peak' }]);
    const reader = bus.reader();
    bus.publish([1]);
    reader.poll(0.4);
    expect(reader.holdOf('out')).toBeCloseTo(1, 6);

    bus.publish([0]);
    reader.poll(0.4);
    expect(reader.heldDb('out')).toBeCloseTo(-0.4, 2);
    for (let frame = 0; frame < 59; frame++) reader.poll(0.4);
    // 60 frames at 0.4 dB is the ~24 dB/second fall that reads as a meter.
    expect(reader.heldDb('out')).toBeCloseTo(-24, 1);
  });

  it('refuses a bus with a duplicate channel, which would silently shadow one', () => {
    expect(
      () =>
        new MeterBus([
          { name: 'out', kind: 'peak' },
          { name: 'out', kind: 'rms' },
        ]),
    ).toThrow();
  });
});

describe('the dB conversion has a floor rather than an infinity', () => {
  it('reports digital silence as the floor', () => {
    expect(amplitudeToDb(0)).toBe(METER_FLOOR_DB);
    expect(amplitudeToDb(1)).toBeCloseTo(0, 9);
    expect(amplitudeToDb(-0.5)).toBeCloseTo(-6.0206, 3);
  });
});
