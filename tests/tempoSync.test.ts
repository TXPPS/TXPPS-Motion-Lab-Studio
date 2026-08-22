/**
 * PA-002 — the tempo a synced insert is driven by, and how often it is re-read.
 *
 * The fix has two halves and they fail differently. Sampling the map at the
 * playhead is the correctness half; gating how often that sample re-drives the
 * chain is the cost half, and getting the gate wrong does not sound wrong — it
 * just puts an update pass on the frame loop for the length of every tempo
 * ramp, which is the shape of PA-001. So both are pinned here.
 */
import { describe, expect, it } from 'vitest';
import { TEMPO_SYNC_EPS, hasTempoSyncedInsert, shouldRetempo, tempoVaries } from '../src/audio/tempoSync';
import { defaultParams } from '../src/model/effects';
import type { Effect, EffectKind } from '../src/model/types';

function fx(kind: EffectKind, overrides: Record<string, number> = {}): Effect {
  return { id: `fx-${kind}`, kind, bypass: false, params: { ...defaultParams(kind), ...overrides } };
}

describe('when to re-drive a tempo-synced chain', () => {
  it('drives once from nothing, whatever the tempo', () => {
    expect(shouldRetempo(0, 120)).toBe(true);
    expect(shouldRetempo(0, 40)).toBe(true);
  });

  it('ignores a move too small to be a rhythm', () => {
    // Half a per cent of 120 is 0.6 bpm. On a 0.5 s delay that is 2.5 ms.
    expect(shouldRetempo(120, 120)).toBe(false);
    expect(shouldRetempo(120, 120 * (1 + TEMPO_SYNC_EPS))).toBe(false);
    expect(shouldRetempo(120, 120.5)).toBe(false);
  });

  it('re-drives on a move that would be heard', () => {
    expect(shouldRetempo(120, 121)).toBe(true);
    expect(shouldRetempo(120, 160)).toBe(true);
    // Symmetric: slowing down counts the same as speeding up.
    expect(shouldRetempo(160, 120)).toBe(true);
  });

  it('costs a bounded number of passes across a ramp rather than one per frame', () => {
    // The number that matters. A 120→160 ramp over eight seconds, sampled at
    // 60 fps, is 480 frames; re-driving each one would run 480 insert update
    // passes, and several effects rebuild a waveshaper curve on any update.
    let held = 0;
    let passes = 0;
    const frames = 480;
    for (let i = 0; i < frames; i++) {
      const bpm = 120 + (160 - 120) * (i / (frames - 1));
      if (shouldRetempo(held, bpm)) {
        held = bpm;
        passes++;
      }
    }
    console.log(`120→160 over ${frames} frames → ${passes} insert passes`);
    expect(passes).toBeLessThan(70);
    // And it must not be so coarse that the tempo is stale at the end.
    expect(Math.abs(held - 160) / 160).toBeLessThanOrEqual(TEMPO_SYNC_EPS);
  });

  it('refuses a tempo that would make every division infinite', () => {
    for (const bad of [0, -120, NaN, Infinity]) {
      expect(shouldRetempo(120, bad), String(bad)).toBe(false);
    }
  });
});

describe('whether tempo tracking is worth running at all', () => {
  it('sees a map that moves and one that does not', () => {
    expect(tempoVaries({ tempoMap: { tempos: [{}, {}] } })).toBe(true);
    expect(tempoVaries({ tempoMap: { tempos: [{}] } })).toBe(false);
    expect(tempoVaries({ tempoMap: null })).toBe(false);
    expect(tempoVaries({})).toBe(false);
  });

  it('finds a synced insert on a track or on the master, and no false positive', () => {
    // Delay defaults to synced; a delay with Tempo sync off reads the tempo for
    // nothing, and neither does an effect that has no sync switch at all.
    const synced = fx('delay', { sync: 1 });
    const free = fx('delay', { sync: 0 });
    expect(hasTempoSyncedInsert({ tracks: [{ effects: [synced] }] })).toBe(true);
    expect(hasTempoSyncedInsert({ tracks: [], master: { effects: [synced] } })).toBe(true);
    expect(hasTempoSyncedInsert({ tracks: [{ effects: [free] }] })).toBe(false);
    expect(hasTempoSyncedInsert({ tracks: [{ effects: [fx('reverb')] }] })).toBe(false);
    expect(hasTempoSyncedInsert({ tracks: [{ effects: [] }, {}] })).toBe(false);
    expect(hasTempoSyncedInsert({})).toBe(false);
  });
});
