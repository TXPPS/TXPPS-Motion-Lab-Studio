/**
 * High-level project workflows shared by TopBar, BrowserPanel, and boot.
 * All IndexedDB failures surface as toasts + diagnostics entries, never
 * silent.
 */
import { createDemoProject, createEmptyProject } from '../model/demoProject';
import { projectFromTemplate, type Template } from '../model/templates';
import { scanRecoveries } from './recoveryActions';
import type { ProjectData } from '../model/types';
import {
  deleteProject as repoDelete,
  duplicateProject as repoDuplicate,
  listProjects,
  loadPrefs,
  loadProject,
  loadProjectBackup,
  saveProject,
  savePrefs,
  SchemaError,
} from '../persistence/projectRepo';
import { currentRoute, type QaFixture, type Route } from './router';
import { announceSave, canWrite, claimProject } from '../persistence/sessionLock';
import { diagLog } from '../state/diagnostics';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { engine } from '../audio/engine';
import { mergeProjects, type MergeOptions } from './projectMerge';
import { retainOnly } from '../audio/mediaLibrary';
import { clearStretchCache } from '../audio/stretchCache';
import { usedMediaIds } from '../model/media';

function toast(level: 'info' | 'error', msg: string): void {
  useUiStore.getState().toast(level, msg);
}

/** Set after a quiet (auto)save failure so the user is warned exactly once. */
let autosaveFailureWarned = false;

export async function saveCurrent(quiet = false): Promise<boolean> {
  if (!canWrite()) {
    if (!quiet) {
      useUiStore
        .getState()
        .toast(
          'error',
          'Another tab has this project open. Take over from the status bar to save.',
        );
    }
    return false;
  }
  const s = useProjectStore.getState();
  const snapshot = s.project;
  try {
    await saveProject(snapshot);
    s.markSaved(snapshot);
    // Tell any read-only tab that the document underneath it has moved on.
    announceSave(snapshot.id, snapshot.modifiedAt);
    await savePrefs({ lastProjectId: snapshot.id });
    if (!quiet) toast('info', `Saved "${snapshot.name}"`);
    autosaveFailureWarned = false;
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!quiet) {
      toast('error', `Save failed: ${msg}`);
    } else if (!autosaveFailureWarned) {
      // Autosave failures must never be silent — warn once, keep details in
      // diagnostics (saveProject already logged the cause).
      autosaveFailureWarned = true;
      toast('error', `Autosave failed: ${msg}. Your latest changes are NOT saved.`);
    }
    return false;
  }
}

export async function saveCurrentAs(name: string): Promise<void> {
  const s = useProjectStore.getState();
  const copy: ProjectData = structuredClone(s.project);
  copy.id = `${copy.id.split('~')[0]}~${Date.now().toString(36)}`;
  copy.name = name;
  copy.createdAt = Date.now();
  s.setProject(copy, { markClean: false });
  await saveCurrent();
}

/**
 * Bring another saved project's material into this one.
 *
 * The incoming project lands at the playhead rather than at bar 1: merging is
 * almost always "put the bridge after the chorus", and dropping it on top of
 * what is already there would be the one behaviour nobody wants.
 */
export async function mergeProjectById(id: string, options: MergeOptions = {}): Promise<boolean> {
  const store = useProjectStore.getState();
  if (id === store.project.id) {
    toast('error', 'A project cannot be merged into itself.');
    return false;
  }
  let source: ProjectData | null = null;
  try {
    source = await loadProject(id);
  } catch (e) {
    diagLog('error', `merge failed to read ${id}: ${e instanceof Error ? e.message : e}`);
  }
  if (!source) {
    toast('error', 'That project could not be read.');
    return false;
  }

  const result = mergeProjects(store.project, source, {
    atBeat: engine.getPositionBeats(),
    includeGlobalTracks: true,
    ...options,
  });
  store.setProject(result.project, { markClean: false });
  retainOnly(usedMediaIds(result.project));
  clearStretchCache();

  const { tracks, clips } = result.added;
  toast('info', `Merged "${source.name}": ${tracks} track(s), ${clips} clip(s).`);
  for (const warning of result.warnings.slice(0, 3)) toast('info', warning);
  diagLog(
    'info',
    `Merged project "${source.name}" (${tracks} tracks, ${clips} clips, ${result.warnings.length} warning(s))`,
  );
  await saveCurrent();
  return true;
}

