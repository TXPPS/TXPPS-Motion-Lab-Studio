import { create } from 'zustand';
import { newId } from '../model/ids';
import { clamp } from '../model/music';
import { getPreset, DRUM_KIT_PARAMS, SYNTH_PRESETS } from '../model/presets';
import { TRACK_COLORS } from '../model/types';
import type {
  Clip,
  EffectKind,
  MidiClip,
  Note,
  ProjectData,
  Send,
  SynthParams,
  Track,
  TrackType,
} from '../model/types';
import { defaultParams, effectSpec, MAX_INSERTS } from '../model/effects';
import type { MediaRef } from '../model/media';
import { createDemoProject } from '../model/demoProject';
import { makePoint, normalizeLanePoints } from '../model/automation';
import type { AutomationLane, AutomationMode, AutomationPoint, CurveShape } from '../model/automation';
import { paramIdExists } from '../model/paramRegistry';

const MAX_UNDO = 60;

export interface ProjectStore {
  project: ProjectData;
  dirty: boolean;
  lastSavedAt: number | null;
  undoStack: string[];
  redoStack: string[];
  gestureSnapshot: string | null;

  setProject: (p: ProjectData, opts?: { markClean?: boolean }) => void;
  /** Core mutation entry point. Clones the project, applies the mutator. */
  update: (mutator: (draft: ProjectData) => void, opts?: { undoable?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  /** Capture state before a continuous drag; endGesture pushes a single undo step. */
  beginGesture: () => void;
  endGesture: () => void;
  markSaved: () => void;

  // Track ops
  addTrack: (type: TrackType) => string;
  duplicateTrack: (id: string) => string | null;
  deleteTrack: (id: string) => void;
  setTrack: (id: string, patch: Partial<Track>) => void;
  setSynthParams: (trackId: string, patch: Partial<SynthParams>) => void;
  applyPreset: (trackId: string, presetName: string) => void;

  // Clip ops
  addMidiClip: (trackId: string, start: number, length: number) => string;
  addAudioClip: (
    trackId: string,
    mediaId: string,
    start: number,
    length: number,
    name: string,
    /** Source length in seconds — required for trimming and fades to stay bounded. */
    sourceDuration?: number,
  ) => string;
  moveClip: (id: string, start: number, trackId?: string) => void;
  /**
   * Move several clips by one beat delta, keeping their spacing. The delta is
   * clamped so the earliest clip cannot cross zero — the group compresses
   * nowhere, it just stops at the wall together.
   */
  moveClipsBy: (ids: string[], deltaBeats: number) => void;
  deleteClips: (ids: string[]) => void;
  /**
   * Duplicate a selection as one block placed immediately after it, preserving
   * internal spacing and track placement. Returns the new ids.
   */
  duplicateClips: (ids: string[]) => string[];
  /** Insert deep-cloned clips (clipboard paste). Returns the new ids. */
  insertClips: (clips: Clip[]) => string[];
  resizeClip: (id: string, start: number, length: number) => void;
  duplicateClip: (id: string, samePos?: boolean) => string | null;
  deleteClip: (id: string) => void;
  setClip: (id: string, patch: Partial<Clip>) => void;

  // Milestone 2: recorded/imported media + nondestructive audio editing
  addRecordedClip: (args: {
    trackId: string;
    mediaId: string;
    start: number;
    lengthBeats: number;
    name: string;
    sourceDuration: number;
    mediaRef: MediaRef;
  }) => string;
  registerMedia: (ref: MediaRef) => void;
  /** Trim the left edge: moves the timeline start and the source offset together. */
  trimClipStart: (id: string, newStartBeat: number) => void;
  /** Trim the right edge: changes musical length and source duration together. */
  trimClipEnd: (id: string, newLengthBeats: number) => void;
  /** Split an audio or MIDI clip at an absolute beat. Returns the new clip id. */
  splitClip: (id: string, atBeat: number) => string | null;
  setClipGain: (id: string, gain: number) => void;
  setClipFades: (id: string, fadeIn?: number, fadeOut?: number) => void;

  // Sends
  setSend: (trackId: string, busId: string, patch: Partial<Send>) => void;
  removeSend: (trackId: string, busId: string) => void;

  // Insert effects. Returns null when the slot cap is reached.
  addEffect: (trackId: string, kind: EffectKind) => string | null;
  removeEffect: (trackId: string, effectId: string) => void;
  setEffectParam: (trackId: string, effectId: string, key: string, value: number) => void;
  setEffectBypass: (trackId: string, effectId: string, bypass: boolean) => void;
  /** Reorder within the chain; delta is -1 (earlier) or +1 (later). */
  moveEffect: (trackId: string, effectId: string, delta: number) => void;

  // Note ops (within a MIDI clip)
  addNote: (clipId: string, note: Omit<Note, 'id'>) => string;
  /** Insert many notes in one undoable step (chordify, repeat). Returns ids. */
  addNotes: (clipId: string, notes: Omit<Note, 'id'>[]) => string[];
  /**
   * Replace the listed notes with transformed versions in ONE undoable step.
   * `next` carries the same ids; notes not listed are untouched. This is how
   * every quantize/humanize/transform commits, so each is one Ctrl+Z.
   */
  transformNotes: (clipId: string, next: Note[]) => void;
  updateNotes: (clipId: string, ids: string[], patch: (n: Note) => Partial<Note>) => void;
  deleteNotes: (clipId: string, ids: string[]) => void;

  // Automation (Milestone 5). Lane values are normalized 0..1.
  /** Create a lane for a parameter. Returns null for unknown/duplicate params. */
  addAutomationLane: (trackId: string, paramId: string) => string | null;
  removeAutomationLane: (trackId: string, laneId: string) => void;
  /** enabled is undoable; height is a continuous UI adjustment and is not. */
  setAutomationLane: (
    trackId: string,
    laneId: string,
    patch: Partial<Pick<AutomationLane, 'enabled' | 'height'>>,
  ) => void;
  setAutomationMode: (trackId: string, mode: AutomationMode) => void;
  addAutomationPoint: (
    trackId: string,
    laneId: string,
    beat: number,
    value: number,
    curve?: CurveShape,
  ) => string | null;
  /** Insert many points as ONE undoable step (paste, duplicate). Returns ids. */
  insertAutomationPoints: (
    trackId: string,
    laneId: string,
    pts: { beat: number; value: number; curve?: CurveShape }[],
  ) => string[];
  /** Continuous drags; non-undoable — wrap with begin/endGesture. */
  updateAutomationPoints: (
    trackId: string,
    laneId: string,
    ids: string[],
    patch: (p: AutomationPoint) => Partial<AutomationPoint>,
  ) => void;
  deleteAutomationPoints: (trackId: string, laneId: string, ids: string[]) => void;
  setAutomationCurve: (trackId: string, laneId: string, ids: string[], curve: CurveShape) => void;
  /**
   * Touch/latch capture: overwrite the lane between the previous write position
   * and `beat` with a single point at `beat`. Non-undoable (the surrounding
   * control gesture owns the undo step).
   */
  writeAutomationAt: (
    trackId: string,
    laneId: string,
    beat: number,
    value: number,
    sinceBeat: number,
  ) => void;

  // Transport-adjacent settings
  setBpm: (bpm: number) => void;
  setTimeSig: (num: number, den: number) => void;
  setLoop: (patch: Partial<ProjectData['loop']>) => void;
  setMetronome: (on: boolean) => void;
  /** Free-form project notes. Not undoable: typing is a continuous gesture. */
  setNotes: (notes: string) => void;
  setMasterVolume: (v: number) => void;
}

function cloneProject(p: ProjectData): ProjectData {
  return structuredClone(p);
}

/**
 * Would sending `from` into `to` create a routing cycle? Walks the graph formed
 * by track outputs and existing sends. Used to reject invalid routes up front
 * rather than letting the audio graph feed back on itself.
 */
export function createsCycle(p: ProjectData, from: string, to: string): boolean {
  const seen = new Set<string>();
  const walk = (id: string): boolean => {
    if (id === from) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    const t = p.tracks.find((x) => x.id === id);
    if (!t) return false;
    if (t.output && t.output !== 'master' && walk(t.output)) return true;
    for (const s of t.sends ?? []) if (walk(s.busId)) return true;
    return false;
  };
  return walk(to);
}

export const useProjectStore = create<ProjectStore>((set, get) => {
  const update: ProjectStore['update'] = (mutator, opts) => {
    const { project, undoStack, gestureSnapshot } = get();
    const draft = cloneProject(project);
    mutator(draft);
    draft.modifiedAt = Date.now();
    const undoable = opts?.undoable ?? true;
    if (undoable && gestureSnapshot === null) {
      set({
        project: draft,
        dirty: true,
        undoStack: [...undoStack.slice(-(MAX_UNDO - 1)), JSON.stringify(project)],
        redoStack: [],
      });
    } else {
      set({ project: draft, dirty: true });
    }
  };

  const trackById = (draft: ProjectData, id: string) => draft.tracks.find((t) => t.id === id);
  const clipById = (draft: ProjectData, id: string) => draft.clips.find((c) => c.id === id);

  return {
    project: createDemoProject(),
    dirty: false,
    lastSavedAt: null,
    undoStack: [],
    redoStack: [],
    gestureSnapshot: null,

    setProject: (p, opts) =>
      set({
        project: p,
        dirty: opts?.markClean ? false : true,
        lastSavedAt: opts?.markClean ? Date.now() : get().lastSavedAt,
        undoStack: [],
        redoStack: [],
        gestureSnapshot: null,
      }),

    update,

    undo: () => {
      const { undoStack, redoStack, project } = get();
      const prev = undoStack[undoStack.length - 1];
      if (!prev) return;
      set({
        project: JSON.parse(prev) as ProjectData,
        undoStack: undoStack.slice(0, -1),
        redoStack: [...redoStack.slice(-(MAX_UNDO - 1)), JSON.stringify(project)],
        dirty: true,
      });
    },

    redo: () => {
      const { undoStack, redoStack, project } = get();
      const next = redoStack[redoStack.length - 1];
      if (!next) return;
      set({
        project: JSON.parse(next) as ProjectData,
        redoStack: redoStack.slice(0, -1),
        undoStack: [...undoStack.slice(-(MAX_UNDO - 1)), JSON.stringify(project)],
        dirty: true,
      });
    },

    beginGesture: () => {
      if (get().gestureSnapshot === null) set({ gestureSnapshot: JSON.stringify(get().project) });
    },

    endGesture: () => {
      const { gestureSnapshot, undoStack, project } = get();
      if (gestureSnapshot === null) return;
      const changed = gestureSnapshot !== JSON.stringify(project);
      set({
        gestureSnapshot: null,
        ...(changed
          ? { undoStack: [...undoStack.slice(-(MAX_UNDO - 1)), gestureSnapshot], redoStack: [] }
          : {}),
      });
    },

    markSaved: () => set({ dirty: false, lastSavedAt: Date.now() }),

    addTrack: (type) => {
      const id = newId('t');
      update((d) => {
        const count = d.tracks.filter((t) => t.type === type).length;
        const baseName =
          type === 'audio'
            ? 'Audio'
            : type === 'instrument'
              ? 'Synth'
              : type === 'drum'
                ? 'Drums'
                : 'Bus';
        const track: Track = {
          id,
          type,
          name: `${baseName} ${count + 1}`,
          color: TRACK_COLORS[d.tracks.length % TRACK_COLORS.length],
          volume: 0.85,
          pan: 0,
          mute: false,
          solo: false,
          armed: type === 'instrument' || type === 'drum',
          collapsed: false,
          output: 'master',
          ...(type === 'instrument' ? { synth: getPreset(SYNTH_PRESETS[0].presetName) } : {}),
          ...(type === 'drum' ? { synth: { ...DRUM_KIT_PARAMS } } : {}),
        };
        // Buses stay grouped after normal tracks
        const firstBus = d.tracks.findIndex((t) => t.type === 'bus');
        if (type !== 'bus' && firstBus >= 0) d.tracks.splice(firstBus, 0, track);
        else d.tracks.push(track);
      });
      return id;
    },

    duplicateTrack: (srcId) => {
      const src = get().project.tracks.find((t) => t.id === srcId);
      if (!src) return null;
      const id = newId('t');
      update((d) => {
        const idx = d.tracks.findIndex((t) => t.id === srcId);
        const copy: Track = structuredClone(d.tracks[idx]);
        copy.id = id;
        copy.name = `${copy.name} copy`;
        copy.solo = false;
        d.tracks.splice(idx + 1, 0, copy);
        const srcClips = d.clips.filter((c) => c.trackId === srcId);
        for (const c of srcClips) {
          const cc = structuredClone(c);
          cc.id = newId('c');
          cc.trackId = id;
          if (cc.type === 'midi') for (const n of cc.notes) n.id = newId('n');
          d.clips.push(cc);
        }
      });
      return id;
    },

    deleteTrack: (id) =>
      update((d) => {
        d.tracks = d.tracks.filter((t) => t.id !== id);
        d.clips = d.clips.filter((c) => c.trackId !== id);
        // Reroute anything that pointed at a deleted bus, and drop sends into
        // it together with their automation lanes — no orphan bindings.
        for (const t of d.tracks) {
          if (t.output === id) t.output = 'master';
          if (t.sends) t.sends = t.sends.filter((s) => s.busId !== id);
          if (t.automation) {
            t.automation = t.automation.filter((l) => l.paramId !== `send:${id}`);
            if (t.automation.length === 0) delete t.automation;
          }
        }
      }),

    setTrack: (id, patch) =>
      update(
        (d) => {
          const t = trackById(d, id);
          if (t) Object.assign(t, patch);
        },
        { undoable: isUndoableTrackPatch(patch) },
      ),

    setSynthParams: (trackId, patch) =>
      update(
        (d) => {
          const t = trackById(d, trackId);
          if (t?.synth) Object.assign(t.synth, patch, { presetName: patch.presetName ?? 'Custom' });
        },
        { undoable: false },
      ),

    applyPreset: (trackId, presetName) =>
      update((d) => {
        const t = trackById(d, trackId);
        if (t && (t.type === 'instrument' || t.type === 'drum')) t.synth = getPreset(presetName);
      }),

    addMidiClip: (trackId, start, length) => {
      const id = newId('c');
      update((d) => {
        const clip: MidiClip = {
          id,
          trackId,
          type: 'midi',
          name: 'MIDI Clip',
          start: Math.max(0, start),
          length: Math.max(0.25, length),
          muted: false,
          notes: [],
        };
        d.clips.push(clip);
      });
      return id;
    },

    addAudioClip: (trackId, mediaId, start, length, name, sourceDuration) => {
      const id = newId('c');
      update((d) => {
        d.clips.push({
          id,
          trackId,
          type: 'audio',
          name,
          start: Math.max(0, start),
          length: Math.max(0.25, length),
          muted: false,
          mediaId,
          offset: 0,
          ...(sourceDuration ? { sourceDuration } : {}),
          gain: 1,
          fadeIn: 0,
          fadeOut: 0,
        });
      });
      return id;
    },

    moveClip: (id, start, trackId) =>
      update(
        (d) => {
          const c = clipById(d, id);
          if (!c) return;
          c.start = Math.max(0, start);
          if (trackId) {
            const target = trackById(d, trackId);
            const source = trackById(d, c.trackId);
            // Only allow moves between compatible track types
            if (
              target &&
              source &&
              target.type !== 'bus' &&
              ((c.type === 'audio' && target.type === 'audio') ||
                (c.type === 'midi' && target.type !== 'audio'))
            ) {
              c.trackId = trackId;
            }
          }
        },
        { undoable: false },
      ),

    resizeClip: (id, start, length) =>
      update(
        (d) => {
          const c = clipById(d, id);
          if (!c) return;
          c.start = Math.max(0, start);
          c.length = Math.max(0.25, length);
        },
        { undoable: false },
      ),

    moveClipsBy: (ids, deltaBeats) =>
      update((d) => {
        const targets = d.clips.filter((c) => ids.includes(c.id));
        if (targets.length === 0 || !Number.isFinite(deltaBeats)) return;
        const minStart = Math.min(...targets.map((c) => c.start));
        const delta = Math.max(-minStart, deltaBeats);
        for (const c of targets) c.start += delta;
      }),

    deleteClips: (ids) =>
      update((d) => {
        const set = new Set(ids);
        d.clips = d.clips.filter((c) => !set.has(c.id));
      }),

    duplicateClips: (ids) => {
      const src = get().project.clips.filter((c) => ids.includes(c.id));
      if (src.length === 0) return [];
      // The block's span decides the shift, so duplicated material lands
      // immediately after the selection rather than on top of it.
      const minStart = Math.min(...src.map((c) => c.start));
      const span = Math.max(...src.map((c) => c.start + c.length)) - minStart;
      const newIds: string[] = [];
      update((d) => {
        for (const c of src) {
          const copy = structuredClone(d.clips.find((x) => x.id === c.id)!);
          copy.id = newId('c');
          copy.start = c.start + span;
          if (copy.type === 'midi') for (const n of copy.notes) n.id = newId('n');
          d.clips.push(copy);
          newIds.push(copy.id);
        }
      });
      return newIds;
    },

    insertClips: (clips) => {
      const newIds: string[] = [];
      update((d) => {
        for (const c of clips) {
          // Skip clips whose track no longer exists rather than inventing one.
          if (!trackById(d, c.trackId)) continue;
          const copy = structuredClone(c);
          copy.id = newId('c');
          copy.start = Math.max(0, copy.start);
          if (copy.type === 'midi') for (const n of copy.notes) n.id = newId('n');
          d.clips.push(copy);
          newIds.push(copy.id);
        }
      });
      return newIds;
    },

    duplicateClip: (srcId, samePos = false) => {
      const src = get().project.clips.find((c) => c.id === srcId);
      if (!src) return null;
      const id = newId('c');
      update((d) => {
        const copy = structuredClone(d.clips.find((c) => c.id === srcId)!);
        copy.id = id;
        copy.start = samePos ? src.start : src.start + src.length;
        if (copy.type === 'midi') for (const n of copy.notes) n.id = newId('n');
        d.clips.push(copy);
      });
      return id;
    },

    deleteClip: (id) =>
      update((d) => {
        d.clips = d.clips.filter((c) => c.id !== id);
      }),

    setClip: (id, patch) =>
      update((d) => {
        const c = clipById(d, id);
        if (c) Object.assign(c, patch);
      }),

    // ---- Milestone 2 -----------------------------------------------------

    addRecordedClip: ({ trackId, mediaId, start, lengthBeats, name, sourceDuration, mediaRef }) => {
      const id = newId('c');
      update((d) => {
        if (!d.media) d.media = [];
        if (!d.media.some((m) => m.id === mediaRef.id)) d.media.push(mediaRef);
        d.clips.push({
          id,
          trackId,
          type: 'audio',
          name,
          start: Math.max(0, start),
          length: Math.max(0.25, lengthBeats),
          muted: false,
          mediaId,
          offset: 0,
          sourceDuration,
          gain: 1,
          fadeIn: 0,
          fadeOut: 0,
        });
      });
      return id;
    },

    registerMedia: (ref) =>
      update((d) => {
        if (!d.media) d.media = [];
        const i = d.media.findIndex((m) => m.id === ref.id);
        if (i >= 0) d.media[i] = ref;
        else d.media.push(ref);
      }),

    trimClipStart: (id, newStartBeat) =>
      update(
        (d) => {
          const c = clipById(d, id);
          if (!c) return;
          const end = c.start + c.length;
          // never past the clip end, never before the source begins
          const spb = 60 / d.bpm;
          let start = Math.max(0, Math.min(newStartBeat, end - 0.125));
          if (c.type === 'audio') {
            const deltaBeats = start - c.start;
            const newOffset = c.offset + deltaBeats * spb;
            if (newOffset < 0) {
              // clamp so we cannot scrub before the start of the source
              start = c.start - c.offset / spb;
            }
            c.offset = Math.max(0, c.offset + (start - c.start) * spb);
            const newLen = end - start;
            c.sourceDuration = Math.max(0.01, newLen * spb);
            c.length = newLen;
            c.start = start;
            // fades must still fit
            const durSec = c.sourceDuration;
            c.fadeIn = Math.min(c.fadeIn, durSec);
            c.fadeOut = Math.min(c.fadeOut, Math.max(0, durSec - c.fadeIn));
          } else {
            c.length = end - start;
            c.start = start;
          }
        },
        { undoable: false },
      ),

    trimClipEnd: (id, newLengthBeats) =>
      update(
        (d) => {
          const c = clipById(d, id);
          if (!c) return;
          const spb = 60 / d.bpm;
          const len = Math.max(0.125, newLengthBeats);
          c.length = len;
          if (c.type === 'audio') {
            c.sourceDuration = Math.max(0.01, len * spb);
            const durSec = c.sourceDuration;
            c.fadeOut = Math.min(c.fadeOut, durSec);
            c.fadeIn = Math.min(c.fadeIn, Math.max(0, durSec - c.fadeOut));
          }
        },
        { undoable: false },
      ),

    splitClip: (id, atBeat) => {
      const src = get().project.clips.find((c) => c.id === id);
      if (!src) return null;
      if (atBeat <= src.start + 1e-6 || atBeat >= src.start + src.length - 1e-6) return null;
      const rightId = newId('c');
      update((d) => {
        const left = clipById(d, id);
        if (!left) return;
        const spb = 60 / d.bpm;
        const leftLen = atBeat - left.start;
        const rightLen = left.start + left.length - atBeat;
        const right = structuredClone(left);
        right.id = rightId;
        right.start = atBeat;
        right.length = rightLen;
        left.length = leftLen;

        if (left.type === 'audio' && right.type === 'audio') {
          // The right half starts further into the same source media.
          right.offset = left.offset + leftLen * spb;
          right.sourceDuration = Math.max(0.01, rightLen * spb);
          left.sourceDuration = Math.max(0.01, leftLen * spb);
          // Keep the outer fades, drop the fade at the new cut on each side.
          right.fadeIn = 0;
          left.fadeOut = 0;
          right.fadeOut = Math.min(right.fadeOut, right.sourceDuration);
          left.fadeIn = Math.min(left.fadeIn, left.sourceDuration);
          right.name = `${left.name}.2`;
        } else if (left.type === 'midi' && right.type === 'midi') {
          // Notes belong to whichever side contains their start.
          const cut = leftLen;
          left.notes = left.notes.filter((n) => n.start < cut);
          right.notes = right.notes
            .filter((n) => n.start >= cut)
            .map((n) => ({ ...n, id: newId('n'), start: n.start - cut }));
          right.name = `${left.name}.2`;
        }
        d.clips.push(right);
      });
      return rightId;
    },

    setClipGain: (id, gain) =>
      update(
        (d) => {
          const c = clipById(d, id);
          if (c?.type === 'audio') c.gain = clamp(gain, 0, 4);
        },
        { undoable: false },
      ),

    setClipFades: (id, fadeIn, fadeOut) =>
      update(
        (d) => {
          const c = clipById(d, id);
          if (c?.type !== 'audio') return;
          const spb = 60 / d.bpm;
          const durSec = c.sourceDuration ?? c.length * spb;
          if (fadeIn !== undefined) c.fadeIn = clamp(fadeIn, 0, durSec);
          if (fadeOut !== undefined) c.fadeOut = clamp(fadeOut, 0, durSec);
          // the two ramps may not overlap
          if (c.fadeIn + c.fadeOut > durSec) {
            if (fadeIn !== undefined) c.fadeOut = Math.max(0, durSec - c.fadeIn);
            else c.fadeIn = Math.max(0, durSec - c.fadeOut);
          }
        },
        { undoable: false },
      ),

    setSend: (trackId, busId, patch) =>
      update((d) => {
        const t = trackById(d, trackId);
        const bus = trackById(d, busId);
        // Routing validation: only to a real bus, never to itself, never from a
        // bus that the target already feeds (which would create a cycle).
        if (!t || !bus || bus.type !== 'bus' || t.id === busId) return;
        if (createsCycle(d, trackId, busId)) return;
        if (!t.sends) t.sends = [];
        const existing = t.sends.find((s) => s.busId === busId);
        if (existing) Object.assign(existing, patch);
        else
          t.sends.push({
            busId,
            amount: patch.amount ?? 0.3,
            enabled: patch.enabled ?? true,
            preFader: patch.preFader ?? false,
          });
      }),

    removeSend: (trackId, busId) =>
      update((d) => {
        const t = trackById(d, trackId);
        if (t?.sends) t.sends = t.sends.filter((s) => s.busId !== busId);
        // A removed send takes its automation lane with it.
        if (t?.automation) {
          t.automation = t.automation.filter((l) => l.paramId !== `send:${busId}`);
          if (t.automation.length === 0) delete t.automation;
        }
      }),

    addEffect: (trackId, kind) => {
      const id = newId('fx');
      let added = false;
      update((d) => {
        const t = trackById(d, trackId);
        if (!t) return;
        if (!t.effects) t.effects = [];
        // A hard slot cap keeps a channel's CPU cost predictable.
        if (t.effects.length >= MAX_INSERTS) return;
        t.effects.push({ id, kind, bypass: false, params: defaultParams(kind) });
        added = true;
      });
      return added ? id : null;
    },

    removeEffect: (trackId, effectId) =>
      update((d) => {
        const t = trackById(d, trackId);
        if (t?.effects) t.effects = t.effects.filter((e) => e.id !== effectId);
        // A removed insert takes its parameter lanes with it.
        if (t?.automation) {
          t.automation = t.automation.filter((l) => !l.paramId.startsWith(`fx:${effectId}:`));
          if (t.automation.length === 0) delete t.automation;
        }
      }),

    setEffectParam: (trackId, effectId, key, value) =>
      update(
        (d) => {
          const fx = trackById(d, trackId)?.effects?.find((e) => e.id === effectId);
          if (!fx) return;
          const spec = effectSpec(fx.kind)?.params.find((p) => p.key === key);
          if (!spec || !Number.isFinite(value)) return;
          fx.params[key] = Math.min(spec.max, Math.max(spec.min, value));
        },
        // Continuous control, same as synth params: dragging must not fill the
        // undo stack with one entry per pixel.
        { undoable: false },
      ),

    setEffectBypass: (trackId, effectId, bypass) =>
      update((d) => {
        const fx = trackById(d, trackId)?.effects?.find((e) => e.id === effectId);
        if (fx) fx.bypass = bypass;
      }),

    moveEffect: (trackId, effectId, delta) =>
      update((d) => {
        const t = trackById(d, trackId);
        if (!t?.effects) return;
        const i = t.effects.findIndex((e) => e.id === effectId);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= t.effects.length) return;
        const [moved] = t.effects.splice(i, 1);
        t.effects.splice(j, 0, moved);
      }),

    addNotes: (clipId, notes) => {
      const ids: string[] = [];
      update((d) => {
        const c = clipById(d, clipId);
        if (c?.type !== 'midi') return;
        for (const n of notes) {
          const nid = newId('n');
          c.notes.push({ ...n, id: nid });
          ids.push(nid);
        }
      });
      return ids;
    },

    transformNotes: (clipId, next) =>
      update((d) => {
        const c = clipById(d, clipId);
        if (c?.type !== 'midi') return;
        const byId = new Map(next.map((n) => [n.id, n]));
        c.notes = c.notes.map((n) => byId.get(n.id) ?? n);
      }),

    addNote: (clipId, n) => {
      const id = newId('n');
      update((d) => {
        const c = clipById(d, clipId);
        if (c?.type === 'midi') {
          c.notes.push({ ...n, id });
        }
      });
      return id;
    },

    updateNotes: (clipId, ids, patch) =>
      update(
        (d) => {
          const c = clipById(d, clipId);
          if (c?.type === 'midi') {
            for (const n of c.notes) {
              if (ids.includes(n.id)) {
                Object.assign(n, patch(n));
                n.start = Math.max(0, n.start);
                n.length = Math.max(0.0625, n.length);
                n.pitch = clamp(Math.round(n.pitch), 0, 127);
                n.velocity = clamp(Math.round(n.velocity), 1, 127);
              }
            }
          }
        },
        { undoable: false },
      ),

    deleteNotes: (clipId, ids) =>
      update((d) => {
        const c = clipById(d, clipId);
        if (c?.type === 'midi') c.notes = c.notes.filter((n) => !ids.includes(n.id));
      }),

    addAutomationLane: (trackId, paramId) => {
      const t = get().project.tracks.find((x) => x.id === trackId);
      if (!t || !paramIdExists(t, paramId)) return null;
      if ((t.automation ?? []).some((l) => l.paramId === paramId)) return null;
      const id = newId('al');
      update((d) => {
        const track = trackById(d, trackId);
        if (!track) return;
        if (!track.automation) track.automation = [];
        track.automation.push({ id, paramId, points: [], enabled: true });
        track.automationOpen = true;
      });
      return id;
    },

    removeAutomationLane: (trackId, laneId) =>
      update((d) => {
        const t = trackById(d, trackId);
        if (!t?.automation) return;
        t.automation = t.automation.filter((l) => l.id !== laneId);
        if (t.automation.length === 0) delete t.automation;
      }),

    setAutomationLane: (trackId, laneId, patch) =>
      update(
        (d) => {
          const l = trackById(d, trackId)?.automation?.find((x) => x.id === laneId);
          if (!l) return;
          if (patch.enabled !== undefined) l.enabled = patch.enabled;
          if (patch.height !== undefined) l.height = clamp(patch.height, 26, 120);
        },
        // Height drags are continuous; enabled flips are cheap to fold in too —
        // a lane's on/off is restored by the edits around it.
        { undoable: patch.enabled !== undefined },
      ),

    setAutomationMode: (trackId, mode) =>
      update(
        (d) => {
          const t = trackById(d, trackId);
          if (t) t.automationMode = mode;
        },
        { undoable: false },
      ),

    addAutomationPoint: (trackId, laneId, beat, value, curve) => {
      let id: string | null = null;
      update((d) => {
        const l = trackById(d, trackId)?.automation?.find((x) => x.id === laneId);
        if (!l) return;
        const p = makePoint(beat, value, curve ?? 'linear');
        l.points.push(p);
        normalizeLanePoints(l.points);
        id = p.id;
      });
      return id;
    },

    insertAutomationPoints: (trackId, laneId, pts) => {
      const ids: string[] = [];
      update((d) => {
        const l = trackById(d, trackId)?.automation?.find((x) => x.id === laneId);
        if (!l) return;
        for (const p of pts) {
          const made = makePoint(p.beat, p.value, p.curve ?? 'linear');
          l.points.push(made);
          ids.push(made.id);
        }
        normalizeLanePoints(l.points);
      });
      return ids;
    },

    updateAutomationPoints: (trackId, laneId, ids, patch) =>
      update(
        (d) => {
          const l = trackById(d, trackId)?.automation?.find((x) => x.id === laneId);
          if (!l) return;
          for (const p of l.points) {
            if (ids.includes(p.id)) Object.assign(p, patch(p));
          }
          normalizeLanePoints(l.points);
        },
        { undoable: false },
      ),

    deleteAutomationPoints: (trackId, laneId, ids) =>
      update((d) => {
        const l = trackById(d, trackId)?.automation?.find((x) => x.id === laneId);
        if (!l) return;
        const drop = new Set(ids);
        l.points = l.points.filter((p) => !drop.has(p.id));
      }),

    setAutomationCurve: (trackId, laneId, ids, curve) =>
      update((d) => {
        const l = trackById(d, trackId)?.automation?.find((x) => x.id === laneId);
        if (!l) return;
        for (const p of l.points) if (ids.includes(p.id)) p.curve = curve;
      }),

    writeAutomationAt: (trackId, laneId, beat, value, sinceBeat) =>
      update(
        (d) => {
          const l = trackById(d, trackId)?.automation?.find((x) => x.id === laneId);
          if (!l) return;
          const lo = Math.min(sinceBeat, beat);
          // Overwrite the pass-through region, then place the new point.
          l.points = l.points.filter((p) => p.beat <= lo || p.beat > beat + 1e-9);
          l.points.push(makePoint(beat, value, 'linear'));
          normalizeLanePoints(l.points);
        },
        { undoable: false },
      ),

    setBpm: (bpm) =>
      update(
        (d) => {
          d.bpm = clamp(Math.round(bpm * 10) / 10, 30, 300);
        },
        { undoable: false },
      ),

    setTimeSig: (num, den) =>
      update((d) => {
        d.timeSig = {
          num: clamp(Math.round(num), 1, 16),
          den: [1, 2, 4, 8, 16].includes(den) ? den : 4,
        };
      }),

    setLoop: (patch) =>
      update(
        (d) => {
          Object.assign(d.loop, patch);
          if (d.loop.end - d.loop.start < 1) d.loop.end = d.loop.start + 1;
        },
        { undoable: false },
      ),

    setNotes: (notes) =>
      update(
        (d) => {
          if (notes) d.notes = notes;
          else delete d.notes;
        },
        { undoable: false },
      ),

    setMetronome: (on) =>
      update(
        (d) => {
          d.metronome = on;
        },
        { undoable: false },
      ),

    setMasterVolume: (v) =>
      update(
        (d) => {
          d.masterVolume = clamp(v, 0, 1.5);
        },
        { undoable: false },
      ),
  };
});

function isUndoableTrackPatch(patch: Partial<Track>): boolean {
  // Continuous controls (volume/pan) and view toggles create undo noise;
  // discrete edits are undoable.
  const keys = Object.keys(patch);
  return !keys.every(
    (k) => k === 'volume' || k === 'pan' || k === 'collapsed' || k === 'automationOpen',
  );
}

export function getTrack(p: ProjectData, id: string): Track | undefined {
  return p.tracks.find((t) => t.id === id);
}

export function getClip(p: ProjectData, id: string): Clip | undefined {
  return p.clips.find((c) => c.id === id);
}

export function trackClips(p: ProjectData, trackId: string): Clip[] {
  return p.clips.filter((c) => c.trackId === trackId);
}

/** End of the last clip in beats (project length for display/looping). */
export function projectEndBeat(p: ProjectData): number {
  let end = 0;
  for (const c of p.clips) end = Math.max(end, c.start + c.length);
  return Math.max(end, 16);
}
