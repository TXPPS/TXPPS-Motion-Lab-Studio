import { useEffect } from 'react';
import { engine } from '../audio/engine';
import { midi } from '../audio/midi';
import { clamp } from '../model/music';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { saveCurrent } from '../app/projectActions';
import { recording } from '../audio/recordingController';

/**
 * Split the selected clip at the playhead. Does nothing when the playhead is
 * outside the clip, which the store already enforces, so a mistimed press is a
 * no-op rather than an edit in the wrong place.
 */
function splitSelectedAtPlayhead(): void {
  const ui = useUiStore.getState();
  const id = ui.selectedClipId;
  if (!id) {
    ui.toast('info', 'Select a clip to split.');
    return;
  }
  const newId = useProjectStore.getState().splitClip(id, engine.getPositionBeats());
  if (!newId) ui.toast('info', 'The playhead is not inside the selected clip.');
}

/** Computer-keyboard → note mapping (two rows, like a tracker/DAW virtual keys). */
const KEY_TO_SEMITONE: Record<string, number> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
};

function playableTargetId(): string | null {
  const p = useProjectStore.getState().project;
  const sel = useUiStore.getState().selectedTrackId;
  const ok = (t: { type: string }) => t.type === 'instrument' || t.type === 'drum';
  return (
    p.tracks.find((t) => t.armed && ok(t))?.id ??
    p.tracks.find((t) => t.id === sel && ok(t))?.id ??
    p.tracks.find(ok)?.id ??
    null
  );
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function useGlobalKeyboard(): void {
  useEffect(() => {
    const held = new Set<string>();

    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const k = e.key.toLowerCase();

      // Transport / editing shortcuts
      if (e.code === 'Space') {
        e.preventDefault();
        engine.togglePlay();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        useProjectStore.getState().undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault();
        useProjectStore.getState().redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 's') {
        e.preventDefault();
        void saveCurrent();
        return;
      }
      // Split at playhead. Bare "S" is the virtual keyboard's D natural, so the
      // split binding takes a modifier rather than stealing a musical key.
      if ((e.ctrlKey || e.metaKey) && k === 'e') {
        e.preventDefault();
        splitSelectedAtPlayhead();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Record toggle. "R" is not part of the virtual keyboard layout.
      if (k === 'r') {
        e.preventDefault();
        void recording.toggle();
        return;
      }

      if (k === 'enter') {
        engine.returnToStart();
        return;
      }
      if (k === 'escape') {
        // While capturing, Escape means "abandon this take" — and the take is
        // stashed for recovery, not thrown away. Panic would be too blunt here.
        if (recording.isActive()) {
          void recording.cancel();
          return;
        }
        engine.panic();
        midi.panic();
        return;
      }
      if (k === 'z') {
        useUiStore
          .getState()
          .set({ keyboardOctave: clamp(useUiStore.getState().keyboardOctave - 1, 1, 7) });
        return;
      }
      if (k === 'x') {
        useUiStore
          .getState()
          .set({ keyboardOctave: clamp(useUiStore.getState().keyboardOctave + 1, 1, 7) });
        return;
      }
      if (
        (k === 'delete' || k === 'backspace') &&
        useUiStore.getState().selectedNoteIds.length > 0 &&
        useUiStore.getState().editClipId
      ) {
        const ui = useUiStore.getState();
        useProjectStore.getState().deleteNotes(ui.editClipId!, ui.selectedNoteIds);
        ui.set({ selectedNoteIds: [] });
        return;
      }

      // Note input
      const semi = KEY_TO_SEMITONE[k];
      if (semi !== undefined && !held.has(k)) {
        held.add(k);
        const target = playableTargetId();
        if (target) {
          const octave = useUiStore.getState().keyboardOctave;
          engine.liveNoteOn(target, (octave + 1) * 12 + semi, 100);
        }
      }
    };

    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const semi = KEY_TO_SEMITONE[k];
      if (semi !== undefined && held.has(k)) {
        held.delete(k);
        const target = playableTargetId();
        if (target) {
          const octave = useUiStore.getState().keyboardOctave;
          engine.liveNoteOff(target, (octave + 1) * 12 + semi);
        }
      }
    };

    const blur = () => {
      held.clear();
      engine.allNotesOff();
    };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
}
