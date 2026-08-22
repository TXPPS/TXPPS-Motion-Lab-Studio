/**
 * The score editor as a user drives it.
 *
 * `tests/scoreEdit.test.ts` owns the musical arithmetic; this file owns the
 * wiring — that a gesture on the staff reaches the store, that the palette and
 * the keys act on the selection, and that every edit lands as one undoable step.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupUser } from '../setup.tsx';

vi.mock('../../src/audio/engine', async () => ({
  engine: (await import('../setup.tsx')).engineStub,
}));

const { ScoreView } = await import('../../src/components/score/ScoreView');
const { useProjectStore } = await import('../../src/state/projectStore');
const { useUiStore } = await import('../../src/state/uiStore');

const CLIP = 'sc-clip';

/**
 * The staff is 7px per space at the default zoom and sits 7 spaces down, so the
 * bottom line — E4 in treble — is at y = 77 and each staff step is 3.5px.
 */
const BOTTOM_LINE_Y = 77;
const STEP_PX = 3.5;

const originalRect = Element.prototype.getBoundingClientRect;

/**
 * jsdom performs no layout, so every box is zero and each pointer coordinate
 * would land on bar 1 beat 1. Reporting the origin makes client coordinates
 * *be* sheet coordinates, which is what the component measures against.
 */
beforeEach(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 4000,
      bottom: 400,
      width: 4000,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
});
afterEach(() => {
  Element.prototype.getBoundingClientRect = originalRect;
});

/**
 * jsdom has no PointerEvent, and Testing Library's fallback drops every
 * property of one — the coordinates the drag is about included. A MouseEvent
 * under the pointer event's name carries them to the same listeners.
 */
function pointer(
  type: string,
  clientX: number,
  clientY: number,
  init: MouseEventInit = {},
): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, ...init });
}

/** A press and release on one element, with no movement between. */
function click(el: Element, x: number, y: number, init: MouseEventInit = {}): void {
  fireEvent(el, pointer('pointerdown', x, y, init));
  fireEvent(window, pointer('pointerup', x, y, init));
}

/** One instrument track, one four-bar clip, whatever notes the test needs. */
function seed(notes: { id: string; start: number; length: number; pitch: number }[]): void {
  const store = useProjectStore.getState();
  const track = store.project.tracks.find((t) => t.type === 'instrument');
  if (!track) throw new Error('the demo project has no instrument track');
  store.update((d) => {
    d.clips = [
      {
        id: CLIP,
        trackId: track.id,
        name: 'Part',
        type: 'midi',
        start: 0,
        length: 4,
        muted: false,
        notes: notes.map((n) => ({ ...n, velocity: 100 })),
      },
    ];
  });
  useUiStore.getState().set({ editClipId: CLIP, selectedNoteIds: [] });
}

/** Pin the spelling key, so a pitch assertion does not ride on key detection. */
function inC(): void {
  fireEvent.change(screen.getByLabelText('Key signature'), { target: { value: '0:major' } });
}

const notesNow = () => {
  const clip = useProjectStore.getState().project.clips.find((c) => c.id === CLIP);
  if (clip?.type !== 'midi') throw new Error('clip gone');
  return clip.notes;
};

const noteNow = (id: string) => {
  const n = notesNow().find((x) => x.id === id);
  if (!n) throw new Error(`no note ${id}`);
  return n;
};

const heads = () => screen.getAllByTestId('sc-note');
const selection = () => useUiStore.getState().selectedNoteIds;
const view = () => screen.getByTestId('score-view');

