/**
 * The count-in — Directive 09 §2, recording workflow.
 *
 * Two defects are pinned here. It counted at `project.bpm` and
 * `project.timeSig`, which are the values at bar 1, so a take punched in at a
 * tempo or signature change was counted in to a pulse the take would not be
 * recorded at. And an abort cleared the interval without settling the promise
 * the caller was awaiting, so the recorder stuck at `countIn` and refused every
 * later take for the rest of the session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CountIn } from '../src/audio/countIn';
import { createEmptyProject } from '../src/model/demoProject';
import type { ProjectData } from '../src/model/types';

function project(patch: Partial<ProjectData> = {}): ProjectData {
  return { ...createEmptyProject('Count-in'), bpm: 120, timeSig: { num: 4, den: 4 }, ...patch };
}

/** A project that is 120 bpm in 4/4 at bar 1 and 60 bpm in 3/4 from bar 5. */
function withChanges(): ProjectData {
  return project({
    tempoMap: {
      tempos: [
        { id: 't0', beat: 0, bpm: 120, curve: 'jump' },
        { id: 't1', beat: 16, bpm: 60, curve: 'jump' },
      ],
      sigs: [
        { id: 's0', bar: 0, num: 4, den: 4 },
        { id: 's1', bar: 4, num: 3, den: 4 },
      ],
    },
  });
}

interface Log {
  clicks: boolean[];
  beats: number[];
}

function hooks(log: Log) {
  return {
    click: (accent: boolean) => log.clicks.push(accent),
    onBeat: (left: number) => log.beats.push(left),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('counting in', () => {
  it('sounds one click per beat for the requested number of bars', async () => {
    const log: Log = { clicks: [], beats: [] };
    const done = new CountIn().run(project(), 2, 0, hooks(log));
    await vi.advanceTimersByTimeAsync(2 * 4 * 500 + 50);
    expect(await done).toBe(true);
    expect(log.clicks).toHaveLength(8);
  });

  it('accents the downbeats, counted back from the roll point', async () => {
    const log: Log = { clicks: [], beats: [] };
    const done = new CountIn().run(project(), 1, 0, hooks(log));
    await vi.advanceTimersByTimeAsync(4 * 500 + 50);
    await done;
    // ONE two three four — a count-in that accented the wrong beat would be
    // counting the player in on the off-beat.
    expect(log.clicks).toEqual([true, false, false, false]);
  });

  it('counts down to zero exactly once', async () => {
    const log: Log = { clicks: [], beats: [] };
    const done = new CountIn().run(project(), 1, 0, hooks(log));
    await vi.advanceTimersByTimeAsync(4 * 500 + 50);
    await done;
    expect(log.beats).toEqual([4, 3, 2, 1, 0]);
  });

  it('resolves immediately when the count-in is zero bars', async () => {
    const c = new CountIn();
    expect(await c.run(project(), 0, 0, hooks({ clicks: [], beats: [] }))).toBe(true);
    expect(c.running).toBe(false);
  });
});

describe('counting in at the beat the take rolls in from', () => {
  it('takes the tempo from the roll point, not from bar 1', async () => {
    const log: Log = { clicks: [], beats: [] };
    // Beat 16 is bar 5, where the song has dropped to 60 bpm: one second per
    // beat, not half. Against the old code — which read `project.bpm` — the
    // whole bar had already been counted by 2 000 ms and this reads 3.
    new CountIn().run(withChanges(), 1, 16, hooks(log));
    await vi.advanceTimersByTimeAsync(2000);
    expect(log.clicks).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1100);
    expect(log.clicks).toHaveLength(3);
  });

  it('takes the signature from the roll point, not from bar 1', async () => {
    const log: Log = { clicks: [], beats: [] };
    // Bar 5 is in 3/4, so one bar of count-in is three beats. The old code read
    // `project.timeSig` and counted four — a bar of count-in that was not a bar
    // of the music being recorded.
    const done = new CountIn().run(withChanges(), 1, 16, hooks(log));
    await vi.advanceTimersByTimeAsync(4000);
    expect(await done).toBe(true);
    expect(log.clicks).toHaveLength(3);
  });

  it('still counts at bar 1 tempo when the take rolls in there', async () => {
    const log: Log = { clicks: [], beats: [] };
    new CountIn().run(withChanges(), 1, 0, hooks(log));
    await vi.advanceTimersByTimeAsync(2000);
    expect(log.clicks).toHaveLength(4);
  });
});

describe('abandoning a count-in', () => {
  it('settles the promise the caller is waiting on', async () => {
    const c = new CountIn();
    const done = c.run(project(), 4, 0, hooks({ clicks: [], beats: [] }));
    c.abort();
    // Clearing the interval kills the tick that would have noticed the
    // cancellation. Without settling it here this await never returns, and the
    // recorder is stuck at `countIn` for the rest of the session.
    expect(await done).toBe(false);
    expect(c.running).toBe(false);
  });

  it('stops clicking', async () => {
    const log: Log = { clicks: [], beats: [] };
    const c = new CountIn();
    void c.run(project(), 4, 0, hooks(log));
    await vi.advanceTimersByTimeAsync(1100);
    const at = log.clicks.length;
    c.abort();
    await vi.advanceTimersByTimeAsync(4000);
    expect(log.clicks).toHaveLength(at);
  });

  it('is harmless when nothing is counting', () => {
    const c = new CountIn();
    expect(() => c.abort()).not.toThrow();
    expect(c.running).toBe(false);
  });

  it('replaces a count-in already running rather than doubling it', async () => {
    const log: Log = { clicks: [], beats: [] };
    const c = new CountIn();
    const first = c.run(project(), 4, 0, hooks(log));
    const second = c.run(project(), 1, 0, hooks(log));
    // Two intervals on one instance would click twice per beat, which is how a
    // double-pressed record button used to sound.
    expect(await first).toBe(false);
    await vi.advanceTimersByTimeAsync(4 * 500 + 50);
    expect(await second).toBe(true);
    expect(log.clicks.filter(Boolean)).toHaveLength(2); // one accent per run
  });
});
