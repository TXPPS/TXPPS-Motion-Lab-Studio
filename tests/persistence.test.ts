import { beforeEach, describe, expect, it } from 'vitest';
import {
  deleteProject,
  duplicateProject,
  listProjects,
  loadProject,
  saveProject,
  SchemaError,
  validateProject,
} from '../src/persistence/projectRepo';
import { resetDbConnection } from '../src/persistence/db';
import { createDemoProject } from '../src/model/demoProject';
import { SCHEMA_VERSION } from '../src/model/types';

describe('validateProject', () => {
  it('accepts a valid project and normalizes optional fields', () => {
    const p = createDemoProject();
    const v = validateProject(JSON.parse(JSON.stringify(p)));
    expect(v.schemaVersion).toBe(SCHEMA_VERSION);
    expect(v.tracks.length).toBe(p.tracks.length);
  });

  it('rejects a newer schema version', () => {
    expect(() =>
      validateProject({ schemaVersion: 999, id: 'x', name: 'y', tracks: [], clips: [] }),
    ).toThrow(SchemaError);
  });

  it('rejects non-objects and missing core fields', () => {
    expect(() => validateProject(null)).toThrow(SchemaError);
    expect(() => validateProject({ schemaVersion: 1 })).toThrow(SchemaError);
    expect(() =>
      validateProject({ schemaVersion: 1, id: 'a', name: 'b', tracks: {}, clips: [] }),
    ).toThrow();
  });

  it('drops clips that reference missing tracks (corruption tolerance)', () => {
    const v = validateProject({
      schemaVersion: 1,
      id: 'a',
      name: 'b',
      tracks: [{ id: 't1', type: 'instrument' }],
      clips: [
        { id: 'c1', trackId: 't1', start: 0, length: 4 },
        { id: 'c2', trackId: 'ghost', start: 0, length: 4 },
      ],
    });
    expect(v.clips).toHaveLength(1);
    expect(v.clips[0].id).toBe('c1');
  });

  /**
   * The arrangement's vertical zoom and its per-track heights.
   *
   * Both are new to the document. `laneScale` was `uiStore` state that a reload
   * threw away, and `Track.height` had been validated on load since v6 while
   * nothing wrote it — so the load path had never carried a value the product
   * had actually produced. A reload may add defaults; it may never drop or
   * alter what was written.
   */
  describe('the arrangement height state', () => {
    const withHeights = (patch: Record<string, unknown>) =>
      validateProject({
        schemaVersion: 1,
        id: 'a',
        name: 'b',
        tracks: [{ id: 't1', type: 'instrument', height: 137 }],
        clips: [],
        ...patch,
      });

    it('carries laneScale and a per-track height through a load', () => {
      const v = withHeights({ workspace: { pxPerBeat: 26, snap: 0.25, laneScale: 1.75 } });
      expect(v.workspace.laneScale).toBe(1.75);
      expect(v.tracks[0].height).toBe(137);
    });

    it('defaults laneScale to 1 for a project written before it existed', () => {
      // Every project saved to date. It has to load, and it has to load at the
      // height it was drawn at, which is the unscaled one.
      expect(withHeights({ workspace: { pxPerBeat: 26, snap: 0.25 } }).workspace.laneScale).toBe(1);
      expect(withHeights({}).workspace.laneScale).toBe(1);
    });

    it('clamps a laneScale the arrangement could not draw', () => {
      // Clamped rather than merely defaulted, unlike `pxPerBeat` beside it: it
      // is a multiplier on every lane, so a hand-edited 400 would ask for a
      // 25,600 px track rather than merely looking wrong.
      expect(withHeights({ workspace: { laneScale: 400 } }).workspace.laneScale).toBe(2.5);
      expect(withHeights({ workspace: { laneScale: 0 } }).workspace.laneScale).toBe(0.6);
      expect(withHeights({ workspace: { laneScale: 'tall' } }).workspace.laneScale).toBe(1);
    });

    it('validating its own output leaves both alone', () => {
      const once = withHeights({ workspace: { pxPerBeat: 26, snap: 0.25, laneScale: 1.75 } });
      const twice = validateProject(JSON.parse(JSON.stringify(once)));
      expect(twice.workspace).toEqual(once.workspace);
      expect(twice.tracks[0].height).toBe(once.tracks[0].height);
    });
  });

  it('fills sane defaults for out-of-range bpm', () => {
    const v = validateProject({
      schemaVersion: 1,
      id: 'a',
      name: 'b',
      bpm: 5000,
      tracks: [],
      clips: [],
    });
    expect(v.bpm).toBe(120);
  });
});

describe('IndexedDB CRUD round-trip', () => {
  beforeEach(() => {
    resetDbConnection();
    indexedDB.deleteDatabase('txpps-motionlab');
  });

  it('saves and loads a project intact', async () => {
    const p = createDemoProject();
    await saveProject(p);
    const back = await loadProject(p.id);
    expect(back).not.toBeNull();
    expect(back!.name).toBe(p.name);
    expect(back!.tracks.length).toBe(p.tracks.length);
    expect(back!.clips.length).toBe(p.clips.length);
  });

  it('returns null for a missing project', async () => {
    expect(await loadProject('does-not-exist')).toBeNull();
  });

  it('lists projects sorted by modifiedAt desc', async () => {
    const a = createDemoProject();
    a.name = 'Older';
    a.modifiedAt = 1000;
    const b = createDemoProject();
    b.name = 'Newer';
    b.modifiedAt = 2000;
    await saveProject(a);
    await saveProject(b);
    const metas = await listProjects();
    expect(metas.length).toBeGreaterThanOrEqual(2);
    const older = metas.findIndex((m) => m.name === 'Older');
    const newer = metas.findIndex((m) => m.name === 'Newer');
    expect(newer).toBeLessThan(older);
  });

  it('duplicates and deletes', async () => {
    const p = createDemoProject();
    await saveProject(p);
    const copy = await duplicateProject(p.id, 'Copy');
    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe(p.id);
    expect((await loadProject(copy!.id))!.name).toBe('Copy');
    await deleteProject(p.id);
    expect(await loadProject(p.id)).toBeNull();
  });
});
