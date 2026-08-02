/**
 * High-level project workflows shared by TopBar, BrowserPanel, and boot.
 * All IndexedDB failures surface as toasts + diagnostics entries, never
 * silent.
 */
import { createDemoProject, createEmptyProject } from '../model/demoProject';
import { scanRecoveries } from './recoveryActions';
import type { ProjectData } from '../model/types';
import {
  deleteProject as repoDelete,
  duplicateProject as repoDuplicate,
  listProjects,
  loadPrefs,
  loadProject,
  saveProject,
  savePrefs,
  SchemaError,
} from '../persistence/projectRepo';
import { diagLog } from '../state/diagnostics';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { engine } from '../audio/engine';

function toast(level: 'info' | 'error', msg: string): void {
  useUiStore.getState().toast(level, msg);
}

export async function saveCurrent(quiet = false): Promise<boolean> {
  const s = useProjectStore.getState();
  try {
    await saveProject(s.project);
    s.markSaved();
    await savePrefs({ lastProjectId: s.project.id });
    if (!quiet) toast('info', `Saved "${s.project.name}"`);
    return true;
  } catch (e) {
    if (!quiet) toast('error', `Save failed: ${e instanceof Error ? e.message : e}`);
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

export async function openProject(id: string): Promise<boolean> {
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
    await savePrefs({ lastProjectId: p.id });
    return true;
  } catch (e) {
    if (e instanceof SchemaError) {
      toast('error', `Cannot open project: ${e.message}`);
    } else {
      toast('error', `Open failed: ${e instanceof Error ? e.message : e}`);
    }
    diagLog('error', `openProject failed: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

export async function newProject(name: string, opts?: { demo?: boolean }): Promise<void> {
  engine.stop();
  const p = opts?.demo ? createDemoProject() : createEmptyProject(name);
  if (!opts?.demo) p.name = name;
  useProjectStore.getState().setProject(p, { markClean: false });
  useUiStore.getState().set({ selectedClipId: null, selectedNoteIds: [], editClipId: null });
  await saveCurrent(true);
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
export async function bootProject(forceDemo: boolean, qaFixture = false): Promise<void> {
  if (qaFixture) {
    // #/qa-audio loads the audio-editing fixture; #/qa the layout stress one.
    // Neither is persisted, so a QA run can never overwrite a real project.
    if (window.location.hash.includes('qa-audio-edit')) {
      const { createAudioEditQaProject } = await import('../model/audioEditQaProject');
      useProjectStore.getState().setProject(createAudioEditQaProject(), { markClean: true });
      diagLog('info', 'Loaded QA audio-edit stress fixture (not persisted)');
      return;
    }
    if (window.location.hash.includes('qa-audio')) {
      const { createAudioQaProject } = await import('../model/audioQaProject');
      useProjectStore.getState().setProject(createAudioQaProject(), { markClean: true });
      diagLog('info', 'Loaded QA audio-editing fixture (not persisted)');
      return;
    }
    if (window.location.hash.includes('qa-midi')) {
      const { createHugeMidiProject } = await import('../model/hugeMidiProject');
      useProjectStore.getState().setProject(createHugeMidiProject(), { markClean: true });
      diagLog('info', 'Loaded QA dense-MIDI fixture (not persisted)');
      return;
    }
    if (window.location.hash.includes('qa-automation')) {
      const { createHugeAutomationProject } = await import('../model/hugeAutomationProject');
      useProjectStore.getState().setProject(createHugeAutomationProject(), { markClean: true });
      diagLog('info', 'Loaded QA automation stress fixture (not persisted)');
      return;
    }
    if (window.location.hash.includes('qa-huge')) {
      const { createHugeProject } = await import('../model/hugeProject');
      useProjectStore.getState().setProject(createHugeProject(), { markClean: true });
      diagLog('info', 'Loaded QA huge-scale fixture (not persisted)');
      return;
    }
    const { createStressProject } = await import('../model/stressProject');
    useProjectStore.getState().setProject(createStressProject(), { markClean: true });
    diagLog('info', 'Loaded QA layout stress fixture (not persisted)');
    return;
  }
  try {
    if (!forceDemo) {
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

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced autosave wired to project changes. */
export function installAutosave(): void {
  useProjectStore.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      void saveCurrent(true);
    }, 1500);
  });
}
