/**
 * BUG-004/005 — the fuzz that keeps the stuck note from coming back.
 *
 * Directive 03 §1: "A stuck-note fix without a fuzz test will regress." The
 * scenario tests next door prove the specific gestures that reproduced; this
 * proves the property those gestures were examples of — that after any sequence
 * of presses, releases, cancels and octave shifts, nothing is still held.
 *
 * Deterministic on purpose. A fuzz run that cannot be replayed reports a
 * failure nobody can reproduce, so the generator is seeded and the seed is in
 * the failure message.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { engineStub } from './setup.tsx';

vi.mock('../src/audio/engine', async () => ({
  engine: (await import('./setup.tsx')).engineStub,
}));

const { heldNotes } = await import('../src/audio/heldNotes');

/** The same generator `effectChain.ts` seeds its impulses from. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Note-ons the engine was told about that never got a matching note-off. */
function unmatched(): { trackId: string; pitch: number }[] {
  const calls = (fn: unknown) => (fn as { mock: { calls: unknown[][] } }).mock.calls;
  const offs = calls(engineStub.liveNoteOff).map((c) => `${c[0]}:${c[1]}`);
  const stuck: { trackId: string; pitch: number }[] = [];
  for (const c of calls(engineStub.liveNoteOn)) {
    const key = `${c[0]}:${c[1]}`;
    const i = offs.indexOf(key);
    if (i === -1) stuck.push({ trackId: c[0] as string, pitch: c[1] as number });
    else offs.splice(i, 1);
  }
  return stuck;
}

beforeEach(() => {
  engineStub.reset();
  heldNotes.clearForTest();
});

describe('held notes, fuzzed', () => {
  it('leaves nothing held after 10,000 randomised on/off pairs', () => {
    const SEED = 0x5eed;
    const rand = seeded(SEED);
    const PITCHES = 36;
    const POINTERS = 10;
    let presses = 0;
    let releases = 0;
    let cancels = 0;
    let shifts = 0;
    let octave = 3;

    for (let i = 0; i < 10000; i++) {
      const roll = rand();
      const pointer = Math.floor(rand() * POINTERS);
      if (roll < 0.45) {
        // Press — overlapping pitches on purpose, so the same pitch is held by
        // two pointers at once and released by one of them.
        const pitch = (octave + 1) * 12 + Math.floor(rand() * PITCHES);
        heldNotes.press('fuzz', pointer, 't1', pitch);
        presses++;
      } else if (roll < 0.85) {
        heldNotes.release('fuzz', pointer);
        releases++;
      } else if (roll < 0.95) {
        // A pointer cancelled by a scroll or a system gesture.
        heldNotes.release('fuzz', pointer);
        cancels++;
      } else {
        // Octave moves under whatever is held. The release has to use the
        // pitch that was pressed, not the pitch that key would produce now.
        octave = 1 + Math.floor(rand() * 6);
        shifts++;
      }
    }

    heldNotes.releaseAll();
    console.log(
      `seed 0x${SEED.toString(16)}: ${presses} presses, ${releases} releases, ` +
        `${cancels} cancels, ${shifts} octave shifts → ${heldNotes.size} held, ` +
        `${unmatched().length} unmatched note-ons`,
    );
    expect(heldNotes.size, `seed 0x${SEED.toString(16)}: voices still held`).toBe(0);
    expect(unmatched(), `seed 0x${SEED.toString(16)}: note-ons with no note-off`).toEqual([]);
  });

  it('leaves nothing held across many seeds, without the final release-all', () => {
    // The stronger claim: it is not `releaseAll` that saves it. Every pointer
    // that was pressed gets released by id, and that alone must empty it.
    for (let seed = 1; seed <= 40; seed++) {
      engineStub.reset();
      heldNotes.clearForTest();
      const rand = seeded(seed * 7919);
      const live = new Set<number>();
      for (let i = 0; i < 250; i++) {
        const pointer = Math.floor(rand() * 8);
        if (rand() < 0.55) {
          heldNotes.press('fuzz', pointer, 't1', 40 + Math.floor(rand() * 40));
          live.add(pointer);
        } else {
          heldNotes.release('fuzz', pointer);
          live.delete(pointer);
        }
      }
      for (const pointer of live) heldNotes.release('fuzz', pointer);
      expect(heldNotes.size, `seed ${seed}`).toBe(0);
      expect(unmatched(), `seed ${seed}`).toEqual([]);
    }
  });

  it('keeps two surfaces holding the same pointer id apart', () => {
    // Pointer ids are only unique within a surface. A keyboard and a pad grid
    // both seeing "pointer 1" must not release each other's notes.
    heldNotes.press('keyboard', 1, 't1', 60);
    heldNotes.press('pads', 1, 't1', 36);
    expect(heldNotes.size).toBe(2);
    heldNotes.release('keyboard', 1);
    expect(heldNotes.size).toBe(1);
    expect([...heldNotes.pitches('pads')]).toEqual([36]);
    heldNotes.release('pads', 1);
    expect(heldNotes.size).toBe(0);
  });

  it('turns a glide into a legato line rather than a pile of held notes', () => {
    // One finger crossing five keys: each press releases the previous pitch,
    // so five presses and one lift leave nothing held.
    for (const pitch of [60, 62, 64, 65, 67]) heldNotes.press('keyboard', 1, 't1', pitch);
    expect(heldNotes.size).toBe(1);
    heldNotes.release('keyboard', 1);
    expect(heldNotes.size).toBe(0);
    expect(unmatched()).toEqual([]);
  });

  it('ignores a repeat press of the pitch already held by that finger', () => {
    // `pointerenter` fires repeatedly while a finger rests on a key. Each one
    // must not retrigger the note.
    for (let i = 0; i < 10; i++) heldNotes.press('keyboard', 1, 't1', 60);
    const calls = (engineStub.liveNoteOn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.length).toBe(1);
  });

  it('releases one surface without touching another', () => {
    heldNotes.press('keyboard', 1, 't1', 60);
    heldNotes.press('pads', 2, 't1', 36);
    heldNotes.releaseAll('keyboard');
    expect([...heldNotes.pitches('pads')]).toEqual([36]);
    expect(heldNotes.size).toBe(1);
  });

  it('is a no-op to release something never pressed', () => {
    heldNotes.release('keyboard', 99);
    heldNotes.releaseAll('nothing-here');
    expect(heldNotes.size).toBe(0);
    const calls = (engineStub.liveNoteOff as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    expect(calls.length).toBe(0);
  });
});
