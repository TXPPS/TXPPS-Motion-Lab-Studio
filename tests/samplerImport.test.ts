/**
 * Putting a sample in a sampler.
 *
 * The defect these are the negative of: every "load" control in the sampler
 * loaded a *fixed procedural* sample, and the only route to the user's own
 * audio was an HTML5 drag from a different panel. So the assertions here are
 * all about `mediaId` — the one piece of state that decides what an instrument
 * plays — reaching a zone from an id the caller chose, rather than about a
 * handler having been invoked.
 *
 * `tests/assetSupply.test.ts` is the other half: it reads the components' source
 * and requires every surface that can make an empty asset slot to draw a
 * control that fills one — because a route that works and is not on screen is
 * what shipped.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { placeSamples, projectSamples, sampleSourceItems } from '../src/app/samplerImportActions';
import { createDemoProject } from '../src/model/demoProject';
import { DRUM_PAD_BASE } from '../src/model/sampler';
import type { MediaRef } from '../src/model/media';
import { useProjectStore } from '../src/state/projectStore';
import { useUiStore } from '../src/state/uiStore';

const media = (id: string, name: string, kind: MediaRef['kind'], at = 1): MediaRef => ({
  id,
  name,
  kind,
  duration: 1,
  sampleRate: 48000,
  channels: 2,
  byteSize: 1000,
  createdAt: at,
  source: name,
  peaksVersion: 1,
});

function boot(view: 'quick' | 'drum' | 'multi') {
  useProjectStore.getState().setProject(createDemoProject(), { markClean: true });
  const s = useProjectStore.getState();
  const track = s.project.tracks.find((t) => t.type === 'instrument')!;
  s.setInstrument(track.id, view);
  return track.id;
}

const sampler = (trackId: string) =>
  useProjectStore.getState().project.tracks.find((t) => t.id === trackId)!.sampler!;

describe('loading a sample into a sampler', () => {
  beforeEach(() => {
    useUiStore.setState({ toasts: [] });
  });

  it('the quick sampler plays the media it was handed, not a demo loop', () => {
    const id = boot('quick');
    placeSamples(id, [{ id: 'mine-1', name: 'Kick.wav' }], { kind: 'quick' });
    expect(sampler(id).zones[0].mediaId).toBe('mine-1');
    expect(sampler(id).zones[0].name).toBe('Kick.wav');
  });

  it('a second load replaces the first rather than stacking a silent zone on it', () => {
    const id = boot('quick');
    placeSamples(id, [{ id: 'a', name: 'A' }], { kind: 'quick' });
    placeSamples(id, [{ id: 'b', name: 'B' }], { kind: 'quick' });
    expect(sampler(id).zones).toHaveLength(1);
    expect(sampler(id).zones[0].mediaId).toBe('b');
  });

  it('replacing a zone drops the window, loop and slices that described the old audio', () => {
    const id = boot('quick');
    placeSamples(id, [{ id: 'long', name: 'Long' }], { kind: 'quick' });
    const zoneId = sampler(id).zones[0].id;
    useProjectStore
      .getState()
      .updateSamplerZones(id, [zoneId], () => ({ startSec: 4, endSec: 9, loopStartSec: 5 }));
    useProjectStore.getState().setZoneSlices(id, zoneId, [1, 2, 3]);

    placeSamples(id, [{ id: 'short', name: 'Short' }], { kind: 'replace', zoneId });
    const z = sampler(id).zones[0];
    // A one-second file with a window starting at four seconds plays silence,
    // and silence reads as a broken import rather than as a stale marker.
    expect(z.mediaId).toBe('short');
    expect(z.startSec).toBe(0);
    expect(z.endSec).toBeUndefined();
    expect(z.loopStartSec).toBeUndefined();
    expect(z.slices).toBeUndefined();
  });

  it('a multi-file load fills consecutive pads from the one asked for', () => {
    const id = boot('drum');
    placeSamples(
      id,
      [
        { id: 'h1', name: 'Hat' },
        { id: 'h2', name: 'Snare' },
        { id: 'h3', name: 'Clap' },
      ],
      { kind: 'pad', index: 5 },
    );
    const at = (i: number) =>
      sampler(id).zones.find((z) => z.keyLo === DRUM_PAD_BASE + i && z.keyHi === z.keyLo);
    expect(at(5)?.mediaId).toBe('h1');
    expect(at(6)?.mediaId).toBe('h2');
    expect(at(7)?.mediaId).toBe('h3');
  });

  it('extra files from a multi-select become zones instead of being dropped', () => {
    const id = boot('quick');
    placeSamples(
      id,
      [
        { id: 'one', name: 'One' },
        { id: 'two', name: 'Two' },
        { id: 'three', name: 'Three' },
      ],
      { kind: 'quick' },
    );
    // Silently keeping one of three is the failure people find much later,
    // having already deleted the files.
    expect(sampler(id).zones.map((z) => z.mediaId)).toEqual(['one', 'two', 'three']);
  });

  it('loading is one step of undo', () => {
    const id = boot('quick');
    placeSamples(id, [{ id: 'a', name: 'A' }], { kind: 'quick' });
    placeSamples(id, [{ id: 'b', name: 'B' }], { kind: 'quick' });
    useProjectStore.getState().undo();
    expect(sampler(id).zones[0].mediaId).toBe('a');
  });

  it('the project list offers the project’s own audio, newest first', () => {
    const id = boot('quick');
    useProjectStore.setState((s) => ({
      project: {
        ...s.project,
        media: [
          media('old', 'Older take', 'import', 10),
          media('new', 'Newer take', 'recording', 20),
          media('frz', 'Frozen track', 'freeze', 30),
          media('proc', 'Perc Loop', 'procedural', 40),
        ],
      },
    }));
    // A freeze print belongs to the track that owns it and a procedural is the
    // app's, not the project's — neither is a sample the user brought.
    expect(projectSamples().map((m) => m.id)).toEqual(['new', 'old']);
    void id;
  });

  it('the menu carries a file route whether or not the project has media', () => {
    const id = boot('quick');
    const empty = sampleSourceItems(id, { kind: 'quick' });
    expect(empty.some((i) => i.testId === 'smp-import-file' && !i.disabled)).toBe(true);
    // The only enabled routes with nothing imported are "pick a file" and
    // "go and look" — and the disabled row exists so the menu says why.
    expect(empty.filter((i) => !i.disabled).map((i) => i.testId)).toEqual([
      'smp-import-file',
      'smp-browse-samples',
    ]);

    useProjectStore.setState((s) => ({
      project: { ...s.project, media: [media('m1', 'Loop.wav', 'import')] },
    }));
    const withMedia = sampleSourceItems(id, { kind: 'quick' });
    expect(withMedia.some((i) => i.testId === 'smp-project-media-m1')).toBe(true);
  });

  it('a project-media entry actually loads that media', () => {
    const id = boot('multi');
    useProjectStore.setState((s) => ({
      project: { ...s.project, media: [media('m9', 'Pad.wav', 'import')] },
    }));
    const item = sampleSourceItems(id, { kind: 'zone' }).find(
      (i) => i.testId === 'smp-project-media-m9',
    )!;
    const before = sampler(id).zones.length;
    item.action();
    expect(sampler(id).zones).toHaveLength(before + 1);
    expect(sampler(id).zones.at(-1)!.mediaId).toBe('m9');
  });
});
