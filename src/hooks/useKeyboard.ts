import { useEffect } from 'react';
import { engine } from '../audio/engine';
import { midi } from '../audio/midi';
import { clamp } from '../model/music';
import { useProjectStore } from '../state/projectStore';
import { translateCombo } from '../state/keymapStore';
import { ARRANGE_TOOLS, useUiStore } from '../state/uiStore';
import { saveCurrent } from '../app/projectActions';
import {
  copySelection,
  cutSelection,
  duplicateSelection,
  pasteAtPlayhead,
} from '../app/clipboardActions';
import {
  copyAutomationSelection,
  deleteAutomationSelection,
  duplicateAutomationSelection,
  hasAutomationClipboard,
  pasteAutomation,
} from '../app/automationActions';
import { recording } from '../audio/recordingController';
import { inScale } from '../model/scales';
import { repeatNotes } from '../model/midiTools';
import type { MidiClip } from '../model/types';

/** The piano roll is the active editing surface for note-level shortcuts. */
function pianoContext(): { clip: MidiClip; noteIds: string[] } | null {
  const ui = useUiStore.getState();
  const active = !!ui.editClipId && (ui.editorTab === 'piano' || ui.phoneMode === 'edit');
  if (!active) return null;
  const clip = useProjectStore.getState().project.clips.find((c) => c.id === ui.editClipId);
  if (clip?.type !== 'midi') return null;
  return { clip, noteIds: ui.selectedNoteIds };
}

/** Next pitch in `dir` that the active scale admits (or ±1 when unlocked). */
function stepPitch(pitch: number, dir: 1 | -1): number {
  const ui = useUiStore.getState();
  if (!ui.prScaleLock || ui.prScale === 'chromatic') {
    return Math.min(127, Math.max(0, pitch + dir));
  }
  let p = pitch + dir;
  while (p >= 0 && p <= 127 && !inScale(p, ui.prKey, ui.prScale)) p += dir;
  return p >= 0 && p <= 127 ? p : pitch;
}

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

/**
 * Space activates the focused control before it reaches the transport.
 *
 * Space is both "play/stop" and the platform's activation key for a focused
 * button. Swallowing it globally means a keyboard user who has tabbed to Mute
 * gets playback instead of a mute — the control they are looking at does
 * nothing. So when focus is on something Space already means something to, the
 * transport does not see it.
 */
function spaceBelongsToFocus(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'SUMMARY') return true;
  const role = el.getAttribute('role');
  if (
    role &&
    ['button', 'checkbox', 'switch', 'tab', 'radio', 'menuitem', 'option'].includes(role)
  ) {
    return true;
  }
  // Sliders own the arrow keys, not Space — a fader should still start playback.
  return false;
}

/**
 * A stand-in event carrying a combo's keys, delegating everything that has a
 * side effect to the real event. It exists so a rebound key can be handled by
 * the same branches as its default without those branches knowing.
 */
function eventForCombo(combo: string, real: KeyboardEvent): KeyboardEvent {
  const parts = combo.split('+');
  const key = parts[parts.length - 1];
  return {
    key: key === 'space' ? ' ' : key,
    code: key === 'space' ? 'Space' : `Key${key.toUpperCase()}`,
    ctrlKey: parts.includes('mod'),
    metaKey: false,
    shiftKey: parts.includes('shift'),
    altKey: parts.includes('alt'),
    repeat: real.repeat,
    target: real.target,
    preventDefault: () => real.preventDefault(),
    stopPropagation: () => real.stopPropagation(),
  } as unknown as KeyboardEvent;
}

