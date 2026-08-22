/**
 * The three musical editing surfaces, driven from the keyboard.
 *
 * Every test asserts the project, not the DOM: an affordance that announces an
 * edit it does not make is worse than no affordance at all, so each key here is
 * judged by what it wrote to the store — the same action the pointer writes.
 *
 * jsdom performs no layout, so every scroller measures zero and the windowed
 * surfaces mount only their first rows and first beats. Tests place their
 * material where that window actually is rather than pretending otherwise.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/audio/engine', async () => ({
  engine: (await import('../setup.tsx')).engineStub,
}));

// The waveform paints into a canvas jsdom does not provide, and what a clip
// draws inside itself has nothing to do with the keys it answers.
vi.mock('../../src/components/arrangement/Waveform', () => ({
  Waveform: () => <div data-testid="waveform-stub" />,
}));

const { engineStub } = await import('../setup.tsx');
const { AutoLaneRow } = await import('../../src/components/arrangement/AutomationLanes');
const { ClipView } = await import('../../src/components/arrangement/ClipView');
const { TrackHeader } = await import('../../src/components/arrangement/TrackHeader');
const { PianoRoll } = await import('../../src/components/pianoroll/PianoRoll');
const { listAutoParams } = await import('../../src/model/paramRegistry');
const { useProjectStore } = await import('../../src/state/projectStore');
const { useUiStore } = await import('../../src/state/uiStore');

function project() {
  return useProjectStore.getState().project;
}

function trackNamed(name: string) {
  const track = project().tracks.find((t) => t.name === name);
  if (!track) throw new Error(`no track ${name}`);
  return track;
}

function clipNamed(name: string) {
  const clip = project().clips.find((c) => c.name === name);
  if (!clip) throw new Error(`no clip ${name}`);
  return clip;
}

function midiNotes(clipId: string) {
  const clip = project().clips.find((c) => c.id === clipId);
  if (clip?.type !== 'midi') throw new Error('not a midi clip');
  return clip.notes;
}

// ------------------------------------------------------------- automation

function laneOf(trackId: string) {
  const lane = project().tracks.find((t) => t.id === trackId)?.automation?.[0];
  if (!lane) throw new Error('no lane');
  return lane;
}

function LaneHost({ trackId }: { trackId: string }) {
  const track = useProjectStore((s) => s.project.tracks.find((t) => t.id === trackId));
  const data = useProjectStore((s) => s.project);
  const lane = track?.automation?.[0];
  if (!track || !lane) throw new Error('no lane to render');
  const param = listAutoParams(track, data).find((p) => p.id === lane.paramId);
  if (!param) throw new Error('no param');
  return (
    <AutoLaneRow
      track={track}
      lane={lane}
      param={param}
      height={44}
      pxPerBeat={40}
      winLeft={0}
      winRight={4000}
      timelineW={4000}
      snap={0.25}
    />
  );
}

function seedVolumeLane(): string {
  const trackId = trackNamed('Drums').id;
  useProjectStore.getState().addAutomationLane(trackId, 'volume');
  return trackId;
}

describe('automation lane keyboard editing', () => {
  it('adds a point at the playhead when the lane itself is focused', () => {
    const trackId = seedVolumeLane();
    engineStub.positionBeats = 2;
    render(<LaneHost trackId={trackId} />);

    fireEvent.keyDown(screen.getByRole('group', { name: 'Volume automation on Drums' }), {
      key: 'Enter',
    });

    const points = laneOf(trackId).points;
    expect(points).toHaveLength(1);
    expect(points[0].beat).toBe(2);
    // The four registered automation shortcuts act on this selection; before
    // this key there was no way to fill it without a pointer.
    expect(useUiStore.getState().autoSel?.pointIds).toEqual([points[0].id]);
  });

  it('announces the point as a slider carrying its formatted value', () => {
    const trackId = seedVolumeLane();
    useProjectStore.getState().addAutomationPoint(trackId, laneOf(trackId).id, 1, 0.5);
    render(<LaneHost trackId={trackId} />);

    const point = screen.getByRole('slider', { name: 'Volume point at 1.2.1' });
    expect(point).toHaveAttribute('aria-valuemin', '0');
    expect(point).toHaveAttribute('aria-valuemax', '1.5');
    expect(point.getAttribute('aria-valuetext')).toContain('dB');
  });

  it('changes the value, moves by the snap, and deletes — one undo step each', () => {
    const trackId = seedVolumeLane();
    const laneId = laneOf(trackId).id;
    useProjectStore.getState().addAutomationPoint(trackId, laneId, 1, 0.5);
    render(<LaneHost trackId={trackId} />);
    const point = screen.getByRole('slider', { name: /Volume point/ });

    fireEvent.keyDown(point, { key: 'ArrowUp' });
    expect(laneOf(trackId).points[0].value).toBeCloseTo(0.55, 5);

    fireEvent.keyDown(point, { key: 'ArrowDown', shiftKey: true });
    expect(laneOf(trackId).points[0].value).toBeCloseTo(0.54, 5);

    fireEvent.keyDown(point, { key: 'ArrowRight' });
    expect(laneOf(trackId).points[0].beat).toBeCloseTo(1.25, 5);

    // Each press closed its own gesture, so undo walks back one press.
    useProjectStore.getState().undo();
    expect(laneOf(trackId).points[0].beat).toBeCloseTo(1, 5);

    fireEvent.keyDown(point, { key: 'Delete' });
    expect(laneOf(trackId).points).toHaveLength(0);
    expect(useUiStore.getState().autoSel?.pointIds).toEqual([]);
  });

  it('adds and removes the focused point from the selection with Enter', () => {
    const trackId = seedVolumeLane();
    const laneId = laneOf(trackId).id;
    const id = useProjectStore.getState().addAutomationPoint(trackId, laneId, 1, 0.5);
    render(<LaneHost trackId={trackId} />);
    const point = screen.getByRole('slider', { name: /Volume point/ });

    fireEvent.keyDown(point, { key: 'Enter' });
    expect(useUiStore.getState().autoSel?.pointIds).toEqual([id]);

    fireEvent.keyDown(point, { key: 'Enter' });
    expect(useUiStore.getState().autoSel?.pointIds).toEqual([]);
  });
});

// ------------------------------------------------------------------ clips

function ClipHost({ clipId }: { clipId: string }) {
  const clip = useProjectStore((s) => s.project.clips.find((c) => c.id === clipId));
  const track = useProjectStore((s) => s.project.tracks.find((t) => t.id === clip?.trackId));
  // The tests delete the clip; the arrangement unmounts it the same way.
  if (!clip || !track) return null;
  return (
    <ClipView clip={clip} track={track} laneHeight={64} pxPerBeat={32} laneAt={() => null} />
  );
}

describe('clip keyboard editing', () => {
  it('names itself, its track, its position and its length', () => {
    const clip = clipNamed('Drums A');
    render(<ClipHost clipId={clip.id} />);

    const el = screen.getByRole('button', {
      name: 'Drums A, midi clip on Drums, bar 1.1.1, 4 bars',
    });
    expect(el).toHaveAttribute('aria-pressed', 'false');
  });

  it('selects with Enter and adds to the selection with Shift+Enter', () => {
    const first = clipNamed('Drums A');
    const second = clipNamed('Drums B');
    render(
      <>
        <ClipHost clipId={first.id} />
        <ClipHost clipId={second.id} />
      </>,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: /^Drums A/ }), { key: 'Enter' });
    expect(useUiStore.getState().selectedClipIds).toEqual([first.id]);
    expect(screen.getByRole('button', { name: /^Drums A/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.keyDown(screen.getByRole('button', { name: /^Drums B/ }), {
      key: 'Enter',
      shiftKey: true,
    });
    expect(useUiStore.getState().selectedClipIds).toEqual([first.id, second.id]);
  });

  it('deletes the selection with Delete', () => {
    const clip = clipNamed('Drums A');
    render(<ClipHost clipId={clip.id} />);
    const el = screen.getByRole('button', { name: /^Drums A/ });

    fireEvent.keyDown(el, { key: 'Enter' });
    fireEvent.keyDown(el, { key: 'Delete' });

    expect(project().clips.some((c) => c.id === clip.id)).toBe(false);
    expect(useUiStore.getState().selectedClipIds).toEqual([]);
  });

  it('trims both edges by the grid', () => {
    const clip = clipNamed('Drums A');
    render(<ClipHost clipId={clip.id} />);
    const el = screen.getByRole('button', { name: /^Drums A/ });

    fireEvent.keyDown(el, { key: ']' });
    expect(clipNamed('Drums A').start).toBeCloseTo(0.25, 5);
    expect(clipNamed('Drums A').length).toBeCloseTo(15.75, 5);

    fireEvent.keyDown(el, { key: '[' });
    expect(clipNamed('Drums A').start).toBeCloseTo(0, 5);

    fireEvent.keyDown(el, { key: '{' });
    expect(clipNamed('Drums A').length).toBeCloseTo(15.75, 5);

    fireEvent.keyDown(el, { key: '}' });
    expect(clipNamed('Drums A').length).toBeCloseTo(16, 5);
  });

  it('sets the fades of an audio clip', () => {
    const clip = clipNamed('Perc 2-bar');
    render(<ClipHost clipId={clip.id} />);
    const el = screen.getByRole('button', { name: /^Perc 2-bar/ });

    fireEvent.keyDown(el, { key: '.' });
    const faded = project().clips.find((c) => c.id === clip.id);
    if (faded?.type !== 'audio') throw new Error('not audio');
    expect(faded.fadeIn).toBeGreaterThan(0);

    fireEvent.keyDown(el, { key: '>' });
    const both = project().clips.find((c) => c.id === clip.id);
    if (both?.type !== 'audio') throw new Error('not audio');
    expect(both.fadeOut).toBeGreaterThan(0);

    fireEvent.keyDown(el, { key: ',' });
    const cleared = project().clips.find((c) => c.id === clip.id);
    if (cleared?.type !== 'audio') throw new Error('not audio');
    expect(cleared.fadeIn).toBe(0);
  });

  it('refuses timing edits on a locked clip and says why', () => {
    const clip = clipNamed('Drums A');
    useProjectStore.getState().setClip(clip.id, { locked: true });
    render(<ClipHost clipId={clip.id} />);

    fireEvent.keyDown(screen.getByRole('button', { name: /locked/ }), { key: ']' });

    expect(clipNamed('Drums A').start).toBe(0);
    expect(useUiStore.getState().toasts[0]?.message).toMatch(/locked/);
  });
});

// ---------------------------------------------------------- track headers

describe('track header keyboard selection', () => {
  it('selects the track with Enter, which is what arming depends on', () => {
    const track = trackNamed('Bass');
    useUiStore.getState().selectTrack(null);
    render(<TrackHeader track={track} height={80} />);

    const option = screen.getByRole('option', { name: 'Bass, instrument track' });
    expect(option).toHaveAttribute('aria-selected', 'false');

    fireEvent.keyDown(option, { key: 'Enter' });

    expect(useUiStore.getState().selectedTrackId).toBe(track.id);
    expect(screen.getByRole('option', { name: 'Bass, instrument track' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('selects with Space as well', () => {
    const track = trackNamed('Keys');
    useUiStore.getState().selectTrack(null);
    render(<TrackHeader track={track} height={80} />);

    fireEvent.keyDown(screen.getByRole('option', { name: /^Keys/ }), { key: ' ' });

    expect(useUiStore.getState().selectedTrackId).toBe(track.id);
  });
});

// ------------------------------------------------------------- piano roll

/** An empty clip on an instrument track, open in the editor. */
function seedEditorClip(): string {
  const trackId = trackNamed('Keys').id;
  const clipId = useProjectStore.getState().addMidiClip(trackId, 0, 4);
  useUiStore.getState().openEditorFor(clipId);
  return clipId;
}

