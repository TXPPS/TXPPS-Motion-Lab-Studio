/**
 * Audio-editing actions that need buffer access (analysis) or coordinate
 * multi-clip store operations with user feedback. The store stays pure; this
 * layer reads decoded audio and reports honestly when it cannot.
 */
import { engine } from '../audio/engine';
import { getBufferSync } from '../audio/mediaLibrary';
import { getMediaDurationSec } from '../audio/demoAudio';
import { secondsPerBeat } from '../model/music';
import type { AudioClip, FadeShape } from '../model/types';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';

const toast = (level: 'info' | 'error', msg: string) => useUiStore.getState().toast(level, msg);

/** Best known duration of a media source, in seconds (0 when unknown). */
export function mediaDurationSec(mediaId: string): number {
  const buf = getBufferSync(mediaId);
  if (buf) return buf.duration;
  const proc = getMediaDurationSec(mediaId);
  if (proc > 0) return proc;
  const ref = useProjectStore.getState().project.media?.find((m) => m.id === mediaId);
  return ref?.duration ?? 0;
}

/** Slip headroom: how far the clip's offset may go before running out of source. */
export function maxSlipOffset(clip: AudioClip): number | undefined {
  const dur = mediaDurationSec(clip.mediaId);
  if (dur <= 0) return undefined;
  const spb = secondsPerBeat(useProjectStore.getState().project.bpm);
  const need = clip.sourceDuration ?? clip.length * spb;
  return Math.max(0, dur - need);
}

export interface ClipAnalysis {
  peak: number;
  /** mean sample value — a healthy recording sits near zero */
  dcOffset: number;
  sampleRate: number;
  channels: number;
}

/** Analyze the clip's used window. Returns null when audio is not decoded yet. */
export function analyzeClip(clip: AudioClip): ClipAnalysis | null {
  const buf = getBufferSync(clip.mediaId);
  if (!buf) return null;
  const spb = secondsPerBeat(useProjectStore.getState().project.bpm);
  const from = Math.max(0, Math.floor(clip.offset * buf.sampleRate));
  const lenSec = clip.sourceDuration ?? clip.length * spb;
  const to = Math.min(buf.length, Math.ceil((clip.offset + lenSec) * buf.sampleRate));
  if (to <= from) return null;
  let peak = 0;
  let sum = 0;
  let count = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    // Stride keeps very long clips affordable; 4M samples is plenty of truth.
    const stride = Math.max(1, Math.floor((to - from) / 4_000_000));
    for (let i = from; i < to; i += stride) {
      const v = data[i];
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v;
      count++;
    }
  }
  return {
    peak,
    dcOffset: count ? sum / count : 0,
    sampleRate: buf.sampleRate,
    channels: buf.numberOfChannels,
  };
}

/** Non-destructive normalize: set clip gain so the peak lands at -0.3 dBFS. */
export function normalizeClip(clipId: string): void {
  const p = useProjectStore.getState().project;
  const clip = p.clips.find((c) => c.id === clipId);
  if (clip?.type !== 'audio') return;
  const a = analyzeClip(clip);
  if (!a) {
    toast('error', 'Start audio once so the clip can be decoded, then normalize.');
    return;
  }
  if (a.peak < 1e-6) {
    toast('info', 'The clip is silent — nothing to normalize.');
    return;
  }
  const target = Math.pow(10, -0.3 / 20);
  useProjectStore.getState().setClipGain(clipId, target / a.peak);
  toast('info', `Normalized: gain ${(target / a.peak).toFixed(2)}×`);
}

/** Crossfade the two selected same-track audio clips at their junction. */
export function crossfadeSelection(shape: FadeShape, lengthBeats?: number): void {
  const ids = useUiStore.getState().selectedClipIds;
  const clips = useProjectStore
    .getState()
    .project.clips.filter((c) => ids.includes(c.id) && c.type === 'audio') as AudioClip[];
  if (clips.length !== 2 || clips[0].trackId !== clips[1].trackId) {
    toast('info', 'Select two audio clips on the same track to crossfade.');
    return;
  }
  const [a, b] = clips.sort((x, y) => x.start - y.start);
  const len = lengthBeats ?? Math.min(1, a.length / 2, b.length / 2);
  const ok = useProjectStore.getState().createCrossfade(a.id, b.id, len, shape);
  if (!ok) {
    toast(
      'info',
      'No crossfade: the clips need to touch, and at least one side needs spare material.',
    );
  }
}

export function healSelection(): void {
  const ids = useUiStore.getState().selectedClipIds;
  const joins = useProjectStore.getState().healClips(ids);
  toast('info', joins ? `Healed ${joins} split${joins === 1 ? '' : 's'}` : 'Nothing to heal: clips must be adjacent pieces of the same material.');
}

export function rippleDeleteSelection(): void {
  const ids = useUiStore.getState().selectedClipIds;
  if (ids.length === 0) return;
  useProjectStore.getState().rippleDeleteClips(ids);
  useUiStore.getState().selectClips([]);
}

export function packSelectionIntoTakes(): void {
  const ids = useUiStore.getState().selectedClipIds;
  const id = useProjectStore.getState().packTakes(ids);
  if (id) {
    useUiStore.getState().selectClip(id);
    toast('info', 'Packed into take lanes — swipe across a lane to comp.');
  } else {
    toast('info', 'Pack takes needs two or more audio clips on the same track.');
  }
}

/** Zoom the arrangement so the clip selection fills the view. */
export function zoomToSelection(): void {
  const ids = useUiStore.getState().selectedClipIds;
  const clips = useProjectStore.getState().project.clips.filter((c) => ids.includes(c.id));
  if (clips.length === 0) {
    toast('info', 'Select clips first, then zoom to the selection.');
    return;
  }
  const from = Math.min(...clips.map((c) => c.start));
  const to = Math.max(...clips.map((c) => c.start + c.length));
  const vp = document.querySelector('[data-testid="arr-scroll"]') as HTMLElement | null;
  if (!vp) return;
  const headerW =
    (vp.querySelector('.arr-header-col') as HTMLElement | null)?.clientWidth ?? 0;
  const viewW = Math.max(100, vp.clientWidth - headerW - 40);
  const ppb = Math.min(120, Math.max(6, viewW / Math.max(0.5, to - from)));
  useUiStore.getState().set({ pxPerBeat: Math.round(ppb * 10) / 10 });
  requestAnimationFrame(() => {
    vp.scrollLeft = Math.max(0, from * ppb - 20);
  });
}

/** Was audio decoded for this clip? Used to enable analysis affordances. */
export function clipBufferReady(clip: AudioClip): boolean {
  return !!getBufferSync(clip.mediaId);
}

/** Kick a decode so analysis affordances light up (needs a running context). */
export async function ensureClipDecoded(clip: AudioClip): Promise<boolean> {
  if (clipBufferReady(clip)) return true;
  const ctx = engine.context;
  if (!ctx) return false;
  const { loadBuffer } = await import('../audio/mediaLibrary');
  return !!(await loadBuffer(clip.mediaId, ctx));
}
