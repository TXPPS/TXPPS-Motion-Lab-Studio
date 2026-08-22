/**
 * Lookahead transport scheduler. One instance lives inside the AudioEngine.
 * Pure event-collection helpers are exported for unit testing.
 */
import { tempoMapOf } from '../model/music';
import {
  beatRangeSec,
  beatToBar,
  beatToSec,
  secToBeat,
  sigAtBeat,
  type TempoMap,
} from '../model/tempo';
import type { AudioClip, Clip, MidiClip, ProjectData } from '../model/types';
import { freezeClipFor, isFrozen } from '../model/freeze';
import { playedNotes } from './notePipeline';
import { mediaDurationSec } from './mediaLibrary';
import { startSteadyTimer, type SteadyTimer } from './workerTimer';

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

/**
 * Everything the transport has to schedule for this project.
 *
 * A frozen track contributes its print instead of its notes: the print is a
 * synthetic audio clip covering the whole song, so it enters and leaves the
 * scheduling window exactly as a long audio clip does, and the track's own
 * notes are never looked at — which is where a freeze's CPU saving comes from
 * on this side of the engine.
 */
function schedulableClips(project: ProjectData): Clip[] {
  const frozen = project.tracks.filter(isFrozen);
  if (frozen.length === 0) return project.clips;
  const ids = new Set(frozen.map((t) => t.id));
  const out: Clip[] = project.clips.filter((c) => c.type === 'audio' || !ids.has(c.trackId));
  for (const track of frozen) {
    const clip = freezeClipFor(project, track);
    if (clip) out.push(clip);
  }
  return out;
}