export function useGlobalKeyboard(): void {
  useEffect(() => {
    const held = new Set<string>();

    const down = (rawEvent: KeyboardEvent) => {
      // A rebound key is translated into the combo the handlers below already
      // understand, so user key commands cost one map lookup rather than a
      // rewrite of every branch. `''` means this key's default action has been
      // given to something else and must not fire.
      const remapped = translateCombo(rawEvent);
      if (remapped === '') return;
      const e = remapped === null ? rawEvent : eventForCombo(remapped, rawEvent);
      const k = e.key.toLowerCase();
      // Save is the one shortcut that must work even while typing in a field —
      // otherwise the browser's own "save page" dialog steals it mid-edit.
      if ((e.ctrlKey || e.metaKey) && k === 's' && isTypingTarget(e.target)) {
        e.preventDefault();
        void saveCurrent();
        return;
      }
      if (isTypingTarget(e.target)) return;

      // Transport / editing shortcuts
      if (e.code === 'Space') {
        if (spaceBelongsToFocus(document.activeElement)) return;
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
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'e') {
        e.preventDefault();
        useUiStore.getState().set({ exportOpen: true });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === ',') {
        e.preventDefault();
        useUiStore.getState().set({ settingsOpen: true });
        return;
      }
      // Split at playhead. Bare "S" is the virtual keyboard's D natural, so the
      // split binding takes a modifier rather than stealing a musical key.
      if ((e.ctrlKey || e.metaKey) && k === 'e') {
        e.preventDefault();
        splitSelectedAtPlayhead();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'a') {
        e.preventDefault();
        // In the piano roll, select-all means the clip's notes, not the
        // project's clips — the surface under the musician's hands wins.
        const pr = pianoContext();
        if (pr) {
          useUiStore.getState().set({ selectedNoteIds: pr.clip.notes.map((n) => n.id) });
          return;
        }
        const all = useProjectStore.getState().project.clips.map((c) => c.id);
        useUiStore.getState().selectClips(all);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'c') {
        e.preventDefault();
        // An active automation point selection wins over the clip selection —
        // the user's last selection gesture decides what "copy" means.
        const asel = useUiStore.getState().autoSel;
        if (asel && asel.pointIds.length > 0) {
          copyAutomationSelection();
          return;
        }
        copySelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'x') {
        e.preventDefault();
        cutSelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'v') {
        e.preventDefault();
        const asel = useUiStore.getState().autoSel;
        if (asel && hasAutomationClipboard()) {
          pasteAutomation(asel.trackId, asel.laneId);
          return;
        }
        pasteAtPlayhead();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'd') {
        e.preventDefault();
        const asel = useUiStore.getState().autoSel;
        if (asel && asel.pointIds.length > 0) {
          duplicateAutomationSelection();
          return;
        }
        const pr = pianoContext();
        if (pr && pr.noteIds.length > 0) {
          const src = pr.clip.notes.filter((n) => pr.noteIds.includes(n.id));
          const copies = repeatNotes(src, 1).map(({ id: _id, ...rest }) => rest);
          const ids = useProjectStore.getState().addNotes(pr.clip.id, copies);
          useUiStore.getState().set({ selectedNoteIds: ids });
          return;
        }
        duplicateSelection();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Note-level editing: arrows nudge/transpose, M toggles mute. Only when
      // the piano roll is the active surface and notes are selected, so the
      // arrangement and page scrolling keep their defaults otherwise.
      {
        const pr = pianoContext();
        if (pr && pr.noteIds.length > 0) {
          const snapStep = useUiStore.getState().prSnap || 0.25;
          if (k === 'arrowleft' || k === 'arrowright') {
            e.preventDefault();
            const d = (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? snapStep / 4 : snapStep);
            useProjectStore.getState().updateNotes(pr.clip.id, pr.noteIds, (n) => ({
              start: Math.max(0, n.start + d),
            }));
            return;
          }
          if (k === 'arrowup' || k === 'arrowdown') {
            e.preventDefault();
            const dir = k === 'arrowup' ? 1 : -1;
            useProjectStore.getState().updateNotes(pr.clip.id, pr.noteIds, (n) => ({
              pitch: e.shiftKey
                ? Math.min(127, Math.max(0, n.pitch + dir * 12))
                : stepPitch(n.pitch, dir),
            }));
            return;
          }
          if (k === 'm') {
            // Mixed states resolve toward muted, so one press always silences.
            const notes = pr.clip.notes.filter((n) => pr.noteIds.includes(n.id));
            const target = notes.some((n) => !n.muted);
            useProjectStore.getState().updateNotes(pr.clip.id, pr.noteIds, () => ({
              muted: target,
            }));
            return;
          }
        }
      }

      // Clip nudge: arrows move the clip selection by the grid (Shift = fine).
      {
        const ui = useUiStore.getState();
        if (ui.selectedClipIds.length > 0 && (k === 'arrowleft' || k === 'arrowright')) {
          e.preventDefault();
          const snapStep = ui.snap || 0.25;
          const dBeats = (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? snapStep / 4 : snapStep);
          useProjectStore.getState().moveClipsBy(ui.selectedClipIds, dBeats);
          return;
        }
      }

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
      // Tool selection: 1-9 map to the arrangement tool row, in its own order.
      if (k >= '1' && k <= '9') {
        const tool = ARRANGE_TOOLS[Number(k) - 1];
        if (tool) useUiStore.getState().set({ tool });
        return;
      }
      if (k === 'escape') {
        // Escalating Escape. Musicians press it casually, so the first press
        // does the gentlest plausible thing and only an "empty" press panics:
        //   recording → abandon the take (stashed for recovery, not discarded)
        //   overlay open → close it
        //   selection → clear it
        //   otherwise → audio panic (the stuck-note rescue)
        if (recording.isActive()) {
          void recording.cancel();
          return;
        }
        const ui = useUiStore.getState();
        if (ui.dialog) {
          ui.closeDialog();
          return;
        }
        if (ui.contextMenu) {
          ui.closeMenu();
          return;
        }
        if (ui.tool !== 'pointer') {
          ui.set({ tool: 'pointer' });
          return;
        }
        if (
          ui.selectedClipIds.length > 0 ||
          ui.selectedNoteIds.length > 0 ||
          (ui.autoSel?.pointIds.length ?? 0) > 0
        ) {
          ui.selectClips([]);
          ui.set({ selectedNoteIds: [], autoSel: null });
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
      if (k === 'delete' || k === 'backspace') {
        const ui = useUiStore.getState();
        // Automation points first, then piano-roll notes, then clips — the
        // narrowest selection wins so Delete never removes more than intended.
        if (ui.autoSel && ui.autoSel.pointIds.length > 0) {
          deleteAutomationSelection();
          return;
        }
        if (ui.selectedNoteIds.length > 0 && ui.editClipId) {
          useProjectStore.getState().deleteNotes(ui.editClipId, ui.selectedNoteIds);
          ui.set({ selectedNoteIds: [] });
          return;
        }
        if (ui.selectedClipIds.length > 0) {
          useProjectStore.getState().deleteClips(ui.selectedClipIds);
          ui.selectClips([]);
          return;
        }
      }
      if (k === '?') {
        useUiStore.getState().set({ shortcutsOpen: true });
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
