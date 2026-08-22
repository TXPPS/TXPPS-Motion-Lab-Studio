import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import {
  bucketNotesByPitch,
  buildPadDrumMap,
  BUILT_IN_DRUM_MAPS,
  GM_DRUM_MAP,
  laneList,
  type DrumMap,
  type DrumMapId,
} from '../../model/drumMap';
import { clamp, tempoMapOf } from '../../model/music';
import { barToBeat, beatsPerBarAt, beatToBar, formatBBT } from '../../model/tempo';
import type { MidiClip, Note } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';
import {
  DrumGrid,
  DrumRail,
  DrumRuler,
  drumGridWidth,
  LANE_H,
  RAIL_W,
  RULER_H,
  type DrumGridEdit,
  type GridWindow,
} from './DrumGrid';
import '../../styles/drumeditor.css';

/** Beat comparisons tolerate float drift from triplet grids. */
const EPS = 1e-6;
/** A hit is a trigger, not a sustain: cap its length however coarse the step is. */
const MAX_HIT_LEN = 0.25;
/** Grace-note distance for a flam, and the fraction of the velocity it keeps. */
const FLAM_GAP = 1 / 12;
const FLAM_VEL = 0.55;
/** Hits a roll divides one step into. */
const ROLL_DIVISIONS = 4;

const STEPS: { label: string; beats: number }[] = [
  { label: '1/4', beats: 1 },
  { label: '1/8', beats: 0.5 },
  { label: '1/16', beats: 0.25 },
  { label: '1/32', beats: 0.125 },
  { label: '1/8T', beats: 1 / 3 },
  { label: '1/16T', beats: 1 / 6 },
];

const VELOCITY_PRESETS: { label: string; velocity: number }[] = [
  { label: 'Ghost', velocity: 36 },
  { label: 'Soft', velocity: 72 },
  { label: 'Normal', velocity: 100 },
  { label: 'Accent', velocity: 122 },
];

function auditionNote(trackId: string, pitch: number, velocity: number): void {
  engine.liveNoteOn(trackId, pitch, velocity);
  setTimeout(() => engine.liveNoteOff(trackId, pitch), 160);
}

/**
 * The Drum editor.
 *
 * A drum part is a grid of kit slots, not a field of pitches: rows come from a
 * drum map, a cell is on or off, and the only continuous value is velocity.
 * The store is the single owner of the notes — every gesture here opens one
 * undo entry with `beginGesture` and closes it with `endGesture`, so painting a
 * sixteen-hit hat run undoes in one stroke.
 */
