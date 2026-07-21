/**
 * Lookahead transport scheduler. One instance lives inside the AudioEngine.
 * Pure event-collection helpers are exported for unit testing.
 */
import { beatsPerBar, secondsPerBeat } from '../model/music';
import type { AudioClip, ProjectData } from '../model/types';
import { getMediaDurationSec } from './demoAudio';

export const LOOKAHEAD_SEC = 0.15;
export const TICK_MS = 25;

export type WindowEvent =
  | { kind: 'clip'; clip: AudioClip; beat: number; offsetSec: number }
  | { kind: 'clipMid'; clip: AudioClip; beat: number; intoBeats: number }
  | {
      kind: 'note';
      trackId: string;
      clipId: string;
      pitch: number;
      velocity: number;
      beat: number;
      durBeats: number;
    }
  | { kind: 'metronome'; beat: number; accent: boolean };

/** Events whose start lies in [fromBeat, toBeat). */
export function collectWindowEvents(
  project: ProjectData,
  fromBeat: number,
  toBeat: number,
): WindowEvent[] {
  const out: WindowEvent[] = [];
  if (toBeat <= fromBeat) return out;
  for (const clip of project.clips) {
    if (clip.muted) continue;
    if (clip.type === 'audio') {
      if (clip.start >= fromBeat && clip.start < toBeat) {
        out.push({ kind: 'clip', clip, beat: clip.start, offsetSec: clip.offset });
      }
    } else {
      for (const n of clip.notes) {
        const abs = clip.start + n.start;
        // notes must live inside their clip bounds
        if (n.start >= clip.length) continue;
        if (abs >= fromBeat && abs < toBeat) {
          const durBeats = Math.min(n.length, clip.length - n.start);
          out.push({
            kind: 'note',
            trackId: clip.trackId,
            clipId: clip.id,
            pitch: n.pitch,
            velocity: n.velocity,
            beat: abs,
            durBeats,
          });
        }
      }
    }
  }
  if (project.metronome) {
    const bpb = beatsPerBar(project.timeSig);
    for (let b = Math.ceil(fromBeat - 1e-9); b < toBeat - 1e-9; b++) {
      if (b < fromBeat - 1e-9) continue;
      out.push({ kind: 'metronome', beat: b, accent: Math.abs(b % bpb) < 1e-9 });
    }
  }
  return out;
}

/**
 * Clips/notes already sounding at `beat` (started strictly before it and still
 * running). Used at play start and at loop wrap so mid-clip material is heard.
 */
export function collectSoundingAt(project: ProjectData, beat: number): WindowEvent[] {
  const out: WindowEvent[] = [];
  for (const clip of project.clips) {
    if (clip.muted) continue;
    if (clip.start >= beat || clip.start + clip.length <= beat) continue;
    if (clip.type === 'audio') {
      out.push({ kind: 'clipMid', clip, beat, intoBeats: beat - clip.start });
    } else {
      for (const n of clip.notes) {
        const abs = clip.start + n.start;
        const end = clip.start + Math.min(n.start + n.length, clip.length);
        if (abs < beat && end > beat) {
          out.push({
            kind: 'note',
            trackId: clip.trackId,
            clipId: clip.id,
            pitch: n.pitch,
            velocity: n.velocity,
            beat,
            durBeats: end - beat,
          });
        }
      }
    }
  }
  return out;
}

export interface SchedulerDeps {
  now: () => number;
  getProject: () => ProjectData;
  scheduleClip: (clip: AudioClip, when: number, offsetSec: number) => void;
  scheduleNote: (
    trackId: string,
    clipId: string,
    pitch: number,
    velocity: number,
    when: number,
    durSec: number,
  ) => void;
  scheduleMetronome: (when: number, accent: boolean) => void;
  onLoopWrap?: () => void;
}

