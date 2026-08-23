import { describe, expect, it } from 'vitest';

import { AutomationLane } from '../automation/lane';
import { AutomationPlayer } from '../automation/player';
import { AutomationRecorder } from '../automation/recorder';
import { ModulationMatrix } from '../automation/modulation';
import { ParamSet } from '../param/set';
import { defineParam } from '../param/spec';
import { Unit } from '../param/units';

const GAIN = 1;
const CUTOFF = 2;
const SPECS = [
  defineParam({ id: GAIN, name: 'Gain', unit: Unit.Decibels, min: -60, max: 12, def: 0 }),
  defineParam({ id: CUTOFF, name: 'Cutoff', unit: Unit.Percent, min: 0, max: 1, def: 0.5 }),
];

function newPlayer(): { set: ParamSet; player: AutomationPlayer } {
  const set = new ParamSet(SPECS);
  return { set, player: new AutomationPlayer(set) };
}

describe('a lane holds points and answers with a ramp', () => {
  it('keeps points sorted however they arrive, and replaces one at the same tick', () => {
    const lane = new AutomationLane(GAIN);
    lane.add({ tick: 960, value: 1, curve: 'linear' });
    lane.add({ tick: 0, value: 0, curve: 'linear' });
    lane.add({ tick: 480, value: 0.25, curve: 'linear' });
    lane.add({ tick: 480, value: 0.75, curve: 'linear' });
    expect(lane.points.map((point) => point.tick)).toEqual([0, 480, 960]);
    expect(lane.points[1].value).toBe(0.75);
  });

  it('holds flat before the first point and after the last rather than extrapolating', () => {
    const lane = new AutomationLane(GAIN, [
      { tick: 480, value: 0.2, curve: 'linear' },
      { tick: 960, value: 0.8, curve: 'linear' },
    ]);
    expect(lane.valueAt(0)).toBeCloseTo(0.2, 12);
    expect(lane.valueAt(100000)).toBeCloseTo(0.8, 12);
  });

  it('interpolates linear, steps on hold, and eases on smooth', () => {
    const linear = new AutomationLane(GAIN, [
      { tick: 0, value: 0, curve: 'linear' },
      { tick: 100, value: 1, curve: 'linear' },
    ]);
    const hold = new AutomationLane(GAIN, [
      { tick: 0, value: 0, curve: 'hold' },
      { tick: 100, value: 1, curve: 'linear' },
    ]);
    const smooth = new AutomationLane(GAIN, [
      { tick: 0, value: 0, curve: 'smooth' },
      { tick: 100, value: 1, curve: 'linear' },
    ]);
    expect(linear.valueAt(50)).toBeCloseTo(0.5, 12);
    // A switch interpolated between two filter modes gives a third of a mode,
    // which the lane cannot know is nonsense unless the point says `hold`.
    expect(hold.valueAt(50)).toBe(0);
    expect(hold.valueAt(99)).toBe(0);
    expect(smooth.valueAt(50)).toBeCloseTo(0.5, 12);
    expect(smooth.valueAt(10)).toBeLessThan(0.1);
    expect(smooth.valueAt(90)).toBeGreaterThan(0.9);
  });

  it('reports a flat span as not moving however many points it contains', () => {
    const lane = new AutomationLane(GAIN);
    for (let tick = 0; tick <= 1000; tick += 10) lane.add({ tick, value: 0.4, curve: 'linear' });
    expect(lane.evaluate(0, 500).moving).toBe(false);
    expect(lane.evaluate(0, 500).end).toBeCloseTo(0.4, 12);
  });

  it('clears a range, which is what a write pass does before it records', () => {
    const lane = new AutomationLane(GAIN);
    for (let tick = 0; tick <= 400; tick += 100) lane.add({ tick, value: 0.5, curve: 'linear' });
    expect(lane.clearRange(100, 300)).toBe(2);
    expect(lane.points.map((point) => point.tick)).toEqual([0, 300, 400]);
  });
});

