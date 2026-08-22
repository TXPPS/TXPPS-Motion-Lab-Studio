import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import { longPress, usePointerDrag } from '../../hooks/usePointerDrag';
import { clamp, formatPosition, midiToName, snapBeat, snapBeatFloor } from '../../model/music';
import { DRUM_PITCHES } from '../../model/presets';
import {
  buildChord,
  CHORD_QUALITIES,
  drop2,
  invertChord,
  octaveDouble,
  spreadChord,
} from '../../model/chords';
import {
  deleteOverlaps,
  humanizeNotes,
  legatoNotes,
  mirrorNotes,
  QUANT_GRIDS,
  quantizeNotes,
  repeatNotes,
  reverseNotes,
  stretchNotes,
  thinNotes,
  transposeNotes,
} from '../../model/midiTools';
import { inScale, KEY_NAMES, SCALES, snapToScale, suggestScales } from '../../model/scales';
import type { MidiClip, Note } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';

const PITCH_MAX = 108; // C8 (top row)
const PITCH_MIN = 21; // A0
const KEYS_W = 52;
const ROW_H = 16;
const VEL_H = 56;

/**
 * Visually hidden, still spoken. The piano-roll stylesheet is owned elsewhere
 * this week, so the rule the live region needs travels with the element.
 */
const SR_ONLY: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
};

function isBlack(pitch: number): boolean {
  return [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);
}

function previewNote(trackId: string, pitch: number, velocity = 96): void {
  engine.liveNoteOn(trackId, pitch, velocity);
  setTimeout(() => engine.liveNoteOff(trackId, pitch), 180);
}

interface NoteViewProps {
  note: Note;
  clip: MidiClip;
  ppb: number;
  trackId: string;
  /** Renders a beat inside the clip as bar.beat.step, for labels and speech. */
  positionLabel: (beat: number) => string;
}