interface Anchor {
  ctx: number;
  beat: number;
  spb: number;
}

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBeat = 0;
  private nextCtxTime = 0;
  private anchors: Anchor[] = [];

  constructor(private deps: SchedulerDeps) {}

  get running(): boolean {
    return this.timer !== null;
  }

  start(fromBeat: number): void {
    this.stop();
    const t = this.deps.now() + 0.06;
    this.nextBeat = fromBeat;
    this.nextCtxTime = t;
    const spb = secondsPerBeat(this.deps.getProject().bpm);
    this.anchors = [{ ctx: t, beat: fromBeat, spb }];
    this.scheduleSounding(fromBeat, t);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Jump playback to a new beat (seek while playing). Caller stops old sources. */
  jumpTo(beat: number): void {
    if (!this.running) return;
    const t = this.deps.now() + 0.04;
    this.nextBeat = beat;
    this.nextCtxTime = t;
    const spb = secondsPerBeat(this.deps.getProject().bpm);
    this.anchors.push({ ctx: t, beat, spb });
    this.scheduleSounding(beat, t);
    this.tick();
  }

  /** Re-derive the beat mapping after a bpm change without stopping playback. */
  retime(): void {
    if (!this.running) return;
    const now = this.deps.now();
    const pos = this.positionBeats();
    const spb = secondsPerBeat(this.deps.getProject().bpm);
    // Events up to nextCtxTime are already scheduled under the old tempo; map
    // the beat cursor so new scheduling continues from the same wall-clock time.
    this.nextBeat = pos + Math.max(0, this.nextCtxTime - now) / spb;
    this.anchors.push({ ctx: now, beat: pos, spb });
  }

  positionBeats(): number {
    if (this.anchors.length === 0) return this.nextBeat;
    const now = this.deps.now();
    let a = this.anchors[0];
    for (const cand of this.anchors) {
      if (cand.ctx <= now) a = cand;
      else break;
    }
    return Math.max(0, a.beat + (now - a.ctx) / a.spb);
  }

  private scheduleSounding(beat: number, ctxTime: number): void {
    const p = this.deps.getProject();
    const spb = secondsPerBeat(p.bpm);
    for (const ev of collectSoundingAt(p, beat)) {
      if (ev.kind === 'clipMid') {
        const offsetSec = ev.clip.offset + ev.intoBeats * spb;
        if (offsetSec < getMediaDurationSec(ev.clip.mediaId)) {
          this.deps.scheduleClip(ev.clip, ctxTime, offsetSec);
        }
      } else if (ev.kind === 'note') {
        this.deps.scheduleNote(
          ev.trackId,
          ev.clipId,
          ev.pitch,
          ev.velocity,
          ctxTime,
          ev.durBeats * spb,
        );
      }
    }
  }

  private tick(): void {
    const p = this.deps.getProject();
    const spb = secondsPerBeat(p.bpm);
    const horizon = this.deps.now() + LOOKAHEAD_SEC;
    let guard = 0;
    while (this.nextCtxTime < horizon && guard++ < 64) {
      const loop = p.loop;
      let windowEndBeat = this.nextBeat + (horizon - this.nextCtxTime) / spb;
      let wrap = false;
      if (loop.enabled && this.nextBeat < loop.end && windowEndBeat >= loop.end) {
        windowEndBeat = loop.end;
        wrap = true;
      }
      for (const ev of collectWindowEvents(p, this.nextBeat, windowEndBeat)) {
        const when = this.nextCtxTime + (ev.beat - this.nextBeat) * spb;
        if (ev.kind === 'clip') this.deps.scheduleClip(ev.clip, when, ev.offsetSec);
        else if (ev.kind === 'note')
          this.deps.scheduleNote(
            ev.trackId,
            ev.clipId,
            ev.pitch,
            ev.velocity,
            when,
            ev.durBeats * spb,
          );
        else if (ev.kind === 'metronome') this.deps.scheduleMetronome(when, ev.accent);
      }
      const windowEndCtx = this.nextCtxTime + (windowEndBeat - this.nextBeat) * spb;
      if (wrap) {
        this.nextBeat = loop.start;
        this.nextCtxTime = windowEndCtx;
        this.anchors.push({ ctx: windowEndCtx, beat: loop.start, spb });
        if (this.anchors.length > 24) this.anchors.splice(0, this.anchors.length - 24);
        this.scheduleSounding(loop.start, windowEndCtx);
        this.deps.onLoopWrap?.();
      } else {
        this.nextBeat = windowEndBeat;
        this.nextCtxTime = windowEndCtx;
      }
    }
  }
}