export async function openProject(id: string): Promise<boolean> {
  // Claim the project before loading it, so a second tab knows it is a reader
  // before its first autosave timer can fire.
  await claimProject(id);
  engine.stop();
  try {
    const p = await loadProject(id);
    if (!p) {
      toast('error', 'Project not found — it may have been deleted.');
      diagLog('warn', `openProject: missing project ${id}`);
      return false;
    }
    useProjectStore.getState().setProject(p, { markClean: true });
    useUiStore.getState().set({ selectedClipId: null, selectedNoteIds: [], editClipId: null });
    retainOnly(usedMediaIds(p));
    clearStretchCache();
    await savePrefs({ lastProjectId: p.id });
    return true;
  } catch (e) {
    diagLog('error', `openProject failed: ${e instanceof Error ? e.message : e}`);
    // The stored copy is unreadable (corrupted write or newer schema). Every
    // save keeps the previous version — offer it rather than a dead end.
    const backup = await loadProjectBackup(id).catch(() => null);
    if (backup) {
      useProjectStore.getState().setProject(backup, { markClean: false });
      useUiStore.getState().set({ selectedClipId: null, selectedNoteIds: [], editClipId: null });
      toast(
        'info',
        `"${backup.name}" could not be read — restored the previous saved version instead.`,
      );
      diagLog('warn', `openProject: restored backup copy of ${id}`);
      return true;
    }
    if (e instanceof SchemaError) {
      toast('error', `Cannot open project: ${e.message}`);
    } else {
      toast('error', `Open failed: ${e instanceof Error ? e.message : e}`);
    }
    return false;
  }
}

export async function newProject(name: string, opts?: { demo?: boolean }): Promise<void> {
  engine.stop();
  const p = opts?.demo ? createDemoProject() : createEmptyProject(name);
  if (!opts?.demo) p.name = name;
  useProjectStore.getState().setProject(p, { markClean: false });
  useUiStore.getState().set({ selectedClipId: null, selectedNoteIds: [], editClipId: null });
  retainOnly(usedMediaIds(p));
  clearStretchCache();
  await saveCurrent(true);
}

/**
 * Start from a template: build the session, save it, and make it current.
 * Saving immediately is what makes the Start page's "recent" list honest.
 */
export async function newProjectFromTemplate(template: Template): Promise<void> {
  const project = projectFromTemplate(template);
  useProjectStore.getState().setProject(project, { markClean: false });
  useUiStore.getState().selectTrack(project.tracks[0]?.id ?? null);
  await saveCurrent(true);
  diagLog('info', `New project from template "${template.name}" (${project.tracks.length} tracks)`);
}

export async function renameCurrent(name: string): Promise<void> {
  useProjectStore.getState().update((d) => {
    d.name = name;
  });
  await saveCurrent(true);
}

export async function duplicateById(id: string): Promise<void> {
  const metas = await listProjects();
  const src = metas.find((m) => m.id === id);
  const copy = await repoDuplicate(id, `${src?.name ?? 'Project'} copy`);
  if (copy) toast('info', `Duplicated as "${copy.name}"`);
}

export async function deleteById(id: string): Promise<void> {
  const s = useProjectStore.getState();
  await repoDelete(id);
  if (s.project.id === id) {
    // deleted the open project: fall back to demo content, unsaved
    const demo = createDemoProject();
    s.setProject(demo, { markClean: false });
    toast('info', 'Deleted open project — loaded a fresh demo project');
  } else {
    toast('info', 'Project deleted');
  }
}