function NoteView({ note, clip, ppb, trackId, positionLabel }: NoteViewProps) {
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

  const dragMove = usePointerDrag<{ ids: string[]; orig: Map<string, Note>; lastPitch: number }>({
    onStart: (e) => {
      // Alt+click toggles mute without starting a drag gesture.
      if (e.altKey) {
        store.getState().updateNotes(clip.id, [note.id], (n) => ({ muted: !n.muted }));
        return { ids: [], orig: new Map(), lastPitch: note.pitch };
      }
      select(e.shiftKey);
      store.getState().beginGesture();
      const ids = ui.getState().selectedNoteIds.includes(note.id)
        ? ui.getState().selectedNoteIds
        : [note.id];
      const orig = new Map<string, Note>();
      for (const n of clip.notes) if (ids.includes(n.id)) orig.set(n.id, { ...n });
      return { ids, orig, lastPitch: note.pitch };
    },
    onMove: (dx, dy, e, d) => {
      if (d.ids.length === 0) return;
      const dBeats = dx / ppb;
      const dPitch = -Math.round(dy / ROW_H);
      store.getState().updateNotes(clip.id, d.ids, (n) => {
        const o = d.orig.get(n.id);
        if (!o) return {};
        return {
          // Shift bypasses time snapping for fine placement, as in the arrangement.
          start: Math.max(0, e.shiftKey ? o.start + dBeats : snapBeat(o.start + dBeats, snap)),
          pitch: clamp(o.pitch + dPitch, PITCH_MIN, PITCH_MAX),
        };
      });
      // Audible feedback while crossing rows: preview each new pitch once.
      const newPitch = clamp((d.orig.get(note.id)?.pitch ?? note.pitch) + dPitch, 0, 127);
      if (newPitch !== d.lastPitch) {
        d.lastPitch = newPitch;
        previewNote(trackId, newPitch, 70);
      }
    },
    onEnd: (moved, d) => {
      if (d.ids.length === 0) return;
      const uiState = ui.getState();
      // Scale lock resolves at the end of the gesture, so dragging feels free
      // but the landing pitch is always legal.
      if (moved && uiState.prScaleLock && uiState.prScale !== 'chromatic') {
        store.getState().updateNotes(clip.id, d.ids, (n) => ({
          pitch: snapToScale(n.pitch, uiState.prKey, uiState.prScale),
        }));
      }
      store.getState().endGesture();
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
    onMove: (dx, _dy, e, d) => {
      const dBeats = dx / ppb;
      store.getState().updateNotes(clip.id, d.ids, (n) => {
        const o = d.orig.get(n.id);
        if (!o) return {};
        const raw = o.length + dBeats;
        return {
          length: Math.max(snap || 0.0625, e.shiftKey ? raw : snapBeat(raw, snap)),
        };
      });
    },
    onEnd: () => store.getState().endGesture(),
  });

  const gesture = (edit: () => void) => {
    store.getState().beginGesture();
    edit();
    store.getState().endGesture();
  };

  /**
   * Keyboard editing.
   *
   * A key on a note acts on the selection when the note is in it, exactly as a
   * drag on a selected note moves the whole group, and every branch ends in the
   * store action its drag already calls.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const uiState = ui.getState();
    const ids = uiState.selectedNoteIds.includes(note.id) ? uiState.selectedNoteIds : [note.id];
    const step = snap || 0.25;
    switch (e.key) {
      case 'Enter':
      case ' ':
        if (e.shiftKey || e.ctrlKey || e.metaKey) select(true);
        else ui.getState().set({ selectedNoteIds: [note.id] });
        break;
      case 'Delete':
      case 'Backspace':
        store.getState().deleteNotes(clip.id, ids);
        ui.getState().set({
          selectedNoteIds: uiState.selectedNoteIds.filter((i) => !ids.includes(i)),
        });
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        if (e.altKey) {
          // Alt turns the arrows into the resize edge, which is otherwise a
          // 4px drag handle and nothing else.
          gesture(() =>
            store.getState().updateNotes(clip.id, ids, (n) => ({
              length: Math.max(step, n.length + dir * step),
            })),
          );
          break;
        }
        const d = dir * (e.shiftKey ? step / 4 : step);
        gesture(() =>
          store.getState().updateNotes(clip.id, ids, (n) => ({ start: Math.max(0, n.start + d) })),
        );
        break;
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        const semis = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
        const locked = uiState.prScaleLock && uiState.prScale !== 'chromatic';
        gesture(() =>
          store.getState().updateNotes(clip.id, ids, (n) => {
            const raw = clamp(n.pitch + semis, PITCH_MIN, PITCH_MAX);
            return { pitch: locked ? snapToScale(raw, uiState.prKey, uiState.prScale) : raw };
          }),
        );
        previewNote(trackId, clamp(note.pitch + semis, PITCH_MIN, PITCH_MAX), 70);
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    // The window handler nudges this same selection; one press is one edit.
    e.stopPropagation();
  };

  return (
    <div
      className={`pr-note${selected ? ' selected' : ''}${note.muted ? ' muted' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${midiToName(note.pitch)}, ${positionLabel(note.start)}, velocity ${
        note.velocity
      }${note.muted ? ', muted' : ''}`}
      onKeyDown={onKeyDown}
      style={{
        left: note.start * ppb,
        width: Math.max(5, note.length * ppb),
        top: (PITCH_MAX - note.pitch) * ROW_H + 1,
        height: ROW_H - 2,
        opacity: note.muted ? 0.3 : 0.45 + (note.velocity / 127) * 0.55,
      }}
      data-testid="pr-note"
      onPointerDown={(e) => {
        longPress((x, y) =>
          useUiStore.getState().showMenu({
            x,
            y,
            items: [
              {
                label: note.muted ? 'Unmute note' : 'Mute note',
                action: () =>
                  store.getState().updateNotes(clip.id, [note.id], (n) => ({ muted: !n.muted })),
              },
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
      title={`${midiToName(note.pitch)} · vel ${note.velocity}${note.muted ? ' · muted' : ''}`}
    >
      {note.length * ppb > 34 && <span className="pr-note-label">{midiToName(note.pitch)}</span>}
      {/* The edge is a drag handle; its keyboard route is Alt+←/→ on the note. */}
      <div className="pr-note-edge" onPointerDown={dragResize} aria-hidden="true" />
    </div>
  );
}

/** One velocity bar. Vertical drag writes velocity to the note (or selection). */
function VelBar({
  note,
  clip,
  ppb,
  positionLabel,
}: {
  note: Note;
  clip: MidiClip;
  ppb: number;
  positionLabel: (beat: number) => string;
}) {
  const selected = useUiStore((s) => s.selectedNoteIds.includes(note.id));
  const store = useProjectStore;

  const drag = usePointerDrag<{ ids: string[]; startVel: number }>({
    onStart: () => {
      store.getState().beginGesture();
      const sel = useUiStore.getState().selectedNoteIds;
      return { ids: sel.includes(note.id) ? sel : [note.id], startVel: note.velocity };
    },
    onMove: (_dx, dy, _e, d) => {
      const vel = clamp(Math.round(d.startVel - (dy / (VEL_H - 6)) * 127), 1, 127);
      store.getState().updateNotes(clip.id, d.ids, () => ({ velocity: vel }));
    },
    onEnd: () => store.getState().endGesture(),
  });

  /** The drag's target rule, so a typed velocity lands on the same notes. */
  const setVelocity = (velocity: number) => {
    const sel = useUiStore.getState().selectedNoteIds;
    const ids = sel.includes(note.id) ? sel : [note.id];
    store.getState().beginGesture();
    store.getState().updateNotes(clip.id, ids, () => ({ velocity: clamp(velocity, 1, 127) }));
    store.getState().endGesture();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        setVelocity(note.velocity + step);
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        setVelocity(note.velocity - step);
        break;
      case 'Home':
        setVelocity(1);
        break;
      case 'End':
        setVelocity(127);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className={`pr-vel-bar${selected ? ' selected' : ''}${note.muted ? ' muted' : ''}`}
      style={{
        left: note.start * ppb,
        width: Math.max(3, Math.min(9, note.length * ppb - 1)),
        height: Math.max(2, (note.velocity / 127) * (VEL_H - 6)),
      }}
      role="slider"
      tabIndex={0}
      aria-label={`${midiToName(note.pitch)} velocity at ${positionLabel(note.start)}`}
      aria-valuemin={1}
      aria-valuemax={127}
      aria-valuenow={note.velocity}
      aria-valuetext={`velocity ${note.velocity}`}
      onKeyDown={onKeyDown}
      onPointerDown={drag}
      title={`vel ${note.velocity}`}
      data-testid="pr-vel-bar"
    />
  );
}

