/** MIDI note editing, and the session-level actions around a project. */
import { useProjectStore } from '../../../src/state/projectStore';
import type { MidiClip } from '../../../src/model/types';
import { clipNow, type Handles } from '../fixture';
import type { Recipe } from '../harness';

const s = () => useProjectStore.getState();
const notesOf = (clipId: string) => (clipNow(clipId) as MidiClip).notes;

export const noteRecipes = (h: Handles): Recipe[] => [
  {
    id: 'store:projectStore.addNote',
    undo: 'step',
    run: () => `note ${s().addNote(h.midi.id, { start: 0, length: 1, pitch: 62, velocity: 100 })}`,
  },
  {
    id: 'store:projectStore.addNotes',
    undo: 'step',
    // One undo step for a whole chord: the reason this action exists beside
    // `addNote` at all.
    run: () =>
      `notes ${
        s().addNotes(h.midi.id, [
          { start: 0, length: 1, pitch: 60, velocity: 100 },
          { start: 0, length: 1, pitch: 64, velocity: 100 },
          { start: 0, length: 1, pitch: 67, velocity: 100 },
        ]).length
      }`,
  },
  {
    id: 'store:projectStore.transformNotes',
    undo: 'step',
    run: () => {
      const next = notesOf(h.midi.id).map((n) => ({ ...n, pitch: n.pitch + 5 }));
      s().transformNotes(h.midi.id, next);
      return `first pitch ${notesOf(h.midi.id)[0].pitch}`;
    },
  },
  {
    id: 'store:projectStore.updateNotes',
    undo: 'none',
    // A drag: velocity, pitch or length, written continuously. `transformNotes`
    // above is the discrete sibling — quantize, humanize — and is a step.
    run: () => {
      const ids = notesOf(h.midi.id).map((n) => n.id);
      s().updateNotes(h.midi.id, ids, (n) => ({ velocity: Math.min(127, n.velocity + 7) }));
      return `first velocity ${notesOf(h.midi.id)[0].velocity}`;
    },
  },
  {
    id: 'store:projectStore.deleteNotes',
    undo: 'step',
    run: () => {
      const was = notesOf(h.midi.id).length;
      s().deleteNotes(h.midi.id, [notesOf(h.midi.id)[0].id]);
      return `${was} -> ${notesOf(h.midi.id).length} notes`;
    },
  },
];
