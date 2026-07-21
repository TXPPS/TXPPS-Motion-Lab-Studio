/**
 * Project repository: validation, migration, CRUD, autosave plumbing.
 * Graceful about missing/corrupt/newer-schema data and quota failures.
 */
import { newId } from '../model/ids';
import { SCHEMA_VERSION } from '../model/types';
import type { ProjectData, ProjectMeta } from '../model/types';
import { diagLog } from '../state/diagnostics';
import { idbDelete, idbGet, idbGetAll, idbPut, STORE_PREFS, STORE_PROJECTS } from './db';

export class SchemaError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SchemaError';
  }
}

export interface Prefs {
  lastProjectId?: string;
  midiInputId?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Validate + normalize raw stored data into a ProjectData. Throws SchemaError
 * for unusable input; fills defaults for optional fields.
 */
export function validateProject(raw: unknown): ProjectData {
  if (!isRecord(raw)) throw new SchemaError('project data is not an object');
  const v = raw.schemaVersion;
  if (typeof v !== 'number') throw new SchemaError('missing schemaVersion');
  if (v > SCHEMA_VERSION) {
    throw new SchemaError(
      `project schema v${v} is newer than this app (v${SCHEMA_VERSION}) — please update the app`,
    );
  }
  if (!Array.isArray(raw.tracks) || !Array.isArray(raw.clips)) {
    throw new SchemaError('project is missing tracks/clips');
  }
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') {
    throw new SchemaError('project is missing id/name');
  }
  const bpm = typeof raw.bpm === 'number' && raw.bpm >= 30 && raw.bpm <= 300 ? raw.bpm : 120;
  const ts = isRecord(raw.timeSig) ? raw.timeSig : {};
  const loop = isRecord(raw.loop) ? raw.loop : {};
  const ws = isRecord(raw.workspace) ? raw.workspace : {};
  // Structural sanity for tracks/clips; drop entries that are hopeless.
  const tracks = raw.tracks.filter(
    (t): t is ProjectData['tracks'][number] =>
      isRecord(t) && typeof t.id === 'string' && typeof t.type === 'string',
  );
  const trackIds = new Set(tracks.map((t) => t.id));
  const clips = raw.clips.filter(
    (c): c is ProjectData['clips'][number] =>
      isRecord(c) &&
      typeof c.id === 'string' &&
      typeof c.trackId === 'string' &&
      trackIds.has(c.trackId) &&
      typeof c.start === 'number' &&
      typeof c.length === 'number',
  );
  const dropped = raw.clips.length - clips.length + (raw.tracks.length - tracks.length);
  if (dropped > 0) diagLog('warn', `Project "${raw.name}": dropped ${dropped} invalid entries`);

  return {
    schemaVersion: SCHEMA_VERSION,
    id: raw.id,
    name: raw.name,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    modifiedAt: typeof raw.modifiedAt === 'number' ? raw.modifiedAt : Date.now(),
    bpm,
    timeSig: {
      num: typeof ts.num === 'number' ? ts.num : 4,
      den: typeof ts.den === 'number' ? ts.den : 4,
    },
    loop: {
      enabled: loop.enabled === true,
      start: typeof loop.start === 'number' ? loop.start : 0,
      end: typeof loop.end === 'number' ? loop.end : 16,
    },
    metronome: raw.metronome === true,
    masterVolume: typeof raw.masterVolume === 'number' ? raw.masterVolume : 0.9,
    tracks,
    clips,
    workspace: {
      pxPerBeat: typeof ws.pxPerBeat === 'number' ? ws.pxPerBeat : 26,
      snap: typeof ws.snap === 'number' ? ws.snap : 0.25,
    },
  };
}

export async function saveProject(p: ProjectData): Promise<void> {
  try {
    await idbPut(STORE_PROJECTS, p);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/quota/i.test(msg)) {
      diagLog('error', `Storage quota exceeded while saving "${p.name}" — project NOT saved`);
    } else {
      diagLog('error', `Save failed for "${p.name}": ${msg}`);
    }
    throw e;
  }
}

export async function loadProject(id: string): Promise<ProjectData | null> {
  const raw = await idbGet<unknown>(STORE_PROJECTS, id);
  if (raw === undefined) return null;
  return validateProject(raw);
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await idbGetAll<unknown>(STORE_PROJECTS);
  const metas: ProjectMeta[] = [];
  for (const raw of all) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') continue;
    metas.push({
      id: raw.id,
      name: raw.name,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
      modifiedAt: typeof raw.modifiedAt === 'number' ? raw.modifiedAt : 0,
      trackCount: Array.isArray(raw.tracks) ? raw.tracks.length : 0,
      clipCount: Array.isArray(raw.clips) ? raw.clips.length : 0,
    });
  }
  metas.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return metas;
}

export async function deleteProject(id: string): Promise<void> {
  await idbDelete(STORE_PROJECTS, id);
}

export async function duplicateProject(id: string, newName: string): Promise<ProjectData | null> {
  const src = await loadProject(id);
  if (!src) return null;
  const copy = structuredClone(src);
  copy.id = newId('p');
  copy.name = newName;
  copy.createdAt = Date.now();
  copy.modifiedAt = Date.now();
  await saveProject(copy);
  return copy;
}

export async function loadPrefs(): Promise<Prefs> {
  try {
    const p = await idbGet<Prefs>(STORE_PREFS, 'prefs');
    return isRecord(p) ? p : {};
  } catch {
    return {};
  }
}

export async function savePrefs(patch: Partial<Prefs>): Promise<void> {
  try {
    const current = await loadPrefs();
    await idbPut(STORE_PREFS, { ...current, ...patch }, 'prefs');
  } catch (e) {
    diagLog('warn', `Prefs save failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