describe('piano roll keyboard editing', () => {
  it('adds a note at the cursor and narrates where the cursor is', () => {
    const clipId = seedEditorClip();
    render(<PianoRoll />);
    const grid = screen.getByTestId('pr-grid');

    expect(screen.getByRole('status')).toHaveTextContent('C4, 1.1.1, empty');

    fireEvent.keyDown(grid, { key: 'Enter' });

    const notes = midiNotes(clipId);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ pitch: 60, start: 0, velocity: 100 });
    expect(useUiStore.getState().selectedNoteIds).toEqual([notes[0].id]);
    expect(screen.getByRole('status')).toHaveTextContent('C4, 1.1.1, note, velocity 100');
  });

  it('moves the cursor by the snap and by a semitone, then removes what it stands on', () => {
    const clipId = seedEditorClip();
    render(<PianoRoll />);
    const grid = screen.getByTestId('pr-grid');

    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    fireEvent.keyDown(grid, { key: 'ArrowUp' });
    expect(screen.getByRole('status')).toHaveTextContent('C#4, 1.1.2, empty');

    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(midiNotes(clipId)[0]).toMatchObject({ pitch: 61, start: 0.25 });

    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(midiNotes(clipId)).toHaveLength(0);
  });

  it('selects, nudges, transposes, resizes and deletes the focused note', () => {
    const clipId = seedEditorClip();
    // Pitch 106 keeps the note inside the window jsdom's zero-sized scroller
    // reports, which is the top-left corner of the grid.
    const noteId = useProjectStore
      .getState()
      .addNote(clipId, { start: 0, length: 1, pitch: 106, velocity: 100 });
    render(<PianoRoll />);

    const note = screen.getByRole('button', { name: 'A#7, 1.1.1, velocity 100' });
    fireEvent.keyDown(note, { key: 'Enter' });
    expect(useUiStore.getState().selectedNoteIds).toEqual([noteId]);
    expect(note).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(note, { key: 'ArrowRight' });
    expect(midiNotes(clipId)[0].start).toBeCloseTo(0.25, 5);

    fireEvent.keyDown(note, { key: 'ArrowUp' });
    expect(midiNotes(clipId)[0].pitch).toBe(107);

    fireEvent.keyDown(note, { key: 'ArrowRight', altKey: true });
    expect(midiNotes(clipId)[0].length).toBeCloseTo(1.25, 5);

    // One press, one undo step: the resize is a gesture like its drag.
    useProjectStore.getState().undo();
    expect(midiNotes(clipId)[0].length).toBeCloseTo(1, 5);

    fireEvent.keyDown(note, { key: 'Delete' });
    expect(midiNotes(clipId)).toHaveLength(0);
    expect(useUiStore.getState().selectedNoteIds).toEqual([]);
  });

  it('writes velocity from the velocity lane', () => {
    const clipId = seedEditorClip();
    useProjectStore
      .getState()
      .addNote(clipId, { start: 0, length: 1, pitch: 106, velocity: 100 });
    render(<PianoRoll />);

    const bar = within(screen.getByTestId('pr-vel-lane')).getByRole('slider');
    expect(bar).toHaveAttribute('aria-valuetext', 'velocity 100');
    expect(bar).toHaveAttribute('aria-valuemax', '127');

    fireEvent.keyDown(bar, { key: 'ArrowUp', shiftKey: true });
    expect(midiNotes(clipId)[0].velocity).toBe(110);

    fireEvent.keyDown(bar, { key: 'ArrowDown' });
    expect(midiNotes(clipId)[0].velocity).toBe(109);

    fireEvent.keyDown(bar, { key: 'End' });
    expect(midiNotes(clipId)[0].velocity).toBe(127);
  });

  it('previews a pitch from the key column', () => {
    const clipId = seedEditorClip();
    const trackId = trackNamed('Keys').id;
    render(<PianoRoll />);

    // One tab stop, not eighty-eight: the column rovers its focus with arrows.
    const key = screen.getByRole('button', { name: 'Play C8' });
    expect(key).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(key, { key: 'Enter' });
    expect(engineStub.liveNoteOn).toHaveBeenCalledWith(trackId, 108, 96);

    expect(project().clips.some((c) => c.id === clipId)).toBe(true);
  });
});
