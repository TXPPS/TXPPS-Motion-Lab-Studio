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
