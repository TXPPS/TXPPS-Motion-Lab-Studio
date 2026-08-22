/**
 * Cue mixes — what each performer hears in their headphones.
 *
 * A cue is not a copy of the session: it is the same channels at a different
 * balance. So it stores only the channels somebody has actually asked about,
 * and everything else follows the main mix. That is what makes it usable on a
 * live tracking date, where the singer wants more of themselves and nobody has
 * time to build a twenty-channel mix from silence.
 *
 * Pure: no store, no Web Audio.
 */
import type { CueMix, CueSend, Track } from './types';

/** Enough for a band; past this the console is the wrong tool. */
export const MAX_CUE_MIXES = 8;

/** What a channel does in a cue, resolved against the main mix it may follow. */
export function cueSendOf(cue: CueMix, track: Track): CueSend {
  const stored = cue.sends[track.id];
  if (!stored || stored.follow) {
    return { level: track.volume, pan: track.pan, mute: stored?.mute === true, follow: true };
  }
  return stored;
}

/** How many channels this cue actually departs from the main mix on. */
export function cueTouchedCount(cue: CueMix): number {
  return Object.values(cue.sends).filter((s) => !s.follow || s.mute).length;
}

export function findCue(
  cues: readonly CueMix[] | undefined,
  cueId: string | null | undefined,
): CueMix | undefined {
  if (!cueId || !cues) return undefined;
  return cues.find((c) => c.id === cueId);
}

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

function normalizeSend(raw: unknown): CueSend | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  return {
    level: num(r.level, 0, 1.5, 1),
    pan: num(r.pan, -1, 1, 0),
    mute: r.mute === true,
    follow: r.follow !== false,
  };
}

export function normalizeCueMixes(raw: unknown, trackIds: ReadonlySet<string>): CueMix[] {
  if (!Array.isArray(raw)) return [];
  const out: CueMix[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || out.some((c) => c.id === r.id)) continue;
    const sends: Record<string, CueSend> = {};
    if (typeof r.sends === 'object' && r.sends !== null) {
      for (const [trackId, value] of Object.entries(r.sends as Record<string, unknown>)) {
        // A send for a track that is gone would be invisible and would come
        // back to life if a new track ever reused the id.
        if (!trackIds.has(trackId)) continue;
        const send = normalizeSend(value);
        if (send) sends[trackId] = send;
      }
    }
    out.push({
      id: r.id,
      name: typeof r.name === 'string' ? r.name.slice(0, 40) : 'Cue',
      level: num(r.level, 0, 1.5, 1),
      sends,
      ignoreSolo: r.ignoreSolo !== false,
    });
    if (out.length >= MAX_CUE_MIXES) break;
  }
  return out;
}