/**
 * Boot: restore last project, else seed + save the demo.
 * The QA layout fixture is loaded in-memory only and never autosaved over a
 * real project.
 */
export async function bootProject(route: Route = currentRoute()): Promise<void> {
  if (route.fixture) {
    // QA fixtures load in memory only and are never autosaved, so a QA run can
    // never overwrite a real project. The route resolves the fixture id
    // exactly — the old substring chain made `qa-audio-edit` depend on being
    // tested before `qa-audio`.
    const load = QA_FIXTURES_LOADERS[route.fixture];
    const project = await load();
    useProjectStore.getState().setProject(project, { markClean: true });
    diagLog('info', `Loaded QA fixture "${route.fixture}" (not persisted)`);
    return;
  }
  try {
    if (!route.reseedDemo) {
      const prefs = await loadPrefs();
      if (prefs.lastProjectId) {
        const ok = await openProject(prefs.lastProjectId).catch(() => false);
        if (ok) return;
        diagLog('warn', 'Last project could not be restored — seeding demo project');
      } else {
        // First run: check if any projects exist at all
        const metas = await listProjects().catch(() => []);
        if (metas.length > 0) {
          const ok = await openProject(metas[0].id);
          if (ok) return;
        }
      }
    }
    const demo = createDemoProject();
    useProjectStore.getState().setProject(demo, { markClean: false });
    await claimProject(demo.id);
    await saveCurrent(true);
    diagLog('info', `Demo project ready (“${demo.name}”)`);
  } catch (e) {
    // IndexedDB may be entirely unavailable — keep working in memory.
    diagLog(
      'error',
      `Boot persistence failed: ${e instanceof Error ? e.message : e}. Running in-memory.`,
    );
    useProjectStore.getState().setProject(createDemoProject(), { markClean: false });
  } finally {
    // Report interrupted takes whichever path the boot took, but never act on
    // them — the user chooses which project they belong in.
    void scanRecoveries();
  }
}

/**
 * One dynamic import per fixture, so none of them reach a production entry
 * chunk. Keyed by the exact route id.
 */
const QA_FIXTURES_LOADERS: Record<QaFixture, () => Promise<ProjectData>> = {
  qa: async () => (await import('../model/stressProject')).createStressProject(),
  'qa-huge': async () => (await import('../model/hugeProject')).createHugeProject(),
  'qa-max': async () => (await import('../model/maxProject')).createMaxProject(),
  'qa-audio': async () => (await import('../model/audioQaProject')).createAudioQaProject(),
  'qa-audio-edit': async () =>
    (await import('../model/audioEditQaProject')).createAudioEditQaProject(),
  'qa-midi': async () => (await import('../model/hugeMidiProject')).createHugeMidiProject(),
  'qa-automation': async () =>
    (await import('../model/hugeAutomationProject')).createHugeAutomationProject(),
  'qa-sampler': async () => (await import('../model/samplerQaProject')).createSamplerQaProject(),
  'qa-drums': async () => (await import('../model/samplerQaProject')).createDrumsQaProject(),
  'qa-multisample': async () =>
    (await import('../model/samplerQaProject')).createMultisampleQaProject(),
};

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced autosave wired to project changes, plus unload protection. */
export function installAutosave(): void {
  useProjectStore.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      void saveCurrent(true);
    }, 1500);
  });

  // Leaving with unsaved changes: flush a save immediately (IndexedDB writes
  // started here usually complete during unload) and let the browser ask for
  // confirmation while the page is still dirty.
  const flush = () => {
    if (!useProjectStore.getState().dirty) return;
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    void saveCurrent(true);
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('beforeunload', (e) => {
    if (!useProjectStore.getState().dirty) return;
    flush();
    e.preventDefault();
    // Chrome requires returnValue to show the confirmation dialog.
    e.returnValue = '';
  });
}
