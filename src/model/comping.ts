/**
 * Non-destructive comping: pure helpers that turn a take clip (takes + comp
 * segments) into the plain audio clips that actually get scheduled. Live
 * playback and the offline render both expand through here, so a comp cannot
 * sound different in a bounce than it did on the timeline.
 */
import { newId } from './ids';
import type { AudioClip, CompSegment, Take } from './types';

/** Tiny fade applied at internal comp joins so a cut can never click. */
export const COMP_JOIN_FADE_SEC = 0.004;

export interface CompSpan {
  take: Take;
  /** beats relative to the clip start */
  fromBeat: number;
  toBeat: number;
}

/** Normalize comp segments over the available takes: sorted, deduped,
 *  starting at 0, every id resolvable (unresolvable segments are dropped;
 *  an empty result falls back to the first take). */
export function normalizeComp(
  segments: CompSegment[] | undefined,
  takes: Take[],
  clipLengthBeats: number,
): CompSegment[] {
  if (takes.length === 0) return [];
  const ids = new Set(takes.map((t) => t.id));
  const clean = (segments ?? [])
    .filter((s) => ids.has(s.takeId) && Number.isFinite(s.at))
    .map((s) => ({ at: Math.max(0, Math.min(s.at, clipLengthBeats)), takeId: s.takeId }))
    .sort((a, b) => a.at - b.at);
  if (clean.length === 0 || clean[0].at > 1e-9) {
    clean.unshift({ at: 0, takeId: clean[0]?.takeId ?? takes[0].id });
  }
  // collapse zero-length and same-take runs
  const out: CompSegment[] = [];
  for (const s of clean) {
    const prev = out[out.length - 1];
    if (prev && s.at - prev.at < 1e-9) {
      prev.takeId = s.takeId; // later write wins at the same instant
    } else if (!prev || prev.takeId !== s.takeId) {
      out.push({ ...s });
    }
  }
  return out;
}

/** The spans the comp resolves to across the clip. */
export function compSpans(clip: AudioClip): CompSpan[] {
  const takes = clip.takes ?? [];
  if (takes.length === 0) return [];
  if (clip.soloTakeId) {
    const solo = takes.find((t) => t.id === clip.soloTakeId);
    if (solo) return [{ take: solo, fromBeat: 0, toBeat: clip.length }];
  }
  const segs = normalizeComp(clip.comp, takes, clip.length);
  const byId = new Map(takes.map((t) => [t.id, t]));
  const out: CompSpan[] = [];
  for (let i = 0; i < segs.length; i++) {
    const take = byId.get(segs[i].takeId);
    if (!take) continue;
    const from = segs[i].at;
    const to = i + 1 < segs.length ? segs[i + 1].at : clip.length;
    if (to - from > 1e-9) out.push({ take, fromBeat: from, toBeat: to });
  }
  return out;
}

/**
 * Expand a take clip into plain scheduling clips, one per comp span. Internal
 * joins get a tiny fade on both sides; the clip's own fades apply to the
 * first/last span (clamped to the span). Returns the clip itself when it has
 * no takes.
 */
export function expandCompClip(clip: AudioClip, secondsPerBeat: number): AudioClip[] {
  if (!clip.takes || clip.takes.length === 0) return [clip];
  const spans = compSpans(clip);
  if (spans.length === 0) return [];
  const out: AudioClip[] = [];
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    const spanBeats = s.toBeat - s.fromBeat;
    const spanSec = spanBeats * secondsPerBeat;
    const first = i === 0;
    const last = i === spans.length - 1;
    let offset = s.take.offset + s.fromBeat * secondsPerBeat;
    let startBeat = clip.start + s.fromBeat;
    let sec = spanSec;
    if (offset < 0) {
      // A take that starts later than the clip has no material here; play
      // what exists and let silence cover the rest.
      const missingSec = -offset;
      offset = 0;
      startBeat += missingSec / secondsPerBeat;
      sec -= missingSec;
      if (sec <= 0.001) continue;
    }
    out.push({
      id: `${clip.id}~${s.take.id}~${i}`,
      trackId: clip.trackId,
      type: 'audio',
      name: clip.name,
      start: startBeat,
      length: sec / secondsPerBeat,
      muted: clip.muted,
      mediaId: s.take.mediaId,
      offset,
      sourceDuration: sec,
      gain: clip.gain,
      fadeIn: Math.min(first ? Math.max(clip.fadeIn, 0) : COMP_JOIN_FADE_SEC, sec / 2),
      fadeOut: Math.min(last ? Math.max(clip.fadeOut, 0) : COMP_JOIN_FADE_SEC, sec / 2),
      ...(first && clip.fadeInShape ? { fadeInShape: clip.fadeInShape } : {}),
      ...(last && clip.fadeOutShape ? { fadeOutShape: clip.fadeOutShape } : {}),
      ...(clip.phaseInvert ? { phaseInvert: true } : {}),
      ...(clip.monoSum ? { monoSum: true } : {}),
    });
  }
  return out;
}

/**
 * Pack overlapping audio clips into one take clip covering the earliest
 * clip's span. Every clip contributes a take whose offset is shifted so its
 * material lands where it did on the timeline. Pure: returns the new clip;
 * the store decides what to delete.
 */
export function buildTakeClip(clips: AudioClip[], secondsPerBeat: number): AudioClip | null {
  const audio = clips.filter((c) => c.type === 'audio');
  if (audio.length < 2) return null;
  const base = audio.reduce((a, b) => (b.start < a.start ? b : a));
  const end = Math.max(...audio.map((c) => c.start + c.length));
  const lengthBeats = end - base.start;
  const takes: Take[] = audio.map((c, i) => ({
    id: newId('tk'),
    name: c.name || `Take ${i + 1}`,
    mediaId: c.mediaId,
    // may be negative when this clip starts later than the base start;
    // expansion clamps and leaves silence, which is what the timeline showed.
    offset: c.offset - (c.start - base.start) * secondsPerBeat,
  }));
  return {
    id: newId('c'),
    trackId: base.trackId,
    type: 'audio',
    name: `${base.name} takes`,
    start: base.start,
    length: lengthBeats,
    muted: false,
    mediaId: base.mediaId,
    offset: base.offset,
    sourceDuration: lengthBeats * secondsPerBeat,
    gain: base.gain,
    fadeIn: 0,
    fadeOut: 0,
    takes,
    comp: [{ at: 0, takeId: takes[0].id }],
    takesOpen: true,
  };
}