export function DrumEditor() {
  const project = useProjectStore((s) => s.project);
  const editClipId = useUiStore((s) => s.editClipId);
  const selectedClipId = useUiStore((s) => s.selectedClipId);
  const selectedNoteIds = useUiStore((s) => s.selectedNoteIds);
  const snap = useUiStore((s) => s.prSnap);

  /**
   * Zoom is local. The piano roll's `prPxPerBeat` is a pitch-row zoom and a
   * step grid wants far more room per beat; sharing the number would make one
   * editor unusable whenever the other was comfortable. Snap is shared,
   * because the grid a part is written on is a property of the part.
   */
  const [ppb, setPpb] = useState(64);
  const [usedOnly, setUsedOnly] = useState(true);
  const [paintVelocity, setPaintVelocity] = useState(100);
  const [mapChoice, setMapChoice] = useState<DrumMapId | null>(null);
  const [soloPitch, setSoloPitch] = useState<number | null>(null);
  /** Notes already muted when solo was engaged, so releasing it restores them. */
  const preSoloMuted = useRef<Set<string> | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const winFrame = useRef(0);
  const [win, setWin] = useState<GridWindow>({ left: 0, right: 2400, top: 0, bottom: 1600 });

  const clip = useMemo((): MidiClip | null => {
    const byId = (id: string | null) => {
      const c = id ? project.clips.find((x) => x.id === id) : undefined;
      return c?.type === 'midi' ? c : null;
    };
    return byId(editClipId) ?? byId(selectedClipId) ?? null;
  }, [project.clips, editClipId, selectedClipId]);

  const track = clip ? (project.tracks.find((t) => t.id === clip.trackId) ?? null) : null;
  const notes = useMemo(() => clip?.notes ?? [], [clip]);

  const padMap = useMemo(() => buildPadDrumMap(track?.sampler), [track?.sampler]);
  // A track that carries its own pads names its own lanes; everything else
  // opens on the compact map rather than 47 mostly-empty GM rows.
  const mapId: DrumMapId = mapChoice ?? (padMap ? 'pads' : 'essential');
  const map: DrumMap = mapId === 'pads' ? (padMap ?? GM_DRUM_MAP) : BUILT_IN_DRUM_MAPS[mapId];

  const step = snap > 0 ? snap : 0.25;
  const lanes = useMemo(() => laneList(map, notes, usedOnly), [map, notes, usedOnly]);
  const notesByPitch = useMemo(() => bucketNotesByPitch(notes), [notes]);
  const selected = useMemo(() => new Set(selectedNoteIds), [selectedNoteIds]);

  const beats = clip ? Math.max(clip.length, step) : 4;
  const gridW = drumGridWidth(beats, step, ppb);
  const gridH = lanes.length * LANE_H;

  const barBeats = clip ? beatsPerBarAt(tempoMapOf(project), clip.start) : 4;

  /** Bar starts inside the clip, walked through the signature map. */
  const bars = useMemo(() => {
    if (!clip) return [];
    const tempo = tempoMapOf(project);
    const out: { bar: number; beat: number }[] = [];
    let bar = Math.floor(beatToBar(tempo, clip.start));
    for (let guard = 0; guard < 4096; guard++, bar++) {
      const beat = barToBeat(tempo, bar) - clip.start;
      if (beat > clip.length + EPS) break;
      if (beat >= -EPS) out.push({ bar: bar + 1, beat: Math.max(0, beat) });
    }
    return out;
  }, [project, clip]);

  const positionLabel = useCallback(
    (beat: number): string => {
      if (!clip) return '';
      const bb = formatBBT(tempoMapOf(project), clip.start + beat, false);
      if (step >= 1) return bb;
      const per = Math.max(1, Math.round(1 / step));
      return `${bb}.${(((Math.round(beat / step) % per) + per) % per) + 1}`;
    },
    [project, clip, step],
  );

  const updateWin = useCallback(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const q = (n: number) => Math.floor(n / 200) * 200;
    // The rail and the ruler are sticky inside the scroller, so the grid's own
    // origin sits one rail to the right and one ruler down from content zero.
    const x = sc.scrollLeft - RAIL_W;
    const y = sc.scrollTop - RULER_H;
    // A scroller that has not been laid out yet — a collapsed panel, the first
    // frame — reports zero, which would window everything away and leave a
    // blank grid until something scrolled. Assume a screenful instead.
    const vw = sc.clientWidth || 1600;
    const vh = sc.clientHeight || 900;
    const next: GridWindow = {
      left: q(Math.max(0, x - vw)),
      right: q(x + vw * 2) + 200,
      top: q(Math.max(0, y - vh)),
      bottom: q(y + vh * 2) + 200,
    };
    setWin((cur) =>
      cur.left === next.left &&
      cur.right === next.right &&
      cur.top === next.top &&
      cur.bottom === next.bottom
        ? cur
        : next,
    );
  }, []);

  useEffect(() => {
    updateWin();
  }, [updateWin, clip?.id, ppb, step, lanes.length]);

  useEffect(() => {
    return engine.onFrame(() => {
      const cur = cursorRef.current;
      if (!cur || !clip) return;
      const rel = engine.getPositionBeats() - clip.start;
      if (rel >= 0 && rel <= clip.length && engine.isPlaying()) {
        cur.style.opacity = '1';
        cur.style.transform = `translateX(${RAIL_W + rel * ppb}px)`;
      } else {
        cur.style.opacity = '0';
      }
    });
  }, [clip, ppb]);

  const clipId = clip?.id ?? null;
  const trackId = track?.id ?? null;

  const openHitMenu = useCallback(
    (note: Note, x: number, y: number) => {
      if (!clipId) return;
      const store = useProjectStore.getState();
      const ids = useUiStore.getState().selectedNoteIds.includes(note.id)
        ? useUiStore.getState().selectedNoteIds
        : [note.id];
      const inGesture = (fn: () => void) => {
        store.beginGesture();
        fn();
        store.endGesture();
      };
      useUiStore.getState().showMenu({
        x,
        y,
        items: [
          ...VELOCITY_PRESETS.map((p) => ({
            label: `${p.label} (${p.velocity})`,
            action: () =>
              inGesture(() => store.updateNotes(clipId, ids, () => ({ velocity: p.velocity }))),
          })),
          {
            label: 'Flam',
            action: () =>
              inGesture(() => {
                // A grace hit just ahead of the beat at roughly half the weight.
                store.addNotes(
                  clipId,
                  ids
                    .map((id) => notes.find((n) => n.id === id))
                    .filter((n): n is Note => n !== undefined)
                    .map((n) => ({
                      start: Math.max(0, n.start - FLAM_GAP),
                      length: n.length,
                      pitch: n.pitch,
                      velocity: clamp(Math.round(n.velocity * FLAM_VEL), 1, 127),
                    })),
                );
              }),
          },
          {
            label: `Roll ×${ROLL_DIVISIONS}`,
            action: () =>
              inGesture(() => {
                const sub = step / ROLL_DIVISIONS;
                const sources = ids
                  .map((id) => notes.find((n) => n.id === id))
                  .filter((n): n is Note => n !== undefined);
                const extra: Omit<Note, 'id'>[] = [];
                for (const n of sources) {
                  for (let i = 1; i < ROLL_DIVISIONS; i++) {
                    extra.push({
                      start: n.start + i * sub,
                      length: Math.max(0.0625, sub),
                      pitch: n.pitch,
                      // A roll swells rather than repeating one flat value.
                      velocity: clamp(
                        Math.round(n.velocity * (0.6 + (0.4 * i) / (ROLL_DIVISIONS - 1))),
                        1,
                        127,
                      ),
                    });
                  }
                }
                store.updateNotes(clipId, ids, () => ({ length: Math.max(0.0625, sub) }));
                store.addNotes(clipId, extra);
              }),
          },
          {
            label: ids.length > 1 ? `Delete ${ids.length} hits` : 'Delete hit',
            danger: true,
            action: () => store.deleteNotes(clipId, ids),
          },
        ],
      });
    },
    [clipId, notes, step],
  );

  const edit = useMemo<DrumGridEdit>(() => {
    const store = useProjectStore;
    const length = Math.max(0.0625, Math.min(step, MAX_HIT_LEN));
    return {
      begin: () => store.getState().beginGesture(),
      end: () => store.getState().endGesture(),
      add: (pitch, startBeat, velocity) => {
        if (!clipId) return null;
        const [id] = store
          .getState()
          .addNotes(clipId, [{ start: startBeat, length, pitch, velocity }]);
        return id ?? null;
      },
      remove: (ids) => {
        if (clipId) store.getState().deleteNotes(clipId, ids);
      },
      setVelocity: (ids, velocity) => {
        if (clipId) store.getState().updateNotes(clipId, ids, () => ({ velocity }));
      },
      select: (ids) => {
        // Touching a hit that is already part of a selection keeps that
        // selection, so a menu or a preset can still act on the whole group.
        const cur = useUiStore.getState().selectedNoteIds;
        if (ids.length === 1 && cur.includes(ids[0])) return;
        useUiStore.getState().set({ selectedNoteIds: ids });
      },
      contextMenu: openHitMenu,
      audition: (pitch, velocity) => {
        if (trackId) auditionNote(trackId, pitch, velocity);
      },
    };
  }, [clipId, trackId, step, openHitMenu]);

  /** A lane reads as muted when it has hits and every one of them is muted. */
  const mutedPitches = useMemo(() => {
    const out = new Set<number>();
    for (const [pitch, bucket] of notesByPitch) {
      if (bucket.length > 0 && bucket.every((n) => n.muted)) out.add(pitch);
    }
    return out;
  }, [notesByPitch]);

  /**
   * The model has no per-lane mute — only per-note — so lane mute and solo
   * write the notes' own `muted` flags. Solo remembers what was already muted
   * before it engaged, so releasing it restores that state instead of
   * un-muting hits the user silenced on purpose.
   */
  const muteLane = useCallback(
    (pitch: number) => {
      if (!clipId) return;
      const bucket = notesByPitch.get(pitch);
      if (!bucket || bucket.length === 0) return;
      const next = !bucket.every((n) => n.muted);
      const store = useProjectStore.getState();
      store.beginGesture();
      store.updateNotes(
        clipId,
        bucket.map((n) => n.id),
        () => ({ muted: next }),
      );
      store.endGesture();
    },
    [clipId, notesByPitch],
  );

  const soloLane = useCallback(
    (pitch: number) => {
      if (!clipId) return;
      const store = useProjectStore.getState();
      const ids = notes.map((n) => n.id);
      store.beginGesture();
      if (soloPitch === pitch) {
        const before = preSoloMuted.current;
        store.updateNotes(clipId, ids, (n) => ({ muted: before ? before.has(n.id) : false }));
        preSoloMuted.current = null;
        setSoloPitch(null);
      } else {
        if (preSoloMuted.current === null) {
          preSoloMuted.current = new Set(notes.filter((n) => n.muted).map((n) => n.id));
        }
        store.updateNotes(clipId, ids, (n) => ({ muted: n.pitch !== pitch }));
        setSoloPitch(pitch);
      }
      store.endGesture();
    },
    [clipId, notes, soloPitch],
  );

  const audition = useCallback(
    (pitch: number) => {
      if (trackId) auditionNote(trackId, pitch, paintVelocity);
    },
    [trackId, paintVelocity],
  );

  if (!clip) {
    return (
      <div className="de" data-testid="drum-editor">
        <div className="de-empty">
          <Icon name="note" size={28} />
          <div>Select a MIDI clip on a drum track to edit its pattern.</div>
        </div>
      </div>
    );
  }

  const midiClips = project.clips.filter((c) => c.type === 'midi');

  return (
    <div className="de" data-testid="drum-editor">
      <div className="de-toolbar">
        <select
          value={clip.id}
          onChange={(e) => useUiStore.getState().openEditorFor(e.target.value)}
          aria-label="Clip"
          style={{ maxWidth: 130 }}
        >
          {midiClips.map((c) => (
            <option key={c.id} value={c.id}>
              {project.tracks.find((t) => t.id === c.trackId)?.name}: {c.name}
            </option>
          ))}
        </select>

        <label>
          Map
          <select
            value={mapId}
            onChange={(e) => setMapChoice(e.target.value as DrumMapId)}
            aria-label="Drum map"
            data-testid="de-map"
          >
            <option value="gm">General MIDI</option>
            <option value="essential">Essential 16</option>
            <option value="pads" disabled={!padMap}>
              Track pads
            </option>
          </select>
        </label>

        <button
          className={`btn${usedOnly ? ' on' : ''}`}
          aria-pressed={usedOnly}
          title="Show only the lanes this clip plays"
          onClick={() => setUsedOnly((v) => !v)}
          data-testid="de-used-only"
        >
          Used lanes
        </button>

        <label>
          Step
          <select
            value={step}
            onChange={(e) => useUiStore.getState().set({ prSnap: Number(e.target.value) })}
            aria-label="Step resolution"
            data-testid="de-step"
          >
            {STEPS.map((s) => (
              <option key={s.label} value={s.beats}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label title="Velocity given to hits you paint">
          Hit
          <input
            type="range"
            min={1}
            max={127}
            value={paintVelocity}
            style={{ width: 64 }}
            aria-label="Velocity for new hits"
            onChange={(e) => setPaintVelocity(Number(e.target.value))}
          />
          <span className="mono">{paintVelocity}</span>
        </label>

        <span className="spacer" style={{ flex: 1 }} />
        <button
          className="btn"
          title="Loop this clip"
          onClick={() =>
            useProjectStore
              .getState()
              .setLoop({ enabled: true, start: clip.start, end: clip.start + clip.length })
          }
        >
          <Icon name="loop" size={12} />
        </button>
        <button
          className="icon-btn"
          onClick={() => setPpb((p) => Math.max(24, Math.round(p * 0.8)))}
          title="Zoom out"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          className="icon-btn"
          onClick={() => setPpb((p) => Math.min(200, Math.round(p * 1.25)))}
          title="Zoom in"
          aria-label="Zoom in"
        >
          +
        </button>
      </div>

      <div
        className="de-scroll"
        ref={scrollRef}
        onScroll={() => {
          if (winFrame.current) return;
          winFrame.current = requestAnimationFrame(() => {
            winFrame.current = 0;
            updateWin();
          });
        }}
      >
        <div className="de-inner" style={{ width: RAIL_W + gridW, height: RULER_H + gridH }}>
          <div className="de-ruler-row" style={{ height: RULER_H }}>
            <div className="de-corner" style={{ width: RAIL_W }}>
              {map.name}
            </div>
            <DrumRuler bars={bars} ppb={ppb} width={gridW} win={win} />
          </div>
          <div className="de-body">
            <DrumRail
              lanes={lanes}
              mutedPitches={mutedPitches}
              soloPitch={soloPitch}
              onMute={muteLane}
              onSolo={soloLane}
              onAudition={audition}
            />
            <DrumGrid
              lanes={lanes}
              notesByPitch={notesByPitch}
              selected={selected}
              step={step}
              ppb={ppb}
              beats={beats}
              barBeats={barBeats}
              paintVelocity={paintVelocity}
              win={win}
              edit={edit}
              positionLabel={positionLabel}
            />
          </div>
          <div
            ref={cursorRef}
            className="de-cursor"
            style={{ height: RULER_H + gridH, opacity: 0 }}
          />
        </div>
      </div>
    </div>
  );
}