export function PianoRoll() {
  const project = useProjectStore((s) => s.project);
  const editClipId = useUiStore((s) => s.editClipId);
  const selectedClipId = useUiStore((s) => s.selectedClipId);
  const ppb = useUiStore((s) => s.prPxPerBeat);
  const snap = useUiStore((s) => s.prSnap);
  const selectedNoteIds = useUiStore((s) => s.selectedNoteIds);
  const prKey = useUiStore((s) => s.prKey);
  const prScale = useUiStore((s) => s.prScale);
  const prScaleLock = useUiStore((s) => s.prScaleLock);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const didInitScroll = useRef(false);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  /** Visible px window for windowed note rendering (both axes, 200px quanta). */
  const [win, setWin] = useState({ left: 0, right: 3000, top: 0, bottom: 2000 });
  const winFrame = useRef(0);
  /** Where the keyboard is pointing on the grid: one pitch, one beat. */
  const [gridCursor, setGridCursor] = useState({ pitch: 60, beat: 0 });
  /**
   * The cursor's live position. Key repeat delivers several keydowns inside one
   * React batch, where the rendered `gridCursor` is still the value from before
   * the batch — reading state there would collapse three presses into one.
   */
  const gridCursorRef = useRef(gridCursor);
  const gridRef = useRef<HTMLDivElement>(null);
  const cellCursorRef = useRef<HTMLDivElement>(null);
  /** The grid cursor is drawn only while the grid is being driven by keys. */
  const [gridFocused, setGridFocused] = useState(false);
  /** The key column's single tab stop, so the roll is not 88 stops deep. */
  const [keyCursor, setKeyCursor] = useState(60);
  const keysRef = useRef<HTMLDivElement>(null);
  const liveId = useId();

  const clip = useMemo((): MidiClip | null => {
    const byId = (id: string | null) => {
      const c = id ? project.clips.find((x) => x.id === id) : undefined;
      return c?.type === 'midi' ? c : null;
    };
    return byId(editClipId) ?? byId(selectedClipId) ?? null;
  }, [project.clips, editClipId, selectedClipId]);

  /** A beat inside the clip as bar.beat.step, for labels and speech. */
  const positionLabel = useCallback(
    (beat: number) => formatPosition((clip?.start ?? 0) + beat, project.timeSig),
    [clip?.start, project.timeSig],
  );

  const track = clip ? project.tracks.find((t) => t.id === clip.trackId) : null;
  const isDrum = track?.type === 'drum';
  const rows = PITCH_MAX - PITCH_MIN + 1;
  const gridH = rows * ROW_H;
  const contentBeats = clip ? Math.max(clip.length + 4, 16) : 16;
  const gridW = contentBeats * ppb;

  const updateWin = useCallback(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const q = (n: number) => Math.floor(n / 200) * 200;
    const next = {
      left: q(Math.max(0, sc.scrollLeft - sc.clientWidth)),
      right: q(sc.scrollLeft + sc.clientWidth * 2) + 200,
      top: q(Math.max(0, sc.scrollTop - sc.clientHeight)),
      bottom: q(sc.scrollTop + sc.clientHeight * 2) + 200,
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
  }, [updateWin, clip?.id, ppb]);

  // centre scroll on content once per clip
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
    sc.scrollTop = Math.max(0, (PITCH_MAX - center) * ROW_H - sc.clientHeight / 2);
    sc.scrollLeft = 0;
    updateWin();
  }, [clip, isDrum, updateWin]);

  // Keep the keyboard cursor on screen, but only while the grid is the thing
  // being driven — an unfocused grid must never yank the view.
  useEffect(() => {
    const el = cellCursorRef.current;
    if (!el || document.activeElement !== gridRef.current) return;
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [gridCursor, gridFocused]);

  // The key column moves its focus rather than its tab stop alone: a roving
  // tabindex that nothing follows leaves the arrow keys silent.
  useEffect(() => {
    const col = keysRef.current;
    if (!col || !col.contains(document.activeElement)) return;
    const target = col.querySelector<HTMLElement>(`[data-pitch="${keyCursor}"]`);
    if (!target || target === document.activeElement) return;
    target.focus();
    target.scrollIntoView?.({ block: 'nearest' });
  }, [keyCursor]);

  /**
   * Grid as layered CSS gradients (rows, black-key shading, C lines, beat and
   * bar verticals, out-of-scale shading). The previous full-content canvas was
   * a gridW × gridH bitmap redrawn on zoom — the same cost the arrangement
   * eliminated in Milestone 3 — and gradients compose on the GPU at any size.
   */
  const gridStyle = useMemo(() => {
    const cycle = 12 * ROW_H;
    // Rows are pitches descending from C8, so row i is black when the pitch
    // class of (PITCH_MAX - i) is a black key.
    const blackRows: string[] = [];
    const scaleRows: string[] = [];
    for (let i = 0; i < 12; i++) {
      const pitch = PITCH_MAX - i;
      if (isBlack(pitch)) {
        blackRows.push(
          `rgba(255,255,255,0.028) ${i * ROW_H}px ${(i + 1) * ROW_H}px`,
          `transparent ${(i + 1) * ROW_H}px`,
        );
      }
      if (prScale !== 'chromatic' && !inScale(pitch, prKey, prScale)) {
        scaleRows.push(
          `rgba(0,0,0,0.32) ${i * ROW_H}px ${(i + 1) * ROW_H}px`,
          `transparent ${(i + 1) * ROW_H}px`,
        );
      }
    }
    const layers = [
      // bar lines (4 beats)
      `repeating-linear-gradient(90deg, rgba(255,255,255,0.14) 0 1px, transparent 1px ${4 * ppb}px)`,
      // beat lines
      `repeating-linear-gradient(90deg, rgba(255,255,255,0.07) 0 1px, transparent 1px ${ppb}px)`,
      // row lines
      `repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0 1px, transparent 1px ${ROW_H}px)`,
      // C separators every octave
      `repeating-linear-gradient(180deg, transparent 0 ${ROW_H - 1}px, rgba(255,255,255,0.09) ${ROW_H - 1}px ${ROW_H}px, transparent ${ROW_H}px ${cycle}px)`,
    ];
    if (snap > 0 && snap < 1 && snap * ppb >= 5) {
      layers.splice(
        2,
        0,
        `repeating-linear-gradient(90deg, rgba(255,255,255,0.03) 0 1px, transparent 1px ${snap * ppb}px)`,
      );
    }
    if (blackRows.length) {
      layers.push(
        `repeating-linear-gradient(180deg, ${blackRows.join(', ')}, transparent ${cycle}px)`,
      );
    }
    if (scaleRows.length) {
      layers.push(
        `repeating-linear-gradient(180deg, ${scaleRows.join(', ')}, transparent ${cycle}px)`,
      );
    }
    return { backgroundImage: layers.join(', ') } as const;
  }, [ppb, snap, prKey, prScale]);

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

  /** Marquee note selection on empty grid (mouse). */
  const marqueeMoved = useRef(false);
  const dragMarquee = usePointerDrag<{ x: number; y: number; base: string[] }>({
    onStart: (e) => {
      marqueeMoved.current = false;
      const grid = scrollRef.current?.querySelector('.pr-grid-area');
      const rect = grid?.getBoundingClientRect();
      const base = e.shiftKey ? [...useUiStore.getState().selectedNoteIds] : [];
      if (!e.shiftKey) useUiStore.getState().set({ selectedNoteIds: [] });
      return { x: rect ? e.clientX - rect.left : 0, y: rect ? e.clientY - rect.top : 0, base };
    },
    onMove: (_dx, _dy, e, d) => {
      const grid = scrollRef.current?.querySelector('.pr-grid-area');
      const rect = grid?.getBoundingClientRect();
      if (!rect || !clip) return;
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const x0 = Math.min(d.x, cx);
      const x1 = Math.max(d.x, cx);
      const y0 = Math.min(d.y, cy);
      const y1 = Math.max(d.y, cy);
      setMarquee({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      const b0 = x0 / ppb;
      const b1 = x1 / ppb;
      const pHi = PITCH_MAX - Math.floor(y0 / ROW_H);
      const pLo = PITCH_MAX - Math.floor(y1 / ROW_H);
      const hits = clip.notes
        .filter((n) => n.start < b1 && n.start + n.length > b0 && n.pitch >= pLo && n.pitch <= pHi)
        .map((n) => n.id);
      useUiStore.getState().set({ selectedNoteIds: [...new Set([...d.base, ...hits])] });
    },
    onEnd: (moved) => {
      // The release of a swept marquee still fires a click on the grid; that
      // click must not fall through to add-note, or every marquee ends with a
      // stray note under the pointer and the selection collapsed to it.
      marqueeMoved.current = moved;
      setMarquee(null);
    },
  });

  const addNoteAt = useCallback(
    (e: React.MouseEvent) => {
      if (!clip) return;
      const target = e.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const start = snapBeatFloor(x / ppb, snap || 0.25);
      let pitch = PITCH_MAX - Math.floor(y / ROW_H);
      if (start >= clip.length || pitch < PITCH_MIN || pitch > PITCH_MAX) return;
      if (prScaleLock && prScale !== 'chromatic') pitch = snapToScale(pitch, prKey, prScale);
      const id = useProjectStore.getState().addNote(clip.id, {
        start,
        length: Math.max(snap || 0.25, 0.25),
        pitch,
        velocity: 100,
      });
      useUiStore.getState().set({ selectedNoteIds: [id] });
      if (track) previewNote(track.id, pitch);
    },
    [clip, ppb, snap, track, prScaleLock, prScale, prKey],
  );

  /** Selection, or every note when nothing is selected — what tools act on. */
  const targetNotes = useCallback((): Note[] => {
    if (!clip) return [];
    return selectedNoteIds.length
      ? clip.notes.filter((n) => selectedNoteIds.includes(n.id))
      : [...clip.notes];
  }, [clip, selectedNoteIds]);

  const applyTransform = useCallback(
    (fn: (notes: Note[]) => Note[], label: string) => {
      if (!clip) return;
      const src = targetNotes();
      if (src.length === 0) return;
      useProjectStore.getState().transformNotes(clip.id, fn(src));
      useUiStore
        .getState()
        .toast('info', `${label}: ${src.length} note${src.length === 1 ? '' : 's'}`);
    },
    [clip, targetNotes],
  );

  // Quantize panel state (local: it is a tool setting, not project data)
  const [qGrid, setQGrid] = useState(0.25);
  const [qStrength, setQStrength] = useState(1);
  const [qSwing, setQSwing] = useState(0);

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

  /** The note under the cursor, if the cursor is standing on one. */
  const noteAtCursor = (pitch: number, beat: number): Note | undefined =>
    clip.notes.find(
      (n) => n.pitch === pitch && n.start <= beat + 1e-6 && n.start + n.length > beat + 1e-6,
    );

  const moveGridCursor = (dPitch: number, dBeat: number) => {
    const at = gridCursorRef.current;
    const step = snap || 0.25;
    const next = {
      pitch: clamp(at.pitch + dPitch, PITCH_MIN, PITCH_MAX),
      // Snapped rather than accumulated: a hundred presses must not drift the
      // cursor off the grid it is drawing on.
      beat: clamp(snapBeat(at.beat + dBeat, step), 0, Math.max(0, clip.length - step)),
    };
    gridCursorRef.current = next;
    setGridCursor(next);
  };

  /** Enter on the grid: the click that adds a note, and its undo. */
  const toggleAtCursor = () => {
    const at = gridCursorRef.current;
    const hit = noteAtCursor(at.pitch, at.beat);
    if (hit) {
      useProjectStore.getState().deleteNotes(clip.id, [hit.id]);
      useUiStore.getState().set({
        selectedNoteIds: useUiStore.getState().selectedNoteIds.filter((i) => i !== hit.id),
      });
      return;
    }
    const pitch =
      prScaleLock && prScale !== 'chromatic' ? snapToScale(at.pitch, prKey, prScale) : at.pitch;
    const id = useProjectStore.getState().addNote(clip.id, {
      start: at.beat,
      length: Math.max(snap || 0.25, 0.25),
      pitch,
      velocity: 100,
    });
    useUiStore.getState().set({ selectedNoteIds: [id] });
    if (pitch !== at.pitch) {
      const next = { ...at, pitch };
      gridCursorRef.current = next;
      setGridCursor(next);
    }
    if (track) previewNote(track.id, pitch);
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    // Notes own their own keys and stop them; anything arriving here is the
    // grid's own cursor.
    if (e.target !== e.currentTarget) return;
    const step = snap || 0.25;
    switch (e.key) {
      case 'ArrowLeft':
        moveGridCursor(0, -step);
        break;
      case 'ArrowRight':
        moveGridCursor(0, step);
        break;
      case 'ArrowUp':
        moveGridCursor(1, 0);
        break;
      case 'ArrowDown':
        moveGridCursor(-1, 0);
        break;
      case 'Home':
        moveGridCursor(0, -clip.length);
        break;
      case 'End':
        moveGridCursor(0, clip.length);
        break;
      case 'Enter':
      case ' ':
        toggleAtCursor();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const cursorNote = noteAtCursor(gridCursor.pitch, gridCursor.beat);
  const cursorText = `${midiToName(gridCursor.pitch)}, ${positionLabel(gridCursor.beat)}, ${
    cursorNote ? `note, velocity ${cursorNote.velocity}` : 'empty'
  }`;

  const midiClips = project.clips.filter((c) => c.type === 'midi');
  const selVel =
    selectedNoteIds.length > 0
      ? Math.round(
          clip.notes
            .filter((n) => selectedNoteIds.includes(n.id))
            .reduce((a, n) => a + n.velocity, 0) / Math.max(1, selectedNoteIds.length),
        )
      : 100;

  /** Windowed notes: selected always mount (pointer-capture rule). */
  const visibleNotes = clip.notes.filter((n) => {
    if (selectedNoteIds.includes(n.id)) return true;
    const x0 = n.start * ppb;
    const x1 = (n.start + n.length) * ppb;
    if (x0 >= win.right || x1 <= win.left) return false;
    const y = (PITCH_MAX - n.pitch) * ROW_H;
    return y <= win.bottom && y + ROW_H >= win.top;
  });
  /** The velocity lane windows horizontally only — it has no vertical extent. */
  const velNotes = clip.notes.filter((n) => {
    if (selectedNoteIds.includes(n.id)) return true;
    const x0 = n.start * ppb;
    return x0 < win.right && x0 + Math.max(3, n.length * ppb) > win.left;
  });

  /**
   * The key column's single tab stop. Off-window rows render as spacers, so a
   * cursor that has scrolled away would leave the column unreachable; the
   * topmost mounted row stands in until focus brings the cursor back.
   */
  const cursorRowTop = (PITCH_MAX - keyCursor) * ROW_H;
  const tabPitch =
    cursorRowTop <= win.bottom && cursorRowTop + ROW_H >= win.top
      ? keyCursor
      : PITCH_MAX - clamp(Math.ceil(win.top / ROW_H), 0, rows - 1);

  const openToolsMenu = (x: number, y: number) => {
    const clipId = clip.id;
    const sel = selectedNoteIds.length;
    const scope = sel ? `${sel} selected` : 'all notes';
    useUiStore.getState().showMenu({
      x,
      y,
      items: [
        {
          label: `Humanize (${scope})`,
          action: () =>
            applyTransform(
              (ns) =>
                humanizeNotes(ns, {
                  seed: (Date.now() % 100000) | 0,
                  timing: 0.02,
                  velocity: 14,
                  length: 0.08,
                  probability: 1,
                }),
              'Humanized',
            ),
        },
        {
          label: 'Transpose +12',
          action: () => applyTransform((ns) => transposeNotes(ns, 12), 'Up an octave'),
        },
        {
          label: 'Transpose −12',
          action: () => applyTransform((ns) => transposeNotes(ns, -12), 'Down an octave'),
        },
        { label: 'Reverse', action: () => applyTransform(reverseNotes, 'Reversed') },
        { label: 'Mirror pitches', action: () => applyTransform(mirrorNotes, 'Mirrored') },
        {
          label: 'Double length (×2)',
          action: () => applyTransform((ns) => stretchNotes(ns, 2), 'Doubled'),
        },
        {
          label: 'Half length (÷2)',
          action: () => applyTransform((ns) => stretchNotes(ns, 0.5), 'Halved'),
        },
        { label: 'Legato', action: () => applyTransform(legatoNotes, 'Legato') },
        {
          label: 'Delete overlaps',
          action: () => applyTransform(deleteOverlaps, 'Overlaps trimmed'),
        },
        {
          label: 'Thin (keep every 2nd)',
          action: () => applyTransform((ns) => thinNotesInPlace(ns), 'Thinned'),
        },
        {
          label: 'Repeat selection ×2',
          action: () => {
            const src = targetNotes();
            if (!src.length) return;
            const copies = repeatNotes(src, 1).map(({ id: _id, ...rest }) => rest);
            const ids = useProjectStore.getState().addNotes(clip.id, copies);
            useUiStore.getState().set({ selectedNoteIds: ids });
          },
        },
      ],
    });

    // Thin deletes notes, which transformNotes cannot express; do it inline.
    function thinNotesInPlace(ns: Note[]): Note[] {
      const kept = thinNotes(ns, 2);
      const keptIds = new Set(kept.map((n) => n.id));
      const dropped = ns.filter((n) => !keptIds.has(n.id)).map((n) => n.id);
      if (dropped.length) useProjectStore.getState().deleteNotes(clipId, dropped);
      return kept;
    }
  };

  const openChordMenu = (x: number, y: number) => {
    const clipId = clip.id;
    const roots = clip.notes.filter((n) => selectedNoteIds.includes(n.id));
    const canChord = roots.length > 0;
    useUiStore.getState().showMenu({
      x,
      y,
      items: [
        ...CHORD_QUALITIES.map((q) => ({
          label: `Chordify: ${q.label}`,
          disabled: !canChord,
          action: () => {
            // Each selected note becomes the root of the chord, keeping its
            // timing and velocity; the root note itself stays.
            const extra: Omit<Note, 'id'>[] = [];
            for (const r of roots) {
              for (const p of buildChord(r.pitch, q.id)) {
                if (p === r.pitch) continue;
                extra.push({ start: r.start, length: r.length, pitch: p, velocity: r.velocity });
              }
            }
            const ids = useProjectStore.getState().addNotes(clip.id, extra);
            useUiStore.getState().set({ selectedNoteIds: [...selectedNoteIds, ...ids] });
            if (track && roots[0]) previewChord(track.id, buildChord(roots[0].pitch, q.id));
          },
        })),
        {
          label: 'Voicing: invert up',
          disabled: !canChord,
          action: () => applyVoicing((ps) => invertChord(ps, 1)),
        },
        {
          label: 'Voicing: invert down',
          disabled: !canChord,
          action: () => applyVoicing((ps) => invertChord(ps, -1)),
        },
        { label: 'Voicing: drop-2', disabled: !canChord, action: () => applyVoicing(drop2) },
        { label: 'Voicing: spread', disabled: !canChord, action: () => applyVoicing(spreadChord) },
        {
          label: 'Voicing: octave double',
          disabled: !canChord,
          action: () => {
            const src = targetNotes();
            const pitches = octaveDouble(src.map((n) => n.pitch));
            const have = new Set(src.map((n) => n.pitch));
            const base = src[0];
            if (!base) return;
            const extra = pitches
              .filter((p) => !have.has(p))
              .map((p) => ({
                start: base.start,
                length: base.length,
                pitch: p,
                velocity: base.velocity,
              }));
            const ids = useProjectStore.getState().addNotes(clip.id, extra);
            useUiStore.getState().set({ selectedNoteIds: [...selectedNoteIds, ...ids] });
          },
        },
      ],
    });

    function applyVoicing(fn: (pitches: number[]) => number[]) {
      const src = targetNotes();
      if (src.length === 0) return;
      const sorted = [...src].sort((a, b) => a.pitch - b.pitch);
      const next = fn(sorted.map((n) => n.pitch));
      // Reassign pitches positionally: lowest note gets lowest voiced pitch.
      const out = sorted.map((n, i) => ({ ...n, pitch: next[i] ?? n.pitch }));
      useProjectStore.getState().transformNotes(clipId, out);
      if (track) previewChord(track.id, next);
    }
  };

  function previewChord(trackId: string, pitches: number[]): void {
    for (const p of pitches.slice(0, 8)) {
      engine.liveNoteOn(trackId, p, 88);
      setTimeout(() => engine.liveNoteOff(trackId, p), 260);
    }
  }

  const suggestions =
    prScale === 'chromatic' && clip.notes.length >= 3
      ? suggestScales(
          clip.notes.map((n) => n.pitch),
          1,
        )
      : [];

  return (
    <div className="pr" data-testid="piano-roll">
      <div className="pr-toolbar">
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
            <option value={1 / 3}>1/8T</option>
            <option value={1 / 6}>1/16T</option>
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
            style={{ width: 60 }}
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

        <span className="pr-sep" />
        <label>
          Q
          <select
            value={qGrid}
            onChange={(e) => setQGrid(Number(e.target.value))}
            aria-label="Quantize grid"
            data-testid="quant-grid"
          >
            {QUANT_GRIDS.map((g) => (
              <option key={g.label} value={g.beats}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label title="Quantize strength">
          Str
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(qStrength * 100)}
            style={{ width: 48 }}
            aria-label="Quantize strength percent"
            onChange={(e) => setQStrength(Number(e.target.value) / 100)}
          />
        </label>
        <label title="Swing">
          Sw
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(qSwing * 100)}
            style={{ width: 48 }}
            aria-label="Swing percent"
            onChange={(e) => setQSwing(Number(e.target.value) / 100)}
          />
        </label>
        <button
          className="btn"
          data-testid="quantize-apply"
          title={`Quantize ${selectedNoteIds.length ? 'selection' : 'all notes'}`}
          onClick={() =>
            applyTransform(
              (ns) => quantizeNotes(ns, { grid: qGrid, strength: qStrength, swing: qSwing }),
              'Quantized',
            )
          }
        >
          Quantize
        </button>

        <span className="pr-sep" />
        <label>
          Key
          <select
            value={prKey}
            onChange={(e) => useUiStore.getState().set({ prKey: Number(e.target.value) })}
            aria-label="Key"
          >
            {KEY_NAMES.map((k, i) => (
              <option key={k} value={i}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <select
          value={prScale}
          onChange={(e) => useUiStore.getState().set({ prScale: e.target.value })}
          aria-label="Scale"
          data-testid="scale-select"
        >
          {SCALES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id === 'chromatic' ? 'No scale' : s.label}
            </option>
          ))}
        </select>
        <button
          className={`th-mini wide${prScaleLock ? ' on' : ''}`}
          title="Snap added and dragged notes to the scale"
          aria-pressed={prScaleLock}
          disabled={prScale === 'chromatic'}
          onClick={() => useUiStore.getState().set({ prScaleLock: !prScaleLock })}
        >
          LOCK
        </button>
        {suggestions.length > 0 && (
          <button
            className="btn hint-btn"
            title="Suggested from the notes in this clip"
            onClick={() => {
              const s = suggestions[0];
              useUiStore.getState().set({ prKey: s.tonic, prScale: s.scaleId });
            }}
          >
            {suggestions[0].label}?
          </button>
        )}

        <span className="pr-sep" />
        <button
          className="btn"
          onClick={(e) => openToolsMenu(e.clientX, e.clientY)}
          data-testid="pr-tools"
        >
          Tools
        </button>
        <button
          className="btn"
          onClick={(e) => openChordMenu(e.clientX, e.clientY)}
          data-testid="pr-chords"
        >
          Chords
        </button>

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
      <div
        className="pr-scroll"
        ref={scrollRef}
        onScroll={() => {
          if (winFrame.current) return;
          winFrame.current = requestAnimationFrame(() => {
            winFrame.current = 0;
            updateWin();
          });
        }}
      >
        <div
          className="pr-inner"
          style={{ width: KEYS_W + gridW, height: gridH + VEL_H, display: 'flex' }}
        >
          <div
            className="pr-keys"
            style={{ height: gridH }}
            ref={keysRef}
            role="group"
            aria-label="Piano keys"
          >
            {Array.from({ length: rows }, (_, i) => {
              const pitch = PITCH_MAX - i;
              const rowTop = i * ROW_H;
              if (rowTop > win.bottom || rowTop + ROW_H < win.top) {
                return <div key={pitch} style={{ height: ROW_H }} />;
              }
              const drumName = isDrum
                ? DRUM_PITCHES.find((d) => d.pitch === pitch)?.name
                : undefined;
              const outOfScale = prScale !== 'chromatic' && !inScale(pitch, prKey, prScale);
              return (
                <div
                  key={pitch}
                  className={`pr-key${isBlack(pitch) ? ' black' : ''}${pitch % 12 === 0 ? ' c-note' : ''}${outOfScale ? ' oos' : ''}`}
                  style={{ height: ROW_H }}
                  data-pitch={pitch}
                  role="button"
                  tabIndex={pitch === tabPitch ? 0 : -1}
                  aria-label={`Play ${drumName ?? midiToName(pitch)}`}
                  onPointerDown={() => track && previewNote(track.id, pitch)}
                  onFocus={() => setKeyCursor(pitch)}
                  onKeyDown={(e) => {
                    const step = (to: number) => {
                      const next = clamp(to, PITCH_MIN, PITCH_MAX);
                      setKeyCursor(next);
                      if (track) previewNote(track.id, next, 70);
                    };
                    switch (e.key) {
                      case 'ArrowUp':
                        step(pitch + 1);
                        break;
                      case 'ArrowDown':
                        step(pitch - 1);
                        break;
                      case 'PageUp':
                        step(pitch + 12);
                        break;
                      case 'PageDown':
                        step(pitch - 12);
                        break;
                      case 'Enter':
                      case ' ':
                        if (track) previewNote(track.id, pitch);
                        break;
                      default:
                        return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  {drumName ?? (pitch % 12 === 0 ? midiToName(pitch) : '')}
                </div>
              );
            })}
          </div>
          <div
            className="pr-grid-area"
            ref={gridRef}
            role="group"
            tabIndex={0}
            aria-label="Note grid"
            aria-describedby={liveId}
            onKeyDown={onGridKey}
            onFocus={(e) => {
              // Notes and their focus bubble through here; only the grid's own
              // focus owns the cursor.
              if (e.target === e.currentTarget) setGridFocused(true);
            }}
            onBlur={(e) => {
              if (e.target === e.currentTarget) setGridFocused(false);
            }}
            style={{ width: gridW, height: gridH, position: 'relative', ...gridStyle }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('.pr-note')) return;
              if (marqueeMoved.current) {
                marqueeMoved.current = false;
                return;
              }
              addNoteAt(e);
            }}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest('.pr-note')) return;
              if (e.pointerType === 'mouse' && e.button === 0) dragMarquee(e);
            }}
            data-testid="pr-grid"
          >
            {/* dim beyond clip end */}
            <div
              className="pr-beyond"
              style={{ left: clip.length * ppb, width: Math.max(0, gridW - clip.length * ppb) }}
            />
            {visibleNotes.map((n) => (
              <NoteView
                key={n.id}
                note={n}
                clip={clip}
                ppb={ppb}
                trackId={clip.trackId}
                positionLabel={positionLabel}
              />
            ))}
            {gridFocused && (
              <div
                ref={cellCursorRef}
                data-testid="pr-cell-cursor"
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: gridCursor.beat * ppb,
                  top: (PITCH_MAX - gridCursor.pitch) * ROW_H,
                  width: Math.max(4, (snap || 0.25) * ppb),
                  height: ROW_H,
                  border: '1px solid rgba(255, 255, 255, 0.65)',
                  borderRadius: 2,
                  pointerEvents: 'none',
                  zIndex: 5,
                }}
              />
            )}
            <div id={liveId} style={SR_ONLY} role="status" aria-live="polite">
              {cursorText}
            </div>
            {marquee && (
              <div
                className="pr-marquee"
                data-testid="pr-marquee"
                style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
              />
            )}
          </div>
        </div>
        {/* Velocity lane: sticky to the bottom of the scroller, scrolls in X. */}
        <div className="pr-vel-lane" style={{ width: KEYS_W + gridW, height: VEL_H }}>
          <div className="pr-vel-label">VEL</div>
          <div
            className="pr-vel-area"
            style={{ left: KEYS_W, width: gridW }}
            data-testid="pr-vel-lane"
          >
            {velNotes.map((n) => (
              <VelBar key={n.id} note={n} clip={clip} ppb={ppb} positionLabel={positionLabel} />
            ))}
          </div>
        </div>
        <div ref={cursorRef} className="pr-cursor" style={{ height: gridH, opacity: 0 }} />
      </div>
    </div>
  );
}