describe('modulation is summed and clamped once, after automation', () => {
  it('cannot drive a parameter outside its range', () => {
    const matrix = new ModulationMatrix();
    matrix.connect({ sourceId: 'lfo', paramId: GAIN, depth: 0.8 });
    expect(matrix.applyTo(0.9, matrix.offsetFor(GAIN, () => 1))).toBe(1);
    expect(matrix.applyTo(0.1, matrix.offsetFor(GAIN, () => -1))).toBe(0);
  });

  it('clamps once, so two sources near a limit do not cancel each other wrongly', () => {
    const matrix = new ModulationMatrix();
    matrix.connect({ sourceId: 'up', paramId: GAIN, depth: 0.6 });
    matrix.connect({ sourceId: 'down', paramId: GAIN, depth: -0.6 });
    const offset = matrix.offsetFor(GAIN, () => 1);
    // Clamped per source these would give 1.0 then 0.4; clamped once they give
    // back the value the user set, which is what the ADR's single rule buys.
    expect(matrix.applyTo(0.9, offset)).toBeCloseTo(0.9, 12);
  });

  it('replaces a routing rather than doubling it when the same drag happens twice', () => {
    const matrix = new ModulationMatrix();
    matrix.connect({ sourceId: 'lfo', paramId: GAIN, depth: 0.3 });
    matrix.connect({ sourceId: 'lfo', paramId: GAIN, depth: 0.3 });
    expect(matrix.size).toBe(1);
    expect(matrix.offsetFor(GAIN, () => 1)).toBeCloseTo(0.3, 12);
  });

  it('reports the band a face should draw, clamped to what the parameter can reach', () => {
    const matrix = new ModulationMatrix();
    matrix.connect({ sourceId: 'lfo', paramId: GAIN, depth: 0.25 });
    expect(matrix.reachableBand(GAIN, 0.5)).toEqual({ low: 0.25, high: 0.75 });
    expect(matrix.reachableBand(GAIN, 0.9)).toEqual({ low: 0.65, high: 1 });
  });
});

describe('the player is the only thing that moves a parameter without a finger', () => {
  it('plays a lane into the set as automation, not as a user gesture', () => {
    const { set, player } = newPlayer();
    const origins: string[] = [];
    set.subscribe((event) => origins.push(event.origin));
    player.lane(GAIN).add({ tick: 0, value: 0.2, curve: 'linear' });
    player.lane(GAIN).add({ tick: 960, value: 0.8, curve: 'linear' });
    player.advance(0, 480);
    expect(set.normalised(GAIN)).toBeCloseTo(0.5, 9);
    expect(origins).toContain('automation');
  });

  it('sums modulation onto the lane and clamps the result once', () => {
    const { set, player } = newPlayer();
    player.lane(GAIN).add({ tick: 0, value: 0.9, curve: 'linear' });
    player.modulation.connect({ sourceId: 'lfo', paramId: GAIN, depth: 0.5 });
    const moved = player.advance(0, 480, () => 1);
    expect(moved.get(GAIN)?.end).toBe(1);
    expect(set.normalised(GAIN)).toBe(1);
  });

  it('leaves a suspended parameter alone, so a lane never fights a finger', () => {
    const { set, player } = newPlayer();
    player.lane(GAIN).add({ tick: 0, value: 0.1, curve: 'linear' });
    set.setNormalised(GAIN, 0.7, 'user');
    player.suspend(GAIN);
    player.advance(0, 480);
    expect(set.normalised(GAIN)).toBeCloseTo(0.7, 12);
    player.resume(GAIN);
    player.advance(0, 480);
    expect(set.normalised(GAIN)).toBeCloseTo(0.1, 12);
  });
});