/** Events whose start lies in [fromBeat, toBeat). */
export function collectWindowEvents(
  project: ProjectData,
  fromBeat: number,
  toBeat: number,
): WindowEvent[] {
  const out: WindowEvent[] = [];
  if (toBeat <= fromBeat) return out;
  for (const clip of schedulableClips(project)) {
    if (clip.muted) continue;
    if (clip.type === 'audio') {
      if (clip.start >= fromBeat && clip.start < toBeat) {
        out.push({ kind: 'clip', clip, beat: clip.start, offsetSec: clip.offset });
      }
    } else {
      const track = project.tracks.find((t) => t.id === clip.trackId);
      for (const n of playedNotes(project, clip as MidiClip, track)) {
        if (n.muted) continue;
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
    const map = tempoMapOf(project);
    // The click counts the signature's denominator, not quarter notes: 6/8
    // clicks six times a bar, 3/4 three times, and the downbeat is accented
    // wherever the signature map says a bar begins.
    const unit = 4 / sigAtBeat(map, Math.max(0, fromBeat)).den;
    const first = Math.ceil((fromBeat - 1e-9) / unit) * unit;
    for (let b = first; b < toBeat - 1e-9; b += unit) {
      if (b < fromBeat - 1e-9) continue;
      const bar = beatToBar(map, b);
      out.push({ kind: 'metronome', beat: b, accent: Math.abs(bar - Math.round(bar)) < 1e-6 });
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
  for (const clip of schedulableClips(project)) {
    if (clip.muted) continue;
    if (clip.start >= beat || clip.start + clip.length <= beat) continue;
    if (clip.type === 'audio') {
      out.push({ kind: 'clipMid', clip, beat, intoBeats: beat - clip.start });
    } else {
      const track = project.tracks.find((t) => t.id === clip.trackId);
      for (const n of playedNotes(project, clip as MidiClip, track)) {
        if (n.muted) continue;
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
  /**
   * The transport is about to wrap, at `atCtxTime`. Called before the new pass
   * is scheduled, so a listener that stops the outgoing one cannot catch the
   * incoming one by mistake.
   */
  onLoopWrap?: (atCtxTime: number) => void;
  /**
   * Called at the end of every tick. Control-rate work that must survive a
   * backgrounded tab (automation) rides this rather than the animation frame,
   * which stops being called at all when the tab is hidden.
   */
  onTick?: () => void;
}

/**
 * A point where the audio clock and the song clock are known to coincide.
 *
 * Under a tempo map there is no single seconds-per-beat to extrapolate with, so
 * an anchor stores the *song time* at a context time and every conversion goes
 * back through the map. Anchors accumulate at play, seek, loop wrap and tempo
 * edit; the newest one at or before `now` wins, which keeps already-scheduled
 * material mapped under the tempo it was scheduled with.
 */
interface Anchor {
  ctx: number;
  /** seconds from the start of the song at `ctx` */
  sec: number;
}

/**
 * How many anchors are kept. `positionBeats` scans them linearly and is called
 * from the frame loop, the automation pass and the transport store — roughly
 * 180 times a second — so the list has to stay short. Two dozen is far more
 * than the handful the newest-at-or-before-now lookup can ever reach back
 * through, and the older ones describe time that has already been played.
 */
const MAX_ANCHORS = 24;

export class Scheduler {
  private timer: SteadyTimer | null = null;
  private nextBeat = 0;
  private nextCtxTime = 0;
  private anchors: Anchor[] = [];

  constructor(private deps: SchedulerDeps) {}

  get running(): boolean {
    return this.timer !== null;
  }

  /** True when the transport tick survives a backgrounded tab. */
  get backgroundSafe(): boolean {
    return this.timer?.backgroundSafe ?? false;
  }

  private map(): TempoMap {
    return tempoMapOf(this.deps.getProject());
  }

  start(fromBeat: number): void {
    this.stop();
    const t = this.deps.now() + 0.06;
    this.nextBeat = fromBeat;
    this.nextCtxTime = t;
    this.anchors = [{ ctx: t, sec: beatToSec(this.map(), fromBeat) }];
    this.scheduleSounding(fromBeat, t);
    this.timer = startSteadyTimer(TICK_MS, () => this.tick());
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) {
      this.timer.stop();
      this.timer = null;
    }
  }

  /** Jump playback to a new beat (seek while playing). Caller stops old sources. */
  jumpTo(beat: number): void {
    if (!this.running) return;
    const t = this.deps.now() + 0.04;
    this.nextBeat = beat;
    this.nextCtxTime = t;
    this.anchors.push({ ctx: t, sec: beatToSec(this.map(), beat) });
    this.trimAnchors();
    this.scheduleSounding(beat, t);
    this.tick();
  }

  /** Re-derive the beat mapping after a tempo edit without stopping playback. */
  retime(): void {
    if (!this.running) return;
    const now = this.deps.now();
    const pos = this.positionBeats();
    const map = this.map();
    const nowSec = beatToSec(map, pos);
    // Events up to nextCtxTime are already scheduled under the old tempo; move
    // the beat cursor so new scheduling continues from the same wall-clock time.
    this.nextBeat = secToBeat(map, nowSec + Math.max(0, this.nextCtxTime - now));
    this.anchors.push({ ctx: now, sec: nowSec });
    this.trimAnchors();
  }

  private trimAnchors(): void {
    if (this.anchors.length > MAX_ANCHORS) {
      this.anchors.splice(0, this.anchors.length - MAX_ANCHORS);
    }
  }

  positionBeats(): number {
    if (this.anchors.length === 0) return this.nextBeat;
    const now = this.deps.now();
    let a = this.anchors[0];
    for (const cand of this.anchors) {
      if (cand.ctx <= now) a = cand;
      else break;
    }
    return Math.max(0, secToBeat(this.map(), a.sec + (now - a.ctx)));
  }

  private scheduleSounding(beat: number, ctxTime: number): void {
    const p = this.deps.getProject();
    const map = tempoMapOf(p);
    for (const ev of collectSoundingAt(p, beat)) {
      if (ev.kind === 'clipMid') {
        // How far into the source we are is real elapsed time since the clip
        // started, which under a tempo map is an integral, not a product.
        const offsetSec = ev.clip.offset + beatRangeSec(map, beat - ev.intoBeats, beat);
        // The clip's own recorded length is the authority when it has one: the
        // procedural media table knows nothing about a recorded take, and
        // asking it used to return 0 — which silently skipped every mid-clip
        // entry (play from the middle, or a loop wrap) on real audio.
        const sourceSec = mediaDurationSec(
          ev.clip.mediaId,
          ev.clip.sourceDuration ?? p.media?.find((m) => m.id === ev.clip.mediaId)?.duration,
        );
        if (sourceSec <= 0 || offsetSec < sourceSec) {
          this.deps.scheduleClip(ev.clip, ctxTime, offsetSec);
        }
      } else if (ev.kind === 'note') {
        this.deps.scheduleNote(
          ev.trackId,
          ev.clipId,
          ev.pitch,
          ev.velocity,
          ctxTime,
          beatRangeSec(map, beat, beat + ev.durBeats),
        );
      }
    }
  }

  private tick(): void {
    const p = this.deps.getProject();
    const map = tempoMapOf(p);
    const horizon = this.deps.now() + LOOKAHEAD_SEC;
    let guard = 0;
    while (this.nextCtxTime < horizon && guard++ < 64) {
      const loop = p.loop;
      const fromSec = beatToSec(map, this.nextBeat);
      let windowEndBeat = secToBeat(map, fromSec + (horizon - this.nextCtxTime));
      let wrap = false;
      if (loop.enabled && this.nextBeat < loop.end && windowEndBeat >= loop.end) {
        windowEndBeat = loop.end;
        wrap = true;
      }
      for (const ev of collectWindowEvents(p, this.nextBeat, windowEndBeat)) {
        const when = this.nextCtxTime + (beatToSec(map, ev.beat) - fromSec);
        if (ev.kind === 'clip') this.deps.scheduleClip(ev.clip, when, ev.offsetSec);
        else if (ev.kind === 'note')
          this.deps.scheduleNote(
            ev.trackId,
            ev.clipId,
            ev.pitch,
            ev.velocity,
            when,
            beatRangeSec(map, ev.beat, ev.beat + ev.durBeats),
          );
        else if (ev.kind === 'metronome') this.deps.scheduleMetronome(when, ev.accent);
      }
      const windowEndCtx = this.nextCtxTime + (beatToSec(map, windowEndBeat) - fromSec);
      if (wrap) {
        this.nextBeat = loop.start;
        this.nextCtxTime = windowEndCtx;
        this.anchors.push({ ctx: windowEndCtx, sec: beatToSec(map, loop.start) });
        this.trimAnchors();
        // Order matters: the outgoing pass is retired first, then the new one
        // is entered. Reversed, a listener stopping "everything sounding"
        // would stop the pass it had just been handed.
        this.deps.onLoopWrap?.(windowEndCtx);
        this.scheduleSounding(loop.start, windowEndCtx);
      } else {
        this.nextBeat = windowEndBeat;
        this.nextCtxTime = windowEndCtx;
      }
    }
    this.deps.onTick?.();
  }
}
