import { beforeEach, describe, expect, it } from 'vitest';
import {
  copySelection,
  cutSelection,
  duplicateSelection,
  pasteAtPlayhead,
  resetClipboard,
} from '../src/app/clipboardActions';
import { findShortcutConflicts, SHORTCUTS } from '../src/app/shortcuts';
import { createEmptyProject } from '../src/model/demoProject';
import { useProjectStore } from '../src/state/projectStore';
import { useUiStore } from '../src/state/uiStore';

function seed() {
  useProjectStore.getState().setProject(createEmptyProject('Sel test'), { markClean: true });
  useProjectStore.getState().setBpm(120);
  const s = useProjectStore.getState();
  const t1 = s.addTrack('audio');
  const t2 = s.addTrack('audio');
  const a = useProjectStore.getState().addAudioClip(t1, 'perc-110-2bar', 0, 4, 'A', 2);
  const b = useProjectStore.getState().addAudioClip(t1, 'perc-110-2bar', 8, 4, 'B', 2);
  const c = useProjectStore.getState().addAudioClip(t2, 'perc-110-2bar', 2, 4, 'C', 2);
  return { t1, t2, a, b, c };
}

const clipsById = () => new Map(useProjectStore.getState().project.clips.map((c) => [c.id, c]));

beforeEach(() => {
  resetClipboard();
  useUiStore.getState().selectClips([]);
});

describe('selection model', () => {
  it('single select replaces the selection and sets the primary', () => {
    const { a, b } = seed();
    useUiStore.getState().selectClip(a);
    useUiStore.getState().selectClip(b);
    expect(useUiStore.getState().selectedClipIds).toEqual([b]);
    expect(useUiStore.getState().selectedClipId).toBe(b);
    void a;
  });

  it('toggle adds and removes without disturbing the rest', () => {
    const { a, b, c } = seed();
    useUiStore.getState().selectClip(a);
    useUiStore.getState().toggleClipSelection(b);
    useUiStore.getState().toggleClipSelection(c);
    expect(useUiStore.getState().selectedClipIds).toEqual([a, b, c]);
    expect(useUiStore.getState().selectedClipId).toBe(c);

    useUiStore.getState().toggleClipSelection(b);
    expect(useUiStore.getState().selectedClipIds).toEqual([a, c]);
    // Primary falls back to a surviving member, never to a removed one.
    expect(useUiStore.getState().selectedClipId).toBe(c);
  });

  it('clearing the selection clears the primary too', () => {
    const { a } = seed();
    useUiStore.getState().selectClip(a);
    useUiStore.getState().selectClips([]);
    expect(useUiStore.getState().selectedClipId).toBeNull();
    expect(useUiStore.getState().selectedClipIds).toEqual([]);
  });
});

describe('group move', () => {
  it('moves all clips by one delta, preserving spacing', () => {
    const { a, b, c } = seed();
    useProjectStore.getState().moveClipsBy([a, b, c], 3);
    const m = clipsById();
    expect(m.get(a)!.start).toBe(3);
    expect(m.get(b)!.start).toBe(11);
    expect(m.get(c)!.start).toBe(5);
  });

  it('clamps at zero as a group instead of compressing spacing', () => {
    const { a, b, c } = seed();
    // Earliest is at 0, so any negative delta must be a no-op for everyone.
    useProjectStore.getState().moveClipsBy([a, b, c], -5);
    const m = clipsById();
    expect(m.get(a)!.start).toBe(0);
    expect(m.get(b)!.start).toBe(8);
    expect(m.get(c)!.start).toBe(2);
  });
});

describe('clipboard', () => {
  it('copies and pastes a block at the playhead with spacing preserved', () => {
    const { a, c } = seed();
    useUiStore.getState().selectClips([a, c]);
    expect(copySelection()).toBe(2);

    // Playhead is at 0 when stopped; the block's min start (0) lands there.
    const before = useProjectStore.getState().project.clips.length;
    expect(pasteAtPlayhead()).toBe(2);
    const clips = useProjectStore.getState().project.clips;
    expect(clips.length).toBe(before + 2);

    const pasted = useUiStore.getState().selectedClipIds.map((id) => clipsById().get(id)!);
    const starts = pasted.map((p) => p.start).sort((x, y) => x - y);
    expect(starts).toEqual([0, 2]);
    // Each copy stays on its own source track.
    expect(new Set(pasted.map((p) => p.trackId)).size).toBe(2);
  });

  it('cut removes the originals and pastes them back', () => {
    const { a, b } = seed();
    useUiStore.getState().selectClips([a, b]);
    const before = useProjectStore.getState().project.clips.length;
    expect(cutSelection()).toBe(2);
    expect(useProjectStore.getState().project.clips.length).toBe(before - 2);
    expect(pasteAtPlayhead()).toBe(2);
    expect(useProjectStore.getState().project.clips.length).toBe(before);
  });

  it('skips clips whose track has been deleted rather than guessing a home', () => {
    const { t2, a, c } = seed();
    useUiStore.getState().selectClips([a, c]);
    copySelection();
    useProjectStore.getState().deleteTrack(t2);
    expect(pasteAtPlayhead()).toBe(1);
  });

  it('copy is a snapshot: later edits do not change what pastes', () => {
    const { a } = seed();
    useUiStore.getState().selectClips([a]);
    copySelection();
    useProjectStore.getState().setClip(a, { name: 'renamed after copy' });
    pasteAtPlayhead();
    const pasted = clipsById().get(useUiStore.getState().selectedClipIds[0])!;
    expect(pasted.name).toBe('A');
  });

  it('paste with an empty clipboard is a no-op', () => {
    seed();
    const before = useProjectStore.getState().project.clips.length;
    expect(pasteAtPlayhead()).toBe(0);
    expect(useProjectStore.getState().project.clips.length).toBe(before);
  });
});

describe('duplicate selection', () => {
  it('places the copies immediately after the block, selected', () => {
    const { a, c } = seed();
    // Block spans beats 0..6 (A: 0-4, C: 2-6) → copies shift by 6.
    useUiStore.getState().selectClips([a, c]);
    expect(duplicateSelection()).toBe(2);
    const ids = useUiStore.getState().selectedClipIds;
    const starts = ids.map((id) => clipsById().get(id)!.start).sort((x, y) => x - y);
    expect(starts).toEqual([6, 8]);
  });

  it('does nothing with no selection', () => {
    seed();
    expect(duplicateSelection()).toBe(0);
  });
});

describe('shortcut registry', () => {
  it('has no conflicting combos', () => {
    expect(findShortcutConflicts()).toEqual([]);
  });

  it('never binds a bare virtual-keyboard note key', () => {
    // These keys play notes; a bare binding on any of them steals a note.
    const noteKeys = new Set('awsedftgyhujkol'.split(''));
    for (const s of SHORTCUTS) {
      if (/click|drag|\+/.test(s.combo)) continue;
      if (s.combo === 'z' || s.combo === 'x') continue; // octave keys, by design
      expect(noteKeys.has(s.combo), `${s.id} steals note key "${s.combo}"`).toBe(false);
    }
  });

  it('every entry has a display string and description', () => {
    for (const s of SHORTCUTS) {
      expect(s.display.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(3);
    }
  });
});
