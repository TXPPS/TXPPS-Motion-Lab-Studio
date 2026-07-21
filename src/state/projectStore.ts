import { create } from 'zustand';
import { newId } from '../model/ids';
import { clamp } from '../model/music';
import { getPreset, DRUM_KIT_PARAMS, SYNTH_PRESETS } from '../model/presets';
import { TRACK_COLORS } from '../model/types';
import type {
  Clip,
  MidiClip,
  Note,
  ProjectData,
  SynthParams,
  Track,
  TrackType,
} from '../model/types';
import { createDemoProject } from '../model/demoProject';

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
  moveClip: (id: string, start: number, trackId?: string) => void;
  resizeClip: (id: string, start: number, length: number) => void;
  duplicateClip: (id: string) => string | null;
  deleteClip: (id: string) => void;
  setClip: (id: string, patch: Partial<Clip>) => void;

  // Note ops (within a MIDI clip)
  addNote: (clipId: string, note: Omit<Note, 'id'>) => string;
  updateNotes: (clipId: string, ids: string[], patch: (n: Note) => Partial<Note>) => void;
  deleteNotes: (clipId: string, ids: string[]) => void;

  // Transport-adjacent settings
  setBpm: (bpm: number) => void;
  setTimeSig: (num: number, den: number) => void;
  setLoop: (patch: Partial<ProjectData['loop']>) => void;
  setMetronome: (on: boolean) => void;
  setMasterVolume: (v: number) => void;
}

function cloneProject(p: ProjectData): ProjectData {
  return structuredClone(p);
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
        // Reroute anything that pointed at a deleted bus
        for (const t of d.tracks) if (t.output === id) t.output = 'master';
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

    duplicateClip: (srcId) => {
      const src = get().project.clips.find((c) => c.id === srcId);
      if (!src) return null;
      const id = newId('c');
      update((d) => {
        const copy = structuredClone(d.clips.find((c) => c.id === srcId)!);
        copy.id = id;
        copy.start = src.start + src.length;
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

    setBpm: (bpm) =>
      update(
        (d) => {
          d.bpm = clamp(Math.round(bpm * 10) / 10, 30, 300);
        },
        { undoable: false },
      ),

    setTimeSig: (num, den) =>
      update((d) => {
        d.timeSig = { num: clamp(Math.round(num), 1, 16), den: [1, 2, 4, 8, 16].includes(den) ? den : 4 };
      }),

    setLoop: (patch) =>
      update(
        (d) => {
          Object.assign(d.loop, patch);
          if (d.loop.end - d.loop.start < 1) d.loop.end = d.loop.start + 1;
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
  // Continuous controls (volume/pan) create undo noise; discrete edits are undoable.
  const keys = Object.keys(patch);
  return !keys.every((k) => k === 'volume' || k === 'pan' || k === 'collapsed');
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
