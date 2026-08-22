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
import type {
  AutomationLane,
  AutomationMode,
  AutomationPoint,
  CurveShape,
} from '../model/automation';
import { paramIdExists } from '../model/paramRegistry';
import { normalizeTempoMap, type TempoCurve } from '../model/tempo';
import {
  normalizeChords,
  normalizeMarkers,
  normalizeSections,
  reorderSections,
  sectionColorFor,
  MARKER_COLORS,
  SECTION_COLORS,
  type ArrangerSection,
  type Marker,
} from '../model/arrangement';
import { buildTakeClip, normalizeComp } from '../model/comping';
import type { AudioClip, FadeShape, RackItem } from '../model/types';
import {
  buildDrumKit,
  defaultSamplerParams,
  makePadZone,
  DRUM_PAD_BASE,
  type SamplerParams,
  type SampleZone,
} from '../model/sampler';

const MAX_UNDO = 60;

export interface ProjectStore {
  project: ProjectData;
  dirty: boolean;
  lastSavedAt: number | null;
  undoStack: ProjectData[];
  redoStack: ProjectData[];
  gestureSnapshot: ProjectData | null;
  /** How many drags are currently open. Only the outermost one pushes undo. */
  gestureDepth: number;

  setProject: (p: ProjectData, opts?: { markClean?: boolean }) => void;
  /** Core mutation entry point. Clones the project, applies the mutator. */
  update: (mutator: (draft: ProjectData) => void, opts?: { undoable?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  /**
   * Capture state before a continuous drag; the matching endGesture pushes a
   * single undo step. Calls nest: two simultaneous touch drags on a tablet open
   * depth 2, and only the last release commits, so neither drag can close the
   * other's undo window and strand the rest of the session as non-undoable.
   */
  beginGesture: () => void;
  endGesture: () => void;
  /**
   * Force-close any open gesture. The app calls this after every pointer
   * release as a backstop: a drag whose element was destroyed mid-gesture must
   * never leave the undo system wedged open.
   */
  flushGestures: () => void;
  /**
   * Record a completed save. Pass the exact project object that was written:
   * dirty only clears when nothing changed while the save was in flight, so
   * an edit made during an async save is never silently marked as persisted.
   */
  markSaved: (saved: ProjectData) => void;

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

  // Milestone 6: time editing, crossfades, takes/comping, locks.
  /** Slip the source under a fixed clip window. maxOffset caps against media length. */
  slipClip: (id: string, deltaSec: number, maxOffset?: number) => void;
  /**
   * Heal adjacent splits back together. Audio requires the same media with
   * contiguous offsets; MIDI merges notes. Returns how many joins happened.
   */
  healClips: (ids: string[]) => number;
  /** Delete and pull later clips on the same tracks left by the removed span. */
  rippleDeleteClips: (ids: string[]) => void;
  /**
   * Crossfade two same-track audio clips at their junction: creates the
   * overlap (using trim headroom on both sides where needed) and sets
   * complementary fades of the given shape. One undo step.
   */
  createCrossfade: (
    leftId: string,
    rightId: string,
    lengthBeats: number,
    shape: FadeShape,
  ) => boolean;
  setFadeShape: (id: string, which: 'in' | 'out', shape: FadeShape) => void;
  /** Pack the selected overlapping audio clips into one take clip. */
  packTakes: (ids: string[]) => string | null;
  /** The whole clip plays this take (comp collapses to one segment). */
  promoteTake: (clipId: string, takeId: string) => void;
  /** Assign a range of the comp to a take (swipe comping). */
  setCompRange: (clipId: string, fromBeat: number, toBeat: number, takeId: string) => void;
  deleteTake: (clipId: string, takeId: string) => void;
  moveTake: (clipId: string, takeId: string, delta: number) => void;
  setTakeMuted: (clipId: string, takeId: string, muted: boolean) => void;
  /** Audition one take (null returns to the comp). Non-undoable UI state. */
  setSoloTake: (clipId: string, takeId: string | null) => void;
  /** Non-undoable view flags (take lanes open/closed). */
  setClipView: (id: string, patch: { takesOpen?: boolean }) => void;

  // Milestone 7: sampler, drum rack, instrument rack.
  /** Continuous sampler master edits (sliders); non-undoable. */
  setSamplerParams: (trackId: string, patch: Partial<SamplerParams>) => void;
  /** Switch a track's instrument. Undoable; creates sensible defaults. */
  setInstrument: (trackId: string, kind: 'synth' | 'quick' | 'drum' | 'multi') => void;
  addSamplerZones: (trackId: string, zones: SampleZone[]) => string[];
  /** Continuous zone edits (drag trims); non-undoable — wrap in a gesture. */
  updateSamplerZones: (
    trackId: string,
    ids: string[],
    patch: (z: SampleZone) => Partial<SampleZone>,
  ) => void;
  removeSamplerZones: (trackId: string, ids: string[]) => void;
  /** Assign media to a drum pad (creates or replaces that pad's zone). */
  assignPad: (trackId: string, padIndex: number, mediaId: string, name?: string) => void;
  setZoneSlices: (trackId: string, zoneId: string, slices: number[]) => void;
  /** Turn a sliced zone into drum pads (one per slice). Returns pad count. */
  sliceToPads: (trackId: string, zoneId: string) => number;
  /** Create a MIDI clip triggering the slices in order. Returns the clip id. */
  sliceToMidiClip: (trackId: string, zoneId: string, startBeat: number) => string | null;
  applySamplerPreset: (trackId: string, preset: SamplerParams) => void;
  rackAddItem: (trackId: string, kind: 'synth' | 'sampler') => string | null;
  rackUpdateItem: (trackId: string, itemId: string, patch: Partial<RackItem>) => void;
  rackRemoveItem: (trackId: string, itemId: string) => void;
  rackMoveItem: (trackId: string, itemId: string, delta: number) => void;

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

  // ---- global tracks (v6) ----
  /** Add or move a tempo event. Beat 0 always exists and can only be retimed. */
  setTempoEvent: (beat: number, bpm: number, curve?: TempoCurve) => void;
  removeTempoEvent: (id: string) => void;
  moveTempoEvent: (id: string, beat: number) => void;
  /** Insert or replace the signature that starts at `bar`. */
  setSignature: (bar: number, num: number, den: number) => void;
  removeSignature: (id: string) => void;
  addMarker: (beat: number, name?: string) => string;
  setMarker: (id: string, patch: Partial<Marker>) => void;
  removeMarker: (id: string) => void;
  addSection: (start: number, length: number, name?: string) => string;
  setSection: (id: string, patch: Partial<ArrangerSection>) => void;
  removeSection: (id: string) => void;
  /**
   * Reorder the arrangement by moving a section. Every clip and automation
   * point inside a moved section travels with it — that is what makes the
   * arranger track an arrangement tool rather than a set of labels.
   */
  moveSection: (id: string, toIndex: number) => void;
  setChord: (beat: number, root: number, quality: string, bass?: number) => string;
  removeChord: (id: string) => void;
  clearChords: () => void;

  // ---- master channel ----
  setMaster: (patch: Partial<NonNullable<ProjectData['master']>>) => void;
  addMasterEffect: (kind: EffectKind) => string | null;
  removeMasterEffect: (effectId: string) => void;
  setMasterEffectParam: (effectId: string, key: string, value: number) => void;
  setMasterEffectBypass: (effectId: string, bypass: boolean) => void;
  moveMasterEffect: (effectId: string, delta: number) => void;

  // ---- grouping ----
  /** Wrap the given tracks in a new folder track placed above them. */
  groupTracks: (trackIds: string[], name?: string) => string | null;
  /** Dissolve a folder, leaving its children in place. */
  ungroupFolder: (folderId: string) => void;
  setFolderFor: (trackId: string, folderId: string | undefined) => void;
  addVca: (name?: string) => string;
  assignVca: (trackId: string, vcaId: string | undefined) => void;
  /** Reorder tracks; the folder a track lands in follows from its neighbours. */
  moveTrack: (id: string, toIndex: number) => void;

  // ---- scratch pads ----
  createScratchPad: (name?: string) => string;
  deleteScratchPad: (id: string) => void;
  renameScratchPad: (id: string, name: string) => void;
  /** Swap a pad's clips into the timeline, stashing the current ones back. */
  swapScratchPad: (id: string) => void;
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
  // Undo/redo stacks hold previous project OBJECTS, not JSON strings. The
  // outgoing project is never mutated again (update() always works on a fresh
  // clone), so pushing the reference is safe and skips a full serialization
  // per edit — measured at ~138 ms per edit on a 50,000-clip project.
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
        undoStack: [...undoStack.slice(-(MAX_UNDO - 1)), project],
        redoStack: [],
      });
    } else {
      set({ project: draft, dirty: true });
    }
  };

  const trackById = (draft: ProjectData, id: string) => draft.tracks.find((t) => t.id === id);
  const clipById = (draft: ProjectData, id: string) => draft.clips.find((c) => c.id === id);
  /** Locked clips and clips on locked tracks refuse timing edits. */
  const editable = (draft: ProjectData, c: Clip) =>
    !c.locked && !trackById(draft, c.trackId)?.locked;

  return {
    project: createDemoProject(),
    dirty: false,
    lastSavedAt: null,
    undoStack: [],
    redoStack: [],
    gestureSnapshot: null,
    gestureDepth: 0,

    setProject: (p, opts) =>
      set({
        project: p,
        dirty: opts?.markClean ? false : true,
        lastSavedAt: opts?.markClean ? Date.now() : get().lastSavedAt,
        undoStack: [],
        redoStack: [],
        gestureSnapshot: null,
        gestureDepth: 0,
      }),

    update,

    undo: () => {
      const { undoStack, redoStack, project } = get();
      const prev = undoStack[undoStack.length - 1];
      if (!prev) return;
      set({
        project: prev,
        undoStack: undoStack.slice(0, -1),
        redoStack: [...redoStack.slice(-(MAX_UNDO - 1)), project],
        dirty: true,
      });
    },

    redo: () => {
      const { undoStack, redoStack, project } = get();
      const next = redoStack[redoStack.length - 1];
      if (!next) return;
      set({
        project: next,
        redoStack: redoStack.slice(0, -1),
        undoStack: [...undoStack.slice(-(MAX_UNDO - 1)), project],
        dirty: true,
      });
    },

    beginGesture: () => {
      const { gestureSnapshot, gestureDepth } = get();
      set({
        gestureDepth: gestureDepth + 1,
        ...(gestureSnapshot === null ? { gestureSnapshot: get().project } : {}),
      });
    },

    endGesture: () => {
      const { gestureDepth } = get();
      if (gestureDepth > 1) {
        set({ gestureDepth: gestureDepth - 1 });
        return;
      }
      get().flushGestures();
    },

    flushGestures: () => {
      const { gestureSnapshot, undoStack, project } = get();
      if (gestureSnapshot === null) {
        if (get().gestureDepth !== 0) set({ gestureDepth: 0 });
        return;
      }
      // A gesture that performed at least one update replaced the project
      // object, so reference identity is an exact (and free) change check.
      const changed = gestureSnapshot !== project;
      set({
        gestureSnapshot: null,
        gestureDepth: 0,
        ...(changed
          ? { undoStack: [...undoStack.slice(-(MAX_UNDO - 1)), gestureSnapshot], redoStack: [] }
          : {}),
      });
    },

    markSaved: (saved) =>
      set((s) =>
        s.project === saved
          ? { dirty: false, lastSavedAt: Date.now() }
          : { lastSavedAt: Date.now() },
      ),

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
          if (!c || !editable(d, c)) return;
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
          if (!c || !editable(d, c)) return;
          c.start = Math.max(0, start);
          c.length = Math.max(0.25, length);
        },
        { undoable: false },
      ),

    moveClipsBy: (ids, deltaBeats) =>
      update((d) => {
        const targets = d.clips.filter((c) => ids.includes(c.id) && editable(d, c));
        if (targets.length === 0 || !Number.isFinite(deltaBeats)) return;
        const minStart = Math.min(...targets.map((c) => c.start));
        const delta = Math.max(-minStart, deltaBeats);
        for (const c of targets) c.start += delta;
      }),

    deleteClips: (ids) =>
      update((d) => {
        const set = new Set(ids);
        d.clips = d.clips.filter((c) => !set.has(c.id) || !editable(d, c));
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
        d.clips = d.clips.filter((c) => c.id !== id || !editable(d, c));
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
          if (!c || !editable(d, c)) return;
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
          if (!c || !editable(d, c)) return;
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
      if (src.locked || get().project.tracks.find((t) => t.id === src.trackId)?.locked) return null;
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
          if (c?.type === 'audio' && editable(d, c)) c.gain = clamp(gain, 0, 4);
        },
        { undoable: false },
      ),

    setClipFades: (id, fadeIn, fadeOut) =>
      update(
        (d) => {
          const c = clipById(d, id);
          if (c?.type !== 'audio' || !editable(d, c)) return;
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

    // ---- Milestone 6 -----------------------------------------------------

    slipClip: (id, deltaSec, maxOffset) =>
      update(
        (d) => {
          const c = clipById(d, id);
          if (c?.type !== 'audio' || !editable(d, c)) return;
          let next = c.offset + deltaSec;
          if (maxOffset !== undefined) next = Math.min(next, Math.max(0, maxOffset));
          c.offset = Math.max(0, next);
        },
        { undoable: false },
      ),

    healClips: (ids) => {
      let joins = 0;
      update((d) => {
        const spb = 60 / d.bpm;
        const targets = d.clips
          .filter((c) => ids.includes(c.id) && editable(d, c))
          .sort((a, b) =>
            a.trackId === b.trackId ? a.start - b.start : a.trackId < b.trackId ? -1 : 1,
          );
        const gone = new Set<string>();
        for (let i = 0; i < targets.length - 1; i++) {
          const left = targets[i];
          const right = targets[i + 1];
          if (gone.has(left.id) || gone.has(right.id)) continue;
          if (left.trackId !== right.trackId) continue;
          if (Math.abs(left.start + left.length - right.start) > 0.02) continue;
          if (left.type === 'audio' && right.type === 'audio') {
            // Heal only what is genuinely one piece of material.
            if (left.mediaId !== right.mediaId) continue;
            const expectedOffset = left.offset + (left.sourceDuration ?? left.length * spb);
            if (Math.abs(right.offset - expectedOffset) > 0.015) continue;
            left.length += right.length;
            left.sourceDuration =
              (left.sourceDuration ?? 0) > 0 || (right.sourceDuration ?? 0) > 0
                ? (left.sourceDuration ?? left.length * spb) +
                  (right.sourceDuration ?? right.length * spb)
                : undefined;
            left.fadeOut = right.fadeOut;
            if (right.fadeOutShape) left.fadeOutShape = right.fadeOutShape;
            else delete left.fadeOutShape;
            gone.add(right.id);
            targets[i + 1] = left; // allow chaining heals along a split run
            joins++;
          } else if (left.type === 'midi' && right.type === 'midi') {
            const shift = right.start - left.start;
            for (const n of right.notes) {
              left.notes.push({ ...n, id: newId('n'), start: n.start + shift });
            }
            left.length += right.length;
            gone.add(right.id);
            targets[i + 1] = left;
            joins++;
          }
        }
        if (gone.size) d.clips = d.clips.filter((c) => !gone.has(c.id));
      });
      return joins;
    },

    rippleDeleteClips: (ids) =>
      update((d) => {
        const victims = d.clips.filter((c) => ids.includes(c.id) && editable(d, c));
        if (victims.length === 0) return;
        const victimIds = new Set(victims.map((c) => c.id));
        d.clips = d.clips.filter((c) => !victimIds.has(c.id));
        // Per track: close each removed span by pulling later editable clips
        // left, processing right-to-left so spans do not shift under us.
        const byTrack = new Map<string, Clip[]>();
        for (const v of victims) {
          const list = byTrack.get(v.trackId) ?? [];
          list.push(v);
          byTrack.set(v.trackId, list);
        }
        for (const [trackId, list] of byTrack) {
          list.sort((a, b) => b.start - a.start);
          for (const v of list) {
            for (const c of d.clips) {
              if (c.trackId !== trackId || !editable(d, c)) continue;
              if (c.start >= v.start + v.length - 1e-9) c.start = Math.max(0, c.start - v.length);
            }
          }
        }
      }),

    createCrossfade: (leftId, rightId, lengthBeats, shape) => {
      let ok = false;
      update((d) => {
        const spb = 60 / d.bpm;
        // Known media duration bounds extension; unknown media gets none, so a
        // crossfade can never schedule silence it cannot verify exists.
        const getMediaDur = (c: AudioClip) =>
          d.media?.find((m) => m.id === c.mediaId)?.duration ??
          c.offset + (c.sourceDuration ?? c.length * spb);
        let left = clipById(d, leftId);
        let right = clipById(d, rightId);
        if (left?.type !== 'audio' || right?.type !== 'audio') return;
        if (left.trackId !== right.trackId) return;
        if (!editable(d, left) || !editable(d, right)) return;
        if (right.start < left.start) [left, right] = [right, left];
        const leftEnd = left.start + left.length;
        // The clips must at least touch (small gaps refuse rather than guess).
        if (right.start > leftEnd + 0.05) return;
        let overlap = leftEnd - right.start;
        const want = Math.max(0.05, lengthBeats);
        if (overlap < want) {
          // Grow the overlap from both sides using real source headroom.
          let need = want - overlap;
          const leftSrc = left.sourceDuration ?? left.length * spb;
          const leftHeadSec = Math.max(0, getMediaDur(left) - (left.offset + leftSrc));
          const extendLeft = Math.min(need / 2, leftHeadSec / spb);
          if (extendLeft > 0) {
            left.length += extendLeft;
            left.sourceDuration = leftSrc + extendLeft * spb;
            need -= extendLeft;
          }
          const rightHead = Math.min(need, right.offset / spb, right.start - left.start);
          if (rightHead > 0) {
            right.start -= rightHead;
            right.offset -= rightHead * spb;
            right.length += rightHead;
            right.sourceDuration = (right.sourceDuration ?? right.length * spb) + rightHead * spb;
            need -= rightHead;
          }
          overlap = left.start + left.length - right.start;
        }
        if (overlap <= 0.01) return;
        const fadeSec = overlap * spb;
        left.fadeOut = fadeSec;
        left.fadeOutShape = shape;
        right.fadeIn = fadeSec;
        right.fadeInShape = shape;
        ok = true;
      });
      return ok;
    },

    setFadeShape: (id, which, shape) =>
      update((d) => {
        const c = clipById(d, id);
        if (c?.type !== 'audio' || !editable(d, c)) return;
        if (which === 'in') c.fadeInShape = shape;
        else c.fadeOutShape = shape;
      }),

    packTakes: (ids) => {
      let newId2: string | null = null;
      update((d) => {
        const spb = 60 / d.bpm;
        const clips = d.clips.filter(
          (c): c is AudioClip => ids.includes(c.id) && c.type === 'audio' && editable(d, c),
        );
        if (clips.length < 2) return;
        const trackId = clips[0].trackId;
        if (!clips.every((c) => c.trackId === trackId)) return;
        const takeClip = buildTakeClip(clips, spb);
        if (!takeClip) return;
        const gone = new Set(clips.map((c) => c.id));
        d.clips = d.clips.filter((c) => !gone.has(c.id));
        d.clips.push(takeClip);
        newId2 = takeClip.id;
      });
      return newId2;
    },

    promoteTake: (clipId, takeId) =>
      update((d) => {
        const c = clipById(d, clipId);
        if (c?.type !== 'audio' || !c.takes) return;
        if (!c.takes.some((t) => t.id === takeId)) return;
        c.comp = [{ at: 0, takeId }];
        delete c.soloTakeId;
      }),

    setCompRange: (clipId, fromBeat, toBeat, takeId) =>
      update(
        (d) => {
          const c = clipById(d, clipId);
          if (c?.type !== 'audio' || !c.takes) return;
          if (!c.takes.some((t) => t.id === takeId)) return;
          const from = Math.max(0, Math.min(fromBeat, toBeat));
          const to = Math.min(c.length, Math.max(fromBeat, toBeat));
          if (to - from < 1e-6) return;
          const segs = normalizeComp(c.comp, c.takes, c.length);
          // What sounds after the range must keep sounding: capture the take
          // active at `to`, drop segments inside the range, insert ours.
          const afterTake = segs.filter((s) => s.at <= to).pop()?.takeId ?? c.takes[0].id;
          const kept = segs.filter((s) => s.at < from - 1e-9 || s.at > to + 1e-9);
          kept.push({ at: from, takeId });
          if (to < c.length - 1e-9) kept.push({ at: to, takeId: afterTake });
          c.comp = normalizeComp(kept, c.takes, c.length);
          delete c.soloTakeId;
        },
        { undoable: false },
      ),

    deleteTake: (clipId, takeId) =>
      update((d) => {
        const c = clipById(d, clipId);
        if (c?.type !== 'audio' || !c.takes) return;
        const idx = c.takes.findIndex((t) => t.id === takeId);
        if (idx < 0) return;
        if (c.takes.length === 1) {
          // Deleting the last take flattens the clip to that material.
          const t = c.takes[0];
          c.mediaId = t.mediaId;
          c.offset = Math.max(0, t.offset);
          delete c.takes;
          delete c.comp;
          delete c.soloTakeId;
          delete c.takesOpen;
          return;
        }
        c.takes.splice(idx, 1);
        c.comp = normalizeComp(
          (c.comp ?? []).filter((s) => s.takeId !== takeId),
          c.takes,
          c.length,
        );
        if (c.soloTakeId === takeId) delete c.soloTakeId;
      }),

    moveTake: (clipId, takeId, delta) =>
      update((d) => {
        const c = clipById(d, clipId);
        if (c?.type !== 'audio' || !c.takes) return;
        const i = c.takes.findIndex((t) => t.id === takeId);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= c.takes.length) return;
        const [t] = c.takes.splice(i, 1);
        c.takes.splice(j, 0, t);
      }),

    setTakeMuted: (clipId, takeId, muted) =>
      update((d) => {
        const t = (clipById(d, clipId) as AudioClip | undefined)?.takes?.find(
          (x) => x.id === takeId,
        );
        if (t) t.muted = muted;
      }),

    setSoloTake: (clipId, takeId) =>
      update(
        (d) => {
          const c = clipById(d, clipId);
          if (c?.type !== 'audio' || !c.takes) return;
          if (takeId === null) delete c.soloTakeId;
          else if (c.takes.some((t) => t.id === takeId)) c.soloTakeId = takeId;
        },
        { undoable: false },
      ),

    setClipView: (id, patch) =>
      update(
        (d) => {
          const c = clipById(d, id);
          if (c?.type !== 'audio') return;
          if (patch.takesOpen !== undefined) {
            if (patch.takesOpen) c.takesOpen = true;
            else delete c.takesOpen;
          }
        },
        { undoable: false },
      ),

    // ---- Milestone 7 -----------------------------------------------------

    setSamplerParams: (trackId, patch) =>
      update(
        (d) => {
          const t = trackById(d, trackId);
          if (t?.sampler) Object.assign(t.sampler, patch);
        },
        { undoable: false },
      ),

    setInstrument: (trackId, kind) =>
      update((d) => {
        const t = trackById(d, trackId);
        if (!t || (t.type !== 'instrument' && t.type !== 'drum')) return;
        delete t.rack;
        if (kind === 'synth') {
          delete t.sampler;
          if (!t.synth) t.synth = getPreset(SYNTH_PRESETS[0].presetName);
        } else if (kind === 'drum') {
          t.sampler = buildDrumKit();
        } else {
          t.sampler = defaultSamplerParams(kind === 'multi' ? 'multi' : 'quick');
        }
      }),

    addSamplerZones: (trackId, zones) => {
      const ids: string[] = [];
      update((d) => {
        const t = trackById(d, trackId);
        if (!t?.sampler) return;
        for (const z of zones) {
          t.sampler.zones.push(z);
          ids.push(z.id);
        }
      });
      return ids;
    },

    updateSamplerZones: (trackId, ids, patch) =>
      update(
        (d) => {
          const t = trackById(d, trackId);
          if (!t?.sampler) return;
          for (const z of t.sampler.zones) {
            if (ids.includes(z.id)) Object.assign(z, patch(z));
          }
        },
        { undoable: false },
      ),

    removeSamplerZones: (trackId, ids) =>
      update((d) => {
        const t = trackById(d, trackId);
        if (!t?.sampler) return;
        t.sampler.zones = t.sampler.zones.filter((z) => !ids.includes(z.id));
      }),

    assignPad: (trackId, padIndex, mediaId, name) =>
      update((d) => {
        const t = trackById(d, trackId);
        if (!t?.sampler) return;
        const key = DRUM_PAD_BASE + padIndex;
        const existing = t.sampler.zones.find((z) => z.keyLo === key && z.keyHi === key);
        if (existing) {
          existing.mediaId = mediaId;
          if (name) existing.name = name;
          existing.startSec = 0;
          delete existing.endSec;
        } else {
          t.sampler.zones.push(makePadZone(mediaId, padIndex, name ?? `Pad ${padIndex + 1}`));
        }
      }),

    setZoneSlices: (trackId, zoneId, slices) =>
      update((d) => {
        const z = trackById(d, trackId)?.sampler?.zones.find((x) => x.id === zoneId);
        if (!z) return;
        const clean = slices.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
        if (clean.length) z.slices = clean;
        else delete z.slices;
      }),

    sliceToPads: (trackId, zoneId) => {
      let made = 0;
      update((d) => {
        const t = trackById(d, trackId);
        const z = t?.sampler?.zones.find((x) => x.id === zoneId);
        if (!t?.sampler || !z || !z.slices || z.slices.length === 0) return;
        const ends = [...z.slices.slice(1), z.endSec];
        const pads = z.slices.slice(0, 64).map((startSec, i) => {
          const pad = makePadZone(z.mediaId, i, `Slice ${i + 1}`);
          pad.startSec = startSec;
          if (ends[i] !== undefined) pad.endSec = ends[i];
          pad.reverse = z.reverse;
          return pad;
        });
        t.sampler.view = 'drum';
        t.sampler.zones = pads;
        made = pads.length;
      });
      return made;
    },

    sliceToMidiClip: (trackId, zoneId, startBeat) => {
      let clipId: string | null = null;
      update((d) => {
        const t = trackById(d, trackId);
        const z = t?.sampler?.zones.find((x) => x.id === zoneId);
        if (!t || !z || !z.slices || z.slices.length === 0) return;
        const spb = 60 / d.bpm;
        const base = z.slices[0];
        const id = newId('c');
        const notes = z.slices.slice(0, 64).map((sec, i) => {
          const next = z.slices![i + 1];
          const lenSec = (next ?? sec + 0.25) - sec;
          return {
            id: newId('n'),
            start: (sec - base) / spb,
            length: Math.max(0.1, lenSec / spb),
            pitch: DRUM_PAD_BASE + i,
            velocity: 100,
          };
        });
        const length = Math.max(1, Math.ceil(notes[notes.length - 1].start + 1));
        d.clips.push({
          id,
          trackId,
          type: 'midi',
          name: 'Slices',
          start: Math.max(0, startBeat),
          length,
          muted: false,
          notes,
        });
        clipId = id;
      });
      return clipId;
    },

    applySamplerPreset: (trackId, preset) =>
      update((d) => {
        const t = trackById(d, trackId);
        if (!t || (t.type !== 'instrument' && t.type !== 'drum')) return;
        delete t.rack;
        t.sampler = structuredClone(preset);
      }),

    rackAddItem: (trackId, kind) => {
      const id = newId('rk');
      let ok = false;
      update((d) => {
        const t = trackById(d, trackId);
        if (!t || (t.type !== 'instrument' && t.type !== 'drum')) return;
        if (!t.rack) t.rack = { items: [] };
        if (t.rack.items.length >= 8) return;
        const item: RackItem = {
          id,
          name: kind === 'sampler' ? 'Sampler layer' : 'Synth layer',
          color: TRACK_COLORS[t.rack.items.length % TRACK_COLORS.length],
          keyLo: 0,
          keyHi: 127,
          muted: false,
          solo: false,
          kind,
          ...(kind === 'sampler'
            ? { sampler: defaultSamplerParams('quick') }
            : { synth: getPreset(SYNTH_PRESETS[0].presetName) }),
        };
        t.rack.items.push(item);
        ok = true;
      });
      return ok ? id : null;
    },

    rackUpdateItem: (trackId, itemId, patch) =>
      update((d) => {
        const it = trackById(d, trackId)?.rack?.items.find((x) => x.id === itemId);
        if (it) Object.assign(it, patch);
      }),

    rackRemoveItem: (trackId, itemId) =>
      update((d) => {
        const t = trackById(d, trackId);
        if (!t?.rack) return;
        t.rack.items = t.rack.items.filter((x) => x.id !== itemId);
        if (t.rack.items.length === 0) delete t.rack;
      }),

    rackMoveItem: (trackId, itemId, delta) =>
      update((d) => {
        const items = trackById(d, trackId)?.rack?.items;
        if (!items) return;
        const i = items.findIndex((x) => x.id === itemId);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= items.length) return;
        const [m] = items.splice(i, 1);
        items.splice(j, 0, m);
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
          d.bpm = clamp(Math.round(bpm * 10) / 10, 20, 999);
          // The song's starting tempo lives in the map once one exists; letting
          // the scalar drift from it would make the ruler and playback disagree.
          if (d.tempoMap?.tempos.length) d.tempoMap.tempos[0].bpm = d.bpm;
        },
        { undoable: false },
      ),

    setTimeSig: (num, den) =>
      update((d) => {
        d.timeSig = {
          num: clamp(Math.round(num), 1, 32),
          den: [1, 2, 4, 8, 16, 32].includes(den) ? den : 4,
        };
        if (d.tempoMap?.sigs.length) {
          d.tempoMap.sigs[0].num = d.timeSig.num;
          d.tempoMap.sigs[0].den = d.timeSig.den;
        }
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

    // ---------------------------------------------------------- tempo map

    setTempoEvent: (beat, bpm, curve) =>
      update((d) => {
        const map = ensureMap(d);
        const at = Math.max(0, Math.round(beat * 1e6) / 1e6);
        const existing = map.tempos.find((t) => Math.abs(t.beat - at) < 1e-6);
        if (existing) {
          existing.bpm = clamp(bpm, 20, 999);
          if (curve) existing.curve = curve;
        } else {
          map.tempos.push({
            id: newId('tmp'),
            beat: at,
            bpm: clamp(bpm, 20, 999),
            curve: curve ?? 'jump',
          });
          map.tempos.sort((a, b) => a.beat - b.beat);
        }
        syncScalarTempo(d);
      }),

    removeTempoEvent: (id) =>
      update((d) => {
        const map = ensureMap(d);
        // The event at beat 0 is the song's starting tempo; it can be changed
        // but never removed, or there would be no tempo before the first event.
        map.tempos = map.tempos.filter((t) => t.id !== id || t.beat === 0);
        syncScalarTempo(d);
      }),

    moveTempoEvent: (id, beat) =>
      update((d) => {
        const map = ensureMap(d);
        const ev = map.tempos.find((t) => t.id === id);
        if (!ev || ev.beat === 0) return;
        ev.beat = Math.max(0.001, Math.round(beat * 1e6) / 1e6);
        map.tempos.sort((a, b) => a.beat - b.beat);
        syncScalarTempo(d);
      }),

    setSignature: (bar, num, den) =>
      update((d) => {
        const map = ensureMap(d);
        const at = Math.max(0, Math.round(bar));
        const n = clamp(Math.round(num), 1, 32);
        const dd = [1, 2, 4, 8, 16, 32].includes(den) ? den : 4;
        const existing = map.sigs.find((sg) => sg.bar === at);
        if (existing) {
          existing.num = n;
          existing.den = dd;
        } else {
          map.sigs.push({ id: newId('sig'), bar: at, num: n, den: dd });
          map.sigs.sort((a, b) => a.bar - b.bar);
        }
        syncScalarTempo(d);
      }),

    removeSignature: (id) =>
      update((d) => {
        const map = ensureMap(d);
        map.sigs = map.sigs.filter((sg) => sg.id !== id || sg.bar === 0);
        syncScalarTempo(d);
      }),

    // ------------------------------------------------------------ markers

    addMarker: (beat, name) => {
      const id = newId('mk');
      update((d) => {
        const markers = (d.markers ??= []);
        markers.push({
          id,
          beat: Math.max(0, beat),
          name: name?.trim() || `Marker ${markers.length + 1}`,
          color: MARKER_COLORS[markers.length % MARKER_COLORS.length],
        });
        d.markers = normalizeMarkers(markers);
      });
      return id;
    },

    setMarker: (id, patch) =>
      update((d) => {
        const m = d.markers?.find((x) => x.id === id);
        if (!m) return;
        Object.assign(m, patch);
        d.markers = normalizeMarkers(d.markers);
      }),

    removeMarker: (id) =>
      update((d) => {
        d.markers = (d.markers ?? []).filter((m) => m.id !== id);
      }),

    // ----------------------------------------------------------- sections

    addSection: (start, length, name) => {
      const id = newId('sec');
      update((d) => {
        const sections = (d.sections ??= []);
        const label = name?.trim() || `Section ${sections.length + 1}`;
        sections.push({
          id,
          start: Math.max(0, start),
          length: Math.max(1, length),
          name: label,
          color: sectionColorFor(label, SECTION_COLORS.verse),
        });
        d.sections = normalizeSections(sections);
      });
      return id;
    },

    setSection: (id, patch) =>
      update((d) => {
        const sec = d.sections?.find((x) => x.id === id);
        if (!sec) return;
        Object.assign(sec, patch);
        if (patch.name && !patch.color) sec.color = sectionColorFor(patch.name, sec.color);
        d.sections = normalizeSections(d.sections);
      }),

    removeSection: (id) =>
      update((d) => {
        d.sections = (d.sections ?? []).filter((s2) => s2.id !== id);
      }),

    moveSection: (id, toIndex) =>
      update((d) => {
        const sections = d.sections ?? [];
        const from = sections.findIndex((s2) => s2.id === id);
        if (from < 0) return;
        const { sections: next, deltas } = reorderSections(sections, from, toIndex);
        // Capture each section's ORIGINAL window before anything moves, so a
        // clip is assigned to exactly one section even after the list shifts.
        const windows = sections.map((s2) => ({
          id: s2.id,
          from: s2.start,
          to: s2.start + s2.length,
          delta: deltas.get(s2.id) ?? 0,
        }));
        const shiftOf = (beat: number): number => {
          for (const w of windows) {
            if (beat >= w.from - 1e-9 && beat < w.to - 1e-9) return w.delta;
          }
          return 0;
        };
        for (const c of d.clips) {
          const shift = shiftOf(c.start);
          if (shift) c.start = Math.max(0, c.start + shift);
        }
        for (const t of d.tracks) {
          for (const lane of t.automation ?? []) {
            for (const pt of lane.points) {
              const shift = shiftOf(pt.beat);
              if (shift) pt.beat = Math.max(0, pt.beat + shift);
            }
            normalizeLanePoints(lane.points);
          }
        }
        for (const m of d.markers ?? []) m.beat = Math.max(0, m.beat + shiftOf(m.beat));
        for (const ch of d.chords ?? []) ch.beat = Math.max(0, ch.beat + shiftOf(ch.beat));
        d.sections = next;
        d.markers = normalizeMarkers(d.markers);
        d.chords = normalizeChords(d.chords);
      }),

    // ------------------------------------------------------------- chords

    setChord: (beat, root, quality, bass) => {
      const id = newId('ch');
      update((d) => {
        const chords = (d.chords ??= []);
        const at = Math.max(0, beat);
        const existing = chords.find((c) => Math.abs(c.beat - at) < 1e-6);
        if (existing) {
          existing.root = ((Math.round(root) % 12) + 12) % 12;
          existing.quality = quality;
          if (bass === undefined) delete existing.bass;
          else existing.bass = ((Math.round(bass) % 12) + 12) % 12;
        } else {
          chords.push({
            id,
            beat: at,
            root: ((Math.round(root) % 12) + 12) % 12,
            quality,
            ...(bass === undefined ? {} : { bass: ((Math.round(bass) % 12) + 12) % 12 }),
          });
        }
        d.chords = normalizeChords(chords);
      });
      return id;
    },

    removeChord: (id) =>
      update((d) => {
        d.chords = (d.chords ?? []).filter((c) => c.id !== id);
      }),

    clearChords: () =>
      update((d) => {
        d.chords = [];
      }),

    // ------------------------------------------------------ master channel

    setMaster: (patch) =>
      update(
        (d) => {
          const m = ensureMaster(d);
          Object.assign(m, patch);
          m.volume = clamp(m.volume, 0, 1.5);
          m.pan = clamp(m.pan, -1, 1);
          // masterVolume stays the single source older readers see.
          d.masterVolume = m.volume;
        },
        { undoable: patch.volume === undefined && patch.pan === undefined },
      ),

    addMasterEffect: (kind) => {
      const id = newId('fx');
      let ok = false;
      update((d) => {
        const m = ensureMaster(d);
        const fx = (m.effects ??= []);
        if (fx.length >= MAX_INSERTS) return;
        fx.push({ id, kind, bypass: false, params: defaultParams(kind) });
        ok = true;
      });
      return ok ? id : null;
    },

    removeMasterEffect: (effectId) =>
      update((d) => {
        const m = ensureMaster(d);
        m.effects = (m.effects ?? []).filter((e) => e.id !== effectId);
        // A lane that automated the removed insert has nothing left to drive.
        m.automation = (m.automation ?? []).filter((l) => !l.paramId.startsWith(`fx:${effectId}:`));
      }),

    setMasterEffectParam: (effectId, key, value) =>
      update(
        (d) => {
          const e = ensureMaster(d).effects?.find((x) => x.id === effectId);
          if (!e) return;
          const spec = effectSpec(e.kind)?.params.find((pp) => pp.key === key);
          e.params[key] = spec ? clamp(value, spec.min, spec.max) : value;
        },
        { undoable: false },
      ),

    setMasterEffectBypass: (effectId, bypass) =>
      update((d) => {
        const e = ensureMaster(d).effects?.find((x) => x.id === effectId);
        if (e) e.bypass = bypass;
      }),

    moveMasterEffect: (effectId, delta) =>
      update((d) => {
        const fx = ensureMaster(d).effects ?? [];
        const i = fx.findIndex((e) => e.id === effectId);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= fx.length) return;
        [fx[i], fx[j]] = [fx[j], fx[i]];
      }),

    // ----------------------------------------------------------- grouping

    groupTracks: (trackIds, name) => {
      const id = newId('folder');
      let ok = false;
      update((d) => {
        const members = d.tracks.filter((t) => trackIds.includes(t.id) && t.type !== 'folder');
        if (members.length === 0) return;
        const firstIndex = Math.min(...members.map((t) => d.tracks.indexOf(t)));
        const folder: Track = {
          id,
          type: 'folder',
          name: name?.trim() || `Group ${d.tracks.filter((t) => t.type === 'folder').length + 1}`,
          color: members[0].color,
          volume: 1,
          pan: 0,
          mute: false,
          solo: false,
          armed: false,
          collapsed: false,
          output: 'master',
          folderId: members[0].folderId,
        };
        for (const m of members) m.folderId = id;
        d.tracks.splice(firstIndex, 0, folder);
        ok = true;
      });
      return ok ? id : null;
    },

    ungroupFolder: (folderId) =>
      update((d) => {
        const folder = d.tracks.find((t) => t.id === folderId && t.type === 'folder');
        if (!folder) return;
        for (const t of d.tracks) {
          if (t.folderId === folderId) {
            if (folder.folderId) t.folderId = folder.folderId;
            else delete t.folderId;
          }
        }
        d.tracks = d.tracks.filter((t) => t.id !== folderId);
      }),

    setFolderFor: (trackId, folderId) =>
      update((d) => {
        const t = trackById(d, trackId);
        if (!t) return;
        if (!folderId) {
          delete t.folderId;
          return;
        }
        const folder = d.tracks.find((x) => x.id === folderId && x.type === 'folder');
        if (!folder || folderId === trackId) return;
        // Refuse a cycle: a folder cannot be dropped inside its own subtree.
        let cursor: string | undefined = folder.folderId;
        const seen = new Set<string>([folderId]);
        while (cursor) {
          if (cursor === trackId || seen.has(cursor)) return;
          seen.add(cursor);
          cursor = d.tracks.find((x) => x.id === cursor)?.folderId;
        }
        t.folderId = folderId;
      }),

    addVca: (name) => {
      const id = newId('vca');
      update((d) => {
        const n = d.tracks.filter((t) => t.type === 'vca').length + 1;
        d.tracks.push({
          id,
          type: 'vca',
          name: name?.trim() || `VCA ${n}`,
          color: TRACK_COLORS[(d.tracks.length + 3) % TRACK_COLORS.length],
          volume: 1,
          pan: 0,
          mute: false,
          solo: false,
          armed: false,
          collapsed: false,
          output: 'master',
        });
      });
      return id;
    },

    assignVca: (trackId, vcaId) =>
      update((d) => {
        const t = trackById(d, trackId);
        if (!t || t.type === 'vca') return;
        if (!vcaId) delete t.vcaId;
        else if (d.tracks.some((x) => x.id === vcaId && x.type === 'vca')) t.vcaId = vcaId;
      }),

    moveTrack: (id, toIndex) =>
      update((d) => {
        const from = d.tracks.findIndex((t) => t.id === id);
        if (from < 0) return;
        const to = clamp(Math.round(toIndex), 0, d.tracks.length - 1);
        if (from === to) return;
        const [moved] = d.tracks.splice(from, 1);
        d.tracks.splice(to, 0, moved);
      }),

    // ------------------------------------------------------- scratch pads

    createScratchPad: (name) => {
      const id = newId('pad');
      update((d) => {
        const pads = (d.scratchPads ??= []);
        pads.push({
          id,
          name: name?.trim() || `Pad ${pads.length + 1}`,
          clips: [],
          length: 32,
          createdAt: Date.now(),
        });
      });
      return id;
    },

    deleteScratchPad: (id) =>
      update((d) => {
        d.scratchPads = (d.scratchPads ?? []).filter((p2) => p2.id !== id);
        if (d.activePadId === id) delete d.activePadId;
      }),

    renameScratchPad: (id, name) =>
      update((d) => {
        const pad = d.scratchPads?.find((p2) => p2.id === id);
        if (pad) pad.name = name.slice(0, 60) || pad.name;
      }),

    swapScratchPad: (id) =>
      update((d) => {
        const pad = d.scratchPads?.find((p2) => p2.id === id);
        if (!pad) return;
        const liveClips = d.clips;
        // Clips whose track no longer exists cannot come back into the
        // timeline; dropping them here is the only place it can be noticed.
        const trackIds = new Set(d.tracks.map((t) => t.id));
        d.clips = pad.clips.filter((c) => trackIds.has(c.trackId));
        pad.clips = liveClips;
        d.activePadId = d.activePadId === id ? undefined : id;
      }),

    setMasterVolume: (v) =>
      update(
        (d) => {
          d.masterVolume = clamp(v, 0, 1.5);
          // The engine reads `master.volume` first and validation always
          // materialises that object, so writing only the legacy scalar left
          // the master fader inert on every saved project.
          ensureMaster(d).volume = d.masterVolume;
        },
        { undoable: false },
      ),
  };
});

/**
 * The tempo map, created on demand. Projects made before v6 (and every QA
 * fixture) carry only `bpm`/`timeSig`; the first tempo edit is what turns that
 * into a map, seeded so the song sounds identical until something is changed.
 */
function ensureMap(d: ProjectData) {
  d.tempoMap = normalizeTempoMap(d.tempoMap, d.bpm, d.timeSig);
  return d.tempoMap;
}

/**
 * Keep the scalar `bpm`/`timeSig` equal to the map's value at beat 0. They are
 * what an older build, an export header and the diagnostics report read, so
 * they must never drift from the map.
 */
function syncScalarTempo(d: ProjectData): void {
  const map = d.tempoMap;
  if (!map) return;
  d.bpm = map.tempos[0].bpm;
  d.timeSig = { num: map.sigs[0].num, den: map.sigs[0].den };
}

function ensureMaster(d: ProjectData): NonNullable<ProjectData['master']> {
  d.master ??= {
    volume: d.masterVolume,
    pan: 0,
    effects: [],
    limiter: true,
  };
  return d.master;
}

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