describe('latch, touch, write and trim are one mechanism', () => {
  it('touch records while held and hands the parameter back on release', () => {
    const { set, player } = newPlayer();
    const recorder = new AutomationRecorder(player, set);
    recorder.mode = 'touch';
    recorder.start(0);
    recorder.touch(GAIN, 0);
    set.setNormalised(GAIN, 0.8, 'user');
    recorder.advance(480);
    expect(recorder.isWriting(GAIN)).toBe(true);
    recorder.release(GAIN, 960);
    expect(recorder.isWriting(GAIN)).toBe(false);
    expect(player.isSuspended(GAIN)).toBe(false);
    expect(player.lane(GAIN).valueAt(480)).toBeCloseTo(0.8, 9);
  });

  it('latch keeps writing after the hand comes off, until the transport stops', () => {
    const { set, player } = newPlayer();
    const recorder = new AutomationRecorder(player, set);
    recorder.mode = 'latch';
    recorder.start(0);
    recorder.touch(GAIN, 0);
    set.setNormalised(GAIN, 0.6, 'user');
    recorder.release(GAIN, 240);
    expect(recorder.isWriting(GAIN)).toBe(true);
    recorder.advance(960);
    expect(player.lane(GAIN).valueAt(960)).toBeCloseTo(0.6, 9);
    recorder.stop();
    expect(recorder.isWriting(GAIN)).toBe(false);
  });

  it('write begins on the transport, with no gesture at all', () => {
    const { set, player } = newPlayer();
    const recorder = new AutomationRecorder(player, set);
    recorder.mode = 'write';
    recorder.arm(CUTOFF);
    set.setNormalised(CUTOFF, 0.25, 'user');
    recorder.start(0);
    expect(recorder.isWriting(CUTOFF)).toBe(true);
    recorder.advance(480);
    expect(player.lane(CUTOFF).valueAt(480)).toBeCloseTo(0.25, 9);
  });

  it('a second pass replaces the first rather than interleaving with it', () => {
    const { set, player } = newPlayer();
    const recorder = new AutomationRecorder(player, set);
    recorder.mode = 'latch';
    set.setNormalised(GAIN, 0.2, 'user');
    recorder.start(0);
    recorder.touch(GAIN, 0);
    for (let tick = 100; tick <= 500; tick += 100) recorder.advance(tick);
    recorder.stop();
    expect(player.lane(GAIN).points.every((point) => point.value === 0.2)).toBe(true);

    set.setNormalised(GAIN, 0.9, 'user');
    recorder.start(0);
    recorder.touch(GAIN, 0);
    for (let tick = 100; tick <= 500; tick += 100) recorder.advance(tick);
    recorder.stop();

    // Nothing from the first pass survives inside the span the second covered.
    // Without the range clear the two passes interleave and the lane plays a
    // sawtooth between two takes.
    for (const point of player.lane(GAIN).points) {
      expect(point.value).toBeCloseTo(0.9, 9);
    }
  });

  it('trim applies a constant offset to what is underneath, and does not run away', () => {
    const { set, player } = newPlayer();
    const lane = player.lane(GAIN);
    lane.add({ tick: 0, value: 0.2, curve: 'linear' });
    lane.add({ tick: 1000, value: 0.6, curve: 'linear' });

    const recorder = new AutomationRecorder(player, set);
    recorder.mode = 'trim';
    recorder.start(0);
    // The user grabs the control 0.1 above where the lane has it.
    set.setNormalised(GAIN, 0.3, 'user');
    recorder.touch(GAIN, 0);
    for (let tick = 100; tick <= 900; tick += 100) recorder.advance(tick);
    recorder.release(GAIN, 1000);

    // The shape survives, lifted by the offset the user was holding. Reading
    // the live lane back instead of the snapshot would feed the offset into
    // itself and the value would climb to the ceiling on its own.
    expect(lane.valueAt(500)).toBeCloseTo(0.4 + 0.1, 6);
    expect(lane.valueAt(900)).toBeCloseTo(0.56 + 0.1, 6);
    expect(Math.max(...lane.points.map((point) => point.value))).toBeLessThan(0.9);
  });
});