describe('ScoreView — selection', () => {
  it('selects a head, and shift extends the selection', () => {
    seed([
      { id: 'a', start: 0, length: 1, pitch: 60 },
      { id: 'b', start: 1, length: 1, pitch: 64 },
    ]);
    render(<ScoreView />);

    click(heads()[0], 40, 84);
    expect(selection()).toEqual(['a']);

    click(heads()[1], 90, 77, { shiftKey: true });
    expect(new Set(selection())).toEqual(new Set(['a', 'b']));

    // Shift again takes it back out, so the same key both adds and removes.
    click(heads()[1], 90, 77, { shiftKey: true });
    expect(selection()).toEqual(['a']);
  });

  it('shows a selection made outside the score, which is how it meets the piano roll', () => {
    seed([{ id: 'a', start: 0, length: 1, pitch: 60 }]);
    render(<ScoreView />);

    expect(heads()[0]).toHaveAttribute('aria-pressed', 'false');
    act(() => useUiStore.getState().set({ selectedNoteIds: ['a'] }));
    expect(heads()[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('clears the selection on empty staff, and on Escape', () => {
    seed([{ id: 'a', start: 0, length: 1, pitch: 60 }]);
    render(<ScoreView />);

    click(heads()[0], 40, 84);
    expect(selection()).toEqual(['a']);

    click(screen.getByTestId('sc-sheet'), 600, 200);
    expect(selection()).toEqual([]);

    click(heads()[0], 40, 84);
    fireEvent.keyDown(view(), { key: 'Escape' });
    expect(selection()).toEqual([]);
  });

  it('sweeps a marquee over the heads it covers', () => {
    seed([
      { id: 'a', start: 0, length: 1, pitch: 60 },
      { id: 'b', start: 1, length: 1, pitch: 64 },
      { id: 'c', start: 2, length: 1, pitch: 67 },
    ]);
    render(<ScoreView />);
    const sheet = screen.getByTestId('sc-sheet');

    fireEvent(sheet, pointer('pointerdown', 0, 0));
    fireEvent(window, pointer('pointermove', 4000, 400));
    expect(screen.getByTestId('sc-marquee')).toBeInTheDocument();
    expect(new Set(selection())).toEqual(new Set(['a', 'b', 'c']));

    fireEvent(window, pointer('pointerup', 4000, 400));
    expect(screen.queryByTestId('sc-marquee')).not.toBeInTheDocument();
  });
});

describe('ScoreView — moving a note', () => {
  it('drags pitch by staff steps, in one undo step', () => {
    seed([{ id: 'a', start: 1, length: 1, pitch: 64 }]);
    render(<ScoreView />);
    inC();
    const undoBefore = useProjectStore.getState().undoStack.length;

    // Two steps down from E4 is C4, through D4 — the staff's own arithmetic,
    // not the piano roll's two semitones.
    fireEvent(heads()[0], pointer('pointerdown', 80, BOTTOM_LINE_Y));
    fireEvent(window, pointer('pointermove', 80, BOTTOM_LINE_Y + 2 * STEP_PX));
    fireEvent(window, pointer('pointerup', 80, BOTTOM_LINE_Y + 2 * STEP_PX));

    expect(noteNow('a').pitch).toBe(60);
    expect(useProjectStore.getState().undoStack.length).toBe(undoBefore + 1);

    act(() => useProjectStore.getState().undo());
    expect(noteNow('a').pitch).toBe(64);
  });

  it('nudges the selection from the keyboard, respelled by the key', () => {
    seed([{ id: 'a', start: 1, length: 1, pitch: 64 }]);
    render(<ScoreView />);
    inC();

    click(heads()[0], 80, BOTTOM_LINE_Y);
    fireEvent.keyDown(view(), { key: 'ArrowUp' });
    // E4 up one staff step is F4 — a semitone, because that is where F is.
    expect(noteNow('a').pitch).toBe(65);

    fireEvent.keyDown(view(), { key: 'ArrowUp', shiftKey: true });
    expect(noteNow('a').pitch).toBe(77);

    fireEvent.keyDown(view(), { key: 'ArrowLeft' });
    expect(noteNow('a').start).toBe(0.75);
    fireEvent.keyDown(view(), { key: 'ArrowRight' });
    expect(noteNow('a').start).toBe(1);
  });

  it('clamps at the clip walls rather than lengthening the clip', () => {
    seed([{ id: 'a', start: 3, length: 1, pitch: 64 }]);
    render(<ScoreView />);

    click(heads()[0], 200, BOTTOM_LINE_Y);
    for (let i = 0; i < 12; i++) fireEvent.keyDown(view(), { key: 'ArrowRight' });

    expect(noteNow('a').start).toBe(3);
    expect(noteNow('a').start + noteNow('a').length).toBeLessThanOrEqual(4);
    expect(useProjectStore.getState().project.clips.find((c) => c.id === CLIP)?.length).toBe(4);
  });
});

describe('ScoreView — entering and removing notes', () => {
  it('writes a note where the staff is clicked, at the palette duration', async () => {
    const user = setupUser();
    seed([]);
    render(<ScoreView />);
    inC();
    // A one-beat grid, so the landing beat does not depend on sub-pixel layout.
    fireEvent.change(screen.getByLabelText('Notation quantise grid'), { target: { value: '1' } });

    await user.click(screen.getByTestId('sc-input-mode'));
    await user.click(screen.getByTestId('sc-dur-2'));
    click(screen.getByTestId('sc-sheet'), 120, BOTTOM_LINE_Y);

    const written = notesNow();
    expect(written).toHaveLength(1);
    expect(written[0].pitch).toBe(64);
    expect(written[0].length).toBe(2);
    expect(written[0].start % 1).toBe(0);
    // Selected, so the next duration or accidental press acts on what was written.
    expect(selection()).toEqual([written[0].id]);
  });

  it('reads the line under the pointer, not a fixed pitch', async () => {
    const user = setupUser();
    seed([]);
    render(<ScoreView />);
    inC();
    await user.click(screen.getByTestId('sc-input-mode'));

    // Four steps above the bottom line is B4, two more is D5.
    click(screen.getByTestId('sc-sheet'), 120, BOTTOM_LINE_Y - 4 * STEP_PX);
    click(screen.getByTestId('sc-sheet'), 160, BOTTOM_LINE_Y - 6 * STEP_PX);
    expect(notesNow().map((n) => n.pitch)).toEqual([71, 74]);
  });

  it('writes to the staff that was clicked on a grand staff', async () => {
    const user = setupUser();
    seed([]);
    render(<ScoreView />);
    inC();
    fireEvent.change(screen.getByLabelText('Clef'), { target: { value: 'grand' } });
    await user.click(screen.getByTestId('sc-input-mode'));

    // The lower staff sits 13 spaces below the upper one, so its bottom line —
    // G2 in bass — is at y = 168. The same click on the upper staff is E4.
    click(screen.getByTestId('sc-sheet'), 120, 168);
    click(screen.getByTestId('sc-sheet'), 160, BOTTOM_LINE_Y);
    expect(notesNow().map((n) => n.pitch)).toEqual([43, 64]);
  });

  it('does not write a note while the staff is in selection mode', () => {
    seed([]);
    render(<ScoreView />);
    click(screen.getByTestId('sc-sheet'), 120, BOTTOM_LINE_Y);
    expect(notesNow()).toHaveLength(0);
  });

  it('deletes the selection with Delete, and undo brings it back', () => {
    seed([
      { id: 'a', start: 0, length: 1, pitch: 60 },
      { id: 'b', start: 1, length: 1, pitch: 64 },
    ]);
    render(<ScoreView />);

    click(heads()[0], 40, 84);
    fireEvent.keyDown(view(), { key: 'Delete' });

    expect(notesNow().map((n) => n.id)).toEqual(['b']);
    expect(selection()).toEqual([]);

    act(() => useProjectStore.getState().undo());
    expect(notesNow()).toHaveLength(2);
  });
});

describe('ScoreView — durations and accidentals', () => {
  it('rewrites the selected note at the palette duration', async () => {
    const user = setupUser();
    seed([{ id: 'a', start: 0, length: 1, pitch: 60 }]);
    render(<ScoreView />);

    click(heads()[0], 40, 84);
    await user.click(screen.getByTestId('sc-dur-2'));
    expect(noteNow('a').length).toBe(2);

    await user.click(screen.getByTestId('sc-dot'));
    expect(noteNow('a').length).toBe(3);
  });

  it('shortens to what the beat can carry rather than entering a tied pair', async () => {
    const user = setupUser();
    seed([{ id: 'a', start: 1, length: 1, pitch: 60 }]);
    render(<ScoreView />);

    click(heads()[0], 80, 84);
    await user.click(screen.getByTestId('sc-dur-4'));
    await user.click(screen.getByTestId('sc-dot'));

    // A dotted quarter on beat 2 of 4/4 would hide beat 3, so it stays a quarter.
    expect(noteNow('a').length).toBe(1);
    expect(useUiStore.getState().toasts.at(-1)?.message).toMatch(/quarter/);
  });

  it('takes a duration from the number keys', () => {
    seed([{ id: 'a', start: 0, length: 1, pitch: 60 }]);
    render(<ScoreView />);

    click(heads()[0], 40, 84);
    fireEvent.keyDown(view(), { key: '2' });
    expect(noteNow('a').length).toBe(2);
    fireEvent.keyDown(view(), { key: '4' });
    expect(noteNow('a').length).toBe(0.5);
  });

  it('offers no value the notation grid is too coarse to print', () => {
    seed([{ id: 'a', start: 0, length: 1, pitch: 60 }]);
    render(<ScoreView />);
    fireEvent.change(screen.getByLabelText('Notation quantise grid'), { target: { value: '1' } });
    expect(screen.getByTestId('sc-dur-8')).toBeDisabled();
    expect(screen.getByTestId('sc-dur-4')).toBeEnabled();
  });

  it('moves the pitch to the accidental of the note’s own staff line', async () => {
    const user = setupUser();
    // F♯4 in G major, which prints no accidental because the key supplies it.
    seed([{ id: 'a', start: 0, length: 1, pitch: 66 }]);
    render(<ScoreView />);
    fireEvent.change(screen.getByLabelText('Key signature'), { target: { value: '7:major' } });

    click(heads()[0], 40, 80);
    await user.click(screen.getByTestId('sc-acc-natural'));
    expect(noteNow('a').pitch).toBe(65);

    await user.click(screen.getByTestId('sc-acc-sharp'));
    expect(noteNow('a').pitch).toBe(66);
  });

  it('leaves the accidental buttons off until something is selected', () => {
    seed([{ id: 'a', start: 0, length: 1, pitch: 60 }]);
    render(<ScoreView />);
    expect(screen.getByTestId('sc-acc-sharp')).toBeDisabled();
    click(heads()[0], 40, 84);
    expect(screen.getByTestId('sc-acc-sharp')).toBeEnabled();
  });
});
