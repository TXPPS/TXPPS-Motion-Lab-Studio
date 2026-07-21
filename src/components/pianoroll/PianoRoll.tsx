import { useCallback, useEffect, useMemo, useRef } from 'react';
import { engine } from '../../audio/engine';
import { longPress, usePointerDrag } from '../../hooks/usePointerDrag';
import { midiToName, snapBeat, snapBeatFloor } from '../../model/music';
import { DRUM_PITCHES } from '../../model/presets';
import type { MidiClip, Note } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';

const PITCH_MAX = 108; // C8
const PITCH_MIN = 21; // A0
const KEYS_W = 52;

function isBlack(pitch: number): boolean {
  return [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);
}

function NoteView({
  note,
  clip,
  ppb,
  rowH,
  trackId,
}: {
  note: Note;
  clip: MidiClip;
  ppb: number;
  rowH: number;
  trackId: string;
}) {
  const selected = useUiStore((s) => s.selectedNoteIds.includes(note.id));
  const snap = useUiStore((s) => s.prSnap);
  const store = useProjectStore;
  const ui = useUiStore;

  const select = (additive: boolean) => {
    const cur = ui.getState().selectedNoteIds;
    if (additive) {
      ui.getState().set({
        selectedNoteIds: cur.includes(note.id)
          ? cur.filter((i) => i !== note.id)
          : [...cur, note.id],
      });
    } else if (!cur.includes(note.id)) {
      ui.getState().set({ selectedNoteIds: [note.id] });
    }
  };

  const dragMove = usePointerDrag<{ ids: string[]; orig: Map<string, Note> }>({
    onStart: (e) => {
      select(e.shiftKey);
      store.getState().beginGesture();
      const ids = ui.getState().selectedNoteIds.includes(note.id)
        ? ui.getState().selectedNoteIds
        : [note.id];
      const orig = new Map<string, Note>();
      for (const n of clip.notes) if (ids.includes(n.id)) orig.set(n.id, { ...n });
      return { ids, orig };
    },
    onMove: (dx, dy, _e, d) => {
      const dBeats = dx / ppb;
      const dPitch = -Math.round(dy / rowH);
      store.getState().updateNotes(clip.id, d.ids, (n) => {
        const o = d.orig.get(n.id);
        if (!o) return {};
        return {
          start: Math.max(0, snapBeat(o.start + dBeats, snap)),
          pitch: o.pitch + dPitch,
        };
      });
    },
    onEnd: (moved) => {
      store.getState().endGesture();
      if (moved) {
        const n = useProjectStore
          .getState()
          .project.clips.find((c) => c.id === clip.id && c.type === 'midi');
        const cur = n?.type === 'midi' ? n.notes.find((x) => x.id === note.id) : undefined;
        if (cur) previewNote(trackId, cur.pitch);
      }
    },
  });

  const dragResize = usePointerDrag<{ orig: Map<string, Note>; ids: string[] }>({
    onStart: () => {
      store.getState().beginGesture();
      const ids = ui.getState().selectedNoteIds.includes(note.id)
        ? ui.getState().selectedNoteIds
        : [note.id];
      const orig = new Map<string, Note>();
      for (const n of clip.notes) if (ids.includes(n.id)) orig.set(n.id, { ...n });
      return { ids, orig };
    },
    onMove: (dx, _dy, _e, d) => {
      const dBeats = dx / ppb;
      store.getState().updateNotes(clip.id, d.ids, (n) => {
        const o = d.orig.get(n.id);
        return o ? { length: Math.max(snap || 0.0625, snapBeat(o.length + dBeats, snap)) } : {};
      });
    },
    onEnd: () => store.getState().endGesture(),
  });

  return (
    <div
      className={`pr-note${selected ? ' selected' : ''}`}
      style={{
        left: note.start * ppb,
        width: Math.max(5, note.length * ppb),
        top: (PITCH_MAX - note.pitch) * rowH + 1,
        height: rowH - 2,
        opacity: 0.45 + (note.velocity / 127) * 0.55,
      }}
      data-testid="pr-note"
      onPointerDown={(e) => {
        longPress((x, y) =>
          useUiStore.getState().showMenu({
            x,
            y,
            items: [
              {
                label: 'Delete note',
                danger: true,
                action: () => store.getState().deleteNotes(clip.id, [note.id]),
              },
            ],
          }),
        )(e);
        dragMove(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        store.getState().deleteNotes(clip.id, [note.id]);
      }}
      title={`${midiToName(note.pitch)} · vel ${note.velocity}`}
    >
      <div className="pr-note-edge" onPointerDown={dragResize} />
    </div>
  );
}

function previewNote(trackId: string, pitch: number): void {
  engine.liveNoteOn(trackId, pitch, 96);
  setTimeout(() => engine.liveNoteOff(trackId, pitch), 180);
}

export function PianoRoll() {
  const project = useProjectStore((s) => s.project);
  const editClipId = useUiStore((s) => s.editClipId);
  const selectedClipId = useUiStore((s) => s.selectedClipId);
  const ppb = useUiStore((s) => s.prPxPerBeat);
  const snap = useUiStore((s) => s.prSnap);
  const selectedNoteIds = useUiStore((s) => s.selectedNoteIds);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLCanvasElement>(null);
  const didInitScroll = useRef(false);

  const clip = useMemo((): MidiClip | null => {
    const byId = (id: string | null) => {
      const c = id ? project.clips.find((x) => x.id === id) : undefined;
      return c?.type === 'midi' ? c : null;
    };
    return byId(editClipId) ?? byId(selectedClipId) ?? null;
  }, [project.clips, editClipId, selectedClipId]);

  const track = clip ? project.tracks.find((t) => t.id === clip.trackId) : null;
  const isDrum = track?.type === 'drum';
  const rowH = 16;
  const rows = PITCH_MAX - PITCH_MIN + 1;
  const gridH = rows * rowH;
  const contentBeats = clip ? Math.max(clip.length + 4, 16) : 16;
  const gridW = contentBeats * ppb;

  // center scroll on content once per clip
  useEffect(() => {
    didInitScroll.current = false;
  }, [clip?.id]);
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || didInitScroll.current || !clip) return;
    didInitScroll.current = true;
    const pitches = clip.notes.map((n) => n.pitch);
    const center = pitches.length
      ? (Math.min(...pitches) + Math.max(...pitches)) / 2
      : isDrum
        ? 41
        : 60;
    sc.scrollTop = Math.max(0, (PITCH_MAX - center) * rowH - sc.clientHeight / 2);
    sc.scrollLeft = 0;
  }, [clip, isDrum]);

  // grid canvas
  useEffect(() => {
    const canvas = gridRef.current;
    if (!canvas || !clip) return;
    canvas.width = gridW;
    canvas.height = gridH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, gridW, gridH);
    // row shading
    for (let p = PITCH_MAX; p >= PITCH_MIN; p--) {
      const y = (PITCH_MAX - p) * rowH;
      if (isBlack(p)) {
        ctx.fillStyle = 'rgba(255,255,255,0.028)';
        ctx.fillRect(0, y, gridW, rowH);
      }
      if (p % 12 === 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.09)';
        ctx.beginPath();
        ctx.moveTo(0, y + rowH + 0.5);
        ctx.lineTo(gridW, y + rowH + 0.5);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    for (let r = 0; r <= rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * rowH + 0.5);
      ctx.lineTo(gridW, r * rowH + 0.5);
      ctx.stroke();
    }
    // beat/snap verticals
    const step = snap > 0 ? snap : 0.25;
    for (let b = 0; b <= contentBeats + 1e-6; b += step) {
      const x = Math.round(b * ppb) + 0.5;
      const isBar = Math.abs(b % 4) < 1e-9;
      const isBeat = Math.abs(b % 1) < 1e-9;
      ctx.strokeStyle = isBar
        ? 'rgba(255,255,255,0.14)'
        : isBeat
          ? 'rgba(255,255,255,0.07)'
          : 'rgba(255,255,255,0.03)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, gridH);
      ctx.stroke();
    }
    // dim area beyond clip end
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(clip.length * ppb, 0, gridW - clip.length * ppb, gridH);
  }, [clip, gridW, gridH, ppb, snap, rows, contentBeats, rowH]);

  // playback cursor within clip
  useEffect(() => {
    return engine.onFrame(() => {
      const cur = cursorRef.current;
      if (!cur || !clip) return;
      const pos = engine.getPositionBeats();
      const rel = pos - clip.start;
      if (rel >= 0 && rel <= clip.length && engine.isPlaying()) {
        cur.style.opacity = '1';
        cur.style.transform = `translateX(${KEYS_W + rel * ppb}px)`;
      } else {
        cur.style.opacity = '0';
      }
    });
  }, [clip, ppb]);

  const addNoteAt = useCallback(
    (e: React.MouseEvent) => {
      if (!clip) return;
      const target = e.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const start = snapBeatFloor(x / ppb, snap || 0.25);
      const pitch = PITCH_MAX - Math.floor(y / rowH);
      if (start >= clip.length || pitch < PITCH_MIN || pitch > PITCH_MAX) return;
      const id = useProjectStore.getState().addNote(clip.id, {
        start,
        length: Math.max(snap || 0.25, 0.25),
        pitch,
        velocity: 100,
      });
      useUiStore.getState().set({ selectedNoteIds: [id] });
      if (track) previewNote(track.id, pitch);
    },
    [clip, ppb, snap, track],
  );

  if (!clip) {
    return (
      <div className="pr" data-testid="piano-roll">
        <div className="pr-empty">
          <Icon name="note" size={28} />
          <div>Select a MIDI clip to edit, or create one.</div>
          <button
            className="btn primary"
            onClick={() => {
              const p = useProjectStore.getState().project;
              const t =
                p.tracks.find(
                  (x) =>
                    x.id === useUiStore.getState().selectedTrackId &&
                    (x.type === 'instrument' || x.type === 'drum'),
                ) ?? p.tracks.find((x) => x.type === 'instrument' || x.type === 'drum');
              if (!t) return;
              const id = useProjectStore.getState().addMidiClip(t.id, 0, 4);
              useUiStore.getState().openEditorFor(id);
            }}
          >
            Create MIDI clip
          </button>
        </div>
      </div>
    );
  }

  const midiClips = project.clips.filter((c) => c.type === 'midi');
  const selVel =
    selectedNoteIds.length > 0
      ? Math.round(
          clip.notes
            .filter((n) => selectedNoteIds.includes(n.id))
            .reduce((a, n) => a + n.velocity, 0) / Math.max(1, selectedNoteIds.length),
        )
      : 100;

  return (
    <div className="pr" data-testid="piano-roll">
      <div className="pr-toolbar">
        <select
          value={clip.id}
          onChange={(e) => useUiStore.getState().openEditorFor(e.target.value)}
          aria-label="Clip"
          style={{ maxWidth: 150 }}
        >
          {midiClips.map((c) => (
            <option key={c.id} value={c.id}>
              {project.tracks.find((t) => t.id === c.trackId)?.name}: {c.name}
            </option>
          ))}
        </select>
        <label>
          Snap
          <select
            value={snap}
            onChange={(e) => useUiStore.getState().set({ prSnap: Number(e.target.value) })}
            aria-label="Piano roll snap"
          >
            <option value={1}>1/4</option>
            <option value={0.5}>1/8</option>
            <option value={0.25}>1/16</option>
            <option value={0.125}>1/32</option>
            <option value={0}>Off</option>
          </select>
        </label>
        <label>
          Vel
          <input
            type="range"
            min={1}
            max={127}
            value={selVel}
            style={{ width: 70 }}
            aria-label="Velocity of selected notes"
            disabled={selectedNoteIds.length === 0}
            onChange={(e) =>
              useProjectStore
                .getState()
                .updateNotes(clip.id, selectedNoteIds, () => ({ velocity: Number(e.target.value) }))
            }
          />
          <span className="mono">{selectedNoteIds.length ? selVel : '—'}</span>
        </label>
        <button
          className="btn"
          title="Loop this clip"
          onClick={() =>
            useProjectStore
              .getState()
              .setLoop({ enabled: true, start: clip.start, end: clip.start + clip.length })
          }
        >
          <Icon name="loop" size={12} /> Loop clip
        </button>
        <button
          className="btn"
          disabled={selectedNoteIds.length === 0}
          onClick={() => {
            useProjectStore.getState().deleteNotes(clip.id, selectedNoteIds);
            useUiStore.getState().set({ selectedNoteIds: [] });
          }}
        >
          <Icon name="trash" size={12} /> Delete
        </button>
        <span className="spacer" style={{ flex: 1 }} />
        <button
          className="icon-btn"
          onClick={() =>
            useUiStore.getState().set({ prPxPerBeat: Math.max(12, Math.round(ppb * 0.8)) })
          }
          title="Zoom out"
        >
          −
        </button>
        <button
          className="icon-btn"
          onClick={() =>
            useUiStore.getState().set({ prPxPerBeat: Math.min(96, Math.round(ppb * 1.25)) })
          }
          title="Zoom in"
        >
          +
        </button>
      </div>
      <div className="pr-scroll" ref={scrollRef}>
        <div className="pr-inner" style={{ width: KEYS_W + gridW, height: gridH, display: 'flex' }}>
          <div className="pr-keys" style={{ height: gridH }}>
            {Array.from({ length: rows }, (_, i) => {
              const pitch = PITCH_MAX - i;
              const drumName = isDrum
                ? DRUM_PITCHES.find((d) => d.pitch === pitch)?.name
                : undefined;
              return (
                <div
                  key={pitch}
                  className={`pr-key${isBlack(pitch) ? ' black' : ''}${pitch % 12 === 0 ? ' c-note' : ''}`}
                  style={{ height: rowH }}
                  onPointerDown={() => track && previewNote(track.id, pitch)}
                >
                  {drumName ?? (pitch % 12 === 0 ? midiToName(pitch) : '')}
                </div>
              );
            })}
          </div>
          <div
            className="pr-grid-area"
            style={{ width: gridW, height: gridH, position: 'relative' }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('.pr-note')) return;
              addNoteAt(e);
            }}
            data-testid="pr-grid"
          >
            <canvas ref={gridRef} className="pr-grid-canvas" />
            {clip.notes.map((n) => (
              <NoteView
                key={n.id}
                note={n}
                clip={clip}
                ppb={ppb}
                rowH={rowH}
                trackId={clip.trackId}
              />
            ))}
          </div>
        </div>
        <div ref={cursorRef} className="pr-cursor" style={{ height: gridH, opacity: 0 }} />
      </div>
    </div>
  );
}
